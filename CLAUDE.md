# CLAUDE.md — standing rules for autonomous Claude Code work in ezone-managers
Read-only PWA for E-Zone house managers: `server.js` proxies the shared
dashboard Apps Script; the frontend lives in `public/`.

## Repo facts
| Fact | Value |
|---|---|
| Deployed branch (Railway) | `main` — **every PR targets `main`** |
| Production URL | UNKNOWN — ask Sandra once, then record it here |
| Apps Script deploy | **None in this repo.** There is no `apps-script/`, no `Code.gs` and no `.github/workflows/deploy-apps-script.yml`; the backend is the E-Zone-Dashboard Apps Script, out of scope here (see §8). |
| Test command | `npm test` (`node --test`; no network, no secrets) |
| CI | `.github/workflows/test.yml` — Node 18/20/22 on every PR and push to `main` |
| `GET /api/version` | Exists (public, `no-store`, returns `{commit, builtAt}`; `commit` = `RAILWAY_GIT_COMMIT_SHA`, `"unknown"` when unset/invalid) |
| Health check | `GET /healthz` (Railway `healthcheckPath`) |

The Railway-connected branch is not stored in the repo and has been switched
silently before. If anything suggests it is not `main`, stop and ask Sandra.

## 1. Language
- Talk to Sandra in English: concise, action-first.
- Hebrew UI text is RTL. Code, comments and commit messages are in English.

## 2. Every change
- Read `EZONE-ECOSYSTEM-STATUS.md` and every file in `docs/` first; start
  read-only (`npm ci`, `npm test`, establish the baseline).
- Tests added/updated for the change; the full suite green.
- A `CHANGELOG.md` entry under "Unreleased" (what, why, test count delta).
- Docs updated: `README.md`, the relevant `docs/*.md`, and the Managers
  section of `EZONE-ECOSYSTEM-STATUS.md` when behaviour changes.
- Security: no secrets in code or logs; fail-closed auth/config (the server
  refuses to start without `APPS_SCRIPT_URL`); parameterized queries;
  validate every input (query allowlist in `/api/sheets`); `npm audit`
  with **0 high / 0 critical**.

## 3. Git
- Fresh branch off `main` for every task. One PR at a time, base `main`.
- `git add` with explicit paths only (never `git add .` / `-A`). Review
  `git diff --stat` and the full diff before committing.
- Never force-push `main`. Never push to `main` directly.
- Check the PR state before every push: never push to a merged PR's
  branch — restart the branch from the latest `main` instead.

## 4. Merging (authorized)
You may MERGE your own PRs when ALL CI checks are green. Never merge on red
or pending. After merging:
- a. Apps Script: not applicable to this repo (no `apps-script/**` or
  `Code.gs`). If that ever changes and the deploy workflow is
  `workflow_dispatch`, trigger "Deploy Apps Script" on `main` via the GitHub
  API and wait for green. Never paste Code.gs; never create a new Apps
  Script deployment.
- b. Poll `<PROD_URL>/api/version` every 30 s (max 10 min) until `commit`
  equals the merge SHA. If it never matches, the Railway deploy was likely
  SKIPPED — report it. (While the production URL is UNKNOWN, report that
  this step could not run.)
- c. Time 3 requests to the production URL; report status codes and times.

## 5. Append-only / monotonic
- Sheets headers are append-only.
- The service-worker cache version in `public/sw.js` is bumped on any
  change under `public/`, monotonically from the LIVE version.

## 6. Never
- Change Railway settings or variables, or read Railway logs. If a Railway
  change is needed, give Sandra exact click-steps + values.
- Subscribe to PRs or schedule check-ins.
- Add endpoints, env vars or secrets without explicit approval.

## 7. Final report to Sandra
PR link, merge SHA, test count, Apps Script deploy run (if any),
`/api/version` result, timings, and ONLY the manual steps left for her
(with links). No step-by-step narration.

## 8. Scope and app rules
- Apps Script (backend) changes are out of scope: the frontend must work
  with the existing `managersOverview` / `managersHouse` payloads.
- The app is fully OPEN: no password, no access key, no cookie, no login
  screen. Patient names in the entry/exit logs are visible to anyone with
  the URL — a deliberate owner decision of September 12, 2026. Do not add a
  gate, key or redaction layer without Sandra asking; do not remove the rate
  limit, the `noindex` header or `robots.txt`. See `docs/open-access.md`.
- Keep `escapeHtml_` on the patient name in `activityRowHtml` (XSS fix).
- Escape any upstream string rendered into the DOM; validate picker /
  query values before use.

## 9. Bonus model — single sources of truth
- ALL bonus math lives in `lib/bonus-eligibility.js` (tiers by average
  daily occupancy, fixed threshold × 30 treatment-days gate, secured
  floor, quarterly window anchored May 2026).
- ALL bonus wording / month labelling lives in `public/bonus-view.js`
  (settled vs running month, forbidden settled words, days-so-far).
- Backend bonus fields (`qualifies`, `lockedIn`, `projectedBonus`,
  `quarterly*`, `tier`, `amount`, …) are IGNORED; the backend supplies raw
  data only. Tests assert no backend bonus figure reaches the DOM.
- `public/app.js` renders only; every bonus string comes from a
  `BonusView` view object.

## 10. House roster
Five houses (`raanana`, `ramot`, `efroni`, `rehab`, `pardes`). Hardcoded
fallbacks in `HOUSE_LABELS` (`public/app.js`) and `HOUSE_BONUS`
(`lib/bonus-eligibility.js`) must match the status doc roster table;
`test/house-coverage.test.js` and `test/ecosystem-status-doc.test.js` fail
CI on drift. Efroni's backend id is `arfoni`; the frontend key is `efroni`.
