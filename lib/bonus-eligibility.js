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

          Ramot HaShavim:  17 → 2000, 19 → 2500, 20 → 3500   (below 17 → 0)
          Ra'anana Asher:  10 → 2000, 12 → 2500, 14+ → 3500  (below 10 → 0)
          Efroni:          10 → 2000, 12 → 2500, 13+ → 3500  (below 10 → 0)
          Rehab:           10 → 2000, 12 → 2500, 13+ → 3500  (below 10 → 0)

     2. TREATMENT-DAYS GATE — the tier amount is only PAID if the month's
        treatment-days reached the house gate:

          gate = eligibility threshold × 30   (GATE_DAYS_FACTOR, fixed —
                                               independent of month length
                                               and of the matched tier)

          Ramot:  17 × 30 = 510 treatment-days
          Others: 10 × 30 = 300 treatment-days

        If the gate fails, the whole monthly amount is 0 regardless of tier.

   The bonus for a month is SETTLED once the month has finished (computed on
   the 1st of the following month). The quarterly stability bonus (5000) is
   computed elsewhere and is NOT affected by this module.

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

  /* Per-house bonus configuration.
     - threshold: minimum average-daily patients to be eligible for ANY bonus;
       also drives the treatment-days gate (threshold × 30).
     - tiers: occupancy → amount, HIGHEST patient count first.
       The first tier whose `patients` is <= the house's occupancy wins. */
  var HOUSE_BONUS = {
    ramot: {
      threshold: 17,
      tiers: [
        { patients: 20, amount: 3500 },
        { patients: 19, amount: 2500 },
        { patients: 17, amount: 2000 }
      ]
    },
    raanana: {
      threshold: 10,
      tiers: [
        { patients: 14, amount: 3500 },
        { patients: 12, amount: 2500 },
        { patients: 10, amount: 2000 }
      ]
    },
    efroni: {
      threshold: 10,
      tiers: [
        { patients: 13, amount: 3500 },
        { patients: 12, amount: 2500 },
        { patients: 10, amount: 2000 }
      ]
    },
    rehab: {
      threshold: 10,
      tiers: [
        { patients: 13, amount: 3500 },
        { patients: 12, amount: 2500 },
        { patients: 10, amount: 2000 }
      ]
    }
  };

  function configFor(h) {
    if (h && h.key && HOUSE_BONUS[h.key]) return HOUSE_BONUS[h.key];
    return null;
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

  /* The house's fixed treatment-days gate: threshold × 30.
     Ramot → 510, the other houses → 300. Same for every month. */
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

  return {
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
}));
