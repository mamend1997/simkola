'use strict';
/**
 * Pusat Pengaturan Desain & Orientasi Cetak (Design Center).
 *
 * Semua dokumen cetak memakai katalog di bawah ini agar:
 *  - orientasi default bisa diubah pengguna (Portrait / Landscape / kertas kecil),
 *  - teks/redaksional label pada dokumen bisa disesuaikan sekolah,
 *  - halaman cetak menyediakan tombol toggle orientasi tanpa memaksa
 *    orientasi bawaan browser (tidak ada lagi `@page{size:landscape}` hard-coded).
 *
 * Nilai disimpan pada settings `print_design` (JSON):
 * { docs: { <key>: { orient:'portrait', labels:{ <field>: '<teks>' } } } }
 */
const ORIENT = ['portrait', 'landscape', 'small'];
const ORIENT_LABEL = { portrait: 'Portrait (Vertikal)', landscape: 'Landscape (Horizontal)', small: 'Kertas Kecil 1/3 F4' };

const DOCS = [
  {
    key: 'kwitansi_trx', label: 'Kwitansi Transaksi (Pemasukan & Pengeluaran)',
    orient: 'portrait', note: 'Default PORTRAIT. Opsi kertas kecil = 1/3 F4 (210 × 99 mm) sesuai Pengaturan Ukuran Kertas.',
    fields: [
      ['judul_masuk', 'Judul kwitansi pemasukan', 'KWITANSI PENERIMAAN'],
      ['judul_keluar', 'Judul kwitansi pengeluaran', 'KWITANSI PENGELUARAN'],
      ['dari_masuk', 'Label "diterima dari" (pemasukan)', 'Telah diterima dari'],
      ['dari_keluar', 'Label "diterima dari" (pengeluaran)', 'Telah diterima dari'],
      ['nilai_dari_keluar', 'Isi baris "diterima dari" (pengeluaran) — {sekolah} = nama sekolah', 'Bendahara {sekolah}'],
      ['sejumlah', 'Label "uang sejumlah"', 'Uang sejumlah'],
      ['untuk', 'Label "untuk pembayaran"', 'Untuk pembayaran'],
      ['rekening', 'Label kode rekening', 'Kode Rekening'],
      ['buku', 'Label buku kas', 'Buku Kas'],
      ['metode', 'Label metode', 'Metode'],
      ['tanggal', 'Label tanggal', 'Tanggal'],
      ['jumlah', 'Label jumlah', 'Jumlah'],
      ['ttd_kepala', 'Kolom 1 tanda tangan', 'Mengetahui'],
      ['ttd_bendahara', 'Kolom 2 tanda tangan', 'Bendahara'],
      ['ttd_penerima', 'Kolom 3 tanda tangan (pengeluaran)', 'Penerima'],
      ['ttd_penyetor', 'Kolom 3 tanda tangan (pemasukan)', 'Penyetor'],
      ['footer', 'Catatan kaki kwitansi (boleh kosong)', 'Kwitansi ini sah sebagai bukti {jenis} kas sekolah.']
    ]
  },
  {
    key: 'kwitansi_iuran', label: 'Bukti Pembayaran / Kwitansi Iuran Siswa',
    orient: 'portrait', note: 'Default PORTRAIT. Opsi kertas kecil memakai ukuran dari Identitas Sekolah.',
    fields: [
      ['judul', 'Judul kwitansi', 'BUKTI PEMBAYARAN SISWA'],
      ['kolom_nama', 'Label kolom nama', 'Nama'],
      ['kolom_kelas', 'Label kolom kelas', 'Kelas'],
      ['kolom_metode', 'Label kolom metode', 'Metode'],
      ['kolom_tanggal', 'Label kolom tanggal', 'Tanggal'],
      ['pencatat', 'Jabatan penanda tangan', 'Pencatat']
    ]
  },
  {
    key: 'slip_honor', label: 'Slip Gaji / Honor Pegawai',
    orient: 'portrait', note: 'Default PORTRAIT. Kertas A4, 9 slip per halaman.',
    fields: [
      ['judul', 'Judul slip', 'Slip Gaji / Honor'],
      ['periode', 'Label periode', 'Periode']
    ]
  },
  {
    key: 'leger_honor', label: 'Leger Honor (cetak)',
    orient: 'landscape', note: 'Default LANDSCAPE karena memuat banyak kolom.',
    fields: [
      ['judul', 'Judul leger', 'LEGER HONOR PEGAWAI'],
      ['ttd_terima', 'Judul kolom tanda terima', 'Tanda Tangan / Terima']
    ]
  },
  {
    key: 'honor_ekskul', label: 'Daftar Honor Pembina Ekstrakurikuler',
    orient: 'landscape', note: 'Default LANDSCAPE.',
    fields: [
      ['judul', 'Judul dokumen', 'DAFTAR HONOR PEMBINA EKSTRAKURIKULER'],
      ['ttd_bendahara', 'Teks tanda tangan bendahara', 'Bendahara'],
      ['ttd_kepala', 'Teks tanda tangan kepala sekolah', 'Mengetahui:']
    ]
  },
  {
    key: 'laporan_bku', label: 'Laporan Buku Kas Umum (BKU)',
    orient: 'landscape', note: 'Default LANDSCAPE.',
    fields: [['judul', 'Judul laporan', 'Laporan Buku Kas Umum']]
  },
  {
    key: 'laporan_rekon', label: 'Rekonsiliasi Kas',
    orient: 'portrait', note: 'Default PORTRAIT.',
    fields: [['judul', 'Judul laporan', 'Rekonsiliasi Kas']]
  },
  {
    key: 'laporan_lra', label: 'Laporan Realisasi Anggaran (LRA)',
    orient: 'landscape', note: 'Default LANDSCAPE.',
    fields: [['judul', 'Judul laporan', 'Laporan Realisasi Anggaran']]
  },
  {
    key: 'laporan_aruskas', label: 'Laporan Arus Kas',
    orient: 'portrait', note: 'Default PORTRAIT.',
    fields: [['judul', 'Judul laporan', 'Laporan Arus Kas']]
  },
  {
    key: 'laporan_pembantu', label: 'Buku Pembantu & Rekapitulasi',
    orient: 'landscape', note: 'Default LANDSCAPE.',
    fields: [['judul', 'Judul laporan', 'Buku Pembantu & Rekapitulasi']]
  },
  {
    key: 'laporan_piutang', label: 'Laporan Piutang & SPP',
    orient: 'landscape', note: 'Default LANDSCAPE.',
    fields: [['judul', 'Judul laporan', 'Laporan Piutang']]
  }
];

