// API publique : catalogue, lots, enchères, salle live, compte, paiement, dépôt de lots.
const express = require('express');
const dbm = require('../db');
const { get, all, run, setting, settingNum } = dbm;
const engine = require('../engine');
const { publicLot, parseJSON, BidError } = engine;
const { hashPassword, verifyPassword, normalizePhone, verifyTotp, rateLimit } = require('../auth');
const payments = require('../payments');
const { upload, fileUrl } = require('../upload');

const PUBLIC_SETTINGS = ['site_name', 'slogan_fr', 'slogan_ar', 'logo', 'favicon', 'color_primary', 'color_accent', 'color_dark', 'default_lang', 'currency', 'currencies_enabled', 'rate_USD', 'rate_EUR',
  'whatsapp_number', 'support_email', 'support_phone', 'address', 'toasts_enabled', 'toast_duration', 'toast_interval', 'toast_position', 'anti_snipe_window', 'anti_snipe_extend',
  'buyer_fee_pct', 'unverified_bid_limit', 'social_facebook', 'social_instagram', 'social_tiktok', 'payment_deadline_hours'];

const ip = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const LOT_SELECT = `SELECT l.*, c.slug cat_slug, s.slug sub_slug FROM lots l LEFT JOIN categories c ON c.id=l.category_id LEFT JOIN categories s ON s.id=l.subcategory_id`;
const VISIBLE = `l.status IN ('upcoming','live','sold','unsold')`;

function meJson(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, pseudo: u.pseudo, email: u.email, phone: u.phone, role: u.role, verified: !!u.verified, is_seller: !!u.is_seller, seller_verified: !!u.seller_verified, city: u.city, lang: u.lang, totp_enabled: !!u.totp_enabled };
}

function categoriesTree() {
  const rows = all('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id');
  const counts = Object.fromEntries(all(`SELECT category_id id, COUNT(*) n FROM lots WHERE status IN ('live','upcoming') GROUP BY category_id`).map(r => [r.id, r.n]));
  const subCounts = Object.fromEntries(all(`SELECT subcategory_id id, COUNT(*) n FROM lots WHERE status IN ('live','upcoming') GROUP BY subcategory_id`).map(r => [r.id, r.n]));
  return rows.filter(r => !r.parent_id).map(c => ({
    id: c.id, slug: c.slug, name_fr: c.name_fr, name_ar: c.name_ar, icon: c.icon, image: c.image || null, requires_expiry: !!c.requires_expiry, filters: parseJSON(c.filters, []), count: counts[c.id] || 0,
    subs: rows.filter(s => s.parent_id === c.id).map(s => ({ id: s.id, slug: s.slug, name_fr: s.name_fr, name_ar: s.name_ar, count: subCounts[s.id] || 0 })),
  }));
}

function sellerInfo(id) {
  if (!id) return null;
  const u = get('SELECT id, pseudo, name, seller_verified, created_at, city FROM users WHERE id = ?', id);
  if (!u) return null;
  const r = get("SELECT ROUND(AVG(rating),1) avg, COUNT(*) n FROM reviews WHERE seller_id = ? AND status='approved'", id);
  const sold = get("SELECT COUNT(*) n FROM lots WHERE seller_id = ? AND status='sold'", id).n;
  return { id: u.id, name: u.name, verified: !!u.seller_verified, since: u.created_at, city: u.city, rating: r.avg || 0, reviews: r.n, sold };
}

function saleJson(s) {
  const lots = all('SELECT images FROM lots WHERE sale_id = ? AND status IN (\'live\',\'upcoming\',\'sold\',\'unsold\') ORDER BY featured DESC, id LIMIT 4', s.id).map(l => parseJSON(l.images, [])[0]).filter(Boolean);
  const n = get("SELECT COUNT(*) n, COUNT(DISTINCT b.user_id) bidders FROM lots l LEFT JOIN bids b ON b.lot_id = l.id WHERE l.sale_id = ? AND l.status IN ('live','upcoming','sold','unsold')", s.id);
  return { ...s, thumbs: lots, lots_count: get("SELECT COUNT(*) n FROM lots WHERE sale_id=? AND status IN ('live','upcoming','sold','unsold')", s.id).n, bidders: n.bidders };
}

