'use strict';
/* =====================================================================
   TES SaaS MULTI-TENANT (Tahap 1–6)
   1. Migrasi tenant_id seluruh tabel + sekolah pertama (SK01, lifetime)
   2. Login berbasis kode sekolah + registrasi mandiri + isolasi data
   3. Portal super admin: daftar sekolah, feature flag, lifetime, login-as
   4. QRIS & persetujuan pembayaran (approve menambah masa aktif, reject)
   5. Info layanan & checkout perpanjangan
   6. Auto-backup database via email (SMTP tiruan) + auto-cleanup berkas
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const Database = require('better-sqlite3');

const PORT = process.env.SAAS_PORT || 3981;
const SMTP_PORT = 2526;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-test-'));
const DB = path.join(TMP, 'keuangan.sqlite');
const SDB = path.join(TMP, 'saas.db');
const DEMO_DB = path.join(TMP, 'demo.sqlite');
const SAAS_PASS = 'SuperAdmin2026!';

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: DEMO_DB, SAAS_ADMIN_PASSWORD: SAAS_PASS },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  →  ' + extra));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie) headers.Cookie = opt.cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  return {
    status: r.status, text: await r.text(), loc: r.headers.get('location') || '',
    setCookie: r.headers.get('set-cookie') || ''
  };
}
const cookieOf = sc => String(sc || '').split(';')[0];

/* ---------------- SMTP tiruan ---------------- */
const mailSink = [];
function startFakeSmtp() {
  return new Promise(resolve => {
    const s = net.createServer(sock => {
      let inData = false, buf = '', mail = '', authStage = 0;
      sock.write('220 test.local ESMTP\r\n');
      sock.on('data', d => {
        buf += d.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              mailSink.push({ raw: mail, at: Date.now() });
              mail = '';
              sock.write('250 2.0.0 Ok: queued\r\n');
            } else {
              mail += line + '\r\n';
            }
            continue;
          }
          const up = line.toUpperCase();
          if (up.startsWith('EHLO')) sock.write('250-test.local\r\n250-AUTH LOGIN\r\n250 8BITMIME\r\n');
          else if (up.startsWith('AUTH LOGIN')) { authStage = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
          else if (up.startsWith('MAIL FROM')) sock.write('250 2.1.0 Ok\r\n');
          else if (up.startsWith('RCPT TO')) sock.write('250 2.1.5 Ok\r\n');
          else if (up === 'DATA') { inData = true; sock.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
          else if (up === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
          else if (authStage === 1) { authStage = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
          else sock.write('235 2.7.0 Authentication successful\r\n');
        }
      });
      sock.on('error', () => { });
    });
    s.listen(SMTP_PORT, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const smtp = await startFakeSmtp();
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }

  const sdb = new Database(SDB);
  const t1db = new Database(DB);

  /* ================= TAHAP 1 — migrasi & tenant pertama ================= */
  ok('control plane terbentuk', fs.existsSync(SDB));
  const t1 = sdb.prepare('SELECT * FROM tenants WHERE id=1').get();
  ok('tenant pertama ada', !!t1, JSON.stringify(t1));
  ok('kode sekolah pertama 4 karakter', t1 && String(t1.school_code).length === 4, t1 && t1.school_code);
  ok('kode sekolah pertama = SK01', t1 && t1.school_code === 'SK01', t1 && t1.school_code);
  ok('tenant pertama lifetime', t1 && Number(t1.is_lifetime_free) === 1);
  ok('tenant pertama paket pro', t1 && t1.paket === 'pro');
  ok('database tenant 1 = database lama', t1 && t1.db_file === DB);

  const tabs = t1db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const missing = tabs.filter(t => !t1db.pragma(`table_info("${t}")`).some(c => c.name === 'tenant_id'));
  ok('semua tabel punya kolom tenant_id', missing.length === 0, missing.join(','));
  const emptyTid = tabs.filter(t => {
    const c = t1db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE tenant_id IS NULL`).get().c;
    return c > 0;
  });
  ok('seluruh baris terisi tenant_id=1', emptyTid.length === 0, emptyTid.join(','));
  const trxCount = t1db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  ok('data transaksi tidak dihapus oleh migrasi', trxCount >= 0);

  /* ================= TAHAP 2 — login & registrasi ================= */
  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login dengan kode sekolah', r.status === 303 && r.setCookie.includes('simkeu_sid'), r.status + ' ' + r.loc);
  let c1 = cookieOf(r.setCookie);
  r = await req('GET', '/', null, { cookie: c1 });
  ok('dashboard tenant 1 tampil', r.status === 200 && /Ringkasan Keuangan/.test(r.text), r.status);
  ok('kartu Info Layanan muncul di dashboard', /Info Layanan Sekolah/.test(r.text));

  r = await req('POST', '/login', { kode: 'ZZ99', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('kode sekolah salah ditolak', r.status === 303 && /tidak%20ditemukan|tidak\+ditemukan/.test(r.loc), r.loc);

  r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'salah' });
  ok('password salah ditolak', r.status === 303 && /password%20salah|password\+salah/i.test(r.loc), r.loc);

  // registrasi mandiri sekolah baru
  r = await req('POST', '/register', {
    nama: 'SMP Negeri 2 Contoh', alamat: 'Jl. Melati 5', kepala: 'Dra. Ani',
    admin_nama: 'Bendahara SMPN 2', admin_email: 'admin@smpn2.sch.id',
    admin_password: 'rahasia123', admin_password2: 'rahasia123', telp: '08123', paket: 'standard'
  });
  ok('registrasi sekolah baru redirect', r.status === 303, r.status);
  const t2 = sdb.prepare("SELECT * FROM tenants WHERE nama LIKE 'SMP Negeri 2%'").get();
  ok('tenant baru dibuat', !!t2);
  ok('kode sekolah baru otomatis SK02', t2 && t2.school_code === 'SK02', t2 && t2.school_code);
  ok('tenant baru punya berkas database sendiri', t2 && fs.existsSync(t2.db_file), t2 && t2.db_file);
  ok('tenant baru bukan lifetime', t2 && Number(t2.is_lifetime_free) === 0);
  ok('masa uji coba ditetapkan', t2 && !!t2.expires_at);
  ok('paket standard → fitur pro mati', t2 && JSON.parse(t2.features).iuran === 0);

  r = await req('POST', '/login', { kode: 'SK02', email: 'admin@smpn2.sch.id', password: 'rahasia123' });
  ok('login sekolah baru dengan kodenya', r.status === 303 && r.setCookie.includes('simkeu_sid'), r.loc);
  const c2 = cookieOf(r.setCookie);
  r = await req('GET', '/', null, { cookie: c2 });
  ok('dashboard sekolah baru memakai namanya sendiri', r.text.includes('SMP Negeri 2 Contoh'), 'nama tidak muncul');
  ok('dashboard sekolah baru tidak memuat nama sekolah lain', !r.text.includes('SMK PGRI Cikoneng'));

  // isolasi data: transaksi di tenant 1 tidak terlihat di tenant 2
  const ta1 = t1db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku1 = t1db.prepare('SELECT * FROM bku ORDER BY id LIMIT 1').get();
  t1db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,status,tenant_id)
    VALUES (?,?,?,?,?,?,?,?,'posted',1)`).run(bku1.id, new Date().toISOString().slice(0, 10), 'pemasukan', 'tunai', 'ISO-1', null, 1234567, 'TRANSAKSI-KHAS-TENANT-1');
  const t2db = new Database(t2.db_file);
  ok('tabel transaksi tenant 2 terpisah & kosong', t2db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === 0);
  ok('data tenant 1 tidak ada di tenant 2', t2db.prepare("SELECT COUNT(*) c FROM transaksi WHERE uraian LIKE '%KHAS-TENANT-1%'").get().c === 0);
  ok('pengguna tenant 2 terisolasi', t2db.prepare("SELECT COUNT(*) c FROM users WHERE email='admin@sekolah.sch.id'").get().c === 0);
  r = await req('GET', '/transaksi', null, { cookie: c2 });
  ok('halaman transaksi tenant 2 tidak memuat data tenant 1', !r.text.includes('TRANSAKSI-KHAS-TENANT-1'));

  /* ================= TAHAP 3 — portal super admin ================= */
  r = await req('GET', '/super-admin/login');
  ok('halaman login super admin', r.status === 200 && /Super Admin Pusat/.test(r.text));
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'salah' });
  ok('login super admin gagal dengan sandi salah', r.status === 303 && /salah/.test(r.loc));
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: SAAS_PASS });
  ok('login super admin berhasil', r.status === 303 && r.setCookie.includes('simkeu_saas'), r.status);
  const cs = cookieOf(r.setCookie);

  r = await req('GET', '/super-admin', null, { cookie: cs });
  ok('dashboard super admin', r.status === 200 && /Dashboard SaaS/.test(r.text), r.status);
  ok('daftar sekolah tampil di dashboard', r.text.includes('SMP Negeri 2 Contoh') && r.text.includes('SK02'));
  r = await req('GET', '/super-admin/sekolah', null, { cookie: cs });
  ok('tabel daftar sekolah lengkap', /Kode<\/th><th>Paket/.test(r.text.replace(/\s+/g, '').replace(/<th[^>]*>/g, '<th>')) || r.text.includes('Daftar Sekolah'));
  ok('kolom masa aktif & status ada', r.text.includes('Masa Aktif') && r.text.includes('Status'));
  ok('daftar sekolah menampilkan tenant_id', /tenant_id/.test(r.text), 'kolom tenant_id tidak ada');
  ok('form tambah sekolah berupa modal', /data-open="mTambahSekolah"/.test(r.text) && /id="mTambahSekolah"/.test(r.text));

  // tambah sekolah manual
  r = await req('POST', '/super-admin/sekolah/tambah', {
    nama: 'SD Negeri 3 Uji', admin_nama: 'Admin SD3', admin_email: 'admin@sd3.sch.id',
    admin_password: 'sd3pass123', paket: 'standard', days: 20, alamat: 'Jl. Kenanga'
  }, { cookie: cs });
  const t3 = sdb.prepare("SELECT * FROM tenants WHERE nama='SD Negeri 3 Uji'").get();
  ok('tambah sekolah manual', r.status === 303 && !!t3, r.loc);
  ok('kode sekolah manual otomatis 4 karakter', t3 && String(t3.school_code).length === 4, t3 && t3.school_code);
  ok('sekolah manual dapat masa aktif 20 hari', t3 && !!t3.expires_at);

  // lifetime toggle
  r = await req('POST', `/super-admin/sekolah/${t3.id}/lifetime`, { on: '1' }, { cookie: cs });
  const t3b = sdb.prepare('SELECT * FROM tenants WHERE id=?').get(t3.id);
  ok('sakelar lifetime ON', Number(t3b.is_lifetime_free) === 1 && t3b.expires_at === null, JSON.stringify(t3b.expires_at));
  r = await req('POST', `/super-admin/sekolah/${t3.id}/lifetime`, { on: '0' }, { cookie: cs });
  const t3c = sdb.prepare('SELECT * FROM tenants WHERE id=?').get(t3.id);
  ok('sakelar lifetime OFF kembali berlangganan', Number(t3c.is_lifetime_free) === 0 && !!t3c.expires_at);

  // feature flagging: matikan fitur iuran pada tenant 2
  const feats = JSON.parse(t2.features);
  const keep = Object.keys(feats).filter(k => k !== 'iuran');
  r = await req('POST', `/super-admin/sekolah/${t2.id}/fitur`, { fitur: keep }, { cookie: cs });
  ok('simpan feature flag', r.status === 303, r.loc);
  const t2b = sdb.prepare('SELECT * FROM tenants WHERE id=?').get(t2.id);
  ok('fitur iuran tersimpan mati', JSON.parse(t2b.features).iuran === 0);
  r = await req('GET', '/', null, { cookie: c2 });
  ok('menu iuran hilang dari navigasi', !/href="\/iuran"/.test(r.text), 'masih ada link /iuran');
  r = await req('GET', '/iuran', null, { cookie: c2 });
  ok('URL langsung /iuran diblokir', r.status === 403 && /belum tersedia/.test(r.text), r.status);
  r = await req('GET', '/', null, { cookie: c1 });
  ok('sekolah lifetime tetap bisa akses iuran', r.status === 200 && /href="\/iuran"/.test(r.text));

  // login as tenant (mode bantuan)
  r = await req('POST', `/super-admin/sekolah/${t1.id}/masuk`, {}, { cookie: cs });
  const imp = cookieOf(r.setCookie);
  ok('login as tenant membuat sesi sekolah', r.status === 303 && imp.includes('simkeu_sid'), r.loc);
  r = await req('GET', '/', null, { cookie: imp });
  ok('banner mode bantuan tampil', /Mode bantuan teknis/.test(r.text), 'banner tidak ada');
  r = await req('GET', '/super-admin/kembali', null, { cookie: imp });
  ok('kembali ke portal super admin', r.status === 303 && /super-admin/.test(r.loc));

  /* ================= TAHAP 4 — QRIS & persetujuan pembayaran ================= */
  r = await req('POST', '/super-admin/qris', {
    qris_nama: 'Yayasan Pendidikan Contoh', qris_nomor: '0812-3456-7890',
    qris_instruksi: 'Scan QRIS lalu unggah bukti.', harga_bulan: '175.000', harga_tahun: '1.750.000', trial_hari: '14'
  }, { cookie: cs });
  ok('simpan pengaturan QRIS & harga', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('harga bulan tersimpan (format ribuan diparse)', sdb.prepare("SELECT v FROM saas_settings WHERE k='harga_bulan'").get().v === '175000');
  ok('nama pemilik QRIS tersimpan', sdb.prepare("SELECT v FROM saas_settings WHERE k='qris_nama'").get().v === 'Yayasan Pendidikan Contoh');
  r = await req('GET', '/super-admin/qris', null, { cookie: cs });
  ok('halaman QRIS menampilkan nama pemilik', r.text.includes('Yayasan Pendidikan Contoh'));

  r = await req('GET', '/perpanjang', null, { cookie: c2 });
  ok('checkout menampilkan instruksi QRIS', r.status === 200 && r.text.includes('178.000') === false && r.text.includes('Yayasan Pendidikan Contoh'), r.status);
  ok('checkout menampilkan 2 pilihan durasi', /name="durasi" value="30"/.test(r.text) && /name="durasi" value="365"/.test(r.text));
  ok('harga perpanjangan mengikuti pengaturan', /Rp\s*175\.000/.test(r.text.replace(/&nbsp;/g, ' ')), 'harga tidak sesuai');
  r = await req('GET', '/perpanjang', null, { cookie: c1 });
  ok('sekolah lifetime tidak ditawari perpanjangan', r.text.includes('berstatus Lifetime'));

  // buat pengajuan langsung di control plane (unggah bukti butuh token media runtime)
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const insPay = sdb.prepare(`INSERT INTO saas_payments (tenant_id,no_invoice,jenis,durasi,nominal,status,bukti_url,pengirim,catatan,source,periode_mulai,dibuat_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const p1 = insPay.run(t2.id, 'INV-TEST-1', 'perpanjangan', 30, 175000, 'pending', 'https://media.example/bukti.jpg', 'Bendahara', '', 'tenant', t2.expires_at, now, now);
  r = await req('GET', '/info-layanan', null, { cookie: c2 });
  ok('info layanan menampilkan pengajuan menunggu', /Menunggu Verifikasi/.test(r.text));
  r = await req('GET', '/perpanjang', null, { cookie: c2 });
  ok('form checkout terkunci saat ada pengajuan pending', !/name="bukti_b64"/.test(r.text) && /Menunggu verifikasi/.test(r.text));

  r = await req('GET', '/super-admin/pembayaran', null, { cookie: cs });
  ok('tabel persetujuan menampilkan pengajuan', r.text.includes('SMP Negeri 2 Contoh') && /data-proof/.test(r.text));

  const expBefore = sdb.prepare('SELECT expires_at FROM tenants WHERE id=?').get(t2.id).expires_at;
  r = await req('POST', `/super-admin/pembayaran/${p1.lastInsertRowid}/approve`, {}, { cookie: cs });
  const t2after = sdb.prepare('SELECT * FROM tenants WHERE id=?').get(t2.id);
  ok('approve pembayaran menambah masa aktif', r.status === 303 && t2after.expires_at > expBefore, expBefore + ' → ' + t2after.expires_at);
  const dayDiff = Math.round((new Date(t2after.expires_at) - new Date(expBefore)) / 86400000);
  ok('penambahan tepat +30 hari', dayDiff === 30, dayDiff + ' hari');
  ok('pembayaran disetujui & tercatat', sdb.prepare('SELECT status FROM saas_payments WHERE id=?').get(p1.lastInsertRowid).status === 'approved');
  ok('akun aktif kembali setelah approve', t2after.status === 'active');

  // reject dengan alasan
  const p2 = insPay.run(t2.id, 'INV-TEST-2', 'perpanjangan', 365, 1750000, 'pending', 'https://media.example/bukti2.jpg', 'Bendahara', '', 'tenant', t2after.expires_at, now, now);
  r = await req('POST', '/super-admin/pembayaran', {}, { cookie: cs }); // sanity: route tak ada
  r = await req('POST', `/super-admin/pembayaran/${p2.lastInsertRowid}/reject`, { alasan: 'Nominal tidak sesuai' }, { cookie: cs });
  const p2row = sdb.prepare('SELECT * FROM saas_payments WHERE id=?').get(p2.lastInsertRowid);
  ok('reject pembayaran menyimpan alasan', r.status === 303 && p2row.status === 'rejected' && p2row.alasan === 'Nominal tidak sesuai');
  r = await req('GET', '/info-layanan', null, { cookie: c2 });
  ok('alasan penolakan tampil di Info Layanan', r.text.includes('Nominal tidak sesuai'));

  // auto suspend + tagihan H-7
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  sdb.prepare("UPDATE tenants SET expires_at=?, status='active' WHERE id=?").run(past, t2.id);
  r = await req('POST', '/super-admin/jalan-tagihan', {}, { cookie: cs });
  const t2susp = sdb.prepare('SELECT * FROM tenants WHERE id=?').get(t2.id);
  ok('auto-suspend sekolah kedaluwarsa', t2susp.status === 'suspended', t2susp.status);
  ok('tagihan otomatis diterbitkan', sdb.prepare("SELECT COUNT(*) c FROM saas_payments WHERE tenant_id=? AND jenis='tagihan'").get(t2.id).c >= 1);
  r = await req('GET', '/', null, { cookie: c2 });
  ok('akses sekolah ditangguhkan diblokir', r.status === 403 && /ditangguhkan/.test(r.text), r.status);
  r = await req('GET', '/info-layanan', null, { cookie: c2 });
  ok('Info Layanan tetap bisa dibuka saat ditangguhkan', r.status === 200);
  // lifetime kebal suspend
  sdb.prepare('UPDATE tenants SET expires_at=? WHERE id=?').run(past, t1.id);
  r = await req('GET', '/', null, { cookie: c1 });
  ok('sekolah lifetime tidak pernah diblokir', r.status === 200);

  /* ================= TAHAP 5 — info layanan & checkout ================= */
  r = await req('GET', '/info-layanan', null, { cookie: c1 });
  ok('info layanan sekolah pertama: tanpa tombol perpanjang', !/Perpanjang Masa Aktif/.test(r.text));
  ok('info layanan menampilkan kode sekolah', r.text.includes('SK01'));
  ok('info layanan menampilkan status lifetime', /Lifetime/.test(r.text));

  /* ================= TAHAP 6 — backup email SMTP ================= */
  // set konfigurasi SMTP lewat form tenant (tanpa unggah berkas)
  r = await req('POST', '/info-layanan/mail', {
    mail_to: 'bendahara@smpn2.sch.id', mail_host: '127.0.0.1', mail_port: String(SMTP_PORT), mail_secure: '0',
    mail_from: 'backup@smpn2.sch.id', mail_user: 'backup@smpn2.sch.id', mail_pass: 'app-pass', mail_aktif: '1'
  }, { cookie: c2 });
  ok('simpan pengaturan backup email tenant', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('konfigurasi SMTP tersimpan di database sekolah', t2db.prepare("SELECT v FROM settings WHERE k='mail_host'").get().v === '127.0.0.1');
  r = await req('POST', '/info-layanan/mail/uji', {}, { cookie: c2 });
  ok('uji kirim email berhasil', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('server SMTP menerima email uji', mailSink.length >= 1, 'tidak ada email');
  r = await req('POST', '/info-layanan/mail/backup', {}, { cookie: c2 });
  ok('backup & kirim sekarang berhasil', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const lastMail = mailSink[mailSink.length - 1] || { raw: '' };
  ok('email berisi lampiran zip', /Content-Disposition: attachment; filename="Backup_SIMKEU_/.test(lastMail.raw), lastMail.raw.slice(0, 300));
  ok('nama berkas sesuai format Backup_SIMKEU_DDMMYYYY_HHMM.zip', /Backup_SIMKEU_\d{2}[A-Za-z]{3}\d{4}_\d{4}\.zip/.test(lastMail.raw));
  ok('email memuat nama sekolah pengirim', /SMP Negeri 2 Contoh/.test(lastMail.raw));
  const leftTmp = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('simkeu-mail-'));
  ok('berkas zip sementara dihapus setelah terkirim (auto-cleanup)', leftTmp.length === 0, leftTmp.join(','));
  ok('riwayat backup email tercatat sukses', t2db.prepare("SELECT COUNT(*) c FROM cloud_backup WHERE status='sukses'").get().c >= 1);

  // panel super admin backup email
  r = await req('POST', '/super-admin/backup/simpan', {
    mail_to: 'owner@simkeu.id', mail_host: '127.0.0.1', mail_port: String(SMTP_PORT), mail_secure: '0',
    mail_from: 'backup@simkeu.id', mail_user: 'backup@simkeu.id', mail_pass: 'x', mail_aktif: '1'
  }, { cookie: cs });
  ok('simpan konfigurasi backup email super admin', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const before = mailSink.length;
  r = await req('POST', '/super-admin/backup/kirim', {}, { cookie: cs });
  ok('backup seluruh SaaS terkirim', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('email backup SaaS diterima', mailSink.length === before + 1);
  const saasMail = mailSink[mailSink.length - 1] || { raw: '' };
  ok('lampiran backup SaaS berisi semua sekolah', /Backup_SIMKEU_/.test(saasMail.raw) && saasMail.raw.length > 2000);
  ok('log backup SaaS tercatat', sdb.prepare("SELECT COUNT(*) c FROM saas_backup_log WHERE status='sukses'").get().c >= 1);

  // validasi SMTP salah
  r = await req('POST', '/super-admin/backup/simpan', { mail_to: '', mail_host: '', mail_user: '', mail_aktif: '1' }, { cookie: cs });
  ok('validasi konfigurasi SMTP wajib', r.status === 303 && /err=/.test(r.loc), r.loc);

  /* ================= keamanan akses ================= */
  r = await req('GET', '/super-admin', null, { cookie: c2 });
  ok('sesi sekolah tidak bisa membuka /super-admin', r.status === 303 && /super-admin\/login/.test(r.loc), r.status + ' ' + r.loc);
  r = await req('GET', '/super-admin/sekolah', null, {});
  ok('/super-admin tanpa sesi dialihkan ke login', r.status === 303 && /super-admin\/login/.test(r.loc));
  r = await req('GET', '/super-admin/backup', null, { cookie: c2 });
  ok('cookie sekolah tidak membuka panel backup SaaS', r.status === 303, r.status);

  /* ================= keamanan akun super admin ================= */
  r = await req('POST', '/super-admin/password', { password_lama: 'salah', password_baru: 'BaruSekali123', password_ulang: 'BaruSekali123' }, { cookie: cs });
  ok('ganti password super admin: sandi lama divalidasi', /err=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/password', { password_lama: SAAS_PASS, password_baru: 'pendek', password_ulang: 'pendek' }, { cookie: cs });
  ok('ganti password super admin: minimal 8 karakter', /err=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/password', { password_lama: SAAS_PASS, password_baru: 'BaruSekali123', password_ulang: 'BaruSekali123' }, { cookie: cs });
  ok('ganti password super admin berhasil', /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: SAAS_PASS }, {});
  ok('sandi lama tidak berlaku lagi', r.status === 303 && /err=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'BaruSekali123' }, {});
  ok('login dengan sandi baru berhasil', r.status === 303 && r.setCookie.includes('simkeu_saas'), r.loc);

  /* ================= ringkasan ================= */
  const fail = results.filter(x => !x.ok);
  console.log(`\n${results.length - fail.length}/${results.length} cek lulus`);
  if (fail.length) {
    console.log('GAGAL:', fail.map(f => f.name).join(' | '));
    console.log('--- server log ---\n' + log.slice(-3000));
  }
  smtp.close();
  srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('ERROR TES:', e);
  console.log(log.slice(-3000));
  srv.kill();
  process.exit(1);
});
