'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 19 —
   1. Kwitansi pengeluaran: label "Telah diterima dari" + isi "Bendahara <sekolah>"
   2. Baris "Tempat, tanggal transaksi" seragam di semua cetakan + teks tempat dapat diedit
      di menu Desain Templat Cetak (default "Cikoneng")
   3. Portal tagihan siswa: urutan tahun pelajaran terlama di atas
   4. Ikon tanda seru pada keterangan portal slip proporsional (CSS)
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = 3649;
const DB = process.env.R19_DB || path.join(os.tmpdir(), 'smk-r19-' + Date.now() + '.sqlite');
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
  if (cookie && !opt.public) headers.Cookie = cookie;
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
  if (sc && !opt.public) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
const today = new Date().toISOString().slice(0, 10);
/** ambil teks bersih dari potongan html */
const textOf = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);
  db.prepare("UPDATE settings SET v='SMK PGRI CIKONENG' WHERE k='sekolah_nama'").run();

  /* ================= 1. KWITANSI PENGELUARAN ================= */
  await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai', coa_id: '', nominal: '1250000',
    uraian: 'Belanja ATK', nama_pihak: 'TOKO MAJU'
  });
  const trxOut = db.prepare("SELECT * FROM transaksi WHERE uraian='Belanja ATK'").get();
  r = await req('GET', `/transaksi/${trxOut.id}/kwitansi`);
  ok('kwitansi pengeluaran 200', r.status === 200);
  const kw = r.text;
  ok('label "Telah diterima dari" tampil', /Telah diterima dari/.test(textOf(kw)));
  ok('isi baris = "Bendahara SMK PGRI CIKONENG"', /Bendahara SMK PGRI CIKONENG/.test(textOf(kw)), textOf(kw).slice(0, 240));
  ok('label lama "Bendahara Sekolah" tidak dipakai lagi', !/Bendahara Sekolah/.test(textOf(kw)));
  ok('baris tanggal memakai tempat "Cikoneng, <tanggal>"', /Cikoneng, \d{1,2} \w+ \d{4}/.test(textOf(kw)),
    (textOf(kw).match(/[A-Za-z]+?, \d{1,2} \w+ \d{4}/g) || []).join(' | '));
  ok('nama sekolah lengkap tidak lagi dipakai sebagai tempat', !/SMK PGRI CIKONENG, \d{1,2}/.test(textOf(kw)));

  // kwitansi pemasukan tetap memakai nama pihak
  await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pemasukan', metode: 'tunai', coa_id: '', nominal: '500000',
    uraian: 'Sumbangan komite', nama_pihak: 'BAPAK SUTRISNO'
  });
  const trxIn = db.prepare("SELECT * FROM transaksi WHERE uraian='Sumbangan komite'").get();
  r = await req('GET', `/transaksi/${trxIn.id}/kwitansi`);
  ok('kwitansi pemasukan: label "Telah diterima dari"', /Telah diterima dari/.test(textOf(r.text)));
  ok('kwitansi pemasukan: isi = nama penyetor', /BAPAK SUTRISNO/.test(textOf(r.text)));

  /* ================= 2. TEMPAT PADA TANGGAL (edit di Desain Cetak) ================= */
  r = await req('GET', '/desain-cetak');
  ok('menu desain memuat kolom Tempat', /name="print_tempat"/.test(r.text) && /Tempat pada Tanggal Cetak/.test(r.text));
  ok('nilai default tempat = Cikoneng', /name="print_tempat" value="Cikoneng"/.test(r.text));
  ok('kolom isi "diterima dari" pengeluaran ada di desain', /name="lbl_kwitansi_trx_nilai_dari_keluar"/.test(r.text));
  ok('kolom label "diterima dari" pengeluaran ada di desain', /name="lbl_kwitansi_trx_dari_keluar"/.test(r.text));

  // ubah tempat → Ciamis
  const bodyDesain = () => {
    const out = { print_tempat: 'Ciamis' };
    for (const k of ['judul_masuk', 'judul_keluar', 'dari_masuk', 'dari_keluar', 'nilai_dari_keluar', 'sejumlah', 'untuk',
      'rekening', 'buku', 'metode', 'tanggal', 'jumlah', 'ttd_kepala', 'ttd_bendahara', 'ttd_penerima', 'ttd_penyetor', 'footer']) {
      out['lbl_kwitansi_trx_' + k] = '';
    }
    out['orient_kwitansi_trx'] = 'portrait';
    return out;
  };
  r = await req('POST', '/desain-cetak', bodyDesain());
  ok('simpan desain (tempat) berhasil', r.status === 303 && /ok=/.test(r.loc), decode(r.loc));
  ok('setting print_tempat tersimpan', db.prepare("SELECT v FROM settings WHERE k='print_tempat'").get().v === 'Ciamis');
  r = await req('GET', `/transaksi/${trxOut.id}/kwitansi`);
  ok('kwitansi memakai tempat baru "Ciamis, …"', /Ciamis, \d{1,2} \w+ \d{4}/.test(textOf(r.text)),
    (textOf(r.text).match(/[A-Za-z]+?, \d{1,2} \w+ \d{4}/g) || []).join(' | '));
  r = await req('GET', '/cetak/bku');
  ok('laporan cetak BKU juga memakai tempat baru', /Ciamis, \d{1,2} \w+ \d{4}/.test(textOf(r.text)),
    (textOf(r.text).match(/[A-Za-z]+?, \d{1,2} \w+ \d{4}/g) || []).join(' | '));

  // isi baris "diterima dari" dapat diubah lewat desain
  const custom = bodyDesain();
  custom.print_tempat = '';
  custom.lbl_kwitansi_trx_nilai_dari_keluar = 'Bendahara Sekolah {sekolah}';
  custom.lbl_kwitansi_trx_dari_keluar = 'Diterima dari';
  r = await req('POST', '/desain-cetak', custom);
  r = await req('GET', `/transaksi/${trxOut.id}/kwitansi`);
  ok('label kustom "Diterima dari" terpakai', /Diterima dari/.test(textOf(r.text)));
  ok('isi kustom dengan placeholder {sekolah} terpakai', /Bendahara Sekolah SMK PGRI CIKONENG/.test(textOf(r.text)), textOf(r.text).slice(0, 200));
  ok('tempat kosong kembali ke default Cikoneng', /Cikoneng, \d{1,2} \w+ \d{4}/.test(textOf(r.text)),
    (textOf(r.text).match(/[A-Za-z]+?, \d{1,2} \w+ \d{4}/g) || []).join(' | '));

  // konfigurasi LAMA (belum punya kolom nilai_dari_keluar) yang menyimpan "Bendahara Sekolah"
  // otomatis memakai redaksional baru; konfigurasi baru yang sengaja diisi tetap dihormati.
  const oldDesign = {
    docs: {
      kwitansi_trx: {
        orient: 'portrait',
        labels: {
          judul_masuk: 'KWITANSI PENERIMAAN', judul_keluar: 'KWITANSI PENGELUARAN',
          dari_masuk: 'Telah diterima dari', dari_keluar: 'Bendahara Sekolah',
          sejumlah: 'Uang sejumlah', untuk: 'Untuk pembayaran', rekening: 'Kode Rekening', buku: 'Buku Kas',
          metode: 'Metode', tanggal: 'Tanggal', jumlah: 'Jumlah', ttd_kepala: 'Mengetahui',
          ttd_bendahara: 'Bendahara', ttd_penerima: 'Penerima', ttd_penyetor: 'Penyetor',
          footer: 'Kwitansi ini sah sebagai bukti {jenis} kas sekolah.'
        }
      }
    }
  };
  db.prepare("UPDATE settings SET v=? WHERE k='print_design'").run(JSON.stringify(oldDesign));
  r = await req('GET', `/transaksi/${trxOut.id}/kwitansi`);
  ok('konfigurasi lama otomatis memakai label "Telah diterima dari"', /Telah diterima dari/.test(textOf(r.text)), textOf(r.text).slice(0, 200));
  ok('konfigurasi lama otomatis memakai isi "Bendahara <sekolah>"', /Bendahara SMK PGRI CIKONENG/.test(textOf(r.text)));

  /* ================= 2b. SEMUA CETAKAN MEMAKAI FORMAT TEMPAT YANG SAMA ================= */
  await req('POST', '/desain-cetak', Object.assign(bodyDesain(), { print_tempat: 'Cikoneng' }));
  const printPages = ['/cetak/bku', '/cetak/neraca', '/cetak/lra', '/cetak/piutang', '/cetak/aruskas', '/cetak/pembantu', '/cetak/sertifikasi'];
  for (const u of printPages) {
    const rr = await req('GET', u);
    ok(`cetakan ${u} memuat "Cikoneng, <tanggal>"`, rr.status === 200 && /Cikoneng, \d{1,2} \w+ \d{4}/.test(textOf(rr.text)),
      textOf(rr.text).slice(0, 120));
  }
  // kwitansi iuran (bukti pembayaran siswa)
  await req('POST', '/iuran/save', { nama: 'SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1', tahun_ajaran_id: ta.id });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran Praktik', jenis: 'nonbulanan', nominal_tunggal: '50000', aktif: '1', tahun_ajaran_id: ta.id });
  const gPrak = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Praktik'").get();

  /* ================= 3. PORTAL TAGIHAN: URUTAN TAHUN TERLAMA DI ATAS ================= */
  await req('POST', '/tahun-ajaran/save', {
    nama: '2020/2021', tanggal_mulai: '2020-07-01', tanggal_selesai: '2021-06-30', buat_bku: '1'
  });
  const taLama = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2020/2021'").get();
  ok('tahun ajaran lama dibuat', !!taLama);
  await req('POST', '/program-keahlian/save', { nama: 'RPL', program_studi: 'RPL', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='RPL'").get();
  await req('POST', '/kelas/save', { nama: 'X RPL 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X RPL 1'").get();
  await req('POST', '/siswa/save', { nisn: '6100', nama: 'Andi Pratama', jenis_kelamin: 'L', tanggal_lahir: '2010-02-02', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='6100'").get();
  // grup + tagihan pada TA lama & TA baru
  for (const [nm, taId, nom] of [['SPP Lama', taLama.id, '100000'], ['SPP Baru', ta.id, '150000']]) {
    await req('POST', '/iuran/save', { nama: nm, jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: nom, aktif: '1', tahun_ajaran_id: taId });
    const g = db.prepare('SELECT * FROM iuran_grup WHERE nama=?').get(nm);
    await req('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  }
  // pembayaran iuran (non-BKU) → untuk uji kwitansi iuran
  const gLama = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Lama'").get();
  const tagLama = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? LIMIT 1').get(gLama.id);
  ok('tagihan SPP Lama terbentuk', !!tagLama);
  await req('POST', '/iuran/bayar', {
    tagihan_id: tagLama.id, tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai',
    nonbku: '1', back: `/iuran/data/${siswa.id}`
  });
  const bayarRow = db.prepare('SELECT * FROM iuran_bayar ORDER BY id DESC LIMIT 1').get();
  const kwIuran = await req('GET', `/iuran/kwitansi?ids=${bayarRow.id}`);
  ok('kwitansi iuran memakai format tempat "Cikoneng, <tanggal>"', /Cikoneng, \d{1,2} \w+ \d{4}/.test(textOf(kwIuran.text)),
    textOf(kwIuran.text).slice(0, 160));
  ok('tagihan 2 tahun pelajaran terbentuk',
    db.prepare('SELECT COUNT(DISTINCT tahun_ajaran_id) c FROM iuran_tagihan WHERE siswa_id=?').get(siswa.id).c === 2,
    String(db.prepare('SELECT COUNT(DISTINCT tahun_ajaran_id) c FROM iuran_tagihan WHERE siswa_id=?').get(siswa.id).c));
  r = await req('GET', `/portal?nama=${encodeURIComponent('Andi Pratama')}&lahir=2010-02-02`, null, { public: true });
  const order = [...r.text.matchAll(/Tahun Pelajaran (\d{4}\/\d{4})/g)].map(x => x[1]);
  ok('portal menampilkan 2 tahun pelajaran', order.length === 2, order.join(', '));
  ok('urutan tahun pelajaran TERLAMA di atas', order[0] === '2020/2021' && order[1] === ta.nama, order.join(' → '));

  /* ================= 4. CSS ikon proporsional ================= */
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
  ok('CSS membatasi ikon di teks bantuan (.help svg)', /\.help svg[^{]*\{[^}]*width:13px/.test(css));
  ok('CSS membatasi ikon di hint (.hint svg)', /\.hint svg[^{]*\{[^}]*width:13px/.test(css));

  srv.kill();
  db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 19 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1500)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
