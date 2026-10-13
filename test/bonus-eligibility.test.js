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
   threshold × 30, independent of the month's length.

   The rules are MONTH-AWARE. The tests in this first part are pinned to
   OLD = September 2026 and document the ORIGINAL rules (Ramot 17 → gate 510,
   others 10 → gate 300), which must keep applying to every month up to and
   including Sep 2026. The new rules from Oct 2026 are tested further down. */
const OLD = '2026-09';
const NEW = '2026-10';

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
  assert.equal(thresholdOf({ ym: OLD, key: 'ramot' }), 17);
});

test('Ramot does NOT qualify at avg 16.9', () => {
  assert.equal(qualifiesMonthly({ ym: OLD, key: 'ramot', avgDaily: 16.9 }), false);
});

test('Ramot qualifies at avg 17.0', () => {
  assert.equal(qualifiesMonthly({ ym: OLD, key: 'ramot', avgDaily: 17.0 }), true);
});

test('other houses threshold 10', () => {
  assert.equal(thresholdOf({ ym: OLD, key: 'raanana' }), 10);
  assert.equal(thresholdOf({ ym: OLD, key: 'efroni' }), 10);
  assert.equal(thresholdOf({ ym: OLD, key: 'rehab' }), 10);
  assert.equal(thresholdOf({ ym: OLD, key: 'pardes' }), 10);
});

test('falls back to patientsNow when avgDaily absent', () => {
  assert.equal(qualifiesMonthly({ ym: OLD, key: 'ramot', patientsNow: 17 }), true);
  assert.equal(qualifiesMonthly({ ym: OLD, key: 'ramot', patientsNow: 16 }), false);
});

test('Ramot avg 17.0 → 2000 (tier 1)', () => {
  const t = tierForPatients({ ym: OLD, key: 'ramot', avgDaily: 17.0 });
  assert.equal(t.amount, 2000);
  assert.equal(t.tier, 1);
});

test('Ramot avg 18.9 → still 2000 (does NOT reach 19)', () => {
  assert.equal(tierForPatients({ ym: OLD, key: 'ramot', avgDaily: 18.9 }).amount, 2000);
});

test('Ramot avg 19.0 → 2500 (tier 2)', () => {
  const t = tierForPatients({ ym: OLD, key: 'ramot', avgDaily: 19.0 });
  assert.equal(t.amount, 2500);
  assert.equal(t.tier, 2);
});

test('Ramot avg 20.0 → 3000 (tier 3)', () => {
  assert.equal(tierForPatients({ ym: OLD, key: 'ramot', avgDaily: 20.0 }).amount, 3000);
});

test('Ramot avg 16.9 → 0', () => {
  assert.equal(tierForPatients({ ym: OLD, key: 'ramot', avgDaily: 16.9 }).amount, 0);
});

for (const key of ['efroni', 'rehab', 'pardes']) {
  test(`${key}: avg 10→2000, 11.9→2000, 12→2500, 13→3000, 9.9→0`, () => {
    assert.equal(tierForPatients({ ym: OLD, key, avgDaily: 10 }).amount, 2000);
    assert.equal(tierForPatients({ ym: OLD, key, avgDaily: 11.9 }).amount, 2000);
    assert.equal(tierForPatients({ ym: OLD, key, avgDaily: 12 }).amount, 2500);
    assert.equal(tierForPatients({ ym: OLD, key, avgDaily: 13 }).amount, 3000);
    assert.equal(tierForPatients({ ym: OLD, key, avgDaily: 9.9 }).amount, 0);
  });
}

/* ── The FIXED gate: threshold × 30 ── */

test('GATE_DAYS_FACTOR is 30', () => {
  assert.equal(GATE_DAYS_FACTOR, 30);
});

test('gateTarget: Ramot 510, others 300 — independent of month', () => {
  assert.equal(gateTarget({ ym: OLD, key: 'ramot' }), 510);
  assert.equal(gateTarget({ ym: OLD, key: 'raanana' }), 300);
  assert.equal(gateTarget({ ym: OLD, key: 'efroni' }), 300);
  assert.equal(gateTarget({ ym: OLD, key: 'rehab' }), 300);
  assert.equal(gateTarget({ ym: OLD, key: 'pardes' }), 300);
});

