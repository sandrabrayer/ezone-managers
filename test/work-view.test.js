'use strict';
/* Work tabs — the pure view builders in public/work.js (WorkView). */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/work.js');

const DATA = {
  ok: true, today: '2026-10-13',
  patients: [{ name: 'דנה', entryDate: '2026-09-01', days: 43, status: 'active' }, { name: '<img src=x onerror=alert(1)>', entryDate: '2026-10-05', days: 9, status: 'trial' }],
  outpatients: [{ name: 'מיכל', therapy: 'טיפול יום — פעמיים בשבוע', startDate: '2026-09-15' }],
  visits: [{ date: '2026-10-11', time: '', name: 'ביקור ב', meetingWith: 'אורן', outcome: 'thinking' }, { date: '2026-10-08', time: '10:30', name: 'ביקור א', meetingWith: 'אורן', outcome: 'entered' }],
  admissions: [{ name: 'יוסי', date: '2026-10-05' }],
  logs: {
    familyCalls: [{ id: 'f1', patientName: 'דנה', contactName: 'רות', callDate: '2026-10-12', summary: 'old', followUpDate: '2026-10-13', followUpDone: false, author: 'אורן', canEdit: true }],
    staffTalks: [{ id: 's1', employeeName: 'נועה', talkDate: '2026-10-12', talkTime: '18:05', summary: 'שיחת משוב', followUpDate: '2026-10-13', followUpDone: false, author: 'אורן', canEdit: true }],
    events: [{ id: 'e1', eventDate: '2026-10-10', eventTime: '', patientName: '', whatHappened: 'הצפה במטבח', actionTaken: 'הוזמן אינסטלטור', followUpDate: '', followUpDone: false, author: 'סנדרה' }]
  },
  followUps: [{ log: 'staffTalks', id: 's1', date: '2026-10-13' }, { log: 'familyCalls', id: 'f1', date: '2026-10-13' }]
};
const ORAN = { name: 'אורן', role: 'manager', house: 'ramot' };

test('patients tab: patients, outpatients, visits and admissions — every value escaped', () => {
  const h = W.patientsHtml(DATA);
  assert.match(h, /מטופלים בבית \(2\)/);
  assert.match(h, /דנה<\/span><span class="wk-meta">מ-1\/9\/26 · יום 43</);
  assert.match(h, /· ניסיון/);
  assert.ok(!h.includes('<img'), 'a name from the sheet never becomes markup');
  assert.match(h, /מטופלי חוץ שיצאו מהבית \(1\)[\s\S]*מיכל[\s\S]*טיפול יום — פעמיים בשבוע · מ-15\/9\/26/);
  assert.match(h, /<b>2<\/b><span>ביקורים<\/span>[\s\S]*<b>1<\/b><span>נקלטו<\/span>/);
  assert.match(h, /ביקור א<\/span><span class="wk-meta">8\/10\/26 10:30 · עם אורן · נכנסים לטיפול/);
  const empty = W.patientsHtml({});
  assert.match(empty, /אין מטופלים רשומים בבית/);
  assert.match(empty, /אין כרגע מטופלי חוץ מהבית/);
});

test('log form: the defined fields, required marks, today as the default date, patients offered as suggestions', () => {
  const f = W.formHtml('events', DATA, '2026-10-13');
  for (const name of ['eventDate', 'eventTime', 'patientName', 'whatHappened', 'actionTaken', 'followUpDate']) {
    assert.match(f, new RegExp(`name="${name}"`), name);
  }
  assert.match(f, /name="eventDate" type="date" value="2026-10-13" required/);
  assert.match(f, /<option value="דנה">/);
  assert.match(f, /<option value="&lt;img src=x onerror=alert\(1\)&gt;">/);
  assert.match(f, /מה קרה \*/);
  assert.match(W.formHtml('staffTalks', DATA, '2026-10-13'), /name="employeeName"/);
  assert.match(W.formHtml('events', DATA, '2026-10-13'), /name="whatHappened"[\s\S]*name="actionTaken"/);
});

test('log list: newest data as given; follow-up states; edit buttons only for the author or an admin', () => {
  const mine = W.logListHtml('staffTalks', DATA.logs.staffTalks, ORAN);
  assert.match(mine, /נועה[\s\S]*12\/10\/26 18:05 · אורן/);
  assert.match(mine, /מעקב: 13\/10\/26[\s\S]*data-wk-done="staffTalks\|s1"/);
  assert.match(mine, /data-wk-del="staffTalks\|s1"/);
  const notMine = W.logListHtml('events', DATA.logs.events, ORAN);
  assert.doesNotMatch(notMine, /data-wk-del|data-wk-done/, 'Oran cannot delete Sandra\'s entry');
  assert.match(notMine, /הצפה במטבח[\s\S]*מה נעשה: הוזמן אינסטלטור/);
  assert.match(W.logListHtml('events', DATA.logs.events.map(r => ({ ...r, canEdit: true })), { name: 'סנדרה', role: 'admin' }), /data-wk-del/);
  assert.match(W.logListHtml('events', [], ORAN), /עדיין אין רישומים/);
});

