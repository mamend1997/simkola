'use strict';
/**
 * ==================================================================
 * PENGINGAT TAGIHAN via WHATSAPP (broadcast scheduler + queue worker)
 * ------------------------------------------------------------------
 * Bagian ini menangani:
 *   · konfigurasi jadwal  : mode rutin bulanan (tanggal X) / H-X jatuh tempo,
 *                           jam kirim, template pesan dinamis
 *   · penyusunan pesan    : variabel {nama_siswa} {kelas} {nominal_tunggakan}
 *                           {rincian_tagihan} {link_portal} {nama_sekolah} … *   · antrean pengiriman  : baris `wa_reminder_log` (pending → sent/failed)
 *                           diproses worker latar dengan jeda acak 2–5 detik
 *                           agar tidak menabrak rate-limit WhatsApp
 *   · tautan portal siswa : token HMAC (aman, tidak bisa ditebak) untuk ?token=
 *
 * Semua fungsi menerima `dbm` dan HARUS dipanggil di dalam konteks tenant
 * (request handler atau dbm.runAsTenant) — worker di bawah melakukan ini
 * otomatis untuk setiap sekolah.
 * ==================================================================
 */
const crypto = require('crypto');
const lib = require('./lib');
const wa = require('./wa');
const env = require('./env');

/* ---------------- variabel dinamis pesan ---------------- */
const VARS = [
  { tag: '{nama_siswa}', label: 'Nama Siswa', note: 'Nama lengkap siswa' },
  { tag: '{kelas}', label: 'Kelas', note: 'Tingkat dan nama kelas siswa' },
  { tag: '{nominal_tunggakan}', label: 'Nominal Tunggakan', note: 'Total sisa tagihan aktif (format Rp)' },
  { tag: '{rincian_tagihan}', label: 'Rincian Tagihan', note: 'Daftar iuran yang belum dibayar, satu per baris' },
  { tag: '{link_portal}', label: 'Link Portal', note: 'Tautan portal tagihan khusus siswa ini' },
  { tag: '{nama_sekolah}', label: 'Nama Sekolah', note: 'Nama resmi sekolah' },
  { tag: '{nisn}', label: 'NISN', note: 'Nomor induk siswa nasional' },
  { tag: '{tanggal}', label: 'Tanggal Kirim', note: 'Tanggal pesan dibuat (format Indonesia)' }
];

const DEFAULT_TEMPLATE = [
  'Yth. Orang Tua dari {nama_siswa} ({kelas}),',
  '',
  'Kami menginformasikan bahwa total tunggakan iuran sekolah sebesar {nominal_tunggakan}.',
  '',
  'Rincian tagihan:',
  '{rincian_tagihan}',
  '',
  'Rincian tagihan dan pembayaran dapat diakses melalui link: {link_portal}',
  '',
  'Terima kasih.',
  '{nama_sekolah}'
].join('\n');

const STATUS = {
  pending: ['Menunggu', 'amber'],
  sending: ['Mengirim', 'blue'],
  sent: ['Terkirim', 'green'],
  failed: ['Gagal', 'red']
};

/* ---------------- konfigurasi ---------------- */
function config(dbm) {
  const g = (k, d) => String(dbm.getSetting(k, d) === '' ? d : dbm.getSetting(k, d));
  const num = (k, d, lo, hi) => {
    const v = Number(String(g(k, d)).replace(/[^\d-]/g, ''));
    if (!Number.isFinite(v)) return d;
    return Math.min(hi, Math.max(lo, v));
  };
  const jam = /^\d{1,2}:\d{2}$/.test(g('reminder_jam', '08:00')) ? g('reminder_jam', '08:00') : '08:00';
  const mode = ['tanggal', 'tempo', 'keduanya'].includes(g('reminder_mode', 'tanggal')) ? g('reminder_mode', 'tanggal') : 'tanggal';
  return {
    aktif: g('reminder_aktif', '0') === '1',
    mode,
    tanggal: num('reminder_tanggal', 5, 1, 28),
    tempoHari: num('reminder_tempo_hari', 3, 0, 30),
    jam: jam.padStart(5, '0'),
    template: g('reminder_template', DEFAULT_TEMPLATE) || DEFAULT_TEMPLATE,
    baseUrl: g('reminder_base_url', '').replace(/\/+$/, ''),
    jatuhTempo: num('iuran_jatuh_tempo', 10, 1, 28),
    retensi: num('wa_log_retensi', 90, 7, 3650),
    last: g('reminder_last', '')
  };
}

