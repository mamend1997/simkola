'use strict';
/* ============ Analisa tabel BKU dari sheet Excel/CSV ============ */
const { parseDateCell, parseMoneyCell, cellText } = require('./xlsx-read');

const HEAD = {
  tanggal: /^(tgl|tanggal|date|waktu)\b/i,
  keterangan: /(keterangan|uraian|deskripsi|kegiatan|nama\s*transaksi|keperluan|nota)/i,
  masuk: /(masuk|pemasukan|penerimaan|debet|debit|kredit\s*masuk)/i,
  keluar: /(keluar|pengeluaran|belanja|kredit|debet\s*keluar)/i,
  saldo: /(saldo|balance|sisa)/i,
  bukti: /(no\.?\s*bukti|nomor\s*bukti|no\.?\s*nota|no\.?\s*kwitansi|bukti)/i,
  no: /^(no|no\.|nomor|#)$/i
};

const SKIP_KET = /^(jumlah|total|sub\s*total|saldo\s*(awal|akhir|bulan|periode)|tanda\s*tangan|mengetahui|bendahara|kepala\s*sekolah|nip\b|catatan|rekap)/i;

function isHeaderRow(row) {
  if (!row) return 0;
  let hit = 0;
  const map = {};
  for (let i = 0; i < row.length; i++) {
    const t = cellText(row[i]);
    if (!t || t.length > 40) continue;
    for (const [k, re] of Object.entries(HEAD)) {
      if (map[k] !== undefined) continue;
      if (re.test(t)) { map[k] = i; hit++; break; }
    }
  }
  const need = (map.tanggal !== undefined) + (map.keterangan !== undefined) + (map.masuk !== undefined || map.keluar !== undefined);
  return (need >= 2 && map.tanggal !== undefined && hit >= 3) ? hit : 0;
}

function detectTitle(rows, headerRow) {
  let best = '';
  let bestScore = 0;
  const area = rows.slice(0, Math.max(0, headerRow));
  for (const row of area) {
    for (const cell of row || []) {
      const t = cellText(cell);
      if (!t || t.length < 3 || t.length > 70) continue;
      if (/^[\d.,\/\-\s]+$/.test(t)) continue;
      if (HEAD.tanggal.test(t) || HEAD.keterangan.test(t)) continue;
      let score = 0;
      if (/bku|infak|jumat|ukk|pkl|spp|dana|kas|buku|pembantu|kegiatan|bantuan|asas|asat|psaj|spmb|ptsts|sosial|umum/i.test(t)) score += 3;
      if (t === t.toUpperCase()) score += 2;
      if (t.length > 8) score += 1;
      if (/tahun\s*ajaran|periode/i.test(t)) score -= 2;
      if (score > bestScore || (score === bestScore && t.length > best.length && score > 0)) {
        best = t; bestScore = score;
      }
    }
  }
  return best.replace(/\s+/g, ' ').trim();
}

function detectTahun(rows, headerRow) {
  for (const row of rows.slice(0, Math.max(0, headerRow))) {
    for (const cell of row || []) {
      const t = cellText(cell);
      const m = t.match(/(20\d{2})\s*[\/\-]\s*(20\d{2})/);
      if (m) return `${m[1]}/${m[2]}`;
    }
  }
  return '';
}

/**
 * Analisa satu sheet → struktur BKU siap impor.
 * hasil: { title, tahun, headerRow, map, opening, rows[], totals, saldoFileAkhir, computedAkhir, reconciled, issues[] }
 */
function analyzeSheet(sheet) {
  const rows = (sheet && sheet.rows) || [];
  let headerRow = -1, map = {}, headerScore = 0;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const sc = isHeaderRow(rows[i]);
    if (sc > headerScore) { headerScore = sc; headerRow = i; map = buildMap(rows[i]); }
  }
  if (headerRow < 0) {
    // fallback: tebak kolom 0..4 (TANGGAL, KETERANGAN, MASUK, KELUAR, SALDO)
    headerRow = 0;
    map = { tanggal: 0, keterangan: 1, masuk: 2, keluar: 3, saldo: 4 };
  }

  const title = detectTitle(rows, headerRow);
  const tahun = detectTahun(rows, headerRow);

  const issues = [];
  const parsed = [];
  let opening = null;
  let openingRowIdx = -1;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const ket = cellText(row[map.keterangan]);
    const masukCell = map.masuk !== undefined ? row[map.masuk] : null;
    const keluarCell = map.keluar !== undefined ? row[map.keluar] : null;
    const saldoCell = map.saldo !== undefined ? row[map.saldo] : null;
    const tglCell = map.tanggal !== undefined ? row[map.tanggal] : null;
    const masuk = parseMoneyCell(masukCell);
    const keluar = parseMoneyCell(keluarCell);
    const saldoFile = saldoCell && cellText(saldoCell) !== '' ? parseMoneyCell(saldoCell) : null;
    const tanggal = parseDateCell(tglCell);
    const allEmpty = !ket && !masuk && !keluar && saldoFile === null && !cellText(tglCell);
    if (allEmpty) continue;

    const isOpening = /saldo\s*awal/i.test(ket) && !/akhir/i.test(ket);
    if (isOpening && opening === null) {
      opening = Math.abs(masuk || saldoFile || 0);
      openingRowIdx = i;
      continue;
    }
    // baris footer / rekap (JUMLAH, TOTAL, SALDO AKHIR, tanda tangan) → lewati
    if (SKIP_KET.test(ket) && (!tanggal || !masuk && !keluar || /jumlah|total|saldo\s*akhir/i.test(ket))) continue;

    if (!masuk && !keluar) {
      issues.push({ row: i + 1, level: 'warn', msg: `Baris ${i + 1} dilewati: kolom MASUK & KELUAR kosong.` });
      continue;
    }
    if (masuk && keluar) {
      issues.push({ row: i + 1, level: 'warn', msg: `Baris ${i + 1} punya nilai MASUK dan KELUAR sekaligus — dihitung sebagai selisih bersih (${masuk} − ${keluar}).` });
    }
    if (!tanggal) {
      issues.push({ row: i + 1, level: 'err', msg: `Baris ${i + 1} tanggal tidak dikenali ("${cellText(tglCell)}") — isi manual setelah impor.` });
    }
    const jenis = (masuk - keluar) >= 0 && masuk ? 'pemasukan' : (keluar ? 'pengeluaran' : (masuk ? 'pemasukan' : 'pengeluaran'));
    const nominal = Math.abs(masuk && keluar ? (masuk - keluar) : (masuk || keluar));
    const noBukti = map.bukti !== undefined ? cellText(row[map.bukti]) : '';
    const noUrut = map.no !== undefined ? cellText(row[map.no]) : '';
    parsed.push({ row: i + 1, tanggal, tanggalRaw: cellText(tglCell), keterangan: ket || '(tanpa keterangan)', jenis, nominal, saldoFile, noBukti, noUrut });
  }

  // saldo awal: dari baris "SALDO AWAL" atau turunkan dari baris pertama
  if (opening === null) {
    const first = parsed[0];
    if (first && first.saldoFile !== null) {
      opening = first.saldoFile - (first.jenis === 'pemasukan' ? first.nominal : -first.nominal);
    } else opening = 0;
  }

  // hitung ulang running balance & bandingkan dengan kolom SALDO
  let run = opening;
  let mismatch = 0;
  for (const r of parsed) {
    run += r.jenis === 'pemasukan' ? r.nominal : -r.nominal;
    r.saldoHitung = run;
    if (r.saldoFile === null) r.selisih = null;
    else {
      r.selisih = r.saldoFile - run;
      if (Math.abs(r.selisih) >= 1) {
        mismatch++;
        issues.push({ row: r.row, level: 'warn', msg: `Baris ${r.row} selisih saldo ${Math.abs(r.selisih).toLocaleString('id-ID')} (file ${r.saldoFile.toLocaleString('id-ID')} vs hitung ${run.toLocaleString('id-ID')}).` });
      }
    }
  }

  const totals = {
    masuk: parsed.filter(r => r.jenis === 'pemasukan').reduce((s, r) => s + r.nominal, 0),
    keluar: parsed.filter(r => r.jenis === 'pengeluaran').reduce((s, r) => s + r.nominal, 0),
    jumlah: parsed.length
  };
  const saldoFileAkhir = parsed.length && parsed[parsed.length - 1].saldoFile !== null
    ? parsed[parsed.length - 1].saldoFile : null;

  return {
    sheet: sheet.name, title, tahun, headerRow: headerRow + 1, map: { ...map }, opening, openingRowIdx: openingRowIdx + 1,
    rows: parsed, totals, saldoFileAkhir, computedAkhir: run,
    reconciled: saldoFileAkhir !== null && Math.abs(saldoFileAkhir - run) < 1 && mismatch === 0,
    mismatch, issues
  };
}

