'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* ==================================================================
   UI RONDE 35 (Playwright) — sub-judul aplikasi ("SISTEM KEUANGAN")
   1. Akun sekolah: field di Tema & Branding, tersimpan & langsung
      tampil pada bilah samping setelah disimpan.
   2. Presedence: isian sekolah → default Branding Sistem → bawaan.
   3. Akun Super Admin: field di Branding Sistem + pratinjau.
   4. Mobile 390px tanpa overflow & tanpa error JS.
   ================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r35u-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3722;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB,
    DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: 'SuperUjiR35!'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  let page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  /* ============ login sekolah ============ */
  await page.goto(base + '/login');
  await page.fill('input[name=kode]', 'SK01');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);

  // .brand-sub memakai CSS text-transform:uppercase → bandingkan case-insensitive
  const subNow = async () => (await page.locator('.sidebar .brand-sub').innerText()).trim();
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  ok('bilah samping menampilkan "SISTEM KEUANGAN" (bawaan)', same(await subNow(), 'Sistem Keuangan'), await subNow());

  /* ============ 1. sekolah mengubah lewat menu Tema & Branding ============ */
  await page.goto(base + '/tema');
  const field = page.locator('input[name=app_sub]');
  ok('field Sub-Judul tersedia di Tema & Branding', await field.count() === 1);
  ok('field awalnya kosong (ikuti default sistem)', (await field.inputValue()) === '');
  ok('hint menyebut default dari Super Admin', /default dari Super Admin/i.test(await page.locator('form[action$="/tema"]').innerText()));

  await field.fill('Sistem Informasi Keuangan Sekolah');
  await Promise.all([page.waitForNavigation(), page.click('form[action$="/tema"] button.btn-primary')]);
  ok('simpan berhasil (pesan sukses)', /disimpan/i.test(await page.locator('main.content').innerText()));
  ok('bilah samping langsung memakai isian sekolah', same(await subNow(), 'Sistem Informasi Keuangan Sekolah'), await subNow());
  ok('nilai tersimpan saat halaman dibuka lagi',
    (await page.goto(base + '/tema')) && (await page.locator('input[name=app_sub]').inputValue()) === 'Sistem Informasi Keuangan Sekolah');

  /* ============ 2. Super Admin: default sistem ============ */
  // Super Admin butuh tab kedua → pakai browser instance TERPISAH (batas 1 tab/instance)
  const saBrowser = await chromium.launch();
  const saCtx = await saBrowser.newContext({ viewport: { width: 1280, height: 950 } });
  const saPage = await saCtx.newPage();
  saPage.on('pageerror', e => errors.push(String(e.message)));
  await saPage.goto(base + '/super-admin/login');
  await saPage.fill('input[name=email]', 'super@simkeu.id');
  await saPage.fill('input[name=password]', 'SuperUjiR35!');
  // tombol login Super Admin tidak memakai atribut type → pilih lewat kelas
  await Promise.all([saPage.waitForNavigation(), saPage.click('form[action$="/super-admin/login"] button')]);
  await saPage.goto(base + '/super-admin/branding');
  const saField = saPage.locator('input[name=saas_sub]');
  ok('Super Admin: field sub-judul default ada di Branding Sistem', await saField.count() === 1);
  ok('Super Admin: nilai awal = "Sistem Keuangan"', (await saField.inputValue()) === 'Sistem Keuangan', await saField.inputValue());
  await saField.fill('Sistem Administrasi Sekolah');
  await Promise.all([saPage.waitForNavigation(), saPage.click('form[action$="/super-admin/branding"] button.btn-primary')]);
  ok('Super Admin: simpan default berhasil', /disimpan|tersimpan/i.test(await saPage.locator('main').innerText()) || /ok=/.test(saPage.url()), saPage.url());
  // pratinjau memakai CSS uppercase → cocokkan tanpa memandang besar/kecil huruf
  ok('Super Admin: pratinjau menampilkan nilai baru', /sistem administrasi sekolah/i.test(await saPage.locator('main').innerText()));

  await saCtx.close();
  await saBrowser.close();

  /* ============ 3. sekolah mengosongkan → memakai default sistem ============ */
  await page.goto(base + '/tema');
  await page.locator('input[name=app_sub]').fill('');
  await Promise.all([page.waitForNavigation(), page.click('form[action$="/tema"] button.btn-primary')]);
  ok('sekolah tanpa isian memakai default dari Super Admin',
    same(await subNow(), 'Sistem Administrasi Sekolah'), await subNow());
  ok('hint menampilkan default sistem terbaru',
    /default dari Super Admin: Sistem Administrasi Sekolah/i.test(
      (await page.locator('form[action$="/tema"]').innerText()).replace(/\s+/g, ' ')),
    (await page.locator('form[action$="/tema"] .hint').last().innerText()));

  /* ============ 4. isian sekolah menang atas default ============ */
  await page.locator('input[name=app_sub]').fill('Sistem Keuangan Versi Sekolah');
  await Promise.all([page.waitForNavigation(), page.click('form[action$="/tema"] button.btn-primary')]);
  ok('isian sekolah menang atas default sistem', same(await subNow(), 'Sistem Keuangan Versi Sekolah'), await subNow());

  /* ============ 5. mobile 390px ============ */
  await page.close();
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.setViewportSize({ width: 390, height: 820 });
  for (const u of ['/tema', '/']) {
    await page.goto(base + u);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`mobile 390px tanpa overflow ${u}`, over <= 2, String(over));
  }
  ok('mobile: sub-judul tetap terbaca', (await page.locator('.sidebar .brand-sub').innerText()).trim().length > 0);

  ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n=== ${results.filter(x => x.ok).length}/${results.length} cek UI ronde 35 lulus ===`);
  if (results.some(x => !x.ok)) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
  await browser.close();
  try { srv.kill(); } catch (e) { }
  setTimeout(() => process.exit(results.every(x => x.ok) ? 0 : 1), 250);
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
