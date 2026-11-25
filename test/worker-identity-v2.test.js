'use strict';
// Worker identity v2 client compatibility (Dashboard #415, docs/worker-identity-v2.md).
// Synthetic upstream only: no network, no secrets, no real staff. Existing access is unchanged.
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://synthetic.test/exec';
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('./helpers-auth');
const F = require('../lib/feedback-due');
const W = require('../public/work');
const C = require('../public/crm');
const { app, _rateLimiters, _readCache } = require('../server');

const TODAY = '2026-11-21';
// Two people with one name, each with a certified v2 pair, plus a unique worker.
const V2 = [
  { name: 'דנה', kind: 'guide', role: 'מדריכה', startDate: '2026-01-01', workerId: 'w-A', assignmentId: 'as-A1' },
  { name: 'דנה', kind: 'guide', role: 'מדריכה', startDate: '2026-04-01', workerId: 'w-B', assignmentId: 'as-B1' },
  { name: 'משה', kind: 'guide', role: 'מדריך', startDate: '2026-02-01', workerId: 'w-C', assignmentId: 'as-C1' }
];
const V1 = [{ name: 'נועה', kind: 'guide', startDate: '2026-01-01' }, { name: 'רוני', startDate: '2026-01-01' }, { name: 'רוני', startDate: '2026-02-01' }];

/* ── pure: lib/feedback-due.js ───────────────────────── */

test('v2 feedback: two same-name workers are two writable rows, each with its own certified pair', () => {
  const m = F.houseFeedback(V2, [
    { employee: 'דנה', doneAt: '2026-10-01' },                                   // legacy name-only: belongs to neither
    { employee: 'דנה', doneAt: '2026-09-15', workerId: 'w-B', assignmentId: 'as-B1' }
  ], TODAY);
  const a = m.items.find((x) => x.workerId === 'w-A'), b = m.items.find((x) => x.workerId === 'w-B');
  assert.deepEqual([a.assignmentId, b.assignmentId], ['as-A1', 'as-B1']);
  assert.equal(a.writeBlocked, false); assert.equal(b.writeBlocked, false);
  assert.equal(a.lastFeedback, '', 'old name-only history is not attributed to a certified worker');
  assert.equal(b.lastFeedback, '2026-09-15');
  const html = W.feedbackListHtml({ today: TODAY, team: { available: true, staff: V2 }, feedback: { supported: true, rows: [] } });
  assert.equal((html.match(/data-fb-form=/g) || []).length, 3);
  assert.match(html, /data-fb-wid="w-A" data-fb-aid="as-A1"/);
  assert.match(html, /data-fb-wid="w-B" data-fb-aid="as-B1"/);
});

test('v1 roster unchanged: unique name writable without ids, a shared name stays blocked', () => {
  const m = F.houseFeedback(V1, [], TODAY);
  const noa = m.items.find((x) => x.name === 'נועה');
  assert.equal(noa.writeBlocked, false); assert.equal(noa.workerId, undefined);
  assert.ok(m.items.filter((x) => x.name === 'רוני').every((x) => x.writeBlocked));
  const html = W.feedbackListHtml({ today: TODAY, team: { available: true, staff: V1 }, feedback: { supported: true, rows: [] } });
  assert.doesNotMatch(html, /data-fb-wid/);
});

