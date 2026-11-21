/* Managers CRM views (14 Nov 2026, docs/crm-redesign.md).
 *
 * Sandra: «לשנות את כל המראה … הרבה יותר כלי לניהול למנהל … פרטים מלאים הכל
 * בלשוניות כמו CRM». Pure view builders (no DOM, no fetch) for:
 *   - the patient card   («כרטיס מטופל/ת») — פרטים · טיפול · משפחה · ועדות · סוגיות
 *   - the employee card  («כרטיס עובד/ת») — פרטים · עלות · שיחות · משוב
 *   - staff-talk THREADS — a first talk, follow-up talks and an outcome
 *   - «שיחות עם משפחה»   — the contact person (from the Dashboard) and the
 *                          documented calls, per patient (16 Nov 2026)
 *   - «תקציב כוח אדם»     — month cost vs budget, the saving from ends of
 *                          employment (staffing's forecast), the workers with the
 *                          per-worker SIMULATION and next month's cost, the quarter
 * «מה היה בוועדה» (14 Nov 2026) was removed on 16 Nov 2026 — the therapists
 * document a committee, not the managers; committees are information only.
 *   - the quarterly budget-adherence bonus card (math: lib/bonus-eligibility.js)
 *
 * Every value from a feed is escaped (esc) before it reaches markup. Wiring
 * (clicks, saves, loads) lives in work.js. Tested in test/crm-view.test.js. */
