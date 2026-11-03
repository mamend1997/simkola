'use strict';
/**
 * ==================================================================
 * TELEGRAM BOT — pengiriman berkas backup (.zip) & pesan
 * ------------------------------------------------------------------
 * Tanpa dependency: memakai `fetch` + FormData/Blob bawaan Node 18+.
 * Dipakai oleh:
 *   · Auto-Backup tingkat sekolah (routes/backup_tg.js)
 *   · Auto-Backup seluruh SaaS di panel Super Admin
 *
 * Semua berkas sementara ditulis ke os.tmpdir() (BUKAN folder aplikasi)
 * dan WAJIB dihapus setelah pengiriman diproses — berhasil maupun gagal.
 * ==================================================================
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const API = String(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const TMP_PREFIX = 'simkeu-tg-';
const MAX_TEMP_AGE = 60 * 60 * 1000;   // berkas sisa > 1 jam dibersihkan

function tokenOf(raw) { return String(raw || '').trim().replace(/^bot/i, ''); }
/** token disamarkan untuk ditampilkan di UI (tidak pernah dirender utuh) */
function mask(raw) {
  const t = tokenOf(raw);
  if (!t) return '';
  if (t.length <= 12) return t.slice(0, 3) + '••••';
  return t.slice(0, 6) + '••••••' + t.slice(-4);
}
function looksValidToken(raw) {
  const t = tokenOf(raw);
  return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(t);
}
function chatOf(raw) { return String(raw || '').trim().replace(/^@/, ''); }

async function call(token, method, payload, timeoutMs = 120000) {
  const t = tokenOf(token);
  if (!t) throw new Error('Telegram Bot Token belum diisi.');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(`${API}/bot${t}/${method}`, Object.assign({ signal: ctrl.signal }, payload));
  } catch (e) {
    clearTimeout(to);
    const msg = String(e && e.message || e);
    if (/abort/i.test(msg)) throw new Error('Telegram tidak merespons (timeout).');
    throw new Error('Gagal menghubungi Telegram: ' + msg);
  }
  clearTimeout(to);
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok || j.ok === false) {
    const desc = (j && j.description) || ('HTTP ' + r.status);
    throw new Error(translateError(desc));
  }
  return j.result;
}

function translateError(desc) {
  const d = String(desc || '');
  if (/chat not found/i.test(d)) return 'Chat ID tidak ditemukan. Pastikan Anda sudah memulai percakapan dengan bot (/start) dan Chat ID benar.';
  if (/unauthorized/i.test(d)) return 'Bot Token ditolak Telegram (Unauthorized). Periksa kembali token dari @BotFather.';
  if (/bot was blocked/i.test(d)) return 'Bot diblokir oleh penerima. Buka Telegram lalu tekan Start pada bot.';
  if (/too big|entity too large/i.test(d)) return 'Berkas terlalu besar untuk dikirim lewat Telegram (maks 50 MB).';
  if (/not enough rights/i.test(d)) return 'Bot tidak punya hak kirim pada chat/grup tersebut.';
  return d;
}

/** kirim pesan teks biasa */
async function sendMessage({ token, chatId, text, parseMode = '' }) {
  const body = new URLSearchParams({ chat_id: chatOf(chatId), text: String(text || '').slice(0, 4000), disable_web_page_preview: 'true' });
  if (parseMode) body.set('parse_mode', parseMode);
  const res = await call(token, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  return { ok: true, messageId: res && res.message_id };
}

/** info bot (untuk tombol "Uji Koneksi") */
async function getMe(token) {
  const res = await call(token, 'getMe', { method: 'GET' }, 20000);
  return { id: res.id, username: res.username, nama: res.first_name || res.username };
}

/**
 * Kirim dokumen (berkas .zip) + keterangan.
 * `content` boleh Buffer atau path berkas.
 */
async function sendDocument({ token, chatId, filename, content, caption = '', mime = 'application/zip' }) {
  const buf = Buffer.isBuffer(content) ? content : fs.readFileSync(String(content));
  if (!buf.length) throw new Error('Berkas backup kosong.');
  const fd = new FormData();
  fd.set('chat_id', chatOf(chatId));
  if (caption) fd.set('caption', String(caption).slice(0, 900));
  fd.set('document', new Blob([buf], { type: mime }), filename);
  const res = await call(token, 'sendDocument', { method: 'POST', body: fd }, 180000);
  return { ok: true, messageId: res && res.message_id, fileId: res && res.document && res.document.file_id, size: buf.length };
}

/* ---------------- berkas sementara ---------------- */
/** tulis buffer ke berkas sementara di luar folder aplikasi */
function writeTemp(filename, buffer) {
  const safe = String(filename || 'backup.zip').replace(/[^\w.\-]+/g, '_');
  const file = path.join(os.tmpdir(), TMP_PREFIX + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safe);
  fs.writeFileSync(file, buffer);
  return file;
}
/** hapus satu berkas sementara (.zip / .sql) — dipanggil di blok finally */
function cleanup(file) {
  if (!file) return false;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch (e) { return false; }
}
/**
 * Sapu berkas sementara yang tertinggal (mis. proses mati di tengah jalan).
 * Hanya menyentuh berkas berawalan `simkeu-tg-` milik aplikasi ini.
 */
function sweepTemps(now = Date.now()) {
  let n = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(TMP_PREFIX)) continue;
      if (!/\.(zip|sql)$/i.test(name)) continue;
      const fp = path.join(os.tmpdir(), name);
      try {
        const st = fs.statSync(fp);
        if (now - st.mtimeMs > MAX_TEMP_AGE) { fs.unlinkSync(fp); n++; }
      } catch (e) { }
    }
  } catch (e) { }
  return n;
}
/** daftar berkas sementara yang masih ada (dipakai tes auto-cleanup) */
function listTemps() {
  try {
    return fs.readdirSync(os.tmpdir()).filter(n => n.startsWith(TMP_PREFIX));
  } catch (e) { return []; }
}

/** potongan waktu slot cron yang berlaku sekarang (toleransi 45 menit) */
function slotNow(slots, now = new Date()) {
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const today = lib.todayISO();
  const list = String(slots || '06:00,15:00').split(',').map(s => s.trim()).filter(Boolean);
  for (const slot of list) {
    const [h, m] = slot.split(':').map(Number);
    if (!Number.isFinite(h)) continue;
    const target = new Date(now); target.setHours(h, m || 0, 0, 0);
    const diffMin = (now - target) / 60000;
    if (diffMin >= 0 && diffMin <= 45) return { slot, key: today + '#' + slot };
  }
  return null;
}

module.exports = {
  tokenOf, mask, looksValidToken, chatOf, sendMessage, sendDocument, getMe, translateError,
  writeTemp, cleanup, sweepTemps, listTemps, slotNow, TMP_PREFIX
};
