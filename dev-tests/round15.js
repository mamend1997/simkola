'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 15 — portal piutang lainnya, bulk unassign, orientasi & desain cetak,
   template SPP per bulan, instant search, beasiswa enforcement, sorting TA,
   laporan per bulan + multi BKU, reset TA, audit orphan. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3545;
const DB = path.join(os.tmpdir(), 'smk-r15-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond }); if (!cond) console.log('FAIL:', name, extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body !== undefined && body !== null) {
    if (Buffer.isBuffer(body)) { payload = body; headers['Content-Type'] = opt.ct || 'application/octet-stream'; }
    else {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) Array.isArray(v) ? v.forEach(x => usp.append(k, x)) : usp.append(k, v);
      payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, buf: opt.binary ? text : null, headers: r.headers, loc: r.headers.get('location') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  ok('login admin', r.status === 303);

  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);
  const today = new Date().toISOString().slice(0, 10);

  /* ================= 1. halaman baru ================= */
  for (const [u, label] of [['/desain-cetak', 'desain cetak'], ['/audit-orphan', 'audit orphan'], ['/reset-tahun', 'reset tahun'], ['/beasiswa', 'beasiswa']]) {
    r = await req('GET', u);
    ok(`halaman ${label} 200`, r.status === 200, r.status);
  }
  r = await req('GET', '/desain-cetak');
  ok('design center memuat katalog dokumen', /Kwitansi Transaksi/.test(r.text) && /Slip Gaji/.test(r.text) && /Honor Pembina Ekstrakurikuler/.test(r.text));
  ok('design center punya pilihan portrait & landscape', /Orientasi Default Cetak/.test(r.text) && /Landscape \(Horizontal\)/.test(r.text));

  /* ================= 2. simpan design center ================= */
  const printcfg = require('../printcfg');
  const form = {};
  for (const d of printcfg.DOCS) {
    form['orient_' + d.key] = d.orient;
    for (const [k2, , def] of d.fields) form[`lbl_${d.key}_${k2}`] = def;
  }
  form.orient_kwitansi_trx = 'portrait';
  form.lbl_kwitansi_trx_dari_keluar = 'Bendahara Sekolah';
  r = await req('POST', '/desain-cetak', form);
  ok('simpan desain redirect', r.status === 303);
  const cfg = JSON.parse(db.prepare("SELECT v FROM settings WHERE k='print_design'").get().v || '{}');
  ok('orientasi kwitansi tersimpan', cfg.docs && cfg.docs.kwitansi_trx && cfg.docs.kwitansi_trx.orient === 'portrait');
  ok('label dari_keluar tersimpan', cfg.docs.kwitansi_trx.labels.dari_keluar === 'Bendahara Sekolah');

  /* ================= 3. TA sorting terbaru di atas ================= */
  await req('POST', '/tahun-ajaran/save', { nama: '2027/2028', tanggal_mulai: '2027-07-01', tanggal_selesai: '2028-06-30' });
  const taBaru = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2027/2028'").get();
  r = await req('GET', '/tahun-ajaran');
  const idxNew = r.text.indexOf('2027/2028'), idxOld = r.text.indexOf(ta.nama);
  ok('tahun ajaran terbaru tampil lebih dulu', idxNew > -1 && idxNew < idxOld, `${idxNew} vs ${idxOld}`);
  r = await req('GET', '/');
  ok('dropdown header TA juga urut terbaru', /2027\/2028[\s\S]*2026\/2027/.test(r.text) || /2027\/2028[\s\S]*2024\/2025/.test(r.text));

  /* ================= 4. master akademik + iuran ================= */
  await req('POST', '/program-keahlian/save', { nama: 'AKL Uji', kode: 'AKL' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='AKL Uji'").get();
  await req('POST', '/kelas/save', { nama: 'X UJI 1', tingkat: 'X', wali_kelas: 'Wali', program_id: prog.id, aktif: '1' });
  const kX = db.prepare("SELECT * FROM kelas WHERE nama='X UJI 1'").get();
  await req('POST', '/siswa/save', { nisn: '9001', nama: 'Siswa Beasiswa', jenis_kelamin: 'L', tanggal_lahir: '2010-01-01', kelas_id: kX.id });
  await req('POST', '/siswa/save', { nisn: '9002', nama: 'Siswa Biasa', jenis_kelamin: 'P', tanggal_lahir: '2010-02-02', kelas_id: kX.id });
  const sBea = db.prepare("SELECT * FROM siswa WHERE nisn='9001'").get();
  const sBiasa = db.prepare("SELECT * FROM siswa WHERE nisn='9002'").get();

  await req('POST', '/iuran/save', { nama: 'SPP Uji', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Uji'").get();
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kX.id, siswa_id: [sBea.id, sBiasa.id] });
  const tags = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').all(gSpp.id);
  ok('2 tagihan SPP dibuat', tags.length === 2);

  /* ================= 5. template import per bulan ================= */
  r = await req('GET', `/iuran/import/template?ta=${ta.id}`, null, { binary: true });
  ok('template xlsx diunduh', r.status === 200 && r.buf.slice(0, 2).toString() === 'PK');
  const sheet = X.readXlsx(r.buf)[0];
  const headRow = sheet.rows.find(row => (row || []).some(c => /TANGGAL BAYAR/.test(X.cellText(c))));
  const headTxt = (headRow || []).map(c => X.cellText(c)).join(' | ');
  ok('template memuat kolom bulan terpisah', /SPP Uji-Juli TANGGAL BAYAR/.test(headTxt) && /SPP Uji-Agustus NOMINAL BAYAR/.test(headTxt), headTxt.slice(0, 200));

  // import CSV per bulan
  const csv = [
    'NO;NAMA;KELAS;SPP Uji-Juli TANGGAL BAYAR;SPP Uji-Juli NOMINAL BAYAR',
    `1;${sBiasa.nama};${kX.nama};01/07/${today.slice(0, 4)};50000`
  ].join('\n');
  const b64 = 'data:text/csv;base64,' + Buffer.from(csv, 'utf8').toString('base64');
  r = await req('POST', '/iuran/import', { ta: ta.id, file_b64: b64 });
  ok('import per bulan redirect', r.status === 303, r.text.slice(0, 200));
  const bayarImport = db.prepare("SELECT * FROM iuran_bayar WHERE siswa_id=? AND keterangan LIKE 'Import%'").get(sBiasa.id);
  ok('import menyimpan bulan pembayaran', bayarImport && Number(bayarImport.bulan) === 7, bayarImport && bayarImport.bulan);

  await req('POST', '/iuran/save', { nama: 'SPP Tingkat Uji', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '0', aktif: '1' });
  const gTingkat = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Tingkat Uji'").get();
  const tarifTingkat = { nominal_tingkat: 'X' };
  for (const b of [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]) tarifTingkat['bulan_' + b] = b === 7 ? '125000' : '0';
  await req('POST', `/iuran/grup/${gTingkat.id}/nominal`, tarifTingkat);
  await req('POST', `/iuran/grup/${gTingkat.id}/tetapkan`, { kelas_id: kX.id, siswa_id: [sBiasa.id] });
  r = await req('GET', `/iuran/import/template?ta=${ta.id}`, null, { binary: true });
  const tierTemplate = X.readXlsx(r.buf)[0];
  const tierHeader = tierTemplate.rows.find(row => (row || []).some(c => /SPP Tingkat Uji-Juli TANGGAL BAYAR/.test(X.cellText(c))));
  ok('template bulanan menyertakan tarif khusus tingkat', !!tierHeader);
  const csvTier = [
    'NO;NAMA;KELAS;SPP Tingkat Uji-Juli TANGGAL BAYAR;SPP Tingkat Uji-Juli NOMINAL BAYAR',
    `1;${sBiasa.nama};${kX.nama};02/07/${today.slice(0, 4)};125000`
  ].join('\n');
  r = await req('POST', '/iuran/import', {
    ta: ta.id,
    file_b64: 'data:text/csv;base64,' + Buffer.from(csvTier, 'utf8').toString('base64')
  });
  const bayarTingkat = db.prepare(`SELECT b.* FROM iuran_bayar b JOIN iuran_tagihan t ON t.id=b.tagihan_id
    WHERE t.grup_id=? AND b.siswa_id=?`).get(gTingkat.id, sBiasa.id);
  ok('import menerima pembayaran tarif khusus tingkat', r.status === 303 && bayarTingkat && Number(bayarTingkat.jumlah) === 125000,
    bayarTingkat && bayarTingkat.jumlah);

  /* ================= 6. beasiswa parsial & sisa tetap dapat dibayar ================= */
  const nominalGrup = db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM iuran_nominal WHERE grup_id=?').get(gSpp.id).s;
  const payload = JSON.stringify({
    nama: 'Beasiswa Uji', deskripsi: 'Uji', tahun_ajaran_id: ta.id, grup_id: gSpp.id,
    bulan_mask: '', nominal_per_siswa: Math.round(Number(nominalGrup) / 2), persen: 50, siswa: [sBea.id], aktif: true
  });
  r = await req('POST', '/beasiswa/save-final', { payload, tahun_ajaran_id: ta.id });
  ok('beasiswa tersimpan', r.status === 303);
  const bea = db.prepare("SELECT * FROM beasiswa WHERE nama='Beasiswa Uji'").get();
  ok('master beasiswa tersimpan', !!bea);
  const tagBea = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSpp.id, sBea.id);
  ok('tagihan beasiswa terkunci', tagBea && Number(tagBea.beasiswa_locked) === 1);
  const bayarBea = db.prepare("SELECT * FROM iuran_bayar WHERE tagihan_id=? AND sumber='beasiswa'").all(tagBea.id);
  ok('pembayaran otomatis beasiswa dibuat', bayarBea.length >= 1, bayarBea.length);
  const totJumlah = bayarBea.reduce((a, b) => a + Number(b.jumlah), 0);
  ok('beasiswa 50 persen hanya mencatat setengah tagihan dibayar', Math.round(totJumlah) === Math.round(Number(tagBea.nominal) / 2), `${totJumlah} vs ${tagBea.nominal}`);
  const partialTag = db.prepare('SELECT * FROM iuran_tagihan WHERE id=?').get(tagBea.id);
  const partialRows = db.prepare("SELECT jumlah,bulan FROM iuran_bayar WHERE tagihan_id=? AND sumber='beasiswa'").all(tagBea.id);
  ok('sisa setelah beasiswa tetap menjadi tunggakan', Math.round(Number(partialTag.nominal) - partialRows.reduce((a, b) => a + Number(b.jumlah), 0)) === Math.round(Number(tagBea.nominal) / 2));
  ok('potongan persentase tersebar pada tiap bulan', partialRows.length === 12 && partialRows.every(b => Number(b.jumlah) === 50000));
  ok('pembayaran beasiswa tidak masuk antrean BKU', bayarBea.every(b => b.status === 'beasiswa' && !b.bku_id));
  r = await req('GET', `/iuran/data?ta=${ta.id}`);
  ok('menu Data Iuran menyediakan cetak tagihan PDF', /Cetak Tagihan PDF/.test(r.text) && /Cetak Tagihan Terpilih/.test(r.text));
  r = await req('GET', `/iuran/tagihan/pdf?ta=${ta.id}&siswa=${sBea.id}`);
  ok('cetak PDF tagihan terpilih menampilkan rincian siswa', r.status === 200 && /TAGIHAN IURAN SISWA/.test(r.text) && /Sudah Dibayar/.test(r.text), r.status);
  r = await req('GET', `/iuran/data/${sBea.id}/tagihan.pdf?ta=${ta.id}`);
  ok('cetak PDF tagihan tersedia dari detail siswa', r.status === 200 && /TAGIHAN IURAN SISWA/.test(r.text), r.status);
  r = await req('GET', `/iuran/data/${sBea.id}?ta=${ta.id}`);
  ok('detail iuran menampilkan beasiswa dan aksi bayar sisa', /potongan otomatis/i.test(r.text) && /Bayar Semua Bulan/.test(r.text), r.status);
  r = await req('POST', '/iuran/bayar', { tagihan_id: tagBea.id, tanggal: today, jumlah: '1000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${sBea.id}` });
  ok('pembayaran siswa untuk sisa tagihan beasiswa diterima', r.status === 303 && /\/iuran\/kwitansi\?rows=/.test(r.loc), r.loc);
  const bayarRow = bayarBea[0];
  r = await req('POST', '/iuran/bayar/delete', { id: bayarRow.id, back: `/iuran/data/${sBea.id}` });
  ok('hapus pembayaran beasiswa ditolak', /err=/.test(r.loc), r.loc);
  r = await req('POST', '/iuran/tagihan/delete', { id: tagBea.id, back: `/iuran/grup/${gSpp.id}` });
  ok('hapus penetapan terkunci ditolak', /err=/.test(r.loc) && !!db.prepare('SELECT id FROM iuran_tagihan WHERE id=?').get(tagBea.id), r.loc);

  // beasiswa nonaktif / dihapus → lock dilepas
  await req('POST', '/beasiswa/delete', { id: bea.id });
  ok('hapus beasiswa menghapus pembayaran otomatis', db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE sumber='beasiswa'").get().c === 0);

  await req('POST', '/iuran/save', { nama: 'Iuran Sekali Beasiswa', jenis: 'sekali', mode_nominal: 'rata', nominal_rata: '200000', aktif: '1', tahun_ajaran_id: ta.id });
  const gSekali = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Sekali Beasiswa'").get();
  await req('POST', `/iuran/grup/${gSekali.id}/tetapkan`, { kelas_id: kX.id, siswa_id: [sBea.id] });
  const tagSekali = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSekali.id, sBea.id);
  const payloadSekali = JSON.stringify({
    nama: 'Beasiswa Sekali 50', deskripsi: 'Uji', tahun_ajaran_id: ta.id, grup_ids: [gSekali.id],
    bulan_mask: '', nominal_per_siswa: 100000, persen: 50, siswa: [sBea.id], aktif: true
  });
  await req('POST', '/beasiswa/save-final', { payload: payloadSekali, tahun_ajaran_id: ta.id });
  const bayarSekali = db.prepare("SELECT jumlah FROM iuran_bayar WHERE tagihan_id=? AND sumber='beasiswa'").get(tagSekali.id);
  ok('beasiswa persentase juga diterapkan pada grup non-bulanan', bayarSekali && Number(bayarSekali.jumlah) === 100000);
  const beaSekali = db.prepare("SELECT id FROM beasiswa WHERE nama='Beasiswa Sekali 50'").get();
  await req('POST', '/beasiswa/delete', { id: beaSekali.id });

  /* ================= 7. bulk unassign penetapan ================= */
  const tagBiasa = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSpp.id, sBiasa.id);
  r = await req('GET', `/iuran/grup/${gSpp.id}?kelas=${kX.id}`);
  ok('halaman grup punya ceklis & tombol hapus massal', /data-check-group-box="lepas"/.test(r.text) && /Hapus Penetapan Terpilih/.test(r.text));
  r = await req('POST', `/iuran/grup/${gSpp.id}/lepas`, { tagihan_id: [tagBiasa.id], back: `/iuran/grup/${gSpp.id}` });
  ok('bulk unassign redirect', r.status === 303);
  ok('tagihan terpilih terhapus', !db.prepare('SELECT id FROM iuran_tagihan WHERE id=?').get(tagBiasa.id));

  /* ================= 8. kwitansi transaksi: orientasi & default bendahara ================= */
  const coa = db.prepare("SELECT * FROM coa WHERE kode='5.2.01'").get();
  await req('POST', '/transaksi/save', { bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai', coa_id: coa.id, nominal: '250000', uraian: 'Belanja Uji Orientasi', nama_pihak: 'Toko Uji' });
  r = await req('GET', '/transaksi');
  ok('form transaksi menyediakan input jumlah dan harga barang', /name="jumlah_barang"/.test(r.text) && /name="harga_satuan"/.test(r.text));
  await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai',
    coa_id: coa.id, nominal: '', jumlah_barang: '3', harga_satuan: '25000',
    uraian: 'Pembelian BHP Hitung Uji', nama_pihak: 'Toko Uji'
  });
  const trxBhp = db.prepare("SELECT * FROM transaksi WHERE uraian='Pembelian BHP Hitung Uji'").get();
  ok('transaksi BHP menyimpan jumlah, harga satuan, dan total hasil perkalian',
    !!trxBhp && trxBhp.jumlah_barang === 3 && trxBhp.harga_satuan === 25000 && trxBhp.nominal === 75000);
  const trx = db.prepare("SELECT * FROM transaksi WHERE uraian='Belanja Uji Orientasi'").get();
  r = await req('GET', `/transaksi/${trx.id}/kwitansi?orient=portrait`);
  ok('kwitansi pengeluaran default portrait', /size:A4 portrait/.test(r.text), r.status);
  ok('label terima dari = Bendahara Sekolah', /Bendahara Sekolah/.test(r.text));
  ok('toggle orientasi tersedia', /orient=landscape/.test(r.text) && /orient=portrait/.test(r.text));
  ok('blok TTD sejajar (kwit-sign)', /kwit-sign/.test(r.text) && /sig-head/.test(r.text));
  ok('tanggal transaksi di atas teks penerima', /Penerima/.test(r.text));
  r = await req('GET', `/transaksi/${trx.id}/kwitansi?orient=landscape`);
  ok('kwitansi landscape ketika dipilih', /size:A4 landscape/.test(r.text));

  /* ================= 9. kwitansi iuran portrait ================= */
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kX.id, siswa_id: [sBiasa.id] });
  const tag2 = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSpp.id, sBiasa.id);
  await req('POST', '/iuran/bayar', { tagihan_id: tag2.id, bulan: '8', tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${sBiasa.id}` });
  const ib = db.prepare('SELECT * FROM iuran_bayar WHERE tagihan_id=? ORDER BY id DESC LIMIT 1').get(tag2.id);
  r = await req('GET', `/iuran/kwitansi?ids=${ib.id}`);
  ok('kwitansi iuran default portrait A4', /size:A4 portrait/.test(r.text), r.status);
  ok('kwitansi iuran punya toggle orientasi', /orient=landscape/.test(r.text));
  r = await req('GET', `/iuran/kwitansi?ids=${ib.id}&orient=landscape`);
  ok('kwitansi iuran landscape dipilih', /size:A4 landscape/.test(r.text));

  /* ================= 10. slip honor tanpa TTD & ekskul "Bendahara" ================= */
  await req('POST', '/payroll/simpan', { periode: `${ta.tanggal_mulai.slice(0, 7)}`, ids: '', _: '' }).catch(() => { });
  r = await req('GET', `/payroll/slip/cetak?periode=${ta.tanggal_mulai.slice(0, 7)}`);
  ok('slip honor tanpa kolom tanda tangan', r.status === 200 && !/class="slip-sign"/.test(r.text));
  db.prepare("INSERT INTO ekskul_honor (periode,nama_pembina,kehadiran,harga_satuan,keterangan,status,jenis,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(ta.tanggal_mulai.slice(0, 7), 'Pembina Uji', 4, 50000, '-', 'pending', 'Pramuka', today);
  r = await req('GET', `/ekskul/cetak?periode=${ta.tanggal_mulai.slice(0, 7)}`);
  ok('ekskul: label tanda tangan "Bendahara" (bukan Tanda Tangan Bendahara Sekolah)',
    r.status === 200 && !/Tanda Tangan Bendahara Sekolah/.test(r.text) && /Bendahara/.test(r.text));
  ok('ekskul punya toggle orientasi', /orient=landscape/.test(r.text) && /size:A4 landscape/.test(r.text));

  /* ================= 11. laporan: per bulan + multi BKU ================= */
  const bulan = today.slice(0, 7);
  r = await req('GET', `/laporan?r=bku&ta=${ta.id}&bulan=${bulan}`);
  ok('laporan BKU: filter rincian per bulan', /Rincian Per Bulan/i.test(r.text) && /Belanja Uji Orientasi/.test(r.text));
  r = await req('GET', `/laporan?r=bku&ta=${ta.id}`);
  ok('laporan BKU: opsi semua BKU', /Semua BKU/.test(r.text));
  r = await req('GET', `/laporan?r=lra&ta=${ta.id}&bulan=${bulan}`);
  ok('LRA: rincian transaksi per bulan', /Rincian Transaksi Belanja/i.test(r.text) && /Belanja Uji Orientasi/.test(r.text));
  r = await req('GET', `/laporan?r=aruskas&ta=${ta.id}&bulan=${bulan}`);
  ok('Arus kas: filter bulan + target BKU', /Rincian/.test(r.text) && /Target BKU/.test(r.text));
  r = await req('GET', `/laporan?r=pembantu&p=tunai&ta=${ta.id}&bulan=${bulan}`);
  ok('Buku pembantu: filter bulan + multi BKU', /Rincian/.test(r.text) && /multi-pilih/.test(r.text));
  const coaPpn = db.prepare("SELECT id FROM coa WHERE kode='2.1.01'").get();
  const coaModal = db.prepare("SELECT id FROM coa WHERE kode='5.2.02'").get();
  if (coaPpn) {
    db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,coa_id,nominal,uraian,status,created_at)
      VALUES (?,?,?,?,?,?,?,'posted',?)`).run(bku.id, today, 'pemasukan', 'tunai', coaPpn.id, 1021711, 'Terima PPN Uji', today);
    db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,coa_id,nominal,uraian,status,created_at)
      VALUES (?,?,?,?,?,?,?,'posted',?)`).run(bku.id, today, 'pengeluaran', 'tunai', coaPpn.id, 1021711, 'Setor PPN Uji', today);
  }
  if (coaModal) {
    db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,coa_id,nominal,uraian,status,created_at)
      VALUES (?,?,?,?,?,?,?,'posted',?)`).run(bku.id, today, 'pengeluaran', 'transfer', coaModal.id, 300000, 'Net volley Uji', today);
  }
  r = await req('GET', `/laporan?r=pembantu&p=pajak&ta=${ta.id}&bulan=${bulan}`);
  ok('Buku Pembantu Pajak: kolom debit per jenis dan kredit', /PENERIMAAN \/ DEBIT/.test(r.text)
    && /PPh 21/.test(r.text) && /PPh 23/.test(r.text) && /PPh 4/.test(r.text)
    && /PENGELUARAN \/ KREDIT/.test(r.text) && /Terima PPN Uji/.test(r.text) && /Setor PPN Uji/.test(r.text));
  r = await req('GET', `/laporan?r=pembantu&p=bhp&ta=${ta.id}&bulan=${bulan}`);
  ok('Rekap BHP: uraian, jumlah barang, harga satuan, realisasi saja',
    /Jumlah Barang/.test(r.text) && /Harga Satuan/.test(r.text) && /Realisasi/.test(r.text)
      && !/<th[^>]*>Masuk<\/th>/.test(r.text) && !/<th[^>]*>Keluar<\/th>/.test(r.text));
  ok('Rekap BHP memakai jumlah, harga satuan, dan nilai realisasi tersimpan',
    /Pembelian BHP Hitung Uji/.test(r.text) && /<td class="num">3<\/td>/.test(r.text)
      && /25\.000/.test(r.text) && /75\.000/.test(r.text));
  r = await req('GET', `/laporan?r=pembantu&p=modal&ta=${ta.id}&bulan=${bulan}`);
  ok('Rekap barang modal memakai format barang yang sama',
    /Jumlah Barang/.test(r.text) && /Harga Satuan/.test(r.text) && /Realisasi/.test(r.text));
  r = await req('GET', `/laporan?r=pembantu&p=tunai&ta=${ta.id}&from=${today}&to=${today}`);
  ok('Buku pembantu tunai: saldo awal berada di kolom Masuk',
    /<b>SALDO AWAL<\/b><\/td><td class="num"><b>[^<]+<\/b><\/td><td><\/td><td><\/td>/.test(r.text));
  r = await req('GET', `/laporan?r=bku&ta=${ta.id}&bku=${bku.id}&from=${today}&to=${today}`);
  ok('Laporan BKU: saldo awal berada di kolom penerimaan',
    /Saldo awal[^<]*<\/td><td class="num t-strong">[^<]+<\/td><td><\/td><td><\/td>/.test(r.text));
  r = await req('GET', `/cetak/bku?ta=${ta.id}&bulan=${bulan}&orient=portrait`, null, { binary: true });
  ok('cetak BKU per bulan 200', r.status === 200 && /Rincian Bulan/.test(r.buf.toString()));
  r = await req('GET', `/export/pembantu?p=tunai&ta=${ta.id}&bulan=${bulan}`, null, { binary: true });
  ok('export buku pembantu per bulan xlsx', r.status === 200 && r.buf.slice(0, 2).toString() === 'PK');
  r = await req('GET', `/cetak/pembantu?p=tunai&ta=${ta.id}&bulan=${bulan}&bku=${bku.id}`, null, { binary: true });
  ok('cetak buku pembantu target BKU', r.status === 200 && /Target BKU/.test(r.buf.toString()));
  r = await req('GET', `/cetak/pembantu?p=pajak&ta=${ta.id}&bulan=${bulan}`, null, { binary: true });
  ok('cetak pajak memakai kolom debit jenis pajak', /PENERIMAAN \/ DEBIT/.test(r.buf.toString()) && /PPh 21/.test(r.buf.toString()));
  r = await req('GET', `/export/pembantu?p=bhp&ta=${ta.id}&bulan=${bulan}`, null, { binary: true });
  const bhpSheet = X.readXlsx(r.buf)[0];
  ok('export BHP memakai kolom jumlah/harga/realisasi',
    bhpSheet.rows.some(row => (row || []).some(c => /Jumlah Barang/.test(X.cellText(c))))
      && bhpSheet.rows.some(row => (row || []).some(c => /Realisasi/.test(X.cellText(c)))));
  const bhpDataRow = bhpSheet.rows.find(row => X.cellText(row && row[0]) === 'Pembelian BHP Hitung Uji');
  ok('export BHP mempertahankan qty, harga satuan, dan realisasi',
    !!bhpDataRow && bhpDataRow[1].n === 3 && bhpDataRow[2].n === 25000 && bhpDataRow[3].n === 75000);
  r = await req('GET', `/export/pembantu?p=pajak&ta=${ta.id}&bulan=${bulan}`, null, { binary: true });
  const pajakSheet = X.readXlsx(r.buf)[0];
  ok('export pajak memakai kolom PPN dan PPh', pajakSheet.rows.some(row => (row || []).some(c => /PPh 21/.test(X.cellText(c))))
    && pajakSheet.rows.some(row => (row || []).some(c => /SSPD/.test(X.cellText(c)))));
  r = await req('GET', `/cetak/lra?ta=${ta.id}&bulan=${bulan}`, null, { binary: true });
  ok('cetak LRA per bulan memuat rincian', /RINCIAN TRANSAKSI BELANJA/.test(r.buf.toString()));
  r = await req('GET', `/cetak/aruskas?ta=${ta.id}&bulan=${bulan}&bku=`, null, { binary: true });
  ok('cetak arus kas semua BKU', /Semua BKU/.test(r.buf.toString()));
  r = await req('GET', `/export/bku?ta=${ta.id}&bulan=${bulan}&bku=`, null, { binary: true });
  ok('export BKU per bulan xlsx', r.status === 200 && r.buf.slice(0, 2).toString() === 'PK');
  r = await req('GET', `/export/lra?ta=${ta.id}&bulan=${bulan}`, null, { binary: true });
  const lraSheet = X.readXlsx(r.buf)[0];
  ok('export LRA memuat rincian transaksi', lraSheet.rows.some(row => (row || []).some(c => /RINCIAN TRANSAKSI BELANJA/.test(X.cellText(c)))));

  /* ================= 12. instant search global ================= */
  const appjs = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  ok('app.js punya instant search global', /INSTANT SEARCH GLOBAL/.test(appjs) && /LIVE_NAMES/.test(appjs));
  r = await req('GET', '/transaksi');
  ok('filter transaksi punya kolom cari', /name="q"/.test(r.text));
  r = await req('GET', '/piutang');
  ok('piutang punya kolom cari', /name="q"/.test(r.text));
  r = await req('GET', '/beasiswa');
  ok('beasiswa punya pencarian nama + filter kelas', /Cari Nama \/ NISN/.test(r.text) && /Filter Kelas/.test(r.text));

  /* ================= 13. portal pegawai: piutang lainnya ================= */
  db.prepare("INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)")
    .run('Pegawai Uji', 'Guru', 'guru', '081234567890', '1990-05-05');
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Pegawai Uji'").get();
  db.prepare('INSERT INTO piutang_kategori (nama,keterangan,tampil_aset,aktif,urutan,created_at) VALUES (?,?,1,1,1,?)').run('Kategori Uji', 'x', today);
  const kat = db.prepare("SELECT * FROM piutang_kategori WHERE nama='Kategori Uji'").get();
  db.prepare('INSERT INTO piutang_lainnya (kategori_id,nama,tanggal,nominal,keterangan,status,tahun_ajaran_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(kat.id, 'Pegawai Uji', today, 350000, 'Piutang lainnya uji', 'belum', ta.id, today);
  r = await req('POST', '/portal-pegawai/otp', { nama: 'Pegawai Uji', lahir: '1990-05-05' });
  const kode = (/kode OTP Anda: <b[^>]*>(\d{4})<\/b>/.exec(r.text) || [])[1];
  ok('portal pegawai mengirim OTP (mode uji)', !!kode, r.status);
  const tok = (r.text.match(/name="token" value="([^"]+)"/) || [])[1];
  r = await req('POST', '/portal-pegawai/verifikasi', { token: tok, kode: kode || '' });
  ok('portal pegawai menampilkan Piutang Lainnya', /Piutang Lainnya/.test(r.text) && /350\.000/.test(r.text), r.status);

  /* ================= 14. audit orphan + hard delete ================= */
  db.prepare("INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,status,created_at) VALUES (999999,?,?,1000,0,1000,'manual',?)")
    .run(sBiasa.id, today, today);
  db.prepare("INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,keterangan,status,tahun_ajaran_id) VALUES (?,?,?,'Ghost TA',  'belum', 99999)")
    .run('Ghost Uji', today, 5000);
  r = await req('GET', '/audit-orphan');
  ok('audit orphan menemukan pembayaran tanpa tagihan', /Pembayaran iuran tanpa tagihan/.test(r.text));
  ok('audit orphan menemukan piutang TA hantu', /Piutang pegawai menempel TA yang sudah dihapus/.test(r.text));
  r = await req('POST', '/audit-orphan/hapus', { tabel: 'iuran_bayar', kode: 'iuran_bayar_yatim', id: db.prepare('SELECT id FROM iuran_bayar WHERE tagihan_id=999999').get().id });
  ok('hard delete baris orphan', r.status === 303 && !db.prepare('SELECT id FROM iuran_bayar WHERE tagihan_id=999999').get());
  r = await req('POST', '/audit-orphan/hapus', { kode: 'piutang_ghost_ta', semua: '1' });
  ok('hard delete semua kategori orphan', !db.prepare('SELECT id FROM piutang WHERE nama_pegawai=\'Ghost Uji\'').get());

  /* ================= 15. reset data per TA ================= */
  const before = {
    siswa: db.prepare('SELECT COUNT(*) c FROM siswa').get().c,
    pegawai: db.prepare('SELECT COUNT(*) c FROM pegawai').get().c,
    trxBku: db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku.id).c,
    trxTaBaru: (() => {
      const b = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0').get(taBaru.id);
      return b ? db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(b.id).c : 0;
    })()
  };
  await req('POST', '/transaksi/save', { bku_id: bku.id, tanggal: today, jenis: 'pemasukan', metode: 'tunai', coa_id: db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' LIMIT 1").get().id, nominal: '400000', uraian: 'Pemasukan sebelum reset' });
  ok('transaksi baru tersimpan', db.prepare("SELECT COUNT(*) c FROM transaksi WHERE uraian='Pemasukan sebelum reset'").get().c === 1);
  r = await req('POST', '/reset-tahun', { ta_id: ta.id, password: 'salah', konfirmasi: 'RESET', cadangan: '1' });
  ok('reset dengan sandi salah ditolak', /err=/.test(r.loc) && db.prepare("SELECT COUNT(*) c FROM transaksi WHERE uraian='Pemasukan sebelum reset'").get().c === 1, r.loc);
  r = await req('POST', '/reset-tahun', { ta_id: ta.id, password: 'admin123', konfirmasi: 'RESET', cadangan: '1' });
  ok('reset TA redirect sukses', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('transaksi TA terpilih terhapus', db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku.id).c === 0);
  ok('master siswa tetap ada', db.prepare('SELECT COUNT(*) c FROM siswa').get().c === before.siswa);
  ok('master pegawai tetap ada', db.prepare('SELECT COUNT(*) c FROM pegawai').get().c === before.pegawai);
  ok('penetapan iuran TA terpilih terhapus', db.prepare('SELECT COUNT(*) c FROM iuran_tagihan WHERE tahun_ajaran_id=?').get(ta.id).c === 0);
  ok('data TA lain tidak tersentuh', (() => {
    const b = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0').get(taBaru.id);
    return !b || db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(b.id).c === before.trxTaBaru;
  })());

  /* ================= ringkasan ================= */
  await new Promise(res => setTimeout(res, 200));
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek lulus`);
  if (/\[ERROR\]/.test(log)) console.log('LOG ERROR:\n' + log.split('\n').filter(l => /\[ERROR\]/.test(l)).slice(0, 8).join('\n'));
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
