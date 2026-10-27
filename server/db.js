// Accès base de données (SQLite intégré à Node >= 22.5) + migrations versionnées.
process.removeAllListeners('warning');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'enchere.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Chaque migration est appliquée une seule fois (table schema_migrations).
const MIGRATIONS = [
  ['001_init', `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pseudo TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_seller INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    seller_verified INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    deposit INTEGER NOT NULL DEFAULT 0,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    lang TEXT DEFAULT 'fr',
    city TEXT,
    last_ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    twofa_ok INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL,
    name_fr TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    icon TEXT,
    filters TEXT DEFAULT '[]',
    requires_expiry INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_fr TEXT NOT NULL,
    title_ar TEXT,
    description_fr TEXT,
    description_ar TEXT,
    cover TEXT,
    is_live INTEGER NOT NULL DEFAULT 0,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_number INTEGER,
    sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id),
    subcategory_id INTEGER REFERENCES categories(id),
    seller_id INTEGER REFERENCES users(id),
    title_fr TEXT NOT NULL,
    title_ar TEXT,
    description_fr TEXT,
    description_ar TEXT,
    condition TEXT,
    location TEXT,
    images TEXT NOT NULL DEFAULT '[]',
    attrs TEXT NOT NULL DEFAULT '{}',
    expiry_date TEXT,
    start_price INTEGER NOT NULL,
    reserve_price INTEGER NOT NULL DEFAULT 0,
    increment INTEGER NOT NULL DEFAULT 0,
    buy_now_price INTEGER NOT NULL DEFAULT 0,
    current_price INTEGER NOT NULL DEFAULT 0,
    bids_count INTEGER NOT NULL DEFAULT 0,
    leader_id INTEGER REFERENCES users(id),
    winner_id INTEGER REFERENCES users(id),
    final_price INTEGER,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    featured INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_lots_status ON lots(status, ends_at);
  CREATE INDEX idx_lots_cat ON lots(category_id, subcategory_id);
  CREATE TABLE bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    is_auto INTEGER NOT NULL DEFAULT 0,
    cancelled INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_bids_lot ON bids(lot_id, created_at);
  CREATE TABLE proxy_bids (
    lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    max_amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (lot_id, user_id)
  );
  CREATE TABLE watches (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, lot_id)
  );
  CREATE TABLE zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_fr TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    fee INTEGER NOT NULL DEFAULT 0,
    delay_fr TEXT,
    is_pickup INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE payment_methods (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    instructions_fr TEXT,
    instructions_ar TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE NOT NULL,
    lot_id INTEGER NOT NULL REFERENCES lots(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    buyer_fee INTEGER NOT NULL DEFAULT 0,
    delivery_fee INTEGER NOT NULL DEFAULT 0,
    zone_id INTEGER REFERENCES zones(id),
    address TEXT,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    payment_method TEXT,
    payment_ref TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'waiting',
    tracking TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    featured INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE toast_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text_fr TEXT NOT NULL,
    text_ar TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    logo TEXT,
    url TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'hero',
    title_fr TEXT,
    title_ar TEXT,
    subtitle_fr TEXT,
    subtitle_ar TEXT,
    image TEXT,
    link TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE texts (
    key TEXT PRIMARY KEY,
    fr TEXT NOT NULL DEFAULT '',
    ar TEXT NOT NULL DEFAULT '',
    long INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    details TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE ip_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    ip TEXT,
    action TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_iplog_ip ON ip_log(ip);
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    recipient TEXT,
    subject TEXT,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at INTEGER NOT NULL
  );
  `],
  // Image d'illustration par catégorie (grille « Parcourir les catégories »)
  ['002_category_image', 'ALTER TABLE categories ADD COLUMN image TEXT;'],
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, Date.now());
      db.exec('COMMIT');
      console.log(`[db] migration ${name} appliquée`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

let settingsCache = null;
function settings() {
  if (!settingsCache) {
    settingsCache = {};
    for (const r of all('SELECT key, value FROM settings')) settingsCache[r.key] = r.value;
  }
  return settingsCache;
}
function setting(key, def) {
  const v = settings()[key];
  return v === undefined || v === null ? def : v;
}
const settingNum = (key, def) => Number(setting(key, def));
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value));
  settingsCache = null;
}

function logActivity(userId, action, entity, entityId, details, ip) {
  run('INSERT INTO activity_log (user_id, action, entity, entity_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?)',
    userId || null, action, entity || null, entityId || null,
    details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)), ip || null, Date.now());
}

module.exports = { db, migrate, tx, all, get, run, settings, setting, settingNum, setSetting, logActivity, DATA_DIR };
