'use strict';
/* «📅 יומן» — the house's week (21 Nov 2026, docs/week-calendar.md).
 *   A. the week: Sunday start, month / year change, the clock-change weeks, the arrows' range;
 *   B. the items: every kind mapped from data the app already holds; sorting; what is flagged;
 *   C. sources that are not available are NAMED, never shown as an empty truth;
 *   D. the markup: escaped, filters, links to the tabs, today marked, the home line;
 *   E. «הוספה ליומן»: the Google link and the .ics file — first name only;
 *   F. wiring (template, scripts, SW, hooks) and no new request. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/calendar.js');
const M = require('../public/meetings.js');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

const TODAY = '2026-11-24';   // a Tuesday; the week is Sun 22 → Sat 28
const MEETINGS = () => ({ state: 'ok', list: [
  { id: 'L1', name: 'דני כהן', houseLabel: 'רמות השבים', visitDate: '2026-11-25', visitTime: '10:00', meetingWith: 'אורן', officeNote: 'רקע', report: null, invite: 'sent' },
  { id: 'L2', name: 'רות לוי', houseLabel: 'רמות השבים', visitDate: '2026-11-25', visitTime: '', meetingWith: 'אורן', report: null, invite: '' },
  { id: 'L3', name: 'עבר ולא דווח', houseLabel: 'רמות השבים', visitDate: '2026-11-23', visitTime: '09:00', meetingWith: 'שחר', report: null },
  { id: 'L4', name: 'דווח', houseLabel: 'רמות השבים', visitDate: '2026-11-22', visitTime: '11:00', meetingWith: 'אורן', report: { outcome: 'advancing' } },
  { id: 'L5', name: 'שבוע הבא', houseLabel: 'רמות השבים', visitDate: '2026-12-01', visitTime: '12:00', meetingWith: 'אורן', report: null },
  { id: 'L6', name: 'תאריך שבור', visitDate: '2026-02-30', visitTime: '12:00' },
] });
const HOUSE = () => ({
  today: TODAY,
  visits: [{ name: 'ביקור מהרשימה', date: '2026-11-26', time: '13:00', meetingWith: 'אורן' }],
  committees: { available: true, today: TODAY, items: [
    { date: '2026-11-24', time: '14:00', type: 'ועדת המשך', patientName: 'יעל', status: 'scheduled' },
    { date: '2026-11-27', time: '', type: 'ועדת שחרור', patientName: 'גיל', status: 'cancelled' },
  ] },
  expectedAdmissions: [{ name: 'נכנס חדש', date: '2026-11-26', stage: 'paid' }, { name: 'בלי תאריך', date: '' }],
  expectedDischargeSupported: true,
  patients: [
    { name: 'משתחרר', expectedDischarge: { date: '2026-11-28' } },
    { name: 'בלי צפי', expectedDischarge: { none: true } },
    { name: 'ללא', expectedDischarge: null },
  ],
  logs: {
    events: [{ id: 'e1', patientName: 'נועה', whatHappened: 'x', followUpDate: '2026-11-23' }, { id: 'e2', whatHappened: 'בוצע', followUpDate: '2026-11-24', followUpDone: true }],
    staffTalks: [{ id: 's1', employeeName: 'מדריך א', summary: 'פרטי', followUpDate: '2026-11-25' }],
    familyCalls: [{ id: 'f1', patientName: 'יעל', contactName: 'אמא', summary: 'y', followUpDate: '2026-11-25' }],
  },
  team: { available: true, staff: [{ name: 'עובדת ותיקה', startDate: '2026-05-26', active: true }, { name: 'בלי תאריך', active: true }],
    therapistWeek: [{ dayOfWeek: 2, time: '16:00', therapistName: 'ד"ר מטפל', patientName: 'יעל' }, { dayOfWeek: 9, time: '10:00', therapistName: 'שגוי' }] },
  feedback: { supported: true, rows: [] },
});
const collect = (d, m) => C.collect(d || HOUSE(), m || MEETINGS());
const week = (ws, filters, d, m) => C.weekModel(collect(d, m), ws, filters);
const titles = (wm, date) => wm.days.find((x) => x.date === date).items.map((i) => i.type + ':' + i.title);

/* ===== A. the week ===== */

