'use strict';
/* pemeriksaan UI sementara: portal super admin & halaman layanan tenant */
const { spawn } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs');
const { chromium } = require('playwright');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uick-'));
const PORT = 3989;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: path.join(TMP, 'k.sqlite'), SAAS_DB_PATH: path.join(TMP, 's.db'), DEMO_DB_PATH: path.join(TMP, 'd.sqlite'), SAAS_ADMIN_PASSWORD: 'SuperAdmin2026!' },
  stdio: ['ignore', 'pipe', 'pipe']
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, c, x = '') => { out.push(c); console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  → ' + x)); };

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break } catch (e) { } await sleep(150); }
  await fetch(base + '/register', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nama: 'SMP Negeri 2 Cikoneng', alamat: 'Jl. Melati 5', kepala: 'Dra. Ani', admin_nama: 'Bendahara', admin_email: 'admin@smpn2.sch.id', admin_password: 'rahasia123', admin_password2: 'rahasia123', telp: '08123', paket: 'standard' }).toString(),
    redirect: 'manual'
  });

  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(base + '/super-admin/login');
  await page.fill('input[name=email]', 'super@simkeu.id');
  await page.fill('input[name=password]', 'SuperAdmin2026!');
  await page.click('form button');
  await page.waitForTimeout(600);
  ok('login super admin lewat UI', page.url().endsWith('/super-admin'), page.url());
  ok('KPI dashboard tampil', await page.locator('.sa-kpi').count() >= 4);
  ok('tabel sekolah memuat sekolah baru', (await page.content()).includes('SMP Negeri 2 Cikoneng'));

  await page.goto(base + '/super-admin/sekolah');
  await page.waitForTimeout(300);
  await page.click('[data-open="mTambahSekolah"]');
  await page.waitForTimeout(350);
  ok('modal tambah sekolah terbuka', await page.locator('#mTambahSekolah.show').count() === 1);
  const formFields = await page.locator('#mTambahSekolah input[name=nama]').count();
  ok('modal berisi field lengkap', formFields === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  for (const u of ['/super-admin', '/super-admin/sekolah', '/super-admin/pembayaran', '/super-admin/qris', '/super-admin/backup']) {
    await page.goto(base + u);
    await page.waitForTimeout(250);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal desktop ' + u, ov <= 1, 'overflow ' + ov);
  }

  // detail sekolah + fitur
  await page.goto(base + '/super-admin/sekolah/2');
  await page.waitForTimeout(300);
  ok('detail sekolah: kontrol fitur ada', await page.locator('input[name=fitur]').count() >= 20);
  ok('detail sekolah: sakelar lifetime ada', (await page.content()).includes('Akses Lifetime'));

  // mobile
  await page.setViewportSize({ width: 390, height: 844 });
  for (const u of ['/super-admin', '/super-admin/sekolah', '/super-admin/pembayaran', '/super-admin/qris', '/super-admin/backup']) {
    await page.goto(base + u);
    await page.waitForTimeout(250);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow mobile ' + u, ov <= 1, 'overflow ' + ov);
  }
  await page.close();

  // tenant
  const p2 = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  p2.on('pageerror', e => errs.push(String(e)));
  await p2.goto(base + '/login');
  await p2.fill('input[name=kode]', 'SK02');
  await p2.fill('input[name=email]', 'admin@smpn2.sch.id');
  await p2.fill('input[name=password]', 'rahasia123');
  await p2.click('form button');
  await p2.waitForTimeout(700);
  ok('login sekolah lewat UI', p2.url() === base + '/', p2.url());
  ok('dashboard memuat kartu Info Layanan', await p2.locator('#infoLayanan').count() === 1);
  ok('menu Info Layanan ada di sidebar', await p2.locator('a[href="/info-layanan"]').count() >= 1);

  await p2.goto(base + '/info-layanan');
  await p2.waitForTimeout(300);
  ok('info layanan: kartu status', (await p2.content()).includes('Info Layanan Sekolah'));
  ok('info layanan: form backup email', await p2.locator('input[name=mail_to]').count() === 1);
  ok('info layanan: tombol uji & backup', await p2.locator('form[action="/info-layanan/mail/backup"] button').count() === 1);

  await p2.goto(base + '/perpanjang');
  await p2.waitForTimeout(300);
  ok('checkout: pilihan durasi', await p2.locator('input[name=durasi]').count() === 2);
  ok('checkout: input bukti transfer', await p2.locator('input[data-b64="bukti_b64"]').count() === 1);

  for (const u of ['/info-layanan', '/perpanjang', '/']) {
    await p2.setViewportSize({ width: 390, height: 844 });
    await p2.goto(base + u);
    await p2.waitForTimeout(250);
    const ov = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow mobile ' + u, ov <= 1, 'overflow ' + ov);
  }
  ok('tanpa error JavaScript', errs.length === 0, errs.join(' | '));
  await p2.close();
  await b.close();
  console.log(`\n${out.filter(Boolean).length}/${out.length} cek UI lulus`);
  srv.kill();
  process.exit(out.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
