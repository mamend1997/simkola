'use strict';
/**
 * ==================================================================
 * AUTO-BACKUP TELEGRAM (2× sehari: 06:00 & 15:00)
 * ------------------------------------------------------------------
 * · Tingkat SEKOLAH : data sekolah itu saja → Backup_SIMKEU_<KODE>_DDMMYYYY_HHMM.zip
 * · Tingkat SAAS    : seluruh database (control plane + semua sekolah)
 *                     → Backup_FULL_SIMKEU_DDMMYYYY_HHMM.zip
 *
 * Semua pekerjaan berat dijalankan lewat QUEUE (queue.js), bukan di dalam
 * request atau satu loop cron besar, supaya jumlah sekolah tidak membuat
 * timeout / memory limit.
 *
 * Berkas sementara (.zip / .sql) SELALU dihapus di blok `finally` —
 * berhasil maupun gagal terkirim (auto-cleanup wajib).
 * ==================================================================
 */
const fs = require('fs');
const bd = require('./backupdata');
const lib = require('./lib');
const tg = require('./telegram');

/* ---------------- pengaturan per sekolah ---------------- */
const TENANT_KEYS = ['tg_token', 'tg_chat', 'tg_aktif', 'tg_slots', 'tg_last'];

function tenantConfig(dbm) {
  const g = (k, d = '') => String(dbm.getSetting(k, d) || '');
  return {
    token: g('tg_token'),
    chat: g('tg_chat'),
    aktif: g('tg_aktif', '1') === '1',
    slots: g('tg_slots', '06:00,15:00'),
    last: g('tg_last', '')
  };
}
function saveTenantConfig(dbm, cfg) {
  for (const k of TENANT_KEYS) {
    if (cfg[k] !== undefined) dbm.setSetting(k, String(cfg[k] ?? ''));
  }
}
function tenantConfigured(dbm) {
  const c = tenantConfig(dbm);
  return !!(c.token && c.chat);
}
function logTenantBackup(dbm, row) {
  try {
    dbm.db.prepare(`INSERT INTO cloud_backup (waktu,nama_berkas,ukuran,file_id,status,pesan,pemicu,user_nama,dihapus,durasi_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(lib.nowStamp(), row.nama_berkas || '', row.ukuran || 0, row.file_id || '',
      row.status || 'gagal', row.pesan || '', row.pemicu || 'jadwal', row.user_nama || 'Sistem', 1, row.durasi_ms || 0);
  } catch (e) { }
}
function tenantHistory(dbm, limit = 10) {
  try { return dbm.db.prepare('SELECT * FROM cloud_backup ORDER BY id DESC LIMIT ?').all(Number(limit) || 10); } catch (e) { return []; }
}

/* ---------------- pengaturan SaaS ---------------- */
function saasConfig(saas) {
  const g = (k, d = '') => String(saas.get(k, d) || '');
  return {
    token: String(process.env.SAAS_TG_TOKEN || g('tg_token', '')),
    chat: String(process.env.SAAS_TG_CHAT || g('tg_chat', '')),
    aktif: g('tg_aktif', '1') === '1',
    slots: g('backup_slots', '06:00,15:00'),
    last: g('backup_last', '')
  };
}

/* ---------------- pembuat ZIP ---------------- */
/** ZIP data satu sekolah (semua tabel sudah terisolasi per database) */
function buildTenantZip(dbm, tenant) {
  const nama = dbm.getSetting('sekolah_nama', tenant.nama || 'Sekolah');
  const manifest = {
    app: 'simkeu-sekolah', scope: 'tenant',
    tenant_id: tenant.id, school_code: tenant.school_code, sekolah: nama,
    created_at: lib.nowStamp()
  };
  const zip = bd.buildDatabaseZip(dbm.db, {
    extraFiles: [
      { name: 'tenant.json', data: JSON.stringify(manifest, null, 1) },
      {
        name: 'README.txt', data: [
          'BACKUP OTOMATIS — SIMKEU SEKOLAH',
          'Sekolah      : ' + nama + ' (' + tenant.school_code + ')',
          'tenant_id    : ' + tenant.id,
          'Dibuat       : ' + lib.nowStamp(),
          '',
          'Berkas ini HANYA memuat data sekolah tersebut di atas.',
          'Restore: menu Backup & Restore sekolah → Restore Data dari File ZIP.'
        ].join('\r\n')
      }
    ]
  });
  return zip;
}

/** ZIP seluruh SaaS: control plane + database semua sekolah */
function buildSaasZip(dbm, saas) {
  const files = [];
  const control = saas.db.transaction(() => {
    const snapshot = { app: 'simkeu-saas', scope: 'full', version: 2, created_at: lib.nowStamp(), tables: {} };
    for (const name of dbm.tableNamesOf(saas.db)) {
      if (name === 'sessions' || name === 'saas_jobs') continue;
      snapshot.tables[name] = saas.db.prepare('SELECT * FROM "' + name + '"').all();
    }
    return snapshot;
  })();
  files.push({ name: 'saas/control-plane.json', data: JSON.stringify(control, null, 1) });
  let totalRows = 0, totalTenants = 0;
  for (const t of saas.allTenants()) {
    try {
      const conn = dbm.openTenantConn(t.id, t.db_file);
      const dump = bd.dumpAll(conn);
      totalRows += Object.values(dump.tables).reduce((s, r) => s + r.length, 0);
      totalTenants++;
      files.push({
        name: `sekolah/${t.school_code}-${String(t.nama || '').replace(/[^\w]+/g, '_').slice(0, 40)}/database.json`,
        data: JSON.stringify(dump, null, 1)
      });
    } catch (e) {
      throw new Error(`Backup sekolah ${t.school_code} gagal; berkas tidak dibuat. ${e.message}`);
    }
  }
  files.push({
    name: 'README.txt', data: [
      'BACKUP LENGKAP SaaS SIMKEU',
      'Dibuat: ' + lib.nowStamp(),
      '',
      'saas/control-plane.json      = daftar sekolah, tagihan, pengaturan QRIS/WA/pengumuman',
      'sekolah/<kode>/database.json = salinan lengkap database tiap sekolah',
      '',
      `Sekolah: ${totalTenants} · total baris data: ${totalRows}`
    ].join('\r\n')
  });
  return { buffer: lib.zip(files), rows: totalRows, tenants: totalTenants, control };
}

/* ---------------- kirim ke Telegram ---------------- */
/**
 * Jalankan backup satu sekolah lalu kirim ke Telegram sekolah tersebut.
 * WAJIB dipanggil di dalam konteks tenant (dbm.runAsTenant).
 */
async function runTenantBackup(dbm, saas, tenant, { trigger = 'jadwal', user = '' } = {}) {
  const cfg = tenantConfig(dbm);
  const started = Date.now();
  const namaBerkas = bd.tenantBackupName(tenant.school_code, new Date());
  let tmp = '';
  try {
    if (!cfg.aktif && trigger === 'jadwal') return { skipped: true, reason: 'Auto-backup Telegram nonaktif' };
    if (!cfg.token) throw new Error('Telegram Bot Token sekolah belum diisi.');
    if (!cfg.chat) throw new Error('Telegram Chat ID sekolah belum diisi.');
    const zip = buildTenantZip(dbm, tenant);
    tmp = tg.writeTemp(namaBerkas, zip.buffer);
    const res = await tg.sendDocument({
      token: cfg.token, chatId: cfg.chat, filename: namaBerkas, content: zip.buffer,
      caption: `Backup ${dbm.getSetting('sekolah_nama', tenant.nama)}\n${namaBerkas}\n${zip.rows} baris · ${Math.round(zip.buffer.length / 1024)} KB`
    });
    logTenantBackup(dbm, {
      nama_berkas: namaBerkas, ukuran: zip.buffer.length, file_id: res.fileId || '',
      status: 'sukses', pesan: 'Terkirim ke Telegram chat ' + cfg.chat, pemicu: trigger,
      user_nama: user || 'Sistem', durasi_ms: Date.now() - started
    });
    try { saas.backupLogAdd({ scope: 'tenant', tenant_id: tenant.id, nama_berkas: namaBerkas, ukuran: zip.buffer.length, status: 'sukses', pesan: 'Telegram ' + cfg.chat, pemicu: trigger, tujuan: 'telegram' }); } catch (e) { }
    return { ok: true, nama: namaBerkas, ukuran: zip.buffer.length, chat: cfg.chat, rows: zip.rows };
  } catch (e) {
    logTenantBackup(dbm, {
      nama_berkas: namaBerkas, ukuran: 0, status: 'gagal', pesan: e.message,
      pemicu: trigger, user_nama: user || 'Sistem', durasi_ms: Date.now() - started
    });
    try { saas.backupLogAdd({ scope: 'tenant', tenant_id: tenant.id, nama_berkas: namaBerkas, status: 'gagal', pesan: e.message, pemicu: trigger, tujuan: 'telegram' }); } catch (err) { }
    throw e;
  } finally {
    // AUTO-CLEANUP: berkas .zip/.sql sementara tidak boleh tertinggal di hosting
    tg.cleanup(tmp);
  }
}

/** Backup seluruh SaaS → Telegram Super Admin */
async function runSaasBackup(dbm, saas, { trigger = 'jadwal', user = '' } = {}) {
  const cfg = saasConfig(saas);
  const started = Date.now();
  const namaBerkas = bd.fullBackupName(new Date());
  let tmp = '';
  try {
    if (!cfg.aktif && trigger === 'jadwal') return { skipped: true, reason: 'Auto-backup server nonaktif' };
    if (!cfg.token) throw new Error('Telegram Bot Token Super Admin belum diisi.');
    if (!cfg.chat) throw new Error('Telegram Chat ID Super Admin belum diisi.');
    const zip = buildSaasZip(dbm, saas);
    tmp = tg.writeTemp(namaBerkas, zip.buffer);
    const res = await tg.sendDocument({
      token: cfg.token, chatId: cfg.chat, filename: namaBerkas, content: zip.buffer,
      caption: `Backup LENGKAP SaaS\n${namaBerkas}\n${zip.tenants} sekolah · ${zip.rows} baris · ${Math.round(zip.buffer.length / 1024)} KB`
    });
    saas.backupLogAdd({ scope: 'saas', nama_berkas: namaBerkas, ukuran: zip.buffer.length, status: 'sukses', pesan: 'Telegram ' + cfg.chat + ' · file_id ' + (res.fileId || ''), pemicu: trigger, tujuan: 'telegram' });
    return { ok: true, nama: namaBerkas, ukuran: zip.buffer.length, chat: cfg.chat, rows: zip.rows, tenants: zip.tenants };
  } catch (e) {
    saas.backupLogAdd({ scope: 'saas', nama_berkas: namaBerkas, status: 'gagal', pesan: e.message, pemicu: trigger, tujuan: 'telegram' });
    throw e;
  } finally {
    tg.cleanup(tmp);
  }
}

/* ---------------- cron / penjadwalan ---------------- */
/** dedupe slot per hari (dipanggil dari scheduler) */
function dueSlot(slots, lastRaw, now = new Date()) {
  const slot = tg.slotNow(slots, now);
  if (!slot) return null;
  const done = String(lastRaw || '').split(',').filter(Boolean);
  if (done.includes(slot.key)) return null;
  return slot;
}
function markDone(raw, key) {
  const day = String(key).slice(0, 10);
  const keep = String(raw || '').split(',').filter(Boolean).filter(k => k.slice(0, 10) === day);
  keep.push(key);
  return keep.join(',');
}

/**
 * Cek jadwal 06:00 & 15:00 lalu MASUKKAN pekerjaan ke queue.
 * Tidak mengerjakan backup secara langsung (hindari timeout bila sekolah banyak).
 */
function scheduleTick(dbm, saas) {
  const out = { queued: 0, slot: null };
  // 1) seluruh SaaS
  try {
    const cfg = saasConfig(saas);
    const slot = dueSlot(cfg.slots, saas.get('backup_last', ''));
    if (slot && cfg.aktif && cfg.token && cfg.chat) {
      queuePush(saas, 'backup.saas', { trigger: 'jadwal', slot: slot.key });
      out.queued++; out.slot = slot.key;
    }
  } catch (e) { }
  // 2) tiap sekolah yang mengaktifkan auto-backup
  for (const t of saas.allTenants()) {
    try {
      dbm.runAsTenant(t, () => {
        const cfg = tenantConfig(dbm);
        const slot = dueSlot(cfg.slots, cfg.last);
        if (!slot || !cfg.aktif || !cfg.token || !cfg.chat) return;
        queuePush(saas, 'backup.tenant', { tenantId: t.id, trigger: 'jadwal', slot: slot.key });
        out.queued++;
      });
    } catch (e) { }
  }
  return out;
}

let _saasRef = null;
function queuePush(saas, jenis, payload) {
  const q = require('./queue');
  return q.push(jenis, payload);
}

/** daftarkan handler queue (dipanggil sekali saat server start) */
function registerJobs(dbm, saas, queue) {
  _saasRef = saas;
  queue.register('backup.tenant', async (payload) => {
    const t = saas.tenantById(payload.tenantId);
    if (!t) return { note: 'sekolah tidak ada' };
    return await dbm.runAsTenant(t, async () => {
      const r = await runTenantBackup(dbm, saas, t, { trigger: payload.trigger || 'jadwal', user: payload.user || '' });
      if (payload.slot) saveTenantConfig(dbm, { tg_last: markDone(tenantConfig(dbm).last, payload.slot) });
      return { note: r.skipped ? r.reason : (r.nama || '') };
    });
  });
  queue.register('backup.saas', async (payload) => {
    const r = await runSaasBackup(dbm, saas, { trigger: payload.trigger || 'jadwal', user: payload.user || '' });
    if (payload.slot) saas.set('backup_last', markDone(saas.get('backup_last', ''), payload.slot));
    return { note: r.skipped ? r.reason : (r.nama || '') };
  });
  // pengingat perpanjangan H-7 (WA)
  queue.register('wa.reminder', async (payload) => {
    const t = saas.tenantById(payload.tenantId);
    if (!t) return { note: 'tidak ada' };
    const st = saas.statusOf(t);
    const msg = `*Pengingat Perpanjangan*\n\n` +
      `Sekolah: ${t.nama} (${t.school_code})\n` +
      `Masa aktif berakhir: ${t.expires_at || '-'}\n` +
      (st.daysLeft !== null && st.daysLeft >= 0 ? `Sisa ${st.daysLeft} hari lagi.\n` : 'Masa aktif sudah berakhir.\n') +
      `\nSilakan lakukan perpanjangan agar layanan tidak terhenti.`;
    const r = await saas.notifyTenantAdmin(t.id, msg);
    return { note: r.ok ? 'terkirim' : (r.reason || 'gagal') };
  });
  queue.register('wa.notify', async (payload) => {
    const r = await saas.notifyTenantAdmin(payload.tenantId, String(payload.message || ''));
    return { note: r.ok ? 'terkirim' : (r.reason || 'gagal') };
  });
  // penagihan harian (tagihan H-7 + auto-suspend) — dijalankan sebagai job queue
  queue.register('billing.daily', async () => {
    const r = saas.runDailyJobs();
    // pengingat WA H-7 ke admin sekolah (sekali per hari per sekolah)
    const today = saas.todayISO();
    const done = String(saas.get('wa_reminder_done', '')).split(',').filter(Boolean).filter(k => k.startsWith(today));
    let wa = 0;
    for (const t of saas.allTenants()) {
      if (Number(t.is_lifetime_free)) continue;
      const exp = String(t.expires_at || '').slice(0, 10);
      if (!exp) continue;
      const days = saas.daysBetween(today, exp);
      if (days < 0 || days > 7) continue;
      const key = today + ':' + t.id;
      if (done.includes(key)) continue;
      const q = require('./queue');
      q.push('wa.reminder', { tenantId: t.id });
      done.push(key); wa++;
    }
    try { saas.set('wa_reminder_done', done.slice(-400).join(',')); } catch (e) { }
    return { note: `tagihan ${r.invoices}, suspend ${r.suspended}, pengingat WA ${wa}` };
  });
  return queue;
}

/** scheduler periodik (dipanggil server.js) */
let schedTimer = null;
function startScheduler(dbm, saas) {
  if (schedTimer) return schedTimer;
  const tick = () => {
    try { scheduleTick(dbm, saas); } catch (e) { console.error('[backup-tg]', e.message); }
    try { tg.sweepTemps(); } catch (e) { }
  };
  schedTimer = setInterval(tick, 5 * 60 * 1000);
  if (schedTimer.unref) schedTimer.unref();
  setTimeout(tick, 15000).unref();
  return schedTimer;
}
function stopScheduler() { if (schedTimer) { clearInterval(schedTimer); schedTimer = null; } }

module.exports = {
  TENANT_KEYS, tenantConfig, saveTenantConfig, tenantConfigured, tenantHistory, logTenantBackup,
  saasConfig, buildTenantZip, buildSaasZip, runTenantBackup, runSaasBackup,
  scheduleTick, registerJobs, startScheduler, stopScheduler, dueSlot, markDone
};
