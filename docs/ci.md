# CI checks

| Workflow | Job | What it checks |
|---|---|---|
| `test.yml` | `test (18.x / 20.x / 22.x)` | `npm test`: the whole suite, no network, no secrets |
| `browser-worker-identity.yml` | `chromium-synthetic` | the worker-identity screens in a real browser, synthetic data |
| `managers-dashboard-source-contract.yml` | `synthetic-contract` | the real Managers HTTP routes against the real Dashboard `Code.gs` (pinned commit), synthetic users and sheets only (`test/managers-backend-integration.test.js`) |

## `synthetic-contract` reads the private Dashboard with a read-only token (25 Nov 2026)

E-Zone-Dashboard is a **private** repository. A workflow in ezone-managers runs with a `GITHUB_TOKEN` that can read
only ezone-managers, so checking out E-Zone-Dashboard failed with *repository not found*. That made PR #84's check red,
although the code passed (the test was run locally against the pinned Dashboard with `TZ=UTC`).

The Dashboard checkout now uses the `DASHBOARD_READ_TOKEN` repository secret. **If the secret is missing or expired, the
check fails.** It is never skipped, so a red check always means something needs attention.

### Create the token (once a year)

1. https://github.com/settings/personal-access-tokens/new
   - Token name: `ezone-managers CI read Dashboard`
   - Expiration: 1 year
   - Repository access: **Only select repositories** → `sandrabrayer/E-Zone-Dashboard`
   - Repository permissions: **Contents: Read-only** (Metadata: Read-only is added automatically). Nothing else.
   - **Generate token** and copy it.
2. https://github.com/sandrabrayer/ezone-managers/settings/secrets/actions/new
   - Name: `DASHBOARD_READ_TOKEN`
   - Secret: the token from step 1 → **Add secret**.

The token can read the Dashboard code and nothing else. GitHub masks it in logs, and `persist-credentials: false` keeps it
out of the checkout's git config. Run locally:
`DASHBOARD_CHECKOUT=/path/to/E-Zone-Dashboard TZ=UTC node --test test/managers-backend-integration.test.js`.
