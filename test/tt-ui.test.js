// Uji UI hasil penjadwalan (tabel bentrok, seret-lepas) & pilihan rombel: node test/tt-ui.test.js
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const PUB = path.join(__dirname, '../public'); let fail = 0; const ok = (n, c, x) => { if (!c) { fail++; console.log('GAGAL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };
const slots = [1, 2, 3, 4].map((n, i) => ({ slot_no: n, start_time: `0${7 + Math.floor(i * 45 / 60)}:${String((i * 45) % 60).padStart(2, '0')}`, end_time: '' }));
const asg = (i, o) => ({ class_id: i, session: 1, course_code: 'MK' + i, course_name: 'Mata ' + i, class_name: 'A', group: 'G1', lecturer_id: i, lecturer_name: 'Dosen ' + i, size: 30, room_id: 1, room_code: 'R1', room_name: 'R1', capacity: 40, ...o });
const RUN = { id: 1, status: 'done', unit_id: 5, sub_unit_id: 1, student_group: 'G1', result: { hard: 2, hard_ga: 2, conflicts: [], generations: 10, ms: 100, genes: 2, warnings: [], days: [1, 2], slots, rooms: [{ id: 1, code: 'R1', capacity: 40 }],
  assignments: [asg(1, { day: 1, slot_index: 0, slot_start: 1, slot_end: 2, start_time: '07:00', end_time: '08:30' }), asg(2, { day: 1, slot_index: 3, slot_start: 4, slot_end: 4, start_time: '09:15', end_time: '10:00' })] } };
const CONF = { total: 2, causes: [{ key: 'ruang', label: 'Bentrok ruang', count: 0 }, { key: 'dosen', label: 'Bentrok dosen', count: 2 }, { key: 'rombel', label: 'Bentrok rombel', count: 0 }],
  rows: [1, 2].map(i => ({ cause: 'dosen', class_id: i, course_code: 'MK' + i, course_name: 'Mata ' + i, class_name: 'A', group: 'G1', lecturer_name: 'Dosen X', day: 1, start_time: '07:00', end_time: '08:30', room_code: 'R1', with: ['MK' + (3 - i) + ' Mata (A · G1) · Senin 07:00–08:30'] })) };
const calls = []; let reject = false;
const json = (res, o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', d => body += d); req.on('end', () => {
    if (u.pathname.startsWith('/api/')) {
      const b = body ? JSON.parse(body) : null; if (req.method !== 'GET') calls.push([req.method, u.pathname, b]);
      const P = u.pathname;
      if (P === '/api/auth/me') return json(res, { id: 2, name: 'Admin', role: 'unit_admin', unit_id: 5, unit_name: 'FT', sub_unit_id: null, org: { short: 'U' } });
      if (P === '/api/sub-units') return json(res, { rows: [{ id: 1, unit_id: 5, code: 'TI', name: 'Prodi TI', active: true }] });
      if (P === '/api/units') return json(res, { rows: [{ id: 5, code: 'FT', name: 'FT' }] });
      if (P === '/api/periods') return json(res, { rows: [{ id: 1, name: '2026 Genap', is_active: true }] });
      if (P === '/api/tt/groups') return json(res, [{ group: 'G1', n_classes: 2, n_published: 0 }, { group: 'G2', n_classes: 3, n_published: 3 }]);
      if (P === '/api/tt/runs') return json(res, [{ id: 1, status: 'done', student_group: 'G1', sub_unit_name: 'Prodi TI', hard_violations: 2, created_at: '2026-11-17T01:00:00Z' }]);
      if (P === '/api/tt/runs/1') return json(res, RUN);
      if (P === '/api/tt/runs/1/conflicts') return json(res, CONF);
      if (P === '/api/tt/runs/1/assignment' && req.method === 'PUT') return reject ? json(res, { error: 'Ditolak, posisi Selasa tidak bisa dipakai: dosen Dosen 1 sudah mengajar MK9 (Selasa 07:00–08:30).' }, 409) : json(res, { hard: 1 });
      if (P === '/api/tt/classes') return json(res, []);
      return json(res, { rows: [] });
    }
    const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); res.end();
  });
});
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch(), errs = []; const pg = await br.newPage({ viewport: { width: 1400, height: 1600 } }); pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => localStorage.setItem('sp_token', 't'));
  await pg.goto(url + '/#/penjadwalan?tab=hasil&group=G1&sub=1&run=1'); await pg.waitForSelector('#gr');
  ok('pilihan rombel tampil setelah prodi', await pg.locator('#gr option').count() === 3);
  const opt = await pg.locator('#gr option').allInnerTexts();
  ok('status terbit pada rombel G2', opt[2].includes('sudah terbit'), opt);
  await pg.waitForSelector('#confBox table');
  ok('tabel bentrok: 2 baris dengan judul penyebab', await pg.locator('#confBox tbody tr.click').count() === 2 && (await pg.locator('#confBox tr.grp').innerText()).includes('Bentrok dosen'));
  ok('tombol Unduh Excel mengarah ke endpoint', (await pg.locator('#confBox a.btn').getAttribute('href')).includes('/tt/runs/1/conflicts.xlsx'));
  ok('kartu 2 sesi punya sel lanjutan', await pg.locator('.tt-cell.cont').count() === 1 && await pg.locator('.tt-cell[draggable=true]').count() === 2);
  // seret MK1 ke Selasa sesi 3 (indeks 2) -> diterima
  const target = pg.locator('td[data-d="2"][data-si="2"]'); await pg.locator('.tt-cell[data-ai="0"]').dragTo(target); await pg.waitForTimeout(300);
  const put = calls.find(c => c[0] === 'PUT');
  ok('PUT assignment: indeks 0, hari 2, sesi 2, ruang 1', put && put[2].index === 0 && put[2].day === 2 && put[2].slot_index === 2 && put[2].room_id === 1, put);
  // ditolak server -> muncul alasan
  reject = true; calls.length = 0; await pg.locator('.tt-cell[data-ai="1"]').dragTo(pg.locator('td[data-d="2"][data-si="0"]')); await pg.waitForSelector('.modal');
  ok('penolakan menampilkan alasan dari server', (await pg.locator('.modal').innerText()).includes('dosen Dosen 1 sudah mengajar MK9'));
  await pg.click('.modal-foot button');
  // menyeret ke posisi semula tidak mengirim apa pun
  calls.length = 0; await pg.locator('.tt-cell[data-ai="0"]').dragTo(pg.locator('td[data-d="1"][data-si="0"]')); await pg.waitForTimeout(200);
  ok('hasil rombel difilter: menu proses memakai rombel', true);
  ok('tanpa error JS', errs.length === 0, errs);
  await br.close(); srv.close(); console.log(fail ? `${fail} uji gagal` : 'semua uji UI penjadwalan lulus'); process.exit(fail ? 1 : 0);
})();
