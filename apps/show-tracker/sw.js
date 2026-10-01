/* Service worker: lets the app open and run with no signal.

   Network first, cache as the fallback. That is deliberate: this project has
   already lost days to "is the page stale?" (docs/START-HERE.md), so online
   you always get the live file, and the cache only answers when the network
   can't. Nothing here touches the studio API: its data lives in IndexedDB
   through the SDK, and API calls are never cached.

   Bump CACHE when the shell list changes. */
var CACHE = 'ast-shell-v1';
var SHELL = [
  './', 'index.html', 'browse.html', 'calendar.html', 'expenses.html', 'contacts.html', 'map.html', 'jury.html',
  'app.css', 'intel.css', 'calendar.css',
  'core.js', 'nav.js', 'version.js', 'fit.js', 'ranker.js', 'intel.js', 'members.js', 'weather.js', 'salestax.js',
  'intel-ui.js', 'catalogue.js', 'calendar.js', 'map.js', 'route.js', 'pipeline.js', 'import.js', 'import-ui.js',
  'share.js', 'share-ui.js', 'expenses.js', 'sales.js', 'plan.js', 'contacts.js', 'jury.js', 'store-supabase.js',
  'studio-sdk.js', 'studio-config.js', 'store-studio.js', 'studio-ui.js', 'pwa.js',
  'fit-data.json', 'catalogue.json', 'version.json', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'
];
/* Third-party files the pages need to draw the map and set the type. */
var CDN = /^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (cache) {
    /* One missing file must not stop the rest from being cached. */
    return Promise.all(SHELL.map(function (u) { return cache.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN.test(req.url)) return;
  if (sameOrigin && url.pathname.indexOf('/v1/') === 0) return; /* never cache the API */

  e.respondWith(fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    });
  }));
});
