# CI checks

| Workflow | Job | What it checks |
|---|---|---|
| `test.yml` | `test (18.x / 20.x / 22.x)` | `npm test`: the whole suite, no network, no secrets |
| `browser-worker-identity.yml` | `chromium-synthetic` | the worker-identity screens in a real browser, synthetic data |
| `managers-dashboard-source-contract.yml` | `synthetic-contract` | the real Managers HTTP routes against the real Dashboard `Code.gs` (pinned commit), synthetic users and sheets only (`test/managers-backend-integration.test.js`) |

## `synthetic-contract` reads the private Dashboard with a read-only deploy key (25 Nov 2026)

E-Zone-Dashboard is a **private** repository. A workflow in ezone-managers runs with a `GITHUB_TOKEN` that can read
only ezone-managers, so checking out E-Zone-Dashboard failed with *repository not found*. That made PR #84's check red,
although the code passed (the test was run locally against the pinned Dashboard with `TZ=UTC`).

The Dashboard checkout now uses a **read-only deploy key** of E-Zone-Dashboard. Its private half is the
`DASHBOARD_DEPLOY_KEY` secret in ezone-managers. **If the secret is missing or wrong, the check fails.** It is never
skipped, so a red check always means something needs attention. (A fine-grained personal token was the first plan; GitHub's
token pages kept answering 500 on 25 Nov 2026. A deploy key is narrower anyway: one repository, read-only, no expiry to track.)

### Set up the key (once), on Windows

1. PowerShell (Start → type `PowerShell` → Enter), then paste:
   `ssh-keygen -t ed25519 -C "ezone-managers CI" -f "$env:USERPROFILE\ezone-ci-key"`
   Press **Enter** twice when it asks for a passphrase (no passphrase).
2. Copy the PUBLIC key: `Get-Content "$env:USERPROFILE\ezone-ci-key.pub" | Set-Clipboard`
   → https://github.com/sandrabrayer/E-Zone-Dashboard/settings/keys/new
   - Title: `ezone-managers CI (read-only)`
   - Key: paste
   - **Leave «Allow write access» unticked** → **Add key**.
3. Copy the PRIVATE key: `Get-Content "$env:USERPROFILE\ezone-ci-key" -Raw | Set-Clipboard`
   → https://github.com/sandrabrayer/ezone-managers/settings/secrets/actions/new
   - Name: `DASHBOARD_DEPLOY_KEY`
   - Secret: paste → **Add secret**.
4. Delete the local copies: `Remove-Item "$env:USERPROFILE\ezone-ci-key", "$env:USERPROFILE\ezone-ci-key.pub"`

The key can only read E-Zone-Dashboard. GitHub masks secrets in logs, and `persist-credentials: false` keeps it out of the
checkout's git config. To revoke: delete it at https://github.com/sandrabrayer/E-Zone-Dashboard/settings/keys.
Run locally: `DASHBOARD_CHECKOUT=/path/to/E-Zone-Dashboard TZ=UTC node --test test/managers-backend-integration.test.js`.
