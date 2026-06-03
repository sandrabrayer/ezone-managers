/* ezone-managers — read-only dashboard
   Talks to /api/sheets which proxies to the existing Apps Script.
   Endpoints:
     /api/sheets?action=managersOverview
     /api/sheets?action=managersHouse&house=<houseKey>
*/

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab'];

/* `threshold` = end-of-month patients needed to be eligible for ANY bonus
   (the agreed model: Ramot 18, others 10). This is NOT the internal
   equilibrium point (11/8/8/7) — that point is internal-only and must not
   gate the bonus. `capacity` is the physical bed count. */
const HOUSE_LABELS = {
  raanana: { name: 'רעננה אשר',     manager: 'עידו',  type: 'בית מאזן',     threshold: 10, capacity: 14 },
  ramot:   { name: 'רמות השבים',    manager: 'שחר',   type: 'בית מאזן',     threshold: 18, capacity: 20 },
  efroni:  { name: 'קיסריה עפרוני', manager: 'חנן',   type: 'תחלואה כפולה', threshold: 10, capacity: 13 },
  rehab:   { name: 'קיסריה ריהאב',  manager: 'רנטה',  type: 'גמילה',        threshold: 10, capacity: 13 }
};

/* Bonus-eligibility threshold for a house (end-of-month patient count).
   Prefers the canonical per-house config in BonusEligibility, then explicit
   payload fields, then the HOUSE_LABELS fallback. */
function resolveThreshold(h) {
  if (!h) return 0;
  const fromLib = window.BonusEligibility?.thresholdOf?.(h);
  if (Number.isFinite(fromLib) && fromLib > 0) return fromLib;
  if (Number.isFinite(h.bonusThreshold)) return h.bonusThreshold;
  if (Number.isFinite(h.threshold)) return h.threshold;
  return HOUSE_LABELS[h.key]?.threshold || 0;
}
function resolveCapacity(h) {
  if (!h) return 0;
  if (h.capacity) return h.capacity;
  return HOUSE_LABELS[h.key]?.capacity || 0;
}

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const state = {
  overview: null,
  housesById: {},
  details: {},
  loadingDetails: {}
};

/* ============================================================
   Utilities
   ============================================================ */

function fmtCurrency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('he-IL', { maximumFractionDigits: 0 }) + ' ₪';
}
function fmtInt(n) {
  return (Number(n) || 0).toLocaleString('he-IL');
}
function fmtDateShort(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
function fmtMonthLabel(yearMonth) {
  if (!yearMonth) return currentMonthLabel();
  const m = String(yearMonth).match(/^(\d{4})-(\d{1,2})/);
  if (!m) return String(yearMonth);
  const idx = Math.max(0, Math.min(11, parseInt(m[2], 10) - 1));
  return `${HEBREW_MONTHS[idx]} ${m[1]}`;
}

function daysInMonthFromLabel(yearMonth, fallback = new Date()) {
  const m = String(yearMonth || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return daysInCurrentMonth(fallback);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  return new Date(year, month, 0).getDate();
}
function daysInCurrentMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function currentMonthLabel(d = new Date()) {
  return `${HEBREW_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* Render the "settled previous month + in-progress current month" split
 * beneath the bonus KPI. Reads the prevMonth / currentMonth blocks the Apps
 * Script now sends. Falls back gracefully (renders nothing) if they're absent
 * — e.g. an overview-only payload or an old feed.
 *
 * The current-month projection from the feed (paceAvgDaily / projectedBonus)
 * can over-shoot early in the month when patient stays are dated for the whole
 * month up front: treatmentDaysSoFar then exceeds days-elapsed × patients. To
 * keep the projection honest we recompute the pace as treatmentDaysSoFar capped
 * at (daysElapsed × capacity) is NOT something we can know here, so instead we
 * present the projection as "if the current daily occupancy holds" using the
 * settled avgDaily of the month so far = treatmentDaysSoFar / daysInMonth, which
 * never overshoots. */
function renderMonthSplit_(panel, bonusEl, h) {
  const prev = h && h.prevMonth;
  const cur  = h && h.currentMonth;
  if (!prev && !cur) return;

  let box = panel.querySelector('[data-month-split]');
  if (!box) {
    box = document.createElement('div');
    box.setAttribute('data-month-split', '');
    box.className = 'month-split';
    bonusEl.parentNode.appendChild(box);
  }

  const parts = [];

  if (prev) {
    const label = fmtMonthLabel(prev.month);
    const paid = Number(prev.bonus) || 0;
    const quota = prev.quotaMet ? '' : ' · לא הושלמה מכסת הימים';
    parts.push(
      `<div class="ms-row ms-prev">
         <span class="ms-tag">בונוס ${label} (סופי)</span>
         <span class="ms-amt ${paid > 0 ? 'gold' : 'zero'}">${fmtCurrency(paid)}</span>
         <span class="ms-sub">ממוצע ${fmtNum1_(prev.avgDaily)} מטופלים/יום${quota}</span>
       </div>`
    );
  }

  if (cur) {
    const label = fmtMonthLabel(cur.month);
    // Honest projection: use avg occupancy over the FULL month so far
    // (treatmentDaysSoFar / daysInMonth) rather than the feed's pace, which
    // overshoots when stays are dated for the whole month up front. This
    // never projects above what occupancy actually supports.
    const days = Number(cur.daysInMonth) || 30;
    const avgSoFar = days > 0 ? (Number(cur.treatmentDaysSoFar) || 0) / days : 0;
    const t = window.BonusEligibility.tierForPatients(
      { key: h.key, avgDaily: avgSoFar }, () => 0
    );
    const proj = (t && t.amount) ? t.amount : 0;
    parts.push(
      `<div class="ms-row ms-cur">
         <span class="ms-tag">${label} — מתחיל ב-0 ₪</span>
         <span class="ms-amt zero">0 ₪</span>
         <span class="ms-sub">תחזית אם הקצב יישמר: ${fmtCurrency(proj)} · ${fmtInt(cur.treatmentDaysSoFar)} ימי טיפול עד כה</span>
       </div>`
    );
  }

  box.innerHTML = parts.join('');
}

/* One-decimal number for display (e.g. avgDaily 18.4). */
function fmtNum1_(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 10) / 10).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Bad JSON from ${url} — ${text.slice(0, 160)}`); }
  if (!r.ok) throw new Error((data && data.message) || (data && data.error) || `HTTP ${r.status}`);
  if (data && data.ok === false) throw new Error(data.error || data.message || 'API error');
  return data;
}

