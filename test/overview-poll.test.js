'use strict';
/* The actual Managers overview scheduler, executed without network or personal data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function schedulerSource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const a = source.indexOf('const OVERVIEW_POLL_MS_');
  const b = source.indexOf('/* Who is logged in', a);
  assert.ok(a > 0 && b > a, 'real overview scheduler exists');
  return source.slice(a, b) + '\nthis.startData = startData;\n';
}
function fixture() {
  const state = {
    now: 100000, hidden: false, requests: 0, occupancy: 0,
    intervals: [], listeners: {}, pending: [], errors: []
  };
  const document = {
    get hidden() { return state.hidden; },
    addEventListener: (name, fn) => { state.listeners[name] = fn; }
  };
  const ctx = vm.createContext({
    Date: { now: () => state.now },
    document,
    setInterval: (fn, ms) => { state.intervals.push({ fn, ms }); },
    ensureOccupancy_: () => { state.occupancy++; },
    loadOverview: () => {
      state.requests++;
      return new Promise((resolve, reject) => state.pending.push({ resolve, reject }));
    },
    console: { error: (...args) => state.errors.push(args[0]) },
    Promise
  });
  vm.runInContext(schedulerSource(), ctx);
  return { ctx, state };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('PWA shell is newer than concurrent Managers access draft v42', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const match = /const CACHE = 'ezone-managers-v(\d+)';/.exec(sw);
  assert.ok(match && Number(match[1]) >= 43, 'v43+ required to prevent stale browser shell after PR #65');
});

test('one initial load, one occupancy load and one minute timer despite duplicate starts', async () => {
  const { ctx, state } = fixture();
  ctx.startData();
  ctx.startData();
  await flush();
  assert.equal(state.requests, 1);
  assert.equal(state.occupancy, 1);
  assert.equal(state.intervals.length, 1);
  assert.equal(state.intervals[0].ms, 60000);
  assert.equal(typeof state.listeners.visibilitychange, 'function');
  state.pending.shift().resolve();
  await flush();
});

test('visible polling is limited to one request per minute', async () => {
  const { ctx, state } = fixture();
  ctx.startData();
  await flush();
  state.pending.shift().resolve();
  await flush();

  state.now += 59000;
  state.intervals[0].fn();
  state.listeners.visibilitychange();
  await flush();
  assert.equal(state.requests, 1, 'no early request even with a visibility event');

  state.now += 1000;
  state.intervals[0].fn();
  await flush();
  assert.equal(state.requests, 2);
  state.pending.shift().resolve();
  await flush();
});

test('hidden tabs make no scheduled requests, and returning to a stale tab refreshes immediately', async () => {
  const { ctx, state } = fixture();
  ctx.startData();
  await flush();
  state.pending.shift().resolve();
  await flush();

  state.hidden = true;
  state.now += 180000;
  state.intervals[0].fn();
  state.listeners.visibilitychange();
  await flush();
  assert.equal(state.requests, 1, 'background tab has no fetch');

  state.hidden = false;
  state.listeners.visibilitychange();
  await flush();
  assert.equal(state.requests, 2, 'one refresh on return to foreground');
  state.pending.shift().resolve();
  await flush();
});

test('slow reads cannot overlap from the timer or repeated focus events', async () => {
  const { ctx, state } = fixture();
  ctx.startData();
  await flush();
  state.now += 120000;
  state.intervals[0].fn();
  state.listeners.visibilitychange();
  state.listeners.visibilitychange();
  await flush();
  assert.equal(state.requests, 1, 'coalesces while original source request is unsettled');
  state.pending.shift().resolve();
  await flush();
  state.now += 60000;
  state.intervals[0].fn();
  await flush();
  assert.equal(state.requests, 2, 'unblocks after source completion');
  state.pending.shift().resolve();
  await flush();
});

test('unexpected failed read releases the single-flight guard for the next interval', async () => {
  const { ctx, state } = fixture();
  ctx.startData();
  await flush();
  state.pending.shift().reject(new Error('synthetic source failure'));
  await flush();
  assert.equal(state.errors.length, 1);
  state.now += 60000;
  state.intervals[0].fn();
  await flush();
  assert.equal(state.requests, 2, 'failure never permanently disables refresh');
  state.pending.shift().resolve();
  await flush();
});
