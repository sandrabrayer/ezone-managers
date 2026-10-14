'use strict';
/* Personal-code access for the Managers app (13 Oct 2026).
 *
 * Who may log in comes from Railway variable MANAGER_ACCESS — a JSON array:
 *   [{ "id": "person-oran", "code": "48151623", "name": "אורן", "house": "ramot" },
 *    { "id": "person-sandra", "code": "90210417", "name": "סנדרה", "role": "admin" }, ...]
 * A manager row has a `house` (one of HOUSE_KEYS) and sees only that house.
 * An admin row (role "admin") sees every house. Codes are 6–12 digits.
 *
 * Sessions are a signed cookie: base64url(JSON) + "." + HMAC-SHA256, keyed by
 * a key DERIVED from MANAGERS_WORK_SECRET (no extra variable). The payload
 * carries a fingerprint of the user's code; every request re-checks that the
 * fingerprint is still in MANAGER_ACCESS, so removing or changing a code logs
 * that person out everywhere. Pure functions — no I/O. */
const crypto = require('crypto');

const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab', 'pardes'];
const SESSION_DAYS = 30;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;
const CODE_RE = /^\d{6,12}$/;

function parseAccess(raw) {
  let list;
  try { list = JSON.parse(String(raw || '')); } catch { return { ok: false, error: 'MANAGER_ACCESS is not valid JSON' }; }
  if (!Array.isArray(list) || !list.length) return { ok: false, error: 'MANAGER_ACCESS must be a non-empty array' };
  const users = [];
  const seen = new Set();
  const ids = new Set();
  for (const u of list) {
    const id = String((u && u.id) || '');
    const code = String((u && u.code) || '');
    const name = String((u && u.name) || '').trim().slice(0, 40);
    const role = u && u.role === 'admin' ? 'admin' : 'manager';
    const house = role === 'admin' ? '' : String((u && u.house) || '');
    if (!ID_RE.test(id)) return { ok: false, error: 'every user needs a stable id (3–64 letters, digits, _ or -)' };
    if (ids.has(id)) return { ok: false, error: 'duplicate id' };
    ids.add(id);
    if (!CODE_RE.test(code)) return { ok: false, error: `bad code for ${name || '?'}` };
    if (!name || /[<>]/.test(name)) return { ok: false, error: 'every user needs a plain name' };
    if (role === 'manager' && !HOUSE_KEYS.includes(house)) return { ok: false, error: `bad house for ${name}` };
    if (seen.has(code)) return { ok: false, error: 'duplicate code' };
    seen.add(code);
    users.push({ id, code, name, role, house, fp: fingerprint(code) });
  }
  return { ok: true, users };
}

function fingerprint(code) {
  return crypto.createHash('sha256').update('ezone-managers:' + code).digest('hex').slice(0, 24);
}

function timingSafeEqualStr(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

/* The user whose code matches — every entry is compared (no early exit). */
function findUserByCode(users, code) {
  const c = String(code || '');
  let hit = null;
  for (const u of users) if (timingSafeEqualStr(u.code, c) && !hit) hit = u;
  return CODE_RE.test(c) ? hit : null;
}

function sessionKey(workSecret) {
  return crypto.createHmac('sha256', String(workSecret)).update('ezone-managers-session-v1').digest();
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signSession(user, key, now = Date.now()) {
  const payload = b64u(JSON.stringify({ i: user.id, n: user.name, h: user.house, r: user.role, f: user.fp, e: now + SESSION_DAYS * 86400000 }));
  const sig = b64u(crypto.createHmac('sha256', key).update(payload).digest());
  return `${payload}.${sig}`;
}

/* The live user for a cookie value, or null. */
function readSession(token, key, users, now = Date.now()) {
  const t = String(token || '');
  const dot = t.indexOf('.');
  if (dot < 1) return null;
  const payload = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  const want = b64u(crypto.createHmac('sha256', key).update(payload).digest());
  if (!timingSafeEqualStr(sig, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.e !== 'number' || p.e < now) return null;
  const u = users.find((x) => x.id === p.i && x.fp === p.f);
  if (!u) return null; // code removed or changed → logged out
  return u;
}

/* May this user see house `key`? */
function canSeeHouse(user, key) {
  return !!user && (user.role === 'admin' || user.house === key);
}

module.exports = { HOUSE_KEYS, SESSION_DAYS, parseAccess, fingerprint, findUserByCode, sessionKey, signSession, readSession, canSeeHouse };
