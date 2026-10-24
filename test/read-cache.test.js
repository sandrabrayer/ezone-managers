'use strict';
/* lib/read-cache.js — coalescing + stale-while-revalidate, with an injected clock (no real waiting). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadCache } = require('../lib/read-cache');

function make(extra) {
  const clock = { t: 1000000 };
  const errors = [];
  const c = createReadCache({ freshMs: 60000, staleMaxMs: 24 * 3600 * 1000, maxEntries: 3, now: () => clock.t, onRefreshError: (k, e) => errors.push([k, e && e.message]), ...(extra || {}) });
  return { c, clock, errors };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('MISS then HIT: the second read inside the fresh window makes no upstream call', async () => {
  const { c } = make();
  let calls = 0;
  const loader = async () => { calls++; return { n: calls }; };
  const a = await c.read('k', loader);
  const b = await c.read('k', loader);
  assert.deepEqual([a.state, b.state, calls, b.value.n], ['MISS', 'HIT', 1, 1]);
});

test('concurrent misses share ONE load (coalescing)', async () => {
  const { c } = make();
  let calls = 0; const d = deferred();
  const loader = () => { calls++; return d.promise; };
  const p = [c.read('k', loader), c.read('k', loader), c.read('k', loader)];
  d.resolve('v');
  const r = await Promise.all(p);
  assert.equal(calls, 1);
  assert.ok(r.every((x) => x.value === 'v' && x.state === 'MISS'));
});

test('STALE: an old copy is served at once and ONE background refresh runs; the next read is a HIT with the new value', async () => {
  const { c, clock } = make();
  let n = 0; const d = deferred();
  await c.read('k', async () => 'old');
  clock.t += 5 * 60000;
  const loader = () => { n++; return d.promise; };
  const a = await c.read('k', loader);
  const b = await c.read('k', loader);               // refresh already in flight → shared
  assert.deepEqual([a.state, a.value, b.state, n], ['STALE', 'old', 'STALE', 1]);
  d.resolve('new');
  await new Promise((r) => setImmediate(r));
  const h = await c.read('k', async () => { throw new Error('must not run'); });
  assert.deepEqual([h.state, h.value], ['HIT', 'new']);
});

test('wait: a stale read joins the refresh and answers REFRESHED; a failed refresh answers STALE + refreshFailed and keeps the copy', async () => {
  const { c, clock, errors } = make();
  await c.read('k', async () => 'old');
  clock.t += 5 * 60000;
  const ok = await c.read('k', async () => 'fresh', { wait: true });
  assert.deepEqual([ok.state, ok.value], ['REFRESHED', 'fresh']);
  clock.t += 5 * 60000;
  const bad = await c.read('k', async () => { throw new Error('boom'); }, { wait: true });
  assert.deepEqual([bad.state, bad.value, bad.refreshFailed], ['STALE', 'fresh', true]);
  assert.deepEqual(errors, [['k', 'boom']]);
  assert.equal(c._store.get('k').value, 'fresh', 'a failed refresh never overwrites a good copy');
});

test('a failed background refresh is reported and keeps serving the copy', async () => {
  const { c, clock, errors } = make();
  await c.read('k', async () => 'old');
  clock.t += 5 * 60000;
  const a = await c.read('k', async () => { throw new Error('down'); });
  await new Promise((r) => setImmediate(r));
  assert.equal(a.state, 'STALE');
  assert.deepEqual(errors, [['k', 'down']]);
  assert.equal((await c.read('k', async () => 'x')).value, 'old');
});

test('a loader error on a MISS is thrown to every waiter and nothing is stored', async () => {
  const { c } = make();
  const d = deferred();
  const loader = () => d.promise;
  const p = [c.read('k', loader).catch((e) => e.message), c.read('k', loader).catch((e) => e.message)];
  d.reject(new Error('nope'));
  assert.deepEqual(await Promise.all(p), ['nope', 'nope']);
  assert.equal(c.size(), 0);
});

test('a copy older than staleMax is not served: it is a MISS again', async () => {
  const { c, clock } = make();
  await c.read('k', async () => 'old');
  clock.t += 25 * 3600 * 1000;
  const r = await c.read('k', async () => 'new');
  assert.deepEqual([r.state, r.value], ['MISS', 'new']);
});

test('invalidate drops matching copies only, by tag', async () => {
  const { c } = make();
  await c.read('a', async () => 1, { tag: { house: 'ramot' } });
  await c.read('b', async () => 2, { tag: { house: 'efroni' } });
  await c.read('o', async () => 3, { tag: { house: '' } });
  assert.equal(c.invalidate((t) => t && (t.house === 'ramot' || t.house === '')), 2);
  assert.equal(c.size(), 1);
  assert.equal((await c.read('b', async () => 9)).state, 'HIT');
});

test('a read in flight when its house is invalidated is disowned: the caller gets it, nobody stores it', async () => {
  const { c } = make();
  const d = deferred();
  const p = c.read('a', () => d.promise, { tag: { house: 'ramot' } });
  c.invalidate((t) => t && t.house === 'ramot');
  d.resolve('pre-write');
  assert.equal((await p).value, 'pre-write');
  assert.equal(c.size(), 0, 'pre-write data is never stored');
});

test('bounded: the oldest copy is dropped past maxEntries', async () => {
  const { c } = make();
  for (const k of ['a', 'b', 'c', 'd']) await c.read(k, async () => k);
  assert.equal(c.size(), 3);
  assert.equal((await c.read('a', async () => 'again')).state, 'MISS');
});
