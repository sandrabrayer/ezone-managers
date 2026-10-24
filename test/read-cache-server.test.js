'use strict';
/* Fast reads on the server (24 Oct 2026, docs/read-cache.md) — global.fetch is MOCKED; dummy values only. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, _rateLimiters, _readCache } = require('../server');

const reply = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: { get: () => 'application/json' } });
const tick = () => new Promise((r) => setImmediate(r));
const ageAll = (ms) => { for (const e of _readCache._store.values()) e.at -= ms; };

test('fast reads (mocked upstream)', async (t) => {
  const realFetch = global.fetch;
  const realErr = console.error;
  t.after(() => { global.fetch = realFetch; console.error = realErr; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  t.beforeEach(() => { _rateLimiters.allowSheets.clear(); _rateLimiters.allowWrites.clear(); _readCache.clear(); });

  const admin = await auth.login(server, auth.ADMIN_CODE);
  const oran = await auth.login(server, auth.ORAN_CODE);
  const hanan = await auth.login(server, auth.HANAN_CODE);
  const get = (path, cookie) => auth.request(server, path, { headers: { Cookie: cookie } });
  const work = (body, cookie) => auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body });

  let calls, version;
  function mock(make) {
    calls = []; version = 1;
    global.fetch = async (url, o) => { const b = JSON.parse(o.body); calls.push(b); return make(b); };
  }
  const feedPayload = () => reply(200, { houses: [{ key: 'ramot', patientsNow: 10 + version }, { key: 'arfoni', patientsNow: 5 }], v: version });

  await t.test('sheets: MISS, then HIT with NO second upstream call; the data is marked live', async () => {
    mock(feedPayload);
    const a = await get('/api/sheets?action=managersOverview', admin);
    const b = await get('/api/sheets?action=managersOverview', admin);
    assert.deepEqual([a.headers['x-cache'], b.headers['x-cache'], calls.length], ['MISS', 'HIT', 1]);
    assert.equal(b.headers['x-data-source'], 'live', 'a fast copy is not the «saved data» notice');
    assert.equal(b.headers['cache-control'], 'no-store');
    assert.equal(a.text, b.text);
  });

  await t.test('sheets: an old copy is served AT ONCE (STALE), refreshed in the background, then HIT with the new data', async () => {
    mock(feedPayload);
    await get('/api/sheets?action=managersOverview', admin);
    ageAll(10 * 60000);
    version = 2;
    const s = await get('/api/sheets?action=managersOverview', admin);
    assert.equal(s.headers['x-cache'], 'STALE');
    assert.equal(JSON.parse(s.text).v, 1, 'the saved copy answers immediately');
    assert.ok(!Number.isNaN(Date.parse(s.headers['x-data-cached-at'])));
    await tick(); await tick();
    const h = await get('/api/sheets?action=managersOverview', admin);
    assert.deepEqual([h.headers['x-cache'], JSON.parse(h.text).v, calls.length], ['HIT', 2, 2]);
  });

  await t.test('sheets: swr=wait joins the refresh and answers the NEW data (REFRESHED)', async () => {
    mock(feedPayload);
    await get('/api/sheets?action=managersOverview', admin);
    ageAll(10 * 60000);
    version = 3;
    const r = await get('/api/sheets?action=managersOverview&swr=wait', admin);
    assert.deepEqual([r.headers['x-cache'], JSON.parse(r.text).v], ['REFRESHED', 3]);
    assert.ok(!('swr' in calls[calls.length - 1]), 'swr is never forwarded to the Dashboard');
  });

  await t.test('sheets: a failed refresh keeps the copy and says so; a failed MISS is not cached', async () => {
    mock(feedPayload);
    await get('/api/sheets?action=managersOverview', admin);
    ageAll(10 * 60000);
    const logs = []; console.error = (m) => logs.push(String(m));
    global.fetch = async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
    const r = await get('/api/sheets?action=managersOverview&swr=wait', admin);
    assert.deepEqual([r.status, r.headers['x-cache'], r.headers['x-cache-refresh']], [200, 'STALE', 'failed']);
    assert.equal(JSON.parse(r.text).v, 1);
    assert.ok(logs.some((l) => /^\[read-cache\] refresh failed class=upstream_timeout status=504 ms=\d+$/.test(l)), logs.join('|'));
    console.error = realErr;
    _readCache.clear();
    mock(() => reply(200, { ok: false, error: 'exception' }));
    await get('/api/sheets?action=managersHouse&house=ramot', admin);
    await get('/api/sheets?action=managersHouse&house=ramot', admin);
    assert.equal(calls.length, 2, 'an error reply is never served from the fast copy');
  });

  await t.test('isolation: the copy is per person — Oran and Hanan never share one; a manager still gets only their own house', async () => {
    mock(feedPayload);
    const o1 = await get('/api/sheets?action=managersOverview', oran);
    const o2 = await get('/api/sheets?action=managersOverview', oran);
    const h1 = await get('/api/sheets?action=managersOverview', hanan);
    assert.deepEqual([o1.headers['x-cache'], o2.headers['x-cache'], h1.headers['x-cache'], calls.length], ['MISS', 'HIT', 'MISS', 2]);
    assert.deepEqual(JSON.parse(o2.text).houses.map((h) => h.key), ['ramot']);
    assert.deepEqual(JSON.parse(h1.text).houses.map((h) => h.key), ['arfoni'], 'Hanan gets only his own house (backend id arfoni)');
    assert.ok(!h1.text.includes('"ramot"'), 'Hanan never receives Ramot');
    const forbidden = await get('/api/sheets?action=managersHouse&house=ramot', hanan);
    assert.equal(forbidden.status, 403);
  });

  const houseData = (house) => reply(200, { ok: true, house, v: version, patients: [] });

  await t.test('work: houseData MISS then HIT; the key holds the house — another house is its own copy', async () => {
    mock((b) => houseData(b.house));
    const a = await work({ op: 'houseData', house: 'ramot' }, admin);
    const b = await work({ op: 'houseData', house: 'ramot' }, admin);
    const c = await work({ op: 'houseData', house: 'efroni' }, admin);
    assert.deepEqual([a.headers['x-cache'], b.headers['x-cache'], c.headers['x-cache'], calls.length], ['MISS', 'HIT', 'MISS', 2]);
    assert.equal(JSON.parse(c.text).house, 'efroni');
  });

  await t.test('work: a manager is pinned to their own house — a forged house never reads another house\'s copy', async () => {
    mock((b) => houseData(b.house));
    await work({ op: 'houseData', house: 'efroni' }, admin);
    const r = await work({ op: 'houseData', house: 'efroni' }, oran);
    assert.equal(JSON.parse(r.text).house, 'ramot');
    assert.equal(r.headers['x-cache'], 'MISS', 'a different person never gets the admin\'s copy');
  });

  await t.test('work: a write drops THAT house\'s copies only; the next read is live and sees the change', async () => {
    mock((b) => (b.op === 'logAdd' ? reply(200, { ok: true }) : houseData(b.house)));
    await work({ op: 'houseData', house: 'ramot' }, admin);
    await work({ op: 'houseData', house: 'efroni' }, admin);
    const w = await work({ op: 'logAdd', house: 'ramot', log: 'events', entry: { text: 'x' } }, admin);
    assert.equal(w.status, 200);
    assert.equal(w.headers['x-cache'], undefined, 'a write is never served from the fast copy');
    version = 2;
    const ramot = await work({ op: 'houseData', house: 'ramot' }, admin);
    const efroni = await work({ op: 'houseData', house: 'efroni' }, admin);
    assert.deepEqual([ramot.headers['x-cache'], JSON.parse(ramot.text).v], ['MISS', 2]);
    assert.deepEqual([efroni.headers['x-cache'], JSON.parse(efroni.text).v], ['HIT', 1]);
  });

  await t.test('work: a FAILED write keeps the copies; an error reply is never cached', async () => {
    mock((b) => (b.op === 'logAdd' ? reply(200, { ok: false, error: 'exception' }) : houseData(b.house)));
    await work({ op: 'houseData', house: 'ramot' }, admin);
    await work({ op: 'logAdd', house: 'ramot', log: 'events', entry: {} }, admin);
    assert.equal((await work({ op: 'houseData', house: 'ramot' }, admin)).headers['x-cache'], 'HIT');
    _readCache.clear();
    mock(() => reply(200, { ok: false, error: 'exception' }));
    const e1 = await work({ op: 'houseData', house: 'ramot' }, admin);
    await work({ op: 'houseData', house: 'ramot' }, admin);
    assert.deepEqual([e1.status, JSON.parse(e1.text).error, calls.length], [200, 'exception', 2]);
  });

  await t.test('work: STALE answers at once; swr:"wait" in the body joins the refresh (REFRESHED); swr is never forwarded', async () => {
    mock((b) => houseData(b.house));
    await work({ op: 'houseData', house: 'ramot' }, admin);
    ageAll(10 * 60000);
    version = 2;
    const s = await work({ op: 'houseData', house: 'ramot' }, admin);
    assert.deepEqual([s.headers['x-cache'], JSON.parse(s.text).v], ['STALE', 1]);
    await tick(); await tick();
    ageAll(10 * 60000);
    version = 3;
    const w = await work({ op: 'houseData', house: 'ramot', swr: 'wait' }, admin);
    assert.deepEqual([w.headers['x-cache'], JSON.parse(w.text).v], ['REFRESHED', 3]);
    assert.ok(calls.every((c) => !('swr' in c)));
  });

  await t.test('work: validation still runs before anything is cached or forwarded', async () => {
    mock((b) => houseData(b.house));
    assert.equal((await work({ op: 'nope', house: 'ramot' }, admin)).status, 400);
    assert.equal((await work({ op: 'houseData', house: 'atlantis' }, admin)).status, 403);
    assert.equal(calls.length, 0);
    assert.equal(_readCache.size(), 0);
  });
});