module.exports = function (auth) {
  const r = express.Router();
  const { requireUser, createSession, destroySession } = auth;

  r.get('/bootstrap', (req, res) => {
    const s = dbm.settings();
    const texts = { fr: {}, ar: {} };
    for (const t of all('SELECT key, fr, ar FROM texts')) { texts.fr[t.key] = t.fr; texts.ar[t.key] = t.ar || t.fr; }
    res.json({
      settings: Object.fromEntries(PUBLIC_SETTINGS.map(k => [k, s[k] ?? ''])),
      texts, categories: categoriesTree(), me: meJson(req.user), csrf: req.csrfToken, now: Date.now(),
      payments: all('SELECT code, name FROM payment_methods WHERE enabled=1 ORDER BY sort'),
      zones: all('SELECT id, name_fr, name_ar, fee, delay_fr, is_pickup FROM zones WHERE active=1 ORDER BY sort'),
      unread: req.user ? get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user.id).n : 0,
      stats_users: get('SELECT COUNT(*) n FROM users').n,
      watched: req.user ? all('SELECT lot_id FROM watches WHERE user_id=?', req.user.id).map(w => w.lot_id) : [],
    });
  });

  r.get('/home', (req, res) => {
    const now = Date.now();
    const map = (rows) => rows.map(l => publicLot(l, req.user));
    res.json({
      banners: all("SELECT * FROM banners WHERE active=1 ORDER BY kind, sort"),
      live: map(all(`${LOT_SELECT} WHERE l.status='live' ORDER BY l.bids_count DESC, l.ends_at ASC LIMIT 8`)),
      ending: map(all(`${LOT_SELECT} WHERE l.status='live' AND l.ends_at > ? ORDER BY l.ends_at ASC LIMIT 8`, now)),
      favorites: map(all(`${LOT_SELECT} WHERE l.favorite=1 AND l.status IN ('live','upcoming') ORDER BY l.ends_at LIMIT 8`)),
      featured: map(all(`${LOT_SELECT} WHERE l.featured=1 AND l.status IN ('live','upcoming') ORDER BY l.ends_at LIMIT 8`)),
      sales: all("SELECT * FROM sales WHERE status IN ('live','upcoming') ORDER BY is_live DESC, starts_at LIMIT 8").map(saleJson),
      partners: all('SELECT * FROM partners WHERE active=1 ORDER BY sort'),
      reviews: all("SELECT id, author_name, rating, comment, created_at FROM reviews WHERE status='approved' AND seller_id IS NULL OR (status='approved' AND featured=1) ORDER BY featured DESC, created_at DESC LIMIT 9"),
      stats: {
        users: get('SELECT COUNT(*) n FROM users').n,
        sold: get("SELECT COUNT(*) n FROM lots WHERE status='sold'").n,
        rating: get("SELECT ROUND(AVG(rating),1) a FROM reviews WHERE status='approved'").a || 0,
        reviews: get("SELECT COUNT(*) n FROM reviews WHERE status='approved'").n,
      },
    });
  });

  // Catalogue + filtres (catégorie, sous-catégorie, recherche, prix, statut, attributs dynamiques)
  r.get('/lots', (req, res) => {
    const q = req.query, where = [VISIBLE], p = [];
    if (q.category) { where.push('c.slug = ?'); p.push(q.category); }
    if (q.sub) { where.push('s.slug = ?'); p.push(q.sub); }
    if (q.sale) { where.push('l.sale_id = ?'); p.push(Number(q.sale)); }
    if (q.q) { where.push('(l.title_fr LIKE ? OR l.title_ar LIKE ? OR l.description_fr LIKE ? OR c.name_fr LIKE ? OR s.name_fr LIKE ?)'); const k = `%${String(q.q).slice(0, 80)}%`; p.push(k, k, k, k, k); }
    if (q.status) { where.push('l.status = ?'); p.push(q.status); } else if (!q.sale) where.push("l.status IN ('live','upcoming')");
    if (q.min) { where.push('l.current_price >= ?'); p.push(Number(q.min)); }
    if (q.max) { where.push('l.current_price <= ?'); p.push(Number(q.max)); }
    if (q.condition) { where.push('l.condition = ?'); p.push(q.condition); }
    if (q.location) { where.push('l.location = ?'); p.push(q.location); }
    if (q.buy_now === '1') where.push('l.buy_now_price > 0');
    if (q.no_reserve === '1') where.push('l.reserve_price = 0');
    if (q.favorite === '1') where.push('l.favorite = 1');
    if (q.featured === '1') where.push('l.featured = 1');
    for (const [k, v] of Object.entries(q)) {
      const m = /^a_(\w+?)(_min|_max)?$/.exec(k);
      if (!m || v === '') continue;
      if (m[2] === '_min') { where.push(`CAST(json_extract(l.attrs, '$.${m[1]}') AS REAL) >= ?`); p.push(Number(v)); }
      else if (m[2] === '_max') { where.push(`CAST(json_extract(l.attrs, '$.${m[1]}') AS REAL) <= ?`); p.push(Number(v)); }
      else { where.push(`json_extract(l.attrs, '$.${m[1]}') = ?`); p.push(String(v)); }
    }
    const order = { ending: "CASE l.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, l.ends_at ASC", newest: 'l.created_at DESC', price_asc: 'l.current_price ASC', price_desc: 'l.current_price DESC', popular: 'l.bids_count DESC' }[q.sort] || "CASE l.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, l.ends_at ASC";
    const per = Math.min(Number(q.per) || 24, 60), page = Math.max(Number(q.page) || 1, 1);
    const sqlWhere = 'WHERE ' + where.join(' AND ');
    const total = get(`SELECT COUNT(*) n FROM lots l LEFT JOIN categories c ON c.id=l.category_id LEFT JOIN categories s ON s.id=l.subcategory_id ${sqlWhere}`, ...p).n;
    const rows = all(`${LOT_SELECT} ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`, ...p, per, (page - 1) * per);
    const locations = all(`SELECT DISTINCT location FROM lots WHERE location IS NOT NULL AND status IN ('live','upcoming') ORDER BY location`).map(r => r.location);
    res.json({ total, page, pages: Math.ceil(total / per), lots: rows.map(l => publicLot(l, req.user)), locations });
  });

  r.get('/lots/:id', (req, res) => {
    const l = get(`${LOT_SELECT} WHERE l.id = ? AND (${VISIBLE} OR l.seller_id = ?)`, Number(req.params.id), req.user ? req.user.id : -1);
    if (!l) return res.status(404).json({ error: 'Lot introuvable' });
    run('UPDATE lots SET views = views + 1 WHERE id = ?', l.id);
    const history = all('SELECT user_id, amount, is_auto, created_at FROM bids WHERE lot_id = ? AND cancelled = 0 ORDER BY id DESC LIMIT 50', l.id)
      .map(b => ({ bidder: engine.bidderCode(b.user_id, l.id), amount: b.amount, is_auto: !!b.is_auto, at: b.created_at }));
    const cat = get('SELECT id, slug, name_fr, name_ar, filters, requires_expiry FROM categories WHERE id = ?', l.category_id);
    const sub = get('SELECT id, slug, name_fr, name_ar FROM categories WHERE id = ?', l.subcategory_id);
    const similar = all(`${LOT_SELECT} WHERE l.category_id = ? AND l.id <> ? AND l.status IN ('live','upcoming') ORDER BY l.ends_at LIMIT 8`, l.category_id, l.id).map(x => publicLot(x, req.user));
    const watched = req.user ? !!get('SELECT 1 FROM watches WHERE user_id=? AND lot_id=?', req.user.id, l.id) : false;
    const myMax = req.user ? (get('SELECT max_amount FROM proxy_bids WHERE user_id=? AND lot_id=?', req.user.id, l.id) || {}).max_amount || 0 : 0;
    const invoice = req.user && l.winner_id === req.user.id ? get('SELECT id, status FROM invoices WHERE lot_id=? AND user_id=?', l.id, req.user.id) : null;
    res.json({
      lot: publicLot(l, req.user), history, category: cat && { ...cat, filters: parseJSON(cat.filters, []) }, subcategory: sub,
      sale: l.sale_id ? get('SELECT id, title_fr, title_ar, is_live, starts_at, ends_at FROM sales WHERE id = ?', l.sale_id) : null,
      seller: sellerInfo(l.seller_id), similar, watched, my_max: myMax, invoice,
      watchers: get('SELECT COUNT(*) n FROM watches WHERE lot_id=?', l.id).n,
    });
  });

  r.post('/lots/:id/bid', requireUser, (req, res) => {
    if (!rateLimit('bid:' + req.user.id, settingNum('bid_rate_limit', 8), 10000)) return res.status(429).json({ error: 'Trop d\'enchères rapprochées, patientez quelques secondes.' });
    try {
      res.json(engine.placeBid({ user: req.user, lotId: Number(req.params.id), amount: req.body.amount, maxAmount: req.body.max, ip: ip(req) }));
    } catch (e) {
      if (e instanceof BidError) return res.status(e.code).json({ error: e.message });
      throw e;
    }
  });

  r.post('/lots/:id/buy-now', requireUser, (req, res) => {
    try {
      const out = engine.buyNow({ user: req.user, lotId: Number(req.params.id), ip: ip(req) });
      res.json({ ok: true, ...out });
    } catch (e) {
      if (e instanceof BidError) return res.status(e.code).json({ error: e.message });
      throw e;
    }
  });

  r.post('/lots/:id/watch', requireUser, (req, res) => {
    const id = Number(req.params.id);
    if (get('SELECT 1 FROM watches WHERE user_id=? AND lot_id=?', req.user.id, id)) {
      run('DELETE FROM watches WHERE user_id=? AND lot_id=?', req.user.id, id);
      return res.json({ watched: false });
    }
    run('INSERT INTO watches (user_id, lot_id, created_at) VALUES (?,?,?)', req.user.id, id, Date.now());
    res.json({ watched: true });
  });

  r.get('/sales', (req, res) => {
    res.json({ sales: all("SELECT * FROM sales WHERE status IN ('live','upcoming') ORDER BY is_live DESC, starts_at").map(saleJson),
      past: all("SELECT * FROM sales WHERE status='closed' ORDER BY ends_at DESC LIMIT 12").map(saleJson) });
  });
  r.get('/sales/:id', (req, res) => {
    const s = get('SELECT * FROM sales WHERE id = ?', Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Vente introuvable' });
    res.json({ sale: saleJson(s), lots: all(`${LOT_SELECT} WHERE l.sale_id = ? AND ${VISIBLE} ORDER BY l.lot_number, l.id`, s.id).map(l => publicLot(l, req.user)) });
  });

  // Salle de vente live : lot en cours = lot ouvert qui se termine le plus tôt dans la vente live.
  r.get('/live', (req, res) => {
    const sale = get("SELECT * FROM sales WHERE is_live=1 AND status='live' ORDER BY starts_at LIMIT 1")
      || get("SELECT s.* FROM sales s WHERE s.status='live' AND EXISTS (SELECT 1 FROM lots WHERE sale_id=s.id AND status='live') ORDER BY s.is_live DESC, s.ends_at LIMIT 1");
    const upcoming = all("SELECT * FROM sales WHERE status='upcoming' ORDER BY starts_at LIMIT 6").map(saleJson);
    if (!sale) return res.json({ sale: null, upcoming });
    const lots = all(`${LOT_SELECT} WHERE l.sale_id = ? AND l.status IN ('live','upcoming') ORDER BY CASE l.status WHEN 'live' THEN 0 ELSE 1 END, l.ends_at`, sale.id);
    const current = lots[0] || null;
    const past = all(`${LOT_SELECT} WHERE l.sale_id = ? AND l.status IN ('sold','unsold') ORDER BY l.ends_at DESC LIMIT 10`, sale.id);
    const history = current ? all('SELECT user_id, amount, is_auto, created_at FROM bids WHERE lot_id=? AND cancelled=0 ORDER BY id DESC LIMIT 20', current.id).map(b => ({ bidder: engine.bidderCode(b.user_id, current.id), amount: b.amount, is_auto: !!b.is_auto, at: b.created_at })) : [];
    res.json({
      sale: saleJson(sale), current: current && publicLot(current, req.user), history,
      next: lots.slice(1, 13).map(l => publicLot(l, req.user)), past: past.map(l => publicLot(l, req.user)), upcoming,
      viewers: req.app.get('liveViewers')(),
    });
  });

  // Avis flottants : gains récents, avis approuvés, messages personnalisés de l'admin
  r.get('/toasts', (req, res) => {
    if (setting('toasts_enabled') !== '1') return res.json({ items: [] });
    const src = setting('toast_source', 'both');
    const items = [];
    if (src === 'reviews' || src === 'both') {
      for (const w of all(`SELECT u.pseudo name, l.title_fr, l.title_ar, l.ends_at at FROM lots l JOIN users u ON u.id = l.winner_id WHERE l.status='sold' ORDER BY l.ends_at DESC LIMIT 10`)) items.push({ type: 'won', ...w });
      for (const r2 of all(`SELECT author_name name, rating, created_at at FROM reviews WHERE status='approved' ORDER BY created_at DESC LIMIT 10`)) items.push({ type: 'review', ...r2 });
    }
    if (src === 'custom' || src === 'both') for (const m of all('SELECT text_fr, text_ar FROM toast_messages WHERE active=1')) items.push({ type: 'custom', ...m });
    res.json({ items });
  });

  // ---------- Authentification ----------
  r.post('/auth/register', (req, res) => {
    if (!rateLimit('reg:' + ip(req), 5, 3600e3)) return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
    const { name, password, email, city, seller } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Nom requis' });
    if (!phone) return res.status(400).json({ error: 'Numéro invalide : format +253 77 XX XX XX' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail invalide' });
    if (get('SELECT 1 FROM users WHERE phone = ?', phone)) return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });
    if (email && get('SELECT 1 FROM users WHERE email = ?', String(email).toLowerCase())) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
    // Anti-fraude : nombre de comptes créés depuis la même IP
    const sameIp = get("SELECT COUNT(DISTINCT user_id) n FROM ip_log WHERE ip = ? AND action IN ('register','login')", ip(req)).n;
    const flagged = sameIp >= settingNum('max_accounts_per_ip', 3);
    const pseudo = String(name).trim().split(/\s+/)[0].slice(0, 20);
    const u = run('INSERT INTO users (name, pseudo, email, phone, password_hash, is_seller, city, last_ip, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      String(name).trim().slice(0, 80), pseudo, email ? String(email).toLowerCase() : null, phone, hashPassword(password), seller ? 1 : 0, city || null, ip(req), Date.now());
    const id = Number(u.lastInsertRowid);
    run('INSERT INTO ip_log (user_id, ip, action, user_agent, created_at) VALUES (?,?,?,?,?)', id, ip(req), 'register', req.headers['user-agent'] || '', Date.now());
    if (flagged) dbm.logActivity(id, 'fraud.multi_account', 'user', id, { ip: ip(req), accounts_on_ip: sameIp + 1 }, ip(req));
    createSession(res, id);
    res.json({ me: meJson(get('SELECT * FROM users WHERE id = ?', id)) });
  });

  r.post('/auth/login', (req, res) => {
    if (!rateLimit('login:' + ip(req), 10, 600e3)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
    const idf = String(req.body.identifier || '').trim();
    const phone = normalizePhone(idf);
    const u = phone ? get('SELECT * FROM users WHERE phone = ?', phone) : get('SELECT * FROM users WHERE email = ?', idf.toLowerCase());
    if (!u || !verifyPassword(req.body.password || '', u.password_hash)) return res.status(401).json({ error: 'Identifiants incorrects' });
    if (u.banned) return res.status(403).json({ error: 'Ce compte est suspendu. Contactez le support.' });
    run('UPDATE users SET last_ip = ? WHERE id = ?', ip(req), u.id);
    run('INSERT INTO ip_log (user_id, ip, action, user_agent, created_at) VALUES (?,?,?,?,?)', u.id, ip(req), 'login', req.headers['user-agent'] || '', Date.now());
    if (u.totp_enabled) { createSession(res, u.id, 0); return res.json({ need2fa: true }); }
    createSession(res, u.id);
    res.json({ me: meJson(u) });
  });

  r.post('/auth/2fa', (req, res) => {
    if (!req.pendingUser) return res.status(400).json({ error: 'Aucune connexion en attente' });
    if (!rateLimit('2fa:' + req.pendingUser.id, 6, 300e3)) return res.status(429).json({ error: 'Trop de tentatives' });
    if (!verifyTotp(req.pendingUser.totp_secret, req.body.code)) return res.status(401).json({ error: 'Code incorrect' });
    run('UPDATE sessions SET twofa_ok = 1 WHERE token = ?', req.pendingSession.token);
    res.json({ me: meJson(req.pendingUser) });
  });

  r.post('/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

  // ---------- Espace client ----------
  r.get('/me/dashboard', requireUser, (req, res) => {
    const uid = req.user.id;
    const bids = all(`${LOT_SELECT} WHERE l.id IN (SELECT DISTINCT lot_id FROM bids WHERE user_id = ? AND cancelled = 0) ORDER BY CASE l.status WHEN 'live' THEN 0 ELSE 1 END, l.ends_at DESC LIMIT 60`, uid)
      .map(l => ({ ...publicLot(l, req.user), my_best: get('SELECT MAX(amount) m FROM bids WHERE lot_id=? AND user_id=? AND cancelled=0', l.id, uid).m }));
    res.json({
      bids,
      watchlist: all(`${LOT_SELECT} JOIN watches w ON w.lot_id = l.id WHERE w.user_id = ? ORDER BY l.ends_at`, uid).map(l => publicLot(l, req.user)),
      invoices: all('SELECT i.*, l.title_fr, l.title_ar, l.images FROM invoices i JOIN lots l ON l.id = i.lot_id WHERE i.user_id = ? ORDER BY i.created_at DESC', uid).map(i => ({ ...i, image: parseJSON(i.images, [])[0] })),
      notifications: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', uid),
      my_lots: all(`${LOT_SELECT} WHERE l.seller_id = ? ORDER BY l.created_at DESC`, uid).map(l => ({ ...publicLot(l, req.user), status: l.status })),
    });
  });

  r.post('/me/notifications/read', requireUser, (req, res) => { run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id); res.json({ ok: true }); });

  r.post('/me/profile', requireUser, (req, res) => {
    const { name, email, city, lang, password, current_password } = req.body;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail invalide' });
    if (email && get('SELECT 1 FROM users WHERE email = ? AND id <> ?', email.toLowerCase(), req.user.id)) return res.status(409).json({ error: 'E-mail déjà utilisé' });
    run('UPDATE users SET name = COALESCE(?, name), email = ?, city = ?, lang = COALESCE(?, lang) WHERE id = ?', name || null, email ? email.toLowerCase() : null, city || null, lang || null, req.user.id);
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
      if (!verifyPassword(current_password || '', req.user.password_hash)) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), req.user.id);
    }
    res.json({ me: meJson(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  });

  r.get('/invoices/:id', requireUser, (req, res) => {
    const inv = get('SELECT i.*, l.title_fr, l.title_ar, l.images, l.lot_number FROM invoices i JOIN lots l ON l.id = i.lot_id WHERE i.id = ? AND i.user_id = ?', Number(req.params.id), req.user.id);
    if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
    res.json({ invoice: { ...inv, image: parseJSON(inv.images, [])[0] }, methods: payments.listEnabled(req.query.lang), buyer: meJson(req.user) });
  });

  r.post('/invoices/:id/pay', requireUser, (req, res) => {
    const inv = get('SELECT * FROM invoices WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
    if (!['unpaid', 'pending'].includes(inv.status)) return res.status(400).json({ error: 'Cette facture n\'est plus payable' });
    const zone = get('SELECT * FROM zones WHERE id = ? AND active = 1', Number(req.body.zone_id));
    if (!zone) return res.status(400).json({ error: 'Choisissez une zone de livraison' });
    if (!zone.is_pickup && !String(req.body.address || '').trim()) return res.status(400).json({ error: 'Adresse de livraison requise' });
    run('UPDATE invoices SET zone_id=?, address=?, delivery_fee=?, total=amount+buyer_fee+? WHERE id=?', zone.id, String(req.body.address || '').slice(0, 300), zone.fee, zone.fee, inv.id);
    try {
      const out = payments.pay(get('SELECT * FROM invoices WHERE id=?', inv.id), req.body.method, req.body.reference);
      dbm.logActivity(req.user.id, 'invoice.pay', 'invoice', inv.id, { method: req.body.method }, ip(req));
      engine.emit('admin', 'invoice:update', { id: inv.id });
      res.json({ ok: true, ...out });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Webhook prestataire : { invoice, reference, secret } — le secret est défini dans la config de la passerelle.
  r.post('/payments/webhook/:code', (req, res) => {
    const m = get('SELECT * FROM payment_methods WHERE code = ?', req.params.code);
    const cfg = m ? parseJSON(m.config, {}) : {};
    if (!m || !cfg.webhook_secret || req.body.secret !== cfg.webhook_secret) return res.status(403).json({ error: 'forbidden' });
    const inv = get('SELECT * FROM invoices WHERE number = ?', req.body.invoice);
    if (!inv) return res.status(404).json({ error: 'invoice not found' });
    run("UPDATE invoices SET status='paid', paid_at=?, payment_method=?, payment_ref=COALESCE(?, payment_ref), delivery_status=CASE delivery_status WHEN 'waiting' THEN 'preparing' ELSE delivery_status END WHERE id=?", Date.now(), m.code, req.body.reference || null, inv.id);
    engine.notify(inv.user_id, 'paid', `Paiement reçu pour la facture ${inv.number}. Merci !`, '/compte/factures');
    dbm.logActivity(null, 'invoice.webhook_paid', 'invoice', inv.id, { code: m.code });
    res.json({ ok: true });
  });

  // ---------- Dépôt de lot par un vendeur (validation admin) ----------
  r.post('/sell', requireUser, upload.array('photos', 8), (req, res) => {
    const b = req.body;
    const cat = get('SELECT * FROM categories WHERE id = ? AND parent_id IS NULL', Number(b.category_id));
    const sub = get('SELECT * FROM categories WHERE id = ? AND parent_id = ?', Number(b.subcategory_id), cat ? cat.id : -1);
    if (!cat) return res.status(400).json({ error: 'Catégorie requise' });
    if (!b.title || String(b.title).trim().length < 5) return res.status(400).json({ error: 'Titre trop court' });
    const start = Math.floor(Number(b.start_price));
    if (!(start > 0)) return res.status(400).json({ error: 'Mise à prix invalide' });
    if (cat.requires_expiry && !b.expiry_date) return res.status(400).json({ error: 'La DLC est obligatoire pour les produits alimentaires' });
    const imgs = (req.files || []).map(fileUrl);
    if (!imgs.length) return res.status(400).json({ error: 'Ajoutez au moins une photo' });
    const days = Math.min(Math.max(Number(b.duration) || 7, 1), 30);
    const now = Date.now();
    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const desc = esc(b.description).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    const rr = run(`INSERT INTO lots (category_id, subcategory_id, seller_id, title_fr, title_ar, description_fr, condition, location, images, attrs, expiry_date, start_price, reserve_price, buy_now_price, current_price, starts_at, ends_at, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`, cat.id, sub ? sub.id : null, req.user.id, String(b.title).trim().slice(0, 140), b.title_ar ? String(b.title_ar).slice(0, 140) : null, desc,
      b.condition || null, b.location || null, JSON.stringify(imgs), JSON.stringify(parseJSON(b.attrs, {})), b.expiry_date || null, start,
      Math.max(0, Math.floor(Number(b.reserve_price) || 0)), Math.max(0, Math.floor(Number(b.buy_now_price) || 0)), start, now, now + days * 864e5, now, now);
    run('UPDATE users SET is_seller = 1 WHERE id = ?', req.user.id);
    dbm.logActivity(req.user.id, 'lot.submit', 'lot', Number(rr.lastInsertRowid), { title: b.title }, ip(req));
    engine.emit('admin', 'moderation:new', { id: Number(rr.lastInsertRowid) });
    res.json({ ok: true, id: Number(rr.lastInsertRowid) });
  });

  r.post('/reviews', requireUser, (req, res) => {
    const rating = Math.round(Number(req.body.rating));
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Note de 1 à 5' });
    if (!rateLimit('review:' + req.user.id, 3, 86400e3)) return res.status(429).json({ error: 'Limite d\'avis atteinte pour aujourd\'hui' });
    run('INSERT INTO reviews (user_id, seller_id, author_name, rating, comment, created_at) VALUES (?,?,?,?,?,?)', req.user.id, req.body.seller_id ? Number(req.body.seller_id) : null, req.user.pseudo, rating, String(req.body.comment || '').slice(0, 1000), Date.now());
    res.json({ ok: true });
  });

  return r;
};
