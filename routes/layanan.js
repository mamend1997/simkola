'use strict';
/**
 * ==================================================================
 * INFO LAYANAN & PERPANJANGAN MANDIRI (sisi sekolah/tenant)
 * ------------------------------------------------------------------
 * · /info-layanan  → kartu status langganan, tagihan, riwayat pembayaran,
 *                    pengaturan auto-backup database via email
 * · /perpanjang    → checkout QRIS manual + unggah bukti transfer
 * ==================================================================
 */
const mailer = require('../mailer');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, uploadMedia, flashUrl, saas }) => {
  const { esc, rupiah, tglID, nowStamp } = lib;

  const durasiLabel = d => (Number(d) >= 365 ? '12 Bulan (+365 hari)' : '1 Bulan (+30 hari)');

  function statusBadge(st) {
    return ui.badge(st.label, st.color === 'red' ? 'red' : st.color === 'amber' ? 'amber' : st.color === 'blue' ? 'blue' : 'green');
  }

  function sisaHari(st) {
    if (st.key === 'lifetime') return 'Berlaku selamanya — bebas tagihan perpanjangan.';
    if (st.daysLeft === null) return 'Tanggal berakhir belum ditetapkan.';
    if (st.daysLeft < 0) return `Sudah berakhir ${Math.abs(st.daysLeft)} hari lalu.`;
    if (st.daysLeft === 0) return 'Berakhir hari ini.';
    return `Sisa ${st.daysLeft} hari lagi.`;
  }

  /* ---------------- Info Layanan ---------------- */
  get('/info-layanan', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const c = ctx(req);
    const t = req.tenant;
    const st = saas.statusOf(t);
    const lifetime = !!Number(t.is_lifetime_free);
    const pending = saas.pendingPayment(t.id);
    const rejected = saas.latestRejected(t.id);
    const riwayat = saas.paymentsOf(t.id, 12);
    // tagihan yang sudah diterbitkan cron (belum dibayar) menjadi nominal tagihan berjalan
    const tagihanTerbit = saas.db.prepare("SELECT * FROM saas_payments WHERE tenant_id=? AND status='issued' ORDER BY id DESC LIMIT 1").get(t.id);
    const logo = dbm.getSetting('sekolah_logo', '') || t.logo || '';
    const nominal = tagihanTerbit && Number(tagihanTerbit.nominal) ? Number(tagihanTerbit.nominal) : saas.priceOf(30);
    const mcfg = mailer.tenantMailConfig(dbm);
    let logRows = [];
    try {
      logRows = dbm.db.prepare("SELECT * FROM cloud_backup WHERE pemicu IN ('jadwal','manual','email') ORDER BY id DESC LIMIT 6").all();
    } catch (e) { logRows = []; }

    const infoRow = (label, value) => `<div class="list-row"><div><div class="mt">${esc(label)}</div><div class="nm">${value}</div></div></div>`;

    const content = `<div class="split">
      <div class="card">
        <div class="card-head">
          <div><h3>${ui.icon('shield', 'i-sm')} Info Layanan Sekolah</h3><div class="sub">Status langganan & masa aktif layanan</div></div>
          ${statusBadge(st)}
        </div>
        <div class="flex" style="gap:18px;align-items:center;margin-bottom:10px">
          <div style="width:64px;height:64px;border-radius:18px;overflow:hidden;background:#fff;border:1px solid var(--line);display:grid;place-items:center">
            ${logo ? `<img src="${esc(logo)}" alt="Logo" style="width:100%;height:100%;object-fit:contain">` : ui.icon('school')}
          </div>
          <div>
            <div style="font-size:19px;font-weight:800;letter-spacing:-.02em">${esc(t.nama)}</div>
            <div class="small muted">Kode Sekolah <b class="mono" style="font-size:14px;letter-spacing:.14em">${esc(t.school_code)}</b>
              · Paket <b>${esc(saas.PAKET[t.paket] || t.paket)}</b></div>
          </div>
        </div>
        <div class="list">
          ${infoRow('Status', statusBadge(st))}
          ${infoRow('Tanggal Register', esc(tglID(t.registered_at || '-')))}
          ${infoRow('Paket Langganan', esc(saas.PAKET[t.paket] || t.paket) + ` <span class="t-sub">(${lifetime ? 'Lifetime' : 'berlangganan'})</span>`)}
          ${infoRow('Nominal Tagihan', tagihanTerbit
        ? `<b>${rupiah(nominal)}</b> <span class="badge amber plain">tagihan terbit ${esc(tglID(String(tagihanTerbit.program || tagihanTerbit.dibuat_at || '').slice(0, 10)))}</span>`
        : `<b>${rupiah(nominal)}</b> / bulan <span class="t-sub">· ${rupiah(saas.priceOf(365))} / tahun</span>`)}
          ${infoRow('Tanggal Kadaluarsa', lifetime ? '<b>Aktif (Lifetime)</b> — tidak ada kadaluarsa' : `<b>${esc(tglID(t.expires_at || '-'))}</b> <span class="t-sub">${esc(sisaHari(st))}</span>`)}
        </div>
        ${lifetime
        ? `<div class="alert ok mt-2">${ui.icon('check')}<div><b>Akses Gratis / Seumur Hidup.</b> Sekolah ini dibebaskan dari penagihan perpanjangan dan tidak akan pernah ditangguhkan otomatis.</div></div>`
        : `<div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
              <a class="btn btn-primary" href="${c.base}/perpanjang">${ui.icon('refresh')}Perpanjang Masa Aktif</a>
              ${pending ? `<span class="badge amber plain">Pengajuan sedang diverifikasi</span>` : ''}
            </div>`}
      </div>

      <div>
        ${rejected ? `<div class="card mb-3" style="border-color:#F6CFD0;background:#FFF8F8">
          <div class="card-head"><div><h3>Pengajuan Terakhir Ditolak</h3><div class="sub">${esc(tglID(rejected.direview_at || rejected.dibuat_at))}</div></div>${ui.badge('Ditolak', 'red')}</div>
          <div class="alert err">${ui.icon('alert')}<div><b>Alasan penolakan:</b> ${esc(rejected.alasan || '-')}</div></div>
          <a class="btn btn-primary btn-block" href="${c.base}/perpanjang">Unggah Ulang Bukti Pembayaran</a>
        </div>` : ''}
        ${pending ? `<div class="card mb-3" style="border-color:#F7DFB5;background:#FFFDF7">
          <div class="card-head"><div><h3>Menunggu Verifikasi Super Admin</h3><div class="sub">${esc(durasiLabel(pending.durasi))} · ${rupiah(pending.nominal)}</div></div>${ui.badge('PENDING', 'amber')}</div>
          <p class="small muted" style="margin:0">Pengajuan tanggal <b>${esc(tglID(pending.dibuat_at))}</b> sedang diperiksa. Tombol konfirmasi dikunci sampai ada keputusan.</p>
        </div>` : ''}
        <div class="card">
          <div class="card-head"><div><h3>Riwayat Tagihan & Pembayaran</h3><div class="sub">12 transaksi terakhir</div></div></div>
          <div class="table-wrap short"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Durasi</th><th class="num">Nominal</th><th>Status</th><th>Bukti</th></tr></thead><tbody>
          ${riwayat.length ? riwayat.map(p => `<tr>
            <td class="nowrap">${esc(tglID(p.dibuat_at || p.created_at))}</td>
            <td>${p.jenis === 'tagihan' ? 'Tagihan' : 'Perpanjangan'}</td>
            <td>${esc(p.durasi >= 365 ? '12 bulan' : '1 bulan')}</td>
            <td class="num">${rupiah(p.nominal)}</td>
            <td>${ui.badge((saas.PAY_STATUS[p.status] || {}).label || p.status, (saas.PAY_STATUS[p.status] || {}).color || 'gray')}</td>
            <td>${p.bukti_url ? `<a href="${esc(p.bukti_url)}" target="_blank" rel="noopener">Lihat</a>` : '-'}</td>
          </tr>`).join('') : `<tr><td colspan="6" class="muted" style="text-align:center;padding:18px">Belum ada transaksi.</td></tr>`}
          </tbody></table></div>
          ${riwayat.some(p => p.alasan) ? `<p class="help mt-1">Catatan: ${esc((riwayat.find(p => p.alasan) || {}).alasan || '')}</p>` : ''}
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-head"><div><h3>${ui.icon('database', 'i-sm')} Auto-Backup Database via Email</h3>
        <div class="sub">Berkas .zip dikirim 2× sehari (06:00 &amp; 15:00), lalu dihapus dari server</div></div>
        ${mcfg.aktif ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</div>
      <div class="alert info">${ui.icon('info')}<div>Gunakan <b>App Password</b> Gmail (bukan password akun) bila memakai Gmail.
        Format nama berkas: <code>Backup_SIMKEU_DDMMYYYY_HHMM.zip</code>. Berkas sementara langsung dihapus setelah email terkirim agar penyimpanan server tidak penuh.</div></div>
      <form method="post" action="${c.base}/info-layanan/mail">
        <div class="row2">
          <div class="field"><label>Email Penerima Backup</label><input type="email" name="mail_to" value="${esc(mcfg.to)}" placeholder="bendahara@sekolah.sch.id" required></div>
          <div class="field"><label>Email Pengirim (akun SMTP)</label><input type="email" name="mail_from" value="${esc(mcfg.from)}" placeholder="simkeu@gmail.com"></div>
        </div>
        <div class="row3">
          <div class="field"><label>SMTP Host</label><input type="text" name="mail_host" value="${esc(mcfg.host)}" placeholder="smtp.gmail.com"></div>
          <div class="field"><label>SMTP Port</label><input type="text" name="mail_port" value="${esc(mcfg.port)}" placeholder="587"></div>
          <div class="field"><label>Enkripsi</label>
            <select name="mail_secure">
              <option value="0" ${mcfg.secure === '0' ? 'selected' : ''}>STARTTLS (587)</option>
              <option value="1" ${mcfg.secure === '1' ? 'selected' : ''}>SSL/TLS (465)</option>
            </select></div>
        </div>
        <div class="row2">
          <div class="field"><label>Email Pengirim (akun SMTP)</label><input type="text" name="mail_user" value="${esc(mcfg.user)}" placeholder="simkeu@gmail.com"></div>
          <div class="field"><label>App Password</label><input type="password" name="mail_pass" value="${esc(mcfg.pass)}" placeholder="app password 16 karakter" autocomplete="new-password"></div>
        </div>
        <label class="check mb-2"><input type="checkbox" name="mail_aktif" value="1" ${mcfg.aktif ? 'checked' : ''}> Aktifkan pengiriman otomatis 06:00 &amp; 15:00</label>
        <div class="form-actions">
          <button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button>
        </div>
      </form>
      <div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
        <form method="post" action="${c.base}/info-layanan/mail/uji">${mailerButtons()}</form>
        <form method="post" action="${c.base}/info-layanan/mail/backup">${mailerButtons('primary')}</form>
      </div>
      <div class="table-wrap short mt-2"><table><thead><tr><th>Waktu</th><th>Berkas</th><th class="num">Ukuran</th><th>Status</th><th>Pesan</th></tr></thead><tbody>
        ${logRows.length ? logRows.map(r => `<tr>
          <td class="nowrap">${esc(r.waktu || '')}</td>
          <td class="mono small">${esc(r.nama_berkas || '-')}</td>
          <td class="num">${r.ukuran ? Math.round(r.ukuran / 1024) + ' KB' : '-'}</td>
          <td>${r.status === 'sukses' ? ui.badge('Sukses', 'green') : ui.badge('Gagal', 'red')}</td>
          <td class="small">${esc(r.pesan || '')}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">Belum ada riwayat pengiriman.</td></tr>`}
      </tbody></table></div>
    </div>`;

    page(req, res, { title: 'Info Layanan', sub: 'Status langganan, tagihan & backup email', active: 'layanan', content });
  });

  function mailerButtons(kind) {
    return kind === 'primary'
      ? `<button class="btn btn-primary">${ui.icon('upload')}Backup &amp; Kirim Sekarang</button>`
      : `<button class="btn">${ui.icon('check')}Uji Kirim Email</button>`;
  }

  post('/info-layanan/mail', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const b = req.body || {};
    try {
      const host = String(b.mail_host || '').trim();
      const port = Number(b.mail_port) || 587;
      const aktif = b.mail_aktif ? '1' : '0';
      if (aktif === '1') {
        const chk = mailer.validateConfig({ host, port, from: b.mail_from || b.mail_user, user: b.mail_user });
        if (chk) throw new Error(chk);
        if (!String(b.mail_to || '').trim()) throw new Error('Email penerima backup wajib diisi.');
      }
      const map = {
        mail_to: b.mail_to, mail_host: host, mail_port: port, mail_secure: b.mail_secure === '1' ? '1' : '0',
        mail_from: b.mail_from || b.mail_user, mail_user: b.mail_user, mail_pass: b.mail_pass, mail_aktif: aktif
      };
      for (const [k, v] of Object.entries(map)) dbm.setSetting(k, String(v ?? ''));
      dbm.logAudit(req.user, 'EDIT', 'backup', 'Memperbarui pengaturan auto-backup email');
      res.redirect(req.BASE + flashUrl('/info-layanan', 'ok', 'Pengaturan auto-backup email disimpan.'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/info-layanan', 'err', e.message));
    }
  });

  post('/info-layanan/mail/uji', async (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const to = mailer.tenantMailConfig(dbm).to;
    try {
      const cfg = mailer.tenantMailConfig(dbm);
      await mailer.send(
        { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from },
        {
          to, subject: 'Uji Kirim Email — ' + dbm.getSetting('sekolah_nama', 'Sekolah'), text:
            'Ini email uji dari ' + dbm.getSetting('sekolah_nama', 'Sekolah') + '.\nWaktu: ' + nowStamp() +
            '\n\nJika email ini diterima, pengaturan SMTP sudah benar dan backup otomatis 06:00 & 15:00 akan dikirim ke alamat ini.'
        }
      );
      res.redirect(req.BASE + flashUrl('/info-layanan', 'ok', 'Email uji berhasil dikirim ke ' + to + '.'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/info-layanan', 'err', 'Gagal kirim: ' + e.message));
    }
  });

  post('/info-layanan/mail/backup', async (req, res) => {
    guard(req, res, 'dashboard', 'view');
    try {
      const r = await mailer.sendTenantBackup(dbm, { trigger: 'manual', user: req.user.nama });
      res.redirect(req.BASE + flashUrl('/info-layanan', 'ok', `Backup ${r.nama} (${Math.round(r.ukuran / 1024)} KB) terkirim ke ${r.to}.`));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/info-layanan', 'err', 'Backup gagal: ' + e.message));
    }
  });

  /* ---------------- Checkout perpanjangan (QRIS manual) ---------------- */
  get('/perpanjang', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const c = ctx(req);
    const t = req.tenant;
    const lifetime = !!Number(t.is_lifetime_free);
    const pending = saas.pendingPayment(t.id);
    const qris = saas.get('qris_image', '');
    const nama = saas.get('qris_nama', '');
    const nomor = saas.get('qris_nomor', '');
    const instruksi = saas.get('qris_instruksi', '') || 'Unggah bukti transfer setelah membayar. Verifikasi maksimal 1x24 jam kerja.';

    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>Perpanjang Masa Aktif</h3><div class="sub">${esc(t.nama)} · ${esc(t.school_code)}</div></div></div>
        ${lifetime
        ? `<div class="alert ok">${ui.icon('check')}<div><b>Sekolah ini berstatus Lifetime.</b> Tidak perlu perpanjangan dan tidak akan ditagih.</div></div>
           <a class="btn btn-block" href="${c.base}/info-layanan">Kembali ke Info Layanan</a>`
        : pending
          ? `<div class="alert warn">${ui.icon('clock')}<div><b>Menunggu verifikasi.</b> Pengajuan tanggal ${esc(tglID(pending.dibuat_at))} (${esc(durasiLabel(pending.durasi))}) masih diproses. Form dikunci untuk mencegah pengiriman ganda.</div></div>
             <a class="btn btn-block" href="${c.base}/info-layanan">Lihat Status Pengajuan</a>`
          : `<form method="post" action="${c.base}/perpanjang">
              <div class="field"><label>Durasi Perpanjangan</label>
                <div class="opt-list">
                  <label class="opt"><input type="radio" name="durasi" value="30" checked>
                    <span><b>1 Bulan</b> (+30 hari) · ${rupiah(saas.priceOf(30))}</span></label>
                  <label class="opt"><input type="radio" name="durasi" value="365">
                    <span><b>12 Bulan</b> (+365 hari) · ${rupiah(saas.priceOf(365))} <em class="t-sub">lebih hemat</em></span></label>
                </div>
              </div>
              <div class="field"><label>Bukti Transfer (JPG/PNG, maks 5 MB)</label>
                <input type="file" accept="image/png,image/jpeg" data-b64="bukti_b64" data-max="5">
                <input type="hidden" name="bukti_b64" id="bukti_b64">
                <div class="hint" id="bukti_b64-info">Foto/screenshot bukti pembayaran QRIS atau DANA Bisnis.</div></div>
              <div class="row2">
                <div class="field"><label>Nama Pengirim</label><input type="text" name="pengirim" placeholder="Nama pada rekening pengirim"></div>
                <div class="field"><label>Catatan</label><input type="text" name="catatan" placeholder="Opsional, mis. no. referensi"></div>
              </div>
              <button class="btn btn-primary btn-block">${ui.icon('upload')}Kirim Konfirmasi Pembayaran</button>
            </form>`}
      </div>
      <div>
        <div class="card mb-3">
          <div class="card-head"><div><h3>Pembayaran QRIS / DANA</h3><div class="sub">Scan atau simpan gambar berikut</div></div></div>
          ${qris
        ? `<div style="text-align:center;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px">
                 <img src="${esc(qris)}" alt="QRIS" style="max-width:100%;max-height:340px;object-fit:contain">
               </div>
               <a class="btn btn-block mt-2" href="${c.base}/perpanjang/qris-unduh">${ui.icon('download')}Unduh QRIS</a>`
        : `<div class="alert warn">${ui.icon('alert')}<div>Gambar QRIS belum diunggah Super Admin. Hubungi layanan dukungan untuk instruksi pembayaran manual.</div></div>`}
          <div class="list mt-2">
            <div class="list-row"><div><div class="mt">Nama Pemilik</div><div class="nm">${esc(nama || '-')}</div></div></div>
            <div class="list-row"><div><div class="mt">Nomor Rekening / DANA</div><div class="nm mono">${esc(nomor || '-')}</div></div></div>
          </div>
          <div class="alert info mt-2">${ui.icon('info')}<div>${esc(instruksi)}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Ringkasan Tagihan</h3></div></div>
          <div class="list">
            <div class="list-row"><div><div class="mt">Nominal 1 bulan</div><div class="nm">${rupiah(saas.priceOf(30))}</div></div></div>
            <div class="list-row"><div><div class="mt">Nominal 12 bulan</div><div class="nm">${rupiah(saas.priceOf(365))}</div></div></div>
            <div class="list-row"><div><div class="mt">Masa aktif sekarang</div><div class="nm">${Number(t.is_lifetime_free) ? 'Lifetime' : esc(tglID(t.expires_at || '-'))}</div></div></div>
          </div>
          <p class="help mt-1">Perpanjangan dihitung dari tanggal berakhir terakhir (atau hari ini bila sudah lewat), bukan dari tanggal pembayaran.</p>
        </div>
      </div>
    </div>`;
    page(req, res, { title: 'Perpanjangan Masa Aktif', sub: 'Checkout pembayaran QRIS manual', active: 'layanan', content });
  });

  get('/perpanjang/qris-unduh', async (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const url = String(saas.get('qris_image', '') || '');
    if (!url) return res.redirect(req.BASE + flashUrl('/perpanjang', 'err', 'Gambar QRIS belum tersedia.'));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = (url.split('?')[0].match(/\.(png|jpe?g)$/i) || [, 'png'])[1].toLowerCase().replace('jpeg', 'jpg');
      res.file(buf, 'QRIS-' + (req.tenant.school_code || 'SEKOLAH') + '.' + ext, ext === 'png' ? 'image/png' : 'image/jpeg');
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/perpanjang', 'err', 'Gagal mengunduh QRIS: ' + e.message));
    }
  });

  post('/perpanjang', async (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const t = req.tenant;
    try {
      if (Number(t.is_lifetime_free)) throw new Error('Sekolah ini berstatus Lifetime — tidak perlu perpanjangan.');
      const durasi = Number(req.body.durasi) === 365 ? 365 : 30;
      const b64 = String(req.body.bukti_b64 || '');
      if (!b64) throw new Error('Bukti transfer wajib diunggah.');
      const m = b64.match(/^data:(image\/(png|jpe?g));base64,/i);
      if (!m) throw new Error('Bukti transfer harus berupa gambar JPG atau PNG.');
      const ext = m[2].toLowerCase().replace('jpeg', 'jpg');
      const url = await uploadMedia(b64, `bukti-${t.school_code}-${Date.now()}.${ext}`);
      const id = saas.submitPayment(t.id, {
        durasi, bukti_url: url,
        pengirim: req.body.pengirim, catatan: req.body.catatan
      });
      dbm.logAudit(req.user, 'PENGAJUAN', 'layanan', `Mengirim bukti perpanjangan ${durasi} hari (pengajuan #${id})`);
      res.redirect(req.BASE + flashUrl('/info-layanan', 'ok',
        'Konfirmasi pembayaran terkirim. Super Admin akan memverifikasi maksimal 1x24 jam kerja.'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/perpanjang', 'err', e.message));
    }
  });
};
