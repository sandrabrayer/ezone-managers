/* «פגישות קליטה» — intake meetings and their reports (19 Nov 2026, docs/meeting-reports.md).
 *
 * Sandra: the meetings Vered schedules must appear in the app (whatever WhatsApp message the
 * manager got), and the manager reports here whether each one happened — if not, why (לא הגיעו /
 * נדחתה / בוטלה…); if it did, the result. The report lands on the SAME Dashboard lead row as the
 * /meeting-report link (unread for Vered), and «שלח לקבוצה» sends the SAME WhatsApp text.
 *
 * Data: POST /api/work op 'meetings' / 'meetingReport' → the Dashboard's managersWork. The server
 * decides the house and the reporter; nothing here is trusted for scope.
 *
 * Pure builders on top (unit-tested in test/meetings.test.js), DOM wiring at the bottom. Every
 * value from the feed is escaped; free text is never turned into markup. ES5, like work.js. */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (parseInt(m[3], 10) + '/' + parseInt(m[2], 10) + '/' + m[1].slice(2)) : '';
  }
  function dmy(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso == null ? '' : iso);
  }
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function weekdayOf(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    return WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  }
  function addDays(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
  }

  /* ── the allowlists — KEEP IN SYNC with the Dashboard (Code.gs MEETING_REPORT_OUTCOMES,
   *    MEETING_NOT_HELD_KEYS, MEETING_COMPANION_KEYS; meeting-report.js labels) ── */
  var OUTCOME_LABELS = {
    advancing: 'התקיימה — מתקדם לכניסה',
    undecided: 'התקיימה — מתלבט',
    not_fit: 'התקיימה — לא מתאים',
    no_show: 'לא הגיע / בוטל'
  };
  var HELD_OUTCOMES = ['advancing', 'undecided', 'not_fit'];
  var HELD_SHORT = { advancing: 'מתקדם לכניסה', undecided: 'מתלבט', not_fit: 'לא מתאים' };
  var NOT_HELD_LABELS = {
    no_show: 'לא הגיעו',
    postponed: 'נדחתה',
    cancelled_family: 'בוטלה ע"י הפונה/המשפחה',
    cancelled_us: 'בוטלה על ידינו',
    other: 'אחר'
  };
  var NOT_HELD_ORDER = ['no_show', 'postponed', 'cancelled_family', 'cancelled_us', 'other'];
  var COMPANION_LABELS = {
    mother: 'אמא', father: 'אבא', parents: 'הורים', partner: 'בן/בת זוג',
    sibling: 'אח/אחות', friend: 'חבר', alone: 'לבד', other: 'אחר'
  };
  var COMPANION_ORDER = ['mother', 'father', 'parents', 'partner', 'sibling', 'friend', 'alone', 'other'];
  var NOTE_MAX = 5000;
  var SHORT_MAX = 100;

  function notHeldDisplay(v) { return NOT_HELD_LABELS[v] || String(v == null ? '' : v); }
  function companionDisplay(v) { return COMPANION_LABELS[v] || String(v == null ? '' : v); }
  /* The chip key, or for «אחר» the typed text (trimmed; empty → the key itself) — the link's rule. */
  function freeValue(key, text) {
    if (key !== 'other') return key || '';
    var t = String(text == null ? '' : text).trim();
    return t || 'other';
  }

  /* ── the list: waiting for a report / coming / reported ── */
  function sortKey(m) { return String(m.visitDate || '') + ' ' + (/^\d{2}:\d{2}$/.test(String(m.visitTime || '')) ? m.visitTime : '99:99'); }
  function model(res, today) {
    var list = (res && Array.isArray(res.meetings) ? res.meetings : []).filter(function (m) { return m && m.id && ISO_RE.test(String(m.visitDate || '')); });
    var t = today || (res && res.today) || '';
    var pending = [], upcoming = [], reported = [];
    list.forEach(function (m) {
      if (m.report) reported.push(m);
      else if (t && m.visitDate < t) pending.push(m);
      else upcoming.push(m);
    });
    var asc = function (a, b) { return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0; };
    pending.sort(asc); upcoming.sort(asc);
    reported.sort(function (a, b) { return -asc(a, b); });
    return { today: t, pending: pending, upcoming: upcoming, reported: reported, all: list };
  }
  /* The tab badge: past meetings nobody reported yet. */
  function badgeCount(res, today) { return model(res, today).pending.length; }

  /* «לא מחובר» until the Dashboard has the ops — never fake data, never an error page. */
  var NOT_CONNECTED = { unknown_op: 1, unauthorized: 1, not_configured: 1, upstream_bad_response: 1 };
  function stateOf(st) {
    if (!st || !st.res) return 'loading';
    if (st.res.error) return NOT_CONNECTED[st.res.error] ? 'not_connected' : 'error';
    return 'ok';
  }

  function whenText(m) {
    return (m.visitDate ? 'יום ' + weekdayOf(m.visitDate) + ' ' + fmtDate(m.visitDate) : '') + (m.visitTime ? ' · ' + m.visitTime : '');
  }

  /* «זימון» — the logged-in manager's own name, set by app.js after login, so a meeting the
   * Dashboard scheduled WITH them («נפגש/ת עם») gets a personal highlight on their home
   * screen. Admins (nobody's meeting target) and an empty name get none. Matched by the
   * manager's display name — the same string on both sides (MANAGER_ACCESS.name and the
   * lead's meetingWith). Normalised: NFC, trimmed, inner spaces collapsed, case-folded. */
  var viewer = '';
  var readOnly = false;
  function setReadOnly(value) { readOnly = value === true; }
  function normName(v) { return String(v == null ? '' : v).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function setViewer(name) { viewer = normName(name); }
  function scheduledWithViewer(m) { return !!viewer && !!(m && m.meetingWith) && normName(m.meetingWith) === viewer; }
  function reportSummary(r) {
    if (!r) return '';
    var head = OUTCOME_LABELS[r.outcome] || r.outcome || '';
    if (r.outcome === 'no_show' && r.notHeldReason) head += ' — ' + notHeldDisplay(r.notHeldReason);
    if (r.proposedDate) head += ' · מועד חדש מוצע ' + fmtDate(r.proposedDate);
    return head;
  }
  function toneOf(r) {
    if (!r) return 'wait';
    return r.outcome === 'advancing' ? 'ok' : r.outcome === 'not_fit' ? 'bad' : r.outcome === 'no_show' ? 'warn' : 'wait';
  }

  function rowHtml(m, st, kind) {
    var open = st && st.open === m.id;
    var h = '<li class="mt-row mt-' + kind + '" data-mt-row="' + esc(m.id) + '">' +
      '<div class="mt-line"><span class="wk-name">' + esc(m.name) + '</span>' +
      '<span class="wk-meta">' + esc(whenText(m)) + (m.houseLabel ? ' · ' + esc(m.houseLabel) : '') + (m.meetingWith ? ' · עם ' + esc(m.meetingWith) : '') + '</span>' +
      (scheduledWithViewer(m) ? '<span class="crm-chip ok mt-mine">איתך</span>' : '') + '</div>';
    if (m.officeNote) {
      h += '<details class="mt-office"><summary>רקע מהמשרד ▾</summary><div class="mt-office-text">' + esc(m.officeNote) + '</div></details>';
    }
    if (m.report) {
      h += '<div class="mt-report"><span class="crm-chip ' + toneOf(m.report) + '">' + esc(reportSummary(m.report)) + '</span>' +
        (m.report.reporter ? '<span class="wk-meta">דווח ע"י ' + esc(m.report.reporter) + '</span>' : '') + '</div>';
      if (m.report.note) h += '<div class="wk-text mt-note">' + esc(m.report.note) + '</div>';
    }
    // «הוספה ליומן» (calendar.js, 21 Nov 2026): a coming meeting with an hour gets the Google
    // link + the .ics file, and «נשלח זימון ליומן» when the Dashboard mailed the invitation.
    if (kind === 'upcoming' && !m.report && root.CalendarView) h += root.CalendarView.addHtml(m);
    if (open && st.done) h += doneHtml(st.done);
    else if (readOnly) h += '<div class="wk-note">צפייה בלבד — לא ניתן לדווח מחשבון זה</div>';
    else if (open) h += formHtml(m, st.draft || {}, st);
    else h += '<div class="mt-actions"><button type="button" class="wk-btn' + (m.report ? ' ghost' : '') + '" data-mt-report="' + esc(m.id) + '">' + (m.report ? 'עריכת דיווח' : 'דיווח על הפגישה') + '</button></div>';
    return h + '</li>';
  }

  function chips(attr, keys, labels, selected) {
    return keys.map(function (k) {
      return '<button type="button" class="mt-chip' + (selected === k ? ' is-on' : '') + '" ' + attr + '="' + k + '" aria-pressed="' + (selected === k ? 'true' : 'false') + '">' + esc(labels[k]) + '</button>';
    }).join('');
  }

  /* The report form for one meeting. `draft` holds what was typed, so a redraw never loses it. */
  function formHtml(m, d, st) {
    var today = (st && st.today) || '';
    var h = '<form class="mt-form" data-mt-form="' + esc(m.id) + '" novalidate>' +
      '<div class="mt-q">האם הפגישה התקיימה?</div>' +
      '<div class="mt-chips">' +
      '<button type="button" class="mt-chip' + (d.held === 'yes' ? ' is-on' : '') + '" data-mt-held="yes" aria-pressed="' + (d.held === 'yes') + '">כן, התקיימה</button>' +
      '<button type="button" class="mt-chip' + (d.held === 'no' ? ' is-on' : '') + '" data-mt-held="no" aria-pressed="' + (d.held === 'no') + '">לא התקיימה</button></div>';
    if (d.held === 'yes') {
      h += '<div class="mt-q">מה התוצאה?</div><div class="mt-chips">' + chips('data-mt-outcome', HELD_OUTCOMES, HELD_SHORT, d.outcome) + '</div>' +
        '<div class="mt-q">מי הגיע/ה איתו/ה?</div><div class="mt-chips">' + chips('data-mt-companion', COMPANION_ORDER, COMPANION_LABELS, d.companion) + '</div>' +
        (d.companion === 'other' ? '<input class="mt-input" name="companionOther" maxlength="' + SHORT_MAX + '" placeholder="מי הגיע? (טקסט חופשי)" value="' + esc(d.companionOther || '') + '">' : '');
    } else if (d.held === 'no') {
      h += '<div class="mt-q">למה הפגישה לא התקיימה?</div><div class="mt-chips">' + chips('data-mt-reason', NOT_HELD_ORDER, NOT_HELD_LABELS, d.reason) + '</div>' +
        (d.reason === 'other' ? '<input class="mt-input" name="reasonOther" maxlength="' + SHORT_MAX + '" placeholder="מה קרה? (טקסט חופשי)" value="' + esc(d.reasonOther || '') + '">' : '') +
        (d.reason === 'postponed' ? '<label class="mt-label">מועד חדש מוצע (לא חובה)<input class="mt-input" type="date" name="proposedDate" min="' + esc(today) + '" value="' + esc(d.proposedDate || '') + '"></label>' : '');
    }
    if (d.held) {
      var len = String(d.note || '').length;
      h += '<label class="mt-label">פירוט<textarea class="mt-input mt-textarea" name="note" maxlength="' + NOTE_MAX + '" placeholder="' + (d.held === 'yes' ? 'מה דובר בפגישה…' : 'מה ידוע, מה הלאה…') + '">' + esc(d.note || '') + '</textarea></label>' +
        '<div class="mt-count' + (len > NOTE_MAX * 0.9 ? ' warn' : '') + '" data-mt-count>⁦' + len + ' / ' + NOTE_MAX + '⁩</div>';
    }
    if (st && st.error) h += '<div class="mt-error" role="alert">' + esc(st.error) + '</div>';
    var saving = !!(st && st.saving);
    h += '<div class="mt-actions">' +
      (d.held ? '<button type="submit" class="wk-btn" data-mt-submit' + (saving ? ' disabled aria-busy="true"' : '') + '>' +
        (saving ? '<span class="wk-spin" aria-hidden="true"></span>שומר…' : 'שמירת הדיווח') + '</button>' : '') +
      '<button type="button" class="wk-btn ghost" data-mt-cancel' + (saving ? ' disabled' : '') + '>ביטול</button></div></form>';
    return h;
  }

  /* '' when the draft can be sent, otherwise the Hebrew reason — the Dashboard's rules. */
  function draftError(d, today) {
    if (!d || (d.held !== 'yes' && d.held !== 'no')) return 'נא לבחור אם הפגישה התקיימה';
    if (d.held === 'yes' && HELD_OUTCOMES.indexOf(d.outcome) < 0) return 'נא לבחור מה התוצאה';
    if (d.held === 'no' && NOT_HELD_ORDER.indexOf(d.reason) < 0) return 'נא לבחור למה הפגישה לא התקיימה';
    if (d.held === 'no' && d.reason === 'other' && String(d.reasonOther || '').trim().length > SHORT_MAX) return 'הסיבה ארוכה מדי (עד ' + SHORT_MAX + ' תווים)';
    if (d.held === 'yes' && d.companion === 'other' && String(d.companionOther || '').trim().length > SHORT_MAX) return 'הטקסט בשדה "הגיע/ה עם" ארוך מדי (עד ' + SHORT_MAX + ' תווים)';
    if (d.held === 'no' && d.reason === 'postponed' && d.proposedDate) {
      if (!ISO_RE.test(d.proposedDate)) return 'המועד החדש אינו תקין';
      if (today && d.proposedDate < today) return 'המועד המוצע עבר — נא לבחור תאריך מהיום והלאה';
    }
    if (String(d.note || '').length > NOTE_MAX) return 'הפירוט מוגבל ל-' + NOTE_MAX + ' תווים';
    return '';
  }
  /* What is sent for a valid draft. */
  function payloadOf(m, d) {
    var held = d.held === 'yes';
    return {
      op: 'meetingReport', leadId: m.id,
      outcome: held ? d.outcome : 'no_show',
      notHeldReason: held ? '' : freeValue(d.reason, d.reasonOther),
      proposedDate: !held && d.reason === 'postponed' && d.proposedDate ? d.proposedDate : '',
      companion: held ? freeValue(d.companion, d.companionOther) : '',
      note: String(d.note || '').trim(),
      submissionId: d.submissionId || ''
    };
  }

  var ERRORS = {
    bad_reason: 'נא לבחור למה הפגישה לא התקיימה',
    bad_proposed_date: 'המועד החדש המוצע אינו תקין — נא לבחור תאריך מהיום והלאה',
    bad_outcome: 'לא נבחרה תוצאה תקינה',
    bad_companion: 'הטקסט בשדה "הגיע/ה עם" ארוך מדי (עד 100 תווים)',
    bad_note: 'הפירוט ארוך מדי (עד 5000 תווים)',
    bad_lead: 'הפגישה לא נמצאה — רעננו את הרשימה',
    lead_not_found: 'הפגישה כבר לא פתוחה לדיווח (אולי נסגרה או הועברה) — רעננו את הרשימה',
    lock_busy: 'המערכת עסוקה — נסו שוב בעוד רגע (הדיווח לא נשמר)',
    write_verify_failed: 'הדיווח לא נשמר — נסו שוב, ואם זה חוזר פנו לסנדרה',
    unknown_op: 'השרת עוד לא עודכן לדיווח פגישות — בינתיים דווחו בלינק. פנו לסנדרה.',
    unauthorized: 'השרת דחה את הדיווח (הרשאה) — פנו לסנדרה',
    forbidden: 'אין הרשאה לבית הזה',
    read_only: 'החשבון מוגדר לצפייה בלבד',
    timeout: 'הבקשה לקחה יותר מדי זמן — בדקו ברשימה אם הדיווח נשמר לפני שליחה חוזרת',
    not_proven: 'השרת לא אישר שהדיווח נשמר — נסו שוב (שליחה חוזרת לא תכפיל אותו)'
  };
  function errorText(code) {
    var c = String(code == null ? '' : code);
    return ERRORS[c] || 'השמירה נכשלה — הדיווח לא נשמר, נסו שוב';
  }

  /* ── WhatsApp: byte-identical to the Dashboard's /meeting-report message (meeting-report.js
   *    mrWhatsAppMessage / mrWhatsAppShareMessage), including the encoded-length rule. ── */
  var WA_BASE = 'https://wa.me/?text=';
  var WA_URL_MAX = 60000;   // counts ENCODED characters: a Hebrew letter costs 6
  function notHeldLine(s) {
    var r = s && s.notHeldReason ? String(s.notHeldReason) : '';
    if (!r) return '';
    return 'סיבה: ' + notHeldDisplay(r) + (s.proposedDate ? ' · מועד חדש מוצע: ' + dmy(s.proposedDate) : '');
  }
  function waMessage(saved) {
    var s = saved || {};
    var lines = [
      'יומן ביקורים ודיווח סטטוס — E-Zone',
      'ליד: ' + (s.name || '') + ' (' + (s.houseLabel || '') + ')',
      'תוצאה: ' + (OUTCOME_LABELS[s.outcome] || s.outcome || '')
    ];
    var rl = notHeldLine(s);
    if (rl) lines.push(rl);
    lines.push('הגיע/ה עם: ' + companionDisplay(s.companion), 'פירוט: ' + (s.note || ''), 'דווח ע"י: ' + (s.reporter || ''));
    return lines.join('\n');
  }
  function waLink(text) { return WA_BASE + encodeURIComponent(String(text == null ? '' : text)); }
  function safeCut(s, n) {
    var out = String(s == null ? '' : s).slice(0, Math.max(0, n));
    var last = out.charCodeAt(out.length - 1);
    if (out.length && last >= 0xD800 && last <= 0xDBFF) out = out.slice(0, out.length - 1);
    return out;
  }
  function withNote(s, note) { var o = {}; Object.keys(s || {}).forEach(function (k) { o[k] = s[k]; }); o.note = note; return o; }
  /* Only the note is ever shortened; the header lines and «דווח ע"י» always survive. */
  function waShareMessage(saved) {
    var s = saved || {};
    var note = String(s.note == null ? '' : s.note);
    var full = waMessage(s);
    if (waLink(full).length <= WA_URL_MAX) return full;
    var fits = function (n) { return waLink(waMessage(withNote(s, safeCut(note, n) + '…'))).length <= WA_URL_MAX; };
    var lo = 0, hi = note.length;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
    return waMessage(withNote(s, safeCut(note, lo) + '…'));
  }
  function waShareUrl(saved) { return waLink(waShareMessage(saved)); }

  function doneHtml(done) {
    return '<div class="mt-done" role="status"><div class="mt-done-title">✓ הדיווח נשמר ונשלח לדשבורד</div>' +
      '<div class="wk-meta">' + esc(reportSummary(done)) + '</div>' +
      '<div class="mt-actions"><a class="wk-btn mt-wa" href="' + esc(waShareUrl(done)) + '" target="_blank" rel="noopener" data-mt-wa>📤 שלח לקבוצה (וואטסאפ)</a>' +
      '<button type="button" class="wk-btn ghost" data-mt-close>סגירה</button></div></div>';
  }

  function sectionBody(rows, st, kind, empty) {
    return rows.length ? '<ul class="wk-list mt-list">' + rows.map(function (m) { return rowHtml(m, st, kind); }).join('') + '</ul>' : '<div class="wk-empty">' + esc(empty) + '</div>';
  }
  function section(title, cls, rows, st, kind, empty) {
    return '<div class="card work-card ' + cls + '"><div class="card-title">' + esc(title) + ' (' + rows.length + ')</div>' + sectionBody(rows, st, kind, empty) + '</div>';
  }
  /* «דווחו» starts closed (an arrow header) — open when a report in it is being edited. */
  function foldSection(title, cls, rows, st, kind, empty) {
    var open = !!(st && st.open && rows.some(function (m) { return m.id === st.open; }));
    return '<details class="card work-card mt-fold ' + cls + '"' + (open || (st && st.foldOpen) ? ' open' : '') + ' data-mt-fold>' +
      '<summary class="card-title">' + esc(title) + ' (' + rows.length + ') ▾</summary>' + sectionBody(rows, st, kind, empty) + '</details>';
  }

  /* The whole «פגישות קליטה» tab. */
  function tabHtml(st) {
    var s = stateOf(st);
    if (s === 'loading') return '<div class="card"><div class="wk-empty">טוען את הפגישות…</div></div>';
    if (s === 'not_connected') return '<div class="card"><div class="mt-notice">לא מחובר — הפגישות יופיעו כאן אחרי עדכון הדשבורד. עד אז מדווחים בלינק כרגיל.</div></div>';
    if (s === 'error') return '<div class="card"><div class="mt-error">לא הצלחנו לטעון את הפגישות כרגע.</div><button type="button" class="wk-btn ghost" data-mt-retry>נסו שוב</button></div>';
    var mm = model(st.res, st.today);
    return '<div class="mt-intro wk-meta">הפגישות שתואמו לבית (30 יום אחורה, שבועיים קדימה). הדיווח נשמר בדשבורד ונשלח לקבוצה כמו בלינק.</div>' +
      section('ממתינות לדיווח', 'mt-pending', mm.pending, st, 'pending', 'אין פגישות שממתינות לדיווח 👍') +
      section('קרובות', 'mt-upcoming', mm.upcoming, st, 'upcoming', 'אין פגישות קרובות') +
      foldSection('דווחו', 'mt-reported', mm.reported, st, 'reported', 'עוד אין דיווחים');
  }

  /* «הבית היום»: today's and this week's meetings + the waiting count, linking to the tab. */
  function homeCardHtml(st) {
    var s = stateOf(st);
    if (s !== 'ok') return '';
    var mm = model(st.res, st.today);
    var t = mm.today, end = addDays(t, 6);
    var week = mm.all.filter(function (m) { return !m.report && m.visitDate >= t && m.visitDate <= end; }).sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : 1; });
    var h = '<div class="card dash-card mt-home"><div class="card-title">🤝 פגישות קליטה</div>';
    /* «זימון»: upcoming (unreported, from today on) meetings scheduled WITH this manager. */
    var mine = mm.upcoming.filter(scheduledWithViewer);
    if (mine.length) {
      h += '<div class="mt-invite" role="note"><div class="mt-invite-head">📩 ' +
        esc(mine.length === 1 ? 'נקבעה פגישה איתך' : 'נקבעו ' + mine.length + ' פגישות איתך') + '</div><ul class="wk-list">' +
        mine.slice(0, 5).map(function (m) {
          return '<li><span class="wk-name">' + esc(m.name) + '</span><span class="wk-meta">' +
            esc(m.visitDate === t ? 'היום' + (m.visitTime ? ' · ' + m.visitTime : '') : whenText(m)) + '</span></li>';
        }).join('') + '</ul></div>';
    }
    if (mm.pending.length) {
      h += '<button type="button" class="mt-alert" data-go-sub="meetings">⏳ ' + esc(mm.pending.length === 1 ? 'פגישה אחת ממתינה לדיווח' : mm.pending.length + ' פגישות ממתינות לדיווח') + ' ←</button>';
    }
    // 21 Nov 2026: this card is «היום». The rest of the week is listed once, in «יומן».
    var todays = week.filter(function (m) { return m.visitDate === t; });
    var later = week.length - todays.length;
    h += todays.length ? '<ul class="wk-list">' + todays.slice(0, 8).map(function (m) {
      return '<li><span class="wk-name">' + esc(m.name) + '</span><span class="wk-meta">' + esc('היום' + (m.visitTime ? ' · ' + m.visitTime : '')) + '</span></li>';
    }).join('') + '</ul>' : '<div class="wk-empty">' + (week.length ? 'אין פגישות קליטה היום' : 'אין פגישות קליטה השבוע') + '</div>';
    if (later) h += '<button type="button" class="wk-link mt-week" data-go-sub="calendar">' + esc(later === 1 ? 'עוד פגישה אחת השבוע' : 'עוד ' + later + ' פגישות השבוע') + ' — ביומן ←</button> ';
    return h + '<button type="button" class="wk-link" data-go-sub="meetings">לכל הפגישות ←</button></div>';
  }

  var MeetingsView = {
    OUTCOME_LABELS: OUTCOME_LABELS, NOT_HELD_LABELS: NOT_HELD_LABELS, NOT_HELD_ORDER: NOT_HELD_ORDER,
    COMPANION_LABELS: COMPANION_LABELS, HELD_OUTCOMES: HELD_OUTCOMES, NOTE_MAX: NOTE_MAX,
    model: model, badgeCount: badgeCount, stateOf: stateOf, tabHtml: tabHtml, homeCardHtml: homeCardHtml,
    setViewer: setViewer, setReadOnly: setReadOnly, scheduledWithViewer: scheduledWithViewer,
    formHtml: formHtml, rowHtml: rowHtml, draftError: draftError, payloadOf: payloadOf, freeValue: freeValue,
    errorText: errorText, ERRORS: ERRORS, reportSummary: reportSummary,
    waMessage: waMessage, waShareMessage: waShareMessage, waShareUrl: waShareUrl, WA_URL_MAX: WA_URL_MAX, esc: esc
  };

  /* ── DOM wiring (browser only) ─────────────────────────── */
  var states = {};   // houseKey → { at, res, today, open, draft, saving, error, done }
  var CACHE_MS = 60000;

  async function post(body) {
    if (readOnly && body && body.op === 'meetingReport') throw Object.assign(new Error('read_only'), { code: 'read_only' });
    var r = await fetch('/api/work', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    var data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (r.status === 401 && root.Auth) root.Auth.showLogin();
    if (!r.ok || !data || data.ok === false) {
      var err = new Error((data && data.error) || ('HTTP ' + r.status));
      err.code = (data && data.error) || (r.status === 504 ? 'timeout' : '');
      throw err;
    }
    return data;
  }
  function newSubmissionId() {
    var bytes = new Uint8Array(16), c = root.crypto;
    if (c && c.getRandomValues) c.getRandomValues(bytes); else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    var hex = '';
    for (var j = 0; j < 16; j++) hex += (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16);
    return 'sub-' + hex;
  }
  function stFor(key) { return states[key] || (states[key] = { at: 0, res: null, today: '', open: null, draft: null }); }

  function paint(panel, key) {
    var st = stFor(key);
    var tab = panel.querySelector('[data-sub-panel="meetings"]');
    if (tab) {
      var ta = tab.querySelector('textarea[name="note"]');
      var focused = ta && root.document.activeElement === ta;
      tab.innerHTML = tabHtml(st);
      if (focused) { var nt = tab.querySelector('textarea[name="note"]'); if (nt) { nt.focus(); nt.setSelectionRange(nt.value.length, nt.value.length); } }
    }
    var home = panel.querySelector('[data-dash-meetings]');
    if (home) {
      home.innerHTML = homeCardHtml(st);
      // The home tab's cards are collapsible (work.js); a card with meetings waiting stays open.
      if (root.Work && root.Work.applyCollapse) root.Work.applyCollapse(panel, key);
    }
    var badge = panel.querySelector('[data-sub="meetings"] [data-mt-badge]');
    if (badge) {
      var n = stateOf(st) === 'ok' ? badgeCount(st.res, st.today) : 0;
      badge.textContent = n ? String(n) : '';
      badge.hidden = !n;
    }
    // «יומן» shows these meetings too: redraw it with the fresh list.
    if (root.Calendar && root.Calendar.repaint) root.Calendar.repaint(panel, key, false);
  }

  function load(panel, key, force) {
    var st = stFor(key);
    if (!force && st.res && !st.res.error && Date.now() - st.at < CACHE_MS) { paint(panel, key); return Promise.resolve(); }
    if (st.loading) return st.loading;
    if (!st.res) paint(panel, key);
    st.loading = post({ op: 'meetings', house: key }).then(function (r) {
      st.res = { meetings: Array.isArray(r.meetings) ? r.meetings : [], today: r.today };
      st.today = r.today || st.today;
    }).catch(function (e) {
      st.res = { error: (e && e.code) || 'error' };
    }).then(function () {
      st.at = Date.now();
      delete st.loading;
      paint(panel, key);
    });
    return st.loading;
  }

  function findMeeting(key, id) {
    var st = stFor(key);
    var list = st.res && st.res.meetings ? st.res.meetings : [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function draftFromReport(m) {
    var r = m && m.report;
    var d = { submissionId: newSubmissionId(), note: r ? r.note || '' : '' };
    if (!r) return d;
    if (r.outcome === 'no_show') {
      d.held = 'no';
      if (NOT_HELD_LABELS[r.notHeldReason]) d.reason = r.notHeldReason;
      else if (r.notHeldReason) { d.reason = 'other'; d.reasonOther = r.notHeldReason; }
      d.proposedDate = r.proposedDate || '';
    } else {
      d.held = 'yes'; d.outcome = r.outcome;
      if (COMPANION_LABELS[r.companion]) d.companion = r.companion;
      else if (r.companion) { d.companion = 'other'; d.companionOther = r.companion; }
    }
    return d;
  }

  async function submit(panel, key) {
    var st = stFor(key);
    if (st.saving || readOnly) return;   // read-only and double taps never send
    var m = findMeeting(key, st.open);
    if (!m) return;
    var err = draftError(st.draft, st.today);
    if (err) { st.error = err; paint(panel, key); return; }
    st.saving = true; st.error = '';
    paint(panel, key);
    var body = payloadOf(m, st.draft);
    body.house = key;
    try {
      var r = await post(body);
      if (!r || !r.saved || String(r.saved.leadId) !== String(m.id)) throw Object.assign(new Error('not_proven'), { code: 'not_proven' });
      st.done = {
        name: m.name, houseLabel: m.houseLabel, outcome: body.outcome, notHeldReason: body.notHeldReason,
        proposedDate: body.proposedDate, companion: body.companion, note: body.note, reporter: r.saved.reporter || ''
      };
      st.draft = null;
      st.saving = false;
      await load(panel, key, true);   // the list now shows the report
    } catch (e) {
      st.saving = false;
      st.error = errorText(e && e.code);
      paint(panel, key);
    }
  }

  function wire(panel, key) {
    if (panel.getAttribute('data-mt-wired') === '1') return;
    panel.setAttribute('data-mt-wired', '1');
    panel.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var st = stFor(key);
      if (t.closest('[data-mt-retry]')) { load(panel, key, true); return; }
      // «שלח לקבוצה»: an installed PWA drops a plain target=_blank link — open it, else navigate.
      var wa = t.closest('[data-mt-wa]');
      if (wa) {
        ev.preventDefault();
        var url = wa.getAttribute('href');
        var w = root.open ? root.open(url, '_blank', 'noopener') : null;
        if (!w) root.location.href = url;
        return;
      }
      var fold = t.closest('[data-mt-fold] > summary');
      if (fold) { st.foldOpen = !fold.parentNode.open; return; }
      var rep = t.closest('[data-mt-report]');
      if (rep) {
        if (st.saving || readOnly) return;
        st.open = rep.getAttribute('data-mt-report'); st.done = null; st.error = '';
        st.draft = draftFromReport(findMeeting(key, st.open));
        paint(panel, key);
        return;
      }
      if (t.closest('[data-mt-cancel]') || t.closest('[data-mt-close]')) {
        if (st.saving) return;
        st.open = null; st.draft = null; st.done = null; st.error = '';
        paint(panel, key);
        return;
      }
      if (!st.draft || st.saving) return;
      var pick = function (attr, field, reset) {
        var b = t.closest('[' + attr + ']');
        if (!b) return false;
        st.draft[field] = b.getAttribute(attr);
        if (reset) reset();
        st.error = '';
        paint(panel, key);
        return true;
      };
      if (pick('data-mt-held', 'held', function () { st.draft.outcome = ''; st.draft.reason = ''; st.draft.proposedDate = ''; })) return;
      if (pick('data-mt-outcome', 'outcome')) return;
      if (pick('data-mt-reason', 'reason', function () { if (st.draft.reason !== 'postponed') st.draft.proposedDate = ''; })) return;
      pick('data-mt-companion', 'companion');
    });
    // Typing goes straight into the draft, so any redraw keeps it.
    panel.addEventListener('input', function (ev) {
      var f = ev.target && ev.target.closest && ev.target.closest('[data-mt-form]');
      var st = stFor(key);
      if (!f || !st.draft) return;
      var name = ev.target.name;
      if (name === 'note' || name === 'reasonOther' || name === 'companionOther' || name === 'proposedDate') st.draft[name] = ev.target.value;
      if (name === 'note') {
        var c = f.querySelector('[data-mt-count]');
        if (c) { c.textContent = '⁦' + ev.target.value.length + ' / ' + NOTE_MAX + '⁩'; c.classList.toggle('warn', ev.target.value.length > NOTE_MAX * 0.9); }
      }
    });
    panel.addEventListener('change', function (ev) {
      var st = stFor(key);
      if (ev.target && ev.target.name === 'proposedDate' && st.draft) st.draft.proposedDate = ev.target.value;
    });
    panel.addEventListener('submit', function (ev) {
      if (!ev.target || !ev.target.matches || !ev.target.matches('[data-mt-form]')) return;
      ev.preventDefault();
      submit(panel, key);
    });
  }

  /* Called by work.js when a house panel is drawn and when «פגישות קליטה» opens. */
  function onHouse(panel, key, force) {
    if (!panel || !key || !root.document) return;
    wire(panel, key);
    load(panel, key, force);
  }

  root.MeetingsView = MeetingsView;
  root.Meetings = { onHouse: onHouse, _states: states };
  if (typeof module === 'object' && module.exports) module.exports = MeetingsView;
}(typeof self !== 'undefined' ? self : this));
