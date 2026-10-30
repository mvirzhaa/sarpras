const express = require('express');
const ExcelJS = require('exceljs');
const { db } = require('../db');
const { ah, fail } = require('../util');
const { seesAll } = require('../auth');
const { BOOK, ACC } = require('./assets');

const r = express.Router();
const COND = { baru: 'Baru', baik: 'Baik', rusak: 'Rusak', diperbaiki: 'Diperbaiki', rusak_parah: 'Rusak Parah' };

async function opSettings() {
  const s = await db.one(`SELECT value FROM settings WHERE key='operational'`);
  const v = s ? s.value : { days: [1, 2, 3, 4, 5, 6], start: '07:00', end: '21:00' };
  const [h1, m1] = v.start.split(':').map(Number), [h2, m2] = v.end.split(':').map(Number);
  return { ...v, hours: (h2 * 60 + m2 - h1 * 60 - m1) / 60 };
}
function opDays(from, to, days) { // jumlah hari operasional [from, to)
  let n = 0;
  for (let d = new Date(from + 'T00:00:00'); d < new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const iso = d.getDay() === 0 ? 7 : d.getDay();
    if (days.includes(iso)) n++;
  }
  return n;
}
// Lingkup unit: admin unit dipaksa ke unitnya
const unitOf = (req) => (seesAll(req.user) ? (req.query.unit_id ? Number(req.query.unit_id) : null) : req.user.unit_id);
const roomFilter = (unitId, col, p) => (unitId ? (p.push(unitId), `${col} IN (SELECT room_id FROM v_room_owner WHERE unit_id=$${p.length})`) : 'TRUE');
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

async function utilization(from, to, unitId) {
  const op = await opSettings(), nd = opDays(from, to, op.days), cap = Math.max(1, nd * op.hours);
  const p = [from, to];
  const rows = await db.q(`SELECT r.id, r.code, r.name, b.name building, c.name category, u.name unit, r.capacity,
      count(e.id) events,
      COALESCE(round((sum(extract(epoch FROM (LEAST(e.end_at, $2::date::timestamptz) - GREATEST(e.start_at, $1::date::timestamptz))))/3600.0)::numeric, 1), 0) hours,
      count(e.id) FILTER (WHERE e.event_type='kuliah') lectures
    FROM rooms r JOIN buildings b ON b.id=r.building_id LEFT JOIN room_categories c ON c.id=r.category_id
    LEFT JOIN v_room_owner o ON o.room_id=r.id LEFT JOIN units u ON u.id=o.unit_id
    LEFT JOIN events e ON e.room_id=r.id AND e.status='confirmed' AND e.start_at < $2::date AND e.end_at > $1::date
    WHERE COALESCE(c.bookable, true) AND ${roomFilter(unitId, 'r.id', p)}
    GROUP BY r.id, b.name, c.name, u.name ORDER BY b.name, r.code`, p);
  rows.forEach(x => { x.utilization = Math.round(1000 * x.hours / cap) / 10; });
  return { rows, capacity_hours: cap, op_days: nd };
}

