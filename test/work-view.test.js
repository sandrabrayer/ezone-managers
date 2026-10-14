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
    familyCalls: [{ id: 'f1', patientName: 'דנה', contactName: 'רות', relation: 'אמא', callDate: '2026-10-12', callTime: '18:05', summary: 'עדכון', followUpDate: '2026-10-13', followUpDone: false, author: 'אורן' }],
    staffTalks: [],
    events: [{ id: 'e1', eventDate: '2026-10-10', eventTime: '', patientName: '', whatHappened: 'הצפה במטבח', actionTaken: 'הוזמן אינסטלטור', followUpDate: '', followUpDone: false, author: 'סנדרה' }]
  },
  followUps: [{ log: 'familyCalls', id: 'f1', date: '2026-10-13' }]
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
  const f = W.formHtml('familyCalls', DATA, '2026-10-13');
  for (const name of ['patientName', 'contactName', 'relation', 'callDate', 'callTime', 'summary', 'followUpDate']) {
    assert.match(f, new RegExp(`name="${name}"`), name);
  }
  assert.match(f, /name="callDate" type="date" value="2026-10-13" required/);
  assert.match(f, /<option value="דנה">/);
  assert.match(f, /<option value="&lt;img src=x onerror=alert\(1\)&gt;">/);
  assert.match(f, /איש\/אשת קשר \*/);
  assert.match(W.formHtml('staffTalks', DATA, '2026-10-13'), /name="employeeName"/);
  assert.match(W.formHtml('events', DATA, '2026-10-13'), /name="whatHappened"[\s\S]*name="actionTaken"/);
});

test('log list: newest data as given; follow-up states; edit buttons only for the author or an admin', () => {
  const mine = W.logListHtml('familyCalls', DATA.logs.familyCalls, ORAN);
  assert.match(mine, /דנה — רות \(אמא\)[\s\S]*12\/10\/26 18:05 · אורן/);
  assert.match(mine, /מעקב: 13\/10\/26[\s\S]*data-wk-done="familyCalls\|f1"/);
  assert.match(mine, /data-wk-del="familyCalls\|f1"/);
  const notMine = W.logListHtml('events', DATA.logs.events, ORAN);
  assert.doesNotMatch(notMine, /data-wk-del|data-wk-done/, 'Oran cannot delete Sandra\'s entry');
  assert.match(notMine, /הצפה במטבח[\s\S]*מה נעשה: הוזמן אינסטלטור/);
  assert.match(W.logListHtml('events', DATA.logs.events, { name: 'סנדרה', role: 'admin' }), /data-wk-del/);
  assert.match(W.logListHtml('staffTalks', [], ORAN), /עדיין אין רישומים/);
});

test('staff-talks panel says who can read it', () => {
  assert.match(W.logPanelHtml('staffTalks', DATA, ORAN), /השיחות כאן נראות רק לך, לסנדרה ולרון\./);
});

test('follow-ups strip: one line per due item, with a done button for the author', () => {
  const h = W.followUpsHtml(DATA, ORAN);
  assert.match(h, /תזכורת אחת למעקב/);
  assert.match(h, /שיחת משפחה · דנה — רות \(אמא\) · 13\/10\/26[\s\S]*data-wk-done="familyCalls\|f1"/);
  assert.equal(W.followUpsHtml({ followUps: [] }, ORAN), '');
});

test('entryFromForm: only defined fields, trimmed and capped; missing required fields named in Hebrew', () => {
  const r = W.entryFromForm('familyCalls', { patientName: ' דנה ', contactName: '', callDate: '2026-10-12', summary: 'x'.repeat(2000), extra: 'drop me', followUpDate: '' });
  assert.deepEqual(r.missing, ['איש/אשת קשר']);
  assert.equal(r.entry.patientName, 'דנה');
  assert.equal(r.entry.summary.length, 1000);
  assert.equal('extra' in r.entry, false);
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
