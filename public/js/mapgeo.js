/* ===== Geometri peta kampus (dipakai browser & server, dapat diuji di Node) ===== */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MapGeo = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const M_LAT = 111320;
  const DEF_WALL = '#C9B79C', DEF_FLOOR_H = 4;
  const rad = d => (d * Math.PI) / 180, round = v => Math.round(v * 100) / 100;
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const signedArea = p => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
  const area = p => Math.abs(signedArea(p));
  const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const hull = pts => {
    const P = [...new Set(pts.map(p => p.join(',')))].map(s => s.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  };
  const roomCorners = s => (s && s.type === 'rect' ? [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]] : s && s.type === 'poly' ? s.points || [] : []);

  // Tapak dari denah: convex hull ruang pada lantai berluas terbesar; sumbu y-bawah -> utara, dipusatkan.
  const derive = rooms => {
    const by = {};
    (rooms || []).forEach(r => { const c = roomCorners(r.shape); if (c.length < 3) return; const k = by[r.floor_id] = by[r.floor_id] || { pts: [], area: 0 }; k.pts.push(...c); k.area += area(c); });
    const best = Object.values(by).sort((a, b) => b.area - a.area)[0];
    if (!best) return null;
    const h = hull(best.pts); if (h.length < 3) return null;
    const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return h.map(([x, y]) => [round(x - cx), round(-(y - cy))]);
  };
  const fallback = (buildingArea, floorsCount) => {
    const a = Number(buildingArea) > 0 ? Number(buildingArea) / Math.max(1, Number(floorsCount) || 1) : 0;
    if (a < 20) return rect(24, 12);
    const w = Math.sqrt(a * 1.6); return rect(round(w), round(a / w));
  };

  const toLngLat = ([e, n], lat, lng, rot) => {
    const t = rad(rot || 0), c = Math.cos(t), s = Math.sin(t), e2 = e * c + n * s, n2 = -e * s + n * c;
    return [lng + e2 / (M_LAT * Math.cos(rad(lat))), lat + n2 / M_LAT];
  };
  const fromLngLat = ([lo, la], lat, lng, rot) => {
    const e2 = (lo - lng) * M_LAT * Math.cos(rad(lat)), n2 = (la - lat) * M_LAT, t = rad(rot || 0), c = Math.cos(t), s = Math.sin(t);
    return [round(e2 * c - n2 * s), round(e2 * s + n2 * c)];
  };

  const shade = (hex, amt) => {
    if (!HEX.test(hex || '')) hex = DEF_WALL;
    const n = parseInt(hex.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)))));
    return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
  };

  const stack = (b, upTo = 999) => {
    const all = (b.floors || []).filter(f => Number(f.level) >= 1).sort((x, y) => x.level - y.level);
    const src = all.length ? all : [{ level: 1, floor_height: DEF_FLOOR_H }];
    let base = 0; const out = [];
    for (const f of src) {
      if (f.level > upTo) break;
      const h = Number(f.floor_height) > 0 ? Number(f.floor_height) : DEF_FLOOR_H;
      out.push({ level: f.level, name: f.name, base, top: base + h, height: h, color: HEX.test(f.wall_color || '') ? f.wall_color : (HEX.test(b.wall_color || '') ? b.wall_color : DEF_WALL) });
      base += h;
    }
    return out;
  };
  const totalHeight = b => { const s = stack(b); return s.length ? s[s.length - 1].top : 0; };

  const ring = b => {
    let pts = (b.footprint || []).map(p => toLngLat(p, Number(b.latitude), Number(b.longitude), Number(b.map_rotation) || 0));
    if (pts.length < 3) return null;
    if (signedArea(pts) < 0) pts = pts.reverse();
    pts.push(pts[0].slice()); return pts;
  };
  const isPlaced = b => b.latitude != null && b.longitude != null && Array.isArray(b.footprint) && b.footprint.length >= 3;

  const collection = (buildings, { upTo = 999 } = {}) => {
    const solids = [], outlines = [];
    for (const b of buildings) {
      if (!isPlaced(b)) continue;
      const rg = ring(b); if (!rg) continue;
      const st = stack(b, upTo); if (!st.length) continue;
      const base = { bid: b.id, code: b.code || '', name: b.name || '' };
      st.forEach((f, i) => solids.push({ type: 'Feature', properties: { ...base, kind: 'floor', level: f.level, base: f.base, top: f.top, color: i % 2 ? shade(f.color, -0.05) : f.color }, geometry: { type: 'Polygon', coordinates: [rg] } }));
      const top = st[st.length - 1].top, wall = st[st.length - 1].color;
      solids.push({ type: 'Feature', properties: { ...base, kind: 'roof', level: st[st.length - 1].level, base: top, top: top + 0.4, color: HEX.test(b.roof_color || '') ? b.roof_color : shade(wall, -0.3) }, geometry: { type: 'Polygon', coordinates: [rg] } });
      outlines.push({ type: 'Feature', properties: { ...base, kind: 'outline' }, geometry: { type: 'Polygon', coordinates: [rg] } });
    }
    return { solids: { type: 'FeatureCollection', features: solids }, outlines: { type: 'FeatureCollection', features: outlines } };
  };
  return { M_LAT, DEF_WALL, DEF_FLOOR_H, HEX, area, signedArea, rect, hull, derive, fallback, toLngLat, fromLngLat, shade, stack, totalHeight, collection, isPlaced, round };
});