test('legacy treatmentTarget still = tierPatients × daysInMonth', () => {
  assert.equal(treatmentTarget(17, 31), 527);
  assert.equal(treatmentTarget(17, 0), 510);
});

test('Ramot avg 17, days 510 (= gate 17×30) → 2000, in a 31-day month too', () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 17, treatmentDays: 510 }, resolveThreshold, DAYS_31);
  assert.equal(r.gatePassed, true);
  assert.equal(r.amount, 2000);
  assert.equal(r.target, 510);
  assert.equal(r.minRequired, 510);
});

test('Ramot avg 17, days 509 (< gate 510) → gate fails, 0', () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 17, treatmentDays: 509 }, resolveThreshold, DAYS_31);
  assert.equal(r.eligible, true);
  assert.equal(r.gatePassed, false);
  assert.equal(r.amount, 0);
});

test('gate is the SAME in February (28 days): Ramot needs 510', () => {
  const fail = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 18, treatmentDays: 509 }, resolveThreshold, DAYS_28);
  assert.equal(fail.amount, 0);
  const pass = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 18.2, treatmentDays: 510 }, resolveThreshold, DAYS_28);
  assert.equal(pass.amount, 2000);
});

test('gate does NOT grow with the tier: Ramot avg 19, days 510 → 2500', () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 19, treatmentDays: 510 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2500);
  assert.equal(r.target, 510);
});

test("Ra'anana avg 14, days 300 (= gate 10×30) → 3000", () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'raanana', avgDaily: 14, treatmentDays: 300 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 3000);
});

test("Ra'anana avg 10, days 299 → gate fails, 0", () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'raanana', avgDaily: 10, treatmentDays: 299 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
  assert.equal(r.gatePassed, false);
});

test('Ramot avg 18.9 high days → still 2000 (tier from avg)', () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 18.9, treatmentDays: 600 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 2000);
});

