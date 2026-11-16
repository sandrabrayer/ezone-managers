'use strict';
/*
 * «עלות אוקטובר 2026 מול היעד» — the monthly manpower TARGET per house.
 *
 * Sandra, 16 Nov 2026: «טעיתי. תתקן את המספרים לעלות האמיתית שהיתה באוקטובר,
 * הערכה לנובמבר לפי מה שאתה יודע שעובדים שכבר מסיימים, ותקציב לפי הטבלה».
 *
 * - October's cost is NOT stored here any more: the page reads the real
 *   October cost from the staffing feed (`houseCost` for 2026-10), the same
 *   number the staffing app shows on its own card.
 * - Only the target is fixed: the «תקציב כוח אדם» column of the action-plan
 *   table, the same as ezone-staffing `TARGET_PLAN`. Change it in BOTH apps.
 *
 * SERVER-ONLY. A manager receives only their own house's target, attached by
 * server.js to the `houseStaffCost` reply.
 */
const BASELINE_MONTH = '2026-10';
const TARGET_FROM = '2026-11';

// Managers house key → staffing house id and the monthly target.
const PLAN = Object.freeze({
  ramot:   Object.freeze({ staffingId: 'ramot',  target: 265000 }),
  efroni:  Object.freeze({ staffingId: 'ofroni', target: 205000 }),
  rehab:   Object.freeze({ staffingId: 'rehab',  target: 170000 }),
  pardes:  Object.freeze({ staffingId: 'pardes', target: 150000 }),
  raanana: Object.freeze({ staffingId: 'asher',  target: 80000 })
});

/* { baselineMonth, targetFrom, target } for one house, or null for anything
 * that is not a known house key. */
function forHouse(house) {
  if (typeof house !== 'string' || !Object.prototype.hasOwnProperty.call(PLAN, house)) return null;
  return { baselineMonth: BASELINE_MONTH, targetFrom: TARGET_FROM, target: PLAN[house].target };
}

module.exports = { forHouse, PLAN, BASELINE_MONTH, TARGET_FROM };
