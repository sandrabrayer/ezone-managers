'use strict';
/* Committees «ועדות» in Managers — READ-ONLY since 20 Oct 2026 (docs/committee.md).
 *   A. proxy: the old write op committeeSet is GONE — 410 for every role, nothing forwarded;
 *   B. views: «ועדות» sub-tab lists houseData.committees (escaped, read-only), honest
 *      unavailable states; no committee editor on «מטופלים»;
 *   C. alerts: the shared rule (fixture pinned with E-Zone-Dashboard) on the new
 *      `committees.items` shape; text-only card, «לוועדות» opens the sub-tab, admin filter;
 *   D. wiring + bonus untouched. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const W = require('../public/work.js');
const CA = require('../public/committee-alerts.js');
const { app, _rateLimiters } = require('../server');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'committee-alert-cases.json');
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
/* The SAME hash is pinned in E-Zone-Dashboard test/dashboard-committees.test.js. */
const SHARED_FIXTURE_SHA256 = '6cd48c587dcf3cd497286c0cad284fa179a9d65e3e13fb5af9061fec0e328f46';
const TODAY = '2026-10-15';

/* ── A. proxy ─────────────────────────────────────────────── */

test('A: committeeSet is GONE — 410 committee_read_only for manager and admin, nothing forwarded; no session 401', async (t) => {
  const realFetch = global.fetch;
  let calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push(JSON.parse(opts.body));
    return { status: 200, text: async () => '{"ok":true}', headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear();
  const OK = { op: 'committeeSet', patientName: 'דנה', entryDate: '2026-09-01', committeeDate: '2026-10-20', label: 'השמה', previousDate: '', previousLabel: '' };
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });
  assert.equal((await send(null, OK)).status, 401);
  const oran = await auth.login(server, auth.ORAN_CODE);
  const admin = await auth.login(server, auth.ADMIN_CODE);
  for (const [cookie, body] of [[oran, OK], [admin, { ...OK, house: 'efroni' }], [oran, { ...OK, mode: 'clear' }], [oran, { op: 'committeeSet' }]]) {
    const r = await send(cookie, body);
    assert.equal(r.status, 410);
    const j = JSON.parse(r.text);
    assert.equal(j.error, 'committee_read_only');
    assert.match(j.message, /הרכזים/);
  }
  assert.equal(calls.length, 0, 'never forwarded to the Dashboard');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ops = /const WORK_OPS = new Set\(\[([^\]]*)\]\);/.exec(src)[1];
  assert.doesNotMatch(ops, /committeeSet/, 'committeeSet is not a work op');
  assert.doesNotMatch(/const WRITE_OPS = new Set\(\[([^\]]*)\]\);/.exec(src)[1], /committeeSet/);
  assert.doesNotMatch(src, /committeeDate|COMMITTEE_LABEL_MAX/, 'no write path left');
});

/* ── B. views ─────────────────────────────────────────────── */

const ITEMS = [
  { id: 'c1', date: '2026-10-15', time: '10:00', type: 'ועדת השמה', participants: 'רופא, <b>משפחה</b>', patientName: 'דנה <img src=x>' },
  { id: 'c2', date: '2026-10-20', time: '', type: 'ועדה רפואית', participants: '', patientName: '' }
];
const DATA = (committees) => ({ ok: true, today: TODAY, patients: [{ name: 'דנה', entryDate: '2026-09-01', days: 45, status: 'active', committee: { date: '2026-10-15', label: 'x' } }], committeeSupported: false, committees });

