'use strict';
/* =====================================================================
   RONDE 45 (SIMKEU) — INTEGRASI KASERA PAY
   ---------------------------------------------------------------------
   Cakupan:
     1. Adapter: POST /v1/transactions (Authorization Bearer, Idempotency-Key,
        Accept, Content-Type; body amount/external_id/description) →
        checkout_url; fallback /v1/qris bila endpoint transaksi tidak ada.
     2. Webhook /api/webhook/kasera: HMAC-SHA256 body MENTAH pada header
        `kasera-signature-v1`, deduplikasi per id event, event payment.paid →
        perpanjangan sekolah & iuran portal orang tua menjadi LUNAS.
     3. Keamanan: tanpa secret 503, tanda tangan salah 401, nominal kurang
        ditolak, rute dikecualikan dari CSRF, log event tampil di panel.
   Jalankan: node dev-tests/round45.js
   ===================================================================== */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = 3794;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r45-'));
const DB = path.join(DIR, 'k.sqlite');
const SAAS = path.join(DIR, 'saas.db');
const base = `http://127.0.0.1:${PORT}`;
const APP_DIR = path.join(__dirname, '..');

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { }
  return { status: r.status, text, json, loc: r.headers.get('location') || '' };
}
/** webhook mentah (tanpa cookie, body string apa adanya) */
async function hook(raw, sig) {
  const headers = { 'Content-Type': 'application/json' };
  if (sig !== undefined && sig !== null) headers['kasera-signature-v1'] = sig;
  const r = await fetch(base + '/api/webhook/kasera', { method: 'POST', headers, body: raw });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { }
  return { status: r.status, text, json };
}
const sign = (raw, secret) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

