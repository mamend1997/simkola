/* SIMKEU — interaksi klien */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ===== formatter nominal: pemisah ribuan otomatis (4.500.000) ===== */
  const digitsOf = v => String(v === undefined || v === null ? '' : v).replace(/[^\d]/g, '');
  const moneyVal = el => { const d = digitsOf(el && el.value); return d ? Number(d) : 0; };
  const thousands = d => (d ? Number(d).toLocaleString('id-ID') : '');
  function initMoney(inp) {
    if (!inp || inp.dataset.moneyInit === '1') return;
    inp.dataset.moneyInit = '1';
    inp.type = 'text';
    inp.setAttribute('inputmode', 'numeric');
    inp.value = thousands(digitsOf(inp.value));
    inp.addEventListener('input', () => {
      const end = inp.selectionStart === inp.value.length;
      inp.value = thousands(digitsOf(inp.value));
      if (end) { try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { } }
    });
  }
  $$('input[data-money]').forEach(initMoney);
  window.__simkeu = { initMoney };
  // sebelum dikirim ke server, buang titik pemisah ribuan
  document.addEventListener('submit', e => {
    const f = e.target;
    if (!f || !f.querySelectorAll) return;
    f.querySelectorAll('input[data-money]').forEach(i => { i.value = digitsOf(i.value); });
  }, true);

  /* sidebar mobile */
  const burger = $('#burger'), sidebar = $('#sidebar'), scrim = $('#scrim');
  if (burger) burger.addEventListener('click', () => { sidebar.classList.toggle('open'); scrim.classList.toggle('show'); });
  if (scrim) scrim.addEventListener('click', () => { sidebar.classList.remove('open'); scrim.classList.remove('show'); });

  /* ===== collapse / expand sidebar (area kerja lebih luas) ===== */
  (function sidebarCollapse() {
    const KEY = 'simkeu:nav-collapsed';
    const btn = document.getElementById('navCollapse');
    const shell = document.querySelector('.shell');
    if (!shell) return;
    let collapsed = false;
    try { collapsed = localStorage.getItem(KEY) === '1'; } catch (e) { }
    const apply = () => {
      shell.classList.toggle('nav-collapsed', collapsed);
      document.body.classList.toggle('nav-collapsed', collapsed);
      if (btn) btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    };
    apply();
    if (btn) btn.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { }
      apply();
    });
  })();

  /* ===== menu bilah samping: akordeon (buka/tutup + ingat pilihan) ===== */
  (function navAccordion() {
    const KEY = 'simkeu:nav-open';
    let state = {};
    try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
    $$('[data-navtoggle]').forEach(btn => {
      const group = btn.closest('.nav-group');
      if (!group) return;
      const id = btn.dataset.navtoggle;
      const hasActive = !!group.querySelector('a.active');
      if (!hasActive && state[id] !== undefined) group.classList.toggle('open', !!state[id]);
      btn.setAttribute('aria-expanded', group.classList.contains('open') ? 'true' : 'false');
      btn.addEventListener('click', () => {
        const open = group.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        state[id] = open ? 1 : 0;
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
      });
    });
    // di mobile: setelah memilih menu, tutup drawer agar halaman tujuan terlihat
    $$('.nav a').forEach(a => a.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('open');
      if (scrim) scrim.classList.remove('show');
    }));
  })();

  /* ===== pertahankan posisi scroll setelah simpan / edit / navigasi ===== */
  const SCROLL_KEY = 'simkeu:scroll-pos';
  const scrollYNow = () => (window.scrollY || window.pageYOffset || 0);
  function saveScrollPos() {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ p: location.pathname, y: scrollYNow() })); } catch (e) { }
  }
  document.addEventListener('submit', saveScrollPos, true);
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    saveScrollPos();
  }, true);
  window.addEventListener('pagehide', saveScrollPos);
  (function restoreScrollPos() {
    let raw = null;
    try { raw = sessionStorage.getItem(SCROLL_KEY); } catch (e) { return; }
    if (!raw) return;
    let s = null;
    try { s = JSON.parse(raw); } catch (e) { }
    try { sessionStorage.removeItem(SCROLL_KEY); } catch (e) { }
    if (!s || s.p !== location.pathname || !(Number(s.y) > 30)) return;
    const apply = () => { try { window.scrollTo(0, Number(s.y)); } catch (e) { } };
    apply();
    window.addEventListener('load', () => {
      apply();
      if (window.requestAnimationFrame) requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
      setTimeout(apply, 80);
      setTimeout(apply, 260);
    });
  })();

  /* modal */
  function open(id) { const m = document.getElementById(id); if (m) { m.classList.add('show'); document.body.style.overflow = 'hidden'; const f = m.querySelector('input:not([type=hidden]),select,textarea'); if (f) setTimeout(() => f.focus(), 80); } }
  function close(m) { m.classList.remove('show'); document.body.style.overflow = ''; }
  $$('[data-open]').forEach(b => b.addEventListener('click', () => open(b.dataset.open)));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => close(document.getElementById(b.dataset.close))));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) close(m); }));
  /* pop-up otomatis (mis. peringatan Tutup BKU Bulanan) — sekali per sesi per kunci */
  $$('.modal[data-autoshow]').forEach(m => {
    const key = 'autoshow:' + m.id + ':' + (m.dataset.autokey || '');
    let seen = false;
    try { seen = sessionStorage.getItem(key) === '1'; } catch (e) { }
    if (!seen) open(m.id);
    $$('[data-dismiss-auto]', m).forEach(b => b.addEventListener('click', () => {
      try { sessionStorage.setItem(key, '1'); } catch (e) { }
    }));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal.show').forEach(close); });
  window.__openModal = open;

  /* confirm */
  $$('form[data-confirm]').forEach(f => f.addEventListener('submit', e => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));

  /* flash auto-dismiss helpers not needed */

  /* auto-submit filter selects */
  $$('[data-autosubmit]').forEach(el => el.addEventListener('change', () => el.form && el.form.submit()));

  /* file -> base64 hidden input (nota / logo) */
  $$('input[type=file][data-b64]').forEach(inp => {
    const target = document.getElementById(inp.dataset.b64);
    const info = document.getElementById(inp.dataset.b64 + '-info');
    inp.addEventListener('change', () => {
      const f = inp.files[0];
      if (!f) { target.value = ''; if (info) info.textContent = ''; return; }
      const maxMB = Number(inp.dataset.max || 15);
      if (f.size > maxMB * 1024 * 1024) { alert('Ukuran berkas melebihi ' + maxMB + ' MB.'); inp.value = ''; return; }
      const nameTarget = inp.dataset.filename ? document.getElementById(inp.dataset.filename) : null;
      if (nameTarget) nameTarget.value = f.name;
      const rd = new FileReader();
      rd.onload = () => {
        target.value = rd.result;
        if (info) info.innerHTML = '<span class="badge green plain">✓ ' + f.name + ' (' + (f.size / 1024 / 1024).toFixed(2) + ' MB)</span>';
        const pv = document.getElementById(inp.dataset.b64 + '-preview');
        if (pv && f.type.startsWith('image/')) pv.src = rd.result;
        if (inp.form) {
          const btn = inp.form.querySelector('[type=submit]');
          if (btn) { btn.disabled = false; }
        }
        const submitBtn = inp.closest('form') ? inp.closest('form').querySelector('button[type=submit]') : null;
        if (submitBtn && submitBtn.dataset.locked) { submitBtn.disabled = false; submitBtn.dataset.locked = ''; }
      };
      rd.readAsDataURL(f);
    });
  });

  /* ===== foto profil: crop persegi + pratinjau WYSIWYG ===== */
  $$('input[type=file][data-avatar]').forEach(inp => {
    const hidden = document.getElementById(inp.dataset.avatar);
    const info = document.getElementById(inp.dataset.avatar + '-info');
    const posGroup = document.querySelector(`[data-avatar-pos="${inp.dataset.avatar}"]`);
    const previews = $$(`[data-avatar-preview="${inp.dataset.avatar}"]`);
    let srcImg = null;
    let pos = 0.5;                    // 0 = atas, 0.5 = tengah, 1 = bawah

    // target = elemen .avatar di dalam wrapper pratinjau (bukan wrapper-nya)
    const targetOf = el => el.classList.contains('avatar') ? el : (el.querySelector('.avatar') || el);

    function paintPlaceholder() {
      previews.forEach(el => {
        const t = targetOf(el);
        t.querySelectorAll(':scope > img').forEach(i => i.remove());
        const ini = t.querySelector('.avatar-ini');
        if (ini) ini.style.display = '';
      });
    }

    function render() {
      if (!srcImg) return;
      const W = 512;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = W;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, W);
      const iw = srcImg.naturalWidth || srcImg.width;
      const ih = srcImg.naturalHeight || srcImg.height;
      const side = Math.min(iw, ih);
      const sx = (iw - side) / 2;
      const sy = (ih - side) * pos;
      ctx.drawImage(srcImg, sx, sy, side, side, 0, 0, W, W);
      const dataUrl = cv.toDataURL('image/jpeg', 0.9);
      hidden.value = dataUrl;
      previews.forEach(el => {
        const t = targetOf(el);
        t.classList.add('avatar-img');
        let img = t.querySelector(':scope > img');
        if (!img) {
          img = document.createElement('img');
          img.alt = 'Pratinjau foto';
          t.appendChild(img);
        }
        img.src = dataUrl;
        const ini = t.querySelector('.avatar-ini');
        if (ini) ini.style.display = 'none';
      });
      if (info) {
        const kb = Math.round(dataUrl.length * 0.75 / 1024);
        const fname = (inp.files && inp.files[0]) ? inp.files[0].name : '';
        info.innerHTML = '<span class="badge green plain">✓ Siap disimpan</span> <span class="small muted">' +
          (fname ? fname + ' · ' : '') + 'avatar ' + kb + ' KB (512×512)</span>';
      }
    }

    if (posGroup) {
      posGroup.querySelectorAll('button[data-pos]').forEach(btn => {
        if (btn.dataset.pos === '0.5') btn.classList.add('on');
        btn.addEventListener('click', () => {
          pos = Number(btn.dataset.pos);
          posGroup.querySelectorAll('button').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          if (srcImg) render();
        });
      });
    }

    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) { srcImg = null; hidden.value = ''; paintPlaceholder(); if (info) info.textContent = ''; return; }
      if (!/^image\//.test(f.type)) { alert('Pilih berkas gambar (JPG/PNG).'); inp.value = ''; return; }
      const maxMB = Number(inp.dataset.max || 8);
      if (f.size > maxMB * 1024 * 1024) { alert('Ukuran berkas melebihi ' + maxMB + ' MB.'); inp.value = ''; return; }
      const nameTarget = inp.dataset.filename ? document.getElementById(inp.dataset.filename) : null;
      if (nameTarget) nameTarget.value = f.name;
      if (info) info.innerHTML = '<span class="small muted">Memproses gambar…</span>';
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => {
        srcImg = im;
        render();
        if (posGroup) posGroup.style.display = 'flex';
        URL.revokeObjectURL(url);
      };
      im.onerror = () => {
        if (info) info.innerHTML = '<span class="badge red plain">Gambar tidak bisa dibaca</span>';
        URL.revokeObjectURL(url);
      };
      im.src = url;
    });
  });

  /* permission matrix: per-module select all / toggle role column */
  $$('[data-toggle-col]').forEach(master => {
    master.addEventListener('change', () => {
      const role = master.dataset.toggleCol;
      $$('input[data-role="' + role + '"]').forEach(c => { c.checked = master.checked; });
    });
  });
  $$('[data-toggle-mod]').forEach(master => {
    master.addEventListener('change', () => {
      const mod = master.dataset.toggleMod;
      $$('input[data-mod="' + mod + '"]').forEach(c => { c.checked = master.checked; });
    });
  });

  /* form transaksi: live terbilang, peringatan approval & pagu anggaran */
  const fmtRp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  document.querySelectorAll('[data-trx-form]').forEach(form => {
    const nominal = form.querySelector('.js-nominal');
    const coa = form.querySelector('.js-coa');
    const ter = form.querySelector('.js-terbilang');
    const appr = form.querySelector('.js-approval');
    const paguBox = form.querySelector('.js-pagu');
    const jenis = (form.querySelector('input[name=jenis]') || {}).value;
    const threshold = Number(window.__THRESHOLD || 0);
    const paguMap = window.__PAGU || {};
    function sync() {
      const v = nominal ? moneyVal(nominal) : 0;
      if (ter) ter.textContent = v ? terbilang(v) : '';
      if (appr) {
        const over = jenis === 'pengeluaran' && threshold > 0 && v > threshold;
        appr.style.display = over ? 'flex' : 'none';
      }
      if (paguBox && jenis === 'pengeluaran' && coa && coa.value) {
        const sisa = paguMap[coa.value];
        if (sisa === undefined) { paguBox.style.display = 'none'; }
        else if (v > sisa) {
          paguBox.className = 'alert warn js-pagu';
          paguBox.style.display = 'flex';
          paguBox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><div><b>Melebihi sisa pagu anggaran.</b> Sisa plafon rekening ini ' + fmtRp(Math.max(0, sisa)) + ', sedangkan nominal ' + fmtRp(v) + '. Transaksi tetap dapat disimpan, tetapi akan tercatat sebagai over budget.</div>';
        } else {
          paguBox.className = 'alert ok js-pagu';
          paguBox.style.display = 'flex';
          paguBox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="m4 12 5 5L20 6"/></svg><div>Sisa pagu rekening ini ' + fmtRp(sisa) + ' — masih mencukupi.</div>';
        }
      } else if (paguBox) { paguBox.style.display = 'none'; }
    }
    if (nominal) nominal.addEventListener('input', sync);
    if (coa) coa.addEventListener('change', sync);
    sync();
  });

  /* tutup BKU bulanan: live hitung selisih opnam kas */
  document.querySelectorAll('[data-opnam-form]').forEach(form => {
    const buku = Number(form.dataset.saldoBuku || 0);
    const tunai = form.querySelector('.js-opnam-tunai');
    const bank = form.querySelector('.js-opnam-bank');
    const out = form.querySelector('.js-opnam-selisih');
    const alasan = form.querySelector('.js-alasan');
    const panel = form.querySelector('[data-opnam-panel]');
    const radios = $$('input[name=metode]', form);
    const fmt = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
    function sync() {
      const metode = (radios.find(r => r.checked) || {}).value || 'rollover';
      if (panel) panel.style.display = metode === 'opnam' ? 'block' : 'none';
      const riil = moneyVal(tunai) + moneyVal(bank);
      const sel = riil - buku;
      if (out) {
        if (metode !== 'opnam') { out.style.display = 'none'; }
        else {
          out.style.display = 'flex';
          if (Math.abs(sel) < 1) {
            out.className = 'js-opnam-selisih alert ok';
            out.innerHTML = '<div><b>Tidak ada selisih.</b> Kas riil ' + fmt(riil) + ' sama dengan saldo menurut buku.</div>';
          } else {
            out.className = 'js-opnam-selisih alert ' + (sel > 0 ? 'info' : 'err');
            out.innerHTML = '<div><b>Selisih kas ' + (sel > 0 ? 'LEBIH' : 'KURANG') + ' ' + fmt(Math.abs(sel)) + '.</b><br>' +
              'Saldo buku ' + fmt(buku) + ' vs kas riil ' + fmt(riil) + '. Sistem akan membukukan transaksi penyesuaian otomatis dan menetapkan saldo awal bulan baru sebesar ' + fmt(riil) + '.</div>';
          }
        }
      }
      if (alasan) alasan.required = metode === 'opnam' && Math.abs(sel) >= 1;
    }
    radios.forEach(r => r.addEventListener('change', sync));
    [tunai, bank].forEach(i => i && i.addEventListener('input', sync));
    sync();
  });

  /* bulk close BKU: centang semua */
  $$('[data-check-all]').forEach(master => {
    master.addEventListener('change', () => {
      $$('input[name^="pilih_"]').forEach(c => { if (!c.disabled) c.checked = master.checked; });
    });
  });

  /* tables: simple client search */
  const filterRowsOf = (tb, q) => {
    if (!tb) return 0;
    let shown = 0;
    Array.from(tb.rows).forEach(r => {
      if (r.classList.contains('inline-edit-row') || r.classList.contains('no-filter')) return;
      const ok = !q || r.textContent.toLowerCase().includes(q);
      r.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    return shown;
  };
  $$('[data-table-search]').forEach(inp => {
    const targets = String(inp.dataset.tableSearch || '').split(',').map(t => t.trim()).filter(Boolean);
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase();
      targets.forEach(sel => filterRowsOf(document.querySelector(sel + ' tbody'), q));
    });
  });

  /* =====================================================================
     INSTANT SEARCH GLOBAL — semua kolom pencarian (name q / cari / search,
     dsb.) memfilter tabel di sekitarnya secara REALTIME tanpa klik Filter.
     Tombol [Filter] tetap tersedia untuk pencarian ke seluruh data (server).
     ===================================================================== */
  const liveScopeOf = (inp) => {
    // area utama halaman (semua tabel di dalamnya ikut terfilter, kecuali tabel di dalam modal)
    const main = inp.closest('.content, .portal-wrap, .auth-wrap, main');
    if (main && main.querySelector('table tbody')) return main;
    let el = inp, hops = 0;
    while (el && el !== document.body && hops < 9) {
      if (el.querySelector && el.querySelector('table tbody')) return el;
      el = el.parentElement; hops++;
    }
    return null;
  };
  const LIVE_NAMES = /^(q|cari|search|keyword|kata_kunci|nama|cari_nama|nisn)$/i;
  $$('input[name]').forEach(inp => {
    const type = (inp.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'search'].includes(type)) return;
    if (!LIVE_NAMES.test(inp.name)) return;
    if (inp.hasAttribute('data-table-search')) return;
    if (inp.dataset.noLive !== undefined) return;
    const scope = liveScopeOf(inp);
    if (!scope) return;
    const tables = Array.from(scope.querySelectorAll('table')).filter(t => t.tBodies.length && !t.closest('.modal') && !t.closest('.no-live-search'));
    if (!tables.length) return;
    let timer = null;
    const run = () => {
      const q = inp.value.trim().toLowerCase();
      tables.forEach(t => Array.from(t.tBodies).forEach(tb => filterRowsOf(tb, q)));
      scope.querySelectorAll('.table-scroll,.table-wrap').forEach(w => { w.scrollTop = 0; });
    };
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
    inp.addEventListener('search', run);
  });

  /* ===== leger payroll: hitung komponen secara live ===== */
  const payTable = document.querySelector('.payroll-table');
  if (payTable) {
    const fmt = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
    const jamOf = el => {
      let s = String(el && el.value || '').trim().replace(/\s/g, '');
      if (!s) return 0;
      if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
      if (s.includes('.')) { const p = s.split('.'); if (p.length === 2 && p[1].length <= 2 && Math.abs(Number(s)) < 1000) return Number(s) || 0; return Number(s.replace(/\./g, '')) || 0; }
      return Number(s) || 0;
    };
    const JAM_FIELDS = ['jam_efektif', 'jam_telat', 'jam_pembantu_kepsek', 'jam_wali_kelas', 'jam_sertifikasi'];
    const val = (tr, f) => {
      const el = tr.querySelector(`input[name$="_${f}"]`);
      if (!el) return 0;
      return JAM_FIELDS.includes(f) ? jamOf(el) : moneyVal(el);
    };
    function recalc(tr) {
      const je = val(tr, 'jam_efektif'), jt = val(tr, 'jam_telat'), hj = val(tr, 'honor_jam');
      const honor = Math.round(je * hj);
      const telat = Math.round(jt * 0.75 * hj);
      const ratePembantu = Number(window.__HONOR_TUGAS || 50000) || 50000;
      const rateWali = Number(window.__HONOR_WALI || ratePembantu) || ratePembantu;
      const rateSert = Number(window.__SERT_RATE || 12500) || 12500;
      const pembantu = Math.round(val(tr, 'jam_pembantu_kepsek') * ratePembantu);
      const wali = Math.round(val(tr, 'jam_wali_kelas') * rateWali);
      // sertifikasi: INPUT JAM → nominal = jam × tarif pengaturan
      const jamSert = val(tr, 'jam_sertifikasi');
      const sertifikasi = Math.round(jamSert * rateSert);
      const penerimaan = honor + val(tr, 'tunjangan_jabatan') + val(tr, 'tunjangan_masa_kerja') + val(tr, 'lembur')
        + val(tr, 'tambahan_penghasilan') + val(tr, 'tunjangan_khusus') + pembantu + wali;
      const potongan = telat + val(tr, 'pot_dana_sosial') + val(tr, 'pot_bpjs_kes') + val(tr, 'pot_bpjs_tk')
        + sertifikasi + val(tr, 'pot_kasbon');
      const diterima = penerimaan - potongan;
      const set = (sel, txt) => { const el = tr.querySelector(sel); if (el) el.textContent = txt; };
      set('.js-honor', fmt(honor)); set('.js-penerimaan', fmt(penerimaan));
      set('.js-pembantu', fmt(pembantu)); set('.js-wali', fmt(wali));
      set('.js-sert', `${fmt(sertifikasi)} = ${String(Math.round(jamSert * 100) / 100).replace('.', ',')} jam × ${fmt(rateSert)}`);
      set('.js-telat', fmt(telat)); set('.js-potongan', fmt(potongan));
      set('.js-diterima', fmt(diterima));
      const d = tr.querySelector('.js-diterima');
      if (d) d.style.color = diterima < 0 ? 'var(--red)' : 'var(--ink)';
    }
    payTable.addEventListener('input', e => {
      // kolom JAM hanya menerima angka (0-9) + koma/titik desimal
      const el = e.target;
      if (el && el.name && /jam_/.test(el.name)) {
        const bersih = String(el.value || '').replace(/[^0-9.,]/g, '');
        if (bersih !== el.value) {
          const pos = el.selectionStart;
          el.value = bersih;
          try { el.setSelectionRange(pos, pos); } catch (err) { }
        }
      }
      const tr = el.closest('tr[data-payroll-row]');
      if (tr) recalc(tr);
    });
    payTable.querySelectorAll('tr[data-payroll-row]').forEach(recalc);
  }

  /* ===== grafik keuangan dashboard: pie/donut, bar, line ===== */
  (function financeChart() {
    const host = document.getElementById('finChart');
    if (!host || !window.__FIN_DATA) return;
    const data = window.__FIN_DATA || { bku: [], bulan: [] };
    const typeSel = document.querySelector('[data-fin-type]');
    const modeSel = document.querySelector('[data-fin-mode]');
    const PALETTE = ['#F97316', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1', '#EF4444', '#84CC16', '#0EA5E9', '#A855F7'];
    const MODE_LABEL = { saldo: 'Saldo Akhir', keluar: 'Total Pengeluaran', masuk: 'Total Pemasukan' };
    const fmtRp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
    const shortRp = n => {
      const v = Number(n) || 0;
      if (Math.abs(v) >= 1e9) return 'Rp ' + (v / 1e9).toFixed(1).replace('.', ',') + ' M';
      if (Math.abs(v) >= 1e6) return 'Rp ' + (v / 1e6).toFixed(1).replace('.', ',') + ' jt';
      if (Math.abs(v) >= 1e3) return 'Rp ' + Math.round(v / 1e3) + ' rb';
      return fmtRp(v);
    };
    const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('simkeu:fin') || '{}') || {}; } catch (e) { saved = {}; }
    if (typeSel && saved.type) typeSel.value = saved.type;
    if (modeSel && saved.mode) modeSel.value = saved.mode;

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.style.display = 'none';

    function render() {
      const type = (typeSel && typeSel.value) || 'donut';
      const mode = (modeSel && modeSel.value) || 'saldo';
      try { localStorage.setItem('simkeu:fin', JSON.stringify({ type, mode })); } catch (e) { }
      let svg = '', legend = '', empty = '';
      if (type === 'line') {
        const rows = data.bulan || [];
        const vals = rows.map(r => Number(r[mode]) || 0);
        if (!rows.length || !vals.some(v => v)) empty = 'Belum ada transaksi pada tahun ajaran ini.';
        else { const r = drawLine(rows, mode, vals); svg = r.svg; legend = r.legend; }
      } else {
        let rows = (data.bku || []).map(b => ({ nama: b.nama, val: Number(b[mode]) || 0 })).filter(x => x.val !== 0);
        if (mode !== 'saldo') rows = rows.filter(x => x.val > 0);
        if (!rows.length) empty = 'Belum ada nilai pada mode ' + (MODE_LABEL[mode] || mode) + '.';
        else {
          rows.sort((a, b) => (mode === 'saldo' ? Math.abs(b.val) - Math.abs(a.val) : b.val - a.val));
          const r = type === 'bar' ? drawBar(rows, mode) : drawDonut(rows, mode);
          svg = r.svg; legend = r.legend;
        }
      }
      host.innerHTML = empty
        ? `<div class="empty" style="padding:34px 16px"><div class="eico">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg>'}</div><h4>${escH(empty)}</h4></div>`
        : `<div class="chart-wrap fin-wrap">${svg}</div><div class="chart-legend">${legend}</div>`;
      if (!empty) host.appendChild(tip);
    }

    function drawDonut(rows, mode) {
      const W = 460, H = 300, cx = 150, cy = 150, r = 104, sw = 46;
      const total = rows.reduce((s, x) => s + Math.abs(x.val), 0) || 1;
      const circ = 2 * Math.PI * r;
      let off = 0, seg = '';
      rows.forEach((row, i) => {
        const frac = Math.abs(row.val) / total;
        const len = Math.max(0.5, frac * circ);
        const color = PALETTE[i % PALETTE.length];
        const pct = (frac * 100).toFixed(1).replace('.', ',');
        seg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" 
          stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
          transform="rotate(-90 ${cx} ${cy})" class="chart-hit" data-tip="${escH(row.nama)}|${fmtRp(row.val)}|${pct}%"></circle>`;
        off += len;
      });
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik donut keuangan">
        ${seg}
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="12" fill="#8A7A70">${escH(MODE_LABEL[mode])}</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="17" font-weight="800" fill="#2A1A12">${escH(shortRp(total))}</text>
      </svg>`;
      const legend = rows.map((row, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${escH(row.nama)}
        <b style="margin-left:2px">${shortRp(row.val)}</b>
        <span class="muted">${((Math.abs(row.val) / total) * 100).toFixed(1).replace('.', ',')}%</span></span>`).join('');
      return { svg, legend };
    }

    function drawBar(rows, mode) {
      const W = 920, H = 330, padL = 76, padR = 18, padT = 24, padB = rows.length > 8 ? 92 : 62;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const maxV = Math.max(1, ...rows.map(r => Math.abs(r.val)));
      const nice = (() => { const e = Math.pow(10, Math.floor(Math.log10(maxV))); const s = [1, 2, 2.5, 5, 10].find(x => maxV <= x * e) || 10; return s * e; })();
      const y = v => padT + plotH * (1 - Math.abs(v) / nice);
      let grid = '';
      for (let i = 0; i <= 4; i++) {
        const val = (nice / 4) * i, yy = y(val);
        grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#F1E3D8"/>`
          + `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8A7A70">${escH(shortRp(val).replace('Rp ', ''))}</text>`;
      }
      const gw = plotW / rows.length, bw = Math.max(8, Math.min(46, gw * 0.55));
      let bars = '';
      rows.forEach((row, i) => {
        const cx = padL + gw * i + gw / 2;
        const h = Math.max(2, plotH - (y(row.val) - padT));
        const color = PALETTE[i % PALETTE.length];
        const pct = ((Math.abs(row.val) / maxV) * 100).toFixed(1).replace('.', ',');
        bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(row.val).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"
          fill="${color}" opacity=".92" class="chart-hit" data-tip="${escH(row.nama)}|${fmtRp(row.val)}|${pct}% dari nilai tertinggi"></rect>`
          + `<text x="${cx.toFixed(1)}" y="${(y(row.val) - 6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#5B4A40">${escH(shortRp(row.val).replace('Rp ', ''))}</text>`;
        const label = row.nama.length > 18 ? row.nama.slice(0, 17) + '…' : row.nama;
        if (rows.length > 8) {
          bars += `<text x="${cx.toFixed(1)}" y="${(padT + plotH + 12).toFixed(1)}" text-anchor="end" font-size="10" fill="#5B4A40" transform="rotate(-38 ${cx.toFixed(1)} ${(padT + plotH + 12).toFixed(1)})">${escH(label)}</text>`;
        } else {
          bars += `<text x="${cx.toFixed(1)}" y="${(padT + plotH + 17).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#5B4A40">${escH(label)}</text>`;
        }
      });
      return {
        svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagram batang keuangan">${grid}
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#EAD9CC"/>${bars}</svg>`,
        legend: `<span><i style="background:linear-gradient(135deg,#F97316,#EA580C)"></i>${escH(MODE_LABEL[mode])} per BKU</span>
          <span class="muted">Arahkan kursor pada batang untuk melihat nominal &amp; persentase</span>`
      };
    }

    function drawLine(rows, mode, vals) {
      const W = 920, H = 320, padL = 80, padR = 20, padT = 26, padB = 56;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const maxV = Math.max(1, ...vals), minV = Math.min(0, ...vals);
      const span = maxV - minV || 1;
      const x = i => padL + (rows.length === 1 ? plotW / 2 : (plotW / (rows.length - 1)) * i);
      const y = v => padT + plotH * (1 - (v - minV) / span);
      let grid = '';
      for (let i = 0; i <= 4; i++) {
        const val = minV + (span / 4) * i, yy = y(val);
        grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#F1E3D8"/>`
          + `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8A7A70">${escH(shortRp(val).replace('Rp ', ''))}</text>`;
      }
      const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[mode]) || 0).toFixed(1)}`).join(' ');
      const area = `M ${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} L ` + rows.map((r, i) => `${x(i).toFixed(1)},${y(Number(r[mode]) || 0).toFixed(1)}`).join(' L ')
        + ` L ${x(rows.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
      let dots = '';
      rows.forEach((r, i) => {
        const v = Number(r[mode]) || 0;
        dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4.5" fill="#fff" stroke="#EA580C" stroke-width="2.4"
          class="chart-hit" data-tip="${escH(r.label)}|${fmtRp(v)}|${escH(MODE_LABEL[mode])}"></circle>`
          + `<text x="${x(i).toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#5B4A40">${escH(r.label)}</text>`;
      });
      return {
        svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren arus kas">
          <defs><linearGradient id="finArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FB923C" stop-opacity=".38"/><stop offset="1" stop-color="#FB923C" stop-opacity=".03"/></linearGradient></defs>
          ${grid}<path d="${area}" fill="url(#finArea)"/>
          <polyline points="${pts}" fill="none" stroke="#EA580C" stroke-width="2.6" stroke-linejoin="round"/>${dots}</svg>`,
        legend: `<span><i style="background:#EA580C"></i>Tren ${escH(MODE_LABEL[mode])} per bulan</span>
          <span class="muted">${rows.length} bulan pada tahun ajaran aktif</span>`
      };
    }

    host.addEventListener('mouseover', e => {
      const hit = e.target.closest('[data-tip]');
      if (!hit) return;
      const [nm, val, pct] = String(hit.dataset.tip).split('|');
      tip.innerHTML = `<b>${escH(nm)}</b><div>${escH(val)}</div><div class="muted">${escH(pct || '')}</div>`;
      tip.style.display = 'block';
    });
    host.addEventListener('mousemove', e => {
      if (tip.style.display === 'none') return;
      const rect = host.getBoundingClientRect();
      let left = e.clientX - rect.left + 14, top = e.clientY - rect.top + 12;
      if (left + 220 > rect.width) left = Math.max(4, left - 240);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    });
    host.addEventListener('mouseout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-tip]')) tip.style.display = 'none'; });
    if (typeSel) typeSel.addEventListener('change', render);
    if (modeSel) modeSel.addEventListener('change', render);
    render();
  })();

})();

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); alert('Nomor bukti disalin.'); } catch (e) { }
}
function terbilang(n) {
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function t(x) {
    x = Math.floor(Math.abs(x || 0));
    if (x < 12) return satuan[x] || 'nol';
    if (x < 20) return t(x - 10) + ' belas';
    if (x < 100) return t(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + t(x % 10) : '');
    if (x < 200) return 'seratus' + (x % 100 ? ' ' + t(x % 100) : '');
    if (x < 1000) return t(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + t(x % 100) : '');
    if (x < 2000) return 'seribu' + (x % 1000 ? ' ' + t(x % 1000) : '');
    if (x < 1e6) return t(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + t(x % 1000) : '');
    if (x < 1e9) return t(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + t(x % 1e6) : '');
    if (x < 1e12) return t(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + t(x % 1e9) : '');
    return t(Math.floor(x / 1e12)) + ' triliun' + (x % 1e12 ? ' ' + t(x % 1e12) : '');
  }
  const s = t(n).trim().replace(/\s+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + ' rupiah';
}

/* ===== tambahan: ceklis massal, iuran, ekskul, drag & drop leger, hitung ceklis mutasi ===== */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* tombol & kotak "pilih semua / hapus ceklis" */
  function boxes(name) { return $$('input[name="' + name + '"]').filter(b => !b.disabled); }
  $$('[data-check-all]').forEach(btn => btn.addEventListener('click', () => {
    boxes(btn.dataset.checkAll).forEach(b => { b.checked = true; });
    const m = $('[data-check-all-box="' + btn.dataset.checkAll + '"]'); if (m) m.checked = true;
    syncCount();
  }));
  $$('[data-check-none]').forEach(btn => btn.addEventListener('click', () => {
    boxes(btn.dataset.checkNone).forEach(b => { b.checked = false; });
    const m = $('[data-check-all-box="' + btn.dataset.checkNone + '"]'); if (m) m.checked = false;
    syncCount();
  }));
  $$('[data-check-all-box]').forEach(master => master.addEventListener('change', () => {
    boxes(master.dataset.checkAllBox).forEach(b => { b.checked = master.checked; });
    syncCount();
  }));
  document.addEventListener('change', e => { if (e.target && e.target.name) syncCount(); });
  function syncCount() {
    // penghitung generik: <b data-check-count="nama"> untuk grup ceklis apa pun
    $$('[data-check-count]').forEach(el => {
      el.textContent = String(boxes(el.dataset.checkCount).filter(b => b.checked).length);
    });
    const out = document.getElementById('mutasiCount');
    if (out) out.textContent = boxes('siswa_id').filter(b => b.checked).length;
  }
  syncCount();

  /* ===== grup iuran: jenis & mode nominal ===== */
  $$('[data-iuran-form]').forEach(form => {
    const jenis = form.querySelector('[data-iuran-jenis]');
    const wrapBulanan = form.querySelector('[data-jenis="bulanan"]');
    const wrapNon = form.querySelector('[data-jenis="nonbulanan"]');
    function syncJenis() {
      const v = (jenis && jenis.value) || 'bulanan';
      if (wrapBulanan) wrapBulanan.style.display = v === 'bulanan' ? '' : 'none';
      if (wrapNon) wrapNon.style.display = v === 'nonbulanan' ? '' : 'none';
    }
    if (jenis) jenis.addEventListener('change', syncJenis);
    const radios = $$('input[name=mode_nominal]', form);
    const rata = form.querySelector('[data-nominal-rata]');
    const grid = form.querySelector('[data-bulan-grid]');
    function syncMode() {
      const v = (radios.find(r => r.checked) || {}).value || 'rata';
      const rataWrap = rata ? rata.closest('.field') : null;
      if (rataWrap) rataWrap.style.display = v === 'rata' ? '' : 'none';
      if (grid) grid.style.opacity = v === 'rata' ? '.55' : '1';
      if (grid) grid.querySelectorAll('input').forEach(i => { i.disabled = v === 'rata'; });
    }
    radios.forEach(r => r.addEventListener('change', syncMode));
    syncJenis(); syncMode();
  });

  /* ===== form bayar iuran: dibayar = jumlah − potongan ===== */
  const digits = v => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
  $$('[data-jumlah]').forEach(jumlah => {
    const form = jumlah.closest('form');
    const pot = form && form.querySelector('[data-potongan]');
    const dib = form && form.querySelector('[data-dibayar]');
    if (!form || !pot || !dib) return;
    function sync() {
      const j = digits(jumlah.value), p = Math.min(digits(pot.value), j);
      dib.value = (j - p) ? (j - p).toLocaleString('id-ID') : '0';
    }
    jumlah.addEventListener('input', sync);
    pot.addEventListener('input', sync);
    sync();
  });

  /* ===== honor ekskul: jumlah = kehadiran × harga (per baris grid) ===== */
  function ekskulBind(tr) {
    const kehadiran = tr.querySelector('[data-kehadiran]');
    const harga = tr.querySelector('[data-harga]');
    const out = tr.querySelector('[data-jumlah]');
    if (!kehadiran || !harga || !out) return;
    function sync() {
      const k = Number(String(kehadiran.value || '0').replace(',', '.')) || 0;
      const h = digits(harga.value);
      out.value = (k * h) ? Math.round(k * h).toLocaleString('id-ID') : '0';
    }
    kehadiran.addEventListener('input', sync);
    harga.addEventListener('input', sync);
    tr.dataset.ekskulBound = '1';
    sync();
  }
  $$('[data-ekskul-form]').forEach(form => ekskulBind(form));
  $$('[data-ekskul-grid]').forEach(form => {
    const tbody = form.querySelector('[data-ekskul-rows]');
    if (!tbody) return;
    const rowsOf = () => Array.from(tbody.querySelectorAll('tr[data-ekskul-row]'));
    const renumber = () => rowsOf().forEach((tr, i) => { const n = tr.querySelector('.row-no'); if (n) n.textContent = i + 1; });
    rowsOf().forEach(ekskulBind);
    const addBtn = form.querySelector('[data-ekskul-add-row]');
    if (addBtn) addBtn.addEventListener('click', () => {
      const tpl = rowsOf()[0];
      if (!tpl) return;
      const clone = tpl.cloneNode(true);
      clone.querySelectorAll('input').forEach(i => {
        i.value = '';
        if (i.dataset.moneyInit) delete i.dataset.moneyInit;
        if (i.hasAttribute('data-money') && window.__simkeu) window.__simkeu.initMoney(i);
      });
      clone.querySelectorAll('[data-jumlah]').forEach(i => { i.value = ''; });
      tbody.appendChild(clone);
      ekskulBind(clone);
      renumber();
      const first = clone.querySelector('input[name="nama_pembina"]');
      if (first) first.focus();
    });
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('[data-ekskul-del-row]');
      if (!btn) return;
      const tr = btn.closest('tr[data-ekskul-row]');
      if (!tr) return;
      if (rowsOf().length > 1) { tr.remove(); renumber(); }
      else tr.querySelectorAll('input:not([type=hidden])').forEach(i => { i.value = ''; });
    });
  });

  /* tombol submit dengan konfirmasi sendiri (mis. bayar di dalam form multi-aksi) */
  $$('[data-confirm-click]').forEach(btn => btn.addEventListener('click', e => {
    if (!confirm(btn.dataset.confirmClick)) { e.preventDefault(); e.stopPropagation(); }
  }));

  /* ===== drag & drop urutan nama leger honor ===== */
  const payTable = document.querySelector('.payroll-table');
  const formUrut = document.getElementById('fUrutan');
  if (payTable && formUrut) {
    const tbody = payTable.querySelector('tbody');
    let dragged = null;
    tbody.querySelectorAll('tr[data-rid]').forEach(tr => {
      const handle = tr.querySelector('.drag-handle');
      if (handle) handle.addEventListener('dragstart', e => {
        dragged = tr;
        tr.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', tr.dataset.rid); e.dataTransfer.effectAllowed = 'move'; } catch (err) { }
      });
      if (handle) handle.addEventListener('dragend', () => { tr.classList.remove('dragging'); $$('tr.drag-over', tbody).forEach(x => x.classList.remove('drag-over')); dragged = null; });
      tr.addEventListener('dragover', e => {
        if (!dragged || dragged === tr) return;
        e.preventDefault();
        tr.classList.add('drag-over');
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
      tr.addEventListener('drop', e => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        if (!dragged || dragged === tr) return;
        const rect = tr.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        tbody.insertBefore(dragged, after ? tr.nextSibling : tr);
        submitOrder();
      });
    });
    function submitOrder() {
      const ids = $$('tr[data-rid]', tbody).map(tr => tr.dataset.rid);
      formUrut.querySelector('input[name=ids]').value = ids.join(',');
      formUrut.submit();
    }
  }
})();

