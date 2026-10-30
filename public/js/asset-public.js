'use strict';
(async () => {
  const BASE_PATH = (() => {
    if (typeof window !== 'undefined' && window.__BASE_PATH__ !== undefined) return window.__BASE_PATH__;
    const p = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    const segs = p.split('/').filter(Boolean);
    if (segs.length > 0 && !segs[0].endsWith('.html')) return '/' + segs[0];
    return '';
  })();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const d = s => { if (!s) return '–'; const x = new Date(s); return `${x.getDate()} ${B[x.getMonth()]} ${x.getFullYear()}`; };
  const COND = { baru: 'Baru', baik: 'Baik', rusak: 'Rusak', diperbaiki: 'Diperbaiki', rusak_parah: 'Rusak parah' };
  const m = document.getElementById('m'), tag = new URLSearchParams(location.search).get('t');
  try {
    const r = await fetch(BASE_PATH + '/api/public/assets/' + encodeURIComponent(tag || '')); const a = await r.json(); if (!r.ok) throw new Error(a.error);
    const token = localStorage.getItem('sp_token');
    m.innerHTML = `<div class="step"><div class="asset-tag">${esc(a.tag)}</div><h1 style="font-size:24px;margin:6px 0 4px">${esc(a.name)}</h1><p class="muted">${esc(a.code_name)}${a.brand ? ' · ' + esc(a.brand) : ''}${a.model ? ' ' + esc(a.model) : ''}</p>
      ${a.status === 'dihapus' ? '<p class="badge bad">Aset ini sudah dihapuskan</p>' : ''}
      <dl class="kv" style="margin-top:14px"><dt>Kondisi</dt><dd><b>${COND[a.condition] || a.condition}</b></dd><dt>Diperoleh</dt><dd>${d(a.acquisition_date)}</dd>
        <dt>Penempatan</dt><dd>${a.room_code ? `${esc(a.room_code)} — ${esc(a.room_name)}<br><small>${esc(a.building_name)}</small>` : '–'}</dd>
        <dt>Ditempatkan sejak</dt><dd>${d(a.placed_at)}</dd><dt>Pemegang</dt><dd>${esc(a.holder_name || '–')}</dd><dt>Unit pengelola</dt><dd>${esc(a.unit_name || '–')}</dd></dl>
      <div class="btn-row" style="margin-top:18px">${token ? `<a class="btn primary" href="${BASE_PATH}/#/aset/${a.id}">Buka kartu inventaris</a>` : `<a class="btn" href="${BASE_PATH || './'}">Masuk sebagai pengelola</a>`}
      ${a.room_code ? `<a class="btn" href="${BASE_PATH}/portal.html">Laporkan kerusakan</a>` : ''}</div></div>`;
  } catch (e) { m.innerHTML = `<div class="step"><h2>Aset tidak ditemukan</h2><p class="muted">${esc(e.message)}</p></div>`; }
})();
