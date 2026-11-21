'use strict';
// Contract tests: explicit IDs may not be silently stripped by the name-only
// Dashboard action. Synthetic request upstream only; existing auth unchanged.
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://synthetic.test/exec';
const auth = require('./helpers-auth');
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, _rateLimiters } = require('../server');

test('Managers rejects unsupported worker IDs before forwarding writes; legacy name-only contract stays compatible', async t => {
  const old = global.fetch, calls = [];
  global.fetch = async (_, opts) => {
    calls.push(JSON.parse(opts.body));
    return { status: 200, text: async () => '{"ok":true}', headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = old; });
  Object.values(_rateLimiters).forEach(x => x.clear && x.clear());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const oran = await auth.login(server, auth.ORAN_CODE);
  const send = body => auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: oran }, body });

  const initial = calls.length;
  for (const field of ['workerId', 'employeeId', 'assignmentId']) {
    const a = await send({ op: 'feedbackDone', house: 'efroni', employee: 'Synthetic', doneAt: '2026-11-01', [field]: 'W1' });
    assert.deepEqual([a.status, JSON.parse(a.text).error], [409, 'identity_contract_required']);
    const b = await send({ op: 'logAdd', log: 'staffTalks', house: 'efroni',
      entry: { employeeName: 'Synthetic', summary: 'safe test', talkDate: '2026-11-01', [field]: 'W1' } });
    assert.deepEqual([b.status, JSON.parse(b.text).error], [409, 'identity_contract_required']);
  }
  assert.equal(calls.length, initial, 'an ID must never disappear at the source boundary');
  const good = await send({ op: 'feedbackDone', house: 'efroni', employee: 'Synthetic', doneAt: '2026-11-01' });
  assert.equal(good.status, 200, 'existing legitimate name-only data path is preserved');
  assert.deepEqual([calls.at(-1).house, calls.at(-1).actorId, calls.at(-1).employee],
    ['ramot', 'person-oran', 'Synthetic'], 'source context always from original session');
  const talk = await send({ op: 'logAdd', house: 'efroni', log: 'staffTalks',
    entry: { employeeName: 'Synthetic', talkDate: '2026-11-01', summary: 'synthetic' } });
  assert.equal(talk.status, 200, 'current authorized non-ambiguous log path remains available');
  assert.equal(calls.length, initial + 2);
});
