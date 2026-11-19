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
  { key: 'xendit', label: 'Xendit', hint: 'QR Code API — butuh Secret Key & Callback Token.' },
  { key: 'kasera', label: 'Kasera', hint: 'Kasera Pay — API Key (Bearer) + Webhook Secret (verifikasi kasera-signature-v1).' }
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
  pay_gateway_base: '',
  pay_gateway_expire_menit: '60'
};

const clean = v => String(v === null || v === undefined ? '' : v).trim();

/** Ambil pesan error dari respons JSON yang mungkin berbentuk objek bersarang. */
function responseError(j, fallback = '') {
  if (!j) return fallback;
  if (typeof j === 'string') return clean(j) || fallback;
  if (j instanceof Error) return clean(j.message) || fallback;
  if (typeof j !== 'object') return clean(j) || fallback;
  const candidates = [
    j.message, j.error_message, j.error_description, j.status_message,
    j.detail, j.description, j.error,
    j.data && (j.data.message || j.data.error_description || j.data.error),
    j.meta && j.meta.message
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && clean(v)) return clean(v);
    if (v && typeof v === 'object') {
      const nested = responseError(v, '');
      if (nested) return nested;
    }
  }
  try {
    const raw = JSON.stringify(j);
    if (raw && raw !== '{}' && raw !== 'null') return fallback ? fallback + ' — ' + raw : raw;
  } catch (e) { /* abaikan */ }
  return fallback;
}

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
    /* khusus Kasera Pay */
    kasera_api: ['auto', 'transactions', 'qris'].includes(clean(get('pay_gateway_kasera_api')))
      ? clean(get('pay_gateway_kasera_api')) : 'auto',
    webhook_secret_set: !!clean(get('pay_gateway_callback') || get('pay_gateway_key2')
      || process.env.KASERA_WEBHOOK_SECRET),
    api_key_env_set: !!clean(process.env.KASERA_API_KEY),
    providers: PROVIDERS
  };
}

/* =====================================================================
   KASERA PAY — integrasi transaksi + webhook
   ---------------------------------------------------------------------
   Permintaan pembayaran (checkout):
     POST {base}/v1/transactions        ← endpoint resmi Kasera Pay
     header: Authorization: Bearer <API KEY>
             Idempotency-Key: <nomor pesanan> (cegah pembayaran ganda)
             Content-Type: application/json, Accept: application/json
     body  : amount (integer rupiah), external_id (nomor pesanan), description
     respon: { checkout_url, ... } → pengguna diarahkan ke halaman checkout

   Notifikasi pembayaran (webhook):
     header `kasera-signature-v1` = HMAC-SHA256(body mentah, WEBHOOK SECRET)
     event `payment.paid` → external_id → tagihan menjadi LUNAS

   Endpoint QRIS lama (/v1/qris) dipertahankan sebagai CADANGAN agar akun
   Kasera yang belum mengaktifkan API Transactions tidak langsung rusak.
   Mode dapat dikunci lewat pengaturan `pay_gateway_kasera_api`:
     auto (bawaan) · transactions · qris
   ===================================================================== */
const KASERA = {
  base: 'https://pay.kasera.id',          // endpoint resmi (production)
  base_sandbox: 'https://sandbox.kasera.id',
  timeout_ms: 20000,
  event_kurir: ['payment.paid', 'payment.settled', 'payment.capture']
};
const KASERA_API_MODES = ['auto', 'transactions', 'qris'];

