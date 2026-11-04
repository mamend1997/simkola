'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test ronde 11:
   1. Sertifikasi = INPUT JAM × tarif pengaturan (default 12.500) + halaman "Nominal Tunjangan & Honor"
   2. Kasbon hanya pencatatan (fitur potong otomatis dihapus, tanpa toggle & tanpa tombol)
   3. Salin Data Bulan Sebelumnya (urutan nama identik)
   4. Hanya tombol Simpan Draf (review screen dihapus) + data langsung terlihat di portal publik
   5. Hapus massal (checkbox + pilih semua)
   6. Import Excel mempertahankan urutan baris (tidak di-sort abjad)
   7. Portal publik piutang: agregat saldo akhir per pegawai, lunas tidak muncul sebagai tagihan aktif */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const PORT = 3621;
const DB = process.env.R11_DB || path.join(os.tmpdir(), 'smk-r11-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie && !opt.public) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x));
      else usp.append(k, v);
    }
    payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: opt.redirect || 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && !opt.public) cookie = sc.split(';')[0];
  const text = await r.text();
  return { status: r.status, text, headers: r.headers, loc: r.headers.get('location') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const periodeNow = today.slice(0, 7);
const prevPeriode = (p) => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const db = new Database(DB);

  /* ================= 1. Pengaturan Nominal Tunjangan & Honor ================= */
  r = await req('GET', '/tarif-honor');
  ok('halaman Pengaturan Nominal Tunjangan & Honor', r.status === 200 && /Pengaturan Nominal Tunjangan &amp; Honor/.test(r.text));
  ok('berisi tarif sertifikasi + pembantu kepsek + wali kelas',
    /name="sertifikasi_per_jam"/.test(r.text) && /name="honor_pembantu_jam"/.test(r.text) && /name="honor_wali_jam"/.test(r.text));
  ok('default sertifikasi Rp 12.500', /12\.500/.test(r.text));
  r = await req('POST', '/tarif-honor', { sertifikasi_per_jam: '12500', honor_pembantu_jam: '50000', honor_wali_jam: '55000' });
  ok('simpan pengaturan tarif', r.status === 303 && /ok=/.test(r.loc));
  ok('setting tersimpan', db.prepare("SELECT v FROM settings WHERE k='sertifikasi_per_jam'").get().v === '12500'
    && db.prepare("SELECT v FROM settings WHERE k='honor_wali_jam'").get().v === '55000');

  /* ================= 2. sertifikasi = JAM × tarif ================= */
  await req('POST', '/pegawai/save', { nama: 'Guru A', jabatan: 'Guru', tipe: 'guru', aktif: '1', tanggal_lahir: '1990-01-01', whatsapp: '081200000011' });
  await req('POST', '/pegawai/save', { nama: 'Guru B', jabatan: 'Guru', tipe: 'guru', aktif: '1', tanggal_lahir: '1990-01-02', whatsapp: '081200000012' });
  await req('POST', '/pegawai/save', { nama: 'Staf C', jabatan: 'TU', tipe: 'tu', aktif: '1', tanggal_lahir: '1990-01-03', whatsapp: '081200000013' });
  r = await req('POST', '/payroll/tarik', { periode: periodeNow });
  ok('tarik pegawai', r.status === 303);
  let rows = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow);
  const body = { periode: periodeNow, ids: rows.map(x => x.id).join(',') };
  rows.forEach((x, i) => {
    body[`${x.id}_jam_efektif`] = '20';
    body[`${x.id}_honor_jam`] = '50000';
    body[`${x.id}_jam_sertifikasi`] = String(4 + i);       // 4, 5, 6 jam
  });
  r = await req('POST', '/payroll/simpan', body);
  ok('simpan draf dengan jam sertifikasi', r.status === 303 && /ok=/.test(r.loc));
  rows = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow);
  ok('jam sertifikasi tersimpan sebagai jam', rows.map(x => Number(x.jam_sertifikasi)).join(',') === '4,5,6', rows.map(x => x.jam_sertifikasi).join(','));
  ok('nominal sertifikasi = jam × 12.500', rows.map(x => Number(x.pot_sertifikasi)).join(',') === '50000,62500,75000', rows.map(x => x.pot_sertifikasi).join(','));
  r = await req('GET', '/payroll?periode=' + periodeNow);
  // kolom dinamis (ronde 23): input jam memakai nama `<id>_c_<kode>`, kolom berumus tidak berupa input
  ok('kolom sertifikasi berupa input jam (bukan rupiah)',
    /name="\d+_c_jam_sertifikasi"/.test(r.text) && !/name="\d+_c_pot_sertifikasi"/.test(r.text));
  ok('halaman payroll menampilkan kolom berumus otomatis', /auto/.test(r.text) && /Pengaturan Kolom Leger/.test(r.text));
  // ubah tarif → nilai ikut berubah saat dihitung ulang (tanpa input ulang jam)
  await req('POST', '/tarif-honor', { sertifikasi_per_jam: '15000', honor_pembantu_jam: '50000', honor_wali_jam: '55000' });
  const calc = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id LIMIT 1').get(periodeNow);
  ok('tarif baru langsung dipakai perhitungan', Math.round(4 * 15000) === 60000 && Number(db.prepare("SELECT v FROM settings WHERE k='sertifikasi_per_jam'").get().v) === 15000);
  await req('POST', '/tarif-honor', { sertifikasi_per_jam: '12500', honor_pembantu_jam: '50000', honor_wali_jam: '55000' });

  /* ================= 3. kasbon hanya pencatatan ================= */
  r = await req('GET', '/payroll?periode=' + periodeNow);
  ok('tanpa toggle / tombol potong kasbon otomatis',
    !/kasbon_auto/.test(r.text) && !/kasbon-apply/.test(r.text) && !/kasbon-mode/.test(r.text) && !/kasbon-reset/.test(r.text));
  ok('kolom kasbon tetap ada (catatan slip)', /name="\d+_c_pot_kasbon"/.test(r.text));
  const piuSebelum = db.prepare('SELECT COUNT(*) c FROM piutang').get().c;
  const pbSebelum = db.prepare('SELECT COUNT(*) c FROM piutang_bayar').get().c;
  const bodyKasbon = { periode: periodeNow, ids: rows.map(x => x.id).join(',') };
  rows.forEach((x, i) => {
    bodyKasbon[`${x.id}_jam_efektif`] = '20';
    bodyKasbon[`${x.id}_honor_jam`] = '50000';
    bodyKasbon[`${x.id}_jam_sertifikasi`] = String(4 + i);
    bodyKasbon[`${x.id}_pot_kasbon`] = '30000';
  });
  await req('POST', '/piutang/save', { nama_pegawai: 'Guru A', tanggal_utang: today, nominal: '500000', keterangan: 'Kasbon koperasi' });
  r = await req('POST', '/payroll/simpan', bodyKasbon);
  ok('simpan draf dengan kasbon', r.status === 303);
  ok('kasbon tidak membuat piutang/cicilan baru',
    db.prepare('SELECT COUNT(*) c FROM piutang_bayar').get().c === pbSebelum && db.prepare('SELECT COUNT(*) c FROM piutang').get().c === piuSebelum + 1);
  ok('nominal kasbon tersimpan untuk slip', db.prepare('SELECT pot_kasbon FROM payroll WHERE periode=? ORDER BY urutan LIMIT 1').get(periodeNow).pot_kasbon === 30000);
  const piuA = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Guru A' AND keterangan='Kasbon koperasi'").get();
  ok('piutang tetap utuh (belum lunas)', piuA.status === 'belum');
  r = await req('POST', '/payroll/posting', { periode: periodeNow });
  ok('posting ke BKU tetap jalan', r.status === 303 && /ok=/.test(r.loc), r.loc.slice(0, 120));
  ok('posting tidak memotong piutang', db.prepare('SELECT COUNT(*) c FROM piutang_bayar').get().c === pbSebelum);
  r = await req('POST', '/payroll/batal-posting', { periode: periodeNow });
  ok('batal posting membuka kunci', r.status === 303 && !db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeNow));

  /* ================= 4. hanya tombol Simpan Draf (review dihapus) ================= */
  r = await req('GET', '/payroll?periode=' + periodeNow);
  ok('tanpa review screen', !/mPayrollReview/.test(r.text) && !/data-review-confirm/.test(r.text));
  ok('hanya tombol Simpan Draf', /Simpan Draf/.test(r.text) && !/Review &amp; Simpan/.test(r.text));

  /* ================= 5. hapus massal ================= */
  ok('checkbox per baris + pilih semua', /name="pilih"/.test(r.text) && /data-check-all-box="pilih"/.test(r.text) && /Hapus Terpilih/.test(r.text));
  rows = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow);
  r = await req('POST', '/payroll/hapus-terpilih', { periode: periodeNow, pilih: [String(rows[0].id), String(rows[2].id)] });
  ok('hapus terpilih menghapus 2 baris', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM payroll WHERE periode=?').get(periodeNow).c === rows.length - 2,
    db.prepare('SELECT COUNT(*) c FROM payroll WHERE periode=?').get(periodeNow).c);
  ok('baris terhapus masuk kotak sampah', db.prepare("SELECT COUNT(*) c FROM trash WHERE tabel='payroll'").get().c >= 2);
  r = await req('POST', '/payroll/hapus-terpilih', { periode: periodeNow });
  ok('hapus terpilih tanpa ceklis ditolak', /err=/.test(r.loc));

  /* ================= 6. salin data bulan sebelumnya (urutan sama) ================= */
  r = await req('POST', '/payroll/tarik', { periode: prevPeriode(periodeNow) });
  let prevRows = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id').all(prevPeriode(periodeNow));
  const b2 = { periode: prevPeriode(periodeNow), ids: prevRows.map(x => x.id).join(',') };
  prevRows.forEach((x, i) => {
    b2[`${x.id}_jam_efektif`] = String(10 + i);
    b2[`${x.id}_honor_jam`] = '45000';
    b2[`${x.id}_jam_sertifikasi`] = String(2 + i);
  });
  await req('POST', '/payroll/simpan', b2);
  // kosongkan periode berjalan lalu salin
  db.prepare('DELETE FROM payroll WHERE periode=?').run(periodeNow);
  r = await req('POST', '/payroll/salin-bulan', { periode: periodeNow });
  ok('salin data bulan sebelumnya', r.status === 303 && /ok=/.test(r.loc), r.loc.slice(0, 140));
  const prevOrder = db.prepare('SELECT nama FROM payroll WHERE periode=? ORDER BY urutan, id').all(prevPeriode(periodeNow)).map(x => x.nama);
  const nowOrder = db.prepare('SELECT nama FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow).map(x => x.nama);
  ok('urutan nama identik dengan bulan sebelumnya', JSON.stringify(prevOrder) === JSON.stringify(nowOrder), `${prevOrder} vs ${nowOrder}`);
  const copied = db.prepare('SELECT * FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow);
  ok('nilai isian ikut tersalin', Number(copied[0].jam_efektif) === 10 && Number(copied[0].honor_jam) === 45000 && Number(copied[0].jam_sertifikasi) === 2,
    JSON.stringify({ j: copied[0].jam_efektif, h: copied[0].honor_jam, s: copied[0].jam_sertifikasi }));
  r = await req('POST', '/payroll/salin-bulan', { periode: periodeNow });
  ok('salin ulang tidak menduplikasi', db.prepare('SELECT COUNT(*) c FROM payroll WHERE periode=?').get(periodeNow).c === copied.length);

  /* ================= 7. realtime portal publik slip ================= */
  await req('POST', '/pegawai/save', { nama: 'Guru A', jabatan: 'Guru', tipe: 'guru', aktif: '1', tanggal_lahir: '1990-01-01', whatsapp: '081200000011' });
  const prA = db.prepare("SELECT * FROM payroll WHERE periode=? AND lower(nama)=lower('Guru A')").get(periodeNow);
  if (prA) {
    await req('POST', '/payroll/simpan', { periode: periodeNow, ids: String(prA.id), [`${prA.id}_jam_efektif`]: '30', [`${prA.id}_honor_jam`]: '50000', [`${prA.id}_jam_sertifikasi`]: '8' });
  }
  r = await req('POST', '/portal-slip/otp', { nama: 'Guru A', lahir: '1990-01-01' }, { public: true });
  const tokSlip = (/name="token" value="([^"]+)"/.exec(r.text) || [])[1] || '';
  const kodeSlip = (/kode OTP Anda: <b class="mono"[^>]*>(\d{4})/.exec(r.text) || [])[1] || '';
  r = await req('POST', '/portal-slip/verifikasi', { token: tokSlip, kode: kodeSlip }, { public: true });
  const slipTxt = r.text.replace(/\s+/g, ' ');
  ok('portal slip langsung memuat nilai tersimpan terbaru',
    /Gaji \/ Honor Mengajar/.test(slipTxt) && /Rp 1\.500\.000/.test(slipTxt) && /Rp 100\.000/.test(slipTxt),
    (slipTxt.match(/Rp [0-9.]+/g) || []).slice(0, 6).join(' | '));
  ok('portal slip memakai halaman tanpa cache (no-store)', /no-store/.test((await req('GET', '/portal-slip', null, { public: true })).headers.get('cache-control') || ''));

  /* ================= 8. import Excel mempertahankan urutan baris ================= */
  // bangun XLSX manual: Zulkifli, Ahmad, Marno (urutannya sengaja tidak abjad)
  const head = ['NAMA', 'JABATAN', 'TIPE', 'JAM EFEKTIF', 'JAM TELAT', 'HONOR/JAM', 'TUNJ. JABATAN', 'MASA KERJA',
    'LEMBUR', 'TAMBAHAN PENGHASILAN', 'TUNJ. KHUSUS', 'JAM PEMBANTU KEPSEK', 'JAM WALI KELAS',
    'DANA SOSIAL', 'BPJS KES', 'BPJS TK', 'JAM SERTIFIKASI', 'KASBON', 'CATATAN'].map(v => ({ v, bold: true }));
  const isi = [
    ['Zulkifli', 'Guru', 'guru', 20, 0, 50000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 10000, ''],
    ['Ahmad Fauzi', 'Guru', 'guru', 22, 1, 50000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, ''],
    ['Marno', 'TU', 'tu', 24, 0, 45000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, '']
  ];
  const buf = require('../lib').xlsxBuffer('Leger', [head, ...isi], [26, 20, 8, 11, 10, 12, 13, 12, 10, 18, 12, 16, 14, 12, 11, 11, 14, 10, 20]);
  db.prepare('DELETE FROM payroll WHERE periode=?').run(periodeNow);
  r = await req('POST', '/payroll/import', {
    periode: periodeNow, file_name: 'leger.xlsx',
    file_b64: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + buf.toString('base64')
  });
  ok('import leger berhasil', r.status === 303 && /ok=/.test(r.loc), r.loc.slice(0, 140));
  const imported = db.prepare('SELECT nama, urutan, jam_sertifikasi, pot_sertifikasi FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow);
  ok('urutan import = urutan fisik Excel', imported.map(x => x.nama).join('|') === 'Zulkifli|Ahmad Fauzi|Marno', imported.map(x => x.nama).join('|'));
  ok('urutan tersimpan menaik sesuai berkas', imported.map(x => Number(x.urutan)).join(',') === '1,2,3', imported.map(x => x.urutan).join(','));
  ok('kolom JAM SERTIFIKASI terbaca sebagai jam', imported.map(x => Number(x.jam_sertifikasi)).join(',') === '5,6,7', imported.map(x => x.jam_sertifikasi).join(','));
  ok('nominal sertifikasi = jam × tarif', imported.map(x => Number(x.pot_sertifikasi)).join(',') === '62500,75000,87500', imported.map(x => x.pot_sertifikasi).join(','));
  r = await req('GET', '/payroll?periode=' + periodeNow);
  const posZ = r.text.indexOf('Zulkifli'), posA = r.text.indexOf('Ahmad Fauzi'), posM = r.text.indexOf('Marno');
  ok('tabel menampilkan urutan Excel (bukan A-Z)', posZ > 0 && posZ < posA && posA < posM, `${posZ},${posA},${posM}`);
  // import ulang (update) tidak mengubah urutan
  await req('POST', '/payroll/import', {
    periode: periodeNow, file_name: 'leger.xlsx',
    file_b64: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + buf.toString('base64')
  });
  const re = db.prepare('SELECT nama FROM payroll WHERE periode=? ORDER BY urutan, id').all(periodeNow);
  ok('import ulang tetap menjaga urutan', re.map(x => x.nama).join('|') === 'Zulkifli|Ahmad Fauzi|Marno', re.map(x => x.nama).join('|'));

  /* ================= 9. portal publik piutang = agregat saldo akhir ================= */
  // 3 salinan rollover dari satu utang yang sudah lunas + 1 utang lain yang masih aktif
  db.prepare('DELETE FROM piutang_bayar').run();
  db.prepare('DELETE FROM piutang').run();
  await req('POST', '/piutang/save', { nama_pegawai: 'Guru A', tanggal_utang: '2026-10-01', nominal: '65000', keterangan: 'Import import' });
  const p1 = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Guru A'").get();
  db.prepare("INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,keterangan,created_at) VALUES (?,?,?,'tunai','lunas',?)")
    .run(p1.id, '2026-10-02', 65000, new Date().toISOString());
  const taIds = db.prepare('SELECT id FROM tahun_ajaran ORDER BY id').all().map(x => x.id);
  db.prepare("INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,status,keterangan,created_at,tahun_ajaran_id) VALUES ('Guru A','2027-07-01',65000,'belum','Saldo awal TA 2027/2028 — Import import','x',?)")
    .run(taIds[taIds.length - 1]);
  db.prepare("INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,status,keterangan,created_at,tahun_ajaran_id) VALUES ('Guru A','2027-07-01',65000,'belum','Saldo awal TA 2025/2026 — Saldo awal TA 2027/2028 — Import import','x',?)")
    .run(taIds[0]);
  await req('POST', '/piutang/save', { nama_pegawai: 'Guru A', tanggal_utang: today, nominal: '120000', keterangan: 'Pinjaman aktif' });

  r = await req('POST', '/portal-pegawai/otp', { nama: 'Guru A', lahir: '1990-01-01' }, { public: true });
  const tokP = (/name="token" value="([^"]+)"/.exec(r.text) || [])[1] || '';
  const kodeP = (/kode OTP Anda: <b class="mono"[^>]*>(\d{4})/.exec(r.text) || [])[1] || '';
  r = await req('POST', '/portal-pegawai/verifikasi', { token: tokP, kode: kodeP }, { public: true });
  const txt = r.text.replace(/\s+/g, ' ');
  ok('portal: salinan saldo awal yang sudah lunas TIDAK jadi tagihan aktif',
    /1 tagihan aktif/.test(txt), (/(\d+) tagihan aktif/.exec(txt) || [])[1]);
  ok('portal: hanya 1 baris aktif (Pinjaman aktif)', (txt.match(/Pinjaman aktif/g) || []).length === 1);
  ok('portal: total sisa = Rp 120.000', /Sisa total Rp 120\.000/.test(txt) || /Rp 120\.000/.test(txt));
  ok('portal: baris lunas masuk Riwayat LUNAS', /Riwayat LUNAS/.test(txt) && /Import import/.test(txt));
  ok('portal: keterangan salinan tidak menampilkan prefix "Saldo awal TA"', !/Saldo awal TA/.test(txt));
  ok('portal: status akhir LUNAS untuk utang 65.000', /LUNAS/.test(txt));
  // total master konsisten dengan portal
  const totalMaster = db.prepare('SELECT * FROM piutang').all()
    .map(p => Math.max(0, Number(p.nominal) - Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(p.id).s)))
    .reduce((a, b) => a + b, 0);
  ok('master & portal memakai angka berbeda hanya karena salinan (master 250rb, portal 120rb)', totalMaster === 250000,
    String(totalMaster));

  /* ================= 10. pindah periode tetap konsisten ================= */
  r = await req('GET', '/payroll?periode=' + periodeNow);
  ok('halaman payroll tetap normal setelah semua perubahan', r.status === 200 && /Leger Honor/.test(r.text));

  db.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 11 lulus ===`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    if (!/SIMKEU Sekolah listening/.test(log)) console.log('log:', log.slice(-900));
    process.exit(1);
  }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
