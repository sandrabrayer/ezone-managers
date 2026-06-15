const test = require('node:test');
const assert = require('node:assert/strict');
const {
  qualifiesMonthly,
  monthlyBonusAmount,
  tierForPatients,
  treatmentTarget,
  thresholdOf,
  GATE_RATIO
} = require('../lib/bonus-eligibility');

/* Tier driven by AVERAGE DAILY occupancy (h.avgDaily). A tier is reached only
   when avgDaily meets the whole-number threshold: Ramot 18/19/20, others
   10/12/13. Amount pays only if treatment-days >= 95% of (tierPatients ×
   daysInMonth). */

const resolveThreshold = h => {
  if (!h) return 0;
  if (Number.isFinite(h.bonusThreshold)) return h.bonusThreshold;
  if (Number.isFinite(h.threshold)) return h.threshold;
  return 0;
};
const DAYS_31 = 31;

test('null/undefined house → not eligible', () => {
  assert.equal(qualifiesMonthly(null, resolveThreshold), false);
  assert.equal(qualifiesMonthly(undefined, resolveThreshold), false);
});

test('Ramot threshold is 18', () => {
  assert.equal(thresholdOf({ key: 'ramot' }), 18);
});

test('Ramot does NOT qualify at avg 17.9', () => {
  assert.equal(qualifiesMonthly({ key: 'ramot', avgDaily: 17.9 }), false);
});

test('Ramot qualifies at avg 18.0', () => {
  assert.equal(qualifiesMonthly({ key: 'ramot', avgDaily: 18.0 }), true);
});

test('other houses threshold 10', () => {
  assert.equal(thresholdOf({ key: 'raanana' }), 10);
  assert.equal(thresholdOf({ key: 'efroni' }), 10);
  assert.equal(thresholdOf({ key: 'rehab' }), 10);
});

test('falls back to patientsNow when avgDaily absent', () => {
  assert.equal(qualifiesMonthly({ key: 'ramot', patientsNow: 18 }), true);
  assert.equal(qualifiesMonthly({ key: 'ramot', patientsNow: 17 }), false);
});

test('Ramot avg 18.0 → 2000 (tier 1)', () => {
  const t = tierForPatients({ key: 'ramot', avgDaily: 18.0 });
  assert.equal(t.amount, 2000);
  assert.equal(t.tier, 1);
});

test('Ramot avg 18.9 → still 2000 (does NOT reach 19)', () => {
  assert.equal(tierForPatients({ key: 'ramot', avgDaily: 18.9 }).amount, 2000);
});

test('Ramot avg 19.0 → 2500 (tier 2)', () => {
  const t = tierForPatients({ key: 'ramot', avgDaily: 19.0 });
  assert.equal(t.amount, 2500);
  assert.equal(t.tier, 2);
});

test('Ramot avg 20.0 → 3500 (tier 3)', () => {
  assert.equal(tierForPatients({ key: 'ramot', avgDaily: 20.0 }).amount, 3500);
});

test('Ramot avg 17.9 → 0', () => {
  assert.equal(tierForPatients({ key: 'ramot', avgDaily: 17.9 }).amount, 0);
});

for (const key of ['raanana', 'efroni', 'rehab']) {
  test(`${key}: avg 10→2000, 11.9→2000, 12→2500, 13→3500, 9.9→0`, () => {
    assert.equal(tierForPatients({ key, avgDaily: 10 }).amount, 2000);
    assert.equal(tierForPatients({ key, avgDaily: 11.9 }).amount, 2000);
    assert.equal(tierForPatients({ key, avgDaily: 12 }).amount, 2500);
    assert.equal(tierForPatients({ key, avgDaily: 13 }).amount, 3500);
    assert.equal(tierForPatients({ key, avgDaily: 9.9 }).amount, 0);
  });
}

test('target = tierPatients × daysInMonth (18 × 31 = 558)', () => {
  assert.equal(treatmentTarget(18, 31), 558);
});

test('target falls back to 30 days when daysInMonth invalid', () => {
  assert.equal(treatmentTarget(18, 0), 540);
});

test('Ramot avg 18, days 531 (≥95% of 558) → 2000', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 18, treatmentDays: 531 }, resolveThreshold, DAYS_31);
  assert.equal(r.gatePassed, true);
  assert.equal(r.amount, 2000);
});

test('Ramot avg 18, days 530 (<95% of 558) → gate fails, 0', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 18, treatmentDays: 530 }, resolveThreshold, DAYS_31);
  assert.equal(r.eligible, true);
  assert.equal(r.gatePassed, false);
  assert.equal(r.amount, 0);
});

test('Ramot avg 19, sufficient days → 2500', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 19, treatmentDays: 570 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2500);
});

test('Ramot avg 18.9 high days → still 2000 (tier from avg)', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 18.9, treatmentDays: 600 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2000);
});

test('Ramot avg 17.9 → 0 regardless of days', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 17.9, treatmentDays: 9999 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

test('minRequired = GATE_RATIO × target', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 18, treatmentDays: 558 }, resolveThreshold, DAYS_31);
  assert.equal(r.minRequired, GATE_RATIO * 558);
});

test('null house → amount 0', () => {
  const r = monthlyBonusAmount(null, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});
