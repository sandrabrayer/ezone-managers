'use strict';
/*
 * ezone-managers server — auth brought to the ezone-staffing standard:
 *   - fail-closed startup (all secrets required in production)
 *   - PIN login (timing-safe compare) with per-IP rate limiting
 *   - HMAC-signed session tokens (Bearer) required on /api/sheets
 *   - lib/ is NOT statically mounted; only bonus-eligibility.js is exposed
 */
const express = require('express');
const path = require('path');

const { signToken, verifyToken, checkPin } = require('./lib/auth');

const PORT = Number(process.env.PORT) || 3000;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const APP_PIN = process.env.APP_PIN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 7;

function fatal(msg) {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

// Fail closed in production. Tests require() this module with NODE_ENV=test.
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  if (!APPS_SCRIPT_URL) fatal('APPS_SCRIPT_URL is required');
  if (!APP_PIN) fatal('APP_PIN is required');
  if (!SESSION_SECRET) fatal('SESSION_SECRET is required');
  if (SESSION_SECRET.length < 32) fatal('SESSION_SECRET must be at least 32 chars');
}

const app = express();
app.disable('x-powered-by');
// Behind Railway's proxy: without this, req.ip is the proxy's IP for ALL
// users, so the login rate limit becomes one shared bucket for everyone.
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

// ---- static: public assets only; gate nothing here (index is the SPA shell,
// the login overlay is enforced client-side and the data API server-side) ----
app.use(express.static(path.join(__dirname, 'public')));

// Expose ONLY the client-shared bonus module. Server-only lib/auth.js must
// never be reachable over HTTP (no static mount on lib/).
app.get('/lib/bonus-eligibility.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'lib', 'bonus-eligibility.js'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- login (rate-limited, timing-safe) ----
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;

function rateLimitLogin(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_WINDOW_MS;
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count <= LOGIN_MAX;
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!rateLimitLogin(ip)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.' });
  }
  const pin = (req.body && req.body.pin) || '';
  if (!checkPin(String(pin), APP_PIN)) {
    return res.status(401).json({ error: 'קוד שגוי' });
  }
  const token = signToken(SESSION_SECRET, SESSION_DAYS);
  res.json({ token, expiresInDays: SESSION_DAYS });
});

// ---- auth middleware ----
function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1] : '';
  if (!verifyToken(SESSION_SECRET, token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ---- Apps Script proxy (GET with query params — unchanged, now gated) ----
const ALLOWED_QUERY_KEYS = new Set(['action', 'house', 'month']);

app.get('/api/sheets', requireAuth, async (req, res) => {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (ALLOWED_QUERY_KEYS.has(k) && typeof v === 'string') qs.set(k, v);
    }
    const s = qs.toString();
    const target = `${APPS_SCRIPT_URL}${s ? `?${s}` : ''}`;

    const upstream = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'application/json' }
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set('Cache-Control', 'no-store');
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.type(ct).send(text);
  } catch (err) {
    console.error('Proxy error:', err && err.message);
    res.status(502).json({ error: 'upstream_error', message: String((err && err.message) || err) });
  }
});

// ---- 404 for unknown /api routes (before SPA fallback) ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// ---- SPA fallback ----
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ezone-managers listening on 0.0.0.0:${PORT}`);
  });
}

module.exports = { app, _loginAttempts: loginAttempts };
