/* Bonus eligibility & amount — canonical, testable logic.
   Loaded by Node (CommonJS) for tests and by the browser via
   /lib/bonus-eligibility.js (served as a static asset by server.js).

   ── Model (avgDaily tiers + a FIXED threshold×30 treatment-days gate) ──
   The SAME logic applies to every house; only the numbers differ.
   For each house the monthly bonus is decided in two parts:

     1. TIER AMOUNT — a step function of the AVERAGE DAILY occupancy across the
        month (h.avgDaily; falls back to h.patientsNow if avgDaily is absent).
        More patients → higher tier → bigger bonus. A tier is reached only when
        the figure meets the WHOLE-NUMBER threshold (18.9 does NOT reach 19).

     2. TREATMENT-DAYS GATE — the tier amount is only PAID if the month's
        treatment-days reached the house gate:

          gate = eligibility threshold × 30   (GATE_DAYS_FACTOR, fixed —
                                               independent of month length
                                               and of the matched tier)

        If the gate fails, the whole monthly amount is 0 regardless of tier.

   ── Rules are MONTH-AWARE (RULE_SETS) ──
   Every rule set has an effective-from month. A month is judged by the
   LATEST rule set whose `from` is <= that month, so changing the rules never
   rewrites a month that has already been settled.

     from 2026-05 (original):
          Ramot HaShavim:  17 → 2000, 19 → 2500, 20 → 3000   gate 510
          Ra'anana Asher:  10 → 2000, 12 → 2500, 14 → 3000   gate 300
          Efroni:          10 → 2000, 12 → 2500, 13 → 3000   gate 300
          Rehab:           10 → 2000, 12 → 2500, 13 → 3000   gate 300
          Pardes:          10 → 2000, 12 → 2500, 13 → 3000   gate 300
          Referral bonus:  none

     from 2026-10 (Sandra, 13 Oct 2026 — lower first tier + day-package bonus):
          Ramot HaShavim:  14 → 2000, 19 → 2500, 20 → 3000   gate 420
          Ra'anana Asher:  10 → 2000, 12 → 2500, 14 → 3000   gate 300 (unchanged)
          Efroni:           9 → 2000, 12 → 2500, 13 → 3000   gate 270
          Rehab:            9 → 2000, 12 → 2500, 13 → 3000   gate 270
          Pardes:           7 → 2000, 12 → 2500, 13 → 3000   gate 210
          Referral bonus:  300 per outpatient in a day package (day_2x or
                           day_daily) per month; maintenance pays 0. Paid
                           whether or not the occupancy bonus was earned.

   The month of a house object is read from h.ym, then h.month (YYYY-MM).
   With no month, the LATEST rule set applies.

   The bonus for a month is SETTLED once the month has finished (computed on
   the 1st of the following month). The quarterly stability bonus (5000)
   counts the OCCUPANCY amount only — referrals never count toward it.

   Exports:
     - qualifiesMonthly(h, resolveThreshold): eligibility BADGE — average
       occupancy meets the house threshold. Backend `qualifies` flags are
       intentionally ignored.
     - monthlyBonusAmount(h, resolveThreshold, daysInMonth): payable amount,
       applying the occupancy tier and the threshold×30 gate. daysInMonth is
       accepted for API compatibility but no longer affects the gate.
     - gateTarget(h, resolveThreshold): the house's fixed treatment-days gate.
     - securedFloor(...): highest tier already guaranteed mid-month. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BonusEligibility = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Fixed multiplier for the treatment-days gate:
     gate = eligibility threshold × GATE_DAYS_FACTOR, for every month. */
  var GATE_DAYS_FACTOR = 30;

  /* Tier tables, HIGHEST patient count first. The first tier whose
     `patients` is <= the house's occupancy wins.
     - threshold: minimum average-daily patients for ANY bonus; also drives
       the treatment-days gate (threshold × 30). */
  function house_(t1, t2, t3) {
    return {
      threshold: t1,
      tiers: [
        { patients: t3, amount: 3000 },
        { patients: t2, amount: 2500 },
        { patients: t1, amount: 2000 }
      ]
    };
  }

  /* Month-aware rule sets, OLDEST first. `from` is the first month (YYYY-MM)
     the set applies to; a month uses the latest set with from <= month.
     NEVER edit a set that has already applied to a settled month — add a new
     set with a later `from` instead. */
  var RULE_SETS = [
    {
      from: '2026-05',
      houses: {
        ramot:   house_(17, 19, 20),
        raanana: house_(10, 12, 14),
        efroni:  house_(10, 12, 13),
        rehab:   house_(10, 12, 13),
        pardes:  house_(10, 12, 13)
      },
      referral: null
    },
    {
      from: '2026-10',
      houses: {
        ramot:   house_(14, 19, 20),
        raanana: house_(10, 12, 14),
        efroni:  house_(9, 12, 13),
        rehab:   house_(9, 12, 13),
        pardes:  house_(7, 12, 13)
      },
      referral: {
        rates: { maintenance: 0, day_2x: 300, day_daily: 300 },
        requiresEligibility: false
      }
    }
  ];

  var YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
  function validYm_(v) {
    var s = typeof v === 'string' ? v.trim().slice(0, 7) : '';
    return YM_RE.test(s) ? s : null;
  }

  /* The rule set for a month. Months before the first set use the first
     set; a missing or invalid month uses the LATEST set. */
  function ruleSetFor(ym) {
    var m = validYm_(ym);
    if (!m) return RULE_SETS[RULE_SETS.length - 1];
    var out = RULE_SETS[0];
    for (var i = 0; i < RULE_SETS.length; i++) {
      if (RULE_SETS[i].from <= m) out = RULE_SETS[i];
    }
    return out;
  }

  /* The month a house object is evaluated for: h.ym, then h.month. */
  function monthOf(h) {
    if (!h) return null;
    return validYm_(h.ym) || validYm_(h.month);
  }

  /* Per-house config ({ threshold, tiers }) for a key in a month. */
  function rulesFor(key, ym) {
    var set = ruleSetFor(ym);
    return (key && set.houses[key]) || null;
  }

  /* The CURRENT (latest) per-house configuration — kept for callers and
     tests that enumerate houses. Month-specific code uses rulesFor(). */
  var HOUSE_BONUS = RULE_SETS[RULE_SETS.length - 1].houses;

  function configFor(h) {
    if (!h || !h.key) return null;
    return rulesFor(h.key, monthOf(h));
  }

  /* Eligibility threshold for a house. Prefers an explicit per-house config,
     then a resolveThreshold callback, then h.bonusThreshold / h.threshold. */
  function thresholdOf(h, resolveThreshold) {
    var cfg = configFor(h);
    if (cfg && Number.isFinite(cfg.threshold)) return cfg.threshold;
    if (typeof resolveThreshold === 'function') {
      var v = resolveThreshold(h);
      if (Number.isFinite(v)) return v;
    }
    if (h && Number.isFinite(h.bonusThreshold)) return h.bonusThreshold;
    if (h && Number.isFinite(h.threshold)) return h.threshold;
    return 0;
  }

  /* The house's fixed treatment-days gate: threshold × 30, using the rule set
     of the house's month (e.g. Ramot 510 up to Sep 2026, 420 from Oct 2026).
     Independent of the month's length. */
  function gateTarget(h, resolveThreshold) {
    return thresholdOf(h, resolveThreshold) * GATE_DAYS_FACTOR;
  }

  /* The figure that drives the tier: AVERAGE DAILY occupancy across the month
     (h.avgDaily), falling back to patientsNow for old payloads. A tier is
     reached only when this figure meets the whole-number threshold
     (18.9 does NOT reach 19). */
  function occupancyOf(h) {
    if (h && Number.isFinite(h.avgDaily)) return h.avgDaily;
    return (h && Number.isFinite(h.patientsNow)) ? h.patientsNow : 0;
  }

  function treatmentDaysOf(h) {
    if (h && h.bonus && Number.isFinite(h.bonus.treatmentNights)) return h.bonus.treatmentNights;
    if (h && Number.isFinite(h.treatmentDays)) return h.treatmentDays;
    return 0;
  }

  /**
   * Overview eligibility: a house qualifies for the monthly bonus iff its
   * occupancy figure >= the house eligibility threshold. Equality counts.
   * Backend `qualifies` flags are deliberately ignored.
   */
  function qualifiesMonthly(h, resolveThreshold) {
    if (!h) return false;
    return occupancyOf(h) >= thresholdOf(h, resolveThreshold);
  }

  /* Tier amount from occupancy. Returns { tier, amount, tierPatients }.
     tier is the 1-based index from the BOTTOM of the table (1 = lowest).
     0 when below threshold / no tier matched. */
  function tierForPatients(h, resolveThreshold) {
    var cfg = configFor(h);
    var patients = occupancyOf(h);
    var threshold = thresholdOf(h, resolveThreshold);

    if (patients < threshold) return { tier: 0, amount: 0, tierPatients: 0 };

    var tiers = (cfg && Array.isArray(cfg.tiers)) ? cfg.tiers : null;
    if (!tiers || !tiers.length) {
      return { tier: 0, amount: 0, tierPatients: threshold };
    }

    for (var i = 0; i < tiers.length; i++) {
      if (patients >= tiers[i].patients) {
        return {
          tier: tiers.length - i,
          amount: tiers[i].amount,
          tierPatients: tiers[i].patients
        };
      }
    }
    return { tier: 0, amount: 0, tierPatients: 0 };
  }

  /* Legacy helper kept for compatibility: tierPatients × daysInMonth.
     The GATE no longer uses it — see gateTarget(). */
  function treatmentTarget(tierPatients, daysInMonth) {
    var days = Number.isFinite(daysInMonth) && daysInMonth > 0 ? daysInMonth : GATE_DAYS_FACTOR;
    return tierPatients * days;
  }

  /**
   * Monthly bonus AMOUNT for a house (a FINISHED month).
   *
   * 1. Tier amount from average daily occupancy.
   * 2. GATE: pay only if treatmentDays >= threshold × 30 (gateTarget).
   *
   * Returns: { amount, tier, eligible, gatePassed, target, minRequired,
   *            treatmentDays, tierPatients }
   *   - target / minRequired: the fixed gate (threshold × 30)
   *   - amount is 0 when not eligible or the gate fails
   */
  function monthlyBonusAmount(h, resolveThreshold, daysInMonth) {
    var result = {
      amount: 0, tier: 0, eligible: false, gatePassed: false,
      target: 0, minRequired: 0, treatmentDays: 0, tierPatients: 0
    };
    if (!h) return result;

    var t = tierForPatients(h, resolveThreshold);
    result.eligible = occupancyOf(h) >= thresholdOf(h, resolveThreshold);
    result.tier = t.tier;
    result.tierPatients = t.tierPatients;

    var td = treatmentDaysOf(h);
    result.treatmentDays = td;

    var gate = gateTarget(h, resolveThreshold);
    result.target = gate;
    result.minRequired = gate;

    if (!result.eligible || t.amount <= 0) return result;

    var gatePassed = td >= gate;
    result.gatePassed = gatePassed;

    if (gatePassed) {
      result.amount = t.amount;
    } else {
      result.tier = 0;
    }
    return result;
  }

  /**
   * Highest tier ALREADY SECURED for a house, mid-month.
   *
   * With the fixed gate there is a single lock condition:
   *   - daysSoFar >= threshold × 30 (the house gate), AND
   *   - occupancy >= the tier's patient count.
   * Once the gate is met, the secured tier is simply the tier the current
   * occupancy supports; it can still rise if occupancy rises.
   *
   * Returns { tier, amount, tierPatients, target, minRequired },
   * all 0 when nothing is secured. daysInMonth is accepted for API
   * compatibility but does not affect the gate.
   */
  function securedFloor(h, resolveThreshold, daysInMonth, daysSoFar) {
    var result = { tier: 0, amount: 0, tierPatients: 0, target: 0, minRequired: 0 };
    if (!h) return result;

    var gate = gateTarget(h, resolveThreshold);
    var days = Number.isFinite(daysSoFar) ? daysSoFar : 0;
    if (gate <= 0 || days < gate) return result;

    var t = tierForPatients(h, resolveThreshold);
    if (!t || t.tier <= 0 || t.amount <= 0) return result;

    return {
      tier: t.tier,
      amount: t.amount,
      tierPatients: t.tierPatients,
      target: gate,
      minRequired: gate
    };
  }

  /* ── Quarterly stability bonus ──────────────────────────────
     5000 for a house whose SETTLED monthly bonus was >= 2000 in EVERY month
     of the quarter window. Windows are 3 months anchored at 2026-05:
     May–Jul 2026, Aug–Oct 2026, Nov 2026–Jan 2027, ...
     Pays only when all 3 months are finished. */
  var QUARTERLY_AMOUNT = 5000;
  var QUARTERLY_MIN_MONTHLY = 2000;
  var QUARTER_ANCHOR = { year: 2026, month: 5 };

  function ymParts_(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return null;
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }
  function ymString_(year, month) {
    while (month < 1) { month += 12; year -= 1; }
    while (month > 12) { month -= 12; year += 1; }
    return year + '-' + (month < 10 ? '0' + month : month);
  }

  /* The 3-month quarter window containing ym, e.g. '2026-07' →
     ['2026-05','2026-06','2026-07']. Returns null for bad input or dates
     before the anchor. */
  function quarterWindowFor(ym) {
    var p = ymParts_(ym);
    if (!p) return null;
    var idx = (p.year - QUARTER_ANCHOR.year) * 12 + (p.month - QUARTER_ANCHOR.month);
    if (idx < 0) return null;
    var startIdx = idx - (idx % 3);
    var out = [];
    for (var i = 0; i < 3; i++) {
      out.push(ymString_(QUARTER_ANCHOR.year, QUARTER_ANCHOR.month + startIdx + i));
    }
    return out;
  }

  /* Quarterly standing from settled monthly amounts.
     settledByMonth: { 'YYYY-MM': amount } — include ONLY finished months.
     Returns { window, monthsMet, monthsFinished, monthsRequired, complete,
               earned } where earned is 5000 iff all 3 finished and every
     month's settled amount >= 2000. */
  function quarterlyStatus(windowMonths, settledByMonth) {
    var result = {
      window: windowMonths || [], monthsMet: 0, monthsFinished: 0,
      monthsRequired: 3, complete: false, earned: 0
    };
    if (!windowMonths || windowMonths.length !== 3) return result;
    var byMonth = settledByMonth || {};
    var allMet = true;
    for (var i = 0; i < windowMonths.length; i++) {
      var amt = byMonth[windowMonths[i]];
      if (Number.isFinite(amt)) {
        result.monthsFinished += 1;
        if (amt >= QUARTERLY_MIN_MONTHLY) result.monthsMet += 1;
        else allMet = false;
      } else {
        allMet = false;
      }
    }
    result.complete = result.monthsFinished === 3;
    if (result.complete && allMet) result.earned = QUARTERLY_AMOUNT;
    return result;
  }

  /* ── Referral (continuity) bonus — «בונוס הפניות להמשך טיפול» ──
     MONTH-AWARE: the rule comes from the month's rule set (RULE_SETS).
       - before 2026-10: no referral bonus (0, and no referral line);
       - from 2026-10:   300 per outpatient in a day package (day_2x or
                         day_daily) per month; maintenance pays 0; paid
                         whether or not the house earned its occupancy bonus.
     Input: the feed's raw `bonus.continuity` COUNTS only — the feed's own
     `total` and `rates` are never read.

     REFERRAL_BONUS_KILL_SWITCH (on the exported object, read at call time):
     set it to true to force the referral bonus to 0 everywhere, in every
     month, and hide the referral line — without touching the rule sets. */
  var REFERRAL_KEYS = ['maintenance', 'day_2x', 'day_daily'];

  function referralRuleFor(ym) {
    if (api.REFERRAL_BONUS_KILL_SWITCH === true) return null;
    return ruleSetFor(ym).referral || null;
  }
  function continuityEnabled(ym) {
    return referralRuleFor(ym) !== null;
  }

  /* counts: { maintenance, day_2x, day_daily } (raw, untrusted)
     eligible: whether the house earned its occupancy bonus that month —
               only matters for a rule with requiresEligibility.
     ym: the month being evaluated (YYYY-MM).
     Returns { maintenance, day_2x, day_daily, payableCount, unitRate,
               gross, total, enabled }:
       payableCount — patients with a rate > 0 (the day-package patients)
       unitRate     — the shared rate when all paying types pay the same
       gross        — counts × rates, before any eligibility condition
       total        — the payable amount (0 when disabled) */
  function continuityAmount(counts, eligible, ym) {
    var c = counts || {};
    var rule = referralRuleFor(ym);
    var rates = rule ? rule.rates : {};
    var out = {
      maintenance: 0, day_2x: 0, day_daily: 0,
      payableCount: 0, unitRate: 0, gross: 0, total: 0, enabled: !!rule
    };
    var seenRates = [];
    REFERRAL_KEYS.forEach(function (k) {
      var n = Number(c[k]);
      n = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      out[k] = n;
      var rate = Number(rates[k]) || 0;
      if (rate > 0) {
        out.payableCount += n;
        out.gross += n * rate;
        if (seenRates.indexOf(rate) === -1) seenRates.push(rate);
      }
    });
    out.unitRate = seenRates.length === 1 ? seenRates[0] : 0;
    if (rule) {
      out.total = rule.requiresEligibility && !eligible ? 0 : out.gross;
    }
    return out;
  }

  var api = {
    REFERRAL_BONUS_KILL_SWITCH: false,
    RULE_SETS: RULE_SETS,
    ruleSetFor: ruleSetFor,
    rulesFor: rulesFor,
    monthOf: monthOf,
    referralRuleFor: referralRuleFor,
    continuityEnabled: continuityEnabled,
    continuityAmount: continuityAmount,
    qualifiesMonthly: qualifiesMonthly,
    quarterWindowFor: quarterWindowFor,
    quarterlyStatus: quarterlyStatus,
    QUARTERLY_AMOUNT: QUARTERLY_AMOUNT,
    QUARTERLY_MIN_MONTHLY: QUARTERLY_MIN_MONTHLY,
    monthlyBonusAmount: monthlyBonusAmount,
    securedFloor: securedFloor,
    tierForPatients: tierForPatients,
    treatmentTarget: treatmentTarget,
    gateTarget: gateTarget,
    thresholdOf: thresholdOf,
    GATE_DAYS_FACTOR: GATE_DAYS_FACTOR,
    HOUSE_BONUS: HOUSE_BONUS
  };
  return api;
}));
