'use strict';
/**
 * Helper dev-test: verifikasi nomor WhatsApp pada form Pendaftaran Sekolah Baru.
 * Alur nyata:  POST /register/otp/kirim  → kode 4 digit via WA Gateway
 *              POST /register/otp/verifikasi → token terverifikasi
 * Di lingkungan uji gateway belum aktif sehingga server mengembalikan `demo_kode`
 * (mode uji) — kode itulah yang dipakai untuk verifikasi.
 */
async function otpDaftar(base, telp) {
  const r = await fetch(base + '/register/otp/kirim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telp })
  });
  const j = await r.json();
  if (!j.ok) throw new Error('OTP kirim gagal: ' + (j.err || ('HTTP ' + r.status)));
  const kode = j.demo_kode || '';
  if (!kode) throw new Error('Gateway WA aktif tetapi kode uji tidak tersedia — test tidak dapat melanjutkan.');
  const v = await fetch(base + '/register/otp/verifikasi', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: j.token, kode })
  });
  const jv = await v.json();
  if (!jv.ok) throw new Error('OTP verifikasi gagal: ' + (jv.err || ('HTTP ' + v.status)));
  return j.token;
}
module.exports = { otpDaftar };
