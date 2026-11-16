'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   RONDE 48 (SIMKEU)
   1) Nama Penerima/Penyetor pada form transaksi = combobox master pegawai
      + isian manual (ui.pihakInput / ui.pihakData, combobox di app.js).
   2) Antrean Posting: kolom Keterangan (Masuk BKU / Non-BKU) sesuai pilihan
      saat pembayaran diinput + DUA tombol aksi per baris & masal.
   3) Tanpa batas 30 data + filter periode (bulan & rentang tanggal) pada
      Antrean Posting & riwayat, filter nama/rentang tanggal pada Riwayat BKU
      dan Non-BKU; tombol "Kembalikan ke Antrean".
   Jalankan: node dev-tests/round48.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r48-'));
const DB = path.join(TMP, 'k.sqlite');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.R48_PORT || 3792;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
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
const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
/** potong bagian HTML antara dua penanda (untuk memeriksa isi satu tabel) */
const cut = (html, a, b) => {
  const i = html.indexOf(a);
  if (i < 0) return '';
  const j = html.indexOf(b, i + a.length);
  return j < 0 ? html.slice(i) : html.slice(i, j);
};
const countOf = (html, needle) => html.split(needle).length - 1;

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }

  const db = new Database(DB);
  const one = (s, ...a) => db.prepare(s).get(...a);
  const all = (s, ...a) => db.prepare(s).all(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin berhasil', r.status === 303, 'status=' + r.status);
  const ta = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1') || one('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1');
  await req('POST', '/ta/pilih', { ta: ta.id });

  /* data pendukung */
  run("INSERT INTO pegawai (nama, jabatan, tipe, aktif) VALUES ('Budi Santoso','Bendahara','tu',1)");
  run("INSERT INTO pegawai (nama, jabatan, tipe, aktif) VALUES ('Siti Aminah','Guru Matematika','guru',1)");
  const bku = one("SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1", ta.id)
    || one('SELECT * FROM bku ORDER BY id LIMIT 1');
  const coaIn = one("SELECT * FROM coa WHERE kategori='pendapatan' ORDER BY kode LIMIT 1");

  /* ==================================================================
     1. COMBOBOX NAMA PENERIMA (master pegawai + manual)
     ================================================================== */
  console.log('\n[1] Combobox Nama Penerima / Penyetor');
  r = await req('GET', '/transaksi');
  ok('halaman transaksi 200', r.status === 200, 'status=' + r.status);
  ok('form memakai combobox data-pihak', r.text.includes('data-pihak'));
  ok('combobox punya tombol daftar pegawai', r.text.includes('data-pihak-btn'));
  ok('data pegawai dirender sekali per halaman', countOf(r.text, 'id="pihakData"') === 1, String(countOf(r.text, 'id="pihakData"')));
  ok('nama pegawai ada di daftar pilihan', r.text.includes('Budi Santoso'));
  ok('jabatan pegawai ikut sebagai keterangan', r.text.includes('Guru Matematika'));
  ok('input nama_pihak lama sudah diganti', !/<input name="nama_pihak"/.test(r.text));
  ok('placeholder menjelaskan pilih/manual', /Pilih dari data pegawai atau ketik manual/.test(r.text));

  // ketik manual (teks bebas) → tersimpan apa adanya
  r = await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: '2026-08-05', jenis: 'pemasukan', metode: 'tunai', coa_id: coaIn.id,
    nominal: '150000', uraian: 'Uji isian manual nama penerima', nama_pihak: 'Toko Sinar Jaya', after: 'saja'
  });
  ok('simpan transaksi dengan nama manual → 303', r.status === 303, 'status=' + r.status);
  const trxManual = one("SELECT * FROM transaksi WHERE uraian='Uji isian manual nama penerima' ORDER BY id DESC LIMIT 1");
  ok('nama manual tersimpan apa adanya', trxManual && trxManual.nama_pihak === 'Toko Sinar Jaya', trxManual && trxManual.nama_pihak);

  // pilih dari daftar pegawai (nilai = nama pegawai)
  r = await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: '2026-08-06', jenis: 'pemasukan', metode: 'tunai', coa_id: coaIn.id,
    nominal: '75000', uraian: 'Uji pilih nama pegawai', nama_pihak: 'Budi Santoso', after: 'saja'
  });
  const trxPeg = one("SELECT * FROM transaksi WHERE uraian='Uji pilih nama pegawai' ORDER BY id DESC LIMIT 1");
  ok('nama dari master pegawai tersimpan', trxPeg && trxPeg.nama_pihak === 'Budi Santoso', trxPeg && trxPeg.nama_pihak);

  // edit transaksi di Detail BKU juga memakai combobox
  r = await req('GET', `/bku/${bku.id}?edit=${trxPeg.id}`);
  ok('halaman detail BKU 200', r.status === 200, 'status=' + r.status);
  ok('form edit Detail BKU memakai combobox', r.text.includes('data-pihak') && r.text.includes('id="pihakData"'));
  ok('nilai nama pihak terisi di combobox', /name="nama_pihak" value="Budi Santoso"/.test(r.text.replace(/\s+/g, ' ')));

  /* ==================================================================
     2. ANTREAN POSTING — KETERANGAN & DUA TOMBOL AKSI
     ================================================================== */
  console.log('\n[2] Antrean Posting: keterangan & dua tombol aksi');
  const grup = run("INSERT INTO iuran_grup (nama, jenis, tahun_ajaran_id, aktif, keterangan) VALUES ('Iuran SPP Uji','bulanan',?,1,'')", ta.id);
  const grupId = Number(grup.lastInsertRowid);
  const grup2 = run("INSERT INTO iuran_grup (nama, jenis, tahun_ajaran_id, aktif, keterangan) VALUES ('Iuran Kegiatan Uji','nonbulanan',?,1,'')", ta.id);
  const grup2Id = Number(grup2.lastInsertRowid);
  const insSiswa = db.prepare('INSERT INTO siswa (nama, nisn, tahun_ajaran_id, status, created_at) VALUES (?,?,?,?,?)');
  const insTag = db.prepare('INSERT INTO iuran_tagihan (grup_id, siswa_id, tahun_ajaran_id, nominal, created_at) VALUES (?,?,?,?,?)');
  const insBayar = db.prepare(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,keterangan,bku_id,status,kwitansi_no,print_count,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`);
  const siswaIds = [];
  for (let i = 1; i <= 40; i++) {
    const s = insSiswa.run('Siswa Uji ' + String(i).padStart(2, '0'), '9900' + String(i).padStart(2, '0'), ta.id, 'aktif', '2026-07-01 08:00:00');
    const sid = Number(s.lastInsertRowid);
    siswaIds.push(sid);
    const t = insTag.run(grupId, sid, ta.id, 300000, '2026-07-01 08:00:00');
    // 34 baris JULI (paling lama) + 6 baris SEPTEMBER (paling baru) → membuktikan batas 30 hilang
    const tgl = i <= 34 ? `2026-07-${String(((i - 1) % 28) + 1).padStart(2, '0')}` : `2026-09-0${i - 34}`;
    insBayar.run(Number(t.lastInsertRowid), sid, tgl, 250000, 0, 250000, 'tunai', 'Non-BKU uji',
      null, 'manual', 'KW-NB-' + String(i).padStart(2, '0'), tgl + ' 09:00:00');
  }
  // penerimaan menunggu posting (pending) — 2 kelompok: Agustus & September
  const pendingIds = [];
  for (let i = 1; i <= 5; i++) {
    const sid = siswaIds[i - 1];
    const tag = one('SELECT * FROM iuran_tagihan WHERE siswa_id=? AND grup_id=?', sid, grupId);
    const tgl = i <= 3 ? '2026-08-10' : '2026-09-15';
    const b = insBayar.run(tag.id, sid, tgl, 300000, 0, 300000, 'tunai', 'Pending uji',
      bku.id, 'pending', 'KW-PD-' + String(i).padStart(2, '0'), tgl + ' 10:00:00');
    pendingIds.push(Number(b.lastInsertRowid));
  }
  // satu penerimaan pending untuk grup kegiatan (uji kelompok berbeda)
  {
    const s2 = insSiswa.run('Siswa Kegiatan', '9950', ta.id, 'aktif', '2026-07-01 08:00:00');
    const sid = Number(s2.lastInsertRowid);
    const t2 = insTag.run(grup2Id, sid, ta.id, 100000, '2026-07-01 08:00:00');
    const b = insBayar.run(Number(t2.lastInsertRowid), sid, '2026-09-15', 100000, 0, 100000, 'tunai', 'Kegiatan',
      bku.id, 'pending', 'KW-PD-KEG', '2026-09-15 10:00:00');
    pendingIds.push(Number(b.lastInsertRowid));
  }
  for (const [i, tgl] of [[1, '2026-07-12'], [2, '2026-09-12']]) {
    const sid = siswaIds[i - 1];
    const tag = one('SELECT * FROM iuran_tagihan WHERE siswa_id=? AND grup_id=?', sid, grupId);
    insBayar.run(tag.id, sid, tgl, 200000, 0, 200000, 'tunai', 'Posted uji',
      bku.id, 'posted', 'KW-BKU-0' + i, tgl + ' 11:00:00');
  }

  r = await req('GET', '/iuran/antrean');
  ok('halaman antrean 200', r.status === 200, 'status=' + r.status);
  const tblQueue = cut(r.text, '<table id="tblAntreanQueue"', '</table>');
  const tblPending = cut(r.text, '<table id="tblAntreanPending"', '</table>');
  const tblPosted = cut(r.text, '<table id="tblAntreanPosted"', '</table>');
  const tblNon = cut(r.text, '<table id="tblAntreanNonBku"', '</table>');
  ok('Riwayat BKU ditempatkan sebelum riwayat Non-BKU',
    r.text.indexOf('Riwayat Penerimaan BKU') < r.text.indexOf('Riwayat Penerimaan Non-BKU'));
  ok('Riwayat BKU menampilkan baris terposting & kwitansi', countOf(tblPosted, 'data-check-item="ids"') === 2
    && tblPosted.includes('KW-BKU-01') && tblPosted.includes('Kwitansi'));
  ok('Riwayat BKU punya aksi hapus terpilih', /Hapus Terpilih/.test(cut(r.text, 'Riwayat Penerimaan BKU', 'Riwayat Penerimaan Non-BKU')));
  ok('kedua riwayat punya filter nama & rentang tanggal',
    countOf(r.text, 'name="riwayat_q"') === 2 && countOf(r.text, 'name="riwayat_dari"') === 2
    && countOf(r.text, 'name="riwayat_sampai"') === 2);
  ok('tabel antrean punya kolom Keterangan', tblQueue.includes('<th>Keterangan</th>'));
  ok('tabel rincian punya kolom Keterangan', tblPending.includes('<th>Keterangan</th>'));
  ok('tabel riwayat Non-BKU punya kolom Keterangan', tblNon.includes('<th>Keterangan</th>'));
  ok('antrean menampilkan keterangan "Masuk BKU"', tblQueue.includes('Masuk BKU'));
  ok('riwayat menampilkan keterangan "Non-BKU (Data Saja)"', tblNon.includes('Non-BKU (Data Saja)'));
  ok('keterangan menyebut nama BKU sasaran', tblQueue.includes(bku.nama));
  ok('antrean berisi 3 kelompok (2 SPP + 1 kegiatan)', countOf(tblQueue, 'Tinjau / Edit') === 3,
    'kelompok=' + countOf(tblQueue, 'Tinjau / Edit'));
  ok('tiap kelompok punya tombol Posting ke BKU', countOf(tblQueue, 'Posting ke BKU') === 3,
    String(countOf(tblQueue, 'Posting ke BKU')));
  ok('baris antrean TIDAK lagi punya tombol Non-BKU', !tblQueue.includes('/iuran/antrean/nonbku'));
  ok('rincian pending: 2 tombol (Tinjau/Edit + Posting) per baris',
    countOf(tblPending, 'Tinjau / Edit') === 6 && countOf(tblPending, 'btn btn-sm btn-green') >= 6,
    countOf(tblPending, 'Tinjau / Edit') + '/' + countOf(tblPending, 'btn btn-sm btn-green'));
  ok('aksi masal antrean: Tinjau/Edit Masal + Posting BKU Masal',
    r.text.includes('Tinjau / Edit Masal') && r.text.includes('Posting BKU Masal'));
  ok('aksi masal rincian: Posting ke BKU (n) tersedia', /Posting ke BKU \(<b data-check-count="ids"[^>]*>0<\/b>\)/.test(r.text));
  ok('riwayat Non-BKU: tombol Kembalikan ke Antrean per baris', countOf(tblNon, 'Kembalikan ke Antrean') >= 40,
    String(countOf(tblNon, 'Kembalikan ke Antrean')));
  ok('riwayat Non-BKU tidak punya tombol posting langsung', !tblNon.includes('/iuran/antrean/posting"'));
  ok('riwayat Non-BKU punya aksi masal Kembalikan ke Antrean',
    /Kembalikan ke Antrean \(<b data-check-count="ids"/.test(r.text));

  /* ==================================================================
     3. TANPA BATAS 30 DATA
     ================================================================== */
  console.log('\n[3] Riwayat Non-BKU tanpa batas 30 data');
  ok('seluruh 40 penerimaan Non-BKU tampil', countOf(tblNon, 'data-check-item="ids"') === 40,
    'baris=' + countOf(tblNon, 'data-check-item="ids"'));
  ok('baris paling lama (KW-NB-01) ikut tampil', tblNon.includes('KW-NB-01'));
  ok('baris terbaru (KW-NB-40) juga tampil', tblNon.includes('KW-NB-40'));
  ok('subjudul menyebut jumlah & seluruh riwayat', /40 penerimaan/.test(r.text));

  /* ==================================================================
     4. FILTER PERIODE (bulan & rentang tanggal)
     ================================================================== */
  console.log('\n[4] Filter periode (bulan / tanggal)');
  ok('bar filter punya pilihan Bulan', /<select name="bulan">/.test(r.text));
  ok('bar filter punya Tanggal Mulai & Akhir', /name="dari"/.test(r.text) && /name="sampai"/.test(r.text));
  ok('bar filter punya tombol Terapkan', /Terapkan Filter/.test(r.text));

  r = await req('GET', '/iuran/antrean?bulan=2026-07');
  let tblNonB = cut(r.text, '<table id="tblAntreanNonBku"', '</table>');
  let tblPostedB = cut(r.text, '<table id="tblAntreanPosted"', '</table>');
  ok('filter bulan Juli → hanya 34 baris Juli', countOf(tblNonB, 'data-check-item="ids"') === 34,
    'baris=' + countOf(tblNonB, 'data-check-item="ids"'));
  ok('filter periode umum juga membatasi Riwayat BKU', countOf(tblPostedB, 'data-check-item="ids"') === 1);
  ok('filter bulan Juli → baris September tidak tampil', !tblNonB.includes('KW-NB-40'));
  ok('filter bulan Juli → antrean pending kosong', /Antrean kosong/.test(r.text));
  ok('filter aktif ditandai di halaman', /Filter aktif/.test(r.text));

  r = await req('GET', '/iuran/antrean?dari=2026-09-01&sampai=2026-09-30');
  tblNonB = cut(r.text, '<table id="tblAntreanNonBku"', '</table>');
  tblPostedB = cut(r.text, '<table id="tblAntreanPosted"', '</table>');
  let tblQ = cut(r.text, '<table id="tblAntreanQueue"', '</table>');
  ok('rentang September → 6 baris Non-BKU', countOf(tblNonB, 'data-check-item="ids"') === 6,
    'baris=' + countOf(tblNonB, 'data-check-item="ids"'));
  ok('rentang September → 2 kelompok antrean', countOf(tblQ, 'Tinjau / Edit') === 2,
    String(countOf(tblQ, 'Tinjau / Edit')));
  ok('rentang September → baris Juli tidak tampil', !tblNonB.includes('KW-NB-01'));
  ok('rentang umum September → Riwayat BKU September tampil', tblPostedB.includes('KW-BKU-02') && !tblPostedB.includes('KW-BKU-01'));

  r = await req('GET', '/iuran/antrean?riwayat_q=Siswa+Uji+01&riwayat_dari=2026-07-01&riwayat_sampai=2026-07-31');
  tblNonB = cut(r.text, '<table id="tblAntreanNonBku"', '</table>');
  tblPostedB = cut(r.text, '<table id="tblAntreanPosted"', '</table>');
  ok('filter riwayat nama + tanggal membatasi Riwayat Non-BKU', countOf(tblNonB, 'data-check-item="ids"') === 1);
  ok('filter riwayat nama + tanggal membatasi Riwayat BKU', countOf(tblPostedB, 'data-check-item="ids"') === 1);
  ok('filter riwayat tanggal terisi kembali di kedua panel',
    countOf(r.text, 'name="riwayat_dari" value="2026-07-01"') === 3
    && countOf(r.text, 'name="riwayat_sampai" value="2026-07-31"') === 3,
    countOf(r.text, 'name="riwayat_dari" value="2026-07-01"') + '/' + countOf(r.text, 'name="riwayat_sampai" value="2026-07-31"'));

  r = await req('GET', '/iuran/antrean?dari=2026-09-30&sampai=2026-09-01');
  tblNonB = cut(r.text, '<table id="tblAntreanNonBku"', '</table>');
  ok('rentang terbalik dibetulkan otomatis', countOf(tblNonB, 'data-check-item="ids"') === 6,
    'baris=' + countOf(tblNonB, 'data-check-item="ids"'));

  r = await req('GET', '/iuran/antrean?bulan=zzz&dari=abc');
  ok('filter tidak valid diabaikan (semua data tampil)', cut(r.text, '<table id="tblAntreanNonBku"', '</table>').includes('KW-NB-01'));

  /* ==================================================================
     5. AKSI: KEMBALIKAN KE ANTREAN & POSTING
     ================================================================== */
  console.log('\n[5] Aksi Kembalikan ke Antrean & Posting');
  const nbRow = one("SELECT * FROM iuran_bayar WHERE kwitansi_no='KW-NB-01'");
  r = await req('POST', '/iuran/antrean/kembali', { ids: nbRow.id, bku_id: bku.id });
  ok('kembalikan Non-BKU → antrean (303 ok)', r.status === 303 && /ok=/.test(r.loc), dec(r.loc).slice(0, 120));
  const nbAfter = one('SELECT * FROM iuran_bayar WHERE id=?', nbRow.id);
  ok('status berubah menjadi pending', nbAfter.status === 'pending', nbAfter.status);
  ok('BKU sasaran terisi', String(nbAfter.bku_id) === String(bku.id), String(nbAfter.bku_id));

  r = await req('POST', '/iuran/antrean/kembali', { ids: nbRow.id, bku_id: '' });
  ok('kembalikan tanpa BKU ditolak dengan pesan', r.status === 303 && /err=/.test(r.loc), dec(r.loc).slice(0, 120));

  // posting satu baris (tombol Posting pada tabel rincian)
  const before = one("SELECT COUNT(*) c FROM transaksi WHERE uraian LIKE '%Iuran SPP Uji%'").c;
  r = await req('POST', '/iuran/antrean/posting', { ids: pendingIds[0], bku_id: bku.id, coa_id: coaIn.id });
  ok('posting satu penerimaan → 303 ok', r.status === 303 && /ok=/.test(r.loc), dec(r.loc).slice(0, 140));
  const posted = one('SELECT * FROM iuran_bayar WHERE id=?', pendingIds[0]);
  ok('penerimaan menjadi posted + punya transaksi BKU', posted.status === 'posted' && posted.transaksi_id,
    posted.status + '/' + posted.transaksi_id);
  const after = one("SELECT COUNT(*) c FROM transaksi WHERE uraian LIKE '%Iuran SPP Uji%'").c;
  ok('satu transaksi BKU baru terbentuk', after === before + 1, `${before} → ${after}`);
  const trx = one('SELECT * FROM transaksi WHERE id=?', posted.transaksi_id);
  ok('nominal transaksi = total penerimaan', Number(trx.nominal) === Number(posted.dibayar), trx.nominal + ' vs ' + posted.dibayar);

  // kelompok yang sudah diposting hilang dari antrean
  r = await req('GET', '/iuran/antrean');
  ok('baris terposting hilang dari antrean', !cut(r.text, '<table id="tblAntreanPending"', '</table>').includes('KW-PD-01'));

  /* ==================================================================
     6. REGRESI HALAMAN IURAN LAIN
     ================================================================== */
  console.log('\n[6] Regresi halaman iuran');
  for (const [url, name] of [['/iuran', 'Daftar iuran'], ['/iuran/transaksi', 'Transaksi iuran'], ['/iuran/bulanan', 'Rincian bulanan'], ['/iuran/pengingat', 'Jadwal pengingat']]) {
    const rr = await req('GET', url);
    ok(`${name} tetap 200`, rr.status === 200, 'status=' + rr.status);
  }
  const rdata = await req('GET', '/iuran/data/' + siswaIds[0]);
  ok('detail iuran siswa tetap 200', rdata.status === 200, 'status=' + rdata.status);

  console.log('\n==================================================');
  console.log(`HASIL: ${pass} lulus, ${fail} gagal`);
  if (fail) { console.log('GAGAL:'); fails.forEach(f => console.log('  - ' + f)); }
  console.log('==================================================');
  db.close();
  srv.kill();
  if (fail && log) console.log('--- log server ---\n' + log.slice(-2000));
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('ERROR TEST:', e);
  if (log) console.log(log.slice(-2000));
  try { srv.kill(); } catch (x) { }
  process.exit(1);
});
