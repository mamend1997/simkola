'use strict';
/**
 * Pengirim pesan WhatsApp untuk kode OTP portal publik.
 * Gateway diatur pada menu Identitas Sekolah / Pengaturan Sistem:
 *   wa_api_url      → endpoint gateway (mis. https://api.fonnte.com/send)
 *   wa_api_token    → token / API key (dikirim sebagai header Authorization)
 *   wa_api_payload  → 'form' (default, target+message) atau 'json' ({target,message,phone})
 * Bila gateway belum diatur, fungsi mengembalikan { ok:false, demo:true }
 * sehingga portal dapat menampilkan kode OTP di layar (mode uji) —
 * perilaku ini dikendalikan setting `wa_demo_tampil`.
 */
const dbm = require('./db');
const lib = require('./lib');
const env = require('./env');

/** normalisasi nomor WhatsApp → 62xxxxxxxxxx (satu implementasi dengan lib.normPhone) */
function normalizePhone(raw) {
  return lib.normPhone(raw);
}
/**
 * Konfigurasi gateway: variabel lingkungan (.env) DIUTAMAKAN, lalu pengaturan
 * di menu Pengaturan Sistem. Dengan begitu kredensial API key tidak perlu
 * ditulis di kode maupun di database saat deploy ke hosting lain.
 */
/**
 * Gateway WhatsApp PUSAT (diatur Super Admin pada menu WA Gateway).
 * Dipakai sebagai cadangan bila sekolah belum punya gateway sendiri.
 */
function pusatConfig() {
  try {
    const saas = require('./saas');
    const url = String(saas.get('wa_api_url', '') || '').trim();
    if (!url) return null;
    return {
      url,
      token: String(saas.get('wa_api_token', '') || '').trim(),
      payload: String(saas.get('wa_payload', 'form') || 'form').toLowerCase() === 'json' ? 'json' : 'form'
    };
  } catch (e) { return null; }
}
/**
 * Konfigurasi gateway aktif.
 * Urutan prioritas: variabel lingkungan (.env) → pengaturan sekolah → gateway PUSAT (Super Admin).
 * `source` menunjukkan sumber yang dipakai ('env' | 'tenant' | 'pusat' | '').
 */
function waConfig() {
  const tenantUrl = String(dbm.getSetting('wa_api_url', '') || '').trim();
  const tenantToken = String(dbm.getSetting('wa_api_token', '') || '').trim();
  const envUrl = String(process.env.WA_API_URL || '').trim();
  const envToken = String(process.env.WA_API_TOKEN || '').trim();
  const payloadTenant = String(dbm.getSetting('wa_api_payload', 'form') || 'form').toLowerCase();
  if (envUrl || envToken) {
    return {
      url: envUrl || tenantUrl, token: envToken || tenantToken,
      payload: String(process.env.WA_API_PAYLOAD || payloadTenant).toLowerCase(),
      demo: dbm.getSetting('wa_demo_tampil', '1') === '1',
      fromEnv: true, source: 'env'
    };
  }
  if (tenantUrl) {
    return {
      url: tenantUrl, token: tenantToken, payload: payloadTenant,
      demo: dbm.getSetting('wa_demo_tampil', '1') === '1',
      fromEnv: false, source: 'tenant'
    };
  }
  const pusat = pusatConfig();
  if (pusat) {
    return {
      url: pusat.url, token: pusat.token, payload: pusat.payload,
      demo: dbm.getSetting('wa_demo_tampil', '1') === '1',
      fromEnv: false, source: 'pusat'
    };
  }
  return {
    url: '', token: '', payload: payloadTenant,
    demo: dbm.getSetting('wa_demo_tampil', '1') === '1',
    fromEnv: false, source: ''
  };
}
async function sendWA(phone, message) {
  const cfg = waConfig();
  const target = normalizePhone(phone);
  if (!cfg.url) return { ok: false, demo: cfg.demo, reason: 'Gateway WhatsApp belum diatur pada Pengaturan Sistem.' };
  if (!target) return { ok: false, demo: false, reason: 'Nomor WhatsApp tidak valid.' };
  try {
    const headers = { Authorization: cfg.token };
    let body;
    if (cfg.payload === 'json') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ target, phone: target, message, type: 'text' });
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ target, phone: target, message, type: 'text' }).toString();
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(cfg.url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(to);
    const text = await r.text();
    if (!r.ok) return { ok: false, demo: false, reason: `Gateway menolak (HTTP ${r.status}).`, raw: text.slice(0, 300) };
    return { ok: true, raw: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, demo: false, reason: 'Gagal menghubungi gateway WhatsApp: ' + e.message };
  }
}
function otpMessage({ kode, keperluan, sekolah, menit, link }) {
  return `*${sekolah || 'Sekolah'}*\nKode OTP ${keperluan} Anda: *${kode}*\n\nKode berlaku ${menit || 10} menit dan hanya untuk Anda. Jangan bagikan kode ini kepada siapa pun.`
    + (link ? `\n\nBuka portal: ${link}` : '');
}
/** tautan absolut portal bila APP_BASE_URL diatur di .env */
function portalLink(pathname) {
  const b = env.baseUrl();
  if (!b) return '';
  return b + (String(pathname || '').startsWith('/') ? pathname : '/' + pathname);
}

module.exports = { sendWA, otpMessage, waConfig, pusatConfig, normalizePhone, portalLink };