/** gabungan konfigurasi Kasera: pengaturan aplikasi → variabel lingkungan */
function kaseraCfg(cfg = {}) {
  const c = cfg || {};
  const api = KASERA_API_MODES.includes(clean(c.kasera_api)) ? clean(c.kasera_api) : 'auto';
  const mode = String(c.mode || 'sandbox');
  const base = clean(c.base) || clean(c.base_url) || clean(process.env.KASERA_BASE_URL)
    || (mode === 'sandbox' ? KASERA.base_sandbox : KASERA.base);
  return {
    api,
    mode,
    base: base.replace(/\/+$/, ''),
    key: clean(c.key) || clean(process.env.KASERA_API_KEY),
    merchant: clean(c.merchant),
    /** Callback/Webhook Secret (boleh dari pengaturan aplikasi atau .env) */
    secret: clean(c.callback) || clean(c.key2) || clean(process.env.KASERA_WEBHOOK_SECRET)
  };
}
/** daftar secret yang mungkin dipakai sebuah notifikasi (pengaturan + .env) */
function kaseraSecrets(cfg = {}) {
  const c = cfg || {};
  return [...new Set([clean(c.callback), clean(c.key2), clean(process.env.KASERA_WEBHOOK_SECRET)].filter(Boolean))];
}
/** base URL API Kasera (kompatibilitas pemanggil lama). */
function kaseraBase(cfg) {
  return kaseraCfg(cfg).base;
}
function kaseraHeaders(key, merchant, idempotencyKey) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key) h.Authorization = 'Bearer ' + key;
  if (merchant) h['X-Merchant-Id'] = merchant;
  if (idempotencyKey) h['Idempotency-Key'] = String(idempotencyKey);
  return h;
}
/** status pembayaran Kasera → boolean lunas */
function kaseraPaid(v) {
  const st = String(v || '').toUpperCase();
  return ['PAID', 'SETTLED', 'SETTLEMENT', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'CAPTURE',
    'PAYMENT.PAID', 'PAYMENT.SETTLED'].includes(st);
}
/** baca field pembayaran dari berbagai bentuk respons Kasera */
function kaseraPayload(j = {}) {
  const d = (j && (j.data || j.transaction || j.payment || j.qris)) || j || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = d[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const status = pick('status', 'transaction_status', 'payment_status', 'state').toUpperCase();
  return {
    checkout_url: pick('checkout_url', 'checkoutUrl', 'payment_url', 'paymentUrl', 'invoice_url', 'redirect_url'),
    qr_string: pick('qr_string', 'qrString', 'qr_code', 'qrCode', 'qris_string', 'qr_content'),
    qr_url: pick('qr_url', 'qrUrl', 'qr_image_url', 'qris_url'),
    expires_at: pick('expires_at', 'expired_at', 'expiry_at', 'expiresAt', 'expiry_time'),
    status,
    paid: d.paid === true || kaseraPaid(status),
    raw: j
  };
}
/** respons dianggap berhasil bila memuat data pembayaran yang bisa dipakai */
function kaseraUsable(p) {
  return !!(p && (p.checkout_url || p.qr_string || p.qr_url));
}

/**
 * Buat permintaan pembayaran (checkout) ke Kasera Pay.
 * @returns {Promise<{ok:boolean, api:'transactions', checkout_url?:string, qr_string?:string,
 *                    qr_url?:string, expires_at?:string, http?:number, fallback?:boolean,
 *                    error?:string, raw?:any}>}
 */
async function kaseraCreateTransaction(cfg, req = {}) {
  const k = kaseraCfg(cfg);
  const external_id = clean(req.external_id || req.order_id);
  const amount = Math.round(Number(req.amount) || 0);
  if (!k.key) return { ok: false, api: 'transactions', error: 'API Key Kasera belum diisi (pengaturan atau KASERA_API_KEY).' };
  if (!external_id) return { ok: false, api: 'transactions', error: 'external_id (nomor pesanan) wajib diisi.' };
  if (!(amount > 0)) return { ok: false, api: 'transactions', error: 'Nominal pembayaran harus bilangan bulat lebih besar dari 0.' };
  const headers = kaseraHeaders(k.key, k.merchant, clean(req.idempotency_key) || external_id);
  const body = {
    amount,                                  // integer rupiah utuh (tanpa desimal)
    external_id,                             // nomor pesanan
    description: clean(req.description) || ('Pembayaran ' + external_id)
  };
  try {
    const r = await fetch(`${k.base}/v1/transactions`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(KASERA.timeout_ms)
    });
    const j = await r.json().catch(() => ({}));
    const p = kaseraPayload(j);
    const pesan = responseError(j);
    if (!r.ok) {
      /* 404/405/501 = endpoint transactions belum aktif pada akun ini →
         masih boleh mencoba endpoint QRIS lama. Kode lain = ditolak tegas. */
      const fallback = [404, 405, 501].includes(Number(r.status));
      return {
        ok: false, api: 'transactions', http: Number(r.status), fallback,
        error: pesan || `Kasera menolak permintaan (HTTP ${r.status}).`, raw: j
      };
    }
    if (!kaseraUsable(p)) {
      /* 2xx tanpa data pembayaran → jangan anggap sukses; coba endpoint QRIS lama */
      return {
        ok: false, api: 'transactions', http: Number(r.status), fallback: !pesan,
        error: pesan || 'Respons Kasera tidak memuat checkout_url / QR.', raw: j
      };
    }
    return { ok: true, api: 'transactions', http: Number(r.status), ...p, external_id, amount };
  } catch (e) {
    return { ok: false, api: 'transactions', fallback: true,
      error: 'Gagal menghubungi Kasera: ' + responseError(e) };
  }
}

