/* Discharge alerts — «שחרור קרוב» (15 Oct 2026, Task E).
 *
 * Driven ONLY by the manager's own expected discharge date (set manually on
 * «מטופלים בבית», docs/expected-discharge.md). CEO decision: no auto-fill.
 * Computed in the browser from the existing houseData payload — no new
 * endpoint, no new secret. The server already scopes houseData to the
 * manager's own house; an admin loads each house and filters here.
 *
 * For each patient currently in the house (houseData.patients):
 *   - expected date within the next ALERT_LEAD_DAYS days (0..14 inclusive)
 *     → a «שחרור קרוב» alert: name, date, «היום» / «מחר» / «בעוד N ימים»;
 *   - expected date already passed (still in the house)
 *     → a red «דורש עדכון» alert: «התאריך עבר לפני N ימים»;
 *   - no date → counted in ONE quiet summary line, never one alert each;
 *   - «אין צפי לשחרור» (expectedDischarge.none, 15 Oct 2026) → no alert and
 *     NOT counted as no-date (dischargeState — shared with the Dashboard).
 * "Today" is the calendar day in Asia/Jerusalem, whatever the device clock's
 * timezone. A discharged patient is no longer in houseData.patients, so their
 * alert disappears on the next load.
 *
 * Rendering is TEXT-ONLY: DOM nodes + textContent, never innerHTML with
 * data. Nothing here logs. Display-only — no bonus code reads it. */
