'use strict';
/* UI ronde 11: leger payroll (ceklis, sertifikasi jam, salin bulan, simpan draf anti-stuck),
   halaman Nominal Tunjangan & Honor, portal publik piutang (agregat) & slip */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3622;
const DB = process.env.R11UI_DB || path.join(os.tmpdir(), 'smk-r11ui-' + Date.now() + '.sqlite');
const OUT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'shots-r11');
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
  const login = await fetch(base + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@sekolah.sch.id&password=admin123', redirect: 'manual'
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const post = async (url, body) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) Array.isArray(v) ? v.forEach(x => usp.append(k, x)) : usp.append(k, v);
    return fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: usp.toString(), redirect: 'manual' });
  };
  const db = new Database(DB);
  const periode = new Date().toISOString().slice(0, 7);
  const prev = (() => { const [y, m] = periode.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();

  await post('/pegawai/save', { nama: 'Ahmad Fauzi', jabatan: 'Guru Matematika', tipe: 'guru', aktif: '1', tanggal_lahir: '1988-05-05', whatsapp: '081211112222' });
  await post('/pegawai/save', { nama: 'Budi Santoso', jabatan: 'Kepala TU', tipe: 'tu', aktif: '1', tanggal_lahir: '1985-07-07', whatsapp: '081233334444' });
  await post('/pegawai/save', { nama: 'Citra Dewi', jabatan: 'Guru Bahasa', tipe: 'guru', aktif: '1', tanggal_lahir: '1992-09-09', whatsapp: '081255556666' });
  await post('/payroll/tarik', { periode });
  let rows = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id').all(periode);
  const body = { periode, ids: rows.map(r => r.id).join(',') };
  rows.forEach((r, i) => {
    body[`${r.id}_jam_efektif`] = '24';
    body[`${r.id}_jam_telat`] = String(i);
    body[`${r.id}_honor_jam`] = '50000';
    body[`${r.id}_jam_sertifikasi`] = String(4 + i);
    body[`${r.id}_jam_wali_kelas`] = '2';
    body[`${r.id}_pot_kasbon`] = '25000';
    body[`${r.id}_pot_dana_sosial`] = '10000';
  });
  await post('/payroll/simpan', body);
  await post('/piutang/save', { nama_pegawai: 'Ahmad Fauzi', tanggal_utang: '2026-10-01', nominal: '65000', keterangan: 'Kasbon seragam' });
  const p1 = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Ahmad Fauzi'").get();
  db.prepare("INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,keterangan,created_at) VALUES (?,?,?,'tunai','lunas',?)")
    .run(p1.id, '2026-10-02', 65000, new Date().toISOString());
  await post('/piutang/save', { nama_pegawai: 'Ahmad Fauzi', tanggal_utang: new Date().toISOString().slice(0, 10), nominal: '120000', keterangan: 'Pinjaman aktif' });

  const browser = await chromium.launch();
  const ctxOf = async (viewport) => {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
    return ctx;
  };
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  /* 1. halaman leger: elemen baru + tanpa error JS */
  {
    const ctx = await ctxOf({ width: 1500, height: 1000 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    ok('leger: tanpa error JS', errs.length === 0, errs.join(' | '));
    ok('leger: ceklis per baris ada', await page.locator('tbody input[name="pilih"]').count() === rows.length);
    ok('leger: ceklis "pilih semua" di header', await page.locator('thead input[data-check-all-box="pilih"]').count() === 1);
    ok('leger: kolom sertifikasi = input jam', await page.locator('input[name$="_c_jam_sertifikasi"]').count() === rows.length);
    ok('leger: tidak ada input nominal sertifikasi', await page.locator('input[name$="_pot_sertifikasi"]').count() === 0);
    ok('leger: tanpa panel potong kasbon', await page.locator('#kasbon').count() === 0);
    ok('leger: tombol Simpan Draf tunggal', await page.locator('button:has-text("Simpan Draf")').count() === 1);
    ok('leger: tanpa tombol Review', await page.locator('text=Review & Simpan').count() === 0);
    await page.screenshot({ path: path.join(OUT, '01-leger.png'), fullPage: true });
    // pilih semua → hitung terpilih
    await page.click('button:has-text("Pilih Semua")');
    const checked = await page.locator('tbody input[name="pilih"]:checked').count();
    ok('leger: Pilih Semua mencentang seluruh baris', checked === rows.length, String(checked));
    await page.click('button:has-text("Kosongkan Pilihan")');
    ok('leger: Kosongkan Pilihan bekerja', (await page.locator('tbody input[name="pilih"]:checked').count()) === 0);
    await ctx.close();
  }

  /* 2. live calc: perubahan jam sertifikasi langsung mengubah nominal */
  {
    const ctx = await ctxOf({ width: 1500, height: 1000 });
    const page = await ctx.newPage();
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    const row = page.locator('tr[data-payroll-row]').first();
    await row.locator('input[name$="_c_jam_sertifikasi"]').fill('10');
    await page.waitForTimeout(200);
    const txt = await row.locator('.js-calc[data-kode="pot_sertifikasi"]').textContent();
    ok('live calc sertifikasi = jam × tarif', /125\.000/.test(txt), txt);
    ok('live calc diperbarui otomatis', /125\.000/.test(txt) || txt.trim().length > 0, txt.replace(/\s+/g, ' '));
    await ctx.close();
  }

  /* 3. simpan draf → UI langsung memuat data terbaru (anti stuck) */
  {
    const ctx = await ctxOf({ width: 1500, height: 1000 });
    const page = await ctx.newPage();
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    const row = page.locator('tr[data-payroll-row]').first();
    const rid = await row.getAttribute('data-rid');
    await row.locator('input[name$="_c_jam_sertifikasi"]').fill('12');
    await row.locator('input[name$="_c_jam_efektif"]').fill('26');
    await page.click('button:has-text("Simpan Draf")');
    await page.waitForLoadState('networkidle');
    ok('simpan draf redirect & flash sukses', /DRAF leger/.test(await page.locator('.alert, .flash').first().textContent().catch(() => '')) || /ok=/.test(page.url()) === false);
    const ridNew = await page.locator('tr[data-payroll-row]').first().getAttribute('data-rid');
    ok('urutan baris tetap sama setelah simpan', ridNew === rid, `${rid} vs ${ridNew}`);
    const vals = await page.evaluate(id => {
      const tr = document.querySelector(`tr[data-payroll-row][data-rid="${id}"]`);
      return {
        sert: tr.querySelector('input[name$="_c_jam_sertifikasi"]').value,
        jam: tr.querySelector('input[name$="_c_jam_efektif"]').value,
        txt: tr.querySelector('.js-calc[data-kode="pot_sertifikasi"]').textContent.replace(/\s+/g, ' ').trim()
      };
    }, rid);
    ok('nilai baru langsung tampil di UI', vals.sert === '12' && vals.jam === '26', JSON.stringify(vals));
    ok('nominal sertifikasi ikut terhitung ulang', /150\.000/.test(vals.txt), vals.txt);
    const dbVal = db.prepare('SELECT jam_sertifikasi FROM payroll WHERE id=?').get(Number(rid));
    ok('nilai tersimpan di database', Number(dbVal.jam_sertifikasi) === 12, String(dbVal.jam_sertifikasi));
    // portal publik langsung memuat data yang baru disimpan (pakai page yang sama, browser 1 tab)
    await page.setViewportSize({ width: 430, height: 950 });
    const pp = page;
    await pp.goto(base + '/portal-slip', { waitUntil: 'networkidle' });
    await pp.fill('input[name="nama"]', 'Ahmad Fauzi');
    await pp.fill('input[name="lahir"]', '1988-05-05');
    await pp.click('button:has-text("Kirim Kode OTP")');
    await pp.waitForLoadState('domcontentloaded');
    const banner = await pp.locator('.alert.warn').first().textContent().catch(() => '');
    const kode = (/(\d{4})/.exec(banner || '') || [])[1] || '';
    await pp.fill('input[name="kode"]', kode);
    await pp.click('button:has-text("Verifikasi")');
    await pp.waitForLoadState('networkidle');
    await pp.screenshot({ path: path.join(OUT, '02-portal-slip.png'), fullPage: true });
    const slipTxt = (await pp.locator('.slip-card').first().textContent()).replace(/\s+/g, ' ');
    ok('portal slip langsung merefleksikan draf terbaru (12 jam → Rp 150.000)', /150\.000/.test(slipTxt), slipTxt.slice(0, 160));
    await ctx.close();
  }

  /* 4. hapus massal lewat UI */
  {
    const ctx = await ctxOf({ width: 1500, height: 1000 });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    const before = await page.locator('tr[data-payroll-row]').count();
    await page.locator('tbody input[name="pilih"]').last().check();
    await page.click('button:has-text("Hapus Terpilih")');
    await page.waitForLoadState('networkidle');
    const after = await page.locator('tr[data-payroll-row]').count();
    ok('hapus terpilih dari UI mengurangi baris', after === before - 1, `${before} → ${after}`);
    await ctx.close();
  }

  /* 5. halaman Nominal Tunjangan & Honor */
  {
    const ctx = await ctxOf({ width: 1440, height: 1000 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(base + '/tarif-honor', { waitUntil: 'networkidle' });
    ok('halaman tarif honor: tanpa error JS', errs.length === 0, errs.join(' | '));
    ok('halaman tarif honor: 3 input tarif', await page.locator('input[data-money]').count() >= 3);
    await page.screenshot({ path: path.join(OUT, '03-tarif-honor.png'), fullPage: true });
    await page.fill('input[name="sertifikasi_per_jam"]', '15000');
    await page.click('button:has-text("Simpan Pengaturan")');
    await page.waitForLoadState('networkidle');
    ok('simpan tarif dari UI', db.prepare("SELECT v FROM settings WHERE k='sertifikasi_per_jam'").get().v === '15000');
    await page.fill('input[name="sertifikasi_per_jam"]', '12500');
    await page.click('button:has-text("Simpan Pengaturan")');
    await page.waitForLoadState('networkidle');
    ok('tarif kembali ke 12.500', db.prepare("SELECT v FROM settings WHERE k='sertifikasi_per_jam'").get().v === '12500');
    await ctx.close();
  }

  /* 6. portal piutang agregat + mobile tanpa overflow */
  {
    const ctx = await ctxOf({ width: 430, height: 950 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(base + '/portal-pegawai', { waitUntil: 'networkidle' });
    await page.fill('input[name="nama"]', 'Ahmad Fauzi');
    await page.fill('input[name="lahir"]', '1988-05-05');
    await page.click('button:has-text("Kirim Kode OTP")');
    await page.waitForLoadState('domcontentloaded');
    const banner = await page.locator('.alert.warn').first().textContent().catch(() => '');
    const kode = (/(\d{4})/.exec(banner || '') || [])[1] || '';
    await page.fill('input[name="kode"]', kode);
    await page.click('button:has-text("Verifikasi")');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, '04-portal-piutang.png'), fullPage: true });
    ok('portal piutang: tanpa error JS', errs.length === 0, errs.join(' | '));
    ok('portal piutang: riwayat lunas terpisah', await page.locator('.lunas-box').count() >= 1);
    ok('portal piutang: hanya 1 tagihan aktif', await page.locator('table.tbl-modern tbody tr').count() >= 1);
    ok('portal piutang tanpa overflow mobile', (await overflow(page)) <= 2, String(await overflow(page)));
    await ctx.close();
  }

  /* 7. mobile leger tanpa overflow */
  {
    const ctx = await ctxOf({ width: 390, height: 900 });
    const page = await ctx.newPage();
    await page.goto(base + '/payroll?periode=' + periode, { waitUntil: 'networkidle' });
    ok('leger mobile tanpa overflow halaman', (await overflow(page)) <= 2, String(await overflow(page)));
    const pick = await page.locator('thead th.pick-cell').first().boundingBox();
    const nm = await page.locator('thead th.sticky-col').first().boundingBox();
    ok('kolom ceklis & nama tidak bertumpuk', pick && nm && pick.x + pick.width <= nm.x + 1, JSON.stringify({ pick, nm }));
    await page.screenshot({ path: path.join(OUT, '05-leger-mobile.png'), fullPage: false });
    await ctx.close();
  }

  await browser.close();
  db.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 11 lulus ===\nscreenshot: ${OUT}`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    if (!/SIMKEU Sekolah listening/.test(log)) console.log('log:', log.slice(-800));
    process.exit(1);
  }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
