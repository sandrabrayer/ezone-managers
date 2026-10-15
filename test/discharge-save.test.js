'use strict';
/* Expected-discharge SAVE fix + save spinner (15 Oct 2026; docs/expected-discharge.md):
 *   - the proxy (/api/work) never answers a bare `upstream_error` any more: a
 *     timeout, an unreachable backend, a non-JSON (HTML) reply and an Apps
 *     Script exception each get a safe code; the technical class goes to the
 *     server log only, never a patient name; writes get a 30 s budget;
 *   - the browser maps every code to a specific Hebrew reason (never a raw code);
 *   - the save flow: spinner + «שומר...» with the date / «שמירה» / «ביטול»
 *     disabled, then «נשמר ✓»; on error the form comes back with the date kept
 *     and the reason; a double tap sends ONE request;
 *   - authorization unchanged.
 * All env values are dummies; global.fetch is MOCKED. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');
const { app, _rateLimiters } = require('../server');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const OK = { op: 'dischargeSet', patientName: 'דנה כהן', entryDate: '2026-09-01', expectedDate: '2026-11-20', previousDate: '' };

/* ── proxy ─────────────────────────────────────────────────── */

test('proxy: every upstream failure gets a specific safe code; detail only in the server log, no patient name', async (t) => {
  const realFetch = global.fetch;
  let respond = null;
  let calls = [];
  global.fetch = async (url, opts = {}) => { calls.push({ body: JSON.parse(opts.body), signal: opts.signal }); return respond(); };
  const realErr = console.error;
  let logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  t.after(() => { global.fetch = realFetch; console.error = realErr; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  t.beforeEach(() => { calls = []; logs = []; _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear(); });
  const html = (s) => () => ({ status: 200, text: async () => s, headers: { get: () => 'text/html' } });
  const json = (o) => () => ({ status: 200, text: async () => JSON.stringify(o), headers: { get: () => 'application/json' } });
  const throws = (name) => () => { const e = new Error('boom https://apps-script.test/exec secret'); e.name = name; throw e; };
  const save = async (cookie) => {
    const r = await auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: OK });
    return { status: r.status, body: JSON.parse(r.text) };
  };

  const cases = [
    ['timeout', throws('TimeoutError'), 504, 'upstream_timeout'],
    ['abort', throws('AbortError'), 504, 'upstream_timeout'],
    ['network', throws('TypeError'), 502, 'upstream_unreachable'],
    ['HTML authorization page', html('<html><body>Authorization is required to perform that action.</body></html>'), 502, 'upstream_auth'],
    ['HTML permission error', html('<html>Exception: You do not have permission to call SpreadsheetApp.insertSheet</html>'), 502, 'upstream_auth'],
    ['other HTML', html('<html><body>Sorry, unable to open the file at this time.</body></html>'), 502, 'upstream_bad_response'],
    ['empty body', html(''), 502, 'upstream_bad_response'],
  ];
  for (const [label, r, status, code] of cases) {
    await t.test(label + ' → ' + status + ' ' + code, async () => {
      respond = r;
      const cookie = await auth.login(server, auth.ORAN_CODE);
      const out = await save(cookie);
      assert.equal(out.status, status);
      assert.deepEqual(out.body, { ok: false, error: code });
      assert.equal(calls.length, 1);
      const line = logs.find((l) => l.startsWith('[work]'));
      assert.ok(line, 'one technical line in the server log');
      assert.match(line, new RegExp(`^\\[work\\] op=dischargeSet .*${code}.* status=${status} ms=\\d+$`));
      assert.ok(!logs.some((l) => /דנה|כהן|apps-script\.test|secret|Authorization is required/.test(l)), 'no name, endpoint, secret or body');
    });
  }

  await t.test('an Apps Script exception: the browser gets the code only (no message), the log the class only', async () => {
    respond = json({ ok: false, error: 'exception', message: 'TypeError at דנה כהן row 12' });
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const out = await save(cookie);
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { ok: false, error: 'exception' });
    assert.ok(logs.some((l) => /^\[work\] op=dischargeSet upstreamError=exception status=200 ms=\d+$/.test(l)));
    assert.ok(!logs.some((l) => /דנה/.test(l)));
  });

  await t.test('known JSON refusals pass through unchanged (lock_busy, conflict, unknown_op); a junk code is not echoed', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    for (const body of [{ ok: false, error: 'lock_busy', message: 'could not acquire the script lock — try again.' },
      { ok: false, error: 'conflict', current: { date: '2026-11-01' } }, { ok: false, error: 'unknown_op' }]) {
      respond = json(body);
      const out = await save(cookie);
      assert.equal(out.status, 200);
      assert.deepEqual(out.body, body);
    }
    respond = json({ ok: false, error: '<script>x</script>' });
    const out = await save(cookie);
    assert.deepEqual(out.body, { ok: false, error: 'upstream_bad_response' });
    assert.ok(logs.some((l) => /upstreamError=unknown/.test(l)));
  });

  await t.test('a secret mismatch upstream stays 503 (unchanged)', async () => {
    respond = json({ ok: false, error: 'unauthorized' });
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const out = await save(cookie);
    assert.equal(out.status, 503);
  });

  await t.test('success passes through unchanged', async () => {
    respond = json({ ok: true, expectedDischarge: { date: '2026-11-20' } });
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const out = await save(cookie);
    assert.deepEqual([out.status, out.body.ok], [200, true]);
    assert.ok(!logs.some((l) => l.startsWith('[work]')), 'nothing logged on success');
  });

  await t.test('authorization unchanged: no session 401 (nothing proxied); a manager stays pinned to their own house', async () => {
    respond = json({ ok: true });
    const none = await auth.request(server, '/api/work', { method: 'POST', body: OK });
    assert.equal(none.status, 401);
    assert.equal(calls.length, 0);
    const cookie = await auth.login(server, auth.HANAN_CODE);
    await auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { ...OK, house: 'ramot', role: 'admin' } });
    assert.deepEqual([calls[0].body.house, calls[0].body.role, calls[0].body.actorId], ['efroni', 'manager', 'person-hanan']);
  });
});

