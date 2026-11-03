// Rendra — asisten SARPRAS.
// Dua mode:
//  - "dasar" (selalu tersedia, tanpa layanan luar): memahami permintaan cari ruang dalam bahasa Indonesia
//    (tanggal, hari, jam, kapasitas, kategori, gedung, berulang) dan menjawab panduan fitur dari basis pengetahuan.
//  - "ai" (bila ANTHROPIC_API_KEY diisi): percakapan bebas dengan model Claude, memakai alat yang sama
//    (cari_ruang_kosong, jadwal_ruang) sehingga data ruang tetap berasal dari basis data aplikasi.
const { db } = require('../db');
const { findFreeRooms, occurrences } = require('../routes/schedule');
const KB = require('./rendra-kb');

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const fmtDate = s => { const d = new Date(s + 'T00:00:00'); return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; };
const fmtTime = t => t.replace(':', '.');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// ---------------- Data acuan (cache singkat) ----------------
let refCache = null, refAt = 0;
async function refs() {
  if (refCache && Date.now() - refAt < 60000) return refCache;
  const [cats, blds, op, period, org] = await Promise.all([
    db.q(`SELECT id, name, bookable FROM room_categories ORDER BY sort, name`),
    db.q(`SELECT id, code, name FROM buildings ORDER BY code`),
    db.one(`SELECT value FROM settings WHERE key='operational'`),
    db.one(`SELECT name, start_date, end_date FROM academic_periods WHERE is_active ORDER BY start_date DESC LIMIT 1`),
    db.one(`SELECT value FROM settings WHERE key='org'`),
  ]);
  refCache = { cats, blds, op: (op && op.value) || { start: '07:00', end: '21:00', days: [1, 2, 3, 4, 5, 6] }, period, org: (org && org.value) || {} };
  refAt = Date.now();
  return refCache;
}

