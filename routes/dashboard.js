'use strict';

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can }) => {
  const { db } = dbm;
  const { rupiah, esc, tglID, rpShort } = lib;

  get('/', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const c = ctx(req);
    const ta = c.ta;
    const taId = c.taId;
    const g = dbm.globalTotals(taId);
    const kas = dbm.asetKas(taId);
    const piutangPeg = dbm.piutangPegawaiTotal(taId);
    const sppTampil = dbm.sppTampil();
    const tunggakanSpp = sppTampil ? dbm.sppTunggakan(taId) : 0;
    const piutangTotal = piutangPeg + tunggakanSpp;
    const sertifikasi = dbm.piutangLainNeraca(taId);
    const piutangLainnya = dbm.piutangLainnyaAset(taId);
    const asetNonKas = dbm.asetNonKasTotal(taId);
    const totalAsetRiil = kas.bank + kas.tunai + piutangPeg + tunggakanSpp + sertifikasi + piutangLainnya + asetNonKas;

    // anggaran
    const paguRow = ta ? db.prepare("SELECT COALESCE(SUM(a.pagu),0) p FROM anggaran a WHERE a.tahun_ajaran_id=?").get(ta.id) : { p: 0 };
    const realRow = ta ? db.prepare(`SELECT COALESCE(SUM(t.nominal),0) r FROM transaksi t
        JOIN bku b ON b.id=t.bku_id JOIN coa c ON c.id=t.coa_id
        WHERE t.status='posted' AND t.jenis='pengeluaran' AND c.kategori='pengeluaran' AND b.tahun_ajaran_id=?`).get(ta.id) : { r: 0 };
    const pagu = paguRow.p, realisasi = realRow.r;
    const serapanPct = pagu > 0 ? (realisasi / pagu) * 100 : 0;

    const topAnggaran = ta ? db.prepare(`SELECT c.kode, c.nama, a.pagu,
        COALESCE((SELECT SUM(t.nominal) FROM transaksi t JOIN bku b ON b.id=t.bku_id
          WHERE t.coa_id=c.id AND t.status='posted' AND t.jenis='pengeluaran' AND b.tahun_ajaran_id=?),0) real
        FROM anggaran a JOIN coa c ON c.id=a.coa_id
        WHERE a.tahun_ajaran_id=? AND a.pagu>0 ORDER BY a.pagu DESC LIMIT 5`).all(ta.id, ta.id) : [];

    const bkuss = dbm.allBku(ta ? ta.id : null);
    const aktifBku = bkuss.filter(b => b.status === 'aktif');
    const tutupBku = bkuss.filter(b => b.status !== 'aktif');
    const pending = db.prepare(`SELECT t.*, b.nama bku_nama, u.nama pembuat FROM transaksi t
      JOIN bku b ON b.id=t.bku_id LEFT JOIN users u ON u.id=t.created_by
      WHERE t.status='pending' AND b.tahun_ajaran_id=? ORDER BY t.tanggal DESC, t.id DESC LIMIT 6`).all(taId || 0);
    const recent = db.prepare(`SELECT t.*, b.nama bku_nama, c.nama coa_nama FROM transaksi t
      JOIN bku b ON b.id=t.bku_id LEFT JOIN coa c ON c.id=t.coa_id
      WHERE t.status='posted' AND b.tahun_ajaran_id=? ORDER BY t.tanggal DESC, t.id DESC LIMIT 8`).all(taId || 0);
    const hasData = taId ? db.prepare(`SELECT COUNT(*) c FROM transaksi t JOIN bku b ON b.id=t.bku_id WHERE b.tahun_ajaran_id=?`).get(taId).c : 0;
    const curPeriode = dbm.currentPeriode();
    const lastPeriode = dbm.prevPeriode(curPeriode);
    const belumTutup = dbm.unclosedPeriods(ta ? ta.id : null);
    const belumBulanLalu = belumTutup.filter(x => x.periode === lastPeriode);
    const totalBukuBelum = belumTutup.reduce((s2, x) => s2 + dbm.periodePosisi(x.bku_id, x.periode).saldoBuku, 0);
    const store = dbm.storageInfo();
    const approvalAlert = (req.sessionRow && req.sessionRow.alert_pending > 0 && c.can('transaksi', 'approve'))
      ? Number(req.sessionRow.alert_pending) : 0;

    /* ---------- data grafik multi-tipe ---------- */
    const finBku = ta ? db.prepare(`SELECT b.id, b.nama, b.saldo_awal,
        COALESCE(SUM(CASE WHEN t.status='posted' AND t.jenis='pemasukan' THEN t.nominal ELSE 0 END),0) masuk,
        COALESCE(SUM(CASE WHEN t.status='posted' AND t.jenis='pengeluaran' THEN t.nominal ELSE 0 END),0) keluar
      FROM bku b LEFT JOIN transaksi t ON t.bku_id=b.id
      WHERE b.tahun_ajaran_id=? AND COALESCE(b.auto_mode,0)=0
      GROUP BY b.id ORDER BY b.urutan, b.id`).all(ta.id)
      .map(b => ({ nama: b.nama, masuk: Number(b.masuk), keluar: Number(b.keluar), saldo: Number(b.saldo_awal) + Number(b.masuk) - Number(b.keluar) })) : [];
    // tren bulanan pada tahun ajaran (12 bulan) untuk line chart
    const finBulan = [];
    if (ta) {
      const start = String(ta.tanggal_mulai || '').slice(0, 7) || `${new Date().getFullYear()}-01`;
      const [sy, sm] = start.split('-').map(Number);
      const saldoAwalTotal = db.prepare('SELECT COALESCE(SUM(saldo_awal),0) s FROM bku WHERE tahun_ajaran_id=? AND COALESCE(auto_mode,0)=0').get(ta.id).s;
      let run = Number(saldoAwalTotal || 0);
      for (let i = 0; i < 12; i++) {
        const d = new Date(Date.UTC(sy, sm - 1 + i, 1));
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const t = db.prepare(`SELECT
            COALESCE(SUM(CASE WHEN t.jenis='pemasukan' THEN t.nominal ELSE 0 END),0) masuk,
            COALESCE(SUM(CASE WHEN t.jenis='pengeluaran' THEN t.nominal ELSE 0 END),0) keluar
          FROM transaksi t JOIN bku b ON b.id=t.bku_id
          WHERE t.status='posted' AND substr(t.tanggal,1,7)=? AND b.tahun_ajaran_id=? AND COALESCE(b.auto_mode,0)=0`).get(ym, ta.id);
        run += Number(t.masuk) - Number(t.keluar);
        finBulan.push({
          label: `${lib.BULAN[d.getUTCMonth()].slice(0, 3)} ${String(d.getUTCFullYear()).slice(2)}`,
          masuk: Number(t.masuk), keluar: Number(t.keluar), saldo: run
        });
      }
    }
    const finData = { bku: finBku, bulan: finBulan };
    // tren penerimaan SPP per bulan (line chart khusus)
    const sppTrend = ta ? dbm.sppSeries(ta.id) : [];
    const sppTrendTotal = sppTrend.reduce((a, r) => a + r.diterima, 0);
    const sppTrendAda = sppTrend.some(r => r.diterima > 0 || r.ditagihkan > 0);
    // sisa ditampilkan dalam satuan yang sama dengan kuota agar ringkas (mis. "1,0 GB")
    const sisaTxt = store.quota >= 1024 ** 3
      ? (store.sisa / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB'
      : lib.fileSize(store.sisa);

    // notifikasi antrean posting: iuran hari kemarin/belum diposting + honor ekskul tertunda
    const yr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const iuranPendingRows = dbm.iuranBayarRows({ taId: ta ? ta.id : null, status: 'pending' });
    const iuranLate = iuranPendingRows.filter(b => String(b.tanggal) <= yr);
    const iuranLateGroups = new Set(iuranLate.map(b => (b.grup_id || 0) + '|' + String(b.tanggal).slice(0, 10))).size;
    const ekskulPending = dbm.ekskulPending();
    const queueAlerts = [];
    if (iuranLateGroups) queueAlerts.push(`<a href="${c.base}/iuran/antrean" style="color:inherit"><b>${iuranLateGroups} kelompok</b> penerimaan Grup Iuran belum di-posting ke BKU (${rupiah(iuranLate.reduce((a, b) => a + Number(b.dibayar || 0), 0))} dari ${iuranLate.length} transaksi).</a>`);
    if (iuranPendingRows.length && !iuranLateGroups) queueAlerts.push(`<a href="${c.base}/iuran/antrean" style="color:inherit"><b>${iuranPendingRows.length} penerimaan iuran</b> hari ini masih menunggu posting ke BKU.</a>`);
    if (ekskulPending.length) queueAlerts.push(`<a href="${c.base}/ekskul/antrean" style="color:inherit"><b>${ekskulPending.length} draf honor pembina ekstrakurikuler</b> belum terposting ke BKU.</a>`);

    const kpi = (cls, ico, lbl, val, meta) => `<div class="kpi ${cls}">
      <div class="ico">${ui.icon(ico)}</div>
      <div class="lbl">${esc(lbl)}</div><div class="val">${esc(val)}</div><div class="meta">${meta}</div></div>`;

    /* ---------- pesan / catatan orang tua dari portal publik ---------- */
    const pesanBaru = dbm.portalPesanCount();
    const pesanList = dbm.portalPesanList({ limit: 6 });
    const pesanCard = `<div class="card mb-3" id="pesanOrangTua" style="${pesanBaru ? 'border-color:#F7DFB5;background:#FFFDF7' : ''}">
      <div class="card-head"><div><h3>Catatan Orang Tua ${pesanBaru ? `<span class="badge amber plain">${pesanBaru} baru</span>` : ''}</h3>
        <div class="sub">Catatan dari portal publik: tagihan siswa, piutang pegawai &amp; slip gaji pegawai</div></div>
        <div class="toolbar"><a class="btn btn-sm" href="${c.base}/catatan-orangtua">${ui.icon('inbox')}Rekap Catatan Orang Tua</a></div></div>
      ${pesanList.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Siswa</th><th>Catatan</th><th>Kontak</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${pesanList.map(x => `<tr>
          <td class="nowrap t-sub">${esc(String(x.created_at || '').slice(0, 16))}</td>
          <td class="t-strong">${esc(x.nama || '-')}<div class="t-sub">${x.sumber === 'slip-pegawai' ? 'Slip Pegawai' : x.sumber === 'piutang-pegawai' ? 'Piutang Pegawai' : 'Tagihan Siswa'}</div></td>
          <td style="max-width:420px">${esc(x.pesan)}</td>
          <td class="t-sub">${esc(x.kontak || '-')}</td>
          <td>${x.status === 'selesai' ? ui.badge('Selesai Ditindaklanjuti', 'green') : ui.badge('Baru', 'amber')}</td>
          <td class="right nowrap">${x.status === 'selesai'
        ? `<span class="t-sub">${esc(x.selesai_by || '')}</span>`
        : `<form method="post" action="${c.base}/pesan-orangtua/selesai" style="display:inline"><input type="hidden" name="id" value="${x.id}"><input type="hidden" name="back" value="/"><button class="btn btn-sm btn-green">${ui.icon('check')}Tandai Selesai</button></form>`}</td>
        </tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada catatan orang tua', 'Catatan dari portal cek tagihan publik akan muncul di sini otomatis.')}
    </div>`;

    /* ---------- catatan pegawai kepada bendahara ---------- */
    const pengelolaCatatan = c.can('catatan', 'edit');
    const catatanBuka = pengelolaCatatan ? dbm.catatanCount(taId) : 0;
    const catatanList = dbm.catatanList({ taId, userId: pengelolaCatatan ? null : req.user.id, limit: 4 });
    const catatanCard = (catatanList.length || catatanBuka) ? `<div class="card mb-3" id="catatanPegawai" style="${catatanBuka ? 'border-color:#F7DFB5;background:#FFFDF7' : ''}">
      <div class="card-head"><div><h3>${pengelolaCatatan ? 'Catatan Pegawai' : 'Catatan Saya untuk Bendahara'} ${catatanBuka ? `<span class="badge amber plain">${catatanBuka} perlu ditindaklanjuti</span>` : ''}</h3>
        <div class="sub">Laporan kekeliruan data (mis. nominal honor) — nama pengirim tercatat otomatis dari sesi login</div></div>
        <div class="toolbar"><a class="btn btn-sm" href="${c.base}/catatan-pegawai">${ui.icon('inbox')}Buka Catatan</a></div></div>
      ${catatanList.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Pegawai</th><th>Terkait</th><th>Catatan</th><th>Status</th></tr></thead><tbody>
        ${catatanList.map(x => `<tr>
          <td class="nowrap t-sub">${esc(String(x.created_at || '').slice(0, 16))}</td>
          <td class="t-strong">${esc(x.nama)}${x.jabatan ? `<div class="t-sub">${esc(x.jabatan)}</div>` : ''}</td>
          <td class="t-sub">${esc(x.terkait || 'umum')}${x.periode ? ` · ${esc(dbm.periodeLabel(x.periode))}` : ''}</td>
          <td style="max-width:420px">${esc(String(x.pesan).slice(0, 220))}</td>
          <td>${x.status === 'selesai' ? ui.badge('Selesai', 'green') : x.status === 'diproses' ? ui.badge('Diproses', 'blue') : ui.badge('Baru', 'amber')}</td>
        </tr>`).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada catatan pegawai', 'Catatan dari pegawai akan muncul di sini otomatis.')}
    </div>` : '';

    /* ---------- analitik iuran tahun pelajaran (ringkasan, matriks, metode, per grup) ---------- */
    const iur = ta ? dbm.iuranAnalytics(ta.id) : { summary: { tagihan: 0, terbayar: 0, potongan: 0, sisa: 0, siswa: 0 }, monthly: [], metode: [], grup: [], nonBulanan: { tagihan: 0, dibayar: 0 } };
    const iurSummary = iur.summary;
    const iurAda = iurSummary.tagihan > 0;
    // grafik tunggal: penerimaan SPP per bulan yang dihitung dari DATA IURAN RIIL (dbm.sppSeries)
    const fmtShort = v => {
      const n = Number(v) || 0;
      if (Math.abs(n) >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1).replace('.', ',') + ' M';
      if (Math.abs(n) >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + ' jt';
      if (Math.abs(n) >= 1e3) return 'Rp ' + Math.round(n / 1e3) + ' rb';
      return n ? 'Rp ' + n : '—';
    };
    const iuranSection = `<div class="card mb-3" id="iuranAnalytics">
      <div class="card-head"><div><h3>Rekapitulasi Iuran Siswa — Tahun Pelajaran ${esc(ta ? ta.nama : '-')}</h3>
        <div class="sub">Ringkasan satu tahun pelajaran (Juli s.d. Juni), tren penerimaan, matriks bulanan, metode pembayaran &amp; rincian per grup iuran</div></div>
        <div class="toolbar"><a class="btn btn-sm" href="${c.base}/iuran/data">${ui.icon('coins')}Data Iuran</a>
          <a class="btn btn-sm" href="${c.base}/iuran/antrean">${ui.icon('clock')}Antrean Posting</a></div></div>

      <div class="kpi-grid mb-3">
        ${kpi('ic-orange', 'receipt', 'Total Tagihan Iuran', rupiah(iurSummary.tagihan), `${iurSummary.siswa} siswa · ${iurSummary.tagihanCount || 0} tagihan`)}
        ${kpi('ic-green', 'check', 'Total Sudah Dibayar', rupiah(iurSummary.terbayar), `Potongan ${rupiah(iurSummary.potongan)}`)}
        ${kpi('ic-blue', 'card', 'Total Belum Lunas', rupiah(iurSummary.sisa), `${(iurSummary.tagihanCount || 0) - (iurSummary.lunas || 0)} tagihan belum lunas`)}
        ${kpi('ic-red', 'down', 'Total Sisa Tunggakan', rupiah(iurSummary.sisa),
      `${iurSummary.tagihan > 0 ? Math.round((iurSummary.terbayar / iurSummary.tagihan) * 100) : 0}% tertagih`)}
      </div>

      <div class="t-strong mb-1">Tren Penerimaan SPP per Bulan (Juli – Juni)</div>
      <div class="help mb-1">Sumber angka: pembayaran iuran yang benar-benar tercatat pada grup <b>SPP</b> — bukan tabel SPP terpisah,
        sehingga grafik selalu sinkron dengan Data Iuran.</div>
      ${sppTrendAda
        ? ui.chartLineSPP(sppTrend, { id: 'spp' + (ta ? ta.id : 0) })
        : ui.emptyState('Belum ada penerimaan SPP', 'Grafik terbentuk otomatis setelah pembayaran iuran grup SPP dicatat.')}

      <div class="t-strong mb-1 mt-3">Rekapitulasi Bulanan (Juli – Juni)</div>
      <div class="table-scroll short"><table class="matrix-tbl"><thead><tr>
        <th class="col-name">Uraian</th>${iur.monthly.map(m => `<th class="num">${esc(m.label)}</th>`).join('')}<th class="num">TOTAL</th>
      </tr></thead><tbody>
        <tr><td class="col-name">Total Tagihan per Bulan</td>
          ${iur.monthly.map(m => `<td class="num">${m.tagihan ? rupiah(m.tagihan) : '—'}</td>`).join('')}
          <td class="num t-strong">${rupiah(iur.monthly.reduce((a, m) => a + m.tagihan, 0))}</td></tr>
        <tr><td class="col-name">Total Sudah Dibayar per Bulan</td>
          ${iur.monthly.map(m => `<td class="num" style="color:var(--green)">${m.dibayar ? rupiah(m.dibayar) : '—'}</td>`).join('')}
          <td class="num t-strong" style="color:var(--green)">${rupiah(iur.monthly.reduce((a, m) => a + m.dibayar, 0))}</td></tr>
        <tr class="total-row"><td class="col-name">Sisa / Tunggakan per Bulan</td>
          ${iur.monthly.map(m => `<td class="num" style="color:${m.sisa > 0 ? 'var(--red)' : 'var(--green)'}">${m.sisa ? rupiah(m.sisa) : '—'}</td>`).join('')}
          <td class="num" style="color:var(--red)">${rupiah(iur.monthly.reduce((a, m) => a + m.sisa, 0))}</td></tr>
      </tbody></table></div>
      ${iur.nonBulanan.tagihan > 0 ? `<div class="help mt-1">Di luar tabel bulanan: iuran <b>non-bulanan</b> tagihan ${rupiah(iur.nonBulanan.tagihan)} · sudah dibayar ${rupiah(iur.nonBulanan.dibayar)}.</div>` : ''}

      <div class="t-strong mb-1 mt-3">Rekapitulasi Metode Pembayaran (Tunai vs Transfer Bank)</div>
      <div class="table-scroll short"><table class="matrix-tbl"><thead><tr>
        <th class="col-name">Metode</th>${iur.metode.map(m => `<th class="num">${esc(m.label)}</th>`).join('')}<th class="num">TOTAL</th>
      </tr></thead><tbody>
        <tr><td class="col-name">Tunai (Cash)</td>
          ${iur.metode.map(m => `<td class="num">${m.tunai ? rupiah(m.tunai) : '—'}</td>`).join('')}
          <td class="num t-strong">${rupiah(iur.metode.reduce((a, m) => a + m.tunai, 0))}</td></tr>
        <tr><td class="col-name">Transfer Bank</td>
          ${iur.metode.map(m => `<td class="num">${m.transfer ? rupiah(m.transfer) : '—'}</td>`).join('')}
          <td class="num t-strong">${rupiah(iur.metode.reduce((a, m) => a + m.transfer, 0))}</td></tr>
        <tr class="total-row"><td class="col-name">Jumlah Penerimaan</td>
          ${iur.metode.map(m => `<td class="num">${m.total ? rupiah(m.total) : '—'}</td>`).join('')}
          <td class="num">${rupiah(iur.metode.reduce((a, m) => a + m.total, 0))}</td></tr>
      </tbody></table></div>

      <div class="between mt-3 mb-1">
        <div class="t-strong">Rincian Penerimaan per Grup Iuran (Juli – Juni)</div>
        <div class="filter-chip">
          <label class="small muted" for="iuranMetode">Filter Metode:</label>
          <select id="iuranMetode" data-iuran-metode style="min-width:150px">
            <option value="all">Semua</option>
            <option value="tunai">Cash / Tunai</option>
            <option value="transfer">Transfer Bank</option>
          </select>
        </div>
      </div>
      <div class="table-scroll"><table class="matrix-tbl" id="tblGrupIuran"><thead><tr>
        <th class="col-name">Grup Iuran</th>${iur.monthly.map(m => `<th class="num">${esc(m.label)}</th>`).join('')}<th class="num">GRAND TOTAL</th>
      </tr></thead><tbody>
        ${iur.grup.length ? iur.grup.map(g => `<tr data-grup-row>
          <td class="col-name">${esc(g.nama)} <span class="badge ${g.jenis === 'bulanan' ? 'blue' : 'orange'} plain">${g.jenis === 'bulanan' ? 'Bulanan' : 'Non-Bulanan'}</span></td>
          ${iur.monthly.map(m => {
          const cell = g.sel[m.bulan] || { tunai: 0, transfer: 0 };
          const all = cell.tunai + cell.transfer;
          return `<td class="num" data-tunai="${cell.tunai}" data-transfer="${cell.transfer}">${all ? rupiah(all) : '—'}</td>`;
        }).join('')}
          <td class="num t-strong" data-total-tunai="${g.total.tunai}" data-total-transfer="${g.total.transfer}">${rupiah(g.total.tunai + g.total.transfer)}</td></tr>`).join('')
        : '<tr><td colspan="14" class="center muted">Belum ada grup iuran pada tahun pelajaran ini.</td></tr>'}
      </tbody><tfoot><tr><td class="col-name">GRAND TOTAL</td>
        ${iur.monthly.map(m => {
          const sum = iur.grup.reduce((a, g) => { const c = g.sel[m.bulan] || { tunai: 0, transfer: 0 }; return a + c.tunai + c.transfer; }, 0);
          return `<td class="num" data-foot-bulan="${m.bulan}">${sum ? rupiah(sum) : '—'}</td>`;
        }).join('')}
        <td class="num" data-foot-total>${rupiah(iur.grup.reduce((a, g) => a + g.total.tunai + g.total.transfer, 0))}</td></tr></tfoot></table></div>
    </div>`;

    const content = `
    <div class="card hero mb-3" style="padding:26px 28px">
      <div style="position:relative;z-index:1" class="between">
        <div>
          <span class="hero-chip">${ui.icon('calendar')} Tahun Ajaran ${esc(ta ? ta.nama : '-')}</span>
          <h2 style="font-size:24px;margin:12px 0 6px">Ringkasan Keuangan ${esc(c.settings.sekolah_nama || 'Sekolah')}</h2>
          <p style="margin:0;color:rgba(255,255,255,.9);max-width:620px">Pantau posisi kas, serapan anggaran, dan status buku kas (BKU) secara real-time dalam satu layar.</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.8);font-weight:700">Total Saldo Dana (BKU)</div>
          <div style="font-size:30px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums">${esc(rupiah(dbm.totalSaldoDana(ta ? ta.id : null)))}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.85)">${bkuss.length} buku kas · ${aktifBku.length} aktif</div>
          <div style="font-size:11.5px;color:rgba(255,255,255,.9);margin-top:3px">Total Aset Riil <b>${esc(rupiah(totalAsetRiil))}</b></div>
          <div class="store-mini" title="Ukuran berkas database aplikasi: ${lib.fileSize(store.used)} dari kuota ${lib.fileSize(store.quota)}">
            ${ui.icon('database', 'i-sm')} Sisa penyimpanan <b>${sisaTxt}</b>
            <div class="bar"><i style="width:${Math.max(2, Math.round(store.pct))}%"></i></div>
          </div>
        </div>
      </div>
    </div>

    ${queueAlerts.length ? `<div class="alert warn mb-3">${ui.icon('bell')}<div><b>Notifikasi Antrean Posting.</b><ul style="margin:6px 0 0 16px;padding:0">${queueAlerts.map(x => `<li>${x}</li>`).join('')}</ul></div></div>` : ''}

    <div class="kpi-grid mb-3">
      ${kpi('ic-green', 'up', 'Total Pemasukan BKU', rupiah(g.masuk), 'Seluruh transaksi terposting')}
      ${kpi('ic-red', 'down', 'Total Pengeluaran BKU', rupiah(g.keluar), 'Seluruh transaksi terposting')}
      ${kpi('ic-orange', 'wallet', 'Total Kas Riil', rupiah(kas.bank + kas.tunai),
      `Bank ${rupiah(kas.bank)} · Tunai ${rupiah(kas.tunai)}`)}
      ${kpi('ic-blue', 'card', 'Total Piutang Berjalan', rupiah(piutangTotal),
      `Pegawai ${rupiah(piutangPeg)}${sppTampil ? ` · SPP ${rupiah(tunggakanSpp)}` : ' · SPP disembunyikan'}`)}
    </div>

    ${iuranSection}
    ${pesanCard}
    ${catatanCard}

    <div class="card mb-3">
      <div class="card-head">
        <div><h3>Visualisasi Keuangan &amp; Buku Kas</h3><div class="sub">Pilih tipe grafik dan mode data — arahkan kursor untuk melihat rincian</div></div>
        <div class="toolbar">
          <select data-fin-type aria-label="Tipe grafik">
            <option value="donut">Pie / Donut Chart</option>
            <option value="bar">Diagram Batang (Bar)</option>
            <option value="line">Tren Arus Kas (Line)</option>
          </select>
          <select data-fin-mode aria-label="Mode data">
            <option value="saldo">Mode Saldo Akhir</option>
            <option value="keluar">Mode Total Pengeluaran</option>
            <option value="masuk">Mode Total Pemasukan</option>
          </select>
        </div>
      </div>
      <div id="finChart" class="fin-chart">
        ${finBku.length ? '' : ui.emptyState('Belum ada data BKU', 'Grafik akan tampil setelah ada BKU dan transaksi pada tahun ajaran aktif.')}
      </div>
    </div>

    ${belumTutup.length ? `<div class="card mb-3" style="border-color:#F6CFD0;background:#FFF8F8">
      <div class="between">
        <div style="min-width:0">
          <div style="font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px">${ui.icon('lock', 'i-sm')}
            BKU Bulan ${esc(dbm.periodeLabel(lastPeriode))} Belum Ditutup</div>
          <div class="small muted" style="margin-top:2px;max-width:760px">
            Silakan lakukan proses <b>Tutup BKU</b> dan <b>Penyesuaian Saldo Awal</b> untuk memulai bulan baru.
            ${belumBulanLalu.length ? `<b>${belumBulanLalu.length} BKU</b> pada periode tersebut belum ditutup.` : ''}
            ${belumTutup.length > belumBulanLalu.length ? `Terdapat juga ${belumTutup.length - belumBulanLalu.length} periode lain yang masih terbuka.` : ''}
            Input transaksi pada bulan yang sudah berganti diblokir sampai proses ini selesai.
          </div>
          <div class="toolbar" style="margin-top:10px">
            ${belumTutup.slice(0, 4).map(x => `<span class="badge red plain">${esc(x.bku_nama)} · ${esc(dbm.periodeLabel(x.periode))}</span>`).join('')}
            ${belumTutup.length > 4 ? `<span class="badge gray plain">+${belumTutup.length - 4} lainnya</span>` : ''}
          </div>
        </div>
        <div class="right" style="flex:0 0 auto">
          <div class="small muted">Saldo buku belum ditutup</div>
          <div style="font-weight:800;font-size:18px">${esc(rupiah(totalBukuBelum))}</div>
          <a class="btn btn-primary mt-1" href="${c.base}/tutup-bulanan?periode=${lastPeriode}&semua=1">${ui.icon('lock')}Tutup BKU Sekarang</a>
        </div>
      </div>
    </div>` : `<div class="card mb-3" style="border-color:#BFE9D8;background:#F7FDFA">
      <div class="between"><div style="display:flex;gap:10px;align-items:center">
        <span style="color:var(--green)">${ui.icon('check', 'i-sm')}</span>
        <div><div style="font-weight:700">Semua BKU bulan lalu sudah ditutup</div>
        <div class="small muted">Periode ${esc(dbm.periodeLabel(lastPeriode))} selesai — saldo sudah di-rollover ke ${esc(dbm.periodeLabel(curPeriode))}.</div></div>
      </div><a class="btn btn-sm" href="${c.base}/tutup-bulanan">Riwayat Tutup Bulanan</a></div></div>`}

    ${pending.length && c.can('transaksi', 'approve') ? `<div class="card mb-3" style="border-color:#F7DFB5;background:#FFFDF7">
      <div class="card-head"><div><h3>${ui.icon('clock', 'i-sm')} Menunggu Persetujuan Kepala Sekolah</h3>
        <div class="sub">${pending.length} pengeluaran nominal besar belum memengaruhi saldo BKU</div></div>
        <a class="btn btn-sm btn-primary" href="${c.base}/transaksi?status=pending">Tinjau Sekarang</a></div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>BKU</th><th>Uraian</th><th>Pembuat</th><th class="num">Nominal</th><th></th></tr></thead><tbody>
      ${pending.map(t => `<tr><td>${tglID(t.tanggal)}</td><td>${esc(t.bku_nama)}</td><td>${esc(t.uraian)}</td><td>${esc(t.pembuat || '-')}</td>
        <td class="num t-strong">${rupiah(t.nominal)}</td>
        <td class="right"><a class="btn btn-sm" href="${c.base}/transaksi?status=pending">Detail</a></td></tr>`).join('')}
      </tbody></table></div>
    </div>` : ''}

    <div class="split mb-3">
      <div class="card">
        <div class="card-head"><div><h3>Serapan Anggaran RAPBS / RKAS</h3><div class="sub">Realisasi pengeluaran vs pagu tahun ajaran ${esc(ta ? ta.nama : '-')}</div></div>
          <a class="btn btn-sm" href="${c.base}/anggaran">Kelola Anggaran</a></div>
        <div class="between" style="margin-bottom:8px">
          <div><span class="muted small">Realisasi</span><div style="font-size:20px;font-weight:800">${rupiah(realisasi)}</div></div>
          <div class="right"><span class="muted small">Pagu</span><div style="font-size:20px;font-weight:800">${rupiah(pagu)}</div></div>
        </div>
        ${ui.prog(serapanPct, serapanPct > 100 ? 'r' : serapanPct > 85 ? '' : 'g')}
        <div class="between" style="margin-top:6px"><span class="small muted">${serapanPct.toFixed(1)}% terserap</span>
          <span class="small muted">Sisa ${rupiah(Math.max(0, pagu - realisasi))}</span></div>
        <hr class="sep">
        ${topAnggaran.length ? `<div class="list">${topAnggaran.map(a => {
          const pct = a.pagu > 0 ? (a.real / a.pagu) * 100 : 0;
          return `<div class="list-row" style="display:block">
            <div class="between" style="gap:10px"><div style="min-width:0"><div class="nm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.nama)}</div>
              <div class="mt">${a.kode} · pagu ${rupiah(a.pagu)}</div></div>
              <div class="right nowrap"><b>${rupiah(a.real)}</b><div class="mt">${pct.toFixed(0)}%</div></div></div>
            <div style="margin-top:8px">${ui.prog(pct, pct > 100 ? 'r' : pct > 85 ? '' : 'g')}</div></div>`;
        }).join('')}</div>` : ui.emptyState('Belum ada pagu anggaran', 'Tambahkan pagu per kode rekening di menu Anggaran RAPBS.')}
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Status Buku Kas (BKU)</h3><div class="sub">Terbuka untuk input vs sudah ditutup</div></div>
          <a class="btn btn-sm" href="${c.base}/bku">Kelola</a></div>
        <div class="small" style="font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Terbuka / Aktif (${aktifBku.length})</div>
        <div class="list" style="margin-bottom:16px">
          ${aktifBku.slice(0, 6).map(b => `<div class="list-row"><div class="dot-s" style="background:var(--green)"></div>
            <div style="min-width:0"><div class="nm">${esc(b.nama)}</div><div class="mt">${b.jenis === 'umum' ? 'BKU Umum' : 'BKU Kegiatan'}</div></div>
            <div class="amt">${rupiah(dbm.bkuSaldo(b.id))}</div></div>`).join('') || '<div class="help">Tidak ada BKU aktif.</div>'}
        </div>
        <div class="small" style="font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Ditutup (${tutupBku.length})</div>
        <div class="list">
          ${tutupBku.slice(0, 6).map(b => `<div class="list-row" style="opacity:.85"><div class="dot-s" style="background:#C9BDB4"></div>
            <div style="min-width:0"><div class="nm">${esc(b.nama)}</div><div class="mt">Ditutup ${esc(b.ditutup_at ? tglID(b.ditutup_at) : '-')}</div></div>
            <div class="amt">${rupiah(b.saldo_akhir_tutup ?? dbm.bkuSaldo(b.id))}</div></div>`).join('') || '<div class="help">Belum ada BKU ditutup.</div>'}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Transaksi Terakhir</h3><div class="sub">8 transaksi terposting terbaru</div></div>
        <div class="toolbar"><a class="btn btn-sm" href="${c.base}/transaksi">Semua Transaksi</a>
        ${c.can('transaksi', 'create') ? `<a class="btn btn-sm btn-primary" href="${c.base}/transaksi#form">${ui.icon('plus')}Input Transaksi</a>` : ''}</div></div>
      ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>BKU</th><th>Uraian</th><th class="num">Pemasukan</th><th class="num">Pengeluaran</th></tr></thead><tbody>
        ${recent.map(t => `<tr><td class="nowrap">${tglID(t.tanggal)}</td><td class="nowrap t-sub">${esc(t.no_bukti)}</td><td>${esc(t.bku_nama)}</td>
          <td>${esc(t.uraian)}<div class="t-sub">${esc(t.coa_nama || '')}</div></td>
          <td class="num" style="color:var(--green)">${t.jenis === 'pemasukan' ? rupiah(t.nominal) : '—'}</td>
          <td class="num" style="color:var(--red)">${t.jenis === 'pengeluaran' ? rupiah(t.nominal) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">
        <div class="eico">${ui.icon('receipt')}</div><h4>Belum ada transaksi</h4>
        <p>Mulai dengan menginput pemasukan atau pengeluaran pada BKU yang aktif.</p>
        <div class="flex" style="justify-content:center;gap:10px;margin-top:14px">
          <a class="btn btn-primary" href="${c.base}/transaksi">Input Transaksi</a>
          ${req.user.role === 'super_admin' && !hasData ? `<form method="post" action="${c.base}/demo/seed" data-confirm="Muat data contoh ke dalam aplikasi? Data contoh dapat dihapus nanti melalui menu Backup &amp; Restore."><button class="btn">Muat Data Contoh</button></form>` : ''}
        </div></div>`}
    </div>
    ${belumTutup.length ? ui.modal('mTutupBulanan', {
      title: 'Tutup BKU Bulanan Diperlukan',
      wide: true,
      autoShow: !approvalAlert,
      autoKey: lastPeriode + ':' + belumTutup.length,
      body: `<div class="alert warn">${ui.icon('lock', 'i-sm')}<div><b>BKU Bulan ${esc(dbm.periodeLabel(lastPeriode))} Belum Ditutup.</b><br>
        Silakan lakukan proses Tutup BKU dan Penyesuaian Saldo Awal untuk memulai bulan baru.</div></div>
        <p class="small muted">Sistem otomatis memblokir penginputan transaksi baru pada bulan sebelumnya sampai proses penutupan BKU bulanan dilakukan.</p>
        <div class="table-wrap"><table><thead><tr><th>Buku Kas</th><th>Periode</th><th class="num">Saldo Buku</th></tr></thead><tbody>
          ${belumTutup.slice(0, 8).map(x => `<tr><td>${esc(x.bku_nama)}</td><td class="nowrap">${esc(dbm.periodeLabel(x.periode))}</td>
            <td class="num">${esc(rupiah(dbm.periodePosisi(x.bku_id, x.periode).saldoBuku))}</td></tr>`).join('')}
          ${belumTutup.length > 8 ? `<tr><td colspan="3" class="muted">+${belumTutup.length - 8} BKU lainnya…</td></tr>` : ''}
        </tbody></table></div>`,
      footer: `<a class="btn btn-primary" href="${c.base}/tutup-bulanan?periode=${lastPeriode}&semua=1">${ui.icon('lock')}Proses Tutup BKU Sekarang</a>`
    }) : ''}
    ${approvalAlert ? ui.modal('mApprovalAlert', {
      title: 'Draf Pengeluaran Baru',
      autoShow: true,
      autoKey: 'approval:' + approvalAlert + ':' + curPeriode,
      body: `<div class="alert warn">${ui.icon('bell')}<div><b>Ada ${approvalAlert} draf pengeluaran baru yang membutuhkan persetujuan Anda.</b><br>
        Draf tersebut <b>belum memotong saldo BKU</b> sampai Anda menyetujuinya.</div></div>
        <p class="small muted">Buka panel persetujuan untuk melihat rincian, foto nota, lalu menyetujui atau menolak setiap draf.</p>`,
      footer: `<button class="btn" type="button" data-close="mApprovalAlert" data-dismiss-auto>Nanti</button>
        <a class="btn btn-primary" href="${c.base}/approval">${ui.icon('check')}Tinjau &amp; Setujui</a>`
    }) : ''}
    <script>window.__FIN_DATA = ${JSON.stringify(finData).replace(/</g, '\\u003c')};</script>
    `;
    page(req, res, { title: 'Dashboard', sub: `Ringkasan eksekutif keuangan · ${ta ? 'TA ' + ta.nama : 'belum ada tahun ajaran'}`, active: 'dashboard', content });
    if (approvalAlert && req.sessionRow) {
      dbm.db.prepare('UPDATE sessions SET alert_pending=0 WHERE token=?').run(req.sessionRow.token);
    }
  });

  /* ================= CATATAN ORANG TUA (rekap terpisah) ================= */
  function catatanOrtuPage(req, res) {
    guard(req, res, 'dashboard', 'view');
    const c = ctx(req);
    const st = ['baru', 'selesai'].includes(req.query.get('status') || '') ? req.query.get('status') : '';
    const sumber = ['siswa', 'piutang-pegawai', 'slip-pegawai', 'semua'].includes(req.query.get('sumber') || '')
      ? req.query.get('sumber') : 'semua';
    const rows = dbm.portalPesanList({ status: st || undefined, sumber: sumber === 'semua' ? undefined : sumber, limit: 400 });
    const baru = rows.filter(x => x.status === 'baru').length;
    const qs = (extra = '') => {
      const p = new URLSearchParams();
      if (st) p.set('status', st);
      if (sumber !== 'semua') p.set('sumber', sumber);
      const base = '/catatan-orangtua' + (p.toString() ? '?' + p.toString() : '');
      if (!extra) return base;
      return base + (p.toString() ? '&' : '?') + extra;
    };
    const content = `<div class="card">
      <div class="card-head"><div><h3>Rekap Catatan Orang Tua</h3>
        <div class="sub">${rows.length} catatan · ${baru} belum ditindaklanjuti · dikirim orang tua/wali melalui portal publik</div></div>
        <form method="get" action="${c.base}/catatan-orangtua" class="toolbar">
          <select name="sumber" data-autosubmit aria-label="Sumber catatan">
            <option value="siswa" ${sumber === 'siswa' ? 'selected' : ''}>Tagihan Siswa (orang tua)</option>
            <option value="piutang-pegawai" ${sumber === 'piutang-pegawai' ? 'selected' : ''}>Piutang Pegawai</option>
            <option value="slip-pegawai" ${sumber === 'slip-pegawai' ? 'selected' : ''}>Slip Pegawai</option>
            <option value="semua" ${sumber === 'semua' ? 'selected' : ''}>Semua sumber</option>
          </select>
          <select name="status" data-autosubmit aria-label="Status catatan">
            <option value="">Semua Status</option>
            <option value="baru" ${st === 'baru' ? 'selected' : ''}>Baru</option>
            <option value="selesai" ${st === 'selesai' ? 'selected' : ''}>Selesai Ditindaklanjuti</option>
          </select>
        </form></div>
      ${rows.length ? `<div class="table-wrap sticky-head"><table><thead><tr><th>Waktu</th><th>Sumber</th><th>Nama Pengirim</th><th>Catatan</th><th>Kontak</th><th>Status</th><th class="right">Aksi</th></tr></thead><tbody>
        ${rows.map(x => {
      const sm = String(x.sumber || 'siswa');
      const sumberBadge = sm === 'slip-pegawai' ? ui.badge('Slip Pegawai', 'blue')
        : sm === 'piutang-pegawai' ? ui.badge('Piutang Pegawai', 'orange') : ui.badge('Tagihan Siswa', 'gray');
      const tautan = sm === 'siswa'
        ? `<a href="${c.base}/iuran/data/${Number(x.siswa_id) || 0}">buka data iuran</a>`
        : `<a href="${c.base}/pegawai">data pegawai</a>`;
      return `<tr>
          <td class="nowrap t-sub">${esc(String(x.created_at || '').slice(0, 16))}</td>
          <td>${sumberBadge}</td>
          <td class="t-strong">${esc(x.nama || '-')}<div class="t-sub">${tautan}</div></td>
          <td style="max-width:520px">${esc(x.pesan)}</td>
          <td class="t-sub">${esc(x.kontak || '-')}</td>
          <td>${x.status === 'selesai' ? ui.badge('Selesai Ditindaklanjuti', 'green') : ui.badge('Baru', 'amber')}
            ${x.status === 'selesai' ? `<div class="t-sub">${esc(String(x.selesai_at || '').slice(0, 16))} · ${esc(x.selesai_by || '')}</div>` : ''}</td>
          <td class="right nowrap">
            ${x.status === 'selesai' ? '' : `<form method="post" action="${c.base}/pesan-orangtua/selesai" style="display:inline"><input type="hidden" name="id" value="${x.id}"><input type="hidden" name="back" value="${esc(qs())}"><button class="btn btn-sm btn-green">${ui.icon('check')}Tandai Selesai</button></form>`}
            ${c.can('dashboard', 'delete') || c.can('catatan', 'delete') ? `<form method="post" action="${c.base}/catatan-orangtua/delete" style="display:inline" data-confirm="Hapus catatan dari ${esc(x.nama || 'pengirim')} ini? Catatan akan hilang permanen.">
              <input type="hidden" name="id" value="${x.id}"><input type="hidden" name="back" value="${esc(qs())}">
              <button class="btn btn-sm btn-danger btn-icon" title="Hapus catatan">${ui.icon('trash')}</button></form>` : ''}
          </td>
        </tr>`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada catatan orang tua', 'Catatan orang tua/wali dari portal publik akan tampil di sini.')}
      <p class="help mt-2">Portal publik (alamat dapat diubah di menu <a href="${c.base}/sekolah">Identitas Sekolah</a>):
        <a href="${c.base}/${dbm.portalSlugs().siswa}" target="_blank">tagihan siswa</a> ·
        <a href="${c.base}/${dbm.portalSlugs().pegawai}" target="_blank">piutang pegawai</a> ·
        <a href="${c.base}/${dbm.portalSlugs().slip}" target="_blank">slip gaji pegawai</a>
        — catatan orang tua otomatis terkumpul di sini.</p>
    </div>`;
    page(req, res, { title: 'Catatan Orang Tua', sub: 'Rekap umpan balik orang tua/wali dari portal publik', active: 'pesan_orangtua', content });
  }
  get('/catatan-orangtua', catatanOrtuPage);
  // alamat lama tetap dilayani (bukan redirect) agar tautan & bookmark lama tetap berfungsi
  get('/pesan-orangtua', catatanOrtuPage);

  post('/catatan-orangtua/delete', (req, res) => {
    if (!can(req.user, 'dashboard', 'delete') && !can(req.user, 'catatan', 'delete')) {
      return res.redirect(req.BASE + '/catatan-orangtua?err=' + encodeURIComponent('Role Anda tidak berhak menghapus catatan orang tua.'));
    }
    const id = Number(req.body.id || 0);
    const backRaw = String(req.body.back || '/catatan-orangtua');
    const back = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/catatan-orangtua';
    const row = id ? dbm.db.prepare('SELECT * FROM portal_pesan WHERE id=?').get(id) : null;
    if (!row) return res.redirect(req.BASE + back + (back.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent('Catatan tidak ditemukan.'));
    dbm.db.prepare('DELETE FROM portal_pesan WHERE id=?').run(id);
    dbm.logAudit(req.user, 'HAPUS', 'portal', `Menghapus catatan orang tua dari ${row.nama || '-'}: ${String(row.pesan || '').slice(0, 100)}`);
    res.redirect(req.BASE + back + (back.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent('Catatan orang tua dihapus.'));
  });

  post('/pesan-orangtua/selesai', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const id = Number(req.body.id || 0);
    const backRaw = String(req.body.back || '/catatan-orangtua');
    const back = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/catatan-orangtua';
    const row = id ? dbm.db.prepare('SELECT * FROM portal_pesan WHERE id=?').get(id) : null;
    if (!row) return res.redirect(req.BASE + back + (back.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent('Catatan tidak ditemukan.'));
    dbm.db.prepare("UPDATE portal_pesan SET status='selesai', selesai_at=?, selesai_by=? WHERE id=?").run(lib.nowStamp(), req.user.nama, id);
    dbm.logAudit(req.user, 'TINDAKLANJUT', 'portal', `Catatan orang tua ${row.nama || ''} ditandai selesai`);
    res.redirect(req.BASE + back + (back.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent('Catatan ditandai: Selesai Ditindaklanjuti.'));
  });

};
