/* ezone-managers — read-only dashboard
   Talks to /api/sheets which proxies to the existing Apps Script.
   Endpoints:
     /api/sheets?action=managersOverview
     /api/sheets?action=managersHouse&house=<houseKey>[&month=YYYY-MM]
     (+ managersOverview&month=YYYY-MM for finished months, occupancySnapshots)
   No other Apps Script action is ever called: these three are the open ones.
*/

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab', 'pardes'];

/* `threshold` = FALLBACK only: the CURRENT first-tier average (rules from
   Oct 2026: Ramot 14, Ra'anana 10, Efroni 9, Rehab 9, Pardes 7). The real
   threshold is month-aware and always comes from BonusEligibility (an
   August month is still judged by the old rules). `capacity` is the
   physical bed count. */
const HOUSE_LABELS = {
  raanana: { name: 'רעננה אשר',     manager: 'שחר',   type: 'בית מאזן',     threshold: 10, capacity: 14 },
  ramot:   { name: 'רמות השבים',    manager: 'אורן',  type: 'בית מאזן',     threshold: 14, capacity: 20 },
  efroni:  { name: 'קיסריה עפרוני', manager: 'חנן',   type: 'תחלואה כפולה', threshold: 9, capacity: 13 },
  rehab:   { name: 'קיסריה ריהאב',  manager: 'רנטה',  type: 'גמילה',        threshold: 9, capacity: 13 },
  pardes:  { name: 'רעננה הפרדס',   manager: 'חן',    type: 'תחלואה כפולה', threshold: 7, capacity: 13 }
};

/* The month a house object is shown for (YYYY-MM): its own `ym` / `month`,
   else the overview's month, else today. The bonus RULES are month-aware, so
   every rule lookup goes through this. */
function ymOfHouse_(h) {
  const own = window.BonusEligibility?.monthOf?.(h);
  return own || state.overview?.month || currentMonthYM_();
}
/* `h` with its month pinned (as `ym`) for a BonusEligibility call. */
function atYM_(h, ym) {
  if (!h) return h;
  return { ...h, ym: ym || ymOfHouse_(h) };
}

/* Bonus-eligibility threshold (first-tier average) for a house in the month
   it is shown for. Prefers the canonical month-aware rules in
   BonusEligibility, then explicit payload fields, then the HOUSE_LABELS
   fallback. */
function resolveThreshold(h) {
  if (!h) return 0;
  const fromLib = window.BonusEligibility?.thresholdOf?.(atYM_(h));
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

/* Occupancy-history picker (house-detail tab): months offered = the current
   month back HISTORY_LOOKBACK_MONTHS months, never earlier than
   HISTORY_FLOOR_YM — the bonus model's quarterly anchor (May 2026, see
   BonusEligibility.quarterWindowFor); there is no bonus-era data before it.
   The bonus-history picker (overview + house tabs) uses the same floor with
   NO lookback cap: every finished month since the anchor is offered. */
const HISTORY_LOOKBACK_MONTHS = 12;
const HISTORY_FLOOR_YM = '2026-05';

/* Permanent monthly-occupancy view («תפוסה חודשית (סופי)»): every SETTLED
   month from the same May 2026 anchor, newest first, no lookback cap. The
   running month is never part of it — a month enters the table only once it
   has finished. Data: the backend's `occupancySnapshots` action. */
const OCCUPANCY_FLOOR_YM = HISTORY_FLOOR_YM;

/* Backend house-id → frontend house key. The dashboard Apps Script calls
   קיסריה עפרוני `arfoni`; everything in this app calls it `efroni` (see the
   roster table in EZONE-ECOSYSTEM-STATUS.md). Any id that does not resolve
   to one of HOUSE_KEYS is dropped rather than guessed. */
const BACKEND_HOUSE_IDS = { arfoni: 'efroni' };

const state = {
  now: null,            // Date override (tests); null → real clock via now_()
  overview: null,
  housesById: {},
  details: {},
  loadingDetails: {},
  /* Daily charts per month: { 'YYYY-MM': { houseKey: dailyChart[] } }.
   * Filled ONCE per month on overview load (all houses, in parallel) and
   * reused by the 60-second refresh, so every overview card computes the same
   * chart-based days-so-far as its detail tab. */
  chartsByMonth: {},
  /* Occupancy history (house-detail month picker) — DISPLAY ONLY. Its own
   * caches, never read by the bonus / KPI / hero / house-card code, so the
   * selected month can never leak into a bonus figure.
   *   historyMonth[houseKey]        = selected 'YYYY-MM' (null = current month)
   *   historyByMonth['YYYY-MM'][key] = { ok:true, avgDaily, treatmentDays,
   *                                      dailyChart|null } | { ok:false, error }
   *   loadingHistory['key:YYYY-MM']  = in-flight promise */
  historyMonth: {},
  historyByMonth: {},
  loadingHistory: {},
  /* Bonus-history month picker (overview + every house tab).
   *   bonusMonth              = selected FINISHED 'YYYY-MM' (null = running
   *                             month → every render path is unchanged)
   *   bonusHistory['YYYY-MM'] = { ok:true, byKey } | { ok:false, error } —
   *                             the month's `managersOverview&month=` rows,
   *                             kept for the life of the page (never refetched)
   *   loadingBonusHistory[ym] = in-flight promise */
  bonusMonth: null,
  bonusHistory: {},
  loadingBonusHistory: {},
  /* Bonus-history picker, house tab: the selected FINISHED month's own
   * house payload — `managersHouse&house=<key>&month=YYYY-MM` — for the
   * blocks a month overview row does not carry (entries / exits with patient
   * names, referrals, daily chart). Its own slice: never state.details, so
   * the running month cannot be touched by it.
   *   settledDetails['YYYY-MM'][key] = { ok:true, entries, exits, entriesCount,
   *                                      exitsCount, continuity, dailyChart }
   *                                  | { ok:false, error }
   *   loadingSettledDetails['key:YYYY-MM'] = in-flight promise */
  settledDetails: {},
  loadingSettledDetails: {},
  /* Monthly occupancy snapshots — DISPLAY ONLY, its own slice, never read by
   * the bonus / KPI / hero / house-card code.
   *   occupancy.status = 'idle' | 'loading' | 'ok' | 'error'
   *   occupancy.rows   = the backend's raw `occupancySnapshots` rows
   *   occupancy.error  = the message shown in the explicit error state
   *   loadingOccupancy = in-flight promise (one at a time) */
  occupancy: { status: 'idle', rows: [], error: '' },
  loadingOccupancy: null
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
      referral: p ? settledReferralFor_(h.key, prevYM, p.eligible) : 0,
      intake: p ? settledIntakeFor_(h.key, prevYM).total : 0,
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
  const byKey = monthByKey_(ym);
  const ph = byKey ? byKey[key] : null;
  if (!ph) return null;
  const r = window.BonusEligibility.monthlyBonusAmount(
    { key, ym, avgDaily: Number(ph.avgDaily) || 0, treatmentDays: Number(ph.treatmentDays) || 0 },
    resolveThreshold, daysInMonthFromLabel(ym)
  );
  return r.amount;
}

/* Quarterly standing for a house — computed LOCALLY (window anchored May 2026:
 * May–Jul, Aug–Oct, ...). A month counts when its settled monthly bonus was
 * >= 2,000; the 5,000 pays only when all 3 finished months met it.
 * `asOfYM` (bonus-history picker): the window is the one containing that
 * month and only its months up to and including it count as finished — the
 * standing exactly as it stood at the end of the selected month. Without it
 * the running window (state.quarterWindow) is used, as before.
 * The result also carries `byMonth` ({ ym: settled amount }) for the
 * per-month marks of the history view. */
function quarterlyLocal_(key, asOfYM) {
  const win = asOfYM
    ? (window.BonusEligibility.quarterWindowFor(asOfYM) || [])
    : (state.quarterWindow || []);
  const settled = {};
  win.forEach(ym => {
    if (asOfYM && ym > asOfYM) return;
    const amt = settledAmountFor_(key, ym);
    if (amt !== null) settled[ym] = amt;
  });
  const q = window.BonusEligibility.quarterlyStatus(win, settled);
  q.byMonth = settled;
  return q;
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

/* One-decimal number for display (e.g. avgDaily 18.4). */
function fmtNum1_(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 10) / 10).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/* Escape a string for insertion into innerHTML (error messages may echo
 * upstream text). */
function escapeHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---- data fetch ----
 * The app is fully open: no login, no token, no key, no cookie. Every
 * visitor gets the feed as the Apps Script returns it. */
const LEGACY_TOKEN_KEY = 'ezm_session_token';

/* One-time cleanup: drop the token left in localStorage by the old PIN
 * login so a returning visitor carries no stale credential. */
function clearLegacySession() {
  try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* private mode */ }
}

/* Why a read failed, in plain Hebrew — never a raw code (19 Oct 2026,
 * docs/sheets-resilience.md). The technical class is in the server log only
 * (server.js logSheets). */
const SHEETS_ERRORS = {
  upstream_timeout: 'שרת הנתונים לא הגיב בזמן.',
  upstream_unreachable: 'אין חיבור לשרת הנתונים.',
  upstream_auth: 'שרת הנתונים דורש אישור הרשאות. פנו לסנדרה.',
  upstream_bad_response: 'שרת הנתונים החזיר תשובה לא תקינה.',
  upstream_app_error: 'שרת הנתונים החזיר שגיאה.',
  upstream_unavailable: 'שרת הנתונים אינו זמין כרגע. פנו לסנדרה.',
  forbidden: 'אין הרשאה לצפות בבית הזה.',
  login_required: 'פג תוקף הכניסה — היכנסו שוב.',
  rate_limited: 'יותר מדי בקשות — נסו שוב בעוד כמה דקות.',
  offline: 'אין חיבור לאינטרנט — בדקו את החיבור.',
  unknown: 'לא ניתן לטעון את הנתונים כרגע.'
};
function sheetsErrorText_(code, status) {
  if (code && Object.prototype.hasOwnProperty.call(SHEETS_ERRORS, code)) return SHEETS_ERRORS[code];
  if (status === 429) return SHEETS_ERRORS.rate_limited;
  if (status === 401) return SHEETS_ERRORS.login_required;
  if (status === 403) return SHEETS_ERRORS.forbidden;
  return SHEETS_ERRORS.unknown;
}
function readError_(code, status) {
  const e = new Error(sheetsErrorText_(code, status));
  e.code = code || 'unknown';
  return e;
}

async function fetchJson(url) {
  let r;
  try {
    r = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw readError_('offline');
  }
  if (r.status === 401 && window.Auth) window.Auth.showLogin('פג תוקף הכניסה — הזינו את הקוד שוב.');
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw readError_('', r.status); }
  const code = data && typeof data.error === 'string' ? data.error : '';
  if (!r.ok) throw readError_(code, r.status);
  // An Apps Script `ok:false` (e.g. its exception code) is a server-side error.
  if (data && data.ok === false) throw readError_(Object.prototype.hasOwnProperty.call(SHEETS_ERRORS, code) ? code : 'upstream_app_error', r.status);
  const hdr = (k) => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(k) : null);
  if (hdr('X-Data-Source') === 'cache') noteStale_(url, hdr('X-Data-Cached-At'));
  else noteFresh_(url);
  return data;
}

/* ---- «מוצגים נתונים שמורים» notice ----
 * The server answered a read from its last good copy (X-Data-Source: cache),
 * or the browser kept the last good overview after a failed refresh. The
 * notice stays while any read is stale and shows the OLDEST copy's time. */