// ---------------- Pemahaman bahasa: tanggal ----------------
const DAYS = { minggu: 0, ahad: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };
const MONTHS = { jan: 1, januari: 1, feb: 2, februari: 2, pebruari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, nov: 11, nop: 11, november: 11, des: 12, desember: 12, dec: 12 };
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const normalize = s => ' ' + String(s || '').toLowerCase().replace(/jum'?at/g, 'jumat').replace(/[–—]/g, '-').replace(/[?!,;]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

function validDate(y, m, d) { const x = new Date(y, m - 1, d); return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null; }

// Mengembalikan { date: Date|null, span: [i,j] teks yang dipakai }
function findDate(t, now) {
  const today = startOfDay(now);
  let m;
  if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return hit(validDate(+m[1], +m[2], +m[3]), m);
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)) || (m = t.match(/\b(\d{1,2})[.-](\d{1,2})[.-](\d{4})\b/))) {
    let y = m[3] ? +m[3] : today.getFullYear(); if (y < 100) y += 2000;
    let d = validDate(y, +m[2], +m[1]);
    if (d && !m[3] && d < today) d = validDate(y + 1, +m[2], +m[1]);
    return hit(d, m);
  }
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})\\b(?:\\s+(\\d{4}))?`)))) {
    const y = m[3] ? +m[3] : today.getFullYear();
    let d = validDate(y, MONTHS[m[2]], +m[1]);
    if (d && !m[3] && d < today) d = validDate(y + 1, MONTHS[m[2]], +m[1]);
    return hit(d, m);
  }
  if ((m = t.match(/\b(?:tanggal|tgl\.?)\s*(\d{1,2})\b/))) {
    let d = validDate(today.getFullYear(), today.getMonth() + 1, +m[1]);
    if (d && d < today) { const n = new Date(today.getFullYear(), today.getMonth() + 1, 1); d = validDate(n.getFullYear(), n.getMonth() + 1, +m[1]); }
    return hit(d, m);
  }
  if ((m = t.match(/\b(hari ini|sekarang|saat ini|nanti)\b/))) return hit(today, m);
  if ((m = t.match(/\bbesok lusa\b|\blusa\b/))) return hit(addDays(today, 2), m);
  if ((m = t.match(/\b(besok|esok)\b/))) return hit(addDays(today, 1), m);
  // hari dalam pekan; "minggu depan"/"pekan depan" = pekan berikutnya
  const next = t.match(/\b(minggu|pekan) depan\b/);
  const t2 = next ? t.replace(next[0], ' '.repeat(next[0].length)) : t;
  const wd = t2.match(/\b(senin|selasa|rabu|kamis|jumat|sabtu|ahad)\b/) || t2.match(/\bhari (minggu)\b/) || t2.match(/(?<!(?:tiap|setiap|per) )\b(minggu)\b(?! (?:ini|lalu|kemarin))/);
  if (wd) {
    const target = DAYS[wd[1]];
    let d;
    if (next) { const mon = addDays(today, -((today.getDay() + 6) % 7) + 7); d = addDays(mon, (target + 6) % 7); }
    else if (/^\s*depan\b/.test(t2.slice(wd.index + wd[0].length))) {   // "Rabu depan" = Rabu pada pekan berikutnya
      const mon = addDays(today, -((today.getDay() + 6) % 7) + 7); d = addDays(mon, (target + 6) % 7);
    } else d = addDays(today, (target - today.getDay() + 7) % 7);   // "Rabu" = Rabu terdekat (hari ini bila sama)
    return { date: d, span: [wd.index, wd.index + wd[0].length], next: !!next };
  }
  if (next) return { date: addDays(today, 7), span: [next.index, next.index + next[0].length] };
  return { date: null };
  function hit(d, mm) { return { date: d, span: [mm.index, mm.index + mm[0].length], invalid: !d }; }
}

// ---------------- Pemahaman bahasa: jam ----------------
const POD = { pagi: ['07:30', '12:00'], siang: ['12:00', '15:00'], sore: ['15:00', '18:00'], malam: ['18:30', '21:00'] };
function adjustHour(h, pod) {
  if (pod === 'pagi') return h === 12 ? 0 : h;
  if (pod === 'siang') return h >= 1 && h <= 6 ? h + 12 : h;
  if (pod === 'sore' || pod === 'malam') return h < 12 ? h + 12 : h;
  return h >= 1 && h <= 6 ? h + 12 : h; // "jam 2" di kampus = 14.00
}
function findTime(t, now) {
  const podM = t.match(/\b(pagi|siang|sore|malam)\b/), pod = podM && podM[1];
  if (/\b(seharian|sehari penuh|satu hari|full day|sepanjang hari)\b/.test(t)) return { start: '07:00', end: '17:00', label: 'seharian' };
  const J = '(?:jam|pukul|pkl\\.?)';
  let m = t.match(new RegExp(`(${J}\\s*)?\\b(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:-|s\\.?\\s?d\\.?|sampai|hingga|sd|ke)\\s*(?:${J}\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?\\b(?!\\s*(?:orang|org|peserta|mahasiswa|mhs|kursi|pax|lantai))`));
  if (m && (m[1] || m[3] || m[5] || pod)) {
    let h1 = +m[2], h2 = +m[4];
    const mi1 = +(m[3] || 0), mi2 = +(m[5] || 0);
    const endPod = (t.slice(m.index + m[0].length).match(/^\s*(pagi|siang|sore|malam)\b/) || [])[1];
    h2 = adjustHour(h2, endPod || pod); h1 = adjustHour(h1, pod);
    if (h1 > h2 && h1 < 12 && h2 < 12) h2 += 12;
    if (!endPod && !pod && h1 > 12 && h2 < h1 && h2 + 12 > h1) h2 += 12;
    const r = { start: `${pad(h1)}:${pad(mi1)}`, end: `${pad(h2 % 24)}:${pad(mi2)}` };
    return valid(r) ? r : { invalid: true };
  }
  let start = null;
  if (/\b(sekarang|saat ini)\b/.test(t)) { const x = new Date(now); const mm = Math.ceil(x.getMinutes() / 5) * 5; start = fromMin(x.getHours() * 60 + mm); }
  m = t.match(new RegExp(`${J}\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\b`)) || t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) start = `${pad(adjustHour(+m[1], pod))}:${pad(+(m[2] || 0))}`;
  let dur = null, d;
  if ((d = t.match(/\b(?:selama\s+)?(\d+(?:[.,]5)?)\s*jam\b/)) && !(m && d.index === m.index)) dur = Math.round(parseFloat(d[1].replace(',', '.')) * 60);
  else if (/\bsetengah jam\b/.test(t)) dur = 30;
  else if ((d = t.match(/\b(\d{2,3})\s*menit\b/))) dur = +d[1];
  if (start) {
    const r = { start, end: fromMin(Math.min(toMin(start) + (dur || 120), 23 * 60 + 59)), defaultDuration: !dur };
    return valid(r) ? r : { invalid: true };
  }
  if (pod) return { start: POD[pod][0], end: POD[pod][1], label: pod };
  return {};
  function valid(r) { return /^\d{2}:\d{2}$/.test(r.start) && /^\d{2}:\d{2}$/.test(r.end) && toMin(r.start) < toMin(r.end) && toMin(r.end) <= 24 * 60; }
}

// ---------------- Filter lain ----------------
const CAT_ALIAS = [[/\b(lab|labs|laboratorium|lab komputer)\b/, 'laboratorium'], [/\b(aula|auditorium|hall|gedung pertemuan)\b/, 'aula'], [/\b(ruang rapat|rapat|meeting)\b/, 'rapat'],
  [/\b(kelas|ruang kuliah|ruang kelas)\b/, 'kelas'], [/\b(perpus|perpustakaan)\b/, 'perpustakaan']];
function findCategory(t, cats) {
  if (/\b(semua|apa saja|bebas|tanpa) kategori\b|\bkategori (apa saja|bebas|semua)\b|\bjenis apa saja\b/.test(t)) return { clear: true };
  const book = cats.filter(c => c.bookable);
  for (const c of book) if (t.includes(' ' + c.name.toLowerCase() + ' ') || t.includes(c.name.toLowerCase())) return { cat: c };
  for (const [re, key] of CAT_ALIAS) if (re.test(t)) { const c = book.find(x => x.name.toLowerCase().includes(key)); if (c) return { cat: c }; }
  return {};
}
const STOP = new Set(['yang', 'ini', 'itu', 'mana', 'apa', 'saja', 'kosong', 'untuk', 'di', 'ke', 'dan', 'besok', 'lantai']);
function findBuilding(t, blds) {
  if (/\b(semua|tanpa|bebas|gedung apa saja|di mana saja|dimana saja) gedung\b|\bgedung (apa saja|mana saja|bebas|semua)\b/.test(t)) return { clear: true };
  for (const b of blds) if (new RegExp(`\\b${b.code.toLowerCase().replace(/[-.]/g, '[-. ]?')}\\b`).test(t)) return { b };
  for (const b of blds) { const n = b.name.toLowerCase().replace(/\(.*?\)/g, '').trim(); if (n.length > 3 && t.includes(n)) return { b }; }
  const m = t.match(/\bgedung\s+([a-z0-9-]+)(?:\s+([a-z0-9-]+))?/);
  if (m && !STOP.has(m[1])) {
    const words = [m[1], m[2]].filter(w => w && !STOP.has(w) && w.length >= 1);
    const cand = blds.filter(b => { const n = (b.name + ' ' + b.code).toLowerCase(); return words.every(w => new RegExp(`\\b${w.replace(/[-.]/g, '\\$&')}`).test(n)); });
    if (cand.length === 1) return { b: cand[0] };
    if (cand.length > 1) return { ambiguous: cand };
    return { unknown: words.join(' ') };
  }
  return {};
}
function findCapacity(t) {
  if (/\btanpa (batas )?kapasitas\b|\bkapasitas (bebas|berapa saja)\b/.test(t)) return { clear: true };
  const m = t.match(/\b(\d{1,4})\s*(?:orang|org|peserta|mahasiswa|mhs|kursi|pax|people|audiens|undangan|hadirin)\b/) || t.match(/\b(?:kapasitas|muat|menampung|daya tampung)\s*(?:minimal|min\.?|minimum|>=|≥|sekitar|kurang lebih|\+-)?\s*(\d{1,4})\b/)
    || t.match(/\buntuk\s+(\d{2,4})\b(?!\s*(?:menit|jam|november|desember|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|\/))/);
  return m ? { n: +m[1] } : {};
}
function findRoomCode(t) {
  const re = new RegExp(`\\b(?:ruang(?:an)?|r\\.|kelas|lab)\\s+([a-z]{0,4}-?\\d{2,4}[a-z]?)\\b(?!\\s*(?:${MONTH_RE})\\b|\\s*[/:.]|\\s*(?:orang|org|peserta|mahasiswa|mhs|kursi|pax|jam|menit))`);
  const m = t.match(re);
  if (!m || !/\d/.test(m[1])) return null;
  if (/^\d+$/.test(m[1]) && m[1].length < 3) return null;   // "ruang 12" lebih mungkin tanggal/jumlah
  return m[1].toUpperCase();
}
function findRepeat(t, date, period) {
  if (!/\b(tiap|setiap|per) (minggu|pekan|hari (senin|selasa|rabu|kamis|jumat|sabtu)|senin|selasa|rabu|kamis|jumat|sabtu)\b|\bmingguan\b|\brutin\b|\bberulang\b/.test(t) && !/\bselama (\d+) (minggu|pekan)\b/.test(t) && !/\bsatu semester|selama semester|sepanjang semester\b/.test(t)) return {};
  let m;
  if ((m = t.match(/\bselama (\d+) (?:minggu|pekan)\b/)) && date) return { until: ymd(addDays(date, (Math.min(+m[1], 52) - 1) * 7)), weeks: +m[1] };
  if (/\bsatu semester|selama semester|sepanjang semester\b/.test(t) && period) return { until: period.end_date, semester: true };
  // kata "sampai" bisa milik rentang jam; ambil kemunculan yang diikuti tanggal
  for (const mm of [...t.matchAll(/\b(?:sampai|hingga|s\.?d\.?|sd)\s+(?=(.{3,40}))/g)].reverse()) {
    const u = findDate(' ' + mm[1].replace(/^dengan\s+/, '') + ' ', date || new Date());
    if (u.date && u.span && u.span[0] <= 2) return { until: ymd(u.date), cut: mm.index };
  }
  return { askUntil: true };
}

// Ekstraksi lengkap dari satu pesan
async function parse(text, now = new Date()) {
  const R = await refs();
  const t = normalize(text);
  const rep0 = /\b(tiap|setiap|per) (minggu|pekan|hari (senin|selasa|rabu|kamis|jumat|sabtu)|senin|selasa|rabu|kamis|jumat|sabtu)\b|\bmingguan\b|\brutin\b|\bberulang\b/.test(t);
  // bila berulang "… sampai <tanggal>", tanggal utama dicari sebelum kata "sampai"
  let main = t;
  if (rep0) { const k = t.search(new RegExp(`\\b(?:sampai|hingga|s\\.?d\\.?|sd)\\s+(?:dengan\\s+)?(?:tanggal\\s+)?(?:\\d{1,2}\\s+(?:${MONTH_RE})\\b|\\d{1,2}\\/|\\d{4}-|tanggal)`)); if (k > 0) main = t.slice(0, k) + ' '; }
  const dt = findDate(main, now);
  let tt = main;
  if (dt.span) tt = main.slice(0, dt.span[0]) + ' '.repeat(dt.span[1] - dt.span[0]) + main.slice(dt.span[1]);
  if (/\b(sekarang|saat ini)\b/.test(main) && !/\b(jam|pukul|pkl)\b|\d[:.]\d/.test(main)) tt += ' sekarang ';
  const tm = findTime(tt, now);
  const cat = findCategory(t, R.cats), bld = findBuilding(t, R.blds), cap = findCapacity(t), rep = findRepeat(t, dt.date, R.period);
  return { t, R, date: dt.date ? ymd(dt.date) : null, dateInvalid: dt.invalid, time: tm.start ? { start: tm.start, end: tm.end, label: tm.label, defaultDuration: tm.defaultDuration } : null,
    timeInvalid: tm.invalid, cat, bld, cap, room_code: findRoomCode(t), rep };
}

// ---------------- Pencarian ruang (dipakai kedua mode) ----------------
// q: { date, start, end, capacity, category_id, building_id, repeat_until, room_code }
async function runSearch(user, q, now = new Date()) {
  const R = await refs();
  if (!q.date || !q.start || !q.end) throw new Error('tanggal dan jam wajib');
  const start = new Date(`${q.date}T${q.start}:00`), end = new Date(`${q.date}T${q.end}:00`);
  if (!(start < end)) throw new Error('jam selesai harus setelah jam mulai');
  if (q.repeat_until && q.repeat_until < q.date) delete q.repeat_until;
  const notes = [];
  if (end < now) notes.push('Waktu tersebut sudah lewat.');
  const dow = ((start.getDay() + 6) % 7) + 1, op = R.op;
  if (op.days && !op.days.includes(dow)) notes.push(`${HARI[start.getDay()]} di luar hari operasional kampus.`);
  else if (op.start && op.end && (q.start < op.start || q.end > op.end)) notes.push(`Di luar jam operasional (${fmtTime(op.start)}–${fmtTime(op.end)}).`);
  const cat = q.category_id ? R.cats.find(c => c.id === Number(q.category_id)) : null, bld = q.building_id ? R.blds.find(b => b.id === Number(q.building_id)) : null;
  const filters = { start_at: start.toISOString(), end_at: end.toISOString(), capacity: q.capacity || undefined, category_id: q.category_id || undefined, building_id: q.building_id || undefined, repeat_until: q.repeat_until || undefined };
  const label = `${fmtDate(q.date)}, ${fmtTime(q.start)}–${fmtTime(q.end)}` + (q.repeat_until ? `, tiap pekan s.d. ${fmtDate(q.repeat_until)}` : '');
  const crit = [q.capacity ? `≥ ${q.capacity} orang` : null, cat ? cat.name : null, bld ? bld.name : null].filter(Boolean);
  const out = { label, crit, notes, filters, query: q };

  if (q.room_code) {   // satu ruang tertentu: kosong atau dipakai apa
    const p = [q.room_code.toUpperCase()]; let w = 'upper(r.code)=$1';
    if (q.building_id) { p.push(q.building_id); w += ` AND r.building_id=$2`; }
    const rooms = await db.q(`SELECT r.id, r.code, r.name, r.capacity, r.status, c.name category_name, c.color, c.bookable, b.name building_name, f.name floor_name, o.unit_id owner_unit_id, u.name owner_unit
      FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id JOIN buildings b ON b.id=r.building_id JOIN floors f ON f.id=r.floor_id
      LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id WHERE ${w} ORDER BY b.code LIMIT 5`, p);
    if (!rooms.length) return { ...out, roomNotFound: q.room_code };
    const occ = occurrences(filters.start_at, filters.end_at, filters.repeat_until);
    out.checked = [];
    for (const r of rooms) {
      const busy = await db.q(`SELECT e.title, e.start_at, e.end_at, un.name unit FROM events e LEFT JOIN units un ON un.id=e.unit_id WHERE e.room_id=$1 AND e.status='confirmed'
        AND tstzrange(e.start_at,e.end_at) && ANY($2::tstzrange[]) ORDER BY e.start_at LIMIT 10`, [r.id, occ.map(([s, e]) => `[${s.toISOString()},${e.toISOString()})`)]);
      out.checked.push({ ...r, mine: user.role === 'superadmin' || r.owner_unit_id === user.unit_id, free: !busy.length && r.status === 'aktif', busy, tooSmall: q.capacity && r.capacity < q.capacity });
    }
    return out;
  }
  out.rooms = await findFreeRooms(user, filters);
  return out;
}

// Ringkasan hasil untuk ditampilkan (teks) — mode dasar
function describe(res) {
  const crit = res.crit.length ? ` (${res.crit.join(', ')})` : '';
  const notes = res.notes.length ? '\n\n⚠ ' + res.notes.join(' ') : '';
  if (res.roomNotFound) return `Ruang dengan kode **${res.roomNotFound}** tidak ditemukan. Coba sebutkan kode yang ada di [Daftar ruang](#/ruang).`;
  if (res.checked) {
    return res.checked.map(r => {
      const nm = `**${r.code}** ${r.name} (${r.building_name})`;
      if (r.status !== 'aktif') return `${nm} sedang berstatus **${r.status}**, jadi tidak dapat dipakai.`;
      if (r.free) return `${nm} **kosong** pada ${res.label}.${r.tooSmall ? ` Namun kapasitasnya hanya ${r.capacity} orang.` : ''}${r.bookable === false ? ' Kategori ruang ini tidak dapat dipinjam.' : ''}`;
      return `${nm} **sudah terpakai** pada ${res.label}:\n` + r.busy.slice(0, 5).map(e => `- ${fmtTime(hm(e.start_at))}–${fmtTime(hm(e.end_at))} ${e.title}${e.unit ? ` (${e.unit})` : ''}${res.query.repeat_until ? ` · ${shortDate(e.start_at)}` : ''}`).join('\n');
    }).join('\n\n') + notes;
  }
  const n = res.rooms.length;
  if (!n) return `Tidak ada ruang kosong pada **${res.label}**${crit}.\nCoba geser jam, kurangi kapasitas, atau hapus filter kategori/gedung.` + notes;
  return `Ada **${n} ruang kosong** pada **${res.label}**${crit}.` + (n > 6 ? ' Berikut 6 teratas (urut kapasitas terdekat):' : '') + notes;
}
const hm = d => { const x = new Date(d); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const shortDate = d => { const x = new Date(d); return `${x.getDate()} ${BULAN[x.getMonth()].slice(0, 3)}`; };

// ---------------- Panduan fitur (pencocokan kata kunci) ----------------
const ROLE_NAME = { superadmin: 'Super Admin', unit_admin: 'Admin unit', pimpinan: 'Pimpinan' };
function kbMatch(t) {
  const scored = KB.map(e => {
    let s = 0;
    for (const k0 of e.keywords) {
      const k = k0.trim(), esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${esc}(?:nya|kan|an|i)?\\b`).test(t)) s += k.includes(' ') ? 3 : 1;
    }
    if (t.includes(e.title.toLowerCase())) s += 3;
    return { e, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  return scored;
}
function kbAnswer(e, user) {
  let a = e.answer;
  if (e.roles && !e.roles.includes(user.role)) a = `_Catatan: fitur ini hanya untuk ${e.roles.map(r => ROLE_NAME[r]).join(' dan ')}; akun Anda (${ROLE_NAME[user.role]}) hanya dapat melihat._\n\n` + a;
  return a;
}

// ---------------- Mode dasar ----------------
const HELLO = /^\s*(halo|hallo|hai|hi|hei|hey|pagi|siang|sore|malam|selamat (pagi|siang|sore|malam)|assalamu.?alaikum|permisi|rendra)\b[\s\w]{0,20}$/;
const THANKS = /\b(terima ?kasih|makasih|thanks|thank you|tengkyu|mantap|oke sip|sip)\b/;
const WHO = /\b(siapa (kamu|anda|rendra)|kamu siapa|bisa apa|apa yang bisa|bantu apa|fitur rendra)\b/;
const HOWTO = /\b(cara|bagaimana|gimana|bgmn|langkah|apa itu|fungsi|kegunaan|panduan|tutorial|menu apa|di ?mana|maksud|kenapa|mengapa|tidak bisa|gak bisa|nggak bisa|error|gagal)\b/;
const SEARCH = /\b(kosong|tersedia|available|bebas|nganggur|free|terpakai|dipakai|ada yang pakai|bisa dipakai)\b/;
const WANT = /\b(cari|carikan|carii|butuh|perlu|ada|pinjam|booking|pakai|cek|mau)\b/;
const ROOMW = /\b(ruang|ruangan|kelas|lab|laboratorium|aula|auditorium|tempat|room)\b/;

const CAPS = `Saya **Rendra**, asisten SARPRAS. Saya bisa:
- **mencarikan ruang kosong** berdasarkan tanggal, jam, kapasitas, kategori, dan gedung, termasuk kegiatan berulang tiap pekan;
- **mengecek** apakah ruang tertentu kosong atau sedang dipakai;
- **menjelaskan cara memakai fitur** aplikasi: denah, jadwal, peminjaman, penjadwalan kuliah, aset, opname, laporan, impor Excel.`;
const START_CHIPS = ['Ruang kosong besok jam 9 sampai 11', 'Lab untuk 30 orang Kamis siang', 'Cara meminjam ruang unit lain', 'Cara membuat jadwal kuliah otomatis'];
const TIME_CHIPS = ['Pagi (07.30–12.00)', 'Siang (12.00–15.00)', 'Sore (15.00–18.00)', 'Seharian'];

async function basic(user, text, state = {}, now = new Date()) {
  const p = await parse(text, now);
  const t = p.t;
  const prev = state && state.search ? { ...state.search } : null;
  const hasWhen = !!(p.date || p.time || p.rep.until);
  const filterOnly = p.cap.n || p.cap.clear || p.cat.cat || p.cat.clear || p.bld.b || p.bld.clear;
  const howto = HOWTO.test(t);
  const searchIntent = (SEARCH.test(t) && (ROOMW.test(t) || hasWhen || p.room_code)) || (WANT.test(t) && ROOMW.test(t) && (hasWhen || !howto)) || (hasWhen && ROOMW.test(t)) || (p.room_code && (hasWhen || SEARCH.test(t)));
  const refine = prev && !howto && (hasWhen || filterOnly || /\b(lagi|lainnya|yang lain|kalau|bagaimana kalau|gimana kalau|coba)\b/.test(t) && (hasWhen || filterOnly));

  if (!searchIntent && !refine) {
    if (HELLO.test(t)) return { reply: `Halo, ${user.name || user.username}! ` + CAPS + '\n\nSilakan tanya atau ketik kebutuhan ruang Anda.', suggestions: START_CHIPS, state: {} };
    if (THANKS.test(t) && t.length < 40) return { reply: 'Sama-sama! Kabari saya kalau butuh ruang lagi atau ada fitur yang ingin ditanyakan.', state };
    if (WHO.test(t)) return { reply: CAPS, suggestions: START_CHIPS, state };
    const m = kbMatch(t);
    if (m.length) {
      const top = m[0].e, rel = m.slice(1, 4).filter(x => x.s >= Math.max(1, m[0].s - 2)).map(x => x.e.title);
      return { reply: `**${top.title}**\n\n` + kbAnswer(top, user), suggestions: rel.length ? rel : undefined, state };
    }
    return { reply: 'Maaf, saya belum menangkap maksudnya. ' + CAPS + '\n\nContoh: *"aula kosong Jumat jam 13 sampai 16 untuk 80 orang"* atau *"cara stock opname"*.', suggestions: START_CHIPS, state };
  }

  // ----- pencarian ruang -----
  const q = refine ? { ...prev } : {};
  if (p.dateInvalid) return { reply: 'Tanggalnya tidak valid. Coba tulis seperti *12 November*, *12/11*, atau *Senin depan*.', state: { search: q } };
  if (p.timeInvalid) return { reply: 'Jamnya kurang jelas. Tulis seperti *jam 9 sampai 11*, *13.00–15.00*, atau *sore*.', state: { search: q } };
  if (p.date) q.date = p.date;
  if (p.time) { q.start = p.time.start; q.end = p.time.end; q.defaultDuration = p.time.defaultDuration; }
  if (p.cap.n) q.capacity = p.cap.n; if (p.cap.clear) delete q.capacity;
  if (p.cat.cat) q.category_id = p.cat.cat.id; if (p.cat.clear) delete q.category_id;
  if (p.bld.b) q.building_id = p.bld.b.id; if (p.bld.clear) delete q.building_id;
  if (p.room_code) q.room_code = p.room_code; else if (!refine) delete q.room_code;
  if (p.rep.until) q.repeat_until = p.rep.until;
  if (/\b(sekali saja|tidak berulang|tanpa berulang|sekali)\b/.test(t)) delete q.repeat_until;
  if (p.bld.ambiguous) return { reply: `Ada beberapa gedung yang cocok: ${p.bld.ambiguous.map(b => `**${b.name}** (${b.code})`).join(', ')}. Gedung yang mana?`, suggestions: p.bld.ambiguous.slice(0, 4).map(b => 'Gedung ' + b.code), state: { search: q } };
  if (p.bld.unknown) return { reply: `Saya tidak menemukan gedung "${p.bld.unknown}". Gedung yang terdaftar: ${p.R.blds.map(b => `${b.name} (${b.code})`).join(', ') || '(belum ada)'}.`, suggestions: p.R.blds.slice(0, 3).map(b => 'Gedung ' + b.code), state: { search: q } };
  if (!q.date && q.start) q.date = ymd(now);
  if (!q.date) return { reply: 'Untuk tanggal berapa? Misalnya *besok*, *Kamis*, atau *12 November*.', suggestions: ['Hari ini', 'Besok', 'Senin depan'], state: { search: q } };
  if (!q.start) return { reply: `Untuk ${fmtDate(q.date)}, jam berapa? Sebutkan jamnya (mis. *jam 9 sampai 11*) atau pilih:`, suggestions: TIME_CHIPS, state: { search: q } };
  if (p.rep.askUntil && !q.repeat_until) return { reply: 'Berulang tiap pekan sampai kapan? Misalnya *sampai 30 November*, *selama 8 pekan*, atau *satu semester*.', suggestions: ['Selama 4 pekan', 'Selama 8 pekan', 'Satu semester'], state: { search: q } };

  const res = await runSearch(user, q, now);
  let reply = describe(res);
  if (q.defaultDuration && p.time) reply = `_Durasi tidak disebut, saya anggap 2 jam (${fmtTime(q.start)}–${fmtTime(q.end)})._\n\n` + reply;
  const sug = [];
  if (res.rooms && !res.rooms.length) {
    if (q.category_id) sug.push('Semua kategori');
    if (q.building_id) sug.push('Semua gedung');
    if (q.capacity) sug.push('Tanpa kapasitas');
  }
  if (res.rooms || res.checked) {
    const s = toMin(q.start), e = toMin(q.end);
    if (e + 60 <= 21 * 60) sug.push(`Kalau jam ${fmtTime(fromMin(s + 60))}–${fmtTime(fromMin(e + 60))}?`);
    sug.push(`Kalau ${HARI[addDays(new Date(q.date + 'T00:00:00'), 1).getDay()]}?`);
  }
  return { reply, search: pack(res), suggestions: sug.slice(0, 3), state: { search: { ...q, defaultDuration: undefined } } };
}
// Data untuk kartu ruang di antarmuka (maks. 6 ditampilkan; tautan ke halaman lengkap)
function pack(res) {
  return { label: res.label, crit: res.crit, filters: res.filters, total: res.rooms ? res.rooms.length : undefined,
    rooms: (res.rooms || res.checked || []).slice(0, 6).map(r => ({ id: r.id, code: r.code, name: r.name, capacity: r.capacity, category_name: r.category_name, color: r.color,
      building_name: r.building_name, floor_name: r.floor_name, owner_unit: r.owner_unit, mine: r.mine, free: r.free !== false, busy: r.busy ? r.busy.length : 0 })) };
}

// ---------------- Mode AI (opsional) ----------------
const AI = { key: process.env.ANTHROPIC_API_KEY, model: process.env.RENDRA_MODEL || 'claude-haiku-5-5', base: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '') };
const aiEnabled = () => !!AI.key && process.env.RENDRA_AI !== 'off';
const TOOLS = [
  { name: 'cari_ruang_kosong', description: 'Mencari ruang yang kosong (tidak ada kegiatan) pada tanggal dan jam tertentu dari basis data SARPRAS. Bisa juga memeriksa satu ruang tertentu lewat kode_ruang. Selalu gunakan alat ini sebelum menyebut ruang tersedia; jangan menebak.',
    input_schema: { type: 'object', properties: {
      tanggal: { type: 'string', description: 'YYYY-MM-DD' }, jam_mulai: { type: 'string', description: 'HH:MM 24 jam' }, jam_selesai: { type: 'string', description: 'HH:MM 24 jam' },
      kapasitas: { type: 'integer', description: 'jumlah orang minimal' }, kategori: { type: 'string', description: 'nama kategori ruang persis dari daftar' }, gedung: { type: 'string', description: 'kode gedung dari daftar' },
      ulang_sampai: { type: 'string', description: 'YYYY-MM-DD bila berulang tiap pekan' }, kode_ruang: { type: 'string', description: 'isi bila menanyakan satu ruang tertentu' } },
    required: ['tanggal', 'jam_mulai', 'jam_selesai'] } },
  { name: 'panduan_fitur', description: 'Mengambil panduan resmi cara memakai fitur aplikasi SARPRAS berdasarkan topik.', input_schema: { type: 'object', properties: { topik: { type: 'string', enum: KB.map(k => k.id) } }, required: ['topik'] } },
];
function systemPrompt(user, R, now) {
  return `Anda adalah Rendra, asisten virtual aplikasi SARPRAS (Sistem Informasi Ruangan, Penjadwalan & Aset) di ${R.org.name || 'kampus'}. Jawab dalam bahasa Indonesia yang ramah, singkat, dan jelas.
Waktu sekarang: ${fmtDate(ymd(now))} pukul ${fmtTime(hm(now))} WIB (${ymd(now)}).
Pengguna: ${user.name || user.username}, peran ${ROLE_NAME[user.role]}${user.unit_name ? ', unit ' + user.unit_name : ''}.
Jam operasional: ${R.op.start}–${R.op.end}, hari ${(R.op.days || []).map(d => HARI[d % 7]).join(', ')}. Periode akademik aktif: ${R.period ? `${R.period.name} (${R.period.start_date} s.d. ${R.period.end_date})` : 'belum ada'}.
Kategori ruang yang dapat dipinjam: ${R.cats.filter(c => c.bookable).map(c => c.name).join(', ')}.
Gedung: ${R.blds.map(b => `${b.code} = ${b.name}`).join('; ') || 'belum ada'}.
Aturan:
- Untuk ketersediaan ruang, SELALU panggil cari_ruang_kosong. Ubah "besok", "Senin depan", "jam 2 siang" dsb. menjadi tanggal dan jam pasti. Jam tanpa keterangan 1–6 berarti siang/sore (13–18). Bila durasi tidak disebut, anggap 2 jam dan sebutkan anggapan itu.
- Bila tanggal atau jam tidak bisa disimpulkan, tanyakan singkat.
- Antarmuka akan menampilkan kartu ruang dari hasil pencarian terakhir lengkap dengan tombol buat kegiatan/ajukan pinjam, jadi cukup ringkas hasilnya (jumlah, beberapa ruang terbaik); jangan menyalin semua.
- Untuk pertanyaan cara memakai fitur, panggil panduan_fitur lalu jawab berdasarkan isinya. Jangan mengarang menu atau tombol yang tidak ada di panduan.
- Format: teks biasa, boleh **tebal**, daftar "- " atau "1. ", dan tautan internal [teks](#/rute) yang ada di panduan. Tanpa tabel dan tanpa judul.
- Tolak dengan sopan permintaan di luar SARPRAS, dan jangan mengubah data apa pun (Anda hanya membaca).`;
}
async function callClaude(body) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), Number(process.env.RENDRA_TIMEOUT_MS || 30000));
  try {
    const r = await fetch(`${AI.base}/v1/messages`, { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': AI.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`AI ${r.status}: ${(j.error && j.error.message) || 'gagal'}`);
    return j;
  } finally { clearTimeout(to); }
}
async function ai(user, history, now = new Date()) {
  const R = await refs();
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  let lastSearch = null;
  for (let step = 0; step < 5; step++) {
    const resp = await callClaude({ model: AI.model, max_tokens: 1024, system: systemPrompt(user, R, now), tools: TOOLS, messages });
    const uses = (resp.content || []).filter(b => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !uses.length) {
      const reply = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || 'Maaf, saya tidak dapat menjawab saat ini.';
      return { reply, search: lastSearch || undefined };
    }
    messages.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const u of uses) {
      let content;
      try {
        if (u.name === 'cari_ruang_kosong') {
          const x = u.input || {};
          const cat = x.kategori ? R.cats.find(c => c.name.toLowerCase() === String(x.kategori).toLowerCase()) : null;
          const bld = x.gedung ? R.blds.find(b => b.code.toLowerCase() === String(x.gedung).toLowerCase() || b.name.toLowerCase().includes(String(x.gedung).toLowerCase())) : null;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(x.tanggal || '') || !/^\d{2}:\d{2}$/.test(x.jam_mulai || '') || !/^\d{2}:\d{2}$/.test(x.jam_selesai || '')) throw new Error('format tanggal/jam tidak valid');
          const res = await runSearch(user, { date: x.tanggal, start: x.jam_mulai, end: x.jam_selesai, capacity: x.kapasitas, category_id: cat && cat.id, building_id: bld && bld.id, repeat_until: x.ulang_sampai, room_code: x.kode_ruang }, now);
          lastSearch = res.roomNotFound ? null : pack(res);
          content = JSON.stringify(res.roomNotFound ? { ditemukan: false, pesan: `ruang ${res.roomNotFound} tidak ada` } : res.checked
            ? { waktu: res.label, catatan: res.notes, ruang: res.checked.map(r => ({ kode: r.code, nama: r.name, gedung: r.building_name, kapasitas: r.capacity, status: r.status, kosong: r.free, kegiatan: r.busy.map(e => ({ judul: e.title, mulai: hm(e.start_at), selesai: hm(e.end_at), unit: e.unit })) })) }
            : { waktu: res.label, kriteria: res.crit, catatan: res.notes, jumlah_kosong: res.rooms.length,
              ruang: res.rooms.slice(0, 15).map(r => ({ kode: r.code, nama: r.name, gedung: r.building_name, lantai: r.floor_name, kategori: r.category_name, kapasitas: r.capacity, pengelola: r.owner_unit, unit_sendiri: r.mine })) });
        } else if (u.name === 'panduan_fitur') {
          const e = KB.find(k => k.id === (u.input || {}).topik);
          content = e ? `${e.title}${e.roles ? ` (hanya untuk: ${e.roles.map(r => ROLE_NAME[r]).join(', ')})` : ''}\n${e.answer}` : 'topik tidak ditemukan';
        } else content = 'alat tidak dikenal';
      } catch (err) { content = 'Galat: ' + err.message; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'Maaf, permintaan ini terlalu rumit untuk saya proses. Coba sederhanakan pertanyaannya.', search: lastSearch || undefined };
}

// ---------------- Pintu masuk ----------------
async function chat(user, { messages = [], state = {} }, now = new Date()) {
  const hist = messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (hist.length && hist[0].role !== 'user') hist.shift();
  const last = hist[hist.length - 1];
  if (!last || last.role !== 'user') throw Object.assign(new Error('Pesan kosong'), { status: 400 });
  if (aiEnabled()) {
    try { return { ...(await ai(user, hist, now)), mode: 'ai' }; }
    catch (e) { console.error('Rendra AI:', e.message); const r = await basic(user, last.content, state, now); return { ...r, mode: 'dasar', note: 'Layanan AI sedang tidak tersedia; dijawab dengan mode dasar.' }; }
  }
  return { ...(await basic(user, last.content, state, now)), mode: 'dasar' };
}
module.exports = { chat, parse, basic, runSearch, aiEnabled, START_CHIPS, _clearCache: () => { refCache = null; } };
