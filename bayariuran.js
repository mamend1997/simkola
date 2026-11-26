'use strict';
/* =====================================================================
   PEMBAYARAN IURAN MANDIRI DARI PORTAL ORANG TUA
   ---------------------------------------------------------------------
   Alur:
     1. Orang tua memilih beberapa item tagihan (SPP per bulan, UKK, …)
        pada portal publik lalu memilih metode:
          · Payment Gateway (QRIS dinamis)  → order dibuat di paygw
          · Transfer manual + unggah bukti  → diverifikasi bendahara
     2. Setiap keranjang disimpan di tabel `iuran_checkout`.
     3. Saat pembayaran dinyatakan lunas (callback gateway / cek status /
        disetujui bendahara), rincian item dipecah menjadi baris
        `iuran_bayar` berstatus 'pending' → otomatis muncul pada menu
        **Antrean Posting Iuran** untuk diposting ke BKU.
     4. Setiap pembayaran (manual maupun gateway) membuat notifikasi
        internal (lonceng) untuk akun bendahara.

   Modul ini TIDAK menyentuh BKU secara langsung — posting ke BKU tetap
   dilakukan bendahara lewat antrean (satu transaksi per grup & tanggal).
   ===================================================================== */
const crypto = require('crypto');
const paygw = require('./paygw');
const lib = require('./lib');

const clean = v => String(v === null || v === undefined ? '' : v).trim();
function errorText(v) {
  if (typeof v === 'string') return clean(v);
  if (v && typeof v === 'object') {
    const direct = v.message || v.error_message || v.error_description || v.detail || v.error;
    if (typeof direct === 'string' && clean(direct)) return clean(direct);
    if (direct && typeof direct === 'object') {
      const nested = errorText(direct);
      if (nested) return nested;
    }
    try {
      const raw = JSON.stringify(v);
      if (raw && raw !== '{}') return raw;
    } catch (e) { /* abaikan */ }
  }
  return clean(v) || 'tidak diketahui';
}

/* ---------- skema (tenant lama yang dibuat sebelum fitur ini) ---------- */
function ensureTables(dbm) {
  const conn = dbm.currentTenantConn() || dbm.db;
  if (!conn || conn.__bayarSchema) return;
  try {
    conn.exec(`CREATE TABLE IF NOT EXISTS iuran_checkout (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siswa_id INTEGER, nama TEXT, kelas TEXT,
      items TEXT, total REAL NOT NULL DEFAULT 0,
      metode TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'menunggu',
      provider TEXT, order_id TEXT, gateway_status TEXT,
      qr_string TEXT, qr_url TEXT, checkout_url TEXT, expires_at TEXT,
      bukti_url TEXT, bukti_nama TEXT, catatan TEXT, alasan TEXT,
      ta_id INTEGER, created_at TEXT, paid_at TEXT, verified_by TEXT, verified_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_iuran_co_status ON iuran_checkout(status, id);
      CREATE INDEX IF NOT EXISTS idx_iuran_co_order ON iuran_checkout(order_id);
      CREATE TABLE IF NOT EXISTS notif (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        untuk TEXT NOT NULL DEFAULT 'super_admin',
        jenis TEXT, judul TEXT, isi TEXT, href TEXT, ref TEXT,
        dibaca INTEGER NOT NULL DEFAULT 0, created_at TEXT, baca_at TEXT, baca_by TEXT);
      CREATE INDEX IF NOT EXISTS idx_notif_baca ON notif(untuk, dibaca, id);`);
    conn.__bayarSchema = true;
  } catch (e) { console.error('[bayar] gagal menyiapkan tabel:', e.message); }
}

/* ---------- konfigurasi gateway ---------- */
function cfg(dbm, saas) {
  const g = (k, d = '') => clean(dbm.getSetting(k, d));
  const sekolah = {
    provider: g('bayar_provider', 'sandbox'),
    mode: g('bayar_mode', 'sandbox'),
    merchant: g('bayar_merchant'),
    key: g('bayar_key'),
    key2: g('bayar_key2'),
    callback: g('bayar_callback'),
    base: g('bayar_base'),
    kasera_api: g('bayar_kasera_api', 'auto') || 'auto',
    expire_menit: Math.max(5, Number(g('bayar_expire_menit', '60')) || 60)
  };
  const punyaKredensial = !!sekolah.key || sekolah.provider === 'sandbox';
  let out = sekolah, sumber = 'sekolah';
  if (!punyaKredensial) {
    // sekolah belum mengisi kredensial sendiri → memakai gateway pusat (Super Admin)
    const pusat = (() => { try { return saas && saas.gatewayCfg ? saas.gatewayCfg() : null; } catch (e) { return null; } })();
    if (pusat && clean(pusat.key)) { out = { ...pusat, expire_menit: sekolah.expire_menit }; sumber = 'pusat'; }
    else sumber = 'belum';
  }
  if (!paygw.PROVIDER_KEYS.includes(out.provider)) out.provider = 'sandbox';
  return { ...out, sumber, siap: sumber !== 'belum' };
}

