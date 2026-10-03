/* ==========================================================================
   Tests for tracker/route.js, the season planner (idea 17). Pure node: the
   file is DOM-free, so no browser and no server are needed.
     node build/route-tests.cjs
   The checks are the one-sided verdicts: a straight line may prove a leg is
   too far and must never be read as proving it fits.
   ========================================================================== */
global.window = {};
require('../tracker/route.js');
const R = window.ASTRoute;
let pass = 0; const fails = [];
const check = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  — ' + d : '')); } };

const show = (id, start, end, lat, lng, extra) => Object.assign(
  { id, name: id, status: 'accepted', startDate: start, endDate: end, lat, lng }, extra || {});
// Naples FL -> Miami FL is ~105 mi straight; Naples -> Denver ~1,700 mi.
const naples = show('naples', '2027-01-09', '2027-01-10', 26.142, -81.795);
const miami  = show('miami',  '2027-01-15', '2027-01-17', 25.762, -80.192);
const denver = show('denver', '2027-01-22', '2027-01-24', 39.739, -104.990);

const m = R.straightMiles(naples, miami);
check('straight-line miles are about right', m > 95 && m < 115, String(m));
check('no coordinates means no distance, not zero', R.straightMiles(naples, { name: 'x' }) === null);

let legs = R.legs([naples, miami, denver]);
check('with no daily limit nothing is judged', legs.every(l => l.verdict === 'not-judged'),
      legs.map(l => l.verdict).join());
check('days between counts whole days (Sun -> Fri = 4)', legs[0].daysBetween === 4, String(legs[0].daysBetween));

legs = R.legs([naples, miami, denver], { maxMilesPerDay: 300 });
check('a leg under the limit only "fits in a straight line"', legs[0].verdict === 'fits-straight-line');
check('a leg beyond the limit even as the crow flies is too far', legs[1].verdict === 'too-far');

const clash = show('clash', '2027-01-10', '2027-01-11', 26.1, -81.7);
check('overlapping dates are flagged', R.legs([naples, clash], { maxMilesPerDay: 500 })[0].verdict === 'overlap');

const others = [show('i', '2027-01-12', '2027-01-12', 1, 1, { status: 'interested' }),
                show('h', '2027-01-12', '2027-01-12', 1, 1, { hidden: true }),
                show('a', '2027-01-12', '2027-01-12', 1, 1, { isAlternate: true })];
check('interested, hidden and alternate shows stay out of the plan',
      R.planned([naples, miami].concat(others)).length === 2);

const dead = R.deadWeekends([naples, denver]);
check('open weekends inside the season are listed', JSON.stringify(dead) === '["2027-01-16"]', JSON.stringify(dead));
check('a one-show season has no dead weekends', R.deadWeekends([naples]).length === 0);

const sum = R.summary(R.legs([naples, miami, show('nowhere', '2027-02-01', '2027-02-01')]));
check('summary says when miles are incomplete', sum.milesComplete === false && sum.atLeastMiles > 0, JSON.stringify(sum));

// ---- road miles ---------------------------------------------------------
const key = R.pairKey(naples, miami);
legs = R.legs([naples, miami], { maxMilesPerDay: 150, roadMiles: { [key]: 125 } });
check('with road miles a leg can be judged as fitting', legs[0].verdict === 'fits' && legs[0].distanceSource === 'road');
legs = R.legs([naples, miami], { maxMilesPerDay: 20, roadMiles: { [key]: 125 } });
check('road miles beyond the limit are too far', legs[0].verdict === 'too-far');
const mixed = R.summary(R.legs([naples, miami, denver], { roadMiles: { [key]: 125 } }));
check('no road total while only some legs have road miles', mixed.roadMiles === null && mixed.roadLegs === 1, JSON.stringify(mixed));

(async () => {
  const store = {}; const cache = { get: k => store[k], set: (k, v) => { store[k] = v; } };
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ routes: [{ distance: 201168 }] }) }; };
  const mi1 = await R.fetchRoadMiles(naples, miami, { cache });
  const mi2 = await R.fetchRoadMiles(naples, miami, { cache });
  check('router metres become miles, and a leg is asked once', Math.round(mi1) === 125 && mi2 === mi1 && calls === 1, mi1 + ' / ' + calls);
  global.fetch = async () => { throw new Error('blocked'); };
  check('an unreachable router gives null, never a number',
        (await R.fetchRoadMiles(naples, denver, { cache })) === null);
  global.fetch = async () => ({ ok: true, json: async () => ({ routes: [] }) });
  check('a malformed answer gives null', (await R.fetchRoadMiles(miami, denver, { cache })) === null);

console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
if (fails.length) process.exit(1);
})();
