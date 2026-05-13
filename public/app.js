/* ezone-managers — read-only dashboard
   Talks to /api/sheets which proxies to the existing Apps Script.
   Endpoints:
     /api/sheets?action=managersOverview
     /api/sheets?action=managersHouse&house=<houseKey>
*/

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab'];

const HOUSE_LABELS = {
  raanana: { name: 'רעננה אשר',     manager: 'עידו',  type: 'בית מאזן',     bep: 8,  capacity: 14 },
  ramot:   { name: 'רמות השבים',    manager: 'שחר',   type: 'בית מאזן',     bep: 11, capacity: 20 },
  efroni:  { name: 'קיסריה עפרוני', manager: 'חנן',   type: 'תחלואה כפולה', bep: 8,  capacity: 12 },
  rehab:   { name: 'קיסריה ריהאב',  manager: 'רנטה',  type: 'גמילה',        bep: 7,  capacity: 13 }
};

function resolveBep(h) {
  if (!h) return 0;
  if (h.bep) return h.bep;
  if (h.bonus?.bep) return h.bonus.bep;
  if (h.bonus?.monthlyTarget) return Math.round(h.bonus.monthlyTarget / 30);
  return HOUSE_LABELS[h.key]?.bep || 0;
}
function resolveCapacity(h) {
  if (!h) return 0;
  if (h.capacity) return h.capacity;
  return HOUSE_LABELS[h.key]?.capacity || 0;
}

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const DEFAULT_TIER_CFG = {
  base: 2000,
  tier2Threshold: 30,
  tier2Amount: 2500,
  tier3Threshold: 60,
  tier3Amount: 3500,
  quarterly: 5000
};

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
   Bonus model — tiered monthly + cumulative quarterly
   ============================================================ */

function tierConfigFor(h) {
  const b = (h && h.bonus) || {};
  return {
    base: b.base || b.tier1Amount || DEFAULT_TIER_CFG.base,
    tier2Threshold: b.tier2Threshold ?? DEFAULT_TIER_CFG.tier2Threshold,
    tier2Amount:    b.tier2Amount    || DEFAULT_TIER_CFG.tier2Amount,
    tier3Threshold: b.tier3Threshold ?? DEFAULT_TIER_CFG.tier3Threshold,
    tier3Amount:    b.tier3Amount    || DEFAULT_TIER_CFG.tier3Amount,
    quarterly:      b.quarterlyAmount || b.quarterlyTarget || DEFAULT_TIER_CFG.quarterly
  };
}

function monthlyTargetOf(h) {
  if (h && h.bonus && Number.isFinite(h.bonus.monthlyTarget)) return h.bonus.monthlyTarget;
  return resolveBep(h) * 30;
}

function treatmentNightsOf(h) {
  if (h?.bonus && Number.isFinite(h.bonus.treatmentNights)) return h.bonus.treatmentNights;
  return h?.treatmentDays ?? 0;
}