// ---------------- Dashboard ----------------
r.get('/dashboard', ah(async (req, res) => {
  const unitId = unitOf(req), d = req.query.date || today(), p1 = [], p2 = [];
  const rf = roomFilter(unitId, 'r.id', p1);
  const rooms = await db.one(`SELECT count(*) total, count(*) FILTER (WHERE r.status='perbaikan') repair, COALESCE(sum(capacity),0) seats
    FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id WHERE COALESCE(c.bookable,true) AND ${rf}`, p1);
  const now = await db.one(`SELECT count(DISTINCT e.room_id) busy FROM events e JOIN rooms r ON r.id=e.room_id
    WHERE e.status='confirmed' AND e.start_at<=now() AND e.end_at>now() AND ${roomFilter(unitId, 'r.id', p2)}`, p2);
  const util7 = await utilization(addDays(d, -6), addDays(d, 1), unitId);
  const utilToday = await utilization(d, addDays(d, 1), unitId);
  const p3 = [d]; const rf3 = roomFilter(unitId, 'e.room_id', p3);
  const trend = await db.q(`SELECT g::date AS "day", (SELECT count(*) FROM events e WHERE e.status='confirmed' AND e.start_at::date=g::date AND ${rf3}) events
    FROM generate_series(($1::date - 29)::timestamp, $1::date::timestamp, '1 day'::interval) g ORDER BY 1`, p3);
  const p4 = []; const rf4 = roomFilter(unitId, 'f.room_id', p4);
  const fb = await db.one(`SELECT count(*) FILTER (WHERE status='baru') new, count(*) FILTER (WHERE status='diproses') process,
      count(*) FILTER (WHERE created_at > now()-interval '30 days') month, round(avg(rating) FILTER (WHERE created_at > now()-interval '90 days'),2) rating
    FROM feedbacks f WHERE ${rf4}`, p4);
  const p5 = []; const rf5 = roomFilter(unitId, 'd.room_id', p5);
  const dmg = await db.one(`SELECT count(*) FILTER (WHERE status IN ('dilaporkan','diproses')) open, count(*) FILTER (WHERE status IN ('dilaporkan','diproses') AND severity='berat') severe,
      round((avg(extract(epoch FROM resolved_at-reported_at)/86400) FILTER (WHERE resolved_at IS NOT NULL))::numeric,1) avg_days FROM room_damages d WHERE ${rf5}`, p5);
  const p6 = []; const aw = unitId ? (p6.push(unitId), `(a.unit_id=$1 OR a.room_id IN (SELECT room_id FROM v_room_owner WHERE unit_id=$1))`) : 'TRUE';
  const assets = await db.one(`SELECT count(*) total, COALESCE(sum(a.price),0) value, COALESCE(sum(${BOOK}),0) book FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id WHERE a.status='aktif' AND ${aw}`, p6);
  const cond = await db.q(`SELECT a.condition, count(*) n FROM assets a WHERE a.status='aktif' AND ${aw} GROUP BY 1`, p6);
  const p7 = unitId ? [unitId] : [];
  const pending = await db.one(`SELECT count(*) n FROM booking_requests WHERE status='pending' ${unitId ? 'AND owner_unit_id=$1' : ''}`, p7);
  const p8 = []; const rf8 = roomFilter(unitId, 'f.room_id', p8);
  const topComplaints = await db.q(`SELECT r.code, r.name, count(*) n FROM feedbacks f JOIN rooms r ON r.id=f.room_id
    WHERE f.kind IN ('keluhan','kerusakan') AND f.created_at > now()-interval '90 days' AND ${rf8} GROUP BY r.id ORDER BY n DESC LIMIT 5`, p8);
  const avg = a => (a.length ? Math.round(10 * a.reduce((s, x) => s + x.utilization, 0) / a.length) / 10 : 0);
  res.json({
    date: d, rooms, busy_now: now.busy, util_today: avg(utilToday.rows), util_7d: avg(util7.rows),
    top_rooms: [...util7.rows].sort((a, b) => b.utilization - a.utilization).slice(0, 8),
    idle_rooms: [...util7.rows].sort((a, b) => a.utilization - b.utilization).slice(0, 8),
    trend, feedback: fb, damages: dmg, assets, conditions: cond.map(x => ({ ...x, label: COND[x.condition] })), pending: pending.n, top_complaints: topComplaints,
  });
}));