function doneSlots(dbm) {
  try {
    const arr = JSON.parse(dbm.getSetting('reminder_done', '[]') || '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) { return []; }
}
function addDoneSlot(dbm, key) {
  const list = doneSlots(dbm).concat([String(key)]).slice(-80);
  dbm.setSetting('reminder_done', JSON.stringify(list));
}

/** validasi + simpan konfigurasi; mengembalikan pesan error atau null */
function saveConfig(dbm, body) {
  const b = body || {};
  const mode = String(b.reminder_mode || 'tanggal');
  if (!['tanggal', 'tempo', 'keduanya'].includes(mode)) return 'Mode pengingat tidak dikenal.';
  const jam = String(b.reminder_jam || '').trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(jam)) return 'Jam pengiriman tidak valid (contoh: 08:00).';
  const tanggal = Number(b.reminder_tanggal || 0);
  if (!(tanggal >= 1 && tanggal <= 28)) return 'Tanggal kirim rutin harus antara 1 dan 28.';
  const tempo = Number(b.reminder_tempo_hari || 0);
  if (!(tempo >= 0 && tempo <= 30)) return 'Nilai H-X harus antara 0 dan 30 hari.';
  // template boleh tidak dikirim (disimpan terpisah lewat /template-utama)
  const tpl = b.reminder_template === undefined ? null : String(b.reminder_template || '').trim();
  if (tpl !== null) {
    if (!tpl) return 'Template pesan tidak boleh kosong.';
    if (tpl.length > 4000) return 'Template pesan terlalu panjang (maksimal 4000 karakter).';
  }
  const jatuh = Number(b.iuran_jatuh_tempo || 0);
  if (b.iuran_jatuh_tempo !== undefined && !(jatuh >= 1 && jatuh <= 28)) return 'Tanggal jatuh tempo harus antara 1 dan 28.';
  const base = String(b.reminder_base_url || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\/[^\s/]+/i.test(base)) return 'Alamat publik harus diawali http:// atau https:// (tanpa garis miring di akhir).';
  dbm.setSetting('reminder_aktif', b.reminder_aktif ? '1' : '0');
  dbm.setSetting('reminder_mode', mode);
  dbm.setSetting('reminder_tanggal', String(tanggal));
  dbm.setSetting('reminder_tempo_hari', String(tempo));
  dbm.setSetting('reminder_jam', jam.padStart(5, '0'));
  if (tpl !== null) dbm.setSetting('reminder_template', tpl);
  if (b.reminder_base_url !== undefined) dbm.setSetting('reminder_base_url', base);
  if (b.iuran_jatuh_tempo !== undefined) dbm.setSetting('iuran_jatuh_tempo', String(jatuh));
  if (b.wa_log_retensi !== undefined) {
    const r = Number(b.wa_log_retensi);
    if (Number.isFinite(r) && r >= 7) dbm.setSetting('wa_log_retensi', String(Math.round(r)));
  }
  return null;
}

/* ---------------- template tersimpan ---------------- */
function templateRows(dbm) {
  try { return dbm.db.prepare('SELECT * FROM wa_template ORDER BY urutan, id').all(); } catch (e) { return []; }
}
function templateById(dbm, id) {
  const n = Number(id) || 0;
  if (!n) return null;
  try { return dbm.db.prepare('SELECT * FROM wa_template WHERE id=?').get(n) || null; } catch (e) { return null; }
}
function templateSave(dbm, body) {
  const nama = String((body || {}).nama || '').trim();
  const isi = String((body || {}).isi || '').trim();
  if (!nama) return { err: 'Nama template wajib diisi.' };
  if (!isi) return { err: 'Isi template wajib diisi.' };
  const id = Number((body || {}).id) || 0;
  const now = lib.nowStamp();
  if (id) {
    dbm.db.prepare('UPDATE wa_template SET nama=?, isi=? WHERE id=?').run(nama.slice(0, 80), isi.slice(0, 4000), id);
    return { id };
  }
  const urut = (dbm.db.prepare('SELECT COALESCE(MAX(urutan),0)+1 n FROM wa_template').get() || {}).n || 1;
  const info = dbm.db.prepare('INSERT INTO wa_template (nama,isi,urutan,aktif,created_at) VALUES (?,?,?,1,?)')
    .run(nama.slice(0, 80), isi.slice(0, 4000), urut, now);
  return { id: Number(info.lastInsertRowid) };
}
function templateDelete(dbm, id) {
  const row = templateById(dbm, id);
  if (!row) return false;
  dbm.db.prepare('DELETE FROM wa_template WHERE id=?').run(Number(id));
  return row;
}

/* ---------------- tautan portal per siswa ---------------- */
function secret(dbm) {
  let s = String(dbm.getSetting('portal_token_secret', '') || '').trim();
  if (!s) {
    s = crypto.randomBytes(24).toString('hex');
    dbm.setSetting('portal_token_secret', s);
  }
  return s;
}
function portalToken(dbm, siswaId) {
  const id = Number(siswaId) || 0;
  if (!id) return '';
  const sig = crypto.createHmac('sha256', secret(dbm)).update('siswa:' + id).digest('hex').slice(0, 32);
  return `${id}.${sig}`;
}
function verifyPortalToken(dbm, tok) {
  const m = /^(\d{1,12})\.([a-f0-9]{32})$/.exec(String(tok || '').trim());
  if (!m) return 0;
  const want = crypto.createHmac('sha256', secret(dbm)).update('siswa:' + m[1]).digest('hex').slice(0, 32);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(want, 'utf8'), Buffer.from(m[2], 'utf8'))) return 0;
  } catch (e) { return 0; }
  return Number(m[1]);
}
/**
 * Alamat dasar publik ABSOLUT untuk tautan di pesan WhatsApp.
 * Urutan: setting reminder_base_url → APP_BASE_URL (.env) → host permintaan (req) + base path.
 */
