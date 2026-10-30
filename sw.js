// PCB Viewer – Service Worker: speichert nur den Programmcode (offline nutzbar). Geöffnete Dateien bleiben im Browser.
const CACHE = 'beak-pcb-viewer-6.2';   // bei jedem Release hochzählen
const DATEIEN = ['./', './index.html', './app.css', './app.js', './altium.js', './drei.js', './OrbitControls.js', './three.module.min.js', './occt-import-js.js', './occt-import-js.wasm', './theme.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './icon-120.png', './icon-152.png', './icon-167.png', './apple-touch-icon.png', './icon-maskable-192.png', './icon-maskable-512.png', './favicon.ico', './favicon.svg', './favicon-16.png', './favicon-32.png', './favicon-48.png', './safari-pinned-tab.svg', './browserconfig.xml', './mstile-70x70.png', './mstile-150x150.png', './mstile-310x310.png', './mstile-310x150.png',
  './logo-pcb-viewer.svg', './logo-pcb-viewer-hell.svg', './beispiel/BNC Adapter.PrjPcb', './beispiel/BNC Adapter.SchDoc', './beispiel/BNC Adapter.PcbDoc', './beispiel/BNC Adapter (Nutzen).PcbDoc'];
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await Promise.all(DATEIEN.map(async u => { try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r); } catch (_) {} }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin || /\/sw\.js$/i.test(u.pathname)) return;
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; })
    .catch(async () => (await caches.match(r, { ignoreSearch: true })) || (r.mode === 'navigate' && await caches.match('./index.html')) || new Response('', { status: 503, statusText: 'Offline' })));
});
