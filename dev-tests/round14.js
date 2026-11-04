'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test ronde 14 — perbaikan iuran & pembersihan data:
   1. Isolasi ketat data iuran per tahun pelajaran (daftar & detail siswa)
   2. Instant live search pada filter Data Iuran / Transaksi Iuran
   3. Modul "Sisa Tagihan Siswa Lulus" + kuncian writeoff DIHAPUS; tagihan TA lama bebas dibayar
   4. Penetapan Grup Iuran ke Kelas menampilkan siswa dari penempatan TA terpilih (TA lampau & TA baru)
   5. Pembersihan otomatis data hantu/phantom (piutang 2027, aset/grup TA terhapus, pembayaran nyasar)
   6. Ukuran kertas kwitansi transaksi = 210 × 99 mm (margin 4/6 mm)
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = 3697;
const DB = process.env.R14_DB || path.join(os.tmpdir(), 'smk-r14-' + Date.now() + '.sqlite');
const APP = path.join(__dirname, '..');
let srv = null, log = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let base = `http://127.0.0.1:${PORT}`;
let cookie = '';

function startServer(port) {
  base = `http://127.0.0.1:${port}`;
  log = '';
  srv = spawn(process.execPath, [path.join(APP, 'server.js')], {
    env: { ...process.env, PORT: port, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
}
async function waitReady() {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) return true; } catch (e) { } await sleep(120); }
  return false;
}
async function req(method, url, body) {
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
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !cookie) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const today = new Date().toISOString().slice(0, 10);

