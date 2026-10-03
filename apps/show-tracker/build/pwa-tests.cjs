/* ==========================================================================
   The installable app shell: manifest, icons, service worker, offline.

   What is worth proving: every page links the manifest and registers the
   worker; the worker caches every file the pages use (a forgotten file is a
   page that breaks in a field with no signal); a page opened once opens again
   with the network gone; a fresh copy wins whenever the network is up; and
   file:// behaves exactly as it did before — no worker, no error.

   Usage:
     python3 -m http.server 8765     # from apps/show-tracker
     node build/pwa-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ORIGIN = 'http://127.0.0.1:8765';
const BASE = ORIGIN + '/tracker/';
const DIR = path.join(__dirname, '..', 'tracker');
const PAGES = ['index.html', 'browse.html', 'calendar.html', 'contacts.html',
               'expenses.html', 'jury.html', 'map.html'];

const fails = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  /* ---- static: the manifest and the shell list ------------------------- */
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.webmanifest'), 'utf8'));
  check('the manifest names the app and opens standalone',
        !!manifest.name && !!manifest.short_name && manifest.display === 'standalone');
  check('the start page exists', fs.existsSync(path.join(DIR, manifest.start_url)));
  const sizes = manifest.icons.map(i => i.sizes);
  check('it has the 192 and 512 icons installing needs',
        sizes.includes('192x192') && sizes.includes('512x512'));
  check('every icon it lists exists',
        manifest.icons.every(i => fs.existsSync(path.join(DIR, i.src))));

  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/var SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const files = fs.readdirSync(DIR).filter(f => f !== 'sw.js' && !f.startsWith('.'));
  const missing = files.filter(f => !shell.includes(f));
  check('the worker caches every file in tracker/', !missing.length, missing.join(', '));
  check('every file it caches exists',
        shell.filter(f => f !== './').every(f => fs.existsSync(path.join(DIR, f))));
  check('it never answers for the studio API or another origin',
        /pathname\.indexOf\('\/v1\/'\) === 0\) return/.test(sw) &&
        /url\.origin !== self\.location\.origin\) return/.test(sw));

  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(DIR, p), 'utf8');
    check(p + ' links the manifest and loads pwa.js',
          html.includes('rel="manifest"') && /<script src="pwa\.js/.test(html));
  }

  /* ---- live: register, go offline, reopen ------------------------------- */
  const launch = fs.existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {};
  const browser = await chromium.launch(launch);
  /* A real profile, not an incognito context: Chrome never offers to install
     from incognito, so the installability check needs one. */
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ast-pwa-'));
  const ctx = await chromium.launchPersistentContext(profile, launch);
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  let phase = 'online';
  const IGNORE = /fonts\.googleapis|fonts\.gstatic|open-meteo|tile\.openstreetmap|cdnjs/;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(phase + ': ' + m.text());
  });

  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  const ready = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  check('the service worker registers and activates', ready);
  // Wait until the install has filled the cache.
  const cached = await page.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const c = await caches.open('ast-shell-v1');
      const keys = await c.keys();
      if (keys.length >= 40) return keys.map(r => new URL(r.url).pathname);
      await new Promise(r => setTimeout(r, 100));
    }
    return [];
  });
  check('installing caches the app shell', cached.includes('/tracker/core.js') &&
        cached.includes('/tracker/calendar.html'), cached.length + ' entries');
  check('cached copies drop the ?v= token', cached.every(p => !p.includes('?')));

  // Chrome's own verdict on whether the page can be installed.
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome reports the app as installable', !installabilityErrors.length,
        installabilityErrors.map(e => e.errorId).join(', '));

  // Reload so this page is controlled, then cut the network.
  await page.reload({ waitUntil: 'load' });
  check('the page is controlled by the worker',
        await page.evaluate(() => !!navigator.serviceWorker.controller));

  await ctx.setOffline(true);
  phase = 'offline';
  for (const p of ['index.html', 'calendar.html', 'expenses.html']) {
    let ok = false, detail = '';
    try {
      await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
      ok = await page.evaluate(() => !!window.AST && document.querySelector('.header-actions') !== null);
    } catch (e) { detail = e.message.split('\n')[0]; }
    check('offline, ' + p + ' still opens with its scripts', ok, detail);
  }
  await ctx.setOffline(false);
  phase = 'back online';

  // A fresh copy wins when the network is up: the worker refreshes its entry.
  const fresh = await page.evaluate(async () => {
    const c = await caches.open('ast-shell-v1');
    await c.put(location.origin + '/tracker/version.json', new Response('{"stale":true}'));
    const r = await fetch('version.json');
    const body = await r.json();
    // The worker writes its cache after answering, so give it a moment.
    let refreshed = false;
    for (let i = 0; i < 30 && !refreshed; i++) {
      refreshed = !(await (await c.match(location.origin + '/tracker/version.json')).json()).stale;
      if (!refreshed) await new Promise(r => setTimeout(r, 100));
    }
    return { live: !body.stale, refreshed };
  });
  check('online, the network copy wins over the cache', fresh.live);
  check('and the cache is refreshed from it', fresh.refreshed);

  /* With the network cut, Chrome itself re-fetches the manifest icon for its
     install UI. That fetch is the browser's, not the page's, so it fails
     offline and logs; it says nothing about the app. Only that one message,
     and only while offline, is set aside. */
  const real = errors.filter(e => !IGNORE.test(e) &&
    !/^offline: Error while trying to use the following icon from the Manifest/.test(e));
  check('no page errors while installing and offline', !real.length, real.join(' | '));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });

  /* ---- file:// is unchanged --------------------------------------------- */
  const fctx = await browser.newContext();
  const fpage = await fctx.newPage();
  const ferrors = [];
  fpage.on('pageerror', e => ferrors.push(e.message));
  fpage.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') ferrors.push(m.text()); });
  await fpage.goto('file://' + path.join(DIR, 'index.html'), { waitUntil: 'load' });
  await fpage.waitForTimeout(300);
  const fstate = await fpage.evaluate(() => ({
    ast: !!window.AST,
    sw: 'serviceWorker' in navigator ? 'present' : 'absent'
  }));
  const swNoise = ferrors.filter(e => /service ?worker|Offline support/i.test(e));
  check('from file://, the app still loads', fstate.ast);
  check('and pwa.js stays silent there (no worker, no warning)', !swNoise.length, swNoise.join(' | '));
  await fctx.close();
  await browser.close();

  console.log('\n' + passed + '/' + (passed + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
