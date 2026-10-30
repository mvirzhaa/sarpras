/* ===== Master data, unit, pengguna, pengaturan, audit, laporan ===== */
'use strict';
function crudPage({ path, title, lead, endpoint, columns, fields, canWrite = () => App.isSA(), filters = [], refKey }) {
  route(new RegExp('^#\\/' + path.replace('/', '\\/') + '$'), async (view, _, q) => {
    const res = await API.get(endpoint, { ...q, limit: 5000 }), rows = res.rows || res, w = canWrite() && App.canWrite();
    const fs = typeof fields === 'function' ? await fields() : fields;
    view.innerHTML = App.head(title, lead, w ? `<button class="btn primary" id="add">${I('plus')} Tambah</button>` : '') +
      (filters.length ? `<div class="filters">${filters.map(f => f.type === 'search' ? `<input type="search" data-f="${f.name}" placeholder="${f.label}" value="${esc(q[f.name] || '')}">` : `<select data-f="${f.name}"><option value="">${f.label}</option>${UI.options(f.options, q[f.name])}</select>`).join('')}</div>` : '') +
      `<div class="panel">${UI.table({ rows, columns, rowAttr: r => (w ? `class="click" data-id="${r.id}"` : '') })}</div>`;
    bindFilters(view, '#/' + path, q);
    const done = () => { refKey && Ref.clear(refKey); App.render(); };
    if (!w) return;
    $('#add').onclick = () => UI.formModal({ title: 'Tambah ' + title.toLowerCase(), fields: fs, onSubmit: async v => { await API.post(endpoint, v); done(); } });
    view.onclick = e => {
      const tr = e.target.closest('[data-id]'); if (!tr) return;
      const r = rows.find(x => x.id === Number(tr.dataset.id));
      const m = UI.formModal({ title: 'Ubah data', fields: fs, values: { ...r, tags: Array.isArray(r.tags) ? r.tags.join(', ') : r.tags }, onSubmit: async v => { await API.put(`${endpoint}/${r.id}`, v); done(); } });
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Hapus'; del.style.marginRight = 'auto';
      del.onclick = async () => { if (await UI.confirm('Hapus data ini?', { danger: true, ok: 'Hapus' })) { try { await API.del(`${endpoint}/${r.id}`); m.close(); done(); } catch (er) { UI.err(er); } } };
      $('.modal-foot', m.el).prepend(del);
    };
  });
}
crudPage({ path: 'master/kategori', title: 'Kategori ruang', lead: 'Identitas jenis ruang. Warna dipakai di denah; "dapat dipinjam" menentukan ruang yang muncul di peminjaman, "penjadwalan kuliah" untuk algoritma.',
  endpoint: '/room-categories', refKey: 'categories',
  columns: [{ label: 'Kategori', render: c => `<i class="dot" style="background:${c.color}"></i><b>${esc(c.name)}</b>` }, { label: 'Dapat dipinjam', render: c => (c.bookable ? '✓' : '–') },
    { label: 'Penjadwalan kuliah', render: c => (c.schedulable ? '✓' : '–') }, { label: 'Urutan', num: true, key: 'sort' }, { label: 'Keterangan', key: 'description' }],
  fields: [{ name: 'name', label: 'Nama kategori', required: true }, { name: 'color', label: 'Warna di denah', type: 'color', default: '#8FA3A8' }, { name: 'sort', label: 'Urutan', type: 'number', default: 0 },
    { name: 'bookable', label: 'Dapat dipinjam / dijadwalkan kegiatan', type: 'checkbox', default: true }, { name: 'schedulable', label: 'Dipakai penjadwalan kuliah otomatis', type: 'checkbox' }, { name: 'description', label: 'Keterangan', type: 'textarea' }] });
