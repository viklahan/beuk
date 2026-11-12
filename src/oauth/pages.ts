import { escapeHtml as esc } from '../warmth/markdown.js';

/** What each scope means, in the writer's words — shown on the consent
 *  screen so approval is informed, not a shrug. */
export const SCOPE_COPY: Record<string, string> = {
  'beuk:read': 'Read your books, exports and account basics',
  'beuk:write': 'Create and change your books',
  'beuk:export': 'Build and download exports of your books',
};

/** One shared shell: small, self-contained, inline styles only (the
 *  Caddy CSP allows 'unsafe-inline' for style/script, nothing foreign). */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #faf8f5; color: #262220;
         display: grid; min-height: 100vh; place-items: center; }
  @media (prefers-color-scheme: dark) { body { background: #16140f; color: #e8e2d9; } }
  main { max-width: 26rem; width: calc(100% - 2rem); padding: 2rem 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { line-height: 1.5; margin: 0.5rem 0; }
  ul { padding-left: 1.2rem; line-height: 1.7; }
  label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; }
  input { width: 100%; box-sizing: border-box; padding: 0.55rem 0.6rem; font: inherit;
          border: 1px solid #8884; border-radius: 6px; background: transparent; color: inherit; }
  .row { display: flex; gap: 0.6rem; margin-top: 1.25rem; }
  button { font: inherit; padding: 0.55rem 1.1rem; border-radius: 6px; cursor: pointer;
           border: 1px solid #8886; background: transparent; color: inherit; }
  button.primary { background: #2a6f4e; border-color: #2a6f4e; color: #fff; }
  .error { color: #b4362e; min-height: 1.2rem; font-size: 0.9rem; }
  .fine { font-size: 0.8rem; opacity: 0.75; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/** /authorize while signed out: sign in with the EXISTING session login
 *  (POST /api/auth/login sets the beuk_session cookie), then reload this
 *  same /authorize URL, query string and all.
 *
 *  Two-step sign-in (migration 025): with it on, /api/auth/login answers
 *  200 {twoStep, challenge} and sets NO cookie, so a reload would land on
 *  this same form forever. The page then asks for the code (authenticator
 *  or recovery code) and sends it to /api/auth/login/code with the
 *  challenge; that answer sets the cookie, and the reload reaches the
 *  consent screen. The password and the code are never kept. */
export function signInPage(clientName: string): string {
  return page(
    'Sign in to Beuk',
    `<h1>Sign in to Beuk</h1>
<p><strong>${esc(clientName)}</strong> is asking to connect to your Beuk account. Sign in to continue.</p>
<form id="f">
  <div id="pwStep">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
  </div>
  <div id="codeStep" hidden>
    <p>Two-step sign-in is on. Type the 6-digit code from your authenticator app, or a recovery code.</p>
    <label for="code">Code</label>
    <input id="code" name="code" type="text" inputmode="text" autocomplete="one-time-code" maxlength="32">
  </div>
  <p class="error" id="err" role="alert"></p>
  <div class="row"><button class="primary" type="submit" id="go">Sign in</button></div>
</form>
<script>
let challenge = null;
const post = (path, body) => fetch(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).catch(() => null);
const failText = async (res) => {
  const body = res ? await res.json().catch(() => ({})) : {};
  return body.error || 'sign-in failed — please try again';
};
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  const go = document.getElementById('go');
  err.textContent = '';
  go.disabled = true;
  try {
    if (challenge) {
      const codeField = document.getElementById('code');
      const res = await post('/api/auth/login/code', { challenge, code: codeField.value });
      codeField.value = '';
      if (res && res.ok) { location.reload(); return; }
      // 410: the challenge died (5 minutes or 5 wrong codes) — start over.
      if (res && res.status === 410) {
        challenge = null;
        document.getElementById('codeStep').hidden = true;
        document.getElementById('pwStep').hidden = false;
        document.getElementById('password').required = true;
        document.getElementById('code').required = false;
      }
      err.textContent = await failText(res);
      return;
    }
    const passwordField = document.getElementById('password');
    const res = await post('/api/auth/login', {
      email: document.getElementById('email').value,
      password: passwordField.value,
    });
    passwordField.value = '';
    if (res && res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.twoStep && typeof body.challenge === 'string') {
        challenge = body.challenge;
        document.getElementById('pwStep').hidden = true;
        document.getElementById('codeStep').hidden = false;
        passwordField.required = false;
        const codeField = document.getElementById('code');
        codeField.required = true;
        codeField.focus();
        return;
      }
      location.reload();
      return;
    }
    err.textContent = await failText(res);
  } finally {
    go.disabled = false;
  }
});
</script>`,
  );
}

/** The consent screen. `consentToken` is the single-use CSRF token bound
 *  to this user + request (oauth_tokens kind 'consent'). */
export function consentPage(args: {
  clientName: string;
  /** The registered redirect's host: where approval sends the writer. */
  redirectHost: string;
  email: string;
  scopes: string[];
  consentToken: string;
}): string {
  const items = args.scopes
    .map((s) => `<li>${esc(SCOPE_COPY[s] ?? s)} <span class="fine">(${esc(s)})</span></li>`)
    .join('');
  return page(
    'Connect to Beuk',
    `<h1>Connect ${esc(args.clientName)} to Beuk?</h1>
<p>Signed in as <strong>${esc(args.email)}</strong>.</p>
<p>Approving sends you back to <strong>${esc(args.redirectHost)}</strong>. The name above is the one the app gave itself — connect only if you started this from an app you trust at that address.</p>
<p><strong>${esc(args.clientName)}</strong> will be able to:</p>
<ul>${items}</ul>
<form method="post" action="/authorize/decision">
  <input type="hidden" name="consent" value="${esc(args.consentToken)}">
  <div class="row">
    <button class="primary" type="submit" name="decision" value="approve">Approve</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </div>
</form>
<p class="fine">You can cut this connection off any time with “Sign out everywhere” on your account page.</p>`,
  );
}

/** The post-decision page. The Caddy CSP's form-action 'self' makes
 *  Chrome refuse a 302 from a form POST to a foreign origin, so the
 *  decision answers 200 with a meta refresh (plain navigation, which
 *  CSP does not gate) plus a visible link. */
export function returnPage(redirectUrl: string): string {
  return page(
    'Returning…',
    `<meta http-equiv="refresh" content="0;url=${esc(redirectUrl)}">
<h1>All set</h1>
<p>Returning you to the app that asked… <a href="${esc(redirectUrl)}">continue</a> if nothing happens.</p>`,
  );
}

/** Errors that must NOT redirect (unknown client / unregistered
 *  redirect_uri — RFC 6749 §4.1.2.1: never send the browser to an
 *  address the client did not register). */
export function errorPage(message: string): string {
  return page(
    'Connection request refused',
    `<h1>This connection request can’t continue</h1>
<p>${esc(message)}</p>
<p class="fine">Close this page and try connecting again from the app that sent you here.</p>`,
  );
}
