'use strict';
/* Browser side of the fast reads (24 Oct 2026, docs/read-cache.md): «מתעדכן…» + a quiet reload. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function block() {
  const src = pub('app.js');
  const a = src.indexOf('let staleRepaints_');
  const b = src.indexOf('\n}\n', src.indexOf('function noteServerStale_')) + 3;
  assert.ok(a > 0 && b > a, 'noteServerStale_ block present in app.js');
  return src.slice(a, b);
}
function sandbox() {
  const log = { status: [], retries: 0, timers: [] };
  const ctx = vm.createContext({
    setStatus: (t) => log.status.push(t), retryReads_: () => { log.retries++; },
    setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; }, Date
  });
  vm.runInContext(block() + '\nthis.note = noteServerStale_;', ctx);
  return { ctx, log };
}

test('only X-Cache: STALE triggers anything (HIT / MISS / REFRESHED / none do not)', () => {
  const { ctx, log } = sandbox();
  for (const v of ['HIT', 'MISS', 'REFRESHED', null, undefined, '']) ctx.note(v);
  assert.deepEqual([log.status.length, log.timers.length], [0, 0]);
});

test('STALE: «מתעדכן…» now, ONE quiet reload after ~4 s (not one per read)', () => {
  const { ctx, log } = sandbox();
  ctx.note('STALE'); ctx.note('STALE'); ctx.note('STALE');
  assert.equal(log.status[0], 'מתעדכן…');
  assert.deepEqual([log.timers.length, log.timers[0].ms], [1, 4000]);
  log.timers[0].fn();
  assert.equal(log.retries, 1);
});

test('a refresh that keeps failing can never loop: at most 3 reloads per minute', () => {
  const { ctx, log } = sandbox();
  for (let i = 0; i < 10; i++) { ctx.note('STALE'); if (log.timers.length) { const t = log.timers.shift(); t.fn(); } }
  assert.equal(log.retries, 3);
});

test('wiring: fetchJson reports X-Cache; work.js follows a STALE houseData ONCE with swr:"wait" and keeps the copy on failure', () => {
  const app = pub('app.js'), work = pub('work.js');
  assert.match(app, /noteServerStale_\(hdr\('X-Cache'\)\);/);
  assert.match(work, /get\('X-Cache'\)/);
  assert.match(work, /swr: 'wait'/);
  assert.match(work, /if \(following\[key\] \|\| !root\.document\) return;/);
  assert.match(work, /if \(fresh && fresh\.__stale\) return;/);
  assert.doesNotMatch(work, /innerHTML = [^;]*__stale/, 'the flag is never rendered');
});

test('SW cache is bumped monotonically from the live v39', () => {
  const sw = pub('sw.js');
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(sw)[1]) >= 40);
});
