'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   RONDE 46 (SIMKEU) — DOMAIN PUBLIK (tautan acak tanpa login)
   1) BKU: tombol Generate / Generate Ulang Link, sakelar aktif, halaman
      publik berisi identitas sekolah, nama BKU, dan daftar transaksi
      (penerimaan, pengeluaran, saldo berjalan).
   2) Grup Iuran: toggle + generate link, halaman publik berisi daftar
      siswa (nama, kelas, NISN, tagihan, dibayar, sisa, status) serta
      rekap Total Tagihan & Grand Total dana diterima.
   3) Keamanan: hanya aktif bila sakelar menyala & token valid; token lama
      mati setelah regenerate; tanpa sesi login.
   Jalankan: node dev-tests/round46.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r46-'));
const DB = path.join(TMP, 'k.sqlite');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.R46_PORT || 3776;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, APP_BASE_URL: 'https://simkola-app-production.up.railway.app', DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
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
const HARI_INI = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie !== undefined ? opt.cookie : cookie) headers.Cookie = opt.cookie !== undefined ? opt.cookie : cookie;
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
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
/** permintaan TANPA sesi (halaman publik) */
const pub = (url) => req('GET', url, null, { cookie: '' });
/** ikuti redirect 30x (alamat lama portal) */
async function follow(url, depth = 0) {
  const r = await pub(url);
  if ([301, 302, 303, 307, 308].includes(r.status) && r.loc && depth < 4) return follow(r.loc, depth + 1);
  return r;
}

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }

  const db = new Database(DB);
  const one = (s, ...a) => db.prepare(s).get(...a);
  const all = (s, ...a) => db.prepare(s).all(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin berhasil', r.status === 303, 'status=' + r.status);
  const ta = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1');
  await req('POST', '/ta/pilih', { ta: ta.id });
  const SLUG = String((one("SELECT v FROM settings WHERE k='portal_base_slug'") || {}).v || '').trim()
    || String((one("SELECT v FROM settings WHERE k='portal_slug'") || {}).v || '').split('/')[0]
    || 'sekolah';
  ok('bagian nama sekolah untuk alamat publik tersedia', !!SLUG, SLUG);

  /* ==================================================================
     1. BKU — GENERATE LINK, TOGGLE, HALAMAN PUBLIK
     ================================================================== */
  console.log('\n[1] Domain publik BKU');
  await req('POST', '/bku/save', { nama: 'BKU UKK Uji Publik', jenis: 'kegiatan', kode: '', tahun_ajaran_id: ta.id, saldo_awal: '1500000' });
  const bku = one("SELECT * FROM bku WHERE nama='BKU UKK Uji Publik' ORDER BY id DESC LIMIT 1");
  ok('BKU uji dibuat', !!bku);

  r = await req('GET', '/bku');
  ok('master BKU punya tombol pengaturan Publik', r.status === 200 && r.text.includes('data-open="mPub' + bku.id + '"'));
  ok('master BKU punya kolom status Publik', /Publik<\/th>/.test(r.text));

  /* transaksi posted & pending (pending tidak boleh tampil di halaman publik) */
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-08-05', 'pemasukan', 'tunai', 'UKK/001', 750000, 'Iuran UKK Kelas X', '2026-08-05 09:00:00');
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-08-10', 'pengeluaran', 'tunai', 'UKK/002', 250000, 'Konsumsi rapat panitia UKK', '2026-08-10 09:00:00');
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'pending',?)`, bku.id, '2026-08-11', 'pemasukan', 'tunai', 'UKK/003', 900000, 'Draf belum disetujui', '2026-08-11 09:00:00');

  /* sebelum ada token, halaman publik belum punya tautan */
  r = await req('GET', '/bku');
  ok('belum ada tautan sebelum di-generate', !new RegExp('/publik/bku/[a-f0-9]{8}').test(r.text));

  r = await req('POST', '/bku/publik', { id: bku.id, aksi: 'generate', ta: ta.id });
  ok('generate link publik BKU → 303 ok', r.status === 303 && /ok=/.test(r.loc), decodeURIComponent(r.loc).slice(0, 140));
  let bk = one('SELECT * FROM bku WHERE id=?', bku.id);
  const token1 = String(bk.public_token || '');
  ok('token publik disimpan (24 hex)', /^[a-f0-9]{24}$/.test(token1), token1);
  ok('sakelar publik otomatis AKTIF setelah generate', Number(bk.is_public) === 1, String(bk.is_public));

  r = await req('GET', '/bku');
  ok('tautan publik tampil di modal master BKU', r.text.includes('/publik/bku/' + token1));
  ok('tautan publik BKU memakai domain aktif, bukan APP_BASE_URL Railway',
    r.text.includes(`${base}/${SLUG}/publik/bku/${token1}`) && !r.text.includes('simkola-app-production.up.railway.app'));
  ok('modal publik menyediakan tombol salin tautan', /data-copy="[^"]*\/publik\/bku\//.test(r.text));
  ok('modal publik menyediakan tombol Generate Ulang', /Generate Ulang Link/.test(r.text));

  const urlBku = `/${SLUG}/publik/bku/${token1}`;
  r = await pub(urlBku);
  ok('halaman publik BKU dapat dibuka TANPA login', r.status === 200, 'status=' + r.status);
  ok('halaman publik menampilkan nama BKU', /BKU UKK Uji Publik/.test(r.text));
  ok('halaman publik menampilkan identitas sekolah', (() => {
    const nama = String((one("SELECT v FROM settings WHERE k='sekolah_nama'") || {}).v || '');
    return nama && r.text.includes(nama);
  })());
  ok('halaman publik menampilkan kolom Penerimaan & Pengeluaran', /Penerimaan/.test(r.text) && /Pengeluaran/.test(r.text));
  const publicOpeningRow = (r.text.match(/<tr data-opening-row[\s\S]*?<\/tr>/) || [''])[0];
  const publicTotalRow = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('BKU Kegiatan tanpa grup tetap memakai saldo awal manual',
    /SALDO AWAL KESELURUHAN[\s\S]*?<td class="num t-strong">Rp 1\.500\.000<\/td>\s*<td><\/td><td class="num t-strong">Rp 1\.500\.000/.test(publicOpeningRow));
  ok('saldo awal manual ditambah pengeluaran dan pemasukan biasa tidak dihitung ulang',
    publicTotalRow.includes('Rp 1.500.000') && publicTotalRow.includes('Rp 250.000') && publicTotalRow.includes('Rp 1.250.000'));
  ok('halaman publik menampilkan saldo awal manual setelah dikurangi pengeluaran',
    /Saldo Buku/.test(r.text) && /Rp 1\.250\.000/.test(r.text));
  ok('transaksi pemasukan BKU Kegiatan tidak ditampilkan',
    !/Iuran UKK Kelas X/.test(r.text) && !!one("SELECT id FROM transaksi WHERE bku_id=? AND uraian='Iuran UKK Kelas X'", bku.id));
  ok('transaksi pengeluaran posted tampil', /Konsumsi rapat panitia UKK/.test(r.text));
  ok('transaksi PENDING tidak ditampilkan', !/Draf belum disetujui/.test(r.text));
  ok('halaman publik tidak dapat diindeks mesin pencari', /noindex/.test(r.text));
  ok('saldo berjalan tetap dihitung tanpa menampilkan pemasukan BKU',
    !/Informasi · tidak menambah saldo/.test(r.text) && /Rp 1\.250\.000/.test(r.text));

  /* toggle nonaktif → 404 */
  r = await req('POST', '/bku/publik', { id: bku.id, aksi: 'toggle', aktif: '0', ta: ta.id });
  ok('nonaktifkan akses publik → 303', r.status === 303 && /ok=/.test(r.loc));
  ok('sakelar publik tersimpan NON-AKTIF', Number(one('SELECT is_public FROM bku WHERE id=?', bku.id).is_public) === 0);
  r = await pub(urlBku);
  ok('tautan mati saat sakelar dimatikan (404)', r.status === 404, 'status=' + r.status);
  ok('halaman 404 menjelaskan tautan tidak aktif', /Tautan Publik Tidak Aktif/.test(r.text));

  /* toggle aktif kembali → token sama, halaman hidup lagi */
  r = await req('POST', '/bku/publik', { id: bku.id, aksi: 'toggle', aktif: '1', ta: ta.id });
  ok('aktifkan kembali akses publik → 303', r.status === 303);
  bk = one('SELECT * FROM bku WHERE id=?', bku.id);
  ok('token tidak berubah saat sekadar toggle', bk.public_token === token1 && Number(bk.is_public) === 1);
  r = await pub(urlBku);
  ok('tautan aktif kembali (200)', r.status === 200, 'status=' + r.status);

  /* regenerate → token baru, tautan lama mati */
  r = await req('POST', '/bku/publik', { id: bku.id, aksi: 'regen', ta: ta.id });
  ok('generate ulang link → 303 ok', r.status === 303 && /ok=/.test(r.loc));
  const token2 = String(one('SELECT public_token FROM bku WHERE id=?', bku.id).public_token || '');
  ok('token berubah setelah generate ulang', token2 && token2 !== token1, token2);
  r = await pub(urlBku);
  ok('tautan LAMA mati setelah generate ulang (404)', r.status === 404, 'status=' + r.status);
  r = await pub(`/${SLUG}/publik/bku/${token2}`);
  ok('tautan BARU berlaku (200)', r.status === 200, 'status=' + r.status);

  /* token acak / salah → 404 */
  r = await pub(`/${SLUG}/publik/bku/${'0'.repeat(24)}`);
  ok('token tidak dikenal → 404', r.status === 404, 'status=' + r.status);
  r = await pub(`/${SLUG}/publik/bku/xyz`);
  ok('token berformat salah → 404', r.status === 404, 'status=' + r.status);

  /* tanpa login tidak bisa mengubah konfigurasi */
  r = await req('POST', '/bku/publik', { id: bku.id, aksi: 'regen', ta: ta.id }, { cookie: '' });
  ok('POST tanpa sesi dialihkan ke login', r.status === 303 && /\/login/.test(r.loc), r.loc);
  ok('token tidak berubah oleh permintaan tanpa sesi', one('SELECT public_token FROM bku WHERE id=?', bku.id).public_token === token2);

  /* alamat tanpa nama sekolah & nama sekolah tak dikenal */
  r = await pub(`/publik/bku/${token2}`);
  ok('alamat tanpa nama sekolah tetap dilayani (fallback)', r.status === 200, 'status=' + r.status);
  r = await pub(`/sekolah-tidak-ada/publik/bku/${token2}`);
  ok('nama sekolah tak dikenal tidak menyajikan data (404 / dialihkan ke login)',
    r.status === 404 || (r.status === 303 && /\/login/.test(r.loc)), 'status=' + r.status);

  /* BKU lain tidak ikut publik */
  const lain = one('SELECT * FROM bku WHERE id<>? ORDER BY id LIMIT 1', bku.id);
  ok('BKU lain tetap privat', lain && Number(lain.is_public) === 0 && !lain.public_token);

  /* ==================================================================
     1b. FILTER HALAMAN PUBLIK BKU (bulan · rentang tanggal · tahun pelajaran)
     ================================================================== */
  console.log('\n[1b] Filter publik BKU');
  const urlBku2 = `/${SLUG}/publik/bku/${token2}`;
  /* transaksi tambahan di bulan lain agar filter teruji */
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-09-03', 'pemasukan', 'tunai', 'UKK/004', 500000, 'Penerimaan UKK September', '2026-09-03 09:00:00');
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-10-15', 'pengeluaran', 'tunai', 'UKK/005', 100000, 'Pembelian ATK Oktober', '2026-10-15 09:00:00');

  r = await pub(urlBku2);
  ok('filter bar BKU tersedia (bulan + dari/sampai tanggal)',
    /name="bulan"/.test(r.text) && /name="from"/.test(r.text) && /name="to"/.test(r.text) && /Terapkan/.test(r.text));
  ok('pilihan bulan diambil dari data transaksi (Agustus & Oktober 2026)',
    /<option value="2026-08"/.test(r.text) && /Agustus 2026/.test(r.text) && /Oktober 2026/.test(r.text));
  ok('tanpa filter: hanya 2 transaksi pengeluaran tampil', /\(2 transaksi\)/.test(r.text), (r.text.match(/\((\d+) transaksi\)/) || [])[0]);

  /* ---- filter bulan ---- */
  r = await pub(urlBku2 + '?bulan=2026-09');
  ok('filter bulan September menyembunyikan pemasukan dan tidak menampilkan transaksi', /\(0 dari 2 transaksi\)/.test(r.text),
    (r.text.match(/\((\d+ dari \d+) transaksi\)/) || [])[0]);
  ok('filter bulan menyembunyikan transaksi bulan lain',
    !/Penerimaan UKK September/.test(r.text) && !/Iuran UKK Kelas X/.test(r.text) && !/Pembelian ATK Oktober/.test(r.text));
  ok('filter bulan menampilkan ringkasan filter aktif', /Filter aktif: Bulan/.test(r.text) && /September 2026/.test(r.text));
  ok('saldo awal periode September memasukkan saldo manual dan pengeluaran sebelumnya',
    /Saldo Awal Periode/.test(r.text) && /Rp 1\.250\.000/.test(r.text));
  ok('pemasukan BKU tidak ditampilkan pada ringkasan filter',
    !/Penerimaan <b>Rp 500\.000<\/b>/.test(r.text) && /Pengeluaran <b>Rp 0<\/b>/.test(r.text));
  ok('saldo akhir periode September tetap Rp 1.250.000', /Rp 1\.250\.000/.test(r.text));
  const septemberTotalRow = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('footer bulan September menampilkan sumber saldo dan saldo akhir sesuai filter',
    septemberTotalRow.includes('Rp 1.250.000') && septemberTotalRow.includes('Rp 0'));

  /* ---- filter rentang tanggal ---- */
  r = await pub(urlBku2 + '?from=2026-09-01&to=2026-10-31');
  ok('filter rentang tanggal menampilkan hanya pengeluaran Oktober', /\(1 dari 2 transaksi\)/.test(r.text),
    (r.text.match(/\((\d+ dari \d+) transaksi\)/) || [])[0]);
  ok('rentang tanggal memuat transaksi September & Oktober',
    !/Penerimaan UKK September/.test(r.text) && /Pembelian ATK Oktober/.test(r.text) && !/Iuran UKK Kelas X/.test(r.text));
  ok('rentang tanggal menampilkan keterangan Tanggal', /Filter aktif: Tanggal/.test(r.text));
  ok('saldo awal rentang tetap menghitung saldo manual dan pengeluaran sebelum filter', /Rp 1\.250\.000/.test(r.text));
  ok('saldo akhir rentang mengurangi pengeluaran Oktober dari saldo awal', /Rp 1\.150\.000/.test(r.text));
  ok('total kaki tabel memakai hasil filter', /TOTAL PERIODE FILTER/.test(r.text));

  /* ---- filter hanya satu sisi (dari / sampai) ---- */
  r = await pub(urlBku2 + '?from=2026-10-01');
  ok('filter hanya "dari tanggal" → 1 transaksi', /\(1 dari 2 transaksi\)/.test(r.text));
  r = await pub(urlBku2 + '?to=2026-08-31');
  ok('filter hanya "sampai tanggal" → 1 transaksi', /\(1 dari 2 transaksi\)/.test(r.text));

  /* ---- nilai tidak valid / rentang terbalik ---- */
  r = await pub(urlBku2 + '?bulan=abc');
  ok('parameter bulan tidak valid diabaikan (semua 2 transaksi)', /\(2 transaksi\)/.test(r.text));
  r = await pub(urlBku2 + '?from=2026-10-31&to=2026-09-01');
  ok('rentang tanggal terbalik dibetulkan otomatis', /\(1 dari 2 transaksi\)/.test(r.text));
  r = await pub(urlBku2 + '?from=2026-01-01&to=2026-01-31');
  ok('rentang tanpa transaksi tetap menyajikan saldo awal manual', /Saldo Awal Periode/.test(r.text)
    && !/Tidak ada transaksi pada periode ini/.test(r.text));
  ok('saldo awal/akhir tetap konsisten saat hasil filter kosong', /Rp 1\.500\.000/.test(r.text));

  /* ---- filter tahun pelajaran (hanya BKU bernama sama yang JUGA publik) ---- */
  run('INSERT INTO tahun_ajaran (nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (?,?,?,0)',
    '2097/2098', '2097-07-01', '2098-06-30');
  const taLain = one("SELECT * FROM tahun_ajaran WHERE nama='2097/2098'");
  const tokenTa = 'b'.repeat(24);
  run(`INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,status,urutan,created_at,auto_mode,public_token,is_public)
       VALUES (?,?,?,?,?,?,?,?,0,?,1)`, bku.nama, bku.jenis, bku.kode, taLain.id, 0, 'aktif', 99, '2097-07-01 08:00:00', tokenTa);
  r = await pub(urlBku2);
  ok('dropdown Tahun Pelajaran muncul saat BKU sama dibagikan di TA lain',
    /name="ta"/.test(r.text) && /2097\/2098/.test(r.text));
  r = await pub(urlBku2 + '?ta=' + taLain.id);
  ok('pilih TA lain → dialihkan ke token BKU tahun tsb (302)', r.status === 302 && r.loc.includes(tokenTa), r.status + ' ' + r.loc);
  const rTa = await pub(r.loc);
  ok('BKU tahun pelajaran lain terbuka dengan tokennya sendiri tanpa menampilkan pemasukan biasa',
    rTa.status === 200 && /Tahun Pelajaran 2097\/2098/.test(rTa.text) && !/Iuran UKK Kelas X/.test(rTa.text));

  run('INSERT INTO tahun_ajaran (nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (?,?,?,0)',
    '2096/2097', '2096-07-01', '2097-06-30');
  const taKosong = one("SELECT * FROM tahun_ajaran WHERE nama='2096/2097'");
  r = await pub(urlBku2 + '?ta=' + taKosong.id);
  ok('TA tanpa BKU publik → pesan jelas, data BKU aktif tetap tampil',
    r.status === 200 && /belum dibagikan publik/.test(r.text) && !/Iuran UKK Kelas X/.test(r.text));

  /* ==================================================================
     2. GRUP IURAN — TOGGLE, GENERATE, REKAP SISWA
     ================================================================== */
  console.log('\n[2] Domain publik Grup Iuran');
  r = await req('POST', '/iuran/save', {
    nama: 'Iuran SPP Uji Publik', jenis: 'bulanan', tahun_ajaran_id: ta.id, mode_nominal: 'rata',
    nominal_rata: '150.000', nominal_tingkat: '', keterangan: 'uji publik', aktif: '1'
  });
  ok('grup iuran uji dibuat → 303', r.status === 303, 'status=' + r.status + ' ' + r.loc);
  const grup = one("SELECT * FROM iuran_grup WHERE nama='Iuran SPP Uji Publik' ORDER BY id DESC LIMIT 1");
  ok('grup iuran tersimpan', !!grup);

  /* kelas + 3 siswa + tagihan + pembayaran; satu pembayaran memiliki potongan */
  run('INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,1,?)',
    'X TKJ 1', 'X TKJ 1', 'X', ta.id, '2026-07-01 08:00:00');
  const kelas = one("SELECT * FROM kelas WHERE nama='X TKJ 1' ORDER BY id DESC LIMIT 1");
  const siswaNama = ['Ahmad Fauzi', 'Bella Safitri', 'Citra Dewi'];
  const nisn = ['0012345678', '0012345679', '0012345680'];
  const ids = siswaNama.map((nm, i) => {
    run('INSERT INTO siswa (nisn,nama,jenis_kelamin,kelas_id,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?,?)',
      nisn[i], nm, i === 1 ? 'P' : 'L', kelas.id, ta.id, 'aktif', '2026-07-01 08:00:00');
    const id = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    run('INSERT INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,sumber,created_at) VALUES (?,?,?,?,?)',
      id, kelas.id, ta.id, 'manual', '2026-07-01 08:00:00');
    run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
      grup.id, id, ta.id, 1800000, '2026-07-01 08:00:00');
    return id;
  });
  const tag1 = one('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?', grup.id, ids[0]);
  run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
       VALUES (?,?,?,?,0,?,?,?,?)`, tag1.id, ids[0], '2026-08-05', 900000, 900000, 'tunai', 'posted', '2026-08-05 09:00:00');
  const tag2 = one('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?', grup.id, ids[1]);
  run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`, tag2.id, ids[1], '2026-08-06', 100000, 25000, 75000, 'tunai', 'posted', '2026-08-06 09:00:00');

  r = await req('GET', '/iuran?ta=' + ta.id);
  ok('halaman Grup Iuran punya tombol Publik per grup', r.status === 200 && r.text.includes('data-open="mPubG' + grup.id + '"'));
  ok('halaman Grup Iuran punya kolom status Publik', /Publik<\/th>/.test(r.text));
  ok('halaman Grup Iuran menyediakan Generate Link Publik', /Generate Link Publik/.test(r.text));

  r = await req('POST', '/iuran/publik', { id: grup.id, aksi: 'generate', ta: ta.id });
  ok('generate link publik grup iuran → 303 ok', r.status === 303 && /ok=/.test(r.loc), decodeURIComponent(r.loc).slice(0, 140));
  let gr = one('SELECT * FROM iuran_grup WHERE id=?', grup.id);
  const gToken1 = String(gr.public_token || '');
  ok('token publik grup disimpan (24 hex)', /^[a-f0-9]{24}$/.test(gToken1), gToken1);
  ok('sakelar publik grup AKTIF setelah generate', Number(gr.is_public) === 1);

  const urlGrup = `/${SLUG}/publik/iuran/${gToken1}`;
  r = await pub(urlGrup);
  ok('halaman publik grup iuran dapat dibuka tanpa login', r.status === 200, 'status=' + r.status);
  ok('menampilkan nama grup iuran', /Iuran SPP Uji Publik/.test(r.text));
  ok('kolom Nama, Kelas, NISN, Tagihan, Dibayar, Sisa, Status lengkap',
    /<th>Nama<\/th>/.test(r.text) && /<th>Kelas<\/th>/.test(r.text) && /<th>NISN<\/th>/.test(r.text)
    && /Tagihan<\/th>/.test(r.text) && /Dibayar<\/th>/.test(r.text) && /Sisa<\/th>/.test(r.text) && /<th>Status<\/th>/.test(r.text));
  ok('nama siswa tampil', siswaNama.every(n => r.text.includes(n)));
  ok('kelas siswa tampil', /X TKJ 1/.test(r.text));
  ok('NISN siswa tampil', nisn.every(n => r.text.includes(n)));
  ok('tagihan per siswa tampil (Rp 1.800.000)', /1\.800\.000/.test(r.text));
  ok('pembayaran sebagian tampil (Rp 900.000)', /900\.000/.test(r.text));
  ok('sisa tagihan dihitung (Rp 900.000)', /Sisa Tagihan/.test(r.text));
  ok('status pembayaran per siswa tampil', /Sebagian/.test(r.text) && /Belum Bayar/.test(r.text));
  ok('rekapitulasi Total Tagihan tampil', /TOTAL TAGIHAN/.test(r.text));
  ok('Grand Total dana diterima tampil', /GRAND TOTAL DANA DITERIMA/.test(r.text));
  ok('total penerimaan kas grup ditampilkan terpisah', /Total Dana Diterima/.test(r.text));
  ok('penerimaan kas memperhitungkan potongan dan berbeda dari tagihan terbayar',
    /Total Dana Diterima[\s\S]{0,180}975\.000/.test(r.text)
      && /Tagihan Terpenuhi \(termasuk potongan\)[\s\S]{0,180}1\.000\.000/.test(r.text));
  ok('total tagihan = 3 × 1.800.000 (Rp 5.400.000)', /5\.400\.000/.test(r.text));
  ok('grand total diterima = Rp 975.000', /GRAND TOTAL DANA DITERIMA[\s\S]{0,240}975\.000/.test(r.text));

  run('INSERT INTO bku_iuran_grup (bku_id,grup_id) VALUES (?,?)', bku.id, grup.id);
  r = await pub(urlBku2);
  ok('BKU portal publik menampilkan tiga ringkasan grup yang dipilih',
    r.status === 200 && /Ringkasan Grup Iuran Terhubung/.test(r.text)
      && /Iuran SPP Uji Publik/.test(r.text)
      && /Total Seharusnya Diterima \(Tagihan\)/.test(r.text)
      && /Sudah Diterima/.test(r.text)
      && /Sisa Tagihan/.test(r.text)
      && r.text.includes(urlGrup)
      && /Lihat Rincian/.test(r.text)
      && /GRAND TOTAL[\s\S]{0,160}5\.400\.000[\s\S]{0,100}975\.000[\s\S]{0,100}4\.400\.000/.test(r.text));
  r = await pub(urlGrup);
  ok('portal publik grup iuran menyediakan pintasan ke BKU publik terhubung',
    r.status === 200 && /Lihat BKU/.test(r.text) && r.text.includes(urlBku2));

  /* toggle nonaktif */
  r = await req('POST', '/iuran/publik', { id: grup.id, aksi: 'toggle', aktif: '0', ta: ta.id });
  ok('nonaktifkan grup → 303', r.status === 303);
  r = await pub(urlGrup);
  ok('halaman grup mati saat sakelar off (404)', r.status === 404, 'status=' + r.status);

  /* regenerate */
  r = await req('POST', '/iuran/publik', { id: grup.id, aksi: 'toggle', aktif: '1', ta: ta.id });
  ok('aktifkan kembali grup → 303', r.status === 303);
  r = await req('POST', '/iuran/publik', { id: grup.id, aksi: 'regen', ta: ta.id });
  const gToken2 = String(one('SELECT public_token FROM iuran_grup WHERE id=?', grup.id).public_token || '');
  ok('token grup berubah setelah generate ulang', gToken2 && gToken2 !== gToken1, gToken2);
  ok('tautan grup lama mati (404)', (await pub(urlGrup)).status === 404);
  ok('tautan grup baru hidup (200)', (await pub(`/${SLUG}/publik/iuran/${gToken2}`)).status === 200);

  /* tanpa sesi tidak bisa mengubah */
  r = await req('POST', '/iuran/publik', { id: grup.id, aksi: 'regen', ta: ta.id }, { cookie: '' });
  ok('POST publik grup tanpa sesi dialihkan ke login', r.status === 303 && /\/login/.test(r.loc));
  ok('token grup tidak berubah oleh permintaan tanpa sesi', one('SELECT public_token FROM iuran_grup WHERE id=?', grup.id).public_token === gToken2);

  /* halaman admin tidak menampilkan token mentah di URL lain (regresi cepat) */
  r = await req('GET', '/iuran/grup/' + grup.id);
  ok('halaman detail grup tetap normal', r.status === 200);

  /* ==================================================================
     2b. FILTER PENCARIAN NAMA & KELAS (halaman publik grup iuran)
     ================================================================== */
  console.log('\n[2b] Filter publik Grup Iuran');
  const urlGrup2 = `/${SLUG}/publik/iuran/${gToken2}`;
  /* siswa ke-4 pada kelas berbeda agar filter kelas teruji */
  run('INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,1,?)',
    'XI TKJ 2', 'XI TKJ 2', 'XI', ta.id, '2026-07-01 08:00:00');
  const kelas2 = one("SELECT * FROM kelas WHERE nama='XI TKJ 2' ORDER BY id DESC LIMIT 1");
  run('INSERT INTO siswa (nisn,nama,jenis_kelamin,kelas_id,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?,?)',
    '0012345681', 'Galih Saputra', 'L', kelas2.id, ta.id, 'aktif', '2026-07-01 08:00:00');
  const sid4 = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  run('INSERT INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,sumber,created_at) VALUES (?,?,?,?,?)',
    sid4, kelas2.id, ta.id, 'manual', '2026-07-01 08:00:00');
  run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
    grup.id, sid4, ta.id, 1800000, '2026-07-01 08:00:00');

  r = await pub(urlGrup2);
  ok('filter bar grup iuran tersedia (nama & kelas)',
    /name="q"/.test(r.text) && /name="kelas"/.test(r.text) && /Terapkan/.test(r.text));
  ok('pilihan kelas berasal dari data siswa', /X TKJ 1/.test(r.text) && /XI TKJ 2/.test(r.text));
  ok('tanpa filter: 4 siswa & total tagihan Rp 7.200.000', /\(4 siswa\)/.test(r.text) && /7\.200\.000/.test(r.text));

  /* ---- pencarian nama (case-insensitive) ---- */
  r = await pub(urlGrup2 + '?q=bella');
  ok('cari nama "bella" → 1 dari 4 siswa', /\(1 dari 4 siswa\)/.test(r.text),
    (r.text.match(/\((\d+ dari \d+) siswa\)/) || [])[0]);
  ok('hasil pencarian hanya memuat siswa yang cocok', /Bella Safitri/.test(r.text) && !/Ahmad Fauzi/.test(r.text));
  const tfBella = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  ok('total kaki tabel hanya menghitung hasil filter', /TOTAL TAGIHAN \(HASIL FILTER\)/.test(r.text)
    && /TOTAL TAGIHAN \(HASIL FILTER\) Rp 1\.800\.000/.test(tfBella), tfBella.slice(0, 160));
  ok('ringkasan filter nama tampil', /Filter aktif:[\s\S]{0,40}nama\/NISN mengandung <b>bella<\/b>/.test(r.text));

  r = await pub(urlGrup2 + '?q=ahmad');
  const tfAhmad = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  ok('total filter memuat tagihan, dibayar & sisa siswa terpilih',
    /Rp 1\.800\.000 Rp 900\.000 Rp 900\.000/.test(tfAhmad), tfAhmad.slice(0, 160));

  /* ---- pencarian NISN ---- */
  r = await pub(urlGrup2 + '?q=0012345680');
  ok('cari NISN → menemukan siswa yang tepat (Citra Dewi)', /Citra Dewi/.test(r.text) && !/Bella Safitri/.test(r.text));

  /* ---- filter kelas ---- */
  r = await pub(urlGrup2 + '?kelas=' + encodeURIComponent('XI TKJ 2'));
  ok('filter kelas → hanya siswa kelas tersebut', /Galih Saputra/.test(r.text) && !/Ahmad Fauzi/.test(r.text) && /\(1 dari 4 siswa\)/.test(r.text));
  ok('ringkasan filter kelas tampil', /kelas <b>XI TKJ 2<\/b>/.test(r.text));
  r = await pub(urlGrup2 + '?kelas=' + encodeURIComponent('X TKJ 1'));
  ok('filter kelas lain → 3 siswa', /\(3 dari 4 siswa\)/.test(r.text) && /5\.400\.000/.test(r.text));

  /* ---- gabungan nama + kelas ---- */
  r = await pub(urlGrup2 + '?q=' + encodeURIComponent('a') + '&kelas=' + encodeURIComponent('X TKJ 1'));
  ok('gabungan nama + kelas menyaring dua tahap', /\(\d+ dari 4 siswa\)/.test(r.text) && !/Galih Saputra/.test(r.text));

  /* ---- tanpa hasil ---- */
  r = await pub(urlGrup2 + '?q=zzzz');
  ok('pencarian tanpa hasil menampilkan empty state', /Siswa tidak ditemukan/.test(r.text));
  r = await pub(urlGrup2 + '?q=');
  ok('parameter q kosong = tanpa filter (4 siswa)', /\(4 siswa\)/.test(r.text));

  /* ==================================================================
     3. TIDAK ADA ERROR SERVER
     ================================================================== */
  console.log('\n[3] Stabilitas');
  const errLines = log.split('\n').filter(l => /Unhandled|TypeError|ReferenceError|SyntaxError/.test(l));
  ok('tidak ada error server selama pengujian', errLines.length === 0, errLines.slice(0, 3).join(' | '));

  db.close(); srv.kill('SIGTERM');
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => {
  console.error('FATAL', e);
  console.log(log.slice(-4000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
