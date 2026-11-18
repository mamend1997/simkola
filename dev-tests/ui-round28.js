'use strict';
/* UI ronde 28 (Playwright) — kartu publikasi & teks portal di sisi sekolah
   (sakelar, judul tab, sub-judul, pratinjau langsung), halaman Super Admin
   "Manajemen Custom Slug & Portal Publik" (tabel, dropdown status, modal slug),
   tampilan portal publik di layar HP, tanpa error JavaScript. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui28-'));
const PORT = 3653;
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 's.db');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB, DEMO_DB_PATH: path.join(TMP, 'd.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const schoolName = String((db.prepare("SELECT v FROM settings WHERE k='sekolah_nama'").get() || {}).v || '');
  const ctl = new Database(SAAS_DB);
  const slug0 = String((ctl.prepare('SELECT portal_slug FROM tenants WHERE id=1').get() || {}).portal_slug || '');

  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  async function loginTenant() {
    await page.goto(base + '/login');
    await page.fill('input[name=kode]', 'SK01');
    await page.fill('input[name=email]', 'admin@sekolah.sch.id');
    await page.fill('input[name=password]', 'admin123');
    await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]')]);
    await page.waitForTimeout(350);
  }

  /* ================= 1. TENANT — kartu publikasi & teks portal ================= */
  await loginTenant();
  await page.goto(base + '/portal-publik');
  await page.waitForTimeout(350);
  ok('kartu "Publikasi & Teks Halaman Portal" tampil', (await page.locator('#publikasiPortal').count()) === 1);
  const sw = page.locator('#publikasiPortal input[name=portal_aktif]');
  const swState = page.locator('#publikasiPortal .publ-row').first().locator('.sw-state');
  ok('sakelar publikasi ada & ON', (await sw.count()) === 1 && (await sw.isChecked()));
  ok('tiga sakelar portal tersedia', (await page.locator('#publikasiPortal input[name=portal_pegawai_aktif]').count()) === 1
    && (await page.locator('#publikasiPortal input[name=portal_slip_aktif]').count()) === 1
    && (await page.locator('#publikasiPortal .publ-row').count()) === 3);
  ok('tautan alamat tiap portal tampil', (await page.locator('#publikasiPortal .url-chip').count()) === 3);
  ok('label ON pada sakelar', /ON/.test(await swState.innerText()), await swState.innerText());
  ok('ukuran track sakelar wajar', await page.evaluate(() => {
    const el = document.querySelector('#publikasiPortal .sw-track');
    const b = el.getBoundingClientRect();
    return b.width >= 40 && b.width <= 60 && b.height >= 20 && b.height <= 30;
  }));
  // klik track → sakelar berubah (label OFF)
  await page.locator('#publikasiPortal .publ-row').first().locator('.sw-track').click();
  await page.waitForTimeout(150);
  ok('klik sakelar mengubah nilai & label OFF', !(await sw.isChecked()) && /OFF/.test(await swState.innerText()), await swState.innerText());
  await page.locator('#publikasiPortal .publ-row').first().locator('.sw-track').click();
  await page.waitForTimeout(150);
  ok('sakelar kembali ON', await sw.isChecked());
  /* matikan portal pegawai saja → simpan, lalu pastikan portal siswa tetap 200 */
  await page.locator('#publikasiPortal .publ-row').nth(1).locator('.sw-track').click();
  await Promise.all([page.waitForNavigation(), page.click('#publikasiPortal button.btn-primary')]);
  await page.waitForTimeout(350);
  /* alamat lama dialihkan dulu → ikuti redirect agar status akhir 503 terbaca */
  let peg503 = await fetch(base + '/portal-pegawai', { redirect: 'manual' });
  for (let i = 0; i < 3 && [301, 302, 303, 307, 308].includes(peg503.status); i++) {
    const loc = peg503.headers.get('location') || '';
    if (!loc) break;
    peg503 = await fetch(loc.startsWith('http') ? loc : base + loc, { redirect: 'manual' });
  }
  ok('portal pegawai OFF → 503 setelah simpan', peg503.status === 503, String(peg503.status));
  const siswa200 = await fetch(base + '/portal', { redirect: 'manual' });
  ok('portal siswa tetap dilayani (alamat lama dialihkan ke alamat lengkap)',
    [200, 301, 302, 303, 307, 308].includes(siswa200.status), String(siswa200.status));
  // nyalakan kembali portal pegawai
  await page.goto(base + '/portal-publik');
  await page.waitForTimeout(350);
  await page.locator('#publikasiPortal .publ-row').nth(1).locator('.sw-track').click();
  await Promise.all([page.waitForNavigation(), page.click('#publikasiPortal button.btn-primary')]);
  await page.waitForTimeout(350);
  const pegBack = await fetch(base + '/portal-pegawai', { redirect: 'manual' });
  ok('portal pegawai kembali dilayani', [200, 301, 302, 303, 307, 308].includes(pegBack.status), String(pegBack.status));

  /* pratinjau langsung */
  const pvTab = page.locator('[data-pv-tab]');
  const pvSub = page.locator('[data-pv-subtitle]');
  ok('pratinjau tab menampilkan default + nama sekolah', (await pvTab.innerText()).includes(schoolName),
    await pvTab.innerText());
  await page.fill('input[name=portal_page_title]', 'Tagihan Siswa');
  await page.fill('input[name=portal_subtitle]', 'PORTAL CEK TAGIHAN IURAN SISWA');
  await page.waitForTimeout(200);
  ok('pratinjau tab ikut berubah saat mengetik', (await pvTab.innerText()) === `Tagihan Siswa · ${schoolName}`, await pvTab.innerText());
  ok('pratinjau banner ikut berubah', (await pvSub.innerText()) === 'PORTAL CEK TAGIHAN IURAN SISWA', await pvSub.innerText());
  ok('hint tab browser ikut diperbarui', /Tagihan Siswa · /.test(await page.locator('[data-pv-tabhint]').innerText()));
  ok('batas 60 karakter pada input sub-judul', await page.evaluate(() => {
    const el = document.querySelector('input[name=portal_subtitle]');
    return el && el.getAttribute('maxlength') === '60';
  }));

  /* simpan & cek portal publik */
  await Promise.all([page.waitForNavigation(), page.click('#publikasiPortal button.btn-primary')]);
  await page.waitForTimeout(400);
  ok('simpan publikasi & teks berhasil', /dipublikasikan/i.test(await page.locator('main.content').innerText()),
    (await page.locator('main.content').innerText()).slice(0, 140));
  await page.goto(base + '/portal');
  await page.waitForTimeout(300);
  ok('tab browser portal memakai judul kustom', (await page.title()) === `Tagihan Siswa · ${schoolName}`, await page.title());
  ok('banner portal menampilkan nama sekolah', (await page.locator('.school-title').innerText()) === schoolName);
  ok('banner portal menampilkan sub-judul', (await page.locator('.portal-subtitle').innerText()) === 'PORTAL CEK TAGIHAN IURAN SISWA');
  ok('sub-judul berukuran wajar (tidak mendominasi)', await page.evaluate(() => {
    const el = document.querySelector('.portal-subtitle');
    return el.getBoundingClientRect().height <= 40;
  }));

  /* ================= 2. mobile 390px ================= */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/portal-publik');
  await page.waitForTimeout(350);
  ok('mobile 390px: halaman Portal Publik tanpa overflow', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1),
    String(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)));
  ok('mobile: pratinjau tetap terlihat', await page.locator('[data-portal-preview]').isVisible());
  await page.goto(base + '/portal');
  await page.waitForTimeout(300);
  ok('mobile: banner portal tanpa overflow', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1),
    String(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)));
  ok('mobile: sub-judul tetap terbaca', await page.locator('.portal-subtitle').isVisible());
  await page.setViewportSize({ width: 1360, height: 950 });

  /* ================= 3. SUPER ADMIN ================= */
  await page.goto(base + '/super-admin/login');
  await page.fill('input[name=email]', 'super@simkeu.id');
  await page.fill('input[name=password]', 'SuperAdmin2026!');
  await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]')]);
  await page.waitForTimeout(350);
  ok('sidebar Super Admin memuat menu baru', (await page.locator('a[href="/super-admin/portal-publik"]').count()) >= 1);
  await page.goto(base + '/super-admin/portal-publik');
  await page.waitForTimeout(400);
  ok('judul halaman manajemen slug', /Manajemen Custom Slug/.test(await page.locator('.sa-top h1').innerText()),
    await page.locator('.sa-top h1').innerText());
  ok('tabel menampilkan sekolah', (await page.locator('table tbody tr').count()) >= 1);
  ok('tautan URL slug terlihat', (await page.locator(`a[href="${`/${slug0}/portal`}"]`).count()) >= 1);
  const sel = page.locator('table tbody tr').first().locator('select[name=status]');
  ok('dropdown status akses publik ada', (await sel.count()) === 1);
  ok('opsi status lengkap (aktif/nonaktif/private)', await sel.evaluate(el => ['aktif', 'nonaktif', 'private'].every(v => !!el.querySelector(`option[value="${v}"]`))));
  // ubah status lewat dropdown (auto submit)
  await Promise.all([page.waitForNavigation(), sel.selectOption('nonaktif')]);
  await page.waitForTimeout(400);
  ok('ubah status lewat dropdown tersimpan', /Non-Aktif/.test(await page.locator('main.sa-main').innerText()),
    (await page.locator('main.sa-main').innerText()).slice(0, 160));
  // portal kini tertutup (simulasi pengunjung publik tanpa sesi)
  await page.context().clearCookies();
  const resp404 = await page.goto(base + '/portal');
  ok('portal tertutup untuk publik (404)', resp404.status() === 404, String(resp404.status()));
  ok('halaman 404 menampilkan pesan disembunyikan', /Halaman Tidak Ditemukan/.test(await page.content()));
  // banner peringatan di dashboard sekolah
  await loginTenant();
  await page.goto(base + '/');
  await page.waitForTimeout(400);
  ok('dashboard sekolah menampilkan banner suspend', (await page.locator('#bannerPortalPublik').count()) === 1);
  ok('isi banner menyebut Administrator Pusat', /Administrator Pusat/.test(await page.locator('#bannerPortalPublik').innerText()));

  /* modal edit slug */
  await page.goto(base + '/super-admin/login');
  await page.fill('input[name=email]', 'super@simkeu.id');
  await page.fill('input[name=password]', 'SuperAdmin2026!');
  await Promise.all([page.waitForNavigation(), page.click('form button[type=submit]')]);
  await page.goto(base + '/super-admin/portal-publik');
  await page.waitForTimeout(400);
  await page.locator('button[data-open]', { hasText: 'Slug' }).first().click();
  await page.waitForTimeout(250);
  ok('modal Edit Slug terbuka', await page.locator('#mSlug1').isVisible());
  ok('modal berisi input slug + status + catatan', (await page.locator('#mSlug1 input[name=portal_slug]').count()) === 1
    && (await page.locator('#mSlug1 select[name=status]').count()) === 1
    && (await page.locator('#mSlug1 input[name=note]').count()) === 1);
  await page.fill('#mSlug1 input[name=portal_slug]', 'smkpgri-ui28');
  await page.selectOption('#mSlug1 select[name=status]', 'aktif');
  await Promise.all([page.waitForNavigation(), page.click('#mSlug1 button.btn-primary')]);
  await page.waitForTimeout(400);
  ok('slug baru tersimpan lewat modal', /smkpgri-ui28/.test(await page.locator('main.sa-main').innerText()),
    (await page.locator('main.sa-main').innerText()).slice(0, 160));
  const p200 = await fetch(base + '/smkpgri-ui28/portal-tagihan', { redirect: 'manual' });
  ok('alamat slug baru dapat dibuka (200)', p200.status === 200, String(p200.status));
  /* tombol Hapus Permanen punya konfirmasi */
  ok('tombol Hapus memakai data-confirm', (await page.locator('form[data-confirm]').count()) >= 1);

  /* mobile panel super admin */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/super-admin/portal-publik');
  await page.waitForTimeout(400);
  ok('mobile: panel manajemen tanpa overflow', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 2),
    String(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)));

  await page.close();
  await browser.close();

  ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek UI ronde 28 lulus`);
  if (pass !== results.length) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
  if (/\[ERROR\]/.test(log)) console.log('log server:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 8).join('\n'));
  srv.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
