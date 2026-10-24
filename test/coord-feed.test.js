'use strict';
/* Direct read-only feed from the Coordinators app (22 Oct 2026, docs/coordinators-feed.md).
 *   A. lib/coord-feed.js: config fail-closed (unset / non-https / short secret → OFF, no request),
 *      answer guards (house echo, known keys only, bounded), error mapping;
 *   B. /api/work houseData: committees merged from the feed for EVERY house (incl. pardes), the
 *      manager pinned to their own house, the Dashboard copy as the fallback, an honest reason when
 *      both are missing; the secret never reaches the browser;
 *   C. alerts: a cancelled committee never alerts; today .. +2 are alerts, +3 .. +7 «בהמשך השבוע».
 * No network: global.fetch is mocked; dummy secrets only. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
process.env.COORDINATORS_FEED_URL = 'https://coordinators.test/';
process.env.COORDINATORS_FEED_SECRET = 'dummy-feed-secret-0123456789abcdef0123';
const auth = require('./helpers-auth');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoordFeed, parseConfig } = require('../lib/coord-feed');
const CA = require('../public/committee-alerts.js');
const { app, _rateLimiters, _coordFeed, _readCache } = require('../server');

const SECRET = process.env.COORDINATORS_FEED_SECRET;
const TODAY = '2026-10-22';
const reply = (status, obj) => ({ status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)), headers: { get: () => 'application/json' } });

/* ── A. lib ─────────────────────────────────────────────── */

test('A: config is fail-closed — unset, non-https, credentials in the URL or a short secret → OFF and no request', async () => {
  for (const env of [{}, { COORDINATORS_FEED_URL: 'https://x.test' }, { COORDINATORS_FEED_SECRET: SECRET },
    { COORDINATORS_FEED_URL: 'http://coordinators.test', COORDINATORS_FEED_SECRET: SECRET },
    { COORDINATORS_FEED_URL: 'https://u:p@coordinators.test', COORDINATORS_FEED_SECRET: SECRET },
    { COORDINATORS_FEED_URL: 'https://coordinators.test', COORDINATORS_FEED_SECRET: 'short' },
    { COORDINATORS_FEED_URL: 'not a url', COORDINATORS_FEED_SECRET: SECRET }]) {
    let called = 0;
    const f = createCoordFeed(env, async () => { called++; return reply(200, {}); });
    assert.equal(f.configured, false, JSON.stringify(Object.keys(env)));
    assert.deepEqual(await f.read('committees', 'ramot'), { ok: false, error: 'not_configured' });
    assert.equal(called, 0);
  }
  assert.equal(parseConfig({ COORDINATORS_FEED_URL: 'https://coordinators.test/', COORDINATORS_FEED_SECRET: SECRET }).endpoint, 'https://coordinators.test/api/managers-feed');
});

test('A: the request — POST, Bearer secret in a header (never the body / URL), house + kind; bad kind / house / month refused locally', async () => {
  const calls = [];
  const f = createCoordFeed(process.env, async (url, o) => { calls.push({ url, o }); return reply(200, { ok: true, house: 'pardes', today: TODAY, committees: [] }); });
  assert.equal((await f.read('committees', 'pardes')).ok, true);
  assert.equal(calls[0].url, 'https://coordinators.test/api/managers-feed');
  assert.equal(calls[0].o.method, 'POST');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer ' + SECRET);
  assert.deepEqual(JSON.parse(calls[0].o.body), { kind: 'committees', house: 'pardes' });
  assert.ok(!calls[0].o.body.includes(SECRET) && !calls[0].url.includes(SECRET));
  assert.equal((await f.read('committees', 'nowhere')).error, 'bad_request');
  assert.equal((await f.read('patients', 'ramot')).error, 'bad_request');
  assert.equal((await f.read('summaries', 'ramot', { month: '2026-13' })).error, 'bad_request');
  assert.equal((await f.read('shiftUpdates', 'ramot', { upTo: 'x' })).error, 'bad_request');
  assert.equal(calls.length, 1, 'a refused read sends nothing');
});

test('A: answer guards — wrong house echo / bad JSON / bad shape → bad_response; unknown keys stripped; statuses map', async () => {
  const run = (r) => createCoordFeed(process.env, async () => r).read('committees', 'ramot');
  assert.equal((await run(reply(200, { ok: true, house: 'efroni', committees: [] }))).error, 'bad_response', 'another house is never accepted');
  assert.equal((await run(reply(200, '<html>'))).error, 'bad_response');
  assert.equal((await run(reply(200, { ok: true, house: 'ramot' }))).error, 'bad_response');
  assert.equal((await run(reply(401, { error: 'unauthorized' }))).error, 'unauthorized');
  assert.equal((await run(reply(503, { error: 'not_configured' }))).error, 'not_configured');
  assert.equal((await run(reply(502, {}))).error, 'unreachable');
  assert.equal((await createCoordFeed(process.env, async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }).read('committees', 'ramot')).error, 'timeout');
  const ok = await run(reply(200, { ok: true, house: 'ramot', today: TODAY, committees: [
    { id: 'c1', date: '2026-10-22', time: '9:00', type: 'x'.repeat(90), patientName: 'דנה', status: 'weird', notes: 'n', createdBy: 'rakaz:ramot', phone: '050' },
    { id: 'bad', date: 'not-a-date' }] }));
  assert.equal(ok.data.committees.length, 1);
  assert.deepEqual(Object.keys(ok.data.committees[0]).sort(), ['date', 'id', 'notes', 'participants', 'patientName', 'status', 'time', 'type']);
  assert.deepEqual([ok.data.committees[0].time, ok.data.committees[0].type.length, ok.data.committees[0].status], ['', 60, 'scheduled']);
});

