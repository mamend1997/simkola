'use strict';
/**
 * Integrasi Auto-Backup ke Google Drive (REST API langsung, tanpa dependency).
 *
 * - Autentikasi memakai Service Account: JWT RS256 → OAuth2 token.
 * - Berkas backup = ZIP database (backupdata.buildDatabaseZip) diunggah ke
 *   folder Google Drive yang ditentukan admin.
 * - Nama berkas dinamis/versioning: Backup_SIMKEU_03Nov2026_0600.zip
 * - Setiap unggahan sukses menjalankan kebijakan retensi: berkas backup
 *   milik aplikasi ini yang lebih tua dari N hari (default 30) dihapus.
 * - Penjadwalan: dua kali sehari (default 06:00 & 15:00) lewat timer internal
 *   server. Tidak pernah dipicu oleh aksi simpan transaksi harian.
 */
const crypto = require('crypto');
const lib = require('./lib');
const bd = require('./backupdata');

const TOKEN_DEFAULT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/* ---------------------------------------------------------------- kredensial */
function parseCredentials(raw) {
  const txt = String(raw || '').trim();
  if (!txt) throw new Error('Isi file kredensial JSON Service Account masih kosong.');
  let j;
  try { j = JSON.parse(txt); } catch (e) {
    throw new Error('Kredensial bukan JSON yang valid: ' + e.message);
  }
  if (!j || typeof j !== 'object') throw new Error('Kredensial JSON tidak dikenali.');
  if (!j.client_email) throw new Error('JSON tidak memuat "client_email" — pastikan memakai file kunci Service Account Google Cloud.');
  if (!j.private_key) throw new Error('JSON tidak memuat "private_key" — pastikan memakai file kunci Service Account Google Cloud.');
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(j.private_key))) {
    throw new Error('Nilai "private_key" tidak valid (bukan kunci PEM).');
  }
  return {
    client_email: String(j.client_email).trim(),
    private_key: String(j.private_key),
    token_uri: String(j.token_uri || TOKEN_DEFAULT),
    project_id: String(j.project_id || ''),
    raw: txt
  };
}
function credSummary(raw) {
  try {
    const c = parseCredentials(raw);
    return { ok: true, email: c.client_email, project: c.project_id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------------------------------------------------------- token OAuth2 */
const tokenCache = new Map();
const b64u = buf => Buffer.from(buf).toString('base64url');
function tokenKey(cred) {
  return cred.client_email + '|' + crypto.createHash('sha1').update(cred.private_key).digest('hex');
}
async function accessToken(cred, opts = {}) {
  const key = tokenKey(cred);
  const now = Math.floor(Date.now() / 1000);
  const hit = tokenCache.get(key);
  if (!opts.force && hit && hit.exp - 60 > now) return hit.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: cred.client_email,
    scope: SCOPE,
    aud: cred.token_uri || TOKEN_DEFAULT,
    iat: now - 30,
    exp: now + 3600
  };
  const unsigned = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(claim));
  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(cred.private_key);
  } catch (e) {
    throw new Error('Kunci privat pada kredensial tidak dapat dipakai untuk menandatangani permintaan: ' + e.message);
  }
  const assertion = unsigned + '.' + b64u(signature);

  const res = await fetch(cred.token_uri || TOKEN_DEFAULT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
  if (!res.ok || !j.access_token) {
    const msg = j.error_description || j.error || text || ('HTTP ' + res.status);
    throw new Error('Gagal autentikasi ke Google (token ditolak): ' + String(msg).slice(0, 300)
      + ' — periksa kembali isi file JSON Service Account & jam server.');
  }
  const ttl = Number(j.expires_in) || 3600;
  tokenCache.set(key, { token: j.access_token, exp: now + ttl });
  return j.access_token;
}

/* ---------------------------------------------------------------- HTTP ke Drive */
function driveError(status, j, text) {
  let msg = '';
  let reason = '';
  if (j && j.error) {
    msg = j.error.message || (typeof j.error === 'string' ? j.error : JSON.stringify(j.error));
    if (Array.isArray(j.error.errors) && j.error.errors[0]) reason = String(j.error.errors[0].reason || '');
  }
  if (!msg) msg = String(text || '').slice(0, 300) || ('HTTP ' + status);
  let hint = '';
  if (status === 401) hint = ' Kredensial ditolak — periksa kembali file JSON Service Account.';
  else if (/storageQuotaExceeded|quotaExceeded/i.test(msg + ' ' + reason)) {
    hint = ' Akun layanan Google tidak memiliki kuota penyimpanan My Drive pribadi. Letakkan folder tujuan di Shared Drive (Google Workspace) atau gunakan folder pada drive bersama, lalu simpan ulang konfigurasi.';
  } else if (status === 403) hint = ' Akses ditolak — pastikan folder Drive sudah dibagikan (Editor) ke email Service Account, Google Drive API aktif, dan kuota Drive tidak penuh.';
  else if (status === 404) hint = ' Folder/berkas tidak ditemukan — periksa Folder ID dan pastikan folder dibagikan ke email Service Account.';
  else if (status === 429 || status >= 500) hint = ' Layanan Google sedang membatasi/mengalami gangguan — coba lagi beberapa saat.';
  const err = new Error(String(msg).slice(0, 300) + hint);
  err.status = status;
  return err;
}
async function apiJson(url, { method = 'GET', token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = null; }
  if (!res.ok) throw driveError(res.status, j, text);
  return j || {};
}

/* ---------------------------------------------------------------- operasi Drive */
async function folderInfo(cfg) {
  const token = await accessToken(cfg.cred);
  const j = await apiJson(`${API_BASE}/files/${encodeURIComponent(cfg.folderId)}?fields=id,name,mimeType&supportsAllDrives=true`, { token });
  if (j.mimeType && j.mimeType !== FOLDER_MIME) {
    throw new Error('ID yang dimasukkan bukan sebuah folder Google Drive.');
  }
  return { token, folder: j };
}

/** daftar berkas backup milik aplikasi ini di dalam folder tujuan */
async function listBackups(cfg) {
  const token = await accessToken(cfg.cred);
  const parents = String(cfg.folderId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `'${parents}' in parents and trashed=false and name contains 'Backup_SIMKEU_'`;
  const out = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = `${API_BASE}/files?q=${encodeURIComponent(q)}`
      + '&fields=nextPageToken,files(id,name,size,createdTime)'
      + '&orderBy=createdTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true'
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const j = await apiJson(url, { token });
    for (const f of (j.files || [])) {
      if (bd.BACKUP_NAME_RE.test(String(f.name || ''))) out.push(f);
    }
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}

/** unggah buffer ZIP ke folder tujuan.
 *  ≤ 4,5 MB  → multipart upload (satu permintaan).
 *  > 4,5 MB  → resumable upload (batas multipart dari Google adalah 5 MB). */
async function uploadBackup(cfg, buffer, filename) {
  const token = await accessToken(cfg.cred);
  const meta = {
    name: filename,
    parents: [cfg.folderId],
    mimeType: 'application/zip',
    description: 'Backup otomatis SIMKEU Sekolah — ' + lib.nowStamp()
  };
  const FIELDS = 'fields=id,name,size,createdTime,webViewLink';
  if (buffer.length > 4.5 * 1024 * 1024) {
    // 1) mulai sesi unggah → dapat URL sesi di header Location
    const start = await fetch(`${UPLOAD_BASE}/files?uploadType=resumable&supportsAllDrives=true&${FIELDS}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/zip',
        'X-Upload-Content-Length': String(buffer.length)
      },
      body: JSON.stringify(meta)
    });
    const startText = await start.text();
    let startJson = null;
    try { startJson = startText ? JSON.parse(startText) : {}; } catch (e) { startJson = null; }
    const sessionUrl = start.headers.get('location');
    if (!start.ok || !sessionUrl) throw driveError(start.status, startJson, startText);
    // 2) kirim seluruh isi berkas ke URL sesi
    const up = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/zip', 'Content-Length': String(buffer.length) },
      body: buffer
    });
    const upText = await up.text();
    let upJson = null;
    try { upJson = upText ? JSON.parse(upText) : {}; } catch (e) { upJson = null; }
    if (!up.ok) throw driveError(up.status, upJson, upText);
    return upJson || {};
  }
  const boundary = 'simkeubk' + crypto.randomBytes(9).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`, 'utf8');
  const body = Buffer.concat([head, buffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
  return apiJson(`${UPLOAD_BASE}/files?uploadType=multipart&supportsAllDrives=true&${FIELDS}`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) },
    body
  });
}

async function deleteFile(cfg, fileId) {
  const token = await accessToken(cfg.cred);
  return apiJson(`${API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', token });
}

/**
 * Kebijakan retensi: hapus HANYA berkas backup milik aplikasi ini
 * (pola Backup_SIMKEU_*.zip) yang umurnya melewati batas hari.
 */
async function cleanupOld(cfg, opts = {}) {
  const days = Math.max(1, Number(opts.days || cfg.days || 30) || 30);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = await listBackups(cfg);
  const old = files.filter(f => {
    const t = Date.parse(String(f.createdTime || ''));
    return Number.isFinite(t) && t < cutoff;
  });
  const deleted = [];
  const failed = [];
  for (const f of old) {
    try {
      await deleteFile(cfg, f.id);
      deleted.push(f.name);
    } catch (e) {
      failed.push({ name: f.name, error: e.message });
    }
  }
  return { days, scanned: files.length, cutoff, deleted, failed };
}

async function testConnection(cfg) {
  const { folder } = await folderInfo(cfg);
  const files = await listBackups(cfg);
  const bytes = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
  return { folder, files, bytes };
}

/* ---------------------------------------------------------------- konfigurasi dari DB */
function cfgFromDb(dbm) {
  const raw = String(dbm.getSetting('gdrive_credentials', '') || '').trim();
  const folderId = String(dbm.getSetting('gdrive_folder_id', '') || '').trim();
  if (!raw) throw new Error('Kredensial Service Account Google Drive belum diisi. Buka menu Pengaturan Backup.');
  if (!folderId) throw new Error('Folder ID Google Drive tujuan belum diisi. Buka menu Pengaturan Backup.');
  const cred = parseCredentials(raw);
  const days = Math.max(1, Number(dbm.getSetting('gdrive_retensi_hari', '30')) || 30);
  return { cred, folderId, days };
}
function isConfigured(dbm) {
  return !!String(dbm.getSetting('gdrive_credentials', '') || '').trim()
    && !!String(dbm.getSetting('gdrive_folder_id', '') || '').trim();
}
function scheduleTimes(dbm) {
  const raw = String(dbm.getSetting('gdrive_times', '06:00,15:00') || '');
  const out = [];
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
    if (m) {
      const t = String(m[1]).padStart(2, '0') + ':' + m[2];
      if (!out.includes(t)) out.push(t);
    }
  }
  return out.length ? out.sort() : ['06:00', '15:00'];
}

/* ---------------------------------------------------------------- riwayat (tabel cloud_backup) */
function logRun(dbm, r) {
  try {
    dbm.db.prepare(`INSERT INTO cloud_backup
      (waktu,nama_berkas,ukuran,file_id,status,pesan,pemicu,user_nama,dihapus,durasi_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(r.waktu || lib.nowStamp(), r.nama_berkas || '', r.ukuran || 0, r.file_id || '',
        r.status || 'gagal', String(r.pesan || '').slice(0, 500), r.pemicu || 'manual',
        r.user_nama || 'system', r.dihapus || 0, r.durasi_ms || 0);
  } catch (e) { console.error('[gdrive] log', e.message); }
}
function history(dbm, limit = 10) {
  try {
    return dbm.db.prepare('SELECT * FROM cloud_backup ORDER BY id DESC LIMIT ?').all(Number(limit) || 10);
  } catch (e) { return []; }
}
function lastRun(dbm) {
  try { return dbm.db.prepare('SELECT * FROM cloud_backup ORDER BY id DESC LIMIT 1').get() || null; }
  catch (e) { return null; }
}

/* ---------------------------------------------------------------- eksekusi backup */
let running = false;
async function runBackup(dbm, opts = {}) {
  const trigger = opts.trigger === 'otomatis' ? 'otomatis' : 'manual';
  const user = opts.user || null;
  if (running) return { ok: false, error: 'Proses backup lain sedang berjalan. Tunggu hingga selesai.' };
  running = true;
  const started = Date.now();
  try {
    const cfg = cfgFromDb(dbm);
    const built = bd.buildDatabaseZip(dbm.db);
    const name = bd.backupFileName();
    const up = await uploadBackup(cfg, built.buffer, name);
    let cleanup = null;
    let cleanupError = '';
    try { cleanup = await cleanupOld(cfg, { days: cfg.days }); } catch (e) { cleanupError = e.message; }
    const durasi = Date.now() - started;
    logRun(dbm, {
      waktu: lib.nowStamp(), nama_berkas: name, ukuran: built.buffer.length,
      file_id: up.id || '', status: 'sukses',
      pesan: `${built.rows} baris dari ${built.tables} tabel` + (cleanup ? ` · ${cleanup.deleted.length} berkas lama dihapus` : ''),
      pemicu: trigger, user_nama: user ? user.nama : 'system', dihapus: cleanup ? cleanup.deleted.length : 0, durasi_ms: durasi
    });
    dbm.logAudit(user, 'BACKUP CLOUD', 'backup',
      `Auto-backup Google Drive (${trigger}): ${name} (${lib.fileSize(built.buffer.length)})`
      + (cleanup ? `, retensi ${cleanup.days} hari → ${cleanup.deleted.length} berkas dihapus` : ''));
    return {
      ok: true, name, id: up.id, size: built.buffer.length,
      rows: built.rows, tables: built.tables, durasi,
      cleanup: cleanup ? { days: cleanup.days, scanned: cleanup.scanned, deleted: cleanup.deleted, failed: cleanup.failed } : null,
      cleanupError
    };
  } catch (e) {
    logRun(dbm, {
      waktu: lib.nowStamp(), status: 'gagal', pesan: e.message,
      pemicu: trigger, user_nama: user ? user.nama : 'system', durasi_ms: Date.now() - started
    });
    try { dbm.logAudit(user, 'BACKUP CLOUD', 'backup', `Gagal auto-backup Google Drive (${trigger}): ${e.message}`); } catch (err) { }
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

/* ---------------------------------------------------------------- penjadwalan */
function parseDateSlot(now, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
}
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function slotKey(d, hhmm) { return dayKey(d) + ' ' + hhmm; }
function readDone(dbm) {
  try {
    const arr = JSON.parse(String(dbm.getSetting('gdrive_done', '[]') || '[]'));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) { return []; }
}
/** jadwal berikutnya (Date) berdasarkan daftar jam harian */
function nextRun(dbm, now = new Date()) {
  const times = scheduleTimes(dbm);
  const cands = [];
  for (let d = 0; d <= 1; d++) {
    for (const t of times) {
      const dt = parseDateSlot(new Date(now.getTime() + d * 24 * 60 * 60 * 1000), t);
      if (dt.getTime() > now.getTime()) cands.push(dt);
    }
  }
  cands.sort((a, b) => a - b);
  return cands[0] || null;
}
/**
 * Cek apakah ada jadwal backup yang jatuh tempo. Dipanggil tiap 30 detik.
 * Toleransi 45 menit: bila server sempat mati/restart saat jam jadwal,
 * backup tetap dijalankan sekali begitu server hidup kembali.
 */
async function checkSchedule(dbm, now = new Date()) {
  if (String(dbm.getSetting('gdrive_auto', '0')) !== '1') return null;
  if (!isConfigured(dbm)) return null;
  if (running) return null;
  const times = scheduleTimes(dbm);
  const done = readDone(dbm);
  for (const t of times) {
    const slot = parseDateSlot(now, t);
    const diff = now.getTime() - slot.getTime();
    if (diff < 0 || diff > 45 * 60 * 1000) continue;
    const key = slotKey(now, t);
    if (done.includes(key)) continue;
    // tandai lebih dulu agar tidak dobel saat interval berikutnya
    const next = [...done.filter(x => x !== key).slice(-19), key];
    dbm.setSetting('gdrive_done', JSON.stringify(next));
    dbm.setSetting('gdrive_last_slot', key);
    return runBackup(dbm, { trigger: 'otomatis' });
  }
  return null;
}
let timer = null;
function startScheduler(dbm) {
  if (timer) return timer;
  timer = setInterval(() => {
    checkSchedule(dbm).catch(e => console.error('[gdrive]', e.message));
  }, 30 * 1000);
  if (timer.unref) timer.unref();
  // cek sekali saat start (mengejar jadwal yang terlewat beberapa menit)
  setTimeout(() => { checkSchedule(dbm).catch(e => console.error('[gdrive]', e.message)); }, 15 * 1000).unref();
  return timer;
}
function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  parseCredentials, credSummary, accessToken, folderInfo, listBackups, uploadBackup, deleteFile,
  cleanupOld, testConnection, cfgFromDb, isConfigured, scheduleTimes, nextRun, checkSchedule,
  startScheduler, stopScheduler, runBackup, history, lastRun, logRun,
  _resetTokenCache: () => tokenCache.clear(),
  _driveError: driveError
};
