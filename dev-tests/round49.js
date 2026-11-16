'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r49-'));
const DB = path.join(TMP, 'school.db');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.R49_PORT || 3789;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SDB, DEMO_DB_PATH: path.join(TMP, 'demo.db') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (name, condition, detail = '') => {
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(method, url, body, noCookie = false) {
  const headers = {};
  if (!noCookie && cookie) headers.Cookie = cookie;
  let payload = null;
  if (body) {
    payload = new URLSearchParams(body).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie && !noCookie) cookie = setCookie.split(';')[0];
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '', type: r.headers.get('content-type') || '' };
}

(async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const db = new Database(DB);
  const control = new Database(SDB);
  control.prepare("UPDATE tenants SET custom_domain=?,custom_domain_status='VERIFIED' WHERE id=1")
    .run('portal-r49.example');
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303, String(r.status));
  const activeTa = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1')
    || one('SELECT * FROM tahun_ajaran ORDER BY id DESC LIMIT 1');
  if (!activeTa) throw new Error('test database has no academic year');
  const oldTa = one("SELECT * FROM tahun_ajaran WHERE nama='2025/2026 R49 Uji'")
    || (run("INSERT INTO tahun_ajaran (nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (?,?,?,0)",
      '2025/2026 R49 Uji', '2025-07-01', '2026-06-30'), one("SELECT * FROM tahun_ajaran WHERE nama='2025/2026 R49 Uji'"));
  const slug = String((one("SELECT v FROM settings WHERE k='portal_base_slug'") || {}).v || '')
    || String((one("SELECT v FROM settings WHERE k='portal_slug'") || {}).v || '').split('/')[0] || 'sekolah';

  run('INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,1,?)',
    'Kelas Uji R49', 'Kelas Uji R49', 'VII', activeTa.id, '2026-07-01 08:00:00');
  const kelas = one("SELECT * FROM kelas WHERE nama='Kelas Uji R49' ORDER BY id DESC LIMIT 1");
  const siswaIds = [];
  for (const [i, nama] of ['Siswa R49 Alfa', 'Siswa R49 Beta'].entries()) {
    run('INSERT INTO siswa (nisn,nama,jenis_kelamin,kelas_id,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?,?)',
      '949000000' + i, nama, 'L', kelas.id, activeTa.id, 'aktif', '2026-07-01 08:00:00');
    const id = Number(one('SELECT last_insert_rowid() id').id);
    siswaIds.push(id);
    run('INSERT INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,sumber,created_at) VALUES (?,?,?,?,?)',
      id, kelas.id, activeTa.id, 'manual', '2026-07-01 08:00:00');
  }
  run("INSERT INTO kelas (nama,nama_kelas,tingkat,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,1,?)",
    'Kelas Historis R49', 'Kelas Historis R49', 'VI', oldTa.id, '2025-07-01 08:00:00');
  const oldKelas = one("SELECT * FROM kelas WHERE nama='Kelas Historis R49' ORDER BY id DESC LIMIT 1");
  run('INSERT INTO siswa_penempatan (siswa_id,kelas_id,tahun_ajaran_id,sumber,created_at) VALUES (?,?,?,?,?)',
    siswaIds[0], oldKelas.id, oldTa.id, 'manual', '2025-07-01 08:00:00');
  run('INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,?)',
    'SPP R49 Historis', 'bulanan', oldTa.id, 1, '2025-07-01 08:00:00');
  const oldGroup = one("SELECT * FROM iuran_grup WHERE nama='SPP R49 Historis' ORDER BY id DESC LIMIT 1");
  run('INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,?)', oldGroup.id, 7, 100000, '');
  run('INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,?)', oldGroup.id, 8, 100000, '');
  run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
    oldGroup.id, siswaIds[0], oldTa.id, 200000, '2025-07-01 08:00:00');
  const oldTag = one('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?', oldGroup.id, siswaIds[0]);
  run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, oldTag.id, siswaIds[0], '2025-07-15', 100000, 0, 100000, 'tunai', 'posted', '2025-07-15 09:00:00');

  run('INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,?)',
    'Iuran R49 Sekarang', 'nonbulanan', activeTa.id, 1, '2026-07-01 08:00:00');
  const group = one("SELECT * FROM iuran_grup WHERE nama='Iuran R49 Sekarang' ORDER BY id DESC LIMIT 1");
  run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
    group.id, siswaIds[0], activeTa.id, 500000, '2026-07-01 08:00:00');
  const tag = one('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?', group.id, siswaIds[0]);
  run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, tag.id, siswaIds[0], '2026-08-03', 200000, 0, 200000, 'transfer', 'posted', '2026-08-03 09:00:00');

  r = await req('GET', `/portal-publik?ta_kelas=${activeTa.id}`);
  ok('menu Portal Publik menampilkan pengaturan link per kelas', r.status === 200
    && r.text.includes('Portal Iuran Wali Kelas') && r.text.includes('Kelas Uji R49')
    && r.text.includes('Generate Link'));
  r = await req('POST', '/kelas/publik', { id: kelas.id, ta: activeTa.id, aksi: 'generate' });
  ok('generate link kelas melalui pengaturan Portal Publik', r.status === 303);
  const token1 = String(one('SELECT public_token FROM kelas WHERE id=?', kelas.id).public_token || '');
  ok('token publik kelas acak 24 karakter dan aktif', /^[a-f0-9]{24}$/.test(token1)
    && Number(one('SELECT is_public FROM kelas WHERE id=?', kelas.id).is_public) === 1);
  r = await req('GET', `/portal-publik?ta_kelas=${activeTa.id}`);
  ok('tautan, tombol salin, dan panel QR tersedia', r.text.includes(`/publik/kelas/${token1}`)
    && r.text.includes('data-copy=') && r.text.includes(`/publik/kelas/${token1}/qr`));
  const classPath = `/${slug}/publik/kelas/${token1}`;
  ok('tautan kelas memakai domain custom terverifikasi, bukan host aplikasi',
    r.text.includes(`https://portal-r49.example${classPath}`));
  ok('QR kelas juga dibuka dari domain custom terverifikasi',
    r.text.includes(`src="https://portal-r49.example${classPath}/qr"`));

  const publicUrl = `/${slug}/publik/kelas/${token1}`;
  r = await req('GET', publicUrl, null, true);
  ok('portal kelas dibuka tanpa sesi', r.status === 200);
  ok('tampilan awal memuat daftar siswa kelas', r.text.includes('Siswa R49 Alfa') && r.text.includes('Siswa R49 Beta'));
  ok('rekap menampilkan grand total dibayar, belum dibayar, dan sisa', r.text.includes('Grand Total Sudah Dibayar')
    && r.text.includes('Grand Total Belum Dibayar') && r.text.includes('Total Tagihan Tersisa'));
  ok('grand total sesuai pembayaran lintas TA', r.text.includes('Rp 300.000') && r.text.includes('Rp 400.000'));
  ok('nama siswa menjadi tautan ke rincian', r.text.includes(`siswa=${siswaIds[0]}`));
  ok('nama siswa menjadi tautan tanpa ikon mata',
    !r.text.includes('kelas-public-eye') &&
    new RegExp(`<a class="t-strong" href="[^"]*siswa=${siswaIds[0]}">Siswa R49 Alfa</a>`).test(r.text));
  r = await req('GET', `${publicUrl}?q=Beta`, null, true);
  ok('filter nama hanya menampilkan siswa cocok dan totalnya menyesuaikan', r.status === 200
    && r.text.includes('Siswa R49 Beta') && !r.text.includes('Siswa R49 Alfa')
    && /Rp 0/.test((r.text.match(/Grand Total Sudah Dibayar[\s\S]{0,120}/) || [''])[0]));
  r = await req('GET', `${publicUrl}?siswa=${siswaIds[0]}`, null, true);
  ok('rincian siswa memuat seluruh tahun pelajaran dalam scroll box', r.text.includes('Rincian Iuran Seluruh Tahun Pelajaran')
    && r.text.includes(oldTa.nama) && r.text.includes('overflow:auto'));
  ok('detail siswa tidak lagi menampilkan kotak rekap seluruh siswa',
    !r.text.includes('id="tblKelasPublik"') && !r.text.includes('Rekap Seluruh Siswa —'));
  ok('rincian siswa menampilkan pembayaran dan sisa per grup/bulan', r.text.includes('SPP R49 Historis — Juli')
    && r.text.includes('Iuran R49 Sekarang') && r.text.includes('Riwayat pembayaran grup (1)')
    && r.text.includes('3 Agustus 2026'));

  r = await req('GET', `/${slug}/publik/kelas/${token1}/qr`, null, true);
  ok('barcode QR dihasilkan lokal sebagai SVG', r.status === 200 && /image\/svg\+xml/.test(r.type) && /<svg/.test(r.text));
  r = await req('POST', '/kelas/publik', { id: kelas.id, ta: activeTa.id, aksi: 'regen' });
  const token2 = String(one('SELECT public_token FROM kelas WHERE id=?', kelas.id).public_token || '');
  ok('generate ulang membatalkan tautan lama', r.status === 303 && token2 !== token1
    && (await req('GET', publicUrl, null, true)).status === 404);
  r = await req('POST', '/kelas/publik', { id: kelas.id, ta: activeTa.id, aksi: 'toggle', aktif: '0' });
  ok('nonaktifkan tautan menyebabkan akses 404', r.status === 303
    && (await req('GET', `/${slug}/publik/kelas/${token2}`, null, true)).status === 404);

  const errors = log.split('\n').filter(line => /Unhandled|TypeError|ReferenceError|SyntaxError/.test(line));
  ok('server tidak mencatat error runtime', errors.length === 0, errors.slice(0, 2).join(' | '));
  db.close();
  control.close();
  srv.kill('SIGTERM');
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => {
  console.error('FATAL', e);
  console.log(log.slice(-4000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
