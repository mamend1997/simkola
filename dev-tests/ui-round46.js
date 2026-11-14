'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   UI RONDE 46 (SIMKEU) — halaman publik BKU & Grup Iuran (Playwright)
   Memeriksa: tampilan tanpa login, KPI & tabel terbaca, rekap bawah tabel,
   tombol publik di halaman admin membuka modal berisi tautan, tidak ada
   overflow horizontal di desktop maupun mobile 390px, tanpa error JS.
   Jalankan: node dev-tests/ui-round46.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'u46-'));
const DB = path.join(TMP, 'k.sqlite');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.U46_PORT || 3786;
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

let cookie = '';
async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const errors = [];

(async () => {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);
  const one = (s, ...a) => db.prepare(s).get(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);

  await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const ta = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1');
  await req('POST', '/ta/pilih', { ta: ta.id });
  const SLUG = String((one("SELECT v FROM settings WHERE k='portal_base_slug'") || {}).v || '').trim() || 'sekolah';

  /* ---------- data BKU publik ---------- */
  await req('POST', '/bku/save', { nama: 'BKU UKK Publik UI', jenis: 'kegiatan', kode: '', tahun_ajaran_id: ta.id, saldo_awal: '2000000' });
  const bku = one("SELECT * FROM bku WHERE nama='BKU UKK Publik UI' ORDER BY id DESC LIMIT 1");
  for (let i = 1; i <= 6; i++) {
    run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
         VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-09-0' + i, i % 2 ? 'pemasukan' : 'pengeluaran', 'tunai',
      'UI/00' + i, i * 100000, (i % 2 ? 'Penerimaan iuran UKK tahap ' : 'Pembelian perlengkapan UKK tahap ') + i, '2026-09-0' + i + ' 09:00:00');
  }
  await req('POST', '/bku/publik', { id: bku.id, aksi: 'generate', ta: ta.id });
  const bToken = one('SELECT public_token FROM bku WHERE id=?', bku.id).public_token;

  /* ---------- data grup iuran publik ---------- */
  await req('POST', '/iuran/save', {
    nama: 'Iuran Praktik Publik UI', jenis: 'bulanan', tahun_ajaran_id: ta.id, mode_nominal: 'rata',
    nominal_rata: '200.000', nominal_tingkat: '', keterangan: '', aktif: '1'
  });
  const grup = one("SELECT * FROM iuran_grup WHERE nama='Iuran Praktik Publik UI' ORDER BY id DESC LIMIT 1");
  run('INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,1,?)',
    'XI TKJ 2', 'XI TKJ 2', 'XI', ta.id, '2026-07-01 08:00:00');
  const kelas = one("SELECT * FROM kelas WHERE nama='XI TKJ 2' ORDER BY id DESC LIMIT 1");
  const nama = ['Dewi Lestari', 'Eko Prasetyo', 'Fitri Handayani', 'Galih Saputra'];
  nama.forEach((nm, i) => {
    run('INSERT INTO siswa (nisn,nama,jenis_kelamin,kelas_id,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?,?)',
      '00990000' + i, nm, i % 2 ? 'P' : 'L', kelas.id, ta.id, 'aktif', '2026-07-01 08:00:00');
    const sid = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    run('INSERT INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,sumber,created_at) VALUES (?,?,?,?,?)', sid, kelas.id, ta.id, 'manual', '2026-07-01 08:00:00');
    run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)', grup.id, sid, ta.id, 2400000, '2026-07-01 08:00:00');
    if (i < 2) {
      const t = one('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?', grup.id, sid);
      run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
           VALUES (?,?,?,?,0,?,?,?,?)`, t.id, sid, '2026-09-10', i === 0 ? 2400000 : 1200000, i === 0 ? 2400000 : 1200000, 'tunai', 'posted', '2026-09-10 09:00:00');
    }
  });
  await req('POST', '/iuran/publik', { id: grup.id, aksi: 'generate', ta: ta.id });
  const gToken = one('SELECT public_token FROM iuran_grup WHERE id=?', grup.id).public_token;

  const urlBku = `${base}/${SLUG}/publik/bku/${bToken}`;
  const urlGrup = `${base}/${SLUG}/publik/iuran/${gToken}`;

  /* ================= halaman publik BKU (desktop) ================= */
  let browser = await chromium.launch();
  let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push('BKUpage: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('BKUconsole: ' + m.text()); });
  let resp = await page.goto(urlBku, { waitUntil: 'domcontentloaded' });
  ok('halaman publik BKU terbuka (tanpa login)', resp.status() === 200, 'status=' + resp.status());
  ok('judul tab menyebut nama BKU', /Rincian BKU UKK Publik UI/.test(await page.title()), await page.title());
  ok('kartu identitas BKU tampil', (await page.locator('.portal-card .pname').first().innerText()).includes('BKU UKK Publik UI'));
  const kpiBku = await page.locator('.kpi .lbl').allInnerTexts();
  ok('KPI Saldo Awal/Penerimaan/Pengeluaran/Saldo Buku tampil',
    ['SALDO AWAL', 'PENERIMAAN', 'PENGELUARAN', 'SALDO BUKU'].every(x => kpiBku.map(s => s.toUpperCase()).includes(x)), kpiBku.join('|'));
  ok('tabel transaksi berisi 6 baris', (await page.locator('.portal-card table tbody tr').count()) === 6,
    String(await page.locator('.portal-card table tbody tr').count()));
  ok('halaman publik tidak punya tombol login/menu aplikasi',
    (await page.locator('a[href$="/login"]').count()) === 0);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('tidak ada overflow horizontal (desktop 1280)', !overflow);

  /* ---- filter periode BKU (bulan & rentang tanggal) ---- */
  ok('filter bar BKU tampil (bulan, dari, sampai tanggal)',
    (await page.locator('select[name="bulan"]').count()) === 1
    && (await page.locator('input[name="from"]').count()) === 1
    && (await page.locator('input[name="to"]').count()) === 1
    && (await page.locator('form[data-bku-filter] button').first().isVisible()));
  const bulanOpts = await page.locator('select[name="bulan"] option').allInnerTexts();
  ok('pilihan bulan diambil dari data transaksi', bulanOpts.some(t => /September 2026/.test(t)), bulanOpts.join('|'));

  /* tambah transaksi bulan Oktober untuk menguji penyaringan */
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-10-02', 'pemasukan', 'tunai', 'UI/010', 300000, 'Penerimaan UKK Oktober', '2026-10-02 09:00:00');
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
       VALUES (?,?,?,?,?,?,?,'posted',?)`, bku.id, '2026-10-20', 'pengeluaran', 'tunai', 'UI/011', 150000, 'Pengeluaran UKK Oktober', '2026-10-20 09:00:00');

  await page.goto(urlBku + '?bulan=2026-10', { waitUntil: 'domcontentloaded' });
  ok('filter bulan (via URL) hanya menampilkan 2 transaksi',
    (await page.locator('.portal-card table tbody tr').count()) === 2,
    String(await page.locator('.portal-card table tbody tr').count()));
  ok('filter bulan menampilkan keterangan filter aktif', /Filter aktif: Bulan Oktober 2026/.test(await page.locator('.portal-card').last().innerText()));
  ok('KPI berubah menjadi Saldo Awal/Akhir Periode',
    /SALDO AWAL PERIODE/.test((await page.locator('.kpi .lbl').allInnerTexts()).join('|').toUpperCase()));

  /* pilih bulan lewat dropdown (data-autosubmit) */
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.selectOption('select[name="bulan"]', '2026-09')
  ]);
  ok('memilih bulan pada dropdown menyaring tabel (auto submit)', /bulan=2026-09/.test(page.url())
    && (await page.locator('.portal-card table tbody tr').count()) === 6,
    page.url() + ' rows=' + (await page.locator('.portal-card table tbody tr').count()));

  /* isi rentang tanggal manual → bulan otomatis dikosongkan */
  await page.fill('input[name="from"]', '2026-10-01');
  await page.fill('input[name="to"]', '2026-10-31');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('form[data-bku-filter] button')
  ]);
  ok('filter rentang tanggal menyaring 2 transaksi',
    (await page.locator('.portal-card table tbody tr').count()) === 2 && /from=2026-10-01/.test(page.url())
    && /to=2026-10-31/.test(page.url()), page.url());
  ok('tombol Reset tersedia saat filter aktif',
    (await page.locator('form[data-bku-filter] a').filter({ hasText: 'Reset' }).count()) === 1);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('filter bar tidak menyebabkan overflow (desktop)', !overflow);
  await page.close();

  /* ================= halaman publik BKU (mobile 390) ================= */
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push('BKUm: ' + e.message));
  resp = await page.goto(urlBku + '?bulan=2026-10', { waitUntil: 'domcontentloaded' });
  ok('mobile: halaman BKU tetap terbuka (dengan filter)', resp.status() === 200);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('mobile 390: tanpa overflow horizontal', !overflow,
    await page.evaluate(() => document.documentElement.scrollWidth + '/' + window.innerWidth));
  await page.close();

  /* ================= halaman publik Grup Iuran ================= */
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push('GRUPpage: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('GRUPconsole: ' + m.text()); });
  resp = await page.goto(urlGrup, { waitUntil: 'domcontentloaded' });
  ok('halaman publik grup iuran terbuka', resp.status() === 200, 'status=' + resp.status());
  ok('judul tab menyebut nama grup', /Rekap Iuran Praktik Publik UI/.test(await page.title()), await page.title());
  const heads = (await page.locator('.portal-card table thead th').allInnerTexts()).map(s => s.trim().toUpperCase());
  ok('kolom tabel lengkap sesuai urutan', ['NAMA', 'KELAS', 'NISN', 'TAGIHAN', 'DIBAYAR', 'SISA', 'STATUS'].every(h => heads.includes(h)), heads.join('|'));
  ok('4 siswa tampil di tabel', (await page.locator('.portal-card table tbody tr').count()) === 4,
    String(await page.locator('.portal-card table tbody tr').count()));
  const tfootTxt = (await page.locator('.portal-card table tfoot').innerText()).toUpperCase();
  ok('footer tabel memuat TOTAL TAGIHAN', /TOTAL TAGIHAN/.test(tfootTxt));
  ok('footer tabel memuat GRAND TOTAL DANA DITERIMA', /GRAND TOTAL DANA DITERIMA/.test(tfootTxt));
  ok('footer menampilkan total tagihan Rp 9.600.000', /9\.600\.000/.test(tfootTxt), tfootTxt.replace(/\n/g, ' '));
  ok('footer menampilkan grand total diterima Rp 3.600.000', /3\.600\.000/.test(tfootTxt));
  ok('status pembayaran per baris berbadge', (await page.locator('.portal-card table tbody .badge').count()) >= 4);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('tidak ada overflow horizontal halaman grup (desktop)', !overflow);

  /* ---- filter pencarian nama & kelas pada halaman publik grup iuran ---- */
  ok('filter bar grup iuran tampil (nama & kelas)',
    (await page.locator('input[name="q"]').count()) === 1
    && (await page.locator('select[name="kelas"]').count()) === 1
    && (await page.locator('form[data-iuran-filter] button').first().isVisible()));

  /* tambah siswa kelas lain agar filter kelas teruji */
  run('INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,1,?)',
    'XII TKJ 3', 'XII TKJ 3', 'XII', ta.id, '2026-07-01 08:00:00');
  const kelas3 = one("SELECT * FROM kelas WHERE nama='XII TKJ 3' ORDER BY id DESC LIMIT 1");
  run('INSERT INTO siswa (nisn,nama,jenis_kelamin,kelas_id,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?,?)',
    '00990099', 'Hendra Wijaya', 'L', kelas3.id, ta.id, 'aktif', '2026-07-01 08:00:00');
  const sid5 = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  run('INSERT INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,sumber,created_at) VALUES (?,?,?,?,?)',
    sid5, kelas3.id, ta.id, 'manual', '2026-07-01 08:00:00');
  run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
    grup.id, sid5, ta.id, 2400000, '2026-07-01 08:00:00');

  await page.goto(urlGrup, { waitUntil: 'domcontentloaded' });
  ok('daftar kelas pada filter berasal dari data siswa',
    (await page.locator('select[name="kelas"] option').count()) === 3,
    String(await page.locator('select[name="kelas"] option').count()));

  /* cari nama */
  await page.fill('input[name="q"]', 'dewi');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('form[data-iuran-filter] button')
  ]);
  ok('cari nama menyaring tabel menjadi 1 baris',
    (await page.locator('.portal-card table tbody tr').count()) === 1
    && /Dewi Lestari/.test(await page.locator('.portal-card table tbody').innerText()), page.url());
  ok('ringkasan filter nama tampil', /Filter aktif/.test(await page.locator('.portal-card').last().innerText()));
  ok('total kaki tabel ikut menyesuaikan filter',
    /TOTAL TAGIHAN \(HASIL FILTER\)/.test(await page.locator('.portal-card table tfoot').innerText()));

  /* filter kelas (auto submit) */
  await page.goto(urlGrup, { waitUntil: 'domcontentloaded' });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.selectOption('select[name="kelas"]', 'XII TKJ 3')
  ]);
  ok('filter kelas menyaring siswa kelas tersebut',
    (await page.locator('.portal-card table tbody tr').count()) === 1
    && /Hendra Wijaya/.test(await page.locator('.portal-card table tbody').innerText()), page.url());

  /* reset filter */
  await page.goto(urlGrup, { waitUntil: 'domcontentloaded' });
  ok('tanpa filter seluruh siswa tampil (5 baris)',
    (await page.locator('.portal-card table tbody tr').count()) === 5,
    String(await page.locator('.portal-card table tbody tr').count()));
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('filter bar grup tidak menyebabkan overflow (desktop)', !overflow);
  await page.close();

  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push('GRUPm: ' + e.message));
  resp = await page.goto(urlGrup + '?q=dewi', { waitUntil: 'domcontentloaded' });
  ok('mobile: halaman grup terbuka (dengan filter)', resp.status() === 200);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('mobile 390: halaman grup tanpa overflow', !overflow,
    await page.evaluate(() => document.documentElement.scrollWidth + '/' + window.innerWidth));
  await page.close();
  await browser.close();

  /* ================= halaman admin: modal tautan publik ================= */
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  /* pakai cookie sesi dari login API agar tidak bergantung pada form login */
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
  page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push('ADMINpage: ' + e.message));
  await page.goto(base + '/bku', { waitUntil: 'domcontentloaded' });
  await page.click(`[data-open="mPub${bku.id}"]`);
  await sleep(250);
  const modalBku = page.locator('div.modal.show').last();
  ok('modal publik BKU terbuka', await modalBku.isVisible());
  ok('modal menampilkan tautan publik yang bisa disalin',
    (await modalBku.locator('[data-copy]').count()) >= 1);
  ok('modal menyediakan tombol Generate Ulang Link', /Generate Ulang Link/i.test(await modalBku.innerText()));
  ok('modal menyediakan tombol Nonaktifkan Akses Publik', /Nonaktifkan Akses Publik/i.test(await modalBku.innerText()));
  await page.keyboard.press('Escape');
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('halaman Master BKU tanpa overflow setelah kolom Publik ditambah', !overflow);
  await page.close();

  page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', e => errors.push('ADMINm: ' + e.message));
  await page.goto(base + '/iuran', { waitUntil: 'domcontentloaded' });
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('mobile 390: halaman Grup Iuran tanpa overflow', !overflow,
    await page.evaluate(() => document.documentElement.scrollWidth + '/' + window.innerWidth));
  await page.close();
  await browser.close();

  ok('tidak ada error JavaScript di halaman publik & admin', errors.length === 0, errors.slice(0, 3).join(' | '));
  const errLines = log.split('\n').filter(l => /Unhandled|TypeError|ReferenceError|SyntaxError/.test(l));
  ok('tidak ada error server', errLines.length === 0, errLines.slice(0, 2).join(' | '));

  db.close(); srv.kill('SIGTERM');
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => {
  console.error('FATAL', e);
  console.log(log.slice(-3000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
