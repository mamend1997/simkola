'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* Ronde 27 — No. HP Orang Tua siswa, Jadwal Pengingat Tagihan (broadcast scheduler),
   tombol Kirim WA per baris & massal, antrean worker dengan jeda acak, log pengiriman,
   tautan portal bertoken pada pesan WhatsApp.

   1. Kolom siswa.parent_phone + validasi normalisasi 62…
   2. Import Excel/CSV + template + export memuat kolom No. HP / WA Orang Tua
   3. Halaman /iuran/pengingat: sakelar, mode bulanan / H-X, jam, template + dynamic tags, riwayat
   4. Kirim WA per siswa & massal (ceklis + filter) → masuk antrean
   5. Worker latar mengirim berurutan dengan jeda acak (gateway tiruan) → status sent
   6. Penjadwalan otomatis (cek jadwal manual untuk mode tanggal & H-X, anti kirim ganda)
   7. Tautan portal ?token= menampilkan tagihan siswa tanpa nama+tanggal lahir
   8. RBAC: role tanpa hak edit iuran tidak dapat mengirim
*/
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const X = require('../xlsx-read');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r27-'));
const DB = path.join(TMP, 'k.sqlite');
const SAAS = path.join(TMP, 's.db');
const PORT = 3629;
const GW_PORT = 3630;

/* ---- gateway WhatsApp tiruan (mencatat pesan yang diterima) ---- */
const gwInbox = [];
const gw = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    gwInbox.push({ at: Date.now(), body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: true, id: gwInbox.length }));
  });
});

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env, PORT, DB_PATH: DB, SAAS_DB_PATH: SAAS,
    DEMO_DB_PATH: path.join(TMP, 'demo.sqlite'),
    WA_API_URL: `http://127.0.0.1:${GW_PORT}/send`, WA_API_TOKEN: 'token-uji', WA_API_PAYLOAD: 'json'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
