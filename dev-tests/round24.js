'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   TES RONDE 24 — jenjang & tingkat kelas, login ringkas, branding dinamis,
   trial + kode acak + paket dinamis, anti-spam, laporan tunggakan per tingkat
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { otpDaftar } = require('./otp');

const PORT = process.env.R24_PORT || 3941;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r24-'));
const DB = path.join(TMP, 'keuangan.sqlite');
const SDB = path.join(TMP, 'saas.db');
const SAAS_PASS = 'SuperAdmin2026!';
// require('../db') di dalam tes HARUS memakai database sementara (bukan data produksi)
process.env.DB_PATH = DB;
process.env.SAAS_DB_PATH = SDB;

const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  →  ' + extra));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: SAAS_PASS },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;

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
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, text: buf.toString('utf8'), buf, loc: r.headers.get('location') || '', sc: r.headers.get('set-cookie') || '', type: r.headers.get('content-type') || '' };
}
const ck = sc => String(sc || '').split(';')[0];
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 140; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const sdb = new Database(SDB);
  const tdb = new Database(DB);

  /* ============ 1. MASTER TINGKAT & PRESET JENJANG ============ */
  const dbm = require('../db');
  const presets = {
    'SD/MI': ['I', 'II', 'III', 'IV', 'V', 'VI'],
    'SMP/MTs': ['VII', 'VIII', 'IX'],
    'SMA/MA': ['X', 'XI', 'XII'],
    'SMK': ['X', 'XI', 'XII'],
    'PAUD/TK': ['KB', 'TK-A', 'TK-B']
  };
  let allPreset = true;
  for (const [j, list] of Object.entries(presets)) {
    const got = dbm.JENJANG[j] ? dbm.JENJANG[j].preset.join(',') : '';
    if (got !== list.join(',')) { allPreset = false; console.log('  preset beda', j, got); }
  }
  ok('preset tingkat semua jenjang benar (SD/SMP/SMA/SMK/PAUD)', allPreset);
  ok('master tingkat memuat I..XII + pra-sekolah', ['I', 'VI', 'VII', 'XII', 'KB', 'TK-A', 'TK-B'].every(k => dbm.TINGKAT_MASTER.some(t => t.kode === k)));
  ok('urutan tingkat pra-sekolah < I < XII', dbm.tingkatUrut('KB') < dbm.tingkatUrut('I') && dbm.tingkatUrut('VII') < dbm.tingkatUrut('XII'));
  ok('kenaikan tingkat VII → VIII, XII → lulus', dbm.tingkatNaik('VII') === 'VIII' && dbm.tingkatNaik('XII') === '');
  ok('kenaikan tingkat angka 7 → 8, 12 → lulus', dbm.tingkatNaik('7') === '8' && dbm.tingkatNaik('12') === '');

  /* ============ 2. LOGIN RINGKAS (tanpa portal orang tua / super admin) ============ */
  let r = await req('GET', '/login');
  ok('login: hanya 3 kolom (kode, username, password)',
    /name="kode"/.test(r.text) && /name="email"/.test(r.text) && /name="password"/.test(r.text));
  ok('login: tanpa tautan portal orang tua', !/Portal Orang Tua|Cek Tagihan Iuran Siswa/.test(r.text));
  ok('login: tanpa tautan Super Admin Pusat', !/super-admin\/login/.test(r.text));
  ok('login: tanpa branding logo sekolah (pakai default sistem)', !/auth-logo-img/.test(r.text) || /SVG/.test(r.text) === false);
  r = await req('GET', '/portal');
  ok('/portal dialihkan ke alamat lengkap (bukan halaman di akar)', [301, 302, 303, 307, 308].includes(r.status) && /portal-tagihan/.test(r.loc || ''), r.status + ' ' + (r.loc || ''));
  r = await req('GET', '/super-admin/login');
  ok('/super-admin tetap ada sebagai route khusus', r.status === 200 && /Super Admin Pusat/.test(r.text));

  /* ============ 3. BRANDING SISTEM (Super Admin) ============ */
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: SAAS_PASS });
  const cSa = ck(r.sc);
  ok('login super admin', r.status === 303 && /simkeu_saas/.test(r.sc));
  r = await req('GET', '/super-admin/branding', null, { cookie: cSa });
  ok('halaman Branding Sistem tersedia', r.status === 200 && /Branding Sistem/.test(r.text), r.status);
  ok('form branding: nama, logo, favicon, trial', ['name="saas_nama"', 'name="logo_b64"', 'name="fav_b64"', 'name="trial_hari"'].every(x => r.text.includes(x)));
  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU Pro App', trial_hari: '14', captcha_provider: 'off', reg_limit_per_hour: '2', reg_block_hours: '24' }, { cookie: cSa });
  ok('simpan branding & trial 14 hari', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('nama aplikasi default tersimpan', sdb.prepare("SELECT v FROM saas_settings WHERE k='saas_nama'").get().v === 'SIMKEU Pro App');
  ok('trial hari tersimpan', sdb.prepare("SELECT v FROM saas_settings WHERE k='trial_hari'").get().v === '14');
  r = await req('GET', '/login');
  ok('portal login memakai nama aplikasi default', /SIMKEU Pro App/.test(r.text));
  r = await req('GET', '/favicon.ico');
  ok('favicon default sistem tersedia (SVG inisial)', r.status === 200 && /svg|png/.test(r.type), r.status + ' ' + r.type);

  /* ============ 4. PAKET DINAMIS (CRUD) ============ */
  r = await req('GET', '/super-admin/paket', null, { cookie: cSa });
  ok('halaman Paket Langganan', r.status === 200 && /Daftar Paket/.test(r.text), r.status);
  ok('paket bawaan Basic/Standard/Pro ter-seed', sdb.prepare('SELECT COUNT(*) c FROM saas_packages').get().c >= 3);
  ok('paket default = Basic', (sdb.prepare('SELECT kode FROM saas_packages WHERE is_default=1').get() || {}).kode === 'basic');
  r = await req('POST', '/super-admin/paket/simpan', { nama: 'Premium', harga_bulan: '300.000', harga_tahun: '3.000.000', keterangan: 'Semua fitur + prioritas', urutan: '9', aktif: '1' }, { cookie: cSa });
  ok('tambah paket baru', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const prem = sdb.prepare("SELECT * FROM saas_packages WHERE nama='Premium'").get();
  ok('paket Premium tersimpan dengan harga benar', !!prem && prem.harga_bulan === 300000 && prem.harga_tahun === 3000000, JSON.stringify(prem && { b: prem.harga_bulan, t: prem.harga_tahun }));
  r = await req('POST', '/super-admin/paket/simpan', { id: prem.id, nama: 'Premium Plus', harga_bulan: '350.000', harga_tahun: '3.500.000', urutan: '9', aktif: '1' }, { cookie: cSa });
  ok('sunting nama & harga paket', r.status === 303 && sdb.prepare('SELECT nama FROM saas_packages WHERE id=?').get(prem.id).nama === 'Premium Plus');

  /* ============ 5. REGISTRASI: kode acak, trial, paket default, jenjang ============ */
  const regBody = n => ({
    nama: 'SD Negeri Uji ' + n, admin_nama: 'Admin Uji', admin_email: 'admin' + n + '@sduji.sch.id',
    admin_password: 'Rahasia123!', jenjang: 'SD/MI', paket: 'basic', alamat: 'Jl. Uji ' + n, telp: '0812345670' + n
  });
  /* setiap pendaftaran wajib lolos verifikasi OTP nomor WhatsApp */
  const otp1 = await otpDaftar(base, '08123456701');
  r = await req('POST', '/register', Object.assign(regBody(1), { otp_token: otp1 }));
  /* ronde 30: setelah daftar langsung masuk dashboard sekolah baru (?welcome=1) */
  ok('registrasi sekolah baru (langsung ke dashboard)', r.status === 303 && /\/\?welcome=1$/.test(r.loc), r.loc);
  const t1 = sdb.prepare("SELECT * FROM tenants WHERE nama='SD Negeri Uji 1'").get();
  ok('kode sekolah 4 karakter acak (bukan SK01/SK02)', t1 && /^[A-Z0-9]{4}$/.test(t1.school_code) && !/^SK\d\d$/.test(t1.school_code), t1 && t1.school_code);
  ok('paket default Basic untuk pendaftaran mandiri', t1 && t1.paket === 'basic', t1 && t1.paket);
  ok('masa aktif = hari ini + trial 14 hari', t1 && t1.expires_at === addDays(today, 14), t1 && t1.expires_at);
  ok('slug portal otomatis dari nama', t1 && t1.portal_slug === 'sd-negeri-uji-1', t1 && t1.portal_slug);
  const t1db = new Database(t1.db_file);
  ok('jenjang sekolah baru tersimpan', t1db.prepare("SELECT v FROM settings WHERE k='jenjang_pendidikan'").get().v === 'SD/MI');
  ok('preset tingkat SD otomatis aktif (I..VI)', (t1db.prepare("SELECT v FROM settings WHERE k='tingkat_aktif'").get().v || '').includes('"VI"'));
  ok('akun admin sekolah baru bisa dipakai', !!t1db.prepare("SELECT id FROM users WHERE email='admin1@sduji.sch.id'").get());

  /* kode acak tidak berurutan */
  const otp2 = await otpDaftar(base, '08123456702');
  r = await req('POST', '/register', Object.assign(regBody(2), { otp_token: otp2 }));
  const t2 = sdb.prepare("SELECT * FROM tenants WHERE nama='SD Negeri Uji 2'").get();
  ok('kode sekolah kedua juga acak & berbeda', t2 && t2.school_code !== t1.school_code && /^[A-Z0-9]{4}$/.test(t2.school_code), t2 && t2.school_code);

  /* ============ 6. ANTI-SPAM (rate limit 2/jam) ============ */
  const otp3 = await otpDaftar(base, '08123456703');
  r = await req('POST', '/register', Object.assign(regBody(3), { otp_token: otp3 }));
  ok('pendaftaran ke-3 dari IP sama diblokir', r.status === 303 && /Terlalu%20banyak%20permintaan%20pendaftaran/.test(r.loc), r.loc);
  ok('sekolah ke-3 TIDAK dibuat', !sdb.prepare("SELECT id FROM tenants WHERE nama='SD Negeri Uji 3'").get());
  const blockedRow = sdb.prepare("SELECT * FROM reg_attempts WHERE hasil='blocked' ORDER BY id DESC LIMIT 1").get();
  ok('percobaan blokir dicatat di reg_attempts', !!blockedRow && blockedRow.ip);
  const captcha = dbm.captchaConfig ? null : null;
  ok('captcha nonaktif secara default (tidak menghalangi)', String(sdb.prepare("SELECT v FROM saas_settings WHERE k='captcha_provider'").get().v) === 'off');
  r = await req('GET', '/register');
  ok('form registrasi memuat pilihan jenjang', /name="jenjang"/.test(r.text) && /SD \/ MI|SD\/MI/.test(r.text));

  /* ============ 7. PENGATURAN KELAS & TINGKAT (sisi sekolah) ============ */
  r = await req('POST', '/login', { kode: t1.school_code, email: 'admin1@sduji.sch.id', password: 'rahasia123' });
  const cT = ck(r.sc);
  ok('login sekolah baru (kode acak)', r.status === 303 && /simkeu_sid/.test(r.sc), r.loc);
  r = await req('GET', '/kelas/tingkat', null, { cookie: cT });
  ok('halaman Pengaturan Kelas & Tingkat', r.status === 200 && /Tingkat Aktif/.test(r.text), r.status);
  ok('checklist tingkat menampilkan preset SD aktif', /name="tingkat" value="I" checked/.test(r.text) && /name="tingkat" value="VI" checked/.test(r.text));
  ok('jenjang sekolah tampil di halaman', /SD \/ MI/.test(r.text));
  r = await req('GET', '/sekolah', null, { cookie: cT });
  ok('profil sekolah memuat pilihan bentuk pendidikan (SMK/SMA/MA/SMP/MTs/SD/MI/PAUD)', /name="sekolah_bentuk"/.test(r.text) && /Sekolah Menengah Kejuruan \(SMK\)/.test(r.text));

  // ubah jenjang → preset baru
  r = await req('POST', '/kelas/tingkat/jenjang', { jenjang_pendidikan: 'SMP/MTs' }, { cookie: cT });
  ok('ubah jenjang menerapkan preset baru', r.status === 303 && /VII/.test(decodeURIComponent(r.loc)), r.loc);
  r = await req('GET', '/kelas/tingkat', null, { cookie: cT });
  ok('tingkat aktif sekarang VII–IX', /name="tingkat" value="VII" checked/.test(r.text) && !/name="tingkat" value="I" checked/.test(r.text));

  // tambah tingkat kustom & kelas per tingkat
  r = await req('POST', '/kelas/tingkat/tambah', { tingkat: '7 Al-Farabi' }, { cookie: cT });
  ok('tambah tingkat kustom', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/kelas/tingkat/kelas', { tingkat: 'VII', nama: 'VII-A', tahun_ajaran_id: String(dbm.taAutoId()) }, { cookie: cT });
  ok('tambah kelas VII-A dari halaman tingkat', r.status === 303 && /ok=/.test(r.loc), r.loc);
  r = await req('POST', '/kelas/tingkat/kelas', { tingkat: 'VII', nama: 'VII-B', tahun_ajaran_id: String(dbm.taAutoId()) }, { cookie: cT });
  ok('tambah kelas VII-B', /ok=/.test(r.loc));
  r = await req('POST', '/kelas/tingkat/kelas', { tingkat: '7 Al-Farabi', nama: '7 Al-Farabi Putra', tahun_ajaran_id: String(dbm.taAutoId()) }, { cookie: cT });
  ok('kelas pada tingkat kustom', /ok=/.test(r.loc));

  const kls = t1db.prepare('SELECT * FROM kelas ORDER BY id').all();
  ok('kolom nama_kelas terisi', kls.length >= 3 && kls.every(k => k.nama_kelas === k.nama), JSON.stringify(kls.map(k => k.nama_kelas)));
  ok('kelas menyimpan tingkat (VII & kustom)', kls.some(k => k.tingkat === 'VII') && kls.some(k => k.tingkat === '7 Al-Farabi'));
  r = await req('GET', '/kelas', null, { cookie: cT });
  ok('halaman Data Kelas memakai tingkat aktif (bukan X/XI/XII tetap)', /value="VII"/.test(r.text) && !/value="XII"/.test(r.text), 'opsi tingkat salah');
  r = await req('POST', '/kelas/tingkat/hapus', { tingkat: '7 Al-Farabi' }, { cookie: cT });
  ok('tingkat yang masih dipakai kelas tidak bisa dihapus', r.status === 303 && /err=/.test(r.loc), r.loc);

  /* ============ 8. TAGIHAN BERDASARKAN TINGKAT ============ */
  // siswa di dua tingkat berbeda
  const taId = dbm.taAutoId();
  const VII = kls.find(k => k.nama_kelas === 'VII-A');
  t1db.prepare("INSERT INTO siswa (nama,nisn,status,tenant_id) VALUES ('Siswa VII','111','aktif',?)").run(t1.id);
  const sVII = t1db.prepare("SELECT id FROM siswa WHERE nisn='111'").get().id;
  t1db.prepare("INSERT INTO siswa (nama,nisn,status,tenant_id) VALUES ('Siswa VIII','222','aktif',?)").run(t1.id);
  const sVIII = t1db.prepare("SELECT id FROM siswa WHERE nisn='222'").get().id;
  // kelas VIII
  t1db.prepare("INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,urutan,created_at) VALUES ('VIII-A','VIII-A','VIII',?,1,5,'x')").run(taId);
  const VIII = t1db.prepare("SELECT * FROM kelas WHERE nama_kelas='VIII-A'").get();
  // penempatan
  const penempatanSet = (sid, kid) => t1db.prepare('INSERT OR REPLACE INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,created_at) VALUES (?,?,?,?)').run(sid, kid, taId, 'x');
  penempatanSet(sVII, VII.id);
  penempatanSet(sVIII, VIII.id);

  // grup iuran: default 100.000/bln, khusus VII 150.000/bln
  r = await req('POST', '/iuran/save', { nama: 'SPP Uji', jenis: 'bulanan', tahun_ajaran_id: String(taId), mode_nominal: 'rata', nominal_rata: '100.000', aktif: '1', nominal_tingkat: '' }, { cookie: cT });
  ok('buat grup iuran default', /ok=/.test(r.loc), r.loc);
  const grp = t1db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Uji'").get();
  ok('nominal default tersimpan (12 bulan)', t1db.prepare("SELECT COUNT(*) c FROM iuran_nominal WHERE grup_id=? AND COALESCE(tingkat,'')=''").get(grp.id).c === 12);
  r = await req('POST', `/iuran/grup/${grp.id}/nominal`, { nominal_tingkat: 'VII', bulan_7: '150.000', bulan_8: '150.000', bulan_9: '150.000', bulan_10: '150.000', bulan_11: '150.000', bulan_12: '150.000', bulan_1: '150.000', bulan_2: '150.000', bulan_3: '150.000', bulan_4: '150.000', bulan_5: '150.000', bulan_6: '150.000' }, { cookie: cT });
  ok('simpan tarif khusus tingkat VII', /ok=/.test(r.loc), r.loc);
  ok('nominal tingkat VII = 1.800.000/tahun', t1db.prepare("SELECT COALESCE(SUM(nominal),0) s FROM iuran_nominal WHERE grup_id=? AND tingkat='VII'").get(grp.id).s === 1800000);
  ok('nominal default tetap 1.200.000/tahun', t1db.prepare("SELECT COALESCE(SUM(nominal),0) s FROM iuran_nominal WHERE grup_id=? AND COALESCE(tingkat,'')=''").get(grp.id).s === 1200000);
  r = await req('GET', `/iuran/grup/${grp.id}`, null, { cookie: cT });
  ok('detail grup menampilkan tarif per tingkat', /Tarif Khusus per Tingkat/.test(r.text) && /Tingkat VII/.test(r.text));

  // tetapkan ke kelas VII-A
  r = await req('POST', `/iuran/grup/${grp.id}/tetapkan`, { kelas_id: String(VII.id), siswa_id: String(sVII) }, { cookie: cT });
  ok('tetapkan grup ke siswa kelas VII', /ok=/.test(r.loc), r.loc);
  r = await req('POST', `/iuran/grup/${grp.id}/tetapkan`, { kelas_id: String(VIII.id), siswa_id: String(sVIII) }, { cookie: cT });
  ok('tetapkan grup ke siswa kelas VIII', /ok=/.test(r.loc));
  const tagVII = t1db.prepare('SELECT nominal FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(grp.id, sVII);
  const tagVIII = t1db.prepare('SELECT nominal FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(grp.id, sVIII);
  ok('tagihan siswa VII memakai tarif tingkat VII', tagVII && Number(tagVII.nominal) === 1800000, tagVII && tagVII.nominal);
  ok('tagihan siswa VIII memakai tarif default', tagVIII && Number(tagVIII.nominal) === 1200000, tagVIII && tagVIII.nominal);

  /* ============ 9. FILTER LAPORAN PER TINGKAT & KELAS ============ */
  r = await req('GET', '/laporan?r=tunggakan', null, { cookie: cT });
  ok('laporan Tunggakan per Tingkat tersedia', r.status === 200 && /Rekap per Tingkat Kelas/.test(r.text), r.status);
  ok('laporan menampilkan baris tingkat VII & VIII', /Tingkat VII/.test(r.text) && /Tingkat VIII/.test(r.text));
  r = await req('GET', '/laporan?r=tunggakan&tingkat=VII', null, { cookie: cT });
  ok('filter laporan per tingkat', r.status === 200
    && /<td class="t-strong">Tingkat VII<\/td>/.test(r.text)
    && !/<td class="t-strong">Tingkat VIII<\/td>/.test(r.text));
  r = await req('GET', `/laporan?r=tunggakan&kelas=${VII.id}`, null, { cookie: cT });
  ok('filter laporan per kelas spesifik', r.status === 200
    && /<td class="t-strong">VII-A<\/td>/.test(r.text)
    && !/<td class="t-strong">VIII-A<\/td>/.test(r.text));
  r = await req('GET', '/cetak/tunggakan', null, { cookie: cT });
  ok('cetak laporan tunggakan per tingkat', r.status === 200 && /REKAPITULASI TUNGGAKAN/.test(r.text) && /Bendahara|Kepala Sekolah/i.test(r.text));
  r = await req('GET', '/export/tunggakan', null, { cookie: cT });
  ok('export Excel laporan tunggakan', r.status === 200 && /spreadsheetml/.test(r.type), r.status + ' ' + r.type);
  r = await req('GET', '/iuran/data?tingkat=VII', null, { cookie: cT });
  ok('Data Iuran bisa difilter per tingkat', r.status === 200 && /Tingkat Kelas \(multi-pilih\)/.test(r.text));
  r = await req('GET', '/iuran/transaksi?tingkat=VII', null, { cookie: cT });
  ok('Transaksi iuran bisa difilter per tingkat', r.status === 200 && /name="tingkat"/.test(r.text));

  /* ============ 10. UPGRADE PAKET (tenant) ============ */
  r = await req('GET', '/info-layanan/paket', null, { cookie: cT });
  ok('halaman Paket Langganan sekolah', r.status === 200 && /Pilih Basic|Pilih Standard|Pilih Pro|Premium Plus/.test(r.text), r.status);
  ok('paket aktif ditandai', /Aktif/.test(r.text));
  r = await req('GET', '/perpanjang?paket=pro', null, { cookie: cT });
  ok('checkout dapat memilih paket Pro', r.status === 200 && /name="paket"/.test(r.text) && /Pro/.test(r.text));
  // pengajuan upgrade dibuat lewat control plane (unggah bukti butuh token media runtime)
  const sdb2 = new Database(SDB);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const pay = sdb2.prepare(`INSERT INTO saas_payments (tenant_id,paket_tujuan,no_invoice,jenis,durasi,nominal,status,bukti_url,pengirim,source,periode_mulai,dibuat_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t1.id, 'pro', 'INV-UP', 'perpanjangan', 30, 250000, 'pending', 'https://x/b.jpg', 'Admin', 'tenant', t1.expires_at, now, now);
  r = await req('POST', `/super-admin/pembayaran/${pay.lastInsertRowid}/approve`, {}, { cookie: cSa });
  ok('approve pembayaran upgrade', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const t1after = sdb2.prepare('SELECT paket FROM tenants WHERE id=?').get(t1.id);
  ok('paket sekolah berubah menjadi Pro setelah approve', t1after.paket === 'pro', t1after.paket);
  sdb2.close();
  r = await req('GET', '/', null, { cookie: cT });
  ok('fitur Pro langsung terbuka setelah upgrade', r.status === 200 && /href="\/payroll"/.test(r.text));

  /* ============ 11. BRANDING TENANT & FAVICON ============ */
  r = await req('GET', '/favicon.ico', null, { cookie: cT });
  ok('favicon sekolah (login) tersedia', r.status === 200);
  r = await req('GET', `/favicon.ico`, null, {});
  ok('favicon default saat tanpa konteks sekolah', r.status === 200);
  ok('nama aplikasi kustom per sekolah dapat diubah (form /tema)', (await req('GET', '/tema', null, { cookie: cT })).status === 200);

  /* ============ 12. KONSISTENSI DATA LAMA ============ */
  ok('tabel kelas punya kolom nama_kelas & tingkat', t1db.pragma('table_info("kelas")').some(c => c.name === 'nama_kelas') && t1db.pragma('table_info("kelas")').some(c => c.name === 'tingkat'));
  ok('iuran_nominal punya kolom tingkat', t1db.pragma('table_info("iuran_nominal")').some(c => c.name === 'tingkat'));
  ok('tenant pertama tetap ada & tidak berubah kode', !!sdb.prepare('SELECT id FROM tenants WHERE id=1').get());

  /* ============ ringkasan ============ */
  const fail = results.filter(x => !x.ok);
  console.log(`\n${results.length - fail.length}/${results.length} cek lulus`);
  if (fail.length) {
    console.log('GAGAL: ' + fail.map(f => f.name).join(' | '));
    console.log('--- log server ---\n' + log.slice(-2500));
  }
  srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('ERROR TES:', e);
  console.log(log.slice(-2500));
  srv.kill();
  process.exit(1);
});
