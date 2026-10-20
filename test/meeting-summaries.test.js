'use strict';
/* «סיכומי ישיבות» in Managers — READ-ONLY (20 Oct 2026, docs/meeting-summaries.md).
 *   A. proxy: op meetingSummaries is a read; the house is the manager's own (server), the
 *      month validated; the secret / role / actor come from the server only;
 *   B. view: month picker (12 months), escaped text, line breaks by CSS, honest states;
 *   C. wiring. */
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

test('A: proxy — manager pinned to their own house, admin names one; month forwarded / refused; never a write bucket', async (t) => {
  const realFetch = global.fetch;
  let calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push(JSON.parse(opts.body));
    return { status: 200, text: async () => '{"ok":true,"summaries":{"available":true,"items":[]}}', headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear();
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });
  assert.equal((await send(null, { op: 'meetingSummaries' })).status, 401);
  const oran = await auth.login(server, auth.ORAN_CODE);
  const admin = await auth.login(server, auth.ADMIN_CODE);
  const r = await send(oran, { op: 'meetingSummaries', house: 'efroni', month: '2026-09', role: 'admin', actorId: 'forged' });
  assert.equal(r.status, 200);
  assert.deepEqual([calls[0].op, calls[0].house, calls[0].month, calls[0].role, calls[0].actorId], ['meetingSummaries', 'ramot', '2026-09', 'manager', 'person-oran']);
  assert.ok(calls[0].secret, 'the server adds the secret');
  await send(admin, { op: 'meetingSummaries', house: 'pardes', month: '2026-10' });
  assert.deepEqual([calls[1].house, calls[1].role], ['pardes', 'admin']);
  calls = [];
  const bad = await send(oran, { op: 'meetingSummaries', month: '2026-13' });
  assert.deepEqual([bad.status, JSON.parse(bad.text).error], [400, 'bad_month']);
  assert.equal(calls.length, 0, 'a bad month is never forwarded');
  await send(oran, { op: 'meetingSummaries' });
  assert.equal(calls[0].month, undefined, 'no month → the Dashboard uses the current month');
});

const ITEMS = [{
  id: 'm1', date: '2026-10-12', title: 'ישיבת <b>צוות</b>', attendees: 'א, <i>ב</i>', generalNotes: 'שורה 1\nשורה 2 <script>x</script>', finalizedAt: '',
  rows: [{ patientName: 'דנה <img src=x>', weeklyUpdate: 'עדכון\nשני', goals: 'מטרה' }, { patientName: 'יוסי', weeklyUpdate: '', goals: '' }]
}];

test('B: month picker = this month and the 11 before it, newest first, Hebrew labels', () => {
  const m = W.summaryMonths('2026-10-20');
  assert.equal(m.length, 12);
  assert.deepEqual([m[0], m[1], m[9], m[10], m[11]], ['2026-10', '2026-09', '2026-01', '2025-12', '2025-11']);
  assert.equal(W.monthLabel('2026-02'), 'פברואר 2026');
  assert.deepEqual(W.summaryMonths(''), []);
});

test('B: meetings — weekday + date, title, patient count, attendees, notes and per-patient update / goals; everything escaped', () => {
  const h = W.summariesHtml({ month: '2026-10', months: W.summaryMonths('2026-10-20'), res: { summaries: { available: true, items: ITEMS } } });
  assert.match(h, /<option value="2026-10" selected>אוקטובר 2026<\/option>/);
  assert.match(h, /<details class="wk-ms"><summary><span class="wk-shift">יום שני 12\/10\/26<\/span> <span class="wk-name">ישיבת &lt;b&gt;צוות&lt;\/b&gt;<\/span> <span class="wk-meta">\(2 מטופלים\)/);
  assert.match(h, /משתתפים:<\/b> א, &lt;i&gt;ב&lt;\/i&gt;/);
  assert.match(h, /<div class="wk-ms-text">שורה 1\nשורה 2 &lt;script&gt;x&lt;\/script&gt;<\/div>/, 'line breaks kept as text');
  assert.match(h, /wk-ms-patient">דנה &lt;img src=x&gt;<\/div><div class="wk-ms-label">עדכון שבועי<\/div><div class="wk-ms-text">עדכון\nשני<\/div><div class="wk-ms-label">מטרות טיפוליות/);
  assert.match(h, /wk-ms-patient">יוסי<\/div><\/div>/, 'empty fields are left out');
  assert.doesNotMatch(h.replace(/<(\/?)(div|span|b|details|summary|label|select|option|button)( [^>]*)?>/g, ''), /<[a-z]/i, 'no feed value becomes markup');
  assert.doesNotMatch(h, /<form|<input|<textarea|contenteditable/, 'read-only');
});

test('B: states — loading, empty month, feed not connected / older coordinators, read error with «נסו שוב»', () => {
  const base = { month: '2026-10', months: ['2026-10'] };
  assert.match(W.summariesHtml({ ...base, res: null }), /טוען…/);
  assert.match(W.summariesHtml({ ...base, res: { summaries: { available: true, items: [] } } }), /אין סיכומי ישיבות באוקטובר 2026/);
  assert.match(W.summariesHtml({ ...base, res: { summaries: { available: false, reason: 'not_configured' } } }), /עוד לא מחוברים/);
  assert.match(W.summariesHtml({ ...base, res: { summaries: { available: false, reason: 'unknown_action' } } }), /אחרי עדכון אפליקציית הרכזים/);
  assert.match(W.summariesHtml({ ...base, res: { summaries: { available: false, reason: 'bad_contract' } } }), /לא הצלחנו לקרוא/);
  assert.match(W.summariesHtml({ ...base, res: { summaries: undefined } }), /לא הצלחנו לקרוא/, 'an older Dashboard (no summaries field)');
  const err = W.summariesHtml({ ...base, res: { error: 'לא הצלחנו לטעון את סיכומי הישיבות כרגע.' } });
  assert.match(err, /data-ms-retry/);
});

test('C: wiring — sub-tab after «ועדות», loaded only when opened, month change validated, guide shipped, CSS pre-wrap, SW v36+', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('data-sub="committees"') < html.indexOf('data-sub="summaries"'));
  assert.match(html, /<section data-sub-panel="summaries" hidden><\/section>/);
  assert.match(html, /<section class="card guide-sec" id="g-summaries">\s*<h2>8\. סיכומי ישיבות<\/h2>/);
  const w = pub('work.js');
  assert.match(w, /if \(sub === 'summaries'\) loadSummaries\(panel, panel\.getAttribute\('data-house-key'\)\);/);
  assert.match(w, /if \(!st \|\| st\.months\.indexOf\(sel\.value\) < 0\) return;/, 'only a month the picker offered');
  assert.match(w, /\/\/ never a raw code/);
  assert.match(pub('styles.css'), /\.wk-ms-text \{ white-space: pre-wrap;/);
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(pub('sw.js'))[1]) >= 36);
});
