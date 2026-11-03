'use strict';
/**
 * Master Data Beasiswa — multi-grup iuran & multi-siswa penerima.
 * ------------------------------------------------------------------
 * Satu beasiswa dapat mencakup BEBERAPA grup iuran sekaligus dan
 * diberikan kepada BANYAK siswa dalam satu kali simpan.
 * Urutan form: (1) Detail Beasiswa → (2) Penetapan Siswa → (3) Rekap Data.
 * Filter kelas & pencarian siswa bekerja di sisi klien (tanpa reload),
 * sehingga isian nama/grup di atas tidak pernah ter-reset.
 */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, nowStamp } = lib;
  const BULAN_TA = dbm.BULAN_TA;
  const bulanLabel = b => (lib.BULAN[(Number(b) - 1 + 12) % 12] || '-');

  function rowsOf(taId) {
    const sel = `SELECT b.*, t.nama ta_nama,
        (SELECT COUNT(*) FROM beasiswa_siswa bs WHERE bs.beasiswa_id=b.id) n_siswa,
        (SELECT GROUP_CONCAT(g.nama, ', ') FROM beasiswa_grup bg JOIN iuran_grup g ON g.id=bg.grup_id WHERE bg.beasiswa_id=b.id) grup_list,
        (SELECT GROUP_CONCAT(bg.bulan_mask, '|') FROM beasiswa_grup bg WHERE bg.beasiswa_id=b.id) mask_list
      FROM beasiswa b LEFT JOIN tahun_ajaran t ON t.id=b.tahun_ajaran_id`;
    return taId ? db.prepare(sel + ' WHERE b.tahun_ajaran_id=? ORDER BY b.id DESC').all(taId)
      : db.prepare(sel + ' ORDER BY b.id DESC').all();
  }
  function sppTotals(taId) {
    const paid = dbm.sppTerimaMap(taId);
    const list = db.prepare('SELECT * FROM spp WHERE tahun_ajaran_id=?').all(taId);
    let tagih = 0, terima = 0;
    for (const r of list) {
      tagih += Number(r.total_ditagihkan || 0);
      terima += Number(r.diterima_manual || 0) + Number(paid[r.bulan] || 0);
    }
    return { tagih, terima, bruto: Math.max(0, tagih - terima) };
  }
  function grupNominalMap() {
    const map = {};
    for (const g of db.prepare('SELECT * FROM iuran_grup').all()) {
      const nom = dbm.iuranNominalMap(g.id);
      map[g.id] = {};
      for (const b of BULAN_TA) map[g.id][b] = Number(nom[b] || 0);
      map[g.id]['all'] = Object.values(nom).reduce((a, v) => a + Number(v || 0), 0);
    }
    return map;
  }
  /** daftar grup iuran yang dipakai satu beasiswa (multi) */
  function grupOf(id) { return dbm.beasiswaGrupList(id); }
  function maskOf(id) {
    const m = new Set();
    for (const g of grupOf(id)) String(g.bulan_mask || '').split(',').map(Number).filter(Boolean).forEach(x => m.add(x));
    return [...m].sort((a, b) => a - b);
  }

  get('/beasiswa', (req, res) => {
    guard(req, res, 'beasiswa', 'view');
    const c = ctx(req);
    const taList = dbm.allTahun();
    const taAktif = c.ta;
    const taId = Number(req.query.get('ta') || (taAktif ? taAktif.id : (taList[0] || {}).id)) || null;
    const ta = taList.find(t => String(t.id) === String(taId)) || taAktif;
    const rows = rowsOf(taId);
    const total = rows.filter(r => r.aktif).reduce((s, r) => s + Number(r.nominal || 0), 0);
    const st = taId ? sppTotals(taId) : { tagih: 0, terima: 0, bruto: 0 };
    const nett = Math.max(0, st.bruto - total);
    const editable = c.can('beasiswa', 'edit');
    const canCreate = c.can('beasiswa', 'create');
    const editId = Number(req.query.get('edit') || 0);
    const ed = editId ? db.prepare('SELECT * FROM beasiswa WHERE id=?').get(editId) : null;
    const edGrup = ed ? grupOf(ed.id) : [];
    const edGrupIds = edGrup.map(g => String(g.grup_id));
    const edBulan = ed ? maskOf(ed.id) : [];
    const edRecips = ed ? dbm.beasiswaSiswaList(ed.id) : [];
    const edSiswa = new Set(edRecips.map(x => x.siswa_id));
    const edPerSiswa = ed
      ? (edRecips.length ? Math.round(Number(ed.nominal || 0) / edRecips.length) : Number(ed.nominal || 0))
      : 0;

    const groups = dbm.iuranGrupList(taId, {});
    const kelasAll = dbm.kelasList(taId, {});
    const siswaRows = dbm.siswaList({ taId, status: 'aktif' });
    const nominalMap = grupNominalMap();

    /* ---------- STEP 1: detail beasiswa ---------- */
    const detailCard = `<div class="card mb-3" data-bea-step="1">
      <div class="card-head"><div><h3><span class="step-no">1</span> Detail Beasiswa</h3>
        <div class="sub">Nama, sumber dana, grup iuran yang mendapat potongan &amp; besaran beasiswa</div></div>
        ${ed ? `<div class="toolbar"><span class="badge orange">Mode Edit</span><a class="btn btn-sm" href="${c.base}/beasiswa?ta=${esc(taId || '')}">${ui.icon('x')}Batal Edit</a></div>` : ''}</div>
      <form method="post" action="${c.base}/beasiswa/save" id="fBeasiswa" data-bea-form>
        <input type="hidden" name="id" value="${ed ? ed.id : ''}">
        <input type="hidden" name="tahun_ajaran_id" value="${esc(taId || '')}">
        <input type="hidden" name="back" value="/beasiswa?ta=${esc(taId || '')}">
        <div class="row2">
          <div class="field"><label>Nama Beasiswa <span style="color:var(--red)">*</span></label>
            <input name="nama" value="${esc(ed ? ed.nama : '')}" required maxlength="120" placeholder="Contoh: Beasiswa Prestasi Akademik"></div>
          <div class="field"><label>Tahun Ajaran</label>
            <input value="TA ${esc(ta ? ta.nama : '-')}" readonly></div>
        </div>
        <div class="field"><label>Deskripsi / Sumber Dana</label>
          <input name="deskripsi" value="${esc(ed ? (ed.deskripsi || '') : '')}" maxlength="200" placeholder="Contoh: Dana yayasan semester ganjil"></div>

        <div class="field"><label>Grup Iuran yang Mendapat Beasiswa <span style="color:var(--red)">*</span>
          <span class="t-sub">(boleh pilih lebih dari satu)</span></label>
          <div class="bea-group-pick">
            ${groups.length ? groups.map(g => `<label class="check bea-group-item" data-bea-group-item="${g.id}">
              <input type="checkbox" name="grup_id" value="${g.id}" data-bea-group="${g.id}" data-jenis="${esc(g.jenis)}"
                ${edGrupIds.includes(String(g.id)) || (!ed && groups.length === 1) ? 'checked' : ''}>
              <span><b>${esc(g.nama)}</b>
                <span class="badge ${g.jenis === 'bulanan' ? 'blue' : 'orange'} plain">${g.jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'}</span>
                <span class="t-sub">${rupiah(g.total_nominal || 0)}</span></span>
            </label>`).join('') : '<div class="muted small">Belum ada grup iuran pada tahun pelajaran ini.</div>'}
          </div>
          <div class="help">Centang semua grup yang mendapat potongan. Potongan dibagi berurutan sesuai urutan grup di atas.</div></div>

        <div data-bea-bulan-wrap style="display:${edBulan.length || !ed ? '' : 'none'}">
          <div class="field"><label>Bulan yang Mendapat Beasiswa <span class="t-sub">(untuk grup bulanan)</span></label>
            <div class="bea-months">
              ${BULAN_TA.map(b => `<label class="check"><input type="checkbox" name="bulan" value="${b}" data-bea-bulan
                ${(edBulan.length ? edBulan.includes(b) : true) ? 'checked' : ''}>
                <span>${esc(bulanLabel(b))}</span></label>`).join('')}
            </div>
            <div class="toolbar mt-1"><button type="button" class="btn btn-sm" data-bea-bulan-all>${ui.icon('check')}Pilih Semua Bulan</button>
              <button type="button" class="btn btn-sm" data-bea-bulan-none>${ui.icon('x')}Kosongkan</button></div>
            <div class="help">Bila semua bulan dikosongkan, potongan berlaku untuk seluruh bulan yang ditagihkan.</div></div>
        </div>

        <div class="row3">
          <div class="field"><label>Potongan per Siswa (Rp)</label>
            ${ui.moneyInput('nominal_potongan', edPerSiswa || 0, 'data-bea-nominal')}
            <div class="hint">Nilai potongan untuk <b>satu siswa</b>. Total beasiswa = potongan × jumlah siswa penerima.</div></div>
          <div class="field"><label>Atau Persentase (%)</label>
            <input type="text" inputmode="decimal" name="persen" value="${esc(ed && Number(ed.persen) ? String(Number(ed.persen)).replace('.', ',') : '')}" data-bea-persen placeholder="mis. 50">
            <div class="hint">Dihitung dari total tagihan grup &amp; bulan terpilih.</div></div>
          <div class="field"><label>Status Beasiswa</label>
            <label class="check"><input type="checkbox" name="aktif" value="1" ${!ed || ed.aktif ? 'checked' : ''}> Aktif (mengurangi tunggakan)</label>
            <div class="hint">Beasiswa nonaktif disimpan sebagai catatan tanpa potongan.</div></div>
        </div>

        <div class="bea-calc" data-bea-calc>
          <div><span class="muted small">Total tagihan grup &amp; bulan terpilih</span><b data-bea-tagihan>Rp 0</b></div>
          <div><span class="muted small">Potongan per siswa</span><b data-bea-per-siswa>Rp 0</b></div>
          <div><span class="muted small">Siswa penerima</span><b data-bea-jumlah>0</b></div>
          <div><span class="muted small">Total nilai beasiswa</span><b data-bea-total>Rp 0</b></div>
        </div>
      </form>
    </div>`;

    /* ---------- STEP 2: penetapan siswa (masih di dalam form yang sama) ---------- */
    const siswaCard = `<div class="card mb-3" data-bea-step="2">
      <div class="card-head"><div><h3><span class="step-no">2</span> Penetapan Siswa Penerima</h3>
        <div class="sub">Filter kelas &amp; cari nama di sini — isian detail beasiswa di atas tidak akan hilang</div></div>
        <div class="toolbar"><span class="badge blue plain"><b data-bea-jumlah>0</b> siswa dipilih</span></div></div>
      <div class="filterbar">
        <div class="field"><label>Filter Kelas <span class="t-sub">(tanpa memuat ulang halaman)</span></label>
          <select data-bea-kelas>
            <option value="">Semua kelas</option>
            ${kelasAll.map(k => `<option value="${esc(k.nama)}">${esc(k.nama)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Cari Nama / NISN</label>
          <input data-bea-search placeholder="Ketik nama atau NISN" autocomplete="off"></div>
        <div class="field"><label>Pilih Cepat</label>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" data-bea-pick-visible>${ui.icon('check')}Pilih yang Tampil</button>
            <button type="button" class="btn btn-sm" data-bea-unpick>${ui.icon('x')}Kosongkan</button>
          </div></div>
      </div>
      <div class="table-scroll tall"><table id="tblPenerimaBea"><thead><tr>
        <th style="width:40px"><input type="checkbox" data-check-all-box="penerima" form="fBeasiswa"></th>
        <th>NISN</th><th>Nama Siswa</th><th>Kelas</th><th>Status</th>
      </tr></thead><tbody>
      ${siswaRows.length ? siswaRows.map(s => `<tr data-bea-row data-kelas="${esc(s.kelas_nama || '')}"
          data-cari="${esc((String(s.nama || '') + ' ' + String(s.nisn || '')).toLowerCase())}">
        <td><input type="checkbox" form="fBeasiswa" name="penerima" value="${s.id}" ${edSiswa.has(s.id) ? 'checked' : ''}></td>
        <td class="mono">${esc(s.nisn || '-')}</td>
        <td class="t-strong">${esc(s.nama)}</td>
        <td>${esc(s.kelas_nama || '-')}</td>
        <td>${ui.badge(s.status === 'aktif' ? 'Aktif' : s.status, s.status === 'aktif' ? 'green' : 'gray')}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="center muted">Belum ada siswa aktif pada tahun pelajaran ini.</td></tr>'}
      </tbody></table></div>
      <div class="help mt-1">Tip: gunakan <b>Pilih yang Tampil</b> setelah memfilter kelas untuk memilih satu kelas sekaligus.</div>
    </div>`;

    /* ---------- STEP 3: rekap data ---------- */
    const rekapCard = `<div class="card mb-3" data-bea-step="3">
      <div class="card-head"><div><h3><span class="step-no">3</span> Rekap Data</h3>
        <div class="sub">Periksa ringkasan sebelum menyimpan</div></div>
        ${canCreate ? `<div class="toolbar"><button class="btn btn-primary" type="submit" form="fBeasiswa">${ui.icon('save')}${ed ? 'Simpan Perubahan' : 'Simpan Beasiswa'}</button></div>` : ''}</div>
      <div class="bea-rekap" data-bea-rekap>
        <div class="kv">
          <dt>Nama Beasiswa</dt><dd data-bea-r-nama>${esc(ed ? ed.nama : '(belum diisi)')}</dd>
          <dt>Grup Iuran</dt><dd data-bea-r-grup>${esc(ed ? (edGrup.map(g => (groups.find(x => x.id === g.grup_id) || {}).nama).filter(Boolean).join(', ') || '-') : '-')}</dd>
          <dt>Bulan</dt><dd data-bea-r-bulan>${esc(edBulan.length ? edBulan.map(bulanLabel).join(', ') : 'Semua bulan yang ditagihkan')}</dd>
          <dt>Potongan per Siswa</dt><dd data-bea-r-per>Rp 0</dd>
          <dt>Jumlah Siswa</dt><dd data-bea-r-siswa>0</dd>
          <dt>Total Nilai Beasiswa</dt><dd data-bea-r-total>Rp 0</dd>
        </div>
      </div>
      ${ed && edRecips.length ? `<div class="t-strong mt-2 mb-1">Penerima tersimpan saat ini</div>
        <div class="table-scroll short"><table><thead><tr><th>Nama Siswa</th><th>Kelas</th><th class="num">Potongan</th></tr></thead><tbody>
        ${edRecips.map(x => `<tr><td>${esc(x.siswa_nama)}</td><td>${esc(x.kelas_nama || '-')}</td><td class="num">${rupiah(x.nominal)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      ${canCreate ? `<div class="form-actions"><button class="btn btn-primary" type="submit" form="fBeasiswa">${ui.icon('save')}${ed ? 'Simpan Perubahan' : 'Simpan Beasiswa'}</button>
        <a class="btn" href="${c.base}/beasiswa?ta=${esc(taId || '')}">${ui.icon('refresh')}Reset Form</a></div>` : ''}
    </div>`;

    const content = `<div class="between mb-2">
      <div class="flex">
        <form method="get" action="${c.base}/beasiswa"><select name="ta" data-autosubmit>
          ${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select></form>
      </div>
      <div class="toolbar">
        <a class="btn btn-sm" href="${c.base}/iuran">${ui.icon('coins')}Grup Iuran</a>
        <a class="btn btn-sm" href="${c.base}/spp">${ui.icon('target')}Rekap SPP</a>
      </div>
    </div>
    <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('target')}</div><div class="lbl">Total Ditagihkan SPP</div><div class="val" style="font-size:18px">${rupiah(st.tagih)}</div><div class="meta">TA ${esc(ta ? ta.nama : '-')}</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Diterima</div><div class="val" style="font-size:18px">${rupiah(st.terima)}</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Total Beasiswa</div><div class="val" style="font-size:18px">${rupiah(total)}</div><div class="meta">${rows.filter(r => r.aktif).length} item aktif</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Piutang SPP Setelah Beasiswa</div><div class="val" style="font-size:18px">${rupiah(nett)}</div><div class="meta">Sebelum beasiswa ${rupiah(st.bruto)}</div></div>
    </div>

    ${canCreate || ed ? detailCard : `<div class="alert info mb-3">${ui.icon('info')}<div>Anda hanya dapat melihat data beasiswa (tanpa hak menambah/mengubah).</div></div>`}
    ${canCreate || ed ? siswaCard : ''}
    ${canCreate || ed ? rekapCard : ''}

    <div class="card">
      <div class="card-head"><div><h3>Data Beasiswa</h3><div class="sub">Nilai beasiswa mengurangi tunggakan iuran/SPP siswa penerima</div></div></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nama Beasiswa</th><th>Grup Iuran</th><th>Bulan</th><th class="num">Potongan / Siswa</th><th class="num">Persen</th><th class="num">Penerima</th><th class="num">Total</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${rows.map(b => {
          const n = Number(b.n_siswa || 0);
          const per = n > 0 ? Math.round(Number(b.nominal || 0) / n) : Number(b.nominal || 0);
          const masks = String(b.mask_list || '').split('|').map(s => String(s).split(',').map(Number).filter(Boolean));
          const mset = new Set(); masks.forEach(a => a.forEach(x => mset.add(x)));
          const bl = [...mset].sort((x, y) => BULAN_TA.indexOf(x) - BULAN_TA.indexOf(y)).map(bulanLabel).join(', ');
          return `<tr><td class="t-strong">${esc(b.nama)}<div class="t-sub">${esc(b.deskripsi || '-')}</div></td>
          <td>${esc(b.grup_list || '-')}</td>
          <td class="t-sub">${esc(bl || 'Semua bulan')}</td>
          <td class="num t-strong">${rupiah(per)}</td>
          <td class="num">${Number(b.persen) ? String(Number(b.persen)).replace('.', ',') + '%' : '—'}</td>
          <td class="num">${n}</td>
          <td class="num t-strong">${rupiah(Number(b.nominal || 0))}</td>
          <td>${b.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</td>
          <td class="right nowrap">${editable ? `<a class="btn btn-sm btn-icon" href="${c.base}/beasiswa?ta=${esc(taId)}&edit=${b.id}" title="Edit beasiswa">${ui.icon('edit')}</a>` : ''}
            ${c.can('beasiswa', 'delete') ? `<form method="post" action="${c.base}/beasiswa/delete" style="display:inline" data-confirm="Hapus beasiswa ${esc(b.nama)}?"><input type="hidden" name="id" value="${b.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}</td></tr>`;
        }).join('')}
      </tbody><tfoot><tr><td colspan="6">TOTAL BEASISWA AKTIF</td><td class="num">${rupiah(total)}</td><td colspan="2"></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada data beasiswa', 'Isi form beasiswa di atas, pilih grup &amp; siswa penerima, lalu simpan.')}
      <div class="alert info mt-2">${ui.icon('info')}<div><b>Cara kerja:</b> total potongan beasiswa aktif dikurangkan dari tunggakan iuran/SPP tahun ajaran terkait,
        sehingga angka Piutang SPP pada dashboard, Aset Riil, Rekonsiliasi Kas, dan Rekap SPP ikut menyesuaikan otomatis.</div></div>
    </div>

    <script type="application/json" data-bea-nominal-map>${JSON.stringify(nominalMap).replace(/</g, '\\u003c')}</script>`;

    page(req, res, { title: 'Master Data Beasiswa', sub: 'Multi grup iuran & multi siswa penerima', active: 'beasiswa', content });
  });

  /* ================= simpan (tambah / edit) ================= */
  post('/beasiswa/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, 'beasiswa', isEdit ? 'edit' : 'create')) return;
    const nama = String(req.body.nama || '').trim();
    const taId = Number(req.body.tahun_ajaran_id || 0) || null;
    const backPath = '/beasiswa?ta=' + (taId || '');
    const back = req.BASE + backPath;
    if (!nama) return res.redirect(back + '&err=' + encodeURIComponent('Nama beasiswa wajib diisi.'));
    const grupIds = Array.from(new Set([].concat(req.body.grup_id || []).map(Number).filter(Boolean)));
    if (!grupIds.length) return res.redirect(back + '&err=' + encodeURIComponent('Pilih minimal satu grup iuran yang mendapat beasiswa.'));
    const bulan = [].concat(req.body.bulan || []).map(Number).filter(Boolean).sort((a, b) => a - b);
    const nominalPer = lib.parseMoney(req.body.nominal_potongan);
    const persen = Number(String(req.body.persen || '').replace(',', '.')) || 0;
    if (!(nominalPer > 0) && !(persen > 0)) return res.redirect(back + '&err=' + encodeURIComponent('Isi nominal potongan atau persentase beasiswa.'));
    const aktif = req.body.aktif ? 1 : 0;
    const deskripsi = String(req.body.deskripsi || '').trim();
    const bulanMask = bulan.join(',');
    const penerima = Array.from(new Set([].concat(req.body.penerima || []).map(Number).filter(Boolean)));
    const n = Math.max(1, penerima.length);
    const totalNominal = Math.round(nominalPer * n);

    const beaId = db.transaction(() => {
      let id;
      if (isEdit) {
        id = Number(req.body.id);
        db.prepare('UPDATE beasiswa SET nama=?,deskripsi=?,tahun_ajaran_id=?,nominal=?,persen=?,grup_id=?,bulan_mask=?,aktif=?,keterangan=? WHERE id=?')
          .run(nama, deskripsi, taId, totalNominal, persen, grupIds[0], bulanMask, aktif, deskripsi, id);
        db.prepare('DELETE FROM beasiswa_siswa WHERE beasiswa_id=?').run(id);
      } else {
        const info = db.prepare(`INSERT INTO beasiswa (nama,deskripsi,tahun_ajaran_id,nominal,persen,grup_id,bulan_mask,aktif,keterangan,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(nama, deskripsi, taId, totalNominal, persen, grupIds[0], bulanMask, aktif, deskripsi, nowStamp());
        id = Number(info.lastInsertRowid);
      }
      dbm.beasiswaGrupSet(id, grupIds.map(gid => ({ grup_id: gid, bulan_mask: bulanMask })));
      const ins = db.prepare('INSERT OR IGNORE INTO beasiswa_siswa (beasiswa_id,siswa_id,nominal) VALUES (?,?,?)');
      for (const sid of penerima) ins.run(id, sid, nominalPer);
      return id;
    })();
    let synced = { rows: 0, students: 0 };
    try { synced = dbm.beasiswaSync(beaId); } catch (e) { console.error('[beasiswa]', e.message); }
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'beasiswa',
      `${isEdit ? 'Edit' : 'Tambah'} beasiswa ${nama} — ${grupIds.length} grup iuran, potongan ${rupiah(nominalPer)}/siswa` +
      `${persen ? ` (${String(persen).replace('.', ',')}%)` : ''} · ${penerima.length} penerima (total ${rupiah(totalNominal)})`);
    res.redirect(back + '&ok=' + encodeURIComponent(
      `Data beasiswa disimpan: ${grupIds.length} grup iuran · ${penerima.length} siswa penerima · total ${rupiah(totalNominal)}.` +
      ` ${synced.rows} tagihan iuran otomatis dilunasi & dikunci.`));
  });

  /* ================= simpan final dari pratinjau (JSON payload, kompatibilitas) ================= */
  post('/beasiswa/save-final', (req, res) => {
    if (!guard(req, res, 'beasiswa', 'create')) return;
    let payload = null;
    try { payload = JSON.parse(String(req.body.payload || '{}')); } catch (e) { payload = null; }
    const back = req.BASE + '/beasiswa?ta=' + (req.body.tahun_ajaran_id || '');
    if (!payload || !payload.nama) return res.redirect(back + '&err=' + encodeURIComponent('Data pratinjau tidak valid. Ulangi pengisian form.'));
    const taId = Number(payload.tahun_ajaran_id || req.body.tahun_ajaran_id || 0) || null;
    const ids = (payload.siswa || []).map(Number).filter(Boolean);
    if (!ids.length) return res.redirect(back + '&err=' + encodeURIComponent('Centang minimal satu siswa penerima beasiswa.'));
    const nominalPer = Math.round(Number(payload.nominal_per_siswa) || 0);
    const total = ids.reduce((a, sid) => a + nominalPer, 0);
    const grupIds = [].concat(payload.grup_ids || payload.grup_id || []).map(Number).filter(Boolean);
    const info = db.transaction(() => {
      const r = db.prepare(`INSERT INTO beasiswa (nama,deskripsi,tahun_ajaran_id,nominal,persen,grup_id,bulan_mask,aktif,keterangan,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        String(payload.nama).trim(), String(payload.deskripsi || '').trim(), taId, total,
        Number(payload.persen) || 0, grupIds[0] || null, String(payload.bulan_mask || ''),
        payload.aktif === false ? 0 : 1, String(payload.deskripsi || ''), nowStamp());
      const bid = Number(r.lastInsertRowid);
      dbm.beasiswaGrupSet(bid, grupIds.map(gid => ({ grup_id: gid, bulan_mask: String(payload.bulan_mask || '') })));
      const ins = db.prepare('INSERT OR IGNORE INTO beasiswa_siswa (beasiswa_id,siswa_id,nominal) VALUES (?,?,?)');
      for (const sid of ids) ins.run(bid, sid, nominalPer);
      return { bid, n: ids.length };
    })();
    let synced = { rows: 0, students: 0 };
    try { synced = dbm.beasiswaSync(info.bid); } catch (e) { console.error('[beasiswa]', e.message); }
    dbm.logAudit(req.user, 'TAMBAH', 'beasiswa',
      `Beasiswa ${payload.nama} ditetapkan untuk ${info.n} siswa · potongan ${rupiah(nominalPer)}/siswa (total ${rupiah(total)})` +
      ` · ${synced.rows} pembayaran iuran otomatis (status LUNAS & terkunci)`);
    res.redirect(back + '&ok=' + encodeURIComponent(`Beasiswa ${payload.nama} disimpan untuk ${info.n} siswa (total potongan ${rupiah(total)}). ${synced.rows} tagihan iuran otomatis dilunasi & dikunci.`));
  });

  post('/beasiswa/delete', (req, res) => {
    if (!guard(req, res, 'beasiswa', 'delete')) return;
    const b = db.prepare('SELECT * FROM beasiswa WHERE id=?').get(req.body.id);
    if (b) {
      const anak = db.prepare('SELECT * FROM beasiswa_siswa WHERE beasiswa_id=?').all(b.id);
      const grup = db.prepare('SELECT * FROM beasiswa_grup WHERE beasiswa_id=?').all(b.id);
      dbm.trashAdd('beasiswa', b, {
        user: req.user, label: `Beasiswa ${b.nama} ${rupiah(b.nominal)}`,
        extra: { children: [{ tabel: 'beasiswa_siswa', rows: anak }, { tabel: 'beasiswa_grup', rows: grup }] }
      });
    }
    db.transaction(() => {
      db.prepare("DELETE FROM iuran_bayar WHERE sumber='beasiswa' AND beasiswa_id=?").run(req.body.id);
      db.prepare('UPDATE iuran_tagihan SET beasiswa_locked=0, beasiswa_id=NULL WHERE beasiswa_id=?').run(req.body.id);
      db.prepare('DELETE FROM beasiswa_siswa WHERE beasiswa_id=?').run(req.body.id);
      db.prepare('DELETE FROM beasiswa_grup WHERE beasiswa_id=?').run(req.body.id);
      db.prepare('DELETE FROM beasiswa WHERE id=?').run(req.body.id);
    })();
    try { dbm.beasiswaCleanup(); } catch (e) { }
    dbm.logAudit(req.user, 'HAPUS', 'beasiswa', `Hapus beasiswa ${b ? b.nama : req.body.id} (pembayaran iuran otomatisnya ikut dibatalkan)`);
    res.redirect(req.BASE + '/beasiswa?ok=' + encodeURIComponent('Data beasiswa dihapus.'));
  });
};
