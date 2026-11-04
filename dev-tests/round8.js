'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test ronde 8: menu akordeon + pengaturan tampilan menu, kwitansi selektif & export vertikal iuran,
   kolom bulanan data iuran, aktivasi massal siswa non-aktif, grid honor ekskul + edit/hapus tersinkron */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3595;
const DB = process.env.R8_DB || path.join(os.tmpdir(), 'smk-r8-' + Date.now() + '.sqlite');
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
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  /* ===== 1. menu akordeon ===== */
  r = await req('GET', '/');
  ok('sidebar memakai akordeon', /data-navtoggle="transaksi"/.test(r.text) && /class="nav-sec"/.test(r.text), r.status);
  ok('grup Transaksi berisi submenu', /Transaksi Keuangan/.test(r.text) && /Persetujuan Pengeluaran/.test(r.text));
  ok('menu tanpa nav-label lama', !/class="nav-label"/.test(r.text));

  /* ===== 2. pengaturan tampilan menu ===== */
  r = await req('GET', '/tampilan-menu');
  ok('halaman pengaturan tampilan menu', r.status === 200 && /Pengaturan Tampilan Menu/.test(r.text) && /name="show"/.test(r.text));
  const ui = require('../ui');
  const allHrefs = ui.navCatalog().flatMap(g => g.items.map(i => i.href));
  ok('katalog menu lengkap', allHrefs.length > 30, String(allHrefs.length));
  r = await req('POST', '/tampilan-menu', { show: allHrefs.filter(h => h !== '/ekskul' && h !== '/ekskul/antrean') });
  ok('simpan tampilan menu', r.status === 303);
  r = await req('GET', '/');
  ok('menu disembunyikan dari sidebar', !/href="\/ekskul"/.test(r.text) && /href="\/iuran"/.test(r.text));
  r = await req('POST', '/tampilan-menu', { show: allHrefs });
  ok('tampilkan semua menu kembali', r.status === 303);
  r = await req('GET', '/');
  ok('menu ekskul tampil lagi', /href="\/ekskul"/.test(r.text));

  /* ===== 3. data dasar siswa & iuran ===== */
  await req('POST', '/program-keahlian/save', { nama: 'Teknik Uji', program_studi: 'TU', ketua: 'Ketua' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='Teknik Uji'").get();
  await req('POST', '/kelas/save', { nama: 'X TU 1', tingkat: 'X', wali_kelas: 'Wali', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TU 1'").get();
  await req('POST', '/siswa/save', { nisn: '8001', nama: 'Siswa Uji Satu', jenis_kelamin: 'L', tanggal_lahir: '2010-01-01', kelas_id: kelas.id });
  await req('POST', '/siswa/save', { nisn: '8002', nama: 'Siswa Uji Dua', jenis_kelamin: 'P', tanggal_lahir: '2010-02-02', kelas_id: kelas.id });
  const s1 = db.prepare("SELECT * FROM siswa WHERE nisn='8001'").get();
  const s2 = db.prepare("SELECT * FROM siswa WHERE nisn='8002'").get();

  await req('POST', '/iuran/save', { nama: 'SPP Uji', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  await req('POST', '/iuran/save', { nama: 'Praktik Uji', jenis: 'nonbulanan', nominal_tunggal: '200000', aktif: '1' });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP Uji'").get();
  const gPrak = db.prepare("SELECT * FROM iuran_grup WHERE nama='Praktik Uji'").get();
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [s1.id, s2.id] });
  await req('POST', `/iuran/grup/${gPrak.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [s1.id] });
  const tagSpp = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gSpp.id, s1.id);
  const tagPrak = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(gPrak.id, s1.id);

  /* ===== 4. bayar per bulan → kwitansi kembali ke detail siswa ===== */
  r = await req('POST', '/iuran/bayar', { tagihan_id: tagSpp.id, bulan: '7', tanggal: today, jumlah: '100000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${s1.id}` });
  ok('bayar iuran redirect kwitansi', r.status === 303);
  const loc = r.headers.get('location') || '';
  ok('kwitansi membawa parameter back', /back=%2Fiuran%2Fdata%2F\d+/.test(loc), loc);
  r = await req('GET', loc.replace(base, ''));
  ok('kwitansi punya tombol kembali ke detail siswa', r.status === 200 && /Kembali ke Detail Siswa/.test(r.text) && new RegExp(`href="/iuran/data/${s1.id}"`).test(r.text));
  ok('kwitansi mencetak otomatis', /window\.print\(\)/.test(r.text));

  /* ===== 5. ceklis per grup & per bulan di detail siswa ===== */
  r = await req('GET', `/iuran/data/${s1.id}`);
  ok('detail iuran punya ceklis per bulan', new RegExp(`name="item" value="m:${tagSpp.id}:7"`).test(r.text) && new RegExp(`name="item" value="m:${tagSpp.id}:8"`).test(r.text));
  ok('detail iuran punya ceklis per grup non-bulanan', new RegExp(`name="item" value="g:${tagPrak.id}"`).test(r.text));
  ok('tombol cetak & export terpilih ada', /Cetak Kwitansi Terpilih/.test(r.text) && /Export Excel Terpilih/.test(r.text));

  /* ===== 6. kwitansi selektif: hanya item terbayar ===== */
  r = await req('GET', `/iuran/data/${s1.id}/kwitansi-terpilih?item=m:${tagSpp.id}:7&item=m:${tagSpp.id}:8`);
  ok('kwitansi selektif 200', r.status === 200, r.status);
  ok('kwitansi selektif memuat bulan terbayar', /SPP Uji - Juli/.test(r.text));
  ok('bulan belum dibayar tidak ikut dicetak', !/SPP Uji - Agustus/.test(r.text), 'agustus muncul');
  ok('kwitansi selektif menyebut item yang dilewati', /belum dibayar sehingga tidak dimuat/.test(r.text));
  r = await req('GET', `/iuran/data/${s1.id}/kwitansi-terpilih?item=m:${tagSpp.id}:8`);
  ok('cetak tanpa item terbayar ditolak', r.status === 303 && /err=/.test(r.headers.get('location') || ''), r.status);
  r = await req('GET', `/iuran/data/${s1.id}/kwitansi-terpilih?item=g:${tagPrak.id}`);
  ok('cetak item belum dibayar (non-bulanan) ditolak', r.status === 303, r.status);

  /* ===== 7. export vertikal per item terpilih ===== */
  r = await req('GET', `/iuran/data/${s1.id}/export-item?item=m:${tagSpp.id}:7&item=m:${tagSpp.id}:8&item=g:${tagPrak.id}`, null, { binary: true });
  const sh = X.readXlsx(Buffer.from(r.text))[0];
  const flat = sh.rows.map(row => row.map(c => X.cellText(c)));
  const hIdx = flat.findIndex(row => /GRUP IURAN \/ BULAN/.test(row.join('|')));
  ok('export vertikal punya header kolom lengkap', hIdx >= 0 && /JENIS/.test(flat[hIdx].join('|')) && /NAMA PENCATAT/.test(flat[hIdx].join('|')), JSON.stringify(flat[hIdx] || []));
  const body = flat.slice(hIdx + 1);
  ok('export vertikal berisi 3 baris item', body.filter(x => x[0] && /SPP Uji|Praktik Uji/.test(x[0])).length === 3, JSON.stringify(body.map(x => x[0])));
  ok('export vertikal menampilkan status & pencatat', body.some(x => /Terbayar/.test(x[2])) && body.some(x => /Siswa|Bendahara|Admin/.test(x[8] || '')));

  /* ===== 8. export data iuran semua siswa: kolom bulanan Tagihan/Dibayar/Sisa ===== */
  r = await req('GET', `/iuran/export?format=xlsx&ta=${ta.id}`, null, { binary: true });
  const head = X.readXlsx(Buffer.from(r.text))[0].rows[0].map(c => X.cellText(c));
  ok('export memuat kolom SPP TAGIHAN per bulan', head.some(h => /SPP Uji - JULI TAGIHAN/i.test(h)), head.slice(0, 6).join('|'));
  ok('export memuat kolom SPP SUDAH DIBAYAR per bulan', head.some(h => /SPP Uji - JULI SUDAH DIBAYAR/i.test(h)));
  ok('export memuat kolom SPP SISA per bulan', head.some(h => /SPP Uji - JULI SISA/i.test(h)));
  r = await req('GET', `/iuran/export?format=pdf&ta=${ta.id}`);
  ok('export PDF punya rincian bulanan tagihan/bayar/sisa', r.status === 200 && /Tagih/.test(r.text) && /Bayar/.test(r.text) && /RINCIAN BULANAN/.test(r.text));

  /* ===== 9. siswa non-aktif: sembunyi dari data iuran + aktivasi massal ===== */
  await req('POST', '/siswa/status', { id: s2.id, aksi: 'nonaktif' });
  ok('status siswa menjadi nonaktif', db.prepare('SELECT status FROM siswa WHERE id=?').get(s2.id).status === 'nonaktif');
  r = await req('GET', `/iuran/data?ta=${ta.id}`);
  ok('siswa non-aktif disembunyikan dari Data Iuran', !/Siswa Uji Dua/.test(r.text) && /Siswa Uji Satu/.test(r.text));
  r = await req('GET', '/siswa-nonaktif');
  ok('halaman non-aktif punya ceklis massal', /name="siswa_id"/.test(r.text) && /Aktifkan Kembali Siswa Terpilih/.test(r.text) && /data-check-all="siswa_id"/.test(r.text));
  r = await req('POST', '/siswa/aktifkan-bulk', { siswa_id: [s2.id] });
  ok('aktivasi massal redirect', r.status === 303);
  ok('siswa kembali aktif', db.prepare('SELECT status FROM siswa WHERE id=?').get(s2.id).status === 'aktif');
  r = await req('GET', `/iuran/data?ta=${ta.id}`);
  ok('siswa aktif tampil kembali di Data Iuran', /Siswa Uji Dua/.test(r.text));
  r = await req('POST', '/siswa/aktifkan-bulk', { siswa_id: [] });
  ok('aktivasi massal tanpa pilihan ditolak', r.status === 303 && /err=/.test(r.headers.get('location') || ''));

  /* ===== 10. grid honor ekskul ===== */
  const periode = today.slice(0, 7);
  r = await req('GET', '/ekskul');
  ok('modal grid ekskul tersedia', /data-ekskul-grid/.test(r.text) && /data-ekskul-add-row/.test(r.text) && /grid-tbl/.test(r.text));
  r = await req('POST', '/ekskul/save-grid', {
    periode, jenis: 'Pramuka',
    nama_pembina: ['Pembina A', 'Pembina B', ''], kehadiran: ['4', '6', ''], harga_satuan: ['50000', '40000', ''], keterangan: ['', 'uji', '']
  });
  ok('grid ekskul tersimpan', r.status === 303 && /ok=/.test(r.headers.get('location') || ''), r.headers.get('location'));
  const ekRows = db.prepare('SELECT * FROM ekskul_honor WHERE periode=? ORDER BY id').all(periode);
  ok('dua baris grid dibuat, baris kosong diabaikan', ekRows.length === 2, String(ekRows.length));
  ok('jenis ekskul terisi di semua baris', ekRows.every(x => x.jenis === 'Pramuka'));
  ok('nominal honor sesuai kehadiran x harga', Math.round(ekRows[0].kehadiran * ekRows[0].harga_satuan) === 200000, String(ekRows[0].kehadiran * ekRows[0].harga_satuan));
  r = await req('POST', '/ekskul/save-grid', { periode, nama_pembina: ['Pembina C'], kehadiran: ['0'], harga_satuan: ['10000'] });
  ok('grid ekskul menolak kehadiran 0', /err=/.test(r.headers.get('location') || ''));

  /* edit item pending */
  r = await req('POST', '/ekskul/save', { id: ekRows[0].id, jenis: 'Pramuka', nama_pembina: 'Pembina A', periode, kehadiran: '5', harga_satuan: '50000' });
  ok('edit item pending', r.status === 303 && Number(db.prepare('SELECT kehadiran FROM ekskul_honor WHERE id=?').get(ekRows[0].id).kehadiran) === 5);

  /* ===== 11. edit & hapus di antrean ===== */
  r = await req('GET', '/ekskul/antrean');
  ok('antrean punya tombol edit & hapus per baris', /data-open="mQe/.test(r.text) && /\/ekskul\/delete/.test(r.text), r.status);

  /* posting */
  r = await req('POST', '/ekskul/antrean/posting', { periode, bku_id: bku.id });
  ok('posting ekskul', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  const posted = db.prepare("SELECT * FROM ekskul_honor WHERE periode=? AND status='posted'").all(periode);
  ok('semua baris terposting', posted.length === 2 && posted.every(x => x.transaksi_id));
  const trxId = posted[0].transaksi_id;
  const trx0 = db.prepare('SELECT * FROM transaksi WHERE id=?').get(trxId);
  const sum0 = posted.reduce((a, x) => a + Math.round(x.kehadiran * x.harga_satuan), 0);
  ok('transaksi BKU dibuat sesuai total', Number(trx0.nominal) === sum0, `${trx0.nominal} vs ${sum0}`);
  const bkuSaldoAfter = db.prepare("SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) s FROM transaksi WHERE bku_id=? AND status='posted'").get(bku.id).s;

  r = await req('GET', '/ekskul/antrean');
  ok('riwayat terposting punya tombol edit & hapus', /Riwayat Antrean Posting/.test(r.text) && /data-open="mQe/.test(r.text) && /SELURUH item pada transaksi BKU/.test(r.text), r.status);

  /* edit item terposting → nominal BKU ikut berubah */
  r = await req('POST', '/ekskul/save', { id: posted[0].id, jenis: 'Pramuka', nama_pembina: posted[0].nama_pembina, periode, kehadiran: '10', harga_satuan: '50000' });
  ok('edit item terposting', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  const trx1 = db.prepare('SELECT * FROM transaksi WHERE id=?').get(trxId);
  const sum1 = sum0 - Math.round(posted[0].kehadiran * posted[0].harga_satuan) + 500000;
  ok('nominal BKU tersinkron setelah edit', Number(trx1.nominal) === sum1, `${trx1.nominal} vs ${sum1}`);

  /* hapus tersinkron: item + antrean + transaksi BKU */
  r = await req('POST', '/ekskul/delete', { id: posted[0].id, back: '/ekskul/antrean' });
  ok('hapus tersinkron redirect', r.status === 303 && /ok=/.test(r.headers.get('location') || ''));
  ok('semua item batch dihapus', db.prepare('SELECT COUNT(*) c FROM ekskul_honor WHERE transaksi_id=?').get(trxId).c === 0);
  ok('transaksi BKU sasaran dihapus', !db.prepare('SELECT id FROM transaksi WHERE id=?').get(trxId));
  const bkuSaldoFinal = db.prepare("SELECT COALESCE(SUM(CASE WHEN jenis='pemasukan' THEN nominal ELSE -nominal END),0) s FROM transaksi WHERE bku_id=? AND status='posted'").get(bku.id).s;
  ok('saldo BKU kembali (transaksi hilang)', bkuSaldoFinal === 0 && bkuSaldoAfter !== 0, `${bkuSaldoFinal} vs 0 (sebelum hapus ${bkuSaldoAfter})`);
  ok('item masuk kotak sampah', db.prepare("SELECT COUNT(*) c FROM trash WHERE tabel='ekskul_honor'").get().c === 2);
  r = await req('GET', '/ekskul/antrean');
  ok('antrean kosong setelah hapus', /Antrean posting kosong/.test(r.text) && !/Pembina A/.test(r.text));

  /* ===== 12. halaman tetap 200 ===== */
  for (const p of ['/', '/iuran', '/iuran/data', `/iuran/data/${s1.id}`, '/iuran/transaksi', '/iuran/antrean', '/ekskul', '/ekskul/antrean', '/siswa-nonaktif', '/tampilan-menu']) {
    const rr = await req('GET', p);
    ok('GET ' + p, rr.status === 200, rr.status);
  }

  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek ronde 8 lulus ===`);
  if (fail.length) console.log(fail.map(f => `- ${f.name} ${f.extra || ''}`).join('\n'));
  if (/\[ERROR\]/.test(log)) console.log('SERVER ERROR:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 10).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(log.slice(-2500)); srv.kill(); process.exit(2); });
