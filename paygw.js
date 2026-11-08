'use strict';
/* =====================================================================
   PAYMENT GATEWAY — QRIS DINAMIS (pembayaran hybrid)
   ---------------------------------------------------------------------
   SIMKEU Sekolah mendukung DUA metode perpanjangan yang berdampingan:
     1. QRIS OTOMATIS  → tagihan QRIS dinamis dari payment gateway +
                         verifikasi status otomatis (callback & polling)
     2. QRIS MANUAL    → gambar QRIS statis + unggah bukti (verifikasi
                         manual oleh Super Admin) — perilaku lama

   Adapter (tanpa dependency tambahan, memakai fetch bawaan):
     sandbox · midtrans · duitku · xendit
   ===================================================================== */
const crypto = require('crypto');

const PROVIDERS = [
  { key: 'sandbox', label: 'Simulasi (tanpa gateway)', hint: 'QR dibuat lokal, dapat disimulasikan lunas untuk uji coba.' },
  { key: 'midtrans', label: 'Midtrans', hint: 'Core API QRIS — butuh Server Key.' },
  { key: 'duitku', label: 'Duitku', hint: 'Inquiry QRIS — butuh Merchant Code & API Key.' },
  { key: 'xendit', label: 'Xendit', hint: 'QR Code API — butuh Secret Key & Callback Token.' }
];
const PROVIDER_KEYS = PROVIDERS.map(p => p.key);

const DEF = {
  pay_gateway_aktif: '0',
  pay_manual_aktif: '1',
  pay_gateway_provider: 'sandbox',
  pay_gateway_mode: 'sandbox',
  pay_gateway_merchant: '',
  pay_gateway_key: '',
  pay_gateway_key2: '',
  pay_gateway_callback: '',
  pay_gateway_expire_menit: '60'
};

const clean = v => String(v === null || v === undefined ? '' : v).trim();

function orderNo(tenantId) {
  return `SK-${Number(tenantId) || 0}-${Date.now().toString(36).toUpperCase()}`;
}

/** konfigurasi publik (tanpa kredensial) */
function publicConfig(get) {
  const provider = PROVIDER_KEYS.includes(clean(get('pay_gateway_provider'))) ? clean(get('pay_gateway_provider')) : 'sandbox';
  return {
    gateway_aktif: String(get('pay_gateway_aktif')) === '1',
    manual_aktif: String(get('pay_manual_aktif', '1')) === '1',
    provider,
    provider_label: (PROVIDERS.find(p => p.key === provider) || {}).label || provider,
    mode: clean(get('pay_gateway_mode')) || 'sandbox',
    expire_menit: Math.max(5, Number(get('pay_gateway_expire_menit')) || 60),
    configured: provider === 'sandbox' ? true : !!clean(get('pay_gateway_key')),
    providers: PROVIDERS
  };
}

async function createCharge(cfg, { order_id, amount, label, customer }) {
  const provider = cfg.provider || 'sandbox';
  const mode = cfg.mode || 'sandbox';
  const key = clean(cfg.key);
  const key2 = clean(cfg.key2);
  const merchant = clean(cfg.merchant);
  const expireMin = Math.max(5, Number(cfg.expire_menit) || 60);
  const expiresAt = new Date(Date.now() + expireMin * 60000).toISOString();
  try {
    if (provider === 'sandbox') {
      return {
        ok: true, provider, order_id, simulated: true, expires_at: expiresAt,
        qr_string: `SIMULASI-QRIS|${order_id}|${Number(amount)}|${clean(customer && customer.nama) || 'Sekolah'}`
      };
    }
    if (provider === 'midtrans') {
      if (!key) throw new Error('Server Key Midtrans belum diisi.');
      const base = mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const r = await fetch(`${base}/v2/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        body: JSON.stringify({
          payment_type: 'qris',
          transaction_details: { order_id, gross_amount: Number(amount) },
          qris: { acquirer: 'gopay' },
          custom_field1: label
        }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j.status_code && String(j.status_code) !== '201')) throw new Error(j.status_message || `Midtrans menolak permintaan (HTTP ${r.status}).`);
      const action = (j.actions || []).find(a => /qr|deeplink/i.test(a.name || '')) || (j.actions || [])[0] || {};
      return { ok: true, provider, order_id, qr_url: action.url || '', checkout_url: action.url || '', expires_at: j.expiry_time ? new Date(j.expiry_time).toISOString() : expiresAt, raw: j };
    }
    if (provider === 'duitku') {
      if (!merchant || !key) throw new Error('Merchant Code / API Key Duitku belum diisi.');
      const base = mode === 'production' ? 'https://passport.duitku.com/webapi' : 'https://sandbox.duitku.com/webapi';
      const signature = crypto.createHash('sha256').update(`${merchant}${order_id}${Number(amount)}${key}`).digest('hex');
      const r = await fetch(`${base}/api/merchant/v2/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantCode: merchant, merchantOrderId: order_id, paymentAmount: Number(amount),
          paymentMethod: 'SP', productDetails: label || 'Langganan',
          customerVaName: clean(customer && customer.nama) || 'Sekolah',
          email: clean(customer && customer.email) || 'sekolah@example.com',
          phoneNumber: clean(customer && customer.phone) || '0800000000',
          callbackUrl: clean(cfg.callback_url) || '', returnUrl: clean(cfg.return_url) || '',
          expiryPeriod: expireMin, signature
        }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || String(j.statusCode) !== '00') throw new Error(j.statusMessage || `Duitku menolak permintaan (HTTP ${r.status}).`);
      return { ok: true, provider, order_id, qr_string: j.qrString || '', checkout_url: j.paymentUrl || '', expires_at: expiresAt, raw: j };
    }
    if (provider === 'xendit') {
      if (!key) throw new Error('Secret Key Xendit belum diisi.');
      const r = await fetch('https://api.xendit.co/qr_codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'), 'api-version': '2022-07-31' },
        body: JSON.stringify({ reference_id: order_id, type: 'DYNAMIC', currency: 'IDR', amount: Number(amount) }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `Xendit menolak permintaan (HTTP ${r.status}).`);
      return { ok: true, provider, order_id, qr_string: j.qr_string || '', expires_at: j.expires_at || expiresAt, raw: j };
    }
    throw new Error('Provider payment gateway tidak dikenal.');
  } catch (e) {
    return { ok: false, provider, order_id, error: e.message };
  }
}

