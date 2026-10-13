/* Personal-code login (13 Oct 2026). The server decides everything (who you
 * are, which house you may see); this file only shows the login screen, asks
 * /api/me who is logged in, and offers "יציאה". */
(function (root) {
  'use strict';
  var current = null;

  function el(id) { return document.getElementById(id); }

  function showLogin(message) {
    var ov = el('loginOverlay');
    if (!ov) return;
    ov.hidden = false;
    document.body.classList.add('is-locked');
    var msg = el('loginMsg');
    if (msg) msg.textContent = message || '';
    var input = el('loginCode');
    if (input) setTimeout(function () { input.focus(); }, 50);
  }

  function hideLogin() {
    var ov = el('loginOverlay');
    if (ov) ov.hidden = true;
    document.body.classList.remove('is-locked');
  }

  function showUser(u) {
    var chip = el('userChip');
    if (!chip) return;
    el('userName').textContent = u.name + (u.role === 'admin' ? ' · כל הבתים' : '');
    chip.hidden = false;
  }

  function wire() {
    var form = el('loginForm');
    if (form && !form.getAttribute('data-wired')) {
      form.setAttribute('data-wired', '1');
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var code = String(el('loginCode').value || '').replace(/\D/g, '');
        var btn = form.querySelector('button');
        btn.disabled = true;
        el('loginMsg').textContent = 'בודק…';
        try {
          var r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) });
          var d = {};
          try { d = await r.json(); } catch (e) { d = {}; }
          if (r.ok) { root.location.reload(); return; }
          el('loginMsg').textContent = r.status === 503 ? 'הכניסה עוד לא הוגדרה. פנו לסנדרה.' : (d.error || 'קוד שגוי');
        } catch (e) {
          el('loginMsg').textContent = 'אין חיבור. נסו שוב.';
        }
        btn.disabled = false;
      });
    }
    var out = el('logoutBtn');
    if (out && !out.getAttribute('data-wired')) {
      out.setAttribute('data-wired', '1');
      out.addEventListener('click', async function () {
        try { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* offline */ }
        root.location.reload();
      });
    }
  }

  /* Resolves with the logged-in user, or never (the login screen stays up). */
  function init() {
    wire();
    return new Promise(function (resolve) {
      fetch('/api/me', { headers: { Accept: 'application/json' } }).then(function (r) {
        if (!r.ok) { showLogin(''); return null; }
        return r.json();
      }).then(function (d) {
        if (!d || !d.user) return;
        current = d.user;
        hideLogin();
        showUser(current);
        resolve(current);
      }).catch(function () { showLogin('אין חיבור. נסו לרענן.'); });
    });
  }

  root.Auth = { init: init, showLogin: showLogin, user: function () { return current; } };
}(typeof self !== 'undefined' ? self : this));
