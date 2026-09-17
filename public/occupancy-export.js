/* Occupancy CSV export — PURE module. No DOM, no network, no globals.

   Builds the CSV text and the file name for the permanent
   «תפוסה חודשית (סופי)» view. Handing the text to the browser as a file is
   done by public/app.js, so this file stays testable under `node --test`.

   Rules this module enforces (see docs/occupancy-history-view.md →
   "Monthly occupancy (permanent)"):

     1. UTF-8 BOM first, so Excel opens the Hebrew headers correctly.
     2. Hebrew headers, in this fixed order:
        חודש · בית · מנהל/ת · ימי טיפול · ימים בחודש · ממוצע יומי ·
        קיבולת · תפוסה %
     3. The manager name goes through BonusView.safeLabel — a numeric string
        that leaked into the feed's `manager` field never reaches the file.
     4. CSV injection is neutralised: a cell that starts with = + - @, a tab
        or a CR is prefixed with an apostrophe, so a spreadsheet opens it as
        text and never as a formula.
     5. Quotes / commas / newlines are RFC-4180 quoted (" doubled).
     6. ONLY the eight listed columns are written. Any other field of a
        snapshot row (including `capturedAt` and anything the backend may add
        later) is ignored — tests assert it never reaches the file.

   Loaded by the browser as /occupancy-export.js (after /bonus-view.js) and
   by Node for tests (require('../public/occupancy-export')). */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./bonus-view'));
  } else {
    root.OccupancyExport = factory(root.BonusView);
  }
}(typeof self !== 'undefined' ? self : this, function (BV) {
  'use strict';

  var BOM = '﻿';
  var EOL = '\r\n';
  var HEADERS = ['חודש', 'בית', 'מנהל/ת', 'ימי טיפול', 'ימים בחודש', 'ממוצע יומי', 'קיבולת', 'תפוסה %'];

  /* Leading characters a spreadsheet may read as the start of a formula, plus
     the tab / CR that can break a cell out of its column. */
  var INJECTION_PREFIX = /^[=+\-@\t\r]/;

  /* One CSV cell: injection-neutralised first, then quoted when it has to be. */
  function csvCell(value) {
    var s = (value === null || value === undefined) ? '' : String(value);
    if (INJECTION_PREFIX.test(s)) s = "'" + s;
    if (/["',\n\r\t]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* A number as a locale-independent decimal string ('' when not a number) —
     a CSV is read by machines, so no thousands separators and no ₪. */
  function num(value, digits) {
    if (value === null || value === undefined || value === '') return '';
    var n = Number(value);
    if (!isFinite(n)) return '';
    var f = Math.pow(10, digits || 0);
    return String(Math.round(n * f) / f);
  }

  function isYm(ym) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''));
  }

  /* The eight cells of one row, in header order. `row` is a normalised
     occupancy row (see occupancyTable_ in public/app.js); every other
     property on it is deliberately dropped here. */
  function rowCells(row) {
    var r = row || {};
    return [
      isYm(r.month) ? r.month : '',
      BV.safeLabel(r.houseLabel) || '',
      BV.safeLabel(r.manager) || '',
      num(r.treatmentDays, 0),
      num(r.daysInMonth, 0),
      num(r.avgDaily, 1),
      num(r.capacity, 0),
      num(r.occupancyPct, 1)
    ];
  }

  /* The whole file: BOM + header line + one line per row, CRLF-separated. */
  function buildCsv(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var lines = [HEADERS.map(csvCell).join(',')];
    for (var i = 0; i < list.length; i++) {
      lines.push(rowCells(list[i]).map(csvCell).join(','));
    }
    return BOM + lines.join(EOL) + EOL;
  }

  /* occupancy-<from>_to_<to>.csv — `from` is the OLDEST month in the file,
     `to` the newest. A malformed range falls back to a plain name rather
     than writing a broken one. */
  function fileName(from, to) {
    if (!isYm(from) || !isYm(to)) return 'occupancy.csv';
    return 'occupancy-' + from + '_to_' + to + '.csv';
  }

  return {
    BOM: BOM,
    EOL: EOL,
    HEADERS: HEADERS,
    csvCell: csvCell,
    num: num,
    isYm: isYm,
    rowCells: rowCells,
    buildCsv: buildCsv,
    fileName: fileName
  };
}));
