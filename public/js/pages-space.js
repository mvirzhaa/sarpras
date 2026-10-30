/* ===== Halaman: dashboard, gedung & denah, peta, jadwal, peminjaman, kerusakan, masukan ===== */
'use strict';
const unitFilter = async (cur, all = 'Seluruh unit') => (App.isSA() || App.me.role === 'pimpinan')
  ? `<select data-f="unit_id"><option value="">${all}</option>${UI.options(await Ref.opts('units', u => u.name), cur)}</select>` : '';
const setQ = (base, q) => { location.hash = base + API.qs(q); };

// ---------------- Dashboard ----------------
route(/^#\/dashboard$/, async (view, _, q) => {
  const d = await API.get('/dashboard', { unit_id: q.unit_id });
  const h = new Date().getHours(), greet = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam';
  const cond = Object.fromEntries(d.conditions.map(c => [c.condition, c.n]));
  view.innerHTML = App.head(`Selamat ${greet}, ${App.me.name || App.me.username}`, `Pemanfaatan ruang, masukan, dan aset ${esc(App.me.unit_name || 'seluruh kampus')} per ${fmt.date(d.date)}.`,
    await unitFilter(q.unit_id)) + `
    <div class="stats">
      <div class="stat"><b>${d.busy_now}<small style="font-size:15px;color:var(--muted)"> / ${d.rooms.total}</small></b><span>Ruang sedang dipakai</span></div>
      <div class="stat"><b>${fmt.num(d.util_today, 1)}%</b><span>Utilisasi hari ini</span></div>
      <div class="stat"><b>${fmt.num(d.util_7d, 1)}%</b><span>Utilisasi 7 hari</span></div>
      <div class="stat"><b>${d.pending}</b><span><a href="#/peminjaman">Peminjaman menunggu</a></span></div>
      <div class="stat"><b>${d.feedback.new || 0}</b><span><a href="#/masukan?status=baru">Masukan baru</a></span></div>
      <div class="stat"><b>${d.damages.open || 0}</b><span><a href="#/kerusakan">Kerusakan terbuka</a>${d.damages.severe ? ` · <span class="badge bad">${d.damages.severe} berat</span>` : ''}</span></div>
      <div class="stat"><b style="font-size:19px">${fmt.rp(d.assets.book)}</b><span>Nilai buku ${fmt.num(d.assets.total)} aset</span></div>
    </div>
    <div class="grid2">
      <div class="panel"><div class="panel-head"><h3>Kegiatan per hari, 30 hari terakhir</h3></div><div class="panel-body">${UI.spark(d.trend.map(t => t.events), d.trend.map(t => fmt.date(t.day).slice(0, -5)))}</div></div>
      <div class="panel"><div class="panel-head"><h3>Ruang tersibuk (7 hari)</h3><div class="actions"><a class="btn sm ghost" href="#/tabulasi">Tabulasi</a></div></div><div class="panel-body">${UI.bars(d.top_rooms.map(r => ({ label: `${r.code} · ${r.building}`, value: r.utilization })), { max: 100, fmtv: v => fmt.num(v, 1) + '%' })}</div></div>
      <div class="panel"><div class="panel-head"><h3>Ruang paling jarang dipakai (7 hari)</h3></div><div class="panel-body">${UI.bars(d.idle_rooms.map(r => ({ label: `${r.code} · ${r.building}`, value: r.utilization })), { max: 100, color: 'var(--amber)', fmtv: v => fmt.num(v, 1) + '%' })}
        <p class="muted" style="margin-top:10px;font-size:13px">Ruang dengan utilisasi rendah dapat ditawarkan ke unit lain melalui peminjaman.</p></div></div>
      <div class="panel"><div class="panel-head"><h3>Kondisi aset</h3><div class="actions"><a class="btn sm ghost" href="#/valuasi">Valuasi</a></div></div><div class="panel-body">
        ${UI.bars(Object.entries(COND).map(([k, v]) => ({ label: v[0], value: cond[k] || 0 })), { fmtv: v => fmt.num(v), color: 'var(--plan)' })}
        <p class="muted" style="margin-top:10px;font-size:13px">Nilai perolehan ${fmt.rp(d.assets.value)} · nilai buku ${fmt.rp(d.assets.book)}</p></div></div>
      <div class="panel"><div class="panel-head"><h3>Ruang dengan keluhan terbanyak (90 hari)</h3></div><div class="panel-body">${UI.bars(d.top_complaints.map(r => ({ label: `${r.code} — ${r.name}`, value: r.n })), { fmtv: v => fmt.num(v), color: 'var(--red)' })}</div></div>
      <div class="panel"><div class="panel-head"><h3>Masukan pengguna ruang</h3></div><div class="panel-body"><dl class="kv">
        <dt>Rata-rata nilai (90 hari)</dt><dd>${d.feedback.rating ? `<b>${d.feedback.rating}</b> / 5` : '–'}</dd><dt>Masuk 30 hari terakhir</dt><dd>${fmt.num(d.feedback.month)}</dd>
        <dt>Sedang diproses</dt><dd>${fmt.num(d.feedback.process)}</dd><dt>Rata-rata waktu perbaikan</dt><dd>${d.damages.avg_days ? d.damages.avg_days + ' hari' : '–'}</dd></dl>
        <p style="margin-top:12px"><a class="btn sm" href="${API.base}/portal.html" target="_blank">${I('ext')} Buka portal masukan publik</a></p></div></div>
    </div>`;
  const u = $('[data-f=unit_id]', view); if (u) u.onchange = () => setQ('#/dashboard', { unit_id: u.value });
});

// ---------------- Gedung ----------------
const BUILDING_FIELDS = [
  { name: 'code', label: 'Kode gedung', required: true, placeholder: 'mis. GKB-A' }, { name: 'name', label: 'Nama gedung', required: true },
  { name: 'address', label: 'Alamat', full: true }, { name: 'floors_count', label: 'Jumlah lantai', type: 'number', min: 1, help: 'Lantai dibuat otomatis' },
  { name: 'year_built', label: 'Tahun dibangun', type: 'number' }, { name: 'building_area', label: 'Luas bangunan (m²)', type: 'number', step: '0.01' },
  { name: 'land_area', label: 'Luas tanah (m²)', type: 'number', step: '0.01' },
  { name: 'ownership', label: 'Status kepemilikan', type: 'select', options: ['Milik sendiri', 'Sewa', 'Pinjam pakai', 'Hibah', 'Wakaf'].map(v => ({ value: v, label: v })) },
  { name: 'condition', label: 'Kondisi', type: 'select', options: [['baik', 'Baik'], ['rusak_ringan', 'Rusak ringan'], ['rusak_sedang', 'Rusak sedang'], ['rusak_berat', 'Rusak berat']].map(([v, l]) => ({ value: v, label: l })) },
  { name: 'certificate_no', label: 'No. sertifikat tanah' }, { name: 'permit_no', label: 'No. IMB/PBG' }, { name: 'slf_no', label: 'No. SLF' },
  { name: 'acquisition_value', label: 'Nilai perolehan (Rp)', type: 'money' }, { name: 'latitude', label: 'Lintang', type: 'number', step: 'any' }, { name: 'longitude', label: 'Bujur', type: 'number', step: 'any' },
  { name: 'description', label: 'Keterangan', type: 'textarea' },
];
route(/^#\/gedung$/, async view => {
  const rows = await Ref.get('buildings', true);
  view.innerHTML = App.head('Gedung & denah', 'Daftar gedung, dokumen, dan denah ruang per lantai.',
    `<a class="btn" href="#/ruang">${I('layers')} Daftar ruang</a>${App.isSA() ? `<button class="btn primary" id="add">${I('plus')} Daftarkan gedung</button>` : ''}`) +
    `<div class="panel">${UI.table({ rows, empty: 'Belum ada gedung. Daftarkan gedung pertama untuk mulai menggambar denah.', rowAttr: r => `class="click" data-go="#/gedung/${r.id}"`,
      columns: [{ label: 'Kode', render: r => `<b>${esc(r.code)}</b>` }, { label: 'Nama', key: 'name' }, { label: 'Lantai', num: true, render: r => r.floor_total },
        { label: 'Ruang', num: true, render: r => r.room_total }, { label: 'Kapasitas', num: true, render: r => fmt.num(r.capacity_total) },
        { label: 'Luas bangunan', num: true, render: r => r.building_area ? fmt.num(r.building_area) + ' m²' : '–' }, { label: 'Unit pengelola', render: r => esc(r.units || '–') }] })}</div>`;
  view.onclick = e => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = tr.dataset.go; };
  const add = $('#add'); if (add) add.onclick = () => UI.formModal({ title: 'Daftarkan gedung', wide: true, fields: BUILDING_FIELDS, values: { floors_count: 1, ownership: 'Milik sendiri', condition: 'baik' },
    onSubmit: async v => { const b = await API.post('/buildings', v); Ref.clear('buildings'); location.hash = '#/gedung/' + b.id; } });
});

