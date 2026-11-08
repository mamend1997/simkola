'use strict';
const printcfg = require('../printcfg');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num, terbilangRupiah } = lib;

  function bukuAktif(taId) {
    // buku pembantu/rekap (auto_mode=1) bukan target input — hanya menerima rekapan otomatis
    return db.prepare("SELECT * FROM bku WHERE status='aktif' AND tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan").all(taId);
  }

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }

  function sisaPagu(coaId, taId) {
    const a = db.prepare('SELECT pagu FROM anggaran WHERE coa_id=? AND tahun_ajaran_id=?').get(coaId, taId);
    if (!a) return null;
    const real = db.prepare(`SELECT COALESCE(SUM(t.nominal),0) r FROM transaksi t JOIN bku b ON b.id=t.bku_id
      WHERE t.coa_id=? AND t.status='posted' AND t.jenis='pengeluaran' AND b.tahun_ajaran_id=?`).get(coaId, taId).r;
    return Number(a.pagu) - real;
  }

  function trxForm(c, { mode = 'pemasukan', trx = null, taId, bukuss, closeId = '', judul = '' }) {
    const coaAll = db.prepare("SELECT * FROM coa ORDER BY kategori, kode").all();
    const jenis0 = trx ? trx.jenis : mode;
    // pengeluaran: HANYA akun belanja/pengeluaran (akun pendapatan disembunyikan)
    const coaList = jenis0 === 'pemasukan'
      ? coaAll.filter(x => dbm.COA_INCOME_KATEGORI.includes(x.kategori))
      : coaAll.filter(x => dbm.COA_EXPENSE_KATEGORI.includes(x.kategori) || (trx && String(trx.coa_id) === String(x.id)));
    const fid = 'fTrx_' + (trx ? 'edit' : mode);
    const tgl = trx ? trx.tanggal : todayISO();
    const jenis = trx ? trx.jenis : mode;
    // form EDIT memakai struktur yang sama persis dengan form Pemasukan/Pengeluaran
    const judulForm = judul || (jenis === 'pemasukan' ? 'Input Pemasukan / Penerimaan Kas' : 'Input Pengeluaran / Belanja');
    const closeTarget = closeId || ('mTrx' + (trx ? 'Edit' : (mode === 'pemasukan' ? 'In' : 'Out')));
    return `<form method="post" action="${c.base}/transaksi/save" id="${fid}" data-trx-form>
      ${trx ? `<input type="hidden" name="id" value="${trx.id}">` : ''}
      <input type="hidden" name="jenis" value="${jenis}">
      <div class="alert ${jenis === 'pemasukan' ? 'ok' : 'warn'}" style="margin-bottom:16px">${ui.icon(jenis === 'pemasukan' ? 'up' : 'down')}
        <div><b>${esc(judulForm)}</b><br>
        <span class="small">${trx
        ? `Nomor bukti tetap <b>${esc(trx.no_bukti || '-')}</b> — perubahan langsung memperbarui saldo BKU.`
        : 'Transaksi hanya dapat disimpan pada BKU yang berstatus <b>AKTIF</b>.'}</span></div></div>
      <div class="row2">
        <div class="field"><label>Buku Kas Sasaran (BKU Aktif)</label>
          <select name="bku_id" required>
            <option value="">— Pilih BKU —</option>
            ${bukuss.map(b => `<option value="${b.id}" ${trx && String(trx.bku_id) === String(b.id) ? 'selected' : ''}>${esc(b.nama)} (${b.jenis === 'umum' ? 'Umum' : 'Kegiatan'})</option>`).join('')}
          </select>
          ${bukuss.length ? '' : '<div class="hint" style="color:var(--red)">Tidak ada BKU aktif. Buka/tambah BKU terlebih dahulu.</div>'}
        </div>
        <div class="field"><label>Tanggal Transaksi</label><input type="date" name="tanggal" value="${esc(tgl)}" required></div>
      </div>
      <div class="field"><label>Jenis Transaksi</label>
        <div class="radio-cards">
          <input type="radio" name="metode" id="${fid}_tunai" value="tunai" ${(!trx || trx.metode === 'tunai') ? 'checked' : ''}>
          <label for="${fid}_tunai"><span class="dot"></span> Tunai (Kas)</label>
          <input type="radio" name="metode" id="${fid}_transfer" value="transfer" ${trx && trx.metode === 'transfer' ? 'checked' : ''}>
          <label for="${fid}_transfer"><span class="dot"></span> Transfer / Bank</label>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label>Kode Rekening</label>
          <select name="coa_id" class="js-coa" required>
            <option value="">— Pilih kode rekening —</option>
            ${coaList.map(x => `<option value="${x.id}" data-k="${x.kategori}" ${trx && String(trx.coa_id) === String(x.id) ? 'selected' : ''}>${esc(x.kode + ' · ' + x.nama)}</option>`).join('')}
          </select>
          <div class="hint">Rekening ditampilkan sesuai jenis transaksi.</div>
        </div>
        <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', trx ? trx.nominal : '', 'class="js-nominal" required placeholder="0"')}</div>
      </div>
      <div class="alert warn js-approval" style="display:none;margin-bottom:14px">${ui.icon('clock')}<div><b>Perlu persetujuan:</b> nominal melebihi batas ${rupiah(dbm.getSetting('approval_threshold', '5000000'))}. Transaksi akan berstatus <b>Pending</b> sampai disetujui Kepala Sekolah.</div></div>
      <div class="alert js-pagu" style="display:none;margin-bottom:14px"></div>
      <div class="field"><label>Uraian / Keterangan</label><textarea name="uraian" required placeholder="Contoh: Pembelian ATK untuk kegiatan ujian semester">${esc(trx ? trx.uraian : '')}</textarea>
        <div class="hint">Terbilang: <b class="js-terbilang" style="color:var(--o-700)"></b></div></div>
      <div class="row2">
        <div class="field"><label>${jenis === 'pemasukan' ? 'Nama Penyetor / Penerima' : 'Nama Penerima'}</label>
          <input name="nama_pihak" value="${esc(trx ? trx.nama_pihak : '')}" placeholder="Nama orang / instansi / toko"></div>
        <div class="field"><label>Upload Bukti Fisik / Nota (maks 15 MB)</label>
          <input type="hidden" name="nota_b64" id="nota_b64">
          <input type="file" accept="image/*,application/pdf" data-b64="nota_b64" data-max="15">
          <div class="hint" id="nota_b64-info">${trx && trx.nota_url ? '<span class="badge green plain">Nota sudah terlampir</span>' : 'Opsional, gambar atau PDF.'}</div>
        </div>
      </div>
      <div class="modal-foot" style="padding:16px 0 0;background:none;border-radius:0">
        <button class="btn" type="button" data-close="${closeTarget}">Batal</button>
        <button class="btn" name="after" value="saja" type="submit">${ui.icon('save')}Simpan Saja</button>
        <button class="btn btn-primary" name="after" value="cetak" type="submit">${ui.icon('printer')}Simpan &amp; Cetak Kwitansi</button>
      </div>
    </form>`;
  }

  get('/transaksi', (req, res) => {
    guard(req, res, 'transaksi', 'view');
    const c = ctx(req);
    const ta = c.ta;
    const taId = c.taId;
    const bukuss = taId ? bukuAktif(taId) : [];
    const bkuAll = dbm.allBku(taId);
    const fBku = req.query.get('bku') || '';
    const fStatus = req.query.get('status') || '';
    const from = req.query.get('from') || '';
    const to = req.query.get('to') || '';
    const kw = req.query.get('q') || '';
    const sort = req.query.get('sort') === 'asc' ? 'asc' : 'desc';
    const inlineId = Number(req.query.get('inline') || 0);

    // klausa filter dipakai bersama oleh query hitung & query daftar
    let where = ' WHERE b.tahun_ajaran_id=?';
    const args = [taId || 0];
    if (fBku) { where += ' AND t.bku_id=?'; args.push(fBku); }
    if (fStatus) { where += ' AND t.status=?'; args.push(fStatus); }
    if (from) { where += ' AND t.tanggal>=?'; args.push(from); }
    if (to) { where += ' AND t.tanggal<=?'; args.push(to); }
    if (kw) { where += ' AND (t.uraian LIKE ? OR t.no_bukti LIKE ? OR t.nama_pihak LIKE ?)'; args.push('%' + kw + '%', '%' + kw + '%', '%' + kw + '%'); }

    /* SATU HALAMAN BERURUTAN DI DALAM SCROLLABLE BOX (tanpa pagination):
       seluruh transaksi sesuai filter dirender berurutan dan digeser di dalam
       kotak tabel. Modal approval/void dirender hanya saat diminta (?appr=/?void=). */
    const totalRows = db.prepare(`SELECT COUNT(*) c FROM transaksi t JOIN bku b ON b.id=t.bku_id${where}`).get(...args).c;
    const perPage = 0;
    const totalPages = 1;
    const hal = 1;
    // default: transaksi terbaru di paling atas
    const sql = `SELECT t.*, b.nama bku_nama, b.status bku_status, co.kode coa_kode, co.nama coa_nama, u.nama pembuat, a.nama penyetuju
      FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN coa co ON co.id=t.coa_id
      LEFT JOIN users u ON u.id=t.created_by LEFT JOIN users a ON a.id=t.approved_by${where}
      ORDER BY t.tanggal ${sort === 'asc' ? 'ASC' : 'DESC'}, t.id ${sort === 'asc' ? 'ASC' : 'DESC'}`;
    const rows = db.prepare(sql).all(...args);

    // query filter aktif → dipakai untuk kembali ke posisi semula setelah edit inline
    const keepQs = new URLSearchParams();
    if (kw) keepQs.set('q', kw);
    if (fBku) keepQs.set('bku', fBku);
    if (fStatus) keepQs.set('status', fStatus);
    if (from) keepQs.set('from', from);
    if (to) keepQs.set('to', to);
    if (sort === 'asc') keepQs.set('sort', 'asc');
    const keepStr = keepQs.toString();
    const backPath = '/transaksi' + (keepStr ? '?' + keepStr : '');
    const withBack = (extra) => backPath + (keepStr ? '&' : '?') + extra;
    const coaInline = db.prepare('SELECT * FROM coa ORDER BY kategori, kode').all();
    // cache kunci periode per (BKU, bulan) — hindari query berulang saat tabel panjang
    const lockCache = new Map();
    const lockOf = (bkuId, tanggal, mode) => {
      const per = String(tanggal || '').slice(0, 7);
      const key = bkuId + '|' + per + '|' + (mode || '');
      if (!lockCache.has(key)) lockCache.set(key, dbm.periodeLockError(bkuId, tanggal, mode));
      return lockCache.get(key);
    };
    // total dihitung dari seluruh data sesuai filter (bukan hanya baris halaman aktif)
    const sumSql = `SELECT
        COALESCE(SUM(CASE WHEN t.status='posted' AND t.jenis='pemasukan' THEN t.nominal ELSE 0 END),0) masuk,
        COALESCE(SUM(CASE WHEN t.status='posted' AND t.jenis='pengeluaran' THEN t.nominal ELSE 0 END),0) keluar
      FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE b.tahun_ajaran_id=?`;
    const sumArgs = [taId || 0];
    let sumWhere = '';
    if (fBku) { sumWhere += ' AND t.bku_id=?'; sumArgs.push(fBku); }
    if (fStatus) { sumWhere += ' AND t.status=?'; sumArgs.push(fStatus); }
    if (from) { sumWhere += ' AND t.tanggal>=?'; sumArgs.push(from); }
    if (to) { sumWhere += ' AND t.tanggal<=?'; sumArgs.push(to); }
    if (kw) { sumWhere += ' AND (t.uraian LIKE ? OR t.no_bukti LIKE ? OR t.nama_pihak LIKE ?)'; sumArgs.push('%' + kw + '%', '%' + kw + '%', '%' + kw + '%'); }
    const sums = db.prepare(sumSql + sumWhere).get(...sumArgs);
    const totalIn = Number(sums.masuk || 0);
    const totalOut = Number(sums.keluar || 0);
    const pendingCnt = db.prepare(`SELECT COUNT(*) c FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE t.status='pending' AND b.tahun_ajaran_id=?`).get(taId || 0).c;
    const threshold = Number(dbm.getSetting('approval_threshold', '5000000'));
    const simpan = req.query.get('simpan');
    const saved = simpan ? db.prepare('SELECT * FROM transaksi WHERE id=?').get(simpan) : null;
    const editId = req.query.get('edit');
    const editTrx = editId ? db.prepare('SELECT * FROM transaksi WHERE id=?').get(editId) : null;
    const autoOpen = req.query.get('new');
    const voidAsk = Number(req.query.get('void') || 0);
    const apprAsk = Number(req.query.get('appr') || 0);
    const voidTrx = voidAsk ? db.prepare('SELECT t.*, b.nama bku_nama, b.status bku_status FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE t.id=?').get(voidAsk) : null;
    const apprTrx = apprAsk ? db.prepare('SELECT t.*, b.nama bku_nama, u.nama pembuat FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN users u ON u.id=t.created_by WHERE t.id=?').get(apprAsk) : null;
    const late = modalCollector();

    const paguMap = {};
    if (taId) {
      for (const a of db.prepare('SELECT coa_id, pagu FROM anggaran WHERE tahun_ajaran_id=?').all(taId)) paguMap[a.coa_id] = a.pagu;
      for (const id of Object.keys(paguMap)) paguMap[id] = sisaPagu(Number(id), taId);
    }

    /* ---------- edit inline pada tabel Rekap Transaksi ---------- */
    const canUnlock = c.can('tutup_bulanan', 'edit');
    const inlineTrx = inlineId ? rows.find(r => r.id === inlineId) : null;

    function unlockBtn(t) {
      const periode = String(t.tanggal || '').slice(0, 7);
      return `<form method="post" action="${c.base}/tutup-bulanan/buka" style="display:inline" data-confirm="Buka kunci (unlock) periode ${esc(dbm.periodeLabel(periode))} untuk ${esc(t.bku_nama)}? Setelah dibuka, transaksi bulan tersebut dapat diedit kembali.">
        <input type="hidden" name="bku_id" value="${t.bku_id}"><input type="hidden" name="periode" value="${esc(periode)}">
        <input type="hidden" name="back" value="${esc(backPath)}">
        <button class="btn btn-sm btn-soft" title="Buka kunci periode ${esc(dbm.periodeLabel(periode))}">${ui.icon('unlock')}Buka Kunci</button></form>`;
    }

    function inlineFormHtml(t) {
      return `<form method="post" action="${c.base}/transaksi/save" id="fInline">
        <input type="hidden" name="id" value="${t.id}">
        <input type="hidden" name="jenis" value="${esc(t.jenis)}">
        <input type="hidden" name="bku_id" value="${t.bku_id}">
        <input type="hidden" name="nama_pihak" value="${esc(t.nama_pihak || '')}">
        <input type="hidden" name="back" value="${esc(backPath)}">
      </form>`;
    }

    function inlineRowHtml(t) {
      const lockEdit = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
      const coaList = coaInline.filter(x => t.jenis === 'pemasukan'
        ? dbm.COA_INCOME_KATEGORI.includes(x.kategori)
        : (dbm.COA_EXPENSE_KATEGORI.includes(x.kategori) || String(t.coa_id) === String(x.id)));
      return `<tr class="inline-edit-row" id="trx${t.id}">
        <td><input type="date" name="tanggal" form="fInline" value="${esc(t.tanggal)}" required></td>
        <td class="mono t-sub nowrap">${esc(t.no_bukti || '-')}<div class="inline-hint">no. bukti tetap</div></td>
        <td class="t-sub">${esc(t.bku_nama)}
          <div class="inline-hint">${t.jenis === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}</div></td>
        <td>
          <input class="inline-uraian" type="text" name="uraian" form="fInline" value="${esc(t.uraian)}" required>
          <select name="coa_id" form="fInline" style="margin-top:5px">
            <option value="">— Tanpa kode rekening —</option>
            ${coaList.map(x => `<option value="${x.id}" ${String(t.coa_id) === String(x.id) ? 'selected' : ''}>${esc(x.kode + ' · ' + x.nama)}</option>`).join('')}
          </select>
          ${lockEdit ? `<div class="inline-hint" style="color:var(--red)">${esc(lockEdit)}</div>` : ''}
        </td>
        <td><select name="metode" form="fInline">
          <option value="tunai" ${t.metode === 'tunai' ? 'selected' : ''}>Tunai</option>
          <option value="transfer" ${t.metode === 'transfer' ? 'selected' : ''}>Transfer</option></select></td>
        <td class="num">${ui.moneyInput('nominal', t.nominal, 'class="inline-nominal" form="fInline" required')}</td>
        <td>${ui.trxStatusBadge(t.status)}<div class="inline-hint">${t.status === 'pending' ? 'tetap menunggu approval' : 'simpul tersimpan'}</div></td>
        <td class="right">
          <div class="inline-actions">
            <a class="btn btn-sm" href="${c.base}${backPath}#trx${t.id}" title="Batal">${ui.icon('x')}Batal</a>
            ${lockEdit && canUnlock ? unlockBtn(t) : ''}
            <button class="btn btn-sm btn-primary" form="fInline" ${lockEdit ? 'disabled title="Periode terkunci — buka kunci terlebih dahulu"' : ''}>${ui.icon('save')}Simpan</button>
          </div>
        </td></tr>`;
    }

    const content = `
    ${saved ? `<div class="card mb-3" style="border-color:#BFE9D8;background:#F7FDFA">
      <div class="between"><div>
        <div style="font-weight:800;font-size:15px">${ui.icon('check', 'i-sm')} Transaksi berhasil disimpan — <span class="mono">${esc(saved.no_bukti)}</span></div>
        <div class="small muted">${esc(saved.uraian)} · ${rupiah(saved.nominal)} ${saved.status === 'pending' ? '· menunggu persetujuan Kepala Sekolah' : ''}</div>
      </div>
      <div class="toolbar">
        <a class="btn" href="${c.base}/transaksi">Simpan Saja</a>
        <a class="btn btn-primary" href="${c.base}/transaksi/${saved.id}/kwitansi?auto=1" target="_blank">${ui.icon('printer')}Simpan &amp; Cetak Kwitansi</a>
      </div></div></div>` : ''}
    <div class="between mb-2">
      <div class="toolbar">
        <form method="get" action="${c.base}/transaksi" class="flex flex-wrap filter-eq" style="gap:8px">
          <input name="q" value="${esc(kw)}" placeholder="Cari uraian / no. bukti / nama">
          <select name="bku"><option value="">Semua BKU</option>${bkuAll.map(b => `<option value="${b.id}" ${String(fBku) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select>
          <select name="status"><option value="">Semua Status</option>
            <option value="posted" ${fStatus === 'posted' ? 'selected' : ''}>Terposting</option>
            <option value="pending" ${fStatus === 'pending' ? 'selected' : ''}>Menunggu Approval</option>
            <option value="rejected" ${fStatus === 'rejected' ? 'selected' : ''}>Ditolak</option></select>
          <select name="sort" title="Urutan transaksi">
            <option value="desc" ${sort === 'desc' ? 'selected' : ''}>Terbaru ke Terlama</option>
            <option value="asc" ${sort === 'asc' ? 'selected' : ''}>Terlama ke Terbaru</option>
          </select>
          <input type="date" name="from" value="${esc(from)}" title="Dari tanggal">
          <input type="date" name="to" value="${esc(to)}" title="Sampai tanggal">
          <button class="btn">${ui.icon('search')}Filter</button>
        </form>
      </div>
      <div class="toolbar">
        ${c.can('transaksi', 'create') ? `<button class="btn btn-blue btn-lg" data-open="mTrxIn" ${bukuss.length ? '' : 'disabled'}>${ui.icon('plus')}Pemasukan</button>
        <button class="btn btn-orange btn-lg" data-open="mTrxOut" ${bukuss.length ? '' : 'disabled'}>${ui.icon('plus')}Pengeluaran</button>
        <button class="btn" data-open="mPindah" ${bukuss.length > 1 ? '' : 'disabled'}>${ui.icon('refresh')}Pindah Saldo</button>` : ''}
        <a class="btn" href="${c.base}/laporan?r=bku" target="_blank">${ui.icon('printer')}Cetak BKU</a>
      </div>
    </div>

    <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="kpi ic-green"><div class="ico">${ui.icon('up')}</div><div class="lbl">Pemasukan (filter)</div><div class="val" style="font-size:19px">${rupiah(totalIn)}</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Pengeluaran (filter)</div><div class="val" style="font-size:19px">${rupiah(totalOut)}</div></div>
      <div class="kpi ic-orange"><div class="ico">${ui.icon('receipt')}</div><div class="lbl">Jumlah Transaksi</div><div class="val" style="font-size:19px">${totalRows}</div>
        <div class="meta">${totalRows > perPage ? `halaman ${hal}/${totalPages}` : 'seluruh periode'}</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('clock')}</div><div class="lbl">Menunggu Approval</div><div class="val" style="font-size:19px">${pendingCnt}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Rekap Transaksi Real-time</h3><div class="sub">Satu halaman berurutan di dalam kotak bergulir · edit inline lewat ikon pensil. Data terbaru tampil paling atas.</div></div>
        <div class="toolbar"><span class="small muted">${rows.length} transaksi ditampilkan (satu halaman)</span></div></div>
      ${inlineTrx ? inlineFormHtml(inlineTrx) : ''}
      ${rows.length ? `<form id="fTrxMass" method="post" action="${c.base}/transaksi/hapus-masal">
        <input type="hidden" name="back" value="${esc(backPath)}">
        <div class="between mb-1">
          <div class="small muted">Centang transaksi untuk hapus masal (dipindahkan ke Kotak Sampah).
            Terpilih: <b data-check-count="trxIds">0</b> transaksi.</div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-all="trxIds">${ui.icon('check')}Pilih Semua</button>
            <button type="button" class="btn btn-sm" data-check-none="trxIds">${ui.icon('x')}Hapus Ceklis</button>
            ${c.can('transaksi', 'delete') ? `<button class="btn btn-sm btn-danger" type="submit"
              data-confirm-click="Hapus semua transaksi yang dicentang? Data dipindahkan ke Kotak Sampah dan dapat dipulihkan 30 hari.">
              ${ui.icon('trash')}Hapus Terpilih (<b data-check-count="trxIds">0</b>)</button>` : ''}
          </div></div>
      </form>
      <div class="table-scroll tall" id="rekapTrx"><table><thead><tr>
        <th style="width:34px"><input type="checkbox" data-check-all-box="trxIds" title="Pilih semua"></th>
        <th style="min-width:130px">Tanggal</th><th>No. Bukti</th><th>BKU</th><th>Uraian &amp; Rekening</th><th>Metode</th><th class="num">Nominal</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(t => {
      const lockEdit = lockOf(t.bku_id, t.tanggal, 'edit');
      const lockInfo = lockOf(t.bku_id, t.tanggal);
      const perLock = lockEdit || lockInfo;
      const bisaInline = c.can('transaksi', 'edit') && t.bku_status === 'aktif' && !t.is_penyesuaian;
      if (inlineId === t.id && bisaInline) return inlineRowHtml(t);
      const bisaHapusRow = c.can('transaksi', 'delete') && t.bku_status === 'aktif' && !lockEdit && !t.is_penyesuaian;
      return `<tr id="trx${t.id}">
        <td><input type="checkbox" form="fTrxMass" name="id" data-check-item="trxIds" value="${t.id}" ${bisaHapusRow ? '' : 'disabled title="Tidak dapat dihapus (BKU terkunci / opnam)"'}></td>
        <td class="nowrap">${tglID(t.tanggal)}</td>
        <td class="mono t-sub nowrap">${esc(t.no_bukti || '-')}</td>
        <td>${esc(t.bku_nama)}${t.bku_status !== 'aktif' ? ` <span class="badge gray plain">terkunci</span>` : ''}${lockEdit ? ` <span class="badge red plain" title="${esc(lockEdit)}">periode ditutup</span>` : ''}${!lockEdit && lockInfo ? ` <span class="badge amber plain" title="${esc(lockInfo)}">belum ditutup</span>` : ''}${t.is_penyesuaian ? ` <span class="badge orange plain">opnam</span>` : ''}${t.transfer_group ? ` <span class="badge blue plain">pindah saldo</span>` : ''}${t.void_of ? ` <span class="badge red plain">jurnal pembalik</span>` : ''}${t.void_reversal_id ? ` <span class="badge red plain">di-void</span>` : ''}</td>
        <td><div class="t-strong">${esc(t.uraian)}</div><div class="t-sub">${esc(t.coa_kode || '')} ${esc(t.coa_nama || '')}${t.nama_pihak ? ' · ' + esc(t.nama_pihak) : ''}</div></td>
        <td>${t.metode === 'tunai' ? ui.badge('Tunai', 'gray') : ui.badge('Transfer', 'blue')}</td>
        <td class="num t-strong" style="color:${t.jenis === 'pemasukan' ? 'var(--green)' : 'var(--red)'}">${t.jenis === 'pemasukan' ? '+' : '−'} ${rupiah(t.nominal)}</td>
        <td>${ui.trxStatusBadge(t.status)}${t.status === 'pending' ? `<div class="t-sub">oleh ${esc(t.pembuat || '-')}</div>` : ''}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" href="${c.base}/transaksi/${t.id}/kwitansi" target="_blank" title="Cetak kwitansi">${ui.icon('printer')}</a>
          ${t.nota_url ? `<a class="btn btn-sm" href="${c.base}/nota/${t.id}" target="_blank" title="Lihat nota">${ui.icon('eye')}</a>` : `<span class="btn btn-sm" style="opacity:.4;cursor:default" title="Tidak ada nota">${ui.icon('eye')}</span>`}
          ${t.status === 'pending' && c.can('transaksi', 'approve') ? `<a class="btn btn-sm btn-green" href="${c.base}${withBack('appr=' + t.id)}#trx${t.id}" title="Setujui">${ui.icon('check')}</a>` : ''}
          ${bisaInline ? `<a class="btn btn-sm btn-icon" href="${c.base}${withBack('inline=' + t.id)}#trx${t.id}" title="Edit langsung di tabel">${ui.icon('edit')}</a>` : ''}
          ${lockEdit && canUnlock && c.can('transaksi', 'edit') ? unlockBtn(t) : ''}
          ${t.status === 'posted' && t.bku_status === 'aktif' && !lockEdit && !t.is_penyesuaian && !t.void_reversal_id && !t.void_of && c.can('transaksi', 'edit') ? `<a class="btn btn-sm btn-warn" href="${c.base}${withBack('void=' + t.id)}#trx${t.id}" title="Batalkan transaksi (void)">${ui.icon('x')}Void</a>` : ''}
          ${t.bku_status === 'aktif' && !lockEdit && !t.is_penyesuaian && c.can('transaksi', 'delete') ? `<form method="post" action="${c.base}/transaksi/delete" style="display:inline" data-confirm="Hapus transaksi ${esc(t.no_bukti || '')}? Data dipindahkan ke Kotak Sampah (dapat dipulihkan 30 hari)."><input type="hidden" name="id" value="${t.id}"><input type="hidden" name="back" value="${esc(backPath)}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>`; }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada transaksi', 'Gunakan tombol Pemasukan atau Pengeluaran untuk mulai mencatat.')}

      ${voidTrx ? ui.modal('mVoidLazy', {
        title: 'Batalkan Transaksi (Void)',
        body: `<form method="post" action="${c.base}/transaksi/void" id="fvLazy">
          <input type="hidden" name="id" value="${voidTrx.id}">
          <input type="hidden" name="back" value="${esc(backPath)}">
          <div class="alert warn">${ui.icon('alert')}<div><b>Void ${esc(voidTrx.no_bukti || '')} — ${rupiah(voidTrx.nominal)}.</b><br>
            Sistem akan membuat <b>jurnal pembalik</b> di BKU untuk menetralkan saldo, mengembalikan status tagihan iuran/piutang terkait menjadi belum dibayar, dan mencatat audit log.</div></div>
          <div class="field"><label>Alasan Pembatalan / Void <span style="color:var(--red)">*</span></label>
            <textarea name="alasan" required placeholder="Contoh: salah input nominal / pembayaran dibatalkan siswa"></textarea></div>
        </form>`,
        footer: `<a class="btn" href="${c.base}${backPath}#trx${voidTrx.id}">Batal</a>
          <button class="btn btn-danger" form="fvLazy">${ui.icon('x')}Void &amp; Buat Jurnal Pembalik</button>`
      }).replace('class="modal" id="mVoidLazy"', 'class="modal show" id="mVoidLazy"') : ''}
      ${apprTrx ? ui.modal('mApprLazy', {
        title: 'Persetujuan Transaksi',
        body: `<div class="kv">
            <dt>No. Bukti</dt><dd class="mono">${esc(apprTrx.no_bukti || '-')}</dd>
            <dt>Tanggal</dt><dd>${tglID(apprTrx.tanggal)}</dd>
            <dt>BKU</dt><dd>${esc(apprTrx.bku_nama)}</dd>
            <dt>Uraian</dt><dd>${esc(apprTrx.uraian)}</dd>
            <dt>Penerima</dt><dd>${esc(apprTrx.nama_pihak || '-')}</dd>
            <dt>Nominal</dt><dd style="color:var(--o-700);font-size:16px">${rupiah(apprTrx.nominal)}</dd>
            <dt>Dibuat oleh</dt><dd>${esc(apprTrx.pembuat || '-')}</dd>
          </div>
          <form method="post" action="${c.base}/transaksi/approve" id="faLazy">
            <input type="hidden" name="id" value="${apprTrx.id}">
            <div class="field mt-2"><label>Catatan Persetujuan (opsional)</label><input name="catatan" placeholder="Contoh: Disetujui sesuai RAPBS"></div>
          </form>`,
        footer: `<a class="btn" href="${c.base}${backPath}#trx${apprTrx.id}">Batal</a>
          <button class="btn btn-danger" form="faLazy" name="aksi" value="reject">Tolak</button>
          <button class="btn btn-green" form="faLazy" name="aksi" value="approve">${ui.icon('check')}Setujui</button>`
      }).replace('class="modal" id="mApprLazy"', 'class="modal show" id="mApprLazy"') : ''}
      ${late.html()}
    </div>

    ${c.can('transaksi', 'create') ? `
      ${ui.modal('mTrxIn', { title: 'Input Pemasukan', wide: true, body: trxForm(c, { mode: 'pemasukan', taId, bukuss }) })}
      ${ui.modal('mTrxOut', { title: 'Input Pengeluaran', wide: true, body: trxForm(c, { mode: 'pengeluaran', taId, bukuss }) })}
    ` : ''}
    ${editTrx ? ui.modal('mEditTrx', {
      title: 'Edit Transaksi ' + (editTrx.no_bukti || ''), wide: true,
      body: trxForm(c, {
        mode: editTrx.jenis, trx: editTrx, taId,
        bukuss: dbm.allBku(taId).filter(b => b.status === 'aktif' || String(b.id) === String(editTrx.bku_id)),
        closeId: 'mEditTrx', judul: 'Edit Transaksi / Koreksi Data'
      })
    }).replace('class="modal" id="mEditTrx"', 'class="modal show" id="mEditTrx"') : ''}
    ${c.can('transaksi', 'create') && bukuss.length > 1 ? ui.modal('mPindah', {
      title: 'Pindah Saldo / Transfer Antar BKU', wide: true,
      body: `<form method="post" action="${c.base}/transaksi/pindah" id="fPindah">
        <div class="alert info">${ui.icon('info')}<div>Sistem otomatis mencatat <b>pengeluaran</b> pada BKU asal dan <b>pemasukan</b> pada BKU tujuan sebesar nominal yang sama, sehingga total dana sekolah tidak berubah.</div></div>
        <div class="row2">
          <div class="field"><label>Dari BKU (sumber dana)</label>
            <select name="dari_id" required><option value="">— Pilih BKU asal —</option>
            ${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)} — saldo ${rupiah(dbm.bkuSaldo(b.id))}</option>`).join('')}</select></div>
          <div class="field"><label>Ke BKU (tujuan)</label>
            <select name="ke_id" required><option value="">— Pilih BKU tujuan —</option>
            ${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label>Tanggal Pindah</label><input type="date" name="tanggal" value="${todayISO()}" required></div>
          <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', '', 'required placeholder="0"')}</div>
        </div>
        <div class="row2">
          <div class="field"><label>Metode</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer / Bank</option></select></div>
          <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Contoh: pindah dana UKK ke BKU Umum"></div>
        </div>
        <div class="hint">Transaksi dibuat berpasangan dengan kode rekening 9.1.04 (keluar) dan 9.1.05 (masuk).</div>
      </form>`,
      footer: `<button class="btn" data-close="mPindah">Batal</button><button class="btn btn-primary" form="fPindah">${ui.icon('refresh')}Pindahkan Saldo</button>`
    }) : ''}
    <script>
      window.__PAGU = ${JSON.stringify(paguMap)};
      window.__THRESHOLD = ${threshold};
    </script>`;

    page(req, res, { title: 'Transaksi Keuangan', sub: 'Pencatatan pemasukan & pengeluaran BKU', active: 'transaksi', content });
  });

  /* ---------- simpan ---------- */
  /* ---------- simpan (form modal maupun edit inline) ---------- */
  post('/transaksi/save', async (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, 'transaksi', isEdit ? 'edit' : 'create')) return;
    // kembali ke halaman asal (dipakai edit inline agar posisi scroll & filter tidak hilang)
    const backRaw = String(req.body.back || '');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/transaksi';
    const go = (msg, key) => res.redirect(req.BASE + flashUrl(backPath, key, msg));

    const { id, bku_id, tanggal, jenis, metode, coa_id, nominal, uraian, nama_pihak, after } = req.body;
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(bku_id);
    if (!b) return go('BKU tidak ditemukan.', 'err');
    if (b.status !== 'aktif') return go('BKU "' + b.nama + '" sudah ditutup dan terkunci.', 'err');
    const nom = lib.parseMoney(nominal);
    if (!(nom > 0)) return go('Nominal harus lebih dari 0.', 'err');
    if (!tanggal || !uraian) return go('Tanggal dan uraian wajib diisi.', 'err');
    const lockErr = dbm.periodeLockError(b.id, tanggal, isEdit ? 'edit' : null);
    if (lockErr) return go(lockErr, 'err');

    let notaUrl = null;
    if (req.body.nota_b64) {
      try {
        const m = String(req.body.nota_b64).match(/^data:([^;]+);base64,(.*)$/);
        const ext = m && m[1] === 'application/pdf' ? 'pdf' : (m && (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg')) || 'png';
        notaUrl = await uploadMedia(req.body.nota_b64, `nota-${b.kode || 'bku'}-${Date.now()}.${ext}`);
      } catch (e) {
        return go('Gagal mengunggah nota: ' + e.message, 'err');
      }
    }

    const threshold = Number(dbm.getSetting('approval_threshold', '5000000'));
    const perluApproval = jenis === 'pengeluaran' && nom > threshold;
    const taId = b.tahun_ajaran_id;
    const sisa = jenis === 'pengeluaran' && coa_id ? sisaPagu(Number(coa_id), taId) : null;

    let warn = '';
    if (sisa !== null && nom > sisa) {
      warn = `Peringatan: pengeluaran ${rupiah(nom)} melebihi sisa plafon anggaran ${rupiah(Math.max(0, sisa))}. Transaksi tetap disimpan, mohon tinjau kembali RAPBS.`;
    }

    let trxId = id;
    if (isEdit) {
      const old = db.prepare('SELECT * FROM transaksi WHERE id=?').get(id);
      if (!old) return go('Transaksi tidak ditemukan.', 'err');
      const oldBku = db.prepare('SELECT * FROM bku WHERE id=?').get(old.bku_id);
      if (oldBku && oldBku.status !== 'aktif') return go('Transaksi pada BKU tertutup tidak dapat diedit.', 'err');
      const oldLock = dbm.periodeLockError(old.bku_id, old.tanggal, 'edit');
      if (oldLock) return go(oldLock, 'err');
      if (old.is_penyesuaian) return go('Transaksi penyesuaian opnam kas tidak dapat diedit manual. Buka kembali BKU bulanan bila perlu koreksi.', 'err');
      const status = perluApproval ? 'pending' : 'posted';
      db.prepare(`UPDATE transaksi SET bku_id=?,tanggal=?,jenis=?,metode=?,coa_id=?,nominal=?,uraian=?,nama_pihak=?,nota_url=COALESCE(?,nota_url),status=?,approved_by=NULL,approved_at=NULL WHERE id=?`)
        .run(bku_id, tanggal, jenis, metode, coa_id || null, nom, uraian, nama_pihak || '', notaUrl, status, id);
      dbm.logAudit(req.user, 'EDIT', 'transaksi', `Edit transaksi ${old.no_bukti}: ${uraian} (${rupiah(nom)})`);
    } else {
      const ym = String(tanggal).slice(0, 7).replace('-', '');
      const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku_id).c + 1;
      const noBukti = `${b.kode || 'BKU'}/${jenis === 'pemasukan' ? 'M' : 'K'}/${ym}/${String(seq).padStart(3, '0')}`;
      const status = perluApproval ? 'pending' : 'posted';
      const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,nota_url,status,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(bku_id, tanggal, jenis, metode, noBukti, coa_id || null, nom, uraian, nama_pihak || '', notaUrl, status, req.user.id, nowStamp());
      trxId = info.lastInsertRowid;
      dbm.logAudit(req.user, 'TAMBAH', 'transaksi', `Input ${jenis} ${noBukti} pada ${b.nama}: ${uraian} (${rupiah(nom)})${perluApproval ? ' — menunggu approval' : ''}`);
      if (perluApproval) {
        return go(`Transaksi ${noBukti} tersimpan dan menunggu persetujuan Kepala Sekolah karena melebihi ${rupiah(threshold)}.`, 'ok');
      }
    }

    const q = [];
    if (warn) q.push('warn=' + encodeURIComponent(warn));
    if (after === 'cetak' && !isEdit) {
      if (req.body.back) return res.redirect(req.BASE + `/transaksi/${trxId}/kwitansi?auto=1`);
      return res.redirect(req.BASE + `/transaksi/${trxId}/kwitansi?auto=1`);
    }
    q.push('ok=' + encodeURIComponent(isEdit ? 'Perubahan transaksi tersimpan.' : 'Transaksi berhasil disimpan.'));
    if (!isEdit && !req.body.back) q.push('simpan=' + trxId);
    res.redirect(req.BASE + backPath + (backPath.includes('?') ? '&' : '?') + q.join('&'));
  });


  post('/transaksi/approve', (req, res) => {
    if (!guard(req, res, 'transaksi', 'approve')) return;
    const { id, aksi, catatan } = req.body;
    const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(id);
    if (!t) return res.redirect(req.BASE + '/transaksi?err=' + encodeURIComponent('Transaksi tidak ditemukan.'));
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(t.bku_id);
    if (b && b.status !== 'aktif') return res.redirect(req.BASE + '/transaksi?err=' + encodeURIComponent('BKU sudah ditutup, transaksi tidak dapat diproses.'));
    const apprLock = dbm.periodeLockError(t.bku_id, t.tanggal);
    if (apprLock) return res.redirect(req.BASE + '/transaksi?err=' + encodeURIComponent(apprLock));
    if (aksi === 'reject') {
      db.prepare("UPDATE transaksi SET status='rejected', approved_by=?, approved_at=?, catatan_approval=? WHERE id=?")
        .run(req.user.id, nowStamp(), catatan || '', id);
      dbm.logAudit(req.user, 'TOLAK', 'transaksi', `Menolak transaksi ${t.no_bukti} (${rupiah(t.nominal)})`);
      return res.redirect(req.BASE + '/transaksi?ok=' + encodeURIComponent('Transaksi ditolak.'));
    }
    db.prepare("UPDATE transaksi SET status='posted', approved_by=?, approved_at=?, catatan_approval=? WHERE id=?")
      .run(req.user.id, nowStamp(), catatan || '', id);
    dbm.logAudit(req.user, 'SETUJUI', 'transaksi', `Menyetujui transaksi ${t.no_bukti} (${rupiah(t.nominal)})`);
    res.redirect(req.BASE + '/transaksi?ok=' + encodeURIComponent('Transaksi disetujui dan masuk ke saldo BKU.'));
  });

  /* ---------- pindah saldo antar BKU ---------- */
  post('/transaksi/pindah', (req, res) => {
    if (!guard(req, res, 'transaksi', 'create')) return;
    const { dari_id, ke_id, tanggal, metode, keterangan } = req.body;
    const nominal = lib.parseMoney(req.body.nominal);
    const back = req.BASE + '/transaksi';
    if (!dari_id || !ke_id) return res.redirect(back + '?err=' + encodeURIComponent('BKU asal dan BKU tujuan wajib dipilih.'));
    if (String(dari_id) === String(ke_id)) return res.redirect(back + '?err=' + encodeURIComponent('BKU asal dan tujuan tidak boleh sama.'));
    if (!(nominal > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Nominal pindah saldo harus lebih dari 0.'));
    if (!tanggal) return res.redirect(back + '?err=' + encodeURIComponent('Tanggal pindah saldo wajib diisi.'));
    const dari = db.prepare('SELECT * FROM bku WHERE id=?').get(dari_id);
    const ke = db.prepare('SELECT * FROM bku WHERE id=?').get(ke_id);
    if (!dari || !ke) return res.redirect(back + '?err=' + encodeURIComponent('BKU tidak ditemukan.'));
    if (dari.status !== 'aktif' || ke.status !== 'aktif') return res.redirect(back + '?err=' + encodeURIComponent('Kedua BKU harus berstatus aktif untuk pindah saldo.'));
    const lockDari = dbm.periodeLockError(dari.id, tanggal);
    if (lockDari) return res.redirect(back + '?err=' + encodeURIComponent(lockDari));
    const lockKe = dbm.periodeLockError(ke.id, tanggal);
    if (lockKe) return res.redirect(back + '?err=' + encodeURIComponent(lockKe));

    const saldoAsal = dbm.bkuSaldo(dari.id);
    const group = 'TRF-' + Date.now().toString(36) + '-' + lib.token(3);
    const ym = String(tanggal).slice(0, 7).replace('-', '');
    const coaKeluar = db.prepare("SELECT * FROM coa WHERE kode='9.1.04'").get();
    const coaMasuk = db.prepare("SELECT * FROM coa WHERE kode='9.1.05'").get();
    const metodeV = metode === 'transfer' ? 'transfer' : 'tunai';
    const ket = String(keterangan || '').trim();
    const seqFor = b => db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(b.id).c + 1;

    const info = db.transaction(() => {
      const seqA = seqFor(dari), seqB = seqFor(ke);
      const ins = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,transfer_group,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'posted',?,?,?)`);
      ins.run(dari.id, tanggal, 'pengeluaran', metodeV, `${dari.kode || 'BKU'}/TRF/${ym}/${String(seqA).padStart(3, '0')}`,
        coaKeluar ? coaKeluar.id : null, nominal,
        `Pindah saldo ke ${ke.nama}${ket ? ' — ' + ket : ''}`, ke.nama, group, req.user.id, nowStamp());
      ins.run(ke.id, tanggal, 'pemasukan', metodeV, `${ke.kode || 'BKU'}/TRF/${ym}/${String(seqB).padStart(3, '0')}`,
        coaMasuk ? coaMasuk.id : null, nominal,
        `Pindah saldo dari ${dari.nama}${ket ? ' — ' + ket : ''}`, dari.nama, group, req.user.id, nowStamp());
      return group;
    })();

    dbm.logAudit(req.user, 'PINDAH SALDO', 'transaksi',
      `Pindah saldo ${rupiah(nominal)} dari ${dari.nama} ke ${ke.nama} (grup ${info})${ket ? ' — ' + ket : ''}`);
    const q = [];
    if (nominal > saldoAsal) q.push('warn=' + encodeURIComponent(`Perhatian: saldo BKU asal hanya ${rupiah(saldoAsal)}, sedangkan nominal pindah ${rupiah(nominal)}. Saldo BKU asal menjadi minus — mohon periksa kembali.`));
    q.push('ok=' + encodeURIComponent(`Pindah saldo ${rupiah(nominal)} dari ${dari.nama} ke ${ke.nama} berhasil dicatat.`));
    res.redirect(back + '?' + q.join('&'));
  });

  post('/transaksi/void', (req, res) => {
    guard(req, res, 'transaksi', 'edit');
    const backRaw = String(req.body.back || '/transaksi');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/transaksi';
    const go = (msg, key) => res.redirect(req.BASE + flashUrl(backPath, key, msg));
    const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(req.body.id);
    if (!t) return go('Transaksi tidak ditemukan.', 'err');
    if (t.status === 'void' || t.void_reversal_id) return go('Transaksi ini sudah di-void sebelumnya.', 'err');
    if (t.void_of) return go('Jurnal pembalik tidak dapat di-void.', 'err');
    if (t.is_penyesuaian) return go('Transaksi penyesuaian opnam tidak dapat di-void. Buka kembali BKU bulanan bila perlu koreksi.', 'err');
    const alasan = String(req.body.alasan || '').trim();
    if (!alasan) return go('Alasan pembatalan wajib diisi.', 'err');
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(t.bku_id);
    if (!b) return go('BKU tidak ditemukan.', 'err');
    if (b.status !== 'aktif') return go('BKU sudah ditutup — transaksi tidak dapat di-void.', 'err');
    const lockAsli = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
    if (lockAsli) return go(lockAsli, 'err');
    // jurnal pembalik bertanggal hari ini (atau tanggal transaksi bila tanggal transaksi di masa depan)
    const tglBalik = todayISO() >= String(t.tanggal).slice(0, 10) ? todayISO() : String(t.tanggal).slice(0, 10);
    const lockBalik = dbm.periodeLockError(t.bku_id, tglBalik);
    if (lockBalik) return go('Periode jurnal pembalik (' + tglBalik + ') terkunci: ' + lockBalik, 'err');

    const ym = tglBalik.slice(0, 7).replace('-', '');
    const coa = t.coa_id ? db.prepare('SELECT * FROM coa WHERE id=?').get(t.coa_id) : null;
    let reversalId = null;
    db.transaction(() => {
      const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(t.bku_id).c + 1;
      const noBukti = `${b.kode || 'BKU'}/VOID/${ym}/${String(seq).padStart(3, '0')}`;
      const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,void_of,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'posted',?,?,?)`).run(
        t.bku_id, tglBalik, t.jenis === 'pemasukan' ? 'pengeluaran' : 'pemasukan', t.metode, noBukti,
        coa ? coa.id : null, t.nominal, `Jurnal Pembalik (Void) — ${t.no_bukti || '#' + t.id}`,
        t.nama_pihak || '', t.id, req.user.id, nowStamp());
      reversalId = Number(info.lastInsertRowid);
      db.prepare("UPDATE transaksi SET status='void', void_at=?, void_by=?, void_alasan=?, void_reversal_id=? WHERE id=?")
        .run(nowStamp(), req.user.nama, alasan, reversalId, t.id);
      // tagihan iuran siswa kembali belum dibayar
      try {
        db.prepare("UPDATE iuran_bayar SET status='void', transaksi_id=NULL WHERE transaksi_id=?").run(t.id);
      } catch (e) { }
      // cicilan piutang yang berasal dari transaksi ini dikembalikan
      try {
        const pbs = db.prepare('SELECT * FROM piutang_bayar WHERE transaksi_id=?').all(t.id);
        for (const pb of pbs) {
          db.prepare('DELETE FROM piutang_bayar WHERE id=?').run(pb.id);
          const sisa = dbm.piutangSisa(pb.piutang_id);
          db.prepare("UPDATE piutang SET status=? WHERE id=?").run(sisa <= 0 ? 'lunas' : 'belum', pb.piutang_id);
        }
      } catch (e) { }
      // void transaksi payroll → leger honor periode tsb terbuka kembali
      try { dbm.payrollUnlockByTrx(t.id); } catch (e) { }
    })();
    dbm.logAudit(req.user, 'VOID', 'transaksi', `Void ${t.no_bukti} (${rupiah(t.nominal)}) — alasan: ${alasan}. Jurnal pembalik #${reversalId}`);
    go(`Transaksi ${t.no_bukti} di-void. Jurnal pembalik dibuat dan saldo BKU dinetralkan.`, 'ok');
  });

  post('/transaksi/delete', (req, res) => {
    if (!guard(req, res, 'transaksi', 'delete')) return;
    const backRaw = String(req.body.back || '');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/transaksi';
    const go = (msg, key) => res.redirect(req.BASE + flashUrl(backPath, key, msg));
    const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(req.body.id);
    if (!t) return go('Transaksi tidak ditemukan.', 'err');
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(t.bku_id);
    if (b && b.status !== 'aktif') return go('BKU sudah ditutup — transaksi tidak dapat dihapus.', 'err');
    const delLock = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
    if (delLock) return go(delLock, 'err');
    if (t.is_penyesuaian) return go('Transaksi penyesuaian opnam kas tidak dapat dihapus. Buka kembali BKU bulanan bila perlu koreksi.', 'err');
    dbm.trashAdd('transaksi', t, { user: req.user, alasan: String(req.body.alasan || ''), label: `${t.no_bukti} — ${t.uraian}` });
    db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
    // leger honor yang terkunci karena transaksi ini otomatis terbuka kembali (draf bisa diedit)
    let unlocked = [];
    try { unlocked = dbm.payrollUnlockByTrx(t.id) || []; } catch (e) { unlocked = []; }
    dbm.logAudit(req.user, 'HAPUS', 'transaksi', `Menghapus transaksi ${t.no_bukti} (${rupiah(t.nominal)}) — dipindahkan ke Kotak Sampah` +
      (unlocked.length ? ` · draf payroll ${unlocked.join(', ')} terbuka kembali` : ''));
    go('Transaksi dipindahkan ke Kotak Sampah (dapat dipulihkan 30 hari).' +
      (unlocked.length ? ` Leger honor periode ${unlocked.join(', ')} kembali berstatus DRAF dan bisa diedit.` : ''), 'ok');
  });

  /* ---------- hapus masal transaksi (dipindahkan ke Kotak Sampah) ---------- */
  post('/transaksi/hapus-masal', (req, res) => {
    if (!guard(req, res, 'transaksi', 'delete')) return;
    const backRaw = String(req.body.back || '');
    const backPath = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/transaksi';
    const go = (msg, key) => res.redirect(req.BASE + flashUrl(backPath, key, msg));
    const ids = [].concat(req.body.id || []).flatMap(v => String(v).split(',')).map(Number).filter(Boolean);
    if (!ids.length) return go('Tidak ada transaksi yang dipilih.', 'err');
    const rows = db.prepare(`SELECT * FROM transaksi WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    let hapus = 0;
    const ditolak = [];
    for (const t of rows) {
      const b = db.prepare('SELECT * FROM bku WHERE id=?').get(t.bku_id);
      if (b && b.status !== 'aktif') { ditolak.push(`${t.no_bukti}: BKU ditutup`); continue; }
      const lock = dbm.periodeLockError(t.bku_id, t.tanggal, 'edit');
      if (lock) { ditolak.push(`${t.no_bukti}: ${lock}`); continue; }
      if (t.is_penyesuaian) { ditolak.push(`${t.no_bukti}: transaksi opnam`); continue; }
      dbm.trashAdd('transaksi', t, { user: req.user, label: `${t.no_bukti} — ${t.uraian}` });
      db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
      try { dbm.payrollUnlockByTrx(t.id); } catch (e) { }
      hapus++;
    }
    dbm.logAudit(req.user, 'HAPUS MASAL', 'transaksi',
      `Hapus masal ${hapus} transaksi — dipindahkan ke Kotak Sampah` + (ditolak.length ? ` · ditolak: ${ditolak.join('; ')}` : ''));
    if (!hapus) return go('Tidak ada transaksi yang dapat dihapus: ' + ditolak.join('; '), 'err');
    go(`${hapus} transaksi dipindahkan ke Kotak Sampah (dapat dipulihkan 30 hari).` +
      (ditolak.length ? ` ${ditolak.length} transaksi dilewati: ${ditolak.join('; ')}` : ''), 'ok');
  });

  /* ---------- lihat nota ---------- */
  get('/nota/:id', (req, res) => {
    if (!guard(req, res, 'transaksi', 'view')) return;
    const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(req.params.id);
    if (!t || !t.nota_url) return res.redirect(req.BASE + '/transaksi?err=' + encodeURIComponent('Nota tidak ditemukan.'));
    res.redirect(t.nota_url);
  });

  /* ---------- kwitansi ---------- */
  get('/transaksi/:id/kwitansi', (req, res) => {
    if (!guard(req, res, 'transaksi', 'view')) return;
    const c = ctx(req);
    const t = db.prepare(`SELECT t.*, b.nama bku_nama, b.kode bku_kode, co.kode coa_kode, co.nama coa_nama
      FROM transaksi t JOIN bku b ON b.id=t.bku_id LEFT JOIN coa co ON co.id=t.coa_id WHERE t.id=?`).get(req.params.id);
    if (!t) return res.notFound();
    const isIn = t.jenis === 'pemasukan';
    const L = printcfg.labels(dbm, 'kwitansi_trx');
    const orient = printcfg.orient(req, dbm, 'kwitansi_trx');
    // baris "Tempat, tanggal transaksi" — teks tempat diatur di Desain Templat Cetak
    const kota = printcfg.tempatTanggal(dbm, tglID(t.tanggal));
    /* pengeluaran: "Telah diterima dari" → "Bendahara <nama sekolah>"
       (isi baris dapat diubah di Desain Templat Cetak, placeholder {sekolah}) */
    const dariKeluar = printcfg.fill(L.nilai_dari_keluar || 'Bendahara {sekolah}', {
      sekolah: c.settings.sekolah_nama || 'Sekolah'
    });
    /* TTD tiga kolom dibuat SEJAJAR: header 2 baris dengan tinggi tetap,
       ruang tanda tangan tetap, lalu nama + NIP pada baris yang sama. */
    const sigCol = (head1, head2, nama, nip) => `<div class="sig">
        <div class="sig-head"><div>${esc(head1 || '\u00a0')}</div><div>${esc(head2 || '\u00a0')}</div></div>
        <div class="space"></div>
        <div class="nm">${esc(nama || '\u00a0')}</div>
        <div>${nip ? 'NIP. ' + esc(nip) : '\u00a0'}</div>
      </div>`;
    const body = `
      ${ui.kwitansiKop(c.settings)}
      <div class="kwit-box">
        <div class="head"><span>${esc(isIn ? L.judul_masuk : L.judul_keluar)}</span><span>No. ${esc(t.no_bukti || '-')}</span></div>
        <div class="kwit-body">
          <div class="k">${esc(isIn ? L.dari_masuk : L.dari_keluar)}</div>
          <div class="v">${esc(isIn ? (t.nama_pihak || '.....................................') : dariKeluar)}</div>
          <div class="k">${esc(L.sejumlah)}</div>
          <div class="v" style="font-style:italic">${esc(terbilangRupiah(t.nominal))}</div>
          <div class="k">${esc(L.untuk)}</div>
          <div class="v">${esc(t.uraian)}</div>
          <div class="k">${esc(L.rekening)}</div>
          <div class="v">${esc((t.coa_kode || '-') + ' · ' + (t.coa_nama || '-'))}</div>
          <div class="k">${esc(L.buku)}</div>
          <div class="v">${esc(t.bku_nama)}</div>
          <div class="k">${esc(L.metode)}</div>
          <div class="v">${t.metode === 'tunai' ? 'Tunai' : 'Transfer Bank'}</div>
          <div class="k">${esc(L.tanggal)}</div>
          <div class="v">${tglID(t.tanggal)}</div>
          <div class="k">${esc(L.jumlah)}</div>
          <div class="v kwit-amt">${rupiah(t.nominal)}</div>
        </div>
      </div>
      <div class="sign-grid sign-3 kwit-sign">
        ${sigCol(L.ttd_kepala, `Kepala ${c.settings.sekolah_nama || 'Sekolah'}`,
      c.settings.sekolah_kepala || '............................', c.settings.sekolah_nip_kepala || '')}
        ${sigCol('\u00a0', L.ttd_bendahara,
        c.settings.sekolah_bendahara || '............................', c.settings.sekolah_nip_bendahara || '')}
        ${sigCol(kota, isIn ? L.ttd_penyetor : L.ttd_penerima,
          t.nama_pihak || '............................', '')}
      </div>
      <p class="kwit-foot">${esc(String(L.footer || '').replace('{jenis}', isIn ? 'penerimaan' : 'pengeluaran'))} ${t.status === 'pending' ? 'Status: MENUNGGU PERSETUJUAN KEPALA SEKOLAH.' : ''}</p>`;
    res.html(ui.kwitansiPage({
      settings: c.settings, base: c.base,
      title: `Kwitansi ${isIn ? 'Penerimaan' : 'Pengeluaran'}`,
      body, backHref: '/transaksi', backLabel: 'Kembali ke Transaksi',
      orient, selfPath: req.url
    }).replace('</body>', `${req.query.get('auto') ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),350));</script>' : ''}</body>`));
  });

  /* ---------- pengaturan ukuran kertas kwitansi transaksi ---------- */
  get('/transaksi/kertas', (req, res) => {
    guard(req, res, 'transaksi', 'view');
    const c = ctx(req);
    const k = ui.kwitansiSize(c.settings);
    const ro = !c.can('transaksi', 'edit');
    const f = (lbl, name, val, hint = '') => `<div class="field"><label>${esc(lbl)}</label>
      <input type="number" step="0.5" min="0" name="${name}" value="${esc(val)}" ${ro ? 'readonly' : ''} required>
      ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Pengaturan Ukuran Kertas Kwitansi Transaksi</h3>
          <div class="sub">Berlaku untuk kwitansi pemasukan, pengeluaran, serta bukti piutang (pencairan &amp; pelunasan)</div></div>
          ${ro ? ui.badge('Hanya Lihat', 'gray') : ''}</div>
        <form method="post" action="${c.base}/transaksi/kertas">
          <div class="alert info">${ui.icon('info')}<div>Default <b>21 cm × 9,9 cm</b> (210 × 99 mm) = format <b>1/3 F4 / envelope landscape</b>. Isi ukuran dalam milimeter (1 cm = 10 mm).</div></div>
          <div class="row2">${f('Panjang Kertas (mm)', 'kw_trx_w_mm', k.w)}${f('Tinggi / Lebar Kertas (mm)', 'kw_trx_h_mm', k.h)}</div>
          <div class="t-strong mb-1 mt-2">Margin Cetak</div>
          <div class="row2">${f('Margin Atas (mm)', 'kw_trx_mt_mm', k.mt)}${f('Margin Bawah (mm)', 'kw_trx_mb_mm', k.mb)}</div>
          <div class="row2">${f('Margin Kiri (mm)', 'kw_trx_ml_mm', k.ml)}${f('Margin Kanan (mm)', 'kw_trx_mr_mm', k.mr)}</div>
          <div class="form-actions">${ro ? '' : `<button class="btn btn-primary">${ui.icon('save')}Simpan Ukuran Kertas</button>`}</div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Pratinjau Ukuran</h3><div class="sub">Proporsi kertas & area cetak (tanpa skala)</div></div></div>
        <div style="display:grid;place-items:center;padding:10px 0">
          <div style="width:${Math.min(100, (k.w / 210) * 100)}%;max-width:340px;aspect-ratio:${k.w}/${k.h};border:2px solid var(--o-500);border-radius:6px;background:#FFF8F2;position:relative">
            <div style="position:absolute;left:${(k.ml / k.w) * 100}%;right:${(k.mr / k.w) * 100}%;top:${(k.mt / k.h) * 100}%;bottom:${(k.mb / k.h) * 100}%;border:1px dashed #B45309"></div>
          </div>
        </div>
        <div class="kv">
          <dt>Panjang × Tinggi</dt><dd>${k.w} × ${k.h} mm</dd>
          <dt>Area cetak</dt><dd>${Math.max(0, k.w - k.ml - k.mr)} × ${Math.max(0, k.h - k.mt - k.mb)} mm</dd>
          <dt>Margin</dt><dd>A ${k.mt} · B ${k.mb} · K ${k.ml} · Kn ${k.mr} mm</dd>
        </div>
        <p class="help mt-2">Pada dialog cetak browser pilih ukuran kertas yang sama (atau <b>Custom</b>) dan skala <b>100%</b> agar hasil presisi.</p>
      </div>
    </div>`;
    page(req, res, { title: 'Ukuran Kertas Kwitansi Transaksi', sub: 'Atur dimensi kertas & margin cetak kwitansi', active: 'transaksi', content });
  });

  post('/transaksi/kertas', (req, res) => {
    guard(req, res, 'transaksi', 'edit');
    const back = req.BASE + '/transaksi/kertas';
    const val = (k, min, max, def) => {
      const v = Number(String(req.body[k] || '').replace(',', '.'));
      return Number.isFinite(v) && v >= min && v <= max ? v : def;
    };
    const w = val('kw_trx_w_mm', 60, 500, 210), h = val('kw_trx_h_mm', 30, 500, 99);
    const mt = val('kw_trx_mt_mm', 0, 40, 6), mb = val('kw_trx_mb_mm', 0, 40, 6);
    const ml = val('kw_trx_ml_mm', 0, 40, 8), mr = val('kw_trx_mr_mm', 0, 40, 8);
    if (ml + mr >= w || mt + mb >= h) return res.redirect(back + '?err=' + encodeURIComponent('Margin terlalu besar dibanding ukuran kertas.'));
    dbm.setSetting('kw_trx_w_mm', w); dbm.setSetting('kw_trx_h_mm', h);
    dbm.setSetting('kw_trx_mt_mm', mt); dbm.setSetting('kw_trx_mb_mm', mb);
    dbm.setSetting('kw_trx_ml_mm', ml); dbm.setSetting('kw_trx_mr_mm', mr);
    dbm.logAudit(req.user, 'EDIT', 'transaksi', `Ukuran kertas kwitansi transaksi: ${w}×${h} mm, margin ${mt}/${mb}/${ml}/${mr} mm`);
    res.redirect(back + '?ok=' + encodeURIComponent('Ukuran kertas kwitansi transaksi disimpan.'));
  });
};
