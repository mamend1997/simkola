'use strict';
const printcfg = require('../printcfg');
const X = require('../xlsx-read');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, terbilangRupiah } = lib;

  function modalCollector() {
    const list = [];
    const put = (id, opts) => { list.push(ui.modal(id, opts)); return ''; };
    put.html = () => list.join('');
    return put;
  }

  /** redirect kembali ke halaman asal dengan filter & halaman yang sama */
  function backGo(req, res, msg, key) {
    const raw = String((req.body && req.body.back) || '');
    const path = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(raw) && !raw.startsWith('//') ? raw : '/piutang';
    return res.redirect(req.BASE + (flashUrl ? flashUrl(path, key, msg) : path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg)));
  }

  /** status piutang dihitung ulang dari total cicilan (sumber kebenaran) */
  function recalcPiutang(pid, tanggalLunas) {
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(pid);
    if (!p) return null;
    const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(pid).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - dibayar);
    const last = db.prepare('SELECT tanggal FROM piutang_bayar WHERE piutang_id=? ORDER BY tanggal DESC, id DESC LIMIT 1').get(pid);
    db.prepare('UPDATE piutang SET status=?, tanggal_bayar=? WHERE id=?')
      .run(sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (tanggalLunas || (last ? last.tanggal : todayISO())) : null, pid);
    return { dibayar, sisa, status: sisa <= 0 ? 'lunas' : 'belum' };
  }

  function bkuAktif(taId) {
    if (taId) return db.prepare("SELECT * FROM bku WHERE status='aktif' AND COALESCE(auto_mode,0)=0 AND tahun_ajaran_id=? ORDER BY jenis DESC, urutan").all(taId);
    return db.prepare("SELECT * FROM bku WHERE status='aktif' AND COALESCE(auto_mode,0)=0 ORDER BY jenis DESC, urutan").all();
  }

  /** daftar piutang + total cicilan & sisa */
  function piutangRows(taId) {
    const wh = taId ? ' WHERE (p.tahun_ajaran_id=? OR p.tahun_ajaran_id IS NULL)' : '';
    return db.prepare(`SELECT p.*, b.nama bku_nama,
        COALESCE((SELECT SUM(x.nominal) FROM piutang_bayar x WHERE x.piutang_id=p.id),0) dibayar
      FROM piutang p LEFT JOIN bku b ON b.id=p.bku_id${wh}
      ORDER BY (p.status='lunas'), p.tanggal_utang DESC, p.id DESC`).all(...(taId ? [taId] : []))
      .map(p => ({ ...p, dibayar: Number(p.dibayar || 0), sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }));
  }

  function bayarMap() {
    const map = {};
    for (const b of db.prepare('SELECT * FROM piutang_bayar ORDER BY tanggal, id').all()) {
      (map[b.piutang_id] = map[b.piutang_id] || []).push(b);
    }
    return map;
  }

  /** baris SPP satu tahun ajaran: tagihan + diterima manual + penerimaan otomatis dari transaksi */
  function sppRows(taId) {
    if (!taId) return [];
    const stored = db.prepare('SELECT * FROM spp WHERE tahun_ajaran_id=? ORDER BY bulan').all(taId);
    const map = {}; stored.forEach(r => map[r.bulan] = r);
    const auto = dbm.sppTerimaMap(taId);
    return lib.BULAN.map((nama, i) => {
      const b = i + 1;
      const r = map[b] || { total_ditagihkan: 0, total_diterima: 0, diterima_manual: 0 };
      const manual = Number(r.diterima_manual || 0);
      const transaksi = Number(auto[b] || 0);
      return {
        bulan: b, nama, total_ditagihkan: Number(r.total_ditagihkan || 0),
        diterima_manual: manual, diterima_transaksi: transaksi,
        total_diterima: manual + transaksi
      };
    });
  }

  /* ================= halaman ================= */
  get('/piutang', (req, res) => {
    guard(req, res, 'piutang', 'view');
    const c = ctx(req);
    const taList = dbm.allTahun();
    const ta = c.ta;
    const taId = c.taId;
    // status LUNAS/BELUM LUNAS disinkronkan dari total cicilan agar sama dengan portal publik
    try { dbm.piutangSyncStatus(); } catch (e) { }
    const piutang = piutangRows(taId);
    const bayar = bayarMap();
    // filter + pagination (data ratusan baris tidak dirender sekaligus)
    const fq = (req.query.get('q') || '').trim();
    const fStatus = req.query.get('f') === 'belum' ? 'belum' : req.query.get('f') === 'lunas' ? 'lunas' : '';
    const piutangFilter = piutang.filter(p => {
      if (fq && !String(p.nama_pegawai || '').toLowerCase().includes(fq.toLowerCase())) return false;
      if (fStatus === 'belum' && !(p.sisa > 0)) return false;
      if (fStatus === 'lunas' && p.sisa > 0) return false;
      return true;
    });
    const perPage = 60;
    const totalHal = Math.max(1, Math.ceil(piutangFilter.length / perPage));
    const hal = Math.min(totalHal, Math.max(1, Number(req.query.get('hal') || 1)));
    const pagePiutang = piutangFilter.slice((hal - 1) * perPage, hal * perPage);
    const keepQs = new URLSearchParams();
    if (fq) keepQs.set('q', fq);
    if (fStatus) keepQs.set('f', fStatus);
    if (hal > 1) keepQs.set('hal', String(hal));
    const keepStr = keepQs.toString();
    const backPath = '/piutang' + (keepStr ? '?' + keepStr : '');
    const withBack = extra => backPath + (keepStr ? '&' : '?') + extra;
    const totalBelum = piutang.filter(p => p.status === 'belum').reduce((s, p) => s + p.sisa, 0);
    const totalDibayar = piutang.reduce((s, p) => s + p.dibayar, 0);
    const late = modalCollector();
    const late2 = modalCollector();

    // urutkan bulan mengikuti tahun pelajaran: Juli → Juni (bukan Januari)
    const sppList = (() => {
      const all = sppRows(taId);
      const byMonth = new Map(all.map(r => [Number(r.bulan), r]));
      return dbm.BULAN_TA.map(b => byMonth.get(b)).filter(Boolean);
    })();
    const totalTagih = sppList.reduce((s, r) => s + r.total_ditagihkan, 0);
    const totalTerima = sppList.reduce((s, r) => s + r.total_diterima, 0);
    const beasiswaTa = dbm.beasiswaTotal(taId);
    const tunggakanBruto = Math.max(0, totalTagih - totalTerima);
    const tunggakanSpp = Math.max(0, tunggakanBruto - beasiswaTa);
    const editableSpp = c.can('piutang', 'create') || c.can('piutang', 'edit');

    const editP = req.query.get('edit') ? db.prepare('SELECT * FROM piutang WHERE id=?').get(req.query.get('edit')) : null;

    /* ---------- riwayat rekap input piutang (umum + sertifikasi) ---------- */
    const rekapInput = (() => {
      const umum = db.prepare(`SELECT p.*, COALESCE((SELECT SUM(x.nominal) FROM piutang_bayar x WHERE x.piutang_id=p.id),0) dibayar
        FROM piutang p${taId ? ' WHERE (p.tahun_ajaran_id=? OR p.tahun_ajaran_id IS NULL)' : ''}`).all(...(taId ? [taId] : []))
        .map(p => ({
          jenis: 'umum', id: p.id, nama: p.nama_pegawai, tanggal: p.tanggal_utang,
          nominal: Number(p.nominal || 0), dibayar: Number(p.dibayar || 0),
          sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)),
          status: p.status, keterangan: p.keterangan || '', created_at: p.created_at || ''
        }));
      const sert = db.prepare(`SELECT p.*, COALESCE((SELECT SUM(x.nominal) FROM piutang_lain_bayar x WHERE x.piutang_id=p.id),0) dibayar
        FROM piutang_lain p${taId ? ' WHERE (p.tahun_ajaran_id=? OR p.tahun_ajaran_id IS NULL)' : ''}`).all(...(taId ? [taId] : []))
        .map(p => ({
          jenis: 'sertifikasi', id: p.id, nama: p.nama, tanggal: p.tanggal,
          nominal: Number(p.nominal || 0), dibayar: Number(p.dibayar || 0),
          sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)),
          status: p.status, keterangan: p.keterangan || '', created_at: p.created_at || ''
        }));
      // urut dari input terbaru (created_at, lalu id)
      return [...umum, ...sert].sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')) || (b.jenis === a.jenis ? b.id - a.id : (a.jenis === 'umum' ? -1 : 1)));
    })();

    // rekapitulasi piutang per individu (pegawai)
    const rekapPegawai = (() => {
      const map = new Map();
      for (const p of piutangFilter) {
        const key = String(p.nama_pegawai || '').trim().toLowerCase();
        if (!map.has(key)) map.set(key, { nama: String(p.nama_pegawai || '').trim(), jumlah: 0, aktif: 0, nominal: 0, dibayar: 0, sisa: 0, items: [] });
        const g = map.get(key);
        g.jumlah++;
        g.nominal += Number(p.nominal || 0);
        g.dibayar += Number(p.dibayar || 0);
        g.sisa += Number(p.sisa || 0);
        if (p.sisa > 0) { g.aktif++; g.items.push(p); }
      }
      return [...map.values()].sort((a, b) => (b.sisa - a.sisa) || a.nama.localeCompare(b.nama, 'id'));
    })();
    const pegawaiBelum = rekapPegawai.filter(g => g.aktif > 0);

    const pForm = (p, mid) => `<form method="post" action="${c.base}/piutang/save" id="f${mid}">
      <input type="hidden" name="id" value="${p ? p.id : ''}">
      <div class="row2">
        <div class="field"><label>Nama Pegawai</label><input name="nama_pegawai" list="pegawaiList" value="${esc(p ? p.nama_pegawai : '')}" required placeholder="Pilih dari master pegawai atau ketik manual">
          <div class="hint">Pilihan otomatis dari menu <b>Data Pegawai</b>.</div></div>
        <div class="field"><label>Tanggal Utang</label><input type="date" name="tanggal_utang" value="${esc(p ? p.tanggal_utang : todayISO())}" required></div>
      </div>
      <div class="row2">
        <div class="field"><label>Nominal Utang (Rp)</label>${ui.moneyInput('nominal', p ? p.nominal : '', 'required placeholder="0"')}</div>
        <div class="field"><label>BKU Sumber Dana</label><select name="bku_id"><option value="">— Pilih —</option>${dbm.allBku(taId).map(b => `<option value="${b.id}" ${p && String(p.bku_id) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Keterangan</label><input name="keterangan" value="${esc(p ? p.keterangan : '')}" placeholder="Keperluan pinjaman"></div>
    </form>`;

    const content = `
    <datalist id="pegawaiList">${dbm.pegawaiList(true).map(p => `<option value="${esc(p.nama)}">${esc(p.jabatan || '')}</option>`).join('')}</datalist>
    <div class="kpi-grid mb-3">
      <div class="kpi ic-blue"><div class="ico">${ui.icon('card')}</div><div class="lbl">Sisa Piutang Pegawai</div><div class="val" style="font-size:19px">${rupiah(totalBelum)}</div><div class="meta">${piutang.filter(p => p.status === 'belum').length} pegawai belum lunas</div></div>
      <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Sudah Dicicil</div><div class="val" style="font-size:19px">${rupiah(totalDibayar)}</div><div class="meta">Akumulasi seluruh cicilan</div></div>
      <div class="kpi ic-amber"><div class="ico">${ui.icon('down')}</div><div class="lbl">Tunggakan SPP</div><div class="val" style="font-size:19px">${rupiah(tunggakanSpp)}</div><div class="meta">TA ${esc(ta ? ta.nama : '-')} · setelah beasiswa ${rupiah(beasiswaTa)}</div></div>
      <div class="kpi ic-orange"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Total Piutang Sekolah</div><div class="val" style="font-size:19px">${rupiah(totalBelum + tunggakanSpp)}</div><div class="meta">Pegawai + SPP</div></div>
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Manajemen Piutang Pegawai</h3><div class="sub">Pembayaran boleh dicicil bertahap — setiap cicilan otomatis menambah kas &amp; mengurangi sisa piutang</div></div>
        <div class="toolbar">
          <form method="get" action="${c.base}/piutang" class="toolbar" style="gap:6px">
            <input name="q" value="${esc(fq)}" placeholder="Cari nama pegawai…" data-table-search="#tblPiutangPegawai,#tblRekapPegawai" style="width:190px" title="Ketik untuk menyaring tabel, Enter/Cari untuk mencari ke seluruh data">
            <select name="f" data-autosubmit>
              <option value="">Semua Status</option>
              <option value="belum" ${fStatus === 'belum' ? 'selected' : ''}>Belum Lunas</option>
              <option value="lunas" ${fStatus === 'lunas' ? 'selected' : ''}>Lunas</option>
            </select>
            <button class="btn btn-sm">${ui.icon('search')}Cari</button>
          </form>
          <a class="btn btn-sm" href="${c.base}/laporan?r=piutang" target="_blank">${ui.icon('printer')}Cetak Rekap</a>
          ${c.can('piutang', 'create') ? `<button class="btn btn-sm" data-open="mImport">${ui.icon('upload')}Import Excel/CSV</button>` : ''}
          ${c.can('piutang', 'create') ? ui.openModalBtn('mAdd', 'Tambah Piutang') : ''}
        </div></div>
      ${piutangFilter.length ? `<div class="table-scroll tall"><table id="tblPiutangPegawai"><thead><tr><th>Nama Pegawai</th><th>Tanggal Utang</th><th class="num">Nominal Utang</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th><th>Keterangan</th><th class="right">Aksi</th></tr></thead><tbody>
        ${pagePiutang.map(p => `<tr>
          <td class="t-strong">${esc(p.nama_pegawai)}</td>
          <td class="nowrap">${tglID(p.tanggal_utang)}</td>
          <td class="num t-strong">${rupiah(p.nominal)}</td>
          <td class="num" style="color:var(--green)">${p.dibayar ? rupiah(p.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${p.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(p.sisa)}</td>
          <td>${p.status === 'lunas' ? ui.badge('Lunas', 'green') : p.dibayar > 0 ? ui.badge('Cicilan Berjalan', 'amber') : ui.badge('Belum Lunas', 'red')}</td>
          <td class="t-sub">${esc(p.keterangan || '-')}${p.bku_nama ? `<div>${esc(p.bku_nama)}</div>` : ''}</td>
          <td class="right nowrap">
            ${p.sisa > 0 && c.can('piutang', 'edit') ? `<button class="btn btn-sm btn-green" data-open="mBayar${p.id}">${ui.icon('plus')}Cicilan</button>` : ''}
            <button class="btn btn-sm" data-open="mRiwayat${p.id}">${ui.icon('clock')}Riwayat</button>
            <a class="btn btn-sm" target="_blank" href="${c.base}/piutang/${p.id}/bukti" title="Cetak bukti pencairan/penambahan piutang">${ui.icon('printer')}Bukti Piutang</a>
            ${c.can('piutang', 'edit') ? `<a class="btn btn-sm btn-icon" href="${c.base}/piutang?edit=${p.id}" title="Edit">${ui.icon('edit')}</a>` : ''}
            ${c.can('piutang', 'delete') ? `<form method="post" action="${c.base}/piutang/delete" style="display:inline" data-confirm="Hapus data piutang ${esc(p.nama_pegawai)} beserta riwayat cicilannya?"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="back" value="${esc(backPath)}"><button class="btn btn-sm btn-danger">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>
          ${p.sisa > 0 ? late('mBayar' + p.id, {
          title: 'Catat Cicilan / Pelunasan Piutang',
          body: `<div class="alert info">${ui.icon('info')}<div>Cicilan/pelunasan piutang pegawai <b>tidak dibukukan ke BKU</b> — hanya mengurangi sisa piutang pegawai. Status otomatis menjadi <b>Lunas</b> saat sisa mencapai Rp 0.</div></div>
            <div class="kv mb-2"><dt>Pegawai</dt><dd>${esc(p.nama_pegawai)}</dd><dt>Nominal utang</dt><dd>${rupiah(p.nominal)}</dd>
              <dt>Sudah dicicil</dt><dd>${rupiah(p.dibayar)}</dd><dt>Sisa piutang</dt><dd style="color:var(--red)">${rupiah(p.sisa)}</dd></div>
            <form method="post" action="${c.base}/piutang/bayar" id="fb${p.id}">
              <input type="hidden" name="id" value="${p.id}">
              <input type="hidden" name="back" value="${esc(backPath)}">
              <div class="row2">
                <div class="field"><label>Nominal Cicilan (Rp)</label>${ui.moneyInput('nominal', p.sisa, 'required placeholder="0"')}
                  <div class="hint">Isi sebagian bila pembayaran dicicil. Terbilang: <b>${esc(terbilangRupiah(p.sisa))}</b></div></div>
                <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal_bayar" value="${todayISO()}" required></div>
              </div>
              <div class="row2">
                <div class="field"><label>Metode</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></div>
                <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Contoh: cicilan ke-2"></div>
              </div>
              <div class="alert warn">${ui.icon('info')}<div>Tanpa BKU: pelunasan ini tidak menambah kas pada BKU mana pun (sesuai kebijakan pembukuan piutang pegawai).</div></div>
            </form>`,
          footer: `<button class="btn" data-close="mBayar${p.id}">Batal</button><button class="btn btn-green" form="fb${p.id}">${ui.icon('check')}Catat Cicilan</button>`
        }) : ''}
          ${(() => {
          const list = bayar[p.id] || [];
          let run = Number(p.nominal || 0);
          const rows = list.map(b => { run -= Number(b.nominal || 0); return { ...b, sisa: Math.max(0, run) }; });
          // modal edit per baris riwayat pembayaran (dirender di luar tabel)
          const editModals = list.map(b => late('mBayarEd' + b.id, {
            title: 'Edit Riwayat Pembayaran — ' + p.nama_pegawai,
            body: `<div class="alert info">${ui.icon('info')}<div>Perubahan nominal/tanggal akan <b>menghitung ulang</b> sisa dan status piutang otomatis.</div></div>
              <div class="kv mb-2"><dt>Nominal utang</dt><dd>${rupiah(p.nominal)}</dd>
                <dt>Total cicilan saat ini</dt><dd>${rupiah(p.dibayar)}</dd>
                <dt>Sisa piutang</dt><dd>${rupiah(p.sisa)}</dd></div>
              <form method="post" action="${c.base}/piutang/bayar/save" id="fbe${b.id}">
                <input type="hidden" name="id" value="${b.id}">
                <input type="hidden" name="back" value="${esc(backPath)}">
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
            footer: `<button class="btn" data-close="mBayarEd${b.id}">Batal</button>
              <button class="btn btn-primary" form="fbe${b.id}">${ui.icon('save')}Simpan Perubahan</button>`
          })).join('');
          return editModals + late('mRiwayat' + p.id, {
            title: 'Riwayat Cicilan — ' + p.nama_pegawai,
            wide: true,
            body: list.length ? `<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th class="num">Nominal Cicilan</th><th class="num">Sisa Piutang</th><th>Metode</th><th>Keterangan</th><th class="right">Aksi</th></tr></thead><tbody>
              <tr style="background:#FFF8F2"><td colspan="2" class="t-strong">Nominal utang awal</td><td class="num t-strong">${rupiah(p.nominal)}</td><td colspan="3"></td></tr>
              ${rows.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td>
                <td class="num" style="color:var(--green)">${rupiah(b.nominal)}</td>
                <td class="num t-strong">${rupiah(b.sisa)}</td>
                <td>${b.metode === 'transfer' ? ui.badge('Transfer', 'blue') : ui.badge('Tunai', 'gray')}</td>
                <td class="t-sub">${esc(b.keterangan || '-')}${b.transaksi_id ? '' : ' <span class="badge gray plain">historis</span>'}</td>
                <td class="right nowrap">
                  <a class="btn btn-sm" target="_blank" href="${c.base}/piutang/bayar/${b.id}/bukti" title="Cetak bukti pelunasan/cicilan">${ui.icon('printer')}Bukti</a>
                  ${c.can('piutang', 'edit') ? `<button class="btn btn-sm btn-icon" data-open="mBayarEd${b.id}" title="Edit riwayat pembayaran">${ui.icon('edit')}</button>` : ''}
                  ${c.can('piutang', 'delete') ? `<form method="post" action="${c.base}/piutang/bayar/delete" style="display:inline"
                    data-confirm="Hapus riwayat pembayaran ${rupiah(b.nominal)} tanggal ${tglID(b.tanggal)}? Sisa piutang akan dihitung ulang.">
                    <input type="hidden" name="id" value="${b.id}"><input type="hidden" name="back" value="${esc(backPath)}">
                    <button class="btn btn-sm btn-danger" title="Hapus riwayat pembayaran">${ui.icon('trash')}</button></form>` : ''}
                </td></tr>`).join('')}
            </tbody><tfoot><tr><td class="center">TOTAL DICICIL</td><td class="num">${rupiah(p.dibayar)}</td><td class="num">${rupiah(p.sisa)}</td><td colspan="3"></td></tr></tfoot></table></div>
            <p class="help mt-2">Sisa piutang = nominal utang − akumulasi cicilan.</p>`
              : ui.emptyState('Belum ada cicilan', 'Catat cicilan pertama melalui tombol Cicilan.'),
            footer: `<button class="btn" data-close="mRiwayat${p.id}">Tutup</button>`
          });
        })()}`).join('')}
      </tbody></table></div>
      ${piutangFilter.length > perPage ? `<div class="bulk-bar">
        <div class="small muted">Menampilkan <b>${(hal - 1) * perPage + 1}–${Math.min(hal * perPage, piutangFilter.length)}</b> dari <b>${piutangFilter.length}</b> piutang (${perPage}/halaman).</div>
        <div class="toolbar">
          ${hal > 1 ? `<a class="btn btn-sm" href="${c.base}/piutang?${keepStr ? keepStr + '&' : ''}hal=${hal - 1}#tblPiutangPegawai">Sebelumnya</a>` : ''}
          <span class="small muted">Halaman ${hal} / ${totalHal}</span>
          ${hal < totalHal ? `<a class="btn btn-sm" href="${c.base}/piutang?${keepStr ? keepStr + '&' : ''}hal=${hal + 1}#tblPiutangPegawai">Berikutnya</a>` : ''}
        </div></div>` : ''}` : ui.emptyState(fq || fStatus ? 'Tidak ada piutang pada filter ini' : 'Belum ada piutang pegawai', fq || fStatus ? 'Ubah kata kunci pencarian atau filter status.' : 'Catat pinjaman pegawai agar tercatat sebagai aset piutang sekolah, atau import dari Excel/CSV.')}
      ${late.html()}
    </div>

    <div class="card mb-3">
      <div class="card-head">
        <div><h3>Rekapitulasi Piutang per Pegawai</h3><div class="sub">Satu baris per individu · pembayaran beberapa piutang sekaligus dapat digabung dalam satu transaksi</div></div>
        <span class="small muted">${pegawaiBelum.length} pegawai masih punya sisa piutang</span>
      </div>
      ${rekapPegawai.length ? `<div class="table-scroll short"><table id="tblRekapPegawai"><thead><tr>
        <th>Nama Pegawai</th><th class="num">Jumlah Piutang</th><th class="num">Total Utang</th><th class="num">Sudah Dicicil</th><th class="num">Sisa Piutang</th><th>Status</th><th class="right">Aksi</th>
      </tr></thead><tbody>
        ${rekapPegawai.map((g2, gi) => `<tr>
          <td class="t-strong">${esc(g2.nama || '-')}</td>
          <td class="num">${g2.jumlah}${g2.aktif ? `<div class="t-sub">${g2.aktif} belum lunas</div>` : ''}</td>
          <td class="num">${rupiah(g2.nominal)}</td>
          <td class="num" style="color:var(--green)">${g2.dibayar ? rupiah(g2.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${g2.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(g2.sisa)}</td>
          <td>${g2.sisa > 0 ? ui.badge('Belum Lunas', 'red') : ui.badge('Lunas', 'green')}</td>
          <td class="right nowrap">${g2.aktif > 1 ? `<button class="btn btn-sm btn-green" data-open="mGabung${gi}">${ui.icon('plus')}Bayar Gabungan</button>` : ''}</td>
        </tr>
        ${g2.aktif > 1 ? late2('mGabung' + gi, {
          title: 'Bayar Gabungan — ' + g2.nama,
          wide: true,
          body: `<div class="alert info">${ui.icon('info')}<div>Pembayaran dialokasikan otomatis ke piutang <b>tertua lebih dulu</b> (FIFO). Pelunasan <b>tidak masuk BKU</b>; seluruh piutang yang lunas otomatis berstatus <b>LUNAS</b>.</div></div>
            <div class="kv mb-2"><dt>Pegawai</dt><dd>${esc(g2.nama)}</dd><dt>Total utang</dt><dd>${rupiah(g2.nominal)}</dd>
              <dt>Sudah dicicil</dt><dd>${rupiah(g2.dibayar)}</dd><dt>Sisa gabungan</dt><dd style="color:var(--red)">${rupiah(g2.sisa)}</dd></div>
            <div class="table-scroll short mb-2"><table><thead><tr><th>Tanggal</th><th>Keterangan</th><th class="num">Nominal</th><th class="num">Sisa</th></tr></thead><tbody>
              ${g2.items.map(p => `<tr><td class="nowrap">${tglID(p.tanggal_utang)}</td><td class="t-sub">${esc(p.keterangan || '-')}</td>
                <td class="num">${rupiah(p.nominal)}</td><td class="num t-strong">${rupiah(p.sisa)}</td></tr>`).join('')}
            </tbody></table></div>
            <form method="post" action="${c.base}/piutang/bayar-gabungan" id="fg${gi}">
              <input type="hidden" name="nama" value="${esc(g2.nama)}">
              <input type="hidden" name="back" value="${esc(backPath)}">
              <div class="row2">
                <div class="field"><label>Nominal Pembayaran (Rp)</label>${ui.moneyInput('nominal', g2.sisa, 'required placeholder="0"')}
                  <div class="hint">Maksimal ${rupiah(g2.sisa)} (seluruh sisa piutang pegawai ini).</div></div>
                <div class="field"><label>Tanggal Bayar</label><input type="date" name="tanggal_bayar" value="${todayISO()}" required></div>
              </div>
              <div class="row2">
                <div class="field"><label>Metode</label><select name="metode"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></div>
                <div class="field"><label>Keterangan</label><input name="keterangan" placeholder="Contoh: pelunasan gabungan piutang"></div>
              </div>
              <div class="alert warn">${ui.icon('info')}<div>Tanpa BKU: pembayaran hanya mengurangi piutang pegawai dan langsung mengubah status menjadi <b>Lunas</b> bila sisa Rp 0.</div></div>
            </form>`,
          footer: `<button class="btn" data-close="mGabung${gi}">Batal</button><button class="btn btn-green" form="fg${gi}">${ui.icon('check')}Bayar Gabungan</button>`
        }) : ''}`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada data piutang pegawai', 'Piutang pegawai yang dicatat akan direkap otomatis per individu di sini.')}
      <p class="help mt-2">Cari cepat berdasarkan nama pegawai melalui kolom pencarian di atas tabel piutang. Tombol <b>Bayar Gabungan</b> muncul bila pegawai memiliki lebih dari satu piutang yang belum lunas.</p>
      ${late2.html()}
    </div>

    <div class="card mb-3">
      <div class="card-head">
        <div><h3>Grafik SPP per Bulan</h3><div class="sub">Perbandingan total ditagihkan vs diterima — Tahun Ajaran ${esc(ta ? ta.nama : '-')}</div></div>
        <form method="get" action="${c.base}/piutang" class="toolbar">
          <select name="ta" data-autosubmit>${taList.map(t => `<option value="${t.id}" ${String(t.id) === String(taId) ? 'selected' : ''}>TA ${esc(t.nama)}</option>`).join('')}</select>
        </form>
      </div>
      ${sppList.some(r => r.total_ditagihkan > 0 || r.total_diterima > 0)
        ? `${ui.chartSPP(sppList, { id: 'ta' + taId })}
           <div class="kpi-grid mt-3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
             <div class="kpi ic-orange"><div class="ico">${ui.icon('target')}</div><div class="lbl">Total Ditagihkan Setahun</div><div class="val" style="font-size:18px">${rupiah(totalTagih)}</div></div>
             <div class="kpi ic-green"><div class="ico">${ui.icon('check')}</div><div class="lbl">Total Diterima</div><div class="val" style="font-size:18px">${rupiah(totalTerima)}</div><div class="meta">${totalTagih ? ((totalTerima / totalTagih) * 100).toFixed(1) : 0}% capaian setahun</div></div>
             <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Sisa Tunggakan</div><div class="val" style="font-size:18px">${rupiah(tunggakanSpp)}</div><div class="meta">Setelah beasiswa ${rupiah(beasiswaTa)} · ${sppList.filter(r => r.total_ditagihkan > r.total_diterima).length} bulan belum lunas</div></div>
           </div>`
        : ui.emptyState('Belum ada data SPP pada tahun ajaran ini', 'Isi Total Ditagihkan pada tabel di bawah — grafik akan terbentuk otomatis per bulan.')}
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Tagihan SPP Siswa (Rekap Bulanan)</h3><div class="sub">Total ditagihkan bisa diedit · total diterima terkunci &amp; otomatis dari transaksi kode rekening 4.1.01 (Penerimaan SPP)</div></div>
        <div class="toolbar">
          <a class="btn btn-sm" href="${c.base}/laporan?r=piutang&ta=${taId}" target="_blank">${ui.icon('printer')}Cetak Rekap SPP</a>
        </div>
      </div>
      <form method="post" action="${c.base}/spp/save">
        <input type="hidden" name="tahun_ajaran_id" value="${taId || ''}">
        <div class="table-wrap"><table><thead><tr><th>Bulan</th><th class="num" style="width:200px">Total Ditagihkan</th><th class="num" style="width:210px">Total Diterima <span class="badge gray plain">terkunci</span></th><th class="num">Tunggakan</th><th style="width:150px">Capaian</th></tr></thead><tbody>
          ${sppList.map(r => {
      const tung = r.total_ditagihkan - r.total_diterima;
      const pct = r.total_ditagihkan > 0 ? (r.total_diterima / r.total_ditagihkan) * 100 : 0;
      return `<tr><td class="t-strong">${r.nama}</td>
            <td class="num">${editableSpp ? ui.moneyInput('tagih_' + r.bulan, r.total_ditagihkan) : rupiah(r.total_ditagihkan)}</td>
            <td class="num"><div class="t-strong">${rupiah(r.total_diterima)}</div>
              <div class="t-sub">${r.diterima_transaksi ? `${rupiah(r.diterima_transaksi)} dari transaksi` : 'belum ada transaksi SPP'}${r.diterima_manual ? ` · ${rupiah(r.diterima_manual)} saldo awal` : ''}</div></td>
            <td class="num" style="color:${tung > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(tung)}</td>
            <td>${ui.prog(pct, pct >= 95 ? 'g' : pct >= 70 ? '' : 'r')}<div class="t-sub">${pct.toFixed(0)}%</div></td></tr>`;
    }).join('')}
        </tbody><tfoot><tr><td>TOTAL</td><td class="num">${rupiah(totalTagih)}</td><td class="num">${rupiah(totalTerima)}</td><td class="num">${rupiah(tunggakanSpp)}</td><td></td></tr></tfoot></table></div>
        ${editableSpp ? `<div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Total Tagihan SPP</button></div>` : ''}
      </form>
      <div class="alert info mt-2">${ui.icon('info')}<div><b>Beasiswa SPP:</b> ${rupiah(beasiswaTa)} dari <a href="${c.base}/beasiswa?ta=${taId}"><b>Master Data Beasiswa</b></a> otomatis mengurangi tunggakan SPP. Tunggakan bruto ${rupiah(tunggakanBruto)} → setelah beasiswa ${rupiah(tunggakanSpp)}.</div></div>
      <p class="help mt-2">Kolom <b>Total Diterima</b> terkunci: nilainya bertambah otomatis setiap ada transaksi pemasukan dengan kode rekening <b>4.1.01 — Penerimaan SPP</b> pada bulan terkait. Sisa tunggakan (ditagihkan − diterima) dipakai sebagai nilai aset piutang pada Dashboard &amp; Rekonsiliasi Kas.</p>
    </div>

    <div class="card mt-3" id="rekapInput">
      <div class="card-head">
        <div><h3>Riwayat Rekap Input Piutang</h3>
          <div class="sub">Seluruh data piutang yang pernah diinput (umum &amp; sertifikasi) — bisa diubah atau dihapus dari sini</div></div>
        <span class="small muted">${rekapInput.length} baris input</span>
      </div>
      ${rekapInput.length ? `<div class="table-wrap sticky-head" style="max-height:60vh">
        <table id="tblRekapInput"><thead><tr>
          <th>Waktu Input</th><th>Jenis</th><th>Nama Pegawai</th><th>Tanggal Utang</th>
          <th class="num">Nominal</th><th class="num">Dibayar</th><th class="num">Sisa</th><th>Status</th><th>Keterangan</th><th class="right">Aksi</th>
        </tr></thead><tbody>
        ${rekapInput.map((r, ri) => `<tr>
          <td class="nowrap t-sub">${esc(String(r.created_at || '').slice(0, 16) || '-')}</td>
          <td>${r.jenis === 'umum' ? ui.badge('Umum', 'orange', 'plain') : ui.badge('Sertifikasi', 'blue', 'plain')}</td>
          <td class="t-strong">${esc(r.nama || '-')}</td>
          <td class="nowrap">${tglID(r.tanggal)}</td>
          <td class="num">${rupiah(r.nominal)}</td>
          <td class="num" style="color:var(--green)">${r.dibayar ? rupiah(r.dibayar) : '—'}</td>
          <td class="num t-strong" style="color:${r.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(r.sisa)}</td>
          <td>${r.status === 'lunas' ? ui.badge('Lunas', 'green') : ui.badge('Belum Lunas', 'red')}</td>
          <td class="t-sub">${esc((r.keterangan || '-').slice(0, 60))}</td>
          <td class="right nowrap">
            ${r.jenis === 'umum' && c.can('piutang', 'edit')
        ? `<a class="btn btn-sm btn-icon" href="${c.base}/piutang?edit=${r.id}#rekapInput" title="Edit piutang">${ui.icon('edit')}</a>` : ''}
            ${r.jenis === 'sertifikasi' && c.can('piutang_lain', 'edit')
        ? `<a class="btn btn-sm btn-icon" href="${c.base}/piutang-lain?edit=${r.id}" title="Edit piutang sertifikasi">${ui.icon('edit')}</a>` : ''}
            ${r.jenis === 'umum' && c.can('piutang', 'delete')
        ? `<form method="post" action="${c.base}/piutang/delete" style="display:inline"
              data-confirm="Hapus data piutang ${esc(r.nama)} (${rupiah(r.nominal)}) beserta riwayat cicilannya?">
              <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="back" value="/piutang#rekapInput">
              <button class="btn btn-sm btn-danger" title="Hapus input piutang">${ui.icon('trash')}</button></form>` : ''}
            ${r.jenis === 'sertifikasi' && c.can('piutang_lain', 'delete')
        ? `<form method="post" action="${c.base}/piutang-lain/delete" style="display:inline"
              data-confirm="Hapus piutang sertifikasi ${esc(r.nama)} (${rupiah(r.nominal)}) beserta riwayat pembayarannya?">
              <input type="hidden" name="id" value="${r.id}">
              <button class="btn btn-sm btn-danger" title="Hapus input piutang sertifikasi">${ui.icon('trash')}</button></form>` : ''}
          </td></tr>`).join('')}
        </tbody><tfoot><tr>
          <td colspan="4">TOTAL (${rekapInput.length} input)</td>
          <td class="num">${rupiah(rekapInput.reduce((a, r) => a + r.nominal, 0))}</td>
          <td class="num">${rupiah(rekapInput.reduce((a, r) => a + r.dibayar, 0))}</td>
          <td class="num">${rupiah(rekapInput.reduce((a, r) => a + r.sisa, 0))}</td>
          <td colspan="3"></td></tr></tfoot></table></div>
        <p class="help mt-2">Riwayat diurutkan dari input terbaru. Baris <b>Umum</b> diubah/dihapus pada menu ini, baris <b>Sertifikasi</b> mengarah ke halaman Piutang Sertifikasi. Data yang dihapus masuk Kotak Sampah (dapat dipulihkan 30 hari).</p>`
        : ui.emptyState('Belum ada riwayat input piutang', 'Tambahkan piutang baru atau import dari Excel — seluruh input akan tampil di sini.')}
    </div>

    ${c.can('piutang', 'create') ? ui.modal('mAdd', {
      title: req.query.get('edit') ? 'Edit Piutang Pegawai' : 'Tambah Piutang Pegawai',
      body: pForm(editP, 'mAdd'),
      footer: `<button class="btn" data-close="mAdd">Batal</button><button class="btn btn-primary" form="fmAdd">Simpan</button>`
    }).replace('class="modal" id="mAdd"', `class="modal ${editP ? 'show' : ''}" id="mAdd"`) : ''}
    ${c.can('piutang', 'create') ? ui.modal('mImport', {
      title: 'Import Piutang Pegawai (Excel / CSV)',
      wide: true,
      body: `<form method="post" action="${c.base}/piutang/import" id="fImport">
        <div class="alert info">${ui.icon('info')}<div><b>Format kolom:</b> <code>[TANGGAL] | [NAMA] | [MASUK] | [KELUAR] | [SALDO]</code><br>
          <b>KELUAR</b> = pinjaman yang diberikan ke pegawai (menambah piutang), <b>MASUK</b> = pembayaran/cicilan (mengurangi piutang).
          Import bersifat <b>historis</b>: tidak membuat transaksi kas — catat pembayaran baru lewat tombol Cicilan agar kas ikut bertambah.</div></div>
        <div class="field"><label>Berkas (.xlsx / .csv, maks 10 MB)</label>
          <input type="hidden" name="file_b64" id="file_b64">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="file_b64" data-max="10">
          <div class="hint" id="file_b64-info">Baris judul (header) akan dicari otomatis.</div></div>
      </form>`,
      footer: `<button class="btn" data-close="mImport">Batal</button><button class="btn btn-primary" form="fImport">${ui.icon('upload')}Import Sekarang</button>`
    }) : ''}`;
    page(req, res, { title: 'Piutang & Tagihan', sub: 'Piutang pegawai (bisa dicicil) dan rekap SPP siswa', active: 'piutang', content });
  });

  /* ================= cetak bukti piutang (pencairan & pelunasan) ================= */
  function buktiPage({ c, jenis, nama, noRef, tanggal, nominal, terbilang, rincian, footerNote, req }) {
    const isCair = jenis === 'cair';
    const body = `<div class="kwit-box">
        <div class="head"><span>BUKTI ${isCair ? 'PENCAIRAN / PENAMBAHAN PIUTANG' : 'PELUNASAN / CICILAN PIUTANG'}</span><span>No. ${esc(noRef)}</span></div>
        <div class="kwit-body">
          <div class="k">Nama Pegawai</div><div class="v">${esc(nama)}</div>
          ${rincian.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('')}
          <div class="k">Uang sejumlah</div><div class="v" style="font-style:italic">${esc(terbilang)}</div>
          <div class="k">Tanggal</div><div class="v">${tglID(tanggal)}</div>
          <div class="k">Jumlah</div><div class="v kwit-amt">${rupiah(nominal)}</div>
        </div>
      </div>
      <div class="sign-grid sign-3">
        <div class="sig"><div>Mengetahui,</div><div style="font-weight:600">Kepala ${esc(c.settings.sekolah_nama || 'Sekolah')}</div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_kepala || '............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_kepala || '.....................')}</div></div>
        <div class="sig"><div>${esc(c.settings.sekolah_nama || '')}, ${tglID(tanggal)}<br>Bendahara</div><div class="space"></div>
          <div class="nm">${esc(c.settings.sekolah_bendahara || '............................')}</div>
          <div>NIP. ${esc(c.settings.sekolah_nip_bendahara || '.....................')}</div></div>
        <div class="sig"><div>${isCair ? 'Penerima' : 'Penyetor'}</div><div class="space"></div>
          <div class="nm">${esc(nama)}</div></div>
      </div>
      <p class="kwit-foot">${esc(footerNote || '')}</p>`;
    return ui.kwitansiPage({
      settings: c.settings, base: c.base,
      title: isCair ? 'Bukti Pencairan Piutang' : 'Bukti Pelunasan Piutang',
      body, backHref: '/piutang', backLabel: 'Kembali ke Piutang',
      orient: printcfg.orient(req, dbm, 'kwitansi_trx'), selfPath: req ? req.url : ''
    });
  }

  get('/piutang/:id/bukti', (req, res) => {
    if (!guard(req, res, 'piutang', 'view')) return;
    const c = ctx(req);
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(req.params.id);
    if (!p) return res.notFound();
    const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(p.id).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - dibayar);
    res.html(buktiPage({
      c, req, jenis: 'cair', nama: p.nama_pegawai, noRef: `PT/${String(p.id).padStart(5, '0')}`,
      tanggal: p.tanggal_utang || todayISO(), nominal: Number(p.nominal || 0),
      terbilang: lib.terbilangRupiah(Number(p.nominal || 0)),
      rincian: [
        ['Jenis Piutang', 'Piutang Pegawai (Umum)'],
        ['Tanggal Utang', tglID(p.tanggal_utang)],
        ['Keterangan', esc(p.keterangan || '-')],
        ['Sudah Dicicil', rupiah(dibayar)],
        ['Sisa Tagihan', rupiah(sisa)]
      ],
      footerNote: 'Kwitansi ini sah sebagai bukti pencairan/penambahan piutang pegawai.'
    }));
  });

  get('/piutang/bayar/:id/bukti', (req, res) => {
    if (!guard(req, res, 'piutang', 'view')) return;
    const c = ctx(req);
    const b = db.prepare('SELECT * FROM piutang_bayar WHERE id=?').get(req.params.id);
    if (!b) return res.notFound();
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(b.piutang_id) || {};
    const total = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(b.piutang_id).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - total);
    res.html(buktiPage({
      c, req, jenis: 'lunas', nama: p.nama_pegawai || '-', noRef: `PLP/${String(b.id).padStart(5, '0')}`,
      tanggal: b.tanggal || todayISO(), nominal: Number(b.nominal || 0),
      terbilang: lib.terbilangRupiah(Number(b.nominal || 0)),
      rincian: [
        ['Jenis Piutang', 'Piutang Pegawai (Umum)'],
        ['Nominal Utang Awal', rupiah(p.nominal)],
        ['Metode', b.metode === 'transfer' ? 'Transfer Bank' : 'Tunai'],
        ['Keterangan', esc(b.keterangan || '-')],
        ['Sisa Setelah Pembayaran', rupiah(sisa)]
      ],
      footerNote: sisa <= 0 ? 'Pembayaran ini melunasi seluruh piutang pegawai.' : 'Kwitansi ini sah sebagai bukti pelunasan/cicilan piutang pegawai.'
    }));
  });

  /* ================= simpan piutang ================= */
  post('/piutang/save', (req, res) => {
    if (!guard(req, res, 'piutang', req.body.id ? 'edit' : 'create')) return;
    const { id, nama_pegawai, tanggal_utang, bku_id, keterangan } = req.body;
    const nominal = lib.parseMoney(req.body.nominal);
    if (!nama_pegawai || !(nominal > 0)) return backGo(req, res, 'Nama pegawai dan nominal wajib diisi.', 'err');
    if (id) {
      const old = db.prepare('SELECT * FROM piutang WHERE id=?').get(id);
      const dibayar = db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(id).s;
      if (nominal < dibayar) return backGo(req, res, `Nominal utang tidak boleh lebih kecil dari total cicilan (${rupiah(dibayar)}).`, 'err');
      db.prepare('UPDATE piutang SET nama_pegawai=?,tanggal_utang=?,nominal=?,bku_id=?,keterangan=? WHERE id=?')
        .run(nama_pegawai, tanggal_utang, nominal, bku_id || null, keterangan || '', id);
      const sisa = Math.max(0, nominal - dibayar);
      db.prepare("UPDATE piutang SET status=?, tanggal_bayar=? WHERE id=?")
        .run(sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (old.tanggal_bayar || todayISO()) : null, id);
      dbm.logAudit(req.user, 'EDIT', 'piutang', `Edit piutang ${nama_pegawai} (${rupiah(nominal)})`);
    } else {
      const taRow = dbm.taOf(req) || dbm.activeTahun();
      db.prepare('INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,tanggal_bayar,status,bku_id,keterangan,created_at,tahun_ajaran_id) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(nama_pegawai, tanggal_utang, nominal, null, 'belum', bku_id || null, keterangan || '', nowStamp(), taRow ? taRow.id : null);
      dbm.logAudit(req.user, 'TAMBAH', 'piutang', `Tambah piutang pegawai ${nama_pegawai} (${rupiah(nominal)})`);
    }
    backGo(req, res, 'Data piutang disimpan.', 'ok');
  });

  /* ================= cicilan / pelunasan (TANPA BKU) ================= */
  post('/piutang/bayar', (req, res) => {
    if (!guard(req, res, 'piutang', 'edit')) return;
    const { id, tanggal_bayar, metode, keterangan } = req.body;
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(id);
    if (!p) return backGo(req, res, 'Piutang tidak ditemukan.', 'err');
    const tanggal = tanggal_bayar || todayISO();
    const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(p.id).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - dibayar);
    if (sisa <= 0) return backGo(req, res, 'Piutang ini sudah lunas.', 'err');
    const nominal = lib.parseMoney(req.body.nominal);
    if (!(nominal > 0)) return backGo(req, res, 'Nominal cicilan harus lebih dari 0.', 'err');
    if (nominal > sisa) return backGo(req, res, `Nominal cicilan melebihi sisa piutang (${rupiah(sisa)}).`, 'err');

    // pelunasan piutang pegawai TIDAK dibukukan ke BKU mana pun
    const hasil = db.transaction(() => {
      db.prepare(`INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
        VALUES (?,?,?,?,NULL,NULL,?,?,?)`)
        .run(p.id, tanggal, nominal, metode || 'tunai', keterangan || '', nowStamp(), req.user.id);
      return recalcPiutang(p.id, tanggal);
    })();
    dbm.logAudit(req.user, 'EDIT', 'piutang',
      `Cicilan piutang ${p.nama_pegawai} ${rupiah(nominal)} (tanpa BKU); sisa ${rupiah(hasil.sisa)}`);
    const msg = hasil.sisa <= 0
      ? `Piutang ${p.nama_pegawai} LUNAS.`
      : `Cicilan ${rupiah(nominal)} dicatat. Sisa piutang ${p.nama_pegawai} menjadi ${rupiah(hasil.sisa)}.`;
    backGo(req, res, msg, 'ok');
  });

  /* ================= riwayat pembayaran: edit & hapus (piutang pegawai) ================= */
  /** hitung ulang status satu piutang dari total cicilan */
  function refreshPiutang(pid) {
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(pid);
    if (!p) return null;
    const dibayar = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=?').get(pid).s || 0);
    const sisa = Math.max(0, Number(p.nominal || 0) - dibayar);
    const last = db.prepare('SELECT tanggal FROM piutang_bayar WHERE piutang_id=? ORDER BY tanggal DESC, id DESC LIMIT 1').get(pid);
    db.prepare('UPDATE piutang SET status=?, tanggal_bayar=? WHERE id=?')
      .run(sisa <= 0 ? 'lunas' : 'belum', sisa <= 0 ? (last ? last.tanggal : todayISO()) : null, pid);
    return { dibayar, sisa };
  }

  post('/piutang/bayar/save', (req, res) => {
    if (!guard(req, res, 'piutang', 'edit')) return;
    const b = db.prepare('SELECT * FROM piutang_bayar WHERE id=?').get(req.body.id);
    if (!b) return backGo(req, res, 'Riwayat pembayaran tidak ditemukan.', 'err');
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(b.piutang_id);
    const nominal = lib.parseMoney(req.body.nominal);
    const tanggal = String(req.body.tanggal || '').slice(0, 10) || b.tanggal;
    if (!(nominal > 0)) return backGo(req, res, 'Nominal pembayaran harus lebih dari 0.', 'err');
    const lain = Number(db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM piutang_bayar WHERE piutang_id=? AND id<>?').get(b.piutang_id, b.id).s || 0);
    const totalUtang = Number(p ? p.nominal || 0 : 0);
    if (nominal > Math.max(0, totalUtang - lain)) {
      return backGo(req, res, `Nominal pembayaran melebihi sisa piutang (${rupiah(Math.max(0, totalUtang - lain))}).`, 'err');
    }
    db.transaction(() => {
      db.prepare('UPDATE piutang_bayar SET tanggal=?,nominal=?,metode=?,keterangan=? WHERE id=?')
        .run(tanggal, nominal, req.body.metode === 'transfer' ? 'transfer' : 'tunai',
          String(req.body.keterangan || '').trim(), b.id);
      refreshPiutang(b.piutang_id);
    })();
    dbm.logAudit(req.user, 'EDIT', 'piutang',
      `Ubah riwayat pembayaran ${p ? p.nama_pegawai : '#' + b.piutang_id}: ${rupiah(b.nominal)} → ${rupiah(nominal)} (${tglID(tanggal)})`);
    backGo(req, res, `Riwayat pembayaran ${p ? p.nama_pegawai : ''} diperbarui menjadi ${rupiah(nominal)}.`, 'ok');
  });

  post('/piutang/bayar/delete', (req, res) => {
    if (!guard(req, res, 'piutang', 'delete')) return;
    const b = db.prepare('SELECT * FROM piutang_bayar WHERE id=?').get(req.body.id);
    if (!b) return backGo(req, res, 'Riwayat pembayaran tidak ditemukan.', 'err');
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(b.piutang_id);
    // transaksi BKU terkait (bila cicilan dibuat lewat transaksi kas) ikut dibatalkan bila periodenya belum dikunci
    let trxDihapus = false;
    if (b.transaksi_id) {
      const t = db.prepare('SELECT * FROM transaksi WHERE id=?').get(b.transaksi_id);
      if (t && !dbm.periodeLockError(t.bku_id, t.tanggal, 'edit')) {
        dbm.trashAdd('transaksi', t, { user: req.user, alasan: 'Hapus riwayat pembayaran piutang', label: `${t.no_bukti} — ${t.uraian}` });
        db.prepare('DELETE FROM transaksi WHERE id=?').run(t.id);
        trxDihapus = true;
      }
    }
    dbm.trashAdd('piutang_bayar', b, {
      user: req.user,
      label: `Pembayaran piutang ${p ? p.nama_pegawai : '#' + b.piutang_id} ${rupiah(b.nominal)} (${tglID(b.tanggal)})`
    });
    db.transaction(() => {
      db.prepare('DELETE FROM piutang_bayar WHERE id=?').run(b.id);
      refreshPiutang(b.piutang_id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'piutang',
      `Hapus riwayat pembayaran ${p ? p.nama_pegawai : '#' + b.piutang_id} ${rupiah(b.nominal)} (${tglID(b.tanggal)})${trxDihapus ? ' + transaksi BKU terkait' : ''}`);
    backGo(req, res, `Riwayat pembayaran ${rupiah(b.nominal)} dihapus. Sisa piutang dihitung ulang${trxDihapus ? ' dan transaksi BKU terkait ikut dihapus' : ''}.`, 'ok');
  });

  /* ================= pembayaran gabungan (konsolidasi beberapa piutang) ================= */
  post('/piutang/bayar-gabungan', (req, res) => {
    if (!guard(req, res, 'piutang', 'edit')) return;
    const nama = String(req.body.nama || '').trim();
    const { tanggal_bayar, metode, keterangan } = req.body;
    if (!nama) return backGo(req, res, 'Nama pegawai tidak dikenali.', 'err');
    const tanggal = tanggal_bayar || todayISO();
    const nominal = lib.parseMoney(req.body.nominal);
    if (!(nominal > 0)) return backGo(req, res, 'Nominal pembayaran harus lebih dari 0.', 'err');

    const list = db.prepare(`SELECT p.id, p.nominal,
        COALESCE((SELECT SUM(x.nominal) FROM piutang_bayar x WHERE x.piutang_id=p.id),0) dibayar
      FROM piutang p WHERE lower(p.nama_pegawai)=lower(?) AND p.status='belum'
      ORDER BY p.tanggal_utang, p.id`).all(nama)
      .map(p => ({ ...p, sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }))
      .filter(p => p.sisa > 0);
    if (!list.length) return backGo(req, res, `Tidak ada piutang belum lunas untuk ${nama}.`, 'err');
    const totalSisa = list.reduce((s2, p) => s2 + p.sisa, 0);
    if (nominal > totalSisa) return backGo(req, res, `Nominal pembayaran ${rupiah(nominal)} melebihi total sisa piutang ${rupiah(totalSisa)}.`, 'err');

    let sisaBayar = nominal, lunas = 0, kena = 0;
    db.transaction(() => {
      const insBayar = db.prepare(`INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
        VALUES (?,?,?,?,NULL,NULL,?,?,?)`);
      for (const p of list) {
        if (sisaBayar <= 0) break;
        const bayar = Math.min(p.sisa, sisaBayar);
        sisaBayar -= bayar;
        kena++;
        insBayar.run(p.id, tanggal, bayar, metode || 'tunai', keterangan || 'Pembayaran gabungan', nowStamp(), req.user.id);
        const r = recalcPiutang(p.id, tanggal);
        if (r && r.status === 'lunas') lunas++;
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'piutang',
      `Pembayaran gabungan piutang ${nama} ${rupiah(nominal)} untuk ${kena} piutang (${lunas} lunas, tanpa BKU)`);
    backGo(req, res,
      `Pembayaran gabungan ${rupiah(nominal)} dicatat untuk ${nama} (${kena} piutang, ${lunas} otomatis LUNAS).`, 'ok');
  });

  post('/piutang/delete', (req, res) => {
    if (!guard(req, res, 'piutang', 'delete')) return;
    const p = db.prepare('SELECT * FROM piutang WHERE id=?').get(req.body.id);
    if (p) {
      const anak = db.prepare('SELECT * FROM piutang_bayar WHERE piutang_id=?').all(p.id);
      dbm.trashAdd('piutang', p, { user: req.user, label: `Piutang ${p.nama_pegawai} ${rupiah(p.nominal)}`, extra: { children: [{ tabel: 'piutang_bayar', rows: anak }] } });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM piutang_bayar WHERE piutang_id=?').run(req.body.id);
      db.prepare('DELETE FROM piutang WHERE id=?').run(req.body.id);
    })();
    dbm.logAudit(req.user, 'HAPUS', 'piutang', `Hapus piutang ${p ? p.nama_pegawai : req.body.id}`);
    backGo(req, res, 'Data piutang dihapus.', 'ok');
  });

  /* ================= SPP ================= */
  post('/spp/save', (req, res) => {
    if (!guard(req, res, 'piutang', 'create')) return;
    const taId = req.body.tahun_ajaran_id;
    if (!taId) return backGo(req, res, 'Tahun ajaran belum dipilih.', 'err');
    const auto = dbm.sppTerimaMap(taId);
    db.transaction(() => {
      for (let i = 1; i <= 12; i++) {
        const tagih = lib.parseMoney(req.body['tagih_' + i]);
        const existing = db.prepare('SELECT * FROM spp WHERE tahun_ajaran_id=? AND bulan=?').get(taId, i);
        const manual = existing ? Number(existing.diterima_manual || 0) : 0;
        // total_diterima hanya untuk kompatibilitas laporan lama — nilainya selalu = manual + transaksi
        const terima = manual + Number(auto[i] || 0);
        db.prepare(`INSERT INTO spp (tahun_ajaran_id,bulan,total_ditagihkan,total_diterima,keterangan,diterima_manual) VALUES (?,?,?,?,'',?)
          ON CONFLICT(tahun_ajaran_id,bulan) DO UPDATE SET total_ditagihkan=excluded.total_ditagihkan, total_diterima=excluded.total_diterima`)
          .run(taId, i, tagih, terima, manual);
      }
    })();
    dbm.logAudit(req.user, 'EDIT', 'spp', `Memperbarui total tagihan SPP bulanan TA ${taId} (total diterima otomatis dari transaksi 4.1.01)`);
    backGo(req, res, 'Total tagihan SPP diperbarui. Total diterima mengikuti transaksi Penerimaan SPP.', 'ok');
  });

  /* ================= import piutang ================= */
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
  const cellUp = c => X.cellText(c).toUpperCase();

  post('/piutang/import', (req, res) => {
    if (!guard(req, res, 'piutang', 'create')) return;
    const buf = decodeFile(req.body.file_b64);
    if (!buf) return backGo(req, res, 'Pilih berkas Excel/CSV terlebih dahulu.', 'err');
    let sheets;
    try { sheets = readAny(buf); } catch (e) { backGo(req, res, 'Gagal membaca berkas: ' + e.message, 'err'); }

    // cari sheet + baris header yang punya TANGGAL, NAMA, MASUK/KELUAR
    let header = null, sheet = null;
    for (const sh of sheets) {
      for (let i = 0; i < sh.rows.length; i++) {
        const cells = sh.rows[i] || [];
        const labels = cells.map(cellUp);
        const iTgl = labels.findIndex(t => /TANGGAL|TGL/.test(t));
        const iNama = labels.findIndex(t => /NAMA|PEGAWAI/.test(t));
        const iMasuk = labels.findIndex(t => /MASUK/.test(t));
        const iKeluar = labels.findIndex(t => /KELUAR/.test(t));
        if (iTgl >= 0 && iNama >= 0 && (iMasuk >= 0 || iKeluar >= 0)) {
          header = { row: i, iTgl, iNama, iMasuk, iKeluar };
          sheet = sh;
          break;
        }
      }
      if (header) break;
    }
    if (!header) return backGo(req, res, 'Header kolom TANGGAL | NAMA | MASUK | KELUAR tidak ditemukan pada berkas.', 'err');

    let baru = 0, cicilan = 0, dilewati = 0, tanpaPiutang = 0;
    const namaFile = String(req.body.file_name || 'import').slice(-80);
    const taImp = dbm.taOf(req) || dbm.activeTahun();
    db.transaction(() => {
      for (let i = header.row + 1; i < sheet.rows.length; i++) {
        const cells = sheet.rows[i] || [];
        if (!cells.length) continue;
        const teksBaris = cells.map(cellUp).join(' ');
        if (/JUMLAH|TOTAL|SALDO AWAL|TANDA TANGAN/.test(teksBaris)) continue;
        const nama = X.cellText(cells[header.iNama]).trim();
        const tanggal = X.parseDateCell(cells[header.iTgl]) || todayISO();
        const masuk = header.iMasuk >= 0 ? X.parseMoneyCell(cells[header.iMasuk]) : 0;
        const keluar = header.iKeluar >= 0 ? X.parseMoneyCell(cells[header.iKeluar]) : 0;
        if (!nama || (!masuk && !keluar)) { if (nama || masuk || keluar) dilewati++; continue; }

        if (keluar > 0) {
          const dup = db.prepare('SELECT id FROM piutang WHERE lower(nama_pegawai)=lower(?) AND tanggal_utang=? AND nominal=?')
            .get(nama, tanggal, keluar);
          if (dup) { dilewati++; }
          else {
            db.prepare('INSERT INTO piutang (nama_pegawai,tanggal_utang,nominal,tanggal_bayar,status,bku_id,keterangan,created_at,tahun_ajaran_id) VALUES (?,?,?,?,?,?,?,?,?)')
              .run(nama, tanggal, keluar, null, 'belum', null, 'Import ' + namaFile, nowStamp(), taImp ? taImp.id : null);
            baru++;
          }
        }
        if (masuk > 0) {
          let sisaBayar = masuk;
          const list = db.prepare(`SELECT p.id, p.nominal,
              COALESCE((SELECT SUM(x.nominal) FROM piutang_bayar x WHERE x.piutang_id=p.id),0) dibayar
            FROM piutang p WHERE lower(p.nama_pegawai)=lower(?) AND p.status='belum' ORDER BY p.tanggal_utang, p.id`).all(nama);
          for (const row of list) {
            if (sisaBayar <= 0) break;
            const sisa = Math.max(0, Number(row.nominal || 0) - Number(row.dibayar || 0));
            if (sisa <= 0) continue;
            const bayar = Math.min(sisa, sisaBayar);
            sisaBayar -= bayar;
            db.prepare(`INSERT INTO piutang_bayar (piutang_id,tanggal,nominal,metode,bku_id,transaksi_id,keterangan,created_at,created_by)
              VALUES (?,?,?,'tunai',NULL,NULL,?,?,?)`).run(row.id, tanggal, bayar, 'Import ' + namaFile, nowStamp(), req.user.id);
            const sisaAkhir = sisa - bayar;
            db.prepare('UPDATE piutang SET status=?, tanggal_bayar=? WHERE id=?')
              .run(sisaAkhir <= 0 ? 'lunas' : 'belum', sisaAkhir <= 0 ? tanggal : null, row.id);
            cicilan++;
          }
          if (sisaBayar > 0) tanpaPiutang++;
        }
      }
    })();
    dbm.logAudit(req.user, 'IMPORT', 'piutang',
      `Import piutang ${namaFile}: ${baru} pinjaman baru, ${cicilan} cicilan, ${dilewati} dilewati, ${tanpaPiutang} pembayaran tanpa data piutang`);
    backGo(req, res, 
      `Import selesai: ${baru} pinjaman baru, ${cicilan} cicilan tercatat, ${dilewati} baris dilewati${tanpaPiutang ? `, ${tanpaPiutang} pembayaran tidak menemukan data piutang` : ''}.`, 'ok');
  });
};
