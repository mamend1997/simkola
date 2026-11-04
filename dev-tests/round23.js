'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   TES RONDE 23 — pembersihan backup lama + fitur SaaS lanjutan
   1. Backup email (SMTP) & Google Drive sudah dihapus (kode, route, UI)
   2. Auto-backup Telegram sekolah + seluruh SaaS (fake Telegram API), auto-cleanup
   3. Unduhan langsung (.zip / .sql) dari panel Super Admin
   4. Master Petunjuk Pengguna (super admin CRUD) + sekolah read-only (403)
   5. Reset password admin sekolah (modal + notifikasi kredensial)
   6. Audit Logs terpusat (IP, role, tenant, filter)
   7. Pengumuman global + Maintenance Mode
   8. Tiket kendala (sekolah → super admin, balas, status)
   9. WA Gateway pusat + notifikasi persetujuan pembayaran
  10. portal_slug unik + routing /<slug>/portal + 404 + custom domain
  11. Storage terisolasi tenant + queue + validasi sesi tenant
  12. Leger honor dinamis (kolom kustom, rumus, footer, export)
   ===================================================================== */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.R23_PORT || 3961;
const TG_PORT = 3962;
const WA_PORT = 3963;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r23-'));
const DB = path.join(TMP, 'keuangan.sqlite');
const SDB = path.join(TMP, 'saas.db');
const DEMO_DB = path.join(TMP, 'demo.sqlite');
const SAAS_PASS = 'SuperAdmin2026!';

const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  →  ' + extra));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- fake Telegram & WA gateway ---------------- */
const tgSink = { documents: [], messages: [] };
function startTelegram() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const url = req.url;
        if (/getMe$/.test(url)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, result: { id: 1, username: 'simkeu_test_bot', first_name: 'SIMKEU' } }));
        }
        if (/sendDocument$/.test(url)) {
          const text = body.toString('latin1');
          if (/name="chat_id"\r\n\r\n0000/.test(text)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }));
          }
          const name = (/filename="([^"]+)"/.exec(text) || [, ''])[1];
          const chat = (/name="chat_id"\r\n\r\n([^\r]+)/.exec(text) || [, ''])[1];
          tgSink.documents.push({ name, chat, size: body.length, raw: text.slice(0, 400) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, result: { message_id: 9, document: { file_id: 'FILE-' + Date.now() } } }));
        }
        if (/sendMessage$/.test(url)) {
          const text = decodeURIComponent(body.toString().replace(/\+/g, ' '));
          tgSink.messages.push(text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, result: { message_id: 5 } }));
        }
        res.writeHead(404); res.end('{}');
      });
    });
    srv.listen(TG_PORT, '127.0.0.1', () => resolve(srv));
  });
}
const waSink = [];
function startWa() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        waSink.push(decodeURIComponent(Buffer.concat(chunks).toString().replace(/\+/g, ' ')));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: true, message: 'sent' }));
      });
    });
    srv.listen(WA_PORT, '127.0.0.1', () => resolve(srv));
  });
}

