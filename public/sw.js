// Service worker : application installable + consultation hors ligne des lots déjà vus.
// - Fichiers de l'interface : cache d'abord (mis à jour en arrière-plan)
// - API de consultation (accueil, lots, ventes) : réseau d'abord, cache en secours hors ligne
// - Images : cache d'abord (économie de données sur réseau lent)
const VERSION = 'v6';
const SHELL = `shell-${VERSION}`, DATA = `data-${VERSION}`, IMG = `img-${VERSION}`;
const SHELL_FILES = ['/', '/css/app.css?v=6', '/js/app.js?v=6', '/js/icons.js', '/img/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/admin')) return;

  if (url.pathname.startsWith('/api/')) {
    if (!/^\/api\/(home|lots|sales|live|bootstrap|toasts)/.test(url.pathname)) return;
    ev.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(req, copy)).then(() => trimCache(DATA, 120)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || new Response(JSON.stringify({ error: 'Hors ligne' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }

  if (req.destination === 'image' || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/ph/')) {
    ev.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(IMG).then(c => c.put(req, copy)).then(() => trimCache(IMG, 300)); }
      return res;
    }).catch(() => new Response('', { status: 504 }))));
    return;
  }

  // Navigation SPA : renvoie la coquille (réseau d'abord)
  if (req.mode === 'navigate') {
    ev.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/', copy)); return res; }).catch(() => caches.match('/')));
    return;
  }

  ev.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = (ev.notification.data && ev.notification.data.url) || '/';
  ev.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
