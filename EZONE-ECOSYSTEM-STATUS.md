# E-ZONE Ecosystem Status — updated September 10, 2026

> **October 20, 2026 addendum**: `docs/ecosystem-addendum-2026-10-20.md`. It covers the five managers / coordinators /
> Dashboard changes, the Script Properties to set and the deploy order.

## Managers protocol 2 — prepared October 14, 2026 (not activated)

Coordinated Managers/Dashboard hardening requires immutable account IDs,
authenticated and scoped read feeds, private-note ownership by ID, and a
protocol/secret readiness gate. Follow `docs/managers-hardening-rollout.md`.
Do not merge the Dashboard change before a compatible Managers deployment is
serving. No live identity mapping or write persistence has been verified here.


Add this file to the knowledge of EVERY E-Zone app Project (all eight), replacing
the July 22 version, so any future chat/session starts from the true state. This
Sep 10 revision is the UNION of every repo's copy (the per-repo sections that had
drifted — Dashboard git history, Therapists roster source, Managers Sep 5–10 work,
Logistics access code — are folded in below); the same file now lives in all repos.

## Deployment ground truth (branches re-verified July 22, 2026)

| App | Repo | Deploys branch |
|---|---|---|
| Outpatient | ezone-outpatient | **claude/youthful-volta-laarnk** (UNIFIED — see below) |
| Dashboard | E-Zone-Dashboard | claude/build-ezone-dashboard-QOg5s |
| Therapists | ezone-therapists | claude/inspiring-tesla-jipobw |
| Managers | ezone-managers | main |
| Staffing | ezone-staffing | main |
| Kitchen | ezone-kitchen | main |
| Coordinators | ezone-coordinators | main |
| Logistics | sandrabrayer-ezone-logistics | main |

⚠️ Verify the Railway-connected branch in the Railway dashboard before any work —
it is NOT stored in the repo and has been silently switched before (July 3:
outpatient was switched dashboard-hKjf9 → volta, orphaning a day of work). The
clasp CI deploy workflow, by contrast, DOES store the deployed branch (its
`branches:` list) in the repo — see "Apps Script deployment" below.

## Apps Script deployment — automatic via clasp CI (rollout COMPLETE, verified 22/07/2026)

Every E-Zone app's Apps Script backend now auto-deploys from GitHub Actions via
clasp. No more hand-pasting `Code.gs` into the editor. The rollout is complete
and was verified green across all six apps on 22/07/2026 (ezone-therapists
already ran this exact setup — it was the template the six were matched to).

- **Automatic via GitHub Actions** — `.github/workflows/deploy-apps-script.yml`,
  clasp pinned to `@google/clasp@3.3.0`, hardened workflow: it fails loudly and
  early (before touching the live deployment) if a secret is missing or
  `CLASPRC_JSON` isn't valid JSON, and it requires clasp's `Deployed …@<version>`
  confirmation on the redeploy step — so a rejected deployment ID can never pass
  as a green no-op. Runners use `actions/checkout@v5` + `actions/setup-node@v5`
  (Node 24 native — clears the Node 20 deprecation warning) with the clasp
  toolchain on `node-version: '22'`.
- **Trigger** — a push/merge to the app's **deployed branch** that touches
  `apps-script/**` (also `.clasp.json` or the workflow file itself). A
  `workflow_dispatch` trigger allows manual on-demand runs from the Actions tab,
  and a `concurrency` group serializes runs so two pushes can't race the same
  deployment.
- **Redeploys the EXISTING deployment (same `/exec` URL)** — `clasp push -f`
  uploads `apps-script/**`, then `clasp deploy -i <DEPLOYMENT_ID>` republishes
  the existing deployment as a NEW VERSION. The deployment ID is reused, so **the
  `/exec` URL never changes** and no consumer (Railway `APPS_SCRIPT_URL`, sibling
  apps) has to be re-pointed.
- **Secrets (per repo)** — `CLASPRC_JSON` (clasp OAuth tokens from a local
  `clasp login`) + `DEPLOYMENT_ID` (the existing Web App deployment ID, starts
  with `AKfyc…`). Both live ONLY in GitHub Secrets, never in git; the workflow
  `rm`s the runner's token copy at job end (`if: always()`).
- **Token-refresh procedure** — clasp OAuth tokens expire / can be revoked. To
  refresh: run `clasp login` locally (clasp 3.x) → copy the fresh
  `~/.clasprc.json` → update the **`CLASPRC_JSON`** secret **in all six repos**
  (the SAME value everywhere — they share one deploying Google account) → re-run
  the failed deploy job. `DEPLOYMENT_ID` and the per-repo Script IDs are
  unchanged.

### Per-app deployed branch (verified 22/07/2026)

| App | Repo | Deployed branch |
|---|---|---|
| Staffing | ezone-staffing | `main` |
| Kitchen | ezone-kitchen | `main` |
| Coordinators | ezone-coordinators | `main` |
| Outpatient | ezone-outpatient | `claude/youthful-volta-laarnk` |
| Logistics | sandrabrayer-ezone-logistics | `main` |
| Dashboard | E-Zone-Dashboard | `claude/build-ezone-dashboard-QOg5s` |

Each app's workflow `branches:` list and its `.clasp.json` Script ID are the
source of truth for that app's deploy; the deployment ID lives only in the
repo's `DEPLOYMENT_ID` secret. Setup, token-refresh, and the manual fallback are
documented per repo in `DEPLOY.md`.

### ⛔ OBSOLETE — manual copy-paste redeploy (superseded by clasp CI)

The old manual procedure — open the Apps Script editor, paste `Code.gs`, Save,
Deploy → Manage deployments → New version of the EXISTING deployment — is
**SUPERSEDED** by the clasp CI above and must no longer be used for routine
deploys. It is retained only as an emergency fallback (see each repo's
`DEPLOY.md` → "Manual fallback", which uses clasp locally, not the editor). The
CI path is the ecosystem's standard; hand-pasting was the ecosystem's most
error-prone operation (accidental "New deployment" → the `/exec` URL changes →
every consumer breaks).

## Coordinators (רכזים) — Sep 10, 2026: PRs #139–#148 shipped (all merged to `main`, Code.gs redeployed)

