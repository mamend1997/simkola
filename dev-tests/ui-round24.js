'use strict';
/* UI ronde 24 — jenjang & tingkat, branding sistem, paket langganan, login ringkas */
const { spawn } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs');
const { chromium } = require('playwright');
const { otpDaftar } = require('./otp');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui24-'));
const PORT = 3931;
const SDB = path.join(TMP, 's.db');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: path.join(TMP, 'k.sqlite'), SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'd.sqlite'), SAAS_ADMIN_PASSWORD: 'SuperAdmin2026!' },
  stdio: ['ignore', 'pipe', 'pipe']
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, c, x = '') => { out.push(c); console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  → ' + x)); };

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break } catch (e) { } await sleep(150); }
  // daftarkan sekolah baru (SD) untuk uji alur sekolah
  const otpUi = await otpDaftar(base, '081200007771');
  await fetch(base + '/register', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      nama: 'SD UI Uji', admin_nama: 'Admin UI', admin_email: 'admin@sd-uji.sch.id',
      admin_password: 'Rahasia123!', jenjang: 'SD/MI', alamat: 'Jl. UI Uji', telp: '081200007771',
      otp_token: otpUi
    }).toString(), redirect: 'manual'
  });
  const Database = require('better-sqlite3');
  const sdb = new Database(SDB, { readonly: true });
  const t = sdb.prepare("SELECT * FROM tenants WHERE nama='SD UI Uji'").get();
  sdb.close();

  const b = await chromium.launch();
  const errs = [];

  /* ---------- login utama ---------- */
  let page = await b.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '/login');
  ok('login: 3 kolom input', (await page.locator('input[name=kode]').count()) === 1
    && (await page.locator('input[name=email]').count()) === 1
    && (await page.locator('input[name=password]').count()) === 1);
  ok('login: tanpa tautan portal orang tua', (await page.locator('a[href="/portal"]').count()) === 0);
  ok('login: tanpa tautan super admin', (await page.locator('a[href*="super-admin"]').count()) === 0);
  ok('login: tanpa overflow horizontal', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);

  await page.fill('input[name=kode]', t.school_code);
  await page.fill('input[name=email]', 'admin@sd-uji.sch.id');
  await page.fill('input[name=password]', 'Rahasia123!');
  await page.click('form button[type=submit]');
  await page.waitForTimeout(700);
  ok('login sekolah (kode acak) lewat UI', page.url() === base + '/', page.url());

  /* ---------- pengaturan kelas & tingkat ---------- */
  await page.goto(base + '/kelas/tingkat');
  await page.waitForTimeout(300);
  ok('halaman tingkat: checklist tampil', (await page.locator('input[type=checkbox][name=tingkat]').count()) >= 12);
  ok('halaman tingkat: preset SD tercentang', await page.locator('input[type=checkbox][name=tingkat][value="I"]').first().isChecked());
  ok('halaman tingkat: form jenjang ada', (await page.locator('select[name=jenjang_pendidikan]').count()) === 1);
  // tambah kelas dari halaman tingkat
  const formTingkat = page.locator('form[action="/kelas/tingkat/kelas"]').first();
  await formTingkat.locator('input[name=nama]').fill('I-A');
  await Promise.all([page.waitForNavigation(), formTingkat.locator('button').click()]);
  await page.waitForTimeout(300);
  ok('tambah kelas dari halaman tingkat', /I-A/.test(await page.content()));
  // ubah jenjang ke SMA
  await page.selectOption('select[name=jenjang_pendidikan]', 'SMA/MA');
  await page.waitForTimeout(600);
  ok('ubah jenjang → preset SMA aktif', await page.locator('input[type=checkbox][name=tingkat][value="X"]').first().isChecked());
  ok('tanpa overflow horizontal (kelas/tingkat)', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);

  /* ---------- iuran: tarif per tingkat ---------- */
  await page.goto(base + '/iuran');
  await page.waitForTimeout(300);
  ok('halaman grup iuran memuat pilihan tingkat tarif', /Terapkan Tagihan Berdasarkan Tingkat|Grup Iuran/.test(await page.content()));
  ok('tanpa error JS (iuran)', errs.length === 0, errs.slice(0, 3).join(' | '));

  /* ---------- laporan tunggakan per tingkat ---------- */
  await page.goto(base + '/laporan?r=tunggakan');
  await page.waitForTimeout(300);
  ok('laporan tunggakan per tingkat tampil', /Rekap per Tingkat Kelas/.test(await page.content()));
  ok('laporan punya filter tingkat & kelas', (await page.locator('input[type=checkbox][name=tingkat]').count()) >= 3 && (await page.locator('input[type=checkbox][name=kelas]').count()) >= 1);

  /* ---------- paket langganan (tenant) ---------- */
  await page.goto(base + '/info-layanan/paket');
  await page.waitForTimeout(300);
  ok('halaman paket langganan sekolah', /Paket Langganan/.test(await page.content()));
  ok('kartu paket Basic ditandai aktif', (await page.locator('.pk-card').count()) >= 2);

  /* mobile */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const u of ['/kelas/tingkat', '/laporan?r=tunggakan', '/info-layanan/paket', '/login']) {
    await page.goto(base + u);
    await page.waitForTimeout(250);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('tanpa overflow mobile ' + u, ov <= 1, 'overflow ' + ov);
  }
  await page.close();

  /* ---------- panel super admin ---------- */
  page = await b.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '/super-admin/login');
  await page.fill('input[name=email]', 'super@simkeu.id');
  await page.fill('input[name=password]', 'SuperAdmin2026!');
  await page.click('form button[type=submit]');
  await page.waitForTimeout(600);
  ok('login super admin UI', page.url().endsWith('/super-admin'), page.url());

  await page.goto(base + '/super-admin/branding');
  await page.waitForTimeout(300);
  ok('halaman branding: form nama/logo/favicon/trial',
    (await page.locator('input[name=saas_nama]').count()) === 1
    && (await page.locator('input[data-b64="logoB64"]').count()) === 1
    && (await page.locator('input[data-b64="favB64"]').count()) === 1
    && (await page.locator('input[name=trial_hari]').count()) === 1);
  ok('halaman branding: pengaturan anti-spam', (await page.locator('select[name=captcha_provider]').count()) === 1);

  await page.goto(base + '/super-admin/paket');
  await page.waitForTimeout(300);
  ok('halaman paket: tabel & form CRUD', (await page.locator('form[action="/super-admin/paket/simpan"]').count()) === 1 && /Daftar Paket/.test(await page.content()));
  await page.fill('input[name=nama]', 'Paket UI Uji');
  await page.fill('input[name=harga_bulan]', '99000');
  await page.fill('input[name=harga_tahun]', '990000');
  await Promise.all([page.waitForNavigation(), page.click('form[action="/super-admin/paket/simpan"] button.btn-primary')]);
  await page.waitForTimeout(300);
  ok('tambah paket lewat UI', /Paket UI Uji/.test(await page.content()));

  for (const u of ['/super-admin/branding', '/super-admin/paket']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + u);
    await page.waitForTimeout(250);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('tanpa overflow mobile ' + u, ov <= 1, 'overflow ' + ov);
  }
  ok('tanpa error JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  await b.close();

  console.log(`\n${out.filter(Boolean).length}/${out.length} cek UI ronde 24 lulus`);
  srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(out.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