function buildMap(row) {
  const map = {};
  for (let i = 0; i < (row || []).length; i++) {
    const t = cellText(row[i]);
    if (!t) continue;
    for (const [k, re] of Object.entries(HEAD)) {
      if (map[k] !== undefined) continue;
      if (re.test(t)) { map[k] = i; break; }
    }
  }
  // jangan biarkan 'no' menabrak kolom lain
  if (map.no !== undefined && map.no !== 0 && (map.tanggal === 0)) delete map.no;
  return map;
}

/** cari sheet dengan tabel BKU paling meyakinkan */
function bestSheet(sheets) {
  let best = null;
  for (const s of sheets) {
    const a = analyzeSheet(s);
    const score = a.rows.length * 10 + (a.reconciled ? 25 : 0) + (a.title ? 5 : 0);
    if (!best || score > best.score) best = { sheet: s, analysis: a, score };
  }
  return best;
}

/** tebak BKU tujuan dari judul excel */
function guessBku(title, bkuss) {
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  let best = null, bestScore = 0;
  for (const b of bkuss) {
    const n = String(b.nama).toLowerCase().replace(/^bku\s*/, '');
    let score = 0;
    if (t.includes(n)) score += 10;
    const words = n.split(/\s+/).filter(w => w.length > 2);
    for (const w of words) if (t.includes(w)) score += 3;
    if (t.includes('umum') && /umum/i.test(b.nama)) score += 6;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return bestScore >= 3 ? best : null;
}

module.exports = { analyzeSheet, bestSheet, guessBku, isHeaderRow, HEAD };