Ten coordinators PRs merged Sep 9–10, 2026, one at a time off `main`, Railway
auto-deployed each, and every `Code.gs` change went out as an isolated commit +
manual "Deploy Apps Script" run afterwards (no auto-deploy trigger — policy unchanged).
Suite at #148: **1221 tests green** (`node --test --test-concurrency=1`).

| PR | What shipped | Code.gs |
|---|---|---|
| #139 | **Guide roster is staffing-owned.** `getGuides` syncs from staffing's read-only `getGuidesForCoordinators` feed on every read (name match, phone as secondary key, upsert under LockService; local rows never deleted/renamed; feed down → zero writes, `rosterSource:'local'` + amber notice). Add / remove / rename retired in the app (410 routes, denylist); only «עריכת מינימום» stays. Inactive guides greyed in the picker, red chips on today/future. | yes |
| #140 | **Guide-name migration** `migrateGuideNamesNow(dryRun)` — editor-run, dry-run default; aligns three guide spellings to staffing's and deactivates one departed guide; rewrites references house-scoped across ShiftAssignments / SwapRequests / PickupRequests / Constraints / TrainingRecords. | yes |
| #141 | **קופה קטנה limit 1,000 → 2,000 ₪/month** — single `PETTY_CASH_LIMIT` constant (guard test forbids other literals), admin-only `POST /api/petty-cash/migrate-limit` (dry run unless `confirm:true`), Guide §14. | yes |
| #142 | **Perf**: `getHouseBundle` (one execution per house open) + `getCorrectionState`, sheet cache TTL 300 s, staffing sync `tryLock(2s)`; proxy request **coalescing**, targeted invalidation (`WRITE_INVALIDATES`), stale-while-revalidate (`X-Cache: HIT / STALE / MISS`), warm-up ≤3 in flight. Diagnosis + Railway verification in `docs/perf-bundle.md`. | yes |
| #143 | **Soft delete** in תקציב רווחה + קופה קטנה — 🗑 with a required reason (2–120), `deletedAt/deletedBy/reason` appended columns, summaries skip deleted rows, «רישומים שנמחקו» collapsed section, amber «תיקון עודף» instead of a negative balance. | yes |
| #144 | **Hard block on manual edits** — double shift + one free day per week (+ cap 6) enforced on every manual path (tap-to-correct, draft override, post-publish correction, swap request, swap approval) via `getCorrectionState`; no override flag; picker greys violators with the reason; one shared Hebrew reason map (`REASON_HE`). | no |
| #145 | **WhatsApp group send** — «📤 שליחה לקבוצת המדריכים — כל החודש»: the full schedule (every date × shift, ❗ on unfilled from the board model), `wa.me/?text=` without a number, «העתקה», weekly parts «חלק i/n» over 1,200 chars; the same week button on the ראשי card and the weekly view. Pure builder `lib/whatsapp.js scheduleMessage`. | no |
| #146 | **Team-meeting day per house** — `Houses.MEETING_DAY` (raanana Tue · ramot Mon · rehab Tue · pardes Sun · efroni Thu) is the source of truth; scheduler soft term 50,000 (≥1 shift/week on the meeting day, below the 100,000 minimum, above load); «ישיבת צוות» chip on the board, ראשי and «המשמרות שלי». | no |
| #147 | **Visit order + psychiatrists** — `InpatientSessions.visitOrder` (appended), `inpatientSession` op `move`, «פסיכיאטר/ית» tag from `Therapists.role`. (Superseded on the UI side by #148: order is now by time.) | yes |
| #148 | **לוז מטפלים restructured, therapist-first + timed** — `InpatientSessions.time` (appended, 'HH:MM' text) **required** on add, **no two sessions of one therapist at the same time on a day**, op `setTime`; UI = «שיבוץ לפי מטפל/ת» cards (workdays from `TherapistWorkdays` → «HH:MM · מטופל» slots, off-day confirm) + derived read-only «לוז שבועי» with filters; legacy rows «ללא שעה» + «הגדרת שעה». **Also: house labels always Hebrew** — `Houses.label()` everywhere, staffing ids (`asher` / `ofroni` / `hapardes`) mapped at read, `hapardes → pardes` in the staffing sync map, `test/house-label-guard.test.js`. | yes |

### Script Properties added in this run (never in code)

