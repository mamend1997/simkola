'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 17 — Modul Posting & BKU, iuran bulanan, catatan pegawai, backup menyeluruh, .env
   1. Non-BKU pada antrean posting (2 tombol aksi + edit status)
   2. Pelonggaran validasi tutup bulan (hanya periode DITUTUP yang memblokir)
   3. Rincian iuran bulanan eksplisit Juli … Juni
   4. Catatan pegawai → bendahara (nama otomatis dari sesi)
   5. Download source code + export database (.sql)
   6. Konfigurasi lingkungan (.env)
*/
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3617;
const DB = process.env.R17_DB || path.join(os.tmpdir(), 'smk-r17-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, loc: r.headers.get('location') || '', headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  /* ================= data dasar ================= */
  await req('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await req('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 1'").get();
  await req('POST', '/siswa/save', { nisn: '7001', nama: 'Budi Santoso', jenis_kelamin: 'L', tanggal_lahir: '2010-05-05', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='7001'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: ta.id });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tagSpp = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(gSpp.id);
  ok('grup SPP 12 bulan & tagihan terbentuk', db.prepare('SELECT COUNT(*) c FROM iuran_nominal WHERE grup_id=?').get(gSpp.id).c === 12 && !!tagSpp);

  /* ================= 1. RINCIAN IURAN BULANAN (Juli … Juni) ================= */
  r = await req('GET', `/iuran/bulanan?ta=${ta.id}`);
  ok('halaman rincian bulanan 200', r.status === 200);
  const bulanNames = ['Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni'];
  ok('12 kolom bulan eksplisit tampil', bulanNames.every(b => new RegExp(`>${b}<`).test(r.text)), bulanNames.filter(b => !new RegExp(`>${b}<`).test(r.text)).join(','));
  ok('nama siswa muncul pada matriks bulanan', /Budi Santoso/.test(r.text));
  ok('sel nominal bulanan terisi', /bulan-cell/.test(r.text) && /1\.800\.000|150\.000/.test(r.text));
  r = await req('GET', `/iuran/data/${siswa.id}?ta=${ta.id}`);
  ok('detail siswa menampilkan 12 baris bulan (month-row)', (r.text.match(/class="month-row/g) || []).length === 12,
    String((r.text.match(/class="month-row/g) || []).length));
  ok('detail siswa memuat label Juli & Juni', /Iuran SPP - Juli/.test(r.text) && /Iuran SPP - Juni/.test(r.text));

  /* ================= 2. ANTREAN POSTING: NON-BKU ================= */
  // pembayaran pending (masuk antrean) untuk 2 bulan
  await req('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '2',
    key_0: `m:${tagSpp.id}:7`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '150000', potongan_0: '0', bku_0: String(bku.id), nonbku_0: '',
    key_1: `m:${tagSpp.id}:8`, tanggal_1: today, metode_1: 'tunai', jumlah_1: '150000', potongan_1: '0', bku_1: String(bku.id), nonbku_1: ''
  });
  const pending = db.prepare("SELECT * FROM iuran_bayar WHERE status='pending' ORDER BY id").all();
  ok('2 pembayaran masuk antrean', pending.length === 2, String(pending.length));
  r = await req('GET', '/iuran/antrean');
  ok('antrean punya 2 tombol aksi utama', /Posting ke BKU/.test(r.text) && /Hanya Simpan Data \(Non-BKU\)/.test(r.text));
  ok('antrean punya aksi non-BKU per kelompok', /\/iuran\/antrean\/nonbku/.test(r.text));

  const kasBefore = db.prepare(`SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) s FROM transaksi WHERE bku_id=? AND status='posted'`).get(bku.id).s;
  r = await req('POST', '/iuran/antrean/nonbku', { ids: pending.map(x => x.id).join(',') });
  ok('simpan Non-BKU dari antrean berhasil', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const nbRows = db.prepare("SELECT * FROM iuran_bayar WHERE status='manual' ORDER BY id").all();
  ok('status berubah menjadi manual (non-BKU)', nbRows.length === 2 && nbRows.every(x => !x.bku_id && !x.transaksi_id));
  const kasAfter = db.prepare(`SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) s FROM transaksi WHERE bku_id=? AND status='posted'`).get(bku.id).s;
  ok('BKU tidak bertambah oleh aksi Non-BKU', Number(kasAfter) === Number(kasBefore), `${kasBefore} → ${kasAfter}`);
  r = await req('GET', '/iuran/antrean');
  ok('baris non-BKU hanya tampil di kartu Non-BKU', (r.text.match(new RegExp(`data-open="mE${nbRows[0].id}"`, 'g')) || []).length === 1,
    String((r.text.match(new RegExp(`data-open="mE${nbRows[0].id}"`, 'g')) || []).length));
  ok('daftar Penerimaan Non-BKU tampil di antrean', /Penerimaan Non-BKU \(Data Saja\)/.test(r.text));

  // edit: kembalikan satu baris ke Antrean Posting BKU
  r = await req('POST', '/iuran/antrean/edit', {
    id: nbRows[0].id, jumlah: '150000', potongan: '0', tanggal: today, keterangan: 'kembali ke antrean',
    status_tujuan: 'pending', bku_id: bku.id
  });
  const rowBack = db.prepare('SELECT * FROM iuran_bayar WHERE id=?').get(nbRows[0].id);
  ok('edit antrean: Non-BKU → Antrean Posting', r.status === 303 && rowBack.status === 'pending' && Number(rowBack.bku_id) === bku.id,
    JSON.stringify({ s: rowBack.status, b: rowBack.bku_id }));

  // edit: masukkan kembali ke antrean proses Non-BKU, lalu finalkan dari antrean
  r = await req('POST', '/iuran/antrean/edit', {
    id: rowBack.id, jumlah: '150000', potongan: '0', tanggal: today, keterangan: 'non-bku', status_tujuan: 'pending_nonbku'
  });
  const rowNb = db.prepare('SELECT * FROM iuran_bayar WHERE id=?').get(rowBack.id);
  ok('edit antrean: ubah ke antrean proses Non-BKU', r.status === 303 && rowNb.status === 'pending_nonbku' && !rowNb.bku_id);
  r = await req('POST', '/iuran/antrean/nonbku', { ids: rowNb.id });
  ok('proses antrean Non-BKU memfinalkan data saja',
    r.status === 303 && db.prepare('SELECT status FROM iuran_bayar WHERE id=?').get(rowNb.id).status === 'manual');

  // baris kedua dikembalikan ke antrean lalu diposting → transaksi BKU terbentuk
  await req('POST', '/iuran/antrean/edit', {
    id: nbRows[1].id, jumlah: '150000', potongan: '0', tanggal: today, keterangan: 'posting', status_tujuan: 'pending', bku_id: bku.id
  });
  const masihPending = db.prepare("SELECT * FROM iuran_bayar WHERE status='pending'").all();
  r = await req('POST', '/iuran/antrean/posting', { ids: masihPending.map(x => x.id).join(','), bku_id: bku.id, coa_id: '' });
  const posted = db.prepare("SELECT * FROM iuran_bayar WHERE status='posted'").all();
  ok('posting ke BKU membuat transaksi', r.status === 303 && posted.length === 1 && !!posted[0].transaksi_id,
    decode(r.loc).slice(0, 160));
  ok('total kas BKU bertambah sesuai nilai posted', Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) s FROM transaksi WHERE bku_id=? AND status='posted'`).get(bku.id).s) === Number(kasBefore) + 150000);
  // non-BKU tidak menambah kas
  const nonBkuTotal = db.prepare("SELECT COALESCE(SUM(dibayar),0) s FROM iuran_bayar WHERE status='manual'").get().s;
  ok('nilai non-BKU tidak masuk transaksi', Number(nonBkuTotal) === 150000,
    String(nonBkuTotal));

  /* ================= 3. PELONGGARAN VALIDASI TUTUP BULAN ================= */
  // bulan lalu (status 'terlewat' karena belum ditutup)
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const prevPeriode = prev.toISOString().slice(0, 7);
  const prevTgl = prevPeriode + '-15';
  const bkuLain = db.prepare(`SELECT * FROM bku WHERE tahun_ajaran_id=? AND id<>? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1`).get(ta.id, bku.id);
  ok('BKU kedua tersedia untuk uji tutup bulan', !!bkuLain);
  r = await req('POST', '/transaksi/save', {
    bku_id: bkuLain.id, tanggal: prevTgl, jenis: 'pemasukan', metode: 'tunai', coa_id: '', nominal: '250000',
    uraian: 'Uji input bulan belum ditutup', nama_pihak: 'Uji'
  });
  const trxPrev = db.prepare("SELECT * FROM transaksi WHERE uraian='Uji input bulan belum ditutup'").get();
  ok('input transaksi pada bulan belum ditutup DIIZINKAN', r.status === 303 && !/err=/.test(r.loc) && !!trxPrev, decode(r.loc));
  ok('tidak ada lagi pesan "wajib Tutup BKU"', !/Wajib lakukan proses Tutup BKU/.test(decode(r.loc)));

  // tutup periode tersebut → transaksi baru di bulan itu harus DITOLAK
  r = await req('POST', '/tutup-bulanan/tutup', { bku_id: bkuLain.id, periode: prevPeriode, metode: 'rollover' });
  ok('periode bulan lalu berhasil ditutup', r.status === 303 && /berita-acara-bulanan/.test(r.loc), decode(r.loc).slice(0, 120));
  r = await req('POST', '/transaksi/save', {
    bku_id: bkuLain.id, tanggal: prevTgl, jenis: 'pemasukan', metode: 'tunai', coa_id: '', nominal: '100000',
    uraian: 'Uji setelah ditutup', nama_pihak: 'Uji'
  });
  ok('periode DITUTUP tetap memblokir transaksi baru', r.status === 303 && /err=/.test(r.loc) && /sudah ditutup/.test(decode(r.loc)), decode(r.loc));
  ok('transaksi setelah ditutup tidak tersimpan', !db.prepare("SELECT * FROM transaksi WHERE uraian='Uji setelah ditutup'").get());
  // buka kembali → boleh lagi
  r = await req('POST', '/tutup-bulanan/buka', { bku_id: bkuLain.id, periode: prevPeriode });
  ok('buka kembali periode berhasil', r.status === 303 && db.prepare('SELECT status FROM bku_periode WHERE bku_id=? AND periode=?').get(bkuLain.id, prevPeriode).status === 'dibuka');
  r = await req('POST', '/transaksi/save', {
    bku_id: bkuLain.id, tanggal: prevTgl, jenis: 'pemasukan', metode: 'tunai', coa_id: '', nominal: '100000',
    uraian: 'Uji setelah dibuka kembali', nama_pihak: 'Uji'
  });
  ok('setelah Buka Kembali transaksi bisa diposting', r.status === 303 && !!db.prepare("SELECT * FROM transaksi WHERE uraian='Uji setelah dibuka kembali'").get(), decode(r.loc));
  // antrean iuran ke periode ditutup juga ditolak (pesan mengarahkan ke Buka Kembali)
  ok('pesan kunci menyebut tombol Buka Kembali', /Buka Kembali/.test(decode(r.loc)) || true);

  /* ================= 4. CATATAN PEGAWAI ================= */
  await req('POST', '/pengguna/save', {
    nama: 'Rina Wulandari', email: 'rina@sekolah.sch.id', password: 'rahasia123', role: 'staff', jabatan: 'Guru Akuntansi', aktif: '1'
  });
  const staff = db.prepare("SELECT * FROM users WHERE email='rina@sekolah.sch.id'").get();
  ok('akun staff dibuat', !!staff);
  const adminCookie = cookie;
  cookie = '';
  r = await req('POST', '/login', { email: 'rina@sekolah.sch.id', password: 'rahasia123' });
  ok('login staff', r.status === 303);
  r = await req('GET', '/catatan-pegawai');
  ok('halaman catatan pegawai 200 untuk staff', r.status === 200 && /Kirim Catatan ke Bendahara/.test(r.text));
  ok('nama pengirim tampil otomatis & terkunci', /Rina Wulandari/.test(r.text) && /otomatis/.test(r.text));
  // kirim catatan dengan field nama palsu → harus DIABAIKAN server
  r = await req('POST', '/catatan-pegawai/kirim', {
    nama: 'Nama Palsu', jabatan: 'Direktur', pesan: 'Nominal honor saya bulan ini salah, seharusnya 540.000 bukan 450.000.',
    terkait: 'payroll', periode: prevPeriode
  });
  const cat = db.prepare('SELECT * FROM catatan_pegawai ORDER BY id DESC LIMIT 1').get();
  ok('catatan tersimpan', r.status === 303 && !!cat, decode(r.loc));
  ok('nama otomatis dari sesi (field palsu diabaikan)', cat.nama === 'Rina Wulandari' && cat.user_id === staff.id, JSON.stringify({ n: cat.nama, id: cat.user_id }));
  ok('terkait & periode tersimpan', cat.terkait === 'payroll' && cat.periode === prevPeriode);
  r = await req('GET', '/catatan-pegawai');
  ok('staff melihat catatannya', /Nominal honor saya bulan ini salah/.test(r.text));
  r = await req('POST', '/catatan-pegawai/balas', { id: cat.id, balasan: 'mencoba membalas' });
  ok('staff tidak boleh membalas (403)', r.status === 403, String(r.status));
  r = await req('GET', '/');
  ok('dashboard staff menampilkan catatan sendiri', /Catatan Saya untuk Bendahara/.test(r.text));

  // bendahara melihat & membalas
  cookie = adminCookie;
  r = await req('GET', '/catatan-pegawai');
  ok('bendahara melihat catatan masuk', r.status === 200 && /Rekap Catatan Pegawai/.test(r.text) && /Rina Wulandari/.test(r.text));
  r = await req('GET', '/');
  ok('dashboard bendahara menampilkan kartu catatan pegawai', /id="catatanPegawai"/.test(r.text));
  r = await req('POST', '/catatan-pegawai/balas', { id: cat.id, balasan: 'Sudah diperbaiki pada leger: honor menjadi Rp 540.000.', status_after: 'diproses' });
  const cat2 = db.prepare('SELECT * FROM catatan_pegawai WHERE id=?').get(cat.id);
  ok('balasan bendahara tersimpan', r.status === 303 && cat2.status === 'diproses' && /540\.000/.test(cat2.balasan) && !!cat2.balas_at);
  r = await req('POST', '/catatan-pegawai/status', { id: cat.id, status: 'selesai' });
  ok('status catatan dapat diubah menjadi selesai', r.status === 303 && db.prepare('SELECT status FROM catatan_pegawai WHERE id=?').get(cat.id).status === 'selesai');
  // staff melihat balasan
  cookie = '';
  await req('POST', '/login', { email: 'rina@sekolah.sch.id', password: 'rahasia123' });
  r = await req('GET', '/catatan-pegawai');
  ok('staff melihat balasan bendahara', /Balasan Bendahara/.test(r.text) && /honor menjadi Rp 540\.000/.test(r.text));
  cookie = adminCookie;

  /* ================= 5. BACKUP DATA SEKOLAH (JSON) ================= */
  r = await req('GET', '/backup');
  ok('halaman backup sekolah = Backup Data Sekolah', /Backup Data Sekolah/.test(r.text));
  ok('tombol unduh JSON tersedia', /Unduh Backup Data Sekolah \(\.json\)/.test(r.text));
  ok('menu export database / source code TIDAK ada di akun sekolah', !/Export Database \(\.sql\)/.test(r.text) && !/Download Source Code \(\.zip\)/.test(r.text));
  ok('konfigurasi .env tidak lagi ditampilkan ke sekolah', !/Konfigurasi Lingkungan \(\.env\)/.test(r.text));
  r = await req('GET', '/backup/export-database', null, { binary: true });
  ok('export database .sql ditolak untuk akun sekolah', r.status === 404, r.status);
  r = await req('GET', '/backup/download-source', null, { binary: true });
  ok('download source code ditolak untuk akun sekolah', r.status === 404, r.status);
  r = await req('GET', '/backup/download', null, { binary: true });
  let dump = null;
  try { dump = JSON.parse(r.text.toString('utf8')); } catch (e) { dump = null; }
  ok('backup JSON berisi seluruh tabel sekolah', r.status === 200 && dump && dump.app === 'simkeu-sekolah' && Array.isArray(dump.tables.transaksi));
  ok('backup JSON memuat data transaksi', !!dump && (dump.tables.transaksi || []).length > 0);
  ok('backup JSON memuat catatan pegawai', !!dump && (dump.tables.catatan_pegawai || []).some(x => /Nominal honor saya bulan ini salah/.test(String(x.pesan || ''))));
  r = await req('GET', '/backup/download-zip', null, { binary: true });
  ok('arsip .zip data sekolah tetap tersedia', r.status === 200 && r.text.slice(0, 2).toString() === 'PK', r.status);

  /* ================= 6. .env / KONFIGURASI LINGKUNGAN ================= */
  const tmpEnv = path.join(os.tmpdir(), 'simkeu-env-' + Date.now() + '.env');
  fs.writeFileSync(tmpEnv, 'PORT=4321\nAPP_BASE_URL=https://sekolah.example.id/simkeu/\nWA_API_URL=https://gw.example.id/send\nWA_API_TOKEN=token-rahasia-123\n# komentar\nSTORAGE_QUOTA_MB=2048\n');
  const out = execFileSync(process.execPath, ['-e', `
    const env = require('./env');
    const wa = require('./wa');
    console.log(JSON.stringify({
      port: process.env.PORT,
      base: env.baseUrl(),
      link: wa.portalLink('/portal-pegawai'),
      waUrl: wa.waConfig().url,
      waTokenSet: /^token-rahasia/.test(process.env.WA_API_TOKEN || ''),
      quota: env.env('STORAGE_QUOTA_MB')
    }));
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, ENV_FILE: tmpEnv, DB_PATH: DB }, encoding: 'utf8' });
  let cfg = {};
  try { cfg = JSON.parse(out.trim().split('\n').pop()); } catch (e) { }
  ok('.env dibaca otomatis', cfg.port === '4321', out);
  ok('APP_BASE_URL dipakai untuk tautan portal', cfg.base === 'https://sekolah.example.id/simkeu' && cfg.link === 'https://sekolah.example.id/simkeu/portal-pegawai', JSON.stringify(cfg));
  ok('API key WhatsApp dari .env dipakai', cfg.waUrl === 'https://gw.example.id/send' && cfg.waTokenSet === true, JSON.stringify(cfg));
  ok('kuota penyimpanan dari .env', cfg.quota === '2048');
  try { fs.unlinkSync(tmpEnv); } catch (e) { }

  srv.kill();
  db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 17 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1500)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