test('proxy: a write gets 30 s, a read keeps 15 s', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const WORK_READ_TIMEOUT_MS = 15000;/);
  assert.match(src, /const WORK_WRITE_TIMEOUT_MS = 30000;/);
  assert.match(src, /AbortSignal\.timeout\(WRITE_OPS\.has\(op\) \? WORK_WRITE_TIMEOUT_MS : WORK_READ_TIMEOUT_MS\)/);
  const work = src.slice(src.indexOf("app.post('/api/work'"), src.indexOf('// ---- 404'));
  assert.doesNotMatch(work, /upstream_error/, 'no bare upstream_error from /api/work');
});

/* ── Hebrew reasons ────────────────────────────────────────── */

test('reasons: every code maps to specific Hebrew; never a raw code; «upstream_error» never shown', () => {
  const T = (data, extra) => W.dischargeErrorText(Object.assign({ data, status: 200 }, extra || {}));
  assert.match(T({ error: 'unknown_op' }), /השרת לא עודכן/);
  assert.match(T({ error: 'upstream_auth' }), /אין הרשאה/);
  assert.match(T({ error: 'unauthorized' }, { status: 503 }), /אין הרשאה/);
  assert.match(T({ error: 'upstream_unavailable' }, { status: 503 }), /אין הרשאה/);
  assert.match(T({ error: 'conflict' }), /התאריך עודכן בינתיים/);
  assert.match(T({ error: 'lock_busy' }), /עסוק/);
  assert.match(T({ error: 'upstream_timeout' }, { status: 504 }), /לא הגיב בזמן/);
  assert.match(T({ error: 'upstream_unreachable' }, { status: 502 }), /אין חיבור לשרת/);
  assert.match(T({ error: 'upstream_error' }, { status: 502 }), /תקלה בשרת הנתונים/);
  assert.match(T({ error: 'exception' }), /תקלה בשרת הנתונים/);
  assert.match(T({ error: 'not_found' }), /כבר לא רשום/);
  assert.match(T({ error: 'יותר מדי עדכונים. נסו שוב מאוחר יותר.' }, { status: 429 }), /יותר מדי עדכונים/);
  assert.match(T({ error: 'unauthorized' }, { status: 401 }), /אין הרשאה|היכנסו/);
  assert.match(W.dischargeErrorText({ name: 'TypeError', message: 'Failed to fetch' }), /אין חיבור לאינטרנט/);
  assert.match(T({ error: 'something_new' }), /השמירה נכשלה — נסו שוב/);
  assert.match(W.dischargeErrorText(null), /השמירה נכשלה/);
  for (const code of ['upstream_error', 'upstream_timeout', 'exception', 'lock_busy', 'unknown_op', 'something_new']) {
    assert.doesNotMatch(T({ error: code }), /[a-z_]{4,}/, code + ': no raw code in the text');
  }
  for (const v of Object.values(W.WORK_ERRORS)) assert.match(v, /[֐-׿]/, 'Hebrew');
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
/* The same structure WorkView.dischargeHtml draws (asserted below). */
function row(i, opts) {
  const input = el('input', { name: 'expectedDate', type: 'date' });
  input.value = opts.value || '';
  const spin = el('span', { 'data-dis-spin': '' }); spin.hidden = true;
  const label = el('span', { 'data-dis-save-label': '' }); label.textContent = 'שמירה';
  const save = el('button', { type: 'submit' }, [spin, label]);
  const cancel = el('button', { type: 'button', 'data-dis-cancel': String(i) }); cancel.textContent = 'ביטול';
  const form = el('form', { 'data-dis-form': String(i) }, [el('label', {}, [input]), save, cancel, el('span', { 'data-dis-msg': '' })]);
  form.elements = { expectedDate: input };
  form.hidden = !!opts.closed;
  const edit = el('button', { 'data-dis-edit': String(i) }); edit.hidden = !opts.closed;
  return el('div', { 'data-dis-row': String(i) }, [edit, form, el('span', { 'data-dis-flash': '' })]);
}
function world() {
  const r0 = row(0, { value: '2026-11-20' });
  const panel = el('div', {}, [r0]);
  const cache = { ramot: { at: 0, data: { patients: [{ name: 'דנה', entryDate: '2026-09-01', expectedDischarge: null }] } } };
  const seen = [];
  const deferred = [];
  const post = (body) => new Promise((resolve, reject) => { seen.push(body); deferred.push({ resolve, reject }); });
  let refreshes = 0;
  const refresh = async () => {
    refreshes++;
    // A redraw: a fresh row; an OPEN form is kept open with its value (renderAll).
    const old = panel.querySelector('[data-dis-row="0"]');
    const f = old.querySelector('[data-dis-form="0"]');
    old.replaceWith(row(0, { closed: f.hidden, value: f.hidden ? '' : f.elements.expectedDate.value }));
  };
  const form = () => panel.querySelector('[data-dis-form="0"]');
  return { panel, cache, post, refresh, seen, deferred, form, refreshes: () => refreshes, deps: { post, refresh, cache } };
}
const tick = () => new Promise((r) => setImmediate(r));

test('save: the DOM stand-in matches what dischargeHtml draws', () => {
  const h = W.dischargeHtml({ name: 'x', entryDate: '2026-09-01', expectedDischarge: null }, 0);
  for (const a of ['data-dis-row="0"', 'data-dis-form="0"', 'data-dis-spin', 'data-dis-save-label', 'data-dis-cancel="0"', 'data-dis-msg', 'data-dis-flash', 'name="expectedDate"']) {
    assert.ok(h.includes(a), a);
  }
  assert.match(h, /<span class="wk-spin" data-dis-spin aria-hidden="true" hidden><\/span><span data-dis-save-label>שמירה<\/span>/);
});

test('save: success → spinner + «שומר...» with everything disabled, then the picker closes and «נשמר ✓»', async () => {
  const w = world();
  const f = w.form();
  const p = W.saveDischarge(w.panel, 'ramot', f, w.deps);
  await tick();
  assert.equal(w.seen.length, 1);
  assert.deepEqual(w.seen[0], { op: 'dischargeSet', house: 'ramot', patientName: 'דנה', entryDate: '2026-09-01', expectedDate: '2026-11-20', previousDate: '' });
  assert.equal(f.querySelector('[data-dis-spin]').hidden, false, 'spinner shown');
  assert.equal(f.querySelector('[data-dis-save-label]').textContent, 'שומר...');
  assert.ok(f.querySelectorAll('input, button').every((b) => b.disabled), 'date, «שמירה» and «ביטול» disabled');
  assert.equal(f.getAttribute('aria-busy'), 'true');
  w.deferred[0].resolve({ ok: true });
  await p;
  assert.equal(w.refreshes(), 1);
  const nf = w.form();
  assert.equal(nf.hidden, true, 'the picker is closed after the save');
  assert.equal(w.panel.querySelector('[data-dis-flash]').textContent, 'נשמר ✓');
});

test('save: error → the form comes back enabled, date kept, mapped reason shown (no raw code)', async () => {
  const w = world();
  const f = w.form();
  const p = W.saveDischarge(w.panel, 'ramot', f, w.deps);
  await tick();
  const err = new Error('upstream_timeout'); err.data = { ok: false, error: 'upstream_timeout' }; err.status = 504;
  w.deferred[0].reject(err);
  await p;
  const nf = w.form();
  assert.equal(nf.hidden, false);
  assert.equal(nf.elements.expectedDate.value, '2026-11-20', 'the picked date is kept');
  assert.ok(nf.querySelectorAll('input, button').every((b) => !b.disabled), 'restored');
  assert.equal(nf.querySelector('[data-dis-spin]').hidden, true);
  assert.equal(nf.querySelector('[data-dis-save-label]').textContent, 'שמירה');
  assert.equal(nf.getAttribute('aria-busy'), null);
  assert.match(nf.querySelector('[data-dis-msg]').textContent, /השרת לא הגיב בזמן/);
  assert.doesNotMatch(nf.querySelector('[data-dis-msg]').textContent, /upstream/);
  assert.equal(w.refreshes(), 0, 'no redraw on a plain error');
});

test('save: conflict → reload, then the redrawn form is open with the picked date and the reason', async () => {
  const w = world();
  const p = W.saveDischarge(w.panel, 'ramot', w.form(), w.deps);
  await tick();
  const err = new Error('conflict'); err.data = { ok: false, error: 'conflict' }; err.status = 200;
  w.deferred[0].reject(err);
  await p;
  assert.equal(w.refreshes(), 1);
  const nf = w.form();
  assert.equal(nf.hidden, false);
  assert.equal(nf.elements.expectedDate.value, '2026-11-20');
  assert.match(nf.querySelector('[data-dis-msg]').textContent, /התאריך עודכן בינתיים/);
  assert.ok(nf.querySelectorAll('input, button').every((b) => !b.disabled));
});

test('save: a double tap (and Enter while saving) sends ONE request', async () => {
  const w = world();
  const f = w.form();
  const p1 = W.saveDischarge(w.panel, 'ramot', f, w.deps);
  const p2 = W.saveDischarge(w.panel, 'ramot', f, w.deps);
  await tick();
  const p3 = W.saveDischarge(w.panel, 'ramot', f, w.deps);
  await tick();
  assert.equal(w.seen.length, 1);
  w.deferred[0].resolve({ ok: true });
  await Promise.all([p1, p2, p3]);
  assert.equal(w.seen.length, 1);
  // Once settled, a new save is allowed again.
  const nf = w.form(); nf.hidden = false; nf.elements.expectedDate.value = '2026-11-25';
  w.cache.ramot.data.patients[0].expectedDischarge = { date: '2026-11-20' };
  const p4 = W.saveDischarge(w.panel, 'ramot', nf, w.deps);
  await tick();
  assert.equal(w.seen.length, 2);
  assert.equal(w.seen[1].previousDate, '2026-11-20');
  w.deferred[1].resolve({ ok: true });
  await p4;
});

test('save: an invalid date never sends and never shows the spinner', async () => {
  const w = world();
  const f = w.form();
  f.elements.expectedDate.value = '2026-08-01';
  await W.saveDischarge(w.panel, 'ramot', f, w.deps);
  assert.equal(w.seen.length, 0);
  assert.equal(f.querySelector('[data-dis-spin]').hidden, true);
  assert.match(f.querySelector('[data-dis-msg]').textContent, /לפני תאריך הכניסה/);
});

test('wiring: «ביטול» is ignored while saving; a redraw during a save keeps the form busy; submit goes through saveDischarge', () => {
  const w = pub('work.js');
  assert.match(w, /if \(f\.getAttribute\('data-dis-busy'\) === '1'\) return;/);
  assert.match(w, /if \(keep && savingDischarge\[key \+ '\|' \+ keep\.i\]\) setDischargeBusy\(/);
  assert.match(w, /if \(dform\) \{ ev\.preventDefault\(\); await saveDischarge\(panel, key, dform\); return; \}/);
  const block = w.slice(w.indexOf('function setDischargeBusy'), w.indexOf('/* Called by app.js after a house tab is drawn. */'));
  assert.doesNotMatch(block, /innerHTML|insertAdjacentHTML|console\./, 'text-only, nothing logged');
});

test('UI: spinner respects prefers-reduced-motion; 16px text; 44px targets; SW v30+', () => {
  const css = pub('styles.css');
  assert.match(css, /\.wk-spin \{[^}]*animation: wk-spin/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\/\*[^*]*\*\/\s*\.wk-spin \{ animation: none;/);
  assert.match(css, /\.wk-dis-form \.wk-msg \{ flex: 1 1 100%; font-size: 16px; \}/);
  assert.match(css, /\.wk-dis-flash \{ flex: 1 1 100%; font-size: 16px;/);
  const btn = (css.match(/\.wk-dis-btn \{([^}]*)\}/) || [])[1] || '';
  assert.match(btn, /min-height: 44px/);
  assert.match(btn, /font-size: 16px/);
  assert.match(pub('sw.js'), /const CACHE = 'ezone-managers-v(3\d|[4-9]\d)';/, 'v30 (clear / none) and monotonic after');
});

test('bonus untouched: no bonus module reads the save flow; golden snapshots are a separate suite', () => {
  for (const f of ['lib/bonus-eligibility.js', 'public/bonus-view.js', 'public/app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/dischargeSet|saveDischarge|WORK_ERRORS|wk-spin/.test(src), f);
  }
});
