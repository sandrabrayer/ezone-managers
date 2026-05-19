# Changelog

## Unreleased

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