async function checkStatus(cfg, { order_id }) {
  const provider = cfg.provider || 'sandbox';
  const mode = cfg.mode || 'sandbox';
  const key = clean(cfg.key);
  const merchant = clean(cfg.merchant);
  try {
    if (provider === 'sandbox') return { ok: true, paid: false, status: 'PENDING' };
    if (provider === 'midtrans') {
      const base = mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const r = await fetch(`${base}/v2/${encodeURIComponent(order_id)}/status`, {
        headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: j.status_message || ('HTTP ' + r.status) };
      const paid = ['capture', 'settlement'].includes(String(j.transaction_status));
      return { ok: true, paid, status: String(j.transaction_status || '').toUpperCase(), raw: j };
    }
    if (provider === 'duitku') {
      const base = mode === 'production' ? 'https://passport.duitku.com/webapi' : 'https://sandbox.duitku.com/webapi';
      const signature = crypto.createHash('md5').update(`${merchant}${order_id}${key}`).digest('hex');
      const r = await fetch(`${base}/api/merchant/v2/transactionStatus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantCode: merchant, merchantOrderId: order_id, signature }),
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, paid: String(j.statusCode) === '00', status: String(j.statusCode || ''), raw: j };
    }
    if (provider === 'xendit') {
      const r = await fetch(`https://api.xendit.co/qr_codes/${encodeURIComponent(order_id)}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: j.message || ('HTTP ' + r.status) };
      return { ok: true, paid: String(j.status).toUpperCase() === 'COMPLETED', status: String(j.status || '').toUpperCase(), raw: j };
    }
    return { ok: false, paid: false, status: 'UNKNOWN' };
  } catch (e) {
    return { ok: false, paid: false, status: 'ERROR', error: e.message };
  }
}

function verifyCallback(cfg, body = {}, headers = {}) {
  const provider = cfg.provider || 'sandbox';
  const key = clean(cfg.key);
  const merchant = clean(cfg.merchant);
  if (provider === 'sandbox') return true;
  try {
    if (provider === 'midtrans') {
      const sig = String(body.signature_key || '');
      if (!sig) return false;
      return crypto.createHash('sha512').update(`${body.order_id}${body.status_code}${body.gross_amount}${key}`).digest('hex') === sig;
    }
    if (provider === 'duitku') {
      const sig = String(body.signature || '');
      if (!sig) return false;
      return crypto.createHash('md5').update(`${merchant}${body.amount}${body.merchantOrderId}${key}`).digest('hex') === sig;
    }
    if (provider === 'xendit') {
      const token = String(headers['x-callback-token'] || body.callback_token || '');
      const expect = clean(cfg.callback) || clean(cfg.key2);
      if (!expect) return true;
      return token === expect;
    }
  } catch (e) { return false; }
  return false;
}

function parseCallback(cfg, body = {}) {
  const provider = cfg.provider || 'sandbox';
  if (provider === 'midtrans') {
    const st = String(body.transaction_status || '').toLowerCase();
    return { order_id: String(body.order_id || ''), paid: ['capture', 'settlement'].includes(st), status: st.toUpperCase(), amount: Number(body.gross_amount) || 0 };
  }
  if (provider === 'duitku') {
    return { order_id: String(body.merchantOrderId || ''), paid: String(body.resultCode) === '00', status: String(body.resultCode || ''), amount: Number(body.amount) || 0 };
  }
  if (provider === 'xendit') {
    return { order_id: String(body.reference_id || body.external_id || ''), paid: String(body.status).toUpperCase() === 'COMPLETED', status: String(body.status || '').toUpperCase(), amount: Number(body.amount) || 0 };
  }
  return { order_id: String(body.order_id || ''), paid: !!body.paid, status: body.paid ? 'PAID' : 'PENDING', amount: Number(body.amount) || 0 };
}

module.exports = { PROVIDERS, PROVIDER_KEYS, DEF, publicConfig, orderNo, createCharge, checkStatus, verifyCallback, parseCallback, clean };