function setStatus(text) {
  const el = document.getElementById('footStatus');
  if (el) el.textContent = text;
}

/* ============================================================
   Bonus model (Model A) — patient-count tiers + treatment-days gate.
   The canonical amount logic lives in lib/bonus-eligibility.js. The helpers
   below are thin wrappers so the rest of app.js reads naturally; there is no
   longer a second, competing tier formula in this file.
   ============================================================ */

function treatmentNightsOf(h) {
  if (h?.bonus && Number.isFinite(h.bonus.treatmentNights)) return h.bonus.treatmentNights;
  return h?.treatmentDays ?? 0;
}

/* Treatment-days target for display: matched-tier patients × days-in-month
   (falls back to the eligibility threshold when below any tier). */
function monthlyTargetOf(h) {
  const r = monthlyBonusResult(h);
  if (r.target > 0) return r.target;
  return resolveThreshold(h) * monthDaysOf(h);
}

function continuityCounts(b) {
  const c = (b && b.continuity) || {};
  return {
    maintenance: c.maintenance ?? 0,
    day_2x:      c.day_2x ?? 0,
    day_daily:   c.day_daily ?? 0,
    total:       c.total ?? 0
  };
}

/* ============================================================
   Tabs
   ============================================================ */

function activateTab(key) {
  document.querySelectorAll('.tab').forEach(btn => {
    const on = btn.dataset.tab === key;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('is-active', p.id === `panel-${key}`);
  });

  if (HOUSE_KEYS.includes(key)) {
    loadHouseDetail(key);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (history && history.replaceState) {
    history.replaceState(null, '', `#${key}`);
  }
}

function wireTabs() {
  document.getElementById('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activateTab(btn.dataset.tab);
  });
}

/* ============================================================
   Overview
   ============================================================ */

async function loadOverview() {
  setStatus('טוען סקירה…');
  try {
    const data = await fetchJson('/api/sheets?action=managersOverview');
    state.overview = data;
    const houses = Array.isArray(data.houses) ? data.houses : [];
    houses.forEach(h => { if (h && h.key) state.housesById[h.key] = h; });
    renderOverview(data);
    setStatus(`עודכן ${new Date().toLocaleTimeString('he-IL')}`);
  } catch (err) {
    console.error(err);
    document.getElementById('houseGrid').innerHTML =
      `<div class="loading error">שגיאה בטעינת נתונים: ${err.message}</div>`;
    setStatus('שגיאה בטעינה');
  }
}

function renderOverview(data) {
  const houses = Array.isArray(data.houses) ? data.houses : [];
  const totals = data.totals || {};

  document.getElementById('monthTag').textContent = fmtMonthLabel(data.month);

  const housesAbove = houses.filter(qualifiesMonthly).length;
  const totalActive = totals.activePatients ?? houses.reduce((s, h) => s + (h.patientsNow ?? 0), 0);
  // Sum locally — the backend's totals.totalBonus predates the 80% occupancy gate.
  const totalBonus  = houses.reduce((s, h) => s + totalBonusOf(h), 0);
  const daysInMonth = daysInMonthFromLabel(data.month);
  const daysLeft    = Math.max(0, daysInMonth - new Date().getDate());

  setKpi('kpiHousesAbove', `${housesAbove}/${houses.length || 4}`);
  setKpi('kpiActive',      fmtInt(totalActive));
  setKpi('kpiBonus',       fmtCurrency(totalBonus));
  setKpi('kpiDaysLeft',    fmtInt(daysLeft));

  renderNetworkSpark(houses);

  const grid = document.getElementById('houseGrid');
  grid.innerHTML = '';
  if (!houses.length) {
    grid.innerHTML = '<div class="loading">אין נתוני בתים זמינים</div>';
    return;
  }
  houses.forEach(h => grid.appendChild(buildHouseCard(h)));
}

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('is-skeleton');
  el.textContent = value;
}

