'use strict';
/* UI ronde 17 (Playwright): rincian iuran bulanan, antrean Non-BKU, catatan pegawai,
   menu baru, dan tidak ada overflow horizontal / error JS di desktop & mobile 390px. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const PORT = 3618;
const DB = process.env.R17U_DB || path.join(os.tmpdir(), 'smk-r17u-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let cookie = '';
  async function api(method, url, body) {
    const headers = { Cookie: cookie };
    let payload = null;
    if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, text: await r.text() };
  }
  await api('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  await api('POST', '/program-keahlian/save', { nama: 'AKL', program_studi: 'AKL', ketua: 'K' });
  const Database = require('better-sqlite3');
  const db = new Database(DB);
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='AKL'").get();
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  await api('POST', '/kelas/save', { nama: 'X AKL 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X AKL 1'").get();
  await api('POST', '/siswa/save', { nisn: '8001', nama: 'Citra Dewi', jenis_kelamin: 'P', tanggal_lahir: '2010-06-06', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='8001'").get();
  await api('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '175000', aktif: '1', tahun_ajaran_id: ta.id });
  const g = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await api('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  const tag = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').get(g.id);
  const bku = db.prepare("SELECT * FROM bku WHERE COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1").get();
  await api('POST', '/iuran/bayar-item', {
    back: `/iuran/data/${siswa.id}`, n: '1',
    key_0: `m:${tag.id}:7`, tanggal_0: new Date().toISOString().slice(0, 10), metode_0: 'tunai',
    jumlah_0: '175000', potongan_0: '0', bku_0: String(bku.id), nonbku_0: ''
  });

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/login');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);

  /* ---------- menu baru ---------- */
  ok('menu Komunikasi Internal tampil', await page.locator('a[href="/catatan-pegawai"]').count() >= 1);
  ok('menu Rincian Iuran Bulanan tampil', await page.locator('a[href="/iuran/bulanan"]').count() >= 1);

  /* ---------- rincian bulanan ---------- */
  await page.goto(base + '/iuran/bulanan');
  ok('12 kolom bulan tampil', await page.locator('.bulanan-tbl thead th.bulan-head').count() === 12,
    String(await page.locator('.bulanan-tbl thead th.bulan-head').count()));
  ok('baris siswa tampil', /Citra Dewi/.test(await page.locator('#tblBulanan').innerText()));
  const bulanText = await page.locator('.bulanan-tbl thead').first().innerText();
  ok('header Juli … Juni', /JULI/i.test(bulanText) && /JUNI/i.test(bulanText), bulanText.slice(0, 120));
  const over1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('desktop tanpa overflow horizontal', over1 <= 1, String(over1));
  const tblScrollable = await page.evaluate(() => {
    const w = document.querySelector('#tblBulanan');
    return w ? w.scrollWidth > w.clientWidth : false;
  });
  ok('tabel bulanan punya area gulir sendiri', tblScrollable);

  /* ---------- antrean: 2 tombol aksi ---------- */
  await page.goto(base + '/iuran/antrean');
  ok('tombol Posting ke BKU ada', await page.locator('button:has-text("Posting ke BKU")').count() >= 1);
  ok('tombol Hanya Simpan Data (Non-BKU) ada', await page.locator('button:has-text("Hanya Simpan Data (Non-BKU)")').count() >= 1);
  await page.click('button:has-text("Tinjau / Edit")');
  const modal = page.locator('.modal.show').first();
  ok('modal tinjau terbuka', await modal.isVisible());
  ok('modal punya 2 aksi utama', await modal.locator('button:has-text("Posting ke BKU")').count() === 1
    && await modal.locator('button:has-text("Hanya Simpan Data (Non-BKU)")').count() === 1);
  ok('modal punya pilihan kode akun', await modal.locator('select[name=coa_id]').count() === 1);
  await page.click('.modal.show [data-close]');
  await page.waitForTimeout(150);

  /* ---------- catatan pegawai ---------- */
  await page.goto(base + '/catatan-pegawai');
  ok('form catatan: nama otomatis (tanpa input teks nama)', await page.locator('input[name=nama]').count() === 0
    && /Bendahara Utama/.test(await page.locator('.catatan-locked-nama').innerText()));
  await page.fill('textarea[name=pesan]', 'Nominal potongan BPJS pada slip saya keliru, mohon diperiksa.');
  await Promise.all([page.waitForNavigation(), page.click('form#fCatatan button.btn-primary')]);
  ok('catatan terkirim & muncul di daftar', /Nominal potongan BPJS/.test(await page.locator('#tblCatatan').innerText()));
  ok('catatan tersimpan dengan nama sesi', /Bendahara Utama/.test(await page.locator('#tblCatatan').innerText()));

  /* ---------- backup menyeluruh ---------- */
  await page.goto(base + '/backup');
  ok('tombol Export Database ada', await page.locator('a[href="/backup/export-database"]').count() === 1);
  ok('tombol Download Source ada', await page.locator('a[href="/backup/download-source"]').count() === 1);
  ok('kartu konfigurasi .env ada', /APP_MEDIA_TOKEN/.test(await page.locator('table.env-tbl').innerText()));
  await ctx.close();

  /* ---------- mobile 390px ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(String(e.message)));
  await p2.goto(base + '/login');
  await p2.fill('input[name=email]', 'admin@sekolah.sch.id');
  await p2.fill('input[name=password]', 'admin123');
  await Promise.all([p2.waitForNavigation(), p2.click('button[type=submit]')]);
  for (const u of ['/iuran/bulanan', '/iuran/antrean', '/catatan-pegawai', '/backup']) {
    await p2.goto(base + u);
    const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow ${u}`, over <= 1, String(over));
  }
  await ctx2.close();
  await browser.close();

  ok('tanpa error JS di semua halaman uji', errors.length === 0, errors.slice(0, 3).join(' | '));

  srv.kill(); db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 17 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1200)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