const DOC_MAP = new Map(DOCS.map(d => [d.key, d]));

/**
 * Nilai label BAWAAN LAMA yang sudah terlanjur tersimpan di setting `print_design`.
 * Dibandingkan tanpa memandang huruf besar/kecil; bila cocok, dipakai nilai default
 * baru supaya perubahan redaksional bawaan ikut terpakai pada instalasi lama.
 */
const LEGACY_LABELS = {
  kwitansi_trx: {
    // dulu label & isi baris "diterima dari" pengeluaran = "Bendahara Sekolah"
    dari_keluar: { 'bendahara sekolah': 'Telah diterima dari' }
  }
};
/** teks tempat default pada baris "Cikoneng, 2 November 2026" */
const TEMPAT_DEFAULT = 'Cikoneng';

function normOrient(v) {
  const s = String(v || '').toLowerCase();
  return ORIENT.includes(s) ? s : '';
}
function docOf(key) { return DOC_MAP.get(key) || DOCS[0]; }

/** baca konfigurasi tersimpan (sudah di-merge dengan nilai default) */
function readAll(dbm) {
  let raw = {};
  try { raw = JSON.parse(dbm.getSetting('print_design', '{}') || '{}') || {}; } catch (e) { raw = {}; }
  const docs = raw.docs && typeof raw.docs === 'object' ? raw.docs : {};
  const out = {};
  for (const d of DOCS) {
    const cur = docs[d.key] && typeof docs[d.key] === 'object' ? docs[d.key] : {};
    const labels = {};
    const hasBaru = !!(cur.labels && Object.prototype.hasOwnProperty.call(cur.labels, 'nilai_dari_keluar'));
    for (const [k, , def] of d.fields) {
      const v = cur.labels && cur.labels[k];
      let val = (v === undefined || v === null || String(v).trim() === '') ? def : String(v);
      const legacy = (LEGACY_LABELS[d.key] || {})[k];
      // konfigurasi LAMA (belum punya kolom baru) memakai nilai bawaan lama → ikut default baru
      if (!hasBaru && legacy && legacy[String(val).trim().toLowerCase()]) val = legacy[String(val).trim().toLowerCase()];
      labels[k] = val;
    }
    out[d.key] = { orient: normOrient(cur.orient) || d.orient, labels };
  }
  return out;
}
/** simpan dari body form Design Center */
function saveFromBody(dbm, body) {
  const cur = readAll(dbm);
  const docs = {};
  for (const d of DOCS) {
    const o = normOrient(body['orient_' + d.key]);
    const labels = {};
    for (const [k, , def] of d.fields) {
      const v = body[`lbl_${d.key}_${k}`];
      labels[k] = v === undefined ? cur[d.key].labels[k] : (String(v).trim() === '' ? def : String(v).trim());
    }
    docs[d.key] = { orient: o || cur[d.key].orient, labels };
  }
  dbm.setSetting('print_design', JSON.stringify({ docs }));
  // tempat pada baris tanggal semua dokumen ("Cikoneng, 2 November 2026")
  if (body.print_tempat !== undefined) dbm.setSetting('print_tempat', String(body.print_tempat).trim() || TEMPAT_DEFAULT);
  return docs;
}
/** isi placeholder {nama} pada sebuah teks (mis. "Bendahara {sekolah}") */
function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}
/** teks tempat cetak (default "Cikoneng"), dipakai sebelum tanggal di semua dokumen */
function tempat(dbm) {
  if (!dbm || !dbm.getSetting) return TEMPAT_DEFAULT;
  return String(dbm.getSetting('print_tempat', TEMPAT_DEFAULT) || '').trim() || TEMPAT_DEFAULT;
}
/** baris "Tempat, tanggal" yang seragam untuk semua cetakan */
function tempatTanggal(dbm, tanggal) {
  return [tempat(dbm), tanggal].filter(Boolean).join(', ');
}
/** label dokumen (fallback ke default bila pengguna mengosongkan) */
function labels(dbm, key) {
  const all = readAll(dbm);
  return (all[key] || {}).labels || {};
}
/** orientasi efektif: ?orient= pada URL → default tersimpan dokumen */
function orient(req, dbm, key) {
  const q = normOrient(req && req.query && (req.query.get ? req.query.get('orient') : ''));
  if (q) return q;
  const all = readAll(dbm);
  return (all[key] || {}).orient || docOf(key).orient;
}
/** halaman css @page sesuai orientasi (paper default A4) */
function pageRule(o, opts = {}) {
  const paper = opts.paper || 'A4';
  const margin = opts.margin || '10mm';
  const oo = o === 'landscape' ? 'landscape' : 'portrait';
  return `@page{size:${paper} ${oo};margin:${margin}}`;
}

module.exports = {
  ORIENT, ORIENT_LABEL, DOCS, docOf, readAll, saveFromBody, labels, orient, pageRule, normOrient,
  fill, tempat, tempatTanggal, TEMPAT_DEFAULT
};
