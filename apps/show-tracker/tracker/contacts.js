/* ============================================================================
   contacts.js — collectors, follow-ups and the post-show debrief.
   Publishes `ASTContacts`. DOM-free like pipeline.js, expenses.js and
   sales.js, so a phone app can reuse it.

   This is §7 Stage 4 (ideas 20 and 22). It was staged last on purpose: a CRM
   with no sales history behind it is an address book. Four rules.

   1. OTHER PEOPLE'S DETAILS STAY ON THIS DEVICE. Contacts never go to a sync
      backend (core.js pins them to LocalStore). The only way out is `toCsv`,
      which the artist runs by hand, and it leaves out anyone who said no.

   2. NOTHING IS SENT. A follow-up date is a note to the artist, not a
      message. There is no email, text or push channel in this project, and
      every place a follow-up is shown says so. Nothing claims to have gone.

   3. "DID NOT ASK" IS NOT YES. Consent has three states. Somebody marked
      "do not contact" never appears in the due list and never exports.

   4. A DEBRIEF IS THE ARTIST'S OWN ANSWERS. Skipped answers stay null and
      drop out; nothing is defaulted. The P&L it hands back is
      ASTExpenses.showResult — the same arithmetic as the Money page, not a
      second copy of it — and carries that function's partial/provisional
      flags unchanged.
   ==========================================================================*/