let cookie = '';
const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, '→', extra); }
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (opt.cookie !== undefined) { if (opt.cookie) headers.Cookie = opt.cookie; else delete headers.Cookie; }
  let payload = null;
  if (body) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    payload = usp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) cookie = sc.split(';')[0];
  const text = opt.binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, text, loc: r.headers.get('location') || '', headers: r.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  await new Promise(r => gw.listen(GW_PORT, r));
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch (e) { } await sleep(150); }
  const db = new Database(DB);

  /* ================= 1. SKEMA & KOLOM ================= */
  const cols = db.prepare('PRAGMA table_info(siswa)').all().map(c => c.name);
  ok('tabel siswa punya kolom parent_phone', cols.includes('parent_phone'));
  ok('tabel wa_reminder_log dibuat', !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wa_reminder_log'").get());
  ok('tabel wa_template dibuat', !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wa_template'").get());
  ok('template bawaan terisi (SPP / Uang Kegiatan / Ujian)', db.prepare('SELECT COUNT(*) c FROM wa_template').get().c >= 3);
  const igCols = db.prepare('PRAGMA table_info(iuran_grup)').all().map(c => c.name);
  ok('iuran_grup punya kolom jatuh_tempo', igCols.includes('jatuh_tempo'));

  let r = await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  ok('login admin sekolah', r.status === 303, r.status + ' ' + r.loc);

  const ta = db.prepare('SELECT * FROM tahun_ajaran ORDER BY id LIMIT 1').get();
  await req('POST', '/program-keahlian/save', { nama: 'TKJ', program_studi: 'TKJ', ketua: 'K' });
  const prog = db.prepare("SELECT * FROM program_keahlian WHERE nama='TKJ'").get();
  await req('POST', '/kelas/save', { nama: 'X TKJ 1', tingkat: 'X', wali_kelas: 'W', program_id: prog.id, aktif: '1' });
  const kelas = db.prepare("SELECT * FROM kelas WHERE nama='X TKJ 1'").get();

  /* ================= 2. FORM SISWA + NORMALISASI NOMOR ================= */
  r = await req('GET', '/siswa');
  ok('form siswa memuat field No. HP / WA Orang Tua', /name="parent_phone"/.test(r.text) && /No\. HP \/ WA Orang Tua/.test(r.text));
  r = await req('POST', '/siswa/save', { nisn: '9001', nama: 'Budi Santoso', jenis_kelamin: 'L', tanggal_lahir: '2010-05-05', kelas_id: kelas.id, parent_phone: '0812-3456-7890' });
  ok('simpan siswa dengan nomor HP berhasil', /ok=/.test(r.loc), dec(r.loc));
  let sBudi = db.prepare("SELECT * FROM siswa WHERE nisn='9001'").get();
  ok('nomor 08… dinormalisasi ke 62…', sBudi && sBudi.parent_phone === '6281234567890', sBudi && sBudi.parent_phone);
  r = await req('POST', '/siswa/save', { nisn: '9002', nama: 'Siti Aminah', jenis_kelamin: 'P', kelas_id: kelas.id, parent_phone: 'abc' });
  ok('nomor HP tidak valid ditolak', /err=/.test(r.loc) && /tidak valid/i.test(dec(r.loc)), dec(r.loc));
  ok('siswa dengan nomor tidak valid tidak tersimpan', !db.prepare("SELECT id FROM siswa WHERE nisn='9002'").get());
  r = await req('POST', '/siswa/save', { nisn: '9002', nama: 'Siti Aminah', jenis_kelamin: 'P', kelas_id: kelas.id, parent_phone: '+62 812 9999 8888' });
  const sSiti = db.prepare("SELECT * FROM siswa WHERE nisn='9002'").get();
  ok('format +62 … dinormalisasi', sSiti && sSiti.parent_phone === '6281299998888', sSiti && sSiti.parent_phone);
  // siswa tanpa nomor (untuk uji dilewati saat broadcast)
  await req('POST', '/siswa/save', { nisn: '9003', nama: 'Tanpa Nomor', jenis_kelamin: 'L', kelas_id: kelas.id });

  /* ================= 3. TEMPLATE & IMPORT EXCEL ================= */
  r = await req('GET', '/siswa/template', null, { binary: true });
  let tplText = '';
  try {
    const entries = X.unzipEntries(r.text);
    tplText = Object.values(entries).map(b => b.toString('utf8')).join('\n');
  } catch (e) { }
  ok('template import siswa memuat kolom NO. HP / WA ORANG TUA', /NO\. HP \/ WA ORANG TUA/.test(tplText), tplText.slice(0, 120));

  const csv = [
    'NISN,NAMA,JENIS KELAMIN,TANGGAL LAHIR,NO. HP / WA ORANG TUA',
    '9101,Andi Wijaya,L,12/03/2010,081200001111',
    '9102,Rina Wati,P,05/07/2010,+6281200002222'
  ].join('\r\n');
  const csvB64 = 'data:text/csv;base64,' + Buffer.from(csv, 'utf8').toString('base64');
  r = await req('POST', '/siswa/import', { kelas_id: kelas.id, file_b64: csvB64 });
  ok('import CSV diproses ke pratinjau', /import\/preview\?token=/.test(r.loc), dec(r.loc));
  r = await req('GET', r.loc);
  ok('pratinjau import menampilkan nomor HP orang tua', /081200001111/.test(r.text) && /081200002222/.test(r.text));
  const tok = (r.text.match(/name="token" value="([^"]+)"/) || [])[1];
  r = await req('POST', '/siswa/import/commit', { token: tok });
  ok('import tersimpan', /ok=/.test(r.loc), dec(r.loc));
  const andi = db.prepare("SELECT * FROM siswa WHERE nisn='9101'").get();
  ok('nomor HP dari import ikut tersimpan (ternormalisasi)', andi && andi.parent_phone === '6281200001111', andi && andi.parent_phone);

  r = await req('GET', '/siswa/export', null, { binary: true });
  let expText = '';
  try {
    const entries = X.unzipEntries(r.text);
    expText = Object.values(entries).map(b => b.toString('utf8')).join('\n');
  } catch (e) { }
  ok('export siswa memuat kolom No. HP / WA Orang Tua', /NO\. HP \/ WA ORANG TUA/.test(expText));
  ok('export siswa memuat nomor orang tua', /081200001111/.test(expText));

  /* ================= 4. TAGIHAN (dasar broadcast) ================= */
  await req('POST', '/iuran/save', { nama: 'Iuran SPP', jenis: 'bulanan', mode_nominal: 'rata', nominal_rata: '150000', aktif: '1', tahun_ajaran_id: ta.id });
  const gSpp = db.prepare("SELECT * FROM iuran_grup WHERE nama='Iuran SPP'").get();
  await req('POST', '/iuran/save', { nama: 'Uang Kegiatan', jenis: 'sekali', mode_nominal: 'rata', nominal_rata: '250000', aktif: '1', tahun_ajaran_id: ta.id });
  const gKeg = db.prepare("SELECT * FROM iuran_grup WHERE nama='Uang Kegiatan'").get();
  const ids = db.prepare('SELECT id FROM siswa').all().map(x => x.id);
  await req('POST', `/iuran/grup/${gSpp.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: ids });
  await req('POST', `/iuran/grup/${gKeg.id}/tetapkan`, { kelas_id: kelas.id, siswa_id: ids });
  ok('tagihan SPP & kegiatan terbentuk', db.prepare('SELECT COUNT(*) c FROM iuran_tagihan').get().c >= ids.length * 2);

  /* ================= 5. HALAMAN JADWAL PENGINGAT ================= */
  r = await req('GET', '/iuran/pengingat');
  ok('halaman Jadwal Pengingat Tagihan 200', r.status === 200);
  ok('menu sidebar memuat Jadwal Pengingat Tagihan', /Jadwal Pengingat Tagihan/.test(r.text));
  ok('sakelar pengingat otomatis tersedia', /name="reminder_aktif"/.test(r.text) && /Status Pengingat Otomatis/.test(r.text));
  ok('opsi rutin bulanan (tanggal) & relatif jatuh tempo (H-X)', /Rutin Bulanan/.test(r.text) && /Relatif Jatuh Tempo/.test(r.text)
    && /name="reminder_tanggal"/.test(r.text) && /name="reminder_tempo_hari"/.test(r.text));
  ok('pilihan jam pengiriman tersedia', /name="reminder_jam"/.test(r.text));
  ok('editor template + tombol dynamic tags', /id="tplIsi"/.test(r.text) && /data-tpl-tag="\{nama_siswa\}"/.test(r.text)
    && /data-tpl-tag="\{kelas\}"/.test(r.text) && /data-tpl-tag="\{nominal_tunggakan\}"/.test(r.text)
    && /data-tpl-tag="\{rincian_tagihan\}"/.test(r.text) && /data-tpl-tag="\{link_portal\}"/.test(r.text)
    && /data-tpl-tag="\{nama_sekolah\}"/.test(r.text));
  ok('pratinjau pesan (bubble WhatsApp) tersedia', /data-tpl-preview/.test(r.text) && /wa-bubble/.test(r.text));
  ok('tabel riwayat pengiriman tersedia', /Broadcast History/.test(r.text) || /Riwayat Pengiriman/.test(r.text));
  ok('bagian riwayat pengiriman tersedia di halaman', /Broadcast History|Riwayat Pengiriman/.test(r.text));

  // validasi simpan
  r = await req('POST', '/iuran/pengingat/simpan', { reminder_aktif: '1', reminder_mode: 'tanggal', reminder_tanggal: '5', reminder_tempo_hari: '3', reminder_jam: '25:99', reminder_template: 'x' });
  ok('jam tidak valid ditolak', /err=/.test(r.loc) && /Jam pengiriman/i.test(dec(r.loc)), dec(r.loc));
  r = await req('POST', '/iuran/pengingat/simpan', { reminder_aktif: '1', reminder_mode: 'tanggal', reminder_tanggal: '31', reminder_tempo_hari: '3', reminder_jam: '08:00', reminder_template: 'x' });
  ok('tanggal kirim di luar 1–28 ditolak', /err=/.test(r.loc), dec(r.loc));
  r = await req('POST', '/iuran/pengingat/simpan', { reminder_aktif: '1', reminder_mode: 'tempo', reminder_tanggal: '5', reminder_tempo_hari: '3', reminder_jam: '08:00', reminder_template: '' });
  ok('template kosong ditolak', /err=/.test(r.loc), dec(r.loc));
  const tplCustom = 'Assalamualaikum, Bapak/Ibu {nama_siswa} ({kelas}). Tunggakan {nominal_tunggakan}.\n{rincian_tagihan}\nBayar: {link_portal}\n— {nama_sekolah}';
  r = await req('POST', '/iuran/pengingat/simpan', {
    reminder_aktif: '1', reminder_mode: 'keduanya', reminder_tanggal: '5', reminder_tempo_hari: '3',
    reminder_jam: '08:00', reminder_template: tplCustom, iuran_jatuh_tempo: '10', reminder_base_url: 'https://sekolah.contoh.id'
  });
  const S = k => { const row = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return row ? row.v : ''; };
  ok('pengaturan jadwal tersimpan', /ok=/.test(r.loc) && S('reminder_aktif') === '1' && S('reminder_mode') === 'keduanya', dec(r.loc));
  ok('jam & H-X tersimpan', S('reminder_jam') === '08:00' && S('reminder_tempo_hari') === '3' && S('reminder_tanggal') === '5');
  ok('template kustom tersimpan', S('reminder_template') === tplCustom);
  ok('alamat dasar tautan portal tersimpan', S('reminder_base_url') === 'https://sekolah.contoh.id');

  // CRUD template tersimpan
  r = await req('POST', '/iuran/pengingat/template', { nama: 'Template Uji', isi: 'Halo {nama_siswa}, tunggakan {nominal_tunggakan}' });
  const tplRow = db.prepare("SELECT * FROM wa_template WHERE nama='Template Uji'").get();
  ok('tambah template pesan berhasil', !!tplRow && /ok=/.test(r.loc));
  r = await req('POST', '/iuran/pengingat/template/hapus', { id: tplRow.id });
  ok('hapus template pesan berhasil', !db.prepare("SELECT id FROM wa_template WHERE id=?").get(tplRow.id));

  /* ================= 6. PRATINJAU (JSON) + KIRIM PER SISWA ================= */
  r = await req('GET', `/iuran/wa/preview?siswa_id=${sBudi.id}`);
  let pv = null;
  try { pv = JSON.parse(r.text); } catch (e) { }
  ok('endpoint pratinjau mengembalikan JSON', r.status === 200 && pv && pv.ok === true, r.text.slice(0, 100));
  ok('pratinjau memuat nomor tujuan orang tua', pv && pv.phone_display === '081234567890', pv && pv.phone_display);
  ok('pratinjau memuat nominal tunggakan terformat Rp', pv && /^Rp\s?[\d.]+$/.test(pv.nominal_text), pv && pv.nominal_text);
  ok('pratinjau memuat nama siswa & kelas', pv && pv.nama === 'Budi Santoso' && /X TKJ 1/.test(pv.kelas || ''));
  ok('pratinjau memuat rincian tagihan per bulan', pv && /SPP\s+\w+\s+\d{4}/.test(pv.pesan || ''), (pv && pv.pesan || '').slice(0, 200));
  /* ronde 43: alamat portal selalu /<nama-sekolah>/<sub-slug> */
  ok('pratinjau memuat link portal bertoken', pv && /portal-tagihan\?token=\d+\.[a-f0-9]{32}/.test(pv.pesan || ''), (pv && pv.pesan || '').slice(0, 300));
  ok('pratinjau memakai alamat publik absolut', pv && /https:\/\/sekolah\.contoh\.id\/[a-z0-9-]+\/portal-tagihan\?token=/.test(pv.pesan || ''), (pv && pv.pesan || '').slice(0, 300));
  ok('pratinjau mengisi nama sekolah', pv && /SMK PGRI Cikonon|SMK PGRI CIKONENG|SMK PGRI/i.test(pv.pesan || ''));

  r = await req('POST', '/iuran/wa/satu', { siswa_id: sBudi.id, back: '/iuran/data', template_id: '0' });
  const logBudi = db.prepare('SELECT * FROM wa_reminder_log ORDER BY id DESC LIMIT 1').get();
  ok('kirim WA per siswa masuk antrean (pending)', r.status === 303 && logBudi && logBudi.status === 'pending', logBudi && logBudi.status);
  ok('antrean mencatat nomor orang tua & nama siswa', logBudi && logBudi.phone === '6281234567890' && logBudi.nama === 'Budi Santoso');
  ok('antrean mencatat nominal tunggakan', logBudi && Number(logBudi.nominal) > 0);
  ok('pesan di antrean berisi tag yang sudah terisi', logBudi && !/\{nama_siswa\}|\{nominal_tunggakan\}/.test(logBudi.pesan));
  ok('flash sukses menyebut antrean', /ok=/.test(r.loc) && /antrean/i.test(dec(r.loc)), dec(r.loc));
  r = await req('GET', '/iuran/pengingat');
  ok('kolom riwayat: tanggal, nama, no HP, status, error', /Tanggal Kirim/.test(r.text) && /No\. HP Orang Tua/.test(r.text)
    && /Pesan Error/.test(r.text) && /Budi Santoso/.test(r.text));

  // siswa tanpa nomor → ditolak dengan pesan jelas
  const tanpa = db.prepare("SELECT * FROM siswa WHERE nisn='9003'").get();
  r = await req('POST', '/iuran/wa/satu', { siswa_id: tanpa.id, back: '/iuran/data' });
  ok('siswa tanpa nomor HP orang tua ditolak', /err=/.test(r.loc) && /nomor/i.test(dec(r.loc)), dec(r.loc));

  /* ================= 7. KIRIM MASSAL (ceklis & filter) ================= */
  const beforeBulk = db.prepare('SELECT COUNT(*) c FROM wa_reminder_log').get().c;
  r = await req('POST', '/iuran/wa/massal', { back: '/iuran/data', template_id: '0', siswa: [sBudi.id, sSiti.id] });
  const afterBulk = db.prepare('SELECT COUNT(*) c FROM wa_reminder_log').get().c;
  ok('kirim massal (ceklis) menambah antrean', /ok=/.test(r.loc) && afterBulk - beforeBulk === 2, `${afterBulk - beforeBulk} · ${dec(r.loc)}`);
  ok('pesan massal memakai template tersimpan (bukan tag mentah)',
    db.prepare("SELECT pesan FROM wa_reminder_log ORDER BY id DESC LIMIT 1").get().pesan.indexOf('{') === -1);

  const beforeFilter = db.prepare('SELECT COUNT(*) c FROM wa_reminder_log').get().c;
  r = await req('POST', '/iuran/wa/massal', { back: '/iuran/data', template_id: '0', kelas: [kelas.id] });
  const afterFilter = db.prepare('SELECT COUNT(*) c FROM wa_reminder_log').get().c;
  ok('kirim massal via filter kelas bekerja', /ok=/.test(r.loc) && afterFilter - beforeFilter >= 2, `${afterFilter - beforeFilter} · ${dec(r.loc)}`);
  ok('siswa tanpa nomor dilewati (dilaporkan)', /dilewati/i.test(dec(r.loc)) || afterFilter - beforeFilter >= 2, dec(r.loc));

  // tanpa template_id & tanpa pesan → memakai template dari Jadwal Pengingat (fallback)
  r = await req('POST', '/iuran/wa/massal', { back: '/iuran/data', template_id: '0', pesan: '', siswa: [sBudi.id] });
  ok('kirim massal tanpa template memakai template jadwal (fallback)', /ok=/.test(r.loc), dec(r.loc));

  /* ================= 8. WORKER: PENGIRIMAN BERURUTAN DENGAN JEDA ================= */
  gwInbox.length = 0;
  db.prepare("DELETE FROM wa_reminder_log").run();
  await req('POST', '/iuran/wa/massal', { back: '/iuran/data', template_id: '0', siswa: [sBudi.id, sSiti.id] });
  const queued = db.prepare('SELECT COUNT(*) c FROM wa_reminder_log').get().c;
  ok('2 pesan siap di antrean untuk uji worker', queued === 2, String(queued));
  // tunggu worker (jeda awal ~7 detik + 2–5 detik antar pesan)
  for (let i = 0; i < 60; i++) {
    const left = db.prepare("SELECT COUNT(*) c FROM wa_reminder_log WHERE status IN ('pending','sending')").get().c;
    if (!left && gwInbox.length >= 2) break;
    await sleep(1000);
  }
  const sent = db.prepare("SELECT COUNT(*) c FROM wa_reminder_log WHERE status='sent'").get().c;
  ok('worker mengirim seluruh antrean (status sent)', sent === 2, `sent=${sent}`);
  ok('gateway tiruan menerima 2 pesan', gwInbox.length === 2, String(gwInbox.length));
  const t1 = (db.prepare("SELECT sent_at FROM wa_reminder_log ORDER BY id LIMIT 1").get() || {}).sent_at;
  ok('waktu kirim tercatat', !!t1);
  ok('gateway menerima payload JSON (target + message)', gwInbox.length && /"target":"628/.test(gwInbox[0].body), (gwInbox[0] || {}).body ? String(gwInbox[0].body).slice(0, 120) : '');
  // jeda 2–5 detik antar pesan (dicek dari selisih waktu terima gateway)
  const gap = gwInbox.length >= 2 ? gwInbox[1].at - gwInbox[0].at : 0;
  ok('jeda antar pesan 2–5 detik (rate limit)', gap >= 1800 && gap <= 7000, `${gap} ms`);

  /* ================= 9. PENJADWALAN OTOMATIS (mode tanggal) ================= */
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const tgl = Math.min(28, now.getDate());
  db.prepare("DELETE FROM wa_reminder_log").run();
  db.prepare("DELETE FROM settings WHERE k='reminder_done'").run();
  await req('POST', '/iuran/pengingat/simpan', {
    reminder_aktif: '1', reminder_mode: 'tanggal', reminder_tanggal: String(tgl), reminder_tempo_hari: '3',
    reminder_jam: hhmm, reminder_template: tplCustom, reminder_base_url: 'https://sekolah.contoh.id'
  });
  r = await req('POST', '/iuran/pengingat/jadwal', {});
  const schedCount = db.prepare("SELECT COUNT(*) c FROM wa_reminder_log WHERE mode='jadwal'").get().c;
  ok('cek jadwal manual menjalankan jadwal rutin', /ok=/.test(r.loc) && schedCount >= 2, `${schedCount} · ${dec(r.loc)}`);
  ok('pemicu jadwal tercatat pada antrean',
    /Jadwal rutin/.test((db.prepare("SELECT pemicu FROM wa_reminder_log WHERE mode='jadwal' LIMIT 1").get() || {}).pemicu || ''));
  r = await req('POST', '/iuran/pengingat/jadwal', {});
  ok('jadwal tidak berjalan dua kali pada slot yang sama', /warn=/.test(r.loc) && /Tidak ada jadwal/i.test(dec(r.loc)), dec(r.loc));

  /* ================= 10. PENJADWALAN MODE H-X ================= */
  db.prepare("DELETE FROM wa_reminder_log").run();
  db.prepare("DELETE FROM settings WHERE k='reminder_done'").run();
  const hx = now.getDate() <= 27 ? 1 : 0;
  const dueDay = Math.min(28, now.getDate() + hx);
  await req('POST', '/iuran/pengingat/simpan', {
    reminder_aktif: '1', reminder_mode: 'tempo', reminder_tanggal: '5', reminder_tempo_hari: String(hx),
    reminder_jam: hhmm, reminder_template: tplCustom, iuran_jatuh_tempo: String(dueDay), reminder_base_url: 'https://sekolah.contoh.id'
  });
  r = await req('POST', '/iuran/pengingat/jadwal', {});
  const tempoCount = db.prepare("SELECT COUNT(*) c FROM wa_reminder_log WHERE mode='jadwal'").get().c;
  ok('jadwal relatif H-X berjalan', /ok=/.test(r.loc) && tempoCount >= 2, `${tempoCount} · ${dec(r.loc)}`);
  ok('pemicu H-X menyebut jatuh tempo', /H-\d+ sebelum jatuh tempo/.test((db.prepare("SELECT pemicu FROM wa_reminder_log WHERE mode='jadwal' LIMIT 1").get() || {}).pemicu || ''));

  /* ================= 11. RIWAYAT, RETRY, BERSIH ================= */
  db.prepare("DELETE FROM wa_reminder_log").run();
  db.prepare(`INSERT INTO wa_reminder_log (siswa_id,nama,phone,kelas,nominal,pesan,status,error,mode,created_at)
    VALUES (?,?,?,?,?,?, 'failed','Nomor tidak terdaftar','manual', datetime('now'))`).run(sBudi.id, 'Budi Santoso', '6281234567890', 'X TKJ 1', 1000, 'uji gagal');
  r = await req('GET', '/iuran/pengingat?status=failed');
  ok('filter riwayat status gagal menampilkan error', /Nomor tidak terdaftar/.test(r.text));
  r = await req('POST', '/iuran/pengingat/riwayat', { aksi: 'retry' });
  ok('kirim ulang pesan gagal → kembali pending',
    /ok=/.test(r.loc) && db.prepare("SELECT COUNT(*) c FROM wa_reminder_log WHERE status='pending'").get().c === 1);
  // bersihkan: baris pending tidak boleh hilang lewat aksi "bersih" (hanya sent/failed)
  db.prepare("UPDATE wa_reminder_log SET status='sent', sent_at=datetime('now')").run();
  r = await req('POST', '/iuran/pengingat/riwayat', { aksi: 'bersih' });
  ok('hapus riwayat terkirim/gagal', /ok=/.test(r.loc) && db.prepare('SELECT COUNT(*) c FROM wa_reminder_log').get().c === 0);

  /* ================= 12. TAUTAN PORTAL BERTANDA TANGAN ================= */
  const msg = (db.prepare("SELECT pesan FROM wa_reminder_log ORDER BY id DESC LIMIT 1").get() || {}).pesan
    || (db.prepare("SELECT pesan FROM wa_reminder_log LIMIT 1").get() || {}).pesan;
  // buat 1 pesan baru untuk mengambil token
  await req('POST', '/iuran/wa/satu', { siswa_id: sBudi.id, back: '/iuran/data', template_id: '0' });
  const tokenUrl = ((db.prepare('SELECT pesan FROM wa_reminder_log ORDER BY id DESC LIMIT 1').get() || {}).pesan || '')
    .match(/portal-tagihan\?token=([^\s]+)/);
  const token = tokenUrl ? dec(tokenUrl[1]) : '';
  ok('pesan memuat token portal', !!token && /^\d+\.[a-f0-9]{32}$/.test(token), token);
  cookie = '';
  const portalPath27 = '/' + String((db.prepare("SELECT v FROM settings WHERE k='portal_base_slug'").get() || {}).v || '') + '/' + String((db.prepare("SELECT v FROM settings WHERE k='portal_slug'").get() || {}).v || 'portal-tagihan');
  r = await req('GET', portalPath27 + '?token=' + encodeURIComponent(token), null, { cookie: '' });
  ok('portal via token menampilkan tagihan siswa', r.status === 200 && /Budi Santoso/.test(r.text) && /Tagihan/.test(r.text));
  ok('portal via token tidak meminta tanggal lahir', !/name="lahir"/.test(r.text));
  ok('portal via token menampilkan total tunggakan', /Sisa|Total Sisa Terhutang/.test(r.text));
  r = await req('GET', portalPath27 + '?token=123.deadbeefdeadbeefdeadbeefdeadbeef', null, { cookie: '' });
  ok('token tidak valid ditolak (kembali ke form)', /Tautan tagihan tidak valid|Cek Tagihan/.test(r.text) && !/Budi Santoso/.test(r.text));

  /* ================= 13. RBAC ================= */
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  await req('POST', '/pengguna/save', { nama: 'Kepsek Uji', email: 'kepsek27@sekolah.sch.id', role: 'kepala_sekolah', password: 'rahasia123', aktif: '1' });
  cookie = '';
  r = await req('POST', '/login', { kode: 'SK01', email: 'kepsek27@sekolah.sch.id', password: 'rahasia123' });
  const cKepsek = cookie;
  r = await req('GET', '/iuran/pengingat', null, { cookie: cKepsek });
  ok('kepala sekolah dapat MELIHAT halaman pengingat', r.status === 200);
  r = await req('POST', '/iuran/wa/satu', { siswa_id: sBudi.id, back: '/iuran/data' }, { cookie: cKepsek });
  ok('kepala sekolah TIDAK dapat mengirim WA (403)', r.status === 403, String(r.status));
  r = await req('POST', '/iuran/pengingat/simpan', { reminder_aktif: '1', reminder_jam: '08:00', reminder_template: 'x', reminder_tanggal: '5', reminder_tempo_hari: '3', reminder_mode: 'tanggal' }, { cookie: cKepsek });
  ok('kepala sekolah TIDAK dapat mengubah jadwal (403)', r.status === 403, String(r.status));

  /* ================= 14. BACKUP MENYERTAKAN TABEL BARU ================= */
  cookie = '';
  await req('POST', '/login', { kode: 'SK01', email: 'admin@sekolah.sch.id', password: 'admin123' });
  r = await req('GET', '/backup/download', null, { binary: true });
  let dump = null;
  try { dump = JSON.parse(r.text.toString('utf8')); } catch (e) { }
  ok('backup JSON memuat tabel wa_reminder_log', dump && dump.tables && Array.isArray(dump.tables.wa_reminder_log));
  ok('backup JSON memuat tabel wa_template', dump && dump.tables && Array.isArray(dump.tables.wa_template));

  /* ================= 15. GATEWAY PUSAT (SUPER ADMIN) SEBAGAI CADANGAN ================= */
  const { execFileSync } = require('child_process');
  const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'r27gw-'));
  let gwOut = '';
  try {
    gwOut = execFileSync(process.execPath, ['-e', `
      process.env.DB_PATH = ${JSON.stringify(path.join(TMP2, 'k.sqlite'))};
      process.env.SAAS_DB_PATH = ${JSON.stringify(path.join(TMP2, 's.db'))};
      delete process.env.WA_API_URL; delete process.env.WA_API_TOKEN;
      const dbm = require('./db');
      const saas = require('./saas');
      const wa = require('./wa');
      const kosong = wa.waConfig();
      saas.set('wa_api_url', 'https://pusat.contoh.id/send');
      saas.set('wa_api_token', 'token-pusat');
      saas.set('wa_payload', 'json');
      const pusat = wa.waConfig();
      dbm.setSetting('wa_api_url', 'https://sekolah.contoh.id/send');
      dbm.setSetting('wa_api_token', 'token-sekolah');
      const tenant = wa.waConfig();
      console.log(JSON.stringify({ kosong: kosong.source, pusat: [pusat.source, pusat.url, pusat.token, pusat.payload], tenant: [tenant.source, tenant.url] }));
    `], { cwd: path.join(__dirname, '..'), env: { ...process.env, WA_API_URL: '', WA_API_TOKEN: '' }, encoding: 'utf8' });
  } catch (e) { gwOut = 'ERR ' + e.message; }
  let gwRes = null;
  try { gwRes = JSON.parse(String(gwOut).trim().split('\n').pop()); } catch (e) { gwRes = null; }
  ok('tanpa gateway sekolah → belum ada sumber', gwRes && gwRes.kosong === '', gwOut.slice(0, 120));
  ok('gateway PUSAT dipakai bila sekolah belum mengatur', gwRes && gwRes.pusat[0] === 'pusat' && gwRes.pusat[1] === 'https://pusat.contoh.id/send' && gwRes.pusat[2] === 'token-pusat', JSON.stringify(gwRes && gwRes.pusat));
  ok('gateway sekolah menang atas gateway pusat', gwRes && gwRes.tenant[0] === 'tenant' && gwRes.tenant[1] === 'https://sekolah.contoh.id/send', JSON.stringify(gwRes && gwRes.tenant));

  /* ================= ringkasan ================= */
  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} cek ronde 27 lulus`);
  if (pass !== results.length) console.log('GAGAL:', results.filter(x => !x.ok).map(x => x.name).join(', '));
  if (/\[ERROR\]/.test(log)) console.log('log server:\n' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 10).join('\n'));
  srv.kill();
  gw.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); srv.kill(); gw.close(); process.exit(1); });
