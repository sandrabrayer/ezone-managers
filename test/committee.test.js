'use strict';
/* Committee date per patient «ועדה» (15 Oct 2026; docs/committee.md):
 *   A. proxy /api/work op committeeSet — session, house pinned, shape checks;
 *   B. the «מטופלים בבית» second line + form (escaped, min date, 60-char label);
 *   C. the save flow — spinner, error reasons, concurrency, past-date warning;
 *   D. alerts — shared fixture (today / +7 / +8 / -1, Israel midnight), house
 *      isolation, admin filter, text-only rendering, badge;
 *   E. wiring + bonus untouched.
 * Dummy env values; global.fetch is MOCKED. */
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

test('A: proxy op committeeSet', async (t) => {
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
  t.beforeEach(() => { calls = []; _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear(); });
  const OK = { op: 'committeeSet', patientName: 'דנה', entryDate: '2026-09-01', committeeDate: '2026-10-20', label: ' ועדת השמה ', previousDate: '', previousLabel: '' };
  const send = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });

  await t.test('no session → 401, nothing proxied', async () => {
    assert.equal((await send(null, OK)).status, 401);
    assert.equal(calls.length, 0);
  });

  await t.test('a manager is pinned to their own house; role / actor / secret from the server only', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const r = await send(cookie, { ...OK, house: 'efroni', role: 'admin', actorId: 'person-sandra', secret: 'x', editedBy: 'forged' });
    assert.equal(r.status, 200);
    const b = calls[0];
    assert.deepEqual([b.action, b.op, b.house, b.role, b.actor, b.actorId, b.secret],
      ['managersWork', 'committeeSet', 'ramot', 'manager', 'אורן', 'person-oran', process.env.MANAGERS_WORK_SECRET]);
    assert.deepEqual([b.patientName, b.entryDate, b.committeeDate, b.label, b.previousDate, b.previousLabel, b.mode, b.correction],
      ['דנה', '2026-09-01', '2026-10-20', 'ועדת השמה', '', '', undefined, undefined]);
    assert.equal(b.editedBy, undefined, 'unknown fields are not forwarded');
  });

  await t.test('an admin names any house; another house manager stays in their own', async () => {
    const admin = await auth.login(server, auth.ADMIN_CODE);
    await send(admin, { ...OK, house: 'pardes' });
    assert.deepEqual([calls[0].house, calls[0].role], ['pardes', 'admin']);
    const hanan = await auth.login(server, auth.HANAN_CODE);
    await send(hanan, { ...OK, house: 'ramot' });
    assert.equal(calls[1].house, 'efroni');
  });

  await t.test('clear and correction are forwarded; a clear never carries a date or a label', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    await send(cookie, { ...OK, mode: 'clear', committeeDate: '', previousDate: '2026-10-20', previousLabel: 'א' });
    assert.deepEqual([calls[0].mode, calls[0].committeeDate, calls[0].label, calls[0].previousDate, calls[0].previousLabel], ['clear', '', '', '2026-10-20', 'א']);
    await send(cookie, { ...OK, committeeDate: '2026-10-10', previousDate: '2026-10-20', correction: true });
    assert.equal(calls[1].correction, true);
  });

  await t.test('shape checks → 400, nothing proxied', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const bad = [
      [{ ...OK, mode: 'none' }, 'bad_request'],
      [{ ...OK, committeeDate: '20/10/26' }, 'bad_date'],
      [{ ...OK, committeeDate: '' }, 'bad_date'],
      [{ ...OK, mode: 'clear', committeeDate: '2026-10-20' }, 'bad_date'],
      [{ ...OK, previousDate: 'x' }, 'bad_date'],
      [{ ...OK, entryDate: '' }, 'bad_date'],
      [{ ...OK, committeeDate: '2026-08-31' }, 'before_admission'],
      [{ ...OK, label: 'א'.repeat(61) }, 'label_too_long'],
      [{ ...OK, label: { x: 1 } }, 'bad_request'],
      [{ ...OK, correction: 'yes' }, 'bad_request'],
      [{ ...OK, patientName: '' }, 'bad_request'],
      [{ ...OK, patientName: 'א'.repeat(81) }, 'bad_request'],
    ];
    for (const [body, code] of bad) {
      const r = await send(cookie, body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(JSON.parse(r.text).error, code, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(calls.length, 0);
    assert.equal((await send(cookie, { ...OK, label: 'א'.repeat(60) })).status, 200, '60 chars is fine');
  });
});

