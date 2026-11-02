'use strict';
const printcfg = require('../printcfg');
/* ============ PIUTANG LAIN-LAIN (SERTIFIKASI) ============ */
const X = require('../xlsx-read');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, terbilangRupiah } = lib;
  const KATEGORI = 'Sertifikasi';

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
  function rowsOf(taId) {
    return dbm.piutangLainRows(taId);
  }
  function bayarMap() {
    const map = {};
    for (const b of db.prepare('SELECT * FROM piutang_lain_bayar ORDER BY tanggal, id').all()) {
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

  /* ================= halaman ================= */
  get('/piutang-lain', (req, res) => {
    guard(req, res, 'piutang_lain', 'view');
    const c = ctx(req);
    // status LUNAS/BELUM LUNAS disinkronkan dari total cicilan agar sama dengan portal publik
    try { dbm.piutangSyncStatus(); } catch (e) { }
    const taId = c.taId;
    const rows = rowsOf(taId);
    const bayar = bayarMap();
    const bukuss = bkuAktif(taId);
    const tampil = dbm.sertifikasiTampil();
    const late = modalCollector();

    const totalNominal = rows.reduce((s, r) => s + Number(r.nominal || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + Number(r.dibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + Number(r.sisa || 0), 0);
    const belum = rows.filter(r => r.sisa > 0).length;

    const editR = req.query.get('edit') ? db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(req.query.get('edit')) : null;
    const form = (p) => `<form method="post" action="${c.base}/piutang-lain/save" id="fPl">
      <input type="hidden" name="id" value="${p ? p.id : ''}">
      <div class="row2">
        <div class="field"><label>Nama Pegawai</label>
          <input name="nama" list="pegawaiListPl" value="${esc(p ? p.nama : '')}" required placeholder="Pilih dari master pegawai atau ketik manual">
          <div class="hint">Pilihan otomatis dari menu <b>Data Pegawai</b>.</div></div>
        <div class="field"><label>Tanggal Utang / Tagihan</label>
          <input type="date" name="tanggal" value="${esc(p ? p.tanggal : todayISO())}" required></div>
      </div>
      <div class="row2">
        <div class="field"><label>Nominal Utang / Tagihan (Rp)</label>${ui.moneyInput('nominal', p ? p.nominal : '', 'required placeholder="0"')}</div>
        <div class="field"><label>BKU Penerima (opsional)</label>
          <select name="bku_id"><option value="">— Pilih —</option>${dbm.allBku(taId).map(b => `<option value="${b.id}" ${p && String(p.bku_id) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(p ? p.keterangan : '')}" placeholder="Contoh: sertifikasi kompetensi kelas XII"></div>
      <div class="hint">Pembayaran dicatat lewat tombol <b>Bayar</b> pada tabel — otomatis menambah kas pada BKU yang dipilih.</div>
    </form>`;

    // rekapitulasi per pegawai (sama seperti modul piutang pegawai)
    const rekap = dbm.sertifikasiRekap(taId);
    const rekapAktif = rekap.filter(g => g.aktif > 0);
    const modalsRekap = modalCollector();

    const content = `
    <datalist id="pegawaiListPl">${dbm.pegawaiList(true).map(x => `<option value="${esc(x.nama)}">${esc(x.jabatan || '')}</option>`).join('')}</datalist>
    <div class="kpi-grid mb-3">
      <div class="kpi ic-blue"><div class="ico">${ui.icon('card')}</div><div class="lbl">Total Piutang Sertifikasi</div><div class="val" style="font-size:19px">${rupiah(totalNominal)}</div><div class="meta">${rows.length} baris tagihan</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Sudah Dicicil</div><div class="val" style="font-size:19px">${rupiah(totalDibayar)}</div><div class="meta">Akumulasi pembayaran</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Sisa Piutang Sertifikasi</div><div class="val" style="font-size:19px">${rupiah(totalSisa)}</div><div class="meta">${belum} tagihan belum lunas</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('chart')}</div><div class="lbl">Status Laporan</div><div class="val" style="font-size:19px">${tampil ? 'Ditampilkan' : 'Disembunyikan'}</div><div class="meta">Piutang sertifikasi pada laporan</div></div>
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Rekapitulasi Piutang Sertifikasi per Pegawai</h3>
        <div class="sub">Total piutang, sudah dibayar &amp; sisa per nama pegawai · pembayaran beberapa tagihan dapat digabung satu transaksi</div></div>
        <div class="toolbar"><input placeholder="Cari nama pegawai…" data-table-search="#tblRekapPl" style="width:190px"></div></div>
      ${rekap.length ? `<div class="table-scroll short"><table id="tblRekapPl"><thead><tr>
        <th>Nama Pegawai</th><th class="num">Jumlah Tagihan</th><th class="num">Total Piutang</th><th class="num">Sudah Dibayar</th><th class="num">Sisa Piutang</th><th class="num">Belum Lunas</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rekap.map((g2, gi) => `<tr>
        <td class="t-strong">${esc(g2.nama)}</td>
        <td class="num">${g2.jumlah}</td>
        <td class="num">${rupiah(g2.nominal)}</td>
        <td class="num" style="color:var(--green)">${rupiah(g2.dibayar)}</td>
        <td class="num t-strong" style="color:${g2.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(g2.sisa)}</td>
        <td class="num">${g2.aktif}</td>
        <td class="right nowrap">
          ${g2.aktif > 0 && c.can('piutang_lain', 'edit') ? `<button class="btn btn-sm btn-green" data-open="mPlGab${gi}">${ui.icon('coins')}Bayar Gabungan</button>` : ''}
        </td></tr>
        ${g2.aktif > 0 ? modalsRekap('mPlGab' + gi, {
      title: 'Pembayaran Gabungan — ' + g2.nama,
      body: `<form method="post" action="${c.base}/piutang-lain/bayar-gabungan" id="fpg${gi}">
        <input type="hidden" name="nama" value="${esc(g2.nama)}">
        <div class="alert info">${ui.icon('info')}<div>Pembayaran dialokasikan otomatis ke tagihan <b>tertua</b> lebih dulu (FIFO). Total sisa piutang pegawai ini <b>${rupiah(g2.sisa)}</b> dari ${g2.aktif} tagihan.</div></div>
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
        <div class="table-wrap mt-1"><table><thead><tr><th>Tanggal</th><th class="num">Nominal</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th></tr></thead><tbody>
        ${g2.items.map(x => `<tr><td class="nowrap">${tglID(x.tanggal)}</td><td class="num">${rupiah(x.nominal)}</td>
          <td class="num">${rupiah(x.dibayar)}</td><td class="num t-strong">${rupiah(x.sisa)}</td></tr>`).join('')}
        </tbody></table></div>
      </form>`,
      footer: `<button class="btn" data-close="mPlGab${gi}">Batal</button><button class="btn btn-green" form="fpg${gi}">${ui.icon('check')}Catat Pembayaran Gabungan</button>`
    }) : ''}`).join('')}
      </tbody><tfoot><tr><td>TOTAL</td><td class="num">${rekap.reduce((a, x) => a + x.jumlah, 0)}</td>
        <td class="num">${rupiah(totalNominal)}</td><td class="num">${rupiah(totalDibayar)}</td>
        <td class="num">${rupiah(totalSisa)}</td><td class="num">${belum}</td><td></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada rekap piutang sertifikasi', 'Tagihan yang dicatat akan direkap otomatis per pegawai di sini.')}
      ${modalsRekap.html()}
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Piutang Lain-lain (Sertifikasi)</h3><div class="sub">Pengelolaan tagihan sertifikasi pegawai — sama seperti piutang SPP &amp; piutang pegawai</div></div>
        <div class="toolbar">
          <input placeholder="Cari nama pegawai…" data-table-search="#tblPiutangLain" style="width:190px" title="Pencarian cepat nama peserta">
          <a class="btn btn-sm" href="${c.base}/piutang-lain/template">${ui.icon('download')}Template Excel</a>
          ${c.can('piutang_lain', 'create') ? `<button class="btn btn-sm" data-open="mImportPl">${ui.icon('upload')}Import Data Excel</button>` : ''}
          ${c.can('piutang_lain', 'create') ? ui.openModalBtn('mAddPl', 'Tambah Tagihan', 'btn btn-sm btn-primary') : ''}
        </div></div>
      ${rows.length ? `<div class="table-scroll tall"><table id="tblPiutangLain"><thead><tr>
        <th>Nama Pegawai</th><th>Tanggal Utang</th><th class="num">Nominal Utang</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th><th>Keterangan</th><th class="right">Aksi</th>
      </tr></thead><tbody>
        ${rows.map(p => `<tr>
          <td class="t-strong">${esc(p.nama)}</td>
          <td class="nowrap">${tglID(p.tanggal)}</td>
          <td class="num t-strong">${rupiah(p.nominal)}</td>
          <td class="num" style="color:var(--green)">${p.dibayar ? rupiah(p.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${p.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(p.sisa)}</td>
          <td>${p.status === 'lunas' ? ui.badge('Lunas', 'green') : p.dibayar > 0 ? ui.badge('Cicilan Berjalan', 'amber') : ui.badge('Belum Lunas', 'red')}</td>
          <td class="t-sub">${esc(p.keterangan || '-')}</td>
          <td class="right nowrap">
            ${p.sisa > 0 && c.can('piutang_lain', 'edit') ? `<button class="btn btn-sm btn-green" data-open="mPlBayar${p.id}" ${bukuss.length ? '' : 'disabled'}>${ui.icon('plus')}Bayar</button>` : ''}
            <button class="btn btn-sm" data-open="mPlRiwayat${p.id}" title="Riwayat pembayaran">${ui.icon('clock')}</button>
            <a class="btn btn-sm" target="_blank" href="${c.base}/piutang-lain/${p.id}/bukti" title="Cetak bukti pencairan/penambahan piutang">${ui.icon('printer')}Bukti</a>
            ${c.can('piutang_lain', 'edit') ? `<a class="btn btn-sm btn-icon" href="${c.base}/piutang-lain?edit=${p.id}" title="Edit">${ui.icon('edit')}</a>` : ''}
            ${c.can('piutang_lain', 'delete') ? `<form method="post" action="${c.base}/piutang-lain/delete" style="display:inline" data-confirm="Hapus piutang ${esc(p.nama)} beserta riwayat pembayarannya?"><input type="hidden" name="id" value="${p.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${p.sisa > 0 ? late('mPlBayar' + p.id, {
          title: 'Bayar Piutang Sertifikasi',
          body: `<div class="alert info">${ui.icon('info')}<div>Pilih apakah pembayaran ini <b>masuk ke BKU</b> (menambah kas) atau <b>tidak masuk BKU</b> (hanya mengurangi piutang).</div></div>
            <div class="kv mb-2"><dt>Nama</dt><dd>${esc(p.nama)}</dd><dt>Nominal Utang</dt><dd>${rupiah(p.nominal)}</dd>
              <dt>Sudah dibayar</dt><dd>${rupiah(p.dibayar)}</dd><dt>Sisa</dt><dd style="color:var(--red)">${rupiah(p.sisa)}</dd></div>
            <form method="post" action="${c.base}/piutang-lain/bayar" id="fp${p.id}">
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
                  <input type="checkbox" name="masuk_bku" value="1" data-pl-bku ${bukuss.length ? 'checked' : 'disabled'}>
                  <i></i>
                </label>
              </div>
              <div data-pl-bku-wrap style="${bukuss.length ? '' : 'display:none'}">
                <div class="field"><label>BKU Penerima</label><select name="bku_id">${bukuss.map(b => `<option value="${b.id}" ${p.bku_id === b.id ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select></div>
              </div>
            </form>`,
          footer: `<button class="btn" data-close="mPlBayar${p.id}">Batal</button><button class="btn btn-green" form="fp${p.id}">${ui.icon('check')}Catat Pembayaran</button>`
        }) : ''}
          ${(() => {
          const list = bayar[p.id] || [];
          let run = Number(p.nominal || 0);
          const hist = list.map(b => { run -= Number(b.nominal || 0); return { ...b, sisa: Math.max(0, run) }; });
          const editModals = list.map(b => late('mPlBayarEd' + b.id, {
            title: 'Edit Riwayat Pembayaran — ' + p.nama,
            body: `<div class="alert info">${ui.icon('info')}<div>Perubahan nominal/tanggal akan <b>menghitung ulang</b> sisa dan status tagihan otomatis.</div></div>
              <div class="kv mb-2"><dt>Nominal tagihan</dt><dd>${rupiah(p.nominal)}</dd>
                <dt>Total pembayaran saat ini</dt><dd>${rupiah(p.dibayar)}</dd>
                <dt>Sisa tagihan</dt><dd>${rupiah(p.sisa)}</dd></div>
              <form method="post" action="${c.base}/piutang-lain/bayar/save" id="fpe${b.id}">
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
            footer: `<button class="btn" data-close="mPlBayarEd${b.id}">Batal</button>
              <button class="btn btn-primary" form="fpe${b.id}">${ui.icon('save')}Simpan Perubahan</button>`
          })).join('');
          return editModals + late('mPlRiwayat' + p.id, {
            title: 'Riwayat Pembayaran — ' + p.nama,
            wide: true,
            body: list.length ? `<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th class="num">Nominal Cicilan</th><th class="num">Sisa Piutang</th><th>Metode</th><th>Keterangan</th><th class="right">Aksi</th></tr></thead><tbody>
              <tr style="background:#FFF8F2"><td colspan="2" class="t-strong">Nominal utang awal</td><td class="num t-strong">${rupiah(p.nominal)}</td><td colspan="3"></td></tr>
              ${hist.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td><td class="num" style="color:var(--green)">${rupiah(b.nominal)}</td>
                <td class="num t-strong">${rupiah(b.sisa)}</td>
                <td>${b.metode === 'transfer' ? ui.badge('Transfer', 'blue') : ui.badge('Tunai', 'gray')}</td>
                <td class="t-sub">${esc(b.keterangan || '-')}</td>
                <td class="right nowrap">
                  <a class="btn btn-sm" target="_blank" href="${c.base}/piutang-lain/bayar/${b.id}/bukti" title="Cetak bukti pelunasan/cicilan">${ui.icon('printer')}Bukti</a>
                  ${c.can('piutang_lain', 'edit') ? `<button class="btn btn-sm btn-icon" data-open="mPlBayarEd${b.id}" title="Edit riwayat pembayaran">${ui.icon('edit')}</button>` : ''}
                  ${c.can('piutang_lain', 'delete') ? `<form method="post" action="${c.base}/piutang-lain/bayar/delete" style="display:inline"
                    data-confirm="Hapus riwayat pembayaran ${rupiah(b.nominal)} tanggal ${tglID(b.tanggal)}? Sisa tagihan akan dihitung ulang.">
                    <input type="hidden" name="id" value="${b.id}">
                    <button class="btn btn-sm btn-danger" title="Hapus riwayat pembayaran">${ui.icon('trash')}</button></form>` : ''}
                </td></tr>`).join('')}
            </tbody><tfoot><tr><td class="center">TOTAL</td><td class="num">${rupiah(p.dibayar)}</td><td class="num">${rupiah(p.sisa)}</td><td colspan="3"></td></tr></tfoot></table></div>`
              : ui.emptyState('Belum ada pembayaran', 'Catat pembayaran pertama melalui tombol Bayar.'),
            footer: `<button class="btn" data-close="mPlRiwayat${p.id}">Tutup</button>`
          });
        })()}`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada piutang sertifikasi', 'Tambahkan tagihan manual atau import dari Excel/CSV.')}
      ${late.html()}
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Tampilan pada Laporan Rekonsiliasi Kas</h3><div class="sub">Sakelar untuk menampilkan / menyembunyikan piutang sertifikasi</div></div></div>
      <form method="post" action="${c.base}/piutang-lain/toggle-neraca" class="toggle-form" style="border:0;padding:0">
        <div>
          <div class="t-strong">Tampilkan Piutang Sertifikasi di Rekonsiliasi Kas</div>
          <div class="t-sub">${tampil ? 'Saat ini tampil pada rekonsiliasi kas, halaman aset, dan laporan posisi keuangan' : 'Saat ini disembunyikan dari rekonsiliasi kas & laporan'}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" name="tampil" value="1" ${tampil ? 'checked' : ''} ${c.can('piutang_lain', 'edit') ? '' : 'disabled'} onchange="this.form.submit()">
          <i></i>
        </label>
        <noscript><button class="btn btn-sm">Simpan</button></noscript>
      </form>
      <div class="alert info mt-2">${ui.icon('info')}<div>Sisa piutang sertifikasi ${rupiah(totalSisa)} ${tampil ? 'ikut dihitung' : 'tidak dihitung'} sebagai aset piutang pada Rekonsiliasi Kas.</div></div>
    </div>

    ${c.can('piutang_lain', 'create') ? ui.modal('mAddPl', {
      title: editR ? 'Edit Piutang Sertifikasi' : 'Tambah Piutang Sertifikasi',
      body: form(editR),
      footer: `<button class="btn" data-close="mAddPl">Batal</button><button class="btn btn-primary" form="fPl">${ui.icon('save')}Simpan</button>`
    }).replace('class="modal" id="mAddPl"', `class="modal ${editR ? 'show' : ''}" id="mAddPl"`) : ''}
    ${c.can('piutang_lain', 'create') ? ui.modal('mImportPl', {
      title: 'Import Piutang Sertifikasi (Excel / CSV)',
      wide: true,
      body: `<form method="post" action="${c.base}/piutang-lain/import" id="fImportPl">
        <div class="alert info">${ui.icon('info')}<div><b>Format kolom:</b> <code>[TANGGAL] | [NAMA] | [TAGIHAN / NOMINAL] | [KETERANGAN]</code> (opsional kolom <b>MASUK</b> untuk pembayaran).<br>
          Import bersifat historis: pembayaran tercatat sebagai riwayat tanpa membuat transaksi kas.</div></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="file_pl_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="file_pl_b64" data-max="10">
          <div class="hint" id="file_pl_b64-info">Baris judul dicari otomatis. Bisa juga memakai template Excel di atas.</div></div>
      </form>`,
      footer: `<a class="btn" href="${c.base}/piutang-lain/template">${ui.icon('download')}Template</a>
        <button class="btn" data-close="mImportPl">Batal</button>
        <button class="btn btn-primary" form="fImportPl">${ui.icon('upload')}Import Sekarang</button>`
    }) : ''}`;

    page(req, res, { title: 'Piutang Lain-lain (Sertifikasi)', sub: 'Tagihan & pembayaran sertifikasi pegawai', active: 'piutang_lain', content });
  });

  /* ================= cetak bukti piutang sertifikasi ================= */
  function buktiPl({ c, req, jenis, p, nominal, tanggal, noRef, extra = [] }) {
    const isCair = jenis === 'cair';
    const body = `<div class="kwit-box">
        <div class="head"><span>BUKTI ${isCair ? 'PENCAIRAN / PENAMBAHAN PIUTANG SERTIFIKASI' : 'PELUNASAN / CICILAN PIUTANG SERTIFIKASI'}</span><span>No. ${esc(noRef)}</span></div>
        <div class="kwit-body">
          <div class="k">Nama Pegawai</div><div class="v">${esc(p.nama || '-')}</div>
          <div class="k">Jenis</div><div class="v">Piutang ${esc(p.kategori || 'Sertifikasi')}</div>
          ${extra.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('')}
          <div class="k">Uang sejumlah</div><div class="v" style="font-style:italic">${esc(lib.terbilangRupiah(nominal))}</div>
          <div class="k">Tanggal</div><div class="v">${tglID(tanggal)}</div>
          <div class="k">Jumlah</div><div class="v kwit-amt">${rupiah(nominal)}</div>
        </div>
      </div>
      <div class="sign-grid sign-3">
        <div class="sig"><div>Mengetahui,</div><div style="font-weight:600">Kepala ${esc(c.settings.sekolah_nama || 'Sekolah')}</div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_kepala || '............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_kepala || '.....................')}</div></div>
        <div class="sig"><div>${esc(c.settings.print_tempat || 'Cikoneng')}, ${tglID(tanggal)}<br>Bendahara</div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_bendahara || '............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_bendahara || '.....................')}</div></div>
        <div class="sig"><div>${isCair ? 'Penerima' : 'Penyetor'}</div><div class="space"></div>
          <div class="nm">${esc(p.nama || '-')}</div></div>
      </div>
      <p class="kwit-foot">Kwitansi ini sah sebagai bukti ${isCair ? 'pencairan' : 'pelunasan'} piutang sertifikasi pegawai.</p>`;
    return ui.kwitansiPage({
      settings: c.settings, base: c.base,
      title: isCair ? 'Bukti Pencairan Piutang Sertifikasi' : 'Bukti Pelunasan Piutang Sertifikasi',
      body, backHref: '/piutang-lain', backLabel: 'Kembali ke Piutang Sertifikasi',
      orient: printcfg.orient(req, dbm, 'kwitansi_trx'), selfPath: req ? req.url : ''
    });
  }

  get('/piutang-lain/:id/bukti', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'view')) return;
    const c = ctx(req);
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(req.params.id);
    if (!p) return res.notFound();
    const sisa = dbm.piutangLainSisa(p.id);
    res.html(buktiPl({
      c, req, jenis: 'cair', p, nominal: Number(p.nominal || 0), tanggal: p.tanggal || todayISO(),
      noRef: `PS/${String(p.id).padStart(5, '0')}`,
      extra: [['Tanggal Tagihan', tglID(p.tanggal)], ['Keterangan', esc(p.keterangan || '-')], ['Sisa Tagihan', rupiah(sisa)]]
    }));
  });

  get('/piutang-lain/bayar/:id/bukti', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'view')) return;
    const c = ctx(req);
    const b = db.prepare('SELECT * FROM piutang_lain_bayar WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(b.piutang_id) || {};
    const sisa = dbm.piutangLainSisa(b.piutang_id);
    res.html(buktiPl({
      c, req, jenis: 'lunas', p, nominal: Number(b.nominal || 0), tanggal: b.tanggal || todayISO(),
      noRef: `PLS/${String(b.id).padStart(5, '0')}`,
      extra: [['Nominal Tagihan Awal', rupiah(p.nominal)], ['Metode', b.metode === 'transfer' ? 'Transfer Bank' : 'Tunai'],
      ['Keterangan', esc(b.keterangan || '-')], ['Sisa Setelah Pembayaran', rupiah(sisa)]]
    }));
  });

  /* ================= simpan ================= */
  post('/piutang-lain/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, 'piutang_lain', isEdit ? 'edit' : 'create')) return;
    const back = req.BASE + '/piutang-lain';
    const nama = String(req.body.nama || '').trim();
    const tanggal = req.body.tanggal || todayISO();
    const nominal = lib.parseMoney(req.body.nominal);
    if (!nama || !(nominal > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Nama dan nominal tagihan wajib diisi.'));
    const bkuId = req.body.bku_id ? Number(req.body.bku_id) : null;
    const ket = String(req.body.keterangan || '').trim();
    if (isEdit) {
      const old = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(req.body.id);
      if (!old) return res.redirect(back + '?err=' + encodeURIComponent('Data tagihan tidak ditemukan.'));
      const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lain_bayar WHERE piutang_id=?').get(old.id).s || 0);
      if (nominal < dibayar) return res.redirect(back + '?err=' + encodeURIComponent(`Nominal tagihan tidak boleh lebih kecil dari total pembayaran (${rupiah(dibayar)}).`));
      const sisa = Math.max(0, nominal - dibayar);
      db.prepare('UPDATE piutang_lain SET nama=?,tanggal=?,nominal=?,keterangan=?,bku_id=?,status=?,tanggal_bayar=? WHERE id=?')
        .run(nama, tanggal, nominal, ket, bkuId, sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (old.tanggal_bayar || todayISO()) : null, old.id);
      dbm.logAudit(req.user, 'EDIT', 'piutang_lain', `Edit piutang sertifikasi ${nama} (${rupiah(nominal)})`);
      return res.redirect(back + '?ok=' + encodeURIComponent('Tagihan sertifikasi diperbarui.'));
    }
    const taRow = dbm.taOf(req) || dbm.activeTahun();
    db.prepare('INSERT INTO piutang_lain (nama,kategori,tanggal,nominal,keterangan,status,tanggal_bayar,bku_id,created_at,tahun_ajaran_id) VALUES (?,?,?,?,?,\'belum\',NULL,?,?,?)')
      .run(nama, KATEGORI, tanggal, nominal, ket, bkuId, nowStamp(), taRow ? taRow.id : null);
    dbm.logAudit(req.user, 'TAMBAH', 'piutang_lain', `Tambah piutang sertifikasi ${nama} (${rupiah(nominal)})`);
    res.redirect(back + '?ok=' + encodeURIComponent('Tagihan sertifikasi disimpan.'));
  });

  /* ================= pembayaran ================= */
  post('/piutang-lain/bayar', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'edit')) return;
    const back = req.BASE + '/piutang-lain';
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(req.body.id);
    if (!p) return res.redirect(back + '?err=' + encodeURIComponent('Tagihan tidak ditemukan.'));
    const masukBku = String(req.body.masuk_bku || '') === '1';
    const b = masukBku ? db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.bku_id) : null;
    if (masukBku && !b) return res.redirect(back + '?err=' + encodeURIComponent('BKU penerima wajib dipilih untuk pembayaran yang masuk BKU.'));
    if (masukBku && b.status !== 'aktif') return res.redirect(back + '?err=' + encodeURIComponent('BKU "' + b.nama + '" sudah ditutup.'));
    const tanggal = req.body.tanggal_bayar || todayISO();
    if (masukBku) {
      const lockErr = dbm.periodeLockError(b.id, tanggal);
      if (lockErr) return res.redirect(back + '?err=' + encodeURIComponent(lockErr));
    }
    const sisa = dbm.piutangLainSisa(p.id);
    if (sisa <= 0) return res.redirect(back + '?err=' + encodeURIComponent('Tagihan ini sudah lunas.'));
    const nominal = lib.parseMoney(req.body.nominal);
    if (!(nominal > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Nominal pembayaran harus lebih dari 0.'));
    if (nominal > sisa) return res.redirect(back + '?err=' + encodeURIComponent(`Nominal melebihi sisa tagihan (${rupiah(sisa)}).`));

    const sisaAkhir = sisa - nominal;
    let noBukti = '';
    db.transaction(() => {
      let trxId = null;
      if (masukBku) {
        const coa = db.prepare("SELECT * FROM coa WHERE kode='4.1.03'").get() || db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' LIMIT 1").get();
        const ym = String(tanggal).slice(0, 7).replace('-', '');
        const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(b.id).c + 1;
        noBukti = `${b.kode || 'BKU'}/M/${ym}/${String(seq).padStart(3, '0')}`;
        const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,'posted',?,?)`).run(b.id, tanggal, 'pemasukan', req.body.metode === 'transfer' ? 'transfer' : 'tunai',
          noBukti, coa ? coa.id : null, nominal, `Pembayaran piutang sertifikasi — ${p.nama}`, p.nama, req.user.id, nowStamp());
        trxId = Number(info.lastInsertRowid);
      }
      db.prepare(`INSERT INTO piutang_lain_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(p.id, tanggal, nominal, req.body.metode === 'transfer' ? 'transfer' : 'tunai',
        masukBku ? b.id : null, trxId, String(req.body.keterangan || '').trim(), nowStamp(), req.user.id);
      db.prepare('UPDATE piutang_lain SET status=?, tanggal_bayar=?, bku_id=? WHERE id=?')
        .run(sisaAkhir <= 0 ? 'lunas' : 'belum', sisaAkhir <= 0 ? tanggal : null, masukBku ? b.id : p.bku_id, p.id);
    })();
    dbm.logAudit(req.user, 'EDIT', 'piutang_lain',
      `Pembayaran piutang sertifikasi ${p.nama} ${rupiah(nominal)} ${masukBku ? '→ masuk ' + b.nama + ' (' + noBukti + ')' : '(tidak masuk BKU)'}; sisa ${rupiah(sisaAkhir)}`);
    res.redirect(back + '?ok=' + encodeURIComponent(
      sisaAkhir <= 0
        ? `Tagihan sertifikasi ${p.nama} lunas.${masukBku ? ` Pemasukan ${rupiah(nominal)} tercatat di ${b.nama}.` : ' Pembayaran tidak dibukukan ke BKU.'}`
        : `Pembayaran ${rupiah(nominal)} dicatat. Sisa tagihan ${p.nama} menjadi ${rupiah(sisaAkhir)}.`));
  });

  /* ================= riwayat pembayaran sertifikasi: edit & hapus ================= */
  function refreshPiutangLain(pid) {
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(pid);
    if (!p) return null;
    const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lain_bayar WHERE piutang_id=?').get(pid).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - dibayar);
    const last = db.prepare('SELECT tanggal FROM piutang_lain_bayar WHERE piutang_id=? ORDER BY tanggal DESC, id DESC LIMIT 1').get(pid);
    db.prepare('UPDATE piutang_lain SET status=?, tanggal_bayar=? WHERE id=?')
      .run(sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (last ? last.tanggal : todayISO()) : null, pid);
    return { dibayar, sisa };
  }

  post('/piutang-lain/bayar/save', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'edit')) return;
    const back = req.BASE + '/piutang-lain';
    const b = db.prepare('SELECT * FROM piutang_lain_bayar WHERE id=?').get(req.body.id);
    if (!b) return res.redirect(back + '?err=' + encodeURIComponent('Riwayat pembayaran tidak ditemukan.'));
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(b.piutang_id);
    const nominal = lib.parseMoney(req.body.nominal);
    const tanggal = String(req.body.tanggal || '').slice(0, 10) || b.tanggal;
    if (!(nominal > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Nominal pembayaran harus lebih dari 0.'));
    const lain = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_lain_bayar WHERE piutang_id=? AND id<>?').get(b.piutang_id, b.id).s || 0);
    const totalUtang = Number(p ? p.nominal || 0 : 0);
    if (nominal > Math.max(0, totalUtang - lain)) {
      return res.redirect(back + '?err=' + encodeURIComponent(`Nominal pembayaran melebihi sisa tagihan (${rupiah(Math.max(0, totalUtang - lain))}).`));
    }
    db.transaction(() => {
      db.prepare('UPDATE piutang_lain_bayar SET tanggal=?,nominal=?,metode=?,keterangan=? WHERE id=?')
        .run(tanggal, nominal, req.body.metode === 'transfer' ? 'transfer' : 'tunai', String(req.body.keterangan || '').trim(), b.id);
      refreshPiutangLain(b.piutang_id);
    })();
    dbm.logAudit(req.user, 'EDIT', 'piutang_lain',
      `Ubah riwayat pembayaran sertifikasi ${p ? p.nama : '#' + b.piutang_id}: ${rupiah(b.nominal)} → ${rupiah(nominal)} (${tglID(tanggal)})`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Riwayat pembayaran ${p ? p.nama : ''} diperbarui menjadi ${rupiah(nominal)}.`));
  });

  post('/piutang-lain/bayar/delete', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'delete')) return;
    const back = req.BASE + '/piutang-lain';
    const b = db.prepare('SELECT * FROM piutang_lain_bayar WHERE id=?').get(req.body.id);
    if (!b) return res.redirect(back + '?err=' + encodeURIComponent('Riwayat pembayaran tidak ditemukan.'));
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(b.piutang_id);
    let trxDihapus = false;
    if (b.transaksi_id) {
      const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(b.transaksi_id);
      if (t && !dbm.periodeLockError(t.bku_id, t.tanggal, 'edit')) {
        dbm.trashAdd('transaksi', t, { user: req.user, alasan: 'Hapus riwayat pembayaran piutang sertifikasi', label: `${t.no_bukti} — ${t.uraian}` });
        db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
        trxDihapus = true;
      }
    }
    dbm.trashAdd('piutang_lain_bayar', b, {
      user: req.user,
      label: `Pembayaran piutang sertifikasi ${p ? p.nama : '#' + b.piutang_id} ${rupiah(b.nominal)} (${tglID(b.tanggal)})`
    });
    db.transaction(() => {
      db.prepare('DELETE FROM piutang_lain_bayar WHERE id=?').run(b.id);
      refreshPiutangLain(b.piutang_id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'piutang_lain',
      `Hapus riwayat pembayaran sertifikasi ${p ? p.nama : '#' + b.piutang_id} ${rupiah(b.nominal)} (${tglID(b.tanggal)})${trxDihapus ? ' + transaksi BKU terkait' : ''}`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Riwayat pembayaran ${rupiah(b.nominal)} dihapus. Sisa tagihan dihitung ulang${trxDihapus ? ' dan transaksi BKU terkait ikut dihapus' : ''}.`));
  });

  /* ================= pembayaran gabungan (konsolidasi beberapa tagihan) ================= */
  post('/piutang-lain/bayar-gabungan', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'edit')) return;
    const back = req.BASE + '/piutang-lain';
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.redirect(back + '?err=' + encodeURIComponent('Nama pegawai tidak dikenali.'));
    const tanggal = req.body.tanggal_bayar || todayISO();
    const nominal = lib.parseMoney(req.body.nominal);
    if (!(nominal > 0)) return res.redirect(back + '?err=' + encodeURIComponent('Nominal pembayaran harus lebih dari 0.'));

    const list = db.prepare(`SELECT p.id, p.nominal,
        COALESCE((SELECT SUM(x.nominal) FROM piutang_lain_bayar x WHERE x.piutang_id=p.id),0) dibayar
      FROM piutang_lain p WHERE lower(trim(p.nama))=lower(trim(?)) AND p.status='belum'
      ORDER BY COALESCE(p.tanggal,''), p.id`).all(nama)
      .map(p => ({ ...p, sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }))
      .filter(p => p.sisa > 0);
    if (!list.length) return res.redirect(back + '?err=' + encodeURIComponent(`Tidak ada tagihan sertifikasi belum lunas untuk ${nama}.`));
    const totalSisa = list.reduce((a, p) => a + p.sisa, 0);
    if (nominal > totalSisa) return res.redirect(back + '?err=' + encodeURIComponent(`Nominal ${rupiah(nominal)} melebihi total sisa ${rupiah(totalSisa)}.`));

    const masukBku = String(req.body.masuk_bku || '') === '1';
    const bku = masukBku ? db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.bku_id) : null;
    if (masukBku && !bku) return res.redirect(back + '?err=' + encodeURIComponent('BKU penerima wajib dipilih.'));
    if (masukBku && bku.status !== 'aktif') return res.redirect(back + '?err=' + encodeURIComponent('BKU "' + bku.nama + '" sudah ditutup.'));
    if (masukBku) {
      const lock = dbm.periodeLockError(bku.id, tanggal);
      if (lock) return res.redirect(back + '?err=' + encodeURIComponent(lock));
    }

    let sisaBayar = nominal, kena = 0, lunas = 0, trxId = null, noBukti = '';
    db.transaction(() => {
      if (masukBku) {
        const coa = db.prepare("SELECT * FROM coa WHERE kode='4.1.03'").get() || db.prepare("SELECT * FROM coa WHERE kategori='pendapatan' LIMIT 1").get();
        const ym = String(tanggal).slice(0, 7).replace('-', '');
        const seq = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(bku.id).c + 1;
        noBukti = `${bku.kode || 'BKU'}/M/${ym}/${String(seq).padStart(3, '0')}`;
        const info = db.prepare(`INSERT INTO transaksi (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
          VALUES (?,?,'pemasukan',?,?,?,?,?,?,'posted',?,?)`).run(bku.id, tanggal, req.body.metode === 'transfer' ? 'transfer' : 'tunai',
          noBukti, coa ? coa.id : null, nominal, `Pembayaran gabungan piutang sertifikasi — ${nama}`, nama, req.user.id, nowStamp());
        trxId = Number(info.lastInsertRowid);
      }
      const ins = db.prepare(`INSERT INTO piutang_lain_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const p of list) {
        if (sisaBayar <= 0) break;
        const bayar = Math.min(p.sisa, sisaBayar);
        sisaBayar -= bayar; kena++;
        ins.run(p.id, tanggal, bayar, req.body.metode === 'transfer' ? 'transfer' : 'tunai', masukBku ? bku.id : null, trxId,
          String(req.body.keterangan || 'Pembayaran gabungan'), nowStamp(), req.user.id);
        const masih = dbm.piutangLainSisa(p.id);
        db.prepare('UPDATE piutang_lain SET status=?, tanggal_bayar=?, bku_id=? WHERE id=?')
          .run(masih <= 0 ? 'lunas' : 'belum', masih <= 0 ? tanggal : null, masukBku ? bku.id : null, p.id);
        if (masih <= 0) lunas++;
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'piutang_lain',
      `Pembayaran gabungan piutang sertifikasi ${nama} ${rupiah(nominal)} untuk ${kena} tagihan (${lunas} lunas${masukBku ? ', masuk ' + bku.nama + ' ' + noBukti : ', tanpa BKU'})`);
    res.redirect(back + '?ok=' + encodeURIComponent(
      `Pembayaran gabungan ${rupiah(nominal)} dicatat untuk ${nama} (${kena} tagihan, ${lunas} otomatis LUNAS).${masukBku ? ` Pemasukan tercatat di ${bku.nama}.` : ' Tidak masuk BKU.'}`));
  });

  post('/piutang-lain/delete', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'delete')) return;
    const p = db.prepare('SELECT * FROM piutang_lain WHERE id=?').get(req.body.id);
    if (p) {
      const anak = db.prepare('SELECT * FROM piutang_lain_bayar WHERE piutang_id=?').all(p.id);
      dbm.trashAdd('piutang_lain', p, { user: req.user, label: `Piutang ${p.kategori} ${p.nama} ${rupiah(p.nominal)}`, extra: { children: [{ tabel: 'piutang_lain_bayar', rows: anak }] } });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM piutang_lain_bayar WHERE piutang_id=?').run(req.body.id);
      db.prepare('DELETE FROM piutang_lain WHERE id=?').run(req.body.id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'piutang_lain', `Hapus piutang sertifikasi ${p ? p.nama : req.body.id}`);
    res.redirect(req.BASE + '/piutang-lain?ok=' + encodeURIComponent('Tagihan sertifikasi dihapus.'));
  });

  /* ================= sakelar neraca ================= */
  post('/piutang-lain/toggle-neraca', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'edit')) return;
    const val = req.body.tampil ? '1' : '0';
    dbm.setSetting('tampil_piutang_sertifikasi', val);
    dbm.logAudit(req.user, 'EDIT', 'piutang_lain', `Piutang sertifikasi ${val === '1' ? 'ditampilkan' : 'disembunyikan'} pada neraca`);
    res.redirect(req.BASE + '/piutang-lain?ok=' + encodeURIComponent(`Piutang sertifikasi ${val === '1' ? 'ditampilkan pada' : 'disembunyikan dari'} neraca.`));
  });

  /* ================= template & import ================= */
  get('/piutang-lain/template', (req, res) => {
    guard(req, res, 'piutang_lain', 'view');
    const rows = [
      [{ v: 'TANGGAL', bold: true }, { v: 'NAMA', bold: true }, { v: 'TAGIHAN', bold: true }, { v: 'KETERANGAN', bold: true }],
      ['2026-01-15', 'Contoh Nama Pegawai', 350000, 'Sertifikasi kompetensi — baris contoh, silakan dihapus'],
      ['2026-02-10', 'Contoh Nama Pegawai 2', 250000, 'Sertifikasi tahap 2'],
      []
    ];
    const buf = lib.xlsxBuffer('Piutang Sertifikasi', rows, [14, 30, 16, 44]);
    res.file(buf, 'template-import-piutang-sertifikasi.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  post('/piutang-lain/import', (req, res) => {
    if (!guard(req, res, 'piutang_lain', 'create')) return;
    const back = req.BASE + '/piutang-lain';
    const buf = decodeFile(req.body.file_b64);
    if (!buf) return res.redirect(back + '?err=' + encodeURIComponent('Pilih berkas Excel/CSV terlebih dahulu.'));
    let sheets;
    try { sheets = readAny(buf); } catch (e) { return res.redirect(back + '?err=' + encodeURIComponent('Gagal membaca berkas: ' + e.message)); }

    let header = null, sheet = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(up);
        const map = {};
        labels.forEach((t, idx) => {
          if (map.nama === undefined && /^NAMA|PESERTA|SISWA/.test(t)) map.nama = idx;
          if (map.tanggal === undefined && /TANGGAL|TGL/.test(t)) map.tanggal = idx;
          if (map.nominal === undefined && /NOMINAL|TAGIHAN|JUMLAH|KELUAR/.test(t)) map.nominal = idx;
          if (map.masuk === undefined && /MASUK|BAYAR|DIBAYAR/.test(t)) map.masuk = idx;
          if (map.keterangan === undefined && /KETERANGAN|CATATAN|URAIAN/.test(t)) map.keterangan = idx;
        });
        if (map.nama !== undefined && map.nominal !== undefined) { header = { row: i, map }; sheet = sh; break; }
      }
      if (header) break;
    }
    if (!header) return res.redirect(back + '?err=' + encodeURIComponent('Header tidak dikenali. Gunakan kolom NAMA | TAGIHAN (TANGGAL & KETERANGAN opsional).'));

    const namaFile = String(req.body.file_name || 'import-sertifikasi').slice(-80);
    let baru = 0, bayarN = 0, dilewati = 0;
    const ambil = (cells, key) => header.map[key] === undefined ? null : cells[header.map[key]];
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
        const dup = db.prepare('SELECT id FROM piutang_lain WHERE lower(nama)=lower(?) AND tanggal=? AND nominal=?').get(nama, tanggal, nominal);
        let pid = dup ? dup.id : null;
        if (!dup) {
          const taRow = dbm.taOf(req) || dbm.activeTahun();
          const info = db.prepare("INSERT INTO piutang_lain (nama,kategori,tanggal,nominal,keterangan,status,tanggal_bayar,bku_id,created_at,tahun_ajaran_id) VALUES (?,?,?,?,?,'belum',NULL,NULL,?,?)")
            .run(nama, KATEGORI, tanggal, nominal, ket || `Import ${namaFile}`, nowStamp(), taRow ? taRow.id : null);
          pid = Number(info.lastInsertRowid);
          baru++;
        } else { dilewati++; }
        const masuk = header.map.masuk === undefined ? 0 : X.parseMoneyCell(ambil(cells, 'masuk'));
        if (pid && masuk > 0) {
          const sisa = dbm.piutangLainSisa(pid);
          const bayar = Math.min(sisa, masuk);
          if (bayar > 0) {
            db.prepare(`INSERT INTO piutang_lain_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
              VALUES (?,?,?,'tunai',NULL,NULL,?,?,?)`).run(pid, tanggal, bayar, `Import ${namaFile}`, nowStamp(), req.user.id);
            const masih = dbm.piutangLainSisa(pid);
            db.prepare('UPDATE piutang_lain SET status=?, tanggal_bayar=? WHERE id=?')
              .run(masih <= 0 ? 'lunas' : 'belum', masih <= 0 ? tanggal : null, pid);
            bayarN++;
          }
        }
      }
    })();
    dbm.logAudit(req.user, 'IMPORT', 'piutang_lain',
      `Import piutang sertifikasi ${namaFile}: ${baru} tagihan baru, ${bayarN} pembayaran, ${dilewati} dilewati`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Import selesai: ${baru} tagihan baru, ${bayarN} pembayaran tercatat, ${dilewati} baris dilewati.`));
  });
};
