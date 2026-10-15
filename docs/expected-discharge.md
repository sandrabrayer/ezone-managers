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
- A date can be set, changed, cleared or marked «אין צפי לשחרור» (since 15 Oct 2026, below).

## Clear and «אין צפי לשחרור» (15 Oct 2026)

| State | The row shows | Buttons in the open form |
|---|---|---|
| Date set | `שחרור משוער: dd/m/yy` + «שינוי» | «שמירה», «ביטול», «אין צפי לשחרור», «ניקוי תאריך» |
| «אין צפי» | `אין צפי לשחרור` + «שינוי» | «שמירה» (a date), «ביטול», «ניקוי תאריך» |
| Nothing set | «הגדרת תאריך שחרור» | «שמירה», «ביטול», «אין צפי לשחרור» |

- `POST /api/work` `{ op: 'dischargeSet', …, mode: 'clear' | 'none', expectedDate: '' }`.
  `set` sends no `mode` (the old contract).
- The proxy refuses an unknown mode (`bad_request`), and a date sent with `clear` / `none`
  (`bad_date`).
- `previousDate` is the token the screen showed: `''`, the date, or `none`. A stale token →
  «התאריך עודכן בינתיים».
- The Dashboard APPENDS a row with an empty date and `state` = `cleared` / `none`. Nothing is
  deleted; the last row wins.
- Feeds return `{ date: '', none: true, editedAt, editedBy }` for «אין צפי».
- The buttons appear only when `houseData.expectedDischargeModes` lists `clear` / `none`, so an
  older backend keeps the set/change form.
- Same spinner (on the tapped button), disabled form, one request per tap and Hebrew reasons.
  Success shows «התאריך נוקה ✓» / «נשמר: אין צפי לשחרור ✓».
- Conservative: «ניקוי תאריך» also clears «אין צפי». There is no confirm dialog, because the
  action is reversible and audited.

## Saving — spinner and error reasons (15 Oct 2026)

While a save is in flight:
- «שמירה» shows a spinner and «שומר...»;
- the date, «שמירה» and «ביטול» are disabled (`aria-busy`);
- a second tap, or Enter, is ignored: one request per save, even across a list redraw.

| Outcome | Shows |
|---|---|
| Saved | the picker closes and the row shows «נשמר ✓» |
| Refused or failed | the form comes back open, the picked date kept, with a specific reason |

The spinner stops rotating under `prefers-reduced-motion`. Text is 16px, targets are 44px, the
row wraps at 360px, and only text is written to the DOM.

Reasons (`WorkView.dischargeErrorText`; never a raw code):

| Code (from `/api/work`) | Shown |
|---|---|
| `conflict` | «התאריך עודכן בינתיים — …» (the current value is reloaded) |
| `unknown_op` | «השרת לא עודכן — השמירה עוד לא זמינה. פנו לסנדרה.» |
| `unauthorized` / `upstream_unavailable` | «אין הרשאה לשמור בשרת הנתונים. פנו לסנדרה.» |
| `upstream_auth` | «אין הרשאה לכתוב בשרת הנתונים (נדרש אישור הרשאות). פנו לסנדרה.» |
| `lock_busy` | «השרת עסוק כרגע — נסו שוב בעוד רגע.» |
| `upstream_timeout` | «השרת לא הגיב בזמן — רעננו ובדקו אם התאריך נשמר.» |
| `upstream_unreachable` | «אין חיבור לשרת הנתונים — נסו שוב בעוד רגע.» |
| `upstream_bad_response` / `exception` | «תקלה בשרת הנתונים — נסו שוב. אם זה חוזר, פנו לסנדרה.» |
| HTTP 429 / 401, offline | too many updates / sign in again / no internet |

The proxy (`server.js` `/api/work`):
- **Timeout**: writes (`logAdd`, `logUpdate`, `dischargeSet`) get 30 s, reads keep 15 s.
- **Failure codes**: a timeout → 504 `upstream_timeout`. A network failure → 502
  `upstream_unreachable`. A non-JSON reply → 502, as `upstream_auth` when it is Google's
  authorization / permission page, otherwise `upstream_bad_response`.
- **Exceptions**: an Apps Script `exception` reaches the browser without its message.
- **Server log**: one line, `[work] op=<op> failure=<class> | upstreamError=<code> status=<n>
  ms=<n>`. Never a body, a patient name, the endpoint or the secret.

Backend side (E-Zone-Dashboard #236):
- the writes take the script lock with `tryLock(5000)` → `lock_busy`;
- the editor-run `authorizeSheetsWriteNow()` grants every scope and proves a real sheet write.

## Alerts

The dates drive the «שחרור קרוב» / «דורש עדכון» alerts on «ראשי» (15 Oct 2026):
see `docs/discharge-alerts.md`.
