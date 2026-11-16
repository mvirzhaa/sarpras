// Uji UI sub unit di Chromium dengan server tiruan: node test/subunit-ui.test.js
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const PUB = path.join(__dirname, '../public'); let fail = 0; const ok = (n, c, x) => { if (!c) { fail++; console.log('GAGAL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };
const SUBS = [{ id: 1, unit_id: 5, unit_code: 'FT', unit_name: 'Fakultas Teknik', code: 'TI', name: 'Program Studi Teknik Informatika', kind: 'prodi', active: true, class_count: 2, course_count: 3, admin_id: 9, admin_username: 'admin.ft.ti', admin_active: true, admin_ready: true },
  { id: 2, unit_id: 5, unit_code: 'FT', unit_name: 'Fakultas Teknik', code: 'SI', name: 'Program Studi Sistem Informasi', kind: 'prodi', active: true, class_count: 1, course_count: 1, admin_id: 10, admin_username: 'admin.ft.si', admin_active: false, admin_ready: false }];
const CLS = [{ id: 1, sub_unit_id: 1, sub_unit_name: 'Program Studi Teknik Informatika', course_code: 'IF101', course_name: 'Kalkulus', class_name: 'A', sessions_per_week: 1, duration_slots: 3, student_count: 40, tags: [] },
  { id: 2, sub_unit_id: 2, sub_unit_name: 'Program Studi Sistem Informasi', course_code: 'SI101', course_name: 'Pengantar SI', class_name: 'A', sessions_per_week: 1, duration_slots: 2, student_count: 30, tags: [] },
  { id: 3, sub_unit_id: null, sub_unit_name: null, course_code: 'UM101', course_name: 'Agama', class_name: 'A', sessions_per_week: 1, duration_slots: 2, student_count: 60, tags: [] }];
let me; const calls = [];
const json = (res, o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', d => body += d); req.on('end', () => {
    if (u.pathname.startsWith('/api/')) {
      const b = body && !body.startsWith('--') ? JSON.parse(body) : null; if (req.method !== 'GET') calls.push([req.method, u.pathname, b]);
      const sq = u.searchParams.get('sub_unit_id');
      if (u.pathname === '/api/auth/me') return json(res, me);
      if (u.pathname === '/api/sub-units') return json(res, { rows: SUBS });
      if (u.pathname === '/api/units') return json(res, { rows: [{ id: 5, code: 'FT', name: 'Fakultas Teknik' }] });
      if (u.pathname === '/api/periods') return json(res, { rows: [{ id: 1, name: '2026/2027 Ganjil', is_active: true }] });
      if (u.pathname === '/api/tt/classes') return json(res, CLS.filter(c => !sq || String(c.sub_unit_id) === sq));
      if (u.pathname === '/api/tt/runs') return json(res, []);
      if (u.pathname === '/api/tt/reset/preview') return json(res, { running: 0, events: 12, runs: 2, classes: 3, classes_total: 3 });
      if (u.pathname === '/api/tt/reset') return json(res, { events: 12, runs: 2, classes: 0 });
      return json(res, { rows: [] });
    }
    const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); res.end();
  });
});
const ME = { fak: { id: 2, name: 'Admin FT', role: 'unit_admin', unit_id: 5, unit_name: 'Fakultas Teknik', sub_unit_id: null, org: { short: 'UIKA' } },
  prodi: { id: 9, name: 'Admin TI', role: 'unit_admin', unit_id: 5, unit_name: 'Fakultas Teknik', sub_unit_id: 1, sub_unit_name: 'Program Studi Teknik Informatika', org: { short: 'UIKA' } },
  sa: { id: 1, name: 'SA', role: 'superadmin', org: { short: 'UIKA' } } };