/** Cek status transaksi Kasera (endpoint transactions, lalu QRIS lama). */
async function kaseraCheckTransaction(cfg, order_id) {
  const k = kaseraCfg(cfg);
  if (!k.key) return { ok: false, api: 'transactions', error: 'API Key Kasera belum diisi.' };
  const oid = clean(order_id);
  if (!oid) return { ok: false, api: 'transactions', error: 'order_id kosong.' };
  try {
    const r = await fetch(`${k.base}/v1/transactions/${encodeURIComponent(oid)}`, {
      headers: kaseraHeaders(k.key, k.merchant), signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false, api: 'transactions', http: Number(r.status),
        fallback: [404, 405, 501].includes(Number(r.status)),
        error: responseError(j, `HTTP ${r.status}`), raw: j
      };
    }
    const p = kaseraPayload(j);
    return { ok: true, api: 'transactions', paid: !!p.paid, status: p.status || 'PENDING', raw: j };
  } catch (e) {
    return { ok: false, api: 'transactions', fallback: true, error: responseError(e) };
  }
}

/**
 * Uji koneksi Kasera tanpa membuat tagihan atau QR baru.
 * GET /v1/transactions/<tes>:
 *   401 = API key salah
 *   404 = endpoint tidak tersedia / kunci valid tetapi tidak memiliki akses
 *   2xx = endpoint & kunci dapat diakses
 */
async function kaseraTestConnection(cfg = {}) {
  const k = kaseraCfg(cfg);
  if (!k.key) return { ok: false, code: 'NO_KEY', error: 'API Key Kasera belum diisi.' };
  try {
    const r = await fetch(`${k.base}/v1/transactions/__simkeu_connection_test__`, {
      headers: kaseraHeaders(k.key, k.merchant),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return {
      ok: false, code: 'UNAUTHORIZED', http: 401,
      error: 'API Key ditolak Kasera (401). Periksa key, prefix kp_live_/kp_test_, dan mode akun.'
    };
    if (r.status === 403) return {
      ok: false, code: 'FORBIDDEN', http: 403,
      error: 'Kasera menolak izin akun (403). Aktifkan akses API/Transactions untuk akun ini.'
    };
    if ([404, 405, 501].includes(r.status)) return {
      ok: false, code: 'ENDPOINT_NOT_AVAILABLE', http: r.status,
      error: `Endpoint transaksi tidak tersedia pada Base URL ${k.base} (HTTP ${r.status}). `
        + 'Gunakan akun/fitur Kasera yang mendukung /v1/transactions atau pilih mode QRIS lama.'
    };
    if (r.ok) return { ok: true, code: 'CONNECTED', http: r.status, error: '', base: k.base };
    return { ok: false, code: 'HTTP_ERROR', http: r.status,
      error: responseError(j, `Kasera menjawab HTTP ${r.status}.`) };
  } catch (e) {
    return { ok: false, code: 'NETWORK', error: 'Tidak dapat menghubungi Kasera: ' + responseError(e) };
  }
}

/** HMAC-SHA256 tanda tangan webhook Kasera (hex huruf kecil). */
function kaseraSignature(rawBody, secret) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody === undefined || rawBody === null ? '' : rawBody), 'utf8');
  return crypto.createHmac('sha256', String(secret || '')).update(raw).digest('hex');
}
/**
 * Verifikasi header `kasera-signature-v1`.
 * `rawBody` WAJIB berupa body mentah (string/Buffer) — bukan hasil JSON.parse,
 * karena HMAC dihitung dari byte asli yang dikirim Kasera.
 */
