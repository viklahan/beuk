/* Beuk Weekly press: the preview page's sign-in box and the press bar's
 * buttons (src/weekly/preview.ts). Every action is a same-origin JSON POST;
 * the server checks the admin session and the Origin. Withdraw asks again
 * in an inline row, never a browser dialog. */
(function () {
  var msg = document.querySelector('.press-msg');
  function say(text) {
    if (msg) msg.textContent = text;
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  var login = document.querySelector('.press-login');
  if (login) {
    login.addEventListener('submit', function (e) {
      e.preventDefault();
      say('Signing in…');
      post('/api/auth/login', { email: login.email.value, password: login.password.value }).then(function (r) {
        if (r.ok) location.reload();
        else say('That email and password did not match an account.');
      }, function () { say('The server could not be reached.'); });
    });
  }

  var bar = document.querySelector('.press-bar[data-draft]');
  if (!bar) return;
  var base = '/school/weekly/draft/' + bar.getAttribute('data-draft') + '/';
  var confirmRow = bar.querySelector('.press-confirm');
  bar.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'withdraw-ask') { confirmRow.hidden = false; return; }
    if (act === 'withdraw-cancel') { confirmRow.hidden = true; return; }
    var body = {};
    if (act === 'send-back') {
      body.notes = (bar.querySelector('#press-notes') || {}).value || '';
      if (!body.notes.trim()) { say('Write what should change first.'); return; }
    }
    btn.disabled = true;
    say(act === 'approve' ? 'Publishing…' : 'Working…');
    post(base + act, body).then(function (r) {
      if (r.ok && act === 'approve' && r.data.url) { location.href = r.data.url; return; }
      if (r.ok) { location.reload(); return; }
      btn.disabled = false;
      say(r.data.error || 'That did not work (' + r.status + ').');
    }, function () {
      btn.disabled = false;
      say('The server could not be reached.');
    });
  });
})();