const DOC_TYPES = [['foto_sampul', 'Foto sampul'], ['foto', 'Foto'], ['sertifikat', 'Sertifikat tanah'], ['imb_pbg', 'IMB/PBG'], ['slf', 'SLF'], ['gambar_teknis', 'Gambar teknis/as-built'], ['kontrak', 'Kontrak/BAST'], ['lainnya', 'Lainnya']];
async function filesPanel(el, entity_type, entity_id, canUpload, types = DOC_TYPES) {
  const load = async () => {
    const rows = await API.get('/files', { entity_type, entity_id });
    $('.flist', el).innerHTML = rows.length ? `<ul class="room-list">${rows.map(f => `<li style="cursor:default">${/^image\//.test(f.mime) ? `<img src="${API.file(f.id)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:4px">` : I('doc')}
      <div style="flex:1;min-width:0"><a href="${API.file(f.id)}" target="_blank">${esc(f.title || f.file_name)}</a><br><small>${esc((types.find(t => t[0] === f.doc_type) || [, f.doc_type || ''])[1])} · ${fmt.date(f.created_at)} · ${fmt.num(f.size / 1024)} KB</small></div>
      ${canUpload ? `<button class="btn ghost sm" data-delf="${f.id}" aria-label="Hapus">${I('trash')}</button>` : ''}</li>`).join('')}</ul>` : '<div class="empty">Belum ada dokumen.</div>';
  };
  el.innerHTML = `${canUpload ? `<div class="btn-row" style="margin-bottom:10px"><select class="dt" style="width:auto">${types.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <label class="btn sm">${I('plus')} Unggah<input type="file" hidden multiple></label></div>` : ''}<div class="flist"></div>`;
  if (canUpload) {
    $('input[type=file]', el).onchange = async e => {
      for (const f of e.target.files) { try { await API.upload(f, { entity_type, entity_id, doc_type: $('.dt', el).value, title: f.name }); } catch (er) { UI.err(er); } }
      e.target.value = ''; load(); UI.toast('Dokumen diunggah');
    };
    el.onclick = async e => { const b = e.target.closest('[data-delf]'); if (b && await UI.confirm('Hapus dokumen ini?', { danger: true, ok: 'Hapus' })) { await API.del('/files/' + b.dataset.delf); load(); } };
  }
  await load();
}

route(/^#\/gedung\/(\d+)$/, async (view, [id]) => {
  const b = await API.get('/buildings/' + id), sa = App.isSA();
  const units = [...new Map(b.assignments.map(a => [a.unit_id, a])).values()];
  view.innerHTML = App.head(b.name, `<span class="mono">${esc(b.code)}</span> · ${esc(b.address || 'Alamat belum diisi')}`,
    `<a class="btn" href="#/gedung">Kembali</a>${sa ? `<button class="btn" id="edit">Ubah data</button><button class="btn danger" id="del">Hapus</button>` : ''}`) + `
    <div class="stats"><div class="stat"><b>${b.floors.length}</b><span>Lantai</span></div><div class="stat"><b>${b.floors.reduce((s, f) => s + f.room_total, 0)}</b><span>Ruang</span></div>
      <div class="stat"><b>${fmt.num(b.floors.reduce((s, f) => s + f.area_total, 0))} m²</b><span>Luas ruang tergambar</span></div>
      <div class="stat"><b>${fmt.num(b.stats.assets)}</b><span>Aset aktif</span></div><div class="stat"><b style="font-size:19px">${fmt.rp(b.stats.value)}</b><span>Nilai aset di gedung</span></div></div>
    <div class="grid2">
      <div class="panel"><div class="panel-head"><h3>Lantai & denah</h3><div class="actions">${sa ? `<button class="btn sm" id="addFloor">${I('plus')} Lantai</button>` : ''}</div></div>
        ${UI.table({ rows: b.floors, empty: 'Belum ada lantai.', columns: [{ label: 'Lantai', render: f => `<b>${esc(f.name || 'Lantai ' + f.level)}</b>` }, { label: 'Ukuran', render: f => `${fmt.num(f.width)} × ${fmt.num(f.height)} m` },
          { label: 'Ruang', num: true, render: f => f.room_total }, { label: 'Luas', num: true, render: f => fmt.num(f.area_total) + ' m²' },
          { label: '', render: f => `<div class="btn-row" style="justify-content:flex-end"><a class="btn sm ${sa ? 'primary' : ''}" href="#/denah/${f.id}">${sa ? 'Gambar denah' : 'Lihat denah'}</a><a class="btn sm" href="#/peta?f=${f.id}">Keterisian</a>${sa ? `<button class="btn sm ghost" data-delfloor="${f.id}" aria-label="Hapus lantai">${I('trash')}</button>` : ''}</div>` }] })}</div>
      <div class="panel"><div class="panel-head"><h3>Data gedung</h3></div><div class="panel-body"><dl class="kv">
        <dt>Tahun dibangun</dt><dd>${esc(b.year_built || '–')}</dd><dt>Luas bangunan / tanah</dt><dd>${fmt.num(b.building_area)} / ${fmt.num(b.land_area)} m²</dd>
        <dt>Kepemilikan</dt><dd>${esc(b.ownership || '–')}</dd><dt>Kondisi</dt><dd>${esc(b.condition || '–')}</dd><dt>Sertifikat</dt><dd>${esc(b.certificate_no || '–')}</dd>
        <dt>IMB/PBG · SLF</dt><dd>${esc(b.permit_no || '–')} · ${esc(b.slf_no || '–')}</dd><dt>Nilai perolehan</dt><dd>${b.acquisition_value ? fmt.rp(b.acquisition_value) : '–'}</dd>
        <dt>Koordinat</dt><dd>${b.latitude ? `${b.latitude}, ${b.longitude}` : '–'}</dd><dt>Unit pengelola</dt><dd>${units.map(u => esc(u.unit_name) + (u.room_id ? ' (sebagian ruang)' : '')).join(', ') || '<span class="muted">Belum ditugaskan — atur di menu Unit pengelola</span>'}</dd></dl>
        ${b.description ? `<p style="margin-top:12px">${esc(b.description)}</p>` : ''}</div></div>
      <div class="panel" style="grid-column:1/-1"><div class="panel-head"><h3>Dokumentasi gedung</h3></div><div class="panel-body" id="docs"></div></div>
    </div>`;
  filesPanel($('#docs'), 'building', b.id, sa);
  if (!sa) return;
  $('#edit').onclick = () => UI.formModal({ title: 'Ubah data gedung', wide: true, fields: BUILDING_FIELDS.filter(f => f.name !== 'floors_count'), values: b, onSubmit: async v => { await API.put('/buildings/' + id, v); Ref.clear('buildings'); App.render(); } });
  $('#del').onclick = async () => { if (await UI.confirm(`Hapus gedung <b>${esc(b.name)}</b> beserta seluruh lantai dan ruangnya?`, { danger: true, ok: 'Hapus gedung' })) { await API.del('/buildings/' + id).catch(UI.err); Ref.clear('buildings', 'rooms'); location.hash = '#/gedung'; } };
  $('#addFloor').onclick = () => UI.formModal({ title: 'Tambah lantai', fields: [{ name: 'level', label: 'Nomor lantai', type: 'number', required: true, help: 'Basement: 0 atau negatif' }, { name: 'name', label: 'Nama', placeholder: 'mis. Lantai 3' },
    { name: 'width', label: 'Lebar area gambar (m)', type: 'number', default: 60 }, { name: 'height', label: 'Panjang area gambar (m)', type: 'number', default: 30 }],
  values: { level: (Math.max(0, ...b.floors.map(f => f.level)) + 1) }, onSubmit: async v => { await API.post(`/buildings/${id}/floors`, v); App.render(); } });
  view.addEventListener('click', async e => { const d = e.target.closest('[data-delfloor]'); if (d && await UI.confirm('Hapus lantai beserta semua ruangnya?', { danger: true, ok: 'Hapus' })) { await API.del('/floors/' + d.dataset.delfloor).catch(UI.err); App.render(); } });
});

// ---------------- Editor denah ----------------
route(/^#\/denah\/(\d+)$/, async (view, [fid]) => {
  const [f, cats] = await Promise.all([API.get('/floors/' + fid), Ref.get('categories')]);
  if (!App.isSA()) { location.hash = '#/peta?f=' + fid; return; }
  view.innerHTML = App.head(`Denah ${f.building_name}`, 'Gambar ruang di kanvas, lalu lengkapi data tiap ruang di panel kanan. Perubahan baru tersimpan setelah menekan Simpan denah.',
    `<a class="btn" href="#/gedung/${f.building_id}">Kembali ke gedung</a><button class="btn primary" id="save">${I('save')} Simpan denah</button>`) + `
    <div class="floor-tabs" style="margin-bottom:10px">${f.siblings.map(s => `<button data-floor="${s.id}" class="${s.id === f.id ? 'on' : ''}">${esc(s.name || 'Lantai ' + s.level)}</button>`).join('')}</div>
    <div class="fp-layout"><div><div class="fp-toolbar no-print">
      <button class="tool on" data-tool="select" title="Pilih & pindah (V)" aria-label="Pilih">${I('pointer')}</button>
      <button class="tool" data-tool="rect" title="Ruang persegi (R)" aria-label="Ruang persegi">${I('rect')}</button>
      <button class="tool" data-tool="poly" title="Ruang poligon (P)" aria-label="Ruang poligon">${I('poly')}</button>
      <button class="tool" data-tool="pan" title="Geser tampilan (H / tahan Spasi)" aria-label="Geser">${I('hand')}</button><span class="sep"></span>
      <button class="tool" data-act="undo" title="Urungkan (Ctrl+Z)" aria-label="Urungkan">${I('undo')}</button><button class="tool" data-act="redo" title="Ulangi (Ctrl+Y)" aria-label="Ulangi">${I('redo')}</button>
      <button class="tool" data-act="dup" title="Duplikat (Ctrl+D)" aria-label="Duplikat">${I('copy')}</button><button class="tool" data-act="del" title="Hapus (Del)" aria-label="Hapus">${I('trash')}</button><span class="sep"></span>
      <label class="tool" title="Gambar latar untuk dijiplak (scan denah lama)" aria-label="Gambar latar">${I('img')}<input type="file" accept="image/*" hidden id="bgFile"></label>
      <input type="range" min="0" max="1" step="0.05" value="${f.background_opacity}" id="bgOp" style="width:90px;min-height:0" title="Transparansi latar" aria-label="Transparansi latar">
      <button class="btn sm ghost" data-act="size">Ukuran ${fmt.num(f.width)}×${fmt.num(f.height)} m</button>
      ${f.siblings.length > 1 ? `<button class="btn sm ghost" data-act="copy">Salin dari lantai…</button>` : ''}
      <span class="muted" id="dirty" style="margin-left:auto;font-size:13px"></span></div>
      <div id="fpHost"></div></div><aside class="fp-side" id="side"></aside></div>`;
  const draftKey = 'fp_draft_' + fid;
  let fp;
  const catOpts = cats.map(c => ({ value: c.id, label: c.name }));
  const init = (rooms) => {
    fp && fp.destroy();
    fp = new FloorPlan($('#fpHost'), { mode: 'edit', width: f.width, height: f.height, grid: f.grid, rooms, categories: cats, bg: f.background_file_id ? API.file(f.background_file_id) : null, bgOpacity: f.background_opacity,
      codePrefix: `${f.building_code}-${f.level}`, onSelect: (r, i) => side(r, i), onTool: t => setTool(t), onOpen: i => fp.select(i),
      onChange: () => { $('#dirty').textContent = 'Ada perubahan belum disimpan'; localStorage.setItem(draftKey, JSON.stringify(fp.rooms)); } });
    side(null, -1);
  };
  const setTool = t => { fp.setTool(t); $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); };
  const side = (r, i) => {
    const s = $('#side');
    if (!r) {
      const area = fp.rooms.reduce((a, x) => a + FPG.area(FPG.pts(x.shape)), 0);
      s.innerHTML = `<h3>${fp.rooms.length} ruang · ${fmt.num(area, 1)} m²</h3>
        ${fp.overlaps && fp.overlaps.size ? `<div class="form-error" style="margin-top:10px">${fp.overlaps.size} ruang bertumpuk (garis merah putus-putus). Periksa kembali.</div>` : ''}
        ${fp.unplaced.length ? `<p class="muted" style="margin-top:8px">${fp.unplaced.length} ruang terdaftar belum digambar.</p>` : ''}
        <div class="fp-legend" style="margin:12px 0">${cats.map(c => `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>
        <ul class="room-list">${fp.rooms.map((x, k) => `<li data-pick="${k}"><i class="dot" style="background:${fp.color(x)}"></i><b class="mono">${esc(x.code)}</b> <span style="flex:1">${esc(x.name)}</span><small>${fmt.num(FPG.area(FPG.pts(x.shape)), 1)} m²</small></li>`).join('') || '<li class="muted" style="cursor:default">Belum ada ruang. Pilih alat Ruang persegi lalu seret di kanvas.</li>'}</ul>
        <p class="muted" style="font-size:12.5px;margin-top:14px">Pintasan: V pilih · R persegi · P poligon · H geser · Del hapus · Ctrl+D duplikat · panah geser 1 grid (Shift ×5) · roda tetikus zoom · Alt nonaktifkan snap.</p>`;
      s.onclick = e => { const li = e.target.closest('[data-pick]'); if (li) fp.select(Number(li.dataset.pick)); };
      return;
    }
    const p = FPG.pts(r.shape), bb = FPG.bbox(p);
    s.innerHTML = `<div class="btn-row" style="justify-content:space-between;margin-bottom:12px"><h3>Data ruang</h3><button class="btn sm ghost" id="desel">Tutup</button></div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        ${UI.field({ name: 'code', label: 'Kode ruang', required: true }, r.code)}${UI.field({ name: 'capacity', label: 'Kapasitas (orang)', type: 'number', min: 0 }, r.capacity)}
        <div class="full">${UI.field({ name: 'name', label: 'Nama ruang', required: true }, r.name)}</div>
        <div class="full">${UI.field({ name: 'category_id', label: 'Kategori', type: 'select', options: catOpts }, r.category_id)}</div>
        ${UI.field({ name: 'status', label: 'Status', type: 'select', empty: false, options: [{ value: 'aktif', label: 'Aktif' }, { value: 'perbaikan', label: 'Perbaikan' }, { value: 'nonaktif', label: 'Nonaktif' }] }, r.status)}
        <div class="field"><span>Luas</span><b style="padding:7px 0">${fmt.num(FPG.area(p), 2)} m²</b></div>
        <div class="full">${UI.field({ name: 'facilities', label: 'Fasilitas', placeholder: 'Proyektor, AC, papan tulis…' }, r.facilities)}</div>
        <div class="full">${UI.field({ name: 'description', label: 'Keterangan', type: 'textarea' }, r.description)}</div>
      </div>
      ${r.shape.type === 'rect' ? `<div class="form-grid" style="grid-template-columns:repeat(4,1fr);margin-top:12px">${['x', 'y', 'w', 'h'].map(k => `<label class="field"><span>${{ x: 'X', y: 'Y', w: 'Lebar', h: 'Panjang' }[k]} (m)</span><input type="number" step="${f.grid}" data-geo="${k}" value="${r.shape[k]}"></label>`).join('')}</div>`
        : `<p class="muted" style="font-size:13px;margin-top:10px">Poligon ${p.length} titik, ${fmt.num(bb.w, 2)} × ${fmt.num(bb.h, 2)} m. Seret titik sudut untuk mengubah bentuk.</p>`}
      <div class="btn-row" style="margin-top:14px">${r.shape.type === 'rect' ? '<button class="btn sm" id="toPoly">Jadikan poligon</button>' : '<button class="btn sm" id="toRect">Jadikan persegi</button>'}
        <button class="btn sm" id="dupR">${I('copy')} Duplikat</button><button class="btn sm danger" id="delR">${I('trash')} Hapus</button></div>
      ${typeof r.id === 'number' ? `<p style="margin-top:12px"><button class="btn sm ghost" id="openRoom">Lihat detail ruang ${I('ext')}</button></p>` : ''}`;
    s.onclick = null;
    $$('[name]', s).forEach(inp => inp.addEventListener('change', () => fp.update(i, { [inp.name]: inp.type === 'number' ? Number(inp.value) : inp.value || null })));
    $$('[data-geo]', s).forEach(inp => inp.addEventListener('change', () => { const sh = { ...r.shape, [inp.dataset.geo]: Math.max(inp.dataset.geo === 'w' || inp.dataset.geo === 'h' ? f.grid : -1e9, Number(inp.value)) }; fp.update(i, { shape: sh }); }));
    $('#desel').onclick = () => fp.select(-1);
    $('#delR').onclick = () => fp.remove(i); $('#dupR').onclick = () => fp.duplicate(i);
    const tp = $('#toPoly'); if (tp) tp.onclick = () => fp.toPoly(i); const tr = $('#toRect'); if (tr) tr.onclick = () => fp.toRect(i);
    const op = $('#openRoom'); if (op) op.onclick = () => Pages.roomModal(r.id);
  };
  init(f.rooms);
  const draft = localStorage.getItem(draftKey);
  if (draft && draft !== JSON.stringify(fp.rooms) && await UI.confirm('Ada perubahan denah yang belum disimpan dari sesi sebelumnya. Pulihkan?', { ok: 'Pulihkan' })) { fp.pushUndo(); fp.rooms = JSON.parse(draft); fp.changed(); }
  else localStorage.removeItem(draftKey);
  App.cleanup = () => fp.destroy();
  window.onbeforeunload = () => (fp.dirty ? 'Perubahan denah belum disimpan' : undefined);
  $$('[data-floor]').forEach(b => (b.onclick = async () => { if (fp.dirty && !(await UI.confirm('Perubahan lantai ini belum disimpan. Pindah lantai? (Draf tetap tersimpan di perangkat ini)', { ok: 'Pindah' }))) return; location.hash = '#/denah/' + b.dataset.floor; }));
  $$('[data-tool]').forEach(b => (b.onclick = () => setTool(b.dataset.tool)));
  $('.fp-toolbar').addEventListener('click', async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'undo') fp.undo(); if (act === 'redo') fp.redo(); if (act === 'dup') fp.duplicate(); if (act === 'del') fp.remove();
    if (act === 'size') UI.formModal({ title: 'Ukuran area gambar', fields: [{ name: 'width', label: 'Lebar (m)', type: 'number', step: '0.5', required: true }, { name: 'height', label: 'Panjang (m)', type: 'number', step: '0.5', required: true },
      { name: 'grid', label: 'Snap grid (m)', type: 'select', empty: false, options: [0.1, 0.25, 0.5, 1].map(v => ({ value: v, label: v + ' m' })) }], values: f,
    onSubmit: async v => { await API.put('/floors/' + fid, v); Object.assign(f, v); fp.setFloor(v); fp.fit(); a.textContent = `Ukuran ${fmt.num(v.width)}×${fmt.num(v.height)} m`; } });
    if (act === 'copy') UI.formModal({ title: 'Salin denah dari lantai lain', fields: [{ name: 'source_floor_id', label: 'Lantai sumber', type: 'select', required: true, options: f.siblings.filter(s => s.id !== f.id).map(s => ({ value: s.id, label: s.name || 'Lantai ' + s.level })) }],
      extra: '<p class="muted" style="margin-top:12px">Ruang disalin dengan kode disesuaikan nomor lantai (mis. A-101 → A-201). Ruang dengan kode yang sudah ada dilewati. Simpan perubahan lantai ini dulu bila ada.</p>',
      onSubmit: async v => { const r = await API.post(`/floors/${fid}/copy-from`, v); UI.toast(`${r.copied} ruang disalin`); localStorage.removeItem(draftKey); App.render(); } });
  });
  $('#bgFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const a = await API.upload(file, { entity_type: 'floor', entity_id: fid, doc_type: 'latar_denah' }).catch(UI.err); if (!a) return;
    await API.put('/floors/' + fid, { background_file_id: a.id }); f.background_file_id = a.id; fp.setFloor({ bg: API.file(a.id) });
    UI.toast('Gambar latar dipasang. Sesuaikan ukuran area gambar agar skala cocok.');
  };
  $('#bgOp').oninput = e => fp.setFloor({ bgOpacity: e.target.value });
  $('#bgOp').onchange = e => API.put('/floors/' + fid, { background_opacity: Number(e.target.value) });
  $('#save').onclick = async () => {
    const bad = fp.rooms.find(r => !r.code || !r.name); if (bad) return UI.toast(`Ruang tanpa kode/nama. Lengkapi dulu.`, true);
    const dup = fp.rooms.map(r => r.code).find((c, i, a) => a.indexOf(c) !== i); if (dup) return UI.toast(`Kode ruang ${dup} dipakai lebih dari sekali`, true);
    try {
      const pl = fp.payload();
      if (pl.deleted.length && !(await UI.confirm(`${pl.deleted.length} ruang akan dihapus permanen beserta jadwalnya. Lanjutkan?`, { danger: true, ok: 'Simpan & hapus' }))) return;
      await API.put(`/floors/${fid}/layout`, pl);
      localStorage.removeItem(draftKey); Ref.clear('rooms', 'myrooms', 'buildings');
      const nf = await API.get('/floors/' + fid); const vb = fp.vb; init(nf.rooms); fp.vb = vb; fp.applyVB(); fp.dirty = false;
      $('#dirty').textContent = 'Tersimpan ' + fmt.time(new Date()); UI.toast('Denah disimpan');
    } catch (e) { UI.err(e); }
  };
});

// ---------------- Daftar ruang ----------------
route(/^#\/ruang$/, async (view, _, q) => {
  const [rows, cats, blds] = await Promise.all([API.get('/rooms', q).then(r => r.rows), Ref.get('categories'), Ref.get('buildings')]);
  view.innerHTML = App.head('Daftar ruang', `${rows.length} ruang. Ruang dibuat melalui editor denah.`) + `
    <div class="filters"><input type="search" data-f="q" placeholder="Cari kode / nama" value="${esc(q.q || '')}">
      <select data-f="building_id"><option value="">Semua gedung</option>${UI.options(blds.map(b => ({ value: b.id, label: b.name })), q.building_id)}</select>
      <select data-f="category_id"><option value="">Semua kategori</option>${UI.options(cats.map(c => ({ value: c.id, label: c.name })), q.category_id)}</select>${await unitFilter(q.unit_id)}</div>
    <div class="panel">${UI.table({ rows, rowAttr: r => `class="click" data-room="${r.id}"`, columns: [{ label: 'Kode', render: r => `<b class="mono">${esc(r.code)}</b>` }, { label: 'Nama', key: 'name' },
      { label: 'Kategori', render: r => `<i class="dot" style="background:${r.color || '#ccc'}"></i>${esc(r.category_name || '–')}` }, { label: 'Gedung / lantai', render: r => `${esc(r.building_name)} · ${esc(r.floor_name || r.floor_level)}` },
      { label: 'Kapasitas', num: true, render: r => r.capacity }, { label: 'Luas', num: true, render: r => r.area ? fmt.num(r.area, 1) + ' m²' : '–' }, { label: 'Pengelola', render: r => esc(r.owner_unit || '–') }, { label: 'Status', render: r => badge(r.status) }] })}</div>`;
  bindFilters(view, '#/ruang', q);
  view.onclick = e => { const tr = e.target.closest('[data-room]'); if (tr) Pages.roomModal(Number(tr.dataset.room)); };
});
function bindFilters(view, base, q) {
  $$('[data-f]', view).forEach(el => { const ev = el.type === 'search' ? 'change' : 'change'; el.addEventListener(ev, () => setQ(base, { ...q, [el.dataset.f]: el.value })); });
}

Pages.roomModal = async (id) => {
  const r = await API.get('/rooms/' + id);
  const m = UI.modal({ title: `${r.code} — ${r.name}`, wide: true, body: `<div class="grid2"><div><dl class="kv">
      <dt>Gedung</dt><dd>${esc(r.building_name)} · ${esc(r.floor_name || 'Lantai ' + r.floor_level)}</dd><dt>Kategori</dt><dd><i class="dot" style="background:${r.color || '#ccc'}"></i>${esc(r.category_name || '–')}</dd>
      <dt>Kapasitas</dt><dd>${r.capacity} orang</dd><dt>Luas</dt><dd>${r.area ? fmt.num(r.area, 2) + ' m²' : '–'}</dd><dt>Status</dt><dd>${badge(r.status)}</dd>
      <dt>Unit pengelola</dt><dd>${esc(r.owner_unit || 'Belum ditugaskan')}</dd><dt>Fasilitas</dt><dd>${esc(r.facilities || '–')}</dd>
      <dt>Aset</dt><dd><a href="#/aset?room_id=${r.id}">${fmt.num(r.assets.total)} aset · ${fmt.rp(r.assets.value)}</a>${r.assets.broken ? ` <span class="badge bad">${r.assets.broken} rusak</span>` : ''}</dd>
      <dt>Masukan</dt><dd>${r.feedback.total} masukan${r.feedback.rating ? ` · nilai ${r.feedback.rating}/5` : ''}${r.feedback.open ? ` · <span class="badge warn">${r.feedback.open} terbuka</span>` : ''}</dd></dl>
      <div class="btn-row" style="margin-top:16px"><a class="btn sm" href="#/jadwal?room=${r.id}">${I('cal')} Jadwal ruang</a><a class="btn sm" href="#/kerusakan?room_id=${r.id}">${I('wrench')} Riwayat kerusakan</a>
      ${r.can_manage ? `<button class="btn sm" id="rmEdit">Ubah status/fasilitas</button><button class="btn sm" id="rmDmg">Catat kerusakan</button>` : ''}</div></div>
    <div style="text-align:center"><img src="${API.url('/rooms/' + r.id + '/qr.svg')}" alt="QR masukan ruang" style="width:160px;height:160px"><p class="muted" style="font-size:13px">QR pintu ruang: pengguna memindai untuk mengirim masukan.<br><button class="btn sm" id="qrPrint">${I('print')} Cetak poster QR</button></p></div></div>
    <h3 style="margin-top:18px">Catatan kerusakan terakhir</h3>${UI.table({ rows: r.damages.slice(0, 6), empty: 'Tidak ada catatan kerusakan.', columns: [{ label: 'Tanggal', render: d => fmt.date(d.reported_at) }, { label: 'Kerusakan', key: 'title' }, { label: 'Tingkat', render: d => badge(d.severity) }, { label: 'Status', render: d => badge(d.status) }] })}` });
  if (r.can_manage) {
    $('#rmEdit', m.el).onclick = () => UI.formModal({ title: 'Ubah data ruang', values: r, fields: [{ name: 'capacity', label: 'Kapasitas', type: 'number' }, { name: 'status', label: 'Status', type: 'select', empty: false, options: [{ value: 'aktif', label: 'Aktif' }, { value: 'perbaikan', label: 'Perbaikan' }, { value: 'nonaktif', label: 'Nonaktif' }] },
      { name: 'facilities', label: 'Fasilitas', full: true }, { name: 'description', label: 'Keterangan', type: 'textarea' }], onSubmit: async v => { await API.put('/rooms/' + id, v); m.close(); Ref.clear('rooms', 'myrooms'); Pages.roomModal(id); } });
    $('#rmDmg', m.el).onclick = () => { m.close(); Pages.damageForm({ room_id: id }); };
  }
  $('#qrPrint', m.el).onclick = () => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>QR ${esc(r.code)}</title><style>body{font-family:sans-serif;text-align:center;padding:40px}img{width:12cm;height:12cm}h1{font-size:40px;margin:10px 0}p{font-size:20px}</style></head><body>
      <p>${esc(App.me.org.name || '')}</p><h1>${esc(r.code)}</h1><p>${esc(r.name)}</p><img src="${location.origin + API.url('/rooms/' + r.id + '/qr.svg')}"><p>Pindai untuk memberi saran, keluhan, atau laporan kerusakan ruangan ini.</p>
      <script>setTimeout(()=>print(),600)<\/script></body></html>`);
    w.document.close();
  };
};