| App | Property | Purpose |
|---|---|---|
| **Staffing** | `COORDINATORS_READ_SECRET` | Unlocks ONLY the read-only `doGet?action=getGuidesForCoordinators` feed (name · phone · active · houses · startDate — no financial data). Set on the staffing Apps Script (staffing PR #26). |
| **Coordinators** | `STAFFING_SHEETS_URL` | The staffing Apps Script `/exec` URL the guide sync calls. |
| **Coordinators** | `STAFFING_GUIDES_SECRET` | = staffing's `COORDINATORS_READ_SECRET`. Missing / mismatched → sync skipped, local roster served, amber «לא סונכרן מהסטאפינג» notice. |

Both coordinators properties are set and verified (roster line shows «מנוהלת במערכת
הסטאפינג»). The `script.external_request` scope was authorized once by running
`previewStaffingGuideSyncNow` from the editor. No Railway variables were added.

### Coordinators conventions confirmed this run

- One PR at a time, branched off `main`, PR base `main`; explicit-path `git add`;
  CHANGELOG + Guide.html + tests in every PR; SW cache bumped on any asset change
  (now `v120`); `Code.gs` changes in isolated commits, deploy manual after merge.
- Sheets headers are append-only — new columns this run: `WelfareLog` /
  `PettyCashLog` (`deletedAt`, `deletedBy`, `reason`), `InpatientSessions`
  (`visitOrder`, `time`). `_ensureSheet` writes a new header cell on the first
  write after deploy; `_isTimeHeader` pins `time` columns to text.
- The staffing feed is the roster's source of truth; `InpatientAssignments` stays
  dead; no financial data beyond תקציב רווחה + קופה קטנה.

## Outpatient: the two production lines are UNIFIED (July 4, PR #56)

- `claude/ezone-outpatient-dashboard-hKjf9` and `claude/youthful-volta-laarnk`
  had **no common git ancestor** (unrelated histories) and both accumulated real
  features. PR #56 merged dashboard INTO volta (`--allow-unrelated-histories`).
- **claude/youthful-volta-laarnk is now the single canonical production branch.**
  Treat `dashboard-hKjf9` as dead — do not commit there.
- Restored dashboard features now live on volta: createLead endpoint
  (fail-closed via `CREATE_LEAD_SECRET`), LockService around `_saveAll`,
  persisted paymentStatus/paymentDate/nextBillingDate, backdated payment dates,
  renewal anchored on stored nextBillingDate, card extra-charge paid/unpaid
  toggle, optimistic saves, urgency-sorted patient cards, two-panel patient-card
  redesign, סניף location dropdown/source-of-truth, frequency unit שבוע/חודש.
- **CLIENTS_HEADERS is APPEND-ONLY** (33 cols). `_readAll/_writeAll` map the
  live sheet BY POSITION and `_ensureSheet` never migrates data — NEVER reorder
  or remove mid-array columns; append only. Guard tests enforce the exact order.

## Outpatient therapist-payout subsystem (shipped July 1–4)

- "תשלומי מטפלים" tab: monthly per-therapist totals (pre-VAT / with VAT),
  detail toggle, mark-forwarded-to-payroll, Excel/CSV export (UTF-8 BOM).
- Pipeline: therapists app marks a session → posts `recordSessionOutcome`
  (secret `SESSION_OUTCOME_SECRET`, set on BOTH Apps Scripts, fail-closed) →
  outpatient writes a `SessionLog` row → payout tab reads `getSessionLog`.
- **Pay rates live in the `TherapistRates` sheet** (name / flatRate /
  intakeRate / followupRate), auto-seeded, cached 120s (edits apply ≤2 min).
  Names must EXACTLY match the therapists app's full names (e.g.
  'ד"ר מיכאל שפרינץ', 'הילה תבור'). Unknown names fail closed. ~14 newer
  therapists still have blank rates — fill before their sessions can record.
- Credit/quota engine: `creditsOwed` persisted per client, single-cell writes.
- Perf: `loadAll` is PARALLEL (Promise.all, guard-tested); session save writes
  one cell, not the whole Clients sheet.
- Deferred: "+ הוסף סשן חסר"/"תיקון סשן" correction modal; historical backfill
  of sessions recorded before the pipeline existed.

## Managers bonus overhaul shipped July 4, 2026 (PRs #5, #7)

- ALL bonus math now lives ONLY in the frontend (`lib/bonus-eligibility.js`);
  the Apps Script backend's bonus fields (qualifies, lockedIn, projectedBonus,
  quarterly*) are ignored everywhere — backend supplies raw data only
  (avgDaily, treatmentDays, treatmentDaysSoFar, manager names). This ended the
  recurring two-systems-out-of-sync bug. Pending: strip the dead bonus code
  from the live "ezone dashboard" Apps Script.
- Model: tier by average daily occupancy — Ramot 17/19/20, Ra'anana 10/12/14,
  Efroni, Rehab & Pardes 10/12/13 → 2,000/2,500/3,000₪. Treatment-days gate is FIXED
  per house: threshold × 30 (Ramot 510, others 300), independent of month
  length and tier.
- Settled previous-month bonus ("בונוס לתשלום") is the headline: trophy
  winners banner (house + manager + amount), per-card rows, KPI total —
  computed on the 1st for the finished month.
- Quarterly 5,000₪ computed locally: windows anchored May 2026 (May–Jul,
  Aug–Oct…), each finished month's settled bonus must be ≥2,000₪; first
  possible payout end of July 2026. Frontend fetches each finished window
  month via `managersOverview&month=YYYY-MM`.
- Day counts run from the 1st (never front-dated); readability pass
  (text-mute 0.72, small fonts 12–13px). Tests: 36 via `node --test`.
- Efroni house-id checked: data-entry app and backend both use 'arfoni'
  consistently — no mismatch.

## Managers: bonus month labelling (September 8, 2026)

- **Settled vs running month are now two labelled blocks everywhere**
  (`בונוס אוגוסט 2026 — סופי (לתשלום)` / `ספטמבר 2026 — חודש נוכחי (בתהליך)`).
  A settled month shows a final state only (`זכאי · מדרגה X · Y ₪` or
  `לא זכאי · המכסה לא הושלמה (441/510)`) — never `בדרך`/`בתהליך`/`חסרים`.
  Hero banners lead with the settled month; running-month progress is a
  secondary line with the month name and `בתהליך`.
- **Running month = ACTUAL days-so-far from the 1st + a separately labelled
  `צפי לסוף החודש` projection.** A tier is shown as achieved only when
  settled-and-met or locked in; otherwise `מדרגה הבאה: N (P מטופלים/יום) ·
  ממוצע נוכחי X`.
- **Single days-so-far figure**: `public/bonus-view.js` → `daysSoFar` (daily
  chart summed to today; else the feed's `treatmentDaysSoFar` capped at
  elapsed × capacity) feeds the KPI, hero, progress bar and house card. The
  feed's raw `treatmentDaysSoFar` is front-dated (366 vs 102 on 8 Sep) and is
  no longer shown as-is.
- **Stray "2500" under the manager name**: the card rendered the feed's
  `type` field verbatim. House type now comes from `HOUSE_LABELS` only; feed
  manager/name strings pass through `BonusView.safeLabel`. Tests assert no
  backend bonus field reaches the DOM (`test/app-render.test.js`).
- New module `public/bonus-view.js` (labelling only; math stays in
  `lib/bonus-eligibility.js`). Tests: 113 via `node --test`. SW cache v7.
  Details: `docs/bonus-month-labelling.md`. Still pending: strip the dead
  bonus code from the live dashboard Apps Script (unchanged by this work).

## Managers: occupancy history picker (September 10, 2026)

- Every house tab opens with a **"היסטוריית תפוסה"** card: a month picker
  (current month back to the May 2026 quarterly anchor, up to 12 months)
  that shows a past month's daily occupancy chart, `ימי טיפול` vs the fixed
  gate, daily average and settled status — always `(סופי)`, never `בתהליך`.
