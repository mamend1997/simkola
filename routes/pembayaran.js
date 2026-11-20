'use strict';
/* =====================================================================
   PEMBAYARAN IURAN ONLINE (portal orang tua)
   ---------------------------------------------------------------------
   · /pembayaran-online        → pengaturan gateway sekolah + QRIS manual
   · /iuran/verifikasi         → setujui / tolak pembayaran manual
   · /notif/baca               → tandai notifikasi lonceng sudah dibaca
   Verifikasi pembayaran bawaan portal SELALU berakhir di Antrean Posting
   Iuran (baris iuran_bayar status 'pending') — lihat bayariuran.js.
   ===================================================================== */
const bayar = require('../bayariuran');
const paygw = require('../paygw');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, uploadMedia, flashUrl, saas }) => {
  const { esc, rupiah, tglID } = lib;
  const { db } = dbm;

  function safeBack(raw, def = '/iuran/antrean') {
    const s = String(raw || '');
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(s) && !s.startsWith('//') ? s : def;
  }
  const statusBadge = st => {
    const map = { menunggu: ['Menunggu Verifikasi', 'amber'], lunas: ['Lunas', 'green'], ditolak: ['Ditolak', 'red'], batal: ['Batal', 'gray'] };
    const b = map[st] || [st || '-', 'gray'];
    return ui.badge(b[0], b[1]);
  };

  /* ================= PENGATURAN PEMBAYARAN ONLINE ================= */
  get('/pembayaran-online', (req, res) => {
    guard(req, res, 'iuran', 'view');
    const c = ctx(req);
    bayar.ensureTables(dbm);
    const conf = bayar.cfg(dbm, saas);
    const pub = bayar.publicCfg(dbm, saas);
    const s = c.settings;
    const pending = bayar.listPending(dbm, { limit: 20 });
    const totalPending = pending.reduce((a, b) => a + Number(b.total || 0), 0);
    const portalUrl = c.publicAbsUrl('/' + dbm.portalSlugs().siswa);
    const editable = c.can('iuran', 'edit');

    const content = `<div class="grid split-2 mb-3">
      <div class="card">
        <div class="card-head"><div><h3>Status Pembayaran Online</h3>
          <div class="sub">Dua metode dapat dipakai bersamaan di portal orang tua</div></div></div>
        <table class="kv">
          <dt>Gateway (QRIS otomatis)</dt><dd>${pub.online ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}
            <div class="t-sub">${esc(pub.provider_label)} · sumber kredensial: ${conf.sumber === 'pusat' ? 'Gateway Pusat (Super Admin)' : conf.sumber === 'sekolah' ? 'Sekolah ini' : 'Belum dikonfigurasi'}</div></dd>
          <dt>Transfer manual + bukti</dt><dd>${pub.manual ? ui.badge('Aktif', 'green') : ui.badge('Nonaktif', 'gray')}</dd>
          <dt>Pembayaran menunggu</dt><dd>${pending.length} keranjang · ${rupiah(totalPending)}</dd>
          <dt>Portal orang tua</dt><dd><a href="${portalUrl}" target="_blank">${esc(portalUrl)}</a></dd>
        </table>
        ${!conf.siap ? `<div class="alert warn mt-2">${ui.icon('alert')}<div>Belum ada kredensial gateway. Isi kredensial sekolah di bawah, atau minta Super Admin mengaktifkan <b>gateway pusat</b>.</div></div>` : ''}
        <div class="toolbar mt-2">
          <a class="btn btn-primary" href="${c.base}/iuran/antrean#verifikasi">${ui.icon('check')}Verifikasi Pembayaran (${pending.length})</a>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Alur Pembayaran Portal</h3><div class="sub">Ringkas</div></div></div>
        <ol class="help" style="line-height:1.9;padding-left:18px">
          <li>Orang tua membuka portal, mencari nama siswa, lalu menekan <b>Bayar Iuran</b>.</li>
          <li>Memilih item tagihan (SPP per bulan / UKK / kegiatan) — total dihitung otomatis.</li>
          <li>Memilih <b>QRIS gateway</b> (otomatis lunas setelah callback) atau <b>transfer manual</b> + unggah bukti.</li>
          <li>Semua pembayaran masuk <b>Antrean Posting Iuran</b> untuk diverifikasi & diposting ke BKU.</li>
          <li>Bendahara menerima notifikasi (ikon lonceng) setiap ada pembayaran baru.</li>
        </ol>
      </div>
    </div>
    ${editable ? `<div class="card">
      <div class="card-head"><div><h3>Pengaturan Gateway &amp; QRIS Manual</h3>
        <div class="sub">Kredensial hanya disimpan di server — tidak pernah dikirim kembali ke halaman ini</div></div></div>
      <form method="post" action="${c.base}/pembayaran-online/simpan" id="fBayar">
        <div class="row2">
          <label class="check"><input type="checkbox" name="bayar_gateway_aktif" value="1" ${String(s.bayar_gateway_aktif) === '1' ? 'checked' : ''}> Tampilkan tombol <b>Bayar via QRIS / Payment Gateway</b> di portal</label>
          <label class="check"><input type="checkbox" name="bayar_manual_aktif" value="1" ${String(s.bayar_manual_aktif || '1') === '1' ? 'checked' : ''}> Tampilkan <b>Transfer Manual + unggah bukti</b> di portal</label>
        </div>
        <div class="row2">
          <div class="field"><label>Provider Gateway</label>
            <select name="bayar_provider">
              ${paygw.PROVIDERS.map(p => `<option value="${p.key}" ${String(s.bayar_provider || 'sandbox') === p.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
            <div class="hint">${paygw.PROVIDERS.map(p => `<b>${esc(p.label)}</b>: ${esc(p.hint)}`).join('<br>')}</div></div>
          <div class="field"><label>Mode</label>
            <select name="bayar_mode">
              <option value="sandbox" ${String(s.bayar_mode || 'sandbox') === 'sandbox' ? 'selected' : ''}>Sandbox (uji coba)</option>
              <option value="production" ${String(s.bayar_mode) === 'production' ? 'selected' : ''}>Production</option>
            </select>
            <div class="field" style="margin-top:10px"><label>Masa berlaku QRIS (menit)</label>
              <input type="number" name="bayar_expire_menit" min="5" max="1440" value="${esc(s.bayar_expire_menit || '60')}"></div></div>
        </div>
        <div class="row2">
          <div class="field"><label>Merchant ID / Merchant Code (opsional)</label><input name="bayar_merchant" value="${esc(s.bayar_merchant || '')}" autocomplete="off"></div>
          <div class="field"><label>Server Key / API Key</label><input type="password" name="bayar_key" value="" placeholder="${s.bayar_key ? '••••••• (tersimpan — kosongkan bila tidak diubah)' : 'belum diisi'}" autocomplete="new-password">
            <div class="hint">Dibiarkan kosong = kredensial lama dipertahankan.</div></div>
        </div>
        <div class="row2">
          <div class="field"><label>Callback Secret / Token / Webhook Secret (opsional)</label><input type="password" name="bayar_key2" value="" placeholder="${s.bayar_key2 ? '••••••• (tersimpan)' : 'opsional'}" autocomplete="new-password">
            <div class="hint">Kasera Pay: dipakai memverifikasi header <span class="mono">kasera-signature-v1</span> (HMAC-SHA256 body mentah).</div></div>
          <div class="field"><label>Base URL API gateway (opsional)</label><input name="bayar_base" value="${esc(s.bayar_base || '')}" placeholder="https://pay.kasera.id"></div>
        </div>
        <div class="card" style="box-shadow:none;border:1px dashed var(--line);padding:14px;margin-bottom:14px">
          <div class="card-head" style="margin-bottom:8px"><div><h4 style="margin:0">Kasera Pay — Pembayaran Iuran Otomatis</h4>
            <div class="sub">POST <span class="mono">/v1/transactions</span> → halaman checkout · webhook <span class="mono">payment.paid</span> → iuran otomatis lunas</div></div></div>
          <div class="row2">
            <div class="field"><label>API Kasera yang dipakai</label>
              <select name="bayar_kasera_api">
                <option value="auto" ${(s.bayar_kasera_api || 'auto') === 'auto' ? 'selected' : ''}>Otomatis — /v1/transactions, QRIS lama sebagai cadangan</option>
                <option value="transactions" ${s.bayar_kasera_api === 'transactions' ? 'selected' : ''}>Hanya /v1/transactions (checkout_url)</option>
                <option value="qris" ${s.bayar_kasera_api === 'qris' ? 'selected' : ''}>Hanya /v1/qris (QRIS lama)</option>
              </select>
              <div class="hint">Pilih <b>qris</b> bila akun Kasera sekolah ini belum mengaktifkan API Transactions.</div></div>
            <div class="field"><label>URL Webhook untuk dashboard Kasera</label>
              <input value="${esc(c.publicAbsUrl('/api/webhook/kasera'))}" readonly>
              <div class="hint">Daftarkan URL ini pada dashboard Kasera Pay. Sekolah dikenali otomatis dari nomor pesanan
                (<span class="mono">IU&lt;id sekolah&gt;-…</span>), sehingga satu URL dipakai semua sekolah.</div></div>
          </div>
          <div class="alert info">${ui.icon('info')}<div>Bila kredensial sekolah kosong, sistem memakai <b>gateway pusat</b> (Super Admin).
            Webhook Secret pusat diatur di <span class="mono">Super Admin → QRIS &amp; Harga</span>, atau lewat variabel lingkungan
            <span class="mono">KASERA_WEBHOOK_SECRET</span>.</div></div>
        </div>
        <div class="field"><label>URL Callback untuk gateway</label>
          <input value="${esc(c.publicAbsUrl('/portal/pay/callback'))}" readonly>
          <div class="hint">Daftarkan URL ini pada dashboard provider (Midtrans / Duitku / Xendit / Kasera). Query <b>?t=</b> diisi otomatis oleh sistem.</div></div>
        <div class="row2">
          <div class="field"><label>Gambar QRIS Sekolah (opsional)</label>
            <input type="file" accept="image/*" data-b64="qris_b64" data-filename="qris_nama" data-max="5">
            <input type="hidden" name="qris_b64" id="qris_b64"><input type="hidden" name="qris_nama" id="qris_nama">
            <div id="qris_b64-info" class="t-sub"></div>
            ${s.qris_image ? `<img src="${esc(s.qris_image)}" alt="QRIS sekolah" width="150" height="150" loading="lazy" style="margin-top:8px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:6px">` : ''}
            <label class="check" style="margin-top:8px"><input type="checkbox" name="qris_image_hapus" value="1"> Hapus gambar QRIS tersimpan</label></div>
          <div class="field"><label>Instruksi Transfer Manual</label>
            <textarea name="bayar_instruksi" rows="4" placeholder="Contoh: Transfer ke BRI 0123-4567-8901 a.n. SMK … lalu unggah bukti.">${esc(s.bayar_instruksi || '')}</textarea></div>
        </div>
        <label class="check"><input type="checkbox" name="notif_bayar_aktif" value="1" ${String(s.notif_bayar_aktif || '1') === '1' ? 'checked' : ''}> Kirim notifikasi lonceng ke akun bendahara setiap ada pembayaran portal baru</label>
        <div class="form-actions"><button class="btn btn-primary">${ui.icon('save')}Simpan Pengaturan</button></div>
      </form>
    </div>` : '<div class="alert info">Anda hanya dapat melihat pengaturan ini.</div>'}
    <div class="card mt-3">
      <div class="card-head"><div><h3>Pembayaran Portal Terbaru</h3><div class="sub">20 keranjang terakhir</div></div></div>
      ${pending.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Siswa</th><th>Item</th><th class="num">Total</th><th>Metode</th><th>Status</th></tr></thead><tbody>
        ${pending.map(x => {
      let items = []; try { items = JSON.parse(x.items || '[]'); } catch (e) { }
      return `<tr><td class="t-sub nowrap">${esc(lib.stampShort(x.created_at))}</td><td class="t-strong">${esc(x.nama || '-')}<div class="t-sub">${esc(x.kelas || '-')}</div></td>
        <td class="t-sub">${items.map(i => esc(i.label || '')).join('<br>') || '-'}</td>
        <td class="num t-strong">${rupiah(x.total)}</td>
        <td>${x.metode === 'gateway' ? ui.badge('QRIS ' + (x.provider || ''), 'blue') : ui.badge('Transfer Manual', 'orange')}</td>
        <td>${statusBadge(x.status)}</td></tr>`;
    }).join('')}
      </tbody></table></div>` : ui.emptyState('Belum ada pembayaran portal', 'Pembayaran yang dikirim orang tua lewat portal akan tampil di sini.')}
    </div>`;
    page(req, res, { title: 'Pembayaran Online', sub: 'Gateway QRIS & transfer manual pada portal orang tua', active: 'iuran_bayar_online', content });
  });

  post('/pembayaran-online/simpan', async (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const b = req.body;
    const provider = paygw.PROVIDER_KEYS.includes(String(b.bayar_provider || '')) ? String(b.bayar_provider) : 'sandbox';
    const expire = Math.max(5, Math.min(1440, Number(b.bayar_expire_menit) || 60));
    let qrisUrl = null;
    if (b.qris_b64 && String(b.qris_b64).length > 40) {
      const nm = String(b.qris_nama || 'qris.png');
      const ext = (nm.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      try { qrisUrl = await uploadMedia(b.qris_b64, `qris-${Date.now()}.${ext}`, { jenis: 'logo' }); }
      catch (e) { return res.redirect(req.BASE + flashUrl('/pembayaran-online', 'err', 'Gagal mengunggah gambar QRIS: ' + e.message)); }
    }
    const set = (k, v) => dbm.setSetting(k, v);
    set('bayar_gateway_aktif', b.bayar_gateway_aktif ? '1' : '0');
    set('bayar_manual_aktif', b.bayar_manual_aktif ? '1' : '0');
    set('bayar_provider', provider);
    set('bayar_mode', String(b.bayar_mode) === 'production' ? 'production' : 'sandbox');
    set('bayar_merchant', String(b.bayar_merchant || '').trim());
    set('bayar_base', String(b.bayar_base || '').trim());
    set('bayar_kasera_api', ['auto', 'transactions', 'qris'].includes(String(b.bayar_kasera_api || ''))
      ? String(b.bayar_kasera_api) : 'auto');
    set('bayar_expire_menit', String(expire));
    set('bayar_instruksi', String(b.bayar_instruksi || '').trim());
    set('notif_bayar_aktif', b.notif_bayar_aktif ? '1' : '0');
    if (String(b.bayar_key || '').trim()) set('bayar_key', String(b.bayar_key).trim());
    if (String(b.bayar_key2 || '').trim()) set('bayar_key2', String(b.bayar_key2).trim());
    if (qrisUrl) set('qris_image', qrisUrl);
    if (b.qris_image_hapus) set('qris_image', '');
    dbm.logAudit(req.user, 'EDIT', 'iuran', `Pengaturan pembayaran online (${provider}) diperbarui`);
    res.redirect(req.BASE + flashUrl('/pembayaran-online', 'ok', 'Pengaturan pembayaran online disimpan.'));
  });

  /* ================= VERIFIKASI PEMBAYARAN MANUAL ================= */
  post('/iuran/verifikasi', (req, res) => {
    if (!guard(req, res, 'iuran', 'edit')) return;
    const id = Number(req.body.id || 0);
    const aksi = String(req.body.aksi || 'setuju');
    const back = safeBack(req.body.back);
    const row = bayar.byId(dbm, id);
    if (!row) return res.redirect(req.BASE + flashUrl(back, 'err', 'Pembayaran tidak ditemukan.'));
    try {
      if (aksi === 'tolak') {
        bayar.reject(dbm, id, String(req.body.alasan || 'Bukti pembayaran tidak sah'), req.user.nama);
        dbm.logAudit(req.user, 'TOLAK', 'iuran', `Pembayaran portal ${row.nama || ''} (${rupiah(row.total)}) ditolak`);
        return res.redirect(req.BASE + flashUrl(back, 'ok', 'Pembayaran ditolak. Siswa dapat mengirim ulang bukti pembayaran.'));
      }
      const r = bayar.applyPaid(dbm, row, { oleh: req.user.nama + ' (verifikasi manual)' });
      dbm.logAudit(req.user, 'VERIFIKASI', 'iuran', `Pembayaran portal ${row.nama || ''} (${rupiah(row.total)}) disetujui — ${r.baris} baris masuk antrean`);
      return res.redirect(req.BASE + flashUrl(back, 'ok',
        `Pembayaran ${row.nama || 'siswa'} ${rupiah(row.total)} diverifikasi. ${r.sudah ? 'Sudah pernah diverifikasi.' : r.baris + ' baris iuran masuk Antrean Posting BKU.'}`));
    } catch (e) {
      return res.redirect(req.BASE + flashUrl(back, 'err', e.message));
    }
  });

  /* ================= NOTIFIKASI LONCENG ================= */
  post('/notif/baca', (req, res) => {
    const back = safeBack(req.body.back, '/');
    dbm.notifRead(req.user.role, req.body.id ? Number(req.body.id) : 0, req.user.nama);
    res.redirect(req.BASE + back);
  });
};
