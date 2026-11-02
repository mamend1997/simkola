'use strict';
/* UI test ronde 8 (Playwright): menu akordeon + pengaturan tampilan menu, ceklis item iuran,
   grid honor ekskul (tambah baris), layout mobile, tanpa error JS */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const PORT = 3597;
const DB = path.join(os.tmpdir(), 'smk-ui8-' + Date.now() + '.sqlite');
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

  // seed: kelas, siswa, grup iuran (bulanan) + pembayaran 1 bulan, honor ekskul pending
  await req('POST', '/program-keahlian/save', { nama: 'Akuntansi', program_studi: 'AKL', ketua: 'Ketua' });
  const Database = require('better-sqlite3');
  const db = new Database(DB);
  const prog = db.prepare('SELECT * FROM program_keahlian ORDER BY id DESC LIMIT 1').get();
  await req('POST', '/kelas/save', { nama: 'XI AKL 1', tingkat: 'XI', wali_kelas: 'Wali', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare('SELECT * FROM kelas ORDER BY id DESC LIMIT 1').get();
  await req('POST', '/siswa/save', { nisn: '7001', nama: 'Rina Uji', jenis_kelamin: 'P', tanggal_lahir: '2009-03-03', kelas_id: kelas.id });
  const siswa = db.prepare('SELECT * FROM siswa ORDER BY id DESC LIMIT 1').get();
  await req('POST', '/iuran/save', { nama: 'SPP Bulanan', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1' });
  const grup = db.prepare('SELECT * FROM iuran_grup ORDER BY id DESC LIMIT 1').get();
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: siswa.id });
  const tagihan = db.prepare('SELECT * FROM iuran_tagihan ORDER BY id DESC LIMIT 1').get();
  const bku = db.prepare("SELECT * FROM bku WHERE status='aktif' LIMIT 1").get();
  const today = new Date().toISOString().slice(0, 10);
  await req('POST', '/iuran/bayar', { tagihan_id: tagihan.id, bulan: '7', tanggal: today, jumlah: '150000', potongan: '0', metode: 'tunai', bku_id: bku.id, back: `/iuran/data/${siswa.id}` });
  await req('POST', '/ekskul/save-grid', { periode: today.slice(0, 7), jenis: 'Pramuka', nama_pembina: ['Pembina Satu'], kehadiran: ['4'], harga_satuan: ['50000'] });

  const browser = await chromium.launch();
  const errors = [];
  const sid = cookie.split('=').slice(1).join('=');
  async function mkContext(viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([{ name: 'simkeu_sid', value: sid, url: base }]);
    return ctx;
  }
  async function visit(url, fn, viewport = { width: 1280, height: 900 }) {
    const ctx = await mkContext(viewport);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(url + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(url + ' console: ' + m.text()); });
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    if (fn) await fn(page);
    await ctx.close();
  }
  const overflow = async page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  /* menu akordeon */
  await visit('/', async page => {
    ok('grup akordeon tampil', await page.locator('.nav-group').count() >= 5, String(await page.locator('.nav-group').count()));
    const before = await page.locator('.nav-group[data-navgroup="transaksi"] a').first().isVisible();
    ok('submenu non-aktif tertutup', !before);
    await page.click('[data-navtoggle="transaksi"]');
    ok('klik grup membuka submenu', await page.locator('.nav-group[data-navgroup="transaksi"] a').first().isVisible());
    ok('aria-expanded diperbarui', await page.getAttribute('[data-navtoggle="transaksi"]', 'aria-expanded') === 'true');
    await page.click('[data-navtoggle="transaksi"]');
    ok('klik ulang menutup submenu', !(await page.locator('.nav-group[data-navgroup="transaksi"] a').first().isVisible()));
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  await visit('/transaksi', async page => {
    ok('grup aktif otomatis terbuka', await page.locator('.nav-group[data-navgroup="transaksi"]').first().evaluate(el => el.classList.contains('open')));
  });

  /* pengaturan tampilan menu */
  await visit('/tampilan-menu', async page => {
    ok('halaman pengaturan menu', await page.locator('input[name="show"]').count() > 20, String(await page.locator('input[name="show"]').count()));
    await page.click('[data-check-group-none="nav"]');
    ok('tombol sembunyikan semua bekerja', (await page.locator('input[name="show"]:checked').count()) === 0);
    await page.click('[data-check-group-all="nav"]');
    ok('tombol tampilkan semua bekerja', (await page.locator('input[name="show"]:checked').count()) > 20);
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  /* detail iuran: ceklis item + tombol cetak/export */
  await visit(`/iuran/data/${siswa.id}`, async page => {
    const boxes = await page.locator('input[name="item"]').count();
    ok('ceklis item per bulan tersedia', boxes >= 12, String(boxes));
    await page.click('[data-check-all="item"]');
    ok('pilih semua item terpilih', (await page.locator('input[name="item"]:checked').count()) === boxes);
    await page.click('[data-check-none="item"]');
    ok('hapus ceklis bekerja', (await page.locator('input[name="item"]:checked').count()) === 0);
    ok('tombol cetak kwitansi terpilih ada', await page.locator('button:has-text("Cetak Kwitansi Terpilih")').count() === 1);
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  /* grid honor ekskul */
  await visit('/ekskul', async page => {
    await page.click('[data-open="mAddEkskul"]');
    ok('modal grid terbuka', await page.locator('#mAddEkskul.show').count() === 1);
    ok('satu baris awal', await page.locator('#mAddEkskul tr[data-ekskul-row]').count() === 1);
    await page.click('#mAddEkskul [data-ekskul-add-row]');
    ok('tambah baris grid', await page.locator('#mAddEkskul tr[data-ekskul-row]').count() === 2);
    const rows = page.locator('#mAddEkskul tr[data-ekskul-row]');
    await rows.nth(1).locator('[data-kehadiran]').fill('6');
    await rows.nth(1).locator('[data-harga]').fill('75000');
    const val = await rows.nth(1).locator('[data-jumlah]').inputValue();
    ok('jumlah baris baru dihitung otomatis', val === '450.000', val);
    await rows.nth(1).locator('[data-ekskul-del-row]').click();
    ok('hapus baris grid', await page.locator('#mAddEkskul tr[data-ekskul-row]').count() === 1);
  });

  await visit('/ekskul/antrean', async page => {
    ok('tombol edit antrean ada', await page.locator('button[data-open^="mQe"]').count() > 0);
    await page.locator('button[data-open^="mQe"]').first().click();
    ok('modal edit antrean terbuka', await page.locator('.modal.show').count() === 1);
    await page.keyboard.press('Escape');
  });

  /* siswa non-aktif massal */
  await visit('/siswa-nonaktif', async page => {
    ok('halaman non-aktif tanpa error', /Siswa Non-Aktif/.test(await page.title()));
    ok('tanpa overflow horizontal', (await overflow(page)) <= 2, String(await overflow(page)));
  });

  /* mobile */
  for (const p of ['/', '/iuran/data/' + siswa.id, '/tampilan-menu', '/ekskul', '/ekskul/antrean']) {
    const ctx = await mkContext({ width: 390, height: 780 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('mobile ' + p + ': ' + e.message));
    await page.goto(base + p, { waitUntil: 'domcontentloaded' });
    ok('mobile tanpa overflow ' + p, (await overflow(page)) <= 2, String(await overflow(page)));
    if (p === '/') {
      await page.click('#burger');
      ok('drawer mobile terbuka', await page.locator('#sidebar.open').count() === 1);
      await page.click('[data-navtoggle="iuran"]');
      ok('akordeon mobile berfungsi', await page.locator('.nav-group[data-navgroup="iuran"] a').first().isVisible());
    }
    await ctx.close();
  }

  ok('tanpa error JS', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek UI ronde 8 lulus ===`);
  if (fail.length) console.log(fail.map(f => '- ' + f.name).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); srv.kill(); process.exit(2); });
