/* ezone-managers — read-only dashboard
   Talks to /api/sheets which proxies to the existing Apps Script.
   Endpoints:
     /api/sheets?action=managersOverview
     /api/sheets?action=managersHouse&house=<houseKey>
*/

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab'];

const HOUSE_LABELS = {
  raanana: { name: 'רעננה אשר',     manager: 'עידו',  type: 'בית מאזן' },
  ramot:   { name: 'רמות השבים',    manager: 'שחר',   type: 'בית מאזן' },
  efroni:  { name: 'קיסריה עפרוני', manager: 'חנן',   type: 'תחלואה כפולה' },
  rehab:   { name: 'קיסריה ריהאב',  manager: 'רנטה',  type: 'גמילה' }
};

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
function daysRemainingThisMonth(d = new Date()) {
  return Math.max(0, daysInCurrentMonth(d) - d.getDate());
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

  const housesAbove = houses.filter(isAboveBep).length;
  const totalActive = totals.activePatients ?? houses.reduce((s, h) => s + (h.patientsNow ?? 0), 0);
  const totalBonus  = totals.totalBonus ?? houses.reduce((s, h) => s + (h.bonus?.total ?? 0), 0);
  const daysInMonth = daysInMonthFromLabel(data.month);
  const daysLeft    = Math.max(0, daysInMonth - new Date().getDate());

  setKpi('kpiHousesAbove', `${housesAbove}/${houses.length || 4}`);
  setKpi('kpiActive',      fmtInt(totalActive));
  setKpi('kpiBonus',       fmtCurrency(totalBonus));
  setKpi('kpiDaysLeft',    fmtInt(daysLeft));

  // Mini-trend strip — one bar per house, colored by qualification
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

  const maxOcc = Math.max(...houses.map(h => Math.max(h.patientsNow ?? 0, h.bep ?? 0, h.capacity ?? 0))) || 1;

  el.innerHTML = houses.map(h => {
    const occ = h.patientsNow ?? 0;
    const bep = h.bep ?? 0;
    const cap = h.capacity ?? 0;
    const above = isAboveBep(h);
    const occH = Math.round((occ / maxOcc) * 100);
    const bepH = Math.round((bep / maxOcc) * 100);
    const capH = Math.round((cap / maxOcc) * 100);
    return `
      <div class="spark-col ${above ? 'above' : 'below'}" data-house="${h.key}">
        <div class="spark-stack">
          <div class="spark-cap" style="height:${capH}%"></div>
          <div class="spark-bar" style="height:${occH}%"></div>
          <div class="spark-bep" style="bottom:${bepH}%"></div>
        </div>
        <div class="spark-label">${HOUSE_LABELS[h.key]?.name?.split(' ')[0] || h.key}</div>
        <div class="spark-num">${occ}/${cap || '—'}</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.spark-col').forEach(col => {
    col.addEventListener('click', () => activateTab(col.dataset.house));
  });
}

function isAboveBep(h) {
  if (!h) return false;
  if (typeof h.qualifies === 'boolean') return h.qualifies;
  if (typeof h.aboveBep === 'boolean') return h.aboveBep;
  const occ = h.patientsNow ?? h.activePatients ?? h.occupancy ?? 0;
  const bep = h.bep ?? h.netBalancePoint ?? 0;
  return occ >= bep;
}

function buildHouseCard(h) {
  const key = h.key;
  const labels = HOUSE_LABELS[key] || {};
  const name = h.name || labels.name || key;
  const manager = h.manager || labels.manager || '';
  const type = h.type || labels.type || '';
  const occ = h.patientsNow ?? 0;
  const cap = h.capacity ?? 0;
  const bep = h.bep ?? 0;
  const bonus = h.bonus?.total ?? 0;
  const above = isAboveBep(h);

  const card = document.createElement('div');
  card.className = `house-card ${above ? 'above' : 'below'}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const bonusDisplay = above ? fmtCurrency(bonus) : '0 ₪';
  const bonusClass = above ? '' : 'zero';

  const denominator = cap || Math.max(occ, bep) || 1;
  const fillPct = Math.min(100, (occ / denominator) * 100);
  const bepPct  = Math.min(100, (bep / denominator) * 100);

  card.innerHTML = `
    <div class="hc-head">
      <div>
        <div class="hc-title">${name}</div>
        <div class="hc-manager">מנהל/ת: ${manager}</div>
        ${type ? `<div class="hc-type">${type}</div>` : ''}
      </div>
      ${above
        ? '<div class="trophy" aria-label="מעל BEP">🏆</div>'
        : '<div class="warn-badge">⚠ לא זכאי</div>'}
    </div>

    <div class="hc-stats">
      <div class="hc-occ">${occ}<small> / ${cap || '—'}</small></div>
      <div class="hc-bep">BEP: <b>${bep}</b></div>
    </div>

    <div class="bep-bar">
      <div class="bep-fill" style="width:${fillPct}%"></div>
      <div class="bep-marker" style="right:${bepPct}%"><span>★</span><em>BEP ${bep}</em></div>
    </div>

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
  const labels = HOUSE_LABELS[key] || {};
  const name = data.name || o.name || labels.name || key;
  const manager = data.manager || o.manager || labels.manager || '';
  const bep = data.bep ?? o.bep ?? 0;
  const occ = data.patientsNow ?? o.patientsNow ?? 0;
  const above = typeof data.bonus?.qualifies === 'boolean'
    ? data.bonus.qualifies
    : (typeof data.qualifies === 'boolean' ? data.qualifies : isAboveBep(o));

  const activity = Array.isArray(data.activity) ? data.activity : [];
  const entries = activity.filter(a => a.kind === 'entry');
  const exits   = activity.filter(a => a.kind === 'exit');
  const treatmentDays = data.treatmentDays ?? 0;

  const totalDaysMonth = daysInMonthFromLabel(data.month);
  const today = new Date();
  const elapsedDays = Math.max(1, Math.min(totalDaysMonth, today.getDate()));
  const dailyAvg = treatmentDays / elapsedDays;
  const projection = Math.round(dailyAvg * totalDaysMonth);
  const bepDays = bep * totalDaysMonth;

  // Banner
  const banner = panel.querySelector('[data-status-banner]');
  banner.className = 'status-banner ' + (above ? 'above' : 'below');
  banner.innerHTML = above
    ? `<div class="big-emoji">🏆</div>
       <div>
         <div class="sb-title">${name} מעל ה-BEP!</div>
         <div class="sb-sub">מנהל/ת: ${manager} · מטופלים פעילים ${occ} · BEP ${bep}</div>
       </div>`
    : `<div class="big-emoji">⚠️</div>
       <div>
         <div class="sb-title">${name} מתחת ל-BEP — לא זכאי לבונוס החודש</div>
         <div class="sb-sub">מנהל/ת: ${manager} · מטופלים פעילים ${occ} · נדרש ${bep}</div>
       </div>`;

  // KPI stats
  setStat(panel, 'entries', fmtInt(entries.length || data.entriesMonth || 0));
  setStat(panel, 'exits',   fmtInt(exits.length || data.exitsMonth || 0));
  setStat(panel, 'treatmentDays', fmtInt(treatmentDays));
  const totalBonus = above ? (data.bonus?.total ?? 0) : 0;
  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  bonusEl.classList.remove('is-skeleton');
  bonusEl.textContent = above ? fmtCurrency(totalBonus) : '0 ₪';
  bonusEl.classList.toggle('gold', above);

  // BEP bar (treatment days)
  const denom = Math.max(treatmentDays, bepDays, projection, 1);
  const fillPct = Math.min(100, (treatmentDays / denom) * 100);
  const bepPct  = Math.min(100, (bepDays / denom) * 100);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', above);
  panel.querySelector('[data-bep-fill]').style.width = fillPct + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = bepPct + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(bepDays)}`;
  setStat(panel, 'daysSoFar',    fmtInt(treatmentDays));
  setStat(panel, 'daysTarget',   fmtInt(bepDays));
  setStat(panel, 'daysProjection', fmtInt(projection));

  // Sparkline of daily patient count
  renderDailySpark(panel, data.dailyChart || [], bep);

  // Bonus breakdown
  renderBreakdown(panel, data, { above, bep, treatmentDays, bepDays, totalBonus });

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

function renderDailySpark(panel, chart, bep) {
  const host = panel.querySelector('[data-daily-spark]');
  if (!host) return;
  if (!chart.length) { host.innerHTML = ''; return; }

  const maxV = Math.max(bep || 0, ...chart.map(p => p.count || 0), 1);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const bepPct = (bep / maxV) * 100;

  host.innerHTML = `
    <div class="daily-spark">
      ${chart.map(p => {
        const h = ((p.count || 0) / maxV) * 100;
        const isFuture = (p.date || '') > todayKey;
        const above = (p.count || 0) >= bep;
        return `<div class="ds-col ${isFuture ? 'future' : ''} ${above ? 'above' : 'below'}" title="${p.date}: ${p.count}">
          <div class="ds-bar" style="height:${h}%"></div>
        </div>`;
      }).join('')}
      <div class="ds-bep-line" style="bottom:${bepPct}%"><em>BEP ${bep}</em></div>
    </div>
  `;
}

function renderBreakdown(panel, data, ctx) {
  const ul = panel.querySelector('[data-breakdown]');
  ul.innerHTML = '';

  const b = data.bonus || {};
  const base = b.base ?? 0;
  const dailyRate = b.dailyRate ?? data.bonusPerDay ?? 30;
  const aboveBepDays = b.aboveBepDays ?? 0;
  const dailyBonus = b.daily ?? 0;

  const cont = b.continuity || {};
  const counts = {
    maintenance: cont.maintenance ?? 0,
    day_2x:      cont.day_2x ?? 0,
    day_daily:   cont.day_daily ?? 0
  };
  const continuityTotal = cont.total ?? 0;

  const quarterly = b.quarterly ?? 0;
  const consecutive = b.consecutiveAboveBep ?? 0;
  const quarterlyEligible = !!b.quarterlyEligible;

  const items = [
    {
      key: 'base',
      label: 'בונוס בסיס',
      formula: ctx.above
        ? `הגעה ל-${ctx.bep} מטופלים`
        : `דרוש ${ctx.bep} מטופלים — לא הושג`,
      amount: ctx.above ? base : 0,
      zero: !ctx.above,
      gold: ctx.above
    },
    {
      key: 'daily',
      label: 'בונוס יום נוסף',
      formula: ctx.above
        ? `${dailyRate} ₪ × ${fmtInt(aboveBepDays)} ימי טיפול מעל BEP`
        : 'לא זכאי — מתחת ל-BEP',
      amount: dailyBonus,
      zero: !ctx.above || !dailyBonus,
      gold: ctx.above && dailyBonus > 0
    },
    {
      key: 'continuity',
      label: 'בונוס רצף טיפולי',
      formula: ctx.above
        ? continuityFormula(counts)
        : 'לא זכאי — מתחת ל-BEP',
      amount: ctx.above ? continuityTotal : 0,
      zero: !ctx.above || !continuityTotal,
      gold: ctx.above && continuityTotal > 0
    },
    {
      key: 'quarterly',
      label: 'בונוס יציבות רבעוני',
      formula: quarterlyEligible
        ? `5,000 ₪ עבור 3 חודשים רצופים מעל BEP · רצף נוכחי: ${consecutive}`
        : `5,000 ₪ עבור 3 חודשים רצופים מעל BEP (מתחיל מיוני 2026 · רצף נוכחי: ${consecutive})`,
      amount: quarterly,
      zero: !quarterly,
      gold: quarterly > 0
    }
  ];

  items.forEach(item => {
    const li = document.createElement('li');
    if (item.zero) li.classList.add('zero');
    if (item.gold) li.classList.add('gold');
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

function continuityFormula(counts) {
  const parts = [];
  if (counts.maintenance) parts.push(`${counts.maintenance} תחזוקתי × 100`);
  if (counts.day_2x)      parts.push(`${counts.day_2x} יום 2/שבוע × 500`);
  if (counts.day_daily)   parts.push(`${counts.day_daily} יום יומי × 1,000`);
  return parts.length ? parts.join(' · ') : 'אין מטופלים ממשיכים מהבית הזה החודש';
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
