'use strict';
/**
 * Sumber tunggal untuk berkas backup SIMKEU Sekolah.
 * Dipakai oleh menu Backup & Restore (unduh manual) DAN oleh auto-backup
 * Telegram (backup_tg.js), supaya isi ZIP yang dikirim ke Telegram selalu
 * identik dengan backup yang bisa diunduh/direstore manual.
 */
const lib = require('./lib');
const crypto = require('crypto');

const TABLES = ['settings', 'users', 'permissions', 'tahun_ajaran', 'bku', 'bku_iuran_grup', 'bku_periode', 'coa', 'anggaran',
  'transaksi', 'piutang', 'piutang_bayar', 'spp', 'aset', 'pinjaman_mutasi', 'rekon_saldo', 'rekon_saldo_global', 'koreksi',
  'bku_import', 'audit', 'pegawai', 'payroll', 'payroll_post', 'payroll_draft', 'beasiswa', 'piutang_lain', 'piutang_lain_bayar',
  'trash', 'program_keahlian', 'kelas', 'siswa', 'siswa_mutasi', 'siswa_penempatan', 'iuran_grup', 'iuran_nominal', 'iuran_tagihan',
  'iuran_bayar', 'ekskul_honor', 'mutasi_kas', 'piutang_kategori', 'piutang_lainnya', 'piutang_lainnya_bayar',
  'catatan_pegawai', 'portal_pesan', 'otp_code', 'cloud_backup', 'beasiswa_grup', 'beasiswa_siswa', 'panduan',
  'wa_template', 'wa_reminder_log', 'iuran_checkout', 'notif'];

function dumpAll(db) {
  const readSnapshot = db.transaction(() => {
    const dump = { app: 'simkeu-sekolah', version: 2, created_at: lib.nowStamp(), tables: {} };
    for (const t of TABLES) dump.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
    return dump;
  });
  return readSnapshot();
}

function validateDump(db, dump) {
  if (!dump || dump.app !== 'simkeu-sekolah' || !dump.tables || typeof dump.tables !== 'object' || Array.isArray(dump.tables)) {
    throw new Error('Format berkas bukan backup SIMKEU Sekolah.');
  }
  const allowed = new Set(TABLES);
  const required = ['settings', 'users', 'permissions', 'tahun_ajaran'];
  for (const table of required) {
    if (!Array.isArray(dump.tables[table])) throw new Error(`Tabel wajib "${table}" tidak ada atau formatnya rusak.`);
  }
  for (const [table, rows] of Object.entries(dump.tables)) {
    if (!allowed.has(table)) throw new Error(`Tabel "${table}" tidak dikenal pada backup sekolah.`);
    if (!Array.isArray(rows)) throw new Error(`Data tabel "${table}" bukan daftar baris yang valid.`);
    const columns = new Set(db.pragma(`table_info("${table}")`).map(c => c.name));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row) || !Object.keys(row).length) {
        throw new Error(`Baris ${i + 1} pada tabel "${table}" tidak valid.`);
      }
      for (const column of Object.keys(row)) {
        if (!columns.has(column)) throw new Error(`Kolom "${table}.${column}" tidak tersedia pada versi aplikasi ini.`);
      }
    }
  }
  return {
    tables: Object.keys(dump.tables).length,
    rows: Object.values(dump.tables).reduce((sum, rows) => sum + rows.length, 0)
  };
}

function verifyZipManifest(files) {
  if (!files || !files['manifest.json']) return true;
  const payload = files['database.json'];
  if (!payload) throw new Error('database.json tidak ditemukan untuk pemeriksaan checksum.');
  let manifest;
  try { manifest = JSON.parse(files['manifest.json'].toString('utf8')); }
  catch (e) { throw new Error('Manifest backup tidak valid.'); }
  const actual = crypto.createHash('sha256').update(payload).digest('hex');
  if (manifest.database_sha256 !== actual) throw new Error('Checksum database.json tidak cocok; berkas ZIP mungkin rusak.');
  return true;
}

function csvOf(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}

/** ZIP backup database: database.json + data/<tabel>.csv + README.txt (+ berkas tambahan) */
function buildDatabaseZip(db, opts = {}) {
  const dump = dumpAll(db);
  const database = Buffer.from(JSON.stringify(dump, null, 1), 'utf8');
  const manifest = {
    app: 'simkeu-sekolah',
    version: 1,
    created_at: dump.created_at,
    database_sha256: crypto.createHash('sha256').update(database).digest('hex'),
    table_counts: Object.fromEntries(TABLES.map(t => [t, dump.tables[t].length]))
  };
  const files = [
    { name: 'database.json', data: database },
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 1) },
    {
      name: 'README.txt', data: [
        'BACKUP DATABASE SIMKEU SEKOLAH',
        'Dibuat: ' + lib.nowStamp(),
        '',
        'database.json  = salinan lengkap seluruh tabel (dipakai untuk Restore Data).',
        'data/*.csv     = rekap tiap tabel dalam format CSV untuk pemeriksaan manual.',
        '',
        'Cara restore: menu Pengaturan / Backup & Restore → Restore Data dari File ZIP → pilih berkas ini.',
        'PERINGATAN: restore mengganti seluruh data yang ada saat ini.'
      ].join('\r\n')
    }
  ];
  for (const t of TABLES) files.push({ name: `data/${t}.csv`, data: csvOf(dump.tables[t] || []) });
  for (const f of (opts.extraFiles || [])) if (f && f.name) files.push(f);
  const rows = TABLES.reduce((s, t) => s + (dump.tables[t] || []).length, 0);
  return { buffer: lib.zip(files), dump, rows, tables: TABLES.length + (opts.extraFiles || []).length };
}

const BULAN_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * Nama berkas backup dinamis (versioning):
 *   Backup_SIMKEU_03Nov2026_0600.zip
 */
function backupFileName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `Backup_SIMKEU_${p(d.getDate())}${BULAN_EN[d.getMonth()]}${d.getFullYear()}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/**
 * Nama berkas backup TINGKAT SEKOLAH (auto-backup Telegram):
 *   Backup_SIMKEU_SK01_03Nov2026_0600.zip
 */
function tenantBackupName(kode, d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const kodeBersih = String(kode || 'SEKOLAH').replace(/[^A-Za-z0-9]+/g, '').toUpperCase() || 'SEKOLAH';
  return `Backup_SIMKEU_${kodeBersih}_${p(d.getDate())}${BULAN_EN[d.getMonth()]}${d.getFullYear()}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
/**
 * Nama berkas backup SELURUH SaaS (auto-backup Super Admin):
 *   Backup_FULL_SIMKEU_03Nov2026_0600.zip
 */
function fullBackupName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `Backup_FULL_SIMKEU_${p(d.getDate())}${BULAN_EN[d.getMonth()]}${d.getFullYear()}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** pola nama berkas backup yang dibuat aplikasi ini (dasar kebijakan retensi) */
const BACKUP_NAME_RE = /^Backup_(SIMKEU_[A-Z0-9]+|FULL_SIMKEU)_\d{2}[A-Za-z]{3}\d{4}_\d{4}\.zip$/;

module.exports = {
  TABLES, dumpAll, validateDump, verifyZipManifest, csvOf, buildDatabaseZip,
  backupFileName, tenantBackupName, fullBackupName, BACKUP_NAME_RE, BULAN_EN
};
