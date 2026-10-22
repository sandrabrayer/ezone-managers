'use strict';
/* Direct read-only feed from the Coordinators app (22 Oct 2026, docs/coordinators-feed.md).
 *
 * The coordinators server exposes POST /api/managers-feed (secret-gated, house-scoped, READ-ONLY).
 * THIS server — never the browser — calls it with:
 *   COORDINATORS_FEED_URL     the coordinators base URL (https only; http only for a loopback test)
 *   COORDINATORS_FEED_SECRET  the SAME value as the coordinators' MANAGERS_FEED_SECRET (32+ chars)
 * Either missing or invalid → the feed is OFF (`configured: false`): no request is ever made and
 * every read answers `not_configured` (fail-closed; the app falls back to the Dashboard path where
 * one exists, else shows «עוד לא מחובר»).
 *
 * The house is ALWAYS the one this server decided from the session. Every answer is re-checked:
 * the echoed house must match, and only the known keys of each row are kept (bounded strings).
 * Nothing here logs a value — callers log kind / house / outcome / count only.
 */

const KINDS = new Set(['committees', 'summaries', 'shiftUpdates']);
const HOUSE_KEYS = ['raanana', 'ramot', 'efroni', 'rehab', 'pardes'];
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = new Set(['scheduled', 'held', 'cancelled']);
const SHIFTS = new Set(['בוקר', 'אחר צהריים', 'לילה']);
const TIMEOUT_MS = 10000;

const s = (v, max) => String(v == null ? '' : v).slice(0, max);

function parseConfig(env) {
  const raw = String((env && env.COORDINATORS_FEED_URL) || '').trim().replace(/\/+$/, '');
  const secret = String((env && env.COORDINATORS_FEED_SECRET) || '').trim();
  if (!raw || !secret) return { configured: false, reason: 'unset' };
  let u;
  try { u = new URL(raw); } catch { return { configured: false, reason: 'bad_url' }; }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return { configured: false, reason: 'bad_url' };
  if (u.username || u.password || u.search || u.hash) return { configured: false, reason: 'bad_url' };
  if (secret.length < 32) return { configured: false, reason: 'short_secret' };
  return { configured: true, endpoint: u.origin + u.pathname.replace(/\/+$/, '') + '/api/managers-feed', secret };
}

/* ── per-kind answer guards (only known keys, bounded) ── */
function committeeRow(c) {
  if (!c || typeof c !== 'object' || !ISO_RE.test(String(c.date || ''))) return null;
  const time = String(c.time || '');
  const status = STATUSES.has(String(c.status || '')) ? String(c.status) : 'scheduled';
  return { id: s(c.id, 64), date: String(c.date), time: TIME_RE.test(time) ? time : '', type: s(c.type, 60),
    participants: s(c.participants, 300), patientName: s(c.patientName, 80), status, notes: s(c.notes, 300) };
}
function meetingRow(m) {
  if (!m || typeof m !== 'object' || !ISO_RE.test(String(m.date || ''))) return null;
  const rows = Array.isArray(m.rows) ? m.rows.slice(0, 200).map((r) => ({
    patientName: s(r && r.patientName, 120), weeklyUpdate: s(r && r.weeklyUpdate, 6000), goals: s(r && r.goals, 6000) })) : [];
  return { id: s(m.id, 64), date: String(m.date), title: s(m.title, 120), attendees: s(m.attendees, 600),
    generalNotes: s(m.generalNotes, 8000), finalizedAt: s(m.finalizedAt, 40), rows };
}
function updateRow(r) {
  if (!r || typeof r !== 'object' || !ISO_RE.test(String(r.date || '')) || !SHIFTS.has(String(r.shift || ''))) return null;
  return { id: s(r.id, 64), date: String(r.date), shift: String(r.shift), author: s(r.author, 80), note: s(r.note, 2000),
    createdAt: s(r.createdAt, 40), backdated: r.backdated === true };
}
function shapeAnswer(kind, house, d) {
  if (!d || d.ok !== true || d.house !== house) return null;
  if (kind === 'committees') {
    if (!Array.isArray(d.committees)) return null;
    return { today: ISO_RE.test(String(d.today || '')) ? d.today : '', committees: d.committees.slice(0, 500).map(committeeRow).filter(Boolean) };
  }
  if (kind === 'summaries') {
    if (!Array.isArray(d.meetings)) return null;
    return { month: YM_RE.test(String(d.month || '')) ? d.month : '', meetings: d.meetings.slice(0, 100).map(meetingRow).filter(Boolean) };
  }
  if (!Array.isArray(d.updates)) return null;
  return { from: ISO_RE.test(String(d.from || '')) ? d.from : '', upTo: ISO_RE.test(String(d.upTo || '')) ? d.upTo : '',
    updates: d.updates.slice(0, 300).map(updateRow).filter(Boolean) };
}

/* createCoordFeed(env, fetchImpl) → { configured, reason, read(kind, house, params) }.
 * read() never throws: { ok:true, data } | { ok:false, error } with error one of
 * not_configured · bad_request · unauthorized · unreachable · timeout · bad_response. */
function createCoordFeed(env, fetchImpl) {
  const cfg = parseConfig(env || {});
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  async function read(kind, house, params) {
    if (!cfg.configured) return { ok: false, error: 'not_configured' };
    if (!KINDS.has(kind) || !HOUSE_KEYS.includes(house)) return { ok: false, error: 'bad_request' };
    const p = params || {};
    const body = { kind, house };
    if (kind === 'summaries') { if (!YM_RE.test(String(p.month || ''))) return { ok: false, error: 'bad_request' }; body.month = String(p.month); }
    if (kind === 'shiftUpdates' && p.upTo != null && p.upTo !== '') { if (!ISO_RE.test(String(p.upTo))) return { ok: false, error: 'bad_request' }; body.upTo = String(p.upTo); }
    let res, text;
    try {
      res = await doFetch(cfg.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + cfg.secret },
        body: JSON.stringify(body)
      });
      text = await res.text();
    } catch (err) {
      return { ok: false, error: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'unreachable' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' };
    if (res.status === 503) {
      let code = '';
      try { code = String(JSON.parse(text).error || ''); } catch { code = ''; }
      return { ok: false, error: code === 'not_configured' ? 'not_configured' : 'unreachable' };
    }
    if (res.status !== 200) return { ok: false, error: 'unreachable' };
    let d;
    try { d = JSON.parse(text); } catch { return { ok: false, error: 'bad_response' }; }
    const data = shapeAnswer(kind, house, d);
    return data ? { ok: true, data } : { ok: false, error: 'bad_response' };
  }
  return { configured: cfg.configured, reason: cfg.reason || '', read };
}

module.exports = { createCoordFeed, parseConfig, shapeAnswer, KINDS, TIMEOUT_MS };
