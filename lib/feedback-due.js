/* Half-yearly feedback «משוב» — pure date logic (20 Oct 2026, docs/feedback-reminders.md).
 *
 * For each employee of the house: the next feedback is due FEEDBACK_MONTHS (6)
 * calendar months after the last recorded feedback, or after the start date
 * when there is none yet. Month ends clamp: 31 Aug + 6 months = 28/29 Feb
 * (never rolls into March). No start date and no feedback → status 'unknown'
 * (never a guessed date). Inactive employees are left out.
 *   status: 'overdue' (due < today, red) · 'soon' (today ≤ due ≤ today+30) ·
 *           'ok' (later) · 'unknown' (no anchor date).
 * UMD: browser `window.FeedbackDue` + node --test. No I/O, no clock unless
 * `today` is omitted (then Asia/Jerusalem). */
(function (root) {
  'use strict';

  var FEEDBACK_MONTHS = 6;
  var SOON_DAYS = 30;
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isRealIso(s) {
    var m = ISO_RE.exec(String(s == null ? '' : s));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function israelToday(now) {
    var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    var get = function (t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value; return ''; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  /* `date` + n calendar months, clamped to the last day of the target month. */
  function addMonths(date, n) {
    if (!isRealIso(date)) return '';
    var m = ISO_RE.exec(date);
    var y = +m[1], mo = +m[2] - 1 + (n | 0), d = +m[3];
    var ty = y + Math.floor(mo / 12), tm = ((mo % 12) + 12) % 12;
    var last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(ty, tm, Math.min(d, last))));
  }
  function addDays(date, n) {
    if (!isRealIso(date)) return '';
    var m = ISO_RE.exec(date);
    return iso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (n | 0))));
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function normName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* The latest feedback date per employee name from FeedbackLog rows [{ employee, doneAt }].
   * Future dates and invalid dates are ignored. */
  function lastFeedbackBy(rows, today) {
    var out = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      var name = normName(r.employee), at = String(r.doneAt || '').slice(0, 10);
      if (!name || !isRealIso(at) || (today && at > today)) return;
      if (!out[name] || at > out[name]) out[name] = at;
    });
    return out;
  }

  /* One employee → { name, startDate, lastFeedback, anchor, due, daysLeft, status }. */
  function dueFor(emp, last, today) {
    var name = normName(emp && emp.name);
    var start = isRealIso(emp && emp.startDate) ? emp.startDate : '';
    var lf = isRealIso(last) ? last : '';
    var anchor = lf || start;
    var o = { name: name, startDate: start, lastFeedback: lf, anchor: anchor, due: '', daysLeft: null, status: 'unknown' };
    if (!anchor) return o;
    o.due = addMonths(anchor, FEEDBACK_MONTHS);
    o.daysLeft = dayDiff(today, o.due);
    o.status = o.daysLeft < 0 ? 'overdue' : (o.daysLeft <= SOON_DAYS ? 'soon' : 'ok');
    return o;
  }

  /* The house's roster → sorted list: overdue (most overdue first), soon, ok, then unknown.
   * roster: [{ name, startDate?, active? }] — active === false (or 'false') is left out;
   * duplicates by name are merged (first one wins). */
  function houseFeedback(roster, logRows, today) {
    var t = isRealIso(today) ? today : israelToday();
    var last = lastFeedbackBy(logRows, t);
    var seen = {}, list = [];
    (Array.isArray(roster) ? roster : []).forEach(function (e) {
      if (!e) return;
      if (e.active === false || String(e.active).toLowerCase() === 'false') return;
      var name = normName(e.name);
      if (!name || seen[name]) return;
      seen[name] = true;
      list.push(dueFor(e, last[name], t));
    });
    var rank = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
    list.sort(function (a, b) {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return {
      today: t, items: list,
      overdue: list.filter(function (x) { return x.status === 'overdue'; }).length,
      soon: list.filter(function (x) { return x.status === 'soon'; }).length,
      unknown: list.filter(function (x) { return x.status === 'unknown'; }).length
    };
  }

  /* A «בוצע» date the manager may record: a real date, not in the future, not before 2000. */
  function validDoneAt(s, today) {
    var t = isRealIso(today) ? today : israelToday();
    return isRealIso(s) && s <= t && s >= '2000-01-01';
  }

  var FeedbackDue = {
    FEEDBACK_MONTHS: FEEDBACK_MONTHS, SOON_DAYS: SOON_DAYS,
    isRealIso: isRealIso, israelToday: israelToday, addMonths: addMonths, addDays: addDays, dayDiff: dayDiff,
    lastFeedbackBy: lastFeedbackBy, dueFor: dueFor, houseFeedback: houseFeedback, validDoneAt: validDoneAt, normName: normName
  };
  root.FeedbackDue = FeedbackDue;
  if (typeof module === 'object' && module.exports) module.exports = FeedbackDue;
}(typeof self !== 'undefined' ? self : this));
