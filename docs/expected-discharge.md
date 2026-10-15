# Expected discharge date — «שחרור משוער» (15 Oct 2026)

House tab → «מטופלים» → «מטופלים בבית». Each patient row shows its name and
`מ-<admission date> · יום N`. Under that line:

| State | Shows |
|---|---|
| Date set | `שחרור משוער: dd/m/yy` and a «שינוי» button |
| Not set | a «הגדרת תאריך שחרור» button |

A tap opens a native date picker. It cannot be earlier than the admission date,
and it comes with «שמירה» and «ביטול».

Layout:
- RTL, 16px text (iOS does not zoom), 44px tap targets;
- the row wraps under the patient line on a 360px screen.

## Data path

`POST /api/work` `{ op: 'dischargeSet', house, patientName, entryDate, expectedDate, previousDate }`
→ Dashboard `managersWork` `dischargeSet` (E-Zone-Dashboard PR #230).

The value comes back in the existing house payload: `houseData` returns
`patients[].expectedDischarge` (`{ date, editedAt, editedBy }` or `null`) and
`expectedDischargeSupported: true`. With no flag (an older backend), the list
renders exactly as before.

## Rules

- **Session required** (401 without one).
- **House scope**: a manager is pinned to their own house whatever the
  browser sends; an admin names any house. The Dashboard also checks that the
  patient is in that house today with exactly that admission date.
- **Validation**:
  - the proxy checks the shape first: real `yyyy-MM-dd`, expected ≥ admission,
    and a name of 1–80 characters;
  - the Dashboard checks again: real calendar dates and at most 2 years ahead.
- **Rate limits**: the shared 300 / 15 min per IP, plus a write bucket of
  60 / 15 min per IP for `logAdd`, `logUpdate` and `dischargeSet`.
- **Body limit**: JSON bodies are capped at **16 kb**. That is stricter than
  the 2 MB cap asked for, and the conservative reading: we kept the existing,
  tighter limit.
- **Secret**: the existing fail-closed `MANAGERS_WORK_SECRET`. No new env var
  or Script Property.
- **Audit trail, no silent overwrite**:
  - Dashboard sheet `ManagersExpectedDischarge` is append-only;
  - every edit is a new row: who (name and immutable id), when, and the
    previous value;
  - the screen sends the value it showed as `previousDate`; if someone changed
    it meanwhile, the save is refused («התאריך עודכן בינתיים») and the current
    value is reloaded.
- **Display-only**: no bonus math or bonus wording reads it. This is tested,
  and the golden bonus snapshots are unchanged.
- A date can be set or changed. It cannot be cleared (a conservative reading of
  "set or change").

## Alerts

The dates drive the «שחרור קרוב» / «דורש עדכון» alerts on «ראשי» (15 Oct 2026):
see `docs/discharge-alerts.md`.
