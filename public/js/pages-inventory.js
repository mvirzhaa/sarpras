/* ===== Aset tetap (pengadaan, pemakaian, laporan, log) & aset lancar (pembelian, pemakaian, opname, laporan, log) ===== */
'use strict';
const monthStart = () => fmt.ymd(new Date()).slice(0, 8) + '01';
const csvDownload = (name, head, rows) => {
  const q = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['\ufeff' + [head.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
};
// Tampilan laporan generik (dipakai laporan aset tetap & persediaan)
Pages.reportBody = (rep) => {
  const cell = (c, r) => { const v = r[c.key]; return c.type === 'money' ? fmt.rp(v) : c.type === 'pct' ? `${fmt.num(v, 1)}%` : c.type === 'num' ? fmt.num(v, 2) : c.key === 'condition' && COND[v] ? COND[v][0] : esc(v ?? ''); };
  return `<div class="panel panel-body"><div style="text-align:center;margin-bottom:20px"><h2>${esc(rep.title)}</h2><p>${esc(rep.org.name || '')} · ${esc(rep.unit)}<br>
    <small class="muted">${rep.from === rep.to ? `Per ${fmt.date(rep.to)}` : `Periode ${fmt.date(rep.from)} s.d. ${fmt.date(rep.to)}`} · dicetak ${fmt.dt(rep.generated_at)}</small></p></div>
    ${rep.sections.map(s => `<section class="report-sec"><h3>${esc(s.title)}</h3>${s.note ? `<p class="muted" style="font-size:13px">${esc(s.note)}</p>` : ''}
      ${UI.table({ rows: s.rows, empty: 'Nihil.', columns: s.columns.map(c => ({ label: c.label, num: ['num', 'money', 'pct'].includes(c.type), render: r => cell(c, r) })) })}</section>`).join('')}</div>`;
};
const xlsxBtn = (kind, params) => `<a class="btn" href="${API.url('/reports/' + kind, { ...params, format: 'xlsx' })}">${I('dl')} Unduh Excel</a><button class="btn primary" onclick="print()">${I('print')} Cetak</button>`;

// =====================================================================
// ASET TETAP — PEMBELIAN / PENGADAAN
// =====================================================================
route(/^#\/aset-pembelian$/, async (view, _, q) => {
  const rows = await API.get('/acquisitions', q);
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  view.innerHTML = App.head('Pembelian / pengadaan aset tetap', 'Satu dokumen pengadaan dapat berisi banyak jenis barang. Setiap unit barang otomatis teregistrasi sebagai aset dengan NUP dan QR, serta terbit berita acara penerimaan.',
    App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Catat pengadaan</button>` : '') + `
    <div class="filters"><input type="search" data-f="q" placeholder="Cari nomor, penyedia, no. kontrak" value="${esc(q.q || '')}">
      <input type="date" data-f="from" value="${esc(q.from || '')}" style="width:auto" aria-label="Dari"><input type="date" data-f="to" value="${esc(q.to || '')}" style="width:auto" aria-label="Sampai"></div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada pengadaan.', rowAttr: r => `class="click" data-go="#/aset-pembelian/${r.id}"`, columns: [
      { label: 'Nomor', render: r => `<span class="mono">${esc(r.number)}</span>` }, { label: 'Tanggal', render: r => fmt.date(r.acq_date) }, { label: 'Cara', key: 'method' },
      { label: 'Penyedia', render: r => `${esc(r.vendor || '–')}<br><small>${esc(r.document_no || '')}</small>` }, { label: 'Unit aset', num: true, render: r => r.asset_count },
      { label: 'Nilai', num: true, render: r => fmt.rp(r.total) }, { label: 'Dokumen', render: r => (r.ba_number ? `BA ${esc(r.ba_number)}` : '–') + (r.file_count ? ` · ${r.file_count} lampiran` : '') }],
    foot: `<td colspan="5">Total</td><td class="num">${fmt.rp(total)}</td><td></td>` })}</div>`;
  bindFilters(view, '#/aset-pembelian', q);
  view.onclick = e => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = tr.dataset.go; };
  const add = $('#add'); if (add) add.onclick = () => Pages.acquisitionForm();
});
Pages.acquisitionForm = async () => {
  const [rooms, people] = await Promise.all([Ref.roomOpts(!App.isSA()), personOpts()]);
  const head = [{ name: 'acq_date', label: 'Tanggal perolehan', type: 'date', required: true, default: fmt.ymd(new Date()) },
    { name: 'method', label: 'Cara perolehan', type: 'select', empty: false, options: ACQ.map(([a, b]) => ({ value: a, label: b })) },
    { name: 'vendor', label: 'Penyedia / pemberi hibah' }, { name: 'document_no', label: 'No. kontrak / SPK / faktur' }, { name: 'funding_source', label: 'Sumber dana' },
    ...(App.isSA() ? [{ name: 'unit_id', label: 'Unit', type: 'select', options: await Ref.opts('units', u => u.name) }] : []),
    { name: 'sig1', label: 'Yang menyerahkan (penyedia)' }, { name: 'sig2', label: 'Yang menerima' }, { name: 'files', label: 'Lampiran (kontrak, faktur, BAST)', type: 'file', multiple: true }, { name: 'notes', label: 'Catatan', type: 'textarea' }];
  const itemF = [{ name: 'asset_code_id', label: 'Kode barang (Sub-sub Kelompok)', type: 'code', required: true, full: true }, { name: 'name', label: 'Nama barang', required: true, full: true },
    { name: 'brand', label: 'Merek' }, { name: 'model', label: 'Tipe' }, { name: 'quantity', label: 'Jumlah unit', type: 'number', min: 1, default: 1, required: true }, { name: 'price', label: 'Harga satuan (Rp)', type: 'money', required: true },
    { name: 'room_id', label: 'Ruang penempatan', type: 'select', options: rooms }, { name: 'holder_id', label: 'Pemegang', type: 'select', options: people },
    { name: 'useful_life_years', label: 'Masa manfaat (th)', type: 'number', min: 0 }, { name: 'condition', label: 'Kondisi', type: 'select', empty: false, options: condOpts },
    { name: 'specification', label: 'Spesifikasi', type: 'textarea' }];
  const card = () => `<div class="con-card acq-item"><div class="btn-row" style="justify-content:space-between;margin-bottom:8px"><b class="no"></b><button class="btn ghost sm" data-rmi aria-label="Hapus baris">${I('trash')}</button></div>${UI.form(itemF)}</div>`;
  const m = UI.modal({ title: 'Catat pengadaan aset tetap', wide: true, body: `<div id="acqHead">${UI.form(head, { method: 'pembelian' })}</div>
      <h3 style="margin:18px 0 8px">Daftar barang</h3><div id="items">${card()}</div><button class="btn sm" id="addItem" style="margin-top:10px">${I('plus')} Tambah barang</button>
      <p style="margin-top:14px;text-align:right">Total nilai: <b id="tot">Rp 0</b></p>`,
  actions: [{ label: 'Batal' }, { label: 'Simpan & registrasi aset', kind: 'primary', onClick: async () => {
    const h = UI.read($('#acqHead', m.el), head);
    const items = $$('.acq-item', m.el).map((c, i) => { try { return UI.read(c, itemF); } catch (e) { throw new Error(`Barang ${i + 1}: ${e.message}`); } });
    const sig = [h.sig1 && { role: 'Yang menyerahkan', name: h.sig1 }, h.sig2 && { role: 'Yang menerima', name: h.sig2 }].filter(Boolean);
    const r = await API.post('/acquisitions', { ...h, items, signatories: sig, files: undefined });
    for (const f of h.files || []) await API.upload(f, { entity_type: 'acquisition', entity_id: r.id, doc_type: 'dokumen_pengadaan', title: f.name });
    UI.toast(`${r.number}: ${r.assets} unit aset teregistrasi`); location.hash = '#/aset-pembelian/' + r.id;
  } }] });
  const renum = () => { $$('.acq-item', m.el).forEach((c, i) => ($('.no', c).textContent = `Barang ${i + 1}`)); total(); };
  const total = () => { let t = 0; $$('.acq-item', m.el).forEach(c => { t += (Number($('[name=quantity]', c).value) || 0) * (Number($('[name=price]', c).value) || 0); }); $('#tot', m.el).textContent = fmt.rp(t); };
  UI.bindPickers($('#items', m.el)); renum();
  m.body.addEventListener('input', total);
  m.body.addEventListener('picked', e => { const c = e.target.closest('.acq-item'); const n = $('[name=name]', c); if (c && !n.value) n.value = e.target.value.replace(/^[\d.]+\s/, ''); });
  m.body.addEventListener('click', e => {
    if (e.target.closest('#addItem')) { $('#items', m.el).insertAdjacentHTML('beforeend', card()); UI.bindPickers($('#items', m.el).lastElementChild); renum(); }
    const rm = e.target.closest('[data-rmi]'); if (rm && $$('.acq-item', m.el).length > 1) { rm.closest('.acq-item').remove(); renum(); }
  });
};
route(/^#\/aset-pembelian\/(\d+)$/, async (view, [id]) => {
  const q = await API.get('/acquisitions/' + id);
  view.innerHTML = App.head(`Pengadaan ${q.number}`, `${fmt.date(q.acq_date)} · ${esc(q.method)} · ${esc(q.vendor || '')} ${q.document_no ? '· ' + esc(q.document_no) : ''}`,
    `<a class="btn" href="#/aset-pembelian">Kembali</a>${q.ba_id ? `<a class="btn" href="#/ba/${q.ba_id}">${I('doc')} Berita acara</a>` : ''}<button class="btn primary" id="lbl">${I('qr')} Cetak label semua</button>`) + `
    <div class="stats"><div class="stat"><b>${q.assets.length}</b><span>Unit aset</span></div><div class="stat"><b style="font-size:19px">${fmt.rp(q.total)}</b><span>Nilai pengadaan</span></div>
      <div class="stat"><b style="font-size:16px">${esc(q.funding_source || '–')}</b><span>Sumber dana</span></div><div class="stat"><b style="font-size:16px">${esc(q.unit_name || '–')}</b><span>Unit</span></div></div>
    <div class="grid2"><div class="panel" style="grid-column:1/-1">${UI.table({ rows: q.assets, rowAttr: a => `class="click" data-a="${a.id}"`, columns: [{ label: 'Kode aset', render: a => `<span class="tag">${esc(a.tag)}</span>` },
      { label: 'Nama', render: a => `${esc(a.name)}<br><small>${esc([a.brand, a.model].filter(Boolean).join(' '))}</small>` }, { label: 'Penempatan', render: a => esc([a.room_code, a.holder_name].filter(Boolean).join(' / ') || '–') },
      { label: 'Kondisi', render: a => badge(a.condition, COND) }, { label: 'Harga', num: true, render: a => fmt.rp(a.price) }] })}</div>
    <div class="panel"><div class="panel-head"><h3>Lampiran</h3></div><div class="panel-body" id="docs"></div></div>${q.notes ? `<div class="panel panel-body"><h3>Catatan</h3><p>${esc(q.notes)}</p></div>` : ''}</div>`;
  filesPanel($('#docs'), 'acquisition', q.id, App.canWrite(), [['kontrak', 'Kontrak/SPK'], ['faktur', 'Faktur/kuitansi'], ['bast', 'BAST'], ['foto', 'Foto'], ['lainnya', 'Lainnya']]);
  $('#lbl').onclick = () => { sessionStorage.setItem('sp_labels', JSON.stringify(q.assets.map(a => a.id))); location.hash = '#/label'; };
  view.onclick = e => { const tr = e.target.closest('[data-a]'); if (tr) location.hash = '#/aset/' + tr.dataset.a; };
});

// =====================================================================
// ASET TETAP — PEMAKAIAN (PINJAM PAKAI)
// =====================================================================
Pages.loanForm = async (preIds = []) => {
  const people = await personOpts();
  let picked = preIds.length ? (await API.get('/assets', { ids: preIds.join(','), limit: 500 })).rows : [];
  const F = [{ name: 'borrower_id', label: 'Pemakai (dosen/pegawai)', type: 'select', required: true, options: people, full: true },
    { name: 'start_date', label: 'Tanggal mulai', type: 'date', default: fmt.ymd(new Date()), required: true }, { name: 'due_date', label: 'Batas pengembalian', type: 'date', help: 'Kosongkan untuk pemakaian tanpa batas waktu' },
    { name: 'location', label: 'Lokasi pemakaian', placeholder: 'mis. rumah dinas, ruang kerja, kegiatan luar kampus' }, { name: 'purpose', label: 'Keperluan', type: 'textarea', required: true }];
  const m = UI.modal({ title: 'Catat pemakaian aset (pinjam pakai)', wide: true, body: `${UI.form(F)}<h3 style="margin:16px 0 8px">Aset yang dipakai</h3>
      <div class="picker"><input id="aq" placeholder="Cari kode aset atau nama barang…" autocomplete="off"><div class="picker-list" hidden id="al"></div></div><div id="picked" style="margin-top:10px"></div>`,
  actions: [{ label: 'Batal' }, { label: 'Simpan & buat berita acara', kind: 'primary', onClick: async () => {
    const v = UI.read(m.body, F); if (!picked.length) throw new Error('Pilih minimal satu aset');
    const r = await API.post('/loans', { ...v, asset_ids: picked.map(a => a.id) }); UI.toast(`Pemakaian ${r.number} tercatat`); location.hash = '#/ba/' + r.ba_id;
  } }] });
  const draw = () => { $('#picked', m.el).innerHTML = picked.length ? `<ul class="room-list">${picked.map(a => `<li style="cursor:default"><span class="tag">${esc(a.tag)}</span><span style="flex:1">${esc(a.name)}</span>${badge(a.condition, COND)}<button class="btn ghost sm" data-unpick="${a.id}" aria-label="Hapus">${I('x')}</button></li>`).join('')}</ul>` : '<p class="muted">Belum ada aset dipilih.</p>'; };
  let t; draw();
  $('#aq', m.el).oninput = e => { clearTimeout(t); t = setTimeout(async () => { const v = e.target.value.trim(), l = $('#al', m.el); if (v.length < 2) { l.hidden = true; return; }
    const rows = (await API.get('/assets', { q: v, limit: 20 })).rows.filter(a => !picked.some(p => p.id === a.id));
    l.innerHTML = rows.map(a => `<div data-pick="${a.id}"><span class="mono">${esc(a.tag)}</span> ${esc(a.name)} <small class="muted">${esc(a.room_code || '')}</small></div>`).join('') || '<div class="muted">Tidak ditemukan</div>';
    l.hidden = false; l.onmousedown = ev => { const d = ev.target.closest('[data-pick]'); if (!d) return; picked.push(rows.find(a => a.id === Number(d.dataset.pick))); l.hidden = true; e.target.value = ''; draw(); }; }, 220); };
  m.body.addEventListener('click', e => { const u = e.target.closest('[data-unpick]'); if (u) { picked = picked.filter(a => a.id !== Number(u.dataset.unpick)); draw(); } });
};
route(/^#\/aset-pemakaian$/, async (view, _, q) => {
  const tab = q.status || 'aktif';
  const rows = await API.get('/loans', { status: tab === 'semua' ? '' : tab });
  view.innerHTML = App.head('Pemakaian aset tetap (pinjam pakai)', 'Serah terima pemakaian aset kepada dosen/pegawai, misalnya laptop, proyektor, atau kendaraan, beserta pengembaliannya. Berita acara terbit otomatis.',
    App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Catat pemakaian</button>` : '') + `<div class="tabs" id="tabs"></div>
    <div class="panel">${UI.table({ rows, empty: 'Tidak ada data.', columns: [{ label: 'Nomor', render: l => `<span class="mono">${esc(l.number)}</span>${l.ba_id ? `<br><a href="#/ba/${l.ba_id}"><small>BA serah terima</small></a>` : ''}` },
      { label: 'Pemakai', render: l => `<b>${esc(l.borrower_name || '–')}</b><br><small>${esc(l.borrower_unit || '')}</small>` },
      { label: 'Aset', render: l => (l.items || []).map(i => `<span class="tag">${esc(i.tag)}</span> ${esc(i.name)}`).join('<br>') },
      { label: 'Periode', render: l => `${fmt.date(l.start_date)} – ${l.due_date ? fmt.date(l.due_date) : 'tanpa batas'}${l.returned_date ? `<br><small>kembali ${fmt.date(l.returned_date)}</small>` : ''}` },
      { label: 'Keperluan', render: l => esc(l.purpose || '') },
      { label: 'Status', render: l => (l.overdue ? '<span class="badge bad">Terlambat</span>' : l.status === 'dipinjam' ? '<span class="badge info">Dipakai</span>' : '<span class="badge ok">Dikembalikan</span>') },
      { label: '', render: l => (l.status === 'dipinjam' && App.canWrite() ? `<button class="btn sm primary" data-ret="${l.id}">Pengembalian</button>` : l.return_ba_id ? `<a class="btn sm" href="#/ba/${l.return_ba_id}">BA kembali</a>` : '') }] })}</div>`;
  UI.tabs($('#tabs'), [['aktif', 'Sedang dipakai'], ['terlambat', 'Terlambat'], ['selesai', 'Sudah dikembalikan'], ['semua', 'Semua']], tab, t => setQ('#/aset-pemakaian', { status: t }));
  const add = $('#add'); if (add) add.onclick = () => Pages.loanForm();
  view.onclick = e => {
    const b = e.target.closest('[data-ret]'); if (!b) return;
    const l = rows.find(x => x.id === Number(b.dataset.ret));
    const m = UI.modal({ title: `Pengembalian ${l.number}`, wide: true, body: `<p>Pemakai: <b>${esc(l.borrower_name || '')}</b>. Periksa kondisi setiap barang saat diterima kembali.</p>
      ${UI.table({ rows: l.items, columns: [{ label: 'Kode aset', render: i => `<span class="tag">${esc(i.tag)}</span>` }, { label: 'Nama', key: 'name' }, { label: 'Kondisi saat diserahkan', render: i => badge(i.condition_out, COND) },
        { label: 'Kondisi saat kembali', render: i => `<select data-cin="${i.id}" style="width:auto">${UI.options(condOpts, i.condition_out)}</select>` }] })}
      <div class="form-grid" style="margin-top:12px">${UI.field({ name: 'returned_date', label: 'Tanggal kembali', type: 'date' }, fmt.ymd(new Date()))}${UI.field({ name: 'notes', label: 'Catatan', type: 'textarea' })}</div>`,
    actions: [{ label: 'Batal' }, { label: 'Simpan pengembalian', kind: 'primary', onClick: async () => {
      const r = await API.post(`/loans/${l.id}/return`, { returned_date: $('[name=returned_date]', m.el).value, notes: $('[name=notes]', m.el).value, items: $$('[data-cin]', m.el).map(s => ({ asset_id: Number(s.dataset.cin), condition_in: s.value })) });
      UI.toast('Pengembalian tercatat'); location.hash = '#/ba/' + r.ba_id;
    } }] });
  };
});

