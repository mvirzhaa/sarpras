// Uji UI aset tetap di ruangan + KIR: node test/room-ui.test.js
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const PUB = path.join(__dirname, '../public'); let fail = 0; const ok = (n, c, x) => { if (!c) { fail++; console.log('GAGAL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };
const ROOM = { id: 7, code: 'FAI-1.1', name: 'Ruang Kelas 1', building_name: 'Gedung FAI', floor_name: 'Lantai 1', floor_level: 1, capacity: 40, area: 56, status: 'aktif', category_name: 'Kelas', owner_unit: 'Fakultas Agama Islam', owner_head_name: 'Dr. Dekan', owner_head_nip: '123', can_manage: true, facilities: '', assets: { total: 2, value: 3000000, broken: 0 }, feedback: { total: 0 }, damages: [] };
const AS = [{ id: 1, tag: '3.05.01.001.0001', name: 'Proyektor', brand: 'Epson', model: 'X1', acquisition_date: '2024-03-01', price: 2000000, condition: 'baik', room_id: 7, room_code: 'FAI-1.1' },
  { id: 2, tag: '3.05.01.002.0001', name: 'Meja dosen', brand: '', acquisition_date: '2023-01-01', price: 1000000, condition: 'rusak_parah', room_id: 7, room_code: 'FAI-1.1' },
  { id: 3, tag: '3.05.01.003.0001', name: 'Papan tulis', brand: 'Sakura', acquisition_date: '2022-01-01', price: 500000, condition: 'baik', room_id: 8, room_code: 'FAI-1.2' },
  { id: 4, tag: '3.05.01.004.0001', name: 'AC split', acquisition_date: '2022-01-01', price: 4000000, condition: 'baru', room_id: null, room_code: null }];
const calls = []; const json = (res, o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', d => body += d); req.on('end', () => {
    if (u.pathname.startsWith('/api/')) {
      const b = body ? JSON.parse(body) : null; if (req.method !== 'GET') calls.push([req.method, u.pathname, b]); const P = u.pathname;
      if (P === '/api/auth/me') return json(res, { id: 1, name: 'SA', role: 'superadmin', org: { short: 'U', name: 'Universitas Ibn Khaldun' } });
      if (P === '/api/rooms/7') return json(res, ROOM);
      if (P === '/api/assets') return json(res, { rows: u.searchParams.get('room_id') === '7' ? AS.filter(a => a.room_id === 7) : AS, total: 4 });
      if (P === '/api/rooms') return json(res, { rows: [{ id: 7, code: 'FAI-1.1', name: 'K1' }, { id: 8, code: 'FAI-1.2', name: 'K2' }] });
      if (P === '/api/assets/dispose') return json(res, { id: 5 });
      if (P === '/api/assets' && req.method === 'POST') return json(res, { ids: [9] }, 201);
      if (P.endsWith('/condition') || P === '/api/mutations' || /^\/api\/assets\/\d+$/.test(P)) return json(res, { ok: true }, 201);
      return json(res, { rows: [] });
    }
    const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); res.end();
  });
});
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch(), errs = []; const ctx = await br.newContext({ viewport: { width: 1300, height: 1000 } });
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); await pg.addInitScript(() => localStorage.setItem('sp_token', 't'));
  await pg.goto(url + '/#/dashboard'); await pg.waitForSelector('#view *');
  await pg.evaluate(() => Pages.roomModal(7)); await pg.waitForSelector('#roomAssets table');
  ok('2 aset tampil di ruangan', await pg.locator('#roomAssets tbody tr').count() === 2);
  ok('ringkasan nilai & rusak', (await pg.locator('#roomAssets').innerText()).includes('2 aset') && (await pg.locator('#roomAssets .badge.bad').count()) >= 1);
  // ubah kondisi
  await pg.selectOption('[data-cond="1"]', 'rusak'); await pg.waitForSelector('[name=condition]');
  await pg.fill('[name=note]', 'lampu mati'); await pg.click('.modal-foot .primary'); await pg.waitForTimeout(250);
  const c1 = calls.find(c => c[1] === '/api/assets/1/condition');
  ok('POST kondisi aset', c1 && c1[2].condition === 'rusak' && c1[2].note === 'lampu mati', c1);
  // tambah dari daftar aset
  calls.length = 0; await pg.click('#raAdd'); await pg.waitForSelector('#pbody tr');
  ok('picker: aset di ruang ini tidak ditawarkan (2 aset lain)', await pg.locator('#pbody tr').count() === 2);
  await pg.check('#pfree'); ok('filter belum punya ruang: 1 aset', await pg.locator('#pbody tr').count() === 1);
  await pg.check('[data-a="4"]'); await pg.click('.modal-foot .primary'); await pg.waitForTimeout(250);
  const m1 = calls.find(c => c[1] === '/api/mutations');
  ok('POST mutasi ke ruang 7', m1 && m1[2].to_room_id === 7 && m1[2].asset_ids.length === 1 && m1[2].asset_ids[0] === 4, m1);
  // tambah aset baru, ubah, pindah, hapus
  calls.length = 0; await pg.click('#raNew'); await pg.waitForSelector('[name=name]'); await pg.fill('[name=name]', 'Kursi'); await pg.evaluate(() => { const h = document.querySelector('[name=asset_code_id]'); if (h) h.value = '12'; });
  await pg.click('.modal-foot .primary'); await pg.waitForTimeout(250);
  const n1 = calls.find(c => c[1] === '/api/assets' && c[0] === 'POST');
  ok('POST aset baru dikunci ke ruang 7', n1 && n1[2].room_id === 7 && n1[2].name === 'Kursi', n1);
  await pg.evaluate(() => { const m = document.querySelectorAll('.modal-bg'); if (m.length > 1) m[m.length - 1].remove(); });
  await pg.click('[data-edit="1"]'); await pg.waitForSelector('[name=name]'); await pg.fill('[name=name]', 'Proyektor 2'); await pg.click('.modal-foot .primary'); await pg.waitForTimeout(250);
  ok('PUT ubah aset', calls.some(c => c[0] === 'PUT' && c[1] === '/api/assets/1' && c[2].name === 'Proyektor 2'));
  await pg.click('[data-move="2"]'); await pg.waitForSelector('[name=to_room_id]'); await pg.selectOption('[name=to_room_id]', '8'); await pg.click('.modal-foot .primary'); await pg.waitForTimeout(250);
  ok('mutasi pindah ruang', calls.some(c => c[1] === '/api/mutations' && c[2].to_room_id === 8 && c[2].asset_ids[0] === 2));
  await pg.click('[data-del="2"]'); await pg.waitForSelector('.modal');
  ok('hapus aset membuka formulir penghapusan', (await pg.locator('.modal[aria-label^="Hapuskan"]').count()) === 1);
  await pg.evaluate(() => { const m = document.querySelectorAll('.modal-bg'); m[m.length - 1].remove(); });
  // KIR
  const [kir] = await Promise.all([ctx.waitForEvent('page'), pg.click('#raKir')]); await kir.waitForLoadState();
  const t = await kir.locator('body').innerText();
  ok('KIR memuat judul, ruang, aset, dan pejabat', t.includes('KARTU INVENTARIS RUANGAN') && t.includes('FAI-1.1') && t.includes('Proyektor') && t.includes('Dr. Dekan'), t.slice(0, 200));
  ok('KIR: kolom keadaan barang (RB untuk rusak parah)', (await kir.locator('table').nth(1).locator('tbody tr').nth(1).locator('td').nth(10).innerText()).trim() === '✓');
  ok('tanpa error JS', errs.length === 0, errs);
  await br.close(); srv.close(); console.log(fail ? `${fail} uji gagal` : 'semua uji UI ruang & KIR lulus'); process.exit(fail ? 1 : 0);
})();
