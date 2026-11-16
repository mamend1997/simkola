'use strict';
/* =====================================================================
   Pembayaran hybrid SIMKEU Sekolah — QRIS otomatis (payment gateway)
   + QRIS manual, dan sakelar metode di panel Super Admin.

   Jalankan: node dev-tests/pay-hybrid.js
   ===================================================================== */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const PORT = 3688;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smk-pay-'));
const DB = path.join(DIR, 'keuangan.sqlite');
const SAAS = path.join(DIR, 'saas.db');
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, ok: !!cond }); if (!cond) console.log('FAIL', name, extra); };

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
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let json = null;
  const text = await r.text();
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: r.status, text, json, loc: r.headers.get('location') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(200); }
    const control = new Database(SAAS);

    /* ---------------- 1. PENGATURAN SUPER ADMIN ---------------- */
    const admins = control.prepare('SELECT email,role FROM saas_users').all();
    ok('akun super admin tersedia', admins.length > 0, JSON.stringify(admins));
    let r = await req('POST', '/super-admin/login', { email: admins[0].email, password: 'SuperAdmin2026!' });
    ok('login portal Super Admin', r.status === 303 && !/err=/.test(r.loc), r.loc);
    r = await req('GET', '/super-admin/qris');
    ok('halaman QRIS Super Admin terbuka', r.status === 200, 'HTTP ' + r.status);
    ok('sakelar QRIS otomatis tampil', /data-pay-gateway/.test(r.text));
    ok('sakelar QRIS manual tampil', /data-pay-manual/.test(r.text));
    ok('pemilih provider gateway tampil', /data-pay-provider/.test(r.text));
    ok('URL callback ditampilkan', /\/pay\/callback/.test(r.text));

    /* aktifkan kedua metode + provider sandbox */
    r = await req('POST', '/super-admin/qris/pay', {
      pay_gateway_aktif: '1', pay_manual_aktif: '1',
      pay_gateway_provider: 'sandbox', pay_gateway_mode: 'sandbox', pay_gateway_expire_menit: '45'
    });
    ok('simpan metode pembayaran', r.status === 303 && /ok=/.test(decodeURIComponent(r.loc)), r.loc);
    const g = k => (control.prepare('SELECT v FROM saas_settings WHERE k=?').get(k) || {}).v;
    ok('sakelar gateway tersimpan aktif', String(g('pay_gateway_aktif')) === '1', String(g('pay_gateway_aktif')));
    ok('sakelar manual tersimpan aktif', String(g('pay_manual_aktif')) === '1');
    ok('provider & kedaluwarsa tersimpan', g('pay_gateway_provider') === 'sandbox' && String(g('pay_gateway_expire_menit')) === '45');

    /* kedua metode dimatikan → ditolak */
    r = await req('POST', '/super-admin/qris/pay', { pay_gateway_provider: 'sandbox', pay_gateway_mode: 'sandbox' });
    ok('kedua metode dimatikan ditolak (minimal satu aktif)', /err=/.test(decodeURIComponent(r.loc)), r.loc);

    /* ---------------- 2. SEKOLAH: CHECKOUT HYBRID ---------------- */
    cookie = '';
    r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
    ok('login admin sekolah', r.status === 303, 'HTTP ' + r.status);
    const db = new Database(DB);
    const tenant = control.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
    ok('tenant utama berstatus lifetime (data contoh)', Number(tenant.is_lifetime_free) === 1, JSON.stringify({ id: tenant.id, lt: tenant.is_lifetime_free }));

    /* jadikan tenant berbayar agar alur perpanjangan dapat diuji */
    control.prepare("UPDATE tenants SET is_lifetime_free=0, expires_at=?, status='active' WHERE id=?")
      .run(new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), tenant.id);

    r = await req('GET', '/perpanjang');
    ok('halaman perpanjangan terbuka', r.status === 200, 'HTTP ' + r.status);
    ok('blok QRIS otomatis tampil', /data-metode="gateway"/.test(r.text));
    ok('blok QRIS manual tampil', /data-metode="manual"/.test(r.text));
    ok('tombol "Buat QRIS Dinamis" ada', /Buat QRIS Dinamis/.test(r.text));

    /* ---------------- 3. QRIS OTOMATIS ---------------- */
    r = await req('POST', '/perpanjang/qris', { durasi: '30', paket: 'basic' });
    ok('pembuatan QRIS dinamis dialihkan ke halaman pembayaran', r.status === 303 && /\/perpanjang\/qris\?order=/.test(r.loc), r.loc);
    const order = decodeURIComponent((r.loc.split('order=')[1] || '')).trim();
    ok('order id gateway terbentuk', /^SK-\d+-/.test(order), order);
    const payRow = control.prepare('SELECT * FROM saas_payments WHERE order_id=?').get(order);
    ok('baris pembayaran channel=gateway', payRow && payRow.channel === 'gateway', JSON.stringify(payRow && { c: payRow.channel, s: payRow.status }));
    ok('QR string simulasi tersimpan', String((payRow || {}).qr_string || '').startsWith('SIMULASI-QRIS'));

    r = await req('GET', '/perpanjang/qris?order=' + encodeURIComponent(order));
    ok('halaman QRIS terbuka', r.status === 200 && /SIMULASI-QRIS/.test(r.text));
    ok('tombol simulasi lunas tersedia', /btnSimulasi/.test(r.text));

    r = await req('GET', '/perpanjang/status?order=' + encodeURIComponent(order));
    ok('polling status → belum lunas', r.status === 200 && r.json && r.json.paid === false, r.text.slice(0, 120));

    const expBefore = control.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenant.id).expires_at;
    r = await req('POST', '/perpanjang/simulasi', { order });
    ok('simulasi pembayaran lunas', r.status === 200 && r.json && r.json.ok === true, r.text.slice(0, 140));
    const expAfter = control.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenant.id).expires_at;
    ok('masa aktif diperpanjang otomatis', expAfter > expBefore, `${expBefore} → ${expAfter}`);
    const paidRow = control.prepare('SELECT * FROM saas_payments WHERE order_id=?').get(order);
    ok('status pembayaran approved', paidRow.status === 'approved' && paidRow.paid_at, JSON.stringify({ s: paidRow.status }));

    /* ---------------- 4. CALLBACK PUBLIK ---------------- */
    control.prepare("UPDATE tenants SET expires_at=? WHERE id=?").run(expAfter, tenant.id);
    r = await req('POST', '/perpanjang/qris', { durasi: '365', paket: 'basic' });
    const order2 = decodeURIComponent((r.loc.split('order=')[1] || '')).trim();
    ok('tagihan kedua dibuat', /^SK-/.test(order2), order2);
    const cb = await fetch(base + '/pay/callback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order2, paid: true })
    });
    const cbJson = await cb.json();
    ok('callback sandbox tanpa signature ditolak', cb.status === 401 && cbJson.ok === false, JSON.stringify(cbJson));
    const cb2 = await fetch(base + '/pay/callback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order2, paid: true })
    });
    const cbJson2 = await cb2.json();
    ok('callback sandbox berulang tetap ditolak', cb2.status === 401 && cbJson2.ok === false, JSON.stringify(cbJson2));
    const cb3 = await fetch(base + '/pay/callback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: 'SK-0-TIDAKADA', paid: true })
    });
    ok('callback sandbox tidak dapat menguji order tanpa autentikasi', cb3.status === 401);

    /* ---------------- 5. SAKELAR MENYEMBUNYIKAN PILIHAN ---------------- */
    cookie = '';
    await req('POST', '/super-admin/login', { email: admins[0].email, password: 'SuperAdmin2026!' });
    r = await req('POST', '/super-admin/qris/pay', { pay_manual_aktif: '1', pay_gateway_provider: 'sandbox', pay_gateway_mode: 'sandbox' });
    ok('matikan QRIS otomatis lewat panel', r.status === 303, 'HTTP ' + r.status);
    ok('sakelar gateway menjadi 0', String(g('pay_gateway_aktif')) === '0');

    cookie = '';
    await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
    r = await req('GET', '/perpanjang');
    ok('sekolah hanya melihat QRIS manual', !/data-metode="gateway"/.test(r.text) && /data-metode="manual"/.test(r.text));
    cookie = '';
    r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
    r = await req('POST', '/perpanjang/qris', { durasi: '30', paket: 'basic' });
    ok('pengajuan gateway ditolak saat sakelar mati', /err=/.test(decodeURIComponent(r.loc)), decodeURIComponent(r.loc).slice(0, 120));

    /* ---------------- 6. QRIS MANUAL TETAP JALAN ---------------- */
    /* bersihkan pengajuan pending agar form manual terbuka */
    control.prepare("UPDATE saas_payments SET status='cancelled' WHERE tenant_id=? AND status='pending'").run(tenant.id);
    r = await req('GET', '/perpanjang');
    ok('form unggah bukti tersedia', /Konfirmasi Pembayaran|Kirim Konfirmasi/.test(r.text));
  } catch (e) {
    console.error(e);
    results.push({ name: 'EXCEPTION: ' + e.message, ok: false });
  } finally {
    srv.kill();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { }
  }

  const pass = results.filter(x => x.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== HASIL PEMBAYARAN HYBRID (SIMKEU): ${pass} lulus, ${fail} gagal ===`);
  if (fail) {
    console.log('Gagal:');
    results.filter(x => !x.ok).forEach(x => console.log('- ' + x.name));
    process.exitCode = 1;
  }
})();
