'use strict';
const assert = require('assert');
const X = require('../xlsx-read');

const [{ rows }] = X.readCsv('NISN,NAMA,WHATSAPP,JUMLAH\r\n0012345678,"Siswa, Contoh",081234567890,1.250');
assert.strictEqual(X.cellText(rows[1][0]), '0012345678');
assert.strictEqual(X.cellText(rows[1][2]), '081234567890');
assert.strictEqual(X.cellText(rows[1][1]), 'Siswa, Contoh');
assert.strictEqual(X.parseMoneyCell(rows[1][3]), 1250);
console.log('PASS: CSV mempertahankan nol awal pada identifier/nomor kontak dan tetap membaca nominal.');
