'use strict';
/* Settled bonuses feed for the staffing app (Nov 5, 2026):
 *   - lib/staffing-feed.js computes with the canonical BonusEligibility rules
 *   - GET /api/feeds/staffing/bonuses: own secret, fail-closed, month validated,
 *     upstream MOCKED (no network), no amounts in logs. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
process.env.STAFFING_FEED_SECRET = 'staffing-feed-test-secret-0123456789';
require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const { settledBonusesForMonth, STAFFING_HOUSE_IDS } = require('../lib/staffing-feed');
const { app, _readCache } = require('../server');
const { request } = require('./helpers-auth');

const ROWS_OCT = [
  { key: 'ramot', manager: 'אורן', avgDaily: 16, treatmentDays: 480, bonus: { continuity: { day_daily: 1 } }, referralStarts: { count: 1 }, intakeMeetings: { confirmed: 2, pending: 1 } },
  { key: 'raanana', manager: 'דליה', avgDaily: 8, treatmentDays: 200 },
  { key: 'arfoni', manager: 'חנן', avgDaily: 13, treatmentDays: 400 },
  { key: 'rehab', manager: 'רנטה' },   // no figures → missing, never a zero month
];

test('settledBonusesForMonth: occupancy + referral + intake per house, staffing house ids, missing rows flagged', () => {
  const out = settledBonusesForMonth('2026-10', ROWS_OCT, {});
  assert.equal(out.month, '2026-10');
  const by = Object.fromEntries(out.houses.map((h) => [h.house, h]));
  assert.deepEqual(Object.keys(by).sort(), ['asher', 'ofroni', 'pardes', 'ramot', 'rehab']);
  assert.equal(by.ramot.occupancy, 2000, 'tier 1 at avg 16 for ramot in the Oct rule set');
  assert.equal(by.ramot.referral, 300);
  assert.equal(by.ramot.intake, 500);
  assert.equal(by.ramot.quarterly, 0, 'quarterly is off from Oct 2026');
  assert.equal(by.ramot.total, 2800);
  assert.equal(by.ramot.manager, 'אורן');
  assert.equal(by.asher.occupancy, 0, 'below threshold');
  assert.equal(by.asher.total, 0);
  assert.equal(by.ofroni.occupancy, 3000, 'arfoni → efroni → ofroni, full occupancy');
  assert.equal(by.rehab.missing, true);
  assert.equal(by.pardes.missing, true, 'no row at all');
  assert.equal(by.rehab.total, 0);
});

test('settledBonusesForMonth: the quarterly 5,000 only in a window\'s last month, when all three months met 2,000', () => {
  const met = (key) => [{ key, avgDaily: 20, treatmentDays: 600 }];
  const out = settledBonusesForMonth('2026-07', met('ramot'), { '2026-05': met('ramot'), '2026-06': met('ramot') });
  const ramot = out.houses.find((h) => h.house === 'ramot');
  assert.equal(ramot.occupancy, 3000);
  assert.equal(ramot.quarterly, 5000);
  const partial = settledBonusesForMonth('2026-07', met('ramot'), { '2026-05': met('ramot') });
  assert.equal(partial.houses.find((h) => h.house === 'ramot').quarterly, 0, 'a missing month never confirms a quarterly');
  const mid = settledBonusesForMonth('2026-06', met('ramot'), {});
  assert.equal(mid.houses.find((h) => h.house === 'ramot').quarterly, 0, 'not the window\'s last month');
});

test('settledBonusesForMonth rejects a bad month; house map covers the five houses', () => {
  assert.throws(() => settledBonusesForMonth('2026-13', [], {}), /bad_month/);
  assert.deepEqual(STAFFING_HOUSE_IDS, { raanana: 'asher', ramot: 'ramot', efroni: 'ofroni', rehab: 'rehab', pardes: 'pardes' });
});

test('GET /api/feeds/staffing/bonuses (mocked upstream)', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  t.beforeEach(() => _readCache.clear());

  const calls = [];
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const houses = body.month === '2026-10' ? ROWS_OCT : [];
    return { status: 200, text: async () => JSON.stringify({ ok: true, month: body.month, houses }) };
  };

  await t.test('fail-closed: no header → 401 and NO upstream call', async () => {
    const r = await request(server, '/api/feeds/staffing/bonuses?month=2026-10');
    assert.equal(r.status, 401);
    assert.equal(calls.length, 0);
  });
  await t.test('wrong secret → 401, no upstream call', async () => {
    const r = await request(server, '/api/feeds/staffing/bonuses?month=2026-10', { headers: { 'X-Feed-Secret': 'x'.repeat(36) } });
    assert.equal(r.status, 401);
    assert.equal(calls.length, 0);
  });
  await t.test('bad month → 400', async () => {
    const r = await request(server, '/api/feeds/staffing/bonuses?month=10-2026', { headers: { 'X-Feed-Secret': process.env.STAFFING_FEED_SECRET } });
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(r.text).error, 'bad_month');
  });
  await t.test('right secret → the month\'s settled amounts, read upstream as the feed actor with the work secret', async () => {
    const r = await request(server, '/api/feeds/staffing/bonuses?month=2026-10', { headers: { 'X-Feed-Secret': process.env.STAFFING_FEED_SECRET } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    const body = JSON.parse(r.text);
    assert.equal(body.ok, true);
    assert.equal(body.month, '2026-10');
    const ramot = body.houses.find((h) => h.house === 'ramot');
    assert.equal(ramot.total, 2800);
    assert.ok(body.generatedAt);
    assert.equal(calls.length, 1, 'Oct 2026 closes a window but quarterly is off from Oct 2026: one upstream read');
    assert.equal(calls[0].action, 'managersOverview');
    assert.equal(calls[0].role, 'admin');
    assert.equal(calls[0].actor, 'staffing-feed');
    assert.equal(calls[0].secret, process.env.MANAGERS_WORK_SECRET);
  });
  await t.test('upstream failure → 502 upstream_unavailable, never a guessed 0', async () => {
    global.fetch = async () => { throw new Error('boom'); };
    const r = await request(server, '/api/feeds/staffing/bonuses?month=2026-09', { headers: { 'X-Feed-Secret': process.env.STAFFING_FEED_SECRET } });
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(r.text).error, 'upstream_unavailable');
  });
});
