'use strict';
/* Quarterly manpower-budget adherence bonus (Sandra, 14 Nov 2026) —
 * lib/bonus-eligibility.js budgetBonusQuarter / calendarQuarterOf. */
const test = require('node:test');
const assert = require('node:assert/strict');
const BE = require('../lib/bonus-eligibility');

const Q4 = (a, b, c) => [
  Object.assign({ ym: '2026-10', available: true }, a),
  Object.assign({ ym: '2026-11', available: true }, b),
  Object.assign({ ym: '2026-12', available: true }, c)
];

test('calendar quarters: Q1 Jan–Mar … Q4 Oct–Dec', () => {
  assert.deepEqual(BE.calendarQuarterOf('2026-11').months, ['2026-10', '2026-11', '2026-12']);
  assert.equal(BE.calendarQuarterOf('2026-11').label, 'רבעון 4 2026');
  assert.deepEqual(BE.calendarQuarterOf('2027-01').months, ['2027-01', '2027-02', '2027-03']);
  assert.deepEqual(BE.calendarQuarterOf('2027-06').months, ['2027-04', '2027-05', '2027-06']);
  assert.equal(BE.calendarQuarterOf('2026-13'), null);
  assert.equal(BE.calendarQuarterOf(''), null);
});

test('rules: from Oct 2026 (Q4 2026 is the first quarter); the amount is not set yet', () => {
  assert.equal(BE.budgetBonusRuleFor('2026-09'), null);
  assert.deepEqual(BE.budgetBonusRuleFor('2026-10'), { from: '2026-10', amount: null });
  assert.equal(BE.budgetBonusQuarter(Q4({ cost: 1, budget: 2 }, { cost: 1, budget: 2 }, { cost: 1, budget: 2 }), { nowYM: '2026-11' }).amount, null);
  const q3 = BE.budgetBonusQuarter([{ ym: '2026-07', available: true, cost: 1, budget: 2 }], { nowYM: '2026-11' });
  assert.equal(q3.status, 'not_enabled');
});

test('settled: exactly at budget earns; 1 ₪ over does not', () => {
  const at = BE.budgetBonusQuarter(Q4({ cost: 100, budget: 100 }, { cost: 100, budget: 100 }, { cost: 100, budget: 100 }), { nowYM: '2027-01', amount: 1000 });
  assert.equal(at.settled, true);
  assert.equal(at.status, 'earned');
  assert.deepEqual([at.spent, at.budget, at.pct, at.gap, at.amount], [300, 300, 100, 0, 1000]);
  const over = BE.budgetBonusQuarter(Q4({ cost: 100, budget: 100 }, { cost: 101, budget: 100 }, { cost: 100, budget: 100 }), { nowYM: '2027-01', amount: 1000 });
  assert.equal(over.status, 'not_earned');
  assert.equal(over.gap, -1);
});

test('settled: a month that could not be read, or a month without a budget → missing_data, never a pass', () => {
  const gone = BE.budgetBonusQuarter(Q4({ cost: 10, budget: 100 }, { available: false }, { cost: 10, budget: 100 }), { nowYM: '2027-01', amount: 1000 });
  assert.equal(gone.status, 'missing_data');
  const noBudget = BE.budgetBonusQuarter(Q4({ cost: 10, budget: 100 }, { cost: 10, budget: null }, { cost: 10, budget: 100 }), { nowYM: '2027-01', amount: 1000 });
  assert.equal(noBudget.status, 'missing_data');
  const empty = BE.budgetBonusQuarter([], { nowYM: '2027-01' });
  assert.equal(empty.status, 'not_enabled');
});

test('running quarter: forecast from the months read so far; a missing month borrows the average cost and the last budget', () => {
  const r = BE.budgetBonusQuarter(Q4({ cost: 90, budget: 100 }, { cost: 110, budget: 100 }, { available: false }), { nowYM: '2026-11' });
  assert.equal(r.settled, false);
  assert.deepEqual([r.spent, r.forecast, r.forecastBudget, r.status], [200, 300, 300, 'on_track']);
  const risk = BE.budgetBonusQuarter(Q4({ cost: 120, budget: 100 }, { cost: 110, budget: 100 }, { cost: 100, budget: 100 }), { nowYM: '2026-11' });
  assert.equal(risk.status, 'at_risk');
  assert.equal(risk.gap, -30);
  const nothing = BE.budgetBonusQuarter(Q4({ available: false }, { available: false }, { available: false }), { nowYM: '2026-11' });
  assert.equal(nothing.status, 'missing_data');
});

test('a manager change mid-quarter does not matter — the bonus is per HOUSE (no manager in the inputs)', () => {
  const r = BE.budgetBonusQuarter(Q4({ cost: 50, budget: 100, manager: 'א' }, { cost: 50, budget: 100, manager: 'ב' }, { cost: 50, budget: 100 }), { nowYM: '2027-02', amount: 500 });
  assert.equal(r.status, 'earned');
});

test('junk amount / cost values never become money', () => {
  const r = BE.budgetBonusQuarter(Q4({ cost: 'abc', budget: 100 }, { cost: 10, budget: 100 }, { cost: 10, budget: 100 }), { nowYM: '2027-01', amount: -5 });
  assert.equal(r.amount, null);
  assert.equal(r.status, 'missing_data');
});
