/* ezone-managers — read-only dashboard
   Talks to /api/sheets which proxies to the existing Apps Script.
   Endpoints:
     /api/sheets?action=managersOverview
     /api/sheets?action=managersHouse&house=<houseKey>
*/

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab', 'pardes'];

/* `threshold` = end-of-month patients needed to be eligible for ANY bonus
   (the agreed model: Ramot 18, others 10). This is NOT the internal
   equilibrium point (11/8/8/7) — that point is internal-only and must not
   gate the bonus. `capacity` is the physical bed count. */
const HOUSE_LABELS = {
  raanana: { name: 'רעננה אשר',     manager: 'שחר',   type: 'בית מאזן',     threshold: 10, capacity: 14 },
  ramot:   { name: 'רמות השבים',    manager: 'אורן',  type: 'בית מאזן',     threshold: 17, capacity: 20 },
  efroni:  { name: 'קיסריה עפרוני', manager: 'חנן',   type: 'תחלואה כפולה', threshold: 10, capacity: 13 },
  rehab:   { name: 'קיסריה ריהאב',  manager: 'רנטה',  type: 'גמילה',        threshold: 10, capacity: 13 },
  pardes:  { name: 'רעננה הפרדס',   manager: 'חן',    type: 'תחלואה כפולה', threshold: 10, capacity: 13 }
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
  now: null,            // Date override (tests); null → real clock via now_()
  overview: null,
  housesById: {},
  details: {},
  loadingDetails: {}
};

/* ============================================================
   Utilities
   ============================================================ */

/* Clock — the only place `new Date()` is read for month/day logic. */
function now_() {
  return state.now instanceof Date ? state.now : new Date();
}

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