- Data: `managersOverview&month=YYYY-MM` (shared `fetchMonthOverview_`
  helper); the daily chart from that payload or one
  `managersHouse&house=…&month=…` attempt accepted only when its `month`
  matches. Fetch errors show an explicit error state. **The picker never
  touches the bonus KPIs / hero / cards** (snapshot-tested). SW cache v9,
  tests 125. Details: `docs/occupancy-history-view.md`. Backend unchanged:
  whether the month overview carries a per-house `dailyChart` is decided in
  the dashboard Apps Script.

## Managers: bonus history month picker (September 10, 2026)

- **"חודש בונוס" picker on the overview and on every house tab**: the
  running month (default) plus every finished month back to the May 2026
  quarterly anchor, no cap. One page-wide selection; `חזרה לחודש נוכחי`
  restores the live view. A finished month renders the WHOLE page settled
  through `BonusView.settledMonthView` — `יולי 2026 — סופי`, tier reached,
  amount, gate result — KPIs, winners banner, network chart, house cards,
  house hero, month split, days bar, tier track, quarterly block
  (anchored to the selected month's window, with `מאי ✓ · יוני ✗ · יולי ✓`
  marks) and breakdown. Never `בתהליך` / `בדרך` / `חסרים` / `צפי`; the
  next-tier card is hidden; days-so-far of a finished month = full-month
  total.
- Data: the existing `managersOverview&month=YYYY-MM` fetch only (selected
  month + finished months of its window, ≤ 3 requests), cached per month in
  memory for the life of the page; explicit error state, retried on
  re-select. **No new endpoints, no Apps Script changes.** The running month
  is byte-for-byte unchanged (snapshot-tested). SW cache v10, tests 136.
  Details: `docs/bonus-month-labelling.md` → "Bonus history month picker".

## Managers: monthly occupancy view + CSV export (September 17, 2026)

- **Permanent «תפוסה חודשית (סופי)» card** — overview: a table of every
  SETTLED month (newest first, from the May 2026 anchor) × the five houses
  (labels from `HOUSE_LABELS` only), each cell the month's occupancy
  percentage with `ממוצע יומי/קיבולת` beneath it; every house tab shows its
  own column only. Always `סופי`, never `בתהליך`; **the running month is
  never a row**. A missing month/house cell says `אין נתונים` — never `0%`.
- **Data**: one `GET /api/sheets?action=occupancySnapshots` per page through
  the EXISTING proxy / `APPS_SCRIPT_URL` path (the query allowlist already
  passes `action`) — no new endpoint, env var or Railway variable. Rows are
  `{ month, houseId, treatmentDays, daysInMonth, avgDaily, capacity,
  occupancyPct, manager, capturedAt }`; the backend id **`arfoni` is mapped to
  the frontend key `efroni`** and an unknown id is dropped. A failure, an
  unknown action or a payload without `rows` → an explicit error state plus a
  `נסו שוב` retry button, never a silent fallback computation.
- **`ייצוא CSV`** — pure module `public/occupancy-export.js`: UTF-8 BOM,
  Hebrew headers (`חודש, בית, מנהל/ת, ימי טיפול, ימים בחודש, ממוצע יומי,
  קיבולת, תפוסה %`), manager through `BonusView.safeLabel`, CSV-injection
  (`= + - @`, tab, CR) and quotes escaped, only those eight columns ever
  written, downloaded as `occupancy-<from>_to_<to>.csv`.
- **The bonus side is untouched**: own state slice (`state.occupancy`), feed
  values rendered with `textContent` only, rendered last on the house tab;
  every existing bonus snapshot test stays byte-for-byte green. SW cache v13,
  tests 148 → **178**. Details: `docs/occupancy-history-view.md` → "Monthly
  occupancy (permanent)".
- **Backend dependency**: the `occupancySnapshots` action itself ships in the
  parallel **E-Zone-Dashboard** PR (Apps Script). The managers PR must be
  merged only AFTER that deploy; until then the card shows its error state and
  nothing else in the app is affected.

## Managers: settled month shows its own house data (October 1, 2026)

- **Bug (1 Oct 2026, first day September was settled)**: picking September in
  the bonus-history picker showed `אין נתוני כניסות / יציאות / הפניות
  לספטמבר 2026`, no patient names, and a 0 ₪ referral line. The settled house
  tab was built from the `managersOverview&month=` row only (no activity /
  chart / referral counts) and the "no data" strings were hardcoded; the
  month's own house payload was never requested.
- **Fix (frontend only)**: each opened house tab also loads
  `managersHouse&house=<key>&month=YYYY-MM` — the dashboard's `managersHouse_`
  already honours `month` for a past month. Accepted only when its `month`
  matches; `efroni` is sent as `efroni` (the dashboard maps it to `arfoni`);
  cached in `state.settledDetails`, never in the running month's state.
  Loading / error are explicit states (`שגיאה בטעינת כניסות ל…`, KPIs `—`),
  never `אין נתונים`; a failed house is retried on re-select.
- **Referral bonus disabled by decision (1 Oct 2026); switch: CONTINUITY_BONUS_ENABLED in lib/bonus-eligibility.js.** Managers get occupancy bonuses only, in the running month
  and in finished months:
  - no total includes referrals;
  - the «בונוס הפניות להמשך טיפול» line is hidden;
  - the running month no longer adds the Dashboard's referral total.

  The counts fetch and `continuityAmount` are kept for re-enabling.
- A month row without `avgDaily` / `treatmentDays` is "missing", never
  `לא זכאי · 0 ₪`.
- The tier / gate figures were already a real computation from the month's
  raw `avgDaily` / `treatmentDays` (same Patients-sheet computation as the
  house payload) — only the referral line was a missing-data artifact.
- Allowed dashboard actions for Managers: **`managersOverview`,
  `managersHouse`, `occupancySnapshots` only** (all others need a key the
  app does not have). No new endpoint, no Apps Script change. Running month
  unchanged apart from the removed referral line and totals without
  referrals (golden snapshot `test/fixtures/running-month.snapshot.json`).
  SW cache v14, tests 178 → 192.
  Details: `docs/bonus-month-labelling.md` → "Settled month — the house's
  own data"; `CHANGELOG-settled-month-house-data.md`.