function renderNetworkSpark(houses) {
  const el = document.getElementById('networkSpark');
  if (!el) return;
  if (!houses.length) { el.innerHTML = ''; return; }

  const calcMax = Math.max(
    ...houses.map(h => Math.max(h.patientsNow ?? 0, resolveThreshold(h), resolveCapacity(h)))
  ) || 1;

  el.innerHTML = houses.map(h => {
    const occ = h.patientsNow ?? 0;
    const threshold = resolveThreshold(h);
    const cap = resolveCapacity(h);
    const above = qualifiesMonthly(h);
    const occH = Math.round((occ / calcMax) * 100);
    const bepH = Math.round((threshold / calcMax) * 100);
    const capH = Math.round((cap / calcMax) * 100);
    const fullName = h.name || HOUSE_LABELS[h.key]?.name || h.key;
    return `
      <div class="spark-col ${above ? 'above' : 'below'}" data-house="${h.key}">
        <div class="spark-stack">
          <div class="spark-cap" style="height:${capH}%"></div>
          <div class="spark-bar" style="height:${occH}%"></div>
          <div class="spark-bep" style="bottom:${bepH}%"></div>
        </div>
        <div class="spark-label">${fullName}</div>
        <div class="spark-num">${occ}/${cap || '—'}</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.spark-col').forEach(col => {
    col.addEventListener('click', () => activateTab(col.dataset.house));
  });
}

function qualifiesMonthly(h) {
  return window.BonusEligibility.qualifiesMonthly(h, resolveThreshold);
}

function monthDaysOf(h) {
  // Prefer the house-detail payload's month, then the network overview's month,
  // then today. The treatment-days target/gate is computed against actual
  // days-in-month (target = tierPatients × daysInMonth).
  const monthLabel = h?.month || state.overview?.month;
  return daysInMonthFromLabel(monthLabel);
}

/** Monthly bonus AMOUNT — the per-house payable. Tier amount comes from
    end-of-month patient count; it is paid only if treatment-days met the
    95% target gate. Returns the full BonusEligibility result. */
function monthlyBonusResult(h) {
  return window.BonusEligibility.monthlyBonusAmount(h, resolveThreshold, monthDaysOf(h));
}

function monthlyBonusOf(h) {
  return monthlyBonusResult(h).amount;
}

function totalBonusOf(h) {
  const monthly = monthlyBonusOf(h);
  const cont = continuityCounts(h?.bonus || {}).total || 0;
  const quart = h?.bonus?.quarterly || 0;
  return monthly + cont + quart;
}

function buildHouseCard(h) {
  const key = h.key;
  const labels = HOUSE_LABELS[key] || {};
  const name = h.name || labels.name || key;
  const manager = h.manager || labels.manager || '';
  const type = h.type || labels.type || '';
  const occ = Number.isFinite(h.patientsNow) ? h.patientsNow : 0;
  const cap = resolveCapacity(h);
  const threshold = resolveThreshold(h);

  const monthlyResult = monthlyBonusResult(h);
  const target = monthlyResult.target || (threshold * monthDaysOf(h));
  const nights = treatmentNightsOf(h);
  const tier = { tier: monthlyResult.tier, amount: monthlyResult.amount };
  const above = qualifiesMonthly(h);
  const cont = continuityCounts(h.bonus || {});
  const quartly = h.bonus?.quarterly ?? 0;
  const totalBonus = monthlyResult.amount + (cont.total || 0) + (quartly || 0);
  // Eligible by patient count but treatment-days gate not yet met → show a note.
  const showGateNote = monthlyResult.eligible && !monthlyResult.gatePassed;

  const card = document.createElement('div');
  card.className = `house-card ${above ? 'above' : 'below'}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const denominator = cap || Math.max(occ, threshold) || 1;
  const fillPct = Math.min(100, (occ / denominator) * 100);
  const bepPct  = Math.min(100, (threshold / denominator) * 100);

  const nightsShort = target ? Math.max(0, target - nights) : 0;
  const bonusDisplay = totalBonus > 0 ? fmtCurrency(totalBonus) : '0 ₪';
  const bonusClass = totalBonus > 0 ? '' : 'zero';

  const tierBadge = tier.tier > 0
    ? `<span class="tier-pill t${tier.tier}">מדרגה ${tier.tier}</span>`
    : '';

  card.innerHTML = `
    ${above ? '<div class="trophy" aria-label="זכאי לבונוס">🏆</div>' : ''}

    <div class="hc-head">
      <div class="hc-head-text">
        <div class="hc-title">${name}</div>
        <div class="hc-manager">מנהל/ת: ${manager}</div>
        ${type ? `<div class="hc-type">${type}</div>` : ''}
      </div>
      ${above
        ? `<div class="qualify-badge">✓ זכאי לבונוס</div>`
        : `<div class="warn-badge">⚠ לא זכאי</div>`}
    </div>

    <div class="hc-stats">
      <div class="hc-occ">${occ}<small> / ${cap || '—'}</small></div>
      <div class="hc-bep">זכאות לבונוס: <b>${threshold || '—'}</b></div>
    </div>

    <div class="bep-bar">
      <div class="bep-fill" style="width:${fillPct}%"></div>
      <div class="bep-marker" style="right:${bepPct}%"><span>★</span><em>זכאות ${threshold}</em></div>
    </div>

    <div class="hc-nights">
      <span class="hc-nights-label">ימי טיפול החודש</span>
      <span class="hc-nights-value">${fmtInt(nights)} / ${fmtInt(target)}</span>
      ${tierBadge}
    </div>

    ${above
      ? ''
      : `<div class="hc-shortfall">חסרים ${fmtInt(nightsShort)} ימי טיפול ליעד</div>`}

    <div class="hc-bonus">
      <div class="hc-bonus-label">בונוס החודש</div>
      <div class="hc-bonus-value ${bonusClass}">${bonusDisplay}</div>
    </div>
    ${showGateNote ? `<div class="hc-bonus-fallback-note">חסרים ${fmtInt(Math.max(0, Math.ceil(monthlyResult.minRequired - nights)))} ימי טיפול לסף התשלום (95% מ-${fmtInt(target)})</div>` : ''}
  `;

  const go = () => activateTab(key);
  card.addEventListener('click', go);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });

  return card;
}