function kaseraVerifySignature(rawBody, headers = {}, secrets = []) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).map(clean).filter(Boolean);
  if (!list.length) return { ok: false, reason: 'Webhook Secret Kasera belum diatur.' };
  const h = headers || {};
  const gotRaw = clean(h['kasera-signature-v1'] || h['kasera-signature'] || h['x-kasera-signature']
    || h['x-callback-signature'] || h['x-signature']);
  if (!gotRaw) return { ok: false, reason: 'Header kasera-signature-v1 tidak ada.' };
  const got = gotRaw.toLowerCase().replace(/^sha256=/, '');
  for (const secret of list) {
    const expect = kaseraSignature(rawBody, secret);
    try {
      const a = Buffer.from(expect, 'hex'), b = Buffer.from(got, 'hex');
      if (a.length && a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, secret };
    } catch (e) { /* panjang/format tidak cocok → coba secret berikutnya */ }
  }
  return { ok: false, reason: 'Tanda tangan webhook tidak cocok.' };
}

/** Ambil inti event webhook Kasera (mendukung envelope event & payload polos). */
function kaseraEvent(body = {}) {
  const b = body || {};
  const d = b.data || b.transaction || b.payment || b.payload || b;
  const type = clean(b.event || b.event_type || b.type || b.event_name
    || (d && (d.event || d.event_type || d.type))).toLowerCase();
  const external_id = clean(d.external_id || d.externalId || d.reference_id || d.order_id
    || d.merchant_order_id || b.external_id || b.reference_id);
  const amount = Math.round(Number(d.amount || d.gross_amount || d.total || b.amount) || 0);
  const status = clean(d.status || d.transaction_status || d.payment_status).toUpperCase();
  const event_id = clean(b.id || b.event_id || b.eventId || b.notification_id
    || d.event_id || d.id || (external_id ? `${type || 'event'}:${external_id}:${status || ''}` : ''));
  const paid = KASERA.event_kurir.includes(type) || kaseraPaid(status)
    || (type.startsWith('payment.') && /paid|settled|success|capture|completed/.test(type));
  return { event_id, type, external_id, amount, status, paid, order_id: external_id };
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
      if (!r.ok) throw new Error(responseError(j, `Xendit menolak permintaan (HTTP ${r.status}).`));
      return { ok: true, provider, order_id, qr_string: j.qr_string || '', expires_at: j.expires_at || expiresAt, raw: j };
    }
    if (provider === 'kasera') {
      const k = kaseraCfg({ ...cfg, base: clean(cfg.base || cfg.base_url) });
      if (!k.key) throw new Error('API Key / Server Key Kasera belum diisi (pengaturan atau KASERA_API_KEY).');
      const webhookUrl = clean(cfg.webhook_url) || clean(cfg.callback_url);
      /* 1) endpoint resmi: POST /v1/transactions → checkout_url */
      let hasil = null;
      if (k.api !== 'qris') {
        hasil = await kaseraCreateTransaction({ ...cfg, key: k.key, merchant: k.merchant, base: k.base, kasera_api: k.api }, {
          external_id: order_id, amount, description: label || 'Langganan',
          customer, callback_url: clean(cfg.callback_url), return_url: clean(cfg.return_url),
          webhook_url: webhookUrl, idempotency_key: order_id
        });
        if (hasil.ok) {
          return {
            ok: true, provider, order_id, api: 'transactions',
            qr_string: clean(hasil.qr_string),
            qr_url: clean(hasil.qr_url || hasil.checkout_url),
            checkout_url: clean(hasil.checkout_url),
            expires_at: hasil.expires_at || expiresAt,
            raw: hasil.raw
          };
        }
        if (!hasil.fallback) throw new Error(hasil.error || 'Kasera menolak permintaan.');
        console.warn('[paygw] Kasera /v1/transactions tidak tersedia → memakai /v1/qris:', hasil.error || '');
      }
      /* 2) cadangan: endpoint QRIS lama */
      const r = await fetch(`${k.base}/v1/qris`, {
        method: 'POST',
        headers: kaseraHeaders(k.key, k.merchant, order_id),
        body: JSON.stringify({
          merchant_id: k.merchant || undefined,
          reference_id: order_id, order_id,
          amount: Number(amount), currency: 'IDR',
          description: label || 'Langganan',
          customer: { name: clean(customer && customer.nama) || 'Sekolah', email: clean(customer && customer.email) || '' },
          callback_url: clean(cfg.callback_url) || '', return_url: clean(cfg.return_url) || '',
          expiry_minutes: expireMin
        }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      const p = kaseraPayload(j);
      if (!r.ok || j.success === false || (p.status && ['FAILED', 'ERROR'].includes(p.status))) {
        const providerMsg = responseError(j, `Kasera menolak permintaan (HTTP ${r.status}).`);
        if (Number(r.status) === 404) {
          throw new Error(`Endpoint QRIS Kasera tidak ditemukan (HTTP 404): ${k.base}/v1/qris. `
            + `Pastikan Base URL, mode Production, API Key, dan fitur QRIS Kasera untuk akun ini sudah aktif. `
            + `Respons Kasera: ${providerMsg}`);
        }
        throw new Error(providerMsg);
      }
      return {
        ok: true, provider, order_id, api: 'qris',
        qr_string: p.qr_string,
        qr_url: p.qr_url || p.checkout_url,
        checkout_url: p.checkout_url,
        expires_at: p.expires_at || expiresAt,
        raw: j
      };
    }
    throw new Error('Provider payment gateway tidak dikenal.');
  } catch (e) {
    const err = responseError(e, 'Gagal membuat pembayaran.');
    return { ok: false, provider, order_id, error: err };
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
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: responseError(j, 'HTTP ' + r.status) };
      return { ok: true, paid: String(j.status).toUpperCase() === 'COMPLETED', status: String(j.status || '').toUpperCase(), raw: j };
    }
    if (provider === 'kasera') {
      const k = kaseraCfg({ ...cfg, key: key || process.env.KASERA_API_KEY, base: clean(cfg.base || cfg.base_url) });
      if (!k.key) return { ok: false, paid: false, status: 'ERROR', error: 'API Key Kasera belum diisi.' };
      /* 1) endpoint transaksi baru */
      if (k.api !== 'qris') {
        const t = await kaseraCheckTransaction({ ...cfg, key: k.key, merchant: k.merchant, base: k.base, kasera_api: k.api }, order_id);
        if (t.ok) return { ok: true, paid: !!t.paid, status: t.status || 'PENDING', api: 'transactions', raw: t.raw };
        if (!t.fallback) return { ok: false, paid: false, status: 'ERROR', error: t.error || 'Gagal cek status Kasera.' };
      }
      /* 2) cadangan: endpoint QRIS lama */
      const r = await fetch(`${k.base}/v1/qris/${encodeURIComponent(order_id)}`, {
        headers: kaseraHeaders(k.key, k.merchant), signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      const p = kaseraPayload(j);
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: responseError(j, 'HTTP ' + r.status) };
      return { ok: true, paid: !!p.paid, status: p.status || 'PENDING', api: 'qris', raw: j };
    }
    return { ok: false, paid: false, status: 'UNKNOWN' };
  } catch (e) {
    return { ok: false, paid: false, status: 'ERROR', error: responseError(e, 'Gagal memeriksa status pembayaran.') };
  }
}