// =====================================================================
// ASET TETAP — LAPORAN & LOG
// =====================================================================
route(/^#\/aset-laporan$/, async (view, _, q) => {
  const tab = q.tab || 'aset';
  const params = tab === 'dir' ? { room_id: q.room_id } : tab === 'penyusutan' ? { date: q.date || fmt.ymd(new Date()) } : { from: q.from || monthStart(), to: q.to || fmt.ymd(new Date()) };
  const filters = tab === 'dir' ? `<select data-f="room_id" style="min-width:280px"><option value="">— pilih ruang —</option>${UI.options(await Ref.roomOpts(!App.isSA() && App.me.role !== 'pimpinan'), q.room_id)}</select>`
    : tab === 'penyusutan' ? `<span class="muted">Per tanggal</span><input type="date" data-f="date" value="${params.date}" style="width:auto">`
      : `<input type="date" data-f="from" value="${params.from}" style="width:auto" aria-label="Dari"><span>s.d.</span><input type="date" data-f="to" value="${params.to}" style="width:auto" aria-label="Sampai">`;
  const ready = tab !== 'dir' || q.room_id;
  view.innerHTML = App.head('Laporan aset tetap', 'Rekapitulasi, Daftar Inventaris Ruangan (DIR), dan penyusutan.', ready ? xlsxBtn(tab, { ...params, unit_id: q.unit_id }) : '') +
    `<div class="tabs" id="tabs"></div><div class="filters">${filters}${tab !== 'dir' ? await unitFilter(q.unit_id) : ''}</div><div id="rep">${ready ? '<div class="empty">Memuat…</div>' : '<div class="empty">Pilih ruangan untuk menampilkan DIR.</div>'}</div>`;
  UI.tabs($('#tabs'), [['aset', 'Rekap & transaksi'], ['dir', 'Daftar inventaris ruangan'], ['penyusutan', 'Penyusutan']], tab, t => setQ('#/aset-laporan', { tab: t }));
  bindFilters(view, '#/aset-laporan', { ...q, tab });
  if (!ready) return;
  const rep = await API.get('/reports/' + tab, { ...params, unit_id: q.unit_id });
  $('#rep').innerHTML = Pages.reportBody(rep) + (tab === 'dir' ? `<div class="doc" style="border:0;padding:0 18mm"><div class="signs"><div>Penanggung jawab ruangan<div class="sp"></div>……………………</div><div>Pengelola barang<div class="sp"></div>……………………</div></div></div>` : '');
});
const LOG_ACT = { registrasi: 'Registrasi', mutasi: 'Mutasi', kondisi: 'Perubahan kondisi', perbaikan: 'Perbaikan', opname: 'Stock opname', penghapusan: 'Penghapusan', ubah_data: 'Ubah data', dipakai: 'Pemakaian', dikembalikan: 'Pengembalian' };
route(/^#\/aset-log$/, async (view, _, q) => {
  const page = Number(q.page) || 0, limit = 200;
  const res = await API.get('/asset-log', { ...q, limit, offset: page * limit });
  view.innerHTML = App.head('Log transaksi aset tetap', `${fmt.num(res.total)} transaksi: registrasi, mutasi, pemakaian & pengembalian, perubahan kondisi, perbaikan, opname, penghapusan.`, `<button class="btn" id="csv">${I('dl')} Unduh CSV</button>`) + `
    <div class="filters"><input type="search" data-f="q" placeholder="Kode aset, nama, keterangan" value="${esc(q.q || '')}">
      <select data-f="action"><option value="">Semua transaksi</option>${UI.options(Object.entries(LOG_ACT).map(([k, v]) => ({ value: k, label: v })), q.action)}</select>
      <input type="date" data-f="from" value="${esc(q.from || '')}" style="width:auto" aria-label="Dari"><input type="date" data-f="to" value="${esc(q.to || '')}" style="width:auto" aria-label="Sampai"></div>
    <div class="panel">${UI.table({ rows: res.rows, empty: 'Tidak ada transaksi.', rowAttr: h => `class="click" data-a="${h.asset_id}"`, columns: [{ label: 'Waktu', render: h => fmt.dt(h.created_at) },
      { label: 'Transaksi', render: h => `<b>${esc(LOG_ACT[h.action] || h.action)}</b>` }, { label: 'Aset', render: h => `<span class="tag">${esc(h.tag)}</span><br><small>${esc(h.name)}</small>` },
      { label: 'Dari', render: h => esc([h.from_room, h.from_holder, h.from_condition && (COND[h.from_condition] || [h.from_condition])[0]].filter(Boolean).join(' / ') || '–') },
      { label: 'Ke', render: h => esc([h.to_room, h.to_holder, h.to_condition && (COND[h.to_condition] || [h.to_condition])[0]].filter(Boolean).join(' / ') || '–') },
      { label: 'Keterangan', render: h => esc(h.note || '') }, { label: 'Petugas', render: h => esc(h.user_name || 'sistem') }] })}</div>
    <div class="btn-row" style="margin-top:12px">${page > 0 ? `<button class="btn sm" data-pg="${page - 1}">‹ Sebelumnya</button>` : ''}<span class="muted">Halaman ${page + 1} dari ${Math.max(1, Math.ceil(res.total / limit))}</span>${(page + 1) * limit < res.total ? `<button class="btn sm" data-pg="${page + 1}">Berikutnya ›</button>` : ''}</div>`;
  bindFilters(view, '#/aset-log', { ...q, page: '' });
  $('#csv').onclick = async () => { const all = await API.get('/asset-log', { ...q, limit: 5000, offset: 0 });
    csvDownload('log-aset-tetap.csv', ['waktu', 'transaksi', 'kode_aset', 'nama', 'dari', 'ke', 'keterangan', 'petugas'], all.rows.map(h => [fmt.dt(h.created_at), LOG_ACT[h.action] || h.action, h.tag, h.name,
      [h.from_room, h.from_holder, h.from_condition].filter(Boolean).join(' / '), [h.to_room, h.to_holder, h.to_condition].filter(Boolean).join(' / '), h.note, h.user_name])); };
  view.onclick = e => { const p = e.target.closest('[data-pg]'); if (p) return setQ('#/aset-log', { ...q, page: p.dataset.pg }); const tr = e.target.closest('[data-a]'); if (tr) location.hash = '#/aset/' + tr.dataset.a; };
});

