// Console shell cache: the page opens (and says "you are offline") even without data. API calls are never cached: staff must always see live numbers.
const V = 'ops-v1', SHELL = ['./', 'style.css', 'core.js', 'app.js', 'i18n.js', 'live.js', 'logo.png', 'brand-mark.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then((m) => m || new Response('You are offline. The console needs a connection for live data.', { status: 503, headers: { 'content-type': 'text/plain' } }))));
});
