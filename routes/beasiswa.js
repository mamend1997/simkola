'use strict';
/* Master Data Beasiswa — grup iuran + bulan, potongan nominal/persentase, penerima per siswa */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, nowStamp } = lib;
  const BULAN_TA = dbm.BULAN_TA;
  const bulanLabel = b => (lib.BULAN[(Number(b) - 1 + 12) % 12] || '-');

  function rowsOf(taId) {
    const sel = `SELECT b.*, t.nama ta_nama, g.nama grup_nama, g.jenis grup_jenis,
        (SELECT COUNT(*) FROM beasiswa_siswa bs WHERE bs.beasiswa_id=b.id) n_siswa
      FROM beasiswa b LEFT JOIN tahun_ajaran t ON t.id=b.tahun_ajaran_id
      LEFT JOIN iuran_grup g ON g.id=b.grup_id`;
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
  /** nominal tagihan satu grup (total semua bulan) */
  function grupNominal(grupId) {
    const map = dbm.iuranNominalMap(grupId);
    return Object.values(map).reduce((a, v) => a + Number(v || 0), 0);
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
    const editId = req.query.get('edit');
    const ed = editId ? db.prepare('SELECT * FROM beasiswa WHERE id=?').get(editId) : null;

    const groups = dbm.iuranGrupList(taId, {});
    const kelasAll = dbm.kelasList(taId, {});
    const kelasPick = req.query.get('kelas') || '';
    const qSiswa = String(req.query.get('q') || '').trim();
    let siswaRows = dbm.siswaList({ taId, status: 'aktif', kelasId: kelasPick || undefined });
    if (qSiswa) {
      const qq = qSiswa.toLowerCase();
      siswaRows = siswaRows.filter(s => String(s.nama || '').toLowerCase().includes(qq) || String(s.nisn || '').includes(qSiswa));
    }
    const editSiswa = ed ? new Set(dbm.beasiswaSiswaList(ed.id).map(x => x.siswa_id)) : new Set();

    /* ---------- form beasiswa (dipakai modal tambah & edit) ---------- */
    const form = (b) => {
      const selBulan = String((b && b.bulan_mask) || '').split(',').map(Number).filter(Boolean);
      const grupId = b ? b.grup_id : (groups[0] ? groups[0].id : '');
      const g = groups.find(x => String(x.id) === String(grupId));
      const isBulanan = !!g && g.jenis === 'bulanan';
      // peta nominal per bulan untuk setiap grup (dipakai JS saat grup diganti)
      const nominalMap = {};
      for (const x of groups) {
        const nom = dbm.iuranNominalMap(x.id);
        nominalMap[x.id] = BULAN_TA.map(m => ({ b: m, n: Number(nom[m] || 0) }));
      }
      return `<form method="post" action="${c.base}/beasiswa/save" id="fBeaForm" data-bea-form>
        <script type="application/json" data-bea-nominal-map>${JSON.stringify(nominalMap).replace(/</g, '\\u003c')}</script>
        <input type="hidden" name="id" value="${b ? b.id : ''}">
        <input type="hidden" name="tahun_ajaran_id" value="${esc(taId || '')}">
        <div class="row2">
          <div class="field"><label>Nama Beasiswa</label>
            <input name="nama" value="${esc(b ? b.nama : '')}" required placeholder="Contoh: Beasiswa Prestasi Akademik"></div>
          <div class="field"><label>Tahun Ajaran</label>
            <input value="TA ${esc(ta ? ta.nama : '-')}" readonly></div>
        </div>
        <div class="field"><label>Deskripsi Beasiswa</label>
          <input name="deskripsi" value="${esc(b ? (b.deskripsi || '') : '')}" placeholder="Sumber dana / dasar pemberian beasiswa"></div>
        <div class="field"><label>Grup Iuran yang Mendapat Beasiswa</label>
          <select name="grup_id" data-bea-grup required>
            <option value="">— Pilih grup iuran —</option>
            ${groups.map(x => `<option value="${x.id}" data-jenis="${x.jenis}" data-nominal="${x.total_nominal}"
              ${String(x.id) === String(grupId) ? 'selected' : ''}>${esc(x.nama)} (${x.jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'} · ${rupiah(x.total_nominal)})</option>`).join('')}
          </select>
          <div class="hint">Potongan beasiswa dihitung dari tagihan grup iuran ini.</div></div>
        <div data-bea-bulan-wrap style="display:${isBulanan ? '' : 'none'}">
          <div class="field"><label>Bulan yang Mendapat Beasiswa</label>
            <div class="bea-months">
              ${BULAN_TA.map(x => {
        const nom = g ? (dbm.iuranNominalMap(g.id)[x] || 0) : 0;
        return `<label class="check"><input type="checkbox" name="bulan" value="${x}" data-bea-bulan data-bulan-nominal="${nom}" ${selBulan.includes(x) || (!b && !selBulan.length) ? 'checked' : ''}>
                  <span>${esc(bulanLabel(x))} <span class="t-sub" data-bea-bulan-nom>${nom ? rupiah(nom) : '-'}</span></span></label>`;
      }).join('')}
            </div>
            <div class="toolbar mt-1"><button type="button" class="btn btn-sm" data-bea-bulan-all>${ui.icon('check')}Pilih Semua Bulan</button>
              <button type="button" class="btn btn-sm" data-bea-bulan-none>${ui.icon('x')}Kosongkan</button></div></div>
        </div>
        <div class="row2">
          <div class="field"><label>Nominal Potongan (Rp)</label>${ui.moneyInput('nominal_potongan', b ? b.nominal : 0, 'data-bea-nominal')}
            <div class="hint">Nilai potongan untuk <b>satu siswa</b> (semua bulan terpilih).</div></div>
          <div class="field"><label>Persentase Potongan (%)</label>
            <input type="text" inputmode="decimal" name="persen" value="${esc(b && Number(b.persen) ? String(b.persen).replace('.', ',') : '')}" data-bea-persen placeholder="mis. 50">
            <div class="hint">Mengisi salah satu kolom otomatis menghitung kolom lainnya dari nilai tagihan.</div></div>
        </div>
        <div class="alert info">${ui.icon('info')}<div><b>Kalkulator dua arah:</b> isi <b>Nominal (Rp)</b> → persentase terhitung otomatis; isi <b>Persentase (%)</b> → nominal terhitung otomatis dari total tagihan grup/bulan terpilih.</div></div>
        <label class="check"><input type="checkbox" name="aktif" value="1" ${!b || b.aktif ? 'checked' : ''}> Beasiswa aktif (mengurangi tunggakan SPP/iuran)</label>
        ${b ? `<hr class="sep"><div class="t-strong">Penerima Beasiswa</div>
          <div class="table-scroll short"><table><thead><tr><th>Nama Siswa</th><th>Kelas</th><th class="num">Potongan</th></tr></thead><tbody>
          ${dbm.beasiswaSiswaList(b.id).map(x => `<tr><td>${esc(x.siswa_nama)}</td><td>${esc(x.kelas_nama || '-')}</td><td class="num">${rupiah(x.nominal)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Belum ada penerima.</td></tr>'}
          </tbody></table></div>` : ''}
      </form>`;
    };

    /* ---------- penetapan siswa (filter kelas + ceklis + preview) ---------- */
    const assignCard = editable ? `<div class="card mb-3">
      <div class="card-head"><div><h3>Penetapan Siswa Penerima Beasiswa</h3>
        <div class="sub">Isi form beasiswa di atas, pilih kelas, centang siswa penerima, lalu <b>Lanjutkan</b> untuk melihat pratinjau sebelum disimpan</div></div></div>
      <form method="get" action="${c.base}/beasiswa" class="filterbar">
        <input type="hidden" name="ta" value="${esc(taId || '')}">
        <div class="field"><label>Pencarian Nama Siswa <span class="t-sub">(filter langsung saat mengetik)</span></label>
          <input name="q" value="${esc(qSiswa)}" placeholder="Ketik nama / NISN siswa" autocomplete="off" data-table-search="#tblPenerimaBea">
        </div>
        <div class="field"><label>Filter Kelas</label><select name="kelas" data-autosubmit>
          <option value="">Semua kelas</option>
          ${kelasAll.map(k => `<option value="${k.id}" ${String(kelasPick) === String(k.id) ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}
        </select></div>
        <button class="btn">${ui.icon('search')}Terapkan</button>
        ${qSiswa || kelasPick ? `<a class="btn" href="${c.base}/beasiswa?ta=${esc(taId || '')}">Reset</a>` : ''}
      </form>
      <form method="post" action="${c.base}/beasiswa/save-final" id="fBeaFinal">
        <input type="hidden" name="payload" data-bea-payload>
        <div class="table-scroll short"><table id="tblPenerimaBea"><thead><tr>
          <th style="width:38px"><input type="checkbox" data-check-all-box="penerima"></th>
          <th>NISN</th><th>Nama Siswa</th><th>Kelas</th>
        </tr></thead><tbody>
        ${siswaRows.map(s => `<tr><td><input type="checkbox" name="penerima" value="${s.id}"
            ${editSiswa.has(s.id) ? 'checked' : ''}></td>
          <td class="mono">${esc(s.nisn || '-')}</td><td class="t-strong">${esc(s.nama)}</td><td>${esc(s.kelas_nama || '-')}</td></tr>`).join('')
        || '<tr><td colspan="4" class="center muted">Belum ada siswa aktif.</td></tr>'}
        </tbody></table></div>
        <div class="form-actions">
          <button type="button" class="btn" data-check-all="penerima">${ui.icon('check')}Pilih Semua</button>
          <button type="button" class="btn" data-check-none="penerima">${ui.icon('x')}Hapus Ceklis</button>
          <button type="button" class="btn btn-primary" data-bea-preview>${ui.icon('search')}Lanjutkan → Pratinjau</button>
        </div>
      </form>
    </div>` : '';

    const content = `<div class="between mb-2">
      <div class="flex">
        <form method="get" action="${c.base}/beasiswa"><select name="ta" data-autosubmit>
          ${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select></form>
      </div>
      <div class="toolbar">
        <a class="btn btn-sm" href="${c.base}/piutang?ta=${taId || ''}">${ui.icon('card')}Piutang &amp; SPP</a>
      </div>
    </div>
    <div class="kpi-grid mb-3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="kpi ic-orange"><div class="ico">${ui.icon('target')}</div><div class="lbl">Total Ditagihkan SPP</div><div class="val" style="font-size:18px">${rupiah(st.tagih)}</div><div class="meta">TA ${esc(ta ? ta.nama : '-')}</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Diterima</div><div class="val" style="font-size:18px">${rupiah(st.terima)}</div></div>
      <div class="kpi ic-blue"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Total Beasiswa</div><div class="val" style="font-size:18px">${rupiah(total)}</div><div class="meta">${rows.filter(r => r.aktif).length} item aktif</div></div>
      <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Piutang SPP Setelah Beasiswa</div><div class="val" style="font-size:18px">${rupiah(nett)}</div><div class="meta">Sebelum beasiswa ${rupiah(st.bruto)}</div></div>
    </div>

    ${canCreate ? `<div class="card mb-3">
      <div class="card-head"><div><h3>Form Input Beasiswa</h3><div class="sub">Nama &amp; deskripsi beasiswa, grup iuran yang mendapat beasiswa, bulan, dan potongan nominal/persentase</div></div></div>
      ${form(null)}
      <div class="form-actions">
        <button class="btn" form="fBeaForm">${ui.icon('save')}Simpan Tanpa Penerima</button>
        <span class="small muted">atau pilih siswa penerima pada panel di bawah, lalu klik <b>Lanjutkan → Pratinjau</b>.</span>
      </div>
    </div>` : ''}

    <div class="card mb-3">
      <div class="card-head"><div><h3>Data Beasiswa</h3><div class="sub">Nilai beasiswa mengurangi tunggakan iuran/SPP siswa penerima</div></div></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nama Beasiswa</th><th>Grup Iuran</th><th>Bulan</th><th class="num">Potongan / Siswa</th><th class="num">Persen</th><th class="num">Penerima</th><th class="num">Total</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${rows.map(b => {
      const bl = String(b.bulan_mask || '').split(',').map(Number).filter(Boolean).map(x => bulanLabel(x)).join(', ');
      return `<tr><td class="t-strong">${esc(b.nama)}<div class="t-sub">${esc(b.deskripsi || '-')}</div></td>
          <td>${esc(b.grup_nama || '-')}${b.grup_jenis ? ` <span class="badge ${b.grup_jenis === 'bulanan' ? 'blue' : 'orange'} plain">${b.grup_jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'}</span>` : ''}</td>
          <td class="t-sub">${esc(bl || 'Semua bulan')}</td>
          <td class="num t-strong">${rupiah(b.nominal)}</td>
          <td class="num">${Number(b.persen) ? String(Number(b.persen)).replace('.', ',') + '%' : '—'}</td>
          <td class="num">${b.n_siswa || 0}</td>
          <td class="num t-strong">${rupiah(Number(b.nominal || 0) * Number(b.n_siswa || 0))}</td>
          <td>${b.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</td>
          <td class="right nowrap">${editable ? `<a class="btn btn-sm btn-icon" href="${c.base}/beasiswa?ta=${taId}&edit=${b.id}" title="Edit">${ui.icon('edit')}</a>` : ''}
            ${c.can('beasiswa', 'delete') ? `<form method="post" action="${c.base}/beasiswa/delete" style="display:inline" data-confirm="Hapus beasiswa ${esc(b.nama)}?"><input type="hidden" name="id" value="${b.id}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}</td></tr>`;
    }).join('')}
      </tbody><tfoot><tr><td colspan="6">TOTAL BEASISWA AKTIF</td><td class="num">${rupiah(total)}</td><td colspan="2"></td></tr></tfoot></table></div>`
        : ui.emptyState('Belum ada data beasiswa', 'Isi form beasiswa di atas, pilih kelas &amp; siswa penerima, lalu simpan.')}
      <div class="alert info mt-2">${ui.icon('info')}<div><b>Cara kerja:</b> total potongan beasiswa aktif dikurangkan dari tunggakan iuran/SPP tahun ajaran terkait,
        sehingga angka Piutang SPP pada dashboard, Aset Riil, Rekonsiliasi Kas, dan Rekap SPP ikut menyesuaikan otomatis.</div></div>
    </div>

    ${assignCard}

    ${ed ? ui.modal('mEdit', {
      title: 'Edit Beasiswa', wide: true, body: form(ed),
      footer: `<button class="btn" data-close="mEdit">Batal</button><button class="btn btn-primary" form="fBeaForm">Simpan Perubahan</button>`
    }).replace('class="modal" id="mEdit"', 'class="modal show" id="mEdit"') : ''}

    ${ui.modal('mBeaPreview', {
      title: 'Pratinjau Rekapitulasi Beasiswa', wide: true,
      body: `<div data-bea-preview-body></div>
        <div class="alert info mt-2">${ui.icon('info')}<div>Periksa data di atas. Klik <b>Simpan Final</b> untuk menetapkan beasiswa kepada siswa terpilih.</div></div>`,
      footer: `<button class="btn" data-close="mBeaPreview">Batal</button>
        <button class="btn btn-primary" data-bea-save type="button">${ui.icon('save')}Simpan Final</button>`
    })}`;
    page(req, res, { title: 'Master Data Beasiswa', sub: 'Beasiswa per grup iuran, bulan & siswa penerima', active: 'beasiswa', content });
  });

  /* ================= simpan (tambah / edit master) ================= */
  post('/beasiswa/save', (req, res) => {
    const isEdit = !!req.body.id;
    if (!guard(req, res, 'beasiswa', isEdit ? 'edit' : 'create')) return;
    const nama = String(req.body.nama || '').trim();
    const taId = Number(req.body.tahun_ajaran_id || 0) || null;
    const back = req.BASE + '/beasiswa?ta=' + (taId || '');
    if (!nama) return res.redirect(back + '&err=' + encodeURIComponent('Nama beasiswa wajib diisi.'));
    const grupId = Number(req.body.grup_id || 0) || null;
    const bulan = [].concat(req.body.bulan || []).map(Number).filter(Boolean).sort((a, b) => a - b);
    const nominal = lib.parseMoney(req.body.nominal_potongan);
    const persen = Number(String(req.body.persen || '').replace(',', '.')) || 0;
    if (!(nominal > 0) && !(persen > 0)) return res.redirect(back + '&err=' + encodeURIComponent('Isi nominal potongan atau persentase beasiswa.'));
    const aktif = req.body.aktif ? 1 : 0;
    const deskripsi = String(req.body.deskripsi || '').trim();
    const bulanMask = bulan.join(',');
    // total nilai beasiswa = potongan per siswa × jumlah penerima
    const penerima = isEdit ? db.prepare('SELECT COUNT(*) c FROM beasiswa_siswa WHERE beasiswa_id=?').get(req.body.id).c : 0;
    const totalNilai = Math.round((nominal > 0 ? nominal : 0) * (penerima || 1));
    if (isEdit) {
      db.prepare('UPDATE beasiswa SET nama=?,deskripsi=?,tahun_ajaran_id=?,nominal=?,persen=?,grup_id=?,bulan_mask=?,aktif=? WHERE id=?')
        .run(nama, deskripsi, taId, nominal > 0 ? nominal : Number(req.body.nominal || 0), persen, grupId, bulanMask, aktif, req.body.id);
      db.prepare('UPDATE beasiswa SET nominal=? WHERE id=?').run(
        Math.round((nominal > 0 ? nominal : 0) * Math.max(1, penerima)), req.body.id);
    } else {
      const info = db.prepare(`INSERT INTO beasiswa (nama,deskripsi,tahun_ajaran_id,nominal,persen,grup_id,bulan_mask,aktif,keterangan,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(nama, deskripsi, taId, nominal > 0 ? nominal : 0, persen, grupId, bulanMask, aktif, deskripsi, nowStamp());
      // penerima bisa langsung dikirim dari form utama
      const ids = [].concat(req.body.penerima || []).map(Number).filter(Boolean);
      if (ids.length) {
        const bid = Number(info.lastInsertRowid);
        const ins = db.prepare('INSERT OR IGNORE INTO beasiswa_siswa (beasiswa_id,siswa_id,nominal) VALUES (?,?,?)');
        for (const sid of ids) ins.run(bid, sid, nominal > 0 ? nominal : totalNilai);
        const totalAll = Math.round((nominal > 0 ? nominal : 0) * ids.length);
        db.prepare('UPDATE beasiswa SET nominal=? WHERE id=?').run(totalAll || totalNilai, bid);
      }
    }
    const beaId = isEdit ? Number(req.body.id) : 0;
    if (beaId) {
      try { dbm.beasiswaSync(beaId); } catch (e) { console.error('[beasiswa]', e.message); }
    }
    dbm.logAudit(req.user, isEdit ? 'EDIT' : 'TAMBAH', 'beasiswa',
      `${isEdit ? 'Edit' : 'Tambah'} beasiswa ${nama} — potongan ${rupiah(nominal)}${persen ? ` / ${String(persen).replace('.', ',')}%` : ''}${penerima ? ` · ${penerima} penerima` : ''}`);
    res.redirect(back + '&ok=' + encodeURIComponent('Data beasiswa disimpan.'));
  });

  /* ================= simpan final dari pratinjau (JSON payload) ================= */
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
    const info = db.transaction(() => {
      const r = db.prepare(`INSERT INTO beasiswa (nama,deskripsi,tahun_ajaran_id,nominal,persen,grup_id,bulan_mask,aktif,keterangan,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        String(payload.nama).trim(), String(payload.deskripsi || '').trim(), taId, total,
        Number(payload.persen) || 0, Number(payload.grup_id) || null, String(payload.bulan_mask || ''),
        payload.aktif === false ? 0 : 1, String(payload.deskripsi || ''), nowStamp());
      const bid = Number(r.lastInsertRowid);
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
      dbm.trashAdd('beasiswa', b, { user: req.user, label: `Beasiswa ${b.nama} ${rupiah(b.nominal)}`, extra: { children: [{ tabel: 'beasiswa_siswa', rows: anak }] } });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM iuran_bayar WHERE sumber=\'beasiswa\' AND beasiswa_id=?').run(req.body.id);
      db.prepare('UPDATE iuran_tagihan SET beasiswa_locked=0, beasiswa_id=NULL WHERE beasiswa_id=?').run(req.body.id);
      db.prepare('DELETE FROM beasiswa_siswa WHERE beasiswa_id=?').run(req.body.id);
      db.prepare('DELETE FROM beasiswa WHERE id=?').run(req.body.id);
    })();
    try { dbm.beasiswaCleanup(); } catch (e) { }
    dbm.logAudit(req.user, 'HAPUS', 'beasiswa', `Hapus beasiswa ${b ? b.nama : req.body.id} (pembayaran iuran otomatisnya ikut dibatalkan)`);
    res.redirect(req.BASE + '/beasiswa?ok=' + encodeURIComponent('Data beasiswa dihapus.'));
  });
};
