/* Bonus eligibility — canonical, testable logic for the dashboard/overview.
   Loaded by Node (CommonJS) for tests and by the browser via /lib/bonus-eligibility.js
   (served as a static asset by server.js).

   Note: this is the OVERVIEW-path decision. It intentionally ignores any
   `qualifies` flags the backend may send, because those have been observed
   to lag the live occupancy (see CHANGELOG: Ra'anana false-negative).
   The house-detail tab does not use this function — it derives its tier
   from treatment-nights directly. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BonusEligibility = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Overview eligibility: a house qualifies for the monthly bonus iff
   * active patients (patientsNow) >= breaking point (resolveBep(h)).
   * Equality at the breaking point counts as qualifying.
   * Backend `h.bonus.qualifies` / `h.qualifies` flags are deliberately ignored.
   */
  function qualifiesMonthly(h, resolveBep) {
    if (!h) return false;
    const bep = typeof resolveBep === 'function' ? resolveBep(h) : 0;
    const patientsNow = Number.isFinite(h.patientsNow) ? h.patientsNow : 0;
    return patientsNow >= bep;
  }

  return { qualifiesMonthly };
}));
