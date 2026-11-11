'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Smoke test modul baru: akademik, iuran, ekskul, trash, mutasi kas, portal, rekonsiliasi kas */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3499;
const DB = path.join(os.tmpdir(), 'smk-new-' + Date.now() + '.sqlite');
const env = { ...process.env, PORT, DB_PATH: DB };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
// periode berjalan (hindari kunci periode lampau yang belum ditutup)
const PERIODE_EK = new Date().toISOString().slice(0, 7);
let cookie = '';
const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  if (!cond) console.log('FAIL', name, extra);
}
async function reqRaw(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    if (body instanceof Buffer) { payload = body; headers['Content-Type'] = 'application/octet-stream'; }
    else {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (Array.isArray(v)) v.forEach(x => usp.append(k, x));
        else usp.append(k, v);
      }
      payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, headers: r.headers, loc: r.headers.get('location') || '' };
}

/* ronde 43: alamat portal publik berpindah ke /<nama-sekolah>/<sub-slug>.
   Permintaan GET ke alamat lama (/portal…) dialihkan 302 — helper ini mengikutinya. */
async function portalFollow43(method, url, body, opt) {
  let r = await reqRaw(method, url, body, opt);
  if (method !== 'GET' || !/^\/portal(-|$|\?|\/)/.test(String(url || ''))) return r;
  for (let i = 0; i < 3 && [301, 302, 303, 307, 308].includes(r.status) && r.loc; i++) {
    r = await reqRaw('GET', r.loc.replace(/^https?:\/\/[^/]+/, ''), null, opt);
  }
  return r;
}
const req = (...a) => portalFollow43(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/login'); if (r.status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login', r.status === 303, r.status + ' ' + r.text.slice(0, 120));

  const pages = ['/', '/transaksi', '/mutasi-kas', '/siswa', '/kelas', '/program-keahlian', '/mutasi-kelas', '/siswa-nonaktif',
    '/iuran', '/iuran/data', '/iuran/transaksi', '/iuran/antrean', '/iuran/kertas', '/ekskul', '/ekskul/antrean', '/trash',
    '/laporan?r=neraca', '/laporan?r=neraca&rmode=bku', '/payroll', '/akun', '/aset', '/coa', '/sekolah', '/pegawai',
    '/laporan?r=bku', '/tahun-ajaran', '/piutang', '/piutang-lain'];
  for (const p of pages) {
    const rr = await req('GET', p);
    ok('GET ' + p, rr.status === 200, rr.status + ' ' + (rr.status !== 200 ? rr.text.slice(0, 200) : ''));
  }

  // ==== akademik: program, kelas, siswa ====
  r = await req('POST', '/program-keahlian/save', { nama: 'Akuntansi dan Keuangan Lembaga', program_studi: 'AKL', ketua: 'Ibu Ketua', aktif: '1' });
  ok('program save', r.status === 303);
  const prog = () => require('better-sqlite3')(DB).prepare('SELECT * FROM program_keahlian ORDER BY id DESC LIMIT 1').get();
  r = await req('POST', '/kelas/save', { nama: 'X AKL 1', tingkat: 'X', wali_kelas: 'Wali Satu', program_id: prog().id, aktif: '1' });
  ok('kelas save', r.status === 303);
  const dbl = require('better-sqlite3')(DB);
  const kelas = dbl.prepare('SELECT * FROM kelas ORDER BY id DESC LIMIT 1').get();
  r = await req('POST', '/siswa/save', { nisn: '00111', nama: 'Siswa Satu', jenis_kelamin: 'L', tanggal_lahir: '2009-03-12', kelas_id: kelas.id });
  ok('siswa save', r.status === 303);
  ok('siswa tersimpan + TA', dbl.prepare("SELECT * FROM siswa WHERE nisn='00111'").get()?.tahun_ajaran_id === kelas.tahun_ajaran_id);

  // validasi import siswa: NISN ganda
  const XLSX = (() => {
    // buat xlsx sederhana via lib.xlsxBuffer
    const lib = require('../lib');
    return lib.xlsxBuffer('Siswa', [
      ['NISN', 'NAMA', 'JENIS KELAMIN', 'TANGGAL LAHIR'].map(v => ({ v, bold: true })),
      ['00111', 'Duplikat NISN', 'L', '01/01/2010'],
      ['00112', 'OK Satu', 'P', '02/02/2010']
    ]);
  })();
  const b64 = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + XLSX.toString('base64');
  r = await req('POST', '/siswa/import', { kelas_id: kelas.id, file_b64: b64 });
  ok('import siswa redirect preview', r.status === 303 && /import\/preview\?token=/.test(r.headers.get('location') || ''), r.headers.get('location'));
  let loc = r.headers.get('location') || '';
  r = await req('GET', loc.replace(base, ''));
  ok('preview siswa menampilkan error NISN ganda', r.status === 200 && /sudah terdaftar/.test(r.text) && /Import dibatalkan/.test(r.text));
  // import bersih
  const libx = require('../lib');
  const XLSX2 = libx.xlsxBuffer('Siswa', [
    ['NISN', 'NAMA', 'JENIS KELAMIN', 'TANGGAL LAHIR'].map(v => ({ v, bold: true })),
    ['00201', 'Siswa Dua', 'P', '05/05/2010'],
    ['00202', 'Siswa Tiga', 'L', '06/06/2010']
  ]);
  r = await req('POST', '/siswa/import', { kelas_id: kelas.id, file_b64: 'data:application/octet-stream;base64,' + XLSX2.toString('base64') });
  loc = r.headers.get('location') || '';
  r = await req('GET', loc.replace(base, ''));
  ok('preview bersih', r.status === 200 && /Simpan 2 Siswa/.test(r.text));
  const token = /name="token" value="([^"]+)"/.exec(r.text)?.[1];
  r = await req('POST', '/siswa/import/commit', { token });
  ok('commit import siswa', r.status === 303 && dbl.prepare('SELECT COUNT(*) c FROM siswa').get().c >= 3);

  // ==== iuran: grup, nominal, tetapkan, bayar, antrean, posting ====
  r = await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  ok('iuran grup save', r.status === 303);
  const grup = dbl.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  ok('nominal 12 bulan', dbl.prepare('SELECT COUNT(*) c, SUM(nominal) s FROM iuran_nominal WHERE grup_id=?').get(grup.id).s === 1200000);
  const siswaIds = dbl.prepare('SELECT id FROM siswa').all().map(s => s.id);
  r = await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: siswaIds });
  ok('tetapkan iuran', r.status === 303 && dbl.prepare('SELECT COUNT(*) c FROM iuran_tagihan').get().c >= 3);
  const tag = dbl.prepare('SELECT * FROM iuran_tagihan LIMIT 1').get();
  const bku = dbl.prepare('SELECT * FROM bku WHERE status=\'aktif\' ORDER BY id LIMIT 1').get();
  r = await req('POST', '/iuran/bayar', { tagihan_id: tag.id, tanggal: new Date().toISOString().slice(0, 10), jumlah: '50000', potongan: '5000', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${tag.siswa_id}` });
  ok('bayar iuran redirect kwitansi', r.status === 303 && /kwitansi/.test(r.headers.get('location') || ''));
  const bay = dbl.prepare('SELECT * FROM iuran_bayar ORDER BY id DESC LIMIT 1').get();
  ok('dibayar = jumlah - potongan', bay && bay.dibayar === 45000, bay && bay.dibayar);
  ok('status pending (antrean)', bay && bay.status === 'pending');
  // kwitansi cetak 1 & 2 (replika)
  r = await req('GET', `/iuran/kwitansi?no=${encodeURIComponent(bay.kwitansi_no)}`);
  ok('kwitansi pertama', r.status === 200 && /BUKTI PEMBAYARAN SISWA/.test(r.text) && !/CETAKAN REPLIKA/.test(r.text));
  r = await req('GET', `/iuran/kwitansi?no=${encodeURIComponent(bay.kwitansi_no)}`);
  ok('kwitansi kedua = replika', r.status === 200 && /CETAKAN REPLIKA/.test(r.text));
  ok('print count tersimpan', dbl.prepare('SELECT print_count FROM iuran_bayar WHERE id=?').get(bay.id).print_count === 2);
  // antrean posting
  r = await req('GET', '/iuran/antrean');
  ok('antrean iuran tampil', r.status === 200 && /belum di-posting/.test(r.text));
  r = await req('POST', '/iuran/antrean/posting', { ids: String(bay.id), bku_id: bku.id });
  ok('posting iuran', r.status === 303, r.text.slice(0, 200));
  const trx = dbl.prepare("SELECT * FROM transaksi WHERE uraian LIKE 'Iuran SPP%'").get();
  ok('transaksi BKU terbentuk (uraian grup)', !!trx && trx.nominal === 45000, trx && trx.nominal);
  ok('pembayaran terposting', dbl.prepare('SELECT status FROM iuran_bayar WHERE id=?').get(bay.id).status === 'posted');
  const dashboard = await req('GET', '/');
  ok('dashboard tidak error', dashboard.status === 200);

  // ==== void transaksi + revert ====
  r = await req('POST', '/transaksi/void', { id: trx.id, alasan: 'Uji void', back: '/transaksi' });
  ok('void transaksi', r.status === 303);
  const rev = dbl.prepare('SELECT * FROM transaksi WHERE void_of=?').get(trx.id);
  ok('jurnal pembalik dibuat', !!rev && rev.jenis === 'pengeluaran' && rev.nominal === trx.nominal);
  ok('transaksi asli status void', dbl.prepare('SELECT status FROM transaksi WHERE id=?').get(trx.id).status === 'void');
  ok('pembayaran iuran kembali void', dbl.prepare('SELECT status FROM iuran_bayar WHERE id=?').get(bay.id).status === 'void');
  ok('audit void tercatat', !!dbl.prepare("SELECT 1 FROM audit WHERE aksi='VOID'").get());

  // ==== ekskul + antrean ====
  r = await req('POST', '/ekskul/save', { nama_pembina: 'Pembina Pramuka', periode: PERIODE_EK, kehadiran: '8', harga_satuan: '50000' });
  ok('ekskul save', r.status === 303);
  const ek = dbl.prepare('SELECT * FROM ekskul_honor ORDER BY id DESC LIMIT 1').get();
  ok('jumlah ekskul = kehadiran x harga', Math.round(ek.kehadiran * ek.harga_satuan) === 400000);
  r = await req('GET', '/ekskul/cetak?periode=' + PERIODE_EK + '');
  ok('cetak ekskul + tanda terima', r.status === 200 && /Tanda Terima/.test(r.text));
  r = await req('POST', '/ekskul/antrean/posting', { periode: PERIODE_EK, bku_id: bku.id });
  ok('posting ekskul', r.status === 303, r.text.slice(0, 200));
  ok('ekskul terposting', dbl.prepare('SELECT status FROM ekskul_honor WHERE id=?').get(ek.id).status === 'posted');

  // ==== mutasi bank & cash (tidak lewat BKU) ====
  const beforeTrx = dbl.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/mutasi-kas/save', { tanggal: new Date().toISOString().slice(0, 10), dari: 'tunai', ke: 'bank', nominal: '250000', keterangan: 'Setor tunai' });
  ok('mutasi kas save', r.status === 303);
  ok('mutasi tidak menambah transaksi BKU', dbl.prepare('SELECT COUNT(*) c FROM transaksi').get().c === beforeTrx);
  ok('mutasi tersimpan', dbl.prepare('SELECT COUNT(*) c FROM mutasi_kas').get().c === 1);

  // ==== trash: hapus transaksi -> restore ====
  const anyTrx = dbl.prepare("SELECT * FROM transaksi WHERE status='posted' AND COALESCE(is_penyesuaian,0)=0 ORDER BY id DESC LIMIT 1").get();
  r = await req('POST', '/transaksi/delete', { id: anyTrx.id, back: '/transaksi' });
  ok('hapus transaksi soft', r.status === 303);
  const trash = dbl.prepare("SELECT * FROM trash WHERE tabel='transaksi' ORDER BY id DESC LIMIT 1").get();
  ok('masuk kotak sampah', !!trash && trash.row_id === anyTrx.id);
  r = await req('POST', '/trash/restore', { id: trash.id });
  ok('restore transaksi', r.status === 303 && !!dbl.prepare('SELECT id FROM transaksi WHERE id=?').get(anyTrx.id));

  // ==== COA auto kode ====
  const coaPage = await req('GET', '/coa');
  const kodeBaru = /name="kode" value="(4\.1\.\d+)"/.exec(coaPage.text);
  ok('kode rekening otomatis terisi', coaPage.status === 200 && !!kodeBaru, kodeBaru && kodeBaru[1]);

  // ==== portal publik ====
  r = await req('GET', '/portal');
  ok('portal tampil', r.status === 200 && /Cek Tagihan/.test(r.text));
  r = await req('GET', '/portal?nama=Siswa%20Satu&lahir=12/03/2009');
  ok('portal data cocok', r.status === 200 && /Rekapitulasi Keseluruhan/.test(r.text) && /Iuran SPP/.test(r.text));
  r = await req('GET', '/portal?nama=Siswa%20Satu&lahir=01/01/2000');
  ok('portal salah tanggal ditolak', /Data tidak ditemukan/.test(r.text));

  // ==== rekonsiliasi kas 2 mode ====
  r = await req('GET', '/laporan?r=neraca&rmode=gabung');
  ok('rekon mode A', r.status === 200 && /Kas di Bank/.test(r.text) && !/Neraca \/ Posisi/.test(r.text));
  r = await req('GET', '/laporan?r=neraca&rmode=bku');
  ok('rekon mode B', r.status === 200 && /TOTAL SALDO SELURUH BKU/.test(r.text));
  r = await req('GET', '/cetak/neraca?rmode=gabung');
  ok('cetak rekonsiliasi kas', r.status === 200 && /Rekonsiliasi Kas/.test(r.text));
  r = await req('GET', '/export/neraca');
  ok('export rekonsiliasi kas', r.status === 200);

  // ==== payroll: sertifikasi default & export ====
  const pr = await req('GET', '/payroll');
  ok('payroll halaman', pr.status === 200);
  r = await req('GET', '/payroll/export');
  ok('export leger excel', r.status === 200 && r.text.length > 1000);

  // ==== kop surat ====
  const sek = await req('GET', '/sekolah');
  ok('kop default tampil', /PERWAKILAN YAYASAN PEMBINA LEMBAGA PENDIDIKAN/.test(sek.text));
  r = await req('POST', '/desain-cetak', { kop_baris: 'BARIS A\nBARIS B\nBARIS C\nSEKOLAH UJI\nAKREDITASI A\nALAMAT UJI', kop_font: '11', kop_font_besar: '18', print_tempat: 'Cikoneng' });
  ok('simpan kop', r.status === 303);
  const print = await req('GET', '/ekskul/cetak?periode=' + PERIODE_EK + '');
  ok('kop kustom tercetak', /SEKOLAH UJI/.test(print.text));

  // ==== import iuran dinamis (template & validasi) ====
  r = await req('GET', '/iuran/import/template');
  ok('template import iuran dinamis', r.status === 200);
  const tpl = libx.xlsxBuffer('Data Iuran', [
    ['NO', 'NAMA', 'KELAS', 'Iuran SPP - TANGGAL BAYAR', 'Iuran SPP - NOMINAL BAYAR'].map(v => ({ v, bold: true })),
    [1, 'Siswa Dua', 'X AKL 1', '01/10/2026', 100000],
    [2, 'Tidak Ada', 'X AKL 1', '01/10/2026', 50000]
  ]);
  const statBefore = dbl.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c;
  r = await req('POST', '/iuran/import', { file_b64: 'data:application/octet-stream;base64,' + tpl.toString('base64') });
  ok('import iuran error redirect', r.status === 303 && /imp=/.test(r.headers.get('location') || ''));
  const impPage = await req('GET', (r.headers.get('location') || '').replace(base, ''));
  ok('laporan validasi import modal', /Laporan Validasi Error Import/.test(impPage.text) && /tidak ditemukan/.test(impPage.text));
  ok('tidak ada data masuk saat error', dbl.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c === statBefore);

  // ==== lifecycle siswa: pindah (tanpa perlakuan tagihan — fitur pemutihan dihapus ronde 14) ====
  const siswaPindah = dbl.prepare("SELECT * FROM siswa WHERE nisn='00201'").get();
  r = await req('POST', '/siswa/status', { id: siswaPindah.id, aksi: 'status', status: 'pindah' });
  ok('status pindah tersimpan', r.status === 303);
  ok('tagihan siswa pindah TIDAK dikunci', dbl.prepare("SELECT COUNT(*) c FROM iuran_tagihan WHERE siswa_id=? AND COALESCE(writeoff,'')<>''").get(siswaPindah.id).c === 0);
  const nonaktif = await req('GET', '/siswa-nonaktif');
  ok('halaman siswa non-aktif', nonaktif.status === 200 && /Pindah \/ Mutasi Keluar/.test(nonaktif.text));

  // ==== mutasi kelas staging ====
  const siswaAktif = dbl.prepare("SELECT * FROM siswa WHERE status='aktif' LIMIT 1").get();
  r = await req('POST', '/mutasi-kelas/stage', { kelas_tujuan: kelas.id, siswa_id: siswaAktif.id });
  ok('stage mutasi', r.status === 303 && dbl.prepare("SELECT COUNT(*) c FROM siswa_mutasi WHERE status='draft'").get().c === 1);
  r = await req('POST', '/mutasi-kelas/apply', {});
  ok('apply mutasi', r.status === 303 && dbl.prepare("SELECT COUNT(*) c FROM siswa_mutasi WHERE status='ditetapkan'").get().c === 1);

  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek lulus ===`);
  if (fail.length) console.log(fail.map(f => `- ${f.name} ${f.extra || ''}`).join('\n'));
  if (/\[ERROR\]/.test(log)) console.log('SERVER ERROR LOG:\n' + log.split('\n').filter(l => /ERROR|Error/.test(l)).slice(0, 12).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(log.slice(-3000)); srv.kill(); process.exit(2); });
