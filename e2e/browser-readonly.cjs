'use strict';
// Chromium smoke of real Managers browser view modules using synthetic data only.
// No login, credentials, external dashboard, or production Sheets are used.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const browserErrors = [];
    page.on('pageerror', err => browserErrors.push(err.message));
    await page.setContent(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head><body>
      <main id="panel-ramot" data-house-key="ramot">
        <button data-sub="meetings"><span data-mt-badge hidden></span></button>
        <div data-dash-meetings></div>
        <section data-sub-panel="meetings"></section>
      </main>
      <div id="cards"></div>
    </body></html>`);
    await page.addStyleTag({ path: path.resolve(__dirname, '../public/styles.css') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../public/crm.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../public/work.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../public/meetings.js') });

    await page.evaluate(() => {
      window.__testSaved = null;
      window.__writeCalls = 0;
      window.fetch = async (_url, opts) => {
        const q = JSON.parse(opts.body);
        if (q.op === 'meetings') return {
          ok: true, status: 200,
          json: async () => ({
            ok: true, today: '2026-11-21',
            meetings: [{ id: 'L1', name: 'דוגמה סינתטית', house: 'ramot',
              houseLabel: 'בית בדיקה', visitDate: '2026-11-20', visitTime: '10:00',
              meetingWith: 'אורן', officeNote: 'ללא מידע אמיתי',
              report: window.__testSaved }]
          })
        };
        if (q.op === 'meetingReport') {
          window.__writeCalls++;
          window.__testSaved = {
            leadId: q.leadId, outcome: q.outcome, note: q.note,
            reporter: 'אורן (בדיקה)', reportedAt: '2026-11-21T10:00:00Z', via: 'app'
          };
          return { ok: true, status: 200, json: async () => ({ ok: true, saved: window.__testSaved }) };
        }
        return { ok: false, status: 400, json: async () => ({ ok: false, error: 'unknown_op' }) };
      };
      window.MeetingsView.setViewer('אורן');
      window.MeetingsView.setReadOnly(true);
      window.Meetings.onHouse(document.getElementById('panel-ramot'), 'ramot', true);
    });
    await page.locator('.mt-row').waitFor();
    assert.equal(await page.locator('[data-mt-report], [data-mt-form]').count(), 0,
      'view-only meeting page must not contain reporting controls');
    assert.match(await page.locator('[data-sub-panel="meetings"]').innerText(), /צפייה בלבד/);
    assert.equal(await page.locator('.mt-row').count(), 1, 'the agenda stays visible');
    assert.equal(await page.evaluate(() => window.__writeCalls), 0);

    await page.evaluate(() => {
      const d = { readOnly: true, today: '2026-11-21',
        patients: [{ name: 'מטופל בדיקה', entryDate: '2026-10-01', expectedDischarge: { date: '2026-12-01' } }],
        expectedDischargeSupported: true, expectedDischargeModes: ['set', 'clear', 'none'],
        team: { available: true, staff: [{ name: 'עובד בדיקה' }] },
        feedback: { supported: true, rows: [] },
        logs: { staffTalks: [], familyCalls: [], events: [] } };
      document.getElementById('cards').innerHTML = window.WorkView.patientsHtml(d) +
        window.WorkView.logPanelHtml('events', d, { readOnly: true }) +
        window.WorkView.familyPanelHtml(d, {}) +
        window.CrmView.patientCardHtml(d, 0);
    });
    assert.equal(await page.locator('#cards [data-dis-form], #cards [data-wk-form], #cards [data-pt-discharge]').count(), 0,
      'view-only patient/operations panels cannot edit');
    assert.match(await page.locator('#cards').innerText(), /שחרור משוער/);

    // The same browser, with ordinary manager capability, must still report successfully.
    await page.evaluate(() => {
      window.MeetingsView.setReadOnly(false);
      window.Meetings.onHouse(document.getElementById('panel-ramot'), 'ramot', true);
    });
    await page.locator('[data-mt-report="L1"]').waitFor();
    await page.locator('[data-mt-report="L1"]').click();
    await page.locator('[data-mt-held="yes"]').click();
    await page.locator('[data-mt-outcome="advancing"]').click();
    await page.locator('[data-mt-form] textarea[name="note"]').fill('בדיקת דיווח');
    await page.locator('[data-mt-submit]').click();
    await page.getByText('✓ הדיווח נשמר ונשלח לדשבורד').waitFor();
    assert.equal(await page.evaluate(() => window.__writeCalls), 1, 'one browser submission');
    await page.evaluate(() => window.Meetings.onHouse(document.getElementById('panel-ramot'), 'ramot', true));
    await page.locator('.mt-report').waitFor();
    assert.match(await page.locator('.mt-report').innerText(), /דווח/);
    assert.equal(await page.evaluate(() => window.__writeCalls), 1, 'refresh adds no second write');

    fs.mkdirSync(path.resolve(__dirname, '../artifacts'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../artifacts/managers-synthetic-390.png'), fullPage: true });
    assert.deepEqual(browserErrors, [], 'browser console must have no uncaught page errors');
    console.log('Chromium synthetic UI smoke passed: view-only + standard reporting + readback + 390px.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
