// Asisten Rendra: POST /api/rendra/chat  { messages:[{role,content}], state }
const express = require('express');
const { ah, fail } = require('../util');
const rendra = require('../services/rendra');

const r = express.Router();
const hits = new Map(); // batas sederhana per pengguna (memori; gunakan Redis bila multi-instans)
const LIMIT = Number(process.env.RENDRA_RATE_PER_MIN || 20);

r.get('/rendra/info', ah(async (req, res) => {
  res.json({ name: 'Rendra', mode: rendra.aiEnabled() ? 'ai' : 'dasar', suggestions: rendra.START_CHIPS });
}));
r.post('/rendra/chat', ah(async (req, res) => {
  const now = Date.now(), k = req.user.id, h = (hits.get(k) || []).filter(t => now - t < 60000);
  if (h.length >= LIMIT) fail(429, 'Terlalu banyak pertanyaan dalam satu menit. Coba lagi sebentar lagi.');
  h.push(now); hits.set(k, h);
  const { messages, state } = req.body || {};
  if (!Array.isArray(messages)) fail(400, 'Format pesan tidak valid');
  res.json(await rendra.chat(req.user, { messages, state: state && typeof state === 'object' ? state : {} }));
}));
module.exports = r;
