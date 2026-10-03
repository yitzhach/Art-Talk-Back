/* ==========================================================================
   Art Show Tracker — the studio backend (studio-api, through @studio/sdk)

   When this device is signed in to the studio, the show ledger and the sales
   live in the studio: an offline copy in IndexedDB, synced through the SDK's
   outbox. EVERYTHING ELSE stays in localStorage exactly as before — events,
   applications, expenses, rankings, reviews, debriefs, and contacts, which
   never leave the device under any backend (core.js pins them to
   LocalStore). Pages do not know which backend they are on: this file plugs
   in under `AST.Store` with the same async surface as LocalStore, and the
   Store's degrade-to-local rule covers every collection it does not implement.

   Classic script, no build step, DOM-free (the account panel and the review
   cards are studio-ui.js). Needs studio-sdk.js loaded first. Only over
   http(s): from file:// there is no API to reach, so it stays out of the way
   and the app is the local-only app it always was. Publishes window.ASTStudio.

   The mapping keeps the tracker's honesty rules: a null stays null in both
   directions (no fee is not $0, no date is not today), money moves as whole
   cents, and anything the platform has no column for rides in `meta`
   (D-038). Nothing is ever dropped to make a record fit: a value the column
   cannot hold is kept whole in meta.
   ========================================================================== */
