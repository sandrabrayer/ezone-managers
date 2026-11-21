'use strict';
/* «פגישות קליטה» — intake meetings + the report form (19 Nov 2026, docs/meeting-reports.md).
 *   A. proxy: ops meetings / meetingReport — 401 without a session, the house from the session
 *      (a manager can never name another house), shape checks never forwarded, the reporter never
 *      taken from the browser, the write bucket, the house's cached reads dropped after a report;
 *   B. views: waiting / coming / reported, the badge, «לא מחובר», the home card, the form steps,
 *      everything escaped;
 *   C. the draft rules and the payload (mirror the Dashboard's);
 *   D. the WhatsApp text — byte-identical to the Dashboard's /meeting-report message;
 *   E. wiring (template, scripts, SW, work.js hooks). */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../public/meetings.js');
const { app, _rateLimiters } = require('../server');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

async function boot(t, reply) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const out = typeof reply === 'function' ? reply(body) : { ok: true };
    return { status: 200, text: async () => JSON.stringify(out), headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear();
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });
  return { calls, send, server };
}
const GOOD = { op: 'meetingReport', leadId: 'L1', outcome: 'advancing', notHeldReason: '', proposedDate: '', companion: 'mother', note: 'שיחה', submissionId: 'sub-0123456789abcdef' };

test('A: 401 without a session; a manager is pinned to their own house; an admin names one; the reporter is the session', async (t) => {
  const { calls, send, server } = await boot(t, (b) => (b.op === 'meetings'
    ? { ok: true, house: b.house, today: '2026-11-19', meetings: [] }
    : { ok: true, saved: { leadId: b.leadId, reporter: b.actor, outcome: b.outcome } }));
  assert.equal((await send(null, { op: 'meetings' })).status, 401);
  assert.equal((await send(null, GOOD)).status, 401);
  assert.equal(calls.length, 0, 'nothing forwarded without a session');
  const oran = await auth.login(server, auth.ORAN_CODE);
  const sandra = await auth.login(server, auth.ADMIN_CODE);

  const r = await send(oran, { op: 'meetings', house: 'efroni', actor: 'forged', actorId: 'forged' });
  assert.equal(r.status, 200);
  assert.deepEqual([calls[0].op, calls[0].house, calls[0].actor, calls[0].actorId, calls[0].role], ['meetings', 'ramot', 'אורן', 'person-oran', 'manager']);
  assert.equal(r.headers['cache-control'] && /no-store|private/.test(r.headers['cache-control']), true);

  const a = await send(sandra, { op: 'meetings', house: 'efroni' });
  assert.equal(a.status, 200);
  assert.equal(calls[calls.length - 1].house, 'efroni');
  assert.equal((await send(sandra, { op: 'meetings', house: 'nowhere' })).status, 403);

  calls.length = 0;
  const w = await send(oran, { ...GOOD, house: 'efroni', reporter: 'forged', actor: 'forged' });
  assert.equal(w.status, 200);
  const c = calls[0];
  assert.deepEqual([c.op, c.house, c.actor, c.actorId, c.reporter, c.secret === process.env.MANAGERS_WORK_SECRET],
    ['meetingReport', 'ramot', 'אורן', 'person-oran', undefined, true], 'house + reporter from the session only; the secret is added server-side');
  assert.deepEqual([c.leadId, c.outcome, c.notHeldReason, c.proposedDate, c.companion, c.note, c.submissionId],
    ['L1', 'advancing', '', '', 'mother', 'שיחה', 'sub-0123456789abcdef']);
  assert.equal(JSON.parse(w.text).saved.reporter, 'אורן');
});