/** konfigurasi tampilan portal (tanpa kredensial) */
function publicCfg(dbm, saas) {
  const c = cfg(dbm, saas);
  const online = String(dbm.getSetting('bayar_gateway_aktif', '0')) === '1' && c.siap;
  const manual = String(dbm.getSetting('bayar_manual_aktif', '1')) === '1';
  return {
    online, manual,
    provider: c.provider,
    provider_label: (paygw.PROVIDERS.find(p => p.key === c.provider) || {}).label || c.provider,
    sumber: c.sumber,
    qris_image: clean(dbm.getSetting('qris_image')),
    instruksi: dbm.getSetting('bayar_instruksi', 'Transfer sesuai total tagihan yang dipilih, lalu unggah bukti pembayaran.')
  };
}

/* ---------- daftar item tagihan yang masih terhutang ---------- */
function reservedMap(dbm, siswaId) {
  ensureTables(dbm);
  const map = new Map();
  const rows = dbm.db.prepare("SELECT items FROM iuran_checkout WHERE siswa_id=? AND status='menunggu'").all(Number(siswaId) || 0);
  for (const r of rows) {
    let items = [];
    try { items = JSON.parse(r.items || '[]'); } catch (e) { items = []; }
    for (const it of items) {
      const key = Number(it.tagihan_id) + ':' + (Number(it.bulan) || 0);
      map.set(key, (map.get(key) || 0) + Number(it.nominal || 0));
    }
  }
  return map;
}

/**
 * Item tagihan yang masih bisa dibayar (sisa > 0), grup bulanan dipecah per bulan.
 * Nominal dikurangi yang sudah "dipesan" oleh keranjang portal yang belum diverifikasi.
 */
function itemsOf(dbm, siswaId, opts = {}) {
  const tags = dbm.iuranTagihanRows({ siswaId: Number(siswaId) || 0 });
  const reserved = reservedMap(dbm, siswaId);
  const taCache = new Map();
  const taOf = id => {
    if (!id) return null;
    if (!taCache.has(id)) { let t = null; try { t = dbm.tahunById(id); } catch (e) { } taCache.set(id, t); }
    return taCache.get(id);
  };
  const out = [];
  for (const t of tags) {
    if (t.writeoff === 'pemutihan') continue;
    const grouped = t.grup_jenis === 'bulanan';
    if (grouped) {
      const pays = dbm.iuranPaysMap([t.id]).get(t.id) || [];
      const months = dbm.iuranMonthDetail(t.grup_id, pays, t.tingkat || dbm.siswaTingkat(t.siswa_id, t.tahun_ajaran_id));
      if (!months.length) continue;
      for (const m of months) {
        const key = t.id + ':' + m.bulan;
        const sisa = Math.max(0, Number(m.sisa || 0) - (reserved.get(key) || 0));
        if (!(sisa > 0)) continue;
        out.push({
          tagihan_id: t.id, grup_id: t.grup_id, grup_nama: t.grup_nama, grup_jenis: t.grup_jenis,
          bulan: m.bulan, tahun_ajaran_id: t.tahun_ajaran_id || null,
          label: `${t.grup_nama} - ${bulanTahunLabel(m.bulan, taOf(t.tahun_ajaran_id))}`, nominal: sisa
        });
      }
      continue;
    }
    const key = t.id + ':0';
    const sisa = Math.max(0, Number(t.sisa || 0) - (reserved.get(key) || 0));
    if (!(sisa > 0)) continue;
    out.push({
      tagihan_id: t.id, grup_id: t.grup_id, grup_nama: t.grup_nama, grup_jenis: t.grup_jenis,
      bulan: 0, tahun_ajaran_id: t.tahun_ajaran_id || null,
      label: t.grup_nama, nominal: sisa
    });
  }
  return out;
}
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function bulanNama(m) { return BULAN_ID[(Number(m) - 1 + 12) % 12] || '-'; }
/** label bulan mengikuti tahun ajaran grup ("November 2026") */
function bulanTahunLabel(bulan, ta) {
  const b = Number(bulan) || 0;
  const start = String((ta && ta.tanggal_mulai) || '').slice(0, 10);
  const sy = start ? Number(start.slice(0, 4)) : new Date().getFullYear();
  const sm = start ? Number(start.slice(5, 7)) : 7;
  return `${bulanNama(b)} ${b >= sm ? sy : sy + 1}`;
}