// ---------------- Peta keterisian ----------------
route(/^#\/peta$/, async (view, _, q) => {
  const blds = await Ref.get('buildings');
  if (!blds.length) { view.innerHTML = App.head('Peta keterisian') + '<div class="empty">Belum ada gedung.</div>'; return; }
  let floorId = q.f ? Number(q.f) : null, floor;
  if (floorId) floor = await API.get('/floors/' + floorId);
  else { const b = await API.get('/buildings/' + (q.b || blds[0].id)); if (!b.floors.length) { view.innerHTML = App.head('Peta keterisian') + '<div class="empty">Gedung ini belum punya lantai.</div>'; return; } floor = await API.get('/floors/' + b.floors[0].id); floorId = floor.id; }
  const cats = await Ref.get('categories');
  const live = !q.at;
  const atVal = q.at ? new Date(q.at) : new Date();
  view.innerHTML = App.head('Peta keterisian', 'Ruang yang sedang terpakai dan yang kosong pada waktu yang dipilih. Klik ruang untuk detail.') + `
    <div class="filters"><select id="bSel">${UI.options(blds.map(b => ({ value: b.id, label: b.name })), floor.building_id)}</select>
      <div class="floor-tabs">${floor.siblings.map(s => `<button data-floor="${s.id}" class="${s.id === floor.id ? 'on' : ''}">${esc(s.name || 'Lantai ' + s.level)}</button>`).join('')}</div>
      <input type="datetime-local" id="at" value="${fmt.local(atVal)}" style="width:auto"><button class="btn sm" id="now">Sekarang</button>
      <span class="muted" id="liveTag" style="font-size:13px">${live ? 'Diperbarui otomatis tiap menit' : ''}</span></div>
    <div class="fp-layout view"><div id="fpHost"></div><aside class="fp-side" id="side"></aside></div>`;
  let fp, occ = {};
  const load = async () => {
    const at = live ? new Date() : atVal;
    const o = await API.get(`/floors/${floorId}/occupancy`, { at: at.toISOString() });
    occ = Object.fromEntries(o.rooms.map(r => [r.room_id, r]));
    const state = r => { const x = occ[r.id] || {}; if (r.status !== 'aktif' || x.open_damages > 0 && r.status === 'perbaikan') return 'repair'; if (!r.bookable) return 'na'; return x.current ? 'busy' : 'free'; };
    const COL = { free: '#BFE3CF', busy: '#EDC27A', repair: '#E7AFA4', na: '#E2E7E5' };
    if (!fp) {
      fp = new FloorPlan($('#fpHost'), { mode: 'view', width: floor.width, height: floor.height, grid: floor.grid, rooms: floor.rooms, categories: cats,
        colorOf: r => COL[state(r)], subOf: r => { const x = occ[r.id] || {}; return x.current ? x.current.title : state(r) === 'free' ? (x.next ? 'Kosong s.d. ' + fmt.time(x.next.start_at) : 'Kosong') : r.name; },
        onSelect: r => side(r) });
    } else fp.render();
    const all = fp.rooms.filter(r => r.bookable); const busy = all.filter(r => state(r) === 'busy').length;
    $('#side').dataset.summary = `${busy} dari ${all.length} ruang terpakai`;
    if (!$('#side').dataset.sel) side(null);
    function side(r) {
      const s = $('#side');
      s.dataset.sel = r ? r.id : '';
      if (!r) {
        s.innerHTML = `<h3>${s.dataset.summary}</h3><p class="muted">${live ? 'Saat ini' : fmt.dt(atVal)}</p>
          <div class="fp-legend" style="margin:12px 0"><span><i class="dot" style="background:${COL.free}"></i>Kosong</span><span><i class="dot" style="background:${COL.busy}"></i>Terpakai</span><span><i class="dot" style="background:${COL.repair}"></i>Perbaikan/nonaktif</span><span><i class="dot" style="background:${COL.na}"></i>Bukan ruang pinjam</span></div>
          <ul class="room-list">${fp.rooms.filter(x => x.bookable).map(x => { const o2 = occ[x.id] || {}; return `<li data-pick="${x.id}"><i class="dot" style="background:${COL[state(x)]}"></i><b class="mono">${esc(x.code)}</b><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o2.current ? o2.current.title : x.name)}</span><small>${o2.today_count || 0} keg.</small></li>`; }).join('')}</ul>`;
        s.onclick = e => { const li = e.target.closest('[data-pick]'); if (li) fp.selectById(Number(li.dataset.pick)); };
        return;
      }
      const o2 = occ[r.id] || {};
      s.innerHTML = `<div class="btn-row" style="justify-content:space-between"><h3>${esc(r.code)}</h3><button class="btn sm ghost" id="back">Semua ruang</button></div><p>${esc(r.name)}</p>
        <dl class="kv" style="margin:10px 0"><dt>Kategori</dt><dd>${esc(r.category_name || '–')}</dd><dt>Kapasitas</dt><dd>${r.capacity}</dd><dt>Pengelola</dt><dd>${esc(r.owner_unit || '–')}</dd>
        <dt>Sekarang</dt><dd>${o2.current ? `<b>${esc(o2.current.title)}</b><br><small>${fmt.time(o2.current.start_at)}–${fmt.time(o2.current.end_at)} · ${esc(o2.current.unit || '')}</small>` : '<span class="badge ok">Kosong</span>'}</dd>
        <dt>Berikutnya</dt><dd>${o2.next ? `${esc(o2.next.title)}<br><small>${fmt.time(o2.next.start_at)}–${fmt.time(o2.next.end_at)}</small>` : '–'}</dd>
        <dt>Hari ini</dt><dd>${o2.today_count || 0} kegiatan</dd>${o2.open_damages ? `<dt>Kerusakan</dt><dd><span class="badge bad">${o2.open_damages} terbuka</span></dd>` : ''}</dl>
        <div class="btn-row"><a class="btn sm primary" href="#/jadwal?room=${r.id}">Jadwal & pinjam</a><button class="btn sm" id="detail">Detail ruang</button></div>`;
      $('#back').onclick = () => { fp.select(-1); side(null); };
      $('#detail').onclick = () => Pages.roomModal(r.id);
    }
  };
  await load();
  if (live) { const t = setInterval(load, 60000); App.cleanup = () => { clearInterval(t); fp && fp.destroy(); }; } else App.cleanup = () => fp && fp.destroy();
  $('#bSel').onchange = e => setQ('#/peta', { b: e.target.value, at: q.at });
  $$('[data-floor]').forEach(b => (b.onclick = () => setQ('#/peta', { f: b.dataset.floor, at: q.at })));
  $('#at').onchange = e => setQ('#/peta', { f: floorId, at: new Date(e.target.value).toISOString() });
  $('#now').onclick = () => setQ('#/peta', { f: floorId });
});