test('B: «ועדות» sub-tab — every upcoming committee: weekday, date, time, type, patient, participants; escaped; read-only note', () => {
  const h = W.committeesHtml(DATA({ available: true, today: TODAY, items: ITEMS }));
  assert.match(h, /ועדות קרובות \(2\)/);
  assert.match(h, /את הוועדות קובעים הרכזים באפליקציית הרכזים/);
  assert.match(h, /wk-shift">יום חמישי 15\/10\/26 · 10:00<\/span><span class="wk-name">ועדת השמה · דנה &lt;img src=x&gt;<\/span><span class="wk-meta">משתתפים: רופא, &lt;b&gt;משפחה&lt;\/b&gt;/);
  assert.match(h, /wk-shift">יום שלישי 20\/10\/26<\/span><span class="wk-name">ועדה רפואית<\/span>/);
  assert.doesNotMatch(h, /<(img|b)[ >]|<form|<input|<button/, 'no markup from the feed, no editor');
  assert.match(W.committeesHtml(DATA({ available: true, today: TODAY, items: [] })), /אין ועדות קרובות/);
});

test('B: unavailable feed → an honest message, never an empty list that looks real', () => {
  assert.match(W.committeesHtml(DATA({ available: false, reason: 'not_configured' })), /עוד לא מחוברות/);
  assert.match(W.committeesHtml(DATA({ available: false, reason: 'unreachable' })), /לא הצלחנו לקרוא את הוועדות/);
  assert.match(W.committeesHtml(DATA(undefined)), /אחרי עדכון השרת/);
  assert.doesNotMatch(W.committeesHtml(DATA({ available: false, reason: 'unreachable' })), /אין ועדות קרובות/);
});

test('B: «מטופלים» has no committee editor any more (even if an old payload carries patients[].committee)', () => {
  const h = W.patientsHtml({ ...DATA({ available: true, items: [] }), committeeSupported: true });
  assert.doesNotMatch(h, /data-cm-|ועדה:|הגדרת תאריך ועדה/);
  const w = pub('work.js');
  assert.doesNotMatch(w, /committeeSet|saveCommittee|data-cm-form|data-cm-edit|data-cm-clear/);
});

/* ── C. alerts ─────────────────────────────────────────────── */

const DM = (items, today) => ({ committees: { available: true, today: today || TODAY, items } });

test('C: shared fixture — byte-identical to the one E-Zone-Dashboard pins; constants', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_PATH)).digest('hex'), SHARED_FIXTURE_SHA256);
  assert.equal(CA.COMMITTEE_LEAD_DAYS, FIXTURE.COMMITTEE_LEAD_DAYS);
  assert.equal(CA.TIME_ZONE, FIXTURE.TIME_ZONE);
  assert.equal((pub('committee-alerts.js').match(/var COMMITTEE_LEAD_DAYS = 7;/g) || []).length, 1);
});

test('C: boundaries from the fixture (today, +1, +7 in; +8, -1 out; year / leap; bad dates)', () => {
  for (const c of FIXTURE.alerts) {
    const a = CA.houseAlerts(DM([{ id: 'x', date: c.date, time: '', type: 'ועדה', participants: '', patientName: 'א' }], c.today), 'ramot', c.today).alerts[0];
    assert.deepEqual(a ? { days: a.days, kind: a.kind, whenText: a.whenText } : null, c.expect, c.today + ' → ' + c.date);
  }
});

test('C: timezone / midnight — "today" is the calendar day in Israel (incl. the DST eve)', () => {
  for (const c of FIXTURE.israelToday) assert.equal(CA.israelToday(new Date(c.utc)), c.today, c.utc);
});

test('C: sorted by date; name = patient else type; label = type (with a patient) + time; unavailable → the reason', () => {
  const m = CA.houseAlerts(DM([ITEMS[1], ITEMS[0], { id: 'old', date: '2026-10-14', type: 'עבר', patientName: '' }]), 'ramot', TODAY);
  assert.deepEqual(m.alerts.map((a) => [a.name, a.kind, a.whenText, a.label, a.id]),
    [['דנה <img src=x>', 'today', 'היום', 'ועדת השמה · 10:00', 'c1'], ['ועדה רפואית', 'week', 'בעוד 5 ימים', '', 'c2']]);
  assert.equal(m.count, 1, 'the badge counts today .. +2 only (22 Oct 2026)');
  assert.equal(m.weekCount, 2);
  const off = CA.houseAlerts({ committees: { available: false, reason: 'unauthorized' } }, 'ramot', TODAY);
  assert.deepEqual([off.supported, off.unavailableText], [false, 'הוועדות מאפליקציית הרכזים עוד לא מחוברות']);
  assert.equal(CA.houseAlerts({ patients: [{ name: 'א', committee: { date: TODAY } }] }, 'ramot', TODAY).supported, false, 'the old per-patient shape is ignored');
});

test('C: house isolation + admin filter', () => {
  const ramot = CA.houseAlerts(DM([{ id: 'r', date: '2026-10-16', type: 'א' }]), 'ramot', TODAY);
  const efroni = CA.houseAlerts(DM([{ id: 'e', date: '2026-10-15', type: 'ב' }]), 'efroni', TODAY);
  assert.deepEqual(ramot.alerts.map((a) => a.house), ['ramot']);
  assert.deepEqual(CA.mergeAlerts([ramot, efroni], '').alerts.map((a) => a.name), ['ב', 'א']);
  assert.deepEqual(CA.mergeAlerts([ramot, efroni], 'ramot').alerts.map((a) => a.name), ['א']);
  assert.equal(CA.mergeAlerts([ramot, efroni], 'pardes').count, 0);
});

