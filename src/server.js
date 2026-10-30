require('dotenv').config();
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const { HttpError } = require('./util');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));

const core = require('./routes/core');
const feedback = require('./routes/feedback');

const mainApp = express.Router();
mainApp.use('/api/public', feedback.pub);
mainApp.use('/api', core.router); // /auth/login publik, sisanya dilindungi authRequired di dalam router
mainApp.use('/api', require('./routes/buildings'));
mainApp.use('/api', require('./routes/schedule').router);
mainApp.use('/api', require('./routes/timetable'));
mainApp.use('/api', require('./routes/assets').router);
mainApp.use('/api', require('./routes/inventory'));
mainApp.use('/api', feedback.router);
mainApp.use('/api', require('./routes/reports'));
mainApp.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

mainApp.use(express.static(path.join(__dirname, '../public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
mainApp.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

let rawBase = process.env.BASE_PATH || '';
if (!rawBase && process.env.PUBLIC_URL) {
  try {
    const u = new URL(process.env.PUBLIC_URL);
    if (u.pathname && u.pathname !== '/') rawBase = u.pathname;
  } catch (_) {}
}
const basePath = (rawBase || '').replace(/\/+$/, '');

if (basePath && basePath !== '/') {
  app.use((req, res, next) => {
    if (req.originalUrl.split('?')[0] === basePath) {
      const q = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      return res.redirect(301, `${basePath}/${q}`);
    }
    next();
  });
  app.use(basePath, mainApp);
}
app.use('/', mainApp);

// Penanganan galat terpadu (termasuk kode galat PostgreSQL)
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || 500, msg = err.message;
  if (err.code === '23505') { status = 409; msg = 'Data sudah ada (duplikat): ' + (err.detail || '').replace(/Key \((.*?)\)=\((.*?)\).*/, '$1 = $2'); }
  else if (err.code === '23P01') { status = 409; msg = 'Bentrok jadwal: ruangan sudah terpakai pada waktu tersebut'; }
  else if (err.code === '23503') { status = 409; msg = 'Data masih dipakai oleh data lain atau referensi tidak valid'; }
  else if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') { status = 400; msg = 'Isian tidak valid: ' + (err.constraint || err.message); }
  else if (err.code === 'LIMIT_FILE_SIZE') { status = 413; msg = 'Berkas terlalu besar'; }
  if (status >= 500 && !(err instanceof HttpError)) { console.error(err); if (process.env.NODE_ENV === 'production') msg = 'Terjadi kesalahan pada server'; }
  res.status(status).json({ error: msg });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`SARPRAS berjalan di http://localhost:${port}${basePath}`));
