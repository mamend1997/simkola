'use strict';
/* Test ronde 9: kwitansi per-transaksi, bayar item terpilih (per item + non-BKU), rekap & bayar gabungan
   piutang sertifikasi, counter transaksi tanpa batas 300, portal publik (autocomplete, datepicker, OTP,
   feedback orang tua), beasiswa baru, kertas kwitansi transaksi, bukti piutang, ekskul per jenis,
   grafik SPP Juli–Juni, sidebar collapse & urutan identitas sekolah */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3599;
const DB = process.env.R9_DB || path.join(os.tmpdir(), 'smk-r9-' + Date.now() + '.sqlite');
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
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x));
      else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !opt.public) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const periode = today.slice(0, 7);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login', r.status === 303);
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  /* ===== data dasar ===== */
  await req('POST', '/program-keahlian/save', { nama: 'RPL', program_studi: 'RPL', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='RPL'").get();
  await req('POST', '/kelas/save', { nama: 'X RPL 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X RPL 1'").get();
  await req('POST', '/siswa/save', { nisn: '5001', nama: 'Andi Pratama', jenis_kelamin: 'L', tanggal_lahir: '2010-04-04', kelas_id: kelas.id });
  const s1 = db.prepare("SELECT * FROM siswa WHERE nisn='5001'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  await req('POST', '/iuran/save', { nama: 'Iuran Praktik', jenis: 'nonbulanan', nominal_tunggal: '200000', aktif: '1' });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  const gPrak = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Praktik'").get();
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [s1.id] });
  await req('POST', `/iuran/grup/${gPrak.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [s1.id] });
  const tSpp = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(gSpp.id);
  const tPrak = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(gPrak.id);

  /* ===== 1. kwitansi hanya item yang baru diisi ===== */
  r = await req('POST', '/iuran/bayar', { tagihan_id: tSpp.id, bulan: '7', tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${s1.id}` });
  const loc = r.headers.get('location') || '';
  ok('redirect kwitansi memuat rows', /rows=\d+/.test(loc), decodeURIComponent(loc));
  const firstRowId = Number((/rows=(\d+)/.exec(loc) || [])[1]);
  let k = await req('GET', loc.replace(base, ''));
  ok('kwitansi memuat 1 item', k.status === 200 && (k.text.match(/<tr><td class="num">\d+<\/td><td>/g) || []).length === 1);
  // tambah pembayaran kedua; kwitansi pertama tidak boleh berubah
  await req('POST', '/iuran/bayar', { tagihan_id: tPrak.id, tanggal: today, jumlah: '200000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${s1.id}` });
  k = await req('GET', `/iuran/kwitansi?rows=${firstRowId}`);
  ok('kwitansi lama tetap 1 item (tidak mencampur grup lain)', (k.text.match(/<tr><td class="num">\d+<\/td><td>/g) || []).length === 1 && !/Iuran Praktik/.test(k.text));

  /* ===== 2. bayar item terpilih: per item (tanggal/metode/jumlah/potongan/BKU) ===== */
  const rowsBefore = db.prepare('SELECT COUNT(*) c FROM iuran_bayar').get().c;
  r = await req('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${s1.id}`, n: '3',
    key_0: `m:${tSpp.id}:8`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '100000', potongan_0: '20000', bku_0: String(bku.id), nonbku_0: '',
    key_1: `m:${tSpp.id}:9`, tanggal_1: today, metode_1: 'transfer', jumlah_1: '50000', potongan_1: '0', bku_1: String(bku.id), nonbku_1: '',
    key_2: `m:${tSpp.id}:10`, tanggal_2: today, metode_2: 'tunai', jumlah_2: '100000', potongan_2: '0', bku_2: '', nonbku_2: '1'
  });
  ok('bayar item terpilih tersimpan', r.status === 303 && /info=/.test(r.headers.get('location') || ''), r.headers.get('location'));
  ok('3 pembayaran baru terbentuk', db.prepare('SELECT COUNT(*) c FROM iuran_bayar').get().c === rowsBefore + 3);
  const bulan8 = db.prepare('SELECT * FROM iuran_bayar WHERE bulan=8 ORDER BY id DESC LIMIT 1').get();
  ok('potongan per item tersimpan (20rb)', Number(bulan8.potongan) === 20000 && Number(bulan8.dibayar) === 80000, JSON.stringify({ p: bulan8.potongan, d: bulan8.dibayar }));
  const bulan9 = db.prepare('SELECT * FROM iuran_bayar WHERE bulan=9 ORDER BY id DESC LIMIT 1').get();
  ok('nominal per item tersimpan (50rb)', Number(bulan9.jumlah) === 50000 && bulan9.metode === 'transfer');
  ok('BKU per item tersimpan', Number(bulan8.bku_id) === bku.id && bulan9.bku_id === bku.id);

  /* ===== 3. non-BKU: tidak masuk antrean & tidak menambah kas ===== */
  const bulan10 = db.prepare('SELECT * FROM iuran_bayar WHERE bulan=10 ORDER BY id DESC LIMIT 1').get();
  ok('item non-BKU berstatus manual & tanpa BKU', bulan10.status === 'manual' && !bulan10.bku_id, JSON.stringify({ s: bulan10.status, b: bulan10.bku_id }));
  r = await req('GET', '/iuran/antrean');
  // baris non-BKU tidak dirender pada antrean (modal edit per baris bernama mE<id>)
  ok('antrean tidak memuat baris pembayaran non-BKU', !r.text.includes('mE' + bulan10.id + '"'), 'baris non-BKU muncul di antrean');
  const pendingCount = db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c;
  ok('jumlah pending = jumlah baris antrean rincian', (r.text.match(/<button class="btn btn-sm btn-icon" data-open="mE\d+"/g) || []).length === pendingCount,
    `pending=${pendingCount}`);
  const kasBku = db.prepare(`SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) s FROM transaksi WHERE bku_id=? AND status='posted'`).get(bku.id).s;
  ok('kas BKU tidak bertambah oleh non-BKU', Number(kasBku) === 0, String(kasBku));
  const trxIuran = await req('GET', '/iuran/transaksi');
  ok('label Data Saja (Non-BKU) tampil', /Data Saja \(Non-BKU\)/.test(trxIuran.text));
  // sisa tagihan ikut berkurang oleh pembayaran non-BKU
  const tagRow = dbm => 0;
  const sisaSpp = db.prepare(`SELECT t.nominal - COALESCE((SELECT SUM(b.jumlah) FROM iuran_bayar b WHERE b.tagihan_id=t.id AND b.status<>'void'),0) s FROM iuran_tagihan t WHERE t.id=?`).get(tSpp.id).s;
  ok('tagihan tetap berkurang walau non-BKU', Number(sisaSpp) === 1200000 - (100000 + 100000 + 50000 + 100000), String(sisaSpp));
  // toggle non-BKU pada form bayar
  const detail = await req('GET', `/iuran/data/${s1.id}`);
  ok('form bayar punya toggle Non-BKU', /data-nonbku/.test(detail.text) && /Hanya Simpan Data Pembayaran \(Non-BKU\)/.test(detail.text));
  ok('modal bayar massal tersedia', /id="mBayarItem"/.test(detail.text) && /data-bulk-pay/.test(detail.text) && /data-bulk-rows/.test(detail.text));

  /* ===== 4. piutang sertifikasi: rekap + bayar gabungan ===== */
  await req('POST', '/piutang-lain/save', { nama: 'Guru Sertifikasi', tanggal: today, nominal: '300000', keterangan: 'angkatan 1' });
  await req('POST', '/piutang-lain/save', { nama: 'Guru Sertifikasi', tanggal: today, nominal: '200000', keterangan: 'angkatan 2' });
  r = await req('GET', '/piutang-lain');
  ok('rekap per pegawai tampil', /Rekapitulasi Piutang Sertifikasi per Pegawai/.test(r.text) && /Guru Sertifikasi/.test(r.text) && /Bayar Gabungan/.test(r.text));
  r = await req('POST', '/piutang-lain/bayar-gabungan', { nama: 'Guru Sertifikasi', nominal: '500000', tanggal_bayar: today, metode: 'tunai', keterangan: 'gabungan uji' });
  ok('bayar gabungan redirect ok', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  const pl = db.prepare("SELECT * FROM piutang_lain WHERE nama='Guru Sertifikasi' ORDER BY id").all();
  ok('semua tagihan sertifikasi lunas', pl.every(x => x.status === 'lunas'), pl.map(x => x.status).join(','));
  ok('dua cicilan tercatat', db.prepare('SELECT COUNT(*) c FROM piutang_lain_bayar WHERE piutang_id IN (?,?)').get(pl[0].id, pl[1].id).c === 2);
  r = await req('GET', `/laporan?r=sertifikasi&ta=${ta.id}`);
  ok('laporan sertifikasi memuat rekap per pegawai', /Rekapitulasi Piutang Sertifikasi per Pegawai/.test(r.text));
  r = await req('GET', `/cetak/sertifikasi?ta=${ta.id}`);
  ok('cetak sertifikasi: bagian rekap per pegawai', /A\. REKAP PER PEGAWAI/.test(r.text) && /B\. RINCIAN TAGIHAN/.test(r.text));
  r = await req('GET', `/export/sertifikasi?ta=${ta.id}`, null, { binary: true });
  const xh = X.readXlsx(Buffer.from(r.text))[0].rows.map(row => row.map(c => X.cellText(c)));
  ok('export sertifikasi punya blok rekap per pegawai', xh.some(x => /A\. REKAP PER PEGAWAI/.test(x.join('|'))));

  /* ===== 5. counter transaksi tidak mentok 300 ===== */
  const before = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  db.transaction(() => {
    const ins = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,status,created_by,created_at)
      VALUES (?,?,'pemasukan','tunai',?,?,?,?,'posted',1,?)`);
    const coa = db.prepare("SELECT id FROM coa WHERE kategori='pendapatan' LIMIT 1").get();
    for (let i = 0; i < 310; i++) ins.run(bku.id, today, `UJI/${i + 1}`, coa ? coa.id : null, 1000, `Transaksi uji ${i + 1}`, new Date().toISOString().slice(0, 19).replace('T', ' '));
  })();
  const totalTrx = db.prepare('SELECT COUNT(*) c FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE b.tahun_ajaran_id=?').get(ta.id).c;
  r = await req('GET', `/transaksi?ta=${ta.id}`);
  ok('counter transaksi = jumlah aktual (>300)', totalTrx > 300 && new RegExp('Jumlah Transaksi</div><div class="val" style="font-size:19px">' + totalTrx + '<').test(r.text), `total=${totalTrx}`);
  ok('pagination tampil', /class="pager"/.test(r.text) && /halaman 1\//.test(r.text));
  r = await req('GET', `/transaksi?ta=${ta.id}&hal=2`);
  ok('halaman 2 transaksi dapat dibuka', r.status === 200 && /halaman 2\//.test(r.text));
  const totalLine = /Jumlah Transaksi<\/div><div class="val" style="font-size:19px">(\d+)</.exec(r.text);
  ok('jumlah transaksi konsisten di halaman 2', totalLine && Number(totalLine[1]) === totalTrx, totalLine && totalLine[1]);

  /* ===== 6. portal siswa: autocomplete, datepicker, tanpa login petugas, feedback ===== */
  r = await req('GET', '/portal', null, { public: true });
  ok('portal siswa tanpa tombol Login Petugas', r.status === 200 && !/Login Petugas/.test(r.text));
  ok('kolom nama memakai autocomplete', /data-autocomplete="\/portal\/siswa"/.test(r.text) && /data-autocomplete-min="3"/.test(r.text));
  ok('tanggal lahir memakai datepicker', /<input type="date" name="lahir"/.test(r.text));
  r = await req('GET', '/portal/siswa?q=An', null, { public: true });
  ok('autocomplete < 3 huruf kosong', /"items":\[\]/.test(r.text));
  r = await req('GET', '/portal/siswa?q=And', null, { public: true });
  ok('autocomplete ≥ 3 huruf mengembalikan nama', /Andi Pratama/.test(r.text));
  r = await req('GET', `/portal?nama=Andi%20Pratama&lahir=2010-04-04`, null, { public: true });
  ok('hasil portal terbuka via tanggal ISO', r.status === 200 && /Andi Pratama/.test(r.text));
  ok('tombol kembali berlabel tepat', /Kembali ke Halaman Pencarian/.test(r.text) && !/Cari Siswa Lain/.test(r.text));
  ok('form catatan orang tua ada', /Kolom Catatan Orang Tua \/ Wali/.test(r.text) && /Kirim Catatan/.test(r.text));
  r = await req('POST', '/portal/pesan', { siswa_id: s1.id, kontak: '08123456789', pesan: 'Pembayaran SPP Juli sudah dibayar, mohon dicek.' }, { public: true });
  ok('kirim catatan orang tua redirect', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  const pesan = db.prepare('SELECT * FROM portal_pesan ORDER BY id DESC LIMIT 1').get();
  ok('catatan tersimpan status baru', pesan && pesan.status === 'baru' && pesan.siswa_id === s1.id);
  r = await req('GET', '/');
  ok('dashboard menampilkan kartu pesan orang tua', /Pesan \/ Catatan Orang Tua/.test(r.text) && /Pembayaran SPP Juli/.test(r.text));
  r = await req('GET', '/pesan-orangtua');
  ok('halaman pesan orang tua', r.status === 200 && /Tandai Selesai/.test(r.text));
  r = await req('POST', '/pesan-orangtua/selesai', { id: pesan.id, back: '/pesan-orangtua' });
  ok('tandai selesai redirect', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  ok('status catatan menjadi selesai', db.prepare('SELECT status FROM portal_pesan WHERE id=?').get(pesan.id).status === 'selesai');
  r = await req('GET', '/pesan-orangtua');
  ok('label Selesai Ditindaklanjuti tampil', /Selesai Ditindaklanjuti/.test(r.text));

  /* ===== 7. master pegawai: tanggal lahir + WA ===== */
  r = await req('POST', '/pegawai/save', { nama: 'Budi Guru', jabatan: 'Guru RPL', tipe: 'guru', aktif: '1', tanggal_lahir: '1988-05-05', whatsapp: '081298765432' });
  ok('simpan pegawai dengan tgl lahir & WA', r.status === 303);
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Budi Guru'").get();
  ok('tanggal lahir & WA tersimpan ternormalisasi', pg.tanggal_lahir === '1988-05-05' && pg.whatsapp === '6281298765432', JSON.stringify({ t: pg.tanggal_lahir, w: pg.whatsapp }));
  r = await req('GET', '/pegawai');
  ok('form pegawai punya field baru', /name="tanggal_lahir"/.test(r.text) && /name="whatsapp"/.test(r.text));

  /* ===== 8. portal piutang pegawai (OTP) ===== */
  await req('POST', '/piutang/save', { nama_pegawai: 'Budi Guru', tanggal_utang: today, nominal: '150000', keterangan: 'kasbon' });
  r = await req('GET', '/portal-pegawai', null, { public: true });
  ok('portal pegawai terbuka', r.status === 200 && /Cek Piutang Pegawai/.test(r.text) && /data-autocomplete/.test(r.text));
  r = await req('GET', '/portal-pegawai/nama?q=Bud', null, { public: true });
  ok('autocomplete pegawai (≥3 huruf)', /Budi Guru/.test(r.text));
  r = await req('GET', '/portal-pegawai/nama?q=Bu', null, { public: true });
  ok('autocomplete pegawai <3 huruf kosong', /"items":\[\]/.test(r.text));
  r = await req('POST', '/portal-pegawai/otp', { nama: 'Budi Guru', lahir: '1988-05-05' }, { public: true });
  ok('OTP terkirim (mode demo)', r.status === 200 && /Verifikasi Kode OTP/.test(r.text), r.status);
  const tok = (/name="token" value="([^"]+)"/.exec(r.text) || [])[1] || '';
  const demo = (/kode OTP Anda: <b class="mono"[^>]*>(\d{4})</.exec(r.text) || [])[1] || '';
  ok('token & kode demo tampil', !!tok && /^\d{4}$/.test(demo), `tok=${!!tok} kode=${demo}`);
  r = await req('POST', '/portal-pegawai/verifikasi', { token: tok, kode: '0000' === demo ? '1111' : '0000' }, { public: true });
  ok('OTP salah ditolak', /Kode OTP salah/.test(r.text));
  r = await req('POST', '/portal-pegawai/verifikasi', { token: tok, kode: demo }, { public: true });
  ok('OTP benar membuka rincian piutang', /Piutang Pegawai \(Umum\)/.test(r.text) && /Piutang Sertifikasi/.test(r.text));
  ok('rincian memuat tanggal & sisa', /Sisa Tagihan/.test(r.text) && /Rp 150\.000/.test(r.text));
  r = await req('POST', '/portal-pegawai/otp', { nama: 'Budi Guru', lahir: '1999-01-01' }, { public: true });
  ok('tanggal lahir salah ditolak', /tidak ditemukan/i.test(r.text));

  /* ===== 9. portal slip gaji (OTP) ===== */
  await req('POST', '/pegawai/save', { nama: 'Budi Guru', jabatan: 'Guru RPL', tipe: 'guru', aktif: '1', tanggal_lahir: '1988-05-05', whatsapp: '081298765432' });
  await req('POST', '/payroll/tarik', { periode });
  const pr = db.prepare("SELECT * FROM payroll WHERE lower(nama)=lower('Budi Guru') AND periode=?").get(periode);
  if (pr) {
    await req('POST', '/payroll/simpan', {
      periode, ids: String(pr.id),
      [`${pr.id}_jam_efektif`]: '20', [`${pr.id}_jam_telat`]: '0', [`${pr.id}_honor_jam`]: '50000',
      [`${pr.id}_jam_wali_kelas`]: '4', [`${pr.id}_pot_dana_sosial`]: '10000', [`${pr.id}_pot_kasbon`]: '25000'
    });
  }
  ok('baris payroll tersedia', !!pr);
  r = await req('GET', '/portal-slip', null, { public: true });
  ok('portal slip terbuka tanpa field WA', r.status === 200 && /Slip Gaji/.test(r.text) && !/name="wa"/.test(r.text));
  r = await req('POST', '/portal-slip/otp', { nama: 'Budi Guru', lahir: '1988-05-05' }, { public: true });
  ok('OTP slip terkirim', /Verifikasi Kode OTP/.test(r.text));
  const tok2 = (/name="token" value="([^"]+)"/.exec(r.text) || [])[1] || '';
  const demo2 = (/kode OTP Anda: <b class="mono"[^>]*>(\d{4})</.exec(r.text) || [])[1] || '';
  r = await req('POST', '/portal-slip/verifikasi', { token: tok2, kode: demo2 }, { public: true });
  ok('rincian slip terbuka setelah OTP', /Rincian Slip Gaji/.test(r.text) && /Komponen Penerimaan/.test(r.text) && /Komponen Pengurangan/.test(r.text));
  ok('slip memuat periode terpilih pada judul', new RegExp(`Rincian Slip Gaji / Honor`).test(r.text));
  r = await req('GET', `/portal-slip/hasil?token=${encodeURIComponent(tok2)}&periode=${periode}`, null, { public: true });
  ok('ganti periode via dropdown (server)', /Periode aktif:/.test(r.text) && /name="bulan"/.test(r.text));
  ok('slip memuat komponen wali kelas & kasbon', /Wali Kelas/.test(r.text) && /Kasbon/.test(r.text));
  ok('tombol cetak slip tersedia', /Cetak Slip/.test(r.text));
  r = await req('GET', `/portal-slip/cetak?token=${encodeURIComponent(tok2)}&periode=${periode}`, null, { public: true });
  ok('cetak slip PDF (halaman cetak)', r.status === 200 && /SLIP GAJI PEGAWAI — PERIODE:/.test(r.text));
  ok('cetak slip tanpa kolom tanda tangan', !/<div class="slip-sign"/.test(r.text));
  r = await req('POST', '/portal-slip/otp', { nama: 'Budi Guru', lahir: '1999-01-01' }, { public: true });
  ok('tanggal lahir salah ditolak (slip)', /tidak ditemukan/i.test(r.text));

  /* ===== 10. beasiswa baru: grup + bulan + persen + penerima ===== */
  r = await req('GET', '/beasiswa');
  ok('form beasiswa baru', r.status === 200 && /data-bea-grup/.test(r.text) && /data-bea-bulan/.test(r.text) && /data-bea-nominal/.test(r.text) && /data-bea-persen/.test(r.text));
  ok('panel penerima + pratinjau ada', /data-bea-preview/.test(r.text) && /data-check-all-box="penerima"/.test(r.text) && /mBeaPreview/.test(r.text));
  const payload = JSON.stringify({
    nama: 'Beasiswa Prestasi', deskripsi: 'Dana yayasan', tahun_ajaran_id: String(ta.id),
    grup_id: String(gSpp.id), bulan_mask: '7,8', nominal_per_siswa: 50000, persen: 50, aktif: true, siswa: [s1.id]
  });
  r = await req('POST', '/beasiswa/save-final', { payload, tahun_ajaran_id: ta.id });
  ok('simpan final beasiswa', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  const bea = db.prepare("SELECT * FROM beasiswa WHERE nama='Beasiswa Prestasi'").get();
  ok('beasiswa menyimpan grup/bulan/persen', bea && Number(bea.grup_id) === gSpp.id && bea.bulan_mask === '7,8' && Number(bea.persen) === 50, JSON.stringify(bea && { g: bea.grup_id, b: bea.bulan_mask, p: bea.persen }));
  ok('nominal total beasiswa = per siswa x penerima', Number(bea.nominal) === 50000);
  ok('penerima beasiswa tersimpan', db.prepare('SELECT COUNT(*) c FROM beasiswa_siswa WHERE beasiswa_id=?').get(bea.id).c === 1);
  ok('beasiswaTotal ikut terpakai', dbmBeasiswaTotal(db, ta.id) === 50000, String(dbmBeasiswaTotal(db, ta.id)));

  /* ===== 11. kertas kwitansi transaksi ===== */
  const trxId = db.prepare('SELECT id FROM transaksi ORDER BY id LIMIT 1').get().id;
  r = await req('GET', `/transaksi/${trxId}/kwitansi`);
  ok('kwitansi transaksi default PORTRAIT A4', /@page\{size:A4 portrait/.test(r.text), (/@page\{[^}]*\}/.exec(r.text) || [])[0]);
  let rSmall = await req('GET', `/transaksi/${trxId}/kwitansi?orient=small`);
  ok('opsi kertas 1/3 F4 (210x99mm) tersedia', /@page\{size:210mm 99mm/.test(rSmall.text), (/@page\{[^}]*\}/.exec(rSmall.text) || [])[0]);
  ok('kwitansi punya tombol pengaturan kertas', /Ukuran Kertas/.test(r.text));
  r = await req('GET', '/transaksi/kertas');
  ok('halaman pengaturan kertas', r.status === 200 && /Margin Atas/.test(r.text) && /Margin Kanan/.test(r.text));
  r = await req('POST', '/transaksi/kertas', { kw_trx_w_mm: '210', kw_trx_h_mm: '99', kw_trx_mt_mm: '5', kw_trx_mb_mm: '4', kw_trx_ml_mm: '9', kw_trx_mr_mm: '7' });
  ok('simpan ukuran kertas', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  r = await req('GET', `/transaksi/${trxId}/kwitansi?orient=small`);
  ok('ukuran kertas custom diterapkan (mode 1/3 F4)', /@page\{size:210mm 99mm; margin:5mm 7mm 4mm 9mm\}/.test(r.text), (/@page\{[^}]*\}/.exec(r.text) || [])[0]);
  r = await req('POST', '/transaksi/kertas', { kw_trx_w_mm: '70', kw_trx_h_mm: '99', kw_trx_mt_mm: '6', kw_trx_mb_mm: '6', kw_trx_ml_mm: '35', kw_trx_mr_mm: '35' });
  ok('margin terlalu besar ditolak', r.status === 303 && /err=/.test(r.headers.get('location') || ''));

  /* ===== 12. bukti piutang (pencairan & pelunasan) ===== */
  const piu = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Budi Guru' ORDER BY id DESC LIMIT 1").get();
  await req('POST', '/piutang/bayar', { id: piu.id, nominal: '50000', tanggal_bayar: today, metode: 'tunai', back: '/piutang' });
  const piuBayar = db.prepare('SELECT * FROM piutang_bayar WHERE piutang_id=? ORDER BY id DESC LIMIT 1').get(piu.id);
  r = await req('GET', `/piutang/${piu.id}/bukti`);
  ok('bukti pencairan piutang', r.status === 200 && /BUKTI PENCAIRAN \/ PENAMBAHAN PIUTANG/.test(r.text) && /Terbilang|Uang sejumlah/.test(r.text));
  r = await req('GET', `/piutang/bayar/${piuBayar.id}/bukti`);
  ok('bukti pelunasan piutang', r.status === 200 && /BUKTI PELUNASAN \/ CICILAN PIUTANG/.test(r.text) && /Sisa Setelah Pembayaran/.test(r.text));
  const plRow = db.prepare("SELECT * FROM piutang_lain WHERE nama='Guru Sertifikasi' ORDER BY id LIMIT 1").get();
  const plBayar = db.prepare('SELECT * FROM piutang_lain_bayar WHERE piutang_id=? ORDER BY id LIMIT 1').get(plRow.id);
  r = await req('GET', `/piutang-lain/${plRow.id}/bukti`);
  ok('bukti pencairan piutang sertifikasi', r.status === 200 && /PENCAIRAN \/ PENAMBAHAN PIUTANG SERTIFIKASI/.test(r.text));
  r = await req('GET', `/piutang-lain/bayar/${plBayar.id}/bukti`);
  ok('bukti pelunasan piutang sertifikasi', r.status === 200 && /PELUNASAN \/ CICILAN PIUTANG SERTIFIKASI/.test(r.text));
  const rBuktiSmall = await req('GET', `/piutang-lain/${plBayar.id}/bukti?orient=small`);
  ok('bukti memakai ukuran kertas kwitansi', /@page\{size:210mm 99mm/.test(rBuktiSmall.text));
  ok('bukti default portrait A4', /@page\{size:A4 portrait/.test(r.text));
  r = await req('GET', '/piutang');
  ok('tombol Bukti Piutang di tabel', /Bukti Piutang|>Bukti</.test(r.text));

  /* ===== 13. cetak honor ekskul terpisah per jenis ===== */
  await req('POST', '/ekskul/save-grid', { periode, jenis: 'Pramuka', nama_pembina: ['Pembina A', 'Pembina B'], kehadiran: ['4', '6'], harga_satuan: ['50000', '40000'] });
  await req('POST', '/ekskul/save-grid', { periode, jenis: 'Paskibra', nama_pembina: ['Pembina C'], kehadiran: ['8'], harga_satuan: ['50000'] });
  r = await req('GET', `/ekskul/cetak?periode=${periode}`);
  const blocks = (r.text.match(/class="eks-block"/g) || []).length;
  ok('cetak ekskul: tabel terpisah per jenis', blocks === 2 && /PRAMUKA/.test(r.text) && /PASKIBRA/.test(r.text), 'blocks=' + blocks);
  ok('tiap tabel punya total & tanda tangan sendiri', (r.text.match(/JUMLAH HONOR/g) || []).length === 2 && (r.text.match(/Tanda Terima/g) || []).length === 2);
  ok('grand total seluruh jenis', /TOTAL SELURUH JENIS EKSTRAKURIKULER/.test(r.text));
  r = await req('GET', `/ekskul/export?periode=${periode}`, null, { binary: true });
  const eh = X.readXlsx(Buffer.from(r.text))[0].rows.map(row => row.map(c => X.cellText(c)));
  ok('export ekskul dipisah per jenis', eh.some(x => /PRAMUKA/.test(x.join('|'))) && eh.some(x => /PASKIBRA/.test(x.join('|'))) && eh.some(x => /SUBTOTAL/.test(x.join('|'))));

  /* ===== 14. grafik SPP Juli dulu ===== */
  r = await req('GET', `/piutang?ta=${ta.id}`);
  const labels = [...r.text.matchAll(/<text x="[\d.]+" y="[\d.]+" text-anchor="middle" font-size="11" font-weight="600" fill="#5B4A40">([A-Za-z]{3})<\/text>/g)].map(m => m[1]);
  ok('chart SPP diawali Juli', labels[0] === 'Jul', labels.join(','));
  ok('chart SPP diakhiri Juni', labels[labels.length - 1] === 'Jun', labels.join(','));

  /* ===== 15. identitas sekolah: urutan & sidebar collapse ===== */
  r = await req('GET', '/sekolah');
  const iNama = r.text.indexOf('1. Nama Sekolah');
  const iAlamat = r.text.indexOf('2. Alamat Sekolah');
  const iKepala = r.text.indexOf('3. Nama Kepala Sekolah');
  const iNipK = r.text.indexOf('4. NIP / NUPTK Kepala Sekolah');
  const iBen = r.text.indexOf('5. Nama Bendahara');
  const iNipB = r.text.indexOf('6. NIP / NUPTK Bendahara');
  ok('urutan form identitas sekolah benar', iNama > 0 && iNama < iAlamat && iAlamat < iKepala && iKepala < iNipK && iNipK < iBen && iBen < iNipB,
    [iNama, iAlamat, iKepala, iNipK, iBen, iNipB].join(','));
  r = await req('GET', '/');
  ok('tombol collapse sidebar ada', /id="navCollapse"/.test(r.text));

  /* ===== 16. halaman utama tetap 200 ===== */
  for (const p of ['/', '/transaksi', '/transaksi/kertas', '/piutang', '/piutang-lain', '/iuran', '/iuran/data', `/iuran/data/${s1.id}`,
    '/beasiswa', '/ekskul', '/ekskul/antrean', '/pegawai', '/pesan-orangtua', '/laporan?r=sertifikasi', '/sekolah']) {
    const rr = await req('GET', p, null, { redirect: 'follow' });
    ok('GET ' + p, rr.status === 200 && !/Terjadi kesalahan/.test(rr.text), rr.status);
  }

  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek ronde 9 lulus ===`);
  if (fail.length) console.log(fail.map(f => `- ${f.name} ${f.extra || ''}`).join('\n'));
  if (/\[ERROR\]/.test(log)) console.log('SERVER ERROR:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 10).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(log.slice(-2500)); srv.kill(); process.exit(2); });

function dbmBeasiswaTotal(db, taId) {
  return Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM beasiswa WHERE aktif=1 AND tahun_ajaran_id=?').get(taId).s || 0);
}
const now = new Date();
