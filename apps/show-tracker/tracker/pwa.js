/* ==========================================================================
   Art Show Tracker — installable app shell (PWA)

   Registers sw.js so the pages open with no connection once they have been
   opened online. Only over http(s): a service worker cannot exist on file://,
   and the app opening by double-click must keep working exactly as before, so
   there this file does nothing at all. Publishes nothing.
   ========================================================================== */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      // Offline support is a convenience; failing to get it never breaks a page.
      console.warn('Offline support unavailable: ' + (err && err.message));
    });
  });
})();
