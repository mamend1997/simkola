'use strict';
/* Ronde 21 —
   1. Grafik SPP tunggal & tersinkron data iuran + rekap per grup terisi semua grup
   2. Hapus masal antrean posting & rekap transaksi iuran
   3. Beasiswa multi-grup/multi-siswa, edit tanpa error, urutan & state form
   4. Tema warna, branding, manajer menu (urutan/judul/ikon), restrukturisasi menu
   5. Relokasi tarif honor & hapus field GANDA/checkbox portal lama
   6. Catatan Pegawai (rekap) vs Catatan Orang Tua (hapus per baris) + Petunjuk Pengguna
   7. Akun demo: database dummy terisolasi, akses per role, password hanya admin
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = process.env.R21_PORT || 3691;
const DB = process.env.R21_DB || path.join(os.tmpdir(), 'smk-r21-' + Date.now() + '.sqlite');
const DEMO_DB = process.env.R21_DEMO_DB || path.join(os.tmpdir(), 'smk-r21-demo-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, DEMO_DB_PATH: DEMO_DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  const jar = opt.cookie !== undefined ? opt.cookie : (opt.public ? '' : global.__cookie || '');
  if (jar) headers.Cookie = jar;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) global.__cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '', setCookie: sc || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const textOf = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303, r.status);

  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  /* ---------- siapkan kelas & siswa ---------- */
  await req('POST', '/kelas/save', { nama: 'X RPL 1', tingkat: 'X' });
  await req('POST', '/siswa/save', { nama: 'Ahmad Siswa', nisn: '1111', jenis_kelamin: 'L', status: 'aktif', kelas_id: db.prepare("SELECT id FROM kelas WHERE nama='X RPL 1'").get()?.id || '' });
  await req('POST', '/siswa/save', { nama: 'Budi Siswa', nisn: '2222', jenis_kelamin: 'L', status: 'aktif', kelas_id: db.prepare("SELECT id FROM kelas WHERE nama='X RPL 1'").get()?.id || '' });
  let siswa = db.prepare('SELECT * FROM siswa ORDER BY id').all();
  ok('2 siswa dibuat', siswa.length === 2, siswa.length);
  if (siswa.length < 2) { siswa = [{ id: 1, nama: 'A' }, { id: 2, nama: 'B' }]; }
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X RPL 1'").get() || db.prepare('SELECT * FROM kelas LIMIT 1').get();

  /* ---------- grup iuran: SPP (bulanan) + Praktik (non-bulanan) ---------- */
  await req('POST', '/iuran/save', { nama: 'SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  await req('POST', '/iuran/save', { nama: 'Praktik Kejuruan', jenis: 'nonbulanan', nominal_tunggal: '300000', aktif: '1' });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP' ORDER BY id DESC").get();
  const gPrak = db.prepare("SELECT * FROM iuran_grup WHERE nama='Praktik Kejuruan' ORDER BY id DESC").get();
  ok('grup SPP & Praktik dibuat', !!gSpp && !!gPrak);
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: siswa.map(s => s.id) });
  await req('POST', `/iuran/grup/${gPrak.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: siswa.map(s => s.id) });
  const tagSpp = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSpp.id, siswa[0].id);
  const tagPrak = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gPrak.id, siswa[0].id);
  ok('tagihan SPP & Praktik ada', !!tagSpp && !!tagPrak);

  /* ================= 1. GRAFIK SPP & REKAP PER GRUP ================= */
  await req('POST', '/iuran/bayar', { tagihan_id: tagSpp.id, bulan: '7', tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${siswa[0].id}` });
  await req('POST', '/iuran/bayar', { tagihan_id: tagPrak.id, tanggal: today, jumlah: '150000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${siswa[0].id}` });
  r = await req('GET', '/');
  ok('dashboard 200', r.status === 200);
  const jumlahGrafik = (r.text.match(/aria-label="Tren penerimaan SPP per bulan"/g) || []).length;
  ok('hanya SATU line chart SPP di dashboard', jumlahGrafik === 1, jumlahGrafik);
  ok('kartu duplikat SPP dihapus', (r.text.match(/Tren Penerimaan SPP per Bulan/g) || []).length === 1,
    (r.text.match(/Tren Penerimaan SPP per Bulan/g) || []).length);
  ok('grafik memakai angka riil iuran', /Rp 100\.000/.test(textOf(r.text)), '');
  const tbl = (/id="tblGrupIuran"[\s\S]*?<\/table>/.exec(r.text) || [''])[0];
  ok('tabel rekap memuat grup SPP', /SPP/.test(tbl));
  ok('tabel rekap memuat grup Praktik Kejuruan', /Praktik Kejuruan/.test(tbl));
  const rowPrak = (/<tr data-grup-row>[\s\S]*?Praktik Kejuruan[\s\S]*?<\/tr>/.exec(tbl) || [''])[0];
  ok('baris grup non-SPP TIDAK kosong (ada nominal)', /Rp\s?150\.000/.test(rowPrak), rowPrak.slice(0, 400));
  const footer = (/<tfoot>[\s\S]*?<\/tfoot>/.exec(tbl) || [''])[0];
  ok('footer grand total memuat total kedua grup', /Rp\s?250\.000/.test(footer), footer.slice(0, 300));

  /* ================= 2. HAPUS MASAL ANTREAN & REKAP ================= */
  const beforeAntrean = db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c;
  ok('ada penerimaan pending di antrean', beforeAntrean >= 1, beforeAntrean);
  r = await req('GET', '/iuran/antrean');
  ok('antrean punya ceklis & tombol hapus', /fHapusAntrean/.test(r.text) && /Hapus Terpilih/.test(r.text) && /data-check-all="ids"/.test(r.text));
  const pendingIds = db.prepare("SELECT id FROM iuran_bayar WHERE status='pending' ORDER BY id DESC").all().map(x => x.id);
  r = await req('POST', '/iuran/bayar/hapus-masal', { ids: [pendingIds[0]], back: '/iuran/antrean' });
  ok('hapus masal antrean redirect', r.status === 303);
  ok('pembayaran hilang dari riwayat siswa', !db.prepare('SELECT id FROM iuran_bayar WHERE id=?').get(pendingIds[0]));

  // posting ke BKU dulu → pembayaran menjadi posted dengan transaksi BKU
  const masihPending = db.prepare("SELECT * FROM iuran_bayar WHERE status='pending'").all();
  ok('masih ada pembayaran pending untuk diposting', masihPending.length >= 1, masihPending.length);
  const coaIn = db.prepare("SELECT * FROM coa WHERE kode='4.1.01'").get();
  r = await req('POST', '/iuran/antrean/posting', {
    ids: masihPending.map(b => b.id).join(','), bku_id: bku.id, coa_id: coaIn.id
  });
  ok('posting antrean iuran ke BKU', r.status === 303, r.status);
  const posted = db.prepare("SELECT b.*, t.id tagihan FROM iuran_bayar b JOIN iuran_tagihan t ON t.id=b.tagihan_id WHERE b.status='posted' ORDER BY b.id DESC LIMIT 1").get();
  ok('ada pembayaran posted', !!posted);
  r = await req('GET', '/iuran/transaksi');
  ok('rekap transaksi punya tombol hapus massal', /bayar\/hapus-masal/.test(r.text) && /Hapus Terpilih/.test(r.text));
  const trxCountBefore = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/iuran/bayar/hapus-masal', { ids: [posted.id], back: '/iuran/transaksi' });
  ok('hapus masal rekap redirect', r.status === 303, r.status);
  ok('pembayaran posted terhapus dari riwayat siswa', !db.prepare('SELECT id FROM iuran_bayar WHERE id=?').get(posted.id));
  ok('transaksi BKU terkait ikut terhapus', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === trxCountBefore - 1);

  /* ================= 3. BEASISWA MULTI-GRUP & MULTI-SISWA ================= */
  r = await req('POST', '/beasiswa/save', {
    nama: 'Beasiswa Multi', deskripsi: 'Uji multi grup', tahun_ajaran_id: ta.id,
    grup_id: [gSpp.id, gPrak.id], bulan: ['7', '8'],
    nominal_potongan: '50000', persen: '', aktif: '1',
    penerima: siswa.map(s => s.id), back: `/beasiswa?ta=${ta.id}`
  });
  ok('simpan beasiswa multi redirect', r.status === 303);
  const bea = db.prepare("SELECT * FROM beasiswa WHERE nama='Beasiswa Multi'").get();
  ok('beasiswa tersimpan', !!bea);
  const bg = db.prepare('SELECT * FROM beasiswa_grup WHERE beasiswa_id=?').all(bea.id);
  ok('beasiswa punya 2 grup iuran', bg.length === 2, bg.length);
  const bs = db.prepare('SELECT * FROM beasiswa_siswa WHERE beasiswa_id=?').all(bea.id);
  ok('beasiswa punya 2 siswa penerima', bs.length === 2, bs.length);
  ok('total nilai beasiswa = potongan × penerima', Number(bea.nominal) === 100000, bea.nominal);
  const autoBayar = db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE sumber='beasiswa' AND beasiswa_id=?").get(bea.id).c;
  ok('pembayaran iuran otomatis dibuat dari beasiswa', autoBayar > 0, autoBayar);

  // edit: form tidak boleh punya id ganda (penyebab "please fill out this field")
  r = await req('GET', `/beasiswa?ta=${ta.id}&edit=${bea.id}`);
  ok('halaman edit beasiswa 200', r.status === 200);
  ok('hanya SATU form id fBeasiswa', (r.text.match(/id="fBeasiswa"/g) || []).length === 1,
    (r.text.match(/id="fBeasiswa"/g) || []).length);
  ok('edit: nama & grup terisi', /Beasiswa Multi/.test(r.text) && /data-bea-group=/.test(r.text));
  ok('urutan form: Detail → Siswa → Rekap', r.text.indexOf('data-bea-step="1"') < r.text.indexOf('data-bea-step="2"') &&
    r.text.indexOf('data-bea-step="2"') < r.text.indexOf('data-bea-step="3"'));
  ok('filter kelas BUKAN form GET (tidak reload)', /<select data-bea-kelas>/.test(r.text) && !/name="kelas"[^>]*data-autosubmit/.test(r.text));
  const beaRow = db.prepare('SELECT * FROM beasiswa WHERE id=?').get(bea.id);
  r = await req('POST', '/beasiswa/save', {
    id: bea.id, nama: 'Beasiswa Multi Edit', deskripsi: beaRow.deskripsi, tahun_ajaran_id: ta.id,
    grup_id: [gPrak.id], bulan: ['7'], nominal_potongan: '25000', aktif: '1',
    penerima: [siswa[0].id], back: `/beasiswa?ta=${ta.id}`
  });
  ok('edit beasiswa tanpa error required', r.status === 303, r.status);
  ok('nama beasiswa berubah', db.prepare('SELECT nama FROM beasiswa WHERE id=?').get(bea.id).nama === 'Beasiswa Multi Edit');
  ok('grup beasiswa ikut berubah jadi 1', db.prepare('SELECT COUNT(*) c FROM beasiswa_grup WHERE beasiswa_id=?').get(bea.id).c === 1);

  /* ================= 4. TEMA, BRANDING, MENU ================= */
  r = await req('POST', '/tema', { tema_warna: '#0F766E', app_nama: 'SIMKEU Uji' });
  ok('simpan tema redirect', r.status === 303);
  ok('setting tema tersimpan', db.prepare("SELECT v FROM settings WHERE k='tema_warna'").get().v === '#0F766E');
  ok('nama aplikasi tersimpan', db.prepare("SELECT v FROM settings WHERE k='app_nama'").get().v === 'SIMKEU Uji');
  r = await req('GET', '/');
  ok('CSS tema kustom disuntik', /--o-500:hsl\(175/.test(r.text), (r.text.match(/--o-500:[^;]+/) || [''])[0]);
  ok('nama aplikasi tampil', /SIMKEU Uji/.test(r.text));
  // menu: geser SPP ke paling atas grup iuran, ubah judul
  r = await req('GET', '/tampilan-menu');
  const idxSpp = /name="h_(\d+)" value="\/spp"/.exec(r.text);
  ok('manajer menu memuat baris /spp', !!idxSpp);
  const iSpp = idxSpp ? idxSpp[1] : '0';
  const hrefs = [...r.text.matchAll(/name="h_(\d+)" value="([^"]+)"/g)].map(m => m[2]);
  const order = hrefs.filter(h => h !== '/spp');
  order.unshift('/spp');
  const labels = {};
  labels[`lbl_${iSpp}`] = 'SPP Baru';
  const groups = [...r.text.matchAll(/data-groupid="([^"]+)"/g)].map(m => m[1]);
  groups.sort(() => 0); // urutan tetap
  r = await req('POST', '/tampilan-menu', {
    show: hrefs, nav_order: order.join(','), group_order: groups.join(','), ...labels
  });
  ok('simpan tampilan menu redirect', r.status === 303);
  r = await req('GET', '/');
  ok('judul menu kustom dipakai', /SPP Baru/.test(r.text));
  const sidebar = (/<nav class="nav">[\s\S]*?<\/nav>/.exec(r.text) || [''])[0];
  const pIuran = sidebar.indexOf('data-navgroup="iuran"');
  const pNext = sidebar.indexOf('data-navgroup="komunikasi"');
  const grupIuran = pIuran >= 0 ? sidebar.slice(pIuran, pNext > pIuran ? pNext : undefined) : '';
  ok('menu SPP berada di kelompok Grup Iuran', /SPP Baru/.test(grupIuran) && /Grup Iuran/.test(grupIuran), grupIuran.slice(0, 200));
  const pSpp = sidebar.indexOf('data-nav-href="/spp"');
  const pIuranData = sidebar.indexOf('data-nav-href="/iuran/data"');
  ok('posisi SPP mengikuti hasil drag & drop menu', pSpp >= 0 && pSpp < pIuranData, `spp=${pSpp} data=${pIuranData}`);
  ok('menu Piutang dipisah dari SPP', /data-navgroup="piutang"/.test(sidebar) && !/Piutang &amp; SPP/.test(sidebar));

  /* ================= 5. IDENTITAS SEKOLAH & TARIF HONOR ================= */
  r = await req('GET', '/sekolah');
  ok('Identitas Sekolah tanpa field honor ganda', !/name="honor_tugas_jam"/.test(r.text) && !/name="sertifikasi_per_jam"/.test(r.text));
  ok('Identitas Sekolah tanpa checkbox portal_aktif', !/name="portal_aktif"/.test(r.text));
  r = await req('GET', '/tarif-honor');
  ok('Nominal Tunjangan & Honor memuat tarif tugas tambahan & sertifikasi',
    /name="honor_tugas_jam"/.test(r.text) && /name="sertifikasi_per_jam"/.test(r.text));
  r = await req('POST', '/tarif-honor', { honor_tugas_jam: '55000', sertifikasi_per_jam: '13000', honor_pembantu_jam: '60000', honor_wali_jam: '60000' });
  ok('simpan tarif honor', r.status === 303 && db.prepare("SELECT v FROM settings WHERE k='honor_tugas_jam'").get().v === '55000');

  /* ================= 6. CATATAN & PETUNJUK ================= */
  db.prepare("INSERT INTO portal_pesan (siswa_id,nama,kontak,pesan,status,sumber,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(siswa[0].id, 'Orang Tua Ahmad', '0812', 'Mohon cek tagihan SPP Juli', 'baru', 'siswa', new Date().toISOString().slice(0, 19).replace('T', ' '));
  r = await req('GET', '/catatan-orangtua');
  ok('halaman Catatan Orang Tua 200', r.status === 200);
  ok('catatan orang tua tampil', /Mohon cek tagihan SPP Juli/.test(r.text));
  ok('tombol hapus per baris tersedia', /catatan-orangtua\/delete/.test(r.text));
  const pesanId = db.prepare("SELECT id FROM portal_pesan WHERE pesan LIKE 'Mohon cek%'").get().id;
  r = await req('POST', '/catatan-orangtua/delete', { id: pesanId, back: '/catatan-orangtua' });
  ok('hapus catatan orang tua', r.status === 303 && !db.prepare('SELECT id FROM portal_pesan WHERE id=?').get(pesanId));
  r = await req('GET', '/catatan-pegawai');
  ok('Catatan Pegawai = rekap (tanpa form kirim untuk bendahara)', !/Kirim Catatan ke Bendahara/.test(r.text) && /Rekap Catatan Pegawai/.test(r.text));
  ok('alamat lama /pesan-orangtua tetap berfungsi', (await req('GET', '/pesan-orangtua')).status === 200);

  r = await req('POST', '/petunjuk/save', {
    judul: 'Cara Mencatat Pembayaran Iuran', kategori: 'Iuran & SPP',
    ringkas: 'Buka Data Iuran lalu klik Bayar.', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    pdf_url: '', urutan: '1', aktif: '1'
  });
  ok('simpan petunjuk redirect', r.status === 303);
  const pdk = db.prepare("SELECT * FROM panduan WHERE judul LIKE 'Cara Mencatat%'").get();
  ok('petunjuk tersimpan', !!pdk);
  r = await req('GET', '/petunjuk');
  ok('kartu petunjuk tampil + embed YouTube', /Cara Mencatat Pembayaran Iuran/.test(r.text) && /youtube\.com\/embed\/dQw4w9WgXcQ/.test(r.text));
  r = await req('POST', '/petunjuk/delete', { id: pdk.id });
  ok('hapus petunjuk', r.status === 303 && !db.prepare('SELECT id FROM panduan WHERE id=?').get(pdk.id));

  /* ================= 7. AKUN DEMO ================= */
  // buat akun demo lewat form pengguna
  r = await req('POST', '/pengguna/save', {
    nama: 'Akun Demo Sekolah', email: 'demo@sekolah.sch.id', role: 'demo', jabatan: 'Demo', password: 'demo123', aktif: '1'
  });
  ok('akun demo dibuat', r.status === 303 && !!db.prepare("SELECT * FROM users WHERE email='demo@sekolah.sch.id'").get());
  const demoId = db.prepare("SELECT id FROM users WHERE email='demo@sekolah.sch.id'").get().id;
  ok('permission default demo memblokir pengguna', db.prepare("SELECT allowed FROM permissions WHERE role='demo' AND module='pengguna' AND action='view'").get()?.allowed === 0);
  ok('permission default demo mengizinkan iuran', db.prepare("SELECT allowed FROM permissions WHERE role='demo' AND module='iuran' AND action='view'").get()?.allowed === 1);

  let demoCookie = '';
  r = await req('POST', '/login', { email: 'demo@sekolah.sch.id', password: 'demo123' }, { cookie: '' });
  ok('login akun demo', r.status === 303, r.status);
  demoCookie = (r.setCookie || '').split(';')[0];
  const mainTrx = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  const mainBayar = db.prepare('SELECT COUNT(*) c FROM iuran_bayar').get().c;
  r = await req('GET', '/transaksi', null, { cookie: demoCookie });
  ok('demo bisa membuka transaksi', r.status === 200);
  r = await req('GET', '/pengguna', null, { cookie: demoCookie });
  ok('demo DILARANG membuka pengguna (403)', r.status === 403, r.status);
  // buat transaksi di sesi demo
  r = await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pemasukan', metode: 'tunai', nominal: '777000', uraian: 'Uji Isolasi Demo', nama_pihak: 'DEMO'
  }, { cookie: demoCookie });
  ok('demo mencatat transaksi', r.status === 303, r.status);
  await sleep(300);
  ok('data sekolah TIDAK terpengaruh transaksi demo', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c === mainTrx);
  ok('iuran sekolah tidak berubah', db.prepare('SELECT COUNT(*) c FROM iuran_bayar').get().c === mainBayar);
  ok('database demo terpisah dibuat', fs.existsSync(DEMO_DB));
  const ddb = new Database(DEMO_DB, { readonly: true });
  ok('transaksi demo tercatat di database dummy', ddb.prepare("SELECT COUNT(*) c FROM transaksi WHERE uraian='Uji Isolasi Demo'").get().c === 1);
  ddb.close();
  // password demo tidak boleh diubah sendiri
  r = await req('POST', '/akun', { nama: 'Akun Demo Sekolah', email: 'demo@sekolah.sch.id', password: 'baru123', password2: 'baru123' }, { cookie: demoCookie });
  ok('demo ditolak mengubah password sendiri', r.status === 303 && /err=/.test(r.loc), r.loc);
  ok('password demo tidak berubah', (() => {
    const lib = require('../lib');
    return lib.verifyPassword('demo123', db.prepare('SELECT password FROM users WHERE id=?').get(demoId).password);
  })());
  // admin tetap bisa mengatur password demo
  r = await req('POST', '/pengguna/save', { id: demoId, nama: 'Akun Demo Sekolah', email: 'demo@sekolah.sch.id', role: 'demo', jabatan: 'Demo', password: 'demo456', aktif: '1' });
  ok('admin dapat mengubah password demo', r.status === 303 && (() => { const lib = require('../lib'); return lib.verifyPassword('demo456', db.prepare('SELECT password FROM users WHERE id=?').get(demoId).password); })());

  /* ================= ringkasan ================= */
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek lulus`);
  if (pass !== results.length) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
  if (/\[ERROR\]/.test(log)) console.log('log server:\n' + log.split('\n').filter(l => /ERROR/.test(l)).join('\n'));
  srv.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
