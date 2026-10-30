/* ===== Halaman aset: daftar, kartu inventaris, kodefikasi, mutasi, opname, persediaan, BA, valuasi, label, scan ===== */
'use strict';
const ACQ = [['pembelian', 'Pembelian'], ['hibah', 'Hibah'], ['transfer', 'Transfer masuk'], ['swakelola', 'Swakelola'], ['lainnya', 'Lainnya']];
const condOpts = Object.entries(COND).map(([k, v]) => ({ value: k, label: v[0] }));
const personOpts = async () => (await Ref.get('people')).map(p => ({ value: p.id, label: p.name + (p.id_number ? ` (${p.id_number})` : '') }));

// ---------- Pemindai QR (BarcodeDetector, cadangan jsQR) ----------
Pages.scanner = (title, onCode, { keepOpen } = {}) => {
  const m = UI.modal({ title, body: `<video class="scan-video" playsinline muted></video><canvas hidden></canvas>
    <p class="muted" style="margin:10px 0" id="scMsg">Arahkan kamera ke QR aset.</p>
    <div class="btn-row"><input id="scIn" placeholder="atau ketik kode aset, mis. 3.10.01.02.001.00001" style="flex:1"><button class="btn" id="scGo">Cari</button></div><div id="scLog" style="margin-top:10px"></div>`,
  onClose: () => { stop = true; stream && stream.getTracks().forEach(t => t.stop()); } });
  let stream, stop = false, last = '', lastT = 0;
  const hit = async code => {
    if (!code || (code === last && Date.now() - lastT < 2500)) return; last = code; lastT = Date.now();
    try { const msg = await onCode(code, m); if (msg) $('#scLog', m.el).insertAdjacentHTML('afterbegin', `<div class="badge ok" style="display:block;margin-bottom:4px">${esc(msg)}</div>`); if (!keepOpen) m.close(); }
    catch (e) { $('#scLog', m.el).insertAdjacentHTML('afterbegin', `<div class="badge bad" style="display:block;margin-bottom:4px">${esc(e.message)}</div>`); }
  };
  $('#scGo', m.el).onclick = () => { hit($('#scIn', m.el).value.trim()); $('#scIn', m.el).value = ''; };
  $('#scIn', m.el).onkeydown = e => { if (e.key === 'Enter') $('#scGo', m.el).click(); };
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('video', m.el); v.srcObject = stream; await v.play();
      let detect;
      if ('BarcodeDetector' in window) { const bd = new BarcodeDetector({ formats: ['qr_code'] }); detect = async () => { const r = await bd.detect(v); return r[0] && r[0].rawValue; }; }
      else {
        if (!window.jsQR) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
        const c = $('canvas', m.el), ctx = c.getContext('2d', { willReadFrequently: true });
        detect = async () => { c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0); const r = window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height); return r && r.data; };
      }
      const loop = async () => { if (stop) return; try { const c = await detect(); if (c) await hit(c); } catch { /* lanjut */ } setTimeout(loop, 300); };
      loop();
    } catch { $('#scMsg', m.el).textContent = 'Kamera tidak tersedia (izinkan akses kamera atau gunakan HTTPS). Ketik kode secara manual.'; }
  })();
  return m;
};
route(/^#\/scan$/, async view => {
  view.innerHTML = App.head('Pindai QR aset', 'Pindai label QR untuk membuka kartu inventaris aset.') + `<button class="btn primary" id="sc">${I('scan')} Mulai memindai</button>`;
  const go = () => Pages.scanner('Pindai QR aset', async code => { const a = await API.get('/scan', { code }); location.hash = '#/aset/' + a.id; });
  $('#sc').onclick = go; go();
});

// ---------- Daftar aset ----------
const assetFields = async (edit) => [
  ...(edit ? [] : [{ name: 'asset_code_id', label: 'Kode barang (Sub-sub Kelompok)', type: 'code', required: true, full: true }]),
  { name: 'name', label: 'Nama aset', required: true, full: true }, { name: 'brand', label: 'Merek' }, { name: 'model', label: 'Tipe/model' },
  { name: 'serial_number', label: 'Nomor seri', help: edit ? '' : 'Diabaikan bila jumlah > 1' }, { name: 'specification', label: 'Spesifikasi', type: 'textarea' },
  { name: 'acquisition_date', label: 'Tanggal perolehan', type: 'date' }, { name: 'acquisition_method', label: 'Cara perolehan', type: 'select', empty: false, options: ACQ.map(([a, b]) => ({ value: a, label: b })) },
  { name: 'price', label: 'Harga satuan (Rp)', type: 'money' }, { name: 'useful_life_years', label: 'Masa manfaat (tahun)', type: 'number', min: 0, help: 'Untuk penyusutan; kosong = ikut masa manfaat kode barang (diwarisi dari induk)' },
  { name: 'funding_source', label: 'Sumber dana' }, { name: 'vendor', label: 'Penyedia' }, { name: 'document_no', label: 'No. faktur/kontrak/BAST' },
  ...(edit ? [] : [{ name: 'quantity', label: 'Jumlah unit', type: 'number', min: 1, default: 1, help: 'Tiap unit mendapat NUP & QR sendiri' },
    { name: 'condition', label: 'Kondisi awal', type: 'select', empty: false, options: condOpts },
    { name: 'room_id', label: 'Ruang penempatan', type: 'select', options: await Ref.roomOpts(!App.isSA()) }, { name: 'holder_id', label: 'Pemegang (opsional)', type: 'select', options: await personOpts() }]),
  { name: 'notes', label: 'Catatan', type: 'textarea' }];

