/* ===== Peta kampus 2D/3D: tempatkan gedung di lokasi nyata, lantai, dinding berwarna ===== */
(function () {
  const G = window.MapGeo, LIB = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const DEFAULT_CENTER = [106.7840, -6.5640];   // titik awal bila belum ada gedung yang ditempatkan; geser lalu simpan
  const loadLib = () => window.maplibregl ? Promise.resolve() : new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = LIB; s.onload = ok;
    s.onerror = () => no(new Error('Pustaka peta (MapLibre) tidak dapat dimuat dari internet. Periksa koneksi lalu muat ulang halaman.')); document.head.appendChild(s);
  });
  const styleFor = base => ({
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap, © CARTO',
      },
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Citra © Esri' },
    },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E6ECE7' } },
      { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: base === 'osm' ? 'visible' : 'none' } },
      { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: base === 'sat' ? 'visible' : 'none' } }],
  });
  const FC = f => ({ type: 'FeatureCollection', features: f });

  let active = null;                        // peta yang sedang tampil (dibersihkan saat pindah halaman)

  route(/^#\/peta-kampus$/, async (view, _, q) => {
    if (active) { try { active.remove(); } catch (e) { /* abaikan */ } active = null; }
    const sa = App.isSA();
    view.innerHTML = App.head('Peta kampus', 'Posisi gedung di lokasi nyata, tampilan 2D atau 3D sesuai jumlah dan tinggi lantai') + '<div class="empty">Memuat peta…</div>';
    let blds;
    try { [blds] = await Promise.all([API.get('/map/buildings').then(r => r.rows), loadLib()]); } catch (e) { view.innerHTML = App.head('Peta kampus') + `<div class="empty">${esc(e.message)}</div>`; return; }
    const st = { sel: q.b ? Number(q.b) : null, mode: '3d', base: 'osm', upTo: 999, edit: false, dirty: false };
    const get = id => blds.find(b => b.id === id), cur = () => get(st.sel);
    const maxLevel = Math.max(1, ...blds.flatMap(b => b.floors.map(f => f.level)));

    view.innerHTML = App.head('Peta kampus', 'Posisi gedung di lokasi nyata, tampilan 2D atau 3D sesuai jumlah dan tinggi lantai') + `
      <div class="mapx">
        <div class="mapx-main">
          <div class="mapx-bar">
            <div class="seg" id="segMode"><button data-m="2d">2D</button><button data-m="3d" class="on">3D</button></div>
            <div class="seg" id="segBase"><button data-b="osm" class="on">Peta</button><button data-b="sat">Satelit</button><button data-b="none">Polos</button></div>
            <label class="inl">Tampilkan s.d. lantai <select id="upTo"><option value="999">Semua</option>${Array.from({ length: maxLevel }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label>
            <button class="btn sm" id="north" title="Hadapkan ke utara">${I('map')} Utara</button>
          </div>
          <div id="cmap" class="cmap" role="application" aria-label="Peta kampus"></div>
          <div class="mapx-note muted" id="mnote"></div>
        </div>
        <aside class="mapx-side">
          <div class="panel"><div class="panel-head"><h3>Gedung</h3></div><div class="mapx-list" id="blist"></div></div>
          <div class="panel" id="detail"></div>
        </aside>
      </div>`;

    const map = new maplibregl.Map({ container: 'cmap', style: styleFor('osm'), center: DEFAULT_CENTER, zoom: 17, pitch: 55, bearing: -20, maxPitch: 75, attributionControl: { compact: true } });
    active = map; map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right'); map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const markers = new Map();

    const flatFeatures = c => {                                  // tampak 2D: satu poligon per gedung berwarna dinding lantai teratas
      const top = new Map(); c.solids.features.forEach(f => { if (f.properties.kind === 'floor') top.set(f.properties.bid, f); });
      return [...top.values()].map(f => ({ ...f, properties: { ...f.properties, color: f.properties.color } }));
    };
    function refresh() {
      const c = G.collection(blds, { upTo: st.upTo });
      if (!map.getSource('solids')) return;
      map.getSource('solids').setData(c.solids); map.getSource('flat').setData(FC(flatFeatures(c))); map.getSource('outlines').setData(c.outlines);
      map.setFilter('campus-sel', ['==', ['get', 'bid'], st.sel || -1]);
      blds.forEach(b => {
        let m = markers.get(b.id);
        if (!G.isPlaced(b)) { if (m) { m.remove(); markers.delete(b.id); } return; }
        if (!m) { const el = document.createElement('div'); el.className = 'map-label'; el.textContent = b.code; el.onclick = ev => { ev.stopPropagation(); select(b.id, false); }; m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([b.longitude, b.latitude]).addTo(map); markers.set(b.id, m); }
        m.setLngLat([b.longitude, b.latitude]).getElement().classList.toggle('on', b.id === st.sel);
        m.setOffset([0, -Math.min(60, G.totalHeight(b) * (st.mode === '3d' ? 1.4 : 0))]);
      });
    }
    function applyMode() {
      const d3 = st.mode === '3d';
      if (map.getLayer('campus-3d')) { map.setLayoutProperty('campus-3d', 'visibility', d3 ? 'visible' : 'none'); map.setLayoutProperty('campus-flat', 'visibility', d3 ? 'none' : 'visible'); }
      map.easeTo({ pitch: d3 ? 55 : 0, duration: 600 });
      $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode)); refresh();
    }
    function applyBase() {
      ['osm', 'sat'].forEach(id => map.setLayoutProperty(id, 'visibility', st.base === id ? 'visible' : 'none'));
      $$('#segBase button').forEach(b => b.classList.toggle('on', b.dataset.b === st.base));
    }
    function fit() {
      const pl = blds.filter(G.isPlaced); if (!pl.length) return;
      const bb = new maplibregl.LngLatBounds(); pl.forEach(b => bb.extend([b.longitude, b.latitude])); map.fitBounds(bb, { padding: 80, maxZoom: 18.5, duration: 700 });
    }
    const note = () => { const n = blds.filter(b => !G.isPlaced(b)).length; $('#mnote').innerHTML = n ? `${n} gedung belum ditempatkan di peta.${sa ? ' Pilih gedung di daftar lalu klik <b>Tempatkan di peta</b>.' : ''}` : 'Semua gedung sudah ditempatkan.'; };

    function list() {
      $('#blist').innerHTML = blds.map(b => `<button class="mapx-item ${b.id === st.sel ? 'on' : ''}" data-id="${b.id}"><i class="sw" style="background:${esc(b.wall_color || G.DEF_WALL)}"></i><span><b>${esc(b.code)}</b> ${esc(b.name)}<small>${b.floors.filter(f => f.level >= 1).length || 1} lantai · ${fmt.num(G.totalHeight(b))} m${G.isPlaced(b) ? '' : ' · belum ditempatkan'}</small></span></button>`).join('') || '<div class="empty">Belum ada gedung.</div>';
    }
    function detail() {
      const b = cur(), el = $('#detail');
      if (!b) { el.innerHTML = '<div class="panel-body muted">Klik gedung di peta atau di daftar untuk melihat detail.</div>'; return; }
      const stk = G.stack(b), fl = b.floors.filter(f => f.level >= 1);
      el.innerHTML = `<div class="panel-head"><h3>${esc(b.name)}</h3><div class="actions"><a class="btn sm" href="#/gedung/${b.id}">Buka gedung</a></div></div><div class="panel-body">
        <dl class="kv"><dt>Kode</dt><dd class="mono">${esc(b.code)}</dd><dt>Lantai</dt><dd>${stk.length}</dd><dt>Tinggi total</dt><dd>${fmt.num(G.totalHeight(b))} m</dd>
        <dt>Tapak</dt><dd>${fmt.num(G.area(b.footprint))} m² <span class="muted">(${{ manual: 'diatur manual', denah: 'dari denah', perkiraan: 'perkiraan' }[b.footprint_source]})</span></dd>
        <dt>Koordinat</dt><dd>${G.isPlaced(b) ? `${b.latitude.toFixed(6)}, ${b.longitude.toFixed(6)}` : '<span class="muted">belum ditempatkan</span>'}</dd></dl>
        <div class="mapx-floors">${stk.slice().reverse().map(f => `<div><i class="sw" style="background:${f.color}"></i>${esc(f.name || 'Lantai ' + f.level)}<span class="muted">${fmt.num(f.height)} m · ${fmt.num(f.base)}–${fmt.num(f.top)} m</span></div>`).join('')}</div>
        ${fl.length ? '' : '<p class="muted">Belum ada lantai; ditampilkan 1 lantai bawaan (4 m).</p>'}
        ${sa ? editForm(b) : ''}</div>`;
      if (sa) bindEdit(b);
    }
    const editForm = b => `<hr><h4 style="margin:0 0 8px">Atur di peta</h4>
      <div class="btn-row"><button class="btn sm ${G.isPlaced(b) ? '' : 'primary'}" id="eHere">${G.isPlaced(b) ? 'Pindah ke tengah layar' : 'Tempatkan di peta'}</button>${G.isPlaced(b) ? `<button class="btn sm ${st.edit ? 'primary' : ''}" id="eDrag">${st.edit ? 'Selesai geser' : 'Geser / klik peta'}</button>` : ''}</div>
      ${G.isPlaced(b) ? `<p class="help" style="margin:6px 0">${st.edit ? 'Seret gedung atau klik titik di peta untuk memindahkan.' : ''}</p>
      <label class="field"><span>Putaran: <b id="rotV">${Math.round(b.map_rotation)}</b>°</span><input type="range" id="eRot" min="0" max="359" value="${Math.round(b.map_rotation)}"></label>` : ''}
      <div class="form-grid" style="margin-top:8px"><label class="field"><span>Warna dinding</span><input type="color" id="eWall" value="${esc(G.HEX.test(b.wall_color) ? b.wall_color : G.DEF_WALL)}"></label>
        <label class="field"><span>Warna atap</span><input type="color" id="eRoof" value="${esc(G.HEX.test(b.roof_color || '') ? b.roof_color : G.shade(G.stack(b).slice(-1)[0]?.color || G.DEF_WALL, -0.3))}"></label>
        <label class="check full"><input type="checkbox" id="eRoofAuto" ${G.HEX.test(b.roof_color || '') ? '' : 'checked'}> Warna atap otomatis (lebih gelap dari dinding)</label></div>
      <p class="help">Dinding menyelimuti seluruh lantai. Warna khusus per lantai diatur di halaman gedung → ubah lantai.</p>
      <div class="btn-row" style="margin-top:8px"><button class="btn sm" id="eShape">Bentuk tapak…</button><button class="btn sm" id="eDen">Ambil dari denah</button></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="eSave" ${st.dirty ? '' : 'disabled'}>Simpan perubahan</button></div>`;

    function mark() { st.dirty = true; const s = $('#eSave'); if (s) s.disabled = false; list(); refresh(); }
    function bindEdit(b) {
      const here = $('#eHere'); if (here) here.onclick = () => { const c = map.getCenter(); b.longitude = c.lng; b.latitude = c.lat; mark(); detail(); };
      const drag = $('#eDrag'); if (drag) drag.onclick = () => { st.edit = !st.edit; map.getCanvas().style.cursor = st.edit ? 'move' : ''; detail(); };
      const rot = $('#eRot'); if (rot) rot.oninput = () => { b.map_rotation = Number(rot.value); $('#rotV').textContent = rot.value; mark(); };
      $('#eWall').oninput = e => { b.wall_color = e.target.value; mark(); };
      const roof = () => { b.roof_color = $('#eRoofAuto').checked ? null : $('#eRoof').value; mark(); };
      $('#eRoof').oninput = () => { $('#eRoofAuto').checked = false; roof(); }; $('#eRoofAuto').onchange = roof;
      $('#eShape').onclick = () => UI.formModal({ title: 'Bentuk tapak gedung', fields: [
        { name: 'w', label: 'Lebar (m, timur–barat)', type: 'number', min: 3, step: '0.5', required: true }, { name: 'd', label: 'Panjang (m, utara–selatan)', type: 'number', min: 3, step: '0.5', required: true }],
      values: (() => { const xs = b.footprint.map(p => p[0]), ys = b.footprint.map(p => p[1]); return { w: G.round(Math.max(...xs) - Math.min(...xs)), d: G.round(Math.max(...ys) - Math.min(...ys)) }; })(),
      extra: '<p class="help">Membuat tapak persegi panjang. Untuk bentuk mengikuti denah, gunakan “Ambil dari denah”.</p>',
      onSubmit: async (v, m) => { b.footprint = G.rect(v.w, v.d); b.footprint_source = 'manual'; m.close(); mark(); detail(); } });
      $('#eDen').onclick = async () => { try { const r = await API.post(`/buildings/${b.id}/map/reset-footprint`, {}); b.footprint = r.footprint; b.footprint_source = r.footprint_source; refresh(); detail(); UI.toast?.(r.footprint_source === 'denah' ? 'Tapak diambil dari denah lantai' : 'Denah belum digambar; memakai perkiraan dari luas bangunan'); } catch (e) { UI.err(e); } };
      $('#eSave').onclick = async () => {
        if (!G.isPlaced(b)) return UI.err(new Error('Tempatkan gedung di peta terlebih dahulu'));
        try { await API.put(`/buildings/${b.id}/map`, { latitude: b.latitude, longitude: b.longitude, map_rotation: b.map_rotation, map_footprint: b.footprint, wall_color: b.wall_color, roof_color: b.roof_color });
          st.dirty = false; Ref.clear('buildings'); UI.toast?.('Posisi dan warna gedung disimpan'); detail(); note(); } catch (e) { UI.err(e); }
      };
    }
    function select(id, fly) {
      if (st.dirty && id !== st.sel && !confirm('Ada perubahan yang belum disimpan. Buang perubahan?')) return;
      if (st.dirty && id !== st.sel) { API.get('/map/buildings').then(r => { blds.splice(0, blds.length, ...r.rows); st.dirty = false; refresh(); list(); }); }
      st.sel = id; st.edit = false; map.getCanvas().style.cursor = ''; list(); detail(); refresh();
      const b = cur(); if (fly && b && G.isPlaced(b)) map.flyTo({ center: [b.longitude, b.latitude], zoom: Math.max(map.getZoom(), 18), duration: 700 });
    }

    map.on('load', () => {
      map.addSource('solids', { type: 'geojson', data: FC([]) }); map.addSource('flat', { type: 'geojson', data: FC([]) }); map.addSource('outlines', { type: 'geojson', data: FC([]) });
      map.addLayer({ id: 'campus-flat', type: 'fill', source: 'flat', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.92 } });
      map.addLayer({ id: 'campus-3d', type: 'fill-extrusion', source: 'solids', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } });
      map.addLayer({ id: 'campus-line', type: 'line', source: 'outlines', paint: { 'line-color': '#3b3b3b', 'line-width': 1 } });
      map.addLayer({ id: 'campus-sel', type: 'line', source: 'outlines', filter: ['==', ['get', 'bid'], -1], paint: { 'line-color': '#146B4E', 'line-width': 3.5 } });
      refresh(); applyMode(); fit();
      if (!blds.some(G.isPlaced)) { map.jumpTo({ center: DEFAULT_CENTER, zoom: 16.5 }); }
      if (st.sel) select(st.sel, true);
    });
    const pick = e => { const f = map.queryRenderedFeatures(e.point, { layers: ['campus-3d', 'campus-flat'] })[0]; return f && f.properties.bid; };
    let drag = null;
    map.on('mousedown', e => { if (!st.edit || !cur()) return; if (pick(e) !== st.sel) return; e.preventDefault(); drag = { dx: cur().longitude - e.lngLat.lng, dy: cur().latitude - e.lngLat.lat }; map.dragPan.disable(); });
    map.on('mousemove', e => { if (!drag) return; const b = cur(); b.longitude = e.lngLat.lng + drag.dx; b.latitude = e.lngLat.lat + drag.dy; mark(); });
    const endDrag = () => { if (drag) { drag = null; map.dragPan.enable(); detail(); } };
    map.on('mouseup', endDrag); map.getCanvas().addEventListener('mouseleave', endDrag);
    map.on('click', e => {
      const id = pick(e);
      if (st.edit && cur() && !drag) { if (id !== st.sel) { const b = cur(); b.longitude = e.lngLat.lng; b.latitude = e.lngLat.lat; mark(); detail(); } return; }
      if (id) select(id, false); else if (!st.edit) { /* klik kosong: biarkan pilihan */ }
    });
    map.on('error', e => { if (e && e.error && /tile|Failed to fetch|NetworkError/i.test(String(e.error.message || e.error))) $('#mnote').innerHTML = 'Ubin peta tidak dapat dimuat (periksa internet). Gedung tetap tampil di atas latar polos; pilih “Polos” bila perlu.'; });

    $('#blist').onclick = e => { const b = e.target.closest('[data-id]'); if (b) select(Number(b.dataset.id), true); };
    $('#segMode').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { st.mode = b.dataset.m; applyMode(); } };
    $('#segBase').onclick = e => { const b = e.target.closest('[data-b]'); if (b) { st.base = b.dataset.b; applyBase(); } };
    $('#upTo').onchange = e => { st.upTo = Number(e.target.value); refresh(); };
    $('#north').onclick = () => map.easeTo({ bearing: 0, duration: 500 });
    window.addEventListener('beforeunload', e => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } }, { once: true });
    list(); detail(); note();
    window.__campus = { map, blds, st };   // untuk pengujian
  });
})();
