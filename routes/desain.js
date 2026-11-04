'use strict';
/**
 * Pengaturan Sistem lanjutan:
 *  1. /desain-cetak     → Pusat Desain & Orientasi Cetak (semua dokumen).
 *  2. /reset-tahun      → Reset data per tahun pelajaran (Super Admin + kata sandi).
 *  3. /audit-orphan     → Tinjau & audit transaksi tersembunyi (orphan/ghost) + hard delete.
 */
const printcfg = require('../printcfg');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, nowStamp, num } = lib;

  const isSuper = req => req.user && req.user.role === 'super_admin';

  /* ==================================================================
     1. PUSAT DESAIN & ORIENTASI CETAK
     ================================================================== */
  get('/desain-cetak', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    const cfg = printcfg.readAll(dbm);
    const ro = !isSuper(req) && !c.can('sekolah', 'edit');
    const cards = printcfg.DOCS.map(d => {
      const cur = cfg[d.key] || { orient: d.orient, labels: {} };
      return `<div class="card mb-3">
        <div class="card-head">
          <div><h3>${esc(d.label)}</h3><div class="sub">${esc(d.note || '')}</div></div>
          ${ui.badge(d.key, 'gray', 'plain')}
        </div>
        <div class="field"><label>Orientasi Default Cetak</label>
          <select name="orient_${d.key}" ${ro ? 'disabled' : ''}>
            ${printcfg.ORIENT.map(o => `<option value="${o}" ${cur.orient === o ? 'selected' : ''}>${esc(printcfg.ORIENT_LABEL[o])}</option>`).join('')}
          </select>
          <div class="hint">Setiap halaman cetak tetap punya tombol <b>Portrait / Landscape</b> untuk mengubah sesaat sebelum dicetak.</div>
        </div>
        <div class="row2">
          ${d.fields.map(([k, lab, def]) => `<div class="field"><label>${esc(lab)}</label>
            <input type="text" name="lbl_${d.key}_${k}" value="${esc(cur.labels[k] === undefined ? def : cur.labels[k])}"
              placeholder="${esc(def)}" ${ro ? 'readonly' : ''}>
            <div class="hint">Default: ${esc(def || '—')}</div></div>`).join('')}
        </div>
      </div>`;
    }).join('');
    const content = `<div class="card mb-3">
        <div class="card-head"><div><h3>Pusat Desain &amp; Orientasi Cetak</h3>
          <div class="sub">Sesuaikan redaksional (teks/label) setiap dokumen cetak dan orientasi kertas bawaannya</div></div>
          <div class="toolbar">${ro ? ui.badge('Hanya Lihat', 'gray') : ''}
            <a class="btn btn-sm" href="${c.base}/sekolah">${ui.icon('settings')}Identitas Sekolah</a></div></div>
        <div class="alert info">${ui.icon('info')}<div>Perubahan berlaku pada <b>semua cetakan</b> (kwitansi, slip honor, honor ekskul, leger, dan laporan).
          Kosongkan sebuah kolom untuk kembali ke teks default. Orientasi default dapat ditimpa per-cetak lewat tombol
          <b>Portrait / Landscape</b> di halaman cetak.</div></div>
        <form method="post" action="${c.base}/desain-cetak">
          <div class="card mb-3">
            <div class="card-head"><div><h3>Kop Surat Resmi</h3>
              <div class="sub">Teks &amp; ukuran font kop pada semua dokumen cetak</div></div>
              ${ui.badge('semua cetakan', 'orange', 'plain')}</div>
            <div class="field"><label>Teks Kop Surat (satu baris = satu baris kop)</label>
              <textarea name="kop_baris" rows="7" style="font-family:ui-monospace,monospace;font-size:12px" ${ro ? 'readonly' : ''}>${esc(c.settings.kop_baris || '')}</textarea>
              <div class="hint">Baris ke-4 otomatis ditampilkan paling besar &amp; tebal (nama sekolah). Variabel dinamis:
                <code>{nama}</code> <code>{npsn}</code> <code>{bentuk}</code> <code>{status}</code> <code>{kepemilikan}</code>
                <code>{alamat}</code> <code>{telp}</code> <code>{email}</code> <code>{website}</code>.</div></div>
            <div class="row2">
              <div class="field"><label>Ukuran Font Teks Kop (pt)</label><input type="number" step="0.5" min="6" max="24" name="kop_font" value="${esc(c.settings.kop_font || 10)}" ${ro ? 'readonly' : ''}></div>
              <div class="field"><label>Ukuran Font Nama Sekolah (pt)</label><input type="number" step="0.5" min="8" max="36" name="kop_font_besar" value="${esc(c.settings.kop_font_besar || 15)}" ${ro ? 'readonly' : ''}></div>
            </div>
            <div class="doc" style="padding:12px;border:1px dashed var(--line-2);border-radius:12px;background:#fff">
              ${ui.kop(c.settings)}
            </div>
          </div>
          <div class="card mb-3">
            <div class="card-head"><div><h3>Ukuran Kuitansi</h3>
              <div class="sub">Kertas kwitansi transaksi &amp; bukti piutang (milimeter)</div></div>
              ${ui.badge('1/3 F4 · 210 × 99 mm', 'gray', 'plain')}</div>
            <div class="row3">
              <div class="field"><label>Panjang (mm)</label><input type="number" step="0.5" min="60" name="kwitansi_w_mm" value="${esc(c.settings.kwitansi_w_mm || 210)}" ${ro ? 'readonly' : ''}></div>
              <div class="field"><label>Tinggi (mm)</label><input type="number" step="0.5" min="30" name="kwitansi_h_mm" value="${esc(c.settings.kwitansi_h_mm || 99)}" ${ro ? 'readonly' : ''}></div>
              <div class="field"><label>Margin (mm)</label><input type="number" step="0.5" min="0" name="kwitansi_margin_mm" value="${esc(c.settings.kwitansi_margin_mm || 6)}" ${ro ? 'readonly' : ''}></div>
            </div>
            <div class="hint">Ukuran di atas dipakai untuk kwitansi iuran. Kwitansi transaksi memiliki pengaturan margin sendiri
              (<code>kw_trx_*</code>) dan dapat diubah lewat tautan <b>Ukuran Kertas</b> pada setiap kwitansi.</div>
          </div>
          <div class="card mb-3">
            <div class="card-head"><div><h3>Tempat pada Tanggal Cetak</h3>
              <div class="sub">Dipakai di semua dokumen: kwitansi, bukti piutang, laporan, berita acara, dll.</div></div>
              ${ui.badge('semua dokumen', 'orange', 'plain')}</div>
            <div class="row2">
              <div class="field"><label>Teks Tempat</label>
                <input type="text" name="print_tempat" value="${esc(c.settings.print_tempat || printcfg.TEMPAT_DEFAULT)}"
                  placeholder="${esc(printcfg.TEMPAT_DEFAULT)}" ${ro ? 'readonly' : ''}>
                <div class="hint">Contoh hasil cetak: <b>${esc(c.settings.print_tempat || printcfg.TEMPAT_DEFAULT)}, ${esc(tglID(lib.todayISO()))}</b>.
                  Kosongkan untuk kembali ke <b>${esc(printcfg.TEMPAT_DEFAULT)}</b>.</div></div>
              <div class="field"><label>Baris Tanggal Kwitansi Pengeluaran</label>
                <div class="catatan-locked-nama" style="min-height:38px">${esc(printcfg.fill(printcfg.labels(dbm, 'kwitansi_trx').nilai_dari_keluar || 'Bendahara {sekolah}', { sekolah: c.settings.sekolah_nama || 'Sekolah' }))}</div>
                <div class="hint">Contoh isi baris <b>${esc(printcfg.labels(dbm, 'kwitansi_trx').dari_keluar || 'Telah diterima dari')}</b> pada kwitansi pengeluaran
                  (ubah teksnya di kartu <b>Kwitansi Transaksi</b> di bawah).</div></div>
            </div>
          </div>
          ${cards}
          <div class="form-actions">${ro ? '' : `<button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan Desain</button>`}</div>
        </form>
      </div>`;
    page(req, res, { title: 'Desain Templat Cetak', sub: 'Redaksional dokumen & orientasi kertas default', active: 'desain_cetak', content });
  });

  post('/desain-cetak', (req, res) => {
    guard(req, res, 'sekolah', 'edit');
    printcfg.saveFromBody(dbm, req.body);
    // kop surat & ukuran kuitansi (dipindah dari menu Identitas Sekolah)
    if (req.body.kop_baris !== undefined) dbm.setSetting('kop_baris', String(req.body.kop_baris).replace(/\r/g, ''));
    for (const k of ['kop_font', 'kop_font_besar', 'kwitansi_w_mm', 'kwitansi_h_mm', 'kwitansi_margin_mm']) {
      if (req.body[k] === undefined) continue;
      const v = Number(String(req.body[k]).replace(',', '.'));
      if (Number.isFinite(v) && v > 0) dbm.setSetting(k, v);
    }
    dbm.logAudit(req.user, 'EDIT', 'sekolah', 'Memperbarui Pusat Desain & Orientasi Cetak');
    res.redirect(req.BASE + '/desain-cetak?ok=' + encodeURIComponent('Pengaturan desain templat cetak disimpan.'));
  });

  /* ==================================================================
     2. RESET DATA PER TAHUN PELAJARAN
     ================================================================== */
  function taCounts(taId) {
    const bkuIds = db.prepare('SELECT id FROM bku WHERE tahun_ajaran_id=?').all(taId).map(r => Number(r.id));
    const q = bkuIds.length ? bkuIds.map(() => '?').join(',') : '0';
    const c1 = db.prepare(`SELECT COUNT(*) c FROM transaksi WHERE bku_id IN (${q})`).get(...(bkuIds.length ? bkuIds : [])).c;
    const c2 = db.prepare('SELECT COUNT(*) c FROM iuran_tagihan WHERE tahun_ajaran_id=?').get(taId).c;
    const c3 = db.prepare('SELECT COUNT(*) c FROM iuran_bayar WHERE tagihan_id IN (SELECT id FROM iuran_tagihan WHERE tahun_ajaran_id=?)').get(taId).c;
    const ta = dbm.tahunById(taId);
    const r = dbm.taRange(ta);
    const p1 = String(r.from).slice(0, 7), p2 = String(r.to).slice(0, 7);
    const c4 = db.prepare('SELECT COUNT(*) c FROM payroll WHERE substr(periode,1,7) BETWEEN ? AND ?').get(p1, p2).c;
    const c5 = db.prepare('SELECT COUNT(*) c FROM ekskul_honor WHERE substr(periode,1,7) BETWEEN ? AND ?').get(p1, p2).c;
    return { transaksi: c1, iuranTagihan: c2, iuranBayar: c3, payroll: c4, ekskul: c5 };
  }

  get('/reset-tahun', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    if (!isSuper(req)) {
      return page(req, res, {
        title: 'Reset Data Tahun Pelajaran', sub: 'Akses khusus Super Admin', active: 'reset_tahun',
        content: `<div class="card"><div class="alert err">${ui.icon('lock')}<div>
          <b>Akses ditolak.</b> Reset data tahun pelajaran hanya dapat dilakukan oleh akun <b>Super Admin</b>.
          Hubungi Super Admin sekolah bila Anda memerlukan pembersihan data.</div></div>
          <div class="center"><a class="btn" href="${c.base}/">Kembali ke Dashboard</a></div></div>`
      });
    }
    const list = dbm.allTahun().map(t => ({ ...t, n: taCounts(t.id) }));
    const rows = list.map(t => `<tr>
        <td class="t-strong">${esc(t.nama)}</td>
        <td class="nowrap">${esc(tglID(t.tanggal_mulai))} — ${esc(tglID(t.tanggal_selesai))}</td>
        <td class="num">${t.n.transaksi}</td><td class="num">${t.n.iuranTagihan}</td>
        <td class="num">${t.n.payroll}</td><td class="num">${t.n.ekskul}</td>
        <td>${t.aktif ? ui.badge('Aktif', 'green') : ui.badge('—', 'gray')}</td>
        <td class="right"><button class="btn btn-sm btn-danger" form="fReset${t.id}">${ui.icon('trash')}Reset Data TA</button></td>
      </tr>
      ${ui.modal('mReset' + t.id, {
      title: 'Reset Data Tahun Pelajaran ' + t.nama,
      body: `<form method="post" action="${c.base}/reset-tahun" id="fReset${t.id}"
          data-confirm="Hapus SEMUA data transaksi & riwayat pada TA ${esc(t.nama)}? Tindakan ini tidak dapat dibatalkan.">
          <input type="hidden" name="ta_id" value="${t.id}">
          <div class="alert err">${ui.icon('alert')}<div><b>Perhatian.</b> Seluruh riwayat berikut pada TA <b>${esc(t.nama)}</b> akan dihapus permanen:
            <ul style="margin:6px 0 0 18px">
              <li>Transaksi keuangan & pos BKU (${t.n.transaksi} baris) — saldo BKU TA ini kembali 0</li>
              <li>Penetapan & pembayaran iuran (${t.n.iuranTagihan} tagihan, ${t.n.iuranBayar} pembayaran)</li>
              <li>Leger honor / payroll (${t.n.payroll} baris), honor ekskul (${t.n.ekskul} baris)</li>
              <li>Piutang pegawai/sertifikasi/lainnya, beasiswa, mutasi kas, penutupan BKU bulanan, SPP</li>
            </ul>
            <b>Master data siswa, kelas, pegawai, CoA, BKU, dan tahun pelajaran lain TIDAK dihapus.</b></div></div>
          <div class="field"><label>Kata sandi Anda (konfirmasi keamanan)</label>
            <input type="password" name="password" required autocomplete="current-password" placeholder="Kata sandi akun Super Admin"></div>
          <div class="field"><label>Ketik <code>RESET</code> untuk melanjutkan</label>
            <input name="konfirmasi" required placeholder="RESET" autocomplete="off"></div>
          <label class="check"><input type="checkbox" name="cadangan" value="1" checked> Buat cadangan JSON otomatis sebelum menghapus (maks. 3 berkas)</label>
        </form>`,
      footer: `<button class="btn" data-close="mReset${t.id}">Batal</button>
          <button class="btn btn-danger" form="fReset${t.id}">${ui.icon('trash')}Reset Semua Data TA Ini</button>`
    })}
    `).join('');
    const content = `<div class="card mb-3">
        <div class="card-head"><div><h3>Reset Data Spesifik per Tahun Pelajaran</h3>
          <div class="sub">Menghapus riwayat transaksi &amp; leger honor satu tahun pelajaran tanpa menyentuh master data dan TA lain</div></div>
          ${ui.badge('Super Admin', 'orange')}</div>
        <div class="alert warn">${ui.icon('alert')}<div>Fitur ini <b>hanya untuk Super Admin</b> dan memerlukan kata sandi akun Anda.
          Gunakan saat menyiapkan tahun ajaran baru atau membersihkan data uji. Master siswa/pegawai tidak terhapus.</div></div>
        <div class="table-wrap"><table><thead><tr><th>Tahun Pelajaran</th><th>Periode</th><th class="num">Transaksi</th>
          <th class="num">Tagihan Iuran</th><th class="num">Payroll</th><th class="num">Ekskul</th><th>Status</th><th class="right">Aksi</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>`;
    page(req, res, { title: 'Reset Data Tahun Pelajaran', sub: 'Hapus riwayat satu TA secara aman', active: 'reset_tahun', content });
  });

  post('/reset-tahun', (req, res) => {
    if (!isSuper(req)) return res.redirect(req.BASE + '/reset-tahun?err=' + encodeURIComponent('Hanya Super Admin yang boleh melakukan reset data.'));
    const taId = Number(req.body.ta_id || 0);
    const ta = dbm.tahunById(taId);
    if (!ta) return res.redirect(req.BASE + '/reset-tahun?err=' + encodeURIComponent('Tahun pelajaran tidak ditemukan.'));
    if (String(req.body.konfirmasi || '').trim().toUpperCase() !== 'RESET') {
      return res.redirect(req.BASE + '/reset-tahun?err=' + encodeURIComponent('Ketik "RESET" pada kolom konfirmasi.'));
    }
    const u = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
    if (!u || !lib.verifyPassword(String(req.body.password || ''), u.password)) {
      dbm.logAudit(req.user, 'RESET DITOLAK', 'sistem', `Percobaan reset data TA ${ta.nama} gagal: kata sandi salah`);
      return res.redirect(req.BASE + '/reset-tahun?err=' + encodeURIComponent('Kata sandi salah. Reset dibatalkan.'));
    }
    const stats = dbm.resetTaData(taId, req.user, { cadangan: String(req.body.cadangan || '') === '1' });
    dbm.logAudit(req.user, 'RESET TA', 'sistem', `Reset seluruh data TA ${ta.nama}: ` +
      Object.entries(stats.tables).map(([t, n]) => `${t}: ${n}`).join(', '));
    const total = Object.values(stats.tables).reduce((a, b) => a + Number(b || 0), 0);
    res.redirect(req.BASE + '/reset-tahun?ok=' + encodeURIComponent(`Reset selesai. ${total} baris data pada TA ${ta.nama} dihapus; master data & TA lain tidak berubah.`));
  });

  /* ==================================================================
     3. TINJAU & AUDIT TRANSAKSI TERSEMBUNYI (ORPHAN / GHOST)
     ================================================================== */
  const ORPHAN_CHECKS = [
    {
      key: 'trx_no_bku', tabel: 'transaksi', label: 'Transaksi tanpa buku kas (BKU)',
      why: 'Transaksi mengambang: tidak muncul di halaman BKU mana pun tetapi tidak dihitung pada saldo.',
      sql: `SELECT t.id, t.tanggal, t.no_bukti, t.uraian, t.jenis, t.nominal FROM transaksi t
        LEFT JOIN bku b ON b.id=t.bku_id WHERE b.id IS NULL`
    },
    {
      key: 'trx_no_coa', tabel: 'transaksi', label: 'Transaksi dengan kode rekening tidak dikenal',
      why: 'Rekening (CoA) sudah dihapus — transaksi tidak muncul pada laporan realisasi.',
      sql: `SELECT t.id, t.tanggal, t.no_bukti, t.uraian, t.jenis, t.nominal FROM transaksi t
        LEFT JOIN coa c ON c.id=t.coa_id WHERE t.coa_id IS NOT NULL AND c.id IS NULL`
    },
    {
      key: 'trx_void_hilang', tabel: 'transaksi', label: 'Jurnal pembalik tanpa transaksi asal',
      why: 'Transaksi void yang transaksi asalnya sudah dihapus (sisa counter saldo).',
      sql: `SELECT t.id, t.tanggal, t.no_bukti, t.uraian, t.jenis, t.nominal FROM transaksi t
        LEFT JOIN transaksi asal ON asal.id=t.void_of WHERE t.void_of IS NOT NULL AND asal.id IS NULL`
    },
    {
      key: 'iuran_bayar_yatim', tabel: 'iuran_bayar', label: 'Pembayaran iuran tanpa tagihan',
      why: 'Nominal pembayaran tersembunyi yang tidak tampil di Data Iuran.',
      sql: `SELECT b.id, b.tanggal, b.jumlah AS nominal, COALESCE(b.keterangan,'') uraian, b.status
        FROM iuran_bayar b LEFT JOIN iuran_tagihan t ON t.id=b.tagihan_id WHERE t.id IS NULL`
    },
    {
      key: 'iuran_bayar_trx_hilang', tabel: 'iuran_bayar', label: 'Pembayaran iuran menunjuk transaksi BKU yang hilang',
      why: 'Pembayaran terkunci pada transaksi yang sudah tidak ada (tidak bisa diposting ulang).',
      sql: `SELECT b.id, b.tanggal, b.jumlah AS nominal, COALESCE(b.keterangan,'') uraian, b.status
        FROM iuran_bayar b LEFT JOIN transaksi t ON t.id=b.transaksi_id
        WHERE b.transaksi_id IS NOT NULL AND t.id IS NULL`
    },
    {
      key: 'iuran_tagihan_yatim', tabel: 'iuran_tagihan', label: 'Tagihan iuran tanpa siswa / grup',
      why: 'Tagihan hantu: menambah counter piutang tetapi tidak muncul di daftar siswa mana pun.',
      sql: `SELECT t.id, t.created_at tanggal, t.nominal, ('Grup #' || t.grup_id || ' · Siswa #' || t.siswa_id) uraian, ''
        FROM iuran_tagihan t LEFT JOIN iuran_grup g ON g.id=t.grup_id LEFT JOIN siswa s ON s.id=t.siswa_id
        WHERE g.id IS NULL OR s.id IS NULL`
    },
    {
      key: 'iuran_tagihan_beda_ta', tabel: 'iuran_tagihan', label: 'Tagihan iuran beda tahun pelajaran dengan grupnya',
      why: 'Tagihan nyangkut di TA lain sehingga muncul/tersembunyi tidak konsisten.',
      sql: `SELECT t.id, t.created_at tanggal, t.nominal, ('Grup ' || g.nama || ' (TA ' || COALESCE(t.tahun_ajaran_id,'?') || ')') uraian, ''
        FROM iuran_tagihan t JOIN iuran_grup g ON g.id=t.grup_id
        WHERE COALESCE(t.tahun_ajaran_id,0) <> COALESCE(g.tahun_ajaran_id,0)`
    },
    {
      key: 'piutang_bayar_yatim', tabel: 'piutang_bayar', label: 'Cicilan piutang pegawai tanpa induk piutang',
      why: 'Cicilan tersembunyi yang tidak tampil di halaman piutang.',
      sql: `SELECT b.id, b.tanggal, b.nominal, COALESCE(b.keterangan,'') uraian, '' FROM piutang_bayar b
        LEFT JOIN piutang p ON p.id=b.piutang_id WHERE p.id IS NULL`
    },
    {
      key: 'piutang_lain_bayar_yatim', tabel: 'piutang_lain_bayar', label: 'Cicilan piutang sertifikasi tanpa induk',
      why: 'Cicilan tersembunyi yang memengaruhi perhitungan sisa sertifikasi.',
      sql: `SELECT b.id, b.tanggal, b.nominal, COALESCE(b.keterangan,'') uraian, '' FROM piutang_lain_bayar b
        LEFT JOIN piutang_lain p ON p.id=b.piutang_id WHERE p.id IS NULL`
    },
    {
      key: 'piutang_lainnya_bayar_yatim', tabel: 'piutang_lainnya_bayar', label: 'Cicilan piutang lainnya tanpa induk',
      why: 'Cicilan tersembunyi yang memengaruhi total aset piutang lainnya.',
      sql: `SELECT b.id, b.tanggal, b.nominal, COALESCE(b.keterangan,'') uraian, '' FROM piutang_lainnya_bayar b
        LEFT JOIN piutang_lainnya p ON p.id=b.piutang_id WHERE p.id IS NULL`
    },
    {
      key: 'piutang_ghost_ta', tabel: 'piutang', label: 'Piutang pegawai menempel TA yang sudah dihapus',
      why: 'Tidak muncul di laporan TA mana pun, tetapi ikut total piutang global.',
      sql: `SELECT p.id, p.tanggal_utang tanggal, p.nominal, (p.nama_pegawai || ' — TA ' || p.tahun_ajaran_id) uraian, ''
        FROM piutang p WHERE p.tahun_ajaran_id IS NOT NULL AND p.tahun_ajaran_id NOT IN (SELECT id FROM tahun_ajaran)`
    },
    {
      key: 'piutang_lain_ghost_ta', tabel: 'piutang_lain', label: 'Piutang sertifikasi menempel TA yang sudah dihapus',
      why: 'Tidak muncul di laporan TA mana pun, tetapi ikut total piutang global.',
      sql: `SELECT p.id, p.tanggal, p.nominal, (p.nama || ' — TA ' || p.tahun_ajaran_id) uraian, ''
        FROM piutang_lain p WHERE p.tahun_ajaran_id IS NOT NULL AND p.tahun_ajaran_id NOT IN (SELECT id FROM tahun_ajaran)`
    },
    {
      key: 'piutang_lainnya_ghost_ta', tabel: 'piutang_lainnya', label: 'Piutang lainnya menempel TA yang sudah dihapus',
      why: 'Tidak muncul di laporan TA mana pun, tetapi ikut total aset piutang.',
      sql: `SELECT p.id, p.tanggal, p.nominal, (p.nama || ' — TA ' || p.tahun_ajaran_id) uraian, ''
        FROM piutang_lainnya p WHERE p.tahun_ajaran_id IS NOT NULL AND p.tahun_ajaran_id NOT IN (SELECT id FROM tahun_ajaran)`
    },
    {
      key: 'payroll_yatim', tabel: 'payroll', label: 'Leger honor tanpa pegawai',
      why: 'Baris leger tersembunyi (tidak muncul di draf honor) tetapi ikut total.',
      sql: `SELECT p.id, p.periode tanggal, p.diterima nominal, p.nama uraian, '' FROM payroll p
        LEFT JOIN pegawai g ON g.id=p.pegawai_id WHERE g.id IS NULL`
    },
    {
      key: 'payroll_post_yatim', tabel: 'payroll_post', label: 'Posting payroll tanpa transaksi BKU',
      why: 'Periode honor dianggap terkunci padahal transaksinya sudah hilang.',
      sql: `SELECT p.id, p.periode tanggal, 0 nominal, ('Posting periode ' || p.periode) uraian, '' FROM payroll_post p
        LEFT JOIN transaksi t ON t.id=p.transaksi_id WHERE t.id IS NULL`
    },
    {
      key: 'ekskul_yatim', tabel: 'ekskul_honor', label: 'Honor ekskul menunjuk transaksi hilang',
      why: 'Honor dianggap sudah diposting padahal transaksi BKU-nya tidak ada.',
      sql: `SELECT e.id, e.periode tanggal, e.kehadiran*harga_satuan nominal, (e.nama_pembina || ' — ' || COALESCE(e.jenis,'')) uraian, e.status
        FROM ekskul_honor e LEFT JOIN transaksi t ON t.id=e.transaksi_id
        WHERE e.transaksi_id IS NOT NULL AND t.id IS NULL`
    },
    {
      key: 'aset_mutasi_yatim', tabel: 'pinjaman_mutasi', label: 'Mutasi aset tanpa akun aset',
      why: 'Mutasi tersembunyi yang memengaruhi saldo pinjaman/aset.',
      sql: `SELECT m.id, m.tanggal, m.nominal, COALESCE(m.keterangan,'') uraian, m.jenis FROM pinjaman_mutasi m
        LEFT JOIN aset a ON a.id=m.aset_id WHERE a.id IS NULL`
    },
    {
      key: 'bku_periode_yatim', tabel: 'bku_periode', label: 'Penutupan BKU bulanan tanpa BKU',
      why: 'Kunci periode hantu: transaksi lama bisa ikut terkunci tanpa buku kasnya.',
      sql: `SELECT p.id, p.periode tanggal, p.saldo_akhir nominal, ('Periode ' || p.periode || ' · BKU #' || p.bku_id) uraian, p.status
        FROM bku_periode p LEFT JOIN bku b ON b.id=p.bku_id WHERE b.id IS NULL`
    },
    {
      key: 'beasiswa_ta_ghost', tabel: 'beasiswa', label: 'Beasiswa menempel TA yang sudah dihapus',
      why: 'Potongan beasiswa tetap mengurangi tunggakan global walau TAnya tidak ada.',
      sql: `SELECT b.id, b.created_at tanggal, b.nominal, (b.nama || ' — TA ' || b.tahun_ajaran_id) uraian, ''
        FROM beasiswa b WHERE b.tahun_ajaran_id IS NOT NULL AND b.tahun_ajaran_id NOT IN (SELECT id FROM tahun_ajaran)`
    }
  ];
  const DELETE_TABLES = new Set(ORPHAN_CHECKS.map(c => c.tabel));

  function scan() {
    const out = [];
    for (const chk of ORPHAN_CHECKS) {
      let rows = [];
      try { rows = db.prepare(chk.sql).all(); } catch (e) { rows = []; }
      if (rows.length) out.push({ ...chk, rows });
    }
    return out;
  }

  get('/audit-orphan', (req, res) => {
    guard(req, res, 'sekolah', 'view');
    const c = ctx(req);
    const groups = scan();
    const total = groups.reduce((a, g) => a + g.rows.length, 0);
    const body = groups.map((g, gi) => {
      const sum = g.rows.reduce((a, r) => a + Math.abs(Number(r.nominal) || 0), 0);
      const id = 'or' + gi;
      return `<div class="card mb-3">
        <div class="card-head">
          <div><h3>${esc(g.label)}</h3><div class="sub">Tabel <code>${esc(g.tabel)}</code> · ${g.rows.length} baris · nominal ${rupiah(sum)}</div></div>
          <div class="toolbar">
            ${ui.badge(g.rows.length + ' baris', 'amber')}
            <form method="post" action="${c.base}/audit-orphan/hapus" style="display:inline"
              data-confirm="Hapus permanen SEMUA ${g.rows.length} baris pada kategori ini?">
              <input type="hidden" name="kode" value="${esc(g.key)}">
              <input type="hidden" name="semua" value="1">
              <button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Semua Kategori Ini</button>
            </form>
          </div>
        </div>
        <div class="alert warn">${ui.icon('alert')}<div>${esc(g.why)}</div></div>
        <div class="table-scroll short"><table><thead><tr>
          <th style="width:70px">ID</th><th style="width:110px">Tanggal</th><th>Uraian</th>
          <th class="num" style="width:130px">Nominal</th><th style="width:110px">Status</th><th class="right" style="width:150px">Aksi</th>
        </tr></thead><tbody>
        ${g.rows.map(r => `<tr>
          <td class="mono">${esc(String(r.id))}</td>
          <td class="nowrap">${esc(r.tanggal ? tglID(String(r.tanggal).slice(0, 10)) : '-')}</td>
          <td>${esc(r.uraian || '-')}</td>
          <td class="num">${Number(r.nominal) ? rupiah(r.nominal) : '—'}</td>
          <td>${esc(r.status || '-')}</td>
          <td class="right nowrap">
            <form method="post" action="${c.base}/audit-orphan/hapus" style="display:inline"
              data-confirm="Hapus permanen baris ${esc(g.tabel)} #${esc(String(r.id))}?">
              <input type="hidden" name="tabel" value="${esc(g.tabel)}">
              <input type="hidden" name="kode" value="${esc(g.key)}">
              <input type="hidden" name="id" value="${esc(String(r.id))}">
              <button class="btn btn-sm btn-danger">${ui.icon('trash')}Hapus Permanen</button>
            </form>
          </td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    }).join('');
    const content = `<div class="card mb-3">
        <div class="card-head"><div><h3>Tinjau &amp; Audit Transaksi Tersembunyi</h3>
          <div class="sub">Pemindaian otomatis database untuk transaksi orphan/ghost yang tidak tampil di modul mana pun</div></div>
          <div class="toolbar">${ui.badge(total ? total + ' temuan' : 'Bersih', total ? 'amber' : 'green')}
            <a class="btn btn-sm" href="${c.base}/audit-orphan">${ui.icon('refresh')}Pindai Ulang</a></div></div>
        <div class="alert ${total ? 'warn' : 'ok'}">${ui.icon(total ? 'alert' : 'check')}<div>
          ${total
        ? `<b>${total} baris data tersembunyi ditemukan.</b> Baris seperti ini dapat mengubah saldo/counter tanpa muncul di UI.
               Tinjau lalu hapus permanen agar perhitungan kembali bersih.`
        : '<b>Tidak ada data orphan.</b> Seluruh transaksi &amp; pembayaran tersambung dengan benar ke modulnya.'}
        </div></div>
        <p class="help">Pemindaian mencakup ${ORPHAN_CHECKS.length} pola: transaksi tanpa BKU/CoA, pembayaran tanpa tagihan,
          tagihan/piutang menempel tahun pelajaran terhapus, leger honor tanpa pegawai, posting tanpa transaksi, dan lainnya.
          Penghapusan bersifat <b>permanen</b> (hard delete) dan dicatat di Audit Log.</p>
      </div>
      ${body}`;
    page(req, res, { title: 'Audit Data Tersembunyi', sub: 'Orphan / ghost record & hard delete', active: 'audit_orphan', content });
  });

  post('/audit-orphan/hapus', (req, res) => {
    if (!isSuper(req)) return res.redirect(req.BASE + '/audit-orphan?err=' + encodeURIComponent('Hanya Super Admin yang boleh menghapus data tersembunyi.'));
    const kode = String(req.body.kode || '');
    const chk = ORPHAN_CHECKS.find(c => c.key === kode);
    let n = 0;
    if (req.body.semua && chk) {
      const rows = (() => { try { return db.prepare(chk.sql).all(); } catch (e) { return []; } })();
      const ids = rows.map(r => Number(r.id)).filter(Boolean);
      if (ids.length) {
        n = db.prepare(`DELETE FROM ${chk.tabel} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes;
      }
      dbm.logAudit(req.user, 'HAPUS PERMANEN', 'sistem', `Audit data tersembunyi: hapus ${n} baris pada ${chk.label} (${chk.tabel})`);
    } else {
      const tabel = String(req.body.tabel || '');
      const id = Number(req.body.id || 0);
      if (!DELETE_TABLES.has(tabel) || !id) return res.redirect(req.BASE + '/audit-orphan?err=' + encodeURIComponent('Data yang akan dihapus tidak valid.'));
      n = db.prepare(`DELETE FROM ${tabel} WHERE id=?`).run(id).changes;
      dbm.logAudit(req.user, 'HAPUS PERMANEN', 'sistem', `Audit data tersembunyi: hapus ${tabel} #${id}`);
    }
    try { dbm.piutangSyncStatus(); } catch (e) { }
    res.redirect(req.BASE + '/audit-orphan?' + (n ? 'ok=' + encodeURIComponent(`${n} baris data tersembunyi dihapus permanen.`) : 'err=' + encodeURIComponent('Tidak ada baris yang terhapus (mungkin sudah bersih).')));
  });
};