route(/^#\/aset$/, async (view, _, q) => {
  const limit = 100, page = Number(q.page) || 0;
  const [res, blds, people] = await Promise.all([API.get('/assets', { ...q, limit, offset: page * limit }), Ref.get('buildings'), Ref.get('people')]);
  const rooms = await Ref.roomOpts(!App.isSA() && App.me.role !== 'pimpinan');
  view.innerHTML = App.head('Daftar aset', `${fmt.num(res.total)} aset · nilai perolehan ${fmt.rp(res.value)} · akumulasi penyusutan ${fmt.rp(res.acc)} · nilai buku ${fmt.rp(res.book)}`,
    `<button class="btn" id="scan">${I('scan')} Pindai</button>${App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Daftarkan aset</button>` : ''}`) + `
    <div class="filters"><input type="search" data-f="q" placeholder="Cari nama, kode, nomor seri, merek" value="${esc(q.q || '')}">
      <input data-f="code" placeholder="Awalan kode, mis. 3.10" value="${esc(q.code || '')}" style="min-width:150px">
      <select data-f="building_id"><option value="">Semua gedung</option>${UI.options(blds.map(b => ({ value: b.id, label: b.name })), q.building_id)}</select>
      <select data-f="room_id"><option value="">Semua ruang</option>${UI.options(rooms, q.room_id)}</select>
      <select data-f="holder_id"><option value="">Semua pemegang</option>${UI.options(people.map(p => ({ value: p.id, label: p.name })), q.holder_id)}</select>
      <select data-f="condition"><option value="">Semua kondisi</option>${UI.options(condOpts, q.condition)}</select>
      <select data-f="status"><option value="aktif">Aktif</option><option value="dihapus" ${q.status === 'dihapus' ? 'selected' : ''}>Sudah dihapuskan</option></select></div>
    <div class="btn-row no-print" id="bulk" hidden style="margin-bottom:10px"><b id="nsel"></b>
      <button class="btn sm" data-b="mut">${I('move')} Mutasi</button><button class="btn sm" data-b="label">${I('qr')} Cetak label</button>
      <button class="btn sm" data-b="cond">Ubah kondisi</button><button class="btn sm danger" data-b="disp">Hapuskan</button></div>
    <div class="panel" id="tbl">${UI.table({ rows: res.rows, select: App.canWrite() || true, empty: 'Belum ada aset pada filter ini.', rowAttr: a => `class="click" data-a="${a.id}"`, columns: [
      { label: 'Kode aset', render: a => `<span class="tag">${esc(a.tag)}</span>` }, { label: 'Nama', render: a => `<b>${esc(a.name)}</b><br><small>${esc([a.brand, a.model].filter(Boolean).join(' ') || a.code_name)}</small>` },
      { label: 'Penempatan', render: a => `${esc(a.room_code || '–')}${a.holder_name ? `<br><small>${esc(a.holder_name)}</small>` : ''}` }, { label: 'Kondisi', render: a => badge(a.condition, COND) },
      { label: 'Perolehan', render: a => fmt.date(a.acquisition_date) }, { label: 'Harga', num: true, render: a => fmt.rp(a.price) }, { label: 'Nilai buku', num: true, render: a => fmt.rp(a.book_value) }] })}</div>
    <div class="btn-row" style="margin-top:12px">${page > 0 ? `<button class="btn sm" data-pg="${page - 1}">‹ Sebelumnya</button>` : ''}<span class="muted">Halaman ${page + 1} dari ${Math.max(1, Math.ceil(res.total / limit))}</span>${(page + 1) * limit < res.total ? `<button class="btn sm" data-pg="${page + 1}">Berikutnya ›</button>` : ''}</div>`;
  bindFilters(view, '#/aset', { ...q, page: '' });
  let sel = [];
  UI.bindSelect($('#tbl'), ids => { sel = ids; $('#bulk').hidden = !ids.length; $('#nsel').textContent = `${ids.length} dipilih`; });
  $('#scan').onclick = () => Pages.scanner('Pindai QR aset', async code => { const a = await API.get('/scan', { code }); location.hash = '#/aset/' + a.id; });
  const add = $('#add'); if (add) add.onclick = async () => UI.formModal({ title: 'Daftarkan aset', wide: true, fields: await assetFields(false), values: { quantity: 1, condition: 'baru', acquisition_method: 'pembelian', room_id: q.room_id },
    onSubmit: async v => { const r = await API.post('/assets', v); UI.toast(`${r.ids.length} aset terdaftar`); r.ids.length === 1 ? (location.hash = '#/aset/' + r.ids[0]) : App.render(); } });
  view.addEventListener('click', e => {
    const pg = e.target.closest('[data-pg]'); if (pg) return setQ('#/aset', { ...q, page: pg.dataset.pg });
    if (e.target.closest('input[type=checkbox]')) return;
    const b = e.target.closest('[data-b]');
    if (b) {
      if (b.dataset.b === 'mut') Pages.mutationForm(sel);
      if (b.dataset.b === 'label') { sessionStorage.setItem('sp_labels', JSON.stringify(sel)); location.hash = '#/label'; }
      if (b.dataset.b === 'disp') Pages.disposeForm(sel);
      if (b.dataset.b === 'cond') UI.formModal({ title: `Ubah kondisi ${sel.length} aset`, fields: [{ name: 'condition', label: 'Kondisi', type: 'select', empty: false, options: condOpts }, { name: 'note', label: 'Keterangan', type: 'textarea' }],
        onSubmit: async v => { for (const id of sel) await API.post(`/assets/${id}/condition`, v); UI.toast('Kondisi diperbarui'); App.render(); } });
      return;
    }
    const tr = e.target.closest('[data-a]'); if (tr) location.hash = '#/aset/' + tr.dataset.a;
  });
});

Pages.mutationForm = async (ids) => {
  const fields = [{ html: `<p>${ids.length} aset akan dimutasi. Berita acara mutasi dibuat otomatis.</p>` },
    { name: 'to_room_id', label: 'Ruang tujuan', type: 'select', empty: 'Tetap di ruang yang sama', options: await Ref.roomOpts(!App.isSA()), full: true, help: App.isSA() ? 'Ruang milik unit lain = mutasi antar unit' : 'Mutasi antar unit dilakukan Super Admin' },
    { name: 'to_holder_id', label: 'Pemegang baru', type: 'select', empty: 'Tidak berubah', options: await personOpts() }, { name: 'clear_holder', label: 'Kosongkan pemegang (aset kembali ke ruang)', type: 'checkbox' },
    { name: 'mutation_date', label: 'Tanggal mutasi', type: 'date', default: fmt.ymd(new Date()) }, { name: 'reason', label: 'Alasan / keterangan', type: 'textarea', required: true },
    { name: 'files', label: 'Dokumen penyerta (opsional)', type: 'file', multiple: true, help: 'Surat permohonan, nota dinas, foto serah terima' },
    { name: 'sig1', label: 'Pihak yang menyerahkan', placeholder: 'Nama' }, { name: 'sig2', label: 'Pihak yang menerima', placeholder: 'Nama' }];
  UI.formModal({ title: 'Mutasi barang', wide: true, fields, submit: 'Proses mutasi', onSubmit: async v => {
    const signatories = [v.sig1 && { role: 'Yang menyerahkan', name: v.sig1 }, v.sig2 && { role: 'Yang menerima', name: v.sig2 }].filter(Boolean);
    const m = await API.post('/mutations', { asset_ids: ids, to_room_id: v.to_room_id, to_holder_id: v.to_holder_id, clear_holder: v.clear_holder, mutation_date: v.mutation_date, reason: v.reason, signatories });
    for (const f of v.files || []) await API.upload(f, { entity_type: 'mutation', entity_id: m.id, doc_type: 'dokumen_mutasi', title: f.name });
    UI.toast(`Mutasi ${m.number} tercatat`); location.hash = '#/ba/' + m.ba_id;
  } });
};
Pages.disposeForm = (ids) => UI.formModal({ title: `Hapuskan ${ids.length} aset`, submit: 'Hapuskan & buat berita acara',
  fields: [{ name: 'method', label: 'Cara penghapusan', type: 'select', empty: false, options: ['dimusnahkan', 'dijual', 'dihibahkan', 'hilang', 'rusak berat'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    { name: 'disposal_date', label: 'Tanggal', type: 'date', default: fmt.ymd(new Date()) }, { name: 'reason', label: 'Alasan / dasar penghapusan', type: 'textarea', required: true }],
  extra: '<p class="muted" style="margin-top:10px">Aset tidak dihapus dari basis data; statusnya menjadi "dihapus" sehingga riwayat tetap terjaga.</p>',
  onSubmit: async v => { const r = await API.post('/assets/dispose', { asset_ids: ids, ...v }); location.hash = '#/ba/' + r.id; } });

// ---------- Kartu inventaris aset ----------
const HIST = { registrasi: 'Registrasi', mutasi: 'Mutasi', kondisi: 'Perubahan kondisi', perbaikan: 'Perbaikan', opname: 'Stock opname', penghapusan: 'Penghapusan', ubah_data: 'Ubah data' };
route(/^#\/aset\/(\d+)$/, async (view, [id]) => {
  const a = await API.get('/assets/' + id), can = a.can_manage && a.status === 'aktif';
  view.innerHTML = `<div class="panel panel-body" style="margin-bottom:18px"><div class="asset-head"><div>
      <div class="asset-tag">${esc(a.tag)}</div><h1 style="margin:6px 0">${esc(a.name)}</h1>
      <p class="muted">${a.code_path.map(c => esc(c.name)).join(' › ')}</p>
      <div class="btn-row" style="margin-top:10px">${badge(a.condition, COND)} ${badge(a.status)} <span class="muted">NUP ${a.nup}</span></div>
      <div class="btn-row no-print" style="margin-top:16px"><a class="btn sm" href="#/aset">Kembali</a>
        ${can ? `<button class="btn sm" id="edit">Ubah data</button><button class="btn sm" id="cond">Ubah kondisi</button><button class="btn sm" id="mut">${I('move')} Mutasi</button>
        <button class="btn sm" id="mnt">${I('wrench')} Catat perbaikan</button><button class="btn sm danger" id="disp">Hapuskan</button>` : ''}
        <button class="btn sm" id="lbl">${I('qr')} Cetak label</button><button class="btn sm" onclick="print()">${I('print')} Cetak kartu</button></div></div>
    <img class="qr" src="${API.url('/assets/' + a.id + '/qr.svg')}" alt="QR ${esc(a.tag)}"></div></div>
    <div class="grid2"><div class="panel"><div class="panel-head"><h3>Data aset</h3></div><div class="panel-body"><dl class="kv">
      <dt>Merek / tipe</dt><dd>${esc([a.brand, a.model].filter(Boolean).join(' / ') || '–')}</dd><dt>Nomor seri</dt><dd>${esc(a.serial_number || '–')}</dd>
      <dt>Spesifikasi</dt><dd>${esc(a.specification || '–')}</dd><dt>Perolehan</dt><dd>${fmt.date(a.acquisition_date)} · ${esc(a.acquisition_method)}</dd>
      <dt>Sumber dana</dt><dd>${esc(a.funding_source || '–')}</dd><dt>Penyedia</dt><dd>${esc(a.vendor || '–')}</dd><dt>No. dokumen</dt><dd>${esc(a.document_no || '–')}</dd>
      <dt>Harga perolehan</dt><dd><b>${fmt.rp(a.price)}</b></dd><dt>Akumulasi penyusutan</dt><dd>${fmt.rp(a.acc_dep)}</dd><dt>Nilai buku</dt><dd><b>${fmt.rp(a.book_value)}</b></dd>
      <dt>Ruang</dt><dd>${a.room_code ? `${esc(a.room_code)} — ${esc(a.room_name)}<br><small>${esc(a.building_name)}</small>` : '–'}</dd>
      <dt>Pemegang</dt><dd>${esc(a.holder_name || '–')} ${a.holder_number ? `<small>${esc(a.holder_number)}</small>` : ''}</dd><dt>Unit</dt><dd>${esc(a.unit_name || '–')}</dd>
      ${a.notes ? `<dt>Catatan</dt><dd>${esc(a.notes)}</dd>` : ''}</dl></div></div>
    <div class="panel"><div class="panel-head"><h3>Kartu riwayat inventaris</h3></div><div class="panel-body"><ul class="timeline">${a.history.map(h => `<li class="${h.action}">
      <time>${fmt.dt(h.created_at)} · ${esc(h.user_name || 'sistem')}</time><div><b>${HIST[h.action] || h.action}</b>
      ${h.from_room || h.to_room ? `<br>Ruang: ${esc(h.from_room || '–')} → ${esc(h.to_room || '–')}` : ''}${h.from_holder || h.to_holder ? `<br>Pemegang: ${esc(h.from_holder || '–')} → ${esc(h.to_holder || '–')}` : ''}
      ${h.from_condition || h.to_condition ? `<br>Kondisi: ${esc((COND[h.from_condition] || ['–'])[0])} → ${esc((COND[h.to_condition] || ['–'])[0])}` : ''}${h.note ? `<br><small>${esc(h.note)}</small>` : ''}
      ${h.ref_type === 'mutation' || h.ref_type === 'ba' ? ` <small><a href="#/mutasi">dokumen</a></small>` : ''}</div></li>`).join('')}</ul></div></div>
    <div class="panel"><div class="panel-head"><h3>Penyusutan</h3><div class="actions"><button class="btn sm ghost" id="depSch">Lihat jadwal</button></div></div><div class="panel-body">${(() => { const d = a.depreciation || {};
      return d.depreciable ? `<dl class="kv"><dt>Metode</dt><dd>Garis lurus, per ${d.period_type}</dd><dt>Masa manfaat</dt><dd>${d.life} tahun (${d.periods_total} ${d.period_type})</dd>
        <dt>Penyusutan per ${d.period_type}</dt><dd>${fmt.rp(d.per_period)}</dd><dt>Periode berjalan</dt><dd>${d.periods_elapsed} dari ${d.periods_total} ${d.period_type}</dd>
        <dt>Akumulasi</dt><dd>${fmt.rp(d.accumulated)}</dd><dt>Nilai buku</dt><dd><b>${fmt.rp(d.book_value)}</b>${d.reason ? ` <span class="badge">${esc(d.reason)}</span>` : ''}</dd></dl>
        <div class="meter" style="margin-top:12px"><i style="width:${d.periods_total ? (100 * d.periods_elapsed) / d.periods_total : 0}%;background:var(--amber)"></i></div>`
        : `<p class="muted">Tidak disusutkan: ${esc(d.reason || '–')}.</p>`; })()}</div></div>
    <div class="panel"><div class="panel-head"><h3>Riwayat perbaikan</h3></div>${UI.table({ rows: a.maintenance, empty: 'Belum pernah diperbaiki.', rowAttr: m => can ? `class="click" data-m="${m.id}"` : '',
      columns: [{ label: 'Mulai', render: m => fmt.date(m.start_date) }, { label: 'Uraian', key: 'description' }, { label: 'Penyedia', key: 'vendor' }, { label: 'Biaya', num: true, render: m => fmt.rp(m.cost) }, { label: 'Status', render: m => badge(m.status) }] })}</div>
    <div class="panel"><div class="panel-head"><h3>Foto & dokumen</h3></div><div class="panel-body" id="docs"></div></div></div>`;
  filesPanel($('#docs'), 'asset', a.id, a.can_manage, [['foto', 'Foto aset (jadi foto utama)'], ['faktur', 'Faktur/kuitansi'], ['bast', 'BAST'], ['garansi', 'Kartu garansi'], ['lainnya', 'Lainnya']]);
  $('#lbl').onclick = () => { sessionStorage.setItem('sp_labels', JSON.stringify([a.id])); location.hash = '#/label'; };
  $('#depSch').onclick = async () => {
    const r = await API.get(`/assets/${a.id}/depreciation`);
    UI.modal({ title: `Jadwal penyusutan ${a.tag}`, wide: true, body: r.schedule.length ? `<p class="muted">Harga perolehan ${fmt.rp(a.price)} · masa manfaat ${r.summary.life} tahun · ${fmt.rp(r.summary.per_period)} per ${r.summary.period_type}. Baris tebal = periode yang sudah berjalan.</p>` +
      UI.table({ rows: r.schedule, columns: [{ label: 'Akhir periode', render: x => (x.past ? `<b>${fmt.date(x.period_end)}</b>` : fmt.date(x.period_end)) }, { label: 'Beban penyusutan', num: true, render: x => fmt.rp(x.expense) },
        { label: 'Akumulasi', num: true, render: x => fmt.rp(x.accumulated) }, { label: 'Nilai buku', num: true, render: x => fmt.rp(x.book_value) }] }) : `<p>Aset ini tidak disusutkan: ${esc(r.summary.reason || '')}.</p>`, actions: [{ label: 'Tutup' }] });
  };
  if (!can) return;
  $('#edit').onclick = async () => UI.formModal({ title: 'Ubah data aset', wide: true, fields: await assetFields(true), values: a, onSubmit: async v => { await API.put('/assets/' + id, v); App.render(); } });
  $('#cond').onclick = () => UI.formModal({ title: 'Ubah kondisi', values: { condition: a.condition }, fields: [{ name: 'condition', label: 'Kondisi', type: 'select', empty: false, options: condOpts }, { name: 'note', label: 'Keterangan', type: 'textarea' },
    ...(a.room_id ? [{ name: 'report_damage', label: 'Catat juga sebagai kerusakan ruang (jika rusak)', type: 'checkbox' }] : [])], onSubmit: async v => { await API.post(`/assets/${id}/condition`, v); App.render(); } });
  $('#mut').onclick = () => Pages.mutationForm([a.id]);
  $('#disp').onclick = () => Pages.disposeForm([a.id]);
  $('#mnt').onclick = () => UI.formModal({ title: 'Catat perbaikan', fields: [{ name: 'start_date', label: 'Tanggal mulai', type: 'date', default: fmt.ymd(new Date()) }, { name: 'vendor', label: 'Penyedia/teknisi' },
    { name: 'cost', label: 'Perkiraan biaya (Rp)', type: 'money' }, { name: 'description', label: 'Uraian kerusakan & perbaikan', type: 'textarea', required: true }], onSubmit: async v => { await API.post(`/assets/${id}/maintenance`, v); App.render(); } });
  view.addEventListener('click', e => { const tr = e.target.closest('[data-m]'); if (!tr) return; const m = a.maintenance.find(x => x.id === Number(tr.dataset.m));
    UI.formModal({ title: 'Perbarui perbaikan', values: { ...m, end_date: m.end_date || fmt.ymd(new Date()) }, fields: [{ name: 'status', label: 'Status', type: 'select', empty: false, options: ['proses', 'selesai', 'gagal'].map(s => ({ value: s, label: STATUS[s][0] })) },
      { name: 'end_date', label: 'Tanggal selesai', type: 'date' }, { name: 'cost', label: 'Biaya akhir (Rp)', type: 'money' }, { name: 'result_condition', label: 'Kondisi setelah perbaikan', type: 'select', options: condOpts }],
    onSubmit: async v => { await API.put('/maintenance/' + m.id, v); App.render(); } }); });
});

// ---------- Cetak label QR ----------
route(/^#\/label$/, async view => {
  const ids = JSON.parse(sessionStorage.getItem('sp_labels') || '[]');
  if (!ids.length) { view.innerHTML = App.head('Label QR') + '<div class="empty">Pilih aset dari Daftar aset, lalu tekan Cetak label.</div>'; return; }
  const rows = await API.post('/assets/labels', { ids });
  view.innerHTML = App.head(`Label QR (${rows.length})`, 'Ukuran 6,4 × 3,4 cm. Cetak pada kertas stiker A4, skala 100%.', `<a class="btn" href="#/aset">Kembali</a><button class="btn primary" onclick="print()">${I('print')} Cetak</button>`) +
    `<div class="labels">${rows.map(r => `<div class="label">${r.qr}<div><b>${esc(App.me.org.short || '')} · ${esc(r.unit_name || '')}</b><br>${esc(r.name)}<br><span class="mono">${esc(r.tag)}</span><br>${esc(r.building_code || '')} ${esc(r.room_code || '')}<br>${r.acquisition_date ? 'Th. ' + r.acquisition_date.slice(0, 4) : ''}</div></div>`).join('')}</div>`;
});

// ---------- Kodefikasi ----------
route(/^#\/kodefikasi$/, async (view, _, q) => {
  const sa = App.isSA(), LV = ['', 'Golongan', 'Bidang', 'Kelompok', 'Sub Kelompok', 'Sub-sub Kelompok'];
  const path = q.parent ? await API.get(`/asset-codes/${q.parent}/path`) : [];
  const rows = q.q ? await API.get('/asset-codes', { q: q.q }) : await API.get('/asset-codes', { parent_id: q.parent });
  const cur = path[path.length - 1];
  view.innerHTML = App.head('Kodefikasi barang', 'Struktur 5 level: Golongan › Bidang › Kelompok › Sub Kelompok › Sub-sub Kelompok. Aset didaftarkan pada level Sub-sub Kelompok, lalu diberi NUP.',
    sa ? `<button class="btn" id="imp">${I('dl')} Impor CSV</button>${(!cur || cur.level < 5) ? `<button class="btn primary" id="add">${I('plus')} Tambah ${LV[(cur ? cur.level : 0) + 1]}</button>` : ''}` : '') + `
    <div class="filters"><input type="search" data-f="q" placeholder="Cari kode atau nama barang" value="${esc(q.q || '')}"></div>
    <div class="tree-crumb"><a href="#/kodefikasi">Semua golongan</a>${path.map(p => ` › <a href="#/kodefikasi?parent=${p.id}"><span class="mono">${esc(p.code)}</span> ${esc(p.name)}</a>`).join('')}</div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada kode di level ini.', columns: [{ label: 'Kode', render: c => `<span class="tag">${esc(c.code)}</span>` },
      { label: 'Uraian', render: c => c.level < 5 ? `<a href="#/kodefikasi?parent=${c.id}">${esc(c.name)}</a>` : esc(c.name) }, { label: 'Level', render: c => LV[c.level] },
      { label: 'Sub-kode', num: true, render: c => c.child_count ?? '' }, { label: 'Aset aktif', num: true, render: c => c.asset_count !== undefined ? `<a href="#/aset?code=${encodeURIComponent(c.code)}">${fmt.num(c.asset_count)}</a>` : '' },
      { label: 'Masa manfaat', render: c => c.useful_life_years ? c.useful_life_years + ' th' : '–' },
      ...(sa ? [{ label: '', render: c => `<div class="btn-row" style="justify-content:flex-end"><button class="btn sm ghost" data-ed="${c.id}">Ubah</button><button class="btn sm ghost" data-del="${c.id}" aria-label="Hapus">${I('trash')}</button></div>` }] : [])] })}</div>
    <p class="muted" style="margin-top:10px;font-size:13px">Data awal hanya contoh. Impor tabel kodefikasi resmi yang berlaku melalui CSV (kolom: code,name,useful_life_years).</p>`;
  bindFilters(view, '#/kodefikasi', {});
  if (!sa) return;
  const add = $('#add'); if (add) add.onclick = () => UI.formModal({ title: 'Tambah kode', values: { code: cur ? cur.code + '.' : '' },
    fields: [{ name: 'code', label: 'Kode lengkap', required: true, help: 'Format: 3.10.01.02.001' }, { name: 'name', label: 'Uraian', required: true }, { name: 'useful_life_years', label: 'Masa manfaat (tahun)', type: 'number' }, { name: 'description', label: 'Keterangan', type: 'textarea' }],
    onSubmit: async v => { await API.post('/asset-codes', v); App.render(); } });
  $('#imp').onclick = () => {
    const m = UI.modal({ title: 'Impor kodefikasi', wide: true, body: `<p>Kolom: <span class="mono">code,name,useful_life_years</span>. Induk dibuat lebih dulu otomatis bila ada di berkas yang sama (diurutkan per level).</p>
      <label class="field"><span>Berkas CSV</span><input type="file" accept=".csv" id="cf"></label><label class="field" style="margin-top:10px"><span>atau tempel</span><textarea id="ct" style="min-height:160px;font-family:var(--mono);font-size:12px" placeholder="code,name,useful_life_years\n3.06,Alat Studio Komunikasi dan Pemancar,"></textarea></label><div id="cr"></div>`,
      actions: [{ label: 'Batal' }, { label: 'Impor', kind: 'primary', onClick: async () => { const r = await API.post('/asset-codes/import', { rows: parseCSV($('#ct', m.el).value) }); UI.toast(`${r.imported} kode diimpor`);
        if (r.errors.length) { $('#cr', m.el).innerHTML = `<div class="form-error">${r.errors.map(esc).join('<br>')}</div>`; return false; } App.render(); } }] });
    $('#cf', m.el).onchange = async e => { $('#ct', m.el).value = await e.target.files[0].text(); };
  };
  view.addEventListener('click', async e => {
    const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]');
    if (ed) { const c = rows.find(x => x.id === Number(ed.dataset.ed)); UI.formModal({ title: 'Ubah ' + c.code, values: c, fields: [{ name: 'name', label: 'Uraian', required: true }, { name: 'useful_life_years', label: 'Masa manfaat (tahun)', type: 'number' }, { name: 'description', label: 'Keterangan', type: 'textarea' }], onSubmit: async v => { await API.put('/asset-codes/' + c.id, v); App.render(); } }); }
    if (del && await UI.confirm('Hapus kode ini beserta semua turunannya?', { danger: true, ok: 'Hapus' })) { await API.del('/asset-codes/' + del.dataset.del).catch(UI.err); App.render(); }
  });
});

// ---------- Mutasi ----------
route(/^#\/mutasi$/, async view => {
  const rows = await API.get('/mutations');
  const T = { ruang: 'Pindah ruang', pemegang: 'Ganti pemegang', ruang_pemegang: 'Ruang & pemegang', antar_unit: 'Antar unit' };
  view.innerHTML = App.head('Mutasi barang', 'Perpindahan aset antar ruang, antar pemegang, atau antar unit. Pilih aset dari Daftar aset untuk membuat mutasi baru.', `<a class="btn primary" href="#/aset">${I('plus')} Mutasi baru</a>`) +
    `<div class="panel">${UI.table({ rows, empty: 'Belum ada mutasi.', columns: [{ label: 'Nomor', render: m => `<span class="mono">${esc(m.number)}</span>` }, { label: 'Tanggal', render: m => fmt.date(m.mutation_date) },
      { label: 'Jenis', render: m => T[m.mutation_type] || m.mutation_type }, { label: 'Tujuan', render: m => esc([m.to_room_code, m.to_holder_name].filter(Boolean).join(' / ') || '–') },
      { label: 'Aset', num: true, render: m => m.item_count }, { label: 'Alasan', render: m => esc(m.reason || '') }, { label: 'Dokumen', render: m => `<a href="#/ba/${m.ba_id}">${esc(m.ba_number || 'BA')}</a>${m.file_count ? ` · ${m.file_count} lampiran` : ''}` },
      { label: 'Petugas', render: m => esc(m.created_by_name || '') }] })}</div>`;
});

// ---------- Stock opname ----------
route(/^#\/opname$/, async view => {
  const rows = await API.get('/opnames');
  view.innerHTML = App.head('Stock opname', 'Pencocokan fisik aset per ruang. Pindai QR setiap aset; aset yang tidak ditemukan dan perubahan kondisi tercatat di berita acara.',
    App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Mulai opname</button>` : '') +
    `<div class="panel">${UI.table({ rows, empty: 'Belum ada kegiatan opname.', rowAttr: o => `class="click" data-o="${o.id}"`, columns: [{ label: 'Kegiatan', render: o => `<b>${esc(o.title)}</b><br><small>${esc(o.unit_name || 'Lintas unit')}</small>` },
      { label: 'Tanggal', render: o => fmt.date(o.opname_date) }, { label: 'Progres', render: o => `<div class="meter" style="width:120px"><i style="width:${o.total ? (100 * o.checked) / o.total : 0}%"></i></div><small>${o.checked}/${o.total} dicek · ${o.missing} tidak ada</small>` },
      { label: 'Status', render: o => badge(o.status) }, { label: 'BA', render: o => (o.ba_id ? `<a href="#/ba/${o.ba_id}">${esc(o.ba_number)}</a>` : '–') }] })}</div>`;
  view.onclick = e => { const tr = e.target.closest('[data-o]'); if (tr && !e.target.closest('a')) location.hash = '#/opname/' + tr.dataset.o; };
  const add = $('#add'); if (add) add.onclick = async () => {
    const rooms = await Ref.roomOpts(!App.isSA());
    UI.formModal({ title: 'Mulai stock opname', wide: true, values: { title: `Stock opname ${BULAN[new Date().getMonth()]} ${new Date().getFullYear()}`, opname_date: fmt.ymd(new Date()) },
      fields: [{ name: 'title', label: 'Nama kegiatan', required: true, full: true }, { name: 'opname_date', label: 'Tanggal', type: 'date' },
        ...(App.isSA() ? [{ name: 'unit_id', label: 'Unit', type: 'select', empty: 'Lintas unit', options: await Ref.opts('units', u => u.name) }] : []),
        { html: `<div class="field"><span>Ruang yang diopname</span><label class="check" style="margin:6px 0"><input type="checkbox" id="allR"> Pilih semua</label><div style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;padding:8px">${rooms.map(r => `<label class="check" style="display:flex"><input type="checkbox" class="rr" value="${r.value}">${esc(r.label)} <small class="muted">${esc(r.group)}</small></label>`).join('')}</div></div>` }],
      onSubmit: async (v, m) => { const room_ids = $$('.rr:checked', m.el).map(x => Number(x.value)); const o = await API.post('/opnames', { ...v, room_ids }); location.hash = '#/opname/' + o.id; } });
    setTimeout(() => { const a = $('#allR'); if (a) a.onchange = () => $$('.rr').forEach(x => (x.checked = a.checked)); }, 50);
  };
});
route(/^#\/opname\/(\d+)$/, async (view, [id]) => {
  const o = await API.get('/opnames/' + id), open = o.status === 'berjalan' && App.canWrite();
  const done = o.items.filter(i => i.found !== null).length;
  view.innerHTML = App.head(o.title, `${fmt.date(o.opname_date)} · ${o.rooms.map(r => r.code).join(', ')} · ${done}/${o.items.length} dicek`,
    `<a class="btn" href="#/opname">Kembali</a>${open ? `<button class="btn" id="scan">${I('scan')} Pindai QR</button><button class="btn primary" id="close">Tutup & buat BA</button>` : o.ba_id ? `<a class="btn primary" href="#/ba/${o.ba_id}">Lihat berita acara</a>` : ''}`) + `
    <div class="progress" style="margin-bottom:16px"><i style="width:${o.items.length ? (100 * done) / o.items.length : 0}%"></i></div>
    <div class="panel">${UI.table({ rows: o.items, columns: [{ label: 'Kode aset', render: i => `<span class="tag">${esc(i.tag)}</span>` }, { label: 'Nama', key: 'name' }, { label: 'Ruang tercatat', render: i => esc(i.expected_room || '–') },
      { label: 'Hasil', render: i => i.found === null ? '<span class="badge">Belum dicek</span>' : i.found ? `<span class="badge ok">Ada</span>${i.found_room && i.found_room !== i.expected_room ? ` <span class="badge warn">di ${esc(i.found_room)}</span>` : ''}` : '<span class="badge bad">Tidak ditemukan</span>' },
      { label: 'Kondisi', render: i => open ? `<select data-cond="${i.asset_id}" style="width:auto">${UI.options(condOpts, i.condition_found || i.current_condition)}</select>` : badge(i.condition_found || i.current_condition, COND) },
      ...(open ? [{ label: '', render: i => `<div class="btn-row" style="justify-content:flex-end"><button class="btn sm" data-ok="${i.asset_id}">Ada</button><button class="btn sm danger" data-no="${i.asset_id}">Tidak ada</button></div>` }] : [])] })}</div>`;
  if (!open) return;
  const check = async (body) => { const r = await API.post(`/opnames/${id}/check`, body); return r; };
  view.addEventListener('click', async e => {
    const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
    if (ok || no) { const aid = Number((ok || no).dataset[ok ? 'ok' : 'no']); await check({ asset_id: aid, found: !!ok, condition_found: $(`[data-cond="${aid}"]`).value }).catch(UI.err); App.render(); }
  });
  view.addEventListener('change', async e => { const s = e.target.closest('[data-cond]'); if (s) await check({ asset_id: Number(s.dataset.cond), found: true, condition_found: s.value }).catch(UI.err); });
  $('#scan').onclick = async () => {
    const rooms = o.rooms.map(r => ({ value: r.id, label: r.code }));
    const m = Pages.scanner('Pindai aset — opname', async code => { const r = await check({ tag: code, found: true, found_room_id: $('#scRoom').value || null }); return `${r.tag} ${r.name}${r.extra ? ' (aset dari ruang lain)' : ''} ✓`; }, { keepOpen: true });
    $('.modal-body', m.el).insertAdjacentHTML('afterbegin', `<label class="field" style="margin-bottom:10px"><span>Ruang tempat memindai</span><select id="scRoom"><option value="">Sesuai catatan</option>${UI.options(rooms)}</select></label>`);
    const orig = m.close; m.close = () => { orig(); App.render(); }; $('[data-x]', m.el).onclick = m.close;
  };
  $('#close').onclick = () => UI.formModal({ title: 'Tutup opname', submit: 'Tutup & buat berita acara', values: { apply_changes: true },
    fields: [{ html: `<p>${o.items.length - done} aset belum dicek dan akan dicatat sebagai "belum dicek".</p>` }, { name: 'apply_changes', label: 'Terapkan hasil (kondisi & ruang temuan) ke data aset', type: 'checkbox' },
      { name: 'notes', label: 'Catatan berita acara', type: 'textarea' }, { name: 's1', label: 'Ketua tim opname' }, { name: 's2', label: 'Pengelola barang unit' }, { name: 's3', label: 'Mengetahui (pimpinan unit)' }],
    onSubmit: async v => { const sig = [['Ketua tim opname', v.s1], ['Pengelola barang', v.s2], ['Mengetahui', v.s3]].filter(x => x[1]).map(([role, name]) => ({ role, name }));
      const ba = await API.post(`/opnames/${id}/close`, { apply_changes: v.apply_changes, notes: v.notes, signatories: sig }); location.hash = '#/ba/' + ba.id; } });
});