test('uncertified or non-unique identities never become a write identity', () => {
  assert.equal(F.certifiedIdentity({ workerId: 'w-1' }), null, 'half a pair');
  assert.equal(F.certifiedIdentity({ employeeId: 'w-1', assignmentId: 'a-1' }), null, 'employeeId is not the v2 field');
  assert.equal(F.certifiedIdentity({ workerId: 'w 1', assignmentId: 'a-1' }), null, 'bad characters');
  assert.equal(F.certifiedIdentity({ workerId: 'x'.repeat(121), assignmentId: 'a-1' }), null, 'too long');
  // One worker with two assignments in the SAME house, and a duplicated assignment.
  const twice = [{ name: 'עדי', workerId: 'w-1', assignmentId: 'a-1' }, { name: 'עדי', workerId: 'w-1', assignmentId: 'a-2' }];
  assert.ok(F.houseFeedback(twice, [], TODAY).items.every((x) => x.writeBlocked));
  const dupA = [{ name: 'עדי', workerId: 'w-1', assignmentId: 'a-1' }, { name: 'גל', workerId: 'w-2', assignmentId: 'a-1' }];
  assert.ok(F.houseFeedback(dupA, [], TODAY).items.every((x) => x.writeBlocked));
  // Uncertified id (employeeId only) keeps the #82 block.
  assert.ok(F.houseFeedback([{ name: 'עדי', employeeId: 'e-1' }], [], TODAY).items[0].writeBlocked);
});

test('talkIdentity: first talks, the card pick, renamed follow-ups and legacy threads', () => {
  // Shared name typed in the form → refused; the card's exact pair → that person only.
  assert.deepEqual(F.talkIdentity(V2, 'דנה', null, null), { ok: false, reason: 'ambiguous' });
  assert.deepEqual(F.talkIdentity(V2, 'דנה', null, { workerId: 'w-B', assignmentId: 'as-B1' }),
    { ok: true, name: 'דנה', workerId: 'w-B', assignmentId: 'as-B1' });
  assert.equal(F.talkIdentity(V2, 'דנה', null, { workerId: 'w-B', assignmentId: 'as-A1' }).ok, false, 'a swapped pair');
  assert.equal(F.talkIdentity(V2, 'משה', null, { workerId: 'w-A', assignmentId: 'as-A1' }).ok, false, 'a pair of another name');
  // Unique certified name → its pair is attached automatically.
  assert.deepEqual(F.talkIdentity(V2, 'משה', null, null), { ok: true, name: 'משה', workerId: 'w-C', assignmentId: 'as-C1' });
  // A follow-up follows the pair after a rename and sends the CURRENT name.
  const renamed = V2.map((x) => (x.workerId === 'w-C' ? Object.assign({}, x, { name: 'משה כהן' }) : x));
  assert.deepEqual(F.talkIdentity(renamed, 'משה', { id: 't1', employeeName: 'משה', workerId: 'w-C', assignmentId: 'as-C1' }, null),
    { ok: true, name: 'משה כהן', workerId: 'w-C', assignmentId: 'as-C1' });
  // The parent's worker left / moved (assignment no longer in this house) → refused.
  assert.equal(F.talkIdentity(V2, 'משה', { id: 't1', workerId: 'w-C', assignmentId: 'as-OTHER' }, null).ok, false);
  // A legacy name-only thread never adopts a certified pair (the Dashboard refuses it too).
  assert.equal(F.talkIdentity(V2, 'משה', { id: 't0', employeeName: 'משה' }, null).ok, false);
  // v1: unchanged — a unique name goes name-only; a shared name is refused.
  assert.deepEqual(F.talkIdentity(V1, 'נועה', null, null), { ok: true, name: 'נועה' });
  assert.deepEqual(F.talkIdentity(V1, 'נועה', { id: 't0', employeeName: 'נועה' }, null), { ok: true, name: 'נועה' });
  assert.equal(F.talkIdentity(V1, 'רוני', null, null).ok, false);
});

test('employee card: a certified same-name worker gets the talk button carrying ONLY their own pair', () => {
  const d = { today: TODAY, team: { available: true, staff: V2 }, logs: { staffTalks: [
    { id: 't1', employeeName: 'דנה', workerId: 'w-A', assignmentId: 'as-A1', talkDate: '2026-11-01', summary: 'synthetic A' },
    { id: 't2', employeeName: 'דנה', workerId: 'w-B', assignmentId: 'as-B1', talkDate: '2026-11-02', summary: 'synthetic B' },
    { id: 't3', employeeName: 'דנה', talkDate: '2026-10-02', summary: 'legacy name-only' }
  ] } };
  const h = C.employeeCardHtml(d, 'wid:w-B', { available: true, workers: [] }, null, 'talks');
  assert.match(h, /data-emp-talk="דנה" data-emp-wid="w-B" data-emp-aid="as-B1"/);
  assert.doesNotMatch(h, /w-A|synthetic A|legacy name-only/, 'never the other person or guessed history');
  assert.match(h, /synthetic B/);
});

