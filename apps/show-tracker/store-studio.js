/* ==========================================================================
   Art Show Tracker — studio-api backend (Platform Phase 2)

   Same idea as store-supabase.js: LocalStore stays the immediate read/write
   path, so every screen works offline and nothing else in the app changes.
   This file adds a mirror: what you do to a show or a sale is also written
   into the Studio SDK (IndexedDB + outbox), which pushes it to studio-api
   when there is a connection and pulls everyone else's changes back.

   What syncs:   your ledger shows, and your sales (one artwork per sale).
   What doesn't: everything else stays on this device exactly as before —
                 catalogue picks, rankings, applications, expenses, reviews.
                 Contacts are device-only by rule and never touch this file.

   Ids. A tracker id is a UUID; the platform's are ULIDs. The tracker id rides
   along in `meta.trackerId`, and the whole tracker record in `meta.tracker`,
   so a second device rebuilds the same show with the same id and nothing the
   platform has no column for is lost. The platform's own columns (name,
   dates, fee, status, notes) are the shared truth: if another editor changed
   one, that wins over the copy in `meta.tracker`.

   A conflict is never silent: the server keeps its value and a "review
   change" card is raised (see studio-ui.js).

   Publishes window.ASTStudio. Needs window.AST (core.js) and window.StudioSDK
   (studio-sdk.js, built from packages/sdk).
   ========================================================================== */
