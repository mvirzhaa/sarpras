/* ===== Rendra: asisten obrolan (muncul setelah login) ===== */
'use strict';
const Rendra = {
  msgs: [], state: {}, busy: false, open: false, info: null,
  key: () => 'rendra_' + (App.me ? App.me.id : ''),
  save() { try { sessionStorage.setItem(Rendra.key(), JSON.stringify({ msgs: Rendra.msgs.slice(-40), state: Rendra.state })); } catch { /* penyimpanan tidak tersedia */ } },
  load() { try { const x = JSON.parse(sessionStorage.getItem(Rendra.key()) || 'null'); if (x) { Rendra.msgs = x.msgs || []; Rendra.state = x.state || {}; } } catch { /* abaikan */ } },

  mount() {
    if (!App.me || $('#rendra')) return;
    Rendra.load();
    const root = document.createElement('div'); root.id = 'rendra';
    root.innerHTML = `
      <button class="rd-fab" id="rdFab" aria-label="Buka asisten Rendra" aria-expanded="false"><span class="rd-av">R</span><span class="rd-fab-l">Tanya Rendra</span></button>
      <section class="rd-panel" id="rdPanel" role="dialog" aria-label="Rendra, asisten SARPRAS" hidden>
        <header class="rd-head"><span class="rd-av">R</span><div><b>Rendra</b><small id="rdMode">Asisten SARPRAS</small></div>
          <button class="btn ghost sm" id="rdNew" title="Percakapan baru" aria-label="Percakapan baru">${I('undo')}</button>
          <button class="btn ghost sm" id="rdX" aria-label="Tutup">${I('x')}</button></header>
        <div class="rd-log" id="rdLog" aria-live="polite"></div>
        <div class="rd-chips" id="rdChips"></div>
        <form class="rd-form" id="rdForm"><textarea id="rdIn" rows="1" placeholder="Tanya fitur atau cari ruang kosong…" aria-label="Pesan untuk Rendra"></textarea>
          <button class="btn primary" id="rdSend" aria-label="Kirim">${I('send')}</button></form>
      </section>`;
    document.body.appendChild(root);
    $('#rdFab').onclick = () => Rendra.toggle(true);
    $('#rdX').onclick = () => Rendra.toggle(false);
    $('#rdNew').onclick = () => { Rendra.msgs = []; Rendra.state = {}; Rendra.save(); Rendra.render(); $('#rdIn').focus(); };
    const inp = $('#rdIn');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#rdForm').requestSubmit(); } if (e.key === 'Escape') Rendra.toggle(false); });
    inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; });
    $('#rdForm').onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (v) { inp.value = ''; inp.style.height = 'auto'; Rendra.send(v); } };
    $('#rdLog').addEventListener('click', Rendra.onClick);
    $('#rdChips').addEventListener('click', e => { const c = e.target.closest('[data-chip]'); if (c) Rendra.send(c.dataset.chip); });
    API.get('/rendra/info').then(i => { Rendra.info = i; $('#rdMode').textContent = i.mode === 'ai' ? 'Asisten SARPRAS · AI' : 'Asisten SARPRAS'; if (!Rendra.msgs.length) Rendra.render(); }).catch(() => {});
    Rendra.render();
  },
  toggle(v) {
    Rendra.open = v; $('#rdPanel').hidden = !v; $('#rdFab').hidden = v; $('#rdFab').setAttribute('aria-expanded', String(v));
    if (v) { Rendra.scroll(); setTimeout(() => $('#rdIn').focus(), 30); }
  },

  async send(text) {
    if (Rendra.busy) return;
    Rendra.msgs.push({ role: 'user', content: text }); Rendra.busy = true; Rendra.render();
    try {
      const hist = Rendra.msgs.filter(m => !m.local).map(m => ({ role: m.role, content: m.content })).slice(-12);
      const r = await API.post('/rendra/chat', { messages: hist, state: Rendra.state });
      Rendra.state = r.state || Rendra.state;
      Rendra.msgs.push({ role: 'assistant', content: r.reply, search: r.search, suggestions: r.suggestions, note: r.note });
    } catch (e) {
      Rendra.msgs.push({ role: 'assistant', content: e.message || 'Maaf, terjadi gangguan. Coba lagi.', local: true, error: true });
    } finally { Rendra.busy = false; Rendra.save(); Rendra.render(); }
  },

  // Markdown ringan yang aman: teks di-escape dulu, tautan hanya ke rute internal (#/...)
  md(s) {
    const inline = x => esc(x)
      .replace(/\[([^\]]+)\]\((#\/[^)\s]*)\)/g, (_, t, h) => `<a href="${h}" data-nav>${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_]+)_(?=[\s.,)]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s.,)]|$)/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const out = []; let list = null;
    for (const line of String(s || '').split('\n')) {
      const ul = line.match(/^\s*[-•]\s+(.*)/), ol = line.match(/^\s*(\d+)\.\s+(.*)/);
      if (ul || ol) { const tag = ul ? 'ul' : 'ol'; if (!list || list.tag !== tag) { list && out.push(`</${list.tag}>`); out.push(`<${tag}>`); list = { tag }; } out.push(`<li>${inline(ul ? ul[1] : ol[2])}</li>`); continue; }
      if (list) { out.push(`</${list.tag}>`); list = null; }
      out.push(line.trim() ? `<p>${inline(line)}</p>` : '');
    }
    if (list) out.push(`</${list.tag}>`);
    return out.join('');
  },
  roomCards(s, mi) {
    if (!s || !s.rooms || !s.rooms.length) return '';
    const canAct = App.canWrite();
    const q = new URLSearchParams(Object.entries(s.filters).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return `<div class="rd-rooms">${s.rooms.map((r, i) => `<div class="rd-room ${r.free === false ? 'busy' : ''}">
        <i class="dot" style="background:${esc(r.color || '#999')}"></i>
        <div class="rd-room-main"><b class="mono">${esc(r.code)}</b> ${esc(r.name)}<small>${esc(r.building_name)} · ${esc(r.floor_name || '')} · ${r.capacity} org${r.owner_unit ? ' · ' + esc(r.owner_unit) : ''}</small></div>
        ${r.free === false ? '<span class="badge bad">Terpakai</span>' : canAct ? `<button class="btn sm ${r.mine ? 'primary' : ''}" data-act="${mi}:${i}">${r.mine ? 'Buat kegiatan' : 'Ajukan pinjam'}</button>` : ''}</div>`).join('')}
      ${s.total > s.rooms.length ? `<a class="rd-more" href="#/cari-ruang?${q}" data-nav>Lihat semua ${s.total} ruang di Cari ruang kosong ›</a>` : ''}</div>`;
  },
  render() {
    const log = $('#rdLog'); if (!log) return;
    const hello = `Halo${App.me.name ? ', ' + App.me.name.split(' ')[0] : ''}! Saya **Rendra**. Tanyakan cara memakai fitur SARPRAS, atau minta saya mencarikan ruang kosong. Contoh: *"aula kosong Jumat jam 13 sampai 16 untuk 80 orang"*.`;
    const items = Rendra.msgs.length ? Rendra.msgs : [{ role: 'assistant', content: hello, local: true }];
    log.innerHTML = items.map((m, i) => m.role === 'user'
      ? `<div class="rd-msg me">${esc(m.content).replace(/\n/g, '<br>')}</div>`
      : `<div class="rd-msg bot ${m.error ? 'err' : ''}">${Rendra.md(m.content)}${m.note ? `<p class="rd-note">${esc(m.note)}</p>` : ''}${Rendra.roomCards(m.search, i)}</div>`).join('')
      + (Rendra.busy ? '<div class="rd-msg bot rd-typing" aria-label="Rendra sedang mengetik"><span></span><span></span><span></span></div>' : '');
    const last = items[items.length - 1];
    const chips = Rendra.busy ? [] : (last.role === 'assistant' && last.suggestions && last.suggestions.length ? last.suggestions : !Rendra.msgs.length ? (Rendra.info && Rendra.info.suggestions) || [] : []);
    $('#rdChips').innerHTML = chips.map(c => `<button type="button" class="rd-chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('');
    $('#rdSend').disabled = Rendra.busy;
    Rendra.scroll();
  },
  scroll() { const l = $('#rdLog'); if (l) l.scrollTop = l.scrollHeight; },
  onClick(e) {
    const nav = e.target.closest('[data-nav]');
    if (nav && window.matchMedia('(max-width: 720px)').matches) Rendra.toggle(false);   // di ponsel, tutup panel saat berpindah halaman
    const b = e.target.closest('[data-act]'); if (!b) return;
    const [mi, ri] = b.dataset.act.split(':').map(Number), s = Rendra.msgs[mi].search, r = s.rooms[ri];
    const base = { room_id: r.id, start_at: s.filters.start_at, end_at: s.filters.end_at, repeat_until: s.filters.repeat_until, participants: s.filters.capacity };
    r.mine ? Pages.eventForm(base) : Pages.bookingForm(base, r);
  },
};