const staleReads = new Map(); // url → Date the copy was taken
function noteStale_(url, at) {
  const d = at ? new Date(at) : new Date(NaN);
  staleReads.set(url, Number.isNaN(d.getTime()) ? null : d);
  renderStaleNotice_();
}
function noteFresh_(url) {
  if (staleReads.delete(url)) renderStaleNotice_();
}
function staleNoticeText_() {
  let oldest = null;
  staleReads.forEach(d => { if (d && (!oldest || d < oldest)) oldest = d; });
  if (!oldest) return 'מוצגים נתונים שמורים — שרת הנתונים לא זמין כרגע.';
  const when = oldest.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `מוצגים נתונים שמורים מ־${when} — שרת הנתונים לא זמין כרגע.`;
}
function renderStaleNotice_() {
  const host = document.getElementById('staleNotice');
  if (!host) return;
  host.innerHTML = '';
  if (!staleReads.size) { host.hidden = true; return; }
  host.hidden = false;
  host.appendChild(el_('span', 'stale-text', staleNoticeText_()));
  host.appendChild(retryButton_(retryReads_, 'stale'));
}
/* «נסו שוב»: reload the overview and the open house tab. */
function retryReads_() {
  loadOverview();
  const open = HOUSE_KEYS.find(k => {
    const p = document.getElementById(`panel-${k}`);
    return p && p.classList && p.classList.contains('is-active');
  });
  if (open) loadHouseDetail(open);
}
function retryButton_(onClick, tag) {
  const b = el_('button', 'link-btn retry-btn', 'נסו שוב');
  b.setAttribute('type', 'button');
  b.setAttribute('data-retry', tag);
  b.addEventListener('click', e => { if (e && e.preventDefault) e.preventDefault(); onClick(); });
  return b;
}
/* A Hebrew error box with «נסו שוב» — text-only DOM, never a raw code. */
function readErrorBox_(host, prefix, err, onRetry, tag) {
  if (!host) return;
  host.innerHTML = '';
  const box = el_('div', 'loading error read-error');
  box.setAttribute('role', 'alert');
  box.setAttribute('data-read-error', tag);
  box.appendChild(el_('div', '', `${prefix}: ${(err && err.code && err.message) || SHEETS_ERRORS.unknown}`));
  box.appendChild(retryButton_(onRetry, tag));
  host.appendChild(box);
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

/* Referral («הפניות להמשך טיפול») bonus for one house in month `ym` —
 * running AND finished months go through here. Computed locally from the raw
 * COUNTS only (BonusEligibility.continuityAmount); the feed's own
 * `continuity.total` / `rates` are never read. The rule is month-aware:
 * nothing before Oct 2026; from Oct 2026 300 ₪ per day-package outpatient,
 * independent of the occupancy bonus. */
function referralBonus_(counts, eligible, ym) {
  return window.BonusEligibility.continuityAmount(counts || {}, !!eligible, ym);
}
/* The referral input of a house object: the per-month package counts
 * (bonus.continuity) plus `starts` — patients whose FIRST day package began
 * that month (referralStarts.count; the one-time rule from Oct 2026). */
function referralCounts_(o) {
  const c = (o && o.bonus && o.bonus.continuity) || {};
  const rs = o && o.referralStarts;
  return { maintenance: c.maintenance, day_2x: c.day_2x, day_daily: c.day_daily, starts: rs ? rs.count : 0 };
}
/* Intake-meeting («פגישות קליטה») bonus for one house in month `ym`, from the
 * feed's `intakeMeetings` COUNTS (confirmed / pending). Month-aware: none
 * before Oct 2026; from Oct 2026, 250 ₪ per confirmed meeting. */
function intakeBonus_(feed, ym) {
  return window.BonusEligibility.intakeMeetingAmount(feed || {}, ym);
}
/* Intake-meeting bonus for a house in a FINISHED month, from that month's
 * overview row. Counted in the month of admission: `pending` admissions may
 * still confirm, so the amount can grow until they reach 30 days. */
function settledIntakeFor_(key, ym) {
  const byKey = monthByKey_(ym);
  const ph = byKey ? byKey[key] : null;
  return intakeBonus_(ph ? ph.intakeMeetings : null, ym);
}
/* One short line for a card: "פגישות קליטה 500 ₪ · 1 ממתינה להשלמת 30 יום". */
function intakeLine_(ib) {
  if (!ib || !ib.enabled || (ib.total <= 0 && ib.pending <= 0)) return '';
  const parts = [];
  if (ib.total > 0) parts.push(`פגישות קליטה ${fmtCurrency(ib.total)}`);
  if (ib.pending > 0) parts.push(`${fmtInt(ib.pending)} ${ib.pending === 1 ? 'ממתינה' : 'ממתינות'} להשלמת 30 יום`);
  return parts.join(' · ');
}

/* Settled referral amount for a house in a FINISHED month, from that month's
 * overview row (counts only). 0 when the row is missing or the month has no
 * referral bonus. */
function settledReferralFor_(key, ym, eligible) {
  const byKey = monthByKey_(ym);
  const ph = byKey ? byKey[key] : null;
  return referralBonus_(ph ? referralCounts_(ph) : null, eligible, ym).total;
}

/* ============================================================
   Tabs
   ============================================================ */

function activateTab(key) {
  key = allowedTab_(key);
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
  if (key === 'today' && window.Work && window.Work.renderTodayAll) window.Work.renderTodayAll();

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

const OVERVIEW_KEY_ = 'overview:page';
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
    const houseKeys = houses.map(h => h && h.key).filter(Boolean);
    await Promise.all([
      // Daily charts for the running month — fetched once per month, cached.
      ensureHouseCharts_(nowYM, houseKeys.length ? houseKeys : HOUSE_KEYS),
      ...finishedMonths.map(async ym => {
        try {
          state.monthOverviews[ym] = await fetchMonthOverview_(ym);
        } catch (e) {
          console.error(`overview for ${ym} failed`, e);
        }
      })
    ]);
    state.quarterWindow = qWindow;
    state.prevOverview = state.monthOverviews[prevYM]
      ? { month: prevYM, byKey: state.monthOverviews[prevYM] }
      : null;

    renderOverview(data);
    // A house tab opened BEFORE the overview finished (a direct #ramot link)
    // was drawn without last month's settled figures — redraw it now.
    if (!state.bonusMonth) {
      HOUSE_KEYS.forEach(key => {
        const panel = document.getElementById(`panel-${key}`);
        if (panel && panel.getAttribute('data-rendered') && state.details[key]) renderHouseDetail(key, state.details[key]);
      });
    }
    setStatus(`עודכן ${new Date().toLocaleTimeString('he-IL')}`);
    state.overviewOkAt = new Date();
    noteFresh_(OVERVIEW_KEY_);
  } catch (err) {
    console.error(err);
    if (state.overview && state.overviewOkAt) {
      // A refresh failed but this page already has a good overview: keep it
      // on screen and say it is a saved copy.
      noteStale_(OVERVIEW_KEY_, state.overviewOkAt.toISOString());
      setStatus('מוצגים נתונים שמורים');
      return;
    }
    readErrorBox_(document.getElementById('houseGrid'), 'שגיאה בטעינת הנתונים', err, loadOverview, 'overview');
    setStatus('שגיאה בטעינה');
  }
}

/* One month's overview — `managersOverview&month=YYYY-MM` — keyed by house.
 * The ONLY fetch path for a past month's figures: shared by the bonus code
 * (settled months of the quarter window, above) and the occupancy-history
 * picker (below), so there is one place to change if the endpoint moves. */
async function fetchMonthOverview_(ym) {
  const md = await fetchJson(`/api/sheets?action=managersOverview&month=${encodeURIComponent(ym)}`);
  const byKey = {};
  (Array.isArray(md.houses) ? md.houses : []).forEach(ph => {
    // Backend ids map to frontend keys ('arfoni' → 'efroni'); any other id is kept as is.
    if (ph && ph.key) byKey[houseKeyOf_(ph.key) || ph.key] = ph;
  });
  return byKey;
}

/* Store a house-detail payload in both caches: state.details (what the
 * detail tab renders) and state.chartsByMonth (what the overview cards read
 * for days-so-far). Because both read the SAME payload, a card and its tab
 * can never show different days-so-far numbers. */
function cacheHouseDetail_(key, data, fallbackYM) {
  if (!key || !data) return;
  state.details[key] = data;
  const ym = data.month || fallbackYM || currentMonthYM_();
  if (!state.chartsByMonth[ym]) state.chartsByMonth[ym] = {};
  state.chartsByMonth[ym][key] = Array.isArray(data.dailyChart) ? data.dailyChart : [];
}

/* Fetch the daily chart of every house that is not yet cached for `ym`.
 * Runs once per month: on later overview refreshes every house is a cache
 * hit and no request is made. Older months are dropped so the cache never
 * serves a stale month; a failed fetch leaves the house uncached, so the next
 * refresh retries it (the card falls back to the capped feed figure until
 * then). */
async function ensureHouseCharts_(ym, keys) {
  Object.keys(state.chartsByMonth).forEach(m => { if (m !== ym) delete state.chartsByMonth[m]; });
  if (!state.chartsByMonth[ym]) state.chartsByMonth[ym] = {};
  const cached = state.chartsByMonth[ym];
  const missing = (keys || []).filter(k => k && !cached[k] && !state.loadingDetails[k]);
  await Promise.all(missing.map(async key => {
    state.loadingDetails[key] = true;
    try {
      const data = await fetchJson(`/api/sheets?action=managersHouse&house=${encodeURIComponent(key)}`);
      cacheHouseDetail_(key, data, ym);
    } catch (e) {
      console.error(`daily chart for ${key} failed`, e);
    } finally {
      state.loadingDetails[key] = false;
    }
  }));
}

