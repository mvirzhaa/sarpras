/* ===== SARPRAS — inti frontend (tanpa build step) ===== */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- API ----------
const BASE_PATH = (() => {
  if (typeof window !== 'undefined' && window.__BASE_PATH__ !== undefined) return window.__BASE_PATH__;
  const p = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
  const segs = p.split('/').filter(Boolean);
  if (segs.length > 0 && !segs[0].endsWith('.html')) return '/' + segs[0];
  return '';
})();

const API = {
  token: localStorage.getItem('sp_token'),
  base: BASE_PATH,
  async req(method, url, body) {
    const opt = { method, headers: {} };
    if (this.token) opt.headers.Authorization = 'Bearer ' + this.token;
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(this.base + '/api' + url, opt);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (res.status === 401 && !url.startsWith('/auth/login')) { App.logout(true); throw new Error(data.error || 'Sesi berakhir'); }
    if (!res.ok) throw new Error((data && data.error) || 'Permintaan gagal diproses');
    return data;
  },
  qs: q => (q ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : ''),
  get(u, q) { return this.req('GET', u + this.qs(q)); },
  post(u, b) { return this.req('POST', u, b ?? {}); },
  put(u, b) { return this.req('PUT', u, b ?? {}); },
  del(u) { return this.req('DELETE', u); },
  url(u, q = {}) { return this.base + '/api' + u + this.qs({ ...q, token: this.token }); },
  file(id, dl) { return this.url(`/files/${id}/raw`, dl ? { dl: 1 } : {}); },
  async upload(file, meta) { const fd = new FormData(); fd.append('file', file); Object.entries(meta).forEach(([k, v]) => fd.append(k, v)); return this.req('POST', '/files', fd); },
};