// ---------------- Tabulasi harian ----------------
route(/^#\/tabulasi$/, async (view, _, q) => {
  const date = q.date || fmt.ymd(new Date());
  const [g, cats, blds] = await Promise.all([API.get('/schedule/grid', { ...q, date }), Ref.get('categories'), Ref.get('buildings')]);
  const [h1, m1] = g.operational.start.split(':').map(Number), [h2, m2] = g.operational.end.split(':').map(Number);
  const S = h1 * 60 + m1, E = h2 * 60 + m2, span = E - S;
  const pos = d => { const t = new Date(d), base = new Date(date + 'T00:00:00'); return Math.max(0, Math.min(100, (((t - base) / 60000 - S) / span) * 100)); };
  const byRoom = {}; g.events.forEach(e => (byRoom[e.room_id] = byRoom[e.room_id] || []).push(e));
  const hours = []; for (let m = Math.ceil(S / 60) * 60; m < E; m += 60) hours.push(m);
  const used = g.rooms.filter(r => byRoom[r.id]).length;
  const nowPct = date === fmt.ymd(new Date()) ? ((new Date().getHours() * 60 + new Date().getMinutes() - S) / span) * 100 : -1;
  const d0 = new Date(date + 'T00:00:00');
  view.innerHTML = App.head('Tabulasi penggunaan ruang', `${HARI[d0.getDay()]}, ${fmt.date(date)} · ${used} dari ${g.rooms.length} ruang terpakai`,
    `<a class="btn" href="#/laporan?kind=harian&date=${date}">${I('report')} Laporan harian</a>`) + `
    <div class="filters"><button class="btn sm" data-shift="-1" aria-label="Hari sebelumnya">‹</button><input type="date" data-f="date" value="${date}" style="width:auto"><button class="btn sm" data-shift="1" aria-label="Hari berikutnya">›</button>
      ${await unitFilter(q.unit_id)}<select data-f="building_id"><option value="">Semua gedung</option>${UI.options(blds.map(b => ({ value: b.id, label: b.name })), q.building_id)}</select>
      <select data-f="category_id"><option value="">Semua kategori</option>${UI.options(cats.filter(c => c.bookable).map(c => ({ value: c.id, label: c.name })), q.category_id)}</select></div>
    <div class="tl"><div class="tl-row head"><div class="tl-name"><b>Ruang</b></div><div class="tl-track">${hours.map(m => `<span class="tl-hour" style="left:${((m - S) / span) * 100}%">${pad(m / 60)}.00</span>`).join('')}</div></div>
    ${g.rooms.map(r => `<div class="tl-row"><div class="tl-name"><b class="mono">${esc(r.code)}</b> <small>${esc(r.building_code)} · ${r.capacity}</small><br><small class="muted">${esc(r.owner_unit || '')}</small></div>
      <div class="tl-track" data-room="${r.id}">${hours.map(m => `<span class="tl-hour" style="left:${((m - S) / span) * 100}%"></span>`).join('')}${nowPct >= 0 && nowPct <= 100 ? `<span class="tl-now" style="left:${nowPct}%"></span>` : ''}
      ${(byRoom[r.id] || []).map(e => `<div class="tl-ev ${e.event_type}" data-ev='${esc(JSON.stringify({ ...e, room_code: r.code }))}' style="left:${pos(e.start_at)}%;width:${Math.max(0.6, pos(e.end_at) - pos(e.start_at))}%" title="${esc(`${fmt.time(e.start_at)}–${fmt.time(e.end_at)} ${e.title} (${e.unit_name || ''})`)}">${esc(e.title)}</div>`).join('')}</div></div>`).join('') || '<div class="empty">Tidak ada ruang pada filter ini.</div>'}</div>
    <div class="fp-legend" style="margin-top:10px"><span><i class="dot" style="background:var(--blue)"></i>Kuliah</span><span><i class="dot" style="background:var(--amber)"></i>Rapat/seminar</span><span><i class="dot" style="background:var(--brand)"></i>Lainnya</span><span><i class="dot" style="background:var(--red)"></i>Waktu sekarang</span></div>`;
  bindFilters(view, '#/tabulasi', { ...q, date });
  $$('[data-shift]', view).forEach(b => (b.onclick = () => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + Number(b.dataset.shift)); setQ('#/tabulasi', { ...q, date: fmt.ymd(d) }); }));
  view.onclick = e => {
    const ev = e.target.closest('[data-ev]'); if (ev) return Pages.eventModal(JSON.parse(ev.dataset.ev));
    const tr = e.target.closest('.tl-track[data-room]');
    if (tr) location.hash = `#/jadwal?room=${tr.dataset.room}&week=${date}`;
  };
});

