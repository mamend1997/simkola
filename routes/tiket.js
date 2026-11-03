'use strict';
/**
 * ==================================================================
 * BANTUAN & TIKET KENDALA — sisi sekolah (tenant)
 * ------------------------------------------------------------------
 * /bantuan            → form pengajuan + riwayat tiket sekolah
 * /bantuan/:id        → percakapan tiket (balasan Super Admin & sekolah)
 * ==================================================================
 */
const storage = require('../storage');

module.exports = ({ get, post, dbm, lib, ui, page, ctx, guard, can, flashUrl, saas, uploadMedia }) => {
  const { esc, tglID } = lib;
  const badgeOf = st => st === 'resolved' ? ui.badge('Resolved', 'green')
    : st === 'in_progress' ? ui.badge('In Progress', 'blue') : ui.badge('Open', 'amber');

  function thread(req, c, t, msgs) {
    return `<div class="ticket-thread">
      ${msgs.length ? msgs.map(m => `<div class="tk-msg ${m.dari === 'admin' ? 'admin' : 'tenant'}">
        <div class="tk-head"><b>${esc(m.nama || (m.dari === 'admin' ? 'Super Admin' : 'Sekolah'))}</b>
          <span class="t-sub">${m.dari === 'admin' ? 'Super Admin Pusat' : 'Sekolah'} · ${esc(tglID(m.created_at))}</span></div>
        <div class="tk-body">${esc(m.pesan || '').replace(/\n/g, '<br>')}</div>
        ${m.lampiran_url ? `<a class="tk-attach" href="${esc(m.lampiran_url)}" target="_blank" rel="noopener">${ui.icon('file')}Lihat lampiran</a>` : ''}
      </div>`).join('') : `<div class="muted small">Belum ada balasan.</div>`}
    </div>
    <form method="post" action="${c.base}/bantuan/${t.id}/balas" class="mt-2">
      <input type="hidden" name="lampiran_b64" id="lampiran_b64_${t.id}">
      <div class="field"><label>Balasan / Informasi Tambahan</label>
        <textarea name="pesan" rows="3" placeholder="Tuliskan balasan untuk Super Admin…"></textarea></div>
      <div class="field"><label>Lampiran Screenshot (opsional)</label>
        <input type="file" accept="image/*" data-b64="lampiran_b64_${t.id}" data-max="5">
        <div class="hint" id="lampiran_b64_${t.id}-info">PNG/JPG maks 5 MB.</div></div>
      <div class="form-actions"><button class="btn btn-primary">${ui.icon('send')}Kirim Balasan</button>
        ${t.status !== 'resolved' ? `<button class="btn" form="fTutupTiket">${ui.icon('check')}Tandai Selesai</button>` : ''}</div>
    </form>`;
  }

  get('/bantuan', (req, res) => {
    guard(req, res, 'catatan', 'view');
    const c = ctx(req);
    const rows = saas.ticketsOf(req.tenant.id);
    const open = rows.filter(r => r.status !== 'resolved').length;
    const content = `<div class="split">
      <div class="card">
        <div class="card-head"><div><h3>${ui.icon('inbox', 'i-sm')} Ajukan Kendala</h3>
          <div class="sub">Laporan diteruskan ke Super Admin Pusat</div></div>
          ${open ? ui.badge(open + ' tiket aktif', 'amber') : ui.badge('Tidak ada tiket aktif', 'green')}</div>
        <form method="post" action="${c.base}/bantuan/kirim">
          <input type="hidden" name="bukti_b64" id="bukti_b64">
          <div class="row2">
            <div class="field"><label>Kategori Masalah</label>
              <select name="kategori">${saas.TICKET_KATEGORI.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select></div>
            <div class="field"><label>Prioritas</label>
              <select name="prioritas">
                <option value="normal">Normal</option><option value="tinggi">Tinggi (layanan terganggu)</option>
                <option value="rendah">Rendah (pertanyaan)</option>
              </select></div>
          </div>
          <div class="field"><label>Judul Kendala <span style="color:var(--red)">*</span></label>
            <input type="text" name="judul" required maxlength="160" placeholder="Contoh: Kwitansi iuran tidak muncul"></div>
          <div class="field"><label>Deskripsi Detail <span style="color:var(--red)">*</span></label>
            <textarea name="deskripsi" rows="5" required placeholder="Jelaskan langkah yang dilakukan, pesan error, dan halaman yang bermasalah…"></textarea></div>
          <div class="field"><label>Foto / Screenshot Bukti Error (opsional)</label>
            <input type="file" accept="image/*" data-b64="bukti_b64" data-max="5">
            <div class="hint" id="bukti_b64-info">PNG/JPG maks 5 MB.</div></div>
          <div class="form-actions"><button class="btn btn-primary">${ui.icon('send')}Kirim Tiket</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Riwayat Tiket Sekolah</h3><div class="sub">${rows.length} tiket</div></div></div>
        <div class="table-wrap short"><table><thead><tr><th>Kode</th><th>Judul</th><th>Kategori</th><th>Status</th><th>Dibuat</th><th></th></tr></thead><tbody>
          ${rows.length ? rows.map(t => `<tr>
            <td class="mono small">${esc(t.kode || '-')}</td>
            <td><b>${esc(t.judul)}</b><div class="t-sub">${esc((t.deskripsi || '').slice(0, 70))}…</div></td>
            <td class="small">${esc(t.kategori || '-')}</td>
            <td>${badgeOf(t.status)}</td>
            <td class="small nowrap">${esc(tglID(t.created_at))}</td>
            <td><a class="btn btn-sm" href="${c.base}/bantuan/${t.id}">Buka</a></td></tr>`).join('')
        : `<tr><td colspan="6" class="muted" style="text-align:center;padding:18px">Belum ada tiket.</td></tr>`}
        </tbody></table></div>
      </div>
    </div>`;
    page(req, res, { title: 'Bantuan & Tiket Kendala', sub: 'Laporkan kendala teknis ke Super Admin Pusat', active: 'bantuan', content });
  });

  post('/bantuan/kirim', async (req, res) => {
    guard(req, res, 'catatan', 'create');
    try {
      let bukti = '';
      if (req.body.bukti_b64) {
        bukti = await uploadMedia(req.body.bukti_b64, `tiket-${Date.now()}.jpg`, { jenis: 'tiket' });
      }
      const t = saas.ticketCreate(req.tenant.id, {
        kategori: req.body.kategori, judul: req.body.judul, deskripsi: req.body.deskripsi,
        prioritas: req.body.prioritas, bukti_url: bukti, oleh: req.user.nama
      });
      dbm.logAudit(req.user, 'TIKET BARU', 'bantuan', `${t.kode}: ${t.judul}`);
      res.redirect(req.BASE + flashUrl('/bantuan/' + t.id, 'ok', `Tiket ${t.kode} terkirim. Super Admin akan menindaklanjuti.`));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/bantuan', 'err', e.message));
    }
  });

  get('/bantuan/:id', (req, res) => {
    guard(req, res, 'catatan', 'view');
    const c = ctx(req);
    const t = saas.ticketById(req.params.id);
    if (!t || Number(t.tenant_id) !== Number(req.tenant.id)) {
      return res.redirect(req.BASE + flashUrl('/bantuan', 'err', 'Tiket tidak ditemukan untuk sekolah ini.'));
    }
    const msgs = saas.ticketMessages(t.id);
    const content = `<div class="card">
      <div class="card-head"><div><h3>${esc(t.kode)} · ${esc(t.judul)}</h3>
        <div class="sub">${esc(t.kategori)} · dibuat ${esc(tglID(t.created_at))} oleh ${esc(t.dibuat_oleh || '-')}</div></div>
        <div class="flex" style="gap:8px;align-items:center">${badgeOf(t.status)}
          <a class="btn btn-sm" href="${c.base}/bantuan">${ui.icon('back')}Daftar Tiket</a></div></div>
      <div class="alert info">${ui.icon('info')}<div><b>Deskripsi:</b><br>${esc(t.deskripsi || '').replace(/\n/g, '<br>')}</div></div>
      ${t.bukti_url ? `<p class="small"><b>Bukti awal:</b> <a href="${esc(t.bukti_url)}" target="_blank" rel="noopener">buka gambar</a></p>` : ''}
      ${thread(req, c, t, msgs)}
      <form id="fTutupTiket" method="post" action="${c.base}/bantuan/${t.id}/tutup" data-confirm="Tandai tiket ini selesai?"></form>
    </div>`;
    page(req, res, { title: 'Detail Tiket', sub: t.kode || '', active: 'bantuan', content });
  });

  post('/bantuan/:id/balas', async (req, res) => {
    guard(req, res, 'catatan', 'create');
    try {
      const t = saas.ticketById(req.params.id);
      if (!t || Number(t.tenant_id) !== Number(req.tenant.id)) throw new Error('Tiket tidak ditemukan.');
      let lamp = '';
      const b64 = req.body.lampiran_b64;
      if (b64) lamp = await uploadMedia(b64, `tiket-${t.id}-${Date.now()}.jpg`, { jenis: 'tiket' });
      saas.ticketMessageAdd(t.id, { dari: 'tenant', nama: req.user.nama, pesan: req.body.pesan, lampiran_url: lamp });
      dbm.logAudit(req.user, 'BALAS TIKET', 'bantuan', `${t.kode}`);
      res.redirect(req.BASE + flashUrl('/bantuan/' + t.id, 'ok', 'Balasan terkirim.'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/bantuan/' + req.params.id, 'err', e.message));
    }
  });

  post('/bantuan/:id/tutup', (req, res) => {
    guard(req, res, 'catatan', 'edit');
    try {
      const t = saas.ticketById(req.params.id);
      if (!t || Number(t.tenant_id) !== Number(req.tenant.id)) throw new Error('Tiket tidak ditemukan.');
      saas.ticketStatus(t.id, 'resolved', req.user);
      dbm.logAudit(req.user, 'TUTUP TIKET', 'bantuan', `${t.kode}`);
      res.redirect(req.BASE + flashUrl('/bantuan/' + t.id, 'ok', 'Tiket ditandai selesai.'));
    } catch (e) {
      res.redirect(req.BASE + flashUrl('/bantuan', 'err', e.message));
    }
  });
};