/** Compute monthly bonus tier from treatment-nights vs target. */
function computeMonthlyBonus(nights, target, cfg) {
  if (nights < target) return { tier: 0, amount: 0 };
  if (nights >= target + cfg.tier3Threshold) return { tier: 3, amount: cfg.tier3Amount };
  if (nights >= target + cfg.tier2Threshold) return { tier: 2, amount: cfg.tier2Amount };
  return { tier: 1, amount: cfg.base };
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
  const totalBonus  = totals.totalBonus ?? houses.reduce((s, h) => s + monthlyBonusOf(h), 0);
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
    ...houses.map(h => Math.max(h.patientsNow ?? 0, resolveBep(h), resolveCapacity(h)))
  ) || 1;

  el.innerHTML = houses.map(h => {
    const occ = h.patientsNow ?? 0;
    const bep = resolveBep(h);
    const cap = resolveCapacity(h);
    const above = qualifiesMonthly(h);
    const occH = Math.round((occ / calcMax) * 100);
    const bepH = Math.round((bep / calcMax) * 100);
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
  if (!h) return false;
  if (typeof h.bonus?.qualifies === 'boolean') return h.bonus.qualifies;
  if (typeof h.qualifies === 'boolean') return h.qualifies;
  const nights = treatmentNightsOf(h);
  const target = monthlyTargetOf(h);
  return target > 0 && nights >= target;
}

function monthlyBonusOf(h) {
  if (h?.bonus && Number.isFinite(h.bonus.monthly)) return h.bonus.monthly;
  if (h?.bonus && Number.isFinite(h.bonus.total)) {
    const cont = continuityCounts(h.bonus).total || 0;
    const quart = h.bonus.quarterly || 0;
    return Math.max(0, h.bonus.total - cont - quart);
  }
  const cfg = tierConfigFor(h);
  const target = monthlyTargetOf(h);
  return computeMonthlyBonus(treatmentNightsOf(h), target, cfg).amount;
}

function buildHouseCard(h) {
  const key = h.key;
  const labels = HOUSE_LABELS[key] || {};
  const name = h.name || labels.name || key;
  const manager = h.manager || labels.manager || '';
  const type = h.type || labels.type || '';
  const occ = Number.isFinite(h.patientsNow) ? h.patientsNow : 0;
  const cap = resolveCapacity(h);
  const bep = resolveBep(h);

  const cfg = tierConfigFor(h);
  const target = monthlyTargetOf(h);
  const nights = treatmentNightsOf(h);
  const tier = computeMonthlyBonus(nights, target, cfg);
  const above = tier.tier > 0;
  const cont = continuityCounts(h.bonus || {});
  const quartly = h.bonus?.quarterly ?? 0;
  const totalBonus = (above ? tier.amount : 0) + (cont.total || 0) + (quartly || 0);

  const card = document.createElement('div');
  card.className = `house-card ${above ? 'above' : 'below'}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const denominator = cap || Math.max(occ, bep) || 1;
  const fillPct = Math.min(100, (occ / denominator) * 100);
  const bepPct  = Math.min(100, (bep / denominator) * 100);

  const nightsShort = target ? Math.max(0, target - nights) : 0;
  const bonusDisplay = above ? fmtCurrency(totalBonus) : '0 ₪';
  const bonusClass = above ? '' : 'zero';

  const tierBadge = above
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
      <div class="hc-bep">זכאות לבונוס: <b>${bep || '—'}</b></div>
    </div>

    <div class="bep-bar">
      <div class="bep-fill" style="width:${fillPct}%"></div>
      <div class="bep-marker" style="right:${bepPct}%"><span>★</span><em>זכאות ${bep}</em></div>
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
  const bep = resolveBep(merged);
  const occ = Number.isFinite(merged.patientsNow) ? merged.patientsNow : 0;

  const cfg = tierConfigFor(merged);
  const target = monthlyTargetOf(merged);
  const nights = treatmentNightsOf(merged);
  const tier = computeMonthlyBonus(nights, target, cfg);
  const above = tier.tier > 0;

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
  banner.className = 'status-banner ' + (above ? 'above' : 'below');
  const nightsShort = Math.max(0, target - nights);
  banner.innerHTML = above
    ? `<div class="big-emoji">🏆</div>
       <div>
         <div class="sb-title">${name} — זכאי לבונוס מדרגה ${tier.tier}</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(nights)} ימי טיפול / יעד ${fmtInt(target)} · ${fmtCurrency(tier.amount)}</div>
       </div>`
    : `<div class="big-emoji">⚠️</div>
       <div>
         <div class="sb-title">${name} — לא זכאי לבונוס החודש</div>
         <div class="sb-sub">מנהל/ת: ${manager} · ${fmtInt(nights)} ימי טיפול · חסרים ${fmtInt(nightsShort)} ליעד ${fmtInt(target)}</div>
       </div>`;

  // KPI stats
  setStat(panel, 'entries', fmtInt(entries.length || data.entriesMonth || 0));
  setStat(panel, 'exits',   fmtInt(exits.length || data.exitsMonth || 0));
  setStat(panel, 'treatmentDays', fmtInt(nights));

  const cont = continuityCounts(merged.bonus || {});
  const quartly = merged.bonus?.quarterly ?? 0;
  const totalBonus = (above ? tier.amount : 0) + (cont.total || 0) + (quartly || 0);

  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  bonusEl.classList.remove('is-skeleton');
  bonusEl.textContent = fmtCurrency(totalBonus);
  bonusEl.classList.toggle('gold', totalBonus > 0);

  // BEP bar (treatment-nights vs target)
  const denom = Math.max(nights, target, projection, 1);
  const fillPct = Math.min(100, (nights / denom) * 100);
  const bepPct  = Math.min(100, (target / denom) * 100);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', above);
  panel.querySelector('[data-bep-fill]').style.width = fillPct + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = bepPct + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(target)}`;
  setStat(panel, 'daysSoFar',    fmtInt(nights));
  setStat(panel, 'daysTarget',   fmtInt(target));
  setStat(panel, 'daysProjection', fmtInt(projection));

  renderDailySpark(panel, data.dailyChart || [], bep, resolveCapacity(merged));

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
  renderNextTierCard(panel, { cfg, target, nights, tier: tier.tier }, daysLeftInMonth, recentDailyAvg, merged.patientsNow);

  // Tier progress visualization
  renderTierTrack(panel, { cfg, target, nights, tier: tier.tier });

  // Quarterly progress
  renderQuarterlyTrack(panel, merged, cfg, target);

  // Bonus breakdown (educational)
  renderBreakdown(panel, merged, { above, tier: tier.tier, cfg, target, nights, cont, quartly, totalBonus });

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

  const tierNum = ctx.tier;

  if (tierNum >= 3) {
    card.className = 'next-tier-card maxed';
    header.textContent = '🏆 הגעת לבונוס המקסימלי!';
    primary.style.display = 'none';
    cumulativeEl.style.display = 'none';
    statusEl.style.display = 'none';
    jump.style.display = 'none';
    return;
  }

  let nextThr, nextAmt, currentAmt;
  if (tierNum === 0) {
    nextThr = ctx.target;
    nextAmt = ctx.cfg.base;
    currentAmt = 0;
  } else if (tierNum === 1) {
    nextThr = ctx.target + ctx.cfg.tier2Threshold;
    nextAmt = ctx.cfg.tier2Amount;
    currentAmt = ctx.cfg.base;
  } else {
    nextThr = ctx.target + ctx.cfg.tier3Threshold;
    nextAmt = ctx.cfg.tier3Amount;
    currentAmt = ctx.cfg.tier2Amount;
  }

  // DAILY threshold: average daily occupancy needed across the standard 30-day model.
  const dailyThreshold = Math.round(nextThr / 30);
  const curAvg = Number(recentDailyAvg) || 0;
  const dailyNow = Number.isFinite(Number(patientsNow))
    ? Number(patientsNow)
    : Math.round(curAvg);
  const dailyGap = Math.max(0, dailyThreshold - dailyNow);

  // CUMULATIVE gap + on-track projection (separate dimension from daily).
  const cumulativeGap = Math.max(0, nextThr - ctx.nights);
  const projected = ctx.nights + curAvg * Math.max(0, daysLeftInMonth || 0);
  const achieved = ctx.nights >= nextThr;
  const onTrack  = !achieved && projected >= nextThr;
  const behind   = !achieved && !onTrack;

  // Card state class
  let stateClass = tierNum === 0 ? 'first-tier' : 'gold';
  if (achieved) stateClass = 'achieved';
  else if (onTrack) stateClass += ' on-track';
  else if (behind)  stateClass += ' behind';
  card.className = 'next-tier-card ' + stateClass;

  primary.style.display = '';
  cumulativeEl.style.display = '';
  statusEl.style.display = '';
  jump.style.display = '';

  header.textContent = tierNum === 0 ? 'לבונוס הראשון:' : 'לבונוס הבא:';

  // Primary (huge): daily gap
  dailyGapEl.textContent = fmtInt(dailyGap);
  dailyLabelEl.textContent = dailyGap > 0
    ? `מטופלים חסרים היום לסף הזכאות (${fmtInt(dailyThreshold)} · כעת ${fmtInt(dailyNow)})`
    : `הסף היומי הושג! (${fmtInt(dailyNow)} ≥ ${fmtInt(dailyThreshold)})`;

  // Secondary: cumulative info
  cumulativeEl.textContent = achieved
    ? `יעד חודשי הושג: ${fmtInt(ctx.nights)} / ${fmtInt(nextThr)} ימי טיפול`
    : `במצטבר: עוד ${fmtInt(cumulativeGap)} ימי טיפול נדרשים החודש (נצברו ${fmtInt(ctx.nights)} מתוך ${fmtInt(nextThr)})`;

  // Status pill
  if (achieved) {
    statusEl.textContent = '🏆 הבונוס החודשי הושג!';
  } else if (onTrack) {
    statusEl.textContent = `🎯 במסלול ליעד החודשי · תחזית ${fmtInt(Math.round(projected))} ≥ ${fmtInt(nextThr)}`;
  } else {
    statusEl.textContent = `⚠️ מאחור בקצב · תחזית ${fmtInt(Math.round(projected))} < ${fmtInt(nextThr)}`;
  }

  // Jump amount
  jump.textContent = `הבונוס יקפוץ מ-${fmtCurrency(currentAmt)} ל-${fmtCurrency(nextAmt)}`;
}

