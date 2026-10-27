// Authentification : mots de passe (scrypt), sessions en base, 2FA TOTP, rôles, CSRF, rate-limit.
const crypto = require('crypto');

const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// Téléphone djiboutien : +253 suivi de 8 chiffres commençant par 77 (mobile) ou 21/27 (fixe)
function normalizePhone(input) {
  let p = String(input || '').replace(/[\s.\-()]/g, '');
  if (p.startsWith('00253')) p = '+' + p.slice(2);
  if (/^253\d{8}$/.test(p)) p = '+' + p;
  if (/^\d{8}$/.test(p)) p = '+253' + p;
  return /^\+253(77|21|27)\d{6}$/.test(p) ? p : null;
}

// ---- TOTP (RFC 6238) sans dépendance ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, t = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
function verifyTotp(secret, code) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some(w => totp(secret, Date.now() + w * 30000) === code);
}
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

// ---- Rôles & permissions du back-office ----
const ADMIN_ROLES = ['superadmin', 'admin', 'moderator', 'auctioneer'];
const PERMS = {
  superadmin: ['*'],
  admin: ['dashboard', 'lots', 'sales', 'moderation', 'users', 'bids', 'invoices', 'catalog', 'payments', 'delivery', 'identity', 'content', 'reviews', 'settings', 'logs', 'exports', 'fraud'],
  moderator: ['dashboard', 'moderation', 'users', 'bids', 'reviews', 'fraud', 'lots'],
  auctioneer: ['dashboard', 'lots', 'sales', 'bids', 'invoices', 'moderation'],
};
const can = (user, perm) => !!user && (PERMS[user.role] || []).some(p => p === '*' || p === perm);

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(dbm) {
  const { get, run } = dbm;

  function createSession(res, userId, twofaOk = 1) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    run('INSERT INTO sessions (token, user_id, twofa_ok, created_at, expires_at) VALUES (?,?,?,?,?)', token, userId, twofaOk ? 1 : 0, now, now + SESSION_DAYS * 864e5);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: SESSION_DAYS * 864e5, path: '/' });
    return token;
  }
  function destroySession(req, res) {
    const sid = parseCookies(req).sid;
    if (sid) run('DELETE FROM sessions WHERE token = ?', sid);
    res.clearCookie('sid', { path: '/' });
  }

  // Charge req.user (null si anonyme) et pose le jeton CSRF (double-submit cookie).
  function middleware(req, res, next) {
    const cookies = parseCookies(req);
    req.user = null;
    if (cookies.sid) {
      const s = get('SELECT * FROM sessions WHERE token = ? AND expires_at > ?', cookies.sid, Date.now());
      if (s) {
        const u = get('SELECT * FROM users WHERE id = ?', s.user_id);
        // Session en attente du code 2FA : l'utilisateur n'est pas encore considéré connecté
        if (u && !u.banned) {
          if (s.twofa_ok) { req.user = u; req.session = s; } else { req.pendingUser = u; req.pendingSession = s; }
        }
      }
    }
    let csrf = cookies.csrf;
    if (!csrf) {
      csrf = crypto.randomBytes(16).toString('hex');
      res.cookie('csrf', csrf, { sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', path: '/' });
    }
    req.csrfToken = csrf;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path.startsWith('/api/') && !req.path.startsWith('/api/payments/webhook')) {
      if (!req.headers['x-csrf-token'] || req.headers['x-csrf-token'] !== cookies.csrf) {
        return res.status(403).json({ error: 'Jeton CSRF invalide. Rechargez la page.' });
      }
    }
    next();
  }

  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Connexion requise' });
  const requireAdmin = (perm) => (req, res, next) => {
    if (!req.user || !ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Accès réservé' });
    if (!req.session.twofa_ok) return res.status(403).json({ error: '2FA requise', need2fa: true });
    if (dbm.setting('admin_2fa_required') === '1' && !req.user.totp_enabled && req.path !== '/me' && !req.path.startsWith('/2fa'))
      return res.status(403).json({ error: 'Activez la double authentification pour accéder au back-office', setup2fa: true });
    if (perm && !can(req.user, perm)) return res.status(403).json({ error: 'Permission insuffisante pour ce rôle' });
    next();
  };

  return { createSession, destroySession, middleware, requireUser, requireAdmin };
}

// Rate-limit en mémoire (fenêtre glissante simple)
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return arr.length <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some(t => now - t < 600e3)) buckets.delete(k); }, 600e3).unref();

module.exports = { hashPassword, verifyPassword, normalizePhone, totp, verifyTotp, newTotpSecret, ADMIN_ROLES, PERMS, can, createAuth, rateLimit, parseCookies };