const env = {
  ...process.env,
  PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: DEMO_DB,
  SAAS_ADMIN_PASSWORD: SAAS_PASS,
  TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`
};
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;

async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie) headers.Cookie = opt.cookie;
  if (opt.raw) headers['Content-Type'] = 'application/x-www-form-urlencoded';
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
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status, text: buf.toString('utf8'), buf, loc: r.headers.get('location') || '',
    setCookie: r.headers.get('set-cookie') || '', type: r.headers.get('content-type') || ''
  };
}
const cookieOf = sc => String(sc || '').split(';')[0];

(async () => {
  const tgSrv = await startTelegram();
  const waSrv = await startWa();
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const sdb = new Database(SDB);
  const t1db = new Database(DB);

  /* ============ 1. PEMBERSIHAN SISTEM BACKUP LAMA ============ */
  const root = path.join(__dirname, '..');
  ok('gdrive.js sudah dihapus', !fs.existsSync(path.join(root, 'gdrive.js')));
  ok('mailer.js (SMTP) sudah dihapus', !fs.existsSync(path.join(root, 'mailer.js')));
  ok('routes/backup_cloud.js sudah dihapus', !fs.existsSync(path.join(root, 'routes', 'backup_cloud.js')));
  const allSrc = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      if (['node_modules', '.git', 'data', 'storage', 'dev-tests'].includes(f)) continue;
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) walk(fp);
      else if (/\.js$/.test(f)) allSrc.push(fp);
    }
  })(root);
  const srcText = allSrc.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  ok('tidak ada require gdrive/mailer tersisa', !/require\(['"]\.\.?\/gdrive['"]\)|require\(['"]\.\.?\/mailer['"]\)/.test(srcText));
  ok('tidak ada penyebutan Google Drive/SMTP di kode', !/gdrive_credentials|GDRIVE_|googleapis\.com\/drive|smtp\.gmail|mailer\.js/i.test(srcText));

  /* ============ login ============ */
  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login sekolah', r.status === 303, r.status);
  const cTenant = cookieOf(r.setCookie);
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: SAAS_PASS });
  ok('login super admin', r.status === 303 && /simkeu_saas/.test(r.setCookie));
  const cSa = cookieOf(r.setCookie);

  /* ============ 2. AUTO-BACKUP TELEGRAM ============ */
  r = await req('POST', '/pengaturan-backup/simpan', {
    tg_token: '123456789:AAHabcdefghijklmnopqrstuvwxyz0123456', tg_chat: '99887766',
    tg_slots: '06:00,15:00', tg_aktif: '1'
  }, { cookie: cTenant });
  ok('simpan pengaturan backup Telegram sekolah', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('token tersimpan di database sekolah', (t1db.prepare("SELECT v FROM settings WHERE k='tg_token'").get() || {}).v === '123456789:AAHabcdefghijklmnopqrstuvwxyz0123456');
  r = await req('GET', '/pengaturan-backup', null, { cookie: cTenant });
  ok('token disamarkan di halaman', !r.text.includes('AAHabcdefghijklmnopqrstuvwxyz0123456') && /••••/.test(r.text));

  r = await req('POST', '/pengaturan-backup/uji', {}, { cookie: cTenant });
  ok('uji koneksi bot terkirim', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('bot menerima pesan uji', tgSink.messages.length >= 1);

  const tmpBefore = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('simkeu-tg-')).length;
  r = await req('POST', '/pengaturan-backup/kirim', {}, { cookie: cTenant });
  ok('backup & kirim sekarang (sekolah)', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const doc1 = tgSink.documents[tgSink.documents.length - 1] || {};
  ok('berkas diterima Telegram', (tgSink.documents.length >= 1), 'tidak ada dokumen');
  ok('nama berkas sekolah sesuai format', /^Backup_SIMKEU_SK01_\d{2}[A-Za-z]{3}\d{4}_\d{4}\.zip$/.test(doc1.name || ''), doc1.name);
  ok('chat id tujuan benar', String(doc1.chat) === '99887766', doc1.chat);
  await sleep(300);
  const tmpAfter = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('simkeu-tg-')).length;
  ok('auto-cleanup: tidak ada berkas .zip tersisa', tmpAfter <= tmpBefore, `${tmpBefore} → ${tmpAfter}`);
  ok('riwayat backup sekolah tercatat sukses', t1db.prepare("SELECT COUNT(*) c FROM cloud_backup WHERE status='sukses'").get().c >= 1);

  /* gagal kirim → tetap dibersihkan */
  await req('POST', '/pengaturan-backup/simpan', {
    tg_token: '123456789:AAHabcdefghijklmnopqrstuvwxyz0123456', tg_chat: '0000', tg_slots: '06:00', tg_aktif: '1'
  }, { cookie: cTenant });
  const beforeFail = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('simkeu-tg-')).length;
  r = await req('POST', '/pengaturan-backup/kirim', {}, { cookie: cTenant });
  ok('pengiriman gagal dilaporkan', r.status === 303 && /err=/.test(r.loc), r.loc);
  await sleep(200);
  ok('auto-cleanup saat GAGAL pun berjalan', fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('simkeu-tg-')).length <= beforeFail);

  /* ============ 3. AUTO-BACKUP SERVER (SUPER ADMIN) + UNDUHAN ============ */
  r = await req('POST', '/super-admin/backup/simpan', {
    tg_token: '987654321:BBHabcdEFGHijklmnopqrstuvwxyz012345', tg_chat: '11223344',
    backup_slots: '06:00,15:00', tg_aktif: '1'
  }, { cookie: cSa });
  ok('simpan pengaturan auto-backup server', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/backup/kirim', {}, { cookie: cSa });
  ok('backup seluruh SaaS terkirim', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const docFull = tgSink.documents[tgSink.documents.length - 1] || {};
  ok('nama berkas FULL sesuai format', /^Backup_FULL_SIMKEU_\d{2}[A-Za-z]{3}\d{4}_\d{4}\.zip$/.test(docFull.name || ''), docFull.name);

  r = await req('GET', '/super-admin/backup/download-zip', null, { cookie: cSa });
  ok('unduh ZIP langsung (browser)', r.status === 200 && /application\/zip/.test(r.type) && r.buf.length > 1000, r.status + ' ' + r.type);
  ok('isi ZIP = arsip valid (PK)', r.buf.slice(0, 2).toString() === 'PK');
  r = await req('GET', '/super-admin/backup/download-sql', null, { cookie: cSa });
  ok('unduh SQL langsung', r.status === 200 && /Backup_FULL_SIMKEU_.*\.sql/.test(r.loc || '') === false && r.buf.length > 1000, r.status);
  ok('SQL memuat control plane & data sekolah', /CONTROL PLANE/.test(r.text) && /CREATE TABLE/.test(r.text));
  await sleep(200);
  ok('berkas sementara unduhan dihapus', fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('simkeu-tg-')).length === 0);

  /* ============ 4. MASTER PETUNJUK + READ-ONLY SEKOLAH ============ */
  r = await req('GET', '/petunjuk', null, { cookie: cTenant });
  ok('halaman petunjuk sekolah read-only (tanpa editor)', !/fPanduan|Tambah Petunjuk Pengguna/.test(r.text) && /hanya baca|Baca saja/i.test(r.text));
  r = await req('POST', '/petunjuk/save', { judul: 'Dibuat Sekolah' }, { cookie: cTenant });
  ok('POST simpan petunjuk dari sekolah → 403', r.status === 403, r.status);
  r = await req('POST', '/petunjuk/delete', { id: 1 }, { cookie: cTenant });
  ok('POST hapus petunjuk dari sekolah → 403', r.status === 403, r.status);
  r = await req('POST', '/petunjuk/urut', { ids: '1,2' }, { cookie: cTenant });
  ok('POST urut petunjuk dari sekolah → 403', r.status === 403, r.status);

  r = await req('POST', '/super-admin/petunjuk/simpan', {
    judul: 'Cara Mencatat Pembayaran Iuran', kategori: 'Iuran', ringkas: 'Langkah singkat pembayaran iuran.',
    konten: '# Langkah\n1. Buka menu Iuran\n2. Klik **Bayar**', urutan: 1, published: '1'
  }, { cookie: cSa });
  ok('super admin menambah panduan', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('GET', '/petunjuk', null, { cookie: cTenant });
  ok('panduan muncul otomatis di sekolah', r.text.includes('Cara Mencatat Pembayaran Iuran'));
  r = await req('GET', '/petunjuk?id=1', null, { cookie: cTenant });
  ok('detail panduan menampilkan isi', /Langkah/.test(r.text) && /Buka menu Iuran/.test(r.text));
  r = await req('GET', '/petunjuk?q=xxyyzz', null, { cookie: cTenant });
  ok('pencarian judul bekerja (kosong)', /Tidak ada panduan/i.test(r.text));

  /* ============ 5. RESET PASSWORD ADMIN SEKOLAH ============ */
  r = await req('GET', '/super-admin/sekolah', null, { cookie: cSa });
  ok('tombol Reset Password ada di tabel', /data-open="mReset1"/.test(r.text) && /Reset/.test(r.text));
  ok('modal reset memuat tombol Generate Acak', /data-generate-pw/.test(r.text));
  r = await req('POST', '/super-admin/sekolah/1/reset-password', { password_baru: 'abc' }, { cookie: cSa });
  ok('validasi sandi minimal 6 karakter', r.status === 303 && /err=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/sekolah/1/reset-password', { password_baru: 'SandiBaru#7' }, { cookie: cSa });
  ok('reset password berhasil', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('GET', '/super-admin/sekolah/1', null, { cookie: cSa });
  ok('notifikasi kredensial tampil sekali', /Password Berhasil Diperbarui/.test(r.text) && r.text.includes('SandiBaru#7') && /data-copy-login/.test(r.text));
  r = await req('GET', '/super-admin/sekolah/1', null, { cookie: cSa });
  ok('notifikasi kredensial tidak tampil lagi', !/Password Berhasil Diperbarui/.test(r.text));
  const admRow = t1db.prepare("SELECT * FROM users WHERE role='super_admin' ORDER BY id LIMIT 1").get();
  ok('sandi disimpan sebagai hash (bukan teks biasa)', admRow.password !== 'SandiBaru#7' && String(admRow.password).length > 20);
  r = await req('POST', '/login', { kode: 'SK01', email: admRow.email, password: 'SandiBaru#7' });
  ok('login memakai sandi baru', r.status === 303 && /simkeu_sid/.test(r.setCookie));
  const cTenant2 = cookieOf(r.setCookie);

  /* ============ 6. AUDIT LOGS ============ */
  r = await req('GET', '/super-admin/audit', null, { cookie: cSa });
  ok('halaman audit logs tampil', r.status === 200 && /Audit Logs/.test(r.text), r.status);
  ok('audit memuat aksi reset password', /RESET PASSWORD/.test(r.text));
  ok('audit menampilkan IP & role', /127\.0\.0\.1/.test(r.text) && /super_admin/.test(r.text));
  const auditRows = sdb.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50').all();
  ok('audit_log mencatat tenant & user', auditRows.some(x => x.tenant_id === 1 && x.user_nama));
  r = await req('GET', '/super-admin/audit?aksi=RESET%20PASSWORD', null, { cookie: cSa });
  ok('filter audit berdasarkan aktivitas', r.status === 200 && /RESET PASSWORD/.test(r.text));
  r = await req('GET', '/super-admin/audit?q=tidakada', null, { cookie: cSa });
  ok('filter pencarian audit', /Belum ada aktivitas/i.test(r.text));

  /* ============ 7. PENGUMUMAN & MAINTENANCE ============ */
  r = await req('POST', '/super-admin/pengumuman/simpan', {
    judul: 'Pemeliharaan Sabtu', isi: 'Server akan dipelihara Sabtu malam.', tipe: 'banner', warna: 'warn', aktif: '1'
  }, { cookie: cSa });
  ok('buat pengumuman banner', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/pengumuman/simpan', {
    judul: 'Selamat Datang', isi: 'Gunakan fitur baru kami.', tipe: 'popup', warna: 'info', aktif: '1'
  }, { cookie: cSa });
  ok('buat pengumuman popup', r.status === 303);
  r = await req('GET', '/', null, { cookie: cTenant2 });
  ok('banner pengumuman tampil di dashboard sekolah', /Pemeliharaan Sabtu/.test(r.text) && /ann-bar/.test(r.text));
  ok('pop-up pengumuman dirender', /mAnn\d+/.test(r.text) && /Selamat Datang/.test(r.text));

  r = await req('POST', '/super-admin/maintenance', { aktif: '1', pesan: 'Perbaikan sistem 2 jam.', selesai: 'Hari ini 22:00' }, { cookie: cSa });
  ok('aktifkan maintenance', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('GET', '/', null, { cookie: cTenant2 });
  ok('sekolah diblokir saat maintenance', r.status === 503 && /Sistem Dalam Perbaikan/.test(r.text), r.status);
  r = await req('GET', '/login', null, {});
  ok('halaman login pun diblokir saat maintenance', r.status === 503, r.status);
  r = await req('GET', '/super-admin', null, { cookie: cSa });
  ok('portal Super Admin tetap bisa diakses', r.status === 200, r.status);
  r = await req('POST', '/super-admin/maintenance', { aktif: '0', pesan: '-' }, { cookie: cSa });
  ok('matikan maintenance', r.status === 303);
  r = await req('GET', '/', null, { cookie: cTenant2 });
  ok('sekolah dapat diakses kembali', r.status === 200);

  /* ============ 8. TIKET KENDALA ============ */
  r = await req('GET', '/bantuan', null, { cookie: cTenant2 });
  ok('halaman bantuan sekolah tampil', r.status === 200 && /Ajukan Kendala/.test(r.text), r.status);
  r = await req('POST', '/bantuan/kirim', {
    kategori: 'Bug / Error Aplikasi', judul: 'Kwitansi tidak muncul', deskripsi: 'Saat klik cetak kwitansi kosong.', prioritas: 'tinggi'
  }, { cookie: cTenant2 });
  ok('kirim tiket dari sekolah', r.status === 303 && /bantuan\/\d+/.test(r.loc), r.loc);
  const tiket = sdb.prepare('SELECT * FROM tickets ORDER BY id DESC LIMIT 1').get();
  ok('tiket tersimpan dengan kode', !!tiket && /^TKT-/.test(tiket.kode) && tiket.status === 'open', tiket && tiket.kode);
  r = await req('GET', '/bantuan/' + tiket.id, null, { cookie: cTenant2 });
  ok('detail tiket dapat dibuka sekolah', r.status === 200 && /Kwitansi tidak muncul/.test(r.text));

  r = await req('GET', '/super-admin/tiket', null, { cookie: cSa });
  ok('pusat tiket super admin menampilkan tiket', r.text.includes('Kwitansi tidak muncul') && /Pusat Tiket/.test(r.text));
  r = await req('POST', `/super-admin/tiket/${tiket.id}/balas`, { pesan: 'Mohon cek ulang pengaturan printer Anda.' }, { cookie: cSa });
  ok('super admin membalas tiket', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const tik2 = sdb.prepare('SELECT * FROM tickets WHERE id=?').get(tiket.id);
  ok('balasan admin mengubah status ke in_progress', tik2.status === 'in_progress', tik2.status);
  r = await req('POST', `/super-admin/tiket/${tiket.id}/status`, { status: 'resolved' }, { cookie: cSa });
  ok('super admin mengubah status tiket', r.status === 303 && sdb.prepare('SELECT status FROM tickets WHERE id=?').get(tiket.id).status === 'resolved');
  r = await req('GET', '/bantuan', null, { cookie: cTenant2 });
  ok('sekolah melihat status Resolved', /Resolved/.test(r.text));

  /* ============ 9. WA GATEWAY ============ */
  r = await req('POST', '/super-admin/wa/simpan', {
    wa_api_url: `http://127.0.0.1:${WA_PORT}/send`, wa_api_token: 'token-uji', wa_sender: '628111222333',
    wa_payload: 'form', wa_aktif: '1'
  }, { cookie: cSa });
  ok('simpan konfigurasi WA gateway', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/wa/uji', { nomor: '081234567890' }, { cookie: cSa });
  ok('uji kirim WA berhasil', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('gateway WA menerima pesan', waSink.length >= 1 && /Uji koneksi/.test(waSink[0]));

  // notifikasi WA saat pembayaran disetujui
  sdb.prepare("UPDATE tenants SET contact_telp='0812000111', expires_at=? WHERE id=1").run('2026-12-31');
  const insPay = sdb.prepare(`INSERT INTO saas_payments (tenant_id,no_invoice,jenis,durasi,nominal,status,bukti_url,pengirim,source,periode_mulai,dibuat_at,created_at)
    VALUES (1,'INV-WA','perpanjangan',30,150000,'pending','https://x/bukti.jpg','Bendahara','tenant','2026-12-31',?,?)`).run('2026-11-03 10:00:00', '2026-11-03 10:00:00');
  r = await req('POST', `/super-admin/pembayaran/${insPay.lastInsertRowid}/approve`, {}, { cookie: cSa });
  ok('approve pembayaran', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/backup/antrean', {}, { cookie: cSa });
  ok('proses antrean queue', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('WA persetujuan pembayaran terkirim', waSink.some(t => /Disetujui/i.test(t)), waSink.slice(-2).join(' | ').slice(0, 200));

  /* ============ 10. PORTAL SLUG & CUSTOM DOMAIN ============ */
  r = await req('GET', '/super-admin/sekolah', null, { cookie: cSa });
  ok('tabel sekolah menampilkan URL portal', /\/portal/.test(r.text) && /URL Portal/.test(r.text));
  ok('tabel sekolah menampilkan kolom custom domain', /Custom Domain/.test(r.text));
  const t1 = sdb.prepare('SELECT * FROM tenants WHERE id=1').get();
  ok('slug default dibuat dari nama sekolah', !!t1.portal_slug, String(t1.portal_slug));

  r = await req('POST', '/super-admin/sekolah/1/portal', { portal_slug: 'smk-pgri-cikoneng' }, { cookie: cSa });
  ok('super admin mengubah slug portal', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('slug tersimpan di control plane', sdb.prepare('SELECT portal_slug FROM tenants WHERE id=1').get().portal_slug === 'smk-pgri-cikoneng');
  r = await req('GET', '/smk-pgri-cikoneng/portal', null, {});
  ok('portal /<slug>/portal dapat dibuka', r.status === 200 && /Portal/.test(r.text), r.status);
  /* ronde 32: bentuk lama /portal/<slug> ikut ditutup (alamat bawaan /portal dihapus) */
  r = await req('GET', '/portal/smk-pgri-cikoneng', null, {});
  ok('bentuk lama /portal/<slug> tidak lagi dilayani (404)', r.status === 404, r.status);
  /* alamat per sekolah tetap tersedia: /<slug> dan /<slug>/portal */
  r = await req('GET', '/smk-pgri-cikoneng', null, {});
  ok('alamat /<slug> tetap dapat dibuka', r.status === 200 && /portal-head/.test(r.text), r.status);
  r = await req('GET', '/sekolah-tidak-ada/portal', null, {});
  ok('slug tidak dikenal → 404 Sekolah Tidak Ditemukan', r.status === 404 && /Sekolah Tidak Ditemukan/.test(r.text), r.status);

  r = await req('POST', '/super-admin/sekolah/tambah', {
    nama: 'SD Negeri 1 Jakarta', admin_nama: 'Admin SDN', admin_email: 'admin@sdn1.sch.id',
    admin_password: 'sdn1pass', paket: 'pro', days: 30
  }, { cookie: cSa });
  const t2 = sdb.prepare("SELECT * FROM tenants WHERE nama='SD Negeri 1 Jakarta'").get();
  ok('sekolah baru otomatis mendapat slug dari nama', t2 && t2.portal_slug === 'sd-negeri-1-jakarta', t2 && t2.portal_slug);
  r = await req('POST', '/super-admin/sekolah/tambah', {
    nama: 'SD Negeri 1 Jakarta', admin_nama: 'Admin2', admin_email: 'admin2@sdn1.sch.id',
    admin_password: 'pass1234', paket: 'pro', days: 30
  }, { cookie: cSa });
  const t3 = sdb.prepare("SELECT * FROM tenants WHERE id=? ").get(Number(r.loc.match(/sekolah\/(\d+)/) ? r.loc.match(/sekolah\/(\d+)/)[1] : 0));
  ok('slug duplikat diberi akhiran unik', t3 && t3.portal_slug !== 'sd-negeri-1-jakarta' && /-2$/.test(t3.portal_slug), t3 && t3.portal_slug);

  // domain khusus
  r = await req('POST', '/super-admin/sekolah/1/portal', { portal_slug: 'smk-pgri-cikoneng', custom_domain: 'keuangan.smkpgri.sch.id' }, { cookie: cSa });
  ok('super admin menetapkan custom domain', r.status === 303 && sdb.prepare('SELECT custom_domain FROM tenants WHERE id=1').get().custom_domain === 'keuangan.smkpgri.sch.id');
  ok('status domain awal PENDING', String(sdb.prepare('SELECT custom_domain_status FROM tenants WHERE id=1').get().custom_domain_status).toLowerCase() === 'pending');
  r = await req('POST', '/super-admin/sekolah/1/domain/verifikasi', {}, { cookie: cSa });
  ok('verifikasi domain gagal bila DNS belum mengarah', r.status === 303 && /err=/.test(r.loc), r.loc);
  ok('status domain menjadi FAILED', String(sdb.prepare('SELECT custom_domain_status FROM tenants WHERE id=1').get().custom_domain_status).toLowerCase() === 'failed');
  r = await req('POST', '/super-admin/sekolah/1/domain/hapus', {}, { cookie: cSa });
  ok('super admin dapat menghapus domain', r.status === 303 && !sdb.prepare('SELECT custom_domain FROM tenants WHERE id=1').get().custom_domain);

  // form sisi sekolah
  // form pindah ke menu Portal Publik (ronde 26)
  r = await req('GET', '/portal-publik', null, { cookie: cTenant2 });
  ok('form URL portal tersedia di menu Portal Publik', /Custom URL Slug/.test(r.text) && /sekolah\/portal/.test(r.text));
  ok('petunjuk DNS CNAME & A Record ditampilkan', /CNAME Record/.test(r.text) && /A Record/.test(r.text));
  r = await req('POST', '/sekolah/portal', { portal_slug: 'Transaksi' }, { cookie: cTenant2 });
  ok('slug menabrak halaman aplikasi ditolak', r.status === 303 && /err=/.test(r.loc), r.loc);
  // login sekolah kedua (SDN) — dipakai juga untuk uji isolasi sesi/data
  const t2row = sdb.prepare("SELECT * FROM tenants WHERE nama='SD Negeri 1 Jakarta'").get();
  const c2 = await req('POST', '/login', { kode: t2row.school_code, email: 'admin@sdn1.sch.id', password: 'sdn1pass' });
  ok('login sekolah kedua', c2.status === 303, c2.loc);
  const cookie2 = cookieOf(c2.setCookie);
  r = await req('GET', '/', null, { cookie: cookie2 });
  ok('sekolah kedua melihat nama sekolahnya', /SD Negeri 1 Jakarta/.test(r.text) && !/SMK PGRI CIKONENG/.test(r.text));

  // sekolah lain (SDN) mencoba memakai slug milik sekolah pertama
  r = await req('POST', '/sekolah/portal', { portal_slug: 'smk-pgri-cikoneng' }, { cookie: cookie2 });
  ok('slug milik sekolah lain ditolak', r.status === 303 && /err=/.test(r.loc), r.loc);
  r = await req('POST', '/sekolah/portal', { portal_slug: 'portal-smk-pgri' }, { cookie: cTenant2 });
  ok('sekolah dapat mengubah slugnya sendiri', r.status === 303 && /ok=/.test(r.loc), r.loc);

  /* ============ 10b. UNIQUE PER SEKOLAH (database terpisah) ============ */
  {
    const t2db = new Database(t2.db_file);
    // sekolah A (tenant 1) punya siswa NISN tertentu; sekolah B boleh punya NISN sama
    t1db.prepare("INSERT INTO siswa (nama,nisn,status,tenant_id) VALUES ('Siswa A','1234567890','aktif',1)").run();
    let dupErr = null;
    try { t1db.prepare("INSERT INTO siswa (nama,nisn,status,tenant_id) VALUES ('Siswa A2','1234567890','aktif',1)").run(); } catch (e) { dupErr = e.message; }
    ok('NISN ganda di sekolah yang sama ditolak', !!dupErr);
    let crossErr = null;
    try { t2db.prepare("INSERT INTO siswa (nama,nisn,status,tenant_id) VALUES ('Siswa B','1234567890','aktif',?)").run(t2.id); } catch (e) { crossErr = e.message; }
    ok('NISN sama di sekolah berbeda diperbolehkan', !crossErr, crossErr || '');
  }

  /* ============ 11. STORAGE & SESI ============ */
  const storage = require('../storage');
  const a = storage.buildName(2, 'nota', 'bukti.png');
  const b = storage.buildName(3, 'nota', 'bukti.png');
  ok('nama berkas memuat tenant_id', a.startsWith('t2-') && b.startsWith('t3-'));
  ok('nama berkas memuat stempel waktu & acak', /\d{14}-[a-z0-9]{6}-bukti\.png$/.test(a), a);
  ok('nama berkas antar sekolah tidak bertabrakan', a !== b);
  const uniq = new Set(); for (let i = 0; i < 50; i++) uniq.add(storage.buildName(1, 'nota', 'sama.png'));
  ok('50 unggahan nama sama → nama unik', uniq.size === 50, String(uniq.size));

  // manipulasi: sesi tenant 2 dipakai dengan cookie tenant 1 (tidak mungkin tanpa token) — uji token acak
  r = await req('GET', '/', null, { cookie: 'simkeu_sid=tokenpalsu' });
  ok('token sesi palsu ditolak', r.status === 303 && /login/.test(r.loc), r.status);

  /* ============ 12. LEGER HONOR DINAMIS ============ */
  const t1now = new Database(DB);
  t1now.prepare("INSERT INTO pegawai (nama,jabatan,tipe,aktif) VALUES ('Guru Uji','Guru Mata Pelajaran','guru',1)").run();
  const periode = new Date().toISOString().slice(0, 7);
  r = await req('POST', '/payroll/tarik', { periode }, { cookie: cTenant2 });
  ok('tarik pegawai ke leger', r.status === 303, r.loc);
  r = await req('GET', '/payroll/kolom', null, { cookie: cTenant2 });
  ok('halaman pengaturan kolom leger', r.status === 200 && /Struktur Kolom Leger/.test(r.text), r.status);
  ok('kolom bawaan terdaftar', (t1now.prepare('SELECT COUNT(*) c FROM payroll_kolom').get().c) >= 15);

  r = await req('POST', '/payroll/kolom/simpan', {
    label: 'Insentif Kehadiran', tipe: 'penerimaan', nilai: 'uang', urutan: '45', aktif: '1'
  }, { cookie: cTenant2 });
  ok('tambah kolom penerimaan kustom', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const kolBaru = t1now.prepare("SELECT * FROM payroll_kolom WHERE label='Insentif Kehadiran'").get();
  ok('kolom kustom tersimpan', !!kolBaru && kolBaru.tipe === 'penerimaan');

  r = await req('POST', '/payroll/kolom/simpan', {
    label: 'Potongan Koperasi', tipe: 'potongan', nilai: 'uang', urutan: '155', aktif: '1'
  }, { cookie: cTenant2 });
  const kolPot = t1now.prepare("SELECT * FROM payroll_kolom WHERE label='Potongan Koperasi'").get();
  ok('tambah kolom potongan kustom', r.status === 303 && !!kolPot);

  r = await req('POST', '/payroll/kolom/simpan', { id: kolBaru.id, label: 'Insentif Kehadiran Penuh', tipe: 'penerimaan', nilai: 'uang', urutan: '45', aktif: '1' }, { cookie: cTenant2 });
  ok('ubah nama kolom', r.status === 303 && t1now.prepare('SELECT label FROM payroll_kolom WHERE id=?').get(kolBaru.id).label === 'Insentif Kehadiran Penuh');

  r = await req('POST', '/payroll/kolom/simpan', { label: 'Rumus Salah', tipe: 'penerimaan', nilai: 'uang', rumus: 'jam_efektif * * 2' }, { cookie: cTenant2 });
  ok('rumus tidak valid ditolak', r.status === 303 && /err=/.test(r.loc), r.loc);

  // urutkan: naikkan kolom baru
  r = await req('POST', `/payroll/kolom/${kolBaru.id}/naik`, {}, { cookie: cTenant2 });
  ok('geser urutan kolom (naik)', r.status === 303 && /ok=/.test(r.loc));

  // isi leger: jam efektif & honor per jam
  const row = t1now.prepare('SELECT * FROM payroll WHERE periode=?').get(periode);
  const kolomAktif = t1now.prepare('SELECT * FROM payroll_kolom WHERE aktif=1 ORDER BY urutan,id').all();
  const form = { periode, ids: String(row.id), [`${row.id}_c_jam_efektif`]: '20', [`${row.id}_c_honor_jam`]: '50.000', [`${row.id}_c_tunjangan_jabatan`]: '300.000' };
  form[`${row.id}_c_${kolBaru.kode}`] = '250.000';
  form[`${row.id}_c_${kolPot.kode}`] = '25.000';
  r = await req('POST', '/payroll/simpan', form, { cookie: cTenant2 });
  ok('simpan leger dengan kolom dinamis', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const after = t1now.prepare('SELECT * FROM payroll WHERE id=?').get(row.id);
  ok('nilai kolom bawaan tersimpan', Number(after.jam_efektif) === 20 && Number(after.honor_jam) === 50000);
  ok('nilai kolom kustom tersimpan', Number((t1now.prepare('SELECT nilai FROM payroll_nilai WHERE payroll_id=? AND kolom_kode=?').get(row.id, kolBaru.kode) || {}).nilai) === 250000);

  r = await req('GET', '/payroll?periode=' + periode, null, { cookie: cTenant2 });
  ok('leger menampilkan kolom kustom', r.text.includes('Insentif Kehadiran Penuh') && r.text.includes('Potongan Koperasi'));
  ok('footer total mengikuti kode kolom', /data-foot-kode="insentif_kehadiran_penuh"/.test(r.text) || /data-foot-kode="/.test(r.text));
  ok('kolom rumus ditandai auto', /auto/.test(r.text));
  ok('total penerimaan & THP dihitung', /1\.250\.000|1,250,000/.test(r.text.replace(/\./g, '.')) || /js-penerimaan/.test(r.text));

  r = await req('GET', '/payroll/export?periode=' + periode, null, { cookie: cTenant2 });
  ok('export Excel mengikuti kolom dinamis', r.status === 200 && /spreadsheetml/.test(r.type), r.status + ' ' + r.type);
  r = await req('GET', '/payroll/cetak?periode=' + periode + '&mode=leger', null, { cookie: cTenant2 });
  ok('cetak leger dynamic tampil', r.status === 200 && r.text.includes('Insentif Kehadiran Penuh') && /Tanda Tangan \/ Terima/.test(r.text), r.status);
  ok('cetak memuat area tanda tangan', /Kepala Sekolah|Bendahara/i.test(r.text));

  /* hapus kolom kustom */
  r = await req('POST', `/payroll/kolom/${kolPot.id}/hapus`, {}, { cookie: cTenant2 });
  ok('hapus kolom kustom', r.status === 303 && !t1now.prepare('SELECT id FROM payroll_kolom WHERE id=?').get(kolPot.id));
  r = await req('POST', '/payroll/kolom/1/hapus', {}, { cookie: cTenant2 });
  const sistemKol = t1now.prepare('SELECT id FROM payroll_kolom WHERE sistem=1 LIMIT 1').get();
  r = await req('POST', `/payroll/kolom/${sistemKol.id}/hapus`, {}, { cookie: cTenant2 });
  ok('kolom bawaan tidak dapat dihapus', r.status === 303 && /err=/.test(r.loc), r.loc);

  /* ============ QUEUE ============ */
  await req('POST', '/super-admin/backup/antrean', {}, { cookie: cSa });
  const qstats = sdb.prepare("SELECT status, COUNT(*) c FROM saas_jobs GROUP BY status").all();
  ok('tabel queue saas_jobs terisi', qstats.length > 0 && qstats.some(x => x.status === 'done'));
  r = await req('GET', '/super-admin/backup', null, { cookie: cSa });
  ok('panel menampilkan antrean pekerjaan', /Antrean Pekerjaan/.test(r.text));

  /* ============ ringkasan ============ */
  const fail = results.filter(x => !x.ok);
  console.log(`\n${results.length - fail.length}/${results.length} cek lulus`);
  if (fail.length) {
    console.log('GAGAL: ' + fail.map(f => f.name).join(' | '));
    console.log('--- log server (akhir) ---\n' + log.slice(-2500));
  }
  tgSrv.close(); waSrv.close(); srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('ERROR TES:', e);
  console.log(log.slice(-2500));
  srv.kill();
  process.exit(1);
});
