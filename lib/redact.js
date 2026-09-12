'use strict';
/*
 * Patient-name redaction for the ANONYMOUS (no-key) view.
 *
 * The managers feed carries an `activity` array of admissions/discharges:
 *   { date: '2026-09-03', kind: 'entry' | 'exit', name: '<patient name>' }
 * `name` there is the patient's name straight out of the Patients sheet
 * (dashboard Apps Script → readPatientsForBonus_). It must never leave this
 * server unless the caller proved the full-view key.
 *
 * Counts, dates and kinds stay: the bonus dashboard reads fine without the
 * names, and the UI labels each redacted row "מוסתר" (public/app.js) instead
 * of leaving a blank gap — which is why the flag `nameHidden: true` is set
 * rather than the key simply being dropped.
 *
 * A house's own `name` / `manager` are staff-level labels, not patient data,
 * and are deliberately left alone.
 */

/* An activity row is an admission/discharge record. Matched by shape, not by
 * where it sits in the payload, so a backend that moves or nests the array
 * still gets redacted. */
function isActivityRow(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) &&
    (v.kind === 'entry' || v.kind === 'exit');
}

function hideName(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return;
  if (!('name' in row)) return;
  delete row.name;
  row.nameHidden = true;
}

/* Walks the whole payload and strips every patient name, in place.
 * Two independent rules, so a shape change upstream can't silently unredact:
 *   1. any object that looks like an activity row (kind entry/exit);
 *   2. every item of any array under an `activity` key, whatever its shape. */
function redactPatientNames(value, seen) {
  seen = seen || new Set();
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (isActivityRow(item)) hideName(item);
      redactPatientNames(item, seen);
    });
    return value;
  }

  if (isActivityRow(value)) hideName(value);

  for (const [key, child] of Object.entries(value)) {
    if (key === 'activity' && Array.isArray(child)) child.forEach(hideName);
    redactPatientNames(child, seen);
  }
  return value;
}

/* Redacts a raw upstream JSON string. Returns null when the body is not JSON
 * — the caller must then fail closed rather than pass unknown bytes through,
 * since an un-parseable body cannot be proven free of patient names. */
function redactJsonText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return JSON.stringify(redactPatientNames(parsed));
}

module.exports = { redactPatientNames, redactJsonText };
