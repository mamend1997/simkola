'use strict';
const printcfg = require('../printcfg');
/**
 * Portal publik pegawai:
 *  - /portal-pegawai  → cek & rincian piutang (piutang pegawai + piutang sertifikasi)
 *  - /portal-slip     → cek & unduh slip gaji / honor
 * Keamanan: Nama + Tanggal Lahir cocok, lalu kode OTP 4 digit dikirim ke WhatsApp pegawai.
 * Tanpa login petugas. Favicon mengikuti logo sekolah (route /favicon.ico).
 */
const wa = require('../wa');

module.exports = ({ get, post, dbm, lib, ui }) => {
  const { db } = dbm;
  const { esc, rupiah, tglID, todayISO, nowStamp, num } = lib;

  const JENIS_LABEL = { piutang: 'Cek Piutang Pegawai', slip: 'Slip Gaji Pegawai' };

  function shell({ base, settings, content, title, aktif = 'piutang' }) {
    const logo = settings.sekolah_logo
      ? `<img src="${esc(settings.sekolah_logo)}" alt="Logo">`
      : `<div class="p-logo-ph">${esc((settings.sekolah_nama || 'S').charAt(0))}</div>`;
    const lainnya = aktif === 'piutang'
      ? `<a class="btn btn-sm portal-login" href="${base}/portal-slip">Slip Gaji Pegawai</a>`
      : `<a class="btn btn-sm portal-login" href="${base}/portal-pegawai">Cek Piutang Pegawai</a>`;
    return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(settings.sekolah_nama || 'Sekolah')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/assets/app.css?v=${ui.ASSET_V}">
<link rel="icon" type="image/png" href="${base}/favicon.ico">
<link rel="apple-touch-icon" href="${base}/favicon.ico">
<meta name="theme-color" content="#F97316">
</head><body class="portal-body">
<div class="portal-wrap">
  <header class="portal-head">
    ${logo}
    <div>
      <div class="pn">${esc(settings.sekolah_nama || 'Sekolah')}</div>
      <div class="ps">${esc(JENIS_LABEL[aktif] || 'Portal Pegawai')}</div>
    </div>
    ${lainnya}
  </header>
  ${content}
  <footer class="portal-foot">© ${new Date().getFullYear()} ${esc(settings.sekolah_nama || '')} · Data hanya ditampilkan setelah verifikasi OTP WhatsApp.</footer>
</div>
<script src="${base}/assets/app.js?v=${ui.ASSET_V}"></script>
</body></html>`;
  }

  const normPhone = wa.normalizePhone;
  function pegawaiBy(nama, lahir) {
    return db.prepare(`SELECT * FROM pegawai WHERE lower(trim(nama))=lower(trim(?)) AND COALESCE(tanggal_lahir,'')=?
      AND aktif=1`).all(String(nama || '').trim(), String(lahir || '').slice(0, 10));
  }
  function searchBlock({ base, kind, err = '', nama = '', lahir = '' }) {
    const isSlip = kind === 'slip';
    return `<div class="portal-card">
      <h2>${isSlip ? 'Cek & Unduh Slip Gaji' : 'Cek Piutang Pegawai'}</h2>
      <p class="muted small">Masukkan <b>nama pegawai</b> dan <b>tanggal lahir</b> sesuai data sekolah.
        Sistem mengirim <b>kode OTP 4 digit</b> ke <b>nomor WhatsApp yang sudah terdaftar</b> pada data pegawai sebelum rincian dibuka.</p>
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
      <form method="post" action="${base}${isSlip ? '/portal-slip' : '/portal-pegawai'}/otp">
        <div class="field"><label>Nama Pegawai</label>
          <input name="nama" value="${esc(nama)}" required autocomplete="off" placeholder="Ketik minimal 3 huruf nama Anda"
            data-autocomplete="${base}${isSlip ? '/portal-slip' : '/portal-pegawai'}/nama" data-autocomplete-min="3">
          <div class="ac-list" data-ac-list></div>
          <div class="hint">Pilihan nama muncul otomatis setelah Anda mengetik 3 huruf.</div></div>
        <div class="field"><label>Tanggal Lahir</label>
          <input type="date" name="lahir" value="${esc(lahir)}" required max="${todayISO()}">
          <div class="hint">Gunakan pemilih kalender pada kolom ini.</div></div>
        <button class="btn btn-primary btn-block">${ui.icon('shield')}Kirim Kode OTP</button>
      </form>
      <p class="help mt-2">Data bersifat pribadi. Kode OTP dikirim otomatis ke nomor WhatsApp pada data pegawai — tidak perlu mengetik nomor.
        Bila nomor WhatsApp Anda berubah, hubungi bendahara sekolah untuk memperbaruinya.</p>
    </div>`;
  }
  function otpBlock({ base, kind, token, phone, pesan, demoKode, err = '' }) {
    const isSlip = kind === 'slip';
    return `<div class="portal-card">
      <h2>Verifikasi Kode OTP</h2>
      <p class="muted small">Kode OTP 4 digit telah dikirim ke nomor WhatsApp <b>${esc(phone)}</b>. Masukkan kode tersebut untuk membuka rincian.</p>
      ${pesan ? `<div class="alert info">${ui.icon('info')}<div>${esc(pesan)}</div></div>` : ''}
      ${demoKode ? `<div class="alert warn">${ui.icon('alert')}<div><b>Gateway WhatsApp belum dikonfigurasi.</b>
        Untuk pengujian, kode OTP Anda: <b class="mono" style="font-size:18px;letter-spacing:3px">${esc(demoKode)}</b><br>
        <span class="small">Atur <code>wa_api_url</code> &amp; <code>wa_api_token</code> pada Pengaturan Sistem agar kode dikirim otomatis, lalu matikan mode uji.</span></div></div>` : ''}
      ${err ? `<div class="alert err">${ui.icon('alert')}<div>${esc(err)}</div></div>` : ''}
      <form method="post" action="${base}${isSlip ? '/portal-slip' : '/portal-pegawai'}/verifikasi">
        <input type="hidden" name="token" value="${esc(token)}">
        <div class="field"><label>Kode OTP (4 digit)</label>
          <input name="kode" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="••••"
            style="letter-spacing:8px;font-size:20px;text-align:center;font-weight:700" autocomplete="one-time-code"></div>
        <button class="btn btn-primary btn-block">${ui.icon('check')}Verifikasi &amp; Tampilkan</button>
      </form>
      <div class="center mt-2"><a class="btn" href="${base}${isSlip ? '/portal-slip' : '/portal-pegawai'}">Ulangi Pencarian</a></div>
    </div>`;
  }
  function closedBlock(settings, base, msg, kind) {
    return shell({
      base, settings, title: 'Portal Ditutup', aktif: kind,
      content: `<div class="portal-card"><h2>Portal sementara ditutup</h2><p class="muted">${esc(msg)}</p></div>`
    });
  }

  /* ================= autocomplete nama pegawai ================= */
  function autoCompleteRoute(path) {
    get(path, (req, res) => {
      const q = String(req.query.get('q') || '').trim();
      if (q.length < 3) return res.json({ ok: true, items: [] });
      const rows = db.prepare(`SELECT nama, jabatan FROM pegawai WHERE aktif=1 AND lower(nama) LIKE ?
        ORDER BY nama LIMIT 10`).all('%' + q.toLowerCase() + '%');
      res.json({ ok: true, items: rows.map(r => ({ nama: r.nama, label: r.jabatan ? `${r.nama} — ${r.jabatan}` : r.nama })) });
    });
  }
  autoCompleteRoute('/portal-pegawai/nama');
  autoCompleteRoute('/portal-slip/nama');

  /* ================= PORTAL PIUTANG PEGAWAI ================= */
  get('/portal-pegawai', (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    if (dbm.getSetting('portal_pegawai_aktif', '1') !== '1') {
      return res.html(closedBlock(settings, base, 'Pengelola sekolah menonaktifkan portal piutang pegawai. Silakan hubungi bendahara sekolah.', 'piutang'));
    }
    res.html(shell({ base, settings, title: 'Cek Piutang Pegawai', aktif: 'piutang', content: searchBlock({ base, kind: 'piutang' }) }));
  });

  post('/portal-pegawai/otp', async (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    if (dbm.getSetting('portal_pegawai_aktif', '1') !== '1') {
      return res.html(closedBlock(settings, base, 'Portal piutang pegawai sedang dinonaktifkan.', 'piutang'));
    }
    const nama = String(req.body.nama || '').trim();
    const lahir = String(req.body.lahir || '').slice(0, 10);
    if (!nama || !/^\d{4}-\d{2}-\d{2}$/.test(lahir)) {
      return res.html(shell({ base, settings, title: 'Cek Piutang Pegawai', aktif: 'piutang', content: searchBlock({ base, kind: 'piutang', nama, lahir, err: 'Nama dan tanggal lahir wajib diisi dengan benar.' }) }));
    }
    const cands = pegawaiBy(nama, lahir);
    if (!cands.length) {
      return res.html(shell({
        base, settings, title: 'Data Tidak Ditemukan', aktif: 'piutang',
        content: searchBlock({ base, kind: 'piutang', nama, lahir, err: 'Data pegawai tidak ditemukan. Pastikan nama & tanggal lahir sama dengan data sekolah (hubungi bendahara bila perlu diperbarui).' })
      }));
    }
    const pg = cands[0];
    const phone = normPhone(pg.whatsapp);
    if (!phone) {
      return res.html(shell({
        base, settings, title: 'Nomor WhatsApp Belum Terdaftar', aktif: 'piutang',
        content: `<div class="portal-card"><h2>Nomor WhatsApp belum terdaftar</h2>
          <p class="muted">Nomor WhatsApp aktif pegawai <b>${esc(pg.nama)}</b> belum tercatat pada master data sekolah, sehingga kode OTP tidak dapat dikirim.
          Silakan hubungi <b>bendahara sekolah</b> untuk memperbarui nomor WhatsApp Anda.</p>
          <div class="center mt-2"><a class="btn" href="${base}/portal-pegawai">Kembali ke Halaman Pencarian</a></div></div>`
      }));
    }
    const o = dbm.otpCreate('piutang', String(pg.id), phone, 10);
    const sent = await wa.sendWA(phone, wa.otpMessage({
      kode: o.kode, keperluan: 'Cek Piutang Pegawai', sekolah: settings.sekolah_nama || 'Sekolah', menit: 10
    }));
    const demoKode = (!sent.ok && dbm.getSetting('wa_demo_tampil', '1') === '1') ? o.kode : '';
    res.html(shell({
      base, settings, title: 'Verifikasi OTP', aktif: 'piutang',
      content: otpBlock({
        base, kind: 'piutang', token: o.token, phone,
        pesan: sent.ok ? 'Kode OTP berhasil dikirim via WhatsApp.' : (sent.reason || ''),
        demoKode
      })
    }));
  });

  function piutangResult({ base, settings, pg }) {
    // Sinkronkan status kolom + hitung agregat langsung dari tabel pembayaran (bukan cache),
    // sehingga transaksi yang sudah lunas TIDAK PERNAH muncul sebagai tagihan aktif.
    try { dbm.piutangSyncStatus(); } catch (e) { }
    const ring = dbm.piutangRingkasan(pg.nama);
    const statusBadge = b => b.sisa > 0
      ? (b.dibayar > 0 ? ui.badge('Belum Lunas · cicilan', 'amber') : ui.badge('Belum Lunas', 'red'))
      : ui.badge('LUNAS', 'green');
    const ket = b => `${esc(b.base)}${b.count > 1 ? ` <span class="badge gray plain">×${b.count}</span>` : ''}`;

    const table = (rows, label, badgeText) => rows.length ? `<div class="portal-ta">
        <div class="ta-head"><b>${esc(label)}</b><span class="badge amber">${badgeText}</span></div>
        <div class="table-wrap"><table class="tbl-modern"><thead><tr><th>Tanggal</th><th>Keterangan</th><th class="num">Nominal Utang</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th></tr></thead><tbody>
        ${rows.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td><td>${ket(b)}</td>
          <td class="num">${rupiah(b.total)}</td><td class="num" style="color:var(--green)">${rupiah(b.dibayar)}</td>
          <td class="num t-strong" style="color:var(--red)">${rupiah(b.sisa)}</td><td>${statusBadge(b)}</td></tr>`).join('')}
        </tbody></table></div></div>`
      : `<div class="portal-ta"><div class="ta-head"><b>${esc(label)}</b><span class="badge green">LUNAS · tidak ada tagihan aktif</span></div></div>`;

    const lunasTable = (rows, label) => rows.length ? `<div class="portal-ta lunas-box">
        <div class="ta-head"><b>${esc(label)} — Riwayat LUNAS</b><span class="badge green">${rows.length} transaksi LUNAS</span></div>
        <div class="table-wrap"><table class="tbl-modern"><thead><tr><th>Tanggal</th><th>Keterangan</th><th class="num">Nominal Utang</th><th class="num">Sudah Dicicil</th><th class="num">Sisa</th><th>Status</th></tr></thead><tbody>
        ${rows.map(b => `<tr><td class="nowrap">${tglID(b.tanggal)}</td><td>${ket(b)}</td>
          <td class="num">${rupiah(b.total)}</td><td class="num" style="color:var(--green)">${rupiah(b.dibayar)}</td>
          <td class="num">${rupiah(0)}</td><td>${ui.badge('LUNAS', 'green')}</td></tr>`).join('')}
        </tbody></table></div></div>` : '';

    /* ---- piutang lainnya (kategori fleksibel) milik pegawai ini yang masih aktif ---- */
    let lainnya = [];
    try {
      lainnya = db.prepare(`SELECT p.*, k.nama kategori_nama,
          COALESCE((SELECT SUM(x.nominal) FROM piutang_lainnya_bayar x WHERE x.piutang_id=p.id),0) dibayar
        FROM piutang_lainnya p LEFT JOIN piutang_kategori k ON k.id=p.kategori_id
        WHERE lower(trim(p.nama))=lower(trim(?)) ORDER BY COALESCE(p.tanggal,''), p.id`).all(pg.nama)
        .map(p => ({ ...p, dibayar: Number(p.dibayar || 0), sisa: Math.max(0, Number(p.nominal || 0) - Number(p.dibayar || 0)) }))
        .filter(p => p.sisa > 0);
    } catch (e) { lainnya = []; }
    const lainnyaRows = lainnya.map(p => ({
      tanggal: p.tanggal, base: (p.kategori_nama || 'Piutang Lainnya') + (p.keterangan ? ` — ${p.keterangan}` : ''),
      count: 1, total: Number(p.nominal || 0), dibayar: Number(p.dibayar || 0), sisa: Number(p.sisa || 0)
    }));
    const lainnyaSisa = lainnyaRows.reduce((a, r) => a + r.sisa, 0);

    const sisaTotal = ring.sisa + lainnyaSisa;
    const aktifCount = ring.umum.aktif.length + ring.lain.aktif.length + lainnyaRows.length;
    const lunasCount = ring.umum.lunas.length + ring.lain.lunas.length;
    return `<div class="portal-card">
        <div class="portal-student">
          <div><div class="pname">${esc(pg.nama)}</div>
            <div class="muted small">${esc(pg.jabatan || '-')} · ${pg.tipe === 'tu' ? 'Tata Usaha' : 'Guru'}</div></div>
          <div style="text-align:right"><div class="badge ${sisaTotal > 0 ? 'amber' : 'green'}">
            ${sisaTotal > 0 ? 'Sisa total ' + rupiah(sisaTotal) : 'LUNAS · tidak ada tagihan'}</div>
            <div class="muted small" style="margin-top:4px">${aktifCount} tagihan aktif · ${lunasCount} lunas</div></div>
        </div>
        ${table(ring.umum.aktif, 'Piutang Pegawai (Umum)', `${ring.umum.aktif.length} tagihan aktif`)}
        ${table(ring.lain.aktif, 'Piutang Sertifikasi', `${ring.lain.aktif.length} tagihan aktif`)}
        ${table(lainnyaRows, 'Piutang Lainnya', `${lainnyaRows.length} tagihan aktif`)}
        ${lunasTable(ring.umum.lunas, 'Piutang Pegawai (Umum)')}
        ${lunasTable(ring.lain.lunas, 'Piutang Sertifikasi')}
      </div>
      <div class="portal-card recap">
        <h3>Rekapitulasi Saldo Piutang</h3>
        <div class="recap-grid">
          <div class="rc"><div class="lbl">Piutang Umum</div><div class="val">${rupiah(ring.umum.sisa)}</div><div class="sm">${ring.umum.aktif.length} tagihan belum lunas</div></div>
          <div class="rc"><div class="lbl">Piutang Sertifikasi</div><div class="val">${rupiah(ring.lain.sisa)}</div><div class="sm">${ring.lain.aktif.length} tagihan belum lunas</div></div>
          <div class="rc"><div class="lbl">Piutang Lainnya</div><div class="val">${rupiah(lainnyaSisa)}</div><div class="sm">${lainnyaRows.length} tagihan belum lunas</div></div>
          <div class="rc"><div class="lbl">Total Sisa Tagihan</div><div class="val" style="color:${sisaTotal > 0 ? 'var(--red)' : 'var(--green)'}">${rupiah(sisaTotal)}</div><div class="sm">saldo terhutang saat ini</div></div>
          <div class="rc"><div class="lbl">Sudah LUNAS</div><div class="val" style="color:var(--green)">${lunasCount}</div><div class="sm">transaksi berstatus LUNAS</div></div>
        </div>
        <div class="center mt-2"><a class="btn" href="${base}/portal-pegawai">${ui.icon('search')}Kembali ke Halaman Pencarian</a></div>
      </div>`;
  }

  post('/portal-pegawai/verifikasi', (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    const token = String(req.body.token || '');
    const kode = String(req.body.kode || '').trim();
    const hasil = dbm.otpVerify(token, kode);
    if (!hasil.ok) {
      const row = dbm.otpGet(token);
      return res.html(shell({
        base, settings, title: 'Verifikasi OTP', aktif: 'piutang',
        content: otpBlock({ base, kind: 'piutang', token, phone: row ? row.phone : '-', err: hasil.err })
      }));
    }
    const pg = db.prepare('SELECT * FROM pegawai WHERE id=?').get(Number(hasil.row.ref));
    if (!pg) {
      return res.html(shell({ base, settings, title: 'Data Tidak Ditemukan', aktif: 'piutang', content: searchBlock({ base, kind: 'piutang', err: 'Data pegawai tidak ditemukan.' }) }));
    }
    dbm.logAudit(null, 'PORTAL PIUTANG', 'piutang', `Portal publik: ${pg.nama} membuka rincian piutang via OTP WhatsApp`);
    res.html(shell({ base, settings, title: 'Rincian Piutang', aktif: 'piutang', content: piutangResult({ base, settings, pg }) }));
  });

  /* ================= PORTAL SLIP GAJI ================= */
  function slipDetail(r, periode, settings, pg) {
    const ekskul = db.prepare(`SELECT COALESCE(SUM(ROUND(kehadiran*harga_satuan)),0) s FROM ekskul_honor
      WHERE periode=? AND lower(nama_pembina)=lower(?)`).get(periode, r.nama).s;
    const masuk = [
      ['Gaji / Honor Mengajar', r.honorMengajar],
      ['Tunjangan Jabatan', r.tunjangan_jabatan],
      ['Tunjangan Masa Kerja', r.tunjangan_masa_kerja],
      ['Lembur', r.lembur],
      ['Tambahan Penghasilan', r.tambahan_penghasilan],
      ['Tunjangan Kepsek/Wakasek', r.tunjangan_khusus],
      [`Pembantu Kepsek (${Number(r.jam_pembantu_kepsek) || 0} jam)`, r.pembantuKepsek],
      [`Wali Kelas (${Number(r.jam_wali_kelas) || 0} jam)`, r.waliKelas],
      ['Honor Pembina Ekstrakurikuler', Number(ekskul) || 0]
    ].filter(([, v]) => Number(v) > 0);
    const keluar = [
      ['Potongan Jam Telat (75%)', r.potTelat],
      ['Dana Sosial', r.pot_dana_sosial],
      ['BPJS Kesehatan', r.pot_bpjs_kes],
      ['BPJS Ketenagakerjaan', r.pot_bpjs_tk],
      ['Penyesuaian Sertifikasi', r.sertifikasi],
      ['Kasbon / Potongan Piutang', r.pot_kasbon]
    ].filter(([, v]) => Number(v) > 0);
    const totalMasuk = masuk.reduce((a, [, v]) => a + Number(v), 0);
    const totalKeluar = keluar.reduce((a, [, v]) => a + Number(v), 0);
    const diterima = totalMasuk - totalKeluar;
    const baris = Math.max(masuk.length, keluar.length, 1);
    const rows = [];
    for (let i = 0; i < baris; i++) {
      const a = masuk[i] || ['', null], b = keluar[i] || ['', null];
      rows.push(`<tr><td>${a[1] !== null ? esc(a[0]) : '<span class="muted">—</span>'}</td>
        <td class="num">${a[1] !== null ? rupiah(a[1]) : ''}</td>
        <td>${b[1] !== null ? esc(b[0]) : '<span class="muted">—</span>'}</td>
        <td class="num">${b[1] !== null ? rupiah(b[1]) : ''}</td></tr>`);
    }
    return `<div class="slip-card">
      <div class="slip-card-head">
        <div>
          <div class="sc-title">Slip Gaji / Honor</div>
          <div class="muted small">${esc(pg ? pg.nama : r.nama)} · ${esc(r.jabatan || '-')}${r.tipe === 'tu' ? ' (TU)' : ' (Guru)'}</div>
        </div>
        <div class="sc-period">${esc(dbm.periodeLabel(periode))}</div>
      </div>
      <div class="table-wrap">
        <table class="tbl-modern slip-detail">
          <thead><tr><th>Komponen Penerimaan</th><th class="num">Nominal</th><th>Komponen Pengurangan</th><th class="num">Nominal</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
          <tfoot><tr><td>Total Pemasukan</td><td class="num">${rupiah(totalMasuk)}</td>
            <td>Total Pengurangan</td><td class="num">${rupiah(totalKeluar)}</td></tr></tfoot>
        </table>
      </div>
      <div class="slip-total"><span>TOTAL DITERIMA</span><span class="big">${rupiah(diterima)}</span></div>
    </div>`;
  }

  /* ---------- pemilih periode (bulan & tahun) slip gaji ---------- */
  const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const bulanNama = m => NAMA_BULAN[(Number(m) - 1 + 12) % 12] || '-';
  /**
   * Satu baris leger untuk (pegawai, periode).
   * Bila ada baris ganda pada periode yang sama (mis. hasil "Tarik Pegawai" + input manual),
   * dipilih baris yang paling berisi (nilai penerimaan terbesar) agar slip tidak menampilkan
   * baris kosong.
   */
  function slipRowOf(nama, periode) {
    return db.prepare(`SELECT * FROM payroll WHERE lower(nama)=lower(?) AND periode=?
      ORDER BY (COALESCE(jam_efektif,0)*COALESCE(honor_jam,0)
        + COALESCE(tunjangan_jabatan,0) + COALESCE(tunjangan_masa_kerja,0) + COALESCE(lembur,0)
        + COALESCE(tambahan_penghasilan,0) + COALESCE(tunjangan_khusus,0)) DESC, id DESC
      LIMIT 1`).get(nama, periode);
  }
  /** semua periode (YYYY-MM) yang punya record leger untuk pegawai ini, terbaru di atas */
  function slipPeriodsOf(nama) {
    let rows = [];
    try {
      rows = db.prepare(`SELECT DISTINCT periode FROM payroll WHERE lower(nama)=lower(?) AND periode GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        ORDER BY periode DESC`).all(nama);
    } catch (e) { rows = []; }
    return rows.map(r => String(r.periode)).filter(Boolean);
  }
  const nowPeriode = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  /**
   * Periode aktif: ?periode=YYYY-MM → dipakai apa adanya (walau kosong, agar pesan
   * "belum tersedia" bisa tampil); tanpa parameter → bulan berjalan bila ada datanya,
   * selain itu periode terakhir yang tersedia (agar halaman tidak kosong saat pertama masuk).
   */
  function pickPeriode(nama, raw) {
    const list = slipPeriodsOf(nama);
    const cur = nowPeriode();
    const q = /^\d{4}-\d{2}$/.test(String(raw || '')) ? String(raw) : '';
    if (q) return { periode: q, list, auto: false };
    if (list.includes(cur)) return { periode: cur, list, auto: true };
    return { periode: list[0] || cur, list, auto: true };
  }
  function periodeLabelID(p) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(p || ''));
    if (!m) return String(p || '-');
    return `${bulanNama(Number(m[2]))} ${m[1]}`;
  }
  /** dua dropdown: [Bulan] + [Tahun / Tahun Pelajaran] — otomatis submit (data-autosubmit) */
  function periodePicker({ base, token, periode, list }) {
    const p = /^(\d{4})-(\d{2})$/.exec(String(periode || '')) || [];
    const selBulan = Number(p[2]) || new Date().getMonth() + 1;
    const selTahun = Number(p[1]) || new Date().getFullYear();
    const years = new Set([selTahun, new Date().getFullYear(), new Date().getFullYear() - 1]);
    for (const it of list) { const y = Number(String(it).slice(0, 4)); if (y) years.add(y); }
    const yearList = [...years].sort((a, b) => b - a);
    const adaData = new Set(list);
    const opsiBulan = Array.from({ length: 12 }).map((_, i) => {
      const b = i + 1;
      const ada = adaData.has(`${selTahun}-${String(b).padStart(2, '0')}`);
      return `<option value="${b}" ${b === selBulan ? 'selected' : ''}>${bulanNama(b)}${ada ? ' •' : ''}</option>`;
    }).join('');
    return `<form method="get" action="${base}/portal-slip/hasil" class="portal-period">
      <input type="hidden" name="token" value="${esc(token)}">
      <div class="field" style="margin:0"><label>Bulan</label>
        <select name="bulan" data-autosubmit aria-label="Pilih bulan slip gaji">${opsiBulan}</select></div>
      <div class="field" style="margin:0"><label>Tahun / Tahun Pelajaran</label>
        <select name="tahun" data-autosubmit aria-label="Pilih tahun slip gaji">
          ${yearList.map(y => `<option value="${y}" ${y === selTahun ? 'selected' : ''}>${y}${adaData.has(`${y}-07`) || [...adaData].some(x => x.startsWith(y + '-')) ? ' •' : ''}</option>`).join('')}
        </select></div>
      <noscript><button class="btn btn-sm">${ui.icon('search')}Tampilkan</button></noscript>
    </form>
    <div class="help small" style="margin-top:6px">Periode <b>•</b> = data slip gaji sudah tersedia. Pilihan tersimpan pada kombinasi bulan &amp; tahun di atas.</div>`;
  }

  function slipResult({ base, settings, pg, token, periode: periodeRaw }) {
    const pick = pickPeriode(pg.nama, periodeRaw);
    const periode = pick.periode;
    const rec = slipRowOf(pg.nama, periode);
    const data = rec ? { ...rec, ...dbm.payrollCalc(rec) } : null;
    const labelPeriode = periodeLabelID(periode);
    const head = `<div class="portal-card">
      <div class="portal-student">
        <div><div class="pname">${esc(pg.nama)}</div>
          <div class="muted small">${esc(pg.jabatan || '-')} · ${pg.tipe === 'tu' ? 'Tata Usaha' : 'Guru'}</div></div>
        <div style="text-align:right">
          <div class="badge ${data ? 'green' : 'gray'}">Periode aktif: ${esc(labelPeriode)}</div>
          <div style="margin-top:6px">
            <a class="btn btn-primary btn-sm" href="${base}/portal-slip/cetak?token=${encodeURIComponent(token)}&periode=${encodeURIComponent(periode)}" target="_blank">${ui.icon('printer')}Cetak Slip ${esc(labelPeriode)}</a>
          </div>
        </div>
      </div>
      ${periodePicker({ base, token, periode, list: pick.list })}
      ${pick.auto && pick.periode !== nowPeriode()
        ? `<div class="help small" style="margin-top:8px">${ui.icon('info')} Default menampilkan <b>periode bulan berjalan (${esc(periodeLabelID(nowPeriode()))})</b>;
            karena belum tersedia, sistem menampilkan <b>periode terakhir yang ada datanya (${esc(labelPeriode)})</b>.</div>`
        : (pick.auto ? `<div class="help small" style="margin-top:8px">${ui.icon('check')} Menampilkan <b>periode bulan berjalan (${esc(labelPeriode)})</b>.</div>` : '')}
      ${pick.list.length ? '' : '<div class="empty"><p>Belum ada data slip gaji tercatat untuk Anda.</p></div>'}
    </div>`;
    const body = `<div class="portal-card">
      <h3>Rincian Slip Gaji / Honor — ${esc(labelPeriode)}</h3>
      ${data ? slipDetail(data, periode, settings, pg)
        : `<div class="alert info">${ui.icon('info')}<div><b>Data slip gaji untuk periode ${esc(labelPeriode)} belum tersedia.</b><br>
            <span class="small">Slip gaji periode ini belum diinput oleh Bendahara sekolah. Silakan pilih periode lain pada dropdown di atas,
            atau hubungi bendahara sekolah bila Anda merasa ini keliru.</span></div></div>`}
      <div class="center mt-2"><a class="btn" href="${base}/portal-slip">${ui.icon('search')}Kembali ke Halaman Pencarian</a></div>
    </div>`;
    return head + body;
  }

  /** halaman hasil dengan pemilih periode (dipakai juga saat ganti dropdown) */
  get('/portal-slip/hasil', (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    if (dbm.getSetting('portal_slip_aktif', '1') !== '1') {
      return res.html(closedBlock(settings, base, 'Portal slip gaji sedang dinonaktifkan.', 'slip'));
    }
    const row = dbm.otpGet(req.query.get('token'));
    if (!row || !row.verified || row.jenis !== 'slip') {
      return res.html(shell({
        base, settings, title: 'Akses Kedaluwarsa', aktif: 'slip',
        content: searchBlock({ base, kind: 'slip', err: 'Sesi verifikasi tidak valid atau sudah kedaluwarsa. Silakan ulangi pencarian.' })
      }));
    }
    const pg = db.prepare('SELECT * FROM pegawai WHERE id=?').get(Number(row.ref));
    if (!pg) return res.redirect(base + '/portal-slip');
    const bulan = Number(req.query.get('bulan') || 0);
    const tahun = Number(req.query.get('tahun') || 0);
    const periodeParam = (bulan >= 1 && bulan <= 12 && tahun >= 2000)
      ? `${tahun}-${String(bulan).padStart(2, '0')}`
      : (req.query.get('periode') || '');
    res.html(shell({
      base, settings, title: 'Slip Gaji ' + periodeLabelID(periodeParam || nowPeriode()), aktif: 'slip',
      content: slipResult({ base, settings, pg, token: row.token, periode: periodeParam })
    }));
  });

  get('/portal-slip', (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    if (dbm.getSetting('portal_slip_aktif', '1') !== '1') {
      return res.html(closedBlock(settings, base, 'Pengelola sekolah menonaktifkan portal slip gaji. Silakan hubungi bendahara sekolah.', 'slip'));
    }
    res.html(shell({ base, settings, title: 'Slip Gaji Pegawai', aktif: 'slip', content: searchBlock({ base, kind: 'slip' }) }));
  });

  post('/portal-slip/otp', async (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    if (dbm.getSetting('portal_slip_aktif', '1') !== '1') {
      return res.html(closedBlock(settings, base, 'Portal slip gaji sedang dinonaktifkan.', 'slip'));
    }
    const nama = String(req.body.nama || '').trim();
    const lahir = String(req.body.lahir || '').slice(0, 10);
    const err = msg => res.html(shell({ base, settings, title: 'Slip Gaji Pegawai', aktif: 'slip', content: searchBlock({ base, kind: 'slip', nama, lahir, err: msg }) }));
    if (!nama || !/^\d{4}-\d{2}-\d{2}$/.test(lahir)) return err('Nama dan tanggal lahir wajib diisi dengan benar.');
    const cands = pegawaiBy(nama, lahir);
    if (!cands.length) return err('Data pegawai tidak ditemukan. Pastikan nama & tanggal lahir sama dengan data sekolah.');
    const pg = cands[0];
    // nomor WhatsApp TIDAK lagi diisi manual — memakai nomor yang tersimpan pada master pegawai
    const phone = normPhone(pg.whatsapp);
    if (!phone) {
      return res.html(shell({
        base, settings, title: 'Nomor WhatsApp Belum Terdaftar', aktif: 'slip',
        content: `<div class="portal-card"><h2>Nomor WhatsApp belum terdaftar</h2>
          <p class="muted">Nomor WhatsApp aktif pegawai <b>${esc(pg.nama)}</b> belum tercatat pada master data sekolah, sehingga kode OTP tidak dapat dikirim.
          Silakan hubungi <b>bendahara sekolah</b> untuk memperbarui nomor WhatsApp Anda.</p>
          <div class="center mt-2"><a class="btn" href="${base}/portal-slip">Kembali ke Halaman Pencarian</a></div></div>`
      }));
    }
    const o = dbm.otpCreate('slip', String(pg.id), phone, 10);
    const sent = await wa.sendWA(phone, wa.otpMessage({
      kode: o.kode, keperluan: 'Slip Gaji Pegawai', sekolah: settings.sekolah_nama || 'Sekolah', menit: 10
    }));
    const demoKode = (!sent.ok && dbm.getSetting('wa_demo_tampil', '1') === '1') ? o.kode : '';
    res.html(shell({
      base, settings, title: 'Verifikasi OTP', aktif: 'slip',
      content: otpBlock({ base, kind: 'slip', token: o.token, phone, pesan: sent.ok ? 'Kode OTP berhasil dikirim via WhatsApp.' : (sent.reason || ''), demoKode })
    }));
  });

  post('/portal-slip/verifikasi', (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    const token = String(req.body.token || '');
    const hasil = dbm.otpVerify(token, String(req.body.kode || '').trim());
    if (!hasil.ok) {
      const row = dbm.otpGet(token);
      return res.html(shell({
        base, settings, title: 'Verifikasi OTP', aktif: 'slip',
        content: otpBlock({ base, kind: 'slip', token, phone: row ? row.phone : '-', err: hasil.err })
      }));
    }
    const pg = db.prepare('SELECT * FROM pegawai WHERE id=?').get(Number(hasil.row.ref));
    if (!pg) {
      return res.html(shell({ base, settings, title: 'Data Tidak Ditemukan', aktif: 'slip', content: searchBlock({ base, kind: 'slip', err: 'Data pegawai tidak ditemukan.' }) }));
    }
    dbm.logAudit(null, 'PORTAL SLIP', 'payroll', `Portal publik: ${pg.nama} membuka slip gaji via OTP WhatsApp`);
    const pick = pickPeriode(pg.nama, '');
    res.html(shell({
      base, settings, title: 'Slip Gaji ' + periodeLabelID(pick.periode), aktif: 'slip',
      content: slipResult({ base, settings, pg, token: hasil.row.token || token, periode: '' })
    }));
  });

  /* cetak semua slip pegawai (hasil verifikasi OTP) */
  get('/portal-slip/cetak', (req, res) => {
    const settings = dbm.settingsAll();
    const base = req.BASE;
    const row = dbm.otpGet(req.query.get('token'));
    if (!row || !row.verified || row.jenis !== 'slip') {
      return res.html(shell({ base, settings, title: 'Akses Kedaluwarsa', aktif: 'slip', content: searchBlock({ base, kind: 'slip', err: 'Sesi verifikasi tidak valid atau sudah kedaluwarsa. Silakan ulangi pencarian.' }) }));
    }
    const pg = db.prepare('SELECT * FROM pegawai WHERE id=?').get(Number(row.ref));
    if (!pg) return res.redirect(base + '/portal-slip');
    /* cetak SESUAI periode terpilih (bulan & tahun pada dropdown portal).
       Tanpa parameter periode → cetak periode default (bulan berjalan / terakhir tersedia). */
    const cetakPeriode = String(req.query.get('periode') || '');
    const pick = pickPeriode(pg.nama, cetakPeriode);
    const periodeAktif = pick.periode;
    const labelCetak = periodeLabelID(periodeAktif);
    const recCetak = slipRowOf(pg.nama, periodeAktif);
    const rows = recCetak ? [{ ...recCetak, ...dbm.payrollCalc(recCetak) }] : [];
    const money = v => (Number(v) ? num(v) : '');
    const logo = settings.sekolah_logo ? `<img src="${esc(settings.sekolah_logo)}" alt="Logo">` : `<div class="ph">${esc((settings.sekolah_nama || 'S').charAt(0))}</div>`;
    const alamat = String(settings.sekolah_alamat || '').split('\n')[0];
    const body = rows.length ? rows.map(r => {
      const ekskul = db.prepare(`SELECT COALESCE(SUM(ROUND(kehadiran*harga_satuan)),0) s FROM ekskul_honor WHERE periode=? AND lower(nama_pembina)=lower(?)`).get(r.periode, r.nama).s;
      const items = [
        ['Gaji / Honor Mengajar', r.honorMengajar], ['Tunjangan Jabatan', r.tunjangan_jabatan],
        ['Tunjangan Masa Kerja', r.tunjangan_masa_kerja], ['Lembur', r.lembur],
        ['Tambahan Penghasilan', r.tambahan_penghasilan], ['Tunjangan Kepsek/Wakasek', r.tunjangan_khusus],
        [`Pembantu Kepsek (${Number(r.jam_pembantu_kepsek) || 0} jam)`, r.pembantuKepsek],
        [`Wali Kelas (${Number(r.jam_wali_kelas) || 0} jam)`, r.waliKelas],
        ['Honor Pembina Ekstrakurikuler', Number(ekskul) || 0]
      ].filter(([, v]) => Number(v) > 0);
      const pots = [
        ['Potongan Jam Telat (75%)', r.potTelat], ['Dana Sosial', r.pot_dana_sosial],
        ['BPJS Kesehatan', r.pot_bpjs_kes], ['BPJS Ketenagakerjaan', r.pot_bpjs_tk],
        ['Penyesuaian Sertifikasi', r.sertifikasi], ['Kasbon / Potongan Piutang', r.pot_kasbon]
      ].filter(([, v]) => Number(v) > 0);
      const totalMasuk = items.reduce((a, [, v]) => a + Number(v), 0);
      const totalKeluar = pots.reduce((a, [, v]) => a + Number(v), 0);
      return `<div class="slip-doc">
        <div class="slip-kop">${logo}<div><div class="nm">${esc(settings.sekolah_nama || 'NAMA SEKOLAH')}</div><div class="al">${esc(alamat)}</div></div></div>
        <div class="slip-title">SLIP GAJI PEGAWAI — PERIODE: ${esc(periodeLabelID(r.periode).toUpperCase())}</div>
        <div class="slip-meta">Nama: <b>${esc(r.nama)}</b> · Jabatan: ${esc(r.jabatan || '-')}${r.tipe === 'tu' ? ' (TU)' : ' (Guru)'}</div>
        <table class="slip-tbl"><tbody>
          <tr class="sec"><td colspan="2">Penerimaan</td></tr>
          ${items.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="r">${money(v)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
          <tr class="tot"><td>Total Penerimaan</td><td class="r">${money(totalMasuk)}</td></tr>
          <tr class="sec"><td colspan="2">Pengurangan</td></tr>
          ${pots.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="r">${money(v)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
          <tr class="tot"><td>Total Pengurangan</td><td class="r">${money(totalKeluar)}</td></tr>
        </tbody></table>
        <div class="slip-gt"><span>TOTAL DITERIMA</span><span>${rupiah(totalMasuk - totalKeluar)}</span></div>
      </div>`;
    }).join('') : `<div class="slip-doc" style="text-align:center">
        <div class="slip-kop">${logo}<div><div class="nm">${esc(settings.sekolah_nama || 'NAMA SEKOLAH')}</div><div class="al">${esc(alamat)}</div></div></div>
        <div class="slip-title">SLIP GAJI PEGAWAI — PERIODE: ${esc(labelCetak.toUpperCase())}</div>
        <p style="margin:6mm 0">Data slip gaji untuk periode <b>${esc(labelCetak)}</b> belum tersedia.</p>
      </div>`;
    const slOrient = printcfg.orient(req, dbm, 'slip_honor');
    res.html(ui.printPage({
      settings, base, title: `Slip Gaji ${pg.nama} — ${labelCetak}`,
      body, backHref: `/portal-slip/hasil?token=${encodeURIComponent(row.token)}&periode=${encodeURIComponent(periodeAktif)}`,
      backLabel: 'Kembali ke Portal',
      orient: slOrient, selfPath: req.url,
      pageCss: `@page{size:A4 ${slOrient === 'landscape' ? 'landscape' : 'portrait'};margin:10mm}
        .print-area{padding:0;background:#fff}
        .slip-doc{border:1px solid #444;border-radius:3mm;padding:5mm 6mm;margin-bottom:6mm;page-break-inside:avoid;background:#fff;font-size:9.5pt}
        .slip-kop{display:flex;gap:3mm;align-items:center;border-bottom:2px solid #333;padding-bottom:2mm;margin-bottom:2mm}
        .slip-kop img{width:14mm;height:14mm;object-fit:contain}
        .slip-kop .ph{width:14mm;height:14mm;border-radius:50%;background:#F97316;color:#fff;display:grid;place-items:center;font-weight:800}
        .slip-kop .nm{font-weight:800;font-size:11pt}
        .slip-kop .al{font-size:7.5pt;color:#555}
        .slip-title{text-align:center;font-weight:800;letter-spacing:.05em;margin:1.5mm 0}
        .slip-meta{font-size:8.6pt;margin-bottom:2mm}
        .slip-tbl{width:100%;border-collapse:collapse;font-size:8.8pt}
        .slip-tbl td{padding:.9mm 1.4mm;border-bottom:.5px dotted #bbb}
        .slip-tbl .r{text-align:right;white-space:nowrap}
        .slip-tbl .sec td{background:#FBEFE5;font-weight:800;font-size:8.4pt;border-bottom:.6px solid #999}
        .slip-tbl .tot td{font-weight:800;border-top:.8px solid #666;border-bottom:none}
        .slip-gt{display:flex;justify-content:space-between;background:#FFF3E6;border:1px solid #E0B98F;border-radius:2mm;padding:2mm 3mm;margin-top:2mm;font-weight:800}
        .slip-sign{display:flex;justify-content:space-between;margin-top:8mm;font-size:8.4pt;text-align:center}
        .slip-sign > div{min-width:55mm}
        .slip-sign .sp{height:13mm}`
    }));
  });
};
