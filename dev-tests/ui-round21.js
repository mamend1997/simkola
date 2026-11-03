'use strict';
/* UI Ronde 21 (Playwright) — tema, branding, manajer menu, beasiswa, petunjuk pengguna */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const PORT = Number(process.env.R21UI_PORT || 3701);
const DB = process.env.R21UI_DB || path.join(os.tmpdir(), 'smk-r21ui-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, DEMO_DB_PATH: DB + '-demo' }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (n, c, e = '') => { results.push({ n, c: !!c }); if (!c) console.log('FAIL', n, e); };

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await new Promise(r => setTimeout(r, 150)); }
  const browser = await chromium.launch();
  const errors = [];
  let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const go = async (p) => { await page.goto(base + p, { waitUntil: 'domcontentloaded' }); };

  await go('/login');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  // login multi-tenant: kode sekolah wajib diisi pada form
  await page.fill('input[name=kode]', 'SK01').catch(() => {});
  await page.fill('input[name=password]', 'admin123');
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  ok('login berhasil', /Dashboard|Ringkasan/.test(await page.title() + await page.content()));

  /* ---------- dashboard: satu grafik SPP ---------- */
  await go('/');
  ok('hanya satu kartu grafik SPP', (await page.locator('text=Tren Penerimaan SPP per Bulan').count()) === 1,
    await page.locator('text=Tren Penerimaan SPP per Bulan').count());
  ok('grafik SPP tidak dirender ganda', (await page.locator('svg[aria-label="Tren penerimaan SPP per bulan"]').count()) <= 1);
  ok('tanpa overflow horizontal (dashboard)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));

  /* ---------- 1. tema & branding ---------- */
  await go('/tema');
  ok('halaman tema tampil', (await page.locator('[data-tema-pick]').count()) === 1);
  await page.evaluate(() => {
    const pick = document.querySelector('[data-tema-pick]');
    pick.value = '#4f46e5';
    pick.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const variabel = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--o-500'));
  ok('pratinjau warna langsung berubah', /hsl\(243|hsl\(24[0-9]/.test(variabel), variabel);
  await page.fill('input[name=app_nama]', 'SIMKEU Sekolah Uji');
  await page.click('form[action$="/tema"] button.btn-primary');
  await page.waitForLoadState('domcontentloaded');
  ok('nama aplikasi tersimpan & tampil di sidebar', /SIMKEU Sekolah Uji/.test(await page.content()));

  /* ---------- 2. manajer menu: geser baris + ubah judul + simpan ---------- */
  await go('/tampilan-menu');
  ok('manajer menu memuat baris drag', (await page.locator('tr.drag-row').count()) > 20);
  const grupIuran = page.locator('.menu-group[data-groupid="iuran"]');
  const sppRow = grupIuran.locator('tr.drag-row[data-href="/spp"]');
  await sppRow.locator('[data-row-up]').click();
  await sppRow.locator('[data-row-up]').click();
  const labelInput = sppRow.locator('input.menu-label-input');
  await labelInput.fill('SPP (Menu Uji)');
  // tombol "geser kelompok" juga harus berfungsi
  await page.locator('.menu-group[data-groupid="piutang"] [data-group-up]').click();
  await page.click('#fMenu button.btn-primary');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  const html = await page.content();
  ok('judul menu kustom tersimpan', /SPP \(Menu Uji\)/.test(html));
  const urutan = await page.evaluate(() => {
    const nav = document.querySelector('nav.nav');
    return Array.from(nav.querySelectorAll('a[data-nav-href]')).map(a => a.getAttribute('data-nav-href'));
  });
  const grupItems = urutan.filter(h => h === '/' || h.startsWith('/iuran') || h === '/spp');
  ok('menu SPP sudah berpindah posisi (tidak lagi paling bawah)', urutan.indexOf('/spp') >= 0 &&
    urutan.indexOf('/spp') < urutan.indexOf('/iuran/antrean'), urutan.slice(0, 14).join(','));

  /* ---------- 3. beasiswa: state tidak reset saat filter kelas ---------- */
  const api = page.context().request;
  await api.post(base + '/kelas/save', { form: { nama: 'X Uji', tingkat: 'X' } });
  const kelasDb = await api.get(base + '/kelas');
  await api.post(base + '/siswa/save', { form: { nama: 'Siswa Uji Satu', nisn: '9001', jenis_kelamin: 'L', status: 'aktif', kelas_nama: 'X Uji' } });
  await api.post(base + '/siswa/save', { form: { nama: 'Siswa Uji Dua', nisn: '9002', jenis_kelamin: 'P', status: 'aktif', kelas_nama: 'X Uji' } });
  await api.post(base + '/iuran/save', { form: { nama: 'SPP Uji', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '90000', aktif: '1' } });
  await go('/beasiswa');
  const beaForm = page.locator('#fBeasiswa');
  await beaForm.locator('input[name=nama]').fill('Beasiswa Uji UI');
  const grupBoxes = page.locator('input[data-bea-group]');
  if (await grupBoxes.count()) {
    await grupBoxes.nth(0).check();
  }
  await page.selectOption('[data-bea-kelas]', { index: 0 });
  await page.waitForTimeout(200);
  ok('nama beasiswa TIDAK hilang setelah memilih kelas',
    (await beaForm.locator('input[name=nama]').inputValue()) === 'Beasiswa Uji UI');
  const masihCentang = await grupBoxes.count() ? await grupBoxes.nth(0).isChecked() : false;
  ok('pilihan grup iuran TIDAK hilang setelah memilih kelas', masihCentang);
  ok('urutan kartu: detail → siswa → rekap',
    (await page.locator('[data-bea-step="1"]').count()) === 1 &&
    (await page.evaluate(() => {
      const a = document.querySelector('[data-bea-step="1"]').getBoundingClientRect().top;
      const b = document.querySelector('[data-bea-step="2"]').getBoundingClientRect().top;
      const c = document.querySelector('[data-bea-step="3"]').getBoundingClientRect().top;
      return a < b && b < c;
    })));
  ok('tanpa overflow horizontal (beasiswa)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));

  /* ---------- 4. petunjuk pengguna (READ ONLY sejak ronde 23) ---------- */
  await go('/petunjuk');
  ok('halaman petunjuk TANPA form tambah (read-only)', (await page.locator('#fPanduan').count()) === 0);
  ok('halaman petunjuk menampilkan pencarian', (await page.locator('input[name=q]').count()) === 1);
  ok('ada penanda baca saja', /hanya baca|Baca saja/i.test(await page.content()));

  /* ---------- 5. mobile 390px ---------- */
  await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push(String(e.message)));
  await go('/login');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  // login multi-tenant: kode sekolah wajib diisi pada form
  await page.fill('input[name=kode]', 'SK01').catch(() => {});
  await page.fill('input[name=password]', 'admin123');
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  for (const p of ['/beasiswa', '/tampilan-menu', '/petunjuk', '/tema', '/spp']) {
    await go(p);
    await page.waitForTimeout(200);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    ok('tanpa overflow horizontal 390px: ' + p, w <= 392, w);
  }
  ok('tanpa error JS', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.close();
  await browser.close();
  const pass = results.filter(x => x.c).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 21 lulus ===`);
  if (pass !== results.length) console.log('GAGAL:', results.filter(x => !x.c).map(x => x.n).join(', '));
  if (/\[ERROR\]/.test(log)) console.log(log.slice(-1500));
  srv.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
