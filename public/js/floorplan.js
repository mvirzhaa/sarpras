/* ===== Denah 2D tampak atas: editor (ala Visio) & penampil keterisian ===== */
'use strict';
const FPG = {
  pts: s => (s.type === 'rect' ? [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]] : s.points || []),
  area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; },
  bbox(p) { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; },
  inside([x, y], p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; },
  center(p) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length], f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
    if (Math.abs(a) < 1e-9) { const b = FPG.bbox(p); return [b.x + b.w / 2, b.y + b.h / 2]; }
    const c = [cx / (3 * a), cy / (3 * a)];
    if (FPG.inside(c, p)) return c;
    const b = FPG.bbox(p); return [b.x + b.w / 2, b.y + b.h / 2];
  },
  overlap(a, b) {
    const A = FPG.bbox(a), B = FPG.bbox(b), e = 0.05;
    if (A.x + A.w <= B.x + e || B.x + B.w <= A.x + e || A.y + A.h <= B.y + e || B.y + B.h <= A.y + e) return false;
    const isRect = p => p.length === 4 && Math.abs(FPG.area(p) - FPG.bbox(p).w * FPG.bbox(p).h) < 1e-6;
    if (isRect(a) && isRect(b)) return true;
    const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const proper = (p1, p2, q1, q2) => { const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2); return d1 * d2 < -1e-9 && d3 * d4 < -1e-9; };
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (proper(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    return FPG.inside(FPG.center(a), b) || FPG.inside(FPG.center(b), a);
  },
  round: v => Math.round(v * 100) / 100,
};

