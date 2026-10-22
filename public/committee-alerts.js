/* Committee alerts — «ועדה היום» / «ועדה השבוע» (15 Oct 2026; READ-ONLY from 20 Oct 2026).
 *
 * Since 20 Oct 2026 the COORDINATORS set committees in their app; houseData
 * carries this house's upcoming ones as `committees: { available, today, items:
 * [{ id, date, time, type, participants, patientName }] }` (or { available:false,
 * reason }) — docs/committee.md. Computed in the browser from that payload; no
 * extra endpoint, no editing. The server scopes houseData to the manager's own
 * house; an admin loads each house and filters here.
 *
 * THE RULE — shared with the E-Zone-Dashboard card «ועדות קרובות» (its copy in
 * lib/committee-alerts.js). Both repos run the identical fixture
 * test/fixtures/committee-alert-cases.json (sha256 pinned on both sides):
 *   - committee date = today                        → «ועדה היום» (red, top);
 *   - today+1 .. today+COMMITTEE_LEAD_DAYS (7, incl.) → «ועדה השבוע» (amber);
 *   - more than 7 days ahead, or already passed     → nothing (past dates are
 *     never alerted).
 * "Today" is the calendar day in Asia/Jerusalem, whatever the device clock.
 *
 * ALERT vs WEEK (22 Oct 2026, docs/committee.md): the card lists every committee
 * of the shared 7-day window, but only today .. today+ALERT_DAYS (2) are ALERTS
 * («ועדה היום» red, «ועדה מחר» / «ועדה בעוד יומיים» amber) and count on the badge —
 * the same lead time the coordinators get. today+3 .. +7 sit under «בהמשך השבוע».
 * A CANCELLED committee (status from the coordinators feed) never appears here.
 *
 * Rendering is TEXT-ONLY: DOM nodes + textContent, never innerHTML with data.
 * Nothing here logs. Display-only — no bonus code reads it. In-app only. */