// ---------- Format ----------
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const ISO_DAY = { 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat', 6: 'Sabtu', 7: 'Minggu' };
const pad = n => String(n).padStart(2, '0');
const fmt = {
  rp: n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'),
  num: (n, d = 0) => (n === null || n === undefined || n === '' ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: d })),
  date: s => { if (!s) return '–'; const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s); return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; },
  dt: s => { if (!s) return '–'; const d = new Date(s); return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())}`; },
  time: s => { const d = new Date(s); return `${pad(d.getHours())}.${pad(d.getMinutes())}`; },
  ymd: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  local: d => `${fmt.ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
  rel: s => { const m = Math.round((Date.now() - new Date(s)) / 60000); return m < 1 ? 'baru saja' : m < 60 ? `${m} menit lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : fmt.date(s); },
};
const COND = { baru: ['Baru', 'ok'], baik: ['Baik', 'ok'], rusak: ['Rusak', 'warn'], diperbaiki: ['Diperbaiki', 'info'], rusak_parah: ['Rusak parah', 'bad'] };
const STATUS = {
  pending: ['Menunggu', 'warn'], approved: ['Disetujui', 'ok'], rejected: ['Ditolak', 'bad'], cancelled: ['Dibatalkan', ''],
  baru: ['Baru', 'warn'], diproses: ['Diproses', 'info'], selesai: ['Selesai', 'ok'], ditolak: ['Ditolak', 'bad'], dilaporkan: ['Dilaporkan', 'warn'],
  aktif: ['Aktif', 'ok'], perbaikan: ['Perbaikan', 'warn'], nonaktif: ['Nonaktif', 'bad'], dihapus: ['Dihapus', 'bad'],
  running: ['Berjalan', 'info'], done: ['Selesai', 'ok'], failed: ['Gagal', 'bad'], published: ['Dipublikasikan', 'ok'],
  berjalan: ['Berjalan', 'info'], draft: ['Draf', 'warn'], final: ['Final', 'ok'], proses: ['Proses', 'info'], gagal: ['Gagal', 'bad'],
  ringan: ['Ringan', ''], sedang: ['Sedang', 'warn'], berat: ['Berat', 'bad'],
};
const badge = (k, map = STATUS) => { const v = map[k] || COND[k] || [k || '–', '']; return `<span class="badge ${v[1]}">${esc(v[0])}</span>`; };
const EVENT_TYPES = [['kuliah', 'Kuliah'], ['praktikum', 'Praktikum'], ['ujian', 'Ujian'], ['rapat', 'Rapat'], ['seminar', 'Seminar/Acara'], ['lainnya', 'Lainnya']];
const BA_TYPES = { stock_opname: 'Stock opname', mutasi: 'Mutasi barang', penghapusan: 'Penghapusan', persediaan: 'Persediaan', serah_terima: 'Serah terima', perbaikan: 'Perbaikan', lainnya: 'Lainnya' };

// ---------- Ikon (stroke) ----------
const I = (() => {
  const p = {
    dash: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z', building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h1M8 12h1M15 8h1M15 12h1',
    map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15', grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18', cal: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
    swap: 'M7 7h13l-3-3M17 17H4l3 3', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
    wrench: 'M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 1-2-2z', chat: 'M4 5h16v11H9l-5 4z', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    tree: 'M5 3h5v5H5zM14 10h5v5h-5zM14 17h5v4h-5zM7 8v11h7M7 12h7', move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4',
    clip: 'M9 4h6v3H9zM6 6h12v15H6zM9 12l2 2 4-4', stack: 'M4 7h16M4 12h16M4 17h10', doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
    coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.6-3 2-3 1-3 2 1.3 1.8 3 1.8 3-.8 3-1.8M12 6v12',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2', scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16',
    report: 'M5 3h14v18H5zM9 16v-3M12 16V8M15 16v-5', users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5',
    unit: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6', tag: 'M3 12V3h9l9 9-9 9zM7 7h.01', person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
    book: 'M4 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4zM20 4h-6M20 4v15h-6', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 7.5 4 7 3 10l2 1v2l-2 1 1 3 2-.5L7.5 18 7 20l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
    log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', menu: 'M4 6h16M4 12h16M4 18h16', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18', print: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z', dl: 'M12 4v12M7 11l5 5 5-5M5 20h14',
    pointer: 'M5 3l14 8-6 2-2 6z', rect: 'M4 6h16v12H4z', poly: 'M4 18V6h8v5h8v7z', hand: 'M8 12V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-3 7-6 7-2 0-4-1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.5L8 14',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3', fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', copy: 'M8 8h12v12H8zM4 16V4h12',
    img: 'M4 5h16v14H4zM4 15l4-4 5 5 3-3 4 4M15 9h.01', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7',
    zin: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M11 8v6M8 11h6', zout: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6', check: 'M5 12l5 5 9-10',
    ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  };
  return (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p[name] || p.doc}"/></svg>`;
})();

