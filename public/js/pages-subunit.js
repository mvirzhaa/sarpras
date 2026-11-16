/* ===== Sub unit (mis. program studi di bawah fakultas) ===== */
'use strict';
const SUB_KIND = [['prodi', 'Program studi'], ['jurusan', 'Jurusan'], ['bagian', 'Bagian / lab'], ['lainnya', 'Lainnya']];

route(/^#\/sub-unit$/, async (view, _, q) => {
  const sa = App.isSA(), me = App.me, mySub = me.sub_unit_id || null, fak = !mySub;      // fak: SA atau admin unit tingkat fakultas
  const units = sa ? await Ref.get('units') : [];
  const unitId = sa ? (Number(q.unit) || '') : me.unit_id;
  const rows = (await API.get('/sub-units', { unit_id: unitId })).rows.filter(s => !mySub || s.id === mySub);
  view.innerHTML = App.head('Sub unit / program studi', fak
    ? 'Sub unit adalah bagian dari unit, misalnya program studi di bawah fakultas. Kelas dan jadwal kuliah dapat dimasukkan pada tingkat unit (seluruh fakultas) atau per program studi. Pengelola sub unit adalah admin fakultasnya atau admin program studi itu sendiri.'
    : 'Data program studi Anda. Anda mengelola kelas, dosen, dan jadwal kuliah program studi ini.',
  fak ? `<button class="btn primary" id="add">${I('plus')} Tambah sub unit</button>` : '') +
    (sa ? `<div class="filters"><select id="fu"><option value="">Semua unit</option>${UI.options(units.map(u => ({ value: u.id, label: u.name })), unitId)}</select></div>` : '') +
    `<div class="panel">${UI.table({ rows, empty: 'Belum ada sub unit.', columns: [
      { label: 'Sub unit', render: s => `<b>${esc(s.name)}</b>${s.active ? '' : ' <span class="badge warn">Nonaktif</span>'}<br><small class="mono">${esc(s.code)}</small> · <small>${esc((SUB_KIND.find(k => k[0] === s.kind) || [])[1] || s.kind)}</small>` },
      ...(sa ? [{ label: 'Unit induk', render: s => esc(s.unit_name) }] : []),
      { label: 'Ketua', render: s => esc(s.head_name || '–') },
      { label: 'Data', render: s => `${s.course_count} MK · ${s.class_count} kelas` },
      { label: 'Akun admin', render: s => `<span class="mono">${esc(s.admin_username || '–')}</span><br>${s.admin_active ? '<span class="badge ok">Aktif</span>' : s.admin_ready ? '<span class="badge warn">Nonaktif</span>' : '<span class="badge warn">Belum diisi</span>'}` },
      { label: '', render: s => `<div class="btn-row" style="justify-content:flex-end">${fak ? `<a class="btn sm" href="#/penjadwalan?unit=${s.unit_id}&sub=${s.id}">Jadwal</a><button class="btn sm" data-adm="${s.id}">Akun admin</button>` : ''}${sa ? `<button class="btn sm primary" data-as="${s.id}" ${s.admin_id ? '' : 'disabled'}>Masuk sebagai</button>` : ''}<button class="btn sm ghost" data-ed="${s.id}">Ubah</button></div>` }] })}</div>`;
  if ($('#fu')) $('#fu').onchange = e => setQ('#/sub-unit', { unit: e.target.value });
  const F = edit => [
    ...(sa && !edit ? [{ name: 'unit_id', label: 'Unit induk', type: 'select', required: true, options: units.map(u => ({ value: u.id, label: u.name })) }] : []),
    ...(mySub ? [] : [{ name: 'code', label: 'Kode', required: true, placeholder: 'mis. TI, SI, MJ', help: 'Dipakai pada kolom Program Studi di Excel & username admin' }]),
    { name: 'name', label: 'Nama sub unit', required: true, placeholder: 'mis. Program Studi Teknik Informatika' },
    ...(mySub ? [] : [{ name: 'kind', label: 'Jenis', type: 'select', empty: false, options: SUB_KIND.map(([v, l]) => ({ value: v, label: l })) }]),
    { name: 'head_name', label: 'Nama ketua' }, { name: 'head_nip', label: 'NIP/NIDN ketua' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Telepon' },
    ...(mySub ? [] : [{ name: 'active', label: 'Aktif', type: 'checkbox', default: true }]), { name: 'description', label: 'Keterangan', type: 'textarea' }];
  const done = () => { Ref.clear('subunits', 'people'); App.render(); };
  if ($('#add')) $('#add').onclick = () => UI.formModal({ title: 'Tambah sub unit', fields: F(false), values: { kind: 'prodi', unit_id: unitId || '' },
    onSubmit: async v => { const s = await API.post('/sub-units', v); UI.toast(`Sub unit dibuat. Akun ${s.admin_username} menunggu password.`); done(); } });
  view.onclick = async e => {
    const as = e.target.closest('[data-as]'); if (as) { const s = rows.find(x => x.id === Number(as.dataset.as)); return App.loginAs({ sub_unit_id: s.id }, `admin ${s.name}`); }
    const ed = e.target.closest('[data-ed]'), adm = e.target.closest('[data-adm]');
    const s = rows.find(x => x.id === Number((ed || adm || {}).dataset?.[ed ? 'ed' : 'adm']));
    if (!s) return;
    if (ed) {
      const m = UI.formModal({ title: 'Ubah sub unit', fields: F(true).filter(f => f.name !== 'code' || fak), values: s, onSubmit: async v => { await API.put('/sub-units/' + s.id, v); done(); } });
      if (fak) { const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Hapus sub unit'; del.style.marginRight = 'auto';
        del.onclick = async () => { if (await UI.confirm(`Hapus <b>${esc(s.name)}</b>? Akun adminnya ikut terhapus. Kelas yang sudah ada (${s.class_count}) tidak dihapus tetapi menjadi kelas tingkat unit.`, { danger: true, ok: 'Hapus' })) { await API.del('/sub-units/' + s.id).catch(UI.err); m.close(); done(); } };
        $('.modal-foot', m.el).prepend(del); }
    }
    if (adm) UI.formModal({ title: `Akun admin ${s.name}`, values: { username: s.admin_username, name: s.admin_name, email: s.admin_email, active: s.admin_active || !s.admin_ready },
      fields: [{ name: 'username', label: 'Username', required: true }, { name: 'name', label: 'Nama admin' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Telepon' },
        { name: 'password', label: s.admin_ready ? 'Password baru (kosongkan bila tidak diubah)' : 'Password awal (min. 8 karakter)', type: 'password', required: !s.admin_ready }, { name: 'active', label: 'Akun aktif', type: 'checkbox' }],
      extra: '<p class="muted" style="margin-top:10px">Admin program studi hanya dapat mengelola kelas, dosen, mata kuliah, dan jadwal sub unitnya. Wajib mengganti password saat pertama masuk.</p>',
      onSubmit: async v => { if (!v.password) delete v.password; await API.put(`/sub-units/${s.id}/admin`, v); done(); } });
  };
});