(function (root) {
  'use strict';

  var COMMITTEE_LEAD_DAYS = 7;
  var ALERT_DAYS = 2;
  var ALERT_TEXT = ['ועדה היום', 'ועדה מחר', 'ועדה בעוד יומיים'];
  var TIME_ZONE = 'Asia/Jerusalem';
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ── shared core (identical behaviour in E-Zone-Dashboard) ── */
  function isRealIso(s) {
    if (!ISO_RE.test(String(s || ''))) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  /* 'yyyy-MM-dd' of `now` (Date | ms; default: the current time) in Israel. */
  function israelToday(now) {
    var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    var get = function (t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value; return ''; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (parseInt(m[3], 10) + '/' + parseInt(m[2], 10) + '/' + m[1].slice(2)) : '';
  }

  function whenText(days) {
    if (days === 0) return 'היום';
    if (days === 1) return 'מחר';
    return 'בעוד ' + days + ' ימים';
  }

  /* The alert of one committee date, or null: { days, kind: 'today' | 'week', whenText }. */
  function classify(date, today) {
    if (!isRealIso(date) || !isRealIso(today)) return null;
    var days = dayDiff(today, date);
    if (days < 0 || days > COMMITTEE_LEAD_DAYS) return null;
    return { days: days, kind: days === 0 ? 'today' : 'week', whenText: whenText(days) };
  }

  function byDateThenName(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  /* ── Managers view model ── */

  var UNAVAILABLE = {
    missing: 'הוועדות יופיעו אחרי עדכון השרת',
    not_configured: 'הוועדות מאפליקציית הרכזים עוד לא מחוברות',
    coordinators_not_configured: 'הוועדות מאפליקציית הרכזים עוד לא מחוברות',
    unauthorized: 'הוועדות מאפליקציית הרכזים עוד לא מחוברות'
  };
  var UNREADABLE = 'לא הצלחנו לקרוא את הוועדות מאפליקציית הרכזים';
  function str(v) { return String(v == null ? '' : v); }

  /* ONE house's payload → { house, supported, unavailableText, alerts, count, weekCount }; alerts
   * (the whole 7-day window) sorted by date, then name. Each alert: { house, id, name, date, dateText,
   * label, days, kind, whenText, urgent, tag }: name = the patient, else the committee type; label =
   * the type (with a patient) and the time; urgent = within ALERT_DAYS. count = the URGENT ones (the
   * badge); weekCount = all of them. A cancelled committee is skipped. */
  function houseAlerts(data, house, today) {
    var d = data || {};
    var cm = d.committees;
    var out = { house: String(house || d.house || ''), supported: !!(cm && cm.available === true && Array.isArray(cm.items)), unavailableText: '', alerts: [], count: 0 };
    if (!out.supported) {
      out.unavailableText = !cm ? UNAVAILABLE.missing : (UNAVAILABLE[cm.reason] || UNREADABLE);
      return out;
    }
    var t = isRealIso(today) ? today : israelToday();
    cm.items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      if (str(it.status) === 'cancelled') return;
      var c = classify(it.date, t);
      if (!c) return;
      var pat = str(it.patientName).trim(), type = str(it.type).trim(), time = /^\d{2}:\d{2}$/.test(str(it.time)) ? str(it.time) : '';
      out.alerts.push({
        house: out.house, id: str(it.id), name: pat || type || 'ועדה',
        date: it.date, dateText: fmtDate(it.date), label: [pat ? type : '', time].filter(Boolean).join(' · '),
        days: c.days, kind: c.kind, whenText: c.whenText,
        urgent: c.days <= ALERT_DAYS, tag: c.days <= ALERT_DAYS ? ALERT_TEXT[c.days] : 'ועדה השבוע'
      });
    });
    out.alerts.sort(byDateThenName);
    out.count = urgentCount(out.alerts);
    out.weekCount = out.alerts.length;
    return out;
  }
  function urgentCount(list) { return list.filter(function (a) { return a.urgent; }).length; }

  /* Admin: several houses merged; `filter` = a house key or '' (all). */
  function mergeAlerts(list, filter) {
    var out = { alerts: [], count: 0, supported: false, unavailableText: '' };
    (list || []).forEach(function (h) {
      if (!h || (filter && h.house !== filter)) return;
      if (h.supported) out.supported = true;
      else if (!out.unavailableText) out.unavailableText = h.unavailableText || '';
      out.alerts = out.alerts.concat(h.alerts);
    });
    out.alerts.sort(byDateThenName);
    out.count = urgentCount(out.alerts);
    out.weekCount = out.alerts.length;
    return out;
  }

  /* ── text-only DOM ── */
  function node(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }

  function alertRow(doc, a, labels) {
    var li = node(doc, 'li', 'cm-alert ' + (a.kind === 'today' ? 'is-today' : (a.urgent ? 'is-soon' : 'is-week')));
    var main = node(doc, 'div', 'cm-alert-main');
    main.appendChild(node(doc, 'span', 'cm-alert-name', a.name));
    if (labels) main.appendChild(node(doc, 'span', 'cm-alert-house', labels[a.house] || a.house));
    main.appendChild(node(doc, 'span', 'cm-alert-tag', a.tag || (a.kind === 'today' ? 'ועדה היום' : 'ועדה השבוע')));
    li.appendChild(main);
    li.appendChild(node(doc, 'div', 'cm-alert-meta', 'ועדה: ' + a.dateText + (a.label ? ' · ' + a.label : '') + ' · ' + a.whenText));
    var btn = node(doc, 'button', 'cm-alert-btn', 'לוועדות');
    btn.type = 'button';
    btn.setAttribute('data-cm-alert-open', a.house);
    btn.setAttribute('aria-label', 'לכל הוועדות של הבית');
    li.appendChild(btn);
    return li;
  }

  /* The card for `model` (houseAlerts / mergeAlerts). opts:
   *   title  — default «ועדות קרובות»
   *   labels — { houseKey: 'שם הבית' } → each alert names its house (admin)
   *   filter — { value, options: [{ value, label }] } → a house <select> (admin) */
  function renderCard(doc, model, opts) {
    opts = opts || {};
    var card = node(doc, 'div', 'card dash-card cm-alerts');
    card.setAttribute('data-cm-alerts', '');
    var head = node(doc, 'div', 'cm-alerts-head');
    head.appendChild(node(doc, 'div', 'card-title', (opts.title || 'ועדות קרובות') + (model.count ? ' (' + model.count + ')' : '')));
    if (opts.filter) {
      var lab = node(doc, 'label', 'cm-alerts-filter');
      lab.appendChild(node(doc, 'span', '', 'בית'));
      var sel = doc.createElement('select');
      sel.setAttribute('data-cm-filter', '');
      sel.setAttribute('aria-label', 'סינון ועדות לפי בית');
      opts.filter.options.forEach(function (o) {
        var op = node(doc, 'option', '', o.label);
        op.value = o.value;
        if (o.value === opts.filter.value) op.selected = true;
        sel.appendChild(op);
      });
      lab.appendChild(sel);
      head.appendChild(lab);
    }
    card.appendChild(head);
    if (!model.supported) {
      card.appendChild(node(doc, 'div', 'wk-empty', model.unavailableText || UNAVAILABLE.missing));
      return card;
    }
    if (!model.alerts.length) {
      card.appendChild(node(doc, 'div', 'wk-empty', 'אין ועדות היום וב-' + COMMITTEE_LEAD_DAYS + ' הימים הקרובים'));
      return card;
    }
    var urgent = model.alerts.filter(function (a) { return a.urgent; });
    var later = model.alerts.filter(function (a) { return !a.urgent; });
    if (!urgent.length) card.appendChild(node(doc, 'div', 'wk-empty', 'אין ועדות היום וביומיים הקרובים'));
    else {
      var ul = node(doc, 'ul', 'cm-alert-list');
      urgent.forEach(function (a) { ul.appendChild(alertRow(doc, a, opts.labels)); });
      card.appendChild(ul);
    }
    if (later.length) {
      var h = node(doc, 'div', 'cm-week-head', 'בהמשך השבוע (' + later.length + ')');
      h.setAttribute('data-cm-week', '');
      card.appendChild(h);
      var ul2 = node(doc, 'ul', 'cm-alert-list cm-week-list');
      later.forEach(function (a) { ul2.appendChild(alertRow(doc, a, opts.labels)); });
      card.appendChild(ul2);
    }
    return card;
  }

  /* The committee badge on the «ראשי» sub-tab (beside the discharge badge). */
  function setBadge(doc, button, count) {
    if (!button) return;
    var b = button.querySelector('[data-cm-badge]');
    if (!b) {
      b = node(doc, 'span', 'subtab-badge cm-badge');
      b.setAttribute('data-cm-badge', '');
      button.appendChild(b);
    }
    b.textContent = count > 0 ? String(count) : '';
    b.hidden = !(count > 0);
    if (count > 0) b.setAttribute('aria-label', count === 1 ? 'ועדה קרובה אחת' : count + ' ועדות קרובות');
    else b.removeAttribute('aria-label');
  }

  var CommitteeAlerts = {
    COMMITTEE_LEAD_DAYS: COMMITTEE_LEAD_DAYS, ALERT_DAYS: ALERT_DAYS, ALERT_TEXT: ALERT_TEXT, TIME_ZONE: TIME_ZONE,
    isRealIso: isRealIso, israelToday: israelToday, dayDiff: dayDiff, fmtDate: fmtDate, whenText: whenText, classify: classify,
    houseAlerts: houseAlerts, mergeAlerts: mergeAlerts, renderCard: renderCard, setBadge: setBadge, UNAVAILABLE: UNAVAILABLE
  };
  root.CommitteeAlerts = CommitteeAlerts;
  if (typeof module === 'object' && module.exports) module.exports = CommitteeAlerts;
}(typeof self !== 'undefined' ? self : this));