/** parse pilihan item dari form (["12:7","15:0"]) → item valid + total */
function pickItems(dbm, siswaId, keys) {
  const all = itemsOf(dbm, siswaId);
  const want = new Set([].concat(keys || []).map(k => String(k).trim()).filter(Boolean));
  const picked = all.filter(it => want.has(it.tagihan_id + ':' + (it.bulan || 0)));
  return { items: picked, total: picked.reduce((a, b) => a + Number(b.nominal || 0), 0) };
}

/* ---------- nota & notifikasi ---------- */
function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function notifyBendahara(dbm, { judul, isi, href, ref, jenis }) {
  try {
    dbm.notifAdd({ untuk: 'super_admin', jenis: jenis || 'iuran', judul, isi, href: href || '/iuran/antrean', ref: ref || '' });
  } catch (e) { }
}

/* ---------- pembuatan keranjang ---------- */
function orderId(tenantId) {
  const t = Number(tenantId) || 1;
  return `IU${t}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function createManual({ dbm, siswa, items, total, buktiUrl, buktiNama, catatan, taId }) {
  ensureTables(dbm);
  const now = lib.nowStamp();
  const info = dbm.db.prepare(`INSERT INTO iuran_checkout
    (siswa_id,nama,kelas,items,total,metode,status,bukti_url,bukti_nama,catatan,ta_id,created_at)
    VALUES (?,?,?,?,?,'manual','menunggu',?,?,?,?,?)`)
    .run(siswa.id, siswa.nama || '', siswa.kelas_nama || '', JSON.stringify(items), total,
      buktiUrl || '', buktiNama || '', String(catatan || ''), taId || null, now);
  const id = Number(info.lastInsertRowid);
  notifyBendahara(dbm, {
    jenis: 'bayar-manual',
    judul: `Pembayaran manual baru — ${siswa.nama || 'siswa'}`,
    isi: `${siswa.nama || 'Siswa'}${siswa.kelas_nama ? ' (' + siswa.kelas_nama + ')' : ''} mengirim pembayaran ${rupiah(total)} `
      + `via transfer manual pada ${now}. Bukti pembayaran sudah dilampirkan dan menunggu verifikasi.`,
    href: '/iuran/antrean#verifikasi', ref: String(id)
  });
  return id;
}

async function createGateway({ dbm, saas, tenant, siswa, items, total, taId, baseUrl }) {
  ensureTables(dbm);
  const c = cfg(dbm, saas);
  if (!c.siap) throw new Error('Payment gateway belum dikonfigurasi sekolah maupun pusat.');
  const oid = orderId(tenant && tenant.id);
  const now = lib.nowStamp();
  const info = dbm.db.prepare(`INSERT INTO iuran_checkout
    (siswa_id,nama,kelas,items,total,metode,status,provider,order_id,gateway_status,ta_id,created_at)
    VALUES (?,?,?,?,?,'gateway','menunggu',?,?,'PENDING',?,?)`)
    .run(siswa.id, siswa.nama || '', siswa.kelas_nama || '', JSON.stringify(items), total,
      c.provider, oid, taId || null, now);
  const id = Number(info.lastInsertRowid);
  const cb = (baseUrl ? String(baseUrl).replace(/\/$/, '') : '') + '/portal/pay/callback?t=' + encodeURIComponent(tenant ? tenant.id : 1);
  const charge = await paygw.createCharge(
    {
      ...c, callback_url: cb, return_url: baseUrl || '',
      /* Kasera Pay: endpoint webhook terpusat (sekolah ditentukan dari nomor pesanan) */
      webhook_url: (baseUrl ? String(baseUrl).replace(/\/$/, '') : '') + '/api/webhook/kasera'
    },
    {
      order_id: oid, amount: total,
      label: `Iuran ${siswa.nama || ''}`.trim(),
      customer: { nama: siswa.nama || 'Orang Tua', phone: siswa.parent_phone || '' }
    }
  );
  if (!charge.ok) {
    const alasan = 'Gagal membuat QRIS: ' + errorText(charge.error);
    dbm.db.prepare("UPDATE iuran_checkout SET status='batal', alasan=? WHERE id=?")
      .run(alasan, id);
    throw new Error(errorText(charge.error) === 'tidak diketahui'
      ? 'Gagal membuat QRIS pada payment gateway.' : errorText(charge.error));
  }
  dbm.db.prepare('UPDATE iuran_checkout SET qr_string=?,qr_url=?,checkout_url=?,expires_at=? WHERE id=?')
    .run(clean(charge.qr_string), clean(charge.qr_url), clean(charge.checkout_url), clean(charge.expires_at), id);
  notifyBendahara(dbm, {
    jenis: 'bayar-gateway',
    judul: `Pembayaran QRIS dibuat — ${siswa.nama || 'siswa'}`,
    isi: `${siswa.nama || 'Siswa'} membuat tagihan QRIS ${rupiah(total)} (${c.provider}) pada ${now}. `
      + 'Status akan otomatis menjadi Lunas setelah gateway mengonfirmasi pembayaran.',
    href: '/iuran/antrean#verifikasi', ref: String(id)
  });
  return id;
}

function byId(dbm, id) { ensureTables(dbm); return dbm.db.prepare('SELECT * FROM iuran_checkout WHERE id=?').get(Number(id) || 0) || null; }
function byOrder(dbm, orderIdRaw) { ensureTables(dbm); return dbm.db.prepare('SELECT * FROM iuran_checkout WHERE order_id=?').get(clean(orderIdRaw)) || null; }
function listPending(dbm, opts = {}) {
  ensureTables(dbm);
  let sql = "SELECT * FROM iuran_checkout WHERE status='menunggu'";
  const args = [];
  if (opts.taId) { sql += ' AND (ta_id=? OR ta_id IS NULL)'; args.push(opts.taId); }
  sql += ' ORDER BY id DESC LIMIT ' + (Number(opts.limit) || 50);
  return dbm.db.prepare(sql).all(...args);
}
function listBySiswa(dbm, siswaId, limit = 12) {
  ensureTables(dbm);
  return dbm.db.prepare('SELECT * FROM iuran_checkout WHERE siswa_id=? ORDER BY id DESC LIMIT ' + (Number(limit) || 12)).all(Number(siswaId) || 0);
}

function cancelGateway(dbm, row) {
  const id = Number(row && row.id) || 0;
  if (!id) throw new Error('Keranjang pembayaran tidak ditemukan.');
  const info = dbm.db.prepare(`UPDATE iuran_checkout
    SET status='batal', alasan='Dibatalkan melalui portal', gateway_status='CANCELLED_BY_USER'
    WHERE id=? AND status='menunggu' AND metode='gateway'`)
    .run(id);
  if (info.changes) return { batal: true, status: 'batal' };
  const current = byId(dbm, id);
  if (!current) throw new Error('Keranjang pembayaran tidak ditemukan.');
  return { batal: false, status: current.status };
}

/* ---------- pelunasan ---------- */
/** pilih BKU sasaran: BKU aktif pertama (bukan buku pembantu otomatis) pada tahun ajaran terkait */
function defaultBku(dbm, taId) {
  const rows = dbm.db.prepare(`SELECT id FROM bku WHERE COALESCE(auto_mode,0)=0 AND status='aktif'
    AND (tahun_ajaran_id=? OR ? IS NULL) ORDER BY jenis DESC, urutan, id LIMIT 1`).get(taId || null, taId || null);
  if (rows) return rows.id;
  const any = dbm.db.prepare("SELECT id FROM bku WHERE COALESCE(auto_mode,0)=0 ORDER BY tahun_ajaran_id DESC, urutan LIMIT 1").get();
  return any ? any.id : null;
}

/**
 * Tandai keranjang LUNAS dan pecah item menjadi baris iuran_bayar (status 'pending').
 * Idempoten: keranjang yang sudah lunas tidak diproses ulang.
 */
function applyPaid(dbm, row, opts = {}) {
  ensureTables(dbm);
  const c = byId(dbm, row.id);
  if (!c) throw new Error('Keranjang pembayaran tidak ditemukan.');
  if (c.status === 'lunas') return { sudah: true, baris: 0 };
  if (c.status === 'ditolak') throw new Error('Keranjang ini sudah ditolak.');
  let items = [];
  try { items = JSON.parse(c.items || '[]'); } catch (e) { items = []; }
  if (!items.length) throw new Error('Keranjang tidak memuat item tagihan.');
  const now = lib.nowStamp();
  const tanggal = lib.todayISO();
  const ins = dbm.db.prepare(`INSERT INTO iuran_bayar
    (tagihan_id,siswa_id,tanggal,jumlah,potongan,dibayar,metode,keterangan,bku_id,transaksi_id,status,kwitansi_no,print_count,created_by,created_at,posted_at,bulan)
    VALUES (?,?,?,?,0,?,?,?,?,NULL,'pending','',0,NULL,?,NULL,?)`);
  let n = 0;
  dbm.db.transaction(() => {
    for (const it of items) {
      const tagihanId = Number(it.tagihan_id) || 0;
      if (!tagihanId) continue;
      const t = dbm.db.prepare('SELECT * FROM iuran_tagihan WHERE id=?').get(tagihanId);
      if (!t) continue;
      const nominal = Number(it.nominal) || 0;
      if (!(nominal > 0)) continue;
      const bku = defaultBku(dbm, it.tahun_ajaran_id || c.ta_id || t.tahun_ajaran_id);
      ins.run(tagihanId, t.siswa_id || c.siswa_id, tanggal, nominal, nominal,
        'transfer', `Pembayaran portal ${c.metode === 'gateway' ? 'QRIS ' + (c.provider || '') : 'transfer manual'}`.trim(),
        bku, now, Number(it.bulan) || null);
      n++;
    }
    dbm.db.prepare("UPDATE iuran_checkout SET status='lunas', paid_at=?, verified_by=?, verified_at=?, gateway_status=? WHERE id=?")
      .run(now, String(opts.oleh || (c.metode === 'gateway' ? 'Payment Gateway' : 'Bendahara')),
        now, opts.gatewayStatus || c.gateway_status || 'PAID', c.id);
    dbm.notifAdd({
      untuk: 'super_admin', jenis: 'bayar-lunas',
      judul: `Pembayaran portal LUNAS — ${c.nama || 'siswa'}`,
      isi: `${c.nama || 'Siswa'}${c.kelas ? ' (' + c.kelas + ')' : ''} • ${rupiah(c.total)} • `
        + `${c.metode === 'gateway' ? 'QRIS ' + (c.provider || '') : 'transfer manual'} — sudah masuk Antrean Posting Iuran (${n} baris).`,
      href: '/iuran/antrean', ref: String(c.id)
    });
  })();
  return { sudah: false, baris: n };
}

function reject(dbm, id, alasan, oleh) {
  const c = byId(dbm, id);
  if (!c) throw new Error('Keranjang pembayaran tidak ditemukan.');
  if (c.status === 'lunas') throw new Error('Pembayaran ini sudah lunas dan tidak bisa ditolak.');
  dbm.db.prepare("UPDATE iuran_checkout SET status='ditolak', alasan=?, verified_by=?, verified_at=? WHERE id=?")
    .run(String(alasan || 'Bukti pembayaran tidak sah'), String(oleh || ''), lib.nowStamp(), c.id);
  dbm.notifAdd({
    untuk: 'super_admin', jenis: 'bayar-ditolak',
    judul: `Pembayaran portal ditolak — ${c.nama || 'siswa'}`,
    isi: `${c.nama || 'Siswa'} • ${rupiah(c.total)} — alasan: ${String(alasan || '-').slice(0, 160)}`,
    href: '/iuran/antrean', ref: String(c.id)
  });
  return true;
}

/** cek status ke gateway (dipanggil tombol "Cek Status" pada halaman portal) */
async function syncGateway(dbm, saas, row) {
  const c = byId(dbm, row.id);
  if (!c) throw new Error('Keranjang pembayaran tidak ditemukan.');
  if (c.status !== 'menunggu' || c.metode !== 'gateway') return { status: c.status, paid: c.status === 'lunas' };
  const conf = cfg(dbm, saas);
  const st = await paygw.checkStatus(conf, { order_id: c.order_id });
  if (st.ok) dbm.db.prepare('UPDATE iuran_checkout SET gateway_status=? WHERE id=?').run(clean(st.status) || 'PENDING', c.id);
  if (st.paid) {
    applyPaid(dbm, c, { oleh: 'Payment Gateway', gatewayStatus: st.status });
    return { status: 'lunas', paid: true, baris: 1 };
  }
  return { status: c.status, paid: false, gateway_status: st.status || '', error: st.error || '' };
}

module.exports = {
  ensureTables, cfg, publicCfg, itemsOf, pickItems, createManual, createGateway,
  byId, byOrder, listPending, listBySiswa, cancelGateway, applyPaid, reject, syncGateway,
  notifyBendahara, defaultBku, orderId, bulanNama, bulanTahunLabel, BULAN_ID, rupiah
};