// ---------------- Laporan ----------------
const C = (key, label, type) => ({ key, label, type });
async function buildReport(kind, req) {
  const unitId = unitOf(req), unit = unitId ? await db.one('SELECT name FROM units WHERE id=$1', [unitId]) : null;
  let from, to, title;
  if (kind === 'harian') { from = req.query.date || today(); to = addDays(from, 1); title = 'Laporan Harian'; }
  else if (kind === 'bulanan') { const m = req.query.month || today().slice(0, 7); from = m + '-01'; const x = new Date(from + 'T00:00:00'); x.setMonth(x.getMonth() + 1); to = x.toISOString().slice(0, 10); title = 'Laporan Bulanan'; }
  else if (kind === 'penyusutan') return depreciationReport(req, unitId, unit);
  else if (kind === 'semester') {
    const per = req.query.period_id ? await db.one('SELECT * FROM academic_periods WHERE id=$1', [req.query.period_id]) : await db.one('SELECT * FROM academic_periods WHERE is_active');
    if (!per) fail(400, 'Periode akademik tidak ditemukan');
    from = per.start_date; to = addDays(per.end_date, 1); title = `Laporan Semester ${per.name}`;
  } else fail(404, 'Jenis laporan tidak dikenal');
  const S = [], ev = [from, to];
  const util = await utilization(from, to, unitId);
  S.push({ title: 'Rekap penggunaan ruangan', note: `Kapasitas waktu: ${util.op_days} hari operasional × jam operasional = ${util.capacity_hours} jam per ruang`,
    columns: [C('code', 'Kode'), C('name', 'Ruang'), C('building', 'Gedung'), C('category', 'Kategori'), C('unit', 'Unit pengelola'), C('events', 'Jumlah kegiatan', 'num'), C('lectures', 'Kuliah', 'num'), C('hours', 'Jam terpakai', 'num'), C('utilization', 'Utilisasi (%)', 'pct')],
    rows: util.rows });

  if (kind === 'harian') {
    const p = [...ev];
    S.push({ title: 'Daftar kegiatan', columns: [C('start', 'Mulai'), C('end', 'Selesai'), C('room', 'Ruang'), C('title', 'Kegiatan'), C('event_type', 'Jenis'), C('unit', 'Penyelenggara'), C('lecturer', 'Dosen')],
      rows: await db.q(`SELECT to_char(e.start_at,'HH24:MI') start, to_char(e.end_at,'HH24:MI') "end", r.code room, e.title, e.event_type, u.name unit, pp.name lecturer
        FROM events e JOIN rooms r ON r.id=e.room_id LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN people pp ON pp.id=e.lecturer_id
        WHERE e.status='confirmed' AND e.start_at < $2::date AND e.end_at > $1::date AND ${roomFilter(unitId, 'e.room_id', p)} ORDER BY e.start_at, r.code`, p) });
  } else {
    const p = [...ev];
    S.push({ title: 'Rekap per unit penyelenggara', columns: [C('unit', 'Unit penyelenggara'), C('events', 'Kegiatan', 'num'), C('lectures', 'Kuliah', 'num'), C('hours', 'Total jam', 'num'), C('other_unit_rooms', 'Memakai ruang unit lain', 'num')],
      rows: await db.q(`SELECT COALESCE(u.name,'(tanpa unit)') unit, count(*) events, count(*) FILTER (WHERE e.event_type='kuliah') lectures,
          round((sum(extract(epoch FROM e.end_at-e.start_at))/3600.0)::numeric,1) hours, count(*) FILTER (WHERE o.unit_id IS DISTINCT FROM e.unit_id) other_unit_rooms
        FROM events e LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN v_room_owner o ON o.room_id=e.room_id
        WHERE e.status='confirmed' AND e.start_at < $2::date AND e.end_at > $1::date AND ${roomFilter(unitId, 'e.room_id', p)} GROUP BY u.name ORDER BY events DESC`, p) });
  }
  if (kind === 'semester') {
    const p = [...ev];
    S.push({ title: 'Beban mengajar dosen (dari jadwal terpublikasi)', columns: [C('lecturer', 'Dosen'), C('classes', 'Kelas', 'num'), C('meetings', 'Pertemuan', 'num'), C('hours', 'Jam', 'num')],
      rows: await db.q(`SELECT pp.name lecturer, count(DISTINCT e.tt_class_id) classes, count(*) meetings, round((sum(extract(epoch FROM e.end_at-e.start_at))/3600.0)::numeric,1) hours
        FROM events e JOIN people pp ON pp.id=e.lecturer_id WHERE e.status='confirmed' AND e.event_type='kuliah' AND e.start_at < $2::date AND e.end_at > $1::date
        AND ${roomFilter(unitId, 'e.room_id', p)} GROUP BY pp.name ORDER BY hours DESC`, p) });
  }
  {
    const p = [...ev], w = unitId ? (p.push(unitId), `(b.owner_unit_id=$3 OR b.requester_unit_id=$3)`) : 'TRUE';
    S.push({ title: 'Peminjaman ruang antar unit', columns: [C('code', 'No.'), C('date', 'Tanggal'), C('room', 'Ruang'), C('owner', 'Pengelola'), C('requester', 'Peminjam'), C('title', 'Kegiatan'), C('status', 'Status')],
      rows: await db.q(`SELECT b.code, to_char(b.start_at,'DD/MM/YYYY HH24:MI') date, r.code room, ou.name owner, ru.name requester, b.title, b.status
        FROM booking_requests b JOIN rooms r ON r.id=b.room_id LEFT JOIN units ou ON ou.id=b.owner_unit_id LEFT JOIN units ru ON ru.id=b.requester_unit_id
        WHERE b.start_at < $2::date AND b.end_at > $1::date AND ${w} ORDER BY b.start_at`, p) });
  }
  {
    const p = [...ev], rf = roomFilter(unitId, 'f.room_id', p);
    if (kind === 'harian') {
      S.push({ title: 'Masukan & keluhan ruangan', columns: [C('ticket', 'Tiket'), C('room', 'Ruang'), C('kind', 'Jenis'), C('rating', 'Nilai', 'num'), C('message', 'Isi'), C('status', 'Status')],
        rows: await db.q(`SELECT f.ticket, r.code room, f.kind, f.rating, f.message, f.status FROM feedbacks f JOIN rooms r ON r.id=f.room_id
          WHERE f.created_at >= $1::date AND f.created_at < $2::date AND ${rf} ORDER BY f.created_at`, p) });
    } else {
      S.push({ title: 'Rekap masukan & keluhan per ruangan', columns: [C('room', 'Ruang'), C('building', 'Gedung'), C('saran', 'Saran', 'num'), C('keluhan', 'Keluhan', 'num'), C('kerusakan', 'Kerusakan', 'num'), C('apresiasi', 'Apresiasi', 'num'), C('rating', 'Rata-rata nilai', 'num'), C('done', 'Selesai', 'num')],
        rows: await db.q(`SELECT r.code room, b.name building, count(*) FILTER (WHERE kind='saran') saran, count(*) FILTER (WHERE kind='keluhan') keluhan,
            count(*) FILTER (WHERE kind='kerusakan') kerusakan, count(*) FILTER (WHERE kind='apresiasi') apresiasi, round(avg(rating),2) rating, count(*) FILTER (WHERE f.status='selesai') done
          FROM feedbacks f JOIN rooms r ON r.id=f.room_id JOIN buildings b ON b.id=r.building_id WHERE f.created_at >= $1::date AND f.created_at < $2::date AND ${rf}
          GROUP BY r.code, b.name ORDER BY count(*) DESC`, p) });
    }
  }
  {
    const p = [...ev];
    S.push({ title: 'Kerusakan ruangan', columns: [C('date', 'Dilaporkan'), C('room', 'Ruang'), C('title', 'Kerusakan'), C('severity', 'Tingkat'), C('status', 'Status'), C('actual_cost', 'Biaya', 'money'), C('resolved', 'Selesai')],
      rows: await db.q(`SELECT to_char(d.reported_at,'DD/MM/YYYY') date, r.code room, d.title, d.severity, d.status, d.actual_cost, to_char(d.resolved_at,'DD/MM/YYYY') resolved
        FROM room_damages d JOIN rooms r ON r.id=d.room_id WHERE ((d.reported_at >= $1::date AND d.reported_at < $2::date) OR (d.resolved_at >= $1::date AND d.resolved_at < $2::date))
        AND ${roomFilter(unitId, 'd.room_id', p)} ORDER BY d.reported_at`, p) });
  }
  {
    const p = [...ev], aw = unitId ? (p.push(unitId), `(a.unit_id=$3 OR a.room_id IN (SELECT room_id FROM v_room_owner WHERE unit_id=$3))`) : 'TRUE';
    S.push({ title: 'Mutasi & perubahan aset', columns: [C('date', 'Waktu'), C('tag', 'Kode aset'), C('name', 'Nama'), C('action', 'Kegiatan'), C('from', 'Dari'), C('to', 'Ke'), C('note', 'Keterangan'), C('user', 'Petugas')],
      rows: await db.q(`SELECT to_char(h.created_at,'DD/MM/YYYY HH24:MI') date, a.tag, a.name, h.action,
          concat_ws(' / ', fr.code, fh.name, h.from_condition) "from", concat_ws(' / ', tr.code, th.name, h.to_condition) "to", h.note, u.name "user"
        FROM asset_history h JOIN assets a ON a.id=h.asset_id LEFT JOIN rooms fr ON fr.id=h.from_room_id LEFT JOIN rooms tr ON tr.id=h.to_room_id
        LEFT JOIN people fh ON fh.id=h.from_holder_id LEFT JOIN people th ON th.id=h.to_holder_id LEFT JOIN users u ON u.id=h.user_id
        WHERE h.created_at >= $1::date AND h.created_at < $2::date AND h.action <> 'opname' AND ${aw} ORDER BY h.created_at LIMIT 3000`, p) });
    if (kind !== 'harian') {
      const p2 = unitId ? [unitId] : [], aw2 = unitId ? `(a.unit_id=$1 OR a.room_id IN (SELECT room_id FROM v_room_owner WHERE unit_id=$1))` : 'TRUE';
      S.push({ title: 'Posisi & valuasi aset per ruangan (per tanggal cetak)', columns: [C('room', 'Ruang'), C('building', 'Gedung'), C('qty', 'Jumlah', 'num'), C('baru', 'Baru', 'num'), C('baik', 'Baik', 'num'), C('rusak', 'Rusak', 'num'), C('diperbaiki', 'Diperbaiki', 'num'), C('rusak_parah', 'Rusak parah', 'num'), C('value', 'Nilai perolehan', 'money'), C('book', 'Nilai buku', 'money')],
        rows: await db.q(`SELECT COALESCE(r.code,'(pemegang)') room, b.name building, count(*) qty,
            count(*) FILTER (WHERE condition='baru') baru, count(*) FILTER (WHERE condition='baik') baik, count(*) FILTER (WHERE condition='rusak') rusak,
            count(*) FILTER (WHERE condition='diperbaiki') diperbaiki, count(*) FILTER (WHERE condition='rusak_parah') rusak_parah,
            sum(a.price) value, round(sum(${BOOK})) book
          FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN buildings b ON b.id=r.building_id
          WHERE a.status='aktif' AND ${aw2} GROUP BY r.code, b.name ORDER BY b.name NULLS LAST, r.code`, p2) });
      const p3 = [...ev], aw3 = unitId ? (p3.push(unitId), 'a.unit_id=$3') : 'TRUE';
      S.push({ title: 'Perolehan aset baru', columns: [C('tag', 'Kode aset'), C('name', 'Nama'), C('date', 'Tgl perolehan'), C('method', 'Cara'), C('room', 'Ruang'), C('price', 'Harga', 'money')],
        rows: await db.q(`SELECT a.tag, a.name, to_char(a.acquisition_date,'DD/MM/YYYY') date, a.acquisition_method method, r.code room, a.price
          FROM assets a LEFT JOIN rooms r ON r.id=a.room_id WHERE a.created_at >= $1::date AND a.created_at < $2::date AND ${aw3} ORDER BY a.tag`, p3) });
    }
  }
  if (kind === 'semester') {
    const dep = await depreciationReport({ query: { date: addDays(to, -1) } }, unitId, unit);
    S.push({ ...dep.sections[0], title: 'Penyusutan aset per bidang barang (akhir semester)' });
  }
  {
    const p = [...ev], w = unitId ? (p.push(unitId), 'c.unit_id=$3') : 'TRUE';
    S.push({ title: 'Barang persediaan (habis pakai)', columns: [C('name', 'Barang'), C('uom', 'Satuan'), C('in_qty', 'Masuk', 'num'), C('out_qty', 'Keluar', 'num'), C('stock', 'Stok akhir', 'num'), C('out_value', 'Nilai keluar', 'money')],
      rows: await db.q(`SELECT c.name, c.uom, COALESCE(sum(t.qty) FILTER (WHERE t.tx_type='masuk'),0) in_qty, COALESCE(sum(t.qty) FILTER (WHERE t.tx_type='keluar'),0) out_qty,
          c.stock, COALESCE(sum(t.qty*t.unit_price) FILTER (WHERE t.tx_type='keluar'),0) out_value
        FROM consumables c LEFT JOIN consumable_tx t ON t.consumable_id=c.id AND t.tx_date >= $1::date AND t.tx_date < $2::date
        WHERE ${w} GROUP BY c.id ORDER BY c.name`, p) });
  }
  {
    const p = [...ev], w = unitId ? (p.push(unitId), 'b.unit_id=$3') : 'TRUE';
    S.push({ title: 'Berita acara yang terbit', columns: [C('number', 'Nomor'), C('date', 'Tanggal'), C('ba_type', 'Jenis'), C('title', 'Perihal'), C('status', 'Status')],
      rows: await db.q(`SELECT b.number, to_char(b.ba_date,'DD/MM/YYYY') date, b.ba_type, b.title, b.status FROM berita_acara b
        WHERE b.ba_date >= $1::date AND b.ba_date < $2::date AND ${w} ORDER BY b.ba_date`, p) });
  }
  const org = await db.one(`SELECT value FROM settings WHERE key='org'`);
  return { title, unit: unit ? unit.name : 'Seluruh unit', from, to: addDays(to, -1), generated_at: new Date(), org: org ? org.value : {}, sections: S };
}

