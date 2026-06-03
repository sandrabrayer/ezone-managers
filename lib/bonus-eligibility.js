/* Bonus eligibility & amount — canonical, testable logic.
   Loaded by Node (CommonJS) for tests and by the browser via
   /lib/bonus-eligibility.js (served as a static asset by server.js).

   ── Model (avgDaily tiers with a treatment-days gate) ──────────
   For each house the monthly bonus is decided in two parts:

     1. TIER AMOUNT — a step function of the AVERAGE DAILY occupancy across the
        month (h.avgDaily; falls back to h.patientsNow if avgDaily is absent).
        A tier is reached only when the figure meets the WHOLE-NUMBER threshold
        (18.9 does NOT reach 19). Each house has its own tier table; below the
        eligibility threshold the tier amount is 0.

          Ramot HaShavim:  18 → 2000, 19 → 2500, 20 → 3500   (below 18 → 0)
          Ra'anana Asher:  10 → 2000, 12 → 2500, 13+ → 3500   (below 10 → 0)
          Efroni:          10 → 2000, 12 → 2500, 13+ → 3500   (below 10 → 0)
          Rehab:           10 → 2000, 12 → 2500, 13+ → 3500   (below 10 → 0)
          (avg 11 at the non-Ramot houses pays the 2000 tier-1 floor;
           the 2500 step starts at 12.)

     2. TREATMENT-DAYS GATE — the tier amount is only PAID if the actual
        treatment-days for the month did not fall below GATE_RATIO (95%) of the
        target. Target = tierPatients × daysInMonth.
          e.g. 18 patients in a 31-day month → target 558, min payable 530.1.
        If the gate fails, the whole monthly amount is 0 regardless of tier.

   "Tiers 2 and 3" (2500 / 3500) are simply the upper steps of this same table —
   the "enhanced bonus" — and follow the identical rule. The quarterly stability
   bonus (5000) is computed elsewhere and is NOT affected by this module.

   Two surfaces are exported:
     - qualifiesMonthly(h, resolveThreshold): the eligibility BADGE / trophy
       decision. A live-occupancy signal (patientsNow >= eligibility threshold).
       Backend `qualifies` flags are intentionally ignored (they lag live state;
       see CHANGELOG: Ra'anana false-negative).
     - monthlyBonusAmount(h, resolveThreshold, daysInMonth): the monthly bonus
       AMOUNT payable, applying the patient-count tier and the treatment-days
       gate described above. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BonusEligibility = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Fraction of the treatment-days target that must be met for the monthly
     bonus to pay. 0.95 → actual treatment-days must be >= 95% of target. */
  var GATE_RATIO = 0.95;

  /* Per-house bonus configuration.
     - threshold: minimum end-of-month patients to be eligible for ANY bonus.
     - tiers: end-of-month patient count → amount, HIGHEST patient count first.
       The first tier whose `patients` is <= the house's patientsNow wins.

     All four houses are fully specified. Ramot is eligible from 18 patients;
     the other three from 10 (with the 2500 step at 12 and 3500 at 13+). */
  var HOUSE_BONUS = {
    ramot: {
      threshold: 18,
      tiers: [
        { patients: 20, amount: 3500 },
        { patients: 19, amount: 2500 },
        { patients: 18, amount: 2000 }
      ]
    },
    raanana: {
      threshold: 10,
      tiers: [
        { patients: 13, amount: 3500 },
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

  /* The figure that drives the tier. Per the agreed model this is the
     AVERAGE DAILY occupancy across the month (h.avgDaily). We fall back to
     patientsNow only if avgDaily is absent (e.g. an old payload), so the app
     still shows something sensible rather than 0. A tier is reached only when
     this figure meets the whole-number threshold (18.9 does NOT reach 19). */
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
   * Overview eligibility: a house qualifies for the monthly bonus iff
   * end-of-month patients (patientsNow) >= the house eligibility threshold.
   * Equality at the threshold counts as qualifying.
   * Backend `qualifies` flags are deliberately ignored.
   */
  function qualifiesMonthly(h, resolveThreshold) {
    if (!h) return false;
    return occupancyOf(h) >= thresholdOf(h, resolveThreshold);
  }

  /* Tier amount from end-of-month patient count. Returns { tier, amount,
     tierPatients }. tier is the 1-based index from the BOTTOM of the table
     (1 = lowest tier). 0 when below threshold / no tier matched. */
  function tierForPatients(h, resolveThreshold) {
    var cfg = configFor(h);
    var patients = occupancyOf(h);
    var threshold = thresholdOf(h, resolveThreshold);

    if (patients < threshold) return { tier: 0, amount: 0, tierPatients: 0 };

    var tiers = (cfg && Array.isArray(cfg.tiers)) ? cfg.tiers : null;
    if (!tiers || !tiers.length) {
      // No table available: pay nothing extra, but the house IS eligible.
      return { tier: 0, amount: 0, tierPatients: threshold };
    }

    // tiers are highest-patients-first; pick the first that patients meets.
    for (var i = 0; i < tiers.length; i++) {
      if (patients >= tiers[i].patients) {
        return {
          tier: tiers.length - i,        // bottom tier = 1
          amount: tiers[i].amount,
          tierPatients: tiers[i].patients
        };
      }
    }
    return { tier: 0, amount: 0, tierPatients: 0 };
  }

  /* Treatment-days target for the matched tier: tierPatients × daysInMonth. */
  function treatmentTarget(tierPatients, daysInMonth) {
    var days = Number.isFinite(daysInMonth) && daysInMonth > 0 ? daysInMonth : 30;
    return tierPatients * days;
  }

  /**
   * Monthly bonus AMOUNT for a house.
   *
   * 1. Determine the tier amount from end-of-month patient count.
   * 2. Compute the treatment-days target = tierPatients × daysInMonth.
   * 3. GATE: pay the tier amount only if treatmentDays >= GATE_RATIO × target.
   *    Otherwise amount is 0.
   *
   * Returns: { amount, tier, eligible, gatePassed, target, minRequired,
   *            treatmentDays, tierPatients }
   *   - amount:        integer shekels (0 when not eligible or gate fails)
   *   - tier:          1 | 2 | 3 when paid, 0 otherwise
   *   - eligible:      true iff patientsNow >= threshold (a tier matched)
   *   - gatePassed:    true iff treatment-days met the 95% target
   *   - target:        treatment-days target for the matched tier
   *   - minRequired:   GATE_RATIO × target (the payable floor)
   *   - treatmentDays: actual treatment-days used
   *   - tierPatients:  the patient count of the matched tier
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

    if (!result.eligible || t.amount <= 0) return result;

    var target = treatmentTarget(t.tierPatients, daysInMonth);
    var minRequired = GATE_RATIO * target;
    result.target = target;
    result.minRequired = minRequired;

    var gatePassed = td >= minRequired;
    result.gatePassed = gatePassed;

    if (gatePassed) {
      result.amount = t.amount;
    } else {
      result.tier = 0;
    }
    return result;
  }

  return {
    qualifiesMonthly: qualifiesMonthly,
    monthlyBonusAmount: monthlyBonusAmount,
    tierForPatients: tierForPatients,
    treatmentTarget: treatmentTarget,
    thresholdOf: thresholdOf,
    GATE_RATIO: GATE_RATIO,
    HOUSE_BONUS: HOUSE_BONUS
  };
}));