crudPage({ path: 'master/orang', title: 'Dosen & pegawai', lead: 'Dipakai sebagai dosen pengampu di penjadwalan dan pemegang aset.', endpoint: '/people', refKey: 'people', canWrite: () => App.canWrite(),
  filters: [{ name: 'q', label: 'Cari nama / NIP / NIDN', type: 'search' }, { name: 'kind', label: 'Semua jenis', options: [['dosen', 'Dosen'], ['tendik', 'Tenaga kependidikan'], ['lainnya', 'Lainnya']].map(([a, b]) => ({ value: a, label: b })) }],
  columns: [{ label: 'Nama', render: p => `<b>${esc(p.name)}</b>` }, { label: 'NIP/NIDN', key: 'id_number' }, { label: 'Jenis', key: 'kind' }, { label: 'Jabatan', key: 'position' }, { label: 'Unit', key: 'unit_name' }, { label: 'Aktif', render: p => (p.active ? '✓' : '–') }],
  fields: async () => [{ name: 'name', label: 'Nama lengkap', required: true }, { name: 'id_number', label: 'NIP / NIDN / NIK' },
    { name: 'kind', label: 'Jenis', type: 'select', empty: false, options: [['dosen', 'Dosen'], ['tendik', 'Tenaga kependidikan'], ['lainnya', 'Lainnya']].map(([a, b]) => ({ value: a, label: b })) },
    { name: 'unit_id', label: 'Unit', type: 'select', options: await Ref.opts('units', u => u.name) }, { name: 'position', label: 'Jabatan' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Telepon' }, { name: 'active', label: 'Aktif', type: 'checkbox', default: true }] });
crudPage({ path: 'master/matkul', title: 'Mata kuliah', lead: 'Tag dipakai pada kendala penjadwalan, mis. "matematika" agar diutamakan di jam awal.', endpoint: '/courses', canWrite: () => App.canWrite(),
  filters: [{ name: 'q', label: 'Cari kode / nama', type: 'search' }],
  columns: [{ label: 'Kode', render: c => `<b class="mono">${esc(c.code)}</b>` }, { label: 'Nama', key: 'name' }, { label: 'SKS', num: true, key: 'credits' }, { label: 'Semester', num: true, key: 'semester_level' },
    { label: 'Tag', render: c => (c.tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join(' ') }, { label: 'Ruang disukai', key: 'category_name' }, { label: 'Unit', key: 'unit_name' }],
  fields: async () => [{ name: 'code', label: 'Kode MK', required: true }, { name: 'name', label: 'Nama MK', required: true }, { name: 'credits', label: 'SKS', type: 'number', default: 2 }, { name: 'semester_level', label: 'Semester', type: 'number' },
    { name: 'tags', label: 'Tag (pisahkan koma)', placeholder: 'matematika, praktikum' }, { name: 'unit_id', label: 'Unit/prodi', type: 'select', options: await Ref.opts('units', u => u.name) },
    { name: 'preferred_category_id', label: 'Kategori ruang yang disukai', type: 'select', options: await Ref.opts('categories', c => c.name) }] });
crudPage({ path: 'master/periode', title: 'Periode akademik', lead: 'Penjadwalan kuliah dan laporan semester mengacu ke periode ini.', endpoint: '/periods', refKey: 'periods',
  columns: [{ label: 'Periode', render: p => `<b>${esc(p.name)}</b> ${p.is_active ? '<span class="badge ok">aktif</span>' : ''}` }, { label: 'Mulai', render: p => fmt.date(p.start_date) }, { label: 'Selesai', render: p => fmt.date(p.end_date) }],
  fields: [{ name: 'name', label: 'Nama', required: true, placeholder: '2026/2027 Genap' }, { name: 'start_date', label: 'Mulai perkuliahan', type: 'date', required: true }, { name: 'end_date', label: 'Akhir perkuliahan', type: 'date', required: true }, { name: 'is_active', label: 'Jadikan periode aktif', type: 'checkbox' }] });
crudPage({ path: 'master/sesi', title: 'Sesi kuliah', lead: 'Jam pelajaran. Sesi yang tidak bersambung (ada jeda istirahat) tidak akan digabung dalam satu kelas.', endpoint: '/time-slots', refKey: 'slots',
  columns: [{ label: 'Sesi', num: true, key: 'slot_no' }, { label: 'Mulai', render: s => s.start_time.slice(0, 5) }, { label: 'Selesai', render: s => s.end_time.slice(0, 5) }],
  fields: [{ name: 'slot_no', label: 'Nomor sesi', type: 'number', required: true }, { name: 'start_time', label: 'Mulai', type: 'time', required: true }, { name: 'end_time', label: 'Selesai', type: 'time', required: true }] });

// ---------- Unit pengelola ----------
route(/^#\/unit$/, async view => {
  const [units, blds] = await Promise.all([API.get('/units').then(r => r.rows), Ref.get('buildings', true)]);
  const sa = App.isSA();
  view.innerHTML = App.head('Unit pengelola', 'Setiap unit otomatis memiliki akun admin. Akun aktif setelah Super Admin mengisi password. Tugaskan gedung atau ruang tertentu ke unit; penugasan per ruang mengalahkan penugasan per gedung.',
    sa ? `<button class="btn primary" id="add">${I('plus')} Buat unit</button>` : '') +
    `<div class="panel">${UI.table({ rows: units, empty: 'Belum ada unit.', columns: [{ label: 'Unit', render: u => `<b>${esc(u.name)}</b><br><small class="mono">${esc(u.code)}</small>` },
      { label: 'Gedung / ruang dikelola', render: u => `${esc(u.buildings || '–')}<br><small>${u.room_count} ruang efektif</small>` }, { label: 'Pimpinan', render: u => esc(u.head_name || '–') },
      { label: 'Akun admin', render: u => `<span class="mono">${esc(u.admin_username || '–')}</span><br>${u.admin_active ? '<span class="badge ok">Aktif</span>' : u.admin_ready ? '<span class="badge warn">Nonaktif</span>' : '<span class="badge warn">Belum diisi</span>'}` },
      ...(sa ? [{ label: '', render: u => `<div class="btn-row" style="justify-content:flex-end"><button class="btn sm" data-asg="${u.id}">Penugasan</button><button class="btn sm" data-adm="${u.id}">Akun admin</button><button class="btn sm ghost" data-ed="${u.id}">Ubah</button></div>` }] : [])] })}</div>`;
  if (!sa) return;
  const F = [{ name: 'code', label: 'Kode unit', required: true, placeholder: 'mis. FT, FEB, BAAK', help: 'Username admin: admin.<kode>' }, { name: 'name', label: 'Nama unit', required: true }, { name: 'head_name', label: 'Nama pimpinan unit' }, { name: 'head_nip', label: 'NIP pimpinan' },
    { name: 'email', label: 'Email unit', type: 'email' }, { name: 'phone', label: 'Telepon' }, { name: 'description', label: 'Keterangan', type: 'textarea' }];
  const done = () => { Ref.clear('units', 'rooms', 'myrooms'); App.render(); };
  $('#add').onclick = () => UI.formModal({ title: 'Buat unit pengelola', fields: F, onSubmit: async v => { const u = await API.post('/units', v); UI.toast(`Unit dibuat. Akun ${u.admin_username} menunggu password.`); done(); } });
  view.onclick = async e => {
    const ed = e.target.closest('[data-ed]'), adm = e.target.closest('[data-adm]'), asg = e.target.closest('[data-asg]');
    const u = units.find(x => x.id === Number((ed || adm || asg || {}).dataset?.[ed ? 'ed' : adm ? 'adm' : 'asg']));
    if (ed) { const m = UI.formModal({ title: 'Ubah unit', fields: F.filter(f => f.name !== 'code'), values: u, onSubmit: async v => { await API.put('/units/' + u.id, v); done(); } });
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Hapus unit'; del.style.marginRight = 'auto';
      del.onclick = async () => { if (await UI.confirm('Hapus unit beserta akun adminnya? Penugasan ruang ikut terhapus.', { danger: true })) { await API.del('/units/' + u.id).catch(UI.err); m.close(); done(); } }; $('.modal-foot', m.el).prepend(del); }
    if (adm) UI.formModal({ title: `Akun admin ${u.name}`, values: { username: u.admin_username, name: u.admin_name, email: u.admin_email, active: u.admin_active || !u.admin_ready },
      fields: [{ name: 'username', label: 'Username', required: true }, { name: 'name', label: 'Nama admin' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Telepon' },
        { name: 'password', label: u.admin_ready ? 'Password baru (kosongkan bila tidak diubah)' : 'Password awal (min. 8 karakter)', type: 'password', required: !u.admin_ready }, { name: 'active', label: 'Akun aktif', type: 'checkbox' }],
      extra: '<p class="muted" style="margin-top:10px">Admin wajib mengganti password saat pertama masuk.</p>', onSubmit: async v => { if (!v.password) delete v.password; await API.put(`/units/${u.id}/admin`, v); done(); } });
    if (asg) {
      const cur = await API.get(`/units/${u.id}/assignments`), rooms = await Ref.get('rooms', true);
      const curB = cur.filter(a => a.building_id).map(a => a.building_id), curR = cur.filter(a => a.room_id).map(a => a.room_id);
      const m = UI.modal({ title: `Penugasan ${u.name}`, wide: true, body: `<div class="grid2"><div><h3 style="margin-bottom:8px">Seluruh gedung</h3>${blds.map(b => `<label class="check" style="display:flex"><input type="checkbox" class="ab" value="${b.id}" ${curB.includes(b.id) ? 'checked' : ''}>${esc(b.name)}</label>`).join('') || '<p class="muted">Belum ada gedung.</p>'}</div>
        <div><h3 style="margin-bottom:8px">Ruang tertentu</h3><input type="search" id="rq" placeholder="Saring ruang" style="margin-bottom:8px"><div style="max-height:360px;overflow-y:auto" id="rl">${rooms.map(r => `<label class="check" style="display:flex" data-t="${esc((r.code + ' ' + r.name + ' ' + r.building_name).toLowerCase())}"><input type="checkbox" class="ar" value="${r.id}" ${curR.includes(r.id) ? 'checked' : ''}><span class="mono">${esc(r.code)}</span> ${esc(r.name)} <small class="muted">${esc(r.building_name)}${r.owner_unit && r.owner_unit_id !== u.id ? ' · kini: ' + esc(r.owner_unit) : ''}</small></label>`).join('')}</div></div></div>`,
        actions: [{ label: 'Batal' }, { label: 'Simpan penugasan', kind: 'primary', onClick: async () => { await API.put(`/units/${u.id}/assignments`, { building_ids: $$('.ab:checked', m.el).map(x => Number(x.value)), room_ids: $$('.ar:checked', m.el).map(x => Number(x.value)) }); done(); } }] });
      $('#rq', m.el).oninput = e => $$('#rl [data-t]', m.el).forEach(l => (l.style.display = l.dataset.t.includes(e.target.value.toLowerCase()) ? 'flex' : 'none'));
    }
  };
});

// ---------- Pengguna ----------
route(/^#\/pengguna$/, async view => {
  const rows = (await API.get('/users')).rows, units = await Ref.opts('units', u => u.name);
  const ROLE = { superadmin: 'Super Admin', unit_admin: 'Admin unit', pimpinan: 'Pimpinan (lihat saja)' };
  view.innerHTML = App.head('Pengguna', 'Akun admin utama unit dibuat otomatis bersama unit. Tambahkan operator unit atau akun pimpinan di sini.', `<button class="btn primary" id="add">${I('plus')} Tambah pengguna</button>`) +
    `<div class="panel">${UI.table({ rows, rowAttr: u => `class="click" data-u="${u.id}"`, columns: [{ label: 'Username', render: u => `<b class="mono">${esc(u.username)}</b>${u.is_unit_primary ? ' <span class="badge info">admin utama</span>' : ''}` },
      { label: 'Nama', key: 'name' }, { label: 'Peran', render: u => ROLE[u.role] }, { label: 'Unit', key: 'unit_name' }, { label: 'Status', render: u => (u.active ? badge('aktif') : u.has_password ? badge('nonaktif') : '<span class="badge warn">Belum ada password</span>') },
      { label: 'Masuk terakhir', render: u => (u.last_login_at ? fmt.rel(u.last_login_at) : '–') }] })}</div>`;
  const F = edit => [{ name: 'username', label: 'Username', required: true }, { name: 'name', label: 'Nama' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Telepon' },
    { name: 'role', label: 'Peran', type: 'select', empty: false, options: Object.entries(ROLE).map(([a, b]) => ({ value: a, label: b })) }, { name: 'unit_id', label: 'Unit (wajib untuk admin unit)', type: 'select', options: units },
    { name: 'password', label: edit ? 'Reset password (kosongkan bila tidak)' : 'Password awal', type: 'password', required: !edit }, { name: 'active', label: 'Aktif', type: 'checkbox', default: true }];
  $('#add').onclick = () => UI.formModal({ title: 'Tambah pengguna', fields: F(false), values: { role: 'unit_admin' }, onSubmit: async v => { await API.post('/users', v); App.render(); } });
  view.onclick = e => { const tr = e.target.closest('[data-u]'); if (!tr) return; const u = rows.find(x => x.id === Number(tr.dataset.u));
    const m = UI.formModal({ title: 'Ubah pengguna', fields: F(true), values: u, onSubmit: async v => { if (!v.password) delete v.password; await API.put('/users/' + u.id, v); App.render(); } });
    if (!u.is_unit_primary && u.id !== App.me.id) { const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Hapus'; del.style.marginRight = 'auto';
      del.onclick = async () => { if (await UI.confirm('Hapus pengguna ini?', { danger: true })) { await API.del('/users/' + u.id); m.close(); App.render(); } }; $('.modal-foot', m.el).prepend(del); } };
});

// ---------- Pengaturan organisasi ----------
route(/^#\/pengaturan$/, async view => {
  const s = await API.get('/settings'), org = s.org || {}, op = s.operational || {}, nc = s.numbering_code || {};
  const dep = { period: 'semester', convention: 'penuh', capitalization_min: 0, residual_pct: 0, excluded_groups: ['1', '2', '7'], ...(s.depreciation || {}) };
  const gol = await API.get('/asset-codes');
  const fDep = [{ name: 'period', label: 'Periode penyusutan', type: 'select', empty: false, options: [['bulan', 'Bulanan'], ['semester', 'Semesteran'], ['tahun', 'Tahunan']].map(([a, b]) => ({ value: a, label: b })) },
    { name: 'convention', label: 'Awal penyusutan', type: 'select', empty: false, options: [{ value: 'penuh', label: 'Periode perolehan disusutkan penuh' }, { value: 'berikutnya', label: 'Mulai periode setelah perolehan' }] },
    { name: 'capitalization_min', label: 'Nilai minimum kapitalisasi (Rp)', type: 'money', help: 'Aset di bawah nilai ini tidak disusutkan' }, { name: 'residual_pct', label: 'Nilai sisa (% harga)', type: 'number', step: '0.01', min: 0 },
    { name: 'excluded_groups', label: 'Golongan yang tidak disusutkan', type: 'checks', options: gol.map(g => ({ value: g.code, label: `${g.code} ${g.name}` })) }];
  const fOrg = [{ name: 'name', label: 'Nama institusi', required: true }, { name: 'short', label: 'Singkatan' }, { name: 'unit_label', label: 'Unit pengelola aset (kop BA)' }, { name: 'city', label: 'Kota (tempat penandatanganan)' }];
  const fOp = [{ name: 'start', label: 'Jam operasional mulai', type: 'time' }, { name: 'end', label: 'Jam operasional selesai', type: 'time' }, { name: 'days', label: 'Hari operasional', type: 'checks', options: [1, 2, 3, 4, 5, 6, 7].map(d => ({ value: d, label: ISO_DAY[d] })) }];
  view.innerHTML = App.head('Pengaturan organisasi') + `<div class="grid2"><div class="panel"><div class="panel-head"><h3>Identitas</h3></div><div class="panel-body" id="o">${UI.form(fOrg, org)}<button class="btn primary" style="margin-top:14px" id="so">Simpan</button></div></div>
    <div class="panel"><div class="panel-head"><h3>Jam operasional (dasar utilisasi)</h3></div><div class="panel-body" id="p">${UI.form(fOp, op)}
      <label class="field" style="margin-top:14px"><span>Kode penomoran dokumen</span><input id="nc" value="${esc(nc.value || '')}"><small class="help">Contoh hasil: 0007/BA-MUT/${esc(nc.value || 'SARPRAS')}/X/2026</small></label>
      <button class="btn primary" style="margin-top:14px" id="sp">Simpan</button></div></div>
    <div class="panel" style="grid-column:1/-1"><div class="panel-head"><h3>Kebijakan penyusutan aset tetap</h3></div><div class="panel-body" id="dp">${UI.form(fDep, dep)}
      <p class="muted" style="font-size:13px;margin-top:12px">Metode garis lurus: penyusutan per periode = (harga − nilai sisa) ÷ (masa manfaat × jumlah periode per tahun). Beban diakui untuk periode yang sudah berakhir. Masa manfaat diambil dari data aset, atau dari kode barang terdekat pada struktur kodefikasi. Sesuaikan pengaturan ini dengan kebijakan akuntansi dan regulasi yang berlaku.</p>
      <button class="btn primary" style="margin-top:8px" id="sd">Simpan kebijakan</button></div></div></div>`;
  $('#sd').onclick = async () => { try { const v = UI.read($('#dp'), fDep); await API.put('/depreciation/policy', v); UI.toast('Kebijakan penyusutan disimpan; nilai buku dihitung ulang otomatis'); } catch (e) { UI.err(e); } };
  $('#so').onclick = async () => { try { await API.put('/settings/org', UI.read($('#o'), fOrg)); UI.toast('Tersimpan'); } catch (e) { UI.err(e); } };
  $('#sp').onclick = async () => { try { const v = UI.read($('#p'), fOp); v.days = v.days.map(Number); await API.put('/settings/operational', v); await API.put('/settings/numbering_code', { value: $('#nc').value }); UI.toast('Tersimpan'); } catch (e) { UI.err(e); } };
});

// ---------- Log aktivitas ----------
route(/^#\/audit$/, async (view, _, q) => {
  const rows = await API.get('/audit', { entity: q.entity, offset: q.offset });
  view.innerHTML = App.head('Log aktivitas', 'Jejak perubahan data oleh pengguna.') + `<div class="filters"><input data-f="entity" placeholder="Filter entitas, mis. assets" value="${esc(q.entity || '')}"></div>
    <div class="panel">${UI.table({ rows, columns: [{ label: 'Waktu', render: a => fmt.dt(a.at) }, { label: 'Pengguna', render: a => esc(a.username || 'sistem') }, { label: 'Aksi', key: 'action' }, { label: 'Entitas', render: a => `${esc(a.entity)} #${a.entity_id || ''}` },
      { label: 'Data', render: a => `<small class="mono" style="word-break:break-all">${esc(a.data ? JSON.stringify(a.data).slice(0, 160) : '')}</small>` }] })}</div>`;
  bindFilters(view, '#/audit', q);
});

// ---------- Laporan ----------
route(/^#\/laporan$/, async (view, _, q) => {
  const kind = q.kind || 'harian', periods = await Ref.get('periods');
  const params = { harian: { date: q.date || fmt.ymd(new Date()) }, penyusutan: { date: q.date || fmt.ymd(new Date()) }, bulanan: { month: q.month || fmt.ymd(new Date()).slice(0, 7) }, semester: { period_id: q.period_id || (periods.find(p => p.is_active) || {}).id } }[kind];
  const rep = await API.get('/reports/' + kind, { ...params, unit_id: q.unit_id });
  const cell = (c, r) => { const v = r[c.key]; return c.type === 'money' ? fmt.rp(v) : c.type === 'pct' ? `${fmt.num(v, 1)}%` : c.type === 'num' ? fmt.num(v, 1) : esc(v ?? ''); };
  view.innerHTML = App.head('Laporan', 'Rekap penggunaan ruang, peminjaman, masukan & keluhan, kerusakan, aset, dan persediaan.',
    `<a class="btn" href="${API.url('/reports/' + kind, { ...params, unit_id: q.unit_id, format: 'xlsx' })}">${I('dl')} Unduh Excel</a><button class="btn primary" onclick="print()">${I('print')} Cetak</button>`) + `
    <div class="tabs" id="tabs"></div>
    <div class="filters">${kind === 'harian' || kind === 'penyusutan' ? `${kind === 'penyusutan' ? '<span class="muted">Per tanggal</span>' : ''}<input type="date" data-f="date" value="${params.date}" style="width:auto">` : kind === 'bulanan' ? `<input type="month" data-f="month" value="${params.month}" style="width:auto">`
      : `<select data-f="period_id">${UI.options(periods.map(p => ({ value: p.id, label: p.name })), params.period_id)}</select>`}${await unitFilter(q.unit_id)}</div>
    <div class="panel panel-body"><div style="text-align:center;margin-bottom:20px"><h2>${esc(rep.title)}</h2><p>${esc(rep.org.name || '')} · ${esc(rep.unit)}<br><small class="muted">Periode ${fmt.date(rep.from)} s.d. ${fmt.date(rep.to)} · dicetak ${fmt.dt(rep.generated_at)}</small></p></div>
      ${rep.sections.map(s => `<section class="report-sec"><h3>${esc(s.title)}</h3>${s.note ? `<p class="muted" style="font-size:13px">${esc(s.note)}</p>` : ''}
        ${UI.table({ rows: s.rows, empty: 'Nihil.', columns: s.columns.map(c => ({ label: c.label, num: ['num', 'money', 'pct'].includes(c.type), render: r => cell(c, r) })) })}</section>`).join('')}</div>`;
  UI.tabs($('#tabs'), [['harian', 'Harian'], ['bulanan', 'Bulanan'], ['semester', 'Semester'], ['penyusutan', 'Penyusutan aset']], kind, k => setQ('#/laporan', { kind: k, unit_id: q.unit_id }));
  bindFilters(view, '#/laporan', { ...q, kind });
});
