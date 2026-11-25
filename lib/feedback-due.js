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

  /* Employee identity is carried by the existing Staffing/Coordinators feed.
   * Phone is only an optional, changeable UI discriminator, never a durable ID.
   * No phone or worker ID is written to Dashboard's name-only feedback action. */
  function workerId(e) {
    // A generic id can be an assignment ID or a row/event ID. Never mistake
    // it for HR workers.id unless its kind was explicitly specified.
    return String(e && (e.workerId || e.employeeId || (e.idKind === 'worker' ? e.id : '')) || '').trim();
  }
  /* Dashboard #415 worker identity v2 (docs/worker-identity-v2.md). The
   * Dashboard projects BOTH ids on a staff row only from a certified
   * `managers-house-v2` publication, so the pair is the only identity a
   * personal write may carry. employeeId / idKind are NOT accepted here. */
  var V2_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
  function certifiedIdentity(e) {
    var w = e && e.workerId, a = e && e.assignmentId;
    return typeof w === 'string' && typeof a === 'string' && V2_ID_RE.test(w) && V2_ID_RE.test(a)
      ? { workerId: w, assignmentId: a } : null;
  }
  /* The certified pair of ONE roster row, or null when this house's roster
   * cannot tell it apart: the same assignment twice, or one worker with two
   * assignments in the same house (the Dashboard would refuse either). */
  function uniqueIdentity(e, roster) {
    var c = certifiedIdentity(e);
    if (!c) return null;
    var people = activeRoster(roster);
    var sameAssignment = people.filter(function (x) { var o = certifiedIdentity(x); return o && o.assignmentId === c.assignmentId; });
    var sameWorker = people.filter(function (x) { var o = certifiedIdentity(x); return o && o.workerId === c.workerId; });
    return sameAssignment.length === 1 && sameWorker.length === 1 ? c : null;
  }
  /* Which identity a staff talk may be saved under (pure; work.js submits it).
   *   roster   houseData.team.staff (fresh — the caller checks staleness)
   *   name     the employee name in the form
   *   parent   the thread's first talk for a follow-up / outcome, else null
   *   picked   { workerId, assignmentId } set by the employee card, else null
   * → { ok:true, name, workerId?, assignmentId? } or { ok:false, reason }.
   * Never guesses: a certified worker needs the exact pair; a name shared by
   * two people, or an id that is not certified, is refused. */
  function talkIdentity(roster, name, parent, picked) {
    var people = activeRoster(roster);
    if (parent) {
      var pc = certifiedIdentity(parent);
      if (pc) {
        // A rename keeps the ids: follow the pair, send the CURRENT roster name.
        var same = people.filter(function (x) { var o = certifiedIdentity(x); return o && o.workerId === pc.workerId && o.assignmentId === pc.assignmentId; });
        if (same.length !== 1 || !uniqueIdentity(same[0], people)) return { ok: false, reason: 'identity_review' };
        return { ok: true, name: normName(same[0].name), workerId: pc.workerId, assignmentId: pc.assignmentId };
      }
      if (parent.workerId || parent.assignmentId || parent.employeeId) return { ok: false, reason: 'identity_review' };
      // A legacy name-only thread stays name-only; it never adopts a certified id.
    }
    var matches = people.filter(function (x) { return normName(x.name) === normName(name); });
    var pick = certifiedIdentity(picked);
    if (pick) {
      var exact = matches.filter(function (x) { var o = certifiedIdentity(x); return o && o.workerId === pick.workerId && o.assignmentId === pick.assignmentId; });
      if (exact.length !== 1 || !uniqueIdentity(exact[0], people)) return { ok: false, reason: 'identity_review' };
      if (parent) return { ok: false, reason: 'identity_review' };
      return { ok: true, name: normName(name), workerId: pick.workerId, assignmentId: pick.assignmentId };
    }
    if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
    if (matches.length === 1) {
      var c = uniqueIdentity(matches[0], people);
      if (c) {
        if (parent) return { ok: false, reason: 'identity_review' };
        return { ok: true, name: normName(name), workerId: c.workerId, assignmentId: c.assignmentId };
      }
      if (workerId(matches[0]) || matches[0].assignmentId) return { ok: false, reason: 'identity_review' };
    }
    return { ok: true, name: normName(name) };   // the unchanged legacy name-only path
  }
  function validPhone(e) {
    var raw = String(e && (e.phone || e.mobile) || '').trim().replace(/[\s().-]/g, '');
    if (/^\+972\d{9}$/.test(raw)) raw = '0' + raw.slice(4);
    else if (/^972\d{9}$/.test(raw)) raw = '0' + raw.slice(3);
    return /^0\d{8,9}$/.test(raw) ? raw : '';
  }
  function activeRoster(roster) {
    return (Array.isArray(roster) ? roster : []).filter(function (e) {
      return e && e.active !== false && String(e.active).toLowerCase() !== 'false' && normName(e.name);
    });
  }
  function employeeRef(e, roster) {
    if (!e) return '';
    var people = activeRoster(roster), name = normName(e.name);
    var id = workerId(e), phone = validPhone(e);
    if (id && people.filter(function (x) { return workerId(x) === id; }).length === 1) return 'wid:' + encodeURIComponent(id);
    if (people.filter(function (x) { return normName(x.name) === name; }).length === 1) return name;
    if (phone && people.filter(function (x) { return validPhone(x) === phone; }).length === 1) return 'phone:' + phone;
    return ''; // cannot open an employee-specific card without a unique discriminator
  }
  function resolveEmployee(roster, ref) {
    var people = activeRoster(roster), value = String(ref == null ? '' : ref);
    var matched;
    if (value.indexOf('wid:') === 0) {
      var id;
      try { id = decodeURIComponent(value.slice(4)); } catch (e) { return null; }
      matched = people.filter(function (x) { return workerId(x) && workerId(x) === id; });
    } else if (value.indexOf('phone:') === 0) {
      var phone = value.slice(6);
      if (!/^0\d{8,9}$/.test(phone)) return null;
      matched = people.filter(function (x) { return validPhone(x) === phone; });
    } else {
      matched = people.filter(function (x) { return normName(x.name) === normName(value); });
    }
    return matched.length === 1 ? matched[0] : null;
  }

  /* One row per distinct worker ID or legacy roster record. Never merge a
   * same-name pair just because their label matches. Historical name-only
   * feedback can be attributed ONLY to a unique name without a worker ID.
   * ID-bearing log rows are matched only by verified ID, never by name.
   * Phone-matched logs (if a future source supplies them) need both a unique
   * phone and the same name; they never migrate old name-only history. */
  function houseFeedback(roster, logRows, today) {
    var t = isRealIso(today) ? today : israelToday();
    var people = [], seenId = Object.create(null), nameCounts = Object.create(null), phoneCounts = Object.create(null);
    activeRoster(roster).forEach(function (e) {
      var id = workerId(e), name = normName(e.name), phone = validPhone(e);
      if (id && seenId[id]) return;
      if (id) seenId[id] = true;
      people.push(e);
      nameCounts[name] = (nameCounts[name] || 0) + 1;
      if (phone) phoneCounts[phone] = (phoneCounts[phone] || 0) + 1;
    });
    var byId = Object.create(null), byPhoneName = Object.create(null), legacy = [];
    (Array.isArray(logRows) ? logRows : []).forEach(function (r) {
      if (!r) return;
      var id = workerId({ workerId: r.workerId, employeeId: r.employeeId });
      var phone = validPhone({ phone: r.employeePhone || r.phone });
      var name = normName(r.employee), at = String(r.doneAt || '').slice(0, 10);
      if (!isRealIso(at) || at > t) return;
      if (id) {
        if (!byId[id] || at > byId[id]) byId[id] = at;
      } else if (phone && name) {
        var key = phone + '|' + name;
        if (!byPhoneName[key] || at > byPhoneName[key]) byPhoneName[key] = at;
      } else {
        legacy.push(r);
      }
    });
    var lastNames = lastFeedbackBy(legacy, t);
    var list = people.map(function (e) {
      var name = normName(e.name), id = workerId(e), phone = validPhone(e);
      var onlyName = nameCounts[name] === 1, onlyPhone = phone && phoneCounts[phone] === 1;
      var last = id ? (byId[id] || '') : ((onlyPhone && byPhoneName[phone + '|' + name]) || (onlyName ? lastNames[name] || '' : ''));
      var result = dueFor(e, last, t);
      if (id) result.employeeId = id;
      if (phone) result.phoneSuffix = phone.slice(-4);
      result.identityAmbiguous = !onlyName;
      // Dashboard #415 v2: a certified, house-unique workerId + assignmentId
      // pair is the write identity — two people with one name stay two rows,
      // each with its own pair. Without it the legacy rule is unchanged: a
      // unique name with no id at all, never a name shared or an uncertified id.
      var cert = uniqueIdentity(e, roster);
      if (cert) { result.workerId = cert.workerId; result.assignmentId = cert.assignmentId; }
      result.writeBlocked = cert ? false : (!onlyName || !!id);
      result.ref = employeeRef(e, people);
      return result;
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
    lastFeedbackBy: lastFeedbackBy, dueFor: dueFor, houseFeedback: houseFeedback, validDoneAt: validDoneAt, normName: normName,
    workerId: workerId, certifiedIdentity: certifiedIdentity, uniqueIdentity: uniqueIdentity, talkIdentity: talkIdentity, validPhone: validPhone, activeRoster: activeRoster, employeeRef: employeeRef, resolveEmployee: resolveEmployee
  };
  root.FeedbackDue = FeedbackDue;
  if (typeof module === 'object' && module.exports) module.exports = FeedbackDue;
}(typeof self !== 'undefined' ? self : this));
