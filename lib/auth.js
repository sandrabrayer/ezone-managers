'use strict';
/*
 * Full-view access: HMAC cookie token minted from the ?key= link.
 *
 * There is no password and no login screen. Viewers get the app anonymously
 * (patient names redacted, see lib/redact.js); a manager holding the private
 * link `https://<host>/?key=<FULL_VIEW_KEY>` gets an httpOnly cookie carrying
 * the token below, which unlocks the full view.
 *
 * SERVER-ONLY module: must never be served to the browser. server.js exposes
 * only /lib/bonus-eligibility.js explicitly; there is no static mount on lib/.
 *
 * Token format: "<expiresAtMs>.<hmacSha256Hex>" over the payload
 * "managers:<expiresAtMs>" keyed by FULL_VIEW_KEY — so rotating the key in
 * Railway invalidates every cookie already handed out.
 */
const crypto = require('crypto');

const DEFAULT_DAYS = 7;

function signToken(secret, days) {
  if (!secret) throw new Error('FULL_VIEW_KEY is not set');
  const ttlMs = (Number(days) || DEFAULT_DAYS) * 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const payload = `managers:${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expiresAt}.${sig}`;
}

function verifyToken(secret, token) {
  if (!secret || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`managers:${expiresAt}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

/* Constant-time string compare for the ?key= value against FULL_VIEW_KEY.
 * Hashing both sides first keeps the comparison constant-time even when the
 * lengths differ (timingSafeEqual throws on a length mismatch). */
function timingSafeEquals(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signToken, verifyToken, timingSafeEquals, DEFAULT_DAYS };
