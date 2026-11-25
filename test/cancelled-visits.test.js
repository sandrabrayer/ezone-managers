'use strict';
/* A meeting the office cancelled leaves the managers app (25 Nov 2026).
   Sandra: «למה פגישה שבוטלה עדיין מופיעה אצל המנהלים?»
   1. The Dashboard's op 'meetings' already drops it (E-Zone-Dashboard CHANGELOG-managers-meetings-cancelled.md),
      but the meetings feed could be answered from a saved copy (X-Cache: STALE, up to 24 h old) and nothing
      followed the refresh → meetings.js now follows it once with swr:'wait' and repaints.
   2. The house's visits list (houseData) still carries the visit with outcome 'cancelled' → it leaves
      «ביקורים קרובים», the week / month tiles and the «יומן» fallback; the month list keeps it, labelled. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');
const C = require('../public/calendar.js');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

const TODAY = '2026-11-25'; // Wednesday
const VISITS = [
  { date: '2026-11-25', time: '14:30', name: 'סימה בוטלה', meetingWith: 'חן', outcome: 'cancelled' },
  { date: '2026-11-26', time: '10:00', name: 'ביקור רגיל', meetingWith: 'חן', outcome: '' },
  { date: '2026-11-27', time: '', name: 'מתלבטים', meetingWith: '', outcome: 'thinking' },
  { date: '2026-11-10', time: '', name: 'בוטל בתחילת החודש', meetingWith: '', outcome: ' cancelled ' }
];
const data = () => ({ ok: true, today: TODAY, visits: VISITS, admissions: [] });
function tile(h, label) { const m = new RegExp('<b>([^<]*)</b><span>' + label + '</span>').exec(h); return m ? m[1] : null; }
const upcoming = (h) => (h.split('ביקורים קרובים')[1] || '');

test('isCancelledVisit: only outcome cancelled (trimmed)', () => {
  assert.equal(W.isCancelledVisit({ outcome: 'cancelled' }), true);
  assert.equal(W.isCancelledVisit({ outcome: ' cancelled ' }), true);
  assert.equal(W.isCancelledVisit({ outcome: 'postponed' }), false);
  assert.equal(W.isCancelledVisit({}), false);
  assert.equal(W.isCancelledVisit(null), false);
});

test('dashboard: a cancelled visit is not in «ביקורים קרובים» nor in the week / month tiles', () => {
  const h = W.dashboardHtml(data());
  assert.doesNotMatch(upcoming(h), /סימה בוטלה/);
  assert.match(upcoming(h), /ביקור רגיל/);
  assert.match(upcoming(h), /מתלבטים/, 'other statuses stay');
  assert.equal(tile(h, 'ביקורים השבוע'), '2');
  assert.equal(tile(h, 'ביקורים החודש'), '2');
});

test('«יומן» fallback (meetings feed not connected): the cancelled visit is not an event', () => {
  const titles = C.collect(data(), { state: 'error', list: [] }).items.filter((i) => i.type === 'meeting').map((i) => i.title);
  assert.ok(!titles.includes('סימה בוטלה'));
  assert.ok(!titles.includes('בוטל בתחילת החודש'));
  assert.ok(titles.includes('ביקור רגיל'));
});

test('meetings feed: a STALE answer is followed once with swr:"wait" and repainted; the flag never renders', () => {
  const src = pub('meetings.js');
  assert.match(src, /get\('X-Cache'\)/);
  assert.match(src, /xc === 'STALE'/);
  assert.match(src, /post\(\{ op: 'meetings', house: key, swr: 'wait' \}\)/);
  assert.match(src, /if \(following\[key\]\) return;/);
  assert.match(src, /if \(r && r\.__stale\) return;/);
  assert.match(src, /if \(stale\) followStale\(panel, key\);/);
  assert.doesNotMatch(src, /innerHTML = [^;]*__stale/);
});

test('server: /api/work already honours swr:"wait" for every read op, meetings included', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(s, /wait: b\.swr === 'wait'/);
  assert.match(s, /'meetings', 'meetingReport'/);
});
