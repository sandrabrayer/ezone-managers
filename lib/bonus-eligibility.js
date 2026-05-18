/* Bonus eligibility — canonical, testable logic.
   Loaded by Node (CommonJS) for tests and by the browser via /lib/bonus-eligibility.js
   (served as a static asset by server.js). */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BonusEligibility = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Decide whether a house qualifies for the monthly bonus.
   *
   * Override order:
   *   1. h.bonus.qualifies — if boolean, used verbatim (backend authority)
   *   2. h.qualifies       — if boolean, used verbatim (legacy backend flag)
   *   3. fallback          — active patients (patientsNow) >= breaking point (resolveBep(h))
   *
   * Equality at the breaking point counts as qualifying.
   */
  function qualifiesMonthly(h, resolveBep) {
    if (!h) return false;
    if (typeof h.bonus?.qualifies === 'boolean') return h.bonus.qualifies;
    if (typeof h.qualifies === 'boolean') return h.qualifies;
    const bep = typeof resolveBep === 'function' ? resolveBep(h) : 0;
    const patientsNow = Number.isFinite(h.patientsNow) ? h.patientsNow : 0;
    return patientsNow >= bep;
  }

  return { qualifiesMonthly };
}));
