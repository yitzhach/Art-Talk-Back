/* ==========================================================================
   Art Show Tracker — service worker (the installable, offline app shell)

   Network first, always. This project lost days to "is the site updated?",
   and the answer was a cached script every time — so a fresh copy wins
   whenever the network gives one. The cache is only the fallback for no
   connection (or one so slow it is as good as none), which is what makes the
   app open in a field with no signal.

   Never touched: anything that is not a GET, anything on another origin
   (fonts, map tiles, weather, Supabase), and /v1/ — the studio API, whose
   answers must never come from a cache. The sync layer has its own offline
   store for data; this file only keeps the pages and their files.

   Entries are stored without their ?v= token, so one copy per file is kept
   and an offline page finds whichever version it last saw.
   ========================================================================== */
'use strict';

var CACHE = 'ast-shell-v1';
var SLOW_MS = 5000;

/* Every file the pages need. build/pwa-tests.cjs fails if a file in tracker/
   is missing here, so a new page or script cannot be forgotten. */
var SHELL = [
  './', 'index.html', 'browse.html', 'calendar.html', 'contacts.html', 'embed.html',
  'expenses.html', 'jury.html', 'map.html',
  'app.css', 'calendar.css', 'intel.css',
  'calendar.js', 'catalogue.js', 'contacts.js', 'core.js', 'expenses.js', 'fit.js',
  'import-ui.js', 'import.js', 'intel-ui.js', 'intel.js', 'jury.js', 'map.js',
  'members.js', 'nav.js', 'pipeline.js', 'plan.js', 'pwa.js', 'ranker.js', 'route.js',
  'sales.js', 'salestax.js', 'share-ui.js', 'share.js', 'store-supabase.js', 'studio-sdk.js',
  'studio-store.js', 'studio-ui.js',
  'version.js', 'weather.js',
  'catalogue.json', 'fit-data.json', 'version.json',
  'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'apple-touch-icon.png'
];

function key(url) {
  var u = new URL(url);
  return u.origin + u.pathname;
}

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(SHELL.map(function (path) {
      var url = new URL(path, self.registration.scope).href;
      return fetch(url, { cache: 'no-cache' }).then(function (res) {
        if (res.ok && !res.redirected) return cache.put(key(url), res);
      }).catch(function () { /* one missing file must not cost the rest */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n !== CACHE; })
                            .map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/v1/') === 0) return;

  event.respondWith(caches.open(CACHE).then(function (cache) {
    var cached = cache.match(key(req.url));
    var network = fetch(req).then(function (res) {
      // A redirect is never stored: replayed for a page load, the browser refuses it.
      if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key(req.url), res.clone());
      return res;
    });
    return new Promise(function (resolve, reject) {
      var done = false;
      function fallback(err) {
        cached.then(function (hit) {
          if (done) return;
          if (hit) { done = true; resolve(hit); }
          else if (err) { done = true; reject(err); }
        });
      }
      var timer = setTimeout(function () { fallback(null); }, SLOW_MS);
      network.then(function (res) {
        clearTimeout(timer);
        if (!done) { done = true; resolve(res); }
      }, function (err) {
        clearTimeout(timer);
        // No copy and no network: the browser shows its own offline error.
        fallback(err);
      });
    });
  }));
});
