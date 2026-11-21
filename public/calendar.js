/* «📅 יומן» — the house's week in one place (21 Nov 2026, docs/week-calendar.md).
 *
 * Sandra: «גם באפליקציה צריך להיות לו יומן של השבוע עם כל הפגישות או אירועים אחרים».
 * One sub-tab, Sunday → Saturday, with everything dated the app already knows about:
 * intake meetings, committees, expected admissions, expected discharges, follow-up
 * reminders, half-yearly feedback and (behind a filter) the therapists' sessions.
 *
 * No new request, endpoint or stored value: the items come from the houseData the
 * work tabs already loaded (work.js) and the meetings the «פגישות קליטה» tab already
 * loaded (meetings.js). The server decided the house for both. A source that is not
 * available is named in an amber line — never an empty day pretending to be the truth.
 *
 * Also here: «הוספה ליומן» for an intake meeting (a Google Calendar link and an .ics
 * file), built with the Dashboard invitation's privacy rule: the lead's FIRST name only.
 *
 * Pure builders on top (unit-tested in test/week-calendar.test.js), DOM wiring at the
 * bottom. Every feed value is escaped. ES5, like work.js and meetings.js. */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  /* A real calendar day: 2026-02-30 is not one. Calendar arithmetic only — never a
   * timezone: the dates are the house's own wall-calendar days. */
  function isIso(s) {
    var m = ISO_RE.exec(String(s == null ? '' : s));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function addDays(iso, n) {
    var m = ISO_RE.exec(String(iso || ''));
    if (!m) return '';
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
  }
  function weekdayIdx(iso) {
    var m = ISO_RE.exec(String(iso || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : -1;
  }
  /* The Sunday that opens the week of `iso` (the Israeli week). */
  function weekStartOf(iso) {
    var wd = weekdayIdx(iso);
    return wd < 0 ? '' : addDays(iso, -wd);
  }
  function dm(iso) { var m = ISO_RE.exec(String(iso || '')); return m ? +m[3] + '/' + +m[2] : ''; }
  function dmy(iso) { var m = ISO_RE.exec(String(iso || '')); return m ? +m[3] + '/' + +m[2] + '/' + m[1] : ''; }
  function cleanTime(t) { var s = String(t == null ? '' : t).trim(); return TIME_RE.test(s) ? s : ''; }

  /* ── the kinds of item: icon + words always, colour only on top of them ── */
  var TYPES = {
    meeting:   { icon: '🤝', label: 'פגישות קליטה', one: 'פגישת קליטה', sub: 'meetings', on: true },
    committee: { icon: '📋', label: 'ועדות', one: 'ועדה', sub: 'committees', on: true },
    admission: { icon: '➕', label: 'קליטות צפויות', one: 'קליטה צפויה', sub: 'patients', on: true },
    discharge: { icon: '🚪', label: 'שחרורים צפויים', one: 'שחרור צפוי', sub: 'patients', on: true },
    followUp:  { icon: '🔔', label: 'תזכורות מעקב', one: 'תזכורת מעקב', sub: 'events', on: true },
    feedback:  { icon: '📝', label: 'משובים חצי־שנתיים', one: 'משוב חצי־שנתי', sub: 'team', on: true },
    session:   { icon: '🩺', label: 'טיפולים', one: 'טיפול', sub: 'therapists', on: false }
  };
  var TYPE_ORDER = ['meeting', 'committee', 'admission', 'discharge', 'followUp', 'feedback', 'session'];
  var LOG_LABEL = { familyCalls: 'שיחה עם משפחה', staffTalks: 'שיחה עם עובד/ת', events: 'סוגיה תפעולית' };
  var STAGE_LABELS = { new: 'ליד', visit: 'נקבע ביקור', paid: 'שילם מקדמה', entry: 'נכנס לבית', waitlist: 'רשימת המתנה' };
  var COMMITTEE_STATUS = { cancelled: 'בוטלה', postponed: 'נדחתה', done: 'התקיימה' };
  /* What the meetings feed covers (docs/meeting-reports.md): 30 days back, 14 ahead. */
  var MEETINGS_BACK_DAYS = 30, MEETINGS_AHEAD_DAYS = 14;
  /* How far the week arrows go: the past the feeds still carry, and two months ahead. */
  var WEEKS_BACK = 4, WEEKS_AHEAD = 8;

  function defaultFilters() {
    var f = {};
    TYPE_ORDER.forEach(function (t) { f[t] = TYPES[t].on; });
    return f;
  }

  var WV = root.WorkView || (typeof require === 'function' ? require('./work.js') : null);
  var MV = root.MeetingsView || (typeof require === 'function' ? require('./meetings.js') : null);

  /* Every dated item of the house, from what the app already holds. Pure.
   *   d        — houseData (work.js), or null while it loads
   *   meetings — { state: 'ok' | 'loading' | 'not_connected' | 'error', list: [...] }
   * Returns { today, items: [{ type, date, time, title, sub, link, flags, id }],
   *           missing: { type: 'why' } } — `missing` names a source that is not available. */
  function collect(d, meetings, opts) {
    d = d || {};
    var o = opts || {};
    var today = isIso(d.today) ? d.today : (isIso(o.today) ? o.today : '');
    var items = [], missing = {};
    var push = function (it) { if (it && isIso(it.date)) items.push(it); };

    // 🤝 intake meetings — the meetings feed; until it is connected, the house's visits list.
    var ms = meetings || { state: 'loading', list: [] };
    if (ms.state === 'ok') {
      (ms.list || []).forEach(function (m) {
        if (!m || !m.id) return;
        var r = m.report || null;
        var pending = !r && !!today && m.visitDate < today;
        push({
          type: 'meeting', id: String(m.id), date: m.visitDate, time: cleanTime(m.visitTime), title: String(m.name || ''),
          sub: (m.meetingWith ? 'עם ' + m.meetingWith : '') + (r && MV ? (m.meetingWith ? ' · ' : '') + MV.reportSummary(r) : ''),
          link: { sub: 'meetings' },
          flags: { mine: !!(MV && MV.scheduledWithViewer(m)), pending: pending, reported: !!r, invite: String(m.invite || ''), canAdd: !r && !!today && m.visitDate >= today },
          raw: m
        });
      });
    } else if (Array.isArray(d.visits)) {
      d.visits.forEach(function (v) {
        if (!v) return;
        push({ type: 'meeting', id: '', date: v.date, time: cleanTime(v.time), title: String(v.name || ''), sub: v.meetingWith ? 'עם ' + v.meetingWith : '', link: { sub: 'patients', card: 'wk-visits' }, flags: {} });
      });
      if (ms.state !== 'loading') missing.meeting = 'הדיווח על פגישות עוד לא מחובר — מוצגים הביקורים מרשימת הבית.';
    } else if (ms.state !== 'loading') {
      missing.meeting = 'פגישות הקליטה לא מחוברות כרגע.';
    }

    // 📋 committees — set by the coordinators; information only.
    var cs = WV ? WV.committeesState(d) : { ok: false, text: '' };
    if (cs.ok) {
      cs.items.forEach(function (c) {
        if (!c) return;
        var status = COMMITTEE_STATUS[c.status] ? c.status : '';
        push({ type: 'committee', id: '', date: c.date, time: cleanTime(c.time), title: String(c.type || 'ועדה') + (c.patientName ? ' · ' + c.patientName : ''),
          sub: status ? COMMITTEE_STATUS[status] : '', link: { sub: 'committees' }, flags: { cancelled: status === 'cancelled' } });
      });
    } else if (d.today) {
      missing.committee = cs.text || 'הוועדות לא זמינות כרגע.';
    }

    // ➕ expected admissions (the Dashboard's leads with an entry date).
    if (Array.isArray(d.expectedAdmissions)) {
      d.expectedAdmissions.forEach(function (x) {
        if (!x) return;
        push({ type: 'admission', id: '', date: x.date, time: '', title: String(x.name || ''), sub: STAGE_LABELS[x.stage] || '', link: { sub: 'patients', card: 'wk-visits' }, flags: {} });
      });
    } else if (d.today) {
      missing.admission = 'קליטות צפויות יופיעו אחרי עדכון השרת.';
    }

    // 🚪 expected discharges — the dates the manager entered on the patients list.
    if (d.expectedDischargeSupported === true) {
      (d.patients || []).forEach(function (p) {
        if (!p || !WV || WV.dischargeStateOf(p) !== 'date') return;
        push({ type: 'discharge', id: '', date: p.expectedDischarge.date, time: '', title: String(p.name || ''), sub: '', link: { sub: 'patients' }, flags: {} });
      });
    } else if (d.today) {
      missing.discharge = 'שחרורים צפויים יופיעו אחרי עדכון השרת.';
    }

    // 🔔 follow-up reminders of the three logs. The server already returns only the rows
    // this person may see (a staff talk is private to its author and the admins).
    if (WV && d.logs) {
      Object.keys(WV.LOGS).forEach(function (k) {
        (d.logs[k] || []).forEach(function (r) {
          if (!r || !r.followUpDate || r.followUpDone) return;
          push({ type: 'followUp', id: '', date: r.followUpDate, time: '', title: WV.LOGS[k].head(r) || '', sub: LOG_LABEL[k] || '', link: { sub: k },
            flags: { overdue: !!today && r.followUpDate < today } });
        });
      });
    }

    // 📝 half-yearly feedback — on the day it is due.
    var fm = WV ? WV.feedbackModel(d) : null;
    if (fm) {
      fm.items.forEach(function (x) {
        if (!x || !x.due || x.status === 'unknown') return;
        push({ type: 'feedback', id: '', date: x.due, time: '', title: String(x.name || ''), sub: x.status === 'overdue' ? 'באיחור' : '', link: { sub: 'team', card: 'wk-feedback' }, flags: { overdue: x.status === 'overdue' } });
      });
    } else if (d.today) {
      missing.feedback = 'תזכורות המשוב לא זמינות כרגע.';
    }

    // 🩺 the therapists' weekly sessions — this week only (the schedule is «this week» in the feed).
    var t = d.team && d.team.available ? d.team : null;
    if (t && today) {
      var ws = weekStartOf(today);
      (t.therapistWeek || []).forEach(function (r) {
        if (!r || !(r.dayOfWeek >= 0 && r.dayOfWeek <= 6)) return;
        push({ type: 'session', id: '', date: addDays(ws, Math.floor(r.dayOfWeek)), time: cleanTime(r.time), title: String(r.therapistName || ''), sub: r.patientName ? 'עם ' + r.patientName : '', link: { sub: 'therapists' }, flags: {} });
      });
    } else if (d.today) {
      missing.session = 'לוח המטפלים לא מחובר כרגע.';
    }
    return { today: today, items: items, missing: missing };
  }

  function sortKey(it) {
    return (it.time || '99:99') + ' ' + ('0' + TYPE_ORDER.indexOf(it.type)).slice(-2) + ' ' + it.title;
  }

  /* The week of `weekStart` (any day of it works). Pure.
   * Returns { weekStart, weekEnd, today, isThisWeek, days: [{ date, weekday, isToday, isPast, items }],
   *           counts: { type: n }, shown, total, canPrev, canNext }. */
  function weekModel(col, weekStart, filters) {
    var c = col || { today: '', items: [], missing: {} };
    var f = filters || defaultFilters();
    var today = c.today || '';
    var base = isIso(weekStart) ? weekStart : today;
    var ws = clampWeek(weekStartOf(base), today);
    var we = addDays(ws, 6);
    var counts = {}, shown = 0, total = 0, days = [], byDay = {};
    TYPE_ORDER.forEach(function (t) { counts[t] = 0; });
    (c.items || []).forEach(function (it) {
      if (!TYPES[it.type] || it.date < ws || it.date > we) return;
      counts[it.type]++; total++;
      if (f[it.type] === false) return;
      shown++;
      (byDay[it.date] = byDay[it.date] || []).push(it);
    });
    for (var i = 0; i < 7; i++) {
      var date = addDays(ws, i);
      var list = (byDay[date] || []).slice().sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0; });
      days.push({ date: date, weekday: WEEKDAYS[i], isToday: !!today && date === today, isPast: !!today && date < today, items: list });
    }
    var range = weekRange(today);
    return { weekStart: ws, weekEnd: we, today: today, isThisWeek: !!today && ws === weekStartOf(today), days: days, counts: counts, shown: shown, total: total,
      canPrev: !!range.min && ws > range.min, canNext: !!range.max && ws < range.max };
  }
  /* The weeks the arrows may reach. */
  function weekRange(today) {
    var ws = weekStartOf(today);
    return ws ? { min: addDays(ws, -7 * WEEKS_BACK), max: addDays(ws, 7 * WEEKS_AHEAD) } : { min: '', max: '' };
  }
  function clampWeek(ws, today) {
    var r = weekRange(today);
    if (!ws) return weekStartOf(today);
    if (r.min && ws < r.min) return r.min;
    if (r.max && ws > r.max) return r.max;
    return ws;
  }
  /* Whether the displayed week reaches past what the meetings feed carries. */
  function beyondMeetings(wm) {
    if (!wm.today) return '';
    if (wm.weekEnd > addDays(wm.today, MEETINGS_AHEAD_DAYS)) return 'פגישות קליטה מוצגות עד שבועיים קדימה — פגישה מאוחרת יותר תופיע כשתתקרב.';
    if (wm.weekStart < addDays(wm.today, -MEETINGS_BACK_DAYS)) return 'פגישות קליטה מוצגות עד 30 יום אחורה.';
    return '';
  }

  /* ── «הוספה ליומן»: a Google Calendar link and an .ics file for one intake meeting ──
   * Same privacy rule as the Dashboard's invitation: the lead's FIRST name only. */
  var ADD_MINUTES = 60;
  function firstName(name) {
    var t = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t.split(' ')[0].slice(0, 30) : '';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 'yyyyMMddTHHmmss' wall-clock stamp of date + time (+ minutes); '' when either is bad. */
  function localStamp(date, time, plus) {
    var m = ISO_RE.exec(String(date || '')), t = cleanTime(time);
    if (!m || !isIso(date) || !t) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +t.slice(0, 2), +t.slice(3, 5) + (plus || 0)));
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00';
  }
  function addable(m) { return !!(m && isIso(m.visitDate) && cleanTime(m.visitTime)); }
  function addTexts(m) {
    var house = m && m.houseLabel ? 'E-ZONE ' + m.houseLabel : 'E-ZONE';
    var who = firstName(m && m.name);
    return { summary: 'פגישת קליטה · ' + house, location: house,
      description: 'פגישת קליטה' + (who ? ' עם ' + who : '') + '.\nהפרטים המלאים באפליקציית המנהלים.' };
  }
  /* Google's «new event» page. Local times + ctz, so summer / winter time is Google's job. */
  function googleUrl(m) {
    if (!addable(m)) return '';
    var x = addTexts(m);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(x.summary) +
      '&dates=' + localStamp(m.visitDate, m.visitTime, 0) + '/' + localStamp(m.visitDate, m.visitTime, ADD_MINUTES) +
      '&ctz=' + encodeURIComponent('Asia/Jerusalem') +
      '&details=' + encodeURIComponent(x.description) + '&location=' + encodeURIComponent(x.location);
  }
  function icsEscape(v) {
    return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function utf8Len(ch) { var cp = ch.codePointAt(0); return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }
  /* RFC 5545: a line is folded at 75 octets, never inside a character. */
  function fold(line) {
    var out = [], cur = '', len = 0;
    Array.from(String(line)).forEach(function (ch) {
      var n = utf8Len(ch);
      if (len + n > 75) { out.push(cur); cur = ' '; len = 1; }
      cur += ch; len += n;
    });
    out.push(cur);
    return out.join('\r\n');
  }
  /* The .ics text. Times are local with TZID=Asia/Jerusalem and the zone's own rules
   * (the Friday before the last Sunday of March → the last Sunday of October), so both
   * seasons are right. */
  function icsText(m, stampUtc) {
    if (!addable(m)) return '';
    var x = addTexts(m);
    var id = String(m.id == null ? '' : m.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'meeting';
    var lines = [
      'BEGIN:VCALENDAR', 'PRODID:-//E-ZONE//Managers app//HE', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Jerusalem',
      'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'TZNAME:IST', 'END:STANDARD',
      'BEGIN:DAYLIGHT', 'DTSTART:19700327T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23,24,25,26,27,28,29;BYDAY=FR', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'TZNAME:IDT', 'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:ezone-meeting-' + id + '@ezone-dashboard',   // the Dashboard invitation's UID: the same entry, never a second one
      'DTSTAMP:' + (/^\d{8}T\d{6}Z$/.test(String(stampUtc || '')) ? stampUtc : '20260101T000000Z'),
      'DTSTART;TZID=Asia/Jerusalem:' + localStamp(m.visitDate, m.visitTime, 0),
      'DTEND;TZID=Asia/Jerusalem:' + localStamp(m.visitDate, m.visitTime, ADD_MINUTES),
      'SUMMARY:' + icsEscape(x.summary), 'DESCRIPTION:' + icsEscape(x.description), 'LOCATION:' + icsEscape(x.location),
      'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(x.summary), 'TRIGGER:-PT60M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  function icsFileName(m) { return 'ezone-meeting-' + String(m && m.visitDate || '').replace(/[^0-9-]/g, '') + '.ics'; }
  /* The buttons under an upcoming meeting. '' when the meeting has no hour yet. */
  function addHtml(m) {
    if (!addable(m)) return '';
    var sent = m.invite === 'sent';
    return '<div class="cal-add">' + (sent ? '<span class="crm-chip ok cal-invited">📅 נשלח זימון ליומן במייל</span>' : '') +
      '<a class="wk-link cal-add-g" href="' + esc(googleUrl(m)) + '" target="_blank" rel="noopener" data-cal-open>📅 הוספה ליומן Google</a>' +
      '<button type="button" class="wk-link cal-add-ics" data-cal-ics="' + esc(m.id) + '">קובץ ליומן (‎.ics)</button></div>';
  }

  /* ── markup ── */
  function itemHtml(it) {
    var T = TYPES[it.type];
    var fl = it.flags || {};
    var chips = (fl.mine ? '<span class="crm-chip ok">איתך</span>' : '') +
      (fl.pending ? '<span class="crm-chip bad">ממתינה לדיווח</span>' : '') +
      (fl.overdue && it.type !== 'feedback' ? '<span class="crm-chip warn">באיחור</span>' : '') +
      // A coming meeting says it in full beside «הוספה ליומן» (addHtml) — once, not twice.
      (fl.invite === 'sent' && !(fl.canAdd && it.raw && addable(it.raw)) ? '<span class="crm-chip ok">📅 נשלח זימון</span>' : '');
    var go = ' data-go-sub="' + esc(it.link && it.link.sub || T.sub) + '"' + (it.link && it.link.card ? ' data-go-card="' + esc(it.link.card) + '"' : '');
    var h = '<li class="cal-item cal-' + esc(it.type) + (fl.cancelled ? ' is-cancelled' : '') + (fl.pending ? ' is-pending' : '') + '">' +
      '<button type="button" class="cal-go"' + go + ' aria-label="' + esc(T.one + ': ' + it.title + ' — לפתיחה') + '">' +
      '<span class="cal-time">' + esc(it.time || 'כל היום') + '</span>' +
      '<span class="cal-what"><span class="cal-kind"><span aria-hidden="true">' + T.icon + '</span> ' + esc(T.one) + '</span>' +
      '<span class="cal-title">' + esc(it.title) + '</span>' + (it.sub ? '<span class="wk-meta">' + esc(it.sub) + '</span>' : '') + '</span></button>' +
      (chips ? '<span class="cal-chips">' + chips + '</span>' : '');
    if (it.type === 'meeting' && fl.canAdd && it.raw) h += addHtml(it.raw);
    return h + '</li>';
  }
  function dayHtml(day) {
    return '<section class="cal-day' + (day.isToday ? ' is-today' : '') + (day.isPast ? ' is-past' : '') + '"' + (day.isToday ? ' data-cal-today' : '') + '>' +
      '<h3 class="cal-day-head">יום ' + esc(day.weekday) + ' <span class="cal-date">' + esc(dm(day.date)) + '</span>' +
      (day.isToday ? ' <span class="crm-chip ok">היום</span>' : '') + '</h3>' +
      (day.items.length ? '<ul class="cal-list">' + day.items.map(itemHtml).join('') + '</ul>' : '<div class="wk-empty cal-empty">אין אירועים</div>') + '</section>';
  }
  function filtersHtml(wm, filters) {
    return '<div class="cal-filters" role="group" aria-label="מה להציג ביומן">' + TYPE_ORDER.map(function (t) {
      var on = filters[t] !== false;
      return '<button type="button" class="mt-chip cal-filter' + (on ? ' is-on' : '') + '" data-cal-filter="' + t + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span aria-hidden="true">' + TYPES[t].icon + '</span> ' + esc(TYPES[t].label) + ' <span class="cal-count">(' + wm.counts[t] + ')</span></button>';
    }).join('') + '</div>';
  }
  /* The whole «יומן» tab. `st` = { d, meetings, weekStart, filters }. */
  function tabHtml(st) {
    st = st || {};
    if (!st.d) return '<div class="card work-card cal-card"><div class="wk-empty"><span class="wk-spin" aria-hidden="true"></span>טוען את היומן…</div></div>';
    var filters = st.filters || defaultFilters();
    var col = collect(st.d, st.meetings);
    if (!col.today) return '<div class="card work-card cal-card"><div class="wk-empty">היומן יופיע כשנתוני הבית ייטענו.</div></div>';
    var wm = weekModel(col, st.weekStart, filters);
    var h = '<div class="card work-card cal-card"><div class="card-title">📅 היומן של השבוע</div>' +
      '<div class="cal-nav">' +
      '<button type="button" class="wk-btn ghost" data-cal-nav="-1"' + (wm.canPrev ? '' : ' disabled') + '>→ שבוע קודם</button>' +
      '<button type="button" class="wk-btn' + (wm.isThisWeek ? '' : ' ghost') + '" data-cal-nav="0" aria-pressed="' + (wm.isThisWeek ? 'true' : 'false') + '">השבוע</button>' +
      '<button type="button" class="wk-btn ghost" data-cal-nav="1"' + (wm.canNext ? '' : ' disabled') + '>שבוע הבא ←</button>' +
      '<span class="cal-range" aria-live="polite">' + esc(dm(wm.weekStart) + ' – ' + dmy(wm.weekEnd)) + ' · ' + esc(wm.shown === 1 ? 'אירוע אחד' : wm.shown + ' אירועים') + '</span></div>' +
      filtersHtml(wm, filters);
    var notes = [];
    var beyond = beyondMeetings(wm);
    if (beyond && filters.meeting !== false) notes.push(beyond);
    TYPE_ORDER.forEach(function (t) { if (col.missing[t] && filters[t] !== false) notes.push(col.missing[t]); });
    if (notes.length) h += '<div class="mt-notice cal-notice">' + notes.map(esc).join('<br>') + '</div>';
    h += '<div class="cal-week">' + wm.days.map(dayHtml).join('') + '</div>';
    return h + '</div>';
  }
  /* «הבית היום»: one line that opens the calendar — the week itself is listed there, once. */
  function homeLineHtml(st) {
    if (!st || !st.d) return '';
    var col = collect(st.d, st.meetings);
    if (!col.today) return '';
    var wm = weekModel(col, col.today, defaultFilters());
    var todayN = wm.days.filter(function (x) { return x.isToday; }).reduce(function (n, x) { return n + x.items.length; }, 0);
    return '<button type="button" class="mt-alert cal-home" data-go-sub="calendar">📅 ' +
      esc('השבוע: ' + (wm.shown === 1 ? 'אירוע אחד' : wm.shown + ' אירועים') + (todayN ? ' · היום ' + todayN : '')) + ' — ליומן ←</button>';
  }

  var CalendarView = {
    TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, WEEKDAYS: WEEKDAYS, WEEKS_BACK: WEEKS_BACK, WEEKS_AHEAD: WEEKS_AHEAD,
    isIso: isIso, addDays: addDays, weekStartOf: weekStartOf, weekRange: weekRange, defaultFilters: defaultFilters,
    collect: collect, weekModel: weekModel, beyondMeetings: beyondMeetings,
    tabHtml: tabHtml, homeLineHtml: homeLineHtml, itemHtml: itemHtml, dayHtml: dayHtml,
    firstName: firstName, localStamp: localStamp, addable: addable, googleUrl: googleUrl, icsText: icsText, icsFileName: icsFileName, addHtml: addHtml,
    esc: esc
  };

  /* ── DOM wiring (browser only) ─────────────────────────── */
  var states = {};   // houseKey → { d, weekStart, filters } — in the page's memory only
  function stFor(key) { return states[key] || (states[key] = { d: null, weekStart: '', filters: defaultFilters() }); }
  function meetingsOf(key) {
    var ms = root.Meetings && root.Meetings._states ? root.Meetings._states[key] : null;
    var state = MV && ms ? MV.stateOf(ms) : 'loading';
    return { state: state, list: state === 'ok' ? ms.res.meetings : [] };
  }
  function viewOf(key) {
    var st = stFor(key);
    return { d: st.d, meetings: meetingsOf(key), weekStart: st.weekStart, filters: st.filters };
  }
  function paint(panel, key, scrollToToday) {
    var tab = panel.querySelector('[data-sub-panel="calendar"]');
    if (tab) {
      tab.innerHTML = tabHtml(viewOf(key));
      if (scrollToToday) {
        var t = tab.querySelector('[data-cal-today]');
        if (t && t.scrollIntoView && !tab.hidden) t.scrollIntoView({ block: 'nearest' });
      }
    }
    var home = panel.querySelector('[data-dash-calendar]');
    if (home) home.innerHTML = homeLineHtml(viewOf(key));
  }
  function downloadIcs(m) {
    var text = icsText(m, new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));
    if (!text || !root.Blob || !root.URL || !root.URL.createObjectURL) return false;
    var url = root.URL.createObjectURL(new root.Blob([text], { type: 'text/calendar;charset=utf-8' }));
    var a = root.document.createElement('a');
    a.href = url; a.download = icsFileName(m); a.rel = 'noopener';
    root.document.body.appendChild(a);
    a.click();
    root.document.body.removeChild(a);
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 4000);
    return true;
  }
  function findMeeting(key, id) {
    var list = meetingsOf(key).list || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function wire(panel, key) {
    if (panel.getAttribute('data-cal-wired') === '1') return;
    panel.setAttribute('data-cal-wired', '1');
    panel.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var st = stFor(key);
      var nav = t.closest('[data-cal-nav]');
      if (nav) {
        var step = Number(nav.getAttribute('data-cal-nav'));
        var today = st.d && st.d.today;
        var cur = weekModel(collect(st.d, meetingsOf(key)), st.weekStart, st.filters).weekStart;
        st.weekStart = step === 0 ? weekStartOf(today) : addDays(cur, 7 * (step > 0 ? 1 : -1));
        paint(panel, key, step === 0);
        return;
      }
      var fb = t.closest('[data-cal-filter]');
      if (fb) {
        var type = fb.getAttribute('data-cal-filter');
        if (TYPES[type]) { st.filters[type] = st.filters[type] === false; paint(panel, key, false); }
        return;
      }
      // «הוספה ליומן» (also drawn under a meeting in «פגישות קליטה»).
      var ics = t.closest('[data-cal-ics]');
      if (ics) { var m = findMeeting(key, ics.getAttribute('data-cal-ics')); if (m) downloadIcs(m); return; }
      // An installed PWA drops a plain target=_blank link — open it, else navigate.
      var open = t.closest('[data-cal-open]');
      if (open) {
        ev.preventDefault();
        var url = open.getAttribute('href');
        if (!/^https:\/\/calendar\.google\.com\//.test(url)) return;
        var w = root.open ? root.open(url, '_blank', 'noopener') : null;
        if (!w) root.location.href = url;
      }
    });
  }

  /* Called by work.js whenever the house's data is (re)drawn. */
  function onHouse(panel, key, d) {
    if (!panel || !key || !root.document) return;
    wire(panel, key);
    stFor(key).d = d || null;
    paint(panel, key, false);
  }
  /* Called by meetings.js when its list changes, and by work.js when the tab opens. */
  function repaint(panel, key, opened) {
    if (!panel || !key || !root.document) return;
    wire(panel, key);
    paint(panel, key, !!opened);
  }

  root.CalendarView = CalendarView;
  root.Calendar = { onHouse: onHouse, repaint: repaint, _states: states };
  if (typeof module === 'object' && module.exports) module.exports = CalendarView;
}(typeof self !== 'undefined' ? self : this));