// =====================================================================
// ASET LANCAR — PEMBELIAN & PEMAKAIAN
// =====================================================================
const DOC_T = { pembelian: 'Pembelian', pemakaian: 'Pemakaian', opname: 'Stock opname' };
Pages.stockDocForm = async (type) => {
  const items = await API.get('/consumables');
  if (!items.length) return UI.toast('Belum ada barang persediaan. Tambahkan di Daftar barang terlebih dahulu.', true);
  const beli = type === 'pembelian';
  const head = beli
    ? [{ name: 'doc_date', label: 'Tanggal', type: 'date', default: fmt.ymd(new Date()), required: true }, { name: 'vendor', label: 'Penyedia / toko' }, { name: 'invoice_no', label: 'No. faktur / kuitansi' },
      { name: 'funding_source', label: 'Sumber dana' }, { name: 'notes', label: 'Catatan', type: 'textarea' }]
    : [{ name: 'doc_date', label: 'Tanggal', type: 'date', default: fmt.ymd(new Date()), required: true }, { name: 'person_id', label: 'Penerima', type: 'select', options: await personOpts() },
      { name: 'room_id', label: 'Untuk ruang', type: 'select', options: await Ref.roomOpts(!App.isSA()) }, { name: 'purpose', label: 'Keperluan', type: 'textarea' }];
  const opts = items.map(c => ({ value: c.id, label: `${c.code ? c.code + ' — ' : ''}${c.name} (stok ${fmt.num(c.stock, 2)} ${c.uom})` }));
  const row = () => `<tr class="si"><td><select data-k="consumable_id"><option value="">— pilih barang —</option>${UI.options(opts)}</select></td><td><input type="number" step="any" min="0" data-k="qty" style="width:100px"></td>
    <td><input type="number" min="0" data-k="unit_price" style="width:140px" ${beli ? '' : 'placeholder="harga terakhir"'}></td><td class="num sub">–</td><td><input data-k="note" placeholder="keterangan"></td><td><button class="btn ghost sm" data-rmr aria-label="Hapus baris">${I('trash')}</button></td></tr>`;
  const m = UI.modal({ title: beli ? 'Pembelian barang persediaan' : 'Pemakaian barang persediaan', wide: true, body: `<div id="sdh">${UI.form(head)}</div>
    <div class="table-wrap" style="margin-top:16px"><table class="t"><thead><tr><th>Barang</th><th>Jumlah</th><th>Harga satuan</th><th class="num">Subtotal</th><th>Ket.</th><th></th></tr></thead><tbody id="srows">${row()}</tbody>
    <tfoot><tr><td colspan="3"><button class="btn sm" id="addRow">${I('plus')} Tambah baris</button></td><td class="num" id="stot">Rp 0</td><td colspan="2"></td></tr></tfoot></table></div>
    <label class="check" style="margin-top:12px"><input type="checkbox" id="mkba" checked> Terbitkan berita acara ${beli ? 'penerimaan' : 'serah terima'}</label>`,
  actions: [{ label: 'Batal' }, { label: 'Simpan & posting', kind: 'primary', onClick: async () => {
    const h = UI.read($('#sdh', m.el), head);
    const its = $$('.si', m.el).map(tr => Object.fromEntries($$('[data-k]', tr).map(i => [i.dataset.k, i.value]))).filter(i => i.consumable_id);
    if (!its.length) throw new Error('Isi minimal satu barang');
    const r = await API.post('/stock-docs', { ...h, doc_type: type, items: its, make_ba: $('#mkba', m.el).checked });
    UI.toast(`${r.number} diposting`); location.hash = '#/persediaan/dok/' + r.id;
  } }] });
  const map = new Map(items.map(c => [String(c.id), c]));
  const recalc = () => { let t = 0; $$('.si', m.el).forEach(tr => { const c = map.get($('[data-k=consumable_id]', tr).value), q = Number($('[data-k=qty]', tr).value) || 0, p = Number($('[data-k=unit_price]', tr).value) || (c && !beli ? Number(c.last_price) : 0);
    $('.sub', tr).innerHTML = c ? fmt.rp(q * p) + (!beli && q > Number(c.stock) ? '<br><span class="badge bad">melebihi stok</span>' : '') : '–'; t += q * p; }); $('#stot', m.el).textContent = fmt.rp(t); };
  m.body.addEventListener('input', recalc); m.body.addEventListener('change', e => { const s = e.target.closest('[data-k=consumable_id]'); if (s && beli) { const c = map.get(s.value), p = $('[data-k=unit_price]', s.closest('tr')); if (c && !p.value) p.value = c.last_price || ''; } recalc(); });
  m.body.addEventListener('click', e => { if (e.target.closest('#addRow')) { $('#srows', m.el).insertAdjacentHTML('beforeend', row()); } const r = e.target.closest('[data-rmr]'); if (r && $$('.si', m.el).length > 1) { r.closest('tr').remove(); recalc(); } });
};
const stockDocList = (type) => async (view, _, q) => {
  const rows = await API.get('/stock-docs', { ...q, type });
  const beli = type === 'pembelian';
  view.innerHTML = App.head(`${DOC_T[type]} persediaan`, beli ? 'Pencatatan pembelian/penerimaan barang habis pakai. Stok bertambah dan harga beli terakhir diperbarui.' : 'Pengeluaran barang habis pakai kepada penerima atau ruang. Stok berkurang; sistem menolak bila stok tidak cukup.',
    App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} ${beli ? 'Catat pembelian' : 'Catat pemakaian'}</button>` : '') + `
    <div class="filters"><input type="date" data-f="from" value="${esc(q.from || '')}" style="width:auto" aria-label="Dari"><input type="date" data-f="to" value="${esc(q.to || '')}" style="width:auto" aria-label="Sampai"></div>
    <div class="panel">${UI.table({ rows, empty: 'Belum ada transaksi.', rowAttr: d => `class="click" data-go="#/persediaan/dok/${d.id}"`, columns: [{ label: 'Nomor', render: d => `<span class="mono">${esc(d.number)}</span>` },
      { label: 'Tanggal', render: d => fmt.date(d.doc_date) }, { label: beli ? 'Penyedia' : 'Penerima / ruang', render: d => esc(beli ? [d.vendor, d.invoice_no].filter(Boolean).join(' · ') : [d.person_name, d.room_code].filter(Boolean).join(' / ')) || '–' },
      { label: 'Jenis barang', num: true, render: d => d.item_count }, { label: 'Nilai', num: true, render: d => fmt.rp(d.total) }, { label: 'BA', render: d => esc(d.ba_number || '–') }, { label: 'Petugas', render: d => esc(d.created_by_name || '') }] })}</div>`;
  bindFilters(view, location.hash.split('?')[0], q);
  view.onclick = e => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = tr.dataset.go; };
  const add = $('#add'); if (add) add.onclick = () => Pages.stockDocForm(type);
};
route(/^#\/persediaan\/pembelian$/, stockDocList('pembelian'));
route(/^#\/persediaan\/pemakaian$/, stockDocList('pemakaian'));
route(/^#\/persediaan\/dok\/(\d+)$/, async (view, [id]) => {
  const d = await API.get('/stock-docs/' + id);
  if (d.doc_type === 'opname') { location.hash = '#/persediaan/opname/' + id; return; }
  view.innerHTML = App.head(`${DOC_T[d.doc_type]} ${d.number}`, `${fmt.date(d.doc_date)} · ${esc(d.unit_name || '')}`, `<a class="btn" href="#/persediaan/${d.doc_type}">Kembali</a>${d.ba_id ? `<a class="btn primary" href="#/ba/${d.ba_id}">${I('doc')} Berita acara</a>` : ''}`) + `
    <div class="panel panel-body" style="margin-bottom:18px"><dl class="kv">${d.doc_type === 'pembelian' ? `<dt>Penyedia</dt><dd>${esc(d.vendor || '–')}</dd><dt>No. faktur</dt><dd>${esc(d.invoice_no || '–')}</dd><dt>Sumber dana</dt><dd>${esc(d.funding_source || '–')}</dd>`
      : `<dt>Penerima</dt><dd>${esc(d.person_name || '–')}</dd><dt>Ruang</dt><dd>${esc(d.room_code ? d.room_code + ' — ' + d.room_name : '–')}</dd><dt>Keperluan</dt><dd>${esc(d.purpose || '–')}</dd>`}
      <dt>Petugas</dt><dd>${esc(d.created_by_name || '')}</dd>${d.notes ? `<dt>Catatan</dt><dd>${esc(d.notes)}</dd>` : ''}</dl></div>
    <div class="panel">${UI.table({ rows: d.items, columns: [{ label: 'Kode', render: i => `<span class="mono">${esc(i.code || '')}</span>` }, { label: 'Barang', key: 'name' }, { label: 'Jumlah', num: true, render: i => `${fmt.num(i.qty, 2)} ${esc(i.uom)}` },
      { label: 'Harga satuan', num: true, render: i => fmt.rp(i.unit_price) }, { label: 'Subtotal', num: true, render: i => fmt.rp(i.qty * i.unit_price) }, { label: 'Ket.', render: i => esc(i.note || '') }],
    foot: `<td colspan="4">Total</td><td class="num">${fmt.rp(d.total)}</td><td></td>` })}</div>`;
});

// =====================================================================
// ASET LANCAR — STOCK OPNAME
// =====================================================================
route(/^#\/persediaan\/opname$/, async view => {
  const rows = await API.get('/stock-docs', { type: 'opname' });
  view.innerHTML = App.head('Stock opname persediaan', 'Hitung fisik barang habis pakai. Sistem mencatat stok saat opname dimulai; selisih dengan hasil hitung dibukukan sebagai penyesuaian dan terbit berita acara.',
    App.canWrite() ? `<button class="btn primary" id="add">${I('plus')} Mulai opname</button>` : '') +
    `<div class="panel">${UI.table({ rows, empty: 'Belum ada opname persediaan.', rowAttr: d => `class="click" data-go="#/persediaan/opname/${d.id}"`, columns: [{ label: 'Nomor', render: d => `<span class="mono">${esc(d.number)}</span>` },
      { label: 'Tanggal', render: d => fmt.date(d.doc_date) }, { label: 'Jenis barang', num: true, render: d => d.item_count }, { label: 'Nilai selisih', num: true, render: d => (d.status === 'posted' ? fmt.rp(d.total) : '–') },
      { label: 'Status', render: d => (d.status === 'draft' ? '<span class="badge warn">Sedang dihitung</span>' : '<span class="badge ok">Diposting</span>') }, { label: 'BA', render: d => esc(d.ba_number || '–') }] })}</div>`;
  view.onclick = e => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = tr.dataset.go; };
  const add = $('#add'); if (add) add.onclick = async () => UI.formModal({ title: 'Mulai stock opname persediaan', values: { doc_date: fmt.ymd(new Date()) },
    fields: [{ name: 'doc_date', label: 'Tanggal opname', type: 'date', required: true }, ...(App.isSA() ? [{ name: 'unit_id', label: 'Unit', type: 'select', options: await Ref.opts('units', u => u.name) }] : []),
      { name: 'category', label: 'Hanya kategori barang (opsional)' }, { name: 'notes', label: 'Catatan', type: 'textarea' }],
    onSubmit: async v => { const d = await API.post('/stock-opnames', v); location.hash = '#/persediaan/opname/' + d.id; } });
});
route(/^#\/persediaan\/opname\/(\d+)$/, async (view, [id]) => {
  const d = await API.get('/stock-docs/' + id), draft = d.status === 'draft' && App.canWrite();
  const diffOf = i => (i.counted_qty === null || i.counted_qty === '' ? null : Number(i.counted_qty) - Number(i.system_qty));
  view.innerHTML = App.head(`Stock opname ${d.number}`, `${fmt.date(d.doc_date)} · ${d.items.length} jenis barang · ${draft ? 'isi kolom Hasil hitung, lalu simpan dan posting' : 'sudah diposting'}`,
    `<a class="btn" href="#/persediaan/opname">Kembali</a>${draft ? `<button class="btn" id="save">${I('save')} Simpan hitungan</button><button class="btn danger" id="del">Hapus draf</button><button class="btn primary" id="post">Posting & buat BA</button>` : d.ba_id ? `<a class="btn primary" href="#/ba/${d.ba_id}">${I('doc')} Berita acara</a>` : ''}`) + `
    <div class="filters"><input type="search" id="fq" placeholder="Saring barang"><span class="muted" id="prog"></span></div>
    <div class="panel">${UI.table({ rows: d.items, rowAttr: i => `data-t="${esc((i.code + ' ' + i.name).toLowerCase())}"`, columns: [{ label: 'Kode', render: i => `<span class="mono">${esc(i.code || '')}</span>` }, { label: 'Barang', key: 'name' },
      { label: 'Stok tercatat', num: true, render: i => `${fmt.num(i.system_qty, 2)} ${esc(i.uom)}` },
      { label: 'Hasil hitung', render: i => (draft ? `<input type="number" step="any" min="0" data-cnt="${i.id}" value="${i.counted_qty ?? ''}" style="width:110px">` : fmt.num(i.counted_qty, 2)) },
      { label: 'Selisih', num: true, render: i => `<span data-diff="${i.id}">${diffOf(i) === null ? '–' : fmt.num(diffOf(i), 2)}</span>` }, { label: 'Nilai selisih', num: true, render: i => `<span data-val="${i.id}">${diffOf(i) ? fmt.rp(diffOf(i) * i.unit_price) : '–'}</span>` },
      { label: 'Catatan', render: i => (draft ? `<input data-note="${i.id}" value="${esc(i.note || '')}">` : esc(i.note || '')) }] })}</div>`;
  const prog = () => { const n = $$('[data-cnt]').filter(x => x.value !== '').length; $('#prog').textContent = draft ? `${n} dari ${d.items.length} sudah dihitung` : ''; };
  prog();
  $('#fq').oninput = e => $$('tr[data-t]').forEach(tr => (tr.style.display = tr.dataset.t.includes(e.target.value.toLowerCase()) ? '' : 'none'));
  if (!draft) return;
  view.addEventListener('input', e => { const c = e.target.closest('[data-cnt]'); if (!c) return; const i = d.items.find(x => x.id === Number(c.dataset.cnt)); i.counted_qty = c.value === '' ? null : Number(c.value);
    const df = diffOf(i); $(`[data-diff="${i.id}"]`).textContent = df === null ? '–' : fmt.num(df, 2); $(`[data-val="${i.id}"]`).textContent = df ? fmt.rp(df * i.unit_price) : '–'; prog(); });
  const payload = () => ({ items: d.items.map(i => ({ id: i.id, counted_qty: $(`[data-cnt="${i.id}"]`).value, note: $(`[data-note="${i.id}"]`).value })) });
  $('#save').onclick = async () => { await API.put(`/stock-docs/${id}/items`, payload()).catch(UI.err); UI.toast('Hasil hitung disimpan'); };
  $('#del').onclick = async () => { if (await UI.confirm('Hapus draf opname ini?', { danger: true })) { await API.del('/stock-docs/' + id); location.hash = '#/persediaan/opname'; } };
  $('#post').onclick = async () => {
    await API.put(`/stock-docs/${id}/items`, payload());
    const empty = d.items.filter(i => $(`[data-cnt="${i.id}"]`).value === '').length;
    UI.formModal({ title: 'Posting stock opname', submit: 'Posting', fields: [{ html: `<p>${empty ? `<b>${empty} barang belum dihitung</b> dan akan dianggap sesuai catatan. ` : ''}Selisih akan dibukukan sebagai penyesuaian stok.</p>` },
      { name: 's1', label: 'Petugas penghitung' }, { name: 's2', label: 'Pengelola persediaan' }, { name: 's3', label: 'Mengetahui' }, { name: 'notes', label: 'Catatan berita acara', type: 'textarea' }],
    onSubmit: async v => { const r = await API.post(`/stock-docs/${id}/post`, { force: true, notes: v.notes, signatories: [['Petugas penghitung', v.s1], ['Pengelola persediaan', v.s2], ['Mengetahui', v.s3]].filter(x => x[1]).map(([role, name]) => ({ role, name })) });
      UI.toast(`${r.diffs} barang disesuaikan`); location.hash = '#/ba/' + r.ba_id; } });
  };
});

// =====================================================================
// ASET LANCAR — LAPORAN & LOG
// =====================================================================
route(/^#\/persediaan\/laporan$/, async (view, _, q) => {
  const params = { from: q.from || monthStart(), to: q.to || fmt.ymd(new Date()) };
  view.innerHTML = App.head('Laporan aset lancar (persediaan)', 'Saldo awal, pembelian, pemakaian, penyesuaian opname, saldo akhir, dan nilai persediaan.', xlsxBtn('persediaan', { ...params, unit_id: q.unit_id })) +
    `<div class="filters"><input type="date" data-f="from" value="${params.from}" style="width:auto" aria-label="Dari"><span>s.d.</span><input type="date" data-f="to" value="${params.to}" style="width:auto" aria-label="Sampai">${await unitFilter(q.unit_id)}</div><div id="rep"><div class="empty">Memuat…</div></div>`;
  bindFilters(view, '#/persediaan/laporan', q);
  $('#rep').innerHTML = Pages.reportBody(await API.get('/reports/persediaan', { ...params, unit_id: q.unit_id }));
});
route(/^#\/persediaan\/log$/, async (view, _, q) => {
  const page = Number(q.page) || 0, limit = 200;
  const [res, items] = await Promise.all([API.get('/stock-log', { ...q, limit, offset: page * limit }), API.get('/consumables')]);
  const TT = { masuk: ['Masuk', 'ok'], keluar: ['Keluar', 'warn'], penyesuaian: ['Penyesuaian', 'info'] };
  view.innerHTML = App.head('Log transaksi persediaan', `${fmt.num(res.total)} transaksi · nilai masuk ${fmt.rp(res.in_value)} · nilai keluar ${fmt.rp(res.out_value)}`, `<button class="btn" id="csv">${I('dl')} Unduh CSV</button>`) + `
    <div class="filters"><input type="search" data-f="q" placeholder="Barang, nomor dokumen, keterangan" value="${esc(q.q || '')}">
      <select data-f="consumable_id"><option value="">Semua barang</option>${UI.options(items.map(c => ({ value: c.id, label: c.name })), q.consumable_id)}</select>
      <select data-f="type"><option value="">Semua jenis</option>${UI.options(Object.entries(TT).map(([k, v]) => ({ value: k, label: v[0] })), q.type)}</select>
      <input type="date" data-f="from" value="${esc(q.from || '')}" style="width:auto" aria-label="Dari"><input type="date" data-f="to" value="${esc(q.to || '')}" style="width:auto" aria-label="Sampai"></div>
    <div class="panel">${UI.table({ rows: res.rows, empty: 'Tidak ada transaksi.', rowAttr: t => (t.doc_id ? `class="click" data-go="#/persediaan/dok/${t.doc_id}"` : ''), columns: [{ label: 'Tanggal', render: t => fmt.date(t.tx_date) },
      { label: 'Jenis', render: t => badge(t.tx_type, TT) }, { label: 'Barang', render: t => `${esc(t.name)}<br><small class="mono">${esc(t.code || '')}</small>` },
      { label: 'Jumlah', num: true, render: t => `${t.signed_qty > 0 ? '+' : ''}${fmt.num(t.signed_qty, 2)} ${esc(t.uom)}` }, { label: 'Harga', num: true, render: t => fmt.rp(t.unit_price) },
      { label: 'Dokumen', render: t => esc(t.doc_number || '–') }, { label: 'Untuk', render: t => esc([t.room_code, t.person_name].filter(Boolean).join(' / ') || '–') }, { label: 'Petugas', render: t => esc(t.created_by_name || '') }] })}</div>
    <div class="btn-row" style="margin-top:12px">${page > 0 ? `<button class="btn sm" data-pg="${page - 1}">‹ Sebelumnya</button>` : ''}<span class="muted">Halaman ${page + 1} dari ${Math.max(1, Math.ceil(res.total / limit))}</span>${(page + 1) * limit < res.total ? `<button class="btn sm" data-pg="${page + 1}">Berikutnya ›</button>` : ''}</div>`;
  bindFilters(view, '#/persediaan/log', { ...q, page: '' });
  $('#csv').onclick = async () => { const all = await API.get('/stock-log', { ...q, limit: 5000, offset: 0 });
    csvDownload('log-persediaan.csv', ['tanggal', 'jenis', 'kode', 'barang', 'jumlah', 'satuan', 'harga', 'dokumen', 'untuk', 'keterangan', 'petugas'], all.rows.map(t => [t.tx_date, t.tx_type, t.code, t.name, t.signed_qty, t.uom, t.unit_price, t.doc_number, [t.room_code, t.person_name].filter(Boolean).join(' / '), t.note, t.created_by_name])); };
  view.onclick = e => { const p = e.target.closest('[data-pg]'); if (p) return setQ('#/persediaan/log', { ...q, page: p.dataset.pg }); const tr = e.target.closest('[data-go]'); if (tr) location.hash = tr.dataset.go; };
});
