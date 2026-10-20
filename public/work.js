/* Managers work tool (13 Oct 2026) — the house page's work tabs:
 *   ראשי           the dashboard (14 Oct 2026): today in the house, this
 *                  month's visits / admissions, latest events (the bonus
 *                  dial on the same tab is drawn by app.js)
 *   מטופלים        patients in the house, outpatients from the house,
 *                  intake visits and admissions this month
 *   צוות ומשמרות   who is on shift today, the next 14 days, the staff list
 *                  (stage 2 — from the coordinators app, via the Dashboard)
 *   מטפלים         therapists, their workdays and weekly visits
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
  var LOG_LABEL = { staffTalks: 'שיחה עם עובד/ת', events: 'אירוע חריג' };
  var STAGE_LABELS = { new: 'ליד', visit: 'נקבע ביקור', paid: 'שילם מקדמה', entry: 'נכנס לבית', waitlist: 'רשימת המתנה' };
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
  /* ── expected discharge date (15 Oct 2026) ─────────────────
   * «שחרור משוער: dd/m/yy» under each patient, with a native date picker to
   * set or change it. Stored by the Dashboard (`managersWork` dischargeSet,
   * append-only, audited); shown only when the backend says it supports it
   * (`expectedDischargeSupported`), so an older backend shows nothing new.
   * Display-only — no bonus figure reads it. */
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  function isRealIso(s) {
    if (!ISO_RE.test(String(s || ''))) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  /* '' when `value` may be saved as the expected discharge, else the reason. */
  function dischargeCheck(value, entryDate) {
    var v = String(value || '').trim();
    if (!v) return 'בחרו תאריך';
    if (!isRealIso(v)) return 'תאריך לא תקין';
    if (isRealIso(entryDate) && v < entryDate) return 'תאריך השחרור לא יכול להיות לפני תאריך הכניסה';
    return '';
  }
  var DISCHARGE_ERRORS = {
    conflict: 'התאריך עודכן בינתיים — מוצג עכשיו התאריך העדכני. בדקו ונסו שוב.',
    before_admission: 'תאריך השחרור לא יכול להיות לפני תאריך הכניסה',
    bad_date: 'תאריך לא תקין',
    too_far: 'התאריך רחוק מדי (יותר משנתיים קדימה)',
    not_found: 'המטופל/ת כבר לא רשום/ה בבית — רעננו את הדף',
    forbidden: 'אין הרשאה לעדכן את הבית הזה'
  };
  /* Why a save (or a load) failed, in plain Hebrew — never a raw code. The
   * technical class is in the server log only (server.js logWork). */
  var WORK_ERRORS = {
    unknown_op: 'השרת לא עודכן — השמירה עוד לא זמינה. פנו לסנדרה.',
    unauthorized: 'אין הרשאה לשמור בשרת הנתונים. פנו לסנדרה.',
    upstream_unavailable: 'אין הרשאה לשמור בשרת הנתונים. פנו לסנדרה.',
    upstream_auth: 'אין הרשאה לכתוב בשרת הנתונים (נדרש אישור הרשאות). פנו לסנדרה.',
    lock_busy: 'השרת עסוק כרגע — נסו שוב בעוד רגע.',
    upstream_timeout: 'השרת לא הגיב בזמן — רעננו ובדקו אם התאריך נשמר.',
    upstream_unreachable: 'אין חיבור לשרת הנתונים — נסו שוב בעוד רגע.',
    upstream_bad_response: 'תקלה בשרת הנתונים — נסו שוב. אם זה חוזר, פנו לסנדרה.',
    upstream_error: 'תקלה בשרת הנתונים — נסו שוב. אם זה חוזר, פנו לסנדרה.',
    exception: 'תקלה בשרת הנתונים — נסו שוב. אם זה חוזר, פנו לסנדרה.',
    missing_fields: 'חסרים פרטים — רעננו את הדף ונסו שוב.',
    bad_request: 'חסרים פרטים — רעננו את הדף ונסו שוב.',
    rate_limited: 'יותר מדי עדכונים — נסו שוב מאוחר יותר.',
    session: 'פג תוקף ההתחברות — היכנסו שוב.',
    offline: 'אין חיבור לאינטרנט — בדקו את החיבור ונסו שוב.',
    unknown: 'השמירה נכשלה — נסו שוב.'
  };
  /* err: what post() throws ({ status, data }) or a network TypeError. */
  function dischargeErrorText(err) {
    var code = err && err.data && typeof err.data.error === 'string' ? err.data.error : '';
    if (code && Object.prototype.hasOwnProperty.call(DISCHARGE_ERRORS, code)) return DISCHARGE_ERRORS[code];
    if (code && Object.prototype.hasOwnProperty.call(WORK_ERRORS, code)) return WORK_ERRORS[code];
    var status = err && err.status;
    if (status === 429) return WORK_ERRORS.rate_limited;
    if (status === 401) return WORK_ERRORS.session;
    if (status === 403) return DISCHARGE_ERRORS.forbidden;
    if (!err || !err.data) {
      if (err && err.name === 'TypeError') return WORK_ERRORS.offline;
      if (status >= 500) return WORK_ERRORS.upstream_bad_response;
    }
    return WORK_ERRORS.unknown;
  }
  /* «ניקוי תאריך» / «אין צפי לשחרור» (15 Oct 2026): offered only when the
   * backend lists the modes (`expectedDischargeModes`), so an older backend
   * keeps the set/change-only form. Both append an audit row there. */
  var DISCHARGE_DONE = { set: 'נשמר ✓', clear: 'התאריך נוקה ✓', none: 'נשמר: אין צפי לשחרור ✓' };
  function dischargeModes(d) {
    var m = d && Array.isArray(d.expectedDischargeModes) ? d.expectedDischargeModes : [];
    return { clear: m.indexOf('clear') >= 0, none: m.indexOf('none') >= 0 };
  }
  /* What the row shows now: 'none' («אין צפי»), 'date', or '' (nothing set). */
  function dischargeStateOf(p) {
    var ed = p && p.expectedDischarge;
    if (ed && ed.none === true) return 'none';
    return ed && isRealIso(ed.date) ? 'date' : '';
  }
  /* The value this screen showed — the backend's optimistic-concurrency token. */
  function dischargeToken(p) {
    var st = dischargeStateOf(p);
    return st === 'none' ? 'none' : st === 'date' ? String(p.expectedDischarge.date) : '';
  }
  function modeBtnHtml(mode, i, label, who) {
    return '<button type="button" class="wk-dis-btn wk-dis-mode" data-dis-mode="' + mode + '" data-dis-mode-row="' + i + '" aria-label="' +
      esc(label) + ' — ' + who + '"><span class="wk-spin" data-dis-mode-spin aria-hidden="true" hidden></span>' +
      '<span data-dis-mode-label>' + esc(label) + '</span></button>';
  }
  function dischargeHtml(p, i, modes) {
    var md = modes || {};
    var st = dischargeStateOf(p);
    var none = st === 'none' && md.none;
    var cur = st === 'date' ? p.expectedDischarge.date : '';
    var who = esc(p.name);
    var h = '<div class="wk-dis" data-dis-row="' + i + '"' + (none ? ' data-dis-none="1"' : '') + '>';
    h += none
      ? '<span class="wk-dis-text wk-dis-none">אין צפי לשחרור</span>' +
        '<button type="button" class="wk-dis-btn" data-dis-edit="' + i + '" aria-label="שינוי — אין צפי לשחרור — ' + who + '">שינוי</button>'
      : cur
      ? '<span class="wk-dis-text">שחרור משוער: <b>' + esc(fmtDate(cur)) + '</b></span>' +
        '<button type="button" class="wk-dis-btn" data-dis-edit="' + i + '" aria-label="שינוי תאריך שחרור משוער — ' + who + '">שינוי</button>'
      : '<button type="button" class="wk-dis-btn wk-dis-empty" data-dis-edit="' + i + '" aria-label="הגדרת תאריך שחרור — ' + who + '">הגדרת תאריך שחרור</button>';
    h += '<form class="wk-dis-form" data-dis-form="' + i + '" novalidate hidden>' +
      '<label class="wk-dis-label"><span>שחרור משוער</span>' +
      '<input name="expectedDate" type="date" required' +
      (isRealIso(p.entryDate) ? ' min="' + esc(p.entryDate) + '"' : '') + (cur ? ' value="' + esc(cur) + '"' : '') + '></label>' +
      '<button type="submit" class="wk-dis-btn wk-dis-save"><span class="wk-spin" data-dis-spin aria-hidden="true" hidden></span>' +
      '<span data-dis-save-label>שמירה</span></button>' +
      '<button type="button" class="wk-dis-btn wk-dis-cancel" data-dis-cancel="' + i + '">ביטול</button>' +
      (md.none && !none ? modeBtnHtml('none', i, 'אין צפי לשחרור', who) : '') +
      (md.clear && (cur || none) ? modeBtnHtml('clear', i, 'ניקוי תאריך', who) : '') +
      '<span class="wk-msg" data-dis-msg role="status" aria-live="polite"></span></form>' +
      '<span class="wk-dis-flash" data-dis-flash role="status" aria-live="polite"></span>';
    return h + '</div>';
  }

  /* ── committees «ועדות» — READ-ONLY (20 Oct 2026, docs/committee.md) ──
   * The coordinators set committees in their app; houseData.committees carries
   * this house's upcoming ones ({ available, today, items } or { available:false,
   * reason }). No editor here — the server refuses the old write (410). */
  var COMMITTEE_REASON = {
    not_configured: 'הוועדות מאפליקציית הרכזים עוד לא מחוברות.',
    coordinators_not_configured: 'הוועדות מאפליקציית הרכזים עוד לא מחוברות.',
    unauthorized: 'הוועדות מאפליקציית הרכזים עוד לא מחוברות.'
  };
  var COMMITTEE_UNREADABLE = 'לא הצלחנו לקרוא את הוועדות מאפליקציית הרכזים. נסו שוב מאוחר יותר.';
  function committeesState(d) {
    var c = d && d.committees;
    if (c && c.available === true && Array.isArray(c.items)) return { ok: true, items: c.items, today: isRealIso(c.today) ? c.today : '' };
    if (!c) return { ok: false, text: 'הוועדות יופיעו אחרי עדכון השרת.' };
    return { ok: false, text: COMMITTEE_REASON[c.reason] || COMMITTEE_UNREADABLE };
  }
  function committeeWhen(c) {
    var wd = weekdayOf(c.date);
    return (WEEKDAYS[wd] ? 'יום ' + WEEKDAYS[wd] + ' ' : '') + fmtDate(c.date) + (/^\d{2}:\d{2}$/.test(String(c.time || '')) ? ' · ' + c.time : '');
  }
  /* ── half-yearly feedback «משוב» (20 Oct 2026, docs/feedback-reminders.md) ──
   * Roster = the house staff from the coordinators digest (houseData.team.staff,
   * with startDate where the staffing-synced roster has one); done dates =
   * houseData.feedback.rows (append-only FeedbackLog). The date logic is
   * lib/feedback-due.js (6 months after the last feedback, or after the start
   * date; month ends clamp; no anchor → «אין תאריך התחלה», never a guess). */
  var FD = root.FeedbackDue || (typeof require === 'function' ? require('../lib/feedback-due.js') : null);
  var FEEDBACK_STATUS = { overdue: 'באיחור', soon: 'בקרוב', ok: 'בהמשך', unknown: 'אין תאריך התחלה' };
  /* null when there is nothing to compute from, else FD.houseFeedback(...). */
  function feedbackModel(d) {
    d = d || {};
    if (!FD || !d.team || !d.team.available || !d.feedback || d.feedback.supported !== true) return null;
    var today = isRealIso(d.today) ? d.today : '';
    return FD.houseFeedback(d.team.staff || [], d.feedback.rows || [], today);
  }
  function feedbackUnavailableText(d) {
    if (!d || !d.feedback) return 'תזכורות המשוב יופיעו אחרי עדכון השרת.';
    return TEAM_REASON[(d.team && d.team.reason) || 'not_configured'] || TEAM_REASON.unreadable;
  }
  function feedbackLine(x) {
    return '<li class="wk-fb-' + esc(x.status) + '"><span class="wk-name">' + esc(x.name) + '</span><span class="wk-meta">' +
      (x.due ? 'משוב עד ' + esc(fmtDate(x.due)) : '') + (x.status === 'overdue' ? ' · באיחור ' + esc(String(-x.daysLeft)) + ' ימים' : '') +
      (x.status === 'soon' ? ' · בעוד ' + esc(String(x.daysLeft)) + ' ימים' : '') + '</span></li>';
  }
  /* «הבית היום»: due soon (30 days) + overdue (red). */
  function feedbackCardHtml(d) {
    var m = feedbackModel(d);
    var h = '<div class="card dash-card dash-feedback"><div class="card-title">משובים חצי־שנתיים</div>';
    if (!m) return h + '<div class="wk-empty">' + esc(feedbackUnavailableText(d)) + '</div></div>';
    var due = m.items.filter(function (x) { return x.status === 'overdue' || x.status === 'soon'; });
    h += due.length ? '<ul class="wk-list wk-fb-list">' + due.map(feedbackLine).join('') + '</ul>'
      : '<div class="wk-empty">אין משובים באיחור או ב-30 הימים הקרובים</div>';
    if (m.unknown) h += '<div class="wk-note">' + esc(plural(m.unknown, 'עובד/ת אחד/ת ללא תאריך התחלה', 'עובדים ללא תאריך התחלה')) + ' — סמנו «בוצע» אחרי המשוב הבא.</div>';
    return h + '<button type="button" class="dash-go" data-go-sub="team">לכל המשובים ←</button></div>';
  }
  /* «צוות ומשמרות»: every employee, with «בוצע» + date (max = today). */
  function feedbackListHtml(d) {
    var m = feedbackModel(d);
    var h = '<div class="card work-card wk-feedback" id="wkFeedback"><div class="card-title">משובים חצי־שנתיים</div>';
    if (!m) return h + '<div class="wk-empty">' + esc(feedbackUnavailableText(d)) + '</div></div>';
    h += '<div class="wk-note">משוב כל 6 חודשים: מהמשוב האחרון, או מתחילת העבודה אם עוד לא היה.</div>';
    if (!m.items.length) return h + '<div class="wk-empty">אין עובדים רשומים בבית</div></div>';
    h += '<ul class="wk-list wk-fb-all">' + m.items.map(function (x, i) {
      return '<li class="wk-fb-' + esc(x.status) + '"><span class="wk-name">' + esc(x.name) + '</span><span class="wk-meta">' +
        esc(FEEDBACK_STATUS[x.status]) + (x.due ? ' · עד ' + esc(fmtDate(x.due)) : '') +
        (x.lastFeedback ? ' · משוב אחרון ' + esc(fmtDate(x.lastFeedback)) : (x.startDate ? ' · התחיל/ה ' + esc(fmtDate(x.startDate)) : '')) + '</span>' +
        '<form class="wk-fb-form" data-fb-form="' + i + '" novalidate><input type="hidden" name="employee" value="' + esc(x.name) + '">' +
        '<label class="wk-dis-label"><span>תאריך המשוב</span><input name="doneAt" type="date" required value="' + esc(m.today) + '" max="' + esc(m.today) + '"></label>' +
        '<button type="submit" class="wk-dis-btn">בוצע</button><span class="wk-msg" data-fb-msg role="status" aria-live="polite"></span></form></li>';
    }).join('') + '</ul>';
    return h + '</div>';
  }
  var FEEDBACK_ERRORS = {
    not_found: 'העובד/ת לא ברשימת העובדים של הבית — רעננו את הדף',
    bad_date: 'תאריך לא תקין (לא בעתיד)',
    roster_unavailable: 'רשימת העובדים לא זמינה כרגע — נסו שוב מאוחר יותר',
    lock_busy: 'השרת עסוק — נסו שוב בעוד רגע'
  };
  function feedbackErrorText(err) {
    var code = err && err.data && typeof err.data.error === 'string' ? err.data.error : '';
    return FEEDBACK_ERRORS[code] || 'השמירה נכשלה — נסו שוב';
  }

  /* ── «סיכומי ישיבות» — READ-ONLY (20 Oct 2026, docs/meeting-summaries.md) ──
   * The coordinators' FINAL team-meeting summaries of THIS house (the server
   * decides the house), one month at a time. No edit. Every value escaped;
   * line breaks kept by CSS (white-space: pre-wrap), never by markup. */
  var SUMMARY_REASON = {
    not_configured: 'סיכומי הישיבות מאפליקציית הרכזים עוד לא מחוברים.',
    coordinators_not_configured: 'סיכומי הישיבות מאפליקציית הרכזים עוד לא מחוברים.',
    unauthorized: 'סיכומי הישיבות מאפליקציית הרכזים עוד לא מחוברים.',
    unknown_action: 'סיכומי הישיבות יופיעו אחרי עדכון אפליקציית הרכזים.'
  };
  var HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function monthLabel(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    return m ? HE_MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  /* The month picker: this month and the 11 before it, newest first. */
  function summaryMonths(today) {
    var m = /^(\d{4})-(\d{2})/.exec(String(today || ''));
    if (!m) return [];
    var y = +m[1], mo = +m[2] - 1, out = [];
    for (var i = 0; i < 12; i++) {
      var yy = y + Math.floor((mo - i) / 12), mm = (((mo - i) % 12) + 12) % 12;
      out.push(yy + '-' + (mm < 9 ? '0' : '') + (mm + 1));
    }
    return out;
  }
  /* st: { month, months, res: undefined (loading) | { error } | { summaries } }. */
  function summariesHtml(st) {
    var h = '<div class="card work-card wk-summaries"><div class="card-title">סיכומי ישיבות צוות</div>';
    h += '<div class="wk-note">הסיכומים שהרכזים כותבים בישיבת הצוות (אחרי «סיום ישיבה»). לקריאה בלבד — רק של הבית שלך.</div>';
    h += '<label class="month-picker wk-ms-month"><span>חודש</span><select data-ms-month aria-label="בחירת חודש לסיכומי ישיבות">' +
      (st.months || []).map(function (ym) { return '<option value="' + esc(ym) + '"' + (ym === st.month ? ' selected' : '') + '>' + esc(monthLabel(ym)) + '</option>'; }).join('') +
      '</select></label>';
    var res = st.res;
    if (!res) return h + '<div class="wk-empty">טוען…</div></div>';
    if (res.error) return h + '<div class="wk-empty error">' + esc(res.error) + '</div><button type="button" class="dash-go" data-ms-retry>נסו שוב</button></div>';
    var s = res.summaries;
    if (!s || s.available !== true || !Array.isArray(s.items)) {
      return h + '<div class="wk-empty">' + esc((s && SUMMARY_REASON[s.reason]) || 'לא הצלחנו לקרוא את סיכומי הישיבות מאפליקציית הרכזים. נסו שוב מאוחר יותר.') + '</div></div>';
    }
    if (!s.items.length) return h + '<div class="wk-empty">אין סיכומי ישיבות ב' + esc(monthLabel(st.month)) + '</div></div>';
    h += s.items.map(function (m) {
      var wd = weekdayOf(m.date);
      return '<details class="wk-ms"><summary><span class="wk-shift">' + esc((WEEKDAYS[wd] ? 'יום ' + WEEKDAYS[wd] + ' ' : '') + fmtDate(m.date)) +
        '</span> <span class="wk-name">' + esc(m.title || 'ישיבת צוות') + '</span> <span class="wk-meta">(' + esc(String((m.rows || []).length)) + ' מטופלים)</span></summary>' +
        (m.attendees ? '<div class="wk-ms-line"><b>משתתפים:</b> ' + esc(m.attendees) + '</div>' : '') +
        (m.generalNotes ? '<div class="wk-ms-text">' + esc(m.generalNotes) + '</div>' : '') +
        (m.rows || []).map(function (r) {
          return '<div class="wk-ms-row"><div class="wk-ms-patient">' + esc(r.patientName) + '</div>' +
            (r.weeklyUpdate ? '<div class="wk-ms-label">עדכון שבועי</div><div class="wk-ms-text">' + esc(r.weeklyUpdate) + '</div>' : '') +
            (r.goals ? '<div class="wk-ms-label">מטרות טיפוליות</div><div class="wk-ms-text">' + esc(r.goals) + '</div>' : '') + '</div>';
        }).join('') + '</details>';
    }).join('');
    return h + '</div>';
  }

  /* «ועדות» sub-tab: every upcoming committee of the house, read-only. */
  function committeesHtml(d) {
    var st = committeesState(d);
    var h = '<div class="card work-card wk-committees"><div class="card-title">ועדות קרובות' + (st.ok ? ' (' + st.items.length + ')' : '') + '</div>';
    h += '<div class="wk-note">את הוועדות קובעים הרכזים באפליקציית הרכזים. כאן — לקריאה בלבד.</div>';
    if (!st.ok) return h + '<div class="wk-empty">' + esc(st.text) + '</div></div>';
    if (!st.items.length) return h + '<div class="wk-empty">אין ועדות קרובות</div></div>';
    h += '<ul class="wk-list">' + st.items.map(function (c) {
      return '<li><span class="wk-shift">' + esc(committeeWhen(c)) + '</span><span class="wk-name">' + esc(c.type) +
        (c.patientName ? ' · ' + esc(c.patientName) : '') + '</span>' +
        (c.participants ? '<span class="wk-meta">משתתפים: ' + esc(c.participants) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
    return h + '</div>';
  }

  function patientsHtml(d) {
    var pats = d.patients || [], outs = d.outpatients || [], visits = d.visits || [], adm = d.admissions || [];
    var dis = d.expectedDischargeSupported === true;
    var modes = dischargeModes(d);
    var h = '';
    h += '<div class="card work-card wk-patients"><div class="card-title">מטופלים בבית (' + pats.length + ')</div>';
    h += pats.length ? '<ul class="wk-list' + (dis ? ' wk-pat-list' : '') + '">' + pats.map(function (p, i) {
      return '<li><span class="wk-name">' + esc(p.name) + '</span><span class="wk-meta">מ-' + esc(fmtDate(p.entryDate)) +
        ' · יום ' + esc(p.days) + (p.status === 'trial' ? ' · ניסיון' : '') + '</span>' + (dis ? dischargeHtml(p, i, modes) : '') + '</li>';
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

  /* ── dashboard: today in the house + this month (14 Oct 2026) ── */
  function addDaysIso(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    var t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return t.toISOString().slice(0, 10);
  }
  function tile(cls, value, label) {
    return '<div class="dash-tile ' + cls + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }
  /* «הבית היום» (20 Oct 2026): what is happening in the house TODAY, from
   * the same houseData the house tabs use — the date and weekday, patients in
   * the house, who is on each shift (בוקר / ערב / לילה, every shift listed
   * even when nobody is assigned), today's therapy sessions by time, and the
   * open requests (follow-ups due). A missing coordinators feed is an
   * explicit empty state with dashes, never zeros. No bonus figure. */
  function timeKey(r) { return /^\d{2}:\d{2}$/.test(String(r && r.time || '')) ? r.time : '99:99'; }
  function todayModel(d) {
    d = d || {};
    var today = isRealIso(d.today) ? d.today : '';
    var wd = weekdayOf(today);
    var t = d.team && d.team.available ? d.team : null;
    var onShift = t ? (t.today || []) : [];
    var groups = {};
    onShift.forEach(function (r) { if (SHIFT_ORDER.indexOf(r.shift) >= 0) (groups[r.shift] = groups[r.shift] || []).push(r); });
    var byId = {};
    Object.keys(LOGS).forEach(function (k) { ((d.logs && d.logs[k]) || []).forEach(function (r) { byId[k + '|' + r.id] = r; }); });
    var requests = ((d.followUps) || []).filter(function (f) { return f && LOGS[f.log]; }).map(function (f) {
      var r = byId[f.log + '|' + f.id] || {};
      return { kind: LOG_LABEL[f.log] || '', head: LOGS[f.log].head(r) || '', date: f.date || '', overdue: !!(today && f.date && f.date < today) };
    });
    return {
      today: today, weekday: WEEKDAYS[wd] || '',
      patients: (d.patients || []).length,
      teamAvailable: !!t,
      teamReason: t ? '' : (TEAM_REASON[(d.team && d.team.reason) || 'not_configured'] || TEAM_REASON.unreadable),
      stale: !!(t && t.stale), updatedAt: t ? t.updatedAt : '',
      onShiftCount: onShift.length,
      shifts: SHIFT_ORDER.map(function (s) { return { shift: s, names: (groups[s] || []).map(function (r) { return r.guideName; }), draft: (groups[s] || []).some(function (r) { return r.draft; }) }; }),
      sessions: t ? (t.therapistWeek || []).filter(function (r) { return r.dayOfWeek === wd; }).slice().sort(function (a, b) {
        var ka = timeKey(a), kb = timeKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0;
      }) : [],
      requests: requests
    };
  }
  function todayShiftsHtml(m) {
    return '<ul class="wk-list wk-shifts">' + m.shifts.map(function (g) {
      return '<li' + (g.names.length ? '' : ' class="wk-shift-empty"') + '><span class="wk-shift">' + esc(g.shift) + '</span><span class="wk-name">' +
        (g.names.length ? g.names.map(esc).join(', ') : 'אין שיבוץ') + '</span>' +
        (g.draft ? '<span class="wk-meta">טיוטה</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function todaySessionsHtml(m) {
    return m.sessions.length
      ? '<ul class="wk-list wk-shifts">' + m.sessions.map(function (r) {
        return '<li><span class="wk-shift">' + esc(r.time || 'ללא שעה') + '</span><span class="wk-name">' + esc(r.therapistName) +
          '</span><span class="wk-meta">עם ' + esc(r.patientName) + '</span></li>';
      }).join('') + '</ul>'
      : '<div class="wk-empty">אין טיפולים משובצים להיום</div>';
  }
  function todayRequestsHtml(m) {
    return m.requests.length
      ? '<ul class="wk-list">' + m.requests.map(function (r) {
        return '<li' + (r.overdue ? ' class="wk-soon"' : '') + '><span class="wk-name">' + esc(r.kind) + (r.head ? ' · ' + esc(r.head) : '') +
          '</span><span class="wk-meta">' + esc(fmtDate(r.date)) + (r.overdue ? ' · באיחור' : '') + '</span></li>';
      }).join('') + '</ul>'
      : '<div class="wk-empty">אין בקשות פתוחות</div>';
  }
  function todayCardHtml(m) {
    var h = '<div class="card dash-card dash-today"><div class="card-title">הבית היום — יום ' + esc(m.weekday) + ' ' + esc(fmtDate(m.today)) + '</div>';
    h += '<div class="dash-tiles">' +
      tile('t-teal', m.patients, 'מטופלים בבית') +
      tile('t-blue', m.teamAvailable ? m.onShiftCount : '—', 'במשמרת היום') +
      tile('t-violet', m.teamAvailable ? m.sessions.length : '—', 'טיפולים היום') +
      tile('t-amber', m.requests.length, 'תזכורות פתוחות') + '</div>';
    if (!m.teamAvailable) {
      h += '<div class="wk-empty">' + esc(m.teamReason) + '</div>';
    } else {
      if (m.stale) h += staleNote({ stale: true, updatedAt: m.updatedAt });
      h += '<div class="card-subtitle">במשמרת היום</div>' + todayShiftsHtml(m);
      h += '<div class="card-subtitle">טיפולים היום</div>' + todaySessionsHtml(m);
    }
    h += '<div class="card-subtitle">בקשות פתוחות</div>' + todayRequestsHtml(m);
    return h + '</div>';
  }
  /* Admin landing tab: one «הבית היום» card per house, from the cached
   * houseData (loaded by mountAdmin). A house still loading / failed says so. */
  function todayAllHtml(rows, labels) {
    labels = labels || {};
    return (rows || []).map(function (row) {
      var name = esc(labels[row.key] || row.key);
      if (!row.data) {
        return '<div class="card dash-card today-house"><div class="card-title">' + name + '</div><div class="wk-empty' + (row.error ? ' error' : '') + '">' +
          (row.error ? 'שגיאה בטעינת נתוני הבית' : 'טוען…') + '</div></div>';
      }
      var m = todayModel(row.data);
      var h = '<div class="card dash-card today-house"><div class="card-title"><span>' + name + '</span><span class="wk-meta">יום ' + esc(m.weekday) + ' ' + esc(fmtDate(m.today)) + '</span></div>';
      h += '<div class="dash-tiles">' +
        tile('t-teal', m.patients, 'מטופלים בבית') +
        tile('t-blue', m.teamAvailable ? m.onShiftCount : '—', 'במשמרת היום') +
        tile('t-violet', m.teamAvailable ? m.sessions.length : '—', 'טיפולים היום') +
        tile('t-amber', m.requests.length, 'תזכורות פתוחות') + '</div>';
      h += m.teamAvailable ? todayShiftsHtml(m) : '<div class="wk-empty">' + esc(m.teamReason) + '</div>';
      h += '<button type="button" class="dash-go" data-today-open="' + esc(row.key) + '">לבית ←</button>';
      return h + '</div>';
    }).join('');
  }

  function dashboardHtml(d) {
    d = d || {};
    var today = d.today || '';
    var wd = weekdayOf(today);
    var visits = d.visits || [], adm = d.admissions || [];
    var weekStart = wd >= 0 ? addDaysIso(today, -wd) : '';
    var weekEnd = weekStart ? addDaysIso(weekStart, 6) : '';
    var weekVisits = visits.filter(function (v) { return weekStart && v.date >= weekStart && v.date <= weekEnd; });
    var upcoming = visits.filter(function (v) { return today && v.date >= today; }).sort(function (a, b) {
      var ka = a.date + (a.time || ''), kb = b.date + (b.time || ''); return ka < kb ? -1 : ka > kb ? 1 : 0;
    }).slice(0, 5);
    var events = ((d.logs && d.logs.events) || []).slice(0, 3);
    var expected = (d.expectedAdmissions || []).filter(function (x) { return x && x.date && x.date >= today; });
    var expectedWeek = expected.filter(function (x) { return weekEnd && x.date <= weekEnd; });

    var h = todayCardHtml(todayModel(d));
    h += feedbackCardHtml(d);

    h += '<div class="card dash-card dash-month"><div class="card-title">ביקורים וקליטות</div>';
    h += '<div class="dash-tiles">' +
      tile('t-pink', weekVisits.length, 'ביקורים השבוע') +
      tile('t-green', d.expectedAdmissions ? expectedWeek.length : '—', 'קליטות צפויות השבוע') +
      tile('t-blue', visits.length, 'ביקורים החודש') +
      tile('t-violet', adm.length, 'נקלטו החודש') + '</div>';
    h += '<div class="card-subtitle">קליטות צפויות (שבועיים קרובים)</div>' + (!d.expectedAdmissions
      ? '<div class="wk-empty">הנתון יופיע אחרי עדכון השרת</div>'
      : expected.length
        ? '<ul class="wk-list">' + expected.slice(0, 8).map(function (x) {
          var thisWeek = weekEnd && x.date <= weekEnd;
          return '<li' + (thisWeek ? ' class="wk-soon"' : '') + '><span class="wk-name">' + esc(x.name) + '</span><span class="wk-meta">' +
            esc((WEEKDAYS[weekdayOf(x.date)] ? 'יום ' + WEEKDAYS[weekdayOf(x.date)] + ' ' : '') + fmtDate(x.date)) +
            (STAGE_LABELS[x.stage] ? ' · ' + esc(STAGE_LABELS[x.stage]) : '') + (thisWeek ? ' · השבוע' : '') + '</span></li>';
        }).join('') + '</ul>'
        : '<div class="wk-empty">אין קליטות מתוכננות בשבועיים הקרובים</div>');
    h += '<div class="card-subtitle">ביקורים קרובים</div>' + (upcoming.length
      ? '<ul class="wk-list">' + upcoming.map(function (v) {
        return '<li><span class="wk-name">' + esc(v.name) + '</span><span class="wk-meta">' + esc(fmtDate(v.date)) +
          (v.time ? ' ' + esc(v.time) : '') + (v.meetingWith ? ' · עם ' + esc(v.meetingWith) : '') + '</span></li>';
      }).join('') + '</ul>'
      : '<div class="wk-empty">אין ביקורים קרובים ברשימה</div>');
    if (adm.length) {
      h += '<div class="card-subtitle">נקלטו לאחרונה</div><ul class="wk-list">' + adm.slice(0, 3).map(function (a) {
        return '<li><span class="wk-name">' + esc(a.name) + '</span><span class="wk-meta">' + esc(fmtDate(a.date)) + '</span></li>';
      }).join('') + '</ul>';
    }
    h += '</div>';

    h += '<div class="card dash-card dash-events"><div class="card-title">אירועים חריגים אחרונים</div>' + (events.length
      ? '<ul class="wk-list">' + events.map(function (r) {
        return '<li><span class="wk-name">' + esc(LOGS.events.head(r)) + '</span><span class="wk-meta">' + esc(fmtDate(r.eventDate)) + '</span></li>';
      }).join('') + '</ul>'
      : '<div class="wk-empty">אין אירועים חריגים רשומים</div>') +
      '<button type="button" class="dash-go" data-go-sub="events">לאירועים החריגים ←</button></div>';
    return h;
  }

  /* ── stage 3: the house's manpower cost (14 Oct 2026) ─────── */
  var COST_REASON = {
    not_configured: 'הנתון מאפליקציית הסטאפינג עוד לא מחובר.',
    unauthorized: 'הנתון מאפליקציית הסטאפינג עוד לא מחובר.',
    no_house: 'אין נתוני עלות לבית הזה בסטאפינג.'
  };
  var HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function monthHe(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    return m ? HE_MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  function ils(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('en-US') + ' ₪';
  }
  function costHtml(r) {
    var c = r && r.cost;
    var title = '<div class="card-title">עלות כוח אדם' + (r && r.month ? ' — ' + esc(monthHe(r.month)) : '') + '</div>';
    if (!c || !c.available) {
      var msg = (c && COST_REASON[c.reason]) || 'לא הצלחנו לקרוא את העלות מהסטאפינג. נסו שוב מאוחר יותר.';
      return title + '<div class="wk-empty">' + esc(msg) + '</div>';
    }
    var total = Math.max(0, Number(c.total) || 0);
    var budget = c.budget === null || c.budget === undefined ? null : Math.max(0, Number(c.budget) || 0);
    var h = title + '<div class="cost-total"><b>' + esc(ils(total)) + '</b><span>עלות משוערת לחודש</span></div>';
    if (budget) {
      var pct = Math.round((total / budget) * 100);
      var over = total > budget;
      h += '<div class="cost-bar' + (over ? ' over' : '') + '"><div class="cost-fill" style="width:' + Math.min(100, Math.max(0, pct)) + '%"></div></div>' +
        '<div class="cost-budget">' + esc('תקציב ' + ils(budget) + ' · ' + pct + '% מהתקציב') +
        (over ? ' · <b class="cost-over">' + esc('חריגה של ' + ils(total - budget)) + '</b>'
              : ' · ' + esc('נשארו ' + ils(budget - total))) + '</div>';
    }
    h += '<div class="dash-tiles cost-tiles">' +
      tile('t-blue', ils(c.instructors), 'מדריכים') +
      tile('t-green', ils(c.confirmed), 'לפי דוח שכר') +
      tile('t-amber', ils(c.estimated), 'הערכה') +
      (Number(c.missingData) > 0 ? tile('t-pink', ils(c.missingData), 'חסרים נתונים') : '') + '</div>';
    h += '<div class="wk-note cost-note">' + esc(c.hasActuals
      ? 'חלק מהעלות כבר לפי דוח השכר, והשאר הערכה.'
      : 'עדיין אין דוח שכר לחודש הזה — כל הסכום הוא הערכה.') +
      (c.stale ? ' ' + esc('(הנתון לא התעדכן לאחרונה)') : '') + '</div>';
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
      var canEdit = r.canEdit === true;
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
    var due = ((d && d.followUps) || []).filter(function (f) { return LOGS[f.log]; });
    if (!due.length) return '';
    var byId = {};
    Object.keys(LOGS).forEach(function (k) { ((d.logs && d.logs[k]) || []).forEach(function (r) { byId[k + '|' + r.id] = r; }); });
    return '<div class="wk-followups"><div class="wk-fu-title">🔔 ' + esc(plural(due.length, 'תזכורת אחת למעקב', 'תזכורות למעקב')) + '</div><ul>' +
      due.map(function (f) {
        var r = byId[f.log + '|' + f.id] || {};
        var canEdit = r.canEdit === true;
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
    dischargeHtml: dischargeHtml, dischargeCheck: dischargeCheck, DISCHARGE_ERRORS: DISCHARGE_ERRORS,
    dischargeModes: dischargeModes, dischargeStateOf: dischargeStateOf, dischargeToken: dischargeToken, DISCHARGE_DONE: DISCHARGE_DONE,
    committeesHtml: committeesHtml, committeesState: committeesState, committeeWhen: committeeWhen,
    summariesHtml: summariesHtml, summaryMonths: summaryMonths, monthLabel: monthLabel, SUMMARY_REASON: SUMMARY_REASON,
    feedbackModel: feedbackModel, feedbackCardHtml: feedbackCardHtml, feedbackListHtml: feedbackListHtml, feedbackErrorText: feedbackErrorText,
    COMMITTEE_REASON: COMMITTEE_REASON,
    WORK_ERRORS: WORK_ERRORS, dischargeErrorText: dischargeErrorText, setDischargeBusy: setDischargeBusy,
    teamHtml: teamHtml, therapistsHtml: therapistsHtml, telHref: telHref, dashboardHtml: dashboardHtml, costHtml: costHtml,
    todayModel: todayModel, todayCardHtml: todayCardHtml, todayAllHtml: todayAllHtml, SHIFT_ORDER: SHIFT_ORDER,
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
      err.status = r.status;
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

  var costCache = {};
  function loadCost(panel, key) {
    var hostEl = panel.querySelector('[data-dash-cost]');
    if (!hostEl) return;
    var c = costCache[key];
    if (c && Date.now() - c.at < 600000) { hostEl.innerHTML = costHtml(c.data); return; }
    post({ op: 'houseCost', house: key }).then(function (r) {
      costCache[key] = { at: Date.now(), data: r };
      hostEl.innerHTML = costHtml(r);
    }).catch(function () {
      hostEl.innerHTML = costHtml({ cost: { available: false, reason: 'error' } });
    });
  }

  function host(panel, sub) { return panel.querySelector('[data-sub-panel="' + sub + '"]'); }

  function renderAll(panel, key, d) {
    var u = me();
    var fu = panel.querySelector('[data-followups]');
    if (fu) fu.innerHTML = followUpsHtml(d, u);
    var p = host(panel, 'patients');
    if (p) {
      // A redraw (refresh, a second load) must not close a date picker the
      // person has open: remember it and reopen it with what they picked.
      var open = p.querySelector('[data-dis-form]:not([hidden])');
      var keep = open ? { i: open.getAttribute('data-dis-form'), v: open.elements.expectedDate.value } : null;
      p.innerHTML = patientsHtml(d);
      if (keep) reopenDischargeForm(p, keep.i, keep.v);
      // A save still in flight keeps its form busy across the redraw.
      if (keep && savingDischarge[key + '|' + keep.i]) setDischargeBusy(p.querySelector('[data-dis-form="' + Number(keep.i) + '"]'), true, savingDischarge[key + '|' + keep.i]);
    }
    var dh = panel.querySelector('[data-dash-house]');
    if (dh) dh.innerHTML = dashboardHtml(d);
    renderHouseAlerts(panel, key, d);
    var tm = host(panel, 'team');
    if (tm) tm.innerHTML = teamHtml(d) + feedbackListHtml(d);
    var th = host(panel, 'therapists');
    if (th) th.innerHTML = therapistsHtml(d);
    var cmt = host(panel, 'committees');
    if (cmt) cmt.innerHTML = committeesHtml(d);
    if (pendingEdit[key] != null) {
      var pi = pendingEdit[key]; delete pendingEdit[key];
      if (pi === 'list') showSub(panel, 'patients'); else openDischargeEdit(panel, pi);
    }
    renderAdminAlerts();
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
    var subs = ['patients', 'team', 'therapists', 'committees'].concat(Object.keys(LOGS));
    try {
      var d = await load(key, force);
      renderAll(panel, key, d);
    } catch (e) {
      var msg = e && e.data && e.data.error === 'unauthorized'
        ? 'כלי העבודה עוד לא הופעל בשרת. פנו לסנדרה.'
        : 'שגיאה בטעינת הנתונים: ' + (e && e.message ? e.message : '');
      subs.forEach(function (s) { var h = host(panel, s); if (h) h.innerHTML = '<div class="card work-card"><div class="wk-empty error">' + esc(msg) + '</div></div>'; });
      var dh = panel.querySelector('[data-dash-house]');
      if (dh) dh.innerHTML = '<div class="card dash-card"><div class="wk-empty error">' + esc(msg) + '</div></div>';
      var al = panel.querySelector('[data-dash-alerts]');
      if (al) al.textContent = '';
      if (root.DischargeAlerts && root.document) root.DischargeAlerts.setBadge(root.document, panel.querySelector('[data-sub="home"]'), 0);
      var cma = panel.querySelector('[data-dash-committees]');
      if (cma) cma.textContent = '';
      if (root.CommitteeAlerts && root.document) root.CommitteeAlerts.setBadge(root.document, panel.querySelector('[data-sub="home"]'), 0);
    }
  }

  /* ── discharge alerts (Task E, 15 Oct 2026) ─────────────────
   * «שחרור קרוב» on the house's «ראשי» + a badge on its sub-tab, and (admin
   * only) an all-houses card with a house filter on the overview. Computed
   * from the cached houseData — no extra request for a house; text-only DOM
   * (public/discharge-alerts.js). */
  var pendingEdit = {};   // houseKey → patient index to open once its list is drawn
  function renderHouseAlerts(panel, key, d) {
    var DA = root.DischargeAlerts;
    var hostEl = panel.querySelector('[data-dash-alerts]');
    if (!DA || !hostEl || !root.document) return;
    var model = DA.houseAlerts(d, key, DA.israelToday());
    hostEl.textContent = '';
    if (model.supported) hostEl.appendChild(DA.renderCard(root.document, model, { listHouse: key }));
    DA.setBadge(root.document, panel.querySelector('[data-sub="home"]'), model.supported ? model.count : 0);
    renderHouseCommittees(panel, key, d);
  }
  /* «ועדות קרובות» on the house's «ראשי» (above the discharge alerts) + its badge. */
  function renderHouseCommittees(panel, key, d) {
    var CA = root.CommitteeAlerts;
    var hostEl = panel.querySelector('[data-dash-committees]');
    if (!CA || !hostEl || !root.document) return;
    var model = CA.houseAlerts(d, key, CA.israelToday());
    hostEl.textContent = '';
    // Always drawn (20 Oct 2026): the upcoming committees, or why they are not available.
    hostEl.appendChild(CA.renderCard(root.document, model));
    CA.setBadge(root.document, panel.querySelector('[data-sub="home"]'), model.supported ? model.count : 0);
  }
  function reopenDischargeForm(p, i, value) {
    var f = p.querySelector('[data-dis-form="' + Number(i) + '"]');
    if (!f) return;
    f.hidden = false;
    var row = f.closest('[data-dis-row]');
    if (row) row.querySelectorAll('[data-dis-edit]').forEach(function (b) { b.hidden = true; });
    if (value) f.elements.expectedDate.value = value;
  }
  /* Show «מטופלים» and open patient i's date picker. */
  function openDischargeEdit(panel, i) {
    showSub(panel, 'patients');
    var b = panel.querySelector('[data-dis-edit="' + Number(i) + '"]');
    if (!b) return;
    b.click();
    var row = b.closest && b.closest('li');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function onAlertClick(ev, panelFor) {
    var t = ev.target;
    var edit = t.closest && t.closest('[data-alert-edit]');
    var list = t.closest && t.closest('[data-alert-list]');
    if (!edit && !list) return false;
    var parts = (edit ? edit.getAttribute('data-alert-edit') : list.getAttribute('data-alert-list') + '|').split('|');
    var house = parts[0];
    var panel = panelFor(house);
    if (!panel) return true;
    if (edit) {
      if (panel.querySelector('[data-dis-edit="' + Number(parts[1]) + '"]')) openDischargeEdit(panel, parts[1]);
      else pendingEdit[house] = Number(parts[1]);
    } else {
      showSub(panel, 'patients');
    }
    return true;
  }

  var admin = { el: null, keys: [], labels: {}, filter: '', cmEl: null, cmFilter: '', todayEl: null, failed: {} };
  /* Admin landing tab «הבית היום»: one card per house (cached houseData). */
  function renderTodayAll() {
    if (!admin.todayEl) return;
    admin.todayEl.innerHTML = todayAllHtml(admin.keys.map(function (k) {
      return { key: k, data: cache[k] ? cache[k].data : null, error: !cache[k] && !!admin.failed[k] };
    }), admin.labels);
  }
  /* Admin overview: «ועדות קרובות — כל הבתים» with its own house filter. */
  function renderAdminCommittees() {
    var CA = root.CommitteeAlerts;
    if (!CA || !admin.cmEl || !root.document) return;
    var today = CA.israelToday();
    var models = admin.keys.filter(function (k) { return cache[k]; }).map(function (k) { return CA.houseAlerts(cache[k].data, k, today); });
    var opts = [{ value: '', label: 'כל הבתים' }].concat(admin.keys.map(function (k) { return { value: k, label: admin.labels[k] || k }; }));
    admin.cmEl.textContent = '';
    admin.cmEl.appendChild(CA.renderCard(root.document, CA.mergeAlerts(models, admin.cmFilter),
      { title: 'ועדות קרובות — כל הבתים', labels: admin.labels, filter: { value: admin.cmFilter, options: opts } }));
    admin.cmEl.hidden = false;
  }
  function renderAdminAlerts() {
    renderAdminCommittees();
    renderTodayAll();
    var DA = root.DischargeAlerts;
    if (!DA || !admin.el || !root.document) return;
    var today = DA.israelToday();
    var models = admin.keys.filter(function (k) { return cache[k]; }).map(function (k) { return DA.houseAlerts(cache[k].data, k, today); });
    var opts = [{ value: '', label: 'כל הבתים' }].concat(admin.keys.map(function (k) { return { value: k, label: admin.labels[k] || k }; }));
    admin.el.textContent = '';
    admin.el.appendChild(DA.renderCard(root.document, DA.mergeAlerts(models, admin.filter),
      { title: 'שחרורים קרובים — כל הבתים', labels: admin.labels, filter: { value: admin.filter, options: opts } }));
    admin.el.hidden = false;
  }
  /* Admin overview: load every house's houseData (cached 60 s, shared with the
   * house tabs) and show the merged alerts. The server refuses this for a
   * manager anyway — houseData is pinned to their own house. */
  function mountAdmin(el, keys, labels, todayEl) {
    var u = me();
    if (!el || !u || u.role !== 'admin') return;
    admin.el = el; admin.keys = (keys || []).slice(); admin.labels = labels || {};
    if (todayEl && todayEl.getAttribute('data-wired') !== '1') {
      admin.todayEl = todayEl;
      todayEl.setAttribute('data-wired', '1');
      todayEl.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-today-open]');
        if (!b) return;
        var house = b.getAttribute('data-today-open');
        if (admin.keys.indexOf(house) < 0) return;
        var tab = root.document.querySelector('.tab[data-tab="' + house + '"]');
        if (tab) tab.click();
      });
    }
    var cmEl = root.document && root.document.getElementById('committeeAlertsAll');
    if (cmEl && cmEl.getAttribute('data-wired') !== '1') {
      admin.cmEl = cmEl;
      cmEl.setAttribute('data-wired', '1');
      cmEl.addEventListener('change', function (ev) {
        if (!ev.target.matches || !ev.target.matches('[data-cm-filter]')) return;
        admin.cmFilter = admin.keys.indexOf(ev.target.value) >= 0 ? ev.target.value : '';
        renderAdminCommittees();
      });
      cmEl.addEventListener('click', function (ev) {
        // Read-only (20 Oct 2026): «לוועדות של הבית» opens the house's «ועדות» sub-tab.
        var b = ev.target.closest && ev.target.closest('[data-cm-alert-open]');
        if (!b) return;
        var house = b.getAttribute('data-cm-alert-open');
        if (admin.keys.indexOf(house) < 0) return;
        var tab = root.document.querySelector('.tab[data-tab="' + house + '"]');
        if (tab) tab.click();
        var panel = root.document.getElementById('panel-' + house);
        if (panel) showSub(panel, 'committees');
      });
    }
    if (el.getAttribute('data-wired') !== '1') {
      el.setAttribute('data-wired', '1');
      el.addEventListener('change', function (ev) {
        if (!ev.target.matches || !ev.target.matches('[data-alert-filter]')) return;
        admin.filter = admin.keys.indexOf(ev.target.value) >= 0 ? ev.target.value : '';
        renderAdminAlerts();
      });
      el.addEventListener('click', function (ev) {
        var t = ev.target;
        var edit = t.closest && t.closest('[data-alert-edit]');
        var list = t.closest && t.closest('[data-alert-list]');
        if (!edit && !list) return;
        var parts = (edit ? edit.getAttribute('data-alert-edit') : list.getAttribute('data-alert-list') + '|').split('|');
        var house = parts[0];
        if (admin.keys.indexOf(house) < 0) return;
        // The house tab may not be drawn yet: queue the action; renderAll runs it.
        pendingEdit[house] = edit ? Number(parts[1]) : 'list';
        var tab = root.document.querySelector('.tab[data-tab="' + house + '"]');
        if (tab) tab.click();
        var panel = root.document.getElementById('panel-' + house);
        if (panel && host(panel, 'patients') && panel.querySelector(edit ? '[data-dis-edit="' + Number(parts[1]) + '"]' : '[data-dis-row], .wk-patients')) {
          delete pendingEdit[house];
          if (edit) openDischargeEdit(panel, parts[1]); else showSub(panel, 'patients');
        }
      });
    }
    renderAdminAlerts();
    Promise.all(admin.keys.map(function (k) {
      return load(k, false).then(function (d) { delete admin.failed[k]; return d; })
        .catch(function () { admin.failed[k] = true; return null; });
    })).then(renderAdminAlerts);
  }

  function showSub(panel, sub) {
    panel.querySelectorAll('[data-sub]').forEach(function (b) {
      var on = b.getAttribute('data-sub') === sub;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panel.querySelectorAll('[data-sub-panel]').forEach(function (s) { s.hidden = s.getAttribute('data-sub-panel') !== sub; });
    if (sub === 'summaries') loadSummaries(panel, panel.getAttribute('data-house-key'));
  }

  /* «סיכומי ישיבות»: fetched only when the sub-tab is opened, per house + month,
   * kept 5 minutes. A failure is an explicit error with «נסו שוב». */
  var summaryState = {};   // houseKey → { month, data: { ym: { at, res } } }
  function paintSummaries(panel, key) {
    var hostEl = host(panel, 'summaries');
    var st = summaryState[key];
    if (!hostEl || !st) return;
    var c = st.data[st.month];
    hostEl.innerHTML = summariesHtml({ month: st.month, months: st.months, res: c ? c.res : null });
  }
  function loadSummaries(panel, key, force) {
    if (!panel || !key) return;
    var today = (cache[key] && cache[key].data && cache[key].data.today) || (root.CommitteeAlerts ? root.CommitteeAlerts.israelToday() : '');
    var st = summaryState[key] || (summaryState[key] = { month: String(today).slice(0, 7), months: summaryMonths(today), data: {} });
    var ym = st.month, c = st.data[ym];
    if (!force && c && (c.res && !c.res.error) && Date.now() - c.at < 300000) { paintSummaries(panel, key); return; }
    st.data[ym] = { at: Date.now(), res: null };
    paintSummaries(panel, key);
    post({ op: 'meetingSummaries', house: key, month: ym }).then(function (r) {
      st.data[ym] = { at: Date.now(), res: { summaries: r && r.summaries } };
    }).catch(function (e) {
      st.data[ym] = { at: Date.now(), res: { error: 'לא הצלחנו לטעון את סיכומי הישיבות כרגע.' } };   // never a raw code
    }).then(function () { if (st.month === ym) paintSummaries(panel, key); });
  }

  function wire(panel, key) {
    if (panel.getAttribute('data-wk-wired') === '1') return;
    panel.setAttribute('data-wk-wired', '1');
    panel.addEventListener('click', async function (ev) {
      var t = ev.target;
      if (onAlertClick(ev, function (house) { return house === key ? panel : null; })) return;
      if (t.closest && t.closest('[data-ms-retry]')) { loadSummaries(panel, key, true); return; }
      var cmOpen = t.closest && t.closest('[data-cm-alert-open]');
      if (cmOpen) { if (cmOpen.getAttribute('data-cm-alert-open') === key) showSub(panel, 'committees'); return; }
      var subBtn = t.closest && t.closest('[data-sub]');
      if (subBtn) { showSub(panel, subBtn.getAttribute('data-sub')); return; }
      var go = t.closest && t.closest('[data-go-sub]');
      if (go) {
        showSub(panel, go.getAttribute('data-go-sub'));
        var nav = panel.querySelector('[data-subtabs]');
        if (nav && nav.scrollIntoView) nav.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      var disMode = t.closest && t.closest('[data-dis-mode]');
      if (disMode) {
        var mf = disMode.closest('[data-dis-form]');
        if (mf) await saveDischarge(panel, key, mf, undefined, disMode.getAttribute('data-dis-mode'));
        return;
      }
      var disEdit = t.closest && t.closest('[data-dis-edit]');
      var disCancel = t.closest && t.closest('[data-dis-cancel]');
      if (disEdit || disCancel) {
        var row = (disEdit || disCancel).closest('[data-dis-row]');
        var f = row && row.querySelector('[data-dis-form]');
        if (!f) return;
        if (f.getAttribute('data-dis-busy') === '1') return;   // saving: «ביטול» waits for the answer
        f.hidden = !!disCancel;
        row.querySelectorAll('[data-dis-edit]').forEach(function (b) { b.hidden = !disCancel; });
        var inp = f.querySelector('input[type="date"]');
        if (disEdit && inp) {
          inp.focus();
          try { if (inp.showPicker) inp.showPicker(); } catch (e) { /* not allowed here — the field is still usable */ }
        }
        return;
      }
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
    panel.addEventListener('change', function (ev) {
      var sel = ev.target.closest && ev.target.closest('[data-ms-month]');
      if (!sel) return;
      var st = summaryState[key];
      if (!st || st.months.indexOf(sel.value) < 0) return;   // only a month the picker offered
      st.month = sel.value;
      loadSummaries(panel, key);
    });
    panel.addEventListener('input', function (ev) {
      var f = ev.target.closest && ev.target.closest('[data-wk-form]');
      if (f) f.setAttribute('data-wk-dirty', '1');
    });
    panel.addEventListener('submit', async function (ev) {
      var fbForm = ev.target.closest && ev.target.closest('[data-fb-form]');
      if (fbForm) { ev.preventDefault(); await saveFeedback(panel, key, fbForm); return; }
      var dform = ev.target.closest && ev.target.closest('[data-dis-form]');
      if (dform) { ev.preventDefault(); await saveDischarge(panel, key, dform); return; }
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

  /* Busy state of one discharge form — text-only DOM (textContent, disabled,
   * hidden, attributes; never innerHTML). While saving: the date, «שמירה» and
   * «ביטול» are disabled, the button shows a spinner and «שומר...». Off: the
   * form is restored as it was (the picked date is never touched). */
  function setDischargeBusy(form, busy, mode) {
    if (!form) return;
    var m = mode === 'clear' || mode === 'none' ? mode : 'set';
    if (busy) { form.setAttribute('data-dis-busy', '1'); form.setAttribute('aria-busy', 'true'); }
    else { form.removeAttribute('data-dis-busy'); form.removeAttribute('aria-busy'); }
    Array.prototype.forEach.call(form.querySelectorAll('input, button'), function (el) { el.disabled = !!busy; });
    // The spinner and «שומר...» sit on the button that was tapped.
    var spin = form.querySelector('[data-dis-spin]');
    if (spin) spin.hidden = !(busy && m === 'set');
    var label = form.querySelector('[data-dis-save-label]');
    if (label) label.textContent = busy && m === 'set' ? 'שומר...' : 'שמירה';
    Array.prototype.forEach.call(form.querySelectorAll('[data-dis-mode]'), function (b) {
      var on = busy && b.getAttribute('data-dis-mode') === m;
      var sp = b.querySelector('[data-dis-mode-spin]');
      if (sp) sp.hidden = !on;
      var lb = b.querySelector('[data-dis-mode-label]');
      if (lb) lb.textContent = on ? 'שומר...' : (b.getAttribute('data-dis-mode') === 'none' ? 'אין צפי לשחרור' : 'ניקוי תאריך');
    });
    if (busy) { var msg = form.querySelector('[data-dis-msg]'); if (msg) msg.textContent = ''; }
  }

  /* Saves in flight, by house|row — survives a redraw of the list (refresh),
   * so a second tap or Enter can never send a second request. */
  var savingDischarge = {};

  /* Save one patient's expected discharge date (the row's index in the
   * last-loaded houseData). previousDate = the value this screen showed, so
   * the backend refuses (conflict) instead of silently overwriting a newer one.
   * mode: 'set' (default, the picked date), 'clear' («ניקוי תאריך») or 'none'
   * («אין צפי לשחרור») — same spinner, error reasons and concurrency check.
   * deps (tests only): { post, refresh, cache }. */
  async function saveDischarge(panel, key, form, deps, mode) {
    var d = deps || { post: post, refresh: refresh, cache: cache };
    var m = mode === 'clear' || mode === 'none' ? mode : 'set';
    var i = form.getAttribute('data-dis-form');
    var slot = key + '|' + i;
    if (savingDischarge[slot] || form.getAttribute('data-dis-busy') === '1') return;   // double tap
    var msg = form.querySelector('[data-dis-msg]');
    var c = d.cache[key];
    var p = c && c.data && (c.data.patients || [])[Number(i)];
    if (!p) { msg.textContent = DISCHARGE_ERRORS.not_found; return; }
    var value = String(form.elements.expectedDate.value || '').trim();
    if (m === 'set') {
      var bad = dischargeCheck(value, p.entryDate);
      if (bad) { msg.textContent = bad; return; }
    }
    var prev = dischargeToken(p);
    savingDischarge[slot] = m;
    setDischargeBusy(form, true, m);
    var body = { op: 'dischargeSet', house: key, patientName: p.name, entryDate: p.entryDate, expectedDate: m === 'set' ? value : '', previousDate: prev };
    if (m !== 'set') body.mode = m;
    try {
      await d.post(body);
    } catch (e) {
      delete savingDischarge[slot];
      var text = dischargeErrorText(e);
      var code = e && e.data && e.data.error;
      if (code === 'conflict') await d.refresh(panel, key, true);
      // A redraw may have replaced the form: restore whichever is current,
      // open, with the picked date kept and the reason shown.
      var again = panel.querySelector('[data-dis-form="' + i + '"]') || form;
      setDischargeBusy(form, false);
      if (again !== form) setDischargeBusy(again, false);
      again.hidden = false;
      var r2 = again.closest && again.closest('[data-dis-row]');
      if (r2) r2.querySelectorAll('[data-dis-edit]').forEach(function (b) { b.hidden = true; });
      if (again.elements && again.elements.expectedDate) again.elements.expectedDate.value = value;
      var m2 = again.querySelector('[data-dis-msg]');
      if (m2) m2.textContent = text;
      return;
    }
    // Saved: close the picker BEFORE the redraw (a redraw keeps an open one),
    // then confirm on the redrawn row.
    delete savingDischarge[slot];
    setDischargeBusy(form, false);
    form.hidden = true;
    await d.refresh(panel, key, true);
    var row = panel.querySelector('[data-dis-row="' + i + '"]');
    var flash = row && row.querySelector('[data-dis-flash]');
    if (flash) flash.textContent = DISCHARGE_DONE[m];
  }

  /* «בוצע» for one employee: one request (double taps ignored), the
   * Dashboard appends to FeedbackLog; then the house data is reloaded. */
  async function saveFeedback(panel, key, form, deps) {
    var d = deps || { post: post, refresh: refresh };
    if (form.getAttribute('data-fb-busy') === '1') return;
    var msg = form.querySelector('[data-fb-msg]');
    var employee = String(form.elements.employee.value || '').trim();
    var doneAt = String(form.elements.doneAt.value || '').trim();
    var today = String(form.elements.doneAt.getAttribute('max') || '');
    if (!FD || !FD.validDoneAt(doneAt, today)) { if (msg) msg.textContent = FEEDBACK_ERRORS.bad_date; return; }
    form.setAttribute('data-fb-busy', '1');
    Array.prototype.forEach.call(form.querySelectorAll('input, button'), function (el) { el.disabled = true; });
    if (msg) msg.textContent = 'שומר...';
    try {
      await d.post({ op: 'feedbackDone', house: key, employee: employee, doneAt: doneAt });
    } catch (e) {
      form.removeAttribute('data-fb-busy');
      Array.prototype.forEach.call(form.querySelectorAll('input, button'), function (el) { el.disabled = false; });
      if (msg) msg.textContent = feedbackErrorText(e);
      return;
    }
    await d.refresh(panel, key, true);
  }

  /* Called by app.js after a house tab is drawn. */
  function onHouseRendered(panel, key) {
    if (!panel || !panel.querySelector('[data-subtabs]')) return;
    wire(panel, key);
    refresh(panel, key, false);
    loadCost(panel, key);
  }

  WorkView.saveDischarge = saveDischarge;   // tests drive it with injected post / refresh / cache
  WorkView.saveFeedback = saveFeedback;
  root.WorkView = WorkView;
  root.Work = { onHouseRendered: onHouseRendered, showSub: showSub, mountAdmin: mountAdmin, renderTodayAll: renderTodayAll, _cache: cache };
  if (typeof module === 'object' && module.exports) module.exports = WorkView;
}(typeof self !== 'undefined' ? self : this));
