'use strict';
/**
 * Pemuat konfigurasi lingkungan (.env) — tanpa dependency eksternal.
 * ------------------------------------------------------------------
 * Semua kredensial & alamat (database, gateway WhatsApp, media/CDN, domain)
 * dibaca dari variabel lingkungan sehingga aplikasi bisa dipindah ke VPS /
 * hosting lain hanya dengan menyalin berkas .env, tanpa mengubah kode.
 *
 * Aturan: nilai yang SUDAH ADA di process.env tidak pernah ditimpa, jadi
 * cara menjalankan `DB_PATH=/tmp/x.sqlite node server.js` tetap menang.
 * Berkas .env tidak boleh ikut ter-commit (lihat .gitignore).
 */
const fs = require('fs');
const path = require('path');

const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, '.env');

function parseEnv(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach(line => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(s);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    // dukung escape \n di dalam tanda kutip ganda
    if (m[2].trim().startsWith('"')) v = v.replace(/\\n/g, '\n');
    out[m[1]] = v;
  });
  return out;
}

function load(file = ENV_FILE) {
  try {
    if (!fs.existsSync(file)) return { file, loaded: 0 };
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    let loaded = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) { process.env[k] = v; loaded++; }
    }
    return { file, loaded };
  } catch (e) {
    console.error('[env] gagal membaca', file, e.message);
    return { file, loaded: 0, error: e.message };
  }
}

const loaded = load();

/**
 * Zona waktu proses — diterapkan SETELAH .env dibaca (APP_TIMEZONE) dan
 * SEBELUM modul lain memakai Date/SQLite. Default Asia/Jakarta (WIB, GMT+7).
 */
const tz = require('./tz');
const TZ = tz.apply(env('APP_TIMEZONE', process.env.TZ || tz.DEFAULT_TZ));

/** ambil nilai env dengan default */
function env(key, def = '') {
  const v = process.env[key];
  return v === undefined || v === null || v === '' ? def : v;
}
function envBool(key, def = false) {
  const v = String(process.env[key] || '').trim().toLowerCase();
  if (!v) return def;
  return ['1', 'true', 'yes', 'on', 'ya'].includes(v);
}
/** alamat dasar publik aplikasi (tanpa garis miring di akhir) */
function baseUrl() {
  return env('APP_BASE_URL', '').replace(/\/+$/, '');
}
/** daftar konfigurasi untuk ditampilkan di halaman admin (nilai sensitif disamarkan) */
function describe() {
  const mask = v => {
    const s = String(v || '');
    if (!s) return '';
    if (s.length <= 6) return '••••';
    return s.slice(0, 3) + '•'.repeat(Math.min(10, s.length - 6)) + s.slice(-3);
  };
  const ti = tz.info();
  return [
    { key: 'APP_TIMEZONE', value: `${TZ} (${ti.label} ${ti.offset})`, fromEnv: process.env.APP_TIMEZONE !== undefined, secret: false, note: 'zona waktu proses, worker WA & penjadwalan' },
    { key: 'PORT', value: env('PORT', '3120'), fromEnv: process.env.PORT !== undefined, secret: false, note: 'port HTTP aplikasi' },
    { key: 'DB_PATH', value: env('DB_PATH', path.join(__dirname, 'data', 'keuangan.sqlite')), fromEnv: process.env.DB_PATH !== undefined, secret: false, note: 'lokasi berkas SQLite' },
    { key: 'APP_BASE_URL', value: baseUrl() || '(belum diatur)', fromEnv: !!baseUrl(), secret: false, note: 'alamat domain publik untuk tautan di WhatsApp' },
    { key: 'APP_MEDIA_URL', value: env('APP_MEDIA_URL', 'http://127.0.0.1:4310'), fromEnv: process.env.APP_MEDIA_URL !== undefined, secret: false, note: 'endpoint unggah media' },
    { key: 'APP_MEDIA_TOKEN', value: process.env.APP_MEDIA_TOKEN ? mask(process.env.APP_MEDIA_TOKEN) : '', fromEnv: !!process.env.APP_MEDIA_TOKEN, secret: true, note: 'token unggah media (runtime)' },
    { key: 'WA_API_URL', value: env('WA_API_URL', ''), fromEnv: !!env('WA_API_URL', ''), secret: false, note: 'gateway WhatsApp OTP' },
    { key: 'WA_API_TOKEN', value: env('WA_API_TOKEN', '') ? mask(env('WA_API_TOKEN', '')) : '', fromEnv: !!env('WA_API_TOKEN', ''), secret: true, note: 'API key gateway WhatsApp' },
    { key: 'WA_API_PAYLOAD', value: env('WA_API_PAYLOAD', 'form'), fromEnv: process.env.WA_API_PAYLOAD !== undefined, secret: false, note: 'format payload gateway (form/json)' },
    { key: 'KASERA_API_KEY', value: env('KASERA_API_KEY', '') ? mask(env('KASERA_API_KEY', '')) : '', fromEnv: !!env('KASERA_API_KEY', ''), secret: true, note: 'API key Kasera Pay (Authorization: Bearer)' },
    { key: 'KASERA_WEBHOOK_SECRET', value: env('KASERA_WEBHOOK_SECRET', '') ? mask(env('KASERA_WEBHOOK_SECRET', '')) : '', fromEnv: !!env('KASERA_WEBHOOK_SECRET', ''), secret: true, note: 'secret HMAC header kasera-signature-v1' },
    { key: 'KASERA_BASE_URL', value: env('KASERA_BASE_URL', ''), fromEnv: !!env('KASERA_BASE_URL', ''), secret: false, note: 'base URL API Kasera (bawaan https://pay.kasera.id)' },
    { key: 'STORAGE_QUOTA_MB', value: env('STORAGE_QUOTA_MB', '1024'), fromEnv: process.env.STORAGE_QUOTA_MB !== undefined, secret: false, note: 'kuota penyimpanan (MB)' }
  ];
}

module.exports = { load, env, envBool, baseUrl, describe, ENV_FILE, loaded, tz, TZ };
