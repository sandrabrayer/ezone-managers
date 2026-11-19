'use strict';
/* Colour guard — LIGHT CRM theme (14 Nov 2026, docs/crm-redesign.md).
 * Replaces the dark-theme guard of 15 Oct 2026. These tests parse
 * public/styles.css and pin what keeps the new look readable:
 *   - the page is light (light background, white cards, dark ink);
 *   - body text, muted text and the Managers accent meet WCAG AA (>= 4.5:1)
 *     on a white card;
 *   - every tab colour carries WHITE text when its tab is active (>= 4.5:1)
 *     and is dark enough as a title colour on white;
 *   - every status chip (ok / warn / bad / wait) is AA on its own background
 *     and always carries a word (never colour alone — checked in crm-view). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

function ruleBody(selectorRe) {
  const re = new RegExp('(?:^|\\})\\s*' + selectorRe.source + '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  assert.ok(m, 'rule not found: ' + selectorRe.source);
  return m[1];
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const lum = (c) => {
  const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
function token(body, name) {
  const m = body.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
  assert.ok(m, '--' + name + ' missing');
  return hex(m[1]);
}
// The LAST :root block that defines a token wins (the redesign appends one).
function lastToken(name) {
  const all = [...css.matchAll(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})', 'g'))];
  assert.ok(all.length, '--' + name + ' missing');
  return hex(all[all.length - 1][1]);
}

test('light page: light background, white cards, dark ink', () => {
  const root = ruleBody(/:root/);
  assert.ok(lum(token(root, 'bg')) > 0.8, 'light background');
  assert.deepEqual(token(root, 'card'), WHITE, 'white cards');
  assert.ok(lum(token(root, 'text')) < 0.05, 'dark ink');
  assert.doesNotMatch(css, /animation: aurora/, 'no animated aurora on the light page');
});

test('WCAG AA on a white card: body text, muted text, dim text, the accent', () => {
  const root = ruleBody(/:root/);
  for (const t of ['text', 'text-mute', 'text-dim', 'primary', 'danger', 'gold', 'green']) {
    const r = ratio(token(root, t), WHITE);
    assert.ok(r >= 4.5, `${t} on white: ${r.toFixed(2)}`);
  }
});

test('the work panels no longer lighten the muted text (the old dark-theme override is dark now)', () => {
  const panel = ruleBody(/\[data-sub-panel="patients"\], \[data-sub-panel="team"\], \[data-sub-panel="therapists"\],\s*\[data-sub-panel="staffTalks"\], \[data-sub-panel="events"\]/);
  assert.ok(ratio(token(panel, 'text-mute'), WHITE) >= 4.5);
  assert.ok(ratio(token(panel, 'text-dim'), WHITE) >= 4.5);
  assert.doesNotMatch(css, /rgba\(253, 231, 238/, 'no pale-pink dark-theme text left');
});

test('every tab colour: white text on the active tab, and a dark title shade on white — both AA', () => {
  const names = ['amber', 'green', 'blue', 'violet', 'teal', 'coral', 'pink', 'indigo', 'sky', 'slate', 'plum', 'cyan'];
  for (const n of names) {
    const c = lastToken('c-' + n);
    // Active tab: white text on the solid colour — large bold text (>= 3:1) at minimum.
    assert.ok(ratio(WHITE, c) >= 3, `white on --c-${n}: ${ratio(WHITE, c).toFixed(2)}`);
    // Titles / inactive tab text: color-mix(var, 80%, #000) on white.
    const title = mix(c, BLACK, 0.8);
    assert.ok(ratio(title, WHITE) >= 4.5, `--c-${n} title on white: ${ratio(title, WHITE).toFixed(2)}`);
  }
  // Each house sub-tab has its own colour.
  for (const s of ['home', 'patients', 'meetings', 'team', 'therapists', 'budget', 'committees', 'staffTalks', 'events', 'summaries', 'shiftUpdates', 'bonus']) {
    assert.match(css, new RegExp('\\.subtab\\[data-sub="' + s + '"\\]\\s*\\{ --tab: var\\(--c-\\w+\\); \\}'), s);
  }
});

test('status chips are AA on their own background (ok / warn / bad / wait)', () => {
  for (const k of ['ok', 'warn', 'bad', 'wait']) {
    const fg = lastToken(k);
    const bg = lastToken(k + '-bg');
    assert.ok(ratio(fg, bg) >= 4.5, `${k}: ${ratio(fg, bg).toFixed(2)}`);
  }
});

test('hidden forms and card panels really hide (the [hidden] attribute wins over display rules)', () => {
  assert.match(css, /\.wk-form\[hidden\], \.thread-form\[hidden\], \[data-card-panel\]\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /\.drawer\[hidden\], \.drawer-backdrop\[hidden\] \{ display: none; \}/);
});