// ---------------- Jadwal ruang (pekan) ----------------
const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x; };
route(/^#\/jadwal$/, async (view, _, q) => {
  const opts = await Ref.roomOpts();
  const roomId = Number(q.room) || (opts[0] && opts[0].value);
  if (!roomId) { view.innerHTML = App.head('Jadwal ruang') + '<div class="empty">Belum ada ruang.</div>'; return; }
  const room = await API.get('/rooms/' + roomId);
  const ws = startOfWeek(q.week ? new Date(q.week + 'T00:00:00') : new Date()), we = new Date(ws); we.setDate(we.getDate() + 7);
  const settings = await API.get('/settings'); const op = settings.operational || { start: '07:00', end: '21:00', days: [1, 2, 3, 4, 5, 6] };
  const h1 = Number(op.start.split(':')[0]), h2 = Math.ceil(Number(op.end.split(':')[0]) + Number(op.end.split(':')[1]) / 60);
  const days = [0, 1, 2, 3, 4, 5, 6].filter(i => op.days.includes(i + 1) || i === 6 && false);
  const evs = await API.get('/events', { room_id: roomId, from: ws.toISOString(), to: we.toISOString() });
  const HR = 44;
  view.innerHTML = App.head(`Jadwal ${room.code}`, `${esc(room.name)} · ${esc(room.building_name)} · kapasitas ${room.capacity} · pengelola ${esc(room.owner_unit || '–')}`,
    room.can_manage ? `<button class="btn primary" id="newEv">${I('plus')} Buat kegiatan</button>` : `<button class="btn primary" id="newBk">${I('swap')} Ajukan peminjaman</button>`) + `
    <div class="filters"><select id="roomSel" style="min-width:260px">${UI.options(opts, roomId)}</select>
      <button class="btn sm" data-wk="-7" aria-label="Pekan sebelumnya">‹</button><b>${fmt.date(ws)} – ${fmt.date(new Date(we - 86400000))}</b><button class="btn sm" data-wk="7" aria-label="Pekan berikutnya">›</button><button class="btn sm" data-wk="0">Pekan ini</button>
      ${room.status !== 'aktif' ? badge(room.status) : ''}</div>
    <div class="week" style="grid-template-columns:54px repeat(${days.length},1fr)">
      <div><div class="week-head">&nbsp;</div>${Array.from({ length: h2 - h1 }, (_, i) => `<div class="week-hr" style="font-size:11px;color:var(--faint);padding:2px 4px;text-align:right">${pad(h1 + i)}.00</div>`).join('')}</div>
      ${days.map(i => { const d = new Date(ws); d.setDate(d.getDate() + i); const ymd = fmt.ymd(d);
        const list = evs.filter(e => fmt.ymd(new Date(e.start_at)) === ymd);
        return `<div class="week-col"><div class="week-head ${ymd === fmt.ymd(new Date()) ? 'today' : ''}">${HARI[d.getDay()]}<br><small>${d.getDate()} ${BULAN[d.getMonth()]}</small></div>
          <div class="week-body">${Array.from({ length: h2 - h1 }, (_, k) => `<div class="week-hr click" data-slot="${ymd}T${pad(h1 + k)}:00"></div>`).join('')}
          ${list.map(e => { const s = new Date(e.start_at), en = new Date(e.end_at); const top = ((s.getHours() - h1) * 60 + s.getMinutes()) / 60 * HR, ht = Math.max(18, (en - s) / 3600000 * HR - 2);
            return `<div class="week-ev ${e.event_type}" data-evi="${e.id}" style="top:${top}px;height:${ht}px"><b>${fmt.time(s)}</b> ${esc(e.title)}<br><small>${esc(e.unit_name || '')}</small></div>`; }).join('')}</div></div>`; }).join('')}
    </div><p class="muted" style="margin-top:8px;font-size:13px">Klik slot kosong untuk ${room.can_manage ? 'membuat kegiatan' : 'mengajukan peminjaman'}.</p>`;
  $('#roomSel').onchange = e => setQ('#/jadwal', { room: e.target.value, week: q.week });
  $$('[data-wk]', view).forEach(b => (b.onclick = () => { const d = b.dataset.wk === '0' ? new Date() : new Date(ws.getTime() + Number(b.dataset.wk) * 86400000); setQ('#/jadwal', { room: roomId, week: fmt.ymd(d) }); }));
  const open = (start) => { const s = new Date(start), e = new Date(s.getTime() + 2 * 3600000); room.can_manage ? Pages.eventForm({ room_id: roomId, start_at: s, end_at: e }) : Pages.bookingForm({ room_id: roomId, start_at: s, end_at: e }, room); };
  const nb = $('#newEv') || $('#newBk'); nb.onclick = () => { const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1); open(s); };
  view.addEventListener('click', e => {
    const ev = e.target.closest('[data-evi]'); if (ev) return Pages.eventModal(evs.find(x => x.id === Number(ev.dataset.evi)), room.can_manage);
    const sl = e.target.closest('[data-slot]'); if (sl) open(sl.dataset.slot);
  });
});