/* ── B. houseData merge ─────────────────────────────────── */

async function boot(t, feedReply, dashCommittees) {
  const realFetch = global.fetch;
  const seen = { feed: [], dash: [] };
  global.fetch = async (url, o = {}) => {
    const body = JSON.parse(o.body || '{}');
    if (String(url).startsWith('https://coordinators.test')) { seen.feed.push({ body, auth: o.headers.Authorization }); return feedReply(body); }
    seen.dash.push(body);
    const data = { ok: true, house: body.house, today: TODAY, patients: [] };
    if (dashCommittees !== undefined) data.committees = dashCommittees;
    return reply(200, data);
  };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear(); _readCache.clear();
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body });
  return { server, seen, send };
}
const FEED = (b) => reply(200, { ok: true, house: b.house, today: TODAY, committees: [
  { id: 'a-' + b.house, date: TODAY, time: '10:00', type: 'ועדת השמה', participants: '', patientName: 'דנה', status: 'scheduled', notes: 'הערה' },
  { id: 'x-' + b.house, date: '2026-10-23', time: '', type: 'ועדה', participants: '', patientName: '', status: 'cancelled', notes: '' }] });

test('B: houseData — the feed is configured; committees come from it for EVERY house the admin opens (incl. pardes)', async (t) => {
  assert.equal(_coordFeed.configured, true);
  const { server, seen, send } = await boot(t, FEED, { available: true, today: TODAY, items: [{ id: 'dash', date: TODAY }] });
  const admin = await auth.login(server, auth.ADMIN_CODE);
  for (const house of ['raanana', 'ramot', 'efroni', 'rehab', 'pardes']) {
    const r = await send(admin, { op: 'houseData', house });
    const d = JSON.parse(r.text);
    assert.equal(d.committees.source, 'coordinators', house);
    assert.deepEqual(d.committees.items.map((c) => c.id), ['a-' + house, 'x-' + house]);
    assert.equal(d.committees.items[0].notes, 'הערה');
    assert.ok(!r.text.includes(process.env.COORDINATORS_FEED_SECRET), 'the secret never reaches the browser');
  }
  assert.deepEqual(seen.feed.map((f) => f.body.house), ['raanana', 'ramot', 'efroni', 'rehab', 'pardes']);
  assert.ok(seen.feed.every((f) => f.auth === 'Bearer ' + SECRET));
});