var ASTContacts = (function () {
  'use strict';

  function live(rows) {
    return (rows || []).filter(function (r) { return r && !r.deletedAt; });
  }
  function isoToday(today) {
    if (typeof today === 'string') return today;
    var d = today || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  /* A loose check. The point is to catch a phone number typed into the email
     box, not to validate RFC 5322. */
  function looksLikeEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  function forShow(contacts, showId) {
    return live(contacts).filter(function (c) { return c.showId === showId; });
  }

  /**
   * The follow-up list. `due` is on or before today and not yet done;
   * `upcoming` is later. Anyone marked "do not contact" is held out and
   * counted in `withheld`, so a date set before they said no is not lost
   * silently but is never offered as a task either.
   */
  function followUps(contacts, today) {
    var t = isoToday(today);
    var due = [], upcoming = [], withheld = 0;
    live(contacts).forEach(function (c) {
      if (!c.followUpOn || c.followedUpAt) return;
      if (c.consent === 'no') { withheld++; return; }
      (c.followUpOn <= t ? due : upcoming).push(c);
    });
    var byDate = function (a, b) { return a.followUpOn.localeCompare(b.followUpOn); };
    return { due: due.sort(byDate), upcoming: upcoming.sort(byDate), withheld: withheld };
  }

  /** The line every follow-up list carries. One wording, testable. */
  var NO_CHANNEL = 'Reminders only — this app sends nothing. Nothing has been emailed ' +
    'or texted to anyone; the list is where you will see who is due.';

  /**
   * What a contact's linked sale rows come to. Uses ASTSales.sum when it is
   * loaded, so there is one definition of what a sale row is worth.
   * A link to a deleted or missing row is counted as `missing`, not dropped.
   */
  function purchases(contact, sales) {
    var S = (typeof window !== 'undefined' && window.ASTSales) || null;
    var byId = {};
    live(sales).forEach(function (s) { byId[s.id] = s; });
    var rows = [], missing = 0;
    (contact && contact.saleIds || []).forEach(function (id) {
      if (byId[id]) rows.push(byId[id]); else missing++;
    });
    return { rows: rows, missing: missing, sum: S ? S.sum(rows) : null };
  }

  /** Per-show summary for the show picker and the debrief card. */
  function summary(contacts, showId) {
    var rows = showId ? forShow(contacts, showId) : live(contacts);
    var n = function (f) { return rows.filter(f).length; };
    return {
      total: rows.length,
      bought: n(function (c) { return c.outcome === 'bought'; }),
      interested: n(function (c) { return c.outcome === 'interested' || c.outcome === 'commission'; }),
      mayContact: n(function (c) { return c.consent === 'yes'; }),
      doNotContact: n(function (c) { return c.consent === 'no'; }),
      notAsked: n(function (c) { return !c.consent; })
    };
  }

  /* ---- export ------------------------------------------------------------ */

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    /* A leading = + - @ turns a cell into a formula in a spreadsheet. Other
       people typed some of these fields, so defuse it. */
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * The only way a contact leaves the device. Anyone marked "do not contact"
   * is left out and counted; "did not ask" is kept but labelled as such, so
   * the artist decides rather than the file.
   */
  function toCsv(contacts, shows) {
    var name = {};
    (shows || []).forEach(function (s) { name[s.id] = s.name; });
    var A = (typeof window !== 'undefined' && window.AST) || {};
    var outcomeLabel = A.CONTACT_OUTCOME_LABEL || {};
    var consentLabel = A.CONSENT_LABEL || {};
    var rows = live(contacts);
    var kept = rows.filter(function (c) { return c.consent !== 'no'; });
    var head = ['Name', 'Email', 'Phone', 'Show', 'Met on', 'Looked at', 'Outcome',
                'May contact', 'Follow up on', 'Followed up', 'Notes'];
    var lines = [head.join(',')].concat(kept.map(function (c) {
      return [c.name, c.email, c.phone, name[c.showId] || '', c.metOn, c.interest,
              outcomeLabel[c.outcome] || c.outcome, consentLabel[c.consent] || c.consent,
              c.followUpOn, c.followedUpAt, c.notes].map(csvCell).join(',');
    }));
    return { csv: lines.join('\r\n') + '\r\n', exported: kept.length,
             withheld: rows.length - kept.length };
  }

  /* ---- the debrief (idea 22) --------------------------------------------- */

  var DEBRIEF_SCORES = [
    { key:'buyers',       label:'Buyers who could afford your work' },
    { key:'traffic',      label:'People who stopped and looked' },
    { key:'loadIn',       label:'Load-in and load-out (10 = easy)' },
    { key:'organisation', label:'How well the show was run' }
  ];

  function debriefFor(debriefs, showId, cycle) {
    var hit = live(debriefs).filter(function (d) {
      return d.showId === showId && (!cycle || !d.cycle || d.cycle === cycle);
    });
    return hit.length ? hit[hit.length - 1] : null;
  }

  /**
   * Shows that have finished and have no debrief yet — the prompt list.
   * Only shows you were accepted into: a show you never did has nothing to
   * debrief. Most recent first.
   */
  function awaitingDebrief(shows, debriefs, today) {
    var t = isoToday(today);
    return live(shows).filter(function (s) {
      var end = s.endDate || s.startDate;
      return s.status === 'accepted' && end && end < t &&
        !debriefFor(debriefs, s.id, (s.startDate || '').slice(0, 4));
    }).sort(function (a, b) {
      return (b.endDate || b.startDate).localeCompare(a.endDate || a.startDate);
    });
  }

  /** How many of the scored answers were given. Skipped ones are not zeros. */
  function answered(d) {
    if (!d) return { scored: 0, of: DEBRIEF_SCORES.length };
    var n = DEBRIEF_SCORES.filter(function (f) { return d[f.key] != null; }).length;
    return { scored: n, of: DEBRIEF_SCORES.length };
  }

  /**
   * The artist's own P&L back, for one show. Delegates to ASTExpenses and
   * ASTSales so the Money page and the debrief can never disagree.
   * Returns null when those modules are not loaded rather than guessing.
   */
  function pnl(show, expenses, sales) {
    var X = typeof window !== 'undefined' && window.ASTExpenses;
    var S = typeof window !== 'undefined' && window.ASTSales;
    if (!X || !S || !show) return null;
    return X.showResult(expenses, show.id, {
      grossSales: show.grossSales,
      salesSummary: S.sum(S.forShow(sales, show.id))
    });
  }

  return {
    looksLikeEmail: looksLikeEmail,
    forShow: forShow,
    followUps: followUps,
    NO_CHANNEL: NO_CHANNEL,
    purchases: purchases,
    summary: summary,
    toCsv: toCsv,
    DEBRIEF_SCORES: DEBRIEF_SCORES,
    debriefFor: debriefFor,
    awaitingDebrief: awaitingDebrief,
    answered: answered,
    pnl: pnl
  };
})();
if (typeof window !== 'undefined') window.ASTContacts = ASTContacts;
