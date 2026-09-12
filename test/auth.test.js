'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { signToken, verifyToken, timingSafeEquals } = require('../lib/auth');

const SECRET = 's'.repeat(32);

test('signToken produces expiry.signature format', () => {
  const t = signToken(SECRET, 7);
  const [exp, sig] = t.split('.');
  assert.ok(Number(exp) > Date.now());
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('signToken throws without a secret', () => {
  assert.throws(() => signToken('', 7));
});

test('verifyToken accepts a freshly signed token', () => {
  assert.equal(verifyToken(SECRET, signToken(SECRET, 1)), true);
});

test('verifyToken rejects wrong secret', () => {
  assert.equal(verifyToken('x'.repeat(32), signToken(SECRET, 1)), false);
});

test('verifyToken rejects expired token', () => {
  const expired = Date.now() - 1000;
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', SECRET).update(`managers:${expired}`).digest('hex');
  assert.equal(verifyToken(SECRET, `${expired}.${sig}`), false);
});

test('verifyToken rejects tampered expiry', () => {
  const t = signToken(SECRET, 1);
  const [exp, sig] = t.split('.');
  assert.equal(verifyToken(SECRET, `${Number(exp) + 99999}.${sig}`), false);
});

test('verifyToken rejects malformed input safely', () => {
  for (const bad of ['', 'nodot', '123.', '.abc', null, undefined, 42, '123.zzzz']) {
    assert.equal(verifyToken(SECRET, bad), false);
  }
});

test('verifyToken uses payload prefix "managers:" (staffing tokens are invalid here)', () => {
  const crypto = require('crypto');
  const exp = Date.now() + 60_000;
  const staffingSig = crypto.createHmac('sha256', SECRET).update(`moran:${exp}`).digest('hex');
  assert.equal(verifyToken(SECRET, `${exp}.${staffingSig}`), false);
});


test('timingSafeEquals: exact match only, and length mismatch never throws', () => {
  const key = 'k'.repeat(48);
  assert.equal(timingSafeEquals(key, key), true);
  assert.equal(timingSafeEquals(key + 'x', key), false);
  assert.equal(timingSafeEquals(key.slice(0, 10), key), false);
  assert.equal(timingSafeEquals('', ''), false); // an unset key never unlocks
  assert.equal(timingSafeEquals(null, key), false);
  assert.equal(timingSafeEquals(key, null), false);
});

test('signToken is keyed by FULL_VIEW_KEY: rotating the key invalidates old cookies', () => {
  const oldKey = 'o'.repeat(40);
  const newKey = 'n'.repeat(40);
  const cookie = signToken(oldKey, 7);
  assert.equal(verifyToken(oldKey, cookie), true);
  assert.equal(verifyToken(newKey, cookie), false);
});
