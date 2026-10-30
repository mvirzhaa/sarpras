/* ===== Penjadwalan kuliah otomatis (GA) ===== */
'use strict';
const CON_TYPES = {
  early: { label: 'Mata kuliah tertentu diutamakan di jam awal', make: () => ({ type: 'time', mode: 'early', scope: { kind: 'tags', values: ['matematika'] }, weight: 30 }) },
  only: { label: 'Dosen hanya bisa pada hari/sesi tertentu', make: () => ({ type: 'time', mode: 'only', scope: { kind: 'lecturer', values: [] }, days: [1, 2, 3], slots: [], hard: true, weight: 50 }) },
  avoid: { label: 'Dosen/MK tidak bisa pada hari/sesi tertentu', make: () => ({ type: 'time', mode: 'avoid', scope: { kind: 'lecturer', values: [] }, days: [], slots: [], hard: true, weight: 50 }) },
  block: { label: 'Larang jadwal pada waktu tertentu (mis. salat Jumat)', make: () => ({ type: 'time', mode: 'avoid', scope: { kind: 'all' }, days: [5], slots: [6, 7], hard: true, weight: 100 }) },
  maxdaily: { label: 'Batas jumlah kelas dosen per hari', make: () => ({ type: 'lecturer_max_daily', max: 3, weight: 15 }) },
  compact: { label: 'Padatkan jadwal rombel (minim jam kosong)', make: () => ({ type: 'group_compact', weight: 3 }) },
  spread: { label: 'Sebar pertemuan kelas yang sama ke hari berbeda', make: () => ({ type: 'spread_sessions', weight: 10 }) },
};
const SCOPES = [['all', 'Semua kelas'], ['tags', 'MK dengan tag'], ['courses', 'Mata kuliah'], ['lecturer', 'Dosen'], ['groups', 'Rombel']];

route(/^#\/penjadwalan$/, async (view, _, q) => {
  const [periods, units, slots, cats] = await Promise.all([Ref.get('periods'), Ref.get('units'), Ref.get('slots'), Ref.get('categories')]);
  const period = Number(q.period) || (periods.find(p => p.is_active) || periods[0] || {}).id;
  const unit = App.isSA() ? Number(q.unit) || (units[0] || {}).id : App.me.unit_id;
  const tab = q.tab || 'kelas';
  if (!period || !unit) { view.innerHTML = App.head('Penjadwalan kuliah') + '<div class="empty">Buat periode akademik dan unit terlebih dahulu.</div>'; return; }
  view.innerHTML = App.head('Penjadwalan kuliah otomatis', 'Masukkan kelas, pilih ruang dan kendala, lalu biarkan algoritma genetika memetik menyusun jadwal tanpa bentrok untuk satu semester.') + `
    <div class="filters"><select id="per">${UI.options(periods.map(p => ({ value: p.id, label: p.name + (p.is_active ? ' (aktif)' : '') })), period)}</select>
      ${App.isSA() ? `<select id="un">${UI.options(units.map(u => ({ value: u.id, label: u.name })), unit)}</select>` : `<b>${esc(App.me.unit_name)}</b>`}</div>
    <div class="tabs" id="tabs"></div><div id="body"></div>`;
  $('#per').onchange = e => setQ('#/penjadwalan', { ...q, period: e.target.value });
  if ($('#un')) $('#un').onchange = e => setQ('#/penjadwalan', { ...q, unit: e.target.value });
  UI.tabs($('#tabs'), [['kelas', '1. Kelas & dosen'], ['kendala', '2. Ruang & kendala'], ['hasil', '3. Proses & hasil']], tab, t => setQ('#/penjadwalan', { ...q, tab: t }));
  const body = $('#body'), ctx = { period, unit, slots, cats, periods };
  if (tab === 'kelas') await ttClasses(body, ctx);
  if (tab === 'kendala') await ttConstraints(body, ctx);
  if (tab === 'hasil') await ttResults(body, ctx, q);
});

