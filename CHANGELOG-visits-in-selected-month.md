# Month visit counters ignore next-month look-ahead visits

_October 26, 2026 — frontend only (`public/work.js`, `public/sw.js` v40 → v41).
No server change, no new endpoint, env var or secret._

## Why

The Dashboard `houseData.visits` feed also carries next-month look-ahead rows
(today .. today+14) so the week and upcoming views can show them. The month
counters counted those rows too, so «ביקורים החודש» was too high near the end
of a month. The Dashboard backend is adding an optional boolean
`inSelectedMonth` to each visit: `false` only on a look-ahead row.

## What

| View | Visits used |
|---|---|
| «הבית היום» tile «ביקורים החודש» | only `inSelectedMonth !== false` |
| «מטופלים» card «ביקורים וקליטות החודש» (count + list) | only `inSelectedMonth !== false` |
| «הבית היום» tile «ביקורים השבוע» | ALL visits (look-ahead included) |
| «הבית היום» list «ביקורים קרובים» | ALL visits (look-ahead included) |

- One pure helper, `WorkView.visitsInSelectedMonth(visits)`, does the filter.
- Strict: only the boolean `false` drops a row. A missing field (the Dashboard
  change is not deployed yet), `true`, `null`, `0` or the string `"false"` keep
  the row, so today's behaviour is unchanged until the backend sends the flag.
- The helper never mutates its input; non-array input gives `[]`.

## Security

Display-only filter. Every visit field is still escaped (`esc`) before it is
rendered; a test checks a look-ahead row with markup in its name.

## Tests

`test/visits-in-selected-month.test.js` (8 tests): strict-false helper, purity,
field absent = byte-identical to `true`, `false` excluded from the month tile
and card, `false` kept in the week tile and upcoming list, `true` included
everywhere, escaping, SW bump. **Tests 470 → 478** (477 pass, 1 skipped, 0 fail).