/* ── B. view ──────────────────────────────────────────────── */

const P = (committee, extra) => ({ name: 'דנה <img src=x>', entryDate: '2026-09-01', days: 45, status: 'active', expectedDischarge: null, committee, ...extra });

test('B: no committee → «הגדרת תאריך ועדה»; the form: date (min = today), label (maxlength 60), שמירה, ביטול', () => {
  const h = W.committeeHtml(P(null), 2, TODAY);
  assert.match(h, /data-cm-edit="2" aria-label="הגדרת תאריך ועדה — דנה &lt;img src=x&gt;">הגדרת תאריך ועדה<\/button>/);
  assert.ok(!h.includes('<img'), 'name escaped');
  assert.match(h, /name="committeeDate" type="date" required min="2026-10-15"/);
  assert.match(h, /name="committeeLabel" type="text" maxlength="60"/);
  assert.ok(h.includes('data-cm-spin') && h.includes('data-cm-save-label') && h.includes('data-cm-cancel="2"') && h.includes('data-cm-msg'));
  assert.ok(!h.includes('data-cm-clear'), 'nothing to clear');
});

test('B: a committee → «ועדה: dd/m/yy · <label>» + «שינוי» + «ניקוי»; editing may correct to the past (min = admission)', () => {
  const h = W.committeeHtml(P({ date: '2026-10-20', label: 'ועדת <b>השמה</b>', editedBy: 'אורן' }), 0, TODAY);
  assert.match(h, /ועדה: <b>20\/10\/26<\/b> · ועדת &lt;b&gt;השמה&lt;\/b&gt;<\/span>/);
  assert.match(h, /data-cm-edit="0"[^>]*>שינוי<\/button>/);
  assert.match(h, /data-cm-clear="0"[^>]*><span class="wk-spin" data-cm-clear-spin aria-hidden="true" hidden><\/span><span data-cm-clear-label>ניקוי<\/span>/);
  assert.match(h, /min="2026-09-01" value="2026-10-20"/);
  assert.match(h, /value="ועדת &lt;b&gt;השמה&lt;\/b&gt;"/);
  assert.match(W.committeeHtml(P({ date: '2026-10-20', label: '' }), 0, TODAY), /ועדה: <b>20\/10\/26<\/b><\/span>/, 'no « · » without a label');
});

test('B: patientsHtml shows the line only when the backend supports it', () => {
  const d = { committeeSupported: true, patients: [P(null)] };
  assert.ok(W.patientsHtml(d).includes('data-cm-row="0"'));
  assert.ok(!W.patientsHtml({ patients: [P(null)] }).includes('data-cm-row'));
});

test('B: committeeCheck — today ok, future ok, past: refused when new, a warning when correcting; label ≤ 60', () => {
  assert.deepEqual(W.committeeCheck('2026-10-15', '', P(null), TODAY), {});
  assert.deepEqual(W.committeeCheck('2026-10-30', 'א'.repeat(60), P(null), TODAY), {});
  assert.match(W.committeeCheck('2026-10-14', '', P(null), TODAY).error, /תאריך שעבר/);
  assert.equal(W.committeeCheck('2026-10-14', '', P({ date: '2026-10-20', label: '' }), TODAY).warn, W.COMMITTEE_PAST_WARNING);
  assert.match(W.committeeCheck('', '', P(null), TODAY).error, /בחרו תאריך/);
  assert.match(W.committeeCheck('2026-02-30', '', P(null), TODAY).error, /לא תקין/);
  assert.match(W.committeeCheck('2026-08-01', '', P({ date: '2026-10-20' }), TODAY).error, /לפני תאריך הכניסה/);
  assert.match(W.committeeCheck('2026-10-20', 'א'.repeat(61), P(null), TODAY).error, /ארוך מדי/);
});

