'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
require('./env');

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECTION_CONTROL = /^-- CONTROL PLANE \(saas\.db\)\s*$/m;
const SECTION_SCHOOL = /^-- SEKOLAH\b.*$/m;
const BATCH_SIZE = 100;
const EPHEMERAL_AUTH_TABLES = new Set(['sessions', 'otp_code', 'daftar_otp']);

function stripLeadingComments(raw) {
  let text = raw.trim();
  while (text) {
    if (text.startsWith('--')) {
      const end = text.indexOf('\n');
      text = end < 0 ? '' : text.slice(end + 1).trim();
      continue;
    }
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/', 2);
      if (end < 0) throw new Error('Komentar SQL tidak lengkap.');
      text = text.slice(end + 2).trim();
      continue;
    }
    break;
  }
  return text;
}

function splitStatements(source) {
  const statements = [];
  let start = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if (next === quote && quote !== ']') { i++; continue; }
        quote = '';
      } else if (ch === '\\' && quote === "'") {
        i++;
      }
      continue;
    }
    if (ch === '-' && next === '-') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') { quote = ']'; continue; }
    if (ch === ';') {
      const statement = source.slice(start, i + 1).trim();
      if (stripLeadingComments(statement).replace(/;$/, '').trim()) statements.push(statement);
      start = i + 1;
    }
  }
  if (quote || blockComment) throw new Error('String atau komentar SQL tidak lengkap.');
  const tail = source.slice(start).trim();
  if (stripLeadingComments(tail)) statements.push(tail);
  return statements;
}

function assertSafeDumpStatement(raw) {
  const statement = stripLeadingComments(raw).replace(/;\s*$/, '').trim();
  if (/^PRAGMA\s+foreign_keys\s*=\s*(?:OFF|0)$/i.test(statement)) return;
  if (/^DROP\s+TABLE\s+IF\s+EXISTS\s+(?:"[A-Za-z_][A-Za-z0-9_]*"|`[A-Za-z_][A-Za-z0-9_]*`|[A-Za-z_][A-Za-z0-9_]*)$/i.test(statement)) return;
  if (/^DROP\s+INDEX\s+IF\s+EXISTS\s+(?:"[A-Za-z_][A-Za-z0-9_]*"|`[A-Za-z_][A-Za-z0-9_]*`|[A-Za-z_][A-Za-z0-9_]*)$/i.test(statement)) return;
  if (/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+/i.test(statement)) return;
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+/i.test(statement)) return;
  if (/^INSERT\s+INTO\s+/i.test(statement)) return;
  if (/^BEGIN(?:\s+TRANSACTION)?$/i.test(statement) || /^COMMIT$/i.test(statement)) return;
  throw new Error(`Jenis pernyataan dump tidak diizinkan: ${statement.slice(0, 40).replace(/\s+/g, ' ')}`);
}

function parseDumpSections(sql) {
  const control = SECTION_CONTROL.exec(sql);
  const school = SECTION_SCHOOL.exec(sql);
  if (!control || !school || school.index <= control.index) {
    throw new Error('Dump harus berisi bagian CONTROL PLANE lalu SEKOLAH.');
  }
  const chunks = {
    control: sql.slice(0, school.index),
    school: sql.slice(school.index)
  };
  const databases = {};
  for (const [key, chunk] of Object.entries(chunks)) {
    const db = new DatabaseSync(':memory:');
    try {
      for (const statement of splitStatements(chunk)) {
        assertSafeDumpStatement(statement);
        db.exec(statement);
      }
      databases[key] = db;
    } catch (error) {
      db.close();
      for (const other of Object.values(databases)) other.close();
      throw new Error(`Dump ${key}: ${error.message}`);
    }
  }
  return databases;
}

function qid(name) {
  if (!IDENT.test(name)) throw new Error(`Identifier SQL tidak valid: ${name}`);
  return '`' + name + '`';
}

function maxTextLength(db, table, column) {
  const q = `SELECT COALESCE(MAX(length(${qid(column)})),0) AS n FROM ${qid(table)}`;
  return Number(db.prepare(q).get().n) || 0;
}