test('A: meetingReport shape checks — refused here, never forwarded', async (t) => {
  const { calls, send, server } = await boot(t);
  const oran = await auth.login(server, auth.ORAN_CODE);
  const bad = [
    [{ leadId: '' }, 'bad_lead'], [{ leadId: 'x'.repeat(101) }, 'bad_lead'], [{ leadId: 'a\nb' }, 'bad_lead'],
    [{ leadId: 42 }, 'bad_request'], [{ outcome: 'entered' }, 'bad_outcome'],
    [{ notHeldReason: 'no_show' }, 'bad_reason'], [{ proposedDate: '2026-12-01' }, 'bad_reason'],
    [{ outcome: 'no_show', notHeldReason: '' }, 'bad_reason'], [{ outcome: 'no_show', notHeldReason: 'x'.repeat(101) }, 'bad_reason'],
    [{ outcome: 'no_show', notHeldReason: 'postponed', proposedDate: '1/12/2026' }, 'bad_proposed_date'],
    [{ companion: 'x'.repeat(101) }, 'bad_companion'], [{ note: 'x'.repeat(5001) }, 'bad_note'], [{ note: { a: 1 } }, 'bad_request']
  ];
  for (const [over, code] of bad) {
    const x = await send(oran, { ...GOOD, ...over });
    assert.deepEqual([x.status, JSON.parse(x.text).error], [400, code], JSON.stringify(over));
  }
  assert.equal(calls.length, 0, 'never forwarded');
  // A bad submissionId is dropped, not refused (the Dashboard then simply does not replay).
  await send(oran, { ...GOOD, submissionId: 'nope' });
  assert.equal(calls[0].submissionId, undefined);
  // A not-held report with a reason and a date is fine.
  await send(oran, { ...GOOD, outcome: 'no_show', notHeldReason: ' postponed ', proposedDate: '2026-12-01', companion: '' });
  assert.deepEqual([calls[1].notHeldReason, calls[1].proposedDate], ['postponed', '2026-12-01']);
});

test('A: a report drops the house\'s cached reads, so the list is fresh at once', async (t) => {
  let n = 0;
  const { send, server } = await boot(t, (b) => (b.op === 'meetings' ? { ok: true, house: b.house, today: '2026-11-19', meetings: [], n: ++n } : { ok: true, saved: { leadId: b.leadId } }));
  const oran = await auth.login(server, auth.ORAN_CODE);
  const first = JSON.parse((await send(oran, { op: 'meetings' })).text).n;
  const cached = JSON.parse((await send(oran, { op: 'meetings' })).text).n;
  assert.equal(cached, first, 'a second read inside the cache window is the cached copy');
  await send(oran, GOOD);
  const after = JSON.parse((await send(oran, { op: 'meetings' })).text).n;
  assert.ok(after > first, 'after a report the next read is live');
});

/* ===== B. views ===== */

const RES = {
  today: '2026-11-19',
  meetings: [
    { id: 'L1', name: 'דני <b>', house: 'ramot', houseLabel: 'רמות השבים', visitDate: '2026-11-17', visitTime: '10:00', meetingWith: 'אורן', officeNote: 'רקע <i>מהמשרד</i>', report: null },
    { id: 'L2', name: 'רות', house: 'efroni', houseLabel: 'קיסריה עפרוני', visitDate: '2026-11-19', visitTime: '12:30', meetingWith: 'אורן', officeNote: '', report: null },
    { id: 'L3', name: 'יוסי', house: 'ramot', houseLabel: 'רמות השבים', visitDate: '2026-11-23', visitTime: '', meetingWith: 'אורן', officeNote: '', report: null },
    { id: 'L4', name: 'גל', house: 'ramot', houseLabel: 'רמות השבים', visitDate: '2026-11-10', visitTime: '09:00', meetingWith: 'אורן', officeNote: '',
      report: { outcome: 'no_show', notHeldReason: 'postponed', proposedDate: '2026-12-01', companion: '', note: 'נדחה <x>', reporter: 'אורן', reportedAt: '2026-11-10T10:00:00Z', via: 'app' } },
    { id: 'L5', name: 'בלי תאריך', visitDate: '', report: null }
  ]
};
const ST = (over) => Object.assign({ res: RES, today: '2026-11-19', open: null, draft: null }, over);

test('B: waiting = past and unreported; coming = today on; reported apart; the badge counts the waiting', () => {
  const m = M.model(RES, '2026-11-19');
  assert.deepEqual(m.pending.map((x) => x.id), ['L1']);
  assert.deepEqual(m.upcoming.map((x) => x.id), ['L2', 'L3']);
  assert.deepEqual(m.reported.map((x) => x.id), ['L4']);
  assert.equal(M.badgeCount(RES, '2026-11-19'), 1);
  assert.equal(m.all.length, 4, 'a row without a visit date is dropped');
});

