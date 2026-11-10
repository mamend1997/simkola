'use strict';
/* =====================================================================
   RONDE 37 (SIMKEU) — Leger honor mengabaikan nilai minus, harga langganan
   per sekolah, dan provider payment gateway Kasera.

   Jalankan: node dev-tests/round37.js
   ===================================================================== */
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'fin-r37-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
process.env.DB_PATH = path.join(TMP, 'keuangan.sqlite');
process.env.SAAS_DB_PATH = path.join(TMP, 'saas.sqlite');
process.env.TZ = 'Asia/Jakarta';

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

const dbm = require('../db');
const saas = require('../saas');
const paygw = require('../paygw');
saas.ensureBootstrap();
Object.assign(saas, saas.ensureBootstrap());

const PERIODE = '2099-01';

function tambahPayroll(nama, cols) {
  const base = {
    periode: PERIODE, nama, jabatan: 'Guru', tipe: 'guru', jam_efektif: 0, jam_telat: 0, honor_jam: 0,
    tunjangan_jabatan: 0, tunjangan_masa_kerja: 0, lembur: 0, tambahan_penghasilan: 0, tunjangan_khusus: 0,
    pot_dana_sosial: 0, pot_bpjs_kes: 0, pot_bpjs_tk: 0, pot_sertifikasi: 0, pot_kasbon: 0, created_at: require('../lib').nowStamp()
  };
  const row = { ...base, ...cols };
  const keys = Object.keys(row);
  dbm.db.prepare(`INSERT INTO payroll(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => row[k]));
}

console.log('== 1. LEGER HONOR: NILAI MINUS TIDAK MENGURANGI GRAND TOTAL ==');
/* Baris A: normal (penerimaan 1.000.000, potongan 100.000 → diterima 900.000) */
tambahPayroll('Guru Positif', { honor_jam: 100000, jam_efektif: 10, pot_dana_sosial: 100000 });
/* Baris B: komponen minus besar → diterima NEGATIF (-500.000) */
tambahPayroll('Guru Minus', { honor_jam: 100000, jam_efektif: 1, pot_dana_sosial: 600000 });
/* Baris C: kasbon minus */
tambahPayroll('Guru Kasbon Minus', { honor_jam: 50000, jam_efektif: 2, pot_kasbon: 250000 });

const rows = dbm.payrollRows(PERIODE);
const rowMinus = rows.find(r => r.nama === 'Guru Minus');
const rowPos = rows.find(r => r.nama === 'Guru Positif');
ok('baris pegawai tetap menampilkan nilai minus apa adanya', rowMinus.diterima < 0, String(rowMinus.diterima));
ok('baris normal tetap bernilai positif', rowPos.diterima === 900000, String(rowPos.diterima));

const tot = dbm.payrollTotals(PERIODE);
ok('grand total diterima mengabaikan baris minus', tot.diterima === 900000 + 0 + 0, String(tot.diterima));
ok('grand total penerimaan mengabaikan baris minus', tot.penerimaan === 1000000 + 100000 + 100000, String(tot.penerimaan));
ok('grand total potongan mengabaikan nilai minus', tot.potongan === 100000 + 600000 + 250000, String(tot.potongan));
ok('grand total honor guru mengabaikan minus', tot.guru.honor === 1000000 + 100000 + 100000, String(tot.guru.honor));
ok('jumlah baris minus dilaporkan', tot.barisMinus === 2, String(tot.barisMinus));
ok('komponen kasbon di-clamp (tidak negatif)', tot.kasbon === 250000, String(tot.kasbon));

/* kolom dinamis juga tidak boleh minus */
const dyn = dbm.payrollDynamic(PERIODE);
ok('total kolom dinamis tidak negatif', Object.values(dyn.totals.perKode).every(v => Number(v) >= 0), JSON.stringify(dyn.totals.perKode));

console.log('\n== 2. HARGA LANGGANAN KHUSUS PER SEKOLAH ==');
const paket = saas.packageRows({ all: true })[0];
ok('paket bawaan tersedia', !!paket, JSON.stringify(paket && paket.kode));
const hargaPaket = Number(saas.packagePrice(paket.kode, 30));
const tenant = saas.tenantById(1);
ok('tenant utama tersedia', !!tenant);
const awal = saas.hargaTenant(tenant, paket.kode, 30);
ok('tanpa override → harga paket', awal === Math.round(hargaPaket), `${awal} vs ${hargaPaket}`);

const diperbarui = saas.updateTenant(1, { harga_bulanan: '99000', harga_tahunan: '990000', harga_catatan: 'Kesepakatan khusus' }, 'Uji');
ok('harga khusus tersimpan', Number(diperbarui.harga_bulanan) === 99000 && Number(diperbarui.harga_tahunan) === 990000, JSON.stringify({ b: diperbarui.harga_bulanan, t: diperbarui.harga_tahunan }));
ok('harga efektif bulanan memakai override', saas.hargaTenant(diperbarui, paket.kode, 30) === 99000);
ok('harga efektif tahunan memakai override', saas.hargaTenant(diperbarui, paket.kode, 365) === 990000);
ok('catatan kesepakatan tersimpan', diperbarui.harga_catatan === 'Kesepakatan khusus');
const hanyaBulanan = saas.updateTenant(1, { harga_bulanan: '120000', harga_tahunan: '0' }, 'Uji');
ok('hanya harga bulanan → tahunan = 12 × bulanan', saas.hargaTenant(hanyaBulanan, paket.kode, 365) === 1440000, String(saas.hargaTenant(hanyaBulanan, paket.kode, 365)));
const dikosongkan = saas.updateTenant(1, { harga_bulanan: '0', harga_tahunan: '0' }, 'Uji');
ok('override dikosongkan → kembali ke harga paket', saas.hargaTenant(dikosongkan, paket.kode, 30) === Math.round(hargaPaket));
ok('harga paket default tidak berubah', Number(saas.packagePrice(paket.kode, 30)) === hargaPaket);

console.log('\n== 3. PROVIDER PAYMENT GATEWAY KASERA ==');
ok('Kasera terdaftar sebagai provider', paygw.PROVIDER_KEYS.includes('kasera'), JSON.stringify(paygw.PROVIDER_KEYS));
ok('definisi provider Kasera punya label', (paygw.PROVIDERS.find(p => p.key === 'kasera') || {}).label === 'Kasera');

const calls = [];
const origFetch = global.fetch;
global.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  if (String(url).endsWith('/v1/qris')) {
    return { ok: true, status: 200, json: async () => ({ success: true, data: { qr_string: 'KASERA-QR', qr_url: 'https://kasera/qr.png', expires_at: '2099-01-01T00:00:00Z' } }) };
  }
  if (String(url).includes('/v1/qris/')) {
    return { ok: true, status: 200, json: async () => ({ data: { status: 'SETTLED', reference_id: 'SK-1-ABC', amount: 99000 } }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

(async () => {
  const charge = await paygw.createCharge(
    { provider: 'kasera', mode: 'sandbox', base: 'https://api.kasera.id', key: 'ksr-key', merchant: 'M-99' },
    { order_id: 'SK-1-ABC', amount: 99000, label: 'Langganan 1 bulan', customer: { nama: 'Sekolah Uji' } }
  );
  ok('Kasera: charge berhasil', charge.ok === true, JSON.stringify(charge));
  ok('Kasera: qr_string terbaca', charge.qr_string === 'KASERA-QR', String(charge.qr_string));
  ok('Kasera: qr_url terbaca', charge.qr_url === 'https://kasera/qr.png', String(charge.qr_url));
  ok('Kasera: memakai Bearer API key', /Bearer ksr-key/.test(calls[0].opts.headers.Authorization), JSON.stringify(calls[0].opts.headers));
  ok('Kasera: mengirim Merchant ID', calls[0].opts.headers['X-Merchant-Id'] === 'M-99');
  const body = JSON.parse(calls[0].opts.body);
  ok('Kasera: body memuat reference_id & amount', body.reference_id === 'SK-1-ABC' && body.amount === 99000, calls[0].opts.body);

  const st = await paygw.checkStatus({ provider: 'kasera', mode: 'sandbox', base: 'https://api.kasera.id', key: 'ksr-key', merchant: 'M-99' }, { order_id: 'SK-1-ABC' });
  ok('Kasera: status SETTLED dianggap lunas', st.ok && st.paid === true, JSON.stringify(st));

  const raw = JSON.stringify({ reference_id: 'SK-1-ABC', status: 'PAID', amount: 99000 });
  const sig = crypto.createHmac('sha256', 'secret-cb').update(raw).digest('hex');
  ok('Kasera: webhook signature valid', paygw.verifyCallback({ provider: 'kasera', callback: 'secret-cb' }, JSON.parse(raw), { 'x-kasera-signature': sig }) === true);
  ok('Kasera: webhook signature salah ditolak', paygw.verifyCallback({ provider: 'kasera', callback: 'secret-cb' }, JSON.parse(raw), { 'x-kasera-signature': 'abc' }) === false);
  const cb = paygw.parseCallback({ provider: 'kasera' }, { data: { reference_id: 'SK-1-ABC', status: 'PAID', amount: 99000 } });
  ok('Kasera: webhook diparse (order & lunas)', cb.order_id === 'SK-1-ABC' && cb.paid === true, JSON.stringify(cb));
  global.fetch = origFetch;

  console.log('\n=== HASIL RONDE 37: ' + pass + ' lulus, ' + fail + ' gagal ===');
  if (fails.length) { console.log('\nGAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})();
