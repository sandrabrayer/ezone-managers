/* Managers work tool (13 Oct 2026) — the house page's work tabs:
 *   מטופלים        patients in the house, outpatients from the house,
 *                  intake visits and admissions this month
 *   צוות ומשמרות   who is on shift today, the next 14 days, the staff list
 *                  (stage 2 — from the coordinators app, via the Dashboard)
 *   מטפלים         therapists, their workdays and weekly visits
 *   שיחות משפחה    family-call log
 *   שיחות עם עובדים private staff-talk log (author + admins only — enforced
 *                  by the backend, not here)
 *   אירועים חריגים unusual-events log
 * plus a follow-up reminders strip at the top of every house tab.
 *
 * Data: POST /api/work → the Dashboard's `managersWork` (the server adds the
 * secret and decides house / role / actor). Every value from the feed is
 * escaped before it reaches innerHTML. The view builders (WorkView.*) are
 * pure and tested in test/work-view.test.js. */
(function (root) {
  'use strict';

  var LOGS = {
    familyCalls: {
      title: 'שיחות עם בני משפחה', add: 'רישום שיחה',
      fields: [
        { k: 'patientName', label: 'מטופל/ת', type: 'patient', required: true },
        { k: 'contactName', label: 'איש/אשת קשר', type: 'text', max: 80, required: true },
        { k: 'relation', label: 'קרבה', type: 'text', max: 40, placeholder: 'אמא, אח, אפוטרופוס…' },
        { k: 'callDate', label: 'תאריך', type: 'date', required: true },
        { k: 'callTime', label: 'שעה', type: 'time' },
        { k: 'summary', label: 'תיאור קצר', type: 'textarea', max: 1000, required: true }
      ],
      head: function (r) { return r.patientName + ' — ' + r.contactName + (r.relation ? ' (' + r.relation + ')' : ''); },
      body: function (r) { return [r.summary]; },
      when: function (r) { return [r.callDate, r.callTime]; }
    },
    staffTalks: {
      title: 'שיחות אישיות עם עובדים', add: 'רישום שיחה',
      note: 'השיחות כאן נראות רק לך, לסנדרה ולרון.',
      fields: [
        { k: 'employeeName', label: 'עובד/ת', type: 'employee', required: true },
        { k: 'talkDate', label: 'תאריך', type: 'date', required: true },
        { k: 'talkTime', label: 'שעה', type: 'time' },
        { k: 'summary', label: 'עיקרי השיחה', type: 'textarea', max: 1500, required: true }
      ],
      head: function (r) { return r.employeeName; },
      body: function (r) { return [r.summary]; },
      when: function (r) { return [r.talkDate, r.talkTime]; }
    },
    events: {
      title: 'אירועים חריגים', add: 'רישום אירוע',
      fields: [
        { k: 'eventDate', label: 'תאריך', type: 'date', required: true },
        { k: 'eventTime', label: 'שעה', type: 'time' },
        { k: 'patientName', label: 'מטופל/ת (אם רלוונטי)', type: 'patient' },
        { k: 'whatHappened', label: 'מה קרה', type: 'textarea', max: 1500, required: true },
        { k: 'actionTaken', label: 'מה נעשה', type: 'textarea', max: 1500 }
      ],
      head: function (r) { return r.patientName ? 'אירוע — ' + r.patientName : 'אירוע'; },
      body: function (r) { return [r.whatHappened, r.actionTaken ? 'מה נעשה: ' + r.actionTaken : '']; },
      when: function (r) { return [r.eventDate, r.eventTime]; }
    }
  };
  var LOG_LABEL = { familyCalls: 'שיחת משפחה', staffTalks: 'שיחה עם עובד/ת', events: 'אירוע חריג' };
  var OUTCOME_LABELS = { not_relevant: 'לא רלוונטי', thinking: 'חושבים על זה', entered: 'נכנסים לטיפול', postponed: 'נדחה', cancelled: 'התבטל' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (parseInt(m[3], 10) + '/' + parseInt(m[2], 10) + '/' + m[1].slice(2)) : '';
  }
  function plural(n, one, many) { return n === 1 ? one : n + ' ' + many; }

  /* ── pure view builders ─────────────────────────────────── */
  function patientsHtml(d) {
    var pats = d.patients || [], outs = d.outpatients || [], visits = d.visits || [], adm = d.admissions || [];
    var h = '';
    h += '<div class="card work-card wk-patients"><div class="card-title">מטופלים בבית (' + pats.length + ')</div>';
    h += pats.length ? '<ul class="wk-list">' + pats.map(function (p) {
      return '<li><span class="wk-name">' + esc(p.name) + '</span><span class="wk-meta">מ-' + esc(fmtDate(p.entryDate)) +
        ' · יום ' + esc(p.days) + (p.status === 'trial' ? ' · ניסיון' : '') + '</span></li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין מטופלים רשומים בבית</div>';
    h += '</div>';
    h += '<div class="card work-card wk-out"><div class="card-title">מטופלי חוץ שיצאו מהבית (' + outs.length + ')</div>';
    h += outs.length ? '<ul class="wk-list">' + outs.map(function (o) {
      return '<li><span class="wk-name">' + esc(o.name) + '</span><span class="wk-meta">' + esc(o.therapy) +
        (o.startDate ? ' · מ-' + esc(fmtDate(o.startDate)) : '') + '</span></li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין כרגע מטופלי חוץ מהבית</div>';
    h += '</div>';
    h += '<div class="card work-card wk-visits"><div class="card-title">ביקורים וקליטות החודש</div>';
    h += '<div class="wk-kpis"><div class="wk-kpi"><b>' + visits.length + '</b><span>ביקורים</span></div>' +
      '<div class="wk-kpi"><b>' + adm.length + '</b><span>נקלטו</span></div></div>';
    if (visits.length) {
      h += '<div class="card-subtitle">ביקורים</div><ul class="wk-list">' + visits.map(function (v) {
        return '<li><span class="wk-name">' + esc(v.name) + '</span><span class="wk-meta">' + esc(fmtDate(v.date)) +
          (v.time ? ' ' + esc(v.time) : '') + (v.meetingWith ? ' · עם ' + esc(v.meetingWith) : '') +
          (v.outcome ? ' · ' + esc(OUTCOME_LABELS[v.outcome] || v.outcome) : '') + '</span></li>';
      }).join('') + '</ul>';
    }
    if (adm.length) {
      h += '<div class="card-subtitle">נקלטו</div><ul class="wk-list">' + adm.map(function (a) {
        return '<li><span class="wk-name">' + esc(a.name) + '</span><span class="wk-meta">' + esc(fmtDate(a.date)) + '</span></li>';
      }).join('') + '</ul>';
    }
    h += '</div>';
    return h;
  }

  /* ── stage 2: team + therapists (coordinators data) ─────── */
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var SHIFT_ORDER = ['בוקר', 'ערב', 'לילה'];
  var TEAM_REASON = {
    not_configured: 'הנתונים מאפליקציית הרכזים עוד לא מחוברים.',
    pending: 'הנתונים מאפליקציית הרכזים עוד לא מחוברים.',
    unreadable: 'לא הצלחנו לקרוא את הנתונים מאפליקציית הרכזים. נסו שוב מאוחר יותר.',
    contract_mismatch: 'לא הצלחנו לקרוא את הנתונים מאפליקציית הרכזים. נסו שוב מאוחר יותר.'
  };
  function weekdayOf(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : -1;
  }
  function telHref(phone) { var p = String(phone || ''); return /^0\d{8,9}$/.test(p) ? 'tel:' + p : ''; }
  function stampText(iso) {
    var t = Date.parse(String(iso || ''));
    if (!isFinite(t)) return '';
    var d = new Date(t), z = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  /* null when the team is usable, else the "not available" card. */
  function teamGate(d) {
    var t = d && d.team;
    if (t && t.available) return null;
    var msg = TEAM_REASON[(t && t.reason) || 'not_configured'] || TEAM_REASON.unreadable;
    return '<div class="card work-card"><div class="wk-empty">' + esc(msg) + '</div></div>';
  }
  function staleNote(t) {
    if (!t.stale) return '';
    var s = stampText(t.updatedAt);
    return '<div class="wk-note wk-stale">⚠️ הנתונים לא התעדכנו לאחרונה' + (s ? ' (עודכנו ב-' + esc(s) + ')' : '') + '.</div>';
  }
  function byShift(rows) {
    var g = {};
    rows.forEach(function (r) { (g[r.shift] = g[r.shift] || []).push(r); });
    return SHIFT_ORDER.filter(function (s) { return g[s]; }).map(function (s) { return { shift: s, rows: g[s] }; });
  }
  function shiftLines(rows) {
    return byShift(rows).map(function (g) {
      return '<li><span class="wk-shift">' + esc(g.shift) + '</span><span class="wk-name">' +
        g.rows.map(function (r) { return esc(r.guideName); }).join(', ') + '</span>' +
        (g.rows.some(function (r) { return r.draft; }) ? '<span class="wk-meta">טיוטה</span>' : '') + '</li>';
    }).join('');
  }
  function staffLine(s) {
    var tel = telHref(s.phone);
    return '<li><span class="wk-name">' + esc(s.name) + '</span><span class="wk-meta">' + esc(s.role) +
      (s.onLeave ? ' · בחופשה' : '') + '</span>' +
      (tel ? '<a class="wk-tel" href="' + esc(tel) + '" aria-label="' + esc('התקשרות ל' + s.name) + '">📞 ' + esc(s.phone) + '</a>' : '') + '</li>';
  }
  function teamHtml(d) {
    var gate = teamGate(d);
    if (gate) return gate;
    var t = d.team, today = t.today || [], shifts = t.shifts || [], staff = t.staff || [];
    var h = staleNote(t);
    h += '<div class="card work-card wk-today"><div class="card-title">במשמרת היום</div>';
    h += today.length ? '<ul class="wk-list wk-shifts">' + shiftLines(today) + '</ul>'
      : '<div class="wk-empty">אין שיבוץ להיום באפליקציית הרכזים</div>';
    h += '</div>';
    var days = [], seen = {};
    shifts.forEach(function (s) { if (s.date !== d.today && !seen[s.date]) { seen[s.date] = []; days.push(s.date); } if (seen[s.date]) seen[s.date].push(s); });
    h += '<div class="card work-card wk-week"><div class="card-title">משמרות בשבועיים הקרובים</div>';
    h += days.length ? days.map(function (day) {
      return '<div class="card-subtitle">יום ' + esc(WEEKDAYS[weekdayOf(day)] || '') + ' ' + esc(fmtDate(day)) + '</div>' +
        '<ul class="wk-list wk-shifts">' + shiftLines(seen[day]) + '</ul>';
    }).join('') : '<div class="wk-empty">עוד לא פורסם שיבוץ לימים הבאים</div>';
    h += '</div>';
    var guides = staff.filter(function (s) { return s.kind === 'guide'; });
    var ther = staff.filter(function (s) { return s.kind === 'therapist'; });
    h += '<div class="card work-card wk-staff"><div class="card-title">עובדי הבית (' + staff.length + ')</div>';
    if (!staff.length) h += '<div class="wk-empty">אין עובדים רשומים בבית</div>';
    if (guides.length) h += '<div class="card-subtitle">מדריכים (' + guides.length + ')</div><ul class="wk-list">' + guides.map(staffLine).join('') + '</ul>';
    if (ther.length) h += '<div class="card-subtitle">מטפלים (' + ther.length + ')</div><ul class="wk-list">' + ther.map(staffLine).join('') + '</ul>';
    h += '</div>';
    return h;
  }
  function therapistsHtml(d) {
    var gate = teamGate(d);
    if (gate) return gate;
    var t = d.team, ther = (t.staff || []).filter(function (s) { return s.kind === 'therapist'; }), week = t.therapistWeek || [];
    var h = staleNote(t);
    h += '<div class="card work-card wk-ther"><div class="card-title">מטפלים בבית (' + ther.length + ')</div>';
    h += ther.length ? '<ul class="wk-list">' + ther.map(function (s) {
      var days = (s.workdays || []).filter(function (x) { return WEEKDAYS[x]; }).map(function (x) { return WEEKDAYS[x]; });
      var tel = telHref(s.phone);
      return '<li><span class="wk-name">' + esc(s.name) + '</span><span class="wk-meta">' + esc(s.role) +
        (days.length ? ' · ימי עבודה: ' + esc(days.join(', ')) : '') + (s.onLeave ? ' · בחופשה' : '') + '</span>' +
        (tel ? '<a class="wk-tel" href="' + esc(tel) + '" aria-label="' + esc('התקשרות ל' + s.name) + '">📞 ' + esc(s.phone) + '</a>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין מטפלים רשומים בבית</div>';
    h += '</div>';
    h += '<div class="card work-card wk-ther-week"><div class="card-title">לוז טיפולים שבועי</div>';
    if (!week.length) h += '<div class="wk-empty">הרכזים עוד לא שיבצו טיפולים</div>';
    for (var day = 0; day < 7; day++) {
      var rows = week.filter(function (r) { return r.dayOfWeek === day; });
      if (!rows.length) continue;
      h += '<div class="card-subtitle">יום ' + esc(WEEKDAYS[day]) + '</div><ul class="wk-list">' + rows.map(function (r) {
        return '<li><span class="wk-shift">' + esc(r.time || 'ללא שעה') + '</span><span class="wk-name">' + esc(r.therapistName) +
          '</span><span class="wk-meta">עם ' + esc(r.patientName) + '</span></li>';
      }).join('') + '</ul>';
    }
    h += '</div>';
    return h;
  }

  function formHtml(logKey, d, today) {
    var def = LOGS[logKey];
    var pats = (d && d.patients) || [];
    return '<form class="wk-form" data-wk-form="' + logKey + '" novalidate>' + def.fields.map(function (f) {
      var id = 'wk-' + logKey + '-' + f.k;
      var req = f.required ? ' required' : '';
      var lab = '<label for="' + id + '">' + esc(f.label) + (f.required ? ' *' : '') + '</label>';
      var input;
      if (f.type === 'textarea') input = '<textarea id="' + id + '" name="' + f.k + '" maxlength="' + f.max + '" rows="3"' + req + '></textarea>';
      else if (f.type === 'date') input = '<input id="' + id + '" name="' + f.k + '" type="date" value="' + esc(today || '') + '"' + req + '>';
      else if (f.type === 'time') input = '<input id="' + id + '" name="' + f.k + '" type="time">';
      else if (f.type === 'patient') {
        input = '<input id="' + id + '" name="' + f.k + '" maxlength="80" list="' + id + '-list" autocomplete="off"' + req + '>' +
          '<datalist id="' + id + '-list">' + pats.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist>';
      } else if (f.type === 'employee') {
        var staff = (d && d.team && d.team.available && d.team.staff) || [];
        input = '<input id="' + id + '" name="' + f.k + '" maxlength="80" list="' + id + '-list" autocomplete="off"' + req + '>' +
          '<datalist id="' + id + '-list">' + staff.map(function (s) { return '<option value="' + esc(s.name) + '">'; }).join('') + '</datalist>';
      } else input = '<input id="' + id + '" name="' + f.k + '" maxlength="' + f.max + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + req + '>';
      return '<div class="wk-field wk-f-' + f.type + '">' + lab + input + '</div>';
    }).join('') +
      '<div class="wk-field wk-f-date"><label for="wk-' + logKey + '-fu">תזכורת למעקב (לא חובה)</label>' +
      '<input id="wk-' + logKey + '-fu" name="followUpDate" type="date"></div>' +
      '<div class="wk-actions"><button type="submit" class="wk-btn">' + esc(def.add) + '</button>' +
      '<span class="wk-msg" data-wk-msg></span></div></form>';
  }

  function logListHtml(logKey, rows, me) {
    var def = LOGS[logKey];
    if (!rows || !rows.length) return '<div class="wk-empty">עדיין אין רישומים</div>';
    return '<ul class="wk-log">' + rows.map(function (r) {
      var w = def.when(r);
      var canEdit = me && (me.role === 'admin' || me.name === r.author);
      var fu = '';
      if (r.followUpDate) {
        fu = r.followUpDone
          ? '<span class="wk-fu done">מעקב בוצע</span>'
          : '<span class="wk-fu">מעקב: ' + esc(fmtDate(r.followUpDate)) + '</span>' +
            (canEdit ? '<button type="button" class="wk-link" data-wk-done="' + logKey + '|' + esc(r.id) + '">סמן כבוצע</button>' : '');
      }
      return '<li class="wk-entry" data-wk-id="' + esc(r.id) + '">' +
        '<div class="wk-entry-head"><span class="wk-name">' + esc(def.head(r)) + '</span>' +
        '<span class="wk-meta">' + esc(fmtDate(w[0])) + (w[1] ? ' ' + esc(w[1]) : '') + ' · ' + esc(r.author) + '</span></div>' +
        def.body(r).filter(Boolean).map(function (t) { return '<div class="wk-text">' + esc(t) + '</div>'; }).join('') +
        '<div class="wk-entry-foot">' + fu +
        (canEdit ? '<button type="button" class="wk-link danger" data-wk-del="' + logKey + '|' + esc(r.id) + '">מחיקה</button>' : '') +
        '</div></li>';
    }).join('') + '</ul>';
  }

  function logPanelHtml(logKey, d, me) {
    var def = LOGS[logKey];
    var rows = (d && d.logs && d.logs[logKey]) || [];
    return '<div class="card work-card wk-' + logKey + '"><div class="card-title">' + esc(def.title) + '</div>' +
      (def.note ? '<div class="wk-note">' + esc(def.note) + '</div>' : '') +
      formHtml(logKey, d, d && d.today) + '</div>' +
      '<div class="card work-card"><div class="card-title">רישומים (' + rows.length + ')</div>' + logListHtml(logKey, rows, me) + '</div>';
  }

  /* Follow-ups due (date ≤ today, not done) — one line each. */
  function followUpsHtml(d, me) {
    var due = (d && d.followUps) || [];
    if (!due.length) return '';
    var byId = {};
    Object.keys(LOGS).forEach(function (k) { ((d.logs && d.logs[k]) || []).forEach(function (r) { byId[k + '|' + r.id] = r; }); });
    return '<div class="wk-followups"><div class="wk-fu-title">🔔 ' + esc(plural(due.length, 'תזכורת אחת למעקב', 'תזכורות למעקב')) + '</div><ul>' +
      due.map(function (f) {
        var r = byId[f.log + '|' + f.id] || {};
        var canEdit = me && (me.role === 'admin' || me.name === r.author);
        return '<li><span>' + esc(LOG_LABEL[f.log] || '') + ' · ' + esc(LOGS[f.log] ? LOGS[f.log].head(r) : '') + ' · ' + esc(fmtDate(f.date)) + '</span>' +
          (canEdit ? '<button type="button" class="wk-link" data-wk-done="' + f.log + '|' + esc(f.id) + '">בוצע</button>' : '') + '</li>';
      }).join('') + '</ul></div>';
  }

  /* The entry a form submits: trimmed values of the defined fields only. */
  function entryFromForm(logKey, values) {
    var def = LOGS[logKey];
    var out = {}, missing = [];
    def.fields.forEach(function (f) {
      var v = String(values[f.k] == null ? '' : values[f.k]).trim();
      v = v.slice(0, f.max || 80);
      out[f.k] = v;
      if (f.required && !v) missing.push(f.label);
    });
    out.followUpDate = String(values.followUpDate || '').trim();
    return { entry: out, missing: missing };
  }

  var WorkView = { LOGS: LOGS, esc: esc, fmtDate: fmtDate, patientsHtml: patientsHtml, formHtml: formHtml,
    teamHtml: teamHtml, therapistsHtml: therapistsHtml, telHref: telHref,
    logListHtml: logListHtml, logPanelHtml: logPanelHtml, followUpsHtml: followUpsHtml, entryFromForm: entryFromForm };

  /* ── DOM wiring (browser only) ──────────────────────────── */
  var cache = {}; // houseKey → { at, data }
  var loading = {};

  async function post(body) {
    var r = await fetch('/api/work', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    var data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (r.status === 401 && root.Auth) root.Auth.showLogin();
    if (!r.ok || !data || data.ok === false) {
      var err = new Error((data && (data.message || data.error)) || ('HTTP ' + r.status));
      err.data = data;
      throw err;
    }
    return data;
  }

  function me() { return root.Auth ? root.Auth.user() : null; }

  async function load(key, force) {
    var c = cache[key];
    if (!force && c && Date.now() - c.at < 60000) return c.data;
    if (loading[key]) return loading[key];
    loading[key] = post({ op: 'houseData', house: key }).then(function (d) {
      cache[key] = { at: Date.now(), data: d };
      return d;
    }).finally(function () { delete loading[key]; });
    return loading[key];
  }

  function host(panel, sub) { return panel.querySelector('[data-sub-panel="' + sub + '"]'); }

  function renderAll(panel, key, d) {
    var u = me();
    var fu = panel.querySelector('[data-followups]');
    if (fu) fu.innerHTML = followUpsHtml(d, u);
    var p = host(panel, 'patients');
    if (p) p.innerHTML = patientsHtml(d);
    var tm = host(panel, 'team');
    if (tm) tm.innerHTML = teamHtml(d);
    var th = host(panel, 'therapists');
    if (th) th.innerHTML = therapistsHtml(d);
    Object.keys(LOGS).forEach(function (k) {
      var h = host(panel, k);
      if (!h) return;
      // Keep a half-typed form: only the list is redrawn when a form exists.
      var form = h.querySelector('[data-wk-form]');
      if (form && form.getAttribute('data-wk-dirty') === '1') {
        var list = h.querySelectorAll('.work-card')[1];
        if (list) list.innerHTML = '<div class="card-title">רישומים (' + ((d.logs[k] || []).length) + ')</div>' + logListHtml(k, d.logs[k], u);
      } else {
        h.innerHTML = logPanelHtml(k, d, u);
      }
    });
  }

  async function refresh(panel, key, force) {
    var subs = ['patients', 'team', 'therapists'].concat(Object.keys(LOGS));
    try {
      var d = await load(key, force);
      renderAll(panel, key, d);
    } catch (e) {
      var msg = e && e.data && e.data.error === 'unauthorized'
        ? 'כלי העבודה עוד לא הופעל בשרת. פנו לסנדרה.'
        : 'שגיאה בטעינת הנתונים: ' + (e && e.message ? e.message : '');
      subs.forEach(function (s) { var h = host(panel, s); if (h) h.innerHTML = '<div class="card work-card"><div class="wk-empty error">' + esc(msg) + '</div></div>'; });
    }
  }

  function showSub(panel, sub) {
    panel.querySelectorAll('[data-sub]').forEach(function (b) {
      var on = b.getAttribute('data-sub') === sub;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panel.querySelectorAll('[data-sub-panel]').forEach(function (s) { s.hidden = s.getAttribute('data-sub-panel') !== sub; });
  }

  function wire(panel, key) {
    if (panel.getAttribute('data-wk-wired') === '1') return;
    panel.setAttribute('data-wk-wired', '1');
    panel.addEventListener('click', async function (ev) {
      var t = ev.target;
      var subBtn = t.closest && t.closest('[data-sub]');
      if (subBtn) { showSub(panel, subBtn.getAttribute('data-sub')); return; }
      var done = t.closest && t.closest('[data-wk-done]');
      var del = t.closest && t.closest('[data-wk-del]');
      if (!done && !del) return;
      var parts = (done || del).getAttribute(done ? 'data-wk-done' : 'data-wk-del').split('|');
      if (del && !root.confirm('למחוק את הרישום?')) return;
      (done || del).disabled = true;
      try {
        await post({ op: 'logUpdate', house: key, log: parts[0], id: parts[1], patch: done ? { followUpDone: true } : { deleted: true } });
      } catch (e) { root.alert('הפעולה נכשלה: ' + (e && e.message ? e.message : '')); }
      refresh(panel, key, true);
    });
    panel.addEventListener('input', function (ev) {
      var f = ev.target.closest && ev.target.closest('[data-wk-form]');
      if (f) f.setAttribute('data-wk-dirty', '1');
    });
    panel.addEventListener('submit', async function (ev) {
      var form = ev.target.closest && ev.target.closest('[data-wk-form]');
      if (!form) return;
      ev.preventDefault();
      var logKey = form.getAttribute('data-wk-form');
      var values = {};
      Array.prototype.forEach.call(form.elements, function (el) { if (el.name) values[el.name] = el.value; });
      var res = entryFromForm(logKey, values);
      var msg = form.querySelector('[data-wk-msg]');
      if (res.missing.length) { msg.textContent = 'חסר: ' + res.missing.join(', '); return; }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; msg.textContent = 'שומר…';
      try {
        await post({ op: 'logAdd', house: key, log: logKey, entry: res.entry });
        form.removeAttribute('data-wk-dirty');
        await refresh(panel, key, true);
      } catch (e) {
        msg.textContent = 'השמירה נכשלה: ' + (e && e.message ? e.message : '');
        btn.disabled = false;
      }
    });
  }

  /* Called by app.js after a house tab is drawn. */
  function onHouseRendered(panel, key) {
    if (!panel || !panel.querySelector('[data-subtabs]')) return;
    wire(panel, key);
    refresh(panel, key, false);
  }

  root.WorkView = WorkView;
  root.Work = { onHouseRendered: onHouseRendered, showSub: showSub, _cache: cache };
  if (typeof module === 'object' && module.exports) module.exports = WorkView;
}(typeof self !== 'undefined' ? self : this));
