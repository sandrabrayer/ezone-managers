'use strict';
/* Quarterly manpower-budget adherence bonus (Sandra, 14 Nov 2026) —
 * lib/bonus-eligibility.js budgetBonusQuarter / calendarQuarterOf. */
const test = require('node:test');
const assert = require('node:assert/strict');
const BE = require('../lib/bonus-eligibility');

// Q1 2027 — the first quarter of the quarterly bonus (Sandra, 15 Nov 2026).
const Q4 = (a, b, c) => [
  Object.assign({ ym: '2027-01', available: true }, a),
  Object.assign({ ym: '2027-02', available: true }, b),
  Object.assign({ ym: '2027-03', available: true }, c)
];

test('calendar quarters: Q1 Jan–Mar … Q4 Oct–Dec', () => {
  assert.deepEqual(BE.calendarQuarterOf('2026-11').months, ['2026-10', '2026-11', '2026-12']);
  assert.equal(BE.calendarQuarterOf('2026-11').label, 'רבעון 4 2026');
  assert.deepEqual(BE.calendarQuarterOf('2027-01').months, ['2027-01', '2027-02', '2027-03']);
  assert.deepEqual(BE.calendarQuarterOf('2027-06').months, ['2027-04', '2027-05', '2027-06']);
  assert.equal(BE.calendarQuarterOf('2026-13'), null);
  assert.equal(BE.calendarQuarterOf(''), null);
});

test('rules (Sandra, 15 Nov 2026): 6,000 ₪ per quarter from Q1 2027; Q4 2026 is NOT a bonus quarter', () => {
  assert.deepEqual(BE.BUDGET_BONUS_RULES, [{ from: '2027-01', amount: 6000 }]);
  assert.equal(BE.budgetBonusRuleFor('2026-12'), null);
  assert.deepEqual(BE.budgetBonusRuleFor('2027-01'), { from: '2027-01', amount: 6000 });
  assert.equal(BE.budgetBonusQuarter(Q4({ cost: 1, budget: 2 }, { cost: 1, budget: 2 }, { cost: 1, budget: 2 }), { nowYM: '2027-02' }).amount, 6000);
  const q4 = BE.budgetBonusQuarter([{ ym: '2026-10', available: true, cost: 1, budget: 2 }, { ym: '2026-11', available: true, cost: 1, budget: 2 }, { ym: '2026-12', available: true, cost: 1, budget: 2 }], { nowYM: '2027-01' });
  assert.equal(q4.status, 'not_enabled', 'Q4 2026 never pays the quarterly bonus');
  assert.equal(q4.startsLabel, 'רבעון 1 2027');
  assert.equal(q4.startsAmount, 6000);
});

test('December 2026: a one-off 2,500 ₪ when December\'s cost is within December\'s target — independent of the quarter', () => {
  assert.deepEqual(BE.BUDGET_MONTH_BONUSES, [{ month: '2026-12', amount: 2500 }]);
  assert.equal(BE.budgetMonthBonusRuleFor('2026-11'), null);
  assert.equal(BE.budgetMonthBonusRuleFor('2027-12'), null, 'December 2026 only');
  const at = BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 100000, budget: 100000 }, { nowYM: '2027-01' });
  assert.deepEqual([at.status, at.amount, at.settled, at.gap], ['earned', 2500, true, 0]);
  const over = BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 100001, budget: 100000 }, { nowYM: '2027-01' });
  assert.deepEqual([over.status, over.gap], ['not_earned', -1]);
  const early = BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 90, budget: 100 }, { nowYM: '2026-11' });
  assert.deepEqual([early.status, early.settled, early.future], ['on_track', false, true]);
  assert.equal(BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 110, budget: 100 }, { nowYM: '2026-12' }).status, 'at_risk');
  assert.equal(BE.budgetBonusMonth({ ym: '2026-12', available: false }, { nowYM: '2027-01' }).status, 'missing_data', 'unreadable → never a pass');
  assert.equal(BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 10, budget: null }, { nowYM: '2027-01' }).status, 'missing_data', 'no target → never a pass');
  assert.equal(BE.budgetBonusMonth({ ym: '2026-11', available: true, cost: 1, budget: 2 }, { nowYM: '2027-01' }).status, 'not_enabled');
});

test('settled: exactly at budget earns; 1 ₪ over does not', () => {
  const at = BE.budgetBonusQuarter(Q4({ cost: 100, budget: 100 }, { cost: 100, budget: 100 }, { cost: 100, budget: 100 }), { nowYM: '2027-04', amount: 1000 });
  assert.equal(at.settled, true);
  assert.equal(at.status, 'earned');
  assert.deepEqual([at.spent, at.budget, at.pct, at.gap, at.amount], [300, 300, 100, 0, 1000]);
  const over = BE.budgetBonusQuarter(Q4({ cost: 100, budget: 100 }, { cost: 101, budget: 100 }, { cost: 100, budget: 100 }), { nowYM: '2027-04', amount: 1000 });
  assert.equal(over.status, 'not_earned');
  assert.equal(over.gap, -1);
});

test('settled: a month that could not be read, or a month without a budget → missing_data, never a pass', () => {
  const gone = BE.budgetBonusQuarter(Q4({ cost: 10, budget: 100 }, { available: false }, { cost: 10, budget: 100 }), { nowYM: '2027-04', amount: 1000 });
  assert.equal(gone.status, 'missing_data');
  const noBudget = BE.budgetBonusQuarter(Q4({ cost: 10, budget: 100 }, { cost: 10, budget: null }, { cost: 10, budget: 100 }), { nowYM: '2027-04', amount: 1000 });
  assert.equal(noBudget.status, 'missing_data');
  const empty = BE.budgetBonusQuarter([], { nowYM: '2027-01' });
  assert.equal(empty.status, 'not_enabled');
});

test('running quarter: forecast from the months read so far; a missing month borrows the average cost and the last budget', () => {
  const r = BE.budgetBonusQuarter(Q4({ cost: 90, budget: 100 }, { cost: 110, budget: 100 }, { available: false }), { nowYM: '2027-02' });
  assert.equal(r.settled, false);
  assert.deepEqual([r.spent, r.forecast, r.forecastBudget, r.status], [200, 300, 300, 'on_track']);
  const risk = BE.budgetBonusQuarter(Q4({ cost: 120, budget: 100 }, { cost: 110, budget: 100 }, { cost: 100, budget: 100 }), { nowYM: '2027-02' });
  assert.equal(risk.status, 'at_risk');
  assert.equal(risk.gap, -30);
  const nothing = BE.budgetBonusQuarter(Q4({ available: false }, { available: false }, { available: false }), { nowYM: '2027-02' });
  assert.equal(nothing.status, 'missing_data');
});

test('a manager change mid-quarter does not matter — the bonus is per HOUSE (no manager in the inputs)', () => {
  const r = BE.budgetBonusQuarter(Q4({ cost: 50, budget: 100, manager: 'א' }, { cost: 50, budget: 100, manager: 'ב' }, { cost: 50, budget: 100 }), { nowYM: '2027-05', amount: 500 });
  assert.equal(r.status, 'earned');
});

test('junk amount / cost values never become money', () => {
  const r = BE.budgetBonusQuarter(Q4({ cost: 'abc', budget: 100 }, { cost: 10, budget: 100 }, { cost: 10, budget: 100 }), { nowYM: '2027-04', amount: -5 });
  assert.equal(r.amount, null);
  assert.equal(r.status, 'missing_data');
});
