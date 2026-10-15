'use strict';
// No sheet reads/writes: this checks the deployed protocol and the shared secret.
const REQUIRED = ['stableActorId', 'scopedReads', 'privateLegacyAdminOnly'];
function createReadiness({ url, secret, configured, fetchImpl = (...args) => fetch(...args), now = Date.now, timeoutMs = 8000 }) {
  let pending = null;
  let checkedAt = -Infinity;
  let ready = false;
  return async function check() {
    if (!configured || !url || secret.length < 24) return false;
    if (pending) return pending;
    if (now() - checkedAt < 10000) return ready;
    pending = Promise.resolve().then(async () => {
      try {
        const response = await fetchImpl(url, {
          method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ action: 'managersWork', op: 'capabilities', secret })
        });
        const data = await response.json();
        ready = response.ok && data && data.ok === true && data.protocol === 2 &&
          Array.isArray(data.capabilities) && REQUIRED.every((c) => data.capabilities.includes(c));
      } catch { ready = false; }
      checkedAt = now();
      pending = null;
      return !!ready;
    });
    return pending;
  };
}
module.exports = { createReadiness };