/**
 * Verifikasi callback/webhook.
 * @param {object} cfg
 * @param {object|string} body payload (objek hasil parse)
 * @param {object} headers header permintaan
 * @param {string|Buffer} [raw] body MENTAH — wajib untuk Kasera (HMAC byte asli)
 */
function verifyCallback(cfg, body = {}, headers = {}, raw = null) {
  const provider = cfg.provider || 'sandbox';
  const key = clean(cfg.key);
  const merchant = clean(cfg.merchant);
  const equal = (a, b) => {
    const actual = Buffer.from(String(a || ''));
    const expected = Buffer.from(String(b || ''));
    return actual.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  };
  if (provider === 'sandbox') return false;
  try {
    if (provider === 'midtrans') {
      if (!key) return false;
      const sig = String(body.signature_key || '');
      if (!sig) return false;
      return equal(sig, crypto.createHash('sha512').update(`${body.order_id}${body.status_code}${body.gross_amount}${key}`).digest('hex'));
    }
    if (provider === 'duitku') {
      if (!key || !merchant) return false;
      const sig = String(body.signature || '');
      if (!sig) return false;
      return equal(sig, crypto.createHash('md5').update(`${merchant}${body.amount}${body.merchantOrderId}${key}`).digest('hex'));
    }
    if (provider === 'xendit') {
      const token = String(headers['x-callback-token'] || body.callback_token || '');
      const expect = clean(cfg.callback) || clean(cfg.key2);
      if (!expect) return false;
      return equal(token, expect);
    }
    if (provider === 'kasera') {
      const secrets = kaseraSecrets(cfg);
      if (!secrets.length) return false;
      /* body mentah lebih akurat; JSON.stringify hanya cadangan pemanggil lama */
      const bahan = raw !== null && raw !== undefined
        ? raw
        : (typeof body === 'string' ? body : JSON.stringify(body));
      if (kaseraVerifySignature(bahan, headers, secrets).ok) return true;
      /* cadangan: sebagian akun mengirim signature di dalam body */
      const inBody = clean(body && (body.signature || body.callback_signature));
      return !!inBody && kaseraVerifySignature(bahan, { 'kasera-signature-v1': inBody }, secrets).ok;
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
  if (provider === 'kasera') {
    const ev = kaseraEvent(body);
    return {
      order_id: ev.order_id,
      paid: ev.paid,
      status: ev.status || (ev.paid ? 'PAID' : 'PENDING'),
      amount: ev.amount,
      event_id: ev.event_id,
      type: ev.type
    };
  }
  return { order_id: String(body.order_id || ''), paid: !!body.paid, status: body.paid ? 'PAID' : 'PENDING', amount: Number(body.amount) || 0 };
}

module.exports = {
  PROVIDERS, PROVIDER_KEYS, DEF, publicConfig, orderNo, createCharge, checkStatus, verifyCallback, parseCallback,
  kaseraBase, kaseraHeaders, kaseraPaid, kaseraCfg, kaseraSecrets, kaseraCreateTransaction,
  kaseraCheckTransaction, kaseraTestConnection, kaseraSignature, kaseraVerifySignature, kaseraEvent, kaseraPayload, kaseraUsable, responseError,
  KASERA, KASERA_API_MODES, clean
};