(function (root) {
  'use strict';

  var ALERT_LEAD_DAYS = 14;
  var TIME_ZONE = 'Asia/Jerusalem';
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  /* Whole calendar days from ISO date a to ISO date b. */
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
    if (days > 1) return 'בעוד ' + days + ' ימים';
    if (days === -1) return 'התאריך עבר אתמול';
    return 'התאריך עבר לפני ' + (-days) + ' ימים';
  }

  function noDateText(n) {
    return n === 1 ? 'מטופל/ת אחד/ת ללא תאריך שחרור משוער' : n + ' מטופלים ללא תאריך שחרור משוער';
  }

  /* The state of one patient's expectedDischarge value (shared rule, the
   * fixture's `states`): 'none' — «אין צפי לשחרור», never an alert or a
   * no-date; 'date' — a real date; 'noDate' — nothing (null, cleared, bad). */
  function dischargeState(ed) {
    if (ed && typeof ed === 'object' && ed.none === true) return 'none';
    return ed && typeof ed === 'object' && isRealIso(ed.date) ? 'date' : 'noDate';
  }

  /* The alerts of ONE house's payload: { house, supported, alerts, noDate, noExpected, count }.
   * alerts are sorted by date (overdue first, being earliest), then by name. */
  function houseAlerts(data, house, today) {
    var d = data || {};
    var out = { house: String(house || d.house || ''), supported: d.expectedDischargeSupported === true, alerts: [], noDate: 0, noExpected: 0, count: 0 };
    if (!out.supported) return out;
    var t = isRealIso(today) ? today : israelToday();
    (Array.isArray(d.patients) ? d.patients : []).forEach(function (p, i) {
      if (!p || typeof p !== 'object') return;
      var st = dischargeState(p.expectedDischarge);
      if (st === 'none') { out.noExpected++; return; }
      if (st === 'noDate') { out.noDate++; return; }
      var date = p.expectedDischarge.date;
      var days = dayDiff(t, date);
      if (days > ALERT_LEAD_DAYS) return;
      out.alerts.push({
        house: out.house, index: i, name: String(p.name == null ? '' : p.name),
        date: date, dateText: fmtDate(date), days: days,
        kind: days < 0 ? 'overdue' : 'soon', whenText: whenText(days)
      });
    });
    out.alerts.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    out.count = out.alerts.length;
    return out;
  }

  /* Admin: several houses' alerts merged; `filter` = a house key or '' (all). */
  function mergeAlerts(list, filter) {
    var out = { alerts: [], noDate: 0, count: 0, supported: false, noDateHouses: [] };
    (list || []).forEach(function (h) {
      if (!h || (filter && h.house !== filter)) return;
      if (h.supported) out.supported = true;
      out.alerts = out.alerts.concat(h.alerts);
      out.noDate += h.noDate;
      if (h.noDate) out.noDateHouses.push(h.house);
    });
    out.alerts.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    out.count = out.alerts.length;
    return out;
  }

  /* ── text-only DOM ─────────────────────────────────────── */
  function node(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }

  /* The alert card for `model` (houseAlerts / mergeAlerts). opts:
   *   title     — card title (default «שחרור קרוב»)
   *   labels    — { houseKey: 'שם הבית' } → each alert shows its house (admin)
   *   filter    — { value, options: [{ value, label }] } → a house <select> (admin)
   *   listHouse — house key for the «ללא תאריך» button (single house) */
  function renderCard(doc, model, opts) {
    opts = opts || {};
    var card = node(doc, 'div', 'card dash-card dis-alerts');
    card.setAttribute('data-dis-alerts', '');
    var head = node(doc, 'div', 'dis-alerts-head');
    var title = node(doc, 'div', 'card-title', (opts.title || 'שחרור קרוב') + (model.count ? ' (' + model.count + ')' : ''));
    head.appendChild(title);
    if (opts.filter) {
      var lab = node(doc, 'label', 'dis-alerts-filter');
      lab.appendChild(node(doc, 'span', '', 'בית'));
      var sel = doc.createElement('select');
      sel.setAttribute('data-alert-filter', '');
      sel.setAttribute('aria-label', 'סינון לפי בית');
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
      card.appendChild(node(doc, 'div', 'wk-empty', 'ההתראות יופיעו אחרי עדכון השרת'));
      return card;
    }
    if (!model.alerts.length) {
      card.appendChild(node(doc, 'div', 'wk-empty', 'אין שחרורים משוערים ב-' + ALERT_LEAD_DAYS + ' הימים הקרובים'));
    } else {
      var ul = node(doc, 'ul', 'dis-alert-list');
      model.alerts.forEach(function (a) {
        var li = node(doc, 'li', 'dis-alert ' + (a.kind === 'overdue' ? 'is-overdue' : 'is-soon'));
        var main = node(doc, 'div', 'dis-alert-main');
        main.appendChild(node(doc, 'span', 'dis-alert-name', a.name));
        if (opts.labels) main.appendChild(node(doc, 'span', 'dis-alert-house', opts.labels[a.house] || a.house));
        main.appendChild(node(doc, 'span', 'dis-alert-tag', a.kind === 'overdue' ? 'דורש עדכון' : 'שחרור קרוב'));
        li.appendChild(main);
        li.appendChild(node(doc, 'div', 'dis-alert-meta', 'שחרור משוער: ' + a.dateText + ' · ' + a.whenText));
        var btn = node(doc, 'button', 'dis-alert-btn', 'שינוי תאריך');
        btn.type = 'button';
        btn.setAttribute('data-alert-edit', a.house + '|' + a.index);
        btn.setAttribute('aria-label', 'שינוי תאריך השחרור — ' + a.name);
        li.appendChild(btn);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    if (model.noDate > 0) {
      var nd = node(doc, 'button', 'dis-nodate', noDateText(model.noDate));
      nd.type = 'button';
      nd.setAttribute('data-alert-list', opts.listHouse || (model.noDateHouses && model.noDateHouses[0]) || '');
      card.appendChild(nd);
    }
    return card;
  }

  /* The badge on the «ראשי» sub-tab: count, or hidden when 0. */
  function setBadge(doc, button, count) {
    if (!button) return;
    var b = button.querySelector('[data-alert-badge]');
    if (!b) {
      b = node(doc, 'span', 'subtab-badge');
      b.setAttribute('data-alert-badge', '');
      button.appendChild(b);
    }
    b.textContent = count > 0 ? String(count) : '';
    b.hidden = !(count > 0);
    if (count > 0) b.setAttribute('aria-label', count === 1 ? 'התראת שחרור אחת' : count + ' התראות שחרור');
    else b.removeAttribute('aria-label');
  }

  var DischargeAlerts = {
    ALERT_LEAD_DAYS: ALERT_LEAD_DAYS, TIME_ZONE: TIME_ZONE,
    israelToday: israelToday, dayDiff: dayDiff, whenText: whenText, noDateText: noDateText, dischargeState: dischargeState,
    houseAlerts: houseAlerts, mergeAlerts: mergeAlerts, renderCard: renderCard, setBadge: setBadge
  };
  root.DischargeAlerts = DischargeAlerts;
  if (typeof module === 'object' && module.exports) module.exports = DischargeAlerts;
}(typeof self !== 'undefined' ? self : this));
