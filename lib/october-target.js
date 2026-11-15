'use strict';
/*
 * «עלות אוקטובר 2026 מול היעד» — per house (15 Nov 2026).
 *
 * Sandra, 15 Nov 2026: «Add the "October cost vs target" card to the managers
 * app, per house, with the same numbers as the staffing app including the
 * shared freelancers».
 *
 * The numbers are the staffing app's `TARGET_PLAN` (lib/cost-engine.js there,
 * docs/target-budget-dec-2026.md): the «כוח אדם» column of Sandra's
 * action-plan table for October 2026, plus the shared October freelancers
 * split to the houses, against the monthly manpower target that applies from
 * November 2026. A closed month and a fixed target: change them in BOTH apps.
 *
 * SERVER-ONLY. This file is never served to the browser: a manager receives
 * only their own house, attached by server.js to the `houseStaffCost` reply.
 */
const BASELINE_MONTH = '2026-10';
const TARGET_FROM = '2026-11';

// Managers house key → staffing house id, the table's October manpower cost,
// the shared freelancers added to it (net of VAT) and the monthly target.
const PLAN = Object.freeze({
  ramot:   Object.freeze({ staffingId: 'ramot',  table: 310000, shared: 12537, target: 265000 }),
  efroni:  Object.freeze({ staffingId: 'ofroni', table: 260000, shared: 8727,  target: 205000 }),
  rehab:   Object.freeze({ staffingId: 'rehab',  table: 190000, shared: 8727,  target: 170000 }),
  pardes:  Object.freeze({ staffingId: 'pardes', table: 129261, shared: 31970, target: 150000 }),
  raanana: Object.freeze({ staffingId: 'asher',  table: 163000, shared: 5785,  target: 80000 })
});

/* { baselineMonth, targetFrom, table, shared, total, target, gap, gapPct } for
 * one house, or null for anything that is not a known house key.
 * gap > 0 = what must be cut from October to reach the target; < 0 = headroom. */
function forHouse(house) {
  if (typeof house !== 'string' || !Object.prototype.hasOwnProperty.call(PLAN, house)) return null;
  const p = PLAN[house];
  const total = p.table + p.shared;
  const gap = total - p.target;
  return {
    baselineMonth: BASELINE_MONTH, targetFrom: TARGET_FROM,
    table: p.table, shared: p.shared, total, target: p.target,
    gap, gapPct: total > 0 ? Math.round((gap / total) * 1000) / 10 : null
  };
}

module.exports = { forHouse, PLAN, BASELINE_MONTH, TARGET_FROM };
