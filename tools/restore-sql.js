#!/usr/bin/env node
'use strict';

/**
 * Pemulihan database SIMKEU dari berkas dump SQL portabel.
 *
 * Berkas dump dihasilkan oleh menu Super Admin → "Download Keseluruhan Data (.sql)"
 * (Backup_FULL_SIMKEU_*.sql). Isinya memuat beberapa basis data yang dipisah
 * blok komentar, contoh:
 *
 *   -- ================================================================
 *   -- CONTROL PLANE (saas.db)
 *   -- 2026-11-27 10:00:00
 *   -- ================================================================
 *   ... (DROP / CREATE / INSERT) ...
 *   -- ================================================================
 *   -- SEKOLAH HM2H — SMK PGRI Cikoneng (tenant_id 1)
 *   -- 2026-11-27 10:00:00
 *   -- ================================================================
 *   ... (DROP / CREATE / INSERT) ...
 *   -- total 15512 baris dari 1 sekolah + control plane
 *
 * Skrip ini memecah berkas pada batas blok tersebut lalu menuliskan tiap bagian
 * ke database sasarannya:
 *
 *   - CONTROL PLANE   -> SAAS_DB_PATH   (default <data>/saas.db)
 *   - tenant_id 1     -> DB_PATH        (default <data>/keuangan.sqlite)
 *   - tenant_id N>1   -> kolom tenants.db_file pada control plane
 *                        (fallback <data>/tenants/tenant-<N>.db)
 *
 * PEMAKAIAN
 *   node tools/restore-sql.js <berkas.sql> [--dry] [--force]
 *
 *   --dry    hanya memeriksa & menampilkan bagian, tanpa menulis database
 *   --force  paksa pulihkan walau penanda ".restore-done" sudah ada
 *
 * VARIABEL LINGKUNGAN
 *   DB_PATH, SAAS_DB_PATH     lokasi database (default: <repo>/data/...)
 *   SUPER_PASSWORD            bila diisi, sandi akun super admin disetel ke nilai ini
 *   RESTORE_NO_BACKUP=1       jangan cadangkan database lama (langsung hapus)
 *   KEEP_SQL=1                jangan hapus berkas SQL setelah sukses
 *
 * Aman dijalankan berkali-kali: setelah sukses dibuat penanda ".restore-done",
 * sehingga eksekusi berikutnya berhenti sendiri (kecuali memakai --force).
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DATA_DIR = path.join(REPO, 'data');
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'keuangan.sqlite'));
const SAAS_DB_PATH = path.resolve(process.env.SAAS_DB_PATH || path.join(path.dirname(DB_PATH), 'saas.db'));

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const dry = argv.includes('--dry');
const sqlArg = argv.find((a) => !a.startsWith('--'));
const sqlPath = path.resolve(sqlArg || path.join(DATA_DIR, 'import.sql'));
const doneMark = path.join(DATA_DIR, '.restore-done');

const log = (...a) => console.log('[restore] ' + a.join(' '));
const fail = (msg) => { console.error('[restore] GAGAL: ' + msg); process.exit(1); };

function backupOrClear(target) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffixes = ['', '-wal', '-shm'];
  const found = suffixes.filter((s) => fs.existsSync(target + s));
  if (!found.length) return;
  if (process.env.RESTORE_NO_BACKUP === '1') {
    for (const s of found) fs.unlinkSync(target + s);
    return;
  }
  for (const s of found) {
    const dest = target + '.before-restore-' + stamp + s.replace('-wal', '.wal').replace('-shm', '.shm');
    fs.renameSync(target + s, dest);
    log('dicadangkan: ' + path.basename(dest));
  }
}

/** pecah dump menjadi bagian-bagian sesuai blok judul `-- ==== / -- Judul / -- ts / -- ====` */
function splitSections(raw) {
  const re = /^-- ={10,}\r?\n-- (.+)\r?\n-- (.+)\r?\n-- ={10,}[ \t]*\r?\n/gm;
  const marks = [];
  let m;
  while ((m = re.exec(raw))) marks.push({ headerStart: m.index, bodyStart: re.lastIndex, title: m[1].trim() });
  return marks.map((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].headerStart : raw.length;
    return { title: mk.title, sql: raw.slice(mk.bodyStart, end).trim() };
  });
}

function classify(title) {
  if (/CONTROL PLANE/i.test(title)) return { kind: 'saas' };
  const mt = title.match(/tenant_id\s+(\d+)/i);
  if (mt) return { kind: 'tenant', id: Number(mt[1]) };
  return { kind: 'unknown' };
}

function tenantFile(id, controlConn) {
  if (id === 1) return DB_PATH;
  try {
    const row = controlConn.prepare('SELECT db_file FROM tenants WHERE id=?').get(id);
    if (row && row.db_file) return path.resolve(row.db_file);
  } catch (e) { /* control plane belum ada / tanpa tabel tenants */ }
  for (const name of ['tenant-' + id + '.db', 'tenant-' + id + '.sqlite']) {
    const fp = path.join(path.dirname(DB_PATH), 'tenants', name);
    if (fs.existsSync(fp)) return fp;
  }
  return path.join(path.dirname(DB_PATH), 'tenants', 'tenant-' + id + '.db');
}

