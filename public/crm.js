/* Managers CRM views (14 Nov 2026, docs/crm-redesign.md).
 *
 * Sandra: «לשנות את כל המראה … הרבה יותר כלי לניהול למנהל … פרטים מלאים הכל
 * בלשוניות כמו CRM». Pure view builders (no DOM, no fetch) for:
 *   - the patient card   («כרטיס מטופל/ת») — פרטים · טיפול · ועדות · אירועים
 *   - the employee card  («כרטיס עובד/ת») — פרטים · עלות · שיחות · משוב
 *   - staff-talk THREADS — a first talk, follow-up talks and an outcome
 *   - «מה היה בוועדה»    — the committee-notes form and history
 *   - «תקציב כוח אדם»     — month cost vs budget, the workers, the quarter
 *   - the quarterly budget-adherence bonus card (math: lib/bonus-eligibility.js)
 *
 * Every value from a feed is escaped (esc) before it reaches markup. Wiring
 * (clicks, saves, loads) lives in work.js. Tested in test/crm-view.test.js. */
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
  function ils(n) {
    var v = Math.round(Number(n) || 0);
    // LRM keeps a minus sign on the number's left in an RTL line.
    return (v < 0 ? '\u200E-' : '') + Math.abs(v).toLocaleString('en-US') + ' ₪';
  }
  var HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function monthHe(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    return m ? HE_MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function chip(cls, text) { return '<span class="crm-chip ' + cls + '">' + esc(text) + '</span>'; }

  /* ── allowlists (the backend keeps the same keys) ───────── */
  var TALK_OUTCOMES = {
    improved: 'שיפור', no_change: 'ללא שינוי', warning: 'שיחת אזהרה',
    hr: 'הועבר למשאבי אנוש', termination: 'סיום העסקה', closed: 'נסגר'
  };
  var TALK_OUTCOME_TONE = { improved: 'ok', no_change: 'wait', warning: 'warn', hr: 'warn', termination: 'bad', closed: 'ok' };
  var DECISIONS = {
    continue: 'המשך שהייה', extend: 'הארכת שהייה', discharge: 'שחרור',
    outpatient: 'מעבר לאמבולטורי', other: 'אחר'
  };

  /* ── patients: who treats whom, the next committee, the events ── */
  function therapistsOf(d, name) {
    var t = d && d.team;
    if (!t || !t.available) return null;   // null = unknown (not "no therapist")
    var n = norm(name), seen = {}, out = [];
    (t.therapistWeek || []).forEach(function (r) {
      if (norm(r.patientName) !== n || seen[r.therapistName]) return;
      seen[r.therapistName] = true;
      out.push(r.therapistName);
    });
    return out;
  }
  function sessionsOf(d, name) {
    var t = d && d.team;
    if (!t || !t.available) return [];
    var n = norm(name);
    return (t.therapistWeek || []).filter(function (r) { return norm(r.patientName) === n; }).slice().sort(function (a, b) {
      return (a.dayOfWeek - b.dayOfWeek) || String(a.time || '99:99').localeCompare(String(b.time || '99:99'));
    });
  }
  function committeeItems(d) {
    var c = d && d.committees;
    return c && c.available && Array.isArray(c.items) ? c.items : [];
  }
  function nextCommitteeOf(d, name) {
    var n = norm(name), today = (d && d.today) || '';
    var list = committeeItems(d).filter(function (c) {
      return norm(c.patientName) === n && ISO_RE.test(String(c.date)) && (!today || c.date >= today) && c.status !== 'cancelled';
    }).sort(function (a, b) { return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });
    return list[0] || null;
  }
  function logsOf(d, key) { return (d && d.logs && Array.isArray(d.logs[key])) ? d.logs[key] : []; }
  function notesOf(d, name) {
    var n = norm(name);
    return logsOf(d, 'committeeNotes').filter(function (r) { return norm(r.patientName) === n; });
  }
  function eventsOf(d, name) {
    var n = norm(name);
    return logsOf(d, 'events').filter(function (r) { return norm(r.patientName) === n; });
  }
  function dischargeText(p) {
    var e = p && p.expectedDischarge;
    if (!e) return 'לא נקבע';
    if (e.none) return 'אין צפי לשחרור';
    return e.date ? fmtDate(e.date) : 'לא נקבע';
  }

  /* One-line extras for a row of «מטופלים בבית»: therapist(s) + next committee. */
  function patientRowExtras(d, p) {
    var th = therapistsOf(d, p.name);
    var nc = nextCommitteeOf(d, p.name);
    var parts = [];
    if (th && th.length) parts.push('מטפל/ת: ' + th.join(', '));
    else if (th) parts.push('אין מטפל/ת משובץ/ת');
    if (nc) parts.push('ועדה: ' + fmtDate(nc.date) + (nc.time ? ' ' + nc.time : ''));
    return parts.length ? '<span class="wk-meta crm-row-extra">' + esc(parts.join(' · ')) + '</span>' : '';
  }

  /* Card tabs: buttons + panels. `tabs` = [{ key, label, html }]. */
  function cardTabsHtml(kind, tabs, active) {
    var on = active && tabs.some(function (t) { return t.key === active; }) ? active : tabs[0].key;
    return '<nav class="card-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" class="card-tab' + (t.key === on ? ' is-active' : '') + '" role="tab" aria-selected="' + (t.key === on) +
        '" data-card-tab="' + esc(t.key) + '">' + esc(t.label) + '</button>';
    }).join('') + '</nav>' + tabs.map(function (t) {
      return '<section class="card-tab-panel" data-card-panel="' + esc(t.key) + '"' + (t.key === on ? '' : ' hidden') + '>' + t.html + '</section>';
    }).join('');
  }
  function fieldsHtml(rows) {
    return '<dl class="crm-fields">' + rows.filter(function (r) { return r; }).map(function (r) {
      return '<div class="crm-field"><dt>' + esc(r[0]) + '</dt><dd>' + (r[2] ? r[1] : esc(r[1] === '' || r[1] == null ? '—' : r[1])) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /* «כרטיס מטופל/ת» — patient index `i` of houseData.patients. */
  function patientCardHtml(d, i, active) {
    var p = d && d.patients && d.patients[Number(i)];
    if (!p) return '<div class="wk-empty">המטופל/ת כבר לא רשום/ה בבית — רעננו את הדף</div>';
    var th = therapistsOf(d, p.name);
    var nc = nextCommitteeOf(d, p.name);
    var e = p.expectedDischarge;
    var details = fieldsHtml([
      ['סטטוס', p.status === 'trial' ? 'תקופת ניסיון' : 'פעיל/ה'],
      ['תאריך כניסה', fmtDate(p.entryDate)],
      ['ימים בבית', p.days != null ? 'יום ' + p.days : ''],
      ['שחרור משוער', dischargeText(p)],
      e && e.editedBy ? ['עודכן ע״י', e.editedBy + (e.editedAt ? ' · ' + fmtDate(String(e.editedAt).slice(0, 10)) : '')] : null,
      ['מטפל/ת', th === null ? 'הנתונים מאפליקציית הרכזים לא מחוברים' : th.length ? th.join(', ') : 'אין מטפל/ת משובץ/ת'],
      ['הוועדה הבאה', nc ? fmtDate(nc.date) + (nc.time ? ' ' + nc.time : '') + (nc.type ? ' · ' + nc.type : '') : 'אין ועדה קרובה']
    ]) + '<div class="crm-actions"><button type="button" class="wk-btn" data-pt-discharge="' + esc(i) + '">עדכון שחרור משוער</button></div>';
    var ses = sessionsOf(d, p.name);
    var treat = th === null ? '<div class="wk-empty">הנתונים מאפליקציית הרכזים עוד לא מחוברים.</div>'
      : ses.length ? '<ul class="wk-list">' + ses.map(function (r) {
        return '<li><span class="wk-shift">' + esc('יום ' + (WEEKDAYS[r.dayOfWeek] || '')) + '</span><span class="wk-name">' + esc(r.therapistName) +
          '</span><span class="wk-meta">' + esc(r.time || 'ללא שעה') + '</span></li>';
      }).join('') + '</ul>' : '<div class="wk-empty">אין טיפולים משובצים השבוע</div>';
    var upcoming = committeeItems(d).filter(function (c) { return norm(c.patientName) === norm(p.name) && (!d.today || c.date >= d.today); });
    var notes = notesOf(d, p.name);
    var cm = '<div class="card-subtitle">ועדות קרובות</div>' + (upcoming.length ? '<ul class="wk-list">' + upcoming.map(function (c) {
      return '<li><span class="wk-shift">' + esc(fmtDate(c.date) + (c.time ? ' ' + c.time : '')) + '</span><span class="wk-name">' + esc(c.type || 'ועדה') + '</span>' +
        (c.participants ? '<span class="wk-meta">' + esc(c.participants) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין ועדה קרובה</div>') +
      '<div class="card-subtitle">מה היה בוועדות</div>' + (notes.length ? notesListHtml(notes, true) : '<div class="wk-empty">עוד לא נרשם סיכום ועדה</div>') +
      '<div class="crm-actions"><button type="button" class="wk-btn" data-pt-note="' + esc(i) + '">📝 רישום מה היה בוועדה</button></div>';
    var ev = eventsOf(d, p.name);
    var evHtml = ev.length ? '<ul class="wk-log">' + ev.map(function (r) {
      return '<li class="wk-entry"><div class="wk-entry-head"><span class="wk-name">' + esc(fmtDate(r.eventDate) + (r.eventTime ? ' ' + r.eventTime : '')) +
        '</span><span class="wk-meta">' + esc(r.author || '') + '</span></div><div class="wk-text">' + esc(r.whatHappened) + '</div>' +
        (r.actionTaken ? '<div class="wk-text">מה נעשה: ' + esc(r.actionTaken) + '</div>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין אירועים חריגים רשומים</div>';
    return '<div class="crm-card-sub">' + esc('בבית מ-' + fmtDate(p.entryDate) + ' · יום ' + p.days) + '</div>' +
      cardTabsHtml('patient', [
        { key: 'details', label: 'פרטים', html: details },
        { key: 'treatment', label: 'טיפול', html: treat },
        { key: 'committees', label: 'ועדות (' + (upcoming.length + notes.length) + ')', html: cm },
        { key: 'events', label: 'אירועים (' + ev.length + ')', html: evHtml }
      ], active);
  }

  /* ── staff-talk THREADS ───────────────────────────────── */
  function isRootTalk(r) { return !r.talkKind || r.talkKind === 'first'; }
  function talkThreads(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var byId = {};
    list.forEach(function (r) { if (r && isRootTalk(r)) byId[r.id] = { root: r, children: [], outcome: null }; });
    var orphans = [];
    list.forEach(function (r) {
      if (!r || isRootTalk(r)) return;
      var t = byId[r.parentId];
      if (!t) { orphans.push({ root: r, children: [], outcome: null }); return; }
      t.children.push(r);
      if (r.talkKind === 'outcome') t.outcome = r;
    });
    var out = Object.keys(byId).map(function (k) { return byId[k]; }).concat(orphans);
    out.forEach(function (t) {
      t.children.sort(function (a, b) { return (String(a.talkDate) + (a.talkTime || '') + (a.createdAt || '')).localeCompare(String(b.talkDate) + (b.talkTime || '') + (b.createdAt || '')); });
      var last = t.children.length ? t.children[t.children.length - 1] : t.root;
      t.lastDate = String(last.talkDate || '');
    });
    // Open threads first, then by the latest talk (newest first).
    out.sort(function (a, b) { return ((a.outcome ? 1 : 0) - (b.outcome ? 1 : 0)) || b.lastDate.localeCompare(a.lastDate); });
    return out;
  }
  function talkFormHtml(kind, t, today) {
    var root = t.root, fid = 'tf-' + esc(root.id) + '-' + kind;
    var outcome = kind === 'outcome';
    return '<form class="wk-form thread-form" data-wk-form="staffTalks" data-thread-form="' + esc(root.id) + '|' + kind + '" hidden novalidate>' +
      '<input type="hidden" name="employeeName" value="' + esc(root.employeeName) + '">' +
      '<input type="hidden" name="talkKind" value="' + (outcome ? 'outcome' : 'followup') + '">' +
      '<input type="hidden" name="parentId" value="' + esc(root.id) + '">' +
      '<div class="wk-field wk-f-date"><label for="' + fid + '-d">תאריך *</label><input id="' + fid + '-d" name="talkDate" type="date" value="' + esc(today || '') + '" required></div>' +
      '<div class="wk-field wk-f-time"><label for="' + fid + '-t">שעה</label><input id="' + fid + '-t" name="talkTime" type="time"></div>' +
      (outcome ? '<div class="wk-field wk-f-select"><label for="' + fid + '-o">התוצאה *</label><select id="' + fid + '-o" name="outcome" required><option value="">בחרו…</option>' +
        Object.keys(TALK_OUTCOMES).map(function (k) { return '<option value="' + k + '">' + esc(TALK_OUTCOMES[k]) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="wk-field wk-f-textarea"><label for="' + fid + '-s">' + (outcome ? 'סיכום *' : 'עיקרי השיחה *') + '</label><textarea id="' + fid + '-s" name="summary" maxlength="1500" rows="3" required></textarea></div>' +
      (outcome ? '' : '<div class="wk-field wk-f-textarea"><label for="' + fid + '-a">מה סוכם</label><textarea id="' + fid + '-a" name="agreedActions" maxlength="1000" rows="2"></textarea></div>' +
        '<div class="wk-field wk-f-date"><label for="' + fid + '-f">תזכורת למעקב (לא חובה)</label><input id="' + fid + '-f" name="followUpDate" type="date"></div>') +
      '<div class="wk-actions"><button type="submit" class="wk-btn">' + (outcome ? 'שמירת התוצאה' : 'שמירת שיחת ההמשך') + '</button>' +
      '<button type="button" class="wk-link" data-thread-cancel="' + esc(root.id) + '|' + kind + '">ביטול</button><span class="wk-msg" data-wk-msg></span></div></form>';
  }
  function talkEntryHtml(r, label, readOnly) {
    var fu = '';
    if (r.followUpDate) {
      fu = r.followUpDone ? '<span class="wk-fu done">מעקב בוצע</span>'
        : '<span class="wk-fu">מעקב: ' + esc(fmtDate(r.followUpDate)) + '</span>' +
          (r.canEdit === true && !readOnly ? '<button type="button" class="wk-link" data-wk-done="staffTalks|' + esc(r.id) + '">סמן כבוצע</button>' : '');
    }
    return '<li class="wk-entry talk-' + esc(r.talkKind || 'first') + '" data-wk-id="' + esc(r.id) + '">' +
      '<div class="wk-entry-head"><span class="talk-step">' + esc(label) + '</span>' +
      (r.talkKind === 'outcome' && TALK_OUTCOMES[r.outcome] ? chip(TALK_OUTCOME_TONE[r.outcome] || 'wait', TALK_OUTCOMES[r.outcome]) : '') +
      '<span class="wk-meta">' + esc(fmtDate(r.talkDate)) + (r.talkTime ? ' ' + esc(r.talkTime) : '') + ' · ' + esc(r.author || '') + '</span></div>' +
      '<div class="wk-text">' + esc(r.summary) + '</div>' +
      (r.agreedActions ? '<div class="wk-text talk-agreed">מה סוכם: ' + esc(r.agreedActions) + '</div>' : '') +
      '<div class="wk-entry-foot">' + fu +
      (r.canEdit === true && !readOnly ? '<button type="button" class="wk-link danger" data-wk-del="staffTalks|' + esc(r.id) + '">מחיקה</button>' : '') + '</div></li>';
  }
  /* readOnly (the employee card): no buttons and no forms — the card is a view. */
  function talksListHtml(rows, today, filterName, readOnly) {
    var threads = talkThreads(rows).filter(function (t) { return !filterName || norm(t.root.employeeName) === norm(filterName); });
    if (!threads.length) return '<div class="wk-empty">עדיין אין רישומים</div>';
    return '<div class="talk-threads">' + threads.map(function (t) {
      var status = t.outcome ? chip(TALK_OUTCOME_TONE[t.outcome.outcome] || 'ok', 'נסגר — ' + (TALK_OUTCOMES[t.outcome.outcome] || 'תוצאה'))
        : chip('open', 'פתוח · ' + (t.children.length + 1) + ' ' + (t.children.length ? 'שיחות' : 'שיחה'));
      var n = 1;
      var items = [talkEntryHtml(t.root, 'שיחה 1', readOnly)].concat(t.children.map(function (c) {
        return talkEntryHtml(c, c.talkKind === 'outcome' ? 'תוצאה' : 'שיחה ' + (++n), readOnly);
      }));
      var canAdd = !readOnly && t.root.canEdit === true && !t.outcome && isRootTalk(t.root);
      return '<article class="talk-thread' + (t.outcome ? ' is-closed' : '') + '" data-thread="' + esc(t.root.id) + '">' +
        '<header class="talk-thread-head"><span class="wk-name">' + esc(t.root.employeeName) + '</span>' + status + '</header>' +
        '<ul class="wk-log talk-steps">' + items.join('') + '</ul>' +
        (canAdd ? '<div class="crm-actions"><button type="button" class="wk-btn ghost" data-thread-open="' + esc(t.root.id) + '|followup">+ שיחת המשך</button>' +
          '<button type="button" class="wk-btn ghost" data-thread-open="' + esc(t.root.id) + '|outcome">✓ רישום תוצאה</button></div>' +
          talkFormHtml('followup', t, today) + talkFormHtml('outcome', t, today) : '') +
        '</article>';
    }).join('') + '</div>';
  }

  /* ── «מה היה בוועדה» ───────────────────────────────────── */
  function notesListHtml(rows, readOnly) {
    return '<ul class="wk-log">' + rows.map(function (r) {
      var fu = r.followUpDate ? (r.followUpDone ? '<span class="wk-fu done">מעקב בוצע</span>'
        : '<span class="wk-fu">מעקב: ' + esc(fmtDate(r.followUpDate)) + '</span>' +
          (r.canEdit === true && !readOnly ? '<button type="button" class="wk-link" data-wk-done="committeeNotes|' + esc(r.id) + '">סמן כבוצע</button>' : '')) : '';
      return '<li class="wk-entry" data-wk-id="' + esc(r.id) + '"><div class="wk-entry-head"><span class="wk-name">' + esc(r.patientName) + '</span>' +
        (DECISIONS[r.decision] ? chip('decision', DECISIONS[r.decision]) : '') +
        '<span class="wk-meta">' + esc(fmtDate(r.heldDate)) + ' · ' + esc(r.author || '') + '</span></div>' +
        '<div class="wk-text">' + esc(r.summary) + '</div>' +
        (r.participants ? '<div class="wk-text wk-dim">משתתפים: ' + esc(r.participants) + '</div>' : '') +
        (r.nextDate ? '<div class="wk-text wk-dim">ועדה הבאה מומלצת: ' + esc(fmtDate(r.nextDate)) + '</div>' : '') +
        '<div class="wk-entry-foot">' + fu + (r.canEdit === true && !readOnly ? '<button type="button" class="wk-link danger" data-wk-del="committeeNotes|' + esc(r.id) + '">מחיקה</button>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }
  function committeeNoteFormHtml(d) {
    var pats = (d && d.patients) || [];
    var today = (d && d.today) || '';
    return '<form class="wk-form" data-wk-form="committeeNotes" novalidate>' +
      '<input type="hidden" name="committeeId" value="">' +
      '<div class="wk-field wk-f-patient"><label for="cn-patient">מטופל/ת *</label><input id="cn-patient" name="patientName" maxlength="80" list="cn-patient-list" autocomplete="off" required>' +
      '<datalist id="cn-patient-list">' + pats.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist></div>' +
      '<div class="wk-field wk-f-date"><label for="cn-held">תאריך הוועדה *</label><input id="cn-held" name="heldDate" type="date" value="' + esc(today) + '" required></div>' +
      '<div class="wk-field wk-f-text"><label for="cn-part">משתתפים</label><input id="cn-part" name="participants" maxlength="300"></div>' +
      '<div class="wk-field wk-f-select"><label for="cn-dec">החלטה</label><select id="cn-dec" name="decision"><option value="">—</option>' +
        Object.keys(DECISIONS).map(function (k) { return '<option value="' + k + '">' + esc(DECISIONS[k]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="wk-field wk-f-textarea"><label for="cn-sum">מה היה בוועדה *</label><textarea id="cn-sum" name="summary" maxlength="1500" rows="4" required></textarea></div>' +
      '<div class="wk-field wk-f-date"><label for="cn-next">ועדה הבאה מומלצת</label><input id="cn-next" name="nextDate" type="date"></div>' +
      '<div class="wk-field wk-f-date"><label for="cn-fu">תזכורת למעקב (לא חובה)</label><input id="cn-fu" name="followUpDate" type="date"></div>' +
      '<div class="wk-actions"><button type="submit" class="wk-btn">שמירת סיכום הוועדה</button><span class="wk-msg" data-wk-msg></span></div></form>';
  }
  /* The «ועדות» sub-tab below the read-only list: a «📝 מה היה» button per
   * committee is drawn by committeesHtml (work.js); here the form + history. */
  function committeeNotesPanelHtml(d) {
    var rows = logsOf(d, 'committeeNotes');
    return '<div class="card work-card wk-committeeNotes" data-cn-card><div class="card-title">📝 מה היה בוועדה</div>' +
      '<div class="wk-note">את מועד הוועדה קובעים הרכזים. כאן רושמים מה היה בה — ההחלטה, מי השתתף ומה הלאה. נראה לך, לסנדרה ולרון.</div>' +
      committeeNoteFormHtml(d) + '</div>' +
      '<div class="card work-card wk-cn-list"><div class="card-title">סיכומי ועדות (' + rows.length + ')</div>' +
      (rows.length ? notesListHtml(rows) : '<div class="wk-empty">עדיין אין סיכומי ועדות</div>') + '</div>';
  }

  /* ── «כרטיס עובד/ת» ─────────────────────────────────── */
  function employeeCardHtml(d, name, staffCost, feedbackRow, active) {
    var t = d && d.team;
    var s = t && t.available ? (t.staff || []).filter(function (x) { return norm(x.name) === norm(name); })[0] : null;
    if (!s) return '<div class="wk-empty">העובד/ת לא נמצא/ה ברשימת הבית — רעננו את הדף</div>';
    var tel = /^0\d{8,9}$/.test(String(s.phone || '')) ? 'tel:' + s.phone : '';
    var seniority = '';
    if (ISO_RE.test(String(s.startDate || '')) && d.today) {
      var mo = (Number(d.today.slice(0, 4)) - Number(s.startDate.slice(0, 4))) * 12 + Number(d.today.slice(5, 7)) - Number(s.startDate.slice(5, 7));
      seniority = mo >= 12 ? Math.floor(mo / 12) + ' שנים' + (mo % 12 ? ' ו-' + (mo % 12) + ' חודשים' : '') : mo >= 0 ? mo + ' חודשים' : '';
    }
    var details = fieldsHtml([
      ['תפקיד', s.role || (s.kind === 'therapist' ? 'מטפל/ת' : 'מדריך/ה')],
      ['טלפון', tel ? '<a class="wk-tel" href="' + esc(tel) + '">📞 ' + esc(s.phone) + '</a>' : '—', !!tel],
      ['תחילת עבודה', s.startDate ? fmtDate(s.startDate) : 'אין תאריך במערכת'],
      seniority ? ['ותק', seniority] : null,
      ['זמינות', s.onLeave ? 'בחופשה' : 'פעיל/ה'],
      s.kind === 'therapist' && (s.workdays || []).length ? ['ימי עבודה', s.workdays.map(function (x) { return WEEKDAYS[x]; }).filter(Boolean).join(', ')] : null
    ]);
    var cost;
    if (!staffCost || !staffCost.available) cost = '<div class="wk-empty">' + esc(staffCost && staffCost.loading ? 'טוען…' : 'נתוני העלות לא זמינים כרגע') + '</div>';
    else {
      var w = (staffCost.workers || []).filter(function (x) { return norm(x.name) === norm(name); })[0];
      cost = w ? fieldsHtml([
        ['עלות ' + monthHe(staffCost.month), ils(w.cost)],
        ['מקור', w.estimated ? 'הערכה (עוד אין דוח שכר)' : 'לפי דוח השכר'],
        ['חלק מעלות הבית', staffCost.total ? Math.round((w.cost / staffCost.total) * 100) + '%' : '—']
      ]) : '<div class="wk-empty">אין לעובד/ת עלות רשומה בבית בחודש הזה</div>';
    }
    var talks = (d.logs && d.logs.staffTalks) ? talksListHtml(d.logs.staffTalks, d.today, name, true) : '<div class="wk-empty">עדיין אין רישומים</div>';
    var fb = feedbackRow ? fieldsHtml([
      ['משוב אחרון', feedbackRow.lastFeedback ? fmtDate(feedbackRow.lastFeedback) : 'עוד לא נרשם'],
      ['המשוב הבא', feedbackRow.due ? fmtDate(feedbackRow.due) : '—'],
      ['מצב', feedbackRow.status === 'overdue' ? 'באיחור' : feedbackRow.status === 'soon' ? 'בקרוב' : feedbackRow.status === 'unknown' ? 'אין תאריך התחלה' : 'בהמשך']
    ]) + '<div class="crm-actions"><button type="button" class="wk-btn ghost" data-go-sub="team" data-drawer-close>לסימון משוב ←</button></div>'
      : '<div class="wk-empty">אין נתוני משוב</div>';
    return '<div class="crm-card-sub">' + esc((s.role || '') + (s.onLeave ? ' · בחופשה' : '')) + '</div>' +
      cardTabsHtml('employee', [
        { key: 'details', label: 'פרטים', html: details },
        { key: 'cost', label: 'עלות', html: cost },
        { key: 'talks', label: 'שיחות', html: talks + '<div class="crm-actions"><button type="button" class="wk-btn" data-emp-talk="' + esc(s.name) + '">💬 רישום שיחה חדשה</button></div>' },
        { key: 'feedback', label: 'משוב', html: fb }
      ], active);
  }

  /* ── «תקציב כוח אדם» ────────────────────────────────── */
  var STAFF_REASON = {
    not_configured: 'החיבור לאפליקציית כוח האדם עוד לא הוגדר. פנו לסנדרה.',
    unauthorized: 'אין הרשאה לקרוא את העלויות מאפליקציית כוח האדם. פנו לסנדרה.',
    not_deployed: 'רשימת העובדים עם העלות עוד לא הופעלה באפליקציית כוח האדם.',
    no_house: 'לבית אין עלויות רשומות באפליקציית כוח האדם לחודש הזה.',
    unreachable: 'אין חיבור לאפליקציית כוח האדם כרגע. נסו שוב מאוחר יותר.'
  };
  function budgetStatus(cost, budget) {
    if (!budget) return { cls: 'none', pct: null, text: 'לא הוגדר תקציב' };
    var pct = Math.round((cost / budget) * 100);
    if (pct <= 100) return { cls: 'ok', pct: pct, text: 'בתקציב' };
    if (pct <= 105) return { cls: 'warn', pct: pct, text: 'חריגה קלה' };
    return { cls: 'bad', pct: pct, text: 'חריגה' };
  }
  function barHtml(cost, budget) {
    var st = budgetStatus(cost, budget);
    if (st.pct === null) return '';
    return '<div class="budget-bar ' + st.cls + '" role="img" aria-label="' + esc(st.pct + '% מהתקציב') + '"><div class="budget-fill" style="width:' + Math.min(100, Math.max(0, st.pct)) + '%"></div></div>';
  }
  /* st = { staff: houseStaffCost.staff | {loading}, quarter: budgetBonusQuarter() | null } */
  function budgetHtml(st) {
    var s = st && st.staff;
    var h = '';
    if (!s || s.loading) return '<div class="card work-card"><div class="wk-empty">טוען את נתוני התקציב…</div></div>';
    if (!s.available) {
      h += '<div class="card work-card wk-budget-sum"><div class="card-title">תקציב כוח אדם</div><div class="wk-empty">' +
        esc(STAFF_REASON[s.reason] || 'לא הצלחנו לקרוא את נתוני כוח האדם. נסו שוב מאוחר יותר.') + '</div>' +
        '<div class="crm-actions"><button type="button" class="wk-btn ghost" data-budget-retry>נסו שוב</button></div></div>';
    } else {
      var total = Math.max(0, Number(s.total) || 0), budget = s.budget ? Math.max(0, Number(s.budget) || 0) : 0;
      var bst = budgetStatus(total, budget);
      h += '<div class="card work-card wk-budget-sum"><div class="card-title">תקציב כוח אדם — ' + esc(monthHe(s.month)) + '</div>' +
        '<div class="budget-kpis">' +
          '<div class="budget-kpi"><b>' + esc(ils(total)) + '</b><span>עלות החודש</span></div>' +
          '<div class="budget-kpi"><b>' + esc(budget ? ils(budget) : '—') + '</b><span>תקציב החודש</span></div>' +
          '<div class="budget-kpi ' + bst.cls + '"><b>' + esc(bst.pct === null ? '—' : bst.pct + '%') + '</b><span>' + esc(bst.text) + '</span></div>' +
          '<div class="budget-kpi"><b>' + esc(budget ? ils(budget - total) : '—') + '</b><span>' + esc(budget && total > budget ? 'חריגה' : 'נשאר') + '</span></div>' +
        '</div>' + barHtml(total, budget) +
        '<div class="wk-note">' + esc(s.hasActuals ? 'חלק מהעלות כבר לפי דוח השכר, והשאר הערכה.' : 'עדיין אין דוח שכר לחודש הזה — הסכומים הם הערכה.') +
        (s.stale ? ' (הנתון לא התעדכן לאחרונה)' : '') + '</div></div>';
      var lines = (s.budgetLines || []).filter(function (l) { return l && (l.budget || l.cost); });
      if (lines.length) {
        h += '<div class="card work-card wk-budget-lines"><div class="card-title">לפי סעיף תקציב</div><div class="tbl-wrap"><table class="crm-tbl"><thead><tr><th>סעיף</th><th>תקציב</th><th>עלות</th><th>הפרש</th></tr></thead><tbody>' +
          lines.map(function (l) {
            var has = l.budget !== null && l.budget !== undefined;
            var diff = has ? l.budget - l.cost : null;
            return '<tr><td>' + esc(l.label || l.key) + '</td><td>' + esc(has ? ils(l.budget) : '—') + '</td><td>' + esc(ils(l.cost)) + '</td><td class="' +
              (diff === null ? '' : diff < 0 ? 'neg' : 'pos') + '">' + esc(diff === null ? '—' : ils(diff)) + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }
      var workers = s.workers || [];
      h += '<div class="card work-card wk-budget-workers"><div class="card-title">העובדים ועלות השכר (' + workers.filter(function (w) { return w.name; }).length + ')</div>' +
        '<div class="wk-note">רשימה מעודכנת מאפליקציית כוח האדם. נראית רק לך, לסנדרה ולרון.</div>' +
        (workers.length ? '<div class="tbl-wrap"><table class="crm-tbl"><thead><tr><th>עובד/ת</th><th>תפקיד</th><th>עלות החודש</th><th>% מהבית</th><th></th></tr></thead><tbody>' +
          workers.map(function (w) {
            var pct = total ? Math.round((w.cost / total) * 100) : 0;
            return '<tr' + (w.name ? '' : ' class="muted"') + '><td>' + (w.name ? '<button type="button" class="link-cell" data-emp-open="' + esc(w.name) + '">' + esc(w.name) + '</button>' : 'אחר (ללא שם)') + '</td>' +
              '<td>' + esc((w.roles || []).join(', ') || '—') + '</td><td>' + esc(ils(w.cost)) + '</td><td>' + esc(pct + '%') + '</td>' +
              '<td>' + (w.estimated ? chip('wait', 'הערכה') : chip('ok', 'דוח שכר')) + '</td></tr>';
          }).join('') + '</tbody><tfoot><tr><td>סה״כ</td><td></td><td>' + esc(ils(total)) + '</td><td>100%</td><td></td></tr></tfoot></table></div>'
          : '<div class="wk-empty">אין עובדים עם עלות בחודש הזה</div>') + '</div>';
    }
    (st.monthBonuses || []).forEach(function (mb) { h += monthBonusCardHtml(mb); });
    if (st.quarter) h += quarterHtml(st.quarter);
    return h;
  }
  function quarterHtml(q) {
    if (!q || !q.quarter) return '';
    var rows = q.months.map(function (m) {
      var stt = m.available ? budgetStatus(m.cost, m.budget) : null;
      return '<tr><td>' + esc(monthHe(m.ym)) + '</td><td>' + esc(m.budget ? ils(m.budget) : '—') + '</td><td>' +
        esc(m.available ? ils(m.cost) : m.future ? 'עוד לא' : 'לא זמין') + '</td><td>' + (stt && stt.pct !== null ? chip(stt.cls, stt.pct + '%') : '—') + '</td></tr>';
    }).join('');
    return '<div class="card work-card wk-budget-quarter"><div class="card-title">' + esc(q.quarter.label) + ' — מבט רבעוני</div>' +
      '<div class="tbl-wrap"><table class="crm-tbl"><thead><tr><th>חודש</th><th>תקציב</th><th>עלות</th><th>ניצול</th></tr></thead><tbody>' + rows +
      '</tbody></table></div>' + budgetBonusLineHtml(q) + '</div>';
  }
  var BB_TEXT = {
    earned: 'עמד/ה בתקציב ברבעון — זכאי/ת לבונוס',
    not_earned: 'הרבעון הסתיים בחריגה מהתקציב — אין בונוס',
    on_track: 'בדרך לבונוס — הצפי לרבעון בתוך התקציב',
    at_risk: 'חריגה צפויה — הצפי לרבעון מעל התקציב',
    missing_data: 'חסרים נתוני עלות או תקציב — עוד אי אפשר לחשב',
    not_enabled: 'הבונוס הרבעוני עוד לא התחיל'
  };
  var BB_TONE = { earned: 'ok', not_earned: 'bad', on_track: 'ok', at_risk: 'warn', missing_data: 'wait', not_enabled: 'wait' };
  function notEnabledText(q) {
    return q.startsLabel ? 'הבונוס הרבעוני מתחיל ב' + q.startsLabel + (q.startsAmount ? ' — ' + ils(q.startsAmount) : '') : BB_TEXT.not_enabled;
  }
  function budgetBonusLineHtml(q) {
    var text = q.status === 'not_enabled' ? notEnabledText(q) : (BB_TEXT[q.status] || '');
    return '<div class="bb-line ' + (BB_TONE[q.status] || 'wait') + '"><b>' + esc(text) + '</b>' +
      (q.status !== 'not_enabled' && q.forecast !== null && !q.settled && q.forecastBudget ? '<span>' + esc('צפי לרבעון: ' + ils(q.forecast) + ' מתוך ' + ils(q.forecastBudget)) + '</span>' : '') +
      (q.status !== 'not_enabled' && q.settled && q.budget ? '<span>' + esc('עלות הרבעון: ' + ils(q.spent) + ' מתוך ' + ils(q.budget)) + '</span>' : '') + '</div>';
  }
  /* One-off monthly budget bonus (15 Nov 2026: December 2026, 2,500 ₪). */
  var MB_TEXT = {
    earned: 'עמד/ה ביעד החודש — זכאי/ת לבונוס',
    not_earned: 'החודש הסתיים מעל היעד — אין בונוס',
    on_track: 'בדרך לבונוס — העלות הצפויה בתוך היעד',
    at_risk: 'חריגה צפויה — העלות הצפויה מעל היעד',
    missing_data: 'חסרים נתוני עלות או יעד — עוד אי אפשר לחשב'
  };
  function monthBonusBlockHtml(mb) {
    if (!mb || !mb.enabled) return '';
    var when = mb.settled ? ' — סופי' : mb.future ? ' — עוד לא התחיל' : ' — בתהליך';
    var line = '<div class="bb-line ' + (BB_TONE[mb.status] || 'wait') + '"><b>' + esc(MB_TEXT[mb.status] || '') + '</b>' +
      (mb.budget ? '<span>' + esc((mb.settled ? 'עלות החודש: ' : 'עלות צפויה: ') + ils(mb.cost) + ' מתוך יעד ' + ils(mb.budget)) + '</span>' : '') + '</div>';
    return '<div class="bb-month"><div class="bb-cond">בונוס חד-פעמי: אם עלות כוח האדם של ' + esc(monthHe(mb.ym)) +
      ' לא עוברת את יעד התקציב של החודש. בנוסף לבונוס הרבעוני ובלי קשר אליו.</div>' +
      '<div class="bb-head"><span class="bb-q">' + esc(monthHe(mb.ym) + when) + '</span><span class="bb-amount">' + esc(ils(mb.amount)) + '</span></div>' +
      line + (mb.budget ? barHtml(mb.cost, mb.budget) : '') + '</div>';
  }
  function monthBonusCardHtml(mb) {
    if (!mb || !mb.enabled) return '';
    return '<div class="card work-card wk-budget-month"><div class="card-title">' + esc('בונוס יעד ' + monthHe(mb.ym)) + '</div>' + monthBonusBlockHtml(mb) + '</div>';
  }
  /* The «בונוס» tab card. q = budgetBonusQuarter(...) or { loading } / { error } / null;
   * monthBonuses = [budgetBonusMonth(...)] — the one-off monthly bonuses in view. */
  function budgetBonusHtml(q, monthBonuses) {
    var title = '<div class="card-title">בונוס עמידה בתקציב</div>';
    if (!q || q.loading) return title + '<div class="wk-empty">טוען…</div>';
    if (q.error) return title + '<div class="wk-empty">' + esc(q.error) + '</div>';
    var months = (monthBonuses || []).filter(function (m) { return m && m.enabled; }).map(monthBonusBlockHtml).join('');
    var quarter;
    if (q.status === 'not_enabled') {
      quarter = '<div class="bb-cond">רבעוני: עלות כוח האדם של הבית ברבעון לא עוברת את תקציב כוח האדם של הרבעון. נבדק פעם ברבעון, אחרי שהרבעון מסתיים.</div>' +
        budgetBonusLineHtml(q);
    } else {
      var amount = q.amount ? ils(q.amount) : 'הסכום ייקבע על ידי סנדרה';
      quarter = '<div class="bb-cond">רבעוני: עלות כוח האדם של הבית ברבעון לא עוברת את תקציב כוח האדם של הרבעון. נבדק פעם ברבעון, אחרי שהרבעון מסתיים.</div>' +
        '<div class="bb-head"><span class="bb-q">' + esc(q.quarter ? q.quarter.label : '') + (q.settled ? ' — סופי' : ' — בתהליך') + '</span><span class="bb-amount">' + esc(amount) + '</span></div>' +
        budgetBonusLineHtml(q) + barHtml(q.settled ? q.spent : (q.forecast || 0), q.settled ? q.budget : (q.forecastBudget || 0));
    }
    return title + months + '<div class="bb-quarter">' + quarter + '</div>' +
      '<button type="button" class="wk-link" data-go-sub="budget">לפירוט בתקציב כוח אדם ←</button>';
  }

  var CrmView = {
    esc: esc, fmtDate: fmtDate, ils: ils, monthHe: monthHe,
    TALK_OUTCOMES: TALK_OUTCOMES, DECISIONS: DECISIONS, STAFF_REASON: STAFF_REASON,
    therapistsOf: therapistsOf, sessionsOf: sessionsOf, nextCommitteeOf: nextCommitteeOf,
    patientRowExtras: patientRowExtras, patientCardHtml: patientCardHtml, cardTabsHtml: cardTabsHtml,
    talkThreads: talkThreads, talksListHtml: talksListHtml,
    committeeNoteFormHtml: committeeNoteFormHtml, committeeNotesPanelHtml: committeeNotesPanelHtml, notesListHtml: notesListHtml,
    employeeCardHtml: employeeCardHtml, budgetStatus: budgetStatus, budgetHtml: budgetHtml, quarterHtml: quarterHtml,
    budgetBonusHtml: budgetBonusHtml, monthBonusCardHtml: monthBonusCardHtml
  };
  root.CrmView = CrmView;
  if (typeof module === 'object' && module.exports) module.exports = CrmView;
}(typeof self !== 'undefined' ? self : this));
