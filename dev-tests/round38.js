'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* =====================================================================
   RONDE 38 (SIMKEU) — Tahun pelajaran mengikuti TANGGAL TRANSAKSI
   • simpan transaksi bertanggal tahun pelajaran lain → otomatis dibukukan
     pada BKU ber-nama sama di tahun pelajaran tanggal tersebut
   • saldo tahun pelajaran yang sedang dibuka TIDAK berubah
   • BKU padanan belum ada → ditolak dengan pesan jelas
   • tanggal di luar semua rentang → tetap di BKU pilihan + catatan
   • koreksi tanggal (edit) memindahkan transaksi antar tahun pelajaran
   • pindah saldo mengikuti tahun pelajaran tanggal
   • UI: catatan peringatan di bawah kolom tanggal + konfirmasi sebelum kirim
   Jalankan: node dev-tests/round38.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r38-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS_DB = path.join(TMP, 'saas.db');
const PORT = 3752;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS_DB, DEMO_DB_PATH: path.join(TMP, 'demo.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = { Cookie: cookie };
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v); }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const flashOf = (loc) => {
  try { const u = new URLSearchParams(String(loc).split('?')[1] || ''); return { ok: u.get('ok') || '', err: u.get('err') || '', warn: u.get('warn') || '', simpan: u.get('simpan') || '' }; }
  catch (e) { return { ok: '', err: '', warn: '', simpan: '' }; }
};

