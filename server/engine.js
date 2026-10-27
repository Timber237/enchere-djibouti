// Moteur d'enchères : paliers, enchère automatique (proxy), anti-sniping, achat immédiat,
// ouverture / clôture automatique des lots, factures, notifications temps réel.
const dbm = require('./db');
const { get, all, run, tx, setting, settingNum } = dbm;

let io = null;
const setIO = (s) => { io = s; };
const emit = (room, ev, data) => io && io.to(room).emit(ev, data);

// Palier : celui du lot s'il est défini, sinon palier par défaut admin, sinon barème progressif FDJ.
function incrementFor(price, lotIncrement) {
  if (lotIncrement > 0) return lotIncrement;
  const def = settingNum('default_increment', 0);
  if (def > 0) return def;
  if (price < 20000) return 500;
  if (price < 100000) return 2000;
  if (price < 500000) return 5000;
  if (price < 2000000) return 20000;
  if (price < 10000000) return 50000;
  return 100000;
}
const minNextBid = (lot) => lot.bids_count > 0 ? lot.current_price + incrementFor(lot.current_price, lot.increment) : lot.start_price;

// Pseudonyme stable par (lot, utilisateur) : l'historique ne révèle aucune identité.
const bidderCode = (userId, lotId) => 'E-' + String(((userId * 7919 + lotId * 104729) % 9000) + 1000);

function parseJSON(s, d) { try { return JSON.parse(s); } catch { return d; } }

function publicLot(l, viewer) {
  if (!l) return null;
  const out = {
    id: l.id, lot_number: l.lot_number, sale_id: l.sale_id, category_id: l.category_id, subcategory_id: l.subcategory_id, seller_id: l.seller_id,
    title_fr: l.title_fr, title_ar: l.title_ar || l.title_fr, description_fr: l.description_fr, description_ar: l.description_ar || l.description_fr,
    condition: l.condition, location: l.location, images: parseJSON(l.images, []), attrs: parseJSON(l.attrs, {}), expiry_date: l.expiry_date,
    start_price: l.start_price, current_price: l.current_price, bids_count: l.bids_count, increment: incrementFor(l.current_price, l.increment),
    min_next: minNextBid(l), buy_now_price: l.buy_now_price || 0, has_reserve: l.reserve_price > 0,
    reserve_met: l.reserve_price > 0 ? (l.bids_count > 0 && l.current_price >= l.reserve_price) : true,
    starts_at: l.starts_at, ends_at: l.ends_at, status: l.status, featured: !!l.featured, favorite: !!l.favorite, views: l.views,
    final_price: l.final_price, leader_code: l.leader_id ? bidderCode(l.leader_id, l.id) : null,
  };
  if (viewer) {
    out.my_code = bidderCode(viewer.id, l.id);
    out.is_leader = l.leader_id === viewer.id;
    out.is_winner = l.winner_id === viewer.id;
  }
  return out;
}

function lotWithMeta(id) {
  return get(`SELECT l.*, c.slug cat_slug FROM lots l LEFT JOIN categories c ON c.id = l.category_id WHERE l.id = ?`, id);
}

function broadcastLot(lotId, extra = {}) {
  const l = lotWithMeta(lotId);
  if (!l) return;
  const data = { ...publicLot(l), ...extra };
  emit(`lot:${lotId}`, 'lot:update', data);
  emit('catalog', 'lot:update', data);
  emit('admin', 'lot:update', data);
}

// ---- Notifications : in-app + temps réel + file d'envoi email / WhatsApp ----
function notify(userId, type, message, link) {
  run('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?,?,?,?,?)', userId, type, message, link || null, Date.now());
  emit(`user:${userId}`, 'notify', { type, message, link });
  const u = get('SELECT email, phone FROM users WHERE id = ?', userId);
  if (!u) return;
  if (u.email) run('INSERT INTO outbox (channel, recipient, subject, body, created_at) VALUES (?,?,?,?,?)', 'email', u.email, type, message, Date.now());
  if (u.phone && ['outbid', 'won', 'ending'].includes(type)) queueWhatsApp(u.phone, message);
}

