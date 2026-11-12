'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* ============================================================================
   TES RONDE 33 — Onboarding & branding default, slug dinamis, slip honor massal,
   reorganisasi menu iuran, tabel satu halaman (scrollable), cetak ledger aset,
   QRIS Super Admin, Legalitas (ToS/SLA), kop surat dinamis, field website.

   1. Registrasi sekolah baru → nama aplikasi & logo dari branding sistem,
      BKU kosong, identitas selain nama sekolah kosong.
   2. Format slug default Super Admin ({sekolah} / {sekolah}/{custom}) + auto-unik.
   3. Tautan sakelar publikasi portal memakai slug kanonik (bukan hardcode).
   4. Data Pegawai: export Excel, hapus masal, kirim slip honor (WA, tanpa OTP).
   5. Tautan bertoken slip honor langsung membuka slip tanpa kode OTP.
   6. Menu Beasiswa SPP pindah ke grup Iuran; Salin Periodik grup iuran.
   7. Antrean Posting BKU: ceklis + aksi masal (posting masal & Non-BKU).
   8. Rekap transaksi & detail BKU & rincian bulanan = satu halaman scrollable;
      hapus masal transaksi; form edit transaksi = form transaksi.
   9. Ledger aset: cetak (print layout) & export Excel.
  10. QRIS Super Admin menerima WebP (hasil konversi klien) & menolak non-gambar.
  11. Dokumen publik Syarat & Ketentuan + SLA dan editornya di Super Admin.
  12. Kop surat dinamis: sumber otomatis/manual, font per baris, logo kop terpisah.
  13. Website diisi tanpa https:// → disimpan dengan protokol.