class FloorPlan {
  constructor(host, o) {
    this.o = Object.assign({ mode: 'view', width: 60, height: 30, grid: 0.5, rooms: [], categories: [], bg: null, bgOpacity: 0.35, codePrefix: 'R-1',
      colorOf: null, subOf: null, onSelect: () => {}, onChange: () => {}, annotations: [] }, o);
    this.cat = new Map(this.o.categories.map(c => [Number(c.id), c]));
    this.rooms = this.o.rooms.map(r => ({ ...r, shape: typeof r.shape === 'string' ? JSON.parse(r.shape) : (r.shape || {}) })).filter(r => r.shape && r.shape.type);
    this.unplaced = this.o.rooms.filter(r => !r.shape || !r.shape.type);
    this.origIds = new Set(this.o.rooms.map(r => r.id));
    this.sel = -1; this.tool = 'select'; this.undoS = []; this.redoS = []; this.drag = null; this.poly = null; this.ptrs = new Map(); this.tmp = 0; this.dirty = false;
    this.lastCat = (this.o.categories.find(c => c.schedulable) || this.o.categories[0] || {}).id;
    host.innerHTML = `<div class="fp-canvas"><svg class="fp-svg" tabindex="0" aria-label="Denah lantai">
        <g class="w"><image class="bg" preserveAspectRatio="xMinYMin meet" style="pointer-events:none"/><rect class="bounds" vector-effect="non-scaling-stroke"/>
        <path class="grid-minor" fill="none" vector-effect="non-scaling-stroke"/><path class="grid-major" fill="none" vector-effect="non-scaling-stroke"/>
        <g class="rooms"></g><g class="ov"></g></g></svg>
      <div class="fp-zoom no-print"><button class="tool" data-z="in" aria-label="Perbesar">${I('zin')}</button><button class="tool" data-z="out" aria-label="Perkecil">${I('zout')}</button><button class="tool" data-z="fit" aria-label="Pas layar">${I('fit')}</button></div>
      <div class="fp-hint" hidden></div></div>`;
    this.host = host; this.svg = $('svg', host); this.w = $('.w', host); this.gR = $('.rooms', host); this.gO = $('.ov', host); this.hint = $('.fp-hint', host);
    $$('[data-z]', host).forEach(b => (b.onclick = () => (b.dataset.z === 'fit' ? this.fit() : this.zoom(b.dataset.z === 'in' ? 0.8 : 1.25))));
    this.bindEvents(); this.setFloor({}); this.fit();
    if (this.o.mode === 'edit') this.setHint('Pilih alat Ruang persegi (R) lalu seret di kanvas. Poligon (P) untuk ruang berbentuk L.');
  }
  // ---------- tampilan ----------
  setFloor({ width, height, grid, bg, bgOpacity }) {
    if (width) this.o.width = Number(width); if (height) this.o.height = Number(height); if (grid) this.o.grid = Number(grid);
    if (bg !== undefined) this.o.bg = bg; if (bgOpacity !== undefined) this.o.bgOpacity = Number(bgOpacity);
    const { width: W, height: H, grid: g } = this.o;
    const b = $('.bounds', this.svg); b.setAttribute('width', W); b.setAttribute('height', H);
    const im = $('.bg', this.svg);
    if (this.o.bg) { im.setAttribute('href', this.o.bg); im.setAttribute('width', W); im.setAttribute('height', H); im.setAttribute('opacity', this.o.bgOpacity); im.style.display = ''; } else im.style.display = 'none';
    let mi = '', ma = '';
    for (let x = 0; x <= W + 1e-9; x += g) (Math.abs(x / 5 - Math.round(x / 5)) < 1e-6 ? (ma += `M${x} 0V${H}`) : (mi += `M${x} 0V${H}`));
    for (let y = 0; y <= H + 1e-9; y += g) (Math.abs(y / 5 - Math.round(y / 5)) < 1e-6 ? (ma += `M0 ${y}H${W}`) : (mi += `M0 ${y}H${W}`));
    $('.grid-minor', this.svg).setAttribute('d', this.o.mode === 'edit' ? mi : '');
    $('.grid-major', this.svg).setAttribute('d', ma);
    this.render();
  }
  fit() { const m = 1.5; this.vb = { x: -m, y: -m, w: this.o.width + 2 * m, h: this.o.height + 2 * m }; this.applyVB(); }
  applyVB() {
    const r = this.svg.getBoundingClientRect(), ar = r.width && r.height ? r.width / r.height : 2;
    let { x, y, w, h } = this.vb;
    if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
    this.vb = { x, y, w, h }; this.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); this.renderOverlay();
  }
  zoom(f, cx, cy) {
    const v = this.vb; cx = cx ?? v.x + v.w / 2; cy = cy ?? v.y + v.h / 2;
    const nw = Math.min(Math.max(v.w * f, 3), Math.max(this.o.width, this.o.height) * 6);
    const k = nw / v.w; this.vb = { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w: v.w * k, h: v.h * k }; this.applyVB();
  }
  px() { return this.vb.w / (this.svg.clientWidth || 800); } // meter per piksel
  pt(e) { const p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const r = p.matrixTransform(this.w.getScreenCTM().inverse()); return [r.x, r.y]; }
  snap(v, e) { return e && e.altKey ? FPG.round(v) : Math.round(v / this.o.grid) * this.o.grid; }
  color(r) { if (this.o.colorOf) return this.o.colorOf(r); const c = this.cat.get(Number(r.category_id)); return c ? c.color : '#B8C4C0'; }
  setHint(t) { this.hint.hidden = !t; this.hint.textContent = t || ''; }
  render() {
    const overlaps = new Set();
    if (this.o.mode === 'edit') {
      const P = this.rooms.map(r => FPG.pts(r.shape));
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (FPG.overlap(P[i], P[j])) { overlaps.add(i); overlaps.add(j); }
    }
    this.overlaps = overlaps;
    this.gR.innerHTML = this.rooms.map((r, i) => {
      const p = FPG.pts(r.shape), b = FPG.bbox(p), [cx, cy] = FPG.center(p);
      const fs = Math.max(0.32, Math.min(1.3, Math.min(b.w, b.h) / 4.2));
      const fit = (t, size) => { const n = Math.max(3, Math.floor(b.w / (size * 0.56))); t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
      const sub = this.o.subOf ? this.o.subOf(r) : (this.o.mode === 'edit' ? `${FPG.round(FPG.area(p))} m²` : r.name);
      const lines = [[fit(r.code, fs), fs, 'fp-code']];
      if (b.h > fs * 2.4) lines.push([fit(this.o.mode === 'edit' ? r.name : sub, fs * 0.72), fs * 0.72, 'fp-sub']);
      if (this.o.mode === 'edit' && b.h > fs * 3.6) lines.push([fit(sub, fs * 0.6), fs * 0.6, 'fp-sub']);
      const tot = lines.reduce((s, l) => s + l[1] * 1.2, 0); let y = cy - tot / 2;
      return `<g class="fp-room ${i === this.sel ? 'is-sel' : ''} ${overlaps.has(i) ? 'is-overlap' : ''} ${r._dim ? 'dim' : ''}" data-i="${i}">
        <polygon points="${p.map(q => q.join(',')).join(' ')}" fill="${this.color(r)}" fill-opacity="${this.o.mode === 'edit' ? 0.5 : 0.7}" vector-effect="non-scaling-stroke"><title>${esc(r.code + ' — ' + r.name)}</title></polygon>
        ${lines.map(([t, s, c]) => { y += s * 1.2; return `<text x="${cx}" y="${y - s * 0.6}" font-size="${s}" class="${c}">${esc(t)}</text>`; }).join('')}</g>`;
    }).join('');
    this.renderOverlay();
  }
  renderOverlay() {
    if (!this.gO) return;
    const k = this.px(), hs = 9 * k; let h = '';
    if (this.o.mode === 'edit' && this.sel >= 0 && this.rooms[this.sel]) {
      const s = this.rooms[this.sel].shape;
      const handles = s.type === 'rect'
        ? [['nw', s.x, s.y], ['n', s.x + s.w / 2, s.y], ['ne', s.x + s.w, s.y], ['e', s.x + s.w, s.y + s.h / 2], ['se', s.x + s.w, s.y + s.h], ['s', s.x + s.w / 2, s.y + s.h], ['sw', s.x, s.y + s.h], ['w', s.x, s.y + s.h / 2]]
        : s.points.map((q, i) => ['v' + i, q[0], q[1]]);
      h += handles.map(([id, x, y]) => `<rect class="fp-handle" data-h="${id}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" vector-effect="non-scaling-stroke" style="cursor:${id.startsWith('v') ? 'move' : { n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' }[id] + '-resize'}"/>`).join('');
      const b = FPG.bbox(FPG.pts(s));
      h += `<text class="fp-dim" x="${b.x + b.w / 2}" y="${b.y - 6 * k}" text-anchor="middle" font-size="${12 * k}">${FPG.round(b.w)} m</text>
            <text class="fp-dim" x="${b.x + b.w + 6 * k}" y="${b.y + b.h / 2}" font-size="${12 * k}">${FPG.round(b.h)} m</text>`;
    }
    if (this.drag && this.drag.kind === 'draw') {
      const d = this.drag, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0);
      h += `<rect class="fp-preview" x="${x}" y="${y}" width="${w}" height="${hh}" vector-effect="non-scaling-stroke"/>
            <text class="fp-dim" x="${x + w / 2}" y="${y + hh / 2}" text-anchor="middle" font-size="${13 * k}">${FPG.round(w)} × ${FPG.round(hh)} m = ${FPG.round(w * hh)} m²</text>`;
    }
    if (this.poly) {
      const pts = [...this.poly.points, this.poly.cursor].filter(Boolean);
      h += `<polyline class="fp-preview" points="${pts.map(q => q.join(',')).join(' ')}" fill="rgba(46,99,144,.08)" vector-effect="non-scaling-stroke"/>`;
      h += this.poly.points.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="${(i ? 3.5 : 6) * k}" class="fp-handle" vector-effect="non-scaling-stroke"/>`).join('');
      if (this.poly.cursor && this.poly.points.length) { const a = this.poly.points[this.poly.points.length - 1], c = this.poly.cursor; h += `<text class="fp-dim" x="${(a[0] + c[0]) / 2}" y="${(a[1] + c[1]) / 2 - 6 * k}" font-size="${12 * k}">${FPG.round(Math.hypot(c[0] - a[0], c[1] - a[1]))} m</text>`; }
    }
    this.gO.innerHTML = h;
  }
  // ---------- data ----------
  snapshot() { return JSON.stringify(this.rooms); }
  pushUndo(s) { this.undoS.push(s || this.snapshot()); if (this.undoS.length > 80) this.undoS.shift(); this.redoS = []; }
  undo() { if (!this.undoS.length) return; this.redoS.push(this.snapshot()); this.rooms = JSON.parse(this.undoS.pop()); this.sel = -1; this.changed(); }
  redo() { if (!this.redoS.length) return; this.undoS.push(this.snapshot()); this.rooms = JSON.parse(this.redoS.pop()); this.sel = -1; this.changed(); }
  changed() { this.dirty = true; this.render(); this.o.onChange(this); this.o.onSelect(this.sel >= 0 ? this.rooms[this.sel] : null, this.sel); }
  select(i) { this.sel = i; this.render(); this.o.onSelect(i >= 0 ? this.rooms[i] : null, i); }
  selectById(id) { const i = this.rooms.findIndex(r => r.id === id); if (i >= 0) { this.select(i); const b = FPG.bbox(FPG.pts(this.rooms[i].shape)); if (b.x < this.vb.x || b.y < this.vb.y || b.x + b.w > this.vb.x + this.vb.w || b.y + b.h > this.vb.y + this.vb.h) this.fit(); } }
  nextCode() {
    const pre = this.o.codePrefix; let n = 0;
    this.rooms.concat(this.unplaced).forEach(r => { if (String(r.code).startsWith(pre)) { const m = String(r.code).slice(pre.length).match(/^(\d+)/); if (m) n = Math.max(n, Number(m[1])); } });
    return pre + String(n + 1).padStart(2, '0');
  }
  addRoom(shape) {
    this.pushUndo();
    const p = FPG.pts(shape), code = this.nextCode();
    const cat = this.cat.get(Number(this.lastCat));
    this.rooms.push({ id: 'tmp-' + (++this.tmp), code, name: (cat ? cat.name.split('/')[0].trim() : 'Ruang') + ' ' + code, category_id: this.lastCat || null, capacity: 0, status: 'aktif', area: FPG.round(FPG.area(p)), shape });
    this.sel = this.rooms.length - 1; this.changed();
  }
  update(i, patch, undoable = true) {
    if (undoable) this.pushUndo();
    Object.assign(this.rooms[i], patch);
    if (patch.category_id) this.lastCat = patch.category_id;
    this.changed();
  }
  remove(i = this.sel) { if (i < 0) return; this.pushUndo(); this.rooms.splice(i, 1); this.sel = -1; this.changed(); }
  duplicate(i = this.sel) {
    if (i < 0) return; const r = JSON.parse(JSON.stringify(this.rooms[i])), d = Math.max(1, this.o.grid * 2);
    if (r.shape.type === 'rect') { r.shape.x += d; r.shape.y += d; } else r.shape.points = r.shape.points.map(([x, y]) => [x + d, y + d]);
    this.pushUndo(); r.id = 'tmp-' + (++this.tmp); r.code = this.nextCode(); r.name = r.name.replace(this.rooms[i].code, r.code); this.rooms.push(r); this.sel = this.rooms.length - 1; this.changed();
  }
  translate(shape, dx, dy) { if (shape.type === 'rect') { shape.x = FPG.round(shape.x + dx); shape.y = FPG.round(shape.y + dy); } else shape.points = shape.points.map(([x, y]) => [FPG.round(x + dx), FPG.round(y + dy)]); }
  toRect(i) { // ubah poligon jadi persegi bounding box
    const s = this.rooms[i].shape; if (s.type === 'rect') return; const b = FPG.bbox(s.points); this.update(i, { shape: { type: 'rect', ...b } });
  }
  toPoly(i) { const s = this.rooms[i].shape; if (s.type === 'poly') return; this.update(i, { shape: { type: 'poly', points: FPG.pts(s) } }); }
  payload() {
    const cur = new Set(this.rooms.map(r => r.id).concat(this.unplaced.map(r => r.id)));
    return {
      rooms: this.rooms.map(r => ({ id: r.id, code: r.code, name: r.name, category_id: r.category_id || null, capacity: Number(r.capacity) || 0, status: r.status || 'aktif',
        facilities: r.facilities || null, description: r.description || null, area: FPG.round(FPG.area(FPG.pts(r.shape))), shape: r.shape })),
      deleted: [...this.origIds].filter(id => typeof id === 'number' && !cur.has(id)),
    };
  }
  // ---------- interaksi ----------
  setTool(t) {
    this.tool = t; this.poly = null; this.renderOverlay();
    this.svg.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    this.setHint({ rect: 'Seret untuk menggambar ruang. Tahan Alt untuk menonaktifkan snap grid.', poly: 'Klik titik-titik sudut. Klik titik awal / Enter untuk menutup, Esc untuk batal. Shift = garis lurus.', pan: 'Seret untuk menggeser tampilan.', select: '' }[t] || '');
  }
  bindEvents() {
    const S = this.svg;
    S.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = this.pt(e); this.zoom(e.deltaY > 0 ? 1.12 : 0.89, x, y); }, { passive: false });
    S.addEventListener('pointerdown', e => this.down(e));
    S.addEventListener('pointermove', e => this.move(e));
    S.addEventListener('pointerup', e => this.up(e));
    S.addEventListener('pointercancel', e => { this.ptrs.delete(e.pointerId); this.drag = null; });
    S.addEventListener('dblclick', e => { if (this.poly) this.finishPoly(); else if (this.o.mode === 'edit') { const g = e.target.closest('[data-i]'); if (g && this.o.onOpen) this.o.onOpen(Number(g.dataset.i)); } });
    this.onKey = e => {
      if (!document.body.contains(this.svg)) return document.removeEventListener('keydown', this.onKey);
      if (/input|select|textarea/i.test(e.target.tagName) || $('.modal-bg')) return;
      if (e.code === 'Space' && !this.space) { this.space = true; S.style.cursor = 'grab'; e.preventDefault(); return; }
      if (this.o.mode !== 'edit') return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (ctrl && k === 'y') { e.preventDefault(); this.redo(); }
      else if (ctrl && k === 'd') { e.preventDefault(); this.duplicate(); }
      else if (k === 'delete' || k === 'backspace') { if (this.sel >= 0) { e.preventDefault(); this.remove(); } }
      else if (k === 'escape') { if (this.poly) { this.poly = null; this.renderOverlay(); } else this.select(-1); }
      else if (k === 'enter' && this.poly) this.finishPoly();
      else if (!ctrl && k === 'v') this.o.onTool && this.o.onTool('select');
      else if (!ctrl && k === 'r') this.o.onTool && this.o.onTool('rect');
      else if (!ctrl && k === 'p') this.o.onTool && this.o.onTool('poly');
      else if (!ctrl && k === 'h') this.o.onTool && this.o.onTool('pan');
      else if (k.startsWith('arrow') && this.sel >= 0) {
        e.preventDefault(); const st = this.o.grid * (e.shiftKey ? 5 : 1);
        const dx = k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, dy = k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0;
        this.pushUndo(); this.translate(this.rooms[this.sel].shape, dx, dy); this.changed();
      }
    };
    this.onKeyUp = e => { if (e.code === 'Space') { this.space = false; this.setTool(this.tool); } };
    document.addEventListener('keydown', this.onKey); document.addEventListener('keyup', this.onKeyUp);
    this.ro = new ResizeObserver(() => this.applyVB()); this.ro.observe(S);
  }
  destroy() { document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKeyUp); this.ro && this.ro.disconnect(); }
  down(e) {
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.svg.setPointerCapture(e.pointerId);
    if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) }; return; }
    const [x, y] = this.pt(e), room = e.target.closest('[data-i]'), handle = e.target.closest('[data-h]');
    if (e.button === 1 || this.space || this.tool === 'pan') return this.startPan(e);
    if (this.o.mode !== 'edit') { this.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, vb: { ...this.vb }, room: room ? Number(room.dataset.i) : -1, moved: false }; return; }
    if (this.tool === 'rect') { const sx = this.snap(x, e), sy = this.snap(y, e); this.drag = { kind: 'draw', x0: sx, y0: sy, x1: sx, y1: sy }; return; }
    if (this.tool === 'poly') {
      let p = [this.snap(x, e), this.snap(y, e)];
      if (!this.poly) this.poly = { points: [] };
      const pts = this.poly.points;
      if (e.shiftKey && pts.length) p = this.ortho(pts[pts.length - 1], p);
      if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < Math.max(this.o.grid, 10 * this.px())) return this.finishPoly();
      if (!pts.length || pts[pts.length - 1][0] !== p[0] || pts[pts.length - 1][1] !== p[1]) pts.push(p);
      this.renderOverlay(); return;
    }
    if (handle && this.sel >= 0) { this.drag = { kind: 'handle', h: handle.dataset.h, orig: JSON.parse(JSON.stringify(this.rooms[this.sel].shape)), snap: this.snapshot(), x0: x, y0: y }; return; }
    if (room) { const i = Number(room.dataset.i); if (i !== this.sel) this.select(i); this.drag = { kind: 'move', x0: x, y0: y, orig: JSON.parse(JSON.stringify(this.rooms[i].shape)), snap: this.snapshot(), moved: false }; return; }
    this.select(-1); this.startPan(e);
  }
  startPan(e) { this.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, vb: { ...this.vb }, room: -1, moved: false }; this.svg.style.cursor = 'grabbing'; }
  ortho(a, p) { return Math.abs(p[0] - a[0]) > Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]]; }
  move(e) {
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (this.poly && this.tool === 'poly') { const [x, y] = this.pt(e); let p = [this.snap(x, e), this.snap(y, e)]; const pts = this.poly.points; if (e.shiftKey && pts.length) p = this.ortho(pts[pts.length - 1], p); this.poly.cursor = p; this.renderOverlay(); }
    if (!d) return;
    if (d.kind === 'pinch' && this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()], nd = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = this.pt({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }); this.zoom(d.d / nd, mid[0], mid[1]); d.d = nd; return;
    }
    if (d.kind === 'pan') {
      const k = this.px(), dx = e.clientX - d.cx, dy = e.clientY - d.cy;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      this.vb = { ...d.vb, x: d.vb.x - dx * k, y: d.vb.y - dy * k }; this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`); return;
    }
    const [x, y] = this.pt(e);
    if (d.kind === 'draw') { d.x1 = this.snap(x, e); d.y1 = this.snap(y, e); this.renderOverlay(); return; }
    const r = this.rooms[this.sel]; if (!r) return;
    if (d.kind === 'move') {
      const dx = this.snap(x - d.x0, e), dy = this.snap(y - d.y0, e);
      if (dx || dy) d.moved = true;
      r.shape = JSON.parse(JSON.stringify(d.orig)); this.translate(r.shape, dx, dy); this.render(); return;
    }
    if (d.kind === 'handle') {
      const s = JSON.parse(JSON.stringify(d.orig)), sx = this.snap(x, e), sy = this.snap(y, e), g = this.o.grid;
      if (d.h.startsWith('v')) { s.points[Number(d.h.slice(1))] = [sx, sy]; }
      else {
        let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
        if (d.h.includes('w')) x1 = Math.min(sx, x2 - g); if (d.h.includes('e')) x2 = Math.max(sx, x1 + g);
        if (d.h.includes('n')) y1 = Math.min(sy, y2 - g); if (d.h.includes('s')) y2 = Math.max(sy, y1 + g);
        Object.assign(s, { x: FPG.round(x1), y: FPG.round(y1), w: FPG.round(x2 - x1), h: FPG.round(y2 - y1) });
      }
      r.shape = s; d.moved = true; this.render();
    }
  }
  up(e) {
    this.ptrs.delete(e.pointerId);
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.kind === 'pinch') return;
    if (d.kind === 'pan') { this.setTool(this.tool); if (!d.moved && this.o.mode !== 'edit') { this.sel = d.room; this.render(); this.o.onSelect(d.room >= 0 ? this.rooms[d.room] : null, d.room); } return; }
    if (d.kind === 'draw') {
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      this.renderOverlay();
      if (w >= this.o.grid && h >= this.o.grid) { this.addRoom({ type: 'rect', x: FPG.round(x), y: FPG.round(y), w: FPG.round(w), h: FPG.round(h) }); this.o.onTool && this.o.onTool('select'); }
      return;
    }
    if ((d.kind === 'move' || d.kind === 'handle') && d.moved) { this.pushUndo(d.snap); this.rooms[this.sel].area = FPG.round(FPG.area(FPG.pts(this.rooms[this.sel].shape))); this.changed(); }
  }
  finishPoly() {
    const pts = this.poly ? this.poly.points : [];
    this.poly = null; this.renderOverlay();
    if (pts.length < 3 || FPG.area(pts) < this.o.grid * this.o.grid) return UI.toast('Poligon minimal 3 titik dengan luas yang cukup', true);
    this.addRoom({ type: 'poly', points: pts }); this.o.onTool && this.o.onTool('select');
  }
}

// Ilustrasi denah untuk layar masuk
Pages.blueprintArt = () => `<svg viewBox="0 0 600 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="#9DB6C8" stroke-width="1.2">
  <path d="M40 60h520v380H40z"/><path d="M40 200h180v240M220 60v100M220 200h100v240M320 60v140M420 200v240M420 320h140M320 140h240" />
  <path d="M120 200v-8M260 200v-8M360 200v-8M480 200v-8" stroke-width="3"/></g>
  <g fill="#9DB6C8" font-family="Public Sans, sans-serif" font-size="13"><text x="80" y="120">Ruang Kelas 101</text><text x="250" y="100">Lab 102</text><text x="400" y="100">Ruang Rapat</text>
  <text x="80" y="320">Ruang Dosen</text><text x="240" y="320">Kelas 103</text><text x="340" y="320">Kelas 104</text><text x="450" y="270">Gudang</text><text x="450" y="390">Musala</text></g></svg>`;