// ---------- UI ----------
const UI = {
  toast(msg, err) {
    let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3200);
  },
  err(e) { UI.toast(e.message || String(e), true); },
  modal({ title, body = '', actions = [], wide, onClose }) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost sm x" data-x aria-label="Tutup">${I('x')}</button></div>
      <div class="modal-body"></div>${actions.length ? '<div class="modal-foot"></div>' : ''}</div>`;
    const bodyEl = $('.modal-body', bg);
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const close = () => { bg.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
    const key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    actions.forEach(a => {
      const b = document.createElement('button'); b.className = 'btn ' + (a.kind || ''); b.textContent = a.label;
      b.onclick = async () => { if (a.onClick) { b.disabled = true; try { const r = await a.onClick(m); if (r !== false) close(); } catch (e) { UI.formError(bodyEl, e); } finally { b.disabled = false; } } else close(); };
      $('.modal-foot', bg).appendChild(b);
    });
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    $('[data-x]', bg).onclick = close;
    document.body.appendChild(bg);
    const m = { el: bg, body: bodyEl, close };
    setTimeout(() => { const f = $('input:not([type=hidden]),select,textarea', bodyEl); f && f.focus(); }, 30);
    return m;
  },
  formError(el, e) { let x = $('.form-error', el); if (!x) { x = document.createElement('div'); x.className = 'form-error'; el.prepend(x); } x.textContent = e.message || e; x.scrollIntoView({ block: 'nearest' }); },
  confirm(msg, { title = 'Konfirmasi', ok = 'Ya, lanjutkan', danger } = {}) {
    return new Promise(res => {
      let done = false;
      UI.modal({ title, body: `<p>${msg}</p>`, onClose: () => !done && res(false),
        actions: [{ label: 'Batal' }, { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; res(true); } }] });
    });
  },
  // ---- Form ----
  field(f, v) {
    const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 6);
    const req = f.required ? ' required' : '';
    const val = v ?? f.default ?? '';
    let input;
    switch (f.type) {
      case 'textarea': input = `<textarea id="${id}" name="${f.name}"${req} placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`; break;
      case 'select': input = `<select id="${id}" name="${f.name}"${req}>${f.empty !== false ? `<option value="">${esc(f.empty || '— pilih —')}</option>` : ''}${UI.options(f.options || [], val)}</select>`; break;
      case 'checkbox': return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${val === true || val === 'true' ? 'checked' : ''}> ${esc(f.label)}</label>`;
      case 'checks': return `<div class="field full"><span>${esc(f.label)}</span><div class="btn-row">${(f.options || []).map(o => `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${(val || []).map(String).includes(String(o.value)) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></div>`;
      case 'datetime': input = `<input id="${id}" type="datetime-local" name="${f.name}" value="${esc(val ? fmt.local(new Date(val)) : '')}"${req}>`; break;
      case 'money': input = `<input id="${id}" type="number" min="0" step="1" name="${f.name}" value="${esc(val)}"${req} inputmode="numeric">`; break;
      case 'code': input = `<div class="picker" data-picker="code"><input type="hidden" name="${f.name}" value="${esc(val)}"><input id="${id}" type="text" autocomplete="off" placeholder="Ketik kode atau nama barang…" value="${esc(f.display || '')}"${req}><div class="picker-list" hidden></div></div>`; break;
      case 'file': input = `<input id="${id}" type="file" name="${f.name}" ${f.accept ? `accept="${f.accept}"` : ''} ${f.multiple ? 'multiple' : ''}>`; break;
      default: input = `<input id="${id}" type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}"${req} ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}">`;
    }
    return `<label class="field ${f.full || f.type === 'textarea' ? 'full' : ''}" for="${id}"><span>${esc(f.label)}${f.required ? ' <i>*</i>' : ''}</span>${input}${f.help ? `<small class="help">${esc(f.help)}</small>` : ''}</label>`;
  },
  options(opts, val) {
    const one = o => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`;
    if (opts.length && opts[0].group !== undefined) {
      const g = {}; opts.forEach(o => (g[o.group] = g[o.group] || []).push(o));
      return Object.entries(g).map(([k, v]) => `<optgroup label="${esc(k)}">${v.map(one).join('')}</optgroup>`).join('');
    }
    return opts.map(one).join('');
  },
  form(fields, values = {}) { return `<form class="form-grid" onsubmit="return false">${fields.map(f => (f.html ? `<div class="full">${f.html}</div>` : UI.field(f, values[f.name]))).join('')}</form>`; },
  read(el, fields) {
    const out = {}, form = el.tagName === 'FORM' ? el : $('form', el);
    for (const f of fields) {
      if (f.html) continue;
      if (f.type === 'checks') { out[f.name] = $$(`[name="${f.name}"]:checked`, form).map(x => x.value); continue; }
      const x = $(`[name="${f.name}"]`, form); if (!x) continue;
      if (f.type === 'checkbox') out[f.name] = x.checked;
      else if (f.type === 'file') out[f.name] = f.multiple ? [...x.files] : x.files[0];
      else if (['number', 'money'].includes(f.type)) out[f.name] = x.value === '' ? null : Number(x.value);
      else if (f.type === 'datetime') out[f.name] = x.value ? new Date(x.value).toISOString() : null;
      else out[f.name] = x.value === '' ? null : x.value;
      if (f.required && (out[f.name] === null || out[f.name] === '')) throw new Error(`${f.label} wajib diisi`);
    }
    return out;
  },
  formModal({ title, fields, values = {}, submit = 'Simpan', wide, onSubmit, extra = '' }) {
    const m = UI.modal({ title, wide, body: UI.form(fields, values) + extra,
      actions: [{ label: 'Batal' }, { label: submit, kind: 'primary', onClick: async () => onSubmit(UI.read(m.body, fields), m) }] });
    UI.bindPickers(m.body);
    $('form', m.body).addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.closest('.picker')) $('.modal-foot .primary', m.el).click(); });
    return m;
  },
  bindPickers(root) {
    $$('[data-picker="code"]', root).forEach(p => {
      const hid = $('input[type=hidden]', p), inp = $('input[type=text]', p), list = $('.picker-list', p);
      let t;
      inp.addEventListener('input', () => {
        hid.value = ''; clearTimeout(t);
        t = setTimeout(async () => {
          if (inp.value.trim().length < 2) { list.hidden = true; return; }
          const rows = await API.get('/asset-codes', { q: inp.value.trim(), level: 5 });
          list.innerHTML = rows.length ? rows.map(r => `<div data-id="${r.id}" data-label="${esc(r.code + ' ' + r.name)}"><span class="mono">${esc(r.code)}</span> ${esc(r.name)}</div>`).join('') : '<div class="muted">Tidak ditemukan (hanya level Sub-sub Kelompok)</div>';
          list.hidden = false;
        }, 220);
      });
      list.addEventListener('mousedown', e => { const d = e.target.closest('[data-id]'); if (!d) return; hid.value = d.dataset.id; inp.value = d.dataset.label; list.hidden = true; inp.dispatchEvent(new Event('picked', { bubbles: true })); });
      inp.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
    });
  },
  // ---- Tabel ----
  table({ columns, rows, empty = 'Belum ada data.', rowAttr, foot, select }) {
    if (!rows || !rows.length) return `<div class="empty">${empty}</div>`;
    const th = (select ? '<th style="width:32px"><input type="checkbox" data-selall aria-label="Pilih semua"></th>' : '') + columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
    const tr = rows.map((r, i) => `<tr ${rowAttr ? rowAttr(r, i) : ''}>${select ? `<td><input type="checkbox" data-sel="${r.id}" aria-label="Pilih"></td>` : ''}${columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r, i) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
    return `<div class="table-wrap"><table class="t"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${foot ? `<tfoot><tr>${select ? '<td></td>' : ''}${foot}</tr></tfoot>` : ''}</table></div>`;
  },
  bindSelect(root, onChange) {
    const all = $('[data-selall]', root);
    const get = () => $$('[data-sel]:checked', root).map(x => Number(x.dataset.sel));
    if (all) all.onchange = () => { $$('[data-sel]', root).forEach(x => (x.checked = all.checked)); onChange(get()); };
    $$('[data-sel]', root).forEach(x => (x.onchange = () => onChange(get())));
    return get;
  },
  tabs(el, tabs, active, onPick) {
    el.innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === active ? 'on' : ''}">${esc(l)}</button>`).join('');
    el.onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; $$('button', el).forEach(x => x.classList.toggle('on', x === b)); onPick(b.dataset.tab); };
  },
  // ---- Grafik SVG sederhana ----
  bars(data, { label = 'label', value = 'value', max, fmtv = v => fmt.num(v, 1), color = 'var(--brand)', height = 22 } = {}) {
    if (!data.length) return '<div class="empty">Belum ada data.</div>';
    const m = max || Math.max(...data.map(d => Number(d[value]) || 0), 1);
    return `<div style="display:grid;grid-template-columns:minmax(90px,max-content) 1fr auto;gap:6px 10px;align-items:center;font-size:13px">${data.map(d => `
      <span title="${esc(d[label])}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${esc(d[label])}</span>
      <div class="meter" style="height:${height / 2}px"><i style="width:${Math.min(100, (100 * (Number(d[value]) || 0)) / m)}%;background:${color}"></i></div>
      <b style="font-variant-numeric:tabular-nums">${fmtv(d[value])}</b>`).join('')}</div>`;
  },
  spark(values, labels, { h = 120 } = {}) {
    const w = 600, mx = Math.max(...values, 1), bw = w / values.length;
    return `<svg viewBox="0 0 ${w} ${h + 18}" style="width:100%;height:auto" role="img" aria-label="Grafik tren">${values.map((v, i) => {
      const bh = (v / mx) * h; return `<rect x="${i * bw + 1}" y="${h - bh}" width="${bw - 2}" height="${bh}" fill="var(--brand)" opacity=".8"><title>${esc(labels[i])}: ${v}</title></rect>`;
    }).join('')}<line x1="0" x2="${w}" y1="${h}" y2="${h}" stroke="var(--line-strong)"/>
    ${labels.map((l, i) => (i % 5 === 0 ? `<text x="${i * bw + bw / 2}" y="${h + 14}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>` : '')).join('')}</svg>`;
  },
};

