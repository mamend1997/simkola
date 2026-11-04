'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test UI ronde 14 (Playwright):
   1. Live search filter Data Iuran bekerja tanpa klik [Terapkan]
   2. Halaman detail iuran: pemilih TA hanya menampilkan data satu tahun pelajaran
   3. Menu "Sisa Tagihan Siswa Lulus" sudah tidak ada
   4. Halaman cetak kwitansi: kop ringkas tampil, tanpa scroll horizontal
*/
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3698;
const DB = process.env.R14UI_DB || path.join(os.tmpdir(), 'smk-r14ui-' + Date.now() + '.sqlite');
const APP = path.join(__dirname, '..');
const srv = spawn(process.execPath, [path.join(APP, 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => u.append(k, x)); else u.append(k, v); }
    payload = u.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !cookie) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(120); }
  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  /* data uji: 3 siswa + 1 grup iuran */
  await req('POST', '/kelas/save', { nama: 'X UI', tingkat: 'X', tahun_ajaran_id: ta.id });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X UI'").get();
  for (const [nisn, nama] of [['900001', 'Ahmad Fauzi'], ['900002', 'Budi Santoso'], ['900003', 'Citra Dewi']]) {
    await req('POST', '/siswa/save', { nisn, nama, jenis_kelamin: 'L', kelas_id: kelas.id });
  }
  await req('POST', '/iuran/save', { nama: 'SPP UI', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '100000', aktif: '1', tahun_ajaran_id: ta.id });
  const grup = db.prepare("SELECT * FROM iuran_grup WHERE nama='SPP UI'").get();
  const ids = db.prepare("SELECT id FROM siswa WHERE nisn LIKE '9000%'").all().map(x => String(x.id));
  await req('POST', `/iuran/grup/${grup.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: ids });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='900001'").get();
  ok('data uji siap', db.prepare('SELECT COUNT(*) c FROM iuran_tagihan WHERE grup_id=?').get(grup.id).c === 3);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const [cn, cv] = [cookie.split('=')[0], cookie.slice(cookie.indexOf('=') + 1)];
  page.on('pageerror', e => ok('tanpa error JS: ' + e.message, false));
  await page.context().addCookies([{ name: cn, value: cv, url: base }]);

  /* ---------- 1. live search ---------- */
  await page.goto(base + `/iuran/data?ta=${ta.id}`, { waitUntil: 'load' });
  const countRows = () => page.$$eval('#tblDataIuran tbody tr', rows => rows.filter(r => r.offsetParent !== null && r.textContent.trim()).length);
  const before = await countRows();
  await page.fill('form.filterbar input[name="q"]', 'Citra');
  await page.waitForTimeout(250);
  const after = await countRows();
  const names = await page.$$eval('#tblDataIuran tbody tr', rows => rows.filter(r => r.offsetParent !== null).map(r => r.textContent));
  ok('filter live: baris menyusut tanpa submit', after < before && after >= 1, `${before} → ${after}`);
  ok('filter live: hanya nama cocok', names.every(t => /Citra/i.test(t)), names.join(' | ').slice(0, 120));
  ok('filter live: tombol Terapkan masih ada', await page.locator('button:has-text("Terapkan")').count() > 0);
  await page.fill('form.filterbar input[name="q"]', '');
  await page.waitForTimeout(200);
  ok('filter live: dikosongkan → semua baris kembali', (await countRows()) === before, `${await countRows()} vs ${before}`);

  /* ---------- 2. detail: pemilih TA ---------- */
  await page.goto(base + `/iuran/data/${siswa.id}?ta=${ta.id}`, { waitUntil: 'load' });
  ok('detail: pemilih TA tampil', await page.locator('.card-head select[name="ta"]').count() === 1);
  ok('detail: menampilkan TA terpilih', (await page.locator('.card-head .sub').first().innerText()).includes(ta.nama));

  /* ---------- 3. menu lulus hilang ---------- */
  const navText = await page.locator('.sidebar').innerText();
  ok('menu Sisa Tagihan Siswa Lulus hilang', !/Sisa Tagihan Siswa Lulus/i.test(navText));
  ok('menu Data Iuran tetap ada', /Data Iuran/i.test(navText));

  /* ---------- 4. kwitansi transaksi ---------- */
  const bku = db.prepare('SELECT * FROM bku ORDER BY id LIMIT 1').get();
  const coa = db.prepare("SELECT id FROM coa WHERE kategori='pendapatan' LIMIT 1").get();
  await req('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: new Date().toISOString().slice(0, 10), jenis: 'pemasukan', metode: 'tunai',
    coa_id: coa.id, nominal: '150000', uraian: 'Uji UI kwitansi', nama_pihak: 'Wali Murid'
  });
  const trx = db.prepare('SELECT * FROM transaksi ORDER BY id DESC LIMIT 1').get();
  await page.goto(base + `/transaksi/${trx.id}/kwitansi`, { waitUntil: 'load' });
  const kop = await page.locator('.kwit-kop').boundingBox();
  ok('kwitansi: kop ringkas tampil', !!kop && kop.height > 20 && kop.height < 70, JSON.stringify(kop));
  ok('kwitansi: nama sekolah di kop', (await page.locator('.kwit-kop-nama').innerText()).toUpperCase().includes('SEKOLAH'));
  ok('kwitansi: logo ≤ 36px', (await page.locator('.kwit-kop img, .kwit-kop-ph').first().boundingBox()).height <= 36.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('kwitansi: tanpa scroll horizontal', overflow <= 1, String(overflow));
  const ttd = await page.locator('.sign-grid .space').first().boundingBox();
  ok('kwitansi: ruang TTD portrait A4 ±62px', Math.abs(ttd.height - 62) <= 4, String(ttd.height));
  await page.goto(base + `/transaksi/${trx.id}/kwitansi?orient=small`, { waitUntil: 'load' });
  const ttdS = await page.locator('.sign-grid .space').first().boundingBox();
  ok('kwitansi mode 1/3 F4: ruang TTD ±32px', Math.abs(ttdS.height - 32) <= 3, String(ttdS.height));

  /* ---------- 5. tidak ada error JS di halaman iuran ---------- */
  await page.goto(base + `/iuran/grup/${grup.id}?kelas=${kelas.id}`, { waitUntil: 'load' });
  ok('halaman penetapan grup terbuka', /Penetapan Grup ke Kelas/i.test(await page.content()));

  await page.close();
  await browser.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 14 lulus ===`);
  db.close(); srv.kill();
  if (pass !== results.length) { console.log('LOG SERVER:\n' + log.slice(-1200)); process.exit(1); }
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
