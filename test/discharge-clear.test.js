'use strict';
/* Expected discharge: «ניקוי תאריך» + «אין צפי לשחרור» (15 Oct 2026;
 * docs/expected-discharge.md, docs/discharge-alerts.md):
 *   - proxy: op dischargeSet mode set | clear | none — shape checks, the house
 *     pinned for a manager, an admin names one, no session → 401;
 *   - view: the row's three states and the two new buttons (only when the
 *     backend lists the modes), names escaped;
 *   - save flow: same spinner / error reasons / concurrency token / one request;
 *   - alerts: «אין צפי» is never an alert and never counted as no-date.
 * Dummy env values; global.fetch is MOCKED. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');
const DA = require('../public/discharge-alerts.js');
const { app, _rateLimiters } = require('../server');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'discharge-alert-cases.json'), 'utf8'));
const BASE = { op: 'dischargeSet', patientName: 'דנה', entryDate: '2026-09-01', expectedDate: '', previousDate: '2026-11-20' };

/* ── proxy ─────────────────────────────────────────────────── */

test('proxy: dischargeSet modes', async (t) => {
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
  const send = async (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body });

  await t.test('no session → 401, nothing proxied', async () => {
    assert.equal((await send(null, { ...BASE, mode: 'clear' })).status, 401);
    assert.equal(calls.length, 0);
  });

  await t.test('clear / none are forwarded with an empty date, house pinned to the manager', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    assert.equal((await send(cookie, { ...BASE, mode: 'clear', house: 'efroni' })).status, 200);
    assert.deepEqual([calls[0].mode, calls[0].expectedDate, calls[0].previousDate, calls[0].house, calls[0].actorId],
      ['clear', '', '2026-11-20', 'ramot', 'person-oran']);
    assert.equal((await send(cookie, { ...BASE, mode: 'none', previousDate: '' })).status, 200);
    assert.deepEqual([calls[1].mode, calls[1].expectedDate], ['none', '']);
    // Back from «אין צפי»: the token 'none' is accepted.
    assert.equal((await send(cookie, { ...BASE, expectedDate: '2026-12-01', previousDate: 'none' })).status, 200);
    assert.deepEqual([calls[2].mode, calls[2].expectedDate, calls[2].previousDate], [undefined, '2026-12-01', 'none'], 'set sends no mode (old contract)');
  });

  await t.test('an admin names the house; a manager cannot reach another house', async () => {
    const admin = await auth.login(server, auth.ADMIN_CODE);
    await send(admin, { ...BASE, mode: 'none', house: 'pardes' });
    assert.deepEqual([calls[0].house, calls[0].role, calls[0].mode], ['pardes', 'admin', 'none']);
    const hanan = await auth.login(server, auth.HANAN_CODE);
    await send(hanan, { ...BASE, mode: 'clear', house: 'ramot' });
    assert.equal(calls[1].house, 'efroni');
  });

  await t.test('shape checks: unknown mode, a date with clear/none, a bad token → 400, nothing proxied', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const bad = [
      [{ ...BASE, mode: 'delete' }, 'bad_request'],
      [{ ...BASE, mode: 'clear', expectedDate: '2026-11-01' }, 'bad_date'],
      [{ ...BASE, mode: 'none', expectedDate: '2026-11-01' }, 'bad_date'],
      [{ ...BASE, mode: 'none', previousDate: 'NONE' }, 'bad_date'],
      [{ ...BASE, mode: 'set' }, 'bad_date'],
      [{ ...BASE, mode: 'clear', entryDate: '' }, 'bad_date'],
      [{ ...BASE, mode: 'clear', patientName: '' }, 'bad_request'],
    ];
    for (const [body, code] of bad) {
      const r = await send(cookie, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(JSON.parse(r.text).error, code, JSON.stringify(body));
    }
    assert.equal(calls.length, 0);
  });
});

/* ── view ─────────────────────────────────────────────────── */

const MODES = { clear: true, none: true };
const P = (ed) => ({ name: 'דנה <b>', entryDate: '2026-09-01', expectedDischarge: ed });

test('view: «אין צפי לשחרור» row shows the text + «שינוי»; the form offers «הגדרת תאריך» (date) and «ניקוי תאריך»', () => {
  const h = W.dischargeHtml(P({ date: '', none: true, editedBy: 'אורן' }), 3, MODES);
  assert.match(h, /<span class="wk-dis-text wk-dis-none">אין צפי לשחרור<\/span>/);
  assert.match(h, /data-dis-edit="3"[^>]*>שינוי<\/button>/);
  assert.ok(h.includes('data-dis-mode="clear"'), 'clear offered');
  assert.ok(!h.includes('data-dis-mode="none"'), 'already «אין צפי»');
  assert.doesNotMatch(h, /דנה <b>/, 'name escaped');
  assert.match(h, /דנה &lt;b&gt;/);
});

