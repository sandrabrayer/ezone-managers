[CHANGELOG (10).md](https://github.com/user-attachments/files/29659642/CHANGELOG.10.md)
# Changelog

## Unreleased

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