function absBase(dbm, req) {
  const cfg = config(dbm);
  if (cfg.baseUrl) return cfg.baseUrl;
  if (env.baseUrl()) return env.baseUrl();
  if (req) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host) {
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        || (/^(localhost|127\.|0\.0\.0\.0)/.test(host) ? 'http' : 'https');
      return proto + '://' + host + String(req.BASE || '');
    }
  }
  return '';
}
function portalLink(dbm, siswaId, opts = {}) {
  const cfg = config(dbm);
  const base = String(opts.baseUrl || cfg.baseUrl || env.baseUrl() || '').replace(/\/+$/, '');
  const slug = (() => { try { return dbm.portalSlugs().siswa; } catch (e) { return 'portal'; } })();
  const path = `/${slug}?token=${encodeURIComponent(portalToken(dbm, siswaId))}`;
  return base ? base + path : path;
}

/* ---------------- perhitungan tunggakan ---------------- */
const BULAN_NAMA = lib.BULAN;
function bulanTahun(dbm, bulan, taId) {
  const b = Number(bulan) || 0;
  const ta = taId ? dbm.tahunById(taId) : null;
  const start = String((ta && ta.tanggal_mulai) || '').slice(0, 10);
  const sy = start ? Number(start.slice(0, 4)) : new Date().getFullYear();
  const sm = start ? Number(start.slice(5, 7)) : 7;
  return `${BULAN_NAMA[(b - 1 + 12) % 12] || '-'} ${b >= sm ? sy : sy + 1}`;
}
/**
 * Daftar tunggakan aktif seorang siswa (semua tahun pelajaran, hanya sisa > 0).
 * Grup bulanan dijabarkan per bulan (SPP - November 2026).
 */
