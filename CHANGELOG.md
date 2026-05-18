# Changelog

## Unreleased

### Fixed
- **Bonus eligibility now reflects active patients vs. breaking point.**
  The overview's "qualifies for bonus" indicator (used by the houses-above KPI
  and the network spark coloring) previously compared cumulative
  treatment-nights against the monthly target — a metric that drifts during the
  month and could show a house as not-qualifying while occupancy was already at
  or above the breaking point (or vice versa). The fallback now compares
  `patientsNow >= resolveBep(h)`, treating equality at the breaking point as
  qualifying. Explicit backend overrides (`h.bonus.qualifies`, `h.qualifies`)
  are still honored as the source of truth.

### Changed
- Extracted the eligibility decision to `lib/bonus-eligibility.js` so it can be
  exercised by `node --test`. Browser loads it as a UMD via the new `/lib`
  static route in `server.js`.

### Security
- This is a **data-integrity** fix. Bonus eligibility is a financial-status
  indicator shown to house managers; a misclassification — particularly a
  false-positive that displays a house as bonus-eligible when it is not —
  could lead to incorrect compensation expectations or operational decisions.
  No data is exposed and no auth boundary changes; the impact is the
  correctness of a status signal that downstream people rely on.
  Backend-provided eligibility flags remain authoritative and are not
  overridden by the local fallback.