test('view: a date row offers both new buttons; an empty row offers «אין צפי» only; no modes → the old form', () => {
  const withDate = W.dischargeHtml(P({ date: '2026-11-20' }), 0, MODES);
  assert.match(withDate, /שחרור משוער: <b>20\/11\/26<\/b>/);
  assert.ok(withDate.includes('data-dis-mode="none"') && withDate.includes('data-dis-mode="clear"'));
  const empty = W.dischargeHtml(P(null), 0, MODES);
  assert.match(empty, />הגדרת תאריך שחרור<\/button>/);
  assert.ok(empty.includes('data-dis-mode="none"') && !empty.includes('data-dis-mode="clear"'));
  const old = W.dischargeHtml(P({ date: '2026-11-20' }), 0);
  assert.ok(!old.includes('data-dis-mode'), 'older backend: no new buttons');
  // «אין צפי» from a backend that does not list the modes renders as «הגדרת תאריך».
  assert.match(W.dischargeHtml(P({ date: '', none: true }), 0), />הגדרת תאריך שחרור<\/button>/);
  // Every button is a 44px .wk-dis-btn with a spinner slot.
  assert.match(withDate, /class="wk-dis-btn wk-dis-mode" data-dis-mode="none"[^>]*><span class="wk-spin" data-dis-mode-spin aria-hidden="true" hidden><\/span><span data-dis-mode-label>אין צפי לשחרור<\/span>/);
});

test('view: patientsHtml passes the backend modes through', () => {
  const d = { expectedDischargeSupported: true, expectedDischargeModes: ['set', 'clear', 'none'], patients: [P(null)] };
  assert.ok(W.patientsHtml(d).includes('data-dis-mode="none"'));
  assert.ok(!W.patientsHtml({ ...d, expectedDischargeModes: undefined }).includes('data-dis-mode'));
  assert.deepEqual(W.dischargeModes({ expectedDischargeModes: 'clear' }), { clear: false, none: false }, 'not an array → off');
});

test('view: the concurrency token is what the screen showed', () => {
  assert.equal(W.dischargeToken(P(null)), '');
  assert.equal(W.dischargeToken(P({ date: '2026-11-20' })), '2026-11-20');
  assert.equal(W.dischargeToken(P({ date: '', none: true })), 'none');
  assert.equal(W.dischargeToken(P({ date: 'garbage' })), '');
});

/* ── save flow on a minimal DOM (text-only: innerHTML throws) ─ */

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
function modeBtn(mode, label) {
  const sp = el('span', { 'data-dis-mode-spin': '' }); sp.hidden = true;
  const lb = el('span', { 'data-dis-mode-label': '' }); lb.textContent = label;
  return el('button', { type: 'button', 'data-dis-mode': mode }, [sp, lb]);
}
function row(i, value) {
  const input = el('input', { name: 'expectedDate', type: 'date' });
  input.value = value || '';
  const spin = el('span', { 'data-dis-spin': '' }); spin.hidden = true;
  const label = el('span', { 'data-dis-save-label': '' }); label.textContent = 'שמירה';
  const save = el('button', { type: 'submit' }, [spin, label]);
  const cancel = el('button', { type: 'button', 'data-dis-cancel': String(i) });
  const form = el('form', { 'data-dis-form': String(i) },
    [el('label', {}, [input]), save, cancel, modeBtn('none', 'אין צפי לשחרור'), modeBtn('clear', 'ניקוי תאריך'), el('span', { 'data-dis-msg': '' })]);
  form.elements = { expectedDate: input };
  return el('div', { 'data-dis-row': String(i) }, [el('button', { 'data-dis-edit': String(i) }), form, el('span', { 'data-dis-flash': '' })]);
}
function world(ed) {
  const panel = el('div', {}, [row(0, '2026-11-20')]);
  const cache = { ramot: { at: 0, data: { patients: [{ name: 'דנה', entryDate: '2026-09-01', expectedDischarge: ed }] } } };
  const seen = [];
  const deferred = [];
  const post = (body) => new Promise((resolve, reject) => { seen.push(body); deferred.push({ resolve, reject }); });
  let refreshes = 0;
  const refresh = async () => { refreshes++; panel.querySelector('[data-dis-row="0"]').replaceWith(row(0, '')); };
  const form = () => panel.querySelector('[data-dis-form="0"]');
  return { panel, seen, deferred, form, refreshes: () => refreshes, deps: { post, refresh, cache } };
}
const tick = () => new Promise((r) => setImmediate(r));