test('B: the tab — three sections, every value escaped, the report summary with its reason', () => {
  const h = M.tabHtml(ST());
  assert.match(h, /ממתינות לדיווח \(1\)/);
  assert.match(h, /קרובות \(2\)/);
  assert.match(h, /<details class="card work-card mt-fold mt-reported" data-mt-fold><summary class="card-title">דווחו \(1\) ▾<\/summary>/);
  assert.match(h, /דני &lt;b&gt;/);
  assert.match(h, /רקע &lt;i&gt;מהמשרד&lt;\/i&gt;/);
  assert.match(h, /לא הגיע \/ בוטל — נדחתה · מועד חדש מוצע 1\/12\/26/);
  assert.match(h, /נדחה &lt;x&gt;/);
  assert.doesNotMatch(h, /<b>|<i>|<x>/, 'no feed text becomes markup');
  assert.match(h, /data-mt-report="L1">דיווח על הפגישה</);
  assert.match(h, /data-mt-report="L4">עריכת דיווח</);
});

test('B: loading, «לא מחובר» (an older Dashboard), and a real error with «נסו שוב»', () => {
  assert.match(M.tabHtml({ res: null }), /טוען את הפגישות/);
  for (const code of ['unknown_op', 'unauthorized', 'not_configured']) {
    assert.match(M.tabHtml({ res: { error: code } }), /לא מחובר — הפגישות יופיעו כאן אחרי עדכון הדשבורד/, code);
  }
  assert.match(M.tabHtml({ res: { error: 'timeout' } }), /data-mt-retry/);
  assert.equal(M.homeCardHtml({ res: { error: 'unknown_op' } }), '', 'the home card stays out until connected');
});

test('B: the home card — the waiting count links to the tab; TODAY\'s meetings; the rest of the week is one link to «יומן»', () => {
  const h = M.homeCardHtml(ST());
  assert.match(h, /פגישה אחת ממתינה לדיווח/);
  assert.match(h, /data-go-sub="meetings"/);
  assert.match(h, /רות<\/span><span class="wk-meta">היום · 12:30/);
  // 21 Nov 2026 (docs/week-calendar.md): a later day of the week is listed once, in «יומן».
  assert.doesNotMatch(h, /יוסי/);
  assert.match(h, /data-go-sub="calendar">עוד פגישה אחת השבוע — ביומן ←/);
  assert.doesNotMatch(h, /גל/, 'a reported meeting is not on the home card');
});

