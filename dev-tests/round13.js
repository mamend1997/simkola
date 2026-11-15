'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test ronde 13:
   1. Mutasi kelas LINTAS tahun pelajaran tidak menghapus data tahun asal
      (tabel siswa_penempatan + backfill riwayat dari siswa_mutasi)
   2. Modul Piutang Lainnya: kategori fleksibel CRUD, tagihan, cicilan,
      bayar gabungan, import/export/cetak, sakelar Akun Aset Riil */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const PORT = 3677;
const DB = process.env.R13_DB || path.join(os.tmpdir(), 'smk-r13-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie && !opt.public) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x));
      else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !opt.public) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '', type: r.headers.get('content-type') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const db = new Database(DB);
  const taA = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  /* ================= A. MUTASI KELAS LINTAS TAHUN PELAJARAN ================= */
  r = await req('POST', '/tahun-ajaran/save', { nama: '2099/2100', tanggal_mulai: '2099-07-01', tanggal_selesai: '2100-06-30' });
  ok('tambah TA tujuan', r.status === 303);
  const taB = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2099/2100'").get();
  ok('TA tujuan tersimpan', !!taB);

  await req('POST', '/kelas/save', { nama: 'X UJI A', tingkat: 'X', tahun_ajaran_id: taA.id });
  await req('POST', '/kelas/save', { nama: 'X UJI B', tingkat: 'X', tahun_ajaran_id: taA.id });
  await req('POST', '/kelas/save', { nama: 'XI UJI B', tingkat: 'XI', tahun_ajaran_id: taB.id });
  const kelasA1 = db.prepare("SELECT * FROM kelas WHERE nama='X UJI A'").get();
  const kelasA2 = db.prepare("SELECT * FROM kelas WHERE nama='X UJI B'").get();
  const kelasB = db.prepare("SELECT * FROM kelas WHERE nama='XI UJI B'").get();
  ok('kelas TA asal & tujuan dibuat', kelasA1 && kelasA2 && kelasB);

  r = await req('POST', '/siswa/save', { nisn: '9000000001', nama: 'Siswa Uji Mutasi', jenis_kelamin: 'L', kelas_id: kelasA1.id });
  ok('siswa dibuat di kelas TA asal', r.status === 303);
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='9000000001'").get();
  ok('penempatan awal tercatat', db.prepare('SELECT COUNT(*) c FROM siswa_penempatan WHERE siswa_id=?').get(siswa.id).c === 1);

  r = await req('GET', `/siswa?ta=${taA.id}`);
  ok('siswa tampil di TA asal', r.text.includes('Siswa Uji Mutasi'));
  r = await req('GET', `/siswa?ta=${taB.id}`);
  ok('siswa belum ada di TA tujuan', !r.text.includes('Siswa Uji Mutasi'));

  // draf mutasi lintas TA
  r = await req('POST', '/mutasi-kelas/stage', { kelas_asal: kelasA1.id, kelas_tujuan: kelasB.id, siswa_id: siswa.id });
  ok('stage mutasi lintas TA', r.status === 303);
  const draft = db.prepare("SELECT * FROM siswa_mutasi WHERE siswa_id=? AND status='draft'").get(siswa.id);
  ok('draf mencatat TA asal & tujuan', draft && String(draft.ta_asal_id) === String(taA.id) && String(draft.ta_tujuan_id) === String(taB.id));

  r = await req('POST', '/mutasi-kelas/apply');
  ok('apply mutasi', r.status === 303);
  ok('pesan menyebut data tahun asal tersimpan', decodeURIComponent(r.loc).includes('tahun pelajaran asal tetap tersimpan') || decodeURIComponent(r.loc).includes('lintas tahun'));

  const pen = db.prepare('SELECT * FROM siswa_penempatan WHERE siswa_id=? ORDER BY tahun_ajaran_id').all(siswa.id);
  ok('penempatan bertambah (tahun asal + tujuan)', pen.length === 2, JSON.stringify(pen));
  ok('penempatan TA asal tetap kelas asal', pen.some(p => String(p.tahun_ajaran_id) === String(taA.id) && String(p.kelas_id) === String(kelasA1.id)));
  ok('penempatan TA tujuan = kelas tujuan', pen.some(p => String(p.tahun_ajaran_id) === String(taB.id) && String(p.kelas_id) === String(kelasB.id)));
  ok('record siswa TIDAK terhapus', !!db.prepare('SELECT * FROM siswa WHERE id=?').get(siswa.id));

  r = await req('GET', `/siswa?ta=${taA.id}`);
  ok('rekap TA asal masih memuat siswa', r.text.includes('Siswa Uji Mutasi') && r.text.includes('X UJI A'));
  r = await req('GET', `/siswa?ta=${taB.id}`);
  ok('rekap TA tujuan memuat siswa', r.text.includes('Siswa Uji Mutasi') && r.text.includes('XI UJI B'));
  r = await req('GET', `/kelas?ta=${taA.id}`);
  ok('jumlah siswa kelas TA asal tetap 1', /X UJI A[\s\S]{0,400}?<td class="num">1<\/td>/.test(r.text));

  // mutasi dalam TA yang sama → penempatan TA tujuan diperbarui, riwayat TA lain utuh
  r = await req('POST', '/mutasi-kelas/stage', { kelas_asal: kelasA1.id, kelas_tujuan: kelasA2.id, siswa_id: siswa.id });
  ok('stage mutasi dalam TA', r.status === 303);
  r = await req('POST', '/mutasi-kelas/apply');
  ok('apply mutasi dalam TA', r.status === 303);
  const pen2 = db.prepare('SELECT * FROM siswa_penempatan WHERE siswa_id=?').all(siswa.id);
  ok('tetap 2 penempatan (tidak menduplikasi TA)', pen2.length === 2, JSON.stringify(pen2));
  ok('kelas TA asal ikut berubah sesuai mutasi', pen2.some(p => String(p.tahun_ajaran_id) === String(taA.id) && String(p.kelas_id) === String(kelasA2.id)));
  ok('penempatan TA tujuan tidak tersentuh', pen2.some(p => String(p.tahun_ajaran_id) === String(taB.id)));

  r = await req('GET', `/siswa/${siswa.id}`);
  ok('detail siswa menampilkan riwayat penempatan', r.text.includes('Riwayat Penempatan Kelas') && r.text.includes('2099/2100') && r.text.includes(taA.nama));
  r = await req('GET', '/mutasi-kelas?kelas_asal=' + kelasA2.id + '&ta_asal=' + taA.id);
  ok('halaman mutasi menampilkan riwayat & siswa asal', r.status === 200 && r.text.includes('Riwayat Mutasi Terakhir') && r.text.includes('Siswa Uji Mutasi'));

  // backfill riwayat: siswa yang dulu "dipindah" hanya lewat kolom siswa tetap punya penempatan TA asal
  const legacy = db.prepare('SELECT COUNT(*) c FROM siswa_penempatan').get().c;
  ok('tabel penempatan terisi untuk semua siswa', legacy >= db.prepare('SELECT COUNT(*) c FROM siswa').get().c);
  ok('kelas berisi siswa tidak bisa dihapus', (await req('POST', '/kelas/delete', { id: kelasB.id })).loc.includes('err='));

  /* ================= B. PIUTANG LAINNYA ================= */
  r = await req('GET', '/piutang-lainnya');
  ok('halaman piutang lainnya 200', r.status === 200 && r.text.includes('Kategori Piutang Lainnya'));

  r = await req('POST', '/piutang-lainnya/kategori/save', { nama: 'Dana Talangan', keterangan: 'Talangan kegiatan', tampil_aset: '1', aktif: '1' });
  ok('tambah kategori', r.status === 303);
  const kat = db.prepare("SELECT * FROM piutang_kategori WHERE nama='Dana Talangan'").get();
  ok('kategori tersimpan + tampil aset default Ya', kat && Number(kat.tampil_aset) === 1);

  r = await req('POST', '/piutang-lainnya/kategori/save', { nama: 'dana talangan' });
  ok('kategori duplikat ditolak', r.loc.includes('err='));

  r = await req('POST', '/piutang-lainnya/kategori/save', { id: kat.id, nama: 'Dana Talangan Kegiatan', keterangan: 'Diubah', tampil_aset: '1', aktif: '1' });
  ok('edit kategori', r.status === 303 && !!db.prepare("SELECT * FROM piutang_kategori WHERE nama='Dana Talangan Kegiatan'").get());

  r = await req('POST', '/piutang-lainnya/kategori/save', { nama: 'Piutang Koperasi' });
  const kat2 = db.prepare("SELECT * FROM piutang_kategori WHERE nama='Piutang Koperasi'").get();
  ok('kategori kedua dibuat', !!kat2);

  // tagihan
  r = await req('POST', '/piutang-lainnya/save', { kategori_id: kat.id, nama: 'Budi Uji', tanggal: today, nominal: '1.000.000', keterangan: 'Talangan uji' });
  ok('tambah tagihan', r.status === 303);
  const tag = db.prepare("SELECT * FROM piutang_lainnya WHERE nama='Budi Uji' ORDER BY id DESC LIMIT 1").get();
  ok('tagihan tersimpan dengan kategori', tag && String(tag.kategori_id) === String(kat.id) && Number(tag.nominal) === 1000000);
  ok('tagihan punya tahun pelajaran', String(tag.tahun_ajaran_id) === String(taA.id));

  r = await req('GET', '/piutang-lainnya');
  ok('tagihan tampil di halaman', r.text.includes('Budi Uji') && r.text.includes('Dana Talangan'));

  r = await req('POST', '/piutang-lainnya/save', { id: tag.id, kategori_id: kat.id, nama: 'Budi Uji', tanggal: today, nominal: '1200000' });
  ok('edit tagihan', r.status === 303 && Number(db.prepare('SELECT nominal FROM piutang_lainnya WHERE id=?').get(tag.id).nominal) === 1200000);

  // pembayaran tanpa BKU
  const trxBefore = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/piutang-lainnya/bayar', { id: tag.id, nominal: '400000', tanggal_bayar: today, metode: 'tunai' });
  ok('bayar tanpa BKU', r.status === 303 && decodeURIComponent(r.loc).includes('Sisa tagihan'));
  ok('tidak membuat transaksi BKU', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === trxBefore);
  ok('sisa tagihan 800.000', db.prepare("SELECT 1200000 - COALESCE((SELECT SUM(nominal) FROM piutang_lainnya_bayar WHERE piutang_id=?),0) s").get(tag.id).s === 800000);

  // pembayaran masuk BKU
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(taA.id);
  r = await req('POST', '/piutang-lainnya/bayar', { id: tag.id, nominal: '300000', tanggal_bayar: today, metode: 'transfer', masuk_bku: '1', bku_id: bku.id });
  ok('bayar masuk BKU', r.status === 303);
  ok('transaksi BKU bertambah', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === trxBefore + 1);
  const trxBayar = db.prepare("SELECT * FROM transaksi WHERE uraian LIKE 'Pembayaran piutang lainnya%' ORDER BY id DESC LIMIT 1").get();
  ok('transaksi pemasukan tercatat', trxBayar && trxBayar.jenis === 'pemasukan' && Number(trxBayar.nominal) === 300000);
  ok('pembayaran tertaut transaksi', !!db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE transaksi_id=?').get(trxBayar.id));

  r = await req('POST', '/piutang-lainnya/bayar', { id: tag.id, nominal: '99999999', tanggal_bayar: today });
  ok('pembayaran melebihi sisa ditolak', r.loc.includes('err='));

  const bayar1 = db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE piutang_id=? ORDER BY id LIMIT 1').get(tag.id);
  r = await req('POST', '/piutang-lainnya/bayar/save', { id: bayar1.id, nominal: '500000', tanggal: today, metode: 'tunai' });
  ok('edit riwayat pembayaran', r.status === 303 && Number(db.prepare('SELECT nominal FROM piutang_lainnya_bayar WHERE id=?').get(bayar1.id).nominal) === 500000);

  // pembayaran gabungan (dua tagihan nama sama)
  await req('POST', '/piutang-lainnya/save', { kategori_id: kat2.id, nama: 'Budi Uji', tanggal: today, nominal: '200000', keterangan: 'Tagihan kedua' });
  const tag2 = db.prepare("SELECT * FROM piutang_lainnya WHERE kategori_id=? ORDER BY id DESC LIMIT 1").get(kat2.id);
  const totalSisa = db.prepare(`SELECT COALESCE(SUM(MAX(COALESCE(p.nominal,0) - COALESCE((SELECT SUM(x.nominal) FROM piutang_lainnya_bayar x WHERE x.piutang_id=p.id),0),0)),0) s
    FROM piutang_lainnya p WHERE lower(trim(p.nama))='budi uji'`).get().s;
  r = await req('POST', '/piutang-lainnya/bayar-gabungan', { nama: 'Budi Uji', nominal: String(totalSisa), tanggal_bayar: today, metode: 'tunai' });
  ok('bayar gabungan', r.status === 303 && decodeURIComponent(r.loc).includes('LUNAS'));
  ok('semua tagihan Budi Uji lunas', db.prepare("SELECT COUNT(*) c FROM piutang_lainnya WHERE nama='Budi Uji' AND status<>'lunas'").get().c === 0);

  // hapus riwayat pembayaran → transaksi BKU ikut terhapus
  const bayarBku = db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE transaksi_id IS NOT NULL ORDER BY id DESC LIMIT 1').get();
  r = await req('POST', '/piutang-lainnya/bayar/delete', { id: bayarBku.id });
  ok('hapus riwayat pembayaran', r.status === 303 && !db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE id=?').get(bayarBku.id));
  ok('transaksi BKU terkait ikut dihapus', !db.prepare('SELECT * FROM transaksi WHERE id=?').get(bayarBku.transaksi_id));

  // sakelar aset riil
  await req('POST', '/piutang-lainnya/save', { kategori_id: kat.id, nama: 'Citra Uji', tanggal: today, nominal: '750000' });
  const katSisa = () => Number(db.prepare(`SELECT COALESCE(SUM(MAX(COALESCE(p.nominal,0) - COALESCE((SELECT SUM(x.nominal) FROM piutang_lainnya_bayar x WHERE x.piutang_id=p.id),0),0)),0) s
    FROM piutang_lainnya p WHERE p.kategori_id=?`).get(kat.id).s || 0);
  ok('sisa kategori dihitung', katSisa() >= 750000);

  r = await req('GET', '/aset');
  ok('aset menampilkan baris piutang lainnya', r.text.includes('Piutang Lainnya — Dana Talangan Kegiatan'));
  r = await req('POST', '/piutang-lainnya/kategori/toggle', { id: kat.id });
  ok('toggle kategori → sembunyikan dari aset', r.status === 303 && Number(db.prepare('SELECT tampil_aset FROM piutang_kategori WHERE id=?').get(kat.id).tampil_aset) === 0);
  r = await req('GET', '/aset');
  ok('baris aset bertanda disembunyikan', r.text.includes('Piutang Lainnya — Dana Talangan Kegiatan <span class="badge gray plain">disembunyikan</span>'));

  r = await req('POST', '/piutang-lainnya/kategori/toggle', { id: kat.id, tampil_aset: '1' });
  ok('toggle kategori → tampil lagi', Number(db.prepare('SELECT tampil_aset FROM piutang_kategori WHERE id=?').get(kat.id).tampil_aset) === 1);

  r = await req('POST', '/piutang-lainnya/toggle-aset', {});
  ok('sakelar modul → Tidak', db.prepare("SELECT v FROM settings WHERE k='tampil_piutang_lainnya'").get().v === '0');
  r = await req('GET', '/aset');
  ok('modul tersembunyi dari aset', r.text.includes('Piutang Lainnya — Dana Talangan Kegiatan <span class="badge gray plain">disembunyikan</span>') && r.text.includes('dihitung Rp 0'));
  r = await req('POST', '/piutang-lainnya/toggle-aset', { tampil: '1' });
  ok('sakelar modul → Ya', db.prepare("SELECT v FROM settings WHERE k='tampil_piutang_lainnya'").get().v === '1');

  // cetak / bukti / export / template / import
  r = await req('GET', '/piutang-lainnya/template');
  ok('template Excel', r.status === 200 && r.type.includes('spreadsheet'));
  r = await req('GET', '/piutang-lainnya/export');
  ok('export Excel', r.status === 200 && r.type.includes('spreadsheet'));
  r = await req('GET', '/piutang-lainnya/cetak');
  ok('cetak PDF', r.status === 200 && r.text.includes('Daftar Piutang Lainnya'));
  r = await req('GET', `/piutang-lainnya/${tag.id}/bukti`);
  ok('bukti pencairan', r.status === 200 && r.text.includes('PENCairan'.toUpperCase()) && r.text.includes('Budi Uji'));
  const anyBayar = db.prepare('SELECT * FROM piutang_lainnya_bayar ORDER BY id DESC LIMIT 1').get();
  r = await req('GET', `/piutang-lainnya/bayar/${anyBayar.id}/bukti`);
  ok('bukti pelunasan', r.status === 200 && r.text.includes('PELUNASAN'));

  const contohCSV = `TANGGAL,NAMA,NOMINAL,KETERANGAN,MASUK\n${today},Contoh Nama,500000,Piutang dana talangan — baris contoh silakan dihapus,`;
  await req('POST', '/piutang-lainnya/import', { kategori_id: kat.id, file_b64: Buffer.from(contohCSV).toString('base64'), file_name: 'template.csv' });
  ok('baris contoh template piutang lainnya dilewati', db.prepare("SELECT COUNT(*) c FROM piutang_lainnya WHERE nama='Contoh Nama'").get().c === 0);

  const csv = 'TANGGAL,NAMA,NOMINAL,KETERANGAN,MASUK\n' + today + ',Dodi Import,300000,Import uji,\n' + today + ',Dodi Import,150000,Import uji,50000\n';
  r = await req('POST', '/piutang-lainnya/import', { kategori_id: kat.id, file_b64: Buffer.from(csv).toString('base64'), file_name: 'uji.csv' });
  ok('import CSV', r.status === 303 && decodeURIComponent(r.loc).includes('Import selesai'));
  ok('baris hasil import tersimpan', db.prepare("SELECT COUNT(*) c FROM piutang_lainnya WHERE nama='Dodi Import'").get().c === 2);
  ok('pembayaran hasil import tercatat', db.prepare("SELECT COUNT(*) c FROM piutang_lainnya_bayar WHERE piutang_id IN (SELECT id FROM piutang_lainnya WHERE nama='Dodi Import')").get().c === 1);

  // kategori yang masih dipakai tidak boleh dihapus
  r = await req('POST', '/piutang-lainnya/kategori/delete', { id: kat.id });
  ok('kategori terpakai tidak bisa dihapus', r.loc.includes('err='));
  r = await req('POST', '/piutang-lainnya/kategori/save', { nama: 'Kategori Sementara' });
  const kat3 = db.prepare("SELECT * FROM piutang_kategori WHERE nama='Kategori Sementara'").get();
  r = await req('POST', '/piutang-lainnya/kategori/delete', { id: kat3.id });
  ok('kategori kosong bisa dihapus', r.status === 303 && !db.prepare('SELECT * FROM piutang_kategori WHERE id=?').get(kat3.id));
  ok('kategori terhapus masuk kotak sampah', db.prepare("SELECT COUNT(*) c FROM trash WHERE tabel='piutang_kategori'").get().c >= 1);

  // hapus tagihan (masuk kotak sampah)
  const delTarget = db.prepare("SELECT * FROM piutang_lainnya WHERE nama='Citra Uji'").get();
  r = await req('POST', '/piutang-lainnya/delete', { id: delTarget.id });
  ok('hapus tagihan', r.status === 303 && !db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(delTarget.id));
  ok('tagihan terhapus masuk kotak sampah', db.prepare("SELECT COUNT(*) c FROM trash WHERE tabel='piutang_lainnya'").get().c >= 1);

  // RBAC: role kepala sekolah hanya lihat
  await req('POST', '/pengguna/save', { nama: 'Kepsek Uji', email: 'kepsek.uji@sekolah.sch.id', role: 'kepala_sekolah', password: 'kepsek123', aktif: '1' });
  const adminCookie = cookie;
  cookie = '';
  r = await req('POST', '/login', { email: 'kepsek.uji@sekolah.sch.id', password: 'kepsek123' });
  ok('login kepsek', r.status === 303);
  ok('kepsek bisa lihat halaman', (await req('GET', '/piutang-lainnya')).status === 200);
  ok('kepsek tidak bisa tambah kategori', (await req('POST', '/piutang-lainnya/kategori/save', { nama: 'Dilarang' })).status === 403);
  ok('kepsek tidak bisa ubah sakelar aset', (await req('POST', '/piutang-lainnya/toggle-aset', { tampil: '1' })).status === 403);
  cookie = adminCookie;

  // laporan & export piutang lainnya
  cookie = adminCookie;
  r = await req('GET', '/laporan?r=lainnya');
  ok('tab laporan piutang lainnya', r.status === 200 && r.text.includes('Rekapitulasi Piutang Lainnya per Kategori'));
  r = await req('GET', '/cetak/lainnya');
  ok('cetak laporan piutang lainnya', r.status === 200 && r.text.includes('Rekapitulasi Piutang Lainnya'));
  r = await req('GET', '/export/lainnya');
  ok('export laporan piutang lainnya', r.status === 200 && r.type.includes('spreadsheet'));

  // backup ZIP memuat tabel baru
  r = await req('GET', '/backup/download-zip');
  ok('backup ZIP 200', r.status === 200 && r.type.includes('zip'));
  const X = require('../xlsx-read');
  const zipRes = await fetch(base + '/backup/download-zip', { headers: { Cookie: cookie }, redirect: 'manual' });
  const entries = Object.keys(X.unzipEntries(Buffer.from(await zipRes.arrayBuffer())));
  ok('backup memuat piutang_lainnya.csv', entries.includes('data/piutang_lainnya.csv'));
  ok('backup memuat piutang_kategori.csv', entries.includes('data/piutang_kategori.csv'));
  ok('backup memuat siswa_penempatan.csv', entries.includes('data/siswa_penempatan.csv'));

  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 13 lulus ===`);
  db.close(); srv.kill();
  if (pass !== results.length) { console.log('LOG SERVER:\n' + log.slice(-2000)); process.exit(1); }
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
