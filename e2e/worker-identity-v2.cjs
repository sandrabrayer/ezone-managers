'use strict';
// Synthetic Chromium check for worker identity v2 client compatibility (Dashboard #415,
// docs/worker-identity-v2.md). No production, no network, no real staff, no Sheets writes:
// every request is captured by an injected `post`.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head><body><div id="feedback"></div><section id="card"></section></body></html>');
    await page.addStyleTag({ path: path.join(__dirname, '../public/styles.css') });
    await page.addScriptTag({ path: path.join(__dirname, '../lib/feedback-due.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../public/crm.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../public/work.js') });
    await page.evaluate(() => {
      window.fixture = {
        today: '2026-11-21',
        team: { available: true, stale: false, today: [], shifts: [], staff: [
          { name: 'דנה', kind: 'guide', role: 'מדריכה', startDate: '2026-01-01', workerId: 'w-A', assignmentId: 'as-A1' },
          { name: 'דנה', kind: 'guide', role: 'מדריכה', startDate: '2026-04-01', workerId: 'w-B', assignmentId: 'as-B1' }
        ] },
        feedback: { supported: true, rows: [{ employee: 'דנה', doneAt: '2026-10-01' }] },
        logs: { staffTalks: [], events: [], familyCalls: [] }
      };
      window.Work._cache.ramot = { data: window.fixture, at: Date.now() };
      document.getElementById('feedback').innerHTML = window.WorkView.feedbackListHtml(window.fixture);
    });
    assert.equal(await page.locator('[data-fb-form]').count(), 2, 'each same-name worker has their own feedback form');
    const sent = await page.evaluate(async () => {
      const out = [];
      const deps = { post: async (b) => { out.push(b); return { ok: true }; }, refresh: async () => {} };
      const forms = document.querySelectorAll('[data-fb-form]');
      for (const f of forms) await window.WorkView.saveFeedback(document.body, 'ramot', f, deps);
      return out;
    });
    assert.deepEqual(sent.map((b) => [b.employee, b.workerId, b.assignmentId]).sort(),
      [['דנה', 'w-A', 'as-A1'], ['דנה', 'w-B', 'as-B1']], 'one request per person, each with ONLY their own pair');
    assert.ok(sent.every((b) => b.house === 'ramot' && b.op === 'feedbackDone'));
    // A form drawn for one person cannot be replayed after the roster changed under it.
    const blocked = await page.evaluate(async () => {
      document.getElementById('feedback').innerHTML = window.WorkView.feedbackListHtml(window.fixture);
      const f = document.querySelector('[data-fb-form]');
      window.Work._cache.ramot.data = Object.assign({}, window.fixture, { team: Object.assign({}, window.fixture.team, {
        staff: window.fixture.team.staff.map((s) => Object.assign({}, s, { assignmentId: s.assignmentId + '-moved' })) }) });
      const out = [];
      await window.WorkView.saveFeedback(document.body, 'ramot', f, { post: async (b) => { out.push(b); }, refresh: async () => {} });
      window.Work._cache.ramot.data = window.fixture;
      return { sent: out.length, msg: f.querySelector('[data-fb-msg]').textContent };
    });
    assert.equal(blocked.sent, 0);
    assert.match(blocked.msg, /נדרש זיהוי עובד\/ת מאומת/);
    // The card of the second «דנה» offers a talk carrying her pair only.
    await page.evaluate(() => {
      document.getElementById('card').innerHTML = window.CrmView.employeeCardHtml(window.fixture, 'wid:w-B', { available: true, workers: [] }, null, 'talks');
    });
    const btn = page.locator('#card [data-emp-talk]');
    assert.equal(await btn.count(), 1);
    assert.deepEqual(await btn.evaluate((b) => [b.dataset.empTalk, b.dataset.empWid, b.dataset.empAid]), ['דנה', 'w-B', 'as-B1']);
    assert.doesNotMatch(await page.locator('#card').innerText(), /w-A/);
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../artifacts/identity-v2-synthetic-390.png'), fullPage: true });
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log('Chromium Managers worker identity v2 PASS: per-person pairs, no replay after a roster change, 390px.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
