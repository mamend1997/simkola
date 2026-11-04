'use strict';
/* Modul Akademik: Program Keahlian, Data Kelas, Data Siswa, Mutasi Kelas, Siswa Non-Aktif */
const X = require('../xlsx-read');
const impcache = require('../impcache');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, xlsxBuffer, num } = lib;
  const JK_LABEL = { L: 'Laki-laki', P: 'Perempuan' };
  const STATUS_OPTS = ['aktif', 'nonaktif', 'lulus', 'pindah', 'do'];

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }
  function statusBadge(st) {
    const s = dbm.SISWA_STATUS[st] || [st, 'gray'];
    return ui.badge(s[0], s[1]);
  }
  function readSheet(b64) {
    const raw = String(b64 || '');
    if (!raw) throw new Error('Pilih berkas Excel/CSV terlebih dahulu.');
    const m = raw.match(/^data:([^;]*);base64,([\s\S]*)$/);
    const buf = Buffer.from(m ? m[2] : raw, 'base64');
    if (!buf.length) throw new Error('Berkas kosong atau gagal dibaca.');
    return (buf[0] === 0x50 && buf[1] === 0x4b) ? X.readXlsx(buf) : X.readCsv(buf.toString('utf8'));
  }
  /** cari baris header pada semua sheet */
  function findHeader(sheets) {
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const labels = (sh.rows[i] || []).map(c => X.cellText(c).toUpperCase());
        const iNama = labels.findIndex(t => /^NAMA/.test(t) && !/KELAS|WALI|PROGRAM/.test(t));
        const iNisn = labels.findIndex(t => /NISN|NIS\b/.test(t));
        if (iNama >= 0 && iNisn >= 0) {
          return {
            sheet: sh, row: i, iNama, iNisn,
            iJk: labels.findIndex(t => /JENIS\s*KELAMIN|JK|L\/P/.test(t)),
            iTgl: labels.findIndex(t => /TANGGAL\s*LAHIR|TGL\s*LAHIR/.test(t)),
            // kolom opsional: nomor HP / WhatsApp orang tua (dipakai pengingat tagihan)
            iHp: labels.findIndex(t => /(HP|HANDPHONE|WHATSAPP|WA|TELEPON|TELP|KONTAK).*(ORANG|WALI|ORTU)|(ORANG|WALI|ORTU).*(HP|WA|WHATSAPP|TELEPON|TELP)|NO\.?\s*(HP|WA)/.test(t))
          };
        }
      }
    }
    return null;
  }
  function normJk(v) {
    const s = String(v || '').trim().toUpperCase();
    if (/^(L|LK|LAKI|PRIA|M)/.test(s)) return 'L';
    if (/^(P|PR|PEREMPUAN|F|WANITA)/.test(s)) return 'P';
    return '';
  }
  function kelasOptions(taId, selected, all) {
    const list = dbm.kelasList(taId, all ? {} : { aktifOnly: true });
    return list.map(k => `<option value="${k.id}" ${String(k.id) === String(selected) ? 'selected' : ''}>${esc(k.nama)}${k.program_nama ? ' — ' + esc(k.program_nama) : ''}${k.aktif ? '' : ' (non-aktif)'}</option>`).join('');
  }
  function xlsxSend(res, name, sheet, rows, widths) {
    res.file(xlsxBuffer(sheet, rows, widths), name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /* ================= PROGRAM KEAHLIAN ================= */
  get('/program-keahlian', (req, res) => {
    guard(req, res, 'program', 'view');
    const c = ctx(req);
    const q = req.query.get('q') || '';
    const all = dbm.programList(false).filter(p => !q || (p.nama + ' ' + p.program_studi + ' ' + p.ketua).toLowerCase().includes(q.toLowerCase()));
    const editable = c.can('program', 'edit');
    const late = modalCollector();

    const form = (p, fid) => `<form method="post" action="${c.base}/program-keahlian/save" id="${fid}">
      <input type="hidden" name="id" value="${p ? p.id : ''}">
      <div class="field"><label>Program Keahlian</label><input name="nama" value="${esc(p ? p.nama : '')}" required placeholder="Akuntansi dan Keuangan Lembaga"></div>
      <div class="field"><label>Program Studi</label><input name="program_studi" value="${esc(p ? p.program_studi : '')}" placeholder="AKL"></div>
      <div class="field"><label>Ketua Program Studi</label><input name="ketua" value="${esc(p ? p.ketua : '')}" placeholder="Nama ketua program"></div>
      <label class="check"><input type="checkbox" name="aktif" value="1" ${!p || p.aktif ? 'checked' : ''}> Status Aktif</label>
    </form>`;

    const content = `<div class="card">
      <div class="card-head"><div><h3>Program Keahlian</h3><div class="sub">Daftar jurusan / konsentrasi keahlian sekolah</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/program-keahlian" class="flex" style="gap:6px">
            <input name="q" value="${esc(q)}" placeholder="Cari program / ketua" style="width:190px">
            <button class="btn btn-sm">${ui.icon('search')}Cari</button>
          </form>
          ${c.can('program', 'create') ? ui.openModalBtn('mAddProgram', 'Tambah Program Keahlian') : ''}
        </div></div>
      ${all.length ? `<div class="table-wrap sticky-head"><table><thead><tr>
        <th>Program Keahlian</th><th>Program Studi</th><th>Ketua Program Studi</th><th class="num">Kelas</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${all.map(p => {
      const nKelas = db.prepare('SELECT COUNT(*) c FROM kelas WHERE program_id=?').get(p.id).c;
      return `<tr><td class="t-strong">${esc(p.nama)}</td><td>${esc(p.program_studi || '-')}</td>
        <td>${esc(p.ketua || '-')}</td><td class="num">${nKelas}</td>
        <td>${p.aktif ? ui.badge('Aktif', 'green') : ui.badge('Tidak Aktif', 'gray')}</td>
        <td class="right nowrap">
          ${editable ? `<button class="btn btn-sm btn-icon" data-open="mEd${p.id}" title="Edit">${ui.icon('edit')}</button>` : ''}
          ${c.can('program', 'delete') ? `<form method="post" action="${c.base}/program-keahlian/delete" style="display:inline" data-confirm="Hapus program ${esc(p.nama)}?"><input type="hidden" name="id" value="${p.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>
        ${late('mEd' + p.id, {
        title: 'Edit Program Keahlian', body: form(p, 'fmEd' + p.id),
        footer: `<button class="btn" data-close="mEd${p.id}">Batal</button><button class="btn btn-primary" form="fmEd${p.id}">Simpan</button>`
      })}`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada program keahlian', 'Tambahkan program keahlian terlebih dahulu sebelum mengisi data kelas.')}
      ${late.html()}
    </div>
    ${ui.modal('mAddProgram', {
      title: 'Tambah Program Keahlian', body: form(null, 'fmAddProgram'),
      footer: `<button class="btn" data-close="mAddProgram">Batal</button><button class="btn btn-primary" form="fmAddProgram">Simpan</button>`
    })}`;
    page(req, res, { title: 'Program Keahlian', sub: 'Jurusan, program studi & ketua program', active: 'program', content });
  });

  post('/program-keahlian/save', (req, res) => {
    const isEdit = !!req.body.id;
    guard(req, res, 'program', isEdit ? 'edit' : 'create');
    const { id, nama, program_studi, ketua } = req.body;
    if (!String(nama || '').trim()) return res.redirect(req.BASE + '/program-keahlian?err=' + encodeURIComponent('Nama program keahlian wajib diisi.'));
    const aktif = req.body.aktif ? 1 : 0;
    if (isEdit) db.prepare('UPDATE program_keahlian SET nama=?,program_studi=?,ketua=?,aktif=? WHERE id=?')
      .run(nama.trim(), program_studi || '', ketua || '', aktif, id);
    else db.prepare('INSERT INTO program_keahlian (nama,program_studi,ketua,aktif,created_at) VALUES (?,?,?,?,?)')
      .run(nama.trim(), program_studi || '', ketua || '', aktif, nowStamp());
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'program', `${isEdit ? 'Edit' : 'Tambah'} program keahlian ${nama}`);
    res.redirect(req.BASE + '/program-keahlian?ok=' + encodeURIComponent('Program keahlian disimpan.'));
  });

  post('/program-keahlian/delete', (req, res) => {
    guard(req, res, 'program', 'delete');
    const n = db.prepare('SELECT COUNT(*) c FROM kelas WHERE program_id=?').get(req.body.id).c;
    if (n) return res.redirect(req.BASE + '/program-keahlian?err=' + encodeURIComponent('Program masih dipakai ' + n + ' kelas — pindahkan kelas terlebih dahulu.'));
    const p = db.prepare('SELECT * FROM program_keahlian WHERE id=?').get(req.body.id);
    db.prepare('DELETE FROM program_keahlian WHERE id=?').run(req.body.id);
    dbm.logAudit(req.user, 'HAPUS', 'program', `Hapus program ${p ? p.nama : req.body.id}`);
    res.redirect(req.BASE + '/program-keahlian?ok=' + encodeURIComponent('Program keahlian dihapus.'));
  });

  /* ================= DATA KELAS ================= */
  get('/kelas', (req, res) => {
    guard(req, res, 'kelas', 'view');
    const c = ctx(req);
    const taId = Number(req.query.get('ta') || c.taId || 0);
    const progId = req.query.get('program') || '';
    const q = (req.query.get('q') || '').toLowerCase();
    const rows = dbm.kelasList(taId || null, {})
      .filter(k => (!progId || String(k.program_id) === String(progId)) && (!q || (k.nama + ' ' + (k.wali_kelas || '')).toLowerCase().includes(q)));
    const progs = dbm.programList(false);
    const editable = c.can('kelas', 'edit');
    const late = modalCollector();
    const taList = dbm.allTahun();
    const taSel = taId || c.taId;

    // pilihan tingkat mengikuti PENGATURAN KELAS & TINGKAT sekolah (bukan daftar tetap X/XI/XII)
    const tingkatOptsFor = row => {
      const list = dbm.tingkatAktif().slice();
      const cur = row && row.tingkat ? String(row.tingkat) : '';
      if (cur && !list.includes(cur)) list.push(cur);
      return list.map(t => `<option value="${esc(t)}" ${cur === t ? 'selected' : ''}>${esc(dbm.tingkatLabel(t))} (${esc(t)})</option>`).join('');
    };

    const form = (k, fid) => `<form method="post" action="${c.base}/kelas/save" id="${fid}">
      <input type="hidden" name="id" value="${k ? k.id : ''}">
      <div class="row2">
        <div class="field"><label>Nama Kelas</label><input name="nama" value="${esc(k ? (k.nama_kelas || k.nama) : '')}" required placeholder="X AKL 1 / 7 Al-Farabi"></div>
        <div class="field"><label>Tingkat Kelas</label>
          <select name="tingkat">${tingkatOptsFor(k)}</select>
          <div class="hint">Ubah daftar tingkat di <a href="${c.base}/kelas/tingkat">Pengaturan Kelas &amp; Tingkat</a>.</div></div>
      </div>
      <div class="row2">
        <div class="field"><label>Wali Kelas</label><input name="wali_kelas" value="${esc(k ? k.wali_kelas : '')}" placeholder="Nama wali kelas"></div>
        <div class="field"><label>Program Keahlian</label><select name="program_id">
          <option value="">— Tanpa program —</option>
          ${progs.map(p => `<option value="${p.id}" ${k && String(k.program_id) === String(p.id) ? 'selected' : ''}>${esc(p.nama)}${p.program_studi ? ' (' + esc(p.program_studi) + ')' : ''}</option>`).join('')}
        </select></div>
      </div>
      <div class="field"><label>Tahun Pelajaran</label><select name="tahun_ajaran_id">
        ${taList.map(t => `<option value="${t.id}" ${String(k ? k.tahun_ajaran_id : taSel) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}
      </select></div>
      <label class="check"><input type="checkbox" name="aktif" value="1" ${!k || k.aktif ? 'checked' : ''}> Status Aktif</label>
    </form>`;

    const content = `<div class="card">
      <div class="card-head"><div><h3>Data Kelas</h3><div class="sub">${rows.length} kelas pada tahun pelajaran terpilih</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/kelas" class="flex flex-wrap" style="gap:6px">
            <select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taSel) === String(t.id) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select>
            <select name="program" data-autosubmit><option value="">Semua Program</option>${progs.map(p => `<option value="${p.id}" ${String(progId) === String(p.id) ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}</select>
            <input name="q" value="${esc(req.query.get('q') || '')}" placeholder="Cari kelas / wali" style="width:170px">
            <button class="btn btn-sm">${ui.icon('search')}Filter</button>
          </form>
          <a class="btn btn-sm" href="${c.base}/kelas/export?ta=${taSel}&program=${esc(progId)}">${ui.icon('download')}Export Excel</a>
          ${editable ? ui.openModalBtn('mAddKelas', 'Tambah Kelas') : ''}
        </div></div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr>
        <th>Nama Kelas</th><th>Tingkat</th><th>Program Keahlian</th><th>Wali Kelas</th><th class="num">Siswa Aktif</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(k => `<tr>
        <td class="t-strong">${esc(k.nama_kelas || k.nama)}</td><td>${esc(dbm.tingkatLabel(k.tingkat))}</td>
        <td>${esc(k.program_nama || '-')}</td><td>${esc(k.wali_kelas || '-')}</td>
        <td class="num">${k.jumlah_siswa}</td>
        <td>${k.aktif ? ui.badge('Aktif', 'green') : ui.badge('Tidak Aktif', 'gray')}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" href="${c.base}/siswa?kelas=${k.id}&ta=${k.tahun_ajaran_id}">${ui.icon('users')}Siswa</a>
          ${editable ? `<button class="btn btn-sm btn-icon" data-open="mEd${k.id}">${ui.icon('edit')}</button>` : ''}
          ${c.can('kelas', 'delete') ? `<form method="post" action="${c.base}/kelas/delete" style="display:inline" data-confirm="Hapus kelas ${esc(k.nama)}?"><input type="hidden" name="id" value="${k.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
        </td></tr>
        ${late('mEd' + k.id, {
        title: 'Edit Kelas', body: form(k, 'fmEd' + k.id),
        footer: `<button class="btn" data-close="mEd${k.id}">Batal</button><button class="btn btn-primary" form="fmEd${k.id}">Simpan</button>`
      })}`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada kelas', 'Tambahkan kelas untuk tahun pelajaran ini, lalu isi data siswa.')}
      ${late.html()}
    </div>
    ${editable ? ui.modal('mAddKelas', {
      title: 'Tambah Kelas', body: form(null, 'fmAddKelas'),
      footer: `<button class="btn" data-close="mAddKelas">Batal</button><button class="btn btn-primary" form="fmAddKelas">Simpan</button>`
    }) : ''}`;
    page(req, res, { title: 'Data Kelas', sub: 'Kelas per tahun pelajaran, wali kelas & program keahlian', active: 'kelas', content });
  });

  post('/kelas/save', (req, res) => {
    const isEdit = !!req.body.id;
    guard(req, res, 'kelas', isEdit ? 'edit' : 'create');
    const { id, nama, tingkat, wali_kelas, program_id, tahun_ajaran_id } = req.body;
    if (!String(nama || '').trim()) return res.redirect(req.BASE + '/kelas?err=' + encodeURIComponent('Nama kelas wajib diisi.'));
    const taId = Number(tahun_ajaran_id || dbm.taAutoId());
    const aktif = req.body.aktif ? 1 : 0;
    if (isEdit) db.prepare('UPDATE kelas SET nama=?,nama_kelas=?,tingkat=?,wali_kelas=?,program_id=?,tahun_ajaran_id=?,aktif=? WHERE id=?')
      .run(nama.trim(), nama.trim(), tingkat || '', wali_kelas || '', program_id || null, taId, aktif, id);
    else db.prepare('INSERT INTO kelas (nama,nama_kelas,tingkat,wali_kelas,program_id,tahun_ajaran_id,aktif,urutan,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(nama.trim(), nama.trim(), tingkat || '', wali_kelas || '', program_id || null, taId, aktif,
        db.prepare('SELECT COALESCE(MAX(urutan),0)+1 n FROM kelas').get().n, nowStamp());
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'kelas', `${isEdit ? 'Edit' : 'Tambah'} kelas ${nama}`);
    res.redirect(req.BASE + '/kelas?ok=' + encodeURIComponent('Data kelas disimpan.'));
  });

  post('/kelas/delete', (req, res) => {
    guard(req, res, 'kelas', 'delete');
    const n = db.prepare('SELECT COUNT(*) c FROM siswa_penempatan WHERE kelas_id=?').get(req.body.id).c
      + db.prepare('SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND NOT EXISTS (SELECT 1 FROM siswa_penempatan p WHERE p.siswa_id=siswa.id)').get(req.body.id).c;
    if (n) return res.redirect(req.BASE + '/kelas?err=' + encodeURIComponent('Kelas masih memiliki ' + n + ' siswa — pindahkan siswa terlebih dahulu.'));
    const k = db.prepare('SELECT * FROM kelas WHERE id=?').get(req.body.id);
    db.prepare('DELETE FROM kelas WHERE id=?').run(req.body.id);
    dbm.logAudit(req.user, 'HAPUS', 'kelas', `Hapus kelas ${k ? k.nama : req.body.id}`);
    res.redirect(req.BASE + '/kelas?ok=' + encodeURIComponent('Kelas dihapus.'));
  });

  get('/kelas/export', (req, res) => {
    guard(req, res, 'kelas', 'view');
    const taId = Number(req.query.get('ta') || 0) || null;
    const rows = dbm.kelasList(taId, {});
    const head = ['NAMA KELAS', 'TINGKAT', 'PROGRAM KEAHLIAN', 'WALI KELAS', 'JUMLAH SISWA', 'STATUS'].map(v => ({ v, bold: true }));
    xlsxSend(res, 'data-kelas.xlsx', 'Kelas',
      [head, ...rows.map(k => [k.nama, k.tingkat || '', k.program_nama || '', k.wali_kelas || '', k.jumlah_siswa, k.aktif ? 'Aktif' : 'Tidak Aktif'])],
      [22, 9, 30, 26, 12, 12]);
  });

  /* ================= DATA SISWA ================= */
  get('/siswa', (req, res) => {
    guard(req, res, 'siswa', 'view');
    const c = ctx(req);
    const taId = Number(req.query.get('ta') || c.taId || 0) || null;
    const kelasId = req.query.get('kelas') || '';
    const q = req.query.get('q') || '';
    let rows = dbm.siswaList({ taId, kelasId, q, status: ['aktif', 'nonaktif'] });
    const kelasAll = dbm.kelasList(taId, {});
    const editable = c.can('siswa', 'edit');
    const late = modalCollector();
    const taList = dbm.allTahun();
    const taSel = taId || c.taId;

    const form = (s, fid) => `<form method="post" action="${c.base}/siswa/save" id="${fid}">
      <input type="hidden" name="id" value="${s ? s.id : ''}">
      <div class="row2">
        <div class="field"><label>NISN</label><input name="nisn" value="${esc(s ? s.nisn : '')}" placeholder="0012345678"></div>
        <div class="field"><label>Nama Siswa</label><input name="nama" value="${esc(s ? s.nama : '')}" required></div>
      </div>
      <div class="row2">
        <div class="field"><label>Jenis Kelamin</label><select name="jenis_kelamin">
          <option value="L" ${!s || s.jenis_kelamin === 'L' ? 'selected' : ''}>Laki-laki</option>
          <option value="P" ${s && s.jenis_kelamin === 'P' ? 'selected' : ''}>Perempuan</option></select></div>
        <div class="field"><label>Tanggal Lahir</label><input type="date" name="tanggal_lahir" value="${esc(s ? s.tanggal_lahir : '')}">
          <div class="hint">Dipakai verifikasi portal orang tua.</div></div>
      </div>
      <div class="field"><label>No. HP / WA Orang Tua</label>
        <input name="parent_phone" inputmode="tel" value="${esc(s ? (lib.phoneDisplay(s.parent_phone) || '') : '')}" placeholder="081234567890" autocomplete="off">
        <div class="hint">Nomor WhatsApp orang tua/wali untuk <b>pengingat tagihan otomatis</b>. Format <code>08…</code> otomatis diubah menjadi <code>628…</code>.</div></div>
      <div class="field"><label>Kelas</label><select name="kelas_id">
        <option value="">— Belum ditetapkan —</option>${kelasOptions(taSel, s ? s.kelas_id : '')}</select></div>
      <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(s ? s.keterangan : '')}" placeholder="Opsional"></div>
    </form>`;

    const content = `<div class="card">
      <div class="card-head"><div><h3>Data Siswa</h3><div class="sub">${rows.length} siswa aktif/non-aktif pada filter ini</div></div>
        <div class="toolbar">
          <a class="btn btn-sm" href="${c.base}/siswa/export?ta=${taSel}&kelas=${esc(kelasId)}&q=${encodeURIComponent(q)}">${ui.icon('download')}Export Excel</a>
          ${editable ? `<button class="btn btn-sm" data-open="mImportSiswa">${ui.icon('upload')}Import Excel</button>` : ''}
          ${c.can('siswa', 'create') ? ui.openModalBtn('mAddSiswa', 'Tambah Siswa') : ''}
        </div></div>
      ${editable && rows.length ? `<form method="post" action="${c.base}/siswa/bulk" id="fBulkSiswa" class="bulk-panel mb-2"
          data-confirm="Terapkan perubahan massal ke siswa yang dicentang?">
        <div class="bulk-head">
          <div><div class="t-strong">Perubahan Massal Siswa</div>
            <div class="t-sub">Centang siswa pada tabel, lalu pilih aksi di bawah. Terpilih: <b data-check-count="siswa">0</b> siswa.</div></div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-all="siswa">${ui.icon('check')}Pilih Semua</button>
            <button type="button" class="btn btn-sm" data-check-none="siswa">Kosongkan</button>
          </div>
        </div>
        <div class="row2">
          <div class="field"><label>Penetapan Kelas (opsional)</label>
            <select name="kelas_id"><option value="">— Tidak diubah —</option>${kelasOptions(taSel, '', true)}</select>
            <div class="hint">Tahun pelajaran siswa otomatis mengikuti kelas yang dipilih.</div></div>
          <div class="field"><label>Status Kelulusan / Status Siswa (opsional)</label>
            <select name="status"><option value="">— Tidak diubah —</option>
              ${STATUS_OPTS.map(x => `<option value="${x}">${esc((dbm.SISWA_STATUS[x] || [x])[0])}</option>`).join('')}</select>
            <div class="hint">Pilih <b>Lulus</b> untuk meluluskan siswa kelas XII / tingkat akhir secara manual.</div></div>
        </div>
        <div class="form-actions" style="border:0;padding-top:0">
          <button class="btn btn-primary">${ui.icon('save')}Terapkan ke Siswa Terpilih</button>
        </div>
      </form>` : ''}
      <form method="get" action="${c.base}/siswa" class="filterbar">
        <div class="field"><label>Tahun Pelajaran</label><select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taSel) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Kelas</label><select name="kelas" data-autosubmit><option value="">Semua Kelas</option>${kelasAll.map(k => `<option value="${k.id}" ${String(kelasId) === String(k.id) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Nama / NISN</label><input name="q" value="${esc(q)}" placeholder="Cari nama atau NISN"></div>
        <button class="btn">${ui.icon('search')}Cari</button>
      </form>
      ${rows.length ? `<div class="table-wrap sticky-head"><table id="tblSiswa"><thead><tr>
        ${editable ? `<th class="pick-cell"><input type="checkbox" data-check-all-box="siswa" title="Pilih semua siswa" aria-label="Pilih semua siswa"></th>` : ''}
        <th>NISN</th><th>Nama</th><th>JK</th><th>Kelas</th><th>Tanggal Lahir</th><th>No. HP Orang Tua</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
      ${rows.map(s => `<tr>
        ${editable ? `<td class="pick-cell"><input type="checkbox" name="siswa" value="${s.id}" form="fBulkSiswa" aria-label="Pilih ${esc(s.nama)}"></td>` : ''}
        <td class="mono">${esc(s.nisn || '-')}</td>
        <td class="t-strong">${esc(s.nama)}</td>
        <td>${esc(JK_LABEL[s.jenis_kelamin] || '-')}</td>
        <td>${esc(s.kelas_nama || '-')}<div class="t-sub">${esc(s.program_nama || '')}</div></td>
        <td class="nowrap">${s.tanggal_lahir ? tglID(s.tanggal_lahir) : '-'}</td>
        <td class="nowrap mono">${s.parent_phone ? esc(lib.phoneDisplay(s.parent_phone)) : '<span class="t-sub">belum diisi</span>'}</td>
        <td>${statusBadge(s.status)}</td>
        <td class="right nowrap">
          <a class="btn btn-sm" href="${c.base}/siswa/${s.id}" title="Detail">${ui.icon('eye')}</a>
          ${editable ? `<button class="btn btn-sm btn-icon" data-open="mEd${s.id}" title="Edit">${ui.icon('edit')}</button>
          <button class="btn btn-sm btn-icon" data-open="mKelas${s.id}" title="Penetapan Kelas">${ui.icon('school')}</button>` : ''}
          ${editable ? `<form method="post" action="${c.base}/siswa/status" style="display:inline" data-confirm="Nonaktifkan siswa ${esc(s.nama)}?">
            <input type="hidden" name="id" value="${s.id}"><input type="hidden" name="aksi" value="nonaktif"><button class="btn btn-sm btn-warn" title="Nonaktifkan">${ui.icon('x')}</button></form>
          <button class="btn btn-sm btn-icon" data-open="mSt${s.id}" title="Status kelulusan / pindah / DO">${ui.icon('graduation')}</button>` : ''}
        </td></tr>
        ${late('mSt' + s.id, {
        title: 'Status Siswa — ' + s.nama,
        body: `<form method="post" action="${c.base}/siswa/status" id="fst${s.id}">
            <input type="hidden" name="id" value="${s.id}"><input type="hidden" name="aksi" value="status">
            <div class="field"><label>Status Baru</label><select name="status">
              ${STATUS_OPTS.filter(x => x !== 'nonaktif').map(x => `<option value="${x}" ${s.status === x ? 'selected' : ''}>${esc((dbm.SISWA_STATUS[x] || [x])[0])}</option>`).join('')}
            </select></div>
          </form>`,
        footer: `<button class="btn" data-close="mSt${s.id}">Batal</button><button class="btn btn-primary" form="fst${s.id}">Simpan Status</button>`
      })}
        ${late('mEd' + s.id, {
        title: 'Edit Siswa', body: form(s, 'fmEd' + s.id),
        footer: `<button class="btn" data-close="mEd${s.id}">Batal</button><button class="btn btn-primary" form="fmEd${s.id}">Simpan</button>`
      })}
        ${late('mKelas' + s.id, {
        title: 'Penetapan Kelas — ' + s.nama, body: `<form method="post" action="${c.base}/siswa/kelas" id="fk${s.id}">
            <input type="hidden" name="id" value="${s.id}">
            <div class="field"><label>Kelas Baru</label><select name="kelas_id">${kelasOptions(taSel, s.kelas_id, true)}</select></div>
            <div class="hint">Tahun pelajaran siswa otomatis mengikuti tahun pelajaran kelas yang dipilih.</div></form>`,
        footer: `<button class="btn" data-close="mKelas${s.id}">Batal</button><button class="btn btn-primary" form="fk${s.id}">Tetapkan</button>`
      })}`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada data siswa', 'Tambahkan satu per satu atau import dari Excel (pilih kelas tujuan terlebih dahulu).')}
      ${late.html()}
    </div>

    ${editable ? ui.modal('mAddSiswa', {
      title: 'Tambah Siswa', body: form(null, 'fmAddSiswa'),
      footer: `<button class="btn" data-close="mAddSiswa">Batal</button><button class="btn btn-primary" form="fmAddSiswa">Simpan</button>`
    }) : ''}
    ${editable ? ui.modal('mImportSiswa', {
      title: 'Import Data Siswa (Excel / CSV)', wide: true,
      body: `<form method="post" action="${c.base}/siswa/import" id="fImportSiswa">
        <div class="alert info">${ui.icon('info')}<div><b>Format kolom:</b> <code>NISN | NAMA | JENIS KELAMIN | TANGGAL LAHIR (opsional) | NO. HP / WA ORANG TUA (opsional)</code><br>
          Pilih <b>kelas tujuan</b> — semua siswa pada berkas akan dimasukkan ke kelas tersebut. Data akan <b>divalidasi baris-per-baris</b> dan ditampilkan sebagai pratinjau sebelum disimpan.</div></div>
        <div class="field"><label>Kelas Tujuan <span style="color:var(--red)">*</span></label>
          <select name="kelas_id" required><option value="">— Pilih kelas tujuan —</option>${kelasOptions(taSel, '', true)}</select></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="siswa_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="siswa_b64" data-max="10">
          <div class="hint" id="siswa_b64-info"></div></div>
      </form>`,
      footer: `<a class="btn" href="${c.base}/siswa/template">${ui.icon('download')}Template Excel</a>
        <button class="btn" data-close="mImportSiswa">Batal</button>
        <button class="btn btn-primary" form="fImportSiswa">${ui.icon('upload')}Preview Data</button>`
    }) : ''}
    <p class="help mt-2">Siswa berstatus <b>non-aktif</b> tidak muncul pada penetapan iuran baru. Kelola siswa non-aktif (termasuk <b>Lulus / Pindah / DO</b>) pada menu <a href="${c.base}/siswa-nonaktif">Siswa Non-Aktif</a>.
      <br>Gunakan ceklis + <b>Perubahan Massal</b> untuk menetapkan kelas atau meluluskan siswa kelas XII / tingkat akhir secara manual — kelulusan <b>tidak</b> lagi otomatis saat menambah tahun pelajaran.</p>`;
    page(req, res, { title: 'Data Siswa', sub: 'Master siswa per kelas & tahun pelajaran', active: 'siswa', content });
  });

  get('/siswa/template', (req, res) => {
    guard(req, res, 'siswa', 'view');
    const rows = [
      [{ v: 'TEMPLATE IMPORT DATA SISWA', bold: true }],
      ['Isi baris di bawah ini, lalu simpan sebagai .xlsx / .csv'],
      ['NISN wajib unik. Tanggal lahir opsional (format DD/MM/YYYY) — dipakai untuk verifikasi portal orang tua.'],
      ['NO. HP / WA ORANG TUA berisi nomor WhatsApp orang tua/wali untuk pengingat tagihan otomatis (08… otomatis menjadi 628…).'],
      [],
      ['NISN', 'NAMA', 'JENIS KELAMIN', 'TANGGAL LAHIR', 'NO. HP / WA ORANG TUA'].map(v => ({ v, bold: true })),
      ['0012345678', 'Ahmad Fauzi', 'L', '12/03/2009', '081234567890'],
      ['0012345679', 'Siti Aminah', 'P', '05/07/2009', '081298765432']
    ];
    xlsxSend(res, 'template-import-siswa.xlsx', 'Siswa', rows, [16, 32, 18, 18, 24]);
  });

  /* import siswa: 1) validasi + pratinjau */
  post('/siswa/import', (req, res) => {
    guard(req, res, 'siswa', 'create');
    const back = req.BASE + '/siswa';
    const kelas = dbm.kelasById(req.body.kelas_id);
    if (!kelas) return res.redirect(back + '?err=' + encodeURIComponent('Pilih kelas tujuan terlebih dahulu.'));
    let sheets;
    try { sheets = readSheet(req.body.file_b64); }
    catch (e) { return res.redirect(back + '?err=' + encodeURIComponent(e.message)); }
    const h = findHeader(sheets);
    if (!h) return res.redirect(back + '?err=' + encodeURIComponent('Header kolom NISN | NAMA tidak ditemukan. Gunakan Template Excel yang disediakan.'));

    const errors = [];
    const items = [];
    const seen = new Set();
    for (let i = h.row + 1; i < h.sheet.rows.length; i++) {
      const cells = h.sheet.rows[i] || [];
      if (!cells.length) continue;
      const nisn = X.cellText(cells[h.iNisn]).trim().replace(/\.0$/, '');
      const nama = X.cellText(cells[h.iNama]).trim();
      if (!nisn && !nama) continue;
      if (/^(NAMA|TEMPLATE|JUMLAH|TOTAL)/i.test(nama) || /NISN/i.test(nisn)) continue;
      const hpRaw = h.iHp >= 0 ? X.cellText(cells[h.iHp]).trim().replace(/\.0$/, '') : '';
      const raw = [nisn, nama, h.iJk >= 0 ? X.cellText(cells[h.iJk]) : '', h.iTgl >= 0 ? X.cellText(cells[h.iTgl]) : '', hpRaw].join(' | ');
      const lineNo = i + 1;
      if (!nama) { errors.push({ row: lineNo, msg: 'Nama siswa kosong.', raw }); continue; }
      if (!nisn) { errors.push({ row: lineNo, msg: 'NISN kosong.', raw }); continue; }
      if (!/^\d{4,20}$/.test(nisn)) { errors.push({ row: lineNo, msg: `NISN "${nisn}" harus berupa angka 4–20 digit.`, raw }); continue; }
      const jk = h.iJk >= 0 ? normJk(X.cellText(cells[h.iJk])) : 'L';
      if (!jk && h.iJk >= 0 && X.cellText(cells[h.iJk]).trim()) {
        errors.push({ row: lineNo, msg: `Jenis kelamin "${X.cellText(cells[h.iJk])}" tidak dikenal (gunakan L / P).`, raw }); continue;
      }
      let tgl = null;
      if (h.iTgl >= 0 && cells[h.iTgl]) {
        tgl = X.parseDateCell(cells[h.iTgl]);
        if (!tgl) { errors.push({ row: lineNo, msg: 'Format tanggal lahir salah (gunakan DD/MM/YYYY).', raw }); continue; }
      }
      let hp = '';
      if (hpRaw) {
        hp = lib.normPhone(hpRaw);
        if (!hp) { errors.push({ row: lineNo, msg: `Nomor HP/WA orang tua "${hpRaw}" tidak valid (contoh: 081234567890).`, raw }); continue; }
      }
      if (seen.has(nisn)) { errors.push({ row: lineNo, msg: `NISN ${nisn} ganda di dalam berkas (baris sebelumnya).`, raw }); continue; }
      seen.add(nisn);
      const dup = db.prepare('SELECT nama FROM siswa WHERE nisn=?').get(nisn);
      if (dup) { errors.push({ row: lineNo, msg: `NISN ${nisn} sudah terdaftar pada siswa lain (${dup.nama}).`, raw }); continue; }
      items.push({ nisn, nama, jk: jk || 'L', tgl, hp, raw, lineNo });
    }
    if (!items.length && !errors.length) return res.redirect(back + '?err=' + encodeURIComponent('Tidak ada baris data yang bisa dibaca dari berkas.'));

    const token = impcache.put({ kind: 'siswa', kelasId: kelas.id, items, errors, at: nowStamp() });
    return res.redirect(req.BASE + '/siswa/import/preview?token=' + token);
  });

  get('/siswa/import/preview', (req, res) => {
    guard(req, res, 'siswa', 'create');
    const c = ctx(req);
    const cache = impcache.get(req.query.get('token'));
    if (!cache || cache.kind !== 'siswa') {
      return res.redirect(c.base + '/siswa?err=' + encodeURIComponent('Sesi pratinjau import sudah kedaluwarsa. Silakan unggah ulang berkas.'));
    }
    const kelas = dbm.kelasById(cache.kelasId);
    const token = req.query.get('token');
    const okAll = !cache.errors.length;
    const rows = cache.items.map((it, i) => `<tr>
      <td class="num">${i + 1}</td><td class="mono">${esc(it.nisn)}</td><td class="t-strong">${esc(it.nama)}</td>
      <td>${esc(JK_LABEL[it.jk] || it.jk)}</td><td class="nowrap">${it.tgl ? tglID(it.tgl) : '-'}</td>
      <td class="nowrap">${it.hp ? esc(lib.phoneDisplay(it.hp)) : '-'}</td>
      <td>${okAll ? ui.badge('Valid', 'green') : ui.badge('Perlu diperiksa', 'amber')}</td></tr>`).join('');

    const content = `<div class="card">
      <div class="card-head"><div><h3>Pratinjau Import Data Siswa</h3>
        <div class="sub">Kelas tujuan: <b>${esc(kelas ? kelas.nama : '-')}</b> · ${cache.items.length} baris terbaca · ${cache.errors.length} error</div></div>
        <div class="toolbar"><a class="btn btn-sm" href="${c.base}/siswa">${ui.icon('x')}Batal</a></div></div>
      ${cache.errors.length ? `<div class="alert err">${ui.icon('alert')}<div><b>Import dibatalkan.</b> ${cache.errors.length} baris bermasalah — perbaiki berkas lalu unggah ulang. Tidak ada data yang disimpan.</div></div>` : ''}
      <div class="table-wrap" style="max-height:52vh"><table><thead><tr><th>No</th><th>NISN</th><th>Nama</th><th>JK</th><th>Tanggal Lahir</th><th>No. HP Orang Tua</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      ${cache.items.length ? `<form method="post" action="${c.base}/siswa/import/commit" class="form-actions mt-2">
        <input type="hidden" name="token" value="${esc(token)}">
        <button class="btn btn-primary" ${okAll ? '' : 'disabled title="Perbaiki berkas terlebih dahulu"'}>${ui.icon('save')}Simpan ${cache.items.length} Siswa ke Database</button>
      </form>` : ''}
      <p class="help mt-2">Data hanya masuk ke database setelah Anda menekan tombol simpan, dan hanya bila seluruh baris tervalidasi bebas error.</p>
    </div>
    ${cache.errors.length ? ui.importErrorModal(cache.errors) : ''}`;
    page(req, res, { title: 'Pratinjau Import Siswa', sub: 'Validasi & pratinjau sebelum data disimpan', active: 'siswa', content });
  });

  post('/siswa/import/commit', (req, res) => {
    guard(req, res, 'siswa', 'create');
    const cache = impcache.get(req.body.token);
    if (!cache || cache.kind !== 'siswa') return res.redirect(req.BASE + '/siswa?err=' + encodeURIComponent('Sesi pratinjau sudah kedaluwarsa.'));
    if (cache.errors.length) return res.redirect(req.BASE + '/siswa?err=' + encodeURIComponent('Berkas masih memiliki baris error — import dibatalkan.'));
    const kelas = dbm.kelasById(cache.kelasId);
    if (!kelas) return res.redirect(req.BASE + '/siswa?err=' + encodeURIComponent('Kelas tujuan tidak ditemukan.'));
    let n = 0;
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO siswa (nisn,nama,jenis_kelamin,tanggal_lahir,kelas_id,tahun_ajaran_id,status,keterangan,parent_phone,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'aktif','',?,?,?)`);
      for (const it of cache.items) {
        const dup = db.prepare('SELECT id FROM siswa WHERE nisn=?').get(it.nisn);
        if (dup) continue;
        const info = ins.run(it.nisn, it.nama, it.jk, it.tgl || null, kelas.id, kelas.tahun_ajaran_id, it.hp || null, nowStamp(), nowStamp());
        dbm.penempatanSet(Number(info.lastInsertRowid), kelas.id, kelas.tahun_ajaran_id, { sumber: 'import' });
        n++;
      }
    })();
    impcache.drop(req.body.token);
    dbm.logAudit(req.user, 'IMPORT', 'siswa', `Import ${n} siswa ke kelas ${kelas.nama}`);
    res.redirect(req.BASE + '/siswa?ok=' + encodeURIComponent(`${n} siswa berhasil diimport ke kelas ${kelas.nama}.`));
  });

  get('/siswa/export', (req, res) => {
    guard(req, res, 'siswa', 'view');
    const taId = Number(req.query.get('ta') || 0) || null;
    const rows = dbm.siswaList({
      taId, kelasId: req.query.get('kelas') || '', q: req.query.get('q') || '',
      status: ['aktif', 'nonaktif', 'lulus', 'pindah', 'do']
    });
    const head = ['NISN', 'NAMA', 'JENIS KELAMIN', 'KELAS', 'TANGGAL LAHIR', 'NO. HP / WA ORANG TUA', 'STATUS'].map(v => ({ v, bold: true }));
    xlsxSend(res, 'data-siswa.xlsx', 'Siswa',
      [head, ...rows.map(s => [s.nisn || '', s.nama, JK_LABEL[s.jenis_kelamin] || '', s.kelas_nama || '', s.tanggal_lahir || '',
        lib.phoneDisplay(s.parent_phone) || '', (dbm.SISWA_STATUS[s.status] || [s.status])[0]])],
      [16, 32, 16, 20, 16, 24, 22]);
  });

  post('/siswa/save', (req, res) => {
    const isEdit = !!req.body.id;
    guard(req, res, 'siswa', isEdit ? 'edit' : 'create');
    const { id, nisn, nama, jenis_kelamin, tanggal_lahir, kelas_id, keterangan } = req.body;
    const parentPhoneRaw = String(req.body.parent_phone || '').trim();
    const parentPhone = parentPhoneRaw ? lib.normPhone(parentPhoneRaw) : '';
    if (parentPhoneRaw && !parentPhone) {
      return res.redirect(req.BASE + '/siswa?err=' + encodeURIComponent('Nomor HP/WA orang tua tidak valid (contoh: 081234567890).'));
    }
    const back = req.BASE + '/siswa';
    if (!String(nama || '').trim()) return res.redirect(back + '?err=' + encodeURIComponent('Nama siswa wajib diisi.'));
    const nisnV = String(nisn || '').trim();
    if (nisnV) {
      const dup = db.prepare('SELECT nama FROM siswa WHERE nisn=? AND id<>?').get(nisnV, id || 0);
      if (dup) return res.redirect(back + '?err=' + encodeURIComponent(`NISN ${nisnV} sudah dipakai siswa lain (${dup.nama}).`));
    }
    const k = kelas_id ? dbm.kelasById(kelas_id) : null;
    const taId = k ? k.tahun_ajaran_id : (isEdit ? db.prepare('SELECT tahun_ajaran_id FROM siswa WHERE id=?').get(id)?.tahun_ajaran_id : dbm.taAutoId());
    let siswaId = Number(id || 0);
    if (isEdit) {
      db.prepare('UPDATE siswa SET nisn=?,nama=?,jenis_kelamin=?,tanggal_lahir=?,kelas_id=?,tahun_ajaran_id=?,keterangan=?,parent_phone=?,updated_at=? WHERE id=?')
        .run(nisnV || null, nama.trim(), jenis_kelamin === 'P' ? 'P' : 'L', tanggal_lahir || null, kelas_id || null, taId, keterangan || '', parentPhone || null, nowStamp(), id);
    } else {
      const info = db.prepare(`INSERT INTO siswa (nisn,nama,jenis_kelamin,tanggal_lahir,kelas_id,tahun_ajaran_id,status,keterangan,parent_phone,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'aktif',?,?,?,?)`)
        .run(nisnV || null, nama.trim(), jenis_kelamin === 'P' ? 'P' : 'L', tanggal_lahir || null, kelas_id || null, taId, keterangan || '', parentPhone || null, nowStamp(), nowStamp());
      siswaId = Number(info.lastInsertRowid);
    }
    // catat penempatan kelas pada tahun pelajaran kelas tersebut (riwayat antar-TA tetap utuh)
    if (siswaId && taId) {
      dbm.penempatanSet(siswaId, kelas_id || null, taId, { sumber: 'manual' });
      dbm.siswaSyncCurrent(siswaId);
    }
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'siswa', `${isEdit ? 'Edit' : 'Tambah'} siswa ${nama}`);
    res.redirect(back + '?ok=' + encodeURIComponent('Data siswa disimpan.'));
  });

  post('/siswa/kelas', (req, res) => {
    guard(req, res, 'siswa', 'edit');
    const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(req.body.id);
    const k = dbm.kelasById(req.body.kelas_id);
    if (!s || !k) return res.redirect(req.BASE + '/siswa?err=' + encodeURIComponent('Siswa/kelas tidak ditemukan.'));
    db.transaction(() => {
      // penetapan kelas = penempatan pada tahun pelajaran kelas tujuan;
      // penempatan tahun pelajaran lain TIDAK dihapus
      dbm.penempatanSet(s.id, k.id, k.tahun_ajaran_id, { sumber: 'manual' });
      dbm.siswaSyncCurrent(s.id);
      db.prepare(`INSERT INTO siswa_mutasi (siswa_id,kelas_asal_id,kelas_tujuan_id,ta_asal_id,ta_tujuan_id,status,created_by,created_at,applied_at,applied_by)
        VALUES (?,?,?,?,?,'ditetapkan',?,?,?,?)`).run(s.id, s.kelas_id, k.id, s.tahun_ajaran_id, k.tahun_ajaran_id, req.user.id, nowStamp(), nowStamp(), req.user.nama);
    })();
    dbm.logAudit(req.user, 'MUTASI', 'siswa', `Penetapan kelas ${s.nama} → ${k.nama}`);
    res.redirect(req.BASE + '/siswa?ok=' + encodeURIComponent('Kelas siswa diperbarui. Riwayat penempatan tahun pelajaran sebelumnya tetap tersimpan.'));
  });

  post('/siswa/status', (req, res) => {
    guard(req, res, 'siswa', 'edit');
    const back = req.BASE + '/siswa';
    const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(req.body.id);
    if (!s) return res.redirect(back + '?err=' + encodeURIComponent('Siswa tidak ditemukan.'));
    const aksi = String(req.body.aksi || 'status');
    let status = 'aktif';
    if (aksi === 'nonaktif') status = 'nonaktif';
    else {
      status = STATUS_OPTS.includes(req.body.status) ? req.body.status : 'aktif';
    }
    db.prepare('UPDATE siswa SET status=?,updated_at=? WHERE id=?').run(status, nowStamp(), s.id);
    const label = (dbm.SISWA_STATUS[status] || [status])[0];
    dbm.logAudit(req.user, 'STATUS SISWA', 'siswa', `Status ${s.nama} → ${label}`);
    const msg = `Status ${s.nama} diubah menjadi ${label}. Seluruh tagihan iuran tetap tersimpan di tahun pelajarannya dan bisa dibayar/dikoreksi kapan pun.`;
    res.redirect((status === 'aktif' ? req.BASE + '/siswa' : req.BASE + '/siswa-nonaktif') + '?ok=' + encodeURIComponent(msg));
  });

  /* ================= perubahan massal siswa (kelas & status kelulusan) ================= */
  post('/siswa/bulk', (req, res) => {
    guard(req, res, 'siswa', 'edit');
    const back = req.BASE + '/siswa';
    const ids = [].concat(req.body.siswa || []).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Centang minimal satu siswa yang akan diubah.'));
    const kelasId = req.body.kelas_id ? Number(req.body.kelas_id) : 0;
    const k = kelasId ? dbm.kelasById(kelasId) : null;
    if (kelasId && !k) return res.redirect(back + '?err=' + encodeURIComponent('Kelas yang dipilih tidak ditemukan.'));
    const statusBaru = STATUS_OPTS.includes(req.body.status) ? req.body.status : '';
    if (!k && !statusBaru) return res.redirect(back + '?err=' + encodeURIComponent('Pilih penetapan kelas dan/atau status yang akan diterapkan.'));

    let nKelas = 0, nStatus = 0;
    const perStatus = {};
    db.transaction(() => {
      for (const id of ids) {
        const sw = db.prepare('SELECT * FROM siswa WHERE id=?').get(id);
        if (!sw) continue;
        if (k) {
          dbm.penempatanSet(id, k.id, k.tahun_ajaran_id, { sumber: 'massal' });
          dbm.siswaSyncCurrent(id);
          db.prepare(`INSERT INTO siswa_mutasi (siswa_id,kelas_asal_id,kelas_tujuan_id,ta_asal_id,ta_tujuan_id,status,created_by,created_at,applied_at,applied_by)
            VALUES (?,?,?,?,?,'ditetapkan',?,?,?,?)`)
            .run(id, sw.kelas_id, k.id, sw.tahun_ajaran_id, k.tahun_ajaran_id, req.user.id, nowStamp(), nowStamp(), req.user.nama);
          nKelas++;
        }
        if (statusBaru && sw.status !== statusBaru) {
          db.prepare('UPDATE siswa SET status=?,updated_at=? WHERE id=?').run(statusBaru, nowStamp(), id);
          nStatus++;
          perStatus[statusBaru] = (perStatus[statusBaru] || 0) + 1;
        }
      }
    })();
    const labelStatus = statusBaru ? (dbm.SISWA_STATUS[statusBaru] || [statusBaru])[0] : '';
    const msgs = [];
    if (nKelas) msgs.push(`${nKelas} siswa ditetapkan ke kelas ${k.nama}.`);
    if (nStatus) msgs.push(`${nStatus} siswa diubah statusnya menjadi ${labelStatus}.`);
    if (!msgs.length) msgs.push('Tidak ada perubahan (data sudah sesuai).');
    dbm.logAudit(req.user, 'UBAH MASSAL', 'siswa',
      `Perubahan massal ${ids.length} siswa${nKelas ? ` · kelas ${k.nama} (${nKelas})` : ''}${nStatus ? ` · status ${labelStatus} (${nStatus})` : ''}`);
    // status non-aktif (lulus/pindah/do) → arahkan ke halaman Siswa Non-Aktif agar hasilnya terlihat
    const keNonaktif = statusBaru && ['lulus', 'pindah', 'do'].includes(statusBaru);
    const dest = keNonaktif ? req.BASE + '/siswa-nonaktif' : back;
    res.redirect(dest + '?ok=' + encodeURIComponent(msgs.join(' ') + (statusBaru === 'lulus'
      ? ' Tagihan iuran siswa tetap tersimpan pada tahun pelajarannya masing-masing.'
      : '')));
  });

  post('/siswa/delete', (req, res) => {
    guard(req, res, 'siswa', 'delete');
    const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(req.body.id);
    if (!s) return res.redirect(req.BASE + '/siswa-nonaktif?err=' + encodeURIComponent('Siswa tidak ditemukan.'));
    dbm.trashAdd('siswa', s, { user: req.user, label: `Siswa ${s.nama} (${s.nisn || '-'})` });
    // data iuran siswa ikut dibersihkan (ikut tersimpan di kotak sampah utama)
    db.prepare('DELETE FROM siswa WHERE id=?').run(s.id);
    dbm.logAudit(req.user, 'HAPUS PERMANEN', 'siswa', `Hapus permanen siswa ${s.nama}`);
    res.redirect(req.BASE + '/siswa-nonaktif?ok=' + encodeURIComponent('Siswa dihapus (masih dapat dipulihkan dari Kotak Sampah).'));
  });

  /* detail siswa */
  get('/siswa/:id', (req, res) => {
    guard(req, res, 'siswa', 'view');
    const c = ctx(req);
    const s = db.prepare(`SELECT s.*, k.nama kelas_nama, k.tingkat, p.nama program_nama
      FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id LEFT JOIN program_keahlian p ON p.id=k.program_id WHERE s.id=?`).get(req.params.id);
    if (!s) return res.notFound();
    const tags = dbm.iuranTagihanRows({ siswaId: s.id });
    const rekap = dbm.iuranRekapSiswa(tags)[0] || { tagihan: 0, terbayar: 0, potongan: 0, sisa: 0 };
    const bayar = dbm.iuranBayarRows({ siswaId: s.id });
    const penempatan = dbm.penempatanList(s.id);
    const content = `<div class="between mb-2">
      <a class="btn" href="${c.base}/siswa">${ui.icon('x')}Kembali ke Data Siswa</a>
      <div class="toolbar">
        <a class="btn" href="${c.base}/iuran/data?q=${encodeURIComponent(s.nama)}">${ui.icon('coins')}Data Iuran</a>
        <a class="btn" href="${c.base}/iuran/transaksi?q=${encodeURIComponent(s.nama)}">${ui.icon('receipt')}Transaksi Iuran</a>
      </div></div>
    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>${esc(s.nama)}</h3><div class="sub">${esc(s.kelas_nama || 'Belum ada kelas')} · ${esc(s.program_nama || '-')}</div></div>${statusBadge(s.status)}</div>
        <div class="kv">
          <dt>NISN</dt><dd class="mono">${esc(s.nisn || '-')}</dd>
          <dt>Jenis Kelamin</dt><dd>${esc(JK_LABEL[s.jenis_kelamin] || '-')}</dd>
          <dt>Tanggal Lahir</dt><dd>${s.tanggal_lahir ? tglID(s.tanggal_lahir) : '-'}</dd>
          <dt>No. HP / WA Orang Tua</dt><dd class="mono">${s.parent_phone ? esc(lib.phoneDisplay(s.parent_phone)) : '<span class="t-sub">belum diisi</span>'}</dd>
          <dt>Keterangan</dt><dd>${esc(s.keterangan || '-')}</dd>
        </div>
        <div class="kpi-grid mt-2" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="kpi ic-orange"><div class="lbl">Total Tagihan</div><div class="val" style="font-size:16px">${rupiah(rekap.tagihan)}</div></div>
          <div class="kpi ic-green"><div class="lbl">Sudah Dibayar</div><div class="val" style="font-size:16px">${rupiah(rekap.terbayar)}</div></div>
          <div class="kpi ic-blue"><div class="lbl">Potongan</div><div class="val" style="font-size:16px">${rupiah(rekap.potongan)}</div></div>
          <div class="kpi ic-red"><div class="lbl">Sisa Terhutang</div><div class="val" style="font-size:16px">${rupiah(rekap.sisa)}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Tagihan Iuran</h3><div class="sub">${tags.length} grup iuran ditetapkan</div></div></div>
        ${tags.length ? `<div class="table-scroll short"><table><thead><tr><th>Grup Iuran</th><th>Jenis</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Sisa</th><th>Status</th></tr></thead><tbody>
          ${tags.map(t => `<tr><td class="t-strong">${esc(t.grup_nama)}</td><td>${t.grup_jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'}</td>
            <td class="num">${rupiah(t.nominal)}</td><td class="num">${rupiah(t.terbayar)}</td><td class="num">${rupiah(t.sisa)}</td>
            <td>${t.status === 'lunas' ? ui.badge('Lunas', 'green') : t.status === 'pemutihan' ? ui.badge('Di-pemutihan', 'blue') : t.status === 'tak_tertagih' ? ui.badge('Tak Tertagih', 'red') : t.status === 'sebagian' ? ui.badge('Sebagian', 'amber') : ui.badge('Belum Bayar', 'gray')}</td></tr>`).join('')}
        </tbody></table></div>` : ui.emptyState('Belum ada tagihan iuran', 'Tetapkan grup iuran pada menu Data Iuran → Penetapan.')}
      </div>
    </div>
    <div class="card mt-3">
      <div class="card-head"><div><h3>Riwayat Penempatan Kelas</h3><div class="sub">${penempatan.length} tahun pelajaran tercatat — riwayat tidak hilang saat siswa dimutasi</div></div></div>
      ${penempatan.length ? `<div class="table-wrap"><table><thead><tr><th>Tahun Pelajaran</th><th>Kelas</th><th>Tingkat</th><th>Sumber</th></tr></thead><tbody>
        ${penempatan.map(p => `<tr><td class="t-strong nowrap">${esc(p.ta_nama || '-')}</td><td>${esc(p.kelas_nama || 'Belum ditetapkan')}</td>
          <td>${esc(p.tingkat || '-')}</td>
          <td>${ui.badge(p.sumber === 'mutasi' || p.sumber === 'mutasi-historis' ? 'Mutasi Kelas' : p.sumber === 'import' ? 'Import' : p.sumber === 'massal' ? 'Perubahan Massal' : 'Penetapan Manual', 'gray', 'plain')}</td></tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada riwayat penempatan', 'Tetapkan kelas siswa untuk mulai mencatat riwayat per tahun pelajaran.')}
    </div>
    <div class="card mt-3">
      <div class="card-head"><div><h3>Riwayat Pembayaran</h3><div class="sub">${bayar.length} transaksi</div></div></div>
      ${bayar.length ? `<div class="table-scroll short"><table><thead><tr><th>Tanggal</th><th>No. Kwitansi</th><th>Grup Iuran</th><th class="num">Jumlah</th><th class="num">Potongan</th><th class="num">Dibayar</th><th>Metode</th><th>Status</th></tr></thead><tbody>
        ${bayar.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td><td class="mono">${esc(b.kwitansi_no || '-')}</td><td>${esc(b.grup_nama || '-')}</td>
          <td class="num">${rupiah(b.jumlah)}</td><td class="num">${rupiah(b.potongan)}</td><td class="num t-strong">${rupiah(b.dibayar)}</td>
          <td>${b.metode === 'tunai' ? 'Tunai' : 'Transfer'}</td>
          <td>${b.status === 'posted' ? ui.badge('Terposting', 'green') : b.status === 'void' ? ui.badge('Void', 'red') : ui.badge('Antrean Posting', 'amber')}</td></tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada pembayaran', 'Pembayaran iuran dicatat pada menu Data Iuran.')}
    </div>`;
    page(req, res, { title: 'Detail Siswa', sub: `Profil, tagihan & riwayat pembayaran — ${s.nama}`, active: 'siswa', content });
  });

  /* ================= MUTASI KELAS ================= */
  get('/mutasi-kelas', (req, res) => {
    guard(req, res, 'mutasi_kelas', 'view');
    const c = ctx(req);
    const taList = dbm.allTahun();
    const taAsal = Number(req.query.get('ta_asal') || c.taId || 0) || null;
    const taTujuan = Number(req.query.get('ta_tujuan') || taAsal || 0) || null;
    const kelasAsal = req.query.get('kelas_asal') || '';
    const kelasTujuan = req.query.get('kelas_tujuan') || '';
    const kAsalRow = kelasAsal ? dbm.kelasById(kelasAsal) : null;
    // daftar siswa mengikuti PENEMPATAN pada kelas & tahun pelajaran asal
    const siswa = kAsalRow ? dbm.siswaList({ taId: kAsalRow.tahun_ajaran_id, kelasId: kAsalRow.id, status: 'aktif' }) : [];
    const kAsal = dbm.kelasList(taAsal, {});
    const kTujuan = dbm.kelasList(taTujuan, {});
    const taName = id => (taList.find(t => String(t.id) === String(id)) || {}).nama || '-';
    const drafts = db.prepare(`SELECT m.*, s.nama siswa_nama, s.nisn, ka.nama asal_nama, kt.nama tujuan_nama
      FROM siswa_mutasi m JOIN siswa s ON s.id=m.siswa_id
      LEFT JOIN kelas ka ON ka.id=m.kelas_asal_id LEFT JOIN kelas kt ON kt.id=m.kelas_tujuan_id
      WHERE m.status='draft' ORDER BY m.id DESC`).all();
    const riwayat = db.prepare(`SELECT m.*, s.nama siswa_nama, s.nisn, ka.nama asal_nama, kt.nama tujuan_nama
      FROM siswa_mutasi m JOIN siswa s ON s.id=m.siswa_id
      LEFT JOIN kelas ka ON ka.id=m.kelas_asal_id LEFT JOIN kelas kt ON kt.id=m.kelas_tujuan_id
      WHERE m.status='ditetapkan' ORDER BY m.applied_at DESC, m.id DESC LIMIT 40`).all();
    const editable = c.can('mutasi_kelas', 'edit');
    const lintasTa = !!(kAsalRow && (kTujuan.find(k => String(k.id) === String(kelasTujuan)) || {}).tahun_ajaran_id &&
      String((kTujuan.find(k => String(k.id) === String(kelasTujuan)) || {}).tahun_ajaran_id) !== String(kAsalRow.tahun_ajaran_id));

    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>Mutasi Kelas Siswa</h3><div class="sub">Pindahkan siswa antar kelas / tahun pelajaran</div></div></div>
      <form method="get" action="${c.base}/mutasi-kelas" class="filterbar">
        <div class="field"><label>Tahun Ajaran Asal</label><select name="ta_asal" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taAsal) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Kelas Asal</label><select name="kelas_asal" data-autosubmit><option value="">— Pilih kelas asal —</option>${kAsal.map(k => `<option value="${k.id}" ${String(kelasAsal) === String(k.id) ? 'selected' : ''}>${esc(k.nama)} (${k.jumlah_siswa} siswa)</option>`).join('')}</select></div>
        <div class="field"><label>Tahun Ajaran Tujuan</label><select name="ta_tujuan" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(taTujuan) === String(t.id) ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Kelas Baru</label><select name="kelas_tujuan" data-autosubmit><option value="">— Pilih kelas baru —</option>${kTujuan.map(k => `<option value="${k.id}" ${String(kelasTujuan) === String(k.id) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}</select></div>
      </form>
      <div class="alert info mt-2">${ui.icon('info')}<div>
        Mutasi <b>antar tahun pelajaran</b> dicatat sebagai <b>penempatan baru</b> di tahun tujuan.
        Data &amp; rekap siswa pada tahun pelajaran <b>asal tidak dihapus</b> — siswa tetap muncul di kedua tahun pelajaran sesuai penempatannya masing-masing.
      </div></div>
    </div>
    <form method="post" action="${c.base}/mutasi-kelas/stage">
      <input type="hidden" name="kelas_tujuan" value="${esc(kelasTujuan)}">
      <input type="hidden" name="kelas_asal" value="${esc(kelasAsal)}">
      <div class="split-2">
        <div class="card">
          <div class="card-head"><div><h3>Kelas Asal</h3><div class="sub">${esc(kAsalRow ? kAsalRow.nama + ' · TA ' + taName(kAsalRow.tahun_ajaran_id) : '-')}</div></div>
            <div class="toolbar">
              <button type="button" class="btn btn-sm" data-check-all="siswa_id">${ui.icon('check')}Pilih Semua</button>
              <button type="button" class="btn btn-sm" data-check-none="siswa_id">${ui.icon('x')}Hapus Ceklis</button>
            </div></div>
          ${siswa.length ? `<div class="table-scroll short"><table><thead><tr><th style="width:42px"><input type="checkbox" data-check-all-box="siswa_id"></th><th>NISN</th><th>Nama</th><th>JK</th></tr></thead><tbody>
            ${siswa.map(s => `<tr><td><input type="checkbox" name="siswa_id" value="${s.id}"></td><td class="mono">${esc(s.nisn || '-')}</td><td class="t-strong">${esc(s.nama)}</td><td>${s.jenis_kelamin === 'P' ? 'P' : 'L'}</td></tr>`).join('')}
          </tbody></table></div>` : ui.emptyState('Pilih kelas asal', 'Tentukan tahun ajaran & kelas asal untuk menampilkan daftar siswa.')}
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Kelas Baru</h3><div class="sub">${esc((kTujuan.find(k => String(k.id) === String(kelasTujuan)) || {}).nama || 'Belum dipilih')}</div></div></div>
          <div class="kv">
            <dt>Tahun Ajaran Tujuan</dt><dd>${esc(taName(taTujuan))}</dd>
            <dt>Kelas Tujuan</dt><dd>${esc((kTujuan.find(k => String(k.id) === String(kelasTujuan)) || {}).nama || '-')}</dd>
            <dt>Jenis Mutasi</dt><dd>${lintasTa ? ui.badge('Lintas Tahun Pelajaran', 'blue') : ui.badge('Dalam Tahun Pelajaran', 'gray')}</dd>
            <dt>Siswa terpilih</dt><dd id="mutasiCount">0</dd>
          </div>
          <div class="alert info mt-2">${ui.icon('info')}<div>Centang siswa di kolom kiri lalu klik <b>Tetapkan Mutasi</b>. Data mutasi disimpan sebagai draf terlebih dahulu dan baru diterapkan setelah dikonfirmasi.</div></div>
          ${editable ? `<button class="btn btn-primary btn-block" ${kelasTujuan ? '' : 'disabled'}>${ui.icon('swap')}Tetapkan Mutasi</button>` : ''}
        </div>
      </div>
    </form>

    <div class="card mt-3">
      <div class="card-head"><div><h3>Draf Mutasi</h3><div class="sub">${drafts.length} siswa menunggu penerapan</div></div>
        <div class="toolbar">
          ${editable && drafts.length ? `<form method="post" action="${c.base}/mutasi-kelas/apply" data-confirm="Terapkan semua draf mutasi? Siswa ditempatkan ke kelas tujuan; data tahun pelajaran asal tetap tersimpan."><button class="btn btn-sm btn-green">${ui.icon('check')}Terapkan Semua</button></form>
          <form method="post" action="${c.base}/mutasi-kelas/delete" data-confirm="Hapus semua draf mutasi?"><button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Mutasi</button></form>` : ''}
        </div></div>
      ${drafts.length ? `<div class="table-scroll short"><table><thead><tr><th>NISN</th><th>Nama</th><th>Kelas Asal</th><th>TA Asal</th><th>Kelas Tujuan</th><th>TA Tujuan</th><th>Dibuat</th><th class="right">Aksi</th></tr></thead><tbody>
        ${drafts.map(d => `<tr><td class="mono">${esc(d.nisn || '-')}</td><td class="t-strong">${esc(d.siswa_nama)}</td>
          <td>${esc(d.asal_nama || '-')}</td><td class="nowrap">${esc(taName(d.ta_asal_id))}</td>
          <td>${esc(d.tujuan_nama || '-')}</td><td class="nowrap">${esc(taName(d.ta_tujuan_id))}</td>
          <td class="nowrap">${esc(lib.stampShort(d.created_at))}</td>
          <td class="right">${editable ? `<form method="post" action="${c.base}/mutasi-kelas/delete" style="display:inline"><input type="hidden" name="id" value="${d.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada draf mutasi', 'Pilih kelas asal & kelas tujuan, centang siswa, lalu Tetapkan Mutasi.')}
    </div>

    <div class="card mt-3">
      <div class="card-head"><div><h3>Riwayat Mutasi Terakhir</h3><div class="sub">Mutasi yang sudah diterapkan — bukti bahwa penempatan tahun asal tetap tersimpan</div></div></div>
      ${riwayat.length ? `<div class="table-scroll short"><table id="tblRiwayatMutasi"><thead><tr><th>NISN</th><th>Nama</th><th>Kelas Asal</th><th>TA Asal</th><th>Kelas Tujuan</th><th>TA Tujuan</th><th>Diterapkan</th><th>Oleh</th></tr></thead><tbody>
        ${riwayat.map(d => `<tr><td class="mono">${esc(d.nisn || '-')}</td><td class="t-strong">${esc(d.siswa_nama)}</td>
          <td>${esc(d.asal_nama || '-')}</td><td class="nowrap">${esc(taName(d.ta_asal_id))}</td>
          <td>${esc(d.tujuan_nama || '-')}</td><td class="nowrap">${esc(taName(d.ta_tujuan_id))}</td>
          <td class="nowrap">${esc(lib.stampShort(d.applied_at))}</td><td>${esc(d.applied_by || '-')}</td></tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada mutasi diterapkan', 'Riwayat akan tampil setelah draf mutasi diterapkan.')}
    </div>`;
    page(req, res, { title: 'Mutasi Kelas', sub: 'Pindahkan siswa antar kelas & tahun pelajaran', active: 'mutasi_kelas', content });
  });

  post('/mutasi-kelas/stage', (req, res) => {
    guard(req, res, 'mutasi_kelas', 'edit');
    const back = req.BASE + '/mutasi-kelas';
    const tujuan = dbm.kelasById(req.body.kelas_tujuan);
    const asal = req.body.kelas_asal ? dbm.kelasById(req.body.kelas_asal) : null;
    const ids = [].concat(req.body.siswa_id || []);
    if (!tujuan) return res.redirect(back + '?err=' + encodeURIComponent('Pilih kelas tujuan terlebih dahulu.'));
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Centang minimal satu siswa.'));
    let n = 0, nLintas = 0;
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO siswa_mutasi (siswa_id,kelas_asal_id,kelas_tujuan_id,ta_asal_id,ta_tujuan_id,status,created_by,created_at)
        VALUES (?,?,?,?,?,'draft',?,?)`);
      for (const id of ids) {
        const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(id);
        if (!s) continue;
        const dup = db.prepare("SELECT id FROM siswa_mutasi WHERE siswa_id=? AND status='draft'").get(s.id);
        if (dup) continue;
        // kelas asal diambil dari pilihan filter (penempatan yang sedang dilihat), bukan cache siswa
        const asalKelasId = asal ? asal.id : s.kelas_id;
        const asalTaId = asal ? asal.tahun_ajaran_id : s.tahun_ajaran_id;
        ins.run(s.id, asalKelasId, tujuan.id, asalTaId, tujuan.tahun_ajaran_id, req.user.id, nowStamp());
        if (String(asalTaId) !== String(tujuan.tahun_ajaran_id)) nLintas++;
        n++;
      }
    })();
    dbm.logAudit(req.user, 'MUTASI DRAF', 'mutasi_kelas', `${n} siswa → ${tujuan.nama}${nLintas ? ` (${nLintas} lintas tahun pelajaran)` : ''}`);
    res.redirect(back + '?ok=' + encodeURIComponent(`${n} siswa masuk draf mutasi ke ${tujuan.nama}. Klik "Terapkan Semua" untuk memproses.`));
  });

  post('/mutasi-kelas/apply', (req, res) => {
    guard(req, res, 'mutasi_kelas', 'edit');
    const back = req.BASE + '/mutasi-kelas';
    const drafts = db.prepare("SELECT * FROM siswa_mutasi WHERE status='draft'").all();
    let n = 0, nLintas = 0;
    db.transaction(() => {
      for (const d of drafts) {
        const k = db.prepare('SELECT * FROM kelas WHERE id=?').get(d.kelas_tujuan_id);
        if (!k) continue;
        const siswaRow = db.prepare('SELECT * FROM siswa WHERE id=?').get(d.siswa_id);
        if (!siswaRow) continue;
        // 1) pastikan penempatan tahun ASAL tercatat (tidak menimpa yang sudah ada)
        if (d.ta_asal_id) dbm.penempatanSet(d.siswa_id, d.kelas_asal_id, d.ta_asal_id, { sumber: 'mutasi', mutasiId: d.id, overwrite: false });
        // 2) tambahkan / perbarui penempatan pada tahun TUJUAN
        dbm.penempatanSet(d.siswa_id, k.id, k.tahun_ajaran_id, { sumber: 'mutasi', mutasiId: d.id });
        // 3) kolom cache siswa mengikuti penempatan tahun pelajaran terbaru
        dbm.siswaSyncCurrent(d.siswa_id);
        db.prepare("UPDATE siswa_mutasi SET status='ditetapkan',applied_at=?,applied_by=? WHERE id=?").run(nowStamp(), req.user.nama, d.id);
        if (String(d.ta_asal_id || '') !== String(k.tahun_ajaran_id)) nLintas++;
        n++;
      }
    })();
    dbm.logAudit(req.user, 'MUTASI', 'mutasi_kelas', `Menerapkan ${n} mutasi kelas${nLintas ? ` (${nLintas} lintas tahun pelajaran — data tahun asal dipertahankan)` : ''}`);
    res.redirect(back + '?ok=' + encodeURIComponent(`${n} mutasi kelas diterapkan.` + (nLintas ? ` ${nLintas} di antaranya lintas tahun pelajaran — data siswa pada tahun pelajaran asal tetap tersimpan.` : '')));
  });

  post('/mutasi-kelas/delete', (req, res) => {
    guard(req, res, 'mutasi_kelas', 'edit');
    const back = req.BASE + '/mutasi-kelas';
    if (req.body.id) db.prepare("DELETE FROM siswa_mutasi WHERE id=? AND status='draft'").run(req.body.id);
    else db.prepare("DELETE FROM siswa_mutasi WHERE status='draft'").run();
    dbm.logAudit(req.user, 'HAPUS', 'mutasi_kelas', 'Menghapus draf mutasi kelas');
    res.redirect(back + '?ok=' + encodeURIComponent('Draf mutasi dihapus.'));
  });

  /* ================= SISWA NON-AKTIF ================= */
  get('/siswa-nonaktif', (req, res) => {
    guard(req, res, 'siswa', 'view');
    const c = ctx(req);
    const st = ['lulus', 'pindah', 'do', 'nonaktif'].includes(req.query.get('status') || '') ? req.query.get('status') : '';
    const rows = dbm.siswaList({ status: st ? [st] : ['lulus', 'pindah', 'do', 'nonaktif'] });
    const editable = c.can('siswa', 'edit');
    const late = modalCollector();
    const content = `<div class="card">
      <div class="card-head"><div><h3>Siswa Non-Aktif</h3><div class="sub">${rows.length} siswa — lulus, pindah/mutasi keluar, atau drop out</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/siswa-nonaktif"><select name="status" data-autosubmit>
            <option value="">Semua Status</option>
            ${['nonaktif', 'lulus', 'pindah', 'do'].map(s => `<option value="${s}" ${st === s ? 'selected' : ''}>${esc((dbm.SISWA_STATUS[s] || [s])[0])}</option>`).join('')}
          </select></form>
        </div></div>
      ${rows.length ? `<form method="post" action="${c.base}/siswa/aktifkan-bulk" id="fAktifBulk"></form>
        <div class="between mb-1">
          <div class="small muted">Centang siswa lalu klik <b>Aktifkan Kembali Siswa Terpilih</b> untuk mengaktifkan banyak siswa sekaligus.</div>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-check-all="siswa_id">${ui.icon('check')}Pilih Semua</button>
            <button type="button" class="btn btn-sm" data-check-none="siswa_id">${ui.icon('x')}Hapus Ceklis</button>
          </div>
        </div>
        <div class="table-wrap sticky-head"><table><thead><tr>
          <th style="width:38px"><input type="checkbox" data-check-all-box="siswa_id" title="Pilih semua siswa"></th>
          <th>NISN</th><th>Nama</th><th>Kelas Terakhir</th><th>Status</th><th class="num">Sisa Tagihan</th><th class="right">Aksi</th>
        </tr></thead><tbody>
        ${rows.map(s => {
      const tags = dbm.iuranTagihanRows({ siswaId: s.id });
      const rk = dbm.iuranRekapSiswa(tags)[0] || { sisa: 0 };
      return `<tr><td><input type="checkbox" name="siswa_id" value="${s.id}" form="fAktifBulk"></td>
        <td class="mono">${esc(s.nisn || '-')}</td><td class="t-strong">${esc(s.nama)}</td>
        <td>${esc(s.kelas_nama || '-')}</td><td>${statusBadge(s.status)}</td>
        <td class="num">${rupiah(rk.sisa)}</td>
        <td class="right nowrap">
          ${editable ? `<form method="post" action="${c.base}/siswa/status" style="display:inline"><input type="hidden" name="id" value="${s.id}"><input type="hidden" name="aksi" value="status"><input type="hidden" name="status" value="aktif"><button class="btn btn-sm btn-green" title="Aktifkan kembali">${ui.icon('refresh')}Aktifkan Kembali</button></form>` : ''}
          ${c.can('siswa', 'delete') ? `<form method="post" action="${c.base}/siswa/delete" style="display:inline" data-confirm="Hapus permanen siswa ${esc(s.nama)}? Data masih bisa dipulihkan dari Kotak Sampah 30 hari."><input type="hidden" name="id" value="${s.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Permanen</button></form>` : ''}
        </td></tr>`;
    }).join('')}
      </tbody></table></div>
        ${editable ? `<div class="form-actions">
          <button type="button" class="btn" data-check-all="siswa_id">${ui.icon('check')}Pilih Semua</button>
          <button type="button" class="btn" data-check-none="siswa_id">${ui.icon('x')}Hapus Ceklis</button>
          <button class="btn btn-green" form="fAktifBulk" data-confirm-click="Aktifkan kembali semua siswa yang dicentang?">${ui.icon('refresh')}Aktifkan Kembali Siswa Terpilih</button>
        </div>` : ''}` : ui.emptyState('Tidak ada siswa non-aktif', 'Siswa yang dinonaktifkan atau lulus akan tampil di sini.')}
      ${late.html()}
    </div>
    <p class="help mt-2">Siswa berstatus selain <b>Aktif</b> otomatis tidak muncul pada halaman <b>Data Iuran &amp; Tagihan Aktif</b>. Perubahan status <b>Pindah / Mutasi Keluar</b> atau <b>Drop Out</b> dari halaman Data Siswa akan menanyakan perlakuan sisa tagihan: <b>Pemutihan</b> (tidak membebani piutang aktif) atau <b>Piutang Tak Tertagih</b> (dibekukan untuk audit).</p>`;
    page(req, res, { title: 'Siswa Non-Aktif', sub: 'Kelola siswa lulus, pindah & drop out', active: 'siswa_nonaktif', content });
  });

  /* aktifkan kembali banyak siswa sekaligus */
  post('/siswa/aktifkan-bulk', (req, res) => {
    guard(req, res, 'siswa', 'edit');
    const back = req.BASE + '/siswa-nonaktif';
    const ids = [].concat(req.body.siswa_id || []).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '?err=' + encodeURIComponent('Centang minimal satu siswa yang akan diaktifkan kembali.'));
    let n = 0;
    db.transaction(() => {
      const upd = db.prepare("UPDATE siswa SET status='aktif', updated_at=? WHERE id=?");
      for (const id of ids) {
        const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(id);
        if (!s || s.status === 'aktif') continue;
        upd.run(nowStamp(), id);
        n++;
      }
    })();
    dbm.logAudit(req.user, 'STATUS SISWA', 'siswa', `Aktivasi massal: ${n} siswa dikembalikan ke status aktif`);
    res.redirect(back + '?ok=' + encodeURIComponent(`${n} siswa diaktifkan kembali.`));
  });
};
