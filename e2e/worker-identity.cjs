'use strict';
// Synthetic Chromium smoke for the Managers-only employee identity view.
// Does not connect to production, change access, read staff or write Sheets.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head><body><main id="staff"></main><div id="feedback"></div><section id="card"></section></body></html>');
    await page.addStyleTag({ path: path.join(__dirname, '../public/styles.css') });
    await page.addScriptTag({ path: path.join(__dirname, '../lib/feedback-due.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../public/crm.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../public/work.js') });
    await page.evaluate(() => {
      window.fixture = {
        today: '2026-11-21',
        team: { available: true, today: [], shifts: [], staff: [
          { name: 'דנה', kind: 'guide', role: 'מדריכה', phone: '050-111-2222', startDate: '2026-01-01' },
          { name: 'דנה', kind: 'guide', role: 'מדריכה', phone: '050-333-4444', startDate: '2026-02-01' }
        ] },
        feedback: { supported: true, rows: [{ employee: 'דנה', doneAt: '2026-10-01' }] },
        logs: { staffTalks: [{ id: 'synthetic-1', employeeName: 'דנה', talkDate: '2026-10-01', summary: 'private synthetic note', author: 'בדיקה' }], events: [], familyCalls: [] }
      };
      document.getElementById('staff').innerHTML = window.WorkView.teamHtml(window.fixture);
      document.getElementById('feedback').innerHTML = window.WorkView.feedbackListHtml(window.fixture);
    });
    assert.equal(await page.locator('[data-emp-open]').count(), 2, 'two identical names each have their own card');
    const refs = await page.locator('[data-emp-open]').evaluateAll(xs => xs.map(e => e.getAttribute('data-emp-open')));
    assert.deepEqual(refs, ['phone:0501112222', 'phone:0503334444']);
    assert.equal(await page.locator('[data-fb-form]').count(), 0, 'name-only feedback cannot be misattributed');
    assert.equal(await page.locator('#feedback .wk-fb-all > li').count(), 2, 'both staff retain their reminder line');
    await page.evaluate(ref => {
      document.getElementById('card').innerHTML = window.CrmView.employeeCardHtml(window.fixture, ref, {
        available: true, total: 50000, month: '2026-11',
        workers: [{ name: 'דנה', cost: 19000, birthDate: '1980-04-01' }]
      });
    }, refs[1]);
    const selected = await page.locator('#card').innerText();
    assert.match(selected, /050-333-4444/);
    assert.doesNotMatch(selected, /050-111-2222|19,000|private synthetic note|1\/4\/1980/,
      'card must not show the other person or unverified name-only costs/notes/birthdate');
    await page.evaluate(() => {
      document.getElementById('card').innerHTML = window.CrmView.employeeCardHtml(window.fixture, 'דנה',
        { available: true, workers: [] });
    });
    assert.match(await page.locator('#card').innerText(), /לא ניתן לזהות/, 'bare duplicate name fails closed');
    fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../artifacts/identity-synthetic-390.png'), fullPage: true });
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log('Chromium Managers worker identity smoke PASS: two cards, no guessed history, 390px.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
