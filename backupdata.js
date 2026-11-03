'use strict';
/**
 * Sumber tunggal untuk berkas backup SIMKEU Sekolah.
 * Dipakai oleh menu Backup & Restore (unduh manual) DAN oleh integrasi
 * Auto-Backup Google Drive (gdrive.js), supaya isi ZIP yang diunggah ke
 * cloud selalu identik dengan backup yang bisa diunduh/direstore manual.
 */
const lib = require('./lib');

const TABLES = ['settings', 'users', 'permissions', 'tahun_ajaran', 'bku', 'bku_periode', 'coa', 'anggaran',
  'transaksi', 'piutang', 'piutang_bayar', 'spp', 'aset', 'pinjaman_mutasi', 'rekon_saldo', 'koreksi',
  'bku_import', 'audit', 'pegawai', 'payroll', 'payroll_post', 'payroll_draft', 'beasiswa', 'piutang_lain', 'piutang_lain_bayar',
  'trash', 'program_keahlian', 'kelas', 'siswa', 'siswa_mutasi', 'siswa_penempatan', 'iuran_grup', 'iuran_nominal', 'iuran_tagihan',
  'iuran_bayar', 'ekskul_honor', 'mutasi_kas', 'piutang_kategori', 'piutang_lainnya', 'piutang_lainnya_bayar',
  'catatan_pegawai', 'portal_pesan', 'otp_code', 'cloud_backup', 'beasiswa_grup', 'beasiswa_siswa', 'panduan'];

function dumpAll(db) {
  const dump = { app: 'simkeu-sekolah', version: 2, created_at: lib.nowStamp(), tables: {} };
  for (const t of TABLES) {
    try { dump.tables[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch (e) { dump.tables[t] = []; }
  }
  return dump;
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

/** ZIP backup database: database.json + data/<tabel>.csv + README.txt */
function buildDatabaseZip(db) {
  const dump = dumpAll(db);
  const files = [
    { name: 'database.json', data: JSON.stringify(dump, null, 1) },
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
  const rows = TABLES.reduce((s, t) => s + (dump.tables[t] || []).length, 0);
  return { buffer: lib.zip(files), dump, rows, tables: TABLES.length };
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

/** pola nama berkas backup yang dibuat aplikasi ini (dasar kebijakan retensi) */
const BACKUP_NAME_RE = /^Backup_SIMKEU_\d{2}[A-Za-z]{3}\d{4}_\d{4}\.zip$/;

module.exports = { TABLES, dumpAll, csvOf, buildDatabaseZip, backupFileName, BACKUP_NAME_RE, BULAN_EN };
