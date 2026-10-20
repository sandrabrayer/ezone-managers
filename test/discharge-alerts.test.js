'use strict';
/* Discharge alerts «שחרור קרוב» (Task E, 15 Oct 2026) — public/discharge-alerts.js
 * plus its wiring. Driven only by the manager's own expected discharge date. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DA = require('../public/discharge-alerts.js');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const TODAY = '2026-10-15';
const P = (name, date, extra) => ({ name, entryDate: '2026-09-01', days: 45, status: 'active', expectedDischarge: date ? { date, editedAt: '', editedBy: 'אורן' } : null, ...extra });
const house = (patients, extra) => ({ ok: true, house: 'ramot', expectedDischargeSupported: true, patients, ...extra });

/* A minimal DOM: textContent only; innerHTML THROWS (text-only rendering). */
function fakeDoc() {
  function el(tag) {
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
    Object.defineProperty(e, 'textContent', {
      get() { return this._text + this.children.map((c) => c.textContent).join(' '); },
      set(v) { this._text = String(v); this.children = []; }
    });
    Object.defineProperty(e, 'innerHTML', { set() { throw new Error('innerHTML used'); }, get() { throw new Error('innerHTML used'); } });
    return e;
  }
  return { createElement: el };
}
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };
const byClass = (n, cls) => all(n, (x) => (' ' + x.className + ' ').includes(' ' + cls + ' '));