(async () => {
  startServer(PORT);
  ok('server siap', await waitReady());
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const db = new Database(DB);
  const taA = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  /* ================= 1. DUA TAHUN PELAJARAN ================= */
  r = await req('POST', '/tahun-ajaran/save', { nama: '2098/2099', tanggal_mulai: '2098-07-01', tanggal_selesai: '2099-06-30' });
  ok('tambah TA kedua', r.status === 303);
  const taB = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2098/2099'").get();
  ok('TA kedua tersimpan', !!taB);
  // kelas TA A saja (TA B sengaja tanpa kelas)
  await req('POST', '/kelas/save', { nama: 'X A', tingkat: 'X', tahun_ajaran_id: taA.id });
  const kA = db.prepare("SELECT * FROM kelas WHERE nama='X A'").get();
  await req('POST', '/siswa/save', { nisn: '810001', nama: 'Siswa TA A', jenis_kelamin: 'L', kelas_id: kA.id });
  const sA = db.prepare("SELECT * FROM siswa WHERE nisn='810001'").get();
  ok('siswa TA A punya penempatan', db.prepare('SELECT COUNT(*) c FROM siswa_penempatan WHERE siswa_id=?').get(sA.id).c === 1);

  /* grup iuran + tagihan di TA A, lalu pindahkan siswa ke kelas TA B (mutasi lintas TA) */
  await req('POST', '/iuran/save', { nama: 'SPP A', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  const gA = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP A'").get();
  r = await req('POST', `/iuran/grup/${gA.id}/tetapkan`, { kelas_id: kA.id, siswa_id: [sA.id] });
  ok('tetapkan grup TA A', r.status === 303);
  const tagA = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gA.id, sA.id);
  ok('tagihan TA A dibuat', !!tagA && String(tagA.tahun_ajaran_id) === String(taA.id));

  await req('POST', '/kelas/save', { nama: 'XI B', tingkat: 'XI', tahun_ajaran_id: taB.id });
  const kB = db.prepare("SELECT * FROM kelas WHERE nama='XI B'").get();
  r = await req('POST', '/mutasi-kelas/stage', { kelas_asal: kA.id, kelas_tujuan: kB.id, siswa_id: sA.id });
  await req('POST', '/mutasi-kelas/apply', {});
  ok('siswa dimutasi ke TA B', String(db.prepare('SELECT tahun_ajaran_id FROM siswa_penempatan WHERE siswa_id=? ORDER BY id DESC LIMIT 1').get(sA.id).tahun_ajaran_id) === String(taB.id));

  /* grup + tagihan di TA B */
  await req('POST', '/iuran/save', { nama: 'SPP B', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '200000', aktif: '1', tahun_ajaran_id: taB.id });
  const gB = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP B'").get();
  ok('grup TA B tersimpan di TA B', gB && String(gB.tahun_ajaran_id) === String(taB.id), JSON.stringify(gB && gB.tahun_ajaran_id));
  await req('POST', `/iuran/grup/${gB.id}/tetapkan`, { kelas_id: kB.id, siswa_id: [sA.id] });
  const tagB = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gB.id, sA.id);
  ok('tagihan TA B dibuat', !!tagB && String(tagB.tahun_ajaran_id) === String(taB.id));

  /* ================= 2. ISOLASI DATA PER TA ================= */
  const pageA = await req('GET', `/iuran/data?ta=${taA.id}`);
  const pageB = await req('GET', `/iuran/data?ta=${taB.id}`);
  ok('data iuran TA A memuat tagihan TA A', /Rp 1\.200\.000/.test(pageA.text), pageA.status);
  ok('data iuran TA B memuat tagihan TA B', /Rp 2\.400\.000/.test(pageB.text), pageB.status);
  ok('data iuran TA A TIDAK memuat nominal TA B', !/Rp 2\.400\.000/.test(pageA.text));
  ok('data iuran TA B TIDAK memuat nominal TA A', !/Rp 1\.200\.000/.test(pageB.text));

  const detA = await req('GET', `/iuran/data/${sA.id}?ta=${taA.id}`);
  const detB = await req('GET', `/iuran/data/${sA.id}?ta=${taB.id}`);
  ok('detail TA A menampilkan tagihan TA A saja', /Rp 1\.200\.000/.test(detA.text) && !/Rp 2\.400\.000/.test(detA.text), detA.status);
  ok('detail TA B menampilkan tagihan TA B saja', /Rp 2\.400\.000/.test(detB.text) && !/Rp 1\.200\.000/.test(detB.text));
  ok('detail menampilkan pemilih tahun pelajaran', /name="ta" data-autosubmit/.test(detA.text));

  /* ================= 3. LIVE SEARCH & MODUL LULUS ================= */
  ok('live search filter Data Iuran', pageA.text.includes('data-table-search="#tblDataIuran"'));
  const trxPage = await req('GET', `/iuran/transaksi?ta=${taA.id}`);
  ok('live search filter Transaksi Iuran', trxPage.text.includes('data-table-search="#tblTrxIuran"'));
  r = await req('GET', '/iuran/lulus');
  ok('halaman sisa tagihan siswa lulus dihapus', r.status === 404, r.status);
  const dash = await req('GET', '/');
  ok('menu sisa tagihan siswa lulus hilang', !/Sisa Tagihan Siswa Lulus/.test(dash.text));

  /* kuncian writeoff: sisipkan flag manual → pembayaran tetap boleh */
  db.prepare("UPDATE iuran_tagihan SET writeoff='tak_tertagih' WHERE id=?").run(tagA.id);
  const bayarLama = await req('POST', '/iuran/bayar', {
    tagihan_id: tagA.id, bulan: '7', tanggal: '2098-07-15', jumlah: '100000',
    potongan: '0', metode: 'tunai', nonbku: '1', back: `/iuran/data/${sA.id}?ta=${taA.id}`
  });
  ok('tagihan ber-flag lama tetap bisa dibayar', bayarLama.status === 303 && /kwitansi/.test(bayarLama.loc), bayarLama.loc);
  ok('pembayaran tersimpan', db.prepare('SELECT COUNT(*) c FROM iuran_bayar WHERE tagihan_id=?').get(tagA.id).c === 1);

  /* pembayaran pada BKU yang periodenya sudah lewat → tetap tersimpan (hanya peringatan) */
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? ORDER BY id LIMIT 1').get(taA.id);
  const bulanLalu = new Date(String(taA.tanggal_mulai).slice(0, 10) + 'T00:00:00');
  bulanLalu.setMonth(bulanLalu.getMonth() + 1);
  const tglLalu = `${bulanLalu.getFullYear()}-${String(bulanLalu.getMonth() + 1).padStart(2, '0')}-10`;
  const bulanLaluNo = bulanLalu.getMonth() + 1;
  const bayarBku = await req('POST', '/iuran/bayar', {
    tagihan_id: tagA.id, bulan: String(bulanLaluNo), tanggal: tglLalu, jumlah: '100000',
    potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${sA.id}?ta=${taA.id}`
  });
  ok('pembayaran di periode lama tidak diblokir', bayarBku.status === 303 && /kwitansi/.test(bayarBku.loc), bayarBku.loc + ' ' + decodeURIComponent(bayarBku.loc).slice(0, 160));
  // ronde 17: bulan lalu yang belum ditutup TIDAK lagi memblokir/memberi peringatan kunci
  ok('tanpa peringatan kunci periode (validasi tutup bulan dilonggarkan)', !/sudah berganti|Wajib lakukan proses Tutup BKU/.test(decodeURIComponent(bayarBku.loc)),
    decodeURIComponent(bayarBku.loc).slice(0, 160));

  /* ================= 4. PENETAPAN GRUP KE KELAS ================= */
  // TA A: siswa sudah pindah cache ke TA B, tapi penempatan TA A tetap ada
  const grA = await req('GET', `/iuran/grup/${gA.id}?kelas=${kA.id}`);
  ok('kelas TA lampau menampilkan siswa (penempatan historis)', /name="siswa_id"/.test(grA.text) && /Siswa TA A/.test(grA.text));
  ok('siswa sudah ditetapkan ditandai', /Sudah/.test(grA.text));

  // TA baru: kelas & penempatan ikut disalin
  r = await req('POST', '/tahun-ajaran/save', { nama: '2099/2100', tanggal_mulai: '2099-07-01', tanggal_selesai: '2100-06-30', salin_kelas: '1', salin_master: '1' });
  ok('tambah TA baru dengan salin kelas', r.status === 303, r.loc);
  const taC = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2099/2100'").get();
  const kelasC = db.prepare('SELECT * FROM kelas WHERE tahun_ajaran_id=? ORDER BY id').all(taC.id);
  ok('kelas TA baru tersalin (promosi)', kelasC.length >= 1 && kelasC.every(k => k.tingkat !== 'X' || kelasC.length === 0), JSON.stringify(kelasC.map(k => k.nama)));
  ok('penempatan siswa TA baru tersalin', db.prepare('SELECT COUNT(*) c FROM siswa_penempatan WHERE tahun_ajaran_id=?').get(taC.id).c >= 1);
  const gC = db.prepare('SELECT * FROM iuran_grup WHERE tahun_ajaran_id=? LIMIT 1').get(taC.id);
  const kelasC1 = db.prepare('SELECT * FROM kelas WHERE tahun_ajaran_id=? ORDER BY id LIMIT 1').get(taC.id);
  const grC = await req('GET', `/iuran/grup/${gC.id}?kelas=${kelasC1.id}`);
  ok('dropdown siswa TA baru tidak kosong', /name="siswa_id"/.test(grC.text) && /Siswa TA A/.test(grC.text), grC.status);

  /* ================= 5. UKURAN KERTAS KWITANSI ================= */
  const settings = Object.fromEntries(db.prepare('SELECT k,v FROM settings').all().map(x => [x.k, x.v]));
  ok('kwitansi 210 × 99 mm', settings.kw_trx_w_mm === '210' && settings.kw_trx_h_mm === '99', `${settings.kw_trx_w_mm}×${settings.kw_trx_h_mm}`);
  ok('margin kwitansi 4/6 mm', settings.kw_trx_mt_mm === '4' && settings.kw_trx_ml_mm === '6', `${settings.kw_trx_mt_mm}/${settings.kw_trx_ml_mm}`);

  /* ================= 6. PEMBERSIHAN DATA HANTU ================= */
  // sisipkan baris hantu: piutang 2027 milik TA yang sudah dihapus, aset/grup TA hilang, pembayaran nyasar
  db.prepare("INSERT INTO tahun_ajaran (id,nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (555,'HANTU/2027','2027-07-01','2028-06-30',0)").run();
  const colSel = db.prepare("SELECT id FROM tahun_ajaran WHERE id=555").get();
  ok('TA hantu disiapkan', !!colSel);
  db.prepare("DELETE FROM tahun_ajaran WHERE id=555").run();
  db.prepare(`INSERT INTO piutang_lain (nama,kategori,tanggal,nominal,status,tahun_ajaran_id,created_at) VALUES ('PHANTOM 2027','Sertifikasi','2027-07-01',500000,'belum',555,?)`).run(today);
  db.prepare(`INSERT INTO aset (nama,jenis,saldo,tahun_ajaran_id) VALUES ('Kas Hantu','bank',12345,555)`).run();
  db.prepare(`INSERT INTO beasiswa (nama,nominal,tahun_ajaran_id,aktif) VALUES ('Beasiswa Hantu',1000,555,1)`).run();
  db.prepare(`INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES ('Grup Hantu','nonbulanan',555,1,?)`).run(today);
  const ghostGrup = db.prepare("SELECT * FROM iuran_grup WHERE nama='Grup Hantu'").get();
  db.prepare('INSERT INTO iuran_nominal (grup_id,bulan,nominal) VALUES (?,NULL,5000)').run(ghostGrup.id);
  db.prepare('UPDATE iuran_bayar SET transaksi_id=999999 WHERE id=(SELECT MAX(id) FROM iuran_bayar)').run();
  ok('baris hantu disisipkan', db.prepare('SELECT COUNT(*) c FROM piutang_lain WHERE tahun_ajaran_id=555').get().c === 1);

  // restart server → bootstrap menjalankan pembersihan otomatis
  srv.kill();
  await sleep(400);
  startServer(PORT + 1);
  ok('server restart siap', await waitReady());
  cookie = '';
  r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login setelah pembersihan', r.status === 303);

  ok('piutang phantom 2027 dihapus permanen', db.prepare("SELECT COUNT(*) c FROM piutang_lain WHERE tahun_ajaran_id=555").get().c === 0);
  ok('aset TA terhapus dibersihkan', db.prepare("SELECT COUNT(*) c FROM aset WHERE nama='Kas Hantu'").get().c === 0);
  ok('beasiswa TA terhapus dibersihkan', db.prepare("SELECT COUNT(*) c FROM beasiswa WHERE nama='Beasiswa Hantu'").get().c === 0);
  ok('grup iuran hantu dibersihkan', db.prepare("SELECT COUNT(*) c FROM iuran_grup WHERE nama='Grup Hantu'").get().c === 0);
  ok('nominal grup hantu ikut dihapus', db.prepare('SELECT COUNT(*) c FROM iuran_nominal WHERE grup_id=?').get(ghostGrup.id).c === 0);
  ok('pembayaran nyasar dikembalikan ke antrean',
    db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE transaksi_id=999999").get().c === 0);
  ok('audit pembersihan tercatat', db.prepare("SELECT COUNT(*) c FROM audit WHERE aksi='BERSIHKAN DATA HANTU'").get().c >= 1);
  const snap = fs.readdirSync(path.dirname(DB)).filter(f => /^purge-orphan-.*\.json$/.test(f));
  ok('cadangan baris hantu dibuat', snap.length >= 1, JSON.stringify(snap));

  // data asli tidak ikut terhapus
  ok('data TA asli utuh', db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c >= 3);
  ok('tagihan asli utuh', db.prepare('SELECT COUNT(*) c FROM iuran_tagihan').get().c >= 2);

  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 14 lulus ===`);
  db.close(); srv.kill();
  if (pass !== results.length) { console.log('LOG SERVER:\n' + log.slice(-2000)); process.exit(1); }
})().catch(e => { console.error(e); if (srv) srv.kill(); process.exit(1); });
