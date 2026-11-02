'use strict';
const X = require('../xlsx-read');
const impcache = require('../impcache');

/* Master Data Pegawai + import Excel */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, xlsxBuffer } = lib;
  const TIPE_LABEL = { guru: 'Guru', tu: 'Tata Usaha (TU)' };

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }

  get('/pegawai', (req, res) => {
    guard(req, res, 'pegawai', 'view');
    const c = ctx(req);
    const rows = dbm.pegawaiList(false);
    const editId = req.query.get('edit');
    const ed = editId ? db.prepare('SELECT * FROM pegawai WHERE id=?').get(editId) : null;
    const editable = c.can('pegawai', 'edit');
    const late = modalCollector();

    const form = (p, mid) => `<form method="post" action="${c.base}/pegawai/save" id="f${mid}">
      <input type="hidden" name="id" value="${p ? p.id : ''}">
      <div class="field"><label>Nama Lengkap</label><input name="nama" value="${esc(p ? p.nama : '')}" required placeholder="Nama pegawai"></div>
      <div class="row2">
        <div class="field"><label>Jabatan / Tugas</label><input name="jabatan" value="${esc(p ? p.jabatan : '')}" placeholder="Guru Matematika / Staf TU"></div>
        <div class="field"><label>Kategori</label><select name="tipe">
          <option value="guru" ${!p || p.tipe === 'guru' ? 'selected' : ''}>Guru</option>
          <option value="tu" ${p && p.tipe === 'tu' ? 'selected' : ''}>Tata Usaha (TU)</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Tanggal Lahir</label><input type="date" name="tanggal_lahir" value="${esc(p && p.tanggal_lahir ? String(p.tanggal_lahir).slice(0, 10) : '')}">
          <div class="hint">Dipakai untuk verifikasi <b>Portal Piutang Pegawai</b> &amp; <b>Portal Slip Gaji</b>.</div></div>
        <div class="field"><label>Nomor WhatsApp Aktif</label><input name="whatsapp" inputmode="tel" value="${esc(p ? (p.whatsapp || '') : '')}" placeholder="08xxxxxxxxxx">
          <div class="hint">Tujuan pengiriman <b>kode OTP 4 digit</b> pada portal publik.</div></div>
      </div>
      <div class="row2">
        <div class="field"><label>No. Rekening</label><input name="no_rekening" value="${esc(p ? p.no_rekening : '')}" placeholder="Nomor rekening bank"></div>
        <div class="field"><label>Nama Pemilik Rekening</label><input name="pemilik_rekening" value="${esc(p ? p.pemilik_rekening : '')}" placeholder="Sesuai buku tabungan"></div>
      </div>
      <label class="check"><input type="checkbox" name="aktif" value="1" ${!p || p.aktif ? 'checked' : ''}> Pegawai aktif (tampil sebagai pilihan piutang & payroll)</label>
    </form>`;

    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Master Data Pegawai</h3><div class="sub">Nama, jabatan/tugas, rekening &amp; pemilik rekening — otomatis menjadi pilihan pada modul Piutang Pegawai</div></div>
        <div class="toolbar">
          <input placeholder="Cari nama / jabatan" data-table-search="#tblPegawai" style="width:200px">
          <a class="btn btn-sm" href="${c.base}/pegawai/template">${ui.icon('download')}Template Excel</a>
          ${editable ? `<button class="btn btn-sm" data-open="mImport">${ui.icon('upload')}Import Excel</button>` : ''}
          ${editable ? ui.openModalBtn('mAdd', 'Tambah Pegawai') : ''}
        </div></div>
      ${rows.length ? `<div class="table-wrap"><table id="tblPegawai"><thead><tr><th>Nama</th><th>Jabatan / Tugas</th><th>Kategori</th><th>Tgl Lahir</th><th>WhatsApp</th><th>No. Rekening</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${rows.map(p => `<tr>
          <td class="t-strong">${esc(p.nama)}</td>
          <td>${esc(p.jabatan || '-')}</td>
          <td>${p.tipe === 'tu' ? ui.badge('TU', 'blue') : ui.badge('Guru', 'orange')}</td>
          <td class="nowrap">${p.tanggal_lahir ? tglID(String(p.tanggal_lahir).slice(0, 10)) : '<span class="badge red plain">belum diisi</span>'}</td>
          <td class="mono">${p.whatsapp ? esc(p.whatsapp) : '<span class="badge amber plain">belum ada</span>'}</td>
          <td class="mono">${esc(p.no_rekening || '-')}<div class="t-sub">${esc(p.pemilik_rekening || '')}</div></td>
          <td>${p.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</td>
          <td class="right nowrap">
            ${editable ? `<a class="btn btn-sm btn-icon" href="${c.base}/pegawai?edit=${p.id}" title="Edit">${ui.icon('edit')}</a>
            <form method="post" action="${c.base}/pegawai/delete" style="display:inline" data-confirm="Hapus pegawai ${esc(p.nama)}?"><input type="hidden" name="id" value="${p.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada data pegawai', 'Tambahkan pegawai satu per satu atau import dari Excel.')}
      ${late.html()}
      <p class="help mt-2">Nama pegawai pada master ini dipakai sebagai pilihan pada <b>Piutang Pegawai</b>, <b>Leger Honor</b>, dan <b>Slip Gaji</b>.</p>
    </div>
    ${ui.modal('mAdd', {
      title: 'Tambah Pegawai', body: form(null, 'mAdd'),
      footer: `<button class="btn" data-close="mAdd">Batal</button><button class="btn btn-primary" form="fmAdd">Simpan</button>`
    })}
    ${ed ? ui.modal('mEdit', {
      title: 'Edit Pegawai', body: form(ed, 'mEdit'),
      footer: `<button class="btn" data-close="mEdit">Batal</button><button class="btn btn-primary" form="fmEdit">Simpan</button>`
    }).replace('class="modal" id="mEdit"', 'class="modal show" id="mEdit"') : ''}
    ${editable ? ui.modal('mImport', {
      title: 'Import Data Pegawai (Excel / CSV)',
      wide: true,
      body: `<form method="post" action="${c.base}/pegawai/import" id="fImport">
        <div class="alert info">${ui.icon('info')}<div><b>Format kolom:</b> <code>NAMA | JABATAN/TUGAS | TIPE | NO REKENING | PEMILIK REKENING</code><br>
          Kolom <b>TIPE</b> berisi <code>guru</code> atau <code>tu</code>. Baris judul akan dicari otomatis. Gunakan tombol <b>Template Excel</b> untuk contoh format.</div></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="file_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="file_b64" data-max="10">
          <div class="hint" id="file_b64-info"></div></div>
      </form>`,
      footer: `<button class="btn" data-close="mImport">Batal</button><button class="btn btn-primary" form="fImport">${ui.icon('upload')}Import Sekarang</button>`
    }) : ''}`;
    const impTok = req.query.get('imp');
    const impData = impTok ? impcache.get(impTok) : null;
    const errBlock = impData && impData.kind === 'pegawai' ? ui.importErrorModal(impData.errors) : '';
    page(req, res, { title: 'Data Pegawai', sub: 'Master pegawai, jabatan & rekening untuk piutang dan payroll', active: 'pegawai', content: content + errBlock });
  });

  get('/pegawai/template', (req, res) => {
    guard(req, res, 'pegawai', 'view');
    const rows = [
      [{ v: 'TEMPLATE IMPORT DATA PEGAWAI', bold: true }],
      ['Isi baris di bawah ini lalu simpan sebagai .xlsx / .csv'],
      [],
      ['NAMA', 'JABATAN/TUGAS', 'TIPE', 'TANGGAL LAHIR', 'WHATSAPP', 'NO REKENING', 'PEMILIK REKENING'].map(v => ({ v, bold: true })),
      ['Budi Santoso, S.Pd.', 'Guru Matematika', 'guru', '1985-04-12', '081234567890', '1234567890', 'Budi Santoso'],
      ['Rina Wulandari, M.Pd.', 'Wakasek Kurikulum', 'guru', '1987-09-03', '081234567891', '1234567891', 'Rina Wulandari'],
      ['Ahmad Subekti', 'Staf Tata Usaha', 'tu', '1990-01-20', '081234567892', '1234567892', 'Ahmad Subekti']
    ];
    res.file(xlsxBuffer('Pegawai', rows, [30, 28, 10, 20, 26]), 'template-import-pegawai.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  post('/pegawai/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, 'pegawai', isEdit ? 'edit' : 'create')) return;
    const { id, nama, jabatan, tipe, no_rekening, pemilik_rekening, aktif } = req.body;
    const tanggalLahir = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.tanggal_lahir || '')) ? String(req.body.tanggal_lahir) : null;
    const whatsappRaw = String(req.body.whatsapp || '').replace(/[^\d+]/g, '');
    let whatsapp = whatsappRaw;
    if (whatsapp.startsWith('+')) whatsapp = whatsapp.slice(1);
    if (whatsapp.startsWith('0')) whatsapp = '62' + whatsapp.slice(1);
    if (!String(nama || '').trim()) return res.redirect(req.BASE + '/pegawai?err=' + encodeURIComponent('Nama pegawai wajib diisi.'));
    const tipeV = tipe === 'tu' ? 'tu' : 'guru';
    if (isEdit) {
      db.prepare('UPDATE pegawai SET nama=?,jabatan=?,tipe=?,no_rekening=?,pemilik_rekening=?,aktif=?,tanggal_lahir=?,whatsapp=? WHERE id=?')
        .run(String(nama).trim(), jabatan || '', tipeV, no_rekening || '', pemilik_rekening || '', aktif ? 1 : 0, tanggalLahir, whatsapp, id);
    } else {
      db.prepare('INSERT INTO pegawai (nama,jabatan,tipe,no_rekening,pemilik_rekening,aktif,created_at,tanggal_lahir,whatsapp) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(String(nama).trim(), jabatan || '', tipeV, no_rekening || '', pemilik_rekening || '', aktif ? 1 : 0, nowStamp(), tanggalLahir, whatsapp);
    }
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'pegawai', `${isEdit ? 'Edit' : 'Tambah'} pegawai ${nama}`);
    res.redirect(req.BASE + '/pegawai?ok=' + encodeURIComponent('Data pegawai disimpan.'));
  });

  post('/pegawai/delete', (req, res) => {
    if (!guard(req, res, 'pegawai', 'delete')) return;
    const p = db.prepare('SELECT * FROM pegawai WHERE id=?').get(req.body.id);
    db.prepare('DELETE FROM pegawai WHERE id=?').run(req.body.id);
    dbm.logAudit(req.user, 'HAPUS', 'pegawai', `Hapus pegawai ${p ? p.nama : req.body.id}`);
    res.redirect(req.BASE + '/pegawai?ok=' + encodeURIComponent('Pegawai dihapus.'));
  });

  post('/pegawai/import', (req, res) => {
    if (!guard(req, res, 'pegawai', 'create')) return;
    const back = req.BASE + '/pegawai';
    const raw = String(req.body.file_b64 || '');
    if (!raw) return res.redirect(back + '?err=' + encodeURIComponent('Pilih berkas Excel/CSV terlebih dahulu.'));
    const m = raw.match(/^data:([^;]*);base64,([\s\S]*)$/);
    const buf = Buffer.from(m ? m[2] : raw, 'base64');
    if (!buf.length) return res.redirect(back + '?err=' + encodeURIComponent('Berkas kosong atau gagal dibaca.'));
    let sheets;
    try { sheets = (buf[0] === 0x50 && buf[1] === 0x4b) ? X.readXlsx(buf) : X.readCsv(buf.toString('utf8')); }
    catch (e) { return res.redirect(back + '?err=' + encodeURIComponent('Gagal membaca berkas: ' + e.message)); }

    let header = null, sheet = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(cc => X.cellText(cc).toUpperCase());
        const iNama = labels.findIndex(t => /NAMA/.test(t) && !/PEMILIK|SEKOLAH/.test(t));
        const iJab = labels.findIndex(t => /JABATAN|TUGAS/.test(t));
        if (iNama >= 0 && iJab >= 0) {
          header = {
            row: i, iNama, iJab,
            iTipe: labels.findIndex(t => /TIPE|KATEGORI/.test(t)),
            iRek: labels.findIndex(t => /REKENING|REK\b/.test(t) && !/PEMILIK/.test(t)),
            iPemilik: labels.findIndex(t => /PEMILIK/.test(t)),
            iLahir: labels.findIndex(t => /TANGGAL LAHIR|TGL LAHIR|LAHIR/.test(t)),
            iWa: labels.findIndex(t => /WHATSAPP|WA\b|NO HP|TELEPON|HP/.test(t))
          };
          sheet = sh; break;
        }
      }
      if (header) break;
    }
    if (!header) return res.redirect(back + '?err=' + encodeURIComponent('Header kolom NAMA | JABATAN tidak ditemukan. Gunakan Template Excel yang disediakan.'));

    // ---- validasi baris-per-baris sebelum menyimpan ----
    const errors = [];
    const parsed = [];
    const seen = new Set();
    for (let i = header.row + 1; i < sheet.rows.length; i++) {
      const cells = sheet.rows[i] || [];
      if (!cells.length) continue;
      const nama = X.cellText(cells[header.iNama]).trim();
      const jabatan = X.cellText(cells[header.iJab]).trim();
      const tipeRaw = header.iTipe >= 0 ? X.cellText(cells[header.iTipe]).toLowerCase().trim() : '';
      const rek = header.iRek >= 0 ? X.cellText(cells[header.iRek]).trim() : '';
      const pemilik = header.iPemilik >= 0 ? X.cellText(cells[header.iPemilik]).trim() : '';
      const lahirRaw = header.iLahir >= 0 ? cells[header.iLahir] : null;
      const lahir = lahirRaw ? X.parseDateCell(lahirRaw) : null;
      let waRaw = header.iWa >= 0 ? X.cellText(cells[header.iWa]).replace(/[^\d+]/g, '') : '';
      if (waRaw.startsWith('+')) waRaw = waRaw.slice(1);
      if (waRaw.startsWith('0')) waRaw = '62' + waRaw.slice(1);
      if (!nama && !jabatan && !rek) continue;
      if (/^(NAMA|TEMPLATE|JABATAN)$/i.test(nama)) continue;
      const line = i + 1;
      const raw = [nama, jabatan, tipeRaw, rek, pemilik].join(' | ');
      if (!nama) { errors.push({ row: line, msg: 'Nama pegawai kosong.', raw }); continue; }
      if (tipeRaw && !/^(guru|tu|tata usaha|tatausaha|administrasi)$/.test(tipeRaw)) {
        errors.push({ row: line, msg: `Kategori "${tipeRaw}" tidak dikenal (gunakan guru / tu).`, raw }); continue;
      }
      if (seen.has(nama.toLowerCase())) { errors.push({ row: line, msg: `Nama ${nama} ganda di dalam berkas.`, raw }); continue; }
      seen.add(nama.toLowerCase());
      const tipe = /tu|tata|administr/.test(tipeRaw) ? 'tu' : 'guru';
      parsed.push({ nama, jabatan, tipe, rek, pemilik, lahir, wa: waRaw });
    }
    if (errors.length) {
      const token = impcache.put({ kind: 'pegawai', errors });
      return res.redirect(back + '?imp=' + token);
    }
    let baru = 0, update = 0;
    const lewat = 0;
    db.transaction(() => {
      for (const row of parsed) {
        const { nama, jabatan, tipe, rek, pemilik, lahir, wa } = row;
        const ex = db.prepare('SELECT * FROM pegawai WHERE lower(nama)=lower(?)').get(nama);
        if (ex) {
          db.prepare("UPDATE pegawai SET jabatan=?,tipe=?,no_rekening=COALESCE(NULLIF(?,''),no_rekening),pemilik_rekening=COALESCE(NULLIF(?,''),pemilik_rekening),tanggal_lahir=COALESCE(?,tanggal_lahir),whatsapp=COALESCE(NULLIF(?,''),whatsapp) WHERE id=?")
            .run(jabatan, tipe, rek, pemilik, lahir || null, wa || '', ex.id);
          update++;
        } else {
          db.prepare('INSERT INTO pegawai (nama,jabatan,tipe,no_rekening,pemilik_rekening,aktif,created_at,tanggal_lahir,whatsapp) VALUES (?,?,?,?,?,1,?,?,?)')
            .run(nama, jabatan, tipe, rek, pemilik, nowStamp(), lahir || null, wa || '');
          baru++;
        }
      }
    })();
    const namaFile = String(req.body.file_name || 'import').slice(-80);
    dbm.logAudit(req.user, 'IMPORT', 'pegawai', `Import pegawai ${namaFile}: ${baru} baru, ${update} diperbarui, ${lewat} dilewati`);
    res.redirect(back + '?ok=' + encodeURIComponent(`Import selesai: ${baru} pegawai baru, ${update} diperbarui${lewat ? `, ${lewat} baris dilewati` : ''}.`));
  });
};