/* ===== tambahan ronde: toggle BKU piutang sertifikasi, review payroll, ceklis grup ===== */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* toggle "Masuk ke BKU" pada form pembayaran piutang sertifikasi */
  $$('[data-pl-bku]').forEach(chk => {
    const form = chk.closest('form');
    const wrap = form ? form.querySelector('[data-pl-bku-wrap]') : null;
    const label = form ? form.querySelector('[data-pl-bku-label]') : null;
    const sel = wrap ? wrap.querySelector('select') : null;
    function sync() {
      if (wrap) wrap.style.display = chk.checked ? '' : 'none';
      if (sel) sel.disabled = !chk.checked;
      if (label) label.textContent = chk.checked
        ? 'Pembayaran dicatat sebagai pemasukan pada BKU penerima'
        : 'Pembayaran hanya mengurangi piutang (tidak masuk BKU)';
    }
    chk.addEventListener('change', sync);
    sync();
  });

  /* ceklis semua untuk grup input berbasis data-check-group (mis. rekonsiliasi bank) */
  $$('[data-check-group-box]').forEach(master => {
    master.addEventListener('change', () => {
      $$('input[data-check-group="' + master.dataset.checkGroupBox + '"]').forEach(b => {
        if (!b.disabled) b.checked = master.checked;
      });
    });
  });
  $$('[data-check-group-all]').forEach(btn => btn.addEventListener('click', () => {
    const g = btn.dataset.checkGroupAll;
    $$('input[data-check-group="' + g + '"]').forEach(b => { if (!b.disabled) b.checked = true; });
    const m = document.querySelector('[data-check-group-box="' + g + '"]'); if (m) m.checked = true;
  }));
  $$('[data-check-group-none]').forEach(btn => btn.addEventListener('click', () => {
    const g = btn.dataset.checkGroupNone;
    $$('input[data-check-group="' + g + '"]').forEach(b => { b.checked = false; });
    const m = document.querySelector('[data-check-group-box="' + g + '"]'); if (m) m.checked = false;
  }));

  /* ===== leger payroll: state form selalu memakai data terbaru (anti "data stuck") ===== */
  (function payrollFreshState() {
    // Saat pengguna kembali ke halaman payroll (back/forward), browser bisa menampilkan
    // salinan form lama dari cache. Paksa muat ulang agar tabel & nilai selalu versi terbaru.
    window.addEventListener('pageshow', e => { if (e.persisted) window.location.reload(); });
    const payForm = document.getElementById('fPayroll');
    if (!payForm) return;
    let submitting = false;
    payForm.addEventListener('submit', () => {
      if (submitting) return;
      submitting = true;   // titik ribuan sudah dilepas oleh handler global submit capture
      const btn = payForm.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.innerHTML = 'Menyimpan…'; }
    });
  }());

  /* ===== beasiswa: multi grup iuran, filter kelas tanpa reload, kalkulator & rekap ===== */
  const beaForm = document.querySelector('[data-bea-form]');
  if (beaForm) {
    const digits = v => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
    const fmt = n => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
    const nominalIn = beaForm.querySelector('[data-bea-nominal]');
    const persenIn = beaForm.querySelector('[data-bea-persen]');
    const wrapBulan = document.querySelector('[data-bea-bulan-wrap]');
    const grupChecks = Array.from(document.querySelectorAll('[data-bea-group]'));
    const bulanChecks = Array.from(document.querySelectorAll('[data-bea-bulan]'));
    let nominalMap = {};
    try {
      const mapEl = document.querySelector('[data-bea-nominal-map]');
      nominalMap = mapEl ? JSON.parse(mapEl.textContent || '{}') : {};
    } catch (e) { nominalMap = {}; }

    const selectedGroups = () => grupChecks.filter(c => c.checked).map(c => ({
      id: c.value, jenis: c.dataset.jenis || '', nama: (c.closest('label') ? (c.closest('label').querySelector('b') || {}).textContent : '') || ''
    }));
    const selectedBulan = () => bulanChecks.filter(c => c.checked).map(c => Number(c.value));
    const hasBulanan = () => selectedGroups().some(g => g.jenis === 'bulanan');

    function tagihanTotal() {
      const bulan = selectedBulan();
      let total = 0;
      for (const g of selectedGroups()) {
        const map = nominalMap[g.id] || {};
        if (g.jenis === 'bulanan') {
          const use = bulan.length ? bulan : Object.keys(map).filter(k => k !== 'all').map(Number);
          total += use.reduce((a, b) => a + Number(map[String(b)] || 0), 0);
        } else {
          total += Number(map.all || 0);
        }
      }
      return total;
    }
    function perSiswa() {
      const nom = digits(nominalIn ? nominalIn.value : '');
      if (nom > 0) return nom;
      const pct = Number(String(persenIn ? persenIn.value : '').replace(',', '.')) || 0;
      const base = tagihanTotal();
      return base > 0 && pct > 0 ? Math.round(base * pct / 100) : 0;
    }
    const jumlahSiswa = () => Array.from(document.querySelectorAll('input[name="penerima"]:checked')).length;

    function syncBulanWrap() {
      if (wrapBulan) wrapBulan.style.display = hasBulanan() ? '' : 'none';
    }
    function updateRekap() {
      const base = tagihanTotal();
      const per = perSiswa();
      const n = jumlahSiswa();
      const set = (sel, txt) => document.querySelectorAll(sel).forEach(el => { el.textContent = txt; });
      set('[data-bea-tagihan]', fmt(base));
      set('[data-bea-per-siswa]', fmt(per));
      set('[data-bea-jumlah]', String(n));
      set('[data-bea-total]', fmt(per * n));
      set('[data-bea-r-per]', fmt(per));
      set('[data-bea-r-siswa]', String(n));
      set('[data-bea-r-total]', fmt(per * n));
      const nm = beaForm.querySelector('input[name=nama]');
      set('[data-bea-r-nama]', (nm && nm.value.trim()) || '(belum diisi)');
      const gs = selectedGroups().map(g => g.nama.trim()).filter(Boolean);
      set('[data-bea-r-grup]', gs.length ? gs.join(', ') : '-');
      const bl = selectedBulan();
      set('[data-bea-r-bulan]', bl.length ? bl.map(b => ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][b - 1] || b).join(', ') : 'Semua bulan yang ditagihkan');
    }
    // kalkulator dua arah
    let lastEdit = 'nominal';
    if (nominalIn) {
      ['input', 'change'].forEach(ev => nominalIn.addEventListener(ev, () => { lastEdit = 'nominal'; if (persenIn) { const base = tagihanTotal(); const nom = digits(nominalIn.value); persenIn.value = (base > 0 && nom) ? String(Math.round(nom / base * 1000) / 10).replace('.', ',') : ''; } updateRekap(); }));
    }
    if (persenIn) {
      ['input', 'change'].forEach(ev => persenIn.addEventListener(ev, () => {
        lastEdit = 'persen';
        const base = tagihanTotal();
        const pct = Number(String(persenIn.value || '').replace(',', '.')) || 0;
        if (nominalIn) nominalIn.value = (base > 0 && pct > 0) ? Math.round(base * pct / 100).toLocaleString('id-ID') : '';
        updateRekap();
      }));
    }
    grupChecks.forEach(c => c.addEventListener('change', () => { syncBulanWrap(); if (lastEdit === 'persen' && persenIn) persenIn.dispatchEvent(new Event('input')); updateRekap(); }));
    bulanChecks.forEach(c => c.addEventListener('change', () => { if (lastEdit === 'persen' && persenIn) persenIn.dispatchEvent(new Event('input')); updateRekap(); }));
    document.querySelectorAll('[data-bea-bulan-all]').forEach(b => b.addEventListener('click', () => { bulanChecks.forEach(c => { c.checked = true; }); updateRekap(); }));
    document.querySelectorAll('[data-bea-bulan-none]').forEach(b => b.addEventListener('click', () => { bulanChecks.forEach(c => { c.checked = false; }); updateRekap(); }));

    /* ----- filter kelas & pencarian siswa (tanpa reload halaman) ----- */
    const kelasSel = document.querySelector('[data-bea-kelas]');
    const srcIn = document.querySelector('[data-bea-search]');
    function applyFilter() {
      const k = kelasSel ? kelasSel.value : '';
      const q = srcIn ? srcIn.value.trim().toLowerCase() : '';
      document.querySelectorAll('tr[data-bea-row]').forEach(tr => {
        const okKelas = !k || tr.dataset.kelas === k;
        const okQ = !q || String(tr.dataset.cari || '').includes(q);
        tr.style.display = okKelas && okQ ? '' : 'none';
      });
      updateRekap();
    }
    if (kelasSel) kelasSel.addEventListener('change', applyFilter);
    if (srcIn) srcIn.addEventListener('input', applyFilter);
    document.querySelectorAll('[data-bea-pick-visible]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('tr[data-bea-row]').forEach(tr => {
        if (tr.style.display === 'none') return;
        const c = tr.querySelector('input[name="penerima"]');
        if (c) c.checked = true;
      });
      updateRekap();
    }));
    document.querySelectorAll('[data-bea-unpick]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('input[name="penerima"]').forEach(c => { c.checked = false; });
      updateRekap();
    }));
    document.addEventListener('change', e => { if (e.target && e.target.name === 'penerima') updateRekap(); });
    if (beaForm) {
      const nmIn = beaForm.querySelector('input[name=nama]');
      if (nmIn) nmIn.addEventListener('input', updateRekap);
      beaForm.addEventListener('submit', e => {
        if (!selectedGroups().length) { e.preventDefault(); alert('Centang minimal satu grup iuran yang mendapat beasiswa.'); return; }
        if (!jumlahSiswa()) { e.preventDefault(); alert('Centang minimal satu siswa penerima beasiswa.'); return; }
        if (!perSiswa()) { e.preventDefault(); alert('Isi nominal potongan atau persentase beasiswa.'); return; }
      });
    }
    // selaraskan nominal/persentase saat halaman dibuka
    if (nominalIn && digits(nominalIn.value) > 0 && persenIn && !String(persenIn.value || '').trim()) {
      const base = tagihanTotal();
      if (base > 0) persenIn.value = String(Math.round(digits(nominalIn.value) / base * 1000) / 10).replace('.', ',');
    }
    syncBulanWrap();
    updateRekap();
  }

  /* ===== dashboard iuran: filter metode (tunai / transfer) realtime ===== */
  const selMetode = document.querySelector('[data-iuran-metode]');
  const tblGrup = document.getElementById('tblGrupIuran');
  if (selMetode && tblGrup) {
    const rp = n => (Number(n) || 0) ? 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID') : '—';
    function applyMetode() {
      const m = selMetode.value;
      const pick = el => m === 'all'
        ? Number(el.dataset.tunai || 0) + Number(el.dataset.transfer || 0)
        : Number(el.dataset[m] || 0);
      const monthTotals = {};
      let grandAll = 0;
      tblGrup.querySelectorAll('tbody tr[data-grup-row]').forEach(tr => {
        let grand = 0;
        tr.querySelectorAll('td[data-tunai]').forEach(td => {
          const v = pick(td);
          td.textContent = rp(v);
          grand += v;
          const mo = td.cellIndex;
          monthTotals[mo] = (monthTotals[mo] || 0) + v;
        });
        const totCell = tr.querySelector('[data-total-tunai]');
        if (totCell) totCell.textContent = rp(grand);
        grandAll += grand;
      });
      tblGrup.querySelectorAll('tfoot td[data-foot-bulan]').forEach((td, i) => {
        td.textContent = rp(monthTotals[i + 1] || 0);
      });
      const footTotal = tblGrup.querySelector('[data-foot-total]');
      if (footTotal) footTotal.textContent = rp(grandAll);
    }
    selMetode.addEventListener('change', applyMetode);
    applyMetode();
  }

  /* ===== autocomplete nama (portal publik & form internal) ===== */
  $$('input[data-autocomplete]').forEach(inp => {
    const wrap = inp.closest('.field') || inp.parentElement;
    const list = wrap ? wrap.querySelector('[data-ac-list]') : null;
    const url = inp.dataset.autocomplete;
    const min = Number(inp.dataset.autocompleteMin || 3);
    if (!list || !url) return;
    let timer = null, lastQ = '', items = [];
    function hide() { list.classList.remove('show'); list.innerHTML = ''; items = []; }
    function render() {
      list.innerHTML = items.map((it, i) =>
        `<button type="button" class="ac-item" data-ac-idx="${i}"><b>${it.label.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</b></button>`).join('');
      list.classList.add('show');
    }
    inp.addEventListener('input', () => {
      const q = inp.value.trim();
      if (q.length < min) { hide(); return; }
      if (q === lastQ) return;
      lastQ = q;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const r = await fetch(url + '?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
          const j = await r.json();
          items = (j && j.items) || [];
          if (!items.length) { hide(); return; }
          render();
        } catch (e) { hide(); }
      }, 220);
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-ac-idx]');
      if (!b) return;
      const it = items[Number(b.dataset.acIdx)];
      if (!it) return;
      inp.value = it.nama;
      hide();
      inp.focus();
    });
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) hide(); });
    inp.addEventListener('blur', () => setTimeout(hide, 180));
  });

  /* ===== toggle "Hanya Simpan Data Pembayaran (Non-BKU)" ===== */
  $$('[data-nonbku]').forEach(chk => {
    const form = chk.closest('form');
    if (!form) return;
    const sel = form.querySelector('[data-bku-select]');
    function sync() {
      if (!sel) return;
      sel.disabled = chk.checked;
      sel.required = !chk.checked;
      sel.style.opacity = chk.checked ? '.55' : '1';
    }
    chk.addEventListener('change', sync);
    sync();
  });

  /* ===== Bayar Item Terpilih: modal input massal per item ===== */
  const bulkBtn = document.querySelector('[data-bulk-pay]');
  if (bulkBtn) {
    const scope = document.querySelector('#fItems') || document;
    const modal = document.getElementById('mBayarItem');
    const rowsHost = modal ? modal.querySelector('[data-bulk-rows]') : null;
    const nInput = modal ? modal.querySelector('[data-bulk-n]') : null;
    const defaultDate = modal ? modal.querySelector('[data-bulk-date]') : null;
    const defaultBku = modal ? modal.querySelector('[data-bulk-bku]') : null;
    const bkuOptions = defaultBku ? Array.from(defaultBku.options).map(o => `<option value="${o.value}">${o.textContent.replace(/</g, '')}</option>`).join('') : '';
    const thousands = v => (v ? Number(v).toLocaleString('id-ID') : '');
    bulkBtn.addEventListener('click', () => {
      const checked = Array.from(scope.querySelectorAll('input[name="item"]:checked'));
      if (!checked.length) { alert('Centang minimal satu item iuran (grup atau bulan) terlebih dahulu.'); return; }
      rowsHost.innerHTML = checked.map((c, i) => {
        const sisa = Number(c.dataset.sisa || 0);
        const label = (c.dataset.label || c.value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<tr>
          <td><input type="hidden" name="key_${i}" value="${c.value}"><div class="t-strong">${label}</div>
            <div class="t-sub">Sisa ${'Rp ' + thousands(sisa)}</div></td>
          <td><input type="date" name="tanggal_${i}" value="${defaultDate ? defaultDate.value : ''}"></td>
          <td><select name="metode_${i}"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></td>
          <td><input type="text" inputmode="numeric" name="jumlah_${i}" value="${thousands(sisa)}" data-money data-bulk-money></td>
          <td><input type="text" inputmode="numeric" name="potongan_${i}" value="" data-money data-bulk-money></td>
          <td><select name="bku_${i}" data-bulk-row-bku>${bkuOptions}</select></td>
          <td class="center"><input type="checkbox" name="nonbku_${i}" value="1" data-bulk-nonbku></td>
        </tr>`;
      }).join('');
      nInput.value = String(checked.length);
      rowsHost.querySelectorAll('[data-bulk-money]').forEach(i => window.__simkeu && window.__simkeu.initMoney(i));
      if (defaultBku && defaultBku.value) rowsHost.querySelectorAll('[data-bulk-row-bku]').forEach(sel => { sel.value = defaultBku.value; });
      rowsHost.querySelectorAll('[data-bulk-nonbku]').forEach(chk => chk.addEventListener('change', () => {
        const sel = chk.closest('tr').querySelector('[data-bulk-row-bku]');
        sel.disabled = chk.checked;
        sel.style.opacity = chk.checked ? '.55' : '1';
      }));
      if (defaultDate) defaultDate.onchange = () => rowsHost.querySelectorAll('input[type=date]').forEach(d => { d.value = defaultDate.value; });
      if (defaultBku) defaultBku.onchange = () => rowsHost.querySelectorAll('[data-bulk-row-bku]').forEach(sel => { sel.value = defaultBku.value; });
      window.__openModal('mBayarItem');
    });
  }

  /* rincian bulanan: sembunyikan/tampilkan sub-baris */
  $$('[data-month-toggle]').forEach(btn => btn.addEventListener('click', () => {
    const rows = $$('tr.month-row[data-group="' + btn.dataset.monthToggle + '"]');
    const hide = rows.some(r => r.style.display !== 'none');
    rows.forEach(r => { r.style.display = hide ? 'none' : ''; });
    btn.textContent = hide ? 'Tampilkan rincian bulan' : 'Sembunyikan rincian bulan';
  }));

  /* ===== tema & branding: pratinjau warna + unggah ikon menu ===== */
  (function () {
    const pick = document.querySelector('[data-tema-pick]');
    const hex = document.querySelector('[data-tema-hex]');
    const root = document.documentElement;
    function hsl(hexv) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hexv || '').trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      let h = 0; const l = (max + min) / 2;
      const s = d ? (l > 0.5 ? d / (2 - max - min) : d / (max + min)) : 0;
      if (d) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
    }
    function apply(hexv) {
      const c = hsl(hexv);
      if (!c) return;
      const sat = Math.max(35, Math.min(100, c.s));
      const base = `hsl(${c.h} ${sat}% ${c.l}%)`;
      const v = [['--o-500', base], ['--o-600', `hsl(${c.h} ${sat}% ${Math.max(20, c.l - 6)}%)`],
        ['--o-700', `hsl(${c.h} ${sat}% ${Math.max(16, c.l - 13)}%)`], ['--o-300', `hsl(${c.h} ${sat}% ${Math.min(88, c.l + 22)}%)`],
        ['--o-100', `hsl(${c.h} ${Math.max(45, sat - 10)}% 94%)`], ['--o-50', `hsl(${c.h} ${Math.max(45, sat - 15)}% 97%)`]];
      v.forEach(([k, val]) => root.style.setProperty(k, val));
    }
    if (pick && hex) {
      const sync = src => {
        if (src === 'pick' && pick.value) hex.value = String(pick.value).toUpperCase();
        if (src === 'hex' && /^#?[0-9a-fA-F]{6}$/.test(hex.value.trim())) {
          const val = '#' + hex.value.trim().replace('#', '');
          pick.value = val; apply(val); return;
        }
        apply(pick.value);
      };
      pick.addEventListener('input', () => sync('pick'));
      hex.addEventListener('input', () => sync('hex'));
    }
    $$('[data-tema-set]').forEach(b => b.addEventListener('click', () => {
      const val = b.dataset.temaSet;
      if (pick) pick.value = val;
      if (hex) hex.value = val;
      apply(val);
    }));
    /* pratinjau ikon menu saat berkas dipilih */
    $$('[data-ico-input]').forEach(inp => {
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const box = document.querySelector('[data-ico-preview="' + inp.dataset.icoInput + '"]');
        if (!box) return;
        if (!/png$/i.test(f.type) && !/\.png$/i.test(f.name)) { alert('Ikon menu harus berkas PNG.'); inp.value = ''; return; }
        const url = URL.createObjectURL(f);
        box.innerHTML = '<img src="' + url + '" alt="">';
      });
    });
  }());

  /* ===== manajer tampilan menu: drag & drop baris + kelompok ===== */
  (function () {
    const form = document.getElementById('fMenu');
    if (!form) return;
    const rowsOf = () => $$('.menu-tbl tbody');
    function renumber() {
      rowsOf().forEach(tb => Array.from(tb.querySelectorAll('tr.drag-row')).forEach((tr, i) => {
        const n = tr.querySelector('[data-rownum]');
        if (n) n.textContent = String(i + 1);
      }));
    }
    /* geser baris dengan tombol ▲▼ */
    $$('[data-row-up]').forEach(b => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      if (tr && tr.previousElementSibling) { tr.parentNode.insertBefore(tr, tr.previousElementSibling); renumber(); }
    }));
    $$('[data-row-down]').forEach(b => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      if (tr && tr.nextElementSibling) { tr.parentNode.insertBefore(tr.nextElementSibling, tr); renumber(); }
    }));
    /* drag & drop baris */
    let dragRow = null;
    $$('tr.drag-row').forEach(tr => {
      tr.addEventListener('dragstart', e => {
        dragRow = tr; tr.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', tr.dataset.href || ''); } catch (err) { }
        e.dataTransfer.effectAllowed = 'move';
      });
      tr.addEventListener('dragend', () => { tr.classList.remove('dragging'); $$('tr.drag-row').forEach(x => x.classList.remove('drop-before', 'drop-after')); dragRow = null; });
      tr.addEventListener('dragover', e => {
        if (!dragRow || dragRow === tr || dragRow.parentNode !== tr.parentNode) return;
        e.preventDefault();
        const r = tr.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        tr.classList.toggle('drop-before', before);
        tr.classList.toggle('drop-after', !before);
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('drop-before', 'drop-after'));
      tr.addEventListener('drop', e => {
        if (!dragRow || dragRow === tr || dragRow.parentNode !== tr.parentNode) return;
        e.preventDefault();
        const before = tr.classList.contains('drop-before');
        tr.parentNode.insertBefore(dragRow, before ? tr : tr.nextSibling);
        tr.classList.remove('drop-before', 'drop-after');
        renumber();
      });
    });
    /* geser kelompok menu */
    const moveGroup = (card, dir) => {
      const parent = card.parentNode;
      const sib = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
      if (sib && sib.classList.contains('menu-group')) {
        parent.insertBefore(dir < 0 ? card : sib, dir < 0 ? sib : card);
      }
    };
    $$('[data-group-up]').forEach(b => b.addEventListener('click', () => moveGroup(b.closest('.menu-group'), -1)));
    $$('[data-group-down]').forEach(b => b.addEventListener('click', () => moveGroup(b.closest('.menu-group'), 1)));
    let dragGroup = null;
    $$('.menu-group').forEach(card => {
      card.addEventListener('dragstart', e => {
        if (e.target.closest('tr')) { e.stopPropagation(); return; }
        dragGroup = card; card.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', card.dataset.groupid || ''); } catch (err) { }
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragGroup = null; });
      card.addEventListener('dragover', e => { if (dragGroup && dragGroup !== card) { e.preventDefault(); } });
      card.addEventListener('drop', e => {
        if (!dragGroup || dragGroup === card) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        card.parentNode.insertBefore(dragGroup, before ? card : card.nextSibling);
      });
    });
    /* tombol per kelompok: tampilkan / sembunyikan */
    $$('[data-menu-all]').forEach(b => b.addEventListener('click', () => {
      const card = b.closest('.menu-group');
      card.querySelectorAll('input[name="show"]').forEach(c => { if (!c.disabled) c.checked = true; });
    }));
    $$('[data-menu-none]').forEach(b => b.addEventListener('click', () => {
      const card = b.closest('.menu-group');
      card.querySelectorAll('input[name="show"]').forEach(c => { if (!c.disabled) c.checked = false; });
    }));
    /* saat submit: kirim urutan baris & kelompok */
    form.addEventListener('submit', () => {
      const order = [];
      $$('.menu-group').forEach(card => card.querySelectorAll('tr.drag-row').forEach(tr => order.push(tr.dataset.href)));
      const go = $$('.menu-group').map(c => c.dataset.groupid);
      const o = document.getElementById('nav_order'); if (o) o.value = order.join(',');
      const g = document.getElementById('group_order'); if (g) g.value = go.join(',');
    });
    renumber();
  }());
})();

var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
var qs = function (sel, root) { return (root || document).querySelector(sel); };

/* ---------- reset password (panel Super Admin): generate & salin kredensial ---------- */
function pwAcak(len) {
  var L = 'abcdefghijkmnopqrstuvwxyz', U = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var D = '23456789', S = '#@$%&*!?';
  var all = L + U + D + S, out = [];
  out.push(U[Math.floor(Math.random() * U.length)]);
  out.push(L[Math.floor(Math.random() * L.length)]);
  out.push(D[Math.floor(Math.random() * D.length)]);
  out.push(S[Math.floor(Math.random() * S.length)]);
  while (out.length < (len || 12)) out.push(all[Math.floor(Math.random() * all.length)]);
  for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = out[i]; out[i] = out[j]; out[j] = t; }
  return out.join('');
}
qsa('[data-generate-pw]').forEach(function (b) {
  b.addEventListener('click', function () {
    var form = b.closest('form');
    var inp = form && form.querySelector('.js-newpw');
    if (!inp) return;
    inp.value = pwAcak(12);
    inp.type = 'text';
    inp.focus();
    inp.select && inp.select();
  });
});
qsa('[data-copy-login]').forEach(function (b) {
  b.addEventListener('click', function () {
    var text = b.getAttribute('data-copy-text') || '';
    function done() {
      var old = b.innerHTML;
      b.innerHTML = '✓ Tersalin';
      setTimeout(function () { b.innerHTML = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { window.prompt('Salin kredensial:', text); });
    } else { window.prompt('Salin kredensial:', text); }
  });
});

/* ---------- Leger honor DINAMIS: hitung ulang baris & footer ---------- */
(function payrollDynamic() {
  var cols = window.__PAY_COLS || [];
  var base = window.__PAY_VARS || {};
  if (!cols.length || !document.querySelector('[data-payroll-row]')) return;

  function num(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (!s) return 0;
    s = s.replace(/\s|Rp/gi, '');
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/\./g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  // evaluator rumus kecil (mirror payrollEval di server)
  function evaluate(expr, vars) {
    var src = String(expr || '').replace(/\s+/g, '');
    var i = 0;
    function peek() { return src[i]; }
    function number() {
      var m = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (!m) throw new Error('angka');
      i += m[0].length; return Number(m[0]);
    }
    function factor() {
      if (peek() === '(') { i++; var v = additive(); if (peek() !== ')') throw new Error(')'); i++; return v; }
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '+') { i++; return factor(); }
      if (/[0-9.]/.test(peek() || '')) return number();
      var m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (!m) throw new Error('token');
      i += m[0].length;
      var name = m[0];
      if (peek() === '(') {
        i++; var args = [];
        if (peek() !== ')') { for (;;) { args.push(additive()); if (peek() === ',') { i++; continue; } break; } }
        if (peek() !== ')') throw new Error(')');
        i++;
        if (name === 'round') return Math.round(args[0] || 0);
        if (name === 'min') return Math.min.apply(null, args);
        if (name === 'max') return Math.max.apply(null, args);
        if (name === 'abs') return Math.abs(args[0] || 0);
        throw new Error('fungsi');
      }
      return Number(vars[name]) || 0;
    }
    function multiplicative() {
      var v = factor();
      while (peek() === '*' || peek() === '/') {
        var op = src[i++], r = factor();
        v = op === '*' ? v * r : (r === 0 ? 0 : v / r);
      }
      return v;
    }
    function additive() {
      var v = multiplicative();
      while (peek() === '+' || peek() === '-') {
        var op = src[i++], r = multiplicative();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    if (!src) return 0;
    var out = additive();
    if (i !== src.length) throw new Error('sisa');
    return out;
  }

  function fmt(n, satuan) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    if (satuan === 'jam') return String(n).replace('.', ',');
    return Math.round(n).toLocaleString('id-ID');
  }

  function recalc() {
    var foot = {};
    var totP = 0, totK = 0;
    qsa('[data-payroll-row]').forEach(function (tr) {
      var vars = Object.assign({}, base);
      // nilai manual dulu
      qsa('.js-din', tr).forEach(function (inp) {
        vars[inp.getAttribute('data-kode')] = num(inp.value);
      });
      // kolom berumus: beberapa lintasan agar bisa saling rujuk
      for (var pass = 0; pass < 3; pass++) {
        cols.forEach(function (c) {
          if (!c.rumus) return;
          try { vars[c.kode] = Math.round(evaluate(c.rumus, vars) * 100) / 100; } catch (e) { vars[c.kode] = Number(vars[c.kode]) || 0; }
        });
      }
      // tulis hasil rumus ke sel
      qsa('.js-calc', tr).forEach(function (el) {
        var k = el.getAttribute('data-kode');
        el.textContent = fmt(vars[k], el.getAttribute('data-satuan'));
      });
      var P = 0, K = 0;
      cols.forEach(function (c) {
        var v = Number(vars[c.kode]) || 0;
        if (c.tipe === 'penerimaan') P += v;
        else if (c.tipe === 'potongan') K += v;
        foot[c.kode] = (foot[c.kode] || 0) + v;
      });
      P = Math.round(P); K = Math.round(K);
      totP += P; totK += K;
      var ep = qs('.js-penerimaan', tr), ek = qs('.js-potongan', tr), ed = qs('.js-diterima', tr);
      if (ep) ep.textContent = 'Rp ' + P.toLocaleString('id-ID');
      if (ek) ek.textContent = 'Rp ' + K.toLocaleString('id-ID');
      if (ed) {
        ed.textContent = 'Rp ' + (P - K).toLocaleString('id-ID');
        ed.style.color = (P - K) < 0 ? 'var(--red)' : 'var(--ink)';
      }
    });
    // footer mengikuti urutan & nama kolom
    cols.forEach(function (c) {
      var cell = document.querySelector('[data-foot-kode="' + c.kode + '"]');
      if (cell) cell.textContent = fmt(foot[c.kode] || 0, c.satuan);
    });
    var fp = document.querySelector('[data-foot="penerimaan"]');
    var fk = document.querySelector('[data-foot="potongan"]');
    var fd = document.querySelector('[data-foot="diterima"]');
    if (fp) fp.textContent = 'Rp ' + totP.toLocaleString('id-ID');
    if (fk) fk.textContent = 'Rp ' + totK.toLocaleString('id-ID');
    if (fd) fd.textContent = 'Rp ' + (totP - totK).toLocaleString('id-ID');
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('js-din')) recalc();
  });
  recalc();
})();

/* ---------- iuran: pindah tingkat tarif (reload, bukan submit POST) ---------- */
qsa('[data-nominal-tingkat-jump]').forEach(function (sel) {
  sel.addEventListener('change', function () {
    var base = sel.getAttribute('data-nominal-tingkat-jump');
    var v = sel.value;
    window.location.href = base + (v ? '?tingkat=' + encodeURIComponent(v) + '#nominal' : '#nominal');
  });
  sel.removeAttribute('data-autosubmit');
  sel.setAttribute('data-no-autosubmit', '1');
});

/* ---------- ceklis generik berdasarkan atribut name (mis. daftar fitur paket) ---------- */
qsa('[data-check-name-all],[data-check-name-none]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var name = btn.getAttribute('data-check-name-all') || btn.getAttribute('data-check-name-none');
    var on = btn.hasAttribute('data-check-name-all');
    var scope = btn.closest('form') || document;
    qsa('input[name="' + name + '"]', scope).forEach(function (i) { if (!i.disabled) i.checked = on; });
  });
});