function outstanding(dbm, siswaId) {
  const rows = dbm.iuranTagihanRows({ siswaId });
  const items = [];
  for (const t of rows) {
    if (Number(t.sisa || 0) <= 0) continue;
    if (t.grup_jenis === 'bulanan') {
      const pays = dbm.iuranPaysMap([t.id]).get(t.id) || [];
      const months = dbm.iuranMonthDetail(t.grup_id, pays);
      const list = months.length ? months : [{ bulan: null, sisa: Number(t.sisa || 0) }];
      for (const m of list) {
        if (Number(m.sisa || 0) <= 0) continue;
        const label = m.bulan ? `${t.grup_nama} ${bulanTahun(dbm, m.bulan, t.tahun_ajaran_id)}` : t.grup_nama;
        items.push({ label, sisa: Number(m.sisa || 0), grup: t.grup_nama, grupId: Number(t.grup_id), taId: t.tahun_ajaran_id });
      }
    } else {
      items.push({ label: t.grup_nama, sisa: Number(t.sisa || 0), grup: t.grup_nama, grupId: Number(t.grup_id), taId: t.tahun_ajaran_id });
    }
  }
  items.sort((a, b) => String(a.taId || '').localeCompare(String(b.taId || '')) || a.label.localeCompare(b.label));
  const total = items.reduce((a, x) => a + x.sisa, 0);
  return { total, items, rows };
}

function rincianText(items, max = 12) {
  const list = (items || []).slice(0, max);
  const lines = list.map(i => `- ${i.label}: ${lib.rupiah(i.sisa)}`);
  if ((items || []).length > max) lines.push(`- … dan ${items.length - max} tagihan lainnya`);
  return lines.join('\n') || '- (tidak ada tunggakan)';
}

/* ---------------- penyusunan pesan ---------------- */
function fillTemplate(tpl, vars) {
  return String(tpl == null ? '' : tpl).replace(/\{([a-z_]+)\}/gi, (m, key) => {
    const v = vars[String(key).toLowerCase()];
    return v === undefined ? m : String(v);
  });
}
/**
 * Susun pesan untuk seorang siswa.
 * `siswa` = baris tabel siswa (butuh id, nama, nisn, kelas_nama/kelas).
 */
function buildMessage(dbm, siswa, opts = {}) {
  if (!siswa || !siswa.id) return null;
  const cfg = config(dbm);
  const tpl = opts.template || cfg.template || DEFAULT_TEMPLATE;
  const out = outstanding(dbm, siswa.id);
  const settings = dbm.settingsAll();
  const vars = {
    nama_siswa: String(siswa.nama || '').trim() || '-',
    kelas: String(siswa.kelas_nama || siswa.kelas || '').trim() || '-',
    nisn: String(siswa.nisn || '').trim() || '-',
    nominal_tunggakan: lib.rupiah(out.total),
    rincian_tagihan: rincianText(out.items),
    link_portal: portalLink(dbm, siswa.id, { baseUrl: opts.baseUrl }),
    nama_sekolah: String(settings.sekolah_nama || 'Sekolah').trim(),
    tanggal: lib.tglID(lib.todayISO())
  };
  return {
    pesan: fillTemplate(tpl, vars),
    vars,
    nominal: out.total,
    items: out.items,
    phone: lib.normPhone(siswa.parent_phone || siswa.phone || ''),
    nama: siswa.nama,
    kelas: vars.kelas
  };
}

/* ---------------- penerima (recipients) ---------------- */
/**
 * Daftar siswa yang punya tunggakan + nomor orang tua.
 * Filter: taId, kelasId (array), tingkat (array), siswaIds (array), grupId (array).
 */
function recipients(dbm, opts = {}) {
  const rows = dbm.iuranTagihanRows({
    taId: opts.taId || undefined,
    kelasId: opts.kelasId,
    tingkat: opts.tingkat,
    siswaIds: opts.siswaIds,
    grupId: opts.grupId,
    aktifOnly: true
  });
  const seen = new Map();
  for (const r of rows) {
    const sid = Number(r.siswa_id);
    if (!sid) continue;
    if (!seen.has(sid)) {
      seen.set(sid, {
        id: sid, nama: r.siswa_nama, nisn: r.nisn, kelas_nama: r.kelas_nama,
        parent_phone: r.parent_phone, sisa: 0, groups: new Set()
      });
    }
    const rec = seen.get(sid);
    rec.sisa += Number(r.sisa || 0);
    rec.groups.add(Number(r.grup_id));
  }
  return [...seen.values()].filter(x => x.sisa > 0);
}