// ---------- Persediaan ----------
route(/^#\/persediaan$/, async (view, _, q) => {
  const rows = await API.get('/consumables', q);
  view.innerHTML = App.head('Barang persediaan (habis pakai)', 'Kertas, spidol, toner, dan barang habis pakai lainnya. Pengeluaran dapat dibuatkan berita acara serah terima.',
    App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Tambah barang</button>` : '') + `
    <div class="filters"><input type="search" data-f="q" placeholder="Cari barang" value="${esc(q.q || '')}"><label class="check"><input type="checkbox" id="low" ${q.low ? 'checked' : ''}> Hanya stok menipis</label></div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada barang persediaan.', rowAttr: c => `class="click" data-c="${c.id}"`, columns: [{ label: 'Kode', render: c => `<span class="mono">${esc(c.code || '')}</span>` }, { label: 'Barang', key: 'name' },
      { label: 'Stok', num: true, render: c => `${fmt.num(c.stock, 2)} ${esc(c.uom)} ${Number(c.stock) <= Number(c.min_stock) ? '<span class="badge bad">menipis</span>' : ''}` }, { label: 'Min.', num: true, render: c => fmt.num(c.min_stock) },
      { label: 'Harga terakhir', num: true, render: c => fmt.rp(c.last_price) }, { label: 'Nilai stok', num: true, render: c => fmt.rp(c.stock * c.last_price) }, { label: 'Unit', key: 'unit_name' }] })}</div>`;
  bindFilters(view, '#/persediaan', q);
  $('#low').onchange = e => setQ('#/persediaan', { ...q, low: e.target.checked ? 1 : '' });
  const F = [{ name: 'code', label: 'Kode barang' }, { name: 'name', label: 'Nama barang', required: true }, { name: 'uom', label: 'Satuan', default: 'pcs' }, { name: 'min_stock', label: 'Stok minimum', type: 'number', min: 0 },
    ...(App.isSA() ? [{ name: 'unit_id', label: 'Unit', type: 'select', options: await Ref.opts('units', u => u.name) }] : [])];
  const add = $('#add'); if (add) add.onclick = () => UI.formModal({ title: 'Tambah barang persediaan', fields: F, onSubmit: async v => { await API.post('/consumables', v); App.render(); } });
  view.onclick = async e => {
    const tr = e.target.closest('[data-c]'); if (!tr) return;
    const c = rows.find(x => x.id === Number(tr.dataset.c)), tx = await API.get(`/consumables/${c.id}/tx`);
    const m = UI.modal({ title: `${c.name} — stok ${fmt.num(c.stock, 2)} ${c.uom}`, wide: true, body: UI.table({ rows: tx, empty: 'Belum ada transaksi.', columns: [{ label: 'Tanggal', render: t => fmt.date(t.tx_date) },
      { label: 'Jenis', render: t => badge(t.tx_type, { masuk: ['Masuk', 'ok'], keluar: ['Keluar', 'warn'], penyesuaian: ['Penyesuaian', 'info'] }) }, { label: 'Jumlah', num: true, render: t => fmt.num(t.qty, 2) },
      { label: 'Harga', num: true, render: t => fmt.rp(t.unit_price) }, { label: 'Untuk', render: t => esc([t.room_code, t.person_name].filter(Boolean).join(' / ')) }, { label: 'Ket.', render: t => esc(t.note || '') + (t.ba_id ? ` <a href="#/ba/${t.ba_id}">BA</a>` : '') }] }),
      actions: App.canWrite() ? [{ label: 'Ubah barang', onClick: () => { setTimeout(() => UI.formModal({ title: 'Ubah barang', fields: F, values: c, onSubmit: async v => { await API.put('/consumables/' + c.id, v); App.render(); } })); } },
        { label: 'Catat transaksi', kind: 'primary', onClick: () => { setTimeout(async () => UI.formModal({ title: 'Transaksi persediaan', values: { tx_type: 'keluar', tx_date: fmt.ymd(new Date()), unit_price: c.last_price },
          fields: [{ name: 'tx_type', label: 'Jenis', type: 'select', empty: false, options: [['masuk', 'Masuk (pembelian)'], ['keluar', 'Keluar (pemakaian)'], ['penyesuaian', 'Penyesuaian (+/−)']].map(([a, b]) => ({ value: a, label: b })) },
            { name: 'qty', label: `Jumlah (${c.uom})`, type: 'number', step: 'any', required: true }, { name: 'unit_price', label: 'Harga satuan (Rp)', type: 'money' }, { name: 'tx_date', label: 'Tanggal', type: 'date' },
            { name: 'room_id', label: 'Untuk ruang', type: 'select', options: await Ref.roomOpts(!App.isSA()) }, { name: 'person_id', label: 'Diterima oleh', type: 'select', options: await personOpts() },
            { name: 'note', label: 'Keterangan', type: 'textarea' }, { name: 'make_ba', label: 'Buat berita acara serah terima (untuk barang keluar)', type: 'checkbox' }],
          onSubmit: async v => { const r = await API.post(`/consumables/${c.id}/tx`, v); if (r.ba_id) location.hash = '#/ba/' + r.ba_id; else App.render(); } })); } }] : [] });
    return m;
  };
});

// ---------- Berita acara ----------
route(/^#\/ba$/, async (view, _, q) => {
  const rows = await API.get('/ba', q);
  view.innerHTML = App.head('Berita acara', 'Dokumen yang terbit dari stock opname, mutasi, penghapusan, dan serah terima persediaan, atau dibuat manual.', App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Buat manual</button>` : '') + `
    <div class="filters"><select data-f="type"><option value="">Semua jenis</option>${UI.options(Object.entries(BA_TYPES).map(([k, v]) => ({ value: k, label: v })), q.type)}</select>
      <input type="date" data-f="from" value="${esc(q.from || '')}" style="width:auto" aria-label="Dari"><input type="date" data-f="to" value="${esc(q.to || '')}" style="width:auto" aria-label="Sampai"></div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada berita acara.', rowAttr: b => `class="click" data-b="${b.id}"`, columns: [{ label: 'Nomor', render: b => `<span class="mono">${esc(b.number)}</span>` }, { label: 'Tanggal', render: b => fmt.date(b.ba_date) },
      { label: 'Jenis', render: b => BA_TYPES[b.ba_type] || b.ba_type }, { label: 'Perihal', key: 'title' }, { label: 'Unit', key: 'unit_name' }, { label: 'Status', render: b => badge(b.status) + (b.file_count ? ` <small>${b.file_count} lampiran</small>` : '') }] })}</div>`;
  bindFilters(view, '#/ba', q);
  view.onclick = e => { const tr = e.target.closest('[data-b]'); if (tr) location.hash = '#/ba/' + tr.dataset.b; };
  const add = $('#add'); if (add) add.onclick = () => UI.formModal({ title: 'Buat berita acara', wide: true, values: { ba_type: 'serah_terima', ba_date: fmt.ymd(new Date()) },
    fields: [{ name: 'ba_type', label: 'Jenis', type: 'select', empty: false, options: [['serah_terima', 'Serah terima'], ['perbaikan', 'Perbaikan'], ['lainnya', 'Lainnya']].map(([a, b]) => ({ value: a, label: b })) },
      { name: 'ba_date', label: 'Tanggal', type: 'date' }, { name: 'title', label: 'Perihal', required: true, full: true }, { name: 'text', label: 'Isi berita acara', type: 'textarea', required: true },
      { name: 's1', label: 'Pihak pertama' }, { name: 's2', label: 'Pihak kedua' }, { name: 's3', label: 'Mengetahui' }],
    onSubmit: async v => { const b = await API.post('/ba', { ba_type: v.ba_type, ba_date: v.ba_date, title: v.title, content: { text: v.text }, signatories: [['Pihak pertama', v.s1], ['Pihak kedua', v.s2], ['Mengetahui', v.s3]].filter(x => x[1]).map(([role, name]) => ({ role, name })) }); location.hash = '#/ba/' + b.id; } });
});
route(/^#\/ba\/(\d+)$/, async (view, [id]) => {
  const b = await API.get('/ba/' + id), c = b.content || {}, org = b.org || {};
  const d = new Date(b.ba_date + 'T00:00:00');
  const itemTable = (items, cols) => items && items.length ? `<table><thead><tr><th>No</th>${cols.map(x => `<th>${x[1]}</th>`).join('')}</tr></thead><tbody>${items.map((it, i) => `<tr><td>${i + 1}</td>${cols.map(x => `<td>${x[2] ? x[2](it[x[0]]) : esc(it[x[0]] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p><i>Nihil.</i></p>';
  let isi = '';
  if (b.ba_type === 'mutasi') isi = `<p>Telah dilakukan mutasi barang (${esc(c.mutation_number || '')}) dengan jenis <b>${esc(c.type || '')}</b>${c.to_room ? ` ke ruang <b>${esc(c.to_room.code)} — ${esc(c.to_room.name)}</b> (${esc(c.to_room.building)})` : ''}${c.to_holder ? ` kepada <b>${esc(c.to_holder.name)}</b>${c.to_holder.id_number ? ' (' + esc(c.to_holder.id_number) + ')' : ''}` : ''}, dengan alasan: ${esc(c.reason || '-')}. Rincian barang:</p>
    ${itemTable(c.items, [['tag', 'Kode barang'], ['name', 'Nama barang'], ['room_code', 'Ruang asal'], ['holder', 'Pemegang asal'], ['condition', 'Kondisi', v => esc((COND[v] || [v])[0])], ['price', 'Nilai', fmt.rp]])}
    ${b.files && b.files.length ? `<p>Dokumen penyerta: ${b.files.map(f => `<a href="${API.file(f.id)}" target="_blank">${esc(f.title || f.file_name)}</a>`).join(', ')}</p>` : ''}`;
  else if (b.ba_type === 'penghapusan') isi = `<p>Telah dilakukan penghapusan barang dengan cara <b>${esc(c.method)}</b>, dengan alasan: ${esc(c.reason)}. Rincian:</p>${itemTable(c.items, [['tag', 'Kode barang'], ['name', 'Nama barang'], ['room_code', 'Ruang'], ['condition', 'Kondisi', v => esc((COND[v] || [v])[0])], ['price', 'Nilai perolehan', fmt.rp]])}
    <p>Total nilai perolehan: <b>${fmt.rp((c.items || []).reduce((s, x) => s + Number(x.price || 0), 0))}</b></p>`;
  else if (b.ba_type === 'stock_opname') { const s = c.summary || {}; isi = `<p>Telah dilaksanakan stock opname barang milik negara dengan hasil sebagai berikut:</p>
    <table><tbody><tr><td>Jumlah aset tercatat</td><td>${s.total}</td></tr><tr><td>Ditemukan sesuai</td><td>${s.found}</td></tr><tr><td>Tidak ditemukan</td><td>${s.missing}</td></tr><tr><td>Belum dicek</td><td>${s.unchecked}</td></tr>
    <tr><td>Berada di ruang lain</td><td>${s.misplaced}</td></tr><tr><td>Berubah kondisi</td><td>${s.condition_changed}</td></tr><tr><td>Nilai perolehan aset tercatat</td><td>${fmt.rp(s.value_total)}</td></tr></tbody></table>
    <p><b>A. Barang tidak ditemukan</b></p>${itemTable(c.missing, [['tag', 'Kode'], ['name', 'Nama'], ['expected_room', 'Ruang tercatat']])}
    <p><b>B. Barang berada di ruang lain</b></p>${itemTable(c.misplaced, [['tag', 'Kode'], ['name', 'Nama'], ['expected_room', 'Tercatat'], ['found_room', 'Ditemukan']])}
    <p><b>C. Barang berubah kondisi</b></p>${itemTable(c.condition_changed, [['tag', 'Kode'], ['name', 'Nama'], ['condition_before', 'Sebelum', v => esc((COND[v] || [v])[0])], ['condition_found', 'Hasil opname', v => esc((COND[v] || [v])[0])]])}
    <p>Hasil opname ${c.applied ? 'telah' : 'belum'} diterapkan ke data inventaris.</p>`; }
  else if (b.ba_type === 'persediaan') isi = `<p>Telah diserahterimakan barang persediaan${c.receiver ? ` kepada <b>${esc(c.receiver.name)}</b>` : ''}${c.room ? ` untuk ruang ${esc(c.room.code)} — ${esc(c.room.name)}` : ''}:</p>${itemTable(c.items, [['code', 'Kode'], ['name', 'Nama'], ['qty', 'Jumlah'], ['uom', 'Satuan'], ['unit_price', 'Harga satuan', fmt.rp]])}${c.note ? `<p>${esc(c.note)}</p>` : ''}`;
  else isi = `<p style="white-space:pre-wrap">${esc(c.text || '')}</p>`;
  const sig = b.signatories && b.signatories.length ? b.signatories : [{ role: 'Pengelola barang', name: '' }, { role: 'Mengetahui', name: b.head_name || '', nip: b.head_nip || '' }];
  view.innerHTML = `<div class="page-head no-print"><a class="btn" href="#/ba">Kembali</a><div class="actions">${App.canWrite() && b.status === 'draft' ? `<button class="btn" id="sig">Ubah penanda tangan & catatan</button><button class="btn" id="fin">Tandai final</button>` : ''}<button class="btn primary" onclick="print()">${I('print')} Cetak</button></div></div>
    <div class="doc"><div class="kop"><div>${I('building')}</div><div><b style="font-size:13pt">${esc(org.name || '')}</b><br>${esc(org.unit_label || '')}${b.unit_name ? ' · ' + esc(b.unit_name) : ''}</div></div>
      <h2>${esc(b.title).toUpperCase()}</h2><div class="no">Nomor: ${esc(b.number)}</div>
      <p>Pada hari ini ${HARI[d.getDay()]}, tanggal ${d.getDate()} ${['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][d.getMonth()]} ${d.getFullYear()}, yang bertanda tangan di bawah ini menyatakan:</p>
      ${isi}${c.notes ? `<p><b>Catatan:</b> ${esc(c.notes)}</p>` : ''}<p>Demikian berita acara ini dibuat untuk dipergunakan sebagaimana mestinya.</p>
      <p style="text-align:right">${esc(org.city || '')}, ${fmt.date(b.ba_date)}</p>
      <div class="signs">${sig.map(s => `<div>${esc(s.role)}<div class="sp"></div><b><u>${esc(s.name || '……………………')}</u></b>${s.nip ? `<br>NIP. ${esc(s.nip)}` : ''}</div>`).join('')}</div>
      ${b.status === 'draft' ? '<p class="no-print muted" style="margin-top:24px">Status: draf</p>' : ''}</div>`;
  const s = $('#sig'); if (s) s.onclick = () => UI.formModal({ title: 'Penanda tangan', wide: true, values: { notes: c.notes, ...Object.fromEntries(sig.flatMap((x, i) => [[`r${i}`, x.role], [`n${i}`, x.name], [`p${i}`, x.nip]])) },
    fields: [0, 1, 2].flatMap(i => [{ name: `r${i}`, label: `Jabatan ${i + 1}` }, { name: `n${i}`, label: `Nama ${i + 1}` }, { name: `p${i}`, label: `NIP ${i + 1}` }]).concat([{ name: 'notes', label: 'Catatan', type: 'textarea' }]),
    onSubmit: async v => { await API.put('/ba/' + id, { notes: v.notes, signatories: [0, 1, 2].filter(i => v[`r${i}`]).map(i => ({ role: v[`r${i}`], name: v[`n${i}`], nip: v[`p${i}`] })) }); App.render(); } });
  const f = $('#fin'); if (f) f.onclick = async () => { if (await UI.confirm('Tandai final? Berita acara final tidak dapat diubah oleh admin unit.')) { await API.put('/ba/' + id, { status: 'final' }); App.render(); } };
});

// ---------- Valuasi ----------
route(/^#\/valuasi$/, async (view, _, q) => {
  const group = q.group || 'room';
  const rows = await API.get('/valuation', { group, unit_id: q.unit_id });
  const tot = rows.reduce((s, r) => ({ qty: s.qty + r.qty, value: s.value + r.value, book: s.book + r.book_value }), { qty: 0, value: 0, book: 0 });
  const link = { room: 'room_id', holder: 'holder_id', unit: 'unit_id', building: 'building_id' }[group];
  view.innerHTML = App.head('Valuasi aset', `Total ${fmt.num(tot.qty)} aset · nilai perolehan ${fmt.rp(tot.value)} · nilai buku ${fmt.rp(tot.book)}`, await unitFilter(q.unit_id)) +
    `<div class="tabs" id="tabs"></div><div class="panel">${UI.table({ rows, rowAttr: r => (link && r.id ? `class="click" data-go="#/aset?${link}=${r.id}"` : group === 'code' ? `class="click" data-go="#/aset?code=${encodeURIComponent(r.label.split(' ')[0])}"` : ''),
      columns: [{ label: { room: 'Ruang', holder: 'Pemegang', unit: 'Unit', building: 'Gedung', code: 'Bidang barang' }[group], render: r => `<b>${esc(r.label)}</b>${r.sub && group !== 'code' ? `<br><small>${esc(r.sub)}</small>` : ''}` },
        { label: 'Jumlah', num: true, render: r => fmt.num(r.qty) }, { label: 'Rusak', num: true, render: r => r.broken ? `<span class="badge bad">${r.broken}</span>` : '0' },
        { label: 'Nilai perolehan', num: true, render: r => fmt.rp(r.value) }, { label: 'Akumulasi penyusutan', num: true, render: r => fmt.rp(r.value - r.book_value) }, { label: 'Nilai buku', num: true, render: r => fmt.rp(r.book_value) },
        { label: 'Porsi', render: r => `<div class="meter" style="width:120px"><i style="width:${tot.value ? (100 * r.value) / tot.value : 0}%"></i></div>` }],
      foot: `<td>Total</td><td class="num">${fmt.num(tot.qty)}</td><td></td><td class="num">${fmt.rp(tot.value)}</td><td class="num">${fmt.rp(tot.value - tot.book)}</td><td class="num">${fmt.rp(tot.book)}</td><td></td>` })}</div>
    <p class="muted" style="font-size:13px;margin-top:10px">Nilai buku = nilai perolehan − akumulasi penyusutan (garis lurus, sesuai kebijakan di Pengaturan › Organisasi). Aset yang tidak disusutkan (tanah, KDP, persediaan, di bawah nilai kapitalisasi, atau tanpa masa manfaat) dinilai sebesar harga perolehan. <a href="#/laporan?kind=penyusutan">Laporan penyusutan</a></p>`;
  UI.tabs($('#tabs'), [['room', 'Per ruang'], ['holder', 'Per pemegang'], ['building', 'Per gedung'], ['unit', 'Per unit'], ['code', 'Per bidang barang']], group, g => setQ('#/valuasi', { ...q, group: g }));
  const u = $('[data-f=unit_id]', view); if (u) u.onchange = () => setQ('#/valuasi', { ...q, unit_id: u.value });
  view.onclick = e => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = tr.dataset.go; };
});
