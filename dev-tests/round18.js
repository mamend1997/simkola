'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 18 —
   1. Portal publik tagihan siswa: rincian per bulan (SPP - Juli … dst)
   2. Portal piutang pegawai & slip gaji: kolom catatan untuk bendahara
   3. Posting honor ekskul dipisah per JENIS ekstrakurikuler
   4. Ujung alamat (slug) ketiga portal publik dapat diubah
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const PORT = 3632;
const DB = process.env.R18_DB || path.join(os.tmpdir(), 'smk-r18-' + Date.now() + '.sqlite');
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

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  /* ================= data dasar ================= */
  await req('POST', '/program-keahlian/save', { nama: 'MM', program_studi: 'MM', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='MM'").get();
  await req('POST', '/kelas/save', { nama: 'XI MM 1', tingkat: 'XI', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='XI MM 1'").get();
  await req('POST', '/siswa/save', { nisn: '9001', nama: 'Abdul Kholik', jenis_kelamin: 'L', tanggal_lahir: '2009-03-12', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='9001'").get();
  await req('POST', '/iuran/save', { nama: 'SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: ta.id });
  await req('POST', '/iuran/save', { nama: 'PTS Ganjil', jenis: 'nonbulanan', nominal_tunggal: '40000', aktif: '1', tahun_ajaran_id: ta.id });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP'").get();
  const gPts = db.prepare("SELECT * FROM iuran_grup WHERE nama='PTS Ganjil'").get();
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  await req('POST', `/iuran/grup/${gPts.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tSpp = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(gSpp.id);
  const tPts = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(gPts.id);
  // bayar SPP Juli penuh + Agustus sebagian (non-BKU agar antrean tidak mengganggu)
  await req('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '2',
    key_0: `m:${tSpp.id}:7`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '150000', potongan_0: '0', bku_0: '', nonbku_0: '1',
    key_1: `m:${tSpp.id}:8`, tanggal_1: today, metode_1: 'tunai', jumlah_1: '50000', potongan_1: '0', bku_0: '', nonbku_1: '1'
  });
  await req('POST', '/iuran/bayar', { tagihan_id: tPts.id, tanggal: today, jumlah: '40000', potongan: '0', metode: 'tunai', nonbku: '1', back: `/iuran/data/${siswa.id}` });

  /* ================= 1. PORTAL TAGIHAN SISWA: RINCIAN BULANAN ================= */
  r = await req('GET', `/portal?nama=${encodeURIComponent('Abdul Kholik')}&lahir=2009-03-12`, null, { public: true });
  ok('portal siswa dapat diakses publik', r.status === 200 && /Abdul Kholik/.test(r.text));
  ok('grup bulanan dijabarkan per bulan (SPP - Juli …)', /SPP - Juli \d{4}/.test(r.text), (r.text.match(/SPP - [A-Za-z]+ \d{4}/g) || []).slice(0, 4).join(', '));
  ok('bulan Agustus tampil sebagai baris tersendiri', /SPP - Agustus \d{4}/.test(r.text));
  ok('12 baris bulan SPP tampil', (r.text.match(/class="month-line"/g) || []).length >= 12,
    String((r.text.match(/class="month-line"/g) || []).length));
  ok('grup non-bulanan tetap satu baris', /PTS Ganjil/.test(r.text));
  ok('status Lunas ditandai pada bulan yang sudah penuh', /SPP - Juli \d{4}<\/td>[\s\S]{0,200}?Lunas/.test(r.text));
  // nominal per bulan sesuai tagihan
  ok('nominal bulan SPP = Rp 150.000', (r.text.match(/SPP - Juli \d{4}/) ? /150\.000/.test(r.text) : false));
  // subtotal tidak dobel hitung
  const sumTagihan = db.prepare(`SELECT SUM(nominal) s FROM iuran_tagihan WHERE siswa_id=?`).get(siswa.id).s;
  ok('subtotal tahun = jumlah tagihan sebenarnya (tidak dobel)', r.text.includes(new Intl.NumberFormat('id-ID').format(sumTagihan)),
    String(sumTagihan));
  ok('form catatan orang tua tetap ada', /Kolom Catatan Orang Tua/.test(r.text));

  /* ================= 2a. CATATAN PADA PORTAL PIUTANG PEGAWAI ================= */
  db.prepare("INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)")
    .run('Rina Wulandari', 'Guru Akuntansi', 'guru', '081234567890', '1990-05-05');
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Rina Wulandari'").get();
  await req('POST', '/piutang/save', { nama_pegawai: 'Rina Wulandari', tanggal: today, nominal: '750000', keterangan: 'Kasbon' });
  r = await req('POST', '/portal-pegawai/otp', { nama: 'Rina Wulandari', lahir: '1990-05-05' }, { public: true });
  const kodeP = (/kode OTP Anda: <b[^>]*>(\d{4})<\/b>/.exec(r.text) || [])[1];
  const tokP = (r.text.match(/name="token" value="([^"]+)"/) || [])[1];
  ok('OTP portal piutang terkirim', !!kodeP && !!tokP);
  r = await req('POST', '/portal-pegawai/verifikasi', { token: tokP, kode: kodeP }, { public: true });
  ok('portal piutang menampilkan rincian', /Rincian Saldo Piutang|Piutang Pegawai \(Umum\)/.test(r.text));
  ok('portal piutang punya kolom catatan untuk bendahara', /Kolom Catatan untuk Bendahara/.test(r.text));
  ok('nama pengirim pada form catatan otomatis', /Rina Wulandari/.test(r.text) && /Nama Pegawai \(otomatis\)/.test(r.text));
  // kirim catatan (nama tidak dikirim — diambil dari OTP)
  r = await req('POST', '/portal-pegawai/pesan', { token: tokP, pesan: 'Cicilan piutang saya tanggal 12/08 sebesar Rp 500.000 belum tercatat.', terkait: 'piutang' }, { public: true });
  const catP = db.prepare("SELECT * FROM portal_pesan WHERE sumber='piutang-pegawai' ORDER BY id DESC LIMIT 1").get();
  ok('catatan portal piutang tersimpan', !!catP && r.status === 200, String(r.status));
  ok('sumber = piutang-pegawai & ref = id pegawai', catP.sumber === 'piutang-pegawai' && String(catP.ref) === String(pg.id), JSON.stringify({ s: catP.sumber, r: catP.ref }));
  ok('nama pengirim otomatis (bukan dari form)', catP.nama === 'Rina Wulandari', catP.nama);
  ok('konfirmasi terkirim tampil di halaman', /sudah dikirim ke bendahara/.test(r.text));
  // tanpa token valid → tidak boleh menyimpan
  const before = db.prepare("SELECT COUNT(*) c FROM portal_pesan WHERE sumber='piutang-pegawai'").get().c;
  r = await req('POST', '/portal-pegawai/pesan', { token: 'palsu', pesan: 'Pesan palsu tanpa verifikasi OTP' }, { public: true });
  ok('catatan ditolak tanpa sesi OTP terverifikasi', db.prepare("SELECT COUNT(*) c FROM portal_pesan WHERE sumber='piutang-pegawai'").get().c === before);

  /* ================= 2b. CATATAN PADA PORTAL SLIP GAJI ================= */
  db.prepare(`INSERT INTO payroll (periode,nama,jabatan,tipe,jam_efektif,jam_telat,honor_jam,pegawai_id,created_at,pot_bpjs_kes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`${ta.tanggal_mulai.slice(0, 7)}`, 'Rina Wulandari', 'Guru Akuntansi', 'guru', 24, 0, 25000, pg.id, today, 120000);
  const periodeSlip = ta.tanggal_mulai.slice(0, 7);
  r = await req('POST', '/portal-slip/otp', { nama: 'Rina Wulandari', lahir: '1990-05-05' }, { public: true });
  const kodeS = (/kode OTP Anda: <b[^>]*>(\d{4})<\/b>/.exec(r.text) || [])[1];
  const tokS = (r.text.match(/name="token" value="([^"]+)"/) || [])[1];
  r = await req('POST', '/portal-slip/verifikasi', { token: tokS, kode: kodeS }, { public: true });
  ok('portal slip menampilkan rincian', /Rincian Slip Gaji/.test(r.text));
  ok('portal slip punya kolom catatan untuk bendahara', /Kolom Catatan untuk Bendahara/.test(r.text));
  r = await req('POST', '/portal-slip/pesan', { token: tokS, periode: periodeSlip, pesan: 'Potongan BPJS pada slip ini tertulis Rp 120.000, seharusnya Rp 90.000.', terkait: 'payroll' }, { public: true });
  const catS = db.prepare("SELECT * FROM portal_pesan WHERE sumber='slip-pegawai' ORDER BY id DESC LIMIT 1").get();
  ok('catatan portal slip tersimpan', !!catS && /token=/.test(r.loc) && /ok=/.test(r.loc), decode(r.loc).slice(0, 120));
  ok('sumber = slip-pegawai', catS && catS.sumber === 'slip-pegawai');
  r = await req('GET', decode(r.loc).replace(base, ''), null, { public: true });
  ok('pesan konfirmasi tampil setelah redirect', /sudah dikirim ke bendahara/.test(r.text));

  /* ================= 2c. catatan pegawai masuk ke inbox bendahara ================= */
  // tambahan: catatan orang tua dari portal tagihan siswa (sumber 'siswa')
  await req('POST', '/portal/pesan', { siswa_id: String(siswa.id), pesan: 'Pembayaran SPP Agustus sudah kami bayar, mohon diperiksa.', kontak: '0812000000' }, { public: true });
  ok('catatan orang tua (siswa) tersimpan', db.prepare("SELECT COUNT(*) c FROM portal_pesan WHERE COALESCE(sumber,'siswa')='siswa'").get().c === 1);
  r = await req('GET', '/pesan-orangtua');
  ok('halaman pesan menampilkan sumber ketiga portal', /Piutang Pegawai/.test(r.text) && /Slip Pegawai/.test(r.text) && /Tagihan Siswa/.test(r.text));
  ok('isi catatan slip tampil di inbox bendahara', /Potongan BPJS pada slip ini tertulis/.test(r.text));
  r = await req('GET', '/');
  ok('dashboard menampilkan catatan portal', /id="pesanOrangTua"/.test(r.text) && /Piutang Pegawai/.test(r.text));

  /* ================= 3. POSTING EKSKUL DIPISAH PER JENIS ================= */
  const periode = `${ta.tanggal_mulai.slice(0, 4)}-07`;
  await req('POST', '/ekskul/save', { jenis: 'Pramuka', nama_pembina: 'Pembina Pramuka', periode, kehadiran: '10', harga_satuan: '50000' });
  await req('POST', '/ekskul/save', { jenis: 'Paskibra', nama_pembina: 'Pembina Paskibra', periode, kehadiran: '4', harga_satuan: '50000' });
  await req('POST', '/ekskul/save', { jenis: 'Pramuka', nama_pembina: 'Pembina Pramuka 2', periode, kehadiran: '6', harga_satuan: '50000' });
  r = await req('GET', '/ekskul/antrean');
  ok('antrean ekskul memisahkan per jenis (2 kelompok)', (r.text.match(/diposting sebagai 1 transaksi BKU/g) || []).length === 2,
    String((r.text.match(/diposting sebagai 1 transaksi BKU/g) || []).length));
  ok('judul kelompok memuat nama jenis', /Pramuka — Periode/.test(r.text) && /Paskibra — Periode/.test(r.text));
  ok('form posting mengirim field jenis', /name="jenis" value="Pramuka"/.test(r.text) && /name="jenis" value="Paskibra"/.test(r.text));
  // posting hanya Pramuka
  r = await req('POST', '/ekskul/antrean/posting', { periode, jenis: 'Pramuka', bku_id: bku.id });
  const trxPramuka = db.prepare("SELECT * FROM transaksi WHERE uraian LIKE '%Pramuka%' AND uraian LIKE 'Honor Pembina%'").get();
  ok('posting Pramuka membuat 1 transaksi', r.status === 303 && !!trxPramuka, decode(r.loc).slice(0, 140));
  ok('nominal transaksi Pramuka = 800.000 (10+6 jam)', Number(trxPramuka.nominal) === 800000, String(trxPramuka && trxPramuka.nominal));
  ok('uraian transaksi memuat jenis', /Pramuka/.test(trxPramuka.uraian), trxPramuka.uraian);
  ok('Paskibra tetap menunggu posting', db.prepare("SELECT COUNT(*) c FROM ekskul_honor WHERE jenis='Paskibra' AND status='pending'").get().c === 1);
  ok('belum ada transaksi Paskibra', !db.prepare("SELECT id FROM transaksi WHERE uraian LIKE '%Paskibra%'").get());
  // posting Paskibra → transaksi kedua, terpisah
  r = await req('POST', '/ekskul/antrean/posting', { periode, jenis: 'Paskibra', bku_id: bku.id });
  const trxPas = db.prepare("SELECT * FROM transaksi WHERE uraian LIKE '%Paskibra%'").get();
  ok('posting Paskibra membuat transaksi kedua', r.status === 303 && !!trxPas);
  ok('dua transaksi BKU berbeda (tidak digabung)', trxPramuka.id !== trxPas.id && Number(trxPas.nominal) === 200000,
    JSON.stringify({ a: trxPramuka.nominal, b: trxPas && trxPas.nominal }));
  ok('total pengeluaran BKU = 1.000.000', Number(db.prepare(`SELECT COALESCE(SUM(nominal),0) s FROM transaksi WHERE bku_id=? AND status='posted' AND jenis='pengeluaran'`).get(bku.id).s) === 1000000);
  r = await req('GET', '/ekskul/antrean');
  ok('antrean ekskul kosong setelah semua jenis diposting', /Antrean posting kosong/.test(r.text));
  // edit jenis item terposting ditolak
  const pramukaRow = db.prepare("SELECT * FROM ekskul_honor WHERE nama_pembina='Pembina Pramuka'").get();
  r = await req('POST', '/ekskul/save', { id: pramukaRow.id, jenis: 'Paskibra', nama_pembina: pramukaRow.nama_pembina, periode, kehadiran: '10', harga_satuan: '50000' });
  ok('ubah jenis item terposting ditolak', r.status === 303 && /err=/.test(r.loc) && /satu transaksi BKU = satu jenis/.test(decode(r.loc)), decode(r.loc).slice(0, 140));

  /* ================= 4. SLUG PORTAL DAPAT DIUBAH ================= */
  // pengaturan alamat portal pindah ke menu Portal Publik (ronde 26)
  r = await req('GET', '/portal-publik');
  ok('halaman Portal Publik memuat pengaturan alamat portal', /Alamat \(URL\) Portal Publik/.test(r.text) && /name="portal_slip_slug"/.test(r.text));
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'tagihan-siswa', portal_pegawai_slug: 'piutang-pegawai', portal_slip_slug: 'portal-slip-pegawai' });
  ok('slug portal tersimpan', r.status === 303 && /ok=/.test(r.loc), decode(r.loc).slice(0, 120));
  ok('setting tersimpan di DB', db.prepare("SELECT v FROM settings WHERE k='portal_slip_slug'").get().v === 'portal-slip-pegawai');
  for (const [u, label] of [['/tagihan-siswa', 'siswa'], ['/piutang-pegawai', 'pegawai'], ['/portal-slip-pegawai', 'slip']]) {
    r = await req('GET', u, null, { public: true });
    ok(`alamat kustom ${u} dapat dibuka`, r.status === 200 && /portal-head/.test(r.text), String(r.status));
  }
  r = await req('GET', '/tagihan-siswa/siswa?q=Abd', null, { public: true });
  ok('endpoint autocomplete mengikuti slug baru', r.status === 200 && /Abdul/.test(r.text));
  r = await req('GET', '/portal-slip-pegawai', null, { public: true });
  ok('form portal slip memakai slug baru', /action="\/portal-slip-pegawai\/otp"/.test(r.text), (r.text.match(/action="[^"]*\/otp"/) || [])[0]);
  r = await req('GET', '/piutang-pegawai', null, { public: true });
  ok('tautan antar portal memakai slug baru', /href="\/portal-slip-pegawai"/.test(r.text));
  // alamat default tetap berfungsi (kompatibilitas)
  ok('alamat default /portal tetap dapat dibuka', (await req('GET', '/portal', null, { public: true })).status === 200);
  // validasi
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'transaksi', portal_pegawai_slug: 'piutang-pegawai', portal_slip_slug: 'portal-slip-pegawai' });
  ok('slug yang menabrak halaman aplikasi ditolak', r.status === 303 && /err=/.test(r.loc) && /dipakai halaman lain/.test(decode(r.loc)), decode(r.loc).slice(0, 140));
  ok('slug ditolak tidak mengubah setting', db.prepare("SELECT v FROM settings WHERE k='portal_slug'").get().v === 'tagihan-siswa');
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'tagihan-siswa', portal_pegawai_slug: 'tagihan-siswa', portal_slip_slug: 'portal-slip-pegawai' });
  ok('slug ganda antar portal ditolak', r.status === 303 && /err=/.test(r.loc), decode(r.loc).slice(0, 140));
  r = await req('POST', '/sekolah/portal-slug', { portal_slug: 'Portal Tagihan Siswa!', portal_pegawai_slug: 'piutang-pegawai', portal_slip_slug: 'portal-slip-pegawai' });
  ok('slug dengan spasi/simbol dinormalkan atau ditolak', r.status === 303 && (db.prepare("SELECT v FROM settings WHERE k='portal_slug'").get().v === 'tagihan-siswa' || /err=/.test(r.loc)));
  // kembalikan default + cek kolom catatan
  await req('POST', '/sekolah/portal-slug', { portal_slug: 'portal', portal_pegawai_slug: 'portal-pegawai', portal_slip_slug: 'portal-slip' });
  r = await req('GET', '/portal-pegawai', null, { public: true });
  ok('kembali ke alamat default berhasil', /action="\/portal-pegawai\/otp"/.test(r.text));

  srv.kill();
  db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 18 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1500)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
