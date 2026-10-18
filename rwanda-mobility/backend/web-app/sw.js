// Abasare web app service worker: makes the app open fast and survive a short loss of signal.
// Pages and the app shell are fetched from the network first (so a new release shows up at once) and kept for offline use.
// Hashed files under /_expo/ and /assets/ never change, so they are served from the cache. The API, the console, share pages and the map are never touched.
const VERSION = '20261018222239';
const SHELL = 'abasare-shell-' + VERSION, FILES = 'abasare-files';
const KEEP = [SHELL, FILES];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png']).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== self.location.origin) return;
  const p = u.pathname;
  if (p === '/' || p === '/manifest.webmanifest') {
    e.respondWith(fetch(r).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(r, copy)); return res; }).catch(() => caches.match(r).then((m) => m || caches.match('/'))));
  } else if (p.startsWith('/_expo/') || p.startsWith('/assets/') || /^\/(icon-|apple-touch)/.test(p)) {
    e.respondWith(caches.open(FILES).then((c) => c.match(r).then((m) => m || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }))));
  }
});