test('B: error reasons are Hebrew, never a raw code', () => {
  const T = (code, status) => W.committeeErrorText({ data: { ok: false, error: code }, status: status || 200 });
  assert.match(T('conflict'), /עודכן בינתיים/);
  assert.match(T('past_date'), /תאריך שעבר/);
  assert.match(T('label_too_long'), /עד 60 תווים/);
  assert.match(T('lock_busy'), /עסוק/);
  assert.match(T('upstream_timeout', 504), /לא הגיב בזמן/);
  assert.match(T('unknown_op'), /השרת לא עודכן/);
  for (const v of Object.values(W.COMMITTEE_ERRORS)) assert.match(v, /[֐-׿]/);
  for (const c of ['conflict', 'past_date', 'lock_busy', 'unknown_op', 'something']) assert.doesNotMatch(T(c), /[a-z_]{4,}/, c);
});

/* ── C. save flow on a minimal DOM (text-only: innerHTML throws) ── */

function el(tag, attrs, children) {
  const e = {
    tagName: tag.toUpperCase(), attrs: Object.assign({}, attrs || {}), children: [], parent: null, hidden: false, disabled: false, value: '', _text: '',
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    matches(sel) {
      return sel.split(',').map((x) => x.trim()).some((one) => {
        const m = /^([a-z]*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(one);
        if (!m) throw new Error('selector not supported: ' + one);
        if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
        if (m[2] && !(m[2] in this.attrs)) return false;
        if (m[3] !== undefined && this.attrs[m[2]] !== m[3]) return false;
        return true;
      });
    },
    querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    closest(sel) { let n = this; while (n) { if (n.matches(sel)) return n; n = n.parent; } return null; },
    replaceWith(n) { const p = this.parent; p.children[p.children.indexOf(this)] = n; n.parent = p; },
  };
  Object.defineProperty(e, 'textContent', { get() { return this._text + this.children.map((c) => c.textContent).join(''); }, set(v) { this._text = String(v); this.children = []; } });
  Object.defineProperty(e, 'innerHTML', { get() { throw new Error('innerHTML read'); }, set() { throw new Error('innerHTML write — text-only'); } });
  (children || []).forEach((c) => { c.parent = e; e.children.push(c); });
  return e;
}
/* The same structure committeeHtml draws (asserted in B). */
function row(i, opts) {
  const date = el('input', { name: 'committeeDate', type: 'date' }); date.value = opts.value || '';
  const label = el('input', { name: 'committeeLabel', type: 'text' }); label.value = opts.label || '';
  const spin = el('span', { 'data-cm-spin': '' }); spin.hidden = true;
  const sl = el('span', { 'data-cm-save-label': '' }); sl.textContent = 'שמירה';
  const form = el('form', { 'data-cm-form': String(i) }, [el('label', {}, [date]), el('label', {}, [label]), el('button', { type: 'submit' }, [spin, sl]),
    el('button', { type: 'button', 'data-cm-cancel': String(i) }), el('span', { 'data-cm-msg': '' })]);
  form.elements = { committeeDate: date, committeeLabel: label };
  form.hidden = !!opts.closed;
  const cspin = el('span', { 'data-cm-clear-spin': '' }); cspin.hidden = true;
  const cl = el('span', { 'data-cm-clear-label': '' }); cl.textContent = 'ניקוי';
  return el('div', { 'data-cm-row': String(i) }, [el('button', { 'data-cm-edit': String(i) }), el('button', { 'data-cm-clear': String(i) }, [cspin, cl]), form, el('span', { 'data-cm-flash': '' })]);
}
function world(committee, value, label) {
  const panel = el('div', {}, [row(0, { value, label })]);
  const cache = { ramot: { at: 0, data: { committeeSupported: true, patients: [{ name: 'דנה', entryDate: '2026-09-01', committee }] } } };
  const seen = [];
  const deferred = [];
  const post = (body) => new Promise((resolve, reject) => { seen.push(body); deferred.push({ resolve, reject }); });
  let refreshes = 0;
  const refresh = async () => { refreshes++; panel.querySelector('[data-cm-row="0"]').replaceWith(row(0, { closed: true })); };
  const r = () => panel.querySelector('[data-cm-row="0"]');
  return { panel, seen, deferred, row: r, refreshes: () => refreshes, deps: { post, refresh, cache, today: TODAY } };
}
const tick = () => new Promise((r) => setImmediate(r));

test('C: set → one request (date, label, previous token), spinner + «שומר...», all disabled; then «נשמר ✓»', async () => {
  const w = world(null, '2026-10-20', ' ועדת השמה ');
  const rw = w.row();
  const p = W.saveCommittee(w.panel, 'ramot', rw, w.deps, 'set');
  W.saveCommittee(w.panel, 'ramot', rw, w.deps, 'set');   // double tap
  await tick();
  assert.equal(w.seen.length, 1, 'one request');
  assert.deepEqual(w.seen[0], { op: 'committeeSet', house: 'ramot', patientName: 'דנה', entryDate: '2026-09-01', committeeDate: '2026-10-20', label: 'ועדת השמה', previousDate: '', previousLabel: '' });
  assert.equal(rw.querySelector('[data-cm-spin]').hidden, false);
  assert.equal(rw.querySelector('[data-cm-save-label]').textContent, 'שומר...');
  assert.ok(rw.querySelectorAll('input, button').every((b) => b.disabled));
  assert.equal(rw.getAttribute('aria-busy'), 'true');
  w.deferred[0].resolve({ ok: true });
  await p;
  assert.equal(w.refreshes(), 1);
  assert.equal(w.row().querySelector('[data-cm-flash]').textContent, 'נשמר ✓');
});

test('C: clear from the row → mode clear with the current date/label as the token; spinner on «ניקוי»', async () => {
  const w = world({ date: '2026-10-20', label: 'א' });
  const rw = w.row();
  const p = W.saveCommittee(w.panel, 'ramot', rw, w.deps, 'clear');
  await tick();
  assert.deepEqual([w.seen[0].mode, w.seen[0].committeeDate, w.seen[0].label, w.seen[0].previousDate, w.seen[0].previousLabel], ['clear', '', '', '2026-10-20', 'א']);
  assert.equal(rw.querySelector('[data-cm-clear-spin]').hidden, false);
  assert.equal(rw.querySelector('[data-cm-clear-label]').textContent, 'שומר...');
  assert.equal(rw.querySelector('[data-cm-spin]').hidden, true);
  w.deferred[0].resolve({ ok: true });
  await p;
  assert.equal(w.row().querySelector('[data-cm-flash]').textContent, 'תאריך הוועדה נוקה ✓');
});

test('C: a past date → no request, a new committee is refused; an existing one warns, a second «שמירה» sends correction', async () => {
  const fresh = world(null, '2026-10-14');
  await W.saveCommittee(fresh.panel, 'ramot', fresh.row(), fresh.deps, 'set');
  assert.equal(fresh.seen.length, 0);
  assert.match(fresh.row().querySelector('[data-cm-msg]').textContent, /תאריך שעבר/);
  const w = world({ date: '2026-10-16', label: '' }, '2026-10-14');
  await W.saveCommittee(w.panel, 'ramot', w.row(), w.deps, 'set');
  assert.equal(w.seen.length, 0, 'first tap only warns');
  assert.equal(w.row().querySelector('[data-cm-msg]').textContent, W.COMMITTEE_PAST_WARNING);
  const p = W.saveCommittee(w.panel, 'ramot', w.row(), w.deps, 'set');
  await tick();
  assert.deepEqual([w.seen[0].committeeDate, w.seen[0].correction, w.seen[0].previousDate], ['2026-10-14', true, '2026-10-16']);
  w.deferred[0].resolve({ ok: true, warning: 'past_date' });
  await p;
  assert.match(w.row().querySelector('[data-cm-flash]').textContent, /תיקון/);
});

test('C: error → the form comes back enabled with the values and the reason; conflict reloads', async () => {
  const w = world(null, '2026-10-20', 'א');
  const rw = w.row();
  const p = W.saveCommittee(w.panel, 'ramot', rw, w.deps, 'set');
  await tick();
  const e = new Error('lock_busy'); e.data = { ok: false, error: 'lock_busy' }; e.status = 200;
  w.deferred[0].reject(e);
  await p;
  assert.ok(rw.querySelectorAll('input, button').every((b) => !b.disabled));
  assert.equal(rw.querySelector('[data-cm-form]').hidden, false);
  assert.deepEqual([rw.querySelector('[data-cm-form]').elements.committeeDate.value, rw.querySelector('[data-cm-form]').elements.committeeLabel.value], ['2026-10-20', 'א']);
  assert.match(rw.querySelector('[data-cm-msg]').textContent, /עסוק/);
  assert.equal(w.refreshes(), 0);
  const w2 = world({ date: '2026-10-20', label: '' }, '2026-10-21');
  const p2 = W.saveCommittee(w2.panel, 'ramot', w2.row(), w2.deps, 'set');
  await tick();
  const c = new Error('conflict'); c.data = { ok: false, error: 'conflict' };
  w2.deferred[0].reject(c);
  await p2;
  assert.equal(w2.refreshes(), 1);
  const nr = w2.row();
  assert.equal(nr.querySelector('[data-cm-form]').hidden, false);
  assert.equal(nr.querySelector('[data-cm-form]').elements.committeeDate.value, '2026-10-21', 'the picked date is kept');
  assert.match(nr.querySelector('[data-cm-msg]').textContent, /עודכן בינתיים/);
});

/* ── D. alerts ─────────────────────────────────────────────── */

test('D: shared fixture — byte-identical to the one E-Zone-Dashboard pins; constants', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_PATH)).digest('hex'), SHARED_FIXTURE_SHA256);
  assert.equal(CA.COMMITTEE_LEAD_DAYS, FIXTURE.COMMITTEE_LEAD_DAYS);
  assert.equal(CA.TIME_ZONE, FIXTURE.TIME_ZONE);
  assert.equal((pub('committee-alerts.js').match(/var COMMITTEE_LEAD_DAYS = 7;/g) || []).length, 1);
});

