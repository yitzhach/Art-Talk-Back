/* ==========================================================================
   Phase 2 gate, in a real browser: two devices, one studio, the network cut.

   Runs the real app Worker and the real studio-api together under
   `wrangler dev` (one origin, D-039) against a fresh local D1, and drives two
   browser contexts — two "devices" with their own storage — through the real
   pages. Covers the phase-2 gate items 1–3:

     import   "Import my existing data" moves a schema-v11 localStorage season
              into the studio once; running it again adds nothing; everything
              that is not a show or a sale stays on the device, contacts above all.
     gate 1   offline, log a sale at a show on the Money page; reconnect; the
              other device shows it, and the sale, the show and the activity
              log agree.
     gate 2   same field on two offline devices -> the studio keeps its value
              and the second device gets a review card (and can put its own
              back); different fields merge; money never auto-merges.
     also     an edit made while a pull is on its way survives it; Undo after
              a delete works; the ledger reopens with no network.

   Usage: node e2e/two-devices.cjs        (from apps/show-tracker; needs nothing running)
   ========================================================================== */
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXECUTABLE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.join(__dirname, '..', '..', '..');
const PORT = Number(process.env.E2E_PORT || 8791);
const ORIGIN = 'http://127.0.0.1:' + PORT;
const EMAIL = 'owner@example.com';   // OWNER_EMAILS in studio-api's dev config
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'artShowTracker.db.v11.json'), 'utf8');
const SEASON = JSON.parse(FIXTURE);
const WINTER_PARK = SEASON.shows[0];

const fails = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

