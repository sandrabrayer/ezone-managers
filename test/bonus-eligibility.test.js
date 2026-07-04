const test = require('node:test');
const assert = require('node:assert/strict');
const {
  qualifiesMonthly,
  monthlyBonusAmount,
  securedFloor,
  tierForPatients,
  treatmentTarget,
  gateTarget,
  thresholdOf,
  GATE_DAYS_FACTOR
} = require('../lib/bonus-eligibility');

/* Model: tier by AVERAGE DAILY occupancy (whole-number thresholds), paid only
   when the month's treatment-days reach the FIXED house gate:
   threshold × 30 (Ramot 17×30=510; others 10×30=300), for every month. */

const resolveThreshold = h => {
  if (!h) return 0;
  if (Number.isFinite(h.bonusThreshold)) return h.bonusThreshold;
  if (Number.isFinite(h.threshold)) return h.threshold;
  return 0;
};
const DAYS_31 = 31;
const DAYS_28 = 28;

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

for (const key of ['efroni', 'rehab']) {
  test(`${key}: avg 10→2000, 11.9→2000, 12→2500, 13→3500, 9.9→0`, () => {
    assert.equal(tierForPatients({ key, avgDaily: 10 }).amount, 2000);
    assert.equal(tierForPatients({ key, avgDaily: 11.9 }).amount, 2000);
    assert.equal(tierForPatients({ key, avgDaily: 12 }).amount, 2500);
    assert.equal(tierForPatients({ key, avgDaily: 13 }).amount, 3500);
    assert.equal(tierForPatients({ key, avgDaily: 9.9 }).amount, 0);
  });
}

/* ── The FIXED gate: threshold × 30 ── */

test('GATE_DAYS_FACTOR is 30', () => {
  assert.equal(GATE_DAYS_FACTOR, 30);
});

test('gateTarget: Ramot 510, others 300 — independent of month', () => {
  assert.equal(gateTarget({ key: 'ramot' }), 510);
  assert.equal(gateTarget({ key: 'raanana' }), 300);
  assert.equal(gateTarget({ key: 'efroni' }), 300);
  assert.equal(gateTarget({ key: 'rehab' }), 300);
});

test('legacy treatmentTarget still = tierPatients × daysInMonth', () => {
  assert.equal(treatmentTarget(17, 31), 527);
  assert.equal(treatmentTarget(17, 0), 510);
});

test('Ramot avg 17, days 510 (= gate 17×30) → 2000, in a 31-day month too', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 17, treatmentDays: 510 }, resolveThreshold, DAYS_31);
  assert.equal(r.gatePassed, true);
  assert.equal(r.amount, 2000);
  assert.equal(r.target, 510);
  assert.equal(r.minRequired, 510);
});

test('Ramot avg 17, days 509 (< gate 510) → gate fails, 0', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 17, treatmentDays: 509 }, resolveThreshold, DAYS_31);
  assert.equal(r.eligible, true);
  assert.equal(r.gatePassed, false);
  assert.equal(r.amount, 0);
});

test('gate is the SAME in February (28 days): Ramot needs 510', () => {
  const fail = monthlyBonusAmount({ key: 'ramot', avgDaily: 18, treatmentDays: 509 }, resolveThreshold, DAYS_28);
  assert.equal(fail.amount, 0);
  const pass = monthlyBonusAmount({ key: 'ramot', avgDaily: 18.2, treatmentDays: 510 }, resolveThreshold, DAYS_28);
  assert.equal(pass.amount, 2000);
});

test('gate does NOT grow with the tier: Ramot avg 19, days 510 → 2500', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 19, treatmentDays: 510 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2500);
  assert.equal(r.target, 510);
});

