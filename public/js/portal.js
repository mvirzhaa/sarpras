'use strict';
(() => {
  const BASE_PATH = (() => {
    if (typeof window !== 'undefined' && window.__BASE_PATH__ !== undefined) return window.__BASE_PATH__;
    const p = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    const segs = p.split('/').filter(Boolean);
    if (segs.length > 0 && !segs[0].endsWith('.html')) return '/' + segs[0];
    return '';
  })();
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = async u => { const r = await fetch(BASE_PATH + '/api/public' + u); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Gagal memuat'); return d; };
  const params = new URLSearchParams(location.search);
  let rating = 0;
  const stars = $('#stars');
  const drawStars = () => { stars.innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" class="${i <= rating ? 'on' : ''}" aria-label="${i} bintang">★</button>`).join(''); };
  stars.onclick = e => { const b = e.target.closest('[data-s]'); if (b) { rating = Number(b.dataset.s) === rating ? 0 : Number(b.dataset.s); drawStars(); } };
  drawStars();
  get('/info').then(o => { $('#org').textContent = o.name || ''; }).catch(() => {});
  const loadRooms = async (unitId, pick) => {
    const sel = $('#room');
    if (!unitId) { sel.disabled = true; sel.innerHTML = '<option value="">Pilih unit terlebih dahulu</option>'; return; }
    const rows = await get(`/units/${unitId}/rooms`);
    const groups = {}; rows.forEach(r => (groups[r.building_name + ' · ' + r.floor_name] = groups[r.building_name + ' · ' + r.floor_name] || []).push(r));
    sel.innerHTML = '<option value="">— pilih ruangan —</option>' + Object.entries(groups).map(([g, rs]) => `<optgroup label="${esc(g)}">${rs.map(r => `<option value="${r.id}" ${String(r.id) === String(pick) ? 'selected' : ''}>${esc(r.code)} — ${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
    sel.disabled = false; sel.dispatchEvent(new Event('change'));
  };
  (async () => {
    const units = await get('/units');
    $('#unit').innerHTML = '<option value="">— pilih unit —</option>' + units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
    const rid = params.get('room');
    if (rid) { try { const r = await get('/rooms/' + rid); if (r.unit_id) { $('#unit').value = r.unit_id; await loadRooms(r.unit_id, r.id); } } catch { /* abaikan */ } }
  })().catch(e => { $('#unit').innerHTML = `<option>${esc(e.message)}</option>`; });
  $('#unit').onchange = e => loadRooms(e.target.value);
  $('#room').onchange = async e => { const id = e.target.value; $('#roomInfo').textContent = ''; if (!id) return; const r = await get('/rooms/' + id); $('#roomInfo').textContent = `${r.category_name || ''} · ${r.building_name}, ${r.floor_name}${r.rating ? ` · nilai rata-rata ${r.rating}/5` : ''}`; };
  $('#f').onsubmit = async e => {
    e.preventDefault(); $('#err').innerHTML = '';
    const f = e.target, fd = new FormData(f);
    if (!$('#room').value) return ($('#err').innerHTML = '<div class="form-error">Pilih ruangan terlebih dahulu.</div>');
    if ((fd.get('message') || '').trim().length < 10) return ($('#err').innerHTML = '<div class="form-error">Tulis masukan minimal 10 karakter.</div>');
    fd.append('room_id', $('#room').value); if (rating) fd.append('rating', rating);
    if (!fd.get('photo') || !fd.get('photo').size) fd.delete('photo');
    const btn = f.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Mengirim…';
    try {
      const r = await fetch(BASE_PATH + '/api/public/feedback', { method: 'POST', body: fd }); const d = await r.json(); if (!r.ok) throw new Error(d.error);
      f.hidden = true; $('#ok').hidden = false; $('#tk').textContent = d.ticket; window.scrollTo(0, 0);
    } catch (er) { $('#err').innerHTML = `<div class="form-error">${esc(er.message)}</div>`; } finally { btn.disabled = false; btn.textContent = 'Kirim masukan'; }
  };
  $('#again').onclick = () => { $('#f').reset(); rating = 0; drawStars(); $('#f').hidden = false; $('#ok').hidden = true; };
  const STAT = { baru: 'Diterima, menunggu ditinjau', diproses: 'Sedang ditindaklanjuti', selesai: 'Selesai', ditolak: 'Tidak dapat ditindaklanjuti' };
  $('#tb').onclick = async () => {
    try { const t = await get('/feedback/' + encodeURIComponent($('#tq').value.trim()));
      $('#tr').innerHTML = `<dl class="kv"><dt>Ruang</dt><dd>${esc(t.room_code)} — ${esc(t.room_name)}</dd><dt>Unit</dt><dd>${esc(t.unit_name || '')}</dd><dt>Status</dt><dd><b>${STAT[t.status]}</b></dd>${t.response ? `<dt>Tanggapan</dt><dd>${esc(t.response)}</dd>` : ''}</dl>`;
    } catch (e) { $('#tr').innerHTML = `<div class="form-error">${esc(e.message)}</div>`; }
  };
})();