test('D: boundaries from the fixture (today, +1, +7 in; +8, -1 out; year / leap; bad dates)', () => {
  for (const c of FIXTURE.alerts) {
    const data = { committeeSupported: true, patients: [{ name: 'א', committee: { date: c.date, label: '' } }] };
    const a = CA.houseAlerts(data, 'ramot', c.today).alerts[0];
    assert.deepEqual(a ? { days: a.days, kind: a.kind, whenText: a.whenText } : null, c.expect, c.today + ' → ' + c.date);
  }
});

test('D: timezone / midnight — "today" is the calendar day in Israel (incl. the DST eve)', () => {
  for (const c of FIXTURE.israelToday) assert.equal(CA.israelToday(new Date(c.utc)), c.today, c.utc);
});

test('D: sorted by date («ועדה היום» on top), with name, date, label, days remaining; past never alerted', () => {
  const m = CA.houseAlerts({ committeeSupported: true, patients: [
    { name: 'ב', committee: { date: '2026-10-20', label: 'השמה' } },
    { name: 'א', committee: { date: '2026-10-15', label: '' } },
    { name: 'ג', committee: { date: '2026-10-14', label: '' } },
    { name: 'ד', committee: null },
  ] }, 'ramot', TODAY);
  assert.deepEqual(m.alerts.map((a) => [a.name, a.kind, a.whenText, a.label, a.index]), [['א', 'today', 'היום', '', 1], ['ב', 'week', 'בעוד 5 ימים', 'השמה', 0]]);
  assert.equal(m.count, 2);
  assert.equal(CA.houseAlerts({ patients: [{ name: 'א', committee: { date: TODAY } }] }, 'ramot', TODAY).supported, false, 'older backend');
});

