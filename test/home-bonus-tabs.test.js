'use strict';
/* «הבית היום» + «בונוס» tabs (20 Oct 2026, docs/home-and-bonus-tabs.md).
 * - every bonus element sits in a «בונוס» tab (network overview + the house
 *   «בונוס» sub-tab); the «הבית היום» tabs hold none of them;
 * - «הבית היום» is the landing tab / sub-tab;
 * - the «הבית היום» card: date + weekday, patients, the three shifts, today's
 *   sessions, open requests — explicit empty states, every value escaped. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const tpl = /<template id="houseDetailTpl">[\s\S]*?<\/template>/.exec(html)[0];
const section = (src, re) => { const m = re.exec(src); assert.ok(m, String(re)); return m[0]; };
const subPanel = (name) => section(tpl, new RegExp(`<section data-sub-panel="${name}"[\\s\\S]*?</section>`));

/* Every bonus marker of the house page, and of the network overview. */
const HOUSE_BONUS = ['data-bonus-month', 'data-bonus-month-back', 'data-status-banner', 'data-dash-bonus', 'data-bonus-plan',
  'data-stat="bonus"', 'data-stat="treatmentDays"', 'data-bep-bar', 'data-daily-spark', 'data-history-card', 'data-history-month', 'data-occupancy-card'];
const NETWORK_BONUS = ['id="bonusMonthOverview"', 'id="bonusMonthBackOverview"', 'id="networkKpis"', 'id="kpiBonus"', 'id="winnersBanner"',
  'id="networkSpark"', 'id="houseGrid"', 'id="occupancyCard"'];
const BONUS_WORDS = /בונוס|₪|סופי|לתשלום|מדרגה|זכאי/;

