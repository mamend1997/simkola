'use strict';
const printcfg = require('../printcfg');
const impcache = require('../impcache');
/* ============ PAYROLL: Leger Honor Guru & TU, Slip Gaji, Posting BKU ============ */
const X = require('../xlsx-read');
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num } = lib;

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }
  const curPeriode = () => dbm.currentPeriode();
  const esc0 = v => String(v === undefined || v === null ? '' : v);
  /** periode default: bulan berjalan bila masih di dalam TA terpilih, selain itu bulan awal TA */
  function defaultPeriode(ta) {
    const cur = curPeriode();
    if (!ta) return cur;
    const { from, to } = dbm.taRange(ta);
    const startM = from.slice(0, 7), endM = to.slice(0, 7);
    return cur >= startM && cur <= endM ? cur : startM;
  }
  /** seluruh periode (YYYY-MM) di dalam rentang tahun ajaran */
  function taPeriodeList(ta) {
    if (!ta) return [];
    const { from, to } = dbm.taRange(ta);
    const out = [];
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    const end = to.slice(0, 7);
    for (let i = 0; i < 24; i++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      out.push(ym);
      if (ym >= end) break;
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  function parseJam(v) {
    let s = String(v === undefined || v === null ? '' : v).trim().replace(/\s/g, '');
    if (!s) return 0;
    if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
    if (s.includes('.')) {
      const p = s.split('.');
      if (p.length === 2 && p[1].length <= 2 && Math.abs(Number(s)) < 1000) return Number(s) || 0;
      return Number(s.replace(/\./g, '')) || 0;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  // komponen uang (tugas tambahan & sertifikasi berbasis JAM)
  const MONEY_FIELDS = ['honor_jam', 'tunjangan_jabatan', 'tunjangan_masa_kerja', 'lembur', 'tambahan_penghasilan',
    'tunjangan_khusus', 'pot_dana_sosial', 'pot_bpjs_kes', 'pot_bpjs_tk', 'pot_kasbon'];
  const JAM_FIELDS = ['jam_efektif', 'jam_telat', 'jam_pembantu_kepsek', 'jam_wali_kelas', 'jam_sertifikasi'];

  /** normalisasi periode '2026-10' (menerima juga 2026/10, 202610, 10-2026) */
  function normPeriode(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s) || /^(\d{4})(\d{2})$/.exec(s);
    if (m) { const mo = Number(m[2]); if (mo >= 1 && mo <= 12) return `${m[1]}-${String(mo).padStart(2, '0')}`; }
    m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
    if (m) { const mo = Number(m[1]); if (mo >= 1 && mo <= 12) return `${m[2]}-${String(mo).padStart(2, '0')}`; }
    return '';
  }
  /**
   * Periode dari body form. Bila field `periode` hilang/rusak (pernah terjadi karena form bersarang),
   * periode tetap bisa diketahui dari baris leger (ids/id) sehingga simpan draf tidak pernah gagal
   * dengan pesan "Periode tidak valid".
   */
  function periodeFromBody(req) {
    const direct = normPeriode(req.body && req.body.periode);
    if (direct) return direct;
    const ids = String((req.body && req.body.ids) || '').split(',').map(x => Number(x)).filter(Boolean);
    const id = Number((req.body && req.body.id) || 0) || (ids.length ? ids[0] : 0);
    if (id) {
      const r = db.prepare('SELECT periode FROM payroll WHERE id=?').get(id);
      if (r) return r.periode;
    }
    return '';
  }
  const payBack = (base, periode, hash = '') =>
    `${base}/payroll?periode=${encodeURIComponent(periode || '')}${hash}`;
  const flash = (url, key, msg) => {
    const [path, h] = String(url).split('#');
    return path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg) + (h ? '#' + h : '');
  };

  /**
   * Kasbon pada leger kini HANYA PENCATATAN (tampil & tercetak pada slip gaji).
   * Pemotongan otomatis ke master piutang sudah dihapus sesuai kebijakan sekolah:
   * pelunasan piutang dilakukan manual pada menu Piutang Pegawai.
   */


  /** total minus → dicatat sebagai piutang pegawai */
  function syncMinus(row, calc) {
    const p = row.piutang_id ? db.prepare('SELECT * FROM piutang WHERE id=?').get(row.piutang_id) : null;
    const neg = calc.diterima < 0 ? -calc.diterima : 0;
    if (neg > 0) {
      const ket = `Sisa minus leger honor ${dbm.periodeLabel(row.periode)}`;
      if (!p) {
        const tglMinus = dbm.periodeEnd(row.periode);
        const info = db.prepare(`INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,tanggal_bayar,status,bku_id,keterangan,created_at,tahun_ajaran_id)
          VALUES (?,?,?,NULL,'belum',NULL,?,?,?)`)
          .run(row.nama, tglMinus, neg, ket, nowStamp(), dbm.taIdOfDate(tglMinus));
        db.prepare('UPDATE payroll SET piutang_id=? WHERE id=?').run(info.lastInsertRowid, row.id);
        return { created: true, nominal: neg };
      }
      const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(p.id).s || 0);
      if (dibayar === 0) {
        db.prepare("UPDATE piutang SET nama_pegawai=?,nominal=?,tanggal_utang=?,keterangan=?,status='belum',tanggal_bayar=NULL WHERE id=?")
          .run(row.nama, neg, dbm.periodeEnd(row.periode), ket, p.id);
      }
      return { updated: true };
    }
    if (p) {
      const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(p.id).s || 0);
      if (dibayar === 0) db.prepare('DELETE FROM piutang WHERE id=?').run(p.id);
      db.prepare('UPDATE payroll SET piutang_id=NULL WHERE id=?').run(row.id);
    }
    return {};
  }

  function titleOf(periode) { return 'Leger Honor ' + dbm.periodeLabel(periode); }

  function findBku(nama, taId) {
    if (taId) {
      const hit = db.prepare(`SELECT * FROM bku WHERE lower(nama)=lower(?) AND COALESCE(auto_mode,0)=0 AND tahun_ajaran_id=?
        ORDER BY (status='aktif') DESC, id LIMIT 1`).get(nama, taId);
      if (hit) return hit;
    }
    return db.prepare(`SELECT * FROM bku WHERE lower(nama)=lower(?) AND COALESCE(auto_mode,0)=0
      ORDER BY (status='aktif') DESC, tahun_ajaran_id DESC, id LIMIT 1`).get(nama);
  }

  /* ================= HALAMAN UTAMA (DRAF LEGER HONOR) ================= */
  get('/payroll', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const c = ctx(req);
    const periode = normPeriode(req.query.get('periode')) || defaultPeriode(c.ta);
    const rows = dbm.payrollRows(periode);
    const tot = dbm.payrollTotals(periode);
    // struktur kolom dinamis (diatur sekolah pada /payroll/kolom)
    const dyn = dbm.payrollDynamic(periode);
    const cols = dyn.cols;
    const dinMap = new Map(dyn.rows.map(r => [r.id, r]));
    // null = masih DRAF (termasuk saat transaksi BKU-nya sudah dihapus → otomatis terbuka kembali)
    const posted = dbm.payrollPost(periode);
    const editable = c.can('payroll', 'edit');
    const canEdit = editable && !posted;          // kuncian hanya saat sudah diposting ke BKU
    const pegawai = dbm.pegawaiList(true);
    const late = modalCollector();
    const rowForms = [];                          // form aksi baris dirender DI LUAR tabel (hindari form bersarang)
    const mkForm = (id, action, fields, confirmText) => {
      const fid = `fRow${action.replace(/[^a-z]/gi, '')}_${id}_${fields.arah || ''}`;
      rowForms.push(`<form id="${fid}" method="post" action="${c.base}${action}"${confirmText ? ` data-confirm="${esc(confirmText)}"` : ''}>` +
        Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('') + '</form>');
      return fid;
    };
    const F = (id, name, val, extra = '') => `<input type="text" inputmode="numeric" autocomplete="off" name="${id}_${name}" value="${esc(lib.moneyInput(val))}" data-money ${extra} ${canEdit ? '' : 'disabled'}>`;
    const HJ = (id, name, val) => `<input type="text" inputmode="decimal" autocomplete="off" name="${id}_${name}" value="${esc(val === undefined || val === null ? '' : String(Math.round(Number(val) * 100) / 100).replace('.', ','))}" ${canEdit ? '' : 'disabled'}>`;

    const fmtVal = (c, v) => c.nilai === 'jam'
      ? String(Math.round((Number(v) || 0) * 100) / 100).replace('.', ',')
      : lib.moneyInput(v);

    const rowHtml = r => {
      const d = dinMap.get(r.id) || { din: {}, dinComputed: {} };
      const neg = r.diterima < 0;
      const cells = cols.map(c => {
        const v = d.din ? d.din[c.kode] : 0;
        if (c.rumus) {
          return `<td class="num"><span class="js-calc" data-kode="${esc(c.kode)}" data-tipe="${esc(c.tipe)}" data-satuan="${esc(c.nilai)}">${esc(fmtVal(c, v))}</span></td>`;
        }
        const name = `${r.id}_c_${c.kode}`;
        return `<td><input type="text" inputmode="${c.nilai === 'jam' ? 'decimal' : 'numeric'}" autocomplete="off"
          name="${esc(name)}" value="${esc(fmtVal(c, v))}" class="js-din"
          data-kode="${esc(c.kode)}" data-tipe="${esc(c.tipe)}" data-satuan="${esc(c.nilai)}"
          ${c.nilai === 'uang' ? 'data-money' : ''} ${canEdit ? '' : 'disabled'}></td>`;
      }).join('');
      return `<tr data-payroll-row data-rid="${r.id}" data-diterima="${r.diterima}">
        <td class="pick-cell"><input type="checkbox" name="pilih" value="${r.id}" form="fHapusTerpilih" aria-label="Pilih ${esc(r.nama)}"${canEdit ? '' : ' disabled'}></td>
        <td class="sticky-col nm-cell"><div class="t-strong"><span class="drag-handle" draggable="true" title="Geser untuk ubah urutan">⠿</span> ${esc(r.nama)}</div>
          <div class="t-sub">${esc(r.jabatan || '-')} ${r.tipe === 'tu' ? ui.badge('TU', 'blue', 'plain') : ui.badge('Guru', 'orange', 'plain')}</div></td>
        ${cells}
        <td class="num js-penerimaan t-strong" data-val="${r.penerimaan}">${rupiah(r.penerimaan)}</td>
        <td class="num js-potongan" style="color:var(--red)" data-val="${r.potongan}">${rupiah(r.potongan)}</td>
        <td class="num js-diterima t-strong" data-val="${r.diterima}" style="color:${neg ? 'var(--red)' : 'var(--ink)'}">${rupiah(r.diterima)}</td>
        <td class="right nowrap">${canEdit ? `
          <button class="btn btn-sm btn-icon" form="${mkForm(r.id, '/payroll/urutkan', { id: r.id, periode, arah: 'up' })}" title="Pindah ke atas">${ui.icon('up')}</button>
          <button class="btn btn-sm btn-icon" form="${mkForm(r.id, '/payroll/urutkan', { id: r.id, periode, arah: 'down' })}" title="Pindah ke bawah">${ui.icon('down')}</button>
          <button class="btn btn-sm btn-danger" form="${mkForm(r.id, '/payroll/hapus', { id: r.id, periode }, `Hapus baris ${r.nama} dari leger ini?`)}">${ui.icon('trash')}</button>` : ''}</td>
      </tr>`;
    };

    // pilihan periode: seluruh bulan TA terpilih + periode draf yang sudah tersimpan (boleh beda TA)
    const taPeriode = taPeriodeList(c.ta);
    const savedPeriode = dbm.payrollPeriods();
    const pilihan = Array.from(new Set([...taPeriode, ...savedPeriode, periode])).filter(Boolean).sort();
    const opsiPeriode = pilihan.map(p => {
      const post = dbm.payrollPost(p);   // stale row (transaksi BKU dihapus) dianggap draf
      const nBaris = p === periode ? rows.length : db.prepare('SELECT COUNT(*) c FROM payroll WHERE periode=?').get(p).c;
      const tag = post ? 'terkunci' : nBaris ? 'draf' : 'kosong';
      return `<option value="${esc(p)}" ${p === periode ? 'selected' : ''}>${esc(dbm.periodeLabel(p))} — ${tag}${nBaris ? ' (' + nBaris + ' baris)' : ''}</option>`;
    }).join('');

    const kasbonTotal = rows.reduce((s, r) => s + (Number(r.pot_kasbon) || 0), 0);

    const statusBadge = posted
      ? ui.badge('TERKUNCI · sudah posting BKU', 'green')
      : ui.badge('DRAF · bebas diedit', 'amber');

    const content = `<div class="between mb-2 flex-wrap">
      <div class="flex" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
        <form method="get" action="${c.base}/payroll" class="flex" style="gap:8px;align-items:flex-end">
          <div class="field" style="margin:0"><label>Periode Leger (bebas bulan)</label>
            <input type="month" name="periode" value="${esc(periode)}" onchange="this.form.submit()">
            <div class="hint">Draf boleh dibuat/diedit untuk bulan mana pun.</div></div>
          <button class="btn" style="margin-bottom:22px">${ui.icon('search')}Tampilkan</button>
        </form>
        <form method="get" action="${c.base}/payroll" class="flex" style="gap:8px;align-items:flex-end">
          <div class="field" style="margin:0"><label>Draf / Periode Tersimpan</label>
            <select name="periode" data-autosubmit style="width:250px">${opsiPeriode}</select>
            <div class="hint">Draf dari bulan/tahun pelajaran lain tetap dapat dibuka.</div></div>
        </form>
      </div>
      <div class="toolbar">
        ${canEdit ? `<button class="btn btn-sm btn-primary" data-open="mImportLeger">${ui.icon('upload')}Import Leger Honor (Excel)</button>
        <form method="post" action="${c.base}/payroll/salin-bulan" style="display:inline"
          data-confirm="Salin isian leger ${esc(dbm.periodeLabel(dbm.prevPeriode(periode)))} ke ${esc(dbm.periodeLabel(periode))}? Urutan nama mengikuti periode sebelumnya; pegawai yang sudah ada tidak diduplikasi.">
          <input type="hidden" name="periode" value="${esc(periode)}">
          <button class="btn btn-sm" ${posted ? 'disabled' : ''}>${ui.icon('refresh')}Salin Data Bulan Sebelumnya</button></form>` : ''}
        <a class="btn btn-sm" href="${c.base}/payroll/slip?periode=${periode}">${ui.icon('printer')}Slip Gaji Pegawai</a>
        <a class="btn btn-sm" href="${c.base}/payroll/export?periode=${periode}">${ui.icon('download')}Export Leger ke Excel</a>
        <a class="btn btn-sm" href="${c.base}/payroll/template">${ui.icon('download')}Template Excel</a>
        <form method="get" action="${c.base}/payroll/cetak" target="_blank" class="flex" style="gap:6px">
          <input type="hidden" name="periode" value="${periode}"><input type="hidden" name="mode" value="leger">
          <select name="paper" style="width:112px"><option value="A4">Kertas A4</option><option value="F4">Kertas F4</option></select>
          <button class="btn btn-sm">${ui.icon('printer')}Cetak Leger</button>
        </form>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-head">
        <div><h3>${esc(titleOf(periode))}</h3>
          <div class="sub">${posted ? 'Sudah diposting ke BKU — terkunci. Hapus transaksi honor di BKU Umum untuk membuka kunci.' : 'DRAF — dapat diedit kapan saja (lintas bulan/tahun pelajaran) sampai diposting ke BKU.'}</div></div>
        <div class="toolbar">${statusBadge}</div>
      </div>

      <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi ic-orange"><div class="ico">${ui.icon('users')}</div><div class="lbl">Honor Guru</div><div class="val" style="font-size:18px">${rupiah(tot.guru.honor)}</div><div class="meta">${tot.guru.n} guru</div></div>
        <div class="kpi ic-blue"><div class="ico">${ui.icon('users')}</div><div class="lbl">Honor TU</div><div class="val" style="font-size:18px">${rupiah(tot.tu.honor)}</div><div class="meta">${tot.tu.n} tenaga TU</div></div>
        <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Total Potongan</div><div class="val" style="font-size:18px">${rupiah(tot.potongan)}</div><div class="meta">Kasbon ${rupiah(tot.kasbon)} (catatan slip)</div></div>
        <div class="kpi ic-green"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Total Diterima</div><div class="val" style="font-size:18px">${rupiah(tot.diterima)}</div><div class="meta">${posted ? 'Sudah diposting ke BKU' : 'Draf — belum diposting'}</div></div>
      </div>

      <div class="toolbar mb-2">
        ${canEdit ? `<form method="post" action="${c.base}/payroll/tarik" style="display:inline" data-confirm="Tarik semua pegawai aktif ke leger periode ini?">
            <input type="hidden" name="periode" value="${esc(periode)}"><button class="btn btn-sm">${ui.icon('users')}Tarik Semua Pegawai</button></form>
          <button class="btn btn-sm" data-open="mBaris">${ui.icon('plus')}Tambah Baris</button>
          ${rows.length ? `<button type="button" class="btn btn-sm" data-check-all="pilih">${ui.icon('check')}Pilih Semua</button>
          <button type="button" class="btn btn-sm" data-check-none="pilih">Kosongkan Pilihan</button>
          <button class="btn btn-sm btn-danger" form="fHapusTerpilih">${ui.icon('trash')}Hapus Terpilih</button>` : ''}` : ''}
        ${!posted ? `<span class="badge amber plain">Draf tidak mengubah BKU</span>` : `<span class="badge green plain">Terkunci</span>`}
      </div>

      ${rows.length ? `<form method="post" action="${c.base}/payroll/simpan" id="fPayroll">
        <input type="hidden" name="periode" value="${esc(periode)}">
        <input type="hidden" name="ids" value="${rows.map(r => r.id).join(',')}">
        <div class="table-wrap" style="max-height:70vh;overflow:auto">
          <table class="payroll-table"><thead><tr>
            <th class="pick-cell"><input type="checkbox" data-check-all-box="pilih" title="Pilih semua baris" aria-label="Pilih semua baris"></th>
            <th class="sticky-col">Nama / Jabatan</th>
            ${cols.map(c => `<th>${esc(c.label)}${c.nilai === 'jam' ? ' <span class="t-sub">(jam)</span>' : ''}${c.rumus ? ' <span class="t-sub">auto</span>' : ''}</th>`).join('')}
            <th>Total Penerimaan</th><th>Total Potongan</th><th>Diterima (THP)</th><th></th>
          </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody>
          <tfoot><tr><td class="pick-cell"></td><td class="sticky-col">TOTAL (${rows.length} baris)</td>
            ${cols.map(c => `<td class="num" data-foot-kode="${esc(c.kode)}">${esc(fmtVal(c, dyn.totals.perKode[c.kode]))}</td>`).join('')}
            <td class="num" data-foot="penerimaan">${rupiah(dyn.totals.penerimaan)}</td>
            <td class="num" data-foot="potongan">${rupiah(dyn.totals.potongan)}</td>
            <td class="num" data-foot="diterima">${rupiah(dyn.totals.diterima)}</td><td></td></tr></tfoot>
        </table></div>
        ${canEdit ? `<div class="form-actions">
          <button class="btn btn-primary" type="submit">${ui.icon('save')}Simpan Draf</button>
          <span class="muted small">Data langsung tersimpan &amp; tampil di portal publik slip gaji.</span></div>`
        : `<div class="alert info mt-2">${ui.icon('lock')}<div>${posted ? 'Leger periode ini sudah diposting ke BKU — terkunci. Hapus transaksi honor terkait di BKU Umum agar draf bisa diedit kembali.' : 'Role Anda hanya dapat melihat leger.'}</div></div>`}
      </form>` : ui.emptyState('Belum ada baris leger', 'Klik "Tarik Semua Pegawai" untuk mengisi otomatis dari master pegawai, atau tambah baris manual.')}
      <div class="between flex-wrap mt-2" style="gap:10px">
        <p class="help" style="margin:0">Total <b>Diterima (THP) = Σ Penerimaan − Σ Potongan</b>, dihitung ulang otomatis setiap angka diubah.
          Nama &amp; urutan kolom mengikuti <a href="${c.base}/payroll/kolom">Pengaturan Kolom Leger</a>; baris rekapitulasi di bawah tabel ikut urutan kolom.</p>
        ${canEdit ? `<a class="btn btn-sm" href="${c.base}/payroll/kolom">${ui.icon('settings')}Pengaturan Kolom Leger</a>` : ''}
      </div>
      <script>
        window.__PAY_COLS = ${JSON.stringify(cols.map(c => ({ kode: c.kode, tipe: c.tipe, rumus: c.rumus || '', satuan: c.nilai })))};
        window.__PAY_VARS = { honor_pembantu: ${dbm.honorPembantuJam()}, honor_wali: ${dbm.honorWaliJam()}, sertifikasi_rate: ${dbm.sertifikasiJam()} };
      </script>
      ${canEdit ? `<form id="fUrutan" method="post" action="${c.base}/payroll/urutan" style="display:none">
        <input type="hidden" name="periode" value="${esc(periode)}"><input type="hidden" name="ids" value="">
      </form>` : ''}
    </div>
    ${rowForms.join('')}
    ${canEdit ? `<form id="fHapusTerpilih" method="post" action="${c.base}/payroll/hapus-terpilih"
        data-confirm="Hapus baris leger yang dicentang? Data dapat dipulihkan dari Kotak Sampah 30 hari.">
      <input type="hidden" name="periode" value="${esc(periode)}">
    </form>` : ''}

    <div class="mb-3">
      <div class="card">
        <div class="card-head"><div><h3>Posting ke BKU</h3>
          <div class="sub">Pengeluaran honor dibukukan 1 baris ke BKU Umum (metode Transfer Bank)</div></div>
          ${posted ? ui.badge('Terkunci', 'green') : ui.badge('Draf', 'amber')}</div>
        ${posted ? `<div class="alert ok">${ui.icon('check')}<div>Periode ini sudah diposting pada <b>${esc(posted.posted_at)}</b> oleh ${esc(posted.posted_by || '-')}.</div></div>
          <div class="kv mb-2">
            <dt>BKU Umum (Belanja Pegawai · Transfer)</dt><dd>${rupiah(posted.total_penerimaan)}</dd>
            <dt>BKU Dana Sosial (masuk)</dt><dd>${rupiah(posted.dana_sosial)}</dd>
            <dt>Total Diterima Pegawai</dt><dd>${rupiah(posted.total_diterima)}</dd>
          </div>
          <div class="alert warn">${ui.icon('lock')}<div><b>Leger terkunci.</b> Untuk mengedit atau memposting ulang, hapus dulu transaksi honor periode ini di <b>BKU Umum</b> — kuncian otomatis terbuka.</div></div>
          <div class="toolbar">
            <a class="btn btn-sm" href="${c.base}/transaksi?q=${encodeURIComponent('Leger Honor')}">${ui.icon('eye')}Lihat Transaksi BKU</a>
            ${editable ? `<form method="post" action="${c.base}/payroll/batal-posting" style="display:inline"
                data-confirm="Hapus transaksi payroll di BKU dan buka kunci draf periode ini?">
              <input type="hidden" name="periode" value="${esc(periode)}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Transaksi &amp; Buka Kunci</button></form>` : ''}
          </div>` : `<div class="alert info">${ui.icon('info')}<div>Posting akan membuat <b>1 baris pengeluaran</b> "Belanja Pegawai / Honorarium" (metode <b>Transfer Bank</b>) di <b>BKU Umum</b> sebesar total penerimaan bruto,
            dan <b>1 baris pemasukan</b> potongan Dana Sosial di <b>BKU Dana Sosial</b>. Setelah diposting, leger periode ini otomatis <b>terkunci</b>.</div></div>
          <div class="kv mb-2">
            <dt>Pengeluaran BKU Umum</dt><dd>${rupiah(tot.penerimaan)}</dd>
            <dt>Pemasukan BKU Dana Sosial</dt><dd>${rupiah(tot.danaSosial)}</dd>
            <dt>Dibayarkan ke pegawai</dt><dd>${rupiah(tot.diterima)}</dd>
            <dt>Kasbon (catatan slip)</dt><dd>${rupiah(kasbonTotal)} <span class="badge gray plain">tidak memotong piutang</span></dd>
          </div>
          ${canEdit ? `<form method="post" action="${c.base}/payroll/posting" data-confirm="Posting honor ${esc(dbm.periodeLabel(periode))} ke BKU? Leger akan terkunci setelah diposting.">
            <input type="hidden" name="periode" value="${esc(periode)}">
            <button class="btn btn-primary btn-block" ${rows.length ? '' : 'disabled'}>${ui.icon('save')}Posting Honor ke BKU</button></form>`
        : `<div class="alert info mt-2">${ui.icon('lock')}<div>Role Anda tidak dapat melakukan posting.</div></div>`}`}
        <p class="help mt-2">Potongan BPJS, sertifikasi, dan kasbon tidak dibukukan sebagai pengeluaran BKU karena bukan kas keluar ke pegawai.
          Kasbon hanya tercatat pada slip; pelunasan piutang tetap dilakukan manual pada menu <a href="${c.base}/piutang">Piutang Pegawai</a>.</p>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Rekap Periode</h3><div class="sub">Ringkasan honor guru vs TU &amp; rincian potongan</div></div></div>
      <div class="split-2">
        <div class="kv">
          <dt>Honor Guru (${tot.guru.n} orang)</dt><dd>${rupiah(tot.guru.honor)}</dd>
          <dt>Honor TU (${tot.tu.n} orang)</dt><dd>${rupiah(tot.tu.honor)}</dd>
          <dt>Total Penerimaan (sebelum potongan)</dt><dd><b>${rupiah(tot.penerimaan)}</b></dd>
          <dt>Total Potongan</dt><dd style="color:var(--red)">${rupiah(tot.potongan)}</dd>
          <dt>Total Diterima (sesudah potongan)</dt><dd><b>${rupiah(tot.diterima)}</b></dd>
        </div>
        <div class="kv">
          <dt>Potongan Jam Telat (75%)</dt><dd>${rupiah(tot.potTelat)}</dd>
          <dt>Dana Sosial → BKU Dana Sosial</dt><dd>${rupiah(tot.danaSosial)}</dd>
          <dt>BPJS Kesehatan</dt><dd>${rupiah(tot.bpjsKes)}</dd>
          <dt>BPJS Ketenagakerjaan</dt><dd>${rupiah(tot.bpjsTk)}</dd>
          <dt>Sertifikasi</dt><dd>${rupiah(tot.sertifikasi)}</dd>
          <dt>Kasbon (catatan slip gaji)</dt><dd>${rupiah(tot.kasbon)}</dd>
        </div>
      </div>
    </div>
    ${late.html()}
    ${ui.modal('mBaris', {
      title: 'Tambah Baris Leger',
      body: `<form method="post" action="${c.base}/payroll/baris" id="fBaris">
        <input type="hidden" name="periode" value="${esc(periode)}">
        <div class="field"><label>Pilih Pegawai</label><select name="pegawai_id" required>
          <option value="">— Pilih pegawai —</option>
          ${pegawai.map(p => `<option value="${p.id}">${esc(p.nama)} — ${esc(p.jabatan || '-')} (${p.tipe === 'tu' ? 'TU' : 'Guru'})</option>`).join('')}</select>
          <div class="hint">Belum ada di daftar? Tambahkan dulu di menu <a href="${c.base}/pegawai">Data Pegawai</a>.</div></div>
      </form>`,
      footer: `<button class="btn" data-close="mBaris">Batal</button><button class="btn btn-primary" form="fBaris">Tambah ke Leger</button>`
    })}
    ${canEdit ? ui.modal('mImportLeger', {
      title: 'Import Leger Honor (Excel)',
      wide: true,
      body: `<form method="post" action="${c.base}/payroll/import" id="fImportLeger">
        <input type="hidden" name="periode" value="${esc(periode)}">
        <div class="alert info">${ui.icon('info')}<div><b>Periode tujuan:</b> ${esc(dbm.periodeLabel(periode))}. Baris dengan nama pegawai yang sudah ada di leger akan <b>diperbarui</b>, nama baru akan otomatis ditambahkan ke Data Pegawai.<br>
          Gunakan <a href="${c.base}/payroll/template"><b>Download Template Excel Leger</b></a> agar nama kolom sesuai.</div></div>
        <div class="field"><label>Berkas Leger (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="leger_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="leger_b64" data-max="10">
          <div class="hint" id="leger_b64-info">Header kolom dicari otomatis (NAMA, JAM EFEKTIF, HONOR/JAM, dst).</div></div>
        <div class="hint">Kolom jam tugas tambahan: <b>JAM PEMBANTU KEPSEK</b> &amp; <b>JAM WALI KELAS</b> — nominalnya dihitung otomatis ${rupiah(dbm.honorTugasJam())}/jam.</div>
      </form>`,
      footer: `<a class="btn" href="${c.base}/payroll/template">${ui.icon('download')}Template Excel</a>
        <button class="btn" data-close="mImportLeger">Batal</button>
        <button class="btn btn-primary" form="fImportLeger">${ui.icon('upload')}Import ke Leger</button>`
    }) : ''}`;
    const impTok = req.query.get('imp');
    const impData = impTok ? impcache.get(impTok) : null;
    const errBlock = impData && impData.kind === 'payroll' ? ui.importErrorModal(impData.errors) : '';
    page(req, res, { title: 'Payroll & Leger Honor', sub: 'Draf leger honor, sertifikasi berbasis jam, slip gaji & posting BKU', active: 'payroll', content: content + errBlock });
  });

  /* ================= TEMPLATE EXCEL LEGER ================= */
  get('/payroll/template', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const head = ['NAMA', 'JABATAN', 'TIPE', 'JAM EFEKTIF', 'JAM TELAT', 'HONOR/JAM', 'TUNJ. JABATAN', 'MASA KERJA',
      'LEMBUR', 'TAMBAHAN PENGHASILAN', 'TUNJ. KHUSUS', 'JAM PEMBANTU KEPSEK', 'JAM WALI KELAS',
      'DANA SOSIAL', 'BPJS KES', 'BPJS TK', 'JAM SERTIFIKASI', 'KASBON', 'CATATAN'];
    const contoh = ['Contoh Nama Guru', 'Guru Mata Pelajaran', 'guru', 24, 0, 25000, 150000, 50000,
      0, 0, 0, 4, 6, 20000, 15000, 10000, 24, 0, 'Baris contoh — silakan dihapus'];
    const rows = [head.map(h => ({ v: h, bold: true })), contoh, []];
    const widths = [26, 24, 8, 11, 10, 12, 13, 12, 10, 16, 12, 16, 14, 12, 11, 11, 12, 10, 30];
    const buf = lib.xlsxBuffer('Leger Honor', rows, widths);
    res.file(buf, 'template-import-leger-honor.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  /* ================= IMPORT LEGER HONOR ================= */
  function decodeFile(b64) {
    const raw = String(b64 || '');
    if (!raw) return null;
    const m = raw.match(/^data:([^;]*);base64,([\s\S]*)$/);
    const buf = Buffer.from(m ? m[2] : raw, 'base64');
    return buf.length ? buf : null;
  }
  function readAny(buf) {
    if (buf[0] === 0x50 && buf[1] === 0x4b) return X.readXlsx(buf);
    return X.readCsv(buf.toString('utf8'));
  }
  const normLabel = c => X.cellText(c).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const MATCHERS = [
    ['nama', t => t === 'NAMA' || t.startsWith('NAMA ')],
    ['jabatan', t => t.includes('JABATAN')],
    ['tipe', t => t === 'TIPE' || t === 'STATUS'],
    ['jam_efektif', t => t.includes('JAM EFEKTIF')],
    ['jam_telat', t => t.includes('JAM TELAT')],
    ['honor_jam', t => t.includes('HONOR JAM') || t.includes('HONOR/ JAM')],
    ['tunjangan_jabatan', t => t.includes('TUNJ') && t.includes('JABATAN') && !t.includes('KEPSEK')],
    ['tunjangan_masa_kerja', t => t.includes('MASA KERJA')],
    ['lembur', t => t.includes('LEMBUR')],
    ['tambahan_penghasilan', t => t.includes('TAMBAHAN PENGHASILAN')],
    ['tunjangan_khusus', t => t.includes('KHUSUS') && !t.includes('SERTIFIKASI')],
    ['jam_pembantu_kepsek', t => t.includes('PEMBANTU')],
    ['jam_wali_kelas', t => t.includes('WALI')],
    ['pot_dana_sosial', t => t.includes('DANA SOSIAL')],
    ['pot_bpjs_kes', t => t.includes('BPJS') && (t.includes('KES') || t.includes('KESEHATAN'))],
    ['pot_bpjs_tk', t => t.includes('BPJS') && (t.includes('TK') || t.includes('KETENAGA'))],
    ['jam_sertifikasi', t => t.includes('SERTIFIKASI')],
    ['pot_kasbon', t => t.includes('KASBON')],
    ['catatan', t => t.includes('CATATAN') || t.includes('KETERANGAN')]
  ];
  const JAM_COLS = ['jam_efektif', 'jam_telat', 'jam_pembantu_kepsek', 'jam_wali_kelas'];

  post('/payroll/import', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode);
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(flash(back, 'err', 'Leger periode ini sudah diposting ke BKU (terkunci). Hapus transaksi honor di BKU Umum untuk membuka kunci.'));
    const buf = decodeFile(req.body.file_b64);
    if (!buf) return res.redirect(back + '&err=' + encodeURIComponent('Pilih berkas Excel/CSV leger terlebih dahulu.'));
    let sheets;
    try { sheets = readAny(buf); } catch (e) { return res.redirect(back + '&err=' + encodeURIComponent('Gagal membaca berkas: ' + e.message)); }

    let header = null, sheet = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(normLabel);
        const map = {};
        labels.forEach((t, idx) => {
          for (const [key, test] of MATCHERS) if (map[key] === undefined && test(t)) map[key] = idx;
        });
        if (map.nama !== undefined && (map.honor_jam !== undefined || map.jam_efektif !== undefined)) {
          header = { row: i, map }; sheet = sh; break;
        }
      }
      if (header) break;
    }
    if (!header) return res.redirect(back + '&err=' + encodeURIComponent('Header leger tidak dikenali. Gunakan template Excel Leger Honor (kolom NAMA, JAM EFEKTIF, HONOR/JAM, dst).'));

    const namaFile = String(req.body.file_name || 'import-leger').slice(-80);
    let baru = 0, ubah = 0, dilewati = 0;
    const ambil = (cells, key) => header.map[key] === undefined ? null : cells[header.map[key]];
    const numOf = (cells, key) => header.map[key] === undefined ? 0 : X.parseMoneyCell(ambil(cells, key));
    const jamOf = (cells, key) => header.map[key] === undefined ? 0 : parseJam(X.cellText(ambil(cells, key)));
    // sertifikasi dibaca sebagai JAM. Berkas lama masih berisi nominal Rp (mis. 1.050.000) → dikonversi ke jam.
    const sertRate = Math.max(1, dbm.sertifikasiJam());
    const sertJamOf = cells => {
      const raw = X.cellText(ambil(cells, 'jam_sertifikasi'));
      const v = parseJam(raw);
      if (!(v > 0)) return 0;
      if (v > 200) return Math.round((v / sertRate) * 100) / 100;   // nilai rupiah lama
      return v;
    };

    // ---- validasi cepat baris-per-baris (laporan error sebelum menyimpan) ----
    const errors = [];
    const seenNama = new Set();
    for (let i = header.row + 1; i < sheet.rows.length; i++) {
      const cells = sheet.rows[i] || [];
      if (!cells.length) continue;
      const teks = cells.map(normLabel).join(' ');
      const nama = X.cellText(ambil(cells, 'nama')).trim();
      const adaAngka = header.map.honor_jam !== undefined ? X.parseMoneyCell(ambil(cells, 'honor_jam')) : 0;
      if (/JUMLAH|TOTAL|TANDA TANGAN/.test(teks) && !nama) continue;
      if (!nama && !adaAngka) continue;
      if (/^(NAMA|JUMLAH|TOTAL)\b/i.test(nama)) continue;
      const line = i + 1;
      if (!nama) { errors.push({ row: line, msg: 'Nama pegawai kosong pada baris bernilai.', raw: teks.slice(0, 120) }); continue; }
      if (seenNama.has(nama.toLowerCase())) { errors.push({ row: line, msg: `Nama ${nama} ganda di dalam berkas.`, raw: nama }); continue; }
      seenNama.add(nama.toLowerCase());
    }
    if (errors.length) {
      const token = impcache.put({ kind: 'payroll', errors });
      return res.redirect(back + '&imp=' + token);
    }

    // baris baru diletakkan SETELAH baris yang sudah ada, mengikuti urutan fisik berkas Excel
    let urutImpor = Number(db.prepare('SELECT COALESCE(MAX(urutan),0) m FROM payroll WHERE periode=?').get(periode).m) || 0;
    db.transaction(() => {
      for (let i = header.row + 1; i < sheet.rows.length; i++) {
        const cells = sheet.rows[i] || [];
        if (!cells.length) continue;
        const teks = cells.map(normLabel).join(' ');
        if (/JUMLAH|TOTAL|TANDA TANGAN/.test(teks) && !X.cellText(ambil(cells, 'nama')).trim()) continue;
        const nama = X.cellText(ambil(cells, 'nama')).trim();
        if (!nama) { dilewati++; continue; }
        if (/^(NAMA|JUMLAH|TOTAL)\b/i.test(nama)) { dilewati++; continue; }
        const tipeRaw = X.cellText(ambil(cells, 'tipe')).trim().toLowerCase();
        const tipe = /tu|tata usaha|administrasi|staf/.test(tipeRaw) ? 'tu' : 'guru';
        const jabatan = X.cellText(ambil(cells, 'jabatan')).trim();

        let pg = db.prepare('SELECT * FROM pegawai WHERE lower(nama)=lower(?)').get(nama);
        if (!pg) {
          const info = db.prepare('INSERT INTO pegawai (nama,jabatan,tipe,no_rekening,pemilik_rekening,aktif,created_at) VALUES (?,?,?,\'\',\'\',1,?)')
            .run(nama, jabatan, tipe, nowStamp());
          pg = db.prepare('SELECT * FROM pegawai WHERE id=?').get(info.lastInsertRowid);
        }

        const data = {
          jam_efektif: jamOf(cells, 'jam_efektif'),
          jam_telat: jamOf(cells, 'jam_telat'),
          jam_pembantu_kepsek: jamOf(cells, 'jam_pembantu_kepsek'),
          jam_wali_kelas: jamOf(cells, 'jam_wali_kelas'),
          honor_jam: numOf(cells, 'honor_jam'),
          tunjangan_jabatan: numOf(cells, 'tunjangan_jabatan'),
          tunjangan_masa_kerja: numOf(cells, 'tunjangan_masa_kerja'),
          lembur: numOf(cells, 'lembur'),
          tambahan_penghasilan: numOf(cells, 'tambahan_penghasilan'),
          tunjangan_khusus: numOf(cells, 'tunjangan_khusus'),
          pot_dana_sosial: numOf(cells, 'pot_dana_sosial'),
          pot_bpjs_kes: numOf(cells, 'pot_bpjs_kes'),
          pot_bpjs_tk: numOf(cells, 'pot_bpjs_tk'),
          jam_sertifikasi: sertJamOf(cells),
          pot_kasbon: numOf(cells, 'pot_kasbon'),
          catatan: X.cellText(ambil(cells, 'catatan')).trim()
        };
        const ex = db.prepare('SELECT * FROM payroll WHERE periode=? AND pegawai_id=?').get(periode, pg.id);
        if (ex) {
          db.prepare(`UPDATE payroll SET nama=?,jabatan=?,tipe=?,jam_efektif=?,jam_telat=?,jam_pembantu_kepsek=?,jam_wali_kelas=?,
              jam_sertifikasi=?,honor_jam=?,tunjangan_jabatan=?,tunjangan_masa_kerja=?,lembur=?,tambahan_penghasilan=?,tunjangan_khusus=?,
              pot_dana_sosial=?,pot_bpjs_kes=?,pot_bpjs_tk=?,pot_sertifikasi=?,pot_kasbon=?,catatan=?,updated_at=? WHERE id=?`)
            .run(nama, jabatan || ex.jabatan, tipe, data.jam_efektif, data.jam_telat, data.jam_pembantu_kepsek, data.jam_wali_kelas,
              data.jam_sertifikasi, data.honor_jam, data.tunjangan_jabatan, data.tunjangan_masa_kerja, data.lembur, data.tambahan_penghasilan, data.tunjangan_khusus,
              data.pot_dana_sosial, data.pot_bpjs_kes, data.pot_bpjs_tk, Math.round(data.jam_sertifikasi * sertRate), data.pot_kasbon, data.catatan, nowStamp(), ex.id);
          ubah++;
        } else {
          // urutan mengikuti URUTAN FISIK baris Excel (tidak di-sort abjad)
          urutImpor++;
          db.prepare(`INSERT INTO payroll (periode,pegawai_id,nama,jabatan,tipe,jam_efektif,jam_telat,jam_pembantu_kepsek,jam_wali_kelas,
              jam_sertifikasi,honor_jam,tunjangan_jabatan,tunjangan_masa_kerja,lembur,tambahan_penghasilan,tunjangan_khusus,
              pot_dana_sosial,pot_bpjs_kes,pot_bpjs_tk,pot_sertifikasi,pot_kasbon,catatan,urutan,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(periode, pg.id, nama, jabatan || pg.jabatan || '', tipe, data.jam_efektif, data.jam_telat, data.jam_pembantu_kepsek, data.jam_wali_kelas,
              data.jam_sertifikasi, data.honor_jam, data.tunjangan_jabatan, data.tunjangan_masa_kerja, data.lembur, data.tambahan_penghasilan, data.tunjangan_khusus,
              data.pot_dana_sosial, data.pot_bpjs_kes, data.pot_bpjs_tk, Math.round(data.jam_sertifikasi * sertRate), data.pot_kasbon, data.catatan,
              urutImpor, nowStamp(), nowStamp());
          baru++;
        }
        // nilai minus otomatis dicatat sebagai piutang; potongan kasbon TIDAK dijalankan
        // otomatis saat import (dipisah & manual lewat panel Potongan Kasbon)
        const fresh = db.prepare('SELECT * FROM payroll WHERE periode=? AND pegawai_id=?').get(periode, pg.id);
        if (fresh) syncMinus(fresh, dbm.payrollCalc(fresh));
      }
    })();
    dbm.logAudit(req.user, 'IMPORT', 'payroll',
      `Import leger honor ${dbm.periodeLabel(periode)} dari ${namaFile}: ${baru} baris baru, ${ubah} diperbarui, ${dilewati} dilewati`);
    res.redirect(back + '&ok=' + encodeURIComponent(`Import leger selesai: ${baru} baris baru, ${ubah} baris diperbarui, ${dilewati} baris dilewati.`));
  });

  /* ---------- tarik semua pegawai ---------- */
  post('/payroll/tarik', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(req.BASE + '/payroll?periode=' + periode + '&err=' + encodeURIComponent('Leger periode ini terkunci (sudah diposting ke BKU).'));
    let n = 0;
    db.transaction(() => {
      let urut = Number(db.prepare('SELECT COALESCE(MAX(urutan),0) m FROM payroll WHERE periode=?').get(periode).m) || 0;
      const ins = db.prepare(`INSERT INTO payroll (periode,pegawai_id,nama,jabatan,tipe,created_at,urutan) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(periode,pegawai_id) DO NOTHING`);
      for (const p of dbm.pegawaiList(true)) {
        const info = ins.run(periode, p.id, p.nama, p.jabatan || '', p.tipe || 'guru', nowStamp(), ++urut);
        if (info.changes) n++;
      }
    })();
    dbm.logAudit(req.user, 'TAMBAH', 'payroll', `Menarik ${n} pegawai ke leger honor ${dbm.periodeLabel(periode)}`);
    res.redirect(req.BASE + '/payroll?periode=' + periode + '&ok=' + encodeURIComponent(`${n} pegawai ditambahkan ke leger (yang sudah ada tidak diduplikasi).`));
  });

  post('/payroll/baris', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(req.BASE + '/payroll?periode=' + periode + '&err=' + encodeURIComponent('Leger periode ini terkunci (sudah diposting ke BKU).'));
    const p = db.prepare('SELECT * FROM pegawai WHERE id=?').get(req.body.pegawai_id);
    if (!p) return res.redirect(req.BASE + '/payroll?periode=' + periode + '&err=' + encodeURIComponent('Pegawai tidak ditemukan.'));
    const ex = db.prepare('SELECT id FROM payroll WHERE periode=? AND pegawai_id=?').get(periode, p.id);
    if (ex) return res.redirect(req.BASE + '/payroll?periode=' + periode + '&err=' + encodeURIComponent('Pegawai ini sudah ada di leger periode tersebut.'));
    const urut = Number(db.prepare('SELECT COALESCE(MAX(urutan),0) m FROM payroll WHERE periode=?').get(periode).m) || 0;
    db.prepare('INSERT INTO payroll (periode,pegawai_id,nama,jabatan,tipe,created_at,urutan) VALUES (?,?,?,?,?,?,?)')
      .run(periode, p.id, p.nama, p.jabatan || '', p.tipe || 'guru', nowStamp(), urut + 1);
    res.redirect(req.BASE + '/payroll?periode=' + periode + '&ok=' + encodeURIComponent('Baris pegawai ditambahkan ke leger.'));
  });

  post('/payroll/hapus', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const rAwal = db.prepare('SELECT * FROM payroll WHERE id=?').get(req.body.id);
    const periode = normPeriode(req.body.periode) || (rAwal ? rAwal.periode : '');
    if (dbm.payrollPost(periode)) return res.redirect(req.BASE + '/payroll?periode=' + periode + '&err=' + encodeURIComponent('Leger periode ini terkunci (sudah diposting ke BKU).'));
    const r = rAwal;
    if (r) {
      dbm.trashAdd('payroll', r, { user: req.user, label: `Leger ${r.nama} ${dbm.periodeLabel(periode)}` });
      db.transaction(() => {
        db.prepare('DELETE FROM piutang_bayar WHERE payroll_id=?').run(r.id);
        if (r.piutang_id) {
          const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(r.piutang_id).s || 0);
          if (dibayar === 0) db.prepare('DELETE FROM piutang WHERE id=?').run(r.piutang_id);
        }
        db.prepare('DELETE FROM payroll WHERE id=?').run(r.id);
      })();
      dbm.piutangSyncStatus();
      dbm.logAudit(req.user, 'HAPUS', 'payroll', `Hapus baris leger ${r.nama} periode ${dbm.periodeLabel(periode)}`);
    }
    res.redirect(req.BASE + '/payroll?periode=' + periode + '&ok=' + encodeURIComponent('Baris leger dihapus.'));
  });

  /* ---------- simpan DRAF leger (tidak memotong kasbon, tidak menyentuh BKU) ---------- */
  post('/payroll/simpan', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const ids = String(req.body.ids || '').split(',').map(x => Number(x)).filter(Boolean);
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(flash(back, 'err', 'Leger periode ini sudah diposting ke BKU (terkunci). Hapus transaksi honor di BKU Umum untuk mengedit kembali.'));
    if (!ids.length) return res.redirect(flash(back, 'err', 'Tidak ada baris untuk disimpan.'));
    let minusCount = 0, n = 0;
    db.transaction(() => {
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM payroll WHERE id=? AND periode=?').get(id, periode);
        if (!row) continue;
        const data = {};
        // kolom dinamis mengirim nama `${id}_c_<kode>`; form lama memakai `${id}_<field>`
        const pick = f => (req.body[`${id}_c_${f}`] !== undefined ? req.body[`${id}_c_${f}`] : req.body[`${id}_${f}`]);
        for (const f of JAM_FIELDS) data[f] = parseJam(pick(f));
        for (const f of MONEY_FIELDS) data[f] = lib.parseMoney(pick(f));
        // nominal sertifikasi selalu dihitung dari JAM × tarif (kolom pot_sertifikasi hanya cermin nominal)
        const sertNominal = Math.round((Number(data.jam_sertifikasi) || 0) * dbm.sertifikasiJam());
        db.prepare(`UPDATE payroll SET jam_efektif=?,jam_telat=?,jam_pembantu_kepsek=?,jam_wali_kelas=?,jam_sertifikasi=?,
            honor_jam=?,tunjangan_jabatan=?,tunjangan_masa_kerja=?,
            lembur=?,tambahan_penghasilan=?,tunjangan_khusus=?,
            pot_dana_sosial=?,pot_bpjs_kes=?,pot_bpjs_tk=?,pot_sertifikasi=?,pot_kasbon=?,updated_at=? WHERE id=?`)
          .run(data.jam_efektif, data.jam_telat, data.jam_pembantu_kepsek, data.jam_wali_kelas, data.jam_sertifikasi,
            data.honor_jam, data.tunjangan_jabatan, data.tunjangan_masa_kerja,
            data.lembur, data.tambahan_penghasilan, data.tunjangan_khusus,
            data.pot_dana_sosial, data.pot_bpjs_kes, data.pot_bpjs_tk, sertNominal, data.pot_kasbon, nowStamp(), id);
        // ---- kolom DINAMIS: simpan kolom kustom (tanpa rumus) ke payroll_nilai ----
        const colsNow = dbm.payrollKolomList();
        for (const c of colsNow) {
          if (c.rumus) continue;                       // kolom berumus dihitung otomatis
          const raw = req.body[`${id}_c_${c.kode}`];
          if (raw === undefined) continue;
          if (dbm.PAYROLL_LEGACY.has(c.kode)) continue; // kolom bawaan sudah ditulis di atas
          dbm.payrollNilaiSet(id, c.kode, c.nilai === 'jam' ? parseJam(raw) : lib.parseMoney(raw));
        }
        const fresh = db.prepare('SELECT * FROM payroll WHERE id=?').get(id);
        const dynRow = dbm.payrollDynamic(periode).rows.find(x => Number(x.id) === Number(id)) || {};
        const calc = Object.assign(dbm.payrollCalc(fresh), {
          penerimaan: dynRow.penerimaanDinamis !== undefined ? dynRow.penerimaanDinamis : dbm.payrollCalc(fresh).penerimaan,
          potongan: dynRow.potonganDinamis !== undefined ? dynRow.potonganDinamis : dbm.payrollCalc(fresh).potongan,
          diterima: dynRow.diterimaDinamis !== undefined ? dynRow.diterimaDinamis : dbm.payrollCalc(fresh).diterima
        });
        syncMinus(fresh, calc);            // nilai minus tetap otomatis jadi piutang
        if (calc.diterima < 0) minusCount++;
        n++;
      }
    })();
    dbm.payrollDraftSet(periode, {});      // sentuh updated_at draf
    const msgs = [`${n} baris DRAF leger ${dbm.periodeLabel(periode)} disimpan.`];
    if (minusCount) msgs.push(`${minusCount} pegawai bernilai minus → otomatis dicatat di Piutang Pegawai.`);
    msgs.push('Data langsung tersimpan & dapat dilihat di Slip Gaji / portal publik. Kasbon hanya dicatat (tidak memotong piutang).');
    dbm.logAudit(req.user, 'SIMPAN DRAF', 'payroll',
      `Simpan draf leger honor ${dbm.periodeLabel(periode)}: ${n} baris, total diterima ${rupiah(dbm.payrollTotals(periode).diterima)}${minusCount ? `, ${minusCount} minus → piutang` : ''}`);
    res.redirect(flash(back, 'ok', msgs.join(' ')));
  });

  /* ---------- salin isian leger dari bulan sebelumnya ---------- */
  post('/payroll/salin-bulan', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(flash(back, 'err', 'Leger periode ini terkunci (sudah diposting ke BKU).'));
    const prev = dbm.prevPeriode(periode);
    const hasil = dbm.payrollCopyPrev(periode);
    if (!hasil.copied && !hasil.skipped) {
      return res.redirect(flash(back, 'err', `Belum ada data leger pada ${dbm.periodeLabel(prev)} untuk disalin.`));
    }
    dbm.logAudit(req.user, 'SALIN LEGER', 'payroll',
      `Salin leger ${dbm.periodeLabel(prev)} → ${dbm.periodeLabel(periode)}: ${hasil.copied} baris disalin, ${hasil.skipped} dilewati (sudah ada)`);
    res.redirect(flash(back, 'ok',
      `${hasil.copied} baris disalin dari ${dbm.periodeLabel(prev)} dengan urutan nama tetap sama${hasil.skipped ? `, ${hasil.skipped} pegawai dilewati karena sudah ada` : ''}.`));
  });

  /* ---------- hapus massal baris leger (checkbox) ---------- */
  post('/payroll/hapus-terpilih', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(flash(back, 'err', 'Leger periode ini terkunci (sudah diposting ke BKU).'));
    const ids = [].concat(req.body.pilih || []).map(x => Number(x)).filter(Boolean);
    if (!ids.length) return res.redirect(flash(back, 'err', 'Pilih minimal satu baris leger yang akan dihapus.'));
    let n = 0;
    db.transaction(() => {
      for (const id of ids) {
        const r = db.prepare('SELECT * FROM payroll WHERE id=? AND periode=?').get(id, periode);
        if (!r) continue;
        dbm.trashAdd('payroll', r, { user: req.user, label: `Leger ${r.nama} ${dbm.periodeLabel(periode)}` });
        db.prepare('DELETE FROM piutang_bayar WHERE payroll_id=?').run(r.id);
        db.prepare('DELETE FROM payroll WHERE id=?').run(r.id);
        n++;
      }
    })();
    dbm.piutangSyncStatus();
    dbm.logAudit(req.user, 'HAPUS MASSAL', 'payroll', `Hapus ${n} baris leger honor ${dbm.periodeLabel(periode)} (pilih massal)`);
    res.redirect(flash(back, 'ok', `${n} baris leger dihapus (dapat dipulihkan dari Kotak Sampah 30 hari).`));
  });


  /* ---------- posting ke BKU (mengunci draf) & buka kunci ---------- */
  post('/payroll/posting', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    if (!periode) return res.redirect(req.BASE + '/payroll?err=' + encodeURIComponent('Pilih periode leger terlebih dahulu.'));
    if (dbm.payrollPost(periode)) return res.redirect(flash(back, 'err', 'Periode ini sudah diposting ke BKU (terkunci).'));
    const tot = dbm.payrollTotals(periode);
    if (!tot.rows.length) return res.redirect(flash(back, 'err', 'Draf leger masih kosong.'));
    const taPost = dbm.taOf(req);
    const bkuUmum = findBku('BKU Umum', taPost ? taPost.id : null)
      || db.prepare("SELECT * FROM bku WHERE jenis='umum' AND COALESCE(auto_mode,0)=0 AND tahun_ajaran_id=? ORDER BY (status='aktif') DESC, id LIMIT 1").get(taPost ? taPost.id : 0);
    if (!bkuUmum) return res.redirect(flash(back, 'err', 'BKU Umum tidak ditemukan.'));
    if (bkuUmum.status !== 'aktif') return res.redirect(flash(back, 'err', 'BKU Umum sudah ditutup.'));
    // Tanggal pembukuan: akhir bulan leger. Bulan leger yang belum ditutup tidak lagi
    // memblokir posting, jadi honor selalu dibukukan pada periode leger itu sendiri
    // (hanya periode yang sudah resmi DITUTUP yang harus dibuka kembali lebih dulu).
    const tanggal = dbm.periodeEnd(periode);
    const lock = dbm.periodeLockError(bkuUmum.id, tanggal);
    if (lock) return res.redirect(flash(back, 'err', lock));
    const coaHonor = db.prepare("SELECT * FROM coa WHERE kode='5.1.01'").get();
    const bkuSosial = findBku('Dana Sosial', taPost ? taPost.id : null);
    if (tot.danaSosial > 0 && bkuSosial) {
      const l2 = dbm.periodeLockError(bkuSosial.id, tanggal);
      if (l2) return res.redirect(flash(back, 'err', 'BKU Dana Sosial: ' + l2));
      if (bkuSosial.status !== 'aktif') return res.redirect(flash(back, 'err', 'BKU Dana Sosial sudah ditutup.'));
    }
    const ym = periode.replace('-', '');
    let trxUmum = null, trxSosial = null;
    db.transaction(() => {
      const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bkuUmum.id).c + 1;
      const noBukti = `${bkuUmum.kode || 'BKU'}/PAY/${ym}/${String(seq).padStart(3, '0')}`;
      const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
        VALUES (?,?,'pengeluaran','transfer',?,?,?,?,?,'posted',?,?)`)
        .run(bkuUmum.id, tanggal, noBukti, coaHonor ? coaHonor.id : null, tot.penerimaan,
          `Belanja Pegawai / Honorarium — ${titleOf(periode)}`, 'Guru & Tenaga Kependidikan', req.user.id, nowStamp());
      trxUmum = Number(info.lastInsertRowid);
      if (tot.danaSosial > 0 && bkuSosial) {
        const coaSosial = db.prepare("SELECT * FROM coa WHERE kode='4.1.03'").get();
        const seq2 = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bkuSosial.id).c + 1;
        const no2 = `${bkuSosial.kode || 'BKU'}/PAY/${ym}/${String(seq2).padStart(3, '0')}`;
        const i2 = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
          VALUES (?,?,'pemasukan','tunai',?,?,?,?,?,'posted',?,?)`)
          .run(bkuSosial.id, tanggal, no2, coaSosial ? coaSosial.id : null, tot.danaSosial,
            `Potongan Dana Sosial pegawai — ${titleOf(periode)}`, 'Potongan Payroll', req.user.id, nowStamp());
        trxSosial = Number(i2.lastInsertRowid);
      }
      db.prepare(`INSERT INTO payroll_post (periode,total_penerimaan,total_potongan,total_diterima,dana_sosial,trx_umum_id,trx_dana_sosial_id,posted_at,posted_by)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(periode) DO UPDATE SET total_penerimaan=excluded.total_penerimaan,total_potongan=excluded.total_potongan,
          total_diterima=excluded.total_diterima,dana_sosial=excluded.dana_sosial,trx_umum_id=excluded.trx_umum_id,
          trx_dana_sosial_id=excluded.trx_dana_sosial_id,posted_at=excluded.posted_at,posted_by=excluded.posted_by`)
        .run(periode, tot.penerimaan, tot.potongan, tot.diterima, tot.danaSosial, trxUmum, trxSosial, nowStamp(), req.user.nama);
    })();
    dbm.logAudit(req.user, 'POSTING PAYROLL', 'payroll',
      `Posting ${titleOf(periode)} ke BKU Umum (transfer) ${rupiah(tot.penerimaan)}, Dana Sosial ${rupiah(tot.danaSosial)}, diterima pegawai ${rupiah(tot.diterima)}` +
      '');
    res.redirect(flash(back, 'ok', `Posting berhasil: 1 baris pengeluaran ${rupiah(tot.penerimaan)} (Transfer Bank) di BKU Umum` +
      `${trxSosial ? ` + potongan dana sosial ${rupiah(tot.danaSosial)} ke BKU Dana Sosial` : ''}. Leger periode ini kini TERKUNCI.` +
      (tot.kasbon ? ` Kasbon ${rupiah(tot.kasbon)} tetap hanya tercatat di slip (tidak memotong piutang).` : '')));
  });

  post('/payroll/batal-posting', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    const p = dbm.payrollPost(periode);
    if (!p) return res.redirect(flash(back, 'err', 'Draf ini belum diposting ke BKU.'));
    let dihapus = false;
    db.transaction(() => {
      for (const id of [p.trx_umum_id, p.trx_dana_sosial_id]) {
        if (!id) continue;
        const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(id);
        if (!t) continue;
        const lock = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
        if (!lock) { db.prepare('DELETE FROM transaksi WHERE id=?').run(id); dihapus = true; }
      }
      db.prepare('DELETE FROM payroll_post WHERE periode=?').run(periode);
    })();
    dbm.logAudit(req.user, 'BUKA KUNCI PAYROLL', 'payroll', `Menghapus transaksi BKU & membuka kunci draf payroll ${dbm.periodeLabel(periode)}`);
    res.redirect(flash(back, 'ok', dihapus
      ? 'Transaksi honor di BKU dihapus — leger kembali berstatus DRAF dan bebas diedit.'
      : 'Kuncian draf dibuka, namun transaksi BKU tidak dapat dihapus karena periode sudah ditutup. Buka kunci periode BKU terlebih dahulu.'));
  });

  /* ---------- urutan nama leger (geser naik/turun & drag) ---------- */
  post('/payroll/urutkan', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    if (dbm.payrollPost(periode)) return res.redirect(back + '&err=' + encodeURIComponent('Periode sudah diposting — urutan tidak dapat diubah.'));
    const rows = db.prepare('SELECT id, urutan FROM payroll WHERE periode=? ORDER BY urutan, id').all(periode);
    const idx = rows.findIndex(r => String(r.id) === String(req.body.id));
    if (idx < 0) return res.redirect(back + '&err=' + encodeURIComponent('Baris tidak ditemukan.'));
    const arah = req.body.arah === 'down' ? 1 : -1;
    const target = idx + arah;
    if (target < 0 || target >= rows.length) return res.redirect(back);
    const tmp = rows[idx]; rows[idx] = rows[target]; rows[target] = tmp;
    db.transaction(() => {
      const upd = db.prepare('UPDATE payroll SET urutan=? WHERE id=?');
      rows.forEach((r, i) => upd.run(i + 1, r.id));
    })();
    dbm.logAudit(req.user, 'EDIT', 'payroll', `Mengubah urutan nama leger ${dbm.periodeLabel(periode)}: ${req.body.arah === 'down' ? 'turun' : 'naik'}`);
    res.redirect(back + '&ok=' + encodeURIComponent('Urutan nama leger diperbarui.'));
  });

  post('/payroll/urutan', (req, res) => {
    if (!guard(req, res, 'payroll', 'edit')) return;
    const periode = periodeFromBody(req);
    const back = req.BASE + '/payroll?periode=' + encodeURIComponent(periode || '');
    if (dbm.payrollPost(periode)) return res.redirect(back + '&err=' + encodeURIComponent('Periode sudah diposting.'));
    const ids = String(req.body.ids || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '&err=' + encodeURIComponent('Urutan tidak terbaca.'));
    db.transaction(() => {
      const upd = db.prepare('UPDATE payroll SET urutan=? WHERE id=? AND periode=?');
      ids.forEach((id, i) => upd.run(i + 1, id, periode));
    })();
    dbm.logAudit(req.user, 'EDIT', 'payroll', `Menyusun ulang urutan ${ids.length} nama leger ${dbm.periodeLabel(periode)} (drag & drop)`);
    res.redirect(back + '&ok=' + encodeURIComponent('Urutan nama leger disimpan.'));
  });

  /* ---------- export leger honor ke Excel ---------- */
  get('/payroll/export', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const c = ctx(req);
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : defaultPeriode(c.ta);
    const dyn = dbm.payrollDynamic(periode);
    const cols = dyn.cols;
    const rows = dyn.rows;
    // judul kolom mengikuti PERSIS struktur kolom aktif (urutan & nama dari sekolah)
    const head = ['NO', 'NAMA', 'JABATAN', 'TIPE', ...cols.map(c => String(c.label).toUpperCase()),
      'TOTAL PENERIMAAN', 'TOTAL POTONGAN', 'DITERIMA (THP)'].map(v => ({ v, bold: true }));
    const body = rows.map((r, i) => [i + 1, r.nama, r.jabatan || '', r.tipe === 'tu' ? 'TU' : 'Guru',
      ...cols.map(c => Number(r.din[c.kode]) || 0),
      r.penerimaanDinamis, r.potonganDinamis, r.diterimaDinamis]);
    // baris rekapitulasi bawah: total tiap kolom mengikuti urutan yang sama
    body.push(['', 'TOTAL', '', '',
      ...cols.map(c => Math.round((Number(dyn.totals.perKode[c.kode]) || 0) * 100) / 100),
      dyn.totals.penerimaan, dyn.totals.potongan, dyn.totals.diterima]);
    body.push([]);
    body.push(['', 'Mengetahui,', '', '', 'Bendahara Sekolah,', '', '', 'Kepala Sekolah,']);
    body.push(['', esc0(c.settings.sekolah_kepala), '', '', esc0(c.settings.sekolah_bendahara)]);
    body.push(['', '(............................................)', '', '', '(............................................)']);
    const widths = [5, 26, 22, 8, ...cols.map(c => (c.nilai === 'jam' ? 10 : 13)), 15, 14, 15];
    res.file(lib.xlsxBuffer('Leger ' + periode, [head, ...body], widths),
      `leger-honor-${periode}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  /* ================= CETAK LEGER ================= */
  get('/payroll/cetak', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const c = ctx(req);
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : defaultPeriode(c.ta);
    const paper = req.query.get('paper') === 'F4' ? 'F4' : 'A4';
    const mode = req.query.get('mode') === 'khusus' ? 'khusus' : 'leger';
    const rows = dbm.payrollRows(periode);
    const tot = dbm.payrollTotals(periode);
    const dynAll = dbm.payrollDynamic(periode);
    const dynCols = dynAll.cols;
    const dynRows = dynAll.rows;
    const dynTot = dynAll.totals;
    const orient = printcfg.orient(req, dbm, 'leger_honor');
    const size = paper === 'F4' ? '330mm 215mm' : 'A4 landscape';
    const sizeRule = paper === 'F4' ? (orient === 'portrait' ? '215mm 330mm' : '330mm 215mm') : `A4 ${orient === 'portrait' ? 'portrait' : 'landscape'}`;
    const pageCss = `@page{size:${sizeRule};margin:6mm} body{font-size:8pt} .print-area{max-width:none} @media print{.print-area{padding:0}}`;

    let body = '';
    if (mode === 'khusus') {
      const list = rows.filter(r => Number(r.tambahan_penghasilan) || Number(r.tunjangan_khusus) || Number(r.pembantuKepsek) || Number(r.waliKelas));
      body = `${ui.kop(c.settings)}
        <div class="leger-head"><div>Lampiran Honor ${esc(titleOf(periode))}</div><div>Tahun Ajaran ${esc((dbm.tahunById((dbm.taOf(req) || {}).id) || {}).nama || '-')}</div></div>
        <div style="text-align:center;font-weight:800;font-size:11pt;margin:1mm 0 .5mm">DAFTAR TUNJANGAN KHUSUS, TAMBAHAN PENGHASILAN &amp; TUGAS TAMBAHAN</div>
        <div style="text-align:center;font-size:8.5pt;margin-bottom:2mm">${esc(titleOf(periode))}</div>
        <table class="leger-tbl ttd-tbl"><thead><tr>
          <th style="width:7mm">No</th><th style="width:38mm">Nama</th><th style="width:26mm">Jabatan</th>
          <th style="width:23mm">Tambahan Penghasilan</th><th style="width:24mm">Tunjangan Kepsek/Wakasek</th>
          <th style="width:20mm">Pembantu Kepsek</th><th style="width:19mm">Wali Kelas</th><th style="width:21mm">Jumlah</th>
          <th class="ttd-col">Tanda Tangan / Terima</th></tr></thead><tbody>
          ${list.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.nama)}</td><td>${esc(r.jabatan || '-')}</td>
            <td class="num">${num(r.tambahan_penghasilan)}</td><td class="num">${num(r.tunjangan_khusus)}</td>
            <td class="num">${num(r.pembantuKepsek)}<div style="font-size:5.4pt">${String(Number(r.jam_pembantu_kepsek) || 0).replace('.', ',')} jam</div></td>
            <td class="num">${num(r.waliKelas)}<div style="font-size:5.4pt">${String(Number(r.jam_wali_kelas) || 0).replace('.', ',')} jam</div></td>
            <td class="num">${num(Number(r.tambahan_penghasilan) + Number(r.tunjangan_khusus) + Number(r.pembantuKepsek) + Number(r.waliKelas))}</td>
            <td class="ttd-cell"></td></tr>`).join('') || '<tr><td colspan="9" style="text-align:center">Tidak ada data</td></tr>'}
        </tbody><tfoot><tr><td colspan="3" style="text-align:center">JUMLAH</td><td class="num">${num(tot.tambahan)}</td><td class="num">${num(tot.khusus)}</td><td class="num">${num(tot.pembantuKepsek)}</td><td class="num">${num(tot.waliKelas)}</td><td class="num">${num(tot.tambahan + tot.khusus + tot.pembantuKepsek + tot.waliKelas)}</td><td></td></tr></tfoot></table>
        <p style="font-size:6.6pt;margin-top:1.2mm">Tanda tangan di kolom paling kanan merupakan bukti penerimaan honor oleh pegawai yang bersangkutan.</p>
        ${ui.signBlock(c.settings, { tempat: '', tanggal: tglID(dbm.periodeEnd(periode)) })}`;
    } else {
      body = `${ui.kop(c.settings)}
        <div class="leger-head"><div>Leger Honor ${esc(dbm.periodeLabel(periode))}</div><div>Kertas ${paper}</div></div>
        <div style="text-align:center;font-weight:800;font-size:11pt;margin:1mm 0 .5mm">LEGER HONOR GURU &amp; TATA USAHA</div>
        <div style="text-align:center;font-size:8.5pt;margin-bottom:2mm">${esc(titleOf(periode))}</div>
        <table class="leger-tbl ttd-tbl"><thead><tr>
          <th style="width:6mm">No</th><th style="width:32mm">Nama</th><th style="width:20mm">Jabatan</th>
          ${dynCols.map(c => `<th>${esc(c.label)}</th>`).join('')}
          <th>Penerimaan</th><th>Potongan</th><th>Diterima</th>
          <th class="ttd-col">Tanda Tangan / Terima</th></tr></thead><tbody>
          ${dynRows.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.nama)}</td><td>${esc(r.jabatan || '-')}</td>
            ${dynCols.map(c => `<td class="num">${c.nilai === 'jam'
        ? String(Math.round((Number(r.din[c.kode]) || 0) * 100) / 100).replace('.', ',')
        : num(r.din[c.kode])}</td>`).join('')}
            <td class="num">${num(r.penerimaanDinamis)}</td><td class="num">${num(r.potonganDinamis)}</td><td class="num">${num(r.diterimaDinamis)}</td>
            <td class="ttd-cell"></td></tr>`).join('') || `<tr><td colspan="${dynCols.length + 7}" style="text-align:center">Tidak ada data</td></tr>`}
        </tbody><tfoot><tr><td colspan="3" style="text-align:center">JUMLAH</td>
          ${dynCols.map(c => `<td class="num">${c.nilai === 'jam'
        ? String(Math.round((Number(dynTot.perKode[c.kode]) || 0) * 100) / 100).replace('.', ',')
        : num(dynTot.perKode[c.kode])}</td>`).join('')}
          <td class="num">${num(dynTot.penerimaan)}</td><td class="num">${num(dynTot.potongan)}</td><td class="num">${num(dynTot.diterima)}</td><td></td></tr></tfoot></table>
        <p style="font-size:6.8pt;margin-top:1.5mm">Kolom dan urutannya mengikuti <b>Pengaturan Kolom Leger</b> sekolah.
        Total <b>Diterima (THP) = jumlah seluruh kolom Penerimaan − jumlah seluruh kolom Potongan</b>.
        Kolom paling kanan digunakan sebagai bukti tanda terima honor oleh pegawai.</p>
        ${ui.signBlock(c.settings, { tempat: '', tanggal: tglID(dbm.periodeEnd(periode)) })}`;
    }
    res.html(ui.printPage({
      settings: c.settings, base: c.base, title: mode === 'khusus' ? 'Cetak Tunjangan Khusus' : (printcfg.labels(dbm, 'leger_honor').judul || 'Cetak Leger Honor'),
      body, backHref: '/payroll?periode=' + periode, pageCss, backLabel: 'Kembali ke Payroll',
      orient, selfPath: req.url
    }));
  });

  /* ================= MODUL SLIP GAJI (sumber data: DRAF LEGER HONOR) ================= */
  get('/payroll/slip', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const c = ctx(req);
    const periode = normPeriode(req.query.get('periode')) || defaultPeriode(c.ta);
    const rows = dbm.payrollRows(periode);
    const tot = dbm.payrollTotals(periode);
    const posted = dbm.payrollPost(periode);
    const pilihan = Array.from(new Set([...taPeriodeList(c.ta), ...dbm.payrollPeriods(), periode])).filter(Boolean).sort();
    const opsi = pilihan.map(p => {
      const n = db.prepare('SELECT COUNT(*) c FROM payroll WHERE periode=?').get(p).c;
      const st = dbm.payrollPost(p) ? 'terkunci' : 'draf';
      return `<option value="${esc(p)}" ${p === periode ? 'selected' : ''}>${esc(dbm.periodeLabel(p))} — ${st}${n ? ' (' + n + ' pegawai)' : ''}</option>`;
    }).join('');

    const content = `<div class="card mb-3">
      <div class="card-head">
        <div><h3>Slip Gaji Pegawai — ${esc(dbm.periodeLabel(periode))}</h3>
          <div class="sub">Sumber data: <b>Draf Leger Honor</b> periode ini ${posted ? '(sudah diposting ke BKU)' : '(belum diposting — tetap dapat dilihat & dicetak)'}</div></div>
        <div class="toolbar">
          <a class="btn btn-sm btn-primary" target="_blank" href="${c.base}/payroll/slip/cetak?periode=${periode}">${ui.icon('printer')}Cetak Semua Slip (A4 · 9/halaman)</a>
          <a class="btn btn-sm" href="${c.base}/payroll?periode=${periode}">${ui.icon('edit')}Buka Draf Leger</a>
        </div>
      </div>
      <form method="get" action="${c.base}/payroll/slip" class="flex mb-3" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="margin:0;min-width:260px"><label>Filter Periode (Bulan &amp; Tahun)</label>
          <select name="periode" data-autosubmit>${opsi}</select></div>
        <div class="field" style="margin:0"><label>&nbsp;</label><button class="btn">${ui.icon('search')}Tampilkan</button></div>
      </form>
      <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi ic-blue"><div class="ico">${ui.icon('users')}</div><div class="lbl">Pegawai</div><div class="val" style="font-size:18px">${rows.length}</div><div class="meta">penerima honor</div></div>
        <div class="kpi ic-orange"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Total Penerimaan</div><div class="val" style="font-size:18px">${rupiah(tot.penerimaan)}</div><div class="meta">sebelum potongan</div></div>
        <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Total Potongan</div><div class="val" style="font-size:18px">${rupiah(tot.potongan)}</div><div class="meta">termasuk kasbon ${rupiah(tot.kasbon)}</div></div>
        <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Diterima</div><div class="val" style="font-size:18px">${rupiah(tot.diterima)}</div><div class="meta">dibayarkan ke pegawai</div></div>
      </div>
      ${rows.length ? `<div class="table-wrap sticky-head">
        <table class="slip-modern"><thead><tr>
          <th style="width:44px">No</th><th>Nama / Jabatan</th><th class="num">Jam Efektif</th>
          <th class="num">Penerimaan</th><th class="num">Potongan</th><th class="num">Kasbon</th>
          <th class="num">TOTAL DITERIMA</th><th style="width:96px"></th>
        </tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td><div class="t-strong">${esc(r.nama)}</div><div class="t-sub">${esc(r.jabatan || '-')} ${r.tipe === 'tu' ? ui.badge('TU', 'blue', 'plain') : ui.badge('Guru', 'orange', 'plain')}</div></td>
          <td class="num">${String(Number(r.jam_efektif) || 0).replace('.', ',')}</td>
          <td class="num">${rupiah(r.penerimaan)}</td>
          <td class="num" style="color:var(--red)">${rupiah(r.potongan)}</td>
          <td class="num">${Number(r.pot_kasbon) ? rupiah(r.pot_kasbon) : '—'}</td>
          <td class="num"><span class="slip-diterima${r.diterima < 0 ? ' neg' : ''}">${rupiah(r.diterima)}</span></td>
          <td class="right nowrap"><a class="btn btn-sm" target="_blank" href="${c.base}/payroll/slip/cetak?periode=${periode}&id=${r.id}">${ui.icon('printer')}Slip</a></td>
        </tr>`).join('')}
        </tbody><tfoot><tr>
          <td colspan="3">TOTAL ${rows.length} PEGAWAI</td>
          <td class="num">${rupiah(tot.penerimaan)}</td><td class="num">${rupiah(tot.potongan)}</td>
          <td class="num">${rupiah(tot.kasbon)}</td><td class="num"><span class="slip-diterima">${rupiah(tot.diterima)}</span></td><td></td>
        </tr></tfoot></table></div>`
      : ui.emptyState('Belum ada data slip pada periode ini', 'Slip gaji diambil dari draf leger honor. Buat draf leger pada periode tersebut terlebih dahulu.')}
      <p class="help mt-2">Slip memakai data tersimpan pada draf leger honor — perubahan pada draf langsung terlihat di slip, termasuk periode yang belum diposting ke BKU.</p>
    </div>`;
    page(req, res, { title: 'Slip Gaji Pegawai', sub: 'Slip honor per periode dari draf leger honor', active: 'payroll_slip', content });
  });

  /* ================= CETAK SLIP GAJI (A4 · 9 per halaman) ================= */
  get('/payroll/slip/cetak', (req, res) => {
    guard(req, res, 'payroll', 'view');
    const c = ctx(req);
    const periode = normPeriode(req.query.get('periode')) || defaultPeriode(c.ta);
    const onlyId = Number(req.query.get('id') || 0);
    let rows = dbm.payrollRows(periode);
    if (onlyId) rows = rows.filter(r => Number(r.id) === onlyId);
    const logo = c.settings.sekolah_logo
      ? `<img src="${esc(c.settings.sekolah_logo)}" alt="Logo">`
      : `<div class="ph">${esc((c.settings.sekolah_nama || 'S').trim().charAt(0).toUpperCase())}</div>`;
    const alamat = String(c.settings.sekolah_alamat || '').split('\n')[0];
    const money = v => (Number(v) ? num(v) : '');
    const slip = r => {
      const items = [
        ['Honor Mengajar', r.honorMengajar],
        ['Tunjangan Jabatan', r.tunjangan_jabatan],
        ['Tunjangan Masa Kerja', r.tunjangan_masa_kerja],
        ['Lembur', r.lembur],
        ['Tambahan Penghasilan', r.tambahan_penghasilan],
        ['Tunj. Kepsek/Wakasek', r.tunjangan_khusus],
        ['Pembantu Kepsek (' + (Number(r.jam_pembantu_kepsek) || 0) + ' jam)', r.pembantuKepsek],
        ['Wali Kelas (' + (Number(r.jam_wali_kelas) || 0) + ' jam)', r.waliKelas]
      ].filter(([, v]) => Number(v) > 0);
      const pots = [
        ['Potongan Jam Telat (75%)', r.potTelat],
        ['Dana Sosial', r.pot_dana_sosial],
        ['BPJS Kesehatan', r.pot_bpjs_kes],
        ['BPJS Ketenagakerjaan', r.pot_bpjs_tk],
        ['Penyesuaian Sertifikasi', r.sertifikasi],
        ['Utang / Kasbon', r.pot_kasbon]
      ].filter(([, v]) => Number(v) > 0);
      return `<div class="slip">
        <div class="slip-kop">${logo}<div><div class="nm">${esc(c.settings.sekolah_nama || 'NAMA SEKOLAH')}</div>
          <div class="al">${esc(alamat)}</div></div></div>
        <div class="slip-title">${esc(printcfg.labels(dbm, 'slip_honor').judul || 'Slip Gaji / Honor')}</div>
        <div class="slip-meta">Periode <b>${esc(dbm.periodeLabel(periode))}</b><br>
          Nama: <b>${esc(r.nama)}</b><br>Jabatan: ${esc(r.jabatan || '-')}${r.tipe === 'tu' ? ' (TU)' : ' (Guru)'}</div>
        <table class="slip-tbl"><tbody>
          <tr class="sec"><td colspan="2">Penerimaan</td></tr>
          ${items.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="r">${money(v)}</td></tr>`).join('') || '<tr><td colspan="2" style="font-style:italic">—</td></tr>'}
          <tr><td style="font-weight:700">Total Penerimaan</td><td class="r" style="font-weight:700">${money(r.penerimaan)}</td></tr>
          <tr class="sec"><td colspan="2">Potongan</td></tr>
          ${pots.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="r">${money(v)}</td></tr>`).join('') || '<tr><td colspan="2" style="font-style:italic">—</td></tr>'}
          <tr><td style="font-weight:700">Total Potongan</td><td class="r" style="font-weight:700">${money(r.potongan)}</td></tr>
        </tbody></table>
        <div class="slip-tot"><span>TOTAL DITERIMA</span><span>${esc(rupiah(r.diterima))}</span></div>
      </div>`;
    };
    const pages = [];
    for (let i = 0; i < rows.length; i += 9) pages.push(rows.slice(i, i + 9));
    const body = pages.length
      ? pages.map(chunk => `<div class="slip-page">${chunk.map(slip).join('')}</div>`).join('')
      : `<div class="empty" style="padding:40px;text-align:center">Belum ada data leger pada periode ${esc(dbm.periodeLabel(periode))}.</div>`;
    const slipOrient = printcfg.orient(req, dbm, 'slip_honor');
    const pageCss = `@page{size:A4 ${slipOrient === 'landscape' ? 'landscape' : 'portrait'};margin:4mm} .print-area{max-width:none;padding:0;background:#fff} body{background:#fff} @media print{.print-area{padding:0}}`;
    res.html(ui.printPage({
      settings: c.settings, base: c.base, title: 'Slip Gaji ' + periode, body,
      backHref: '/payroll/slip?periode=' + periode, pageCss, backLabel: 'Kembali ke Slip Gaji',
      orient: slipOrient, selfPath: req.url
    }));
  });
};
