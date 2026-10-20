'use strict';
/* Half-yearly feedback «משוב» in Managers (20 Oct 2026, docs/feedback-reminders.md).
 *   A. proxy: op feedbackDone — house / author from the session, shape checks, write bucket;
 *   B. views: home card (overdue red, due soon ≤ 30 days, «אין תאריך התחלה» count), the team
 *      list with «בוצע» + date (max = today), honest unavailable states, everything escaped;
 *   C. save: one request, double tap ignored, future date refused locally, error text;
 *   D. wiring. The date logic itself: test/feedback-due.test.js. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');
const { app, _rateLimiters } = require('../server');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('A: proxy — manager pinned to own house, author from the session; shape checks never forwarded; /lib/feedback-due.js served', async (t) => {
  const realFetch = global.fetch;
  let calls = [];
  global.fetch = async (url, opts = {}) => { calls.push(JSON.parse(opts.body)); return { status: 200, text: async () => '{"ok":true}', headers: { get: () => 'application/json' } }; };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear();
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });
  assert.equal((await send(null, { op: 'feedbackDone', employee: 'א', doneAt: '2026-10-10' })).status, 401);
  const oran = await auth.login(server, auth.ORAN_CODE);
  const r = await send(oran, { op: 'feedbackDone', house: 'efroni', employee: ' נועה ', doneAt: '2026-10-10', actorId: 'forged', doneBy: 'forged' });
  assert.equal(r.status, 200);
  assert.deepEqual([calls[0].op, calls[0].house, calls[0].employee, calls[0].doneAt, calls[0].actorId, calls[0].doneBy], ['feedbackDone', 'ramot', 'נועה', '2026-10-10', 'person-oran', undefined]);
  calls = [];
  for (const [body, code] of [[{ employee: '', doneAt: '2026-10-10' }, 'bad_request'], [{ employee: 'א'.repeat(81), doneAt: '2026-10-10' }, 'bad_request'],
    [{ employee: 'א', doneAt: '10/10/2026' }, 'bad_date'], [{ employee: 'א' }, 'bad_date'], [{ employee: 42, doneAt: '2026-10-10' }, 'bad_request']]) {
    const x = await send(oran, { op: 'feedbackDone', ...body });
    assert.deepEqual([x.status, JSON.parse(x.text).error], [400, code], JSON.stringify(body));
  }
  assert.equal(calls.length, 0, 'never forwarded');
  const lib = await auth.request(server, '/lib/feedback-due.js');
  assert.equal(lib.status, 200);
  assert.match(lib.text, /FEEDBACK_MONTHS = 6/);
  const other = await auth.request(server, '/lib/access.js');
  assert.doesNotMatch(other.text, /canSeeHouse|module\.exports/, 'nothing else under lib/ is served (the SPA shell at most)');
});

const DATA = (over) => ({
  today: '2026-10-20',
  team: { available: true, staff: [
    { name: 'באיחור', kind: 'guide', startDate: '2026-01-01' },
    { name: 'בקרוב <b>', kind: 'guide', startDate: '2026-05-05' },
    { name: 'בהמשך', kind: 'guide', startDate: '2026-09-01' },
    { name: 'בלי תאריך', kind: 'therapist', startDate: '' }
  ] },
  feedback: { supported: true, rows: [] },
  ...over
});

test('B: home card — overdue (red) and due within 30 days, with days; the no-start-date count; a link to the full list', () => {
  const h = W.feedbackCardHtml(DATA());
  assert.match(h, /משובים חצי־שנתיים/);
  assert.match(h, /<li class="wk-fb-overdue"><span class="wk-name">באיחור<\/span><span class="wk-meta">משוב עד 1\/7\/26 · באיחור 111 ימים/);
  assert.match(h, /<li class="wk-fb-soon"><span class="wk-name">בקרוב &lt;b&gt;<\/span><span class="wk-meta">משוב עד 5\/11\/26 · בעוד 16 ימים/);
  assert.doesNotMatch(h, /בהמשך/, 'not due yet → not on the home card');
  assert.match(h, /עובד\/ת אחד\/ת ללא תאריך התחלה/);
  assert.match(h, /data-go-sub="team"/);
  const none = W.feedbackCardHtml(DATA({ team: { available: true, staff: [{ name: 'א', startDate: '2026-09-01' }] } }));
  assert.match(none, /אין משובים באיחור או ב-30 הימים הקרובים/);
});

test('B: a done date moves the next feedback 6 months on; the full list has «בוצע» + date (max = today) per employee', () => {
  const h = W.feedbackListHtml(DATA({ feedback: { supported: true, rows: [{ employee: 'באיחור', doneAt: '2026-10-01' }] } }));
  assert.match(h, /<li class="wk-fb-soon"><span class="wk-name">בקרוב &lt;b&gt;/);
  assert.match(h, /באיחור<\/span><span class="wk-meta">בהמשך · עד 1\/4\/27 · משוב אחרון 1\/10\/26/);
  assert.match(h, /בלי תאריך<\/span><span class="wk-meta">אין תאריך התחלה</);
  assert.equal((h.match(/data-fb-form="/g) || []).length, 4);
  assert.match(h, /<input type="hidden" name="employee" value="בקרוב &lt;b&gt;">/);
  assert.match(h, /<input name="doneAt" type="date" required value="2026-10-20" max="2026-10-20">/);
  assert.doesNotMatch(h, /<b>/, 'names never become markup');
});

test('B: honest states — no coordinators feed, an older Dashboard without feedback rows', () => {
  assert.match(W.feedbackCardHtml(DATA({ team: { available: false, reason: 'not_configured' } })), /עוד לא מחוברים/);
  assert.match(W.feedbackListHtml(DATA({ feedback: undefined })), /אחרי עדכון השרת/);
  assert.equal(W.feedbackModel(DATA({ feedback: undefined })), null);
});

function fakeForm(employee, doneAt, max) {
  const els = [];
  const mk = () => { const e = { disabled: false }; els.push(e); return e; };
  const attrs = {};
  const msg = { textContent: '' };
  const doneEl = Object.assign(mk(), { value: doneAt, getAttribute: (k) => (k === 'max' ? max : null) });
  return {
    elements: { employee: Object.assign(mk(), { value: employee }), doneAt: doneEl },
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; },
    querySelector: (s) => (s === '[data-fb-msg]' ? msg : null), querySelectorAll: () => els, msg, els
  };
}

test('C: save — ONE request, a double tap is ignored, all disabled while saving; then the house reloads', async () => {
  const sent = []; let refreshed = 0; let release;
  const deps = { post: (b) => { sent.push(b); return new Promise((r) => { release = r; }); }, refresh: async () => { refreshed++; } };
  const f = fakeForm('נועה', '2026-10-19', '2026-10-20');
  const p1 = W.saveFeedback({}, 'ramot', f, deps);
  const p2 = W.saveFeedback({}, 'ramot', f, deps);
  assert.equal(sent.length, 1, 'double tap → one request');
  assert.deepEqual(sent[0], { op: 'feedbackDone', house: 'ramot', employee: 'נועה', doneAt: '2026-10-19' });
  assert.ok(f.els.every((e) => e.disabled));
  assert.equal(f.msg.textContent, 'שומר...');
  release({ ok: true }); await p1; await p2;
  assert.equal(refreshed, 1);
});

test('C: a future / invalid date is refused locally; a server refusal shows a Hebrew reason and re-enables the form', async () => {
  const sent = [];
  const deps = { post: async (b) => { sent.push(b); const e = new Error('x'); e.data = { error: 'not_found' }; throw e; }, refresh: async () => {} };
  const fut = fakeForm('נועה', '2026-10-21', '2026-10-20');
  await W.saveFeedback({}, 'ramot', fut, deps);
  assert.equal(sent.length, 0);
  assert.match(fut.msg.textContent, /לא בעתיד/);
  const f = fakeForm('נועה', '2026-10-20', '2026-10-20');
  await W.saveFeedback({}, 'ramot', f, deps);
  assert.equal(sent.length, 1);
  assert.match(f.msg.textContent, /לא ברשימת העובדים/);
  assert.ok(f.els.every((e) => !e.disabled), 're-enabled');
  assert.equal(W.feedbackErrorText({}), 'השמירה נכשלה — נסו שוב', 'never a raw code');
});

test('D: wiring — lib script before work.js; card on «הבית היום»; list in «צוות ומשמרות»; guide shipped; SW v37+', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('/lib/feedback-due.js') > 0 && html.indexOf('/lib/feedback-due.js') < html.indexOf('/work.js'));
  const w = pub('work.js');
  assert.match(w, /var h = todayCardHtml\(todayModel\(d\)\);\s*h \+= feedbackCardHtml\(d\);/);
  assert.match(w, /tm\.innerHTML = teamHtml\(d\) \+ feedbackListHtml\(d\);/);
  assert.match(w, /if \(fbForm\) \{ ev\.preventDefault\(\); await saveFeedback\(panel, key, fbForm\); return; \}/);
  assert.match(html, /<h2>9\. תזכורות משוב חצי־שנתי<\/h2>/);
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(pub('sw.js'))[1]) >= 37);
  assert.match(pub('styles.css'), /\.wk-fb-overdue \{/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'lib', 'bonus-eligibility.js'), 'utf8'), /feedback|משוב/, 'bonus math untouched');
});