test('D: house isolation + admin filter', () => {
  const ramot = CA.houseAlerts({ committeeSupported: true, patients: [{ name: 'א', committee: { date: '2026-10-16' } }] }, 'ramot', TODAY);
  const efroni = CA.houseAlerts({ committeeSupported: true, patients: [{ name: 'ב', committee: { date: '2026-10-15' } }] }, 'efroni', TODAY);
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

test('D: text-only card — a hostile name / label is text; tags, one-tap «שינוי», admin house names + filter', () => {
  const doc = fakeDoc();
  const model = CA.houseAlerts({ committeeSupported: true, patients: [
    { name: '<img src=x onerror=alert(1)>', committee: { date: '2026-10-15', label: '<script>x</script>' } },
    { name: 'ב', committee: { date: '2026-10-18', label: '' } },
  ] }, 'ramot', TODAY);
  const card = CA.renderCard(doc, model);
  const text = card.textContent;
  assert.match(text, /ועדות קרובות \(2\)/);
  assert.match(text, /<img src=x onerror=alert\(1\)>/, 'shown as text');
  assert.match(text, /ועדה היום/);
  assert.match(text, /ועדה השבוע/);
  assert.match(text, /ועדה: 15\/10\/26 · <script>x<\/script> · היום/);
  assert.match(text, /ועדה: 18\/10\/26 · בעוד 3 ימים/);
  const btns = all(card, (n) => 'data-cm-alert-edit' in n.attrs);
  assert.deepEqual(btns.map((b) => b.attrs['data-cm-alert-edit']), ['ramot|0', 'ramot|1']);
  const admin = CA.renderCard(doc, CA.mergeAlerts([model], ''), { labels: { ramot: 'רמות השבים' }, filter: { value: '', options: [{ value: '', label: 'כל הבתים' }, { value: 'ramot', label: 'רמות השבים' }] } });
  assert.match(admin.textContent, /רמות השבים/);
  assert.equal(all(admin, (n) => 'data-cm-filter' in n.attrs).length, 1);
  assert.match(CA.renderCard(doc, CA.houseAlerts({ committeeSupported: true, patients: [] }, 'ramot', TODAY)).textContent, /אין ועדות היום וב-7 הימים הקרובים/);
});

test('D: badge — count or hidden, its own element beside the discharge badge', () => {
  const doc = fakeDoc();
  const btn = doc.createElement('button');
  CA.setBadge(doc, btn, 2);
  const b = btn.querySelector('[data-cm-badge]');
  assert.deepEqual([b.textContent, b.hidden, b.getAttribute('aria-label')], ['2', false, '2 ועדות השבוע']);
  CA.setBadge(doc, btn, 0);
  assert.deepEqual([b.textContent, b.hidden], ['', true]);
});

/* ── E. wiring + bonus ─────────────────────────────────────── */

test('E: wiring — script loaded before work.js, cards on ראשי (top) and the admin overview, SW v31 caches it', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('/committee-alerts.js') > 0 && html.indexOf('/committee-alerts.js') < html.indexOf('/work.js'));
  assert.ok(html.indexOf('data-dash-committees') < html.indexOf('data-dash-alerts'), 'above the discharge alerts');
  assert.match(html, /id="committeeAlertsAll" class="dis-alerts-all" hidden/);
  const sw = pub('sw.js');
  assert.match(sw, /const CACHE = 'ezone-managers-v31';/);
  assert.match(sw, /'\/committee-alerts\.js'/);
  const w = pub('work.js');
  const block = w.slice(w.indexOf('function setCommitteeBusy'), w.indexOf('/* Called by app.js after a house tab is drawn. */'));
  assert.doesNotMatch(block, /innerHTML|insertAdjacentHTML|console\./, 'text-only, nothing logged');
  assert.doesNotMatch(pub('committee-alerts.js').replace(/\/\*[\s\S]*?\*\//g, ''), /innerHTML|console\./);
  const css = pub('styles.css');
  assert.match(css, /\.cm-alert-btn \{[^}]*min-height: 44px/);
  assert.match(css, /\.wk-cm-form input\[type="text"\] \{[^}]*font-size: 16px;[^}]*min-height: 44px/);
});

test('E: bonus untouched — no bonus module reads the committee', () => {
  for (const f of ['lib/bonus-eligibility.js', 'public/bonus-view.js', 'public/app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/committee|ועדה/i.test(src), f);
  }
});
