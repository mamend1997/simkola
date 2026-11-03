'use strict';
/* Ronde 15 (UI) — instant search realtime, design center, toggle orientasi cetak,
   filter beasiswa, dan bulk unassign (Playwright). */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3571;
const DB = path.join(os.tmpdir(), 'smk-r15ui-' + Date.now() + '.sqlite');
try { fs.unlinkSync(DB); } catch (e) { }
const APP = path.join(__dirname, '..');
const srv = spawn(process.execPath, [path.join(APP, 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
const ok = (n, c, e = '') => { results.push({ n, ok: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${e}`); };
async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);
  const coa = db.prepare("SELECT * FROM coa WHERE kode='5.2.01'").get();
  const today = new Date().toISOString().slice(0, 10);
  for (const [u, n] of [['Belanja Kertas Uji', '400000'], ['Belanja Tinta Uji', '250000'], ['Honor Rapat Uji', '900000']]) {
    await req('POST', '/transaksi/save', { bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai', coa_id: coa.id, nominal: n, uraian: u, nama_pihak: 'Toko Uji' });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto(base + '/login', { waitUntil: 'load' });
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await page.click('button[type=submit]');
  await page.waitForLoadState('load');

  /* ---------- 1. instant search transaksi ---------- */
  await page.goto(base + '/transaksi', { waitUntil: 'load' });
  const totalRows = await page.locator('#rekapTrx tbody tr').count();
  ok('tabel transaksi terisi', totalRows >= 3, String(totalRows));
  await page.fill('input[name=q]', 'Kertas');
  await sleep(400);
  const vis = await page.locator('#rekapTrx tbody tr:visible').count();
  ok('instant search memfilter realtime tanpa klik Filter', vis === 1, `${vis} baris`);
  await page.fill('input[name=q]', '');
  await sleep(350);
  const visAll = await page.locator('#rekapTrx tbody tr:visible').count();
  ok('instant search reset saat kolom dikosongkan', visAll === totalRows, `${visAll}/${totalRows}`);
  ok('tombol Filter tetap ada', await page.locator('form.filter-eq button, form.filter-eq input[type=submit]').count() > 0);

  /* ---------- 1b. instant search pada modul piutang (tabel target) ---------- */
  await req('POST', '/piutang/save', { nama_pegawai: 'Pegawai Cari Uji', tanggal_utang: today, nominal: '450000', keterangan: 'Uji cari' });
  await page.goto(base + '/piutang', { waitUntil: 'load' });
  const target = await page.locator('input[name=q]').first().getAttribute('data-table-search');
  ok('piutang: kolom cari menargetkan tabel', !!target, target || '');
  if (target) {
    const sel = target.split(',')[0].trim();
    const beforeP = await page.locator(`${sel} tbody tr:visible`).count();
    await page.fill('input[name=q]', 'zzzznama');
    await sleep(350);
    const afterP = await page.locator(`${sel} tbody tr:visible`).count();
    ok('piutang: instant search memfilter tabel target', beforeP > 0 && afterP === 0, `${beforeP} -> ${afterP}`);
    await page.fill('input[name=q]', '');
    await sleep(300);
    ok('piutang: filter kembali penuh saat dikosongkan', await page.locator(`${sel} tbody tr:visible`).count() === beforeP);
  }

  /* ---------- 2. design center ---------- */
  await page.goto(base + '/desain-cetak', { waitUntil: 'load' });
  ok('design center: kartu dokumen tampil', await page.locator('.card h3').count() >= 10);
  ok('design center: pilihan orientasi per dokumen', await page.locator('select[name="orient_kwitansi_trx"]').count() === 1);
  await page.selectOption('select[name="orient_kwitansi_trx"]', 'landscape');
  await page.click('form[action="/desain-cetak"] button.btn-primary');
  await page.waitForLoadState('load');
  ok('design center: simpan tersimpan', /disimpan/.test(await page.locator('.alert').first().innerText()));
  const cfg = JSON.parse(db.prepare("SELECT v FROM settings WHERE k='print_design'").get().v);
  ok('design center: orientasi tersimpan di settings', cfg.docs.kwitansi_trx.orient === 'landscape');
  // kembalikan ke portrait
  await page.selectOption('select[name="orient_kwitansi_trx"]', 'portrait');
  await page.click('form[action="/desain-cetak"] button.btn-primary');
  await page.waitForLoadState('load');

  /* ---------- 3. toggle orientasi pada halaman cetak ---------- */
  const trx = db.prepare("SELECT * FROM transaksi WHERE uraian='Belanja Kertas Uji'").get();
  await page.goto(base + `/transaksi/${trx.id}/kwitansi`, { waitUntil: 'load' });
  const oriA = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--none') || document.body.dataset.orient);
  ok('kwitansi: orientasi default portrait', oriA === 'portrait', String(oriA));
  const ttdY = await page.evaluate(() => Array.from(document.querySelectorAll('.kwit-sign .sig-head')).map(e => Math.round(e.getBoundingClientRect().top)));
  ok('kwitansi: 3 header TTD sejajar horizontal', ttdY.length === 3 && new Set(ttdY).size === 1, JSON.stringify(ttdY));
  const nmY = await page.evaluate(() => Array.from(document.querySelectorAll('.kwit-sign .sig .nm')).map(e => Math.round(e.getBoundingClientRect().top)));
  ok('kwitansi: 3 nama TTD sejajar horizontal', nmY.length === 3 && new Set(nmY).size === 1, JSON.stringify(nmY));
  // ronde 19: label bawaan baris "diterima dari" pengeluaran = "Telah diterima dari",
  // isinya "Bendahara <nama sekolah>" (dapat diubah di Desain Templat Cetak).
  const kwBody = await page.locator('.kwit-body').innerText();
  ok('kwitansi: label terima = "Telah diterima dari"', /Telah diterima dari/.test(kwBody), kwBody.replace(/\n/g, ' | ').slice(0, 120));
  ok('kwitansi: isi baris terima = Bendahara + nama sekolah', /Bendahara\s+\S/.test(kwBody));
  await page.click('.orient-switch a[href*="orient=landscape"]');
  await page.waitForLoadState('load');
  ok('kwitansi: toggle landscape bekerja', (await page.evaluate(() => document.body.dataset.orient)) === 'landscape');

  /* ---------- 4. beasiswa: filter nama + kelas ---------- */
  await req('POST', '/program-keahlian/save', { nama: 'TBS Uji', kode: 'TBS' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TBS Uji'").get();
  await req('POST', '/kelas/save', { nama: 'X TBS 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  await req('POST', '/kelas/save', { nama: 'XI TBS 2', tingkat: 'XI', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const k1 = db.prepare("SELECT * FROM kelas WHERE nama='X TBS 1'").get();
  const k2 = db.prepare("SELECT * FROM kelas WHERE nama='XI TBS 2'").get();
  await req('POST', '/siswa/save', { nisn: '8101', nama: 'Ahmad Beasiswa', jenis_kelamin: 'L', tanggal_lahir: '2010-01-01', kelas_id: k1.id });
  await req('POST', '/siswa/save', { nisn: '8102', nama: 'Budi Penerima', jenis_kelamin: 'L', tanggal_lahir: '2010-02-02', kelas_id: k2.id });
  await req('POST', '/iuran/save', { nama: 'SPP UI', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1' });
  const g = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP UI'").get();
  await page.goto(base + `/beasiswa?ta=${ta.id}`, { waitUntil: 'load' });
  await page.selectOption('[data-bea-kelas]', 'X TBS 1');
  await sleep(250);
  const rowsKelas = await page.locator('#tblPenerimaBea tbody tr:visible').count();
  ok('beasiswa: filter kelas membatasi daftar siswa', rowsKelas === 1, String(rowsKelas));
  await page.selectOption('[data-bea-kelas]', '');
  await page.fill('[data-bea-search]', 'Budi');
  await sleep(350);
  const rowsCari = await page.locator('#tblPenerimaBea tbody tr:visible').count();
  ok('beasiswa: pencarian nama memfilter realtime', rowsCari === 1, String(rowsCari));

  /* ---------- 5. bulk unassign (ceklis + hapus terpilih) ---------- */
  const s1 = db.prepare("SELECT * FROM siswa WHERE nisn='8101'").get();
  const s2 = db.prepare("SELECT * FROM siswa WHERE nisn='8102'").get();
  await req('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: k1.id, siswa_id: [s1.id] });
  await req('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: k2.id, siswa_id: [s2.id] });
  await page.goto(base + `/iuran/grup/${g.id}`, { waitUntil: 'load' });
  ok('bulk unassign: ceklis per baris + pilih semua', await page.locator('input[data-check-group="lepas"]').count() === 2
    && await page.locator('[data-check-group-box="lepas"]').count() === 1);
  await page.check('[data-check-group-box="lepas"]');
  const checked = await page.locator('input[data-check-group="lepas"]:checked').count();
  ok('bulk unassign: pilih semua mencentang semua baris', checked === 2, String(checked));
  page.once('dialog', d => d.accept());
  await page.click('button[form="fLepas"]');
  await page.waitForLoadState('load');
  ok('bulk unassign: penetapan terhapus massal', db.prepare('SELECT COUNT(*) c FROM iuran_tagihan WHERE grup_id=?').get(g.id).c === 0);

  await page.close();
  await browser.close();
  srv.kill();
  ok('tanpa error JS di semua halaman uji', errs.length === 0, errs.slice(0, 3).join(' | '));

  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 15 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1200)); process.exit(1); }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
