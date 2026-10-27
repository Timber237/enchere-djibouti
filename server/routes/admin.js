// API du back-office : contrôle total du site (enchères, identité, contenu, paramètres, données).
const express = require('express');
const dbm = require('../db');
const { get, all, run, tx, setting, logActivity } = dbm;
const engine = require('../engine');
const { parseJSON } = engine;
const { hashPassword, newTotpSecret, verifyTotp, PERMS, ADMIN_ROLES, normalizePhone } = require('../auth');
const { upload, fileUrl } = require('../upload');

const ip = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const SETTING_KEYS = ['site_name', 'slogan_fr', 'slogan_ar', 'logo', 'favicon', 'color_primary', 'color_accent', 'color_dark', 'default_lang', 'currency', 'currencies_enabled', 'rate_USD', 'rate_EUR',
  'anti_snipe_window', 'anti_snipe_extend', 'default_increment', 'buyer_fee_pct', 'seller_commission_pct', 'unverified_bid_limit', 'max_accounts_per_ip', 'bid_rate_limit', 'payment_deadline_hours',
  'whatsapp_number', 'support_email', 'support_phone', 'address', 'deposit_enabled', 'deposit_amount', 'admin_2fa_required', 'toasts_enabled', 'toast_duration', 'toast_interval', 'toast_position', 'toast_source',
  'whatsapp_api_token', 'whatsapp_phone_id', 'social_facebook', 'social_instagram', 'social_tiktok'];

const num = (v, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };
const ts = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : Date.parse(v); };
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => rows.length ? '﻿' + [Object.keys(rows[0]).join(';'), ...rows.map(r => Object.values(r).map(csvCell).join(';'))].join('\n') : '﻿';
const iso = (t) => t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '';

// Recalcule prix courant / meneur d'un lot à partir des enchères non annulées
function recomputeLot(lotId) {
  const top = get('SELECT user_id, amount FROM bids WHERE lot_id=? AND cancelled=0 ORDER BY amount DESC, id ASC LIMIT 1', lotId);
  const count = get('SELECT COUNT(*) n FROM bids WHERE lot_id=? AND cancelled=0', lotId).n;
  const lot = get('SELECT start_price FROM lots WHERE id=?', lotId);
  run('UPDATE lots SET current_price=?, leader_id=?, bids_count=?, updated_at=? WHERE id=?', top ? top.amount : lot.start_price, top ? top.user_id : null, count, Date.now(), lotId);
}

