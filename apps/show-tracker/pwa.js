/* Registers the service worker, so the app opens with no signal. Skipped on
   file:// (the tracker still opens from a file, by design) and anywhere
   service workers don't exist. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('service worker did not register:', err); });
  });
})();
