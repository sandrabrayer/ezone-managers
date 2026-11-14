'use strict';
/* Managers CRM views (14 Nov 2026, docs/crm-redesign.md) — public/crm.js and
 * the work.js pieces that use it: patient card, employee card, staff-talk
 * threads, «מה היה בוועדה», «תקציב כוח אדם», the quarterly budget-bonus card.
 * Every feed value is escaped; a card never invents a value it was not sent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/crm.js');
const W = require('../public/work.js');
const BE = require('../lib/bonus-eligibility');

const XSS = '<img src=x onerror=alert(1)>';
const TEAM = {
  available: true,
  staff: [
    { name: 'רינה', kind: 'guide', role: 'מדריך/ה', phone: '0501234567', onLeave: false, workdays: [], startDate: '2024-05-01' },
    { name: XSS, kind: 'therapist', role: 'מטפל/ת', phone: '', onLeave: true, workdays: [1, 3], startDate: '' }
  ],
  therapistWeek: [
    { dayOfWeek: 2, time: '10:00', therapistName: 'הילה תבור', patientName: 'דנה' },
    { dayOfWeek: 0, time: '', therapistName: XSS, patientName: 'דנה' },
    { dayOfWeek: 1, time: '09:00', therapistName: 'הילה תבור', patientName: 'יוסי' }
  ]
};
const D = {
  today: '2026-11-14',
  patients: [
    { name: 'דנה', entryDate: '2026-09-01', days: 75, status: 'active', expectedDischarge: { date: '2026-12-01', editedBy: 'אורן', editedAt: '2026-11-10T09:00:00Z' } },
    { name: XSS, entryDate: '2026-11-01', days: 14, status: 'trial', expectedDischarge: { date: '', none: true } }
  ],
  committees: { available: true, today: '2026-11-14', items: [
    { id: 'c1', date: '2026-11-20', time: '11:00', type: 'ועדת המשך', participants: 'רופא', patientName: 'דנה' },
    { id: 'c0', date: '2026-11-10', time: '', type: 'ועדה ישנה', participants: '', patientName: 'דנה' }
  ] },
  team: TEAM,
  logs: {
    staffTalks: [
      { id: 't2', employeeName: 'רינה', talkDate: '2026-11-10', summary: 'המשך', talkKind: 'followup', parentId: 't1', canEdit: true, author: 'אורן' },
      { id: 't1', employeeName: 'רינה', talkDate: '2026-11-01', summary: 'איחורים', agreedActions: 'להגיע בזמן', talkKind: 'first', canEdit: true, author: 'אורן' },
      { id: 't3', employeeName: XSS, talkDate: '2026-10-01', summary: XSS, talkKind: '', canEdit: false, author: 'שחר' },
      { id: 't4', employeeName: XSS, talkDate: '2026-10-05', summary: 'סגירה', talkKind: 'outcome', parentId: 't3', outcome: 'improved', canEdit: false, author: 'שחר' }
    ],
    events: [{ id: 'e1', eventDate: '2026-11-13', patientName: 'דנה', whatHappened: 'נפילה', actionTaken: 'אחות', author: 'אורן' }],
    committeeNotes: [{ id: 'n1', committeeId: 'c0', patientName: 'דנה', heldDate: '2026-11-10', summary: XSS, decision: 'extend', nextDate: '2026-12-10', canEdit: true, author: 'אורן' }]
  }
};

test('patients: the row shows the therapist(s) and the next committee; unknown when the coordinators feed is missing', () => {
  assert.deepEqual(C.therapistsOf(D, 'דנה'), ['הילה תבור', XSS]);
  assert.equal(C.therapistsOf({ team: { available: false } }, 'דנה'), null, 'null = unknown, never "no therapist"');
  assert.equal(C.nextCommitteeOf(D, 'דנה').id, 'c1', 'a past committee is not "next"');
  const row = C.patientRowExtras(D, D.patients[0]);
  assert.match(row, /מטפל\/ת: הילה תבור, &lt;img/);
  assert.match(row, /ועדה: 20\/11\/26 11:00/);
  assert.ok(!row.includes('<img'));
  const h = W.patientsHtml(D);
  assert.match(h, /data-pt-open="0">כרטיס מטופל\/ת ←</);
  assert.ok(!h.includes('<img'));
});

test('patient card: four tabs (פרטים · טיפול · ועדות · אירועים), every value escaped, actions wired by data attributes', () => {
  const h = C.patientCardHtml(D, 0);
  for (const t of ['details', 'treatment', 'committees', 'events']) assert.match(h, new RegExp('data-card-tab="' + t + '"'));
  assert.match(h, /data-card-panel="details">/);
  assert.match(h, /data-card-panel="treatment" hidden>/, 'only the active tab is shown');
  assert.match(h, /שחרור משוער<\/dt><dd>1\/12\/26/);
  assert.match(h, /עודכן ע״י<\/dt><dd>אורן · 10\/11\/26/);
  assert.match(h, /יום שלישי<\/span><span class="wk-name">הילה תבור/, 'sessions by weekday (2 = Tuesday)');
  assert.match(h, /ועדות \(2\)/, '1 upcoming + 1 recorded');
  assert.match(h, /הארכת שהייה/);
  assert.match(h, /אירועים \(1\)[\s\S]*נפילה/);
  assert.match(h, /data-pt-discharge="0"/);
  assert.match(h, /data-pt-note="0"/);
  assert.ok(!h.includes('<img'), 'escaped');
  assert.doesNotMatch(h, /data-wk-del|data-wk-done/, 'the card is a view: no delete / done buttons');
  const none = C.patientCardHtml(D, 1, 'committees');
  assert.match(none, /אין צפי לשחרור/);
  assert.match(none, /data-card-panel="committees">/, 'opens on the asked tab');
  assert.match(C.patientCardHtml(D, 9), /כבר לא רשום/);
  assert.match(C.patientCardHtml({ ...D, team: { available: false } }, 0), /לא מחוברים/);
});

test('talk threads: first talk → follow-ups → outcome; open threads first; orphans are kept', () => {
  const th = C.talkThreads(D.logs.staffTalks);
  assert.deepEqual(th.map((t) => [t.root.id, t.children.map((c) => c.id), t.outcome && t.outcome.id]), [['t1', ['t2'], null], ['t3', ['t4'], 't4']]);
  const orphan = C.talkThreads([{ id: 'x', talkKind: 'followup', parentId: 'gone', employeeName: 'a', talkDate: '2026-01-01' }]);
  assert.equal(orphan.length, 1, 'a follow-up whose first talk is not visible is still shown');
  const h = C.talksListHtml(D.logs.staffTalks, D.today);
  assert.match(h, /פתוח · 2 שיחות/);
  assert.match(h, /נסגר — שיפור/);
  assert.match(h, /שיחה 1[\s\S]*שיחה 2/);
  assert.match(h, /מה סוכם: להגיע בזמן/);
  assert.match(h, /data-thread-open="t1\|followup"/);
  assert.match(h, /data-thread-open="t1\|outcome"/);
  assert.doesNotMatch(h, /data-thread-open="t3/, 'a closed thread (and one the manager cannot edit) gets no new talk');
  assert.match(h, /<form class="wk-form thread-form" data-wk-form="staffTalks" data-thread-form="t1\|outcome" hidden/);
  assert.match(h, /name="talkKind" value="outcome"[\s\S]*name="parentId" value="t1"/);
  assert.ok(!h.includes('<img'));
  const ro = C.talksListHtml(D.logs.staffTalks, D.today, 'רינה', true);
  assert.doesNotMatch(ro, /<form|data-wk-del|data-thread-open/, 'read-only in the employee card');
  assert.doesNotMatch(ro, /איחורים[\s\S]*&lt;img/, 'filtered to one employee');
});

test('talk forms: an outcome needs an outcome; a follow-up does not; hidden fields go through entryFromForm', () => {
  const base = { employeeName: 'רינה', talkDate: '2026-11-14', summary: 'x', parentId: 't1' };
  assert.deepEqual(W.entryFromForm('staffTalks', { ...base, talkKind: 'outcome' }).missing, ['התוצאה']);
  const ok = W.entryFromForm('staffTalks', { ...base, talkKind: 'outcome', outcome: 'warning', agreedActions: 'a' });
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.entry.outcome, 'warning');
  assert.equal(ok.entry.parentId, 't1');
  assert.deepEqual(W.entryFromForm('staffTalks', { ...base, talkKind: 'followup' }).missing, []);
  assert.match(W.formHtml('staffTalks', D, D.today), /<input type="hidden" name="talkKind" value="first">/, 'the main form opens a new thread');
  assert.doesNotMatch(W.formHtml('staffTalks', D, D.today), /name="outcome" (?!value)/, 'no outcome picker on a first talk');
});

test('«מה היה בוועדה»: form, history, the decision allowlist; past committees without a note are listed', () => {
  const h = C.committeeNotesPanelHtml(D);
  assert.match(h, /data-wk-form="committeeNotes"/);
  assert.match(h, /<select id="cn-dec" name="decision">[\s\S]*value="outpatient">מעבר לאמבולטורי/);
  assert.match(h, /סיכומי ועדות \(1\)/);
  assert.ok(!h.includes('<img'));
  const e = W.entryFromForm('committeeNotes', { committeeId: 'c1', patientName: 'דנה', heldDate: '2026-11-14', summary: 's', decision: 'discharge' });
  assert.deepEqual(e.missing, []);
  assert.deepEqual(W.entryFromForm('committeeNotes', { patientName: 'דנה' }).missing, ['תאריך הוועדה', 'מה היה בוועדה']);
  // c0 already has a note → not listed; a cancelled one is never listed.
  const noted = W.committeesHtml(D);
  assert.doesNotMatch(noted, /ועדה ישנה/, 'the read-only list shows today and later');
  const d2 = { ...D, committees: { ...D.committees, items: D.committees.items.concat([{ id: 'c9', date: '2026-11-12', type: 'בוטלה', patientName: 'יוסי', status: 'cancelled' }, { id: 'c8', date: '2026-11-11', type: 'ועדה שהייתה', patientName: 'יוסי' }]) } };
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  assert.match(src, /function pastCommitteesHtml\(d\)/);
  const html = W.committeesHtml(d2);
  assert.ok(html.length > 0);
});

test('employee card: details, cost from the staffing list, talks (read-only), feedback; unknown employee', () => {
  const staff = { available: true, month: '2026-11', total: 20000, workers: [{ name: 'רינה', roles: ['מדריך/ה'], cost: 8000, estimated: true }] };
  const fb = { name: 'רינה', status: 'overdue', due: '2026-11-01', lastFeedback: '2026-05-01' };
  const h = C.employeeCardHtml(D, 'רינה', staff, fb);
  assert.match(h, /href="tel:0501234567"/);
  assert.match(h, /ותק<\/dt><dd>2 שנים ו-6 חודשים/);
  assert.match(h, /עלות נובמבר 2026<\/dt><dd>8,000 ₪/);
  assert.match(h, /הערכה \(עוד אין דוח שכר\)/);
  assert.match(h, /40%/);
  assert.match(h, /מצב<\/dt><dd>באיחור/);
  assert.match(h, /data-emp-talk="רינה"/);
  assert.doesNotMatch(h, /<form/);
  assert.match(C.employeeCardHtml(D, 'nobody', staff, null), /לא נמצא/);
  assert.match(C.employeeCardHtml(D, 'רינה', { loading: true }, null), /טוען/);
  const x = C.employeeCardHtml(D, XSS, { available: false }, null);
  assert.ok(!x.includes('<img'));
  assert.match(x, /נתוני העלות לא זמינים/);
});

test('«תקציב כוח אדם»: KPIs, the bar status, budget lines, workers table with totals; failures in plain Hebrew', () => {
  const staff = { available: true, month: '2026-11', hasActuals: false, total: 103000, budget: 100000,
    workers: [{ name: XSS, roles: ['מדריך/ה'], cost: 60000, estimated: true }, { name: '', roles: [], cost: 43000, estimated: false }],
    budgetLines: [{ key: 'instructors', label: 'מדריכים', budget: 50000, cost: 60000 }, { key: 'other', label: 'אחר', budget: null, cost: 43000 }] };
  const h = C.budgetHtml({ staff });
  assert.match(h, /103,000 ₪<\/b><span>עלות החודש/);
  assert.match(h, /103%<\/b><span>חריגה קלה/);
  assert.match(h, /budget-bar warn/);
  assert.match(h, /class="neg">‎-10,000 ₪/, 'a negative difference keeps its sign on the left');
  assert.match(h, /אחר \(ללא שם\)/);
  assert.match(h, /data-emp-open="&lt;img/);
  assert.match(h, /<tfoot><tr><td>סה״כ<\/td><td><\/td><td>103,000 ₪/);
  assert.ok(!h.includes('<img'));
  assert.equal(C.budgetStatus(100, 100).cls, 'ok');
  assert.equal(C.budgetStatus(105, 100).cls, 'warn');
  assert.equal(C.budgetStatus(106, 100).cls, 'bad');
  assert.equal(C.budgetStatus(1, 0).pct, null);
  assert.match(C.budgetHtml({ staff: { available: false, reason: 'not_deployed' } }), /עוד לא הופעלה/);
  assert.match(C.budgetHtml({ staff: { available: false, reason: 'weird' } }), /לא הצלחנו לקרוא/);
  assert.match(C.budgetHtml({ staff: { loading: true } }), /טוען/);
});

test('budget bonus card: condition in plain words, the amount «ייקבע» until Sandra sets it, running vs settled', () => {
  const q = BE.budgetBonusQuarter([
    { ym: '2026-10', available: true, cost: 90, budget: 100 },
    { ym: '2026-11', available: true, cost: 95, budget: 100 },
    { ym: '2026-12', available: true, cost: 95, budget: 100 }], { nowYM: '2026-11' });
  const h = C.budgetBonusHtml(q);
  assert.match(h, /עלות כוח האדם של הבית ברבעון לא עוברת את תקציב כוח האדם של הרבעון/);
  assert.match(h, /רבעון 4 2026 — בתהליך/);
  assert.match(h, /הסכום ייקבע על ידי סנדרה/);
  assert.match(h, /בדרך לבונוס/);
  assert.doesNotMatch(h, /מדרגה/, 'no tier wording');
  const settled = BE.budgetBonusQuarter(q.months.map((m) => ({ ym: m.ym, available: true, cost: 110, budget: 100 })), { nowYM: '2027-01', amount: 1500 });
  const s = C.budgetBonusHtml(settled);
  assert.match(s, /— סופי/);
  assert.match(s, /1,500 ₪/);
  assert.match(s, /אין בונוס/);
  assert.match(C.budgetBonusHtml({ loading: true }), /טוען/);
  assert.match(C.budgetBonusHtml({ error: 'x' }), /x/);
  assert.match(C.quarterHtml(q), /אוקטובר 2026[\s\S]*נובמבר 2026[\s\S]*דצמבר 2026/);
});

test('wiring: crm.js loads before work.js; cached by the SW; the drawer is one per page and closed on load', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/crm.js') > 0 && html.indexOf('/crm.js') < html.indexOf('/work.js'));
  assert.match(html, /<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" hidden>/);
  assert.match(html, /<section data-sub-panel="budget" hidden><\/section>/);
  assert.match(html, /data-budget-bonus/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /'\/crm\.js'/);
  assert.ok(Number(/ezone-managers-v(\d+)/.exec(sw)[1]) >= 42);
  const crm = fs.readFileSync(path.join(__dirname, '..', 'public', 'crm.js'), 'utf8');
  assert.doesNotMatch(crm.replace(/\/\*[\s\S]*?\*\//g, ''), /innerHTML|fetch\(|console\./, 'crm.js is pure: markup strings only');
});
