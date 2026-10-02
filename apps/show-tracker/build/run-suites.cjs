/* ==========================================================================
   Runs the tracker's own suites (the "eleven suites" in docs/START-HERE.md, plus
   pwa-tests.cjs for the installable shell and studio-tests.cjs for the
   studio mapping)
   against this copy: starts the static server on 8765, runs each suite, and
   exits non-zero if any of them did. The worker/ suite is not here: the
   members Worker stayed in yitzhach/art-show-tracker.

   Usage: node build/run-suites.cjs [name ...]   (names without -tests.cjs)
   ========================================================================== */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALL = ['browser', 'ledger-view', 'calendar', 'pipeline', 'ranker', 'expense',
             'jury', 'contacts', 'route', 'pwa', 'studio'];
const only = process.argv.slice(2);
const suites = only.length ? ALL.filter(s => only.includes(s)) : ALL;

function up() {
  return new Promise(res => {
    http.get('http://127.0.0.1:8765/tracker/version.json', r => { r.resume(); res(r.statusCode === 200); })
      .on('error', () => res(false));
  });
}

(async () => {
  let server = null;
  if (!(await up())) {
    server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'],
                   { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 100));
  }
  const failed = [];
  for (const s of suites) {
    console.log('\n=== ' + s + '-tests.cjs');
    const r = spawnSync('node', [path.join('build', s + '-tests.cjs')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) failed.push(s);
  }
  if (!only.length) {
    console.log('\n=== build_fit_data.py --selftest');
    const r = spawnSync('python3', ['build/build_fit_data.py', '--selftest'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) failed.push('selftest');
  }
  if (server) server.kill();
  console.log('\n' + (failed.length ? 'FAILED: ' + failed.join(', ') : 'all suites passed'));
  process.exit(failed.length ? 1 : 0);
})();