Pages.eventModal = (e, canManage) => {
  const m = UI.modal({ title: e.title, body: `<dl class="kv"><dt>Ruang</dt><dd>${esc(e.room_code || '')} ${esc(e.room_name || '')}</dd><dt>Waktu</dt><dd>${fmt.dt(e.start_at)} – ${fmt.time(e.end_at)}</dd>
    <dt>Jenis</dt><dd>${esc((EVENT_TYPES.find(t => t[0] === e.event_type) || [, e.event_type])[1])}</dd><dt>Penyelenggara</dt><dd>${esc(e.unit_name || '–')}</dd>
    ${e.lecturer_name ? `<dt>Dosen</dt><dd>${esc(e.lecturer_name)}</dd>` : ''}${e.participants ? `<dt>Peserta</dt><dd>${e.participants}</dd>` : ''}${e.description ? `<dt>Keterangan</dt><dd>${esc(e.description)}</dd>` : ''}
    ${e.series_id ? '<dt>Pola</dt><dd>Berulang mingguan</dd>' : ''}</dl>`,
  actions: canManage ? [
    ...(e.series_id ? [{ label: 'Batalkan seri berikutnya', kind: 'danger', onClick: async () => { if (!(await UI.confirm('Batalkan kegiatan ini dan semua pertemuan berikutnya dalam seri?', { danger: true }))) return false; await API.del(`/events/${e.id}?scope=series`); App.render(); } }] : []),
    { label: 'Batalkan', kind: 'danger', onClick: async () => { if (!(await UI.confirm('Batalkan kegiatan ini?', { danger: true }))) return false; await API.del('/events/' + e.id); App.render(); } },
    { label: 'Ubah', kind: 'primary', onClick: () => { setTimeout(() => Pages.eventForm(e), 0); } }] : [{ label: 'Tutup' }] });
  return m;
};
Pages.eventForm = async (v) => {
  const people = await Ref.opts('people', p => p.name + (p.id_number ? ` (${p.id_number})` : ''));
  const edit = !!v.id;
  const fields = [{ name: 'title', label: 'Nama kegiatan', required: true, full: true }, { name: 'event_type', label: 'Jenis', type: 'select', empty: false, options: EVENT_TYPES.map(([a, b]) => ({ value: a, label: b })) },
    { name: 'participants', label: 'Jumlah peserta', type: 'number', min: 0 }, { name: 'start_at', label: 'Mulai', type: 'datetime', required: true }, { name: 'end_at', label: 'Selesai', type: 'datetime', required: true },
    { name: 'lecturer_id', label: 'Dosen (untuk kuliah)', type: 'select', options: people },
    ...(edit ? [{ name: 'room_id', label: 'Pindah ke ruang', type: 'select', empty: false, options: await Ref.roomOpts(!App.isSA()) }, { name: 'attendance', label: 'Realisasi peserta', type: 'number', min: 0 }]
      : [{ name: 'repeat_until', label: 'Ulangi tiap pekan sampai', type: 'date', help: 'Kosongkan untuk kegiatan sekali' }]),
    { name: 'description', label: 'Keterangan', type: 'textarea' }];
  UI.formModal({ title: edit ? 'Ubah kegiatan' : 'Buat kegiatan', fields, values: { event_type: 'rapat', ...v }, onSubmit: async x => {
    if (edit) await API.put('/events/' + v.id, x);
    else { const r = await API.post('/events', { ...x, room_id: v.room_id }); if (r.skipped && r.skipped.length) UI.toast(`${r.created.length} pertemuan dibuat, ${r.skipped.length} dilewati karena bentrok`, true); }
    UI.toast('Kegiatan disimpan'); App.render();
  } });
};
Pages.bookingForm = (v, room) => UI.formModal({
  title: `Ajukan peminjaman ${room ? room.code : ''}`, values: { event_type: 'rapat', ...v },
  extra: room ? `<p class="muted" style="margin-top:12px">Permintaan dikirim ke <b>${esc(room.owner_unit || 'Super Admin')}</b> untuk disetujui. Anda mendapat notifikasi atas keputusannya.</p>` : '',
  fields: [{ name: 'title', label: 'Nama kegiatan', required: true, full: true }, { name: 'event_type', label: 'Jenis', type: 'select', empty: false, options: EVENT_TYPES.map(([a, b]) => ({ value: a, label: b })) },
    { name: 'participants', label: 'Jumlah peserta', type: 'number', min: 1 }, { name: 'start_at', label: 'Mulai', type: 'datetime', required: true }, { name: 'end_at', label: 'Selesai', type: 'datetime', required: true },
    { name: 'repeat_until', label: 'Ulangi tiap pekan sampai', type: 'date', help: 'Mis. perkuliahan satu semester' }, { name: 'purpose', label: 'Keperluan / keterangan', type: 'textarea' }],
  onSubmit: async x => { const b = await API.post('/bookings', { ...x, room_id: v.room_id }); UI.toast(`Permintaan ${b.code} terkirim`); location.hash = '#/peminjaman?tab=outgoing'; },
});