function unwrapDefault(raw) {
  let value = String(raw).trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      if (depth === 0 && i < value.length - 1) { wrapsAll = false; break; }
    }
    if (!wrapsAll || depth !== 0) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function mysqlDefault(raw) {
  if (raw === null || raw === undefined) return '';
  const value = unwrapDefault(raw);
  if (/^[-+]?\d+(?:\.\d+)?$/.test(value)) return ` DEFAULT ${value}`;
  if (/^'(?:[^']|'')*'$/.test(value)) return ` DEFAULT ${value}`;
  if (/^CURRENT_TIMESTAMP(?:\(\))?$/i.test(value)) return ` DEFAULT ${value.toUpperCase()}`;
  throw new Error(`Nilai DEFAULT SQLite tidak didukung: ${value.slice(0, 32)}`);
}

function partialIndexColumn(sql) {
  const where = /\bWHERE\b([\s\S]*)$/i.exec(sql || '');
  if (!where) return null;
  const condition = where[1].replace(/["`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nullOnly = /^([a-z_][a-z0-9_]*) is not null$/.exec(condition);
  if (nullOnly) return { column: nullOnly[1], nullableOnly: true };
  const emptyTest = /^([a-z_][a-z0-9_]*) is not null and \1\s*<>\s*''$/.exec(condition);
  if (emptyTest) return { column: emptyTest[1], nullableOnly: false };
  const coalesceTest = /^coalesce\(([a-z_][a-z0-9_]*),\s*''\)\s*<>\s*''$/.exec(condition);
  if (coalesceTest) return { column: coalesceTest[1], nullableOnly: false };
  throw new Error(`Partial index SQLite tidak didukung: ${(sql || '').slice(0, 100)}`);
}

function inspectTable(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${qid(table)})`).all();
  if (!columns.length) throw new Error(`Tabel ${table} tidak punya kolom.`);
  const indexes = db.prepare(`PRAGMA index_list(${qid(table)})`).all();
  const indexDefs = [];
  const uniqueTextColumns = new Set(columns.filter(c => c.pk).map(c => c.name));
  const maxLengths = new Map();
  for (const index of indexes) {
    if (index.origin === 'pk') continue;
    const parts = db.prepare(`PRAGMA index_info(${qid(index.name)})`).all();
    if (!parts.length || parts.some(p => p.cid < 0 || !p.name)) {
      throw new Error(`Index ekspresi tidak didukung: ${index.name}`);
    }
    const names = parts.map(p => p.name);
    const sqlRow = db.prepare('SELECT sql FROM sqlite_master WHERE type=\'index\' AND name=?').get(index.name);
    const partial = index.partial ? partialIndexColumn(sqlRow && sqlRow.sql) : null;
    if (partial && !partial.nullableOnly) uniqueTextColumns.add(partial.column);
    if (index.unique) for (const name of names) uniqueTextColumns.add(name);
    if (index.unique) {
      for (const name of names) {
        const col = columns.find(c => c.name === name);
        if (col && /TEXT|CHAR|CLOB/i.test(col.type)) {
          const length = maxTextLength(db, table, name);
          if (length > 191) throw new Error(`Nilai ${table}.${name} melebihi 191 karakter; index unik MySQL perlu ditinjau.`);
          maxLengths.set(name, length);
        }
      }
    }
    indexDefs.push({ index, names, partial });
  }
  const primary = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
  const types = new Map();
  for (const col of columns) {
    const declared = String(col.type || '').toUpperCase();
    if (/INT/.test(declared)) types.set(col.name, 'BIGINT');
    else if (/REAL|FLOA|DOUB/.test(declared)) types.set(col.name, 'DOUBLE');
    else if (/BLOB/.test(declared)) types.set(col.name, 'LONGBLOB');
    else if (/TEXT|CHAR|CLOB/.test(declared) || !declared) {
      const indexedUnique = uniqueTextColumns.has(col.name);
      const defaulted = col.dflt_value !== null && col.dflt_value !== undefined;
      if (indexedUnique) types.set(col.name, 'VARCHAR(191)');
      else if (defaulted) {
        const max = maxTextLength(db, table, col.name);
        const width = Math.max(191, max + 32);
        if (width > 4096) throw new Error(`DEFAULT teks ${table}.${col.name} terlalu panjang untuk konversi otomatis.`);
        types.set(col.name, `VARCHAR(${width})`);
      } else types.set(col.name, 'LONGTEXT');
    } else {
      throw new Error(`Tipe SQLite tidak dikenal pada ${table}.${col.name}: ${declared}`);
    }
  }
  for (const indexDef of indexDefs) {
    if (indexDef.partial && !indexDef.partial.nullableOnly) {
      const col = indexDef.partial.column;
      if (!columns.some(c => c.name === col)) throw new Error(`Kolom partial index tidak ditemukan: ${table}.${col}`);
      const generated = `__mig_${crypto.createHash('sha1').update(indexDef.index.name).digest('hex').slice(0, 12)}`;
      if (columns.some(c => c.name === generated)) throw new Error(`Nama kolom migrasi bertabrakan di ${table}.`);
      indexDef.generated = generated;
      types.set(generated, 'VARCHAR(191)');
    }
  }
  return { table, columns, indexes: indexDefs, primary, types, maxLengths };
}

function tableCreateSql(meta) {
  const singleIntegerPrimary = meta.primary.length === 1
    && meta.columns.find(c => c.name === meta.primary[0])
    && /INT/i.test(meta.columns.find(c => c.name === meta.primary[0]).type || '');
  const definitions = meta.columns.map(col => {
    let def = `${qid(col.name)} ${meta.types.get(col.name)}`;
    if ((col.notnull || col.pk) && !(singleIntegerPrimary && col.pk)) def += ' NOT NULL';
    if (singleIntegerPrimary && col.pk) def += ' NOT NULL AUTO_INCREMENT';
    if (col.dflt_value !== null && col.dflt_value !== undefined) def += mysqlDefault(col.dflt_value);
    return def;
  });
  if (meta.primary.length) definitions.push(`PRIMARY KEY (${meta.primary.map(qid).join(',')})`);
  return `CREATE TABLE ${qid(meta.table)} (${definitions.join(',')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
}

function indexSql(meta, definition) {
  const { index, names, partial, generated } = definition;
  let keyParts = names;
  if (generated) keyParts = names.map(name => name === partial.column ? generated : name);
  const indexType = index.unique ? 'UNIQUE KEY' : 'KEY';
  const name = index.name.startsWith('sqlite_autoindex_')
    ? `${index.unique ? 'uq' : 'ix'}_${meta.table}_${index.seq}`
    : index.name;
  const safeName = name.slice(0, 64);
  const columns = keyParts.map(name => {
    const type = meta.types.get(name);
    return `${qid(name)}${type === 'LONGTEXT' ? '(191)' : ''}`;
  });
  const textBytes = keyParts.reduce((sum, name) => {
    const type = meta.types.get(name);
    return sum + (type && type.startsWith('VARCHAR(') ? Number(/\((\d+)\)/.exec(type)[1]) * 4 : type === 'LONGTEXT' ? 764 : 8);
  }, 0);
  if (textBytes > 3000) throw new Error(`Index ${safeName} melebihi batas ukuran MySQL.`);
  return `ALTER TABLE ${qid(meta.table)} ADD ${indexType} ${qid(safeName)} (${columns.join(',')})`;
}

function migrationPlan(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const meta = tables.map(table => inspectTable(db, table));
  const rowCounts = {};
  for (const table of tables) rowCounts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${qid(table)}`).get().n);
  const createStatements = meta.map(tableCreateSql);
  const indexStatements = meta.flatMap(table => table.indexes.map(index => indexSql(table, index)));
  return { tables: meta, rowCounts, createStatements, indexStatements };
}

function summarize(databases) {
  const summary = {};
  for (const [key, db] of Object.entries(databases)) {
    const plan = migrationPlan(db);
    const skipped = Object.fromEntries(Object.entries(plan.rowCounts)
      .filter(([table]) => EPHEMERAL_AUTH_TABLES.has(table) && plan.rowCounts[table] > 0));
    summary[key] = {
      tables: plan.tables.length,
      indexes: plan.indexStatements.length,
      rows: Object.entries(plan.rowCounts).reduce((sum, [table, count]) => sum + (EPHEMERAL_AUTH_TABLES.has(table) ? 0 : count), 0),
      omittedEphemeralAuthRows: skipped,
      sourceRowsByTable: plan.rowCounts
    };
  }
  return summary;
}

async function assertEmpty(connection, database) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=?',
    [database]
  );
  if (Number(rows[0].n) !== 0) throw new Error(`Database ${database} tidak kosong; migrasi dihentikan tanpa menghapus tabel.`);
}

async function importDatabase(db, connection, database, label) {
  await assertEmpty(connection, database);
  await connection.query('SET FOREIGN_KEY_CHECKS=0');
  const plan = migrationPlan(db);
  for (const statement of plan.createStatements) await connection.query(statement);
  let imported = 0;
  for (const meta of plan.tables) {
    if (EPHEMERAL_AUTH_TABLES.has(meta.table)) continue;
    const names = meta.columns.map(col => col.name);
    const columns = names.map(qid).join(',');
    const placeholders = '(' + names.map(() => '?').join(',') + ')';
    const rows = db.prepare(`SELECT * FROM ${qid(meta.table)}`).all();
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const sql = `INSERT INTO ${qid(meta.table)} (${columns}) VALUES ${batch.map(() => placeholders).join(',')}`;
      const values = [];
      for (const row of batch) {
        for (const name of names) {
          const value = row[name];
          values.push(value instanceof Uint8Array ? Buffer.from(value) : value);
        }
      }
      await connection.query(sql, values);
    }
    imported += rows.length;
    const [countRows] = await connection.query(`SELECT COUNT(*) AS n FROM ${qid(meta.table)}`);
    const actual = Number(countRows[0].n);
    if (actual !== rows.length) {
      throw new Error(`Verifikasi gagal pada ${label}.${meta.table}: sumber ${rows.length}, tujuan ${actual}.`);
    }
  }
  for (const meta of plan.tables) {
    for (const definition of meta.indexes) {
      if (definition.generated) {
        const col = qid(definition.partial.column);
        const generated = qid(definition.generated);
        const expr = `CASE WHEN COALESCE(${col},'')<>'' THEN ${col} ELSE NULL END`;
        await connection.query(`ALTER TABLE ${qid(meta.table)} ADD COLUMN ${generated} VARCHAR(191) GENERATED ALWAYS AS (${expr}) STORED`);
      }
      const statement = indexSql(meta, definition);
      await connection.query(statement);
    }
  }
  await connection.query('SET FOREIGN_KEY_CHECKS=1');
  const omitted = Object.entries(plan.rowCounts)
    .filter(([table]) => EPHEMERAL_AUTH_TABLES.has(table))
    .reduce((sum, [, count]) => sum + count, 0);
  console.log(`[migrasi] ${label}: ${plan.tables.length} tabel, ${imported} baris; ${omitted} baris sesi/OTP tidak dipindahkan`);
  return { tables: plan.tables.length, rows: imported, omittedEphemeralAuthRows: omitted };
}

async function apply(databases) {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_TENANT_DB', 'MYSQL_CONTROL_DB'];
  const missing = required.filter(key => process.env[key] === undefined || process.env[key] === '');
  if (missing.length) throw new Error(`Variabel koneksi belum lengkap: ${missing.join(', ')}`);
  const targets = {
    school: process.env.MYSQL_TENANT_DB,
    control: process.env.MYSQL_CONTROL_DB
  };
  for (const [label, database] of Object.entries(targets)) {
    if (!IDENT.test(database)) throw new Error(`Nama database ${label} tidak valid.`);
  }
  if (targets.school === targets.control) throw new Error('Database sekolah dan control plane harus berbeda.');
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: targets.school,
    charset: 'utf8mb4'
  });
  try {
    await assertEmpty(connection, targets.school);
    await connection.changeUser({ database: targets.control });
    await assertEmpty(connection, targets.control);
    await connection.changeUser({ database: targets.school });
    const school = await importDatabase(databases.school, connection, targets.school, 'sekolah');
    await connection.changeUser({ database: targets.control });
    const control = await importDatabase(databases.control, connection, targets.control, 'control plane');
    return { school, control };
  } finally {
    await connection.end();
  }
}

async function main() {
  const file = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  if (!file) throw new Error('Pemakaian: node migrate-sqlite-mysql.js <backup.sql> [--apply]');
  const applyNow = process.argv.includes('--apply');
  const sql = fs.readFileSync(file, 'utf8');
  const databases = parseDumpSections(sql);
  try {
    const summary = summarize(databases);
    if (applyNow) {
      const migrated = await apply(databases);
      console.log(JSON.stringify({ mode: 'applied', migrated }));
    } else {
      console.log(JSON.stringify({ mode: 'dry-run', summary }));
    }
  } finally {
    for (const db of Object.values(databases)) db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[migrasi] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertSafeDumpStatement, migrationPlan, parseDumpSections, splitStatements, summarize };
