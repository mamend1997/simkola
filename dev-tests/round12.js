'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Test ronde 12:
   1. Hapus & edit riwayat pembayaran piutang umum
   2. Hapus & edit riwayat pembayaran piutang sertifikasi
   3. Riwayat Rekap Input Piutang di paling bawah /piutang (gabungan umum + sertifikasi, bisa edit & hapus)
   4. Tahun ajaran baru TIDAK lagi meluluskan siswa kelas XII otomatis; notifikasi kelulusan dihapus
   5. Data Siswa: ceklis + Pilih Semua + perubahan massal (penetapan kelas & status kelulusan) */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const PORT = 3645;
const DB = process.env.R12_DB || path.join(os.tmpdir(), 'smk-r12-' + Date.now() + '.sqlite');
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
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY id LIMIT 1').get(ta.id);

  /* ============ data dasar: pegawai + piutang umum & sertifikasi ============ */
  await req('POST', '/pegawai/save', { nama: 'Budi Uji', jabatan: 'Guru', tipe: 'guru', aktif: '1', tanggal_lahir: '1990-02-02', whatsapp: '081200000001' });
  await req('POST', '/piutang/save', { nama_pegawai: 'Budi Uji', tanggal_utang: today, nominal: '500000', keterangan: 'Pinjaman uji' });
  const piu = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Budi Uji' ORDER BY id DESC LIMIT 1").get();
  ok('piutang umum dibuat', !!piu);

  /* ============ 1. cicilan lalu hapus riwayat pembayaran ============ */
  r = await req('POST', '/piutang/bayar', { id: piu.id, nominal: '200000', tanggal_bayar: today, metode: 'tunai', keterangan: 'cicilan 1' });
  ok('cicilan tercatat', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE piutang_id=?').get(piu.id).c === 1);
  let bayar = db.prepare('SELECT * FROM piutang_bayar WHERE piutang_id=? ORDER BY id DESC LIMIT 1').get(piu.id);
  ok('status masih belum lunas', db.prepare('SELECT status FROM piutang WHERE id=?').get(piu.id).status === 'belum');

  // halaman piutang memuat tombol hapus riwayat + modal edit
  r = await req('GET', '/piutang');
  ok('riwayat pembayaran punya tombol hapus', new RegExp(`/piutang/bayar/delete`).test(r.text) && /Hapus riwayat pembayaran/.test(r.text));
  ok('riwayat pembayaran punya tombol edit', r.text.includes(`mBayarEd${bayar.id}`) && r.text.includes(`/piutang/bayar/save`));

  /* edit riwayat pembayaran */
  r = await req('POST', '/piutang/bayar/save', { id: bayar.id, nominal: '150000', tanggal: today, metode: 'transfer', keterangan: 'cicilan koreksi' });
  ok('edit riwayat pembayaran', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const afterEdit = db.prepare('SELECT * FROM piutang_bayar WHERE id=?').get(bayar.id);
  ok('nilai pembayaran diperbarui', Number(afterEdit.nominal) === 150000 && afterEdit.metode === 'transfer' && afterEdit.keterangan === 'cicilan koreksi');
  ok('sisa piutang dihitung ulang setelah edit', (await req('GET', '/piutang')).text.includes('350.000'));

  /* edit melebihi sisa ditolak */
  r = await req('POST', '/piutang/bayar/save', { id: bayar.id, nominal: '900000', tanggal: today });
  ok('edit melebihi sisa ditolak', /err=/.test(r.loc), r.loc);
  ok('nominal lama dipertahankan', Number(db.prepare('SELECT nominal FROM piutang_bayar WHERE id=?').get(bayar.id).nominal) === 150000);

  /* hapus riwayat pembayaran */
  r = await req('POST', '/piutang/bayar/delete', { id: bayar.id });
  ok('hapus riwayat pembayaran umum', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('baris pembayaran hilang', db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE piutang_id=?').get(piu.id).c === 0);
  ok('status piutang kembali belum', db.prepare('SELECT status FROM piutang WHERE id=?').get(piu.id).status === 'belum');
  ok('riwayat yang dihapus masuk kotak sampah',
    db.prepare("SELECT COUNT(*) c FROM trash WHERE tabel='piutang_bayar'").get().c >= 1);

  /* ============ 2. piutang sertifikasi: hapus & edit pembayaran ============ */
  await req('POST', '/piutang-lain/save', { nama: 'Budi Uji', tanggal: today, nominal: '400000', keterangan: 'Sertifikasi uji' });
  const pl = db.prepare("SELECT * FROM piutang_lain WHERE nama='Budi Uji' ORDER BY id DESC LIMIT 1").get();
  r = await req('POST', '/piutang-lain/bayar', { id: pl.id, nominal: '100000', tanggal_bayar: today, metode: 'tunai' });
  ok('pembayaran sertifikasi tercatat', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM piutang_lain_bayar WHERE piutang_id=?').get(pl.id).c === 1);
  const plb = db.prepare('SELECT * FROM piutang_lain_bayar WHERE piutang_id=? ORDER BY id DESC LIMIT 1').get(pl.id);

  r = await req('GET', '/piutang-lain');
  ok('riwayat sertifikasi punya tombol hapus', /piutang-lain\/bayar\/delete/.test(r.text));
  ok('riwayat sertifikasi punya tombol edit', r.text.includes(`mPlBayarEd${plb.id}`) && r.text.includes('/piutang-lain/bayar/save'));

  r = await req('POST', '/piutang-lain/bayar/save', { id: plb.id, nominal: '250000', tanggal: today, metode: 'transfer', keterangan: 'koreksi' });
  ok('edit pembayaran sertifikasi', r.status === 303 && Number(db.prepare('SELECT nominal FROM piutang_lain_bayar WHERE id=?').get(plb.id).nominal) === 250000);

  r = await req('POST', '/piutang-lain/bayar/delete', { id: plb.id });
  ok('hapus pembayaran sertifikasi', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM piutang_lain_bayar WHERE piutang_id=?').get(pl.id).c === 0);
  ok('status sertifikasi kembali belum lunas', db.prepare('SELECT status FROM piutang_lain WHERE id=?').get(pl.id).status === 'belum');

  /* ============ 3. Riwayat Rekap Input Piutang di paling bawah ============ */
  await req('POST', '/piutang/bayar', { id: piu.id, nominal: '50000', tanggal_bayar: today });
  r = await req('GET', '/piutang');
  ok('kartu riwayat rekap input tampil', /Riwayat Rekap Input Piutang/.test(r.text) && /id="tblRekapInput"/.test(r.text));
  const posRekap = r.text.indexOf('id="rekapInput"'), posSpp = r.text.indexOf('Tagihan SPP Siswa (Rekap Bulanan)');
  ok('rekap input berada di paling bawah (setelah SPP)', posRekap > posSpp && posSpp > 0, `${posSpp} < ${posRekap}`);
  ok('rekap input memuat piutang umum', /Pinjaman uji/.test(r.text) && r.text.includes(`/piutang?edit=${piu.id}`));
  ok('rekap input memuat piutang sertifikasi', /Sertifikasi uji/.test(r.text) && r.text.includes(`/piutang-lain?edit=${pl.id}`));
  ok('rekap input punya tombol hapus kedua jenis',
    /action="[^"]*\/piutang\/delete"/.test(r.text) && /action="[^"]*\/piutang-lain\/delete"/.test(r.text));
  ok('rekap input menampilkan waktu input', /Waktu Input/.test(r.text));

  /* ============ 4. kelulusan TIDAK otomatis + notifikasi dihapus ============ */
  await req('POST', '/program-keahlian/save', { nama: 'RPL', program_studi: 'RPL', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='RPL'").get();
  await req('POST', '/kelas/save', { nama: 'XII RPL 1', tingkat: 'XII', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kXII = db.prepare("SELECT * FROM kelas WHERE nama='XII RPL 1'").get();
  await req('POST', '/siswa/save', { nisn: '9001', nama: 'Siswa Akhir A', jenis_kelamin: 'L', tanggal_lahir: '2008-01-01', kelas_id: kXII.id });
  await req('POST', '/siswa/save', { nisn: '9002', nama: 'Siswa Akhir B', jenis_kelamin: 'P', tanggal_lahir: '2008-01-02', kelas_id: kXII.id });
  ok('2 siswa kelas XII aktif', db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='aktif'").get(kXII.id).c === 2);

  const taBefore = db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c;
  r = await req('POST', '/tahun-ajaran/save', {
    nama: '2028/2029', tanggal_mulai: '2028-07-01', tanggal_selesai: '2029-06-30',
    buat_bku: '1', salin_master: '1'
  });
  ok('tahun ajaran baru dibuat', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c === taBefore + 1);
  ok('siswa kelas XII TIDAK otomatis lulus', db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='lulus'").get(kXII.id).c === 0,
    db.prepare("SELECT status FROM siswa WHERE nisn='9001'").get().status);
  ok('pesan sukses menjelaskan kelulusan manual', /manual|Data Siswa/i.test(decodeURIComponent(r.loc || '')), r.loc);
  ok('setting graduate_notice tidak dibuat', !db.prepare("SELECT * FROM settings WHERE k='graduate_notice'").get());
  r = await req('GET', '/');
  ok('dashboard tanpa pop-up kelulusan otomatis', !/mGradNotice/.test(r.text) && !/Notifikasi Kelulusan Otomatis/.test(r.text));
  ok('dashboard tetap normal', r.status === 200 && /Dashboard/i.test(r.text));

  // mengaktifkan TA juga tidak meluluskan otomatis
  const taNew = db.prepare("SELECT * FROM tahun_ajaran WHERE nama='2028/2029'").get();
  r = await req('POST', '/tahun-ajaran/aktifkan', { id: taNew.id });
  ok('aktifkan TA tidak meluluskan otomatis', r.status === 303 && db.prepare("SELECT COUNT(*) c FROM siswa WHERE status='lulus'").get().c === 0,
    db.prepare("SELECT status FROM siswa WHERE nisn='9001'").get().status);

  /* ============ 5. Data Siswa: ceklis + perubahan massal ============ */
  r = await req('GET', '/siswa?ta=' + ta.id + '&kelas=' + kXII.id);
  ok('tabel siswa punya ceklis per baris', (r.text.match(/name="siswa" value="\d+"/g) || []).length === 2);
  ok('tabel siswa punya ceklis pilih semua', /data-check-all-box="siswa"/.test(r.text));
  ok('panel perubahan massal tampil', /Perubahan Massal Siswa/.test(r.text) && /id="fBulkSiswa"/.test(r.text));
  ok('panel punya pilih semua / kosongkan', /data-check-all="siswa"/.test(r.text) && /data-check-none="siswa"/.test(r.text));
  ok('panel punya opsi kelas & status kelulusan', /name="kelas_id"/.test(r.text) && /name="status"/.test(r.text) && /Lulus/.test(r.text));
  ok('ada penghitung terpilih', /data-check-count="siswa"/.test(r.text));

  const ids = db.prepare('SELECT id FROM siswa WHERE kelas_id=? ORDER BY id').all(kXII.id).map(x => x.id);

  /* bulk: hanya status kelulusan */
  r = await req('POST', '/siswa/bulk', { siswa: ids.map(String), status: 'lulus' });
  ok('bulk status lulus', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('2 siswa jadi LULUS', db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='lulus'").get(kXII.id).c === 2);

  /* bulk: kembalikan aktif + pindah kelas */
  await req('POST', '/kelas/save', { nama: 'XI RPL 2', tingkat: 'XI', wali_kelas: 'W2', program_id: prog.id, aktif: '1' });
  const kXI = db.prepare("SELECT * FROM kelas WHERE nama='XI RPL 2'").get();
  r = await req('POST', '/siswa/bulk', { siswa: [String(ids[0])], kelas_id: kXI.id, status: 'aktif' });
  ok('bulk penetapan kelas + aktif', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const moved = db.prepare('SELECT * FROM siswa WHERE id=?').get(ids[0]);
  ok('kelas siswa berpindah', Number(moved.kelas_id) === Number(kXI.id) && moved.status === 'aktif');
  ok('mutasi kelas tercatat', db.prepare('SELECT COUNT(*) c FROM siswa_mutasi WHERE siswa_id=?').get(ids[0]).c >= 1);

  /* bulk tanpa pilihan apa pun ditolak */
  r = await req('POST', '/siswa/bulk', { siswa: [String(ids[1])] });
  ok('bulk tanpa aksi ditolak', /err=/.test(r.loc), r.loc);
  /* bulk tanpa ceklis ditolak */
  r = await req('POST', '/siswa/bulk', { status: 'lulus' });
  ok('bulk tanpa ceklis ditolak', /err=/.test(r.loc), r.loc);
  ok('audit perubahan massal tercatat', db.prepare("SELECT COUNT(*) c FROM audit WHERE aksi='UBAH MASSAL'").get().c >= 2);

  db.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} cek ronde 12 lulus ===`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    if (!/SIMKEU Sekolah listening/.test(log)) console.log('log:', log.slice(-900));
    process.exit(1);
  }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
