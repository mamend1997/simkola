'use strict';
const printcfg = require('../printcfg');
/* Modul Iuran Siswa: grup, penetapan, pembayaran, kwitansi, antrean posting BKU, import dinamis */
const X = require('../xlsx-read');
const impcache = require('../impcache');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, xlsxBuffer, num, terbilangRupiah, BULAN } = lib;
  const BULAN_TA = dbm.BULAN_TA; // [7..12,1..6]

  const GROUP_LABEL = { bulanan: 'Bulanan', nonbulanan: 'Non-Bulanan' };
  const STATUS_LABEL = {
    lunas: ['Terbayar', 'green'], sebagian: ['Sebagian', 'amber'], belum: ['Belum', 'gray'],
    pemutihan: ['Di-pemutihan', 'blue'], tak_tertagih: ['Tak Tertagih', 'red']
  };
  function statusBadge(st) {
    const s = STATUS_LABEL[st] || [st, 'gray'];
    return ui.badge(s[0], s[1]);
  }
  /** status pembayaran iuran: pending (antrean BKU) · posted · manual (data saja, non-BKU) · void */
  function bayarStatusBadge(st, sumber) {
    if (st === 'beasiswa' || sumber === 'beasiswa') return ui.badge('Beasiswa (Otomatis)', 'green');
    if (st === 'posted') return ui.badge('Terposting', 'green');
    if (st === 'void') return ui.badge('Void', 'red');
    if (st === 'manual' || st === 'nonbku') return ui.badge('Data Saja (Non-BKU)', 'blue');
    return ui.badge('Antrean Posting', 'amber');
  }
  function bayarStatusText(st, sumber) {
    if (st === 'beasiswa' || sumber === 'beasiswa') return 'Beasiswa (Otomatis)';
    if (st === 'posted') return 'Terposting';
    if (st === 'void') return 'Void';
    if (st === 'manual' || st === 'nonbku') return 'Data Saja (Non-BKU)';
    return 'Antrean Posting';
  }
  /** tagihan yang dikunci karena dibayar otomatis oleh modul Beasiswa */
  const isLocked = t => Number(t && t.beasiswa_locked) === 1;
  function bulanLabel(b) { return BULAN[(Number(b) - 1 + 12) % 12] || '-'; }
  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }
  function readSheet(b64) {
    const raw = String(b64 || '');
    if (!raw) throw new Error('Pilih berkas Excel/CSV terlebih dahulu.');
    const m = raw.match(/^data:([^;]*);base64,([\s\S]*)$/);
    const buf = Buffer.from(m ? m[2] : raw, 'base64');
    if (!buf.length) throw new Error('Berkas kosong atau gagal dibaca.');
    return (buf[0] === 0x50 && buf[1] === 0x4b) ? X.readXlsx(buf) : X.readCsv(buf.toString('utf8'));
  }
  function xlsxSend(res, name, sheet, rows, widths) {
    res.file(xlsxBuffer(sheet, rows, widths), name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  /** CoA penerimaan iuran (default: Penerimaan Kegiatan Siswa 4.1.07) */
  function coaPenerimaanList() {
    return db.prepare("SELECT * FROM coa WHERE aktif=1 AND kategori='pendapatan' ORDER BY kode").all();
  }
  function coaById(id) { return id ? db.prepare('SELECT * FROM coa WHERE id=?').get(id) : null; }
  function coaIuran(prefId) {
    const pref = coaById(prefId);
    if (pref) return pref;
    let c = db.prepare("SELECT * FROM coa WHERE kode='4.1.07'").get()
      || db.prepare("SELECT * FROM coa WHERE kode='4.1.06'").get()
      || db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' ORDER BY kode LIMIT 1").get();
    if (!c) {
      db.prepare("INSERT INTO coa (kode,nama,kategori,aktif) VALUES ('4.1.07','Penerimaan Kegiatan Siswa','pendapatan',1)").run();
      c = db.prepare("SELECT * FROM coa WHERE kode='4.1.07'").get();
    }
    return c;
  }
  function nextKwitansiNo() {
    const d = todayISO().replace(/-/g, '');
    const n = db.prepare("SELECT COUNT(DISTINCT kwitansi_no) c FROM iuran_bayar WHERE kwitansi_no LIKE ?").get(`IUR/${d}/%`).c + 1;
    return `IUR/${d}/${String(n).padStart(4, '0')}`;
  }
  function grupList(taId) { return dbm.iuranGrupList(taId, {}); }
  function kelasOptionsFor(taId) {
    return dbm.kelasList(taId, {}).map(k => `<option value="${k.id}">${esc(k.nama)}${k.program_nama ? ' — ' + esc(k.program_nama) : ''}</option>`).join('');
  }
  /** label "Juli 2026" mengikuti tahun ajaran grup */
  function bulanTahunLabel(bulan, taRow) {
    const b = Number(bulan) || 0;
    const start = String((taRow && taRow.tanggal_mulai) || '').slice(0, 10);
    const sy = start ? Number(start.slice(0, 4)) : new Date().getFullYear();
    const sm = start ? Number(start.slice(5, 7)) : 7;
    const y = b >= sm ? sy : sy + 1;
    return `${bulanLabel(b)} ${y}`;
  }
  function taOfGrup(g) { return g && g.tahun_ajaran_id ? dbm.tahunById(g.tahun_ajaran_id) : null; }
  /** semua pembayaran (non-void) untuk sekumpulan tagihan: Map tagihan_id → rows */
  function payMapFor(ids) {
    const list = [].concat(ids || []).map(Number).filter(Boolean);
    const map = new Map();
    if (!list.length) return map;
    const rows = db.prepare(`SELECT b.tagihan_id, b.id, b.jumlah, b.potongan, b.bulan, b.tanggal, b.metode,
        b.kwitansi_no, b.status, (SELECT u.nama FROM users u WHERE u.id=b.created_by) pencatat
      FROM iuran_bayar b
      WHERE b.status<>'void' AND b.tagihan_id IN (${list.map(() => '?').join(',')}) ORDER BY b.tanggal, b.id`).all(...list);
    for (const r of rows) {
      if (!map.has(r.tagihan_id)) map.set(r.tagihan_id, []);
      map.get(r.tagihan_id).push(r);
    }
    return map;
  }
  /**
   * rincian bulanan sebuah tagihan + alokasi pembayaran (memakai helper bersama di db.js
   * agar angka portal publik, detail siswa, dan matriks bulanan selalu identik).
   */
  function monthlyDetail(tagihan, grup, payments) {
    if (!grup || grup.jenis !== 'bulanan') return [];
    const list = payments || db.prepare(`SELECT jumlah, potongan, bulan FROM iuran_bayar
      WHERE tagihan_id=? AND status<>'void' ORDER BY tanggal, id`).all(tagihan.id);
    return dbm.iuranMonthDetail(grup.id, list)
      .map(m => ({ ...m, label: bulanLabel(m.bulan) }));
  }
  /** tagihan satu bulan tertentu (dipakai form bayar per bulan) */
  function monthRow(tagihan, grup, bulan, payments) {
    return monthlyDetail(tagihan, grup, payments).find(m => m.bulan === Number(bulan)) || null;
  }
  function statusText(st) { return (STATUS_LABEL[st] || [st || '-'])[0]; }

  /* ---------- pilihan item iuran (per grup / per bulan) ---------- */
  /** "g:<tagihanId>" = satu grup (non-bulanan) · "m:<tagihanId>:<bulan>" = satu bulan */
  function parseItemKeys(raw) {
    const list = [].concat(raw || []).flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const k of list) {
      const m = /^([gm]):(\d+)(?::(\d+))?$/.exec(k);
      if (!m) continue;
      const key = `${m[1]}:${m[2]}${m[3] ? ':' + m[3] : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ mode: m[1], tagihanId: Number(m[2]), bulan: m[3] ? Number(m[3]) : null, key });
    }
    return out;
  }
  /** rincian baris untuk item terpilih: tagihan, pembayaran, status, tanggal, pencatat */
  function selectionLines(siswaId, items) {
    const tags = dbm.iuranTagihanRows({ siswaId });
    const tagMap = new Map(tags.map(t => [t.id, t]));
    const pmap = payMapFor(tags.map(t => t.id));
    const lines = [];
    for (const it of items) {
      const t = tagMap.get(it.tagihanId);
      if (!t) continue;
      const grupObj = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(t.grup_id) || {};
      const payments = pmap.get(t.id) || [];
      const names = list => [...new Set(list.map(p => p.pencatat).filter(Boolean))].join(', ');
      const lastOf = list => (list.length ? list.map(p => p.tanggal).filter(Boolean).sort().pop() : null);
      if (it.mode === 'm' && it.bulan) {
        const det = monthlyDetail(t, grupObj, payments).find(m => m.bulan === it.bulan);
        if (!det) continue;
        const own = payments.filter(p => Number(p.bulan) === it.bulan && Number(p.jumlah) > 0);
        const used = own.length ? own : payments;
        lines.push({
          key: it.key, tagihan_id: t.id, bulan: it.bulan,
          label: `${t.grup_nama} - ${bulanTahunLabel(it.bulan, taOfGrup(grupObj))}`,
          jenis: 'Bulanan', status: det.status, tanggal: lastOf(used),
          tagihan: Number(det.tagihan) || 0, dibayar: Number(det.dibayar) || 0, sisa: Number(det.sisa) || 0,
          potongan: own.reduce((a, p) => a + Number(p.potongan || 0), 0),
          pencatat: names(used), writeoff: t.writeoff || '', grup_nama: t.grup_nama
        });
      } else {
        lines.push({
          key: it.key, tagihan_id: t.id, bulan: null,
          label: t.grup_nama, jenis: GROUP_LABEL[t.grup_jenis] || t.grup_jenis || '-',
          status: t.status, tanggal: lastOf(payments),
          tagihan: Number(t.nominal) || 0, dibayar: Number(t.terbayar) || 0, sisa: Number(t.sisa) || 0,
          potongan: Number(t.total_potongan) || 0, pencatat: names(payments),
          writeoff: t.writeoff || '', grup_nama: t.grup_nama
        });
      }
    }
    return { lines, tags };
  }
  function safeBack(raw, def = '/iuran/data') {
    const s = String(raw || '');
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%\/?]*$/.test(s) && !s.startsWith('//') ? s : def;
  }
  /** tagihan satu bulan tertentu (dipakai form bayar per bulan) */
  function monthRow(tagihan, grup, bulan, payments) {
    return monthlyDetail(tagihan, grup, payments).find(m => m.bulan === Number(bulan)) || null;
  }

  /* =========================================================
     GRUP IURAN
     ========================================================= */
  /** hapus banyak pembayaran iuran sekaligus — riwayat transaksi siswa & (bila ada) BKU ikut dibersihkan */
  function hapusBayarMassal(ids, user) {
    const out = { deleted: 0, trxDihapus: 0, kembaliAntrean: 0, ditolak: [] };
    const uniq = Array.from(new Set((ids || []).map(Number).filter(Boolean)));
    for (const id of uniq) {
      const b = db.prepare('SELECT * FROM iuran_bayar WHERE id=?').get(id);
      if (!b) { out.ditolak.push(`#${id} tidak ditemukan`); continue; }
      if (b.status === 'void') { out.ditolak.push(`${b.kwitansi_no}: sudah void`); continue; }
      if (b.sumber === 'beasiswa' || b.status === 'beasiswa') {
        out.ditolak.push(`${b.kwitansi_no}: dibayar otomatis oleh beasiswa (kelola lewat menu Beasiswa)`);
        continue;
      }
      if (b.transaksi_id) {
        const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(b.transaksi_id);
        if (t && t.status !== 'void') {
          const lockErr = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
          if (lockErr) { out.ditolak.push(`${b.kwitansi_no}: ${lockErr}`); continue; }
          db.transaction(() => {
            for (const sib of db.prepare('SELECT * FROM iuran_bayar WHERE transaksi_id=? AND id<>?').all(t.id, b.id)) {
              if (sib.status === 'posted') out.kembaliAntrean++;
            }
            db.prepare("UPDATE iuran_bayar SET status='pending', transaksi_id=NULL, posted_at=NULL, bku_id=NULL WHERE transaksi_id=? AND id<>? AND status='posted'").run(t.id, b.id);
            db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
            out.trxDihapus++;
          })();
        }
      }
      try { dbm.trashAdd('iuran_bayar', b, { user, label: `Pembayaran iuran ${b.kwitansi_no}` }); } catch (e) { }
      db.prepare('DELETE FROM iuran_bayar WHERE id=?').run(b.id);
      out.deleted++;
    }
    return out;
  }

  get('/iuran', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const taList = dbm.allTahun();
    const taId = Number(req.query.get('ta') || c.taId || 0) || null;
    const q = (req.query.get('q') || '').toLowerCase();
    const groups = grupList(taId).filter(g => !q || g.nama.toLowerCase().includes(q));
    const editable = c.can('iuran', 'edit');
    const late = modalCollector();

    const tingkatList = dbm.tingkatAktif();
    const nominalFields = (g, tingkatSel) => {
      const tk = String(tingkatSel || req.query.get('tingkat') || '');
      const map = g ? dbm.iuranNominalMap(g.id, tk) : {};
      const uid = (g ? g.id : 'new') + '_' + (tk || 'def').replace(/[^a-z0-9]/gi, '');
      const isNon = !!g && g.jenis === 'nonbulanan';
      // nominal khusus per tingkat yang sudah tersimpan
      const perTk = g ? db.prepare("SELECT DISTINCT tingkat FROM iuran_nominal WHERE grup_id=? AND COALESCE(tingkat,'')<>''").all(g.id).map(r => r.tingkat) : [];
      const tkOpts = [`<option value="">Semua tingkat (default)</option>`]
        .concat(tingkatList.map(t => `<option value="${esc(t)}" ${tk === String(t) ? 'selected' : ''}>${esc(dbm.tingkatLabel(t))} (${esc(t)})${perTk.includes(t) ? ' •' : ''}</option>`));
      return `<div class="row2">
          <div class="field"><label>Terapkan Tagihan Berdasarkan Tingkat</label>
            <select name="nominal_tingkat" data-nominal-tingkat>
              ${tkOpts.join('')}
            </select>
            <div class="hint">Pilih <b>Semua tingkat</b> untuk tarif seragam, atau tingkat tertentu (mis. SPP kelas VII berbeda dengan VIII &amp; IX).
              ${perTk.length ? `Nominal khusus sudah ada untuk: <b>${esc(perTk.map(t => dbm.tingkatLabel(t)).join(', '))}</b>.` : ''}</div></div>
          <div class="field"><label>Catatan</label>
            <div class="hint">Perubahan nominal hanya mengubah tarif pada tingkat yang dipilih. Tagihan siswa yang belum dibayar otomatis disesuaikan.</div></div>
        </div>
        <div data-jenis="bulanan" style="display:${isNon ? 'none' : ''}">
          <div class="alert info">${ui.icon('info')}<div>Default <b>12 bulan: Juli s.d. Juni</b>. Pilih <b>Sama Rata</b> untuk mengisi semua bulan sekaligus, atau <b>Berbeda per Bulan</b> lalu ubah nominal tiap bulan secara manual.</div></div>
          <div class="radio-cards mb-2">
            <input type="radio" name="mode_nominal" id="mn_rata_${uid}" value="rata" checked><label for="mn_rata_${uid}"><span class="dot"></span> Sama Rata</label>
            <input type="radio" name="mode_nominal" id="mn_beda_${uid}" value="beda"><label for="mn_beda_${uid}"><span class="dot"></span> Berbeda per Bulan</label>
          </div>
          <div class="field"><label>Nominal Sama Rata (Rp)</label>${ui.moneyInput('nominal_rata', map[7] || 0, 'data-nominal-rata="1"')}</div>
          <div class="row3" data-bulan-grid>
            ${BULAN_TA.map(b => `<div class="field"><label>${esc(bulanLabel(b))}</label>${ui.moneyInput('bulan_' + b, map[b] || 0)}</div>`).join('')}
          </div>
        </div>
        <div data-jenis="nonbulanan" style="display:${isNon ? '' : 'none'}">
          <div class="field"><label>Nominal Iuran (Rp)</label>${ui.moneyInput('nominal_tunggal', map[0] || 0)}
            <div class="hint">Iuran non-bulanan: satu nominal untuk seluruh periode.</div></div>
        </div>`;
    };

    const form = (g, fid) => `<form method="post" action="${c.base}/iuran/save" id="${fid}" data-iuran-form>
      <input type="hidden" name="id" value="${g ? g.id : ''}">
      <div class="row2">
        <div class="field"><label>Nama Grup Iuran</label><input name="nama" value="${esc(g ? g.nama : '')}" required placeholder="Iuran SPP / Iuran Praktik"></div>
        <div class="field"><label>Jenis Iuran</label><select name="jenis" data-iuran-jenis>
          <option value="bulanan" ${!g || g.jenis === 'bulanan' ? 'selected' : ''}>Bulanan</option>
          <option value="nonbulanan" ${g && g.jenis === 'nonbulanan' ? 'selected' : ''}>Non-Bulanan</option>
        </select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Tahun Pelajaran</label><select name="tahun_ajaran_id">
          ${taList.map(t => `<option value="${t.id}" ${String(g ? g.tahun_ajaran_id : taId) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(g ? g.keterangan : '')}" placeholder="Opsional"></div>
      </div>
      <div data-nominal-wrap>${nominalFields(g, req.query.get('tingkat'))}</div>
      <label class="check"><input type="checkbox" name="aktif" value="1" ${!g || g.aktif ? 'checked' : ''}> Grup iuran aktif</label>
    </form>`;

    const content = `<div class="card">
      <div class="card-head"><div><h3>Grup Iuran</h3><div class="sub">${groups.length} grup pada tahun pelajaran terpilih</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/iuran" class="flex" style="gap:6px">
            <select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taId) === String(t.id) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select>
            <input name="q" value="${esc(req.query.get('q') || '')}" placeholder="Cari nama grup" style="width:170px">
            <button class="btn btn-sm">${ui.icon('search')}Filter</button>
          </form>
          ${c.can('iuran', 'create') ? ui.openModalBtn('mSalinPeriodik', 'Salin Periodik') : ''}
          ${c.can('iuran', 'create') ? ui.openModalBtn('mAddGrup', 'Tambah Grup Iuran') : ''}
        </div></div>
      ${groups.length ? `<div class="table-wrap sticky-head"><table><thead><tr>
        <th>Nama Grup</th><th>Jenis</th><th>Tahun Ajaran</th><th class="num">Nominal (total)</th><th class="num">Siswa</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${groups.map(g => `<tr>
        <td class="t-strong">${esc(g.nama)}</td>
        <td>${g.jenis === 'bulanan' ? ui.badge('Bulanan', 'blue') : ui.badge('Non-Bulanan', 'orange')}</td>
        <td>${esc((taList.find(t => String(t.id) === String(g.tahun_ajaran_id)) || {}).nama || '-')}</td>
        <td class="num">${rupiah(g.total_nominal)}${g.jenis === 'bulanan' ? `<div class="t-sub">${g.nominal.filter(n => n.bulan).length} bulan</div>` : ''}</td>
        <td class="num">${g.jumlah_siswa}</td>
        <td>${g.aktif ? ui.badge('Aktif', 'green') : ui.badge('Non-Aktif', 'gray')}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" href="${c.base}/iuran/grup/${g.id}">${ui.icon('eye')}Detail</a>
          ${editable ? `<button class="btn btn-sm btn-icon" data-open="mEd${g.id}" title="Edit">${ui.icon('edit')}</button>` : ''}
          ${c.can('iuran', 'delete') ? `<form method="post" action="${c.base}/iuran/delete" style="display:inline" data-confirm="Hapus grup iuran ${esc(g.nama)} beserta tagihannya?"><input type="hidden" name="id" value="${g.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>
        ${late('mEd' + g.id, {
        title: 'Edit Grup Iuran — ' + g.nama, body: form(g, 'fmEd' + g.id), wide: true,
        footer: `<button class="btn" data-close="mEd${g.id}">Batal</button><button class="btn btn-primary" form="fmEd${g.id}">Simpan</button>`
      })}`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada grup iuran', 'Buat grup iuran (mis. Iuran SPP, Iuran Praktik) lalu tetapkan ke kelas/siswa.')}
      ${late.html()}
    </div>
    ${c.can('iuran', 'create') ? ui.modal('mSalinPeriodik', {
      title: 'Salin Periodik Grup Iuran', wide: false,
      body: `<form method="post" action="${c.base}/iuran/salin-periodik" id="fSalinPeriodik">
        <div class="alert info">${ui.icon('info')}<div><b>Menyalin struktur grup iuran</b> (nama, jenis, nominal per bulan/tingkat, jatuh tempo &amp; kode rekening)
          dari tahun pelajaran sebelumnya ke tahun pelajaran tujuan. Grup yang namanya sudah ada pada TA tujuan <b>tidak</b> digandakan.</div></div>
        <div class="row2">
          <div class="field"><label>Dari Tahun Pelajaran</label>
            <select name="ta_sumber" required>
              ${taList.filter(t => String(t.id) !== String(taId)).map(t => `<option value="${t.id}">${esc(t.nama)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Ke Tahun Pelajaran</label>
            <select name="ta_tujuan" required>
              ${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}
            </select></div>
        </div>
        <div class="field"><label>Catatan</label>
          <div class="hint">Penetapan grup ke siswa/kelas tidak disalin otomatis — buka <b>Detail</b> tiap grup untuk menetapkan siswa TA baru.</div></div>
      </form>`,
      footer: `<button class="btn" data-close="mSalinPeriodik">Batal</button>
        <button class="btn btn-primary" form="fSalinPeriodik">${ui.icon('refresh')}Salin Sekarang</button>`
    }) + ui.modal('mAddGrup', {
      title: 'Tambah Grup Iuran', body: form(null, 'fmAddGrup'), wide: true,
      footer: `<button class="btn" data-close="mAddGrup">Batal</button><button class="btn btn-primary" form="fmAddGrup">Simpan Grup</button>`
    }) : ''}
    <p class="help mt-2">Setelah grup dibuat, buka <b>Detail</b> untuk menetapkan grup ke kelas/siswa tertentu dan mengubah nominalnya.</p>`;
    page(req, res, { title: 'Grup Iuran', sub: 'Kelompok tagihan iuran siswa & penetapan nominal', active: 'iuran', content });
  });

  /* =========================================================
     SALIN PERIODIK GRUP IURAN (clone struktur antar tahun pelajaran)
     ========================================================= */
  post('/iuran/salin-periodik', (req, res) => {
    guard(req, res, 'iuran', 'create');
    const c = ctx(req);
    const back = req.BASE + '/iuran';
    const taList = dbm.allTahun();
    const taTujuan = Number(req.body.ta_tujuan || c.taId || 0) || (taList[0] || {}).id;
    let taSumber = Number(req.body.ta_sumber || 0);
    if (!taSumber) {
      const idx = taList.findIndex(t => String(t.id) === String(taTujuan));
      const prev = idx >= 0 ? taList[idx + 1] : null;
      taSumber = prev ? prev.id : 0;
    }
    if (!taTujuan || !taSumber) return res.redirect(back + '?err=' + encodeURIComponent('Tahun pelajaran sumber/tujuan belum tersedia.'));
    if (String(taTujuan) === String(taSumber)) return res.redirect(back + '?err=' + encodeURIComponent('Tahun pelajaran sumber dan tujuan tidak boleh sama.'));
    const sumber = taList.find(t => String(t.id) === String(taSumber));
    const tujuan = taList.find(t => String(t.id) === String(taTujuan));
    if (!sumber || !tujuan) return res.redirect(back + '?err=' + encodeURIComponent('Tahun pelajaran tidak ditemukan.'));
    const groups = db.prepare('SELECT * FROM iuran_grup WHERE tahun_ajaran_id=? ORDER BY id').all(taSumber);
    if (!groups.length) return res.redirect(back + '?err=' + encodeURIComponent(`Belum ada grup iuran pada TA ${sumber.nama}.`));

    let dibuat = 0, dilewati = 0;
    db.transaction(() => {
      for (const g of groups) {
        const ada = db.prepare('SELECT id FROM iuran_grup WHERE tahun_ajaran_id=? AND lower(trim(nama))=lower(trim(?))').get(taTujuan, g.nama);
        if (ada) { dilewati++; continue; }
        const info = db.prepare('INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,keterangan,aktif,created_at,jatuh_tempo,coa_id) VALUES (?,?,?,?,?,?,?,?)')
          .run(g.nama, g.jenis, taTujuan, g.keterangan || '', g.aktif, nowStamp(),
            g.jatuh_tempo === undefined ? null : g.jatuh_tempo, g.coa_id === undefined ? null : g.coa_id);
        const gid = Number(info.lastInsertRowid);
        const nominal = db.prepare('SELECT * FROM iuran_nominal WHERE grup_id=?').all(g.id);
        const ins = db.prepare('INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,?)');
        for (const n of nominal) ins.run(gid, n.bulan, n.nominal, n.tingkat || '');
        dibuat++;
      }
    })();
    dbm.logAudit(req.user, 'SALIN PERIODIK', 'iuran',
      `Salin ${dibuat} grup iuran dari TA ${sumber.nama} ke TA ${tujuan.nama}${dilewati ? ` (${dilewati} grup sudah ada, dilewati)` : ''}`);
    res.redirect(back + `?ta=${taTujuan}&ok=` + encodeURIComponent(
      `Salin periodik selesai: ${dibuat} grup iuran dibuat pada TA ${tujuan.nama}${dilewati ? `, ${dilewati} grup dilewati karena sudah ada` : ''}. ` +
      'Penetapan siswa dilakukan lewat tombol Detail pada masing-masing grup.'));
  });

  post('/iuran/save', (req, res) => {
    const isEdit = !!req.body.id;
    guard(req, res, 'iuran', isEdit ? 'edit' : 'create');
    const back = req.BASE + '/iuran';
    const { nama, jenis, tahun_ajaran_id, keterangan } = req.body;
    if (!String(nama || '').trim()) return res.redirect(back + '?err=' + encodeURIComponent('Nama grup iuran wajib diisi.'));
    const jenisV = jenis === 'nonbulanan' ? 'nonbulanan' : 'bulanan';
    const taId = Number(tahun_ajaran_id || dbm.taAutoId());
    const aktif = req.body.aktif ? 1 : 0;
    let grupId = Number(req.body.id || 0);
    db.transaction(() => {
      if (isEdit) {
        db.prepare('UPDATE iuran_grup SET nama=?,jenis=?,tahun_ajaran_id=?,keterangan=?,aktif=? WHERE id=?')
          .run(nama.trim(), jenisV, taId, keterangan || '', aktif, grupId);
      } else {
        const info = db.prepare('INSERT INTO iuran_grup (nama,jenis,tahun_ajaran_id,keterangan,aktif,created_at) VALUES (?,?,?,?,?,?)')
          .run(nama.trim(), jenisV, taId, keterangan || '', aktif, nowStamp());
        grupId = Number(info.lastInsertRowid);
      }
      // nominal — hanya untuk tingkat yang dipilih ('' = default semua tingkat)
      const tk = String(req.body.nominal_tingkat || '').trim();
      db.prepare("DELETE FROM iuran_nominal WHERE grup_id=? AND COALESCE(tingkat,'')=?").run(grupId, tk);
      const ins = db.prepare('INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,?)');
      if (jenisV === 'nonbulanan') {
        ins.run(grupId, null, lib.parseMoney(req.body.nominal_tunggal), tk);
      } else {
        const rata = lib.parseMoney(req.body.nominal_rata);
        for (const b of BULAN_TA) {
          const val = req.body.mode_nominal === 'rata' && rata ? rata : lib.parseMoney(req.body['bulan_' + b]);
          ins.run(grupId, b, val, tk);
        }
      }
      // sinkronkan nominal tagihan yang belum dibayar (mengikuti tingkat siswa)
      const tags = db.prepare('SELECT t.* FROM iuran_tagihan t WHERE t.grup_id=?').all(grupId);
      for (const t of tags) {
        const paid = db.prepare("SELECT COALESCE(SUM(jumlah),0) s FROM iuran_bayar WHERE tagihan_id=? AND status<>'void'").get(t.id).s;
        if (Number(paid) <= 0) {
          const tkSiswa = dbm.siswaTingkat(t.siswa_id, t.tahun_ajaran_id);
          db.prepare('UPDATE iuran_tagihan SET nominal=? WHERE id=?').run(dbm.iuranTotalFor(grupId, tkSiswa), t.id);
        }
      }
    })();
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'iuran', `${isEdit ? 'Edit' : 'Tambah'} grup iuran ${nama}`);
    res.redirect(back + '?ok=' + encodeURIComponent('Grup iuran disimpan.'));
  });

  post('/iuran/delete', (req, res) => {
    guard(req, res, 'iuran', 'delete');
    const g = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(req.body.id);
    if (!g) return res.redirect(req.BASE + '/iuran?err=' + encodeURIComponent('Grup iuran tidak ditemukan.'));
    db.transaction(() => {
      const tags = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').all(g.id);
      for (const t of tags) {
        const bays = db.prepare('SELECT * FROM iuran_bayar WHERE tagihan_id=?').all(t.id);
        for (const b of bays) dbm.trashAdd('iuran_bayar', b, { user: req.user, label: `Pembayaran iuran ${g.nama}` });
      }
      db.prepare('DELETE FROM iuran_bayar WHERE tagihan_id IN (SELECT id FROM iuran_tagihan WHERE grup_id=?)').run(g.id);
      db.prepare('DELETE FROM iuran_tagihan WHERE grup_id=?').run(g.id);
      db.prepare('DELETE FROM iuran_nominal WHERE grup_id=?').run(g.id);
      db.prepare('DELETE FROM iuran_grup WHERE id=?').run(g.id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'iuran', `Hapus grup iuran ${g.nama}`);
    res.redirect(req.BASE + '/iuran?ok=' + encodeURIComponent('Grup iuran dan tagihannya dihapus (pembayaran tersimpan di Kotak Sampah).'));
  });

  /* =========================================================
     DETAIL PENETAPAN GRUP
     ========================================================= */
  get('/iuran/grup/:id', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const g = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(req.params.id);
    if (!g) return res.notFound();
    const tkSel = String(req.query.get('tingkat') || '').trim();
    const nominal = dbm.iuranNominalMap(g.id, tkSel);
    const total = Object.values(nominal).reduce((s, v) => s + Number(v || 0), 0);
    // tarif khusus per tingkat yang sudah tersimpan (selain default)
    const tingkatTersimpan = db.prepare("SELECT DISTINCT tingkat FROM iuran_nominal WHERE grup_id=? AND COALESCE(tingkat,'')<>''").all(g.id).map(r => r.tingkat);
    const tarifPerTingkat = tingkatTersimpan.map(tk => ({
      tingkat: tk, label: dbm.tingkatLabel(tk), total: dbm.iuranTotalFor(g.id, tk),
      n: (dbm.iuranNominalMap(g.id, tk) && Object.keys(dbm.iuranNominalMap(g.id, tk)).length) || 0
    }));
    const taList = dbm.allTahun();
    const taId = g.tahun_ajaran_id;
    const kelasList = dbm.kelasList(taId, {});
    const kelasId = req.query.get('kelas') || '';
    // siswa diambil dari PENEMPATAN kelas pada tahun pelajaran grup (bukan cache kelas siswa),
    // sehingga TA lampau / TA baru tetap menampilkan daftar siswa yang benar.
    const siswaKelas = kelasId ? dbm.siswaList({ kelasId, taId, status: ['aktif', 'lulus', 'pindah', 'do'] }) : [];
    const tags = dbm.iuranTagihanRows({ grupId: g.id });
    const assignedIds = new Set(tags.map(t => t.siswa_id));
    const editable = c.can('iuran', 'edit');
    const late = modalCollector();

    const content = `<div class="between mb-2">
      <a class="btn" href="${c.base}/iuran">${ui.icon('x')}Kembali</a>
      <div class="toolbar">
        <a class="btn" href="${c.base}/iuran/data?grup=${g.id}&ta=${taId}">${ui.icon('coins')}Data Iuran</a>
      </div></div>
    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>${esc(g.nama)}</h3><div class="sub">${GROUP_LABEL[g.jenis]} · TA ${esc((taList.find(t => String(t.id) === String(taId)) || {}).nama || '-')}</div></div>
          ${g.aktif ? ui.badge('Aktif', 'green') : ui.badge('Non-Aktif', 'gray')}</div>
        <div class="kv">
          <dt>Tarif ditampilkan</dt><dd>${tkSel ? `<b>${esc(dbm.tingkatLabel(tkSel))}</b>` : '<b>Semua tingkat (default)</b>'}</dd>
          <dt>Total Nominal</dt><dd><b>${rupiah(total)}</b></dd>
          ${g.jenis === 'bulanan' ? BULAN_TA.map(b => `<dt>${esc(bulanLabel(b))}</dt><dd>${rupiah(nominal[b] || 0)}</dd>`).join('') : `<dt>Nominal</dt><dd>${rupiah(nominal[0] || 0)}</dd>`}
          <dt>Keterangan</dt><dd>${esc(g.keterangan || '-')}</dd>
          <dt>Siswa ditetapkan</dt><dd>${tags.length}</dd>
        </div>
        ${tarifPerTingkat.length ? `<hr class="sep"><div class="t-strong mb-1">Tarif Khusus per Tingkat</div>
          <div class="table-wrap short"><table><thead><tr><th>Tingkat</th><th class="num">Total Tarif</th><th></th></tr></thead><tbody>
          ${tarifPerTingkat.map(t => `<tr><td>${esc(t.label)} <span class="t-sub mono">(${esc(t.tingkat)})</span></td>
            <td class="num">${rupiah(t.total)}</td>
            <td><a class="btn btn-sm" href="${c.base}/iuran/grup/${g.id}?tingkat=${encodeURIComponent(t.tingkat)}">Ubah</a></td></tr>`).join('')}
          </tbody></table></div>` : ''}
        ${editable ? `<hr class="sep"><form method="post" action="${c.base}/iuran/grup/${g.id}/nominal">
          <div class="t-strong mb-1">Edit Nominal Iuran</div>
          <div class="field"><label>Terapkan Tagihan Berdasarkan Tingkat</label>
            <select name="nominal_tingkat" data-nominal-tingkat-jump="${c.base}/iuran/grup/${g.id}">
              <option value="">Semua tingkat (default)</option>
              ${dbm.tingkatAktif().map(t => `<option value="${esc(t)}" ${tkSel === String(t) ? 'selected' : ''}>${esc(dbm.tingkatLabel(t))}${tingkatTersimpan.includes(t) ? ' •' : ''}</option>`).join('')}
            </select>
            <div class="hint">Pilih tingkat untuk membuat tarif berbeda (mis. SPP kelas VII ≠ VIII). Tarif default dipakai bila tingkat tidak punya tarif khusus.</div></div>
          ${g.jenis === 'bulanan' ? `<div class="row3">${BULAN_TA.map(b => `<div class="field"><label>${esc(bulanLabel(b))}</label>${ui.moneyInput('bulan_' + b, nominal[b] || 0)}</div>`).join('')}</div>`
        : `<div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal_tunggal', nominal[0] || 0)}</div>`}
          <button class="btn btn-primary btn-block">${ui.icon('save')}Simpan Nominal</button>
          <div class="hint mt-1">Nominal tagihan siswa yang belum memiliki pembayaran otomatis disesuaikan.</div>
        </form>` : ''}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Penetapan Grup ke Kelas</h3><div class="sub">Pilih seluruh siswa satu kelas atau centang siswa tertentu</div></div></div>
        <form method="get" action="${c.base}/iuran/grup/${g.id}" class="filterbar" style="box-shadow:none;padding:0;margin-bottom:12px">
          <div class="field"><label>Kelas</label><select name="kelas" data-autosubmit><option value="">— Pilih kelas —</option>${kelasOptionsFor(taId)}</select></div>
        </form>
        ${siswaKelas.length ? `<form method="post" action="${c.base}/iuran/grup/${g.id}/tetapkan">
          <input type="hidden" name="kelas_id" value="${esc(kelasId)}">
          <div class="between mb-1">
            <div class="t-sub">${siswaKelas.length} siswa di kelas ini · ${siswaKelas.filter(s => assignedIds.has(s.id)).length} sudah ditetapkan</div>
            <div class="toolbar">
              <button type="button" class="btn btn-sm" data-check-all="siswa_id">${ui.icon('check')}Pilih Semua</button>
              <button type="button" class="btn btn-sm" data-check-none="siswa_id">${ui.icon('x')}Hapus Ceklis</button>
            </div>
          </div>
          <div class="table-scroll short"><table><thead><tr><th style="width:40px"><input type="checkbox" data-check-all-box="siswa_id"></th><th>NISN</th><th>Nama</th><th class="num">Nominal</th><th>Status</th></tr></thead><tbody>
            ${siswaKelas.map(s => `<tr><td><input type="checkbox" name="siswa_id" value="${s.id}" ${assignedIds.has(s.id) ? 'disabled checked' : ''}></td>
              <td class="mono">${esc(s.nisn || '-')}</td><td class="t-strong">${esc(s.nama)}</td>
              <td class="num">${rupiah(dbm.iuranTotalFor(g.id, s.tingkat || dbm.siswaTingkat(s.id, taId)))}</td>
              <td>${assignedIds.has(s.id) ? ui.badge('Sudah', 'green') : ui.badge('Belum', 'gray')}
                ${s.status !== 'aktif' ? `<div class="t-sub">${esc((dbm.SISWA_STATUS[s.status] || [s.status])[0])}</div>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
          ${editable ? `<div class="form-actions"><button class="btn btn-primary">${ui.icon('plus')}Tetapkan ke Siswa Terpilih</button></div>` : ''}
        </form>` : ui.emptyState(
          kelasId ? 'Belum ada siswa di kelas ini' : 'Pilih kelas',
          kelasId
            ? `Belum ada siswa yang ditempatkan pada kelas ini di TA ${esc((taList.find(t => String(t.id) === String(taId)) || {}).nama || '-')}. Tempatkan siswa lebih dulu lewat menu <a href="${c.base}/mutasi-kelas">Mutasi Kelas</a> atau <a href="${c.base}/siswa">Data Siswa</a>.`
            : 'Pilih kelas untuk menampilkan daftar siswa yang akan ditetapkan.')}
      </div>
    </div>
    <div class="card mt-3">
      <div class="card-head"><div><h3>Siswa yang Ditetapkan</h3>
        <div class="sub">${tags.length} tagihan · ${tags.filter(t => Number(t.beasiswa_locked) === 1).length} terkunci otomatis oleh beasiswa</div></div></div>
      ${tags.length ? `<form method="post" action="${c.base}/iuran/grup/${g.id}/lepas" id="fLepas"
          data-confirm="Hapus penetapan iuran untuk siswa yang dicentang? Pembayaran iuran terkait ikut dihapus.">
          <input type="hidden" name="back" value="/iuran/grup/${g.id}">
        </form>
        <div class="between mb-1">
          <div class="small muted">Centang baris lalu klik <b>Hapus Penetapan Terpilih</b> untuk membatalkan penetapan secara massal.</div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-group-all="lepas">${ui.icon('check')}Pilih Semua</button>
            <button type="button" class="btn btn-sm" data-check-group-none="lepas">${ui.icon('x')}Hapus Ceklis</button>
            ${editable ? `<button class="btn btn-sm btn-danger" form="fLepas">${ui.icon('trash')}Hapus Penetapan Terpilih</button>` : ''}
          </div>
        </div>
        <div class="table-wrap sticky-head"><table><thead><tr>
          <th style="width:38px"><input type="checkbox" data-check-group-box="lepas" title="Pilih semua siswa yang ditetapkan"></th>
          <th>NISN</th><th>Nama</th><th>Kelas</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Sisa</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${tags.map(t => {
        const lock = Number(t.beasiswa_locked) === 1;
        return `<tr class="${lock ? 'row-locked' : ''}">
          <td><input type="checkbox" form="fLepas" name="tagihan_id" value="${t.id}" data-check-group="lepas" ${lock ? 'disabled title="Terkunci oleh beasiswa"' : ''}></td>
          <td class="mono">${esc(t.nisn || '-')}</td>
          <td><a class="link-strong" href="${c.base}/iuran/data/${t.siswa_id}">${esc(t.siswa_nama)}</a></td><td>${esc(t.kelas_nama || '-')}</td>
          <td class="num">${rupiah(t.nominal)}</td><td class="num">${rupiah(t.terbayar)}</td><td class="num">${rupiah(t.sisa)}</td>
          <td>${statusBadge(t.status)}${lock ? '<div class="lock-note" style="margin-top:4px">Beasiswa · terkunci</div>' : ''}</td>
          <td class="right nowrap"><a class="btn btn-sm" href="${c.base}/iuran/data/${t.siswa_id}">${ui.icon('eye')}Detail</a>
          ${editable && !lock ? `<button class="btn btn-sm btn-danger" form="fLepas" name="single" value="${t.id}" data-confirm-click="Hapus penetapan ${esc(t.grup_nama)} untuk ${esc(t.siswa_nama)}?" title="Hapus penetapan">${ui.icon('trash')}</button>` : ''}
          </td></tr>`;
      }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada siswa ditetapkan', 'Pilih kelas lalu centang siswa.')}
      ${late.html()}
    </div>`;
    page(req, res, { title: 'Detail Grup Iuran', sub: `${g.nama} — penetapan & nominal`, active: 'iuran', content });
  });

  post('/iuran/grup/:id/nominal', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const g = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(req.params.id);
    const back = req.BASE + '/iuran';
    if (!g) return res.redirect(back + '?err=' + encodeURIComponent('Grup iuran tidak ditemukan.'));
    const tk = String(req.body.nominal_tingkat || '').trim();
    db.transaction(() => {
      db.prepare("DELETE FROM iuran_nominal WHERE grup_id=? AND COALESCE(tingkat,'')=?").run(g.id, tk);
      const ins = db.prepare('INSERT INTO iuran_nominal (grup_id,bulan,nominal,tingkat) VALUES (?,?,?,?)');
      if (g.jenis === 'bulanan') for (const b of BULAN_TA) ins.run(g.id, b, lib.parseMoney(req.body['bulan_' + b]), tk);
      else ins.run(g.id, null, lib.parseMoney(req.body.nominal_tunggal), tk);
      for (const t of db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=?').all(g.id)) {
        const paid = db.prepare("SELECT COALESCE(SUM(jumlah),0) s FROM iuran_bayar WHERE tagihan_id=? AND status<>'void'").get(t.id).s;
        if (Number(paid) <= 0) {
          const tkSiswa = dbm.siswaTingkat(t.siswa_id, t.tahun_ajaran_id);
          db.prepare('UPDATE iuran_tagihan SET nominal=? WHERE id=?').run(dbm.iuranTotalFor(g.id, tkSiswa), t.id);
        }
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'iuran', `Mengubah nominal grup ${g.nama}`);
    res.redirect(req.BASE + `/iuran/grup/${g.id}?ok=` + encodeURIComponent('Nominal iuran diperbarui.'));
  });

  post('/iuran/grup/:id/tetapkan', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const g = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(req.params.id);
    if (!g) return res.redirect(req.BASE + '/iuran?err=' + encodeURIComponent('Grup iuran tidak ditemukan.'));
    const ids = [].concat(req.body.siswa_id || []);
    const back = req.BASE + `/iuran/grup/${g.id}?kelas=${req.body.kelas_id || ''}`;
    if (!ids.length) return res.redirect(back + '&err=' + encodeURIComponent('Centang minimal satu siswa.'));
    let n = 0;
    db.transaction(() => {
      const ins = db.prepare('INSERT OR IGNORE INTO iuran_tagihan (grup_id,siswa_id,tahun_ajaran_id,nominal,potongan,keterangan,created_at) VALUES (?,?,?,?,0,\'\',?)');
      for (const sid of ids) {
        const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(sid);
        if (!s) continue;
        // tarif mengikuti TINGKAT siswa (fallback ke tarif default)
        const tkSiswa = dbm.siswaTingkat(s.id, g.tahun_ajaran_id);
        const nominal = dbm.iuranTotalFor(g.id, tkSiswa);
        const info = ins.run(g.id, s.id, g.tahun_ajaran_id, nominal, nowStamp());
        if (info.changes) n++;
      }
    })();
    dbm.logAudit(req.user, 'TETAPKAN', 'iuran', `Menetapkan ${g.nama} ke ${n} siswa`);
    res.redirect(back + '&ok=' + encodeURIComponent(`${n} siswa ditetapkan pada grup ${g.nama}.`));
  });

  /** HAPUS MASAL PENETAPAN (bulk unassign) — membatalkan penetapan grup ke siswa terpilih */
  post('/iuran/grup/:id/lepas', (req, res) => {
    guard(req, res, 'iuran', 'delete');
    const g = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(req.params.id);
    const backRaw = String(req.body.back || (g ? `/iuran/grup/${g.id}` : '/iuran'));
    const back = req.BASE + (/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/iuran');
    if (!g) return res.redirect(back + '?err=' + encodeURIComponent('Grup iuran tidak ditemukan.'));
    const ids = [...[].concat(req.body.tagihan_id || []), ...[].concat(req.body.single || [])].map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Centang minimal satu siswa yang penetapannya akan dihapus.'));
    let n = 0, locked = 0;
    db.transaction(() => {
      for (const id of ids) {
        const t = db.prepare('SELECT * FROM iuran_tagihan WHERE id=? AND grup_id=?').get(id, g.id);
        if (!t) continue;
        if (Number(t.beasiswa_locked) === 1) { locked++; continue; }
        for (const b of db.prepare('SELECT * FROM iuran_bayar WHERE tagihan_id=?').all(t.id)) {
          if (b.sumber === 'beasiswa' || b.status === 'beasiswa') { locked++; continue; }
          if (b.transaksi_id) {
            const trx = db.prepare('SELECT * FROM transaksi WHERE id=?').get(b.transaksi_id);
            if (trx && trx.status !== 'void') {
              const lk = dbm.periodeLockError(trx.bku_id, trx.tanggal, 'edit');
              if (lk) { locked++; continue; }
              dbm.trashAdd('transaksi', trx, { user: req.user, label: 'Transaksi iuran ' + (trx.no_bukti || trx.id) });
              db.prepare('DELETE FROM transaksi WHERE id=?').run(trx.id);
            }
          }
          dbm.trashAdd('iuran_bayar', b, { user: req.user, label: 'Pembayaran iuran siswa' });
          db.prepare('DELETE FROM iuran_bayar WHERE id=?').run(b.id);
        }
        db.prepare('DELETE FROM iuran_tagihan WHERE id=?').run(t.id);
        n++;
      }
    })();
    dbm.logAudit(req.user, 'HAPUS MASSAL', 'iuran', `Menghapus ${n} penetapan grup ${g.nama}${locked ? ` (${locked} baris dilewati karena terkunci)` : ''}`);
    const msg = `${n} penetapan grup ${g.nama} dihapus.` + (locked ? ` ${locked} baris dilewati (terkunci beasiswa / periode BKU ditutup).` : '');
    res.redirect(back + (n ? '?ok=' : '?err=') + encodeURIComponent(msg));
  });

  post('/iuran/tagihan/delete', (req, res) => {
    guard(req, res, 'iuran', 'delete');
    const backRaw = String(req.body.back || '/iuran');
    const back = req.BASE + (/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/iuran');
    const t = db.prepare('SELECT * FROM iuran_tagihan WHERE id=?').get(req.body.id);
    if (!t) return res.redirect(back + '?err=' + encodeURIComponent('Tagihan tidak ditemukan.'));
    if (Number(t.beasiswa_locked) === 1) {
      return res.redirect(back + '?err=' + encodeURIComponent('Tagihan ini terkunci karena dibayar otomatis oleh beasiswa. Ubah/hapus melalui menu Beasiswa SPP.'));
    }
    db.transaction(() => {
      for (const b of db.prepare('SELECT * FROM iuran_bayar WHERE tagihan_id=?').all(t.id))
        dbm.trashAdd('iuran_bayar', b, { user: req.user, label: 'Pembayaran iuran siswa' });
      db.prepare('DELETE FROM iuran_bayar WHERE tagihan_id=?').run(t.id);
      db.prepare('DELETE FROM iuran_tagihan WHERE id=?').run(t.id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'iuran', `Menghapus penetapan tagihan #${t.id}`);
    res.redirect(back + '?ok=' + encodeURIComponent('Penetapan tagihan dihapus.'));
  });

  /* =========================================================
     DATA IURAN
     ========================================================= */
  function dataIuranRows(req, c) {
    const taList = dbm.allTahun();
    const taId = Number(req.query.get('ta') || c.taId || 0) || null;
    const q = req.query.get('q') || '';
    const kelasIds = (req.query.getAll ? req.query.getAll('kelas') : []).map(Number).filter(Boolean);
    const grupIds = (req.query.getAll ? req.query.getAll('grup') : []).map(Number).filter(Boolean);
    const tingkatIds = (req.query.getAll ? req.query.getAll('tingkat') : []).map(x => String(x || '').trim()).filter(Boolean);
    const tags = dbm.iuranTagihanRows({
      taId, q, aktifOnly: true,
      kelasId: kelasIds.length ? kelasIds : undefined,
      grupId: grupIds.length ? grupIds : undefined,
      tingkat: tingkatIds.length ? tingkatIds : undefined
    });
    return { taId, taList, q, kelasIds, grupIds, tingkatIds, tags, rekap: dbm.iuranRekapSiswa(tags) };
  }
  /** daftar checkbox multi-pilih (dipakai filter kelas & grup iuran) */
  function multiPick(name, label, items, selected) {
    const sel = new Set((selected || []).map(String));
    return `<div class="field"><label>${esc(label)}</label>
      <details class="multipick">
        <summary>${sel.size ? `${sel.size} dipilih` : 'Semua'}</summary>
        <div class="multipick-list">
          <label class="check"><input type="checkbox" data-check-all-box="${name}" ${sel.size === items.length && items.length ? 'checked' : ''}> <b>Pilih Semua</b></label>
          ${items.map(o => `<label class="check"><input type="checkbox" name="${name}" value="${esc(o.id)}" ${sel.has(String(o.id)) ? 'checked' : ''}> ${esc(o.nama)}</label>`).join('')}
          ${items.length ? '' : '<div class="help">Tidak ada pilihan.</div>'}
        </div>
      </details></div>`;
  }

  /* ================= modal kirim WA (per siswa & massal) ================= */
  /** template tersimpan + template default untuk pilihan di modal */
  function waTemplates() {
    const reminder = require('../reminder');
    const rows = reminder.templateRows(dbm);
    return rows.length ? rows : [{ id: 0, nama: 'Template bawaan', isi: reminder.DEFAULT_TEMPLATE }];
  }
  function waModals(c, d, kelasAll) {
    const reminder = require('../reminder');
    const tpls = waTemplates();
    const cfg = reminder.config(dbm);
    const tplOpts = `<option value="0">— Pesan bawaan (jadwal pengingat) —</option>`
      + tpls.map(t => `<option value="${t.id}" data-isi="${esc(t.isi)}">${esc(t.nama)}</option>`).join('');
    const tplData = JSON.stringify(tpls.map(t => ({ id: t.id, nama: t.nama, isi: t.isi })));
    const kelasOpts = kelasAll.map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('');
    const tingkatOpts = dbm.tingkatAktif().map(t => `<option value="${esc(t)}">${esc(dbm.tingkatLabel(t))} (${esc(t)})</option>`).join('');
    const backTo = `/iuran/data?ta=${d.taId || ''}`;
    return `
    <div data-wa-preview-url="${c.base}/iuran/wa/preview" data-wa-default-pesan="${esc(cfg.template)}" style="display:none"></div>
    <script type="application/json" data-wa-templates>${tplData.replace(/</g, '\\u003c')}</script>
    ${ui.modal('mWaSatu', {
      title: 'Kirim WhatsApp ke Orang Tua',
      body: `<div class="alert info">${ui.icon('whatsapp')}<div>Pesan akan dimasukkan ke <b>antrean pengiriman</b> dan dikirim oleh worker latar
          (jeda acak 2–5 detik antar nomor agar aman dari pemblokiran WhatsApp).</div></div>
        <div id="waSatuInfo" class="wa-modal-info"></div>
        <form method="post" action="${c.base}/iuran/wa/satu" id="fWaSatu">
          <input type="hidden" name="siswa_id" id="waSatuSiswa" value="">
          <input type="hidden" name="back" value="${esc(backTo)}">
          <div class="field"><label>Template Pesan</label>
            <select name="template_id" id="waSatuTpl" data-wa-template-select>${tplOpts}</select></div>
          <div class="field"><label>Isi Pesan (dapat diubah)</label>
            <textarea name="pesan" id="waSatuPesan" rows="9" style="font-size:12.5px;line-height:1.55"></textarea></div>
          <div class="t-sub">Pratinjau pesan final ditampilkan di kotak di bawah ini.</div>
          <div class="wa-bubble mt-1" id="waSatuPreview">—</div>
        </form>`,
      footer: `<button class="btn" data-close="mWaSatu">Batal</button>
        <button class="btn btn-primary" form="fWaSatu">${ui.icon('send')}Masukkan ke Antrean Kirim</button>`
    })}
    ${ui.modal('mWaMassal', {
      title: 'Kirim WhatsApp Massal', wide: true,
      body: `<form method="post" action="${c.base}/iuran/wa/massal" id="fWaMassal">
        <input type="hidden" name="back" value="${esc(backTo)}">
        <div class="alert info">${ui.icon('whatsapp')}<div>Pilih penerima lewat <b>ceklis siswa</b> pada tabel, atau gunakan <b>filter kelas/tingkat</b> di bawah.
          Hanya siswa dengan <b>tunggakan aktif</b> dan <b>nomor HP orang tua</b> yang akan dikirimi pesan. Proses berjalan di latar (antrean) sehingga halaman tidak macet.</div></div>
        <div class="field"><label>Template Pesan</label>
          <select name="template_id" id="waMassalTpl" data-wa-template-select>${tplOpts}</select>
          <div class="hint">Template dapat diubah/ditambah di menu <a href="${c.base}/iuran/pengingat">Jadwal Pengingat Tagihan</a>.</div></div>
        <div class="row2">
          <div class="field"><label>Filter Kelas (bila tidak ada ceklis)</label>
            <select name="kelas" multiple size="5">${kelasOpts}</select>
            <div class="hint">Tekan Ctrl/Cmd untuk memilih beberapa kelas.</div></div>
          <div class="field"><label>Filter Tingkat (bila tidak ada ceklis)</label>
            <select name="tingkat" multiple size="5">${tingkatOpts}</select></div>
        </div>
        <div class="field"><label>Isi Pesan (dapat diubah)</label>
          <textarea name="pesan" id="waMassalPesan" rows="8" style="font-size:12.5px;line-height:1.55"></textarea>
          <div class="hint">Variabel <code>{nama_siswa}</code> <code>{kelas}</code> <code>{nominal_tunggakan}</code>
            <code>{rincian_tagihan}</code> <code>{link_portal}</code> <code>{nama_sekolah}</code> diisi otomatis per siswa.</div></div>
        <div class="wa-preview-row"><b data-wa-count>0</b> <span data-wa-count-label>Orang Tua Siswa Terpilih</span></div>
      </form>`,
      footer: `<button class="btn" data-close="mWaMassal">Batal</button>
        <button class="btn btn-primary" form="fWaMassal">${ui.icon('send')}Proses &amp; Kirim Sekarang</button>`
    })}`;
  }

  get('/iuran/data', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const d = dataIuranRows(req, c);
    const groups = grupList(d.taId);
    const kelasAll = dbm.kelasList(d.taId, {});
    const editable = c.can('iuran', 'edit');
    const canExport = c.can('iuran', 'export') || c.can('laporan', 'export');
    const totalTagih = d.rekap.reduce((s, r) => s + r.tagihan, 0);
    const totalBayar = d.rekap.reduce((s, r) => s + r.terbayar, 0);
    const totalPot = d.rekap.reduce((s, r) => s + r.potongan, 0);
    const totalSisa = d.rekap.reduce((s, r) => s + r.sisa, 0);
    // filter tersimpan sebagai hidden pada form export
    const keepHidden = `<input type="hidden" name="ta" value="${d.taId || ''}">
      <input type="hidden" name="q" value="${esc(d.q)}">
      ${d.kelasIds.map(id => `<input type="hidden" name="kelas" value="${id}">`).join('')}
      ${d.grupIds.map(id => `<input type="hidden" name="grup" value="${id}">`).join('')}
      ${d.tingkatIds.map(id => `<input type="hidden" name="tingkat" value="${esc(id)}">`).join('')}`;

    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Data Iuran &amp; Rekapitulasi Tagihan Siswa</h3>
        <div class="sub">${d.rekap.length} siswa · total tagihan ${rupiah(totalTagih)} · sudah dibayar ${rupiah(totalBayar)}</div></div>
        <div class="toolbar">
          <a class="btn btn-sm" href="${c.base}/iuran/bulanan?ta=${d.taId || ''}">${ui.icon('calendar')}Rincian Bulanan</a>
          <a class="btn btn-sm wa-icon-btn" href="${c.base}/iuran/pengingat">${ui.icon('whatsapp')}Jadwal Pengingat</a>
          ${canExport ? `<form method="get" action="${c.base}/iuran/export" id="fExpIuran" style="display:inline-flex;gap:6px">${keepHidden}
            <button class="btn btn-sm" name="format" value="xlsx">${ui.icon('download')}Export Excel</button>
            <button class="btn btn-sm" name="format" value="pdf" formtarget="_blank">${ui.icon('printer')}Export PDF</button>
          </form>` : ''}
          ${editable ? `<button type="button" class="btn btn-sm wa-icon-btn" data-open="mWaMassal">${ui.icon('whatsapp')}Kirim WA Massal</button>` : ''}
          ${editable ? `<button class="btn btn-sm" data-open="mImportIuran">${ui.icon('upload')}Import Data Iuran</button>
          <a class="btn btn-sm" href="${c.base}/iuran/import/template?ta=${d.taId}">${ui.icon('download')}Download Template Excel</a>` : ''}
        </div></div>
      <form method="get" action="${c.base}/iuran/data" class="filterbar">
        <div class="field"><label>Tahun Pelajaran</label><select name="ta" data-autosubmit>${d.taList.map(t => `<option value="${t.id}" ${String(d.taId) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Nama / NISN <span class="t-sub">(filter langsung saat mengetik)</span></label>
          <input name="q" value="${esc(d.q)}" placeholder="Cari siswa" data-table-search="#tblDataIuran" autocomplete="off"></div>
        ${multiPick('tingkat', 'Tingkat Kelas (multi-pilih)', dbm.tingkatAktif().map(t => ({ id: t, nama: dbm.tingkatLabel(t) + ' (' + t + ')' })), d.tingkatIds)}
        ${multiPick('kelas', 'Kelas spesifik (multi-pilih)', kelasAll.map(k => ({ id: k.id, nama: (k.nama_kelas || k.nama) })), d.kelasIds)}
        ${multiPick('grup', 'Grup Iuran (multi-pilih)', groups, d.grupIds)}
        <button class="btn">${ui.icon('search')}Terapkan</button>
        ${d.kelasIds.length || d.grupIds.length || d.tingkatIds.length || d.q ? `<a class="btn" href="${c.base}/iuran/data?ta=${d.taId || ''}">Reset</a>` : ''}
      </form>
      ${d.rekap.length ? `<div class="between mb-1">
          <div class="small muted">Centang siswa untuk membatasi <b>Export Excel/PDF</b> hanya pada siswa terpilih.</div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-all="siswa">${ui.icon('check')}Pilih Semua Siswa</button>
            <button type="button" class="btn btn-sm" data-check-none="siswa">${ui.icon('x')}Hapus Ceklis</button>
          </div>
        </div>
      <div class="table-scroll tall" id="tblDataIuran"><table><thead><tr>
        <th style="width:36px"><input type="checkbox" data-check-all-box="siswa" title="Pilih semua siswa"></th>
        <th>No</th><th>Nama</th><th>Kelas</th><th class="num">Grand Total Iuran</th><th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Terhutang</th><th class="right">Detail</th>
      </tr></thead><tbody>
      ${d.rekap.map((r, i) => `<tr>
        <td><input type="checkbox" form="fExpIuran" name="siswa" value="${r.siswa_id}"></td>
        <td class="num">${i + 1}</td>
        <td><a class="link-strong" href="${c.base}/iuran/data/${r.siswa_id}?ta=${d.taId || ''}">${esc(r.nama)}</a>
          <div class="t-sub mono">${esc(r.nisn || '')}${r.parent_phone ? ' · ' + esc(lib.phoneDisplay(r.parent_phone)) : ' · <span title="Nomor HP orang tua belum diisi">tanpa no. HP</span>'}</div></td>
        <td>${esc(r.kelas || '-')}</td>
        <td class="num">${rupiah(r.tagihan)}</td><td class="num" style="color:var(--green)">${rupiah(r.terbayar)}</td>
        <td class="num">${rupiah(r.potongan)}</td>
        <td class="num" style="color:${r.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(r.sisa)}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" href="${c.base}/iuran/data/${r.siswa_id}?ta=${d.taId || ''}">${ui.icon('eye')}Detail</a>
          ${editable && r.sisa > 0 ? `<button type="button" class="btn btn-sm wa-icon-btn" data-wa-single="${r.siswa_id}"
            data-wa-nama="${esc(r.nama)}" data-wa-kelas="${esc(r.kelas || '')}"
            title="${r.parent_phone ? 'Kirim WA pengingat ke orang tua' : 'Nomor HP orang tua belum diisi'}">${ui.icon('whatsapp')}WA</button>` : ''}
        </td>
      </tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">TOTAL</td>
        <td class="num">${rupiah(totalTagih)}</td>
        <td class="num">${rupiah(totalBayar)}</td>
        <td class="num">${rupiah(totalPot)}</td>
        <td class="num">${rupiah(totalSisa)}</td><td></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada data iuran', 'Tetapkan grup iuran ke siswa terlebih dahulu.')}
      <p class="help mt-2">Siswa berstatus <b>non-aktif</b> (nonaktif, lulus, pindah, DO) otomatis disembunyikan dari daftar &amp; export ini.
        Kelola atau aktifkan kembali lewat menu <a href="${c.base}/siswa-nonaktif">Siswa Non-Aktif</a>.</p>
    </div>
    ${editable ? ui.modal('mImportIuran', {
      title: 'Import Data Iuran (Excel / CSV)', wide: true,
      body: `<form method="post" action="${c.base}/iuran/import" id="fImportIuran">
        <input type="hidden" name="ta" value="${d.taId}">
        <div class="alert info">${ui.icon('info')}<div><b>Template dinamis:</b> kolom mengikuti grup iuran aktif — <code>[NO] | [NAMA] | [KELAS] | [NAMA GRUP - TANGGAL BAYAR] | [NAMA GRUP - NOMINAL BAYAR]</code>.<br>
          Baris divalidasi (nama &amp; kelas harus cocok, tanggal valid, nominal tidak melebihi sisa) sebelum dicatat.</div></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="iuran_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="iuran_b64" data-max="10">
          <div class="hint" id="iuran_b64-info"></div></div>
      </form>`,
      footer: `<a class="btn" href="${c.base}/iuran/import/template?ta=${d.taId}">${ui.icon('download')}Template Excel</a>
        <button class="btn" data-close="mImportIuran">Batal</button>
        <button class="btn btn-primary" form="fImportIuran">${ui.icon('upload')}Import Sekarang</button>`
    }) : ''}
    ${editable ? waModals(c, d, kelasAll) : ''}`;
    page(req, res, { title: 'Data Iuran', sub: 'Rekapitulasi tagihan & pembayaran iuran siswa', active: 'iuran_data', content: content + impErrorBlock(req) });
  });

  /* detail siswa (iuran) */
  get('/iuran/data/:id', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const s = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id WHERE s.id=?`).get(req.params.id);
    if (!s) return res.notFound();
    /* ---------- ISOLASI TAHUN PELAJARAN ----------
       Detail iuran hanya menampilkan tagihan & pembayaran MILIK SATU tahun pelajaran
       (pilihan ?ta= / TA sesi); tahun lain tidak pernah dicampur. */
    const tagsAll = dbm.iuranTagihanRows({ siswaId: s.id });
    const taIdsAda = [...new Set(tagsAll.map(t => Number(t.tahun_ajaran_id)).filter(Boolean))]
      .sort((a, b) => dbm.taSortKey(b).localeCompare(dbm.taSortKey(a)));
    const taList = dbm.allTahun();
    const qTa = Number(req.query.get('ta') || 0);
    const taSel = (qTa && dbm.tahunById(qTa))
      || taList.find(t => String(t.id) === String(c.taId) && taIdsAda.includes(Number(t.id)))
      || dbm.tahunById(taIdsAda[0]) || c.ta;
    const tags = tagsAll.filter(t => String(t.tahun_ajaran_id) === String(taSel ? taSel.id : ''));
    const pmap = payMapFor(tags.map(t => t.id));
    const rekap = dbm.iuranRekapSiswa(tags)[0] || { tagihan: 0, terbayar: 0, potongan: 0, sisa: 0 };
    const bayar = dbm.iuranBayarRows({ siswaId: s.id, taId: taSel ? taSel.id : undefined });
    const kelasLabel = (tags[0] && tags[0].kelas_nama) || s.kelas_nama;
    const bukuss = db.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan").all((taSel && taSel.id) || c.taId);
    const editable = c.can('iuran', 'edit');
    const late = modalCollector();

    const bayarForm = (t, fid, bulan, maxNominal) => {
      const sisa = Math.max(0, maxNominal !== undefined ? Number(maxNominal) : t.sisa);
      const grupObj = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(t.grup_id);
      const judul = bulan ? `${t.grup_nama} — ${bulanTahunLabel(bulan, taOfGrup(grupObj))}` : t.grup_nama;
      return `<form method="post" action="${c.base}/iuran/bayar" id="${fid}">
        <input type="hidden" name="tagihan_id" value="${t.id}">
        ${bulan ? `<input type="hidden" name="bulan" value="${bulan}">` : ''}
        <input type="hidden" name="back" value="/iuran/data/${s.id}?ta=${taSel ? taSel.id : ''}">
        <div class="alert info" style="margin-bottom:12px">${ui.icon('info')}<div><b>${esc(judul)}</b> — sisa tagihan ${rupiah(sisa)}${bulan ? ' (bulan ini saja)' : ''}</div></div>
        <div class="row2">
          <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal" value="${todayISO()}" required></div>
          <div class="field"><label>Metode Pembayaran</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer / Bank</option></select></div>
        </div>
        <div class="row2">
          <div class="field"><label>Jumlah Iuran (Rp)</label>${ui.moneyInput('jumlah', sisa, 'required data-jumlah')}</div>
          <div class="field"><label>Potongan (Rp)</label>${ui.moneyInput('potongan', 0, 'data-potongan')}</div>
        </div>
        <div class="field"><label>Dibayar (Rp)</label>${ui.moneyInput('dibayar', sisa, 'readonly data-dibayar')}
          <div class="hint">Otomatis = Jumlah Iuran − Potongan.</div></div>
        <div class="field"><label>Pilih BKU Sasaran</label><select name="bku_id" data-bku-select required>
          <option value="">— Pilih BKU tujuan —</option>
          ${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}
        </select><div class="hint">Penerimaan masuk <b>antrean posting</b> dahulu, belum langsung ke BKU.</div></div>
        <label class="check" style="background:var(--o-50);border:1px solid var(--line);border-radius:11px;padding:9px 12px">
          <input type="checkbox" name="nonbku" value="1" data-nonbku>
          <span><b>Hanya Simpan Data Pembayaran (Non-BKU)</b><br>
            <span class="t-sub">Riwayat pembayaran siswa tetap tercatat &amp; tagihan berkurang, tetapi <b>tidak masuk antrean posting</b> dan <b>tidak menambah kas BKU</b>.</span></span>
        </label>
        <div class="field"><label>Keterangan</label><input name="keterangan" value="${bulan ? esc(`${t.grup_nama} — ${bulanTahunLabel(bulan, taOfGrup(grupObj))}`) : ''}" placeholder="Opsional"></div>
      </form>`;
    };

    const content = `<div class="between mb-2">
      <a class="btn" href="${c.base}/iuran/data">${ui.icon('x')}Kembali ke Data Iuran</a>
      <div class="toolbar">
        <a class="btn" href="${c.base}/iuran/transaksi?q=${encodeURIComponent(s.nama)}">${ui.icon('receipt')}Semua Transaksi</a>
      </div></div>
    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>${esc(s.nama)}</h3>
          <div class="sub">${esc(kelasLabel || '-')} · NISN ${esc(s.nisn || '-')} · <b>TA ${esc((taSel && taSel.nama) || '-')}</b></div></div>
          <form method="get" action="${c.base}/iuran/data/${s.id}" class="toolbar">
            <select name="ta" data-autosubmit title="Pilih tahun pelajaran yang ditampilkan">
              ${taList.map(t => `<option value="${t.id}" ${taSel && String(taSel.id) === String(t.id) ? 'selected' : ''}>TA ${esc(t.nama)}${taIdsAda.includes(Number(t.id)) ? ' •' : ''}</option>`).join('')}
            </select>
          </form></div>
        ${tags.length ? '' : `<div class="alert info">${ui.icon('info')}<div>Tidak ada tagihan iuran pada <b>TA ${esc((taSel && taSel.nama) || '-')}</b>. Data tahun pelajaran lain tidak ditampilkan agar tidak tercampur — pilih tahun pelajaran lain pada dropdown di atas.</div></div>`}
        <div class="kpi-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="kpi ic-orange"><div class="lbl">Total Tagihan</div><div class="val" style="font-size:16px">${rupiah(rekap.tagihan)}</div></div>
          <div class="kpi ic-green"><div class="lbl">Sudah Dibayar</div><div class="val" style="font-size:16px">${rupiah(rekap.terbayar)}</div></div>
          <div class="kpi ic-blue"><div class="lbl">Potongan</div><div class="val" style="font-size:16px">${rupiah(rekap.potongan)}</div></div>
          <div class="kpi ic-red"><div class="lbl">Belum Dibayar</div><div class="val" style="font-size:16px">${rupiah(rekap.sisa)}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Riwayat Pembayaran</h3><div class="sub">${bayar.length} transaksi · klik Riwayat untuk rincian</div></div></div>
        ${bayar.length ? `<div class="table-scroll short"><table><thead><tr><th>Tanggal</th><th>Grup</th><th class="num">Jumlah</th><th class="num">Dibayar</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
          ${bayar.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td><td>${esc(b.grup_nama || '-')}</td>
            <td class="num">${rupiah(b.jumlah)}</td><td class="num t-strong">${rupiah(b.dibayar)}</td>
            <td>${bayarStatusBadge(b.status, b.sumber)}</td>
            <td class="right nowrap">
              <button class="btn btn-sm" data-open="mRiwayat${b.tagihan_id}">${ui.icon('clock')}Riwayat</button>
              <a class="btn btn-sm" target="_blank" href="${c.base}/iuran/kwitansi?ids=${b.id}" title="Cetak kwitansi pembayaran ini">${ui.icon('printer')}</a>
            </td></tr>`).join('')}
        </tbody></table></div>` : ui.emptyState('Belum ada pembayaran', 'Klik tombol Bayar pada grup iuran di sebelah kanan.')}
      </div>
    </div>
    <div class="card mt-3">
      <div class="card-head"><div><h3>Grup Iuran Ditetapkan</h3><div class="sub">${tags.length} grup · centang item grup atau per bulan untuk membayar, mencetak kwitansi, atau export</div></div></div>
      ${tags.length ? `<form method="post" action="${c.base}/iuran/bayar-item" id="fItems">
        <input type="hidden" name="back" value="/iuran/data/${s.id}?ta=${taSel ? taSel.id : ''}">
        <div class="row3 mb-2">
          <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal" value="${todayISO()}"></div>
          <div class="field"><label>Metode</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></div>
          <div class="field"><label>BKU Sasaran</label><select name="bku_id">
            <option value="">— Pilih BKU —</option>${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}</select>
            <div class="hint">Wajib dipilih bila tombol <b>Bayar Item Terpilih</b> dipakai.</div></div>
        </div>
        <div class="alert info mb-2">${ui.icon('info')}<div><b>Cetak Kwitansi Terpilih</b> hanya memuat item yang <b>sudah dibayar</b> (item belum dibayar otomatis diabaikan).
          <b>Export Excel Terpilih</b> menampilkan rincian vertikal per item, termasuk item yang belum dibayar.</div></div>
        <div class="table-scroll"><table><thead><tr>
          <th style="width:36px"><input type="checkbox" data-check-all-box="item" title="Pilih semua item"></th>
          <th>Grup Iuran / Bulan</th><th>Jenis</th><th>Status</th><th>Tanggal Bayar</th><th class="num">Jumlah</th>
          <th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Belum Dibayar</th><th class="right">Aksi</th>
        </tr></thead><tbody>
        ${tags.map(t => {
      const grupObj = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(t.grup_id);
      const payments = pmap.get(t.id) || [];
      const last = payments.length ? payments.map(p => p.tanggal).sort().pop() : null;
      const bulanan = t.grup_jenis === 'bulanan';
      const det = bulanan ? monthlyDetail(t, grupObj, payments) : [];
      const lockedTag = isLocked(t);
      const rowHtml = `<tr class="${lockedTag ? 'row-locked' : ''}">
            <td>${bulanan ? '' : `<input type="checkbox" name="item" value="g:${t.id}" data-label="${esc(t.grup_nama)}" data-sisa="${Number(t.sisa) || 0}" ${lockedTag ? 'disabled' : ''}>`}</td>
            <td class="t-strong">${esc(t.grup_nama)}${bulanan ? `<div class="t-sub">${det.filter(m => m.status !== 'lunas').map(m => esc(`${t.grup_nama} - ${bulanTahunLabel(m.bulan, taOfGrup(grupObj))}`)).join(' · ') || 'semua bulan lunas'}</div>` : ''}</td>
            <td>${GROUP_LABEL[t.grup_jenis]}</td>
            <td>${statusBadge(t.status)}${lockedTag ? '<div class="lock-note" style="margin-top:4px">Beasiswa · terkunci</div>' : ''}</td>
            <td class="nowrap">${last ? tglID(last) : '-'}</td>
            <td class="num">${rupiah(t.nominal)}</td><td class="num">${rupiah(t.terbayar)}</td>
            <td class="num">${rupiah(t.total_potongan)}</td><td class="num">${rupiah(t.sisa)}</td>
            <td class="right nowrap">
              <button type="button" class="btn btn-sm" data-open="mRiwayat${t.id}">${ui.icon('clock')}Riwayat</button>
              ${editable && t.sisa > 0 && !lockedTag ? `<button type="button" class="btn btn-sm btn-primary" data-open="mBayar${t.id}">${ui.icon('coins')}${bulanan ? 'Bayar Semua Bulan' : 'Bayar'}</button>` : ''}
            </td></tr>`;
      // rincian per bulan (grup bulanan): deret LENGKAP Juli … Juni, masing-masing bisa dibayar sendiri
      const detMap = new Map(det.map(m => [m.bulan, m]));
      const monthRows = bulanan ? BULAN_TA.map(mb => {
        const m = detMap.get(mb);
        const label = `${t.grup_nama} - ${bulanTahunLabel(mb, taOfGrup(grupObj))}`;
        if (!m) {
          return `<tr class="month-row row-muted${lockedTag ? ' row-locked' : ''}">
            <td></td>
            <td class="month-cell">↳ <b>${esc(label)}</b></td>
            <td class="t-sub">Bulanan</td>
            <td><span class="badge gray plain">Tidak ditagihkan</span></td>
            <td class="t-sub">—</td><td class="num t-sub">—</td><td class="num t-sub">—</td>
            <td class="num t-sub">—</td><td class="num t-sub">—</td><td></td></tr>`;
        }
        const lastM = m.dibayar > 0 ? payments.filter(p => Number(p.bulan) === m.bulan).map(p => p.tanggal).sort().pop()
          || payments.map(p => p.tanggal).sort().pop() : null;
        return `<tr class="month-row${lockedTag ? ' row-locked' : ''}">
          <td><input type="checkbox" name="item" value="m:${t.id}:${m.bulan}" data-label="${esc(label)}" data-sisa="${Number(m.sisa) || 0}" ${lockedTag ? 'disabled' : ''}></td>
          <td class="month-cell">↳ <b>${esc(label)}</b></td>
          <td class="t-sub">Bulanan</td>
          <td>${statusBadge(m.status)}</td>
          <td class="nowrap t-sub">${lastM ? tglID(lastM) : '-'}</td>
          <td class="num">${rupiah(m.tagihan)}</td><td class="num">${rupiah(m.dibayar)}</td>
          <td class="num t-sub">—</td><td class="num">${rupiah(m.sisa)}</td>
          <td class="right nowrap">
            <button type="button" class="btn btn-sm" data-open="mRiwayat${t.id}">${ui.icon('clock')}Riwayat</button>
            ${editable && m.sisa > 0 && !lockedTag ? `<button type="button" class="btn btn-sm btn-primary" data-open="mBayar${t.id}_${m.bulan}">${ui.icon('coins')}Bayar ${esc(bulanLabel(m.bulan))}</button>` : ''}
          </td></tr>
          ${editable && m.sisa > 0 ? late('mBayar' + t.id + '_' + m.bulan, {
          title: 'Form Bayar Iuran — ' + t.grup_nama + ' ' + bulanTahunLabel(m.bulan, taOfGrup(grupObj)),
          body: bayarForm(t, 'fb' + t.id + '_' + m.bulan, m.bulan, m.sisa),
          footer: `<button class="btn" data-close="mBayar${t.id}_${m.bulan}">Batal</button><button class="btn btn-primary" form="fb${t.id}_${m.bulan}">${ui.icon('save')}Simpan &amp; Cetak Kwitansi</button>`
        }) : ''}`;
      }).join('') : '';
      return rowHtml + monthRows + late('mBayar' + t.id, {
        title: 'Form Bayar Iuran — ' + t.grup_nama, body: bayarForm(t, 'fb' + t.id),
        footer: `<button class="btn" data-close="mBayar${t.id}">Batal</button><button class="btn btn-primary" form="fb${t.id}">${ui.icon('save')}Simpan &amp; Cetak Kwitansi</button>`
      }) + late('mRiwayat' + t.id, {
        title: 'Riwayat Pembayaran — ' + t.grup_nama, wide: true,
        body: riwayatHtml(t, c, grupObj)
      });
    }).join('')}
        </tbody></table></div>
        <div class="form-actions">
          <button type="button" class="btn" data-check-all="item">${ui.icon('check')}Pilih Semua</button>
          <button type="button" class="btn" data-check-none="item">${ui.icon('x')}Hapus Ceklis</button>
          ${editable ? `<button type="button" class="btn btn-primary" data-bulk-pay>${ui.icon('coins')}Bayar Item Terpilih</button>` : ''}
          <button class="btn" formmethod="get" formaction="${c.base}/iuran/data/${s.id}/kwitansi-terpilih" formtarget="_blank">${ui.icon('printer')}Cetak Kwitansi Terpilih</button>
          <button class="btn" formmethod="get" formaction="${c.base}/iuran/data/${s.id}/export-item">${ui.icon('download')}Export Excel Terpilih</button>
        </div>
      </form>` : ui.emptyState('Belum ada grup iuran ditetapkan', 'Tetapkan grup iuran dari menu Grup Iuran → Detail.')}
      ${late.html()}
      ${editable ? ui.modal('mBayarItem', {
      title: 'Bayar Item Iuran Terpilih', wide: true,
      body: `<form method="post" action="${c.base}/iuran/bayar-item" id="fBulkPay">
        <input type="hidden" name="back" value="/iuran/data/${s.id}">
        <input type="hidden" name="n" value="0" data-bulk-n>
        <div class="alert info">${ui.icon('info')}<div>Atur <b>tanggal, metode, jumlah, potongan, dan BKU</b> untuk setiap item. Jumlah dikosongkan = otomatis sebesar sisa tagihan item.
          Centang <b>Non-BKU</b> pada baris tertentu bila pembayaran hanya ingin dicatat sebagai data (tanpa menambah kas).</div></div>
        <div class="row2 mb-2">
          <div class="field"><label>Tanggal Default</label><input type="date" value="${todayISO()}" data-bulk-date></div>
          <div class="field"><label>BKU Default (diterapkan ke semua baris)</label>
            <select data-bulk-bku><option value="">— Pilih BKU —</option>${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}</select></div>
        </div>
        <div class="table-wrap"><table class="grid-tbl"><thead><tr>
          <th>Item Iuran</th><th style="width:130px">Tanggal</th><th style="width:110px">Metode</th>
          <th style="width:120px">Jumlah (Rp)</th><th style="width:110px">Potongan</th>
          <th style="width:160px">BKU Tujuan</th><th style="width:78px">Non-BKU</th>
        </tr></thead><tbody data-bulk-rows></tbody></table></div>
        <div class="help mt-1">Item yang sudah lunas otomatis tidak dapat dibayar.</div>
      </form>`,
      footer: `<button class="btn" data-close="mBayarItem">Batal</button>
        <button class="btn btn-primary" form="fBulkPay">${ui.icon('save')}Simpan Pembayaran</button>`
    }) : ''}
    </div>`;
    page(req, res, { title: 'Detail Iuran Siswa', sub: 'Tagihan, riwayat & pembayaran', active: 'iuran_data', content });
  });

  /* =========================================================
     RINCIAN IURAN BULANAN — deret bulan eksplisit Juli … Juni
     Satu baris per siswa, satu kolom per bulan tahun pelajaran.
     ========================================================= */
  get('/iuran/bulanan', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const taList = dbm.allTahun();
    const taId = Number(req.query.get('ta') || c.taId || 0) || (taList[0] ? taList[0].id : null);
    const taRow = taId ? dbm.tahunById(taId) : null;
    const q = String(req.query.get('q') || '').trim();
    const siswaId = Number(req.query.get('siswa') || 0) || null;
    const kelasIds = (req.query.getAll ? req.query.getAll('kelas') : []).map(Number).filter(Boolean);
    const grupIds = (req.query.getAll ? req.query.getAll('grup') : []).map(Number).filter(Boolean);
    const grupAll = grupList(taId).filter(g => g.jenis === 'bulanan');
    const grupSel = grupIds.length ? grupAll.filter(g => grupIds.includes(Number(g.id))) : grupAll;
    const kelasAll = dbm.kelasList(taId, {});

    const tags = dbm.iuranTagihanRows({
      taId, q, aktifOnly: true,
      kelasId: kelasIds.length ? kelasIds : undefined,
      grupId: grupSel.length ? grupSel.map(g => g.id) : [-1]
    }).filter(t => grupSel.some(g => Number(g.id) === Number(t.grup_id)));

    // seluruh pembayaran (non-void) pada TA ini dikelompokkan per tagihan
    // (satu query per TA — hindari daftar parameter IN yang bisa sangat panjang di sekolah besar)
    const payMap = new Map();
    if (tags.length) {
      const tagSet = new Set(tags.map(t => Number(t.id)));
      const rows = db.prepare(`SELECT b.tagihan_id, b.jumlah, b.potongan, b.bulan, b.tanggal
        FROM iuran_bayar b JOIN iuran_tagihan t ON t.id=b.tagihan_id
        WHERE b.status<>'void' AND t.tahun_ajaran_id=? ORDER BY b.tanggal, b.id`).all(taId);
      for (const r of rows) {
        if (!tagSet.has(Number(r.tagihan_id))) continue;
        if (!payMap.has(r.tagihan_id)) payMap.set(r.tagihan_id, []);
        payMap.get(r.tagihan_id).push(r);
      }
    }

    // grupkan tagihan per siswa
    const bySiswa = new Map();
    for (const t of tags) {
      if (!bySiswa.has(t.siswa_id)) bySiswa.set(t.siswa_id, { id: t.siswa_id, nama: t.siswa_nama || t.nama, nisn: t.nisn, kelas: t.kelas_nama, tags: [] });
      bySiswa.get(t.siswa_id).tags.push(t);
    }
    let students = Array.from(bySiswa.values()).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    if (siswaId) students = students.filter(s => Number(s.id) === siswaId);

    const bulanHead = BULAN_TA.map(b => bulanTahunLabel(b, taRow));
    const rows = students.map(s => {
      const cells = BULAN_TA.map(b => ({ bulan: b, tagihan: 0, dibayar: 0 }));
      for (const t of s.tags) {
        const g = grupSel.find(x => Number(x.id) === Number(t.grup_id)) || {};
        const det = monthlyDetail(t, g, payMap.get(t.id) || []);
        for (const m of det) {
          const cell = cells.find(x => x.bulan === m.bulan);
          if (!cell) continue;
          cell.tagihan += Number(m.tagihan || 0);
          cell.dibayar += Number(m.dibayar || 0);
        }
      }
      const tagihan = cells.reduce((a, x) => a + x.tagihan, 0);
      const dibayar = cells.reduce((a, x) => a + x.dibayar, 0);
      return { ...s, cells, tagihan, dibayar, sisa: Math.max(0, tagihan - dibayar) };
    });

    const sumTagihan = rows.reduce((a, r) => a + r.tagihan, 0);
    const sumBayar = rows.reduce((a, r) => a + r.dibayar, 0);
    /* SATU HALAMAN BERURUTAN DI DALAM SCROLLABLE BOX (tanpa pagination) */
    const hal = 1;
    const pageRows = rows;
    const keepHidden = `<input type="hidden" name="ta" value="${taId || ''}"><input type="hidden" name="q" value="${esc(q)}">
      ${kelasIds.map(id => `<input type="hidden" name="kelas" value="${id}">`).join('')}
      ${grupIds.map(id => `<input type="hidden" name="grup" value="${id}">`).join('')}`;
    const cellHtml = (cell) => {
      if (!cell.tagihan) return '<td class="num bulan-cell kosong"><span class="t-sub">—</span></td>';
      const lunas = cell.dibayar >= cell.tagihan;
      const sebagian = cell.dibayar > 0 && !lunas;
      const cls = lunas ? 'lunas' : sebagian ? 'sebagian' : 'kurang';
      const mark = lunas ? '✓' : sebagian ? '½' : '!';
      const title = `${bulanLabel(cell.bulan)}: tagihan ${rupiah(cell.tagihan)} · dibayar ${rupiah(cell.dibayar)} · sisa ${rupiah(Math.max(0, cell.tagihan - cell.dibayar))}`;
      return `<td class="num bulan-cell ${cls}" title="${esc(title)}"><span class="bc-nom">${num(cell.tagihan)}</span><span class="bc-mark">${mark}</span></td>`;
    };

    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Rincian Iuran Bulanan per Siswa</h3>
        <div class="sub">${rows.length} siswa · ${esc(grupSel.map(g => g.nama).join(', ') || 'belum ada grup bulanan')} · total tagihan ${rupiah(sumTagihan)} · sudah dibayar ${rupiah(sumBayar)}</div></div>
        <div class="toolbar"><a class="btn btn-sm" href="${c.base}/iuran/data?ta=${taId || ''}">${ui.icon('card')}Kembali ke Data Iuran</a></div></div>
      <form method="get" action="${c.base}/iuran/bulanan" class="filterbar">
        <div class="field"><label>Tahun Pelajaran</label><select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taId) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Nama / NISN</label><input name="q" value="${esc(q)}" placeholder="Cari siswa" data-table-search="#tblBulanan" autocomplete="off"></div>
        ${multiPick('kelas', 'Kelas (multi-pilih)', kelasAll, kelasIds)}
        ${multiPick('grup', 'Grup Bulanan (multi-pilih)', grupAll, grupIds)}
        <button class="btn">${ui.icon('search')}Terapkan</button>
        ${kelasIds.length || grupIds.length || q ? `<a class="btn" href="${c.base}/iuran/bulanan?ta=${taId || ''}">Reset</a>` : ''}
      </form>
      <div class="alert info mb-2">${ui.icon('info')}<div>Setiap kolom adalah <b>bulan tagihan</b> pada tahun pelajaran ini (Juli s.d. Juni).
        Tanda <b>✓</b> = lunas, <b>½</b> = dibayar sebagian, <b>!</b> = belum dibayar, <b>—</b> = bulan tersebut tidak ditagihkan.</div></div>
      ${rows.length ? `<div class="table-scroll tall" id="tblBulanan"><table class="bulanan-tbl"><thead><tr>
        <th class="sticky-col">No</th><th class="sticky-col2">Nama Siswa</th><th>Kelas</th>
        ${bulanHead.map((l, i) => `<th class="num bulan-head" title="${esc(l)}">${esc(bulanLabel(BULAN_TA[i]))}<div class="t-sub">${esc((l.match(/\d{4}$/) || [''])[0])}</div></th>`).join('')}
        <th class="num">Total Tagihan</th><th class="num">Sudah Dibayar</th><th class="num">Terhutang</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${pageRows.map((r, i) => `<tr>
        <td class="num sticky-col">${i + 1}</td>
        <td class="sticky-col2"><a class="link-strong" href="${c.base}/iuran/data/${r.id}?ta=${taId || ''}">${esc(r.nama)}</a><div class="t-sub mono">${esc(r.nisn || '')}</div></td>
        <td>${esc(r.kelas || '-')}</td>
        ${r.cells.map(cellHtml).join('')}
        <td class="num">${rupiah(r.tagihan)}</td>
        <td class="num" style="color:var(--green)">${rupiah(r.dibayar)}</td>
        <td class="num" style="color:${r.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(r.sisa)}</td>
        <td class="right"><a class="btn btn-sm" href="${c.base}/iuran/data/${r.id}?ta=${taId || ''}">${ui.icon('coins')}Bayar</a></td>
      </tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">TOTAL</td>
        ${BULAN_TA.map(b => {
      const t = rows.reduce((a, r) => a + (r.cells.find(x => x.bulan === b) || {}).tagihan, 0);
      return `<td class="num">${t ? num(t) : '—'}</td>`;
    }).join('')}
        <td class="num">${rupiah(sumTagihan)}</td><td class="num">${rupiah(sumBayar)}</td>
        <td class="num">${rupiah(Math.max(0, sumTagihan - sumBayar))}</td><td></td></tr></tfoot></table></div>
        <p class="help mt-2">${rows.length} siswa ditampilkan berurutan dalam satu kotak — geser ke samping untuk melihat seluruh bulan. Klik nama siswa untuk membuka rincian &amp; form pembayaran per bulan. Ekspor daftar ini memakai tombol <b>Export Excel</b> pada menu Data Iuran.</p>`
        : ui.emptyState('Belum ada tagihan bulanan', 'Tetapkan grup iuran bulanan (mis. SPP) ke siswa terlebih dahulu.')}
    </div>`;
    page(req, res, { title: 'Rincian Iuran Bulanan', sub: 'Deret tagihan bulanan Juli s.d. Juni per siswa', active: 'iuran_bulanan', content });
  });

  function riwayatHtml(t, c, grupObj) {
    const rows = dbm.iuranBayarRows({ tagihanId: t.id });
    if (!rows.length) return '<div class="empty"><p>Belum ada pembayaran.</p></div>';
    const ta = taOfGrup(grupObj);
    return `<div class="table-wrap"><table><thead><tr><th>No</th><th>Untuk Bulan</th><th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Total</th><th>Metode</th><th>Status</th><th>Keterangan</th><th>Tanggal Bayar</th><th>Pencatat</th><th class="right">Aksi</th></tr></thead><tbody>
      ${rows.map((b, i) => `<tr><td class="num">${i + 1}</td>
        <td>${b.bulan ? esc(`${t.grup_nama} - ${bulanTahunLabel(b.bulan, ta)}`) : '<span class="t-sub">Gabungan semua bulan</span>'}</td>
        <td class="num">${rupiah(b.jumlah)}</td><td class="num">${rupiah(b.potongan)}</td>
        <td class="num t-strong">${rupiah(b.dibayar)}</td>
        <td>${b.sumber === 'beasiswa' ? 'Beasiswa' : b.metode === 'tunai' ? 'Tunai' : 'Transfer'}</td>
        <td>${bayarStatusBadge(b.status, b.sumber)}</td>
        <td>${esc(b.keterangan || '-')}</td><td class="nowrap">${tglID(b.tanggal)}</td><td>${esc(b.pencatat || '-')}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" target="_blank" href="${c.base}/iuran/kwitansi?ids=${b.id}" title="Cetak kwitansi pembayaran ini">${ui.icon('printer')}</a>
          ${c.can('iuran', 'delete') && b.status !== 'void' && b.sumber !== 'beasiswa' && b.status !== 'beasiswa' ? `<form method="post" action="${c.base}/iuran/bayar/delete" style="display:inline" data-confirm="Hapus pembayaran ini? Tagihan kembali belum dibayar${b.status === 'posted' ? ' dan transaksi BKU terkait ikut dihapus' : ''}.">
            <input type="hidden" name="id" value="${b.id}"><input type="hidden" name="back" value="/iuran/data/${b.siswa_id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* =========================================================
     PEMBAYARAN IURAN
     ========================================================= */
  post('/iuran/bayar', (req, res) => {
    guard(req, res, 'iuran', 'create');
    const backRaw = String(req.body.back || '/iuran/data');
    const backPath = safeBack(backRaw, '/iuran/data');
    const back = req.BASE + backPath;
    const ids = [].concat(req.body.tagihan_id || []).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Pilih minimal satu grup iuran yang akan dibayar.'));
    const locked = ids.map(id => db.prepare('SELECT * FROM iuran_tagihan WHERE id=?').get(id)).filter(t => t && Number(t.beasiswa_locked) === 1);
    if (locked.length) {
      return res.redirect(back + '?err=' + encodeURIComponent('Tagihan yang dibayar otomatis oleh beasiswa terkunci dan tidak dapat dibayar manual. Ubah melalui menu Beasiswa SPP.'));
    }
    const tanggal = req.body.tanggal || todayISO();
    // "Hanya Simpan Data Pembayaran (Non-BKU)" — riwayat siswa saja, tanpa antrean & tanpa kas BKU
    const nonBku = String(req.body.nonbku || '') === '1';
    const bkuId = Number(req.body.bku_id || 0);
    const bku = bkuId ? db.prepare('SELECT * FROM bku WHERE id=?').get(bkuId) : null;
    const multi = ids.length > 1;
    if (!nonBku && !bku) return res.redirect(back + '?err=' + encodeURIComponent('Pilih BKU sasaran terlebih dahulu (atau centang “Hanya Simpan Data Pembayaran”).'));
    /* Tahun pelajaran / periode lama TIDAK lagi memblokir pencatatan pembayaran.
       Pembayaran tetap disimpan (antrean posting); kunci periode hanya diberitahukan
       sebagai catatan dan baru berlaku saat posting ke BKU. */
    let peringatan = '';
    if (bku && bku.status !== 'aktif') {
      peringatan = `BKU ${bku.nama} sedang ditutup — pembayaran tersimpan di antrean posting dan dapat diposting setelah BKU dibuka kembali.`;
    } else if (bku) {
      const lock = dbm.periodeLockError(bku.id, tanggal);
      if (lock) peringatan = `${lock} Pembayaran tetap disimpan di antrean posting.`;
    }

    const jumlah = lib.parseMoney(req.body.jumlah);
    const potongan = lib.parseMoney(req.body.potongan);
    const bulanParam = Number(req.body.bulan || 0) || null;
    const kwitansiNo = nextKwitansiNo();
    const statusBayar = nonBku ? 'manual' : 'pending';
    let total = 0, n = 0;
    const inserted = [];
    const errs = [];
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,bulan,tanggal,jumlah,potongan,dibayar,metode,keterangan,bku_id,status,kwitansi_no,print_count,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`);
      for (const id of ids) {
        const t = db.prepare('SELECT * FROM iuran_tagihan WHERE id=?').get(id);
        if (!t) { errs.push('Tagihan tidak ditemukan.'); continue; }
        const grupObj = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(t.grup_id);
        const rows = dbm.iuranTagihanRows({ siswaId: t.siswa_id, grupId: t.grup_id });
        const row = rows.find(r => r.id === t.id);
        if (!row) { errs.push('Tagihan tidak ditemukan.'); continue; }
        let bulan = null, sisa = Math.max(0, row.sisa), label = row.grup_nama;
        if (bulanParam && !multi) {
          const det = monthRow(row, grupObj, bulanParam, (payMapFor([row.id]).get(row.id) || []));
          if (!det) { errs.push(`Rincian bulan untuk ${row.grup_nama} tidak ditemukan.`); continue; }
          bulan = det.bulan;
          sisa = det.sisa;
          label = `${row.grup_nama} - ${bulanTahunLabel(det.bulan, taOfGrup(grupObj))}`;
        }
        let j = multi ? Math.max(0, row.sisa) : (jumlah || sisa);
        let p = multi ? 0 : Math.max(0, potongan);
        if (j <= 0) { errs.push(`${label} sudah lunas.`); continue; }
        if (j > sisa) { errs.push(`Jumlah pembayaran ${label} melebihi sisa tagihan (${rupiah(sisa)}).`); continue; }
        if (p > j) p = j;
        const dibayar = j - p;
        const ket = req.body.keterangan || (bulan ? label : '');
        const info = ins.run(t.id, t.siswa_id, bulan, tanggal, j, p, dibayar, req.body.metode === 'transfer' ? 'transfer' : 'tunai',
          ket, nonBku ? null : bku.id, statusBayar, kwitansiNo, req.user.id, nowStamp());
        inserted.push(Number(info.lastInsertRowid));
        total += dibayar; n++;
      }
    })();
    if (!n) return res.redirect(back + '?err=' + encodeURIComponent(errs[0] || 'Tidak ada pembayaran yang dapat disimpan.'));
    dbm.logAudit(req.user, 'BAYAR IURAN', 'iuran',
      `Kwitansi ${kwitansiNo}: ${n} grup, ${rupiah(total)} ${nonBku ? '(data pembayaran saja — NON-BKU)' : '(antrean posting ' + bku.nama + ')'}`);
    const msg = (nonBku
      ? `Pembayaran dicatat (${n} item, ${rupiah(total)}) sebagai DATA PEMBAYARAN SAJA — tidak masuk antrean posting & tidak menambah kas BKU.`
      : `Pembayaran dicatat (${n} grup, ${rupiah(total)}). Masuk antrean posting BKU ${bku.nama}.`) + (peringatan ? ' Catatan: ' + peringatan : '');
    // `rows` = hanya pembayaran yang baru dibuat, sehingga kwitansi tidak mencampur item lain
    // `back` dibawa ke halaman kwitansi agar tombol Kembali/Tutup kembali ke halaman detail siswa
    res.redirect(req.BASE + `/iuran/kwitansi?rows=${inserted.join(',')}&auto=1&back=${encodeURIComponent(backPath)}&info=` + encodeURIComponent(msg));
  });

  /* =========================================================
     BAYAR ITEM TERPILIH (per grup / per bulan, input massal per item)
     ========================================================= */
  post('/iuran/bayar-item', (req, res) => {
    guard(req, res, 'iuran', 'create');
    const backPath = safeBack(req.body.back, '/iuran/data');
    const back = req.BASE + backPath;

    // ---- kumpulkan item: mode baru (n + key_i …) atau mode lama (item[])
    const rowsIn = [];
    const nIn = Number(req.body.n || 0);
    if (nIn > 0) {
      for (let i = 0; i < nIn; i++) {
        const key = String(req.body['key_' + i] || '');
        if (!key) continue;
        rowsIn.push({
          key,
          tanggal: String(req.body['tanggal_' + i] || ''),
          metode: String(req.body['metode_' + i] || 'tunai'),
          jumlah: req.body['jumlah_' + i],
          potongan: req.body['potongan_' + i],
          bku: req.body['bku_' + i],
          nonbku: String(req.body['nonbku_' + i] || '') === '1'
        });
      }
    } else {
      const legacy = parseItemKeys(req.body.item);
      for (const it of legacy) {
        rowsIn.push({
          key: it.key, tanggal: String(req.body.tanggal || ''), metode: String(req.body.metode || 'tunai'),
          jumlah: '', potongan: '', bku: req.body.bku_id, nonbku: String(req.body.nonbku || '') === '1'
        });
      }
    }
    if (!rowsIn.length) return res.redirect(back + '?err=' + encodeURIComponent('Centang minimal satu item iuran (grup atau bulan) terlebih dahulu.'));

    const kwitansiNo = nextKwitansiNo();
    const inserted = [];
    const errs = [];
    let total = 0, n = 0, nonBkuN = 0, peringatan = '';
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,bulan,tanggal,jumlah,potongan,dibayar,metode,keterangan,bku_id,status,kwitansi_no,print_count,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`);
      for (const r of rowsIn) {
        const parsed = parseItemKeys(r.key)[0];
        if (!parsed) { errs.push('Item tidak dikenali.'); continue; }
        const t = db.prepare('SELECT * FROM iuran_tagihan WHERE id=?').get(parsed.tagihanId);
        if (!t) { errs.push('Tagihan tidak ditemukan.'); continue; }
        if (Number(t.beasiswa_locked) === 1) { errs.push('Tagihan terkunci karena dibayar otomatis oleh beasiswa — ubah melalui menu Beasiswa SPP.'); continue; }
        const grupObj = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(t.grup_id) || {};
        const row = dbm.iuranTagihanRows({ siswaId: t.siswa_id, grupId: t.grup_id }).find(x => x.id === t.id);
        if (!row) { errs.push('Tagihan tidak ditemukan.'); continue; }
        const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(r.tanggal) ? r.tanggal : todayISO();
        let bulan = null, sisa = Math.max(0, row.sisa), label = row.grup_nama;
        if (parsed.mode === 'm' && parsed.bulan) {
          const det = monthRow(row, grupObj, parsed.bulan, (payMapFor([row.id]).get(row.id) || []));
          if (!det) { errs.push(`Rincian bulan untuk ${row.grup_nama} tidak ditemukan.`); continue; }
          bulan = det.bulan;
          sisa = Math.max(0, det.sisa);
          label = `${row.grup_nama} - ${bulanTahunLabel(det.bulan, taOfGrup(grupObj))}`;
        }
        if (sisa <= 0) { errs.push(`${label} sudah lunas.`); continue; }

        // nominal & potongan per item (kosong = sisa penuh)
        let jumlah = lib.parseMoney(r.jumlah);
        if (!(jumlah > 0)) jumlah = sisa;
        if (jumlah > sisa) { errs.push(`Jumlah bayar ${label} (${rupiah(jumlah)}) melebihi sisa ${rupiah(sisa)}.`); continue; }
        let pot = Math.max(0, lib.parseMoney(r.potongan));
        if (pot > jumlah) pot = jumlah;
        const dibayar = jumlah - pot;

        // BKU: wajib bila bukan mode non-BKU (kunci periode/BKU hanya jadi peringatan)
        let bku = null;
        if (!r.nonbku) {
          bku = r.bku ? db.prepare('SELECT * FROM bku WHERE id=?').get(r.bku) : null;
          if (!bku) { errs.push(`BKU sasaran untuk ${label} belum dipilih.`); continue; }
          if (bku.status !== 'aktif') peringatan = `BKU ${bku.nama} sedang ditutup — pembayaran tersimpan di antrean posting.`;
          else {
            const lock = dbm.periodeLockError(bku.id, tanggal);
            if (lock && !peringatan) peringatan = `${lock} Pembayaran tetap disimpan di antrean posting.`;
          }
        } else nonBkuN++;

        const info = ins.run(t.id, t.siswa_id, bulan, tanggal, jumlah, pot, dibayar,
          r.metode === 'transfer' ? 'transfer' : 'tunai', label, bku ? bku.id : null,
          bku ? 'pending' : 'manual', kwitansiNo, req.user.id, nowStamp());
        inserted.push(Number(info.lastInsertRowid));
        total += dibayar; n++;
      }
    })();
    if (!n) return res.redirect(back + '?err=' + encodeURIComponent(errs[0] || 'Tidak ada item yang dapat dibayar.'));
    dbm.logAudit(req.user, 'BAYAR IURAN', 'iuran',
      `Kwitansi ${kwitansiNo}: ${n} item iuran, ${rupiah(total)}${nonBkuN ? `, ${nonBkuN} item non-BKU` : ''}${errs.length ? `, ${errs.length} dilewati` : ''}`);
    const msg = `Pembayaran dicatat (${n} item, ${rupiah(total)}).` +
      (nonBkuN ? ` ${nonBkuN} item disimpan sebagai data pembayaran saja (non-BKU).` : ' Masuk antrean posting BKU.') +
      (peringatan ? ` Catatan: ${peringatan}` : '') +
      (errs.length ? ` ${errs.length} item dilewati: ${errs[0]}` : '');
    res.redirect(req.BASE + `/iuran/kwitansi?rows=${inserted.join(',')}&auto=1&back=${encodeURIComponent(backPath)}&info=` + encodeURIComponent(msg));
  });

  post('/iuran/bayar/delete', (req, res) => {
    guard(req, res, 'iuran', 'delete');
    const backRaw = String(req.body.back || '/iuran/transaksi');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/iuran/transaksi';
    const b = db.prepare('SELECT * FROM iuran_bayar WHERE id=?').get(req.body.id);
    if (!b) return res.redirect(req.BASE + backPath + '?err=' + encodeURIComponent('Data pembayaran tidak ditemukan.'));
    if (b.status === 'void') return res.redirect(req.BASE + backPath + '?err=' + encodeURIComponent('Pembayaran ini sudah void.'));
    if (b.sumber === 'beasiswa' || b.status === 'beasiswa') {
      return res.redirect(req.BASE + backPath + '?err=' + encodeURIComponent('Pembayaran ini dibuat otomatis oleh beasiswa dan terkunci. Ubah/hapus melalui menu Beasiswa SPP.'));
    }
    // sinkronisasi: hapus riwayat bayar → tagihan kembali terutang;
    // bila sudah terposting ke BKU, record BKU sasaran ikut dihapus (saudara se-kwitansi kembali ke antrean).
    let trxDihapus = 0, kembaliAntrean = 0;
    if (b.transaksi_id) {
      const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(b.transaksi_id);
      if (t && t.status !== 'void') {
        const lockErr = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
        if (lockErr) return res.redirect(req.BASE + backPath + '?err=' + encodeURIComponent('Transaksi BKU terkait tidak dapat dihapus: ' + lockErr));
        db.transaction(() => {
          for (const sib of db.prepare('SELECT * FROM iuran_bayar WHERE transaksi_id=? AND id<>?').all(t.id, b.id)) {
            if (sib.status === 'posted') kembaliAntrean++;
          }
          db.prepare("UPDATE iuran_bayar SET status='pending', transaksi_id=NULL, posted_at=NULL, bku_id=NULL WHERE transaksi_id=? AND id<>? AND status='posted'").run(t.id, b.id);
          db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
          trxDihapus = 1;
        })();
      }
    }
    dbm.trashAdd('iuran_bayar', b, { user: req.user, label: `Pembayaran iuran ${b.kwitansi_no}` });
    db.prepare('DELETE FROM iuran_bayar WHERE id=?').run(b.id);
    dbm.logAudit(req.user, 'HAPUS', 'iuran',
      `Menghapus pembayaran iuran ${b.kwitansi_no} (${rupiah(b.dibayar)})${trxDihapus ? ' + transaksi BKU terkait dihapus' : ''}${kembaliAntrean ? ` · ${kembaliAntrean} pembayaran lain kembali ke antrean` : ''}`);
    const msg = `Pembayaran dihapus, tagihan kembali terutang.${trxDihapus ? ' Transaksi BKU sasaran ikut dihapus.' : ''}${kembaliAntrean ? ` ${kembaliAntrean} pembayaran lain pada kwitansi yang sama dikembalikan ke antrean posting.` : ''}`;
    res.redirect(req.BASE + backPath + '?ok=' + encodeURIComponent(msg));
  });

  /* ================= HAPUS MASAL PEMBAYARAN IURAN ================= */
  post('/iuran/bayar/hapus-masal', (req, res) => {
    guard(req, res, 'iuran', 'delete');
    const backRaw = String(req.body.back || '/iuran/transaksi');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/iuran/transaksi';
    const ids = [].concat(req.body.ids || []).flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(req.BASE + backPath + '?err=' + encodeURIComponent('Tidak ada data yang dipilih. Centang minimal satu baris.'));
    const out = hapusBayarMassal(ids, req.user);
    dbm.logAudit(req.user, 'HAPUS', 'iuran',
      `Hapus masal ${out.deleted} pembayaran iuran (${ids.length} dipilih)` +
      `${out.trxDihapus ? ` · ${out.trxDihapus} transaksi BKU dihapus` : ''}` +
      `${out.kembaliAntrean ? ` · ${out.kembaliAntrean} pembayaran lain kembali ke antrean` : ''}` +
      `${out.ditolak.length ? ` · ${out.ditolak.length} ditolak` : ''}`);
    if (!out.deleted) {
      return res.redirect(req.BASE + backPath + '?err=' + encodeURIComponent('Tidak ada data yang bisa dihapus. ' + out.ditolak.slice(0, 4).join('; ')));
    }
    const msg = `${out.deleted} data pembayaran dihapus & hilang dari riwayat transaksi siswa.` +
      `${out.trxDihapus ? ` ${out.trxDihapus} transaksi BKU terkait ikut dihapus.` : ''}` +
      `${out.kembaliAntrean ? ` ${out.kembaliAntrean} pembayaran lain pada kwitansi yang sama dikembalikan ke antrean.` : ''}` +
      `${out.ditolak.length ? ` ${out.ditolak.length} baris dilewati: ${out.ditolak.slice(0, 3).join('; ')}.` : ''}`;
    res.redirect(req.BASE + backPath + (out.ditolak.length ? '?warn=' : '?ok=') + encodeURIComponent(msg));
  });

  /* =========================================================
     KWITANSI IURAN (ukuran kertas custom + label replika)
     ========================================================= */
  get('/iuran/kwitansi', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const nos = String(req.query.get('no') || '').split(',').map(s => s.trim()).filter(Boolean);
    const rowIds = [].concat(req.query.getAll ? req.query.getAll('ids') : req.query.get('ids') || [])
      .flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    // ?rows=<id,id> = hanya pembayaran yang BARU SAJA dibuat (kwitansi tidak mencampur item lain)
    const justSaved = String(req.query.get('rows') || '').split(',').map(v => Number(v.trim())).filter(Boolean);
    let rows = [];
    if (justSaved.length) rows = dbm.iuranBayarRows({}).filter(b => justSaved.includes(b.id));
    else if (nos.length) rows = dbm.iuranBayarRows({}).filter(b => nos.includes(b.kwitansi_no));
    else if (rowIds.length) rows = dbm.iuranBayarRows({}).filter(b => rowIds.includes(b.id));
    if (!rows.length) return res.redirect(c.base + '/iuran/data?err=' + encodeURIComponent('Data kwitansi tidak ditemukan.'));
    const groups = new Map();
    for (const b of rows) {
      const k = b.kwitansi_no || ('ROW' + b.id);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    const printedAt = nowStamp();
    const W = Number(dbm.getSetting('kwitansi_w_mm', '210')) || 210;
    const H = Number(dbm.getSetting('kwitansi_h_mm', '99')) || 99;
    const M = Number(dbm.getSetting('kwitansi_margin_mm', '6'));
    const s = c.settings;

    const KW = printcfg.labels(dbm, 'kwitansi_iuran');
    let pages = '';
    let firstNo = '';
    for (const [no, list] of groups) {
      if (!firstNo) firstNo = no;
      // hitung frekuensi cetak (semua baris pada kwitansi yang sama)
      const maxCount = Math.max(...list.map(b => Number(b.print_count) || 0));
      const count = maxCount + 1;
      db.prepare('UPDATE iuran_bayar SET print_count=? WHERE id IN (' + list.map(() => '?').join(',') + ')')
        .run(count, ...list.map(b => b.id));
      dbm.logAudit(req.user, 'CETAK KWITANSI', 'iuran', `Cetak kwitansi ${no} (cetakan ke-${count})`);
      const siswa = list[0];
      const totalJumlah = list.reduce((s2, b) => s2 + Number(b.jumlah || 0), 0);
      const totalPotongan = list.reduce((s2, b) => s2 + Number(b.potongan || 0), 0);
      const grand = list.reduce((s2, b) => s2 + Number(b.dibayar || 0), 0);
      const replica = count > 1;
      pages += `<div class="kwit-iuran kuitansi-container${list.length > 6 ? ' dense' : ''}" style="${replica ? 'position:relative' : ''}">
        ${replica ? `<div class="replica-tag">CETAKAN REPLIKA / DUPLIKAT (Printed on: ${esc(printedAt)})</div>` : ''}
        <div class="ki-head">
          <div>
            ${ui.hasKopCfg(s, 'kwitansi') ? `<div class="ki-kop">${ui.kwitansiKop(s)}</div>` : ''}
            <div class="ki-title">${esc(KW.judul || 'BUKTI PEMBAYARAN SISWA')}</div>
            ${ui.hasKopCfg(s, 'kwitansi') ? '' : `<div class="ki-school">${esc(s.sekolah_nama || '')}</div>`}
          </div>
          <div class="ki-no">
            <div>No. Transaksi</div><div class="mono">${esc(no)}</div>
            <div class="sm">Cetakan ke-${count}</div>
          </div>
        </div>
        <table class="ki-meta"><tbody>
          <tr><td class="k">NISN</td><td class="v mono">${esc(siswa.nisn || '-')}</td><td class="k">Tanggal</td><td class="v">${tglID(siswa.tanggal)}</td></tr>
          <tr><td class="k">Nama</td><td class="v">${esc(siswa.siswa_nama || '-')}</td><td class="k">Jam Cetak</td><td class="v">${esc(printedAt.slice(11))}</td></tr>
          <tr><td class="k">Kelas</td><td class="v">${esc(siswa.kelas_nama || '-')}</td><td class="k">Metode</td><td class="v">${siswa.metode === 'tunai' ? 'Tunai' : 'Transfer'}</td></tr>
        </tbody></table>
        <table class="ki-items"><thead><tr><th style="width:26px">No</th><th>Grup Iuran</th><th>Jenis</th><th>Keterangan</th><th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${list.map((b, i) => {
        const taG = b.grup_ta_id ? dbm.tahunById(b.grup_ta_id) : null;
        const nm = b.bulan ? `${b.grup_nama || '-'} - ${bulanTahunLabel(b.bulan, taG)}` : (b.grup_nama || '-');
        return `<tr><td class="num">${i + 1}</td><td>${esc(nm)}</td>
            <td>${b.grup_jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'}</td><td>${esc(b.keterangan || '-')}</td>
            <td class="num">${num(b.jumlah)}</td><td class="num">${num(b.potongan)}</td><td class="num">${num(b.dibayar)}</td></tr>`;
      }).join('')}
        </tbody>
        <tfoot><tr><td colspan="4">GRAND TOTAL</td><td class="num">${num(totalJumlah)}</td><td class="num">${num(totalPotongan)}</td><td class="num">${num(grand)}</td></tr></tfoot></table>
        <div class="ki-terbilang"><b>Terbilang:</b> ${esc(terbilangRupiah(grand))}</div>
        <div class="ki-sign single">
          <div>${esc(s.print_tempat || 'Cikoneng')}, ${tglID(siswa.tanggal)}<br><b>${esc(siswa.pencatat || req.user.nama)}</b><div class="sp"></div><div class="ln">${esc(KW.pencatat || 'Pencatat')}</div></div>
        </div>
      </div>`;
    }
    const innerW = Math.max(60, W - M * 2);
    const innerH = Math.max(30, H - M * 2);
    const single = groups.size === 1;
    const orient = printcfg.orient(req, dbm, 'kwitansi_iuran');
    const small = orient === 'small';
    const pageCss = small ? `@page{size:${W}mm ${H}mm; margin:${M}mm}
      html,body{margin:0;padding:0}
      .print-area{padding:0}
      /* satu kwitansi = tepat tinggi area cetak (1/3 F4) → tidak pernah melimpah ke halaman ke-2 */
      .kwit-iuran{width:${innerW}mm; height:${Math.max(20, innerH - 0.8)}mm; max-height:${Math.max(20, innerH - 0.8)}mm; overflow:hidden; border:1px solid #452; border-radius:2mm; padding:2mm 2.6mm; font-size:8pt; line-height:1.15; box-sizing:border-box; page-break-after:always; break-after:page; page-break-inside:avoid; break-inside:avoid; background:#fff}
      .kwit-iuran:last-child{page-break-after:auto; break-after:auto}
      .kwit-iuran.dense{font-size:6.9pt; padding:1.2mm 2mm}
      .ki-head{display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1.4px solid #452; padding-bottom:1mm; margin-bottom:1.2mm; line-height:1.15}
      .ki-title{font-size:10.5pt; font-weight:800; letter-spacing:.05em; line-height:1.1}
      .ki-school{font-size:7pt; color:#444; text-transform:uppercase; line-height:1.15}
      .ki-no{text-align:right; font-size:6.6pt; line-height:1.2}
      .ki-no .sm{color:#666; font-size:5.8pt}
      .ki-meta{width:100%; border-collapse:collapse; font-size:7pt; margin-bottom:1mm; line-height:1.15}
      .ki-meta td{padding:.2mm .6mm .2mm 0; vertical-align:top}
      .ki-meta .k{width:15mm; color:#555}
      .ki-meta .v{width:auto; font-weight:600}
      .ki-items{width:100%; border-collapse:collapse; font-size:7pt; line-height:1.15}
      .ki-items th,.ki-items td{border:.5px solid #999; padding:.45mm .8mm}
      .ki-items th{background:#FCEFE3; text-align:left; font-size:6.7pt}
      .ki-items .num{text-align:right}
      tfoot td{font-weight:800; background:#FFF7F1}
      .ki-terbilang{font-size:6.8pt; font-style:italic; margin-top:.6mm; line-height:1.15}
      .ki-sign{display:flex; justify-content:flex-end; gap:6mm; margin-top:1mm; font-size:6.8pt; text-align:center; line-height:1.15}
      .ki-sign.single > div{min-width:44mm}
      .ki-sign .sp{height:6mm}
      .ki-sign .ln{border-top:.5px solid #777; padding-top:.3mm; font-size:6.2pt; color:#555}
      .replica-tag{position:absolute; top:2mm; right:3mm; font-size:6pt; color:#B45309; border:1px dashed #B45309; padding:.5mm 1.2mm; border-radius:1mm; background:#FFFBEB; max-width:58mm; text-align:right; line-height:1.2}
      @media print{
        html{height:100% !important; max-height:100% !important; overflow:hidden !important; margin:0 !important; padding:0 !important}
        .doc-actions{display:none !important}
        body.kw-iuran-single{height:${innerH}mm !important; max-height:${innerH}mm !important; overflow:hidden !important; margin:0 !important; padding:0 !important}
        body.kw-iuran-single .print-area{padding:0 !important; margin:0 !important; max-height:${innerH}mm; overflow:hidden}
        .kwit-iuran{page-break-inside:avoid !important; break-inside:avoid !important}
        .kwit-iuran:not(:last-child){page-break-after:always !important; break-after:page !important}
      }`
      : `@page{size:A4 ${orient === 'landscape' ? 'landscape' : 'portrait'}; margin:10mm}
      html,body{margin:0;padding:0;background:#fff}
      .print-area{padding:0}
      .kwit-iuran{width:100%; max-width:100%; height:auto; min-height:0; overflow:visible; border:1.2px solid #452; border-radius:2mm; padding:5mm 6mm; font-size:10pt; line-height:1.4; box-sizing:border-box; page-break-after:always; break-after:page; page-break-inside:avoid; break-inside:avoid; background:#fff; margin-bottom:6mm}
      .kwit-iuran:last-child{page-break-after:auto; break-after:auto}
      .kwit-iuran.dense{font-size:9.5pt; padding:4mm}
      .ki-head{display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1.6px solid #452; padding-bottom:2mm; margin-bottom:3mm}
      .ki-title{font-size:13pt; font-weight:800; letter-spacing:.05em}
      .ki-school{font-size:9pt; color:#444; text-transform:uppercase; margin-top:1mm}
      .ki-no{text-align:right; font-size:8.5pt; line-height:1.4}
      .ki-no .sm{color:#666; font-size:7.5pt}
      .ki-meta{width:100%; border-collapse:collapse; font-size:9.5pt; margin-bottom:3mm}
      .ki-meta td{padding:1mm 1mm 1mm 0; vertical-align:top}
      .ki-meta .k{width:28mm; color:#555}
      .ki-meta .v{font-weight:600}
      .ki-items{width:100%; border-collapse:collapse; font-size:9.5pt}
      .ki-items th,.ki-items td{border:.6px solid #999; padding:1.4mm 2mm}
      .ki-items th{background:#FCEFE3; text-align:left; font-size:9pt}
      .ki-items .num{text-align:right}
      tfoot td{font-weight:800; background:#FFF7F1}
      .ki-terbilang{font-size:9pt; font-style:italic; margin-top:2mm}
      .ki-sign{display:flex; justify-content:flex-end; gap:10mm; margin-top:6mm; font-size:9.5pt; text-align:center}
      .ki-sign.single > div{min-width:64mm}
      .ki-sign .sp{height:18mm}
      .ki-sign .ln{border-top:.6px solid #777; padding-top:1mm; font-size:8.5pt; color:#555}
      .replica-tag{font-size:7.5pt; color:#B45309; border:1px dashed #B45309; padding:1mm 2mm; border-radius:1mm; background:#FFFBEB; text-align:right; margin-bottom:2mm}
      @media print{ .doc-actions{display:none !important} }`;
    res.html(ui.printPage({
      settings: s, base: c.base, title: 'Bukti Pembayaran Siswa',
      backHref: safeBack(req.query.get('back'), '/iuran/transaksi'),
      backLabel: /^\/iuran\/data\/\d+/.test(safeBack(req.query.get('back'), '')) ? 'Kembali ke Detail Siswa' : 'Kembali',
      bodyClass: 'print-page kw-iuran-page' + (small && single ? ' kw-iuran-single' : ''),
      orient, selfPath: req.url,
      pageCss, body: (req.query.get('info') ? `<div class="alert ok no-print" style="max-width:${small ? innerW + 'mm' : '100%'};margin-bottom:6mm">${ui.icon('check')}<div>${esc(req.query.get('info'))}</div></div>` : '') + pages
    }).replace('</body>', `${req.query.get('auto') ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400));</script>' : ''}</body>`));
  });

  /* =========================================================
     KWITANSI IURAN SELEKTIF (hanya item terpilih yang SUDAH DIBAYAR)
     ========================================================= */
  get('/iuran/data/:id/kwitansi-terpilih', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const s = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id WHERE s.id=?`).get(req.params.id);
    if (!s) return res.notFound();
    const backPath = `/iuran/data/${s.id}`;
    const items = parseItemKeys(req.query.getAll ? req.query.getAll('item') : req.query.get('item'));
    if (!items.length) return res.redirect(c.base + backPath + '?err=' + encodeURIComponent('Centang minimal satu item iuran (grup atau bulan) terlebih dahulu.'));
    const { lines } = selectionLines(s.id, items);
    // validasi data cetak: hanya item yang benar-benar sudah dibayar (pembayaran non-void & nominal > 0)
    const paid = lines.filter(l => Number(l.dibayar) > 0 && l.status !== 'void');
    const skipped = lines.length - paid.length;
    if (!paid.length) {
      return res.redirect(c.base + backPath + '?err=' + encodeURIComponent('Tidak ada item terbayar pada pilihan Anda. Kwitansi hanya memuat item iuran yang sudah dibayar.'));
    }
    const totTagih = paid.reduce((a, l) => a + l.tagihan, 0);
    const totPot = paid.reduce((a, l) => a + l.potongan, 0);
    const grand = paid.reduce((a, l) => a + l.dibayar, 0);
    const printedAt = nowStamp();
    const pencatat = [...new Set(paid.map(l => l.pencatat).filter(Boolean))].join(', ') || req.user.nama;

    // bukti pembayaran = dokumen KWITANSI → memakai template kop kwitansi (bukan kop laporan)
    const body = `${ui.kop(c.settings, 'kwitansi')}
      <div class="doc-title" style="text-align:center;margin:4mm 0 3mm">
        <h3 style="font-size:13pt;margin:0">${esc(printcfg.labels(dbm, 'kwitansi_iuran').judul || 'BUKTI PEMBAYARAN IURAN SISWA')}</h3>
        <div class="no">Kwitansi selektif — ${paid.length} item iuran</div>
      </div>
      <table class="tbl meta"><tbody>
        <tr><td class="k">Nama Siswa</td><td class="v"><b>${esc(s.nama)}</b></td><td class="k">NISN</td><td class="v">${esc(s.nisn || '-')}</td></tr>
        <tr><td class="k">Kelas</td><td class="v">${esc(s.kelas_nama || '-')}</td><td class="k">Waktu Cetak</td><td class="v">${esc(printedAt)}</td></tr>
      </tbody></table>
      <table class="tbl"><thead><tr>
        <th style="width:8mm">No</th><th>Grup Iuran / Bulan</th><th style="width:22mm">Jenis</th><th style="width:22mm">Status</th>
        <th style="width:24mm">Tanggal Bayar</th><th class="num" style="width:26mm">Jumlah Tagihan</th>
        <th class="num" style="width:22mm">Potongan</th><th class="num" style="width:26mm">Sudah Dibayar</th>
      </tr></thead><tbody>
      ${paid.map((l, i) => `<tr><td class="num">${i + 1}</td><td>${esc(l.label)}</td>
        <td>${esc(l.jenis)}</td><td>${esc(statusText(l.status))}</td>
        <td class="nowrap">${l.tanggal ? tglID(l.tanggal) : '-'}</td>
        <td class="num">${num(l.tagihan)}</td><td class="num">${num(l.potongan)}</td>
        <td class="num"><b>${num(l.dibayar)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="5">JUMLAH</td><td class="num">${num(totTagih)}</td>
        <td class="num">${num(totPot)}</td><td class="num">${num(grand)}</td></tr></tfoot></table>
      <div class="terbilang"><b>Terbilang:</b> ${esc(terbilangRupiah(grand))}</div>
      ${skipped ? `<div class="note">Catatan: ${skipped} item yang dipilih belum dibayar sehingga tidak dimuat pada kwitansi ini.</div>` : ''}
      <div class="sign">
        <div>${esc(c.settings.print_tempat || 'Cikoneng')}, ${tglID(paid[0].tanggal || todayISO())}<br><b>${esc(pencatat)}</b><div class="sp"></div><div class="ln">${esc(printcfg.labels(dbm, 'kwitansi_iuran').pencatat || 'Pencatat')}</div></div>
      </div>`;
    dbm.logAudit(req.user, 'CETAK KWITANSI', 'iuran', `Cetak kwitansi selektif ${s.nama}: ${paid.length} item, ${rupiah(grand)}`);
    const selOrient = printcfg.orient(req, dbm, 'kwitansi_iuran');
    res.html(ui.printPage({
      settings: c.settings, base: c.base, title: 'Kwitansi Iuran Terpilih', backHref: backPath, backLabel: 'Kembali ke Detail Siswa',
      orient: selOrient === 'small' ? 'portrait' : selOrient, selfPath: req.url,
      pageCss: `@page{size:A4 ${selOrient === 'landscape' ? 'landscape' : 'portrait'};margin:12mm}
        .print-area{padding:0}
        .doc-title .no{font-size:9pt;color:#555}
        .tbl{width:100%;border-collapse:collapse;font-size:9pt}
        .tbl th,.tbl td{border:1px solid #333;padding:1.5mm 2mm}
        .tbl th{background:#FCEFE3;text-align:left;font-size:8.4pt}
        .tbl .num{text-align:right}
        .tbl.meta{border:0;margin-bottom:3mm}
        .tbl.meta td{border:0;padding:.8mm 2mm .8mm 0}
        .tbl.meta .k{width:24mm;color:#555}
        .tbl.meta .v{width:auto}
        .terbilang{font-size:8.6pt;font-style:italic;margin-top:2mm}
        .note{font-size:8pt;color:#B45309;margin-top:1.5mm}
        .sign{display:flex;justify-content:flex-end;margin-top:8mm;font-size:9pt;text-align:center}
        .sign > div{min-width:60mm}
        .sign .sp{height:14mm}
        .sign .ln{border-top:.6px solid #555;padding-top:1mm;font-size:8pt;color:#555}
        thead{display:table-header-group} tr{page-break-inside:avoid}`,
      body
    }));
  });

  /* =========================================================
     EXPORT EXCEL DETAIL VERTIKAL (per item terpilih)
     ========================================================= */
  get('/iuran/data/:id/export-item', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const s = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id WHERE s.id=?`).get(req.params.id);
    if (!s) return res.notFound();
    const backPath = `/iuran/data/${s.id}`;
    const items = parseItemKeys(req.query.getAll ? req.query.getAll('item') : req.query.get('item'));
    if (!items.length) return res.redirect(c.base + backPath + '?err=' + encodeURIComponent('Centang minimal satu item iuran terlebih dahulu.'));
    const { lines } = selectionLines(s.id, items);
    if (!lines.length) return res.redirect(c.base + backPath + '?err=' + encodeURIComponent('Item yang dipilih tidak ditemukan pada data iuran siswa ini.'));
    const head = ['GRUP IURAN / BULAN', 'JENIS', 'STATUS', 'TANGGAL BAYAR', 'JUMLAH TAGIHAN', 'SUDAH DIBAYAR', 'POTONGAN', 'BELUM DIBAYAR', 'NAMA PENCATAT'].map(v => ({ v, bold: true }));
    const rows = [
      [{ v: 'RINCIAN IURAN SISWA (VERTIKAL PER ITEM)', bold: true }],
      [{ v: 'Nama', bold: true }, s.nama, '', { v: 'NISN', bold: true }, s.nisn || '-', '', { v: 'Kelas', bold: true }, s.kelas_nama || '-'],
      [{ v: 'Tahun Pelajaran', bold: true }, (c.ta || {}).nama || '-', '', { v: 'Dicetak', bold: true }, nowStamp()],
      [],
      head,
      ...lines.map(l => [l.label, l.jenis, statusText(l.status), l.tanggal || '', Number(l.tagihan), Number(l.dibayar), Number(l.potongan), Number(l.sisa), l.pencatat || ''])
    ];
    rows.push(['', '', '', 'TOTAL', lines.reduce((a, l) => a + l.tagihan, 0), lines.reduce((a, l) => a + l.dibayar, 0),
      lines.reduce((a, l) => a + l.potongan, 0), lines.reduce((a, l) => a + l.sisa, 0), '']);
    const nm = String(s.nama).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'siswa';
    dbm.logAudit(req.user, 'EXPORT', 'iuran', `Export rincian iuran ${s.nama}: ${lines.length} item terpilih`);
    xlsxSend(res, `rincian-iuran-${nm}.xlsx`, 'Rincian Iuran', rows, [34, 14, 16, 14, 16, 16, 14, 16, 24]);
  });

  /* pengaturan ukuran kertas kwitansi */
  get('/iuran/kertas', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const W = dbm.getSetting('kwitansi_w_mm', '210'), H = dbm.getSetting('kwitansi_h_mm', '99'), M = dbm.getSetting('kwitansi_margin_mm', '6');
    const content = `<div class="card" style="max-width:620px">
      <div class="card-head"><div><h3>Pengaturan Ukuran Kertas Kwitansi</h3><div class="sub">Default: 21 cm × 9,9 cm (1/3 F4 / envelope landscape)</div></div></div>
      <form method="post" action="${c.base}/iuran/kertas">
        <div class="row3">
          <div class="field"><label>Panjang (mm)</label><input type="number" step="0.5" min="60" name="w_mm" value="${esc(W)}" required></div>
          <div class="field"><label>Lebar / Tinggi (mm)</label><input type="number" step="0.5" min="30" name="h_mm" value="${esc(H)}" required></div>
          <div class="field"><label>Margin (mm)</label><input type="number" step="0.5" min="0" name="margin_mm" value="${esc(M)}" required></div>
        </div>
        <div class="alert info">${ui.icon('info')}<div>Nilai dalam <b>milimeter</b>. 21 cm = 210 mm · 9,9 cm = 99 mm. Ukuran ini dipakai pada semua cetakan kwitansi iuran.</div></div>
        <button class="btn btn-primary">${ui.icon('save')}Simpan Ukuran Kertas</button>
      </form>
      <p class="help mt-2">Pada dialog cetak browser, pilih kertas sesuai ukuran ini (atau <b>Custom</b>) dan pastikan skala 100% agar hasil pas.</p>
    </div>`;
    page(req, res, { title: 'Ukuran Kertas Kwitansi', sub: 'Atur dimensi & margin cetak kwitansi', active: 'iuran_data', content });
  });

  post('/iuran/kertas', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const w = Number(req.body.w_mm), h = Number(req.body.h_mm), m = Number(req.body.margin_mm);
    if (!(w >= 60 && w <= 500) || !(h >= 30 && h <= 500) || !(m >= 0 && m <= 40))
      return res.redirect(req.BASE + '/iuran/kertas?err=' + encodeURIComponent('Ukuran tidak valid (panjang 60–500 mm, tinggi 30–500 mm, margin 0–40 mm).'));
    dbm.setSetting('kwitansi_w_mm', w);
    dbm.setSetting('kwitansi_h_mm', h);
    dbm.setSetting('kwitansi_margin_mm', m);
    dbm.logAudit(req.user, 'EDIT', 'iuran', `Ukuran kertas kwitansi: ${w}×${h} mm, margin ${m} mm`);
    res.redirect(req.BASE + '/iuran/kertas?ok=' + encodeURIComponent('Ukuran kertas kwitansi disimpan.'));
  });

  /* =========================================================
     TRANSAKSI IURAN
     ========================================================= */
  function trxFilters(req) {
    return {
      q: req.query.get('q') || '',
      tingkat: req.query.get('tingkat') || '',
      kelas: req.query.get('kelas') || '',
      grup: req.query.get('grup') || '',
      metode: req.query.get('metode') || '',
      dari: req.query.get('dari') || '',
      sampai: req.query.get('sampai') || ''
    };
  }
  function filterRows(rows, f) {
    return rows.filter(b =>
      (!f.q || (String(b.siswa_nama || '') + ' ' + String(b.nisn || '')).toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.tingkat || String(b.tingkat || '') === f.tingkat) &&
      (!f.kelas || String(b.kelas_nama || '') === f.kelas) &&
      (!f.grup || String(b.grup_id || '') === f.grup) &&
      (!f.metode || b.metode === f.metode) &&
      (!f.dari || String(b.tanggal) >= f.dari) && (!f.sampai || String(b.tanggal) <= f.sampai));
  }

  get('/iuran/transaksi', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const taId = Number(req.query.get('ta') || c.taId || 0) || null;
    const taList = dbm.allTahun();
    const f = trxFilters(req);
    const rows = filterRows(dbm.iuranBayarRows({ taId }), f);
    const groups = grupList(taId);
    const kelasAll = dbm.kelasList(taId, {});
    const canExport = c.can('iuran', 'export') || c.can('laporan', 'export');
    const qs = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    qs.set('ta', taId || '');
    const late = (() => { const l = []; const p = (id, o) => { l.push(ui.modal(id, o)); return ''; }; p.html = () => l.join(''); return p; })();
    const canVoid = c.can('transaksi', 'edit');
    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Transaksi Iuran</h3><div class="sub">${rows.length} transaksi · terbaru di paling atas</div></div>
        <div class="toolbar">
          ${canExport ? `<a class="btn btn-sm" href="${c.base}/iuran/transaksi/export?format=xlsx&${qs}">${ui.icon('download')}Export Excel</a>
          <a class="btn btn-sm" target="_blank" href="${c.base}/iuran/transaksi/export?format=pdf&${qs}">${ui.icon('printer')}Export PDF</a>` : ''}
          <a class="btn btn-sm" href="${c.base}/iuran/kertas">${ui.icon('settings')}Ukuran Kertas</a>
        </div></div>
      <form method="get" action="${c.base}/iuran/transaksi" class="filterbar">
        <div class="field"><label>Tahun Pelajaran</label><select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taId) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Nama Siswa <span class="t-sub">(filter langsung)</span></label><input name="q" value="${esc(f.q)}" placeholder="Cari nama / NISN" data-table-search="#tblTrxIuran" autocomplete="off"></div>
        <div class="field"><label>Tingkat Kelas</label><select name="tingkat"><option value="">Semua tingkat</option>
          ${dbm.tingkatAktif().map(t => `<option value="${esc(t)}" ${f.tingkat === String(t) ? 'selected' : ''}>${esc(dbm.tingkatLabel(t))} (${esc(t)})</option>`).join('')}</select></div>
        <div class="field"><label>Kelas Spesifik</label><select name="kelas"><option value="">Semua</option>${kelasAll.map(k => `<option value="${esc(k.nama_kelas || k.nama)}" ${f.kelas === (k.nama_kelas || k.nama) ? 'selected' : ''}>${esc(k.nama_kelas || k.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Grup Iuran</label><select name="grup"><option value="">Semua</option>${groups.map(g => `<option value="${g.id}" ${String(f.grup) === String(g.id) ? 'selected' : ''}>${esc(g.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Metode</label><select name="metode"><option value="">Semua</option><option value="tunai" ${f.metode === 'tunai' ? 'selected' : ''}>Tunai</option><option value="transfer" ${f.metode === 'transfer' ? 'selected' : ''}>Transfer</option></select></div>
        <div class="field"><label>Dari</label><input type="date" name="dari" value="${esc(f.dari)}"></div>
        <div class="field"><label>Sampai</label><input type="date" name="sampai" value="${esc(f.sampai)}"></div>
        <button class="btn">${ui.icon('filter')}Terapkan</button>
      </form>
      <form id="fKwit" method="get" action="${c.base}/iuran/kwitansi" target="_blank">
        <input type="hidden" name="back" value="/iuran/transaksi?${qs}">
      </form>
      ${rows.length ? `<div class="between mb-1">
        <div class="small muted">Centang beberapa transaksi lalu cetak kwitansinya sekaligus.
          Terpilih: <b data-check-count="ids" data-check-scope="#tblTrxIuran">0</b> transaksi.</div>
        <div class="toolbar">
          <button type="button" class="btn btn-sm" data-check-all="ids" data-check-scope="#tblTrxIuran">${ui.icon('check')}Pilih Semua</button>
          <button type="button" class="btn btn-sm" data-check-none="ids" data-check-scope="#tblTrxIuran">${ui.icon('x')}Hapus Ceklis</button>
          <button class="btn btn-sm btn-primary" form="fKwit" type="submit">${ui.icon('printer')}Print Kwitansi Terpilih</button>
          ${c.can('iuran', 'delete') ? `<button class="btn btn-sm btn-danger" form="fKwit" type="submit"
            formaction="${c.base}/iuran/bayar/hapus-masal" formmethod="post" formtarget="_self"
            data-confirm-click="Hapus semua transaksi iuran yang dicentang? Riwayat pembayaran siswa dihapus, tagihan kembali terutang, dan transaksi BKU terkait ikut dihapus.">
            ${ui.icon('trash')}Hapus Terpilih (<b data-check-count="ids">0</b>)</button>` : ''}
        </div></div>
      <div class="table-scroll tall" id="tblTrxIuran"><table><thead><tr>
        <th style="width:34px"><input type="checkbox" data-check-all-box="ids"></th>
        <th>Tanggal</th><th>No. Kwitansi</th><th>Nama Siswa</th><th>Kelas</th><th>Grup Iuran</th><th>Metode</th>
        <th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Dibayar</th><th>Status BKU</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(b => `<tr>
        <td><input type="checkbox" form="fKwit" name="ids" value="${b.id}" ${b.status === 'void' ? 'disabled' : ''}></td>
        <td class="nowrap">${tglID(b.tanggal)}</td>
        <td class="mono">${esc(b.kwitansi_no || '-')}</td>
        <td class="t-strong"><a class="link-strong" href="${c.base}/iuran/data/${b.siswa_id}">${esc(b.siswa_nama || '-')}</a><div class="t-sub mono">${esc(b.nisn || '')}</div></td>
        <td>${esc(b.kelas_nama || '-')}</td><td>${esc(b.grup_nama || '-')}</td>
        <td>${b.metode === 'tunai' ? ui.badge('Tunai', 'gray') : ui.badge('Transfer', 'blue')}</td>
        <td class="num">${rupiah(b.jumlah)}</td><td class="num">${rupiah(b.potongan)}</td><td class="num t-strong">${rupiah(b.dibayar)}</td>
        <td>${bayarStatusBadge(b.status, b.sumber)}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" target="_blank" href="${c.base}/iuran/kwitansi?ids=${b.id}" title="Print kwitansi pembayaran ini">${ui.icon('printer')}</a>
          ${c.can('iuran', 'delete') && b.status !== 'void' ? `<form method="post" action="${c.base}/iuran/bayar/delete" style="display:inline" data-confirm="Hapus transaksi iuran ini? Riwayat pembayaran dihapus, tagihan kembali terutang${b.status === 'posted' ? ', dan record BKU sasaran ikut dihapus' : ''}.">
            <input type="hidden" name="id" value="${b.id}"><input type="hidden" name="back" value="/iuran/transaksi?${qs}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          ${canVoid && b.status === 'posted' && b.transaksi_id ? `<button class="btn btn-sm btn-warn" data-open="mVoidIur${b.id}" title="Batalkan transaksi (void)">${ui.icon('x')}Void</button>` : ''}
        </td></tr>
        ${canVoid && b.status === 'posted' && b.transaksi_id ? late('mVoidIur' + b.id, {
        title: 'Batalkan Transaksi (Void) — ' + (b.kwitansi_no || ''),
        body: `<form method="post" action="${c.base}/transaksi/void" id="fvi${b.id}">
            <input type="hidden" name="id" value="${b.transaksi_id}">
            <input type="hidden" name="back" value="/iuran/transaksi?${qs}">
            <div class="alert warn">${ui.icon('alert')}<div><b>Void penerimaan ${esc(b.grup_nama || '')} — ${rupiah(b.dibayar)}.</b><br>
              Sistem membuat <b>jurnal pembalik</b> di BKU dan mengembalikan tagihan iuran siswa menjadi <b>belum dibayar</b>.</div></div>
            <div class="field"><label>Alasan Pembatalan / Void <span style="color:var(--red)">*</span></label>
              <textarea name="alasan" required placeholder="Contoh: pembayaran dibatalkan / salah input nominal"></textarea></div>
          </form>`,
        footer: `<button class="btn" data-close="mVoidIur${b.id}">Batal</button><button class="btn btn-danger" form="fvi${b.id}">${ui.icon('x')}Void &amp; Jurnal Pembalik</button>`
      }) : ''}`).join('')}
      </tbody><tfoot><tr><td colspan="7">TOTAL</td><td class="num">${rupiah(rows.reduce((s, b) => s + Number(b.jumlah || 0), 0))}</td>
        <td class="num">${rupiah(rows.reduce((s, b) => s + Number(b.potongan || 0), 0))}</td>
        <td class="num">${rupiah(rows.reduce((s, b) => s + Number(b.dibayar || 0), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada transaksi iuran', 'Transaksi muncul setelah pembayaran iuran dicatat.')}
      ${late.html()}
    </div>`;
    page(req, res, { title: 'Transaksi Iuran', sub: 'Riwayat penerimaan iuran siswa', active: 'iuran_trx', content });
  });

  get('/iuran/transaksi/export', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const taId = Number(req.query.get('ta') || c.taId || 0) || null;
    const f = trxFilters(req);
    const rows = filterRows(dbm.iuranBayarRows({ taId }), f);
    if (req.query.get('format') === 'pdf') {
      const body = `<div class="doc-title"><h3>Laporan Transaksi Iuran Siswa</h3><div class="no">${rows.length} transaksi</div></div>
      <table class="tbl"><thead><tr><th>No</th><th>Tanggal</th><th>No. Kwitansi</th><th>Nama</th><th>Kelas</th><th>Grup</th><th>Metode</th><th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Dibayar</th></tr></thead><tbody>
      ${rows.map((b, i) => `<tr><td class="num">${i + 1}</td><td>${tglID(b.tanggal)}</td><td class="mono">${esc(b.kwitansi_no)}</td>
        <td>${esc(b.siswa_nama)}</td><td>${esc(b.kelas_nama || '')}</td><td>${esc(b.grup_nama || '')}</td>
        <td>${b.metode}</td><td class="num">${num(b.jumlah)}</td><td class="num">${num(b.potongan)}</td><td class="num">${num(b.dibayar)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="7">TOTAL</td><td class="num">${num(rows.reduce((s, b) => s + Number(b.jumlah || 0), 0))}</td>
        <td class="num">${num(rows.reduce((s, b) => s + Number(b.potongan || 0), 0))}</td><td class="num">${num(rows.reduce((s, b) => s + Number(b.dibayar || 0), 0))}</td></tr></tfoot></table>`;
      return res.html(ui.docPage({ settings: c.settings, base: c.base, title: 'Transaksi Iuran', no: '', body, backHref: '/iuran/transaksi', orient: printcfg.orient(req, dbm, 'laporan_piutang'), selfPath: req.url }));
    }
    const head = ['NO', 'TANGGAL', 'NO. KWITANSI', 'NAMA SISWA', 'NISN', 'KELAS', 'GRUP IURAN', 'METODE', 'JUMLAH', 'POTONGAN', 'DIBAYAR', 'STATUS']
      .map(v => ({ v, bold: true }));
    xlsxSend(res, 'transaksi-iuran.xlsx', 'Transaksi Iuran',
      [head, ...rows.map((b, i) => [i + 1, b.tanggal, b.kwitansi_no || '', b.siswa_nama || '', b.nisn || '', b.kelas_nama || '',
        b.grup_nama || '', b.metode, Number(b.jumlah || 0), Number(b.potongan || 0), Number(b.dibayar || 0),
        bayarStatusText(b.status, b.sumber)])],
      [6, 12, 22, 28, 14, 14, 24, 10, 14, 12, 14, 14]);
  });

  /* =========================================================
     ANTREAN POSTING BKU
     ========================================================= */
  function queueRows(taId) {
    const rows = dbm.iuranBayarRows({ taId, status: 'pending' });
    const map = new Map();
    for (const b of rows) {
      const key = (b.grup_id || 0) + '|' + String(b.tanggal).slice(0, 10) + '|' + (b.bku_id || 0);
      if (!map.has(key)) {
        const g = b.grup_id ? db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(b.grup_id) : null;
        map.set(key, {
          key, grup_id: b.grup_id, grup_nama: b.grup_nama || '-', grup: g,
          coa_id: g && g.coa_id ? g.coa_id : null,
          tanggal: String(b.tanggal).slice(0, 10), bku_id: b.bku_id, bku_nama: b.bku_nama || '-', n: 0, total: 0, rows: []
        });
      }
      const q = map.get(key);
      q.n++; q.total += Number(b.dibayar || 0); q.rows.push(b);
    }
    return Array.from(map.values()).sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
  }
  /** pilihan kode rekening penerimaan untuk review posting */
  function coaOptions(selected) {
    const def = coaIuran();
    const sel = selected || (def ? def.id : null);
    return coaPenerimaanList().map(x => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.kode + ' · ' + x.nama)}</option>`).join('');
  }

  /** toolbar hapus masal (ceklis + pilih semua + tombol hapus) — `scope` = selector tabel sasaran */
  function deleteToolbar(n, c, scope) {
    if (!c.can('iuran', 'delete') || !n) return '';
    const sc = scope ? ` data-check-scope="${scope}"` : '';
    return `<div class="toolbar">
      <span class="small muted">Centang baris untuk hapus masal.</span>
      <button type="button" class="btn btn-sm" data-check-all="ids"${sc}>${ui.icon('check')}Pilih Semua</button>
      <button type="button" class="btn btn-sm" data-check-none="ids"${sc}>${ui.icon('x')}Hapus Ceklis</button>
      <button class="btn btn-sm btn-danger" type="submit" form="fHapusAntrean" data-confirm-click="Hapus semua data pembayaran yang dicentang? Data akan hilang dari riwayat transaksi siswa dan (bila sudah terposting) transaksi BKU-nya juga dihapus.">${ui.icon('trash')}Hapus Terpilih (<b data-check-count="ids"${sc}>0</b>)</button>
    </div>`;
  }

  get('/iuran/antrean', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const taId = c.taId;
    const queue = queueRows(taId);
    const pendingRows = dbm.iuranBayarRows({ taId, status: 'pending' });
    // penerimaan yang sengaja disimpan sebagai DATA SAJA (non-BKU) — bisa dibuka & dikembalikan
    const nonBkuRows = dbm.iuranBayarRows({ taId, status: 'manual' }).slice(0, 30);
    const bukuss = db.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan").all(taId || 0);
    const editable = c.can('iuran', 'edit');
    const coaDef = coaIuran();
    const coaDefId = coaDef ? coaDef.id : '';
    const yesterday = dbm.dateOffsetISO(-1);   // kemarin menurut jam WIB
    const late = modalCollector();
    /** modal edit satu penerimaan: ubah nominal / tanggal / atau ubah status menjadi Non-BKU */
    function editModal(b) {
      return {
        title: 'Edit Penerimaan Iuran', body: `<form method="post" action="${c.base}/iuran/antrean/edit" id="fe${b.id}">
          <input type="hidden" name="id" value="${b.id}">
          <input type="hidden" name="back" value="/iuran/antrean">
          <div class="row2">
            <div class="field"><label>Jumlah Iuran (Rp)</label>${ui.moneyInput('jumlah', b.jumlah)}</div>
            <div class="field"><label>Potongan (Rp)</label>${ui.moneyInput('potongan', b.potongan)}</div>
          </div>
          <div class="row2">
            <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal" value="${esc(b.tanggal)}"></div>
            <div class="field"><label>Status Pembukuan</label>
              <select name="status_tujuan">
                <option value="pending" ${b.status !== 'manual' ? 'selected' : ''}>Antrean Posting BKU</option>
                <option value="manual" ${b.status === 'manual' ? 'selected' : ''}>Non-BKU (data saja, tidak masuk BKU)</option>
              </select>
              <div class="hint">Pilih <b>Non-BKU</b> bila penerimaan ini tidak boleh menambah kas BKU.</div></div>
          </div>
          <div class="field"><label>BKU Sasaran (dipakai bila status Antrean Posting)</label>
            <select name="bku_id"><option value="">— Pilih BKU —</option>
              ${bukuss.map(x => `<option value="${x.id}" ${String(x.id) === String(b.bku_id) ? 'selected' : ''}>${esc(x.nama)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(b.keterangan || '')}"></div>
        </form>`,
        footer: `<button class="btn" data-close="mE${b.id}">Batal</button><button class="btn btn-primary" form="fe${b.id}">Simpan Perubahan</button>`
      };
    }

    const content = `<div class="between mb-2">
      <div class="toolbar">
        <span class="badge ${queue.length ? 'amber' : 'green'}">${queue.length} kelompok penerimaan menunggu posting</span>
      </div>
      <div class="toolbar"><a class="btn btn-sm" href="${c.base}/transaksi">${ui.icon('receipt')}Buka BKU</a></div>
    </div>
    ${queue.length ? `<div class="alert warn mb-3">${ui.icon('alert')}<div><b>Terdapat ${queue.length} penerimaan grup iuran belum di-posting ke BKU.</b>
      ${queue.filter(q => q.tanggal <= yesterday).length ? `Termasuk ${queue.filter(q => q.tanggal <= yesterday).length} kelompok dari hari sebelumnya.` : ''}
      Posting akan membuat <b>satu transaksi pemasukan</b> per grup &amp; tanggal pada BKU sasaran.
      Bila penerimaan tersebut memang <b>tidak boleh masuk BKU</b>, pilih <b>Hanya Simpan Data (Non-BKU)</b>.</div></div>` : ''}
    <div class="card mb-3">
      <div class="card-head"><div><h3>Antrean Posting BKU</h3><div class="sub">Akumulasi penerimaan harian per grup iuran</div></div></div>
      ${queue.length ? `<form id="fQueueMass" method="post" action="${c.base}/iuran/antrean/posting-masal">
        <div class="between mb-1">
          <div class="small muted">Centang kelompok penerimaan untuk aksi masal (tinjau/edit, posting BKU, atau simpan Non-BKU).
            Terpilih: <b data-check-count="qids" data-check-scope="#tblAntreanQueue">0</b> kelompok.</div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-all="qids" data-check-scope="#tblAntreanQueue">${ui.icon('check')}Pilih Semua</button>
            <button type="button" class="btn btn-sm" data-check-none="qids" data-check-scope="#tblAntreanQueue">${ui.icon('x')}Hapus Ceklis</button>
            ${editable ? `<button class="btn btn-sm" type="button" data-open="mMassTinjau" data-mass-review="fQueueMass"
                data-mass-target="mMassTinjau">${ui.icon('edit')}Tinjau / Edit Masal (<b data-check-count="qids" data-check-scope="#tblAntreanQueue">0</b>)</button>
            <button class="btn btn-sm btn-green" type="submit"
              data-confirm-click="Posting ke BKU semua kelompok penerimaan yang dicentang? Setiap kelompok menjadi satu transaksi BKU.">
              ${ui.icon('check')}Posting BKU Masal (<b data-check-count="qids" data-check-scope="#tblAntreanQueue">0</b>)</button>
            <button class="btn btn-sm" type="submit" formaction="${c.base}/iuran/antrean/nonbku"
              data-confirm-click="Simpan sebagai DATA SAJA (Non-BKU) semua penerimaan yang dicentang? BKU tidak bertambah.">
              ${ui.icon('save')}Hanya Simpan Data (Non-BKU)</button>` : ''}
          </div></div>
      </form>
      <div class="table-wrap sticky-head"><table id="tblAntreanQueue"><thead><tr>
        <th style="width:34px"><input type="checkbox" data-check-all-box="qids" title="Pilih semua"></th>
        <th>Tanggal</th><th>Grup Iuran</th><th>BKU Sasaran</th><th class="num">Transaksi</th><th class="num">Total Diterima</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${queue.map((q, i) => `<tr>
        <td><input type="checkbox" form="fQueueMass" name="ids" data-check-item="qids" value="${q.rows.map(r => r.id).join(',')}"></td>
        <td class="nowrap">${tglID(q.tanggal)}${q.tanggal <= yesterday ? ' <span class="badge red plain">terlambat</span>' : ''}</td>
        <td class="t-strong">${esc(q.grup_nama)}</td>
        <td>${esc(q.bku_nama)}</td>
        <td class="num">${q.n}</td><td class="num t-strong">${rupiah(q.total)}</td>
        <td class="right">
          <div class="toolbar" style="justify-content:flex-end;gap:6px;flex-wrap:wrap">
            <button class="btn btn-sm" data-open="mQ${i}">${ui.icon('edit')}Tinjau / Edit</button>
            ${editable ? `<form method="post" action="${c.base}/iuran/antrean/posting" data-confirm="Posting ${esc(q.grup_nama)} tanggal ${tglID(q.tanggal)} sebesar ${rupiah(q.total)} ke ${esc(q.bku_nama)}?">
              <input type="hidden" name="ids" value="${q.rows.map(r => r.id).join(',')}">
              <input type="hidden" name="bku_id" value="${q.bku_id || ''}">
              <input type="hidden" name="coa_id" value="${q.coa_id || coaDefId}">
              <button class="btn btn-sm btn-green">${ui.icon('check')}Posting ke BKU</button></form>
            <form method="post" action="${c.base}/iuran/antrean/nonbku" data-confirm="Simpan ${esc(q.grup_nama)} tanggal ${tglID(q.tanggal)} (${rupiah(q.total)}) sebagai DATA SAJA tanpa mencatat ke BKU?">
              <input type="hidden" name="ids" value="${q.rows.map(r => r.id).join(',')}">
              <button class="btn btn-sm">${ui.icon('save')}Hanya Simpan Data (Non-BKU)</button></form>` : ''}
          </div>
        </td></tr>
        ${late('mQ' + i, {
        title: 'Tinjau Penerimaan — ' + q.grup_nama, wide: true,
        body: `<form method="post" action="${c.base}/iuran/antrean/posting" id="fq${i}">
          <input type="hidden" name="ids" value="${q.rows.map(r => r.id).join(',')}">
          <div class="alert info">${ui.icon('info')}<div>Tinjau penerimaan lalu tentukan <b>Kode Akun</b> yang dipakai saat posting. Default: <b>${esc((coaDef || {}).kode || '4.1.07')} · ${esc((coaDef || {}).nama || 'Penerimaan Kegiatan Siswa')}</b> — bisa diubah per posting.
            Gunakan tombol <b>Hanya Simpan Data (Non-BKU)</b> bila penerimaan ini tidak boleh menambah kas BKU.</div></div>
          <div class="row2">
            <div class="field"><label>BKU Sasaran</label><select name="bku_id" required>${bukuss.map(b => `<option value="${b.id}" ${String(b.id) === String(q.bku_id) ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select></div>
            <div class="field"><label>Kode Akun / Rekening Penerimaan</label><select name="coa_id" required>${coaOptions(q.coa_id)}</select>
              <div class="hint">Contoh: Penerimaan SPP (4.1.01) atau Penerimaan Kegiatan Siswa (4.1.07).</div></div>
          </div>
          <div class="table-wrap"><table><thead><tr><th>Siswa</th><th>Kwitansi</th><th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Dibayar</th></tr></thead><tbody>
          ${q.rows.map(r => `<tr><td>${esc(r.siswa_nama)}</td><td class="mono">${esc(r.kwitansi_no)}</td>
            <td class="num">${rupiah(r.jumlah)}</td><td class="num">${rupiah(r.potongan)}</td><td class="num t-strong">${rupiah(r.dibayar)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="4">TOTAL</td><td class="num">${rupiah(q.total)}</td></tr></tfoot></table></div>
        </form>`,
        footer: `<button class="btn" data-close="mQ${i}">Tutup</button>${editable ? `<button class="btn" form="fq${i}" formaction="${c.base}/iuran/antrean/nonbku" formmethod="post">${ui.icon('save')}Hanya Simpan Data (Non-BKU)</button>
          <button class="btn btn-green" form="fq${i}">${ui.icon('check')}Posting ke BKU</button>` : ''}`
      })}`).join('')}
      </tbody></table></div>` : ui.emptyState('Antrean kosong', 'Semua penerimaan iuran sudah diposting ke BKU atau disimpan sebagai data non-BKU.')}
    </div>
    <form id="fHapusAntrean" method="post" action="${c.base}/iuran/bayar/hapus-masal">
      <input type="hidden" name="back" value="/iuran/antrean">
    </form>
    <div class="card">
      <div class="card-head"><div><h3>Rincian Penerimaan Belum Terposting</h3><div class="sub">${pendingRows.length} pembayaran · dapat diedit, dijadikan Non-BKU, atau dihapus masal</div></div>
        ${deleteToolbar(pendingRows.length, c, '#tblAntreanPending')}</div>
      ${pendingRows.length ? `<div class="table-scroll short"><table id="tblAntreanPending"><thead><tr>
        <th style="width:36px"><input type="checkbox" data-check-all-box="ids" data-check-scope="#tblAntreanPending" title="Pilih semua"></th>
        <th>Tanggal</th><th>Kwitansi</th><th>Siswa</th><th>Grup</th><th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Dibayar</th><th></th></tr></thead><tbody>
        ${pendingRows.map(b => `<tr><td><input type="checkbox" form="fHapusAntrean" name="ids" value="${b.id}"></td>
          <td class="nowrap">${tglID(b.tanggal)}</td><td class="mono">${esc(b.kwitansi_no)}</td>
          <td>${esc(b.siswa_nama)}<div class="t-sub">${esc(b.kelas_nama || '')}</div></td><td>${esc(b.grup_nama || '-')}</td>
          <td class="num">${rupiah(b.jumlah)}</td><td class="num">${rupiah(b.potongan)}</td><td class="num t-strong">${rupiah(b.dibayar)}</td>
          <td class="right">${editable ? `<button class="btn btn-sm btn-icon" data-open="mE${b.id}" title="Edit / jadikan Non-BKU">${ui.icon('edit')}</button>` : ''}</td></tr>
          ${late('mE' + b.id, editModal(b))}`).join('')}
      </tbody></table></div>` : ui.emptyState('Tidak ada penerimaan tertunda')}
    </div>
    <div class="card mt-3">
      <div class="card-head"><div><h3>Penerimaan Non-BKU (Data Saja)</h3>
        <div class="sub">${nonBkuRows.length} penerimaan terakhir · tidak masuk BKU, hanya mengurangi tagihan siswa</div></div>
        ${deleteToolbar(nonBkuRows.length, c, '#tblAntreanNonBku')}</div>
      ${nonBkuRows.length ? `<div class="table-scroll short"><table id="tblAntreanNonBku"><thead><tr>
        <th style="width:36px"><input type="checkbox" data-check-all-box="ids" data-check-scope="#tblAntreanNonBku" title="Pilih semua"></th>
        <th>Tanggal</th><th>Kwitansi</th><th>Siswa</th><th>Grup</th><th class="num">Dibayar</th><th>Status</th><th></th></tr></thead><tbody>
        ${nonBkuRows.map(b => `<tr><td><input type="checkbox" form="fHapusAntrean" name="ids" value="${b.id}"></td>
          <td class="nowrap">${tglID(b.tanggal)}</td><td class="mono">${esc(b.kwitansi_no)}</td>
          <td>${esc(b.siswa_nama)}<div class="t-sub">${esc(b.kelas_nama || '')}</div></td><td>${esc(b.grup_nama || '-')}</td>
          <td class="num t-strong">${rupiah(b.dibayar)}</td><td>${bayarStatusBadge(b.status, b.sumber)}</td>
          <td class="right">${editable ? `<button class="btn btn-sm btn-icon" data-open="mE${b.id}" title="Edit / kembalikan ke antrean BKU">${ui.icon('edit')}</button>` : ''}</td></tr>
          ${late('mE' + b.id, editModal(b))}`).join('')}
      </tbody></table></div>` : `<div class="help">Belum ada penerimaan yang disimpan sebagai Non-BKU. Gunakan tombol <b>Hanya Simpan Data (Non-BKU)</b> pada antrean di atas.</div>`}
    </div>
    ${editable ? ui.modal('mMassTinjau', {
      title: 'Tinjau / Edit Masal Penerimaan', wide: true,
      body: `<form method="post" action="${c.base}/iuran/antrean/posting-masal" id="fMassTinjau">
        <div class="alert info">${ui.icon('info')}<div>Semua kelompok penerimaan yang dicentang akan <b>diposting ke BKU</b> memakai BKU &amp; kode akun di bawah.
          Setiap kelompok (grup + tanggal) tetap menjadi <b>satu transaksi</b> tersendiri.
          Gunakan tombol <b>Hanya Simpan Data (Non-BKU)</b> bila penerimaan tidak boleh menambah kas BKU.</div></div>
        <div data-mass-ids></div>
        <div class="field"><label>Kelompok Penerimaan Terpilih</label>
          <div class="small" data-mass-summary style="padding:8px 10px;background:#FFF7ED;border:1px solid var(--line);border-radius:10px">
            Belum ada kelompok yang dipilih.</div></div>
        <div class="row2">
          <div class="field"><label>BKU Sasaran</label>
            <select name="bku_id" required>
              <option value="">— Ikuti BKU tiap kelompok —</option>
              ${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}
            </select>
            <div class="hint">Kosongkan pilihan ini agar tiap kelompok memakai BKU yang tercatat pada penerimaannya.</div></div>
          <div class="field"><label>Kode Akun / Rekening Penerimaan</label>
            <select name="coa_id" required>${coaOptions('')}</select>
            <div class="hint">Default: <b>${esc((coaDef || {}).kode || '4.1.07')} · ${esc((coaDef || {}).nama || 'Penerimaan Kegiatan Siswa')}</b>.</div></div>
        </div>
      </form>`,
      footer: `<button class="btn" data-close="mMassTinjau">Tutup</button>
        <button class="btn" form="fMassTinjau" formaction="${c.base}/iuran/antrean/nonbku" formmethod="post">${ui.icon('save')}Hanya Simpan Data (Non-BKU)</button>
        <button class="btn btn-green" form="fMassTinjau">${ui.icon('check')}Posting ke BKU</button>`
    }) : ''}
    ${late.html()}`;
    page(req, res, { title: 'Antrean Posting BKU', sub: 'Penerimaan iuran yang belum masuk BKU', active: 'iuran_queue', content });
  });

  post('/iuran/antrean/edit', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const b = db.prepare('SELECT * FROM iuran_bayar WHERE id=?').get(req.body.id);
    const back = req.BASE + '/iuran/antrean';
    if (!b || !['pending', 'manual', 'nonbku'].includes(b.status)) return res.redirect(back + '?err=' + encodeURIComponent('Penerimaan tidak ditemukan atau sudah terposting.'));
    const jumlah = lib.parseMoney(req.body.jumlah);
    const potongan = Math.max(0, lib.parseMoney(req.body.potongan));
    if (jumlah <= 0) return res.redirect(back + '?err=' + encodeURIComponent('Jumlah iuran harus lebih dari 0.'));
    const p = Math.min(potongan, jumlah);
    // status tujuan: 'manual' = Non-BKU (data saja) · selain itu kembali ke antrean posting BKU
    const nonbku = String(req.body.status_tujuan || '') === 'manual';
    let bkuId = b.bku_id || null;
    if (!nonbku) {
      const pilih = Number(req.body.bku_id || 0);
      const bkuRow = pilih ? db.prepare('SELECT * FROM bku WHERE id=?').get(pilih) : null;
      if (!bkuRow) return res.redirect(back + '?err=' + encodeURIComponent('Pilih BKU sasaran terlebih dahulu bila status Antrean Posting BKU.'));
      if (bkuRow.status !== 'aktif') return res.redirect(back + '?err=' + encodeURIComponent('BKU sasaran sudah ditutup.'));
      bkuId = bkuRow.id;
    } else bkuId = null;
    db.prepare('UPDATE iuran_bayar SET jumlah=?,potongan=?,dibayar=?,tanggal=?,keterangan=?,status=?,bku_id=? WHERE id=?')
      .run(jumlah, p, jumlah - p, req.body.tanggal || b.tanggal, req.body.keterangan || '',
        nonbku ? 'manual' : 'pending', bkuId, b.id);
    dbm.logAudit(req.user, 'EDIT', 'iuran', `Koreksi penerimaan ${b.kwitansi_no}: ${rupiah(b.dibayar)} → ${rupiah(jumlah - p)}` +
      (nonbku ? ' · diubah menjadi NON-BKU (data saja)' : ' · masuk antrean posting BKU'));
    res.redirect(back + '?ok=' + encodeURIComponent(`Penerimaan iuran diperbarui${nonbku ? ' sebagai Non-BKU (data saja, tidak masuk BKU)' : ' dan masuk antrean posting BKU'}.`));
  });

  /** simpan penerimaan terpilih sebagai DATA SAJA (Non-BKU) — tanpa transaksi BKU */
  post('/iuran/antrean/nonbku', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const back = req.BASE + '/iuran/antrean';
    const ids = [].concat(req.body.ids || []).flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Tidak ada penerimaan yang dipilih.'));
    const rows = db.prepare(`SELECT * FROM iuran_bayar WHERE id IN (${ids.map(() => '?').join(',')}) AND status='pending'`).all(...ids);
    if (!rows.length) return res.redirect(back + '?err=' + encodeURIComponent('Semua penerimaan sudah diproses sebelumnya.'));
    const total = rows.reduce((s, r) => s + Number(r.dibayar || 0), 0);
    db.transaction(() => {
      const upd = db.prepare("UPDATE iuran_bayar SET status='manual', transaksi_id=NULL, bku_id=NULL, posted_at=NULL WHERE id=?");
      for (const r of rows) upd.run(r.id);
    })();
    dbm.logAudit(req.user, 'NON-BKU IURAN', 'iuran',
      `${rows.length} penerimaan iuran (${rupiah(total)}) disimpan sebagai DATA SAJA — tidak dicatat ke BKU`);
    res.redirect(back + '?ok=' + encodeURIComponent(`${rows.length} penerimaan (${rupiah(total)}) disimpan sebagai data saja (Non-BKU) — BKU tidak bertambah.`));
  });

  /**
   * Posting SATU kelompok penerimaan (grup + tanggal + BKU) menjadi satu transaksi BKU.
   * Dipakai oleh posting per baris, posting masal, dan modal Tinjau/Edit masal.
   * → { ok:true, trxId, noBukti, total, bku, grup } | { ok:false, err }
   */
  function postQueueRows(rows, opts = {}) {
    if (!rows || !rows.length) return { ok: false, err: 'Tidak ada penerimaan yang dipilih.' };
    const bkuId = Number(opts.bkuId || rows[0].bku_id || 0);
    const bku = db.prepare('SELECT * FROM bku WHERE id=?').get(bkuId);
    if (!bku) return { ok: false, err: 'BKU sasaran tidak ditemukan.' };
    if (bku.status !== 'aktif') return { ok: false, err: `BKU ${bku.nama} sudah ditutup.` };
    const tanggal = rows[0].tanggal;
    const lock = dbm.periodeLockError(bku.id, tanggal);
    if (lock) return { ok: false, err: lock };
    const total = rows.reduce((s, r) => s + Number(r.dibayar || 0), 0);
    if (total <= 0) return { ok: false, err: 'Total penerimaan Rp 0 — periksa kembali nominal.' };
    const grupId = rows[0].tagihan_id ? (db.prepare('SELECT grup_id FROM iuran_tagihan WHERE id=?').get(rows[0].tagihan_id) || {}).grup_id : null;
    const grup = grupId ? db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(grupId) : null;
    const coa = coaById(Number(opts.coaId || 0)) || coaIuran(grupId ? (db.prepare('SELECT coa_id FROM iuran_grup WHERE id=?').get(grupId) || {}).coa_id : null);
    if (!coa) return { ok: false, err: 'Kode rekening penerimaan tidak ditemukan.' };
    if (coa.kategori !== 'pendapatan') return { ok: false, err: 'Kode rekening yang dipilih bukan kelompok pendapatan/penerimaan.' };
    const ym = String(tanggal).slice(0, 7).replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku.id).c + 1;
    const noBukti = `${bku.kode || 'BKU'}/IUR/${ym}/${String(seq).padStart(3, '0')}`;
    const uraian = `${grup ? grup.nama : 'Iuran Siswa'} — ${rows.length} siswa (${tglID(tanggal)})`;
    const trxId = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
        VALUES (?,?,'pemasukan',?,?,?,?,?,?,'posted',?,?)`);
      const r = ins.run(bku.id, tanggal, rows[0].metode === 'transfer' ? 'transfer' : 'tunai', noBukti, coa.id, total,
        uraian, `${rows.length} siswa`, (opts.user && opts.user.id) || null, nowStamp());
      const id = Number(r.lastInsertRowid);
      const upd = db.prepare("UPDATE iuran_bayar SET status='posted',transaksi_id=?,bku_id=?,posted_at=? WHERE id=?");
      for (const b of rows) upd.run(id, bku.id, nowStamp(), b.id);
      return id;
    })();
    if (grup) db.prepare('UPDATE iuran_grup SET coa_id=? WHERE id=?').run(coa.id, grup.id);
    return { ok: true, trxId, noBukti, total, bku, grup, coa, n: rows.length };
  }

  post('/iuran/antrean/posting', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const back = req.BASE + '/iuran/antrean';
    const ids = [].concat(req.body.ids || []).flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Tidak ada penerimaan yang dipilih.'));
    const rows = db.prepare(`SELECT * FROM iuran_bayar WHERE id IN (${ids.map(() => '?').join(',')}) AND status='pending'`).all(...ids);
    if (!rows.length) return res.redirect(back + '?err=' + encodeURIComponent('Semua penerimaan sudah terposting.'));
    const hasil = postQueueRows(rows, { bkuId: Number(req.body.bku_id || 0), coaId: Number(req.body.coa_id || 0), user: req.user });
    if (!hasil.ok) return res.redirect(back + '?err=' + encodeURIComponent(hasil.err));
    dbm.logAudit(req.user, 'POSTING IURAN', 'iuran', `${hasil.n} penerimaan ${hasil.grup ? hasil.grup.nama : ''} ${rupiah(hasil.total)} → ${hasil.bku.nama} (${hasil.noBukti}) · kode ${hasil.coa.kode} ${hasil.coa.nama}`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Posting berhasil: ${rupiah(hasil.total)} masuk ke ${hasil.bku.nama} (${hasil.noBukti}).`));
  });

  /**
   * POSTING BKU MASAL — banyak kelompok penerimaan sekaligus.
   * Setiap kelompok (grup + tanggal) tetap menjadi SATU transaksi BKU tersendiri.
   */
  post('/iuran/antrean/posting-masal', (req, res) => {
    guard(req, res, 'iuran', 'edit');
    const back = req.BASE + '/iuran/antrean';
    const ids = [].concat(req.body.ids || []).flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Pilih minimal satu kelompok penerimaan.'));
    const rows = db.prepare(`SELECT * FROM iuran_bayar WHERE id IN (${ids.map(() => '?').join(',')}) AND status='pending'`).all(...ids);
    if (!rows.length) return res.redirect(back + '?err=' + encodeURIComponent('Semua penerimaan sudah terposting.'));
    const grupMap = new Map();
    for (const r of rows) {
      const gid = r.tagihan_id ? (db.prepare('SELECT grup_id FROM iuran_tagihan WHERE id=?').get(r.tagihan_id) || {}).grup_id : null;
      const key = `${gid || 0}|${String(r.tanggal).slice(0, 10)}|${r.bku_id || 0}`;
      if (!grupMap.has(key)) grupMap.set(key, []);
      grupMap.get(key).push(r);
    }
    const bkuPilih = Number(req.body.bku_id || 0);
    const coaPilih = Number(req.body.coa_id || 0);
    let berhasil = 0, total = 0;
    const gagal = [];
    for (const group of grupMap.values()) {
      const hasil = postQueueRows(group, { bkuId: bkuPilih || Number(group[0].bku_id || 0), coaId: coaPilih, user: req.user });
      if (hasil.ok) { berhasil++; total += hasil.total; }
      else gagal.push(`${tglID(group[0].tanggal)} ${hasil.err}`);
    }
    dbm.logAudit(req.user, 'POSTING IURAN MASAL', 'iuran',
      `Posting masal: ${berhasil} kelompok penerimaan (${rupiah(total)}) → BKU` + (gagal.length ? ` · gagal: ${gagal.join('; ')}` : ''));
    if (!berhasil) return res.redirect(back + '?err=' + encodeURIComponent('Posting gagal: ' + gagal.join('; ')));
    res.redirect(back + '?ok=' + encodeURIComponent(
      `Posting masal berhasil: ${berhasil} transaksi BKU dibuat, total ${rupiah(total)}.` + (gagal.length ? ` Gagal: ${gagal.join('; ')}` : '')));
  });

  /* =========================================================
     EXPORT DATA IURAN (Excel / PDF)
     ========================================================= */
  get('/iuran/export', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    const d = dataIuranRows(req, c);
    const groups = grupList(d.taId);
    const bulanan = groups.filter(g => g.jenis === 'bulanan');
    const pilihSiswa = (req.query.getAll ? req.query.getAll('siswa') : []).map(Number).filter(Boolean);
    const rekap = pilihSiswa.length ? d.rekap.filter(r => pilihSiswa.includes(r.siswa_id)) : d.rekap;
    if (req.query.get('format') === 'pdf') {
      const body = `<div class="doc-title"><h3>Rekapitulasi Data Iuran Siswa</h3><div class="no">${rekap.length} siswa</div></div>
      <table class="tbl"><thead><tr><th>No</th><th>Nama</th><th>Kelas</th>
        ${groups.map(g => `<th class="num">${esc(g.nama)}</th>`).join('')}
        <th class="num">Total Tagihan</th><th class="num">Sudah Dibayar</th><th class="num">Potongan</th><th class="num">Terhutang</th></tr></thead><tbody>
      ${rekap.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.nama)}</td><td>${esc(r.kelas || '')}</td>
        ${groups.map(g => { const it = r.items.find(x => x.grup_id === g.id); return `<td class="num">${it ? num(it.nominal) : '-'}</td>`; }).join('')}
        <td class="num">${num(r.tagihan)}</td><td class="num">${num(r.terbayar)}</td><td class="num">${num(r.potongan)}</td><td class="num">${num(r.sisa)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="${3 + groups.length}">TOTAL</td>
        <td class="num">${num(rekap.reduce((s, r) => s + r.tagihan, 0))}</td>
        <td class="num">${num(rekap.reduce((s, r) => s + r.terbayar, 0))}</td>
        <td class="num">${num(rekap.reduce((s, r) => s + r.potongan, 0))}</td>
        <td class="num">${num(rekap.reduce((s, r) => s + r.sisa, 0))}</td></tr></tfoot></table>
      ${bulanan.map(g => {
        const siswaG = rekap.filter(r => r.items.some(x => x.grup_id === g.id));
        const sum = key => siswaG.reduce((a, r) => {
          const it = r.items.find(x => x.grup_id === g.id);
          const det = it ? monthlyDetail(it, g) : [];
          return a + det.reduce((b, m) => b + Number(m[key] || 0), 0);
        }, 0);
        return `<div class="rincian-page">
        <div class="rincian-title">RINCIAN BULANAN — ${esc(g.nama)} (Tagihan · Sudah Dibayar · Sisa per bulan)</div>
        <table class="tbl small"><thead>
          <tr><th rowspan="2" class="nw">No</th><th rowspan="2">Nama</th><th rowspan="2" class="nw">Kelas</th>
            ${BULAN_TA.map(b => `<th colspan="3" class="grp">${esc(bulanLabel(b).toUpperCase())}</th>`).join('')}
            <th colspan="3" class="grp">TOTAL</th></tr>
          <tr>${BULAN_TA.map(() => '<th class="num">Tagih</th><th class="num">Bayar</th><th class="num">Sisa</th>').join('')}
            <th class="num">Tagih</th><th class="num">Bayar</th><th class="num">Sisa</th></tr>
        </thead><tbody>
        ${siswaG.map((r, i) => {
          const it = r.items.find(x => x.grup_id === g.id);
          const det = it ? monthlyDetail(it, g) : [];
          const cells = BULAN_TA.map(b => {
            const x = det.find(y => y.bulan === b);
            return `<td class="num">${x ? num(x.tagihan) : '-'}</td><td class="num">${x ? num(x.dibayar) : '-'}</td><td class="num">${x ? num(x.sisa) : '-'}</td>`;
          }).join('');
          return `<tr><td class="num">${i + 1}</td><td>${esc(r.nama)}</td><td class="nw">${esc(r.kelas || '')}</td>${cells}
            <td class="num">${num(it ? it.nominal : 0)}</td><td class="num">${num(it ? it.terbayar : 0)}</td><td class="num">${num(it ? it.sisa : 0)}</td></tr>`;
        }).join('')}
        </tbody><tfoot><tr><td colspan="3">TOTAL</td>
          ${BULAN_TA.map(() => `<td class="num">${num(sum('tagihan'))}</td><td class="num">${num(sum('dibayar'))}</td><td class="num">${num(sum('sisa'))}</td>`).join('')}
          <td class="num">${num(siswaG.reduce((a, r) => a + Number(((r.items.find(x => x.grup_id === g.id) || {}).nominal) || 0), 0))}</td>
          <td class="num">${num(siswaG.reduce((a, r) => a + Number(((r.items.find(x => x.grup_id === g.id) || {}).terbayar) || 0), 0))}</td>
          <td class="num">${num(siswaG.reduce((a, r) => a + Number(((r.items.find(x => x.grup_id === g.id) || {}).sisa) || 0), 0))}</td>
        </tr></tfoot></table></div>`;
      }).join('')}`;
      const dataOrient = printcfg.orient(req, dbm, 'laporan_piutang');
      const css = `@page{size:A4 ${dataOrient === 'portrait' ? 'portrait' : 'landscape'};margin:8mm}
        .doc{max-width:none;width:100%}
        .tbl.small{font-size:6.4pt}
        .tbl.small th,.tbl.small td{padding:1.1mm .8mm}
        .tbl.small th.grp{background:#F8E4D3;text-align:center}
        .tbl.small .nw{white-space:nowrap}
        .rincian-page{page-break-before:always;margin-top:6mm}
        .rincian-title{font-weight:800;font-size:10pt;margin-bottom:2mm}
        thead{display:table-header-group} tr{page-break-inside:avoid}`;
      return res.html(ui.docPage({ settings: c.settings, base: c.base, title: 'Data Iuran', no: '', body, backHref: '/iuran/data', css, orient: dataOrient, selfPath: req.url }));
    }
    // excel dinamis — tiap bulan punya kolom TAGIHAN / SUDAH DIBAYAR / SISA yang terpisah
    const head = ['NO', 'NAMA', 'KELAS'];
    for (const g of groups) {
      if (g.jenis === 'bulanan') {
        for (const b of BULAN_TA) {
          const bl = bulanLabel(b).toUpperCase();
          head.push(`${g.nama} - ${bl} TAGIHAN`, `${g.nama} - ${bl} SUDAH DIBAYAR`, `${g.nama} - ${bl} SISA`);
        }
        head.push(`${g.nama} - TOTAL TAGIHAN`, `${g.nama} - SUDAH DIBAYAR`, `${g.nama} - SISA`);
      } else head.push(`${g.nama} - TAGIHAN`, `${g.nama} - SUDAH DIBAYAR`, `${g.nama} - SISA`);
    }
    head.push('TOTAL TAGIHAN', 'SUDAH DIBAYAR', 'POTONGAN', 'TERHUTANG');
    const rows = [head.map(v => ({ v, bold: true }))];
    const pmapAll = payMapFor(rekap.flatMap(r => r.items.map(i => i.id)));
    for (const r of rekap) {
      const line = [rows.length, r.nama, r.kelas || ''];
      for (const g of groups) {
        const it = r.items.find(x => x.grup_id === g.id);
        if (g.jenis === 'bulanan') {
          const detail = it ? monthlyDetail(it, g, pmapAll.get(it.id) || []) : [];
          for (const b of BULAN_TA) {
            const dt = detail.find(x => x.bulan === b);
            line.push(dt ? Number(dt.tagihan) : 0, dt ? Number(dt.dibayar) : 0, dt ? Number(dt.sisa) : 0);
          }
          line.push(it ? Number(it.nominal) : 0, it ? Number(it.terbayar) : 0, it ? Number(it.sisa) : 0);
        } else line.push(it ? Number(it.nominal) : 0, it ? Number(it.terbayar) : 0, it ? Number(it.sisa) : 0);
      }
      line.push(Number(r.tagihan), Number(r.terbayar), Number(r.potongan), Number(r.sisa));
      rows.push(line);
    }
    const tot = ['', 'TOTAL', ''];
    for (let i = 3; i < head.length; i++) tot.push(rows.slice(1).reduce((s, r) => s + (Number(r[i]) || 0), 0));
    rows.push(tot);
    xlsxSend(res, 'data-iuran.xlsx', 'Data Iuran', rows, [6, 28, 14, ...head.slice(3).map(() => 15)]);
  });

  /* =========================================================
     IMPORT IURAN DINAMIS
     ========================================================= */
  /**
   * Kolom template import iuran:
   *  - grup BULANAN  → satu pasang kolom per BULAN yang punya nominal:
   *      "SPP-Juli TANGGAL BAYAR" | "SPP-Juli NOMINAL BAYAR" | "SPP-Agustus …" | dst.
   *  - grup NON-BULANAN → satu pasang kolom: "NAMA GRUP TANGGAL BAYAR" | "… NOMINAL BAYAR"
   */
  function importColumns(groups) {
    const cols = [];
    for (const g of groups) {
      if (g.jenis === 'bulanan') {
        const nom = dbm.iuranNominalMap(g.id);
        for (const b of BULAN_TA) {
          if (!(Number(nom[b] || 0) > 0)) continue;
          cols.push({ grup: g, bulan: b, label: `${g.nama}-${bulanLabel(b)}`, nominal: Number(nom[b] || 0) });
        }
      } else {
        const nom = dbm.iuranNominalMap(g.id);
        cols.push({ grup: g, bulan: null, label: g.nama, nominal: Object.values(nom).reduce((a, v) => a + Number(v || 0), 0) });
      }
    }
    return cols;
  }
  /** cocokkan prefix kolom template ke grup (+ bulan bila ada) */
  function resolveImportCol(prefix, groups) {
    const norm = v => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const p = norm(prefix);
    if (!p) return null;
    const exact = groups.find(g => norm(g.nama) === p);
    if (exact) return { grup: exact, bulan: null };
    const parts = p.split(/\s*[-–—/]\s*/).filter(Boolean);
    if (parts.length > 1) {
      const lastTok = parts[parts.length - 1];
      const mi = BULAN.findIndex(b => norm(b) === lastTok);
      if (mi >= 0) {
        const base = parts.slice(0, -1).join(' ');
        const g = groups.find(x => norm(x.nama) === base) || groups.find(x => norm(x.nama).replace(/\s/g, '') === base.replace(/\s/g, ''));
        if (g) return { grup: g, bulan: mi + 1 };
      }
    }
    return null;
  }

  get('/iuran/import/template', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const taId = Number(req.query.get('ta') || dbm.taAutoId() || 0) || null;
    const groups = grupList(taId).filter(g => g.aktif);
    const cols = importColumns(groups);
    const head = ['NO', 'NAMA', 'KELAS'];
    for (const c of cols) { head.push(`${c.label} TANGGAL BAYAR`); head.push(`${c.label} NOMINAL BAYAR`); }
    const rows = [
      [{ v: 'TEMPLATE IMPORT DATA IURAN PER BULAN (SPP)', bold: true }],
      ['Setiap bulan memiliki kolom terpisah: [SPP-Juli Tanggal Bayar] | [SPP-Juli Nominal Bayar] | [SPP-Agustus …] | dst.'],
      ['Isi tanggal (DD/MM/YYYY) & nominal hanya pada bulan/grup yang dibayar.'],
      [],
      head.map(v => ({ v, bold: true }))
    ];
    const siswa = dbm.siswaList({ taId, status: 'aktif' }).slice(0, 5);
    siswa.forEach((s, i) => {
      const line = [i + 1, s.nama, s.kelas_nama || ''];
      for (const c of cols) {
        const t = dbm.iuranTagihanRows({ siswaId: s.id, grupId: c.grup.id })[0];
        let sisa = 0;
        if (t) {
          if (c.bulan) {
            const grupObj = db.prepare('SELECT * FROM iuran_grup WHERE id=?').get(c.grup.id) || {};
            const det = monthlyDetail(t, grupObj, payMapFor([t.id]).get(t.id) || []);
            const m = det.find(x => x.bulan === c.bulan);
            sisa = m ? m.sisa : 0;
          } else sisa = t.sisa;
        }
        line.push(sisa > 0 ? lib.todayISO().split('-').reverse().join('/') : '');
        line.push(sisa > 0 ? Number(sisa) : '');
      }
      rows.push(line);
    });
    if (!siswa.length) { const blank = [1, '', '']; for (const c of cols) blank.push('', ''); rows.push(blank); }
    xlsxSend(res, 'template-import-iuran.xlsx', 'Data Iuran', rows, [6, 28, 14, ...head.slice(3).map((h, i) => i % 2 === 0 ? 22 : 16)]);
  });

  post('/iuran/import', (req, res) => {
    guard(req, res, 'iuran', 'create');
    const back = req.BASE + '/iuran/data?ta=' + (req.body.ta || '');
    let sheets;
    try { sheets = readSheet(req.body.file_b64); }
    catch (e) { return res.redirect(back + '&err=' + encodeURIComponent(e.message)); }
    const taId = Number(req.body.ta || dbm.taAutoId() || 0) || null;
    const groups = grupList(taId).filter(g => g.aktif);
    if (!groups.length) return res.redirect(back + '&err=' + encodeURIComponent('Belum ada grup iuran aktif untuk tahun pelajaran ini.'));

    // cari header
    let header = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(c => X.cellText(c).toUpperCase());
        const iNama = labels.findIndex(t => /^NAMA/.test(t));
        const iKelas = labels.findIndex(t => /^KELAS/.test(t));
        if (iNama >= 0 && iKelas >= 0) {
          const cols = [];
          labels.forEach((l, idx) => {
            const m = /^(.*?)\s*[-–—]?\s*(TANGGAL BAYAR|NOMINAL BAYAR)\s*$/i.exec(String(l).trim());
            if (!m) return;
            cols.push({ idx, prefix: String(m[1] || '').trim().replace(/[-–—\s]+$/, ''), kind: /TANGGAL/i.test(m[2]) ? 'tgl' : 'nom' });
          });
          header = { sh, row: i, iNama, iKelas, cols };
          break;
        }
      }
      if (header) break;
    }
    if (!header) return res.redirect(back + '&err=' + encodeURIComponent('Header NAMA | KELAS | [GRUP-BULAN TANGGAL BAYAR] | [GRUP-BULAN NOMINAL BAYAR] tidak ditemukan. Unduh ulang template terbaru.'));
    const errors = [];
    const items = [];
    const groupByName = {};
    for (const g of groups) groupByName[String(g.nama).toUpperCase()] = g;

    for (let i = header.row + 1; i < header.sh.rows.length; i++) {
      const cells = header.sh.rows[i] || [];
      if (!cells.length) continue;
      const nama = X.cellText(cells[header.iNama]).trim();
      const kelas = X.cellText(cells[header.iKelas]).trim();
      if (!nama && !kelas) continue;
      if (/^(NAMA|TOTAL|JUMLAH|TEMPLATE)/i.test(nama)) continue;
      const lineNo = i + 1;
      const raw = [nama, kelas].join(' | ');
      if (!nama) { errors.push({ row: lineNo, msg: 'Nama siswa kosong.', raw }); continue; }
      const cand = db.prepare(`SELECT s.*, k.nama kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
        WHERE lower(s.nama)=lower(?) AND s.status IN ('aktif','nonaktif')`).all(nama);
      if (!cand.length) { errors.push({ row: lineNo, msg: `Siswa "${nama}" tidak ditemukan pada database.`, raw }); continue; }
      const sis = cand.find(s => String(s.kelas_nama || '').toLowerCase() === kelas.toLowerCase()) || (cand.length === 1 ? cand[0] : null);
      if (!sis) { errors.push({ row: lineNo, msg: `Kelas "${kelas}" tidak cocok untuk siswa ${nama} (ada ${cand.length} siswa bernama sama).`, raw }); continue; }
      // pasangan kolom (per grup atau per grup+bulan)
      const byGrup = {};
      for (const col of header.cols) {
        const res2 = resolveImportCol(col.prefix, groups);
        if (!res2) { errors.push({ row: lineNo, msg: `Kolom "${col.prefix}" tidak cocok dengan grup iuran aktif mana pun.`, raw }); continue; }
        const key = res2.grup.id + '|' + (res2.bulan || 0);
        byGrup[key] = byGrup[key] || { grup: res2.grup, bulan: res2.bulan };
        byGrup[key][col.kind] = cells[col.idx];
      }
      for (const key of Object.keys(byGrup)) {
        const rec = byGrup[key];
        const nominal = X.parseMoneyCell(rec.nom || null);
        if (!nominal) continue;
        const label = rec.bulan ? `${rec.grup.nama} - ${bulanLabel(rec.bulan)}` : rec.grup.nama;
        const tglRaw = rec.tgl;
        const tgl = tglRaw ? X.parseDateCell(tglRaw) : null;
        if (!tgl) { errors.push({ row: lineNo, msg: `Format tanggal bayar ${label} salah (gunakan DD/MM/YYYY).`, raw }); continue; }
        const t = db.prepare('SELECT * FROM iuran_tagihan WHERE grup_id=? AND siswa_id=?').get(rec.grup.id, sis.id);
        if (!t) { errors.push({ row: lineNo, msg: `${rec.grup.nama} belum ditetapkan untuk siswa ${sis.nama}.`, raw }); continue; }
        if (Number(t.beasiswa_locked) === 1) { errors.push({ row: lineNo, msg: `${rec.grup.nama} dibayar otomatis oleh beasiswa dan terkunci.`, raw }); continue; }
        const trow = dbm.iuranTagihanRows({ siswaId: sis.id, grupId: rec.grup.id })[0];
        if (!trow) { errors.push({ row: lineNo, msg: `Tagihan ${rec.grup.nama} tidak ditemukan.`, raw }); continue; }
        let sisa = trow.sisa;
        if (rec.bulan) {
          const det = monthlyDetail(trow, rec.grup, payMapFor([t.id]).get(t.id) || []);
          const m = det.find(x => x.bulan === rec.bulan);
          if (!m) { errors.push({ row: lineNo, msg: `Bulan ${bulanLabel(rec.bulan)} tidak punya nominal pada grup ${rec.grup.nama}.`, raw }); continue; }
          sisa = m.sisa;
        }
        if (nominal > sisa) { errors.push({ row: lineNo, msg: `Nominal ${label} (${rupiah(nominal)}) melebihi sisa tagihan (${rupiah(sisa)}).`, raw }); continue; }
        items.push({ tagihan_id: t.id, siswa_id: sis.id, grup_nama: rec.grup.nama, bulan: rec.bulan || null, tanggal: tgl, nominal, lineNo });
      }
    }
    if (errors.length) {
      const token = impcache.put({ kind: 'iuran', errors, items });
      return res.redirect(req.BASE + '/iuran/data?imp=' + token + '&ta=' + (taId || ''));
    }
    if (!items.length) return res.redirect(back + '&err=' + encodeURIComponent('Tidak ada nominal pembayaran yang bisa diimport.'));
    const bku = db.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan LIMIT 1").get(taId || 0);
    if (!bku) return res.redirect(back + '&err=' + encodeURIComponent('Tidak ada BKU aktif — buat/buka BKU terlebih dahulu.'));
    let n = 0, total = 0;
    db.transaction(() => {
      const byDate = {};
      for (const it of items) { const k = it.tanggal + '|' + it.siswa_id; (byDate[k] = byDate[k] || []).push(it); }
      const ins = db.prepare(`INSERT INTO iuran_bayar (tagihan_id,siswa_id,bulan,tanggal,jumlah,potongan,dibayar,metode,keterangan,bku_id,status,kwitansi_no,print_count,sumber,created_by,created_at)
        VALUES (?,?,?,?,?,0,?,?,?,?,'pending',?,0,'import',?,?)`);
      for (const k of Object.keys(byDate)) {
        const list = byDate[k];
        const no = nextKwitansiNo() + '-' + (n + 1);
        for (const it of list) {
          ins.run(it.tagihan_id, it.siswa_id, it.bulan || null, it.tanggal, it.nominal,
            it.nominal, 'tunai', 'Import data iuran' + (it.bulan ? ` — ${bulanLabel(it.bulan)}` : ''),
            bku.id, no, req.user.id, nowStamp());
          total += it.nominal; n++;
        }
      }
    })();
    dbm.logAudit(req.user, 'IMPORT', 'iuran', `Import ${n} pembayaran iuran (${rupiah(total)}) → antrean posting`);
    res.redirect(back + '&ok=' + encodeURIComponent(`Import berhasil: ${n} pembayaran (${rupiah(total)}) masuk antrean posting BKU.`));
  });

  /* tampilkan modal error import iuran bila ada */
  function impErrorBlock(req) {
    const token = req.query.get('imp');
    if (!token) return '';
    const cache = impcache.get(token);
    if (!cache || cache.kind !== 'iuran') return '';
    if (cache.items && cache.items.length) return ui.importErrorModal(cache.errors || []);
    return ui.importErrorModal(cache.errors || []);
  }
};
