# CRM redesign — light look, CRM tabs, cards, budget (14 Nov 2026)

## Why

Sandra, 14 Nov 2026:

> «באפליקציה של המנהלים אני רוצה גם לשנות את כל המראה לכזה שדומה עכשיו לכל האפליקציות — הרבה יותר
> כלי לניהול למנהל. לכל מנהל צריך תקציב כוח אדם עם רשימה מעודכנת של העובדים שלו ומה עלות השכר שלהם,
> מי המטופלים בבית היום ומי המטפל שלהם, מתי הם נכנסו לבית ומה תאריך המשוער לשחרור, פרטים מלאים הכל
> בלשוניות כמו CRM רק בצבעים שונים, לשונית הבונוס בסוף, בועדות אפשרות לרשום מה היה בועדה … בשיחות עם
> עובדים צריך גם אפשרות לשיחה שניה או תוצאה … בבונוסים אני רוצה להוסיף אפשרות לבונוס עמידה בתקציב,
> שיבדק פעם ברבעון.»

## What changed

### Look

- **Light theme**, like the newer E-ZONE apps (the Dashboard CRM): a light page, white cards, dark ink, a soft
  shadow. The Managers keep their own accent (plum `#7E1F4F`); the Dashboard CRM uses teal.
- **One colour per tab.** Each house sub-tab has its own colour, filled when active; each work card has a
  coloured top line in its tab's colour.
- Status labels are filled chips that always carry a word, never colour alone.
- The old dark palette was converted mechanically (`rgba(255,255,255,a)` overlays became ink overlays, the pale
  dark-theme text colours became deep tones). A redesign section at the end of `styles.css` sets the final
  look. `test/work-colours.test.js` was rewritten for the light theme. It pins WCAG AA for body, muted and
  accent text on white, for every tab colour, and for every status chip.

### Tabs (the bonus tab is LAST)

| Level | Order |
|---|---|
| Top | הבית היום · the five houses · **בונוס** (last). «📖 מדריך» moved to a top-bar button; its tab stays (hidden) for `#guide` links. |
| House | הבית היום · מטופלים · צוות ומשמרות · מטפלים · **תקציב כוח אדם** (new) · ועדות · שיחות עם עובדים · אירועים חריגים · סיכומי ישיבות · עדכון משמרת · **בונוס** (last) |

### New

| Feature | Where | Data |
|---|---|---|
| **Patient card** — פרטים · טיפול · ועדות · אירועים | «כרטיס מטופל/ת ←» on every patient | `houseData` (patients, coordinators team / therapist week, committees, logs) — no new read |
| Therapist + next committee on every patient row | «מטופלים בבית» | same |
| **Employee card** — פרטים · עלות · שיחות · משוב | «כרטיס ←» in «צוות ומשמרות», names in the budget table | `houseData` + `houseStaffCost` |
| **«תקציב כוח אדם»** — month cost vs budget, budget lines, every worker and their month cost, the quarter | new sub-tab | `houseStaffCost` (new op) + `houseCost` per quarter month |
| **Staff-talk threads** — «+ שיחת המשך» and «✓ רישום תוצאה» on each talk; «מה סוכם» on every talk | «שיחות עם עובדים» | `logAdd staffTalks` with `talkKind` / `parentId` / `outcome` / `agreedActions` |
| **«מה היה בוועדה»** — the form, «📝 מה היה בוועדה» on today's and past committees, the history | «ועדות» + the patient card | new log `committeeNotes` |
| **Quarterly budget-adherence bonus** | «בונוס» card + the quarter card in the budget tab | `BonusEligibility.budgetBonusQuarter` |

### The budget bonus rule (`lib/bonus-eligibility.js`)

- The bonus is checked per **calendar quarter**: Q1 = Jan–Mar … Q4 = Oct–Dec. **Q4 2026 is the first.**
- **Condition:** the house's manpower cost for the quarter is at or below its manpower budget for the quarter.
  Cost is the staffing engine's `projectedTotal`, summed over the 3 months. Budget is the staffing budget,
  summed over the 3 months.
- **Settled** once the quarter has ended. A settled quarter with a month that could not be read, or a month
  without a budget, is «חסרים נתונים». A pass is never guessed.
- **Running quarter:** the forecast uses the months read so far. A month not readable yet borrows the average
  cost and the last budget. The status reads «בדרך לבונוס» or «חריגה צפויה», with no tier wording.
- **Amount and start** (Sandra, 15 Nov 2026): **6,000 ₪ per quarter, from Q1 2027** —
  `BUDGET_BONUS_RULES = [{ from: '2027-01', amount: 6000 }]`. This replaced the 14 Nov placeholder
  (`{ from: '2026-10', amount: null }`), which had never judged a settled quarter. Q4 2026 is not a bonus
  quarter: its months are shown, with «הבונוס הרבעוני מתחיל ברבעון 1 2027 — 6,000 ₪». From now on, add rules and
  never edit one a settled quarter used. The bonus is not part of the monthly «מה אם?» total.
- **December 2026, one-off — 2,500 ₪** (Sandra, 15 Nov 2026: «ללא קשר עבור חודש דצמבר אם תהיה עמידה ביעד של חודש זה
  יקבלו 2500»): `BUDGET_MONTH_BONUSES = [{ month: '2026-12', amount: 2500 }]`, judged by `budgetBonusMonth`.
  - Earned when December's manpower cost is at or below December's budget (the target).
  - It is independent of the quarterly bonus.
  - It is settled after December ends. Missing data is never a pass.
  - It is shown from October 2026 to March 2027, in the «בונוס» card and in «תקציב כוח אדם».

