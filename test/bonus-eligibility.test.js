const test = require('node:test');
const assert = require('node:assert/strict');
const {
  qualifiesMonthly,
  monthlyBonusAmount,
  securedFloor,
  tierForPatients,
  treatmentTarget,
  thresholdOf,
  GATE_RATIO
} = require('../lib/bonus-eligibility');

/* Tier driven by AVERAGE DAILY occupancy (h.avgDaily). A tier is reached only
   when avgDaily meets the whole-number threshold: Ramot 17/19/20, others
   10/12/13. Amount pays only if treatment-days >= 100% of (tierPatients ×
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

test('Ramot threshold is 17', () => {
  assert.equal(thresholdOf({ key: 'ramot' }), 17);
});

test('Ramot does NOT qualify at avg 16.9', () => {
  assert.equal(qualifiesMonthly({ key: 'ramot', avgDaily: 16.9 }), false);
});

test('Ramot qualifies at avg 17.0', () => {
  assert.equal(qualifiesMonthly({ key: 'ramot', avgDaily: 17.0 }), true);
});

test('other houses threshold 10', () => {
  assert.equal(thresholdOf({ key: 'raanana' }), 10);
  assert.equal(thresholdOf({ key: 'efroni' }), 10);
  assert.equal(thresholdOf({ key: 'rehab' }), 10);
});

test('falls back to patientsNow when avgDaily absent', () => {
  assert.equal(qualifiesMonthly({ key: 'ramot', patientsNow: 17 }), true);
  assert.equal(qualifiesMonthly({ key: 'ramot', patientsNow: 16 }), false);
});

test('Ramot avg 17.0 → 2000 (tier 1)', () => {
  const t = tierForPatients({ key: 'ramot', avgDaily: 17.0 });
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

test('Ramot avg 16.9 → 0', () => {
  assert.equal(tierForPatients({ key: 'ramot', avgDaily: 16.9 }).amount, 0);
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

test('target = tierPatients × daysInMonth (17 × 31 = 527)', () => {
  assert.equal(treatmentTarget(17, 31), 527);
});

test('target falls back to 30 days when daysInMonth invalid', () => {
  assert.equal(treatmentTarget(17, 0), 510);
});

test('Ramot avg 17, days 527 (= full target 17×31) → 2000', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 17, treatmentDays: 527 }, resolveThreshold, DAYS_31);
  assert.equal(r.gatePassed, true);
  assert.equal(r.amount, 2000);
});

test('Ramot avg 17, days 526 (< full target 527) → gate fails, 0', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 17, treatmentDays: 526 }, resolveThreshold, DAYS_31);
  assert.equal(r.eligible, true);
  assert.equal(r.gatePassed, false);
  assert.equal(r.amount, 0);
});

test('Ramot avg 19, sufficient days → 2500', () => {
  // tier-2 target = 19 × 31 = 589; full gate needs >= 589.
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 19, treatmentDays: 589 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2500);
});

test('Ramot avg 18.9 high days → still 2000 (tier from avg)', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 18.9, treatmentDays: 600 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2000);
});

test('Ramot avg 16.9 → 0 regardless of days', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 16.9, treatmentDays: 9999 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

test('minRequired = GATE_RATIO × target', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 17, treatmentDays: 527 }, resolveThreshold, DAYS_31);
  assert.equal(r.target, 527);
  assert.equal(r.minRequired, GATE_RATIO * 527);
});

test('null house → amount 0', () => {
  const r = monthlyBonusAmount(null, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

/* securedFloor — the HIGHEST tier already secured mid-month (occupancy + a
   full days-so-far gate against tierPatients × daysInMonth). Targets below use a
   30-day month: tier-1 (10) = 300, tier-2 (12) = 360; Ramot tier-1 (17) = 510. */
const DAYS_30 = 30;

test("Ra'anana avg 11 with 300/300 → tier-1 (2000) secured", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 300);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
  assert.equal(f.tierPatients, 10);
  assert.equal(f.target, 300);
  assert.equal(f.minRequired, GATE_RATIO * 300);
});

test("Ra'anana avg 11 with 299 days → nothing secured (boundary)", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 299);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

test("Ra'anana avg 11 with 360 days → still tier-1 (occupancy 11 < 12)", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 360);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
});

test("Ra'anana avg 12 with 360 days → tier-2 (2500)", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 12 }, resolveThreshold, DAYS_30, 360);
  assert.equal(f.tier, 2);
  assert.equal(f.amount, 2500);
  assert.equal(f.tierPatients, 12);
  assert.equal(f.target, 360);
});

test("Ra'anana avg 9 → nothing secured", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 9 }, resolveThreshold, DAYS_30, 9999);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

test('Ramot avg 18 with 510 days (= full target 17×30) → tier-1 (2000) secured', () => {
  const f = securedFloor({ key: 'ramot', avgDaily: 18 }, resolveThreshold, DAYS_30, 510);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
  assert.equal(f.tierPatients, 17);
  assert.equal(f.target, 510);
});

test('securedFloor null house → all zeros', () => {
  const f = securedFloor(null, resolveThreshold, DAYS_30, 9999);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});