(function (root) {
  'use strict';
  var FD = root.FeedbackDue || (typeof require === 'function' ? require('../lib/feedback-due.js') : null);

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
  /* A birth date keeps its full year (1/5/1990) — two digits would be ambiguous. */
  function fmtDateFull(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (parseInt(m[3], 10) + '/' + parseInt(m[2], 10) + '/' + m[1]) : '';
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
  /* A cell that carries its column's name (data-label): on a phone a wide table is shown one
   * block per row, each value with its label (styles.css .stack-tbl). `html` is already escaped. */
  function td(label, html, cls) { return '<td data-label="' + esc(label) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>'; }

  /* ── allowlists (the backend keeps the same keys) ───────── */
  var TALK_OUTCOMES = {
    improved: 'שיפור', no_change: 'ללא שינוי', warning: 'שיחת אזהרה',
    hr: 'הועבר למשאבי אנוש', termination: 'סיום העסקה', closed: 'נסגר'
  };
  var TALK_OUTCOME_TONE = { improved: 'ok', no_change: 'wait', warning: 'warn', hr: 'warn', termination: 'bad', closed: 'ok' };

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
  function familyCallsOf(d, name) {
    var n = norm(name);
    return logsOf(d, 'familyCalls').filter(function (r) { return norm(r.patientName) === n; });
  }
  /* The patient's contact person, as the Dashboard holds it (the lead the
   * patient came from): { name, relation, phone, updatesPhone } or null. A
   * phone is kept only when it is a plain local number (it becomes a tel: link). */
  function okPhone(v) { var p = String(v == null ? '' : v).replace(/[\s-]/g, ''); return /^0\d{8,9}$/.test(p) ? p : ''; }
  function contactOf(p) {
    var c = p && p.contact;
    if (!c || typeof c !== 'object') return null;
    var out = { name: norm(c.name), relation: norm(c.relation), phone: okPhone(c.phone), updatesPhone: okPhone(c.updatesPhone) };
    if (out.updatesPhone === out.phone) out.updatesPhone = '';
    return (out.name || out.relation || out.phone || out.updatesPhone) ? out : null;
  }
  function telLink(phone, label) {
    return phone ? '<a class="wk-tel" href="tel:' + esc(phone) + '" aria-label="' + esc(label || 'התקשרות') + '">📞 ' + esc(phone) + '</a>' : '';
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
    // Committees are information only (16 Nov 2026): when there is one.
    var cm = upcoming.length ? '<ul class="wk-list">' + upcoming.map(function (c) {
      return '<li><span class="wk-shift">' + esc(fmtDate(c.date) + (c.time ? ' ' + c.time : '')) + '</span><span class="wk-name">' + esc(c.type || 'ועדה') + '</span>' +
        (c.participants ? '<span class="wk-meta">' + esc(c.participants) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין ועדה קרובה</div>';
    var ev = eventsOf(d, p.name);
    var evHtml = ev.length ? '<ul class="wk-log">' + ev.map(function (r) {
      return '<li class="wk-entry"><div class="wk-entry-head"><span class="wk-name">' + esc(fmtDate(r.eventDate) + (r.eventTime ? ' ' + r.eventTime : '')) +
        '</span><span class="wk-meta">' + esc(r.author || '') + '</span></div><div class="wk-text">' + esc(r.whatHappened) + '</div>' +
        (r.actionTaken ? '<div class="wk-text">מה נעשה: ' + esc(r.actionTaken) + '</div>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="wk-empty">אין סוגיות תפעוליות רשומות</div>';
    // «משפחה» (16 Nov 2026): the contact person from the Dashboard + the documented calls.
    var ct = contactOf(p);
    var calls = familyCallsOf(d, p.name);
    var fam = (ct ? fieldsHtml([
      ['איש/אשת קשר', ct.name],
      ['קרבה', ct.relation],
      ['טלפון', ct.phone ? telLink(ct.phone, 'התקשרות ל' + (ct.name || 'איש הקשר')) : '—', !!ct.phone],
      ct.updatesPhone ? ['טלפון לעדכונים', telLink(ct.updatesPhone, 'התקשרות לטלפון העדכונים'), true] : null
    ]) : '<div class="wk-empty">' + esc(d.contactsSupported === true ? 'אין איש קשר רשום בדשבורד למטופל/ת' : 'פרטי איש הקשר מהדשבורד עוד לא מחוברים') + '</div>') +
      '<div class="card-subtitle">שיחות עם המשפחה (' + calls.length + ')</div>' +
      (calls.length ? familyCallsListHtml(calls, { readOnly: true, flat: true }) : '<div class="wk-empty">עוד לא תועדה שיחה</div>') +
      '<div class="crm-actions"><button type="button" class="wk-btn" data-pt-family="' + esc(i) + '">📞 רישום שיחה עם המשפחה</button></div>';
    return '<div class="crm-card-sub">' + esc('בבית מ-' + fmtDate(p.entryDate) + ' · יום ' + p.days) + '</div>' +
      cardTabsHtml('patient', [
        { key: 'details', label: 'פרטים', html: details },
        { key: 'treatment', label: 'טיפול', html: treat },
        { key: 'family', label: 'משפחה (' + calls.length + ')', html: fam },
        { key: 'committees', label: 'ועדות (' + upcoming.length + ')', html: cm },
        { key: 'events', label: 'סוגיות (' + ev.length + ')', html: evHtml }
      ], active);
  }

  /* ── «שיחות עם משפחה» (16 Nov 2026) ────────────────────
   * Sandra: «תוסיף שדה אחרי מטופלים לשיחות עם בני משפחה שתהיה מתועדת כמו ב-CRM.
   * תיקח את הנתונים מדשבורד, יש שם את כל המידע של איש הקשר».
   * familyContactsHtml: one row per patient in the house — the contact person
   * (Dashboard), the last documented call, how many, and «רישום שיחה».
   * familyCallsListHtml: the calls, grouped by patient, newest first. */
  function lastCallOf(rows) {
    var best = null;
    rows.forEach(function (r) {
      var k = String(r.callDate || '') + (r.callTime || '');
      if (!best || k > best.k) best = { k: k, r: r };
    });
    return best ? best.r : null;
  }
  function familyContactsHtml(d) {
    var pats = (d && d.patients) || [];
    var supported = !!d && d.contactsSupported === true;
    var h = '<div class="card work-card wk-fam-contacts" data-default-open><div class="card-title">אנשי קשר לפי מטופל/ת (' + pats.length + ')</div>';
    h += '<div class="wk-note">' + esc(supported
      ? 'פרטי איש הקשר מגיעים מהדשבורד (הליד של המטופל/ת). לתיקון פרט — מעדכנים בדשבורד.'
      : 'פרטי איש הקשר מהדשבורד עוד לא מחוברים — אפשר כבר לתעד שיחות, ולרשום עם מי דיברת.') + '</div>';
    if (!pats.length) return h + '<div class="wk-empty">אין מטופלים רשומים בבית</div></div>';
    h += '<div class="tbl-wrap"><table class="crm-tbl fam-tbl stack-tbl"><thead><tr><th>מטופל/ת</th><th>איש/אשת קשר</th><th>טלפון</th><th>שיחה אחרונה</th><th>שיחות</th><th></th></tr></thead><tbody>' +
      pats.map(function (p, i) {
        var ct = contactOf(p);
        var calls = familyCallsOf(d, p.name);
        var last = lastCallOf(calls);
        return '<tr>' + td('מטופל/ת', '<button type="button" class="link-cell" data-pt-open="' + i + '" data-pt-tab="family">' + esc(p.name) + '</button>') +
          td('איש/אשת קשר', ct && (ct.name || ct.relation) ? esc(ct.name || '—') + (ct.relation ? ' <span class="wk-meta">(' + esc(ct.relation) + ')</span>' : '') : '<span class="wk-meta">—</span>') +
          td('טלפון', ct && (ct.phone || ct.updatesPhone) ? telLink(ct.phone || ct.updatesPhone, 'התקשרות לאיש הקשר של ' + p.name) : '<span class="wk-meta">—</span>') +
          td('שיחה אחרונה', last ? esc(fmtDate(last.callDate)) : '<span class="wk-meta">עוד לא</span>') +
          td('שיחות', String(calls.length)) +
          td('', '<button type="button" class="wk-link fam-add" data-fam-add="' + i + '">+ רישום שיחה</button>') + '</tr>';
      }).join('') + '</tbody></table></div>';
    return h + '</div>';
  }
  function familyEntryHtml(r, readOnly) {
    var fu = '';
    if (r.followUpDate) {
      fu = r.followUpDone ? '<span class="wk-fu done">מעקב בוצע</span>'
        : '<span class="wk-fu">מעקב: ' + esc(fmtDate(r.followUpDate)) + '</span>' +
          (r.canEdit === true && !readOnly ? '<button type="button" class="wk-link" data-wk-done="familyCalls|' + esc(r.id) + '">סמן כבוצע</button>' : '');
    }
    return '<li class="wk-entry" data-wk-id="' + esc(r.id) + '"><div class="wk-entry-head"><span class="talk-step">' +
      esc(fmtDate(r.callDate) + (r.callTime ? ' ' + r.callTime : '')) + '</span><span class="wk-name">' + esc(r.contactName || '') +
      (r.relation ? ' <span class="wk-meta">(' + esc(r.relation) + ')</span>' : '') + '</span><span class="wk-meta">' + esc(r.author || '') + '</span></div>' +
      '<div class="wk-text">' + esc(r.summary) + '</div><div class="wk-entry-foot">' + fu +
      (r.canEdit === true && !readOnly ? '<button type="button" class="wk-link danger" data-wk-del="familyCalls|' + esc(r.id) + '">מחיקה</button>' : '') + '</div></li>';
  }
  /* opts: { filter: patient name | '', readOnly, flat (no patient grouping — the patient card) }. */
  function familyCallsListHtml(rows, opts) {
    opts = opts || {};
    var list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && (!opts.filter || norm(r.patientName) === norm(opts.filter)); });
    if (!list.length) return '<div class="wk-empty">' + (opts.filter ? 'אין שיחות מתועדות למטופל/ת' : 'עדיין אין שיחות מתועדות') + '</div>';
    var byKey = function (a, b) { return (String(b.callDate || '') + (b.callTime || '') + (b.createdAt || '')).localeCompare(String(a.callDate || '') + (a.callTime || '') + (a.createdAt || '')); };
    if (opts.flat) return '<ul class="wk-log talk-steps">' + list.slice().sort(byKey).map(function (r) { return familyEntryHtml(r, opts.readOnly); }).join('') + '</ul>';
    var groups = {}, order = [];
    list.slice().sort(byKey).forEach(function (r) {
      var k = norm(r.patientName);
      if (!groups[k]) { groups[k] = { name: r.patientName, rows: [] }; order.push(k); }
      groups[k].rows.push(r);
    });
    return '<div class="talk-threads">' + order.map(function (k) {
      var g = groups[k];
      var open = g.rows.filter(function (r) { return r.followUpDate && !r.followUpDone; }).length;
      return '<article class="talk-thread fam-thread"><header class="talk-thread-head"><span class="wk-name">' + esc(g.name) + '</span>' +
        chip('open', g.rows.length === 1 ? 'שיחה אחת' : g.rows.length + ' שיחות') + (open ? chip('warn', open === 1 ? 'מעקב פתוח' : open + ' מעקבים פתוחים') : '') + '</header>' +
        '<ul class="wk-log talk-steps">' + g.rows.map(function (r) { return familyEntryHtml(r, opts.readOnly); }).join('') + '</ul></article>';
    }).join('') + '</div>';
  }
  /* The filter of the calls list: every patient that has a documented call. */
  function familyFilterHtml(rows, value) {
    var seen = {}, names = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) { var k = norm(r && r.patientName); if (k && !seen[k]) { seen[k] = true; names.push(r.patientName); } });
    names.sort(function (a, b) { return String(a).localeCompare(String(b), 'he'); });
    return '<label class="month-picker fam-filter"><span>מטופל/ת</span><select data-fam-filter aria-label="סינון השיחות לפי מטופל/ת"><option value="">כל המטופלים</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '"' + (norm(n) === norm(value) ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>';
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

  /* ── «כרטיס עובד/ת» ─────────────────────────────────── */
  function employeeCardHtml(d, name, staffCost, feedbackRow, active) {
    var t = d && d.team, roster = t && t.available ? t.staff || [] : [];
    var s = FD ? FD.resolveEmployee(roster, name) : roster.filter(function (x) { return norm(x.name) === norm(name); })[0];
    if (!s) return '<div class="wk-empty">לא ניתן לזהות את העובד/ת באופן חד-משמעי לפי המידע הקיים. יש לבדוק מזהה עובד או טלפון במקור.</div>';
    var sameName = roster.filter(function (x) { return x && norm(x.name) === norm(s.name); }).length > 1;
    var costRow = function (rows) {
      var list = Array.isArray(rows) ? rows : [];
      var id = FD && FD.workerId(s), phone = FD && FD.validPhone(s);
      var matches = id ? list.filter(function (x) { return FD.workerId(x) === id; }) : [];
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return null;
      matches = phone ? list.filter(function (x) { return FD.validPhone(x) === phone; }) : [];
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return null;
      // Do not attribute a name-only cost to either of two same-name employees.
      if (sameName) return null;
      matches = list.filter(function (x) { return norm(x.name) === norm(s.name); });
      return matches.length === 1 ? matches[0] : null;
    };
    var tel = /^0\d{8,9}$/.test(String(s.phone || '')) ? 'tel:' + s.phone : '';
    var seniority = '';
    if (ISO_RE.test(String(s.startDate || '')) && d.today) {
      var mo = (Number(d.today.slice(0, 4)) - Number(s.startDate.slice(0, 4))) * 12 + Number(d.today.slice(5, 7)) - Number(s.startDate.slice(5, 7));
      seniority = mo >= 12 ? Math.floor(mo / 12) + ' שנים' + (mo % 12 ? ' ו-' + (mo % 12) + ' חודשים' : '') : mo >= 0 ? mo + ' חודשים' : '';
    }
    // «תאריך לידה» (17 Nov 2026, Sandra: «תוסיף תאריכי לידה בפרטי העובד, עכשיו בסטאפינג מוסיפים
    // אז צריך שזה ישאב משם נתונים»): from the staffing list the card already loads for «עלות»
    // (houseStaffCost → worker.birthDate). A real past date only; no row when the list is unreadable.
    var born = null;
    if (staffCost && staffCost.loading) born = ['תאריך לידה', 'טוען…'];
    else if (staffCost && staffCost.available) {
      var bw = costRow(staffCost.workers);
      var bd = bw && ISO_RE.test(String(bw.birthDate || '')) && (!d.today || bw.birthDate <= d.today) ? bw.birthDate : '';
      born = ['תאריך לידה', bd ? fmtDateFull(bd) : 'לא הוזן באפליקציית כוח האדם'];
    }
    var details = fieldsHtml([
      ['תפקיד', s.role || (s.kind === 'therapist' ? 'מטפל/ת' : 'מדריך/ה')],
      ['טלפון', tel ? '<a class="wk-tel" href="' + esc(tel) + '">📞 ' + esc(s.phone) + '</a>' : '—', !!tel],
      ['תחילת עבודה', s.startDate ? fmtDate(s.startDate) : 'אין תאריך במערכת'],
      seniority ? ['ותק', seniority] : null,
      born,
      ['זמינות', s.onLeave ? 'בחופשה' : 'פעיל/ה'],
      s.kind === 'therapist' && (s.workdays || []).length ? ['ימי עבודה', s.workdays.map(function (x) { return WEEKDAYS[x]; }).filter(Boolean).join(', ')] : null
    ]);
    var cost;
    if (!staffCost || !staffCost.available) cost = '<div class="wk-empty">' + esc(staffCost && staffCost.loading ? 'טוען…' : 'נתוני העלות לא זמינים כרגע') + '</div>';
    else {
      var w = costRow(staffCost.workers);
      cost = w ? fieldsHtml([
        ['עלות ' + monthHe(staffCost.month), ils(w.cost)],
        ['מקור', w.estimated ? 'הערכה (עוד אין דוח שכר)' : 'לפי דוח השכר'],
        ['חלק מעלות הבית', staffCost.total ? Math.round((w.cost / staffCost.total) * 100) + '%' : '—'],
        (sameName ? endOf(w) : endOfRow(staffCost, w)) ? ['סיום עבודה בבית', fmtDate(sameName ? endOf(w) : endOfRow(staffCost, w))] : null
      ]) : '<div class="wk-empty">אין לעובד/ת עלות רשומה בבית בחודש הזה</div>';
    }
    var talks = sameName ? '<div class="wk-empty">יש עובדים עם שם זהה. שיחות שתועדו לפי שם בלבד אינן משויכות לכרטיס אישי עד לאימות מזהה.</div>' :
      (d.logs && d.logs.staffTalks) ? talksListHtml(d.logs.staffTalks, d.today, s.name, true) : '<div class="wk-empty">עדיין אין רישומים</div>';
    var fb = feedbackRow ? fieldsHtml([
      ['משוב אחרון', feedbackRow.lastFeedback ? fmtDate(feedbackRow.lastFeedback) : 'עוד לא נרשם'],
      ['המשוב הבא', feedbackRow.due ? fmtDate(feedbackRow.due) : '—'],
      ['מצב', feedbackRow.status === 'overdue' ? 'באיחור' : feedbackRow.status === 'soon' ? 'בקרוב' : feedbackRow.status === 'unknown' ? 'אין תאריך התחלה' : 'בהמשך']
    ]) + (feedbackRow.writeBlocked ? '<div class="wk-note">אין אפשרות לשייך משוב חדש לפי שם בלבד</div>' : '<div class="crm-actions"><button type="button" class="wk-btn ghost" data-go-sub="team" data-drawer-close>לסימון משוב ←</button></div>')
      : '<div class="wk-empty">אין נתוני משוב</div>';
    return '<div class="crm-card-sub">' + esc((s.role || '') + (s.onLeave ? ' · בחופשה' : '') + (sameName ? ' · זוהה לפי מזהה עובד או טלפון' : '')) + '</div>' +
      cardTabsHtml('employee', [
        { key: 'details', label: 'פרטים', html: details },
        { key: 'cost', label: 'עלות', html: cost },
        { key: 'talks', label: 'שיחות', html: talks + (sameName || (FD && FD.workerId(s)) ? '' : '<div class="crm-actions"><button type="button" class="wk-btn" data-emp-talk="' + esc(s.name) + '">💬 רישום שיחה חדשה</button></div>') },
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
  /* «עלות אוקטובר 2026 מול היעד» (16 Nov 2026: the REAL October cost).
   * ot = the server's octoberTarget for THIS house: { target }.
   * oct = the staffing feed's houseCost for October 2026: { available, total } — the same number
   * the staffing app shows. No October cost → the target alone, never an invented number. */
  function octoberTargetHtml(ot, oct) {
    if (!ot || !(Number(ot.target) > 0)) return '';
    var target = Number(ot.target);
    var has = !!(oct && oct.available && typeof oct.total === 'number' && isFinite(oct.total) && oct.total >= 0);
    var total = has ? Math.round(oct.total) : null;
    var gap = has ? total - target : 0;
    var gapText = gap > 0 ? 'חיסכון נדרש' : gap < 0 ? 'מתחת ליעד' : 'בדיוק ביעד';
    var pct = has && gap > 0 && total > 0 ? ' · ' + (Math.round((gap / total) * 1000) / 10) + '% מעלות אוקטובר' : '';
    return '<div class="card work-card wk-budget-october"><div class="card-title">עלות אוקטובר 2026 מול היעד החודשי</div>' +
      '<div class="budget-kpis">' +
        '<div class="budget-kpi"><b>' + esc(has ? ils(total) : '—') + '</b><span>עלות כוח אדם בפועל — אוקטובר 2026</span></div>' +
        '<div class="budget-kpi"><b>' + esc(ils(target)) + '</b><span>יעד תקציב חודשי — מנובמבר 2026</span></div>' +
        (has ? '<div class="budget-kpi ' + (gap > 0 ? 'bad' : 'ok') + '"><b>' + esc(ils(Math.abs(gap))) + '</b><span>' + esc(gapText + pct) + '</span></div>' : '') +
      '</div>' +
      '<div class="wk-note">' + esc(has
        ? 'אוקטובר לפי דוח השכר והחשבוניות, כולל פרילנסרים משותפים, בלי בונוסי מנהלים ורכזים. היעד לפי טבלת תוכנית הפעולה.'
        : 'עלות אוקטובר לא זמינה כרגע מאפליקציית כוח האדם. היעד לפי טבלת תוכנית הפעולה.') + '</div></div>';
  }
  /* «חיסכון צפוי מסיומי עבודה» (16 Nov 2026, Sandra: «לגבי עובד שמסיים, לחזות את קיזוז השכר העתידי שלו
   * מהיום שהוא מסיים»). The staffing app's forecast, as it came: staff.ending { count, monthlySaving,
   * savingThisMonth, savingNextMonth } and endDate per worker. Nothing is computed here; no `ending`
   * or nobody finishing → no card. */
  function endOf(w) { return w && ISO_RE.test(String(w.endDate || '')) ? String(w.endDate) : ''; }
  /* Who finishes, each with the end date (16 Nov 2026, later — Sandra: «כתוב 2 עובדים אבל יש רק שם של 1,
   * צריך גם נתון מתי הסיום»). staff.ending.people names EVERY counted person — a finishing freelancer
   * too, whose row in the workers table carries no date. Without that list (an older Dashboard): the
   * workers that carry an end date. → [{ name, endDate, monthlySaving | null }], soonest first. */
  function endingPeople(s) {
    var e = s && s.ending;
    var list = e && Array.isArray(e.people)
      ? e.people.filter(function (p) { return p && typeof p === 'object' && norm(p.name) && endOf(p); })
        .map(function (p) { return { name: norm(p.name), endDate: endOf(p), monthlySaving: Math.max(0, Math.round(Number(p.monthlySaving) || 0)) }; })
      : ((s && s.workers) || []).filter(function (w) { return w && w.name && endOf(w); })
        .map(function (w) { return { name: norm(w.name), endDate: endOf(w), monthlySaving: null }; });
    return list.sort(function (a, b) { return a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0; });
  }
  /* The end date of a row of the workers table: its own, else the list's entry of the same name. */
  function endOfRow(s, w) {
    if (endOf(w)) return endOf(w);
    var hit = w && w.name ? endingPeople(s).filter(function (p) { return p.name === norm(w.name); })[0] : null;
    return hit ? hit.endDate : '';
  }
  function nextMonth(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return '';
    var y = +m[1], mo = +m[2] + 1;
    if (mo > 12) { mo = 1; y += 1; }
    return y + '-' + (mo < 10 ? '0' + mo : mo);
  }
  function endingHtml(s) {
    var e = s && s.ending;
    var count = e ? Math.max(0, Math.round(Number(e.count) || 0)) : 0;
    if (!e || typeof e !== 'object' || !count) return '';
    var who = endingPeople(s);
    // Nobody is counted without a name: a number above the list is said in words, never left unexplained.
    var unnamed = Math.max(0, count - who.length);
    var known = {};
    (s.workers || []).forEach(function (w) { if (w && w.name) known[norm(w.name)] = w.name; });
    var next = nextMonth(s.month);
    return '<div class="card work-card wk-budget-ending" data-default-open><div class="card-title">חיסכון צפוי מסיומי עבודה — הערכה</div>' +
      '<div class="budget-kpis">' +
        '<div class="budget-kpi"><b>' + esc(count) + '</b><span>' + esc(count === 1 ? 'עובד/ת מסיים/ת' : 'עובדים מסיימים') + '</span></div>' +
        '<div class="budget-kpi"><b>' + esc(ils(e.savingThisMonth)) + '</b><span>' + esc('חיסכון ב' + monthHe(s.month)) + '</span></div>' +
        (next ? '<div class="budget-kpi"><b>' + esc(ils(e.savingNextMonth)) + '</b><span>' + esc('חיסכון ב' + monthHe(next)) + '</span></div>' : '') +
        '<div class="budget-kpi ok"><b>' + esc(ils(e.monthlySaving)) + '</b><span>חיסכון בחודש מלא</span></div>' +
      '</div>' +
      (who.length ? '<ul class="ending-list">' + who.map(function (p) {
        // The name opens the employee card only when the workers table has that name.
        return '<li>' + (known[p.name] ? '<button type="button" class="link-cell" data-emp-open="' + esc(known[p.name]) + '">' + esc(p.name) + '</button>'
          : '<b class="ending-name">' + esc(p.name) + '</b>') + '<span>' +
          esc('מסיים/ת ב-' + fmtDate(p.endDate) + (p.monthlySaving ? ' · חיסכון ' + ils(p.monthlySaving) + ' בחודש מלא' : '')) + '</span></li>';
      }).join('') + '</ul>' : '') +
      (unnamed ? '<div class="wk-note ending-unnamed">' + esc(unnamed === 1 ? 'לעובד/ת נוסף/ת אין שם ותאריך סיום ברשימה. הפרטים באפליקציית כוח האדם.'
        : 'ל-' + unnamed + ' עובדים נוספים אין שם ותאריך סיום ברשימה. הפרטים באפליקציית כוח האדם.') + '</div>' : '') +
      '<div class="wk-note">הערכה מאפליקציית כוח האדם. עלות החודש שלמעלה כבר מחושבת עד תאריך הסיום, ומהחודש שאחרי הסיום העלות של העובד/ת יורדת מהבית במלואה.</div></div>';
  }

  /* ── the per-worker SIMULATION (16 Nov 2026) ─────────────
   * Sandra: «ברשימת עובדים ועלות שכר ותקציב צריך לאפשר סימולציה ליד כל עובד עם
   * אפשרויות: סגירת העובד, שינוי שכר עם סכום. הנתון מהסימולציה צריך להופיע במקום
   * הנתון הקיים ולהשפיע על הסה"כ שרשום למטה. ככה המנהלים יראו איך לעשות שינויים».
   * A what-if in the browser's memory ONLY: nothing is saved, nothing is sent,
   * the staffing app is not touched. sim = { workerName: { kind: 'end' } |
   * { kind: 'cost', amount } | { kind: 'deduct', amount } } — for 'cost' the amount is the
   * worker's NEW monthly cost.
   * 'deduct' (17 Nov 2026, Sandra: «באופציית הסימולציה תעשה שאפשר לרשום סכום אחר וזה מוריד
   * ישירות מהעלות הכוללת ושאחר כך אפשר לנקות את השדה ולחזור אחורה»): the amount typed comes
   * straight off the total — it is not tied to the figure the list shows for the worker, so a
   * manager can take off what the worker really costs. An empty field takes nothing off. */
  var SIM_MAX = 1000000;
  function simOf(sim, name) {
    if (!sim || !name || !Object.prototype.hasOwnProperty.call(sim, name)) return null;
    var x = sim[name];
    if (!x || typeof x !== 'object') return null;
    if (x.kind === 'end') return { kind: 'end' };
    if (x.kind === 'cost') {
      var has = x.amount !== '' && x.amount != null && isFinite(Number(x.amount)) && Number(x.amount) >= 0;
      return { kind: 'cost', amount: has ? Math.min(SIM_MAX, Math.round(Number(x.amount))) : null };
    }
    if (x.kind === 'deduct') {
      var hasD = x.amount !== '' && x.amount != null && isFinite(Number(x.amount)) && Number(x.amount) >= 0;
      return { kind: 'deduct', amount: hasD ? Math.min(SIM_MAX, Math.round(Number(x.amount))) : null };
    }
    return null;
  }
  /* → { workers: [{ …w, simKind, simCost, simDelta, simAmount, simDeduct }], total, delta, active, count } */
  function simulateStaff(staff, sim) {
    var s = staff || {};
    var base = Math.max(0, Number(s.total) || 0);
    var delta = 0, count = 0;
    var workers = (s.workers || []).map(function (w) {
      var cost = Math.round(Number(w.cost) || 0);
      var x = simOf(sim, w.name);
      var simCost = cost, kind = '', typed = null;
      if (x && x.kind === 'end') { simCost = 0; kind = 'end'; }
      else if (x && x.kind === 'cost') { kind = 'cost'; if (x.amount !== null) { simCost = x.amount; typed = x.amount; } }
      // The amount comes off the total as typed; the worker's own figure is only what is left of it.
      var deduct = 0;
      if (x && x.kind === 'deduct') { kind = 'deduct'; if (x.amount !== null) { deduct = x.amount; typed = x.amount; simCost = Math.max(0, cost - deduct); } }
      if (kind) count++;
      delta += kind === 'deduct' ? -deduct : simCost - cost;
      var o = {};
      Object.keys(w).forEach(function (k) { o[k] = w[k]; });
      o.cost = cost; o.simKind = kind; o.simCost = simCost; o.simDelta = kind === 'deduct' ? -deduct : simCost - cost; o.simAmount = typed; o.simDeduct = deduct;
      return o;
    });
    return { workers: workers, base: base, total: Math.max(0, base + delta), delta: delta, active: count > 0, count: count };
  }
  function signedIls(n) {
    var v = Math.round(Number(n) || 0);
    return (v > 0 ? '+' : v < 0 ? '‎-' : '') + Math.abs(v).toLocaleString('en-US') + ' ₪';
  }
  function simCellHtml(w) {
    var name = esc(w.name);
    return '<div class="sim-cell"><select class="sim-kind" data-sim-kind="' + name + '" aria-label="' + esc('סימולציה — ' + w.name) + '">' +
      '<option value=""' + (w.simKind ? '' : ' selected') + '>ללא שינוי</option>' +
      '<option value="end"' + (w.simKind === 'end' ? ' selected' : '') + '>סיום העסקה</option>' +
      '<option value="cost"' + (w.simKind === 'cost' ? ' selected' : '') + '>שינוי שכר</option>' +
      '<option value="deduct"' + (w.simKind === 'deduct' ? ' selected' : '') + '>הפחתת סכום אחר</option></select>' +
      (w.simKind === 'cost' || w.simKind === 'deduct' ? '<input class="sim-amount" type="number" inputmode="numeric" min="0" max="' + SIM_MAX + '" step="100" data-sim-amount="' + name +
        '" value="' + (w.simAmount === null || w.simAmount === undefined ? '' : esc(w.simAmount)) + '" placeholder="' + (w.simKind === 'deduct' ? 'סכום להפחתה ₪' : 'עלות חודשית חדשה ₪') +
        '" aria-label="' + esc((w.simKind === 'deduct' ? 'סכום להפחתה מהעלות הכוללת — ' : 'עלות חודשית חדשה — ') + w.name) + '">' : '') +
      (w.simKind === 'deduct' ? '<span class="sim-hint">יורד ישירות מהסה״כ. שדה ריק מחזיר את הנתון.</span>' : '') +
      // «ניקוי» (17 Nov 2026, Sandra: «תעשה אפשרות לנקות שדות אחרי שעושים סימולציה»): this worker back to the real figure.
      (w.simKind ? '<button type="button" class="wk-link sim-clear" data-sim-clear="' + name + '" aria-label="' + esc('ניקוי הסימולציה — ' + w.name) + '">✕ ניקוי</button>' : '') + '</div>';
  }
  /* The whole simulation back to the real figures — shown wherever a simulation is on. */
  function simClearAllHtml(count) {
    return '<div class="sim-bar"><span class="sim-bar-text">🧪 ' + esc(count === 1 ? 'שינוי אחד בסימולציה' : count + ' שינויים בסימולציה') + '</span>' +
      '<button type="button" class="wk-btn ghost sim-clear-all" data-sim-reset>🧹 ניקוי כל השדות</button></div>';
  }

  /* st = { staff: houseStaffCost.staff | {loading}, nextStaff: next month's houseStaffCost.staff | null,
   *        quarter: budgetBonusQuarter() | null, octoberTarget, octoberCost, monthBonuses, sim, nowYM } */
  function budgetHtml(st) {
    var s = st && st.staff;
    var h = octoberTargetHtml(st && st.octoberTarget, st && st.octoberCost);
    if (!s || s.loading) return h +  '<div class="card work-card" data-default-open><div class="wk-empty">טוען את נתוני התקציב…</div></div>';
    var simNow = null, simNext = null;
    if (!s.available) {
      h += '<div class="card work-card wk-budget-sum" data-default-open><div class="card-title">תקציב כוח אדם</div><div class="wk-empty">' +
        esc(STAFF_REASON[s.reason] || 'לא הצלחנו לקרוא את נתוני כוח האדם. נסו שוב מאוחר יותר.') + '</div>' +
        '<div class="crm-actions"><button type="button" class="wk-btn ghost" data-budget-retry>נסו שוב</button></div></div>';
    } else {
      var next = st.nextStaff && st.nextStaff.available ? st.nextStaff : null;
      simNow = simulateStaff(s, st.sim);
      simNext = next ? simulateStaff(next, st.sim) : null;
      // A worker «ended» in the simulation who is not in next month's list changes nothing there —
      // simulateStaff(next) already handles it (the delta is taken from next month's own list).
      var total = Math.max(0, Number(s.total) || 0), budget = s.budget ? Math.max(0, Number(s.budget) || 0) : 0;
      var bst = budgetStatus(total, budget);
      var nextTotal = next ? Math.max(0, Number(next.total) || 0) : null;
      var nextBudget = next && next.budget ? Math.max(0, Number(next.budget) || 0) : 0;
      h += '<div class="card work-card wk-budget-sum" data-default-open><div class="card-title">תקציב כוח אדם — ' + esc(monthHe(s.month)) + '</div>' +
        '<div class="budget-kpis">' +
          '<div class="budget-kpi"><b>' + esc(ils(total)) + '</b><span>עלות החודש</span></div>' +
          '<div class="budget-kpi"><b>' + esc(budget ? ils(budget) : '—') + '</b><span>תקציב החודש</span></div>' +
          '<div class="budget-kpi ' + bst.cls + '"><b>' + esc(bst.pct === null ? '—' : bst.pct + '%') + '</b><span>' + esc(bst.text) + '</span></div>' +
          '<div class="budget-kpi"><b>' + esc(budget ? ils(Math.abs(budget - total)) : '—') + '</b><span>' + esc(budget && total > budget ? 'חריגה' : 'נשאר') + '</span></div>' +
          (nextTotal !== null ? '<div class="budget-kpi ' + budgetStatus(nextTotal, nextBudget).cls + '"><b>' + esc(ils(nextTotal)) + '</b><span>' +
            esc('צפי ' + monthHe(next.month) + (s.ending && Number(s.ending.count) > 0 ? ' · אחרי סיומי העבודה' : '')) + '</span></div>' : '') +
        '</div>' + barHtml(total, budget) +
        '<div class="wk-note">' + esc(s.hasActuals ? 'חלק מהעלות כבר לפי דוח השכר, והשאר הערכה.' : 'עדיין אין דוח שכר לחודש הזה — הסכומים הם הערכה.') +
        (s.stale ? ' (הנתון לא התעדכן לאחרונה)' : '') + '</div></div>';
      // «חיסכון צפוי מסיומי עבודה» — the staffing app's forecast, shown only when someone finishes.
      h += endingHtml(s);

      // The simulation result — only while something is simulated.
      if (simNow.active) {
        var sst = budgetStatus(simNow.total, budget);
        var nst = simNext ? budgetStatus(simNext.total, nextBudget) : null;
        h += '<div class="card work-card wk-budget-sim" data-default-open><div class="card-title">🧪 סימולציה — ' + esc(simNow.count === 1 ? 'שינוי אחד' : simNow.count + ' שינויים') + '</div>' +
          '<div class="wk-note">בדיקת «מה אם» בלבד: שום דבר לא נשמר, ושום דבר לא משתנה באפליקציית כוח האדם. הסכום הוא לחודש מלא.</div>' +
          '<div class="budget-kpis">' +
            '<div class="budget-kpi"><b>' + esc(ils(simNow.total)) + '</b><span>עלות חודשית בסימולציה</span></div>' +
            '<div class="budget-kpi ' + (simNow.delta < 0 ? 'ok' : simNow.delta > 0 ? 'bad' : '') + '"><b>' + esc(signedIls(simNow.delta)) + '</b><span>' + esc(simNow.delta < 0 ? 'חיסכון לחודש' : simNow.delta > 0 ? 'תוספת לחודש' : 'ללא שינוי בעלות') + '</span></div>' +
            '<div class="budget-kpi ' + sst.cls + '"><b>' + esc(sst.pct === null ? '—' : sst.pct + '%') + '</b><span>' + esc(sst.pct === null ? sst.text : sst.text + ' — מול תקציב ' + ils(budget)) + '</span></div>' +
            '<div class="budget-kpi"><b>' + esc(budget ? ils(Math.abs(budget - simNow.total)) : '—') + '</b><span>' + esc(budget && simNow.total > budget ? 'עדיין חריגה' : 'נשאר') + '</span></div>' +
            (simNext ? '<div class="budget-kpi ' + nst.cls + '"><b>' + esc(ils(simNext.total)) + '</b><span>' + esc(monthHe(next.month) + ' בסימולציה' + (nst.pct === null ? '' : ' · ' + nst.pct + '% · ' + nst.text)) + '</span></div>' : '') +
          '</div>' + barHtml(simNow.total, budget) +
          '<div class="crm-actions"><button type="button" class="wk-btn ghost sim-clear-all" data-sim-reset>🧹 ניקוי כל השדות</button></div></div>';
      }

      var workers = simNow.workers;
      var simTotal = simNow.total;
      h += '<div class="card work-card wk-budget-workers" data-default-open><div class="card-title">העובדים ועלות השכר (' + workers.filter(function (w) { return w.name; }).length + ')</div>' +
        '<div class="wk-note">רשימה מעודכנת מאפליקציית כוח האדם. נראית רק לך, לסנדרה ולרון. <b>סימולציה:</b> בחרו ליד עובד/ת «סיום העסקה», «שינוי שכר» ואז עלות חודשית חדשה, או «הפחתת סכום אחר» ואז הסכום שיורד ישירות מהסה״כ. הסה״כ למטה מתעדכן. לא נשמר. «✕ ניקוי» ליד עובד/ת מחזיר את הנתון שלו/ה, ו«ניקוי כל השדות» מנקה את כל הסימולציה.</div>' +
        // While a simulation is on: «ניקוי כל השדות» above the table and under it — one tap, from wherever you are.
        (workers.length && simNow.active ? simClearAllHtml(simNow.count) : '') +
        (workers.length ? '<div class="tbl-wrap"><table class="crm-tbl sim-tbl stack-tbl"><thead><tr><th>עובד/ת</th><th>תפקיד</th><th>עלות החודש</th>' +
          (next ? '<th>' + esc('צפי ' + monthHe(next.month)) + '</th>' : '') + '<th>% מהבית</th><th>מקור</th><th>סימולציה</th></tr></thead><tbody>' +
          workers.map(function (w) {
            var pct = simTotal ? Math.round((w.simCost / simTotal) * 100) : 0;
            var end = endOfRow(s, w);
            var nw = next && w.name ? (simNext.workers.filter(function (x) { return norm(x.name) === norm(w.name); })[0] || null) : null;
            // «הפחתת סכום אחר»: the worker's figure stays, and the amount that comes off the total is beside it.
            var costCell = w.simKind === 'deduct' ? esc(ils(w.cost)) + (w.simDeduct ? ' <b class="sim-new sim-deduct">' + esc(signedIls(-w.simDeduct)) + '</b>' : '')
              : w.simKind && w.simCost !== w.cost
              ? '<s class="sim-old">' + esc(ils(w.cost)) + '</s> <b class="sim-new">' + esc(ils(w.simCost)) + '</b>'
              : esc(ils(w.cost));
            var nextCell = !next ? '' : td('צפי ' + monthHe(next.month), !w.name ? '—' : nw
              ? (nw.simKind === 'deduct' ? esc(ils(nw.cost)) + (nw.simDeduct ? ' <b class="sim-new sim-deduct">' + esc(signedIls(-nw.simDeduct)) + '</b>' : '')
                : nw.simKind && nw.simCost !== nw.cost ? '<s class="sim-old">' + esc(ils(nw.cost)) + '</s> <b class="sim-new">' + esc(ils(nw.simCost)) + '</b>' : esc(ils(nw.cost)))
              : esc(ils(0)));
            return '<tr class="' + (w.name ? '' : 'muted') + (w.simKind ? ' is-sim' : '') + '">' + td('עובד/ת',
              (w.name ? '<button type="button" class="link-cell" data-emp-open="' + esc(w.name) + '">' + esc(w.name) + '</button>' : 'אחר (ללא שם)') +
              (end ? ' ' + chip('warn', 'מסיים/ת ' + fmtDate(end)) : '') + (w.simKind === 'end' ? ' ' + chip('bad', 'סימולציה: סיום') : w.simKind === 'cost' ? ' ' + chip('open', 'סימולציה: שכר') : w.simKind === 'deduct' ? ' ' + chip('open', 'סימולציה: הפחתה') : '')) +
              td('תפקיד', esc((w.roles || []).join(', ') || '—')) + td('עלות החודש', costCell) + nextCell + td('% מהבית', esc(pct + '%')) +
              td('מקור', w.estimated ? chip('wait', 'הערכה') : chip('ok', 'דוח שכר')) +
              (w.name ? td('סימולציה', simCellHtml(w)) : '<td></td>') + '</tr>';
          }).join('') + '</tbody><tfoot><tr>' + td('', 'סה״כ' + (simNow.active ? ' בסימולציה' : '')) + '<td></td>' + td('עלות החודש',
          (simNow.active && simNow.delta ? '<s class="sim-old">' + esc(ils(total)) + '</s> <b class="sim-new">' + esc(ils(simTotal)) + '</b>' : esc(ils(total)))) +
          (next ? td('צפי ' + monthHe(next.month), simNow.active && simNext.delta ? '<s class="sim-old">' + esc(ils(nextTotal)) + '</s> <b class="sim-new">' + esc(ils(simNext.total)) + '</b>' : esc(ils(nextTotal))) : '') +
          td('% מהבית', '100%') + '<td></td>' + (simNow.active ? td('שינוי', esc(signedIls(simNow.delta))) : '<td></td>') + '</tr></tfoot></table></div>' +
          (simNow.active ? simClearAllHtml(simNow.count) : '')
          : '<div class="wk-empty">אין עובדים עם עלות בחודש הזה</div>') + '</div>';

      var lines = (s.budgetLines || []).filter(function (l) { return l && (l.budget || l.cost); });
      if (lines.length) {
        h += '<div class="card work-card wk-budget-lines"><div class="card-title">לפי סעיף תקציב</div><div class="tbl-wrap"><table class="crm-tbl stack-tbl"><thead><tr><th>סעיף</th><th>תקציב</th><th>עלות</th><th>הפרש</th></tr></thead><tbody>' +
          lines.map(function (l) {
            var has = l.budget !== null && l.budget !== undefined;
            var diff = has ? l.budget - l.cost : null;
            return '<tr>' + td('סעיף', esc(l.label || l.key)) + td('תקציב', esc(has ? ils(l.budget) : '—')) + td('עלות', esc(ils(l.cost))) +
              td('הפרש', esc(diff === null ? '—' : ils(diff)), diff === null ? '' : diff < 0 ? 'neg' : 'pos') + '</tr>';
          }).join('') + '</tbody></table></div></div>';
      }
    }
    if (st.quarter) {
      h += quarterHtml(st.quarter, simNow && simNow.active ? {
        nowYM: st.nowYM || (s && s.month) || '', delta: simNow.delta,
        nextYM: simNext ? st.nextStaff.month : '', nextDelta: simNext ? simNext.delta : simNow.delta
      } : null);
    }
    (st.monthBonuses || []).forEach(function (mb) { h += monthBonusCardHtml(mb); });
    return h;
  }
  /* simq (only while a simulation is on) = { nowYM, delta, nextYM, nextDelta }: the running month
   * and the months after it get a «בסימולציה» column — a full-month what-if, never a settled month. */
  function quarterHtml(q, simq) {
    if (!q || !q.quarter) return '';
    var rows = q.months.map(function (m) {
      var stt = m.available ? budgetStatus(m.cost, m.budget) : null;
      var simCell = '';
      if (simq) {
        var live = simq.nowYM && m.ym >= simq.nowYM && m.available;
        var sc = live ? Math.max(0, m.cost + (m.ym === simq.nowYM ? simq.delta : simq.nextDelta)) : null;
        var sstt = sc === null ? null : budgetStatus(sc, m.budget);
        simCell = td('בסימולציה', sc === null ? '—' : '<b class="sim-new">' + esc(ils(sc)) + '</b>' + (sstt.pct !== null ? ' ' + chip(sstt.cls, sstt.pct + '%') : ''));
      }
      return '<tr>' + td('חודש', esc(monthHe(m.ym))) + td('תקציב', esc(m.budget ? ils(m.budget) : '—')) +
        td('עלות', esc(m.available ? ils(m.cost) : m.future ? 'עוד לא' : 'לא זמין')) + td('ניצול', stt && stt.pct !== null ? chip(stt.cls, stt.pct + '%') : '—') + simCell + '</tr>';
    }).join('');
    return '<div class="card work-card wk-budget-quarter"><div class="card-title">' + esc(q.quarter.label) + ' — מבט רבעוני</div>' +
      '<div class="wk-note">חודש שהסתיים — לפי דוח השכר. החודש הנוכחי והבאים — הערכה של אפליקציית כוח האדם, שכבר מורידה עובדים עם תאריך סיום.' +
      (simq ? ' העמודה «בסימולציה» מראה חודש מלא עם השינויים שסימנת.' : '') + '</div>' +
      '<div class="tbl-wrap"><table class="crm-tbl stack-tbl"><thead><tr><th>חודש</th><th>תקציב</th><th>עלות</th><th>ניצול</th>' + (simq ? '<th>בסימולציה</th>' : '') + '</tr></thead><tbody>' + rows +
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
    TALK_OUTCOMES: TALK_OUTCOMES, STAFF_REASON: STAFF_REASON,
    therapistsOf: therapistsOf, sessionsOf: sessionsOf, nextCommitteeOf: nextCommitteeOf,
    patientRowExtras: patientRowExtras, patientCardHtml: patientCardHtml, cardTabsHtml: cardTabsHtml,
    talkThreads: talkThreads, talksListHtml: talksListHtml,
    contactOf: contactOf, familyCallsOf: familyCallsOf, familyContactsHtml: familyContactsHtml,
    familyCallsListHtml: familyCallsListHtml, familyFilterHtml: familyFilterHtml,
    employeeCardHtml: employeeCardHtml, budgetStatus: budgetStatus, budgetHtml: budgetHtml, octoberTargetHtml: octoberTargetHtml, quarterHtml: quarterHtml,
    endingHtml: endingHtml, endingPeople: endingPeople, simulateStaff: simulateStaff, SIM_MAX: SIM_MAX,
    budgetBonusHtml: budgetBonusHtml, monthBonusCardHtml: monthBonusCardHtml
  };
  root.CrmView = CrmView;
  if (typeof module === 'object' && module.exports) module.exports = CrmView;
}(typeof self !== 'undefined' ? self : this));