// ---------------- Cari ruang kosong ----------------
route(/^#\/cari-ruang$/, async (view, _, q) => {
  const [cats, blds] = await Promise.all([Ref.get('categories'), Ref.get('buildings')]);
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const v = { start_at: q.start_at || now.toISOString(), end_at: q.end_at || new Date(now.getTime() + 2 * 3600000).toISOString(), capacity: q.capacity, category_id: q.category_id, building_id: q.building_id, repeat_until: q.repeat_until };
  const fields = [{ name: 'start_at', label: 'Mulai', type: 'datetime', required: true }, { name: 'end_at', label: 'Selesai', type: 'datetime', required: true }, { name: 'capacity', label: 'Minimal kapasitas', type: 'number', min: 0 },
    { name: 'category_id', label: 'Kategori', type: 'select', empty: 'Semua kategori', options: cats.filter(c => c.bookable).map(c => ({ value: c.id, label: c.name })) },
    { name: 'building_id', label: 'Gedung', type: 'select', empty: 'Semua gedung', options: blds.map(b => ({ value: b.id, label: b.name })) }, { name: 'repeat_until', label: 'Berulang tiap pekan sampai', type: 'date' }];
  view.innerHTML = App.head('Cari ruang kosong', 'Temukan ruang yang bebas di seluruh unit. Ruang unit lain dapat dipinjam dengan persetujuan unit pengelolanya.') +
    `<div class="panel panel-body" style="margin-bottom:18px">${UI.form(fields, v)}<div class="btn-row" style="margin-top:14px"><button class="btn primary" id="go">${I('search')} Cari</button></div></div><div id="res"></div>`;
  const run = async () => {
    let x; try { x = UI.read(view, fields); } catch (e) { return UI.err(e); }
    const rows = await API.get('/availability', x).catch(UI.err); if (!rows) return;
    $('#res').innerHTML = `<div class="panel"><div class="panel-head"><h3>${rows.length} ruang tersedia</h3><span class="muted">${fmt.dt(x.start_at)} – ${fmt.time(x.end_at)}${x.repeat_until ? ', tiap pekan s.d. ' + fmt.date(x.repeat_until) : ''}</span></div>
      ${UI.table({ rows, empty: 'Tidak ada ruang kosong yang memenuhi kriteria.', columns: [{ label: 'Ruang', render: r => `<b class="mono">${esc(r.code)}</b> ${esc(r.name)}` }, { label: 'Gedung', render: r => `${esc(r.building_name)} · ${esc(r.floor_name || '')}` },
        { label: 'Kategori', render: r => `<i class="dot" style="background:${r.color}"></i>${esc(r.category_name)}` }, { label: 'Kapasitas', num: true, render: r => r.capacity }, { label: 'Pengelola', render: r => esc(r.owner_unit || '–') + (r.mine ? ' <span class="badge ok">unit Anda</span>' : '') },
        { label: '', render: r => `<button class="btn sm ${r.mine ? 'primary' : ''}" data-pick="${r.id}">${r.mine ? 'Buat kegiatan' : 'Ajukan pinjam'}</button>` }] })}</div>`;
    $('#res').onclick = e => { const b = e.target.closest('[data-pick]'); if (!b) return; const r = rows.find(z => z.id === Number(b.dataset.pick));
      const base = { room_id: r.id, start_at: x.start_at, end_at: x.end_at, repeat_until: x.repeat_until, participants: x.capacity };
      r.mine && App.canWrite() ? Pages.eventForm(base) : Pages.bookingForm(base, r); };
  };
  $('#go').onclick = run; if (q.start_at) run();
});

// ---------------- Peminjaman ----------------
route(/^#\/peminjaman$/, async (view, _, q) => {
  const tab = q.tab || 'incoming';
  view.innerHTML = App.head('Peminjaman ruang antar unit', 'Permintaan untuk ruang yang dikelola unit Anda perlu persetujuan sebelum menjadi jadwal.', `<a class="btn primary" href="#/cari-ruang">${I('search')} Cari & pinjam ruang</a>`) +
    `<div class="tabs" id="tabs"></div><div class="filters"><select data-f="status"><option value="">Semua status</option>${UI.options(['pending', 'approved', 'rejected', 'cancelled'].map(s => ({ value: s, label: STATUS[s][0] })), q.status)}</select></div><div class="panel" id="list"></div>`;
  UI.tabs($('#tabs'), [['incoming', App.isSA() ? 'Semua permintaan masuk' : 'Masuk ke unit saya'], ['outgoing', 'Diajukan unit saya'], ...(App.isSA() || App.me.role === 'pimpinan' ? [] : [['all', 'Semua terkait unit saya']])], tab, t => setQ('#/peminjaman', { ...q, tab: t }));
  bindFilters(view, '#/peminjaman', q);
  const rows = await API.get('/bookings', { box: tab, status: q.status });
  $('#list').innerHTML = UI.table({ rows, empty: tab === 'incoming' ? 'Tidak ada permintaan masuk.' : 'Belum ada pengajuan.', columns: [
    { label: 'No.', render: b => `<span class="mono">${esc(b.code)}</span>` }, { label: 'Kegiatan', render: b => `<b>${esc(b.title)}</b><br><small>${esc(b.purpose || '')}</small>` },
    { label: 'Ruang', render: b => `${esc(b.room_code)}<br><small>${esc(b.building_name)}</small>` },
    { label: 'Waktu', render: b => `${fmt.dt(b.start_at)}–${fmt.time(b.end_at)}${b.repeat_until ? `<br><small>tiap pekan s.d. ${fmt.date(b.repeat_until)}</small>` : ''}` },
    { label: tab === 'incoming' ? 'Peminjam' : 'Pengelola', render: b => esc(tab === 'incoming' ? `${b.requester_unit || ''} (${b.requester_name || ''})` : b.owner_unit || 'Super Admin') },
    { label: 'Status', render: b => badge(b.status) + (b.decision_note ? `<br><small>${esc(b.decision_note)}</small>` : '') },
    { label: '', render: b => `<div class="btn-row" style="justify-content:flex-end">${b.status === 'pending' && (App.isSA() || b.owner_unit_id === App.me.unit_id) ? `<button class="btn sm primary" data-ok="${b.id}">Setujui</button><button class="btn sm danger" data-no="${b.id}">Tolak</button>` : ''}
      ${['pending', 'approved'].includes(b.status) && (b.requester_unit_id === App.me.unit_id || App.isSA()) ? `<button class="btn sm" data-cancel="${b.id}">Batalkan</button>` : ''}</div>` }] });
  $('#list').onclick = async e => {
    const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]'), c = e.target.closest('[data-cancel]');
    if (ok) UI.formModal({ title: 'Setujui peminjaman', submit: 'Setujui', fields: [{ name: 'note', label: 'Catatan untuk peminjam', type: 'textarea' }], onSubmit: async v => { const r = await API.post(`/bookings/${ok.dataset.ok}/approve`, v); UI.toast(`Disetujui. ${r.created.length} jadwal dibuat${r.skipped.length ? `, ${r.skipped.length} dilewati karena bentrok` : ''}`); App.refreshBadge(); App.render(); } });
    if (no) UI.formModal({ title: 'Tolak peminjaman', submit: 'Tolak', fields: [{ name: 'note', label: 'Alasan penolakan', type: 'textarea', required: true }], onSubmit: async v => { await API.post(`/bookings/${no.dataset.no}/reject`, v); App.refreshBadge(); App.render(); } });
    if (c && await UI.confirm('Batalkan peminjaman ini? Jadwal yang akan datang ikut dibatalkan.', { danger: true })) { await API.post(`/bookings/${c.dataset.cancel}/cancel`).catch(UI.err); App.render(); }
  };
});