/* ---------------- antrean (queue) ---------------- */
function batchId() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }

/**
 * Masukkan daftar siswa ke antrean pengiriman.
 * items: [{ siswa_id, nama, phone, kelas, pesan, nominal }]
 * Mengembalikan { queued, tanpaNomor, batch }.
 */
function enqueue(dbm, items, opts = {}) {
  const list = [].concat(items || []);
  const mode = String(opts.mode || 'manual');
  const pemicu = String(opts.pemicu || 'Kirim manual').slice(0, 120);
  const batch = batchId();
  const now = lib.nowStamp();
  const ins = dbm.db.prepare(`INSERT INTO wa_reminder_log
    (siswa_id,nama,phone,kelas,nominal,pesan,status,mode,pemicu,batch,created_at)
    VALUES (?,?,?,?,?,?,'pending',?,?,?,?)`);
  let queued = 0, tanpaNomor = 0;
  dbm.db.transaction(() => {
    for (const it of list) {
      const phone = lib.normPhone(it.phone);
      if (!phone || !it.pesan) { tanpaNomor++; continue; }
      ins.run(Number(it.siswa_id) || null, String(it.nama || ''), phone, String(it.kelas || ''),
        Number(it.nominal || 0), String(it.pesan).slice(0, 4000), mode, pemicu, batch, now);
      queued++;
    }
  })();
  return { queued, tanpaNomor, batch };
}

/** susun + antrekan pengingat untuk sekumpulan siswa (pengirim manual/terjadwal) */
function enqueueForSiswa(dbm, siswaRows, opts = {}) {
  const items = [];
  let tanpaNomor = 0;
  for (const s of siswaRows) {
    const m = buildMessage(dbm, s, opts);
    if (!m) continue;
    if (!m.phone) { tanpaNomor++; continue; }
    if (!(m.nominal > 0) && !opts.allowZero) continue;
    items.push({ siswa_id: s.id, nama: m.nama, phone: m.phone, kelas: m.kelas, pesan: m.pesan, nominal: m.nominal });
  }
  const r = enqueue(dbm, items, opts);
  return { queued: r.queued, tanpaNomor: tanpaNomor + r.tanpaNomor, batch: r.batch };
}

function claimNext(dbm) {
  const row = dbm.db.prepare("SELECT * FROM wa_reminder_log WHERE status='pending' ORDER BY id LIMIT 1").get();
  if (!row) return null;
  const upd = dbm.db.prepare("UPDATE wa_reminder_log SET status='sending' WHERE id=? AND status='pending'").run(row.id);
  if (!upd.changes) return null;
  return row;
}
async function sendRow(dbm, row) {
  const res = await wa.sendWA(row.phone, row.pesan);
  const now = lib.nowStamp();
  if (res && res.ok) {
    dbm.db.prepare("UPDATE wa_reminder_log SET status='sent',error=NULL,sent_at=? WHERE id=?").run(now, row.id);
  } else {
    const err = String((res && res.reason) || 'Gagal mengirim').slice(0, 300);
    dbm.db.prepare("UPDATE wa_reminder_log SET status='failed',error=?,sent_at=? WHERE id=?").run(err, now, row.id);
  }
  return res;
}

/** pulihkan baris yang tertinggal pada status 'sending' (mis. server restart) */
function recoverStuck(dbm) {
  try {
    const info = dbm.db.prepare("UPDATE wa_reminder_log SET status='pending' WHERE status='sending'").run();
    return info.changes || 0;
  } catch (e) { return 0; }
}

/* ---------------- worker latar (jeda acak 2–5 detik) ---------------- */
let workerTimer = null;
const WORKER = { minDelay: 2000, maxDelay: 5000, idleDelay: 15000 };

async function processOne(dbm, saas) {
  let done = false;
  for (const t of saas.allTenants()) {
    try {
      done = await dbm.runAsTenant(t, async () => {
        const row = claimNext(dbm);
        if (!row) return false;
        await sendRow(dbm, row);
        return true;
      });
    } catch (e) {
      console.error('[wa-reminder]', e.message);
      done = false;
    }
    if (done) break;
  }
  return done;
}

