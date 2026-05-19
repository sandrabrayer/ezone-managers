/* Bonus eligibility — canonical, testable logic for the dashboard/overview.
   Loaded by Node (CommonJS) for tests and by the browser via /lib/bonus-eligibility.js
   (served as a static asset by server.js).

   Two surfaces are exported:
     - qualifiesMonthly(h, resolveBep): the eligibility BADGE / trophy decision
       used by the overview KPIs, network spark, and house-card badge. This is
       a live-occupancy signal (patientsNow vs BEP) and intentionally ignores
       any backend `qualifies` flags, which have been observed to lag the live
       state (see CHANGELOG: Ra'anana false-negative).
     - monthlyBonusAmount(h, resolveBep, daysInMonth): the monthly bonus AMOUNT
       payable to the house. Gated by an 80%-occupancy rule on
       `h.bonus.aboveBepDays / daysInMonth`, with a snapshot fallback for when
       the backend hasn't yet supplied aboveBepDays. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BonusEligibility = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Treatment-day tier amounts. The tier-1 floor is paid whenever the
  // occupancy gate is met, even if treatment-days are below the tier-1
  // threshold — see monthlyBonusAmount below.
  var TIER1_DAYS = 300;
  var TIER2_DAYS = 360;
  var TIER3_DAYS = 420;
  var TIER1_AMOUNT = 2000;
  var TIER2_AMOUNT = 2500;
  var TIER3_AMOUNT = 3500;

  var OCCUPANCY_THRESHOLD = 0.8;

  /**
   * Overview eligibility: a house qualifies for the monthly bonus iff
   * active patients (patientsNow) >= breaking point (resolveBep(h)).
   * Equality at the breaking point counts as qualifying.
   * Backend `h.bonus.qualifies` / `h.qualifies` flags are deliberately ignored.
   */
  function qualifiesMonthly(h, resolveBep) {
    if (!h) return false;
    var bep = typeof resolveBep === 'function' ? resolveBep(h) : 0;
    var patientsNow = Number.isFinite(h.patientsNow) ? h.patientsNow : 0;
    return patientsNow >= bep;
  }

  function treatmentDaysOf(h) {
    if (h && h.bonus && Number.isFinite(h.bonus.treatmentNights)) return h.bonus.treatmentNights;
    if (h && Number.isFinite(h.treatmentDays)) return h.treatmentDays;
    return 0;
  }

  function tierForDays(days) {
    if (days >= TIER3_DAYS) return { tier: 3, amount: TIER3_AMOUNT };
    if (days >= TIER2_DAYS) return { tier: 2, amount: TIER2_AMOUNT };
    // 300+ → tier 1, < 300 → tier-1 floor (still 2000).
    return { tier: 1, amount: TIER1_AMOUNT };
  }

  /**
   * Monthly bonus AMOUNT for a house.
   *
   * Gate: house must have been at-or-above BEP on >= 80% of the month's days,
   * read from h.bonus.aboveBepDays / daysInMonth. If the gate is not met the
   * amount is 0 regardless of treatment-days.
   *
   * Tiered amount (when the gate IS met):
   *   treatment-days >= 420 → 3500
   *   treatment-days >= 360 → 2500
   *   treatment-days >= 300 → 2000
   *   treatment-days <  300 → 2000  (tier-1 floor — still paid when eligible)
   *
   * Fallback: when h.bonus.aboveBepDays is missing or 0 (backend not yet
   * reporting it), treat the gate as met iff patientsNow >= resolveBep(h)
   * (the snapshot signal used by qualifiesMonthly). `usedFallback: true` is
   * returned so the UI can show a "מבוסס על תפוסה נוכחית" caveat.
   *
   * Returns: { amount, tier, eligible, usedFallback }
   *   - amount: integer shekels (0 when not eligible)
   *   - tier:   1 | 2 | 3 when eligible, 0 when not
   *   - eligible: true iff the occupancy gate (or its fallback) passed
   *   - usedFallback: true iff the snapshot fallback drove the eligibility decision
   */
  function monthlyBonusAmount(h, resolveBep, daysInMonth) {
    var result = { amount: 0, tier: 0, eligible: false, usedFallback: false };
    if (!h) return result;

    var bonus = h.bonus || {};
    var aboveBepDays = Number.isFinite(bonus.aboveBepDays) ? bonus.aboveBepDays : 0;
    var days = Number.isFinite(daysInMonth) && daysInMonth > 0 ? daysInMonth : 30;

    var eligible;
    if (aboveBepDays > 0) {
      eligible = (aboveBepDays / days) >= OCCUPANCY_THRESHOLD;
      result.usedFallback = false;
    } else {
      // Backend hasn't reported aboveBepDays yet — fall back to live snapshot.
      result.usedFallback = true;
      eligible = qualifiesMonthly(h, resolveBep);
    }

    result.eligible = eligible;
    if (!eligible) return result;

    var t = tierForDays(treatmentDaysOf(h));
    result.tier = t.tier;
    result.amount = t.amount;
    return result;
  }

  return {
    qualifiesMonthly: qualifiesMonthly,
    monthlyBonusAmount: monthlyBonusAmount,
    OCCUPANCY_THRESHOLD: OCCUPANCY_THRESHOLD,
    TIER1_DAYS: TIER1_DAYS,
    TIER2_DAYS: TIER2_DAYS,
    TIER3_DAYS: TIER3_DAYS,
    TIER1_AMOUNT: TIER1_AMOUNT,
    TIER2_AMOUNT: TIER2_AMOUNT,
    TIER3_AMOUNT: TIER3_AMOUNT
  };
}));