function renderOverview(data) {
  // Bonus-history picker: a FINISHED month is selected → render that month,
  // settled, from the per-month cache (the live feed keeps refreshing
  // underneath and is shown again on "חזרה לחודש נוכחי").
  if (state.bonusMonth) { renderOverviewSettled_(state.bonusMonth); return; }

  const BV = window.BonusView;
  const houses = Array.isArray(data.houses) ? data.houses : [];
  const totals = data.totals || {};
  const nowYM = data.month || currentMonthYM_();
  const nowLabel = BV.monthLabel(nowYM);

  document.getElementById('monthTag').textContent = nowLabel;
  renderOverviewPicker_();
  // Permanent monthly-occupancy card — its own feed and state slice; drawn
  // here only so it survives every overview re-render.
  renderOccupancyCard_(document.getElementById('occupancyCard'), HOUSE_KEYS);
  setKpiLabel('kpiActiveLabel', 'מטופלים פעילים');
  setSparkSub_('קו זוהר = זכאות לבונוס · מילוי = מטופלים נוכחיים · רקע = קיבולת');

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
  // Occupancy bonus + the outpatient referral bonus of that month (from Oct
  // 2026; 0 before). Quarterly is shown separately in the winners banner.
  const prevTotal = houses.reduce((s, h) => {
    const p = prevMonthSettled_(h.key);
    if (!p) return s;
    return s + p.amount + settledReferralFor_(h.key, prevYM, p.eligible) + settledIntakeFor_(h.key, prevYM).total;
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
function setSparkSub_(text) {
  const el = document.getElementById('sparkSub');
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
  return window.BonusEligibility.qualifiesMonthly(atYM_(h), resolveThreshold);
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
  return window.BonusEligibility.monthlyBonusAmount(atYM_(h), resolveThreshold, monthDaysOf(h));
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
  // Chart lookup order: the payload itself (detail tab) → the per-month cache
  // filled on overview load (cards) → the detail cache when its month matches.
  const cachedChart = key ? (state.chartsByMonth[monthYM] || {})[key] : null;
  const detail = key ? state.details[key] : null;
  const detailChart = detail && (!detail.month || detail.month === monthYM) ? detail.dailyChart : null;
  const chart = (h && Array.isArray(h.dailyChart) && h.dailyChart.length)
    ? h.dailyChart
    : (Array.isArray(cachedChart) && cachedChart.length) ? cachedChart
    : (Array.isArray(detailChart) && detailChart.length) ? detailChart : null;
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
  return quarterlyLocal_(h.key, historyYMOf_(h)).earned;
}

function buildHouseCard(h) {
  // Bonus-history picker: the card is the selected finished month, settled.
  if (state.bonusMonth) return buildSettledHouseCard_(settledHouseFor_(h.key, state.bonusMonth));

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
  const quartly = quarterlyEarnedAmount(h);
  const secured = status.state === 'locked' || (status.state === 'finished' && status.amount > 0);
  const nowYM = h.month || state.overview?.month || currentMonthYM_();
  const cont = referralBonus_(referralCounts_(h), secured, nowYM);
  const intake = intakeBonus_(h.intakeMeetings, nowYM);
  const isProjection = status.state === 'projection';
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
  const prevReferral = prev ? settledReferralFor_(key, prev.month, prev.eligible) : 0;
  const prevIntake = prev ? intakeLine_(settledIntakeFor_(key, prev.month)) : '';
  const settledBlock = prev
    ? `<div class="hc-month hc-settled ${prev.amount > 0 ? 'earned' : 'not-earned'}" data-month-block="settled">
         <div class="hc-month-head">
           <span class="hc-month-title">${prev.title}</span>
           <span class="hc-month-amt">${fmtCurrency(prev.amount)}</span>
         </div>
         <div class="hc-month-line" data-settled-status>${prev.statusText}</div>
         <div class="hc-month-line dim">ממוצע ${fmtNum1_(prev.avgDaily)} מטופלים/יום · ${fmtInt(prev.treatmentDays)}/${fmtInt(prev.gate)} ימי טיפול</div>${prevReferral > 0 ? `
         <div class="hc-month-line" data-settled-referral>בונוס הפניות ${fmtCurrency(prevReferral)}</div>` : ''}${prevIntake ? `
         <div class="hc-month-line" data-settled-intake>${prevIntake}</div>` : ''}
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
  const intakeText = intakeLine_(intake);
  if (intakeText) extras.push(intakeText);
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
    cacheHouseDetail_(key, data, state.overview?.month);
    (state.detailsOkAt = state.detailsOkAt || {})[key] = new Date().toISOString();
    noteFresh_(`house:${key}`);
    renderHouseDetail(key, data);
    if (state.overview) renderOverview(state.overview); // card re-reads the same cached chart
  } catch (err) {
    console.error(err);
    if (state.details[key]) noteStale_(`house:${key}`, state.detailsOkAt && state.detailsOkAt[key]);
    else showHouseError(panel, err, key);
  } finally {
    state.loadingDetails[key] = false;
  }
}

function showHouseLoading(panel) {
  const banner = panel.querySelector('[data-status-banner]');
  if (banner) { banner.hidden = false; banner.innerHTML = '<div class="loading">טוען נתוני בית…</div>'; }
}
function showHouseError(panel, err, key) {
  const banner = panel.querySelector('[data-status-banner]');
  if (banner) banner.hidden = false;
  readErrorBox_(banner, 'שגיאה בטעינת נתוני הבית', err, () => loadHouseDetail(key), 'house');
}
/* The «בונוס» sub-tab hero is empty and hidden in the running month. */
function hideHeroBanner_(panel) {
  const banner = panel.querySelector('[data-status-banner]');
  if (!banner) return;
  banner.className = 'status-banner';
  banner.innerHTML = '';
  banner.hidden = true;
}

function renderHouseDetail(key, data) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;
  const BV = window.BonusView;
  panel.setAttribute('data-rendered', '1'); // rerenderAll_ (bonus-history picker) re-renders opened tabs only

  // Bonus-history picker: a FINISHED month is selected → the whole tab shows
  // that month, settled (renderHouseDetailSettled_); the live payload is
  // still cached and rendered again on "חזרה לחודש נוכחי".
  if (state.bonusMonth) { renderHouseDetailSettled_(panel, key, state.bonusMonth); return; }
  renderBonusMonthPicker_(panel.querySelector('[data-bonus-month]'), panel.querySelector('[data-bonus-month-back]'));

  const o = state.housesById[key] || {};
  const merged = { ...o, ...data, key, bonus: { ...(o.bonus || {}), ...(data.bonus || {}) } };
  const labels = HOUSE_LABELS[key] || {};
  const name = labels.name || BV.safeLabel(data.name) || BV.safeLabel(o.name) || key;
  const manager = BV.safeLabel(data.manager) || BV.safeLabel(o.manager) || labels.manager || '';
  const threshold = resolveThreshold(merged);

  // ONE status object per render: its daysSoFar is THE days-so-far figure
  // for the hero, the KPI, the progress bar and the breakdown below.
  const status = monthlyStatus(merged);
  const cur = status.view;              // null for a finished month
  const viewingYM = data.month || merged.month || state.overview?.month || currentMonthYM_();
  const viewingLabel = BV.monthLabel(viewingYM);
  const target = status.target;
  const nights = status.daysSoFar;
  // "paid" means actually secured: a finished month that earned, or a
  // current month already locked in.
  const paid = (status.state === 'finished' && status.amount > 0) || status.state === 'locked';

  const activity = Array.isArray(data.activity) ? data.activity : [];
  const entries = activity.filter(a => a.kind === 'entry');
  const exits   = activity.filter(a => a.kind === 'exit');

  const totalDaysMonth = daysInMonthFromLabel(viewingYM);
  // Projection (end-of-month days if the current average holds) — a SEPARATE
  // figure from the actual days-so-far, always labelled "צפי לסוף החודש".
  const projection = cur ? cur.projectedDays : nights;

  // ── Hero banner: NONE in the running month (20 Oct 2026). The settled
  //    previous month used to headline here ("ספטמבר: לא זכאי 432/510" while
  //    October was on screen); a finished month now appears only when it is
  //    PICKED in «חודש בונוס» (renderHouseDetailSettled_), labelled «— סופי».
  //    The running month is told by the bonus plan below. ──
  hideHeroBanner_(panel);

  // KPI stats — every label names its month.
  setStat(panel, 'entries', fmtInt(entries.length || data.entriesMonth || 0));
  setStat(panel, 'exits',   fmtInt(exits.length || data.exitsMonth || 0));
  setStatLabel(panel, 'treatmentDays', cur ? `ימי טיפול עד כה — ${viewingLabel} (בתהליך)` : `ימי טיפול — ${viewingLabel}`);
  setStat(panel, 'treatmentDays', fmtInt(nights));

  // Referrals: local, counts only, month-aware (from Oct 2026: 300 ₪ per
  // day-package outpatient, independent of the occupancy bonus).
  const cont = referralBonus_(referralCounts_(merged), paid, viewingYM);
  // Intake meetings: confirmed ones only (pending = not yet 30 days).
  const intake = intakeBonus_(merged.intakeMeetings, viewingYM);
  const quartly = quarterlyEarnedAmount(merged);
  // The bonuses of the month in plain words (BonusView.bonusPlanView). Its
  // total — what is ALREADY earned — is also the bonus KPI.
  const plan = BV.bonusPlanView({
    key, ym: viewingYM, settled: !cur, capacity: resolveCapacity(merged),
    daysSoFar: nights, elapsedDays: cur ? cur.elapsedDays : totalDaysMonth,
    treatmentDays: nights, avgDaily: Number(merged.avgDaily) || 0,
    referral: cont, referralState: 'ok', intake, quarterly: quartly
  });
  const totalBonus = plan.total;

  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  setStatLabel(panel, 'bonus', cur ? `הושג עד כה — ${viewingLabel}` : `בונוס ${viewingLabel} — סופי`);
  bonusEl.classList.remove('is-skeleton');
  bonusEl.textContent = fmtCurrency(totalBonus);
  bonusEl.classList.toggle('gold', totalBonus > 0);
  renderBonusPlan_(panel, plan);

  // Target bar (treatment-days so far vs the fixed gate)
  const chartTitle = panel.querySelector('[data-chart-title]');
  if (chartTitle) {
    chartTitle.textContent = cur
      ? `ימי טיפול — ${viewingLabel} (בתהליך, נספר מה-1 בחודש)`
      : `ימי טיפול — ${viewingLabel} (סופי)`;
  }
  setStatLabel(panel, 'daysSoFar', 'ימי טיפול עד כה');
  setStatLabel(panel, 'daysProjection', 'צפי לסוף החודש');
  // The bar's target = what the FIRST bonus really needs this month.
  const firstItem = plan.items.find(it => it.id === 'first');
  const firstNeed = firstItem ? firstItem.need : target;
  const denom = Math.max(nights, firstNeed, projection, 1);
  const fillPct = Math.min(100, (nights / denom) * 100);
  const bepPct  = Math.min(100, (firstNeed / denom) * 100);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', nights >= firstNeed);
  panel.querySelector('[data-bep-fill]').style.width = fillPct + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = bepPct + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(firstNeed)}`;
  setStat(panel, 'daysSoFar',    fmtInt(nights));
  setStat(panel, 'daysTarget',   fmtInt(firstNeed));
  setStat(panel, 'daysProjection', fmtInt(projection));

  renderDailySpark(panel, data.dailyChart || [], threshold, resolveCapacity(merged));


  // Logs
  renderEntries(panel.querySelector('[data-log="entries"]'), entries);
  renderExits(panel.querySelector('[data-log="exits"]'), exits);

  // ── Occupancy history picker — display-only, rendered LAST from its own
  //    cache so nothing above (hero, KPIs, month split, tiers, breakdown)
  //    depends on the selected month. ──
  renderHistoryPicker_(panel, key);
  renderHistoryView_(panel, key);
  renderOccupancyCard_(panel.querySelector('[data-occupancy-card]'), [key]);
  if (window.Work) window.Work.onHouseRendered(panel, key); // work tabs (lists + logs)
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
  renderDailySparkInto_(
    panel.querySelector('[data-daily-spark]'),
    panel.querySelector('[data-daily-spark-legend-line]'),
    chart, bep, capacity
  );
}

/* Daily occupancy bars into an explicit host (running-month chart card and
 * the occupancy-history view each have their own host + legend line). */
function renderDailySparkInto_(host, legendLine, chart, bep, capacity) {
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

  if (legendLine) {
    legendLine.textContent = `הקו הכתום = זכאות לבונוס (${fmtInt(bep)} מטופלים)`;
  }
}

/* ============================================================
   Bonus history (month picker on the overview and every house tab)
   Selecting a FINISHED month renders the whole page for that month in the
   SETTLED convention — KPIs, hero, house cards, month split, tier track,
   quarterly block, breakdown — via BonusView.settledMonthView (final state:
   tier reached, amount, gate result; never "בתהליך" / "בדרך" / "צפי").
   Data: the existing `managersOverview&month=YYYY-MM` fetch
   (fetchMonthOverview_), cached per month in state.bonusHistory for the life
   of the page. No new endpoints, no Apps Script changes. With no selection
   (state.bonusMonth = null) every render path is exactly as before.
   ============================================================ */

/* The selected history month when `h` is a house object built FOR it (its
 * `month` is the selection); undefined on the running-month path. */
function historyYMOf_(h) {
  const ym = state.bonusMonth;
  return ym && h && h.month === ym ? ym : undefined;
}

/* One month's overview rows keyed by house, from whichever cache holds
 * them: the bonus code's per-refresh state.monthOverviews first (fresh),
 * then the persistent history cache. null when not loaded. */
function monthByKey_(ym) {
  const fresh = (state.monthOverviews || {})[ym];
  if (fresh) return fresh;
  const e = state.bonusHistory[ym];
  return e && e.ok ? e.byKey : null;
}

/* Cache entry for the picker: { ok:true, byKey } | { ok:false, error } | null. */
function bonusMonthEntry_(ym) {
  const e = state.bonusHistory[ym];
  if (e) return e;
  const fresh = (state.monthOverviews || {})[ym];
  return fresh ? { ok: true, byKey: fresh } : null;
}

/* Months offered, newest first: the running month, then EVERY finished
 * month back to the quarterly anchor (HISTORY_FLOOR_YM) — no lookback cap. */
function bonusMonths_(nowYM = historyNowYM_()) {
  return window.BonusView.monthsBetween(HISTORY_FLOOR_YM, nowYM);
}

/* House keys in the live overview's order (roster order as fallback). */
function houseKeysOrdered_() {
  const live = Array.isArray(state.overview?.houses)
    ? state.overview.houses.map(h => h && h.key).filter(Boolean) : [];
  return live.length ? live : HOUSE_KEYS.slice();
}

/* A house object for a FINISHED month, built ONLY from whitelisted raw
 * fields of that month's overview row (avgDaily, treatmentDays, sanitised
 * name / manager) plus the live capacity. `month` is the selected month, so
 * monthlyStatus() treats it as finished. Backend bonus fields are never
 * copied. { key, month, missing:true } when the row is absent. The daily
 * chart is taken from the payload, or from the occupancy-history cache when
 * that picker already loaded it — no extra request. */
function settledHouseFor_(key, ym) {
  const BV = window.BonusView;
  const byKey = monthByKey_(ym);
  const ph = byKey ? byKey[key] : null;
  const live = state.housesById[key] || {};
  const base = {
    key, month: ym,
    name: BV.safeLabel(ph && ph.name) || BV.safeLabel(live.name) || '',
    manager: BV.safeLabel(ph && ph.manager) || BV.safeLabel(live.manager) || '',
    capacity: Number(live.capacity) || 0
  };
  if (!ph) return { ...base, missing: true };
  // A row without numeric figures is MISSING data, not a zero month: coercing
  // an absent treatmentDays to 0 would render "לא זכאי · 0 ₪" for a house
  // that may well have earned its bonus.
  const avgDaily = rawNumber_(ph.avgDaily);
  const treatmentDays = rawNumber_(ph.treatmentDays);
  if (avgDaily === null || treatmentDays === null) return { ...base, missing: true };
  const occ = historyEntry_(key, ym);
  return {
    ...base,
    avgDaily,
    treatmentDays,
    dailyChart: monthChart_(ph.dailyChart, ym) || (occ && occ.ok ? occ.dailyChart : null)
  };
}

/* A raw feed number, or null when the field is absent / blank / not a number. */
function rawNumber_(v) {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* settledMonthView for a settledHouseFor_ object (null when missing). */
function settledViewFor_(h) {
  if (!h || h.missing) return null;
  return window.BonusView.settledMonthView(
    { key: h.key, ym: h.month, avgDaily: h.avgDaily, treatmentDays: h.treatmentDays },
    resolveThreshold
  );
}

/* Fetch (once) every month the selected month's view needs: the month
 * itself plus the finished months of its quarter window up to it (≤ 3
 * requests, all `managersOverview&month=`). Months already in either cache
 * are not refetched; a failed month is cached as an error and retried on the
 * next selection. Resolves to the number of requests made. */
async function loadBonusMonth_(ym) {
  if (state.loadingBonusHistory[ym]) return state.loadingBonusHistory[ym];
  const nowYM = historyNowYM_();
  const win = window.BonusEligibility.quarterWindowFor(ym) || [];
  const months = [...new Set([ym, ...win.filter(m => m <= ym && m < nowYM)])];
  const run = (async () => {
    let requests = 0;
    await Promise.all(months.map(async m => {
      const cached = bonusMonthEntry_(m);
      if (cached && cached.ok) { state.bonusHistory[m] = cached; return; } // pin it: monthOverviews is reset every refresh
      requests += 1;
      try {
        state.bonusHistory[m] = { ok: true, byKey: await fetchMonthOverview_(m) };
      } catch (e) {
        console.error(`bonus history ${m} failed`, e);
        state.bonusHistory[m] = { ok: false, error: (e && e.message) || 'שגיאה' };
      }
    }));
    return requests;
  })();
  state.loadingBonusHistory[ym] = run;
  try { return await run; } finally { delete state.loadingBonusHistory[ym]; }
}

/* Picker change / "חזרה לחודש נוכחי". The value is validated against the
 * offered list (never trusted from the DOM); the running month or anything
 * invalid clears the selection and restores the live view. A finished month
 * re-renders everything at once (loading state if not cached), loads what is
 * missing, then re-renders from the cache. */
async function selectBonusMonth_(ym) {
  const nowYM = historyNowYM_();
  const target = isValidYM_(ym) && bonusMonths_(nowYM).includes(String(ym)) ? String(ym) : nowYM;
  state.bonusMonth = target === nowYM ? null : target;
  // A month whose house payload failed is retried on (re-)selection.
  const failed = state.settledDetails[target] || {};
  Object.keys(failed).forEach(k => { if (failed[k] && !failed[k].ok) delete failed[k]; });
  rerenderAll_();
  if (!state.bonusMonth) return;
  const opened = openedHouseKeys_();
  const [requests, houseRequests] = await Promise.all([
    loadBonusMonth_(target),
    Promise.all(opened.map(k => loadSettledHouse_(k, target))).then(r => r.filter(Boolean).length)
  ]);
  if ((requests > 0 || houseRequests > 0) && state.bonusMonth === target) rerenderAll_();
}

/* House tabs that have been opened (their panel holds the template). */
function openedHouseKeys_() {
  return HOUSE_KEYS.filter(key => {
    const panel = document.getElementById(`panel-${key}`);
    return !!(panel && (panel.getAttribute('data-rendered') || panel.firstChild));
  });
}

/* Fetch (once) a FINISHED month's house payload for one house:
 * `managersHouse&house=<key>&month=YYYY-MM` — an existing, open action, no
 * new endpoint. The house key is the FRONTEND key (efroni, pardes, …): the
 * dashboard's managersHouse_ maps efroni → the Patients sheet's `arfoni`
 * itself and answers `unknown_house` for `arfoni`. FAIL-CLOSED:
 *   - the response must be for the requested month (a backend that ignored
 *     `month` would otherwise show September's patients under another
 *     month) and, when it names a house, for the requested house;
 *   - only whitelisted raw fields are kept: entry / exit rows dated inside
 *     the month, the referral COUNTS, the daily chart;
 *   - any failure is cached as { ok:false, error } and rendered as an
 *     explicit error state, retried on the next selection.
 * Resolves to true when a request was made. */
async function loadSettledHouse_(key, ym) {
  if (!HOUSE_KEYS.includes(key) || !isValidYM_(ym)) return false;
  const have = (state.settledDetails[ym] || {})[key];
  if (have && have.ok) return false;
  const slot = `${key}:${ym}`;
  if (state.loadingSettledDetails[slot]) return state.loadingSettledDetails[slot];
  const run = (async () => {
    let entry;
    try {
      const d = await fetchJson(`/api/sheets?action=managersHouse&house=${encodeURIComponent(key)}&month=${encodeURIComponent(ym)}`);
      if (!d || d.month !== ym) {
        throw new Error(`התקבלו נתונים לחודש אחר (${String(d && d.month || '?')})`);
      }
      if (d.key && houseKeyOf_(d.key) !== key) throw new Error('התקבלו נתונים לבית אחר');
      // No activity list = the names were not delivered: an error, not "none".
      if (!Array.isArray(d.activity)) throw new Error('רשימת הכניסות והיציאות לא התקבלה');
      const inMonth = a => a && typeof a.date === 'string' && a.date.slice(0, 7) === ym;
      const activity = d.activity.filter(inMonth);
      const row = a => ({ date: a.date, name: typeof a.name === 'string' ? a.name : '' });
      const entries = activity.filter(a => a.kind === 'entry').map(row);
      const exits = activity.filter(a => a.kind === 'exit').map(row);
      const c = (d.bonus && d.bonus.continuity) || {};
      entry = {
        ok: true,
        entries,
        exits,
        // Counts = the rows listed, so the KPI and the log can never disagree.
        entriesCount: entries.length,
        exitsCount: exits.length,
        continuity: { maintenance: c.maintenance, day_2x: c.day_2x, day_daily: c.day_daily,
          starts: d.referralStarts ? d.referralStarts.count : 0 },
        dailyChart: monthChart_(d.dailyChart, ym)
      };
    } catch (e) {
      console.error(`settled house ${key} ${ym} failed`, e);
      entry = { ok: false, error: (e && e.message) || 'שגיאה' };
    }
    if (!state.settledDetails[ym]) state.settledDetails[ym] = {};
    state.settledDetails[ym][key] = entry;
    return true;
  })();
  state.loadingSettledDetails[slot] = run;
  try { return await run; } finally { delete state.loadingSettledDetails[slot]; }
}

function settledHouseEntry_(key, ym) {
  return (state.settledDetails[ym] || {})[key] || null;
}

/* Re-render the overview and every house tab that has been opened. Back on
 * the running month a tab whose live payload is missing is (re)loaded. */
function rerenderAll_() {
  if (state.overview) renderOverview(state.overview);
  else renderOverviewPicker_();
  HOUSE_KEYS.forEach(key => {
    const panel = document.getElementById(`panel-${key}`);
    if (!panel || !(panel.getAttribute('data-rendered') || panel.firstChild)) return; // tab never opened
    if (state.bonusMonth) renderHouseDetail(key, state.details[key] || {});
    else if (state.details[key]) renderHouseDetail(key, state.details[key]);
    else loadHouseDetail(key);
  });
}

/* Fill a picker <select> (options rebuilt only when the month set changes),
 * mirror the selection, wire the change handler and the back link once. */
function renderBonusMonthPicker_(sel, back) {
  if (!sel) return;
  const nowYM = historyNowYM_();
  const months = bonusMonths_(nowYM);
  if (state.bonusMonth && !months.includes(state.bonusMonth)) state.bonusMonth = null; // out of range → running month
  const selected = state.bonusMonth || nowYM;
  const sig = months.join(',');
  if (sel.getAttribute('data-months') !== sig) {
    sel.innerHTML = months
      .map(ym => `<option value="${ym}">${historyOptionLabel_(ym, nowYM)}</option>`)
      .join('');
    sel.setAttribute('data-months', sig);
  }
  sel.value = selected;
  if (!sel.getAttribute('data-wired')) {
    sel.setAttribute('data-wired', '1');
    sel.addEventListener('change', () => { selectBonusMonth_(sel.value); });
  }
  if (back) {
    back.hidden = !state.bonusMonth;
    if (!back.getAttribute('data-wired')) {
      back.setAttribute('data-wired', '1');
      back.addEventListener('click', e => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        selectBonusMonth_(historyNowYM_());
      });
    }
  }
}
function renderOverviewPicker_() {
  renderBonusMonthPicker_(
    document.getElementById('bonusMonthOverview'),
    document.getElementById('bonusMonthBackOverview')
  );
}

/* ── overview, settled month ─────────────────────────────── */
function renderOverviewSettled_(ym) {
  const BV = window.BonusView;
  const label = BV.monthLabel(ym);
  const keys = houseKeysOrdered_();
  const grid = document.getElementById('houseGrid');
  const banner = document.getElementById('winnersBanner');
  const spark = document.getElementById('networkSpark');

  document.getElementById('monthTag').textContent = `${label} — סופי`;
  renderOverviewPicker_();
  renderOccupancyCard_(document.getElementById('occupancyCard'), HOUSE_KEYS);
  setKpiLabel('kpiHousesAboveLabel', `בתים זכאים לבונוס — ${label} (סופי)`);
  setKpiLabel('kpiActiveLabel', `ממוצע מטופלים/יום — ${label} (סופי)`);
  setKpiLabel('kpiBonusLabel', `בונוס ${label} — סופי (לתשלום)`);
  setKpiLabel('kpiDaysLabel', `ימים בחודש — ${label} (סופי)`);
  setSparkSub_(`קו זוהר = זכאות לבונוס · מילוי = ממוצע מטופלים/יום ב${label} · רקע = קיבולת`);

  const entry = bonusMonthEntry_(ym);
  if (!entry || !entry.ok) {
    const stateName = entry ? 'error' : 'loading';
    const msg = entry ? `שגיאה בטעינת ${label}: ${escapeHtml_(entry.error)}` : `טוען ${label}…`;
    ['kpiHousesAbove', 'kpiActive', 'kpiBonus', 'kpiDaysLeft'].forEach(id => setKpi(id, '—'));
    if (banner) {
      banner.innerHTML = `<div class="wb-head"><span class="wb-trophy">🏆</span>
          <span class="wb-title">בונוסים לתשלום — ${label} (סופי)</span></div>
        <div class="wb-none" data-bonus-history-state="${stateName}">${msg}</div>`;
      banner.hidden = false;
    }
    if (spark) spark.innerHTML = '';
    grid.innerHTML = `<div class="loading${entry ? ' error' : ''}" data-bonus-history-state="${stateName}">${msg}</div>`;
    return;
  }

  const houses = keys.map(k => settledHouseFor_(k, ym));
  const views = houses.map(settledViewFor_);
  const known = views.filter(Boolean);
  const earned = known.filter(v => v.amount > 0).length;
  // Occupancy + that month's referral bonus (0 before Oct 2026).
  const total = houses.reduce((s, h, i) => {
    const v = views[i];
    return v ? s + v.amount + settledReferralFor_(h.key, ym, v.eligible) + settledIntakeFor_(h.key, ym).total : s;
  }, 0);
  const avgTotal = known.reduce((s, v) => s + v.avgDaily, 0);
  const dim = daysInMonthFromLabel(ym);

  setKpi('kpiHousesAbove', `${earned}/${keys.length}`);
  setKpi('kpiActive', fmtNum1_(avgTotal));
  setKpi('kpiBonus', fmtCurrency(total));
  setKpi('kpiDaysLeft', `${fmtInt(dim)} מתוך ${fmtInt(dim)}`); // finished month: days-so-far = the full month
  renderWinnersBannerSettled_(ym, houses, views);
  renderNetworkSparkSettled_(houses, views);

  grid.innerHTML = '';
  houses.forEach(h => grid.appendChild(buildSettledHouseCard_(h)));
}

/* Winners banner for the selected month — same chips as the settled
 * previous month, no running-month line (the month is final). */
function renderWinnersBannerSettled_(ym, houses, views) {
  const el = document.getElementById('winnersBanner');
  if (!el) return;
  const BV = window.BonusView;
  const rows = houses.map((h, i) => {
    const v = views[i];
    const q = quarterlyLocal_(h.key, ym);
    return {
      name: HOUSE_LABELS[h.key]?.name || BV.safeLabel(h.name) || h.key,
      manager: BV.safeLabel(h.manager) || HOUSE_LABELS[h.key]?.manager || '',
      amount: v ? v.amount : 0,
      tier: v ? v.tier : 0,
      referral: v ? settledReferralFor_(h.key, ym, v.eligible) : 0,
      intake: v ? settledIntakeFor_(h.key, ym).total : 0,
      quarterly: q.earned
    };
  });
  const view = BV.winnersBannerView(ym, rows, null);
  const head = `<div class="wb-head"><span class="wb-trophy">🏆</span>
      <span class="wb-title">${view.title}</span></div>`;
  const body = !view.winners.length
    ? `<div class="wb-none">${view.noneText}</div>`
    : `<div class="wb-chips">${view.winners.map(r => `
      <div class="wb-chip">
        <span class="wb-house">${r.name}</span>
        <span class="wb-manager">${r.manager ? 'מנהל/ת: ' + r.manager : ''}</span>
        <span class="wb-amt">${fmtCurrency(r.total)}</span>
        <span class="wb-detail">${r.text}</span>
      </div>`).join('')}</div>`;
  el.innerHTML = `${head}${body}<div class="wb-current" data-bonus-history-note>📅 ${BV.monthLabel(ym)} — סופי · תצוגה היסטורית</div>`;
  el.hidden = false;
}

/* Network chart for the selected month: bar = that month's average daily
 * occupancy (there is no "current" count for a finished month). */
function renderNetworkSparkSettled_(houses, views) {
  const el = document.getElementById('networkSpark');
  if (!el) return;
  const rows = houses.map((h, i) => ({ h, v: views[i] })).filter(r => r.v);
  if (!rows.length) { el.innerHTML = ''; return; }
  const calcMax = Math.max(
    ...rows.map(r => Math.max(r.v.avgDaily, resolveThreshold(r.h), resolveCapacity(r.h)))
  ) || 1;
  el.innerHTML = rows.map(({ h, v }) => {
    const avg = v.avgDaily;
    const threshold = resolveThreshold(h);
    const cap = resolveCapacity(h);
    const above = v.amount > 0;
    const occH = Math.round((avg / calcMax) * 100);
    const bepH = Math.round((threshold / calcMax) * 100);
    const capH = Math.round((cap / calcMax) * 100);
    const fullName = HOUSE_LABELS[h.key]?.name || window.BonusView.safeLabel(h.name) || h.key;
    return `
      <div class="spark-col ${above ? 'above' : 'below'}" data-house="${h.key}">
        <div class="spark-stack">
          <div class="spark-cap" style="height:${capH}%"></div>
          <div class="spark-bar" style="height:${occH}%"></div>
          <div class="spark-bep" style="bottom:${bepH}%"></div>
        </div>
        <div class="spark-label">${fullName}</div>
        <div class="spark-num">${fmtNum1_(avg)}/${cap || '—'}</div>
      </div>`;
  }).join('');
  el.querySelectorAll('.spark-col').forEach(col => {
    col.addEventListener('click', () => activateTab(col.dataset.house));
  });
}

/* House card for the selected month: ONE settled block (final state), the
 * month's average vs the eligibility line, treatment days vs the fixed gate
 * and a tier pill only when the tier was actually earned. */
function buildSettledHouseCard_(h) {
  const BV = window.BonusView;
  const key = h.key;
  const labels = HOUSE_LABELS[key] || {};
  const name = labels.name || BV.safeLabel(h.name) || key;
  const manager = BV.safeLabel(h.manager) || labels.manager || '';
  const type = labels.type || '';
  const cap = resolveCapacity(h);
  const threshold = resolveThreshold(h);
  const s = settledViewFor_(h);
  const label = BV.monthLabel(h.month);

  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('data-house-card', key);
  card.setAttribute('data-bonus-history-month', h.month);

  const head = (badge) => `
    <div class="hc-head">
      <div class="hc-head-text">
        <div class="hc-title">${name}</div>
        <div class="hc-manager">מנהל/ת: ${manager}</div>
        ${type ? `<div class="hc-type">${type}</div>` : ''}
      </div>
      ${badge}
    </div>`;

  if (!s) {
    card.className = 'house-card below settled';
    card.innerHTML = `
      ${head(`<div class="warn-badge">ℹ ${label}</div>`)}
      <div class="hc-month hc-settled not-earned" data-month-block="settled">
        <div class="hc-month-head">
          <span class="hc-month-title">${label} — סופי</span>
          <span class="hc-month-amt">—</span>
        </div>
        <div class="hc-month-line dim">הנתונים לא זמינים</div>
      </div>`;
  } else {
    const earned = s.amount > 0;
    const q = quarterlyLocal_(key, h.month);
    const referral = settledReferralFor_(key, h.month, s.eligible);
    const intakeText = intakeLine_(settledIntakeFor_(key, h.month));
    const avg = s.avgDaily;
    const denominator = cap || Math.max(avg, threshold) || 1;
    const fillPct = Math.min(100, (avg / denominator) * 100);
    const bepPct  = Math.min(100, (threshold / denominator) * 100);
    const tierBadge = earned && s.tier > 0
      ? `<span class="tier-pill t${s.tier}">מדרגה ${s.tier} ✓</span>`
      : '';
    card.className = `house-card ${earned ? 'above' : 'below'} settled`;
    card.innerHTML = `
      ${earned ? '<div class="trophy" aria-label="זכאי לבונוס">🏆</div>' : ''}
      ${head(earned
        ? `<div class="qualify-badge">✓ זכאי · ${label}</div>`
        : `<div class="warn-badge">⚠ לא זכאי · ${label}</div>`)}

      <div class="hc-month hc-settled ${earned ? 'earned' : 'not-earned'}" data-month-block="settled">
        <div class="hc-month-head">
          <span class="hc-month-title">${s.shortTitle}</span>
          <span class="hc-month-amt">${fmtCurrency(s.amount)}</span>
        </div>
        <div class="hc-month-line" data-settled-status>${s.statusText}</div>
        <div class="hc-month-line dim">ממוצע ${fmtNum1_(avg)} מטופלים/יום · ${s.gateText}</div>${referral > 0 ? `
        <div class="hc-month-line" data-settled-referral>בונוס הפניות ${fmtCurrency(referral)}</div>` : ''}${intakeText ? `
        <div class="hc-month-line" data-settled-intake>${intakeText}</div>` : ''}
        ${q.earned > 0 ? `<div class="hc-month-line dim">רבעוני ${fmtCurrency(q.earned)}</div>` : ''}
      </div>

      <div class="hc-stats">
        <div class="hc-occ">${fmtNum1_(avg)}<small> / ${cap || '—'}</small></div>
        <div class="hc-bep">ממוצע מטופלים/יום · זכאות לבונוס: <b>${threshold || '—'}</b></div>
      </div>

      <div class="bep-bar">
        <div class="bep-fill" style="width:${fillPct}%"></div>
        <div class="bep-marker" style="right:${bepPct}%"><span>★</span><em>זכאות ${threshold}</em></div>
      </div>

      <div class="hc-nights">
        <span class="hc-nights-label">ימי טיפול — ${label} (סופי)</span>
        <span class="hc-nights-value" data-card-days>${fmtInt(s.treatmentDays)} / ${fmtInt(s.gate)}</span>
        ${tierBadge}
      </div>`;
  }

  const go = () => activateTab(key);
  card.addEventListener('click', go);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
  return card;
}

/* ── house detail, settled month ─────────────────────────── */
/* Blank every figure of the tab (labels keep naming the selected month) so
 * a loading / error / missing state never leaves another month's numbers
 * on screen. */
function blankDetailFigures_(panel, label) {
  ['entries', 'exits', 'treatmentDays', 'bonus', 'daysSoFar', 'daysTarget', 'daysProjection', 'bonusTotal']
    .forEach(n => setStat(panel, n, '—'));
  setStatLabel(panel, 'treatmentDays', `ימי טיפול — ${label} (סופי)`);
  setStatLabel(panel, 'bonus', `בונוס ${label} — סופי`);
  const note = panel.querySelector('[data-bonus-fallback-note]');
  if (note) note.textContent = '';
  const chartTitle = panel.querySelector('[data-chart-title]');
  if (chartTitle) chartTitle.textContent = `ימי טיפול — ${label} (סופי)`;
  const spark = panel.querySelector('[data-daily-spark]');
  if (spark) spark.innerHTML = '';
  const bk = panel.querySelector('[data-breakdown]');
  if (bk) bk.innerHTML = '';
  const pt = panel.querySelector('[data-bonus-plan-title]');
  if (pt) pt.textContent = `הבונוסים של ${label} — סופי`;
  const entries = panel.querySelector('[data-log="entries"]');
  const exits = panel.querySelector('[data-log="exits"]');
  if (entries) entries.innerHTML = '';
  if (exits) exits.innerHTML = '';
}

function renderHouseDetailSettled_(panel, key, ym) {
  const BV = window.BonusView;
  const label = BV.monthLabel(ym);
  renderBonusMonthPicker_(panel.querySelector('[data-bonus-month]'), panel.querySelector('[data-bonus-month-back]'));

  const labels = HOUSE_LABELS[key] || {};
  const entry = bonusMonthEntry_(ym);
  const h = settledHouseFor_(key, ym);
  const name = labels.name || BV.safeLabel(h.name) || key;
  const manager = BV.safeLabel(h.manager) || labels.manager || '';
  const s = settledViewFor_(h);
  const banner = panel.querySelector('[data-status-banner]');
  banner.hidden = false;   // a PICKED finished month: the hero says which month, «— סופי»

  // The month's own house payload (entries / exits / names / referrals /
  // chart). Requested here when missing — a tab opened while a finished month
  // is selected — and the tab re-rendered when it lands.
  if (!settledHouseEntry_(key, ym) && !state.loadingSettledDetails[`${key}:${ym}`]) {
    loadSettledHouse_(key, ym).then(made => {
      if (made && state.bonusMonth === ym) renderHouseDetailSettled_(panel, key, ym);
    });
  }
  const sh = settledHouseEntry_(key, ym);

  if (!entry || !entry.ok || !s) {
    const stateName = !entry ? 'loading' : !entry.ok ? 'error' : 'missing';
    const msg = !entry ? `טוען ${label}…`
      : !entry.ok ? `שגיאה בטעינת ${label}: ${escapeHtml_(entry.error)}`
      : `${label} — סופי: הנתונים לא זמינים לבית זה`;
    banner.className = 'status-banner below';
    banner.innerHTML = `<div class="big-emoji">${!entry ? '⏳' : 'ℹ️'}</div>
       <div>
         <div class="sb-name">${name}</div>
         <div class="sb-title" data-hero-headline data-bonus-history-state="${stateName}">${msg}</div>
         <div class="sb-sub">${manager ? 'מנהל/ת: ' + manager : ''}</div>
       </div>`;
    blankDetailFigures_(panel, label);
    renderSettledLogs_(panel, sh, label);
    renderHistoryPicker_(panel, key);
    renderHistoryView_(panel, key);
    renderOccupancyCard_(panel.querySelector('[data-occupancy-card]'), [key]);
    if (window.Work) window.Work.onHouseRendered(panel, key); // work tabs (lists + logs)
    return;
  }

  const merged = { ...h, bonus: {} };
  const threshold = resolveThreshold(merged);
  const capacity = resolveCapacity(merged);
  const status = monthlyStatus(merged);   // 'finished' — merged.month is the selected month
  const target = status.target;
  const nights = s.treatmentDays;         // finished month: days-so-far = the full-month total
  // Referrals: the COUNTS from the month's own house payload; the amount is
  // computed locally (lib/bonus-eligibility.js) with that month's rule.
  // Unknown until that payload has loaded.
  const cont = sh && sh.ok
    ? referralBonus_(sh.continuity, s.eligible, ym)
    : { maintenance: 0, day_2x: 0, day_daily: 0, payableCount: 0, unitRate: 0, total: 0 };
  const contState = !sh ? 'loading' : sh.ok ? 'ok' : 'error';
  const quartly = quarterlyLocal_(key, ym).earned;
  // Intake meetings of that month (from its overview row, which did load).
  const intake = settledIntakeFor_(key, ym);
  // The month's bonuses in plain words — final state (BonusView.bonusPlanView).
  const plan = BV.bonusPlanView({
    key, ym, settled: true, capacity, treatmentDays: s.treatmentDays, avgDaily: s.avgDaily,
    referral: cont, referralState: contState, referralError: sh && !sh.ok ? sh.error : '',
    intake, quarterly: quartly
  });
  const totalBonus = plan.total;

  // Hero: the selected month, final state ("יולי 2026 — סופי: …").
  const hero = BV.houseHeroView({ name, manager, settled: s, prevYm: ym, current: null, selected: true });
  banner.className = 'status-banner ' + hero.tone;
  banner.innerHTML = `<div class="big-emoji">${hero.emoji}</div>
     <div>
       <div class="sb-name">${name}</div>
       <div class="sb-title" data-hero-headline>${hero.headline}</div>
       <div class="sb-sub">${hero.sub}</div>
     </div>`;

  // KPIs — every label names the month; entries / exits from the month's own
  // house payload ("—" while loading or on error, never a guessed 0).
  setStat(panel, 'entries', sh && sh.ok ? fmtInt(sh.entriesCount) : '—');
  setStat(panel, 'exits', sh && sh.ok ? fmtInt(sh.exitsCount) : '—');
  setStatLabel(panel, 'treatmentDays', `ימי טיפול — ${label} (סופי)`);
  setStat(panel, 'treatmentDays', fmtInt(nights));
  const bonusEl = panel.querySelector('[data-stat="bonus"]');
  setStatLabel(panel, 'bonus', `בונוס ${label} — סופי`);
  bonusEl.classList.remove('is-skeleton');
  bonusEl.textContent = fmtCurrency(totalBonus);
  bonusEl.classList.toggle('gold', totalBonus > 0);
  renderBonusPlan_(panel, plan);

  // Treatment-days bar: the settled total vs the fixed gate; gate result in words.
  const chartTitle = panel.querySelector('[data-chart-title]');
  if (chartTitle) chartTitle.textContent = `ימי טיפול — ${label} (סופי)`;
  setStatLabel(panel, 'daysSoFar', 'ימי טיפול בחודש');
  setStatLabel(panel, 'daysProjection', 'המכסה');
  const firstItem = plan.items.find(it => it.id === 'first');
  const firstNeed = firstItem ? firstItem.need : target;
  const denom = Math.max(nights, firstNeed, 1);
  const bar = panel.querySelector('[data-bep-bar]');
  bar.classList.toggle('above', s.amount > 0);
  panel.querySelector('[data-bep-fill]').style.width = Math.min(100, (nights / denom) * 100) + '%';
  const marker = panel.querySelector('[data-bep-marker]');
  marker.style.right = Math.min(100, (firstNeed / denom) * 100) + '%';
  panel.querySelector('[data-bep-marker-label]').textContent = `יעד ${fmtInt(firstNeed)}`;
  setStat(panel, 'daysSoFar', fmtInt(nights));
  setStat(panel, 'daysTarget', fmtInt(firstNeed));
  setStat(panel, 'daysProjection', s.gatePassed ? 'הושלמה' : 'לא הושלמה');

  const chart = Array.isArray(h.dailyChart) && h.dailyChart.length ? h.dailyChart
    : (sh && sh.ok && Array.isArray(sh.dailyChart) ? sh.dailyChart : []);
  renderDailySpark(panel, chart, threshold, capacity);
  if (!chart.length) {
    const host = panel.querySelector('[data-daily-spark]');
    // «אין נתוני…» only when the month's payload arrived without a chart; a
    // fetch still running or failed says so.
    if (host) {
      host.innerHTML = !sh
        ? `<div class="history-empty" data-bonus-history-state="chart-loading">טוען תפוסה יומית — ${label}…</div>`
        : !sh.ok
          ? `<div class="history-empty error" data-bonus-history-state="chart-error">שגיאה בטעינת התפוסה היומית ל${label}: ${escapeHtml_(sh.error)}</div>`
          : `<div class="history-empty" data-bonus-history-state="no-chart">אין נתוני תפוסה יומית ל${label}</div>`;
    }
  }

  renderSettledLogs_(panel, sh, label);

  // Occupancy-history card: independent of the bonus picker, rendered as is.
  renderHistoryPicker_(panel, key);
  renderHistoryView_(panel, key);
  renderOccupancyCard_(panel.querySelector('[data-occupancy-card]'), [key]);
  if (window.Work) window.Work.onHouseRendered(panel, key); // work tabs (lists + logs)
}

/* Entry / exit logs of a FINISHED month, from its own house payload.
 * Three explicit states — never «אין נתונים» for data that was not fetched:
 *   loading → «טוען כניסות — <חודש>…»
 *   error   → «שגיאה בטעינת כניסות ל<חודש>: …»
 *   ok      → the rows (names escaped by activityRowHtml), or, when the
 *             month really had none, «לא היו כניסות ב<חודש>». */
function renderSettledLogs_(panel, sh, label) {
  [['entries', 'כניסות', sh && sh.ok ? sh.entries : null],
   ['exits', 'יציאות', sh && sh.ok ? sh.exits : null]].forEach(([name, word, list]) => {
    const ul = panel.querySelector(`[data-log="${name}"]`);
    if (!ul) return;
    if (!sh) {
      ul.innerHTML = `<li class="log-empty" data-settled-log="loading">טוען ${word} — ${label}…</li>`;
    } else if (!sh.ok) {
      ul.innerHTML = `<li class="log-empty error" data-settled-log="error">שגיאה בטעינת ${word} ל${label}: ${escapeHtml_(sh.error)}</li>`;
    } else if (!list.length) {
      ul.innerHTML = `<li class="log-empty" data-settled-log="empty">לא היו ${word} ב${label}</li>`;
    } else {
      renderActivityLog(ul, list);
    }
  });
}

/* ============================================================
   Occupancy history (house-detail month picker)
   Display-only. Reads/writes ONLY state.historyMonth / state.historyByMonth /
   state.loadingHistory and never touches state.overview, state.monthOverviews,
   state.prevOverview, state.details or state.chartsByMonth — so the bonus
   KPIs, hero banner, month split and house cards are unaffected by whatever
   month is selected here (asserted in test/app-render.test.js). All bonus
   math stays in lib/bonus-eligibility.js; a past month is labelled with the
   settled convention from BonusView (final state, never "בתהליך").
   ============================================================ */

function isValidYM_(ym) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''));
}

