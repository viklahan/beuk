/* Beuk — the Ko-fi tip jar gate (BEUK:branding, V's D4, 2026-10-25).
 *
 * The tip jar stays only until paid plans are live: "buy me a coffee"
 * must never sit next to a subscription. This tiny script asks the
 * shelf whether billing is live (GET /api/billing/status, answered as
 * { live: boolean } once the billing work ships) and hides every
 * element marked data-kofi when — and only when — the answer is an
 * explicit live === true.
 *
 * Anything else means NOT live, and the jar shows as before:
 *   - 404 / 501 / any non-2xx (the route not shipped, or billing off)
 *   - a body that is not JSON, or has no live === true
 *   - a network error, no fetch API, or no answer within GATE_WAIT_MS
 *
 * The app only includes this script on pages that actually carry a
 * jar (KOFI_URL configured), so a server without Ko-fi makes no
 * request at all. While the question is open the jar is held
 * invisible (visibility, so nothing jumps) for at most GATE_WAIT_MS;
 * a late "live" answer still hides it.
 */
(function () {
  var GATE_WAIT_MS = 1500;
  var root = document.documentElement;

  try {
    var style = document.createElement('style');
    style.setAttribute('data-beuk-billing-gate', '');
    style.textContent =
      'html[data-billing="checking"] [data-kofi]{visibility:hidden}' +
      'html[data-billing="live"] [data-kofi]{display:none !important}';
    (document.head || root).appendChild(style);
  } catch (e) {
    /* no style element: the attribute below still records the answer */
  }

  function settle(state) {
    root.setAttribute('data-billing', state);
  }

  settle('checking');
  var timer = setTimeout(function () {
    if (root.getAttribute('data-billing') === 'checking') settle('not-live');
  }, GATE_WAIT_MS);

  function answer(live) {
    clearTimeout(timer);
    settle(live ? 'live' : 'not-live');
  }

  try {
    fetch('/api/billing/status', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(function (res) {
        if (!res || !res.ok) return null;
        return res.json().catch(function () { return null; });
      })
      .then(function (body) {
        answer(!!body && body.live === true);
      })
      .catch(function () {
        answer(false);
      });
  } catch (e) {
    answer(false);
  }
})();