(async () => {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);

  const db = new Database(DB);
  const sql = (s, ...a) => db.prepare(s).run(...a);
  const one = (s, ...a) => db.prepare(s).get(...a);
  const all = (s, ...a) => db.prepare(s).all(...a);

  const ta1 = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1');
  ok('tahun pelajaran aktif awal terbaca', !!ta1, JSON.stringify(ta1));
  /* sesi dipastikan di TA1 */
  await req('POST', '/ta/pilih', { ta: ta1.id });

  /* ===== siapkan TA2 (2027/2028) + BKU padanan ===== */
  const idTa2 = Number(sql(`INSERT INTO tahun_ajaran(nama,tanggal_mulai,tanggal_selesai,aktif)
    VALUES('2027/2028','2027-07-01','2028-06-30',0)`).lastInsertRowid);
  const bkuTa1 = all('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 3', ta1.id);
  ok('TA1 memiliki minimal 3 BKU dana', bkuTa1.length >= 3, 'jumlah=' + bkuTa1.length);
  for (const b of bkuTa1) {
    sql(`INSERT INTO bku(nama,kode,jenis,tahun_ajaran_id,saldo_awal,status,urutan,auto_mode,created_at)
      VALUES(?,?,?,?,0,'aktif',?,0,?)`, b.nama, b.kode, b.jenis, idTa2, b.urutan || 1, new Date().toISOString());
  }
  const bkuTa2 = all('SELECT * FROM bku WHERE tahun_ajaran_id=? ORDER BY id', idTa2);
  ok('BKU padanan TA2 dibuat', bkuTa2.length === bkuTa1.length, `${bkuTa2.length}/${bkuTa1.length}`);
  const [b1, b2, b3] = bkuTa1;
  const p1 = bkuTa2.find(x => x.nama === b1.nama);   // padanan BKU Umum di TA2
  const p3 = bkuTa2.find(x => x.nama === b3.nama);

  /* ===== 1. simpan transaksi bertanggal TA2 saat sesi di TA1 ===== */
  console.log('\n== SIMPAN: TANGGAL MENENTUKAN TAHUN PELAJARAN ==');
  const coaMasuk = one("SELECT * FROM coa WHERE kategori='pendapatan' ORDER BY kode LIMIT 1");
  const coaKeluar = one("SELECT * FROM coa WHERE kategori='pengeluaran' ORDER BY kode LIMIT 1");
  let res = await req('POST', '/transaksi/save', {
    bku_id: b1.id, tanggal: '2027-09-15', jenis: 'pemasukan', metode: 'tunai',
    coa_id: coaMasuk.id, nominal: '1500000', uraian: 'Uji TA mengikuti tanggal', nama_pihak: 'Doni', after: 'saja'
  });
  let fl = flashOf(res.loc);
  ok('simpan sukses (303)', res.status === 303, res.status + ' ' + res.text.slice(0, 80));
  ok('pesan menyebut tahun pelajaran 2027/2028', /2027\/2028/.test(fl.ok), fl.ok || fl.err);
  const trx = one("SELECT * FROM transaksi WHERE uraian='Uji TA mengikuti tanggal'");
  ok('transaksi tersimpan', !!trx);
  ok('dibukukan pada BKU TA2 (bukan TA1)', trx && Number(trx.bku_id) === Number(p1.id), `bku=${trx && trx.bku_id} harusnya ${p1 && p1.id}`);
  ok('saldo BKU TA1 tidak berubah', Number(one('SELECT saldo_awal FROM bku WHERE id=?', b1.id).saldo_awal) === 0
    && all('SELECT * FROM transaksi WHERE bku_id=?', b1.id).length === 0);
  ok('no. bukti memakai kode BKU padanan', trx && String(trx.no_bukti).startsWith(p1.kode), trx && trx.no_bukti);

  /* ===== 2. tanggal di luar semua rentang ===== */
  console.log('\n== TANGGAL DI LUAR SEMUA RENTANG ==');
  res = await req('POST', '/transaksi/save', {
    bku_id: b3.id, tanggal: '2035-03-10', jenis: 'pemasukan', metode: 'tunai',
    coa_id: coaMasuk.id, nominal: '250000', uraian: 'Uji tanggal luar rentang', after: 'saja'
  });
  fl = flashOf(res.loc);
  const trxLuar = one("SELECT * FROM transaksi WHERE uraian='Uji tanggal luar rentang'");
  ok('transaksi luar rentang tetap tersimpan', !!trxLuar);
  ok('tetap pada BKU yang dipilih (TA1)', trxLuar && Number(trxLuar.bku_id) === Number(b3.id));
  ok('pesan menjelaskan tanggal di luar rentang', /di luar rentang/.test(fl.ok || fl.warn), fl.ok + ' | ' + fl.warn);

  /* ===== 3. TA tujuan belum punya BKU padanan ===== */
  console.log('\n== BKU PADANAN BELUM ADA ==');
  const idTa3 = Number(sql(`INSERT INTO tahun_ajaran(nama,tanggal_mulai,tanggal_selesai,aktif)
    VALUES('2030/2031','2030-07-01','2031-06-30',0)`).lastInsertRowid);
  const sebelumTolak = one('SELECT COUNT(*) c FROM transaksi').c;
  res = await req('POST', '/transaksi/save', {
    bku_id: b2.id, tanggal: '2030-09-01', jenis: 'pemasukan', metode: 'tunai',
    coa_id: coaMasuk.id, nominal: '90000', uraian: 'Uji tolak tanpa BKU', after: 'saja'
  });
  fl = flashOf(res.loc);
  ok('simpan ditolak dengan pesan jelas', res.status === 303 && /belum ada di tahun pelajaran tersebut/.test(fl.err), fl.err || fl.ok);
  ok('tidak ada transaksi tersimpan', one('SELECT COUNT(*) c FROM transaksi').c === sebelumTolak);
  ok('nama tahun pelajaran tujuan disebut', new RegExp('2030/2031').test(fl.err || ''), fl.err);

  /* ===== 4. edit: tanggal dipindah ke TA lain ===== */
  console.log('\n== EDIT / KOREKSI TANGGAL ==');
  res = await req('POST', '/transaksi/save', {
    id: trx.id, bku_id: b1.id, tanggal: '2026-11-20', jenis: 'pemasukan', metode: 'tunai',
    coa_id: coaMasuk.id, nominal: '1500000', uraian: 'Uji TA mengikuti tanggal', nama_pihak: 'Doni'
  });
  fl = flashOf(res.loc);
  const trxEdit = one('SELECT * FROM transaksi WHERE id=?', trx.id);
  ok('edit sukses', res.status === 303 && !fl.err, fl.err);
  ok('tanggal berubah', trxEdit && trxEdit.tanggal === '2026-11-20', trxEdit && trxEdit.tanggal);
  ok('transaksi kembali ke BKU TA1', trxEdit && Number(trxEdit.bku_id) === Number(b1.id), String(trxEdit && trxEdit.bku_id));

  /* ===== 5. pindah saldo mengikuti tanggal ===== */
  console.log('\n== PINDAH SALDO ==');
  res = await req('POST', '/transaksi/pindah', {
    dari_id: b1.id, ke_id: b3.id, tanggal: '2027-10-05', nominal: '100000', metode: 'tunai', keterangan: 'Uji pindah TA'
  });
  fl = flashOf(res.loc);
  const legTa2 = all("SELECT t.*, b.tahun_ajaran_id ta FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE t.uraian LIKE 'Pindah saldo%Uji pindah TA%'");
  ok('pindah saldo sukses', res.status === 303 && !fl.err, fl.err);
  ok('dua kaki transaksi dibuat', legTa2.length === 2, 'jumlah=' + legTa2.length);
  ok('kedua kaki berada di tahun pelajaran tanggal (TA2)', legTa2.every(x => Number(x.ta) === idTa2), JSON.stringify(legTa2.map(x => x.ta)));
  ok('pesan menyebut pemindahan tahun pelajaran', /2027\/2028/.test(fl.ok || ''), fl.ok);

  /* ===== 5b. posting antrean iuran juga mengikuti tanggal ===== */
  console.log('\n== POSTING ANTREAN IURAN ==');
  const isoNow = new Date().toISOString();
  const gid = Number(sql(`INSERT INTO iuran_grup(nama,jenis,tahun_ajaran_id,aktif,created_at)
    VALUES('Iuran Uji TA','bulanan',?,1,?)`, ta1.id, isoNow).lastInsertRowid);
  const tid = Number(sql(`INSERT INTO iuran_tagihan(grup_id,siswa_id,tahun_ajaran_id,nominal,created_at)
    VALUES(?,?,?,300000,?)`, gid, 99001, ta1.id, isoNow).lastInsertRowid);
  const bid = Number(sql(`INSERT INTO iuran_bayar(tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,bku_id,status,created_at)
    VALUES(?,?,'2027-11-10',300000,0,300000,'tunai',?,'pending',?)`, tid, 99001, b2.id, isoNow).lastInsertRowid);
  res = await req('POST', '/iuran/antrean/posting', { ids: [bid], bku_id: b2.id });
  fl = flashOf(res.loc);
  const trxIuran = one(`SELECT t.*, b.tahun_ajaran_id ta, b.nama bku_nama FROM transaksi t JOIN bku b ON b.id=t.bku_id
    WHERE t.uraian LIKE 'Iuran Uji TA%'`);
  ok('posting antrean iuran sukses', res.status === 303 && !!trxIuran, fl.err || fl.ok);
  ok('posting iuran masuk BKU tahun pelajaran tanggal pembayaran', trxIuran && Number(trxIuran.ta) === idTa2,
    trxIuran ? 'ta=' + trxIuran.ta + ' bku=' + trxIuran.bku_nama : 'tidak ada trx');
  ok('pesan posting menyebut tahun pelajaran tujuan', /2027\/2028/.test(fl.ok || ''), fl.ok);

  /* ===== 6. saldo & laporan TA1 tetap bersih dari transaksi TA2 ===== */
  const saldoTa1 = all(`SELECT COALESCE(SUM(CASE WHEN t.jenis='pemasukan' THEN t.nominal ELSE -t.nominal END),0) s
    FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE b.tahun_ajaran_id=? AND t.status='posted'`, ta1.id)[0].s;
  /* TA1 hanya berisi: +250.000 (tanggal luar rentang) dan +1.500.000 (hasil koreksi tanggal) */
  ok('mutasi TA1 hanya dari transaksi bertanggal TA1', Number(saldoTa1) === 1750000, 'saldo=' + saldoTa1);

  db.close();

  /* ===== 7. UI: catatan peringatan + konfirmasi ===== */
  console.log('\n== UI ==');
  const browser = await chromium.launch();
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxB.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: base }]);
  const page = await ctxB.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(base + '/transaksi', { waitUntil: 'networkidle' });

  const rangesAda = await page.evaluate(() => Array.isArray(window.__TA_RANGES) && window.__TA_RANGES.length);
  ok('halaman transaksi memuat rentang tahun pelajaran', !!rangesAda);
  ok('sesi tahun pelajaran dikirim ke klien', !!(await page.evaluate(() => window.__TA_SESI && window.__TA_SESI.id)));

  await page.click('button[data-open="mTrxIn"]');
  await page.waitForSelector('#mTrxIn.show');
  await page.fill('#mTrxIn input[name="tanggal"]', '2027-09-15');
  await page.waitForTimeout(400);
  const noteTxt = await page.locator('#mTrxIn [data-ta-note]').innerText().catch(() => '');
  ok('catatan peringatan muncul di bawah kolom tanggal', /2027\/2028/.test(noteTxt), noteTxt);

  await page.selectOption('#mTrxIn select[name="bku_id"]', String(b1.id));
  await page.selectOption('#mTrxIn select[name="coa_id"]', String(coaMasuk.id));
  await page.fill('#mTrxIn input[name="nominal"]', '120000');
  await page.fill('#mTrxIn textarea[name="uraian"]', 'Uji UI konfirmasi TA');

  let dialogMsg = '';
  page.once('dialog', async d => { dialogMsg = d.message(); await d.dismiss(); });
  await page.click('#mTrxIn button[name="after"][value="saja"]');
  await page.waitForTimeout(700);
  ok('dialog konfirmasi tampil sebelum menyimpan', /PERINGATAN TAHUN PELAJARAN/.test(dialogMsg), dialogMsg.slice(0, 80));
  ok('dialog menyebut tahun pelajaran tujuan', /2027\/2028/.test(dialogMsg), dialogMsg);
  const db2 = new Database(DB);
  ok('batal di dialog → transaksi tidak tersimpan', !db2.prepare("SELECT * FROM transaksi WHERE uraian='Uji UI konfirmasi TA'").get());

  page.once('dialog', async d => { await d.accept(); });
  await page.click('#mTrxIn button[name="after"][value="saja"]');
  await page.waitForTimeout(1200);
  const trxUi = db2.prepare("SELECT t.*, b.tahun_ajaran_id ta FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE t.uraian='Uji UI konfirmasi TA'").get();
  ok('setuju di dialog → transaksi tersimpan di TA tanggal', !!(trxUi && Number(trxUi.ta) === idTa2), JSON.stringify(trxUi && trxUi.ta));
  const bodyTxt = await page.locator('body').innerText();
  ok('pesan sukses di halaman menyebut BKU tahun pelajaran tujuan', /2027\/2028/.test(bodyTxt));
  ok('tanpa error JS', errors.length === 0, errors[0]);
  db2.close();
  await browser.close();

  srv.kill();
  console.log(`\n== HASIL RONDE 38: ${pass} lulus, ${fail} gagal ==`);
  if (fail) { console.log('GAGAL:\n - ' + fails.join('\n - ')); process.exit(1); }
})();
