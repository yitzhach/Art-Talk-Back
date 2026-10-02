/* ==========================================================================
   Art Show Tracker — studio account panel, import, and review-change cards

   The DOM half of studio-store.js. Three things:
     - "Studio account" at the top of the ledger's Account & sync drawer:
       sign in with an emailed code, sync now, sign out, and the one-time
       "Import my existing data".
     - Review-change cards, on every page that loads this file: when two
       devices changed the same thing, the studio keeps its value and this
       device is shown both, in the app's own words and units, with a way to
       put its own back. Money and status are never merged silently.
     - A refused change says so, and that it was undone here.
   Nothing here claims more than happened: a code is "sent" only once the
   server took the request, and an import reports what the server answered.
   Only over http(s), like studio-store.js. Publishes nothing.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.ASTStudio;
  var A = window.AST;
  if (!S || !S.available()) return;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'hidden') n.hidden = !!attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ---- words and units for a field, the way the app says them ----------- */
  var LABEL = {
    show: { name: 'Name', city: 'City', startsOn: 'Start date', endsOn: 'End date', feeCents: 'Booth fee',
            status: 'Status', notes: 'Notes', 'meta.rating': 'Your rating', 'meta.juryFeeCents': 'Jury fee',
            'meta.grossSalesCents': 'Gross sales', 'meta.hidden': 'Hidden from the plan',
            'meta.isAlternate': 'Alternate', 'meta.routeNumber': 'Route number', 'meta.applyBy': 'Apply by',
            'meta.state': 'State', 'meta.url': 'Link', 'meta.trackerStatus': 'Status',
            'meta.catalogueId': 'Catalogue link', 'meta.boothFeeCentsNegative': 'Booth fee' },
    sale: { title: 'Piece', priceCents: 'Price', quantity: 'Quantity', soldOn: 'Date', paymentMethod: 'Paid by',
            size: 'Size', medium: 'Medium', notes: 'Notes', showId: 'Show', externalId: 'Processor id',
            source: 'Source', 'meta.priceCentsNegative': 'Price' }
  };
  function label(type, field) {
    return (LABEL[type] && LABEL[type][field]) || field.replace(/^meta\./, '').replace(/([A-Z])/g, ' $1').toLowerCase();
  }
  function show(field, v) {
    if (v === null || v === undefined || v === '') return 'not recorded';
    if (/Cents(Negative)?$/.test(field)) {
      return '$' + (v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (field === 'status') return A.STATUS_LABEL[S._map.FROM_PLATFORM[v]] || String(v);
    if (field === 'meta.trackerStatus') return A.STATUS_LABEL[v] || String(v);
    if (field === 'paymentMethod') return A.PAYMENT_LABEL[v] || String(v);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v);
  }
  function title(type, record) {
    if (!record) return type === 'sale' ? 'A sale' : 'A show';
    if (type === 'show') return S._map.showFromPlatform(record).name || 'A show with no name';
    if (type === 'sale') return 'Sale: ' + (S._map.saleFromPlatform(record, {}).piece || 'piece not recorded');
    return type;
  }

  /* ---- cards ---------------------------------------------------------------- */
  var STYLE = [
    '.st-cards{position:fixed;right:16px;bottom:16px;z-index:2000;display:flex;flex-direction:column;gap:10px;',
    'width:min(400px,calc(100vw - 32px));max-height:70vh;overflow:auto}',
    '.st-card{background:var(--surface,#fff);color:var(--ink,#171717);border:1px solid var(--line,#e5e5e5);',
    'border-radius:10px;box-shadow:var(--shadow,0 10px 40px rgba(0,0,0,.12));padding:14px 16px;font-size:14px;line-height:1.45}',
    '.st-card h4{margin:0 0 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#737373)}',
    '.st-card .st-what{font-weight:600;margin:0 0 8px}',
    '.st-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:6px 0;',
    'border-top:1px solid var(--line,#e5e5e5)}',
    '.st-row p{margin:0}',
    '.st-card .btn-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}',
    '#studioSection .control{font-size:16px}',
    '#studioSection .st-import{margin-top:14px;padding:12px;border:1px solid var(--line,#e5e5e5);border-radius:8px}'
  ].join('');

  var host = null;
  function cards() {
    if (host) return host;
    document.head.appendChild(el('style', { text: STYLE }));
    host = el('div', { class: 'st-cards', 'aria-live': 'polite', id: 'studioCards' });
    document.body.appendChild(host);
    return host;
  }

  S.on('conflict', function (e) {
    var card = el('section', { class: 'st-card', role: 'status', 'data-card': 'conflict' });
    card.appendChild(el('h4', { text: 'Review change' }));
    card.appendChild(el('p', { class: 'st-what', text: title(e.entityType, e.record) }));
    card.appendChild(el('p', { text: 'This was also changed on another device. The studio kept its value; ' +
      'yours is shown beside it and can be put back.' }));
    e.conflicts.forEach(function (c) {
      var mine = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Use mine' });
      var row = el('div', { class: 'st-row' }, [
        el('p', { text: label(e.entityType, c.field) + ': the studio kept ' + show(c.field, c.serverValue) +
          '; this device had ' + show(c.field, c.deviceValue) + '.' }),
        mine
      ]);
      mine.addEventListener('click', function () {
        mine.disabled = true;
        S.useMine(e.entityType, e.entityId, c.field, c.deviceValue).then(function () {
          row.querySelector('p').textContent = label(e.entityType, c.field) + ': set back to ' + show(c.field, c.deviceValue) + '.';
          mine.remove();
        });
      });
      card.appendChild(row);
    });
    var done = el('button', { class: 'btn', type: 'button', text: 'Done' });
    done.addEventListener('click', function () { card.remove(); });
    card.appendChild(el('div', { class: 'btn-row' }, [done]));
    cards().appendChild(card);
  });

  S.on('rejected', function (e) {
    var card = el('section', { class: 'st-card', role: 'alert', 'data-card': 'rejected' });
    card.appendChild(el('h4', { text: 'Change not saved' }));
    card.appendChild(el('p', { text: 'The studio refused a change to a ' + e.entityType + ' (' + e.message +
      '). It has been undone on this device.' }));
    var ok = el('button', { class: 'btn', type: 'button', text: 'OK' });
    ok.addEventListener('click', function () { card.remove(); });
    card.appendChild(el('div', { class: 'btn-row' }, [ok]));
    cards().appendChild(card);
  });

  /* ---- the account panel (ledger only) ---------------------------------- */
  function mountPanel() {
    var body = document.querySelector('#settingsDrawer .drawer-body');
    if (!body || document.getElementById('studioSection')) return;
    cards();

    var email = el('input', { class: 'control', id: 'st_email', type: 'email', inputmode: 'email',
                              autocomplete: 'email', placeholder: 'you@example.com' });
    var code = el('input', { class: 'control', id: 'st_code', inputmode: 'numeric', autocomplete: 'one-time-code',
                             placeholder: '6-digit code', maxlength: '6' });
    var err = el('div', { class: 'err', id: 'st_err', hidden: true });
    var btnCode = el('button', { class: 'btn btn-primary', id: 'btnStudioCode', type: 'button', text: 'Email me a code' });
    var btnVerify = el('button', { class: 'btn btn-primary', id: 'btnStudioVerify', type: 'button', text: 'Sign in' });
    var codeRow = el('div', { class: 'form-row', id: 'st_codeRow', hidden: true }, [
      el('label', { class: 'label', for: 'st_code', text: 'Code from the email' }), code,
      el('div', { class: 'btn-row' }, [btnVerify])
    ]);
    var signedOut = el('div', { id: 'st_signedOut' }, [
      el('div', { class: 'form-row' }, [
        el('label', { class: 'label', for: 'st_email', text: 'Email' }), email,
        el('div', { class: 'btn-row' }, [btnCode])
      ]),
      codeRow
    ]);

    var who = el('p', { id: 'st_who', style: 'margin:6px 0 0;font-size:14px;' });
    var btnSync = el('button', { class: 'btn', id: 'btnStudioSync', type: 'button', text: 'Sync now' });
    var btnOut = el('button', { class: 'btn btn-quiet', id: 'btnStudioSignOut', type: 'button', text: 'Sign out' });
    var impText = el('p', { id: 'st_importText', style: 'margin:0 0 10px;font-size:14px;' });
    var impResult = el('p', { id: 'st_importResult', class: 'hint', hidden: true });
    var btnImport = el('button', { class: 'btn btn-primary', id: 'btnStudioImport', type: 'button', text: 'Import my existing data' });
    var signedIn = el('div', { id: 'st_signedIn', hidden: true }, [
      el('div', { class: 'form-row' }, [el('span', { class: 'label', text: 'Signed in to the studio as' }), who]),
      el('div', { class: 'btn-row' }, [btnSync, btnOut]),
      el('div', { class: 'st-import' }, [impText, el('div', { class: 'btn-row' }, [btnImport]), impResult])
    ]);

    var section = el('div', { id: 'studioSection' }, [
      el('h3', { class: 'label', style: 'margin:0 0 6px;', text: 'Studio account' }),
      el('p', { class: 'hint', style: 'margin:0 0 12px;', text: 'Signed in, your shows and sales are kept in your ' +
        'studio and appear on every device you sign in on, with or without signal. Everything else — calendar, ' +
        'applications, expenses, rankings, reviews, debriefs — stays on this device. Contacts never leave it.' }),
      err, signedOut, signedIn,
      el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:22px 0;' })
    ]);
    body.insertBefore(section, body.firstChild);

    function fail(msg) { err.textContent = msg || ''; err.hidden = !msg; }

    function paint() {
      var sess = S.session();
      signedOut.hidden = !!sess;
      signedIn.hidden = !sess;
      ['supabaseSection', 'btnSaveSettings', 'btnForgetProject'].forEach(function (id) {
        var n = document.getElementById(id);
        if (n) n.hidden = !!sess || (id === 'btnForgetProject' && !A.Settings.getConfig());
      });
      if (!sess) return;
      who.textContent = sess.email;
      var plan = S.importPlan();
      var done = S.importRecord();
      if (plan.seed || (!plan.shows.length && !plan.sales.length)) {
        impText.textContent = plan.seed
          ? 'This device only has the demo season, which is not yours, so there is nothing to import.'
          : 'This device has no shows or sales saved from before, so there is nothing to import.';
        btnImport.hidden = true;
      } else {
        impText.textContent = 'This device has ' + plan.shows.length + ' show' + (plan.shows.length === 1 ? '' : 's') +
          ' and ' + plan.sales.length + ' sale' + (plan.sales.length === 1 ? '' : 's') + ' saved from before you ' +
          'signed in. Import moves a copy into the studio; the copy here is kept as it is.';
        btnImport.hidden = false;
        btnImport.textContent = done ? 'Import again (adds nothing twice)' : 'Import my existing data';
      }
      if (done) {
        impResult.hidden = false;
        impResult.textContent = 'Imported ' + new Date(done.first || done.at).toLocaleString() + '.';
      }
    }

    btnCode.addEventListener('click', function () {
      fail('');
      var v = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(v)) { fail('Enter a valid email address.'); return; }
      btnCode.disabled = true;
      S.requestCode(v).then(function () {
        codeRow.hidden = false;
        btnCode.textContent = 'Email me a new code';
        code.focus();
      }, function (e) { fail('Could not send a code: ' + (e.message || 'no connection')); })
        .then(function () { btnCode.disabled = false; });
    });
    function verify() {
      fail('');
      btnVerify.disabled = true;
      S.verify(email.value, code.value).then(function () { code.value = ''; paint(); },
        function (e) { fail(e.status === 400 || e.status === 401 ? 'That code did not work. Check it, or ask for a new one.' : 'Could not sign in: ' + (e.message || 'no connection')); })
        .then(function () { btnVerify.disabled = false; });
    }
    btnVerify.addEventListener('click', verify);
    code.addEventListener('keydown', function (e) { if (e.key === 'Enter') verify(); });
    btnSync.addEventListener('click', function () { S.sync(); });
    btnOut.addEventListener('click', function () {
      S.pendingCount().then(function (n) {
        if (n && !confirm(n + ' change' + (n === 1 ? ' has' : 's have') + ' not reached the studio yet and will be lost if you sign out now. Sign out anyway?')) return;
        S.signOut().then(paint);
      });
    });
    btnImport.addEventListener('click', function () {
      btnImport.disabled = true;
      impResult.hidden = false;
      impResult.textContent = 'Importing…';
      S.importExisting().then(function (r) {
        var parts = [r.applied + ' added', r.duplicate + ' already in the studio'];
        if (r.rejected) parts.push(r.rejected + ' refused: ' + r.errors.join('; '));
        paint();
        impResult.textContent = 'Import finished: ' + r.shows + ' shows and ' + r.sales + ' sales read; ' + parts.join(', ') + '.';
      }, function (e) {
        impResult.textContent = 'Import did not run: ' + (e.message || 'no connection') + '. Nothing was changed; try again when online.';
      }).then(function () { btnImport.disabled = false; });
    });

    S.on('session', paint);
    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPanel);
  else mountPanel();
})();
