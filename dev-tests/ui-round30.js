'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI ronde 30 (Playwright) — alur pendaftaran sekolah di browser:
   isi form → klik Daftarkan Sekolah → LANGSUNG masuk dashboard Admin Sekolah,
   kartu kredensial (Kode Sekolah / Username / Password) tampil sekali,
   tombol Lihat & Salin berfungsi, kartu bisa ditutup, mobile 390px aman. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui30-'));
const PORT = 3658;
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

  /* context baru = klien yang belum pernah login (cookie bersih) */
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  /* ---------- 1. daftar dari halaman publik ---------- */
  await page.goto(base + '/register');
  await page.waitForTimeout(300);
  ok('form pendaftaran tampil', (await page.locator('#btnDaftar').count()) === 1);
  await page.fill('input[name=nama]', 'SMK Tampilan Uji');
  await page.fill('input[name=admin_nama]', 'Ibu Tampilan');
  await page.fill('input[name=admin_email]', 'tampilan@smk.sch.id');
  await page.fill('input[name=admin_password]', 'rahasiaTampil1');
  await page.fill('input[name=admin_password2]', 'rahasiaTampil1');

  /* ---------- 1b. VERIFIKASI OTP NOMOR WHATSAPP (4 digit) ---------- */
  ok('blok verifikasi OTP tampil', (await page.locator('[data-otp-box]').count()) === 1);
  ok('tombol daftar terkunci sebelum verifikasi', await page.locator('#btnDaftar').isDisabled());
  await page.fill('#fDaftarTelp', '081200006661');
  await page.click('[data-otp-kirim]');
  await page.waitForSelector('[data-otp-demo]', { timeout: 8000 });
  const kodeOtp = (await page.locator('[data-otp-demo]').getAttribute('data-otp-demo')).trim();
  ok('kode OTP 4 digit tersedia (mode uji gateway)', /^\d{4}$/.test(kodeOtp), kodeOtp);
  const digits = page.locator('[data-otp-digit]');
  for (let i = 0; i < 4; i++) await digits.nth(i).fill(kodeOtp[i]);
  await page.click('[data-otp-verifikasi]');
  await page.waitForFunction(() => {
    var s = document.querySelector('[data-otp-status]');
    return s && /terverifikasi/i.test(s.textContent);
  }, null, { timeout: 8000 });
  ok('nomor WhatsApp terverifikasi & tombol daftar aktif', !(await page.locator('#btnDaftar').isDisabled()));
  await Promise.all([page.waitForNavigation(), page.click('#btnDaftar')]);
  await page.waitForTimeout(1200);

  /* ---------- 2. langsung berada di dashboard ---------- */
  ok('setelah daftar langsung di dashboard (URL root)', new URL(page.url()).pathname === '/', page.url());
  ok('tidak dilempar ke halaman login', !/\/login/.test(page.url()), page.url());
  const body = await page.locator('main.content').innerText();
  ok('dashboard sekolah baru terbuka', /Ringkasan Keuangan/.test(body) && /SMK Tampilan Uji/.test(body), body.slice(0, 120));

  /* ---------- 3. kartu kredensial ---------- */
  const card = page.locator('#welcomeKredensial');
  ok('kartu kredensial tampil', (await card.count()) === 1);
  ok('judul kartu menyapa admin baru', /Pendaftaran berhasil/.test(await card.locator('h3').innerText()));
  const kode = (await page.locator('[data-cred=kode]').innerText()).trim();
  ok('kode sekolah 4 karakter tampil besar', /^[A-Z0-9]{4}$/.test(kode), kode);
  ok('ukuran kode sekolah menonjol (>=20px)', await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-cred=kode]')).fontSize) >= 20));
  const user = (await page.locator('[data-cred=user]').innerText()).trim();
  ok('username tampil', user === 'tampilan' || user === 'tampilan@smk.sch.id', user);
  const pwdCell = page.locator('[data-pw]');
  ok('password tersamar (bukan teks polos)', (await pwdCell.innerText()).startsWith('•'), await pwdCell.innerText());
  ok('3 tombol salin tersedia', (await card.locator('[data-copy]').count()) === 3, String(await card.locator('[data-copy]').count()));

  /* tombol Lihat password */
  await page.click('[data-pw-toggle]');
  await page.waitForTimeout(200);
  ok('tombol "Lihat" menampilkan password asli', (await pwdCell.innerText()) === 'rahasiaTampil1', await pwdCell.innerText());
  await page.click('[data-pw-toggle]');
  await page.waitForTimeout(200);
  ok('tombol dapat menyembunyikan password lagi', (await pwdCell.innerText()).startsWith('•'));

  /* tombol salin (clipboard diizinkan pada konteks Playwright) */
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await card.locator('[data-copy]').first().click();
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('tombol "Salin kode" menaruh kode di clipboard', clip === kode, `${clip} vs ${kode}`);

  /* ---------- 4. mobile 390px ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  ok('mobile 390px tanpa overflow', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1),
    String(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)));
  ok('kartu kredensial tetap terbaca di mobile', await card.isVisible());
  ok('sel kredensial tersusun satu kolom di mobile', await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#welcomeKredensial .cred-cell')];
    const tops = cells.map(c => Math.round(c.getBoundingClientRect().top));
    return new Set(tops).size === cells.length;
  }));
  await page.setViewportSize({ width: 1360, height: 950 });

  /* ---------- 5. tutup kartu ---------- */
  await page.click('[data-close-welcome]');
  await page.waitForTimeout(300);
  ok('tombol "Mengerti" menutup kartu', (await page.locator('#welcomeKredensial').count()) === 0);
  await page.reload();
  await page.waitForTimeout(400);
  ok('kartu tidak muncul lagi setelah reload', (await page.locator('#welcomeKredensial').count()) === 0);

  /* ---------- 6. login ulang dengan kredensial yang sama (tab yang sama) ---------- */
  await page.context().clearCookies();
  await page.goto(base + '/login');
  await page.waitForTimeout(300);
  await page.fill('input[name=kode]', kode);
  await page.fill('input[name=email]', user);
  await page.fill('input[name=password]', 'rahasiaTampil1');
  await Promise.all([page.waitForNavigation(), page.click('form button')]);
  await page.waitForTimeout(700);
  ok('login ulang dengan kredensial hasil daftar berhasil', /Ringkasan Keuangan/.test(await page.locator('main.content').innerText()));
  ok('kartu kredensial tidak muncul pada login biasa', (await page.locator('#welcomeKredensial').count()) === 0);

  ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  await ctx.close(); await browser.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek UI ronde 30 lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
    const errs = log.split('\n').filter(l => /\[ERROR\]/.test(l));
    if (errs.length) console.log('log server:\n' + errs.slice(0, 8).join('\n'));
  }
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
