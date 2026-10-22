'use strict';
/* «עדכון משמרת» in Managers — READ-ONLY (22 Oct 2026, docs/shift-updates.md).
 *   A. proxy: op shiftUpdates needs the session; the feed is NOT configured in this process →
 *      an honest not_configured (no request anywhere); a bad upTo → 400;
 *   B. view: week bar, shift filter, grouped by day, escaped, «הוזן בדיעבד», every state
 *      (loading / not connected / failed ≠ empty / empty week);
 *   C. wiring: the sub-tab after «סיכומי ישיבות», SW bump, nothing stored on the device. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
delete process.env.COORDINATORS_FEED_URL;
delete process.env.COORDINATORS_FEED_SECRET;
const auth = require('./helpers-auth');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');
const { app, _rateLimiters, _coordFeed } = require('../server');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('A: no session → 401; feed not configured → not_configured and NO request; bad upTo → 400', async (t) => {
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { status: 200, text: async () => '{}' }; };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear();
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });
  assert.equal((await send(null, { op: 'shiftUpdates' })).status, 401);
  assert.equal(_coordFeed.configured, false);
  const oran = await auth.login(server, auth.ORAN_CODE);
  calls = 0;
  const r = await send(oran, { op: 'shiftUpdates', house: 'efroni' });
  assert.deepEqual([r.status, JSON.parse(r.text)], [200, { ok: false, error: 'not_configured' }]);
  assert.equal(calls, 0, 'nothing is fetched while the feed is off');
  const bad = await send(oran, { op: 'shiftUpdates', upTo: '2026-02-30x' });
  assert.deepEqual([bad.status, JSON.parse(bad.text).error], [400, 'bad_date']);
});

const ST = (res, extra) => Object.assign({ upTo: '2026-10-22', today: '2026-10-22', shift: '', res }, extra || {});
const UPD = [
  { id: '1', date: '2026-10-22', shift: 'בוקר', author: 'דנה <b>', note: 'שורה 1\nשורה 2 <script>x</script>', createdAt: '2026-10-22T06:00:00Z', backdated: false },
  { id: '2', date: '2026-10-22', shift: 'לילה', author: 'יוסי', note: 'רגוע', createdAt: '2026-10-22T03:00:00Z', backdated: false },
  { id: '3', date: '2026-10-19', shift: 'בוקר', author: 'רון', note: 'נכתב אחר כך', createdAt: '2026-10-21T08:30:00Z', backdated: true }];

test('B: the week — grouped by day, escaped, line breaks by CSS, «הוזן בדיעבד» with the real entry time', () => {
  const h = W.shiftUpdatesHtml(ST({ updates: UPD, from: '2026-10-16', upTo: '2026-10-22' }));
  assert.match(h, /עדכון משמרת/);
  assert.equal((h.match(/class="wk-su-day"/g) || []).length, 2);
  assert.ok(h.includes('דנה &lt;b&gt;') && h.includes('&lt;script&gt;x&lt;/script&gt;'), 'escaped');
  assert.ok(!/<script>|<b>/.test(h.replace(/<b>[^<]*<\/b>/g, '')));
  assert.match(h, /הוזן בדיעבד · 21\/10\/26 11:30/);
  assert.match(h, /data-su-nav="next" disabled/, 'never past this week');
  assert.match(h, /לקריאה בלבד/);
  assert.doesNotMatch(h, /<form|<textarea|data-su-save/, 'no editor');
});

test('B: shift filter; empty week; loading; not connected; a FAILED read is never an empty week', () => {
  const f = W.shiftUpdatesHtml(ST({ updates: UPD, from: '2026-10-16', upTo: '2026-10-22' }, { shift: 'לילה' }));
  assert.ok(f.includes('יוסי') && !f.includes('רון'));
  assert.match(W.shiftUpdatesHtml(ST({ updates: [], from: '2026-10-16', upTo: '2026-10-22' })), /אין עדכוני משמרת בשבוע הזה/);
  assert.match(W.shiftUpdatesHtml(ST(null)), /טוען…/);
  const off = W.shiftUpdatesHtml(ST({ error: true, code: 'not_configured' }));
  assert.match(off, /עוד לא מחוברים/);
  const down = W.shiftUpdatesHtml(ST({ error: true, code: 'timeout' }));
  assert.match(down, /לא הצלחנו לטעון את עדכוני המשמרת כרגע/);
  assert.match(down, /זה לא אומר שאין עדכונים/);
  assert.match(down, /data-su-retry/);
  assert.doesNotMatch(down, /אין עדכוני משמרת בשבוע/);
  assert.doesNotMatch(down, /timeout/, 'never a raw code');
  const past = W.shiftUpdatesHtml(ST(null, { upTo: '2026-10-08' }));
  assert.doesNotMatch(past, /data-su-nav="next" disabled/);
});

test('C: wiring — sub-tab after «סיכומי ישיבות», panel, SW bump, nothing on the device', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('data-sub="summaries"') < html.indexOf('data-sub="shiftUpdates"'));
  assert.match(html, /<section data-sub-panel="shiftUpdates" hidden><\/section>/);
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(pub('sw.js'))[1]) >= 39);
  const w = pub('work.js');
  assert.match(w, /if \(sub === 'shiftUpdates'\) loadShiftUpdates\(panel, panel\.getAttribute\('data-house-key'\)\);/);
  assert.doesNotMatch(w, /localStorage|sessionStorage|indexedDB/);
});
