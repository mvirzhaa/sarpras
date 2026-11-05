/* ===== TableKit: pencarian, filter kolom, pengurutan A–Z / Z–A, dan paginasi (10/20/50/100) untuk semua tabel =====
 * - Tabel biasa (UI.table) diperkaya otomatis di sisi klien setelah dirender.
 * - Tabel besar berhalaman server (aset, log) memakai UI.table({ server }) + TableKit.pager(): urut & halaman dihitung di server.
 * - Tabel yang tidak boleh diubah (isian dinamis) diberi atribut data-tk-off.
 */
'use strict';
const TableKit = (() => {
  const SIZES = [10, 20, 50, 100], KEY = 'sp_pagesize';
  const size = () => { let v = 0; try { v = Number(localStorage.getItem(KEY)); } catch { /* abaikan */ } return SIZES.includes(v) ? v : 20; };
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5, jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11 };
  const blank = s => s === '' || s === '–' || s === '-' || s === '—';
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Pembacaan nilai sel ----------
  const parseNum = s => {
    const t = String(s).replace(/Rp|\u00a0|\s/g, '').replace(/%$/, '').replace(/[a-zA-Z²³]+$/, '').replace('−', '-');
    if (!/^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(t)) return NaN;
    return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  };
  const parseDate = s => {
    let m = String(s).match(/^(\d{1,2}) (Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des) (\d{4})(?:, (\d{1,2})\.(\d{2}))?/i);
    if (m) return new Date(+m[3], MON[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
    m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
    m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
    return NaN;
  };
  const detect = vals => {
    const v = vals.filter(x => !blank(x));
    if (!v.length) return 'str';
    if (v.every(x => !Number.isNaN(parseNum(x)))) return 'num';
    if (v.every(x => !Number.isNaN(parseDate(x)))) return 'date';
    return 'str';
  };
  const txt = td => {
    if (!td) return '';
    const c = td.querySelector('select, input:not([type=checkbox]), textarea');
    if (c) return c.tagName === 'SELECT' ? (c.selectedOptions[0] ? c.selectedOptions[0].textContent.trim() : '') : String(c.value).trim();
    if (td.dataset.sort !== undefined) return td.dataset.sort;
    return td.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // ---------- Komponen tampilan ----------
  const pageList = (page, pages) => {
    const arr = [...new Set([0, pages - 1, page - 1, page, page + 1])].filter(n => n >= 0 && n < pages).sort((a, b) => a - b), out = [];
    arr.forEach((n, i) => { if (i && n - arr[i - 1] > 1) out.push('…'); out.push(n); });
    return out;
  };
  const btns = (page, pages, attr) => `<button class="tk-pg" ${attr}="${page - 1}" ${page === 0 ? 'disabled' : ''} aria-label="Halaman sebelumnya">‹</button>`
    + pageList(page, pages).map(n => (n === '…' ? '<span class="tk-gap">…</span>' : `<button class="tk-pg ${n === page ? 'on' : ''}" ${attr}="${n}" ${n === page ? 'aria-current="page"' : ''}>${n + 1}</button>`)).join('')
    + `<button class="tk-pg" ${attr}="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''} aria-label="Halaman berikutnya">›</button>`;
  const sizeSel = (cur, attr) => `<label class="tk-size">Baris per halaman <select ${attr} aria-label="Baris per halaman">${SIZES.map(n => `<option ${n === cur ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
  const summary = (total, page, sz) => (total ? `Menampilkan ${(page * sz + 1).toLocaleString('id-ID')}–${Math.min(total, (page + 1) * sz).toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} baris` : 'Tidak ada baris');

  // Pager untuk daftar berhalaman server
  const pager = ({ total, page, limit }) => {
    const pages = Math.max(1, Math.ceil(total / limit));
    return `<div class="tk-pager out no-print"><span class="muted">${summary(total, page, limit)}</span>${sizeSel(limit, 'data-tklimit')}<div class="tk-pages">${btns(page, pages, 'data-tkpage')}</div></div>`;
  };

  const registry = new Set();
  const changeSize = n => { try { localStorage.setItem(KEY, String(n)); } catch { /* abaikan */ } registry.forEach(s => { if (!document.body.contains(s.wrap)) registry.delete(s); else s.setSize(n); }); };

  // ---------- Peningkatan tabel sisi klien ----------
  function enhance(wrap) {
    wrap.dataset.tk = '1';
    if ('tkOff' in wrap.dataset || 'tkServer' in wrap.dataset) return;
    const table = wrap.querySelector('table.t');
    if (!table || !table.tBodies[0] || !table.tHead) return;
    const tbody = table.tBodies[0], rows = [...tbody.rows];
    if (rows.length < 2) return;
    const heads = [...table.tHead.rows[0].cells];
    rows.forEach((r, i) => { r._i = i; });
    const st = { wrap, q: '', filt: {}, col: -1, dir: 'asc', page: 0, size: size(), order: rows.slice() };
    const cache = r => {
      if (r._t && !r._dyn) return r._t;
      r._dyn = !!r.querySelector('select, input:not([type=checkbox]), textarea');
      r._t = [...r.cells].map(txt); r._q = r._t.join(' ').toLowerCase();
      return r._t;
    };
    const sortable = heads.map(h => !!h.textContent.trim() && !h.querySelector('input'));

    // filter kolom otomatis: kolom bernilai kategorikal (2–12 nilai berbeda)
    const filters = [];
    if (rows.length >= 6 && rows.length <= 2000) {
      heads.forEach((h, c) => {
        if (!sortable[c]) return;
        const vals = rows.map(r => cache(r)[c] ?? '');
        const set = new Set(vals.filter(v => !blank(v)));
        if (set.size < 2 || set.size > 12 || Math.max(...[...set].map(v => v.length)) > 36) return;
        if (detect(vals) !== 'str') return;
        filters.push({ c, label: h.textContent.trim(), opts: [...set].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })) });
      });
    }
    const bar = document.createElement('div'); bar.className = 'tk-bar no-print';
    bar.innerHTML = `<input type="search" class="tk-q" placeholder="Cari di tabel…" aria-label="Cari di tabel">`
      + filters.map(f => `<select class="tk-f" data-c="${f.c}" aria-label="Filter ${escH(f.label)}"><option value="">Semua ${escH(f.label)}</option>${f.opts.map(o => `<option value="${escH(o)}">${escH(o)}</option>`).join('')}</select>`).join('')
      + `<button type="button" class="btn sm ghost tk-reset" hidden>Atur ulang</button><span class="tk-count muted"></span>`;
    const pagerEl = document.createElement('div'); pagerEl.className = 'tk-pager no-print';
    const none = document.createElement('div'); none.className = 'tk-empty'; none.textContent = 'Tidak ada baris yang cocok dengan pencarian/filter.'; none.hidden = true;
    wrap.insertAdjacentElement('beforebegin', bar); wrap.insertAdjacentElement('afterend', pagerEl); wrap.insertAdjacentElement('afterend', none);
    const paged = rows.length > SIZES[0];
    pagerEl.hidden = !paged;

    const match = r => {
      const t = cache(r);
      if (st.q && !r._q.includes(st.q)) return false;
      for (const c in st.filt) if (t[c] !== st.filt[c]) return false;
      return true;
    };
    const apply = () => {
      const m = st.order.filter(match), total = m.length, pages = Math.max(1, Math.ceil(total / st.size));
      if (st.page >= pages) st.page = pages - 1;
      const s0 = paged ? st.page * st.size : 0, show = new Set(m.slice(s0, paged ? s0 + st.size : total)), mset = new Set(m);
      for (const r of rows) { r.toggleAttribute('data-hf', !mset.has(r)); r.toggleAttribute('data-hp', !show.has(r)); }
      none.hidden = total > 0; wrap.hidden = total === 0;
      const filtered = !!st.q || Object.keys(st.filt).length > 0;
      $('.tk-reset', bar).hidden = !filtered;
      $('.tk-count', bar).textContent = filtered ? `${total.toLocaleString('id-ID')} dari ${rows.length.toLocaleString('id-ID')} baris` : `${rows.length.toLocaleString('id-ID')} baris`;
      if (paged) pagerEl.innerHTML = `<span class="muted">${summary(total, st.page, st.size)}</span>${sizeSel(st.size, 'data-p-size')}<div class="tk-pages">${btns(st.page, pages, 'data-p')}</div>`;
    };
    st.setSize = n => { st.size = n; st.page = 0; apply(); };

    const sortBy = c => {
      st.dir = st.col === c && st.dir === 'asc' ? 'desc' : 'asc'; st.col = c;
      const texts = rows.map(r => cache(r)[c] ?? ''), type = detect(texts), key = type === 'num' ? parseNum : type === 'date' ? parseDate : null;
      const coll = new Intl.Collator('id', { numeric: true, sensitivity: 'base' }), sign = st.dir === 'asc' ? 1 : -1;
      const items = rows.map((r, i) => ({ r, b: blank(texts[i]), k: key ? key(texts[i]) : texts[i] }));
      items.sort((a, b) => {
        if (a.b !== b.b) return a.b ? 1 : -1;                  // sel kosong selalu di bawah
        const d = a.b ? 0 : (key ? a.k - b.k : coll.compare(a.k, b.k)) * sign;
        return d || a.r._i - b.r._i;
      });
      st.order = items.map(x => x.r);
      const frag = document.createDocumentFragment(); st.order.forEach(r => frag.appendChild(r)); tbody.appendChild(frag);
      heads.forEach((h, i) => h.setAttribute('aria-sort', i === c ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'));
      st.page = 0; apply();
    };
    heads.forEach((h, c) => {
      if (!sortable[c]) return;
      h.classList.add('tk-th'); h.tabIndex = 0; h.setAttribute('aria-sort', 'none'); h.title = 'Klik untuk mengurutkan A–Z / Z–A';
      h.addEventListener('click', () => sortBy(c));
      h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c); } });
    });

    let timer;
    $('.tk-q', bar).addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim().toLowerCase(); st.page = 0; apply(); }, 150); });
    bar.addEventListener('change', e => {
      const s = e.target.closest('.tk-f'); if (!s) return;
      if (s.value) st.filt[s.dataset.c] = s.value; else delete st.filt[s.dataset.c];
      st.page = 0; apply();
    });
    $('.tk-reset', bar).addEventListener('click', () => { st.q = ''; st.filt = {}; $('.tk-q', bar).value = ''; $$('.tk-f', bar).forEach(s => { s.value = ''; }); st.page = 0; apply(); });
    pagerEl.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) { st.page = Number(b.dataset.p); apply(); wrap.scrollIntoView({ block: 'nearest' }); } });
    pagerEl.addEventListener('change', e => { const s = e.target.closest('[data-p-size]'); if (s) changeSize(Number(s.value)); });
    registry.add(st); apply();
  }
  const scan = () => $$('.table-wrap:not([data-tk])').forEach(w => { try { enhance(w); } catch (e) { console.error('TableKit', e); } });

  // ---------- Navigasi untuk daftar berhalaman server ----------
  const nav = patch => {
    const h = location.hash || '#/dashboard', [path, qs] = h.split('?'), p = Object.fromEntries(new URLSearchParams(qs || ''));
    Object.assign(p, patch);
    Object.keys(p).forEach(k => { if (p[k] === '' || p[k] == null || (k === 'page' && String(p[k]) === '0')) delete p[k]; });
    const nh = path + (Object.keys(p).length ? '?' + new URLSearchParams(p).toString() : '');
    if (nh === h) App.render(); else location.hash = nh;
  };
  const serverSort = th => {
    const key = th.dataset.ssort, q = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1]) || ''));
    nav({ sort: key, dir: q.sort === key && q.dir !== 'desc' ? 'desc' : 'asc', page: '' });
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-tkpage]'); if (b && !b.disabled) return nav({ page: b.dataset.tkpage });
      const th = e.target.closest('th[data-ssort]'); if (th) serverSort(th);
    });
    document.addEventListener('keydown', e => { const th = e.target.closest && e.target.closest('th[data-ssort]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); serverSort(th); } });
    document.addEventListener('change', e => { const s = e.target.closest && e.target.closest('select[data-tklimit]'); if (s) { try { localStorage.setItem(KEY, s.value); } catch { /* abaikan */ } nav({ page: '' }); } });
    if (document.body) { let raf; new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); }).observe(document.body, { childList: true, subtree: true }); }
  }
  return { pageSize: size, pager, enhance, scan, SIZES, _t: { parseNum, parseDate, detect, pageList } };
})();