window.ASTStudio = (function () {
  'use strict';

  var A = window.AST;
  var Local = A.LocalStore;

  var MAP_KEY = 'artShowTracker.studioMap';
  var SESSION_KEY = 'artShowTracker.studioSession';
  var REVIEW_KEY = 'artShowTracker.studioReview';
  var ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  /* ---- Mapping: tracker record <-> platform record ----------------------- */
  /* Waitlist has no platform twin and maps to "applied"; the true value is
     kept in meta.tracker, and only a platform-side change to status
     overrides it (see fromPlatformShow). */
  var STATUS_TO = { interested: 'planned', applied: 'applied', accepted: 'accepted',
                    waitlist: 'applied', declined: 'declined', not_applying: 'cancelled' };
  var STATUS_FROM = { planned: 'interested', applied: 'applied', accepted: 'accepted',
                      declined: 'declined', cancelled: 'not_applying', done: 'accepted' };

  /* Dollars in the tracker, integer cents on the platform. Null stays null:
     "not recorded" is never zero. */
  function toCents(dollars) {
    return dollars === null || dollars === undefined ? null : Math.round(Number(dollars) * 100);
  }
  function fromCents(cents) { return cents === null || cents === undefined ? null : cents / 100; }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
  function orNull(s, n) { s = clip(s, n); return s === '' ? null : s; }
  function day(s) { return ISO_DAY.test(s || '') ? s : null; }

  /* The platform has columns for a show's name, city, dates, fee, status and
     notes; those travel in the columns, never twice. Everything else is the
     meta blob. Two edits to the same value therefore collide on one field,
     and an edit to a column field never touches the blob. */
  var SHOW_COLUMNS = ['id', 'name', 'city', 'startDate', 'endDate', 'boothFee', 'status', 'notes', 'deletedAt', 'createdAt', 'updatedAt'];
  var SALE_COLUMNS = ['id', 'piece', 'medium', 'price', 'notes', 'deletedAt', 'createdAt', 'updatedAt'];

  function blob(rec, columns) {
    var out = {};
    Object.keys(rec).forEach(function (k) { if (columns.indexOf(k) === -1) out[k] = rec[k]; });
    return out;
  }
  /* A value the platform would have to shorten keeps its full text in the blob. */
  function clippedFull(out, key, value, max) {
    value = String(value == null ? '' : value);
    if (value.length > max) { out.full = out.full || {}; out.full[key] = value; }
  }
  function unclip(blobFull, key, platformValue, max) {
    var full = blobFull && blobFull[key];
    return full !== undefined && clip(full, max).trim() === String(platformValue == null ? '' : platformValue).trim() ? full : platformValue;
  }

  /** The platform fields for a ledger show, or null if it can't be stored yet (no name). */
  function toPlatformShow(show) {
    var name = clip(show.name, 200).trim();
    if (!name) return null;
    var extra = blob(show, SHOW_COLUMNS);
    if (show.status === 'waitlist') extra.waitlist = true; /* "applied" on the platform */
    clippedFull(extra, 'name', show.name, 200);
    clippedFull(extra, 'notes', show.notes, 5000);
    return {
      name: name,
      city: orNull(show.city, 200),
      startsOn: day(show.startDate),
      endsOn: day(show.endDate),
      feeCents: toCents(show.boothFee),
      currency: 'USD',
      status: STATUS_TO[show.status] || 'planned',
      notes: orNull(show.notes, 5000),
      meta: { trackerId: show.id, tracker: extra }
    };
  }

  /** A tracker show from a platform show. The platform's columns are the truth. */
  function fromPlatformShow(rec) {
    var meta = rec.meta || {}, extra = meta.tracker || {};
    var status = STATUS_FROM[rec.status] || 'interested';
    if (extra.waitlist && rec.status === 'applied') status = 'waitlist';
    var base = A.makeShow(Object.assign({}, blob(extra, ['waitlist', 'full']), {
      id: meta.trackerId || rec.id,
      name: unclip(extra.full, 'name', rec.name, 200),
      city: rec.city || '',
      startDate: rec.startsOn || '',
      endDate: rec.endsOn || '',
      boothFee: fromCents(rec.feeCents),
      status: status,
      notes: unclip(extra.full, 'notes', rec.notes, 5000) || '',
      deletedAt: rec.deletedAt || null,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    }));
    return base;
  }

  /** One sale is one platform artwork; the rest of the sale rides in meta.trackerSale. */
  function toPlatformArtwork(sale) {
    var extra = blob(sale, SALE_COLUMNS);
    if (!clip(sale.piece, 300).trim()) extra.untitled = true; /* the artist left it blank */
    clippedFull(extra, 'piece', sale.piece, 300);
    clippedFull(extra, 'medium', sale.medium, 300);
    clippedFull(extra, 'notes', sale.notes, 5000);
    return {
      title: clip(sale.piece, 300).trim() || 'Untitled sale',
      medium: orNull(sale.medium, 300),
      priceCents: toCents(sale.price),
      currency: 'USD',
      description: orNull(sale.notes, 5000),
      meta: { trackerId: sale.id, trackerSale: extra }
    };
  }

  function fromPlatformArtwork(rec) {
    var meta = rec.meta || {}, extra = meta.trackerSale || {};
    var piece = unclip(extra.full, 'piece', rec.title, 300);
    return A.makeSale(Object.assign({}, blob(extra, ['full', 'untitled']), {
      id: meta.trackerId || rec.id,
      piece: extra.untitled && rec.title === 'Untitled sale' ? '' : piece,
      medium: unclip(extra.full, 'medium', rec.medium, 300) || '',
      price: fromCents(rec.priceCents),
      notes: unclip(extra.full, 'notes', rec.description, 5000) || '',
      deletedAt: null,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    }));
  }

  /** Only the fields whose value changed, so an edit to one field can't collide with another device's edit to a different one. */
  function diff(before, after) {
    var patch = {}, any = false;
    Object.keys(after).forEach(function (k) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { patch[k] = after[k]; any = true; }
    });
    return any ? patch : null;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ---- Persistent bits ---------------------------------------------------- */
  function readJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }
  function writeJSON(key, value) {
    try {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) { return false; }
  }

  /* trackerId -> { id: platformId, f: the platform fields last sent or received } */
  var map = { shows: {}, sales: {} };
  function loadMap() {
    var m = readJSON(MAP_KEY);
    map = { shows: (m && m.shows) || {}, sales: (m && m.sales) || {} };
  }
  function saveMap() { writeJSON(MAP_KEY, map); }

  var Session = {
    get: function () { return readJSON(SESSION_KEY); },
    set: function (s) { writeJSON(SESSION_KEY, s); },
    clear: function () { writeJSON(SESSION_KEY, null); }
  };

  /* Review cards persist until the artist deals with them. */
  var Reviews = {
    list: function () { return readJSON(REVIEW_KEY) || []; },
    save: function (cards) { writeJSON(REVIEW_KEY, cards); fire(); },
    add: function (card) {
      var cards = Reviews.list();
      cards.push(card);
      Reviews.save(cards);
    },
    remove: function (id) { Reviews.save(Reviews.list().filter(function (c) { return c.id !== id; })); }
  };

  /* ---- State, events ------------------------------------------------------ */
  var studio = null;
  var state = { state: 'off', pending: 0, email: null, error: null };
  var listeners = [];
  function fire() { listeners.slice().forEach(function (fn) { try { fn(api.status()); } catch (_) {} }); }
  function setState(patch) { Object.assign(state, patch); fire(); }
  /* Pages hear about studio data landing through onData(). A page that
     registers after the data arrived (its module is still loading when the
     first pull finishes) is told straight away, so it never keeps drawing the
     old copy. */
  var dataVersion = 0, dataListeners = [];
  function dataChanged() {
    dataVersion++;
    dataListeners.slice().forEach(function (fn) { try { fn(); } catch (_) {} });
  }

  /* One lane for everything that touches the map, so two quick edits can't interleave. */
  var lane = Promise.resolve();
  function enqueue(fn) {
    var next = lane.then(fn);
    lane = next.catch(function (err) { setState({ error: String((err && err.message) || err) }); });
    return next;
  }

  /* ---- Mirror: tracker -> studio ------------------------------------------ */
  async function mirrorShow(show) {
    if (show.deletedAt) return mirrorShowDelete(show.id);
    var f = toPlatformShow(show);
    if (!f) return null;
    var e = map.shows[show.id];
    var existing = e ? await studio.get('show', e.id) : null;
    if (!existing) {
      var rec = await studio.create('show', f);
      map.shows[show.id] = { id: rec.id, f: f };
    } else {
      var patch = diff(e.f, f);
      if (patch) await studio.update('show', e.id, patch);
      e.f = f;
    }
    saveMap();
    return map.shows[show.id].id;
  }

  async function mirrorShowDelete(trackerId) {
    var e = map.shows[trackerId];
    if (!e) return;
    if (await studio.get('show', e.id)) await studio.remove('show', e.id);
    delete map.shows[trackerId];
    saveMap();
  }

  async function mirrorSale(sale) {
    if (sale.deletedAt) return mirrorSaleDelete(sale.id);
    var f = toPlatformArtwork(sale);
    var e = map.sales[sale.id];
    var existing = e ? await studio.get('artwork', e.id) : null;

    if (!existing) {
      /* The show goes first, so its create is ahead of the sale in the outbox. */
      var showId = null;
      if (sale.showId) {
        var show = await Local.get(sale.showId);
        showId = map.shows[sale.showId] ? map.shows[sale.showId].id : (show ? await mirrorShow(show) : null);
      }
      var priced = f.priceCents !== null;
      /* An unpriced sale is still a sale. mark_sold needs a price, so it is
         created already sold instead (D-033). */
      var art = await studio.create('artwork', Object.assign({}, f, { status: priced ? 'available' : 'sold' }));
      if (priced) await studio.markSold(art.id, showId ? { priceCents: f.priceCents, showId: showId } : { priceCents: f.priceCents });
      map.sales[sale.id] = { id: art.id, f: f };
    } else {
      var patch = diff(e.f, f);
      if (patch) {
        /* The price is also recorded in meta.sale (D-029); keep the two together. */
        if (patch.priceCents !== undefined && existing.meta && existing.meta.sale) {
          var priceMeta = Object.assign({}, f.meta, { sale: Object.assign({}, existing.meta.sale, { priceCents: f.priceCents }) });
          patch.meta = Object.assign({}, existing.meta, priceMeta);
        } else if (patch.meta) {
          patch.meta = Object.assign({}, existing.meta, f.meta);
        }
        await studio.update('artwork', e.id, patch);
      }
      e.f = f;
    }
    saveMap();
  }

  async function mirrorSaleDelete(trackerId) {
    var e = map.sales[trackerId];
    if (!e) return;
    if (await studio.get('artwork', e.id)) await studio.remove('artwork', e.id);
    delete map.sales[trackerId];
    saveMap();
  }

  /* ---- Apply: studio -> tracker ------------------------------------------- */
  async function applyStudio() {
    var changed = false;
    var recs = await studio.list('show');
    var arts = (await studio.list('artwork')).filter(function (a) { return a.meta && a.meta.trackerSale; });

    /* A new device starts on the demo season. Take the studio's real one
       instead — but only if there is one, so the demo isn't wiped for nothing. */
    var shows = recs.map(fromPlatformShow);
    if (Local.isPristineSeed() && shows.length) {
      await Local.adoptRemote(shows);
      recs.forEach(function (r, i) { map.shows[shows[i].id] = { id: r.id, f: toPlatformShow(shows[i]) }; });
      changed = true;
    } else {
      var all = await Local.listAll();
      var byId = {};
      all.forEach(function (s) { byId[s.id] = s; });
      var incoming = [];
      recs.forEach(function (r, i) {
        var theirs = shows[i], id = theirs.id, mine = byId[id], e = map.shows[id];
        var theirsF = toPlatformShow(theirs);
        if (!theirsF) return;
        if (!mine) { incoming.push(theirs); map.shows[id] = { id: r.id, f: theirsF }; return; }
        if (mine.deletedAt) return; /* deleted here; the delete is on its way to the studio */
        var mineF = toPlatformShow(mine);
        if (mineF && same(mineF, theirsF)) { map.shows[id] = { id: r.id, f: theirsF }; return; }
        /* Differs. Take theirs only if this device hasn't edited since it last
           agreed with the studio — an unmirrored local edit is never overwritten. */
        if (e && mineF && same(e.f, mineF)) { incoming.push(theirs); map.shows[id] = { id: r.id, f: theirsF }; }
      });
      if (incoming.length) { await Local.putRaw(incoming); changed = true; }
    }

    /* Gone from the studio -> remove here, but only what this device had mirrored. */
    var live = {};
    recs.forEach(function (r) { live[r.id] = true; });
    for (var tid in map.shows) {
      if (live[map.shows[tid].id]) continue;
      var gone = await Local.get(tid); /* live rows only */
      delete map.shows[tid];
      if (gone) { await Local.remove(tid); changed = true; }
    }

    var sales = await Local.listAllSales();
    var salesById = {};
    sales.forEach(function (s) { salesById[s.id] = s; });
    var liveArt = {};
    for (var i = 0; i < arts.length; i++) {
      var rec = arts[i];
      liveArt[rec.id] = true;
      var theirsSale = fromPlatformArtwork(rec), sid = theirsSale.id, mineSale = salesById[sid], es = map.sales[sid];
      var theirsSF = toPlatformArtwork(theirsSale);
      if (!mineSale) { await Local.upsertSale(theirsSale); map.sales[sid] = { id: rec.id, f: theirsSF }; changed = true; continue; }
      if (mineSale.deletedAt) continue; /* deleted here; the delete is on its way */
      var mineSF = toPlatformArtwork(mineSale);
      if (same(mineSF, theirsSF)) { map.sales[sid] = { id: rec.id, f: theirsSF }; continue; }
      if (es && same(es.f, mineSF)) { await Local.upsertSale(theirsSale); map.sales[sid] = { id: rec.id, f: theirsSF }; changed = true; }
    }
    for (var sid2 in map.sales) {
      if (liveArt[map.sales[sid2].id]) continue;
      var goneSale = salesById[sid2];
      delete map.sales[sid2];
      if (goneSale && !goneSale.deletedAt) { await Local.removeSale(sid2); changed = true; }
    }

    saveMap();
    if (changed) dataChanged();
  }

  /* ---- The backend the app's Store uses ----------------------------------- */
  function track(fn) {
    return enqueue(fn).then(function () { return refreshPending(); }, function () { return refreshPending(); });
  }
  function refreshPending() {
    return studio ? studio.pendingCount().then(function (n) { setState({ pending: n }); }) : Promise.resolve();
  }

  var backend = {
    list: function () { return Local.list(); },
    get: function (id) { return Local.get(id); },
    upsert: function (show) {
      return Local.upsert(show).then(function (rec) { track(function () { return mirrorShow(rec); }); return rec; });
    },
    remove: function (id) {
      return Local.remove(id).then(function (before) {
        if (before) track(function () { return mirrorShowDelete(id); });
        return before;
      });
    },
    replaceAll: function (shows) {
      return Local.replaceAll(shows).then(function (rows) {
        track(async function () {
          var keep = {};
          rows.forEach(function (s) { keep[s.id] = true; });
          for (var tid in map.shows) if (!keep[tid]) await mirrorShowDelete(tid);
          for (var i = 0; i < rows.length; i++) await mirrorShow(rows[i]);
        });
        return rows;
      });
    },
    upsertSale: function (sale) {
      return Local.upsertSale(sale).then(function (rec) { track(function () { return mirrorSale(rec); }); return rec; });
    },
    removeSale: function (id) {
      return Local.removeSale(id).then(function (before) {
        if (before) track(function () { return mirrorSaleDelete(id); });
        return before;
      });
    }
  };

  /* ---- Review cards -------------------------------------------------------- */
  var FIELD_LABEL = { name: 'Name', city: 'City', startsOn: 'Start date', endsOn: 'End date', feeCents: 'Booth fee',
                      status: 'Status', notes: 'Notes', meta: 'Other details', title: 'Piece', priceCents: 'Price',
                      medium: 'Medium', description: 'Notes' };
  function newCardId() { return 'rc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  function onConflict(e) {
    var rec = e.record || {};
    var label = e.entityType === 'show' ? (rec.name || 'A show') : (rec.title || 'A sale');
    Reviews.add({
      id: newCardId(), at: new Date().toISOString(), entityType: e.entityType, entityId: e.entityId, label: label,
      conflicts: e.conflicts.map(function (c) {
        return { field: c.field, label: FIELD_LABEL[c.field] || c.field, serverValue: c.serverValue, deviceValue: c.deviceValue };
      })
    });
  }
  function onRejected(e) {
    Reviews.add({
      id: newCardId(), at: new Date().toISOString(), entityType: e.entityType, entityId: e.entityId,
      label: 'A change was refused', rejected: e.message, conflicts: []
    });
  }

  /** "Use mine": send the device's values again. The server applies them on top of its own now. */
  function useMine(cardId) {
    var card = Reviews.list().filter(function (c) { return c.id === cardId; })[0];
    if (!card || !studio) return Promise.resolve();
    var patch = {};
    card.conflicts.forEach(function (c) { patch[c.field] = c.deviceValue; });
    return enqueue(async function () {
      if (Object.keys(patch).length && await studio.get(card.entityType, card.entityId)) {
        await studio.update(card.entityType, card.entityId, patch);
      }
      Reviews.remove(cardId);
      await applyStudio();
    });
  }
  function keepTheirs(cardId) { Reviews.remove(cardId); return Promise.resolve(); }

  /* ---- Connect -------------------------------------------------------------- */
  function onStudioChange(e) {
    if (e.types.indexOf('show') === -1 && e.types.indexOf('artwork') === -1) return;
    enqueue(applyStudio).then(refreshPending);
  }

  function isAuthError(err) { return err && (err.status === 401 || err.status === 403); }
  function onSyncError(err) {
    if (isAuthError(err)) setState({ state: 'signed_out', error: 'Sign in again to keep syncing.' });
    else setState({ error: String((err && err.message) || err) });
  }

  /**
   * Opens the device's studio copy and starts syncing. Needs a session
   * ({ apiUrl, studioId, email }) from Session.get() or the sign-in flow.
   */
  async function connect(opts) {
    opts = opts || {};
    var sess = opts.session || Session.get();
    var SDK = window.StudioSDK;
    if (!sess || !sess.apiUrl || !sess.studioId || !SDK) { setState({ state: 'off' }); return null; }
    if (studio) return api;

    loadMap();
    studio = await SDK.Studio.open({
      baseUrl: sess.apiUrl, dbName: opts.dbName || 'artShowTracker-' + sess.studioId, fetch: opts.fetch
    });
    studio.on('change', onStudioChange);
    studio.on('conflict', onConflict);
    studio.on('rejected', onRejected);
    studio.on('status', function (s) {
      if (s.online) setState({ state: 'online', pending: s.pending, error: null });
      else setState({ state: 'offline', pending: s.pending });
    });
    studio.on('error', function (e) { onSyncError(e.error); });

    /* Anything already in this device's copy shows up before the first sync. */
    await enqueue(applyStudio);

    /* A Supabase backend, if one was configured, keeps the Store. */
    if (A.currentStore() === Local) A.useStore(backend);
    setState({ state: navigator.onLine === false ? 'offline' : 'online', email: sess.email || null });
    studio.start(opts.intervalMs);
    refreshPending();
    return api;
  }

  async function disconnect() {
    if (studio) { studio.close(); studio = null; }
    if (A.currentStore() === backend) A.useStore(null);
    setState({ state: 'off', pending: 0 });
  }

  var api = {
    status: function () { return Object.assign({ reviews: Reviews.list().length }, state); },
    onData: function (fn) { dataListeners.push(fn); if (dataVersion) { try { fn(); } catch (_) {} } },
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    connect: connect, disconnect: disconnect,
    sync: function () { return studio ? studio.sync().catch(onSyncError) : Promise.resolve(); },
    /** The raw SDK handle, for sign-in and tests. */
    studio: function () { return studio; },
    backend: backend,
    Session: Session, Reviews: Reviews, useMine: useMine, keepTheirs: keepTheirs,
    /* exposed for tests */
    toPlatformShow: toPlatformShow, fromPlatformShow: fromPlatformShow,
    toPlatformArtwork: toPlatformArtwork, fromPlatformArtwork: fromPlatformArtwork,
    _flush: function () { return lane; }
  };
  return api;
})();