/* The month the live overview is on (what "current" means for the picker). */
function historyNowYM_() {
  return state.overview?.month || currentMonthYM_();
}

/* Months offered by the picker, newest first: the current month back
 * HISTORY_LOOKBACK_MONTHS months, floored at HISTORY_FLOOR_YM. */
function historyMonths_(nowYM = historyNowYM_()) {
  const p = window.BonusView.ymParts(nowYM);
  if (!p) return [];
  const out = [];
  for (let i = 0; i < HISTORY_LOOKBACK_MONTHS; i++) {
    const ym = currentMonthYM_(new Date(p.year, p.month - 1 - i, 1));
    if (ym < HISTORY_FLOOR_YM) break;
    out.push(ym);
  }
  return out;
}

/* Option label: the running month carries the running convention, every
 * other month the settled one. */
function historyOptionLabel_(ym, nowYM) {
  const label = window.BonusView.monthLabel(ym);
  return ym === nowYM ? `${label} — חודש נוכחי (בתהליך)` : `${label} — סופי`;
}

/* Fill the <select> (once per month set — an open picker is never reset),
 * restore the house's selection and wire the change handler once. */
function renderHistoryPicker_(panel, key) {
  const sel = panel.querySelector('[data-history-month]');
  if (!sel) return;
  const nowYM = historyNowYM_();
  const months = historyMonths_(nowYM);
  const chosen = state.historyMonth[key];
  if (chosen && !months.includes(chosen)) state.historyMonth[key] = null; // out of range → current
  const selected = state.historyMonth[key] || nowYM;
  const sig = months.join(',');
  if (sel.getAttribute('data-months') !== sig) {
    sel.innerHTML = months
      .map(ym => `<option value="${ym}">${historyOptionLabel_(ym, nowYM)}</option>`)
      .join('');
    sel.setAttribute('data-months', sig);
  }
  sel.value = selected;
  if (!sel.getAttribute('data-wired')) {
    sel.setAttribute('data-wired', '1');
    sel.addEventListener('change', () => { selectHistoryMonth_(key, sel.value); });
  }
}

