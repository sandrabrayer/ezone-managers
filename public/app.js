/* ezone-managers — read-only dashboard
   Talks to /api/sheets which proxies to the existing Apps Script.
   Endpoints:
     /api/sheets?action=managersOverview
     /api/sheets?action=managersHouse&key=<houseKey>
*/

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab'];

const HOUSE_LABELS = {
  raanana: { name: 'רעננה אשר',   manager: 'עידו',  type: 'בית מאזן' },
  ramot:   { name: 'רמות השבים',  manager: 'שחר',   type: 'בית מאזן' },
  efroni:  { name: 'קיסריה עפרוני', manager: 'חנן',  type: 'תחלואה כפולה' },
  rehab:   { name: 'קיסריה ריהאב',  manager: 'רנטה', type: 'גמילה' }
};

const CONTINUITY_LABELS = {
  maintenance:  { label: 'טיפול תחזוקתי', rate: 100,  cls: 'maintenance' },
  dayProgram:   { label: 'תוכנית יום 2/שבוע', rate: 500,  cls: 'day-program' },
  daily:        { label: 'תוכנית יום יומית', rate: 1000, cls: 'daily' },
  none:         { label: 'לא ממשיך', rate: 0, cls: 'none' }
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

function daysInCurrentMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function daysRemainingThisMonth(d = new Date()) {
  return Math.max(0, daysInCurrentMonth(d) - d.getDate());
}
function currentMonthLabel(d = new Date()) {
  return `${HEBREW_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function continuityKey(raw) {
  if (!raw) return 'none';
  const s = String(raw).toLowerCase();
  if (s.includes('daily') || s.includes('יומי')) return 'daily';
  if (s.includes('day') || s.includes('תוכנית יום') || s.includes('2x')) return 'dayProgram';
  if (s.includes('maint') || s.includes('תחזוק')) return 'maintenance';
  if (s.includes('none') || s.includes('ללא') || s === 'no' || s === '-') return 'none';
  return 'none';
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Bad JSON from ${url}: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(data && data.message || `HTTP ${r.status}`);
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
      `<div class="loading">שגיאה בטעינת נתונים: ${err.message}</div>`;
    setStatus('שגיאה בטעינה');
  }
}

function renderOverview(data) {
  const houses = Array.isArray(data.houses) ? data.houses : [];

  const monthLabel = data.monthLabel || currentMonthLabel();
  document.getElementById('monthTag').textContent = monthLabel;

  const housesAbove = houses.filter(h => isAboveBep(h)).length;
  const totalActive = houses.reduce((s, h) => s + (h.activePatients ?? h.occupancy ?? 0), 0);
  const totalBonus  = houses.reduce((s, h) => s + (isAboveBep(h) ? (h.bonus?.total ?? h.totalBonus ?? 0) : 0), 0);
  const daysLeft    = data.daysRemaining ?? daysRemainingThisMonth();

  document.getElementById('kpiHousesAbove').textContent = `${housesAbove}/${houses.length || 4}`;
  document.getElementById('kpiActive').textContent      = fmtInt(totalActive);
  document.getElementById('kpiBonus').textContent       = fmtCurrency(totalBonus);
  document.getElementById('kpiDaysLeft').textContent    = fmtInt(daysLeft);

  const grid = document.getElementById('houseGrid');
  if (!houses.length) {
    grid.innerHTML = '<div class="loading">אין נתוני בתים זמינים</div>';
    return;
  }
  grid.innerHTML = '';
  houses.forEach(h => grid.appendChild(buildHouseCard(h)));
}

function isAboveBep(h) {
  if (!h) return false;
  if (typeof h.aboveBep === 'boolean') return h.aboveBep;
  const occ = h.activePatients ?? h.occupancy ?? 0;
  const bep = h.bep ?? h.netBalancePoint ?? 0;
  return occ >= bep;
}

function buildHouseCard(h) {
  const key = h.key;
  const labels = HOUSE_LABELS[key] || {};
  const name = h.name || labels.name || key;
  const manager = h.manager || labels.manager || '';
  const type = h.type || labels.type || '';
  const occ = h.activePatients ?? h.occupancy ?? 0;
  const cap = h.capacity ?? 0;
  const bep = h.bep ?? h.netBalancePoint ?? 0;
  const bonus = h.bonus?.total ?? h.totalBonus ?? 0;
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

  // Render template skeleton if not already in panel
  if (!panel.firstChild) {
    const tpl = document.getElementById('houseDetailTpl');
    panel.appendChild(tpl.content.cloneNode(true));
  }

  // If we already have data, render now (and refresh in background)
  if (state.details[key]) {
    renderHouseDetail(key, state.details[key]);
  } else {
    showHouseLoading(panel);
  }

  if (state.loadingDetails[key]) return;
  state.loadingDetails[key] = true;
  try {
    const data = await fetchJson(`/api/sheets?action=managersHouse&key=${encodeURIComponent(key)}`);
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
  if (banner) banner.innerHTML = `<div class="loading">שגיאה: ${err.message}</div>`;
}

function renderHouseDetail(key, data) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;

  // Compose merged view from overview + detail
  const o = state.housesById[key] || {};
  const labels = HOUSE_LABELS[key] || {};
  const name = data.name || o.name || labels.name || key;
  const manager = data.manager || o.manager || labels.manager || '';
  const bep = data.bep ?? o.bep ?? 0;
  const cap = data.capacity ?? o.capacity ?? 0;
  const occ = data.activePatients ?? o.activePatients ?? o.occupancy ?? 0;
  const above = typeof data.aboveBep === 'boolean' ? data.aboveBep : isAboveBep(o);

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const exits   = Array.isArray(data.exits)   ? data.exits   : [];
  const treatmentDays = data.treatmentDays ?? data.daysSoFar ?? 0;

  const totalDaysMonth = data.daysInMonth ?? daysInCurrentMonth();
  const elapsedDays = Math.max(1, totalDaysMonth - daysRemainingThisMonth());
  const dailyAvg = treatmentDays / elapsedDays;
  const projection = Math.round(dailyAvg * totalDaysMonth);
  const bepDays = bep * totalDaysMonth;

  // ----- Banner
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

  // ----- KPI stats
  panel.querySelector('[data-stat="entries"]').textContent = fmtInt(entries.length || data.entriesCount || 0);
  panel.querySelector('[data-stat="exits"]').textContent   = fmtInt(exits.length || data.exitsCount || 0);
  panel.querySelector('[data-stat="treatmentDays"]').textContent = fmtInt(treatmentDays);

  const totalBonus = above ? (data.bonus?.total ?? data.totalBonus ?? 0) : 0;
  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  bonusEl.textContent = above ? fmtCurrency(totalBonus) : '0 ₪';
  bonusEl.classList.toggle('gold', above);

  // ----- Chart bar
  const denom = Math.max(treatmentDays, bepDays, projection, 1);
  const fillPct = Math.min(100, (treatmentDays / denom) * 100);
  const bepPct  = Math.min(100, (bepDays / denom) * 100);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', above);
  panel.querySelector('[data-bep-fill]').style.width = fillPct + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = bepPct + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(bepDays)}`;
  panel.querySelector('[data-stat="daysSoFar"]').textContent = fmtInt(treatmentDays);
  panel.querySelector('[data-stat="daysTarget"]').textContent = fmtInt(bepDays);
  panel.querySelector('[data-stat="daysProjection"]').textContent = fmtInt(projection);

  // ----- Breakdown
  renderBreakdown(panel, data, { above, bep, treatmentDays, bepDays, totalBonus });

  // ----- Logs
  renderEntries(panel.querySelector('[data-log="entries"]'), entries);
  renderExits(panel.querySelector('[data-log="exits"]'), exits);
}

function renderBreakdown(panel, data, ctx) {
  const ul = panel.querySelector('[data-breakdown]');
  ul.innerHTML = '';

  const b = data.bonus || {};
  const base = b.base ?? (ctx.above ? 2500 : 0);
  const extraDays = b.extraDays ?? Math.max(0, ctx.treatmentDays - ctx.bepDays);
  const dailyRate = b.dailyRate ?? 30;
  const dailyBonus = b.dailyBonus ?? (ctx.above ? extraDays * dailyRate : 0);

  const continuityBreakdown = b.continuityBreakdown || data.continuityBreakdown || {};
  const counts = {
    maintenance: continuityBreakdown.maintenance ?? 0,
    dayProgram:  continuityBreakdown.dayProgram  ?? 0,
    daily:       continuityBreakdown.daily       ?? 0
  };
  const continuityTotal = b.continuity ?? (
    counts.maintenance * CONTINUITY_LABELS.maintenance.rate +
    counts.dayProgram  * CONTINUITY_LABELS.dayProgram.rate +
    counts.daily       * CONTINUITY_LABELS.daily.rate
  );

  const stability = b.stability ?? 0;
  const stabilityStartsJune = !stability;

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
        ? `${dailyRate} ₪ × ${fmtInt(extraDays)} ימי טיפול מעל BEP`
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
      key: 'stability',
      label: 'בונוס יציבות רבעוני',
      formula: stabilityStartsJune
        ? '5,000 ₪ עבור 3 חודשים רצופים מעל BEP (מתחיל מיוני 2026)'
        : '5,000 ₪ עבור 3 חודשים רצופים מעל BEP',
      amount: stability,
      zero: !stability,
      gold: stability > 0
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
  if (counts.dayProgram)  parts.push(`${counts.dayProgram} יום 2/שבוע × 500`);
  if (counts.daily)       parts.push(`${counts.daily} יום יומי × 1,000`);
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
        <span class="log-name">${item.name || item.patient || '—'}</span>
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
      const ck = continuityKey(item.continuity || item.continues || item.followup);
      const meta = CONTINUITY_LABELS[ck];
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="log-date">${fmtDateShort(item.date)}</span>
        <span class="log-name">${item.name || item.patient || '—'}</span>
        <span class="log-meta ${meta.cls}">${meta.label}</span>
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

  // Open initial tab from URL hash if it's one of our known tabs
  const hash = (location.hash || '').replace('#', '');
  if (['overview', ...HOUSE_KEYS].includes(hash)) activateTab(hash);

  // Refresh every 60s
  setInterval(loadOverview, 60_000);
}

document.addEventListener('DOMContentLoaded', boot);