/* ============================================================
   House detail
   ============================================================ */

async function loadHouseDetail(key) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;

  if (!panel.firstChild) {
    const tpl = document.getElementById('houseDetailTpl');
    panel.appendChild(tpl.content.cloneNode(true));
  }

  if (state.details[key]) {
    renderHouseDetail(key, state.details[key]);
  } else {
    showHouseLoading(panel);
  }

  if (state.loadingDetails[key]) return;
  state.loadingDetails[key] = true;
  try {
    const data = await fetchJson(`/api/sheets?action=managersHouse&house=${encodeURIComponent(key)}`);
    state.details[key] = data;
    renderHouseDetail(key, data);
  } catch (err) {
    console.error(err);
    showHouseError(panel, err);
  } finally {
    state.loadingDetails[key] = false;
  }
}

function showHouseLoading(panel) {
  const banner = panel.querySelector('[data-status-banner]');
  if (banner) banner.innerHTML = '<div class="loading">טוען נתוני בית…</div>';
}
function showHouseError(panel, err) {
  const banner = panel.querySelector('[data-status-banner]');
  if (banner) banner.innerHTML = `<div class="loading error">שגיאה: ${err.message}</div>`;
}

function renderHouseDetail(key, data) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;

  const o = state.housesById[key] || {};
  const merged = { ...o, ...data, key, bonus: { ...(o.bonus || {}), ...(data.bonus || {}) } };
  const labels = HOUSE_LABELS[key] || {};
  const name = data.name || o.name || labels.name || key;
  const manager = data.manager || o.manager || labels.manager || '';
  const threshold = resolveThreshold(merged);
  const occ = Number.isFinite(merged.patientsNow) ? merged.patientsNow : 0;

  const monthlyResult = monthlyBonusResult(merged);
  const target = monthlyResult.target || (threshold * monthDaysOf(merged));
  const nights = treatmentNightsOf(merged);
  const tier = { tier: monthlyResult.tier, amount: monthlyResult.amount };
  const eligible = monthlyResult.eligible;       // by end-of-month patient count
  const paid = monthlyResult.gatePassed && monthlyResult.amount > 0;
  const above = eligible;

  // Compatibility config for the detail-page visualizations. Under Model A the
  // payable amount is the single matched patient-count tier; `base` carries
  // that amount so downstream renders show the correct figure. Tier patient
  // counts come from the canonical per-house table. Quarterly is unchanged.
  const houseCfg = (window.BonusEligibility.HOUSE_BONUS || {})[key] || null;
  const tierTable = (houseCfg && Array.isArray(houseCfg.tiers)) ? houseCfg.tiers.slice() : [];
  const cfg = {
    base: monthlyResult.amount || (tierTable.length ? tierTable[tierTable.length - 1].amount : 0),
    tierTable,                          // [{patients, amount}], highest first
    quarterly: merged.bonus?.quarterlyAmount || merged.bonus?.quarterlyTarget || 5000
  };

  const activity = Array.isArray(data.activity) ? data.activity : [];
  const entries = activity.filter(a => a.kind === 'entry');
  const exits   = activity.filter(a => a.kind === 'exit');

  const totalDaysMonth = daysInMonthFromLabel(data.month);
  const today = new Date();
  const elapsedDays = Math.max(1, Math.min(totalDaysMonth, today.getDate()));
  const dailyAvg = nights / elapsedDays;
  const projection = Math.round(dailyAvg * totalDaysMonth);

  // Status banner
  const banner = panel.querySelector('[data-status-banner]');
  banner.className = 'status-banner ' + (paid ? 'above' : 'below');
  const gapToGate = Math.max(0, Math.ceil(monthlyResult.minRequired - nights));
  banner.innerHTML = paid
    ? `<div class="big-emoji">🏆</div>
       <div>
         <div class="sb-title">${name} — זכאי לבונוס מדרגה ${tier.tier}</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(occ)} מטופלים · ${fmtInt(nights)} ימי טיפול / יעד ${fmtInt(target)} · ${fmtCurrency(tier.amount)}</div>
       </div>`
    : eligible
      ? `<div class="big-emoji">⏳</div>
       <div>
         <div class="sb-title">${name} — זכאי לפי תפוסה, אך חסרים ימי טיפול</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(occ)} מטופלים · ${fmtInt(nights)} ימי טיפול · חסרים ${fmtInt(gapToGate)} לסף 95% (${fmtInt(target)})</div>
       </div>`
      : `<div class="big-emoji">⚠️</div>
       <div>
         <div class="sb-title">${name} — לא זכאי לבונוס החודש</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(occ)} מטופלים · נדרשים ${fmtInt(threshold)} לזכאות</div>
       </div>`;

  // KPI stats
  setStat(panel, 'entries', fmtInt(entries.length || data.entriesMonth || 0));
  setStat(panel, 'exits',   fmtInt(exits.length || data.exitsMonth || 0));
  setStat(panel, 'treatmentDays', fmtInt(nights));

  const cont = continuityCounts(merged.bonus || {});
  const quartly = merged.bonus?.quarterly ?? 0;
  const totalBonus = monthlyResult.amount + (cont.total || 0) + (quartly || 0);
  const showGateNote = monthlyResult.eligible && !monthlyResult.gatePassed;

  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  bonusEl.classList.remove('is-skeleton');
  bonusEl.textContent = fmtCurrency(totalBonus);
  bonusEl.classList.toggle('gold', totalBonus > 0);

  // Show a caveat next to the bonus KPI when the house is eligible by patient
  // count but the monthly amount is withheld because treatment-days are below
  // the 95% target gate.
  let fallbackEl = panel.querySelector('[data-bonus-fallback-note]');
  if (showGateNote) {
    if (!fallbackEl) {
      fallbackEl = document.createElement('div');
      fallbackEl.setAttribute('data-bonus-fallback-note', '');
      fallbackEl.className = 'bonus-fallback-note';
      bonusEl.parentNode.appendChild(fallbackEl);
    }
    fallbackEl.textContent = `חסרים ${fmtInt(gapToGate)} ימי טיפול לסף התשלום (95%)`;
  } else if (fallbackEl) {
    fallbackEl.remove();
  }

  // ── Settled previous month + in-progress current month ────────────────
  // The feed now sends prevMonth (final) and currentMonth (starts at 0 + a
  // projection). We show both so the headline reads as "for <prev month>,
  // settled" and the current month is clearly in-progress, not final.
  renderMonthSplit_(panel, bonusEl, merged);

  // Target bar (treatment-days vs target)
  const denom = Math.max(nights, target, projection, 1);
  const fillPct = Math.min(100, (nights / denom) * 100);
  const bepPct  = Math.min(100, (target / denom) * 100);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', paid);
  panel.querySelector('[data-bep-fill]').style.width = fillPct + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = bepPct + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(target)}`;
  setStat(panel, 'daysSoFar',    fmtInt(nights));
  setStat(panel, 'daysTarget',   fmtInt(target));
  setStat(panel, 'daysProjection', fmtInt(projection));

  renderDailySpark(panel, data.dailyChart || [], threshold, resolveCapacity(merged));

  // "Missing for next tier" card (right after status banner)
  const daysLeftInMonth = Math.max(0, totalDaysMonth - today.getDate());
  const chartData = Array.isArray(data.dailyChart) ? data.dailyChart : [];
  const todayKey2 = today.toISOString().slice(0, 10);
  const pastCounts = chartData
    .filter(p => (p.date || '') <= todayKey2)
    .map(p => Number(p.count) || 0);
  const recentDailyAvg = pastCounts.length
    ? pastCounts.slice(-5).reduce((s, n) => s + n, 0) / Math.min(5, pastCounts.length)
    : (Number(merged.patientsNow) || 0);
  renderNextTierCard(panel, { cfg, target, nights, tier: tier.tier, occ, monthlyResult }, daysLeftInMonth, recentDailyAvg, merged.patientsNow);

  // Tier progress visualization
  renderTierTrack(panel, { cfg, target, nights, tier: tier.tier, occ, monthlyResult });

  // Quarterly progress
  renderQuarterlyTrack(panel, merged, cfg, target);

  // Bonus breakdown (educational) — tier amounts use the new 80%-gate / floor rule
  renderBreakdown(panel, merged, { above, tier: tier.tier, cfg, target, nights, occ, cont, quartly, totalBonus, monthlyResult });

  // Logs
  renderEntries(panel.querySelector('[data-log="entries"]'), entries);
  renderExits(panel.querySelector('[data-log="exits"]'), exits);
}

function setStat(panel, name, value) {
  const el = panel.querySelector(`[data-stat="${name}"]`);
  if (!el) return;
  el.classList.remove('is-skeleton');
  el.textContent = value;
}

function renderDailySpark(panel, chart, bep, capacity) {
  const host = panel.querySelector('[data-daily-spark]');
  if (!host) return;
  if (!chart.length) { host.innerHTML = ''; return; }

  // Y-axis max = capacity (so a bar reaching the top = house at full capacity).
  // Fall back to max-of-data only if capacity is missing.
  const maxV = capacity > 0
    ? capacity
    : Math.max(bep || 0, ...chart.map(p => p.count || 0), 1);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const bepPct = Math.min(100, (bep / maxV) * 100);

  host.innerHTML = `
    <div class="daily-spark">
      ${chart.map(p => {
        const c = Number(p.count) || 0;
        const isFuture = (p.date || '') > todayKey;
        const h = isFuture ? 0 : Math.min(100, (c / maxV) * 100);
        const above = c >= bep;
        const numEl = (isFuture || c <= 0)
          ? ''
          : `<span class="ds-num" style="bottom:calc(${h}% + 3px)">${c}</span>`;
        return `<div class="ds-col ${isFuture ? 'future' : ''} ${above ? 'above' : 'below'}" title="${p.date}: ${c} מטופלים">
          ${numEl}
          <div class="ds-bar" style="height:${h}%"></div>
        </div>`;
      }).join('')}
      <div class="ds-bep-line" style="bottom:${bepPct}%"><em>זכאות ${bep}</em></div>
    </div>
  `;

  const legendLine = panel.querySelector('[data-daily-spark-legend-line]');
  if (legendLine) {
    legendLine.textContent = `הקו הכתום = זכאות לבונוס (${fmtInt(bep)} מטופלים)`;
  }
}

function renderNextTierCard(panel, ctx, daysLeftInMonth, recentDailyAvg, patientsNow) {
  const card = panel.querySelector('[data-next-tier-card]');
  if (!card) return;
  const header = panel.querySelector('[data-next-tier-header]');
  const primary = panel.querySelector('[data-next-tier-primary]');
  const dailyGapEl = panel.querySelector('[data-next-tier-daily-gap]');
  const dailyLabelEl = panel.querySelector('[data-next-tier-daily-label]');
  const cumulativeEl = panel.querySelector('[data-next-tier-cumulative]');
  const statusEl = panel.querySelector('[data-next-tier-status]');
  const jump = panel.querySelector('[data-next-tier-jump]');

  // Patient-count tiers (ascending) and current occupancy.
  const tiersAsc = (ctx.cfg.tierTable || []).slice().sort((a, b) => a.patients - b.patients);
  const occ = Number.isFinite(Number(patientsNow)) ? Number(patientsNow) : Math.round(Number(recentDailyAvg) || 0);
  const mr = ctx.monthlyResult || {};

  // Already at the top tier by count?
  const topTier = tiersAsc[tiersAsc.length - 1];
  if (topTier && occ >= topTier.patients) {
    card.className = 'next-tier-card maxed';
    header.textContent = '🏆 הגעת לבונוס המקסימלי!';
    primary.style.display = 'none';
    cumulativeEl.style.display = 'none';
    statusEl.style.display = 'none';
    jump.style.display = 'none';
    return;
  }

  // Find the next tier above current occupancy.
  const next = tiersAsc.find(t => occ < t.patients) || topTier;
  const current = [...tiersAsc].reverse().find(t => occ >= t.patients) || null;
  const patientsGap = next ? Math.max(0, next.patients - occ) : 0;
  const currentAmt = current ? current.amount : 0;
  const nextAmt = next ? next.amount : 0;

  card.className = 'next-tier-card ' + (current ? 'gold' : 'first-tier');
  primary.style.display = '';
  cumulativeEl.style.display = '';
  statusEl.style.display = '';
  jump.style.display = '';

  header.textContent = current ? 'לבונוס הבא:' : 'לבונוס הראשון:';

  // Primary (huge): patients needed to reach the next tier.
  dailyGapEl.textContent = patientsGap > 0 ? fmtInt(patientsGap) : '✓';
  dailyLabelEl.textContent = patientsGap > 0
    ? `מטופלים חסרים למדרגה הבאה (${fmtInt(next.patients)} · כעת ${fmtInt(occ)})`
    : `נדרש מספר המטופלים למדרגה זו הושג (${fmtInt(occ)})`;

  // Secondary: the treatment-days gate (this is what actually unlocks payment).
  const gapToGate = Math.max(0, Math.ceil((mr.minRequired || 0) - (ctx.nights || 0)));
  cumulativeEl.textContent = mr.gatePassed
    ? `סף ימי הטיפול הושג: ${fmtInt(ctx.nights)} / ${fmtInt(mr.target || ctx.target)} (≥95%)`
    : `סף תשלום: נדרשים ${fmtInt(Math.ceil((mr.minRequired || 0)))} ימי טיפול (95% מ-${fmtInt(mr.target || ctx.target)}) · חסרים ${fmtInt(gapToGate)}`;

  // Status pill reflects whether the bonus is actually payable now.
  if (mr.gatePassed && mr.amount > 0) {
    statusEl.textContent = '🏆 הבונוס החודשי משולם החודש!';
  } else if (mr.eligible && !mr.gatePassed) {
    statusEl.textContent = '⏳ זכאי לפי תפוסה — ממתין לסף ימי הטיפול';
  } else {
    statusEl.textContent = `⚠️ עדיין לא זכאי · נדרשים ${fmtInt((next && next.patients) || 0)} מטופלים`;
  }

  jump.textContent = `הבונוס יקפוץ מ-${fmtCurrency(currentAmt)} ל-${fmtCurrency(nextAmt)}`;
}

function renderTierTrack(panel, ctx) {
  const track = panel.querySelector('[data-tier-track]');
  if (!track) return;

  // Patient-count tiers ascending: [{patients, amount}].
  const tiersAsc = (ctx.cfg.tierTable || []).slice().sort((a, b) => a.patients - b.patients);
  const occ = Number.isFinite(ctx.occ) ? ctx.occ : 0;
  const p1 = tiersAsc[0]?.patients ?? 0;
  const p2 = tiersAsc[1]?.patients ?? p1;
  const p3 = tiersAsc[2]?.patients ?? p2;

  const STOP_POS = { 1: 20, 2: 50, 3: 80 };

  // Map current patient count → track %.
  const fillFor = p => {
    if (p <= 0 || p1 <= 0) return 0;
    if (p <= p1) return (p / p1) * STOP_POS[1];
    if (p <= p2) return STOP_POS[1] + ((p - p1) / Math.max(1, p2 - p1)) * (STOP_POS[2] - STOP_POS[1]);
    if (p <= p3) return STOP_POS[2] + ((p - p2) / Math.max(1, p3 - p2)) * (STOP_POS[3] - STOP_POS[2]);
    return 100;
  };

  // Which tier the current occupancy has reached (by count).
  const reachedTier = occ >= p3 ? 3 : occ >= p2 ? 2 : occ >= p1 ? 1 : 0;

  const stops = track.querySelectorAll('[data-tier-stop]');
  stops.forEach(stop => {
    const idx = parseInt(stop.getAttribute('data-tier-stop'), 10);
    stop.style.left = STOP_POS[idx] + '%';
    stop.classList.toggle('reached', reachedTier >= idx);
    stop.classList.toggle('active',  reachedTier === idx);
  });

  panel.querySelector('[data-ts-nights="1"]').textContent = `${fmtInt(p1)} מטופלים`;
  panel.querySelector('[data-ts-nights="2"]').textContent = `${fmtInt(p2)} מטופלים`;
  panel.querySelector('[data-ts-nights="3"]').textContent = `${fmtInt(p3)} מטופלים`;

  const ta1 = panel.querySelector('[data-ts-amount="1"]');
  const ta2 = panel.querySelector('[data-ts-amount="2"]');
  const ta3 = panel.querySelector('[data-ts-amount="3"]');
  if (ta1) ta1.textContent = fmtCurrency(tiersAsc[0]?.amount || 0);
  if (ta2) ta2.textContent = fmtCurrency(tiersAsc[1]?.amount || 0);
  if (ta3) ta3.textContent = fmtCurrency(tiersAsc[2]?.amount || 0);

  panel.querySelector('[data-tier-fill]').style.width = fillFor(occ) + '%';

  const cur = panel.querySelector('[data-tier-current]');
  if (reachedTier === 0) {
    const need = Math.max(0, p1 - occ);
    cur.className = 'tier-current zero';
    cur.textContent = `${fmtInt(occ)} מטופלים · חסרים ${fmtInt(need)} למדרגה הראשונה (${fmtInt(p1)})`;
  } else if (reachedTier === 3) {
    cur.className = 'tier-current gold max';
    cur.textContent = `${fmtInt(occ)} מטופלים · מדרגה 3 המקסימלית הושגה!`;
  } else {
    const nextP = reachedTier === 1 ? p2 : p3;
    const nextAmt = reachedTier === 1 ? (tiersAsc[1]?.amount || 0) : (tiersAsc[2]?.amount || 0);
    const need = Math.max(0, nextP - occ);
    cur.className = 'tier-current gold';
    cur.textContent = `${fmtInt(occ)} מטופלים · חסרים ${fmtInt(need)} למדרגה ${reachedTier + 1} (${fmtCurrency(nextAmt)})`;
  }
}

function renderQuarterlyTrack(panel, data, cfg, monthlyTarget) {
  const b = data.bonus || {};
  const q = {
    cumulativeNights: b.cumulativeNights ?? b.quarterlyNights ?? 0,
    quarterlyTarget:  b.quarterlyTarget ?? monthlyTarget * 3,
    eligible:         !!(b.quarterlyEligible ?? b.quarterly),
    amount:           b.quarterly ?? 0,
    monthsWindow:     b.quarterlyMonths || b.monthsWindow || ''
  };
  const pct = q.quarterlyTarget > 0
    ? Math.min(100, (q.cumulativeNights / q.quarterlyTarget) * 100)
    : 0;

  const fill = panel.querySelector('[data-quarterly-fill]');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('full', pct >= 100);
  }
  const tgt = panel.querySelector('[data-quarterly-target]');
  if (tgt) tgt.textContent = `${fmtInt(q.cumulativeNights)} / ${fmtInt(q.quarterlyTarget)} ימי טיפול`;

  const note = panel.querySelector('[data-quarterly-note]');
  if (note) {
    if (q.amount > 0) {
      note.className = 'quarterly-note gold';
      note.textContent = `זכאי לבונוס יציבות רבעוני · ${fmtCurrency(q.amount)}${q.monthsWindow ? ' · ' + q.monthsWindow : ''}`;
    } else {
      const need = Math.max(0, q.quarterlyTarget - q.cumulativeNights);
      note.className = 'quarterly-note';
      const windowTxt = q.monthsWindow ? ` (${q.monthsWindow})` : '';
      note.textContent = need > 0
        ? `חסרים ${fmtInt(need)} ימי טיפול במצטבר ל-3 חודשים${windowTxt} עבור בונוס יציבות ${fmtCurrency(cfg.quarterly)}`
        : `בונוס יציבות רבעוני יחושב בסוף החלון${windowTxt}`;
    }
  }
}

function renderBreakdown(panel, data, ctx) {
  const ul = panel.querySelector('[data-breakdown]');
  ul.innerHTML = '';

  // Patient-count tiers from the canonical per-house table. Under Model A the
  // single matched tier is the payable amount, and it is only paid when the
  // treatment-days gate (>= 95% of target) is met.
  const mr = ctx.monthlyResult || { amount: 0, tier: 0, eligible: false, gatePassed: false, target: 0, minRequired: 0, tierPatients: 0 };
  const nights = ctx.nights;
  const tierTable = (ctx.cfg && Array.isArray(ctx.cfg.tierTable)) ? ctx.cfg.tierTable : [];
  // Render lowest tier first for readability.
  const tiersAsc = tierTable.slice().sort((a, b) => a.patients - b.patients);
  const occNow = Number.isFinite(data.patientsNow) ? data.patientsNow : 0;
  const gapToGate = Math.max(0, Math.ceil(mr.minRequired - nights));

  const tierItems = tiersAsc.map((row, i) => {
    const tierNum = i + 1;
    const reachedByCount = occNow >= row.patients;
    const isMatched = mr.tierPatients === row.patients;
    const paidHere = isMatched && mr.gatePassed && mr.amount > 0;
    let formula;
    if (!reachedByCount) {
      formula = `נדרשים ${fmtInt(row.patients)} מטופלים (יש ${fmtInt(occNow)})`;
    } else if (paidHere) {
      formula = `${fmtCurrency(row.amount)} ✓ · ${fmtInt(occNow)} מטופלים · ${fmtInt(nights)}/${fmtInt(mr.target)} ימי טיפול`;
    } else if (isMatched) {
      formula = `מותנה: חסרים ${fmtInt(gapToGate)} ימי טיפול לסף 95% (${fmtInt(mr.target)})`;
    } else {
      formula = `${fmtInt(occNow)} מטופלים — מדרגה גבוהה יותר פעילה`;
    }
    return {
      label: `בונוס מדרגה ${tierNum} (${fmtInt(row.patients)} מטופלים)`,
      formula,
      amount: paidHere ? row.amount : 0,
      zero: !paidHere,
      gold: paidHere
    };
  });

  const continuityFormula = (() => {
    const parts = [];
    if (ctx.cont.maintenance) parts.push(`${ctx.cont.maintenance} תחזוקתי × 100`);
    if (ctx.cont.day_2x)      parts.push(`${ctx.cont.day_2x} יום 2/שבוע × 500`);
    if (ctx.cont.day_daily)   parts.push(`${ctx.cont.day_daily} יום יומי × 1,000`);
    return parts.length ? parts.join(' · ') : 'אין הפניות פעילות החודש';
  })();

  const q = data.bonus || {};
  const monthsWindow = q.quarterlyMonths || q.monthsWindow || 'מאי+יוני+יולי 2026';

  const items = [
    ...tierItems,
    {
      label: 'בונוס יציבות רבעוני',
      formula: ctx.quartly > 0
        ? `${fmtCurrency(ctx.cfg.quarterly)} עבור ${monthsWindow}`
        : `${fmtCurrency(ctx.cfg.quarterly)} עבור 3 חודשים מצטבר (${monthsWindow})`,
      amount: ctx.quartly,
      zero: !ctx.quartly,
      gold: ctx.quartly > 0
    },
    {
      label: 'בונוס הפניות להמשך טיפול',
      formula: continuityFormula,
      amount: ctx.cont.total,
      zero: !ctx.cont.total,
      gold: ctx.cont.total > 0
    }
  ];

  // The monthly bonus is the SINGLE-best tier reached — dim lower tier rows
  // when a higher tier wins so the visual matches "highest reached" semantics.
  const effectiveTier = mr.eligible ? mr.tier : 0;
  items.forEach((item, idx) => {
    const li = document.createElement('li');
    if (item.zero) li.classList.add('zero');
    if (item.gold) li.classList.add('gold');
    if (idx <= 2 && effectiveTier > 0 && effectiveTier !== (idx + 1)) {
      li.classList.add('dim');
    }
    li.innerHTML = `
      <div class="bk-left">
        <span class="bk-label">${item.label}</span>
        <span class="bk-formula">${item.formula}</span>
      </div>
      <span class="bk-amount">${fmtCurrency(item.amount)}</span>
    `;
    ul.appendChild(li);
  });

  panel.querySelector('[data-stat="bonusTotal"]').textContent = fmtCurrency(ctx.totalBonus);
}

function renderEntries(ul, list) {
  ul.innerHTML = '';
  list
    .slice()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="log-date">${fmtDateShort(item.date)}</span>
        <span class="log-name">${item.name || '—'}</span>
      `;
      ul.appendChild(li);
    });
}

function renderExits(ul, list) {
  ul.innerHTML = '';
  list
    .slice()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="log-date">${fmtDateShort(item.date)}</span>
        <span class="log-name">${item.name || '—'}</span>
      `;
      ul.appendChild(li);
    });
}

/* ============================================================
   Boot
   ============================================================ */

function boot() {
  wireTabs();
  document.getElementById('monthTag').textContent = currentMonthLabel();
  loadOverview();

  const hash = (location.hash || '').replace('#', '');
  if (['overview', ...HOUSE_KEYS].includes(hash)) activateTab(hash);

  setInterval(loadOverview, 60_000);
}

document.addEventListener('DOMContentLoaded', boot);
