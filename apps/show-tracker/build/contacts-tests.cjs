/* ==========================================================================
   Browser tests for §7 Stage 4: contacts, follow-ups and the debrief.

   Most checks are about what the page REFUSES to do: sync somebody else's
   details, claim a reminder was sent, treat "did not ask" as yes, export
   someone who said no, or count a skipped debrief answer as a score.

   Usage:
     python3 -m http.server 8765     # from the repo root
     node build/contacts-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/contacts.html';
let pass = 0; const fails = [];
const check = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? '  — ' + d : '')); } };

(async () => {
  const b = await chromium.launch(
    require('fs').existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
  const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  check('page boots clean', errs.length === 0, errs.join(' | '));

  // ---- the records --------------------------------------------------------
  const rec = await p.evaluate(() => ({
    c: window.AST.makeContact({ name: 'Ann', consent: 'maybe', outcome: 'nonsense' }),
    d: window.AST.makeDebrief({ buyers: '', traffic: 11, loadIn: '7' })
  }));
  check('consent defaults to "did not ask", never yes', rec.c.consent === '', rec.c.consent);
  check('an unknown outcome stays unrecorded', rec.c.outcome === '', rec.c.outcome);
  check('a skipped debrief answer is null, not a middling score',
        rec.d.buyers === null && rec.d.traffic === null && rec.d.loadIn === 7, JSON.stringify(rec.d));

  const mig = await p.evaluate(() => {
    const up = window.AST.migrate({ schemaVersion: 10, shows: [{ id: 's', name: 'X' }],
      sales: [{ id: 'x', showId: 's', price: 500 }] });
    return { v: up.schemaVersion, cur: window.AST.SCHEMA_VERSION,
             contacts: up.contacts.length, debriefs: up.debriefs.length };
  });
  check('v10 migrates and backfills no contact from a sale',
        mig.v === mig.cur && mig.contacts === 0 && mig.debriefs === 0, JSON.stringify(mig));

  // ---- device-only ---------------------------------------------------------
  const local = await p.evaluate(async () => {
    const A = window.AST;
    let hit = false;
    const fake = Object.assign({}, A.LocalStore, {
      upsertContact: () => { hit = true; return Promise.resolve(null); },
      listContacts: () => { hit = true; return Promise.resolve([]); }
    });
    A.useStore(fake);
    await A.Store.upsertContact({ name: 'Stays here' });
    const n = (await A.Store.listContacts()).length;
    A.useStore(null);
    return { hit, n };
  });
  check('contacts never go to a sync backend, even one that implements them',
        !local.hit && local.n === 1, JSON.stringify(local));

  // ---- follow-ups ----------------------------------------------------------
  const fu = await p.evaluate(() => {
    const K = window.ASTContacts, A = window.AST;
    const rows = [
      A.makeContact({ name: 'due', followUpOn: '2026-01-01', consent: 'yes' }),
      A.makeContact({ name: 'later', followUpOn: '2030-01-01' }),
      A.makeContact({ name: 'said no', followUpOn: '2026-01-01', consent: 'no' }),
      A.makeContact({ name: 'done', followUpOn: '2026-01-01', followedUpAt: '2026-01-02' })
    ];
    const r = K.followUps(rows, '2026-06-01');
    return { due: r.due.map(c => c.name), up: r.upcoming.map(c => c.name), w: r.withheld };
  });
  check('due list excludes done and do-not-contact',
        JSON.stringify(fu.due) === '["due"]' && JSON.stringify(fu.up) === '["later"]' && fu.w === 1,
        JSON.stringify(fu));
  const chan = await p.textContent('#fuChannel');
  check('the follow-up panel says nothing is sent', /sends nothing/i.test(chan), chan);

  // ---- export --------------------------------------------------------------
  const csv = await p.evaluate(() => {
    const A = window.AST;
    return window.ASTContacts.toCsv([
      A.makeContact({ name: 'Keep', consent: 'yes' }),
      A.makeContact({ name: 'Unasked' }),
      A.makeContact({ name: 'Nope', consent: 'no' }),
      A.makeContact({ name: '=HYPERLINK("x")' })
    ], []);
  });
  check('export leaves out "do not contact" and counts it',
        csv.exported === 3 && csv.withheld === 1 && !/Nope/.test(csv.csv), JSON.stringify(csv));
  check('export defuses spreadsheet formulas', /'=HYPERLINK/.test(csv.csv), csv.csv);

  // ---- the page end to end -----------------------------------------------
  await p.click('#ctAdd');
  await p.waitForTimeout(150);
  const style = await p.$eval('#ctModal > .modal-card', el => getComputedStyle(el).pointerEvents);
  check('contact modal card is clickable (pointer-events)', style !== 'none', style);
  await p.fill('#ctName', 'Rosa Collector');
  await p.fill('#ctEmail', 'rosa@example.com');
  await p.fill('#ctInterest', 'the big harbour');
  await p.selectOption('#ctConsent', 'yes');
  await p.fill('#ctFollow', '2020-01-01');
  await p.click('#ctSave');
  await p.waitForTimeout(300);
  check('saved contact is listed', (await p.textContent('#ctList')).includes('Rosa Collector'));
  check('overdue follow-up shows as due', (await p.textContent('#fuDue')).includes('Rosa Collector'));
  await p.click('#fuDue [data-done]');
  await p.waitForTimeout(300);
  check('mark done clears it from the due list', !(await p.textContent('#fuDue')).includes('Rosa Collector'));

  // ---- the debrief ---------------------------------------------------------
  await p.evaluate(async () => {
    await window.AST.Store.upsert(window.AST.makeShow({
      id: 'dbshow', name: 'Finished Fair', status: 'accepted',
      startDate: '2026-04-04', endDate: '2026-04-05', grossSales: 3000 }));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  check('a finished accepted show waits for a debrief',
        (await p.textContent('#dbAwaiting')).includes('Finished Fair'));
  await p.click('#dbAwaiting [data-debrief="dbshow"]');
  await p.waitForTimeout(200);
  const pnl = await p.textContent('#dbPnl');
  check('P&L with no expenses says what is missing rather than a number',
        /needs/i.test(pnl) && !/\$3,000 taken/.test(pnl), pnl);
  await p.selectOption('#db_buyers', '8');
  await p.click('#dbSave');
  await p.waitForTimeout(300);
  const saved = await p.evaluate(async () => (await window.AST.Store.listDebriefs())[0]);
  check('debrief saves the answer given and leaves the rest null',
        saved && saved.buyers === 8 && saved.traffic === null && saved.cycle === '2026', JSON.stringify(saved));
  check('a debriefed show stops waiting', !(await p.textContent('#dbAwaiting')).includes('Finished Fair'));

  check('the menu links the page', await p.evaluate(() => !!document.querySelector('a[href="contacts.html"]')));
  check('no page errors', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