// ---------- Data acuan (cache) ----------
const Ref = {
  c: {},
  async get(k, force) {
    const src = { units: '/units', categories: '/room-categories', buildings: '/buildings', periods: '/periods', slots: '/time-slots', people: '/people?limit=5000', rooms: '/rooms', myrooms: '/rooms?mine=1' }[k];
    if (force || !this.c[k]) this.c[k] = API.get(src).then(r => (r.rows ? r.rows : r));
    try { return await this.c[k]; } catch (e) { delete this.c[k]; throw e; }
  },
  clear(...k) { (k.length ? k : Object.keys(this.c)).forEach(x => delete this.c[x]); },
  async opts(k, labelFn, valueKey = 'id') { return (await this.get(k)).map(x => ({ value: x[valueKey], label: labelFn(x) })); },
  async roomOpts(mine) {
    const rows = await this.get(mine ? 'myrooms' : 'rooms');
    return rows.map(r => ({ value: r.id, label: `${r.code} — ${r.name}${r.capacity ? ` (${r.capacity})` : ''}`, group: r.building_name }));
  },
};

// ---------- Aplikasi & router ----------
const NAV = [
  ['Ringkasan', [['#/dashboard', 'Dashboard', 'dash']]],
  ['Ruang & jadwal', [['#/gedung', 'Gedung & denah', 'building'], ['#/peta', 'Peta keterisian', 'map'], ['#/tabulasi', 'Tabulasi harian', 'grid'],
    ['#/jadwal', 'Jadwal ruang', 'cal'], ['#/cari-ruang', 'Cari ruang kosong', 'search'], ['#/peminjaman', 'Peminjaman', 'swap', 'pending'],
    ['#/penjadwalan', 'Penjadwalan kuliah', 'cpu', null, ['superadmin', 'unit_admin']], ['#/kerusakan', 'Kerusakan ruang', 'wrench'], ['#/masukan', 'Masukan publik', 'chat']]],
  ['Aset', [['#/aset', 'Daftar aset', 'box'], ['#/kodefikasi', 'Kodefikasi BMN', 'tree'], ['#/mutasi', 'Mutasi barang', 'move'], ['#/opname', 'Stock opname', 'clip'],
    ['#/persediaan', 'Persediaan', 'stack'], ['#/ba', 'Berita acara', 'doc'], ['#/valuasi', 'Valuasi aset', 'coin'], ['#/scan', 'Pindai QR', 'scan']]],
  ['Laporan', [['#/laporan', 'Laporan', 'report']]],
  ['Pengaturan', [['#/unit', 'Unit pengelola', 'unit', null, ['superadmin', 'pimpinan']], ['#/pengguna', 'Pengguna', 'users', null, ['superadmin']],
    ['#/master/kategori', 'Kategori ruang', 'tag'], ['#/master/orang', 'Dosen & pegawai', 'person'], ['#/master/matkul', 'Mata kuliah', 'book'],
    ['#/master/periode', 'Periode akademik', 'cal'], ['#/master/sesi', 'Sesi kuliah', 'clock'], ['#/pengaturan', 'Organisasi', 'gear', null, ['superadmin']], ['#/audit', 'Log aktivitas', 'log', null, ['superadmin']]]],
];
const Pages = {};
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
const App = {
  me: null,
  isSA: () => App.me && App.me.role === 'superadmin',
  canWrite: () => App.me && App.me.role !== 'pimpinan',
  async start() {
    if (!API.token) return App.loginView();
    try { App.me = await API.get('/auth/me'); } catch { return; }
    App.shell();
    window.addEventListener('hashchange', () => App.render());
    App.render();
    if (App.me.must_change_password) setTimeout(() => Pages.password(true), 300);
    setInterval(App.refreshBadge, 60000);
  },
  logout(expired) { localStorage.removeItem('sp_token'); API.token = null; if (expired) sessionStorage.setItem('sp_msg', 'Sesi Anda berakhir. Silakan masuk kembali.'); location.hash = ''; location.reload(); },
  loginView() {
    const msg = sessionStorage.getItem('sp_msg'); sessionStorage.removeItem('sp_msg');
    document.body.innerHTML = `<div class="login"><div class="login-art">${Pages.blueprintArt ? Pages.blueprintArt() : ''}
      <h1>Ruang, jadwal, dan aset kampus dalam satu denah.</h1><p>Kelola gedung, penjadwalan kuliah, peminjaman antarunit, dan inventaris barang milik negara.</p></div>
      <div class="login-form"><form id="lf"><h2>Masuk</h2>${msg ? `<div class="form-error">${esc(msg)}</div>` : ''}
        <label class="field"><span>Username</span><input name="username" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" style="justify-content:center">Masuk</button>
        <a href="${API.base}/portal.html" class="muted" style="font-size:14px">Mahasiswa: kirim masukan tentang ruangan</a></form></div></div>`;
    $('#lf').onsubmit = async e => {
      e.preventDefault();
      try { const { token } = await API.post('/auth/login', { username: e.target.username.value, password: e.target.password.value });
        localStorage.setItem('sp_token', token); API.token = token; location.reload(); } catch (er) { UI.formError(e.target, er); }
    };
  },
  shell() {
    const role = App.me.role;
    document.body.innerHTML = `<div class="app"><aside class="side" id="side"><div class="brand"><div class="brand-mark">${I('building')}</div><div><b>SARPRAS ${esc(App.me.org.short || '')}</b><small>Ruang · Jadwal · Aset</small></div></div>
      <nav class="nav">${NAV.map(([g, items]) => {
        const vis = items.filter(x => !x[4] || x[4].includes(role));
        return vis.length ? `<div class="nav-group">${g}</div>` + vis.map(([h, l, ic, cnt]) => `<a href="${h}">${I(ic)}<span>${l}</span>${cnt ? `<span class="count" data-count="${cnt}" hidden></span>` : ''}</a>`).join('') : '';
      }).join('')}</nav></aside>
      <div class="main"><header class="topbar"><button class="btn ghost sm menu-btn" id="menuBtn" aria-label="Menu">${I('menu')}</button>
        <div class="who"><button class="btn ghost sm" id="bell" aria-label="Notifikasi">${I('bell')}<span class="badge warn" id="unread" hidden></span></button>
        <span><b>${esc(App.me.name || App.me.username)}</b><br><small>${esc(App.me.unit_name || { superadmin: 'Super Admin', pimpinan: 'Pimpinan' }[role] || '')}</small></span>
        <a href="#/akun" class="btn ghost sm">Akun</a><button class="btn sm" id="logout">Keluar</button></div></header>
      <main class="content" id="view"></main></div></div>`;
    $('#logout').onclick = () => App.logout();
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $('#bell').onclick = () => Pages.notifications();
    App.refreshBadge();
  },
  async refreshBadge() {
    try {
      const me = await API.get('/auth/me'); const u = $('#unread');
      if (u) { u.hidden = !me.unread; u.textContent = me.unread; }
      const p = await API.get('/bookings', { box: 'incoming', status: 'pending' }); const c = $('[data-count="pending"]');
      if (c) { c.hidden = !p.length; c.textContent = p.length; }
    } catch { /* abaikan */ }
  },
  async render() {
    const h = location.hash || '#/dashboard';
    $('#side') && $('#side').classList.remove('open');
    $$('.nav a').forEach(a => a.classList.toggle('active', h === a.getAttribute('href') || h.startsWith(a.getAttribute('href') + '/') || h.startsWith(a.getAttribute('href') + '?')));
    const [path, qs] = h.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    const view = $('#view');
    if (App.cleanup) { App.cleanup(); App.cleanup = null; }
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        view.innerHTML = '<div class="empty">Memuat…</div>';
        try { await fn(view, m.slice(1), q); } catch (e) { view.innerHTML = `<div class="panel panel-body"><h2>Halaman tidak dapat dimuat</h2><p class="muted">${esc(e.message)}</p></div>`; }
        window.scrollTo(0, 0);
        return;
      }
    }
    view.innerHTML = '<div class="empty">Halaman tidak ditemukan.</div>';
  },
  head(title, lead = '', actions = '') { return `<div class="page-head"><div><h1>${esc(title)}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</div><div class="actions">${actions}</div></div>`; },
};