test('B: a manager is pinned to their OWN house — a forged house never reaches the feed', async (t) => {
  const { server, seen, send } = await boot(t, FEED, undefined);
  const oran = await auth.login(server, auth.ORAN_CODE);
  const r = await send(oran, { op: 'houseData', house: 'efroni' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.feed.map((f) => f.body.house), ['ramot']);
  assert.ok(!r.text.includes('a-efroni'));
});

test('B: feed down → the Dashboard copy stays (fallback); no Dashboard copy → an honest «feed_down», never an empty list', async (t) => {
  const { server, send } = await boot(t, () => reply(502, {}), { available: true, today: TODAY, items: [{ id: 'dash', date: TODAY, type: 'x' }] });
  const admin = await auth.login(server, auth.ADMIN_CODE);
  const d = JSON.parse((await send(admin, { op: 'houseData', house: 'ramot' })).text);
  assert.deepEqual(d.committees.items.map((c) => c.id), ['dash']);
});
test('B: feed down and no Dashboard committees → available:false + reason (the card shows why)', async (t) => {
  const { server, send } = await boot(t, () => { throw new Error('ECONNREFUSED'); }, undefined);
  const admin = await auth.login(server, auth.ADMIN_CODE);
  const d = JSON.parse((await send(admin, { op: 'houseData', house: 'pardes' })).text);
  assert.deepEqual(d.committees, { available: false, reason: 'feed_down' });
  const model = CA.houseAlerts(d, 'pardes', TODAY);
  assert.equal(model.supported, false);
  assert.match(model.unavailableText, /לא הצלחנו לקרוא את הוועדות/);
});

/* ── C. alerts on the feed data ─────────────────────────── */

test('C: a cancelled committee never alerts; today .. +2 are alerts, +3 .. +7 under «בהמשך השבוע»', () => {
  const items = [
    { id: '0', date: '2026-10-22', type: 'היום', status: 'scheduled' }, { id: '1', date: '2026-10-23', type: 'מחר' },
    { id: '2', date: '2026-10-24', type: 'יומיים' }, { id: '3', date: '2026-10-25', type: 'שלושה' },
    { id: 'c', date: '2026-10-22', type: 'מבוטלת', status: 'cancelled' }, { id: '8', date: '2026-10-30', type: 'רחוק' }];
  const m = CA.houseAlerts({ committees: { available: true, today: TODAY, items } }, 'ramot', TODAY);
  assert.deepEqual(m.alerts.map((a) => a.urgent), [true, true, true, false]);
  assert.deepEqual(m.alerts.map((a) => a.id), ['0', '1', '2', '3']);
  assert.deepEqual(m.alerts.map((a) => a.tag), ['ועדה היום', 'ועדה מחר', 'ועדה בעוד יומיים', 'ועדה השבוע']);
  assert.deepEqual([m.count, m.weekCount], [3, 4]);
  assert.ok(!m.alerts.some((a) => a.id === 'c' || a.id === '8'));
});

/* ── D. «ועדות» sub-tab on the feed data ─────────────────── */

test('D: the sub-tab lists today and later only, the status when not «מתוכננת», notes; cancelled struck through; escaped', () => {
  const W = require('../public/work.js');
  const h = W.committeesHtml({ committees: { available: true, today: TODAY, source: 'coordinators', items: [
    { id: 'p', date: '2026-10-01', type: 'עבר', status: 'held' },
    { id: 'a', date: TODAY, time: '10:00', type: 'ועדת השמה', patientName: 'דנה <b>', status: 'scheduled', notes: 'להביא <i>סיכום</i>' },
    { id: 'c', date: '2026-10-25', type: 'רפואית', status: 'cancelled' }] } });
  assert.match(h, /ועדות קרובות \(2\)/);
  assert.ok(!h.includes('עבר'), 'a past committee is not «upcoming»');
  assert.ok(h.includes('דנה &lt;b&gt;') && h.includes('הערות: להביא &lt;i&gt;סיכום&lt;/i&gt;'));
  assert.match(h, /<li class="is-cancelled">.*רפואית.*בוטלה/);
  assert.doesNotMatch(h, /מתוכננת/, 'the default status is not repeated on every row');
});

/* ── E. «עדכון משמרת» + «סיכומי ישיבות» through the configured feed ── */

test('E: shiftUpdates — every house via the admin, the manager pinned; summaries come from the feed (Dashboard untouched)', async (t) => {
  const reply2 = (b) => {
    if (b.kind === 'shiftUpdates') return reply(200, { ok: true, house: b.house, from: '2026-10-16', upTo: b.upTo || TODAY,
      updates: [{ id: 'h', date: TODAY, shift: 'בוקר', author: 'א', note: 'n', createdAt: '', backdated: false, extra: 'x' }] });
    if (b.kind === 'summaries') return reply(200, { ok: true, house: b.house, month: b.month, meetings: [{ id: 'm', date: '2026-10-12', title: 't', rows: [] }] });
    return FEED(b);
  };
  const { server, seen, send } = await boot(t, reply2, undefined);
  const admin = await auth.login(server, auth.ADMIN_CODE);
  for (const house of ['raanana', 'ramot', 'efroni', 'rehab', 'pardes']) {
    const d = JSON.parse((await send(admin, { op: 'shiftUpdates', house, upTo: '2026-10-20' })).text);
    assert.deepEqual([d.ok, d.house, d.updates.length], [true, house, 1], house);
    assert.equal(d.updates[0].extra, undefined, 'unknown keys never pass');
  }
  const oran = await auth.login(server, auth.ORAN_CODE);
  seen.feed.length = 0;
  await send(oran, { op: 'shiftUpdates', house: 'pardes' });
  assert.deepEqual(seen.feed.map((f) => [f.body.kind, f.body.house]), [['shiftUpdates', 'ramot']]);
  seen.dash.length = 0;
  const s = JSON.parse((await send(oran, { op: 'meetingSummaries', month: '2026-10' })).text);
  assert.deepEqual([s.summaries.source, s.summaries.items.length], ['coordinators', 1]);
  assert.equal(seen.dash.length, 0, 'the Dashboard is not asked when the feed answers');
});

test('E: summaries — the feed fails → the Dashboard path answers (fallback)', async (t) => {
  const { server, seen, send } = await boot(t, () => reply(502, {}), undefined);
  const oran = await auth.login(server, auth.ORAN_CODE);
  await send(oran, { op: 'meetingSummaries', month: '2026-10' });
  assert.equal(seen.dash.filter((b) => b.op === 'meetingSummaries').length, 1);
});
