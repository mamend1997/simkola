'use strict';
/* UI ronde 26 — identitas resmi, portal publik, desain cetak, mode gelap,
   Database Manager & preset menu Super Admin, tanpa overflow mobile / error JS */
const { spawn } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui26-'));
const PORT = 3937;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT, DB_PATH: path.join(TMP, 'k.sqlite'),
    SAAS_DB_PATH: path.join(TMP, 's.db'), DEMO_DB_PATH: path.join(TMP, 'd.sqlite'),
    SAAS_ADMIN_PASSWORD: 'SuperAdmin2026!', SAAS_ADMIN_EMAIL: 'super@simkeu.id'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, c, x = '') => { out.push(c); console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  → ' + x)); };

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const errs = [];
  const b = await chromium.launch();

  /* ---------- sekolah ---------- */
  let page = await b.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '/login');
  await page.fill('input[name=kode]', 'SK01');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]')]);
  await page.waitForTimeout(400);
  ok('login sekolah', page.url() === base + '/', page.url());

  await page.goto(base + '/sekolah');
  await page.waitForTimeout(250);
  ok('identitas: field NPSN tampil', (await page.locator('input[name=sekolah_npsn]').count()) === 1);
  ok('identitas: bentuk pendidikan dropdown 9 opsi', (await page.locator('select[name=sekolah_bentuk] option').count()) === 10);
  ok('identitas: status Negeri/Swasta radio', (await page.locator('input[name=sekolah_status]').count()) === 2);
  ok('identitas: dua bagian form', /Informasi Umum/.test(await page.content()) && /Legalitas/.test(await page.content()));
  ok('identitas: kop & kuitansi tidak lagi di sini', (await page.locator('textarea[name=kop_baris]').count()) === 0
    && (await page.locator('input[name=kwitansi_w_mm]').count()) === 0);
  ok('identitas: tanpa overflow desktop', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);
  // simpan NPSN lewat UI
  await page.fill('input[name=sekolah_npsn]', '20211525');
  await page.selectOption('select[name=sekolah_bentuk]', 'SMK');
  await page.locator('label[for="st1"]').click();
  await page.fill('input[name=sekolah_telp]', '(0265) 773258');
  await page.fill('input[name=sekolah_email]', 'info@smkpgricikoneng.sch.id');
  await page.fill('input[name=sekolah_website]', 'https://smkpgricikoneng.sch.id');
  const fIdent = page.locator('form[action="/sekolah"]').first();
  await Promise.all([page.waitForNavigation(), fIdent.locator('button.btn-primary').click()]);
  await page.waitForTimeout(250);
  ok('identitas: simpan via UI berhasil', /berhasil disimpan|Informasi Umum/.test(await page.content()));
  ok('identitas: pratinjau kop tampil', (await page.locator('.doc .kop').count()) === 1);

  /* ---------- portal publik ---------- */
  await page.goto(base + '/portal-publik');
  await page.waitForTimeout(250);
  ok('portal publik: 3 slug', (await page.locator('input[name=portal_slug]').count()) >= 1
    && (await page.locator('input[name=portal_pegawai_slug]').count()) === 1
    && (await page.locator('input[name=portal_slip_slug]').count()) === 1);
  ok('portal publik: custom domain + opsi DNS', (await page.locator('input[name=custom_domain]').count()) === 1
    && /Opsi 1/.test(await page.content()) && /Opsi 2/.test(await page.content()));
  ok('portal publik: A Record direkomendasikan', /A Record \(Direkomendasikan\)/.test(await page.content()));
  ok('portal publik: tanpa overflow desktop', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1);

  /* ---------- desain templat cetak ---------- */
  await page.goto(base + '/desain-cetak');
  await page.waitForTimeout(250);
  ok('desain cetak: kop surat ada', (await page.locator('textarea[name=kop_baris]').count()) === 1);
  ok('desain cetak: ukuran kuitansi ada', (await page.locator('input[name=kwitansi_w_mm]').count()) === 1);
  ok('desain cetak: pratinjau kop tampil', (await page.locator('.doc .kop').count()) === 1);

  /* ---------- mode gelap ---------- */
  await page.goto(base + '/tema');
  await page.waitForTimeout(250);
  ok('tema: pilihan mode gelap ada', (await page.locator('input[name=mode_tema][value=dark]').count()) === 1);
  await page.locator('label[for="modeDark"]').click();
  const fTema = page.locator('form[action="/tema"]').first();
  await Promise.all([page.waitForNavigation(), fTema.locator('button.btn-primary').click()]);
  await page.waitForTimeout(300);
  await page.goto(base + '/');
  await page.waitForTimeout(300);
  ok('mode gelap aktif di html', (await page.locator('html').getAttribute('data-mode')) === 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('mode gelap: latar belakang gelap', /rgb\(1[0-9], 1[0-9], (2|3)[0-9]\)/.test(bg), bg);
  ok('mode gelap: kartu tetap terbaca (warna teks terang)',
    await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.card') || document.body).color; const m = c.match(/rgb\((\d+), (\d+), (\d+)\)/); return !!m && (+m[1] + +m[2] + +m[3]) > 300; }));
  await page.goto(base + '/tema');
  await page.locator('label[for="modeLight"]').click();
  const fTema2 = page.locator('form[action="/tema"]').first();
  await Promise.all([page.waitForNavigation(), fTema2.locator('button.btn-primary').click()]);
  await page.waitForTimeout(250);
  await page.goto(base + '/');
  ok('kembali ke mode terang', (await page.locator('html').getAttribute('data-mode')) === 'light');

  /* ---------- mobile: halaman baru tanpa overflow ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const u of ['/sekolah', '/portal-publik', '/desain-cetak', '/tema', '/backup']) {
    await page.goto(base + u);
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow ${u}`, over <= 1, String(over));
  }
  await page.close();

  /* ---------- Super Admin ---------- */
  page = await b.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '/super-admin/login');
  await page.fill('input[name=email]', 'super@simkeu.id');
  await page.fill('input[name=password]', 'SuperAdmin2026!');
  await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]')]);
  await page.waitForTimeout(400);
  ok('login Super Admin', page.url() === base + '/super-admin', page.url());
  ok('menu Backup & Restore Database System tampil', /Backup &amp; Restore Database System/.test(await page.content())
    || /Backup & Restore Database System/.test(await page.content()));
  ok('menu Database Manager tampil', /Database Manager/.test(await page.content()));

  await page.goto(base + '/super-admin/backup');
  await page.waitForTimeout(300);
  ok('panel backup: tombol restore membuka modal', await page.locator('button[data-open="mRestoreDb"]').count() === 1);
  ok('panel backup: download source + ZIP', (await page.locator('a[href="/super-admin/backup/download-source"]').count()) === 1
    && (await page.locator('a[href="/super-admin/backup/download-zip"]').count()) === 1);

  await page.goto(base + '/super-admin/database');
  await page.waitForTimeout(300);
  ok('database manager: pemilih database & konsol SQL', /Pemilih Database/.test(await page.content())
    && (await page.locator('textarea[name=sql]').count()) === 1);
  await page.goto(base + '/super-admin/database/tabel?scope=saas&tabel=tenants');
  await page.waitForTimeout(300);
  ok('database manager: tabel & sel dapat diedit', (await page.locator('.cell-in').count()) > 0);
  await page.goto(base + '/super-admin/database');
  await page.fill('textarea[name=sql]', 'SELECT COUNT(*) jumlah FROM tenants');
  await Promise.all([page.waitForNavigation(), page.click('form[action="/super-admin/database/query"] button.btn-primary')]);
  await page.waitForTimeout(300);
  ok('konsol SQL menampilkan hasil query', /Hasil Query/.test(await page.content()) && /jumlah/.test(await page.content()));

  await page.goto(base + '/super-admin/menu-default');
  await page.waitForTimeout(300);
  ok('default tampilan menu: ceklis & urutan', (await page.locator('input[name=show]').count()) > 20
    && (await page.locator('input[name=ord_0]').count()) === 1);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const u of ['/super-admin/database', '/super-admin/database/tabel?scope=saas&tabel=tenants', '/super-admin/menu-default', '/super-admin/backup']) {
    await page.goto(base + u);
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow ${u}`, over <= 1, String(over));
  }
  ok('tanpa error JavaScript di semua halaman uji', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
  await b.close();

  const pass = out.filter(Boolean).length;
  console.log(`\n${pass}/${out.length} cek UI ronde 26 lulus`);
  srv.kill();
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