## Managers: `GET /api/version` + self-merge rules (October 8, 2026)

- New public endpoint `GET /api/version` → `{commit, builtAt}`, `no-store`.
  `commit` = Railway's built-in `RAILWAY_GIT_COMMIT_SHA` (hex-validated, else
  `"unknown"`). No new Railway variable. Used to confirm a merge reached prod.
- `CLAUDE.md` now authorizes Claude to merge its own Managers PRs on green CI
  and to verify the deploy via `/api/version`. Production URL still unrecorded.
- Lockfile: proxy-addr 2.0.8 (critical advisory fixed). Tests 192 → 197, SW v14.

## Managers: lower first tier + outpatient day-package bonus (October 13, 2026)

- **Effective from October 2026; earlier months unchanged.** Bonus rules are
  now month-aware (`RULE_SETS` in `lib/bonus-eligibility.js`): a month is
  judged by the latest rule set that started on or before it.
- First tier / treatment-days gate from Oct 2026: Ramot 14 / 420, Efroni 9 /
  270, Rehab 9 / 270, Pardes 7 / 210, Ra'anana 10 / 300 (unchanged). Up to
  Sep 2026: Ramot 17 / 510, others 10 / 300. Tiers 2 and 3 unchanged.
- Outpatient day-package bonus from Oct 2026 (corrected the same day to
  ONE-TIME — see the section above): 300 ₪ once per patient, in the month the
  patient starts a day package (`day_2x` / `day_daily`); maintenance 0;
  independent of the occupancy bonus; NOT part of the quarterly check. None
  before Oct 2026. Data: the dashboard Apps Script's "Outpatients" sheet
  (`house_of_origin`, `therapy_type`, `start_date`, `end_date`); any overlap
  with the month counts as a full month — the sheet must be kept current.
- Replaces the 1 Oct 2026 `CONTINUITY_BONUS_ENABLED` switch; kill switch now
  `REFERRAL_BONUS_KILL_SWITCH`. Frontend only, no Apps Script change, no new
  endpoint. September 2026 renders byte-identically. Tests 197 → 224, SW v15.

## Managers: committees from the coordinators feed + 2-day alerts (October 22, 2026)

- The Managers server reads committees straight from the coordinators server (`POST /api/managers-feed`,
  Bearer `COORDINATORS_FEED_SECRET` = coordinators `MANAGERS_FEED_SECRET`; `COORDINATORS_FEED_URL`).
  Fail-closed: unset → the Dashboard path stays the source. Details: `docs/coordinators-feed.md`.
- Status (מתוכננת / התקיימה / בוטלה) + notes; a cancelled committee never alerts.
- Alerts today … +2 (same as the coordinators); +3 … +7 listed under «בהמשך השבוע».

## Managers: half-yearly feedback «משוב» reminders (October 20, 2026)

- The next due date is 6 months after the last feedback, or after the start date (`lib/feedback-due.js`;
  month ends clamp; no start date → «אין תאריך התחלה»).
- «הבית היום» shows a card with the overdue (red) and the due-in-30-days employees. «צוות ומשמרות» shows the list
  with «בוצע» + a date.
- The write goes `/api/work` `feedbackDone` → Dashboard `ManagersFeedbackLog` (append-only). The employee must be on
  the house staff.
- The roster comes from the coordinators digest (`startDate` appended).
- SW v37, tests 426. Details: `docs/feedback-reminders.md`.

## Managers: «סיכומי ישיבות» — read-only, own house (October 20, 2026)

- A new sub-tab with a month filter. It shows the coordinators' FINAL team-meeting summaries:
  - participants and the general summary;
  - per patient, the update and goals.
- `/api/work` op `meetingSummaries` → Dashboard → coordinators `getMeetingSummariesForManagers`
  (`MANAGERS_READ_SECRET`).
- The house is pinned server-side. No edit. SW v36, tests 413. Details: `docs/meeting-summaries.md`.

## Managers: committees READ-ONLY — the coordinators set them (October 20, 2026)

- The coordinators set committees (coordinators `Committees` sheet, «ניהול ועדות» + WhatsApp to the manager).
- Managers show them read-only:
  - a new «ועדות» sub-tab;
  - «ועדות קרובות» on «הבית היום»;
  - the admin all-houses card.
- `/api/work` `committeeSet` → 410 `committee_read_only`; the Dashboard refuses it too. The per-patient
  editor is removed.
- Data: `houseData.committees` ← Dashboard ← coordinators `getCommitteesForManagers`.
- Script Properties:
  - coordinators `MANAGERS_READ_SECRET`, `HOUSE_MANAGER_PHONES`;
  - Dashboard `COORDINATORS_SHEETS_URL`, `COORDINATORS_MANAGERS_SECRET`.
- SW v35, tests 408. Details: `docs/committee.md`.

## Managers: «מדריך» usage guide (October 20, 2026)

- A static Hebrew RTL «מדריך» tab, open to every role. It covers:
  - the tabs;
  - how to read «הבית היום»;
  - the bonus calculation (October 2026 rules, per-house table) and how to read it;
  - patients, team, logs, committees, meeting summaries, feedback reminders, login.
- Sections for features not live yet are marked «בקרוב».
- The bonus table is checked against `lib/bonus-eligibility.js` in CI.
- No data, script or endpoint. SW v34, tests 419. Details: `docs/guide.md`.

## Managers: «הבית היום» landing tab + one «בונוס» tab (October 20, 2026)

- **Why**: the house page headlined the settled previous month («ספטמבר: לא זכאי 432/510») while
  October was on screen.
- **Tabs**:
  - The app opens on «הבית היום». Admins get one card per house: the date and weekday,
    patients, the בוקר / ערב / לילה shifts, sessions, open reminders and the all-houses alerts.
  - A manager lands on their house's «הבית היום» sub-tab (was «ראשי»).
  - Every bonus element (picker, hero, dial, plan, KPIs, chart, history, winners banner, house
    cards) moved to «בונוס».
- **Banner**: none in the running month. A finished month picked in «חודש בונוס» shows its hero
  inside «בונוס», labelled «— סופי».
