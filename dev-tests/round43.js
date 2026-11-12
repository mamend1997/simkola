'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   RONDE 43 (SIMKEU)
   1) Petunjuk Pengguna: thumbnail kartu + embedded viewer (video/PDF)
      yang dibuka di dalam aplikasi (modal) — bukan tab baru.
   2) Pendaftaran sekolah baru: verifikasi nomor WhatsApp dengan OTP
      4 digit lewat WA Gateway pusat (gateway tagihan perpanjangan).
   3) Honor ekskul: periode kinerja/honor dipisahkan dari bulan posting
      ke BKU (mis. honor Oktober dibukukan pada BKU November).
   Jalankan: node dev-tests/round43.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const xr = require('../xlsx-read');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r43-'));
const DB = path.join(TMP, 'k.sqlite');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.R43_PORT || 3673;
const SAAS_PASS = 'SuperAdmin2026!';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: SAAS_PASS },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
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
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status, text: buf.toString('utf8'), buf,
    loc: r.headers.get('location') || '', sc: r.headers.get('set-cookie') || '',
    type: r.headers.get('content-type') || ''
  };
}
async function jreq(method, url, body) {
  const r = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = {};
  try { j = JSON.parse(buf.toString('utf8')); } catch (e) { }
  return { status: r.status, j, text: buf.toString('utf8') };
}
const ck = sc => String(sc || '').split(';')[0];

