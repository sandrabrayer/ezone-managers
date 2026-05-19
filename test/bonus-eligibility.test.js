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

/* ============================================================
   Detail-page breakdown semantics — per-tier "paid" amounts.

   renderBreakdown derives per-tier "paid" flags from monthlyBonusAmount:
     tier1Paid = mr.eligible                                  (floor when below 300)
     tier2Paid = mr.eligible && treatment-days >= TIER2_DAYS  (360)
     tier3Paid = mr.eligible && treatment-days >= TIER3_DAYS  (420)
   These tests pin down the per-tier amount the breakdown row should display.
   ============================================================ */

const { TIER1_DAYS, TIER2_DAYS, TIER3_DAYS,
        TIER1_AMOUNT, TIER2_AMOUNT, TIER3_AMOUNT } = require('../lib/bonus-eligibility');

function breakdownTierAmounts(h, days = DAYS_IN_MONTH) {
  const r = monthlyBonusAmount(h, resolveBep, days);
  const nights = (h.bonus && Number.isFinite(h.bonus.treatmentNights))
    ? h.bonus.treatmentNights
    : (Number.isFinite(h.treatmentDays) ? h.treatmentDays : 0);
  return {
    tier1: r.eligible ? TIER1_AMOUNT : 0,
    tier2: (r.eligible && nights >= TIER2_DAYS) ? TIER2_AMOUNT : 0,
    tier3: (r.eligible && nights >= TIER3_DAYS) ? TIER3_AMOUNT : 0,
    effectiveTier: r.eligible ? r.tier : 0,
    usedFallback: r.usedFallback,
    totalMonthly: r.amount
  };
}

test('detail breakdown: Raanana-like fallback (aboveBepDays 0, patientsNow>=bep, low days) → tier 1 floor 2000, others 0', () => {
  // Mirrors the Raanana case the user described: backend not yet supplying
  // aboveBepDays, snapshot eligible, treatment-days well below 300.
  const raanana = {
    key: 'raanana',
    bep: 10,
    patientsNow: 10,        // == BEP — snapshot eligible
    treatmentDays: 80,      // well below tier-1 threshold of 300
    bonus: { aboveBepDays: 0, bep: 10 }
  };
  const b = breakdownTierAmounts(raanana);
  assert.equal(b.tier1, 2000);
  assert.equal(b.tier2, 0);
  assert.equal(b.tier3, 0);
  assert.equal(b.effectiveTier, 1);
  assert.equal(b.usedFallback, true);
  assert.equal(b.totalMonthly, 2000);
});

