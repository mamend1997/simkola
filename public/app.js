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

  /* ===== beasiswa: kalkulator nominal ↔ persentase, bulan, pratinjau ===== */
  const beaForm = document.querySelector('[data-bea-form]');
  if (beaForm) {
    const grupSel = beaForm.querySelector('[data-bea-grup]');
    const wrapBulan = beaForm.querySelector('[data-bea-bulan-wrap]');
    const nominalIn = beaForm.querySelector('[data-bea-nominal]');
    const persenIn = beaForm.querySelector('[data-bea-persen]');
    const digits = v => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
    const fmt = n => (Number(n) || 0).toLocaleString('id-ID');
    const baseTagihan = () => {
      const opt = grupSel && grupSel.selectedOptions[0];
      if (!opt) return 0;
      const isBulanan = opt.dataset.jenis === 'bulanan';
      if (!isBulanan) return Number(opt.dataset.nominal || 0);
      return Array.from(beaForm.querySelectorAll('[data-bea-bulan]:checked'))
        .reduce((a, c) => a + Number(c.dataset.bulanNominal || 0), 0);
    };
    // nominal per bulan mengikuti grup yang dipilih
    let nominalMap = {};
    try {
      const mapEl = beaForm.querySelector('[data-bea-nominal-map]');
      nominalMap = mapEl ? JSON.parse(mapEl.textContent || '{}') : {};
    } catch (e) { nominalMap = {}; }
    function syncNominalBulan() {
      const gid = grupSel ? grupSel.value : '';
      const list = nominalMap[gid] || [];
      const byMonth = {};
      list.forEach(x => { byMonth[String(x.b)] = Number(x.n || 0); });
      beaForm.querySelectorAll('[data-bea-bulan]').forEach(chk => {
        const val = byMonth[String(chk.value)] || 0;
        chk.dataset.bulanNominal = String(val);
        const lbl = chk.closest('label') ? chk.closest('label').querySelector('[data-bea-bulan-nom]') : null;
        if (lbl) lbl.textContent = val ? 'Rp ' + val.toLocaleString('id-ID') : '-';
      });
    }
    function syncJenis() {
      const opt = grupSel && grupSel.selectedOptions[0];
      const isBulanan = opt && opt.dataset.jenis === 'bulanan';
      if (wrapBulan) wrapBulan.style.display = isBulanan ? '' : 'none';
      syncNominalBulan();
    }
    // kalkulator dua arah: sumber perubahan menentukan arah perhitungan
    function fromNominal() {
      const base = baseTagihan();
      if (!(base > 0)) return;
      const nom = digits(nominalIn.value);
      persenIn.value = nom ? String(Math.round((nom / base) * 1000) / 10).replace('.', ',') : '';
    }
    function fromPersen() {
      const base = baseTagihan();
      const pct = Number(String(persenIn.value || '').replace(',', '.')) || 0;
      nominalIn.value = (base > 0 && pct > 0) ? fmt(Math.round(base * pct / 100)) : '';
    }
    if (grupSel) grupSel.addEventListener('change', () => { syncJenis(); fromNominal(); });
    if (nominalIn) { nominalIn.addEventListener('input', fromNominal); nominalIn.addEventListener('change', fromNominal); }
    if (persenIn) { persenIn.addEventListener('input', fromPersen); persenIn.addEventListener('change', fromPersen); }
    $$('[data-bea-bulan]', beaForm).forEach(chk => chk.addEventListener('change', fromNominal));
    $$('[data-bea-bulan-all]', beaForm).forEach(b => b.addEventListener('click', () => {
      $$('[data-bea-bulan]', beaForm).forEach(c => { c.checked = true; }); fromNominal();
    }));
    $$('[data-bea-bulan-none]', beaForm).forEach(b => b.addEventListener('click', () => {
      $$('[data-bea-bulan]', beaForm).forEach(c => { c.checked = false; }); fromNominal();
    }));
    syncJenis();

    /* ----- pratinjau + simpan final ----- */
    const finalForm = document.getElementById('fBeaFinal');
    const previewBtn = document.querySelector('[data-bea-preview]');
    const saveBtn = document.querySelector('[data-bea-save]');
    if (finalForm && previewBtn) {
      previewBtn.addEventListener('click', () => {
        const nama = (beaForm.querySelector('input[name=nama]') || {}).value || '';
        const grupId = grupSel ? grupSel.value : '';
        const opt = grupSel && grupSel.selectedOptions[0];
        if (!nama.trim()) { alert('Isi nama beasiswa terlebih dahulu.'); return; }
        if (!grupId) { alert('Pilih grup iuran yang mendapat beasiswa.'); return; }
        const bulan = Array.from(beaForm.querySelectorAll('[data-bea-bulan]:checked')).map(c => c.value);
        if (opt.dataset.jenis === 'bulanan' && !bulan.length) { alert('Centang minimal satu bulan beasiswa.'); return; }
        const base = baseTagihan();
        const nom = digits(nominalIn.value);
        const pct = Number(String(persenIn.value || '').replace(',', '.')) || 0;
        if (!(nom > 0) && !(pct > 0)) { alert('Isi nominal potongan atau persentase beasiswa.'); return; }
        const per = nom > 0 ? nom : Math.round(base * pct / 100);
        const checked = Array.from(finalForm.querySelectorAll('input[name=penerima]:checked'));
        if (!checked.length) { alert('Centang minimal satu siswa penerima beasiswa.'); return; }
        const rows = checked.map(c => {
          const tr = c.closest('tr');
          const tds = tr ? tr.querySelectorAll('td') : [];
          const nm = tds[2] ? tds[2].textContent.trim() : '';
          const kl = tds[3] ? tds[3].textContent.trim() : '';
          return `<tr><td>${nm}</td><td>${kl}</td><td class="num">Rp ${fmt(base)}</td>
            <td class="num" style="color:var(--green)">Rp ${fmt(per)}</td>
            <td class="num">Rp ${fmt(Math.max(0, base - per))}</td></tr>`;
        }).join('');
        const total = per * checked.length;
        const host = document.querySelector('[data-bea-preview-body]');
        if (host) {
          host.innerHTML = `<div class="review-grid">
              <div class="rv"><div class="lbl">Nama Beasiswa</div><div class="val" style="font-size:14px">${nama.replace(/[<>]/g, '')}</div></div>
              <div class="rv"><div class="lbl">Grup Iuran</div><div class="val" style="font-size:14px">${(opt.textContent || '').split('(')[0].replace(/[<>]/g, '')}</div></div>
              <div class="rv"><div class="lbl">Bulan</div><div class="val" style="font-size:14px">${opt.dataset.jenis === 'bulanan' ? bulan.length + ' bulan' : 'Non-bulanan'}</div></div>
              <div class="rv"><div class="lbl">Potongan / Siswa</div><div class="val">Rp ${fmt(per)}</div></div>
              <div class="rv"><div class="lbl">Jumlah Penerima</div><div class="val">${checked.length} siswa</div></div>
              <div class="rv"><div class="lbl">Total Potongan</div><div class="val" style="color:var(--green)">Rp ${fmt(total)}</div></div>
            </div>
            <div class="table-scroll short"><table><thead><tr><th>Nama Siswa</th><th>Kelas</th><th class="num">Tagihan</th><th class="num">Potongan</th><th class="num">Sisa Setelah Beasiswa</th></tr></thead><tbody>${rows}</tbody>
            <tfoot><tr><td colspan="3">TOTAL</td><td class="num">Rp ${fmt(total)}</td><td class="num">Rp ${fmt(Math.max(0, base * checked.length - total))}</td></tr></tfoot></table></div>`;
        }
        finalForm.querySelector('[data-bea-payload]').value = JSON.stringify({
          nama: nama.trim(),
          deskripsi: (beaForm.querySelector('input[name=deskripsi]') || {}).value || '',
          tahun_ajaran_id: (beaForm.querySelector('input[name=tahun_ajaran_id]') || {}).value || '',
          grup_id: grupId, bulan_mask: bulan.join(','), nominal_per_siswa: per, persen: pct,
          aktif: !!(beaForm.querySelector('input[name=aktif]') || {}).checked,
          siswa: checked.map(c => c.value)
        });
        window.__openModal('mBeaPreview');
      });
      if (saveBtn) saveBtn.addEventListener('click', () => {
        const payload = finalForm.querySelector('[data-bea-payload]').value;
        if (!payload) { alert('Buka pratinjau terlebih dahulu.'); return; }
        finalForm.submit();
      });
    }
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
})();