(async () => {
  /* =============== 1. UNIT TEST ADAPTER (sebelum server) =============== */
  console.log('\n== 1. ADAPTER KASERA PAY (unit) ==');
  const paygw = require('../paygw');
  ok('mode default API = auto', paygw.kaseraCfg({}).api === 'auto');
  ok('base production = https://pay.kasera.id', paygw.kaseraCfg({ mode: 'production' }).base === 'https://pay.kasera.id',
    paygw.kaseraCfg({ mode: 'production' }).base);
  ok('base sandbox tetap sandbox.kasera.id', paygw.kaseraCfg({ mode: 'sandbox' }).base === 'https://sandbox.kasera.id');
  ok('API key bisa dari env KASERA_API_KEY', (() => {
    process.env.KASERA_API_KEY = 'env-key';
    const v = paygw.kaseraCfg({}).key; delete process.env.KASERA_API_KEY; return v === 'env-key';
  })());

  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/v1/transactions')) {
      return { ok: true, status: 201, json: async () => ({ data: { id: 'trx-1', checkout_url: 'https://pay.kasera.id/c/abc', expires_at: '2099-01-01T00:00:00Z' } }) };
    }
    if (String(url).includes('/v1/transactions/')) {
      return { ok: true, status: 200, json: async () => ({ data: { status: 'PAID', amount: 150000 } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const trx = await paygw.kaseraCreateTransaction(
    { mode: 'production', key: 'ksr-abc', merchant: 'M-7', kasera_api: 'transactions' },
    { external_id: 'SK-1-ABC', amount: 150000.4, description: 'Langganan 1 bulan' }
  );
  ok('POST ke /v1/transactions', calls[0].url === 'https://pay.kasera.id/v1/transactions', calls[0].url);
  ok('header Authorization Bearer', calls[0].opts.headers.Authorization === 'Bearer ksr-abc');
  ok('header Idempotency-Key = nomor pesanan', calls[0].opts.headers['Idempotency-Key'] === 'SK-1-ABC',
    calls[0].opts.headers['Idempotency-Key']);
  ok('header Accept & Content-Type JSON',
    calls[0].opts.headers.Accept === 'application/json' && calls[0].opts.headers['Content-Type'] === 'application/json');
  const body = JSON.parse(calls[0].opts.body);
  ok('body amount integer (tanpa desimal)', body.amount === 150000, String(body.amount));
  ok('body external_id & description', body.external_id === 'SK-1-ABC' && body.description === 'Langganan 1 bulan', calls[0].opts.body);
  ok('checkout_url terbaca dari respons', trx.ok && trx.checkout_url === 'https://pay.kasera.id/c/abc', JSON.stringify(trx.error || ''));

  /* fallback QRIS bila endpoint transactions tidak tersedia */
  const mockAsli = global.fetch;
  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/v1/transactions')) return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    if (String(url).endsWith('/v1/qris')) {
      return { ok: true, status: 201, json: async () => ({ success: true, data: { qr_string: 'QR-LAMA', expires_at: '2099-01-01T00:00:00Z' } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const chargeFallback = await paygw.createCharge(
    { provider: 'kasera', mode: 'sandbox', base: 'https://sandbox.kasera.id', key: 'k', kasera_api: 'auto' },
    { order_id: 'SK-1-FB', amount: 1000, label: 'Uji' }
  );
  ok('endpoint transaksi tidak ada → otomatis pakai /v1/qris',
    chargeFallback.ok === true && chargeFallback.api === 'qris' && chargeFallback.qr_string === 'QR-LAMA',
    JSON.stringify({ ok: chargeFallback.ok, api: chargeFallback.api, err: chargeFallback.error }));
  ok('permintaan pertama tetap ke /v1/transactions', calls[0].url === 'https://sandbox.kasera.id/v1/transactions', calls[0].url);
  ok('permintaan kedua ke /v1/qris', (calls[1] || {}).url === 'https://sandbox.kasera.id/v1/qris', (calls[1] || {}).url);

  /* 401 (kunci salah) TIDAK di-fallback supaya tidak membuat tagihan ganda */
  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) };
  };
  const chargeDitolak = await paygw.createCharge(
    { provider: 'kasera', mode: 'sandbox', base: 'https://sandbox.kasera.id', key: 'k', kasera_api: 'auto' },
    { order_id: 'SK-1-401', amount: 1000 }
  );
  ok('kunci ditolak (401) → gagal tanpa fallback', chargeDitolak.ok === false && calls.length === 1,
    JSON.stringify({ calls: calls.length, err: chargeDitolak.error }));
  global.fetch = mockAsli;

  /* tanpa API key → error jelas tanpa request */
  calls.length = 0;
  const trx3 = await paygw.kaseraCreateTransaction({ key: '' }, { external_id: 'X', amount: 1000 });
  ok('tanpa API key → error jelas', trx3.ok === false && /API Key/.test(trx3.error) && calls.length === 0, trx3.error);

  /* status transaksi memakai endpoint transactions */
  calls.length = 0;
  const st = await paygw.kaseraCheckTransaction({ key: 'k', kasera_api: 'transactions' }, 'SK-1-ABC');
  ok('cek status /v1/transactions/{id} → lunas', st.ok && st.paid === true,
    JSON.stringify({ url: (calls[0] || {}).url, st }));
  global.fetch = origFetch;

  /* tanda tangan webhook */
  const rawContoh = '{"id":"ev-1","event":"payment.paid","data":{"external_id":"SK-1-A","amount":5000}}';
  const sigContoh = sign(rawContoh, 'whsec');
  ok('signature v1 valid diterima', paygw.kaseraVerifySignature(rawContoh, { 'kasera-signature-v1': sigContoh }, ['whsec']).ok === true);
  ok('signature salah ditolak', paygw.kaseraVerifySignature(rawContoh, { 'kasera-signature-v1': 'deadbeef' }, ['whsec']).ok === false);
  ok('header lain (x-kasera-signature) tetap kompatibel',
    paygw.kaseraVerifySignature(rawContoh, { 'x-kasera-signature': sigContoh }, ['whsec']).ok === true);
  ok('prefix sha256= diterima', paygw.kaseraVerifySignature(rawContoh, { 'kasera-signature-v1': 'sha256=' + sigContoh }, ['whsec']).ok === true);
  ok('tanpa secret → verifikasi gagal (bukan lolos)', paygw.kaseraVerifySignature(rawContoh, { 'kasera-signature-v1': sigContoh }, []).ok === false);
  ok('raw body beda → tanda tangan tidak cocok',
    paygw.kaseraVerifySignature(rawContoh + ' ', { 'kasera-signature-v1': sigContoh }, ['whsec']).ok === false);

  const ev = paygw.kaseraEvent(JSON.parse(rawContoh));
  ok('event payment.paid → paid + external_id', ev.paid === true && ev.external_id === 'SK-1-A' && ev.event_id === 'ev-1', JSON.stringify(ev));
  ok('event payment.expired → bukan lunas', paygw.kaseraEvent({ id: 'e2', event: 'payment.expired', data: { external_id: 'X' } }).paid === false);
  ok('verifyCallback menerima body mentah',
    paygw.verifyCallback({ provider: 'kasera', callback: 'whsec' }, JSON.parse(rawContoh), { 'kasera-signature-v1': sigContoh }, rawContoh) === true);
  ok('verifyCallback menolak tanda tangan salah',
    paygw.verifyCallback({ provider: 'kasera', callback: 'whsec' }, JSON.parse(rawContoh), { 'kasera-signature-v1': 'aa' }, rawContoh) === false);
  ok('parseCallback membaca envelope event',
    paygw.parseCallback({ provider: 'kasera' }, JSON.parse(rawContoh)).paid === true);

  /* CSRF: rute webhook harus terdaftar sebagai pengecualian */
  const srcServer = fs.readFileSync(path.join(APP_DIR, 'server.js'), 'utf8');
  ok('rute webhook dikecualikan dari CSRF', /CSRF_EXEMPT[\s\S]{0,400}'\/api\/webhook\/kasera'/.test(srcServer));

  /* =============== 2. SERVER + PENGATURAN =============== */
  const srv = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_DB_PATH: path.join(DIR, 'demo.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
      await sleep(200);
    }
    console.log('\n== 2. PENGATURAN GATEWAY DI PANEL SUPER ADMIN ==');
    const saasDb = new Database(SAAS);
    const admin = saasDb.prepare('SELECT email FROM saas_users ORDER BY id LIMIT 1').get();
    let r = await req('POST', '/super-admin/login', { email: admin.email, password: 'SuperAdmin2026!' });
    ok('login portal Super Admin', r.status === 303 && !/err=/.test(r.loc), r.loc);

    r = await req('GET', '/super-admin/qris');
    ok('halaman QRIS menampilkan blok Kasera', r.status === 200 && /data-pay-kasera-api/.test(r.text), 'HTTP ' + r.status);
    ok('URL webhook ditampilkan di panel', /\/api\/webhook\/kasera/.test(r.text));
    ok('pilihan API Kasera (auto/transactions/qris)',
      /value="transactions"/.test(r.text) && /value="auto"/.test(r.text) && /value="qris"/.test(r.text));

    r = await req('POST', '/super-admin/qris/pay', {
      pay_gateway_aktif: '1', pay_manual_aktif: '1',
      pay_gateway_provider: 'kasera', pay_gateway_mode: 'sandbox',
      pay_gateway_key: 'ksr-uji-45', pay_gateway_callback: 'whsec-uji-45',
      pay_gateway_kasera_api: 'transactions', pay_gateway_expire_menit: '60'
    });
    ok('simpan kredensial Kasera', r.status === 303 && /ok=/.test(decodeURIComponent(r.loc)), r.loc);
    const g = k => String((saasDb.prepare('SELECT v FROM saas_settings WHERE k=?').get(k) || {}).v || '');
    ok('Webhook Secret tersimpan', g('pay_gateway_callback') === 'whsec-uji-45', g('pay_gateway_callback'));
    ok('mode API Kasera tersimpan', g('pay_gateway_kasera_api') === 'transactions', g('pay_gateway_kasera_api'));
    ok('secret tidak dikirim balik ke HTML', (await req('GET', '/super-admin/qris')).text.indexOf('whsec-uji-45') === -1);

    /* =============== 3. WEBHOOK: PERPANJANGAN =============== */
    console.log('\n== 3. WEBHOOK payment.paid → PERPANJANGAN SEKOLAH ==');
    const tenant = saasDb.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
    saasDb.prepare("UPDATE tenants SET is_lifetime_free=0, expires_at='2026-11-20', status='active' WHERE id=?").run(tenant.id);
    const awal = saasDb.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenant.id).expires_at;
    const order = `SK-${tenant.id}-UJI45`;
    const now = '12-11-2026 10:00:00';
    saasDb.prepare(`INSERT INTO saas_payments
      (tenant_id,paket_tujuan,no_invoice,jenis,durasi,nominal,status,source,periode_mulai,dibuat_at,created_at,channel,provider,order_id,gateway_status)
      VALUES(?,?,?,?,?,?,'pending','tenant',?,?,?,'gateway','kasera',?,'PENDING')`)
      .run(tenant.id, 'standard', 'INV-UJI45', 'perpanjangan', 30, 150000, '2026-11-20', now, now, order);

    const raw = JSON.stringify({ id: 'evt-45-1', event: 'payment.paid', data: { external_id: order, amount: 150000, status: 'PAID' } });
    let h = await hook(raw, null);
    ok('tanpa tanda tangan → 401 (ditolak)', h.status === 401, 'HTTP ' + h.status);
    h = await hook(raw, 'tidak-valid');
    ok('tanda tangan salah → 401', h.status === 401, 'HTTP ' + h.status);
    ok('event tidak dicatat saat tanda tangan salah',
      !saasDb.prepare('SELECT event_id FROM kasera_event WHERE event_id=?').get('evt-45-1'));

    h = await hook(raw, sign(raw, 'whsec-uji-45'));
    ok('tanda tangan valid → 200 & lunas', h.status === 200 && h.json && h.json.paid === true, h.text.slice(0, 160));
    const st1 = saasDb.prepare('SELECT status,gateway_status FROM saas_payments WHERE order_id=?').get(order);
    ok('pembayaran menjadi approved', st1.status === 'approved', JSON.stringify(st1));
    const akhir = saasDb.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenant.id).expires_at;
    ok('masa aktif sekolah diperpanjang otomatis', akhir > awal, `${awal} → ${akhir}`);
    ok('audit WEBHOOK KASERA tercatat',
      saasDb.prepare("SELECT COUNT(*) c FROM saas_audit WHERE aksi='WEBHOOK KASERA'").get().c >= 1);

    /* deduplikasi: event yang sama dikirim ulang */
    h = await hook(raw, sign(raw, 'whsec-uji-45'));
    ok('event ganda → duplicate (tidak diproses dua kali)', h.status === 200 && h.json && h.json.duplicate === true, h.text.slice(0, 160));
    const akhir2 = saasDb.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenant.id).expires_at;
    ok('masa aktif TIDAK bertambah dua kali', akhir2 === akhir, `${akhir} → ${akhir2}`);

    /* urutan pesanan tak dikenal */
    const raw404 = JSON.stringify({ id: 'evt-45-x', event: 'payment.paid', data: { external_id: 'SK-999-TIDAKADA', amount: 1000 } });
    h = await hook(raw404, sign(raw404, 'whsec-uji-45'));
    ok('nomor pesanan tak dikenal → 404', h.status === 404, 'HTTP ' + h.status);

    /* nominal kurang dari tagihan */
    const order2 = `SK-${tenant.id}-UJI45B`;
    saasDb.prepare(`INSERT INTO saas_payments
      (tenant_id,paket_tujuan,no_invoice,jenis,durasi,nominal,status,source,periode_mulai,dibuat_at,created_at,channel,provider,order_id,gateway_status)
      VALUES(?,?,?,?,?,?,'pending','tenant',?,?,?,'gateway','kasera',?,'PENDING')`)
      .run(tenant.id, 'standard', 'INV-UJI45B', 'perpanjangan', 30, 150000, '2026-11-20', now, now, order2);
    const rawKurang = JSON.stringify({ id: 'evt-45-2', event: 'payment.paid', data: { external_id: order2, amount: 10000 } });
    h = await hook(rawKurang, sign(rawKurang, 'whsec-uji-45'));
    ok('nominal lebih kecil → 400 & tidak dilunasi', h.status === 400
      && saasDb.prepare('SELECT status FROM saas_payments WHERE order_id=?').get(order2).status === 'pending',
      h.text.slice(0, 120));

    /* event bukan pelunasan */
    const rawExp = JSON.stringify({ id: 'evt-45-3', event: 'payment.expired', data: { external_id: order2, status: 'EXPIRED' } });
    h = await hook(rawExp, sign(rawExp, 'whsec-uji-45'));
    ok('payment.expired → 200 tapi belum lunas', h.status === 200 && h.json && h.json.paid === false, h.text.slice(0, 120));

    /* =============== 4. WEBHOOK: IURAN PORTAL =============== */
    console.log('\n== 4. WEBHOOK payment.paid → IURAN PORTAL ORANG TUA ==');
    cookie = '';
    r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
    ok('login admin sekolah', r.status === 303 && !/err=/.test(r.loc), r.loc);
    /* buka halaman pembayaran online agar tabel iuran_* siap */
    r = await req('GET', '/pembayaran-online');
    ok('halaman Pembayaran Online terbuka', r.status === 200, 'HTTP ' + r.status);
    ok('pengaturan Kasera sekolah tampil', /bayar_kasera_api/.test(r.text) && /\/api\/webhook\/kasera/.test(r.text));
    r = await req('POST', '/pembayaran-online/simpan', {
      bayar_gateway_aktif: '1', bayar_manual_aktif: '1', bayar_provider: 'kasera', bayar_mode: 'sandbox',
      bayar_key: 'ksr-sekolah-45', bayar_key2: 'whsec-sekolah-45', bayar_kasera_api: 'transactions'
    });
    ok('simpan pengaturan gateway sekolah', r.status === 303 && /ok=/.test(decodeURIComponent(r.loc)), r.loc);

    const tenantDbFile = path.resolve(APP_DIR, tenant.db_file);
    const T = new Database(tenantDbFile);
    const ta = T.prepare('SELECT id FROM tahun_ajaran ORDER BY id LIMIT 1').get();
    const siswa = T.prepare("INSERT INTO siswa(nisn,nama,jenis_kelamin,status,tahun_ajaran_id,created_at) VALUES(?,?,?, 'aktif',?,datetime('now'))")
      .run('0099001', 'Siswa Uji Kasera', 'L', ta ? ta.id : null);
    const tag = T.prepare('INSERT INTO iuran_tagihan(grup_id,siswa_id,tahun_ajaran_id,nominal,potongan,created_at) VALUES(?,?,?,?,0,datetime(\'now\'))')
      .run(1, Number(siswa.lastInsertRowid), ta ? ta.id : null, 250000);
    const iOrder = `IU${tenant.id}-UJI45`;
    T.prepare(`INSERT INTO iuran_checkout(siswa_id,nama,kelas,items,total,metode,status,provider,order_id,gateway_status,ta_id,created_at)
      VALUES(?,?,?,?,?, 'gateway','menunggu','kasera',?,'PENDING',?,datetime('now'))`)
      .run(Number(siswa.lastInsertRowid), 'Siswa Uji Kasera', 'X TKJ 1',
        JSON.stringify([{ tagihan_id: Number(tag.lastInsertRowid), nominal: 250000, label: 'SPP Juli' }]),
        250000, iOrder, ta ? ta.id : null);
    T.close();

    const rawIuran = JSON.stringify({
      id: 'evt-45-iuran', event: 'payment.paid',
      data: { external_id: iOrder, amount: 250000, status: 'PAID' }
    });
    /* secret sekolah (bayar_key2) harus diterima untuk order IU… */
    h = await hook(rawIuran, sign(rawIuran, 'whsec-sekolah-45'));
    ok('webhook iuran memakai secret sekolah → 200', h.status === 200 && h.json && h.json.paid === true
      && h.json.sasaran === 'iuran', h.text.slice(0, 180));
    const T2 = new Database(tenantDbFile, { readonly: true });
    const co = T2.prepare('SELECT status FROM iuran_checkout WHERE order_id=?').get(iOrder);
    ok('keranjang iuran menjadi LUNAS', co && co.status === 'lunas', JSON.stringify(co));
    const byr = T2.prepare("SELECT COUNT(*) c FROM iuran_bayar WHERE status='pending'").get().c;
    ok('pembayaran masuk Antrean Posting (status pending)', byr >= 1, String(byr));
    T2.close();
    h = await hook(rawIuran, sign(rawIuran, 'whsec-sekolah-45'));
    ok('webhook iuran berulang → duplicate', h.status === 200 && h.json && h.json.duplicate === true, h.text.slice(0, 140));

    /* =============== 5. LOG EVENT DI PANEL =============== */
    console.log('\n== 5. LOG WEBHOOK & KEAMANAN ==');
    cookie = '';
    await req('POST', '/super-admin/login', { email: admin.email, password: 'SuperAdmin2026!' });
    const panel = await req('GET', '/super-admin/qris');
    ok('log webhook tampil di panel', /data-tbl="kasera-event"/.test(panel.text) && panel.text.indexOf('evt-45-iuran'.slice(0, 0) + iOrder) !== -1);
    ok('hasil pemrosesan tercatat di log DB', (() => {
      const rows = new Database(SAAS, { readonly: true }).prepare('SELECT hasil FROM kasera_event').all();
      return rows.some(x => x.hasil === 'ok') && rows.some(x => x.hasil === 'tidak-ditemukan')
        && rows.some(x => x.hasil === 'diabaikan');
    })());
    ok('webhook tidak memerlukan sesi/cookie',
      (await (await fetch(base + '/api/webhook/kasera', { method: 'POST', body: '{}' })).status) === 401);

    console.log(`\n=== HASIL RONDE 45: ${pass} lulus, ${fail} gagal ===`);
    if (fail) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    if (fail && log) console.log('\n--- log server (ekor) ---\n' + log.slice(-1800));
  } catch (e) {
    console.error('\n[fatal]', e);
    if (log) console.log(log.slice(-2500));
    fail++;
  } finally {
    srv.kill();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { }
  }
  process.exit(fail ? 1 : 0);
})();