test('top tabs: «הבית היום» is first and active (the landing screen), «בונוס» second, then the five houses', () => {
  const nav = section(html, /<nav class="tabs"[\s\S]*?<\/nav>/);
  const tabs = [...nav.matchAll(/<button class="tab( is-active)?" data-tab="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[3], !!m[1]]);
  assert.deepEqual(tabs.slice(0, 2), [['today', 'הבית היום', true], ['overview', 'בונוס', false]]);
  assert.deepEqual(tabs.slice(2).map((t) => t[0]), ['raanana', 'ramot', 'efroni', 'rehab', 'pardes']);
  assert.equal(tabs.filter((t) => t[2]).length, 1, 'exactly one active tab');
  assert.match(html, /<section class="panel is-active" id="panel-today"/);
  assert.match(html, /<section class="panel" id="panel-overview"/);
});

test('network: the «בונוס» panel holds every bonus element; «הבית היום» holds none of them', () => {
  const today = section(html, /<section class="panel is-active" id="panel-today"[\s\S]*?<\/section>/);
  const bonus = section(html, /<section class="panel" id="panel-overview"[\s\S]*?<\/section>/);
  for (const m of NETWORK_BONUS) {
    assert.ok(bonus.includes(m), `«בונוס» has ${m}`);
    assert.ok(!today.includes(m), `«הבית היום» has no ${m}`);
  }
  assert.doesNotMatch(today.replace(/<!--[\s\S]*?-->/g, ''), BONUS_WORDS);
  assert.match(today, /id="todayAll"/);
  assert.match(today, /id="committeeAlertsAll"/);
  assert.match(today, /id="dischargeAlertsAll"/);
});

test('house page: «הבית היום» is the first, active sub-tab; «בונוס» second', () => {
  const subs = [...tpl.matchAll(/<button type="button" class="subtab( is-active)?" data-sub="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[3], !!m[1]]);
  assert.deepEqual(subs.slice(0, 2), [['home', 'הבית היום', true], ['bonus', 'בונוס', false]]);
  assert.match(tpl, /<section data-sub-panel="home">/, 'home is shown on open');
  assert.match(tpl, /<section data-sub-panel="bonus" hidden>/);
});

test('house page: the «בונוס» sub-tab contains ALL bonus elements; «הבית היום» contains none; none sits above the sub-tabs', () => {
  const home = subPanel('home');
  const bonus = subPanel('bonus');
  for (const m of HOUSE_BONUS) {
    assert.ok(bonus.includes(m), `«בונוס» has ${m}`);
    assert.ok(!home.includes(m), `«הבית היום» has no ${m}`);
    assert.equal(tpl.split(m).length - 1, (bonus.split(m).length - 1), `${m} appears only inside «בונוס»`);
  }
  assert.doesNotMatch(home.replace(/<!--[\s\S]*?-->/g, ''), BONUS_WORDS);
  const head = tpl.slice(0, tpl.indexOf('data-subtabs'));
  assert.doesNotMatch(head, /data-status-banner|data-bonus-month/, 'no banner / picker at the top of the house page');
  // Order inside «בונוס»: picker, then the hero, then the dial and the plan.
  assert.ok(bonus.indexOf('data-bonus-month') < bonus.indexOf('data-status-banner'));
  assert.ok(bonus.indexOf('data-status-banner') < bonus.indexOf('data-dash-bonus'));
  assert.ok(bonus.indexOf('data-dash-bonus') < bonus.indexOf('data-bonus-plan'));
});

test('no banner on load: the hero starts hidden and empty; the running month never fills it', () => {
  assert.match(tpl, /<div class="status-banner" data-status-banner hidden><\/div>/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const running = /function renderHouseDetail\(key, data\) \{[\s\S]*?\n\}/.exec(app)[0];
  assert.match(running, /hideHeroBanner_\(panel\);/);
  assert.doesNotMatch(running, /houseHeroView|settledPrevFor_/, 'the running month never builds a settled hero');
  assert.doesNotMatch(app, /function settledPrevFor_/, 'the old previous-month hero helper is gone');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.status-banner\[hidden\] \{ display: none; \}/);
});

test('SW cache bumped to v33 for the tab change (monotonic from live v32)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)'/.exec(sw)[1]) >= 33);
});

/* ── the «הבית היום» card ────────────────────────────────── */
const TEAM = {
  available: true, stale: false, updatedAt: '2026-10-20T06:00:00.000Z',
  today: [
    { date: '2026-10-20', shift: 'לילה', guideName: 'גל', draft: false },
    { date: '2026-10-20', shift: 'בוקר', guideName: 'אבי', draft: false },
    { date: '2026-10-20', shift: 'בוקר', guideName: '<b>x</b>', draft: true }
  ],
  shifts: [], staff: [],
  therapistWeek: [
    { dayOfWeek: 2, time: '14:00', therapistName: 'רות', patientName: 'יוסי' },
    { dayOfWeek: 2, time: '', therapistName: 'ללא', patientName: 'שעה' },
    { dayOfWeek: 2, time: '09:30', therapistName: 'ד"ר כהן', patientName: '<img src=x>' },
    { dayOfWeek: 3, time: '08:00', therapistName: 'מחר', patientName: 'לא היום' }
  ]
};
const DAY = {
  ok: true, today: '2026-10-20', // a Tuesday (2)
  patients: [{ name: 'א' }, { name: 'ב' }, { name: 'ג' }],
  team: TEAM,
  logs: {
    staffTalks: [{ id: 's1', employeeName: 'נועה <i>', canEdit: true }],
    events: [{ id: 'e1', patientName: 'דנה' }]
  },
  followUps: [{ log: 'staffTalks', id: 's1', date: '2026-10-20' }, { log: 'events', id: 'e1', date: '2026-10-18' }, { log: 'familyCalls', id: 'x', date: '2026-10-01' }]
};

test('today model: date + weekday, patients, the three shifts in order (even empty), sessions by time, open requests', () => {
  const m = W.todayModel(DAY);
  assert.equal(m.today, '2026-10-20');
  assert.equal(m.weekday, 'שלישי');
  assert.equal(m.patients, 3);
  assert.equal(m.onShiftCount, 3);
  assert.deepEqual(m.shifts.map((s) => [s.shift, s.names, s.draft]), [['בוקר', ['אבי', '<b>x</b>'], true], ['ערב', [], false], ['לילה', ['גל'], false]]);
  assert.deepEqual(m.sessions.map((r) => r.therapistName), ['ד"ר כהן', 'רות', 'ללא'], 'today only, by time, untimed last');
  assert.deepEqual(m.requests.map((r) => [r.kind, r.head, r.overdue]), [['שיחה עם עובד/ת', 'נועה <i>', false], ['אירוע חריג', 'אירוע — דנה', true]], 'retired logs are skipped');
});

test('today card: title with the weekday and date, tiles, «אין שיבוץ» for an empty shift, sessions, requests — all escaped, no bonus word', () => {
  const h = W.todayCardHtml(W.todayModel(DAY));
  assert.match(h, /הבית היום — יום שלישי 20\/10\/26/);
  assert.match(h, /<b>3<\/b><span>מטופלים בבית[\s\S]*<b>3<\/b><span>במשמרת היום[\s\S]*<b>3<\/b><span>טיפולים היום[\s\S]*<b>2<\/b><span>תזכורות פתוחות/);
  assert.match(h, /wk-shift">בוקר<\/span><span class="wk-name">אבי, &lt;b&gt;x&lt;\/b&gt;<\/span><span class="wk-meta">טיוטה/);
  assert.match(h, /<li class="wk-shift-empty"><span class="wk-shift">ערב<\/span><span class="wk-name">אין שיבוץ<\/span>/);
  assert.match(h, /wk-shift">לילה<\/span><span class="wk-name">גל</);
  assert.match(h, /טיפולים היום<\/div><ul[\s\S]*09:30[\s\S]*ד&quot;ר כהן[\s\S]*עם &lt;img src=x&gt;[\s\S]*14:00[\s\S]*ללא שעה/);
  assert.match(h, /בקשות פתוחות<\/div><ul[\s\S]*נועה &lt;i&gt;[\s\S]*<li class="wk-soon">[\s\S]*18\/10\/26 · באיחור/);
  assert.ok(!/<(b|i|img)[ >]/.test(h.replace(/<b>\d+<\/b>/g, '')), 'no feed value becomes markup');
  assert.doesNotMatch(h, BONUS_WORDS);
});

test('today card: no coordinators feed → explicit message and dashes, never fake zeros or invented shifts', () => {
  const h = W.todayCardHtml(W.todayModel({ today: '2026-10-20', patients: [], team: { available: false, reason: 'pending' }, followUps: [] }));
  assert.match(h, /<b>—<\/b><span>במשמרת היום[\s\S]*<b>—<\/b><span>טיפולים היום/);
  assert.match(h, /הנתונים מאפליקציית הרכזים עוד לא מחוברים/);
  assert.doesNotMatch(h, /אין שיבוץ|בוקר|ערב|לילה/, 'no shift rows without data');
  assert.match(h, /אין בקשות פתוחות/);
  const empty = W.todayCardHtml(W.todayModel({ today: '2026-10-20', team: { ...TEAM, today: [], therapistWeek: [] } }));
  assert.equal((empty.match(/אין שיבוץ/g) || []).length, 3, 'each shift says it has nobody');
  assert.match(empty, /אין טיפולים משובצים להיום/);
  const stale = W.todayCardHtml(W.todayModel({ today: '2026-10-20', team: { ...TEAM, stale: true } }));
  assert.match(stale, /הנתונים לא התעדכנו לאחרונה/);
});

test('today card: an invalid "today" from the server never becomes a weekday or date', () => {
  const m = W.todayModel({ today: '<script>', team: TEAM });
  assert.equal(m.today, '');
  assert.equal(m.weekday, '');
  assert.deepEqual(m.sessions, []);
});

test('dashboard: the house «הבית היום» panel draws the today card first and carries no bonus figure', () => {
  const h = W.dashboardHtml(DAY);
  assert.ok(h.indexOf('dash-today') < h.indexOf('dash-month'));
  assert.doesNotMatch(h, /₪|לתשלום|מדרגה/);
});

test('admin «הבית היום»: one card per house — loading, error, data; names escaped; a button opens the house', () => {
  const h = W.todayAllHtml([
    { key: 'ramot', data: DAY },
    { key: 'efroni', data: null, error: true },
    { key: 'pardes', data: null }
  ], { ramot: 'רמות השבים', efroni: '<b>עפרוני</b>' });
  assert.match(h, /רמות השבים<\/span><span class="wk-meta">יום שלישי 20\/10\/26/);
  assert.match(h, /data-today-open="ramot"/);
  assert.match(h, /&lt;b&gt;עפרוני&lt;\/b&gt;[\s\S]*wk-empty error">שגיאה בטעינת נתוני הבית/);
  assert.match(h, /pardes<\/div><div class="wk-empty">טוען…/);
  assert.doesNotMatch(h, BONUS_WORDS);
});