test('detail breakdown: eligible + below tier-1 days → tier-1 line shows 2000 (floor), tier-2/3 show 0', () => {
  const h = {
    bep: 8, patientsNow: 10, treatmentDays: 200,
    bonus: { aboveBepDays: 26 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier1, 2000);
  assert.equal(b.tier2, 0);
  assert.equal(b.tier3, 0);
  assert.equal(b.effectiveTier, 1);
});

test('detail breakdown: eligible at tier-2 days (>=360) → tier-1 and tier-2 lines both show their amounts; tier-3 shows 0', () => {
  // Mirrors the original convention: each reached tier line shows its amount;
  // lower lines are visually dimmed (the SINGLE-best tier is the payable).
  const h = {
    bep: 8, patientsNow: 10, treatmentDays: 380,
    bonus: { aboveBepDays: 27 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier1, 2000);
  assert.equal(b.tier2, 2500);
  assert.equal(b.tier3, 0);
  assert.equal(b.effectiveTier, 2);
  assert.equal(b.totalMonthly, 2500);
});

test('detail breakdown: eligible at tier-3 days (>=420) → all three tier lines show amounts', () => {
  const h = {
    bep: 8, patientsNow: 12, treatmentDays: 450,
    bonus: { aboveBepDays: 29 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier1, 2000);
  assert.equal(b.tier2, 2500);
  assert.equal(b.tier3, 3500);
  assert.equal(b.effectiveTier, 3);
  assert.equal(b.totalMonthly, 3500);
});

test('detail breakdown: occupancy gate fails → ALL tier lines show 0 regardless of treatment-days', () => {
  // 20/30 = 66.7% → gate fails. Even with 450 treatment-days, breakdown rows are 0.
  const h = {
    bep: 8, patientsNow: 10, treatmentDays: 450,
    bonus: { aboveBepDays: 20 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier1, 0);
  assert.equal(b.tier2, 0);
  assert.equal(b.tier3, 0);
  assert.equal(b.effectiveTier, 0);
  assert.equal(b.totalMonthly, 0);
});

test('detail breakdown: snapshot fallback + low patientsNow → all tier lines 0', () => {
  const h = {
    bep: 10, patientsNow: 6, treatmentDays: 380,
    bonus: {}  // aboveBepDays missing → fallback path
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier1, 0);
  assert.equal(b.tier2, 0);
  assert.equal(b.tier3, 0);
  assert.equal(b.usedFallback, true);
});

test('detail breakdown: boundary at exactly 360 treatment-days → tier-2 paid', () => {
  const h = {
    bep: 8, patientsNow: 10, treatmentDays: 360,
    bonus: { aboveBepDays: 28 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier2, 2500);
  assert.equal(b.effectiveTier, 2);
});

test('detail breakdown: boundary at 359 treatment-days → tier-1 only (still floor amount)', () => {
  const h = {
    bep: 8, patientsNow: 10, treatmentDays: 359,
    bonus: { aboveBepDays: 28 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier1, 2000);
  assert.equal(b.tier2, 0);
  assert.equal(b.effectiveTier, 1);
});

test('detail breakdown: boundary at exactly 420 treatment-days → tier-3 paid', () => {
  const h = {
    bep: 8, patientsNow: 10, treatmentDays: 420,
    bonus: { aboveBepDays: 28 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier3, 3500);
  assert.equal(b.effectiveTier, 3);
});

test('detail breakdown: treatment-days reads from bonus.treatmentNights when present', () => {
  const h = {
    bep: 8, patientsNow: 10,
    bonus: { aboveBepDays: 28, treatmentNights: 380 }
  };
  const b = breakdownTierAmounts(h);
  assert.equal(b.tier2, 2500);
  assert.equal(b.effectiveTier, 2);
});

/* ===== Outpatient-continuation formula text (step 4) =====
 * Guards the "בונוס הפניות להמשך טיפול" explanation line so it never
 * contradicts a non-zero amount. The 5%-of-package feed (DASHBOARD step
 * 3) sends per-therapy counts as 0 and only `total`. */
const { continuityFormulaText } = require('../lib/bonus-eligibility');

test('continuity formula: 5% feed (no buckets, has total) -> package text', () => {
  const txt = continuityFormulaText({ maintenance: 0, day_2x: 0, day_daily: 0, total: 210 });
  assert.equal(txt, '5% מהחבילה החודשית של מטופלי המשך טיפול');
});

test('continuity formula: nothing at all -> no active referrals', () => {
  assert.equal(
    continuityFormulaText({ maintenance: 0, day_2x: 0, day_daily: 0, total: 0 }),
    'אין הפניות פעילות החודש'
  );
  assert.equal(continuityFormulaText(undefined), 'אין הפניות פעילות החודש');
  assert.equal(continuityFormulaText({}), 'אין הפניות פעילות החודש');
});

test('continuity formula: legacy buckets still render the flat-rate breakdown', () => {
  assert.equal(
    continuityFormulaText({ maintenance: 2, day_2x: 0, day_daily: 1, total: 1200 }),
    '2 תחזוקתי × 100 · 1 יום יומי × 1,000'
  );
});

test('continuity formula: buckets take precedence over total when present', () => {
  // If any legacy bucket is set, show the bucket breakdown (legacy path).
  assert.equal(
    continuityFormulaText({ maintenance: 1, day_2x: 0, day_daily: 0, total: 999 }),
    '1 תחזוקתי × 100'
  );
});

test('continuity formula: non-zero total never yields the empty message', () => {
  const txt = continuityFormulaText({ total: 1 });
  assert.notEqual(txt, 'אין הפניות פעילות החודש');
});
