'use strict';
/* UI ronde 20 (Playwright): halaman Pengaturan Backup Google Drive
   — layout, form kredensial & Folder ID, simpan lewat UI, menu sidebar,
     mobile 390px tanpa overflow, tanpa error JS. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3692;
const DB = process.env.R20U_DB || path.join(os.tmpdir(), 'smk-r20u-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  db.prepare("UPDATE settings SET v='SMK PGRI CIKONENG' WHERE k='sekolah_nama'").run();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  /* login */
  await page.goto(base + '/login');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  // login multi-tenant: kode sekolah wajib diisi pada form
  await page.fill('input[name=kode]', 'SK01').catch(() => {});
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);

  /* halaman */
  const resp = await page.goto(base + '/pengaturan-backup');
  ok('halaman pengaturan backup terbuka', resp.status() === 200, 'status ' + resp.status());
  ok('judul halaman benar', /Pengaturan Backup/.test(await page.locator('h1').first().innerText()));
  const kpiCount = await page.locator('.kpi').count();
  ok('4 kartu status integrasi', kpiCount === 4, 'n=' + kpiCount);
  ok('menu sidebar "Pengaturan Backup" tampil', (await page.locator('a[href$="/pengaturan-backup"]').first().isVisible()));
  const taBox = await page.locator('textarea[name=gdrive_credentials]').boundingBox();
  ok('kolom kredensial JSON cukup besar', taBox && taBox.height >= 120, JSON.stringify(taBox));
  ok('kolom Folder ID tersedia', await page.locator('input[name=gdrive_folder_id]').isVisible());
  ok('jadwal default 06:00 & 15:00 terisi', (await page.inputValue('input[name=gdrive_times]')) === '06:00,15:00');
  ok('retensi default 30 hari', (await page.inputValue('input[name=gdrive_retensi_hari]')) === '30');
  ok('sakelar jadwal otomatis aktif', await page.isChecked('input[name=gdrive_auto]'));
  ok('tombol backup manual nonaktif saat belum dikonfigurasi',
    await page.locator('button:has-text("Backup & Sinkronisasi Manual")').isDisabled());
  ok('panduan langkah setup tampil', /Google Cloud Console/.test(await page.locator('main').innerText()));

  /* simpan lewat UI */
  await page.fill('input[name=gdrive_folder_id]', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  const before = await page.inputValue('input[name=gdrive_retensi_hari]');
  await page.fill('input[name=gdrive_retensi_hari]', '45');
  await Promise.all([page.waitForNavigation(), page.click('button.btn-primary:has-text("Simpan Pengaturan")')]);
  ok('simpan menampilkan pesan sukses', /Pengaturan backup disimpan/.test(await page.locator('main').innerText()));
  const row = db.prepare("SELECT v FROM settings WHERE k='gdrive_folder_id'").get();
  ok('Folder ID tersimpan dari UI', row.v === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', row.v);
  ok('retensi tersimpan dari UI', db.prepare("SELECT v FROM settings WHERE k='gdrive_retensi_hari'").get().v === '45');
  ok('folder ID tampil di kartu status', /1AbCdEfGhIjKlMn/.test(await page.locator('main').innerText()));

  /* kembali ke 30 hari agar sesuai kebijakan */
  await page.fill('input[name=gdrive_retensi_hari]', before || '30');
  await Promise.all([page.waitForNavigation(), page.click('button.btn-primary:has-text("Simpan Pengaturan")')]);

  /* riwayat kosong */
  ok('riwayat kosong punya penjelasan', /Belum ada riwayat backup cloud/.test(await page.locator('main').innerText()));

  await page.screenshot({ path: path.join(os.tmpdir(), 'ui-cloud-desktop.png'), fullPage: true });

  const over1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('desktop tanpa overflow horizontal', over1 <= 1, String(over1));
  await ctx.close();

  /* mobile 390px */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(String(e.message)));
  await p2.goto(base + '/login');
  await p2.fill('input[name=email]', 'admin@sekolah.sch.id');
  // login multi-tenant: kode sekolah wajib diisi pada form
  await p2.fill('input[name=kode]', 'SK01').catch(() => {});
  await p2.fill('input[name=password]', 'admin123');
  await Promise.all([p2.waitForNavigation(), p2.click('button[type=submit]')]);
  await p2.goto(base + '/pengaturan-backup');
  const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('mobile 390px tanpa overflow horizontal', over <= 1, String(over));
  ok('form tetap dapat dipakai di mobile', await p2.locator('textarea[name=gdrive_credentials]').isVisible());
  await p2.screenshot({ path: path.join(os.tmpdir(), 'ui-cloud-mobile.png'), fullPage: true });
  await ctx2.close();
  await browser.close();

  ok('tanpa error JS di halaman uji', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('screenshot: ' + path.join(os.tmpdir(), 'ui-cloud-desktop.png'));

  srv.kill(); db.close();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (e) { } }
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 20 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1200)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