- **Data**: the existing `houseData` (coordinators digest) only. A missing feed gives `—` and the
  reason, never invented rows.
- `lib/bonus-eligibility.js` untouched. The golden snapshot differs only in the now-empty hero.
  No new endpoint, env var or secret. SW v33, tests 412. Details: `docs/home-and-bonus-tabs.md`.

## Managers: read failures classified + last-good cache (October 19, 2026)

- **Symptom (19 Oct, ~15:00)**: «שגיאה: upstream_error» and every card stuck on «טוען…».
  `/api/sheets` gave a bare 502 for both non-JSON replies and fetch failures / timeouts.
- **Fix (Managers only)**: `/api/sheets` now answers one of these codes:
  - `upstream_timeout` (504);
  - `upstream_unreachable`;
  - `upstream_auth` (HTML auth page);
  - `upstream_bad_response`;
  - `upstream_app_error`;
  - `upstream_unavailable` (503).

  The 15 s timeout is unchanged. The server log gets one `[sheets] action=… class=… status=…
  ms=… served=…` line, with no body, endpoint, secret or name.
- **Last good copy**: per person + request, in memory, ≤ 72 h. Served with `X-Data-Source:
  cache`; the UI then shows «מוצגים נתונים שמורים מ־<time>» + «נסו שוב». With no copy, a
  Hebrew error + «נסו שוב». Raw codes are never shown.
- **Dashboard #251–#256 review (read-only)**: no change to `managersOverview_` /
  `managersHouse_`. #255 appends `Patients.personId`; the managers read writes that header once
  on the first read after the deploy. It fails only if the sheet is exactly 13 columns wide.
  Check the four Apps Script deploy runs (~15:00) and the executions log.
- No new endpoint, env var or secret. SW v32, tests 398. Details: `docs/sheets-resilience.md`.

## Managers: committee date per patient «ועדה» (October 15, 2026)

- «מטופלים בבית» row: second line «ועדה: dd/m/yy · <label>» (label ≤ 60), with set / «שינוי» /
  «ניקוי».