function historyEntry_(key, ym) {
  return (state.historyByMonth[ym] || {})[key] || null;
}

/* Picker change: validate the value (never trust the DOM), record the
 * selection for this house, fetch the month if it is not cached (a failed
 * month is retried on re-select) and re-render the history view only. */
async function selectHistoryMonth_(key, ym) {
  const nowYM = historyNowYM_();
  const target = isValidYM_(ym) ? String(ym) : nowYM;
  state.historyMonth[key] = target === nowYM ? null : target;
  const panel = document.getElementById(`panel-${key}`);
  if (!panel) return;
  renderHistoryPicker_(panel, key); // the <select> always mirrors state (invalid → current month)
  renderHistoryView_(panel, key);   // current month → hidden; else cached / loading
  const entry = state.historyMonth[key] ? historyEntry_(key, target) : null;
  if (state.historyMonth[key] && (!entry || !entry.ok)) {
    await loadHistoryMonth_(key, target);
    renderHistoryView_(panel, key);
  }
}

/* Fetch one past month for one house, FAIL-CLOSED:
 *   1. `managersOverview&month=YYYY-MM` via fetchMonthOverview_ (the existing
 *      per-month path) → the house's settled avgDaily / treatmentDays. A
 *      month the bonus code already loaded (state.monthOverviews) is reused
 *      read-only, without a second request.
 *   2. The daily chart: from that payload when the backend includes one;
 *      otherwise ONE `managersHouse&house=…&month=…` attempt whose response
 *      is accepted only when its `month` equals the requested month — a
 *      current-month payload is never shown under a past month's label.
 *      No usable chart → an explicit "no daily data" note.
 * Any error is cached as { ok:false, error } so the view shows an explicit
 * error state — never blank, never a stale month. */
