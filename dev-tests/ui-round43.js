'use strict';
/* =====================================================================
   RONDE 43 (SIMKEU) — UI Playwright
   1) Petunjuk Pengguna: kartu bergambar (thumbnail) + viewer video/PDF
      yang terbuka di dalam aplikasi (modal, iframe dimuat saat dibuka).
   2) Pendaftaran: verifikasi OTP 4 digit dari halaman pendaftaran.
   3) Honor ekskul: kolom "Bulan Posting BKU" terpisah dari periode honor.
   Jalankan: node dev-tests/ui-round43.js
   ===================================================================== */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui43-'));
const PORT = process.env.R43_UI_PORT || 3687;
const DB = path.join(TMP, 'k.sqlite');
const SDB = path.join(TMP, 'saas.db');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'), SAAS_ADMIN_PASSWORD: 'SuperAdmin2026!' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, c, x = '') => { out.push(c); console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  → ' + x)); };

/* thumbnail uji: PNG 1x1 data URI (tidak bergantung jaringan) */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie || cookie) headers.Cookie = opt.cookie || cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !opt.cookie) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '', sc: sc || '' };
}

(async () => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }

  /* ---------- siapkan data: panduan + honor ekskul ---------- */
  let r = await req('POST', '/super-admin/login', { email: 'super@simkeu.id', password: 'SuperAdmin2026!' });
  const cSa = r.sc.split(';')[0];
  await req('POST', '/super-admin/petunjuk/simpan', {
    judul: 'Panduan Viewer UI', kategori: 'Iuran & SPP', ringkas: 'Panduan uji tampilan',
    konten: '# Langkah\n1. Buka menu Iuran\n2. Klik tombol Bayar',
    video_url: 'https://youtu.be/dQw4w9WgXcQ',
    lampiran_url: 'https://contoh.sch.id/panduan-ui.pdf',
    thumbnail_url: PNG, urutan: '1', published: '1'
  }, { cookie: cSa });

  /* admin sekolah untuk data ekskul */
  let cT = '';
  r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  cT = r.sc.split(';')[0];
  const Database = require('better-sqlite3');
  const tdb = new Database(DB);
  const ta = tdb.prepare('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1').get();
  await req('POST', '/ta/pilih', { ta: ta.id }, { cookie: cT });
  const bku = tdb.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1").get(ta.id);
  tdb.close();
  await req('POST', '/ekskul/save-grid', {
    jenis: 'Pramuka', periode: '2026-09', posting_periode: '2026-10',
    nama_pembina: ['Pembina Uji'], kehadiran: ['2'], harga_satuan: ['100.000'], keterangan: ['']
  }, { cookie: cT });

  const browser = await chromium.launch();
  const errors = [];

  /* ================= 1. PETUNJUK — THUMBNAIL & VIEWER ================= */
  const ctx1 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  let page = await ctx1.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/i.test(m.text())) errors.push(m.text()); });

  await page.goto(base + '/login');
  await page.fill('input[name=kode]', 'SK01');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await page.click('form button');
  await page.waitForTimeout(700);

  await page.goto(base + '/petunjuk');
  await page.waitForTimeout(400);
  const card = page.locator('.guide-card[data-guide]').first();
  ok('kartu panduan tampil', await card.count() === 1);
  const thumb = card.locator('.guide-thumb img');
  ok('kartu panduan punya gambar pratayang (thumbnail)', await thumb.count() === 1);
  ok('thumbnail benar-benar termuat (naturalWidth > 0)', await thumb.evaluate(el => el.complete && el.naturalWidth > 0));
  ok('overlay tombol putar pada thumbnail video', await card.locator('.guide-play').count() === 1);
  ok('badge media tampil di thumbnail', await card.locator('.guide-badge').count() === 1);

  /* --- viewer video di dalam aplikasi --- */
  await card.locator('[data-open^="mGv"]').click();
  await page.waitForTimeout(400);
  const vModal = page.locator('.modal.show');
  ok('modal viewer video terbuka', await vModal.count() === 1);
  const vIframe = vModal.locator('.video-embed iframe');
  ok('iframe video ada di dalam modal', await vIframe.count() === 1);
  ok('src iframe youtube dimuat saat modal dibuka', /youtube\.com\/embed\/dQw4w9WgXcQ/.test(String(await vIframe.getAttribute('src'))));
  ok('modal tidak membuka tab baru (tanpa target di tombol utama)', (await vModal.locator('[data-close]').count()) >= 1);
  await vModal.locator('[data-close]').first().click();
  await page.waitForTimeout(300);
  ok('iframe dilepas saat modal ditutup (hemat bandwidth)',
    String(await page.locator('.modal [data-src]').first().getAttribute('src') || '') === '');

  /* --- viewer PDF di dalam aplikasi --- */
  await card.locator('[data-open^="mGd"]').click();
  await page.waitForTimeout(400);
  const pModal = page.locator('.modal.show');
  ok('modal viewer PDF terbuka', await pModal.count() === 1);
  const pIframe = pModal.locator('.pdf-embed iframe');
  ok('iframe PDF ada di dalam modal', await pIframe.count() === 1);
  ok('src dokumen PDF dimuat', /panduan-ui\.pdf/.test(String(await pIframe.getAttribute('src'))));
  const box = await pIframe.boundingBox();
  ok('tinggi viewer PDF cukup besar (>300px)', !!box && box.height > 300, box && Math.round(box.height));
  await pModal.locator('[data-close]').first().click();
  await page.waitForTimeout(300);

  /* halaman rincian juga ter-embed */
  await page.goto(base + '/petunjuk?id=1');
  await page.waitForTimeout(400);
  ok('halaman rincian memuat viewer PDF & video', (await page.locator('.pdf-embed iframe').count()) === 1 && (await page.locator('.video-embed iframe').count()) === 1);
  ok('rincian menampilkan gambar pratayang besar', await page.locator('.guide-hero img').count() === 1);

  /* tanpa error JS */
  ok('tidak ada error JS di halaman petunjuk', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();

  /* ================= 2. SUPER ADMIN — KOLOM THUMBNAIL ================= */
  let page2 = await ctx1.newPage();
  page2.on('pageerror', e => errors.push(String(e.message)));
  await page2.goto(base + '/super-admin/login');
  await page2.fill('input[name=email]', 'super@simkeu.id');
  await page2.fill('input[name=password]', 'SuperAdmin2026!');
  await page2.click('form button');
  await page2.waitForTimeout(600);
  await page2.goto(base + '/super-admin/petunjuk');
  await page2.waitForTimeout(300);
  ok('form Master Petunjuk punya input thumbnail', await page2.locator('input[name=thumbnail_url]').count() === 1);
  ok('form Master Petunjuk punya unggah thumbnail', await page2.locator('input[data-b64="gThumbB64"]').count() === 1);
  ok('daftar panduan menampilkan pratayang thumbnail', await page2.locator('table img[alt="Thumb"]').count() >= 1);
  await page2.close();

  /* ================= 3. PENDAFTARAN — VERIFIKASI OTP ================= */
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  let page3 = await ctx2.newPage();
  page3.on('pageerror', e => errors.push(String(e.message)));
  page3.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/i.test(m.text())) errors.push(m.text()); });
  await page3.goto(base + '/register');
  await page3.waitForTimeout(300);
  ok('blok verifikasi OTP tampil di form pendaftaran', await page3.locator('[data-otp-box]').count() === 1);
  ok('tombol daftar terkunci sebelum verifikasi', await page3.locator('#btnDaftar').isDisabled());
  await page3.fill('input[name=nama]', 'SMK OTP Browser');
  await page3.fill('input[name=admin_nama]', 'Ibu OTP');
  await page3.fill('input[name=admin_email]', 'otp@browser.sch.id');
  await page3.fill('input[name=admin_password]', 'rahasiaOtp1');
  await page3.fill('input[name=admin_password2]', 'rahasiaOtp1');
  await page3.fill('#fDaftarTelp', '081200005555');
  await page3.click('[data-otp-kirim]');
  await page3.waitForSelector('[data-otp-demo]', { timeout: 8000 });
  const kode = String(await page3.locator('[data-otp-demo]').getAttribute('data-otp-demo')).trim();
  ok('kode OTP 4 digit tampil (mode uji gateway)', /^\d{4}$/.test(kode), kode);
  const digits = page3.locator('[data-otp-digit]');
  for (let i = 0; i < 4; i++) await digits.nth(i).fill(kode[i]);
  ok('input OTP menerima 4 digit', (await digits.nth(3).inputValue()) === kode[3]);
  await page3.click('[data-otp-verifikasi]');
  await page3.waitForFunction(() => {
    const s = document.querySelector('[data-otp-status]');
    return s && /terverifikasi/i.test(s.textContent);
  }, null, { timeout: 8000 });
  ok('status verifikasi sukses tampil', /terverifikasi/i.test(await page3.locator('[data-otp-status]').innerText()));
  ok('tombol daftar aktif setelah verifikasi', !(await page3.locator('#btnDaftar').isDisabled()));
  ok('blok OTP berubah menjadi hijau (terverifikasi)', await page3.locator('[data-otp-box].verified').count() === 1);
  await Promise.all([page3.waitForNavigation(), page3.click('#btnDaftar')]);
  await page3.waitForTimeout(1200);
  ok('pendaftaran dengan OTP berhasil masuk dashboard', new URL(page3.url()).pathname === '/', page3.url());
  await page3.close();

  /* mobile: form pendaftaran tidak melebar */
  let page4 = await ctx2.newPage({ viewport: { width: 390, height: 780 } });
  await page4.goto(base + '/register');
  await page4.waitForTimeout(300);
  const overflowReg = await page4.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('form pendaftaran tidak overflow horizontal di 390px', overflowReg <= 2, String(overflowReg));
  ok('kotak OTP tetap terlihat di mobile', await page4.locator('[data-otp-box]').isVisible());
  await page4.close();

  /* ================= 4. HONOR EKSKUL — BULAN POSTING BKU ================= */
  const ctx3 = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  let page5 = await ctx3.newPage();
  page5.on('pageerror', e => errors.push(String(e.message)));
  page5.on('dialog', d => d.accept());
  await page5.goto(base + '/login');
  await page5.fill('input[name=kode]', 'SK01');
  await page5.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page5.fill('input[name=password]', 'admin123');
  await page5.click('form button');
  await page5.waitForTimeout(700);

  await page5.goto(base + '/ekskul/antrean');
  await page5.waitForTimeout(400);
  const postingInput = page5.locator('input[name="posting_periode"]').first();
  ok('antrean menyediakan input Bulan Posting BKU', await postingInput.count() === 1);
  ok('nilai awal bulan posting = periode yang dipilih saat input', await postingInput.inputValue() === '2026-10', await postingInput.inputValue());
  ok('judul kelompok menampilkan periode honor', /Periode Honor September 2026/.test(await page5.locator('.card-head h3').first().innerText()));
  await postingInput.fill('2026-11');
  await page5.locator('form[action*="/ekskul/antrean/posting"] select[name="bku_id"]').selectOption(String(bku.id));
  await Promise.all([page5.waitForNavigation(), page5.locator('form[action*="/ekskul/antrean/posting"] button').first().click()]);
  await page5.waitForTimeout(500);
  ok('posting dari UI berhasil', /ok=/.test(page5.url()), page5.url());

  await page5.goto(base + '/ekskul?periode=2026-09');
  await page5.waitForTimeout(300);
  const body = await page5.locator('main.content').innerText();
  ok('daftar honor menampilkan kolom Bulan Posting BKU', /Bulan Posting BKU/i.test(body));
  ok('baris menampilkan November 2026 (bulan posting) & Oktober/September untuk periode', /November 2026/.test(body));
  const exported = await page5.locator('a[href*="/ekskul/export"]').count();
  ok('tombol Export Excel tetap tersedia', exported >= 1);

  /* mobile: antrean tidak melebar */
  await page5.setViewportSize({ width: 390, height: 780 });
  await page5.goto(base + '/ekskul/antrean');
  await page5.waitForTimeout(300);
  const overflowQ = await page5.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('halaman antrean ekskul tidak overflow di 390px', overflowQ <= 2, String(overflowQ));
  await page5.close();

  ok('tidak ada error JS di seluruh pengujian', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  srv.kill('SIGTERM');
  const failed = out.filter(x => !x).length;
  console.log(`\n=== ${out.length - failed} lulus, ${failed} gagal ===`);
  if (failed) process.exitCode = 1;
})().catch(async e => {
  console.error('FATAL', e);
  console.log(log.slice(-3000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