// ---------------- Kerusakan ruang ----------------
Pages.damageForm = async (v = {}) => {
  const rooms = await Ref.roomOpts(!App.isSA());
  UI.formModal({ title: v.id ? 'Perbarui catatan kerusakan' : 'Catat kerusakan ruang', values: { severity: 'sedang', ...v },
    fields: [...(v.id ? [] : [{ name: 'room_id', label: 'Ruang', type: 'select', required: true, options: rooms, full: true }]), { name: 'title', label: 'Kerusakan', required: true, full: true, placeholder: 'mis. AC tidak dingin, plafon bocor' },
      { name: 'severity', label: 'Tingkat', type: 'select', empty: false, options: [['ringan', 'Ringan'], ['sedang', 'Sedang'], ['berat', 'Berat']].map(([a, b]) => ({ value: a, label: b })) },
      ...(v.id ? [{ name: 'status', label: 'Status', type: 'select', empty: false, options: ['dilaporkan', 'diproses', 'selesai', 'ditolak'].map(s => ({ value: s, label: STATUS[s][0] })) }, { name: 'actual_cost', label: 'Biaya perbaikan (Rp)', type: 'money' }] : [{ name: 'set_room_status', label: 'Tandai ruang sedang perbaikan', type: 'checkbox' }]),
      { name: 'estimated_cost', label: 'Perkiraan biaya (Rp)', type: 'money' }, { name: 'description', label: 'Uraian', type: 'textarea' }, ...(v.id ? [{ name: 'resolution', label: 'Tindak lanjut / hasil', type: 'textarea' }] : [])],
    onSubmit: async x => { v.id ? await API.put('/damages/' + v.id, x) : await API.post('/damages', x); UI.toast('Catatan kerusakan disimpan'); if (location.hash.startsWith('#/kerusakan')) App.render(); } });
};
route(/^#\/kerusakan$/, async (view, _, q) => {
  const rows = await API.get('/damages', { status: q.status, room_id: q.room_id, open: q.status ? '' : q.all ? '' : '1' });
  view.innerHTML = App.head('Catatan kerusakan ruang', 'Dari laporan internal, kondisi aset rusak, dan masukan publik.', App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Catat kerusakan</button>` : '') + `
    <div class="filters"><select data-f="status"><option value="">${q.all ? 'Semua status' : 'Masih terbuka'}</option>${UI.options(['dilaporkan', 'diproses', 'selesai', 'ditolak'].map(s => ({ value: s, label: STATUS[s][0] })), q.status)}</select>
      <label class="check"><input type="checkbox" id="all" ${q.all ? 'checked' : ''}> Tampilkan yang sudah selesai</label></div>
    <div class="panel">${UI.table({ rows, empty: 'Tidak ada kerusakan terbuka.', rowAttr: d => `class="click" data-d="${d.id}"`, columns: [{ label: 'Dilaporkan', render: d => fmt.date(d.reported_at) },
      { label: 'Ruang', render: d => `<b class="mono">${esc(d.room_code)}</b><br><small>${esc(d.building_name)}</small>` }, { label: 'Kerusakan', render: d => `<b>${esc(d.title)}</b>${d.asset_tag ? `<br><small class="mono">${esc(d.asset_tag)}</small>` : ''}${d.ticket ? `<br><small>dari tiket ${esc(d.ticket)}</small>` : ''}` },
      { label: 'Tingkat', render: d => badge(d.severity) }, { label: 'Status', render: d => badge(d.status) }, { label: 'Biaya', num: true, render: d => d.actual_cost ? fmt.rp(d.actual_cost) : d.estimated_cost ? `<small>±${fmt.rp(d.estimated_cost)}</small>` : '–' },
      { label: 'Unit', render: d => esc(d.unit_name || '–') }] })}</div>`;
  bindFilters(view, '#/kerusakan', q);
  $('#all').onchange = e => setQ('#/kerusakan', { ...q, all: e.target.checked ? 1 : '' });
  const add = $('#add'); if (add) add.onclick = () => Pages.damageForm(q.room_id ? { room_id: q.room_id } : {});
  view.onclick = e => { const tr = e.target.closest('[data-d]'); if (tr && App.canWrite()) Pages.damageForm(rows.find(d => d.id === Number(tr.dataset.d))); };
});

// ---------------- Masukan publik ----------------
route(/^#\/masukan$/, async (view, _, q) => {
  const rows = await API.get('/feedback', q);
  const KIND = { saran: ['Saran', 'info'], keluhan: ['Keluhan', 'warn'], kerusakan: ['Kerusakan', 'bad'], apresiasi: ['Apresiasi', 'ok'] };
  view.innerHTML = App.head('Masukan & saran ruangan', 'Masukan dari mahasiswa dan pengguna umum melalui portal publik atau QR di pintu ruang.', `<a class="btn" href="${API.base}/portal.html" target="_blank">${I('ext')} Buka portal</a>`) + `
    <div class="filters"><select data-f="status"><option value="">Semua status</option>${UI.options(['baru', 'diproses', 'selesai', 'ditolak'].map(s => ({ value: s, label: STATUS[s][0] })), q.status)}</select>
      <select data-f="kind"><option value="">Semua jenis</option>${UI.options(Object.entries(KIND).map(([k, v]) => ({ value: k, label: v[0] })), q.kind)}</select>
      <input type="date" data-f="from" value="${esc(q.from || '')}" style="width:auto" aria-label="Dari tanggal"><input type="date" data-f="to" value="${esc(q.to || '')}" style="width:auto" aria-label="Sampai tanggal"></div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada masukan.', rowAttr: f => `class="click" data-fb="${f.id}"`, columns: [{ label: 'Tiket', render: f => `<span class="mono">${esc(f.ticket)}</span><br><small>${fmt.rel(f.created_at)}</small>` },
      { label: 'Ruang', render: f => `<b class="mono">${esc(f.room_code)}</b><br><small>${esc(f.building_name)}</small>` }, { label: 'Jenis', render: f => badge(f.kind, KIND) + (f.rating ? `<br><small>${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</small>` : '') },
      { label: 'Isi', render: f => `<div style="max-width:52ch">${esc(f.message.length > 180 ? f.message.slice(0, 180) + '…' : f.message)}</div>${f.photo_file_id ? '<small>📎 foto</small>' : ''}` },
      { label: 'Pengirim', render: f => esc(f.reporter_name || 'Anonim') + (f.reporter_nim ? `<br><small>${esc(f.reporter_nim)}</small>` : '') }, { label: 'Status', render: f => badge(f.status) }] })}</div>`;
  bindFilters(view, '#/masukan', q);
  view.onclick = e => {
    const tr = e.target.closest('[data-fb]'); if (!tr) return;
    const f = rows.find(x => x.id === Number(tr.dataset.fb));
    const m = UI.formModal({ title: `Masukan ${f.ticket}`, wide: true, values: f,
      fields: [{ html: `<dl class="kv"><dt>Ruang</dt><dd>${esc(f.room_code)} — ${esc(f.room_name)} (${esc(f.building_name)})</dd><dt>Jenis</dt><dd>${badge(f.kind, KIND)} ${f.rating ? `· nilai ${f.rating}/5` : ''}</dd>
          <dt>Pengirim</dt><dd>${esc(f.reporter_name || 'Anonim')} ${esc(f.reporter_nim || '')} ${esc(f.reporter_email || '')}</dd><dt>Dikirim</dt><dd>${fmt.dt(f.created_at)}</dd></dl>
          <p style="margin-top:12px;white-space:pre-wrap;background:var(--sunk);padding:12px;border-radius:6px">${esc(f.message)}</p>${f.photo_file_id ? `<img src="${API.file(f.photo_file_id)}" alt="Foto lampiran" style="max-width:100%;max-height:320px;border-radius:6px">` : ''}
          ${f.damage_id ? '<p class="badge info">Sudah dicatat sebagai kerusakan</p>' : App.canWrite() ? '<p><button class="btn sm" id="toDmg">' + I('wrench') + ' Jadikan catatan kerusakan</button></p>' : ''}` },
        { name: 'status', label: 'Status', type: 'select', empty: false, options: ['baru', 'diproses', 'selesai', 'ditolak'].map(s => ({ value: s, label: STATUS[s][0] })) },
        { name: 'response', label: 'Tanggapan (terlihat oleh pengirim lewat nomor tiket)', type: 'textarea' }],
      submit: 'Simpan tanggapan', onSubmit: async v => { await API.put('/feedback/' + f.id, v); App.render(); } });
    const td = $('#toDmg', m.el); if (td) td.onclick = () => UI.formModal({ title: 'Jadikan catatan kerusakan', values: { title: f.message.slice(0, 80), severity: 'sedang' },
      fields: [{ name: 'title', label: 'Judul kerusakan', required: true, full: true }, { name: 'severity', label: 'Tingkat', type: 'select', empty: false, options: [['ringan', 'Ringan'], ['sedang', 'Sedang'], ['berat', 'Berat']].map(([a, b]) => ({ value: a, label: b })) }],
      onSubmit: async v => { await API.post(`/feedback/${f.id}/damage`, v); m.close(); UI.toast('Dicatat sebagai kerusakan'); App.render(); } });
  };
});