module.exports = function (auth) {
  const r = express.Router();
  const A = auth.requireAdmin;
  const log = (req, action, entity, id, details) => logActivity(req.user.id, action, entity, id, details, ip(req));

  r.get('/me', A(), (req, res) => {
    const u = req.user;
    res.json({ me: { id: u.id, name: u.name, email: u.email, role: u.role, totp_enabled: !!u.totp_enabled }, perms: PERMS[u.role], require2fa: setting('admin_2fa_required') === '1' });
  });

  // ---------- 2FA ----------
  r.post('/2fa/setup', A(), (req, res) => {
    const secret = newTotpSecret();
    run('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?', secret, req.user.id);
    const label = encodeURIComponent(`${setting('site_name')}:${req.user.email || req.user.phone}`);
    res.json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(setting('site_name'))}` });
  });
  r.post('/2fa/enable', A(), (req, res) => {
    const u = get('SELECT totp_secret FROM users WHERE id=?', req.user.id);
    if (!u.totp_secret || !verifyTotp(u.totp_secret, req.body.code)) return res.status(400).json({ error: 'Code incorrect' });
    run('UPDATE users SET totp_enabled=1 WHERE id=?', req.user.id);
    log(req, '2fa.enable', 'user', req.user.id);
    res.json({ ok: true });
  });
  r.post('/2fa/disable', A(), (req, res) => {
    if (!req.user.totp_enabled || !verifyTotp(req.user.totp_secret, req.body.code)) return res.status(400).json({ error: 'Code incorrect' });
    run('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?', req.user.id);
    log(req, '2fa.disable', 'user', req.user.id);
    res.json({ ok: true });
  });

  // ---------- Statistiques ----------
  r.get('/stats', A('dashboard'), (req, res) => {
    const days = Math.min(num(req.query.days, 30), 365);
    const since = Date.now() - days * 864e5;
    const sold = get("SELECT COUNT(*) n, COALESCE(SUM(final_price),0) ca FROM lots WHERE status='sold' AND ends_at >= ?", since);
    const unsold = get("SELECT COUNT(*) n FROM lots WHERE status='unsold' AND ends_at >= ?", since).n;
    const commission = Math.round(sold.ca * Number(setting('seller_commission_pct', 0)) / 100);
    const buyerFees = get("SELECT COALESCE(SUM(buyer_fee),0) s FROM invoices WHERE created_at >= ? AND status <> 'cancelled'", since).s;
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0); const start = d0.getTime() - i * 864e5, end = start + 864e5;
      series.push({
        day: new Date(start).toISOString().slice(5, 10),
        ca: get("SELECT COALESCE(SUM(final_price),0) s FROM lots WHERE status='sold' AND ends_at >= ? AND ends_at < ?", start, end).s,
        bids: get('SELECT COUNT(*) n FROM bids WHERE created_at >= ? AND created_at < ?', start, end).n,
      });
    }
    res.json({
      kpi: {
        ca: sold.ca, sold: sold.n, unsold, commission, buyer_fees: buyerFees,
        conversion: sold.n + unsold ? Math.round(100 * sold.n / (sold.n + unsold)) : 0,
        bids: get('SELECT COUNT(*) n FROM bids WHERE created_at >= ?', since).n,
        active_users: get('SELECT COUNT(DISTINCT user_id) n FROM bids WHERE created_at >= ?', since).n,
        new_users: get('SELECT COUNT(*) n FROM users WHERE created_at >= ?', since).n,
        live_lots: get("SELECT COUNT(*) n FROM lots WHERE status='live'").n,
        pending_lots: get("SELECT COUNT(*) n FROM lots WHERE status='pending'").n,
        unpaid: get("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM invoices WHERE status IN ('unpaid','pending')").n,
        pending_payments: get("SELECT COUNT(*) n FROM invoices WHERE status='pending'").n,
        pending_reviews: get("SELECT COUNT(*) n FROM reviews WHERE status='pending'").n,
        users: get('SELECT COUNT(*) n FROM users').n,
      },
      series,
      top_categories: all(`SELECT c.name_fr name, COUNT(l.id) sold, COALESCE(SUM(l.final_price),0) ca, (SELECT COUNT(*) FROM bids b JOIN lots l2 ON l2.id=b.lot_id WHERE l2.category_id=c.id AND b.created_at >= ?) bids
        FROM categories c LEFT JOIN lots l ON l.category_id = c.id AND l.status='sold' AND l.ends_at >= ? WHERE c.parent_id IS NULL GROUP BY c.id ORDER BY ca DESC, bids DESC`, since, since),
      ending: all("SELECT id, title_fr, current_price, bids_count, ends_at FROM lots WHERE status='live' ORDER BY ends_at LIMIT 8"),
      recent_bids: all('SELECT b.id, b.amount, b.created_at, b.is_auto, u.name, l.title_fr, l.id lot_id FROM bids b JOIN users u ON u.id=b.user_id JOIN lots l ON l.id=b.lot_id ORDER BY b.id DESC LIMIT 10'),
    });
  });

  // ---------- Lots ----------
  r.get('/lots', A('lots'), (req, res) => {
    const q = req.query, where = ['1=1'], p = [];
    if (q.status) { where.push('l.status = ?'); p.push(q.status); }
    if (q.category) { where.push('l.category_id = ?'); p.push(num(q.category)); }
    if (q.sale) { where.push('l.sale_id = ?'); p.push(num(q.sale)); }
    if (q.q) { where.push('(l.title_fr LIKE ? OR l.id = ? OR l.lot_number = ?)'); p.push(`%${q.q}%`, num(q.q, -1), num(q.q, -1)); }
    const per = 25, page = Math.max(num(q.page, 1), 1);
    const total = get(`SELECT COUNT(*) n FROM lots l WHERE ${where.join(' AND ')}`, ...p).n;
    const rows = all(`SELECT l.*, c.name_fr cat, s.title_fr sale, u.name seller FROM lots l LEFT JOIN categories c ON c.id=l.category_id LEFT JOIN sales s ON s.id=l.sale_id LEFT JOIN users u ON u.id=l.seller_id
      WHERE ${where.join(' AND ')} ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'live' THEN 1 WHEN 'upcoming' THEN 2 ELSE 3 END, l.ends_at DESC LIMIT ? OFFSET ?`, ...p, per, (page - 1) * per);
    res.json({ total, pages: Math.ceil(total / per), lots: rows.map(l => ({ ...l, images: parseJSON(l.images, []), attrs: parseJSON(l.attrs, {}) })) });
  });

  r.get('/lots/:id', A('lots'), (req, res) => {
    const l = get('SELECT * FROM lots WHERE id=?', num(req.params.id));
    if (!l) return res.status(404).json({ error: 'Lot introuvable' });
    res.json({
      lot: { ...l, images: parseJSON(l.images, []), attrs: parseJSON(l.attrs, {}) },
      bids: all('SELECT b.*, u.name, u.phone, u.verified FROM bids b JOIN users u ON u.id=b.user_id WHERE b.lot_id=? ORDER BY b.id DESC', l.id),
      proxies: all('SELECT p.*, u.name FROM proxy_bids p JOIN users u ON u.id=p.user_id WHERE p.lot_id=? ORDER BY max_amount DESC', l.id),
    });
  });

  function lotFields(b, files, existing) {
    let images = b.images !== undefined ? parseJSON(b.images, []) : (existing ? parseJSON(existing.images, []) : []);
    images = images.concat((files || []).map(fileUrl));
    return {
      sale_id: b.sale_id ? num(b.sale_id) : null, category_id: num(b.category_id) || null, subcategory_id: num(b.subcategory_id) || null, seller_id: b.seller_id ? num(b.seller_id) : (existing ? existing.seller_id : null),
      lot_number: b.lot_number ? num(b.lot_number) : null, title_fr: String(b.title_fr || '').trim(), title_ar: b.title_ar || null, description_fr: b.description_fr || '', description_ar: b.description_ar || '',
      condition: b.condition || null, location: b.location || null, images: JSON.stringify(images), attrs: typeof b.attrs === 'string' ? JSON.stringify(parseJSON(b.attrs, {})) : JSON.stringify(b.attrs || {}),
      expiry_date: b.expiry_date || null, start_price: num(b.start_price), reserve_price: num(b.reserve_price), increment: num(b.increment), buy_now_price: num(b.buy_now_price),
      starts_at: ts(b.starts_at), ends_at: ts(b.ends_at), featured: b.featured === '1' || b.featured === true || b.featured === 1 ? 1 : 0, favorite: b.favorite === '1' || b.favorite === true || b.favorite === 1 ? 1 : 0,
      status: b.status || null,
    };
  }
  function validateLot(f) {
    if (!f.title_fr) return 'Titre requis';
    if (!f.category_id) return 'Catégorie requise';
    if (!(f.start_price > 0)) return 'Prix de départ invalide';
    if (!f.starts_at || !f.ends_at || f.ends_at <= f.starts_at) return 'Dates de début/fin invalides';
    const cat = get('SELECT requires_expiry FROM categories WHERE id=?', f.category_id);
    if (cat && cat.requires_expiry && !f.expiry_date) return 'DLC obligatoire pour la catégorie Nourriture';
    return null;
  }

  r.post('/lots', A('lots'), upload.array('files', 8), (req, res) => {
    const f = lotFields(req.body, req.files);
    const err = validateLot(f); if (err) return res.status(400).json({ error: err });
    const now = Date.now();
    f.status = f.status && ['upcoming', 'live', 'suspended', 'pending'].includes(f.status) ? f.status : (f.starts_at <= now ? 'live' : 'upcoming');
    const keys = Object.keys(f);
    const rr = run(`INSERT INTO lots (${keys.join(',')}, current_price, created_at, updated_at) VALUES (${keys.map(() => '?').join(',')}, ?, ?, ?)`, ...keys.map(k => f[k]), f.start_price, now, now);
    log(req, 'lot.create', 'lot', Number(rr.lastInsertRowid), { title: f.title_fr });
    engine.broadcastLot(Number(rr.lastInsertRowid));
    res.json({ ok: true, id: Number(rr.lastInsertRowid) });
  });

  // Modification EN DIRECT : prix, réserve, palier, horaires, textes, photos, catégorie, statut.
  r.put('/lots/:id', A('lots'), upload.array('files', 8), (req, res) => {
    const id = num(req.params.id);
    const l = get('SELECT * FROM lots WHERE id=?', id);
    if (!l) return res.status(404).json({ error: 'Lot introuvable' });
    const f = lotFields(req.body, req.files, l);
    const err = validateLot(f); if (err) return res.status(400).json({ error: err });
    if (!f.status) f.status = l.status;
    // Changement de statut via dates : réouverture si la fin est repoussée
    const now = Date.now();
    if (['sold', 'unsold'].includes(l.status) && f.status === l.status && f.ends_at > now && req.body.reopen === '1') f.status = f.starts_at <= now ? 'live' : 'upcoming';
    if (f.status === 'upcoming' && f.starts_at <= now && f.ends_at > now) f.status = 'live';
    if (f.status === 'live' && f.starts_at > now) f.status = 'upcoming';
    const changes = {};
    for (const k of Object.keys(f)) if (String(f[k] ?? '') !== String(l[k] ?? '')) changes[k] = [k === 'description_fr' || k === 'description_ar' ? '…' : l[k], k === 'description_fr' || k === 'description_ar' ? '…' : f[k]];
    const sets = Object.keys(f).map(k => `${k}=?`).join(',');
    run(`UPDATE lots SET ${sets}, current_price = CASE WHEN bids_count=0 THEN ? ELSE current_price END, updated_at=? WHERE id=?`, ...Object.values(f), f.start_price, now, id);
    log(req, 'lot.update', 'lot', id, changes);
    engine.broadcastLot(id, { admin_update: true });
    res.json({ ok: true });
  });

  r.delete('/lots/:id', A('lots'), (req, res) => {
    const id = num(req.params.id);
    const l = get('SELECT title_fr, status FROM lots WHERE id=?', id);
    if (!l) return res.status(404).json({ error: 'Lot introuvable' });
    if (get('SELECT 1 FROM invoices WHERE lot_id=?', id)) return res.status(400).json({ error: 'Lot facturé : retirez-le plutôt que de le supprimer.' });
    run('DELETE FROM lots WHERE id=?', id);
    log(req, 'lot.delete', 'lot', id, { title: l.title_fr });
    engine.emit('catalog', 'lot:update', { id, status: 'withdrawn' });
    res.json({ ok: true });
  });

  r.post('/lots/:id/action', A('lots'), (req, res) => {
    const id = num(req.params.id), a = req.body.action, now = Date.now();
    const l = get('SELECT * FROM lots WHERE id=?', id);
    if (!l) return res.status(404).json({ error: 'Lot introuvable' });
    const set = (sql, ...p) => run(`UPDATE lots SET ${sql}, updated_at=? WHERE id=?`, ...p, now, id);
    switch (a) {
      case 'close': engine.closeLot(id, { byAdmin: req.user.id }); break;
      case 'close_sold': engine.closeLot(id, { byAdmin: req.user.id, forceSold: true }); break;
      case 'extend': set('ends_at = MAX(ends_at, ?) + ?', now, num(req.body.minutes, 5) * 60e3); break;
      case 'suspend': if (l.status !== 'live' && l.status !== 'upcoming') return res.status(400).json({ error: 'Seul un lot ouvert ou à venir peut être suspendu' }); set("status='suspended'"); break;
      case 'resume': if (l.status !== 'suspended') return res.status(400).json({ error: 'Lot non suspendu' }); set("status=CASE WHEN starts_at <= ? THEN 'live' ELSE 'upcoming' END, ends_at=MAX(ends_at, ?)", now, now + 5 * 60e3); break;
      case 'relaunch': {
        // Relance : remet le lot en vente pour N heures (enchères précédentes conservées dans l'historique mais annulées)
        if (get("SELECT 1 FROM invoices WHERE lot_id=? AND status IN ('paid')", id)) return res.status(400).json({ error: 'Lot déjà payé' });
        tx(() => {
          run("UPDATE invoices SET status='cancelled' WHERE lot_id=? AND status IN ('unpaid','pending')", id);
          run('UPDATE bids SET cancelled=1 WHERE lot_id=?', id);
          run('DELETE FROM proxy_bids WHERE lot_id=?', id);
          set("status='live', starts_at=?, ends_at=?, current_price=start_price, bids_count=0, leader_id=NULL, winner_id=NULL, final_price=NULL", now, now + num(req.body.hours, 24) * 3600e3);
        });
        break;
      }
      case 'withdraw': set("status='withdrawn'"); break;
      case 'approve': if (l.status !== 'pending') return res.status(400).json({ error: 'Lot non en attente' }); {
        const dur = Math.max(l.ends_at - l.starts_at, 864e5);
        const start = req.body.starts_at ? ts(req.body.starts_at) : now;
        set("status=?, starts_at=?, ends_at=?, sale_id=COALESCE(?, sale_id)", start <= now ? 'live' : 'upcoming', start, start + dur, req.body.sale_id ? num(req.body.sale_id) : null);
        if (l.seller_id) engine.notify(l.seller_id, 'approved', `Votre lot « ${l.title_fr} » a été validé et mis en vente.`, `/lot/${id}`);
        break;
      }
      case 'reject': set("status='rejected'"); if (l.seller_id) engine.notify(l.seller_id, 'rejected', `Votre lot « ${l.title_fr} » n'a pas été retenu. ${req.body.reason || ''}`.trim(), '/compte/lots'); break;
      case 'feature': set('featured = 1 - featured'); break;
      case 'favorite': set('favorite = 1 - favorite'); break;
      default: return res.status(400).json({ error: 'Action inconnue' });
    }
    log(req, 'lot.' + a, 'lot', id, req.body);
    engine.broadcastLot(id, { admin_update: true });
    res.json({ ok: true, lot: get('SELECT * FROM lots WHERE id=?', id) });
  });

  // ---------- Ventes ----------
  r.get('/sales', A('sales'), (req, res) => res.json({ sales: all('SELECT s.*, (SELECT COUNT(*) FROM lots WHERE sale_id=s.id) lots FROM sales s ORDER BY s.starts_at DESC') }));
  const saleFields = (b, files, ex) => ({
    title_fr: String(b.title_fr || '').trim(), title_ar: b.title_ar || null, description_fr: b.description_fr || '', description_ar: b.description_ar || '',
    cover: files && files[0] ? fileUrl(files[0]) : (b.cover !== undefined ? b.cover : (ex ? ex.cover : null)), is_live: b.is_live === '1' || b.is_live === true ? 1 : 0, starts_at: ts(b.starts_at), ends_at: ts(b.ends_at),
  });
  r.post('/sales', A('sales'), upload.array('files', 1), (req, res) => {
    const f = saleFields(req.body, req.files);
    if (!f.title_fr || !f.starts_at || !f.ends_at || f.ends_at <= f.starts_at) return res.status(400).json({ error: 'Titre et dates valides requis' });
    const rr = run('INSERT INTO sales (title_fr, title_ar, description_fr, description_ar, cover, is_live, starts_at, ends_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      f.title_fr, f.title_ar, f.description_fr, f.description_ar, f.cover, f.is_live, f.starts_at, f.ends_at, f.starts_at <= Date.now() ? 'live' : 'upcoming', Date.now());
    log(req, 'sale.create', 'sale', Number(rr.lastInsertRowid), { title: f.title_fr });
    res.json({ ok: true, id: Number(rr.lastInsertRowid) });
  });
  r.put('/sales/:id', A('sales'), upload.array('files', 1), (req, res) => {
    const s = get('SELECT * FROM sales WHERE id=?', num(req.params.id));
    if (!s) return res.status(404).json({ error: 'Vente introuvable' });
    const f = saleFields(req.body, req.files, s);
    if (!f.title_fr || !f.starts_at || !f.ends_at || f.ends_at <= f.starts_at) return res.status(400).json({ error: 'Titre et dates valides requis' });
    const now = Date.now();
    const status = req.body.status || (f.ends_at <= now ? 'closed' : f.starts_at <= now ? 'live' : 'upcoming');
    run('UPDATE sales SET title_fr=?, title_ar=?, description_fr=?, description_ar=?, cover=?, is_live=?, starts_at=?, ends_at=?, status=? WHERE id=?', f.title_fr, f.title_ar, f.description_fr, f.description_ar, f.cover, f.is_live, f.starts_at, f.ends_at, status, s.id);
    log(req, 'sale.update', 'sale', s.id, { title: f.title_fr });
    engine.emit('catalog', 'sale:update', { id: s.id });
    res.json({ ok: true });
  });
  r.delete('/sales/:id', A('sales'), (req, res) => {
    run('UPDATE lots SET sale_id=NULL WHERE sale_id=?', num(req.params.id));
    run('DELETE FROM sales WHERE id=?', num(req.params.id));
    log(req, 'sale.delete', 'sale', num(req.params.id));
    res.json({ ok: true });
  });
  // Programme les lots de la vente en séquence (salle live : un lot se clôture toutes les N minutes)
  r.post('/sales/:id/schedule', A('sales'), (req, res) => {
    const id = num(req.params.id), start = ts(req.body.first_end) || Date.now() + 5 * 60e3, step = Math.max(num(req.body.interval, 3), 1) * 60e3;
    const lots = all("SELECT id FROM lots WHERE sale_id=? AND status IN ('live','upcoming','suspended') ORDER BY lot_number, id", id);
    const now = Date.now();
    tx(() => lots.forEach((l, i) => run("UPDATE lots SET ends_at=?, starts_at=MIN(starts_at, ?), status=CASE WHEN status='suspended' THEN status WHEN MIN(starts_at, ?) <= ? THEN 'live' ELSE 'upcoming' END, updated_at=? WHERE id=?", start + i * step, now, now, now, now, l.id)));
    run('UPDATE sales SET ends_at=MAX(ends_at, ?), status=\'live\', starts_at=MIN(starts_at, ?) WHERE id=?', start + lots.length * step, now, id);
    lots.forEach(l => engine.broadcastLot(l.id, { admin_update: true }));
    log(req, 'sale.schedule', 'sale', id, { lots: lots.length, interval_min: step / 60e3 });
    res.json({ ok: true, count: lots.length });
  });

  // ---------- Utilisateurs ----------
  r.get('/users', A('users'), (req, res) => {
    const q = req.query, where = ['1=1'], p = [];
    if (q.q) { where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ? OR pseudo LIKE ?)'); const k = `%${q.q}%`; p.push(k, k, k, k); }
    if (q.role) { where.push('role = ?'); p.push(q.role); }
    if (q.filter === 'unverified') where.push('verified = 0');
    if (q.filter === 'banned') where.push('banned = 1');
    if (q.filter === 'sellers') where.push('is_seller = 1');
    res.json({ users: all(`SELECT id, name, pseudo, email, phone, role, is_seller, verified, seller_verified, banned, deposit, city, last_ip, totp_enabled, created_at,
      (SELECT COUNT(*) FROM bids WHERE user_id=users.id) bids, (SELECT COUNT(*) FROM lots WHERE winner_id=users.id) won FROM users WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`, ...p) });
  });
  r.get('/users/:id', A('users'), (req, res) => {
    const id = num(req.params.id);
    const u = get('SELECT id, name, pseudo, email, phone, role, is_seller, verified, seller_verified, banned, deposit, city, last_ip, totp_enabled, created_at FROM users WHERE id=?', id);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const ips = all('SELECT ip, COUNT(*) n, MAX(created_at) last FROM ip_log WHERE user_id=? GROUP BY ip ORDER BY last DESC', id);
    res.json({ user: u, ips, shared: all(`SELECT DISTINCT u.id, u.name, u.phone, l.ip FROM ip_log l JOIN users u ON u.id=l.user_id WHERE l.ip IN (SELECT ip FROM ip_log WHERE user_id=?) AND u.id<>?`, id, id),
      bids: all('SELECT b.*, l.title_fr FROM bids b JOIN lots l ON l.id=b.lot_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 50', id) });
  });
  r.post('/users', A('users'), (req, res) => {
    const b = req.body; const phone = normalizePhone(b.phone);
    if (!b.name || !phone || !b.password || String(b.password).length < 8) return res.status(400).json({ error: 'Nom, téléphone +253 valide et mot de passe (8+) requis' });
    if (b.role && b.role !== 'user' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Seul un super-admin peut créer un compte d\'administration' });
    if (get('SELECT 1 FROM users WHERE phone=? OR (email IS NOT NULL AND email=?)', phone, (b.email || '').toLowerCase())) return res.status(409).json({ error: 'Téléphone ou e-mail déjà utilisé' });
    const rr = run('INSERT INTO users (name, pseudo, email, phone, password_hash, role, verified, created_at) VALUES (?,?,?,?,?,?,?,?)', b.name, String(b.name).split(' ')[0], b.email ? b.email.toLowerCase() : null, phone, hashPassword(b.password), b.role || 'user', 1, Date.now());
    log(req, 'user.create', 'user', Number(rr.lastInsertRowid), { role: b.role || 'user' });
    res.json({ ok: true });
  });
  r.put('/users/:id', A('users'), (req, res) => {
    const id = num(req.params.id), b = req.body;
    const u = get('SELECT * FROM users WHERE id=?', id);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (b.role !== undefined && b.role !== u.role) {
      if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Seul un super-admin peut changer les rôles' });
      if (!['user', ...ADMIN_ROLES].includes(b.role)) return res.status(400).json({ error: 'Rôle inconnu' });
      if (u.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas changer votre propre rôle' });
    }
    if (ADMIN_ROLES.includes(u.role) && req.user.role !== 'superadmin' && u.id !== req.user.id) return res.status(403).json({ error: 'Compte d\'administration protégé' });
    const f = {
      verified: b.verified !== undefined ? (b.verified ? 1 : 0) : u.verified, seller_verified: b.seller_verified !== undefined ? (b.seller_verified ? 1 : 0) : u.seller_verified,
      banned: b.banned !== undefined ? (b.banned ? 1 : 0) : u.banned, is_seller: b.is_seller !== undefined ? (b.is_seller ? 1 : 0) : u.is_seller,
      role: b.role !== undefined ? b.role : u.role, deposit: b.deposit !== undefined ? num(b.deposit) : u.deposit,
    };
    if (f.banned && u.id === req.user.id) return res.status(400).json({ error: 'Impossible de vous bannir vous-même' });
    run('UPDATE users SET verified=?, seller_verified=?, banned=?, is_seller=?, role=?, deposit=? WHERE id=?', f.verified, f.seller_verified, f.banned, f.is_seller, f.role, f.deposit, id);
    if (f.banned && !u.banned) run('DELETE FROM sessions WHERE user_id=?', id);
    if (b.password) { if (String(b.password).length < 8) return res.status(400).json({ error: 'Mot de passe trop court' }); run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(b.password), id); }
    if (f.verified && !u.verified) engine.notify(id, 'verified', 'Votre compte est désormais vérifié : la limite d\'enchère est levée.', '/compte');
    log(req, 'user.update', 'user', id, Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== u[k])));
    res.json({ ok: true });
  });

  // ---------- Enchères (annulation frauduleuse) ----------
  r.get('/bids', A('bids'), (req, res) => {
    const where = req.query.lot ? 'WHERE b.lot_id = ?' : '', p = req.query.lot ? [num(req.query.lot)] : [];
    res.json({ bids: all(`SELECT b.*, u.name, u.phone, u.verified, l.title_fr, l.status lot_status FROM bids b JOIN users u ON u.id=b.user_id JOIN lots l ON l.id=b.lot_id ${where} ORDER BY b.id DESC LIMIT 300`, ...p) });
  });
  r.post('/bids/:id/cancel', A('bids'), (req, res) => {
    const b = get('SELECT * FROM bids WHERE id=?', num(req.params.id));
    if (!b) return res.status(404).json({ error: 'Enchère introuvable' });
    const lot = get('SELECT status FROM lots WHERE id=?', b.lot_id);
    if (lot.status !== 'live') return res.status(400).json({ error: 'Annulation possible uniquement sur un lot en cours (relancez sinon le lot)' });
    tx(() => {
      // Annule toutes les enchères de cet utilisateur sur ce lot et son enchère automatique
      run('UPDATE bids SET cancelled=1 WHERE lot_id=? AND user_id=?', b.lot_id, b.user_id);
      run('DELETE FROM proxy_bids WHERE lot_id=? AND user_id=?', b.lot_id, b.user_id);
      recomputeLot(b.lot_id);
    });
    log(req, 'bid.cancel', 'bid', b.id, { lot: b.lot_id, user: b.user_id, amount: b.amount, reason: req.body.reason });
    engine.broadcastLot(b.lot_id, { history_changed: true });
    res.json({ ok: true });
  });

  // ---------- Factures ----------
  r.get('/invoices', A('invoices'), (req, res) => {
    const where = req.query.status ? 'WHERE i.status = ?' : '', p = req.query.status ? [req.query.status] : [];
    res.json({ invoices: all(`SELECT i.*, u.name, u.phone, l.title_fr, z.name_fr zone FROM invoices i JOIN users u ON u.id=i.user_id JOIN lots l ON l.id=i.lot_id LEFT JOIN zones z ON z.id=i.zone_id ${where} ORDER BY i.id DESC LIMIT 300`, ...p) });
  });
  r.put('/invoices/:id', A('invoices'), (req, res) => {
    const inv = get('SELECT * FROM invoices WHERE id=?', num(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
    const b = req.body;
    const status = b.status || inv.status, delivery = b.delivery_status || inv.delivery_status;
    run('UPDATE invoices SET status=?, delivery_status=?, tracking=?, paid_at=CASE WHEN ?=\'paid\' AND paid_at IS NULL THEN ? ELSE paid_at END WHERE id=?', status, delivery, b.tracking ?? inv.tracking, status, Date.now(), inv.id);
    if (status === 'paid' && inv.status !== 'paid') engine.notify(inv.user_id, 'paid', `Paiement confirmé pour la facture ${inv.number}. Merci !`, '/compte/factures');
    if (delivery !== inv.delivery_status) engine.notify(inv.user_id, 'delivery', `Facture ${inv.number} : statut de livraison mis à jour.`, '/compte/factures');
    log(req, 'invoice.update', 'invoice', inv.id, { status, delivery });
    res.json({ ok: true });
  });

  // ---------- Catégories ----------
  r.get('/categories', A('catalog'), (req, res) => res.json({ categories: all('SELECT c.*, (SELECT COUNT(*) FROM lots WHERE category_id=c.id OR subcategory_id=c.id) lots FROM categories c ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, sort') }));
  const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  r.post('/categories', A('catalog'), (req, res) => {
    const b = req.body; if (!b.name_fr) return res.status(400).json({ error: 'Nom requis' });
    let slug = slugify(b.slug || b.name_fr); if (get('SELECT 1 FROM categories WHERE slug=?', slug)) slug += '-' + Date.now().toString(36).slice(-4);
    const rr = run('INSERT INTO categories (parent_id, slug, name_fr, name_ar, icon, filters, requires_expiry, sort, active, image) VALUES (?,?,?,?,?,?,?,?,1,?)', b.parent_id ? num(b.parent_id) : null, slug, b.name_fr, b.name_ar || b.name_fr, b.icon || 'box', b.filters || '[]', b.requires_expiry === true || b.requires_expiry === '1' ? 1 : 0, num(b.sort, 99), b.image || null);
    log(req, 'category.create', 'category', Number(rr.lastInsertRowid), { name: b.name_fr });
    res.json({ ok: true });
  });
  r.put('/categories/:id', A('catalog'), (req, res) => {
    const b = req.body, c = get('SELECT * FROM categories WHERE id=?', num(req.params.id));
    if (!c) return res.status(404).json({ error: 'Catégorie introuvable' });
    if (b.filters) try { JSON.parse(b.filters); } catch { return res.status(400).json({ error: 'Filtres : JSON invalide' }); }
    run('UPDATE categories SET name_fr=?, name_ar=?, icon=?, filters=?, requires_expiry=?, sort=?, active=?, image=? WHERE id=?', b.name_fr ?? c.name_fr, b.name_ar ?? c.name_ar, b.icon ?? c.icon, b.filters ?? c.filters,
      b.requires_expiry !== undefined ? (b.requires_expiry ? 1 : 0) : c.requires_expiry, b.sort !== undefined ? num(b.sort) : c.sort, b.active !== undefined ? (b.active ? 1 : 0) : c.active, b.image !== undefined ? (b.image || null) : c.image, c.id);
    log(req, 'category.update', 'category', c.id, { name: b.name_fr ?? c.name_fr });
    res.json({ ok: true });
  });
  r.delete('/categories/:id', A('catalog'), (req, res) => {
    const id = num(req.params.id);
    if (get('SELECT 1 FROM lots WHERE category_id=? OR subcategory_id=?', id, id)) return res.status(400).json({ error: 'Des lots utilisent cette catégorie : désactivez-la plutôt.' });
    run('DELETE FROM categories WHERE id=?', id);
    log(req, 'category.delete', 'category', id);
    res.json({ ok: true });
  });

  // ---------- Paiements & livraison ----------
  r.get('/payments', A('payments'), (req, res) => res.json({ methods: all('SELECT * FROM payment_methods ORDER BY sort') }));
  r.put('/payments/:code', A('payments'), (req, res) => {
    const m = get('SELECT * FROM payment_methods WHERE code=?', req.params.code);
    if (!m) return res.status(404).json({ error: 'Passerelle inconnue' });
    const b = req.body;
    if (b.config !== undefined) try { JSON.parse(b.config); } catch { return res.status(400).json({ error: 'Configuration : JSON invalide' }); }
    run('UPDATE payment_methods SET name=?, enabled=?, instructions_fr=?, instructions_ar=?, config=?, sort=? WHERE code=?', b.name ?? m.name, b.enabled !== undefined ? (b.enabled ? 1 : 0) : m.enabled,
      b.instructions_fr ?? m.instructions_fr, b.instructions_ar ?? m.instructions_ar, b.config ?? m.config, b.sort !== undefined ? num(b.sort) : m.sort, m.code);
    log(req, 'payment.update', 'payment', null, { code: m.code, enabled: b.enabled });
    res.json({ ok: true });
  });

  function crud(path, table, perm, fields, opts = {}) {
    r.get(`/${path}`, A(perm), (req, res) => res.json({ items: all(`SELECT * FROM ${table} ORDER BY ${opts.order || 'sort, id'}`) }));
    const values = (req, ex) => fields.map(f => {
      if (f === opts.file) return req.files && req.files[0] ? fileUrl(req.files[0]) : (req.body[f] !== undefined ? req.body[f] : (ex ? ex[f] : null));
      const v = req.body[f];
      if (v === undefined) return ex ? ex[f] : (['active', 'sort', 'fee', 'is_pickup'].includes(f) ? (f === 'active' ? 1 : 0) : null);
      if (['active', 'is_pickup', 'featured'].includes(f)) return v === true || v === '1' || v === 1 ? 1 : 0;
      if (['sort', 'fee', 'rating'].includes(f)) return num(v);
      return v;
    });
    const mw = opts.file ? [upload.array('files', 1)] : [];
    r.post(`/${path}`, A(perm), ...mw, (req, res) => {
      const rr = run(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, ...values(req));
      log(req, `${path}.create`, path, Number(rr.lastInsertRowid));
      res.json({ ok: true, id: Number(rr.lastInsertRowid) });
    });
    r.put(`/${path}/:id`, A(perm), ...mw, (req, res) => {
      const ex = get(`SELECT * FROM ${table} WHERE id=?`, num(req.params.id));
      if (!ex) return res.status(404).json({ error: 'Élément introuvable' });
      run(`UPDATE ${table} SET ${fields.map(f => `${f}=?`).join(',')} WHERE id=?`, ...values(req, ex), ex.id);
      log(req, `${path}.update`, path, ex.id);
      res.json({ ok: true });
    });
    r.delete(`/${path}/:id`, A(perm), (req, res) => {
      run(`DELETE FROM ${table} WHERE id=?`, num(req.params.id));
      log(req, `${path}.delete`, path, num(req.params.id));
      res.json({ ok: true });
    });
  }
  crud('zones', 'zones', 'delivery', ['name_fr', 'name_ar', 'fee', 'delay_fr', 'is_pickup', 'active', 'sort']);
  crud('partners', 'partners', 'content', ['name', 'logo', 'url', 'sort', 'active'], { file: 'logo' });
  crud('banners', 'banners', 'content', ['kind', 'title_fr', 'title_ar', 'subtitle_fr', 'subtitle_ar', 'image', 'link', 'sort', 'active'], { file: 'image', order: 'kind, sort, id' });
  crud('toasts', 'toast_messages', 'reviews', ['text_fr', 'text_ar', 'active'], { order: 'id DESC' });

  // ---------- Avis ----------
  r.get('/reviews', A('reviews'), (req, res) => res.json({ reviews: all('SELECT r.*, s.name seller FROM reviews r LEFT JOIN users s ON s.id=r.seller_id ORDER BY CASE r.status WHEN \'pending\' THEN 0 ELSE 1 END, r.id DESC') }));
  r.put('/reviews/:id', A('reviews'), (req, res) => {
    const rv = get('SELECT * FROM reviews WHERE id=?', num(req.params.id));
    if (!rv) return res.status(404).json({ error: 'Avis introuvable' });
    const b = req.body;
    run('UPDATE reviews SET status=?, featured=?, author_name=?, comment=?, rating=? WHERE id=?', b.status ?? rv.status, b.featured !== undefined ? (b.featured ? 1 : 0) : rv.featured, b.author_name ?? rv.author_name, b.comment ?? rv.comment, b.rating !== undefined ? Math.min(5, Math.max(1, num(b.rating))) : rv.rating, rv.id);
    log(req, 'review.update', 'review', rv.id, { status: b.status, featured: b.featured });
    res.json({ ok: true });
  });
  r.post('/reviews', A('reviews'), (req, res) => {
    const b = req.body;
    if (!b.author_name || !b.rating) return res.status(400).json({ error: 'Nom et note requis' });
    run('INSERT INTO reviews (author_name, rating, comment, status, featured, seller_id, created_at) VALUES (?,?,?,?,?,?,?)', b.author_name, Math.min(5, Math.max(1, num(b.rating))), b.comment || '', 'approved', b.featured ? 1 : 0, b.seller_id ? num(b.seller_id) : null, Date.now());
    log(req, 'review.create', 'review', null);
    res.json({ ok: true });
  });
  r.delete('/reviews/:id', A('reviews'), (req, res) => { run('DELETE FROM reviews WHERE id=?', num(req.params.id)); log(req, 'review.delete', 'review', num(req.params.id)); res.json({ ok: true }); });

  // ---------- Identité, paramètres & textes ----------
  r.get('/settings', A('settings'), (req, res) => res.json({ settings: Object.fromEntries(SETTING_KEYS.map(k => [k, setting(k, '')])) }));
  r.put('/settings', A('settings'), (req, res) => {
    const identityKeys = ['site_name', 'slogan_fr', 'slogan_ar', 'logo', 'favicon', 'color_primary', 'color_accent', 'color_dark'];
    const changed = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (!SETTING_KEYS.includes(k)) continue;
      if (k.startsWith('color_') && v && !/^#[0-9a-fA-F]{6}$/.test(v)) return res.status(400).json({ error: `Couleur invalide : ${k}` });
      if (String(setting(k, '')) !== String(v)) { changed[k] = k.includes('token') ? '***' : v; dbm.setSetting(k, v); }
    }
    void identityKeys;
    log(req, 'settings.update', 'settings', null, changed);
    engine.emit('catalog', 'settings:update', {});
    res.json({ ok: true });
  });
  r.post('/settings/upload/:key', A('identity'), upload.array('files', 1), (req, res) => {
    if (!['logo', 'favicon'].includes(req.params.key) || !req.files || !req.files[0]) return res.status(400).json({ error: 'Fichier requis' });
    dbm.setSetting(req.params.key, fileUrl(req.files[0]));
    log(req, 'identity.upload', 'settings', null, { key: req.params.key });
    engine.emit('catalog', 'settings:update', {});
    res.json({ ok: true, url: fileUrl(req.files[0]) });
  });
  r.post('/upload', A(), upload.array('files', 8), (req, res) => res.json({ urls: (req.files || []).map(fileUrl) }));

  r.get('/texts', A('content'), (req, res) => res.json({ texts: all('SELECT * FROM texts ORDER BY key') }));
  r.put('/texts/:key', A('content'), (req, res) => {
    const t = get('SELECT * FROM texts WHERE key=?', req.params.key);
    if (!t) run('INSERT INTO texts (key, fr, ar, long) VALUES (?,?,?,?)', req.params.key, req.body.fr || '', req.body.ar || '', req.body.long ? 1 : 0);
    else run('UPDATE texts SET fr=?, ar=? WHERE key=?', req.body.fr ?? t.fr, req.body.ar ?? t.ar, t.key);
    log(req, 'text.update', 'text', null, { key: req.params.key });
    res.json({ ok: true });
  });

  // ---------- Journal, anti-fraude, file d'envoi ----------
  r.get('/logs', A('logs'), (req, res) => {
    const page = Math.max(num(req.query.page, 1), 1);
    res.json({ logs: all('SELECT a.*, u.name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100 OFFSET ?', (page - 1) * 100), total: get('SELECT COUNT(*) n FROM activity_log').n });
  });
  r.get('/fraud', A('fraud'), (req, res) => {
    res.json({
      shared_ips: all(`SELECT ip, COUNT(DISTINCT user_id) accounts, GROUP_CONCAT(DISTINCT user_id) user_ids, MAX(created_at) last FROM ip_log WHERE ip IS NOT NULL GROUP BY ip HAVING accounts > 1 ORDER BY accounts DESC LIMIT 100`)
        .map(r2 => ({ ...r2, users: all(`SELECT id, name, phone, verified, banned FROM users WHERE id IN (${r2.user_ids.split(',').map(Number).join(',')})`) })),
      flags: all("SELECT a.*, u.name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.action LIKE 'fraud.%' ORDER BY a.id DESC LIMIT 100"),
      fast_bidders: all('SELECT u.id, u.name, u.phone, u.verified, COUNT(*) n FROM bids b JOIN users u ON u.id=b.user_id WHERE b.created_at > ? GROUP BY u.id HAVING n >= 20 ORDER BY n DESC', Date.now() - 3600e3),
      ip_log: all('SELECT l.*, u.name FROM ip_log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200'),
    });
  });
  r.get('/outbox', A('settings'), (req, res) => res.json({ items: all('SELECT * FROM outbox ORDER BY id DESC LIMIT 200') }));

  // ---------- Exports CSV ----------
  r.get('/export/:type', A('exports'), (req, res) => {
    const from = ts(req.query.from) || 0, to = ts(req.query.to) || Date.now() + 864e5;
    let rows;
    switch (req.params.type) {
      case 'ventes': rows = all(`SELECT l.id, l.lot_number, l.title_fr titre, c.name_fr categorie, l.status statut, l.start_price mise_a_prix, l.reserve_price reserve, l.final_price prix_adjuge, l.bids_count encheres, u.name acheteur, u.phone telephone, l.ends_at cloture
        FROM lots l LEFT JOIN categories c ON c.id=l.category_id LEFT JOIN users u ON u.id=l.winner_id WHERE l.status IN ('sold','unsold') AND l.ends_at BETWEEN ? AND ? ORDER BY l.ends_at DESC`, from, to).map(x => ({ ...x, cloture: iso(x.cloture) })); break;
      case 'factures': rows = all(`SELECT i.number numero, i.created_at date, u.name client, u.phone telephone, l.title_fr lot, i.amount adjudication, i.buyer_fee frais_acheteur, i.delivery_fee livraison, i.total, i.status statut, i.payment_method paiement, i.payment_ref reference, z.name_fr zone, i.delivery_status livraison_statut
        FROM invoices i JOIN users u ON u.id=i.user_id JOIN lots l ON l.id=i.lot_id LEFT JOIN zones z ON z.id=i.zone_id WHERE i.created_at BETWEEN ? AND ? ORDER BY i.id DESC`, from, to).map(x => ({ ...x, date: iso(x.date) })); break;
      case 'encheres': rows = all(`SELECT b.id, b.created_at date, l.id lot, l.title_fr titre, u.name encherisseur, u.phone telephone, b.amount montant, b.is_auto auto, b.cancelled annulee, b.ip FROM bids b JOIN lots l ON l.id=b.lot_id JOIN users u ON u.id=b.user_id WHERE b.created_at BETWEEN ? AND ? ORDER BY b.id DESC`, from, to).map(x => ({ ...x, date: iso(x.date) })); break;
      case 'utilisateurs': rows = all('SELECT id, name nom, pseudo, phone telephone, email, role, verified verifie, is_seller vendeur, banned banni, city ville, created_at inscription FROM users ORDER BY id').map(x => ({ ...x, inscription: iso(x.inscription) })); break;
      case 'lots': rows = all('SELECT l.id, l.lot_number, l.title_fr titre, c.name_fr categorie, l.status statut, l.start_price, l.current_price, l.reserve_price, l.bids_count, l.starts_at debut, l.ends_at fin FROM lots l LEFT JOIN categories c ON c.id=l.category_id ORDER BY l.id').map(x => ({ ...x, debut: iso(x.debut), fin: iso(x.fin) })); break;
      case 'journal': rows = all('SELECT a.id, a.created_at date, u.name utilisateur, a.action, a.entity, a.entity_id, a.details, a.ip FROM activity_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.created_at BETWEEN ? AND ? ORDER BY a.id DESC', from, to).map(x => ({ ...x, date: iso(x.date) })); break;
      default: return res.status(404).json({ error: 'Export inconnu' });
    }
    log(req, 'export', req.params.type, null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows));
  });

  // Données pour l'impression PDF (facture / bordereau / rapport) côté admin
  r.get('/print/invoice/:id', A('invoices'), (req, res) => {
    const inv = get('SELECT i.*, u.name, u.phone, u.email, l.title_fr, l.lot_number, z.name_fr zone FROM invoices i JOIN users u ON u.id=i.user_id JOIN lots l ON l.id=i.lot_id LEFT JOIN zones z ON z.id=i.zone_id WHERE i.id=?', num(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
    res.json({ invoice: inv });
  });

  return r;
};
