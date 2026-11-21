'use strict';
/* Managers CRM views (14 Nov 2026, docs/crm-redesign.md) — public/crm.js and
 * the work.js pieces that use it: patient card, employee card, staff-talk
 * threads, «שיחות עם משפחה», «תקציב כוח אדם» with the per-worker simulation and next
 * month's cost per worker, the quarterly budget-bonus card. («מה היה בוועדה» was removed
 * on 16 Nov 2026 — committees are information only.)
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
    { name: 'דנה', entryDate: '2026-09-01', days: 75, status: 'active', expectedDischarge: { date: '2026-12-01', editedBy: 'אורן', editedAt: '2026-11-10T09:00:00Z' },
      contact: { name: 'רות ' + XSS, relation: 'אמא', phone: '050-1234567', updatesPhone: 'javascript:alert(1)' } },
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
    committeeNotes: [{ id: 'n1', committeeId: 'c0', patientName: 'דנה', heldDate: '2026-11-10', summary: 'SECRET-NOTE', decision: 'extend', nextDate: '2026-12-10', canEdit: true, author: 'אורן' }],
    familyCalls: [
      { id: 'f1', patientName: 'דנה', contactName: 'רות', relation: 'אמא', callDate: '2026-11-12', callTime: '18:00', summary: 'עדכון שבועי ' + XSS, followUpDate: '2026-11-20', followUpDone: false, canEdit: true, author: 'אורן' },
      { id: 'f2', patientName: 'דנה', contactName: 'רות', relation: 'אמא', callDate: '2026-11-05', callTime: '', summary: 'שיחת היכרות', followUpDate: '', followUpDone: false, canEdit: false, author: 'שחר' },
      { id: 'f3', patientName: XSS, contactName: 'אבא', relation: '', callDate: '2026-11-10', callTime: '', summary: 'ביקור', followUpDate: '', followUpDone: false, canEdit: true, author: 'אורן' }
    ]
  },
  contactsSupported: true
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

test('patient card: five tabs (פרטים · טיפול · משפחה · ועדות · סוגיות), every value escaped, actions wired by data attributes', () => {
  const h = C.patientCardHtml(D, 0);
  for (const t of ['details', 'treatment', 'family', 'committees', 'events']) assert.match(h, new RegExp('data-card-tab="' + t + '"'));
  assert.match(h, /data-card-panel="details">/);
  assert.match(h, /data-card-panel="treatment" hidden>/, 'only the active tab is shown');
  assert.match(h, /שחרור משוער<\/dt><dd>1\/12\/26/);
  assert.match(h, /עודכן ע״י<\/dt><dd>אורן · 10\/11\/26/);
  assert.match(h, /יום שלישי<\/span><span class="wk-name">הילה תבור/, 'sessions by weekday (2 = Tuesday)');
  // Committees are information only (16 Nov 2026): the upcoming one, nothing recorded, nothing to record.
  assert.match(h, /ועדות \(1\)/, 'the upcoming committee only');
  assert.doesNotMatch(h, /SECRET-NOTE|הארכת שהייה|מה היה בוועד|data-pt-note/, 'no committee notes — not even ones the feed still carries');
  assert.match(h, /סוגיות \(1\)[\s\S]*נפילה/);
  assert.doesNotMatch(h, /אירועים|אירוע חריג/);
  // «משפחה»: the Dashboard contact + the documented calls, read-only, and the way to add one.
  assert.match(h, /משפחה \(2\)/);
  assert.match(h, /איש\/אשת קשר<\/dt><dd>רות &lt;img/);
  assert.match(h, /קרבה<\/dt><dd>אמא/);
  assert.match(h, /href="tel:0501234567"/);
  assert.doesNotMatch(h, /javascript:/, 'a phone that is not a plain number is dropped, never linked');
  assert.match(h, /12\/11\/26 18:00[\s\S]*5\/11\/26/, 'calls newest first');
  assert.match(h, /data-pt-family="0"/);
  assert.match(h, /data-pt-discharge="0"/);
  assert.ok(!h.includes('<img'), 'escaped');
  assert.doesNotMatch(h, /data-wk-del|data-wk-done/, 'the card is a view: no delete / done buttons');
  const none = C.patientCardHtml(D, 1, 'committees');
  assert.match(none, /אין צפי לשחרור/);
  assert.match(none, /data-card-panel="committees">/, 'opens on the asked tab');
  assert.match(none, /אין איש קשר רשום בדשבורד/);
  assert.match(C.patientCardHtml({ ...D, contactsSupported: undefined, patients: [{ ...D.patients[1] }] }, 0), /פרטי איש הקשר מהדשבורד עוד לא מחוברים/, 'an older Dashboard is said, not hidden');
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

test('«ועדות» is information only (16 Nov 2026): no note form, no to-do list, no builder left behind', () => {
  assert.equal(C.committeeNotesPanelHtml, undefined);
  assert.equal(C.notesListHtml, undefined);
  assert.equal(C.DECISIONS, undefined);
  assert.equal(W.LOGS.committeeNotes, undefined);
  const list = W.committeesHtml(D);
  assert.match(list, /ועדת המשך · דנה/);
  assert.doesNotMatch(list, /ועדה ישנה/, 'the read-only list shows today and later');
  assert.doesNotMatch(list, /<button|<form|SECRET-NOTE/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  assert.doesNotMatch(src, /function pastCommitteesHtml|data-cn-for/);
});

test('«שיחות עם משפחה»: the contact from the Dashboard, the last call and the count per patient; «+ רישום שיחה»', () => {
  assert.deepEqual(C.contactOf(D.patients[0]), { name: 'רות ' + XSS, relation: 'אמא', phone: '0501234567', updatesPhone: '' });
  assert.equal(C.contactOf(D.patients[1]), null);
  assert.equal(C.contactOf({ contact: { name: '', relation: '', phone: '12', updatesPhone: '' } }), null, 'nothing usable → no contact');
  assert.equal(C.contactOf({ contact: { name: 'א', phone: '0501111111', updatesPhone: '0501111111' } }).updatesPhone, '', 'the same number is not shown twice');
  const h = C.familyContactsHtml(D);
  assert.match(h, /אנשי קשר לפי מטופל\/ת \(2\)/);
  assert.match(h, /data-default-open/);
  assert.match(h, /data-pt-open="0" data-pt-tab="family">דנה</);
  assert.match(h, /רות &lt;img[^<]*<span class="wk-meta">\(אמא\)/);
  assert.match(h, /href="tel:0501234567"/);
  assert.match(h, /<td data-label="שיחה אחרונה">12\/11\/26<\/td><td data-label="שיחות">2<\/td>/, 'last call + how many');
  assert.match(h, /class="crm-tbl fam-tbl stack-tbl"/, 'one block per row on a phone');
  assert.match(h, /data-fam-add="0"/);
  assert.match(h, /data-fam-add="1"/);
  assert.match(h, /מעדכנים בדשבורד/);
  assert.ok(!h.includes('<img') && !h.includes('javascript:'));
  assert.match(C.familyContactsHtml({ ...D, contactsSupported: false }), /עוד לא מחוברים — אפשר כבר לתעד שיחות/);
  assert.match(C.familyContactsHtml({ patients: [] }), /אין מטופלים רשומים בבית/);
});

test('«שיחות עם משפחה»: the calls grouped by patient, newest first; filter; follow-up and delete only for the author', () => {
  const h = C.familyCallsListHtml(D.logs.familyCalls, {});
  assert.match(h, /<span class="wk-name">דנה<\/span><span class="crm-chip open">2 שיחות<\/span><span class="crm-chip warn">מעקב פתוח/);
  assert.match(h, /12\/11\/26 18:00[\s\S]*5\/11\/26/);
  assert.match(h, /מעקב: 20\/11\/26[\s\S]*data-wk-done="familyCalls\|f1"/);
  assert.match(h, /data-wk-del="familyCalls\|f1"/);
  assert.doesNotMatch(h, /data-wk-del="familyCalls\|f2"/, 'another manager\'s call cannot be deleted');
  assert.match(h, /שיחה אחת/);
  assert.ok(!h.includes('<img'));
  const one = C.familyCallsListHtml(D.logs.familyCalls, { filter: 'דנה' });
  assert.doesNotMatch(one, /ביקור/, 'narrowed to one patient');
  assert.match(C.familyCallsListHtml(D.logs.familyCalls, { filter: 'אין כזה' }), /אין שיחות מתועדות למטופל\/ת/);
  assert.match(C.familyCallsListHtml([], {}), /עדיין אין שיחות מתועדות/);
  const ro = C.familyCallsListHtml(D.logs.familyCalls, { readOnly: true, flat: true });
  assert.doesNotMatch(ro, /data-wk-del|data-wk-done|talk-thread /, 'read-only and flat in the patient card');
  const f = C.familyFilterHtml(D.logs.familyCalls, 'דנה');
  assert.match(f, /<option value="">כל המטופלים<\/option>/);
  assert.match(f, /<option value="דנה" selected>/);
  assert.ok(!f.includes('<img'));
});

test('«שיחות עם משפחה»: the panel — contacts, the form, the list; the form fields and what a save sends', () => {
  const h = W.familyPanelHtml(D, { filter: '' });
  assert.ok(h.indexOf('wk-fam-contacts') < h.indexOf('data-wk-form="familyCalls"') && h.indexOf('data-wk-form="familyCalls"') < h.indexOf('wk-fam-list'));
  for (const n of ['patientName', 'contactName', 'relation', 'callDate', 'callTime', 'summary', 'followUpDate']) assert.match(h, new RegExp('name="' + n + '"'), n);
  assert.match(h, /השיחות המתועדות \(3\)/);
  assert.match(h, /data-fam-hint hidden/);
  assert.match(h, /data-fam-filter/);
  assert.ok(!h.includes('<img'));
  const e = W.entryFromForm('familyCalls', { patientName: ' דנה ', contactName: 'רות', relation: 'אמא', callDate: '2026-11-16', callTime: '', summary: ' דיברנו ', followUpDate: '2026-11-23', extra: 'x' });
  assert.deepEqual(e.missing, []);
  assert.deepEqual(e.entry, { patientName: 'דנה', contactName: 'רות', relation: 'אמא', callDate: '2026-11-16', callTime: '', summary: 'דיברנו', followUpDate: '2026-11-23' });
  assert.deepEqual(W.entryFromForm('familyCalls', { patientName: 'דנה' }).missing, ['עם מי דיברת', 'תאריך', 'עיקרי השיחה']);
  // the contact line shown when a patient is picked — plain text, no markup
  const hint = W.familyHintText(D, 'דנה');
  assert.equal(hint.text, 'איש הקשר בדשבורד: רות ' + XSS + ' (אמא) · 0501234567');
  assert.equal(hint.contact.relation, 'אמא');
  assert.match(W.familyHintText(D, XSS).text, /אין איש קשר רשום בדשבורד/);
  assert.deepEqual(W.familyHintText(D, 'מישהו אחר'), { text: '', contact: null });
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

test('employee card: «תאריך לידה» from the staffing list — a real past date with its full year; said when not entered; no row when unreadable', () => {
  const staff = (birthDate) => ({ available: true, month: '2026-11', total: 20000, workers: [{ name: 'רינה', roles: ['מדריך/ה'], cost: 8000, estimated: true, birthDate }] });
  const details = (h) => h.slice(h.indexOf('data-card-panel="details"'), h.indexOf('data-card-panel="cost"'));
  assert.match(details(C.employeeCardHtml(D, 'רינה', staff('1990-05-01'), null)), /ותק<\/dt><dd>[^<]*<\/dd><\/div>[\s\S]*תאריך לידה<\/dt><dd>1\/5\/1990</, 'after seniority, full year');
  for (const bad of ['', undefined, '01/05/1990', '<img src=x>', '2090-01-01', '1990-13-40x']) {
    const h = details(C.employeeCardHtml(D, 'רינה', staff(bad), null));
    assert.match(h, /תאריך לידה<\/dt><dd>לא הוזן באפליקציית כוח האדם/, String(bad));
    assert.ok(!h.includes('<img') && !h.includes('2090'));
  }
  // a worker who is not in the month's staffing list → not entered, never someone else's date
  assert.match(details(C.employeeCardHtml(D, 'רינה', { available: true, month: '2026-11', total: 1, workers: [{ name: 'אחרת', cost: 1, birthDate: '1980-01-01' }, { name: '', cost: 1, birthDate: '1970-01-01' }] }, null)),
    /תאריך לידה<\/dt><dd>לא הוזן/);
  assert.match(details(C.employeeCardHtml(D, 'רינה', { loading: true }, null)), /תאריך לידה<\/dt><dd>טוען…/);
  assert.doesNotMatch(details(C.employeeCardHtml(D, 'רינה', { available: false, reason: 'unreachable' }, null)), /תאריך לידה/, 'staffing unreadable → no row, never a guess');
  assert.doesNotMatch(details(C.employeeCardHtml(D, 'רינה', null, null)), /תאריך לידה/);
});

test('clearing a simulation: «✕ ניקוי» beside every simulated worker, «ניקוי כל השדות» above and under the table and in the result card', () => {
  const sim = { 'אורן': { kind: 'cost', amount: 30000 }, 'דנה': { kind: 'end' } };
  const h = C.budgetHtml({ staff: STAFF, nextStaff: NEXT, sim, nowYM: '2026-11' });
  assert.deepEqual((h.match(/data-sim-clear="([^"]+)"/g) || []), ['data-sim-clear="אורן"', 'data-sim-clear="דנה"'], 'only the simulated rows');
  assert.equal((h.match(/data-sim-reset/g) || []).length, 3, 'the result card, above the table, under the table');
  assert.match(h, /sim-bar"><span class="sim-bar-text">🧪 2 שינויים בסימולציה<\/span><button type="button" class="wk-btn ghost sim-clear-all" data-sim-reset>🧹 ניקוי כל השדות/);
  const workers = h.slice(h.indexOf('wk-budget-workers'));
  assert.ok(workers.indexOf('sim-bar') < workers.indexOf('<table') && workers.lastIndexOf('sim-bar') > workers.indexOf('</table>'));
  assert.match(C.budgetHtml({ staff: STAFF, sim: { 'אורן': { kind: 'end' } } }), /שינוי אחד בסימולציה/);
  assert.doesNotMatch(h, /איפוס הסימולציה/, 'one wording everywhere');
  // nothing to clear → no clear control at all
  const none = C.budgetHtml({ staff: STAFF, nextStaff: NEXT, sim: {} });
  assert.doesNotMatch(none, /data-sim-clear|data-sim-reset|sim-bar"/);
  // a worker named like markup: the attribute is escaped
  const x = C.budgetHtml({ staff: { available: true, month: '2026-11', total: 5, workers: [{ name: XSS, roles: [], cost: 5, estimated: true }] }, sim: { [XSS]: { kind: 'end' } } });
  assert.match(x, /data-sim-clear="&lt;img/);
  assert.ok(!x.includes('<img'));
  // wiring: one worker is removed from the page's memory, the rest stays; the whole simulation is emptied
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  assert.match(w, /closest\('\[data-sim-clear\]'\)[\s\S]{0,260}hasOwnProperty\.call\(smc, whoC\)\) delete smc\[whoC\];\s*paintBudget\(panel, key\)/);
  assert.match(w, /closest\('\[data-sim-reset\]'\)\) \{ simState\[key\] = \{\}; paintBudget\(panel, key\)/);
});

test('«תקציב כוח אדם»: KPIs, the bar status, budget lines, workers table with totals; failures in plain Hebrew', () => {
  const staff = { available: true, month: '2026-11', hasActuals: false, total: 103000, budget: 100000,
    workers: [{ name: XSS, roles: ['מדריך/ה'], cost: 60000, estimated: true }, { name: '', roles: [], cost: 43000, estimated: false }],
    budgetLines: [{ key: 'instructors', label: 'מדריכים', budget: 50000, cost: 60000 }, { key: 'other', label: 'אחר', budget: null, cost: 43000 }] };
  const h = C.budgetHtml({ staff });
  assert.match(h, /103,000 ₪<\/b><span>עלות החודש/);
  assert.match(h, /103%<\/b><span>חריגה קלה/);
  assert.match(h, /budget-bar warn/);
  assert.match(h, /<td data-label="הפרש" class="neg">‎-10,000 ₪/, 'a negative difference keeps its sign on the left');
  assert.match(h, /אחר \(ללא שם\)/);
  assert.match(h, /data-emp-open="&lt;img/);
  assert.match(h, /<tfoot><tr><td data-label="">סה״כ<\/td><td><\/td><td data-label="עלות החודש">103,000 ₪/);
  assert.doesNotMatch(h, /wk-budget-sim|sim-new|is-sim/, 'no simulation until someone asks for one');
  assert.match(h, /<select class="sim-kind" data-sim-kind="&lt;img[^>]*>[\s\S]*?ללא שינוי[\s\S]*?סיום העסקה[\s\S]*?שינוי שכר/);
  assert.equal((h.match(/data-sim-kind=/g) || []).length, 1, 'the unnamed «אחר» row cannot be simulated');
  assert.ok(!h.includes('<img'));
  assert.equal(C.budgetStatus(100, 100).cls, 'ok');
  assert.equal(C.budgetStatus(105, 100).cls, 'warn');
  assert.equal(C.budgetStatus(106, 100).cls, 'bad');
  assert.equal(C.budgetStatus(1, 0).pct, null);
  assert.match(C.budgetHtml({ staff: { available: false, reason: 'not_deployed' } }), /עוד לא הופעלה/);
  assert.match(C.budgetHtml({ staff: { available: false, reason: 'weird' } }), /לא הצלחנו לקרוא/);
  assert.match(C.budgetHtml({ staff: { loading: true } }), /טוען/);
});

test('«חיסכון צפוי מסיומי עבודה»: every counted person is named with the end date — also a freelancer with no dated row (16 Nov 2026, later)', () => {
  const staff = { available: true, month: '2026-11', hasActuals: false, total: 50000, budget: 60000,
    ending: { count: 3, monthlySaving: 15907, savingThisMonth: 13511, savingNextMonth: 15907, people: [
      { name: 'פרילנסרית שסיימה', endDate: '2026-11-15', monthlySaving: 4000 },
      { name: 'ניר אדלר', endDate: '2026-11-01', monthlySaving: 11907 },
      { name: XSS, endDate: '2026-11-20', monthlySaving: 0 },
      { name: 'בלי תאריך', endDate: 'soon', monthlySaving: 5 }, { name: '', endDate: '2026-11-02' }, null] },
    workers: [{ name: 'ניר אדלר', roles: ['רכז/ת'], cost: 397, estimated: true, endDate: '2026-11-01' },
      // the freelancer's money sits on the invoice row: a name and a cost, no end date
      { name: 'פרילנסרית  שסיימה', roles: ['מטפל/ת'], cost: 2000, estimated: true, endDate: '' },
      { name: 'נשארת', roles: ['מדריך/ה'], cost: 47603, estimated: false, endDate: '' }],
    budgetLines: [] };
  assert.deepEqual(C.endingPeople(staff).map((p) => [p.name, p.endDate, p.monthlySaving]),
    [['ניר אדלר', '2026-11-01', 11907], ['פרילנסרית שסיימה', '2026-11-15', 4000], [XSS, '2026-11-20', 0]], 'soonest first; a name and a real date required');
  const h = C.budgetHtml({ staff });
  const from = h.indexOf('<div class="card work-card wk-budget-ending"');
  const card = h.slice(from, h.indexOf('<div class="card work-card', from + 10));
  assert.match(card, /<b>3<\/b><span>עובדים מסיימים/);
  assert.equal((card.match(/<li>/g) || []).length, 3, 'three counted, three named');
  assert.match(card, /data-emp-open="ניר אדלר">ניר אדלר<\/button><span>מסיים\/ת ב-1\/11\/26 · חיסכון 11,907 ₪ בחודש מלא/);
  assert.match(card, /data-emp-open="פרילנסרית  שסיימה">פרילנסרית שסיימה<\/button><span>מסיים\/ת ב-15\/11\/26 · חיסכון 4,000 ₪ בחודש מלא/, 'opens the card by the row\'s own name');
  assert.match(card, /<b class="ending-name">&lt;img[^<]*<\/b><span>מסיים\/ת ב-20\/11\/26<\/span>/, 'a name with no row is text, not a button; no saving → no amount');
  assert.doesNotMatch(card, /ending-unnamed/);
  assert.ok(!h.includes('<img') && !card.includes('בלי תאריך'));
  // the freelancer's row in the workers table gets the date from the list
  const table = h.slice(h.indexOf('wk-budget-workers'));
  assert.match(table, /פרילנסרית  שסיימה<\/button> <span class="crm-chip warn">מסיים\/ת 15\/11\/26/);
  assert.equal((table.match(/crm-chip warn">מסיים\/ת /g) || []).length, 2);
  // a count above the names is said in words — the case Sandra saw: «2» and one name
  const older = Object.assign({}, staff, { ending: { count: 2, monthlySaving: 11907, savingThisMonth: 11511, savingNextMonth: 11907 } });
  const oc = C.endingHtml(older);
  assert.equal((oc.match(/<li>/g) || []).length, 1, 'without the list: the workers that carry a date');
  assert.match(oc, /ending-unnamed">לעובד\/ת נוסף\/ת אין שם ותאריך סיום ברשימה/);
  assert.match(C.endingHtml(Object.assign({}, older, { ending: Object.assign({}, older.ending, { count: 4 }) })), /ל-3 עובדים נוספים אין שם/);
  assert.doesNotMatch(card + oc, /[(][^<]*[\u0590-\u05FF]|[\u0590-\u05FF][^<]*[)]/, 'no parentheses in the Hebrew text');
});

test('«חיסכון צפוי מסיומי עבודה» (16 Nov 2026): the staffing forecast as it came — the card, the chip in the table, the field in the employee card', () => {
  const staff = { available: true, month: '2026-12', hasActuals: false, total: 50000, budget: 60000,
    ending: { count: 2, monthlySaving: 21250, savingThisMonth: 7500, savingNextMonth: 21250 },
    workers: [{ name: 'רינה', roles: ['מדריך/ה'], cost: 3750, estimated: true, endDate: '2026-12-10' },
      { name: XSS, roles: ['מטפל/ת'], cost: 10000, estimated: true, endDate: '2026-12-31' },
      { name: 'נשארת', roles: ['מדריך/ה'], cost: 36250, estimated: false, endDate: '' },
      { name: 'תאריך שבור', roles: [], cost: 1, estimated: false, endDate: '<b>soon</b>' }],
    budgetLines: [] };
  const h = C.budgetHtml({ staff });
  const from = h.indexOf('<div class="card work-card wk-budget-ending"');
  const card = h.slice(from, h.indexOf('<div class="card work-card', from + 10));
  assert.match(card, /חיסכון צפוי מסיומי עבודה — הערכה/);
  assert.match(card, /<b>2<\/b><span>עובדים מסיימים/);
  assert.match(card, /<b>7,500 ₪<\/b><span>חיסכון בדצמבר 2026/);
  assert.match(card, /<b>21,250 ₪<\/b><span>חיסכון בינואר 2027/, 'the month after December is January of the next year');
  assert.match(card, /<b>21,250 ₪<\/b><span>חיסכון בחודש מלא/);
  assert.deepEqual([...card.matchAll(/מסיים\/ת ב-([\d/]+)/g)].map((m) => m[1]), ['10/12/26', '31/12/26'], 'soonest first; only real dates');
  assert.ok(h.indexOf('wk-budget-ending') > h.indexOf('wk-budget-sum') && h.indexOf('wk-budget-ending') < h.indexOf('wk-budget-workers'), 'right under the month cost');
  // the workers table marks who finishes
  const table = h.slice(h.indexOf('wk-budget-workers'));
  assert.equal((table.match(/crm-chip warn">מסיים\/ת /g) || []).length, 2);
  assert.match(table, /crm-chip warn">מסיים\/ת 10\/12\/26/);
  assert.ok(!h.includes('<img') && !h.includes('<b>soon</b>'), 'every feed value escaped; a bad date is not shown');
  assert.doesNotMatch(card, /[(][^<]*[\u0590-\u05FF]|[\u0590-\u05FF][^<]*[)]/, 'no parentheses in the new Hebrew text');
  // one worker: singular wording
  assert.match(C.endingHtml({ month: '2026-11', workers: [], ending: { count: 1, monthlySaving: 9000, savingThisMonth: 6000, savingNextMonth: 9000 } }), /<b>1<\/b><span>עובד\/ת מסיים\/ת/);
  // nobody finishing, an older Dashboard, junk → no card at all, never a 0
  for (const ending of [undefined, null, { count: 0, monthlySaving: 0, savingThisMonth: 0, savingNextMonth: 0 }, 'x', { count: 'abc' }]) {
    assert.equal(C.endingHtml({ month: '2026-11', workers: [], ending }), '');
    assert.ok(!C.budgetHtml({ staff: Object.assign({}, staff, { ending }) }).includes('wk-budget-ending'));
  }
  // the employee card says when the person finishes in the house
  const emp = C.employeeCardHtml(D, 'רינה', staff, null, 'cost');
  assert.match(emp, /סיום עבודה בבית/);
  assert.match(emp, /10\/12\/26/);
  assert.doesNotMatch(C.employeeCardHtml(D, 'רינה', Object.assign({}, staff, { workers: [{ name: 'רינה', roles: [], cost: 5, estimated: false, endDate: '' }] }), null, 'cost'), /סיום עבודה בבית/);
});

test('budget bonus card: condition in plain words; Q4 2026 shows when the quarterly bonus starts; December\'s one-off 2,500 ₪; running vs settled', () => {
  // Today (Nov 2026): Q4 2026 is not a bonus quarter — the card says when it starts and for how much.
  const q4 = BE.budgetBonusQuarter([
    { ym: '2026-10', available: true, cost: 90, budget: 100 },
    { ym: '2026-11', available: true, cost: 95, budget: 100 },
    { ym: '2026-12', available: true, cost: 95, budget: 100 }], { nowYM: '2026-11' });
  const dec = BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 95000, budget: 100000 }, { nowYM: '2026-11' });
  const h = C.budgetBonusHtml(q4, [dec]);
  assert.match(h, /עלות כוח האדם של הבית ברבעון לא עוברת את תקציב כוח האדם של הרבעון/);
  assert.match(h, /הבונוס הרבעוני מתחיל ברבעון 1 2027 — 6,000 ₪/);
  assert.match(h, /בונוס חד-פעמי: אם עלות כוח האדם של דצמבר 2026 לא עוברת את יעד התקציב של החודש/);
  assert.match(h, /דצמבר 2026 — עוד לא התחיל<\/span><span class="bb-amount">2,500 ₪/);
  assert.match(h, /בדרך לבונוס — העלות הצפויה בתוך היעד/);
  assert.match(h, /עלות צפויה: 95,000 ₪ מתוך יעד 100,000 ₪/);
  assert.doesNotMatch(h, /מדרגה|ייקבע/, 'no tier wording; the amounts are set');
  assert.doesNotMatch(h, /צפי לרבעון/, 'no quarter forecast before the quarterly bonus starts');
  // Q1 2027, running, then settled over budget.
  const q1 = BE.budgetBonusQuarter([
    { ym: '2027-01', available: true, cost: 90, budget: 100 },
    { ym: '2027-02', available: false },
    { ym: '2027-03', available: false }], { nowYM: '2027-01' });
  const r = C.budgetBonusHtml(q1, []);
  assert.match(r, /רבעון 1 2027 — בתהליך<\/span><span class="bb-amount">6,000 ₪/);
  assert.match(r, /בדרך לבונוס — הצפי לרבעון בתוך התקציב/);
  const settled = BE.budgetBonusQuarter(q1.months.map((m) => ({ ym: m.ym, available: true, cost: 110, budget: 100 })), { nowYM: '2027-04' });
  const s = C.budgetBonusHtml(settled);
  assert.match(s, /— סופי/);
  assert.match(s, /אין בונוס/);
  const decDone = C.budgetBonusHtml(q1, [BE.budgetBonusMonth({ ym: '2026-12', available: true, cost: 101, budget: 100 }, { nowYM: '2027-01' })]);
  assert.match(decDone, /דצמבר 2026 — סופי/);
  assert.match(decDone, /החודש הסתיים מעל היעד — אין בונוס/);
  assert.match(C.budgetBonusHtml({ loading: true }), /טוען/);
  assert.match(C.budgetBonusHtml({ error: 'x' }), /x/);
  assert.match(C.quarterHtml(q4), /אוקטובר 2026[\s\S]*נובמבר 2026[\s\S]*דצמבר 2026/);
  assert.match(C.budgetHtml({ staff: { available: false, reason: 'no_house' }, monthBonuses: [dec] }), /בונוס יעד דצמבר 2026[\s\S]*2,500 ₪/, 'the budget tab shows it too');
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

test('«עלות אוקטובר 2026 מול היעד»: the REAL October cost from the staffing feed, the target and the saving; above the month card', () => {
  const ot = { baselineMonth: '2026-10', targetFrom: '2026-11', target: 205000 };
  const h = C.octoberTargetHtml(ot, { available: true, total: 283471.54, budget: 205000 });
  assert.match(h, /עלות אוקטובר 2026 מול היעד החודשי/);
  assert.match(h, /283,472 ₪<\/b><span>עלות כוח אדם בפועל — אוקטובר 2026/);
  assert.match(h, /205,000 ₪<\/b><span>יעד תקציב חודשי — מנובמבר 2026/);
  assert.match(h, /budget-kpi bad"><b>78,472 ₪<\/b><span>חיסכון נדרש · 27\.7% מעלות אוקטובר/);
  assert.match(h, /לפי דוח השכר והחשבוניות/);
  assert.doesNotMatch(h, /ועוד פרילנסרים משותפים|מספרים קבועים/, 'no table number, no fixed split');
  // under the target → green, no percentage, no minus sign on the amount
  const under = C.octoberTargetHtml({ target: 120000 }, { available: true, total: 100000 });
  assert.match(under, /budget-kpi ok"><b>20,000 ₪<\/b><span>מתחת ליעד<\/span>/);
  // October cost not available → the target alone and a plain note, never an invented number
  [null, undefined, {}, { available: false, reason: 'unreachable' }, { available: true }, { available: true, total: 'x' }, { available: true, total: -1 }].forEach((oct) => {
    const x = C.octoberTargetHtml(ot, oct);
    assert.match(x, /<b>—<\/b><span>עלות כוח אדם בפועל/);
    assert.match(x, /205,000 ₪/);
    assert.match(x, /עלות אוקטובר לא זמינה כרגע/);
    assert.doesNotMatch(x, /חיסכון נדרש|מתחת ליעד/);
  });
  // no target → no card
  [null, undefined, {}, { target: 0 }].forEach((x) => assert.equal(C.octoberTargetHtml(x, { available: true, total: 5 }), ''));
  // inside the tab: first card, also while the month data is down
  const staff = { available: true, month: '2026-11', hasActuals: false, total: 1, budget: 2, workers: [], budgetLines: [] };
  const oct = { available: true, total: 283471.54 };
  const tab = C.budgetHtml({ staff, octoberTarget: ot, octoberCost: oct });
  assert.ok(tab.indexOf('wk-budget-october') >= 0 && tab.indexOf('wk-budget-october') < tab.indexOf('wk-budget-sum'));
  assert.match(tab, /283,472 ₪/);
  assert.match(C.budgetHtml({ staff: { available: false, reason: 'unreachable' }, octoberTarget: ot, octoberCost: oct }), /wk-budget-october/);
  assert.doesNotMatch(C.budgetHtml({ staff }), /wk-budget-october/, 'no target from the server → no card');
  // no parentheses in the Hebrew strings
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /[()]/);
});

/* ── 16 Nov 2026: the per-worker simulation, the people who are leaving ── */
const STAFF = { available: true, month: '2026-11', hasActuals: false, total: 327749, budget: 265000,
  workers: [
    { name: 'אורן', roles: ['מנהל/ת'], cost: 36167, estimated: true },
    { name: 'נועם', roles: ['מדריך/ה'], cost: 16871, estimated: true, endDate: '2026-11-30' },
    { name: 'דנה', roles: ['מדריך/ה'], cost: 13945, estimated: true },
    { name: 'רובי', roles: ['טבח/ית'], cost: 8811, estimated: false },
    { name: '', roles: [], cost: 251955, estimated: true }
  ], budgetLines: [] };