test('one named constant: ALERT_LEAD_DAYS = 14, Israel time', () => {
  assert.equal(DA.ALERT_LEAD_DAYS, 14);
  assert.equal(DA.TIME_ZONE, 'Asia/Jerusalem');
  assert.equal((pub('discharge-alerts.js').match(/var ALERT_LEAD_DAYS = 14;/g) || []).length, 1);
  assert.ok(!/\b14\b/.test(pub('work.js').replace(/\/\*[\s\S]*?\*\//g, '').split('discharge alerts')[1] || ''), 'no second 14 in the wiring');
});

test('boundary days: 14 in, 15 out, 0 «היום», 1 «מחר», -1 and -3 overdue', () => {
  const m = DA.houseAlerts(house([
    P('ארבע-עשרה', '2026-10-29'), P('חמש-עשרה', '2026-10-30'), P('היום', '2026-10-15'),
    P('מחר', '2026-10-16'), P('אתמול', '2026-10-14'), P('שלושה', '2026-10-12')
  ]), 'ramot', TODAY);
  const got = Object.fromEntries(m.alerts.map((a) => [a.name, [a.days, a.kind, a.whenText]]));
  assert.deepEqual(got['ארבע-עשרה'], [14, 'soon', 'בעוד 14 ימים']);
  assert.equal(got['חמש-עשרה'], undefined, 'day 15 is outside the window');
  assert.deepEqual(got['היום'], [0, 'soon', 'היום']);
  assert.deepEqual(got['מחר'], [1, 'soon', 'מחר']);
  assert.deepEqual(got['אתמול'], [-1, 'overdue', 'התאריך עבר אתמול']);
  assert.deepEqual(got['שלושה'], [-3, 'overdue', 'התאריך עבר לפני 3 ימים']);
  assert.deepEqual(m.alerts.map((a) => a.date), ['2026-10-12', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-29'], 'sorted by date');
  assert.equal(m.count, 5);
});

test('timezone / midnight: "today" is the calendar day in Israel, not UTC or the device', () => {
  assert.equal(DA.israelToday(new Date('2026-10-15T20:59:00Z')), '2026-10-15', '23:59 IDT');
  assert.equal(DA.israelToday(new Date('2026-10-15T21:00:00Z')), '2026-10-16', '00:00 IDT — already tomorrow in Israel');
  assert.equal(DA.israelToday(new Date('2026-12-01T21:59:00Z')), '2026-12-01', '23:59 IST (winter, UTC+2)');
  assert.equal(DA.israelToday(new Date('2026-12-01T22:00:00Z')), '2026-12-02');
  const data = house([P('דנה', '2026-10-16')]);
  assert.equal(DA.houseAlerts(data, 'ramot', DA.israelToday(new Date('2026-10-15T20:59:00Z'))).alerts[0].whenText, 'מחר');
  assert.equal(DA.houseAlerts(data, 'ramot', DA.israelToday(new Date('2026-10-15T21:00:00Z'))).alerts[0].whenText, 'היום');
});

test('overdue: a red «דורש עדכון» until the date is updated', () => {
  const doc = fakeDoc();
  const before = DA.houseAlerts(house([P('דנה', '2026-10-12')]), 'ramot', TODAY);
  const card = DA.renderCard(doc, before, { listHouse: 'ramot' });
  const li = byClass(card, 'dis-alert')[0];
  assert.match(li.className, /is-overdue/);
  assert.equal(byClass(li, 'dis-alert-tag')[0].textContent, 'דורש עדכון');
  assert.equal(byClass(li, 'dis-alert-meta')[0].textContent, 'שחרור משוער: 12/10/26 · התאריך עבר לפני 3 ימים');
  const after = DA.houseAlerts(house([P('דנה', '2026-11-30')]), 'ramot', TODAY);
  assert.equal(after.count, 0, 'updated past the window → the alert is gone');
});

test('no date: ONE quiet summary line with a tap to the list — never one alert per patient', () => {
  const doc = fakeDoc();
  const m = DA.houseAlerts(house([P('א', null), P('ב', null), P('ג', null), P('ד', '2026-10-20')]), 'ramot', TODAY);
  assert.deepEqual([m.count, m.noDate], [1, 3]);
  const card = DA.renderCard(doc, m, { listHouse: 'ramot' });
  const nd = byClass(card, 'dis-nodate');
  assert.equal(nd.length, 1);
  assert.equal(nd[0].textContent, '3 מטופלים ללא תאריך שחרור משוער');
  assert.equal(nd[0].getAttribute('data-alert-list'), 'ramot');
  assert.equal(DA.noDateText(1), 'מטופל/ת אחד/ת ללא תאריך שחרור משוער');
  assert.equal(byClass(DA.renderCard(doc, DA.houseAlerts(house([P('ד', '2026-10-20')]), 'ramot', TODAY)), 'dis-nodate').length, 0);
});

test('discharged patients are excluded: only patients still in houseData.patients alert', () => {
  const inHouse = DA.houseAlerts(house([P('דנה', '2026-10-20'), P('יוסי', '2026-10-18')]), 'ramot', TODAY);
  assert.equal(inHouse.count, 2);
  const yossiLeft = DA.houseAlerts(house([P('דנה', '2026-10-20')]), 'ramot', TODAY);
  assert.deepEqual(yossiLeft.alerts.map((a) => a.name), ['דנה']);
  const oldBackend = DA.houseAlerts({ patients: [P('דנה', '2026-10-20')] }, 'ramot', TODAY);
  assert.deepEqual([oldBackend.supported, oldBackend.count], [false, 0], 'no support flag → no alerts');
});

test('own house vs other house: a house model holds only its own patients; the admin card filters by house', () => {
  const ramot = DA.houseAlerts(house([P('רמות-א', '2026-10-20')]), 'ramot', TODAY);
  const efroni = DA.houseAlerts(house([P('עפרוני-א', '2026-10-16')], { house: 'efroni' }), 'efroni', TODAY);
  assert.deepEqual(ramot.alerts.map((a) => [a.house, a.name]), [['ramot', 'רמות-א']]);
  assert.deepEqual(DA.mergeAlerts([ramot, efroni], '').alerts.map((a) => a.name), ['עפרוני-א', 'רמות-א'], 'all houses, by date');
  assert.deepEqual(DA.mergeAlerts([ramot, efroni], 'ramot').alerts.map((a) => a.name), ['רמות-א']);
  assert.deepEqual(DA.mergeAlerts([ramot, efroni], 'efroni').alerts.map((a) => a.name), ['עפרוני-א']);
  // Wiring: a house tab renders ITS OWN cached houseData only; the all-houses
  // card is mounted for admins only (houseData is pinned server-side anyway).
  const w = pub('work.js');
  assert.match(w, /function renderHouseAlerts\(panel, key, d\)[\s\S]*?DA\.houseAlerts\(d, key,/);
  assert.match(w, /function mountAdmin\(el, keys, labels, todayEl\) \{\s*var u = me\(\);\s*if \(!el \|\| !u \|\| u\.role !== 'admin'\) return;/);
  assert.match(pub('app.js'), /u && u\.role === 'admin' && window\.Work && window\.Work\.mountAdmin/);
});

test('admin card: house filter select + each alert shows its house', () => {
  const doc = fakeDoc();
  const labels = { ramot: 'רמות השבים', efroni: 'קיסריה עפרוני' };
  const m = DA.mergeAlerts([DA.houseAlerts(house([P('דנה', '2026-10-20')]), 'ramot', TODAY)], '');
  const card = DA.renderCard(doc, m, { title: 'שחרורים קרובים — כל הבתים', labels,
    filter: { value: '', options: [{ value: '', label: 'כל הבתים' }, { value: 'ramot', label: 'רמות השבים' }, { value: 'efroni', label: 'קיסריה עפרוני' }] } });
  const sel = all(card, (n) => n.tagName === 'SELECT')[0];
  assert.deepEqual(sel.children.map((o) => [o.value, o.textContent, o.selected]), [['', 'כל הבתים', true], ['ramot', 'רמות השבים', false], ['efroni', 'קיסריה עפרוני', false]]);
  assert.equal(byClass(card, 'dis-alert-house')[0].textContent, 'רמות השבים');
  assert.equal(byClass(card, 'card-title')[0].textContent, 'שחרורים קרובים — כל הבתים (1)');
});

test('card: name, date, days remaining and a one-tap «שינוי תאריך» to that patient', () => {
  const doc = fakeDoc();
  const m = DA.houseAlerts(house([P('אחר', null), P('דנה', '2026-10-16')]), 'ramot', TODAY);
  const card = DA.renderCard(doc, m, { listHouse: 'ramot' });
  assert.equal(byClass(card, 'card-title')[0].textContent, 'שחרור קרוב (1)');
  assert.equal(byClass(card, 'dis-alert-name')[0].textContent, 'דנה');
  assert.equal(byClass(card, 'dis-alert-meta')[0].textContent, 'שחרור משוער: 16/10/26 · מחר');
  const btn = byClass(card, 'dis-alert-btn')[0];
  assert.equal(btn.getAttribute('data-alert-edit'), 'ramot|1', 'house + the patient index in houseData');
  assert.equal(btn.type, 'button');
  const empty = DA.renderCard(doc, DA.houseAlerts(house([]), 'ramot', TODAY));
  assert.equal(byClass(empty, 'wk-empty')[0].textContent, 'אין שחרורים משוערים ב-14 הימים הקרובים');
});

test('text-only rendering: a hostile name stays text; the module never uses innerHTML or logs', () => {
  const doc = fakeDoc();
  const card = DA.renderCard(doc, DA.houseAlerts(house([P('<img src=x onerror=alert(1)>', '2026-10-16')]), 'ramot', TODAY));
  assert.equal(byClass(card, 'dis-alert-name')[0].textContent, '<img src=x onerror=alert(1)>', 'kept as text (the fake DOM throws on innerHTML)');
  const src = pub('discharge-alerts.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src));
  assert.ok(!/console\./.test(src), 'no logging — no patient names in logs');
  const wiring = pub('work.js').split('discharge alerts (Task E')[1].split('Called by app.js')[0];
  assert.ok(!/console\./.test(wiring));
  assert.ok(!/innerHTML\s*=/.test(wiring.split('function onAlertClick')[0].split('function renderHouseAlerts')[1]), 'alert host filled with nodes');
});

test('badge on «ראשי»: the alert count, hidden at 0', () => {
  const doc = fakeDoc();
  const btn = doc.createElement('button');
  btn.textContent = 'ראשי';
  DA.setBadge(doc, btn, 3);
  const b = btn.querySelector('[data-alert-badge]');
  assert.deepEqual([b.textContent, b.hidden, b.getAttribute('aria-label')], ['3', false, '3 התראות שחרור']);
  DA.setBadge(doc, btn, 0);
  assert.deepEqual([b.textContent, b.hidden], ['', true]);
  assert.equal(btn.children.length, 1, 'one badge, reused');
});

test('UI: containers, script order, 16px / 44px, SW cache bumped and ships the module', () => {
  const html = pub('index.html');
  // The committee card (15 Oct 2026) sits above it, still first in «ראשי» before the bonus dial.
  assert.match(html, /<section data-sub-panel="home">\s*(<!--[^>]*-->\s*<div data-dash-committees><\/div>\s*)?<!--[^>]*-->\s*<div data-dash-alerts><\/div>/);
  assert.match(html, /<div id="dischargeAlertsAll" class="dis-alerts-all" hidden><\/div>/);
  const i = (s) => html.indexOf(`<script src="${s}">`);
  assert.ok(i('/discharge-alerts.js') > 0 && i('/discharge-alerts.js') < i('/work.js'));
  const css = pub('styles.css');
  const block = (sel) => (css.match(new RegExp(sel.replace(/[.[\]"=,]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  assert.match(block('.dis-alert-btn, .dis-nodate'), /font-size: 16px; min-height: 44px; min-width: 44px/);
  assert.match(block('.dis-alerts-filter select'), /font-size: 16px; min-height: 44px/);
  assert.match(block('.dis-alert'), /flex-wrap: wrap/);
  const sw = pub('sw.js');
  assert.match(sw, /ezone-managers-v(2[89]|[3-9]\d)'/, 'v28 (Task E) and monotonic after');
  assert.match(sw, /'\/discharge-alerts\.js'/);
});

test('bonus untouched: no bonus module or render path reads the alerts', () => {
  for (const f of ['../lib/bonus-eligibility.js', 'bonus-view.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.ok(!/DischargeAlerts|ALERT_LEAD_DAYS|expectedDischarge/.test(src), f);
  }
  const app = pub('app.js');
  assert.deepEqual(app.match(/DischargeAlerts|mountAdmin/g), ['mountAdmin', 'mountAdmin'], 'app.js only mounts the admin card');
});

test('a redraw keeps an open date picker open (an alert tap survives a second house load)', () => {
  const w = pub('work.js');
  assert.match(w, /var open = p\.querySelector\('\[data-dis-form\]:not\(\[hidden\]\)'\);[\s\S]*?p\.innerHTML = patientsHtml\(d\);\s*if \(keep\) reopenDischargeForm\(p, keep\.i, keep\.v\);/);
  assert.match(w, /pendingEdit\[house\] = edit \? Number\(parts\[1\]\) : 'list';/, 'admin tap queued until the house tab is drawn');
});
