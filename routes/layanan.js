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

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, uploadMedia, flashUrl, saas }) => {
  const { esc, rupiah, tglID, nowStamp } = lib;

  const durasiLabel = d => (Number(d) >= 365 ? '12 Bulan (+365 hari)' : '1 Bulan (+30 hari)');
  const pkgName = kode => { const p = saas.packageByKode(kode); return p ? p.nama : (kode || '-'); };
  const pkgPrice = (kode, d) => saas.packagePrice(kode, d);

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
              · Paket <b>${esc(pkgName(t.paket))}</b></div>
          </div>
        </div>
        <div class="list">
          ${infoRow('Status', statusBadge(st))}
          ${infoRow('Tanggal Register', esc(tglID(t.registered_at || '-')))}
          ${infoRow('Paket Langganan', esc(pkgName(t.paket)) + ` <span class="t-sub">(${lifetime ? 'Lifetime' : 'berlangganan'})</span>`)}
          ${infoRow('Nominal Tagihan', tagihanTerbit
        ? `<b>${rupiah(nominal)}</b> <span class="badge amber plain">tagihan terbit ${esc(tglID(String(tagihanTerbit.program || tagihanTerbit.dibuat_at || '').slice(0, 10)))}</span>`
        : `<b>${rupiah(nominal)}</b> / bulan <span class="t-sub">· ${rupiah(saas.priceOf(365))} / tahun</span>`)}
          ${infoRow('Tanggal Kadaluarsa', lifetime ? '<b>Aktif (Lifetime)</b> — tidak ada kadaluarsa' : `<b>${esc(tglID(t.expires_at || '-'))}</b> <span class="t-sub">${esc(sisaHari(st))}</span>`)}
        </div>
        ${lifetime
        ? `<div class="alert ok mt-2">${ui.icon('check')}<div><b>Akses Gratis / Seumur Hidup.</b> Sekolah ini dibebaskan dari penagihan perpanjangan dan tidak akan pernah ditangguhkan otomatis.</div></div>`
        : `<div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
              <a class="btn btn-primary" href="${c.base}/perpanjang">${ui.icon('refresh')}Perpanjang Masa Aktif</a>
              <a class="btn" href="${c.base}/info-layanan/paket">${ui.icon('layers')}Upgrade Paket</a>
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
    </div>`;

    page(req, res, { title: 'Info Layanan', sub: 'Status langganan, tagihan & paket', active: 'layanan', content });
  });

  /* ---------------- Upgrade / ganti paket langganan ---------------- */
  get('/info-layanan/paket', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const c = ctx(req);
    const t = req.tenant;
    const current = saas.packageByKode(t.paket) || saas.defaultPackage();
    const list = saas.packageRows();
    const pending = saas.pendingPayment(t.id);
    const content = `<div class="card mb-3">
      <div class="card-head"><div><h3>${ui.icon('layers', 'i-sm')} Paket Langganan</h3>
        <div class="sub">Paket aktif: <b>${esc(current.nama)}</b> (${esc(current.keterangan || '')})</div></div>
        ${ui.badge(current.nama, 'blue')}</div>
      ${Number(t.is_lifetime_free) ? `<div class="alert ok">${ui.icon('check')}<div><b>Akses Lifetime.</b> Paket tidak memengaruhi masa aktif — semua fitur tetap bisa dipakai sesuai pengaturan Super Admin.</div></div>` : ''}
      ${pending ? `<div class="alert warn">${ui.icon('clock')}<div>Masih ada pengajuan pembayaran yang menunggu verifikasi. Selesaikan dulu sebelum mengganti paket.</div></div>` : ''}
      <div class="pk-grid">
        ${list.map(p => `<div class="card pk-card ${p.kode === current.kode ? 'on' : ''}">
          <div class="between"><div class="t-strong" style="font-size:16px">${esc(p.nama)}</div>
            ${p.kode === current.kode ? ui.badge('Aktif', 'green') : ''}</div>
          <div class="small muted" style="margin:6px 0 10px">${esc(p.keterangan || '')}</div>
          <div class="pk-price">${rupiah(p.harga_bulan)}<span class="t-sub"> / bulan</span></div>
          <div class="small muted">${rupiah(p.harga_tahun)} / 12 bulan</div>
          ${p.kode === current.kode ? '' : `<a class="btn btn-primary btn-block mt-2" href="${c.base}/perpanjang?paket=${encodeURIComponent(p.kode)}">${ui.icon('refresh')}Pilih ${esc(p.nama)}</a>`}
        </div>`).join('')}
      </div>
      <p class="help mt-2">Perubahan paket diproses bersama perpanjangan: pilih paket → bayar via QRIS → Super Admin memverifikasi →
        paket &amp; masa aktif langsung diperbarui.</p>
    </div>`;
    page(req, res, { title: 'Paket Langganan', sub: 'Upgrade paket & fitur sekolah', active: 'layanan', content });
  });

  /* ---------------- Checkout perpanjangan (QRIS manual) ---------------- */
  get('/perpanjang', (req, res) => {
    guard(req, res, 'dashboard', 'view');
    const c = ctx(req);
    const t = req.tenant;
    const lifetime = !!Number(t.is_lifetime_free);
    const pending = saas.pendingPayment(t.id);
    const pkgList = saas.packageRows();
    const paketSel = String(req.query.get('paket') || '').trim().toLowerCase();
    const paketTujuan = (paketSel && saas.packageByKode(paketSel)) ? saas.packageByKode(paketSel)
      : (saas.packageByKode(t.paket) || saas.defaultPackage());
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
              <div class="field"><label>Paket Langganan</label>
                <select name="paket">
                  ${pkgList.map(p => `<option value="${esc(p.kode)}" ${p.kode === paketTujuan.kode ? 'selected' : ''}>${esc(p.nama)} — ${rupiah(p.harga_bulan)}/bln${p.kode === t.paket ? ' (paket aktif)' : ''}</option>`).join('')}
                </select></div>
              <div class="field"><label>Durasi Perpanjangan</label>
                <div class="opt-list">
                  <label class="opt"><input type="radio" name="durasi" value="30" checked>
                    <span><b>1 Bulan</b> (+30 hari) · ${rupiah(pkgPrice(paketTujuan.kode, 30))}</span></label>
                  <label class="opt"><input type="radio" name="durasi" value="365">
                    <span><b>12 Bulan</b> (+365 hari) · ${rupiah(pkgPrice(paketTujuan.kode, 365))} <em class="t-sub">lebih hemat</em></span></label>
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
            <div class="list-row"><div><div class="mt">Paket dipilih</div><div class="nm">${esc(paketTujuan.nama)}</div></div></div>
            <div class="list-row"><div><div class="mt">Nominal 1 bulan</div><div class="nm">${rupiah(pkgPrice(paketTujuan.kode, 30))}</div></div></div>
            <div class="list-row"><div><div class="mt">Nominal 12 bulan</div><div class="nm">${rupiah(pkgPrice(paketTujuan.kode, 365))}</div></div></div>
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
      const paket = String(req.body.paket || '').trim().toLowerCase();
      const id = saas.submitPayment(t.id, {
        durasi, bukti_url: url, paket,
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
