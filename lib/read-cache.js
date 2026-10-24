'use strict';
/* Read cache with request coalescing and stale-while-revalidate (24 Oct 2026, docs/read-cache.md).
 *
 * Pure and dependency-free. One instance holds the copies of every read the managers server makes
 * to the Dashboard Apps Script. The CALLER builds the key (it must include role + person + house
 * + op + month, so a copy can never cross a person or a house).
 *
 *   read(key, loader, { wait, tag })  →  { state, value, at, refreshFailed? }
 *     HIT        a copy younger than freshMs: no upstream call.
 *     STALE      a copy older than freshMs but younger than staleMaxMs: served AT ONCE and ONE
 *                background refresh starts (concurrent callers share it). With `wait: true` the
 *                caller joins that refresh and gets REFRESHED, or STALE + refreshFailed on error.
 *     MISS       nothing usable: the loader runs (concurrent callers share one call). A loader
 *                error is thrown to every waiter; nothing is stored.
 *     REFRESHED  `wait: true` on a stale copy and the refresh succeeded.
 *
 *   invalidate(fn)  drops every copy whose tag passes fn(tag) AND disowns loads in flight for
 *                   them, so a read that started before a write can never store pre-write data.
 *
 * A failed refresh never overwrites a good copy. Copies live in memory only (lost on restart). */

function createReadCache(opts) {
  const o = opts || {};
  const freshMs = Number.isFinite(o.freshMs) ? o.freshMs : 60 * 1000;
  const staleMaxMs = Number.isFinite(o.staleMaxMs) ? o.staleMaxMs : 24 * 3600 * 1000;
  const maxEntries = Number.isInteger(o.maxEntries) && o.maxEntries > 0 ? o.maxEntries : 200;
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const onRefreshError = typeof o.onRefreshError === 'function' ? o.onRefreshError : null;
  const store = new Map();     // key → { value, at, tag }
  const inflight = new Map();  // key → { promise, token, tag }

  function put(key, value, tag) {
    store.delete(key);
    store.set(key, { value, at: now(), tag });
    while (store.size > maxEntries) store.delete(store.keys().next().value);
  }

  function load(key, loader, tag) {
    const existing = inflight.get(key);
    if (existing) return existing.promise;
    const token = {};
    const promise = (async () => {
      try {
        const value = await loader();
        // Disowned by an invalidation while in flight → the caller still gets it, nobody stores it.
        const cur = inflight.get(key);
        if (cur && cur.token === token) put(key, value, tag);
        return value;
      } finally {
        const cur = inflight.get(key);
        if (cur && cur.token === token) inflight.delete(key);
      }
    })();
    inflight.set(key, { promise, token, tag });
    return promise;
  }

  async function read(key, loader, ropts) {
    const r = ropts || {};
    const tag = r.tag;
    const hit = store.get(key);
    const age = hit ? now() - hit.at : Infinity;
    if (hit && age <= freshMs) return { state: 'HIT', value: hit.value, at: hit.at };
    if (hit && age <= staleMaxMs) {
      const refresh = load(key, loader, tag);
      if (!r.wait) {
        refresh.catch((err) => { if (onRefreshError) { try { onRefreshError(key, err); } catch { /* never throws */ } } });
        return { state: 'STALE', value: hit.value, at: hit.at };
      }
      try {
        const value = await refresh;
        const cur = store.get(key);
        return { state: 'REFRESHED', value, at: cur ? cur.at : now() };
      } catch (err) {
        if (onRefreshError) { try { onRefreshError(key, err); } catch { /* never throws */ } }
        return { state: 'STALE', value: hit.value, at: hit.at, refreshFailed: true };
      }
    }
    if (hit) store.delete(key);
    const value = await load(key, loader, tag);
    return { state: 'MISS', value, at: now() };
  }

  function invalidate(fn) {
    let n = 0;
    for (const [k, e] of [...store]) if (fn(e.tag)) { store.delete(k); n++; }
    for (const [k, f] of [...inflight]) if (fn(f.tag)) { inflight.delete(k); n++; }
    return n;
  }

  function clear() { store.clear(); inflight.clear(); }

  return { read, invalidate, clear, size: () => store.size, _store: store };
}

module.exports = { createReadCache };
