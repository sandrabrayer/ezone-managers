'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadiness } = require('../lib/readiness');
const secret = 'synthetic-secret-0123456789abcdef';
const good = { ok: true, protocol: 2, capabilities: ['stableActorId', 'scopedReads', 'privateLegacyAdminOnly'] };
const response = (data, ok = true) => ({ ok, json: async () => data });

test('readiness refuses wrong secrets, old versions, incomplete capabilities and non-JSON replies', async () => {
  for (const data of [{ ok: false, error: 'unauthorized' }, { ...good, protocol: 1 }, { ...good, capabilities: [] }, null]) {
    const check = createReadiness({ url: 'https://example.test/exec', secret, configured: true, fetchImpl: async () => response(data) });
    assert.equal(await check(), false);
  }
  for (const fetchImpl of [async () => response(good, false), async () => { throw Error(secret); }, async () => ({ json: async () => { throw Error('HTML'); } })]) {
    assert.equal(await createReadiness({ url: 'x', secret, configured: true, fetchImpl })(), false);
  }
});

test('readiness sends only a data-free authenticated POST, coalesces calls and can recover after failure', async () => {
  let calls = 0, clock = 0, healthy = false;
  const check = createReadiness({ url: 'https://example.test/exec', secret, configured: true, now: () => clock,
    fetchImpl: async (url, opts) => {
      calls++;
      assert.equal(url, 'https://example.test/exec');
      assert.equal(opts.method, 'POST');
      assert.ok(opts.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(opts.body), { action: 'managersWork', op: 'capabilities', secret });
      return response(healthy ? good : { ok: false });
    }
  });
  assert.deepEqual(await Promise.all([check(), check(), check()]), [false, false, false]);
  assert.equal(calls, 1);
  healthy = true;
  assert.equal(await check(), false);
  clock = 11000;
  assert.equal(await check(), true);
  assert.equal(calls, 2);
  healthy = false; clock = 22000;
  assert.equal(await check(), false, 'does not remain ready after backend drift');
});

test('missing local configuration makes no upstream call; a timed-out probe is not ready', async () => {
  let calls = 0;
  for (const config of [{ configured: false }, { url: '' }, { secret: '' }]) {
    const check = createReadiness({ url: 'x', secret, configured: true, ...config, fetchImpl: () => { calls++; } });
    assert.equal(await check(), false);
  }
  assert.equal(calls, 0);
  const check = createReadiness({ url: 'x', secret, configured: true, timeoutMs: 10,
    fetchImpl: (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason))) });
  // AbortSignal.timeout is unref'd; keep the test process alive until it fires.
  const keepAlive = setTimeout(() => {}, 100);
  try { assert.equal(await check(), false); } finally { clearTimeout(keepAlive); }
});

test('same name does not imply same identity; code rotation retains identity; code reuse invalidates old sessions', () => {
  const a = require('../lib/access');
  const row = { id: 'person-one', name: 'Same', house: 'ramot', code: '11112222' };
  const parse = rows => a.parseAccess(JSON.stringify(rows));
  const original = parse([row]).users[0], key = a.sessionKey(secret);
  const token = a.signSession(original, key);
  const rotated = parse([{ ...row, code: '33334444', name: 'Renamed' }]).users[0];
  assert.equal(rotated.id, original.id);
  assert.equal(a.readSession(token, key, [rotated]), null);
  const replacement = parse([{ ...row, id: 'person-two' }]).users[0];
  assert.equal(a.readSession(token, key, [replacement]), null);
  assert.equal(parse([row, { ...row, id: 'person-two', code: '33334444' }]).ok, false, 'duplicate login names remain forbidden');
  assert.equal(parse([row, { ...row, code: '33334444' }]).ok, false, 'duplicate ids fail');
  assert.equal(parse([{ ...row, id: undefined }]).ok, false);
});
