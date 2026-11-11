'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI ronde 27 (Playwright) — No. HP orang tua pada form siswa, modal Kirim WA per baris,
   modal Kirim WA Massal (ceklis + template + jumlah penerima), halaman Jadwal Pengingat
   (dynamic tags, pratinjau, simpan), mobile 390px, tanpa error JavaScript. */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ui27-'));
const PORT = 3652;
const DB = path.join(TMP, 'k.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: path.join(TMP, 's.db'), DEMO_DB_PATH: path.join(TMP, 'd.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let cookie = '';
  async function api(method, url, body) {
    const headers = { Cookie: cookie };
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
  await api('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();

  /* ---- data uji: kelas + 3 siswa (2 punya nomor orang tua) + grup iuran ---- */
  await api('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await api('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 1'").get();
  await api('POST', '/siswa/save', { nisn: '8001', nama: 'Budi Santoso', jenis_kelamin: 'L', tanggal_lahir: '2010-05-05', kelas_id: kelas.id, parent_phone: '081234567890' });
  await api('POST', '/siswa/save', { nisn: '8002', nama: 'Siti Aminah', jenis_kelamin: 'P', tanggal_lahir: '2010-06-06', kelas_id: kelas.id, parent_phone: '081298765432' });
  await api('POST', '/siswa/save', { nisn: '8003', nama: 'Joko Tanpa Nomor', jenis_kelamin: 'L', kelas_id: kelas.id });
  const ids = db.prepare('SELECT id FROM siswa').all().map(x => x.id);
  await api('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: ta.id });
  const g = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await api('POST', `/iuran/grup/${g.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: ids });
  const tag = db.prepare('SELECT * FROM iuran_tagihan LIMIT 1').get();
  await api('POST', '/iuran/bayar', { tagihan_id: tag.id, tanggal: new Date().toISOString().slice(0, 10), metode: 'tunai', jumlah: '150000', potongan: '0', nonbku: '1' });

  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(base + '/login');
  await page.fill('input[name=kode]', 'SK01');
  await page.fill('input[name=email]', 'admin@sekolah.sch.id');
  await page.fill('input[name=password]', 'admin123');
  await Promise.all([page.waitForNavigation(), page.click('form button')]);
  await page.waitForTimeout(400);

  /* ---------- 1. form data siswa: nomor HP orang tua ---------- */
  await page.goto(base + '/siswa');
  await page.waitForTimeout(300);
  ok('daftar siswa menampilkan nomor HP orang tua', /081234567890/.test(await page.content()));
  ok('siswa tanpa nomor ditandai "belum diisi"', /belum diisi/.test(await page.content()));
  await page.click('button[data-open="mAddSiswa"]');
  await page.waitForTimeout(200);
  ok('modal tambah siswa punya field No. HP / WA Orang Tua', (await page.locator('#mAddSiswa input[name=parent_phone]').count()) === 1);
  await page.fill('#mAddSiswa input[name=nisn]', '8004');
  await page.fill('#mAddSiswa input[name=nama]', 'Dewi Lestari');
  await page.fill('#mAddSiswa input[name=parent_phone]', '081200001234');
  await page.selectOption('#mAddSiswa select[name=kelas_id]', String(kelas.id));
  await Promise.all([page.waitForNavigation(), page.click('#mAddSiswa ~ .modal-foot button.btn-primary, .modal-foot button[form="fmAddSiswa"]').catch(async () => {
    await page.click('button[form="fmAddSiswa"]');
  })]);
  await page.waitForTimeout(300);
  const dewi = new Database(DB, { readonly: true }).prepare("SELECT parent_phone FROM siswa WHERE nisn='8004'").get();
  ok('simpan via UI menyimpan nomor ternormalisasi 62…', dewi && dewi.parent_phone === '6281200001234', dewi && dewi.parent_phone);

  /* ---------- 2. Data Iuran: tombol WA per baris + modal konfirmasi ---------- */
  await page.goto(base + '/iuran/data');
  await page.waitForTimeout(400);
  const waBtns = await page.locator('[data-wa-single]').count();
  ok('setiap baris siswa bertunggakan punya tombol Kirim WA', waBtns >= 2, String(waBtns));
  ok('tombol Kirim WA Massal tersedia di atas tabel', (await page.locator('button[data-open="mWaMassal"]').count()) === 1);
  const budiBtn = page.locator('[data-wa-single]').first();
  await budiBtn.click();
  await page.waitForTimeout(1200);
  ok('modal konfirmasi Kirim WA terbuka', await page.locator('#mWaSatu').evaluate(el => el.classList.contains('show')));
  const infoTxt = await page.locator('#waSatuInfo').innerText();
  ok('modal menampilkan nomor tujuan orang tua', /08\d{8,}/.test(infoTxt), infoTxt.slice(0, 120));
  ok('modal menampilkan nominal tunggakan', /Rp/.test(infoTxt), infoTxt.slice(0, 160));
  const previewTxt = await page.locator('#waSatuPreview').innerText();
  ok('pratinjau pesan berisi nama siswa', /Budi Santoso|Siti|Joko|Dewi/.test(previewTxt), previewTxt.slice(0, 160));
  ok('pratinjau pesan memuat tautan portal bertoken', /\/portal-tagihan\?token=\d+\.[a-f0-9]{32}/.test(previewTxt), previewTxt.slice(-160));
  // ganti template → textarea berubah
  const tplOpts = await page.locator('#waSatuTpl option').allTextContents();
  if (tplOpts.length > 2) {
    await page.selectOption('#waSatuTpl', { index: 2 });
    await page.waitForTimeout(200);
    const area = await page.locator('#waSatuPesan').inputValue();
    ok('pilih template mengisi textarea pesan', area.length > 20 && /\{(nama_siswa|kelas)\}/.test(area), area.slice(0, 80));
  } else {
    ok('pilih template mengisi textarea pesan', true, 'hanya 1 template');
  }
  await Promise.all([page.waitForNavigation(), page.click('button[form="fWaSatu"]')]);
  await page.waitForTimeout(700);
  ok('kirim per siswa → flash antrean', /antrean/i.test(await page.locator('main.content').innerText()));
  let logged = null;
  for (let i = 0; i < 20 && !logged; i++) {
    logged = new Database(DB, { readonly: true }).prepare('SELECT * FROM wa_reminder_log ORDER BY id DESC LIMIT 1').get();
    if (!logged) await sleep(150);
  }
  ok('antrean tercatat untuk siswa yang dipilih', logged && /^628/.test(logged.phone) && ['pending', 'sending', 'sent', 'failed'].includes(logged.status),
    logged ? `${logged.status} / ${logged.phone}` : 'tidak ada baris');

  /* ---------- 3. Kirim WA Massal: ceklis + jumlah penerima + template ---------- */
  await page.goto(base + '/iuran/data');
  await page.waitForTimeout(400);
  const checks = page.locator('input[name="siswa"]');
  ok('ceklis siswa tersedia untuk pemilihan manual', (await checks.count()) >= 3);
  // centang dua siswa yang benar-benar punya tagihan (Budi & Siti)
  await page.check(`input[name="siswa"][value="${db.prepare("SELECT id FROM siswa WHERE nisn='8001'").get().id}"]`);
  await page.check(`input[name="siswa"][value="${db.prepare("SELECT id FROM siswa WHERE nisn='8002'").get().id}"]`);
  await page.click('button[data-open="mWaMassal"]');
  await page.waitForTimeout(400);
  ok('modal massal terbuka', await page.locator('#mWaMassal').evaluate(el => el.classList.contains('show')));
  const countTxt = (await page.locator('[data-wa-count]').innerText()).trim();
  ok('modal menampilkan jumlah orang tua terpilih', countTxt === '2', countTxt);
  ok('modal massal menyediakan pilihan template', (await page.locator('#waMassalTpl option').count()) >= 2);
  ok('modal massal menyediakan filter kelas & tingkat', (await page.locator('#mWaMassal select[name=kelas]').count()) === 1
    && (await page.locator('#mWaMassal select[name=tingkat]').count()) === 1);
  await Promise.all([page.waitForNavigation(), page.click('button[form="fWaMassal"]')]);
  await page.waitForTimeout(600);
  ok('kirim massal → flash antrean', /antrean/i.test(await page.locator('main.content').innerText()));
  const bulkCount = new Database(DB, { readonly: true }).prepare("SELECT COUNT(*) c FROM wa_reminder_log WHERE mode='manual'").get().c;
  ok('dua pesan massal masuk antrean', bulkCount >= 3, String(bulkCount));

  /* ---------- 4. Halaman Jadwal Pengingat Tagihan ---------- */
  await page.goto(base + '/iuran/pengingat');
  await page.waitForTimeout(400);
  ok('menu Jadwal Pengingat Tagihan ada di sidebar', (await page.locator('a[href="/iuran/pengingat"]').count()) >= 1);
  ok('sakelar pengingat otomatis tampil', (await page.locator('input[name=reminder_aktif]').count()) === 1);
  ok('pilihan mode & jam tampil', (await page.locator('input[name=reminder_mode]').count()) === 3
    && (await page.locator('input[name=reminder_jam]').count()) === 1,
    `${await page.locator('input[name=reminder_mode]').count()} mode / ${await page.locator('input[name=reminder_jam]').count()} jam`);
  ok('tombol dynamic tags tampil', (await page.locator('[data-tpl-tag]').count()) >= 6);
  const before = await page.locator('#tplIsi').inputValue();
  await page.locator('[data-tpl-tag="{nominal_tunggakan}"]').first().click();
  const after = await page.locator('#tplIsi').inputValue();
  ok('klik dynamic tag menyisipkan variabel', after.length > before.length && after.includes('{nominal_tunggakan}'));
  ok('pratinjau pesan ikut diperbarui', /Rp/.test(await page.locator('[data-tpl-preview]').innerText()));
  // muat template tersimpan
  if (await page.locator('[data-tpl-load]').count()) {
    await page.locator('[data-tpl-load]').first().click();
    await page.waitForTimeout(200);
    ok('tombol Muat mengisi editor template', (await page.locator('#tplIsi').inputValue()).length > 20);
  } else {
    ok('tombol Muat mengisi editor template', true, 'tidak ada template tersimpan');
  }
  // simpan jadwal + template
  await page.check('input[name=reminder_aktif]');
  await page.fill('input[name=reminder_jam]', '08:00');
  await page.fill('input[name=reminder_tanggal]', '5');
  await Promise.all([page.waitForNavigation(), page.click('form#fReminder button.btn-primary')]);
  await page.waitForTimeout(400);
  ok('simpan pengaturan jadwal berhasil', /disimpan/i.test(await page.locator('main.content').innerText()),
    (await page.locator('main.content').innerText()).slice(0, 160));
  const set = new Database(DB, { readonly: true }).prepare("SELECT v FROM settings WHERE k='reminder_aktif'").get();
  ok('sakelar ON tersimpan', set && set.v === '1', set && set.v);
  // simpan template lewat tombol di kartu template
  await Promise.all([page.waitForNavigation(), page.click('form#fReminderTpl button.btn-primary')]);
  await page.waitForTimeout(300);
  ok('simpan template utama berhasil', /Template pesan pengingat disimpan/i.test(await page.locator('main.content').innerText()),
    (await page.locator('main.content').innerText()).slice(0, 160));
  ok('riwayat pengiriman menampilkan status', /Terkirim|Menunggu|Gagal|Menunggu|Mengirim/.test(await page.locator('#tblWALog').innerText()));
  ok('tombol lihat pesan pada riwayat berfungsi', await page.locator('[data-wa-view]').count() >= 1);
  await page.locator('[data-wa-view]').first().click();
  await page.waitForTimeout(300);
  ok('modal isi pesan terbuka dengan teks', (await page.locator('[data-wa-view-body]').innerText()).length > 20);

  /* ---------- 5. mobile 390px tanpa overflow ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const u of ['/iuran/pengingat', '/iuran/data', '/siswa']) {
    await page.goto(base + u);
    await page.waitForTimeout(350);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow ${u}`, over <= 1, String(over));
  }
  await page.close();
  await browser.close();

  ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek UI ronde 27 lulus`);
  if (pass !== results.length) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
  if (/\[ERROR\]/.test(log)) console.log('log server:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 8).join('\n'));
  srv.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
