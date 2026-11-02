'use strict';
/* Test ronde 7: iuran per bulan, kwitansi 1 TTD, CoA antrean, cascade delete, filter multi,
   export per bulan, piutang tanpa BKU, payroll review, rekon semua BKU, ekskul jenis,
   CoA pengeluaran (pajak/mutasi), buku pembantu mutasi + filter BKU, chart SPP, TA salin + kelulusan */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3591;
const DB = process.env.R7_DB || path.join(os.tmpdir(), 'smk-r7-' + Date.now() + '.sqlite');
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
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x));
      else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login', r.status === 303);
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? ORDER BY id LIMIT 1').get(ta.id);
  const bku2 = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND id<>? ORDER BY id LIMIT 1').get(ta.id, bku.id);

  /* ===== data dasar: kelas X & XII, siswa ===== */
  await req('POST', '/program-keahlian/save', { nama: 'Akuntansi', program_studi: 'AKL', ketua: 'Ketua' });
  const prog = db.prepare('SELECT * FROM program_keahlian ORDER BY id DESC LIMIT 1').get();
  await req('POST', '/kelas/save', { nama: 'XII AKL 1', tingkat: 'XII', wali_kelas: 'Wali', program_id: prog.id, aktif: '1' });
  await req('POST', '/kelas/save', { nama: 'X AKL 1', tingkat: 'X', wali_kelas: 'Wali', program_id: prog.id, aktif: '1' });
  const kXII = db.prepare("SELECT * FROM kelas WHERE nama='XII AKL 1'").get();
  const kX = db.prepare("SELECT * FROM kelas WHERE nama='X AKL 1'").get();
  await req('POST', '/siswa/save', { nisn: '1001', nama: 'Siswa Lulus A', jenis_kelamin: 'L', tanggal_lahir: '2008-01-01', kelas_id: kXII.id });
  await req('POST', '/siswa/save', { nisn: '1002', nama: 'Siswa Lulus B', jenis_kelamin: 'P', tanggal_lahir: '2008-02-02', kelas_id: kXII.id });
  await req('POST', '/siswa/save', { nisn: '1003', nama: 'Siswa Aktif C', jenis_kelamin: 'L', tanggal_lahir: '2010-03-03', kelas_id: kX.id });
  const sA = db.prepare("SELECT * FROM siswa WHERE nisn='1001'").get();
  const sC = db.prepare("SELECT * FROM siswa WHERE nisn='1003'").get();

  /* ===== 1. iuran bulanan: rincian & bayar per bulan ===== */
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  await req('POST', '/iuran/save', { nama: 'Iuran Praktik', jenis: 'nonbulanan', nominal_tunggal: '200000', aktif: '1' });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  const gPrak = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Praktik'").get();
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kXII.id, siswa_id: [sA.id] });
  await req('POST', `/iuran/grup/${gPrak.id}/tetapkan`, { kelas_id: kX.id, siswa_id: [sC.id] });
  const tagSpp = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSpp.id, sA.id);
  ok('tagihan SPP dibuat', !!tagSpp && Number(tagSpp.nominal) === 1200000);

  r = await req('GET', `/iuran/data/${sA.id}`);
  ok('detail siswa menampilkan rincian per bulan', /Iuran SPP - Juli/.test(r.text) && /Iuran SPP - Agustus/.test(r.text), r.status);
  const juliYear = (() => { const m = /Iuran SPP - Juli (\d{4})/.exec(r.text); return m ? m[1] : ''; })();
  ok('label bulan memakai tahun pelajaran', !!juliYear, juliYear);

  r = await req('POST', '/iuran/bayar', { tagihan_id: tagSpp.id, bulan: '7', tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${sA.id}` });
  ok('bayar per bulan redirect kwitansi', r.status === 303 && /kwitansi/.test(r.headers.get('location') || ''));
  const bayJuli = db.prepare('SELECT * FROM iuran_bayar ORDER BY id DESC LIMIT 1').get();
  ok('pembayaran menyimpan bulan', Number(bayJuli.bulan) === 7, bayJuli.bulan);
  r = await req('GET', `/iuran/data/${sA.id}`);
  const rowJuli = /Iuran SPP - Juli \d{4}<\/b><\/td>[\s\S]{0,260}?badge green/.test(r.text);
  const rowAgustus = /Iuran SPP - Agustus \d{4}<\/b><\/td>[\s\S]{0,260}?badge gray/.test(r.text);
  ok('bulan Juli lunas, Agustus belum', rowJuli && rowAgustus, 'juli=' + rowJuli + ' agustus=' + rowAgustus);
  // kwitansi: hanya TTD Pencatat + label bulan
  r = await req('GET', `/iuran/kwitansi?no=${encodeURIComponent(bayJuli.kwitansi_no)}`);
  ok('kwitansi memuat label bulan', /Iuran SPP - Juli \d{4}/.test(r.text));
  ok('kwitansi hanya kolom Pencatat (tanpa kolom Bendahara)', /ki-sign single/.test(r.text) && /Pencatat/.test(r.text) && (r.text.match(/class="sp"/g) || []).length === 1);

  // export per bulan (Excel) — kolom eksplisit tiap bulan
  r = await req('GET', `/iuran/export?format=xlsx&ta=${ta.id}`, null, { binary: true });
  let head = [];
  try { head = X.readXlsx(Buffer.from(r.text))[0].rows[0].map(c => X.cellText(c)); } catch (e) { head = []; }
  ok('export excel punya kolom per bulan', head.some(h => /Iuran SPP - JULI/i.test(h)) && head.some(h => /Iuran SPP - JUNI/i.test(h)), head.slice(0, 8).join('|'));

  // filter multi grup & kelas + ceklis siswa
  r = await req('GET', `/iuran/data?grup=${gSpp.id}&grup=${gPrak.id}&kelas=${kXII.id}&kelas=${kX.id}`);
  ok('filter multi grup/kelas', r.status === 200 && /Siswa Lulus A/.test(r.text) && /Siswa Aktif C/.test(r.text), r.status);
  ok('filter multi: checkbox grup/kelas & siswa', /name="kelas"/.test(r.text) && /name="grup"/.test(r.text) && /data-check-all-box="siswa"/.test(r.text));

  /* ===== 2. antrean posting: pilih kode akun ===== */
  r = await req('GET', '/iuran/antrean');
  ok('antrean menyediakan pilihan kode akun', /name="coa_id"/.test(r.text) && /Penerimaan Kegiatan Siswa/.test(r.text));
  const coaSpp = db.prepare("SELECT * FROM coa WHERE kode='4.1.01'").get();
  r = await req('POST', '/iuran/antrean/posting', { ids: String(bayJuli.id), bku_id: bku.id, coa_id: coaSpp.id });
  ok('posting dengan kode pilihan', r.status === 303, r.status);
  let trx = db.prepare("SELECT * FROM transaksi WHERE no_bukti LIKE '%/IUR/%' ORDER BY id DESC LIMIT 1").get();
  ok('transaksi memakai CoA yang dipilih', !!trx && trx.coa_id === coaSpp.id, trx && trx.coa_id);
  ok('grup mengingat CoA terakhir', Number(db.prepare('SELECT coa_id FROM iuran_grup WHERE id=?').get(gSpp.id).coa_id) === coaSpp.id);
  ok('pembayaran menjadi posted', db.prepare('SELECT status FROM iuran_bayar WHERE id=?').get(bayJuli.id).status === 'posted');

  /* ===== 3. cascade delete transaksi iuran ===== */
  const trxId = trx.id;
  const beforeTrx = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/iuran/bayar/delete', { id: bayJuli.id, back: '/iuran/transaksi' });
  ok('hapus pembayaran terposting', r.status === 303);
  ok('record BKU ikut terhapus', !db.prepare('SELECT id FROM transaksi WHERE id=?').get(trxId) && db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === beforeTrx - 1);
  ok('riwayat bayar iuran hilang (tagihan terutang lagi)', !db.prepare('SELECT id FROM iuran_bayar WHERE id=?').get(bayJuli.id));
  const tagRow = db.prepare(`SELECT t.nominal, COALESCE((SELECT SUM(b.jumlah) FROM iuran_bayar b WHERE b.tagihan_id=t.id AND b.status<>'void'),0) paid FROM iuran_tagihan t WHERE t.id=?`).get(tagSpp.id);
  ok('sisa tagihan kembali penuh', Number(tagRow.nominal) - Number(tagRow.paid) === 1200000, Number(tagRow.nominal) - Number(tagRow.paid));

  /* ===== 4. piutang pegawai: pelunasan gabungan tanpa BKU → LUNAS ===== */
  const namaPeg = 'Pegawai Uji Gabungan';
  await req('POST', '/piutang/save', { nama_pegawai: namaPeg, tanggal_utang: today, nominal: '300000', keterangan: 'p1' });
  await req('POST', '/piutang/save', { nama_pegawai: namaPeg, tanggal_utang: today, nominal: '200000', keterangan: 'p2' });
  const piu = db.prepare('SELECT * FROM piutang WHERE nama_pegawai=? ORDER BY id').all(namaPeg);
  ok('2 piutang dibuat', piu.length === 2);
  const trxBeforePiu = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/piutang/bayar-gabungan', { nama: namaPeg, nominal: '500000', tanggal_bayar: today, metode: 'tunai' });
  ok('bayar gabungan redirect', r.status === 303);
  const piuAfter = db.prepare('SELECT * FROM piutang WHERE nama_pegawai=? ORDER BY id').all(namaPeg);
  ok('semua piutang otomatis LUNAS', piuAfter.every(p => p.status === 'lunas'), piuAfter.map(p => p.status).join(','));
  ok('pelunasan tidak membuat transaksi BKU', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === trxBeforePiu);
  ok('cicilan tanpa bku & transaksi', db.prepare("SELECT COUNT(*) c FROM piutang_bayar WHERE bku_id IS NULL AND transaksi_id IS NULL").get().c === 2);
  r = await req('GET', '/piutang');
  ok('halaman piutang menampilkan Lunas', /Pegawai Uji Gabungan/.test(r.text) && /Lunas/.test(r.text));

  /* ===== 5. piutang sertifikasi: toggle masuk BKU ===== */
  await req('POST', '/piutang-lain/save', { nama: 'Pegawai Sertifikasi', tanggal: today, nominal: '400000', keterangan: 'sert' });
  const ps = db.prepare("SELECT * FROM piutang_lain WHERE nama='Pegawai Sertifikasi'").get();
  const trxBeforePl = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/piutang-lain/bayar', { id: ps.id, nominal: '100000', tanggal_bayar: today, metode: 'tunai', masuk_bku: '1', bku_id: bku.id });
  ok('sertifikasi masuk BKU membuat transaksi', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === trxBeforePl + 1);
  r = await req('POST', '/piutang-lain/bayar', { id: ps.id, nominal: '100000', tanggal_bayar: today, metode: 'tunai' });
  ok('sertifikasi tanpa BKU tidak membuat transaksi', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === trxBeforePl + 1);
  ok('sisa sertifikasi berkurang 200rb', Number(db.prepare('SELECT nominal FROM piutang_lain WHERE id=?').get(ps.id).nominal) - Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lain_bayar WHERE piutang_id=?').get(ps.id).s) === 200000);

  /* ===== 6. payroll: review modal ===== */
  await req('POST', '/pegawai/save', { nama: 'Guru Uji', jabatan: 'Guru', tipe: 'guru', aktif: '1' });
  await req('POST', '/payroll/tarik', { periode: today.slice(0, 7) });
  r = await req('GET', '/payroll?periode=' + today.slice(0, 7));
  // ronde 11: review screen dihapus → hanya tombol Simpan Draf
  ok('payroll hanya punya tombol Simpan Draf', !/mPayrollReview/.test(r.text) && /Simpan Draf/.test(r.text) && /Salin Data Bulan Sebelumnya/.test(r.text),
    `status=${r.status} modal=${/mPayrollReview/.test(r.text)} simpan=${/Simpan Draf/.test(r.text)}`);

  /* ===== 6b. kasbon payroll otomatis memotong piutang pegawai ===== */
  await req('POST', '/piutang/save', { nama_pegawai: 'Guru Uji', tanggal_utang: today, nominal: '200000', keterangan: 'kasbon uji' });
  const piuGuru = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Guru Uji' ORDER BY id DESC LIMIT 1").get();
  const pr = db.prepare("SELECT * FROM payroll WHERE lower(nama)=lower('Guru Uji') ORDER BY id DESC LIMIT 1").get();
  ok('baris payroll guru uji ada', !!pr);
  if (pr) {
    const base = {
      periode: today.slice(0, 7), ids: String(pr.id),
      [`${pr.id}_jam_efektif`]: '20', [`${pr.id}_jam_telat`]: '0', [`${pr.id}_honor_jam`]: '50000',
      [`${pr.id}_pot_kasbon`]: '50000'
    };
    r = await req('POST', '/payroll/simpan', base);
    ok('simpan draf payroll dengan kasbon', r.status === 303);
    // ronde 11: kasbon HANYA catatan slip — tidak memotong piutang otomatis
    const sisaDraf = 200000 - Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(piuGuru.id).s);
    ok('kasbon hanya dicatat (piutang tidak terpotong)', sisaDraf === 200000 && Number(db.prepare('SELECT pot_kasbon FROM payroll WHERE id=?').get(pr.id).pot_kasbon) === 50000, sisaDraf);
    ok('piutang tetap belum lunas', db.prepare('SELECT status FROM piutang WHERE id=?').get(piuGuru.id).status === 'belum');
  }

  /* ===== 7. rekonsiliasi bank: semua BKU + ceklis semua ===== */
  const coaAdm = db.prepare("SELECT * FROM coa WHERE kode='9.1.03'").get();
  for (const bk of [bku, bku2]) {
    await req('POST', '/transaksi/save', { bku_id: bk.id, tanggal: today, jenis: 'pengeluaran', metode: 'transfer', coa_id: coaAdm.id, nominal: '25000', uraian: 'Adm bank uji ' + bk.nama });
  }
  r = await req('GET', '/rekon');
  ok('rekon menampilkan semua BKU', r.status === 200 && r.text.includes(bku.nama) && r.text.includes(bku2.nama));
  ok('rekon punya ceklis semua', /data-check-group-box="rekon"/.test(r.text) && /Ceklis Semua/.test(r.text));
  const ownTrx = db.prepare("SELECT * FROM transaksi WHERE uraian=? ORDER BY id DESC LIMIT 1").get('Adm bank uji ' + bku2.nama);
  r = await req('POST', '/rekon/match', { ['match_' + ownTrx.id]: '1' });
  ok('pencocokan semua BKU tersimpan', r.status === 303 && Number(db.prepare('SELECT rekon_matched FROM transaksi WHERE id=?').get(ownTrx.id).rekon_matched) === 1);

  /* ===== 8. ekskul: jenis + export + cetak ===== */
  r = await req('POST', '/ekskul/save', { nama_pembina: 'Pembina Pramuka', jenis: 'Pramuka', periode: today.slice(0, 7), kehadiran: '8', harga_satuan: '50000' });
  ok('ekskul simpan dengan jenis', r.status === 303);
  const ek = db.prepare('SELECT * FROM ekskul_honor ORDER BY id DESC LIMIT 1').get();
  ok('jenis ekskul tersimpan', ek.jenis === 'Pramuka');
  r = await req('GET', '/ekskul');
  ok('halaman ekskul memuat tombol export & cetak', /Export Excel/.test(r.text) && /Cetak PDF/.test(r.text) && /Pramuka/.test(r.text));
  r = await req('GET', '/ekskul/export?periode=' + today.slice(0, 7), null, { binary: true });
  let ekh = [];
  try {
    // ronde 9: export dipisah per jenis ekskul → header JENIS EKSTRAKURIKULER muncul pada blok pertama
    const rowsE = X.readXlsx(Buffer.from(r.text))[0].rows.map(x => x.map(c => X.cellText(c)));
    ekh = rowsE.find(x => x.some(h => /JENIS EKSTRAKURIKULER/.test(h))) || rowsE[0] || [];
  } catch (e) { ekh = []; }
  ok('export ekskul punya kolom jenis', ekh.some(h => /JENIS EKSTRAKURIKULER/.test(h)), ekh.join('|'));
  r = await req('GET', '/ekskul/cetak?periode=' + today.slice(0, 7));
  ok('cetak ekskul: jenis + TTD penerima + pengesahan', /Pramuka/.test(r.text) && /Tanda Terima/.test(r.text) && /Mengetahui/.test(r.text) && /Bendahara/.test(r.text));

  /* ===== 9. CoA pajak & mutasi masuk kelompok pengeluaran ===== */
  r = await req('GET', '/transaksi');
  const blokOut = r.text.split('id="mTrxOut"')[1] || '';
  ok('form pengeluaran memuat kode pajak & mutasi', /2\.1\.01/.test(blokOut) && /9\.1\.03/.test(blokOut));
  ok('form pengeluaran tetap tanpa akun pendapatan', !/4\.1\.01/.test(blokOut));
  r = await req('GET', '/coa');
  ok('halaman CoA menandai kelompok pengeluaran', /kelompok Pengeluaran/.test(r.text));

  /* ===== 10. buku pembantu: mutasi kas + filter BKU ===== */
  r = await req('POST', '/mutasi-kas/save', { tanggal: today, dari: 'tunai', ke: 'bank', nominal: '500000', keterangan: 'setor uji' });
  ok('mutasi kas tersimpan', r.status === 303);
  r = await req('GET', '/laporan?r=pembantu&p=bank');
  ok('buku pembantu bank memuat mutasi kas', /Mutasi Bank &amp; Cash/.test(r.text) && /setor uji/.test(r.text));
  r = await req('GET', '/laporan?r=pembantu&p=tunai');
  ok('buku pembantu tunai memuat mutasi keluar', /Mutasi Bank &amp; Cash/.test(r.text));
  r = await req('GET', '/laporan?r=pembantu&p=bank&bku=' + bku2.id);
  ok('filter BKU buku pembantu tersedia', /multipick-list/.test(r.text) && /name="bku"/.test(r.text));
  ok('filter BKU menyaring baris', !r.text.includes(bku.nama) || !/Adm bank uji /.test(r.text.split('Bank')[0] || ''));

  /* ===== 11. dashboard: line chart SPP ===== */
  r = await req('GET', '/');
  ok('dashboard punya chart tren SPP', /Tren Penerimaan SPP per Bulan/.test(r.text) && /line/.test(r.text));
  ok('dashboard tanpa error', r.status === 200);

  /* ===== 12. tahun ajaran baru: salin master + kelulusan otomatis ===== */
  const taCountBefore = db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c;
  r = await req('POST', '/tahun-ajaran/save', {
    nama: '2027/2028', tanggal_mulai: '2027-07-01', tanggal_selesai: '2028-06-30',
    buat_bku: '1', salin_master: '1', rollover: '1'
  });
  ok('tahun ajaran baru dibuat', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c === taCountBefore + 1);
  const taNew = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2027/2028'").get();
  ok('grup iuran tersalin ke TA baru', db.prepare('SELECT COUNT(*) c FROM iuran_grup WHERE tahun_ajaran_id=?').get(taNew.id).c >= 2);
  ok('BKU standar TA baru dibuat', db.prepare('SELECT COUNT(*) c FROM bku WHERE tahun_ajaran_id=?').get(taNew.id).c >= 17);
  // ronde 12: kelulusan TIDAK lagi otomatis — harus manual (Data Siswa → ceklis → Perubahan Massal)
  ok('siswa kelas XII tidak otomatis LULUS', db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='lulus'").get(kXII.id).c === 0,
    db.prepare("SELECT status FROM siswa WHERE nisn='1001'").get().status);
  ok('tidak ada setting notifikasi kelulusan', !db.prepare("SELECT * FROM settings WHERE k='graduate_notice'").get());
  r = await req('GET', '/');
  ok('tanpa pop-up kelulusan di dashboard', !/mGradNotice/.test(r.text));
  // luluskan manual lewat perubahan massal agar pengujian sisa tagihan tetap berjalan
  await req('POST', '/siswa/bulk', {
    siswa: db.prepare("SELECT id FROM siswa WHERE kelas_id=? AND status='aktif'").all(kXII.id).map(x => String(x.id)),
    status: 'lulus'
  });
  ok('kelulusan manual lewat perubahan massal', db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='lulus'").get(kXII.id).c === 2);
  // ronde 14: modul "Sisa Tagihan Siswa Lulus" DIHAPUS — tagihan siswa lulus tetap bisa dibayar
  r = await req('GET', '/iuran/lulus');
  ok('modul sisa tagihan siswa lulus sudah dihapus', r.status === 404, r.status);
  // tagihan baru untuk siswa berstatus LULUS → tetap bisa dibayar (tanpa kuncian "tagihan ditutup")
  await req('POST', '/iuran/save', { nama: 'Iuran Uji Lulus', jenis: 'nonbulanan', nominal_tunggal: '50000', aktif: '1' });
  const gUji = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Uji Lulus'").get();
  await req('POST', `/iuran/grup/${gUji.id}/tetapkan`, { kelas_id: kXII.id, siswa_id: [sA.id] });
  const tagLulus = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gUji.id, sA.id);
  r = await req('POST', '/iuran/bayar', {
    tagihan_id: tagLulus.id, tanggal: today, jumlah: '50000', potongan: '0',
    metode: 'tunai', nonbku: '1', back: `/iuran/data/${sA.id}?ta=${tagLulus.tahun_ajaran_id}`
  });
  ok('tagihan siswa lulus tetap bisa dibayar', r.status === 303 && /kwitansi/.test(r.headers.get('location') || ''), r.headers.get('location') || '');

  /* halaman baru tetap bisa dibuka */
  for (const p of ['/rekon', '/ekskul', '/iuran/data', '/laporan?r=pembantu&p=bank', '/tahun-ajaran', '/piutang-lain']) {
    const rr = await req('GET', p);
    ok('GET ' + p, rr.status === 200, rr.status);
  }

  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek ronde 7 lulus ===`);
  if (fail.length) console.log(fail.map(f => `- ${f.name} ${f.extra || ''}`).join('\n'));
  if (/\[ERROR\]/.test(log)) console.log('SERVER ERROR:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 10).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(log.slice(-2500)); srv.kill(); process.exit(2); });