(async () => {
  await new Promise(r => srv.listen(0, r)); const url = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch(); const errs = [];
  const open = async who => { me = ME[who]; const pg = await br.newPage({ viewport: { width: 1280, height: 800 } }); pg.on('pageerror', e => errs.push(who + ': ' + e.message)); pg.on('dialog', d => d.accept());
    await pg.addInitScript(() => localStorage.setItem('sp_token', 't')); return pg; };

  // --- Admin fakultas ---
  let pg = await open('fak');
  await pg.goto(url + '/#/penjadwalan'); await pg.waitForSelector('#su');
  ok('admin fakultas: pilihan sub unit tersedia (Seluruh unit + 2 prodi)', await pg.locator('#su option').count() === 3);
  await pg.waitForSelector('table.t');
  ok('seluruh unit: 3 kelas, kolom Sub unit tampil', await pg.locator('table.t tbody tr').count() === 3 && (await pg.locator('table.t thead').innerText()).includes('Sub unit'));
  ok('kelas tingkat unit diberi label', (await pg.locator('table.t').innerText()).includes('Tingkat unit'));
  await pg.selectOption('#su', '1'); await pg.waitForFunction(() => document.querySelectorAll('table.t tbody tr').length === 1);
  ok('filter prodi TI: 1 kelas, tanpa kolom Sub unit', !(await pg.locator('table.t thead').innerText()).includes('Sub unit'));
  await pg.click('#add'); await pg.waitForSelector('[name=sub_unit_id]');
  ok('form tambah kelas: sub unit terisi sesuai pilihan', await pg.inputValue('[name=sub_unit_id]') === '1');
  // reset jadwal: admin fakultas (tanpa opsi universitas)
  await pg.keyboard.press('Escape'); await pg.selectOption('#su', ''); await pg.click('#resetTt'); await pg.waitForSelector('#rsc');
  ok('reset fakultas: opsi cakupan unit & prodi saja', await pg.locator('#rsc option').count() === 2 && await pg.locator('#rsc option[value=all]').count() === 0);
  ok('tombol hapus nonaktif sebelum hitung dampak', await pg.locator('.modal-foot .danger').isDisabled());
  await pg.click('#rpv'); await pg.waitForSelector('#rim ul');
  ok('dampak tampil & tombol aktif', (await pg.locator('#rim').innerText()).includes('12') && await pg.locator('.modal-foot .danger').isEnabled());
  await pg.selectOption('#rsc', 'sub'); ok('ganti cakupan menonaktifkan tombol lagi', await pg.locator('.modal-foot .danger').isDisabled());
  await pg.selectOption('#rsub', '2'); await pg.click('#rpv'); await pg.waitForSelector('#rim ul'); await pg.locator('.modal-foot .danger').click(); await pg.waitForTimeout(250);
  const r1 = calls.find(x => x[1] === '/api/tt/reset');
  ok('POST /tt/reset: prodi SI, semester 1, kelas dipertahankan', r1 && r1[2].scope === 'sub' && r1[2].sub_unit_id === 2 && r1[2].period_id === 1 && r1[2].include_classes === false, r1);
  await pg.close();

  // --- Admin prodi ---
  pg = await open('prodi');
  await pg.goto(url + '/#/penjadwalan'); await pg.waitForSelector('table.t');
  ok('admin prodi: tanpa pilihan sub unit, nama prodi tampil', await pg.locator('#su').count() === 0 && (await pg.locator('.filters').innerText()).includes('Teknik Informatika'));
  ok('admin prodi hanya melihat kelas prodinya (permintaan memakai sub_unit_id=1)', await pg.locator('table.t tbody tr').count() === 1);
  await pg.click('#add'); await pg.waitForSelector('[name=class_name]');
  ok('form kelas admin prodi tidak punya pilihan sub unit', await pg.locator('[name=sub_unit_id]').count() === 0);
  await pg.keyboard.press('Escape'); await pg.click('#resetTt'); await pg.waitForSelector('#rsc');
  ok('reset admin prodi: hanya cakupan prodi sendiri', await pg.locator('#rsc option').count() === 1 && await pg.locator('#rsub').isDisabled());
  await pg.close();
  pg = await open('prodi'); await pg.goto(url + '/#/sub-unit'); await pg.waitForSelector('table.t');
  ok('halaman sub unit admin prodi: hanya prodinya, tanpa tombol tambah/akun admin', await pg.locator('table.t tbody tr').count() === 1 && await pg.locator('#add').count() === 0 && await pg.locator('[data-adm]').count() === 0);
  await pg.close();

  // --- Super Admin ---
  pg = await open('sa'); await pg.goto(url + '/#/sub-unit'); await pg.waitForSelector('table.t');
  ok('SA: 2 sub unit, tombol Masuk sebagai aktif untuk akun yang ada', await pg.locator('table.t tbody tr').count() === 2 && await pg.locator('[data-as]').count() === 2);
  await pg.click('#add'); await pg.waitForSelector('[name=code]');
  await pg.selectOption('[name=unit_id]', '5'); await pg.fill('[name=code]', 'mj'); await pg.fill('[name=name]', 'Prodi Manajemen');
  await pg.locator('.modal-foot .primary').click(); await pg.waitForTimeout(250);
  const c = calls.find(x => x[0] === 'POST' && x[1] === '/api/sub-units');
  ok('POST /sub-units membawa unit, kode, nama, jenis', c && Number(c[2].unit_id) === 5 && c[2].code === 'mj' && c[2].kind === 'prodi', c);
  ok('menu Sub unit ada di navigasi', await pg.locator('.nav a[href="#/sub-unit"]').count() === 1);
  await pg.close();
  // reset seluruh universitas oleh Super Admin: wajib ketik RESET
  pg = await open('sa'); await pg.goto(url + '/#/penjadwalan'); await pg.waitForSelector('#resetTt');
  await pg.click('#resetTt'); await pg.waitForSelector('#rsc');
  ok('SA: ada opsi seluruh universitas', await pg.locator('#rsc option[value=all]').count() === 1);
  await pg.selectOption('#rsc', 'all'); await pg.check('#rcl'); await pg.click('#rpv'); await pg.waitForSelector('#rim ul');
  calls.length = 0; await pg.locator('.modal-foot .danger').click(); await pg.waitForTimeout(250);
  ok('tanpa ketik RESET: tidak dikirim', !calls.find(x => x[1] === '/api/tt/reset'));
  await pg.fill('#rtx', 'RESET'); await pg.locator('.modal-foot .danger').click(); await pg.waitForTimeout(250);
  const r2 = calls.find(x => x[1] === '/api/tt/reset');
  ok('POST /tt/reset scope all + hapus kelas', r2 && r2[2].scope === 'all' && r2[2].include_classes === true && !r2[2].unit_id, r2);
  await pg.close();
  ok('tanpa error JS', errs.length === 0, errs);
  await br.close(); srv.close(); console.log(fail ? fail + ' uji gagal' : 'semua uji UI sub unit lulus'); process.exit(fail ? 1 : 0);
})();
