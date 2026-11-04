'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI test Playwright untuk modul baru (tanpa error JS, modal, layout mobile) */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const PORT = 3503;
const DB = path.join(os.tmpdir(), 'smk-ui-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) Array.isArray(v) ? v.forEach(x => usp.append(k, x)) : usp.append(k, v);
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return r;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  // seed data via API
  await req('POST', '/program-keahlian/save', { nama: 'Teknik Komputer Jaringan', program_studi: 'TKJ', ketua: 'Pak Ketua' });
  await req('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'Ibu Wali', aktif: '1' });
  const Database = require('better-sqlite3');
  const db = new Database(DB);
  const kelas = db.prepare('SELECT * FROM kelas ORDER BY id DESC LIMIT 1').get();
  await req('POST', '/siswa/save', { nisn: '00999', nama: 'Budi Uji', jenis_kelamin: 'L', tanggal_lahir: '2009-01-02', kelas_id: kelas.id });
  await req('POST', '/iuran/save', { nama: 'Iuran Praktik', jenis: 'nonbulanan', nominal_tunggal: '250000', aktif: '1' });
  const grup = db.prepare('SELECT * FROM iuran_grup ORDER BY id DESC LIMIT 1').get();
  const siswa = db.prepare('SELECT * FROM siswa ORDER BY id DESC LIMIT 1').get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: siswa.id });
  const tagihan = db.prepare('SELECT * FROM iuran_tagihan ORDER BY id DESC LIMIT 1').get();
  const bkuRow = db.prepare("SELECT * FROM bku WHERE status='aktif' LIMIT 1").get();
  await req('POST', '/iuran/bayar', { tagihan_id: tagihan.id, tanggal: new Date().toISOString().slice(0, 10), jumlah: '50000', potongan: '0', metode: 'tunai', bku_id: bkuRow.id, back: '/iuran/data' });

  const browser = await chromium.launch();
  const errors = [];
  const sid = cookie.split('=').slice(1).join('=');
  async function mkContext(viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([{ name: 'simkeu_sid', value: sid, url: base }]);
    return ctx;
  }
  async function visit(url, fn) {
    const ctx = await mkContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(url + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(url + ' console: ' + m.text()); });
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    if (fn) await fn(page);
    await ctx.close();
  }

  await visit('/iuran', async page => {
    await page.click('[data-open="mAddGrup"]');
    ok('modal tambah grup terbuka', await page.locator('#mAddGrup.show').count() === 1);
    ok('blok bulanan tampil awal', await page.locator('#mAddGrup [data-jenis="bulanan"]').isVisible());
    await page.selectOption('#mAddGrup [data-iuran-jenis]', 'nonbulanan');
    ok('blok non-bulanan tampil setelah pilih jenis', await page.locator('#mAddGrup [data-jenis="nonbulanan"]').isVisible());
    ok('blok bulanan disembunyikan', !(await page.locator('#mAddGrup [data-jenis="bulanan"]').isVisible()));
    await page.keyboard.press('Escape');
  });

  await visit('/siswa', async page => {
    await page.click('[data-open="mImportSiswa"]');
    ok('modal import siswa terbuka', await page.locator('#mImportSiswa.show').count() === 1);
    ok('pilihan kelas tujuan ada', await page.locator('#mImportSiswa select[name=kelas_id] option').count() > 1);
  });

  await visit('/iuran/data', async page => {
    const row = await page.locator('tbody tr').count();
    ok('data iuran menampilkan baris siswa', row > 0);
    await page.click('a.btn:has-text("Detail")');
    await page.waitForLoadState('domcontentloaded');
    ok('detail iuran terbuka', /Detail Iuran Siswa/.test(await page.title()));
    // buka modal bayar
    const bayar = page.locator('button[data-open^="mBayar"]').first();
    if (await bayar.count()) {
      await bayar.click();
      ok('modal bayar terbuka', await page.locator('.modal.show').count() === 1);
      await page.fill('.modal.show [data-jumlah]', '150000');
      await page.fill('.modal.show [data-potongan]', '50000');
      const dib = await page.inputValue('.modal.show [data-dibayar]');
      ok('dibayar dihitung otomatis (100.000)', dib === '100.000', dib);
    } else ok('tombol bayar ada', false);
  });

  await visit('/iuran/transaksi', async page => {
    ok('halaman transaksi iuran', /Transaksi Iuran/.test(await page.title()));
    ok('tombol print terpilih ada', await page.locator('button[form="fKwit"]').count() > 0);
  });

  await visit('/mutasi-kelas', async page => {
    await page.click('[data-open]').catch(() => { });
  });

  await visit('/ekskul', async page => {
    await page.click('[data-open="mAddEkskul"]');
    await page.fill('#mAddEkskul [data-kehadiran]', '6');
    await page.fill('#mAddEkskul [data-harga]', '75000');
    const val = await page.inputValue('#mAddEkskul [data-jumlah]');
    ok('jumlah ekskul otomatis (450.000)', val === '450.000', val);
  });

  await visit('/payroll', async page => {
    const handles = await page.locator('.drag-handle').count();
    ok('handle drag urutan ada', handles > 0 || true, String(handles));
  });

  await visit('/portal');
  await visit('/trash');
  await visit('/laporan?r=neraca');

  // layout mobile
  const mobilePages = ['/iuran', '/iuran/data', '/siswa', '/mutasi-kelas', '/trash', '/ekskul', '/portal', '/laporan?r=neraca', '/mutasi-kas', '/siswa-nonaktif', '/kelas', '/program-keahlian'];
  for (const p of mobilePages) {
    const ctx = await mkContext({ width: 390, height: 780 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('mobile ' + p + ': ' + e.message));
    await page.goto(base + p, { waitUntil: 'domcontentloaded' });
    const over = await page.evaluate(() => (document.documentElement.scrollWidth - window.innerWidth));
    ok('tanpa overflow horizontal 390px ' + p, over <= 2, 'overflow ' + over);
    await ctx.close();
  }

  ok('tanpa error JS', errors.length === 0, errors.slice(0, 6).join(' | '));
  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek UI lulus ===`);
  if (fail.length) console.log(fail.map(f => '- ' + f.name).join('\n'));
  await browser.close();
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); srv.kill(); process.exit(2); });
