// Service worker: guarda o "casco" do site para abrir sem internet.
// Os lançamentos offline ficam na fila do aparelho (ver app.js) e sobem quando o sinal volta.
const CACHE = 'shell-v3';
const SHELL = ['/', '/style.css', '/app.js', '/desempenho.js', '/vendor/chart.umd.js', '/brand/dairyup-vaca.png', '/brand/dairyup-vertical.png', '/brand/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // rede primeiro (sempre a versão nova quando há sinal); cai para o cache sem internet
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req).then((r) => r || caches.match('/'))));
});
