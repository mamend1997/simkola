'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* screenshot cepat: portal bayar iuran + sidebar hover (manual review) */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
const DB = path.join(TMP, 'k.sqlite');
const PORT = 3771;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: path.join(TMP, 'saas.db') },
  stdio: ['ignore', 'pipe', 'pipe']
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
async function req(method, url, body) {
  let payload = null; const headers = { Cookie: cookie };
  if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return r;
}
(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE aktif=1 LIMIT 1').get();
  const now = '2026-02-02 09:00:00';
  const gid = Number(db.prepare("INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES ('SPP','bulanan',?,1,?)").run(ta.id, now).lastInsertRowid);
  [7, 8, 9, 10].forEach(b => db.prepare("INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,'')").run(gid, b, 250000));
  const gid2 = Number(db.prepare("INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES ('Uang Kegiatan Semester','nonbulanan',?,1,?)").run(ta.id, now).lastInsertRowid);
  const sid = Number(db.prepare("INSERT INTO siswa (nama,nisn,tanggal_lahir,status,created_at) VALUES ('Ahmad Fauzi','12001','2010-05-04','aktif',?)").run(now).lastInsertRowid);
  db.prepare("INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)").run(gid, sid, ta.id, 1000000, now);
  db.prepare("INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)").run(gid2, sid, ta.id, 450000, now);
  await req('POST', '/pembayaran-online/simpan', {
    bayar_manual_aktif: '1', bayar_gateway_aktif: '1', bayar_provider: 'sandbox', bayar_mode: 'sandbox',
    bayar_expire_menit: '60', bayar_instruksi: 'Transfer ke BRI 0123-4567-8901 a.n. SMK PGRI Cikoneng, lalu unggah bukti pembayaran.'
  });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 950 } });
  const ck = cookie.split(';')[0].split('=');
  await ctx.addCookies([{ name: ck[0], value: ck.slice(1).join('='), domain: '127.0.0.1', path: '/' }]);
  let page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/');
  await page.click('#navCollapse');
  await page.waitForTimeout(200);
  await page.hover('#sidebar');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, '..', '.tmp-shot-sidebar.png') });
  await page.close();
  // portal bayar (tanpa sesi) — halaman baru di konteks yang sama
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  page = await ctx2.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/portal/bayar?nama=' + encodeURIComponent('Ahmad Fauzi') + '&lahir=2010-05-04');
  await page.waitForTimeout(300);
  await page.locator('[data-bayar-item]').nth(0).check();
  await page.locator('[data-bayar-item]').nth(2).check();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, '..', '.tmp-shot-bayar.png'), fullPage: true });
  const total = await page.locator('[data-bayar-total]').innerText();
  console.log('total terpilih:', total);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, '..', '.tmp-shot-bayar-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('overflow mobile:', overflow, '| errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
  srv.kill();
  process.exit(0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