- Today or later; a past date only as a confirmed correction of an existing date.
- `/api/work` `committeeSet` → Dashboard `ManagersCommittee` (append-only; E-Zone-Dashboard
  #239).
- Alerts on «ראשי»: «ועדה היום» and «ועדה השבוע» (`COMMITTEE_LEAD_DAYS = 7`), Israel time, a
  badge, and an admin all-houses card with a house filter. Shared fixture
  `committee-alert-cases.json`.
- No new endpoint, secret or variable. SW v31, tests 371. Details: `docs/committee.md`.

## Managers: expected discharge clear + «אין צפי לשחרור» (October 15, 2026)

- The date form on «מטופלים בבית» adds «ניקוי תאריך» and «אין צפי לשחרור». A «אין צפי» row
  shows that text with a «שינוי» button.
- Same spinner, error reasons and optimistic concurrency as «שמירה». The token is `''`, a date,
  or `none`.
- `/api/work` `dischargeSet` `mode` = `set` | `clear` | `none`. Both new modes APPEND a row in the
  Dashboard (E-Zone-Dashboard #238; `ManagersExpectedDischarge` gained the `state` column). Never
  deleted.
- «אין צפי» is left out of the alerts and out of the no-date count; the shared fixture gained
  `states`. No new endpoint, secret or variable. SW v30, tests 347.
  Details: `docs/expected-discharge.md`.

## Managers: discharge alerts «שחרור קרוב» (October 15, 2026)

- Driven only by the manager's own expected discharge date; no Dashboard auto-fill (CEO
  decision).
- **«ראשי»**: amber alerts for dates from today to +14 days (`ALERT_LEAD_DAYS`), red
  «דורש עדכון» for passed dates, one line «N מטופלים ללא תאריך שחרור משוער», a one-tap
  «שינוי תאריך», and a badge on the sub-tab.
- **Admin**: an all-houses card with a house filter on the overview.
- **How**: frontend only (`public/discharge-alerts.js`), from the existing `houseData`. No new
  endpoint or secret. "Today" in Asia/Jerusalem; text-only DOM; no names in logs.
- **Delivery**: in-app only (no email / WhatsApp / push). SW v28. Details:
  `docs/discharge-alerts.md`.

## Managers: temporary exit and return keeps the stay (October 15, 2026)

- **CEO rule**: a return within 7 days (`READMIT_WINDOW_DAYS`, Dashboard) is one stay.
- **Counting**: once per patient per day; gap days are not counted (bed-held is not recorded).
- **«יום N»**: the admission date and «יום N» run from the first admission.
- **Where**: Dashboard raw data (E-Zone-Dashboard PR #231); `lib/bonus-eligibility.js` is
  unchanged.
- **Settled months**: from Oct 2026 only; settled months are byte-identical. The read-only
  audit `auditTemporaryExitsNow()` uses initials only.
- Details: `docs/temporary-exit-return.md`.

## Managers: expected-discharge SAVE fix + save spinner (October 15, 2026)

- Symptom: «השמירה נכשלה: upstream_error» on save; reads fine. `upstream_error` = the proxy got
  no JSON: a non-JSON reply, or a fetch failure / timeout (15 s).
- Code bug, fixed in E-Zone-Dashboard #236: the managers writes waited `waitLock(10000)` after the
  Patients read. That could outlast the proxy timeout; they now use `tryLock(5000)` → `lock_busy`.
  The same PR adds the editor-run `authorizeSheetsWriteNow()` (full-scope consent + a real
  temp-sheet write); run it once.
- `/api/work` now answers specific codes instead of `upstream_error`:
  - `upstream_timeout` (504);
  - `upstream_unreachable`;
  - `upstream_auth` (an HTML authorization page);
  - `upstream_bad_response`;
  - `exception` (with no message).

  Writes get 30 s, reads keep 15 s. The server log gets one `[work] op=… failure|upstreamError=…
  status=… ms=…` line: no body, name, endpoint or secret.
- The browser shows a specific Hebrew reason (`WorkView.dischargeErrorText`), never a raw code.
- Save spinner: spinner + «שומר...», with the date, «שמירה» and «ביטול» disabled. A double tap
  sends one request. Errors restore the form with the date kept and the reason shown; success
  shows «נשמר ✓». Respects `prefers-reduced-motion`; 16px / 44px; text-only DOM.
- SW v28 → v29. Tests 306 → 330. Details: `docs/expected-discharge.md` «Saving».

## Managers: expected discharge date on «מטופלים בבית» (October 15, 2026)

- Each patient row shows «שחרור משוער: dd/m/yy», or «הגדרת תאריך שחרור» when no
  date is set, with a native date picker (min = admission date). RTL, 16px, 44px
  targets, 360px-safe.
- Path: `/api/work` op `dischargeSet` → Dashboard `managersWork` `dischargeSet`
  (E-Zone-Dashboard PR #230). The value comes back in `houseData`
  (`patients[].expectedDischarge`, `expectedDischargeSupported`).
- Storage: the append-only Dashboard sheet `ManagersExpectedDischarge`, keyed by
  house + patient + admission date. Every edit is a new row (who, when, previous
  value); a stale edit gets `conflict`, never a silent overwrite.
- Access: session required; a manager edits only their own house, an admin any
  house; the existing fail-closed `MANAGERS_WORK_SECRET`. The 16 kb JSON body
  limit stays, and writes get an extra 60 / 15 min bucket.
- Display-only (no bonus figure reads it). SW v27. Details: `docs/expected-discharge.md`.

## Managers: work tool stage 1 — personal-code login + house work tabs (October 13, 2026)

- The app is NO LONGER open: personal code per person (`MANAGER_ACCESS`
  Railway variable); a house manager sees only their house, Sandra and Ron
  see all; enforced server-side. Session cookie signed with a key derived
  from `MANAGERS_WORK_SECRET`. See `docs/access.md`.
- House sub-tabs: בונוסים · מטופלים · שיחות משפחה · שיחות עם עובדים
  (private to author + admins) · אירועים חריגים, with follow-up reminders.
  Data via `/api/work` → Dashboard `managersWork` (same secret, set as a
  Script Property there).
- Stage 2 (Oct 14, 2026) adds two house tabs:
  - «צוות ומשמרות»: on shift today, the next 14 days, and the staff with phones;
  - «מטפלים»: workdays and the weekly visits.
- Stage 2 data path: coordinators ManagersHouse digest → Dashboard `managersWork` `team` →
  `/api/work`. It needs the Script Property `MANAGERS_DIGEST_SHEET_ID` on both Apps Scripts.
- Login asks for a username (the person's name in `MANAGER_ACCESS`, or an optional Latin `user`)
  plus the code, both of the same person (Oct 14, 2026).
- Dashboard «ראשי» (Oct 14, 2026), the first house tab:
  - a bonus dial;
  - today in the house (on shift, therapy sessions, reminders);
  - visits and admissions;
  - the latest events.
- «שיחות משפחה» was removed on Oct 14, 2026.
- The dashboard also has a «מה אם?» bonus calculator (all bonuses together) and expected
  admissions (Dashboard `houseData.expectedAdmissions`, open leads, next 14 days).
- Each tab and bonus box has its own colour.
- Stage 3 (Oct 14, 2026): a «עלות כוח אדם» card for each house, visible to that house's
  manager and to the admins.
- Data path: `/api/work` `houseCost` → Dashboard `managersWork` `houseCost` → staffing
  `getHouseCostsForManagers`, house totals only.
- Script Properties:
  - staffing `MANAGERS_COST_READ_SECRET`;
  - Dashboard `STAFFING_SHEETS_URL` and `STAFFING_COST_SECRET`.

## Managers: continued-treatment bonus is one-time (October 13, 2026)

- 300 ₪ ONCE per patient, in the month the patient starts a day package
  (not monthly). Facts: Dashboard `referralStarts` (E-Zone-Dashboard PR
  #221). Oct 2026 rule set corrected before October was settled. Tests 235,
  SW v18.

## Managers: simple two-step bonus + house-page redesign (October 13, 2026)

- From Oct 2026: first bonus 2,000 ₪ at the lowered quota (Ramot 14,
  Ra'anana 10, Efroni 9, Rehab 9, Pardes 7) and full occupancy (capacity
  20 / 14 / 13 / 13 / 13) at 3,000 ₪ total. No middle tier. No quarterly
  bonus from the Aug–Oct 2026 window on. "Secured" mid-month = days already
  counted ≥ max(gate, patients × days-in-month).
- House tabs: one «הבונוסים החודש» card — each bonus in plain words with the
  real figures now and a status chip; full occupancy only while reachable;
  next-tier / tier-track / quarterly / month-split removed; occupancy history
  moved to the end. Overview unchanged. Tests 234, SW v17.

## Managers: intake-meeting bonus (October 13, 2026)

- From Oct 2026: 250 ₪ per intake meeting the manager held that closed into
  an admission of 30+ days, the patient being the admitted house's 7th+.
  Counted in the admission month; pending (< 30 days, still in) shown, paid
  once confirmed. Not part of the quarterly check. Credited to the meeting
  manager even across houses.
- Data: Dashboard `managersOverview` / `managersHouse` field
  `intakeMeetings { confirmed, pending, items }` (E-Zone-Dashboard PR #219).
  Amount in the Oct 2026 rule set; kill switch `INTAKE_BONUS_KILL_SWITCH`.
  Tests 224 → 233, SW v16.

## Managers: house roster (5 houses, current as of October 13, 2026)

The Managers app (`ezone-managers`) covers FIVE houses. Hardcoded fallbacks
live in `HOUSE_LABELS` (`public/app.js`) and `HOUSE_BONUS`
(`lib/bonus-eligibility.js`); the live feed's `manager` field, when present,
still takes precedence over the hardcoded name. `test/house-coverage.test.js`
and `test/ecosystem-status-doc.test.js` fail CI if any enumeration (or this
table) drifts.

| Key | House | Manager | Type | Eligibility threshold (from Oct 2026; until Sep 2026) | Capacity |
|---|---|---|---|---|---|
| raanana | רעננה אשר | שחר | בית מאזן | 10 (10) | 14 |
| ramot | רמות השבים | אורן | בית מאזן | 14 (17) | 20 |
| efroni | קיסריה עפרוני | חנן | תחלואה כפולה | 9 (10) | 13 |
| rehab | קיסריה ריהאב | רנטה | גמילה | 9 (10) | 13 |
| pardes | רעננה הפרדס | חן | תחלואה כפולה | 7 (10) | 13 |

- רעננה הפרדס (`pardes`) was added August 24, 2026 with Efroni's bonus
  parameters (its first tier diverges from Oct 2026: 7 vs Efroni's 9); the shared dashboard Apps Script must return `pardes` in
  `managersOverview` / `managersHouse` for its live data to appear.
- Manager history: raanana עידו → שחר (Aug 24, 2026); ramot שחר → אורן
  (Aug 25, 2026). Ra'anana's שחר and Ramot's former שחר are different people.
- Efroni's backend house-id is `arfoni` (data-entry app and backend agree);
  the frontend key is `efroni`.

## Apps Script topology (July 4)

- Outpatient Apps Script: **ONE active deployment** (URL ending FOwWYIw/exec);
  two accidental extra deployments created July 4 were archived. All three
  consumers point at it: outpatient `SHEETS_URL`, therapists
  `OUTPATIENT_SHEETS_URL`, dashboard `OUTPATIENT_LEAD_URL`.
- Dashboard backend: ONE Apps Script serves Dashboard (SHEETS_URL), Managers
  (APPS_SCRIPT_URL), Therapists (DASHBOARD_SHEETS_URL) — rotate together.
- Secrets (Script Properties, never in code): SESSION_OUTCOME_SECRET (new,
  both outpatient+therapists), CREATE_LEAD_SECRET (outpatient — set it to
  enable Dashboard→Outpatient lead handoff), DEBT_STATUS_SECRET,
  TREATMENT_PLANS_SECRET, OCCUPANCY_SECRET, OUTPATIENT_LEAD_SECRET,
  WINBACK_SOURCE_SECRET, APP_PIN (Railway; Logistics uses SHARED_ACCESS_CODE —
  its shared login code, which replaced APP_PIN there). Coordinators' staffing
  pair (STAFFING_SHEETS_URL / STAFFING_GUIDES_SECRET) and staffing's
  COORDINATORS_READ_SECRET: see the Sep 10 coordinators section above.

## Therapists: roster source = the ezone-staffing feed

- The Therapists app's therapist list is SYNCED from ezone-staffing (workers
  with role מטפל/ת) on every getData — `getTherapistsForTherapists`. Names are
  edited in the STAFFING app; `active` is overwritten by every sync (exact-name
  upsert, add/deactivate/reactivate only — never a row delete or rename; all
  downstream matching, incl. outpatient TherapistRates, is exact-string, so
  renames go through staffing + `migrateTherapistNames` + a TherapistRates row
  rename together).
- Secret pairing: staffing's `THERAPISTS_READ_SECRET` = therapists'
  `STAFFING_THERAPISTS_SECRET` (plus `STAFFING_SHEETS_URL` on the therapists
  Apps Script). Unset/unreachable ⇒ NO writes; the last-synced list is served
  and the UI shows an amber "לא סונכרנה" toast. (The coordinators app follows
  the same pattern for guides — see the Sep 10 section.)

## Dashboard git history: the deploy branch is an ORPHAN SNAPSHOT (verified Aug 9, 2026)

`claude/build-ezone-dashboard-QOg5s`'s root commit (`62f5f7b`, "Merge pull
request #18", June 17 2026) has **no parents** — the branch began life that day
as a flattened snapshot of everything through PR #18. The original PR #1–#18
history (phase-2a…2e work) is git-disconnected from it; the old `feature/phase-2*`
and early `claude/*` branches still carry that severed line, which is why they
show alarming "50–64 commits not on the deploy branch" counts. **This is an
artifact, not lost work** — an Aug 9 audit verified the snapshot contains the
full pre-#18 content and that every documented feature since is present at HEAD.
Do not launch a lost-work hunt (or merge one of those stale branches) because of
those counts; content-level comparison, not commit ancestry, is the correct
check against pre-June-17 branches.

## Known pitfalls (hard-won, extended July 4)

- **[OBSOLETE for routine deploys — Apps Script now deploys automatically via
  clasp CI; see "Apps Script deployment" above. Kept as history / emergency
  fallback only.]** Apps Script NEVER auto-syncs from GitHub: paste Code.gs →
  Save → deploy a NEW VERSION of the EXISTING deployment. Wrong choices seen this
  week: new deployment (URL changes, consumers break) and access flipped off
  "Anyone" (consumers get Google's HTML page → "Non-JSON from Apps Script").
- GitHub web editor nests paths when creating files inside a folder — type only
  the filename when already in the folder. Browser re-downloads add " (N)"
  suffixes — drag FOLDERS to the upload page, not loose files.
- Claude Code opens PRs against the repo DEFAULT branch — always verify PR base
  = the deployed branch. PRs #33/#55 were closed for this; #56 was correct.
- Railway variable changes apply only to deployments started after saving.
- PIN inputs have maxlength (Outpatient 6, Dashboard 6) — keep APP_PIN within.

## Next tracks (in priority order)

1. **Outpatient housekeeping**: set GitHub default branch = volta; delete stale
   claude/* branches (incl. dashboard-hKjf9 after a grace period); fill the
   blank TherapistRates rows; review `matchStatus:"no_match"` SessionLog rows.
2. **Outpatient mobile/PWA** ("the phone option"): manifest + service worker +
   letter-E green icons + mobile CSS pass — same recipe as therapists.
3. **Therapists carryovers**: `_cancelFutureBookings` on patient delete (verify
   deployed); live end-to-end quota test (Yarden→Vered); plan-change history.
4. **Logistics**: mobile-responsive, then hardening (חירום auto-approval,
   LockService, deferral wake-up).
5. **Managers + Logistics auth** to the ezone-staffing standard.
6. **Design tokens** across apps; then feature tracks (plan-compliance,
   occupancy forecast, debt aging). Managers bonus distance-to-target: shipped
   July 4.
7. **Dashboard Apps Script cleanup**: strip dead bonus logic (frontend now
   ignores it); keep raw-data endpoints only.