// WhatsApp Cloud API si un jeton est configuré dans l'admin ; sinon le message reste en file (outbox).
function queueWhatsApp(phone, body) {
  const r = run('INSERT INTO outbox (channel, recipient, body, created_at) VALUES (?,?,?,?)', 'whatsapp', phone, body, Date.now());
  const token = setting('whatsapp_api_token'), phoneId = setting('whatsapp_phone_id');
  if (!token || !phoneId) return;
  fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.replace('+', ''), type: 'text', text: { body } }),
  }).then(res => run('UPDATE outbox SET status=?, error=? WHERE id=?', res.ok ? 'sent' : 'failed', res.ok ? null : 'HTTP ' + res.status, r.lastInsertRowid))
    .catch(e => run('UPDATE outbox SET status=?, error=? WHERE id=?', 'failed', String(e.message), r.lastInsertRowid));
}

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FDJ';

class BidError extends Error { constructor(msg, code) { super(msg); this.code = code || 400; } }

// Enchère : `amount` = enchère ferme, `maxAmount` (optionnel) = plafond d'enchère automatique.
function placeBid({ user, lotId, amount, maxAmount, ip }) {
  amount = Math.floor(Number(amount));
  maxAmount = maxAmount ? Math.floor(Number(maxAmount)) : 0;
  if (!Number.isFinite(amount) || amount <= 0) throw new BidError('Montant invalide');
  if (user.banned) throw new BidError('Compte suspendu', 403);

  const result = tx(() => {
    const lot = get('SELECT * FROM lots WHERE id = ?', lotId);
    const now = Date.now();
    if (!lot) throw new BidError('Lot introuvable', 404);
    if (lot.status !== 'live' || now < lot.starts_at || now >= lot.ends_at) throw new BidError('Ce lot n\'est pas ouvert aux enchères');
    if (lot.seller_id === user.id) throw new BidError('Vous ne pouvez pas enchérir sur votre propre lot');

    const ceiling = Math.max(amount, maxAmount);
    if (!user.verified) {
      const limit = settingNum('unverified_bid_limit', 0);
      if (limit > 0 && ceiling > limit) throw new BidError(`Compte non vérifié : enchère limitée à ${fmt(limit)}. Faites vérifier votre compte pour lever la limite.`, 403);
    }
    if (setting('deposit_enabled') === '1' && user.deposit < settingNum('deposit_amount', 0)) throw new BidError('Un dépôt de garantie est requis pour enchérir. Contactez le support.', 403);

    const inc = incrementFor(lot.current_price, lot.increment);
    const prevLeader = lot.leader_id;
    const existing = get('SELECT max_amount FROM proxy_bids WHERE lot_id=? AND user_id=?', lotId, user.id);

    if (prevLeader === user.id) {
      // Le meneur relève simplement son plafond automatique.
      if (ceiling <= lot.current_price) throw new BidError('Vous êtes déjà le meilleur enchérisseur');
      run('INSERT INTO proxy_bids (lot_id, user_id, max_amount, created_at) VALUES (?,?,?,?) ON CONFLICT(lot_id, user_id) DO UPDATE SET max_amount = MAX(max_amount, excluded.max_amount)', lotId, user.id, ceiling, now);
      return { lot, raisedMax: true, newBids: [] };
    }

    const min = minNextBid(lot);
    if (amount < min) throw new BidError(`L'enchère minimum est de ${fmt(min)}`);

    run('INSERT INTO proxy_bids (lot_id, user_id, max_amount, created_at) VALUES (?,?,?,?) ON CONFLICT(lot_id, user_id) DO UPDATE SET max_amount = MAX(max_amount, excluded.max_amount), created_at = CASE WHEN excluded.max_amount > max_amount THEN excluded.created_at ELSE created_at END', lotId, user.id, ceiling, now);
    void existing;

    // Plafond le plus haut parmi les autres enchérisseurs (égalité : le plus ancien gagne)
    const rival = get('SELECT user_id, max_amount, created_at FROM proxy_bids WHERE lot_id=? AND user_id<>? ORDER BY max_amount DESC, created_at ASC LIMIT 1', lotId, user.id);
    const newBids = [];
    let price, leader;
    if (rival && rival.max_amount >= amount && rival.max_amount > lot.current_price) {
      if (rival.max_amount >= ceiling) {
        // L'enchérisseur est battu par l'enchère automatique d'un rival.
        newBids.push([user.id, ceiling, maxAmount ? 1 : 0]);
        price = Math.min(rival.max_amount, ceiling + incrementFor(ceiling, lot.increment));
        leader = rival.user_id;
        newBids.push([rival.user_id, price, 1]);
      } else {
        // Le rival enchérit automatiquement jusqu'à son plafond, puis notre enchérisseur passe devant.
        if (rival.max_amount > lot.current_price) newBids.push([rival.user_id, rival.max_amount, 1]);
        price = Math.min(ceiling, Math.max(amount, rival.max_amount + incrementFor(rival.max_amount, lot.increment)));
        leader = user.id;
        newBids.push([user.id, price, price > amount ? 1 : 0]);
      }
    } else {
      price = amount; leader = user.id;
      newBids.push([user.id, price, 0]);
    }

    for (const [uid, amt, auto] of newBids) run('INSERT INTO bids (lot_id, user_id, amount, is_auto, ip, created_at) VALUES (?,?,?,?,?,?)', lotId, uid, amt, auto, ip || null, now);

    // Anti-sniping : une enchère dans la fenêtre finale prolonge la clôture.
    let endsAt = lot.ends_at, extended = false;
    const win = settingNum('anti_snipe_window', 60) * 1000, ext = settingNum('anti_snipe_extend', 60) * 1000;
    if (win > 0 && lot.ends_at - now <= win) { endsAt = Math.max(lot.ends_at, now + ext); extended = endsAt !== lot.ends_at; }

    run('UPDATE lots SET current_price=?, leader_id=?, bids_count=bids_count+?, ends_at=?, updated_at=? WHERE id=?', price, leader, newBids.length, endsAt, now, lotId);
    run('INSERT INTO ip_log (user_id, ip, action, created_at) VALUES (?,?,?,?)', user.id, ip || null, 'bid', now);
    if (lot.sale_id && extended) run('UPDATE sales SET ends_at = MAX(ends_at, ?) WHERE id = ?', endsAt, lot.sale_id);
    return { lot, price, leader, prevLeader, newBids, extended };
  });

  if (result.raisedMax) return { ok: true, raisedMax: true, leader: true };

  const { lot, price, leader, prevLeader, newBids, extended } = result;
  const title = lot.title_fr;
  for (const [uid, amt, auto] of newBids) emit(`lot:${lotId}`, 'lot:bid', { lot_id: lotId, bidder: bidderCode(uid, lotId), amount: amt, is_auto: !!auto, at: Date.now() });
  emit('catalog', 'lot:bid', { lot_id: lotId, amount: price, title_fr: title, title_ar: lot.title_ar });
  if (prevLeader && prevLeader !== leader) notify(prevLeader, 'outbid', `Vous avez été surenchéri sur « ${title} » : enchère actuelle ${fmt(price)}.`, `/lot/${lotId}`);
  if (leader !== user.id) notify(user.id, 'outbid', `Une enchère automatique vous dépasse sur « ${title} » (${fmt(price)}).`, `/lot/${lotId}`);
  broadcastLot(lotId, extended ? { extended: true } : {});

  // Achat immédiat atteint par une enchère : clôture directe
  if (lot.buy_now_price > 0 && price >= lot.buy_now_price) closeLot(lotId, { forceSold: true });
  return { ok: true, price, leader: leader === user.id, extended };
}

