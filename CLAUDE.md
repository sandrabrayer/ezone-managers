# CLAUDE.md — standing rules for Claude Code sessions in ezone-managers
Read-only PWA for E-Zone house managers: `server.js` proxies the shared
dashboard Apps Script; the frontend lives in `public/`.

## 1. Before any code work
- Read `EZONE-ECOSYSTEM-STATUS.md` (ecosystem ground truth) and every file
  in `docs/` first. They describe the shipped state, pitfalls and rules.
- Verify in the Railway dashboard that the deployed branch is `main` before
  cloning or patching. It is not stored in the repo and has been switched
  silently before.
- Start with a read-only investigation: read the code, run `npm test`,
  establish the baseline. Only then change anything.

## 2. Branching and PRs
- Fresh branch off `main` for every task. One PR at a time, targeting `main`.
- Never push to `main`. Never merge. Sandra reviews and merges manually.
- `git add` with explicit paths only (never `git add .` / `-A`).
- Review the full diff (`git diff --stat`, then the diff) before committing.
- After opening a PR do NOT subscribe to it, watch it, or schedule
  check-ins. Report once (files changed, test count, PR link) and end.
- If the PR for the current branch has already merged, restart the branch
  from the latest `main`; never stack commits on merged history.

## 3. Every PR must include
- A `CHANGELOG.md` entry under "Unreleased" (what, why, test count delta).
- Tests: `npm test` (`node --test`, no network, no secrets) green, with
  new tests for the change.
- Docs updated: `README.md`, the relevant `docs/*.md`, and the Managers
  section of `EZONE-ECOSYSTEM-STATUS.md` when behaviour changes.
- Service-worker cache version bump in `public/sw.js` whenever anything
  under `public/` changes.

## 4. Security and scope
- No new endpoints, env vars or secrets without explicit approval.
- Apps Script (backend) changes are out of scope for Code sessions —
  the frontend must work with the existing `managersOverview` /
  `managersHouse` payloads.
- `lib/auth.js` is server-only and must never be served over HTTP;
  `/api/sheets` stays gated behind the HMAC session token.
- Escape any upstream string rendered into the DOM; validate picker /
  query values before use.

## 5. Bonus model — single sources of truth
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

## 6. House roster
Five houses (`raanana`, `ramot`, `efroni`, `rehab`, `pardes`). Hardcoded
fallbacks in `HOUSE_LABELS` (`public/app.js`) and `HOUSE_BONUS`
(`lib/bonus-eligibility.js`) must match the status doc roster table;
`test/house-coverage.test.js` and `test/ecosystem-status-doc.test.js` fail
CI on drift. Efroni's backend id is `arfoni`; the frontend key is `efroni`.