function daysInMonthFromLabel(yearMonth, fallback = now_()) {
  const m = String(yearMonth || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return daysInCurrentMonth(fallback);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  return new Date(year, month, 0).getDate();
}
function daysInCurrentMonth(d = now_()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function currentMonthLabel(d = now_()) {
  return `${HEBREW_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* Current month as YYYY-MM (local), for "is this the in-progress month?" checks. */
function currentMonthYM_(d = now_()) {
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${m < 10 ? '0' + m : m}`;
}

/* The month before a YYYY-MM label. */
function prevMonthYM_(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  const d = m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 2, 1) : new Date(now_().getFullYear(), now_().getMonth() - 1, 1);
  return currentMonthYM_(d);
}

/* Overview hero — HEADLINE is the SETTLED previous month (winners, or
 * "<month>: אף בית לא עמד בסף"). The running month is a SECONDARY line,
 * always named and marked "בתהליך". All amounts are computed locally. */
function renderWinnersBanner_(houses) {
  const el = document.getElementById('winnersBanner');
  if (!el) return;
  const BV = window.BonusView;
  const po = state.prevOverview;
  const nowYM = state.overview?.month || currentMonthYM_();
  const prevYM = po ? po.month : prevMonthYM_(nowYM);
  const dim = daysInMonthFromLabel(nowYM);
  const dayOfMonth = Math.min(dim, now_().getDate());

  const rows = houses.map(h => {
    const p = prevMonthSettled_(h.key);
    const q = quarterlyLocal_(h.key);
    return {
      name: HOUSE_LABELS[h.key]?.name || BV.safeLabel(h.name) || h.key,
      manager: BV.safeLabel(h.manager) || HOUSE_LABELS[h.key]?.manager || '',
      amount: p ? p.amount : 0,
      tier: p ? p.tier : 0,
      quarterly: q.earned
    };
  });
  const view = BV.winnersBannerView(prevYM, rows, { ym: nowYM, dayOfMonth, daysInMonth: dim });

  const head = `<div class="wb-head"><span class="wb-trophy">🏆</span>
      <span class="wb-title">${view.title}</span></div>`;
  let body;
  if (!po) {
    body = `<div class="wb-none">${BV.monthLabel(prevYM)}: הנתונים לא זמינים</div>`;
  } else if (!view.winners.length) {
    body = `<div class="wb-none">${view.noneText}</div>`;
  } else {
    body = `<div class="wb-chips">${view.winners.map(r => `
      <div class="wb-chip">
        <span class="wb-house">${r.name}</span>
        <span class="wb-manager">${r.manager ? 'מנהל/ת: ' + r.manager : ''}</span>
        <span class="wb-amt">${fmtCurrency(r.total)}</span>
        <span class="wb-detail">${r.text}</span>
      </div>`).join('')}</div>`;
  }
  el.innerHTML = `${head}${body}<div class="wb-current">⏳ ${view.currentLine}</div>`;
  el.hidden = false;
}

/* Settled bonus for a house in a given FINISHED month, computed locally with
 * the canonical rules. Returns the amount, or null when that month's feed is
 * unavailable. */
function settledAmountFor_(key, ym) {
  const byKey = (state.monthOverviews || {})[ym];
  const ph = byKey ? byKey[key] : null;
  if (!ph) return null;
  const r = window.BonusEligibility.monthlyBonusAmount(
    { key, avgDaily: Number(ph.avgDaily) || 0, treatmentDays: Number(ph.treatmentDays) || 0 },
    resolveThreshold, daysInMonthFromLabel(ym)
  );
  return r.amount;
}

/* Quarterly standing for a house — computed LOCALLY (window anchored May 2026:
 * May–Jul, Aug–Oct, ...). A month counts when its settled monthly bonus was
 * >= 2,000; the 5,000 pays only when all 3 finished months met it. */
function quarterlyLocal_(key) {
  const win = state.quarterWindow || [];
  const settled = {};
  win.forEach(ym => {
    const amt = settledAmountFor_(key, ym);
    if (amt !== null) settled[ym] = amt;
  });
  return window.BonusEligibility.quarterlyStatus(win, settled);
}

/* Settled bonus for a house in LAST month — the canonical settledMonthView
 * computed locally from the fetched prev-month overview (raw avgDaily /
 * treatmentDays only). Returns null when that feed is unavailable. */
function prevMonthSettled_(key) {
  const po = state.prevOverview;
  const ph = po && po.byKey ? po.byKey[key] : null;
  if (!ph) return null;
  const v = window.BonusView.settledMonthView(
    { key, ym: po.month, avgDaily: Number(ph.avgDaily) || 0, treatmentDays: Number(ph.treatmentDays) || 0 },
    resolveThreshold
  );
  return { ...v, minRequired: v.gate };
}

/* Settled previous month for a house — prefers the prev-month overview feed,
 * falling back to the raw prevMonth block a house-detail payload may carry.
 * Either way the amount is computed locally; backend bonus fields are never
 * read. */
function settledPrevFor_(h) {
  const fromOverview = prevMonthSettled_(h?.key);
  if (fromOverview) return fromOverview;
  const pm = h && h.prevMonth;
  if (!pm || !pm.month) return null;
  const dim = daysInMonthFromLabel(pm.month);
  const td = Number.isFinite(pm.treatmentDays)
    ? pm.treatmentDays
    : Math.round((Number(pm.avgDaily) || 0) * dim);
  const v = window.BonusView.settledMonthView(
    { key: h.key, ym: pm.month, avgDaily: Number(pm.avgDaily) || 0, treatmentDays: td },
    resolveThreshold
  );
  return { ...v, minRequired: v.gate };
}

/* Two clearly separated month blocks beneath the bonus KPI:
 *   "בונוס <קודם> — סופי (לתשלום)"  final state only
 *   "<נוכחי> — חודש נוכחי (בתהליך)" actual days-so-far + labelled projection
 * Both are computed locally (BonusView); the feed's own bonus fields are
 * never rendered. */
function renderMonthSplit_(panel, bonusEl, h) {
  const BV = window.BonusView;
  const status = monthlyStatus(h);
  const prev = settledPrevFor_(h);
  const cur = status.view;
  const viewingYM = h?.month || state.overview?.month || currentMonthYM_();

  let box = panel.querySelector('[data-month-split]');
  if (!box) {
    box = document.createElement('div');
    box.setAttribute('data-month-split', '');
    box.className = 'month-split';
    bonusEl.parentNode.appendChild(box);
  }

  const parts = [];
  if (prev) {
    parts.push(
      `<div class="ms-row ms-prev ms-headline">
         <span class="ms-tag">${prev.title}</span>
         <span class="ms-amt ${prev.amount > 0 ? 'gold' : 'zero'}">${fmtCurrency(prev.amount)}</span>
         <span class="ms-sub">${prev.statusText} · ממוצע ${fmtNum1_(prev.avgDaily)} מטופלים/יום</span>
       </div>`
    );
  } else {
    parts.push(
      `<div class="ms-row ms-prev ms-headline">
         <span class="ms-tag">בונוס ${BV.monthLabel(prevMonthYM_(viewingYM))} — סופי (לתשלום)</span>
         <span class="ms-amt zero">—</span>
         <span class="ms-sub">הנתונים לא זמינים</span>
       </div>`
    );
  }

  if (cur) {
    parts.push(
      `<div class="ms-row ms-cur">
         <span class="ms-tag">${cur.title}</span>
         <span class="ms-amt ${cur.securedAmount > 0 ? 'gold' : 'zero'}">${fmtCurrency(cur.securedAmount)}</span>
         <span class="ms-sub">${cur.actualLabel}: <b>${cur.actualText}</b><br>${cur.projectionLabel}: ${cur.projectionText}<br>${cur.badge.text}</span>
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

/* ---- session token (HMAC session issued by /api/login) ---- */
const TOKEN_KEY = 'ezm_session_token';

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

async function fetchJson(url) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  if (r.status === 401) {
    setToken('');
    showLogin();
    throw new Error('נדרשת התחברות');
  }
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

    // Fetch every FINISHED month of the current quarter window (plus last
    // month) — the settled "bonus to pay" and the quarterly standing are both
    // computed LOCALLY from those months' raw figures via the canonical rules.
    const nowYM = data.month || currentMonthYM_();
    const prevYM = prevMonthYM_(nowYM);
    const qWindow = window.BonusEligibility.quarterWindowFor(nowYM) || [];
    const finishedMonths = [...new Set([prevYM, ...qWindow.filter(m => m < nowYM)])];
    state.monthOverviews = {};
    await Promise.all(finishedMonths.map(async ym => {
      try {
        const md = await fetchJson(`/api/sheets?action=managersOverview&month=${encodeURIComponent(ym)}`);
        const byKey = {};
        (Array.isArray(md.houses) ? md.houses : []).forEach(ph => {
          if (ph && ph.key) byKey[ph.key] = ph;
        });
        state.monthOverviews[ym] = byKey;
      } catch (e) {
        console.error(`overview for ${ym} failed`, e);
      }
    }));
    state.quarterWindow = qWindow;
    state.prevOverview = state.monthOverviews[prevYM]
      ? { month: prevYM, byKey: state.monthOverviews[prevYM] }
      : null;

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
  const BV = window.BonusView;
  const houses = Array.isArray(data.houses) ? data.houses : [];
  const totals = data.totals || {};
  const nowYM = data.month || currentMonthYM_();
  const nowLabel = BV.monthLabel(nowYM);

  document.getElementById('monthTag').textContent = nowLabel;

  // Houses whose CURRENT-month bonus is already secured (locked in), or a
  // finished month that earned — never merely occupancy-eligible mid-month.
  const housesAbove = houses.filter(h => {
    const s = monthlyStatus(h);
    return s.state === 'locked' || (s.state === 'finished' && s.amount > 0);
  }).length;
  const totalActive = totals.activePatients ?? houses.reduce((s, h) => s + (h.patientsNow ?? 0), 0);
  // Headline money KPI: the SETTLED bonuses to pay for the month that
  // finished, computed locally per house from last month's raw figures.
  const prevYM = state.prevOverview ? state.prevOverview.month : prevMonthYM_(nowYM);
  const prevTotal = houses.reduce((s, h) => {
    const p = prevMonthSettled_(h.key);
    return s + (p ? p.amount : 0);
  }, 0);
  const daysInMonth = daysInMonthFromLabel(nowYM);
  const dayOfMonth = Math.min(daysInMonth, now_().getDate());

  setKpiLabel('kpiHousesAboveLabel', `בתים עם בונוס מובטח — ${nowLabel} (בתהליך)`);
  setKpi('kpiHousesAbove', `${housesAbove}/${houses.length || HOUSE_KEYS.length}`);
  setKpi('kpiActive',      fmtInt(totalActive));
  setKpiLabel('kpiBonusLabel', `בונוס ${BV.monthLabel(prevYM)} — סופי (לתשלום)`);
  setKpi('kpiBonus',       state.prevOverview ? fmtCurrency(prevTotal) : '—');
  setKpiLabel('kpiDaysLabel', `יום בחודש — ${nowLabel}`);
  setKpi('kpiDaysLeft',    `${fmtInt(dayOfMonth)} מתוך ${fmtInt(daysInMonth)}`);
  renderWinnersBanner_(houses);

  renderNetworkSpark(houses);

  const grid = document.getElementById('houseGrid');
  grid.innerHTML = '';
  if (!houses.length) {
    grid.innerHTML = '<div class="loading">אין נתוני בתים זמינים</div>';
    return;
  }
  houses.forEach(h => grid.appendChild(buildHouseCard(h)));
}

function setKpiLabel(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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
  // then today. Used for elapsed-day math and month labels; the bonus GATE is
  // fixed at threshold × 30 and does not depend on days-in-month.
  const monthLabel = h?.month || state.overview?.month;
  return daysInMonthFromLabel(monthLabel);
}

/** Monthly bonus AMOUNT — the per-house payable. Tier amount comes from
    average daily occupancy; it is paid only if treatment-days met the fixed
    house gate (threshold × 30). Returns the full BonusEligibility result. */
function monthlyBonusResult(h) {
  return window.BonusEligibility.monthlyBonusAmount(h, resolveThreshold, monthDaysOf(h));
}

/* SINGLE source of truth for "treatment-days so far this month".
 * Used by the KPI, the hero banner, the progress bar and the house card so
 * they can never disagree. Prefers the house's daily chart (summed up to
 * today), then the feed's treatmentDaysSoFar capped at elapsed × capacity
 * (front-dated stays inflate the raw figure), then treatmentDays. */
function daysSoFarOf_(h) {
  const key = h?.key;
  const monthYM = h?.month || state.overview?.month || currentMonthYM_();
  const isCurrent = monthYM === currentMonthYM_();
  const daysInMonth = daysInMonthFromLabel(monthYM);
  const elapsed = isCurrent ? Math.max(1, Math.min(daysInMonth, now_().getDate())) : daysInMonth;
  const detail = key ? state.details[key] : null;
  const chart = (h && Array.isArray(h.dailyChart) && h.dailyChart.length)
    ? h.dailyChart
    : (detail && Array.isArray(detail.dailyChart) && detail.dailyChart.length) ? detail.dailyChart : null;
  const cur = h?.currentMonth || {};
  return window.BonusView.daysSoFar({
    dailyChart: chart,
    todayKey: window.BonusView.dateKey(now_()),
    isCurrentMonth: isCurrent,
    treatmentDaysSoFar: Number.isFinite(cur.treatmentDaysSoFar) ? cur.treatmentDaysSoFar : undefined,
    treatmentDays: treatmentNightsOf(h),
    elapsedDays: elapsed,
    capacity: resolveCapacity(h)
  });
}

/**
 * Current-month-aware monthly status. The raw monthlyBonusResult treats the
 * month as finished (uses full-month avgDaily/treatmentDays), which would
 * "settle" the bonus mid-month. This wraps it with the actual rule:
 *
 *   - If the month being viewed is NOT the current calendar month, it's a
 *     finished month → use the settled result as-is (earned/0).
 *   - If it IS the current (unfinished) month, build a BonusView
 *     currentMonthView from the single days-so-far figure:
 *       • LOCKED  — days SO FAR already met the fixed house gate
 *                   (threshold × 30) and the average supports a tier.
 *       • PROJECTION — not yet locked. amount is 0 (nothing earned yet);
 *                   the projection is carried SEPARATELY (projectedTier /
 *                   projectedAmount / view.projectionText).
 *
 * The backend's lockedIn / projectedBonus / qualifies flags are ignored.
 *
 * Returns: { state:'finished'|'locked'|'projection', amount, projectedTier,
 *            projectedAmount, securedTier, securedAmount, hasUpside,
 *            daysSoFar, target, minRequired, gapDays, avgSoFar, view }
 *   view = BonusView.currentMonthView (null for finished months)
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
      securedTier: settled.tier,
      securedAmount: settled.amount,
      hasUpside: false,
      daysSoFar: settled.treatmentDays || treatmentNightsOf(h),
      target: settled.target,
      minRequired: settled.minRequired,
      gapDays: 0,
      avgSoFar: Number(h?.avgDaily) || 0,
      view: null
    };
  }

  const cur = h.currentMonth || {};
  const daysInMonth = Number(cur.daysInMonth) || monthDaysOf(h);
  const elapsed = Math.max(1, Math.min(daysInMonth, now_().getDate()));
  const daysSoFar = daysSoFarOf_(h);
  const view = window.BonusView.currentMonthView(
    { key: h.key, ym: viewingMonth, daysSoFar, elapsedDays: elapsed, daysInMonth, capacity: resolveCapacity(h) },
    resolveThreshold
  );
  const locked = view.state === 'locked';

  return {
    state: view.state,
    amount: locked ? view.securedAmount : 0,  // only secured bonuses count toward totals
    projectedTier: view.projectedTier,
    projectedAmount: view.projectedAmount,
    securedTier: view.securedTier,
    securedAmount: view.securedAmount,
    hasUpside: view.projectedTier > view.securedTier && view.projectedAmount > view.securedAmount,
    daysSoFar,
    target: view.gate,
    minRequired: view.gate,
    gapDays: view.gapDays,
    avgSoFar: view.avgSoFar,
    view
  };
}

/** Quarterly amount that may be counted in a total: computed LOCALLY —
    5,000 only when the quarter window is complete and every month's settled
    bonus was >= 2,000. Never counts a projection mid-quarter, and never
    trusts the backend's quarterly math. */
function quarterlyEarnedAmount(h) {
  if (!h || !h.key) return 0;
  return quarterlyLocal_(h.key).earned;
}

function buildHouseCard(h) {
  const BV = window.BonusView;
  const key = h.key;
  const labels = HOUSE_LABELS[key] || {};
  const name = labels.name || BV.safeLabel(h.name) || key;
  // The feed's manager name takes precedence when it is a real name; a numeric
  // or empty value falls back to the hardcoded roster.
  const manager = BV.safeLabel(h.manager) || labels.manager || '';
  // House type comes from the hardcoded roster ONLY. The feed's `type` field
  // is never rendered — a backend figure leaking through it is how a stray
  // "2500" ended up under the manager name.
  const type = labels.type || '';
  const occ = Number.isFinite(h.patientsNow) ? h.patientsNow : 0;
  const cap = resolveCapacity(h);
  const threshold = resolveThreshold(h);

  const status = monthlyStatus(h);   // days-so-far computed ONCE here
  const cur = status.view;           // null when the overview month is finished
  const cont = continuityCounts(h.bonus || {});
  const quartly = quarterlyEarnedAmount(h);
  const secured = status.state === 'locked' || (status.state === 'finished' && status.amount > 0);
  const isProjection = status.state === 'projection';
  const nowYM = h.month || state.overview?.month || currentMonthYM_();
  const nowLabel = BV.monthLabel(nowYM);

  const card = document.createElement('div');
  // Green only when secured; projection and not-eligible are both "below".
  card.className = `house-card ${secured ? 'above' : 'below'}${isProjection ? ' projection' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('data-house-card', key);

  const denominator = cap || Math.max(occ, threshold) || 1;
  const fillPct = Math.min(100, (occ / denominator) * 100);
  const bepPct  = Math.min(100, (threshold / denominator) * 100);

  // ── Block 1: settled previous month (final state only) ──
  const prev = prevMonthSettled_(key);
  const settledBlock = prev
    ? `<div class="hc-month hc-settled ${prev.amount > 0 ? 'earned' : 'not-earned'}" data-month-block="settled">
         <div class="hc-month-head">
           <span class="hc-month-title">${prev.title}</span>
           <span class="hc-month-amt">${fmtCurrency(prev.amount)}</span>
         </div>
         <div class="hc-month-line" data-settled-status>${prev.statusText}</div>
         <div class="hc-month-line dim">ממוצע ${fmtNum1_(prev.avgDaily)} מטופלים/יום · ${fmtInt(prev.treatmentDays)}/${fmtInt(prev.gate)} ימי טיפול</div>
       </div>`
    : `<div class="hc-month hc-settled not-earned" data-month-block="settled">
         <div class="hc-month-head">
           <span class="hc-month-title">בונוס ${BV.monthLabel(prevMonthYM_(nowYM))} — סופי (לתשלום)</span>
           <span class="hc-month-amt">—</span>
         </div>
         <div class="hc-month-line dim">הנתונים לא זמינים</div>
       </div>`;

  // ── Block 2: running month — ACTUAL days-so-far, then a labelled projection ──
  const extras = [];
  if (cont.total > 0) extras.push(`הפניות ${fmtCurrency(cont.total)}`);
  if (quartly > 0) extras.push(`רבעוני ${fmtCurrency(quartly)}`);
  const currentBlock = cur
    ? `<div class="hc-month hc-current ${cur.state}" data-month-block="current">
         <div class="hc-month-head">
           <span class="hc-month-title">${cur.title}</span>
           <span class="hc-month-amt ${cur.securedAmount > 0 ? 'gold' : 'zero'}">${fmtCurrency(cur.securedAmount)}</span>
         </div>
         <div class="hc-month-line" data-current-actual>${cur.actualLabel}: <b>${cur.actualText}</b></div>
         <div class="hc-month-line" data-current-projection>${cur.projectionLabel}: ${cur.projectionText}</div>
         <div class="hc-month-line hc-tier-line" data-tier-line>${cur.badge.text}</div>
         ${extras.length ? `<div class="hc-month-line dim">${extras.join(' · ')}</div>` : ''}
       </div>`
    : `<div class="hc-month hc-current finished" data-month-block="current">
         <div class="hc-month-head">
           <span class="hc-month-title">בונוס ${nowLabel} — סופי (לתשלום)</span>
           <span class="hc-month-amt ${status.amount > 0 ? 'gold' : 'zero'}">${fmtCurrency(status.amount)}</span>
         </div>
         <div class="hc-month-line">${status.amount > 0 ? `זכאי · מדרגה ${status.securedTier} · ${fmtCurrency(status.amount)}` : 'לא זכאי'}</div>
       </div>`;

  // Tier pill ONLY for a secured tier (locked this month / finished & met).
  const tierBadge = secured && status.securedTier > 0
    ? `<span class="tier-pill t${status.securedTier}">מדרגה ${status.securedTier} ✓</span>`
    : '';

  const headBadge = secured
    ? `<div class="qualify-badge">✓ מובטח · ${nowLabel}</div>`
    : isProjection
      ? `<div class="progress-badge">⏳ ${nowLabel} בתהליך</div>`
      : `<div class="warn-badge">⚠ לא זכאי · ${nowLabel}</div>`;

  card.innerHTML = `
    ${secured ? '<div class="trophy" aria-label="זכאי לבונוס">🏆</div>' : ''}

    <div class="hc-head">
      <div class="hc-head-text">
        <div class="hc-title">${name}</div>
        <div class="hc-manager">מנהל/ת: ${manager}</div>
        ${type ? `<div class="hc-type">${type}</div>` : ''}
      </div>
      ${headBadge}
    </div>

    ${settledBlock}
    ${currentBlock}

    <div class="hc-stats">
      <div class="hc-occ">${occ}<small> / ${cap || '—'}</small></div>
      <div class="hc-bep">זכאות לבונוס: <b>${threshold || '—'}</b> מטופלים/יום בממוצע</div>
    </div>

    <div class="bep-bar">
      <div class="bep-fill" style="width:${fillPct}%"></div>
      <div class="bep-marker" style="right:${bepPct}%"><span>★</span><em>זכאות ${threshold}</em></div>
    </div>

    <div class="hc-nights">
      <span class="hc-nights-label">ימי טיפול מתחילת החודש (${nowLabel})</span>
      <span class="hc-nights-value" data-card-days>${fmtInt(status.daysSoFar)} / ${fmtInt(status.target)}</span>
      ${tierBadge}
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
    if (state.overview) renderOverview(state.overview); // card now shares the detail's days-so-far
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
  const BV = window.BonusView;

  const o = state.housesById[key] || {};
  const merged = { ...o, ...data, key, bonus: { ...(o.bonus || {}), ...(data.bonus || {}) } };
  const labels = HOUSE_LABELS[key] || {};
  const name = labels.name || BV.safeLabel(data.name) || BV.safeLabel(o.name) || key;
  const manager = BV.safeLabel(data.manager) || BV.safeLabel(o.manager) || labels.manager || '';
  const threshold = resolveThreshold(merged);
  const occ = Number.isFinite(merged.patientsNow) ? merged.patientsNow : 0;

  const monthlyResult = monthlyBonusResult(merged);
  // ONE status object per render: its daysSoFar is THE days-so-far figure
  // for the hero, the KPI, the progress bar and the breakdown below.
  const status = monthlyStatus(merged);
  const cur = status.view;              // null for a finished month
  const viewingYM = data.month || merged.month || state.overview?.month || currentMonthYM_();
  const viewingLabel = BV.monthLabel(viewingYM);
  const target = status.target;
  const nights = status.daysSoFar;
  const tier = { tier: status.projectedTier, amount: status.projectedAmount };
  const eligible = status.projectedAmount > 0;
  // "paid" means actually secured: a finished month that earned, or a
  // current month already locked in (days-so-far >= the fixed gate).
  const paid = (status.state === 'finished' && status.amount > 0) || status.state === 'locked';
  const above = eligible;

  // Compatibility config for the detail-page visualizations. Tier patient
  // counts come from the canonical per-house table. Quarterly is unchanged.
  const houseCfg = (window.BonusEligibility.HOUSE_BONUS || {})[key] || null;
  const tierTable = (houseCfg && Array.isArray(houseCfg.tiers)) ? houseCfg.tiers.slice() : [];
  const cfg = {
    base: monthlyResult.amount || (tierTable.length ? tierTable[tierTable.length - 1].amount : 0),
    tierTable,                          // [{patients, amount}], highest first
    quarterly: window.BonusEligibility.QUARTERLY_AMOUNT
  };

  const activity = Array.isArray(data.activity) ? data.activity : [];
  const entries = activity.filter(a => a.kind === 'entry');
  const exits   = activity.filter(a => a.kind === 'exit');

  const totalDaysMonth = daysInMonthFromLabel(viewingYM);
  const today = now_();
  // Projection (end-of-month days if the current average holds) — a SEPARATE
  // figure from the actual days-so-far, always labelled "צפי לסוף החודש".
  const projection = cur ? cur.projectedDays : nights;

  // ── Hero banner: headline = SETTLED previous month; running month on a
  //    secondary line, always named and marked "בתהליך". ──
  const prev = settledPrevFor_(merged);
  const hero = BV.houseHeroView({
    name, manager, settled: prev, prevYm: prevMonthYM_(viewingYM), current: cur
  });
  const banner = panel.querySelector('[data-status-banner]');
  banner.className = 'status-banner ' + hero.tone;
  banner.innerHTML = `<div class="big-emoji">${hero.emoji}</div>
     <div>
       <div class="sb-name">${name}</div>
       <div class="sb-title" data-hero-headline>${hero.headline}</div>
       <div class="sb-sub">${hero.sub}</div>
       ${cur ? `<div class="sb-current" data-hero-current>⏳ ${hero.secondary}</div>` : ''}
     </div>`;

  // KPI stats — every label names its month.
  setStat(panel, 'entries', fmtInt(entries.length || data.entriesMonth || 0));
  setStat(panel, 'exits',   fmtInt(exits.length || data.exitsMonth || 0));
  setStatLabel(panel, 'treatmentDays', cur ? `ימי טיפול עד כה — ${viewingLabel} (בתהליך)` : `ימי טיפול — ${viewingLabel}`);
  setStat(panel, 'treatmentDays', fmtInt(nights));

  const cont = continuityCounts(merged.bonus || {});
  const quartly = quarterlyEarnedAmount(merged);
  // Only secured monthly (locked/finished) + actually-earned quarterly.
  const totalBonus = status.amount + (cont.total || 0) + (quartly || 0);

  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  setStatLabel(panel, 'bonus', cur ? `מובטח עד כה — ${viewingLabel} (בתהליך)` : `בונוס ${viewingLabel} — סופי`);
  bonusEl.classList.remove('is-skeleton');
  bonusEl.textContent = fmtCurrency(totalBonus);
  bonusEl.classList.toggle('gold', totalBonus > 0);

  // Caveat next to the running-month bonus KPI: the projection (labelled) and
  // the next-tier line — never a tier presented as achieved.
  let fallbackEl = panel.querySelector('[data-bonus-fallback-note]');
  if (cur && status.state === 'projection') {
    if (!fallbackEl) {
      fallbackEl = document.createElement('div');
      fallbackEl.setAttribute('data-bonus-fallback-note', '');
      fallbackEl.className = 'bonus-fallback-note';
      bonusEl.parentNode.appendChild(fallbackEl);
    }
    fallbackEl.textContent = `${cur.projectionLabel}: ${cur.projectionText} · ${cur.badge.text}`;
  } else if (fallbackEl) {
    fallbackEl.remove();
  }

  // ── Settled previous month + in-progress current month (two blocks) ──
  renderMonthSplit_(panel, bonusEl, merged);

  // Target bar (treatment-days so far vs the fixed gate)
  const chartTitle = panel.querySelector('[data-chart-title]');
  if (chartTitle) {
    chartTitle.textContent = cur
      ? `ימי טיפול — ${viewingLabel} (בתהליך, נספר מה-1 בחודש)`
      : `ימי טיפול — ${viewingLabel} (סופי)`;
  }
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
  const todayKey2 = BV.dateKey(today);
  const pastCounts = chartData
    .filter(p => (p.date || '') <= todayKey2)
    .map(p => Number(p.count) || 0);
  const recentDailyAvg = pastCounts.length
    ? pastCounts.slice(-5).reduce((s, n) => s + n, 0) / Math.min(5, pastCounts.length)
    : (Number(merged.patientsNow) || 0);
  renderNextTierCard(panel, { key, cfg, target, nights, tier: tier.tier, occ, monthlyResult, status }, daysLeftInMonth, recentDailyAvg, merged.patientsNow);

  // Tier progress visualization
  renderTierTrack(panel, { key, cfg, target, nights, tier: tier.tier, occ, monthlyResult, status });

  // Quarterly progress
  renderQuarterlyTrack(panel, merged, cfg, target);

  // Bonus breakdown (educational)
  renderBreakdown(panel, merged, { above, tier: tier.tier, cfg, target, nights, occ, cont, quartly, totalBonus, monthlyResult, status });

  // Logs
  renderEntries(panel.querySelector('[data-log="entries"]'), entries);
  renderExits(panel.querySelector('[data-log="exits"]'), exits);
}

function setStatLabel(panel, name, text) {
  const el = panel.querySelector(`[data-stat-label="${name}"]`);
  if (el) el.textContent = text;
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
  const today = now_();
  const todayKey = window.BonusView.dateKey(today);
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

  const atTopTier = current && (!next || next.amount <= current.amount);
  header.textContent = atTopTier ? 'מדרגה עליונה:' : current ? 'לבונוס הבא:' : 'לבונוס הראשון:';

  // Primary (huge): patients needed to reach the next tier.
  dailyGapEl.textContent = patientsGap > 0 ? fmtInt(patientsGap) : '✓';
  dailyLabelEl.textContent = patientsGap > 0
    ? `מטופלים חסרים למדרגה הבאה (${fmtInt(next.patients)} · כעת ${fmtInt(occ)})`
    : `נדרש מספר המטופלים למדרגה זו הושג (${fmtInt(occ)})`;

  // Secondary: the treatment-days gate (this is what actually unlocks payment).
  // Target and min-required come from the status object (days-so-far basis) so
  // this line matches the banner and the KPIs rather than the full-month result.
  const gateTarget = st.target || ctx.target || 0;
  const gateMin = Math.ceil(st.minRequired || 0);
  const gatePassed = gateMin > 0 && (ctx.nights || 0) >= gateMin;
  const gapToGate = Math.max(0, gateMin - (ctx.nights || 0));
  cumulativeEl.textContent = gatePassed
    ? `סף ימי הטיפול הושג: ${fmtInt(ctx.nights)} / ${fmtInt(gateTarget)}`
    : `סף תשלום: נדרשים ${fmtInt(gateMin)} ימי טיפול · חסרים ${fmtInt(gapToGate)}`;

  // Status pill reflects whether the bonus is actually SECURED now (locked or
  // finished-and-earned). Mid-month projection must not say "paid".
  if (secured && st.amount > 0) {
    statusEl.textContent = '🏆 הבונוס החודשי מובטח החודש!';
  } else if (st.state === 'projection' && st.view) {
    // Running month: name the month, the ACTUAL days so far and the NEXT tier.
    const v = st.view;
    statusEl.textContent = `⏳ ${v.title} · ${v.actualText} · ${v.badge.text}`;
  } else if (st.state === 'projection') {
    statusEl.textContent = `⏳ בתהליך · ${fmtInt(st.daysSoFar)}/${fmtInt(st.target)} ימי טיפול`;
  } else {
    statusEl.textContent = `⚠️ עדיין לא זכאי · נדרשים ${fmtInt((next && next.patients) || 0)} מטופלים`;
  }

  // Only show the "jump" line when there's a genuinely HIGHER tier to reach.
  // At the top tier (next === current amount), a "from X to X" line is
  // meaningless, so hide it.
  const hasHigherTier = next && current && next.amount > current.amount;
  if (hasHigherTier) {
    jump.style.display = '';
    jump.textContent = `הבונוס יקפוץ מ-${fmtCurrency(currentAmt)} ל-${fmtCurrency(nextAmt)}`;
  } else if (next && !current) {
    // Below the first tier: heading toward the first bonus.
    jump.style.display = '';
    jump.textContent = `בונוס ראשון: ${fmtCurrency(nextAmt)}`;
  } else {
    jump.style.display = 'none';
  }
}

function renderTierTrack(panel, ctx) {
  const track = panel.querySelector('[data-tier-track]');
  if (!track) return;
  const BV = window.BonusView;

  // Patient-count tiers ascending: [{patients, amount}].
  const tiersAsc = (ctx.cfg.tierTable || []).slice().sort((a, b) => a.patients - b.patients);
  const p1 = tiersAsc[0]?.patients ?? 0;
  const p2 = tiersAsc[1]?.patients ?? p1;
  const p3 = tiersAsc[2]?.patients ?? p2;

  const STOP_POS = { 1: 20, 2: 50, 3: 80 };

  // Map an average daily occupancy → track %.
  const fillFor = p => {
    if (p <= 0 || p1 <= 0) return 0;
    if (p <= p1) return (p / p1) * STOP_POS[1];
    if (p <= p2) return STOP_POS[1] + ((p - p1) / Math.max(1, p2 - p1)) * (STOP_POS[2] - STOP_POS[1]);
    if (p <= p3) return STOP_POS[2] + ((p - p2) / Math.max(1, p3 - p2)) * (STOP_POS[3] - STOP_POS[2]);
    return 100;
  };

  // A tier is "reached" ONLY when it is secured: locked in this month, or a
  // finished month that earned it. Mid-month occupancy alone never lights a
  // tier — it only moves the fill and the "next tier" line.
  const st = ctx.status || {};
  const secured = st.state === 'locked' || (st.state === 'finished' && st.amount > 0);
  const securedTier = secured ? (st.securedTier || 0) : 0;
  const avg = st.view ? st.view.avgSoFar : (Number(st.avgSoFar) || (Number.isFinite(ctx.occ) ? ctx.occ : 0));
  const badge = st.view ? st.view.badge : BV.tierBadgeView({ key: ctx.key, achievedTier: securedTier, achievedAmount: st.amount, avgDaily: avg });
  const nextIdx = badge.achieved ? 0 : (badge.nextTier || 0);

  const stops = track.querySelectorAll('[data-tier-stop]');
  stops.forEach(stop => {
    const idx = parseInt(stop.getAttribute('data-tier-stop'), 10);
    stop.style.left = STOP_POS[idx] + '%';
    stop.classList.toggle('reached', securedTier >= idx);
    stop.classList.toggle('active',  securedTier === idx || (securedTier === 0 && nextIdx === idx));
  });

  panel.querySelector('[data-ts-nights="1"]').textContent = `${fmtInt(p1)} מטופלים/יום`;
  panel.querySelector('[data-ts-nights="2"]').textContent = `${fmtInt(p2)} מטופלים/יום`;
  panel.querySelector('[data-ts-nights="3"]').textContent = `${fmtInt(p3)} מטופלים/יום`;

  const ta1 = panel.querySelector('[data-ts-amount="1"]');
  const ta2 = panel.querySelector('[data-ts-amount="2"]');
  const ta3 = panel.querySelector('[data-ts-amount="3"]');
  if (ta1) ta1.textContent = fmtCurrency(tiersAsc[0]?.amount || 0);
  if (ta2) ta2.textContent = fmtCurrency(tiersAsc[1]?.amount || 0);
  if (ta3) ta3.textContent = fmtCurrency(tiersAsc[2]?.amount || 0);

  panel.querySelector('[data-tier-fill]').style.width = fillFor(avg) + '%';

  const cur = panel.querySelector('[data-tier-current]');
  if (securedTier >= 3) {
    cur.className = 'tier-current gold max';
    cur.textContent = `מדרגה 3 המקסימלית מובטחת ✓ · ממוצע ${fmtNum1_(avg)} מטופלים/יום`;
  } else if (securedTier > 0) {
    cur.className = 'tier-current gold';
    cur.textContent = `מדרגה ${securedTier} מובטחת ✓ · ${BV.tierBadgeView({ key: ctx.key, avgDaily: avg }).text}`;
  } else {
    cur.className = 'tier-current zero';
    cur.textContent = badge.text;
  }
}

function renderQuarterlyTrack(panel, data, cfg, monthlyTarget) {
  // Quarterly standing is computed LOCALLY from the finished months of the
  // anchored window (May–Jul 2026, Aug–Oct, ...) — never from backend fields.
  const q = quarterlyLocal_(data.key);
  const monthsMet      = q.monthsMet;
  const monthsRequired = q.monthsRequired;
  const monthsElapsed  = q.monthsFinished;
  const amount         = q.earned;
  const quarterlyMax   = window.BonusEligibility.QUARTERLY_AMOUNT;
  const windowTxt      = q.window.length ? q.window.map(fmtMonthLabel).join(' · ') : '';

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
  // treatment-days gate (threshold × 30) is met.
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
      // current month, projected toward this tier but not yet locked
      formula = st.view
        ? `${st.view.label} בתהליך · ${st.view.actualLabel}: ${st.view.actualText} · ${st.view.projectionLabel}: ${st.view.projectionText}`
        : `בתהליך · ${fmtInt(st.daysSoFar)}/${fmtInt(st.target)} ימי טיפול`;
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

  // Quarterly line — LOCAL standing (anchored window), no backend fields.
  const q = quarterlyLocal_(data.key);
  const qWindow = q.window.length ? q.window.map(fmtMonthLabel).join(' · ') : '';
  const qMet = q.monthsMet;
  const qReq = q.monthsRequired;

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
  const effectiveTier = secured ? (st.securedTier || 0) : 0;
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

/* ---- login overlay ---- */
function showLogin() {
  const ov = document.getElementById('loginOverlay');
  if (!ov) return;
  ov.hidden = false;
  const pin = document.getElementById('loginPin');
  if (pin) { pin.value = ''; setTimeout(() => pin.focus(), 50); }
}

function hideLogin() {
  const ov = document.getElementById('loginOverlay');
  if (ov) ov.hidden = true;
}

function setLoginError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

async function submitLogin() {
  const pinEl = document.getElementById('loginPin');
  const btn = document.getElementById('loginBtn');
  const pin = (pinEl && pinEl.value || '').trim();
  if (!pin) { setLoginError('נא להזין קוד'); return; }
  setLoginError('');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.token) {
      setLoginError(data.error || 'קוד שגוי');
      return;
    }
    setToken(data.token);
    hideLogin();
    startData();
  } catch {
    setLoginError('שגיאת רשת. נסו שוב.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireLogin() {
  const btn = document.getElementById('loginBtn');
  const pin = document.getElementById('loginPin');
  if (btn) btn.addEventListener('click', submitLogin);
  if (pin) pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });
}

let dataStarted = false;
function startData() {
  if (dataStarted) return;
  dataStarted = true;
  loadOverview();
  setInterval(loadOverview, 60_000);
}

function boot() {
  wireTabs();
  wireLogin();
  document.getElementById('monthTag').textContent = currentMonthLabel();

  const hash = (location.hash || '').replace('#', '');
  if (['overview', ...HOUSE_KEYS].includes(hash)) activateTab(hash);

  if (getToken()) {
    startData(); // token verified server-side; a 401 will re-show the login
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', boot);