function buyNow({ user, lotId, ip }) {
  const lot = get('SELECT * FROM lots WHERE id = ?', lotId);
  if (!lot) throw new BidError('Lot introuvable', 404);
  if (!lot.buy_now_price) throw new BidError('Achat immédiat indisponible pour ce lot');
  if (lot.status !== 'live') throw new BidError('Ce lot n\'est pas ouvert');
  if (lot.seller_id === user.id) throw new BidError('Vous ne pouvez pas acheter votre propre lot');
  if (lot.current_price >= lot.buy_now_price && lot.bids_count > 0) throw new BidError('Les enchères ont dépassé le prix d\'achat immédiat');
  if (!user.verified && settingNum('unverified_bid_limit', 0) > 0 && lot.buy_now_price > settingNum('unverified_bid_limit', 0)) throw new BidError('Compte non vérifié : montant au-delà de votre limite', 403);
  const prev = lot.leader_id;
  tx(() => {
    run('INSERT INTO bids (lot_id, user_id, amount, is_auto, ip, created_at) VALUES (?,?,?,?,?,?)', lotId, user.id, lot.buy_now_price, 0, ip || null, Date.now());
    run('UPDATE lots SET current_price=?, leader_id=?, bids_count=bids_count+1, updated_at=? WHERE id=?', lot.buy_now_price, user.id, Date.now(), lotId);
  });
  if (prev && prev !== user.id) notify(prev, 'outbid', `« ${lot.title_fr} » a été acheté immédiatement.`, `/lot/${lotId}`);
  return closeLot(lotId, { forceSold: true });
}

function nextInvoiceNumber() {
  const y = new Date().getFullYear();
  const last = get('SELECT number FROM invoices WHERE number LIKE ? ORDER BY id DESC LIMIT 1', `F${y}-%`);
  const n = last ? Number(last.number.split('-')[1]) + 1 : 1;
  return `F${y}-${String(n).padStart(5, '0')}`;
}

