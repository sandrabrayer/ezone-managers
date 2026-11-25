'use strict';
// The CI workflow that reads the private Dashboard repo (docs/ci.md, 25 Nov 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WF = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'managers-dashboard-source-contract.yml'), 'utf8');

test('contract workflow: the Dashboard checkout uses the read-only secret and never persists credentials', () => {
  const dash = WF.slice(WF.indexOf('Checkout pinned Dashboard source'), WF.indexOf('actions/setup-node'));
  assert.match(dash, /repository: sandrabrayer\/E-Zone-Dashboard/);
  assert.match(dash, /token: \$\{\{ secrets\.DASHBOARD_READ_TOKEN \}\}/);
  assert.match(dash, /persist-credentials: false/);
  const own = WF.slice(WF.indexOf('Checkout Managers draft'), WF.indexOf('Checkout pinned Dashboard source'));
  assert.match(own, /persist-credentials: false/);
  assert.match(WF, /permissions:\n  contents: read\n/);
});

test('contract workflow: no step is skipped or allowed to fail (a missing token keeps the check red)', () => {
  assert.doesNotMatch(WF, /^\s+if:/m);
  assert.doesNotMatch(WF, /continue-on-error/);
  assert.match(WF, /node --test test\/managers-backend-integration\.test\.js/);
});

test('contract workflow: the test runs in UTC (its dates are UTC-pinned)', () => {
  assert.match(WF, /\n    env:\n      TZ: UTC\n/);
});

test('docs/ci.md gives the exact token and secret links', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ci.md'), 'utf8');
  assert.match(doc, /https:\/\/github\.com\/settings\/personal-access-tokens\/new/);
  assert.match(doc, /https:\/\/github\.com\/sandrabrayer\/ezone-managers\/settings\/secrets\/actions\/new/);
  assert.match(doc, /Contents: Read-only/);
  assert.match(doc, /DASHBOARD_READ_TOKEN/);
});
