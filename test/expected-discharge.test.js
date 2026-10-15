'use strict';
/* Expected discharge date on «מטופלים בבית» (15 Oct 2026):
 *   - the view (public/work.js WorkView.dischargeHtml / patientsHtml):
 *     RTL text, empty state, escaping, native date picker with min = admission,
 *     nothing new when the backend does not support it;
 *   - client validation (WorkView.dischargeCheck);
 *   - the proxy (/api/work op dischargeSet): session, house pinned by the
 *     server, input validation, write rate limit, body limit;
 *   - display-only: no bonus module reads it.
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

const PATS = [
  { name: 'דנה', entryDate: '2026-09-01', days: 45, status: 'active', expectedDischarge: { date: '2026-11-20', editedAt: '2026-10-15T08:00:00Z', editedBy: 'אורן' } },
  { name: '<img src=x onerror=alert(1)>', entryDate: '2026-10-05', days: 11, status: 'trial', expectedDischarge: null }
];
const DATA = { ok: true, today: '2026-10-15', patients: PATS, expectedDischargeSupported: true };

test('view: a set date reads «שחרור משוער: dd/m/yy» with a «שינוי» button', () => {
  const h = W.patientsHtml(DATA);
  assert.match(h, /דנה<\/span><span class="wk-meta">מ-1\/9\/26 · יום 45<\/span><div class="wk-dis"/, 'under the existing name + admission line');
  assert.match(h, /שחרור משוער: <b>20\/11\/26<\/b>/);
  assert.match(h, /data-dis-edit="0" aria-label="שינוי תאריך שחרור משוער — דנה">שינוי</);
});

test('view: empty state «הגדרת תאריך שחרור»; native date picker, min = admission date, current value preset', () => {
  const h = W.patientsHtml(DATA);
  assert.match(h, /data-dis-edit="1"[^>]*>הגדרת תאריך שחרור</);
  assert.match(h, /<input name="expectedDate" type="date" required min="2026-09-01" value="2026-11-20">/);
  assert.match(h, /<input name="expectedDate" type="date" required min="2026-10-05">/);
  assert.equal((h.match(/data-dis-form="\d"[^>]*hidden/g) || []).length, 2, 'the picker opens only on demand');
});

test('view: every value escaped — a name or a junk date never becomes markup', () => {
  const h = W.patientsHtml(DATA);
  assert.ok(!h.includes('<img'), 'name escaped, also inside aria-label');
  const junk = W.dischargeHtml({ name: 'x', entryDate: '"><script>', expectedDischarge: { date: '"><b>' } }, 0);
  assert.ok(!junk.includes('<script>') && !junk.includes('<b>"'));
  assert.match(junk, /הגדרת תאריך שחרור/, 'an invalid stored date is treated as not set');
  assert.ok(!/min=/.test(junk), 'no min from a junk admission date');
});

test('view: an older backend (no expectedDischargeSupported) shows exactly the old list', () => {
  const h = W.patientsHtml({ patients: PATS });
  assert.ok(!h.includes('wk-dis') && !h.includes('שחרור'));
  assert.match(h, /דנה<\/span><span class="wk-meta">מ-1\/9\/26 · יום 45<\/span><\/li>/);
});

test('validation: empty, malformed, impossible, before admission → a Hebrew reason; a valid date → ""', () => {
  assert.equal(W.dischargeCheck('', '2026-09-01'), 'בחרו תאריך');
  assert.equal(W.dischargeCheck('20/11/26', '2026-09-01'), 'תאריך לא תקין');
  assert.equal(W.dischargeCheck('2026-02-30', '2026-01-01'), 'תאריך לא תקין');
  assert.equal(W.dischargeCheck('2026-08-31', '2026-09-01'), 'תאריך השחרור לא יכול להיות לפני תאריך הכניסה');
  assert.equal(W.dischargeCheck('2026-09-01', '2026-09-01'), '');
  assert.equal(W.dischargeCheck('2026-12-01', '2026-09-01'), '');
  assert.match(W.DISCHARGE_ERRORS.conflict, /עודכן בינתיים/);
});

test('mobile: 16px text, 44px tap targets, wraps at 360px; SW cache bumped', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const block = (sel) => (css.match(new RegExp(sel.replace(/[.[\]"=]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  assert.match(block('.wk-dis-btn'), /min-height: 44px/);
  assert.match(block('.wk-dis-btn'), /font-size: 16px/);
  assert.match(block('.wk-dis-form input[type="date"]'), /min-height: 44px/);
  assert.match(block('.wk-dis-form input[type="date"]'), /font-size: 16px/, '16px — iOS does not zoom');
  assert.match(block('.wk-dis-form input[type="date"]'), /max-width: 100%/);
  assert.match(block('.wk-dis'), /flex-wrap: wrap/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /ezone-managers-v27'/);
});

test('display-only: no bonus module or bonus render path reads the expected discharge date', () => {
  for (const f of ['lib/bonus-eligibility.js', 'public/bonus-view.js', 'public/app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/expectedDischarge|dischargeSet/.test(src), f);
  }
});

test('proxy: op dischargeSet', async (t) => {
  const realFetch = global.fetch;
  let calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    return { status: 200, text: async () => '{"ok":true}', headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  t.beforeEach(() => { calls = []; _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); _rateLimiters.allowWrites.clear(); });
  const req = auth.request;
  const OK = { op: 'dischargeSet', patientName: 'דנה', entryDate: '2026-09-01', expectedDate: '2026-11-20', previousDate: '' };

  await t.test('no session → 401, nothing proxied', async () => {
    const r = await req(server, '/api/work', { method: 'POST', body: OK });
    assert.equal(r.status, 401);
    assert.equal(calls.length, 0);
  });

  await t.test('a manager is pinned to their own house; role / actor / secret come from the server only', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const r = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie },
      body: { ...OK, house: 'efroni', role: 'admin', actorId: 'person-sandra', secret: 'x', editedBy: 'forged' } });
    assert.equal(r.status, 200);
    const b = calls[0].body;
    assert.deepEqual([b.action, b.op, b.house, b.role, b.actor, b.actorId, b.secret],
      ['managersWork', 'dischargeSet', 'ramot', 'manager', 'אורן', 'person-oran', process.env.MANAGERS_WORK_SECRET]);
    assert.deepEqual([b.patientName, b.entryDate, b.expectedDate, b.previousDate], ['דנה', '2026-09-01', '2026-11-20', '']);
    assert.equal(b.editedBy, undefined, 'unknown fields are not forwarded');
  });

  await t.test('an admin names any house', async () => {
    const admin = await auth.login(server, auth.ADMIN_CODE);
    await req(server, '/api/work', { method: 'POST', headers: { Cookie: admin }, body: { ...OK, house: 'pardes' } });
    assert.deepEqual([calls[0].body.house, calls[0].body.role], ['pardes', 'admin']);
  });

  await t.test('validation before anything is proxied', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const bads = [
      [{ expectedDate: '20/11/2026' }, 'bad_date'], [{ expectedDate: '2026-13-01' }, 'bad_date'],
      [{ entryDate: '' }, 'bad_date'], [{ previousDate: 'yesterday' }, 'bad_date'],
      [{ expectedDate: '2026-08-31' }, 'before_admission'],
      [{ patientName: '' }, 'bad_request'], [{ patientName: 'א'.repeat(81) }, 'bad_request'], [{ patientName: { $ne: 1 } }, 'bad_request']
    ];
    for (const [patch, err] of bads) {
      const r = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { ...OK, ...patch } });
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.equal(JSON.parse(r.text).error, err, JSON.stringify(patch));
    }
    assert.equal(calls.length, 0);
  });

  await t.test('writes have their own rate limit (60 / 15 min per IP)', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    let last;
    for (let i = 0; i < 61; i++) last = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: OK });
    assert.equal(last.status, 429);
    assert.equal(calls.length, 60);
  });

  await t.test('body limit: an oversized JSON body is refused (16 kb ≤ the 2 MB cap)', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const r = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { ...OK, pad: 'x'.repeat(20000) } });
    assert.equal(r.status, 413);
    assert.equal(calls.length, 0);
  });
});