test('staff-talks panel says who can read it', () => {
  assert.match(W.logPanelHtml('staffTalks', DATA, ORAN), /השיחות כאן נראות רק לך, לסנדרה ולרון\./);
});

test('follow-ups strip: one line per due item, with a done button for the author', () => {
  const h = W.followUpsHtml(DATA, ORAN);
  assert.match(h, /תזכורת אחת למעקב/, 'the removed family-calls log never shows');
  assert.match(h, /שיחה עם עובד\/ת · נועה · 13\/10\/26[\s\S]*data-wk-done="staffTalks\|s1"/);
  assert.doesNotMatch(h, /familyCalls|שיחת משפחה/);
  assert.equal(W.followUpsHtml({ followUps: [] }, ORAN), '');
});

test('entryFromForm: only defined fields, trimmed and capped; missing required fields named in Hebrew', () => {
  const r = W.entryFromForm('events', { patientName: ' דנה ', eventDate: '2026-10-12', whatHappened: '', actionTaken: 'x'.repeat(2000), extra: 'drop me', followUpDate: '' });
  assert.deepEqual(r.missing, ['מה קרה']);
  assert.equal(r.entry.patientName, 'דנה');
  assert.equal(r.entry.actionTaken.length, 1500);
  assert.equal('extra' in r.entry, false);
});

test('a matching display name never grants edit buttons without the server permission', () => {
  const rows = DATA.logs.staffTalks.map(r => ({ ...r, canEdit: false }));
  assert.doesNotMatch(W.logListHtml('staffTalks', rows, ORAN), /data-wk-del|data-wk-done/);
});

/* ---- Stage 2: team + therapists (coordinators data via the Dashboard) ---- */
const TEAM = {
  available: true, stale: false, updatedAt: '2026-10-13T06:00:00.000Z',
  today: [
    { date: '2026-10-13', shift: 'לילה', guideName: 'גל', draft: false },
    { date: '2026-10-13', shift: 'בוקר', guideName: 'אבי', draft: false },
    { date: '2026-10-13', shift: 'בוקר', guideName: '<b>x</b>', draft: false }
  ],
  shifts: [
    { date: '2026-10-13', shift: 'בוקר', guideName: 'אבי', draft: false },
    { date: '2026-10-14', shift: 'ערב', guideName: 'רון ש', draft: true }
  ],
  staff: [
    { name: 'אבי', kind: 'guide', role: 'מדריך/ה', phone: '0501234567', onLeave: false, workdays: [] },
    { name: 'ד"ר כהן', kind: 'therapist', role: 'פסיכיאטר/ית', phone: 'javascript:alert(1)', onLeave: true, workdays: [0, 2] }
  ],
  therapistWeek: [
    { dayOfWeek: 2, time: '10:00', therapistName: 'ד"ר כהן', patientName: 'דנה' },
    { dayOfWeek: 0, time: '', therapistName: 'ד"ר כהן', patientName: '<script>' }
  ]
};
const WITH_TEAM = Object.assign({}, DATA, { team: TEAM });

test('team tab: today grouped by shift in order, escaped; the next days by date; draft marked', () => {
  const h = W.teamHtml(WITH_TEAM);
  assert.match(h, /במשמרת היום[\s\S]*<span class="wk-shift">בוקר<\/span><span class="wk-name">אבי, &lt;b&gt;x&lt;\/b&gt;<\/span>[\s\S]*<span class="wk-shift">לילה<\/span><span class="wk-name">גל/);
  assert.ok(!h.includes('<b>x</b>'));
  assert.match(h, /משמרות בשבועיים הקרובים[\s\S]*יום רביעי 14\/10\/26[\s\S]*ערב<\/span><span class="wk-name">רון ש<\/span><span class="wk-meta">טיוטה/);
  assert.ok(!/יום שלישי 13\/10\/26/.test(h), 'today is not repeated in the next-days list');
});

test('team tab: staff list split by role; tel: links only for a valid phone', () => {
  const h = W.teamHtml(WITH_TEAM);
  assert.match(h, /עובדי הבית \(2\)[\s\S]*מדריכים \(1\)[\s\S]*מטפלים \(1\)/);
  assert.match(h, /href="tel:0501234567"/);
  assert.ok(!h.includes('javascript:'), 'never a non-tel link');
  assert.match(h, /פסיכיאטר\/ית · בחופשה/);
  assert.equal(W.telHref('0501234567'), 'tel:0501234567');
  assert.equal(W.telHref('+972501234567'), '');
});

