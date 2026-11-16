'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   UI RONDE 48 (SIMKEU) — Playwright
   1) Combobox nama penerima: klik → daftar pegawai, ketik → tersaring,
      pilih → nilai terisi, ketik manual tetap boleh, navigasi keyboard.
   2) Antrean Posting: kolom Keterangan, dua tombol aksi per baris,
      tombol masal, filter bulan/tanggal berfungsi lewat UI.
   3) Mobile 390px tanpa overflow & tanpa error JS.
   Jalankan: node dev-tests/ui-round48.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'u48-'));
const DB = path.join(TMP, 'k.sqlite');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.U48_PORT || 3793;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const one = (s, ...a) => db.prepare(s).get(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);

  // login lewat API (cookie dipakai ulang oleh browser)
  let cookie = '';
  async function req(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let payload = null;
    if (body) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) usp.append(k, v);
      payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
  }
  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const ta = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1');
  await req('POST', '/ta/pilih', { ta: ta.id });
  const bku = one("SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1", ta.id)
    || one('SELECT * FROM bku ORDER BY id LIMIT 1');

  /* ---------- data uji ---------- */
  run("INSERT INTO pegawai (nama, jabatan, tipe, aktif) VALUES ('Budi Santoso','Bendahara','tu',1)");
  run("INSERT INTO pegawai (nama, jabatan, tipe, aktif) VALUES ('Siti Aminah','Guru Matematika','guru',1)");
  run("INSERT INTO pegawai (nama, jabatan, tipe, aktif) VALUES ('Ahmad Fauzi','Wali Kelas XI','guru',1)");
  const grup = run("INSERT INTO iuran_grup (nama, jenis, tahun_ajaran_id, aktif, keterangan) VALUES ('Iuran SPP UI','bulanan',?,1,'')", ta.id);
  const grupId = Number(grup.lastInsertRowid);
  for (let i = 1; i <= 8; i++) {
    const s = run('INSERT INTO siswa (nama,nisn,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?)',
      'Siswa UI ' + i, '9800000' + i, ta.id, 'aktif', '2026-07-01 08:00:00');
    const sid = Number(s.lastInsertRowid);
    const t = run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
      grupId, sid, ta.id, 300000, '2026-07-01 08:00:00');
    const tgl = i <= 4 ? '2026-07-1' + i : '2026-09-1' + (i - 4);
    run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,keterangan,bku_id,status,kwitansi_no,print_count,created_at)
         VALUES (?,?,?,?,0,?,?,?,?,?,?,0,?)`,
      Number(t.lastInsertRowid), sid, tgl, 300000, 300000, 'tunai', 'Uji UI',
      i <= 4 ? null : bku.id, i <= 4 ? 'manual' : 'pending', 'UI-KW-' + i, tgl + ' 09:00:00');
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), domain: '127.0.0.1', path: '/' }]);
  let page = await ctx.newPage();
  page.on('pageerror', e => errors.push('page: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  /* ==================================================================
     1. COMBOBOX NAMA PENERIMA
     ================================================================== */
  console.log('\n[1] Combobox nama penerima di form transaksi');
  await page.goto(base + '/transaksi', { waitUntil: 'domcontentloaded' });
  await page.click('button[data-open="mTrxIn"]');
  await page.waitForSelector('#mTrxIn.show');
  const inp = page.locator('#mTrxIn input[data-pihak]');
  ok('kolom nama penerima tampil sebagai combobox', (await inp.count()) === 1);
  ok('tombol daftar pegawai terlihat', await page.locator('#mTrxIn [data-pihak-btn]').isVisible());

  await inp.click();
  await page.waitForSelector('body > [data-pihak-menu]:not([hidden])', { timeout: 3000 }).catch(() => { });
  const menu = page.locator('body > [data-pihak-menu]');
  ok('klik kolom membuka daftar pegawai', await menu.isVisible());
  ok('menu diposisikan sebagai anak body agar sejajar di modal',
    await menu.evaluate(el => el.parentElement === document.body));
  const inputBox = await inp.boundingBox();
  const menuBox = await menu.boundingBox();
  ok('dropdown sejajar dengan kolom nama',
    !!inputBox && !!menuBox && Math.abs(inputBox.x - menuBox.x) <= 2 &&
    Math.abs(inputBox.width - menuBox.width) <= 2 &&
    Math.min(
      Math.abs(menuBox.y - inputBox.y - inputBox.height - 4),
      Math.abs(menuBox.y + menuBox.height - inputBox.y + 4)
    ) <= 3);
  const opts = await page.locator('body > [data-pihak-menu] .pihak-opt .nm').allInnerTexts();
  ok('daftar berisi nama pegawai dari master', opts.includes('Budi Santoso') && opts.includes('Siti Aminah'), opts.join('|'));
  ok('jabatan pegawai tampil sebagai keterangan',
    (await page.locator('body > [data-pihak-menu] .pihak-opt .jb').allInnerTexts()).includes('Guru Matematika'));

  await inp.fill('siti');
  await page.waitForTimeout(150);
  const filtered = await page.locator('body > [data-pihak-menu] .pihak-opt .nm').allInnerTexts();
  ok('mengetik menyaring daftar pegawai', filtered.length === 1 && filtered[0] === 'Siti Aminah', filtered.join('|'));
  await page.locator('body > [data-pihak-menu] [data-pihak-opt="0"]').click();
  ok('memilih pegawai mengisi kolom nama', (await inp.inputValue()) === 'Siti Aminah', await inp.inputValue());
  ok('daftar tertutup setelah memilih', await page.locator('#mTrxIn [data-pihak-menu]').isHidden());

  // isian manual bebas
  await inp.click();
  await inp.fill('Toko Sinar Jaya');
  await page.waitForTimeout(120);
  ok('nama bebas (manual) tetap diterima', (await inp.inputValue()) === 'Toko Sinar Jaya', await inp.inputValue());
  ok('teks tanpa padanan menampilkan pesan "tetap disimpan"',
    (await page.locator('body > [data-pihak-menu] .pihak-empty').count()) === 1);
  await page.click('#mTrxIn .modal-head h3');
  ok('klik di luar menutup daftar pegawai', await page.locator('#mTrxIn [data-pihak-menu]').isHidden());

  // navigasi keyboard
  await inp.fill('');
  await inp.click();
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const picked = await inp.inputValue();
  ok('panah bawah + Enter memilih pegawai pertama', picked.length > 0 && ['Budi Santoso', 'Siti Aminah', 'Ahmad Fauzi'].includes(picked), picked);

  // simpan transaksi dengan nama manual → tersimpan
  await page.selectOption('#mTrxIn select[name="bku_id"]', String(bku.id));
  await page.selectOption('#mTrxIn select[name="coa_id"]', { index: 1 });
  await page.fill('#mTrxIn input[data-money]', '125000');
  await page.fill('#mTrxIn textarea[name="uraian"]', 'Uji UI combobox nama penerima');
  await page.fill('#mTrxIn input[data-pihak]', 'CV Maju Bersama');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('#mTrxIn button[name="after"][value="saja"]')
  ]);
  const saved = one("SELECT * FROM transaksi WHERE uraian='Uji UI combobox nama penerima' ORDER BY id DESC LIMIT 1");
  ok('transaksi tersimpan dengan nama manual', saved && saved.nama_pihak === 'CV Maju Bersama', saved && saved.nama_pihak);

  /* ==================================================================
     2. ANTREAN POSTING
     ================================================================== */
  console.log('\n[2] Halaman Antrean Posting');
  await page.goto(base + '/iuran/antrean', { waitUntil: 'domcontentloaded' });
  const heads = await page.locator('#tblAntreanQueue thead th, #tblAntreanPending thead th, #tblAntreanNonBku thead th').allInnerTexts();
  ok('ketiga tabel punya kolom Keterangan', heads.filter(t => /KETERANGAN/i.test(t)).length === 3, heads.join('|'));
  ok('antrean menampilkan badge Masuk BKU',
    (await page.locator('#tblAntreanQueue .badge').allInnerTexts()).some(t => /Masuk BKU/i.test(t)));
  ok('riwayat Non-BKU menampilkan badge Non-BKU',
    (await page.locator('#tblAntreanNonBku .badge').allInnerTexts()).some(t => /Non-BKU/i.test(t)));
  const rowQueue = page.locator('#tblAntreanQueue tbody tr').first();
  ok('baris antrean punya tombol Tinjau / Edit', await rowQueue.locator('button:has-text("Tinjau / Edit")').isVisible());
  ok('baris antrean punya tombol Posting ke BKU', await rowQueue.locator('button:has-text("Posting ke BKU")').isVisible());
  ok('baris antrean hanya dua tombol aksi', (await rowQueue.locator('td:last-child button').count()) === 2,
    String(await rowQueue.locator('td:last-child button').count()));
  const rowNon = page.locator('#tblAntreanNonBku tbody tr').first();
  ok('baris Non-BKU punya Tinjau / Edit + Kembalikan ke Antrean',
    (await rowNon.locator('button:has-text("Tinjau / Edit")').count()) === 1
    && (await rowNon.locator('button:has-text("Kembalikan ke Antrean")').count()) === 1);
  ok('riwayat Non-BKU menampilkan 4 baris (tanpa batas 30)', (await page.locator('#tblAntreanNonBku tbody tr').count()) === 4,
    String(await page.locator('#tblAntreanNonBku tbody tr').count()));

  // modal Tinjau / Edit antrean
  await page.locator('#tblAntreanQueue button:has-text("Tinjau / Edit")').first().click();
  await page.waitForSelector('#mQ0.show', { timeout: 3000 }).catch(() => { });
  ok('modal Tinjau / Edit antrean terbuka', await page.locator('#mQ0.show').isVisible());
  ok('modal menyediakan Posting ke BKU & Non-BKU',
    (await page.locator('#mQ0 button:has-text("Posting ke BKU")').count()) === 1
    && (await page.locator('#mQ0 button:has-text("Hanya Simpan Data (Non-BKU)")').count()) === 1);
  await page.click('#mQ0 [data-close="mQ0"]');

  /* filter periode lewat UI */
  ok('bar filter periode tampil', await page.locator('form.period-bar').isVisible());
  await page.selectOption('form.period-bar select[name="bulan"]', '2026-07');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('form.period-bar button:has-text("Terapkan Filter")')
  ]);
  ok('memilih bulan menyaring halaman', /bulan=2026-07/.test(page.url()), page.url());
  ok('filter bulan menyisakan 4 baris Non-BKU Juli', (await page.locator('#tblAntreanNonBku tbody tr').count()) === 4,
    String(await page.locator('#tblAntreanNonBku tbody tr').count()));
  ok('filter aktif ditandai & tombol Reset muncul',
    /Filter aktif/.test(await page.locator('.period-bar').innerText()) && (await page.locator('.period-bar a:has-text("Reset")').count()) === 1);

  await page.goto(base + '/iuran/antrean?dari=2026-09-01&sampai=2026-09-30', { waitUntil: 'domcontentloaded' });
  ok('filter rentang tanggal menyisakan 4 penerimaan September', (await page.locator('#tblAntreanPending tbody tr').count()) === 4,
    String(await page.locator('#tblAntreanPending tbody tr').count()));
  ok('filter rentang tanggal mengosongkan riwayat Non-BKU September',
    (await page.locator('#tblAntreanNonBku tbody tr').count()) === 0);
  ok('input tanggal terisi sesuai filter',
    (await page.inputValue('form.period-bar input[name="dari"]')) === '2026-09-01'
    && (await page.inputValue('form.period-bar input[name="sampai"]')) === '2026-09-30');

  /* aksi masal: kembalikan Non-BKU ke antrean */
  await page.goto(base + '/iuran/antrean?bulan=2026-07', { waitUntil: 'domcontentloaded' });
  await page.click('#tblAntreanNonBku thead input[data-check-all-box]');
  ok('pilih semua mencentang baris Non-BKU', (await page.locator('#tblAntreanNonBku tbody input[name="ids"]:checked').count()) === 4,
    String(await page.locator('#tblAntreanNonBku tbody input[name="ids"]:checked').count()));
  ok('tombol masal Kembalikan ke Antrean aktif',
    await page.locator('button:has-text("Kembalikan ke Antrean")').first().isVisible());

  /* ==================================================================
     3. MOBILE 390px
     ================================================================== */
  console.log('\n[3] Tampilan mobile 390px');
  await page.close();
  page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', e => errors.push('mobile: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('mobile-console: ' + m.text()); });
  for (const [url, name] of [['/transaksi', 'Transaksi'], ['/iuran/antrean', 'Antrean Posting']]) {
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    const ovf = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`${name} tanpa overflow horizontal (390px)`, !ovf);
  }
  await page.goto(base + '/iuran/antrean', { waitUntil: 'domcontentloaded' });
  ok('bar filter tetap terbaca di mobile', await page.locator('form.period-bar').isVisible());
  await page.goto(base + '/transaksi', { waitUntil: 'domcontentloaded' });
  await page.click('button[data-open="mTrxIn"]');
  await page.waitForSelector('#mTrxIn.show');
  await page.locator('#mTrxIn input[data-pihak]').click();
  await page.waitForTimeout(200);
  const mobileMenuBox = await page.locator('body > [data-pihak-menu]').boundingBox();
  ok('dropdown pegawai tetap di dalam layar mobile',
    !!mobileMenuBox && mobileMenuBox.x >= 0 && mobileMenuBox.x + mobileMenuBox.width <= 391,
    mobileMenuBox ? `${Math.round(mobileMenuBox.x)}..${Math.round(mobileMenuBox.x + mobileMenuBox.width)}` : 'null');
  const mobileInputBox = await page.locator('#mTrxIn input[data-pihak]').boundingBox();
  ok('dropdown tetap menempel ke kolom nama di mobile',
    !!mobileInputBox && !!mobileMenuBox && Math.abs(mobileInputBox.x - mobileMenuBox.x) <= 2);

  ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n==================================================');
  console.log(`HASIL: ${pass} lulus, ${fail} gagal`);
  if (fail) { console.log('GAGAL:'); fails.forEach(f => console.log('  - ' + f)); }
  console.log('==================================================');
  await browser.close();
  db.close();
  srv.kill();
  if (fail && log) console.log('--- log server ---\n' + log.slice(-1500));
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error('ERROR TEST:', e);
  if (log) console.log(log.slice(-1500));
  try { srv.kill(); } catch (x) { }
  process.exit(1);
});