async function ttClasses(body, { period, unit, cats, periods }) {
  const [rows, courses, people] = await Promise.all([API.get('/tt/classes', { period_id: period, unit_id: unit }), API.get('/courses', { limit: 5000 }).then(r => r.rows), Ref.get('people')]);
  const totalSess = rows.reduce((s, r) => s + r.sessions_per_week * r.duration_slots, 0);
  body.innerHTML = `<div class="page-head" style="margin-bottom:12px"><p class="lead">${rows.length} kelas · ${totalSess} sesi-jam per pekan</p><div class="actions">
      <button class="btn" id="copy">Salin dari semester lain</button><button class="btn" id="imp">${I('dl')} Impor CSV</button><button class="btn primary" id="add">${I('plus')} Tambah kelas</button></div></div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada kelas. Tambah manual, impor CSV, atau salin dari semester sebelumnya.', rowAttr: r => `class="click" data-c="${r.id}"`, columns: [
      { label: 'Mata kuliah', render: r => `<b class="mono">${esc(r.course_code)}</b> ${esc(r.course_name)}${(r.tags || []).length ? `<br>${r.tags.map(t => `<span class="badge">${esc(t)}</span>`).join(' ')}` : ''}` },
      { label: 'Kelas', render: r => esc(r.class_name) }, { label: 'Rombel', render: r => esc(r.student_group || '–') }, { label: 'Dosen', render: r => esc(r.lecturer_name || '–') },
      { label: 'Mhs', num: true, render: r => r.student_count }, { label: 'Durasi', render: r => `${r.duration_slots} sesi × ${r.sessions_per_week}/pekan` },
      { label: 'Ruang', render: r => esc(r.fixed_room_code || r.category_name || 'Bebas') }] })}</div>`;
  const courseOpts = courses.map(c => ({ value: c.id, label: `${c.code} — ${c.name} (${c.credits} sks)` }));
  const fields = async () => [{ name: 'course_id', label: 'Mata kuliah', type: 'select', required: true, options: courseOpts, full: true, help: 'Belum ada? Tambahkan di menu Mata kuliah atau lewat impor CSV.' },
    { name: 'class_name', label: 'Nama kelas', required: true, default: 'A' }, { name: 'student_group', label: 'Rombel (tidak boleh bentrok)', placeholder: 'mis. TI-3A' },
    { name: 'lecturer_id', label: 'Dosen', type: 'select', options: people.filter(p => p.kind === 'dosen').map(p => ({ value: p.id, label: p.name })) },
    { name: 'student_count', label: 'Jumlah mahasiswa', type: 'number', default: 30, min: 1 }, { name: 'duration_slots', label: 'Durasi (sesi berurutan)', type: 'number', default: 2, min: 1, help: 'Umumnya = sks' },
    { name: 'sessions_per_week', label: 'Pertemuan per pekan', type: 'number', default: 1, min: 1 },
    { name: 'required_category_id', label: 'Wajib kategori ruang', type: 'select', empty: 'Ikuti cakupan ruang', options: cats.map(c => ({ value: c.id, label: c.name })) },
    { name: 'fixed_room_id', label: 'Kunci di ruang tertentu', type: 'select', empty: 'Tidak dikunci', options: await Ref.roomOpts(!App.isSA()) }, { name: 'note', label: 'Catatan', type: 'textarea' }];
  $('#add').onclick = async () => UI.formModal({ title: 'Tambah kelas', wide: true, fields: await fields(), onSubmit: async v => { await API.post('/tt/classes', { ...v, period_id: period, unit_id: unit }); App.render(); } });
  body.onclick = async e => {
    const tr = e.target.closest('[data-c]'); if (!tr) return;
    const c = rows.find(x => x.id === Number(tr.dataset.c));
    const m = UI.formModal({ title: `Ubah kelas ${c.course_code} ${c.class_name}`, wide: true, fields: await fields(), values: c, onSubmit: async v => { await API.put('/tt/classes/' + c.id, v); App.render(); } });
    const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Hapus kelas'; del.style.marginRight = 'auto';
    del.onclick = async () => { if (await UI.confirm('Hapus kelas ini?', { danger: true })) { await API.del('/tt/classes/' + c.id); m.close(); App.render(); } };
    $('.modal-foot', m.el).prepend(del);
  };
  $('#copy').onclick = () => UI.formModal({ title: 'Salin kelas dari semester lain', fields: [{ name: 'from_period_id', label: 'Semester sumber', type: 'select', required: true, options: periods.filter(p => p.id !== period).map(p => ({ value: p.id, label: p.name })) }],
    onSubmit: async v => { const r = await API.post('/tt/classes/copy', { ...v, to_period_id: period, unit_id: unit }); UI.toast(`${r.copied} kelas disalin`); App.render(); } });
  $('#imp').onclick = () => {
    const head = 'course_code,course_name,credits,semester_level,tags,class_name,student_group,lecturer,student_count,duration_slots,sessions_per_week,category';
    const m = UI.modal({ title: 'Impor kelas dari CSV', wide: true, body: `<p>Kolom (baris pertama = judul). Pemisah koma atau titik koma. Kolom <span class="mono">lecturer</span> berisi NIDN atau nama dosen; <span class="mono">tags</span> dipisah titik koma; <span class="mono">category</span> = nama kategori ruang.</p>
      <pre class="mono" style="background:var(--sunk);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px">${head}\nIF101,Kalkulus I,3,1,matematika,A,TI-1A,0401018801,40,3,1,Ruang Kelas\nIF205,Basis Data,3,3,praktikum,A,TI-3A,Budi Santoso,35,3,1,Laboratorium</pre>
      <label class="field"><span>Berkas CSV</span><input type="file" accept=".csv,text/csv" id="csvF"></label><label class="field" style="margin-top:10px"><span>atau tempel isi CSV</span><textarea id="csvT" style="min-height:140px;font-family:var(--mono);font-size:12px"></textarea></label><div id="csvR"></div>`,
      actions: [{ label: 'Batal' }, { label: 'Impor', kind: 'primary', onClick: async () => {
        const rowsCsv = parseCSV($('#csvT', m.el).value); if (!rowsCsv.length) throw new Error('CSV kosong');
        const r = await API.post('/tt/classes/import', { period_id: period, unit_id: unit, rows: rowsCsv });
        UI.toast(`${r.imported} kelas diimpor`); if (r.errors.length) { $('#csvR', m.el).innerHTML = `<div class="form-error">${r.errors.map(esc).join('<br>')}</div>`; return false; } App.render(); } }] });
    $('#csvF', m.el).onchange = async e => { $('#csvT', m.el).value = await e.target.files[0].text(); };
  };
}
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = l => { const out = []; let cur = '', qt = false; for (const ch of l) { if (ch === '"') qt = !qt; else if (ch === sep && !qt) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const h = split(lines[0]).map(x => x.toLowerCase());
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [h[i], v])));
}

