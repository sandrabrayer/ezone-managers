# «מדריך» — the managers usage guide (October 20, 2026)

A static top-level tab, **«מדריך»**, the last tab, open to **every role**. A house
manager keeps it next to their house tab: `applyRole_` does not hide it, and
`allowedTab_` lets them open it. It has the same structure as the coordinators
`public/guide.html`: a title, a table of contents, short numbered sections, notes,
a table, and print / PDF.

## Sections

1. The app's tabs.
2. «הבית היום»: how to read it. `—` means the data did not arrive; it is not zero.
3. «בונוס»: how it is calculated (October 2026 rules) and how to read it:
   the picker, dial, plan, and days so far vs projection.
4. Patients, expected discharge, alerts.
5. Team, shifts, therapists: read-only, from the coordinators app.
6. Staff talks, events, follow-ups.
7. Committees: set by the coordinators, read-only here. Marked «בקרוב» until PR 3 ships.
8. Meeting summaries: read-only, own house, a month filter. «בקרוב» until PR 4.
9. Half-yearly feedback reminders. «בקרוב» until PR 5.
10. Login and privacy.

Each later PR removes the «בקרוב» tag of the section it ships and updates the text
when the behaviour differs.

## Safety

- The guide is static text only: no feed value, no `<script>`, no inline handler, and
  only in-page `#g-…` links.
- The print button is wired from `app.js`, because the CSP is `script-src 'self'`.

## Drift guard

`test/guide.test.js` checks the bonus table against the LATEST `RULE_SETS` entry in
`lib/bonus-eligibility.js`:

- the threshold;
- the gate (threshold × 30);
- full occupancy;
- the 2,000 / 3,000 / 250 / 300 amounts.

A rule change without a guide update fails CI.