Pages.notifications = async () => {
  const rows = await API.get('/notifications');
  const m = UI.modal({ title: 'Notifikasi', body: rows.length ? `<ul class="room-list">${rows.map(n => `<li data-link="${esc(n.link || '')}" style="${n.read_at ? '' : 'font-weight:600'}"><div><div>${esc(n.title)}</div><small>${esc(n.body || '')} · ${fmt.rel(n.created_at)}</small></div></li>`).join('')}</ul>` : '<div class="empty">Belum ada notifikasi.</div>',
    actions: [{ label: 'Tandai semua dibaca', onClick: async () => { await API.post('/notifications/read-all'); App.refreshBadge(); } }] });
  m.body.onclick = e => { const li = e.target.closest('[data-link]'); if (li && li.dataset.link) { location.hash = li.dataset.link; m.close(); } };
};
Pages.password = (forced) => UI.formModal({
  title: forced ? 'Ganti password awal Anda' : 'Ganti password',
  fields: [{ name: 'old_password', label: 'Password saat ini', type: 'password', required: true }, { name: 'new_password', label: 'Password baru (min. 8 karakter)', type: 'password', required: true }, { name: 'confirm', label: 'Ulangi password baru', type: 'password', required: true }],
  onSubmit: async v => { if (v.new_password !== v.confirm) throw new Error('Konfirmasi password tidak sama'); await API.post('/auth/password', v); UI.toast('Password diperbarui'); },
});
route(/^#\/akun$/, async view => {
  view.innerHTML = App.head('Akun saya') + `<div class="panel panel-body"><dl class="kv"><dt>Nama</dt><dd>${esc(App.me.name)}</dd><dt>Username</dt><dd>${esc(App.me.username)}</dd>
    <dt>Peran</dt><dd>${esc(App.me.role)}</dd><dt>Unit</dt><dd>${esc(App.me.unit_name || '–')}</dd></dl><p style="margin-top:16px"><button class="btn" id="pw">Ganti password</button></p></div>`;
  $('#pw').onclick = () => Pages.password();
});
document.addEventListener('DOMContentLoaded', () => App.start());
