'use strict';
/* Test ronde 10:
   - sinkronisasi status piutang (pegawai & sertifikasi) dengan portal publik
   - leger honor sebagai DRAF (bebas bulan / lintas tahun pelajaran, tanpa error "Periode tidak valid")
   - pemisahan potongan kasbon (ronde 11: fitur potong otomatis dihapus, kasbon = catatan slip)
   - posting ke BKU mengunci draf, hapus transaksi BKU membuka kunci
   - modul Slip Gaji (filter periode, tabel modern, TOTAL DITERIMA besar) & portal slip tanpa field WhatsApp */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const PORT = 3601;
const DB = process.env.R10_DB || path.join(os.tmpdir(), 'smk-r10-' + Date.now() + '.sqlite');
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
const periodeLama = '2020-01';   // bulan jauh di masa lalu + di luar tahun pelajaran aktif

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303);
  const db = new Database(DB);

  /* ============ 1. master pegawai ============ */
  await req('POST', '/pegawai/save', { nama: 'Rina Guru', jabatan: 'Guru Matematika', tipe: 'guru', aktif: '1', tanggal_lahir: '1990-03-03', whatsapp: '081211112222' });
  await req('POST', '/pegawai/save', { nama: 'Tanpa WA', jabatan: 'Staf TU', tipe: 'tu', aktif: '1', tanggal_lahir: '1991-04-04' });
  const pg = db.prepare("SELECT * FROM pegawai WHERE nama='Rina Guru'").get();
  ok('pegawai tersimpan + WA ternormalisasi', pg && pg.whatsapp === '6281211112222', pg && pg.whatsapp);

  /* ============ 2. sinkronisasi status piutang ============ */
  await req('POST', '/piutang/save', { nama_pegawai: 'Rina Guru', tanggal_utang: today, nominal: '300000', keterangan: 'Kasbon seragam' });
  const piu = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Rina Guru' ORDER BY id DESC LIMIT 1").get();
  ok('piutang dibuat status belum', piu && piu.status === 'belum');
  // simulasi data lama / import yang menulis cicilan tanpa memperbarui status
  db.prepare("INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,keterangan,created_at) VALUES (?,?,?,'tunai','Lunasi manual',?)")
    .run(piu.id, today, 300000, new Date().toISOString());
  ok('status kolom masih belum (data usang)', db.prepare('SELECT status FROM piutang WHERE id=?').get(piu.id).status === 'belum');
  r = await req('GET', '/piutang');
  ok('halaman master menyinkronkan status → LUNAS', r.status === 200 && db.prepare('SELECT status FROM piutang WHERE id=?').get(piu.id).status === 'lunas',
    db.prepare('SELECT status FROM piutang WHERE id=?').get(piu.id).status);

  // piutang sertifikasi: sama
  await req('POST', '/piutang-lain/save', { nama: 'Rina Guru', tanggal: today, nominal: '150000', keterangan: 'Sertifikasi' });
  const pl = db.prepare("SELECT * FROM piutang_lain WHERE nama='Rina Guru' ORDER BY id DESC LIMIT 1").get();
  db.prepare("INSERT INTO piutang_lain_bayar (piutang_id,tanggal,nominal,metode,keterangan,created_at) VALUES (?,?,?,'tunai','Lunas',?)")
    .run(pl.id, today, 150000, new Date().toISOString());
  r = await req('GET', '/piutang-lain');
  ok('piutang sertifikasi ikut tersinkron LUNAS', r.status === 200 && db.prepare('SELECT status FROM piutang_lain WHERE id=?').get(pl.id).status === 'lunas');

  // piutang baru yang belum dibayar tetap aktif di portal
  await req('POST', '/piutang/save', { nama_pegawai: 'Rina Guru', tanggal_utang: today, nominal: '120000', keterangan: 'Pinjaman aktif' });

  // portal publik: transaksi lunas tidak lagi muncul sebagai tagihan aktif
  r = await req('GET', '/portal-pegawai', null, { public: true });
  ok('portal piutang terbuka (tanpa field WA)', r.status === 200 && /Cek Piutang Pegawai/.test(r.text) && !/name="wa"/.test(r.text));
  r = await req('POST', '/portal-pegawai/otp', { nama: 'Rina Guru', lahir: '1990-03-03' }, { public: true });
  const tok = (/name="token" value="([^"]+)"/.exec(r.text) || [])[1] || '';
  const kode = (/kode OTP Anda: <b class="mono"[^>]*>(\d{4})/.exec(r.text) || [])[1] || '';
  ok('OTP portal terkirim (demo)', !!tok && /^\d{4}$/.test(kode), `tok=${!!tok} kode=${kode}`);
  r = await req('POST', '/portal-pegawai/verifikasi', { token: tok, kode }, { public: true });
  ok('portal menampilkan status LUNAS', /LUNAS/.test(r.text) && /Riwayat LUNAS/.test(r.text));
  ok('portal hanya menghitung 1 tagihan aktif', /1 tagihan aktif/.test(r.text), (/(\d+) tagihan aktif/.exec(r.text) || [])[1]);
  ok('tagihan lunas tidak masuk tabel aktif', /Kasbon seragam/.test(r.text) && /class="portal-ta lunas-box"[\s\S]*Kasbon seragam/.test(r.text.replace(/\n/g, ' ')));
  ok('piutang aktif tetap tampil', /Pinjaman aktif/.test(r.text) && /Rp 120\.000/.test(r.text));

  /* ============ 3. leger honor = DRAF lintas bulan ============ */
  r = await req('POST', '/payroll/tarik', { periode: periodeLama });
  ok('tarik pegawai ke periode lama (di luar TA aktif)', r.status === 303 && !/err=/.test(r.loc), r.loc);
  const prLama = db.prepare("SELECT * FROM payroll WHERE periode=? AND lower(nama)=lower('Rina Guru')").get(periodeLama);
  ok('baris leger periode lama dibuat', !!prLama);
  r = await req('GET', '/payroll?periode=' + periodeLama);
  ok('halaman payroll membuka periode lama', r.status === 200 && /DRAF · bebas diedit/.test(r.text));
  ok('dropdown periode tersimpan tersedia', /Draf \/ Periode Tersimpan/.test(r.text) && r.text.includes(periodeLama));
  ok('input periode tanpa batas min/max TA', !/name="periode" value="2020-01" min=/.test(r.text));
  // ronde 11: seluruh fitur potong-kasbon otomatis dihapus → kasbon hanya kolom catatan
  ok('fitur potong kasbon otomatis dihapus', !/kasbon-apply/.test(r.text) && !/kasbon-mode/.test(r.text) && !/kasbon_auto/.test(r.text));

  // simpan draf TANPA field periode (bug lama: "Periode tidak valid") → tetap tersimpan lewat ids
  const draftBody = {
    ids: String(prLama.id),
    [`${prLama.id}_jam_efektif`]: '20', [`${prLama.id}_jam_telat`]: '2', [`${prLama.id}_honor_jam`]: '50000',
    [`${prLama.id}_pot_kasbon`]: '40000', [`${prLama.id}_pot_dana_sosial`]: '5000',
    [`${prLama.id}_jam_wali_kelas`]: '3'
  };
  r = await req('POST', '/payroll/simpan', draftBody);
  ok('simpan draf tanpa periode tidak error', r.status === 303 && /ok=/.test(r.loc) && !/tidak%20valid/i.test(r.loc), r.loc);
  const after = db.prepare('SELECT * FROM payroll WHERE id=?').get(prLama.id);
  ok('nilai draf tersimpan', Number(after.jam_efektif) === 20 && Number(after.pot_kasbon) === 40000 && Number(after.pot_dana_sosial) === 5000);
  ok('simpan draf tidak memotong piutang', db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE payroll_id=?').get(prLama.id).c === 0);
  ok('kasbon_applied masih 0 saat draf', Number(after.kasbon_applied) === 0);
  ok('tanpa posting payroll_post belum ada', !db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeLama));

  /* ============ 4. kasbon hanya pencatatan (tanpa potong otomatis) ============ */
  const piuAktif = db.prepare("SELECT * FROM piutang WHERE nama_pegawai='Rina Guru' AND keterangan='Pinjaman aktif'").get();
  ok('kasbon tidak membuat cicilan piutang', db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE payroll_id=?').get(prLama.id).c === 0);
  ok('sisa piutang aktif tidak berubah', Number(piuAktif.nominal) === 120000 && db.prepare('SELECT status FROM piutang WHERE id=?').get(piuAktif.id).status === 'belum');
  await req('POST', '/payroll/posting', { periode: periodeLama });
  ok('posting tidak memotong kasbon ke piutang', db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE payroll_id=?').get(prLama.id).c === 0);
  await req('POST', '/payroll/batal-posting', { periode: periodeLama });

  /* ============ 5. posting ke BKU & kuncian ============ */
  const trxBefore = db.prepare('SELECT COUNT(*) c FROM transaksi').get().c;
  r = await req('POST', '/payroll/posting', { periode: periodeLama });
  ok('posting honor ke BKU', r.status === 303 && /ok=/.test(r.loc), r.loc);
  const post = db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeLama);
  ok('payroll_post tercatat', !!post && !!post.trx_umum_id);
  const trxUmum = db.prepare('SELECT * FROM transaksi WHERE id=?').get(post.trx_umum_id);
  ok('transaksi BKU Umum metode Transfer Bank', trxUmum && trxUmum.jenis === 'pengeluaran' && trxUmum.metode === 'transfer' && /Honorarium/.test(trxUmum.uraian),
    JSON.stringify({ j: trxUmum && trxUmum.jenis, m: trxUmum && trxUmum.metode }));
  ok('total transaksi bertambah', db.prepare('SELECT COUNT(*) c FROM transaksi').get().c >= trxBefore + 1);

  r = await req('GET', '/payroll?periode=' + periodeLama);
  ok('leger tampil TERKUNCI setelah posting', r.status === 200 && /TERKUNCI/.test(r.text) && /Hapus Transaksi &amp; Buka Kunci/.test(r.text));
  r = await req('POST', '/payroll/simpan', { periode: periodeLama, ids: String(prLama.id), [`${prLama.id}_jam_efektif`]: '10' });
  ok('simpan draf ditolak saat terkunci', db.prepare('SELECT jam_efektif FROM payroll WHERE id=?').get(prLama.id).jam_efektif === 20, r.loc);
  r = await req('POST', '/payroll/posting', { periode: periodeLama });
  ok('posting ganda ditolak', /err=/.test(r.loc), r.loc);

  /* ============ 6. hapus transaksi BKU → draf terbuka kembali ============ */
  r = await req('POST', '/transaksi/delete', { id: post.trx_umum_id, back: '/transaksi' });
  ok('hapus transaksi honor di BKU', r.status === 303 && /ok=/.test(r.loc), r.loc);
  ok('payroll_post ikut terhapus (kunci terbuka)', !db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeLama));
  r = await req('GET', '/payroll?periode=' + periodeLama);
  ok('leger kembali DRAF', /DRAF · bebas diedit/.test(r.text));
  r = await req('POST', '/payroll/simpan', { periode: periodeLama, ids: String(prLama.id), [`${prLama.id}_jam_efektif`]: '18', [`${prLama.id}_honor_jam`]: '50000' });
  ok('draf bisa diedit lagi setelah transaksi dihapus', Number(db.prepare('SELECT jam_efektif FROM payroll WHERE id=?').get(prLama.id).jam_efektif) === 18);
  // posting ulang berhasil
  r = await req('POST', '/payroll/posting', { periode: periodeLama });
  ok('re-posting berhasil', r.status === 303 && /ok=/.test(r.loc) && !!db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeLama));
  const post2 = db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeLama);
  // batal posting juga membuka kunci
  r = await req('POST', '/payroll/batal-posting', { periode: periodeLama });
  ok('batal posting menghapus transaksi & membuka kunci', r.status === 303 && !db.prepare('SELECT * FROM payroll_post WHERE periode=?').get(periodeLama)
    && !db.prepare('SELECT * FROM transaksi WHERE id=?').get(post2.trx_umum_id));

  /* ============ 7. modul Slip Gaji ============ */
  r = await req('GET', '/payroll/slip?periode=' + periodeLama);
  ok('modul slip gaji terbuka', r.status === 200 && /Slip Gaji Pegawai/.test(r.text));
  ok('filter periode (dropdown) tersedia', /Filter Periode/.test(r.text) && /<select name="periode"/.test(r.text));
  ok('tabel modern slip', /class="slip-modern"/.test(r.text) && /TOTAL DITERIMA/.test(r.text));
  ok('nilai diterima ditebalkan/berukuran besar', /class="slip-diterima"/.test(r.text));
  ok('sumber data draf leger disebut', /Draf Leger Honor/.test(r.text));
  r = await req('GET', '/payroll/slip/cetak?periode=' + periodeLama);
  ok('cetak slip 9/halaman tetap ada', r.status === 200 && /Slip Gaji \/ Honor/.test(r.text) && /TOTAL DITERIMA/.test(r.text) && /class="slip-page"/.test(r.text));
  const prId = db.prepare('SELECT id FROM payroll WHERE periode=? LIMIT 1').get(periodeLama).id;
  r = await req('GET', '/payroll/slip/cetak?periode=' + periodeLama + '&id=' + prId);
  ok('cetak slip per pegawai', r.status === 200 && /Rina Guru/.test(r.text) && !/Tanpa WA/.test(r.text));

  /* ============ 8. portal publik slip gaji ============ */
  r = await req('GET', '/portal-slip', null, { public: true });
  ok('portal slip tanpa field nomor WhatsApp', r.status === 200 && !/name="wa"/.test(r.text) && /tanggal lahir/i.test(r.text));
  ok('portal slip memakai datepicker', /type="date" name="lahir"/.test(r.text));
  ok('portal slip autocomplete 3 huruf', /data-autocomplete-min="3"/.test(r.text));
  r = await req('POST', '/portal-slip/otp', { nama: 'Rina Guru', lahir: '1990-03-03' }, { public: true });
  const tok2 = (/name="token" value="([^"]+)"/.exec(r.text) || [])[1] || '';
  const kode2 = (/kode OTP Anda: <b class="mono"[^>]*>(\d{4})/.exec(r.text) || [])[1] || '';
  ok('OTP slip terkirim tanpa input nomor', /Verifikasi Kode OTP/.test(r.text) && !!tok2 && /^\d{4}$/.test(kode2));
  ok('nomor tujuan = nomor pegawai terdaftar', /6281211112222/.test(r.text));
  r = await req('POST', '/portal-slip/verifikasi', { token: tok2, kode: kode2 }, { public: true });
  ok('slip portal terbuka setelah OTP', r.status === 200 && /Rincian Slip Gaji/.test(r.text));
  ok('slip portal memakai tabel modern', /class="tbl-modern slip-detail"/.test(r.text) && /class="slip-total"/.test(r.text));
  ok('TOTAL DITERIMA tampil besar/bold', /TOTAL DITERIMA/.test(r.text) && /class="big"/.test(r.text));
  r = await req('POST', '/portal-slip/otp', { nama: 'Tanpa WA', lahir: '1991-04-04' }, { public: true });
  ok('pegawai tanpa nomor WA diberi penjelasan', /belum terdaftar/i.test(r.text));
  r = await req('POST', '/portal-slip/otp', { nama: 'Rina Guru', lahir: '1999-12-12' }, { public: true });
  ok('tanggal lahir salah ditolak', /tidak ditemukan/i.test(r.text));

  /* ============ 9. navigasi ============ */
  r = await req('GET', '/payroll?periode=' + periodeLama);
  ok('menu Slip Gaji ada di sidebar', /\/payroll\/slip/.test(r.text));

  db.close();
  srv.kill();
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek lulus`);
  if (pass !== results.length) {
    console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(' | '));
    if (!/SIMKEU Sekolah listening/.test(log)) console.log('log:', log.slice(-800));
    process.exit(1);
  }
})().catch(e => { console.error(e); try { srv.kill(); } catch (_) { } process.exit(1); });
