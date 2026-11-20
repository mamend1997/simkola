'use strict';
/**
 * ==================================================================
 * KIRIM SLIP HONOR VIA WHATSAPP (TAUTAN LANGSUNG — TANPA OTP)
 * ------------------------------------------------------------------
 * Slip honor dapat dikirim massal dari menu Leger Honor / Slip Gaji
 * maupun Data Pegawai. Tautan yang dikirim memakai token HMAC
 * (dbm.slipToken) sehingga pegawai langsung melihat slipnya tanpa
 * menunggu / memasukkan kode OTP.
 *
 * Pengiriman TIDAK dilakukan di dalam request: pesan dimasukkan ke
 * antrean `wa_reminder_log` lalu diproses worker latar (jeda 2–5 detik
 * per pesan) agar halaman tidak menggantung saat mengirim banyak nomor.
 * ================================================================== */
const reminder = require('./reminder');
const lib = require('./lib');
const publicUrl = require('./publicurl');

/** alamat publik aktif untuk tautan slip, tanpa memakai URL pengingat yang bisa kedaluwarsa */
function baseUrl(dbm, req) {
  return publicUrl.baseUrl(dbm, req);
}
/** tautan langsung slip honor satu pegawai */
function slipLinkFor(dbm, req, pegawai, periode) {
  const base = baseUrl(dbm, req);
  const slug = (() => { try { return dbm.portalSlugs().slip; } catch (e) { return 'portal-slip'; } })();
  const tok = dbm.slipToken(pegawai.id, 'slip');
  const path = `/${slug}/hasil?t=${encodeURIComponent(tok)}${periode ? '&periode=' + encodeURIComponent(periode) : ''}`;
  return base ? base + path : path;
}
/** pesan WhatsApp slip honor */
function slipMessage(dbm, { pegawai, periode, diterima, link }) {
  const namaSekolah = String(dbm.getSetting('sekolah_nama', 'Sekolah') || 'Sekolah').trim();
  const label = (() => { try { return dbm.periodeLabel(periode); } catch (e) { return periode; } })();
  return [
    `Yth. ${pegawai.nama},`,
    '',
    `Slip gaji/honor periode ${label} sudah tersedia.`,
    `Total diterima: ${lib.rupiah(diterima)}`,
    '',
    'Buka slip Anda melalui tautan berikut (langsung terbuka, tanpa kode OTP):',
    link,
    '',
    `Terima kasih.`,
    namaSekolah
  ].join('\n');
}
/**
 * Susun & antrekan slip honor untuk sekumpulan baris leger payroll.
 * rows: baris payroll (hasil dbm.payrollRows) — memakai `pegawai_id` atau nama.
 */
function sendSlipWA({ dbm, req, periode, rows, user, pemicu }) {
  const { db } = dbm;
  const items = [];
  const tanpaNomor = [];
  const tanpaPegawai = [];
  for (const r of [].concat(rows || [])) {
    const pg = (r.pegawai_id ? db.prepare('SELECT * FROM pegawai WHERE id=?').get(r.pegawai_id) : null)
      || db.prepare('SELECT * FROM pegawai WHERE lower(TRIM(nama))=lower(TRIM(?)) LIMIT 1').get(String(r.nama || ''));
    if (!pg) { tanpaPegawai.push(r.nama); continue; }
    if (!lib.normPhone(pg.whatsapp)) { tanpaNomor.push(pg.nama); continue; }
    const link = slipLinkFor(dbm, req, pg, periode);
    items.push({
      siswa_id: null, nama: pg.nama, phone: pg.whatsapp,
      kelas: pg.jabatan || '', nominal: Number(r.diterima) || 0,
      pesan: slipMessage(dbm, { pegawai: pg, periode, diterima: Number(r.diterima) || 0, link })
    });
  }
  const q = items.length
    ? reminder.enqueue(dbm, items, { mode: 'slip', pemicu: pemicu || ('Slip honor ' + (periode || '')) })
    : { queued: 0, batch: '' };
  try {
    dbm.logAudit(user, 'KIRIM SLIP WA', 'payroll',
      `${q.queued} slip honor periode ${periode || '-'} dikirim via WhatsApp (tautan langsung tanpa OTP)` +
      (tanpaNomor.length ? ` · tanpa nomor WA: ${tanpaNomor.join(', ')}` : '') +
      (tanpaPegawai.length ? ` · tidak ada di master pegawai: ${tanpaPegawai.join(', ')}` : ''));
  } catch (e) { }
  return { queued: q.queued, batch: q.batch, tanpaNomor, tanpaPegawai };
}

module.exports = { sendSlipWA, slipLinkFor, slipMessage, baseUrl };