// Laporan penyusutan per tanggal acuan (akhir periode penyusutan terakhir yang selesai)
async function depreciationReport(req, unitId, unit) {
  const asOf = req.query.date || today();
  const pol = (await db.one(`SELECT dep_cfg() v`)).v, per = pol.period || 'semester';
  const ends = await db.one(`SELECT dep_last_end($1::date,$2) e, dep_idx_end(dep_idx(dep_last_end($1::date,$2),$2)-1,$2) prev`, [asOf, per]);
  const p = [ends.e, ends.prev], aw = unitId ? (p.push(unitId), `(a.unit_id=$3 OR a.room_id IN (SELECT room_id FROM v_room_owner WHERE unit_id=$3))`) : 'TRUE';
  const base = `FROM assets a JOIN asset_codes ac ON ac.id=a.asset_code_id
    LEFT JOIN LATERAL asset_dep(a.id, $1::date) d ON true LEFT JOIN LATERAL asset_dep(a.id, $2::date) d0 ON true
    WHERE a.acquisition_date <= $1::date AND (a.status='aktif' OR a.disposed_at > $1::date) AND ${aw}`;
  const perLabel = { bulan: 'bulan', semester: 'semester', tahun: 'tahun' }[per];
  const S = [];
  S.push({ title: 'Ringkasan penyusutan per bidang barang', note: `Metode garis lurus, periode ${perLabel}an, konvensi ${pol.convention === 'berikutnya' ? 'mulai periode berikutnya' : 'periode perolehan disusutkan penuh'}. Posisi per akhir periode ${ends.e}.`,
    columns: [C('bidang', 'Bidang barang'), C('qty', 'Jumlah', 'num'), C('value', 'Nilai perolehan', 'money'), C('expense', `Beban penyusutan ${perLabel} ini`, 'money'), C('acc', 'Akumulasi penyusutan', 'money'), C('book', 'Nilai buku', 'money')],
    rows: await db.q(`SELECT COALESCE(k.code || ' ' || k.name, '(lainnya)') bidang, count(*) qty, sum(a.price) value,
        sum(d.accumulated - COALESCE(d0.accumulated,0)) expense, sum(d.accumulated) acc, sum(d.book_value) book
      ${base.replace('LEFT JOIN LATERAL asset_dep(a.id, $1::date)', `LEFT JOIN asset_codes k ON k.level=2 AND ac.code LIKE k.code || '.%' LEFT JOIN LATERAL asset_dep(a.id, $1::date)`)}
      GROUP BY k.code, k.name ORDER BY k.code NULLS LAST`, p) });
  S.push({ title: 'Rincian penyusutan per aset', columns: [C('tag', 'Kode aset'), C('name', 'Nama'), C('acq', 'Tgl perolehan'), C('price', 'Nilai perolehan', 'money'), C('life', 'Masa manfaat (th)', 'num'),
      C('per_period', `Penyusutan per ${perLabel}`, 'money'), C('acc_prev', 'Akumulasi s.d. periode lalu', 'money'), C('expense', 'Beban periode ini', 'money'), C('acc', 'Akumulasi', 'money'), C('book', 'Nilai buku', 'money')],
    rows: await db.q(`SELECT a.tag, a.name, to_char(a.acquisition_date,'DD/MM/YYYY') acq, a.price, d.life, d.per_period, COALESCE(d0.accumulated,0) acc_prev,
        d.accumulated - COALESCE(d0.accumulated,0) expense, d.accumulated acc, d.book_value book ${base} AND d.depreciable ORDER BY ac.code, a.nup LIMIT 20000`, p) });
  S.push({ title: 'Aset tidak disusutkan', columns: [C('reason', 'Alasan'), C('qty', 'Jumlah', 'num'), C('value', 'Nilai', 'money')],
    rows: await db.q(`SELECT d.reason, count(*) qty, sum(a.price) value ${base} AND NOT d.depreciable GROUP BY d.reason ORDER BY 2 DESC`, p) });
  const org = await db.one(`SELECT value FROM settings WHERE key='org'`);
  return { title: 'Laporan Penyusutan Aset Tetap', unit: unit ? unit.name : 'Seluruh unit', from: ends.e, to: ends.e, generated_at: new Date(), org: org ? org.value : {}, sections: S };
}