function importSection(target, sql, label, required) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  backupOrClear(target);

  const Database = require('better-sqlite3');
  const conn = new Database(target);
  try {
    conn.pragma('foreign_keys = OFF');
    conn.pragma('journal_mode = DELETE');
    conn.pragma('synchronous = FULL');
    conn.exec(sql);
    const ic = conn.pragma('integrity_check');
    const okIntegrity = ic.length === 1 && ic[0].integrity_check === 'ok';
    if (!okIntegrity) throw new Error('integrity_check tidak OK: ' + JSON.stringify(ic));
    const tables = new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const missing = required.filter((t) => !tables.has(t));
    if (missing.length) throw new Error('tabel wajib tidak ada: ' + missing.join(', '));
    const rows = conn.prepare("SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table') t").get();
    log('OK   ' + label + ' → ' + target + '  (' + rows.t + ' tabel)');
  } finally {
    conn.close();
  }
}

function main() {
  if (!fs.existsSync(sqlPath)) fail('berkas SQL tidak ditemukan: ' + sqlPath);
  if (fs.existsSync(doneMark) && !force && !dry) {
    log('sudah pernah dipulihkan (penanda ' + doneMark + '). Gunakan --force bila ingin mengulang.');
    return;
  }

  const raw = fs.readFileSync(sqlPath, 'utf8');
  const sections = splitSections(raw).map((s) => ({ ...s, info: classify(s.title) })).filter((s) => s.info.kind !== 'unknown');

  log('berkas: ' + sqlPath + ' (' + raw.length + ' byte)');
  log('bagian ditemukan: ' + sections.map((s) => s.info.kind === 'saas' ? 'control-plane' : 'tenant#' + s.info.id).join(', '));
  if (!sections.length) fail('tidak ada bagian CONTROL PLANE / SEKOLAH di dalam berkas.');

  if (dry) {
    for (const s of sections) {
      const stmts = (s.sql.match(/;\s*$/gm) || []).length;
      log('  - ' + s.title + '  (' + s.sql.length + ' byte, ~' + stmts + ' pernyataan)');
    }
    log('mode --dry: tidak ada perubahan ditulis.');
    return;
  }

  // 1) Control plane lebih dulu (agar kita bisa membaca tenants.db_file).
  const cp = sections.find((s) => s.info.kind === 'saas');
  if (cp) importSection(SAAS_DB_PATH, cp.sql, 'CONTROL PLANE', ['tenants', 'saas_users', 'saas_settings']);
  else log('PERINGATAN: bagian CONTROL PLANE tidak ada — control plane dibiarkan apa adanya.');

  // 2) Seluruh tenant.
  const Database = require('better-sqlite3');
  const controlConn = fs.existsSync(SAAS_DB_PATH) ? new Database(SAAS_DB_PATH, { readonly: true }) : null;
  const imported = [];
  try {
    for (const s of sections.filter((x) => x.info.kind === 'tenant')) {
      const target = tenantFile(s.info.id, controlConn);
      importSection(target, s.sql, s.title, ['settings', 'users', 'tahun_ajaran']);
      imported.push({ id: s.info.id, file: target });
    }
  } finally {
    if (controlConn) controlConn.close();
  }

  // 2b) Selaraskan kolom tenants.db_file dengan lokasi berkas yang baru
  //     (dump dari server lama biasanya menyimpan path absolut lama, mis.
  //      "/app/data/keuangan.sqlite").
  if (imported.length && fs.existsSync(SAAS_DB_PATH)) {
    const conn = new Database(SAAS_DB_PATH);
    try {
      for (const it of imported) {
        try {
          conn.prepare('UPDATE tenants SET db_file=? WHERE id=?').run(it.file, it.id);
          log('db_file tenant#' + it.id + ' → ' + it.file);
        } catch (e) { log('PERINGATAN: gagal menyelaraskan db_file tenant#' + it.id + ': ' + e.message); }
      }
    } finally {
      conn.close();
    }
  }

  // 3) Opsional: setel ulang sandi super admin.
  if (process.env.SUPER_PASSWORD) {
    try {
      const conn = new Database(SAAS_DB_PATH);
      const row = conn.prepare("SELECT id,email FROM saas_users WHERE role='super_admin' ORDER BY id LIMIT 1").get();
      if (row) {
        conn.prepare('UPDATE saas_users SET password=? WHERE id=?').run(require(path.join(REPO, 'lib')).hashPassword(process.env.SUPER_PASSWORD), row.id);
        log('sandi super admin (' + row.email + ') disetel dari SUPER_PASSWORD.');
      } else {
        log('PERINGATAN: akun super admin tidak ditemukan di control plane.');
      }
      conn.close();
    } catch (e) {
      log('PERINGATAN: gagal menyetel sandi super admin: ' + e.message);
    }
  }

  try {
    fs.writeFileSync(doneMark, new Date().toISOString() + '\n' + path.basename(sqlPath) + '\n');
    if (process.env.KEEP_SQL !== '1' && path.resolve(sqlPath) !== path.resolve(path.join(DATA_DIR, 'import.sql.keep'))) {
      fs.unlinkSync(sqlPath);
      log('berkas SQL dihapus (setel KEEP_SQL=1 bila ingin menyimpannya).');
    }
  } catch (e) {
    log('PERINGATAN: gagal menulis penanda/berkas: ' + e.message);
  }

  log('SELESAI — semua basis data berhasil dipulihkan.');
}

main();
