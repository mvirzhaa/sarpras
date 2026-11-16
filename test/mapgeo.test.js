// Uji geometri peta kampus: node test/mapgeo.test.js
const G = require('../public/js/mapgeo.js'); let fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log('GAGAL', n, JSON.stringify(a), '!=', JSON.stringify(b)); } };
const near = (n, a, b, tol) => { if (Math.abs(a - b) > tol) { fail++; console.log('GAGAL', n, a, 'vs', b); } };
near('luas persegi 20x10', G.area(G.rect(20, 10)), 200, 1e-9);
const lat = -6.6, lng = 106.8, mLng = 111320 * Math.cos(lat * Math.PI / 180);
let [lo, la] = G.toLngLat([0, 10], lat, lng, 90); near('utara->timur (bujur)', (lo - lng) * mLng, 10, 1e-6); near('utara->timur (lintang)', (la - lat) * 111320, 0, 1e-6);
[lo, la] = G.toLngLat([10, 0], lat, lng, 0); near('timur 10 m', (lo - lng) * mLng, 10, 1e-6);
for (const rot of [0, 33, 90, 217, 359]) { const p = [12.5, -7.25]; const back = G.fromLngLat(G.toLngLat(p, lat, lng, rot), lat, lng, rot); near('bolak-balik x rot ' + rot, back[0], p[0], 0.011); near('bolak-balik y rot ' + rot, back[1], p[1], 0.011); }
const a = G.toLngLat([-10, 0], lat, lng, 0), b = G.toLngLat([10, 0], lat, lng, 0); near('lebar 20 m di peta', (b[0] - a[0]) * mLng, 20, 1e-6);
const mk = fl => ({ id: 1, code: 'GFT', name: 'Gedung', latitude: lat, longitude: lng, map_rotation: 0, footprint: G.rect(20, 10), wall_color: '#C9B79C', floors: fl });
const f4 = [1, 2, 3, 4].map(l => ({ level: l, floor_height: 4 }));
near('tinggi 4x4', G.totalHeight(mk(f4)), 16, 1e-9);
near('tinggi lantai 3 = 5 m', G.totalHeight(mk(f4.map(f => (f.level === 3 ? { ...f, floor_height: 5 } : f)))), 17, 1e-9);
near('tinggi bawaan bila kosong', G.totalHeight(mk([])), 4, 1e-9);
near('basement diabaikan', G.totalHeight(mk([{ level: 0, floor_height: 4 }, { level: 1, floor_height: 4 }])), 4, 1e-9);
const c = G.collection([mk(f4)]); const fs = c.solids.features;
eq('jumlah fitur (4 lantai + atap)', fs.length, 5);
eq('basis/puncak', fs.slice(0, 4).map(f => [f.properties.base, f.properties.top]), [[0, 4], [4, 8], [8, 12], [12, 16]]);
eq('atap', [fs[4].properties.kind, fs[4].properties.base], ['roof', 16]);
eq('garis tapak', c.outlines.features.length, 1);
const cut = G.collection([mk(f4)], { upTo: 2 }).solids.features; eq('potong s.d. lantai 2', cut.map(f => f.properties.kind + f.properties.top), ['floor4', 'floor8', 'roof8.4']);
const col = G.collection([mk(f4.map(f => (f.level === 2 ? { ...f, wall_color: '#ff0000' } : f)))]).solids.features;
eq('warna lantai 1 = gedung', col[0].properties.color, '#C9B79C'); eq('warna lantai 2 = override', col[1].properties.color, G.shade('#ff0000', -0.05));
eq('belum ditempatkan tidak dirender', G.collection([{ ...mk(f4), latitude: null }]).solids.features.length, 0);
const ringPts = c.solids.features[0].geometry.coordinates[0]; eq('ring tertutup', ringPts[0], ringPts[ringPts.length - 1]); if (G.signedArea(ringPts) <= 0) { fail++; console.log('GAGAL ring CCW'); }
const rooms = [
  { floor_id: 1, shape: { type: 'rect', x: 0, y: 0, w: 20, h: 8 } }, { floor_id: 1, shape: { type: 'rect', x: 0, y: 8, w: 8, h: 10 } },
  { floor_id: 2, shape: { type: 'rect', x: 0, y: 0, w: 5, h: 5 } }];
const d = G.derive(rooms);
if (G.area(d) < 240) { fail++; console.log('GAGAL hull < luas ruang'); }
const xs = d.map(p => p[0]), ys = d.map(p => p[1]); near('terpusat x', (Math.min(...xs) + Math.max(...xs)) / 2, 0, 0.01); near('terpusat y', (Math.min(...ys) + Math.max(...ys)) / 2, 0, 0.01);
near('lebar bbox 20', Math.max(...xs) - Math.min(...xs), 20, 0.01); near('tinggi bbox 18', Math.max(...ys) - Math.min(...ys), 18, 0.01);
eq('tanpa denah -> null', G.derive([]), null);
near('perkiraan 1200 m2 / 3 lantai', G.area(G.fallback(1200, 3)), 400, 1);
near('perkiraan default', G.area(G.fallback(null, 2)), 288, 1e-9);
eq('hex valid', [G.HEX.test('#1a2B3c'), G.HEX.test('red'), G.HEX.test('#12345')], [true, false, false]);
console.log(fail ? `${fail} uji gagal` : 'semua uji geometri peta lulus'); process.exit(fail ? 1 : 0);