const NEXT = { available: true, month: '2026-12', total: 302067, budget: 265000,
  workers: [
    { name: 'אורן', roles: ['מנהל/ת'], cost: 36167, estimated: true },
    { name: 'דנה', roles: ['מדריך/ה'], cost: 13945, estimated: true },
    { name: '', roles: [], cost: 251955, estimated: true }
  ] };

test('simulation: «סיום העסקה» and «שינוי שכר» replace the worker\'s figure and move the total; nothing else changes', () => {
  const none = C.simulateStaff(STAFF, {});
  assert.deepEqual([none.active, none.delta, none.total, none.count], [false, 0, 327749, 0]);
  const sim = { 'אורן': { kind: 'cost', amount: 30000 }, 'דנה': { kind: 'end' } };
  const r = C.simulateStaff(STAFF, sim);
  assert.deepEqual([r.active, r.count, r.delta, r.total], [true, 2, -6167 - 13945, 327749 - 6167 - 13945]);
  assert.deepEqual(r.workers.map((w) => [w.name, w.simKind, w.simCost]), [['אורן', 'cost', 30000], ['נועם', '', 16871], ['דנה', 'end', 0], ['רובי', '', 8811], ['', '', 251955]]);
  assert.equal(STAFF.workers[0].cost, 36167, 'the feed data is never mutated');
  // «שינוי שכר» chosen but no amount typed yet → marked, the figure unchanged
  const pending = C.simulateStaff(STAFF, { 'אורן': { kind: 'cost', amount: null } });
  assert.deepEqual([pending.active, pending.delta, pending.workers[0].simKind, pending.workers[0].simCost], [true, 0, 'cost', 36167]);
  // bad input never becomes a number: negative, text, an unknown kind, a prototype key, the unnamed row
  for (const bad of [{ 'אורן': { kind: 'cost', amount: -5 } }, { 'אורן': { kind: 'cost', amount: 'abc' } }]) assert.equal(C.simulateStaff(STAFF, bad).delta, 0);
  for (const bad of [{ 'אורן': { kind: 'fire' } }, { 'אורן': 'end' }, { '': { kind: 'end' } }, Object.create({ 'אורן': { kind: 'end' } })]) assert.equal(C.simulateStaff(STAFF, bad).active, false);
  assert.equal(C.simulateStaff(STAFF, { 'אורן': { kind: 'cost', amount: 9e12 } }).workers[0].simCost, C.SIM_MAX, 'capped');
  assert.equal(C.simulateStaff({ total: 100, workers: [{ name: 'a', cost: 100 }] }, { a: { kind: 'cost', amount: 0 } }).total, 0, 'a zero cost is a real value');
});

