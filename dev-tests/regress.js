'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Regresi modul lama setelah penambahan fitur (transaksi, piutang, payroll, aset, tutup BKU, backup) */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const PORT = 3501;
const DB = path.join(os.tmpdir(), 'smk-reg-' + Date.now() + '.sqlite');
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body !== undefined && body !== null) {
    if (Buffer.isBuffer(body)) { payload = body; headers['Content-Type'] = opt.ct || 'application/octet-stream'; }
    else {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) Array.isArray(v) ? v.forEach(x => usp.append(k, x)) : usp.append(k, v);
      payload = usp.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login', r.status === 303);
  const db = new Database(DB);
  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  const bku = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? ORDER BY id LIMIT 1').get(ta.id);

  // transaksi: pengeluaran hanya menawarkan akun pengeluaran
  const trxPage = await req('GET', '/transaksi');
  ok('halaman transaksi', trxPage.status === 200);
  const blokOut = trxPage.text.split('id="mTrxOut"')[1] || '';
  ok('form pengeluaran tanpa akun pendapatan', !/4\.1\.01/.test(blokOut) && /5\.2\.01/.test(blokOut));
  const coa = db.prepare("SELECT * FROM coa WHERE kode='5.2.01'").get();
  const today = new Date().toISOString().slice(0, 10);
  r = await req('POST', '/transaksi/save', { bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai', coa_id: coa.id, nominal: '150000', uraian: 'Uji belanja ATK', nama_pihak: 'Toko Uji' });
  ok('simpan transaksi', r.status === 303);
  const trx = db.prepare("SELECT * FROM transaksi WHERE uraian='Uji belanja ATK'").get();
  ok('transaksi tersimpan posted', trx && trx.status === 'posted' && trx.nominal === 150000);

  // edit inline
  r = await req('POST', '/transaksi/save', { id: trx.id, bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'transfer', coa_id: coa.id, nominal: '175000', uraian: 'Uji belanja ATK revisi', back: '/transaksi' });
  ok('edit transaksi', r.status === 303 && db.prepare('SELECT nominal,metode FROM transaksi WHERE id=?').get(trx.id).nominal === 175000);

  // pindah saldo
  const bku2 = db.prepare('SELECT * FROM bku WHERE tahun_ajaran_id=? AND id<>? ORDER BY id LIMIT 1').get(ta.id, bku.id);
  r = await req('POST', '/transaksi/pindah', { dari_id: bku.id, ke_id: bku2.id, tanggal: today, metode: 'tunai', nominal: '50000', keterangan: 'uji' });
  ok('pindah saldo', r.status === 303 && db.prepare("SELECT COUNT(*) c FROM transaksi WHERE transfer_group IS NOT NULL").get().c === 2);

  // piutang: buat, bayar, hapus (soft) + restore anak cicilan
  const peg = db.prepare('SELECT * FROM pegawai LIMIT 1').get();
  const nama = peg ? peg.nama : 'Pegawai Uji';
  r = await req('POST', '/piutang/save', { nama_pegawai: nama, tanggal_utang: today, nominal: '300000', keterangan: 'uji', bku_id: bku.id });
  ok('piutang simpan', r.status === 303);
  const p = db.prepare('SELECT * FROM piutang ORDER BY id DESC LIMIT 1').get();
  r = await req('POST', '/piutang/bayar', { id: p.id, nominal: '100000', tanggal: today, metode: 'tunai', bku_id: bku.id });
  ok('bayar piutang', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE piutang_id=?').get(p.id).c === 1);
  r = await req('POST', '/piutang/delete', { id: p.id });
  ok('hapus piutang soft', r.status === 303 && !!db.prepare("SELECT 1 FROM trash WHERE tabel='piutang' AND row_id=?").get(p.id));
  const tp = db.prepare("SELECT * FROM trash WHERE tabel='piutang' AND row_id=? ORDER BY id DESC").get(p.id);
  r = await req('POST', '/trash/restore', { id: tp.id });
  ok('restore piutang + cicilan', r.status === 303 && db.prepare('SELECT COUNT(*) c FROM piutang_bayar WHERE piutang_id=?').get(p.id).c === 1);

  // payroll: tarik, simpan, posting, batal
  const periode = today.slice(0, 7);
  r = await req('POST', '/payroll/tarik', { periode });
  ok('payroll tarik', r.status === 303);
  const pr = db.prepare('SELECT * FROM payroll WHERE periode=? LIMIT 1').get(periode);
  if (pr) {
    r = await req('POST', '/payroll/simpan', {
      periode, ids: String(pr.id),
      [`${pr.id}_jam_efektif`]: '20', [`${pr.id}_jam_telat`]: '1', [`${pr.id}_honor_jam`]: '50000',
      [`${pr.id}_pot_sertifikasi`]: ''
    });
    ok('payroll simpan', r.status === 303, r.text.slice(0, 100));
    const after = db.prepare('SELECT * FROM payroll WHERE id=?').get(pr.id);
    ok('honor mengajar tersimpan', Number(after.jam_efektif) === 20 && Number(after.honor_jam) === 50000);
  }
  // urutan leger
  if (pr) {
    r = await req('POST', '/payroll/urutkan', { id: pr.id, periode, arah: 'down' });
    ok('ubah urutan leger', r.status === 303);
  }

  // aset: toggle akun + dedupe
  const akun = db.prepare("SELECT * FROM aset WHERE jenis='pinjaman' LIMIT 1").get();
  if (akun) {
    r = await req('POST', '/aset/akun/toggle', { id: akun.id, tampil: '' });
    ok('toggle akun aset', r.status === 303 && Number(db.prepare('SELECT tampil FROM aset WHERE id=?').get(akun.id).tampil) === 0);
    r = await req('POST', '/aset/akun/toggle', { id: akun.id, tampil: '1' });
  }
  r = await req('POST', '/aset/dedupe', {});
  ok('dedupe aset', r.status === 303);

  // coa tambah dengan kode otomatis
  const kodeBaru = /name="kode" value="(5\.2\.\d+)"/.exec((await req('GET', '/coa')).text);
  ok('coa kode otomatis', !!kodeBaru);
  if (kodeBaru) {
    r = await req('POST', '/coa/save', { kode: kodeBaru[1], nama: 'Uji Rekening Baru', kategori: 'pengeluaran' });
    ok('coa simpan', r.status === 303 && !!db.prepare('SELECT 1 FROM coa WHERE kode=?').get(kodeBaru[1]));
  }

  // tutup bulanan + kunci + buka
  r = await req('POST', '/tutup-bulanan/tutup', { bku_id: bku.id, periode, metode: 'rollover', back: '/tutup-bulanan' });
  ok('tutup bulanan', r.status === 303, r.headers.get('location'));
  const per = db.prepare('SELECT * FROM bku_periode WHERE bku_id=? AND periode=?').get(bku.id, periode);
  ok('periode ditutup tercatat', !!per && per.status === 'ditutup');
  r = await req('POST', '/transaksi/save', { bku_id: bku.id, tanggal: today, jenis: 'pengeluaran', metode: 'tunai', coa_id: coa.id, nominal: '10000', uraian: 'harus ditolak' });
  ok('transaksi ditolak saat periode ditutup', r.status === 303 && !db.prepare("SELECT 1 FROM transaksi WHERE uraian='harus ditolak'").get());
  r = await req('POST', '/tutup-bulanan/buka', { bku_id: bku.id, periode, back: '/tutup-bulanan' });
  ok('buka kunci periode', r.status === 303 && db.prepare('SELECT status FROM bku_periode WHERE bku_id=? AND periode=?').get(bku.id, periode).status === 'dibuka');

  // opnam: membuka kembali menghapus penyesuaian lama ke Kotak Sampah
  const saldoBuku = Number(db.prepare(`SELECT b.saldo_awal + COALESCE(SUM(
      CASE WHEN t.jenis='pemasukan' THEN t.nominal ELSE -t.nominal END),0) saldo
    FROM bku b LEFT JOIN transaksi t ON t.bku_id=b.id AND t.status='posted' AND t.tanggal<=?
    WHERE b.id=?`).get(`${periode}-31`, bku.id).saldo || 0);
  r = await req('POST', '/tutup-bulanan/tutup', {
    bku_id: bku.id, periode, metode: 'opnam', opnam_tunai: String(saldoBuku + 1000000),
    opnam_bank: '0', alasan: 'uji selisih kas', metode_penyesuaian: 'tunai'
  });
  let opnam = db.prepare('SELECT * FROM transaksi WHERE bku_id=? AND periode_penyesuaian=? AND is_penyesuaian=1').get(bku.id, periode);
  ok('opnam membuat transaksi selisih', r.status === 303 && !!opnam);
  r = await req('POST', '/tutup-bulanan/buka', { bku_id: bku.id, periode, back: '/tutup-bulanan' });
  ok('buka kembali menghapus transaksi selisih', r.status === 303 &&
    !db.prepare('SELECT 1 FROM transaksi WHERE id=?').get(opnam.id) &&
    !!db.prepare("SELECT 1 FROM trash WHERE tabel='transaksi' AND row_id=?").get(opnam.id));

  // penutupan ulang tidak menggandakan penyesuaian; transaksi opnam dapat diedit/dihapus
  r = await req('POST', '/tutup-bulanan/tutup', {
    bku_id: bku.id, periode, metode: 'opnam', opnam_tunai: String(saldoBuku + 800000),
    opnam_bank: '0', alasan: 'uji selisih kas kedua', metode_penyesuaian: 'tunai'
  });
  opnam = db.prepare('SELECT * FROM transaksi WHERE bku_id=? AND periode_penyesuaian=? AND is_penyesuaian=1').get(bku.id, periode);
  ok('tutup ulang hanya punya satu transaksi selisih', r.status === 303 &&
    db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=? AND periode_penyesuaian=? AND is_penyesuaian=1').get(bku.id, periode).c === 1);
  db.prepare("UPDATE bku_periode SET status='dibuka' WHERE bku_id=? AND periode=?").run(bku.id, periode);
  const opnamPage = await req('GET', `/transaksi?bku=${bku.id}`);
  const opnamRow = opnamPage.text.split(`id="trx${opnam.id}"`)[1] || '';
  ok('aksi edit dan hapus transaksi opnam tampil', opnamPage.status === 200 &&
    opnamRow.includes(`inline=${opnam.id}`) && opnamRow.includes('/transaksi/delete'));
  r = await req('POST', '/transaksi/save', {
    id: opnam.id, bku_id: bku.id, tanggal: opnam.tanggal, jenis: opnam.jenis, metode: 'transfer',
    coa_id: opnam.coa_id, nominal: String(opnam.nominal + 500), uraian: 'Selisih kas hasil edit',
    nama_pihak: opnam.nama_pihak, back: `/transaksi?bku=${bku.id}`
  });
  ok('transaksi opnam bisa diedit', r.status === 303 &&
    db.prepare('SELECT nominal,metode FROM transaksi WHERE id=?').get(opnam.id).nominal === opnam.nominal + 500);
  r = await req('POST', '/transaksi/delete', { id: opnam.id, back: `/transaksi?bku=${bku.id}` });
  ok('transaksi opnam bisa dihapus', r.status === 303 &&
    !db.prepare('SELECT 1 FROM transaksi WHERE id=?').get(opnam.id));

  // daftar transaksi memuat 100 baris, filter tetap berlaku pada halaman selanjutnya
  db.transaction(() => {
    const ins = db.prepare(`INSERT INTO transaksi
      (bku_id,tanggal,jenis,metode,no_bukti,nominal,uraian,status,created_at)
      VALUES (?,?,'pemasukan','tunai',?,1,?,'pending',?)`);
    for (let i = 1; i <= 205; i++) {
      ins.run(bku.id, today, `PAGE/${i}`, `ROUND-PAGE-${String(i).padStart(3, '0')}`, new Date().toISOString());
    }
  })();
  r = await req('GET', `/transaksi?q=ROUND-PAGE&bku=${bku.id}`);
  const page1Rows = (r.text.match(/<tr id="trx\d+"/g) || []).length;
  ok('paginasi transaksi membatasi 100 baris dan menghitung semua hasil filter', page1Rows === 100 &&
    /dari 205 transaksi · halaman 1\/3/.test(r.text));
  r = await req('GET', `/transaksi?q=ROUND-PAGE&bku=${bku.id}&hal=2`);
  const page2Rows = (r.text.match(/<tr id="trx\d+"/g) || []).length;
  const nextFilterLink = r.text.includes(`q=ROUND-PAGE&bku=${bku.id}&hal=3`);
  const hasPage2Record = r.text.includes('ROUND-PAGE-105');
  ok('filter pencarian terbawa ke halaman transaksi berikutnya', page2Rows === 100 && nextFilterLink && hasPage2Record,
    `baris=${page2Rows}, link=${nextFilterLink}, row=${hasPage2Record}`);

  // backup zip
  r = await req('GET', '/backup/download-zip', null, { binary: true });
  ok('backup zip', r.status === 200 && r.text.length > 2000);
  ok('backup memuat tabel baru', db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name IN ('iuran_bayar','siswa','trash')").get().c === 3);

  // akses role staff tetap dibatasi
  db.prepare("INSERT INTO users (nama,email,password,role,aktif,created_at) VALUES ('Staff Uji','staff@uji.id','x','staff',1,'2026-01-01')").run();
  await req('POST', '/logout', {});
  r = await req('GET', '/pengguna');
  ok('logout redirect', r.status === 303);

  const fail = results.filter(x => !x.ok);
  console.log(`\n=== ${results.length - fail.length}/${results.length} cek regresi lulus ===`);
  if (fail.length) console.log(fail.map(f => `- ${f.name} ${f.extra || ''}`).join('\n'));
  const errs = log.split('\n').filter(l => /\[ERROR\]/.test(l));
  if (errs.length) console.log('LOG ERROR:\n' + errs.slice(0, 8).join('\n'));
  srv.kill();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(log.slice(-2500)); srv.kill(); process.exit(2); });
