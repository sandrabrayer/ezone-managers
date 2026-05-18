const test = require('node:test');
const assert = require('node:assert/strict');
const { qualifiesMonthly } = require('../lib/bonus-eligibility');

const resolveBep = h => (h && Number.isFinite(h.bep)) ? h.bep : 0;

test('returns false when house is null or undefined', () => {
  assert.equal(qualifiesMonthly(null, resolveBep), false);
  assert.equal(qualifiesMonthly(undefined, resolveBep), false);
});

test('h.bonus.qualifies = true overrides patient count', () => {
  const h = { bep: 10, patientsNow: 0, bonus: { qualifies: true } };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('h.bonus.qualifies = false overrides patient count', () => {
  const h = { bep: 10, patientsNow: 999, bonus: { qualifies: false } };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test('h.qualifies = true overrides when h.bonus.qualifies absent', () => {
  const h = { bep: 10, patientsNow: 0, qualifies: true };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('h.qualifies = false overrides when h.bonus.qualifies absent', () => {
  const h = { bep: 10, patientsNow: 999, qualifies: false };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test('h.bonus.qualifies takes precedence over h.qualifies', () => {
  const h = { bep: 8, patientsNow: 0, bonus: { qualifies: true }, qualifies: false };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('fallback qualifies when patientsNow exceeds bep', () => {
  const h = { bep: 8, patientsNow: 12 };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('fallback qualifies when patientsNow exactly equals bep', () => {
  const h = { bep: 8, patientsNow: 8 };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
});

test('fallback does not qualify when patientsNow is below bep', () => {
  const h = { bep: 8, patientsNow: 7 };
  assert.equal(qualifiesMonthly(h, resolveBep), false);
});

test('non-boolean qualifies flags do not act as overrides', () => {
  // The spec only honors explicit booleans; truthy non-booleans fall through.
  const h = { bep: 8, patientsNow: 10, qualifies: 1 };
  assert.equal(qualifiesMonthly(h, resolveBep), true);
  const h2 = { bep: 8, patientsNow: 3, qualifies: 'yes' };
  assert.equal(qualifiesMonthly(h2, resolveBep), false);
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

test('missing resolveBep does not throw; falls back to bep = 0', () => {
  // With bep treated as 0, any non-negative patientsNow qualifies.
  assert.equal(qualifiesMonthly({ patientsNow: 1 }), true);
  assert.equal(qualifiesMonthly({ patientsNow: 0 }), true);
});
