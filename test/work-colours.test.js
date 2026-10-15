'use strict';
/* Work-tab colour guard (15 Oct 2026). The Managers work tabs looked faded;
 * these tests parse public/styles.css and pin the richer minimums so a later
 * edit cannot wash them out again, while proving normal text on the tinted
 * cards still meets WCAG AA (>= 4.5:1) and the Dashboard tokens are unchanged. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

// The body of the first rule whose selector list matches `selectorRe` exactly.
function ruleBody(selectorRe) {
  const re = new RegExp('(?:^|\\})\\s*' + selectorRe.source + '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  assert.ok(m, 'rule not found: ' + selectorRe.source);
  return m[1];
}
const num = (s) => Number(s);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const lum = (c) => {
  const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const panelSel = /\[data-sub-panel="patients"\], \[data-sub-panel="team"\], \[data-sub-panel="therapists"\],\s*\[data-sub-panel="staffTalks"\], \[data-sub-panel="events"\]/;

function alphaOf(body, token) {
  const m = body.match(new RegExp(token + ':\\s*rgba\\(253, 231, 238, ([\\d.]+)\\)'));
  assert.ok(m, token + ' missing');
  return num(m[1]);
}
function cardTint() {
  const body = ruleBody(/\[data-sub-panel\] \.work-card/);
  const m = body.match(/color-mix\(in srgb, var\(--sec\) (\d+)%, transparent\), color-mix\(in srgb, var\(--sec\) (\d+)%, transparent\)/);
  assert.ok(m, 'card gradient not found');
  const b = body.match(/border-color: color-mix\(in srgb, var\(--sec\) (\d+)%, transparent\)/);
  assert.ok(b, 'card border not found');
  return { top: num(m[1]), bottom: num(m[2]), border: num(b[1]) };
}

test('work panels: muted text tokens are bright enough (mute >= 0.85, dim >= 0.82)', () => {
  const body = ruleBody(panelSel);
  assert.ok(alphaOf(body, '--text-mute') >= 0.85);
  assert.ok(alphaOf(body, '--text-dim') >= 0.82);
});

test('Dashboard untouched: the :root text tokens and the home/bonus panels keep their values', () => {
  const root = ruleBody(/:root/);
  assert.equal(alphaOf(root, '--text-mute'), 0.72);
  assert.equal(alphaOf(root, '--text-dim'), 0.66);
  assert.ok(!/\[data-sub-panel="(home|bonus)"\][^{]*\{[^}]*--text-(mute|dim)/.test(css));
});

test('section cards: tint >= 36% / 14%, border >= 65%', () => {
  const t = cardTint();
  assert.ok(t.top >= 36, 'top tint ' + t.top);
  assert.ok(t.bottom >= 14, 'bottom tint ' + t.bottom);
  assert.ok(t.border >= 65, 'border ' + t.border);
});

test('inactive sub-tabs, entries, inputs and KPIs keep the richer values', () => {
  const sub = css.match(/^\.subtab \{ --tab:[^}]*\}/m)[0];
  assert.ok(num(sub.match(/border-color: color-mix\(in srgb, var\(--tab\) (\d+)%/)[1]) >= 70);
  assert.ok(num(sub.match(/color: color-mix\(in srgb, var\(--tab\) (\d+)%, #fff\)/)[1]) >= 60);
  assert.ok(num(sub.match(/background: color-mix\(in srgb, var\(--tab\) (\d+)%/)[1]) >= 20);
  assert.ok(num(ruleBody(/\.wk-entry/).match(/background: rgba\(255, 255, 255, ([\d.]+)\)/)[1]) >= 0.06);
  assert.match(css, /\[data-sub-panel\] \.wk-field input, \[data-sub-panel\] \.wk-field textarea \{ border-color: color-mix\(in srgb, var\(--sec\) 5\d%/);
  assert.ok(num(css.match(/\.wk-kpi \{ background: color-mix\(in srgb, var\(--sec, var\(--c-blue\)\) (\d+)%/)[1]) >= 30);
});

test('WCAG AA: text, muted text, dim text and titles >= 4.5:1 on every tinted work card', () => {
  const root = ruleBody(/:root/);
  const card = hex(root.match(/--card: (#[0-9A-Fa-f]{6})/)[1]);
  const text = hex(root.match(/--text: (#[0-9A-Fa-f]{6})/)[1]);
  const panel = ruleBody(panelSel);
  const mute = alphaOf(panel, '--text-mute');
  const dim = alphaOf(panel, '--text-dim');
  const titlePct = num(css.match(/\[data-sub-panel\] \.work-card \.card-title \{ color: color-mix\(in srgb, var\(--sec\) (\d+)%, #fff\)/)[1]) / 100;
  const subPct = num(css.match(/\[data-sub-panel\] \.work-card \.card-subtitle \{ color: color-mix\(in srgb, var\(--sec\) (\d+)%, #fff\)/)[1]) / 100;
  const note = hex(css.match(/\.work-card \.wk-note \{ color: (#[0-9A-Fa-f]{6})/)[1]);
  const top = cardTint().top / 100; // the lightest stop of the gradient is the worst case
  const colours = [...css.matchAll(/--c-(\w+): (#[0-9A-Fa-f]{6})/g)];
  assert.ok(colours.length >= 7);
  for (const [, name, h] of colours) {
    const sec = hex(h);
    const bg = mix(sec, card, top);
    const W = [255, 255, 255];
    const checks = {
      text: ratio(text, bg),
      mute: ratio(mix(text, bg, mute), bg),
      dim: ratio(mix(text, bg, dim), bg),
      title: ratio(mix(sec, W, titlePct), bg),
      subtitle: ratio(mix(sec, W, subPct), bg),
      note: ratio(note, bg),
    };
    for (const [k, r] of Object.entries(checks)) assert.ok(r >= 4.5, `${k} on ${name} card: ${r.toFixed(2)}`);
  }
});
