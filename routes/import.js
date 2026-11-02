'use strict';
const X = require('../xlsx-read');
const IMP = require('../importer');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num, xlsxBuffer } = lib;

  const sesi = new Map(); // id → { user_id, analysis, nama_file, created }

  function cleanup() {
    const now = Date.now();
    for (const [k, v] of sesi) if (now - v.created > 1000 * 60 * 60) sesi.delete(k);
  }

  function decodeFile(b64) {
    const raw = String(b64 || '');
    if (!raw) return null;
    const m = raw.match(/^data:([^;]*);base64,([\s\S]*)$/);
    const data = m ? m[2] : raw;
    const mime = m ? m[1] : '';
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) return null;
    return { buf, mime };
  }

  function readAny(buf, mime) {
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    if (isZip) return X.readXlsx(buf);
    const text = buf.toString('utf8');
    if (/<\?xml|<html|<table/i.test(text.slice(0, 200)) && /<table/i.test(text)) {
      throw new Error('File ini sepertinya HTML/XML (bukan XLSX). Buka dengan Excel lalu simpan ulang sebagai .xlsx.');
    }
    if (/content-type: multipart|xl\/worksheets/i.test(text.slice(0, 300))) {
      throw new Error('File ini bukan XLSX asli. Gunakan "Save As → Excel Workbook (.xlsx)".');
    }
    return X.readCsv(text);
  }

  /* ================= halaman import ================= */
  get('/import', (req, res) => {
    guard(req, res, 'import', 'view');
    const c = ctx(req);
    const ta = c.ta;
    const bkuss = dbm.allBku(ta ? ta.id : null);
    const presetBku = req.query.get('bku') || '';
    const riwayat = db.prepare(`SELECT i.*, b.nama bku_nama FROM bku_import i LEFT JOIN bku b ON b.id=i.bku_id
      ORDER BY i.id DESC LIMIT 15`).all();
    const bolehImport = c.can('import', 'create');

    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Import BKU dari Excel</h3><div class="sub">Baca file BKU offline (format kolom TANGGAL · KETERANGAN · MASUK · KELUAR · SALDO)</div></div>
          <a class="btn btn-sm" href="${c.base}/import/template">${ui.icon('download')}Template XLSX</a></div>

        <div class="alert info">${ui.icon('info')}<div>
          <b>Format yang dikenali otomatis:</b> judul BKU di baris atas sheet (mis. <i>“INFAK JUMAT”</i>, <i>“BKU PKL”</i>),
          lalu baris header <code>TANGGAL | KETERANGAN | MASUK | KELUAR | SALDO</code>. Tanggal <code>DD/MM/YYYY</code> dan nominal
          <code>Rp 1.250.000</code> / <code>-250.000</code> dibersihkan menjadi angka. Baris berisi MASUK → pemasukan, KELUAR → pengeluaran,
          dan saldo dihitung ulang lalu dibandingkan dengan kolom SALDO (rekonsiliasi).
        </div></div>

        ${bolehImport ? `<form method="post" action="${c.base}/import/preview">
          <input type="hidden" name="file_b64" id="file_b64">
          <input type="hidden" name="file_name" id="file_name">
          <div class="field"><label>Berkas Excel (.xlsx / .csv, maks 10 MB)</label>
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-b64="file_b64" data-max="10" data-filename="file_name">
            <div class="hint" id="file_b64-info">Pilih file — data belum disimpan sebelum Anda menekan “Proses &amp; Pratinjau”.</div></div>
          <div class="row2">
            <div class="field"><label>Tahun Ajaran (target BKU)</label>
              <select name="ta">${dbm.allTahun().map(t => `<option value="${t.id}" ${ta && ta.id === t.id ? 'selected' : ''}>${esc(t.nama)}</option>`).join('')}</select></div>
            <div class="field"><label>BKU Tujuan (opsional)</label>
              <select name="bku_id"><option value="">— Deteksi otomatis dari judul Excel —</option>
              ${bkuss.map(b => `<option value="${b.id}" ${String(presetBku) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}${b.status !== 'aktif' ? ' (ditutup)' : ''}</option>`).join('')}</select></div>
          </div>
          <button class="btn btn-primary btn-block" type="submit">${ui.icon('upload')}Proses &amp; Pratinjau</button>
        </form>` : `<div class="alert warn">${ui.icon('lock')}<div>Role Anda hanya dapat melihat riwayat import.</div></div>`}

        <hr class="sep">
        <div class="small muted">
          <b>Tips:</b> kalau nama BKU di Excel tidak sama dengan master, pilih manual di kolom “BKU Tujuan”.
          Baris <i>Saldo Awal</i>, <i>JUMLAH</i>, dan baris tanda tangan otomatis dilewati. Transaksi yang sama
          (tanggal + nominal + keterangan) tidak akan diduplikasi.
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Riwayat Import</h3><div class="sub">15 import terakhir</div></div></div>
        ${riwayat.length ? `<div class="list">${riwayat.map(r => `<div class="list-row" style="display:block">
          <div class="between" style="align-items:flex-start">
            <div style="min-width:0">
              <div class="nm">${esc(r.bku_nama || '-')} <span class="badge ${r.reconciled ? 'green' : 'amber'} plain">${r.reconciled ? 'Cocok' : 'Ada selisih'}</span></div>
              <div class="mt">${esc(r.nama_file || '')}</div>
              <div class="mt">${esc(r.user_nama || '')} · ${esc(r.created_at || '')}</div>
            </div>
            <div class="right nowrap">
              <div class="t-strong">${rupiah(r.total_masuk)}</div>
              <div class="mt" style="color:var(--red)">− ${rupiah(r.total_keluar)}</div>
            </div>
          </div></div>`).join('')}</div>` : '<div class="help">Belum ada riwayat import.</div>'}
      </div>
    </div>`;

    page(req, res, { title: 'Import Excel BKU', sub: 'Baca format BKU offline & rekonsiliasi saldo', active: 'import', content });
  });

  /* template */
  get('/import/template', (req, res) => {
    guard(req, res, 'import', 'view');
    const c = ctx(req);
    const rows = [
      [{ v: 'BKU UMUM', bold: true }],
      ['Tahun Ajaran: ' + ((c.ta || {}).nama || '-')],
      [],
      [{ v: 'No', bold: true }, { v: 'TANGGAL', bold: true }, { v: 'KETERANGAN', bold: true }, { v: 'MASUK', bold: true }, { v: 'KELUAR', bold: true }, { v: 'SALDO', bold: true }],
      [1, '01/07/2026', 'Saldo awal', 2500000, '', 2500000],
      [2, '05/07/2026', 'Penerimaan dana BOS', 'Rp 12.000.000', '', 14500000],
      [3, '08/07/2026', 'Belanja ATK', '', 'Rp 1.250.000', 13250000],
      [4, '10/07/2026', 'Honorarium guru', '', '-Rp 4.500.000', 8750000],
      ['', '', 'JUMLAH', 'Rp 12.000.000', 'Rp 5.750.000', 'Rp 8.750.000']
    ];
    const buf = xlsxBuffer('BKU', rows, [6, 14, 42, 18, 18, 18]);
    res.file(buf, 'Template-Import-BKU.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  /* ================= pratinjau ================= */
  post('/import/preview', (req, res) => {
    guard(req, res, 'import', 'create');
    const file = decodeFile(req.body.file_b64);
    if (!file) return res.redirect(req.BASE + '/import?err=' + encodeURIComponent('Berkas belum dipilih atau kosong.'));
    let sheets;
    try {
      sheets = readAny(file.buf, file.mime);
    } catch (e) {
      return res.redirect(req.BASE + '/import?err=' + encodeURIComponent('Gagal membaca berkas: ' + e.message));
    }
    const best = IMP.bestSheet(sheets);
    if (!best || !best.analysis.rows.length) {
      return res.redirect(req.BASE + '/import?err=' + encodeURIComponent('Tabel BKU (TANGGAL/KETERANGAN/MASUK/KELUAR/SALDO) tidak ditemukan di file ini.'));
    }
    cleanup();
    const id = lib.token(10);
    sesi.set(id, {
      user_id: req.user.id,
      nama_file: String(req.body.file_name || 'import.xlsx').slice(0, 120),
      analysis: best.analysis,
      sheets: sheets.map(s => s.name),
      created: Date.now()
    });

    const c0 = ctx(req);
    const taId = req.body.ta || c0.taId;
    const bkuss = dbm.allBku(taId);
    const guess = IMP.guessBku(best.analysis.title, bkuss);
    const chosen = req.body.bku_id || (guess ? guess.id : '');
    const c = ctx(req);
    const a = best.analysis;

    const issueRows = a.issues.slice(0, 20).map(i => `<li class="t-sub">${esc(i.msg)}</li>`).join('');
    const previewRows = a.rows.slice(0, 300).map((r, i) => `<tr>
      <td class="num t-sub">${i + 1}</td>
      <td class="nowrap">${r.tanggal ? tglID(r.tanggal) : `<span class="badge red plain">tidak valid</span> <span class="t-sub">${esc(r.tanggalRaw || '')}</span>`}</td>
      <td>${esc(r.keterangan)}</td>
      <td class="num" style="color:var(--green)">${r.jenis === 'pemasukan' ? rupiah(r.nominal) : '—'}</td>
      <td class="num" style="color:var(--red)">${r.jenis === 'pengeluaran' ? rupiah(r.nominal) : '—'}</td>
      <td class="num">${r.saldoFile !== null ? rupiah(r.saldoFile) : '<span class="muted">—</span>'}</td>
      <td class="num">${rupiah(r.saldoHitung)}</td>
      <td>${r.selisih === null ? '<span class="muted">—</span>' : Math.abs(r.selisih) < 1 ? ui.badge('Cocok', 'green') : ui.badge('Selisih ' + rupiah(r.selisih), 'amber')}</td>
    </tr>`).join('');

    const content = `
    <div class="between mb-2">
      <a class="btn btn-sm" href="${c.base}/import">${ui.icon('x')}Batal / Upload Ulang</a>
      <span class="small muted">Berkas: ${esc(sesi.get(id).nama_file)} · sheet: ${esc(a.sheet)}</span>
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Hasil Pembacaan</h3><div class="sub">Periksa dulu sebelum menyimpan — belum ada data yang masuk</div></div>
        ${a.reconciled ? ui.badge('Saldo rekonsiliasi cocok', 'green') : ui.badge('Ada selisih saldo', 'amber')}</div>
      <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="kpi ic-orange"><div class="ico">${ui.icon('book')}</div><div class="lbl">Judul Terdeteksi</div>
          <div class="val" style="font-size:16px">${esc(a.title || '(tidak terdeteksi)')}</div><div class="meta">Header baris ${a.headerRow}${a.tahun ? ' · TA ' + esc(a.tahun) : ''}</div></div>
        <div class="kpi ic-green"><div class="ico">${ui.icon('up')}</div><div class="lbl">Pemasukan</div>
          <div class="val" style="font-size:17px">${rupiah(a.totals.masuk)}</div><div class="meta">${a.rows.filter(r => r.jenis === 'pemasukan').length} baris</div></div>
        <div class="kpi ic-red"><div class="ico">${ui.icon('down')}</div><div class="lbl">Pengeluaran</div>
          <div class="val" style="font-size:17px">${rupiah(a.totals.keluar)}</div><div class="meta">${a.rows.filter(r => r.jenis === 'pengeluaran').length} baris</div></div>
        <div class="kpi ic-blue"><div class="ico">${ui.icon('wallet')}</div><div class="lbl">Saldo Awal / Akhir</div>
          <div class="val" style="font-size:17px">${rupiah(a.opening)}</div>
          <div class="meta">Akhir hitung ${rupiah(a.computedAkhir)}${a.saldoFileAkhir !== null ? ' · file ' + rupiah(a.saldoFileAkhir) : ''}</div></div>
      </div>
      ${a.issues.length ? `<div class="alert warn mt-2">${ui.icon('alert')}<div><b>${a.issues.length} catatan dari pembacaan:</b>
        <ul style="margin:6px 0 0 16px;padding:0">${issueRows}${a.issues.length > 20 ? '<li>…</li>' : ''}</ul></div></div>`
        : `<div class="alert ok mt-2">${ui.icon('check')}<div>Semua baris terbaca bersih dan saldo hasil hitung <b>sama dengan</b> kolom SALDO pada Excel.</div></div>`}
    </div>

    <div class="card mb-3">
      <div class="card-head"><div><h3>Pemetaan &amp; Simpan</h3><div class="sub">Pilih BKU tujuan lalu konfirmasi</div></div></div>
      <form method="post" action="${c.base}/import/commit">
        <input type="hidden" name="sesi" value="${id}">
        <div class="row3">
          <div class="field"><label>BKU Tujuan</label>
            <select name="bku_id" required>
              <option value="">— pilih BKU —</option>
              ${bkuss.map(b => `<option value="${b.id}" ${String(chosen) === String(b.id) ? 'selected' : ''}>${esc(b.nama)}${b.status !== 'aktif' ? ' (ditutup)' : ''}</option>`).join('')}
            </select>
            ${guess ? `<div class="hint">Terdeteksi cocok dengan <b>${esc(guess.nama)}</b> dari judul Excel.</div>` : '<div class="hint" style="color:var(--amber)">Judul Excel tidak cocok dengan master BKU — pilih manual.</div>'}
          </div>
          <div class="field"><label>Saldo Awal</label>
            <select name="opening_mode">
              <option value="keep">Biarkan saldo awal BKU yang ada (${rupiah(0)} → tidak diubah)</option>
              <option value="set">Set saldo awal BKU = ${rupiah(a.opening)} (dari baris “Saldo Awal” Excel)</option>
            </select>
            <div class="hint">Pilih “set” bila BKU tujuan masih kosong dan ingin memakai saldo awal dari Excel.</div>
          </div>
          <div class="field"><label>Duplikat</label>
            <select name="dedupe">
              <option value="1">Lewati transaksi yang identik (tanggal + nominal + keterangan)</option>
              <option value="0">Tetap import semua baris</option>
            </select></div>
        </div>
        <div class="form-actions" style="border:0">
          <a class="btn" href="${c.base}/import">Batal</a>
          <button class="btn btn-primary">${ui.icon('save')}Import ${a.rows.length} Transaksi ke BKU</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Pratinjau Baris (${a.rows.length})</h3>
        <div class="sub">Menampilkan maksimal 300 baris pertama</div></div></div>
      <div class="table-wrap"><table><thead><tr>
        <th style="width:44px">#</th><th>Tanggal</th><th>Keterangan</th><th class="num">Masuk</th><th class="num">Keluar</th>
        <th class="num">Saldo (Excel)</th><th class="num">Saldo (Hitung)</th><th>Rekonsiliasi</th>
      </tr></thead><tbody>
        <tr style="background:#FFF8F2"><td></td><td colspan="4" class="t-strong">Saldo awal</td><td></td><td class="num t-strong">${rupiah(a.opening)}</td><td></td></tr>
        ${previewRows}
      </tbody></table></div>
    </div>`;

    page(req, res, { title: 'Pratinjau Import BKU', sub: 'Periksa hasil pembacaan sebelum menyimpan', active: 'import', content });
  });

  /* ================= commit ================= */
  post('/import/commit', (req, res) => {
    guard(req, res, 'import', 'create');
    const s = sesi.get(req.body.sesi);
    if (!s) return res.redirect(req.BASE + '/import?err=' + encodeURIComponent('Sesi pratinjau sudah kedaluwarsa. Upload ulang berkas.'));
    if (s.user_id !== req.user.id) return res.redirect(req.BASE + '/import?err=' + encodeURIComponent('Sesi pratinjau milik pengguna lain.'));
    const b = db.prepare('SELECT * FROM bku WHERE id=?').get(req.body.bku_id);
    if (!b) return res.redirect(req.BASE + '/import?err=' + encodeURIComponent('BKU tujuan tidak ditemukan.'));
    const a = s.analysis;
    const dedupe = req.body.dedupe !== '0';
    const setOpening = req.body.opening_mode === 'set';

    const inserted = [];
    let skipped = 0;
    let dup = 0;
    db.transaction(() => {
      if (setOpening) db.prepare('UPDATE bku SET saldo_awal=? WHERE id=?').run(Math.round(a.opening) || 0, b.id);
      const seq0 = db.prepare('SELECT COUNT(*) c FROM transaksi WHERE bku_id=?').get(b.id).c;
      let seq = seq0;
      const fallbackDate = a.rows.find(r => r.tanggal)?.tanggal || todayISO();
      for (const r of a.rows) {
        const tanggal = r.tanggal || fallbackDate;
        if (dedupe) {
          const ex = db.prepare(`SELECT id FROM transaksi WHERE bku_id=? AND tanggal=? AND nominal=? AND lower(trim(uraian))=lower(trim(?)) AND status='posted'`)
            .get(b.id, tanggal, r.nominal, r.keterangan);
          if (ex) { dup++; continue; }
        }
        seq++;
        const ym = String(tanggal).slice(0, 7).replace('-', '');
        const noBukti = r.noBukti && r.noBukti.length <= 40 && !/^[\d.,]+$/.test(r.noBukti)
          ? r.noBukti
          : `${b.kode || 'BKU'}/IMP/${ym}/${String(seq).padStart(3, '0')}`;
        const info = db.prepare(`INSERT INTO transaksi
          (bku_id,tanggal,jenis,metode,no_bukti,coa_id,nominal,uraian,nama_pihak,status,created_by,created_at)
          VALUES (?,?,?,?,?,NULL,?,?,?,'posted',?,?)`)
          .run(b.id, tanggal, r.jenis, 'tunai', noBukti, r.nominal, r.keterangan, '', req.user.id, nowStamp());
        inserted.push(Number(info.lastInsertRowid));
      }
      db.prepare(`INSERT INTO bku_import (bku_id,nama_file,judul_excel,sheet,jumlah_masuk,jumlah_keluar,total_masuk,total_keluar,
        saldo_awal,saldo_akhir,reconciled,dilewati,user_id,user_nama,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(b.id, s.nama_file, a.title, a.sheet,
          a.rows.filter(r => r.jenis === 'pemasukan').length, a.rows.filter(r => r.jenis === 'pengeluaran').length,
          a.totals.masuk, a.totals.keluar, setOpening ? a.opening : 0, dbm.bkuSaldo(b.id),
          a.reconciled ? 1 : 0, dup, req.user.id, req.user.nama, nowStamp());
    })();

    dbm.logAudit(req.user, 'IMPORT', 'import',
      `Import ${inserted.length} transaksi ke BKU ${b.nama} dari ${s.nama_file} (judul: ${a.title || '-'}); ` +
      `masuk ${rupiah(a.totals.masuk)}, keluar ${rupiah(a.totals.keluar)}, ` +
      `rekonsiliasi ${a.reconciled ? 'cocok' : 'selisih'}, duplikat dilewati ${dup}${setOpening ? ', saldo awal di-set ' + rupiah(a.opening) : ''}`);
    sesi.delete(req.body.sesi);
    res.redirect(req.BASE + `/bku/${b.id}?ok=` + encodeURIComponent(`Import selesai: ${inserted.length} transaksi masuk ke ${b.nama}${dup ? `, ${dup} duplikat dilewati` : ''}. Saldo berjalan sudah dihitung ulang.`));
  });
};