(async () => {
  for (let i = 0; i < 140; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const tdb = new Database(DB);
  const sdb = new Database(SDB);

  /* ================================================================
     1. PETUNJUK PENGGUNA — THUMBNAIL + EMBEDDED VIEWER
     ================================================================ */
  console.log('\n[1] Petunjuk Pengguna — thumbnail & embedded viewer');
  let r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: SAAS_PASS });
  const cSa = ck(r.sc);
  ok('login Super Admin', r.status === 303 && /simkeu_saas/.test(r.sc), r.status);
  /* batas pendaftaran per IP dinaikkan: pengujian sengaja mengirim beberapa submit gagal */
  await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU', reg_limit_per_hour: '50', reg_block_hours: '1', daftar_otp_demo: '1' }, { cookie: cSa });

  r = await req('GET', '/super-admin/petunjuk', null, { cookie: cSa });
  ok('form Master Petunjuk punya kolom thumbnail', /name="thumbnail_url"/.test(r.text) && /data-b64="gThumbB64"/.test(r.text));
  ok('form Master Petunjuk menjelaskan embedded viewer', /modal viewer|langsung di dalam aplikasi/i.test(r.text));

  r = await req('POST', '/super-admin/petunjuk/simpan', {
    judul: 'Panduan Uji Viewer', kategori: 'Iuran & SPP',
    ringkas: 'Ringkasan panduan uji', konten: '# Langkah\n1. Buka menu\n2. Klik bayar',
    video_url: 'https://youtu.be/dQw4w9WgXcQ',
    lampiran_url: 'https://contoh.sch.id/panduan-iuran.pdf',
    thumbnail_url: 'https://contoh.sch.id/thumb-iuran.jpg',
    urutan: '1', published: '1'
  }, { cookie: cSa });
  ok('panduan (thumbnail + video + PDF) tersimpan', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const guide = sdb.prepare("SELECT * FROM master_guides WHERE judul='Panduan Uji Viewer'").get();
  ok('kolom thumbnail_url tersimpan di control plane', !!guide && guide.thumbnail_url === 'https://contoh.sch.id/thumb-iuran.jpg', guide && guide.thumbnail_url);

  /* panduan tanpa thumbnail → gambar otomatis dari video YouTube */
  r = await req('POST', '/super-admin/petunjuk/simpan', {
    judul: 'Panduan Video Saja', kategori: 'Umum', ringkas: 'Hanya video',
    konten: 'isi', video_url: 'https://www.youtube.com/watch?v=abcdefghijk', urutan: '2', published: '1'
  }, { cookie: cSa });
  ok('panduan kedua tersimpan', r.status === 303 && /ok=/.test(r.loc));

  /* login admin sekolah (tenant 1) */
  r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  const cT = ck(r.sc);
  ok('login admin sekolah', r.status === 303, r.status);

  r = await req('GET', '/petunjuk', null, { cookie: cT });
  ok('kartu panduan menampilkan <img> thumbnail', /class="guide-thumb"[\s\S]{0,400}<img src="https:\/\/contoh\.sch\.id\/thumb-iuran\.jpg"/.test(r.text));
  ok('thumbnail otomatis dari YouTube (tanpa upload)', /i\.ytimg\.com\/vi\/abcdefghijk/.test(r.text));
  ok('tombol Putar Video tersedia', /data-open="mGv\d+"/.test(r.text));
  ok('tombol Lihat PDF tersedia', /data-open="mGd\d+"/.test(r.text));
  ok('modal viewer video memakai iframe lazy (data-src)', /class="video-embed"[^>]*><iframe data-src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/.test(r.text));
  ok('modal viewer PDF memakai iframe lazy', /class="pdf-embed"><iframe data-src="https:\/\/contoh\.sch\.id\/panduan-iuran\.pdf#view=FitH"/.test(r.text));
  ok('modal viewer menyediakan tautan buka tab baru', /Buka di tab baru/.test(r.text));
  ok('viewer tidak lagi memakai target=_blank untuk tombol utama',
    !/class="btn mt-2" href="https:\/\/contoh\.sch\.id\/panduan-iuran\.pdf" target="_blank"/.test(r.text));

  r = await req('GET', '/petunjuk?id=' + guide.id, null, { cookie: cT });
  ok('halaman rincian menampilkan dokumen PDF ter-embed', /class="pdf-embed"><iframe src=/.test(r.text));
  ok('halaman rincian menampilkan video ter-embed', /class="video-embed[^"]*"><iframe src="https:\/\/www\.youtube\.com\/embed\//.test(r.text));
  ok('halaman rincian menampilkan gambar pratayang besar', /class="guide-hero"><img src=/.test(r.text));

  r = await req('POST', '/petunjuk/save', { judul: 'Ditolak' }, { cookie: cT });
  ok('akun sekolah tetap TIDAK boleh mengubah panduan (403)', r.status === 403, r.status);

  /* Google Drive / Docs dipratayang lewat /preview */
  r = await req('POST', '/super-admin/petunjuk/simpan', {
    judul: 'Panduan Drive', kategori: 'Umum', ringkas: 'Drive', konten: 'isi',
    lampiran_url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing', urutan: '3', published: '1'
  }, { cookie: cSa });
  ok('panduan lampiran Google Drive tersimpan', r.status === 303);
  const gDrive = sdb.prepare("SELECT * FROM master_guides WHERE judul='Panduan Drive'").get();
  r = await req('GET', '/petunjuk?id=' + gDrive.id, null, { cookie: cT });
  ok('lampiran Google Drive dipratayang (embed /preview)', /drive\.google\.com\/file\/d\/1AbCdEfGhIjKlMnOp\/preview/.test(r.text));

  /* ================================================================
     2. OTP 4 DIGIT PADA PENDAFTARAN SEKOLAH BARU
     ================================================================ */
  console.log('\n[2] Verifikasi OTP 4 digit pendaftaran sekolah');
  r = await req('GET', '/register');
  ok('form pendaftaran memuat blok OTP', /data-otp-box/.test(r.text) && (r.text.match(/data-otp-digit(?!s)/g) || []).length === 5);
  ok('nomor WhatsApp wajib diisi', /name="telp"[^>]*required/.test(r.text));
  ok('tombol daftar terkunci sebelum verifikasi', /id="btnDaftar"[^>]*disabled/.test(r.text));
  ok('tombol kirim kode OTP tersedia', /data-otp-kirim/.test(r.text));

  let o = await jreq('POST', '/register/otp/kirim', { telp: '081234560011' });
  ok('kirim OTP tanpa sesi (endpoint publik)', o.status === 200 && o.j.ok === true, o.text.slice(0, 120));
  ok('nomor dinormalkan ke format 62…', o.j.target === '6281234560011', o.j.target);
  ok('kode = 4 digit', /^\d{4}$/.test(String(o.j.demo_kode || '')), o.j.demo_kode);
  ok('mode uji: kode ditampilkan karena gateway belum aktif', o.j.demo === true);
  ok('masa berlaku OTP 10 menit (default)', o.j.menit === 10, o.j.menit);
  const otpToken = o.j.token, otpKode = o.j.demo_kode;
  ok('token OTP tidak sama dengan kode', otpToken !== otpKode);

  o = await jreq('POST', '/register/otp/verifikasi', { token: otpToken, kode: '9999' === otpKode ? '1111' : '9999' });
  ok('kode salah ditolak', o.status === 400 && /salah/i.test(o.j.err), o.text.slice(0, 120));
  o = await jreq('POST', '/register/otp/verifikasi', { token: otpToken, kode: otpKode });
  ok('kode benar diverifikasi', o.status === 200 && o.j.ok === true, o.text.slice(0, 120));
  ok('nomor terverifikasi dikembalikan dalam format 08…', /^08/.test(String(o.j.phone || '')), o.j.phone);

  /* kirim ulang terlalu cepat → ditolak (jeda) */
  o = await jreq('POST', '/register/otp/kirim', { telp: '081234560011' });
  ok('kirim ulang terlalu cepat ditolak (jeda 60 detik)', o.status === 400 && /detik/i.test(o.j.err), o.j.err);
  o = await jreq('POST', '/register/otp/kirim', { telp: '08123' });
  ok('nomor tidak valid ditolak', o.status === 400 && /tidak valid/i.test(o.j.err), o.j.err);

  /* submit tanpa OTP & dengan nomor berbeda */
  const regBody = {
    nama: 'SMK OTP Uji', admin_nama: 'Admin OTP', admin_email: 'admin@otp-uji.sch.id',
    admin_password: 'rahasia123', admin_password2: 'rahasia123', jenjang: 'SMK',
    telp: '081234560011', paket: 'basic'
  };
  r = await req('POST', '/register', regBody);
  ok('pendaftaran tanpa verifikasi OTP ditolak', r.status === 303 && /Verifikasi%20nomor%20WhatsApp/.test(r.loc), decodeURIComponent(r.loc).slice(-160));
  ok('tenant TIDAK dibuat tanpa verifikasi', !sdb.prepare("SELECT id FROM tenants WHERE nama='SMK OTP Uji'").get());
  r = await req('POST', '/register', Object.assign({}, regBody, { otp_token: otpToken, telp: '081234560099' }));
  ok('nomor berbeda dengan yang diverifikasi ditolak', r.status === 303 && /berbeda%20dengan%20nomor/.test(r.loc), decodeURIComponent(r.loc).slice(-140));
  ok('token OTP dipertahankan di URL error agar tidak verifikasi ulang', /otp=/.test(r.loc || ''));

  /* token kedaluwarsa */
  sdb.prepare('UPDATE daftar_otp SET expires_ms=? WHERE token=?').run(Date.now() - 1000, otpToken);
  r = await req('POST', '/register', Object.assign({}, regBody, { otp_token: otpToken }));
  ok('token OTP kedaluwarsa ditolak', r.status === 303 && /kedaluwarsa/i.test(decodeURIComponent(r.loc)), decodeURIComponent(r.loc).slice(-140));

  /* alur sukses — lewati jeda 60 detik dengan memundurkan waktu kirim terakhir */
  sdb.prepare('UPDATE daftar_otp SET created_ms=? WHERE phone=?').run(Date.now() - 5 * 60 * 1000, '6281234560011');
  const o2 = await jreq('POST', '/register/otp/kirim', { telp: '081234560011' });
  ok('setelah jeda, kode baru dapat dikirim', o2.status === 200 && o2.j.ok, o2.text.slice(0, 110));
  const o2v = await jreq('POST', '/register/otp/verifikasi', { token: o2.j.token, kode: o2.j.demo_kode });
  ok('verifikasi kode baru berhasil', o2v.status === 200 && o2v.j.ok);
  r = await req('POST', '/register', Object.assign({}, regBody, { otp_token: o2.j.token }));
  ok('pendaftaran dengan OTP valid berhasil', r.status === 303 && /welcome=1/.test(r.loc), r.loc);
  const tOtp = sdb.prepare("SELECT * FROM tenants WHERE nama='SMK OTP Uji'").get();
  ok('tenant baru dibuat setelah verifikasi', !!tOtp && /^[A-Z0-9]{4}$/.test(tOtp.school_code), tOtp && tOtp.school_code);
  ok('audit OTP tercatat di control plane',
    !!sdb.prepare("SELECT id FROM audit_log WHERE aksi LIKE 'OTP DAFTAR%'").get());

  /* sakelar OTP (Super Admin) */
  r = await req('GET', '/super-admin/branding', null, { cookie: cSa });
  ok('panel Super Admin memuat pengaturan OTP', /name="daftar_otp_aktif"/.test(r.text) && /name="daftar_otp_menit"/.test(r.text) && /name="daftar_otp_jeda"/.test(r.text));
  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU', daftar_otp_aktif: '0', daftar_otp_menit: '10', daftar_otp_jeda: '60', daftar_otp_demo: '1' }, { cookie: cSa });
  ok('OTP pendaftaran dapat dinonaktifkan', r.status === 303 && sdb.prepare("SELECT v FROM saas_settings WHERE k='daftar_otp_aktif'").get().v === '0');
  r = await req('GET', '/register');
  ok('form pendaftaran tanpa blok OTP saat dinonaktifkan', !/data-otp-box/.test(r.text) && !/id="btnDaftar"[^>]*disabled/.test(r.text));
  r = await req('POST', '/register', {
    nama: 'SD Tanpa OTP', admin_nama: 'Admin', admin_email: 'admin@tanpa-otp.sch.id',
    admin_password: 'rahasia123', admin_password2: 'rahasia123', jenjang: 'SD', telp: '081234560077', paket: 'basic'
  });
  ok('pendaftaran tanpa OTP berhasil saat sakelar mati', r.status === 303 && /welcome=1/.test(r.loc), r.loc);
  ok('tenant dibuat saat OTP dimatikan', !!sdb.prepare("SELECT id FROM tenants WHERE nama='SD Tanpa OTP'").get());
  r = await req('POST', '/super-admin/branding', { saas_nama: 'SIMKEU', daftar_otp_aktif: '1', daftar_otp_menit: '10', daftar_otp_jeda: '60', daftar_otp_demo: '1' }, { cookie: cSa });
  ok('OTP dinyalakan kembali', r.status === 303 && sdb.prepare("SELECT v FROM saas_settings WHERE k='daftar_otp_aktif'").get().v === '1');

  /* ================================================================
     3. HONOR EKSKUL — PERIODE HONOR vs BULAN POSTING BKU
     ================================================================ */
  console.log('\n[3] Honor ekskul — periode honor terpisah dari bulan posting BKU');
  const ta = tdb.prepare('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1').get();
  await req('POST', '/ta/pilih', { ta: ta.id }, { cookie: cT });
  const bku = tdb.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1").get(ta.id);
  ok('BKU aktif tersedia untuk posting', !!bku, bku && bku.nama);

  r = await req('GET', '/ekskul', null, { cookie: cT });
  ok('form input honor memuat Periode Kinerja/Honor', /Periode Kinerja \/ Honor/.test(r.text));
  ok('form input honor memuat Bulan Posting ke BKU', /Bulan Posting ke BKU/.test(r.text));

  /* input grid: honor Oktober 2025, dibukukan November 2025 */
  r = await req('POST', '/ekskul/save-grid', {
    jenis: 'Pramuka', periode: '2026-10', posting_periode: '2026-11',
    nama_pembina: ['Budi Santoso', 'Sari Dewi'],
    kehadiran: ['4', '3'], harga_satuan: ['50.000', '60.000'], keterangan: ['', 'latihan gabungan']
  }, { cookie: cT });
  ok('grid honor tersimpan', r.status === 303 && /ok=/.test(r.loc), r.loc);
  let rows = tdb.prepare("SELECT * FROM ekskul_honor WHERE periode='2026-10' ORDER BY id").all();
  ok('2 baris honor tersimpan', rows.length === 2, String(rows.length));
  ok('periode honor tetap 2026-10', rows.every(x => x.periode === '2026-10'));
  ok('bulan posting tersimpan 2026-11', rows.every(x => x.posting_periode === '2026-11'), JSON.stringify(rows.map(x => x.posting_periode)));

  r = await req('GET', '/ekskul?periode=2026-10', null, { cookie: cT });
  ok('daftar honor menampilkan kolom Bulan Posting BKU', /Bulan Posting BKU/.test(r.text));
  ok('daftar honor menampilkan November 2026 (bulan posting)', /November 2026/.test(r.text));
  ok('daftar honor menandai periode yang berbeda', /badge amber plain[^>]*title="Berbeda dari periode honor"/.test(r.text));

  r = await req('GET', '/ekskul/antrean', null, { cookie: cT });
  ok('antrean menampilkan judul periode honor', /Periode Honor Oktober 2026/.test(r.text));
  ok('antrean menyediakan input bulan posting per kelompok', /name="posting_periode" value="2026-11"/.test(r.text));

  /* bulan posting yang berbeda dari periode tetap menulis transaksi di bulan posting */
  r = await req('POST', '/ekskul/antrean/posting', {
    periode: '2026-10', jenis: 'Pramuka', bku_id: bku.id, posting_periode: '2026-11'
  }, { cookie: cT });
  ok('posting honor dengan bulan posting berbeda berhasil', r.status === 303 && /ok=/.test(r.loc), decodeURIComponent(r.loc).slice(0, 160));
  const trx = tdb.prepare("SELECT * FROM transaksi WHERE uraian LIKE '%Honor Pembina Ekstrakurikuler Pramuka%'").get();
  ok('transaksi BKU dibuat', !!trx);
  ok('tanggal transaksi = hari terakhir bulan posting (30 Nov 2026)', trx && trx.tanggal === '2026-11-30', trx && trx.tanggal);
  ok('uraian transaksi tetap menyebut periode honor Oktober 2026', trx && /Oktober 2026/.test(trx.uraian), trx && trx.uraian);
  ok('uraian mencatat bulan pembukuan November 2026', trx && /dibukukan November 2026/.test(trx.uraian), trx && trx.uraian);
  ok('nomor bukti memakai bulan posting (202611)', trx && /202611/.test(trx.no_bukti), trx && trx.no_bukti);
  ok('nominal transaksi = total honor (4×50.000 + 3×60.000)', trx && Number(trx.nominal) === 380000, trx && trx.nominal);
  rows = tdb.prepare("SELECT * FROM ekskul_honor WHERE periode='2026-10'").all();
  ok('semua item menjadi terposting', rows.every(x => x.status === 'posted'));
  ok('periode honor TIDAK berubah setelah posting', rows.every(x => x.periode === '2026-10'));
  ok('bulan posting tersimpan pada item', rows.every(x => x.posting_periode === '2026-11'));

  r = await req('GET', '/ekskul/antrean', null, { cookie: cT });
  ok('riwayat antrean memakai kolom Periode Honor & Bulan Posting', /Periode Honor/.test(r.text) && /Bulan Posting BKU/.test(r.text));
  ok('riwayat antrean menampilkan Oktober 2026 & November 2026', /Oktober 2026/.test(r.text) && /November 2026/.test(r.text));

  r = await req('GET', '/ekskul/export?periode=2026-10', null, { cookie: cT });
  ok('export Excel honor dibuat', r.status === 200 && r.buf.length > 1000, r.status + ' ' + r.buf.length);
  let header = [];
  try {
    const sheets = xr.readXlsx(r.buf);
    const flat = (sheets[0] || { rows: [] }).rows.map(row => row.map(c => xr.cellText(c)).join('|'));
    header = flat.filter(x => /PERIODE HONOR/.test(x));
  } catch (e) { header = []; }
  ok('export memuat kolom PERIODE HONOR & BULAN POSTING BKU', header.length === 1 && /BULAN POSTING BKU/.test(header[0]), header[0]);

  r = await req('GET', '/ekskul/cetak?periode=2026-10', null, { cookie: cT });
  ok('cetak memakai judul "Periode Honor"', /Periode Honor Oktober 2026/.test(r.text));
  ok('cetak mencantumkan "Dibukukan ke BKU November 2026"', /Dibukukan ke BKU November 2026/.test(r.text));

  /* ---- periode yang SUDAH DITUTUP tidak menghalangi posting di bulan lain ---- */
  tdb.prepare(`INSERT INTO bku_periode (bku_id,periode,saldo_awal,total_masuk,total_keluar,saldo_buku,saldo_akhir,
      metode,status,ditutup_at,ditutup_oleh,berita_acara_no)
    VALUES (?,?,0,0,0,0,0,'rollover','ditutup',?,?,?)`)
    .run(bku.id, '2026-10', '2026-10-31 23:00:00', 'admin', 'BA/OKT/2026');
  r = await req('POST', '/ekskul/save-grid', {
    jenis: 'PMR', periode: '2026-10', posting_periode: '2026-10',
    nama_pembina: ['Rina'], kehadiran: ['2'], harga_satuan: ['75.000'], keterangan: ['']
  }, { cookie: cT });
  ok('item honor baru untuk periode Oktober (BKU sudah ditutup) tersimpan', r.status === 303 && /ok=/.test(r.loc));
  r = await req('POST', '/ekskul/antrean/posting', {
    periode: '2026-10', jenis: 'PMR', bku_id: bku.id, posting_periode: '2026-10'
  }, { cookie: cT });
  ok('posting ke bulan yang SUDAH DITUTUP ditolak', r.status === 303 && /err=/.test(r.loc) && /ditutup|Tutup BKU/i.test(decodeURIComponent(r.loc)), decodeURIComponent(r.loc).slice(-160));
  r = await req('POST', '/ekskul/antrean/posting', {
    periode: '2026-10', jenis: 'PMR', bku_id: bku.id, posting_periode: '2026-11'
  }, { cookie: cT });
  ok('posting ke bulan BERIKUTNYA (belum ditutup) berhasil meski periode Oktober tertutup', r.status === 303 && /ok=/.test(r.loc), decodeURIComponent(r.loc).slice(-190));
  const trx2 = tdb.prepare("SELECT * FROM transaksi WHERE uraian LIKE '%Honor Pembina Ekstrakurikuler PMR%'").get();
  ok('transaksi PMR jatuh di November 2026, periode tetap Oktober', trx2 && trx2.tanggal === '2026-11-30' && /Oktober 2026/.test(trx2.uraian), trx2 && trx2.tanggal);

  /* bulan posting di luar tahun pelajaran BKU ditolak */
  r = await req('POST', '/ekskul/save-grid', {
    jenis: 'Futsal', periode: '2026-10', posting_periode: '2026-10',
    nama_pembina: ['Andi'], kehadiran: ['1'], harga_satuan: ['10.000'], keterangan: ['']
  }, { cookie: cT });
  ok('item honor Futsal tersimpan', r.status === 303 && /ok=/.test(r.loc));
  r = await req('POST', '/ekskul/antrean/posting', {
    periode: '2026-10', jenis: 'Futsal', bku_id: bku.id, posting_periode: '2030-01'
  }, { cookie: cT });
  ok('bulan posting di luar tahun pelajaran ditolak', r.status === 303 && /err=/.test(r.loc) && /tahun pelajaran/i.test(decodeURIComponent(r.loc)), decodeURIComponent(r.loc).slice(-150));

  /* edit item terposting tidak boleh memindahkan bulan posting */
  const postedRow = tdb.prepare("SELECT * FROM ekskul_honor WHERE jenis='Pramuka' ORDER BY id LIMIT 1").get();
  r = await req('POST', '/ekskul/save', {
    id: postedRow.id, jenis: 'Pramuka', nama_pembina: postedRow.nama_pembina,
    periode: '2026-10', posting_periode: '2026-12', kehadiran: '5', harga_satuan: '50.000', keterangan: ''
  }, { cookie: cT });
  const afterEdit = tdb.prepare('SELECT * FROM ekskul_honor WHERE id=?').get(postedRow.id);
  ok('bulan posting item terposting tidak berubah saat diedit', afterEdit.posting_periode === '2026-11', afterEdit.posting_periode);
  ok('nominal transaksi ikut tersinkron (5×50.000 + 3×60.000)', (() => {
    const t = tdb.prepare('SELECT * FROM transaksi WHERE id=?').get(trx.id);
    return Number(t.nominal) === 430000;
  })(), String((tdb.prepare('SELECT * FROM transaksi WHERE id=?').get(trx.id) || {}).nominal));
  ok('uraian tetap memuat periode honor & bulan posting',
    /Oktober 2026/.test(String((tdb.prepare('SELECT * FROM transaksi WHERE id=?').get(trx.id) || {}).uraian || '')));

  /* halaman tanpa error server */
  const errLines = log.split('\n').filter(l => /Unhandled|TypeError|ReferenceError|SyntaxError/.test(l));
  ok('tidak ada error server selama pengujian', errLines.length === 0, errLines.slice(0, 3).join(' | '));

  sdb.close(); tdb.close(); srv.kill('SIGTERM');
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => {
  console.error('FATAL', e);
  console.log(log.slice(-4000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