function renderTierTrack(panel, ctx) {
  const track = panel.querySelector('[data-tier-track]');
  if (!track) return;

  const t1 = ctx.target;
  const t2 = ctx.target + ctx.cfg.tier2Threshold;
  const t3 = ctx.target + ctx.cfg.tier3Threshold;

  // Fixed proportional positions so circles don't bunch when thresholds are small.
  const STOP_POS = { 1: 20, 2: 50, 3: 80 };

  // Piecewise-linear map from nights → track %.
  const fillFor = n => {
    if (n <= 0) return 0;
    if (n <= t1) return (n / t1) * STOP_POS[1];
    if (n <= t2) return STOP_POS[1] + ((n - t1) / Math.max(1, t2 - t1)) * (STOP_POS[2] - STOP_POS[1]);
    if (n <= t3) return STOP_POS[2] + ((n - t2) / Math.max(1, t3 - t2)) * (STOP_POS[3] - STOP_POS[2]);
    return Math.min(100, STOP_POS[3] + ((n - t3) / Math.max(1, t3 * 0.1)) * (100 - STOP_POS[3]));
  };

  // Position stops along track (LTR within RTL doc)
  const stops = track.querySelectorAll('[data-tier-stop]');
  stops.forEach(stop => {
    const idx = parseInt(stop.getAttribute('data-tier-stop'), 10);
    stop.style.left = STOP_POS[idx] + '%';
    stop.classList.toggle('reached', ctx.tier >= idx);
    stop.classList.toggle('active',  ctx.tier === idx);
  });

  panel.querySelector('[data-ts-nights="1"]').textContent = `${fmtInt(t1)} ימי טיפול`;
  panel.querySelector('[data-ts-nights="2"]').textContent = `${fmtInt(t2)} ימי טיפול`;
  panel.querySelector('[data-ts-nights="3"]').textContent = `${fmtInt(t3)} ימי טיפול`;

  const ta1 = panel.querySelector('[data-ts-amount="1"]');
  const ta2 = panel.querySelector('[data-ts-amount="2"]');
  const ta3 = panel.querySelector('[data-ts-amount="3"]');
  if (ta1) ta1.textContent = fmtCurrency(ctx.cfg.base);
  if (ta2) ta2.textContent = fmtCurrency(ctx.cfg.tier2Amount);
  if (ta3) ta3.textContent = fmtCurrency(ctx.cfg.tier3Amount);

  panel.querySelector('[data-tier-fill]').style.width = fillFor(ctx.nights) + '%';

  const cur = panel.querySelector('[data-tier-current]');
  if (ctx.tier === 0) {
    const need = Math.max(0, t1 - ctx.nights);
    cur.className = 'tier-current zero';
    cur.textContent = `נצברו ${fmtInt(ctx.nights)} ימי טיפול · חסרים ${fmtInt(need)} למדרגה הראשונה`;
  } else if (ctx.tier === 3) {
    cur.className = 'tier-current gold max';
    cur.textContent = `נצברו ${fmtInt(ctx.nights)} ימי טיפול · מדרגה 3 המקסימלית הושגה!`;
  } else {
    const nextThr = ctx.tier === 1 ? t2 : t3;
    const nextAmt = ctx.tier === 1 ? ctx.cfg.tier2Amount : ctx.cfg.tier3Amount;
    const need = Math.max(0, nextThr - ctx.nights);
    cur.className = 'tier-current gold';
    cur.textContent = `נצברו ${fmtInt(ctx.nights)} ימי טיפול · חסרים ${fmtInt(need)} למדרגה ${ctx.tier + 1} (${fmtCurrency(nextAmt)})`;
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

  const t1 = ctx.target;
  const t2 = ctx.target + ctx.cfg.tier2Threshold;
  const t3 = ctx.target + ctx.cfg.tier3Threshold;
  const nights = ctx.nights;

  const tier1Status = ctx.tier >= 1
    ? `${fmtCurrency(ctx.cfg.base)} ✓`
    : `חסרים ${fmtInt(Math.max(0, t1 - nights))} ימי טיפול ליעד ${fmtInt(t1)}`;

  const tier2Status = ctx.tier >= 2
    ? `${fmtCurrency(ctx.cfg.tier2Amount)} ✓`
    : `חסרים ${fmtInt(Math.max(0, t2 - nights))} ימי טיפול ל-${fmtInt(t2)}`;

  const tier3Status = ctx.tier >= 3
    ? `${fmtCurrency(ctx.cfg.tier3Amount)} ✓ (מקסימום)`
    : `חסרים ${fmtInt(Math.max(0, t3 - nights))} ימי טיפול ל-${fmtInt(t3)}`;

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
    {
      label: `בונוס מדרגה 1 (יעד ${fmtInt(t1)} ימי טיפול)`,
      formula: tier1Status,
      amount: ctx.tier >= 1 ? ctx.cfg.base : 0,
      zero: ctx.tier < 1,
      gold: ctx.tier >= 1
    },
    {
      label: `בונוס מדרגה 2 (+${ctx.cfg.tier2Threshold} ימי טיפול)`,
      formula: tier2Status,
      amount: ctx.tier >= 2 ? ctx.cfg.tier2Amount : 0,
      zero: ctx.tier < 2,
      gold: ctx.tier >= 2,
      // tier 2 replaces tier 1, so dim tier 1 visually
      replaces: ctx.tier >= 2
    },
    {
      label: `בונוס מדרגה 3 (+${ctx.cfg.tier3Threshold} ימי טיפול · מקס׳)`,
      formula: tier3Status,
      amount: ctx.tier >= 3 ? ctx.cfg.tier3Amount : 0,
      zero: ctx.tier < 3,
      gold: ctx.tier >= 3,
      replaces: ctx.tier >= 3
    },
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

  // The monthly bonus is the SINGLE-best tier — show all three but only the highest reached counts.
  // For tier display: dim the lower tiers when a higher tier is reached so the sum visually matches.
  items.forEach((item, idx) => {
    const li = document.createElement('li');
    if (item.zero) li.classList.add('zero');
    if (item.gold) li.classList.add('gold');
    if (idx <= 2 && ctx.tier > 0 && ctx.tier !== (idx + 1)) {
      // a different tier won — dim this one
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