test('client: the feedback request carries the pair; the source form is checked before any id is sent', () => {
  const w = require('node:fs').readFileSync(require.resolve('../public/work.js'), 'utf8');
  assert.match(w, /req\.workerId = fbIdentity\.workerId; req\.assignmentId = fbIdentity\.assignmentId;/);
  assert.match(w, /\(item\.workerId \|\| ''\) !== drawnWid \|\| \(item\.assignmentId \|\| ''\) !== drawnAid/);
  assert.match(w, /FD\.talkIdentity\(roster, res\.entry\.employeeName, parent, picked\)/);
  assert.match(w, /delete res\.entry\.workerId; delete res\.entry\.assignmentId;/, 'only the verified pair leaves the form');
});

/* ── server: the Managers gate before a personal write ── */

function rosterReply(staff, extra) {
  return JSON.stringify({ ok: true, team: Object.assign({ available: true, stale: false, updatedAt: '2026-11-21T08:00:00.000Z', staff }, extra || {}) });
}
async function harness(t, rosterFor) {
  const old = global.fetch, calls = [];
  global.fetch = async (_, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const text = body.op === 'houseData' ? rosterFor(body) : '{"ok":true}';
    return { ok: true, status: 200, text: async () => text, headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = old; });
  Object.values(_rateLimiters).forEach((x) => x.clear && x.clear());
  _readCache.clear();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const cookie = await auth.login(server, auth.ORAN_CODE);   // ramot house manager
  const send = (body) => auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body })
    .then((r) => ({ status: r.status, json: JSON.parse(r.text) }));
  const writes = () => calls.filter((c) => c.op !== 'houseData');
  return { calls, writes, send, server };
}

