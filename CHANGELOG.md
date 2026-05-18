# Changelog

## Unreleased

### Fixed
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
