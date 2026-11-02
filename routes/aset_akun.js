'use strict';
/* Buku bantu transaksi akun aset riil: Pinjaman Kegiatan & Akun Aset Lainnya */
const X = require('../xlsx-read');
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp } = lib;

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }
  function loadAkun(id) {
    return db.prepare("SELECT * FROM aset WHERE id=? AND jenis IN ('pinjaman','lain')").get(id);
  }
  const backOf = akun => '/aset/akun/' + akun.id;

  /* ---------- halaman ledger ---------- */
  get('/aset/akun/:id', (req, res) => {
    guard(req, res, 'aset', 'view');
    const c = ctx(req);
    const akun = loadAkun(req.params.id);
    if (!akun) return res.notFound();
    const lg = dbm.asetLedger(akun.id);
    const editable = c.can('aset', 'edit');
    const isPinjam = akun.jenis === 'pinjaman';
    const late = modalCollector();
    const back = c.base + backOf(akun);
    const coaList = db.prepare('SELECT * FROM coa ORDER BY kategori, kode').all();
    const coaOpts = sel => `<option value="">— Tanpa kode rekening —</option>` + coaList.map(x =>
      `<option value="${x.id}" ${String(sel) === String(x.id) ? 'selected' : ''}>${esc(x.kode + ' · ' + x.nama)}</option>`).join('');
    const coaMap = {};
    for (const x of coaList) coaMap[x.id] = x.kode + ' ' + x.nama;

    const mutForm = (jenis, idForm) => `<form method="post" action="${back}/mutasi" id="${idForm}">
      <input type="hidden" name="jenis" value="${jenis}">
      <div class="alert ${jenis === 'masuk' ? 'ok' : 'warn'}" style="margin-bottom:14px">${ui.icon(jenis === 'masuk' ? 'up' : 'down')}
        <div><b>Transaksi ${jenis === 'masuk' ? 'Masuk / Debet' : 'Keluar / Kredit'}</b> — saldo akun langsung diperbarui dan ikut mengubah Total Aset Riil.</div></div>
      <div class="row2">
        <div class="field"><label>Tanggal</label><input type="date" name="tanggal" value="${todayISO()}" required></div>
        <div class="field"><label>Jenis Transaksi</label>
          <select name="metode"><option value="tunai">Tunai / Kas</option><option value="transfer">Transfer / Bank</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', '', 'required placeholder="0"')}</div>
        <div class="field"><label>No. Bukti (opsional)</label><input name="no_bukti" placeholder="Otomatis bila dikosongkan"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Kode Rekening (CoA)</label><select name="coa_id">${coaOpts('')}</select>
          <div class="hint">Opsional — dipakai untuk mengelompokkan transaksi akun ini per kode rekening.</div></div>
        <div class="field"><label>Nama Penyetor / Penerima</label><input name="nama_pihak" placeholder="Nama orang / unit / vendor"></div>
      </div>
      <div class="field"><label>Uraian / Keterangan</label><input name="keterangan" required placeholder="${isPinjam ? 'Contoh: pinjaman kegiatan renovasi lab' : 'Contoh: pembelian peralatan laboratorium'}"></div>
      <div class="row2">
        <div class="field"><label>Upload Bukti / Nota (maks 15 MB)</label>
          <input type="hidden" name="bukti_b64" id="bukti_${idForm}">
          <input type="file" accept="image/*,application/pdf" data-b64="bukti_${idForm}" data-max="15">
          <div class="hint" id="bukti_${idForm}-info">Opsional, gambar atau PDF.</div></div>
      </div>
      <div class="modal-foot" style="padding:16px 0 0;background:none;border-radius:0">
        <button class="btn" type="button" data-close="m${jenis === 'masuk' ? 'Masuk' : 'Keluar'}">Batal</button>
        <button class="btn ${jenis === 'masuk' ? 'btn-green' : 'btn-primary'}">${ui.icon('save')}Simpan Transaksi</button>
      </div>
    </form>`;

    const content = `<div class="between mb-2">
      <a class="btn btn-sm" href="${c.base}/aset">${ui.icon('x')}Kembali ke Aset Riil</a>
      <div class="toolbar">
        <a class="btn btn-sm" href="${back}/template">${ui.icon('download')}Template Excel</a>
        ${editable ? `<button class="btn btn-sm btn-primary" data-open="mImportMutasi">${ui.icon('upload')}Import Transaksi</button>` : ''}
        ${editable ? `<button class="btn btn-sm" data-open="mNamaAkun">${ui.icon('edit')}Edit Nama Akun</button>
        <button class="btn btn-sm btn-green" data-open="mMasuk">${ui.icon('plus')}Transaksi Masuk</button>
        <button class="btn btn-sm btn-primary" data-open="mKeluar">${ui.icon('plus')}Transaksi Keluar</button>` : ''}
      </div>
    </div>
    <div class="card mb-3">
      <div class="card-head"><div><h3>${esc(akun.nama)}</h3>
        <div class="sub">${isPinjam ? 'Pinjaman Kegiatan' : 'Akun Aset Lainnya'} · buku bantu transaksi &amp; saldo berjalan${akun.keterangan ? ' · ' + esc(akun.keterangan) : ''}</div></div>
        ${ui.badge(isPinjam ? 'Pinjaman Kegiatan' : 'Aset Lain', isPinjam ? 'orange' : 'blue')}</div>
      <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi ic-orange"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Saldo Awal</div><div class="val" style="font-size:18px">${rupiah(lg.awal)}</div></div>
        <div class="kpi ic-green"><div class="ico">${ui.icon('up')}</div><div class="lbl">Total Masuk (Debet)</div><div class="val" style="font-size:18px">${rupiah(lg.masuk)}</div></div>
        <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Total Keluar (Kredit)</div><div class="val" style="font-size:18px">${rupiah(lg.keluar)}</div></div>
        <div class="kpi ic-blue"><div class="ico">${ui.icon('bank')}</div><div class="lbl">Saldo Akhir</div><div class="val" style="font-size:18px">${rupiah(lg.saldo)}</div></div>
      </div>
      ${lg.rows.length ? `<div class="table-wrap"><table><thead><tr>
        <th style="width:44px">No</th><th style="width:110px">Tanggal</th><th>No. Bukti</th><th>Keterangan</th>
        <th class="num">Masuk / Debet</th><th class="num">Keluar / Kredit</th><th class="num">Saldo Berjalan</th><th class="right">Aksi</th>
      </tr></thead><tbody>
        <tr style="background:#FFF8F2"><td></td><td colspan="4" class="t-strong">SALDO AWAL</td><td class="num">—</td><td class="num t-strong">${rupiah(lg.awal)}</td><td></td></tr>
        ${lg.rows.map((m, i) => `<tr>
          <td class="num t-sub">${i + 1}</td>
          <td class="nowrap">${tglID(m.tanggal)}</td>
          <td class="mono t-sub nowrap">${esc(m.no_bukti || '-')}</td>
          <td><div class="t-strong">${esc(m.keterangan || '-')}</div>
            <div class="t-sub">${m.coa_id && coaMap[m.coa_id] ? `<b>${esc(coaMap[m.coa_id])}</b> · ` : ''}${esc(m.nama_pihak || '-')} · ${m.metode === 'transfer' ? 'Transfer' : 'Tunai'}
            ${m.bukti_url ? ` · <a href="${esc(m.bukti_url)}" target="_blank">Lihat bukti</a>` : ''}</div></td>
          <td class="num" style="color:var(--green)">${m.jenis === 'masuk' ? rupiah(m.nominal) : '—'}</td>
          <td class="num" style="color:var(--red)">${m.jenis === 'keluar' ? rupiah(m.nominal) : '—'}</td>
          <td class="num t-strong">${rupiah(m.saldo)}</td>
          <td class="right nowrap">
            ${editable ? `<button class="btn btn-sm btn-icon" data-open="mEdit${m.id}" title="Edit">${ui.icon('edit')}</button>
            <form method="post" action="${back}/mutasi/delete" style="display:inline" data-confirm="Hapus transaksi ${esc(m.no_bukti || '')} sebesar ${rupiah(m.nominal)}?">
              <input type="hidden" name="id" value="${m.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${editable ? late('mEdit' + m.id, {
      title: 'Edit Transaksi — ' + akun.nama,
      body: `<form method="post" action="${back}/mutasi/save" id="fm${m.id}">
            <input type="hidden" name="id" value="${m.id}">
            <div class="row2">
              <div class="field"><label>Tanggal</label><input type="date" name="tanggal" value="${esc(m.tanggal || todayISO())}" required></div>
              <div class="field"><label>Jenis</label><select name="jenis">
                <option value="masuk" ${m.jenis === 'masuk' ? 'selected' : ''}>Masuk / Debet</option>
                <option value="keluar" ${m.jenis === 'keluar' ? 'selected' : ''}>Keluar / Kredit</option></select></div>
            </div>
            <div class="row2">
              <div class="field"><label>Nominal (Rp)</label>${ui.moneyInput('nominal', m.nominal, 'required')}</div>
              <div class="field"><label>Jenis Transaksi</label><select name="metode">
                <option value="tunai" ${m.metode !== 'transfer' ? 'selected' : ''}>Tunai / Kas</option>
                <option value="transfer" ${m.metode === 'transfer' ? 'selected' : ''}>Transfer / Bank</option></select></div>
            </div>
            <div class="field"><label>No. Bukti</label><input name="no_bukti" value="${esc(m.no_bukti || '')}"></div>
            <div class="field"><label>Kode Rekening (CoA)</label><select name="coa_id">${coaOpts(m.coa_id)}</select></div>
            <div class="field"><label>Uraian</label><input name="keterangan" value="${esc(m.keterangan || '')}" required></div>
            <div class="field"><label>Nama Penyetor / Penerima</label><input name="nama_pihak" value="${esc(m.nama_pihak || '')}"></div>
            <div class="field"><label>Ganti Bukti / Nota (opsional)</label>
              <input type="hidden" name="bukti_b64" id="buktiEdit${m.id}">
              <input type="file" accept="image/*,application/pdf" data-b64="buktiEdit${m.id}" data-max="15">
              <div class="hint" id="buktiEdit${m.id}-info">${m.bukti_url ? 'Bukti sudah terlampir — unggah baru untuk mengganti.' : 'Belum ada bukti.'}</div></div>
          </form>`,
      footer: `<button class="btn" data-close="mEdit${m.id}">Batal</button><button class="btn btn-primary" form="fm${m.id}">Simpan Perubahan</button>`
    }) : ''}`).join('')}
      </tbody><tfoot><tr><td colspan="4">JUMLAH</td><td class="num">${rupiah(lg.masuk)}</td><td class="num">${rupiah(lg.keluar)}</td><td class="num">${rupiah(lg.saldo)}</td><td></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada transaksi pada akun ini', 'Gunakan tombol Transaksi Masuk / Transaksi Keluar untuk mencatat mutasi pertama.')}
      ${late.html()}
    </div>
    ${editable ? ui.modal('mImportMutasi', {
      title: 'Import Transaksi — ' + akun.nama,
      wide: true,
      body: `<form method="post" action="${back}/import" id="fImportMutasi">
        <div class="alert info">${ui.icon('info')}<div><b>Format kolom:</b> <code>TANGGAL | URAIAN | MASUK | KELUAR | NO BUKTI | KODE REKENING</code><br>
          <b>MASUK</b> menambah saldo akun, <b>KELUAR</b> mengurangi. Kolom NO BUKTI, KODE REKENING, NAMA PIHAK, dan METODE opsional.
          Gunakan <a href="${back}/template"><b>Template Excel</b></a> agar nama kolom sesuai.</div></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="mutasi_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="mutasi_b64" data-max="10">
          <div class="hint" id="mutasi_b64-info">Header baris dicari otomatis.</div></div>
        <label class="check"><input type="checkbox" name="set_saldo_awal" value="1"> Baris "SALDO AWAL" pada file dijadikan saldo awal akun</label>
      </form>`,
      footer: `<a class="btn" href="${back}/template">${ui.icon('download')}Template</a>
        <button class="btn" data-close="mImportMutasi">Batal</button>
        <button class="btn btn-primary" form="fImportMutasi">${ui.icon('upload')}Import Sekarang</button>`
    }) + ui.modal('mMasuk', { title: 'Transaksi Masuk — ' + akun.nama, wide: true, body: mutForm('masuk', 'fMasuk') })
      + ui.modal('mKeluar', { title: 'Transaksi Keluar — ' + akun.nama, wide: true, body: mutForm('keluar', 'fKeluar') })
      + ui.modal('mNamaAkun', {
        title: 'Edit Nama & Saldo Awal Akun',
        body: `<form method="post" action="${back}/ubah" id="fNamaAkun">
          <div class="field"><label>Nama Akun / Kegiatan</label><input name="nama" value="${esc(akun.nama)}" required
            placeholder="Contoh: Pinjaman Kegiatan Renovasi Lab"></div>
          <div class="field"><label>Saldo Awal (Rp)</label>${ui.moneyInput('saldo_awal', lg.awal)}</div>
          <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(akun.keterangan || '')}"></div>
          <div class="hint">Nama akun dapat diubah kapan saja sesuai nama kegiatan riil. Riwayat transaksi tetap utuh.</div>
        </form>`,
        footer: `<button class="btn" data-close="mNamaAkun">Batal</button><button class="btn btn-primary" form="fNamaAkun">${ui.icon('save')}Simpan</button>`
      }) : ''}`;
    page(req, res, {
      title: isPinjam ? 'Ledger Pinjaman Kegiatan' : 'Ledger Akun Aset',
      sub: akun.nama, active: 'aset', content
    });
  });

  /* ---------- tambah akun pinjaman baru ---------- */
  post('/aset/pinjaman/tambah', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Nama akun pinjaman wajib diisi.'));
    const saldo = lib.parseMoney(req.body.saldo);
    const taRow = dbm.taOf(req) || dbm.activeTahun();
    const info = db.prepare("INSERT INTO aset (nama,jenis,saldo,keterangan,tahun_ajaran_id) VALUES (?, 'pinjaman', ?, ?, ?)")
      .run(nama, saldo, String(req.body.keterangan || '').trim(), taRow ? taRow.id : null);
    dbm.logAudit(req.user, 'TAMBAH', 'aset', `Menambah akun pinjaman kegiatan "${nama}" dengan saldo awal ${rupiah(saldo)}`);
    res.redirect(req.BASE + '/aset/akun/' + info.lastInsertRowid + '?ok=' + encodeURIComponent('Akun pinjaman kegiatan dibuat.'));
  });

  /* ---------- ubah nama / saldo awal akun ---------- */
  post('/aset/akun/:id/ubah', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const akun = loadAkun(req.params.id);
    if (!akun) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Akun aset tidak ditemukan.'));
    const nama = String(req.body.nama || '').trim();
    if (!nama) return res.redirect(req.BASE + backOf(akun) + '?err=' + encodeURIComponent('Nama akun wajib diisi.'));
    const saldo = lib.parseMoney(req.body.saldo_awal);
    db.prepare('UPDATE aset SET nama=?,saldo=?,keterangan=? WHERE id=?')
      .run(nama, saldo, String(req.body.keterangan || '').trim(), akun.id);
    dbm.logAudit(req.user, 'EDIT', 'aset',
      `Mengubah akun aset "${akun.nama}" → "${nama}", saldo awal ${rupiah(akun.saldo)} → ${rupiah(saldo)}`);
    res.redirect(req.BASE + backOf(akun) + '?ok=' + encodeURIComponent('Nama & saldo awal akun diperbarui.'));
  });

  /* ---------- tambah transaksi ---------- */
  post('/aset/akun/:id/mutasi', async (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const akun = loadAkun(req.params.id);
    if (!akun) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Akun aset tidak ditemukan.'));
    const back = req.BASE + backOf(akun);
    const nominal = lib.parseMoney(req.body.nominal);
    const ket = String(req.body.keterangan || '').trim();
    const tanggal = req.body.tanggal || todayISO();
    const jenis = req.body.jenis === 'masuk' ? 'masuk' : 'keluar';
    if (!(nominal > 0) || !ket) return res.redirect(back + '?err=' + encodeURIComponent('Nominal (> 0) dan uraian wajib diisi.'));

    let buktiUrl = null;
    if (req.body.bukti_b64) {
      try {
        const m = String(req.body.bukti_b64).match(/^data:([^;]+);base64,/);
        const ext = m && m[1] === 'application/pdf' ? 'pdf' : (m && (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg')) || 'png';
        buktiUrl = await uploadMedia(req.body.bukti_b64, `aset-${akun.id}-${Date.now()}.${ext}`);
      } catch (e) {
        return res.redirect(back + '?err=' + encodeURIComponent('Gagal mengunggah bukti: ' + e.message));
      }
    }
    const ym = String(tanggal).slice(0, 7).replace('-', '');
    const seq = db.prepare('SELECT COUNT(*) c FROM pinjaman_mutasi WHERE aset_id=?').get(akun.id).c + 1;
    const noBukti = String(req.body.no_bukti || '').trim() || `AS/${akun.id}/${ym}/${String(seq).padStart(3, '0')}`;
    db.prepare(`INSERT INTO pinjaman_mutasi (aset_id,tanggal,keterangan,jenis,nominal,created_at,created_by,no_bukti,nama_pihak,bukti_url,metode,coa_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(akun.id, tanggal, ket, jenis, nominal, nowStamp(), req.user.id, noBukti,
        String(req.body.nama_pihak || '').trim(), buktiUrl, req.body.metode === 'transfer' ? 'transfer' : 'tunai',
        req.body.coa_id ? Number(req.body.coa_id) : null);
    dbm.logAudit(req.user, 'TAMBAH', 'aset',
      `Transaksi ${jenis} ${rupiah(nominal)} pada akun ${akun.nama} (${noBukti}) — ${ket}`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Transaksi ${jenis === 'masuk' ? 'masuk' : 'keluar'} ${rupiah(nominal)} tersimpan.`));
  });

  /* ---------- edit transaksi ---------- */
  post('/aset/akun/mutasi/save', async (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const m = db.prepare('SELECT * FROM pinjaman_mutasi WHERE id=?').get(req.body.id);
    const akun = m ? loadAkun(m.aset_id) : null;
    if (!m || !akun) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Transaksi aset tidak ditemukan.'));
    const back = req.BASE + backOf(akun);
    const nominal = lib.parseMoney(req.body.nominal);
    const ket = String(req.body.keterangan || '').trim();
    if (!(nominal > 0) || !ket) return res.redirect(back + '?err=' + encodeURIComponent('Nominal (> 0) dan uraian wajib diisi.'));
    let buktiUrl = m.bukti_url;
    if (req.body.bukti_b64) {
      try {
        const mm = String(req.body.bukti_b64).match(/^data:([^;]+);base64,/);
        const ext = mm && mm[1] === 'application/pdf' ? 'pdf' : (mm && (mm[1].split('/')[1] || 'png').replace('jpeg', 'jpg')) || 'png';
        buktiUrl = await uploadMedia(req.body.bukti_b64, `aset-${akun.id}-${Date.now()}.${ext}`);
      } catch (e) {
        return res.redirect(back + '?err=' + encodeURIComponent('Gagal mengunggah bukti: ' + e.message));
      }
    }
    db.prepare(`UPDATE pinjaman_mutasi SET tanggal=?,keterangan=?,jenis=?,nominal=?,no_bukti=?,nama_pihak=?,bukti_url=?,metode=?,coa_id=?,created_at=COALESCE(created_at,?) WHERE id=?`)
      .run(req.body.tanggal || m.tanggal, ket, req.body.jenis === 'masuk' ? 'masuk' : 'keluar', nominal,
        String(req.body.no_bukti || '').trim() || m.no_bukti, String(req.body.nama_pihak || '').trim(), buktiUrl,
        req.body.metode === 'transfer' ? 'transfer' : 'tunai',
        req.body.coa_id ? Number(req.body.coa_id) : null, nowStamp(), m.id);
    dbm.logAudit(req.user, 'EDIT', 'aset',
      `Edit transaksi aset ${akun.nama}: ${m.jenis} ${rupiah(m.nominal)} → ${req.body.jenis} ${rupiah(nominal)} (${ket})`);
    res.redirect(back + '?ok=' + encodeURIComponent('Transaksi diperbarui.'));
  });

  /* ---------- hapus transaksi ---------- */
  post('/aset/akun/mutasi/delete', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const m = db.prepare('SELECT * FROM pinjaman_mutasi WHERE id=?').get(req.body.id);
    const akun = m ? loadAkun(m.aset_id) : null;
    if (!m || !akun) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Transaksi aset tidak ditemukan.'));
    dbm.trashAdd('pinjaman_mutasi', m, { user: req.user, label: `Transaksi aset ${akun.nama}: ${m.jenis} ${rupiah(m.nominal)}` });
    db.prepare('DELETE FROM pinjaman_mutasi WHERE id=?').run(m.id);
    dbm.logAudit(req.user, 'HAPUS', 'aset',
      `Hapus transaksi aset ${akun.nama}: ${m.jenis} ${rupiah(m.nominal)} (${m.keterangan || ''})`);
    res.redirect(req.BASE + backOf(akun) + '?ok=' + encodeURIComponent('Transaksi aset dihapus.'));
  });

  /* ---------- template excel mutasi akun ---------- */
  get('/aset/akun/:id/template', (req, res) => {
    guard(req, res, 'aset', 'view');
    const akun = loadAkun(req.params.id);
    if (!akun) return res.notFound();
    const rows = [
      [{ v: 'TANGGAL', bold: true }, { v: 'URAIAN', bold: true }, { v: 'MASUK', bold: true }, { v: 'KELUAR', bold: true },
        { v: 'NO BUKTI', bold: true }, { v: 'KODE REKENING', bold: true }, { v: 'NAMA PIHAK', bold: true }, { v: 'METODE', bold: true }],
      ['2026-07-05', 'Contoh: penerimaan pinjaman kegiatan', 2500000, '', 'AS/001/202607/001', '4.1.03', 'Koperasi Sekolah', 'transfer'],
      ['2026-07-20', 'Contoh: pengembalian sebagian pinjaman', '', 500000, 'AS/001/202607/002', '9.1.04', 'Bendahara', 'tunai'],
      []
    ];
    const buf = lib.xlsxBuffer('Mutasi ' + String(akun.nama).slice(0, 20), rows, [14, 40, 14, 14, 22, 18, 24, 12]);
    res.file(buf, `template-mutasi-${String(akun.nama).replace(/[^\w]+/g, '-').toLowerCase()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  /* ---------- import transaksi akun aset ---------- */
  post('/aset/akun/:id/import', (req, res) => {
    if (!guard(req, res, 'aset', 'edit')) return;
    const akun = loadAkun(req.params.id);
    if (!akun) return res.redirect(req.BASE + '/aset?err=' + encodeURIComponent('Akun aset tidak ditemukan.'));
    const back = req.BASE + backOf(akun);
    const raw = String(req.body.file_b64 || '');
    const buf = raw ? Buffer.from((raw.match(/^data:[^;]*;base64,/) ? raw.split(',').pop() : raw), 'base64') : null;
    if (!buf || !buf.length) return res.redirect(back + '?err=' + encodeURIComponent('Pilih berkas Excel/CSV terlebih dahulu.'));
    let sheets;
    try { sheets = (buf[0] === 0x50 && buf[1] === 0x4b) ? X.readXlsx(buf) : X.readCsv(buf.toString('utf8')); }
    catch (e) { return res.redirect(back + '?err=' + encodeURIComponent('Gagal membaca berkas: ' + e.message)); }

    const up = c => X.cellText(c).toUpperCase().replace(/\s+/g, ' ').trim();
    let header = null, sheet = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(up);
        const map = {};
        labels.forEach((t, idx) => {
          if (map.tanggal === undefined && /TANGGAL|TGL/.test(t)) map.tanggal = idx;
          if (map.uraian === undefined && /URAIAN|KETERANGAN|DESKRIPSI/.test(t)) map.uraian = idx;
          if (map.masuk === undefined && /MASUK|DEBET|DEBIT/.test(t)) map.masuk = idx;
          if (map.keluar === undefined && /KELUAR|KREDIT/.test(t)) map.keluar = idx;
          if (map.no_bukti === undefined && /NO\.? ?BUKTI|BUKTI/.test(t) && !/upload|file/.test(t)) map.no_bukti = idx;
          if (map.coa === undefined && /KODE ?REKENING|COA/.test(t)) map.coa = idx;
          if (map.nama_pihak === undefined && /NAMA ?(PIHAK|PENYETOR|PENERIMA)|PIHAK/.test(t)) map.nama_pihak = idx;
          if (map.metode === undefined && /METODE|TUNAI\/TRANSFER|JENIS TRANSAKSI/.test(t)) map.metode = idx;
        });
        if ((map.tanggal !== undefined || map.uraian !== undefined) && (map.masuk !== undefined || map.keluar !== undefined)) {
          header = { row: i, map }; sheet = sh; break;
        }
      }
      if (header) break;
    }
    if (!header) return res.redirect(back + '?err=' + encodeURIComponent('Header tidak dikenali. Gunakan template: TANGGAL | URAIAN | MASUK | KELUAR (+ NO BUKTI, KODE REKENING).'));

    const coaByKode = {};
    for (const x of db.prepare('SELECT * FROM coa').all()) coaByKode[String(x.kode).trim()] = x.id;
    const ambil = (cells, key) => header.map[key] === undefined ? null : cells[header.map[key]];
    let masuk = 0, keluar = 0, dilewati = 0, saldoAwal = null;
    const setSaldo = !!req.body.set_saldo_awal;

    db.transaction(() => {
      for (let i = header.row + 1; i < sheet.rows.length; i++) {
        const cells = sheet.rows[i] || [];
        if (!cells.length) continue;
        const teks = cells.map(up).join(' ');
        const uraian = X.cellText(ambil(cells, 'uraian')).trim();
        if (!uraian && !cells.some(Boolean)) continue;
        if (/^SALDO AWAL/.test(uraian) || /SALDO AWAL/.test(teks) && !X.cellText(ambil(cells, 'masuk')) && !X.cellText(ambil(cells, 'keluar'))) {
          const v = X.parseMoneyCell(ambil(cells, 'masuk')) || X.parseMoneyCell(ambil(cells, 'keluar')) || X.parseMoneyCell(cells[cells.length - 1]);
          if (v) { saldoAwal = v; }
          continue;
        }
        if (/JUMLAH|TOTAL|TANDA TANGAN/.test(teks)) continue;
        const mNom = X.parseMoneyCell(ambil(cells, 'masuk'));
        const kNom = X.parseMoneyCell(ambil(cells, 'keluar'));
        if (!uraian || (!mNom && !kNom)) { dilewati++; continue; }
        const jenis = mNom ? 'masuk' : 'keluar';
        const nominal = mNom || kNom;
        const tanggal = X.parseDateCell(ambil(cells, 'tanggal')) || todayISO();
        const kode = String(X.cellText(ambil(cells, 'coa')) || '').trim();
        const coaId = coaByKode[kode] || null;
        const metode = /transfer|bank/i.test(X.cellText(ambil(cells, 'metode'))) ? 'transfer' : 'tunai';
        const noBukti = String(X.cellText(ambil(cells, 'no_bukti')) || '').trim();
        const pihak = String(X.cellText(ambil(cells, 'nama_pihak')) || '').trim();
        const ym = String(tanggal).slice(0, 7).replace('-', '');
        const seq = db.prepare('SELECT COUNT(*) c FROM pinjaman_mutasi WHERE aset_id=?').get(akun.id).c + 1;
        db.prepare(`INSERT INTO pinjaman_mutasi (aset_id,tanggal,keterangan,jenis,nominal,created_at,created_by,no_bukti,nama_pihak,metode,coa_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(akun.id, tanggal, uraian, jenis, nominal, nowStamp(), req.user.id,
            noBukti || `AS/${akun.id}/${ym}/${String(seq).padStart(3, '0')}`, pihak, metode, coaId);
        if (jenis === 'masuk') masuk++; else keluar++;
      }
      if (setSaldo && saldoAwal !== null) db.prepare('UPDATE aset SET saldo=? WHERE id=?').run(saldoAwal, akun.id);
    })();
    dbm.logAudit(req.user, 'IMPORT', 'aset',
      `Import ${masuk + keluar} transaksi (${masuk} masuk / ${keluar} keluar) pada akun ${akun.nama}${setSaldo && saldoAwal !== null ? `, saldo awal ${rupiah(saldoAwal)}` : ''}`);
    res.redirect(back + '?ok=' + encodeURIComponent(
      `Import selesai: ${masuk} transaksi masuk, ${keluar} transaksi keluar${dilewati ? `, ${dilewati} baris dilewati` : ''}${setSaldo && saldoAwal !== null ? `, saldo awal ${rupiah(saldoAwal)}` : ''}.`));
  });

  /* ---------- kompatibilitas tautan lama ---------- */
  get('/aset/pinjaman/:id', (req, res) => res.redirect(req.BASE + '/aset/akun/' + encodeURIComponent(req.params.id)));
};
