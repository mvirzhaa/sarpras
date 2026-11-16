// Uji UI Peta kampus di Chromium dengan server & pustaka peta TIRUAN (tanpa DB/internet): node test/map-ui.test.js
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright'), G = require('../public/js/mapgeo.js');
const PUB = path.join(__dirname, '../public'); let fail = 0; const ok = (n, c, x) => { if (!c) { fail++; console.log('GAGAL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };
const fl = (id, lv, h = 4, c = null) => ({ id, level: lv, name: 'Lantai ' + lv, floor_height: h, wall_color: c, room_total: 0, area_total: 0, width: 60, height: 30 });
const B = [
  { id: 1, code: 'GKB-A', name: 'Gedung A', latitude: -6.56, longitude: 106.78, map_rotation: 0, wall_color: '#C9B79C', roof_color: null, footprint: G.rect(30, 12), footprint_source: 'manual', floors: [fl(11, 1), fl(12, 2), fl(13, 3, 5, '#ff0000')], floors_count: 3 },
  { id: 2, code: 'LAB', name: 'Laboratorium', latitude: null, longitude: null, map_rotation: 0, wall_color: '#C9B79C', roof_color: null, footprint: G.rect(24, 12), footprint_source: 'perkiraan', floors: [fl(21, 1), fl(22, 2)], floors_count: 2 },
];
const calls = [];
const json = (res, o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', d => body += d); req.on('end', () => {
    if (u.pathname.startsWith('/api/')) {
      const b = body ? JSON.parse(body) : null; if (req.method !== 'GET') calls.push([req.method, u.pathname, b]);
      if (u.pathname === '/api/auth/me') return json(res, { id: 1, name: 'SA', role: 'superadmin', unread: 0, org: { short: 'UIKA', name: 'UIKA' } });
      if (u.pathname === '/api/map/buildings') return json(res, { rows: B });
      if (u.pathname === '/api/buildings' && req.method === 'GET') return json(res, { rows: B.map(x => ({ ...x, floor_total: x.floors.length, room_total: 0 })) });
      if (/^\/api\/buildings\/1$/.test(u.pathname)) return json(res, { ...B[0], assignments: [], stats: { assets: 0, value: 0 }, floors: B[0].floors });
      if (/\/map$/.test(u.pathname) && req.method === 'PUT') return json(res, { ...B[0], ...b });
      if (u.pathname.startsWith('/api/floors/') && req.method === 'PUT') return json(res, {});
      return json(res, { rows: [] });
    }
    const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); res.end();
  });
});
// Pustaka peta tiruan: merekam sumber, layer, dan event
const FAKE = `(() => { const reg = {};
  class Map { constructor(o) { this.o = o; this.src = {}; this.lay = {}; this.h = {}; this.z = o.zoom; this.pitch = o.pitch; window.__fake = this; setTimeout(() => (this.h.load || []).forEach(f => f()), 20); }
    on(e, a, b) { const fn = b || a; (this.h[e] = this.h[e] || []).push(fn); } addControl() {} addSource(id, s) { this.src[id] = { data: s.data, setData(d) { this.data = d; } }; } getSource(id) { return this.src[id]; }
    addLayer(l) { this.lay[l.id] = { ...l }; } getLayer(id) { return this.lay[id]; } setFilter(id, f) { this.lay[id] = { ...(this.lay[id] || {}), filter: f }; }
    setLayoutProperty(id, k, v) { this.lay[id] = this.lay[id] || {}; (this.lay[id].layout = this.lay[id].layout || {})[k] = v; }
    easeTo(o) { if (o.pitch !== undefined) this.pitch = o.pitch; } flyTo() {} jumpTo() {} fitBounds() {} getZoom() { return this.z; } getCenter() { return { lng: 106.79, lat: -6.57 }; }
    getCanvas() { return { style: {}, addEventListener() {} }; } queryRenderedFeatures() { return window.__hit ? [{ properties: { bid: window.__hit } }] : []; } remove() {} dragPan = { enable() {}, disable() {} } }
  class Marker { constructor(o) { this.el = o.element; } setLngLat() { return this; } addTo() { document.body.appendChild(this.el); return this; } setOffset() { return this; } getElement() { return this.el; } remove() { this.el.remove(); } }
  window.maplibregl = { Map, Marker, NavigationControl: class {}, ScaleControl: class {}, LngLatBounds: class { extend() {} } }; })();`;
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1280, height: 800 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.addInitScript(FAKE); await pg.addInitScript(() => localStorage.setItem('sp_token', 't'));
  await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await pg.goto(url + '/#/peta-kampus'); await pg.waitForSelector('.mapx-item');
  ok('menu Peta kampus ada', await pg.locator('.nav a[href="#/peta-kampus"]').count() === 1);
  ok('daftar 2 gedung', await pg.locator('.mapx-item').count() === 2);
  const feats = () => pg.evaluate(() => window.__fake.src.solids.data.features.map(f => [f.properties.kind, f.properties.base, f.properties.top, f.properties.color]));
  let f = await feats();
  ok('A: 3 lantai + atap (ketinggian bertumpuk 4,8,13)', JSON.stringify(f.map(x => x[2])) === JSON.stringify([4, 8, 13, 13.4]), f);
  ok('lantai 3 berwarna khusus, lantai 1 warna gedung', f[2][3] === G.shade('#ff0000', 0) && f[0][3] === '#C9B79C', f);
  ok('gedung belum ditempatkan tidak digambar', f.length === 4);
  ok('layer 3D tampil, datar tersembunyi', await pg.evaluate(() => { const l = window.__fake.lay; return (l['campus-3d'].layout || {}).visibility === 'visible' && l['campus-flat'].layout.visibility === 'none'; }));
  await pg.click('#segMode [data-m="2d"]');
  ok('mode 2D: pitch 0 dan layer datar tampil', await pg.evaluate(() => { const l = window.__fake.lay; return window.__fake.pitch === 0 && l['campus-flat'].layout.visibility === 'visible' && l['campus-3d'].layout.visibility === 'none'; }));
  await pg.click('#segMode [data-m="3d"]');
  await pg.selectOption('#upTo', '2'); f = await feats(); ok('potong s.d. lantai 2', JSON.stringify(f.map(x => x[2])) === JSON.stringify([4, 8, 8.4]), f); await pg.selectOption('#upTo', '999');
  await pg.click('#segBase [data-b="sat"]');
  ok('ganti ke satelit', await pg.evaluate(() => window.__fake.lay.sat.layout.visibility === 'visible' && window.__fake.lay.osm.layout.visibility === 'none'));
  // Tempatkan gedung B, ubah warna dinding, simpan
  await pg.click('.mapx-item[data-id="2"]'); await pg.click('#eHere');
  f = await feats(); ok('B ditempatkan -> 2 lantai + atap ditambahkan', f.length === 4 + 3, f.length);
  await pg.locator('#eWall').evaluate(e => { e.value = '#336699'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  f = await feats(); ok('warna dinding B berubah di peta', f.some(x => x[0] === 'floor' && x[3] === '#336699'), f.map(x => x[3]));
  await pg.locator('#eRot').evaluate(e => { e.value = '90'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.click('#eSave'); await pg.waitForTimeout(150);
  const put = calls.find(c => c[0] === 'PUT' && c[1] === '/api/buildings/2/map');
  ok('PUT /buildings/2/map berisi posisi, rotasi 90, warna', put && put[2].latitude === -6.57 && put[2].longitude === 106.79 && put[2].map_rotation === 90 && put[2].wall_color === '#336699' && put[2].roof_color === null && put[2].map_footprint.length === 4, put);
  // Halaman gedung: tinggi lantai bawaan 4 dan dapat diubah
  await pg.goto(url + '/#/gedung/1'); await pg.waitForSelector('[data-editfloor]');
  ok('tabel lantai menampilkan tinggi 5 m untuk lantai 3', (await pg.locator('table.t').first().innerText()).includes('5 m'));
  await pg.click('[data-editfloor="12"]'); await pg.waitForSelector('[name=floor_height]');
  ok('tinggi lantai bawaan 4 pada form ubah', await pg.inputValue('[name=floor_height]') === '4');
  await pg.fill('[name=floor_height]', '4.5'); await pg.check('[name=wall_custom]'); await pg.locator('.modal-foot .primary').click(); await pg.waitForTimeout(200);
  const pf = calls.find(c => c[0] === 'PUT' && c[1] === '/api/floors/12');
  ok('PUT lantai: floor_height 4.5 & warna khusus', pf && pf[2].floor_height === 4.5 && /^#[0-9a-f]{6}$/i.test(pf[2].wall_color), pf);
  await pg.click('#addFloor'); await pg.waitForSelector('[name=floor_height]');
  ok('tambah lantai: bawaan 4 m & warna ikut gedung', await pg.inputValue('[name=floor_height]') === '4' && await pg.inputValue('[name=wall_color]') === '#c9b79c');
  await pg.locator('.modal-foot .primary').click(); await pg.waitForTimeout(200);
  const pc = calls.find(c => c[0] === 'POST' && c[1] === '/api/buildings/1/floors');
  ok('POST lantai: tinggi 4, warna null (ikut gedung)', pc && pc[2].floor_height === 4 && pc[2].wall_color === null, pc);
  ok('tanpa error JS', errs.length === 0, errs);
  await br.close(); srv.close(); console.log(fail ? fail + ' uji gagal' : 'semua uji UI peta lulus'); process.exit(fail ? 1 : 0);
})();