/** mulai worker periodik (idempoten) */
function startWorker(dbm, saas) {
  if (workerTimer) return;
  for (const t of saas.allTenants()) {
    try { dbm.runAsTenant(t, () => recoverStuck(dbm)); } catch (e) { }
  }
  const loop = async () => {
    let processed = false;
    try { processed = await processOne(dbm, saas); } catch (e) { console.error('[wa-reminder]', e.message); }
    const wait = processed
      ? WORKER.minDelay + Math.floor(Math.random() * (WORKER.maxDelay - WORKER.minDelay + 1))
      : WORKER.idleDelay;
    workerTimer = setTimeout(loop, wait);
    if (workerTimer.unref) workerTimer.unref();
  };
  workerTimer = setTimeout(loop, 7000);
  if (workerTimer.unref) workerTimer.unref();
}
function stopWorker() { if (workerTimer) { clearTimeout(workerTimer); workerTimer = null; } }

/* ---------------- penjadwalan otomatis ---------------- */
function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function sameDate(a, b) { return isoDate(a) === isoDate(b); }

/** grup iuran yang jatuh tempo H-X hari ini (mempertimbangkan bulan ini & bulan depan) */
function dueGroups(dbm, now, hx) {
  const cfg = config(dbm);
  const out = [];
  let groups = [];
  try { groups = dbm.db.prepare('SELECT id,nama,jatuh_tempo,aktif FROM iuran_grup WHERE aktif=1').all(); } catch (e) { groups = []; }
  for (const g of groups) {
    const day = Math.min(28, Math.max(1, Number(g.jatuh_tempo) || cfg.jatuhTempo));
    for (const offset of [0, 1]) {
      const due = new Date(now.getFullYear(), now.getMonth() + offset, day);
      const send = new Date(due.getFullYear(), due.getMonth(), due.getDate() - hx);
      if (sameDate(send, now)) { out.push({ id: Number(g.id), nama: g.nama, due: isoDate(due) }); break; }
    }
  }
  return out;
}

/**
 * Cek apakah jadwal harus berjalan pada `now` (default: sekarang).
 * Mengembalikan array slot yang due: [{ key, mode, pemicu, grupIds? }]
 */
function dueSlots(dbm, now) {
  const cfg = config(dbm);
  if (!cfg.aktif) return [];
  const d = now || new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const [hh, mm] = cfg.jam.split(':').map(Number);
  const target = hh * 60 + (mm || 0);
  // toleransi 15 menit agar jadwal tidak terlewat bila server sibuk/restart
  if (mins < target || mins > target + 15) return [];
  const done = doneSlots(dbm);
  const today = isoDate(d);
  const slots = [];
  if ((cfg.mode === 'tanggal' || cfg.mode === 'keduanya') && d.getDate() === cfg.tanggal) {
    const key = `${today} ${cfg.jam} tanggal`;
    if (!done.includes(key)) slots.push({ key, mode: 'tanggal', pemicu: `Jadwal rutin tanggal ${cfg.tanggal} pukul ${cfg.jam}` });
  }
  if (cfg.mode === 'tempo' || cfg.mode === 'keduanya') {
    const gs = dueGroups(dbm, d, cfg.tempoHari);
    const key = `${today} ${cfg.jam} tempo`;
    if (gs.length && !done.includes(key)) {
      slots.push({ key, mode: 'tempo', pemicu: `H-${cfg.tempoHari} sebelum jatuh tempo (${gs.map(g => g.nama).join(', ')})`, grupIds: gs.map(g => g.id) });
    }
  }
  return slots;
}

/**
 * Jalankan jadwal yang due (dipanggil cron/interval). Aman dipanggil berulang:
 * slot yang sudah dijalankan dicatat di setting `reminder_done`.
 */
