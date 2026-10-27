// Point d'entrée : Express (API + fichiers statiques), Socket.IO (temps réel), moteur d'enchères.
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const dbm = require('./db');
dbm.migrate();
const { seed } = require('./seed');
if (seed(dbm)) console.log('[seed] Données de démonstration créées — admin : admin@mazad.dj / Admin@2026');

const engine = require('./engine');
const { createAuth, parseCookies } = require('./auth');
const ICONS = require('./icons');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, pingInterval: 20000 });
engine.setIO(io);

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const auth = createAuth(dbm);
app.use(auth.middleware);

// Icônes partagées pour le front
const iconsJs = 'window.ICONS=' + JSON.stringify(ICONS) + ';';
app.get('/js/icons.js', (req, res) => { res.type('js').setHeader('Cache-Control', 'public, max-age=86400'); res.send(iconsJs); });

// Visuels de démonstration générés (légers, fonctionnent hors ligne) — remplacés par les vraies photos uploadées.
const PALETTES = {
  voiture: ['#1d3557', '#457b9d'], camion: ['#3d405b', '#81b29a'], automobile: ['#2b2d42', '#8d99ae'], electronique: ['#14213d', '#5465ff'],
  'produit-manufacture': ['#6d597a', '#b56576'], electromenager: ['#264653', '#2a9d8f'], 'machine-industrielle': ['#5f0f40', '#e36414'], 'meuble-bureau': ['#344e41', '#a3b18a'],
  moto: ['#370617', '#d00000'], velo: ['#003049', '#669bbc'], nourriture: ['#7f5539', '#ddb892'], 'meuble-salon': ['#583101', '#bc8a5f'],
};
const CAT_ICON = { voiture: 'car', camion: 'truck', automobile: 'wrench', electronique: 'phone', 'produit-manufacture': 'box', electromenager: 'fridge', 'machine-industrielle': 'factory', 'meuble-bureau': 'desk', moto: 'moto', velo: 'bike', nourriture: 'food', 'meuble-salon': 'sofa' };
app.get('/ph/:name.svg', (req, res) => {
  const name = req.params.name;
  res.type('image/svg+xml').setHeader('Cache-Control', 'public, max-age=604800');
  if (name === 'partner') {
    const label = String(req.query.n || 'Partenaire').replace(/[<>&"]/g, '').slice(0, 30);
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96"><rect width="240" height="96" rx="12" fill="#f3f4f8"/><text x="120" y="56" text-anchor="middle" font-family="Georgia,serif" font-size="19" font-weight="700" fill="#3a4060">${label}</text></svg>`);
  }
  const [a, b] = PALETTES[name] || ['#334', '#667'];
  const seedStr = String(req.query.v || '');
  let h = 0; for (const c of seedStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rot = h % 360, cx = 300 + (h % 200), cy = 220 + (h % 160), size = 9 + (h % 4);
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" gradientTransform="rotate(${rot % 90})"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx="${cx / 8}%" cy="${cy / 6}%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="800" height="600" fill="url(#g)"/><rect width="800" height="600" fill="url(#r)"/>
<g opacity=".08" stroke="#fff" stroke-width="1">${Array.from({ length: 12 }, (_, i) => `<path d="M${i * 70} 600 L${i * 70 + 300} 0"/>`).join('')}</g>
<g transform="translate(${400 - size * 12} ${300 - size * 12}) scale(${size})" fill="none" stroke="#fff" stroke-width="${1.4 / size * 8}" stroke-linecap="round" stroke-linejoin="round" opacity=".92">${ICONS[CAT_ICON[name]] || ICONS.box}</g></svg>`);
});

app.use('/api/admin', require('./routes/admin')(auth));
app.use('/api', require('./routes/public')(auth));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, file) => {
    if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    // Les SVG uploadés ne peuvent exécuter aucun script
    if (file.includes(`${path.sep}uploads${path.sep}`) && file.endsWith('.svg')) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (file.includes(`${path.sep}uploads${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  },
}));

app.get(['/admin', '/admin/*'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.message === 'Format d\'image non autorisé')) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (6 Mo max)' : err.message });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

// ---- Temps réel ----
io.use((socket, next) => {
  const sid = parseCookies(socket.request).sid;
  if (sid) {
    const s = dbm.get('SELECT s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND s.twofa_ok = 1 AND u.banned = 0', sid, Date.now());
    if (s) { socket.data.userId = s.user_id; socket.data.role = s.role; }
  }
  next();
});
const liveViewers = new Set();
app.set('liveViewers', () => liveViewers.size);
io.on('connection', (socket) => {
  socket.join('catalog');
  if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
  if (['superadmin', 'admin', 'moderator', 'auctioneer'].includes(socket.data.role)) socket.join('admin');
  socket.on('lot:join', (id) => { for (const r of socket.rooms) if (r.startsWith('lot:')) socket.leave(r); if (Number(id)) socket.join(`lot:${Number(id)}`); });
  socket.on('live:join', () => { socket.join('live'); liveViewers.add(socket.id); io.to('live').emit('live:viewers', liveViewers.size); });
  socket.on('live:leave', () => { socket.leave('live'); liveViewers.delete(socket.id); io.to('live').emit('live:viewers', liveViewers.size); });
  socket.on('time', (cb) => typeof cb === 'function' && cb(Date.now()));
  socket.on('disconnect', () => { if (liveViewers.delete(socket.id)) io.to('live').emit('live:viewers', liveViewers.size); });
});

engine.start();
const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`Plateforme d'enchères démarrée : http://localhost:${PORT}  (admin : http://localhost:${PORT}/admin)`));