async function ttConstraints(body, { period, unit, slots, cats }) {
  const [runs, people, courses, rooms] = await Promise.all([API.get('/tt/runs', { period_id: period, unit_id: unit }), Ref.get('people'), API.get('/courses', { limit: 5000 }).then(r => r.rows), API.get('/rooms', App.isSA() ? { unit_id: unit } : { mine: 1 }).then(r => r.rows)]);
  const key = `tt_cfg_${unit}`;
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  const last = runs[0];
  const cfg = saved || { room_scope: last ? last.room_scope : { mode: 'owned' }, constraints: last ? (await API.get('/tt/runs/' + last.id)).constraints : [CON_TYPES.block.make(), CON_TYPES.early.make(), CON_TYPES.spread.make()],
    params: { population: 60, generations: 1000, time_limit_ms: 90000, days: [1, 2, 3, 4, 5, 6], ...(last ? last.params : {}) } };
  const save = () => localStorage.setItem(key, JSON.stringify(cfg));
  const dayChecks = (sel, attr) => [1, 2, 3, 4, 5, 6, 7].map(d => `<label class="check"><input type="checkbox" ${attr}="${d}" ${sel.includes(d) ? 'checked' : ''}>${ISO_DAY[d].slice(0, 3)}</label>`).join('');
  const slotChecks = (sel, attr) => slots.map(s => `<label class="check" title="${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}"><input type="checkbox" ${attr}="${s.slot_no}" ${sel.includes(s.slot_no) ? 'checked' : ''}>${s.slot_no}</label>`).join('');
  const lect = people.filter(p => p.kind === 'dosen');
  const scopeValues = (c, i) => {
    const s = c.scope || { kind: 'all' };
    if (s.kind === 'all') return '';
    if (s.kind === 'tags' || s.kind === 'groups') return `<input data-ci="${i}" data-k="scopevals" value="${esc((s.values || []).join(', '))}" placeholder="${s.kind === 'tags' ? 'matematika, statistika' : 'TI-1A, TI-1B'}">`;
    const opts = s.kind === 'lecturer' ? lect.map(p => ({ value: p.id, label: p.name })) : courses.map(c2 => ({ value: c2.id, label: `${c2.code} ${c2.name}` }));
    return `<select multiple data-ci="${i}" data-k="scopemulti" style="min-height:80px">${opts.map(o => `<option value="${o.value}" ${(s.values || []).map(Number).includes(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  };
  const conCard = (c, i) => {
    const title = c.type === 'time' ? { early: 'Diutamakan jam awal', late: 'Diutamakan jam akhir', only: 'Hanya pada waktu tertentu', avoid: 'Hindari waktu tertentu' }[c.mode] : { lecturer_max_daily: 'Batas kelas dosen per hari', group_compact: 'Padatkan jadwal rombel', spread_sessions: 'Sebar pertemuan' }[c.type];
    return `<div class="con-card"><div class="btn-row" style="justify-content:space-between"><b>${title}</b><div class="btn-row">
      ${c.type === 'time' && ['only', 'avoid'].includes(c.mode) ? `<label class="check"><input type="checkbox" data-ci="${i}" data-k="hard" ${c.hard ? 'checked' : ''}> Wajib (keras)</label>` : ''}
      <label class="check">Bobot <input type="number" min="1" data-ci="${i}" data-k="weight" value="${c.weight}" style="width:70px"></label><button class="btn ghost sm" data-rm="${i}" aria-label="Hapus kendala">${I('trash')}</button></div></div>
      ${c.type === 'time' ? `<div class="form-grid" style="margin-top:10px"><label class="field"><span>Berlaku untuk</span><select data-ci="${i}" data-k="scopekind">${SCOPES.map(([k, l]) => `<option value="${k}" ${(c.scope || {}).kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field">${(c.scope || {}).kind !== 'all' ? '<span>Pilihan</span>' : ''}${scopeValues(c, i)}</div>
        ${['only', 'avoid'].includes(c.mode) ? `<div class="field full"><span>Hari (kosong = semua hari)</span><div class="btn-row">${dayChecks(c.days || [], `data-ci="${i}" data-day`)}</div></div>
        <div class="field full"><span>Sesi (kosong = sepanjang hari)</span><div class="btn-row">${slotChecks(c.slots || [], `data-ci="${i}" data-slot`)}</div></div>` : `<label class="field"><span>Mode</span><select data-ci="${i}" data-k="mode"><option value="early" ${c.mode === 'early' ? 'selected' : ''}>Makin pagi makin baik</option><option value="late" ${c.mode === 'late' ? 'selected' : ''}>Makin sore makin baik</option></select></label>`}</div>`
      : c.type === 'lecturer_max_daily' ? `<label class="field" style="margin-top:8px;max-width:220px"><span>Maks. kelas per hari</span><input type="number" min="1" data-ci="${i}" data-k="max" value="${c.max}"></label>` : ''}</div>`;
  };
  const draw = () => {
    const rs = cfg.room_scope;
    body.innerHTML = `<div class="grid2"><div class="panel"><div class="panel-head"><h3>Cakupan ruang</h3></div><div class="panel-body stack">
        <label class="check"><input type="radio" name="rsm" value="owned" ${rs.mode === 'owned' || !rs.mode ? 'checked' : ''}> Semua ruang kuliah/lab yang dikelola unit</label>
        <label class="check"><input type="radio" name="rsm" value="category" ${rs.mode === 'category' ? 'checked' : ''}> Hanya kategori tertentu</label>
        ${rs.mode === 'category' ? `<div class="btn-row" style="padding-left:24px">${cats.map(c => `<label class="check"><input type="checkbox" data-cat="${c.id}" ${(rs.category_ids || []).map(Number).includes(c.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}</div>` : ''}
        <label class="check"><input type="radio" name="rsm" value="rooms" ${rs.mode === 'rooms' ? 'checked' : ''}> Pilih ruang satu per satu</label>
        ${rs.mode === 'rooms' ? `<div style="padding-left:24px;max-height:220px;overflow-y:auto">${rooms.map(r => `<label class="check" style="display:flex"><input type="checkbox" data-room="${r.id}" ${(rs.room_ids || []).map(Number).includes(r.id) ? 'checked' : ''}><span class="mono">${esc(r.code)}</span> ${esc(r.name)} <small>(${r.capacity})</small></label>`).join('') || '<span class="muted">Unit belum mengelola ruang.</span>'}</div>` : ''}
        ${App.isSA() ? `<label class="check"><input type="radio" name="rsm" value="campus" ${rs.mode === 'campus' ? 'checked' : ''}> Seluruh ruang kuliah kampus (lintas unit)</label>` : ''}
        <p class="muted" style="font-size:13px">Jadwal berulang unit lain di ruang yang sama otomatis dihindari.</p></div></div>
      <div class="panel"><div class="panel-head"><h3>Hari, sesi & parameter algoritma</h3></div><div class="panel-body stack">
        <div class="field"><span>Hari kuliah</span><div class="btn-row">${dayChecks(cfg.params.days || [1, 2, 3, 4, 5, 6], 'data-pday')}</div></div>
        <div class="field"><span>Sesi yang dipakai (kosong = semua)</span><div class="btn-row">${slotChecks(cfg.params.slot_nos || [], 'data-pslot')}</div>
          <small class="help">${slots.map(s => `${s.slot_no}: ${s.start_time.slice(0, 5)}`).join(' · ')}</small></div>
        <div class="form-grid"><label class="field"><span>Populasi</span><input type="number" min="10" max="300" data-p="population" value="${cfg.params.population}"></label>
          <label class="field"><span>Generasi maks.</span><input type="number" min="50" max="20000" data-p="generations" value="${cfg.params.generations}"></label>
          <label class="field"><span>Batas waktu (detik)</span><input type="number" min="10" max="900" data-p="time_limit_s" value="${Math.round((cfg.params.time_limit_ms || 90000) / 1000)}"></label></div></div></div></div>
      <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Kendala khusus</h3><div class="actions"><select id="addCon" style="width:auto"><option value="">+ Tambah kendala…</option>${Object.entries(CON_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div></div>
        <div class="panel-body">${cfg.constraints.map(conCard).join('') || '<div class="empty">Tanpa kendala khusus: algoritma hanya mencegah bentrok ruang, dosen, dan rombel.</div>'}
        <p class="muted" style="font-size:13px;margin-top:12px">Kendala <b>wajib</b> dipenuhi mutlak (mempersempit pilihan waktu). Kendala lain bersifat preferensi; bobot makin besar makin diprioritaskan. Bentrok ruang, dosen, rombel, dan kapasitas ruang selalu dijaga.</p></div></div>
      <div class="btn-row" style="margin-top:18px;justify-content:flex-end"><button class="btn primary" id="run">${I('cpu')} Simpan & jalankan penjadwalan</button></div>`;
  };
  draw();
  body.oninput = body.onchange = e => {
    const t = e.target, i = t.dataset.ci !== undefined ? Number(t.dataset.ci) : null, c = i !== null ? cfg.constraints[i] : null;
    if (t.name === 'rsm') { cfg.room_scope = { mode: t.value, category_ids: [], room_ids: [] }; save(); return draw(); }
    if (t.dataset.cat) cfg.room_scope.category_ids = $$('[data-cat]:checked', body).map(x => Number(x.dataset.cat));
    if (t.dataset.room) cfg.room_scope.room_ids = $$('[data-room]:checked', body).map(x => Number(x.dataset.room));
    if (t.dataset.pday) cfg.params.days = $$('[data-pday]:checked', body).map(x => Number(x.dataset.pday));
    if (t.dataset.pslot) cfg.params.slot_nos = $$('[data-pslot]:checked', body).map(x => Number(x.dataset.pslot));
    if (t.dataset.p) { if (t.dataset.p === 'time_limit_s') cfg.params.time_limit_ms = Number(t.value) * 1000; else cfg.params[t.dataset.p] = Number(t.value); }
    if (c) {
      const k = t.dataset.k;
      if (k === 'hard') c.hard = t.checked; else if (k === 'weight') c.weight = Number(t.value); else if (k === 'max') c.max = Number(t.value); else if (k === 'mode') c.mode = t.value;
      else if (k === 'scopekind') { c.scope = { kind: t.value, values: [] }; save(); return draw(); }
      else if (k === 'scopevals') c.scope.values = t.value.split(',').map(s => s.trim()).filter(Boolean);
      else if (k === 'scopemulti') c.scope.values = [...t.selectedOptions].map(o => Number(o.value));
      if (t.dataset.day !== undefined) c.days = $$(`[data-ci="${i}"][data-day]:checked`, body).map(x => Number(x.dataset.day));
      if (t.dataset.slot !== undefined) c.slots = $$(`[data-ci="${i}"][data-slot]:checked`, body).map(x => Number(x.dataset.slot));
    }
    if (t.id === 'addCon' && t.value) { cfg.constraints.push(CON_TYPES[t.value].make()); save(); return draw(); }
    save();
  };
  body.onclick = async e => {
    const rm = e.target.closest('[data-rm]'); if (rm) { cfg.constraints.splice(Number(rm.dataset.rm), 1); save(); return draw(); }
    if (e.target.closest('#run')) {
      try { const r = await API.post('/tt/runs', { period_id: period, unit_id: unit, room_scope: cfg.room_scope, constraints: cfg.constraints, params: cfg.params }); setQ('#/penjadwalan', { period, unit, tab: 'hasil', run: r.id }); } catch (er) { UI.err(er); }
    }
  };
}

async function ttResults(body, { period, unit, slots }, q) {
  const runs = await API.get('/tt/runs', { period_id: period, unit_id: unit });
  if (!runs.length) { body.innerHTML = '<div class="empty">Belum ada proses penjadwalan. Atur ruang & kendala, lalu jalankan.</div>'; return; }
  const runId = Number(q.run) || runs[0].id;
  body.innerHTML = `<div class="filters"><select id="runSel" style="min-width:360px">${runs.map(r => `<option value="${r.id}" ${r.id === runId ? 'selected' : ''}>#${r.id} · ${fmt.dt(r.created_at)} · ${STATUS[r.status][0]}${r.hard_violations !== null ? ` · bentrok ${r.hard_violations}` : ''}</option>`).join('')}</select></div><div id="runBody"></div>`;
  $('#runSel').onchange = e => setQ('#/penjadwalan', { period, unit, tab: 'hasil', run: e.target.value });
  let timer;
  const show = async () => {
    const run = await API.get('/tt/runs/' + runId), rb = $('#runBody'); if (!rb) return clearInterval(timer);
    if (run.status === 'running') {
      rb.innerHTML = `<div class="panel panel-body"><h3>Algoritma sedang bekerja…</h3><div class="progress" style="margin:14px 0"><i style="width:${run.progress}%"></i></div>
        <p class="muted">Progres ${run.progress}% · bentrok terbaik saat ini: ${run.hard_violations ?? '–'} · penalti preferensi: ${run.soft_penalty ?? '–'}</p><button class="btn danger sm" id="stop">Hentikan</button></div>`;
      $('#stop').onclick = async () => { await API.post(`/tt/runs/${runId}/cancel`); show(); };
      return;
    }
    clearInterval(timer);
    if (run.status === 'failed' || run.status === 'cancelled') { rb.innerHTML = `<div class="panel panel-body"><h3>${STATUS[run.status][0]}</h3><p>${esc(run.log || '')}</p></div>`; return; }
    const R = run.result, A = R.assignments, rs = R.slots, days = R.days;
    const view = q.by || 'room';
    const keyOf = { room: a => a.room_code, lecturer: a => a.lecturer_name || '(tanpa dosen)', group: a => a.group || '(tanpa rombel)' }[view];
    const keys = [...new Set(A.map(keyOf))].sort();
    const pick = q.key && keys.includes(q.key) ? q.key : keys[0];
    const confIds = new Set((R.conflicts || []).map(c => c.class_id));
    const cell = (d, si) => A.map((a, i) => [a, i]).filter(([a]) => keyOf(a) === pick && a.day === d && a.slot_index === si)
      .map(([a, i]) => `<div class="tt-cell ${confIds.has(a.class_id) ? 'conf' : ''}" data-ai="${i}"><b>${esc(a.course_code)} ${esc(a.class_name)}</b><br>${esc(a.course_name)}<br><small>${esc(view === 'room' ? a.lecturer_name || '' : a.room_code)} · ${esc(a.group || '')} · ${a.start_time}–${a.end_time}</small></div>`).join('');
    rb.innerHTML = `<div class="stats"><div class="stat"><b>${R.hard}</b><span>Bentrok keras</span></div><div class="stat"><b>${fmt.num(R.soft, 1)}</b><span>Penalti preferensi</span></div>
        <div class="stat"><b>${A.length}</b><span>Sesi terjadwal</span></div><div class="stat"><b>${fmt.num(R.generations)}</b><span>Generasi</span></div><div class="stat"><b>${fmt.num(R.ms / 1000, 1)} dtk</b><span>Waktu proses</span></div></div>
      ${R.hard ? `<div class="form-error">${R.hard} bentrok tersisa: ${(R.conflicts || []).slice(0, 8).map(c => `${esc(c.label)} (${c.reasons.join(', ')})`).join('; ')}. Tambah ruang/hari, longgarkan kendala wajib, atau ubah manual.</div>` : ''}
      ${R.warnings && R.warnings.length ? `<details style="margin-bottom:12px"><summary class="muted">${R.warnings.length} catatan</summary><ul>${R.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      <div class="filters"><select id="by"><option value="room" ${view === 'room' ? 'selected' : ''}>Per ruang</option><option value="lecturer" ${view === 'lecturer' ? 'selected' : ''}>Per dosen</option><option value="group" ${view === 'group' ? 'selected' : ''}>Per rombel</option></select>
        <select id="key">${keys.map(k => `<option ${k === pick ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
        <span style="margin-left:auto" class="btn-row"><button class="btn sm" id="csv">${I('dl')} Unduh CSV</button><button class="btn sm" onclick="print()">${I('print')} Cetak</button>
        ${run.status === 'published' ? `<span class="badge ok">Dipublikasikan ${fmt.dt(run.published_at)}</span><button class="btn sm" id="pub">Publikasikan ulang</button>` : `<button class="btn primary sm" id="pub">${I('check')} Publikasikan ke jadwal</button>`}
        <button class="btn sm danger" id="delRun">Hapus</button></span></div>
      <div class="table-wrap"><table class="tt-grid"><thead><tr><th>Sesi</th>${days.map(d => `<th>${ISO_DAY[d]}</th>`).join('')}</tr></thead><tbody>
        ${rs.map((s, si) => `<tr><th style="white-space:nowrap">${s.slot_no}<br><small>${s.start_time}</small></th>${days.map(d => `<td>${cell(d, si)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:13px;margin-top:8px">Klik kartu kelas untuk memindahkan secara manual sebelum dipublikasikan.</p>`;
    $('#by').onchange = e => setQ('#/penjadwalan', { period, unit, tab: 'hasil', run: runId, by: e.target.value });
    $('#key').onchange = e => setQ('#/penjadwalan', { period, unit, tab: 'hasil', run: runId, by: view, key: e.target.value });
    $('#csv').onclick = () => {
      const lines = [['hari', 'mulai', 'selesai', 'kode_mk', 'mata_kuliah', 'kelas', 'rombel', 'dosen', 'ruang', 'mahasiswa'].join(',')].concat(
        [...A].sort((a, b) => a.day - b.day || a.slot_index - b.slot_index).map(a => [ISO_DAY[a.day], a.start_time, a.end_time, a.course_code, `"${a.course_name}"`, a.class_name, a.group || '', `"${a.lecturer_name || ''}"`, a.room_code, a.size].join(',')));
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' }); const u = URL.createObjectURL(blob);
      const l = document.createElement('a'); l.href = u; l.download = `jadwal-run-${runId}.csv`; l.click(); URL.revokeObjectURL(u);
    };
    $('#delRun').onclick = async () => { if (await UI.confirm('Hapus hasil ini? Jika sudah dipublikasikan, jadwal kuliah dari hasil ini ikut terhapus.', { danger: true, ok: 'Hapus' })) { await API.del('/tt/runs/' + runId); setQ('#/penjadwalan', { period, unit, tab: 'hasil' }); } };
    $('#pub').onclick = () => UI.formModal({ title: 'Publikasikan jadwal kuliah', submit: 'Publikasikan',
      fields: [{ name: 'start_date', label: 'Mulai tanggal', type: 'date', help: 'Kosong = awal periode' }, { name: 'end_date', label: 'Sampai tanggal', type: 'date', help: 'Kosong = akhir periode' },
        { name: 'skip_dates', label: 'Tanggal dikecualikan (libur, UTS/UAS)', type: 'textarea', placeholder: '2026-10-20, 2026-10-21 …', help: 'Pisahkan dengan koma/baris baru. Rentang: 2026-11-02..2026-11-07' },
        ...(R.hard ? [{ name: 'force', label: `Tetap publikasikan walau ada ${R.hard} bentrok (event yang bentrok dilewati)`, type: 'checkbox' }] : [])],
      extra: '<p class="muted" style="margin-top:10px">Jadwal hasil publikasi sebelumnya untuk unit & periode ini akan diganti mulai tanggal di atas.</p>',
      onSubmit: async v => {
        const skip = []; String(v.skip_dates || '').split(/[\s,]+/).filter(Boolean).forEach(t => {
          const [a, b] = t.split('..'); if (!b) return skip.push(a);
          for (let d = new Date(a + 'T00:00:00'); d <= new Date(b + 'T00:00:00'); d.setDate(d.getDate() + 1)) skip.push(fmt.ymd(d));
        });
        const r = await API.post(`/tt/runs/${runId}/publish`, { ...v, skip_dates: skip });
        UI.modal({ title: 'Jadwal dipublikasikan', body: `<p>${fmt.num(r.created)} dari ${fmt.num(r.expected)} pertemuan masuk ke jadwal ruang.</p>${r.skipped.length ? `<div class="form-error">${r.skipped.map(esc).join('<br>')}</div>` : ''}`, actions: [{ label: 'Tutup', onClick: () => App.render() }] });
      } });
    rb.onclick = e => {
      const c = e.target.closest('[data-ai]'); if (!c || run.status === 'published') return;
      const idx = Number(c.dataset.ai), a = A[idx];
      UI.formModal({ title: `Pindahkan ${a.course_code} ${a.class_name}`, values: { day: a.day, slot_index: a.slot_index, room_id: a.room_id },
        fields: [{ name: 'day', label: 'Hari', type: 'select', empty: false, options: days.map(d => ({ value: d, label: ISO_DAY[d] })) },
          { name: 'slot_index', label: 'Mulai sesi', type: 'select', empty: false, options: rs.map((s, i) => ({ value: i, label: `${s.slot_no} (${s.start_time})` })) },
          { name: 'room_id', label: 'Ruang', type: 'select', empty: false, options: R.rooms.map(r => ({ value: r.id, label: `${r.code} (${r.capacity})` })) }],
        onSubmit: async v => { await API.put(`/tt/runs/${runId}/assignment`, { index: idx, day: Number(v.day), slot_index: Number(v.slot_index), room_id: Number(v.room_id) }); show(); } });
    };
  };
  await show();
  timer = setInterval(() => { if ($('.progress')) show(); else clearInterval(timer); }, 1500);
  App.cleanup = () => clearInterval(timer);
}
