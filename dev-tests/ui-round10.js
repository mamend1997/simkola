'use strict';
/* Screenshot & smoke UI ronde 10 (draf payroll, potongan kasbon, slip gaji, portal pegawai) */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3611;
const DB = process.env.R10UI_DB || path.join(os.tmpdir(), 'smk-r10ui-' + Date.now() + '.sqlite');
const OUT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'shots-r10');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);

  // seed data via HTTP
  const post = async (url, body) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) usp.append(k, v);
    return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: usp.toString(), redirect: 'manual' });
  };
  const login = await fetch(base + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@sekolah.sch.id&password=admin123', redirect: 'manual'
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const authed = async (url, body) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) usp.append(k, v);
    return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: usp.toString(), redirect: 'manual' });
  };
  const periode = new Date().toISOString().slice(0, 7);
  await authed('/pegawai/save', { nama: 'Rina Wulandari', jabatan: 'Guru Matematika', tipe: 'guru', aktif: '1', tanggal_lahir: '1987-02-02', whatsapp: '081211112222' });
  await authed('/pegawai/save', { nama: 'Budi Santoso', jabatan: 'Kepala TU', tipe: 'tu', aktif: '1', tanggal_lahir: '1985-07-07', whatsapp: '081233334444' });
  await authed('/payroll/tarik', { periode });
  const rows = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY id').all(periode);
  const body = { periode, ids: rows.map(r => r.id).join(',') };
  rows.forEach((r, i) => {
    body[`${r.id}_jam_efektif`] = '24';
    body[`${r.id}_jam_telat`] = i ? '1' : '0';
    body[`${r.id}_honor_jam`] = '50000';
    body[`${r.id}_tunjangan_jabatan`] = i ? '250000' : '150000';
    body[`${r.id}_jam_wali_kelas`] = '3';
    body[`${r.id}_pot_dana_sosial`] = '10000';
    body[`${r.id}_pot_kasbon`] = '50000';
  });
  await authed('/payroll/simpan', body);
  await authed('/piutang/save', { nama_pegawai: 'Rina Wulandari', tanggal_utang: new Date().toISOString().slice(0, 10), nominal: '400000', keterangan: 'Kasbon koperasi' });
  await authed('/piutang/save', { nama_pegawai: 'Rina Wulandari', tanggal_utang: new Date().toISOString().slice(0, 10), nominal: '150000', keterangan: 'Pinjaman lunas' });
  const lunas = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Rina Wulandari' AND keterangan='Pinjaman lunas'").get();
  db.prepare("INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,keterangan,created_at) VALUES (?,?,?,'tunai','lunas',?)")
    .run(lunas.id, new Date().toISOString().slice(0, 10), 150000, new Date().toISOString());
  await fetch(base + '/piutang', { headers: { Cookie: cookie } });

  const browser = await chromium.launch();

  async function shot(url, file, viewport = { width: 1440, height: 1000 }, actions) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(base + url, { waitUntil: 'networkidle' });
    if (actions) await actions(page);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await ctx.close();
    return { errs, overflow };
  }

  let r = await shot('/payroll?periode=' + periode, '01-payroll-draf.png');
  ok('payroll: tanpa error JS', r.errs.length === 0, r.errs.join(' | '));
  ok('payroll desktop tanpa overflow', r.overflow <= 2, String(r.overflow));
  r = await shot('/payroll?periode=' + periode, '01b-payroll-kasbon.png', { width: 1440, height: 1000 },
    async page => { await page.locator('table.payroll-table').scrollIntoViewIfNeeded(); });
  ok('tabel leger dinamis tampil', r.errs.length === 0, r.errs.join(' | '));

  // tombol aksi baris (form attribute) harus benar-benar mengirim POST & mengubah urutan
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    const before = db.prepare('SELECT id, urutan FROM payroll WHERE periode=? ORDER BY urutan, id').all(periode).map(x => x.id);
    await page.locator('tr[data-payroll-row]').nth(1).locator('button[title="Pindah ke atas"]').click();
    await page.waitForLoadState('domcontentloaded');
    const after = db.prepare('SELECT id, urutan FROM payroll WHERE periode=? ORDER BY urutan, id').all(periode).map(x => x.id);
    ok('tombol urutkan baris bekerja', before[0] !== after[0] && after[0] === before[1], JSON.stringify({ before, after }));
    await ctx.close();
  }

  // form leger dinamis: seluruh baris & kolom ikut terkirim (tanpa form bersarang)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    const info = await page.evaluate(() => ({
      rows: document.querySelectorAll('tr[data-payroll-row]').length,
      inputs: document.querySelectorAll('#fPayroll input[name$="_c_jam_efektif"], #fPayroll input.js-din').length,
      foot: document.querySelectorAll('tfoot [data-foot-kode]').length,
      actions: document.querySelectorAll('#fPayroll').length
    }));
    ok('form leger dinamis memuat semua baris', info.rows === rows.length, `${info.rows}/${rows.length}`);
    ok('kolom dinamis punya input & footer total', info.inputs >= rows.length && info.foot >= 10, JSON.stringify(info));
    ok('hanya satu form leger (tidak bersarang)', info.actions === 1);
    await page.screenshot({ path: path.join(OUT, '02-payroll-dinamis.png') });
    await ctx.close();
  }

  r = await shot('/payroll/slip?periode=' + periode, '03-slip-modul.png');
  ok('modul slip: tanpa error JS', r.errs.length === 0, r.errs.join(' | '));
  ok('modul slip desktop tanpa overflow', r.overflow <= 2, String(r.overflow));
  r = await shot('/payroll/slip?periode=' + periode, '04-slip-modul-mobile.png', { width: 390, height: 900 });
  ok('modul slip mobile tanpa overflow', r.overflow <= 2, String(r.overflow));

  // portal: login page + hasil OTP
  r = await shot('/portal-slip', '05-portal-slip-form.png', { width: 430, height: 950 });
  ok('portal slip form: tanpa error JS', r.errs.length === 0, r.errs.join(' | '));
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 950 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(base + '/portal-slip', { waitUntil: 'networkidle' });
    await page.fill('input[name="nama"]', 'Rina Wulandari');
    await page.fill('input[name="lahir"]', '1987-02-02');
    await page.click('button:has-text("Kirim Kode OTP")');
    await page.waitForLoadState('domcontentloaded');
    const banner = await page.locator('.alert.warn').first().textContent().catch(() => '');
    const kode = (/(\d{4})/.exec(banner || '') || [])[1] || '';
    await page.fill('input[name="kode"]', kode);
    await page.click('button:has-text("Verifikasi")');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, '06-portal-slip-hasil.png'), fullPage: true });
    ok('portal slip hasil: total diterima tampil', await page.locator('.slip-total .big').count() > 0);
    const fs2 = await page.evaluate(() => {
      const el = document.querySelector('.slip-total .big');
      const st = el ? getComputedStyle(el) : null;
      return st ? { fs: parseFloat(st.fontSize), fw: st.fontWeight } : null;
    });
    ok('TOTAL DITERIMA besar & bold', fs2 && fs2.fs >= 20 && Number(fs2.fw) >= 700, JSON.stringify(fs2));
    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('portal slip mobile tanpa overflow', ovf <= 2, String(ovf));
    ok('portal slip hasil: tanpa error JS', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // portal piutang hasil
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 950 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(base + '/portal-pegawai', { waitUntil: 'networkidle' });
    await page.fill('input[name="nama"]', 'Rina Wulandari');
    await page.fill('input[name="lahir"]', '1987-02-02');
    await page.click('button:has-text("Kirim Kode OTP")');
    await page.waitForLoadState('domcontentloaded');
    const banner = await page.locator('.alert.warn').first().textContent().catch(() => '');
    const kode = (/(\d{4})/.exec(banner || '') || [])[1] || '';
    await page.fill('input[name="kode"]', kode);
    await page.click('button:has-text("Verifikasi")');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, '07-portal-piutang-hasil.png'), fullPage: true });
    ok('portal piutang: riwayat lunas tampil', await page.locator('.lunas-box').count() > 0);
    ok('portal piutang: status LUNAS terlihat', await page.locator('.badge:has-text("LUNAS")').count() > 0);
    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('portal piutang mobile tanpa overflow', ovf <= 2, String(ovf));
    ok('portal piutang: tanpa error JS', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  db.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek UI ronde 10 lulus\nscreenshot: ${OUT}`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    process.exit(1);
  }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
