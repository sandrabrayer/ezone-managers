const test = require('node:test');
const assert = require('node:assert/strict');
const { qualifiesMonthly } = require('../lib/bonus-eligibility');

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
