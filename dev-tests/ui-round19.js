'use strict';
/* UI ronde 19 (Playwright): kwitansi pengeluaran (label & isi & tempat-tanggal), ikon portal slip
   proporsional, urutan tahun pelajaran portal, kolom Tempat di Desain Cetak, mobile 390px. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const PORT = 3650;
const DB = process.env.R19U_DB || path.join(os.tmpdir(), 'smk-r19u-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let cookie = '';
  async function api(method, url, body) {
    const headers = { Cookie: cookie };
    let payload = null;
    if (body) { payload = new URLSearchParams(body).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
  }
  await api('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);
  db.prepare("UPDATE settings SET v='SMK PGRI CIKONENG' WHERE k='sekolah_nama'").run();
  const today = new Date().toISOString().slice(0, 10);
  await api('POST', '/transaksi/save', {
    bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai', coa_id: '', nominal: '2750000',
    uraian: 'Belanja ATK & Fotokopi', nama_pihak: 'TOKO MAJU JAYA'
  });
  const trx = db.prepare("SELECT * FROM transaksi WHERE uraian='Belanja ATK & Fotokopi'").get();

  /* data portal: pegawai tanpa slip bulan berjalan + 2 tahun pelajaran */
  db.prepare("INSERT INTO pegawai (nama,jabatan,tipe,aktif,whatsapp,tanggal_lahir) VALUES (?,?,?,1,?,?)")
    .run('Guru Uji, S.Pd', 'Guru', 'guru', '081200000001', '1990-01-01');
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Guru Uji, S.Pd'").get();
  const old = new Date(); old.setMonth(old.getMonth() - 4);
  db.prepare("INSERT INTO payroll (periode,nama,jabatan,tipe,jam_efektif,jam_telat,honor_jam,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(`${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}`, 'Guru Uji, S.Pd', 'Guru', 'guru', 20, 0, 50000, today);
  const tok = 'uitest-token-19';
  db.prepare('DELETE FROM otp_code WHERE token=?').run(tok);
  db.prepare(`INSERT INTO otp_code (token,jenis,ref,phone,kode,expires_at,tries,verified,created_at)
    VALUES (?,?,?,?,?,?,0,1,?)`).run(tok, 'slip', String(pg.id), '6281200000001', '1111', '2030-01-01 00:00:00', today);

  await api('POST', '/tahun-ajaran/save', { nama: '2021/2022', tanggal_mulai: '2021-07-01', tanggal_selesai: '2022-06-30', buat_bku: '1' });
  const taLama = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2021/2022'").get();
  await api('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await api('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 1'").get();
  await api('POST', '/siswa/save', { nisn: '7100', nama: 'Bagas Pratama', jenis_kelamin: 'L', tanggal_lahir: '2010-03-03', kelas_id: kelas.id });
  const siswa = db.prepare("SELECT * FROM siswa WHERE nisn='7100'").get();
  for (const [nm, taId, nom] of [['SPP Lama', taLama.id, '100000'], ['SPP Baru', ta.id, '150000']]) {
    await api('POST', '/iuran/save', { nama: nm, jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: nom, aktif: '1', tahun_ajaran_id: taId });
    const g = db.prepare('SELECT * FROM iuran_grup WHERE nama=?').get(nm);
    await api('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: [siswa.id] });
  }

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  /* ---------- 1. kwitansi pengeluaran ---------- */
  await page.goto(base + '/login');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  await page.goto(`${base}/transaksi/${trx.id}/kwitansi`);
  const kwRows = await page.evaluate(() => [...document.querySelectorAll('.kwit-body .k, .kwit-body .v')].map(e => e.textContent.trim()));
  ok('baris pertama setelah kop = "Telah diterima dari"', kwRows[0] === 'Telah diterima dari', kwRows[0]);
  ok('isi baris pertama = "Bendahara SMK PGRI CIKONENG"', kwRows[1] === 'Bendahara SMK PGRI CIKONENG', kwRows[1]);
  const signText = await page.locator('.kwit-sign').innerText();
  ok('tanda tangan kanan memuat "Cikoneng, <tanggal>"', /Cikoneng, \d{1,2} \w+ \d{4}/.test(signText), signText.replace(/\n/g, ' | '));
  const overflowKw = await page.evaluate(() => {
    const box = document.querySelector('.kwit-box');
    return box ? Math.max(0, box.scrollWidth - box.clientWidth) : -1;
  });
  ok('kwitansi tidak melebar keluar kertas', overflowKw <= 1, String(overflowKw));

  /* ---------- 2. desain cetak: kolom tempat ---------- */
  await page.goto(base + '/desain-cetak');
  ok('kartu "Tempat pada Tanggal Cetak" tampil', await page.locator('input[name=print_tempat]').count() === 1);
  await page.fill('input[name=print_tempat]', 'Ciamis');
  await Promise.all([page.waitForNavigation(), page.click('button.btn-primary:has-text("Simpan Pengaturan Desain")')]);
  ok('simpan tempat berhasil', /disimpan/.test(await page.locator('main.content').innerText()));
  await page.goto(`${base}/transaksi/${trx.id}/kwitansi`);
  ok('kwitansi mengikuti tempat baru', /Ciamis, \d{1,2} \w+ \d{4}/.test(await page.locator('.kwit-sign').innerText()));
  // kembalikan
  await page.goto(base + '/desain-cetak');
  await page.fill('input[name=print_tempat]', 'Cikoneng');
  await Promise.all([page.waitForNavigation(), page.click('button.btn-primary:has-text("Simpan Pengaturan Desain")')]);

  /* ---------- 3. portal slip: ikon tanda seru proporsional ---------- */
  await page.goto(`${base}/portal-slip/hasil?token=${tok}`);
  const svgSizes = await page.evaluate(() => [...document.querySelectorAll('svg')].map(s => Math.round(s.getBoundingClientRect().width)));
  ok('tidak ada ikon raksasa di portal slip (semua < 24px)', svgSizes.every(w => w <= 24), JSON.stringify(svgSizes));
  const helpIcon = await page.evaluate(() => {
    const el = document.querySelector('.help svg');
    if (!el) return null; const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('ikon pada keterangan periode ±13px', helpIcon && helpIcon.w >= 10 && helpIcon.w <= 16, JSON.stringify(helpIcon));
  ok('halaman tetap menampilkan pesan "belum tersedia"', /belum tersedia/.test(await page.locator('.portal-wrap').innerText()));

  /* ---------- 4. portal tagihan siswa: urutan tahun ---------- */
  await page.goto(`${base}/portal?nama=${encodeURIComponent('Bagas Pratama')}&lahir=2010-03-03`);
  const taOrder = await page.evaluate(() => [...document.querySelectorAll('.portal-ta .ta-head b')].map(e => e.textContent.trim()));
  ok('portal menampilkan 2 tahun pelajaran', taOrder.length === 2, taOrder.join(' | '));
  ok('tahun terlama di paling atas', /2021\/2022/.test(taOrder[0] || '') && /2022\/2023|2026\/2027/.test(taOrder[1] || ''), taOrder.join(' | '));
  const over1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('portal desktop tanpa overflow', over1 <= 1, String(over1));
  await ctx.close();

  /* ---------- mobile 390px ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(String(e.message)));
  for (const u of [`/portal?nama=${encodeURIComponent('Bagas Pratama')}&lahir=2010-03-03`, `/portal-slip/hasil?token=${tok}`, '/desain-cetak']) {
    await p2.goto(base + u);
    const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow ${u.split('?')[0]}`, over <= 1, String(over));
  }
  await ctx2.close();
  await browser.close();

  ok('tanpa error JS di halaman uji', errors.length === 0, errors.slice(0, 3).join(' | '));

  srv.kill(); db.close();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek UI ronde 19 lulus ===`);
  if (pass !== results.length) { console.log('LOG:\n' + log.slice(-1200)); process.exit(1); }
})().catch(e => { console.error('FATAL', e); try { srv.kill(); } catch (_) { } process.exit(1); });
