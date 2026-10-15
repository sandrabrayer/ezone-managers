'use strict';
// Opt-in integration with the reviewed Dashboard checkout. No network or live data.
// DASHBOARD_CHECKOUT=/absolute/path TZ=UTC node --test test/managers-backend-integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('real Managers HTTP routes → real Dashboard Code.gs, synthetic users and sheets', { skip: !process.env.DASHBOARD_CHECKOUT }, async t => {
  process.env.NODE_ENV = 'test';
  process.env.APPS_SCRIPT_URL = 'https://synthetic.test/exec';
  const auth = require('./helpers-auth');
  const otherCode = '10000004';
  process.env.MANAGER_ACCESS = JSON.stringify([...JSON.parse(process.env.MANAGER_ACCESS),
    { id:'person-other-oran', name:'אורן אחר', house:'ramot', code:otherCode }]);
  const { loadGs } = require(path.join(process.env.DASHBOARD_CHECKOUT, 'test/helpers/gs-sandbox'));
  const g = loadGs({ props: { MANAGERS_WORK_SECRET: process.env.MANAGERS_WORK_SECRET, PROXY_SECRET_MODE:'enforce' } });
  g.sandbox.Session = {getScriptTimeZone:() => 'UTC'};
  g.run(`todayISODate_ = function () { return '2026-10-14'; }; defaultMonth_ = function () { return '2026-10'; }; readPatientsForBonus_ = function () { return []; }; readOutpatients_ = function () { return []; };`);
  const originalFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, opts) => {
    assert.equal(url, 'https://synthetic.test/exec');
    assert.equal(opts.method, 'POST');
    const body = JSON.parse(opts.body); sent.push(body);
    const data = g.post(body);
    return { ok:true, status:200, json:async () => data, text:async () => JSON.stringify(data), headers:{get:() => 'application/json'} };
  };
  t.after(() => { global.fetch = originalFetch; });
  const { app } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const mine = await auth.login(server, auth.ORAN_CODE);
  const other = await auth.login(server, otherCode, 'אורן אחר');
  const elsewhere = await auth.login(server, auth.HANAN_CODE);
  const admin = await auth.login(server, auth.ADMIN_CODE);
  const work = async (cookie, body) => {
    const r = await auth.request(server, '/api/work', {method:'POST', headers:{Cookie:cookie}, body});
    return {status:r.status, data:JSON.parse(r.text)};
  };
  assert.equal((await auth.request(server, '/healthz')).status, 200);
  assert.deepEqual(Object.keys(g.sandbox.__sheets), [], 'readiness has no sheet side effects');
  assert.equal((await work('', {op:'houseData'})).status, 401);
  const created = await work(mine, {op:'logAdd',log:'staffTalks',house:'efroni',role:'admin',actorId:'person-sandra',
    entry:{employeeName:'Synthetic employee',talkDate:'2026-10-13',summary:'private test',followUpDate:'2020-01-01',authorId:'forged'}});
  assert.equal(created.data.ok, true);
  const id = created.data.id;
  assert.deepEqual([sent.at(-1).house,sent.at(-1).role,sent.at(-1).actorId], ['ramot','manager','person-oran']);
  const owned = (await work(mine,{op:'houseData'})).data;
  assert.equal(owned.ok, true, JSON.stringify(owned));
  assert.equal(owned.logs.staffTalks.length, 1);
  for (const cookie of [other, elsewhere]) {
    const d = (await work(cookie,{op:'houseData',house:'ramot'})).data;
    assert.deepEqual(d.logs.staffTalks, []);
    assert.deepEqual(d.followUps, []);
  }
  assert.equal((await work(admin,{op:'houseData',house:'ramot'})).data.logs.staffTalks.length, 1);
  assert.equal((await work(other,{op:'logUpdate',log:'staffTalks',id,patch:{deleted:true}})).data.error, 'forbidden');
  assert.equal((await work(mine,{op:'logUpdate',log:'staffTalks',id,patch:{followUpDone:true}})).data.ok, true);
  const cost = await work(mine, {op:'houseCost',house:'efroni',role:'admin',actorId:'person-sandra',month:'2026-10'});
  assert.equal(cost.data.ok, true);
  assert.equal(cost.data.house, 'ramot');
  assert.deepEqual([sent.at(-1).house,sent.at(-1).actorId], ['ramot','person-oran']);
  assert.deepEqual(cost.data.cost, {available:false,reason:'not_configured'});
  const r = await auth.request(server,'/api/sheets?action=managersHouse&house=efroni',{headers:{Cookie:mine}});
  assert.equal(r.status,403);
  g.run(`managersOverview_ = function () { return {ok:true,houses:[{key:'ramot',patientsNow:4},{key:'efroni',patientsNow:3}],totals:{activePatients:7}}; };`);
  const own = await auth.request(server,'/api/sheets?action=managersOverview&role=admin&actorId=forged&house=efroni',{headers:{Cookie:mine}});
  assert.deepEqual(JSON.parse(own.text).houses.map(h => h.key),['ramot']);
  assert.equal(sent.at(-1).actorId,'person-oran');
  // Expected discharge date (15 Oct 2026): append-only header, house-pinned,
  // only a patient in the caller's house today.
  assert.deepEqual(Array.from(g.run('MW_DISCHARGE_COLUMNS')),
    ['id','house','patientName','entryDate','expectedDate','previousDate','editedAt','editedBy','editedById']);
  g.run(`readPatientsForBonus_ = function () { return [{houseId:'ramot',name:'Synthetic patient',entry:new Date(2026,8,1),exit:null,status:'active'},
    {houseId:'arfoni',name:'Other house',entry:new Date(2026,8,1),exit:null,status:'active'}]; };`);
  const dis = {op:'dischargeSet',patientName:'Synthetic patient',entryDate:'2026-09-01',expectedDate:'2026-11-20',previousDate:''};
  assert.equal((await work(elsewhere, dis)).data.error, 'not_found', 'another house manager cannot set it');
  assert.equal((await work(mine, {...dis, house:'efroni', patientName:'Other house'})).data.error, 'not_found', 'house pinned to the manager');
  assert.equal((await work(mine, dis)).data.ok, true);
  assert.equal((await work(admin, {...dis, house:'ramot', expectedDate:'2026-12-01'})).data.error, 'conflict', 'stale previousDate');
  const withDate = (await work(mine,{op:'houseData'})).data;
  assert.equal(withDate.expectedDischargeSupported, true);
  assert.equal(withDate.patients[0].expectedDischarge.date, '2026-11-20');
  assert.equal(g.sandbox.__sheets.ManagersExpectedDischarge.grid.length, 2);
});
