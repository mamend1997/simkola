'use strict';
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r50-'));
const DB = path.join(TMP, 'school.db');
const SDB = path.join(TMP, 'saas.db');
const PORT = process.env.R50_PORT || 3790;
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
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') || '' };
}

(async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { }
    await sleep(150);
  }
  const db = new Database(DB);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  let r = await req('POST', '/login', { email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin', r.status === 303, String(r.status));
  const activeTa = one('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id LIMIT 1')
    || one('SELECT * FROM tahun_ajaran ORDER BY id DESC LIMIT 1');
  if (!activeTa) throw new Error('test database has no academic year');
  run('INSERT INTO tahun_ajaran (nama,tanggal_mulai,tanggal_selesai,aktif) VALUES (?,?,?,0)',
    'TA Historis R50', '2025-07-01', '2026-06-30');
  const oldTa = one("SELECT * FROM tahun_ajaran WHERE nama='TA Historis R50'");

  const createBku = (nama, kode, taId, rab) => {
    run(`INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,rab,status,urutan,created_at)
      VALUES (?,'kegiatan',?,?,0,?,'aktif',90,?)`, nama, kode, taId, rab, '2026-07-01 08:00:00');
    return Number(one('SELECT last_insert_rowid() id').id);
  };
  const bkuId = createBku('BKU RAB R50', 'K50', activeTa.id, 1000000);
  const secondBkuId = createBku('BKU Tujuan R50', 'K51', activeTa.id, 0);
  r = await req('POST', '/bku/save', {
    id: bkuId, nama: 'BKU RAB R50', jenis: 'kegiatan', kode: 'K50',
    tahun_ajaran_id: activeTa.id, saldo_awal: '0', rab: '1000000'
  });
  ok('nilai RAB lama tetap tersimpan sebagai fallback sampai rincian dibuat', r.status === 303
    && Number(one('SELECT rab FROM bku WHERE id=?', bkuId).rab) === 1000000);
  run('INSERT INTO siswa (nisn,nama,jenis_kelamin,tahun_ajaran_id,status,created_at) VALUES (?,?,?,?,?,?)',
    '950000001', 'Siswa Uji R50', 'L', oldTa.id, 'aktif', '2025-07-01 08:00:00');
  const siswaId = Number(one('SELECT last_insert_rowid() id').id);
  run('INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,aktif,created_at) VALUES (?,?,?,?,?)',
    'Grup Historis R50', 'nonbulanan', oldTa.id, 1, '2025-07-01 08:00:00');
  const grupId = Number(one('SELECT last_insert_rowid() id').id);
  run('INSERT INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,created_at) VALUES (?,?,?,?,?)',
    grupId, siswaId, oldTa.id, 500000, '2025-07-01 08:00:00');
  const tagihanId = Number(one('SELECT last_insert_rowid() id').id);
  run(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, tagihanId, siswaId, '2025-07-15', 125000, 0, 125000, 'tunai', 'posted', '2025-07-15 09:00:00');
  run('INSERT INTO bku_iuran_grup (bku_id,grup_id) VALUES (?,?)', bkuId, grupId);
  run("INSERT INTO coa (kode,nama,kategori,aktif) VALUES ('R50.01','Belanja RAB R50','pengeluaran',1)");
  const coaId = Number(one("SELECT id FROM coa WHERE kode='R50.01'").id);
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,'pemasukan',300000,'Pemasukan Informasional R50','posted',?)`,
    bkuId, '2026-08-03', '2026-08-03 08:00:00');
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,'pemasukan',125000,'Posting Grup Iuran R50','posted',?)`,
    bkuId, '2026-08-03', '2026-08-03 08:30:00');
  const iuranTrxId = Number(one('SELECT last_insert_rowid() id').id);
  run('UPDATE iuran_bayar SET transaksi_id=?,bku_id=? WHERE tagihan_id=?', iuranTrxId, bkuId, tagihanId);
  run(`INSERT INTO transaksi (bku_id,coa_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,?,'pengeluaran',?,'Belanja RAB R50','posted',?)`, bkuId, coaId, '2026-08-01', 700000, '2026-08-01 09:00:00');
  run(`INSERT INTO transaksi (bku_id,coa_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,?,'pengeluaran',?,'Belanja RAB R50 kedua','posted',?)`, bkuId, coaId, '2026-08-02', 500000, '2026-08-02 09:00:00');

  run('UPDATE bku SET saldo_awal=3150000 WHERE id=?', bkuId);
  r = await req('GET', `/bku/${bkuId}`);
  const openingRow = (r.text.match(/<tr data-opening-row[\s\S]*?<\/tr>/) || [''])[0];
  const trxRows = Array.from(r.text.matchAll(/<tr id="trx\d+">[\s\S]*?<\/tr>/g), m => m[0]);
  const totalRow = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('Saldo Awal Keseluruhan menjumlah saldo manual dan penerimaan grup',
    /SALDO AWAL KESELURUHAN[\s\S]*?<td class="num t-strong">Rp 3\.275\.000<\/td>\s*<td><\/td><td class="num t-strong">Rp 3\.275\.000/.test(openingRow));
  ok('Detail BKU default menempatkan transaksi terbaru di paling bawah',
    trxRows.findIndex(x => x.includes('>Belanja RAB R50</div>'))
      < trxRows.findIndex(x => x.includes('>Belanja RAB R50 kedua</div>')));
  ok('saldo akhir menghitung saldo manual + penerimaan grup - pengeluaran',
    totalRow.includes('Rp 3.275.000') && totalRow.includes('Rp 1.200.000') && totalRow.includes('Rp 2.075.000'));
  ok('Detail BKU merangkum tagihan lintas tahun ajaran', r.status === 200
    && r.text.includes('Ringkasan Grup Iuran Terhubung')
    && r.text.includes('TA Historis R50')
    && r.text.includes('Rp 500.000')
    && r.text.includes('Rp 125.000')
    && r.text.includes('Rp 375.000')
    && r.text.includes(`/iuran/grup/${grupId}`)
    && r.text.includes('Lihat Rincian Grup'));
  ok('detail menjelaskan sumber saldo grup dan tidak lagi menampilkan peringatan selisih',
    r.text.includes('saldo awal manual ditambah total')
      && !r.text.includes('Peringatan: saldo BKU tidak sama dengan penerimaan grup iuran'));
  ok('pemasukan BKU Kegiatan tersembunyi di rincian tetapi tetap tersimpan',
    !r.text.includes('Pemasukan Informasional R50')
      && !r.text.includes('Posting Grup Iuran R50')
      && !!one("SELECT id FROM transaksi WHERE bku_id=? AND uraian='Pemasukan Informasional R50'", bkuId));
  run(`INSERT INTO bku (nama,jenis,kode,tahun_ajaran_id,saldo_awal,status,urutan,created_at)
    VALUES ('BKU Umum R50','umum','U50',?,100000,'aktif',91,'2026-07-01 08:00:00')`, activeTa.id);
  const bkuUmumId = Number(one('SELECT last_insert_rowid() id').id);
  run(`INSERT INTO transaksi (bku_id,tanggal,jenis,nominal,uraian,status,created_at)
    VALUES (?,?,'pemasukan',400000,'Penerimaan BKU Umum R50','posted',?)`,
    bkuUmumId, activeTa.tanggal_mulai, `${activeTa.tanggal_mulai} 09:00:00`);
  const umum = await req('GET', `/bku/${bkuUmumId}`);
  const umumTotalRow = (umum.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('pemasukan pada BKU Umum tetap tampil dan menambah saldo awal manual',
    umum.text.includes('Penerimaan BKU Umum R50')
      && umumTotalRow.includes('Rp 500.000')
      && /Saldo Akhir/.test(umum.text));
  const masterBku = await req('GET', '/bku');
  ok('Master BKU menampilkan saldo manual, penerimaan grup, dan saldo awal keseluruhan',
    masterBku.text.includes('Saldo Awal Manual')
      && masterBku.text.includes('Penerimaan Grup Iuran')
      && masterBku.text.includes('Saldo Awal Keseluruhan')
      && masterBku.text.includes('Pemasukan Menambah Saldo'));
  r = await req('POST', '/bku/save', {
    id: bkuId, nama: 'BKU RAB R50', jenis: 'kegiatan', kode: 'K50',
    tahun_ajaran_id: activeTa.id, saldo_awal: '3150000', rab: '1000000', pemasukan_saldo: '1'
  });
  ok('pengecualian pemasukan transaksi BKU Kegiatan bisa diaktifkan per BKU',
    r.status === 303 && Number(one('SELECT pemasukan_saldo FROM bku WHERE id=?', bkuId).pemasukan_saldo) === 1);
  r = await req('GET', `/bku/${bkuId}`);
  const enabledIncomeTotal = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('pemasukan BKU biasa terpilih tampil dan menambah saldo; posting iuran tidak dihitung dua kali',
    r.text.includes('Pemasukan Informasional R50')
      && !r.text.includes('Posting Grup Iuran R50')
      && enabledIncomeTotal.includes('Rp 3.575.000')
      && enabledIncomeTotal.includes('Rp 2.375.000'));
  r = await req('POST', '/bku/publik', { id: String(bkuId), aksi: 'generate', ta: String(activeTa.id) });
  const bkuPublicToken = String(one('SELECT public_token FROM bku WHERE id=?', bkuId).public_token || '');
  r = await req('GET', `/publik/bku/${bkuPublicToken}`);
  const publicEnabledTotal = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('pemasukan biasa BKU Kegiatan tampil di portal saat pengecualian aktif, tanpa dobel posting iuran',
    r.status === 200 && r.text.includes('Pemasukan Informasional R50')
      && !r.text.includes('Posting Grup Iuran R50')
      && publicEnabledTotal.includes('Rp 3.575.000')
      && publicEnabledTotal.includes('Rp 2.375.000'));
  r = await req('POST', '/bku/save', {
    id: bkuId, nama: 'BKU RAB R50', jenis: 'kegiatan', kode: 'K50',
    tahun_ajaran_id: activeTa.id, saldo_awal: '3150000', rab: '1000000', pemasukan_saldo: '0'
  });
  ok('pengecualian pemasukan BKU Kegiatan dapat dimatikan kembali',
    r.status === 303 && Number(one('SELECT pemasukan_saldo FROM bku WHERE id=?', bkuId).pemasukan_saldo) === 0);
  r = await req('GET', `/publik/bku/${bkuPublicToken}`);
  const publicDisabledTotal = (r.text.match(/<tfoot>[\s\S]*?<\/tfoot>/) || [''])[0];
  ok('portal menyembunyikan pemasukan biasa tetapi tetap menampilkan pengeluaran setelah pengecualian dimatikan',
    r.status === 200 && !r.text.includes('Pemasukan Informasional R50')
      && r.text.includes('Belanja RAB R50')
      && publicDisabledTotal.includes('Rp 2.075.000'));
  r = await req('GET', `/bku/${bkuId}/berita-acara`);
  ok('berita acara merinci saldo manual, penerimaan grup, dan saldo keseluruhan',
    r.status === 200 && r.text.includes('Saldo Awal Manual')
      && r.text.includes('Penerimaan Grup Iuran')
      && r.text.includes('Saldo Awal Keseluruhan')
      && r.text.includes('Rincian Pemasukan Transaksi'));
  ok('RAB lama tetap dibandingkan dengan total pengeluaran', r.text.includes('Melebihi RAB')
    && r.text.includes('Rp 200.000'));
  r = await req('GET', `/bku/${bkuId}/rab`);
  ok('halaman RAB BKU kegiatan tersedia dan bergaya pagu CoA',
    r.status === 200 && r.text.includes('RAB — BKU RAB R50') && r.text.includes('Kode Rekening Belanja'));
  r = await req('POST', `/bku/${bkuId}/rab/save`, { coa_id: String(coaId), pagu: '1000000', keterangan: 'Uji RAB' });
  ok('menyimpan pagu per CoA menggantikan RAB lama', r.status === 303
    && Number(one('SELECT rab FROM bku WHERE id=?', bkuId).rab) === 0
    && Number(one('SELECT pagu FROM bku_rab WHERE bku_id=? AND coa_id=?', bkuId, coaId).pagu) === 1000000);
  r = await req('GET', `/bku/${bkuId}/rab`);
  ok('realisasi RAB otomatis dicocokkan berdasarkan coa_id',
    r.status === 200 && r.text.includes('Rp 1.200.000') && r.text.includes('Melebihi Pagu'));
  r = await req('GET', `/bku/${bkuId}`);
  ok('Detail BKU menampilkan rincian realisasi per rekening', r.text.includes('Belanja RAB R50')
    && r.text.includes('Belum Dianggarkan') === false && r.text.includes('Rp 1.200.000'));
  run('UPDATE transaksi SET nominal=200000 WHERE bku_id=?', bkuId);
  r = await req('GET', `/bku/${bkuId}/rab`);
  ok('RAB kembali dalam pagu setelah realisasi turun', r.text.includes('Dalam RAB'));
  const rabRow = one('SELECT id FROM bku_rab WHERE bku_id=?', bkuId);
  r = await req('POST', `/bku/${bkuId}/rab/delete`, { id: String(rabRow.id) });
  ok('hapus rincian RAB lewat halaman menghapus baris', r.status === 303
    && !one('SELECT id FROM bku_rab WHERE bku_id=?', bkuId));
  r = await req('GET', `/bku/${bkuId}`);
  ok('RAB nol ditampilkan sebagai belum diatur', r.text.includes('RAB belum diatur'));
  ok('master BKU menyediakan tombol RAB per BKU kegiatan',
    (await req('GET', '/bku')).text.includes(`/bku/${bkuId}/rab`));

  r = await req('GET', `/iuran/data/${siswaId}?ta=${oldTa.id}`);
  ok('BKU sasaran grup ditampilkan sebagai tujuan tetap tanpa dropdown pembayaran', r.status === 200
    && r.text.includes(`name="bku_id" value="${bkuId}"`)
    && !r.text.includes('<select name="bku_id"')
    && new RegExp(`data-bku="${bkuId}"`).test(r.text)
    && /data-nonbku-allowed="0"/.test(r.text)
    && !r.text.includes('name="nonbku"'));
  const bayarCountBefore = Number(one('SELECT COUNT(*) c FROM iuran_bayar WHERE tagihan_id=?', tagihanId).c);
  r = await req('POST', '/iuran/bayar', {
    tagihan_id: String(tagihanId), tanggal: '2025-08-01', jumlah: '10000', potongan: '0',
    metode: 'tunai', bku_id: String(bkuId), nonbku: '1', back: `/iuran/data/${siswaId}?ta=${oldTa.id}`
  });
  ok('server menolak Non-BKU palsu untuk BKU sasaran yang pemasukan transaksinya nonaktif',
    r.status === 303 && r.loc.includes('err=') && Number(one('SELECT COUNT(*) c FROM iuran_bayar WHERE tagihan_id=?', tagihanId).c) === bayarCountBefore);
  r = await req('POST', '/iuran/bayar-item', {
    n: '1', key_0: `g:${tagihanId}`, tanggal_0: '2025-08-01', jumlah_0: '10000',
    bku_0: String(bkuId), nonbku_0: '1', back: `/iuran/data/${siswaId}?ta=${oldTa.id}`
  });
  ok('server juga menolak Non-BKU pada pembayaran item massal yang dimanipulasi',
    r.status === 303 && r.loc.includes('err=') && Number(one('SELECT COUNT(*) c FROM iuran_bayar WHERE tagihan_id=?', tagihanId).c) === bayarCountBefore);
  r = await req('POST', '/iuran/bayar', {
    tagihan_id: String(tagihanId), tanggal: '2025-08-01', jumlah: '10000', potongan: '0',
    metode: 'tunai', bku_id: String(secondBkuId), back: `/iuran/data/${siswaId}?ta=${oldTa.id}`
  });
  const enforcedTarget = one('SELECT * FROM iuran_bayar WHERE tagihan_id=? ORDER BY id DESC LIMIT 1', tagihanId);
  ok('server tetap memakai BKU sasaran grup meski POST mengirim BKU lain',
    r.status === 303 && !!enforcedTarget && enforcedTarget.status === 'pending' && Number(enforcedTarget.bku_id) === bkuId);
  if (enforcedTarget) run('DELETE FROM iuran_bayar WHERE id=?', enforcedTarget.id);
  r = await req('POST', '/iuran/bayar-item', {
    n: '1', key_0: `g:${tagihanId}`, tanggal_0: '2025-08-01', jumlah_0: '10000',
    bku_0: String(secondBkuId), nonbku_0: '', back: `/iuran/data/${siswaId}?ta=${oldTa.id}`
  });
  const enforcedItemTarget = one('SELECT * FROM iuran_bayar WHERE tagihan_id=? ORDER BY id DESC LIMIT 1', tagihanId);
  ok('pembayaran massal juga tidak dapat mengganti BKU sasaran grup',
    r.status === 303 && !!enforcedItemTarget && enforcedItemTarget.status === 'pending' && Number(enforcedItemTarget.bku_id) === bkuId);
  if (enforcedItemTarget) run('DELETE FROM iuran_bayar WHERE id=?', enforcedItemTarget.id);
  run('UPDATE bku SET pemasukan_saldo=1 WHERE id=?', bkuId);
  r = await req('GET', `/iuran/data/${siswaId}?ta=${oldTa.id}`);
  ok('Non-BKU tersedia kembali bila pemasukan transaksi BKU sasaran diaktifkan',
    r.status === 200 && r.text.includes('name="nonbku"') && !r.text.includes('<select name="bku_id"'));
  run('UPDATE bku SET pemasukan_saldo=0 WHERE id=?', bkuId);
  r = await req('GET', `/iuran?ta=${activeTa.id}`);
  ok('form grup iuran menyediakan pilihan BKU dan default BKU Umum untuk SPP',
    r.status === 200 && r.text.includes('name="bku_sasaran_id"')
      && /data-default-bku="[1-9]\d*" data-auto-target="1"/.test(r.text));
  const editGroup = target => req('POST', '/iuran/save', {
    id: String(grupId), nama: 'Grup Historis R50', jenis: 'nonbulanan',
    tahun_ajaran_id: String(oldTa.id), aktif: '1', nominal_tunggal: '500000',
    bku_sasaran_id: target
  });
  r = await editGroup(String(secondBkuId));
  ok('edit grup iuran dapat mengatur BKU sasaran', r.status === 303
    && Number(one('SELECT bku_id FROM bku_iuran_grup WHERE grup_id=?', grupId).bku_id) === secondBkuId);
  r = await editGroup('');
  ok('edit grup iuran dapat menghapus BKU sasaran', r.status === 303
    && !one('SELECT bku_id FROM bku_iuran_grup WHERE grup_id=?', grupId));
  r = await req('GET', `/iuran/data/${siswaId}?ta=${oldTa.id}`);
  ok('dropdown BKU kembali muncul hanya bila grup belum memiliki tujuan',
    r.status === 200 && r.text.includes('<select name="bku_id"') && r.text.includes('name="nonbku"'));
  r = await req('POST', '/bku/grup-iuran', { bku_id: secondBkuId, grup_id: String(grupId) });
  ok('Menghubungkan ulang grup memindahkannya dari BKU lama', r.status === 303
    && Number(one('SELECT bku_id FROM bku_iuran_grup WHERE grup_id=?', grupId).bku_id) === secondBkuId);
  ok('tabel relasi BKU–Grup Iuran dan rincian RAB masuk daftar backup',
    require('../backupdata').TABLES.includes('bku_iuran_grup') && require('../backupdata').TABLES.includes('bku_rab'));

  const errors = log.split('\n').filter(line => /Unhandled|TypeError|ReferenceError|SyntaxError/.test(line));
  ok('server tidak mencatat error runtime', errors.length === 0, errors.slice(0, 2).join(' | '));
  db.close();
  srv.kill('SIGTERM');
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n - ' + fails.join('\n - ')); process.exitCode = 1; }
})().catch(e => {
  console.error('FATAL', e);
  console.log(log.slice(-4000));
  try { srv.kill('SIGTERM'); } catch (x) { }
  process.exitCode = 1;
});