### «עלות אוקטובר 2026 מול היעד החודשי» (15 Nov 2026, real October cost since 16 Nov 2026)

- The first card of «תקציב כוח אדם»: October 2026 manpower cost, the monthly target from November 2026, the saving.
- **October** is the staffing feed's `houseCost` for 2026-10: the payroll report and the invoices, shared
  freelancers included, without the managers' and coordinators' bonuses. The staffing app's card prices October
  with the same inputs, so both apps show one number. `work.js` asks for 2026-10 in every quarter.
- **Target** is fixed, from the action-plan table, the same as ezone-staffing `TARGET_PLAN`:
  רמות 265,000 · עפרוני 205,000 · ריהאב 170,000 · הפרדס 150,000 · רעננה אשר 80,000.
  It lives in `lib/october-target.js`, server-only; `server.js` adds `octoberTarget` to the `houseStaffCost`
  reply for the session's house.
- No October cost from the feed → the target and a plain note, never a number.
- To change a target, change it in ezone-staffing first, then here, and update `test/october-target.test.js`.

### «חיסכון צפוי מסיומי עבודה» (16 Nov 2026)

- A card under the month cost of «תקציב כוח אדם», shown only when someone in the house finishes.
- It reads `staff.ending { count, monthlySaving, savingThisMonth, savingNextMonth }` and `endDate` on each
  worker from the `houseStaffCost` reply. The staffing app computes them (`CostEngine.endingForecast`,
  ezone-staffing `docs/house-split-and-ending-forecast.md`); the Dashboard re-validates and passes on the
  caller's house only.
- The month cost above the card is already charged to the end date. From the month after the end, the
  worker's cost leaves the house in full.
- `crm.js` computes nothing: `endingHtml` prints what came. `ending` missing, `null` or with `count` 0 → no card.
- The workers table adds a «מסיים/ת» chip with the date; the employee card adds «סיום עבודה בבית».

### Security

- Salary data (`houseStaffCost`) is visible only to the house's manager, Sandra and Ron:
  - The server pins a manager to their own house, and the Dashboard re-validates it.
  - The response is `no-store` and stays out of the service-worker cache (`/api/*` is network-only).
  - Nothing is logged.
- A month on a cost read is checked server-side (`bad_month` 400) before anything goes upstream.
- Staff-talk threads stay private: only the author and the admins see them. A follow-up can only hang on a
  first talk the caller can see — the Dashboard enforces this.
- Every feed value is escaped. `crm.js` is pure, with no `innerHTML`, `fetch` or `console`; a test pins this.
- The drawer is text built from escaped strings.

## Everything that existed is still there (checked 14 Nov 2026)

| Before | Now |
|---|---|
| Login: username + personal code; logout; user chip; month tag | unchanged (top bar) |
| «מוצגים נתונים שמורים» notice; footer status | unchanged |
| Top tab «הבית היום» (admin): one card per house, all-houses committee + discharge alerts with filters | unchanged, first tab |
| Top tab «בונוס» (network): month picker, 4 KPIs, winners banner, occupancy-vs-eligibility chart, house cards, «תפוסה חודשית (סופי)» + CSV | unchanged — now the LAST tab |
| Five house tabs; a manager sees only their own | unchanged |
| «מדריך» tab + print | the «📖 מדריך» button in the top bar; guide extended (tabs, cards, threads, committee notes, budget §11) |
| House «הבית היום»: committee alerts, discharge alerts, today card (shifts, sessions, open requests), visits/admissions, expected admissions, latest events, feedback card, manpower-cost card | unchanged |
| House «בונוס»: picker, hero, gauge + «מה אם?», «הבונוסים החודש», KPIs, treatment-days bar + daily chart, entries/exits, occupancy history, monthly occupancy | unchanged (+ the budget-bonus card) — now the LAST sub-tab |
| «מטופלים»: patients + expected discharge (set / clear / «אין צפי»), outpatients, visits and admissions | unchanged (+ therapist, next committee, patient card) |
| «ועדות» (read-only list) | unchanged (+ «מה היה בוועדה») |
| «סיכומי ישיבות», «עדכון משמרת» | unchanged |
| «צוות ומשמרות»: on shift today, 14 days, staff with phones, half-yearly feedback with «בוצע» | unchanged (+ employee card) |
| «מטפלים»: therapists, workdays, weekly schedule | unchanged |
| «שיחות עם עובדים» (private), «אירועים חריגים», follow-up reminders strip | unchanged (+ threads, «מה סוכם») |

## Deployment order

1. **ezone-staffing PR** (`getHouseWorkerCostsForManagers`) — auto-deploys its Apps Script on merge.
2. **E-Zone-Dashboard PR** (`houseStaffCost`, threads, `committeeNotes`) — auto-deploys its Apps Script on merge.
3. **This PR.**

Merged in any other order, nothing breaks, but merge the Dashboard first:

- With an older Dashboard, the budget tab says the data is not connected.
- A committee note is refused with a Hebrew reason.
- A follow-up talk is saved as a separate talk.

No Railway variable, secret or Script Property is added.
