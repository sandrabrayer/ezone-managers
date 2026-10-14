/* Bonus VIEW model — month labelling, wording and the single "days so far"
   figure. Pure functions, no DOM, no network.

   Loaded by the browser as /bonus-view.js (after /lib/bonus-eligibility.js)
   and by Node for tests (require('../public/bonus-view')).

   Rules this module enforces (see docs/bonus-month-labelling.md):

     1. Every bonus figure names its month explicitly. Two separate blocks:
          - "בונוס <חודש קודם> — סופי (לתשלום)"   → settled, final state only
          - "<חודש נוכחי> — חודש נוכחי (בתהליך)"  → running month
     2. A settled month never says "בדרך" / "בתהליך" / "חסרים".
     3. The running month shows ACTUAL days-so-far (from the 1st) and a
        separately labelled "צפי לסוף החודש" projection — never mixed.
     4. A tier is shown as achieved only when settled-and-met (or locked in).
        Otherwise: "מדרגה הבאה: N (P מטופלים/יום) · ממוצע נוכחי X".
     5. Days-so-far is computed ONCE (daysSoFar) and reused by every render.
     6. No backend bonus field is ever rendered — all math is local
        (lib/bonus-eligibility.js); raw payload strings are sanitised.

   The bonus MATH itself stays in lib/bonus-eligibility.js — this module only
   decides how it is labelled and worded. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../lib/bonus-eligibility'));
  } else {
    root.BonusView = factory(root.BonusEligibility);
  }
}(typeof self !== 'undefined' ? self : this, function (BE) {
  'use strict';

  var HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  /* Words that must NEVER appear on a settled (finished) month. */
  var FORBIDDEN_SETTLED_WORDS = ['בדרך', 'בתהליך', 'חסרים'];

  /* Backend bonus fields the UI must ignore. Listed so tests can assert that
     none of their values ever reach the DOM. */
  var IGNORED_BACKEND_FIELDS = [
    'projectedBonus', 'lockedIn', 'qualifies', 'bep', 'bonusAmount',
    'monthlyBonus', 'quarterlyBonus', 'quarterlyEarned', 'quarterlyMonthsMet',
    'paceAvgDaily', 'projectedTier', 'securedTier', 'tier', 'amount', 'total'
  ];

  /* ── formatting ─────────────────────────────────────────── */
  function fmtCurrency(n) {
    var num = Number(n) || 0;
    return num.toLocaleString('he-IL', { maximumFractionDigits: 0 }) + ' ₪';
  }
  function fmtInt(n) {
    return (Number(n) || 0).toLocaleString('he-IL');
  }
  function fmtNum1(v) {
    var n = Number(v) || 0;
    return (Math.round(n * 10) / 10).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }

  /* ── month helpers ──────────────────────────────────────── */
  function ymParts(ym) {
    var m = /^(\d{4})-(\d{1,2})/.exec(String(ym || ''));
    if (!m) return null;
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }
  function ymOf(d) {
    var m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m);
  }
  function prevMonth(ym) {
    var p = ymParts(ym);
    if (!p) return '';
    var d = new Date(p.year, p.month - 2, 1);
    return ymOf(d);
  }
  function daysInMonth(ym) {
    var p = ymParts(ym);
    if (!p) return 30;
    return new Date(p.year, p.month, 0).getDate();
  }
  function monthLabel(ym) {
    var p = ymParts(ym);
    if (!p) return String(ym || '');
    var idx = Math.max(0, Math.min(11, p.month - 1));
    return HEBREW_MONTHS[idx] + ' ' + p.year;
  }
  /* Local (not UTC) YYYY-MM-DD key — toISOString shifts dates near midnight. */
  function dateKey(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  /* Every month from `toYm` back to `fromYm` (both inclusive), NEWEST first —
     the option list of the bonus-history month picker: the running month
     plus every finished month since the quarterly anchor. [] for bad input
     or when `fromYm` is after `toYm`. */
  function monthsBetween(fromYm, toYm) {
    var a = ymParts(fromYm), b = ymParts(toYm);
    if (!a || !b) return [];
    var out = [];
    var cursor = new Date(b.year, b.month - 1, 1);
    var floor = a.year * 12 + (a.month - 1);
    while (cursor.getFullYear() * 12 + cursor.getMonth() >= floor) {
      out.push(ymOf(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    }
    return out;
  }

  /* ── payload sanitising ─────────────────────────────────── */
  /* A display label taken from the feed (manager / type / name) must be a
     non-empty string that is NOT a bare number or amount. Anything numeric
     (e.g. a backend bonus figure that leaked into a text field) is dropped so
     it can never appear under the manager name. */
  function safeLabel(v) {
    if (typeof v === 'number') return '';
    if (typeof v !== 'string') return '';
    var s = v.trim();
    if (!s) return '';
    if (/^[\d\s.,₪%\-+]+$/.test(s)) return '';
    return s;
  }

  /* ── days so far (single source of truth) ───────────────── */
  /**
   * Treatment-days accrued SO FAR this month, computed ONE way for every
   * render (KPI, hero, progress bar, house card).
   *
   *   1. If a dailyChart is available, sum its counts up to todayKey
   *      (future days are skipped for the current month). This is the honest
   *      figure — stays dated for the whole month up front do not inflate it.
   *   2. Otherwise fall back to the feed's treatmentDaysSoFar / treatmentDays,
   *      capped at elapsedDays × capacity for the current month (a house can
   *      never accrue more days than beds × elapsed days).
   *
   * Finished months are never capped: their treatmentDays is the settled total.
   */
  function daysSoFar(input) {
    var o = input || {};
    var chart = Array.isArray(o.dailyChart) ? o.dailyChart : null;
    var isCurrent = o.isCurrentMonth !== false;
    if (chart && chart.length) {
      var todayKey = o.todayKey || '';
      var sum = 0;
      for (var i = 0; i < chart.length; i++) {
        var p = chart[i] || {};
        var d = p.date ? String(p.date) : '';
        if (isCurrent && todayKey && d > todayKey) continue;
        sum += Number(p.count) || 0;
      }
      return sum;
    }
    var raw = Number.isFinite(o.treatmentDaysSoFar) ? o.treatmentDaysSoFar
            : Number.isFinite(o.treatmentDays) ? o.treatmentDays : 0;
    raw = Math.max(0, raw);
    if (!isCurrent) return raw;
    var elapsed = Number(o.elapsedDays), cap = Number(o.capacity);
    if (elapsed > 0 && cap > 0) return Math.min(raw, elapsed * cap);
    return raw;
  }

  /* ── tiers ──────────────────────────────────────────────── */
  /* Tier table of a house for a month (ascending). The rules are
     month-aware: `ym` picks the rule set; no month → the current rules. */
  function tiersAscFor(key, ym) {
    var cfg = BE.rulesFor ? BE.rulesFor(key, ym) : (BE.HOUSE_BONUS || {})[key];
    var tiers = cfg && Array.isArray(cfg.tiers) ? cfg.tiers.slice() : [];
    return tiers.sort(function (a, b) { return a.patients - b.patients; });
  }

  /**
   * Tier badge rules:
   *   - achievedTier > 0 → the caller has established the tier is SETTLED &
   *     met (or locked in mid-month). Text: "מדרגה N · X ₪".
   *   - otherwise → NEVER a tier as status. Text names the NEXT tier and the
   *     current average: "מדרגה הבאה: N (P מטופלים/יום) · ממוצע נוכחי X".
   */
  function tierBadgeView(o) {
    var opts = o || {};
    var achievedTier = Number(opts.achievedTier) || 0;
    if (achievedTier > 0) {
      return {
        achieved: true,
        tier: achievedTier,
        amount: Number(opts.achievedAmount) || 0,
        text: 'מדרגה ' + achievedTier + (opts.achievedAmount ? ' · ' + fmtCurrency(opts.achievedAmount) : '')
      };
    }
    var avg = Number(opts.avgDaily) || 0;
    var tiers = tiersAscFor(opts.key, opts.ym);
    var next = null, nextIdx = 0;
    for (var i = 0; i < tiers.length; i++) {
      if (avg < tiers[i].patients) { next = tiers[i]; nextIdx = i + 1; break; }
    }
    if (!next && tiers.length) { next = tiers[tiers.length - 1]; nextIdx = tiers.length; }
    return {
      achieved: false,
      tier: 0,
      nextTier: nextIdx,
      nextPatients: next ? next.patients : 0,
      nextAmount: next ? next.amount : 0,
      avgDaily: avg,
      text: next
        ? 'מדרגה הבאה: ' + nextIdx + ' (' + fmtInt(next.patients) + ' מטופלים/יום) · ממוצע נוכחי ' + fmtNum1(avg)
        : 'ממוצע נוכחי ' + fmtNum1(avg)
    };
  }

  /* ── settled (previous) month ───────────────────────────── */
  /**
   * Final result for a FINISHED month. Computed locally from raw figures.
   * Wording is final-state only — never "בדרך"/"בתהליך"/"חסרים".
   *
   * in : { key, ym, avgDaily, treatmentDays }
   * out: { month, label, title, shortTitle, gateText, amount, tier, eligible,
   *        gatePassed, treatmentDays, gate, avgDaily, threshold, statusText,
   *        badge, final }
   */
  function settledMonthView(o, resolveThreshold) {
    var opts = o || {};
    var key = opts.key;
    var ym = opts.ym;
    var avg = Number(opts.avgDaily) || 0;
    var td = Number(opts.treatmentDays) || 0;
    var h = { key: key, ym: ym, avgDaily: avg, treatmentDays: td };
    var r = BE.monthlyBonusAmount(h, resolveThreshold, daysInMonth(ym));
    var threshold = BE.thresholdOf(h, resolveThreshold);
    var label = monthLabel(ym);
    /* Final-state wording only. When the month failed, the concrete reason is
       the treatment-days quota (countable: 441/510); the average-below-
       threshold wording is used only when the quota WAS met. */
    var gateMet = td >= r.minRequired;
    var statusText;
    if (r.amount > 0) {
      statusText = 'זכאי · מדרגה ' + r.tier + ' · ' + fmtCurrency(r.amount);
    } else if (!gateMet) {
      statusText = 'לא זכאי · המכסה לא הושלמה (' + fmtInt(td) + '/' + fmtInt(r.minRequired) + ')';
    } else {
      statusText = 'לא זכאי · ממוצע ' + fmtNum1(avg) + ' מטופלים/יום מתחת לסף (' + fmtInt(threshold) + ')';
    }
    return {
      month: ym,
      label: label,
      title: 'בונוס ' + label + ' — סופי (לתשלום)',
      /* Picker / history heading: "יולי 2026 — סופי". */
      shortTitle: label + ' — סופי',
      /* Gate result in words, countable: "441/510 ימי טיפול · המכסה לא הושלמה". */
      gateText: fmtInt(td) + '/' + fmtInt(r.minRequired) + ' ימי טיפול · ' + (gateMet ? 'המכסה הושלמה' : 'המכסה לא הושלמה'),
      amount: r.amount,
      tier: r.tier,
      eligible: r.eligible,
      gatePassed: gateMet,
      treatmentDays: td,
      gate: r.minRequired,
      avgDaily: avg,
      threshold: threshold,
      statusText: statusText,
      badge: tierBadgeView({ key: key, ym: ym, achievedTier: r.amount > 0 ? r.tier : 0, achievedAmount: r.amount, avgDaily: avg }),
      final: true
    };
  }

  /* ── current (running) month ────────────────────────────── */
  /**
   * Running-month view. ACTUAL days-so-far and the PROJECTION are separate,
   * separately labelled fields.
   *
   * in : { key, ym, daysSoFar, elapsedDays, daysInMonth, capacity }
   * out: { month, label, title, daysSoFar, gate, gapDays, elapsedDays,
   *        daysInMonth, avgSoFar, actualLabel, actualText,
   *        projectedDays, projectedTier, projectedAmount,
   *        projectionLabel, projectionText,
   *        state: 'locked'|'projection', securedTier, securedAmount,
   *        securedText, badge, final:false }
   */
  function currentMonthView(o, resolveThreshold) {
    var opts = o || {};
    var key = opts.key;
    var ym = opts.ym;
    var days = Math.max(0, Number(opts.daysSoFar) || 0);
    var dim = Number(opts.daysInMonth) > 0 ? Number(opts.daysInMonth) : daysInMonth(ym);
    var elapsed = Math.max(1, Math.min(dim, Number(opts.elapsedDays) || 1));
    var capacity = Number(opts.capacity) > 0 ? Number(opts.capacity) : Infinity;
    var avgSoFar = Math.min(capacity, days / elapsed);
    var hAvg = { key: key, ym: ym, avgDaily: avgSoFar };
    var threshold = BE.thresholdOf(hAvg, resolveThreshold);
    var gate = BE.gateTarget(hAvg, resolveThreshold);
    var projTier = BE.tierForPatients(hAvg, resolveThreshold);
    var floor = BE.securedFloor(hAvg, resolveThreshold, dim, days);
    var projectedDays = Math.round(avgSoFar * dim);
    var label = monthLabel(ym);
    var locked = floor.tier > 0;

    var projectionText = projTier.amount > 0
      ? fmtInt(projectedDays) + ' ימי טיפול · מדרגה ' + projTier.tier + ' (' + fmtCurrency(projTier.amount) + ')'
      : fmtInt(projectedDays) + ' ימי טיפול · מתחת לסף (' + fmtInt(threshold) + ' מטופלים/יום)';

    return {
      month: ym,
      label: label,
      title: label + ' — חודש נוכחי (בתהליך)',
      daysSoFar: days,
      gate: gate,
      gapDays: Math.max(0, gate - days),
      elapsedDays: elapsed,
      daysInMonth: dim,
      avgSoFar: avgSoFar,
      threshold: threshold,
      actualLabel: 'ימי טיפול עד כה',
      actualText: fmtInt(days) + '/' + fmtInt(gate) + ' ימי טיפול',
      projectedDays: projectedDays,
      projectedTier: projTier.tier,
      projectedAmount: projTier.amount,
      projectionLabel: 'צפי לסוף החודש',
      projectionText: projectionText,
      state: locked ? 'locked' : 'projection',
      securedTier: floor.tier,
      securedAmount: floor.amount,
      securedText: locked
        ? 'מובטח · מדרגה ' + floor.tier + ' · ' + fmtCurrency(floor.amount)
        : 'טרם הובטח · 0 ₪',
      badge: tierBadgeView({ key: key, ym: ym, achievedTier: locked ? floor.tier : 0, achievedAmount: floor.amount, avgDaily: avgSoFar }),
      final: false
    };
  }

  /* ── house page: the bonus plan (13 Oct 2026 redesign) ──────
   * Every bonus of the month as ONE block: what it pays, the condition in
   * plain words, and where the house stands NOW in real figures (never a
   * bare 0). Higher occupancy steps appear only once earned or still
   * mathematically reachable this month.
   *
   * in : { key, ym, settled, capacity,
   *        daysSoFar, elapsedDays            (running month)
   *        treatmentDays, avgDaily           (settled month)
   *        referral: continuityAmount(...) | null, referralState: 'ok'|'loading'|'error', referralError,
   *        intake: intakeMeetingAmount(...) | null,
   *        quarterly: earned amount (shown only when > 0) }
   * out: { title, items:[{ id, title, amountText, condition, status, extra,
   *                        state, chip, amount, amountKnown }],
   *        total, totalKnown, totalLabel, totalNote } */
  var STEP_CHIPS = {
    earned: 'הושג ✓', 'on-track': 'בקצב הנכון', behind: 'צריך להאיץ',
    unreachable: 'לא החודש', missed: 'לא הושג', pending: 'ממתין', none: 'אין עדיין',
    loading: 'טוען', error: 'שגיאה'
  };
  function bonusPlanView(o) {
    var opts = o || {};
    var key = opts.key;
    var ym = opts.ym;
    var settled = !!opts.settled;
    var label = monthLabel(ym);
    var dim = daysInMonth(ym);
    var cap = Number(opts.capacity) > 0 ? Number(opts.capacity) : 0;
    var tiers = tiersAscFor(key, ym);
    var first = tiers[0] || null;
    var gate = first ? first.patients * (BE.GATE_DAYS_FACTOR || 30) : 0;

    var days, elapsed, avg;
    if (settled) {
      days = Math.max(0, Number(opts.treatmentDays) || 0);
      elapsed = dim;
      avg = Number(opts.avgDaily) || (days / dim);
    } else {
      days = Math.max(0, Number(opts.daysSoFar) || 0);
      elapsed = Math.max(1, Math.min(dim, Number(opts.elapsedDays) || 1));
      avg = days / elapsed;
      if (cap) avg = Math.min(cap, avg);
    }
    var remaining = settled ? 0 : Math.max(0, dim - elapsed);
    var maxDays = cap ? days + remaining * cap : Infinity;
    var projected = settled ? days : Math.round(avg * dim);

    // A finished month's verdict is the OFFICIAL settled result (the same
    // monthlyBonusAmount the totals and the quarterly check use).
    var settledAmount = settled
      ? BE.monthlyBonusAmount({ key: key, ym: ym, avgDaily: avg, treatmentDays: days }).amount
      : 0;

    var items = [];
    var calcIntake = { confirmed: 0, pending: 0 };
    var calcReferral = 0;
    var prevAmount = 0;
    tiers.forEach(function (t, i) {
      var need = Math.max(gate, Math.ceil(t.patients * dim));
      var incr = t.amount - prevAmount;
      prevAmount = t.amount;
      var isFull = cap > 0 && t.patients >= cap;
      var met = settled ? settledAmount >= t.amount : days >= need;
      var reachable = maxDays >= need;
      var state;
      if (met) state = 'earned';
      else if (settled) state = 'missed';
      else if (!reachable) state = 'unreachable';
      else if (projected >= need) state = 'on-track';
      else state = 'behind';
      // Only the FIRST bonus is always shown; a higher step only once earned
      // or while it can still be reached this month.
      if (i > 0 && !met && (settled || !reachable)) return;

      var title = i === 0 ? 'בונוס ראשון' : isFull ? 'בונוס תפוסה מלאה' : 'בונוס ביניים';
      var condition = isFull
        ? 'בית מלא כל החודש — ' + fmtInt(cap) + ' מטופלים בכל יום (' + fmtInt(need) + ' ימי טיפול ב' + label + ')'
        : 'ממוצע של לפחות ' + fmtInt(t.patients) + ' מטופלים ליום — כלומר ' + fmtInt(need) + ' ימי טיפול ב' + label;
      var status, extra = '';
      if (settled) {
        status = (met ? 'הושג — ' : 'לא הושג — ') + 'ממוצע ' + fmtNum1(avg) + ' מטופלים ליום (נדרש ' +
          fmtInt(t.patients) + ') · ' + fmtInt(days) + ' ימי טיפול (נדרש לפחות ' + fmtInt(gate) + ')';
      } else if (met) {
        status = 'הושג — ' + fmtInt(days) + ' ימי טיפול מתוך ' + fmtInt(need) + ' כבר עכשיו';
      } else {
        status = 'עכשיו: ' + fmtInt(days) + ' ימי טיפול מתוך ' + fmtInt(need) +
          ' · ממוצע ' + fmtNum1(avg) + ' מטופלים ליום';
        if (state === 'unreachable') {
          extra = 'גם בבית מלא עד סוף החודש יהיו לכל היותר ' + fmtInt(maxDays) + ' ימי טיפול';
        } else if (remaining > 0) {
          var reqAvg = (need - days) / remaining;
          extra = 'נשארו ' + fmtInt(remaining) + ' ימים — צריך בממוצע ' + fmtNum1(reqAvg) +
            ' מטופלים ליום עד סוף החודש';
        }
      }
      items.push({
        id: i === 0 ? 'first' : isFull ? 'full' : 'mid',
        title: title,
        amountText: i === 0 ? fmtCurrency(t.amount) : '+' + fmtCurrency(incr) + ' (סה״כ ' + fmtCurrency(t.amount) + ')',
        condition: condition,
        status: status,
        extra: extra,
        state: state,
        chip: STEP_CHIPS[state],
        amount: met ? incr : 0,
        amountKnown: true,
        need: need
      });
    });

    // Intake meetings — 250 ₪ per meeting (from Oct 2026).
    if (BE.intakeEnabled && BE.intakeEnabled(ym)) {
      var ib = opts.intake || BE.intakeMeetingAmount(null, ym);
      calcIntake = { confirmed: ib.confirmed || 0, pending: ib.pending || 0 };
      var iState = ib.total > 0 ? 'earned' : ib.pending > 0 ? 'pending' : 'none';
      var iParts = [];
      if (ib.confirmed > 0) iParts.push(fmtInt(ib.confirmed) + ' ' + (ib.confirmed === 1 ? 'פגישה עומדת' : 'פגישות עומדות') + ' בתנאים = ' + fmtCurrency(ib.total));
      if (ib.pending > 0) iParts.push(fmtInt(ib.pending) + ' ' + (ib.pending === 1 ? 'ממתינה' : 'ממתינות') + ' להשלמת 30 יום');
      items.push({
        id: 'intake',
        title: 'בונוס פגישות קליטה',
        amountText: fmtCurrency(ib.unit) + ' לכל פגישה',
        condition: 'קיימת את פגישת הקליטה · המטופל נקלט לאשפוז כשבבית כבר היו 6 מאושפזים (הוא המאושפז ה-7 ומעלה) · ונשאר באשפוז לפחות 30 יום',
        status: iParts.length ? iParts.join(' · ') : 'עדיין אין פגישות קליטה שעומדות בתנאים ב' + label,
        extra: '',
        state: iState,
        chip: STEP_CHIPS[iState],
        amount: ib.total,
        amountKnown: true
      });
    }

    // Referral to outpatient day packages — 300 ₪ per patient per month.
    if (BE.continuityEnabled && BE.continuityEnabled(ym)) {
      var rState = opts.referralState || 'ok';
      var rb = opts.referral || BE.continuityAmount(null, false, ym);
      var known = rState === 'ok';
      if (known) calcReferral = rb.payableCount || 0;
      var rStatus;
      if (rState === 'loading') rStatus = 'טוען נתונים…';
      else if (rState === 'error') rStatus = 'שגיאה בטעינת הנתונים' + (opts.referralError ? ': ' + opts.referralError : '');
      else if (rb.oneTime) rStatus = rb.payableCount > 0
        ? fmtInt(rb.payableCount) + ' ' + (rb.payableCount === 1 ? 'מטופל התחיל' : 'מטופלים התחילו') + ' טיפול יום ב' + label + ' = ' + fmtCurrency(rb.total)
        : 'עדיין אין מטופלים מהבית שהתחילו טיפול יום ב' + label;
      else rStatus = rb.payableCount > 0
        ? fmtInt(rb.payableCount) + ' ' + (rb.payableCount === 1 ? 'מטופל' : 'מטופלים') + ' בטיפול יום = ' + fmtCurrency(rb.total)
        : 'עדיין אין מטופלים מהבית בטיפול יום ב' + label;
      var rItemState = !known ? rState : rb.total > 0 ? 'earned' : 'none';
      items.push({
        id: 'referral',
        title: 'בונוס המשך טיפול',
        amountText: rb.oneTime
          ? fmtCurrency(rb.unitRate || 300) + ' חד-פעמי לכל מטופל'
          : fmtCurrency(rb.unitRate || 300) + ' לכל מטופל בחודש',
        condition: rb.oneTime
          ? 'מטופל שהשתחרר מהבית והתחיל אצלנו טיפול יום — פעמיים בשבוע או יותר. תשלום אחד, בחודש שבו התחיל'
          : 'מטופל שהשתחרר מהבית וממשיך אצלנו בטיפול יום — פעמיים בשבוע או יותר',
        status: rStatus,
        extra: '',
        state: rItemState,
        chip: STEP_CHIPS[rItemState],
        amount: known ? rb.total : 0,
        amountKnown: known
      });
    }

    // Quarterly — only the old windows (May–Jul 2026) paid it; shown when earned.
    var q = Number(opts.quarterly) || 0;
    if (q > 0) {
      items.push({
        id: 'quarterly', title: 'בונוס יציבות רבעוני', amountText: fmtCurrency(q),
        condition: 'בונוס של 2,000 ₪ לפחות בכל אחד משלושת חודשי הרבעון',
        status: 'הושג', extra: '', state: 'earned', chip: STEP_CHIPS.earned, amount: q, amountKnown: true
      });
    }

    var total = items.reduce(function (sum, it) { return sum + (it.amount || 0); }, 0);
    var totalKnown = items.every(function (it) { return it.amountKnown; });
    return {
      title: settled ? 'הבונוסים של ' + label + ' — סופי' : 'הבונוסים החודש — ' + label,
      items: items,
      total: total,
      totalKnown: totalKnown,
      totalLabel: settled ? 'סה״כ לתשלום — ' + label : 'סה״כ שכבר הושג — ' + label,
      totalNote: totalKnown ? '' : 'לא כולל בונוס המשך טיפול — הנתונים לא נטענו',
      settled: settled,
      monthLabel: label,
      days: days,
      projected: projected,
      // What the «מה אם?» calculator starts from (running month only).
      calc: settled ? null : { key: key, ym: ym, capacity: cap, daysSoFar: days, elapsedDays: elapsed,
        intake: calcIntake, referralCount: calcReferral }
    };
  }

  /* ── «מה אם?» bonus calculator (14 Oct 2026) ─────────────── */
  /**
   * Plays the month forward with the manager's own numbers, by the SAME
   * step rule as the bonus boxes (a step is met when the month's treatment
   * days reach max(gate, patients × days in month)).
   * c: plan.calc; o: { perDay, extraIntake, extraReferral }
   * out: { perDay, perDayMax, projectedDays, occupancy, intake, referral,
   *        total, lines:[{k,label,amountText}], totalText, tip }
   */
  function bonusCalcView(c, o) {
    if (!c) return null;
    var opts = o || {};
    var ym = c.ym;
    var dim = daysInMonth(ym);
    var cap = Number(c.capacity) > 0 ? Number(c.capacity) : 0;
    var elapsed = Math.max(1, Math.min(dim, Number(c.elapsedDays) || 1));
    var remaining = Math.max(0, dim - elapsed);
    var done = Math.max(0, Number(c.daysSoFar) || 0);
    var perDayMax = cap || 30;
    var perDay = Math.max(0, Math.min(perDayMax, Math.round(Number(opts.perDay) || 0)));
    var extraIntake = Math.max(0, Math.min(20, Math.round(Number(opts.extraIntake) || 0)));
    var extraReferral = Math.max(0, Math.min(20, Math.round(Number(opts.extraReferral) || 0)));
    var projectedDays = done + remaining * perDay;

    var tiers = tiersAscFor(c.key, ym);
    var gate = tiers[0] ? tiers[0].patients * (BE.GATE_DAYS_FACTOR || 30) : 0;
    var met = null, next = null;
    tiers.forEach(function (t, i) {
      var need = Math.max(gate, Math.ceil(t.patients * dim));
      var isFull = cap > 0 && t.patients >= cap;
      var title = i === 0 ? 'בונוס ראשון' : isFull ? 'בונוס תפוסה מלאה' : 'בונוס ביניים';
      if (projectedDays >= need) met = { amount: t.amount, title: title };
      else if (!next) next = { need: need, title: title, amount: t.amount };
    });
    var occupancy = met ? met.amount : 0;

    var iu = BE.intakeEnabled && BE.intakeEnabled(ym) ? BE.intakeMeetingAmount(null, ym).unit : 0;
    var intakeCount = (c.intake ? (c.intake.confirmed || 0) + (c.intake.pending || 0) : 0) + extraIntake;
    var intake = iu * intakeCount;
    var ru = BE.continuityEnabled && BE.continuityEnabled(ym) ? (BE.continuityAmount({ starts: 1 }, true, ym).unitRate || 0) : 0;
    var refCount = (Number(c.referralCount) || 0) + extraReferral;
    var referral = ru * refCount;
    var total = occupancy + intake + referral;

    var lines = [{ k: 'occupancy', label: met ? 'בונוס תפוסה — ' + met.title : 'בונוס תפוסה — לא מגיעים', amountText: fmtCurrency(occupancy) }];
    if (iu) lines.push({ k: 'intake', label: 'פגישות קליטה — ' + fmtInt(intakeCount) + ' × ' + fmtCurrency(iu), amountText: fmtCurrency(intake) });
    if (ru) lines.push({ k: 'referral', label: 'המשך טיפול — ' + fmtInt(refCount) + ' × ' + fmtCurrency(ru), amountText: fmtCurrency(referral) });

    var tip = '';
    if (next && remaining > 0) {
      var perDayNeed = Math.ceil((next.need - done) / remaining);
      tip = (met ? 'מגיעים ל' + met.title + ' ✓ · ' : '') + (perDayNeed > perDayMax
        ? next.title + ' כבר לא אפשרי החודש, גם בבית מלא'
        : 'עם ' + fmtInt(perDayNeed) + ' מטופלים ליום עד סוף החודש מגיעים ל' + next.title + ' (' + fmtCurrency(next.amount) + ')');
    } else if (!next && tiers.length) {
      tip = 'בקצב הזה מגיעים לכל בונוסי התפוסה!';
    }
    return {
      perDay: perDay, perDayMax: perDayMax, remaining: remaining,
      perDayLabel: fmtInt(perDay) + ' מטופלים בכל יום ב-' + fmtInt(remaining) + ' הימים שנשארו',
      projectedDays: projectedDays,
      projectedText: 'סה״כ ' + fmtInt(projectedDays) + ' ימי טיפול ב' + monthLabel(ym),
      occupancy: occupancy, intake: intake, referral: referral, total: total,
      lines: lines,
      totalText: fmtCurrency(total),
      tip: tip,
      pendingNote: c.intake && c.intake.pending ? 'כולל ' + fmtInt(c.intake.pending) + ' פגישות שממתינות להשלמת 30 יום' : ''
    };
  }

  /* ── dashboard gauge (14 Oct 2026) ──────────────────────── */
  /**
   * The dial on the manager's dashboard, from a bonusPlanView result.
   * It points at the NEXT occupancy step still in play: the first bonus
   * until it is earned, then the higher step if it can still be reached.
   * out: { pct, projPct (null when settled), tone, stepTitle, valueText,
   *        ofText, headline, hint, chip, earnedText, earnedLabel }
   */
  var GAUGE_TONE = { earned: 'good', 'on-track': 'ok', behind: 'warn', unreachable: 'bad', missed: 'bad' };
  function bonusGaugeView(plan) {
    var p = plan || { items: [] };
    var steps = (p.items || []).filter(function (it) { return it.id === 'first' || it.id === 'mid' || it.id === 'full'; });
    var target = null;
    for (var i = 0; i < steps.length; i++) { if (steps[i].state !== 'earned') { target = steps[i]; break; } }
    var allDone = !target && steps.length > 0;
    if (!target) target = steps[steps.length - 1] || null;
    var days = Math.max(0, Number(p.days) || 0);
    var need = target ? Math.max(1, Number(target.need) || 1) : 1;
    var pct = Math.max(0, Math.min(100, Math.round((days / need) * 100)));
    var projPct = p.settled ? null : Math.max(0, Math.min(100, Math.round(((Number(p.projected) || 0) / need) * 100)));
    var state = allDone ? 'earned' : target ? target.state : 'none';
    var headline;
    if (!target) headline = 'אין יעד בונוס תפוסה ל' + (p.monthLabel || 'חודש זה');
    else if (allDone) headline = p.settled ? 'כל בונוסי התפוסה הושגו ב' + p.monthLabel : 'כל בונוסי התפוסה כבר הושגו החודש!';
    else if (p.settled) headline = target.title + ' לא הושג ב' + p.monthLabel;
    else if (state === 'on-track') headline = 'בקצב הנכון ל' + target.title;
    else if (state === 'behind') headline = 'צריך להאיץ כדי להגיע ל' + target.title;
    else if (state === 'unreachable') headline = target.title + ' כבר לא אפשרי החודש';
    else headline = target.title;
    return {
      pct: allDone ? 100 : pct,
      projPct: allDone ? null : projPct,
      tone: GAUGE_TONE[state] || 'ok',
      stepTitle: target ? target.title : '',
      valueText: fmtInt(days),
      ofText: target ? 'מתוך ' + fmtInt(need) + ' ימי טיפול' : '',
      headline: headline,
      hint: allDone ? '' : (target && target.extra) || '',
      chip: target ? (allDone ? STEP_CHIPS.earned : target.chip) : '',
      earnedText: fmtCurrency(p.total || 0),
      earnedLabel: p.totalLabel || ''
    };
  }

  /* ── overview hero (winners banner) ─────────────────────── */
  /**
   * rows: [{ name, manager, amount, tier, quarterly, referral, intake }] for
   * the settled month. `amount` = the occupancy bonus; `referral` = the
   * outpatient day-package bonus; `intake` = the confirmed intake-meeting
   * bonus (both 0 before Oct 2026). A manager with only a referral or intake
   * bonus is still a winner.
   * out : { title, winners:[{..., total, text}], noneText, currentLine }
   */
  function winnersBannerView(prevYm, rows, current) {
    var label = monthLabel(prevYm);
    var winners = (rows || []).filter(function (r) { return (r.amount > 0) || (r.quarterly > 0) || (r.referral > 0) || (r.intake > 0); })
      .map(function (r) {
        var parts = [];
        if (r.amount > 0) parts.push('זכאי · מדרגה ' + r.tier + ' · ' + fmtCurrency(r.amount));
        if (r.referral > 0) parts.push('בונוס הפניות ' + fmtCurrency(r.referral));
        if (r.intake > 0) parts.push('פגישות קליטה ' + fmtCurrency(r.intake));
        if (r.quarterly > 0) parts.push('כולל בונוס רבעוני ' + fmtCurrency(r.quarterly));
        return {
          name: r.name, manager: r.manager, amount: r.amount, tier: r.tier, quarterly: r.quarterly,
          referral: r.referral || 0,
          intake: r.intake || 0,
          total: (r.amount || 0) + (r.referral || 0) + (r.intake || 0) + (r.quarterly || 0),
          text: parts.join(' · ')
        };
      });
    return {
      title: 'בונוסים לתשלום — ' + label + ' (סופי)',
      winners: winners,
      noneText: label + ': אף בית לא עמד בסף',
      currentLine: current ? currentMonthLine(current.ym, current.dayOfMonth, current.daysInMonth) : ''
    };
  }

  function currentMonthLine(ym, dayOfMonth, dim) {
    var d = Number(dayOfMonth) || 0;
    var n = Number(dim) || daysInMonth(ym);
    return monthLabel(ym) + ' — חודש נוכחי (בתהליך) · יום ' + fmtInt(d) + ' מתוך ' + fmtInt(n);
  }

  /* ── house detail hero ──────────────────────────────────── */
  /**
   * Headline = the SETTLED previous month for this house. Secondary line =
   * the running month, always named and marked "בתהליך".
   * in : { name, manager, settled (settledMonthView|null), prevYm, current (currentMonthView),
   *        selected: true when `settled` is a month the user PICKED in the
   *        bonus-history picker — the headline then leads with its short
   *        title ("יולי 2026 — סופי: …") and there is no running-month line }
   */
  function houseHeroView(o) {
    var opts = o || {};
    var s = opts.settled;
    var c = opts.selected ? null : opts.current;
    var manager = safeLabel(opts.manager);
    var name = safeLabel(opts.name) || '';
    var headline, sub, tone, emoji;
    if (s && s.amount > 0) {
      tone = 'above'; emoji = '🏆';
      headline = (opts.selected ? s.shortTitle : s.title) + ': ' + s.statusText;
      sub = (manager ? 'מנהל/ת: ' + manager + ' · ' : '') + 'ממוצע ' + fmtNum1(s.avgDaily) + ' מטופלים/יום · ' + fmtInt(s.treatmentDays) + '/' + fmtInt(s.gate) + ' ימי טיפול';
    } else if (s) {
      tone = 'below'; emoji = '⚠️';
      headline = (opts.selected ? s.shortTitle : s.label) + ': ' + s.statusText;
      sub = (manager ? 'מנהל/ת: ' + manager + ' · ' : '') + 'ממוצע ' + fmtNum1(s.avgDaily) + ' מטופלים/יום · ' + fmtInt(s.treatmentDays) + '/' + fmtInt(s.gate) + ' ימי טיפול';
    } else {
      tone = 'below'; emoji = 'ℹ️';
      headline = 'בונוס ' + monthLabel(opts.prevYm) + ' — סופי (לתשלום): הנתונים לא זמינים';
      sub = manager ? 'מנהל/ת: ' + manager : '';
    }
    var secondary = c
      ? c.title + ' · ' + c.actualText + ' · ' + c.projectionLabel + ': ' + c.projectionText + ' · ' + c.badge.text
      : '';
    return { name: name, headline: headline, sub: sub, secondary: secondary, tone: tone, emoji: emoji };
  }

  return {
    HEBREW_MONTHS: HEBREW_MONTHS,
    FORBIDDEN_SETTLED_WORDS: FORBIDDEN_SETTLED_WORDS,
    IGNORED_BACKEND_FIELDS: IGNORED_BACKEND_FIELDS,
    fmtCurrency: fmtCurrency,
    fmtInt: fmtInt,
    fmtNum1: fmtNum1,
    ymParts: ymParts,
    ymOf: ymOf,
    prevMonth: prevMonth,
    daysInMonth: daysInMonth,
    monthLabel: monthLabel,
    dateKey: dateKey,
    monthsBetween: monthsBetween,
    safeLabel: safeLabel,
    daysSoFar: daysSoFar,
    tiersAscFor: tiersAscFor,
    tierBadgeView: tierBadgeView,
    settledMonthView: settledMonthView,
    currentMonthView: currentMonthView,
    winnersBannerView: winnersBannerView,
    currentMonthLine: currentMonthLine,
    houseHeroView: houseHeroView,
    bonusPlanView: bonusPlanView,
    bonusGaugeView: bonusGaugeView,
    bonusCalcView: bonusCalcView,
    STEP_CHIPS: STEP_CHIPS
  };
}));
