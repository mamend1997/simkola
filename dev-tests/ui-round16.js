'use strict';
/* Ronde 16 (UI) — Portal Slip Gaji: dropdown periode auto-submit & tampilan mobile 390px. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3587;
const DB = path.join(os.tmpdir(), 'smk-r16ui-' + Date.now() + '.sqlite');
try { fs.unlinkSync(DB); } catch (e) { }
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (n, c, e = '') => { results.push({ n, ok: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${e}`); };
async function req(method, url, body) {
  const headers = {};
  let payload = null;
  if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  return { status: r.status, text: await r.text() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date().getFullYear() - 1;
  db.prepare('INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)')
    .run('Guru UI Slip', 'Guru', 'guru', '081234567892', '1991-02-03');
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Guru UI Slip'").get();
  for (const [p, jam] of [[`${y}-07`, 20], [`${y}-09`, 30]]) {
    db.prepare(`INSERT INTO payroll (periode,nama,jabatan,tipe,jam_efektif,jam_telat,honor_jam,pegawai_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(p, 'Guru UI Slip', 'Guru', 'guru', jam, 1, 50000, pg.id, today);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto(base + '/portal-slip', { waitUntil: 'load' });
  await page.fill('input[name=nama]', 'Guru UI Slip');
  await page.fill('input[name=lahir]', '1991-02-03');
  await page.click('.portal-card form .btn-primary');
  await page.waitForLoadState('load');
  const kode = (/kode OTP Anda: <b[^>]*>(\d{4})<\/b>/.exec(await page.content()) || [])[1];
  ok('kode OTP uji tampil di halaman verifikasi', !!kode, kode || '');
  await page.fill('input[name=kode]', kode || '0000');
  await page.click('.portal-card form .btn-primary');
  await page.waitForLoadState('load');
  ok('halaman hasil slip tampil', /Rincian Slip Gaji/.test(await page.content()));
  ok('dropdown Bulan & Tahun terlihat', await page.locator('.portal-period select[name=bulan]').count() === 1
    && await page.locator('.portal-period select[name=tahun]').count() === 1);

  const teksAwal = await page.locator('.portal-student .badge').first().innerText();
  ok('periode default terisi', /Periode aktif: /.test(teksAwal), teksAwal);

  /* ganti bulan → auto submit (data-autosubmit) */
  await page.selectOption('.portal-period select[name=bulan]', '7');
  await page.waitForLoadState('load');
  await sleep(200);
  const url1 = page.url();
  ok('ganti bulan memicu reload (auto-submit)', /bulan=7/.test(url1), url1);
  ok('data berubah ke Juli', /Periode aktif: Juli \d{4}/.test(await page.locator('.portal-student .badge').first().innerText()));
  ok('URL memuat token verifikasi', /token=/.test(url1));

  /* ganti tahun → tetap konsisten */
  await page.selectOption('.portal-period select[name=tahun]', String(y));
  await page.waitForLoadState('load');
  await sleep(200);
  ok('ganti tahun memicu reload', new RegExp(`tahun=${y}`).test(page.url()), page.url());
  ok('periode tetap Juli pada tahun terpilih', new RegExp(`Periode aktif: Juli ${y}`).test(await page.locator('.portal-student .badge').first().innerText()));

  /* periode kosong → pesan */
  await page.selectOption('.portal-period select[name=bulan]', '2');
  await page.waitForLoadState('load');
  await sleep(200);
  ok('periode kosong menampilkan pesan informatif', /belum tersedia/.test(await page.content()));

  /* tombol cetak mengikuti periode aktif */
  await page.selectOption('.portal-period select[name=bulan]', '9');
  await page.waitForLoadState('load');
  await sleep(200);
  const href = await page.locator('a[href*="/portal-slip/cetak"]').first().getAttribute('href');
  ok('tombol cetak memuat periode aktif', new RegExp(`periode=${y}-09`).test(href || ''), href || '');
  ok('label tombol cetak menyebut periode', /Cetak Slip September/i.test(await page.locator('a[href*="/portal-slip/cetak"]').first().innerText()));

  /* mobile 390px tanpa overflow */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState('load');
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('mobile 390px tanpa scroll horizontal', ovf <= 1, String(ovf));

  await page.close();
  await browser.close();
  srv.kill();
  db.close();
  ok('tanpa error JS', errs.length === 0, errs.slice(0, 2).join(' | '));
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI portal slip lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-900)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