async function loadHistoryMonth_(key, ym) {
  const slot = `${key}:${ym}`;
  if (state.loadingHistory[slot]) return state.loadingHistory[slot];
  const run = (async () => {
    let entry;
    try {
      const byKey = (state.monthOverviews || {})[ym] || await fetchMonthOverview_(ym);
      const ph = byKey[key];
      if (!ph) throw new Error(`אין נתונים לבית זה עבור ${window.BonusView.monthLabel(ym)}`);
      let chart = monthChart_(ph.dailyChart, ym);
      if (!chart) {
        try {
          const hd = await fetchJson(`/api/sheets?action=managersHouse&house=${encodeURIComponent(key)}&month=${encodeURIComponent(ym)}`);
          if (hd && hd.month === ym) chart = monthChart_(hd.dailyChart, ym);
        } catch (e) {
          console.error(`daily chart for ${key} ${ym} failed`, e);
        }
      }
      entry = {
        ok: true,
        avgDaily: Number(ph.avgDaily) || 0,
        treatmentDays: Number(ph.treatmentDays) || 0,
        dailyChart: chart
      };
    } catch (e) {
      console.error(`history ${key} ${ym} failed`, e);
      entry = { ok: false, error: (e && e.message) || 'שגיאה' };
    }
    if (!state.historyByMonth[ym]) state.historyByMonth[ym] = {};
    state.historyByMonth[ym][key] = entry;
    return entry;
  })();
  state.loadingHistory[slot] = run;
  try { return await run; } finally { delete state.loadingHistory[slot]; }
}

/* The chart points that belong to `ym` (well-formed YYYY-MM-DD dates only).
 * Null when the chart is missing or has no point in that month. */
function monthChart_(chart, ym) {
  if (!Array.isArray(chart)) return null;
  const pts = chart.filter(p =>
    p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date.slice(0, 7) === ym
  );
  return pts.length ? pts : null;
}

/* Render the selected month into [data-history-view]. The current month
 * hides the view (the live blocks below already show it). A past month is
 * always labelled "(סופי)" with the settled wording from BonusView. */