test('simulation in «תקציב כוח אדם»: the simulated figure replaces the worker\'s, the total below follows, a result card vs the budget, the quarter column', () => {
  const sim = { 'אורן': { kind: 'cost', amount: 30000 }, 'דנה': { kind: 'end' } };
  const q = BE.budgetBonusQuarter([
    { ym: '2026-10', available: true, cost: 346725, budget: 265000 },
    { ym: '2026-11', available: true, cost: 327749, budget: 265000 },
    { ym: '2026-12', available: true, cost: 302067, budget: 265000 }], { nowYM: '2026-11' });
  const h = C.budgetHtml({ staff: STAFF, nextStaff: NEXT, quarter: q, sim, nowYM: '2026-11' });
  // the worker rows
  assert.match(h, /<tr class=" is-sim"><td data-label="עובד\/ת">[\s\S]*?data-emp-open="אורן"[\s\S]*?סימולציה: שכר[\s\S]*?<td data-label="עלות החודש"><s class="sim-old">36,167 ₪<\/s> <b class="sim-new">30,000 ₪<\/b>/);
  assert.match(h, /data-emp-open="דנה"[\s\S]*?סימולציה: סיום[\s\S]*?<s class="sim-old">13,945 ₪<\/s> <b class="sim-new">0 ₪<\/b>/);
  assert.match(h, /<option value="end" selected>סיום העסקה/);
  assert.match(h, /data-sim-amount="אורן" value="30000"/);
  // the total at the bottom: was / is, for this month and the next one, and the change
  assert.match(h, /<tfoot><tr><td data-label="">סה״כ בסימולציה<\/td><td><\/td><td data-label="עלות החודש"><s class="sim-old">327,749 ₪<\/s> <b class="sim-new">307,637 ₪<\/b><\/td><td data-label="צפי דצמבר 2026"><s class="sim-old">302,067 ₪<\/s> <b class="sim-new">281,955 ₪<\/b><\/td>/);
  assert.match(h, /<td data-label="שינוי">‎-20,112 ₪<\/td><\/tr><\/tfoot>/);
  // the result card
  assert.match(h, /wk-budget-sim" data-default-open><div class="card-title">🧪 סימולציה — 2 שינויים/);
  assert.match(h, /307,637 ₪<\/b><span>עלות חודשית בסימולציה/);
  assert.match(h, /budget-kpi ok"><b>‎-20,112 ₪<\/b><span>חיסכון לחודש/);
  assert.match(h, /116%<\/b><span>חריגה — מול תקציב 265,000 ₪/);
  assert.match(h, /281,955 ₪<\/b><span>דצמבר 2026 בסימולציה · 106% · חריגה/);
  assert.match(h, /שום דבר לא נשמר, ושום דבר לא משתנה באפליקציית כוח האדם/);
  assert.match(h, /data-sim-reset/);
  // the quarter: a settled month has no simulated figure; the running month and the next one do
  assert.match(h, /<th>בסימולציה<\/th>/);
  assert.match(h, /אוקטובר 2026<\/td><td data-label="תקציב">265,000 ₪<\/td><td data-label="עלות">346,725 ₪<\/td><td data-label="ניצול">[^]*?<\/td><td data-label="בסימולציה">—<\/td><\/tr>/);
  assert.match(h, /נובמבר 2026[\s\S]*?<b class="sim-new">307,637 ₪<\/b>[\s\S]*?דצמבר 2026[\s\S]*?<b class="sim-new">281,955 ₪<\/b>/);
  // without a simulation the quarter has no such column
  assert.doesNotMatch(C.budgetHtml({ staff: STAFF, nextStaff: NEXT, quarter: q, sim: {}, nowYM: '2026-11' }), /בסימולציה<\/th>|wk-budget-sim/);
  assert.doesNotMatch(C.quarterHtml(q), /בסימולציה/);
});

test('next month per worker: the «צפי» column and the month card; with staffing\'s «חיסכון צפוי מסיומי עבודה» as the one card about who is leaving', () => {
  const ending = { count: 1, monthlySaving: 16871, savingThisMonth: 0, savingNextMonth: 16871 };
  const h = C.budgetHtml({ staff: { ...STAFF, ending }, nextStaff: NEXT, sim: {}, nowYM: '2026-11' });
  assert.match(h, /<th>צפי דצמבר 2026<\/th>/);
  // a worker who leaves: full this month, nothing next month — the offset is visible on their own row
  assert.match(h, /data-emp-open="נועם"[\s\S]*?מסיים\/ת 30\/11\/26[\s\S]*?<td data-label="עלות החודש">16,871 ₪<\/td><td data-label="צפי דצמבר 2026">0 ₪<\/td>/);
  assert.match(h, /data-emp-open="אורן"[\s\S]*?<td data-label="עלות החודש">36,167 ₪<\/td><td data-label="צפי דצמבר 2026">36,167 ₪<\/td>/);
  assert.match(h, /<td data-label="עלות החודש">327,749 ₪<\/td><td data-label="צפי דצמבר 2026">302,067 ₪<\/td>/, 'the totals of both months');
  assert.match(h, /302,067 ₪<\/b><span>צפי דצמבר 2026 · אחרי סיומי העבודה/);
  // ONE card about who is leaving — staffing's forecast (PR #73), open when the tab opens; no second list
  assert.equal((h.match(/wk-budget-ending/g) || []).length, 1);
  assert.match(h, /wk-budget-ending" data-default-open>/);
  assert.doesNotMatch(h, /wk-budget-leavers|עובדים שמסיימים \(/);
  assert.equal(C.leaversOf, undefined);
  // the chip of a worker who finishes appears once per row, in the name cell
  assert.equal((h.slice(h.indexOf('wk-budget-workers')).match(/crm-chip warn">מסיים\/ת /g) || []).length, 1);
  // next month not readable → no column, no forecast tile; the month itself is unchanged
  const only = C.budgetHtml({ staff: STAFF, sim: {} });
  assert.doesNotMatch(only, /צפי דצמבר/);
  assert.match(only, /327,749 ₪<\/b><span>עלות החודש/);
  // nobody leaving → no «אחרי סיומי העבודה» claim
  assert.match(C.budgetHtml({ staff: STAFF, nextStaff: NEXT, sim: {} }), /<span>צפי דצמבר 2026<\/span>/);
  // a bad end date from the feed is never rendered
  assert.doesNotMatch(C.budgetHtml({ staff: { ...STAFF, workers: [{ name: 'x', roles: [], cost: 5, estimated: true, endDate: '<b>' }] }, sim: {} }), /מסיים\/ת|<b>'/);
});

test('collapsible cards: a stable key per card, and which cards open first', () => {
  assert.equal(W.collapseKeyOf('card work-card wk-patients', 'מטופלים בבית (12)'), 'wk-patients');
  assert.equal(W.collapseKeyOf('card dash-card dash-today is-collapsible is-collapsed', 'x'), 'dash-today');
  assert.equal(W.collapseKeyOf('card work-card', 'רישומים (7)'), 'רישומים', 'no class of its own → the title without its numbers');
  assert.equal(W.collapseKeyOf('card work-card', 'הבית היום — יום שלישי 20/10/26'), 'הבית היום יום שלישי');
  assert.equal(W.collapseKeyOf('card', ''), 'card');
  const open = (o) => W.collapseDefaultOpen(Object.assign({ stored: undefined, total: 5, index: 2, anyMarked: false, marked: false, hasAlerts: false }, o));
  assert.equal(open({}), false, 'a busy tab opens with its other cards closed');
  assert.equal(open({ index: 0 }), true, 'the first card is open');
  assert.equal(open({ total: 2 }), true, 'a short tab opens fully');
  assert.equal(open({ anyMarked: true, marked: true }), true, 'a marked main card is open');
  assert.equal(open({ anyMarked: true, index: 0 }), false, 'when cards are marked, only they open');
  assert.equal(open({ hasAlerts: true }), true, 'an alert card with alerts is never hidden');
  assert.equal(open({ stored: true }), true);
  assert.equal(open({ stored: false, index: 0, hasAlerts: true }), false, 'the person\'s own choice wins');
  // wiring: every render path re-applies it; nothing is stored on the device; the bonus tab is left alone
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  assert.ok((w.match(/applyCollapse\(panel, key\)/g) || []).length >= 4);
  // «פגישות קליטה» (19 Nov 2026) draws its own sections — never collapsed by work.js.
  assert.match(w, /NO_COLLAPSE_SUBS = \{ bonus: 1, summaries: 1, shiftUpdates: 1, meetings: 1, calendar: 1 \}/);   // «יומן» 21 Nov 2026
  assert.doesNotMatch(w, /localStorage|sessionStorage|indexedDB/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.card\.is-collapsed > :not\(\.card-title\)/);
  assert.match(css, /@media print \{ \.card\.is-collapsed > \* \{ display: revert !important; \}/, 'a printed page is never missing a closed card');
});

test('simulation «הפחתת סכום אחר»: the typed amount comes straight off the total, whatever the list shows for the worker; an empty field puts it back', () => {
  // more than the worker's listed figure: the whole amount still comes off the total
  const r = C.simulateStaff(STAFF, { 'דנה': { kind: 'deduct', amount: 35000 } });
  assert.deepEqual([r.active, r.count, r.delta, r.total], [true, 1, -35000, 327749 - 35000]);
  const d = r.workers[2];
  assert.deepEqual([d.name, d.cost, d.simKind, d.simAmount, d.simDeduct, d.simDelta, d.simCost], ['דנה', 13945, 'deduct', 35000, 35000, -35000, 0]);
  // less than the listed figure
  const part = C.simulateStaff(STAFF, { 'אורן': { kind: 'deduct', amount: 6000 } });
  assert.deepEqual([part.total, part.workers[0].simCost, part.workers[0].simDelta], [327749 - 6000, 30167, -6000]);
  // the field emptied → the real figures are back; the option stays chosen so another amount can be typed
  for (const empty of [null, '', undefined]) {
    const back = C.simulateStaff(STAFF, { 'דנה': { kind: 'deduct', amount: empty } });
    assert.deepEqual([back.delta, back.total, back.workers[2].simKind, back.workers[2].simCost, back.workers[2].simDeduct], [0, 327749, 'deduct', 13945, 0]);
  }
  // only a whole amount from 0 to SIM_MAX; the total never goes under 0
  for (const bad of [-5, 'abc', NaN]) assert.equal(C.simulateStaff(STAFF, { 'דנה': { kind: 'deduct', amount: bad } }).delta, 0);
  assert.equal(C.simulateStaff(STAFF, { 'דנה': { kind: 'deduct', amount: 9e12 } }).delta, -C.SIM_MAX, 'capped');
  assert.equal(C.simulateStaff(STAFF, { 'דנה': { kind: 'deduct', amount: 1234.6 } }).delta, -1235);
  assert.equal(C.simulateStaff({ total: 100, workers: [{ name: 'a', cost: 100 }] }, { a: { kind: 'deduct', amount: 500 } }).total, 0);
  // together with the other options
  const mix = C.simulateStaff(STAFF, { 'אורן': { kind: 'cost', amount: 30000 }, 'נועם': { kind: 'end' }, 'דנה': { kind: 'deduct', amount: 35000 } });
  assert.deepEqual([mix.count, mix.delta], [3, -6167 - 16871 - 35000]);

  const h = C.budgetHtml({ staff: STAFF, nextStaff: NEXT, sim: { 'דנה': { kind: 'deduct', amount: 35000 } }, nowYM: '2026-11' });
  // the option, the field with what was typed, the hint
  assert.match(h, /<option value="deduct" selected>הפחתת סכום אחר<\/option><\/select><input class="sim-amount"[^>]*data-sim-amount="דנה" value="35000" placeholder="סכום להפחתה ₪" aria-label="סכום להפחתה מהעלות הכוללת — דנה">/);
  assert.match(h, /<span class="sim-hint">יורד ישירות מהסה״כ\. שדה ריק מחזיר את הנתון\.<\/span>/);
  // the row: the worker's figure stays, the amount off the total is beside it; the chip says what it is
  assert.match(h, /data-emp-open="דנה"[\s\S]*?סימולציה: הפחתה[\s\S]*?<td data-label="עלות החודש">13,945 ₪ <b class="sim-new sim-deduct">‎-35,000 ₪<\/b><\/td><td data-label="צפי דצמבר 2026">13,945 ₪ <b class="sim-new sim-deduct">‎-35,000 ₪<\/b>/);
  // the total under the table and the result card: this month and next month
  assert.match(h, /סה״כ בסימולציה<\/td><td><\/td><td data-label="עלות החודש"><s class="sim-old">327,749 ₪<\/s> <b class="sim-new">292,749 ₪<\/b><\/td><td data-label="צפי דצמבר 2026"><s class="sim-old">302,067 ₪<\/s> <b class="sim-new">267,067 ₪<\/b>/);
  assert.match(h, /<b>292,749 ₪<\/b><span>עלות חודשית בסימולציה<\/span>/);
  assert.match(h, /<b>‎-35,000 ₪<\/b><span>חיסכון לחודש<\/span>/);
  // clearing is offered like for every simulated row
  assert.match(h, /data-sim-clear="דנה"/);
  // the field emptied: no struck-through figure anywhere, the field is still there to type in
  const empty = C.budgetHtml({ staff: STAFF, nextStaff: NEXT, sim: { 'דנה': { kind: 'deduct', amount: null } }, nowYM: '2026-11' });
  assert.match(empty, /data-sim-amount="דנה" value="" placeholder="סכום להפחתה ₪"/);
  assert.doesNotMatch(empty, /sim-old|sim-deduct"/);
  assert.match(empty, /<b>327,749 ₪<\/b><span>עלות חודשית בסימולציה<\/span>/);
  // an untouched row offers the option, with no field
  const none = C.budgetHtml({ staff: STAFF, sim: {} });
  assert.equal((none.match(/<option value="deduct">הפחתת סכום אחר<\/option>/g) || []).length, 4);
  assert.doesNotMatch(none, /data-sim-amount|sim-hint/);
  // the name is escaped in the new attributes too
  const XSS = '<img src=x onerror=alert(1)>';
  const x = C.budgetHtml({ staff: { available: true, month: '2026-11', total: 5, workers: [{ name: XSS, roles: [], cost: 5, estimated: true }] }, sim: { [XSS]: { kind: 'deduct', amount: 3 } } });
  assert.doesNotMatch(x, /<img/);
  assert.match(x, /aria-label="סכום להפחתה מהעלות הכוללת — &lt;img/);
  // no parentheses in the new Hebrew
  assert.doesNotMatch(none.slice(none.indexOf('<b>סימולציה:</b>'), none.indexOf('לא נשמר.')), /[()]/);

  // wiring: the option, the amount kept under the option chosen for the worker, the focus on the field
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  assert.match(w, /simKind\.value === 'deduct'\) sm\[who\] = \{ kind: 'deduct', amount: null \};/);
  assert.match(w, /sm\[who\] = \{ kind: sm\[who\] && sm\[who\]\.kind === 'deduct' \? 'deduct' : 'cost', amount: simAmt\.value !== '' && isFinite\(n\) && n >= 0 \?/);
  assert.match(w, /simKind\.value === 'cost' \|\| simKind\.value === 'deduct'\)/);
  assert.ok(Number(/ezone-managers-v(\d+)/.exec(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'))[1]) >= 50);
});

test('the simulation never leaves the page: no request carries it, nothing is stored', () => {
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  const posts = w.match(/post\(\{[^}]*\}\)/g) || [];
  assert.ok(posts.length > 5);
  for (const p of posts) assert.doesNotMatch(p, /sim/i, p);
  assert.match(w, /if \(!known\) return;/, 'only a worker of the list on screen can be simulated');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(srv, /simulat/i, 'the server knows nothing about it');
});