test('therapists tab: workdays in Hebrew, weekly visits by day, untimed shown honestly, escaped', () => {
  const h = W.therapistsHtml(WITH_TEAM);
  assert.match(h, /מטפלים בבית \(1\)[\s\S]*ד&quot;ר כהן[\s\S]*ימי עבודה: ראשון, שלישי · בחופשה/);
  assert.match(h, /יום ראשון[\s\S]*ללא שעה[\s\S]*עם &lt;script&gt;[\s\S]*יום שלישי[\s\S]*10:00/);
  assert.ok(!h.includes('<script>'));
});

test('team / therapists: not connected, unreadable, an old backend (no team) → an honest message, never an empty list', () => {
  const nc = Object.assign({}, DATA, { team: { available: false, reason: 'not_configured' } });
  assert.match(W.teamHtml(nc), /עוד לא מחוברים/);
  assert.match(W.therapistsHtml(nc), /עוד לא מחוברים/);
  assert.match(W.teamHtml(Object.assign({}, DATA, { team: { available: false, reason: 'unreadable' } })), /לא הצלחנו לקרוא/);
  assert.match(W.teamHtml(DATA), /עוד לא מחוברים/);
  assert.ok(!/במשמרת היום/.test(W.teamHtml(nc)));
});

test('team: stale data carries a visible warning; fresh data none', () => {
  assert.ok(!W.teamHtml(WITH_TEAM).includes('wk-stale'));
  const stale = Object.assign({}, DATA, { team: Object.assign({}, TEAM, { stale: true }) });
  assert.match(W.teamHtml(stale), /wk-stale[\s\S]*לא התעדכנו לאחרונה/);
});

test('staff-talk form offers the house staff as suggestions (escaped)', () => {
  const d = Object.assign({}, DATA, { team: Object.assign({}, TEAM, { staff: TEAM.staff.concat([{ name: '"><img>', kind: 'guide', role: '', phone: '', workdays: [] }]) }) });
  const h = W.formHtml('staffTalks', d, d.today);
  assert.match(h, /<datalist id="wk-staffTalks-employeeName-list"><option value="אבי">/);
  assert.ok(!h.includes('"><img>'));
});

/* ---- Dashboard (14 Oct 2026) ---- */
test('family calls are gone from the app (no log definition)', () => {
  assert.equal(W.LOGS.familyCalls, undefined);
  assert.deepEqual(Object.keys(W.LOGS), ['staffTalks', 'events']);
});

test('dashboard: today in the house — patients, on shift, today\'s therapy sessions, open reminders', () => {
  const d = Object.assign({}, DATA, { today: '2026-10-13', team: TEAM }); // 13/10/26 is a Tuesday (2)
  const h = W.dashboardHtml(d);
  assert.match(h, /הבית היום — יום שלישי 13\/10\/26/);
  assert.match(h, /<b>2<\/b><span>מטופלים בבית/);
  assert.match(h, /<b>3<\/b><span>במשמרת היום/);
  assert.match(h, /<b>1<\/b><span>טיפולים היום[\s\S]*<b>1<\/b><span>תזכורות פתוחות/);
  assert.match(h, /טיפולים היום<\/div><ul[\s\S]*10:00[\s\S]*ד&quot;ר כהן[\s\S]*עם דנה/);
  assert.ok(!h.includes('<b>x</b>'), 'escaped');
});

test('dashboard: visits this week / month, admissions, outpatients, upcoming visits, latest events', () => {
  const d = Object.assign({}, DATA, {
    today: '2026-10-13', team: TEAM,
    visits: [
      { date: '2026-10-15', time: '11:00', name: 'ביקור קרוב', meetingWith: 'אורן' },
      { date: '2026-10-11', time: '', name: 'ביקור ראשון בשבוע', meetingWith: 'אורן' },
      { date: '2026-10-02', time: '', name: 'ביקור ישן', meetingWith: 'אורן' },
      { date: '2026-10-20', time: '', name: 'שבוע הבא', meetingWith: '' }
    ]
  });
  const h = W.dashboardHtml(d);
  assert.match(h, /<b>2<\/b><span>ביקורים השבוע/, 'Sun 11/10 – Sat 17/10');
  assert.match(h, /<b>4<\/b><span>ביקורים החודש[\s\S]*<b>1<\/b><span>נקלטו החודש/);
  assert.match(h, /ביקורים קרובים[\s\S]*ביקור קרוב[\s\S]*15\/10\/26 11:00[\s\S]*שבוע הבא/);
  assert.ok(!/ביקורים קרובים[\s\S]*ביקור ישן/.test(h.split('נקלטו לאחרונה')[0]), 'past visits are not "upcoming"');
  assert.match(h, /אירועים חריגים אחרונים[\s\S]*הצפה במטבח|אירועים חריגים אחרונים[\s\S]*אירוע/);
  assert.match(h, /data-go-sub="events"/);
});

