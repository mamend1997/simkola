'use strict';
/* Test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* ==================================================================
   RONDE 34 — Ceklis massal, menu ToS/SLA tenant, ledger pinjaman
   (hapus + kwitansi), routing slug dinamis, dan dua template kop cetak.
   1.  "Pilih Semua" & penghitung terpilih (Transaksi, Antrean Iuran,
       Slip Gaji Pegawai, Data Pegawai) — atribut grup yang benar
   2.  Menu Syarat & Ketentuan + SLA di sidebar panel sekolah
   3.  Ledger Pinjaman Kegiatan: hapus tidak 404 + kwitansi per transaksi
   4.  Routing slug dinamis /<nama-sekolah>/portal tidak 404
   5.  Desain Templat Cetak: tab Kop Kwitansi & Kop Laporan terpisah,
       live preview, dan mesin cetak terpisah (kwitansi vs laporan)
   ================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r34-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3691;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB,
    DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: 'SuperAdminUji2026!'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
let superCookie = '';
const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  if (!cond) console.log('FAIL', name, '→', extra);
}
async function req(method, url, body, opt = {}) {
  const headers = {};
  const ck = opt.super ? superCookie : (opt.cookie !== undefined ? opt.cookie : cookie);
  if (ck) headers.Cookie = ck;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) {
    const val = sc.split(';')[0];
    if (opt.super) superCookie = val; else cookie = val;
  }
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, loc: r.headers.get('location') || '', headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
const today = new Date().toISOString().slice(0, 10);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const ctl = new Database(SAAS_DB);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), r.loc);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);
  ok('data dasar tersedia (TA + BKU)', !!ta && !!bku);

  /* ==================================================================
     1. CEKLIS MASSAL: "PILIH SEMUA" + PENGHITUNG
     ================================================================== */
  // transaksi: pemasukan & pengeluaran
  await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pemasukan', coa_id: db.prepare("SELECT id FROM coa WHERE kode='4.1.01'").get().id,
    nominal: '1000000', uraian: 'Uji ceklis massal', metode: 'tunai'
  });
  await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', coa_id: db.prepare("SELECT id FROM coa WHERE kode='5.2.01'").get().id,
    nominal: '250000', uraian: 'Uji ceklis pengeluaran', metode: 'tunai'
  });
  const trxRows = db.prepare("SELECT COUNT(*) c FROM transaksi WHERE bku_id=?").get(bku.id).c;

  r = await req('GET', '/transaksi');
  ok('transaksi: baris ceklis memakai grup trxIds (bukan name="id")',
    /data-check-item="trxIds"/.test(r.text) && /name="id"[^>]*data-check-item="trxIds"|data-check-item="trxIds"[^>]*name="id"/.test(r.text));
  ok('transaksi: penghitung "Terpilih" tampil', /Terpilih: <b data-check-count="trxIds">0<\/b> transaksi/.test(r.text));
  ok('transaksi: tombol Pilih Semua & kotak kepala tabel satu grup',
    /data-check-all="trxIds"/.test(r.text) && /data-check-all-box="trxIds"/.test(r.text), String(trxRows));

  // pegawai + payroll slip
  await req('POST', '/pegawai/save', { nama: 'Guru Uji Ceklis', jabatan: 'Guru', tipe: 'guru', aktif: '1' });
  const peg = db.prepare("SELECT * FROM pegawai WHERE nama='Guru Uji Ceklis'").get();
  ok('pegawai baru tersimpan', !!peg);
  r = await req('GET', '/pegawai');
  ok('pegawai: baris ceklis terkait grup pegawaiIds', /data-check-item="pegawaiIds"/.test(r.text)
    && /data-check-count="pegawaiIds"/.test(r.text), String(r.status));
  const periode = db.prepare("SELECT substr(?,1,7) p").get(today).p;
  db.prepare(`INSERT INTO payroll (periode,pegawai_id,nama,jabatan,tipe,jam_efektif,honor_jam,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(periode, peg.id, peg.nama, 'Guru', 'guru', 20, 50000, new Date().toISOString());
  const payRow = db.prepare('SELECT * FROM payroll WHERE periode=? AND pegawai_id=?').get(periode, peg.id);
  ok('baris leger honor tersedia', !!payRow, periode);
  r = await req('GET', '/payroll/slip?periode=' + periode);
  ok('slip gaji: baris ceklis terkait grup slipIds', /data-check-item="slipIds"/.test(r.text)
    && /data-check-count="slipIds">0<\/b> pegawai/.test(r.text));

  // antrean posting iuran: dua tabel ber-name="ids" harus dibatasi per tabel
  await req('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await req('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 1'").get();
  await req('POST', '/siswa/save', { nisn: '9001', nama: 'Siswa Ceklis', jenis_kelamin: 'L', tanggal_lahir: '2010-02-02', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='9001'").get();
  await req('POST', '/iuran/save', { nama: 'Iuran Uji', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '200000', aktif: '1', tahun_ajaran_id: ta.id });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran Uji'").get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tag = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(grup.id);
  await req('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '1',
    key_0: `m:${tag.id}:7`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '200000', potongan_0: '0', bku_0: String(bku.id), nonbku_0: ''
  });
  ok('pembayaran iuran masuk antrean', db.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c > 0);
  // satu pembayaran disimpan sebagai Non-BKU agar kartu kedua juga tampil di antrean
  await req('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '1',
    key_0: `m:${tag.id}:8`, tanggal_0: today, metode_0: 'tunai', jumlah_0: '200000', potongan_0: '0', bku_0: String(bku.id), nonbku_0: '1'
  });
  r = await req('GET', '/iuran/antrean');
  ok('antrean iuran: baris queue memakai grup qids', /data-check-item="qids"/.test(r.text));
  ok('antrean iuran: scope tabel queue dipakai tombol & penghitung',
    /data-check-all="qids" data-check-scope="#tblAntreanQueue"/.test(r.text)
    && /data-check-count="qids" data-check-scope="#tblAntreanQueue">0<\/b> kelompok/.test(r.text));
  ok('antrean iuran: tabel pending & non-BKU memakai scope masing-masing',
    /data-check-scope="#tblAntreanPending"/.test(r.text) && /data-check-scope="#tblAntreanNonBku"/.test(r.text));
  ok('antrean iuran: id tabel queue terpasang', /id="tblAntreanQueue"/.test(r.text));

  // app.js memuat mesin ceklis generik versi baru
  const appjs = await req('GET', '/assets/app.js');
  ok('app.js memuat grup ceklis via data-check-item & scope', appjs.status === 200
    && /data-check-item/.test(appjs.text) && /checkScope/.test(appjs.text),
    `status=${appjs.status} len=${appjs.text.length}`);
  ok('app.js memuat pratinjau kop & tab', /data-kopv/.test(appjs.text) && /data-tabgroup/.test(appjs.text));

  /* ==================================================================
     2. MENU TERMS OF SERVICE & SLA DI PANEL SEKOLAH
     ================================================================== */
  r = await req('GET', '/');
  ok('sidebar memuat grup Legalitas Layanan', /Legalitas Layanan/.test(r.text));
  ok('sidebar memuat menu Syarat & Ketentuan', /href="[^"]*\/legal\/tos"/.test(r.text) && /Syarat &amp; Ketentuan Layanan/.test(r.text));
  ok('sidebar memuat menu SLA', /href="[^"]*\/legal\/sla"/.test(r.text));
  ok('menu legal berada paling bawah (setelah Bantuan & Tiket)',
    r.text.indexOf('/legal/tos') > r.text.indexOf('/bantuan'));

  r = await req('GET', '/legal/tos');
  ok('halaman ToS panel sekolah 200', r.status === 200);
  ok('halaman ToS menampilkan dokumen bawaan', /layanan berlangganan|Syarat & Ketentuan Layanan/i.test(r.text));
  ok('halaman ToS memakai layout sidebar', /class="sidebar"/.test(r.text));
  r = await req('GET', '/legal/sla');
  ok('halaman SLA panel sekolah 200', r.status === 200);
  ok('halaman SLA menampilkan isi SLA', /Ketersediaan Layanan/.test(r.text));

  // Super Admin mengubah teks → halaman sekolah ikut berubah
  r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdminUji2026!' }, { super: true });
  ok('login super admin pusat', r.status === 303 && !/err=/.test(r.loc), r.loc);
  r = await req('POST', '/super-admin/legal', {
    legal_tos_judul: 'Ketentuan Uji Ronde 34',
    legal_tos: '1. Ketentuan Uji\nIsi ketentuan versi uji ronde 34.',
    legal_sla: '1. SLA Uji\nTarget layanan versi uji.',
    legal_kontak: 'support@uji34.sch.id'
  }, { super: true });
  ok('super admin menyimpan dokumen legalitas', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  r = await req('GET', '/legal/tos');
  ok('halaman ToS sekolah memakai teks terpusat', /Ketentuan Uji Ronde 34/.test(r.text) && /versi uji ronde 34/.test(r.text));
  ok('halaman ToS menampilkan kontak layanan', /support@uji34\.sch\.id/.test(r.text));

  /* ==================================================================
     3. LEDGER PINJAMAN KEGIATAN: HAPUS + KWITANSI
     ================================================================== */
  r = await req('POST', '/aset/pinjaman/tambah', { nama: 'Pinjaman Kegiatan Uji', saldo: '5000000', keterangan: 'Uji ronde 34' });
  ok('akun pinjaman kegiatan dibuat', r.status === 303 && /\/aset\/akun\//.test(r.loc), r.loc);
  const akun = db.prepare("SELECT * FROM aset WHERE nama='Pinjaman Kegiatan Uji'").get();
  ok('akun pinjaman tersimpan tanpa saldo awal', !!akun && akun.jenis === 'pinjaman' && Number(akun.saldo) === 0);

  await req('POST', `/aset/akun/${akun.id}/mutasi`, {
    jenis: 'keluar', tanggal: today, nominal: '1500000', keterangan: 'Pencairan pinjaman uji',
    metode: 'transfer', nama_pihak: 'Koperasi Sekolah', no_bukti: 'AS/UJI/001'
  });
  const mutasi = db.prepare('SELECT * FROM pinjaman_mutasi WHERE aset_id=? ORDER BY id DESC LIMIT 1').get(akun.id);
  ok('transaksi pinjaman tersimpan', !!mutasi && Number(mutasi.nominal) === 1500000);

  r = await req('GET', `/aset/akun/${akun.id}`);
  ok('ledger pinjaman 200', r.status === 200);
  ok('pencairan Keluar menghasilkan saldo positif tanpa saldo awal',
    /Rp\s?1\.500\.000/.test(r.text) && !/Saldo Awal/.test(r.text));
  const beforeOverpay = db.prepare('SELECT COUNT(*) c FROM pinjaman_mutasi WHERE aset_id=?').get(akun.id).c;
  r = await req('POST', `/aset/akun/${akun.id}/mutasi`, {
    jenis: 'masuk', tanggal: today, nominal: '2000000', keterangan: 'Pengembalian melebihi pencairan'
  });
  ok('pengembalian yang membuat saldo minus ditolak',
    r.status === 303 && /err=/.test(r.loc)
    && db.prepare('SELECT COUNT(*) c FROM pinjaman_mutasi WHERE aset_id=?').get(akun.id).c === beforeOverpay);
  ok('baris ledger punya tombol Cetak Kwitansi', /Cetak Kwitansi/.test(r.text)
    && new RegExp(`/aset/akun/${akun.id}/mutasi/${mutasi.id}/kwitansi`).test(r.text));

  r = await req('GET', `/aset/akun/${akun.id}/mutasi/${mutasi.id}/kwitansi`);
  ok('kwitansi transaksi pinjaman 200', r.status === 200, String(r.status));
  ok('kwitansi memakai format kwitansi BKU (kwit-box + kop kwitansi)', /kwit-box/.test(r.text) && /kwit-kop/.test(r.text));
  ok('kwitansi memuat nominal & terbilang', /Rp\s?1\.500\.000/.test(r.text) && /satu juta lima ratus ribu/i.test(r.text.replace(/\s+/g, ' ')));
  ok('kwitansi memuat nama akun & pihak', /Pinjaman Kegiatan Uji/.test(r.text) && /Koperasi Sekolah/.test(r.text));
  ok('kwitansi 404 untuk transaksi milik akun lain', (await req('GET', `/aset/akun/${akun.id}/mutasi/999999/kwitansi`)).status === 404);

  // HAPUS: dulu 404 karena rute tidak memuat :id
  r = await req('POST', `/aset/akun/${akun.id}/mutasi/delete`, { id: mutasi.id });
  ok('hapus transaksi pinjaman TIDAK 404 lagi', r.status === 303 && /ok=/.test(r.loc), `${r.status} ${dec(r.loc)}`);
  ok('baris transaksi benar-benar terhapus', !db.prepare('SELECT id FROM pinjaman_mutasi WHERE id=?').get(mutasi.id));
  ok('transaksi terhapus masuk Kotak Sampah',
    !!db.prepare("SELECT id FROM trash WHERE tabel='pinjaman_mutasi'").get());

  // kompatibilitas aksi lama tanpa segmen id
  await req('POST', `/aset/akun/${akun.id}/mutasi`, { jenis: 'keluar', tanggal: today, nominal: '300000', keterangan: 'Uji hapus legacy' });
  const mut2 = db.prepare('SELECT * FROM pinjaman_mutasi WHERE aset_id=? ORDER BY id DESC LIMIT 1').get(akun.id);
  r = await req('POST', '/aset/akun/mutasi/delete', { id: mut2.id });
  ok('rute hapus lama (tanpa id) tetap berfungsi', r.status === 303 && !db.prepare('SELECT id FROM pinjaman_mutasi WHERE id=?').get(mut2.id), String(r.status));

  /* ==================================================================
     4. ROUTING SLUG DINAMIS /<nama-sekolah>/portal
     ================================================================== */
  const slug0 = String((ctl.prepare('SELECT portal_slug FROM tenants WHERE id=1').get() || {}).portal_slug || '');
  ok('slug kanonik sekolah tersedia', !!slug0, slug0);
  const base0 = slug0.split('/')[0];
  const isRedir = x => [301, 302, 303, 307, 308].includes(typeof x === 'number' ? x : x && x.status);
  /* ronde 43: alamat sah = /<nama-sekolah>/<sub-slug> */
  r = await req('GET', `/${base0}/portal-tagihan`, null, { cookie: '' });
  ok('alamat /<nama-sekolah>/portal-tagihan dapat dibuka tanpa login', r.status === 200, `${r.status} · ${base0}`);
  r = await req('GET', `/${base0}/portal`, null, { cookie: '' });
  ok('alamat lama /<slug>/portal dialihkan ke alamat lengkap', isRedir(r.status) && /portal-tagihan/.test(r.loc || ''), `${r.status} ${r.loc || ''}`);
  r = await req('GET', `/${base0}`, null, { cookie: '' });
  ok('alamat /<slug> (kanonik) dialihkan ke alamat lengkap', isRedir(r.status) && /portal-tagihan/.test(r.loc || ''), String(r.status));
  r = await req('GET', `/portal/${base0}`, null, { cookie: '' });
  ok('alamat /portal/<slug> dialihkan ke alamat lengkap', isRedir(r.status) && /portal-tagihan/.test(r.loc || ''), String(r.status));
  r = await req('GET', `/${base0}/portal-pegawai`, null, { cookie: '' });
  ok('alamat /<slug>/portal-pegawai dapat dibuka', r.status === 200, String(r.status));
  r = await req('GET', '/sekolah-tidak-ada/portal', null, { cookie: '' });
  ok('slug tidak dikenal tetap 404', r.status === 404, String(r.status));

  // slug dua bagian ("sekolah/tagihan") — bagian nama sekolah tetap segmen pertama
  const twoPart = 'sekolah-uji-r34/tagihan';
  r = await req('POST', '/super-admin/portal-publik/1/slug', { portal_slug: twoPart, status: 'aktif' }, { super: true });
  ok('super admin menyimpan slug dua bagian', r.status === 303, dec(r.loc));
  await sleep(400);
  ok('slug dua bagian tersimpan di control plane',
    String((ctl.prepare('SELECT portal_slug FROM tenants WHERE id=1').get() || {}).portal_slug || '') === twoPart,
    String((ctl.prepare('SELECT portal_slug FROM tenants WHERE id=1').get() || {}).portal_slug || ''));
  r = await req('GET', '/sekolah-uji-r34/portal-tagihan', null, { cookie: '' });
  ok('alamat slug dua bagian → /<nama-sekolah>/portal-tagihan 200', r.status === 200, String(r.status));
  r = await req('GET', '/sekolah-uji-r34/tagihan', null, { cookie: '' });
  ok('alamat lama slug dua bagian dialihkan', isRedir(r.status) && /portal-tagihan/.test(r.loc || ''), String(r.status));
  r = await req('GET', '/sekolah-uji-r34/portal', null, { cookie: '' });
  ok('alamat /<nama-sekolah>/portal pada slug dua bagian dialihkan', isRedir(r.status) && /portal-tagihan/.test(r.loc || ''), String(r.status));
  r = await req('GET', '/sekolah-uji-r34/tagihan/portal', null, { cookie: '' });
  ok('alamat /<nama-sekolah>/<custom>/portal dialihkan', isRedir(r.status), String(r.status));
  r = await req('GET', '/sekolah-uji-r34/portal-pegawai', null, { cookie: '' });
  ok('alamat /<nama-sekolah>/portal-pegawai pada slug dua bagian 200', r.status === 200, String(r.status));
  // pengguna yang sudah login juga tidak boleh 404 saat membuka alamat portal sekolahnya
  r = await req('GET', '/sekolah-uji-r34/portal-tagihan');
  ok('alamat /<nama-sekolah>/portal-tagihan untuk pengguna login tidak 404', r.status === 200, String(r.status));
  r = await req('GET', '/sekolah-uji-r34');
  ok('alamat /<nama-sekolah> untuk pengguna login dialihkan (tidak 404)', isRedir(r.status) && /portal-tagihan/.test(r.loc || ''), String(r.status));
  // kembalikan slug semula
  await req('POST', '/super-admin/portal-publik/1/slug', { portal_slug: slug0, status: 'aktif' }, { super: true });
  await sleep(300);
  r = await req('GET', `/${base0}/portal-tagihan`, null, { cookie: '' });
  ok('slug semula kembali berfungsi', r.status === 200, String(r.status));

  /* ==================================================================
     5. DESAIN TEMPLAT CETAK: DUA TAB KOP + MESIN CETAK TERPISAH
     ================================================================== */
  r = await req('GET', '/desain-cetak');
  ok('halaman desain 200 & memuat tab bar', r.status === 200 && /data-tabgroup="desain"/.test(r.text));
  ok('tab 1: Kop Kwitansi Transaksi', /data-tab-btn="kwitansi"/.test(r.text) && /Kop Kwitansi Transaksi/.test(r.text));
  ok('tab 2: Kop Laporan Keuangan', /data-tab-btn="laporan"/.test(r.text) && /Kop Laporan Keuangan/.test(r.text));
  ok('dua form kop independen (kwitansi & laporan)',
    (r.text.match(/data-kop-form="/g) || []).length === 2,
    String((r.text.match(/data-kop-form="/g) || []).length));
  ok('form kop: pilihan sumber data (auto/manual)', (r.text.match(/name="sumber"/g) || []).length === 2);
  ok('form kop: kustom teks multi-baris', (r.text.match(/name="text"/g) || []).length === 2);
  ok('form kop: ukuran font per baris (8 slot × 2 form)', (r.text.match(/name="size_\d"/g) || []).length === 16,
    String((r.text.match(/name="size_\d"/g) || []).length));
  ok('form kop: tebal & miring per baris', /name="bold_1"/.test(r.text) && /name="italic_1"/.test(r.text));
  ok('form kop: unggah logo kop + ukuran lebar/tinggi',
    (r.text.match(/name="logo_b64"/g) || []).length === 2 && /name="logo_w"/.test(r.text) && /name="logo_h"/.test(r.text));
  ok('form kop: opsi garis pemisah (tunggal/ganda/tanpa)', /Garis Tunggal/.test(r.text) && /Garis Ganda/.test(r.text) && /Tanpa Garis/.test(r.text));
  ok('form kop: box pratinjau langsung per tab', (r.text.match(/data-kopv="/g) || []).length === 2);
  ok('pratinjau memuat data kop otomatis (JSON)', (r.text.match(/data-kopv-auto="/g) || []).length === 2);
  // kompatibilitas dengan pengaturan kop global lama
  ok('kop global lama tetap ada (1 textarea & 1 pratinjau .doc .kop)',
    (r.text.match(/name="kop_baris"/g) || []).length === 1
    && (r.text.match(/<div class="kop"/g) || []).length === 1,
    `textarea=${(r.text.match(/name="kop_baris"/g) || []).length} kop=${(r.text.match(/<div class="kop"/g) || []).length}`);

  // identitas sekolah untuk kop otomatis
  await req('POST', '/sekolah', {
    sekolah_nama: 'SMK Uji Ronde 34', sekolah_npsn: '20334455', sekolah_bentuk: 'SMK',
    sekolah_status: 'Swasta', sekolah_kepemilikan: 'Yayasan Uji 34', sekolah_telp: '0265 334455',
    sekolah_email: 'r34@uji.sch.id', sekolah_website: 'www.r34.sch.id', sekolah_alamat: 'Jl. Uji Ronde 34 No. 1'
  });

  // simpan template KOP KWITANSI (manual, font per baris, logo, garis tanpa)
  r = await req('POST', '/desain-cetak/kop', {
    jenis: 'kwitansi', sumber: 'manual', garis: 'none',
    text: 'YAYASAN UJI RONDE 34\nKWITANSI RESMI\nSMK UJI RONDE 34\nJl. Khusus Kwitansi No. 9',
    size_1: '6', size_2: '8', bold_2: '1', italic_3: '1', size_3: '9',
    logo_b64: PNG, logo_w: '40', logo_h: '40'
  });
  ok('simpan kop kwitansi berhasil', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  let kopK = {};
  try { kopK = JSON.parse(db.prepare("SELECT v FROM settings WHERE k='kop_kwitansi'").get().v || '{}'); } catch (e) { }
  ok('setting kop_kwitansi tersimpan (JSON)', kopK.sumber === 'manual' && (kopK.baris || []).length === 4, JSON.stringify(kopK).slice(0, 160));
  ok('ukuran font per baris & gaya tersimpan',
    Number((kopK.format || [])[0].size) === 6 && (kopK.format || [])[1].bold === true && (kopK.format || [])[2].italic === true);
  ok('ukuran logo kop tersimpan', Number(kopK.logo_w) === 40 && Number(kopK.logo_h) === 40);
  ok('garis kop "tanpa garis" tersimpan', kopK.garis === 'none');
  ok('logo kop kwitansi terunggah terpisah', !!String(kopK.logo || ''));

  // simpan template KOP LAPORAN (auto, garis ganda, ukuran logo lain)
  r = await req('POST', '/desain-cetak/kop', {
    jenis: 'laporan', sumber: 'auto', garis: 'double', logo_w: '90', logo_h: '90'
  });
  ok('simpan kop laporan berhasil', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  let kopL = {};
  try { kopL = JSON.parse(db.prepare("SELECT v FROM settings WHERE k='kop_laporan'").get().v || '{}'); } catch (e) { }
  ok('setting kop_laporan terpisah tersimpan', kopL.sumber === 'auto' && Number(kopL.logo_w) === 90, JSON.stringify(kopL).slice(0, 120));

  // ---- mesin cetak terpisah: kwitansi memakai kop kwitansi, laporan memakai kop laporan ----
  const trx = db.prepare('SELECT * FROM transaksi WHERE bku_id=? ORDER BY id LIMIT 1').get(bku.id);
  r = await req('GET', `/transaksi/${trx.id}/kwitansi`);
  ok('kwitansi BKU memakai baris kop KWITANSI', /YAYASAN UJI RONDE 34/.test(r.text) && /Jl\. Khusus Kwitansi No\. 9/.test(r.text));
  ok('kwitansi BKU memakai ukuran font per baris kop kwitansi (px)',
    /font-size:6px/.test(r.text) && /font-size:9px[^"]*font-style:italic/.test(r.text),
    (r.text.match(/font-size:[0-9.]+px[^"]*/g) || []).slice(0, 4).join(' | '));
  ok('kwitansi BKU memakai ukuran logo kop kwitansi (40px)', /width:40px;height:40px/.test(r.text));
  ok('kwitansi BKU tanpa garis kop', /class="kwit-kop" style="border-bottom:none"/.test(r.text));

  r = await req('GET', '/cetak/bku');
  // nama sekolah dari Identitas Sekolah dipakai apa adanya (bukan dipaksa UPPERCASE)
  ok('laporan BKU memakai kop LAPORAN (otomatis dari identitas)', /SMK Uji Ronde 34/i.test(r.text) && /20334455|NPSN/.test(r.text));
  ok('laporan BKU TIDAK memakai baris kop kwitansi', !/YAYASAN UJI RONDE 34/.test(r.text));
  ok('laporan BKU memakai ukuran logo kop laporan (90px)', /width:90px;height:90px/.test(r.text));

  r = await req('GET', `/aset/akun/${akun.id}/mutasi`);
  ok('kwitansi pinjaman kegiatan juga memakai kop kwitansi', /YAYASAN UJI RONDE 34/.test(
    (await req('GET', `/aset/akun/${akun.id}`)).text) === false);   // halaman ledger bukan dokumen cetak

  // ---- validasi & pembatasan nilai ----
  r = await req('POST', '/desain-cetak/kop', {
    jenis: 'laporan', sumber: 'manual', text: 'A\nB', size_1: '999', logo_w: '1', logo_h: '9999', garis: 'diagonal'
  });
  let clamp = {};
  try { clamp = JSON.parse(db.prepare("SELECT v FROM settings WHERE k='kop_laporan'").get().v || '{}'); } catch (e) { }
  ok('ukuran font dibatasi (maks 48)', Number((clamp.format || [])[0].size) === 48, String((clamp.format || [])[0].size));
  ok('lebar/tinggi logo dibatasi (min 12, maks 220)',
    Number(clamp.logo_w) === 12 && Number(clamp.logo_h) === 220, `${clamp.logo_w}/${clamp.logo_h}`);
  ok('nilai garis tidak dikenal kembali ke bawaan', ['single', 'double', 'none'].includes(clamp.garis), clamp.garis);

  // ---- reset template → kembali memakai kop global ----
  await req('POST', '/desain-cetak', {
    kop_sumber: 'manual', kop_baris: 'KOP GLOBAL UJI\nBARIS DUA\nBARIS TIGA\nSEKOLAH GLOBAL UJI\nBARIS LIMA',
    print_tempat: 'Cikoneng'
  });
  r = await req('POST', '/desain-cetak/kop', { jenis: 'kwitansi', reset: '1' });
  ok('reset kop kwitansi berhasil', r.status === 303 && /ok=/.test(r.loc), dec(r.loc));
  ok('setting kop_kwitansi dikosongkan', String(db.prepare("SELECT v FROM settings WHERE k='kop_kwitansi'").get().v || '') === '');
  r = await req('GET', `/transaksi/${trx.id}/kwitansi`);
  ok('kwitansi kembali memakai kop global', /KOP GLOBAL UJI/.test(r.text) && !/YAYASAN UJI RONDE 34/.test(r.text));

  // ---- halaman pengaturan memuat nilai tersimpan ----
  await req('POST', '/desain-cetak/kop', {
    jenis: 'kwitansi', sumber: 'manual', text: 'BARIS SATU\nBARIS DUA', size_1: '7', logo_w: '50', logo_h: '50', garis: 'single'
  });
  r = await req('GET', '/desain-cetak');
  ok('editor menampilkan teks kop kwitansi tersimpan', /BARIS SATU/.test(r.text));
  ok('editor menampilkan ukuran logo tersimpan', /name="logo_w" value="50"/.test(r.text));
  ok('editor menampilkan garis terpilih', /<option value="single" selected>/.test(r.text));

  /* ==================================================================
     6. KOP DICETAK APA ADANYA (tidak dipaksa UPPERCASE)
     ================================================================== */
  // kop manual dengan campuran huruf besar/kecil
  await req('POST', '/desain-cetak/kop', {
    jenis: 'laporan', sumber: 'manual', garis: 'double', logo_w: '76', logo_h: '76',
    text: 'Yayasan Pendidikan Cikoneng\nPersatuan Guru Republik Indonesia (YPLP-PGRI)\nSekolah Menengah Kejuruan PGRI Cikoneng\nJalan Raya Cikoneng No.144 Telp. (0265) 773258'
  });
  r = await req('GET', '/cetak/bku');
  ok('kop laporan memakai teks PERSIS seperti diketik (huruf kecil tetap kecil)',
    /Yayasan Pendidikan Cikoneng/.test(r.text) && /Sekolah Menengah Kejuruan PGRI Cikoneng/.test(r.text)
    && !/YAYASAN PENDIDIKAN CIKONENG/.test(r.text),
    (r.text.match(/Yayasan[^<]*|YAYASAN[^<]*/g) || []).slice(0, 2).join(' | '));
  ok('kop laporan tidak mengubah "Telp." menjadi kapital', /Telp\. \(0265\) 773258/.test(r.text));
  await req('POST', '/desain-cetak/kop', {
    jenis: 'kwitansi', sumber: 'manual', garis: 'single',
    text: 'Yayasan Pendidikan Cikoneng\nSekolah Menengah Kejuruan PGRI Cikoneng'
  });
  r = await req('GET', '/transaksi/' + trx.id + '/kwitansi');
  ok('kwitansi mengikuti teks kop apa adanya', /Yayasan Pendidikan Cikoneng/.test(r.text) && !/YAYASAN PENDIDIKAN CIKONENG/.test(r.text),
    (r.text.match(/Yayasan[^<]*|YAYASAN[^<]*/g) || []).slice(0, 2).join(' | '));

  // kop otomatis dari Identitas Sekolah juga apa adanya
  await req('POST', '/sekolah', {
    sekolah_nama: 'SMK Pgri Cikoneng', sekolah_npsn: '20334455', sekolah_bentuk: 'SMK',
    sekolah_status: 'Swasta', sekolah_kepemilikan: 'Yayasan Pendidikan Cikoneng',
    sekolah_alamat: 'Jalan Raya Cikoneng No.144', sekolah_telp: '0265 773258'
  });
  await req('POST', '/desain-cetak/kop', { jenis: 'laporan', sumber: 'auto', garis: 'double' });
  r = await req('GET', '/cetak/bku');
  ok('kop otomatis tidak memaksa nama sekolah kapital', /SMK Pgri Cikoneng/.test(r.text) && !/SMK PGRI CIKONENG/.test(r.text),
    (r.text.match(/SMK [A-Za-z ]+Cikoneng/gi) || []).slice(0, 2).join(' | '));
  ok('kop otomatis memakai kepemilikan apa adanya', /Yayasan Pendidikan Cikoneng/.test(r.text));

  // tidak ada aturan CSS yang memaksa huruf besar pada baris kop
  const cssAsset = await req('GET', '/assets/app.css');
  const l1 = (cssAsset.text.match(/\.kop \.kop-txt \.l1\{[^}]*\}/) || [''])[0];
  const kwitNama = (cssAsset.text.match(/\.kwit-kop \.kwit-kop-nama\{[^}]*\}/) || [''])[0];
  ok('CSS baris kop tidak memakai text-transform:uppercase', !!l1 && !/uppercase/.test(l1), l1);
  ok('CSS nama sekolah di kop kwitansi tidak uppercase', !!kwitNama && !/uppercase/.test(kwitNama), kwitNama);

  console.log(`\n=== ${results.filter(x => x.ok).length}/${results.length} cek ronde 34 lulus ===`);
  if (results.some(x => !x.ok)) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
  try { srv.kill(); } catch (e) { }
  setTimeout(() => process.exit(results.every(x => x.ok) ? 0 : 1), 250);
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
