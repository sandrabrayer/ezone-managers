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

/* Current month as YYYY-MM (local), for "is this the in-progress month?" checks. */
function currentMonthYM_(d = new Date()) {
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${m < 10 ? '0' + m : m}`;
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

/**
 * Current-month-aware monthly status. The raw monthlyBonusResult treats the
 * month as finished (uses full-month avgDaily/treatmentDays), which would
 * "settle" the bonus mid-month. This wraps it with the actual rule:
 *
 *   - If the month being viewed is NOT the current calendar month, it's a
 *     finished month → use the settled result as-is (earned/0).
 *   - If it IS the current (unfinished) month:
 *       • LOCKED  — treatment-days SO FAR already >= 95% of the target for the
 *                   tier they're on track for. The bonus can no longer be lost,
 *                   so show it as guaranteed (gold).
 *       • PROJECTION — not yet locked. Show 0 as the amount (nothing earned
 *                   yet) plus the tier they're heading toward and the gap in
 *                   treatment-days needed to guarantee it.
 *
 * Returns: { state:'finished'|'locked'|'projection',
 *            amount,            // shekels to count toward the total (0 if projection)
 *            projectedTier, projectedAmount,
 *            daysSoFar, target, minRequired, gapDays }
 */
function monthlyStatus(h) {
  const settled = monthlyBonusResult(h);
  const viewingMonth = h?.month || state.overview?.month || currentMonthYM_();
  const isCurrent = viewingMonth === currentMonthYM_();

  if (!isCurrent) {
    return {
      state: 'finished',
      amount: settled.amount,
      projectedTier: settled.tier,
      projectedAmount: settled.amount,
      daysSoFar: settled.treatmentDays || treatmentNightsOf(h),
      target: settled.target,
      minRequired: settled.minRequired,
      gapDays: 0
    };
  }

  // Current month — work from days accrued SO FAR. Prefer the backend's
  // currentMonth block, which now reports TRUE elapsed-days (treatmentDaysSoFar
  // counts only days up to today) plus a lockedIn flag and projection. If those
  // fields are present we trust them directly; otherwise we fall back to a
  // local computation.
  const cur = h.currentMonth || {};
  const daysInMonth = Number(cur.daysInMonth) || monthDaysOf(h);
  const daysSoFar = Number.isFinite(cur.treatmentDaysSoFar)
    ? cur.treatmentDaysSoFar
    : treatmentNightsOf(h);

  if (cur && (cur.lockedIn !== undefined || cur.projectedBonus !== undefined)) {
    const projectedAmount = Number(cur.projectedBonus) || 0;
    const locked = !!cur.lockedIn;
    const lockedAmount = Number(cur.lockedAmount) || projectedAmount;
    // Recover the tier patients for the projected amount to size the gap text.
    const t = window.BonusEligibility.tierForPatients(
      { key: h.key, avgDaily: Number(cur.paceAvgDaily) || 0 }, resolveThreshold
    );
    const tierPatients = (t && t.tierPatients) || 0;
    const target = tierPatients * daysInMonth;
    const minRequired = Math.ceil(0.95 * target);
    return {
      state: locked ? 'locked' : 'projection',
      amount: locked ? lockedAmount : 0,
      projectedTier: Number(cur.projectedTier) || (t ? t.tier : 0),
      projectedAmount: locked ? lockedAmount : projectedAmount,
      daysSoFar,
      target,
      minRequired,
      gapDays: Math.max(0, minRequired - daysSoFar)
    };
  }

  // Fallback: local computation (older feed without lockedIn).
  // avg-so-far = daysSoFar / elapsed days, projected over the full month.
  const todayDate = new Date().getDate();
  const elapsed = Math.max(1, Math.min(daysInMonth, todayDate));
  // Cap the so-far average at the house capacity: front-dated stays can make
  // daysSoFar/elapsed exceed what beds physically allow, which would project an
  // impossibly high tier. Capacity is the real ceiling.
  const capacity = resolveCapacity(h) || Infinity;
  const avgSoFar = Math.min(capacity, daysSoFar / elapsed);
  const projTier = window.BonusEligibility.tierForPatients(
    { key: h.key, avgDaily: avgSoFar }, resolveThreshold
  );
  const projectedAmount = (projTier && projTier.amount) || 0;
  const tierPatients = (projTier && projTier.tierPatients) || 0;

  // Target & 95% gate for that tier, measured against days SO FAR.
  const target = tierPatients * daysInMonth;
  const minRequired = Math.ceil(0.95 * target);
  const locked = projectedAmount > 0 && daysSoFar >= minRequired;
  const gapDays = Math.max(0, minRequired - daysSoFar);

  return {
    state: locked ? 'locked' : 'projection',
    amount: locked ? projectedAmount : 0,    // only count locked bonuses in totals
    projectedTier: projTier ? projTier.tier : 0,
    projectedAmount,
    daysSoFar,
    target,
    minRequired,
    gapDays
  };
}

/** Quarterly amount that may be counted in a total: only the actually-earned
    amount the backend reports (0 until the quarter is complete & all months
    met). Never count projected quarterly mid-quarter. */
function quarterlyEarnedAmount(h) {
  const b = h && h.bonus ? h.bonus : {};
  // The backend sets quarterly>0 only when complete && all months met.
  return Number(b.quarterly) || 0;
}

function monthlyBonusOf(h) {
  return monthlyBonusResult(h).amount;
}

function totalBonusOf(h) {
  const monthly = monthlyStatus(h).amount;       // locked/finished only; 0 if mid-month projection
  const cont = continuityCounts(h?.bonus || {}).total || 0;
  const quart = quarterlyEarnedAmount(h);         // 0 until quarter complete & all months met
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
  const status = monthlyStatus(h);
  const target = monthlyResult.target || (threshold * monthDaysOf(h));
  const nights = treatmentNightsOf(h);
  const tier = { tier: status.projectedTier, amount: status.projectedAmount };
  const above = qualifiesMonthly(h);
  const cont = continuityCounts(h.bonus || {});
  const quartly = quarterlyEarnedAmount(h);
  // Only LOCKED/finished monthly bonuses and an actually-earned quarterly are
  // counted. A mid-month projection contributes 0 to the displayed total.
  const totalBonus = status.amount + (cont.total || 0) + (quartly || 0);
  // Mid-month, not yet locked: show how far they are from guaranteeing it.
  const showGateNote = status.state === 'projection';

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
      <div class="hc-bonus-label">${status.state === 'projection' ? 'בונוס החודש (בתהליך)' : status.state === 'locked' ? 'בונוס החודש ✓ מובטח' : 'בונוס החודש'}</div>
      <div class="hc-bonus-value ${bonusClass}">${bonusDisplay}</div>
    </div>
    ${status.state === 'projection'
      ? (status.projectedAmount > 0
          ? `<div class="hc-bonus-fallback-note">בדרך למדרגה ${status.projectedTier} (${fmtCurrency(status.projectedAmount)}) · חסרים ${fmtInt(status.gapDays)} ימי טיפול כדי להבטיח</div>`
          : `<div class="hc-bonus-fallback-note">עדיין לא בטווח זכאות · ${fmtInt(status.daysSoFar)} ימי טיפול עד כה</div>`)
      : ''}
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
  const status = monthlyStatus(merged);
  const target = monthlyResult.target || (threshold * monthDaysOf(merged));
  const nights = treatmentNightsOf(merged);
  const tier = { tier: status.projectedTier, amount: status.projectedAmount };
  const eligible = status.projectedAmount > 0;
  // "paid" now means actually secured: a finished month that earned, or a
  // current month already locked in (days-so-far >= 95% of target).
  const paid = (status.state === 'finished' && status.amount > 0) || status.state === 'locked';
  const isProjection = status.state === 'projection';
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

  // Treatment-days SO FAR — count only days that have actually elapsed this
  // month. The raw `nights` (treatmentDays) counts every day a patient's stay
  // covers, including days still in the future when stays are dated for the
  // whole month up front. Summing the daily chart up to today gives the honest
  // accrued-so-far figure (e.g. 18 patients × 3 elapsed days = 54, not 540).
  const isCurrentMonth = (data.month || '') === currentMonthYM_();
  const elapsedDays = isCurrentMonth
    ? Math.max(1, Math.min(totalDaysMonth, today.getDate()))
    : totalDaysMonth;
  const todayKey0 = today.toISOString().slice(0, 10);
  let nightsSoFar = nights;
  if (Array.isArray(data.dailyChart) && data.dailyChart.length) {
    nightsSoFar = data.dailyChart.reduce((sum, p) => {
      const d = p && p.date ? String(p.date) : '';
      if (isCurrentMonth && d > todayKey0) return sum; // skip future days
      return sum + (Number(p && p.count) || 0);
    }, 0);
  }

  // Pace = avg daily occupancy over the days elapsed so far.
  const dailyAvg = elapsedDays > 0 ? nightsSoFar / elapsedDays : 0;
  // Projection: if the current daily occupancy holds for the rest of the
  // month, the month ends at ~ dailyAvg × totalDaysMonth.
  const projection = Math.round(dailyAvg * totalDaysMonth);

  // Status banner
  const banner = panel.querySelector('[data-status-banner]');
  const isLocked   = status.state === 'locked' || (status.state === 'finished' && status.amount > 0);
  const isProject  = status.state === 'projection';
  banner.className = 'status-banner ' + (isLocked ? 'above' : 'below');
  if (isLocked) {
    // Guaranteed (finished-and-earned, or current month already locked in).
    const lockNote = status.state === 'locked' ? ' (מובטח)' : '';
    banner.innerHTML = `<div class="big-emoji">🏆</div>
       <div>
         <div class="sb-title">${name} — זכאי לבונוס מדרגה ${status.projectedTier}${lockNote}</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(occ)} מטופלים · ${fmtInt(status.daysSoFar)} ימי טיפול · ${fmtCurrency(status.amount)}</div>
       </div>`;
  } else if (isProject && status.projectedAmount > 0) {
    // On track for a tier but not yet secured.
    banner.innerHTML = `<div class="big-emoji">⏳</div>
       <div>
         <div class="sb-title">${name} — בדרך למדרגה ${status.projectedTier} (עדיין לא הושג)</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(occ)} מטופלים · חסרים ${fmtInt(status.gapDays)} ימי טיפול כדי להבטיח ${fmtCurrency(status.projectedAmount)}</div>
       </div>`;
  } else {
    banner.innerHTML = `<div class="big-emoji">⚠️</div>
       <div>
         <div class="sb-title">${name} — לא זכאי לבונוס החודש</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(occ)} מטופלים · נדרשים ${fmtInt(threshold)} לזכאות</div>
       </div>`;
  }

  // KPI stats
  setStat(panel, 'entries', fmtInt(entries.length || data.entriesMonth || 0));
  setStat(panel, 'exits',   fmtInt(exits.length || data.exitsMonth || 0));
  setStat(panel, 'treatmentDays', fmtInt(nights));

  const cont = continuityCounts(merged.bonus || {});
  const quartly = quarterlyEarnedAmount(merged);
  // Only secured monthly (locked/finished) + actually-earned quarterly.
  const totalBonus = status.amount + (cont.total || 0) + (quartly || 0);
  const showGateNote = isProjection;

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
    fallbackEl.textContent = status.projectedAmount > 0
      ? `בדרך למדרגה ${status.projectedTier} (${fmtCurrency(status.projectedAmount)}) · חסרים ${fmtInt(status.gapDays)} ימי טיפול כדי להבטיח`
      : `עדיין לא בטווח זכאות · ${fmtInt(status.daysSoFar)} ימי טיפול עד כה`;
  } else if (fallbackEl) {
    fallbackEl.remove();
  }

  // ── Settled previous month + in-progress current month ────────────────
  // The feed now sends prevMonth (final) and currentMonth (starts at 0 + a
  // projection). We show both so the headline reads as "for <prev month>,
  // settled" and the current month is clearly in-progress, not final.
  renderMonthSplit_(panel, bonusEl, merged);

  // Target bar (treatment-days so far vs target)
  const denom = Math.max(nightsSoFar, target, projection, 1);
  const fillPct = Math.min(100, (nightsSoFar / denom) * 100);
  const bepPct  = Math.min(100, (target / denom) * 100);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', paid);
  panel.querySelector('[data-bep-fill]').style.width = fillPct + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = bepPct + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(target)}`;
  setStat(panel, 'daysSoFar',    fmtInt(nightsSoFar));
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
  renderNextTierCard(panel, { cfg, target, nights, tier: tier.tier, occ, monthlyResult, status }, daysLeftInMonth, recentDailyAvg, merged.patientsNow);

  // Tier progress visualization
  renderTierTrack(panel, { cfg, target, nights, tier: tier.tier, occ, monthlyResult });

  // Quarterly progress
  renderQuarterlyTrack(panel, merged, cfg, target);

  // Bonus breakdown (educational) — tier amounts use the new 80%-gate / floor rule
  renderBreakdown(panel, merged, { above, tier: tier.tier, cfg, target, nights, occ, cont, quartly, totalBonus, monthlyResult, status });

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
  const st = ctx.status || {};
  const secured = st.state === 'locked' || (st.state === 'finished' && st.amount > 0);
  // Only celebrate "max bonus reached" when the top tier is actually SECURED
  // (locked/finished). Mid-month, even at top occupancy, it's still in
  // progress — show the projection toward it instead.
  if (topTier && occ >= topTier.patients && secured && st.amount >= topTier.amount) {
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

  // Status pill reflects whether the bonus is actually SECURED now (locked or
  // finished-and-earned). Mid-month projection must not say "paid".
  if (secured && st.amount > 0) {
    statusEl.textContent = '🏆 הבונוס החודשי מובטח החודש!';
  } else if (st.state === 'projection' && st.projectedAmount > 0) {
    statusEl.textContent = `⏳ בדרך למדרגה ${st.projectedTier} — חסרים ${fmtInt(st.gapDays)} ימי טיפול כדי להבטיח`;
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
  const monthsMet      = Number(b.quarterlyMonthsMet) || 0;
  const monthsRequired = Number(b.quarterlyMonthsRequired) || 3;
  const monthsElapsed  = Number(b.quarterlyMonthsElapsed) || 0;
  const amount         = Number(b.quarterly) || 0;
  const quarterlyMax   = Number(b.quarterlyAmount) || cfg.quarterly || 5000;
  const window         = Array.isArray(b.quarterlyWindow) ? b.quarterlyWindow : [];
  const windowTxt      = window.length ? window.map(fmtMonthLabel).join(' · ') : '';

  // Bar fills by months met out of 3.
  const pct = monthsRequired > 0 ? Math.min(100, (monthsMet / monthsRequired) * 100) : 0;
  const fill = panel.querySelector('[data-quarterly-fill]');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('full', monthsMet >= monthsRequired);
  }

  // Target label: months met + the theoretical accrued fraction.
  const tgt = panel.querySelector('[data-quarterly-target]');
  if (tgt) {
    const fracText = monthsMet > 0 ? ` · ${fmtCurrency(Math.round(quarterlyMax * monthsMet / monthsRequired))} תאורטי` : '';
    tgt.textContent = `${monthsMet} מתוך ${monthsRequired} חודשים שעמדו בסף${fracText}`;
  }

  const note = panel.querySelector('[data-quarterly-note]');
  if (note) {
    if (amount > 0) {
      note.className = 'quarterly-note gold';
      note.textContent = `זכאי לבונוס יציבות רבעוני · ${fmtCurrency(amount)}${windowTxt ? ' · ' + windowTxt : ''}`;
    } else {
      note.className = 'quarterly-note';
      const wtxt = windowTxt ? ` (${windowTxt})` : '';
      // Show theoretical progress instead of a bare "missing".
      const monthsLeft = Math.max(0, monthsRequired - monthsElapsed);
      note.textContent = monthsMet > 0
        ? `נצברו ${monthsMet}/${monthsRequired} חודשים עבור בונוס יציבות ${fmtCurrency(quarterlyMax)} · יחושב בסוף הרבעון${wtxt}`
        : `בונוס יציבות ${fmtCurrency(quarterlyMax)} — נדרשים ${monthsRequired} חודשים רצופים מעל הסף · יחושב בסוף הרבעון${wtxt}`;
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
  const st = ctx.status || { state: 'finished', amount: 0, projectedTier: 0, projectedAmount: 0, daysSoFar: 0, target: 0, minRequired: 0, gapDays: 0 };
  const nights = ctx.nights;
  const tierTable = (ctx.cfg && Array.isArray(ctx.cfg.tierTable)) ? ctx.cfg.tierTable : [];
  // Render lowest tier first for readability.
  const tiersAsc = tierTable.slice().sort((a, b) => a.patients - b.patients);
  const occNow = Number.isFinite(data.patientsNow) ? data.patientsNow : 0;
  const secured = (st.state === 'finished' && st.amount > 0) || st.state === 'locked';

  const tierItems = tiersAsc.map((row, i) => {
    const tierNum = i + 1;
    const matchedAmount = secured ? st.amount : st.projectedAmount;
    const isMatched = matchedAmount > 0 && row.amount === matchedAmount;
    const securedHere = isMatched && secured;
    let formula;
    if (!isMatched) {
      formula = `נדרש ממוצע ${fmtInt(row.patients)} מטופלים/יום`;
    } else if (securedHere) {
      formula = `${fmtCurrency(row.amount)} ✓ מובטח · ${fmtInt(st.daysSoFar)}/${fmtInt(st.target)} ימי טיפול`;
    } else {
      // current month, on track for this tier but not yet locked
      formula = `בדרך לכאן — חסרים ${fmtInt(st.gapDays)} ימי טיפול כדי להבטיח (${fmtInt(st.daysSoFar)}/${fmtInt(st.minRequired)})`;
    }
    return {
      label: `בונוס מדרגה ${tierNum} (${fmtInt(row.patients)} מטופלים)`,
      formula,
      amount: securedHere ? row.amount : 0,
      zero: !securedHere,
      gold: securedHere
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
  const qWindow = Array.isArray(q.quarterlyWindow) && q.quarterlyWindow.length
    ? q.quarterlyWindow.map(fmtMonthLabel).join(' · ')
    : 'מאי · יוני · יולי 2026';
  const qMet = Number(q.quarterlyMonthsMet) || 0;
  const qReq = Number(q.quarterlyMonthsRequired) || 3;

  const items = [
    ...tierItems,
    {
      label: 'בונוס יציבות רבעוני',
      formula: ctx.quartly > 0
        ? `${fmtCurrency(ctx.cfg.quarterly)} · כל ${qReq} החודשים עמדו בסף (${qWindow})`
        : `${qMet}/${qReq} חודשים שעמדו בסף · יחושב בסוף הרבעון (${qWindow})`,
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