test('server: a certified pair is forwarded with the session house; same-name people stay separate', async (t) => {
  const h = await harness(t, () => rosterReply(V2));
  const fb = await h.send({ op: 'feedbackDone', house: 'raanana', employee: 'דנה', doneAt: '2026-11-01', workerId: 'w-B', assignmentId: 'as-B1' });
  assert.equal(fb.status, 200);
  const w = h.writes().at(-1);
  assert.deepEqual([w.op, w.house, w.actorId, w.employee, w.workerId, w.assignmentId],
    ['feedbackDone', 'ramot', 'person-oran', 'דנה', 'w-B', 'as-B1'], 'house from the session, never the body');
  const roster = h.calls.find((c) => c.op === 'houseData');
  assert.deepEqual([roster.house, roster.role, roster.actorId], ['ramot', 'manager', 'person-oran'], 'roster read as THIS person');
  // Swapped pair (A's worker, B's assignment) and the right pair with the wrong name → refused, not forwarded.
  const n = h.writes().length;
  const swapped = await h.send({ op: 'feedbackDone', employee: 'דנה', doneAt: '2026-11-01', workerId: 'w-A', assignmentId: 'as-B1' });
  assert.deepEqual([swapped.status, swapped.json.error], [409, 'identity_review_required']);
  const wrongName = await h.send({ op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01', workerId: 'w-A', assignmentId: 'as-A1' });
  assert.deepEqual([wrongName.status, wrongName.json.error], [409, 'identity_review_required']);
  assert.equal(h.writes().length, n);
  // Staff talk: the pair is verified and travels inside the entry.
  const talk = await h.send({ op: 'logAdd', log: 'staffTalks', entry: { employeeName: 'דנה', talkDate: '2026-11-01', summary: 'synthetic', workerId: 'w-A', assignmentId: 'as-A1' } });
  assert.equal(talk.status, 200);
  const e = JSON.parse(h.writes().at(-1).entry);
  assert.deepEqual([e.employeeName, e.workerId, e.assignmentId], ['דנה', 'w-A', 'as-A1']);
});

test('server: another house\'s pair, a v1 roster, a stale or unreadable roster all fail closed', async (t) => {
  let mode = 'v2';
  const h = await harness(t, () => {
    if (mode === 'v1') return rosterReply(V1);
    if (mode === 'stale') return rosterReply(V2, { stale: true });
    if (mode === 'down') return JSON.stringify({ ok: false, error: 'lock_busy' });
    return rosterReply(V2);
  });
  const efroniPair = { op: 'feedbackDone', house: 'efroni', employee: 'דנה', doneAt: '2026-11-01', workerId: 'w-Z', assignmentId: 'as-Z9' };
  assert.deepEqual((await h.send(efroniPair)).json.error, 'identity_review_required', 'a pair not in THIS house roster');
  for (const [m, code] of [['v1', 'identity_contract_required'], ['stale', 'identity_review_required'], ['down', 'identity_review_required']]) {
    mode = m; _readCache.clear();
    const r = await h.send({ op: 'feedbackDone', employee: 'נועה', doneAt: '2026-11-01', workerId: 'w-A', assignmentId: 'as-A1' });
    assert.deepEqual([r.status, r.json.error], [409, code], m);
  }
  assert.equal(h.writes().length, 0, 'no id ever reaches a writer that cannot certify it');
  // The unchanged v1 name-only path still works.
  mode = 'v1';
  assert.equal((await h.send({ op: 'feedbackDone', employee: 'נועה', doneAt: '2026-11-01' })).status, 200);
  assert.equal(h.writes().at(-1).workerId, undefined);
});

test('server: malformed ids, half pairs, employeeId and ids on non-personal logs are refused before any read', async (t) => {
  const h = await harness(t, () => rosterReply(V2));
  const bad = [
    [{ op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01', workerId: 'w C', assignmentId: 'as-C1' }, 400, 'bad_request'],
    [{ op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01', workerId: ['w-C'], assignmentId: 'as-C1' }, 400, 'bad_request'],
    [{ op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01', workerId: 'w-C' }, 409, 'identity_contract_required'],
    [{ op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01', employeeId: 'w-C', workerId: 'w-C', assignmentId: 'as-C1' }, 409, 'identity_contract_required'],
    [{ op: 'logAdd', log: 'staffTalks', entry: { employeeName: 'משה', talkDate: '2026-11-01', summary: 's', assignmentId: 'as-C1' } }, 409, 'identity_contract_required'],
    [{ op: 'logAdd', log: 'events', entry: { title: 'x', eventDate: '2026-11-01', workerId: 'w-C', assignmentId: 'as-C1' } }, 409, 'identity_contract_required']
  ];
  for (const [body, status, error] of bad) {
    const r = await h.send(body);
    assert.deepEqual([r.status, r.json.error], [status, error], JSON.stringify(body));
  }
  assert.equal(h.calls.length, 0, 'nothing forwarded, not even a roster read');
});

test('server: a replay is re-verified against the live roster after every write (rename / leave)', async (t) => {
  let staff = V2;
  const h = await harness(t, () => rosterReply(staff));
  const req = { op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01', workerId: 'w-C', assignmentId: 'as-C1' };
  assert.equal((await h.send(req)).status, 200);
  // The write dropped this house's cached roster; the worker is renamed in the source.
  staff = V2.map((x) => (x.workerId === 'w-C' ? Object.assign({}, x, { name: 'משה כהן' }) : x));
  const replay = await h.send(req);
  assert.deepEqual([replay.status, replay.json.error], [409, 'identity_review_required'], 'an old name + pair is not replayed');
  assert.equal((await h.send(Object.assign({}, req, { employee: 'משה כהן' }))).status, 200, 'the current name with the same pair');
  assert.equal(h.calls.filter((c) => c.op === 'houseData').length, 2, 'the write dropped the cached roster: the replay read it fresh');
});