r.get('/reports/:kind', ah(async (req, res) => {
  const rep = await buildReport(req.params.kind, req);
  if (req.query.format !== 'xlsx') return res.json(rep);
  const wb = new ExcelJS.Workbook(); wb.creator = 'SARPRAS';
  const used = new Set();
  for (const s of rep.sections) {
    let name = s.title.replace(/[\\/*?:[\]]/g, '').slice(0, 28); while (used.has(name)) name = name.slice(0, 26) + used.size; used.add(name);
    const ws = wb.addWorksheet(name);
    ws.addRow([`${rep.title} — ${rep.unit}`]).font = { bold: true, size: 13 };
    ws.addRow([`${s.title} | Periode ${rep.from} s.d. ${rep.to}`]);
    if (s.note) ws.addRow([s.note]);
    ws.addRow([]);
    const hr = ws.addRow(s.columns.map(c => c.label));
    hr.font = { bold: true }; hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EFE8' } }; c.border = { bottom: { style: 'thin' } }; });
    for (const row of s.rows) ws.addRow(s.columns.map(c => row[c.key] ?? ''));
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(50, Math.max(10, c.label.length + 2, ...s.rows.slice(0, 200).map(x => String(x[c.key] ?? '').length + 2)));
      if (c.type === 'money') col.numFmt = '#,##0';
    });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-${req.params.kind}-${rep.from}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

module.exports = r;