test('Ramot avg 16.9 → 0 regardless of days', () => {
  const r = monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 16.9, treatmentDays: 9999 }, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

test('null house → amount 0', () => {
  const r = monthlyBonusAmount(null, resolveThreshold, DAYS_31);
  assert.equal(r.amount, 0);
});

/* ── securedFloor: a step is secured once the days ALREADY counted reach
   max(gate, patients × daysInMonth) — the month's average can then no longer
   fall below it (13 Oct 2026; before, the gate alone locked any tier). ── */
const DAYS_30 = 30;

test("Ra'anana avg 11 with 300/300 → tier-1 (2000) secured", () => {
  const f = securedFloor({ ym: OLD, key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 300);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
  assert.equal(f.tierPatients, 10);
  assert.equal(f.target, 300);
  assert.equal(f.minRequired, 300);
});

test("Ra'anana avg 11 with 299 days → nothing secured (boundary)", () => {
  const f = securedFloor({ ym: OLD, key: 'raanana', avgDaily: 11 }, resolveThreshold, DAYS_30, 299);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

test("Ra'anana avg 12: 300 days secure only tier 1; tier 2 needs 360 days already counted", () => {
  const f = securedFloor({ ym: OLD, key: 'raanana', avgDaily: 12 }, resolveThreshold, DAYS_30, 300);
  assert.deepEqual([f.tier, f.amount, f.target], [1, 2000, 300]);
  const g = securedFloor({ ym: OLD, key: 'raanana', avgDaily: 12 }, resolveThreshold, DAYS_30, 360);
  assert.deepEqual([g.tier, g.amount, g.tierPatients], [2, 2500, 12]);
});

test("Ra'anana avg 9 → nothing secured even with many days", () => {
  const f = securedFloor({ ym: OLD, key: 'raanana', avgDaily: 9 }, resolveThreshold, DAYS_30, 9999);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

test('Ramot avg 18 with 510 days (= gate 17×30) → tier-1 (2000) secured', () => {
  const f = securedFloor({ ym: OLD, key: 'ramot', avgDaily: 18 }, resolveThreshold, DAYS_30, 510);
  assert.equal(f.tier, 1);
  assert.equal(f.amount, 2000);
  assert.equal(f.tierPatients, 17);
  assert.equal(f.target, 510);
});

test('Ramot avg 20: 510 days secure tier 1; tier 3 needs 600 days (20 × 30) already counted', () => {
  assert.equal(securedFloor({ ym: OLD, key: 'ramot', avgDaily: 20 }, resolveThreshold, DAYS_30, 510).amount, 2000);
  const f = securedFloor({ ym: OLD, key: 'ramot', avgDaily: 20 }, resolveThreshold, DAYS_30, 600);
  assert.deepEqual([f.tier, f.amount], [3, 3000]);
});

test('securedFloor in a 31-day month: Ramot tier 1 (17) needs 527 days (17 × 31), not 510', () => {
  assert.equal(securedFloor({ ym: OLD, key: 'ramot', avgDaily: 18 }, resolveThreshold, 31, 526).tier, 0);
  const f = securedFloor({ ym: OLD, key: 'ramot', avgDaily: 18 }, resolveThreshold, 31, 527);
  assert.equal(f.tier, 1);
  assert.equal(f.minRequired, 510, 'the gate itself is still 510');
});

test('securedFloor null house → all zeros', () => {
  const f = securedFloor(null, resolveThreshold, DAYS_30, 9999);
  assert.equal(f.tier, 0);
  assert.equal(f.amount, 0);
});

/* ── Ra'anana tier 3 at 14 patients ── */
test("Ra'anana: 13→2500 (tier 2), 14→3000 (tier 3)", () => {
  assert.equal(tierForPatients({ ym: OLD, key: 'raanana', avgDaily: 13 }).amount, 2500);
  assert.equal(tierForPatients({ ym: OLD, key: 'raanana', avgDaily: 13.9 }).amount, 2500);
  assert.equal(tierForPatients({ ym: OLD, key: 'raanana', avgDaily: 14 }).amount, 3000);
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
  const full = quarterlyStatus(win, { '2026-05': 2000, '2026-06': 2500, '2026-07': 3000 });
  assert.equal(full.monthsMet, 3);
  assert.equal(full.complete, true);
  assert.equal(full.earned, QUARTERLY_AMOUNT);

  const oneMiss = quarterlyStatus(win, { '2026-05': 2000, '2026-06': 0, '2026-07': 3000 });
  assert.equal(oneMiss.monthsMet, 2);
  assert.equal(oneMiss.earned, 0);

  const midQuarter = quarterlyStatus(win, { '2026-05': 2000, '2026-06': 2500 });
  assert.equal(midQuarter.monthsMet, 2);
  assert.equal(midQuarter.monthsFinished, 2);
  assert.equal(midQuarter.complete, false);
  assert.equal(midQuarter.earned, 0);

  const boundary = quarterlyStatus(win, { '2026-05': 1999, '2026-06': 2500, '2026-07': 3000 });
  assert.equal(boundary.earned, 0);
});

/* ── Rules from Oct 2026: lower first tier (Sandra, 13 Oct 2026) ─────────── */

test('rule sets: Sep 2026 and earlier use the original rules; Oct 2026 onward the new ones', () => {
  const BE = require('../lib/bonus-eligibility');
  assert.equal(BE.ruleSetFor('2026-05').from, '2026-05');
  assert.equal(BE.ruleSetFor('2026-09').from, '2026-05');
  assert.equal(BE.ruleSetFor('2026-10').from, '2026-10');
  assert.equal(BE.ruleSetFor('2027-03').from, '2026-10');
  assert.equal(BE.ruleSetFor('2025-12').from, '2026-05', 'before the first set → the first set');
  for (const bad of [undefined, null, '', 'x', '2026-13', '2026-1', 'javascript:alert(1)']) {
    assert.equal(BE.ruleSetFor(bad).from, '2026-10', `invalid month ${String(bad)} → the current rules`);
  }
  assert.equal(BE.HOUSE_BONUS, BE.ruleSetFor('2026-10').houses, 'HOUSE_BONUS = the current rule set');
});

test('the month is read from h.ym, then h.month', () => {
  const BE = require('../lib/bonus-eligibility');
  assert.equal(BE.monthOf({ ym: '2026-09', month: '2026-10' }), '2026-09');
  assert.equal(BE.monthOf({ month: '2026-09' }), '2026-09');
  assert.equal(BE.monthOf({ month: 'bad' }), null);
  assert.equal(thresholdOf({ key: 'ramot', month: '2026-09' }), 17);
  assert.equal(thresholdOf({ key: 'ramot', month: '2026-10' }), 14);
});

const CHANGES = [
  // key, old threshold/gate, new threshold/gate
  ['ramot', 17, 510, 14, 420],
  ['efroni', 10, 300, 9, 270],
  ['rehab', 10, 300, 9, 270],
  ['pardes', 10, 300, 7, 210],
  ['raanana', 10, 300, 10, 300]
];
for (const [key, oldT, oldGate, newT, newGate] of CHANGES) {
  test(`${key}: threshold ${oldT} / gate ${oldGate} in Sep 2026 → ${newT} / ${newGate} from Oct 2026`, () => {
    assert.equal(thresholdOf({ ym: OLD, key }), oldT);
    assert.equal(gateTarget({ ym: OLD, key }), oldGate);
    assert.equal(thresholdOf({ ym: NEW, key }), newT);
    assert.equal(gateTarget({ ym: NEW, key }), newGate);
    assert.equal(thresholdOf({ key }), newT, 'no month → the current rules');
  });
}

test('the same figures pay differently in Sep vs Oct 2026 (Ramot avg 15, 450 days)', () => {
  const h = { key: 'ramot', avgDaily: 15, treatmentDays: 450 };
  assert.equal(monthlyBonusAmount({ ...h, ym: OLD }).amount, 0, 'below 17 under the old rules');
  const oct = monthlyBonusAmount({ ...h, ym: NEW });
  assert.equal(oct.amount, 2000);
  assert.equal(oct.tier, 1);
  assert.equal(oct.minRequired, 420);
});

test('Oct 2026 boundaries: Ramot 13.9 < 14; gate 419 fails, 420 passes', () => {
  assert.equal(qualifiesMonthly({ ym: NEW, key: 'ramot', avgDaily: 13.9 }), false);
  assert.equal(qualifiesMonthly({ ym: NEW, key: 'ramot', avgDaily: 14 }), true);
  assert.equal(monthlyBonusAmount({ ym: NEW, key: 'ramot', avgDaily: 14, treatmentDays: 419 }).amount, 0);
  assert.equal(monthlyBonusAmount({ ym: NEW, key: 'ramot', avgDaily: 14, treatmentDays: 420 }).amount, 2000);
});

test('Oct 2026: Pardes avg 7 + 210 days → 2000; Efroni and Rehab avg 9 + 270 days → 2000', () => {
  assert.equal(monthlyBonusAmount({ ym: NEW, key: 'pardes', avgDaily: 7, treatmentDays: 210 }).amount, 2000);
  assert.equal(monthlyBonusAmount({ ym: NEW, key: 'pardes', avgDaily: 6.9, treatmentDays: 210 }).amount, 0);
  assert.equal(monthlyBonusAmount({ ym: NEW, key: 'pardes', avgDaily: 7, treatmentDays: 209 }).amount, 0);
  for (const key of ['efroni', 'rehab']) {
    assert.equal(monthlyBonusAmount({ ym: NEW, key, avgDaily: 9, treatmentDays: 270 }).amount, 2000, key);
    assert.equal(monthlyBonusAmount({ ym: NEW, key, avgDaily: 8.9, treatmentDays: 270 }).amount, 0, key);
    assert.equal(monthlyBonusAmount({ ym: NEW, key, avgDaily: 9, treatmentDays: 269 }).amount, 0, key);
  }
});

test('Oct 2026: two steps — first bonus 2,000, full occupancy 3,000 in total; no middle tier', () => {
  const amt = (key, avgDaily, treatmentDays) => monthlyBonusAmount({ ym: NEW, key, avgDaily, treatmentDays }).amount;
  // Ramot: 14 → 2,000; 19.5 (old tier 2) is still 2,000; full (20) → 3,000.
  assert.equal(amt('ramot', 14, 434), 2000);
  assert.equal(amt('ramot', 19.5, 605), 2000, 'no 2,500 middle tier any more');
  assert.equal(amt('ramot', 20, 620), 3000);
  // Full = the house capacity: Ra'anana 14, Efroni / Rehab / Pardes 13.
  assert.equal(amt('raanana', 14, 434), 3000);
  assert.equal(amt('raanana', 13.9, 431), 2000);
  for (const key of ['efroni', 'rehab', 'pardes']) {
    assert.equal(amt(key, 13, 403), 3000, key);
    assert.equal(amt(key, 12.9, 400), 2000, key);
  }
  // September keeps the old three tiers.
  assert.equal(monthlyBonusAmount({ ym: OLD, key: 'ramot', avgDaily: 19.5, treatmentDays: 585 }).amount, 2500);
  assert.equal(tierForPatients({ ym: NEW, key: 'ramot', avgDaily: 20 }).tier, 2, 'full occupancy is step 2 of 2');
});

test('securedFloor uses the month\'s rules: Ramot Oct 2026 (31 days) locks the first bonus at 434 days so far', () => {
  assert.equal(securedFloor({ ym: NEW, key: 'ramot', avgDaily: 15 }, undefined, 31, 433).amount, 0);
  const f = securedFloor({ ym: NEW, key: 'ramot', avgDaily: 15 }, undefined, 31, 434);
  assert.equal(f.amount, 2000);
  assert.equal(f.target, 420);
  assert.equal(securedFloor({ ym: OLD, key: 'ramot', avgDaily: 15 }, undefined, 30, 450).amount, 0, 'old rules: below 17');
});

test('quarterly bonus: May–Jul 2026 still pays; from the Aug–Oct 2026 window on there is none', () => {
  const BE = require('../lib/bonus-eligibility');
  const may = BE.quarterlyStatus(['2026-05', '2026-06', '2026-07'], { '2026-05': 2000, '2026-06': 2500, '2026-07': 3000 });
  assert.deepEqual([may.enabled, may.earned], [true, 5000]);
  const aug = BE.quarterlyStatus(['2026-08', '2026-09', '2026-10'], { '2026-08': 3000, '2026-09': 3000, '2026-10': 3000 });
  assert.deepEqual([aug.enabled, aug.monthsMet, aug.earned], [false, 3, 0]);
  assert.equal(BE.quarterlyEnabled('2026-07'), true);
  assert.equal(BE.quarterlyEnabled('2026-09'), false, 'Sep is in the Aug–Oct window');
  assert.equal(BE.quarterlyEnabled('2027-01'), false);
});

/* ── Outpatient day-package (referral) bonus ────────────────────────────── */

const COUNTS = { maintenance: 4, day_2x: 2, day_daily: 1 };

test('referral bonus: none before Oct 2026 — 0, whatever the counts or eligibility', () => {
  const BE = require('../lib/bonus-eligibility');
  for (const ym of ['2026-05', '2026-08', '2026-09']) {
    assert.equal(BE.continuityEnabled(ym), false, ym);
    const r = BE.continuityAmount({ ...COUNTS, total: 2577 }, true, ym);
    assert.equal(r.total, 0, ym);
    assert.equal(r.enabled, false);
  }
});

test('referral bonus from Oct 2026: 300 ₪ per day-package patient, maintenance 0, independent of the occupancy bonus', () => {
  const BE = require('../lib/bonus-eligibility');
  assert.equal(BE.continuityEnabled(NEW), true);
  for (const eligible of [true, false]) {
    const r = BE.continuityAmount(COUNTS, eligible, NEW);
    assert.equal(r.total, 900, `(2 + 1) × 300, eligible=${eligible}`);
    assert.equal(r.payableCount, 3);
    assert.equal(r.unitRate, 300);
    assert.equal(r.maintenance, 4, 'counted but not paid');
  }
  assert.equal(BE.continuityAmount({ maintenance: 7 }, true, NEW).total, 0, 'maintenance only → 0');
  assert.equal(BE.continuityAmount(COUNTS, true, '2027-02').total, 900, 'later months keep the rule');
});

test('referral bonus: the feed total / rates are never used; junk counts are sanitised', () => {
  const BE = require('../lib/bonus-eligibility');
  const stray = BE.continuityAmount({ day_2x: 1, total: 99999, rates: { day_2x: 5000 } }, true, NEW);
  assert.equal(stray.total, 300);
  const junk = BE.continuityAmount({ maintenance: '-3', day_2x: 'x', day_daily: 1.9 }, true, NEW);
  assert.deepEqual([junk.maintenance, junk.day_2x, junk.day_daily, junk.total], [0, 0, 1, 300]);
  assert.equal(BE.continuityAmount({ day_2x: -2, day_daily: Infinity }, true, NEW).total, 0);
  assert.equal(BE.continuityAmount(null, true, NEW).total, 0);
});

test('referral kill switch forces 0 everywhere and disables the line', (t) => {
  const BE = require('../lib/bonus-eligibility');
  assert.equal(BE.REFERRAL_BONUS_KILL_SWITCH, false, 'off by default');
  BE.REFERRAL_BONUS_KILL_SWITCH = true;
  t.after(() => { BE.REFERRAL_BONUS_KILL_SWITCH = false; });
  assert.equal(BE.continuityEnabled(NEW), false);
  assert.equal(BE.continuityAmount(COUNTS, true, NEW).total, 0);
});

test('quarterly check ignores referrals: Oct 2026 with occupancy 0 and referrals 900 does NOT meet >= 2,000', () => {
  const BE = require('../lib/bonus-eligibility');
  const occ = monthlyBonusAmount({ ym: NEW, key: 'efroni', avgDaily: 8, treatmentDays: 240, bonus: { continuity: COUNTS } }).amount;
  assert.equal(occ, 0, 'referral data on the row never adds to the monthly amount');
  const ref = BE.continuityAmount(COUNTS, false, NEW).total;
  assert.equal(ref, 900);
  const q = BE.quarterlyStatus(['2026-08', '2026-09', '2026-10'], { '2026-08': 2000, '2026-09': 2000, '2026-10': occ });
  assert.equal(q.monthsMet, 2);
  assert.equal(q.earned, 0);
});

/* ── Intake-meeting bonus (Sandra, 13 Oct 2026) ─────────────────────────── */

test('intake-meeting bonus: none before Oct 2026; 250 ₪ per CONFIRMED meeting from Oct 2026; pending not paid', () => {
  const BE = require('../lib/bonus-eligibility');
  for (const ym of ['2026-05', '2026-09']) {
    assert.equal(BE.intakeEnabled(ym), false, ym);
    assert.equal(BE.intakeMeetingAmount({ confirmed: 3, pending: 1 }, ym).total, 0, ym);
  }
  const r = BE.intakeMeetingAmount({ confirmed: 3, pending: 2, items: [{}, {}] }, NEW);
  assert.deepEqual([r.confirmed, r.pending, r.unit, r.total, r.pendingTotal, r.enabled], [3, 2, 250, 750, 500, true]);
  assert.equal(BE.intakeMeetingAmount({ confirmed: 1 }, '2027-04').total, 250, 'later months keep the rule');
});

test('intake-meeting bonus: junk counts are sanitised; only counts are read', () => {
  const BE = require('../lib/bonus-eligibility');
  const j = BE.intakeMeetingAmount({ confirmed: '-2', pending: 'x', total: 99999, amount: 5000 }, NEW);
  assert.deepEqual([j.confirmed, j.pending, j.total], [0, 0, 0]);
  assert.equal(BE.intakeMeetingAmount({ confirmed: 2.9 }, NEW).total, 500);
  assert.equal(BE.intakeMeetingAmount(null, NEW).total, 0);
});

test('intake-meeting kill switch forces 0 and disables the line', (t) => {
  const BE = require('../lib/bonus-eligibility');
  assert.equal(BE.INTAKE_BONUS_KILL_SWITCH, false);
  BE.INTAKE_BONUS_KILL_SWITCH = true;
  t.after(() => { BE.INTAKE_BONUS_KILL_SWITCH = false; });
  assert.equal(BE.intakeEnabled(NEW), false);
  assert.equal(BE.intakeMeetingAmount({ confirmed: 4 }, NEW).total, 0);
});
