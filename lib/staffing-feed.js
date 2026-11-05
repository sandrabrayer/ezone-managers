'use strict';
/*
 * Settled manager bonuses for the staffing app (Nov 5, 2026, Sandra:
 * «האפליקציה צריכה לשאוב נתוני בונוסים חודשיים מאפליקציית הרכזים ומהמנהלים»).
 *
 * ONE pure function turns a month's `managersOverview` rows (raw avgDaily /
 * treatmentDays / referral counts / intake counts — the backend's own bonus
 * figures are never read, per CLAUDE.md §9) into the per-house amounts the
 * staffing app books on the management budget line:
 *
 *   occupancy  — BonusEligibility.monthlyBonusAmount
 *   referral   — BonusEligibility.continuityAmount (eligibility-gated per rule set)
 *   intake     — BonusEligibility.intakeMeetingAmount
 *   quarterly  — BonusEligibility.quarterlyStatus, only in a window's LAST month
 *                (the other two months' settled occupancy amounts are passed in)
 *
 * The same calls, in the same order, as the «היסטוריית בונוסים» view in
 * public/app.js (settledHouseFor_ / settledReferralFor_ / settledIntakeFor_ /
 * quarterlyLocal_) — so staffing books the shekel the manager sees.
 *
 * House ids: the staffing app knows ramot / asher / ofroni / rehab / pardes.
 */
const BonusEligibility = require('./bonus-eligibility');

const STAFFING_HOUSE_IDS = { raanana: 'asher', ramot: 'ramot', efroni: 'ofroni', rehab: 'rehab', pardes: 'pardes' };
const BACKEND_HOUSE_IDS = { arfoni: 'efroni' };
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function houseKeyOf(id) { return BACKEND_HOUSE_IDS[String(id || '')] || String(id || ''); }
function isMonth(ym) { return YM_RE.test(String(ym || '')); }
function rawNumber(v) {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function daysInMonth(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function byKey(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((ph) => { if (ph && ph.key) out[houseKeyOf(ph.key)] = ph; });
  return out;
}
function referralCounts(ph) {
  const c = (ph && ph.bonus && ph.bonus.continuity) || {};
  const rs = ph && ph.referralStarts;
  return { maintenance: c.maintenance, day_2x: c.day_2x, day_daily: c.day_daily, starts: rs ? rs.count : 0 };
}
/* Settled occupancy result for one house row, or null when the row has no figures. */
function occupancyFor(key, ym, ph) {
  if (!ph) return null;
  const avgDaily = rawNumber(ph.avgDaily);
  const treatmentDays = rawNumber(ph.treatmentDays);
  if (avgDaily === null || treatmentDays === null) return null;
  return BonusEligibility.monthlyBonusAmount({ key, ym, avgDaily, treatmentDays }, null, daysInMonth(ym));
}

/*
 * settledBonusesForMonth(ym, rows, windowRows) →
 *   { month, final, houses: [{ house, key, manager, occupancy, referral, intake, quarterly, total, missing }] }
 * rows        — the month's managersOverview `houses` array
 * windowRows  — { ym: houses[] } for the OTHER months of the quarter window
 *               (only read when ym is a window's last month); a missing month
 *               simply means the quarterly cannot be confirmed (earned 0).
 */
function settledBonusesForMonth(ym, rows, windowRows) {
  if (!isMonth(ym)) throw new Error('bad_month');
  const month = byKey(rows);
  const win = BonusEligibility.quarterWindowFor(ym);
  const lastOfWindow = Array.isArray(win) && win.length === 3 && win[2] === ym;
  const others = {};
  if (lastOfWindow) {
    win.forEach((m) => { if (m !== ym) others[m] = byKey(windowRows && windowRows[m]); });
  }
  const houses = Object.keys(STAFFING_HOUSE_IDS).map((key) => {
    const ph = month[key] || null;
    const occ = occupancyFor(key, ym, ph);
    const row = {
      house: STAFFING_HOUSE_IDS[key], key,
      manager: ph && typeof ph.manager === 'string' ? ph.manager.slice(0, 80) : '',
      occupancy: 0, referral: 0, intake: 0, quarterly: 0, total: 0, missing: !occ,
    };
    if (!occ) return row;
    row.occupancy = occ.amount;
    row.referral = BonusEligibility.continuityAmount(referralCounts(ph), occ.eligible, ym).total;
    row.intake = BonusEligibility.intakeMeetingAmount(ph.intakeMeetings || null, ym).total;
    if (lastOfWindow) {
      const settled = {};
      win.forEach((m) => {
        const o = m === ym ? occ : occupancyFor(key, m, others[m] ? others[m][key] : null);
        if (o) settled[m] = o.amount;
      });
      row.quarterly = BonusEligibility.quarterlyStatus(win, settled).earned;
    }
    row.total = row.occupancy + row.referral + row.intake + row.quarterly;
    return row;
  });
  return { month: ym, houses };
}

module.exports = { settledBonusesForMonth, STAFFING_HOUSE_IDS, isMonth, byKey };
