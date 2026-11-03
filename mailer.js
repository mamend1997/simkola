'use strict';
/**
 * ==================================================================
 * EMAIL + AUTO-BACKUP DATABASE VIA SMTP (tanpa dependency eksternal)
 * ------------------------------------------------------------------
 * Klien SMTP minimal (net/tls): EHLO → STARTTLS (opsional) → AUTH LOGIN
 * → MAIL FROM / RCPT TO / DATA, mendukung satu lampiran biner (base64).
 *
 * Dipakai untuk mengirim berkas backup .zip sebagai lampiran email ke
 * Email Penerima Backup (panel sekolah & panel Super Admin), 2x sehari
 * pukul 06:00 dan 15:00. Berkas sementara SELALU dihapus dari disk
 * setelah email selesai dikirim (berhasil maupun gagal).
 * ==================================================================
 */
const net = require('net');
const tls = require('tls');
const os = require('os');
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const bd = require('./backupdata');

const TIMEOUT = 25000;

function makeReader(sock) {
  let buf = '';
  let pending = null;
  let failure = null;
  const flush = () => {
    if (!pending) return;
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\d{3}) /.exec(lines[i]);
      if (m) {
        const resp = { code: Number(m[1]), text: lines.slice(0, i + 1).join(' ').replace(/\s+/g, ' ').trim() };
        buf = lines.slice(i + 1).join('\r\n');
        const p = pending; pending = null;
        p.resolve(resp);
        return;
      }
    }
  };
  sock.on('data', d => { buf += d.toString('utf8'); flush(); });
  sock.on('error', e => { failure = e; if (pending) { const p = pending; pending = null; p.reject(e); } });
  return {
    read() {
      return new Promise((resolve, reject) => {
        if (failure) return reject(failure);
        pending = { resolve, reject };
        flush();
      });
    },
    send(str) { sock.write(str); }
  };
}

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const secure = String(cfg.secure) === '1' || Number(cfg.port) === 465;
    const opts = { host: cfg.host, port: Number(cfg.port) || 587 };
    const onErr = e => reject(e);
    const sock = secure
      ? tls.connect(Object.assign({ servername: cfg.host }, opts), () => { sock.setTimeout(TIMEOUT, () => sock.destroy(new Error('SMTP timeout'))); resolve(sock); })
      : net.connect(opts, () => { sock.setTimeout(TIMEOUT, () => sock.destroy(new Error('SMTP timeout'))); resolve(sock); });
    sock.once('error', onErr);
  });
}

function upgradeTls(sock, host) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket: sock, servername: host }, () => resolve(t));
    t.once('error', reject);
    t.setTimeout(TIMEOUT, () => t.destroy(new Error('SMTP TLS timeout')));
  });
}

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

function encodeHeader(text) {
  const s = String(text || '');
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return '=?UTF-8?B?' + b64(s) + '?=';
}

function wrap76(b64str) {
  return (b64str.match(/.{1,76}/g) || []).join('\r\n');
}

/** bangun MIME message (satu penerima, satu lampiran opsional) */
function buildMessage({ from, fromName, to, subject, text, attachment }) {
  const boundary = 'simkeu-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const head = [
    'Date: ' + new Date().toUTCString(),
    'From: ' + (fromName ? encodeHeader(fromName) + ' ' : '') + '<' + from + '>',
    'To: <' + to + '>',
    'Subject: ' + encodeHeader(subject),
    'Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@simkeu>',
    'MIME-Version: 1.0'
  ];
  const bodyText = String(text || '').replace(/\r?\n/g, '\r\n');
  if (!attachment) {
    head.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit');
    return head.join('\r\n') + '\r\n\r\n' + bodyText;
  }
  head.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
  const parts = [
    head.join('\r\n'),
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyText,
    '',
    '--' + boundary,
    'Content-Type: application/zip; name="' + attachment.filename + '"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="' + attachment.filename + '"',
    '',
    wrap76(attachment.content.toString('base64')),
    '',
    '--' + boundary + '--',
    ''
  ];
  return parts.join('\r\n');
}

/**
 * Kirim satu email. cfg = { host, port, secure, user, pass, from }
 * msg = { to, subject, text, attachment: { filename, content: Buffer } }
 */
