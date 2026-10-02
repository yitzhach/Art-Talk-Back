/* ==========================================================================
   The studio mapping (studio-store.js): tracker records <-> studio records.

   What is worth proving: every field survives the round trip; a null stays
   null both ways (no fee is not $0, no date is not today, an unpriced sale
   is not free); the tracker's own status words survive a platform that has
   fewer of them; a value too big for its column is kept whole, not cut; an
   edit sends only what changed, meta key by key; ids are stable and valid;
   and from file:// none of it switches on. The live two-device run is
   e2e/two-devices.spec.cjs; this is the arithmetic, in the page.

   Usage:
     python3 -m http.server 8765     # from apps/show-tracker
     node build/studio-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/index.html';

const fails = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch(fs.existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });

  const r = await page.evaluate(async () => {
    const M = ASTStudio._map, A = AST;
    const out = {};
    const full = A.makeShow({
      id: '3f2c1a8e-1111-4c4c-9c9c-123456789abc', name: 'Coconut Grove Arts Festival', city: 'Coconut Grove, Miami',
      state: 'FL', lat: 25.7282, lng: -80.2434, startDate: '2027-02-13', endDate: '2027-02-15', applyBy: '2026-09-08',
      status: 'waitlist', rating: 8, juryFee: 45, boothFee: 650.5, grossSales: 4210.25, routeNumber: '7',
      isAlternate: true, hidden: true, notes: 'Corner if possible', url: 'https://example.org', source: 'catalogue',
      catalogueId: 'zapp-1', createdAt: '2026-01-02T03:04:05.000Z'
    });
    const pid = await M.platformId(full.id);
    const plat = M.showToPlatform(full, pid);
    out.plat = plat;
    out.pid = pid;
    out.pidAgain = await M.platformId(full.id);
    out.pidValid = StudioSDK.isId(pid);
    out.ulidKept = await M.platformId('01J9ZZZZZZZZZZZZZZZZZZZZZZ');
    const back = M.showFromPlatform(Object.assign({ id: pid, createdAt: 'x', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null }, plat));
    out.showRound = Object.keys(full).filter(k => k !== 'updatedAt').filter(k => JSON.stringify(full[k]) !== JSON.stringify(back[k]));

    const empty = A.makeShow({ id: 'e-1', name: '' });
    const ep = M.showToPlatform(empty, await M.platformId('e-1'));
    out.emptyPlat = ep;
    const eb = M.showFromPlatform(Object.assign({ id: 'x', deletedAt: null }, ep));
    out.emptyBack = { name: eb.name, boothFee: eb.boothFee, grossSales: eb.grossSales, juryFee: eb.juryFee, startDate: eb.startDate, rating: eb.rating };

    out.statuses = A.STATUSES.map(s => {
      const p = M.showToPlatform(A.makeShow({ id: 's', name: 'x', status: s.value }), 's');
      return [s.value, p.status, M.showFromPlatform(Object.assign({ id: 's', deletedAt: null }, p)).status];
    });
    // Another app moved the show on: the platform's status wins over a stale tracker word.
    out.moved = M.showFromPlatform({ id: 's', name: 'x', status: 'accepted', meta: { trackerStatus: 'waitlist' } }).status;

    const long = 'n'.repeat(6000);
    const lp = M.showToPlatform(A.makeShow({ id: 'l', name: 'x', notes: long, startDate: '2027-2-6', boothFee: -5 }), 'l');
    out.long = { col: lp.notes.length, meta: lp.meta.notesFull.length, start: lp.startsOn, raw: lp.meta.startDateRaw, fee: lp.feeCents, neg: lp.meta.boothFeeCentsNegative };
    const lb = M.showFromPlatform(Object.assign({ id: 'l', deletedAt: null }, lp));
    out.longBack = { notes: lb.notes.length, start: lb.startDate, fee: lb.boothFee };

    // An edit sends only what changed, and meta key by key.
    const cur = Object.assign({ id: pid, version: 3 }, plat);
    out.noChange = M.diff(M.showToPlatform(full, pid), cur);
    out.oneChange = M.diff(M.showToPlatform(Object.assign({}, full, { rating: 9, notes: 'Booth 12' }), pid), cur);

    const sale = A.makeSale({ id: 'sale-1', showId: full.id, piece: 'Heron, small', price: 450, size: '8 x 10 in',
      medium: 'oil', date: '2027-02-14', paymentMethod: 'card', quantity: 2, source: 'square', externalId: 'sq-9',
      notes: 'framed', catalogueId: 'zapp-1', createdAt: '2026-02-14T15:00:00.000Z' });
    const spid = await M.platformId(sale.id);
    const sp = M.saleToPlatform(sale, spid, pid);
    out.salePlat = sp;
    const map = {}; map[pid] = full.id;
    const sb = M.saleFromPlatform(Object.assign({ id: spid, deletedAt: null, updatedAt: 'u' }, sp), map);
    out.saleRound = Object.keys(sale).filter(k => k !== 'updatedAt').filter(k => JSON.stringify(sale[k]) !== JSON.stringify(sb[k]));
    const bare = A.makeSale({ id: 'b' });
    const bp = M.saleToPlatform(bare, 'b', null);
    out.bare = { price: bp.priceCents, soldOn: bp.soldOn, showId: bp.showId, method: bp.paymentMethod, title: bp.title };
    const bb = M.saleFromPlatform(Object.assign({ id: 'b', deletedAt: null }, bp), {});
    out.bareBack = { price: bb.price, date: bb.date, showId: bb.showId, piece: bb.piece };

    // Not signed in: the Store is still LocalStore, and contacts would be there anyway.
    out.active = ASTStudio.active();
    out.backendIsLocal = AST.currentStore() === AST.LocalStore;
    out.panel = !!document.getElementById('studioSection');
    return out;
  });

  check('a tracker id maps to a valid ULID', r.pidValid, r.pid);
  check('the same id maps the same way every time (no lookup table)', r.pid === r.pidAgain);
  check('an id that is already a ULID is kept as it is', r.ulidKept === '01J9ZZZZZZZZZZZZZZZZZZZZZZ');
  check('every show field survives the round trip', !r.showRound.length, r.showRound.join(', '));
  check('money moves as whole cents', r.plat.feeCents === 65050 && r.plat.meta.grossSalesCents === 421025 &&
        r.plat.meta.juryFeeCents === 4500, JSON.stringify([r.plat.feeCents, r.plat.meta.grossSalesCents]));
  check('the tracker id rides along so the app keeps seeing its own', r.plat.meta.trackerId === '3f2c1a8e-1111-4c4c-9c9c-123456789abc');
  check('no fee, gross or jury fee is null in the studio, never 0',
        r.emptyPlat.feeCents === null && r.emptyPlat.meta.grossSalesCents === null && r.emptyPlat.meta.juryFeeCents === null);
  check('and comes back null, not 0', r.emptyBack.boothFee === null && r.emptyBack.grossSales === null && r.emptyBack.juryFee === null);
  check('no date is null, not today', r.emptyPlat.startsOn === null && r.emptyBack.startDate === '');
  check('a show with no name is stored with a placeholder and comes back nameless',
        r.emptyPlat.name === '(no name)' && r.emptyPlat.meta.nameMissing === true && r.emptyBack.name === '');
  check('every tracker status survives the round trip', r.statuses.every(s => s[0] === s[2]), JSON.stringify(r.statuses));
  check('waitlist and not-applying map to the nearest studio status',
        JSON.stringify(r.statuses.filter(s => s[0] === 'waitlist' || s[0] === 'not_applying').map(s => s[1])) === '["applied","cancelled"]');
  check('a status another app changed wins over a stale tracker word', r.moved === 'accepted', r.moved);
  check('text too long for its column is kept whole in meta', r.long.col === 5000 && r.long.meta === 6000 && r.longBack.notes === 6000);
  check('a date that is not YYYY-MM-DD is kept as written, not dropped or guessed',
        r.long.start === null && r.long.raw === '2027-2-6' && r.longBack.start === '2027-2-6');
  check('a negative fee is kept, not zeroed', r.long.fee === null && r.long.neg === -500 && r.longBack.fee === -5);
  check('an unchanged show sends nothing', r.noChange === null, JSON.stringify(r.noChange));
  check('an edit sends only the changed field and the changed meta key',
        JSON.stringify(r.oneChange) === JSON.stringify({ notes: 'Booth 12', meta: { rating: 9 } }), JSON.stringify(r.oneChange));
  check('every sale field survives the round trip', !r.saleRound.length, r.saleRound.join(', '));
  check('the sale links to the show by its studio id', r.salePlat.showId === r.pid);
  check('an unpriced, undated sale with no show stays null in the studio',
        r.bare.price === null && r.bare.soldOn === null && r.bare.showId === null && r.bare.method === null && r.bare.title === null);
  check('and comes back unpriced, undated, with no show', r.bareBack.price === null && r.bareBack.date === '' && r.bareBack.showId === '');
  check('not signed in, the Store is the local one it always was', !r.active && r.backendIsLocal);
  check('the ledger offers the studio sign-in', r.panel);

  /* From file:// there is no studio: no panel, no switch, no error. */
  const fpage = await browser.newPage();
  const ferrs = [];
  fpage.on('pageerror', e => ferrs.push(e.message));
  await fpage.goto('file://' + path.join(__dirname, '..', 'tracker', 'index.html'), { waitUntil: 'load' });
  const f = await fpage.evaluate(() => ({ avail: ASTStudio.available(), panel: !!document.getElementById('studioSection'),
                                          local: AST.currentStore() === AST.LocalStore }));
  check('from file://, the studio stays off and the app is local', !f.avail && !f.panel && f.local, JSON.stringify(f));
  check('no page errors', !errors.length && !ferrs.length, errors.concat(ferrs).join(' | '));
  await browser.close();

  console.log('\n' + passed + '/' + (passed + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(x => console.log('  - ' + x)); process.exit(1); }
})();