window.ASTStudio = (function () {
  'use strict';

  var A = window.AST;
  var SDK = window.StudioSDK;
  var STATE_KEY = 'artShowTracker.studio';          // { signedIn, email, studioId }
  var IMPORT_KEY = 'artShowTracker.studioImport';   // set once "Import my existing data" ran
  var DB_NAME = 'artShowTracker.studio';
  var NO_NAME = '(no name)';
  var INTERVAL_MS = 60000;

  /* ---- 1. MAPPING (D-038) ---------------------------------------------- */

  /* Statuses: the platform's list is shorter, so the tracker's own word rides
     along in meta.trackerStatus and wins when it still agrees with the
     platform status (another app may have moved the show on since). */
  var TO_PLATFORM = { interested: 'planned', applied: 'applied', waitlist: 'applied',
                      accepted: 'accepted', declined: 'declined', not_applying: 'cancelled' };
  var FROM_PLATFORM = { planned: 'interested', applied: 'applied', accepted: 'accepted',
                        declined: 'declined', done: 'accepted', cancelled: 'not_applying' };
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function blankToNull(v) { return v == null || v === '' ? null : String(v); }
  function nullToBlank(v) { return v == null ? '' : String(v); }
  /** Dollars as the app stores them -> whole cents. Null stays null. */
  function toCents(v) { return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100); }
  function fromCents(c) { return c == null ? null : c / 100; }

  /** A text column with a length cap: the column gets what fits, meta keeps it whole. */
  function text(meta, key, value, max) {
    var v = blankToNull(value);
    meta[key + 'Full'] = v && v.length > max ? v : null;
    return v && v.length > max ? v.slice(0, max) : v;
  }
  function textBack(meta, key, column) { return meta[key + 'Full'] || nullToBlank(column); }
  /** A date column: only YYYY-MM-DD goes in; anything else is kept, unchanged, in meta. */
  function date(meta, key, value) {
    var v = blankToNull(value);
    meta[key + 'Raw'] = v && !ISO_DATE.test(v) ? v : null;
    return v && ISO_DATE.test(v) ? v : null;
  }
  /** A money column that cannot be negative: a negative figure is kept in meta instead. */
  function money(meta, key, dollars) {
    var c = toCents(dollars);
    meta[key + 'Negative'] = c != null && c < 0 ? c : null;
    return c != null && c < 0 ? null : c;
  }
  function moneyBack(meta, key, column) {
    return fromCents(meta[key + 'Negative'] != null ? meta[key + 'Negative'] : column);
  }

  /** A tracker show (makeShow shape) -> the platform's show fields. */
  function showToPlatform(show, pid) {
    var meta = {};
    var name = String(show.name || '').trim();
    var fields = {
      name: name ? text(meta, 'name', name, 200) : NO_NAME,
      city: text(meta, 'city', show.city, 200),
      startsOn: date(meta, 'startDate', show.startDate),
      endsOn: date(meta, 'endDate', show.endDate),
      feeCents: money(meta, 'boothFeeCents', show.boothFee),
      status: TO_PLATFORM[show.status] || 'planned',
      notes: text(meta, 'notes', show.notes, 5000)
    };
    meta.nameMissing = !name;
    meta.trackerId = show.id === pid ? null : show.id;
    meta.trackerStatus = show.status;
    meta.state = blankToNull(show.state);
    meta.lat = show.lat; meta.lng = show.lng;
    meta.applyBy = blankToNull(show.applyBy);
    meta.rating = show.rating;
    meta.juryFeeCents = toCents(show.juryFee);
    meta.grossSalesCents = toCents(show.grossSales);
    meta.routeNumber = blankToNull(show.routeNumber);
    meta.isAlternate = !!show.isAlternate;
    meta.hidden = !!show.hidden;
    meta.url = blankToNull(show.url);
    meta.source = show.source;
    meta.catalogueId = blankToNull(show.catalogueId);
    meta.trackerCreatedAt = show.createdAt || null;
    fields.meta = meta;
    return fields;
  }

  /** A platform show -> the tracker's shape, through makeShow like every record. */
  function showFromPlatform(rec) {
    var m = rec.meta || {};
    var status = m.trackerStatus && TO_PLATFORM[m.trackerStatus] === rec.status
      ? m.trackerStatus : (FROM_PLATFORM[rec.status] || 'interested');
    return A.makeShow({
      id: m.trackerId || rec.id,
      name: m.nameMissing && rec.name === NO_NAME ? '' : textBack(m, 'name', rec.name),
      city: textBack(m, 'city', rec.city),
      state: nullToBlank(m.state),
      lat: m.lat, lng: m.lng,
      startDate: rec.startsOn || nullToBlank(m.startDateRaw),
      endDate: rec.endsOn || nullToBlank(m.endDateRaw),
      applyBy: nullToBlank(m.applyBy),
      status: status,
      rating: m.rating,
      juryFee: fromCents(m.juryFeeCents),
      boothFee: moneyBack(m, 'boothFeeCents', rec.feeCents),
      grossSales: fromCents(m.grossSalesCents),
      routeNumber: nullToBlank(m.routeNumber),
      isAlternate: !!m.isAlternate,
      hidden: !!m.hidden,
      notes: textBack(m, 'notes', rec.notes),
      url: nullToBlank(m.url),
      source: m.source,
      catalogueId: nullToBlank(m.catalogueId),
      deletedAt: rec.deletedAt || null,
      createdAt: m.trackerCreatedAt || rec.createdAt,
      updatedAt: rec.updatedAt || new Date().toISOString()
    });
  }

  /** A tracker sale (makeSale shape) -> the platform's sale fields. `showPid` is the show's platform id. */
  function saleToPlatform(sale, pid, showPid) {
    var meta = {};
    var fields = {
      showId: showPid || null,
      title: text(meta, 'piece', sale.piece, 300),
      priceCents: money(meta, 'priceCents', sale.price),
      quantity: sale.quantity,
      soldOn: date(meta, 'date', sale.date),
      paymentMethod: blankToNull(sale.paymentMethod),
      size: text(meta, 'size', sale.size, 100),
      medium: text(meta, 'medium', sale.medium, 300),
      source: sale.source,
      externalId: text(meta, 'externalId', sale.externalId, 200),
      notes: text(meta, 'notes', sale.notes, 5000)
    };
    meta.trackerId = sale.id === pid ? null : sale.id;
    meta.catalogueId = blankToNull(sale.catalogueId);
    meta.cycle = blankToNull(sale.cycle);
    meta.trackerCreatedAt = sale.createdAt || null;
    fields.meta = meta;
    return fields;
  }

  /** `showIds` maps a show's platform id to the id the app knows it by. */
  function saleFromPlatform(rec, showIds) {
    var m = rec.meta || {};
    return A.makeSale({
      id: m.trackerId || rec.id,
      showId: rec.showId ? (showIds[rec.showId] || rec.showId) : nullToBlank(m.importedShowId),
      catalogueId: nullToBlank(m.catalogueId),
      cycle: m.cycle || undefined,
      piece: textBack(m, 'piece', rec.title),
      price: moneyBack(m, 'priceCents', rec.priceCents),
      size: textBack(m, 'size', rec.size),
      medium: textBack(m, 'medium', rec.medium),
      date: rec.soldOn || nullToBlank(m.dateRaw),
      paymentMethod: nullToBlank(rec.paymentMethod),
      quantity: rec.quantity,
      source: rec.source,
      externalId: textBack(m, 'externalId', rec.externalId),
      notes: textBack(m, 'notes', rec.notes),
      deletedAt: rec.deletedAt || null,
      createdAt: m.trackerCreatedAt || rec.createdAt,
      updatedAt: rec.updatedAt || new Date().toISOString()
    });
  }

  /** What changed between the platform's copy and the target: fields, and meta key by key (D-036). */
  var FIXED_META = { trackerId: 1, trackerCreatedAt: 1 };
  function diff(target, current) {
    var patch = {}, meta = {}, any = false, anyMeta = false;
    Object.keys(target).forEach(function (k) {
      if (k === 'meta') return;
      if (!same(target[k], current[k])) { patch[k] = target[k]; any = true; }
    });
    var cm = current.meta || {};
    Object.keys(target.meta).forEach(function (k) {
      if (FIXED_META[k]) return;
      if (!same(target.meta[k], cm[k])) { meta[k] = target.meta[k]; anyMeta = true; }
    });
    if (anyMeta) { patch.meta = meta; any = true; }
    return any ? patch : null;
  }

  /* ---- 2. IDS (D-038) ----------------------------------------------------
     The platform's ids are ULIDs; the tracker's are UUIDs. A tracker id maps
     to a ULID-shaped id derived from its SHA-256, so every device computes the
     same one with no lookup table, and the app goes on seeing its own id
     (kept in meta.trackerId). That is what lets applications, expenses,
     debriefs and the rest — still in localStorage, pointing at show ids —
     keep pointing at the right show without anything being rewritten. */
  var CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var idCache = {};
  function platformId(appId) {
    appId = String(appId || '');
    if (SDK.isId(appId)) return Promise.resolve(appId);
    if (idCache[appId]) return Promise.resolve(idCache[appId]);
    var bytes = new TextEncoder().encode('artShowTracker:' + appId);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      var b = new Uint8Array(buf);
      var n = BigInt(0);
      for (var i = 0; i < 16; i++) n = (n << BigInt(8)) | BigInt(b[i]);
      var out = '';
      for (var j = 0; j < 26; j++) { out = CROCKFORD[Number(n & BigInt(31))] + out; n >>= BigInt(5); }
      idCache[appId] = out;
      return out;
    });
  }

  /* ---- 3. STATE ---------------------------------------------------------- */
  function readJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }
  function writeJSON(key, v) {
    try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (_) {}
  }
  function available() {
    return (location.protocol === 'http:' || location.protocol === 'https:') && !!SDK &&
           typeof indexedDB !== 'undefined' && !!(window.crypto && crypto.subtle);
  }

  var studio = null;      // Promise<Studio> while signed in
  var listeners = { status: [], change: [], session: [], conflict: [], rejected: [] };
  var status = 'signed_out', lastError = '';
  var timer = null;

  function emit(name, payload) { listeners[name].forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } }); }
  function on(name, fn) { listeners[name].push(fn); return function () { listeners[name] = listeners[name].filter(function (f) { return f !== fn; }); }; }
  function setStatus(next, err) { status = next; lastError = err || ''; emit('status', { state: status, detail: lastError }); }

  function api() { return new SDK.ApiClient({ baseUrl: location.origin }); }

  /* ---- 4. THE STORE BACKEND ---------------------------------------------- */
  var tombs = {};   // platform id -> the record as it was before remove(), for Undo

  function ready() { return studio || Promise.reject(new Error('Not signed in to the studio')); }

  function showIdMap(st) {
    return st.list('show').then(function (rows) {
      var map = {};
      rows.forEach(function (r) { map[r.id] = (r.meta && r.meta.trackerId) || r.id; });
      return map;
    });
  }

  /** Create, restore or patch one record so the platform's copy matches `target`. */
  function put(st, type, pid, target) {
    return st.get(type, pid).then(function (cur) {
      if (!cur && tombs[type + ':' + pid]) {
        var before = tombs[type + ':' + pid];
        delete tombs[type + ':' + pid];
        return st.restore(type, before).then(function (back) { return patch(st, type, pid, target, back); });
      }
      if (!cur) return st.create(type, Object.assign({ id: pid }, target));
      return patch(st, type, pid, target, cur);
    }).then(function (rec) { kick(); return rec; });
  }
  function patch(st, type, pid, target, cur) {
    var p = diff(target, cur);
    return p ? st.update(type, pid, p) : cur;
  }
  function drop(type, appId) {
    return ready().then(function (st) {
      return platformId(appId).then(function (pid) {
        return st.get(type, pid).then(function (cur) {
          if (!cur) return null;
          tombs[type + ':' + pid] = cur;
          return st.remove(type, pid).then(function () { kick(); return cur; });
        });
      });
    });
  }

  var Backend = {
    /* shows — the ledger */
    list: function () {
      return ready().then(function (st) { return st.list('show'); })
        .then(function (rows) { return rows.map(showFromPlatform); });
    },
    listAll: function () { return Backend.list(); },
    get: function (id) {
      return ready().then(function (st) {
        return platformId(id).then(function (pid) { return st.get('show', pid); });
      }).then(function (rec) { return rec && !rec.deletedAt ? showFromPlatform(rec) : null; });
    },
    upsert: function (show) {
      var app = A.makeShow(show);
      app.updatedAt = new Date().toISOString();
      return ready().then(function (st) {
        return platformId(app.id).then(function (pid) {
          return put(st, 'show', pid, showToPlatform(app, pid));
        });
      }).then(showFromPlatform);
    },
    /** Soft delete; returns the show as it was, so Undo is one upsert (LocalStore's contract). */
    remove: function (id) {
      return drop('show', id).then(function (rec) { return rec ? showFromPlatform(rec) : null; });
    },
    /** Replaces the season: shows not in `shows` are removed, the rest put. Nothing else is touched. */
    replaceAll: function (shows) {
      var next = shows.map(A.makeShow);
      var keep = {};
      next.forEach(function (s) { keep[s.id] = true; });
      return Backend.list().then(function (now) {
        return now.filter(function (s) { return !keep[s.id]; })
          .reduce(function (p, s) { return p.then(function () { return Backend.remove(s.id); }); }, Promise.resolve());
      }).then(function () {
        return next.reduce(function (p, s) { return p.then(function () { return Backend.upsert(s); }); }, Promise.resolve());
      }).then(function () { return Backend.list(); });
    },

    /* sales — one row per sale per show */
    listSales: function () {
      return ready().then(function (st) {
        return Promise.all([st.list('sale'), showIdMap(st)]);
      }).then(function (both) {
        return both[0].map(function (r) { return saleFromPlatform(r, both[1]); });
      });
    },
    listAllSales: function () { return Backend.listSales(); },
    getSale: function (id) {
      return Backend.listSales().then(function (rows) {
        return rows.filter(function (s) { return s.id === id; })[0] || null;
      });
    },
    upsertSale: function (sale) {
      var app = A.makeSale(sale);
      app.updatedAt = new Date().toISOString();
      return ready().then(function (st) {
        return Promise.all([platformId(app.id), app.showId ? platformId(app.showId) : null]).then(function (ids) {
          return put(st, 'sale', ids[0], saleToPlatform(app, ids[0], ids[1]))
            .then(function (rec) { return showIdMap(st).then(function (map) { return saleFromPlatform(rec, map); }); });
        });
      });
    },
    removeSale: function (id) {
      return drop('sale', id).then(function (rec) {
        return rec ? ready().then(showIdMap).then(function (map) { return saleFromPlatform(rec, map); }) : null;
      });
    }
    /* Everything else (events, applications, rankers, expenses, reviews,
       debriefs) is not here, so AST.Store sends it to LocalStore. Contacts go
       to LocalStore whatever is here. */
  };

  /* ---- 5. SYNC ----------------------------------------------------------- */
  var syncing = null;
  /** Push then pull; safe to call often. Never throws: problems become a status. */
  function sync() {
    if (!studio) return Promise.resolve();
    if (syncing) return syncing;
    setStatus('syncing');
    syncing = studio.then(function (st) { return st.sync().then(function () { return st; }); })
      .then(function (st) {
        return st.pendingCount().then(function (n) {
          setStatus(st.online ? 'synced' : 'offline', st.online ? '' : (n ? n + ' change' + (n === 1 ? '' : 's') + ' waiting.' : ''));
        });
      })
      .catch(function (err) {
        if (err && err.status === 401) { forget('Your studio sign-in has ended. Sign in again to sync.'); return; }
        setStatus('error', err && err.message);
      })
      .then(function () { syncing = null; });
    return syncing;
  }
  var kickTimer = null;
  /** After a write: sync soon, once, however many writes came in together. */
  function kick() { clearTimeout(kickTimer); kickTimer = setTimeout(sync, 300); }

  function open() {
    studio = SDK.Studio.open({ baseUrl: location.origin, dbName: DB_NAME }).then(function (st) {
      st.on('change', function (e) {
        if (e.types.indexOf('show') !== -1 || e.types.indexOf('sale') !== -1) emit('change', e);
      });
      st.on('conflict', function (e) { emit('conflict', e); });
      st.on('rejected', function (e) { emit('rejected', e); });
      return st;
    });
    A.useStore(Backend);
    if (!timer) {
      timer = setInterval(sync, INTERVAL_MS);
      window.addEventListener('online', sync);
      window.addEventListener('focus', sync);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') sync(); });
    }
    return studio;
  }

  /** Signed out (by the user or by the server): back to the local-only app. */
  function forget(message) {
    var was = studio;
    studio = null;
    tombs = {};
    writeJSON(STATE_KEY, null);
    A.useStore(null);
    if (timer) { clearInterval(timer); timer = null; }
    setStatus('signed_out', message || '');
    emit('session', null);
    emit('change', { types: ['show', 'sale'] });
    return (was || Promise.resolve(null)).then(function (st) {
      if (st) st.close();
      return new Promise(function (res) {
        var req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = function () { res(); };
      });
    });
  }

  /* ---- 6. SIGN-IN -------------------------------------------------------- */
  function requestCode(email) { return api().requestCode(String(email || '').trim().toLowerCase()); }

  function verify(email, code) {
    email = String(email || '').trim().toLowerCase();
    return api().verify(email, String(code || '').trim()).then(function (me) {
      writeJSON(STATE_KEY, { signedIn: true, email: email, studioId: me.activeStudioId || null });
      open();
      emit('session', session());
      return sync().then(function () { emit('change', { types: ['show', 'sale'] }); return me; });
    });
  }

  function signOut() {
    var pending = studio ? studio.then(function (st) { return st.pendingCount(); }) : Promise.resolve(0);
    return pending.then(function (n) {
      return api().logout().catch(function () {}).then(function () { return forget(); }).then(function () { return n; });
    });
  }

  function session() { var s = readJSON(STATE_KEY); return s && s.signedIn ? s : null; }

  /* ---- 7. IMPORT MY EXISTING DATA (step 6) -------------------------------
     Reads this device's `artShowTracker.db` once and moves its shows and
     sales into the studio, through /v1/sync/push like any offline change.
     Op ids and record ids are derived from the tracker's own ids, so running
     it again — here or on another device holding the same season — creates
     nothing new: the server answers "duplicate". Never imports the untouched
     demo season (it is not the artist's data), never deleted rows, and never
     anything but shows and sales: contacts in particular stay on the device.
     The localStorage copy is left exactly as it was.                       */
  function readLocalSeason() {
    var raw = null;
    try { raw = localStorage.getItem('artShowTracker.db'); } catch (_) {}
    if (!raw) return null;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return null; }
    if (Array.isArray(parsed)) parsed = { shows: parsed };
    return A.migrate(parsed);
  }

  function importPlan() {
    var db = readLocalSeason();
    if (!db) return { shows: [], sales: [], seed: false };
    if (db.pristineSeed) return { shows: [], sales: [], seed: true };
    var live = function (r) { return !r.deletedAt; };
    return { shows: db.shows.filter(live), sales: db.sales.filter(live), seed: false };
  }

  function importExisting() {
    if (!studio) return Promise.reject(new Error('Sign in to the studio first.'));
    var plan = importPlan();
    var stamp = new Date().toISOString();
    var showIds = {};
    return studio.then(function (st) {
      return Promise.all(plan.shows.map(function (s) { return platformId(s.id); })).then(function (pids) {
        plan.shows.forEach(function (s, i) { showIds[s.id] = pids[i]; });
        return Promise.all(plan.shows.map(function (s, i) {
          var fields = showToPlatform(s, pids[i]);
          fields.meta.importedFrom = 'artShowTracker.db';
          return platformId('import:show:' + s.id).then(function (opId) {
            return { opId: opId, action: 'show.create', entityId: pids[i], baseVersion: null, input: fields };
          });
        }));
      }).then(function (showOps) {
        return Promise.all(plan.sales.map(function (sale) {
          return Promise.all([platformId(sale.id), platformId('import:sale:' + sale.id)]).then(function (ids) {
            // A sale whose show is gone from the ledger keeps the old id in meta, not a broken link.
            var showPid = sale.showId ? showIds[sale.showId] || null : null;
            var fields = saleToPlatform(sale, ids[0], showPid);
            fields.meta.importedFrom = 'artShowTracker.db';
            if (sale.showId && !showPid) fields.meta.importedShowId = sale.showId;
            return { opId: ids[1], action: 'sale.create', entityId: ids[0], baseVersion: null, input: fields };
          });
        })).then(function (saleOps) { return showOps.concat(saleOps); });
      }).then(function (ops) {
        var tally = { applied: 0, duplicate: 0, rejected: 0, errors: [] };
        var batches = [];
        for (var i = 0; i < ops.length; i += 200) batches.push(ops.slice(i, i + 200));
        return batches.reduce(function (p, batch) {
          return p.then(function () {
            return st.api.push(batch).then(function (res) {
              res.results.forEach(function (r, j) {
                if (r.status === 'duplicate') tally.duplicate++;
                else if (r.status === 'rejected') {
                  tally.rejected++;
                  tally.errors.push(batch[j].action + ' ' + ((batch[j].input && (batch[j].input.name || batch[j].input.title)) || '') + ': ' + (r.error && r.error.message));
                } else tally.applied++;
              });
            });
          });
        }, Promise.resolve()).then(function () {
          var record = { at: stamp, studioId: (session() || {}).studioId || null,
                         shows: plan.shows.length, sales: plan.sales.length,
                         applied: tally.applied, duplicate: tally.duplicate, rejected: tally.rejected };
          if (!tally.rejected) writeJSON(IMPORT_KEY, Object.assign({}, readJSON(IMPORT_KEY) || {}, record, { first: (readJSON(IMPORT_KEY) || {}).first || stamp }));
          return sync().then(function () {
            emit('change', { types: ['show', 'sale'] });
            return Object.assign({ seed: plan.seed, errors: tally.errors }, record);
          });
        });
      });
    });
  }

  /* ---- 8. BOOT ------------------------------------------------------------
     Signed in on this device before: switch the Store over now, before any
     page asks it for shows, so nothing ever renders the local season first. */
  if (available() && session()) {
    open();
    // The cookie may have expired while we were away; the first sync finds out.
    setTimeout(sync, 0);
  }

  /** For store-supabase.js: a page's sync wiring, pointed at the studio instead. */
  function attach(opts) {
    opts = opts || {};
    if (opts.onStatus) on('status', function (e) { opts.onStatus(e.state, e.detail); });
    if (opts.onShows) on('change', function () { opts.onShows(); });
    if (opts.onSession) on('session', function (s) { opts.onSession(s); });
    if (opts.onStatus) opts.onStatus(status, lastError);
    return { sync: sync, status: function () { return status; }, lastError: function () { return lastError; },
             setStatus: setStatus, studio: true };
  }

  return {
    available: available,
    active: function () { return !!studio; },
    session: session,
    status: function () { return status; },
    on: on, attach: attach, sync: sync,
    requestCode: requestCode, verify: verify, signOut: signOut,
    pendingCount: function () { return studio ? studio.then(function (st) { return st.pendingCount(); }) : Promise.resolve(0); },
    /** Re-apply this device's value for one field after a review card. */
    useMine: function (type, id, field, value) {
      if (!studio) return Promise.resolve();
      var p = {};
      if (field.indexOf('meta.') === 0) { p.meta = {}; p.meta[field.slice(5)] = value; } else p[field] = value;
      return studio.then(function (st) { return st.update(type, id, p); }).then(function () { kick(); emit('change', { types: [type] }); });
    },
    importPlan: importPlan,
    importExisting: importExisting,
    importRecord: function () { return readJSON(IMPORT_KEY); },
    /* For the suites. */
    _map: { showToPlatform: showToPlatform, showFromPlatform: showFromPlatform,
            saleToPlatform: saleToPlatform, saleFromPlatform: saleFromPlatform,
            diff: diff, platformId: platformId, TO_PLATFORM: TO_PLATFORM, FROM_PLATFORM: FROM_PLATFORM }
  };
})();
