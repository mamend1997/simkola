'use strict';
const printcfg = require('../printcfg');
/* ============ PIUTANG LAINNYA (kategori fleksibel) ============
   Alur & antarmuka sama dengan Piutang Umum / Piutang Sertifikasi:
   - master kategori (CRUD penuh oleh admin)
   - tagihan (CRUD) + pembayaran/cicilan + rekap + import/export
   - sakelar "Tampilkan di Akun Aset Riil" per kategori & per modul
*/
const X = require('../xlsx-read');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, terbilangRupiah } = lib;
  const MODUL = 'piutang_lainnya';
  const back = req => req.BASE + '/piutang-lainnya';

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }
  function bkuAktif(taId) {
    if (taId) return db.prepare("SELECT * FROM bku WHERE status='aktif' AND COALESCE(auto_mode,0)=0 AND tahun_ajaran_id=? ORDER BY jenis DESC, urutan").all(taId);
    return db.prepare("SELECT * FROM bku WHERE status='aktif' AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan").all();
  }
  function bayarMap() {
    const map = {};
    for (const b of db.prepare('SELECT * FROM piutang_lainnya_bayar ORDER BY tanggal, id').all()) {
      (map[b.piutang_id] = map[b.piutang_id] || []).push(b);
    }
    return map;
  }
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
  const up = c => X.cellText(c).toUpperCase().trim();
  /** sinkronkan kolom status dengan total cicilan */
  function refresh(pid) {
    const p = db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(pid);
    if (!p) return null;
    const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lainnya_bayar WHERE piutang_id=?').get(pid).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - dibayar);
    const last = db.prepare('SELECT tanggal FROM piutang_lainnya_bayar WHERE piutang_id=? ORDER BY tanggal DESC, id DESC LIMIT 1').get(pid);
    db.prepare('UPDATE piutang_lainnya SET status=?, tanggal_bayar=? WHERE id=?')
      .run(sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (last ? last.tanggal : todayISO()) : null, pid);
    return { dibayar, sisa };
  }
  /** buat transaksi pemasukan BKU untuk satu pembayaran piutang */
  function trxMasuk({ bku, tanggal, nominal, metode, uraian, nama, user }) {
    const coa = db.prepare("SELECT * FROM coa WHERE kode='4.1.03'").get() || db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' LIMIT 1").get();
    const ym = String(tanggal).slice(0, 7).replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku.id).c + 1;
    const noBukti = `${bku.kode || 'BKU'}/M/${ym}/${String(seq).padStart(3, '0')}`;
    const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
      VALUES (?,?,'pemasukan',?,?,?,?,?,?,'posted',?,?)`).run(bku.id, tanggal, metode === 'transfer' ? 'transfer' : 'tunai',
      noBukti, coa ? coa.id : null, nominal, uraian, nama, user.id, nowStamp());
    return { id: Number(info.lastInsertRowid), noBukti };
  }

  /* ================= halaman utama ================= */
  get('/piutang-lainnya', (req, res) => {
    guard(req, res, MODUL, 'view');
    const c = ctx(req);
    try { dbm.piutangLainnyaSyncStatus(); } catch (e) { }
    const taId = c.taId;
    const kategoriList = dbm.piutangKategoriList();
    const katFilter = req.query.get('kategori') || '';
    const q = req.query.get('q') || '';
    const rows = dbm.piutangLainnyaRows(taId, { kategoriId: katFilter ? Number(katFilter) : null, q });
    const bayar = bayarMap();
    const bukuss = bkuAktif(taId);
    const tampilAset = dbm.piutangLainnyaTampil();
    const late = modalCollector();
    const editable = c.can(MODUL, 'edit');

    const totalNominal = rows.reduce((s, r) => s + Number(r.nominal || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + Number(r.dibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + Number(r.sisa || 0), 0);
    const belum = rows.filter(r => r.sisa > 0).length;
    const sisaAset = dbm.piutangLainnyaAset(taId);
    const katById = {};
    for (const k of kategoriList) katById[k.id] = k;

    const editR = req.query.get('edit') ? db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(req.query.get('edit')) : null;
    const katOptions = sel => kategoriList.filter(k => Number(k.aktif) !== 0 || String(sel || '') === String(k.id))
      .map(k => `<option value="${k.id}" ${String(sel) === String(k.id) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('');

    const formTagihan = p => `<form method="post" action="${c.base}/piutang-lainnya/save" id="fPln">
      <input type="hidden" name="id" value="${p ? p.id : ''}">
      <div class="row2">
        <div class="field"><label>Kategori Piutang <span style="color:var(--red)">*</span></label>
          <select name="kategori_id" required><option value="">— Pilih kategori —</option>${katOptions(p ? p.kategori_id : katFilter)}</select>
          <div class="hint">Kategori dibuat &amp; diubah pada tabel <b>Kategori Piutang Lainnya</b> di atas.</div></div>
        <div class="field"><label>Nama Pihak / Penerima</label>
          <input name="nama" list="pegawaiListPln" value="${esc(p ? p.nama : '')}" required placeholder="Pilih dari master pegawai atau ketik manual"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Tanggal Utang / Tagihan</label><input type="date" name="tanggal" value="${esc(p ? p.tanggal : todayISO())}" required></div>
        <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', p ? p.nominal : '', 'required placeholder="0"')}</div>
      </div>
      <div class="row2">
        <div class="field"><label>BKU Penerima (opsional)</label>
          <select name="bku_id"><option value="">— Pilih —</option>${dbm.allBku(taId).map(b => `<option value="${b.id}" ${p && String(p.bku_id) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(p ? p.keterangan : '')}" placeholder="Contoh: piutang dana talangan kegiatan"></div>
      </div>
      <div class="hint">Pembayaran dicatat lewat tombol <b>Bayar</b> pada tabel — otomatis menambah kas pada BKU yang dipilih (opsional).</div>
    </form>`;

    const formKategori = (k, fid) => `<form method="post" action="${c.base}/piutang-lainnya/kategori/save" id="${fid}">
      <input type="hidden" name="id" value="${k ? k.id : ''}">
      <div class="field"><label>Nama Kategori</label><input name="nama" value="${esc(k ? k.nama : '')}" required placeholder="Contoh: Dana Talangan, Piutang Kegiatan, Piutang Koperasi"></div>
      <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(k ? k.keterangan : '')}" placeholder="Opsional"></div>
      <div class="toggle-form" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px">
        <div>
          <div class="t-strong">Tampilkan di Akun Aset Riil</div>
          <div class="t-sub">Bila aktif, sisa piutang kategori ini ikut dihitung pada Total Aset Riil sekolah.</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" name="tampil_aset" value="1" ${!k || Number(k.tampil_aset) !== 0 ? 'checked' : ''}><i></i></label>
      </div>
      <label class="check mt-2"><input type="checkbox" name="aktif" value="1" ${!k || Number(k.aktif) !== 0 ? 'checked' : ''}> Kategori aktif</label>
    </form>`;

    // rekapitulasi per nama (sama seperti modul piutang pegawai & sertifikasi)
    const rekap = dbm.piutangLainnyaRekap(taId, { kategoriId: katFilter ? Number(katFilter) : null, q });
    const modalsRekap = modalCollector();

    const content = `
    <datalist id="pegawaiListPln">${dbm.pegawaiList(true).map(x => `<option value="${esc(x.nama)}">${esc(x.jabatan || '')}</option>`).join('')}</datalist>
    <div class="kpi-grid mb-3">
      <div class="kpi ic-blue"><div class="ico">${ui.icon('layers')}</div><div class="lbl">Total Piutang Lainnya</div><div class="val" style="font-size:19px">${rupiah(totalNominal)}</div><div class="meta">${rows.length} baris · ${kategoriList.length} kategori</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Sudah Dicicil</div><div class="val" style="font-size:19px">${rupiah(totalDibayar)}</div><div class="meta">Akumulasi pembayaran</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Sisa Piutang Lainnya</div><div class="val" style="font-size:19px">${rupiah(totalSisa)}</div><div class="meta">${belum} tagihan belum lunas</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('bank')}</div><div class="lbl">Masuk Aset Riil</div><div class="val" style="font-size:19px">${rupiah(sisaAset)}</div><div class="meta">${tampilAset ? 'Aktif dihitung sebagai aset' : 'Modul disembunyikan dari aset'}</div></div>
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Kategori Piutang Lainnya</h3>
        <div class="sub">Tambah, ubah &amp; hapus kategori piutang secara fleksibel · sakelar aset riil per kategori</div></div>
        <div class="toolbar"><input placeholder="Cari kategori…" data-table-search="#tblKatPln" style="width:170px">
          ${c.can(MODUL, 'create') ? ui.openModalBtn('mAddKatPln', 'Tambah Kategori', 'btn btn-sm btn-primary') : ''}</div></div>
      ${kategoriList.length ? `<div class="table-wrap"><table id="tblKatPln"><thead><tr>
        <th>Kategori</th><th>Keterangan</th><th class="num">Tagihan</th><th class="num">Sisa</th><th>Status</th>
        <th>Tampilkan di Akun Aset Riil</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${kategoriList.map(k => `<tr>
        <td class="t-strong">${esc(k.nama)}</td>
        <td class="t-sub">${esc(k.keterangan || '-')}</td>
        <td class="num">${k.jumlah}</td>
        <td class="num t-strong" style="color:${k.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(k.sisa)}</td>
        <td>${Number(k.aktif) !== 0 ? ui.badge('Aktif', 'green') : ui.badge('Non-Aktif', 'gray')}</td>
        <td><form method="post" action="${c.base}/piutang-lainnya/kategori/toggle" class="toggle-form" style="border:0;padding:0;gap:8px">
          <input type="hidden" name="id" value="${k.id}">
          <span class="t-sub">${Number(k.tampil_aset) !== 0 ? 'Ya' : 'Tidak'}</span>
          <label class="toggle-switch"><input type="checkbox" name="tampil_aset" value="1" ${Number(k.tampil_aset) !== 0 ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="this.form.submit()"><i></i></label>
        </form></td>
        <td class="right nowrap">
          ${c.can(MODUL, 'edit') ? `<button class="btn btn-sm btn-icon" data-open="mEdKat${k.id}" title="Edit kategori">${ui.icon('edit')}</button>` : ''}
          ${c.can(MODUL, 'delete') ? `<form method="post" action="${c.base}/piutang-lainnya/kategori/delete" style="display:inline"
            data-confirm="Hapus kategori ${esc(k.nama)}? Kategori yang masih memiliki tagihan tidak dapat dihapus.">
            <input type="hidden" name="id" value="${k.id}"><button class="btn btn-sm btn-danger" title="Hapus kategori">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>
        ${late('mEdKat' + k.id, {
      title: 'Edit Kategori Piutang Lainnya', body: formKategori(k, 'fmEdKat' + k.id),
      footer: `<button class="btn" data-close="mEdKat${k.id}">Batal</button><button class="btn btn-primary" form="fmEdKat${k.id}">${ui.icon('save')}Simpan</button>`
    })}`).join('')}
      </tbody><tfoot><tr><td colspan="2">TOTAL</td>
        <td class="num">${kategoriList.reduce((a, k) => a + k.jumlah, 0)}</td>
        <td class="num">${rupiah(kategoriList.reduce((a, k) => a + k.sisa, 0))}</td><td colspan="3"></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada kategori', 'Tambahkan kategori piutang lainnya terlebih dahulu sebelum mencatat tagihan.')}
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Rekapitulasi Piutang Lainnya per Nama</h3>
        <div class="sub">Total piutang, sudah dibayar &amp; sisa per nama · beberapa tagihan dapat digabung dalam satu pembayaran</div></div>
        <div class="toolbar"><input placeholder="Cari nama…" data-table-search="#tblRekapPln" style="width:190px"></div></div>
      ${rekap.length ? `<div class="table-scroll short"><table id="tblRekapPln"><thead><tr>
        <th>Nama</th><th class="num">Jumlah Tagihan</th><th class="num">Total Piutang</th><th class="num">Sudah Dibayar</th><th class="num">Sisa Piutang</th><th class="num">Belum Lunas</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rekap.map((g2, gi) => `<tr>
        <td class="t-strong">${esc(g2.nama)}</td>
        <td class="num">${g2.jumlah}</td>
        <td class="num">${rupiah(g2.nominal)}</td>
        <td class="num" style="color:var(--green)">${rupiah(g2.dibayar)}</td>
        <td class="num t-strong" style="color:${g2.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(g2.sisa)}</td>
        <td class="num">${g2.aktif}</td>
        <td class="right nowrap">
          ${g2.aktif > 0 && editable ? `<button class="btn btn-sm btn-green" data-open="mPlnGab${gi}">${ui.icon('coins')}Bayar Gabungan</button>` : ''}
        </td></tr>
        ${g2.aktif > 0 ? modalsRekap('mPlnGab' + gi, {
      title: 'Pembayaran Gabungan — ' + g2.nama,
      body: `<form method="post" action="${c.base}/piutang-lainnya/bayar-gabungan" id="fplng${gi}">
        <input type="hidden" name="nama" value="${esc(g2.nama)}">
        <input type="hidden" name="kategori_id" value="${esc(katFilter)}">
        <div class="alert info">${ui.icon('info')}<div>Pembayaran dialokasikan otomatis ke tagihan <b>tertua</b> lebih dulu (FIFO). Total sisa piutang ini <b>${rupiah(g2.sisa)}</b> dari ${g2.aktif} tagihan.</div></div>
        <div class="row2">
          <div class="field"><label>Nominal Bayar (Rp)</label>${ui.moneyInput('nominal', g2.sisa, 'required')}
            <div class="hint">Terbilang: <b>${esc(terbilangRupiah(g2.sisa))}</b></div></div>
          <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal_bayar" value="${todayISO()}" required></div>
        </div>
        <div class="row2">
          <div class="field"><label>Metode</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></div>
          <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Pembayaran gabungan"></div>
        </div>
        <div class="form-actions" style="border:0;padding-left:0">
          <label class="check"><input type="checkbox" name="masuk_bku" value="1" data-pl-bku ${bukuss.length ? '' : 'disabled'}> Masuk ke BKU (menambah kas)</label>
          <div data-pl-bku-wrap style="display:none;width:100%">
            <div class="field"><label>BKU Penerima</label><select name="bku_id">${bukuss.map(b => `<option value="${b.id}">${esc(b.nama)}</option>`).join('')}</select></div>
          </div>
        </div>
        <div class="table-wrap mt-1"><table><thead><tr><th>Tanggal</th><th>Kategori</th><th class="num">Nominal</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th></tr></thead><tbody>
        ${g2.items.map(x => `<tr><td class="nowrap">${tglID(x.tanggal)}</td><td>${esc(x.kategori_nama || '-')}</td><td class="num">${rupiah(x.nominal)}</td>
          <td class="num">${rupiah(x.dibayar)}</td><td class="num t-strong">${rupiah(x.sisa)}</td></tr>`).join('')}
        </tbody></table></div>
      </form>`,
      footer: `<button class="btn" data-close="mPlnGab${gi}">Batal</button><button class="btn btn-green" form="fplng${gi}">${ui.icon('check')}Catat Pembayaran Gabungan</button>`
    }) : ''}`).join('')}
      </tbody><tfoot><tr><td>TOTAL</td><td class="num">${rekap.reduce((a, x) => a + x.jumlah, 0)}</td>
        <td class="num">${rupiah(rekap.reduce((a, x) => a + x.nominal, 0))}</td><td class="num">${rupiah(rekap.reduce((a, x) => a + x.dibayar, 0))}</td>
        <td class="num">${rupiah(rekap.reduce((a, x) => a + x.sisa, 0))}</td><td class="num">${rekap.reduce((a, x) => a + x.aktif, 0)}</td><td></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada rekap', 'Tagihan yang dicatat akan direkap otomatis per nama di sini.')}
      ${modalsRekap.html()}
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Daftar Piutang Lainnya</h3><div class="sub">Pencatatan, pelunasan/cicilan &amp; rekapitulasi tagihan non-SPP/non-sertifikasi</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/piutang-lainnya" class="flex flex-wrap" style="gap:6px">
            <select name="kategori" data-autosubmit><option value="">Semua Kategori</option>${kategoriList.map(k => `<option value="${k.id}" ${String(katFilter) === String(k.id) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select>
            <input name="q" value="${esc(q)}" placeholder="Cari nama / keterangan" style="width:170px">
            <button class="btn btn-sm">${ui.icon('search')}Filter</button>
          </form>
          <a class="btn btn-sm" href="${c.base}/piutang-lainnya/export?kategori=${esc(katFilter)}&q=${encodeURIComponent(q)}">${ui.icon('download')}Export Excel</a>
          <a class="btn btn-sm" target="_blank" href="${c.base}/piutang-lainnya/cetak?kategori=${esc(katFilter)}">${ui.icon('printer')}Cetak</a>
          <a class="btn btn-sm" href="${c.base}/piutang-lainnya/template">${ui.icon('download')}Template</a>
          ${c.can(MODUL, 'create') ? `<button class="btn btn-sm" data-open="mImportPln">${ui.icon('upload')}Import Excel</button>` : ''}
          ${c.can(MODUL, 'create') ? ui.openModalBtn('mAddPln', 'Tambah Tagihan', 'btn btn-sm btn-primary') : ''}
        </div></div>
      ${rows.length ? `<div class="table-scroll tall"><table id="tblPiutangLainnya"><thead><tr>
        <th>Kategori</th><th>Nama</th><th>Tanggal</th><th class="num">Nominal</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th><th>Keterangan</th><th class="right">Aksi</th>
      </tr></thead><tbody>
        ${rows.map(p => `<tr>
          <td>${ui.badge(p.kategori_nama || '-', 'blue', 'plain')}</td>
          <td class="t-strong">${esc(p.nama)}</td>
          <td class="nowrap">${tglID(p.tanggal)}</td>
          <td class="num t-strong">${rupiah(p.nominal)}</td>
          <td class="num" style="color:var(--green)">${p.dibayar ? rupiah(p.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${p.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(p.sisa)}</td>
          <td>${p.status === 'lunas' ? ui.badge('Lunas', 'green') : p.dibayar > 0 ? ui.badge('Cicilan Berjalan', 'amber') : ui.badge('Belum Lunas', 'red')}</td>
          <td class="t-sub">${esc(p.keterangan || '-')}</td>
          <td class="right nowrap">
            ${p.sisa > 0 && editable ? `<button class="btn btn-sm btn-green" data-open="mPlnBayar${p.id}">${ui.icon('plus')}Bayar</button>` : ''}
            <button class="btn btn-sm" data-open="mPlnRiwayat${p.id}" title="Riwayat pembayaran">${ui.icon('clock')}</button>
            <a class="btn btn-sm" target="_blank" href="${c.base}/piutang-lainnya/${p.id}/bukti" title="Cetak bukti pencairan/penambahan piutang">${ui.icon('printer')}Bukti</a>
            ${editable ? `<a class="btn btn-sm btn-icon" href="${c.base}/piutang-lainnya?edit=${p.id}" title="Edit">${ui.icon('edit')}</a>` : ''}
            ${c.can(MODUL, 'delete') ? `<form method="post" action="${c.base}/piutang-lainnya/delete" style="display:inline" data-confirm="Hapus piutang ${esc(p.nama)} beserta riwayat pembayarannya?"><input type="hidden" name="id" value="${p.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${p.sisa > 0 ? late('mPlnBayar' + p.id, {
          title: 'Bayar Piutang Lainnya — ' + (p.kategori_nama || ''),
          body: `<div class="alert info">${ui.icon('info')}<div>Pilih apakah pembayaran ini <b>masuk ke BKU</b> (menambah kas) atau <b>tidak masuk BKU</b> (hanya mengurangi piutang).</div></div>
            <div class="kv mb-2"><dt>Kategori</dt><dd>${esc(p.kategori_nama || '-')}</dd><dt>Nama</dt><dd>${esc(p.nama)}</dd>
              <dt>Nominal Utang</dt><dd>${rupiah(p.nominal)}</dd><dt>Sudah dibayar</dt><dd>${rupiah(p.dibayar)}</dd>
              <dt>Sisa</dt><dd style="color:var(--red)">${rupiah(p.sisa)}</dd></div>
            <form method="post" action="${c.base}/piutang-lainnya/bayar" id="fplnb${p.id}">
              <input type="hidden" name="id" value="${p.id}">
              <div class="row2">
                <div class="field"><label>Nominal Bayar (Rp)</label>${ui.moneyInput('nominal', p.sisa, 'required placeholder="0"')}
                  <div class="hint">Terbilang: <b>${esc(terbilangRupiah(p.sisa))}</b></div></div>
                <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal_bayar" value="${todayISO()}" required></div>
              </div>
              <div class="row2">
                <div class="field"><label>Metode</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></div>
                <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Contoh: pembayaran tahap 1"></div>
              </div>
              <div class="toggle-form" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px">
                <div>
                  <div class="t-strong">Masuk ke BKU</div>
                  <div class="t-sub" data-pl-bku-label>${bukuss.length ? 'Pembayaran dicatat sebagai pemasukan pada BKU penerima' : 'Tidak ada BKU aktif — pembayaran hanya mengurangi piutang'}</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" name="masuk_bku" value="1" data-pl-bku ${bukuss.length ? 'checked' : ''} ${bukuss.length ? '' : 'disabled'}>
                  <i></i>
                </label>
              </div>
              <div data-pl-bku-wrap style="${bukuss.length ? '' : 'display:none'}">
                <div class="field"><label>BKU Penerima</label><select name="bku_id">${bukuss.map(b => `<option value="${b.id}" ${p.bku_id === b.id ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select></div>
              </div>
            </form>`,
          footer: `<button class="btn" data-close="mPlnBayar${p.id}">Batal</button><button class="btn btn-green" form="fplnb${p.id}">${ui.icon('check')}Catat Pembayaran</button>`
        }) : ''}
          ${(() => {
          const list = bayar[p.id] || [];
          let run = Number(p.nominal || 0);
          const hist = list.map(b => { run -= Number(b.nominal || 0); return { ...b, sisa: Math.max(0, run) }; });
          const editModals = list.map(b => late('mPlnBayarEd' + b.id, {
            title: 'Edit Riwayat Pembayaran — ' + p.nama,
            body: `<div class="alert info">${ui.icon('info')}<div>Perubahan nominal/tanggal akan <b>menghitung ulang</b> sisa dan status tagihan otomatis.</div></div>
              <div class="kv mb-2"><dt>Nominal tagihan</dt><dd>${rupiah(p.nominal)}</dd>
                <dt>Total pembayaran saat ini</dt><dd>${rupiah(p.dibayar)}</dd>
                <dt>Sisa tagihan</dt><dd>${rupiah(p.sisa)}</dd></div>
              <form method="post" action="${c.base}/piutang-lainnya/bayar/save" id="fplnbe${b.id}">
                <input type="hidden" name="id" value="${b.id}">
                <div class="row2">
                  <div class="field"><label>Nominal Pembayaran (Rp)</label>${ui.moneyInput('nominal', b.nominal, 'required')}</div>
                  <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal" value="${esc(b.tanggal || '')}" required></div>
                </div>
                <div class="row2">
                  <div class="field"><label>Metode</label><select name="metode">
                    <option value="tunai" ${b.metode === 'transfer' ? '' : 'selected'}>Tunai</option>
                    <option value="transfer" ${b.metode === 'transfer' ? 'selected' : ''}>Transfer</option></select></div>
                  <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(b.keterangan || '')}"></div>
                </div>
              </form>`,
            footer: `<button class="btn" data-close="mPlnBayarEd${b.id}">Batal</button>
              <button class="btn btn-primary" form="fplnbe${b.id}">${ui.icon('save')}Simpan Perubahan</button>`
          })).join('');
          return editModals + late('mPlnRiwayat' + p.id, {
            title: 'Riwayat Pembayaran — ' + p.nama,
            wide: true,
            body: list.length ? `<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th class="num">Nominal Cicilan</th><th class="num">Sisa Piutang</th><th>Metode</th><th>Keterangan</th><th class="right">Aksi</th></tr></thead><tbody>
              <tr style="background:#FFF8F2"><td colspan="2" class="t-strong">Nominal utang awal</td><td class="num t-strong">${rupiah(p.nominal)}</td><td colspan="3"></td></tr>
              ${hist.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td><td class="num" style="color:var(--green)">${rupiah(b.nominal)}</td>
                <td class="num t-strong">${rupiah(b.sisa)}</td>
                <td>${b.metode === 'transfer' ? ui.badge('Transfer', 'blue') : ui.badge('Tunai', 'gray')}</td>
                <td class="t-sub">${esc(b.keterangan || '-')}</td>
                <td class="right nowrap">
                  <a class="btn btn-sm" target="_blank" href="${c.base}/piutang-lainnya/bayar/${b.id}/bukti" title="Cetak bukti pelunasan/cicilan">${ui.icon('printer')}Bukti</a>
                  ${editable ? `<button class="btn btn-sm btn-icon" data-open="mPlnBayarEd${b.id}" title="Edit riwayat pembayaran">${ui.icon('edit')}</button>` : ''}
                  ${c.can(MODUL, 'delete') ? `<form method="post" action="${c.base}/piutang-lainnya/bayar/delete" style="display:inline"
                    data-confirm="Hapus riwayat pembayaran ${rupiah(b.nominal)} tanggal ${tglID(b.tanggal)}? Sisa tagihan akan dihitung ulang.">
                    <input type="hidden" name="id" value="${b.id}">
                    <button class="btn btn-sm btn-danger" title="Hapus riwayat pembayaran">${ui.icon('trash')}</button></form>` : ''}
                </td></tr>`).join('')}
            </tbody><tfoot><tr><td class="center">TOTAL</td><td class="num">${rupiah(p.dibayar)}</td><td class="num">${rupiah(p.sisa)}</td><td colspan="3"></td></tr></tfoot></table></div>`
              : ui.emptyState('Belum ada pembayaran', 'Catat pembayaran pertama melalui tombol Bayar.'),
            footer: `<button class="btn" data-close="mPlnRiwayat${p.id}">Tutup</button>`
          });
        })()}`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada piutang lainnya', 'Tambahkan tagihan manual atau import dari Excel/CSV.')}
      ${late.html()}
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Tampilan pada Akun Aset Riil</h3><div class="sub">Sakelar utama modul — dapat dipersempit per kategori pada tabel di atas</div></div></div>
      <form method="post" action="${c.base}/piutang-lainnya/toggle-aset" class="toggle-form" style="border:0;padding:0">
        <div>
          <div class="t-strong">Tampilkan Piutang Lainnya di Akun Aset Riil: ${tampilAset ? 'Ya' : 'Tidak'}</div>
          <div class="t-sub">${tampilAset ? 'Sisa piutang kategori yang aktif ikut dihitung pada Total Aset Riil & Rekonsiliasi Kas' : 'Seluruh piutang lainnya disembunyikan dari perhitungan aset riil (data transaksi tetap tersimpan)'}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" name="tampil" value="1" ${tampilAset ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="this.form.submit()">
          <i></i>
        </label>
        <noscript><button class="btn btn-sm">Simpan</button></noscript>
      </form>
      <div class="alert info mt-2">${ui.icon('info')}<div>Sisa piutang lainnya yang dihitung sebagai aset: <b>${rupiah(sisaAset)}</b> (modul ${tampilAset ? 'aktif' : 'non-aktif'}, kategori mengikuti sakelar masing-masing).</div></div>
    </div>

    ${c.can(MODUL, 'create') ? ui.modal('mAddPln', {
      title: editR ? 'Edit Piutang Lainnya' : 'Tambah Piutang Lainnya',
      body: formTagihan(editR),
      footer: `<button class="btn" data-close="mAddPln">Batal</button><button class="btn btn-primary" form="fPln">${ui.icon('save')}Simpan</button>`
    }).replace('class="modal" id="mAddPln"', `class="modal ${editR ? 'show' : ''}" id="mAddPln"`) : ''}
    ${c.can(MODUL, 'create') ? ui.modal('mAddKatPln', {
      title: 'Tambah Kategori Piutang Lainnya',
      body: formKategori(null, 'fmAddKatPln'),
      footer: `<button class="btn" data-close="mAddKatPln">Batal</button><button class="btn btn-primary" form="fmAddKatPln">${ui.icon('save')}Simpan Kategori</button>`
    }) : ''}
    ${c.can(MODUL, 'create') ? ui.modal('mImportPln', {
      title: 'Import Piutang Lainnya (Excel / CSV)',
      wide: true,
      body: `<form method="post" action="${c.base}/piutang-lainnya/import" id="fImportPln">
        <div class="alert info">${ui.icon('info')}<div><b>Format kolom:</b> <code>[TANGGAL] | [NAMA] | [NOMINAL / TAGIHAN] | [KETERANGAN]</code> (opsional kolom <b>MASUK</b> untuk pembayaran).<br>
          Import bersifat historis: pembayaran tercatat sebagai riwayat tanpa membuat transaksi kas.</div></div>
        <div class="field"><label>Kategori Tujuan <span style="color:var(--red)">*</span></label>
          <select name="kategori_id" required><option value="">— Pilih kategori —</option>${katOptions(katFilter)}</select></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="file_pln_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="file_pln_b64" data-max="10">
          <div class="hint" id="file_pln_b64-info">Baris judul dicari otomatis. Bisa juga memakai template Excel.</div></div>
      </form>`,
      footer: `<a class="btn" href="${c.base}/piutang-lainnya/template">${ui.icon('download')}Template</a>
        <button class="btn" data-close="mImportPln">Batal</button>
        <button class="btn btn-primary" form="fImportPln">${ui.icon('upload')}Import Sekarang</button>`
    }) : ''}`;

    page(req, res, { title: 'Piutang Lainnya', sub: 'Kategori piutang fleksibel, tagihan & pembayaran', active: MODUL, content });
  });

  /* ================= bukti cetak ================= */
  function buktiPln({ c, req, jenis, p, nominal, tanggal, noRef, extra = [] }) {
    const isCair = jenis === 'cair';
    const body = `<div class="kwit-box">
        <div class="head"><span>BUKTI ${isCair ? 'PENCAIRAN / PENAMBAHAN PIUTANG LAINNYA' : 'PELUNASAN / CICILAN PIUTANG LAINNYA'}</span><span>No. ${esc(noRef)}</span></div>
        <div class="kwit-body">
          <div class="k">Nama</div><div class="v">${esc(p.nama || '-')}</div>
          <div class="k">Kategori</div><div class="v">${esc(p.kategori_nama || '-')}</div>
          ${extra.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('')}
          <div class="k">Uang sejumlah</div><div class="v" style="font-style:italic">${esc(lib.terbilangRupiah(nominal))}</div>
          <div class="k">Tanggal</div><div class="v">${tglID(tanggal)}</div>
          <div class="k">Jumlah</div><div class="v kwit-amt">${rupiah(nominal)}</div>
        </div>
      </div>
      <div class="sign-grid sign-3" style="margin-top:18px">
        <div class="sig"><div>Mengetahui,</div><div style="font-weight:600">Kepala ${esc(c.settings.sekolah_nama || 'Sekolah')}</div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_kepala || '............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_kepala || '.....................')}</div></div>
        <div class="sig"><div>${esc(c.settings.sekolah_nama || '')}, ${tglID(tanggal)}<br>Bendahara</div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_bendahara || '............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_bendahara || '.....................')}</div></div>
        <div class="sig"><div>${isCair ? 'Penerima' : 'Penyetor'}</div><div class="space"></div>
          <div class="nm">${esc(p.nama || '-')}</div></div>
      </div>
      <p style="font-size:10px;color:#6B5B51;margin-top:12px;text-align:center">Kwitansi ini sah sebagai bukti ${isCair ? 'pencairan' : 'pelunasan'} piutang lainnya.</p>`;
    return ui.kwitansiPage({
      settings: c.settings, base: c.base,
      title: isCair ? 'Bukti Pencairan Piutang Lainnya' : 'Bukti Pelunasan Piutang Lainnya',
      body, backHref: '/piutang-lainnya', backLabel: 'Kembali ke Piutang Lainnya',
      orient: printcfg.orient(req, dbm, 'kwitansi_trx'), selfPath: req ? req.url : ''
    });
  }

  get('/piutang-lainnya/:id/bukti', (req, res) => {
    if (!guard(req, res, MODUL, 'view')) return;
    const c = ctx(req);
    const p = db.prepare(`SELECT p.*, k.nama kategori_nama FROM piutang_lainnya p LEFT JOIN piutang_kategori k ON k.id=p.kategori_id WHERE p.id=?`).get(req.params.id);
    if (!p) return res.notFound();
    const sisa = dbm.piutangLainnyaSisa(p.id);
    res.html(buktiPln({
      c, req, jenis: 'cair', p, nominal: Number(p.nominal || 0), tanggal: p.tanggal || todayISO(),
      noRef: `PLN/${String(p.id).padStart(5, '0')}`,
      extra: [['Tanggal Tagihan', tglID(p.tanggal)], ['Keterangan', esc(p.keterangan || '-')], ['Sisa Tagihan', rupiah(sisa)]]
    }));
  });

  get('/piutang-lainnya/bayar/:id/bukti', (req, res) => {
    if (!guard(req, res, MODUL, 'view')) return;
    const c = ctx(req);
    const b = db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const p = db.prepare(`SELECT p.*, k.nama kategori_nama FROM piutang_lainnya p LEFT JOIN piutang_kategori k ON k.id=p.kategori_id WHERE p.id=?`).get(b.piutang_id) || {};
    const sisa = dbm.piutangLainnyaSisa(b.piutang_id);
    res.html(buktiPln({
      c, req, jenis: 'lunas', p, nominal: Number(b.nominal || 0), tanggal: b.tanggal || todayISO(),
      noRef: `PLNS/${String(b.id).padStart(5, '0')}`,
      extra: [['Nominal Tagihan Awal', rupiah(p.nominal)], ['Metode', b.metode === 'transfer' ? 'Transfer Bank' : 'Tunai'],
      ['Keterangan', esc(b.keterangan || '-')], ['Sisa Setelah Pembayaran', rupiah(sisa)]]
    }));
  });

  /* ================= kategori: CRUD + sakelar aset ================= */
  post('/piutang-lainnya/kategori/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, MODUL, isEdit ? 'edit' : 'create')) return;
    const nama = String(req.body.nama || '').trim();
    const ket = String(req.body.keterangan || '').trim();
    const tampil = req.body.tampil_aset ? 1 : 0;
    const aktif = req.body.aktif ? 1 : 0;
    if (!nama) return res.redirect(back(req) + '?err=' + encodeURIComponent('Nama kategori wajib diisi.'));
    const dup = dbm.piutangKategoriByNama(nama);
    if (dup && String(dup.id) !== String(req.body.id || '')) {
      return res.redirect(back(req) + '?err=' + encodeURIComponent(`Kategori "${nama}" sudah ada.`));
    }
    if (isEdit) {
      const old = dbm.piutangKategoriById(req.body.id);
      if (!old) return res.redirect(back(req) + '?err=' + encodeURIComponent('Kategori tidak ditemukan.'));
      db.prepare('UPDATE piutang_kategori SET nama=?,keterangan=?,tampil_aset=?,aktif=? WHERE id=?')
        .run(nama, ket, tampil, aktif, old.id);
      dbm.logAudit(req.user, 'EDIT', MODUL, `Edit kategori piutang lainnya ${old.nama} → ${nama} (aset riil: ${tampil ? 'Ya' : 'Tidak'})`);
      return res.redirect(back(req) + '?ok=' + encodeURIComponent('Kategori piutang diperbarui.'));
    }
    const urut = db.prepare('SELECT COALESCE(MAX(urutan),0)+1 n FROM piutang_kategori').get().n;
    db.prepare('INSERT INTO piutang_kategori (nama,keterangan,tampil_aset,aktif,urutan,created_at) VALUES (?,?,?,?,?,?)')
      .run(nama, ket, tampil, aktif, urut, nowStamp());
    dbm.logAudit(req.user, 'TAMBAH', MODUL, `Tambah kategori piutang lainnya ${nama}`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Kategori "${nama}" ditambahkan.`));
  });

  post('/piutang-lainnya/kategori/delete', (req, res) => {
    if (!guard(req, res, MODUL, 'delete')) return;
    const k = dbm.piutangKategoriById(req.body.id);
    if (!k) return res.redirect(back(req) + '?err=' + encodeURIComponent('Kategori tidak ditemukan.'));
    const n = db.prepare('SELECT COUNT(*) c FROM piutang_lainnya WHERE kategori_id=?').get(k.id).c;
    if (n) return res.redirect(back(req) + '?err=' + encodeURIComponent(`Kategori "${k.nama}" masih memiliki ${n} tagihan — hapus atau pindahkan tagihannya terlebih dahulu.`));
    dbm.trashAdd('piutang_kategori', k, { user: req.user, label: `Kategori piutang lainnya ${k.nama}` });
    db.prepare('DELETE FROM piutang_kategori WHERE id=?').run(k.id);
    dbm.logAudit(req.user, 'HAPUS', MODUL, `Hapus kategori piutang lainnya ${k.nama}`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Kategori "${k.nama}" dihapus (dapat dipulihkan dari Kotak Sampah).`));
  });

  post('/piutang-lainnya/kategori/toggle', (req, res) => {
    if (!guard(req, res, MODUL, 'edit')) return;
    const k = dbm.piutangKategoriById(req.body.id);
    if (!k) return res.redirect(back(req) + '?err=' + encodeURIComponent('Kategori tidak ditemukan.'));
    const val = req.body.tampil_aset ? 1 : 0;
    db.prepare('UPDATE piutang_kategori SET tampil_aset=? WHERE id=?').run(val, k.id);
    dbm.logAudit(req.user, 'EDIT', MODUL, `Kategori ${k.nama} ${val ? 'ditampilkan pada' : 'disembunyikan dari'} Akun Aset Riil`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Kategori "${k.nama}" ${val ? 'ditampilkan pada' : 'disembunyikan dari'} Akun Aset Riil.`));
  });

  post('/piutang-lainnya/toggle-aset', (req, res) => {
    if (!guard(req, res, MODUL, 'edit')) return;
    const val = req.body.tampil ? '1' : '0';
    dbm.setSetting('tampil_piutang_lainnya', val);
    dbm.logAudit(req.user, 'EDIT', MODUL, `Piutang lainnya ${val === '1' ? 'ditampilkan' : 'disembunyikan'} pada Akun Aset Riil`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Piutang lainnya ${val === '1' ? 'ditampilkan pada' : 'disembunyikan dari'} Akun Aset Riil.`));
  });

  /* ================= simpan tagihan ================= */
  post('/piutang-lainnya/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, MODUL, isEdit ? 'edit' : 'create')) return;
    const nama = String(req.body.nama || '').trim();
    const tanggal = req.body.tanggal || todayISO();
    const nominal = lib.parseMoney(req.body.nominal);
    const kat = dbm.piutangKategoriById(req.body.kategori_id);
    if (!kat) return res.redirect(back(req) + '?err=' + encodeURIComponent('Pilih kategori piutang terlebih dahulu.'));
    if (!nama || !(nominal > 0)) return res.redirect(back(req) + '?err=' + encodeURIComponent('Nama dan nominal tagihan wajib diisi.'));
    const bkuId = req.body.bku_id ? Number(req.body.bku_id) : null;
    const ket = String(req.body.keterangan || '').trim();
    if (isEdit) {
      const old = db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(req.body.id);
      if (!old) return res.redirect(back(req) + '?err=' + encodeURIComponent('Data tagihan tidak ditemukan.'));
      const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lainnya_bayar WHERE piutang_id=?').get(old.id).s || 0);
      if (nominal < dibayar) return res.redirect(back(req) + '?err=' + encodeURIComponent(`Nominal tagihan tidak boleh lebih kecil dari total pembayaran (${rupiah(dibayar)}).`));
      const sisa = Math.max(0, nominal - dibayar);
      db.prepare('UPDATE piutang_lainnya SET kategori_id=?,nama=?,tanggal=?,nominal=?,keterangan=?,bku_id=?,status=?,tanggal_bayar=? WHERE id=?')
        .run(kat.id, nama, tanggal, nominal, ket, bkuId, sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (old.tanggal_bayar || todayISO()) : null, old.id);
      dbm.logAudit(req.user, 'EDIT', MODUL, `Edit piutang lainnya ${nama} (${rupiah(nominal)}) kategori ${kat.nama}`);
      return res.redirect(back(req) + '?ok=' + encodeURIComponent('Tagihan piutang lainnya diperbarui.'));
    }
    const taRow = dbm.taOf(req) || dbm.activeTahun();
    db.prepare(`INSERT INTO piutang_lainnya (kategori_id,nama,tanggal,nominal,keterangan,status,tanggal_bayar,bku_id,created_at,tahun_ajaran_id)
      VALUES (?,?,?,?,?,'belum',NULL,?,?,?)`)
      .run(kat.id, nama, tanggal, nominal, ket, bkuId, nowStamp(), taRow ? taRow.id : null);
    dbm.logAudit(req.user, 'TAMBAH', MODUL, `Tambah piutang lainnya ${nama} kategori ${kat.nama} (${rupiah(nominal)})`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent('Tagihan piutang lainnya disimpan.'));
  });

  /* ================= pembayaran ================= */
  post('/piutang-lainnya/bayar', (req, res) => {
    if (!guard(req, res, MODUL, 'edit')) return;
    const p = db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(req.body.id);
    if (!p) return res.redirect(back(req) + '?err=' + encodeURIComponent('Tagihan tidak ditemukan.'));
    const masukBku = String(req.body.masuk_bku || '') === '1';
    const b = masukBku ? db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.bku_id) : null;
    if (masukBku && !b) return res.redirect(back(req) + '?err=' + encodeURIComponent('BKU penerima wajib dipilih untuk pembayaran yang masuk BKU.'));
    if (masukBku && b.status !== 'aktif') return res.redirect(back(req) + '?err=' + encodeURIComponent('BKU "' + b.nama + '" sudah ditutup.'));
    const tanggal = req.body.tanggal_bayar || todayISO();
    if (masukBku) {
      const lockErr = dbm.periodeLockError(b.id, tanggal);
      if (lockErr) return res.redirect(back(req) + '?err=' + encodeURIComponent(lockErr));
    }
    const sisa = dbm.piutangLainnyaSisa(p.id);
    if (sisa <= 0) return res.redirect(back(req) + '?err=' + encodeURIComponent('Tagihan ini sudah lunas.'));
    const nominal = lib.parseMoney(req.body.nominal);
    if (!(nominal > 0)) return res.redirect(back(req) + '?err=' + encodeURIComponent('Nominal pembayaran harus lebih dari 0.'));
    if (nominal > sisa) return res.redirect(back(req) + '?err=' + encodeURIComponent(`Nominal melebihi sisa tagihan (${rupiah(sisa)}).`));

    const sisaAkhir = sisa - nominal;
    let noBukti = '';
    db.transaction(() => {
      let trxId = null;
      if (masukBku) {
        const t = trxMasuk({
          bku: b, tanggal, nominal, metode: req.body.metode, user: req.user,
          uraian: `Pembayaran piutang lainnya — ${p.nama}`, nama: p.nama
        });
        trxId = t.id; noBukti = t.noBukti;
      }
      db.prepare(`INSERT INTO piutang_lainnya_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(p.id, tanggal, nominal, req.body.metode === 'transfer' ? 'transfer' : 'tunai',
        masukBku ? b.id : null, trxId, String(req.body.keterangan || '').trim(), nowStamp(), req.user.id);
      db.prepare('UPDATE piutang_lainnya SET status=?, tanggal_bayar=?, bku_id=? WHERE id=?')
        .run(sisaAkhir <= 0 ? 'lunas' : 'belum', sisaAkhir <= 0 ? tanggal : null, masukBku ? b.id : p.bku_id, p.id);
    })();
    dbm.logAudit(req.user, 'EDIT', MODUL,
      `Pembayaran piutang lainnya ${p.nama} ${rupiah(nominal)} ${masukBku ? '→ masuk ' + b.nama + ' (' + noBukti + ')' : '(tidak masuk BKU)'}; sisa ${rupiah(sisaAkhir)}`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(
      sisaAkhir <= 0
        ? `Tagihan ${p.nama} lunas.${masukBku ? ` Pemasukan ${rupiah(nominal)} tercatat di ${b.nama}.` : ' Pembayaran tidak dibukukan ke BKU.'}`
        : `Pembayaran ${rupiah(nominal)} dicatat. Sisa tagihan ${p.nama} menjadi ${rupiah(sisaAkhir)}.`));
  });

  post('/piutang-lainnya/bayar/save', (req, res) => {
    if (!guard(req, res, MODUL, 'edit')) return;
    const b = db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE id=?').get(req.body.id);
    if (!b) return res.redirect(back(req) + '?err=' + encodeURIComponent('Riwayat pembayaran tidak ditemukan.'));
    const p = db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(b.piutang_id);
    const nominal = lib.parseMoney(req.body.nominal);
    const tanggal = String(req.body.tanggal || '').slice(0, 10) || b.tanggal;
    if (!(nominal > 0)) return res.redirect(back(req) + '?err=' + encodeURIComponent('Nominal pembayaran harus lebih dari 0.'));
    const lain = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lainnya_bayar WHERE piutang_id=? AND id<>?').get(b.piutang_id, b.id).s || 0);
    const totalUtang = Number(p ? p.nominal || 0 : 0);
    if (nominal > Math.max(0, totalUtang - lain)) {
      return res.redirect(back(req) + '?err=' + encodeURIComponent(`Nominal pembayaran melebihi sisa tagihan (${rupiah(Math.max(0, totalUtang - lain))}).`));
    }
    db.transaction(() => {
      db.prepare('UPDATE piutang_lainnya_bayar SET tanggal=?,nominal=?,metode=?,keterangan=? WHERE id=?')
        .run(tanggal, nominal, req.body.metode === 'transfer' ? 'transfer' : 'tunai', String(req.body.keterangan || '').trim(), b.id);
      refresh(b.piutang_id);
    })();
    dbm.logAudit(req.user, 'EDIT', MODUL,
      `Ubah riwayat pembayaran piutang lainnya ${p ? p.nama : '#' + b.piutang_id}: ${rupiah(b.nominal)} → ${rupiah(nominal)} (${tglID(tanggal)})`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Riwayat pembayaran ${p ? p.nama : ''} diperbarui menjadi ${rupiah(nominal)}.`));
  });

  post('/piutang-lainnya/bayar/delete', (req, res) => {
    if (!guard(req, res, MODUL, 'delete')) return;
    const b = db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE id=?').get(req.body.id);
    if (!b) return res.redirect(back(req) + '?err=' + encodeURIComponent('Riwayat pembayaran tidak ditemukan.'));
    const p = db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(b.piutang_id);
    let trxDihapus = false;
    if (b.transaksi_id) {
      const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(b.transaksi_id);
      if (t && !dbm.periodeLockError(t.bku_id, t.tanggal, 'edit')) {
        dbm.trashAdd('transaksi', t, { user: req.user, alasan: 'Hapus riwayat pembayaran piutang lainnya', label: `${t.no_bukti} — ${t.uraian}` });
        db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
        trxDihapus = true;
      }
    }
    dbm.trashAdd('piutang_lainnya_bayar', b, {
      user: req.user,
      label: `Pembayaran piutang lainnya ${p ? p.nama : '#' + b.piutang_id} ${rupiah(b.nominal)} (${tglID(b.tanggal)})`
    });
    db.transaction(() => {
      db.prepare('DELETE FROM piutang_lainnya_bayar WHERE id=?').run(b.id);
      refresh(b.piutang_id);
    })();
    dbm.logAudit(req.user, 'HAPUS', MODUL,
      `Hapus riwayat pembayaran piutang lainnya ${p ? p.nama : '#' + b.piutang_id} ${rupiah(b.nominal)} (${tglID(b.tanggal)})${trxDihapus ? ' + transaksi BKU terkait' : ''}`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Riwayat pembayaran ${rupiah(b.nominal)} dihapus. Sisa tagihan dihitung ulang${trxDihapus ? ' dan transaksi BKU terkait ikut dihapus' : ''}.`));
  });

  /* ================= pembayaran gabungan ================= */
  post('/piutang-lainnya/bayar-gabungan', (req, res) => {
    if (!guard(req, res, MODUL, 'edit')) return;
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.redirect(back(req) + '?err=' + encodeURIComponent('Nama tidak dikenali.'));
    const tanggal = req.body.tanggal_bayar || todayISO();
    const nominal = lib.parseMoney(req.body.nominal);
    if (!(nominal > 0)) return res.redirect(back(req) + '?err=' + encodeURIComponent('Nominal pembayaran harus lebih dari 0.'));

    const list = db.prepare(`SELECT p.id, p.nominal,
        COALESCE((SELECT SUM(x.nominal) FROM piutang_lainnya_bayar x WHERE x.piutang_id=p.id),0) dibayar
      FROM piutang_lainnya p WHERE lower(trim(p.nama))=lower(trim(?)) AND p.status='belum'
      ORDER BY COALESCE(p.tanggal,''), p.id`).all(nama)
      .map(p => ({ ...p, sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }))
      .filter(p => p.sisa > 0);
    if (!list.length) return res.redirect(back(req) + '?err=' + encodeURIComponent(`Tidak ada tagihan belum lunas untuk ${nama}.`));
    const totalSisa = list.reduce((a, p) => a + p.sisa, 0);
    if (nominal > totalSisa) return res.redirect(back(req) + '?err=' + encodeURIComponent(`Nominal ${rupiah(nominal)} melebihi total sisa ${rupiah(totalSisa)}.`));

    const masukBku = String(req.body.masuk_bku || '') === '1';
    const bku = masukBku ? db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.bku_id) : null;
    if (masukBku && !bku) return res.redirect(back(req) + '?err=' + encodeURIComponent('BKU penerima wajib dipilih.'));
    if (masukBku && bku.status !== 'aktif') return res.redirect(back(req) + '?err=' + encodeURIComponent('BKU "' + bku.nama + '" sudah ditutup.'));
    if (masukBku) {
      const lock = dbm.periodeLockError(bku.id, tanggal);
      if (lock) return res.redirect(back(req) + '?err=' + encodeURIComponent(lock));
    }

    let sisaBayar = nominal, kena = 0, lunas = 0, trxId = null, noBukti = '';
    db.transaction(() => {
      if (masukBku) {
        const t = trxMasuk({
          bku, tanggal, nominal, metode: req.body.metode, user: req.user,
          uraian: `Pembayaran gabungan piutang lainnya — ${nama}`, nama
        });
        trxId = t.id; noBukti = t.noBukti;
      }
      const ins = db.prepare(`INSERT INTO piutang_lainnya_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const p of list) {
        if (sisaBayar <= 0) break;
        const bayar = Math.min(p.sisa, sisaBayar);
        sisaBayar -= bayar; kena++;
        ins.run(p.id, tanggal, bayar, req.body.metode === 'transfer' ? 'transfer' : 'tunai', masukBku ? bku.id : null, trxId,
          String(req.body.keterangan || 'Pembayaran gabungan'), nowStamp(), req.user.id);
        const masih = dbm.piutangLainnyaSisa(p.id);
        db.prepare('UPDATE piutang_lainnya SET status=?, tanggal_bayar=?, bku_id=? WHERE id=?')
          .run(masih <= 0 ? 'lunas' : 'belum', masih <= 0 ? tanggal : null, masukBku ? bku.id : null, p.id);
        if (masih <= 0) lunas++;
      }
    })();
    dbm.logAudit(req.user, 'EDIT', MODUL,
      `Pembayaran gabungan piutang lainnya ${nama} ${rupiah(nominal)} untuk ${kena} tagihan (${lunas} lunas${masukBku ? ', masuk ' + bku.nama + ' ' + noBukti : ', tanpa BKU'})`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(
      `Pembayaran gabungan ${rupiah(nominal)} dicatat untuk ${nama} (${kena} tagihan, ${lunas} otomatis LUNAS).${masukBku ? ` Pemasukan tercatat di ${bku.nama}.` : ' Tidak masuk BKU.'}`));
  });

  post('/piutang-lainnya/delete', (req, res) => {
    if (!guard(req, res, MODUL, 'delete')) return;
    const p = db.prepare('SELECT * FROM piutang_lainnya WHERE id=?').get(req.body.id);
    if (p) {
      const anak = db.prepare('SELECT * FROM piutang_lainnya_bayar WHERE piutang_id=?').all(p.id);
      dbm.trashAdd('piutang_lainnya', p, { user: req.user, label: `Piutang lainnya ${p.nama} ${rupiah(p.nominal)}`, extra: { children: [{ tabel: 'piutang_lainnya_bayar', rows: anak }] } });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM piutang_lainnya_bayar WHERE piutang_id=?').run(req.body.id);
      db.prepare('DELETE FROM piutang_lainnya WHERE id=?').run(req.body.id);
    })();
    dbm.logAudit(req.user, 'HAPUS', MODUL, `Hapus piutang lainnya ${p ? p.nama : req.body.id}`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent('Tagihan piutang lainnya dihapus.'));
  });

  /* ================= template / import / export / cetak ================= */
  const HEAD = ['TANGGAL', 'NAMA', 'NOMINAL', 'KETERANGAN', 'MASUK'];
  get('/piutang-lainnya/template', (req, res) => {
    guard(req, res, MODUL, 'view');
    const rows = [
      [{ v: 'TANGGAL', bold: true }, { v: 'NAMA', bold: true }, { v: 'NOMINAL', bold: true }, { v: 'KETERANGAN', bold: true }, { v: 'MASUK', bold: true }],
      ['2026-01-15', 'Contoh Nama', 500000, 'Piutang dana talangan — baris contoh, silakan dihapus', ''],
      ['2026-02-10', 'Contoh Nama', 250000, 'Piutang kegiatan', 100000],
      []
    ];
    const buf = lib.xlsxBuffer('Piutang Lainnya', rows, [14, 30, 16, 44, 14]);
    res.file(buf, 'template-import-piutang-lainnya.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  post('/piutang-lainnya/import', (req, res) => {
    if (!guard(req, res, MODUL, 'create')) return;
    const kat = dbm.piutangKategoriById(req.body.kategori_id);
    if (!kat) return res.redirect(back(req) + '?err=' + encodeURIComponent('Pilih kategori tujuan import terlebih dahulu.'));
    const buf = decodeFile(req.body.file_b64);
    if (!buf) return res.redirect(back(req) + '?err=' + encodeURIComponent('Pilih berkas Excel/CSV terlebih dahulu.'));
    let sheets;
    try { sheets = readAny(buf); } catch (e) { return res.redirect(back(req) + '?err=' + encodeURIComponent('Gagal membaca berkas: ' + e.message)); }

    let header = null, sheet = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(up);
        const map = {};
        labels.forEach((t, idx) => {
          if (map.nama === undefined && /^NAMA|PESERTA|PIHAK/.test(t)) map.nama = idx;
          if (map.tanggal === undefined && /TANGGAL|TGL/.test(t)) map.tanggal = idx;
          if (map.nominal === undefined && /NOMINAL|TAGIHAN|JUMLAH|KELUAR/.test(t)) map.nominal = idx;
          if (map.masuk === undefined && /MASUK|BAYAR|DIBAYAR/.test(t)) map.masuk = idx;
          if (map.keterangan === undefined && /KETERANGAN|CATATAN|URAIAN/.test(t)) map.keterangan = idx;
        });
        if (map.nama !== undefined && map.nominal !== undefined) { header = { row: i, map }; sheet = sh; break; }
      }
      if (header) break;
    }
    if (!header) return res.redirect(back(req) + '?err=' + encodeURIComponent('Header tidak dikenali. Gunakan kolom NAMA | NOMINAL (TANGGAL & KETERANGAN opsional).'));

    const namaFile = String(req.body.file_name || 'import-piutang-lainnya').slice(-80);
    let baru = 0, bayarN = 0, dilewati = 0;
    const ambil = (cells, key) => header.map[key] === undefined ? null : cells[header.map[key]];
    const taRow = dbm.taOf(req) || dbm.activeTahun();
    db.transaction(() => {
      for (let i = header.row + 1; i < sheet.rows.length; i++) {
        const cells = sheet.rows[i] || [];
        if (!cells.length) continue;
        const nama = X.cellText(ambil(cells, 'nama')).trim();
        const nominal = X.parseMoneyCell(ambil(cells, 'nominal'));
        if (!nama) { dilewati++; continue; }
        if (/^(NAMA|JUMLAH|TOTAL)\b/i.test(nama)) { dilewati++; continue; }
        if (!(nominal > 0)) { dilewati++; continue; }
        const tanggal = X.parseDateCell(ambil(cells, 'tanggal')) || todayISO();
        const ket = X.cellText(ambil(cells, 'keterangan')).trim();
        const dup = db.prepare('SELECT id FROM piutang_lainnya WHERE kategori_id=? AND lower(nama)=lower(?) AND tanggal=? AND nominal=?')
          .get(kat.id, nama, tanggal, nominal);
        let pid = dup ? dup.id : null;
        if (!dup) {
          const info = db.prepare(`INSERT INTO piutang_lainnya (kategori_id,nama,tanggal,nominal,keterangan,status,tanggal_bayar,bku_id,created_at,tahun_ajaran_id)
            VALUES (?,?,?,?,?,'belum',NULL,NULL,?,?)`).run(kat.id, nama, tanggal, nominal, ket || `Import ${namaFile}`, nowStamp(), taRow ? taRow.id : null);
          pid = Number(info.lastInsertRowid);
          baru++;
        } else { dilewati++; }
        const masuk = header.map.masuk === undefined ? 0 : X.parseMoneyCell(ambil(cells, 'masuk'));
        if (pid && masuk > 0) {
          const sisa = dbm.piutangLainnyaSisa(pid);
          const bayar = Math.min(sisa, masuk);
          if (bayar > 0) {
            db.prepare(`INSERT INTO piutang_lainnya_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
              VALUES (?,?,?,'tunai',NULL,NULL,?,?,?)`).run(pid, tanggal, bayar, `Import ${namaFile}`, nowStamp(), req.user.id);
            const masih = dbm.piutangLainnyaSisa(pid);
            db.prepare('UPDATE piutang_lainnya SET status=?, tanggal_bayar=? WHERE id=?')
              .run(masih <= 0 ? 'lunas' : 'belum', masih <= 0 ? tanggal : null, pid);
            bayarN++;
          }
        }
      }
    })();
    dbm.logAudit(req.user, 'IMPORT', MODUL, `Import piutang lainnya ${namaFile} kategori ${kat.nama}: ${baru} tagihan, ${bayarN} pembayaran, ${dilewati} dilewati`);
    res.redirect(back(req) + '?ok=' + encodeURIComponent(`Import selesai: ${baru} tagihan baru, ${bayarN} pembayaran tercatat, ${dilewati} baris dilewati.`));
  });

  get('/piutang-lainnya/export', (req, res) => {
    guard(req, res, MODUL, 'view');
    const c = ctx(req);
    const katFilter = req.query.get('kategori') || '';
    const rows = dbm.piutangLainnyaRows(c.taId, { kategoriId: katFilter ? Number(katFilter) : null, q: req.query.get('q') || '' });
    const head = ['KATEGORI', 'NAMA', 'TANGGAL', 'NOMINAL', 'SUDAH DICICIL', 'SISA', 'STATUS', 'KETERANGAN'].map(v => ({ v, bold: true }));
    const body = rows.map(p => [p.kategori_nama || '', p.nama, p.tanggal || '', Number(p.nominal || 0), Number(p.dibayar || 0), Number(p.sisa || 0),
      p.status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS', p.keterangan || '']);
    const buf = lib.xlsxBuffer('Piutang Lainnya', [head, ...body], [24, 30, 14, 16, 16, 16, 14, 40]);
    res.file(buf, 'piutang-lainnya.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  get('/piutang-lainnya/cetak', (req, res) => {
    guard(req, res, MODUL, 'view');
    const c = ctx(req);
    const katFilter = req.query.get('kategori') || '';
    const kat = katFilter ? dbm.piutangKategoriById(katFilter) : null;
    const rows = dbm.piutangLainnyaRows(c.taId, { kategoriId: katFilter ? Number(katFilter) : null, q: req.query.get('q') || '' });
    const tot = rows.reduce((a, r) => a + Number(r.nominal || 0), 0);
    const dib = rows.reduce((a, r) => a + Number(r.dibayar || 0), 0);
    const sis = rows.reduce((a, r) => a + Number(r.sisa || 0), 0);
    const num2 = v => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const body = `<p style="font-size:12.5px;text-align:center">Rekapitulasi Piutang Lainnya${kat ? ' — Kategori ' + esc(kat.nama) : ''}<br><b>Tahun Pelajaran ${esc(c.ta ? c.ta.nama : '-')}</b></p>
      <table class="doc-tbl"><thead><tr><th style="width:34px">No</th><th>Kategori</th><th>Nama</th><th style="width:78px">Tanggal</th>
        <th style="width:96px">Nominal</th><th style="width:96px">Sudah Dicicil</th><th style="width:96px">Sisa</th><th style="width:66px">Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((p, i) => `<tr><td class="center">${i + 1}</td><td>${esc(p.kategori_nama || '-')}</td><td>${esc(p.nama)}</td>
        <td class="center">${tglID(p.tanggal)}</td><td class="num">${num2(p.nominal)}</td><td class="num">${num2(p.dibayar)}</td>
        <td class="num">${num2(p.sisa)}</td><td class="center">${p.status === 'lunas' ? 'Lunas' : 'Belum'}</td></tr>`).join('')
        : '<tr><td colspan="8" class="center">Tidak ada data</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4" class="center">TOTAL</td><td class="num">${num2(tot)}</td><td class="num">${num2(dib)}</td><td class="num">${num2(sis)}</td><td></td></tr></tfoot></table>
      ${ui.signBlock(c.settings, { tempat: '', tanggal: tglID(todayISO()) })}`;
    res.html(ui.docPage({
      settings: c.settings, base: c.base, title: 'Daftar Piutang Lainnya',
      no: `Tahun Pelajaran ${c.ta ? c.ta.nama : '-'}${kat ? ' · ' + kat.nama : ''}`,
      body, backHref: '/piutang-lainnya',
      orient: printcfg.orient(req, dbm, 'laporan_piutang'), selfPath: req.url
    }));
  });
};