test('A: the week opens on Sunday and has 7 days; any day of it gives the same week', () => {
  assert.equal(C.weekStartOf('2026-11-24'), '2026-11-22');
  assert.equal(C.weekStartOf('2026-11-22'), '2026-11-22', 'a Sunday is its own start');
  assert.equal(C.weekStartOf('2026-11-28'), '2026-11-22', 'Saturday closes it');
  assert.equal(C.weekStartOf('not-a-date'), '');
  for (const day of ['2026-11-22', '2026-11-24', '2026-11-28']) {
    const wm = week(day);
    assert.deepEqual([wm.weekStart, wm.weekEnd, wm.days.length], ['2026-11-22', '2026-11-28', 7]);
    assert.deepEqual(wm.days.map((x) => x.weekday), ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']);
  }
});

test('A: month and year changes, a leap day and the clock-change weeks are plain calendar days', () => {
  assert.deepEqual(C.weekModel({ today: '2026-12-30', items: [] }, '2026-12-30').days.map((x) => x.date),
    ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(C.weekStartOf('2028-03-01'), '2028-02-27');
  assert.equal(C.addDays('2028-02-27', 2), '2028-02-29');
  // Summer time starts Fri 27 Mar 2026 and ends Sun 25 Oct 2026: still 7 different days, in order.
  for (const d of ['2026-03-27', '2026-10-25']) {
    const days = C.weekModel({ today: d, items: [] }, d).days.map((x) => x.date);
    assert.equal(new Set(days).size, 7);
    assert.deepEqual(days, days.slice().sort());
    assert.ok(days.includes(d));
  }
  assert.equal(C.isIso('2026-02-30'), false);
  assert.equal(C.isIso('2026-11-24'), true);
});

test('A: today is marked, earlier days are past, and the arrows stop at the range the feeds cover', () => {
  const wm = week(TODAY);
  assert.deepEqual(wm.days.filter((x) => x.isToday).map((x) => x.date), [TODAY]);
  assert.deepEqual(wm.days.filter((x) => x.isPast).map((x) => x.date), ['2026-11-22', '2026-11-23']);
  assert.deepEqual([wm.isThisWeek, wm.canPrev, wm.canNext], [true, true, true]);
  const r = C.weekRange(TODAY);
  assert.deepEqual(r, { min: C.addDays('2026-11-22', -7 * C.WEEKS_BACK), max: C.addDays('2026-11-22', 7 * C.WEEKS_AHEAD) });
  const first = week(r.min), last = week(r.max);
  assert.deepEqual([first.canPrev, first.canNext, last.canPrev, last.canNext], [false, true, true, false]);
  assert.equal(week('2020-01-01').weekStart, r.min, 'a week before the range is clamped');
  assert.equal(week('2030-01-01').weekStart, r.max, 'a week after the range is clamped');
  assert.equal(week('garbage').weekStart, '2026-11-22', 'a bad value falls back to this week');
});

/* ===== B. the items ===== */

test('B: every kind is mapped from data the app already holds, on its own day', () => {
  const wm = week(TODAY, Object.assign(C.defaultFilters(), { session: true }));
  assert.deepEqual(titles(wm, '2026-11-22'), ['meeting:דווח']);
  assert.deepEqual(titles(wm, '2026-11-23'), ['meeting:עבר ולא דווח', 'followUp:סוגיה — נועה']);
  assert.deepEqual(titles(wm, '2026-11-24'), ['committee:ועדת המשך · יעל', 'session:ד"ר מטפל']);
  assert.deepEqual(titles(wm, '2026-11-25'), ['meeting:דני כהן', 'meeting:רות לוי', 'followUp:יעל — אמא', 'followUp:מדריך א']);
  assert.deepEqual(titles(wm, '2026-11-26'), ['admission:נכנס חדש', 'feedback:עובדת ותיקה']);
  assert.deepEqual(titles(wm, '2026-11-27'), ['committee:ועדת שחרור · גיל']);
  assert.deepEqual(titles(wm, '2026-11-28'), ['discharge:משתחרר']);
  assert.deepEqual(wm.counts, { meeting: 4, committee: 2, admission: 1, discharge: 1, followUp: 3, feedback: 1, session: 1 });
  assert.equal(wm.total, 13);
});

test('B: timed items first by hour, then all-day ones; a meeting with no hour is all-day', () => {
  const day = week(TODAY).days.find((x) => x.date === '2026-11-25');
  assert.deepEqual(day.items.map((i) => i.time), ['10:00', '', '', '']);
  const d = HOUSE();
  d.committees.items.push({ date: '2026-11-25', time: '08:30', type: 'ועדה מוקדמת', status: 'scheduled' });
  assert.deepEqual(week(TODAY, null, d).days.find((x) => x.date === '2026-11-25').items.slice(0, 2).map((i) => i.title), ['ועדה מוקדמת', 'דני כהן']);
});

test('B: flags — «איתך», waiting for a report, reported, cancelled, overdue, the invitation', () => {
  M.setViewer('אורן');
  const items = collect().items;
  M.setViewer('');
  const by = (title) => items.find((i) => i.title.indexOf(title) === 0);
  assert.equal(by('דני כהן').flags.mine, true);
  assert.equal(by('עבר ולא דווח').flags.mine, false, 'another manager\'s meeting');
  assert.deepEqual([by('עבר ולא דווח').flags.pending, by('דני כהן').flags.pending, by('דווח').flags.pending], [true, false, false]);
  assert.equal(by('דווח').flags.reported, true);
  assert.match(by('דווח').sub, /עם אורן · התקיימה — מתקדם לכניסה/);
  assert.deepEqual([by('דני כהן').flags.invite, by('דני כהן').flags.canAdd, by('עבר ולא דווח').flags.canAdd, by('דווח').flags.canAdd], ['sent', true, false, false]);
  assert.equal(by('ועדת שחרור').flags.cancelled, true);
  assert.equal(by('ועדת שחרור').sub, 'בוטלה');
  assert.equal(by('סוגיה — נועה').flags.overdue, true);
  assert.ok(!items.some((i) => i.title === 'בוצע' || /בוצע/.test(i.title)), 'a follow-up marked done is not an event');
  assert.ok(!items.some((i) => i.title === 'תאריך שבור' || i.title === 'בלי תאריך' || i.title === 'בלי צפי' || i.title === 'שגוי'), 'no item without a real date');
  assert.deepEqual(by('סוגיה — נועה').link, { sub: 'events' });
  assert.deepEqual(by('מדריך א').link, { sub: 'staffTalks' });
  assert.deepEqual(by('עובדת ותיקה').link, { sub: 'team', card: 'wk-feedback' });
});

test('B: the filters hide a kind but keep its count; «טיפולים» starts hidden', () => {
  assert.deepEqual(C.defaultFilters(), { meeting: true, committee: true, admission: true, discharge: true, followUp: true, feedback: true, session: false });
  const def = week(TODAY);
  assert.ok(!def.days.some((x) => x.items.some((i) => i.type === 'session')));
  assert.deepEqual([def.counts.session, def.shown, def.total], [1, 12, 13]);
  const only = week(TODAY, { meeting: true, committee: false, admission: false, discharge: false, followUp: false, feedback: false, session: false });
  assert.equal(only.shown, 4);
  assert.equal(only.counts.committee, 2, 'the chip still says how many are hidden');
  assert.deepEqual(only.days.flatMap((x) => x.items.map((i) => i.type)), ['meeting', 'meeting', 'meeting', 'meeting']);
});

test('B: next week holds next week\'s items only; sessions belong to the current week alone', () => {
  const next = week('2026-11-29', Object.assign(C.defaultFilters(), { session: true }));
  assert.deepEqual(next.days.flatMap((x) => x.items.map((i) => i.title)), ['שבוע הבא']);
  assert.equal(next.isThisWeek, false);
  assert.equal(next.counts.session, 0);
});

/* ===== C. sources that are not available ===== */

test('C: a missing source is named — never an empty day pretending to be the truth', () => {
  const bare = { today: TODAY };
  const col = C.collect(bare, { state: 'not_connected', list: [] });
  assert.deepEqual(Object.keys(col.missing).sort(), ['admission', 'committee', 'discharge', 'feedback', 'meeting', 'session']);
  assert.equal(col.items.length, 0);
  const html = C.tabHtml({ d: bare, meetings: { state: 'not_connected', list: [] } });
  assert.match(html, /class="mt-notice cal-notice"/);
  assert.match(html, /פגישות הקליטה לא מחוברות כרגע/);
  assert.doesNotMatch(html, /לוח המטפלים לא מחובר/, 'a kind that is filtered out does not shout');
  // While the meetings feed is not connected, the house's own visits list fills in — and says so.
  const viaVisits = C.collect(HOUSE(), { state: 'not_connected', list: [] });
  assert.ok(viaVisits.items.some((i) => i.type === 'meeting' && i.title === 'ביקור מהרשימה'));
  assert.match(viaVisits.missing.meeting, /מוצגים הביקורים מרשימת הבית/);
  // Still loading: nothing is declared missing yet.
  assert.equal(C.collect(HOUSE(), { state: 'loading', list: [] }).missing.meeting, undefined);
  // Connected feeds: no notice at all for this week.
  assert.doesNotMatch(C.tabHtml({ d: HOUSE(), meetings: MEETINGS() }), /cal-notice/);
});

test('C: a week beyond what the meetings feed carries says so', () => {
  const far = C.tabHtml({ d: HOUSE(), meetings: MEETINGS(), weekStart: '2026-12-13' });
  assert.match(far, /פגישות קליטה מוצגות עד שבועיים קדימה/);
  assert.match(C.beyondMeetings({ today: TODAY, weekStart: '2026-10-18', weekEnd: '2026-10-24' }), /פגישות קליטה מוצגות עד 30 יום אחורה/);
  assert.equal(C.beyondMeetings({ today: TODAY, weekStart: '2026-10-25', weekEnd: '2026-10-31' }), '', 'exactly 30 days back is still covered');
  assert.equal(C.beyondMeetings(week(TODAY)), '');
  assert.equal(C.beyondMeetings(week('2026-11-29')), '', 'next week is inside the two weeks ahead');
});

/* ===== D. markup ===== */

test('D: loading shows a spinner; no houseData date shows a calm line — never an error page', () => {
  assert.match(C.tabHtml({}), /wk-spin[\s\S]*טוען את היומן/);
  assert.match(C.tabHtml({ d: {} , meetings: MEETINGS() }), /היומן יופיע כשנתוני הבית ייטענו/);
  assert.equal(C.homeLineHtml({}), '');
});

test('D: the tab — arrows, the range, a chip per kind with its count, 7 days, today marked, empty days said', () => {
  const html = C.tabHtml({ d: HOUSE(), meetings: MEETINGS() });
  assert.match(html, /data-cal-nav="-1">→ שבוע קודם</);
  assert.match(html, /data-cal-nav="0" aria-pressed="true">השבוע</);
  assert.match(html, /data-cal-nav="1">שבוע הבא ←</);
  assert.match(html, /22\/11 – 28\/11\/2026 · 12 אירועים/);
  for (const t of C.TYPE_ORDER) assert.match(html, new RegExp('data-cal-filter="' + t + '" aria-pressed="' + (t === 'session' ? 'false' : 'true') + '"'));
  assert.match(html, /פגישות קליטה <span class="cal-count">\(4\)<\/span>/);
  assert.equal(html.split('<section class="cal-day').length - 1, 7);
  assert.equal(html.split('data-cal-today').length - 1, 1);
  assert.match(html, /cal-day is-today" data-cal-today><h3 class="cal-day-head">יום שלישי <span class="cal-date">24\/11<\/span> <span class="crm-chip ok">היום<\/span>/);
  const empty = C.tabHtml({ d: { today: TODAY, expectedAdmissions: [], expectedDischargeSupported: true }, meetings: { state: 'ok', list: [] } });
  assert.equal(empty.split('אין אירועים').length - 1, 7);
  // The edge of the range disables the arrow.
  assert.match(C.tabHtml({ d: HOUSE(), meetings: MEETINGS(), weekStart: C.weekRange(TODAY).max }), /data-cal-nav="1" disabled>/);
});

test('D: an item names its kind in words, opens its tab, and shows its chips', () => {
  M.setViewer('אורן');
  const html = C.tabHtml({ d: HOUSE(), meetings: MEETINGS() });
  M.setViewer('');
  assert.match(html, /<li class="cal-item cal-meeting"><button type="button" class="cal-go" data-go-sub="meetings" aria-label="פגישת קליטה: דני כהן — לפתיחה"><span class="cal-time">10:00<\/span>/);
  assert.match(html, /<span class="cal-kind"><span aria-hidden="true">🤝<\/span> פגישת קליטה<\/span><span class="cal-title">דני כהן<\/span>/);
  assert.match(html, /cal-item cal-meeting is-pending[\s\S]*?crm-chip bad">ממתינה לדיווח/);
  assert.match(html, /crm-chip ok">איתך/);
  assert.match(html, /crm-chip ok cal-invited">📅 נשלח זימון ליומן במייל/);
  assert.equal(html.split('נשלח זימון').length - 1, 1, 'said once, beside «הוספה ליומן»');
  // A meeting with an invitation but no «הוספה ליומן» row (no hour) keeps the short chip.
  const noHour = C.itemHtml({ type: 'meeting', date: TODAY, time: '', title: 'א', sub: '', link: { sub: 'meetings' }, flags: { invite: 'sent', canAdd: true }, raw: { id: 'X', visitDate: TODAY, visitTime: '' } });
  assert.match(noHour, /crm-chip ok">📅 נשלח זימון<\/span>/);
  assert.match(html, /cal-item cal-committee is-cancelled/);
  assert.match(html, /data-go-sub="team" data-go-card="wk-feedback"/);
  assert.match(html, /data-go-sub="staffTalks"/);
  assert.match(html, /<span class="cal-time">כל היום<\/span>/);
});

test('D: every feed value is escaped', () => {
  const d = HOUSE();
  d.committees.items = [{ date: TODAY, time: '10:00', type: '<img src=x onerror=1>', patientName: '"><script>', status: 'scheduled' }];
  d.expectedAdmissions = [{ name: '<b>שם</b>', date: TODAY, stage: 'paid' }];
  const m = { state: 'ok', list: [{ id: '"><x', name: '<i>ליד</i>', houseLabel: '<h>', visitDate: '2026-11-25', visitTime: '10:00', meetingWith: '<u>מי</u>', report: null }] };
  const html = C.tabHtml({ d, meetings: m });
  assert.doesNotMatch(html, /<img|<script|<b>|<i>|<u>|<h>|"><x/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /data-cal-ics="&quot;&gt;&lt;x"/);
});

test('D: «הבית היום» gets ONE line that opens the calendar', () => {
  const line = C.homeLineHtml({ d: HOUSE(), meetings: MEETINGS() });
  assert.match(line, /^<button type="button" class="mt-alert cal-home" data-go-sub="calendar">📅 השבוע: 12 אירועים · היום 1 — ליומן ←<\/button>$/);
  const one = C.homeLineHtml({ d: { today: TODAY, expectedAdmissions: [{ name: 'א', date: '2026-11-27' }], expectedDischargeSupported: true }, meetings: { state: 'ok', list: [] } });
  assert.match(one, /השבוע: אירוע אחד — ליומן/);
});

/* ===== E. «הוספה ליומן» ===== */

const MEET = { id: 'L1', name: 'דני כהן-סודי', houseLabel: 'רמות השבים', visitDate: '2026-11-25', visitTime: '10:00', meetingWith: 'אורן', officeNote: 'רקע רגיש 0501234567', phone: '0529999999' };

test('E: the Google link — local times with ctz, the house in the title, the FIRST name only', () => {
  const url = C.googleUrl(MEET);
  assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&'));
  const q = new URL(url).searchParams;
  assert.equal(q.get('text'), 'פגישת קליטה · E-ZONE רמות השבים');
  assert.equal(q.get('dates'), '20261125T100000/20261125T110000');
  assert.equal(q.get('ctz'), 'Asia/Jerusalem');
  assert.equal(q.get('location'), 'E-ZONE רמות השבים');
  assert.equal(q.get('details'), 'פגישת קליטה עם דני.\nהפרטים המלאים באפליקציית המנהלים.');
  const all = decodeURIComponent(url);
  for (const bad of ['כהן', 'סודי', 'רקע רגיש', '0501234567', '0529999999', 'אורן']) assert.ok(!all.includes(bad), bad);
  assert.equal(C.localStamp('2026-11-25', '23:30', 60), '20261126T003000', 'the end crosses midnight');
  assert.equal(C.googleUrl(Object.assign({}, MEET, { visitTime: '' })), '', 'no hour → no link');
  assert.equal(C.googleUrl(Object.assign({}, MEET, { visitDate: '2026-02-30' })), '');
  assert.equal(C.firstName('  דני   <כהן> '), 'דני');
  assert.ok(!/[<>]/.test(C.firstName('<דני>')), 'angle brackets never survive');
  assert.equal(C.firstName('דני'), 'דני');
  assert.equal(C.firstName(''), '');
});

test('E: the .ics file — CRLF, folded at 75 octets, the Dashboard invitation\'s UID, local time with its zone', () => {
  const text = C.icsText(MEET, '20261121T080000Z');
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n') && text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(text));
  text.split('\r\n').forEach((ln) => assert.ok(Buffer.byteLength(ln, 'utf8') <= 75, ln));
  const flat = text.replace(/\r\n /g, '');
  assert.ok(flat.includes('UID:ezone-meeting-L1@ezone-dashboard\r\n'), 'the same entry as the mailed invitation, never a second one');
  assert.ok(flat.includes('DTSTART;TZID=Asia/Jerusalem:20261125T100000\r\n') && flat.includes('DTEND;TZID=Asia/Jerusalem:20261125T110000\r\n'));
  assert.ok(flat.includes('BEGIN:VTIMEZONE\r\nTZID:Asia/Jerusalem\r\n'));
  assert.ok(flat.includes('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU') && flat.includes('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23,24,25,26,27,28,29;BYDAY=FR'));
  assert.ok(flat.includes('SUMMARY:פגישת קליטה · E-ZONE רמות השבים\r\n'));
  assert.ok(flat.includes('DESCRIPTION:פגישת קליטה עם דני.\\nהפרטים המלאים באפליקציית המנהלים.\r\n'));
  assert.ok(flat.includes('DTSTAMP:20261121T080000Z') && flat.includes('TRIGGER:-PT60M') && flat.includes('METHOD:PUBLISH'));
  for (const bad of ['כהן', 'סודי', 'רקע רגיש', '0501234567', '0529999999', 'ATTENDEE', 'ORGANIZER', '@example']) assert.ok(!flat.includes(bad), bad);
  assert.ok(C.icsText(Object.assign({}, MEET, { houseLabel: 'בית; עם, פסיק' })).replace(/\r\n /g, '').includes('LOCATION:E-ZONE בית\\; עם\\, פסיק'));
  assert.ok(C.icsText(Object.assign({}, MEET, { id: '../<x>' })).includes('UID:ezone-meeting-x@ezone-dashboard'));
  assert.equal(C.icsText(Object.assign({}, MEET, { visitTime: '25:00' })), '');
  assert.equal(C.icsFileName(MEET), 'ezone-meeting-2026-11-25.ics');
});

test('E: the VTIMEZONE rule matches the real clock changes of the coming years', () => {
  // Israel: summer time from the Friday before the last Sunday of March to the last Sunday of October.
  const offsetAt = (iso) => {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso + 'T12:00:00Z')).forEach((x) => { p[x.type] = x.value; });
    return Number(p.hour) - 12;
  };
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    let lastSunMar = 31; while (new Date(Date.UTC(y, 2, lastSunMar)).getUTCDay() !== 0) lastSunMar--;
    let lastSunOct = 31; while (new Date(Date.UTC(y, 9, lastSunOct)).getUTCDay() !== 0) lastSunOct--;
    const fri = lastSunMar - 2;
    assert.ok(fri >= 23 && fri <= 29, 'the Friday is inside BYMONTHDAY=23..29');
    const iso = (m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    assert.deepEqual([offsetAt(iso(3, fri - 1)), offsetAt(iso(3, fri))], [2, 3], 'summer time starts on that Friday, ' + y);
    assert.deepEqual([offsetAt(iso(10, lastSunOct - 1)), offsetAt(iso(10, lastSunOct))], [3, 2], 'and ends on the last Sunday of October, ' + y);
  }
});

test('E: the buttons — only for a coming meeting with an hour; «נשלח זימון» when the Dashboard mailed it', () => {
  const sent = C.addHtml(Object.assign({}, MEET, { invite: 'sent' }));
  assert.match(sent, /crm-chip ok cal-invited">📅 נשלח זימון ליומן במייל/);
  assert.match(sent, /<a class="wk-link cal-add-g" href="https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&amp;text=[^"]+" target="_blank" rel="noopener" data-cal-open>📅 הוספה ליומן Google<\/a>/);
  assert.match(sent, /data-cal-ics="L1">קובץ ליומן/);
  assert.doesNotMatch(C.addHtml(MEET), /cal-invited/);
  assert.doesNotMatch(C.addHtml(Object.assign({}, MEET, { invite: 'pending' })), /cal-invited/);
  assert.equal(C.addHtml(Object.assign({}, MEET, { visitTime: '' })), '');
  const html = C.tabHtml({ d: HOUSE(), meetings: MEETINGS() });
  assert.equal(html.split('data-cal-ics=').length - 1, 1, 'L1 only: L2 has no hour, L3 is past, L4 is reported');
  assert.match(pub('meetings.js'), /if \(kind === 'upcoming' && !m\.report && root\.CalendarView\) h \+= root\.CalendarView\.addHtml\(m\);/);
});

/* ===== F. wiring ===== */

test('F: the tab sits right after «הבית היום», has its own colour, panel and script; the SW ships it', () => {
  const html = pub('index.html');
  assert.match(html, /data-sub="home"[^>]*>🏠 הבית היום<\/button>\s*<!--[^>]*-->\s*<button type="button" class="subtab" data-sub="calendar" role="tab" aria-selected="false">📅 יומן<\/button>/);
  assert.match(html, /<section data-sub-panel="calendar" hidden><\/section>/);
  assert.match(html, /<div data-dash-calendar><\/div>/);
  const i = (s) => html.indexOf(`<script src="${s}">`);
  assert.ok(i('/work.js') > 0 && i('/work.js') < i('/meetings.js') && i('/meetings.js') < i('/calendar.js') && i('/calendar.js') < i('/app.js'));
  const css = pub('styles.css');
  assert.match(css, /\.subtab\[data-sub="calendar"\]\s*\{ --tab: var\(--c-orange\); \}/);
  assert.match(css, /\[data-sub-panel="calendar"\]\s*\{ --sec: var\(--c-orange\); \}/);
  assert.match(css, /@media \(min-width: 1100px\) \{\s*\.cal-week \{ grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  const sw = pub('sw.js');
  assert.match(sw, /ezone-managers-v(5[3-9]|[6-9]\d)'/, 'v53 («יומן») and monotonic after');
  assert.match(sw, /'\/calendar\.js'/);
});

test('F: the new tab colour is AA — white on the active tab, a dark title shade on white', () => {
  const css = pub('styles.css');
  const hex = /--c-orange: (#[0-9A-Fa-f]{6})/.exec(css)[1];
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mixBlack = (h, w) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * w).toString(16).padStart(2, '0')).join('');
  assert.ok(ratio('#FFFFFF', hex) >= 4.5, 'white on --c-orange: ' + ratio('#FFFFFF', hex).toFixed(2));
  assert.ok(ratio(mixBlack(hex, 0.8), '#FFFFFF') >= 4.5);
});

test('F: work.js and meetings.js hand the calendar what they already loaded — and it asks the server for nothing', () => {
  const w = pub('work.js'), m = pub('meetings.js'), c = pub('calendar.js');
  assert.match(w, /if \(root\.Calendar\) root\.Calendar\.onHouse\(panel, key, d\);/);
  assert.match(w, /if \(sub === 'calendar' && root\.Calendar\) root\.Calendar\.repaint\(panel, panel\.getAttribute\('data-house-key'\), true\);/);
  assert.match(m, /if \(root\.Calendar && root\.Calendar\.repaint\) root\.Calendar\.repaint\(panel, key, false\);/);
  assert.doesNotMatch(c, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie/, 'no request and nothing stored on the device');
  assert.doesNotMatch(c, /innerHTML = [^;]*\+\s*(?!tabHtml|homeLineHtml)/, 'only the escaped builders reach innerHTML');
  assert.match(c, /if \(!\/\^https:\\\/\\\/calendar\\\.google\\\.com\\\/\/\.test\(url\)\) return;/, 'the only outside link it opens is Google Calendar');
  // The server is untouched: no new route, op or env var for the calendar.
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /calendar/i);
});