function renderHistoryView_(panel, key) {
  const view = panel.querySelector('[data-history-view]');
  if (!view) return;
  const BV = window.BonusView;
  const ym = state.historyMonth[key];
  if (!ym || ym === historyNowYM_()) {
    view.hidden = true;
    view.innerHTML = '';
    return;
  }
  view.hidden = false;
  const label = BV.monthLabel(ym);
  const entry = historyEntry_(key, ym);
  if (!entry) {
    view.innerHTML = `<div class="loading" data-history-state="loading">טוען תפוסה — ${label}…</div>`;
    return;
  }
  if (!entry.ok) {
    view.innerHTML = `<div class="loading error" data-history-state="error">שגיאה בטעינת ${label}: ${escapeHtml_(entry.error)}</div>`;
    return;
  }
  const h = state.housesById[key] || { key };
  const threshold = resolveThreshold(atYM_({ ...h, key }, ym)); // that month's rules
  const capacity = resolveCapacity(h);
  const settled = BV.settledMonthView(
    { key, ym, avgDaily: entry.avgDaily, treatmentDays: entry.treatmentDays },
    resolveThreshold
  );
  const chart = entry.dailyChart;
  view.innerHTML = `
    <div class="history-month-title" data-history-title>תפוסה יומית — ${label} (סופי)</div>
    <div class="bep-legend history-figures" data-history-figures>
      <span>ימי טיפול — ${label}: <b data-history-days>${fmtInt(settled.treatmentDays)} / ${fmtInt(settled.gate)}</b></span>
      <span>ממוצע יומי: <b>${fmtNum1_(settled.avgDaily)} מטופלים/יום</b></span>
    </div>
    <div class="history-status" data-history-status>${settled.statusText}</div>
    ${chart ? `
    <div class="daily-spark-wrap">
      <div class="daily-spark-y-label">מטופלים</div>
      <div data-history-spark></div>
    </div>
    <ul class="daily-spark-legend">
      <li><span class="dsl-mark dsl-line"></span><span data-history-legend-line>הקו הכתום = זכאות לבונוס</span></li>
      <li><span class="dsl-mark dsl-bar"></span><span>העמודות = מספר מטופלים בפועל בכל יום</span></li>
    </ul>`
    : `<div class="history-empty" data-history-state="no-chart">אין נתוני תפוסה יומית ל${label} — מוצגים סיכומי החודש בלבד</div>`}
  `;
  if (chart) {
    renderDailySparkInto_(
      view.querySelector('[data-history-spark]'),
      view.querySelector('[data-history-legend-line]'),
      chart, threshold, capacity
    );
  }
}

/* ============================================================
   Monthly occupancy — permanent «תפוסה חודשית (סופי)» view
   Its own feed (`occupancySnapshots`), its own state slice
   (state.occupancy) and its own DOM host. It never reads or writes
   state.overview / state.monthOverviews / state.prevOverview /
   state.details / state.chartsByMonth / state.bonus* — so no bonus KPI,
   hero, card or picker can change because of it (asserted in
   test/occupancy-view.test.js).

   Rules (docs/occupancy-history-view.md → "Monthly occupancy (permanent)"):
     - rows = SETTLED months only, newest first, from OCCUPANCY_FLOOR_YM.
       The running month is never listed and is never labelled "בתהליך".
     - columns = the five houses; every label comes from HOUSE_LABELS.
     - a missing month/house cell says "אין נתונים" — never 0, never blank.
     - a failed or unknown action → an explicit error state with a retry
       button. There is no silent fallback computation.
     - feed values reach the DOM through textContent only.
   ============================================================ */

/* Backend house-id → frontend key ('arfoni' → 'efroni'). Unknown ids are
 * dropped: an id the app does not know is not guessed into a column. */
function houseKeyOf_(houseId) {
  const raw = String(houseId == null ? '' : houseId).trim();
  const key = BACKEND_HOUSE_IDS[raw] || raw;
  return HOUSE_KEYS.includes(key) ? key : '';
}

/* Occupancy percentage for one snapshot row: the backend's own figure when
 * it is a sane number, else derived from avgDaily / capacity. null when
 * neither is available — the caller then treats the row as missing and the
 * cell says "אין נתונים" instead of showing 0%. */
function occupancyPct_(pct, avgDaily, capacity) {
  const p = Number(pct);
  if (Number.isFinite(p) && p >= 0 && p <= 200) return p;
  const avg = Number(avgDaily);
  const cap = Number(capacity);
  if (Number.isFinite(avg) && avg >= 0 && cap > 0) return (avg / cap) * 100;
  return null;
}

/* One raw snapshot row → the normalised row the table and the CSV share.
 * ONLY the documented fields are read (month, houseId, treatmentDays,
 * daysInMonth, avgDaily, capacity, occupancyPct, manager); everything else
 * the payload carries is dropped here and can never reach the DOM or the
 * file. Returns null for a row that is unusable (bad month, unknown house,
 * no occupancy figure) — a missing cell, not a zero. */
function occupancyRow_(raw) {
  if (!raw) return null;
  const month = String(raw.month || '');
  if (!isValidYM_(month)) return null;
  const key = houseKeyOf_(raw.houseId);
  if (!key) return null;
  const labels = HOUSE_LABELS[key] || {};
  const capacity = Number(raw.capacity) > 0 ? Number(raw.capacity) : (Number(labels.capacity) || 0);
  const avgDaily = Number(raw.avgDaily);
  const treatmentDays = Number(raw.treatmentDays);
  const daysInMonth = Number(raw.daysInMonth) > 0 ? Number(raw.daysInMonth) : daysInMonthFromLabel(month);
  const pct = occupancyPct_(raw.occupancyPct, avgDaily, capacity);
  if (pct === null) return null;
  return {
    month,
    key,
    houseLabel: labels.name || key,
    manager: window.BonusView.safeLabel(raw.manager) || labels.manager || '',
    treatmentDays: Number.isFinite(treatmentDays) ? treatmentDays : null,
    daysInMonth,
    avgDaily: Number.isFinite(avgDaily) ? avgDaily : null,
    capacity,
    occupancyPct: pct
  };
}

/* The table model: months newest first (settled months only) × the requested
 * houses. `keys` defaults to the whole roster (overview card); a house tab
 * passes its own key only. */
function occupancyTable_(rawRows, opts = {}) {
  const nowYM = opts.nowYM || historyNowYM_();
  const requested = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : HOUSE_KEYS;
  const keys = requested.filter(k => HOUSE_KEYS.includes(k));
  const allowed = new Set(keys);
  const byMonth = {};
  (Array.isArray(rawRows) ? rawRows : []).forEach(raw => {
    const row = occupancyRow_(raw);
    if (!row || !allowed.has(row.key)) return;
    if (row.month < OCCUPANCY_FLOOR_YM) return; // before the bonus era
    if (row.month >= nowYM) return;             // the running month is never settled
    if (!byMonth[row.month]) byMonth[row.month] = {};
    byMonth[row.month][row.key] = row;
  });
  return { months: Object.keys(byMonth).sort().reverse(), byMonth, keys };
}

/* The rows of the CSV, in the order the table shows them (month newest
 * first, houses in column order). Missing cells are simply absent — an
 * empty row would export as zeros. */
function occupancyCsvRows_(model) {
  const out = [];
  model.months.forEach(ym => {
    model.keys.forEach(key => {
      const row = (model.byMonth[ym] || {})[key];
      if (row) out.push(row);
    });
  });
  return out;
}

/* Build the CSV and hand it to the browser. Returns { name, csv, rows } so
 * the export can be asserted without a Blob; null when there is nothing to
 * export. */
function exportOccupancyCsv_(keys) {
  const model = occupancyTable_(state.occupancy.rows, { keys });
  const rows = occupancyCsvRows_(model);
  if (!rows.length) return null;
  const csv = window.OccupancyExport.buildCsv(rows);
  const name = window.OccupancyExport.fileName(model.months[model.months.length - 1], model.months[0]);
  downloadCsv_(csv, name);
  return { name, csv, rows: rows.length };
}

/* Blob download. Wrapped: a browser without Blob/URL (or a test sandbox)
 * must not break the view — the CSV is still built and returned above. */
function downloadCsv_(text, filename) {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    if (document.body && document.body.appendChild) document.body.appendChild(a);
    a.click();
    if (typeof a.remove === 'function') a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (e) {
    console.error('CSV download failed', e);
  }
}

/* Fetch the snapshots ONCE per page (they are settled months — they do not
 * change under us). `force` is the retry button. Fail-closed: any error, a
 * non-JSON body, an unknown action or a payload without `rows` leaves an
 * explicit error state. */
async function ensureOccupancy_({ force = false } = {}) {
  if (state.loadingOccupancy) return state.loadingOccupancy;
  if (!force && state.occupancy.status === 'ok') return null;
  state.occupancy = { status: 'loading', rows: state.occupancy.rows, error: '' };
  renderOccupancyEverywhere_();
  const run = (async () => {
    try {
      const data = await fetchJson('/api/sheets?action=occupancySnapshots');
      if (!data || !Array.isArray(data.rows)) throw new Error('תשובה לא תקינה מהשרת');
      state.occupancy = { status: 'ok', rows: data.rows, error: '' };
    } catch (e) {
      console.error('occupancySnapshots failed', e);
      state.occupancy = { status: 'error', rows: [], error: (e && e.message) || 'שגיאה' };
    }
    renderOccupancyEverywhere_();
  })();
  state.loadingOccupancy = run;
  try { await run; } finally { state.loadingOccupancy = null; }
  return run;
}

/* Element helper — every feed value goes in as textContent, never as HTML. */
function el_(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/* Render the card into `host` (the overview card, or a house tab's card).
 * `keys` = the columns: the whole roster on the overview, one house on a
 * house tab. */
function renderOccupancyCard_(host, keys) {
  if (!host) return;
  host.innerHTML = '';
  const model = occupancyTable_(state.occupancy.rows, { keys });
  const status = state.occupancy.status;

  const head = el_('div', 'occupancy-head');
  head.appendChild(el_('div', 'card-title', 'תפוסה חודשית (סופי)'));
  if (status === 'ok' && model.months.length) {
    const btn = el_('button', 'link-btn', 'ייצוא CSV');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-occupancy-export', '1');
    btn.addEventListener('click', e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      exportOccupancyCsv_(keys);
    });
    head.appendChild(btn);
  }
  host.appendChild(head);

  const body = el_('div', 'occupancy-body');
  body.setAttribute('data-occupancy-body', '1');
  host.appendChild(body);

  if (status === 'error') {
    const err = el_('div', 'loading error', `שגיאה בטעינת תפוסה חודשית: ${state.occupancy.error}`);
    err.setAttribute('data-occupancy-state', 'error');
    body.appendChild(err);
    const retry = el_('button', 'link-btn', 'נסו שוב');
    retry.setAttribute('type', 'button');
    retry.setAttribute('data-occupancy-retry', '1');
    retry.addEventListener('click', e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      ensureOccupancy_({ force: true });
    });
    body.appendChild(retry);
    return;
  }
  if (status !== 'ok') {
    const note = el_('div', 'loading', 'טוען תפוסה חודשית…');
    note.setAttribute('data-occupancy-state', 'loading');
    body.appendChild(note);
    return;
  }
  if (!model.months.length) {
    const note = el_('div', 'history-empty', 'אין נתונים');
    note.setAttribute('data-occupancy-state', 'empty');
    body.appendChild(note);
    return;
  }
  body.appendChild(occupancyTableEl_(model));
}