async function send(cfg, msg) {
  const cfgErr = validateConfig(cfg);
  if (cfgErr) throw new Error(cfgErr);
  if (!String(msg.to || '').trim()) throw new Error('Email penerima backup belum diisi.');
  const from = String(cfg.from || cfg.user || '').trim();
  let sock = await connect(cfg);
  let io = makeReader(sock);
  try {
    let r = await io.read();
    if (r.code !== 220) throw new Error('SMTP menolak koneksi: ' + r.text);

    const ehlo = async () => {
      io.send('EHLO simkeu\r\n');
      return await io.read();
    };
    let eh = await ehlo();
    if (eh.code !== 250) throw new Error('EHLO gagal: ' + eh.text);
    const caps = eh.text.toUpperCase();

    if (String(cfg.secure) !== '1' && Number(cfg.port) !== 465 && /STARTTLS/.test(caps)) {
      io.send('STARTTLS\r\n');
      r = await io.read();
      if (r.code !== 220) throw new Error('STARTTLS ditolak: ' + r.text);
      sock = await upgradeTls(sock, cfg.host);
      io = makeReader(sock);
      eh = await ehlo();
      if (eh.code !== 250) throw new Error('EHLO setelah STARTTLS gagal: ' + eh.text);
    }

    if (String(cfg.user || '').trim()) {
      io.send('AUTH LOGIN\r\n');
      r = await io.read();
      if (r.code !== 334) throw new Error('Server SMTP tidak mendukung AUTH LOGIN: ' + r.text);
      io.send(b64(cfg.user) + '\r\n');
      r = await io.read();
      if (r.code !== 334) throw new Error('AUTH username ditolak: ' + r.text);
      io.send(b64(cfg.pass) + '\r\n');
      r = await io.read();
      if (r.code !== 235) throw new Error('Login SMTP gagal (periksa email/app password): ' + r.text);
    }

    io.send('MAIL FROM:<' + from + '>\r\n');
    r = await io.read();
    if (r.code !== 250) throw new Error('MAIL FROM ditolak: ' + r.text);
    io.send('RCPT TO:<' + String(msg.to).trim() + '>\r\n');
    r = await io.read();
    if (![250, 251].includes(r.code)) throw new Error('Alamat penerima ditolak: ' + r.text);
    io.send('DATA\r\n');
    r = await io.read();
    if (r.code !== 354) throw new Error('DATA ditolak: ' + r.text);
    const raw = buildMessage({
      from, fromName: cfg.from_name || 'SIMKEU Sekolah', to: msg.to,
      subject: msg.subject, text: msg.text, attachment: msg.attachment
    });
    // dot-stuffing
    io.send(raw.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
    r = await io.read();
    if (r.code !== 250) throw new Error('Email ditolak server: ' + r.text);
    io.send('QUIT\r\n');
    try { await io.read(); } catch (e) { }
    return { ok: true };
  } finally {
    try { sock.destroy(); } catch (e) { }
  }
}

function validateConfig(cfg) {
  if (!cfg || !String(cfg.host || '').trim()) return 'SMTP Host belum diisi.';
  const port = Number(cfg.port);
  if (!port || port < 1 || port > 65535) return 'SMTP Port tidak valid.';
  if (!String(cfg.from || cfg.user || '').trim()) return 'Email pengirim belum diisi.';
  if (!String(cfg.user || '').trim()) return 'Email pengirim (akun SMTP) belum diisi.';
  return '';
}

/* ==================================================================
   AUTO-BACKUP: SEKOLAH (TENANT)
   Pengaturan disimpan di tabel settings database sekolah:
   mail_aktif, mail_to, mail_host, mail_port, mail_secure, mail_from,
   mail_user, mail_pass, mail_slots.
   ================================================================== */
const MAIL_KEYS = ['mail_aktif', 'mail_to', 'mail_host', 'mail_port', 'mail_secure', 'mail_from', 'mail_user', 'mail_pass', 'mail_slots'];

function tenantMailConfig(dbm) {
  const g = (k, d = '') => String(dbm.getSetting(k, d) || '');
  return {
    aktif: g('mail_aktif', '0') === '1',
    to: g('mail_to'),
    host: g('mail_host'),
    port: g('mail_port', '587'),
    secure: g('mail_secure', '0'),
    from: g('mail_from'),
    user: g('mail_user'),
    pass: g('mail_pass'),
    slots: g('mail_slots', '06:00,15:00')
  };
}

function logTenantBackup(dbm, row) {
  try {
    dbm.db.prepare(`INSERT INTO cloud_backup (waktu,nama_berkas,ukuran,file_id,status,pesan,pemicu,user_nama,dihapus,durasi_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(lib.nowStamp(), row.nama_berkas || '', row.ukuran || 0, row.file_id || '',
      row.status || 'gagal', row.pesan || '', row.pemicu || 'jadwal', row.user_nama || 'Sistem', row.dihapus || 1, row.durasi_ms || 0);
  } catch (e) { }
}

/**
 * Backup + kirim email untuk satu sekolah. WAJIB dipanggil di dalam
 * konteks tenant (dbm.runAsTenant).
 */
async function sendTenantBackup(dbm, { trigger = 'jadwal', user } = {}) {
  const cfg = tenantMailConfig(dbm);
  const started = Date.now();
  const nama = bd.backupFileName(new Date());
  let tmp = '';
  try {
    if (!cfg.aktif && trigger === 'jadwal') return { skipped: true, reason: 'Auto-backup email nonaktif' };
    if (!cfg.to) throw new Error('Email penerima backup belum diisi.');
    const zip = bd.buildDatabaseZip(dbm.db);
    const namaSekolah = String(dbm.getSetting('sekolah_nama', 'Sekolah') || 'Sekolah');
    // berkas sementara di luar folder aplikasi → dihapus lagi setelah terkirim
    tmp = path.join(os.tmpdir(), 'simkeu-mail-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.zip');
    fs.writeFileSync(tmp, zip.buffer);
    await send(
      { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from },
      {
        to: cfg.to,
        subject: `Backup Database ${namaSekolah} — ${nama}`,
        text: [
          `Backup otomatis database SIMKEU — ${namaSekolah}`,
          'Waktu    : ' + lib.nowStamp(),
          'Berkas   : ' + nama,
          'Isi      : ' + zip.rows + ' baris dari ' + zip.tables + ' tabel',
          'Pemicu   : ' + (trigger === 'jadwal' ? 'jadwal otomatis (06:00 / 15:00)' : 'kirim manual'),
          '',
          'Simpan berkas lampiran ini di tempat aman. Berkas di server sudah dihapus',
          'otomatis setelah email ini terkirim agar penyimpanan tidak penuh.',
          '',
          'Restore: menu Backup & Restore → Restore Data dari File ZIP.'
        ].join('\r\n'),
        attachment: { filename: nama, content: zip.buffer }
      }
    );
    logTenantBackup(dbm, { nama_berkas: nama, ukuran: zip.buffer.length, status: 'sukses', pesan: 'Terkirim ke ' + cfg.to, pemicu: trigger, user_nama: user || 'Sistem', dihapus: 1, durasi_ms: Date.now() - started });
    return { ok: true, nama, ukuran: zip.buffer.length, to: cfg.to, rows: zip.rows };
  } catch (e) {
    logTenantBackup(dbm, { nama_berkas: nama, ukuran: 0, status: 'gagal', pesan: e.message, pemicu: trigger, user_nama: user || 'Sistem', dihapus: 1, durasi_ms: Date.now() - started });
    throw e;
  } finally {
    // AUTO-CLEANUP: berkas .zip tidak pernah dibiarkan menumpuk di disk server
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { } }
  }
}

/* ==================================================================
   AUTO-BACKUP: SUPER ADMIN (seluruh SaaS)
   ================================================================== */
function saasMailConfig(saas) {
  const g = (k, d = '') => String(saas.get(k, d) || '');
  return {
    aktif: g('mail_aktif', '0') === '1',
    to: g('mail_to'),
    host: g('mail_host'),
    port: g('mail_port', '587'),
    secure: g('mail_secure', '0'),
    from: g('mail_from'),
    user: g('mail_user'),
    pass: g('mail_pass'),
    slots: g('backup_slots', '06:00,15:00')
  };
}

function buildSaasZip(dbm, saas) {
  const files = [];
  const control = { app: 'simkeu-saas', version: 1, created_at: lib.nowStamp(), tables: {} };
  const skip = new Set(['sessions']);
  for (const name of dbm.tableNamesOf ? dbm.tableNamesOf(saas.db) : []) {
    if (skip.has(name)) continue;
    try { control.tables[name] = saas.db.prepare('SELECT * FROM "' + name + '"').all(); } catch (e) { control.tables[name] = []; }
  }
  files.push({ name: 'saas/control-plane.json', data: JSON.stringify(control, null, 1) });
  let totalRows = 0, totalTenants = 0;
  for (const t of saas.allTenants()) {
    try {
      const conn = dbm.openTenantConn(t.id, t.db_file);
      const dump = bd.dumpAll(conn);
      const rows = Object.values(dump.tables).reduce((s, r) => s + r.length, 0);
      totalRows += rows; totalTenants++;
      files.push({ name: `sekolah/${t.school_code}-${String(t.nama || '').replace(/[^\w]+/g, '_').slice(0, 40)}/database.json`, data: JSON.stringify(dump, null, 1) });
    } catch (e) {
      files.push({ name: `sekolah/${t.school_code}/ERROR.txt`, data: 'Gagal membaca database: ' + e.message });
    }
  }
  files.push({
    name: 'README.txt', data: [
      'BACKUP SELURUH SaaS SIMKEU',
      'Dibuat: ' + lib.nowStamp(),
      '',
      'saas/control-plane.json      = daftar sekolah, tagihan, pengaturan QRIS/SMTP',
      'sekolah/<kode>/database.json = salinan lengkap database tiap sekolah',
      '',
      `Jumlah sekolah: ${totalTenants} · total baris data: ${totalRows}`
    ].join('\r\n')
  });
  return { buffer: lib.zip(files), rows: totalRows, tenants: totalTenants, control };
}

function logSaasBackup(saas, row) {
  try {
    saas.db.prepare(`INSERT INTO saas_backup_log (scope,tenant_id,nama_berkas,ukuran,status,pesan,pemicu,tujuan,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(row.scope || 'saas', row.tenant_id || null, row.nama_berkas || '', row.ukuran || 0,
      row.status || 'gagal', row.pesan || '', row.pemicu || 'jadwal', row.tujuan || '', lib.nowStamp());
  } catch (e) { }
}

async function sendSaasBackup(dbm, saas, { trigger = 'jadwal', user } = {}) {
  const cfg = saasMailConfig(saas);
  const started = Date.now();
  const nama = bd.backupFileName(new Date());
  let tmp = '';
  try {
    if (!cfg.aktif && trigger === 'jadwal') return { skipped: true, reason: 'Auto-backup email nonaktif' };
    if (!cfg.to) throw new Error('Email penerima backup belum diisi.');
    const zip = buildSaasZip(dbm, saas);
    tmp = path.join(os.tmpdir(), 'simkeu-saas-' + Date.now() + '.zip');
    fs.writeFileSync(tmp, zip.buffer);
    await send(
      { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from },
      {
        to: cfg.to,
        subject: `Backup SaaS SIMKEU (semua sekolah) — ${nama}`,
        text: [
          'Backup otomatis SELURUH SaaS SIMKEU',
          'Waktu   : ' + lib.nowStamp(),
          'Berkas  : ' + nama,
          'Sekolah : ' + zip.tenants,
          'Baris   : ' + zip.rows,
          '',
          'Berkas di server dihapus otomatis setelah email terkirim.'
        ].join('\r\n'),
        attachment: { filename: nama, content: zip.buffer }
      }
    );
    logSaasBackup(saas, { nama_berkas: nama, ukuran: zip.buffer.length, status: 'sukses', pesan: 'Terkirim ke ' + cfg.to, pemicu: trigger, tujuan: cfg.to });
    return { ok: true, nama, ukuran: zip.buffer.length, to: cfg.to, tenants: zip.tenants, rows: zip.rows };
  } catch (e) {
    logSaasBackup(saas, { nama_berkas: nama, ukuran: 0, status: 'gagal', pesan: e.message, pemicu: trigger, tujuan: cfg.to });
    throw e;
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { } }
  }
}

/* ==================================================================
   PENJADWALAN 2× SEHARI (06:00 & 15:00)
   ================================================================== */
function slotNow(slots) {
  const now = new Date();
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

let runningBackup = false;

/**
 * Cek jadwal backup email. Dipanggil berkala oleh scheduler server.
 * Setiap slot hanya dijalankan sekali per hari (penanda di saas_settings).
 */
async function checkSchedules(dbm, saas) {
  if (runningBackup) return;
  const slot = slotNow(String(saas.get('backup_slots', '06:00,15:00')));
  if (!slot) return;
  if (String(saas.get('backup_last', '')).split(',').includes(slot.key)) return;
  runningBackup = true;
  const done = [];
  try {
    // panel super admin (seluruh SaaS)
    try {
      const r = await sendSaasBackup(dbm, saas, { trigger: 'jadwal' });
      if (!r.skipped) done.push('saas');
    } catch (e) { console.error('[backup-email saas]', e.message); }
    // setiap sekolah yang mengaktifkan auto-backup email
    for (const t of saas.allTenants()) {
      try {
        await dbm.runAsTenant(t, async () => {
          const cfg = tenantMailConfig(dbm);
          if (!cfg.aktif) return;
          try {
            await sendTenantBackup(dbm, { trigger: 'jadwal' });
            done.push(t.school_code);
          } catch (e) { console.error('[backup-email ' + t.school_code + ']', e.message); }
        });
      } catch (e) { }
    }
    const prev = String(saas.get('backup_last', '')).split(',').filter(Boolean).filter(k => k.startsWith(slot.key.slice(0, 11)));
    saas.set('backup_last', prev.concat([slot.key]).join(','));
  } finally {
    runningBackup = false;
  }
  return done;
}

module.exports = {
  MAIL_KEYS, send, validateConfig, buildMessage,
  tenantMailConfig, sendTenantBackup,
  saasMailConfig, sendSaasBackup, buildSaasZip,
  checkSchedules, slotNow
};
