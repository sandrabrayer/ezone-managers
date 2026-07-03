# Remove hardcoded Apps Script URL

## What changed

- `server.js` no longer contains a hardcoded Apps Script `/exec` URL fallback.
  `APPS_SCRIPT_URL` is now a **required** environment variable. If it is not
  set, the server logs an error and exits with code `1` (fail closed).
- `README.md` no longer contains the `/exec` URL. It documents that the
  endpoint is configured exclusively via the `APPS_SCRIPT_URL` env var.

## Why

The previous Apps Script `/exec` URL was committed to the repository and is
therefore exposed in git history. That URL must be considered burned.

## Deploy steps

1. **Create a NEW Apps Script deployment.** Do not reuse the old deployment —
   its URL is compromised via git history. Publish a fresh deployment to get a
   new `/exec` URL.
2. **Set the new URL in Railway** as the `APPS_SCRIPT_URL` environment
   variable for the service.
3. Redeploy. The server will refuse to start until `APPS_SCRIPT_URL` is set.

## Note

The old `/exec` URL remains in git history and cannot be scrubbed from the
running deployment by rotating code alone — it must be decommissioned by
creating the new deployment above.
