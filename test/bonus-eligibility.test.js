const test = require('node:test');
const assert = require('node:assert/strict');
const { qualifiesMonthly, monthlyBonusAmount } = require('../lib/bonus-eligibility');

// Mirrors public/app.js resolveBep: prefer h.bep, then h.bonus.bep.
const resolveBep = h => {
  if (!h) return 0;
  if (Number.isFinite(h.bep)) return h.bep;
  if (h.bonus && Number.isFinite(h.bonus.bep)) return h.bonus.bep;
  return 0;
};

test('returns false when house is null or undefined', () => {
  assert.equal(qualifiesMonthly(null, resolveBep), false);
  assert.equal(qualifiesMonthly(undefined, resolveBep), false);
});

test('qualifies when patientsNow exceeds bep', () => {
  const h = { bep: 8, patientsNow: 12 };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('qualifies when patientsNow exactly equals bep', () => {
  const h = { bep: 8, patientsNow: 8 };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('does not qualify when patientsNow is below bep', () => {
  const h = { bep: 8, patientsNow: 7 };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test("Ra'anana case: backend says qualifies:false but patientsNow == bonus.bep — qualifies", () => {
  // Real-world regression: backend's stale flag would have hidden bonus eligibility.
  // patientsNow 10, bonus.bep 10 — exactly at BEP, so should qualify.
  const raanana = { key: 'raanana', patientsNow: 10, qualifies: false, bonus: { bep: 10, qualifies: false } };
  assert.equal(qualifiesMonthly(raanana, resolveBep), true);
});

test('backend h.bonus.qualifies = true does NOT override low occupancy', () => {
  const h = { patientsNow: 0, bonus: { bep: 10, qualifies: true } };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test('backend h.qualifies = true does NOT override low occupancy', () => {
  const h = { patientsNow: 3, bep: 10, qualifies: true };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test('backend flags do not flip a genuinely-qualifying house to false', () => {
  const h = { patientsNow: 15, bep: 10, qualifies: false, bonus: { qualifies: false } };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('resolveBep falls back to bonus.bep when h.bep is absent', () => {
  const h = { patientsNow: 10, bonus: { bep: 10 } };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('missing patientsNow is treated as 0', () => {
  const h = { bep: 8 };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test('non-finite patientsNow is treated as 0', () => {
  assert.equal(qualifiesMonthly({ bep: 8, patientsNow: NaN }, resolveBep), false);
  assert.equal(qualifiesMonthly({ bep: 8, patientsNow: 'lots' }, resolveBep), false);
});

test('resolveBep is invoked with the house object', () => {
  let received = null;
  const spy = h => { received = h; return 5; };
  const h = { bep: 8, patientsNow: 5 };
  qualifiesMonthly(h, spy);
  assert.equal(received, h);
});

test('resolveBep return value, not h.bep, drives the comparison', () => {
  const h = { bep: 999, patientsNow: 6 };
  assert.equal(qualifiesMonthly(h, () => 5), true);
  assert.equal(qualifiesMonthly(h, () => 7), false);
});

test('missing resolveBep does not throw; bep defaults to 0', () => {
  assert.equal(qualifiesMonthly({ patientsNow: 1 }), true);
  assert.equal(qualifiesMonthly({ patientsNow: 0 }), true);
});

/* ============================================================
   monthlyBonusAmount — 80% occupancy gate with tiered amount
   ============================================================ */

// 80% of 30 = 24 days → aboveBepDays >= 24 passes the gate.
const DAYS_IN_MONTH = 30;

test('eligible by occupancy + below tier-1 days (< 300) pays the 2000 floor', () => {
  // 26/30 days above BEP = 86.7% (passes 80%), only 250 treatment-days (< 300).
  const h = {
    bep: 8,
    patientsNow: 10,
    treatmentDays: 250,
    bonus: { aboveBepDays: 26 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.eligible, true);
  assert.equal(r.amount, 2000);
  assert.equal(r.tier, 1);
  assert.equal(r.usedFallback, false);
});

test('eligible by occupancy + tier-2 treatment-days (>=360) pays 2500', () => {
  const h = {
    bep: 8,
    patientsNow: 10,
    treatmentDays: 380,
    bonus: { aboveBepDays: 28 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.eligible, true);
  assert.equal(r.amount, 2500);
  assert.equal(r.tier, 2);
  assert.equal(r.usedFallback, false);
});

test('eligible by occupancy + tier-3 treatment-days (>=420) pays 3500', () => {
  const h = {
    bep: 8,
    patientsNow: 12,
    treatmentDays: 450,
    bonus: { aboveBepDays: 29 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.amount, 3500);
  assert.equal(r.tier, 3);
});

test('occupancy gate fails (< 80%) → amount is 0 even with high treatment-days', () => {
  // 20/30 days above BEP = 66.7% (fails 80%), 380 treatment-days would otherwise be tier-2.
  const h = {
    bep: 8,
    patientsNow: 10,
    treatmentDays: 380,
    bonus: { aboveBepDays: 20 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.eligible, false);
  assert.equal(r.amount, 0);
  assert.equal(r.tier, 0);
  assert.equal(r.usedFallback, false);
});

test('snapshot fallback: aboveBepDays missing/0 but patientsNow >= bep → 2000 with usedFallback', () => {
  // aboveBepDays is 0 → use snapshot. patientsNow (10) >= bep (8) so eligible via fallback.
  // treatment-days low (< 300) so we get the floor 2000.
  const h = {
    bep: 8,
    patientsNow: 10,
    treatmentDays: 120,
    bonus: { aboveBepDays: 0 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.eligible, true);
  assert.equal(r.amount, 2000);
  assert.equal(r.tier, 1);
  assert.equal(r.usedFallback, true);
});

test('snapshot fallback: missing aboveBepDays + patientsNow < bep → not eligible, amount 0', () => {
  const h = {
    bep: 10,
    patientsNow: 6,
    treatmentDays: 200,
    bonus: {}
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.eligible, false);
  assert.equal(r.amount, 0);
  assert.equal(r.usedFallback, true);
});

test('exactly 80% occupancy passes the gate (>= threshold, not strictly greater)', () => {
  // 24/30 = 0.8 exactly.
  const h = {
    bep: 8,
    patientsNow: 0,
    treatmentDays: 100,
    bonus: { aboveBepDays: 24 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.eligible, true);
  assert.equal(r.amount, 2000);
  assert.equal(r.usedFallback, false);
});

test('aboveBepDays present (>0) trumps low patientsNow snapshot', () => {
  // Real signal says >80% above BEP; snapshot is low (patientsNow 0). Gate wins.
  const h = {
    bep: 8,
    patientsNow: 0,
    treatmentDays: 380,
    bonus: { aboveBepDays: 28 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.amount, 2500);
  assert.equal(r.usedFallback, false);
});

test('null/undefined house → not eligible, amount 0', () => {
  assert.deepEqual(monthlyBonusAmount(null, resolveBep, DAYS_IN_MONTH),
    { amount: 0, tier: 0, eligible: false, usedFallback: false });
  assert.deepEqual(monthlyBonusAmount(undefined, resolveBep, DAYS_IN_MONTH),
    { amount: 0, tier: 0, eligible: false, usedFallback: false });
});

test('treatment-days read from bonus.treatmentNights when present', () => {
  const h = {
    bep: 8,
    patientsNow: 10,
    bonus: { aboveBepDays: 28, treatmentNights: 380 }
  };
  const r = monthlyBonusAmount(h, resolveBep, DAYS_IN_MONTH);
  assert.equal(r.amount, 2500);
});

test('daysInMonth=31: 25/31 = 80.6% passes; 24/31 = 77.4% fails', () => {
  const eligible = {
    bep: 8, patientsNow: 10, treatmentDays: 100,
    bonus: { aboveBepDays: 25 }
  };
  const notEligible = {
    bep: 8, patientsNow: 10, treatmentDays: 100,
    bonus: { aboveBepDays: 24 }
  };
  assert.equal(monthlyBonusAmount(eligible, resolveBep, 31).eligible, true);
  assert.equal(monthlyBonusAmount(notEligible, resolveBep, 31).eligible, false);
});