/* ---- the server: app Worker + studio-api, fresh D1 ------------------------ */
let log = '';
function startServer() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-e2e-'));
  const wrangler = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  const mig = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state,
    '-c', 'workers/studio-api/wrangler.jsonc'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' } });
  if (mig.status !== 0) throw new Error('migrations failed: ' + mig.stdout + mig.stderr);
  const proc = spawn(wrangler, ['dev', '-c', 'apps/show-tracker/wrangler.jsonc', '-c', 'workers/studio-api/wrangler.jsonc',
    '--persist-to', state, '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: ROOT, env: { ...process.env, CI: '1' } });
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  return { proc, state };
}
async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(ORIGIN + '/v1/openapi.json')).ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not come up:\n' + log.slice(-3000));
}
async function codeFor(email, after) {
  const re = new RegExp('sign-in code for ' + email.replace(/[.@+]/g, '\\$&') + ': (\\d{6})', 'g');
  for (let i = 0; i < 40; i++) {
    const all = [...log.slice(after).matchAll(re)];
    if (all.length) return all[all.length - 1][1];
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('no sign-in code in the dev log');
}

/* ---- devices ---------------------------------------------------------------- */
const IGNORE = /fonts\.googleapis|fonts\.gstatic|open-meteo|tile\.openstreetmap|cdnjs|Failed to load resource|ERR_INTERNET_DISCONNECTED/;
async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(name + ': ' + m.text()); });
  return { name, ctx, page, errors };
}
async function signIn(d) {
  const p = d.page;
  await p.goto(ORIGIN + '/index.html', { waitUntil: 'load' });
  await p.click('#syncPill');
  await p.fill('#st_email', EMAIL);
  const mark = log.length;
  await p.click('#btnStudioCode');
  await p.waitForSelector('#st_codeRow:not([hidden])');
  await p.fill('#st_code', await codeFor(EMAIL, mark));
  await p.click('#btnStudioVerify');
  await p.waitForSelector('#st_signedIn:not([hidden])');
}
const sync = d => d.page.evaluate(() => ASTStudio.sync());
const api = (d, url) => d.page.evaluate(u => fetch(u).then(r => r.json()), url);
const ledgerNames = d => d.page.evaluate(() => AST.Store.list().then(l => l.map(s => s.name).sort()));
async function controlled(d) {
  await d.page.evaluate(() => navigator.serviceWorker.ready);
  await d.page.reload({ waitUntil: 'load' });
  await d.page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

(async () => {
  const { proc, state } = startServer();
  let browser;
  try {
    await waitUp();
    browser = await chromium.launch(fs.existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
    const one = await device(browser, 'device 1');
    const two = await device(browser, 'device 2');

    /* ==== IMPORT (gate 3) ================================================ */
    console.log('\n-- import my existing data');
    await one.page.goto(ORIGIN + '/index.html', { waitUntil: 'load' });
    await one.page.evaluate(db => localStorage.setItem('artShowTracker.db', db), FIXTURE);
    await signIn(one);
    const before = await one.page.evaluate(() => localStorage.getItem('artShowTracker.db'));
    check('signed in, the ledger is empty until the import: the local season is not silently pushed',
          (await ledgerNames(one)).length === 0);
    const offer = await one.page.textContent('#st_importText');
    check('the panel says what it found: 5 shows and 5 sales (deleted rows are not offered)',
          /5 shows and 5 sales/.test(offer), offer);
    await one.page.click('#btnStudioImport');
    await one.page.waitForFunction(() => /Import finished/.test(document.querySelector('#st_importResult').textContent));
    const result1 = await one.page.textContent('#st_importResult');
    check('the import reports what the server answered', /10 added, 0 already in the studio/.test(result1), result1);

    const shows = (await api(one, '/v1/shows?limit=100')).items;
    const sales = (await api(one, '/v1/sales?limit=100')).items;
    const live = SEASON.shows.filter(s => !s.deletedAt).map(s => s.name).sort();
    check('every live show is in the studio, and only those', JSON.stringify(shows.map(s => s.name).sort()) === JSON.stringify(live));
    check('every live sale is in the studio', sales.length === 5);
    const wp = shows.find(s => s.meta.trackerId === WINTER_PARK.id);
    check('the show keeps its facts: fee in cents, status, the tracker id', !!wp && wp.feeCents === 65000 &&
          wp.status === 'accepted' && wp.meta.grossSalesCents === 842050, JSON.stringify(wp && [wp.feeCents, wp.status, wp.meta.grossSalesCents]));
    const boca = shows.find(s => s.name === 'Boca Raton Museum Art Festival');
    check('an unknown fee and gross stay null, and waitlist survives', boca.feeCents === null &&
          boca.meta.grossSalesCents === null && boca.meta.trackerStatus === 'waitlist');
    const study = sales.find(s => s.title === 'Small study');
    check('an unpriced, undated sale stays unpriced and undated', study.priceCents === null && study.soldOn === null);
    const pelican = sales.find(s => s.title === 'Pelican');
    check('a sale whose show was deleted keeps the old id in meta, not a broken link',
          pelican.showId === null && pelican.meta.importedShowId === SEASON.shows[5].id);
    check('the device copy is left exactly as it was',
          (await one.page.evaluate(() => localStorage.getItem('artShowTracker.db'))) === before);

    await one.page.click('#btnStudioImport');
    await one.page.waitForFunction(() => /0 added/.test(document.querySelector('#st_importResult').textContent));
    const result2 = await one.page.textContent('#st_importResult');
    check('running it again creates nothing new', /0 added, 10 already in the studio/.test(result2) &&
          (await api(one, '/v1/shows?limit=100')).items.length === 5 && (await api(one, '/v1/sales?limit=100')).items.length === 5, result2);

    await one.page.reload({ waitUntil: 'load' });
    await one.page.waitForFunction(() => document.querySelectorAll('.show-row').length > 0);
    check('the ledger now lists the imported season', (await one.page.$$('.show-row')).length === 5);
    const links = await one.page.evaluate(async () => {
      const ids = new Set((await AST.Store.list()).map(s => s.id));
      const apps = await AST.Store.listApplications();
      return { apps: apps.length, linked: apps.every(a => ids.has(a.showId)) };
    });
    check('applications stayed local and still point at their shows (no id rewrite needed)', links.apps === 2 && links.linked);

    /* ==== DEVICE 2 + CONTACTS NEVER SYNC ================================ */
    console.log('\n-- second device');
    await one.page.evaluate(() => AST.Store.upsertContact({ name: 'Bea Collector', email: 'bea@example.com' }));
    await sync(one);
    await signIn(two);
    await sync(two);
    check('the second device shows the same season', JSON.stringify(await ledgerNames(two)) === JSON.stringify(live));
    const pulled = JSON.stringify(await api(two, '/v1/sync/pull?since=0&limit=500'));
    check('nothing synced carries a contact (name, email or phone)',
          !/Ann Henderson|ann\.henderson|555-0100|Bea Collector|bea@example/.test(pulled));
    check('the second device has no contacts, applications or expenses: they are device-only',
          (await two.page.evaluate(() => Promise.all([AST.Store.listContacts(), AST.Store.listApplications(), AST.Store.listExpenses()])))
            .every(l => l.length === 0));

    /* ==== GATE 1: offline sale at a show ================================ */
    console.log('\n-- gate 1: airplane mode, log a sale, reconnect');
    await controlled(one);
    await one.ctx.setOffline(true);
    await one.page.goto(ORIGIN + '/expenses.html', { waitUntil: 'load' });
    await one.page.waitForFunction(() => /\d+ sales?/.test(document.querySelector('#saleCount').textContent));
    await one.page.click('#saleAdd');
    await one.page.waitForFunction(() => document.querySelector('#saShow').options.length > 1);
    await one.page.fill('#saPiece', 'Offline heron');
    await one.page.fill('#saPrice', '950');
    await one.page.fill('#saDate', '2027-03-20');
    await one.page.selectOption('#saShow', WINTER_PARK.id);
    await one.page.selectOption('#saPayment', 'card');
    await one.page.click('#saSave');
    await one.page.waitForFunction(() => /Offline heron/.test(document.querySelector('#saleList').textContent));
    check('offline, the Money page opens and the sale shows at once', true);
    await sync(one);
    const off = await one.page.evaluate(async () => ({ status: ASTStudio.status(), pending: await ASTStudio.pendingCount() }));
    check('with no network it waits in the outbox and says so', off.status === 'offline' && off.pending === 1, JSON.stringify(off));
    await one.ctx.setOffline(false);
    await sync(one);
    check('back online, it is sent', (await one.page.evaluate(() => ASTStudio.pendingCount())) === 0);

    await two.page.goto(ORIGIN + '/expenses.html', { waitUntil: 'load' });
    await sync(two);
    await two.page.reload({ waitUntil: 'load' });
    await two.page.waitForFunction(() => /Offline heron/.test(document.querySelector('#saleList').textContent));
    const row = await two.page.evaluate(() => [...document.querySelectorAll('.sale-row')]
      .find(r => /Offline heron/.test(r.textContent)).textContent);
    check('the second device shows the sale, at its show, with its price', /Winter Park/.test(row) && /950/.test(row), row);
    const sale = (await api(two, '/v1/sales?limit=100')).items.find(s => s.title === 'Offline heron');
    const activity = (await api(two, '/v1/activity?limit=100')).items;
    const logged = activity.find(a => a.entityId === sale.id && a.action === 'sale.create');
    check('the sale, the show and the activity log agree',
          sale.showId === wp.id && sale.priceCents === 95000 && sale.soldOn === '2027-03-20' &&
          !!logged && logged.source === 'sync' && logged.after.showId === wp.id,
          JSON.stringify({ show: sale.showId === wp.id, logged: logged && logged.source }));

    /* ==== GATE 2: conflicts ============================================ */
    console.log('\n-- gate 2: the same show edited on two offline devices');
    for (const d of [one, two]) {
      await d.page.goto(ORIGIN + '/index.html', { waitUntil: 'load' });
      await sync(d);
      await d.ctx.setOffline(true);
    }
    const edit = (d, patch) => d.page.evaluate(([id, p]) => AST.Store.get(id).then(s => AST.Store.upsert(Object.assign({}, s, p))), [WINTER_PARK.id, patch]);
    await edit(one, { rating: 10, city: 'Winter Park, FL' });
    await edit(two, { rating: 3, notes: 'Bring the tent weights', boothFee: 700 });
    await one.ctx.setOffline(false);
    await sync(one);
    await two.ctx.setOffline(false);
    await sync(two);
    await two.page.waitForSelector('[data-card="conflict"]');
    const card = await two.page.textContent('[data-card="conflict"]');
    check('the second device gets a review card naming the show', /Winter Park Sidewalk Art Festival/.test(card), card);
    check('same field: the studio kept its rating, the card shows both', /Your rating: the studio kept 10; this device had 3/.test(card));
    check('money never auto-merges, even though the other device never touched the fee',
          /Booth fee: the studio kept \$650\.00; this device had \$700\.00/.test(card));
    const merged = (await api(two, '/v1/shows?limit=100')).items.find(s => s.id === wp.id);
    check('different fields merged: city from device 1, notes from device 2',
          merged.city === 'Winter Park, FL' && merged.notes === 'Bring the tent weights' && merged.meta.rating === 10 && merged.feeCents === 65000,
          JSON.stringify([merged.city, merged.notes, merged.meta.rating, merged.feeCents]));
    const shown = await two.page.evaluate(id => AST.Store.get(id), WINTER_PARK.id);
    check('the second device now shows the studio\'s values', shown.rating === 10 && shown.boothFee === 650 && shown.notes === 'Bring the tent weights');
    await two.page.click('[data-card="conflict"] .st-row:has-text("Booth fee") button');
    await two.page.waitForFunction(() => /set back to \$700\.00/.test(document.querySelector('[data-card="conflict"]').textContent));
    await sync(two);
    await sync(one);
    check('"Use mine" puts this device\'s value back, on both devices',
          (await api(one, '/v1/shows?limit=100')).items.find(s => s.id === wp.id).feeCents === 70000 &&
          (await one.page.evaluate(id => AST.Store.get(id), WINTER_PARK.id)).boothFee === 700);
    check('the device that synced first saw no card', !(await one.page.$('[data-card="conflict"]')));

    /* ==== an edit made while a pull is on its way ======================== */
    console.log('\n-- an edit made mid-sync');
    await edit(one, { notes: 'From device 1' });
    await sync(one);
    let release;
    const held = new Promise(r => { release = r; });
    let seen = false;
    await two.page.route('**/v1/sync/pull**', async route => {
      if (seen) return route.continue();
      seen = true;
      const res = await route.fetch();   // the server's answer, with device 1's notes
      await held;
      await route.fulfill({ response: res });
    });
    const pulling = sync(two);
    await new Promise(r => setTimeout(r, 300));
    // A different field from device 1's, so the two should simply merge.
    await edit(two, { city: 'Typed while syncing' });
    release();
    await pulling;
    await two.page.unroute('**/v1/sync/pull**');
    check('the pull did not overwrite the edit made while it was on its way',
          (await two.page.evaluate(id => AST.Store.get(id), WINTER_PARK.id)).city === 'Typed while syncing');
    await sync(two);
    await sync(one);
    const both = await Promise.all([one, two].map(d => d.page.evaluate(id => AST.Store.get(id), WINTER_PARK.id)));
    check('and both devices end with both edits', both.every(s => s.city === 'Typed while syncing' && s.notes === 'From device 1'),
          JSON.stringify(both.map(s => [s.city, s.notes])));

    /* ==== Undo after delete ============================================== */
    console.log('\n-- undo a delete');
    const artigras = SEASON.shows[2].id;
    await one.page.evaluate(async id => { window.__gone = await AST.Store.remove(id); await ASTStudio.sync(); }, artigras);
    check('a deleted show leaves the studio', !(await api(one, '/v1/shows?limit=100')).items.some(s => s.meta.trackerId === artigras));
    await one.page.evaluate(async () => { await AST.Store.upsert(window.__gone); await ASTStudio.sync(); });
    await sync(two);
    check('Undo brings it back, on both devices', (await api(one, '/v1/shows?limit=100')).items.some(s => s.meta.trackerId === artigras) &&
          (await ledgerNames(two)).includes('ArtiGras Fine Arts Festival'));

    /* ==== the ledger with no network ===================================== */
    console.log('\n-- offline reopen');
    await controlled(two);
    await two.ctx.setOffline(true);
    await two.page.goto(ORIGIN + '/index.html', { waitUntil: 'load' });
    await two.page.waitForFunction(() => document.querySelectorAll('.show-row').length > 0);
    check('with no network, the ledger reopens with the studio\'s season', (await two.page.$$('.show-row')).length === 5);
    await two.ctx.setOffline(false);

    const errors = one.errors.concat(two.errors);
    check('no page errors on either device', !errors.length, errors.slice(0, 4).join(' | '));
  } catch (err) {
    fails.push('crashed: ' + (err && err.stack || err));
    console.log('  FAIL  crashed — ' + (err && err.stack || err));
  } finally {
    if (browser) await browser.close();
    proc.kill();
    fs.rmSync(state, { recursive: true, force: true });
  }
  console.log('\n' + passed + '/' + (passed + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
})();
