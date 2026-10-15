[CHANGELOG (10).md](https://github.com/user-attachments/files/29659642/CHANGELOG.10.md)
# Changelog

## Unreleased

### Added — expected discharge date on «מטופלים בבית» (October 15, 2026)

- **What**: under each patient («שם · מ-<כניסה> · יום N»), a «שחרור משוער: dd/m/yy»
  line with a «שינוי» button. When no date is set there is a «הגדרת תאריך
  שחרור» button. Both open a native date picker (min = admission date) with
  «שמירה» / «ביטול».
- **Layout**: RTL, 16px text, 44px tap targets; it wraps at 360px.
- **Data**: new `/api/work` op `dischargeSet` → Dashboard `managersWork`
  `dischargeSet` (E-Zone-Dashboard PR #230, merged first). The value comes back
  in `houseData`.
- **Storage**: the append-only, audited Dashboard sheet `ManagersExpectedDischarge`:
  - every edit is a new row with who, when and the previous value;
  - the client sends `previousDate`, so a stale edit gets `conflict`, never a
    silent overwrite.
- **Older backend**: the picker shows only when the backend sends
  `expectedDischargeSupported`.
- **Why**: Sandra, 15 Oct 2026 — managers plan discharges per patient.
- **Security**:
  - session required;
  - a manager is pinned to their own house, an admin names one;
  - server-side shape validation (real dates, expected ≥ admission, name 1–80
    characters), then the Dashboard re-validates;
  - a new write rate limit, 60 / 15 min per IP, for `logAdd`, `logUpdate` and
    `dischargeSet`;
  - the same fail-closed `MANAGERS_WORK_SECRET`; no new env var, Railway
    variable or Script Property.
- **Display-only**: no bonus module reads it (guard test); the golden bonus
  snapshots are unchanged. SW cache v26 → v27.
- **Conservative readings**:
  - "2 MB body limit" → the existing, stricter 16 kb JSON limit is kept (and
    tested);
  - "Script Properties secret" → the existing `MANAGERS_WORK_SECRET`;
  - "set or change" → a date cannot be cleared.
- **Tests**: 273 → 287 passing (+14, `test/expected-discharge.test.js`). The
  opt-in Dashboard integration test now also covers `dischargeSet` and pins the
  sheet header (append-only guard).

### Changed — richer colours on the Managers work tabs (October 15, 2026)

- **What**: the work sub-tabs (patients, team, therapists, staff talks,
  events) use the same hues, just stronger. Card tint 26%/8% → 38%/15%,
  border 50% → 70%. Inactive sub-tabs: background 14% → 24%, text 45% → 65%,
  border 55% → 75%. Log entries 0.03 → 0.07. Form inputs get a 55% section-colour
  border. KPIs 22% → 34%. Muted/dim text is 0.88/0.85, card subtitles go from a
  50% to a 35% colour mix, and work-card notes are `#DDD6FE`.
- **Why**: the tabs looked faded. The token change is scoped to the five work
  panels, so the Dashboard tab, the gauge and every bonus-view output are
  unchanged. Every text colour is at least 4.5:1 (WCAG AA) on the lightest
  stop of every tinted card. Edits are CSS only, with no logic or layout
  change. SW cache v25 → v26.
- **Tests**: new `test/work-colours.test.js` parses `styles.css`. It pins the
  minimums (mute ≥ 0.85, card tint ≥ 36%, …), checks that the `:root` tokens
  are unchanged and recomputes the AA ratios. 269 → 274 tests (+5).

### Security — coordinated Managers protocol 2 (October 14, 2026; pending deployment)

- Authenticate all upstream reads with a JSON-body secret and session-derived
  identity/scope; compatible Dashboard changes are required.
- Require immutable unique IDs in `MANAGER_ACCESS` and sessions; use backend
  `canEdit` instead of matching display names. SW cache v24 → v25.
- Gate Railway activation on an authenticated protocol/capability probe through
  `/healthz`; fail closed on a secret mismatch, old backend or timeout.
- Document legacy-note handling and the staged deployment/configuration order
  in `docs/managers-hardening-rollout.md`. No live account values are assumed.
- Add same-name, code-reuse, readiness and cross-repository integration checks.

### Added — work tool, stage 3: the house manpower cost (October 14, 2026)

**What** (Sandra, 14 Oct: «בכל בית תהיה עלות של הבית עצמו, כל מנהל לעצמו יכול לראות»): a
«עלות כוח אדם» card on each house's dashboard. It shows:
- the month's estimated cost;
- a budget bar with the % used and what is left, or an over-budget warning;
- the split: guides, from the payroll report, estimate, and missing data when there is any;
- an honest note when no payroll report has arrived yet.

**How:** `/api/work` op `houseCost`, with the house decided by the server and a manager getting
only their own. It goes to Dashboard `managersWork` `houseCost` (E-Zone-Dashboard #227), which
reads the staffing feed `getHouseCostsForManagers` (ezone-staffing #96). The data is house
totals only and never a worker or salary. The card loads separately, so the dashboard never
waits on staffing. When the cost can't be read it shows a message, never 0 ₪. SW v23 → v24.

**Also:** `/api/work` now requires a `log` only for `logAdd` / `logUpdate`.

**Tests:** 259 → 263 (cost card: normal, over budget, no budget, unavailable; the server
scopes `houseCost` to the manager's own house; the family-calls log is refused).

### Added — expected admissions + «מה אם?» bonus calculator on the dashboard (October 14, 2026)

**What** (Sandra, 14 Oct: expected admissions this week, and a bonus calculator that plays all
the bonuses together, in the same box as the dial):
- **Bonus calculator** inside the dial card, with three sliders:
  - patients per day from now to the end of the month (starts at today's pace);
  - more intake meetings;
  - more patients moving to day treatment.

  It shows the treatment days the month would reach, each bonus line (occupancy step, intake
  × 250 ₪, continued treatment × 300 ₪), the total, and a tip (for example «עם 16 מטופלים ליום
  … מגיעים לבונוס ראשון»). Running month only.
- **Expected admissions:** a «קליטות צפויות השבוע» tile and a list of the next 14 days. Each
  entry shows the stage in words, and this week's entries are highlighted. The data is the
  Dashboard `houseData.expectedAdmissions` (E-Zone-Dashboard #226). An older server shows «—».
  The «מטופלי חוץ מהבית» tile moved off the dashboard; the outpatients list is still in
  «מטופלים».

**How:** `BonusView.bonusCalcView` uses the same step rule as the bonus boxes and the
month-aware rule sets. `bonusPlanView` now also returns `calc` (its starting point, running month
only). `app.js` only wires the sliders and writes `textContent`. SW v22 → v23.

**Tests:** 253 → 259 (calculator: starting point, today's pace, all together, clamping;
expected admissions: this week, next week, past and old server).

### Added — manager dashboard, colour pass, family calls removed (October 14, 2026)

**What** (Sandra, 14 Oct: a dashboard per manager with a bonus dial; what is happening in the
house today and this week; remove family calls; much more colour):
- **New first house tab «ראשי» (dashboard):**
  - **Bonus dial:** a gauge toward the next occupancy bonus still in play, plus a «לאן תגיעו
    בקצב הנוכחי» projection line, a plain-words headline, what is needed until the end of the
    month, and the total already earned. A link opens «בונוסים».
  - **היום בבית:** patients in the house, on shift today, therapy sessions today and open
    reminders, with the lists.
  - **ביקורים וקליטות:** visits this week and this month, admissions, outpatients from the house,
    upcoming visits and the latest admissions.
  - **אירועים חריגים אחרונים.**
- **«שיחות משפחה» removed:** the tab, the form and the reminders for it are gone, and
  `/api/work` refuses that log. Rows already in the Dashboard sheet are kept.
- **Colour:**
  - each bonus box is filled in its own colour (amber, blue, violet, green);
  - each sub-tab has its own colour, and its section's cards are tinted to match;
  - the KPI tiles have four colours, and entries and exits are green and coral;
  - the base background is slightly lighter.

**How:** the dial's wording and maths live in `BonusView.bonusGaugeView`, built from
`bonusPlanView`, which now also returns `days` and `projected`. `app.js` only draws the SVG.
The house part is `WorkView.dashboardHtml`, and every value is escaped. SW v21 → v22.

**Tests:** 245 → 253 (gauge: running, on-track, settled and clamped; dashboard: today, week
and month, not connected; family calls gone; log tests moved to staff talks and events).
Also checked in Chromium at 390 px.

### Changed — login asks for a username as well as the code (October 14, 2026)

**What:** the login screen has «שם משתמש» above «הקוד האישי שלך». The username and the code must
belong to the same person.
- The username is the person's name in `MANAGER_ACCESS` (סנדרה, רון, שחר, אורן, חנן, רנטה, חן).
  An optional Latin `user` field also works.
- Case and spaces are ignored, and usernames are validated unique at start-up.
- Any wrong pair gets one answer: «שם משתמש או קוד שגויים».

**Why:** Sandra, 14 Oct: «צריך גם שם משתמש».

**How:** `lib/access.js` `findUser` compares every code timing-safely first, so a failed login
takes the same time whether or not the username exists. The rate limit is unchanged. No Railway
change is needed, because the existing names are the usernames. SW v20 → v21.

**Tests:** 243 → 245 (a username + code pairing test, lib username rules; login helpers updated).

### Added — work tool, stage 2: team, shifts and therapists (October 14, 2026)

**What:** two new house tabs.
- **צוות ומשמרות:**
  - who is on shift today, grouped בוקר / ערב / לילה;
  - shifts for the next 14 days, with draft schedules marked «טיוטה»;
  - the house staff, guides and therapists, with a tap-to-call phone.
- **מטפלים:** therapists with their workdays and «בחופשה», and the weekly visit schedule by day
  (untimed visits show «ללא שעה»).
- The staff-talks form now suggests the house staff names.

**Why:** Sandra, 13 Oct: managers should see the therapists, the coordinators' schedules, the
staff list and who is on shift today.

**How:** the data comes from the coordinators app. Its ManagersHouse digest
(ezone-coordinators #270) is read by the Dashboard `managersWork` `houseData` → `team`
(E-Zone-Dashboard #224). The managers server is unchanged: no new endpoint, env var or secret.
Every value is escaped. Phones become `tel:` links only when they are a valid Israeli number.
Not connected, unreadable or stale data shows an honest message, never an empty list.
SW v19 → v20.

**Tests:** 237 → 243 (+6 in `test/work-view.test.js`). Also checked at 390 px in Chromium.

### Added — work tool, stage 1: personal-code login + house work tabs (October 13, 2026)

**What** (Sandra, 13 Oct 2026 — "not only bonuses: a work tool, like the
coordinators have"):
- **Personal-code login** replaces the open app. A house manager sees only
  their own house; admins (Sandra, Ron) see all. Server-side enforcement:
  `lib/access.js` (codes from `MANAGER_ACCESS`, signed 30-day session cookie
  keyed from `MANAGERS_WORK_SECRET`, code fingerprint re-checked on every
  request), `server.js` (`/api/login`, `/api/logout`, `/api/me`; every data
  route needs the session; manager feeds filtered to their house;
  `managersHouse` of another house → 403; login rate limit 10 / 15 min).
  Fail-closed start-up without both variables. `docs/open-access.md` →
  `docs/access.md`.
- **House sub-tabs**: בונוסים (the bonus page, unchanged) · מטופלים (patients
  in the house, outpatients who came from it, intake visits and admissions
  this month) · שיחות משפחה (patient, contact, relation, date/time, short
  description) · שיחות עם עובדים (private: the author + admins) · אירועים
  חריגים (date/time, patient, what happened, what was done).
- **Follow-up reminders**: any entry can get a follow-up date; due ones show
  at the top of the house page with «בוצע».
- Data: `/api/work` (JSON only) → Dashboard `managersWork` (E-Zone-Dashboard
  PR, own `MANAGERS_WORK_SECRET`). New `public/auth.js`, `public/work.js`
  (pure `WorkView` builders, every value escaped).

**Setup**: two Railway variables + one Script Property — see
`docs/access.md`. Without them the new deployment does not start and the
previous one keeps serving.

**Tests**: 235 → 237 top-level tests, all green (the access suite is one test with 15 sub-tests, rewritten for the login model; work-view
builders; UI guards). SW cache v18 → v19.

### Changed — the 300 ₪ continued-treatment bonus is ONE-TIME per patient (October 13, 2026)

**What** (Sandra, 13 Oct 2026): «בונוס המשך טיפול» pays **300 ₪ once per
patient**, in the month the patient **starts** a day package (two days a
week or daily) — not every month they stay in it. Corrected in the Oct 2026
rule set before October was settled (`referral: { oneTime: true, amount: 300 }`).
- Counts come from the Dashboard feed's new `referralStarts.count` (patients
  whose FIRST day package began that month; renewals and switches never
  count again) — E-Zone-Dashboard PR #221. Until it is deployed the bonus
  shows 0.
- House page wording: «300 ₪ חד-פעמי לכל מטופל» · «…התחיל אצלנו טיפול יום…
  תשלום אחד, בחודש שבו התחיל» · «N מטופלים התחילו טיפול יום ב<חודש>».
- `continuityAmount(counts, eligible, ym)` reads `counts.starts` for a
  one-time rule; `referralCounts_` in `app.js` merges `bonus.continuity` and
  `referralStarts`.

**Tests**: 234 → 235 (a patient still in a package the next month pays
nothing). Mutation: paying monthly package counts instead of starts fails 9
tests. SW cache v17 → v18.

### Changed — house page simplified; two-step bonus from October 2026 (October 13, 2026)

**What** (Sandra, 13 Oct 2026 — "make it simple"):
- **Rules from Oct 2026** (the Oct 2026 rule set, before October was
  settled): two steps per house — **first bonus 2,000 ₪** at the lowered
  quota (Ramot 14, Ra'anana 10, Efroni 9, Rehab 9, Pardes 7) and **full
  occupancy** (the house capacity: 20 / 14 / 13 / 13 / 13) at **3,000 ₪ in
  total** (+1,000). The 2,500 middle tier is gone. Up to Sep 2026 nothing
  changes.
- **No quarterly bonus** from the Aug–Oct 2026 window on
  (`quarterlyEnabled(ym)`, rule-set flag `quarterly`); May–Jul 2026 still
  paid.
- **"Secured" is now exact**: a step counts as secured only once the days
  already counted reach `max(gate, patients × days-in-month)` — the month's
  average can then no longer fall below it (e.g. Ramot's first bonus in
  October needs 14 × 31 = 434 days, not 420). The house tab's target bar uses
  the same figure.
- **House page redesign** (house tabs only; the overview is unchanged):
  - right under the header, one card **«הבונוסים החודש»** with a coloured
    block per bonus — what it pays, **«תנאי:»** in plain words, **«מצב:»**
    with the real figures now (e.g. «עכשיו: 161 ימי טיפול מתוך 434 · ממוצע
    12.4 מטופלים ליום» + «נשארו 18 ימים — צריך בממוצע 15.2 מטופלים ליום»),
    and a status chip (הושג / בקצב הנכון / צריך להאיץ / לא החודש / ממתין);
    no bare «0 ₪» on a bonus not yet earned;
  - **full occupancy appears only when still mathematically reachable** this
    month (or earned);
  - the intake-meeting block states that "7th" means the **7th patient
    hospitalised in the house**, not the 7th meeting;
  - removed: the «לבונוס הבא» card, «מדרגות בונוס חודשי», the quarterly
    block, the month split under the bonus KPI and the hero's running-month
    line;
  - **«היסטוריית תפוסה»** and the monthly-occupancy card moved to the end.
- A house tab opened before the overview loaded (a direct `#ramot` link) is
  redrawn once the overview lands, so its header shows last month instead of
  «הנתונים לא זמינים».
- New: `BonusView.bonusPlanView` (pure; a finished month's verdict is the
  official `monthlyBonusAmount`), `renderBonusPlan_` (every string escaped).
  Removed dead code: `renderNextTierCard`, `renderTierTrack`,
  `renderQuarterlyTrack`, `renderBreakdown`, `renderMonthSplit_`,
  `tierCfgFor_`, `quarterMonthsText_`, `fmtMonthLabel`.

**Tests**: 233 → 234; house-page tests rewritten for the plan; running-month
snapshot regenerated on purpose (the page changed). SW cache v16 → v17.

### Added — intake-meeting bonus, 250 ₪ per meeting, from October 2026 (October 13, 2026)

**What** (Sandra's decision, 13 Oct 2026):
- **250 ₪ per intake meeting** («פגישה לקליטה») the house manager held
  (`Leads.meetingWith`) that closed into an admission of **30+ days**, when
  the patient was the admitted house's **7th patient or later**.
- Counted in the month of **admission**. `confirmed` meetings are paid;
  `pending` ones (patient still in the house, under 30 days) are shown —
  «N ממתינות להשלמת 30 יום» — but not paid until they confirm, so a finished
  month's amount can still grow.
- Credited to the manager who held the meeting, even when the patient went
  to another house (attribution is done by the Dashboard feed).
- Independent of the occupancy bonus; **not** part of the quarterly 5,000 ₪
  check. None before Oct 2026.
- Lives in the Oct 2026 rule set (`intakeMeeting: { amount: 250 }` in
  `RULE_SETS`) — added before any month of that set was settled. New:
  `intakeMeetingAmount(feed, ym)`, `intakeEnabled(ym)`, `intakeRuleFor(ym)`,
  kill switch `INTAKE_BONUS_KILL_SWITCH`.
- UI: a «בונוס פגישות קליטה (מהמטופל ה-7)» breakdown line
  (`N פגישות שנסגרו לקליטה × 250 ₪ · M ממתינות להשלמת 30 יום`), the card
  lines, the settled money KPI and the winners banner (an intake-only
  manager is a winner). Only counts are read — no patient name from the feed
  is rendered.

**Data**: the Dashboard's `managersOverview` / `managersHouse` field
`intakeMeetings { confirmed, pending, items }` — E-Zone-Dashboard PR #219
(`CHANGELOG-intake-meeting-bonus-feed.md` there). Until that is deployed the
field is absent and the line shows 0 ₪.

**Tests**: 224 → 233. September 2026 still renders byte-identically
(snapshot unchanged). SW cache v15 → v16.

### Changed — lower first bonus tier + outpatient day-package bonus, from October 2026 (October 13, 2026)

**What** (Sandra's decision, 13 Oct 2026; effective for **October 2026 and
every later month** — nothing earlier changes):
- **Lower first tier** (tier 1 = 2,000 ₪; the treatment-days gate is the
  first tier × 30):

  | House | Up to Sep 2026 | From Oct 2026 |
  |---|---|---|
  | רמות השבים (`ramot`) | 17 → gate 510 | **14 → gate 420** |
  | קיסריה עפרוני (`efroni`) | 10 → gate 300 | **9 → gate 270** |
  | קיסריה ריהאב (`rehab`) | 10 → gate 300 | **9 → gate 270** |
  | רעננה הפרדס (`pardes`) | 10 → gate 300 | **7 → gate 210** |
  | רעננה אשר (`raanana`) | 10 → gate 300 | 10 → gate 300 (unchanged) |

  Tiers 2 and 3 (2,500 / 3,000 ₪) and their patient counts are unchanged.
- **Outpatient day-package bonus** («בונוס הפניות להמשך טיפול»): 300 ₪ per
  outpatient from the manager's house in a day package (`day_2x` or
  `day_daily`) per month. `maintenance` pays 0. Paid whether or not the house
  earned its occupancy bonus. It does **not** count toward the quarterly
  5,000 ₪ check (still occupancy amount ≥ 2,000 in each month).
- **Month-aware rules**: `lib/bonus-eligibility.js` now holds `RULE_SETS`
  (from 2026-05: the original rules, no referral bonus; from 2026-10: the new
  rules). Every calculation uses the rule set of the month it evaluates (the
  house object's `ym`, then `month`), so August / September results and the
  Aug–Oct quarterly marks for August and September are exactly as before.
  `HOUSE_BONUS` = the current rule set. New exports: `RULE_SETS`,
  `ruleSetFor`, `rulesFor`, `monthOf`, `referralRuleFor`.
- `CONTINUITY_BONUS_ENABLED` / `CONTINUITY_RATES` are replaced by the
  month-aware referral rule plus one kill switch,
  `REFERRAL_BONUS_KILL_SWITCH` (false; true forces the referral bonus to 0
  and hides its line in every month). `continuityAmount(counts, eligible,
  ym)` now takes the month and also returns `payableCount` / `unitRate`.
- UI: every threshold and gate comes from the displayed month's rules
  (cards, hero, tier track, days bar, occupancy history). The referral line
  reads `N מטופלים בחבילה יומית × 300 ₪`; the settled money KPI, the winners
  banner (a referral-only manager is a winner), settled cards and the house
  tab add the referral bonus; the running month shows it under
  `(בתהליך)`. `HOUSE_LABELS` threshold fallbacks = the new values.

**Why**: Sandra wants the managers to reach their bonuses, and to reward
referring discharged patients to outpatient day packages.

**Data source**: referral counts come from the dashboard Apps Script's
"Outpatients" sheet (`house_of_origin`, `therapy_type`, `start_date`,
`end_date`); a row that overlaps the month counts as a full month. No backend
change, no new endpoint.

**Tests**: 197 → 224. September 2026 renders byte-identically (the
running-month golden snapshot is unchanged). The three render tests that
switched the old referral bonus on for July / September now assert that
those months pay no referral bonus; the old-rule library tests are pinned to
September 2026. SW cache v14 → v15.

### Added — autonomous-work rules in CLAUDE.md + `GET /api/version` (October 8, 2026)

**What**:
- `CLAUDE.md` rewritten for autonomous Claude Code work: a "Repo facts"
  table (deployed branch `main`, production URL unknown, no Apps Script
  deploy in this repo, `npm test`, `/api/version`), and rules for language,
  per-change checklist, git, self-merge on green CI, post-merge deploy
  verification, and the final report.
- `GET /api/version` — public, `Cache-Control: no-store`, returns only
  `{commit, builtAt}`. `commit` is `RAILWAY_GIT_COMMIT_SHA` (a Railway-provided
  variable; no new variable to set) when it is a hex SHA, else `"unknown"`;
  `builtAt` is the process start time.
- `package-lock.json`: `npm audit fix` — proxy-addr 2.0.7 → 2.0.8 (critical
  GHSA-jqcg-44mw-7w3h), body-parser 1.20.5 → 1.20.8. One moderate `qs`
  advisory remains (pinned by express 4.22.1); 0 high / 0 critical.

**Why**: lets Claude verify that a merge actually reached production, and
records the repo's rules for unattended sessions.

**Tests**: 192 → 197 (`test/version.test.js`). Nothing under `public/`
changed, so the SW cache stays v14.

### Changed — referral bonus switched off (October 1, 2026)

**What**: Referral bonus disabled by decision (1 Oct 2026); switch: CONTINUITY_BONUS_ENABLED in lib/bonus-eligibility.js. Managers get occupancy bonuses only.
- No total includes referrals, in the running month or in finished months:
  KPIs, breakdown, hero, card, overview, banner, quarterly.
- The «בונוס הפניות להמשך טיפול» line, the card's «הפניות» extra and the
  «לא כולל בונוס הפניות» note are not rendered.
- The running month no longer adds the Dashboard's referral total. No
  backend referral number reaches a total or the DOM.

**Why**: Sandra's decision.

**Kept**: the counts fetch and `continuityAmount`, so the bonus can be
switched back on.

**Tests**: 186 → 192. The 4 referral tests run with the flag on. The
running-month golden snapshot `test/fixtures/running-month.snapshot.json`
was updated deliberately; its only differences are the removed referral line
and totals without referrals. SW stays v14. Details:
`CHANGELOG-settled-month-house-data.md`.

### Fixed — a finished month's house tab shows its own admissions, discharges, names and referrals (October 1, 2026)

**What**: picking a finished month (seen on 1 Oct 2026 for September) showed
`אין נתוני כניסות / יציאות / הפניות לספטמבר 2026`, no patient names and a 0 ₪
referral line. Each opened house tab now also loads
`managersHouse&house=<key>&month=YYYY-MM` and renders that month's entries,
exits (names escaped), counts, referrals and daily chart. Loading and failure
are explicit states, never «אין נתונים». The settled referral amount is
computed locally (`BonusEligibility.continuityAmount`), and a month row
without figures is "missing" instead of `לא זכאי · 0 ₪`.

**Why**: the settled path read only the `managersOverview&month=` row, which
has no activity, chart or referral counts, and hardcoded the "no data"
strings. The dashboard's `managersHouse_` already honours `month=`. No
endpoint, env var or Apps Script change; only the open actions
(`managersOverview`, `managersHouse`, `occupancySnapshots`) are called.
Running month byte-for-byte unchanged. SW cache v13 → v14.

**Tests**: 178 → 186 (+8): 7 render tests (Sep 2026 settled view from the
payload, a tab opened mid-selection, fetch failure → error state + retry,
wrong-month payload rejected, `efroni` / `arfoni` / `pardes` keys, missing
figures ≠ 0 ₪, running-month snapshot on 1 Oct) and 1 `continuityAmount`
unit test. Two existing bonus-picker tests updated: they asserted the old
"no house request" / «אין נתוני הפניות» behaviour. Details:
`CHANGELOG-settled-month-house-data.md`.

### Added — permanent «תפוסה חודשית (סופי)» view + CSV export (September 17, 2026)

A permanent monthly-occupancy card, on the overview and on every house tab,
plus a CSV export. Frontend only; **no Apps Script change in this repo, no new
endpoint, env var or Railway variable** — the new backend action rides the
existing `/api/sheets` → `APPS_SCRIPT_URL` proxy, whose query allowlist
already passes `action`.

**Why**: the "היסטוריית תפוסה" picker (Sep 10) shows one month of one house at
a time, so comparing months across houses meant clicking through 5 houses ×
N months. This card puts the whole settled history on screen at once and lets
it leave the app as a spreadsheet.

- **New**: `public/occupancy-export.js` — a PURE module (no DOM, no network)
  holding the CSV format: UTF-8 BOM, Hebrew headers (`חודש, בית, מנהל/ת,
  ימי טיפול, ימים בחודש, ממוצע יומי, קיבולת, תפוסה %`), the manager through
  `BonusView.safeLabel`, CSV-injection neutralisation (a cell starting with
  `=`, `+`, `-`, `@`, a tab or a CR is prefixed with an apostrophe), RFC-4180
  quoting, locale-independent numbers, a missing figure written empty (never
  `0`), and ONLY those eight columns — `capturedAt`, `houseId` and anything
  the backend adds later are dropped. The download (`Blob` + `<a download>`,
  `occupancy-<from>_to_<to>.csv`) stays in `app.js` so the module keeps
  testable.
- **Overview card**: rows = **settled** months, newest first, from the May
  2026 quarterly anchor; columns = the five houses with labels from
  `HOUSE_LABELS` only; cell = `occupancyPct%` with `ממוצע יומי/קיבולת`
  beneath. Every row is labelled `<חודש> — סופי`; the running month is never a
  row and `בתהליך` / `בדרך` / `חסרים` / `צפי` never appear.
- **Every house tab**: the same card, that house's column only, rendered LAST
  (after hero, KPIs, month split, tiers, breakdown).
- **Data**: one `action=occupancySnapshots` request per page (boot — never on
  the 60-second overview refresh). The backend id **`arfoni` maps to the
  frontend key `efroni`**; an unknown house id, a malformed month, a month
  before `2026-05` and the running/future months are dropped. A missing
  month/house cell renders **`אין נתונים`** — never `0%`, never blank.
- **Fail-closed**: a fetch error, an unknown action, a non-JSON body or a
  payload without `rows` → an explicit error state
  (`שגיאה בטעינת תפוסה חודשית: …`) with a **`נסו שוב`** retry button. No
  silent fallback computation anywhere.
- **Isolation**: own state slice (`state.occupancy` / `state.loadingOccupancy`)
  — the bonus KPIs, hero, house cards and both existing month pickers are
  untouched, and all their snapshot tests stay byte-for-byte green. Feed
  values reach the DOM through `textContent` only (a static guard allows a
  single `innerHTML` write, the host reset).
- **Backend dependency**: the `occupancySnapshots` action ships in the parallel
  **E-Zone-Dashboard** PR. Merge this one only AFTER that deploy; until then
  the card shows its error state and nothing else is affected.
- SW cache **v12 → v13** (`/occupancy-export.js` added to the shell).
  Docs: `docs/occupancy-history-view.md` → "Monthly occupancy (permanent)",
  `README.md`, the Managers section of `EZONE-ECOSYSTEM-STATUS.md`.

Tests 148 → **178** (+30): `test/occupancy-view.test.js` (18 — table model,
`arfoni` mapping, missing cell, newest-first, no running month, loading /
error / retry, empty payload, CSV export end to end, no bonus state written,
`textContent`-only guard) and `test/occupancy-export.test.js` (11 — BOM,
header order, injection, quotes, `safeLabel`, only the documented columns,
file name, purity), plus one `test/sheets-proxy.test.js` case proving
`occupancySnapshots` goes through the same proxy path as `managersOverview`.

### Changed — the app is fully open: no key, no cookie, patient names visible to everyone (September 12, 2026)

Removes the `?key=` full-view link and the server-side patient-name redaction
shipped hours earlier in the same day's PR #25. The app now has **no password,
no access key, no cookie and no login screen in any circumstance**, and the
entry/exit logs show patient names to every visitor. Owner decision; full
write-up: `docs/open-access.md`.

- **Removed**: `FULL_VIEW_KEY`, the constant-time key check, the httpOnly
  cookie and its HMAC token, the `?key=` → 302 redirect, and the key-check
  rate limiter. `lib/auth.js` and `lib/redact.js` are deleted outright, along
  with `test/auth.test.js` and `test/redact.test.js`. A `?key=` in a URL is
  now an ordinary ignored query param — 200, no cookie, no redirect — and a
  leftover cookie from the key era changes nothing.
- **Removed**: the `nameHidden` flag and the `מוסתר` label with its CSS. Names
  render normally everywhere, newest first, with their dates; a row with no
  name still falls back to `—`.
- **Kept** from PR #25, deliberately and test-guarded: the per-IP rate limit
  on `/api/sheets` (300 / 15 min — now the *only* thing stopping an open proxy
  from draining the shared Apps Script quota, which would take Dashboard,
  Managers and Therapists down together), every security header including
  `X-Robots-Tag: noindex, nofollow`, `robots.txt` with `Disallow: /`, the
  suppressed `err.message` on 502 (a `fetch` URL-parse failure would return
  `APPS_SCRIPT_URL` verbatim), and **`escapeHtml_` on the patient name before
  `innerHTML`** — an XSS fix, independent of who may see the name.
- **Startup** now requires only `APPS_SCRIPT_URL` (still fail-closed).
  `FULL_VIEW_KEY`, `APP_PIN`, `SESSION_SECRET` and `SESSION_DAYS` are all
  unused and can be deleted from Railway.
- **Apps Script unchanged**, as throughout: the managers endpoints never
  authenticated a caller.

Tests 169 → **148** (`test/auth.test.js` and `test/redact.test.js` removed
with the code they covered; `test/access.test.js` rewritten as an open-app
suite — every route with no credential, names present, no cookie ever set,
rate limit, headers, robots, no Apps Script URL in any response).
SW cache v11 → **v12**.

### Changed — the app is open; patient names moved behind a private link (September 12, 2026)

Removes the shared-PIN login for viewers and replaces it with an open app
whose anonymous view carries **no patient-identifying data**, plus a private
`?key=` link that unlocks the full view. Full write-up:
`docs/open-access-and-full-view-key.md`.

**Why.** The PIN was one shared code for everyone; its token carried no
identity and every holder saw all five houses, so it was friction rather than
access control. It could not just be deleted, because
`managersHouse.activity[]` carries **patient names** (`name` comes from the
Patients sheet via the dashboard Apps Script's `readPatientsForBonus_`),
paired with admission/discharge dates and house — and the overview prefetches
all five houses on every load, so those names reached the browser even
without opening a house tab.

- **No login screen anywhere**, in either mode. `POST /api/login`, the overlay
  markup, its CSS and every client-side token code path are gone. A visitor
  arriving with an old PIN-era `localStorage` token gets the app normally; the
  stale token is cleared on boot.
- **Anonymous view**: `lib/redact.js` strips every patient name from the
  upstream payload server-side and flags the row `nameHidden`. Counts, dates
  and kinds stay. Two independent rules (activity-row *shape*, and any array
  under an `activity` key) so a backend rename cannot silently unredact. An
  upstream body that will not parse as JSON is refused with `502` rather than
  passed through — it cannot be proven name-free.
- **UI**: a redacted row keeps its date and renders the Hebrew label
  **`מוסתר`** (muted italic) in the name slot — *not* a hidden card, which
  would lose the dates, and *not* the existing `—`, which already means "the
  sheet had no name". Patient names are now HTML-escaped before reaching
  `innerHTML` (they were interpolated raw).
- **Full view**: `https://<host>/?key=<FULL_VIEW_KEY>` → constant-time key
  check → **httpOnly** cookie holding an HMAC token **keyed by
  `FULL_VIEW_KEY`** → `302` to the same path without `?key=`, so the secret
  does not linger in history or a screenshot. Rotating `FULL_VIEW_KEY`
  invalidates every cookie already handed out. A wrong key, a rate-limited
  check and an unknown path are the **same bare 404** — nothing hints a key
  exists. A stale or forged cookie degrades silently to the anonymous view.
- **Rate limiting**, per IP: `/api/sheets` 300 / 15 min (new — the old limiter
  only covered `/api/login`, so without it the now-open proxy could drain the
  Apps Script quota) and the key check 10 / 15 min.
- **Security headers** on every response, where there were none:
  `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (also stops a
  `?key=` link leaking through `Referer`), a CSP and HSTS in production. Since
  the CSP is `script-src 'self'`, the service-worker registration moved out of
  `index.html` into `public/sw-register.js`.
- **`public/robots.txt`** with `Disallow: /`.
- **`err.message` is no longer echoed on 502**: a `fetch` URL-parse failure
  reads `Failed to parse URL from <APPS_SCRIPT_URL>` and would have handed the
  Apps Script URL to any caller. Logged server-side, not returned.
- **Env vars**: `FULL_VIEW_KEY` is new and required (≥32 chars, fail-closed at
  startup alongside `APPS_SCRIPT_URL`). `APP_PIN` and `SESSION_SECRET` are now
  unused and can be deleted from Railway. `SESSION_DAYS` still sets the cookie
  lifetime.
- **Apps Script unchanged.** The managers endpoints never authenticated a
  caller — the proxy forwards only `action` / `house` / `month`, no secret and
  no token — so there was no session token to mint silently.

Tests 136 → **169** (`test/redact.test.js` and `test/access.test.js` are new;
`test/server-auth.test.js` removed, its coverage folded into `access`).
SW cache v10 → **v11**.

### Added — CLAUDE.md standing rules for Code sessions (September 10, 2026)

Docs only. `CLAUDE.md` at the repo root records the working rules every
Claude Code session must follow: read `EZONE-ECOSYSTEM-STATUS.md` and
`docs/` first; verify the Railway-deployed branch is `main`; read-only
investigation first; fresh branch off `main`, one PR at a time targeting
`main`, never push to `main`, never merge; explicit-path `git add` and a
diff review before every commit; every PR carries a CHANGELOG entry, tests
(`node --test`), docs updates and a SW cache bump when `public/` changes;
no new endpoints or secrets without approval and no Apps Script changes;
no PR subscriptions or check-ins after opening a PR; bonus math only in
`lib/bonus-eligibility.js`, bonus wording only in `public/bonus-view.js`,
backend bonus fields ignored. No code changes, no SW bump (nothing under
`public/` changed), tests unchanged at 136.

### Added — bonus history: month picker on the overview and every house tab (September 10, 2026)

Frontend only (`public/`), no Apps Script / server / endpoint changes. Full
write-up: `docs/bonus-month-labelling.md` → "Bonus history month picker".

- **"חודש בונוס" picker** at the top of the overview and of every house tab,
  listing the running month (default, `ספטמבר 2026 — חודש נוכחי (בתהליך)`)
  and **every finished month back to May 2026** (the quarterly anchor) as
  `יולי 2026 — סופי` — no lookback cap. A `חזרה לחודש נוכחי` link appears
  while a finished month is selected. The selection is shared: picking a
  month on the overview shows it on every opened house tab and vice versa.
- **A finished month renders SETTLED everywhere**, through the existing
  `BonusView.settledMonthView`: overview KPIs (`בתים זכאים לבונוס`, `ממוצע
  מטופלים/יום`, `בונוס יולי 2026 — סופי (לתשלום)`, `ימים בחודש 31 מתוך 31` —
  days-so-far of a finished month = the full month), winners banner, network
  chart (month average), house cards (one settled block: tier reached,
  amount, gate result, tier pill only when earned), house hero
  (`יולי 2026 — סופי: זכאי · מדרגה 2 · 2,500 ₪`), KPIs, month split,
  treatment-days bar (gate result in words), tier track, quarterly block
  and breakdown. Never `בתהליך` / `בדרך` / `חסרים` / `צפי` / `ממוצע נוכחי`;
  the next-tier ("missing for the next tier") card is hidden; entries/exits
  show `—` (a month overview carries none).
- **Quarterly block anchored to the selected month's window** (May–Jul for
  July) as it stood at the end of that month, with a per-month line
  `מאי 2026 ✓ · יוני 2026 ✗ · יולי 2026 ✓` (`(לאחר החודש שנבחר)` for months
  after the selection).
- **Data**: the existing `managersOverview&month=YYYY-MM` fetch only
  (`fetchMonthOverview_`); the selected month plus the finished months of
  its window (≤ 3 requests), cached per month in `state.bonusHistory` for
  the life of the page — re-selecting, a month of the same window and last
  month cost no request, and the cache survives the 60-second refresh.
  Fetch errors render an explicit error state (no stale figures) and are
  retried on re-select; picker values are validated against the offered
  list. The daily chart is shown when the month payload (or the
  occupancy-history cache) has one; otherwise an explicit no-data note.
- **Running month unchanged**: with no selection every render path is the
  one shipped before; the live bonus state is never written by the picker.
  Small refactors only: `tierCfgFor_` (shared tier config),
  `quarterlyLocal_(key, asOfYM)`, `settledAmountFor_` reads either cache.
- **Tests 125 → 136**: `test/bonus-view.test.js` (+3: `monthsBetween`,
  `shortTitle` / `gateText`, `houseHeroView({ selected })`);
  `test/app-render.test.js` (+8: picker months on both surfaces; a picked
  month renders settled on overview + tab with a forbidden-word sweep over
  the whole rendered page; a month without a tier; running month
  byte-for-byte unchanged after picking and returning, also across a
  refresh; in-memory cache reuse; error state / retry / invalid values;
  occupancy picker independence; template / SW guards).
- SW cache bumped `v9` → `v10`. Docs: `docs/bonus-month-labelling.md`,
  README, `EZONE-ECOSYSTEM-STATUS.md` Managers section.

### Added — occupancy history: month picker on the house-detail tab (September 10, 2026)

Frontend only (`public/`), no Apps Script / server / endpoint changes. Full
write-up: `docs/occupancy-history-view.md`.

- **"היסטוריית תפוסה" card at the top of every house tab** with a month
  picker (current month back to the May 2026 quarterly anchor, growing to a
  12-month lookback). Picking a past month renders that month's daily
  occupancy chart, `ימי טיפול — <חודש>: 441 / 510`, the daily average and the
  settled status line — always titled `(סופי)`, never `בתהליך`. The current
  month keeps the card to the picker alone (the live blocks below show it).
- **Data**: `managersOverview&month=YYYY-MM` via a new shared
  `fetchMonthOverview_` helper (`loadOverview` now uses the same helper for
  the quarter-window months — the per-month fetch exists once). The daily
  chart comes from that payload when present, else from one
  `managersHouse&house=…&month=…` attempt accepted **only** when its `month`
  matches; otherwise an explicit "no daily data" note. Fetch errors render
  an explicit error state (no blank/stale figures) and are retried on
  re-select. Picker values are validated (`YYYY-MM`) before use.
- **Bonus figures are unaffected by the picker**: the history code has its
  own state (`historyMonth` / `historyByMonth` / `loadingHistory`), never
  writes the bonus slices, and renders last in `renderHouseDetail`.
- **Tests 117 → 125** (`test/app-render.test.js`): picker defaults/range/
  wiring; past-month render is settled and chart-based; a byte-for-byte
  snapshot of every bonus string (hero, KPIs, month split, chart card, tiers,
  breakdown, overview card) plus bonus state is unchanged after selecting,
  re-rendering and switching back; wrong-month chart rejected; right-month
  chart accepted; already-loaded month reused without a request; fetch error
  state; invalid values never fetch; template/static guards.
- SW cache bumped `v8` → `v9`. Docs: `docs/occupancy-history-view.md`
  (new), README, `EZONE-ECOSYSTEM-STATUS.md` Managers section.

### Fixed — overview cards use the chart-based days-so-far on first load (September 8, 2026)

Follow-up to PR #19. Frontend only, no backend changes.

- **Overview cards no longer show the capped feed figure** (e.g. Ramot
  160/510) while the detail tab shows the chart-based number (102/510).
  `loadOverview` now fetches every house's daily chart **once per month**
  (in parallel with the finished-month overviews) and caches it in
  `state.chartsByMonth[YYYY-MM][houseKey]`; the 60-second refresh reuses the
  cache and makes no chart requests. Older months are dropped from the cache
  on month change; a failed chart fetch leaves the house uncached so the next
  refresh retries it (the card falls back to the capped feed figure until
  then).
- **Card = detail tab by construction**: `cacheHouseDetail_` writes the same
  house-detail payload to `state.details` (what the tab renders) and to the
  per-month chart cache (what the cards read via `daysSoFarOf_`). Opening a
  tab writes through the same cache.
- Tests 113 → 117 (`test/app-render.test.js`): overview card = detail tab
  KPI/bar for the fixture month; a cached chart for another month is never
  used; `loadOverview` against a stubbed feed makes one chart request per
  house and zero on refresh, with every card chart-based; a failed chart
  fetch is retried on the next refresh without refetching the others.
- SW cache bumped `v7` → `v8`. Docs: `docs/bonus-month-labelling.md`.

### Fixed — bonus month labelling: settled vs running month, single days-so-far, stray "2500" (September 8, 2026)

Frontend only (`public/`), no Apps Script / server / endpoint changes. Full
write-up: `docs/bonus-month-labelling.md`.

- **Every bonus figure now names its month, in two separated blocks** —
  `בונוס אוגוסט 2026 — סופי (לתשלום)` (final state only: `זכאי · מדרגה X · Y ₪`
  or `לא זכאי · המכסה לא הושלמה (441/510)`) and
  `ספטמבר 2026 — חודש נוכחי (בתהליך)` (actual days-so-far from the 1st, e.g.
  `102/510 ימי טיפול`, plus a separately labelled `צפי לסוף החודש`
  projection). A settled month never says `בדרך` / `בתהליך` / `חסרים`.
- **Hero banners lead with the settled previous month** — overview: winners
  chips or `אוגוסט 2026: אף בית לא עמד בסף`; house page: that house's final
  August result. Running-month progress moved to a secondary line that always
  carries the month name and `בתהליך`. KPI labels name their month too.
- **Stray "2500" under the manager name removed.** The card rendered the
  feed's `type` field verbatim; the house type now comes from the hardcoded
  roster only, and feed manager/name strings pass through
  `BonusView.safeLabel` (numeric/amount-like values are dropped).
- **Tier badges** — a tier is shown as achieved only when settled-and-met or
  locked in. Mid-month the card, hero, tier track, next-tier card and
  breakdown show `מדרגה הבאה: 1 (17 מטופלים/יום) · ממוצע נוכחי 12.8` instead
  of `בדרך למדרגה 3`. The tier track no longer lights stops from
  `patientsNow`.
- **One days-so-far figure** — `BonusView.daysSoFar` (daily chart summed to
  today; else the feed figure capped at elapsed × capacity) is computed once
  per render in `monthlyStatus` and reused by the KPI, hero, progress bar and
  house card. Previously the hero used the front-dated feed value (366) while
  the KPI summed the chart (102). Opening a house tab re-renders the overview
  so its card shares the detail's figure.
- New pure module **`public/bonus-view.js`** (labelling / wording / days
  so far; UMD, Node-testable). `app.js` reads the clock only through
  `now_()` (`state.now` override for tests); date keys are local, not UTC.
- Removed dead helpers `monthlyBonusOf`, `totalBonusOf`, `securedTierTarget`,
  `monthlyTargetOf`.
- **Tests: 79 → 113.** New `test/bonus-view.test.js` (22) and
  `test/app-render.test.js` (12 — real `app.js` rendered in a `vm` sandbox
  with a minimal fake DOM: no backend bonus figure reaches the DOM, settled
  wording sweep, actual vs projection, KPI = hero = bar = card, tier badge
  rules, script order / SW shell guards).
- SW cache bumped `v6` → `v7`; `/bonus-view.js` added to the shell.
- Docs: `docs/bonus-month-labelling.md` (new), README tests section,
  `EZONE-ECOSYSTEM-STATUS.md` Managers section.

### Added — hardened `@claude` workflow: owner-only trigger, minimal permissions

`.github/workflows/claude.yml` — the `@claude` agent on issues and pull
requests, copied byte-for-byte from `ezone-helpdesk` with no adaptation.

- **Owner-only trigger** — the job's `if:` gates on
  `github.actor == 'sandrabrayer'`, `&&`-ed *in front of* the `@claude`
  mention checks, so no other account can start a run. E-ZONE staff reach
  the helpdesk through its own intake, never through GitHub. A non-owner
  `@claude` mention produces no run at all — that is the intended outcome,
  not a bug; do not "fix" it by loosening the `if:`.
- **Minimal permissions**, declared once at workflow level and nothing more:
  `contents: write`, `pull-requests: write`, `issues: write`,
  `id-token: write`, `actions: read`.
- **Cost cap** — `claude_args: '--max-turns 15'`, so a runaway conversation
  stops on its own.
- **Secret** — referenced only as `${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`,
  which is already set on this repo. No value is hard-coded and no other
  secret is named in the file.

Workflow file only — no application code, no frontend asset (no SW bump), no
new dependencies, no new env vars. The full contract and the rationale live in
`ezone-helpdesk`: `docs/github-actions.md`.

### Changed — ecosystem status doc: five-house roster + current managers (September 5, 2026)
- **`EZONE-ECOSYSTEM-STATUS.md` now carries a "Managers: house roster" section**
  listing all FIVE houses with their current managers — רעננה אשר שחר, רמות
  השבים אורן, קיסריה עפרוני חנן, קיסריה ריהאב רנטה, רעננה הפרדס חן — plus
  type, eligibility threshold and capacity, the pardes addition note, the
  manager-rename history and the `arfoni`/`efroni` id note. The bonus-model
  line now reads "Efroni, Rehab & Pardes 10/12/13". Header date annotated.
- **New `test/ecosystem-status-doc.test.js` guard** — asserts the doc roster
  covers exactly `HOUSE_KEYS`, that every house name and manager matches
  `HOUSE_LABELS` in `public/app.js` verbatim, and that the five expected
  manager names are present. No code or UI change.

### Changed — Ramot manager rename + amber E-ZONE header emblem (August 25, 2026)
- **רמות השבים (ramot) manager updated: שחר → אורן** (`HOUSE_LABELS` in
  `public/app.js`; the live feed's `manager` field, when present, still takes
  precedence). Ra'anana's manager is a different שחר and is unchanged. The
  manager-name guard in `test/house-coverage.test.js` now asserts all three
  hardcoded names (raanana שחר, ramot אורן, pardes חן).
- **Header emblem swapped to the amber E-ZONE mark** used by ezone-coordinators
  (part of the header branding rollout): the top-bar `.brand-emblem` now loads
  the new `public/icons/ezone-emblem-192.png` (copied verbatim from
  ezone-coordinators' `icon-v2-192.png` — amber #ffb020 glyph on warm dark
  #140d03, rounded-square mask) instead of the app's own `icon-192.png`. Only
  the header emblem changes — this app's color scheme, PWA icons, favicon and
  manifest are untouched.
- SW cache bumped `v5` → `v6` so the updated shell reaches installed devices
  on next open.

### Added — new house רעננה הפרדס (pardes) + Ra'anana manager change (August 24, 2026)
- **New fifth house `pardes` (רעננה הפרדס, manager חן, תחלואה כפולה)** added to
  every house enumeration: `HOUSE_KEYS` / `HOUSE_LABELS` in `public/app.js`,
  the per-house bonus config `HOUSE_BONUS` in `lib/bonus-eligibility.js`, and
  the tab + detail panel in `public/index.html`. Its bonus parameters are an
  exact copy of Efroni's (threshold 10, capacity 13, tiers 10→2,000 /
  12→2,500 / 13+→3,000 ₪, treatment-days gate 10×30=300) — per decision.
  The house id `pardes` matches the canonical id already live in
  ezone-coordinators and ezone-staffing.
- **רעננה אשר (raanana) manager updated: עידו → שחר** (`HOUSE_LABELS`; the
  live feed's `manager` field, when present, still takes precedence).
- 4-house assumptions made count-agnostic: the "houses above eligibility" KPI
  fallback denominator now uses `HOUSE_KEYS.length`, a fifth skeleton card was
  added, and the README no longer says "all 4 houses".
- **New `test/house-coverage.test.js` guard suite** — asserts every house
  enumeration (labels, bonus config, tabs, panels) covers exactly
  `HOUSE_KEYS`, that pardes' bonus config equals Efroni's, and the manager
  rename landed. Existing per-house test loops extended to pardes.
- SW cache bumped `v4` → `v5` so the updated shell (new tab/panel) reaches
  installed devices on next open.
- NOTE: the shared dashboard Apps Script must also return `pardes` in
  `managersOverview` / `managersHouse` for live data to appear — that backend
  lives outside this repo (see the PR description for post-merge steps).

### Fixed — top monthly bonus tier corrected to 3,000 ₪ (August 10, 2026)
- **The highest monthly bonus tier is 3,000 ₪, not 3,500 ₪.** The correct
  monthly tiers are 0 / 2,000 / 2,500 / **3,000** ₪ for every house. The tier
  amount had been encoded as 3,500 ₪ in `lib/bonus-eligibility.js` (Ramot 20,
  Ra'anana 14, Efroni 13, Rehab 13) and asserted as such by the test suite —
  both are now corrected. Tier *thresholds* (patient counts) and the fixed
  treatment-days gate (threshold × 30) are unchanged.
- The **quarterly stability bonus (5,000 ₪) is unaffected** — its logic and
  the ≥ 2,000 ₪ monthly-qualification bar are unchanged.
- Tests updated accordingly; the full suite passes.

### Added — CI + fully-mocked proxy tests (August 10, 2026)
- **GitHub Actions workflow `.github/workflows/test.yml`** — runs `npm ci` +
  `npm test` (`node --test`) on every pull request and every push to `main`,
  across Node 18.x / 20.x / 22.x. No secrets are configured or needed: test
  files set `NODE_ENV=test` with dummy env values.
- **New `test/sheets-proxy.test.js` (6 tests)** — the `/api/sheets` proxy is
  exercised against a MOCKED `global.fetch` (zero real network I/O): upstream
  JSON passthrough + `Cache-Control: no-store`, query-param allowlist
  (`action`/`house`/`month` forwarded, everything else dropped), upstream
  non-200 passthrough, upstream failure → 502 `upstream_error`, upstream never
  reached without a valid token, unknown `/api/*` → 404 JSON (not the SPA
  shell).
- **`test/server-auth.test.js` no longer touches the network** — the
  correct-PIN gate test previously fetched `https://example.invalid` (a
  guaranteed-unresolvable but still real DNS lookup); upstream fetch is now
  mocked in-process. Suite: 67 passing.

### Changed — top bar shows emblem + app name only (July 27, 2026)
- **Dropped the "איזון" (E-ZONE) wordmark from the top bar.** The header now
  reads as the app's own emblem + its Hebrew name — the app icon followed by
  **מנהלים** — instead of the network wordmark plus a dim sub-label.
- **Added the existing app emblem** (`/icons/icon-192.png`, straight from
  `manifest.json`) beside the name at **30px desktop / 28px mobile**. No
  recolor and no new icon set — the current gradient mark and palette are
  untouched; the name uses the existing `--text` color. RTL-correct,
  `white-space: nowrap`, and it does not crowd the tab nav below.
- SW cache bumped `v3` → `v4` so the updated shell reaches installed devices
  on next open.
- `test/ui-guards.test.js`: new header guards (E-ZONE wordmark gone, emblem
  `src` is a real manifest icon, name present, 30/28px sizing, no-wrap) and
  the SW-version guard tightened to ≥ v4.

### Fixed — login overlay never dismissed (July 5, 2026)
- **`.login-overlay[hidden] { display: none; }` added.** The overlay's base
  rule sets `display: flex`, which overrides the browser's built-in
  `[hidden] { display: none }` — so after a SUCCESSFUL login the overlay
  stayed on screen forever (data loaded behind the blur). Symptom: pressing
  כניסה appeared to do nothing.
- SW cache bumped `v2` → `v3` so the fixed stylesheet reaches installed
  devices on next open.
- New `test/ui-guards.test.js` (3 tests): the `[hidden]` CSS rule exists,
  the overlay markup/JS contract holds, SW cache is ≥ v3. Suite: 58 passing.

### Security — auth brought to the ezone-staffing standard (July 5, 2026)

### Fixed (post-deploy hotfix, July 5, 2026)
- **Service worker cache bumped `v1` → `v2`** — the auth PR changed
  index.html/app.js/styles.css but not the cache name, so installed clients
  could serve a stale pre-auth shell (stale-while-revalidate). Bumping forces
  a clean shell on next load.
- **`trust proxy` enabled** — behind Railway, `req.ip` was the proxy IP for
  every user, collapsing the per-IP login rate limit into one shared bucket
  (8 attempts/15min for ALL users combined, easy accidental lockout).

- **PIN login + HMAC session tokens now required for all data access.**
  New `lib/auth.js` (ported from ezone-staffing): HMAC-SHA256 tokens with
  `managers:` payload prefix (staffing tokens are NOT valid here),
  timing-safe PIN comparison, 7-day default expiry (`SESSION_DAYS`).
- **`GET /api/sheets` is gated by `requireAuth`** (Bearer token). `/healthz`
  and static assets remain open.
- **`POST /api/login`**: per-IP rate limiting (8 attempts / 15 min → 429),
  returns `{ token, expiresInDays }`.
- **Fail-closed startup**: production refuses to start without
  `APPS_SCRIPT_URL`, `APP_PIN`, and `SESSION_SECRET` (min 32 chars).
  ⚠️ Set `APP_PIN` (≤6 chars — input maxlength is 6) and `SESSION_SECRET`
  in Railway BEFORE merging, or the next deploy will crash-loop.
- **`lib/` is no longer statically mounted** — only
  `/lib/bonus-eligibility.js` is served explicitly; server-only
  `lib/auth.js` is unreachable over HTTP (regression-tested).
- Proxy hardening: query-param allowlist (`action`, `house`, `month`),
  `x-powered-by` disabled, JSON body limit 16kb, explicit `0.0.0.0` bind.
- Frontend: login overlay (PIN, maxlength 6, RTL-friendly), token stored in
  `localStorage`, Bearer header on every `fetchJson`, automatic re-login on
  401. Data polling starts only after auth.
- Tests: +19 (auth unit + server integration: 401 gate, login flow, rate
  limit, forged/expired/cross-app tokens, lib exposure). Suite: 55 passing.

### Docs
- **`EZONE-ECOSYSTEM-STATUS.md` added at repo root** — the July 4 merged cross-app ecosystem status doc, distributed to the root of all six E-Zone repos so every project/session starts from the true state.

### Added (winners trophy banner)
- **Trophy banner at the top of the dashboard announcing WHO earned WHAT for
  the month that finished** — "🏆 בונוסים לתשלום — <חודש>", one gold chip per
  earning house with the house name, manager name, total amount (monthly +
  quarterly 5,000 ₪ when earned), and the tier reached. Computed locally from
  the settled figures (same canonical rules); shows a friendly "no house
  qualified" line when nobody earned. XSS-safe: renders only known house
  labels, numeric amounts, and sheet-sourced manager names.


### Changed (Ra'anana tier 3 = 14 + fully local quarterly bonus)
- **Ra'anana Asher tier 3 corrected to 14 patients** (capacity), per the
  original May 2026 spec: 10 → 2,000 / 12 → 2,500 / **14 → 3,500** ₪.
  Avg 13 now pays the 2,500 tier. Efroni and Rehab stay at 10/12/13; Ramot at
  17/19/20.
- **Quarterly stability bonus is now computed locally** in
  `lib/bonus-eligibility.js` (`quarterWindowFor`, `quarterlyStatus`) — the
  backend's quarterly fields are no longer read anywhere. Windows are anchored
  at May 2026 (May–Jul, Aug–Oct, Nov–Jan, ...). A month counts when its
  SETTLED monthly bonus (canonical local rules) was ≥ 2,000 ₪; the 5,000 ₪
  pays only when all 3 months of the window are finished and all met the bar.
  First possible payout: end of July 2026 (May–Jun–Jul window).
- The overview loader now fetches every finished month of the current quarter
  window (`managersOverview&month=…`, in parallel) so both the settled
  prev-month payable and the quarterly standing come from raw data + local
  rules. Quarterly track, breakdown line, and totals all use the local figures.
- Security/robustness: month params are URL-encoded; failed month fetches
  degrade gracefully (standing shows fewer finished months, never crashes).
- Tests: 36 passing — new coverage for Ra'anana 13/13.9 → 2,500 vs 14 → 3,500,
  anchored window math (incl. year rollover Nov–Jan), and quarterly standing
  (full pay, one-month miss, mid-quarter, 1,999 boundary).


### Added (finished-month payable on the dashboard + readability)
- **Every overview house card now leads with the SETTLED bonus for the month
  that finished** ("בונוס <חודש> (לתשלום)"), computed locally on load by
  fetching last month's overview (`managersOverview&month=YYYY-MM`) and running
  the canonical rules (tier by avg occupancy + fixed threshold×30 gate) on that
  month's raw figures. Shows amount, tier, and why it wasn't earned when 0.
- **KPI "סך בונוסים החודש" replaced with "בונוסים לתשלום — <חודש קודם>"** —
  the sum of the settled previous-month bonuses across the four houses.
- **KPI "ימים שנותרו לחודש" replaced with "יום בחודש" (X מתוך Y)** — counting
  runs from the 1st; a days-left counter was confusing.

### Changed (clarity + readability)
- Current-month card line renamed to "ימי טיפול מתחילת החודש" and now shows
  days ACCRUED SO FAR against the fixed gate (never the front-dated full-month
  total, which previously displayed e.g. 342/300 on the 4th of the month).
- Gap wording clarified: "חסרים עוד X עד סוף החודש".
- Removed the misleading "חסרים X ימי טיפול ליעד" shortfall chip (front-dated
  math); the note under the bonus now carries since-the-1st progress.
- Readability pass across all tabs: `--text-mute` opacity 0.45 → 0.72; small
  note fonts raised (10→12px, 11/11.5→13px); new `.hc-prev-bonus` styles.


### Changed (fixed threshold×30 gate + finished-month payable headline)
- **Treatment-days gate is now FIXED per house: eligibility threshold × 30.**
  `lib/bonus-eligibility.js` replaces the per-tier `tierPatients × daysInMonth`
  target with `gateTarget(h) = threshold × GATE_DAYS_FACTOR (30)`. Ramot needs
  510 treatment-days, the other houses 300 — the SAME in every month (28, 30 or
  31 days) and for EVERY tier. The tier amount is still driven by average
  daily occupancy (Ramot 17/19/20, others 10/12/13 → 2,000/2,500/3,500 ₪),
  identical logic for all houses: more patients → higher tier → bigger bonus.
- **The finished month's payable bonus is now the headline.** The month-split
  box leads with "בונוס לתשלום — <month> (סופי)", styled larger (`ms-headline`),
  computed on the 1st of the following month. The in-progress month remains a
  clearly-marked projection starting at 0 ₪.
- **The frontend no longer trusts ANY backend bonus math.** The previous month's
  amount is recomputed locally from the feed's raw data (avgDaily /
  treatmentDays), and the current-month `lockedIn` / `projectedBonus` /
  `lockedAmount` flags from the Apps Script are ignored. The backend now only
  supplies raw occupancy and treatment-day figures; all bonus rules live in
  one place (`lib/bonus-eligibility.js`), eliminating the recurring
  two-systems-out-of-sync bug. (Quarterly standing fields — `quarterlyMonthsMet`
  etc. — are still read from the feed and displayed as X-of-3 progress.)
- **`securedFloor` simplified to the single fixed gate**: a tier is secured
  once days-so-far ≥ threshold × 30 AND occupancy supports the tier.
- Tests rewritten for the fixed gate (34 tests): gate boundaries 510/509 and
  300/299, month-length independence (February needs the same 510), gate does
  not grow with the tier, secured-floor boundaries. All pass via `node --test`.

### Changed (lower bonus break-even rules)
- **Treatment-days gate raised to the FULL target (no 95% discount).**
  `GATE_RATIO` in `lib/bonus-eligibility.js` is now `1.0` (was `0.95`), so a tier
  pays only when treatment-days reach 100% of the target (`tierPatients ×
  daysInMonth`). Example: Ramot tier-1 at 17 patients in a 31-day month now
  requires the full 527 treatment-days (17 × 31) to pay, where it previously
  paid at 95% (≈501). This affects all houses, both the settled
  `monthlyBonusAmount` gate and the mid-month `securedFloor` lock.
- **Ramot HaShavim eligibility lowered from 18 to 17 patients.** The house's
  `threshold` is now `17` and its bottom tier is `{ patients: 17, amount: 2000 }`
  (was `18 → 2000`). The upper steps are unchanged (`19 → 2500`, `20 → 3500`).
  `HOUSE_LABELS.ramot.threshold` in `public/app.js` is updated to `17` to match.
- **Front-end gate display drops the "95%" wording.** The payment-gate lines in
  `renderNextTierCard` no longer show `(≥95%)` / `(95% מ-…)`, and both
  `const minRequired = Math.ceil(0.95 * target)` computations in `monthlyStatus`
  are now `const minRequired = target` (full target, no discount).
- Tests in `test/bonus-eligibility.test.js` updated for threshold 17 and the
  full-target gate: Ramot eligibility boundary is now 16.9/17.0, and the gate
  boundary cases assert the exact full target (e.g. Ramot tier-1 = 17 × 31 = 527,
  pass at 527, fail at 526).

### Fixed (secured tier floor + consistent day/target display)
- **A house sitting BETWEEN two tiers now shows its SECURED floor instead of
  hiding it behind the projection.** `lib/bonus-eligibility.js` gains
  `securedFloor(h, resolveThreshold, daysInMonth, daysSoFar)`, which returns the
  HIGHEST tier already guaranteed: it walks the house tier table from the lowest
  tier up and counts a tier as secured only when occupancy ≥ that tier's patient
  count AND days-so-far ≥ 95% (`GATE_RATIO`) of `tierPatients × daysInMonth`,
  stopping at the first tier whose gate fails (higher tiers have larger targets
  and so cannot be secured either). It returns
  `{ tier, amount, tierPatients, target, minRequired }`, all 0 when nothing is
  secured. Example: Ra'anana Asher at avg 11 patients has cleared tier-1
  (threshold 10, target 300 days) with 285 accrued days (≥ 95% of 300), so it
  has SECURED the 2,000 ₪ tier-1 floor while still climbing toward tier-2
  (12 patients → 2,500 ₪). Previously the app showed only the projected tier-2
  and rendered "בתהליך / 0 ₪", hiding the guaranteed floor.
- **`monthlyStatus(h)` now locks in the secured floor.** For the current month
  it computes `securedFloor(...)` and, in BOTH the backend-feed branch and the
  local-fallback branch, marks the state `locked` whenever `floor.tier > 0`
  (even when the backend `lockedIn` flag is still false), sets the counted
  amount to the floor amount, and adds `securedTier`, `securedAmount`, and a
  `hasUpside` flag (true when the projected tier is strictly above the floor and
  pays more). `projectedTier` / `projectedAmount` continue to describe the
  next-tier upside, and `gapDays` is still measured against the full tier target.
- **Detail-panel day/target figures are now consistent and anchored.** For the
  current month the panel drives `nights` off `status.daysSoFar` instead of
  `treatmentNightsOf` (which returns the full-month front-dated count), so every
  "X / Y days" line shares one basis — fixing the panel that mixed a full-month
  count (e.g. 362) with the days-so-far count (285). The displayed `target` is
  anchored to the SECURED tier via a new `securedTierTarget(h, status)` helper
  (mapping `status.securedTier` back to its patient count through
  `BonusEligibility.HOUSE_BONUS`, × `monthDaysOf(h)`), instead of being measured
  against the projected next tier's larger target (e.g. tier-1's 300 rather than
  tier-2's 360). `renderNextTierCard`'s payment-gate line ("סף ימי הטיפול…") now
  reads its target and min-required from the status object (days-so-far basis)
  so it matches the banner and the KPIs. The locked status banner now names the
  secured tier and appends the upside ("בדרך למדרגה N") only when `hasUpside`.

### Fixed (detail-page breakdown)
- **`פירוט חישוב הבונוס` (renderBreakdown) now applies the same 80%-gate /
  tier-1 floor rule** used by the dashboard KPI, the network total, and the
  house card. Previously the per-tier rows in the detail breakdown still
  derived their amounts from the legacy pure-treatment-days tier (i.e. they
  only paid when `treatment-nights >= target`), so Ra'anana — eligible by
  snapshot fallback but with treatment-days well below 300 — showed
  "בונוס מדרגה 1 ... ₪0" even though the KPI and her card correctly showed
  ₪2,000. The breakdown's tier-1 row now pays ₪2,000 whenever the occupancy
  gate (or its snapshot fallback) is met, regardless of treatment-days; the
  tier-2 row pays ₪2,500 only when eligible AND treatment-days ≥ 360; the
  tier-3 row pays ₪3,500 only when eligible AND treatment-days ≥ 420. Tier
  thresholds in the breakdown are now read from the canonical
  `BonusEligibility.TIER{1,2,3}_DAYS` constants (300/360/420) instead of from
  the house-specific `target + tier{2,3}Threshold`, keeping the breakdown in
  lockstep with `monthlyBonusAmount`. The tier-1 status text shows the
  "חסרים M ימי טיפול ל-300" gap alongside the paid floor amount when the
  floor applies, so the informational gap stays visible.
- **Unchanged in this fix:** the quarterly stability bonus row, the
  continuity ("הפניות להמשך טיפול") row, the tier track visualization, the
  "נצברו N ימי טיפול · חסרים M למדרגה" tier-current text, and the
  eligibility badge / trophy logic.

### Changed (bonus AMOUNT calculation)
- **Monthly bonus AMOUNT is now gated by an 80% occupancy rule and uses a
  treatment-days tier table with a tier-1 floor.** The bonus payable to a
  house each month is computed as follows:
  - **Occupancy gate:** the house must have been at-or-above its BEP on
    **>= 80% of the month's days**, read from `h.bonus.aboveBepDays` divided
    by days-in-month. If the gate is not met, the monthly bonus is **0**
    regardless of accumulated treatment-days.
  - **Tier amount (when the gate is met):**
    - `>= 420` treatment-days → **3,500 ₪**
    - `>= 360` treatment-days → **2,500 ₪**
    - `>= 300` treatment-days → **2,000 ₪**
    - `<  300` treatment-days → **2,000 ₪** (tier-1 floor — paid whenever the
      occupancy gate passes, even if treatment-days haven't reached tier 1)
  - **Snapshot fallback:** when `h.bonus.aboveBepDays` is missing or 0 (i.e.,
    the backend Apps Script has not yet started reporting it), the gate falls
    back to the live snapshot (`patientsNow >= resolveBep(h)`). In that
    fallback path, the card and detail page render a small caveat
    "מבוסס על תפוסה נוכחית" so it's clear the figure isn't yet using the
    real 80%-of-month calculation.
- **Backend requirement.** For the gate to compute against real occupancy,
  the Apps Script feeding `/api/sheets?action=managersOverview` and
  `action=managersHouse` must supply `bonus.aboveBepDays` per house — the
  count of days in the current month on which active patients were >= BEP.
  Until that field is wired up, every house's bonus will be computed via the
  snapshot fallback and tagged with the "מבוסס על תפוסה נוכחית" caveat.
- The overview's "סך בונוסים החודש" KPI is now summed locally from per-house
  amounts rather than read from `totals.totalBonus`, since the backend total
  predates this rule and would understate the floor / fail to apply the gate.
- **Eligibility badge / trophy logic is unchanged.** The "✓ זכאי לבונוס" /
  "⚠ לא זכאי" badge, the trophy on the card, the houses-above KPI, and the
  network spark coloring all still come from `qualifiesMonthly` (live
  `patientsNow >= resolveBep(h)`), as fixed in the earlier Unreleased work
  below. Eligibility for the badge and the payable AMOUNT are now two
  distinct decisions: a house can be "eligible" (badge on) while the monthly
  amount is still 0 if it hasn't yet been above BEP for 80% of the month.

### Fixed
- **House cards now use the same eligibility rule as the dashboard.**
  `buildHouseCard` was deriving its trophy / "✓ זכאי לבונוס" badge from
  `tier.tier > 0` (treatment-nights tier reached) rather than from
  `qualifiesMonthly`. Mid-month, that produced cards that said "⚠ לא זכאי"
  even though `patientsNow >= bep`, contradicting the dashboard's
  houses-above KPI and the network-spark coloring. Cards now call the same
  `qualifiesMonthly(h)` (patients vs. BEP) used by the overview. The tier pill
  ("מדרגה N") is now controlled independently by `tier.tier > 0`, so it only
  appears when an actual treatment-nights tier has been reached. Bonus
  amount is rendered based on `totalBonus`, so a qualifying-but-no-bonus-yet
  mid-month state shows "0 ₪" honestly instead of a contradictory amount.
- **Dashboard: bonus eligibility now ignores the backend `qualifies` flag.**
  The overview's "qualifies for bonus" indicator (houses-above KPI and the
  network spark coloring) now always computes eligibility locally as
  `patientsNow >= resolveBep(h)` and ignores `h.bonus.qualifies` /
  `h.qualifies`. Those flags were observed to lag the live signal — Ra'anana,
  for example, was being hidden as not-eligible despite `patientsNow == 10`
  and `bonus.bep == 10` (exactly at BEP), because the backend was sending a
  stale `qualifies: false`. `resolveBep` already falls back through `h.bep`
  → `h.bonus.bep` → `bonus.monthlyTarget / 30` → house-label default, so the
  comparison reflects whichever BEP the backend most-recently sent. Equality
  at the breaking point counts as qualifying.
- The earlier fix in this Unreleased window had moved off the
  treatment-nights metric but still honored the backend `qualifies` overrides;
  this change removes that trust entirely for the overview path.

### Changed
- Extracted the eligibility decision to `lib/bonus-eligibility.js` so it can be
  exercised by `node --test`. Browser loads it as a UMD via the `/lib` static
  route in `server.js`.
- The house-detail tab is unaffected — it derives its tier from
  treatment-nights and never consulted `qualifiesMonthly`.
- The card's tier pill and bonus-amount display were decoupled from the
  eligibility flag: the pill shows whenever `tier.tier > 0`, and the bonus
  value shows whenever `totalBonus > 0`. This avoids a "מדרגה 0" rendering
  when a house qualifies by occupancy but has not yet accumulated a tier.

### Security
- This is a **data-integrity** fix. Bonus eligibility is a financial-status
  indicator shown to house managers; under the previous behavior a stale
  backend flag could mask a genuinely-qualifying house (false negative,
  Ra'anana case) and conversely could mark a non-qualifying house as eligible
  (false positive). Either direction is a misleading financial signal that
  could drive incorrect compensation expectations or operational decisions.
  No data is exposed, no auth boundary changes; the impact is the correctness
  of a status signal downstream people rely on. The overview now derives
  eligibility from real-time occupancy and the BEP the backend most-recently
  sent, rather than from a separate flag that can drift out of sync.