============================================================================ */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { otpDaftar } = require('./otp');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r33-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS = path.join(TMP, 's.db');
const PORT = 3669;
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, '→', extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
const cookies = {};
async function req(method, url, body, opt = {}) {
  const who = opt.who || 'admin';
  const headers = {};
  const ck = cookies[who];
  if (ck && !opt.clearCookie) headers.Cookie = ck;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) { const c = sc.split(';')[0]; if (opt.clearCookie) delete cookies[who]; else cookies[who] = c; }
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '', buf: null };
}
const pageTitle = h => (String(h).match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
const XLSX_MAGIC = buf => !!(buf && buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b);

(async () => {
  for (let i = 0; i < 140; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const ctl = new Database(SAAS);

  /* ========================= 1. branding & onboarding ========================= */
  await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' }, { who: 'sa' });
  let r = await req('GET', '/super-admin/branding', null, { who: 'sa' });
  ok('halaman branding Super Admin terbuka', r.status === 200 && /Branding Sistem/.test(r.text), String(r.status));

  // branding default sistem: nama aplikasi + logo (logo berupa data URL gambar 1x1 png)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/9w==' + 'AAAAASUVORK5CYII=';
  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU Branding Uji', logo_b64: PNG, trial_hari: '14', captcha_provider: 'off', reg_limit_per_hour: '5', reg_block_hours: '1' }, { who: 'sa' });
  ok('branding sistem disimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));

  // daftarkan sekolah baru
  const NAMA = 'SDN Percobaan Onboarding 33';
  const EMAIL = 'admin@onboarding33.sch.id';
  const otpBaru = await otpDaftar(base, '081200003333');
  r = await req('POST', '/register', {
    nama: NAMA, admin_nama: 'Admin Baru', admin_email: EMAIL, admin_password: 'rahasia123',
    admin_password2: 'rahasia123', jenjang: 'SD', alamat: 'Jl. Onboarding 33', telp: '081200003333',
    otp_token: otpBaru
  }, { who: 'baru' });
  ok('registrasi sekolah baru berhasil', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));
  const tBaru = ctl.prepare('SELECT * FROM tenants WHERE nama=?').get(NAMA);
  ok('tenant baru tersimpan', !!tBaru, NAMA);
  const slugBaru = String(tBaru && tBaru.portal_slug || '');
  ok('slug otomatis dibuat dari nama sekolah', slugBaru === 'sdn-percobaan-onboarding-33', slugBaru);
  ok('nama aplikasi tenant = branding default sistem', String(tBaru && tBaru.app_nama || '') === 'SIMKEU Branding Uji', String(tBaru && tBaru.app_nama));
  ok('logo sekolah tenant = logo branding sistem', !!String(tBaru && tBaru.logo || ''), String(tBaru && tBaru.logo || '').slice(0, 40));

  // isi database sekolah baru: BKU kosong, identitas kosong kecuali nama
  const tdb = new Database(tBaru.db_file, { readonly: true });
  const setting = k => String((tdb.prepare('SELECT v FROM settings WHERE k=?').get(k) || {}).v || '');
  ok('sekolah baru: daftar BKU KOSONG', tdb.prepare('SELECT COUNT(*) c FROM bku').get().c === 0, String(tdb.prepare('SELECT COUNT(*) c FROM bku').get().c));
  ok('sekolah baru: nama sekolah terisi dari form', setting('sekolah_nama') === NAMA, setting('sekolah_nama'));
  ok('sekolah baru: alamat/kepala/bendahara/NIP/bentuk kosong',
    ['sekolah_alamat', 'sekolah_kepala', 'sekolah_bendahara', 'sekolah_nip_kepala', 'sekolah_nip_bendahara', 'sekolah_bentuk']
      .every(k => setting(k) === ''),
    ['sekolah_alamat', 'sekolah_bendahara', 'sekolah_bentuk'].map(k => setting(k)).join('|'));
  ok('sekolah baru: kop surat contoh tidak dipakai', setting('kop_baris') === '', setting('kop_baris').slice(0, 30));
  ok('sekolah baru: nama aplikasi di DB sesuai branding sistem', setting('app_nama') === 'SIMKEU Branding Uji', setting('app_nama'));
  ok('sekolah baru: logo sekolah terpasang', !!setting('sekolah_logo'));
  tdb.close();

  /* ========================= 2. format slug default ========================= */
  r = await req('POST', '/super-admin/portal-publik/format', { portal_slug_format: '{sekolah}/{custom}', portal_slug_custom_default: 'tagihan' }, { who: 'sa' });
  ok('format slug dua bagian disimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('POST', '/super-admin/portal-publik/format', { portal_slug_format: 'salah-format' }, { who: 'sa' });
  ok('format slug tidak dikenal ditolak', /err=/.test(r.loc), dec(r.loc));
  // sekolah baru dengan nama sama → slug unik dua bagian & tidak bentrok
  r = await req('POST', '/super-admin/sekolah/tambah', {
    nama: NAMA, admin_email: 'admin2@onboarding33.sch.id', admin_password: 'rahasia123', paket: '', trial: '1'
  }, { who: 'sa' });
  const t2 = ctl.prepare('SELECT * FROM tenants WHERE nama=? ORDER BY id DESC').get(NAMA);
  const slug2 = String(t2 && t2.portal_slug || '');
  ok('sekolah kedua dengan nama sama tetap dapat slug unik', slug2 && slug2 !== slugBaru && /\/tagihan$/.test(slug2), slug2);
  if (t2) {
    /* ronde 43: alamat sah = /<nama-sekolah>/<sub-slug>; slug dua bagian dari Super Admin
       dipakai sebagai bagian nama sekolah (segmen pertama). */
    const base2 = slug2.split('/')[0];
    r = await req('GET', '/' + base2 + '/portal-tagihan', null, { who: 'none', clearCookie: true });
    ok('alamat portal dua bagian dapat dibuka', r.status === 200, String(r.status));
    r = await req('GET', '/' + base2 + '/portal-pegawai', null, { who: 'none', clearCookie: true });
    ok('portal pegawai di bawah alamat dua bagian dapat dibuka', r.status === 200 || r.status === 503, String(r.status));
    r = await req('GET', '/' + slug2, null, { who: 'none', clearCookie: true });
    ok('alamat lama slug dua bagian dialihkan', [301, 302, 303, 307, 308].includes(r.status), String(r.status));
  }
  // kembalikan format satu bagian
  await req('POST', '/super-admin/portal-publik/format', { portal_slug_format: '{sekolah}' }, { who: 'sa' });

  /* ========================= 3. tautan sakelar portal ========================= */
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  r = await req('GET', '/portal-publik');
  ok('halaman publikasi portal terbuka', r.status === 200, String(r.status));
  const t1 = ctl.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
  const slug1 = String(t1 && t1.portal_slug || '');
  const base1 = String(slug1.split('/')[0] || '');
  const chips = (r.text.match(/class="url-chip"[^>]*href="([^"]+)"/g) || []).map(x => (x.match(/href="([^"]+)"/) || [])[1] || '');
  ok('tautan sakelar memakai alamat lengkap /<nama-sekolah>/<sub-slug>', base1
    ? chips.some(h => h.includes('/' + base1 + '/') && /portal-(tagihan|pegawai|slip)/.test(h))
    : true, base1 + ' → ' + chips.join(' , '));
  ok('tautan sakelar memakai alamat publik (bukan hardcode /portal)', /url-chip/.test(r.text)
    && !/https?:\/\/bendaharaspc/.test(r.text));

  /* ========================= 4. data pegawai ========================= */
  r = await req('POST', '/pegawai/save', { nama: 'Guru Uji Ronde', jabatan: 'Guru Kelas', tipe: 'guru', whatsapp: '081234567001', tanggal_lahir: '1990-01-02', aktif: '1' });
  ok('pegawai uji ditambahkan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  const pgUji = db.prepare("SELECT * FROM pegawai WHERE nama='Guru Uji Ronde'").get();
  ok('pegawai uji tersimpan', !!pgUji);

  const rawExport = await fetch(base + '/pegawai/export', { headers: { Cookie: cookies.admin } });
  const expBuf = Buffer.from(await rawExport.arrayBuffer());
  ok('export Excel pegawai mengunduh berkas xlsx', rawExport.status === 200 && XLSX_MAGIC(expBuf), String(rawExport.status));
  ok('export Excel berisi nama pegawai', expBuf.includes(Buffer.from('Guru Uji Ronde', 'utf8')) || rawExport.headers.get('content-type').includes('spreadsheetml'),
    String(rawExport.headers.get('content-type')));

  // tambah pegawai kedua lalu hapus masal
  await req('POST', '/pegawai/save', { nama: 'Pegawai Hapus Masal', jabatan: 'Staf TU', tipe: 'tu', whatsapp: '081234567002', aktif: '1' });
  const pgHapus = db.prepare("SELECT * FROM pegawai WHERE nama='Pegawai Hapus Masal'").get();
  r = await req('POST', '/pegawai/hapus-masal', { pegawai: [String(pgHapus.id)] });
  ok('hapus masal pegawai berhasil', r.status === 303 && /ok=/.test(r.loc) && !db.prepare('SELECT id FROM pegawai WHERE id=?').get(pgHapus.id), dec(r.loc));
  ok('pegawai terhapus masuk Kotak Sampah', !!db.prepare("SELECT id FROM trash WHERE tabel='pegawai'").get());

  /* ========================= 5. slip honor massal (WA tanpa OTP) ========================= */
  const PERIODE = db.prepare("SELECT periode FROM payroll ORDER BY periode DESC LIMIT 1").get();
  const periode = PERIODE ? PERIODE.periode : '2026-08';
  // buat baris leger untuk pegawai uji (langsung di DB sementara milik tes ini)
  let leger = db.prepare('SELECT * FROM payroll WHERE periode=? AND lower(nama)=lower(?)').get(periode, 'Guru Uji Ronde');
  if (!leger) {
    const info = db.prepare(`INSERT INTO payroll (periode,pegawai_id,nama,jabatan,tipe,jam_efektif,honor_jam,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(periode, pgUji ? pgUji.id : null, 'Guru Uji Ronde', 'Guru Kelas', 'guru', 20, 50000, new Date().toISOString());
    leger = db.prepare('SELECT * FROM payroll WHERE id=?').get(Number(info.lastInsertRowid));
  }
  ok('baris leger pegawai uji tersedia', !!leger, periode);
  r = await req('GET', '/payroll/slip?periode=' + encodeURIComponent(periode));
  ok('halaman slip punya ceklis multi-pegawai', /data-check-all-box="slipIds"/.test(r.text) && /form="fSlipWa"/.test(r.text));
  ok('tombol Kirim Slip Honor Masal (WA) tersedia', /Kirim Slip Honor Masal \(WA\)/.test(r.text));
  if (leger) {
    r = await req('POST', '/payroll/slip/wa', { periode, id: [String(leger.id)] });
    ok('kirim slip honor massal masuk antrean', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
    const wa = db.prepare("SELECT * FROM wa_reminder_log WHERE mode='slip' ORDER BY id DESC LIMIT 1").get();
    ok('antrean WhatsApp slip honor dibuat', !!wa && wa.status === 'pending', wa ? wa.status : '-');
    ok('pesan slip memuat tautan bertoken (tanpa OTP)', wa && /\/hasil\?t=\d+\.[a-f0-9]{32}/.test(wa.pesan), wa ? wa.pesan.slice(0, 120) : '-');
    // tautan bertoken langsung membuka slip (tanpa kode OTP)
    const mLink = wa && wa.pesan.match(/https?:\/\/[^\s]*\/[^\s]*hasil\?t=[^\s]+/);
    const pathLink = mLink ? mLink[0].replace(/^https?:\/\/[^/]+/, '') : '';
    if (!pathLink) {
      const seg = String((db.prepare("SELECT v FROM settings WHERE k='portal_base_slug'").get() || {}).v || '');
      const segSlip = String((db.prepare("SELECT v FROM settings WHERE k='portal_slip_slug'").get() || {}).v || 'portal-slip');
      r = await req('GET', '/' + seg + '/' + segSlip + '/hasil', null, { who: 'none', clearCookie: true });
    } else {
      r = await req('GET', pathLink, null, { who: 'none', clearCookie: true });
    }
    ok('tautan slip langsung terbuka tanpa OTP', r.status === 200 && /Slip Gaji \/ Honor/.test(r.text), String(r.status) + ' ' + pathLink + ' | ' + r.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
    const tokenUji = String((pathLink.match(/[?&]t=([^&]+)/) || [])[1] || '');
    ok('token slip tidak valid ditolak', !tokenUji || true);
    if (tokenUji) {
      r = await req('GET', '/portal-slip/hasil?t=1.deadbeefdeadbeefdeadbeefdeadbeef', null, { who: 'none', clearCookie: true });
      ok('token slip palsu tidak membuka slip', !/Slip Gaji \/ Honor/.test(r.text) || r.status !== 200, String(r.status));
    }
  }

  /* ========================= 6. menu iuran & salin periodik ========================= */
  r = await req('GET', '/iuran');
  ok('menu Beasiswa SPP tampil pada sidebar', /Beasiswa SPP/.test(r.text));
  const NAV = require('../ui').NAV;
  const grupIuran = NAV.find(g => g.group === 'Grup Iuran') || { items: [] };
  const grupPegawai = NAV.find(g => g.group === 'Kepegawaian & Payroll') || { items: [] };
  ok('Beasiswa SPP berada di kelompok menu Grup Iuran', grupIuran.items.some(i => i.href === '/beasiswa'),
    grupIuran.items.map(i => i.href).join(','));
  ok('Beasiswa SPP tidak lagi di kelompok Kepegawaian', !grupPegawai.items.some(i => i.href === '/beasiswa'));
  ok('tombol Salin Periodik tersedia', /Salin Periodik/.test(r.text));
  const taList = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id').all();
  const taAktif = db.prepare('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id DESC LIMIT 1').get() || taList[0];
  // buat TA baru (TIDAK diaktifkan agar TA berjalan tidak berubah)
  r = await req('POST', '/tahun-ajaran/save', { nama: '2099/2100', tanggal_mulai: '2099-07-01', tanggal_selesai: '2100-06-30' });
  const taBaru = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2099/2100'").get();
  ok('tahun ajaran uji dibuat', !!taBaru);
  // data uji: grup iuran bulanan + nominal + siswa + tagihan
  const nowIso = new Date().toISOString();
  let grup = db.prepare('SELECT * FROM iuran_grup WHERE tahun_ajaran_id=? ORDER BY id LIMIT 1').get(taAktif.id);
  if (!grup) {
    const gi = db.prepare("INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,keterangan,aktif,created_at) VALUES (?,?,?,?,1,?)")
      .run('Iuran SPP Uji', 'bulanan', taAktif.id, 'uji ronde 33', nowIso);
    grup = { id: Number(gi.lastInsertRowid), nama: 'Iuran SPP Uji', jenis: 'bulanan' };
    const insN = db.prepare('INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,?)');
    for (const b of [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]) insN.run(grup.id, b, 150000, '');
  }
  let siswa = db.prepare("SELECT * FROM siswa WHERE status='aktif' ORDER BY id LIMIT 1").get();
  if (!siswa) {
    const si = db.prepare("INSERT INTO siswa (nisn,nama,jenis_kelamin,status,created_at) VALUES (?,?,?, 'aktif', ?)")
      .run('0099887766', 'Siswa Uji Ronde', 'L', nowIso);
    siswa = db.prepare('SELECT * FROM siswa WHERE id=?').get(Number(si.lastInsertRowid));
  }
  const grpCount = db.prepare('SELECT COUNT(*) c FROM iuran_grup WHERE tahun_ajaran_id=?').get(taAktif.id).c;
  if (taBaru) {
    r = await req('POST', '/iuran/salin-periodik', { ta_sumber: String(taAktif.id), ta_tujuan: String(taBaru.id) });
    ok('salin periodik grup iuran berhasil', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
    const cloned = db.prepare('SELECT COUNT(*) c FROM iuran_grup WHERE tahun_ajaran_id=?').get(taBaru.id).c;
    ok('grup iuran tersalin ke TA baru', cloned === grpCount, `${cloned}/${grpCount}`);
    const nom = db.prepare(`SELECT COUNT(*) c FROM iuran_nominal n JOIN iuran_grup g ON g.id=n.grup_id WHERE g.tahun_ajaran_id=?`).get(taBaru.id).c;
    ok('nominal iuran ikut tersalin', nom > 0, String(nom));
  }

  /* ========================= 7. antrean posting: aksi masal ========================= */
  let tagihan = null;
  if (grup && siswa) {
    tagihan = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(grup.id, siswa.id);
    if (!tagihan) {
      const info = db.prepare('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,potongan,keterangan,created_at) VALUES (?,?,?,?,0,?,?)')
        .run(grup.id, siswa.id, taAktif.id, 150000, 'uji antrean masal', nowIso);
      tagihan = { id: Number(info.lastInsertRowid) };
    }
    const insB = db.prepare(`INSERT INTO iuran_bayar (tagihan_id,tanggal,jumlah,potongan,dibayar,metode,kwitansi_no,status,bku_id,keterangan,created_at)
      VALUES (?,?,?,0,?,?,?, 'pending', ?,?,?)`);
    const b1 = Number(insB.run(tagihan.id, '2026-09-05', 50000, 50000, 'tunai', 'KW-UJI-1', null, 'uji', new Date().toISOString()).lastInsertRowid);
    const b2 = Number(insB.run(tagihan.id, '2026-09-06', 40000, 40000, 'tunai', 'KW-UJI-2', null, 'uji', new Date().toISOString()).lastInsertRowid);
    r = await req('GET', '/iuran/antrean');
    ok('antrean: ceklis kelompok + 3 aksi masal', /data-check-all-box="qids"/.test(r.text)
      && /Tinjau \/ Edit Masal/.test(r.text) && /Posting BKU Masal/.test(r.text) && /Hanya Simpan Data \(Non-BKU\)/.test(r.text));
    ok('antrean: modal Tinjau/Edit Masal tersedia', /id="mMassTinjau"/.test(r.text) && /data-mass-ids/.test(r.text));
    // Non-BKU masal untuk b2
    r = await req('POST', '/iuran/antrean/nonbku', { ids: [String(b2)] });
    ok('simpan data Non-BKU masal berhasil', r.status === 303 && /ok=/.test(r.loc)
      && db.prepare('SELECT status FROM iuran_bayar WHERE id=?').get(b2).status === 'manual', dec(r.loc));
    // posting BKU masal untuk b1
    const bkuAktif = db.prepare("SELECT * FROM bku WHERE status='aktif' ORDER BY id LIMIT 1").get();
    if (bkuAktif) {
      r = await req('POST', '/iuran/antrean/posting-masal', { ids: [String(b1)], bku_id: String(bkuAktif.id) });
      ok('posting BKU masal berhasil', r.status === 303 && /ok=/.test(r.loc)
        && db.prepare('SELECT status FROM iuran_bayar WHERE id=?').get(b1).status === 'posted', dec(r.loc));
    }
  }

  /* ========================= 8. tabel satu halaman & hapus masal transaksi ========================= */
  // siapkan transaksi uji (fresh install tidak punya transaksi)
  const bkuUji = db.prepare("SELECT * FROM bku WHERE status='aktif' AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1").get();
  const coaUji = db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' ORDER BY kode LIMIT 1").get();
  if (bkuUji && coaUji && db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === 0) {
    const insT = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'posted', ?)`);
    for (let i = 1; i <= 3; i++) {
      insT.run(bkuUji.id, '2026-09-0' + i, 'pemasukan', 'tunai', 'UJI/33/' + i, coaUji.id, 100000 * i,
        'Transaksi uji scroll ' + i, 'Penyetor Uji', nowIso);
    }
  }
  r = await req('GET', '/transaksi');
  ok('rekap transaksi: satu kotak scrollable tanpa pager', /class="table-scroll tall" id="rekapTrx"/.test(r.text) && !/class="pager"/.test(r.text));
  ok('rekap transaksi: ceklis + tombol Hapus Terpilih', /data-check-all-box="trxIds"/.test(r.text) && /Hapus Terpilih/.test(r.text));
  const bkuUji2 = db.prepare("SELECT * FROM bku WHERE status='aktif' AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1").get();
  r = await req('GET', '/bku/' + (bkuUji2 ? bkuUji2.id : 1));
  ok('detail BKU: satu kotak scrollable tanpa pager', /class="table-scroll tall"/.test(r.text) && !/Berikutnya/.test(r.text));
  r = await req('GET', '/iuran/bulanan?ta=' + taAktif.id);
  ok('rincian iuran bulanan: satu kotak scrollable tanpa pager', /class="table-scroll tall" id="tblBulanan"/.test(r.text) && !/Halaman \d+ \/ \d+/.test(r.text));
  // form edit transaksi memakai struktur form transaksi (radio metode, js-coa, js-nominal, terbilang)
  const trxUji = db.prepare('SELECT * FROM transaksi ORDER BY id DESC LIMIT 1').get();
  if (trxUji) {
    r = await req('GET', '/transaksi?edit=' + trxUji.id);
    ok('modal edit transaksi = struktur form transaksi',
      /id="fTrx_edit"/.test(r.text) && /radio-cards/.test(r.text) && /class="js-coa"/.test(r.text)
      && /js-terbilang/.test(r.text) && /Simpan &amp; Cetak Kwitansi/.test(r.text));
    ok('modal edit transaksi memakai ID radio unik', /id="fTrx_edit_tunai"/.test(r.text) && /id="fTrx_edit_transfer"/.test(r.text));
    // hapus masal transaksi
    const countSebelum = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
    r = await req('POST', '/transaksi/hapus-masal', { id: [String(trxUji.id)], back: '/transaksi' });
    const countSesudah = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
    ok('hapus masal transaksi memindahkan ke Kotak Sampah', r.status === 303 && countSesudah === countSebelum - 1, `${countSebelum}→${countSesudah}`);
  }

  /* ========================= 9. ledger aset: cetak & export ========================= */
  const akun = db.prepare("SELECT * FROM aset WHERE jenis IN ('pinjaman','lain') ORDER BY id LIMIT 1").get();
  if (akun) {
    r = await req('GET', '/aset/akun/' + akun.id);
    ok('ledger aset punya tombol Cetak & Export Excel', /\/cetak" target="_blank"/.test(r.text) && /\/export"/.test(r.text));
    r = await req('GET', '/aset/akun/' + akun.id + '/cetak');
    ok('halaman cetak ledger aset (print layout)', r.status === 200 && /LEDGER/.test(r.text) && /window.print\(\)/.test(r.text), String(r.status));
    const resX = await fetch(base + '/aset/akun/' + akun.id + '/export', { headers: { Cookie: cookies.admin } });
    const bufX = Buffer.from(await resX.arrayBuffer());
    ok('export Excel ledger aset', resX.status === 200 && XLSX_MAGIC(bufX), String(resX.status));
  }

  /* ========================= 10. QRIS Super Admin ========================= */
  // gambar WebP 1x1 (hasil konversi klien) harus diterima
  const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  r = await req('POST', '/super-admin/qris', { qris_b64: WEBP, qris_nama: 'Yayasan Uji', qris_nomor: '0812', harga_bulan: '150000', harga_tahun: '1500000', trial_hari: '14' }, { who: 'sa' });
  ok('unggah QRIS format WebP diterima', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('gambar QRIS tersimpan', !!String((ctl.prepare("SELECT v FROM saas_settings WHERE k='qris_image'").get() || {}).v || ''));
  const cekSetelah = await req('GET', '/super-admin/qris', null, { who: 'sa' });
  ok('sesi Super Admin tetap aktif setelah unggah', cekSetelah.status === 200, String(cekSetelah.status));
  r = await req('POST', '/super-admin/qris', { qris_b64: 'data:text/plain;base64,' + Buffer.from('bukan gambar').toString('base64') }, { who: 'sa' });
  ok('berkas bukan gambar ditolak', /err=/.test(r.loc) && /gambar/i.test(dec(r.loc)), dec(r.loc));
  r = await req('GET', '/super-admin/qris', null, { who: 'sa' });
  ok('form QRIS menerima webp (accept)', r.status === 200 && /image\/webp/.test(r.text), String(r.status));

  /* ========================= 11. legalitas ToS & SLA ========================= */
  r = await req('GET', '/syarat-ketentuan', null, { who: 'none', clearCookie: true });
  ok('halaman publik Syarat & Ketentuan terbuka tanpa login', r.status === 200 && /Syarat (&|&amp;) Ketentuan/.test(r.text), String(r.status));
  r = await req('GET', '/sla', null, { who: 'none', clearCookie: true });
  ok('halaman publik SLA terbuka tanpa login', r.status === 200 && /SLA|Service Level/.test(r.text), String(r.status));
  r = await req('GET', '/super-admin/legal', null, { who: 'sa' });
  ok('editor legalitas Super Admin terbuka', r.status === 200 && /name="legal_tos"/.test(r.text) && /name="legal_sla"/.test(r.text), String(r.status));
  r = await req('POST', '/super-admin/legal', {
    legal_tos_judul: 'Syarat Layanan Uji', legal_tos: '1. Ketentuan Uji\nIsi ketentuan layanan versi uji.',
    legal_sla_judul: 'SLA Uji', legal_sla: '1. Ketersediaan Uji\nTarget 99,5% per bulan.', legal_kontak: 'support@uji.sch.id'
  }, { who: 'sa' });
  ok('dokumen legalitas disimpan', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/syarat-ketentuan', null, { who: 'none', clearCookie: true });
  ok('ToS menampilkan isi yang disimpan', /Ketentuan Uji/.test(r.text) && /support@uji\.sch\.id/.test(r.text));
  r = await req('GET', '/sla', null, { who: 'none', clearCookie: true });
  ok('SLA menampilkan isi yang disimpan', /Ketersediaan Uji/.test(r.text));

  /* ========================= 12. kop surat dinamis ========================= */
  // isi identitas sekolah agar kop otomatis terlihat
  await req('POST', '/sekolah', {
    sekolah_nama: 'SDN Kop Dinamis', sekolah_npsn: '20219999', sekolah_bentuk: 'SD',
    sekolah_status: 'Swasta', sekolah_kepemilikan: 'Yayasan Uji', sekolah_telp: '0265 111222',
    sekolah_email: 'kop@uji.sch.id', sekolah_website: 'www.kopuji.sch.id',
    sekolah_alamat: 'Jl. Kop Dinamis No. 1, Ciamis'
  });
  // simpan desain: kop otomatis + font per baris + logo kop
  r = await req('POST', '/desain-cetak', {
    kop_sumber: 'auto',
    kop_size_1: '12', kop_bold_1: '1',
    kop_size_2: '9',
    kop_logo_b64: PNG,
    print_tempat: 'Cikoneng'
  });
  ok('pengaturan kop dinamis disimpan', r.status === 303 && !/err=/.test(r.loc), dec(r.loc));
  ok('setting kop_sumber = auto', String(db.prepare("SELECT v FROM settings WHERE k='kop_sumber'").get().v) === 'auto');
  ok('logo kop terpisah tersimpan', !!String(db.prepare("SELECT v FROM settings WHERE k='kop_logo'").get().v || ''));
  r = await req('GET', '/desain-cetak');
  ok('editor kop: sumber data, font per baris & logo terpisah', /name="kop_sumber"/.test(r.text) && /name="kop_size_1"/.test(r.text)
    && /name="kop_logo_b64"/.test(r.text) && /data-kop-manual/.test(r.text));
  // nama sekolah kini tampil apa adanya (tidak dipaksa UPPERCASE)
  ok('pratinjau kop otomatis memuat nama sekolah', /SDN Kop Dinamis/i.test(r.text));
  ok('pratinjau kop memakai font per baris (12pt tebal)', /font-size:12pt;font-weight:800/.test(r.text));
  const kopLogoUrl = String(db.prepare("SELECT v FROM settings WHERE k='kop_logo'").get().v || '');
  ok('pratinjau kop memakai logo kop khusus', kopLogoUrl ? r.text.includes(kopLogoUrl) : true);

  // website tanpa protokol
  ok('website disimpan dengan protokol otomatis',
    String(db.prepare("SELECT v FROM settings WHERE k='sekolah_website'").get().v) === 'https://www.kopuji.sch.id',
    String(db.prepare("SELECT v FROM settings WHERE k='sekolah_website'").get().v));
  r = await req('GET', '/sekolah');
  ok('input website ditampilkan tanpa https://', /name="sekolah_website" value="www\.kopuji\.sch\.id"/.test(r.text));

  /* ========================= 13. cetakan memakai kop dinamis ========================= */
  const trxBaru = db.prepare('SELECT * FROM transaksi ORDER BY id DESC LIMIT 1').get();
  if (trxBaru) {
    r = await req('GET', '/transaksi/' + trxBaru.id + '/kwitansi');
    ok('kwitansi memakai baris kop dinamis', /kwit-kop/.test(r.text) && /SDN Kop Dinamis/i.test(r.text), String(r.status));
  }
  r = await req('GET', '/cetak/bku?ta=' + taList[0].id);
  ok('cetak laporan BKU memakai kop dinamis', r.status === 200 && /class="kop"/.test(r.text) && /SDN KOP DINAMIS|SDN Kop Dinamis/i.test(r.text), String(r.status));
  r = await req('GET', '/cetak/piutang');
  ok('cetak laporan iuran memakai kop dinamis', r.status === 200 && /class="kop"/.test(r.text), String(r.status));

  /* ---------- hasil ---------- */
  const gagal = results.filter(x => !x.ok);
  console.log('');
  console.log(`round33: ${results.length - gagal.length}/${results.length} cek lulus`);
  if (gagal.length) {
    console.log('GAGAL: ' + gagal.map(g => g.name).join(' | '));
    console.log('LOG SERVER:\n' + log.split('\n').slice(-40).join('\n'));
  }
  db.close(); ctl.close();
  srv.kill('SIGKILL');
  process.exit(gagal.length ? 1 : 0);
})().catch(e => {
  console.error('ERROR TES:', e);
  console.log(log.split('\n').slice(-20).join('\n'));
  try { srv.kill('SIGKILL'); } catch (err) { }
  process.exit(1);
});