test('dashboard: no coordinators data → honest message and dashes, never fake zeros', () => {
  const h = W.dashboardHtml(Object.assign({}, DATA, { team: { available: false, reason: 'not_configured' } }));
  assert.match(h, /<b>—<\/b><span>במשמרת היום[\s\S]*<b>—<\/b><span>טיפולים היום/);
  assert.match(h, /עוד לא מחוברים/);
});

test('dashboard: expected admissions — this week counted and highlighted, next week listed, past dropped, stage in words', () => {
  const d = Object.assign({}, DATA, {
    today: '2026-10-13', team: TEAM,
    expectedAdmissions: [
      { name: 'אתמול', date: '2026-10-12', stage: 'paid' },
      { name: 'חמישי', date: '2026-10-15', stage: 'paid', meetingWith: 'אורן' },
      { name: '<i>שבת</i>', date: '2026-10-17', stage: 'entry' },
      { name: 'שבוע הבא', date: '2026-10-21', stage: 'visit' }
    ]
  });
  const h = W.dashboardHtml(d);
  assert.match(h, /<b>2<\/b><span>קליטות צפויות השבוע/);
  assert.match(h, /<li class="wk-soon"><span class="wk-name">חמישי<\/span><span class="wk-meta">יום חמישי 15\/10\/26 · שילם מקדמה · השבוע/);
  assert.match(h, /&lt;i&gt;שבת&lt;\/i&gt;[\s\S]*נכנס לבית · השבוע/);
  assert.match(h, /<li><span class="wk-name">שבוע הבא<\/span><span class="wk-meta">יום רביעי 21\/10\/26 · נקבע ביקור<\/span>/);
  assert.ok(!h.includes('אתמול'));
  assert.ok(!h.includes('<i>'));
});

test('dashboard: an older server without expectedAdmissions shows a dash, not a fake zero', () => {
  const h = W.dashboardHtml(Object.assign({}, DATA, { team: TEAM }));
  assert.match(h, /<b>—<\/b><span>קליטות צפויות השבוע/);
  assert.match(h, /הנתון יופיע אחרי עדכון השרת/);
});

/* ---- Stage 3: manpower cost card (14 Oct 2026) ---- */
const COST = { ok: true, month: '2026-10', cost: { available: true, month: '2026-10', hasActuals: true, stale: false,
  total: 182346, confirmed: 150000, estimated: 32346, missingData: 0, instructors: 98000, budget: 186400 } };

test('cost card: total, budget bar with % and what is left, the split, an honest note', () => {
  const h = W.costHtml(COST);
  assert.match(h, /עלות כוח אדם — אוקטובר 2026/);
  assert.match(h, /<b>182,346 ₪<\/b><span>עלות משוערת לחודש/);
  assert.match(h, /class="cost-bar"><div class="cost-fill" style="width:98%">/);
  assert.match(h, /תקציב 186,400 ₪ · 98% מהתקציב · נשארו 4,054 ₪/);
  assert.match(h, /<b>98,000 ₪<\/b><span>מדריכים[\s\S]*<b>150,000 ₪<\/b><span>לפי דוח שכר[\s\S]*<b>32,346 ₪<\/b><span>הערכה/);
  assert.ok(!h.includes('חסרים נתונים'), 'the missing-data tile only when there is some');
  assert.match(h, /חלק מהעלות כבר לפי דוח השכר/);
});

test('cost card: over budget is flagged; no budget → no bar; no payroll yet → all-estimate note', () => {
  const over = W.costHtml({ month: '2026-10', cost: Object.assign({}, COST.cost, { total: 200000 }) });
  assert.match(over, /class="cost-bar over"[\s\S]*width:100%[\s\S]*חריגה של 13,600 ₪/);
  const nob = W.costHtml({ month: '2026-10', cost: Object.assign({}, COST.cost, { budget: null, hasActuals: false, missingData: 5000 }) });
  assert.ok(!nob.includes('cost-bar'));
  assert.match(nob, /עדיין אין דוח שכר לחודש הזה/);
  assert.match(nob, /<b>5,000 ₪<\/b><span>חסרים נתונים/);
});

test('cost card: not available → a message, never 0 ₪', () => {
  for (const reason of ['not_configured', 'unauthorized', 'unreachable', 'no_house', 'error']) {
    const h = W.costHtml({ month: '2026-10', cost: { available: false, reason } });
    assert.ok(!h.includes('₪'), reason);
    assert.match(h, /wk-empty/);
  }
  assert.match(W.costHtml({ cost: { available: false, reason: 'not_configured' } }), /עוד לא מחובר/);
  assert.match(W.costHtml(null), /לא הצלחנו לקרוא/);
});
