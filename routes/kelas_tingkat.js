'use strict';
/**
 * ==================================================================
 * PENGATURAN KELAS & TINGKAT (per sekolah)
 * ------------------------------------------------------------------
 * /kelas/tingkat
 *  · pilih JENJANG pendidikan → preset tingkat otomatis aktif
 *  · centang tingkat mana saja yang dipakai sekolah
 *  · tambah tingkat KUSTOM (mis. "7 Al-Farabi")
 *  · buat kelas per tingkat (nama bebas: VII-A, 7 Al-Farabi, X IPA 1)
 * ==================================================================
 */
module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { esc, nowStamp } = lib;
  const go = (req, res, key, msg) => res.redirect(req.BASE + flashUrl('/kelas/tingkat', key, msg));

  function taSel(req, c) {
    const id = Number(req.query.get('ta') || c.taId || 0);
    return id || dbm.taAutoId();
  }

  get('/kelas/tingkat', (req, res) => {
    guard(req, res, 'kelas', 'view');
    const c = ctx(req);
    const taId = taSel(req, c);
    const jenjang = String(dbm.getSetting('jenjang_pendidikan', '') || '');
    const aktif = dbm.tingkatAktif();
    const editable = c.can('kelas', 'edit');
    const kelasAll = dbm.kelasList(taId, {});
    const preset = dbm.jenjangPreset(jenjang);

    const tingkatRows = dbm.TINGKAT_MASTER.map(t => {
      const on = aktif.some(a => String(a).toUpperCase() === t.kode.toUpperCase());
      const nKelas = kelasAll.filter(k => String(k.tingkat || '').toUpperCase() === t.kode.toUpperCase()).length;
      return `<label class="check tk-item">
        <input type="checkbox" name="tingkat" value="${esc(t.kode)}" ${on ? 'checked' : ''} ${editable ? '' : 'disabled'}>
        <span><b>${esc(t.label)}</b> <span class="t-sub mono">(${esc(t.kode)})</span>
          ${nKelas ? `<span class="badge green plain">${nKelas} kelas</span>` : ''}</span></label>`;
    }).join('');
    // tingkat aktif yang tidak termasuk master (kustom buatan sekolah)
    const kustom = aktif.filter(a => !dbm.TINGKAT_MASTER.some(t => t.kode.toUpperCase() === String(a).toUpperCase()));
    const kustomRows = kustom.map(a => {
      const nKelas = kelasAll.filter(k => String(k.tingkat || '') === String(a)).length;
      return `<div class="tk-item flex" style="justify-content:space-between;gap:10px">
        <div><b>${esc(a)}</b> <span class="badge violet plain">kustom</span>
          ${nKelas ? `<span class="badge green plain">${nKelas} kelas</span>` : ''}</div>
        ${editable ? `<form method="post" action="${c.base}/kelas/tingkat/hapus" data-confirm="Hapus tingkat ${esc(a)} dari daftar aktif?">
          <input type="hidden" name="tingkat" value="${esc(a)}">
          <button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus</button></form>` : ''}
      </div>`;
    }).join('');

    const perTingkat = aktif.map(tk => {
      const rows = kelasAll.filter(k => String(k.tingkat || '') === String(tk));
      return `<div class="card mb-2">
        <div class="card-head" style="padding-bottom:6px">
          <div><h3 style="font-size:15px">${esc(dbm.tingkatLabel(tk))} <span class="t-sub mono">(${esc(tk)})</span></h3>
            <div class="sub">${rows.length} kelas · ${rows.reduce((s, k) => s + Number(k.jumlah_siswa || 0), 0)} siswa aktif</div></div>
          ${editable ? `<form method="post" action="${c.base}/kelas/tingkat/kelas" class="flex" style="gap:6px;align-items:flex-end">
            <input type="hidden" name="tingkat" value="${esc(tk)}">
            <input type="hidden" name="tahun_ajaran_id" value="${taId}">
            <div class="field" style="margin:0"><label>Nama kelas baru</label>
              <input name="nama" placeholder="mis. ${esc(tk)}-A" required style="width:150px"></div>
            <button class="btn btn-sm">${ui.icon('plus')}Tambah</button>
          </form>` : ''}
        </div>
        ${rows.length ? `<div class="table-wrap short"><table><thead><tr><th>Nama Kelas</th><th>Wali Kelas</th><th class="num">Siswa</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map(k => `<tr>
            <td class="t-strong">${esc(k.nama_kelas || k.nama)}</td>
            <td>${esc(k.wali_kelas || '-')}</td>
            <td class="num">${k.jumlah_siswa || 0}</td>
            <td>${k.aktif ? ui.badge('Aktif', 'green') : ui.badge('Non-Aktif', 'gray')}</td>
            <td class="nowrap"><a class="btn btn-sm" href="${c.base}/kelas?ta=${taId}&q=${encodeURIComponent(k.nama)}">Kelola</a></td>
          </tr>`).join('')}
        </tbody></table></div>` : `<p class="help" style="margin:0">Belum ada kelas pada tingkat ini.</p>`}
      </div>`;
    }).join('');

    const content = `<div class="alert info">${ui.icon('info')}<div>
      <b>Jenjang pendidikan</b> menentukan preset tingkat standar. Mengubah jenjang akan menawarkan preset baru;
      tingkat yang sudah Anda centang manual tidak hilang sampai Anda menyimpannya lagi.</div></div>

    <div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Jenjang Pendidikan</h3><div class="sub">Dipakai untuk preset tingkat kelas</div></div>
          ${jenjang ? ui.badge(jenjang, 'blue') : ui.badge('Belum diatur', 'gray')}</div>
        <form method="post" action="${c.base}/kelas/tingkat/jenjang">
          <div class="field"><label>Jenjang Sekolah</label>
            <select name="jenjang_pendidikan" data-autosubmit>
              ${Object.entries(dbm.JENJANG).map(([k, v]) => `<option value="${esc(k)}" ${jenjang === k ? 'selected' : ''}>${esc(v.label)}${v.preset.length ? ' — ' + v.preset.join(', ') : ''}</option>`).join('')}
            </select>
            <div class="hint">Preset saat ini: <b>${preset.length ? esc(preset.join(', ')) : 'tanpa preset (kustom)'}</b></div></div>
          ${editable ? `<button class="btn btn-primary btn-block">${ui.icon('refresh')}Terapkan Preset Jenjang</button>` : ''}
        </form>
        <hr class="sep">
        <div class="card-head" style="padding:0 0 8px"><div><h3>Tambah Tingkat Kustom</h3>
          <div class="sub">Mis. "7 Al-Farabi", "Kelas Pagi", "TAHFIDZ"</div></div></div>
        <form method="post" action="${c.base}/kelas/tingkat/tambah">
          <div class="field"><label>Nama Tingkat</label><input name="tingkat" required maxlength="30" placeholder="7 Al-Farabi"></div>
          ${editable ? `<button class="btn btn-block">${ui.icon('plus')}Tambah Tingkat</button>` : ''}
        </form>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Tingkat Aktif</h3><div class="sub">Centang tingkat yang dipakai sekolah ini</div></div>
          ${ui.badge(aktif.length + ' tingkat', 'green')}</div>
        <form method="post" action="${c.base}/kelas/tingkat/simpan">
          <div class="tk-grid">${tingkatRows}</div>
          ${kustom.length ? `<hr class="sep"><div class="t-strong mb-1">Tingkat Kustom</div>${kustomRows}` : ''}
          ${editable ? `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Tingkat Aktif</button></div>`
        : `<div class="alert info">${ui.icon('lock')}<div>Role Anda hanya dapat melihat.</div></div>`}
        </form>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-head"><div><h3>Kelas per Tingkat — TA ${esc((dbm.tahunById(taId) || {}).nama || '-')}</h3>
        <div class="sub">${kelasAll.length} kelas terdaftar</div></div>
        <a class="btn btn-sm" href="${c.base}/kelas?ta=${taId}">${ui.icon('book')}Halaman Data Kelas</a></div>
      ${perTingkat || ui.emptyState('Belum ada tingkat aktif', 'Pilih jenjang pendidikan atau centang tingkat di atas.')}
    </div>`;
    page(req, res, { title: 'Pengaturan Kelas & Tingkat', sub: 'Jenjang, tingkat aktif & nama kelas', active: 'kelas_tingkat', content });
  });

  post('/kelas/tingkat/jenjang', (req, res) => {
    guard(req, res, 'kelas', 'edit');
    try {
      const j = String(req.body.jenjang_pendidikan || '').trim();
      if (!dbm.JENJANG[j]) throw new Error('Jenjang tidak dikenal.');
      dbm.setSetting('jenjang_pendidikan', j);
      const r = dbm.applyJenjangPreset(j, true);
      dbm.logAudit(req.user, 'EDIT', 'kelas', `Jenjang pendidikan → ${j}${r.changed ? ' (preset tingkat diterapkan)' : ''}`);
      go(req, res, 'ok', `Jenjang ${j} disimpan. Preset tingkat: ${r.list.join(', ') || '-'}.`);
    } catch (e) { go(req, res, 'err', e.message); }
  });

  post('/kelas/tingkat/simpan', (req, res) => {
    guard(req, res, 'kelas', 'edit');
    const list = [].concat(req.body.tingkat || []).map(x => String(x).trim()).filter(Boolean);
    if (!list.length) return go(req, res, 'err', 'Pilih minimal satu tingkat.');
    const kustom = dbm.tingkatAktif().filter(a => !dbm.TINGKAT_MASTER.some(t => t.kode.toUpperCase() === String(a).toUpperCase()));
    const final = [...new Set([...list, ...kustom.filter(k => list.some(l => l.toUpperCase() === k.toUpperCase()))])];
    dbm.setTingkatAktif(final);
    dbm.logAudit(req.user, 'EDIT', 'kelas', `Tingkat aktif: ${final.join(', ')}`);
    go(req, res, 'ok', `Tingkat aktif disimpan (${final.length} tingkat).`);
  });

  post('/kelas/tingkat/tambah', (req, res) => {
    guard(req, res, 'kelas', 'edit');
    const t = String(req.body.tingkat || '').trim();
    if (!t) return go(req, res, 'err', 'Nama tingkat wajib diisi.');
    const cur = dbm.tingkatAktif();
    if (cur.some(x => x.toUpperCase() === t.toUpperCase())) return go(req, res, 'err', 'Tingkat tersebut sudah ada.');
    dbm.setTingkatAktif([...cur, t]);
    dbm.logAudit(req.user, 'TAMBAH', 'kelas', `Tingkat kustom: ${t}`);
    go(req, res, 'ok', `Tingkat "${t}" ditambahkan.`);
  });

  post('/kelas/tingkat/hapus', (req, res) => {
    guard(req, res, 'kelas', 'edit');
    const t = String(req.body.tingkat || '').trim();
    const nKelas = dbm.kelasList(null, {}).filter(k => String(k.tingkat || '') === t).length;
    if (nKelas) return go(req, res, 'err', `Tingkat "${t}" masih dipakai ${nKelas} kelas. Hapus/pindahkan kelasnya lebih dulu.`);
    dbm.setTingkatAktif(dbm.tingkatAktif().filter(x => x !== t));
    dbm.logAudit(req.user, 'HAPUS', 'kelas', `Tingkat ${t} dinonaktifkan`);
    go(req, res, 'ok', `Tingkat "${t}" dihapus dari daftar aktif.`);
  });

  /** tambah kelas langsung dari halaman pengaturan tingkat */
  post('/kelas/tingkat/kelas', (req, res) => {
    guard(req, res, 'kelas', 'create');
    const { db } = dbm;
    try {
      const nama = String(req.body.nama || '').trim();
      const tingkat = String(req.body.tingkat || '').trim();
      if (!nama) throw new Error('Nama kelas wajib diisi.');
      const taId = Number(req.body.tahun_ajaran_id || dbm.taAutoId());
      const dup = db.prepare('SELECT id FROM kelas WHERE tahun_ajaran_id=? AND lower(COALESCE(nama_kelas,nama))=lower(?)').get(taId, nama);
      if (dup) throw new Error('Nama kelas sudah dipakai pada tahun pelajaran ini.');
      db.prepare(`INSERT INTO kelas (nama,nama_kelas,tingkat,wali_kelas,program_id,tahun_ajaran_id,aktif,urutan,created_at)
        VALUES (?,?,?,'',NULL,?,1,?,?)`).run(nama, nama, tingkat, taId,
        db.prepare('SELECT COALESCE(MAX(urutan),0)+1 n FROM kelas').get().n, nowStamp());
      dbm.logAudit(req.user, 'TAMBAH', 'kelas', `Tambah kelas ${nama} (tingkat ${tingkat})`);
      go(req, res, 'ok', `Kelas ${nama} ditambahkan pada tingkat ${tingkat}.`);
    } catch (e) { go(req, res, 'err', e.message); }
  });
};
