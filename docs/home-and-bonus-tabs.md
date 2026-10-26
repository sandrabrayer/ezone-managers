# «הבית היום» + «בונוס» tabs (October 20, 2026)

## Why

The house page opened with a hero banner that headlined the **settled previous
month**: on October screens it said «ספטמבר: לא זכאי 432/510». Managers read it
as October. Bonus figures were spread over the overview, the house hero, the
«ראשי» dial and the «בונוסים» sub-tab.

## What changed

### Top-level tabs (admins)

| Tab | Content |
|---|---|
| **הבית היום** (default, first) | One card per house: the date and weekday, patients in the house, who is on shift today, sessions, open reminders, and «לבית ←». The all-houses committee and discharge alerts also sit here. |
| **בונוס** | The former «דשבורד»: «חודש בונוס» picker, the KPIs, the winners banner, the occupancy-vs-eligibility chart, the house cards and «תפוסה חודשית (סופי)». |
| 5 house tabs | Unchanged list. |

A house manager still sees only their own house tab. The «הבית היום» and «בונוס»
network panels are hidden for them, as the overview was before. The server
scoping is unchanged (`docs/access.md`).

### House sub-tabs

| Sub-tab | Content |
|---|---|
| **הבית היום** (default, first; was «ראשי») | Committee alerts, discharge alerts, the «הבית היום» card, visits and admissions, the latest events, manpower cost. **No bonus element.** |
| **בונוס** (was «בונוסים») | Every bonus block: the «חודש בונוס» picker, the hero, the «הבונוס שלי» dial and «מה אם?», «הבונוסים החודש», the KPIs, the treatment-days bar and daily chart, entries and exits, «היסטוריית תפוסה», the house's «תפוסה חודשית». |
| מטופלים · צוות ומשמרות · מטפלים · שיחות עם עובדים · אירועים חריגים | Unchanged. |

**Visit counters (26 Oct 2026).** «ביקורים החודש» (הבית היום) and «ביקורים וקליטות החודש» (מטופלים) count only
visits with `inSelectedMonth !== false`; «ביקורים השבוע» and «ביקורים קרובים» use all visits, next-month look-ahead
rows included. Only the boolean `false` excludes a row; an absent field changes nothing
(`WorkView.visitsInSelectedMonth`, `CHANGELOG-visits-in-selected-month.md`).

### The settled-month banner

- **Running month**: the hero is empty and `hidden`. It is not drawn at the top
  of the page, and it does not appear inside «בונוס» either. The running month
  is told by «הבונוסים החודש».
- **A finished month picked in «חודש בונוס»**: the hero appears inside «בונוס»,
  labelled «<month> — סופי: …» (`BonusView.houseHeroView({ selected: true })`,
  unchanged).
- The hero box also shows the house's loading and error states.
- `settledPrevFor_` (the old previous-month hero helper) is removed. The
  winners banner, the KPIs and the house cards keep their settled-previous-month
  blocks. They live in the network «בונוס» tab.

### The «הבית היום» card (`public/work.js`)

`WorkView.todayModel(houseData)` → `todayCardHtml` (house) / `todayAllHtml`
(admin, one card per house). The data source is the existing `houseData`
(`/api/work` → Dashboard `managersWork`). No new request.

| Line | Source | Empty state |
|---|---|---|
| Date + weekday | `houseData.today` (Israel date from the server, validated `YYYY-MM-DD`) | blank, never guessed |
| Patients in the house | `houseData.patients` | `0` (a real count) |
| On shift: בוקר / ערב / לילה | `team.today` (coordinators digest) | every shift is listed; «אין שיבוץ» when nobody is assigned; «טיוטה» for a draft schedule |
| Sessions today | `team.therapistWeek` for today's weekday, by time; untimed last («ללא שעה») | «אין טיפולים משובצים להיום» |
| Open requests | `houseData.followUps` (open follow-ups of the manager's logs); overdue rows are marked «באיחור» | «אין בקשות פתוחות» |

When the coordinators feed is missing (`team.available === false`), the shift
and session tiles show `—` and the honest reason («הנתונים מאפליקציית הרכזים עוד
לא מחוברים.»). No shift row is invented. Every feed value is escaped
(`WorkView.esc`).

## Not changed

- `lib/bonus-eligibility.js`: untouched.
- The running-month figures: the golden snapshot
  `test/fixtures/running-month.snapshot.json` differs **only** in `houseTab.hero`,
  which is now `""`. Every KPI, plan line, card, banner and log is byte-identical.
- No new endpoint, env var, secret or Apps Script change. SW v32 → v33.

## Tests

`test/home-bonus-tabs.test.js`:

- the «בונוס» tab and sub-tab contain every bonus marker, and «הבית היום» contains none;
- tab order and the default tab;
- no banner on load;
- the today card (three shifts, empty states, escaping, an invalid date);
- the admin cards.

`test/app-render.test.js`:

- no banner on load;
- a picked month shows «— סופי» in the hero, and returning to the running month hides it;
- a manager's network panels are hidden.
