'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI ronde 31 (Playwright) — pratinjau judul tab di menu Portal Publik:
   judul biasa & judul saat tautan bertoken (placeholder {judul}), lalu
   hasil nyatanya di <title> portal publik; mobile 390px; tanpa error JS. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui31-'));
const PORT = 3663;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT, DB_PATH: path.join(TMP, 'k.sqlite'),
    SAAS_DB_PATH: path.join(TMP, 's.db'), DEMO_DB_PATH: path.join(TMP, 'd.sqlite')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(base + '/login');
  await page.fill('input[name=kode]', 'SK01');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('form button')]);
  await page.waitForTimeout(400);

  /* ---------- 1. form & pratinjau ---------- */
  await page.goto(base + '/portal-publik');
  await page.waitForTimeout(400);
  const inTitle = page.locator('[data-pv-title]');
  const inToken = page.locator('[data-pv-token]');
  const tab = page.locator('[data-pv-tab]');
  const tokTab = page.locator('[data-pv-tokentab]');
  ok('isian judul tab biasa ada', (await inTitle.count()) === 1);
  ok('isian judul tab bertoken ada', (await inToken.count()) === 1);
  ok('pratinjau tab biasa tampil', (await tab.count()) === 1);
  ok('pratinjau tab bertoken tampil', (await tokTab.count()) === 1 && (await page.locator('.pv-token').isVisible()));

  await page.fill('[data-pv-title]', 'Kewajiban Iuran');
  await page.waitForTimeout(200);
  ok('pratinjau tab biasa mengikuti isian', /^Kewajiban Iuran · /.test(await tab.innerText()), await tab.innerText());
  ok('pratinjau tab bertoken ikut berubah (kosong = sama)', (await tokTab.innerText()) === (await tab.innerText()), await tokTab.innerText());

  await page.fill('[data-pv-token]', 'Rincian {judul}');
  await page.waitForTimeout(250);
  ok('placeholder {judul} diganti pada pratinjau', /^Rincian Kewajiban Iuran · /.test(await tokTab.innerText()), await tokTab.innerText());
  ok('pratinjau tab biasa tetap tanpa prefix', /^Kewajiban Iuran · /.test(await tab.innerText()), await tab.innerText());
  ok('hint judul bertoken ikut diperbarui', /^Rincian Kewajiban Iuran · /.test(await page.locator('[data-pv-tokenhint]').innerText()),
    await page.locator('[data-pv-tokenhint]').innerText());

  /* ---------- 2. simpan & cek <title> nyata ---------- */
  await Promise.all([page.waitForNavigation(), page.click('#publikasiPortal button.btn-primary')]);
  await page.waitForTimeout(500);
  ok('simpan teks portal berhasil', /disimpan/i.test(await page.locator('main.content').innerText()),
    (await page.locator('main.content').innerText()).slice(0, 120));

  const schoolName = (await page.locator('.school-title').count()) ? '' : '';
  await page.goto(base + '/portal');
  await page.waitForTimeout(400);
  const tNoToken = await page.title();
  ok('judul tab portal tanpa token = judul biasa · sekolah', /^Kewajiban Iuran · /.test(tNoToken), tNoToken);
  ok('og:title sama dengan judul tab', (await page.getAttribute('meta[property="og:title"]', 'content')) === tNoToken,
    await page.getAttribute('meta[property="og:title"]', 'content'));
  ok('twitter:title tersedia', (await page.getAttribute('meta[name="twitter:title"]', 'content')) === tNoToken);
  ok('halaman publik tidak noindex', (await page.locator('meta[name="robots"]').count()) === 0);

  /* ---------- 3. mobile 390px ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/portal-publik');
  await page.waitForTimeout(400);
  ok('mobile 390px: halaman Portal Publik tanpa overflow',
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1),
    String(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)));
  ok('mobile: pratinjau tab bertoken tetap terlihat', await page.locator('[data-pv-tokentab]').isVisible());
  await page.setViewportSize({ width: 1360, height: 950 });

  /* ---------- 4. JS tidak menimpa document.title ---------- */
  await page.goto(base + '/portal');
  await page.waitForTimeout(600);
  const before = await page.title();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  ok('judul tab tidak berubah setelah JS halaman berjalan', (await page.title()) === before, `${before} → ${await page.title()}`);

  ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek UI ronde 31 lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
    const errs = log.split('\n').filter(l => /\[ERROR\]/.test(l));
    if (errs.length) console.log('log server:\n' + errs.slice(0, 6).join('\n'));
  }
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
