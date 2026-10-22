'use strict';
/* CLAUDE.md guard — the "Repo footer" rule tells every Claude reply to Sandra
 * to end with the repo + branch (the Claude app/web shows no status line).
 * Fails CI if the rule is dropped or its footer format drifts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const doc = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');

test('CLAUDE.md has the Repo footer rule as a numbered section', () => {
  assert.match(doc, /^## \d+\. Repo footer$/m);
  assert.match(doc, /\*\*Repo footer\.\*\* End EVERY reply to Sandra/);
});

test('Repo footer rule names the footer format, branch source and edge cases', () => {
  assert.ok(doc.includes('`📁 Repo: sandrabrayer/ezone-managers · Branch: <current branch>`'));
  assert.ok(doc.includes('`git branch --show-current`'));
  assert.ok(doc.includes('`(not pushed)`'));
  assert.match(doc, /multi-repo\s+session, list each repo touched/);
});