function closeLot(lotId, { forceSold = false, byAdmin = null } = {}) {
  const res = tx(() => {
    const lot = get('SELECT * FROM lots WHERE id = ?', lotId);
    if (!lot || ['sold', 'unsold', 'withdrawn'].includes(lot.status)) return null;
    const reserveOk = lot.reserve_price <= 0 || lot.current_price >= lot.reserve_price || forceSold;
    const now = Date.now();
    if (lot.leader_id && lot.bids_count > 0 && reserveOk) {
      run('UPDATE lots SET status=?, winner_id=?, final_price=?, ends_at=MIN(ends_at, ?), updated_at=? WHERE id=?', 'sold', lot.leader_id, lot.current_price, now, now, lotId);
      const fee = Math.round(lot.current_price * settingNum('buyer_fee_pct', 0) / 100);
      run('INSERT INTO invoices (number, lot_id, user_id, amount, buyer_fee, total, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
        nextInvoiceNumber(), lotId, lot.leader_id, lot.current_price, fee, lot.current_price + fee, 'unpaid', now);
      return { lot, sold: true };
    }
    run('UPDATE lots SET status=?, ends_at=MIN(ends_at, ?), updated_at=? WHERE id=?', 'unsold', now, now, lotId);
    return { lot, sold: false };
  });
  if (!res) return null;
  const { lot, sold } = res;
  if (sold) {
    notify(lot.leader_id, 'won', `Félicitations ! Vous avez remporté « ${lot.title_fr} » pour ${fmt(lot.current_price)}. Réglez votre facture sous ${setting('payment_deadline_hours', 72)} h.`, '/compte/factures');
    const w = get('SELECT pseudo, city FROM users WHERE id = ?', lot.leader_id);
    emit('catalog', 'lot:sold', { lot_id: lotId, name: w ? w.pseudo : '', title_fr: lot.title_fr, title_ar: lot.title_ar, at: Date.now() });
    if (lot.seller_id) notify(lot.seller_id, 'sold', `Votre lot « ${lot.title_fr} » a été vendu ${fmt(lot.current_price)}.`, '/compte/lots');
  } else if (lot.seller_id) {
    notify(lot.seller_id, 'unsold', `Votre lot « ${lot.title_fr} » n'a pas trouvé preneur.`, '/compte/lots');
  }
  if (byAdmin) dbm.logActivity(byAdmin, 'lot.close', 'lot', lotId, { sold });
  broadcastLot(lotId);
  return { sold };
}

// Boucle du moteur : ouvre les lots programmés, clôture les lots échus, met à jour les ventes.
const remindedEnding = new Set();
function tick() {
  const now = Date.now();
  for (const l of all("SELECT id FROM lots WHERE status='upcoming' AND starts_at <= ?", now)) {
    run("UPDATE lots SET status='live', current_price=CASE WHEN bids_count=0 THEN start_price ELSE current_price END, updated_at=? WHERE id=?", now, l.id);
    broadcastLot(l.id);
  }
  for (const l of all("SELECT id FROM lots WHERE status='live' AND ends_at <= ?", now)) closeLot(l.id);
  // Rappel « se termine bientôt » (10 min) aux personnes qui suivent le lot
  for (const l of all("SELECT id, title_fr FROM lots WHERE status='live' AND ends_at BETWEEN ? AND ?", now, now + 10 * 60e3)) {
    if (remindedEnding.has(l.id)) continue;
    remindedEnding.add(l.id);
    for (const w of all('SELECT user_id FROM watches WHERE lot_id=?', l.id)) notify(w.user_id, 'ending', `« ${l.title_fr} » se termine dans moins de 10 minutes.`, `/lot/${l.id}`);
  }
  run("UPDATE sales SET status='live' WHERE status='upcoming' AND starts_at <= ?", now);
  run("UPDATE sales SET status='closed' WHERE status='live' AND ends_at <= ? AND NOT EXISTS (SELECT 1 FROM lots WHERE sale_id = sales.id AND status IN ('live','upcoming'))", now);
}

function start() {
  setInterval(() => { try { tick(); } catch (e) { console.error('[engine]', e); } }, 1000).unref();
}

module.exports = { setIO, emit, incrementFor, minNextBid, bidderCode, publicLot, placeBid, buyNow, closeLot, broadcastLot, notify, tick, start, BidError, parseJSON, fmt };
