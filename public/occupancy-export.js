/* Monthly-occupancy CSV export — PURE module. No DOM, no network, no state.

   Feeds the «ייצוא CSV» button of the «תפוסה חודשית (סופי)» card
   (public/app.js → the Monthly occupancy section). Everything that decides
   what lands in the file lives here so it can be tested without a browser:

     - UTF-8 BOM first, so Excel opens the Hebrew headers correctly;
     - the eight Hebrew headers, in a fixed order;
     - CSV-injection escaping: a value starting with = + - @ TAB or CR is
       prefixed with an apostrophe, so a spreadsheet never evaluates feed
       text as a formula;
     - every field is quoted and inner quotes are doubled, so a comma,
       newline or quote in a name cannot shift a column;
     - the manager name goes through BonusView.safeLabel — a numeric string
       (a backend bonus figure that leaked into a text field) is dropped.

   ONLY the fields listed in HEADERS are written. A row object may carry
   anything else; nothing outside that list reaches the file.

   Loaded by the browser as /occupancy-export.js and by Node for tests
   (require('../public/occupancy-export')). */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./bonus-view'));
  } else {
    root.OccupancyExport = factory(root.BonusView);
  }
}(typeof self !== 'undefined' ? self : this, function (BV) {
  'use strict';

  /* Byte-order mark — without it Excel reads the UTF-8 Hebrew as mojibake. */
  var BOM = '﻿';

  /* Excel/Sheets treat a leading one of these as the start of a formula. */
  var INJECTION_CHARS = ['=', '+', '-', '@', '\t', '\r'];
  var INJECTION_RE = /^[=+\-@\t\r]/;

  /* CRLF: the line ending every spreadsheet reads without complaint. */
  var EOL = '\r\n';

  var HEADERS = [
    'חודש',
    'בית',
    'מנהל/ת',
    'ימי טיפול',
    'ימים בחודש',
    'ממוצע יומי',
    'קיבולת',
    'תפוסה %'
  ];

  /* One CSV field: neutralise a formula trigger, then always quote. Quoting
     unconditionally is what makes a comma, a newline, a quote or a leading
     space in an upstream string harmless. */
  function escapeCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (INJECTION_RE.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function finite(v) {
    var n = typeof v === 'number' ? v : Number(v);
    return (typeof v !== 'boolean' && v !== null && v !== '' && isFinite(n)) ? n : null;
  }

  /* Numbers are written ASCII (no thousands separator, dot decimal) — a
     he-IL formatted "1,234" would shift a column even inside quotes when a
     spreadsheet re-parses it. */
  function intText(v) {
    var n = finite(v);
    return n === null ? '' : String(Math.round(n));
  }
  function num1Text(v) {
    var n = finite(v);
    return n === null ? '' : String(Math.round(n * 10) / 10);
  }

  function isYm(v) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  }

  /* The manager column: the feed value sanitised, else the roster fallback
     the caller passes (a hardcoded HOUSE_LABELS name), else empty. */
  function managerText(row) {
    var safe = BV && typeof BV.safeLabel === 'function' ? BV.safeLabel(row.manager) : '';
    if (safe) return safe;
    var fallback = BV && typeof BV.safeLabel === 'function'
      ? BV.safeLabel(row.managerFallback)
      : '';
    return fallback || '';
  }

  /* One data row, in HEADERS order. Nothing is read off `row` but these. */
  function rowCells(row) {
    return [
      isYm(row.month) ? String(row.month) : '',
      typeof row.houseName === 'string' ? row.houseName : '',
      managerText(row),
      intText(row.treatmentDays),
      intText(row.daysInMonth),
      num1Text(row.avgDaily),
      intText(row.capacity),
      num1Text(row.occupancyPct)
    ];
  }

  /* The whole file: BOM + header line + one line per row, CRLF-terminated. */
  function buildCsv(rows) {
    var lines = [HEADERS.map(escapeCell).join(',')];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      lines.push(rowCells(row).map(escapeCell).join(','));
    });
    return BOM + lines.join(EOL) + EOL;
  }

  /* occupancy-<from>_to_<to>.csv — both months validated, so nothing from a
     payload can steer the download name. */
  function fileName(from, to) {
    if (!isYm(from) || !isYm(to)) return 'occupancy.csv';
    return 'occupancy-' + from + '_to_' + to + '.csv';
  }

  return {
    BOM: BOM,
    EOL: EOL,
    HEADERS: HEADERS,
    INJECTION_CHARS: INJECTION_CHARS,
    escapeCell: escapeCell,
    rowCells: rowCells,
    buildCsv: buildCsv,
    fileName: fileName
  };
}));