test("Ra'anana avg 14, days 300 (= gate 10×30) → 3500", () => {
  const r = monthlyBonusAmount({ key: 'raanana', avgDaily: 14, treatmentDays: 300 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 3500);
});

test("Ra'anana avg 10, days 299 → gate fails, 0", () => {
  const r = monthlyBonusAmount({ key: 'raanana', avgDaily: 10, treatmentDays: 299 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
  assert.equal(r.gatePassed, false);
});

test('Ramot avg 18.9 high days → still 2000 (tier from avg)', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 18.9, treatmentDays: 600 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2000);
});

test('Ramot avg 16.9 → 0 regardless of days', () => {
  const r = monthlyBonusAmount({ key: 'ramot', avgDaily: 16.9, treatmentDays: 9999 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

test('null house → amount 0', () => {
  const r = monthlyBonusAmount(null, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

/* ── securedFloor: single lock condition = daysSoFar >= threshold × 30 ── */
const DAYS_30 = 30;

test("Ra'anana avg 11 with 300/300 → tier-1 (2000) secured", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 300);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
  assert.equal(f.tierPatients, 10);
  assert.equal(f.target, 300);
  assert.equal(f.minRequired, 300);
});

test("Ra'anana avg 11 with 299 days → nothing secured (boundary)", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 299);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

test("Ra'anana avg 12 with 300 days → tier-2 (2500) secured (gate met, tier by occupancy)", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 12 }, resolveThreshold, DAYS_30, 300);
  assert.equal(f.tier, 2);
  assert.equal(f.amount, 2500);
  assert.equal(f.tierPatients, 12);
  assert.equal(f.target, 300);
});

test("Ra'anana avg 9 → nothing secured even with many days", () => {
  const f = securedFloor({ key: 'raanana', avgDaily: 9 }, resolveThreshold, DAYS_30, 9999);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

test('Ramot avg 18 with 510 days (= gate 17×30) → tier-1 (2000) secured', () => {
  const f = securedFloor({ key: 'ramot', avgDaily: 18 }, resolveThreshold, DAYS_30, 510);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
  assert.equal(f.tierPatients, 17);
  assert.equal(f.target, 510);
});

test('Ramot avg 20 with 510 days → tier-3 (3500) secured', () => {
  const f = securedFloor({ key: 'ramot', avgDaily: 20 }, resolveThreshold, DAYS_30, 510);
  assert.equal(f.tier, 3);
  assert.equal(f.amount, 3500);
});

test('securedFloor gate is month-length independent (31-day month, still 510)', () => {
  const f = securedFloor({ key: 'ramot', avgDaily: 18 }, resolveThreshold, 31, 510);
  assert.equal(f.tier, 1);
  assert.equal(f.minRequired, 510);
});

test('securedFloor null house → all zeros', () => {
  const f = securedFloor(null, resolveThreshold, DAYS_30, 9999);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

/* ── Ra'anana tier 3 at 14 patients ── */
test("Ra'anana: 13→2500 (tier 2), 14→3500 (tier 3)", () => {
  assert.equal(tierForPatients({ key: 'raanana', avgDaily: 13 }).amount, 2500);
  assert.equal(tierForPatients({ key: 'raanana', avgDaily: 13.9 }).amount, 2500);
  assert.equal(tierForPatients({ key: 'raanana', avgDaily: 14 }).amount, 3500);
});

/* ── Quarterly: anchored window + standing ── */
const { quarterWindowFor, quarterlyStatus, QUARTERLY_AMOUNT } = require('../lib/bonus-eligibility');

test('quarter windows anchored May 2026', () => {
  assert.deepEqual(quarterWindowFor('2026-05'), ['2026-05', '2026-06', '2026-07']);
  assert.deepEqual(quarterWindowFor('2026-07'), ['2026-05', '2026-06', '2026-07']);
  assert.deepEqual(quarterWindowFor('2026-08'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(quarterWindowFor('2026-12'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(quarterWindowFor('2026-04'), null);
  assert.equal(quarterWindowFor('bad'), null);
});

test('quarterly pays 5000 only when all 3 finished months earned >= 2000', () => {
  const win = ['2026-05', '2026-06', '2026-07'];
  const full = quarterlyStatus(win, { '2026-05': 2000, '2026-06': 2500, '2026-07': 3500 });
  assert.equal(full.monthsMet, 3);
  assert.equal(full.complete, true);
  assert.equal(full.earned, QUARTERLY_AMOUNT);

  const oneMiss = quarterlyStatus(win, { '2026-05': 2000, '2026-06': 0, '2026-07': 3500 });
  assert.equal(oneMiss.monthsMet, 2);
  assert.equal(oneMiss.earned, 0);

  const midQuarter = quarterlyStatus(win, { '2026-05': 2000, '2026-06': 2500 });
  assert.equal(midQuarter.monthsMet, 2);
  assert.equal(midQuarter.monthsFinished, 2);
  assert.equal(midQuarter.complete, false);
  assert.equal(midQuarter.earned, 0);

  const boundary = quarterlyStatus(win, { '2026-05': 1999, '2026-06': 2500, '2026-07': 3500 });
  assert.equal(boundary.earned, 0);
});