/* The table itself — createElement + textContent only. */
function occupancyTableEl_(model) {
  const BV = window.BonusView;
  const wrap = el_('div', 'occupancy-scroll');
  const table = el_('table', 'occupancy-table');
  table.setAttribute('data-occupancy-table', '1');

  const thead = el_('thead');
  const headRow = el_('tr');
  const corner = el_('th', 'occ-col-month', 'חודש');
  corner.setAttribute('scope', 'col');
  headRow.appendChild(corner);
  model.keys.forEach(key => {
    const th = el_('th', 'occ-col-house', (HOUSE_LABELS[key] || {}).name || key);
    th.setAttribute('scope', 'col');
    th.setAttribute('data-occupancy-house', key);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el_('tbody');
  model.months.forEach(ym => {
    const tr = el_('tr');
    tr.setAttribute('data-occupancy-row', ym);
    const th = el_('th', 'occ-month', `${BV.monthLabel(ym)} — סופי`);
    th.setAttribute('scope', 'row');
    tr.appendChild(th);
    model.keys.forEach(key => {
      const row = (model.byMonth[ym] || {})[key];
      const td = el_('td', 'occ-cell');
      td.setAttribute('data-occupancy-cell', `${ym}:${key}`);
      if (!row) {
        td.setAttribute('data-occupancy-missing', '1');
        td.appendChild(el_('div', 'occ-none', 'אין נתונים'));
      } else {
        td.appendChild(el_('div', 'occ-pct', `${fmtNum1_(row.occupancyPct)}%`));
        const sub = (row.avgDaily === null || !row.capacity)
          ? '—'
          : `${fmtNum1_(row.avgDaily)}/${fmtInt(row.capacity)}`;
        td.appendChild(el_('div', 'occ-sub', sub));
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* Re-render every occupancy host that exists: the overview card and the card
 * of every house tab that has already been opened. */
function renderOccupancyEverywhere_() {
  renderOccupancyCard_(document.getElementById('occupancyCard'), HOUSE_KEYS);
  HOUSE_KEYS.forEach(key => {
    const panel = document.getElementById(`panel-${key}`);
    if (!panel || !(panel.getAttribute('data-rendered') || panel.firstChild)) return;
    renderOccupancyCard_(panel.querySelector('[data-occupancy-card]'), [key]);
  });
}






/* The bonuses of the month (BonusView.bonusPlanView) — one coloured block
 * per bonus: what it pays, the condition in plain words, where the house
 * stands NOW in real figures, and a status chip. Every string is escaped. */
function renderBonusPlan_(panel, view) {
  renderBonusGauge_(panel, view);
  const ul = panel.querySelector('[data-breakdown]');
  if (!ul || !view) return;
  ul.innerHTML = '';
  const e = escapeHtml_;
  const title = panel.querySelector('[data-bonus-plan-title]');
  if (title) title.textContent = view.title;
  view.items.forEach(it => {
    const li = document.createElement('li');
    li.className = `bp-item bp-${it.id} st-${it.state}`;
    li.setAttribute('data-bonus-item', it.id);
    li.innerHTML = `
      <div class="bp-head">
        <span class="bp-title">${e(it.title)}</span>
        <span class="bp-pay">${e(it.amountText)}</span>
      </div>
      <div class="bp-row"><span class="bp-k">תנאי:</span> <span class="bp-cond">${e(it.condition)}</span></div>
      <div class="bp-row"><span class="bp-k">מצב:</span> <span class="bp-status">${e(it.status)}</span></div>
      ${it.extra ? `<div class="bp-extra">${e(it.extra)}</div>` : ''}
      <div class="bp-foot">
        <span class="bp-chip">${e(it.chip)}</span>
        ${!it.amountKnown ? '<span class="bk-amount">—</span>' : it.amount > 0 ? `<span class="bk-amount">${fmtCurrency(it.amount)}</span>` : ''}
      </div>`;
    ul.appendChild(li);
  });
  const totalLabel = panel.querySelector('[data-bonus-total-label]');
  if (totalLabel) totalLabel.textContent = view.totalLabel;
  const total = panel.querySelector('[data-stat="bonusTotal"]');
  if (total) total.textContent = fmtCurrency(view.total);
  const note = panel.querySelector('[data-bonus-fallback-note]');
  if (note) note.textContent = view.totalNote || '';
}

/* The dashboard dial (14 Oct 2026). Numbers only in the SVG; every string
 * comes from BonusView.bonusGaugeView and is escaped. */
function gaugeSvg_(pct, projPct, tone) {
  const R = 80, CX = 100, CY = 100, LEN = Math.PI * R;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const pt = (q, r) => {
    const a = Math.PI * (1 - q / 100);
    return [(CX + r * Math.cos(a)).toFixed(1), (CY - r * Math.sin(a)).toFixed(1)];
  };
  const [nx, ny] = pt(p, 66);
  let proj = '';
  if (projPct != null && Number.isFinite(Number(projPct))) {
    const q = Math.max(0, Math.min(100, Number(projPct)));
    const [x1, y1] = pt(q, 70), [x2, y2] = pt(q, 92);
    proj = `<line class="g-proj" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  const t = ['good', 'ok', 'warn', 'bad'].includes(tone) ? tone : 'ok';
  return `<svg class="gauge g-${t}" viewBox="0 0 200 112" role="img" aria-hidden="true">
    <defs><linearGradient id="gGrad" x1="0" x2="1"><stop offset="0" stop-color="#F87171"/><stop offset="0.5" stop-color="#FCD34D"/><stop offset="1" stop-color="#34D399"/></linearGradient></defs>
    <path class="g-track" d="M20,100 A80,80 0 0 1 180,100"/>
    <path class="g-zone" d="M20,100 A80,80 0 0 1 180,100" stroke="url(#gGrad)"/>
    <path class="g-fill" d="M20,100 A80,80 0 0 1 180,100" stroke-dasharray="${(LEN * p / 100).toFixed(1)} ${LEN.toFixed(1)}"/>
    ${proj}
    <line class="g-needle" x1="${CX}" y1="${CY}" x2="${nx}" y2="${ny}"/>
    <circle class="g-hub" cx="${CX}" cy="${CY}" r="7"/>
  </svg>`;
}

function renderBonusGauge_(panel, plan) {
  const host = panel.querySelector('[data-dash-bonus]');
  const BVg = typeof window !== 'undefined' ? window.BonusView : null;
  if (!host || !plan || !BVg || !BVg.bonusGaugeView) return;
  const g = BVg.bonusGaugeView(plan);
  const e = escapeHtml_;
  host.className = `card dash-card dash-bonus tone-${['good', 'ok', 'warn', 'bad'].includes(g.tone) ? g.tone : 'ok'}`;
  host.innerHTML = `
    <div class="card-title">הבונוס שלי — ${e(plan.monthLabel || '')}</div>
    <div class="gauge-wrap">
      ${gaugeSvg_(g.pct, g.projPct, g.tone)}
      <div class="gauge-center">
        <div class="gauge-value">${e(g.valueText)}</div>
        <div class="gauge-of">${e(g.ofText)}</div>
      </div>
    </div>
    <div class="gauge-head">${e(g.headline)}</div>
    ${g.hint ? `<div class="gauge-hint">${e(g.hint)}</div>` : ''}
    ${g.projPct != null ? '<div class="gauge-legend"><span class="gl-proj"></span> הקו הלבן = לאן תגיעו בקצב הנוכחי</div>' : ''}
    <div class="gauge-earned"><span>${e(g.earnedLabel)}</span><strong>${e(g.earnedText)}</strong></div>
    ${plan.calc && BVg.bonusCalcView ? calcShellHtml_(plan.calc) : ''}
    <button type="button" class="dash-go" data-go-sub="bonus">לכל פרטי הבונוסים ←</button>`;
  host._calcCtx = plan.calc || null;
  if (plan.calc && BVg.bonusCalcView) updateCalc_(host);
  if (!host.getAttribute('data-calc-wired')) {
    host.setAttribute('data-calc-wired', '1');
    host.addEventListener('input', (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest('[data-calc]')) updateCalc_(host);
    });
  }
}

/* «מה אם?» — the sliders start at today's pace; every figure comes from
 * BonusView.bonusCalcView (same step rule as the bonus boxes). */
function calcShellHtml_(ctx) {
  const elapsed = Math.max(1, Number(ctx.elapsedDays) || 1);
  const pace = Math.round((Number(ctx.daysSoFar) || 0) / elapsed);
  const max = Number(ctx.capacity) > 0 ? Number(ctx.capacity) : 30;
  return `
    <div class="calc" data-calc>
      <div class="calc-title">🎮 מחשבון בונוס — מה אם?</div>
      <label class="calc-row">
        <span>מטופלים ליום מעכשיו ועד סוף החודש: <b data-calc-out="perDay">${Math.min(max, pace)}</b></span>
        <input type="range" min="0" max="${max}" step="1" value="${Math.min(max, pace)}" data-calc-in="perDay" aria-label="מטופלים ליום עד סוף החודש">
      </label>
      <label class="calc-row">
        <span>עוד פגישות קליטה (המטופל ה-7 ומעלה): <b data-calc-out="extraIntake">0</b></span>
        <input type="range" min="0" max="10" step="1" value="0" data-calc-in="extraIntake" aria-label="פגישות קליטה נוספות">
      </label>
      <label class="calc-row">
        <span>עוד מטופלים שיעברו לטיפול יום: <b data-calc-out="extraReferral">0</b></span>
        <input type="range" min="0" max="10" step="1" value="0" data-calc-in="extraReferral" aria-label="מטופלים נוספים בטיפול יום">
      </label>
      <div class="calc-proj" data-calc-proj></div>
      <ul class="calc-lines" data-calc-lines></ul>
      <div class="calc-total"><span>סה״כ בונוס צפוי</span><strong data-calc-total>—</strong></div>
      <div class="calc-tip" data-calc-tip></div>
      <div class="calc-note" data-calc-note></div>
    </div>`;
}

function updateCalc_(host) {
  const BVg = typeof window !== 'undefined' ? window.BonusView : null;
  const ctx = host._calcCtx;
  if (!ctx || !BVg || !BVg.bonusCalcView) return;
  const val = (k) => {
    const el = host.querySelector(`[data-calc-in="${k}"]`);
    return el ? Number(el.value) : 0;
  };
  const v = BVg.bonusCalcView(ctx, { perDay: val('perDay'), extraIntake: val('extraIntake'), extraReferral: val('extraReferral') });
  if (!v) return;
  const set = (sel, text) => { const el = host.querySelector(sel); if (el) el.textContent = text; };
  set('[data-calc-out="perDay"]', String(v.perDay));
  set('[data-calc-out="extraIntake"]', String(val('extraIntake')));
  set('[data-calc-out="extraReferral"]', String(val('extraReferral')));
  set('[data-calc-proj]', v.projectedText);
  set('[data-calc-total]', v.totalText);
  set('[data-calc-tip]', v.tip);
  set('[data-calc-note]', v.pendingNote);
  const ul = host.querySelector('[data-calc-lines]');
  if (ul) {
    ul.textContent = '';
    v.lines.forEach((ln) => {
      const li = document.createElement('li');
      li.className = `calc-line cl-${ln.k}`;
      const a = document.createElement('span'); a.textContent = ln.label;
      const b = document.createElement('b'); b.textContent = ln.amountText;
      li.appendChild(a);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
}

/* Activity log row: date + name, exactly as the feed supplies them.
 *
 * escapeHtml_ is NOT optional: the name comes from the Patients sheet, which
 * is hand-edited, and it goes straight into innerHTML. Dropping the escape
 * turns a name typed into a spreadsheet cell into markup on the page. */
function activityRowHtml(item) {
  return `
        <span class="log-date">${fmtDateShort(item.date)}</span>
        <span class="log-name">${escapeHtml_(item.name) || '—'}</span>
      `;
}

function renderActivityLog(ul, list) {
  ul.innerHTML = '';
  list
    .slice()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = activityRowHtml(item);
      ul.appendChild(li);
    });
}

function renderEntries(ul, list) { renderActivityLog(ul, list); }

function renderExits(ul, list) { renderActivityLog(ul, list); }

/* ============================================================
   Boot
   ============================================================ */

let dataStarted = false;
function startData() {
  if (dataStarted) return;
  dataStarted = true;
  loadOverview();
  // Settled months only — fetched ONCE per page, never on the 60s refresh.
  ensureOccupancy_();
  setInterval(loadOverview, 60_000);
}

/* Who is logged in (null until /api/me answered). A house manager sees only
 * their own house — the server enforces it; the client just hides the rest. */
let currentUser = null;

/* Manager: hide the network tabs («הבית היום» of all houses, «בונוס»
 * overview) and the other houses' tabs, open theirs — it lands on the
 * house's own «הבית היום» sub-tab. */
function applyRole_(u) {
  currentUser = u || null;
  if (!u || u.role === 'admin' || !HOUSE_KEYS.includes(u.house)) return;
  document.querySelectorAll('.tab').forEach(btn => {
    btn.hidden = btn.dataset.tab !== u.house;
  });
  ['panel-overview', 'panel-today'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  activateTab(u.house);
}

/* Top-level tabs: «הבית היום» (landing), «בונוס» (network overview), houses. */
const TOP_TABS_ = ['today', 'overview', ...HOUSE_KEYS];

/* The tab a user may open: a manager is always sent to their own house. */
function allowedTab_(key) {
  const u = currentUser;
  if (u && u.role !== 'admin' && HOUSE_KEYS.includes(u.house)) return u.house;
  return key;
}

function boot() {
  clearLegacySession();
  wireTabs();
  document.getElementById('monthTag').textContent = currentMonthLabel();

  // Nothing with data loads before the login: the server answers 401 to
  // every data call until a personal code has been entered.
  const ready = window.Auth ? window.Auth.init() : Promise.resolve(null);
  ready.then(u => {
    applyRole_(u);
    const hash = (location.hash || '').replace('#', '');
    if ((!u || u.role === 'admin') && TOP_TABS_.includes(hash)) activateTab(hash);
    // Admin: «הבית היום» of every house + the all-houses alerts, on the
    // landing tab (work.js).
    if (u && u.role === 'admin' && window.Work && window.Work.mountAdmin) {
      const labels = {};
      HOUSE_KEYS.forEach(k => { labels[k] = HOUSE_LABELS[k].name; });
      window.Work.mountAdmin(document.getElementById('dischargeAlertsAll'), HOUSE_KEYS, labels, document.getElementById('todayAll'));
    }
    startData();
  });
}

document.addEventListener('DOMContentLoaded', boot);
