'use strict';

require('./env');

const fs = require('fs');
const path = require('path');

function importSqlDump() {
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, 'data');
  const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, 'keuangan.sqlite'));
  const sqlPath = path.join(dataDir, '.railway-import.sql');
  const stagingPath = dbPath + '.importing';

  if (!fs.existsSync(sqlPath)) throw new Error('RAILWAY_IMPORT_SQL=1 tetapi berkas data/.railway-import.sql tidak ditemukan.');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  for (const suffix of ['', '-wal', '-shm']) {
    const file = stagingPath + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  const staging = new Database(stagingPath);
  try {
    staging.exec(fs.readFileSync(sqlPath, 'utf8'));
    const integrity = staging.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('Pemeriksaan integritas SQLite gagal.');
    }
    const tables = new Set(staging.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(row => row.name));
    for (const name of ['settings', 'users', 'tahun_ajaran']) {
      if (!tables.has(name)) throw new Error(`Dump SQL tidak memiliki tabel wajib: ${name}.`);
    }
  } catch (error) {
    staging.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = stagingPath + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    throw error;
  }
  staging.close();

  const backupBase = dbPath + '.before-import';
  const existing = ['', '-wal', '-shm']
    .map(suffix => [dbPath + suffix, backupBase + suffix])
    .filter(([file]) => fs.existsSync(file));

  if (existing.length && process.env.RAILWAY_IMPORT_REPLACE !== '1') {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = stagingPath + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    throw new Error('Database sudah ada; set RAILWAY_IMPORT_REPLACE=1 untuk menggantinya secara eksplisit.');
  }
  if (existing.some(([, backup]) => fs.existsSync(backup))) {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = stagingPath + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    throw new Error('Berkas cadangan sebelum import sudah ada; tidak menimpa data.');
  }

  const moved = [];
  let imported = false;
  try {
    for (const [file, backup] of existing) {
      fs.renameSync(file, backup);
      moved.push([file, backup]);
    }
    fs.renameSync(stagingPath, dbPath);
    imported = true;
    fs.unlinkSync(sqlPath);
  } catch (error) {
    if (imported) {
      for (const suffix of ['', '-wal', '-shm']) {
        const file = dbPath + suffix;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
    for (const [file, backup] of moved.reverse()) {
      if (fs.existsSync(backup)) fs.renameSync(backup, file);
    }
    throw error;
  }

  console.log('[railway] dump SQLite diimpor dan lolos integrity_check.');
}

if (process.env.RAILWAY_IMPORT_SQL === '1') importSqlDump();

require('./server');