test('save clear: one request with mode/token, the spinner on «ניקוי תאריך», then «התאריך נוקה ✓»', async () => {
  const w = world({ date: '2026-11-20' });
  const f = w.form();
  const p = W.saveDischarge(w.panel, 'ramot', f, w.deps, 'clear');
  W.saveDischarge(w.panel, 'ramot', f, w.deps, 'clear');   // double tap
  await tick();
  assert.equal(w.seen.length, 1, 'one request');
  assert.deepEqual(w.seen[0], { op: 'dischargeSet', house: 'ramot', patientName: 'דנה', entryDate: '2026-09-01', expectedDate: '', previousDate: '2026-11-20', mode: 'clear' });
  const clearBtn = f.querySelector('[data-dis-mode="clear"]');
  assert.equal(clearBtn.querySelector('[data-dis-mode-spin]').hidden, false);
  assert.equal(clearBtn.querySelector('[data-dis-mode-label]').textContent, 'שומר...');
  assert.equal(f.querySelector('[data-dis-spin]').hidden, true, 'not on «שמירה»');
  assert.equal(f.querySelector('[data-dis-mode="none"]').querySelector('[data-dis-mode-label]').textContent, 'אין צפי לשחרור', 'the other button keeps its label');
  assert.ok(f.querySelectorAll('input, button').every((b) => b.disabled), 'everything disabled');
  w.deferred[0].resolve({ ok: true });
  await p;
  assert.equal(w.refreshes(), 1);
  assert.equal(w.panel.querySelector('[data-dis-flash]').textContent, 'התאריך נוקה ✓');
});

test('save none: no date check (an empty picker is fine), token from the screen, «נשמר: אין צפי לשחרור ✓»', async () => {
  const w = world(null);
  const f = w.form();
  f.elements.expectedDate.value = '';
  const p = W.saveDischarge(w.panel, 'ramot', f, w.deps, 'none');
  await tick();
  assert.deepEqual([w.seen[0].mode, w.seen[0].expectedDate, w.seen[0].previousDate], ['none', '', '']);
  w.deferred[0].resolve({ ok: true });
  await p;
  assert.equal(w.panel.querySelector('[data-dis-flash]').textContent, 'נשמר: אין צפי לשחרור ✓');
});

test('save from «אין צפי» back to a date sends previousDate "none"', async () => {
  const w = world({ date: '', none: true });
  const p = W.saveDischarge(w.panel, 'ramot', w.form(), w.deps);
  await tick();
  assert.deepEqual([w.seen[0].mode, w.seen[0].expectedDate, w.seen[0].previousDate], [undefined, '2026-11-20', 'none']);
  w.deferred[0].resolve({ ok: true });
  await p;
});

test('save clear error: the form comes back enabled with the reason; labels restored; conflict reloads', async () => {
  const w = world({ date: '2026-11-20' });
  const f = w.form();
  const p = W.saveDischarge(w.panel, 'ramot', f, w.deps, 'clear');
  await tick();
  const err = new Error('lock_busy'); err.data = { ok: false, error: 'lock_busy' }; err.status = 200;
  w.deferred[0].reject(err);
  await p;
  assert.ok(f.querySelectorAll('input, button').every((b) => !b.disabled));
  assert.equal(f.querySelector('[data-dis-mode="clear"]').querySelector('[data-dis-mode-label]').textContent, 'ניקוי תאריך');
  assert.equal(f.querySelector('[data-dis-mode="clear"]').querySelector('[data-dis-mode-spin]').hidden, true);
  assert.match(f.querySelector('[data-dis-msg]').textContent, /עסוק/);
  const w2 = world({ date: '2026-11-20' });
  const p2 = W.saveDischarge(w2.panel, 'ramot', w2.form(), w2.deps, 'none');
  await tick();
  const c = new Error('conflict'); c.data = { ok: false, error: 'conflict' };
  w2.deferred[0].reject(c);
  await p2;
  assert.equal(w2.refreshes(), 1, 'conflict reloads the current value');
  assert.match(w2.form().querySelector('[data-dis-msg]').textContent, /עודכן בינתיים/);
});

test('wiring: a tap on a mode button goes through saveDischarge with that mode; text-only busy state', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'work.js'), 'utf8');
  assert.match(src, /await saveDischarge\(panel, key, mf, undefined, disMode\.getAttribute\('data-dis-mode'\)\)/);
  const block = src.slice(src.indexOf('function setDischargeBusy'), src.indexOf('/* Called by app.js after a house tab is drawn. */'));
  assert.doesNotMatch(block, /innerHTML|insertAdjacentHTML|console\./);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.wk-dis-mode \{ display: inline-flex;/);
});

/* ── alerts ────────────────────────────────────────────────── */

test('alerts: «אין צפי» is neither an alert nor counted «ללא תאריך»; a cleared one is counted again', () => {
  const data = { expectedDischargeSupported: true, patients: [
    { name: 'א', expectedDischarge: { date: '', none: true } },
    { name: 'ב', expectedDischarge: null },
    { name: 'ג', expectedDischarge: { date: '2026-10-16' } },
  ] };
  const m = DA.houseAlerts(data, 'ramot', '2026-10-15');
  assert.deepEqual(m.alerts.map((a) => a.name), ['ג']);
  assert.deepEqual([m.noDate, m.noExpected, m.count], [1, 1, 1]);
});

test('alerts: shared fixture states (identical file in the Dashboard)', () => {
  for (const c of FIXTURE.states) assert.equal(DA.dischargeState(c.expectedDischarge), c.expect, JSON.stringify(c.expectedDischarge));
});

test('bonus untouched: no bonus module reads the new states', () => {
  for (const f of ['lib/bonus-eligibility.js', 'public/bonus-view.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/dischargeState|dischargeToken|data-dis-mode|expectedDischarge/.test(src), f);
  }
});
