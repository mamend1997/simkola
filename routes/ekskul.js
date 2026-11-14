'use strict';
const printcfg = require('../printcfg');
/* Honor Pembina Ekstrakurikuler: input grid (banyak pembina sekaligus), antrean posting BKU,
   edit/hapus tersinkron (record ekskul + antrean + transaksi BKU sasaran) */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, xlsxBuffer, num } = lib;

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }
  function defaultPeriode(ta) {
    const now = todayISO().slice(0, 7);
    if (!ta) return now;
    const r = dbm.taRange(ta);
    if (now >= r.from.slice(0, 7) && now <= r.to.slice(0, 7)) return now;
    return r.from.slice(0, 7);
  }
  function bukuss(taId) {
    return db.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan").all(taId || 0);
  }
  function totalOf(rows) { return rows.reduce((s, r) => s + r.jumlah, 0); }
  function safePath(raw, def) {
    const s = String(raw || '');
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(s) && !s.startsWith('//') ? s : def;
  }
  function jumlahOf(r) { return Math.round((Number(r.kehadiran) || 0) * (Number(r.harga_satuan) || 0)); }
  const isYm = v => /^\d{4}-\d{2}$/.test(String(v || ''));
  /** bulan pembukuan ke BKU (boleh beda dengan periode kinerja/honor) */
  function postingOf(r) {
    if (isYm(r && r.posting_periode)) return String(r.posting_periode);
    return isYm(r && r.periode) ? String(r.periode) : '';
  }
  /**
   * Tanggal transaksi BKU saat posting honor = TANGGAL AKTUAL entry data.
   * Tidak pernah dipaksa ke akhir bulan (dulu memakai end-of-month sehingga
   * honor yang diinput tanggal 12 selalu tercatat 30/31).
   */
  function tanggalPosting(raw) {
    const v = String(raw || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayISO();
  }
  /**
   * Uraian transaksi BKU. PERIODE HONOR selalu yang tercatat pada item (periode kinerja);
   * bila bulan posting berbeda, ditambahkan keterangan "dibukukan <bulan posting>".
   */
  function uraianBatch(rows) {
    const jenisBatch = String(rows[0].jenis || '').trim();
    const per = rows[0].periode;
    const post = postingOf(rows[0]);
    return `Honor Pembina Ekstrakurikuler${jenisBatch ? ' ' + jenisBatch : ''} ${dbm.periodeLabel(per)} (${rows.length} pembina)`
      + (post && post !== per ? ` — dibukukan ${dbm.periodeLabel(post)}` : '');
  }
  /** selaraskan nominal & uraian transaksi BKU dengan seluruh item honor pada batch yang sama */
  function syncBatch(trxId) {
    if (!trxId) return null;
    const trx = db.prepare('SELECT * FROM transaksi WHERE id=?').get(trxId);
    if (!trx) return null;
    const rows = db.prepare('SELECT * FROM ekskul_honor WHERE transaksi_id=?').all(trxId);
    if (!rows.length) { db.prepare('DELETE FROM transaksi WHERE id=?').run(trxId); return { deleted: true }; }
    const total = rows.reduce((s, r) => s + jumlahOf(r), 0);
    db.prepare('UPDATE transaksi SET nominal=?, uraian=? WHERE id=?').run(total, uraianBatch(rows), trxId);
    return { total, trx };
  }

  /* ================= HALAMAN INPUT ================= */
  get('/ekskul', (req, res) => {
    guard(req, res, 'ekskul', 'view');
    const c = ctx(req);
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : defaultPeriode(c.ta);
    const rows = dbm.ekskulRows(periode);
    const editable = c.can('ekskul', 'edit');
    const late = modalCollector();
    const bkuList = bukuss(c.taId);
    const pegawai = dbm.pegawaiList(true);
    const jenisList = [...new Set(['Pramuka', 'Paskibra', 'PMR', 'Futsal', 'Basket', 'Seni Tari', 'Seni Musik', 'Rohis',
      ...db.prepare("SELECT DISTINCT jenis FROM ekskul_honor WHERE COALESCE(jenis,'')<>''").all().map(x => x.jenis)])];

    /* form satu baris (dipakai modal Edit) */
    const form = (r, fid) => `<form method="post" action="${c.base}/ekskul/save" id="${fid}" data-ekskul-form>
      <input type="hidden" name="id" value="${r ? r.id : ''}">
      <div class="row2">
        <div class="field"><label>Jenis Ekstrakurikuler</label>
          <input name="jenis" list="jenisEkskulList" value="${esc(r ? (r.jenis || '') : '')}" placeholder="Pramuka / Paskibra / PMR / Futsal">
          <div class="hint">Contoh: Pembina Pramuka, Pembina Paskibra.</div></div>
        <div class="field"><label>Nama Pembina</label>
          <input name="nama_pembina" list="pegawaiList" value="${esc(r ? r.nama_pembina : '')}" required placeholder="Pilih dari Data Pegawai atau ketik manual">
          <div class="hint">Dropdown otomatis dari <a href="${c.base}/pegawai">Data Pegawai</a>, tetap bisa diketik manual.</div></div>
      </div>
      <div class="row2">
        <div class="field"><label>Periode Kinerja / Honor</label><input type="month" name="periode" value="${esc(r ? r.periode : periode)}" required>
          <div class="hint">Bulan kinerja honor (mis. <b>Oktober</b>) — tercatat pada laporan honor.</div></div>
        <div class="field"><label>Bulan Posting ke BKU</label>
          <input type="month" name="posting_periode" value="${esc(r ? postingOf(r) : periode)}" ${r && r.status === 'posted' ? 'readonly' : ''}>
          <div class="hint">Rencana bulan pembukuan (boleh berbeda dari periode honor). Tanggal transaksi BKU diisi saat posting — otomatis tanggal hari ini.</div></div>
      </div>
      <div class="row2">
        <div class="field"><label>Jumlah Kehadiran</label><input type="text" inputmode="decimal" name="kehadiran" value="${esc(r ? String(r.kehadiran).replace('.', ',') : '')}" data-kehadiran required placeholder="12"></div>
        <div class="field"><label>Harga Satuan (Rp)</label>${ui.moneyInput('harga_satuan', r ? r.harga_satuan : '', 'data-harga required')}</div>
      </div>
      <div class="field"><label>Jumlah Diterima (otomatis)</label><input type="text" data-jumlah readonly value="${r ? num(r.jumlah) : ''}">
        <div class="hint">Jumlah Diterima = Jumlah Kehadiran × Harga Satuan.</div></div>
      <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(r ? r.keterangan : '')}" placeholder="Opsional"></div>
      ${r && r.status === 'posted' ? `<div class="alert warn">${ui.icon('alert')}<div>Item ini <b>sudah terposting</b> ke BKU. Perubahan nominal otomatis memperbarui transaksi BKU terkait (ditolak bila periode BKU sudah ditutup).</div></div>` : ''}
    </form>`;

    /* form grid: banyak pembina sekaligus dalam satu periode & jenis ekskul */
    const gridRow = (i) => `<tr data-ekskul-row>
      <td class="row-no">${i}</td>
      <td><input name="nama_pembina" list="pegawaiList" placeholder="Nama pembina"></td>
      <td style="width:105px"><input type="text" inputmode="decimal" name="kehadiran" data-kehadiran placeholder="12"></td>
      <td style="width:135px">${ui.moneyInput('harga_satuan', '', 'data-harga')}</td>
      <td class="col-jumlah"><input type="text" data-jumlah readonly value=""></td>
      <td><input name="keterangan" placeholder="Opsional"></td>
      <td class="col-aksi"><button type="button" class="del-row" data-ekskul-del-row title="Hapus baris">${ui.icon('x')}</button></td>
    </tr>`;
    const gridForm = () => `<form method="post" action="${c.base}/ekskul/save-grid" id="fmGrid" data-ekskul-grid>
      <div class="row3">
        <div class="field"><label>Jenis Ekstrakurikuler</label>
          <input name="jenis" list="jenisEkskulList" placeholder="Pramuka / Paskibra / PMR / Futsal">
          <div class="hint">Satu jenis ekskul untuk semua baris di bawah (boleh dikosongkan).</div></div>
        <div class="field"><label>Periode Kinerja / Honor</label><input type="month" name="periode" value="${esc(periode)}" required>
          <div class="hint">Bulan kinerja honor — inilah periode yang tercetak di laporan.</div></div>
        <div class="field"><label>Bulan Posting ke BKU</label><input type="month" name="posting_periode" value="${esc(periode)}">
          <div class="hint">Rencana bulan pembukuan. Tanggal transaksi BKU ditentukan saat posting (tanggal aktual).</div></div>
      </div>
      <div class="alert info">${ui.icon('info')}<div>Isi <b>banyak pembina dalam satu tabel</b> — baris yang namanya kosong otomatis diabaikan. Jumlah Diterima dihitung otomatis dari kehadiran × harga satuan.
        <br><b>Periode honor</b> tetap tercatat apa adanya, sedangkan <b>tanggal transaksi BKU</b> diisi saat posting (otomatis tanggal hari ini, tidak dipaksa ke akhir bulan).</div></div>
      <div class="table-wrap">
        <table class="grid-tbl"><thead><tr>
          <th style="width:34px">No</th><th>Nama Pembina</th><th>Kehadiran</th><th>Harga Satuan (Rp)</th><th>Jumlah Diterima</th><th>Keterangan</th><th></th>
        </tr></thead>
        <tbody data-ekskul-rows>${gridRow(1)}</tbody></table>
      </div>
      <div class="mt-1"><button type="button" class="btn btn-sm" data-ekskul-add-row>${ui.icon('plus')}Tambah Baris Pembina</button></div>
    </form>`;

    const total = totalOf(rows);
    const content = `<div class="between mb-2">
      <form method="get" action="${c.base}/ekskul" class="flex" style="gap:8px">
        <div class="field" style="margin:0"><label>Periode</label><input type="month" name="periode" value="${esc(periode)}" data-autosubmit></div>
      </form>
      <div class="toolbar">
        <a class="btn btn-sm" href="${c.base}/ekskul/export?periode=${esc(periode)}">${ui.icon('download')}Export Excel</a>
        <a class="btn btn-sm" target="_blank" href="${c.base}/ekskul/cetak?periode=${esc(periode)}">${ui.icon('printer')}Cetak PDF</a>
        ${editable ? `<button class="btn btn-primary" data-open="mAddEkskul">${ui.icon('plus')}Input Honor (Tabel Grid)</button>` : ''}
      </div>
    </div>
    <div class="alert info mb-3">${ui.icon('info')}<div>Input honor di sini <b>tidak langsung</b> memotong BKU. Data masuk ke <b>Antrean Posting Honor Ekskul</b> untuk ditinjau, lalu diposting ke BKU sasaran.
      Saat posting, setiap <b>jenis ekstrakurikuler</b> (mis. Pramuka &amp; Paskibra) dibuat sebagai <b>transaksi BKU tersendiri</b> — tidak digabung.
      <br><b>Periode Kinerja/Honor</b> (mis. Oktober) tetap tercatat pada laporan honor, sedangkan <b>tanggal transaksi BKU</b> memakai tanggal aktual saat posting (hari ini) — tidak dipaksa ke akhir bulan.</div></div>
    <div class="card">
      <div class="card-head"><div><h3>Honor Pembina Ekstrakurikuler — ${esc(dbm.periodeLabel(periode))}</h3><div class="sub">${rows.length} pembina · total ${rupiah(total)}</div></div></div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr>
        <th>No</th><th>Jenis Ekstrakurikuler</th><th>Nama Pembina</th><th class="num">Jumlah Kehadiran</th><th class="num">Harga Satuan</th><th class="num">Jumlah Diterima</th><th>Keterangan</th><th>Bulan Posting BKU</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map((r, i) => `<tr>
        <td class="num">${i + 1}</td><td>${esc(r.jenis || '-')}</td><td class="t-strong">${esc(r.nama_pembina)}</td>
        <td class="num">${String(Number(r.kehadiran) || 0).replace('.', ',')}</td>
        <td class="num">${rupiah(r.harga_satuan)}</td><td class="num t-strong">${rupiah(r.jumlah)}</td>
        <td>${esc(r.keterangan || '-')}</td>
        <td class="nowrap">${esc(dbm.periodeLabel(postingOf(r)))}${postingOf(r) !== String(r.periode) ? ` <span class="badge amber plain" title="Berbeda dari periode honor">beda</span>` : ''}</td>
        <td>${r.status === 'posted' ? ui.badge('Terposting', 'green') : ui.badge('Menunggu Posting', 'amber')}</td>
        <td class="right nowrap">
          ${editable ? `<button class="btn btn-sm btn-icon" data-open="mEd${r.id}" title="Edit">${ui.icon('edit')}</button>` : ''}
          ${editable ? `<form method="post" action="${c.base}/ekskul/delete" style="display:inline" data-confirm="${r.status === 'posted'
      ? `Hapus item ini? Seluruh item honor pada transaksi BKU yang sama JUGA dihapus beserta transaksi BKU sasarannya.`
      : `Hapus honor ${esc(r.nama_pembina)}?`}"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="periode" value="${esc(periode)}"><input type="hidden" name="back" value="/ekskul?periode=${esc(periode)}"><button class="btn btn-sm btn-danger" title="Hapus">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>
        ${editable ? late('mEd' + r.id, {
      title: (r.status === 'posted' ? 'Edit Honor Terposting — ' : 'Edit Honor Pembina — ') + r.nama_pembina,
      body: form(r, 'fe' + r.id), wide: true,
      footer: `<button class="btn" data-close="mEd${r.id}">Batal</button><button class="btn btn-primary" form="fe${r.id}">Simpan</button>`
    }) : ''}`).join('')}
      </tbody><tfoot><tr><td colspan="5">TOTAL</td><td class="num">${rupiah(total)}</td><td colspan="4"></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada item honor', 'Tambahkan pembina ekstrakurikuler beserta jumlah kehadiran & harga satuan.')}
      ${late.html()}
    </div>
    <datalist id="pegawaiList">${pegawai.map(p => `<option value="${esc(p.nama)}">`).join('')}</datalist>
    <datalist id="jenisEkskulList">${jenisList.map(j => `<option value="${esc(j)}">`).join('')}</datalist>
    ${editable ? ui.modal('mAddEkskul', {
      title: 'Input Honor Pembina Ekskul (Tabel Grid)', body: gridForm(), wide: true,
      footer: `<button class="btn" data-close="mAddEkskul">Batal</button><button class="btn btn-primary" form="fmGrid">${ui.icon('save')}Simpan Semua Baris</button>`
    }) : ''}
    <p class="help mt-2">Setelah semua item lengkap, buka <a href="${c.base}/ekskul/antrean"><b>Antrean Posting Honor Ekskul</b></a> untuk memposting total honor ke BKU.</p>`;
    page(req, res, { title: 'Honor Pembina Ekskul', sub: 'Input honor pembina ekstrakurikuler & antrean posting', active: 'ekskul', content });
  });

  /* simpan banyak baris sekaligus (grid) */
  post('/ekskul/save-grid', (req, res) => {
    guard(req, res, 'ekskul', 'create');
    const periode = String(req.body.periode || '');
    const back = req.BASE + '/ekskul?periode=' + encodeURIComponent(periode);
    if (!/^\d{4}-\d{2}$/.test(periode)) return res.redirect(back + '&err=' + encodeURIComponent('Periode wajib dipilih.'));
    /* bulan posting ke BKU boleh berbeda; kosong/format salah → ikut periode honor */
    let posting = String(req.body.posting_periode || '').trim();
    if (!isYm(posting)) posting = periode;
    const jenis = String(req.body.jenis || '').trim();
    const namas = [].concat(req.body.nama_pembina || []);
    const kehadirans = [].concat(req.body.kehadiran || []);
    const hargas = [].concat(req.body.harga_satuan || []);
    const kets = [].concat(req.body.keterangan || []);
    const errors = [];
    const items = [];
    namas.forEach((nm, i) => {
      const nama = String(nm || '').trim();
      if (!nama) return;
      const kh = Number(String(kehadirans[i] === undefined ? '0' : kehadirans[i]).replace(',', '.')) || 0;
      const harga = lib.parseMoney(hargas[i]);
      if (!(kh > 0)) { errors.push(`Baris ${i + 1} (${nama}): jumlah kehadiran harus lebih dari 0.`); return; }
      if (!(harga > 0)) { errors.push(`Baris ${i + 1} (${nama}): harga satuan harus lebih dari 0.`); return; }
      items.push({ nama, kh, harga, ket: String(kets[i] || '') });
    });
    if (errors.length) return res.redirect(back + '&err=' + encodeURIComponent(errors.slice(0, 3).join(' · ')));
    if (!items.length) return res.redirect(back + '&err=' + encodeURIComponent('Isi minimal satu baris nama pembina beserta kehadiran & harga satuan.'));
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO ekskul_honor (jenis,periode,posting_periode,nama_pembina,kehadiran,harga_satuan,keterangan,status,created_at)
        VALUES (?,?,?,?,?,?,?,'pending',?)`);
      for (const it of items) ins.run(jenis, periode, posting, it.nama, it.kh, it.harga, it.ket, nowStamp());
    })();
    const total = items.reduce((s, it) => s + Math.round(it.kh * it.harga), 0);
    dbm.logAudit(req.user, 'TAMBAH', 'ekskul', `Input grid honor ekskul ${jenis ? jenis + ' — ' : ''}${items.length} pembina (${rupiah(total)}) periode ${dbm.periodeLabel(periode)}`
      + (posting !== periode ? ` · posting BKU ${dbm.periodeLabel(posting)}` : ''));
    res.redirect(back + '&ok=' + encodeURIComponent(`${items.length} baris honor disimpan (${rupiah(total)}) periode ${dbm.periodeLabel(periode)}`
      + (posting !== periode ? ` — dibukukan ke BKU ${dbm.periodeLabel(posting)}` : '')
      + ' dan masuk antrean posting.'));
  });

  post('/ekskul/save', (req, res) => {
    const isEdit = !!req.body.id;
    guard(req, res, 'ekskul', isEdit ? 'edit' : 'create');
    const back = req.BASE + '/ekskul?periode=' + encodeURIComponent(req.body.periode || '');
    const { id, nama_pembina, periode, keterangan } = req.body;
    const jenis = String(req.body.jenis || '').trim();
    if (!String(nama_pembina || '').trim()) return res.redirect(back + '&err=' + encodeURIComponent('Nama pembina wajib diisi.'));
    if (!/^\d{4}-\d{2}$/.test(String(periode || ''))) return res.redirect(back + '&err=' + encodeURIComponent('Periode wajib dipilih.'));
    /* bulan posting ke BKU (boleh beda dengan periode honor). Kosong → ikut periode. */
    let posting = String(req.body.posting_periode || '').trim();
    if (!isYm(posting)) posting = String(periode);
    const kehadiran = Number(String(req.body.kehadiran || '0').replace(',', '.')) || 0;
    const harga = lib.parseMoney(req.body.harga_satuan);
    if (kehadiran <= 0) return res.redirect(back + '&err=' + encodeURIComponent('Jumlah kehadiran harus lebih dari 0.'));
    if (!(harga > 0)) return res.redirect(back + '&err=' + encodeURIComponent('Harga satuan harus lebih dari 0.'));
    if (isEdit) {
      const row = db.prepare('SELECT * FROM ekskul_honor WHERE id=?').get(id);
      if (!row) return res.redirect(back + '&err=' + encodeURIComponent('Item honor tidak ditemukan.'));
      const trx = row.transaksi_id ? db.prepare('SELECT * FROM transaksi WHERE id=?').get(row.transaksi_id) : null;
      if (trx) {
        const lock = dbm.periodeLockError(trx.bku_id, trx.tanggal, 'edit');
        if (lock) return res.redirect(back + '&err=' + encodeURIComponent('Transaksi BKU terkait tidak dapat diubah: ' + lock));
        if (String(periode) !== String(row.periode)) {
          return res.redirect(back + '&err=' + encodeURIComponent('Periode item yang sudah terposting tidak dapat diubah. Hapus transaksi lalu input ulang bila perlu.'));
        }
        if (String(jenis) !== String(row.jenis || '')) {
          return res.redirect(back + '&err=' + encodeURIComponent('Jenis ekstrakurikuler item yang sudah terposting tidak dapat diubah (satu transaksi BKU = satu jenis). Hapus transaksi lalu input ulang bila perlu.'));
        }
        /* bulan posting item terposting terkunci (transaksi BKU sudah ada di bulan tsb) */
        posting = postingOf(row);
      }
      let synced = null;
      db.transaction(() => {
        db.prepare('UPDATE ekskul_honor SET jenis=?,nama_pembina=?,periode=?,posting_periode=?,kehadiran=?,harga_satuan=?,keterangan=? WHERE id=?')
          .run(jenis, nama_pembina.trim(), periode, posting, kehadiran, harga, keterangan || '', row.id);
        if (row.transaksi_id) synced = syncBatch(row.transaksi_id);
      })();
      dbm.logAudit(req.user, 'EDIT', 'ekskul', `Edit honor ekskul ${jenis ? jenis + ' — ' : ''}${nama_pembina} (${kehadiran} × ${rupiah(harga)})${synced && synced.total !== undefined ? ` · BKU disinkronkan: ${rupiah(synced.total)}` : ''}`);
    } else {
      db.prepare('INSERT INTO ekskul_honor (jenis,periode,posting_periode,nama_pembina,kehadiran,harga_satuan,keterangan,status,created_at) VALUES (?,?,?,?,?,?,?,\'pending\',?)')
        .run(jenis, periode, posting, nama_pembina.trim(), kehadiran, harga, keterangan || '', nowStamp());
      dbm.logAudit(req.user, 'TAMBAH', 'ekskul', `Tambah honor ekskul ${jenis ? jenis + ' — ' : ''}${nama_pembina} (${kehadiran} × ${rupiah(harga)})`
        + (posting !== String(periode) ? ` · periode ${dbm.periodeLabel(periode)}, posting BKU ${dbm.periodeLabel(posting)}` : ''));
    }
    res.redirect(back + '&ok=' + encodeURIComponent(isEdit ? 'Item honor diperbarui.' : 'Item honor disimpan dan masuk antrean posting.'));
  });

  /** hapus tersinkron: item ekskul + antrean + transaksi BKU sasaran (bila sudah terposting) */
  post('/ekskul/delete', (req, res) => {
    guard(req, res, 'ekskul', 'edit');
    const r = db.prepare('SELECT * FROM ekskul_honor WHERE id=?').get(req.body.id);
    const backPath = safePath(req.body.back, '/ekskul?periode=' + encodeURIComponent(req.body.periode || (r ? r.periode : '')));
    const back = req.BASE + backPath;
    if (!r) return res.redirect(back + (back.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent('Item tidak ditemukan.'));
    const sep = back.includes('?') ? '&' : '?';
    if (r.status !== 'posted') {
      dbm.trashAdd('ekskul_honor', r, { user: req.user, label: `Honor ekskul ${r.nama_pembina}` });
      db.prepare('DELETE FROM ekskul_honor WHERE id=?').run(r.id);
      dbm.logAudit(req.user, 'HAPUS', 'ekskul', `Hapus honor ekskul ${r.nama_pembina} (dari antrean posting)`);
      return res.redirect(back + sep + 'ok=' + encodeURIComponent('Item honor dihapus dari daftar & antrean posting (tersimpan di Kotak Sampah).'));
    }
    const trx = r.transaksi_id ? db.prepare('SELECT * FROM transaksi WHERE id=?').get(r.transaksi_id) : null;
    if (trx) {
      const lock = dbm.periodeLockError(trx.bku_id, trx.tanggal, 'edit');
      if (lock) return res.redirect(back + sep + 'err=' + encodeURIComponent('Transaksi BKU terkait tidak dapat dihapus: ' + lock));
    }
    const sibs = r.transaksi_id
      ? db.prepare('SELECT * FROM ekskul_honor WHERE transaksi_id=?').all(r.transaksi_id)
      : [r];
    db.transaction(() => {
      for (const x of sibs) dbm.trashAdd('ekskul_honor', x, { user: req.user, label: `Honor ekskul ${x.nama_pembina}` });
      if (r.transaksi_id) {
        db.prepare('DELETE FROM ekskul_honor WHERE transaksi_id=?').run(r.transaksi_id);
        db.prepare('DELETE FROM transaksi WHERE id=?').run(r.transaksi_id);
      } else {
        db.prepare('DELETE FROM ekskul_honor WHERE id=?').run(r.id);
      }
    })();
    dbm.logAudit(req.user, 'HAPUS', 'ekskul',
      `Hapus ${sibs.length} item honor ekskul ${dbm.periodeLabel(r.periode)}${trx ? ` + transaksi BKU ${trx.no_bukti || '#' + trx.id} (${rupiah(trx.nominal)})` : ''}`);
    res.redirect(back + sep + 'ok=' + encodeURIComponent(
      `${sibs.length} item honor dihapus dari daftar & antrean.${trx ? ' Transaksi BKU sasaran juga dihapus — saldo BKU ikut kembali.' : ''}`));
  });

  /* ================= ANTREAN POSTING ================= */
  get('/ekskul/antrean', (req, res) => {
    guard(req, res, 'ekskul', 'view');
    const c = ctx(req);
    const pending = dbm.ekskulPending();
    const bkuList = bukuss(c.taId);
    const editable = c.can('ekskul', 'edit');
    const late = modalCollector();
    /* kelompokkan per PERIODE + JENIS ekstrakurikuler:
       Pramuka & Paskibra (dan jenis lain) diposting sebagai transaksi BKU TERPISAH,
       bukan digabung menjadi satu transaksi. */
    const map = new Map();
    for (const r of pending) {
      const jenis = String(r.jenis || '').trim();
      const key = r.periode + '|' + jenis;
      if (!map.has(key)) map.set(key, { periode: r.periode, jenis, rows: [], total: 0 });
      const g = map.get(key);
      g.rows.push(r); g.total += r.jumlah;
    }
    const groups = Array.from(map.values()).sort((a, b) => {
      if (a.periode !== b.periode) return a.periode < b.periode ? 1 : -1;
      return String(a.jenis).localeCompare(String(b.jenis), 'id');
    });
    const jenisSet = [...new Set(pending.map(r => String(r.jenis || '').trim()))];
    // batasi riwayat terposting agar halaman tetap ringan (modal edit ikut dirender per baris)
    const postedAll = dbm.ekskulRows().filter(r => r.status === 'posted')
      .sort((a, b) => String(b.posted_at || '').localeCompare(String(a.posted_at || '')));
    const posted = postedAll.slice(0, 60);

    const editForm = (r, fid) => `<form method="post" action="${c.base}/ekskul/save" id="${fid}" data-ekskul-form>
      <input type="hidden" name="id" value="${r.id}">
      <div class="row2">
        <div class="field"><label>Jenis Ekstrakurikuler</label><input name="jenis" list="jenisEkskulList2" value="${esc(r.jenis || '')}"></div>
        <div class="field"><label>Nama Pembina</label><input name="nama_pembina" list="pegawaiList2" value="${esc(r.nama_pembina)}" required></div>
      </div>
      <div class="row3">
        <div class="field"><label>Periode Kinerja / Honor</label><input type="month" name="periode" value="${esc(r.periode)}" required ${r.status === 'posted' ? 'readonly' : ''}></div>
        <div class="field"><label>Bulan Posting ke BKU</label><input type="month" name="posting_periode" value="${esc(postingOf(r))}" ${r.status === 'posted' ? 'readonly' : ''}>
          <div class="hint">Rencana bulan pembukuan. Tanggal transaksi mengikuti tanggal aktual saat posting.</div></div>
        <div class="field"><label>Jumlah Kehadiran</label><input type="text" inputmode="decimal" name="kehadiran" value="${esc(String(r.kehadiran).replace('.', ','))}" data-kehadiran required></div>
      </div>
      <div class="row2">
        <div class="field"><label>Harga Satuan (Rp)</label>${ui.moneyInput('harga_satuan', r.harga_satuan, 'data-harga required')}</div>
        <div class="field"><label>Jumlah Diterima (otomatis)</label><input type="text" data-jumlah readonly value="${num(r.jumlah)}"></div>
      </div>
      <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(r.keterangan || '')}"></div>
      ${r.status === 'posted' ? `<div class="alert warn">${ui.icon('alert')}<div>Item sudah terposting — perubahan nominal otomatis menyelaraskan transaksi BKU terkait.</div></div>` : ''}
    </form>`;

    const content = `<div class="between mb-2">
      <div class="toolbar"><span class="badge ${groups.length ? 'amber' : 'green'}">${groups.length} kelompok menunggu posting</span>
        <span class="badge gray plain">${jenisSet.length} jenis ekstrakurikuler</span></div>
      <div class="toolbar"><a class="btn btn-sm" href="${c.base}/ekskul">${ui.icon('plus')}Input Honor</a></div>
    </div>
    ${groups.length ? `<div class="alert warn mb-3">${ui.icon('alert')}<div><b>Ada ${pending.length} draf honor ekskul belum terposting ke BKU.</b>
      Setiap <b>jenis ekstrakurikuler</b> diposting sebagai <b>transaksi BKU tersendiri</b> (Pramuka, Paskibra, dst. tidak digabung dalam satu transaksi).
      Tinjau total per jenis, lalu pilih BKU tujuan sebelum posting.</div></div>` : ''}
    ${groups.map((g, i) => {
      const gPost = postingOf(g.rows[0]);
      return `
    <div class="card mb-3">
      <div class="card-head"><div><h3>${g.jenis ? esc(g.jenis) : 'Tanpa Jenis'} — Periode Honor ${esc(dbm.periodeLabel(g.periode))}</h3>
        <div class="sub">${g.rows.length} pembina · total ${rupiah(g.total)} · diposting sebagai 1 transaksi BKU
          ${gPost !== g.periode ? `· <b>dibukukan ke BKU ${esc(dbm.periodeLabel(gPost))}</b>` : ''}</div></div>
        <div class="toolbar">
          <form method="post" action="${c.base}/ekskul/antrean/posting" class="flex" style="gap:6px;align-items:flex-end" data-confirm="Posting honor ${esc(g.jenis || 'ekskul')} periode ${esc(dbm.periodeLabel(g.periode))} sebesar ${rupiah(g.total)} ke BKU dengan tanggal transaksi hari ini (${esc(tglID(todayISO()))})?">
            <input type="hidden" name="periode" value="${esc(g.periode)}">
            <input type="hidden" name="jenis" value="${esc(g.jenis)}">
            <div class="field" style="margin:0"><label>Tanggal Transaksi BKU</label>
              <input type="date" name="tanggal" value="${esc(todayISO())}" required title="Otomatis tanggal hari ini — bukan akhir bulan">
              <div class="hint" style="margin-top:2px">Periode honor tetap ${esc(dbm.periodeLabel(g.periode))}</div></div>
            <div class="field" style="margin:0"><label>BKU Tujuan</label><select name="bku_id" required style="min-width:200px">
              <option value="">— Pilih BKU —</option>${bkuList.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}</select></div>
            ${editable ? `<button class="btn btn-primary btn-sm">${ui.icon('save')}Posting ke BKU</button>` : ''}
          </form>
          <a class="btn btn-sm" target="_blank" href="${c.base}/ekskul/cetak?periode=${esc(g.periode)}">${ui.icon('printer')}Cetak</a>
        </div></div>
      <div class="table-wrap"><table><thead><tr><th>No</th><th>Jenis Ekskul</th><th>Nama Pembina</th><th class="num">Kehadiran</th><th class="num">Harga Satuan</th><th class="num">Jumlah Diterima</th><th class="right">Aksi</th></tr></thead><tbody>
        ${g.rows.map((r, j) => `<tr><td class="num">${j + 1}</td><td>${esc(r.jenis || '-')}</td><td class="t-strong">${esc(r.nama_pembina)}</td>
          <td class="num">${String(Number(r.kehadiran) || 0).replace('.', ',')}</td><td class="num">${rupiah(r.harga_satuan)}</td>
          <td class="num t-strong">${rupiah(r.jumlah)}</td>
          <td class="right nowrap">${editable ? `<button class="btn btn-sm btn-icon" data-open="mQe${r.id}" title="Edit">${ui.icon('edit')}</button>
          <form method="post" action="${c.base}/ekskul/delete" style="display:inline" data-confirm="Hapus item honor ${esc(r.nama_pembina)} dari antrean?"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="periode" value="${esc(g.periode)}"><input type="hidden" name="back" value="/ekskul/antrean"><button class="btn btn-sm btn-danger" title="Hapus">${ui.icon('trash')}</button></form>` : ''}</td></tr>
          ${editable ? late('mQe' + r.id, {
        title: 'Edit Honor Antrean — ' + r.nama_pembina, body: editForm(r, 'fqe' + r.id), wide: true,
        footer: `<button class="btn" data-close="mQe${r.id}">Batal</button><button class="btn btn-primary" form="fqe${r.id}">Simpan</button>`
      }) : ''}`).join('')}
      </tbody><tfoot><tr><td colspan="5">TOTAL ${esc((g.jenis || 'EKSPUL').toUpperCase())} ${esc(dbm.periodeLabel(g.periode))}</td><td class="num">${rupiah(g.total)}</td><td></td></tr></tfoot></table></div>
    </div>`;
    }).join('')}
    ${groups.length ? '' : ui.emptyState('Antrean posting kosong', 'Semua honor pembina ekstrakurikuler sudah diposting ke BKU.')}
    <div class="card">
      <div class="card-head"><div><h3>Riwayat Antrean Posting (Sudah Terposting)</h3><div class="sub">${postedAll.length} item${postedAll.length > posted.length ? ` · menampilkan ${posted.length} terbaru` : ''} · hapus akan menghapus transaksi BKU sasaran sekaligus</div></div></div>
      ${posted.length ? `<div class="table-scroll"><table><thead><tr><th>Periode Honor</th><th>Bulan Posting BKU</th><th>Jenis</th><th>Pembina</th><th class="num">Jumlah</th><th>No. Bukti BKU</th><th>Diposting</th><th>Oleh</th><th class="right">Aksi</th></tr></thead><tbody>
        ${posted.map(r => {
      const trx = r.transaksi_id ? db.prepare('SELECT * FROM transaksi WHERE id=?').get(r.transaksi_id) : null;
      const rp = postingOf(r);
      return `<tr><td>${esc(dbm.periodeLabel(r.periode))}</td>
        <td class="nowrap">${esc(dbm.periodeLabel(rp))}${rp !== String(r.periode) ? ' <span class="badge amber plain">beda</span>' : ''}</td>
        <td>${esc(r.jenis || '-')}</td><td class="t-strong">${esc(r.nama_pembina)}</td>
        <td class="num">${rupiah(r.jumlah)}</td><td class="mono t-sub">${esc(trx ? (trx.no_bukti || '#' + trx.id) : '-')}</td>
        <td class="nowrap t-sub">${esc(lib.stampShort(r.posted_at))}</td><td>${esc(r.posted_by || '-')}</td>
        <td class="right nowrap">${editable ? `<button class="btn btn-sm btn-icon" data-open="mQe${r.id}" title="Edit">${ui.icon('edit')}</button>
        <form method="post" action="${c.base}/ekskul/delete" style="display:inline" data-confirm="Hapus honor ${esc(r.nama_pembina)}? SELURUH item pada transaksi BKU yang sama ikut dihapus beserta transaksi BKU sasarannya."><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="back" value="/ekskul/antrean"><button class="btn btn-sm btn-danger" title="Hapus tersinkron">${ui.icon('trash')}</button></form>` : ''}</td></tr>
        ${editable ? late('mQe' + r.id, {
        title: 'Edit Honor Terposting — ' + r.nama_pembina, body: editForm(r, 'fqe' + r.id), wide: true,
        footer: `<button class="btn" data-close="mQe${r.id}">Batal</button><button class="btn btn-primary" form="fqe${r.id}">Simpan &amp; Sinkron BKU</button>`
      }) : ''}`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada yang terposting')}
    </div>
    <datalist id="pegawaiList2">${dbm.pegawaiList(true).map(p => `<option value="${esc(p.nama)}">`).join('')}</datalist>
    <datalist id="jenisEkskulList2">${[...new Set(['Pramuka', 'Paskibra', 'PMR', 'Futsal', 'Basket', 'Seni Tari', 'Seni Musik', 'Rohis',
      ...db.prepare("SELECT DISTINCT jenis FROM ekskul_honor WHERE COALESCE(jenis,'')<>''").all().map(x => x.jenis)])].map(j => `<option value="${esc(j)}">`).join('')}</datalist>
    ${late.html()}`;
    page(req, res, { title: 'Antrean Posting Honor Ekskul', sub: 'Tinjau, edit & posting honor pembina ke BKU', active: 'ekskul_queue', content });
  });

  post('/ekskul/antrean/posting', (req, res) => {
    guard(req, res, 'ekskul', 'edit');
    const back = req.BASE + '/ekskul/antrean';
    const periode = req.body.periode;
    // satu transaksi per JENIS ekstrakurikuler (jenis kosong = tanpa jenis)
    const adaJenis = req.body.jenis !== undefined && req.body.jenis !== null;
    const jenis = String(req.body.jenis || '').trim();
    const rows = adaJenis
      ? db.prepare("SELECT * FROM ekskul_honor WHERE periode=? AND COALESCE(TRIM(jenis),'')=? AND status='pending'").all(periode, jenis)
      : db.prepare("SELECT * FROM ekskul_honor WHERE periode=? AND status='pending'").all(periode);
    if (!rows.length) return res.redirect(back + '?err=' + encodeURIComponent('Tidak ada draf honor untuk periode tersebut.'));
    const bku = db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.bku_id);
    if (!bku) return res.redirect(back + '?err=' + encodeURIComponent('BKU tujuan wajib dipilih.'));
    if (bku.status !== 'aktif') return res.redirect(back + '?err=' + encodeURIComponent('BKU tujuan sudah ditutup.'));
    /* ==================================================================
       PERIODE HONOR vs TANGGAL TRANSAKSI BKU
       Item honor menyimpan `periode` (kinerja). Saat diposting, transaksi
       BKU memakai TANGGAL AKTUAL entry data (default hari ini, WIB) —
       tidak lagi dipaksa ke hari terakhir bulan honor/posting.
       Periode honor tetap tercatat apa adanya pada uraian & laporan.
       ================================================================== */
    const tanggal = tanggalPosting(req.body.tanggal);
    const posting = tanggal.slice(0, 7);
    const postingTa = dbm.tahunById ? dbm.tahunById(bku.tahun_ajaran_id) : null;
    if (postingTa) {
      const rng = dbm.taRange(postingTa);
      const from = rng.from.slice(0, 10), to = rng.to.slice(0, 10);
      if (tanggal < from || tanggal > to) {
        return res.redirect(back + '?err=' + encodeURIComponent(`Tanggal transaksi ${tglID(tanggal)} di luar tahun pelajaran BKU ${bku.nama} (${postingTa.nama || ''}).`));
      }
    }
    const lock = dbm.periodeLockError(bku.id, tanggal);
    if (lock) return res.redirect(back + '?err=' + encodeURIComponent(lock));
    const total = rows.reduce((s, r) => s + jumlahOf(r), 0);
    if (!(total > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Total honor Rp 0 — periksa kehadiran & harga satuan.'));
    const coa = db.prepare("SELECT * FROM coa WHERE kode='5.1.01'").get() || db.prepare("SELECT * FROM coa WHERE kategori='pengeluaran' ORDER BY kode LIMIT 1").get();
    const jenisBatch = rows.every(r => String(r.jenis || '').trim() === String(rows[0].jenis || '').trim())
      ? String(rows[0].jenis || '').trim() : '';
    const uraian = `Honor Pembina Ekstrakurikuler${jenisBatch ? ' ' + jenisBatch : ''} ${dbm.periodeLabel(periode)} (${rows.length} pembina)`
      + (posting !== periode ? ` — dibukukan ${dbm.periodeLabel(posting)}` : '');
    const ym = posting.replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku.id).c + 1;
    const noBukti = `${bku.kode || 'BKU'}/EKS/${ym}/${String(seq).padStart(3, '0')}`;
    const trxId = db.transaction(() => {
      const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
        VALUES (?,?,'pengeluaran','tunai',?,?,?,?,?,'posted',?,?)`)
        .run(bku.id, tanggal, noBukti, coa ? coa.id : null, total, uraian,
          jenisBatch || 'Pembina Ekskul', req.user.id, nowStamp());
      const id = Number(info.lastInsertRowid);
      const upd = db.prepare("UPDATE ekskul_honor SET status='posted',bku_id=?,transaksi_id=?,posting_periode=?,posted_at=?,posted_by=? WHERE id=?");
      for (const r of rows) upd.run(bku.id, id, posting, nowStamp(), req.user.nama, r.id);
      return id;
    })();
    dbm.logAudit(req.user, 'POSTING EKSKUL', 'ekskul',
      `Honor ekskul${jenisBatch ? ' ' + jenisBatch : ''} ${dbm.periodeLabel(periode)} ${rupiah(total)} → ${bku.nama} (${noBukti})`
      + ` · tanggal transaksi ${tglID(tanggal)}`
      + (posting !== periode ? ` · periode honor ${dbm.periodeLabel(periode)}, dibukukan ${dbm.periodeLabel(posting)}` : ''));
    res.redirect(back + '?ok=' + encodeURIComponent(`Honor ${jenisBatch ? jenisBatch + ' ' : ''}${dbm.periodeLabel(periode)} ${rupiah(total)} diposting ke ${bku.nama} (${noBukti})`
      + ` — tanggal transaksi ${tglID(tanggal)}`
      + (posting !== periode ? ` (bulan BKU ${dbm.periodeLabel(posting)}, periode honor tetap ${dbm.periodeLabel(periode)})` : '')
      + ' — transaksi terpisah per jenis ekskul.'));
  });

  /* ================= CETAK ================= */
  get('/ekskul/cetak', (req, res) => {
    guard(req, res, 'ekskul', 'view');
    const c = ctx(req);
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : defaultPeriode(c.ta);
    const rows = dbm.ekskulRows(periode);
    // kelompokkan per JENIS ekstrakurikuler → satu tabel terpisah tiap jenis (tidak digabung)
    const map = new Map();
    for (const r of rows) {
      const key = String(r.jenis || '').trim() || 'Tanpa Jenis';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    const groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'id'));
    const total = totalOf(rows);
    const EL = printcfg.labels(dbm, 'honor_ekskul');
    const signCols = `<div class="sign-grid sign-3 kwit-sign" style="margin-top:6mm">
        <div class="sig"><div class="sig-head"><div>${esc(EL.ttd_kepala || 'Mengetahui:')}</div><div>Kepala ${esc(c.settings.sekolah_nama || 'Sekolah')}</div></div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_kepala || '...............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_kepala || '.......................')}</div></div>
        <div class="sig"><div class="sig-head"><div>&nbsp;</div><div>&nbsp;</div></div><div class="space"></div><div class="nm">&nbsp;</div><div>&nbsp;</div></div>
        <div class="sig"><div class="sig-head"><div>${esc(printcfg.tempatTanggal(dbm, tglID(todayISO())))}</div><div style="font-weight:600">${esc(EL.ttd_bendahara || 'Bendahara')}</div></div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_bendahara || '...............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_bendahara || '.......................')}</div></div>
      </div>`;
    const tables = groups.map(([jenis, list]) => {
      const sub = list.reduce((a, r) => a + r.jumlah, 0);
      const posts = [...new Set(list.map(r => postingOf(r)))].filter(Boolean);
      const postNote = posts.length === 1 && posts[0] !== periode
        ? `<div style="font-size:9pt">Dibukukan ke BKU ${esc(dbm.periodeLabel(posts[0]))}</div>` : '';
      return `<div class="eks-block">
        <div class="doc-title" style="text-align:center;margin:0 0 2.5mm">
          <h3 style="font-size:12pt;margin:0">${esc(EL.judul || 'DAFTAR HONOR PEMBINA EKSTRAKURIKULER')}</h3>
          <div style="font-weight:800;font-size:11pt">${esc(jenis.toUpperCase())}</div>
          <div style="font-size:9pt">Periode Honor ${esc(dbm.periodeLabel(periode))} · ${list.length} pembina</div>
          ${postNote}
        </div>
        <table class="tbl"><thead><tr>
          <th style="width:8mm">No</th><th>Nama Pembina</th>
          <th class="num" style="width:20mm">Jumlah Kehadiran</th>
          <th class="num" style="width:24mm">Harga Satuan (Rp)</th>
          <th class="num" style="width:26mm">Jumlah Diterima (Rp)</th>
          <th style="width:34mm">Keterangan</th><th style="width:36mm">Tanda Terima / Tanda Tangan Penerima</th>
        </tr></thead><tbody>
        ${list.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.nama_pembina)}</td>
          <td class="num">${String(Number(r.kehadiran) || 0).replace('.', ',')}</td>
          <td class="num">${num(r.harga_satuan)}</td><td class="num">${num(r.jumlah)}</td>
          <td>${esc(r.keterangan || '-')}</td><td class="ttd-cell"></td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="4">JUMLAH HONOR ${esc(jenis.toUpperCase())}</td><td class="num">${num(sub)}</td><td colspan="2"></td></tr></tfoot></table>
        ${signCols}
      </div>`;
    }).join('');
    const body = `${ui.kop(c.settings)}
      ${tables || '<p style="text-align:center">Belum ada data honor pada periode ini.</p>'}
      ${groups.length > 1 ? `<div class="grand-total">TOTAL SELURUH JENIS EKSTRAKURIKULER: <b>${rupiah(total)}</b> (${groups.length} jenis)</div>` : ''}`;
    const orient = printcfg.orient(req, dbm, 'honor_ekskul');
    res.html(ui.printPage({
      settings: c.settings, base: c.base, title: 'Daftar Honor Pembina Ekskul', backHref: '/ekskul',
      orient, selfPath: req.url,
      pageCss: `@page{size:A4 ${orient === 'portrait' ? 'portrait' : 'landscape'};margin:11mm}
        .print-area{padding:0}
        .eks-block{page-break-after:always}
        .eks-block:last-of-type{page-break-after:auto}
        .tbl{width:100%;border-collapse:collapse;font-size:9pt}
        .tbl th,.tbl td{border:1px solid #333;padding:1.5mm 2mm}
        .tbl th{background:#FCEFE3;text-align:left;font-size:8.6pt}
        .tbl .num{text-align:right}
        .ttd-cell{height:9mm}
        thead{display:table-header-group} tr{page-break-inside:avoid}
        .sign-grid{margin-top:6mm}
        .grand-total{margin-top:4mm;text-align:right;font-size:10pt}`,
      body
    }));
  });

  get('/ekskul/export', (req, res) => {
    guard(req, res, 'ekskul', 'view');
    const periode = /^\d{4}-\d{2}$/.test(req.query.get('periode') || '') ? req.query.get('periode') : '';
    const rows = dbm.ekskulRows(periode || undefined);
    const map = new Map();
    for (const r of rows) {
      const key = String(r.jenis || '').trim() || 'Tanpa Jenis';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    const head = ['NO', 'PERIODE HONOR', 'BULAN POSTING BKU', 'JENIS EKSTRAKURIKULER', 'NAMA PEMBINA', 'JUMLAH KEHADIRAN', 'HARGA SATUAN', 'JUMLAH DITERIMA', 'KETERANGAN', 'STATUS'].map(v => ({ v, bold: true }));
    const out = [];
    let grand = 0;
    for (const [jenis, list] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'id'))) {
      const sub = list.reduce((a, r) => a + r.jumlah, 0);
      grand += sub;
      out.push([{ v: `HONOR PEMBINA EKSTRAKURIKULER — ${jenis.toUpperCase()}`, bold: true }]);
      out.push([`Periode: ${periode ? dbm.periodeLabel(periode) : 'semua periode'} · ${list.length} pembina`]);
      out.push([]);
      out.push(head);
      list.forEach((r, i) => out.push([i + 1, dbm.periodeLabel(r.periode), dbm.periodeLabel(postingOf(r)), jenis, r.nama_pembina,
        Number(r.kehadiran), Number(r.harga_satuan), r.jumlah, r.keterangan || '',
        r.status === 'posted' ? 'Terposting' : 'Menunggu Posting']));
      out.push([{ v: `SUBTOTAL ${jenis.toUpperCase()}`, bold: true }, '', '', '', '', '', '', { v: sub, bold: true }, '', '']);
      out.push([]);
    }
    if (!rows.length) out.push(['Belum ada data honor pembina ekstrakurikuler.']);
    else out.push([{ v: 'GRAND TOTAL SELURUH JENIS', bold: true }, '', '', '', '', '', '', { v: grand, bold: true }]);
    res.file(lib.xlsxBuffer('Honor Ekskul', out, [6, 14, 18, 24, 30, 18, 16, 18, 28, 18]),
      `honor-ekskul${periode ? '-' + periode : ''}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
};