function runSchedule(dbm, now) {
  const slots = dueSlots(dbm, now);
  const results = [];
  for (const slot of slots) {
    let recips;
    if (slot.grupIds && slot.grupIds.length) recips = recipients(dbm, { grupId: slot.grupIds });
    else recips = recipients(dbm, {});
    const r = enqueueForSiswa(dbm, recips, { mode: 'jadwal', pemicu: slot.pemicu });
    addDoneSlot(dbm, slot.key);
    dbm.setSetting('reminder_last', lib.nowStamp());
    try {
      dbm.logAudit(null, 'PENGINGAT WA', 'iuran', `Jadwal otomatis: ${slot.pemicu} → ${r.queued} pesan masuk antrean${r.tanpaNomor ? `, ${r.tanpaNomor} tanpa nomor` : ''}`);
    } catch (e) { }
    results.push({ ...slot, queued: r.queued, tanpaNomor: r.tanpaNomor });
  }
  return results;
}

let schedTimer = null;
function startScheduler(dbm, saas) {
  if (schedTimer) return;
  const tick = () => {
    for (const t of saas.allTenants()) {
      try {
        dbm.runAsTenant(t, () => {
          const r = runSchedule(dbm, new Date());
          if (r.length) console.log(`[wa-reminder] ${t.school_code}: ${r.map(x => x.queued).reduce((a, b) => a + b, 0)} pesan dijadwalkan`);
        });
      } catch (e) { console.error('[wa-reminder-jadwal]', e.message); }
    }
  };
  schedTimer = setInterval(tick, 60 * 1000);
  if (schedTimer.unref) schedTimer.unref();
  setTimeout(tick, 20000).unref();
}
function stopScheduler() { if (schedTimer) { clearInterval(schedTimer); schedTimer = null; } }

/* ---------------- riwayat / log ---------------- */
function logRows(dbm, opts = {}) {
  const wh = [], args = [];
  if (opts.status && STATUS[opts.status]) { wh.push('status=?'); args.push(opts.status); }
  if (opts.q) { wh.push('(nama LIKE ? OR phone LIKE ?)'); args.push('%' + opts.q + '%', '%' + opts.q + '%'); }
  const limit = Math.min(500, Math.max(10, Number(opts.limit) || 100));
  args.push(limit);
  return dbm.db.prepare(`SELECT * FROM wa_reminder_log ${wh.length ? 'WHERE ' + wh.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args);
}
function logStats(dbm) {
  const out = { total: 0, pending: 0, sending: 0, sent: 0, failed: 0 };
  try {
    for (const r of dbm.db.prepare('SELECT status, COUNT(*) c FROM wa_reminder_log GROUP BY status').all()) {
      out[r.status] = r.c; out.total += r.c;
    }
  } catch (e) { }
  return out;
}
function retryFailed(dbm) {
  const info = dbm.db.prepare("UPDATE wa_reminder_log SET status='pending', error=NULL WHERE status='failed'").run();
  return info.changes || 0;
}
function clearLogs(dbm, onlyDone) {
  const info = onlyDone
    ? dbm.db.prepare("DELETE FROM wa_reminder_log WHERE status IN ('sent','failed')").run()
    : dbm.db.prepare("DELETE FROM wa_reminder_log WHERE status<>'sending'").run();
  return info.changes || 0;
}

/** simpan hanya template utama (dipakai form editor template) */
function saveTemplate(dbm, raw) {
  const tpl = String(raw == null ? '' : raw).trim();
  if (!tpl) return 'Template pesan tidak boleh kosong.';
  if (tpl.length > 4000) return 'Template pesan terlalu panjang (maksimal 4000 karakter).';
  dbm.setSetting('reminder_template', tpl);
  return null;
}

module.exports = {
  VARS, DEFAULT_TEMPLATE, STATUS, config, saveConfig, saveTemplate,
  templateRows, templateById, templateSave, templateDelete,
  portalToken, verifyPortalToken, portalLink, absBase,
  outstanding, rincianText, fillTemplate, buildMessage, recipients,
  enqueue, enqueueForSiswa, claimNext, sendRow, recoverStuck,
  startWorker, stopWorker, processOne, WORKER,
  dueSlots, dueGroups, runSchedule, startScheduler, stopScheduler, doneSlots,
  logRows, logStats, retryFailed, clearLogs
};