test('B: «זימון» — a meeting scheduled WITH the logged-in manager is highlighted (CHANGELOG Unreleased)', () => {
  // default (no viewer, e.g. an admin): no personal highlight anywhere
  assert.doesNotMatch(M.homeCardHtml(ST()), /mt-invite|נקבעה פגישה איתך/);
  assert.doesNotMatch(M.tabHtml(ST()), /mt-mine/);
  // match is by the manager's display name, normalised (NFC, trim, collapse, case-fold)
  M.setViewer('  אורן ');
  assert.equal(M.scheduledWithViewer({ meetingWith: 'אורן' }), true);
  assert.equal(M.scheduledWithViewer({ meetingWith: 'שחר' }), false);
  assert.equal(M.scheduledWithViewer({ meetingWith: '' }), false);
  // the home card leads with the «זימון» block for the two upcoming meetings with אורן (L2, L3)
  const home = M.homeCardHtml(ST());
  assert.match(home, /mt-invite/);
  assert.match(home, /נקבעו 2 פגישות איתך/);
  assert.match(home, /רות/); assert.match(home, /יוסי/);
  assert.ok(home.indexOf('mt-invite') < home.indexOf('mt-alert'), 'the personal «זימון» comes before the waiting alert');
  // the full meetings list marks each of this manager's rows «איתך»
  assert.match(M.tabHtml(ST()), /crm-chip ok mt-mine">איתך/);
  // cleared (admin / logout): no highlight again — no leakage across sessions
  M.setViewer('');
  assert.equal(M.scheduledWithViewer({ meetingWith: 'אורן' }), false);
  assert.doesNotMatch(M.homeCardHtml(ST()), /mt-invite/);
  // app.js hands the logged-in manager's name to the view (admins get none)
  assert.match(pub('app.js'), /window\.MeetingsView\.setViewer\(u && u\.role !== 'admin' \? u\.name : ''\)/);
  assert.match(pub('styles.css'), /\.mt-home \.mt-invite \{/);
});

test('B: the form — yes/no first; «כן» asks the result + who came; «לא» asks why (+ date for נדחתה)', () => {
  const m = RES.meetings[0];
  const f0 = M.formHtml(m, {}, ST());
  assert.match(f0, /האם הפגישה התקיימה\?/);
  assert.doesNotMatch(f0, /data-mt-submit/, 'no save before yes/no');
  const yes = M.formHtml(m, { held: 'yes', outcome: 'undecided', companion: 'other', companionOther: '<סבתא>' }, ST());
  assert.match(yes, /מה התוצאה\?/);
  assert.match(yes, /data-mt-outcome="undecided" aria-pressed="true">מתלבט/);
  assert.match(yes, /value="&lt;סבתא&gt;"/);
  assert.doesNotMatch(yes, /data-mt-reason/);
  const no = M.formHtml(m, { held: 'no', reason: 'postponed', proposedDate: '2026-12-01', note: 'א'.repeat(4600) }, ST());
  assert.match(no, /למה הפגישה לא התקיימה\?/);
  assert.match(no, /type="date" name="proposedDate" min="2026-11-19" value="2026-12-01"/);
  assert.match(no, /class="mt-count warn"/);
  assert.doesNotMatch(no, /data-mt-companion/);
  const busy = M.formHtml(m, { held: 'yes', outcome: 'advancing' }, ST({ saving: true, error: 'שגיאה <x>' }));
  assert.match(busy, /data-mt-submit disabled aria-busy="true"><span class="wk-spin" aria-hidden="true"><\/span>שומר…/);
  assert.match(busy, /שגיאה &lt;x&gt;/);
});

/* ===== C. draft rules + payload ===== */

test('C: the draft rules mirror the Dashboard', () => {
  const T = '2026-11-19';
  assert.match(M.draftError({}, T), /התקיימה/);
  assert.match(M.draftError({ held: 'yes' }, T), /התוצאה/);
  assert.match(M.draftError({ held: 'no' }, T), /למה/);
  assert.match(M.draftError({ held: 'no', reason: 'postponed', proposedDate: '2026-11-01' }, T), /עבר/);
  assert.match(M.draftError({ held: 'no', reason: 'other', reasonOther: 'x'.repeat(101) }, T), /ארוכה/);
  assert.match(M.draftError({ held: 'yes', outcome: 'advancing', note: 'x'.repeat(5001) }, T), /5000/);
  assert.equal(M.draftError({ held: 'yes', outcome: 'advancing' }, T), '');
  assert.equal(M.draftError({ held: 'no', reason: 'postponed' }, T), '', 'the date is optional');
});

test('C: the payload — held → outcome + companion, no reason; not held → no_show + reason (+ date), no companion', () => {
  const m = { id: 'L1' };
  assert.deepEqual(M.payloadOf(m, { held: 'yes', outcome: 'not_fit', companion: 'other', companionOther: ' סבתא ', note: ' x ', submissionId: 'sub-1' }),
    { op: 'meetingReport', leadId: 'L1', outcome: 'not_fit', notHeldReason: '', proposedDate: '', companion: 'סבתא', note: 'x', submissionId: 'sub-1' });
  assert.deepEqual(M.payloadOf(m, { held: 'no', reason: 'postponed', proposedDate: '2026-12-01', companion: 'mother', note: '' }),
    { op: 'meetingReport', leadId: 'L1', outcome: 'no_show', notHeldReason: 'postponed', proposedDate: '2026-12-01', companion: '', note: '', submissionId: '' });
  assert.equal(M.payloadOf(m, { held: 'no', reason: 'cancelled_us', proposedDate: '2026-12-01' }).proposedDate, '', 'a date only with נדחתה');
  assert.equal(M.payloadOf(m, { held: 'no', reason: 'other', reasonOther: '' }).notHeldReason, 'other');
  for (const code of ['bad_reason', 'lead_not_found', 'unknown_op', 'lock_busy']) assert.ok(M.ERRORS[code], code);
  assert.match(M.errorText('weird'), /לא נשמר/);
});

/* ===== D. WhatsApp — the Dashboard's text, byte for byte ===== */

test('D: the WhatsApp message equals the /meeting-report message (fixtures from E-Zone-Dashboard meeting-report.js)', () => {
  assert.equal(M.waMessage({ name: 'רות', houseLabel: 'קיסריה עפרוני', outcome: 'no_show', companion: '', note: '', reporter: 'חנן', notHeldReason: 'postponed', proposedDate: '2026-12-01' }),
    'יומן ביקורים ודיווח סטטוס — E-Zone\nליד: רות (קיסריה עפרוני)\nתוצאה: לא הגיע / בוטל\nסיבה: נדחתה · מועד חדש מוצע: 01/12/2026\nהגיע/ה עם: \nפירוט: \nדווח ע"י: חנן');
  assert.equal(M.waMessage({ name: 'דני', houseLabel: 'רמות השבים', outcome: 'advancing', companion: 'mother', note: 'שיחה', reporter: 'אורן' }),
    'יומן ביקורים ודיווח סטטוס — E-Zone\nליד: דני (רמות השבים)\nתוצאה: התקיימה — מתקדם לכניסה\nהגיע/ה עם: אמא\nפירוט: שיחה\nדווח ע"י: אורן');
});

test('D: a 5,000-char Hebrew note fits; the reason line and «דווח ע"י» always survive', () => {
  const s = { name: 'יוסי', houseLabel: 'רמות השבים', outcome: 'no_show', companion: '', note: 'ש'.repeat(5000), reporter: 'אורן', notHeldReason: 'cancelled_family' };
  const msg = M.waShareMessage(s);
  assert.ok(msg.includes('סיבה: בוטלה ע"י הפונה/המשפחה'));
  assert.ok(msg.endsWith('דווח ע"י: אורן'));
  assert.ok(M.waShareUrl(s).length <= M.WA_URL_MAX);
  assert.ok(M.waShareUrl(s).startsWith('https://wa.me/?text='));
});

test('D: the labels are the Dashboard\'s', () => {
  assert.deepEqual(M.NOT_HELD_LABELS, { no_show: 'לא הגיעו', postponed: 'נדחתה', cancelled_family: 'בוטלה ע"י הפונה/המשפחה', cancelled_us: 'בוטלה על ידינו', other: 'אחר' });
  assert.deepEqual(M.OUTCOME_LABELS, { advancing: 'התקיימה — מתקדם לכניסה', undecided: 'התקיימה — מתלבט', not_fit: 'התקיימה — לא מתאים', no_show: 'לא הגיע / בוטל' });
});

/* ===== E. wiring ===== */

test('E: template, scripts, service worker, work.js hooks, no device storage', () => {
  const html = pub('index.html');
  assert.match(html, /data-sub="meetings" role="tab" aria-selected="false">🤝 פגישות קליטה <span class="mt-badge" data-mt-badge hidden><\/span>/);
  assert.match(html, /<section data-sub-panel="meetings" hidden><\/section>/);
  assert.match(html, /<div data-dash-meetings><\/div>/);
  assert.ok(html.indexOf('/work.js') < html.indexOf('/meetings.js') && html.indexOf('/meetings.js') < html.indexOf('/app.js'));
  const sw = pub('sw.js');
  assert.match(sw, /'\/meetings\.js'/);
  const work = pub('work.js');
  assert.match(work, /sub === 'meetings' && root\.Meetings\) root\.Meetings\.onHouse\(panel, panel\.getAttribute\('data-house-key'\), true\)/);
  assert.match(work, /if \(root\.Meetings\) root\.Meetings\.onHouse\(panel, key, false\)/);
  const js = pub('meetings.js');
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(js, /\.innerHTML\s*=\s*[^;]*\b(m|r|res)\.(name|note|officeNote)/, 'feed text only via esc()');
  const css = pub('styles.css');
  assert.match(css, /\.subtab\[data-sub="meetings"\]\s*\{ --tab: var\(--c-cyan\); \}/);
});