/* A minimal DOM: textContent only; innerHTML THROWS (text-only rendering). */
function fakeDoc() {
  function mk(tag) {
    const e = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, className: '', hidden: false, type: '', value: '', selected: false, _text: '',
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      querySelector(sel) {
        const m = /^\[([\w-]+)\]$/.exec(sel);
        const walk = (n) => { for (const c of n.children) { if (m && m[1] in c.attrs) return c; const r = walk(c); if (r) return r; } return null; };
        return walk(this);
      }
    };
    Object.defineProperty(e, 'textContent', { get() { return this._text + this.children.map((c) => c.textContent).join(' '); }, set(v) { this._text = String(v); this.children = []; } });
    Object.defineProperty(e, 'innerHTML', { set() { throw new Error('innerHTML used'); }, get() { throw new Error('innerHTML used'); } });
    return e;
  }
  return { createElement: mk };
}
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };

test('C: text-only card — hostile text stays text; tags; «לוועדות» opens the house sub-tab (no edit); unavailable text', () => {
  const doc = fakeDoc();
  const model = CA.houseAlerts(DM([{ id: 'h', date: '2026-10-15', time: '', type: '<script>x</script>', patientName: '<img src=x onerror=alert(1)>' }, { id: 'b', date: '2026-10-18', type: 'ב' }]), 'ramot', TODAY);
  const card = CA.renderCard(doc, model);
  const text = card.textContent;
  assert.match(text, /ועדות קרובות \(1\)/, 'the count = the alerts (today .. +2)');
  assert.match(text, /בהמשך השבוע \(1\)/);
  assert.match(text, /<img src=x onerror=alert\(1\)>/, 'shown as text');
  assert.match(text, /ועדה: 15\/10\/26 · <script>x<\/script> · היום/);
  assert.match(text, /ועדה: 18\/10\/26 · בעוד 3 ימים/);
  assert.deepEqual(all(card, (n) => 'data-cm-alert-open' in n.attrs).map((b) => b.attrs['data-cm-alert-open']), ['ramot', 'ramot']);
  assert.equal(all(card, (n) => 'data-cm-alert-edit' in n.attrs).length, 0, 'no edit button');
  const admin = CA.renderCard(doc, CA.mergeAlerts([model], ''), { labels: { ramot: 'רמות השבים' }, filter: { value: '', options: [{ value: '', label: 'כל הבתים' }, { value: 'ramot', label: 'רמות השבים' }] } });
  assert.match(admin.textContent, /רמות השבים/);
  assert.equal(all(admin, (n) => 'data-cm-filter' in n.attrs).length, 1);
  assert.match(CA.renderCard(doc, CA.houseAlerts(DM([]), 'ramot', TODAY)).textContent, /אין ועדות היום וב-7 הימים הקרובים/);
  assert.match(CA.renderCard(doc, CA.houseAlerts({ committees: { available: false, reason: 'unreachable' } }, 'ramot', TODAY)).textContent, /לא הצלחנו לקרוא את הוועדות/);
});

test('C: badge — count or hidden, its own element beside the discharge badge', () => {
  const doc = fakeDoc();
  const btn = doc.createElement('button');
  CA.setBadge(doc, btn, 2);
  const b = btn.querySelector('[data-cm-badge]');
  assert.deepEqual([b.textContent, b.hidden, b.getAttribute('aria-label')], ['2', false, '2 ועדות קרובות']);
  CA.setBadge(doc, btn, 0);
  assert.deepEqual([b.textContent, b.hidden], ['', true]);
});

/* ── D. wiring + bonus ─────────────────────────────────────── */

test('D: wiring — «ועדות» sub-tab after «מטופלים»; alerts on «הבית היום» (top) and the admin landing tab; SW v35+', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('/committee-alerts.js') > 0 && html.indexOf('/committee-alerts.js') < html.indexOf('/work.js'));
  assert.ok(html.indexOf('data-dash-committees') < html.indexOf('data-dash-alerts'), 'above the discharge alerts');
  assert.ok(html.indexOf('data-sub="patients"') < html.indexOf('data-sub="committees"'));
  assert.match(html, /<section data-sub-panel="committees" hidden><\/section>/);
  assert.match(html, /id="committeeAlertsAll" class="dis-alerts-all" hidden/);
  const sw = pub('sw.js');
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(sw)[1]) >= 35, 'SW cache only moves forward');
  assert.match(sw, /'\/committee-alerts\.js'/);
  const w = pub('work.js');
  assert.match(w, /var cmt = host\(panel, 'committees'\);\s*if \(cmt\) cmt\.innerHTML = committeesHtml\(d\);/);
  assert.match(w, /\['patients', 'team', 'therapists', 'committees'\]/, 'the error path covers the sub-tab');
  assert.doesNotMatch(pub('committee-alerts.js').replace(/\/\*[\s\S]*?\*\//g, ''), /innerHTML|console\./);
  assert.match(pub('styles.css'), /\.cm-alert-btn \{[^}]*min-height: 44px/);
});

test('D: bonus untouched — no bonus module reads the committee', () => {
  for (const f of ['lib/bonus-eligibility.js', 'public/bonus-view.js', 'public/app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/committee|ועדה/i.test(src), f);
  }
});
