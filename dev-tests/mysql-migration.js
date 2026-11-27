'use strict';
const assert = require('node:assert/strict');
const { assertSafeDumpStatement, migrationPlan, parseDumpSections, splitStatements, summarize } = require('../migrate-sqlite-mysql');

const fixture = `-- BACKUP
PRAGMA foreign_keys=OFF;
-- CONTROL PLANE (saas.db)
CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_slug TEXT, label TEXT DEFAULT '');
CREATE UNIQUE INDEX uq_tenant_slug ON tenants(portal_slug) WHERE portal_slug IS NOT NULL AND portal_slug<>'';
CREATE TABLE sessions (token TEXT PRIMARY KEY, welcome TEXT);
INSERT INTO tenants (id,portal_slug,label) VALUES (1,'sekolah-demo','label; aman');
INSERT INTO sessions (token,welcome) VALUES ('session-token','secret');
-- SEKOLAH Sekolah Contoh (tenant_id 1)
CREATE TABLE siswa (id INTEGER PRIMARY KEY AUTOINCREMENT, nisn TEXT, nama TEXT NOT NULL);
CREATE UNIQUE INDEX uq_siswa_nisn ON siswa(nisn) WHERE COALESCE(nisn,'')<>'';
INSERT INTO siswa (id,nisn,nama) VALUES (1,'123','Siswa Demo');
CREATE TABLE otp_code (id INTEGER PRIMARY KEY AUTOINCREMENT, kode TEXT);
INSERT INTO otp_code (id,kode) VALUES (1,'123456');
`;

const statements = splitStatements("INSERT INTO sample(value) VALUES ('semi;colon'); SELECT 1;");
assert.equal(statements.length, 2);
assert.throws(() => assertSafeDumpStatement('ATTACH DATABASE \'/tmp/other.db\' AS other;'), /tidak diizinkan/);
const dbs = parseDumpSections(fixture);
try {
  const control = migrationPlan(dbs.control);
  const tenants = control.tables.find(table => table.table === 'tenants');
  assert.match(control.createStatements[control.tables.indexOf(tenants)], /AUTO_INCREMENT/);
  assert.equal(tenants.indexes.length, 1);
  assert.equal(tenants.indexes[0].partial.nullableOnly, false);
  assert.match(control.indexStatements[0], /UNIQUE KEY/);
  assert.equal(dbs.control.prepare('SELECT label FROM tenants').get().label, 'label; aman');

  const school = migrationPlan(dbs.school);
  assert.equal(school.rowCounts.siswa, 1);
  assert.equal(summarize(dbs).control.omittedEphemeralAuthRows.sessions, 1);
  assert.equal(summarize(dbs).school.omittedEphemeralAuthRows.otp_code, 1);
  assert.equal(summarize(dbs).control.rows, 1);
  assert.equal(summarize(dbs).school.rows, 1);
} finally {
  for (const db of Object.values(dbs)) db.close();
}

console.log('MySQL migration source checks passed');
