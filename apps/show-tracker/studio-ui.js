/* ==========================================================================
   Art Show Tracker — studio sign-in, sync status and "review change" cards.

   One small chip in the corner of every page. It does not exist at all unless
   the deploy sets window.StudioConfig.apiUrl (studio-config.js), so the
   tracker opened from a file, or with no studio configured, is exactly the
   solo tracker it always was.

   Honest by construction (the tracker's rules): the chip says "Offline, 2
   waiting" and not "Synced" until the studio actually confirmed.
   ========================================================================== */
window.ASTStudioUI = (function () {
  'use strict';

  var ST = window.ASTStudio, A = window.AST, SDK = window.StudioSDK;
  var cfg = window.StudioConfig || {};
  if (!ST || !A || !SDK || !cfg.apiUrl) return { mounted: false };

  var esc = A.esc;
  var root, chip, panel, step = 'email', pendingEmail = '', busy = false, message = '', importInfo = null, importMsg = '';

  var CSS =
    '.studio-chip{position:fixed;right:12px;bottom:12px;z-index:60;font:600 11px/1 var(--font);letter-spacing:.08em;' +
    'text-transform:uppercase;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:999px;' +
    'padding:9px 14px;box-shadow:var(--shadow);cursor:pointer}' +
    '.studio-chip[data-state=online]{border-color:var(--accent)}' +
    '.studio-chip[data-state=offline],.studio-chip[data-state=signed_out]{border-color:var(--warn);color:var(--warn)}' +
    '.studio-chip .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:8px}' +
    '.studio-chip .badge{background:var(--warn);color:var(--bg);border-radius:999px;padding:2px 7px;margin-left:8px}' +
    '.studio-panel{position:fixed;right:12px;bottom:56px;z-index:61;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow:auto;' +
    'background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:16px;' +
    'font:300 14px/1.5 var(--font)}' +
    '.studio-panel h2{font:600 11px/1 var(--font);letter-spacing:.18em;text-transform:uppercase;margin:0 0 10px}' +
    '.studio-panel input{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);margin:6px 0 10px}' +
    '.studio-panel .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}' +
    '.studio-panel button.btn{border:1px solid var(--line);border-radius:6px;padding:8px 12px;background:var(--surface)}' +
    '.studio-panel button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}' +
    '.studio-panel .err{color:var(--danger);font-size:13px;margin:6px 0}' +
    '.studio-panel .muted{color:var(--muted);font-size:13px}' +
    '.studio-card{border:1px solid var(--warn);border-radius:8px;padding:10px 12px;margin:10px 0}' +
    '.studio-card ul{margin:6px 0 0;padding-left:18px}';

  function money(cents) { return cents === null || cents === undefined ? 'not recorded' : '$' + (cents / 100).toFixed(2); }
  function shown(field, v) {
    if (field === 'feeCents' || field === 'priceCents') return money(v);
    if (field === 'meta') return 'a different set of details';
    return v === null || v === undefined || v === '' ? 'empty' : String(v);
  }

  function chipText(s) {
    if (s.state === 'online') return s.pending ? 'Syncing · ' + s.pending + ' waiting' : 'Synced';
    if (s.state === 'offline') return 'Offline' + (s.pending ? ' · ' + s.pending + ' waiting' : '');
    if (s.state === 'signed_out') return 'Sign in again';
    return 'Sign in to sync';
  }

  function paintChip() {
    var s = ST.status();
    chip.setAttribute('data-state', s.state);
    chip.innerHTML = '<span class="dot"></span>' + esc(chipText(s)) +
      (s.reviews ? '<span class="badge">' + s.reviews + ' to review</span>' : '');
  }

  function cardHTML(c) {
    var lines = c.conflicts.map(function (x) {
      return '<li>' + esc(x.label) + ': kept <strong>' + esc(shown(x.field, x.serverValue)) +
        '</strong> from the other device; you had <strong>' + esc(shown(x.field, x.deviceValue)) + '</strong></li>';
    }).join('');
    if (c.rejected) return '<div class="studio-card"><strong>' + esc(c.label) + '</strong><div>' + esc(c.rejected) +
      '</div><div class="row"><button class="btn" data-act="dismiss" data-id="' + esc(c.id) + '">Dismiss</button></div></div>';
    return '<div class="studio-card"><strong>' + esc(c.label) + '</strong> changed on two devices.<ul>' + lines + '</ul>' +
      '<div class="row"><button class="btn" data-act="theirs" data-id="' + esc(c.id) + '">Keep theirs</button>' +
      '<button class="btn primary" data-act="mine" data-id="' + esc(c.id) + '">Use mine</button></div></div>';
  }

  function paintPanel() {
    var s = ST.status(), html = '';
    if (s.state === 'off' || s.state === 'signed_out') {
      html += '<h2>Studio sync</h2>';
      if (step === 'email') {
        html += '<p class="muted">Sign in to keep your shows and sales in step across your devices. Everything else stays on this device.</p>' +
          '<label for="studioEmail">Email</label><input id="studioEmail" type="email" autocomplete="email" value="' + esc(pendingEmail) + '">' +
          '<div class="row"><button class="btn primary" data-act="send"' + (busy ? ' disabled' : '') + '>Email me a code</button></div>';
      } else {
        html += '<p class="muted">We sent a 6-digit code to ' + esc(pendingEmail) + '.</p>' +
          '<label for="studioCode">Code</label><input id="studioCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6">' +
          '<div class="row"><button class="btn primary" data-act="verify"' + (busy ? ' disabled' : '') + '>Sign in</button>' +
          '<button class="btn" data-act="back">Use a different email</button></div>';
      }
      if (s.error) html += '<div class="err" role="alert">' + esc(s.error) + '</div>';
    } else {
      html += '<h2>Studio sync</h2><p>Signed in as <strong>' + esc(s.email || '') + '</strong>.</p>' +
        '<p class="muted">' + (s.state === 'online'
          ? (s.pending ? s.pending + ' change(s) sending…' : 'Everything on this device has reached the studio.')
          : 'No connection. ' + s.pending + ' change(s) are saved here and will send when you are back online.') + '</p>';
      if (s.error) html += '<div class="err" role="alert">' + esc(s.error) + '</div>';
    }
    if (message) html += '<div class="err" role="alert">' + esc(message) + '</div>';
    if ((s.state === 'online' || s.state === 'offline') && importInfo) {
      var n = importInfo.shows + importInfo.sales;
      if (importMsg) html += '<p class="muted" role="status">' + esc(importMsg) + '</p>';
      else if (!importInfo.demo && n && !importInfo.doneAt) {
        html += '<h2 style="margin-top:14px">Your existing data</h2><p class="muted">This device holds ' + plural(importInfo.shows, 'show') +
          ' and ' + plural(importInfo.sales, 'sale') + ' that are not in your studio yet. Importing adds them once and changes nothing here.</p>' +
          '<div class="row"><button class="btn primary" data-act="import"' + (busy ? ' disabled' : '') + '>Import my existing data</button></div>';
      } else if (importInfo.doneAt) {
        html += '<p class="muted">Existing data imported ' + esc(String(importInfo.doneAt).slice(0, 10)) + '.</p>';
      }
    }
    var cards = ST.Reviews.list();
    if (cards.length) html += '<h2 style="margin-top:14px">Review changes</h2>' + cards.map(cardHTML).join('');
    if (s.state === 'online' || s.state === 'offline') {
      html += '<div class="row"><button class="btn" data-act="out">Sign out on this device</button></div>';
    }
    panel.innerHTML = html;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  var loadingImport = false;
  function paint() {
    paintChip();
    if (!panel.hidden) {
      paintPanel();
      /* Signed in with nothing known about this device's data yet: look. */
      if (!importInfo && !loadingImport && (ST.status().state === 'online' || ST.status().state === 'offline')) refreshImport();
    }
  }
  function refreshImport() {
    var s = ST.status();
    if (s.state !== 'online' && s.state !== 'offline') { importInfo = null; return Promise.resolve(); }
    loadingImport = true;
    return ST.importPreview().then(function (i) { importInfo = i; }, function () {}).then(function () {
      loadingImport = false;
      if (!panel.hidden) paintPanel();
    });
  }

  async function runImport() {
    var i = importInfo;
    if (!i || !window.confirm('Add ' + plural(i.shows, 'show') + ' and ' + plural(i.sales, 'sale') +
      ' from this device to your studio? They stay on this device too.')) return;
    busy = true; importMsg = ''; paintPanel();
    try {
      var r = await ST.importExisting();
      importMsg = r.demo ? 'This device only has the demo season, so there is nothing to import.'
        : 'Imported ' + plural(r.imported.shows, 'show') + ' and ' + plural(r.imported.sales, 'sale') +
          (r.linked.shows + r.linked.sales ? '; ' + (r.linked.shows + r.linked.sales) + ' were already in the studio and were linked, not copied' : '') +
          (r.skipped ? '; ' + plural(r.skipped, 'show') + ' with no name ' + (r.skipped === 1 ? 'was' : 'were') + ' left on this device' : '') + '.';
    } catch (err) { message = err.message || 'The import did not finish.'; }
    busy = false;
    await refreshImport();
    paintPanel();
  }

  async function send() {
    var email = (panel.querySelector('#studioEmail').value || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { message = 'Enter a valid email address.'; paintPanel(); return; }
    busy = true; message = ''; pendingEmail = email; paintPanel();
    try {
      await new SDK.ApiClient({ baseUrl: cfg.apiUrl }).requestCode(email);
      step = 'code';
    } catch (err) { message = err.message || 'Could not send the code.'; }
    busy = false; paintPanel();
  }

  async function verify() {
    var code = (panel.querySelector('#studioCode').value || '').trim();
    if (!/^\d{6}$/.test(code)) { message = 'The code is six digits.'; paintPanel(); return; }
    busy = true; message = ''; paintPanel();
    try {
      var me = await new SDK.ApiClient({ baseUrl: cfg.apiUrl }).verify(pendingEmail, code);
      if (!me.activeStudioId) { message = 'That email has no studio yet. Ask the studio owner to add you.'; }
      else {
        ST.Session.set({ apiUrl: cfg.apiUrl, studioId: me.activeStudioId, email: pendingEmail });
        await ST.disconnect();
        await ST.connect();
        step = 'email';
      }
    } catch (err) { message = err.message || 'Could not sign in.'; }
    busy = false; paintPanel();
  }

  async function signOut() {
    var st = ST.studio();
    try { if (st) await st.api.logout(); } catch (_) { /* offline: the cookie just expires */ }
    ST.Session.clear();
    await ST.disconnect();
    importInfo = null; importMsg = '';
    paint();
  }

  function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'send') send();
    else if (act === 'verify') verify();
    else if (act === 'back') { step = 'email'; message = ''; paintPanel(); }
    else if (act === 'out') signOut();
    else if (act === 'import') runImport();
    else if (act === 'mine') ST.useMine(id).then(paint);
    else if (act === 'theirs' || act === 'dismiss') { ST.keepTheirs(id); paint(); }
  }

  function mount() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'studio-chip';
    chip.setAttribute('aria-haspopup', 'dialog'); chip.setAttribute('aria-expanded', 'false');
    panel = document.createElement('div');
    panel.className = 'studio-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Studio sync');
    root.appendChild(panel); root.appendChild(chip);
    document.body.appendChild(root);

    chip.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      chip.setAttribute('aria-expanded', String(!panel.hidden));
      paint();
      if (!panel.hidden) refreshImport();
    });
    panel.addEventListener('click', onClick);
    ST.onChange(paint);
    paint();

    if (ST.Session.get()) ST.connect().then(paint, function (err) { message = String(err && err.message || err); paint(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  return { mounted: true };
})();
