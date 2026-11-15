import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer } from '../mailer.js';
import { requireAdmin } from '../housekeeping/admin.js';
import { firstNameOf, inviteEmail, inviteHtml } from '../email/invite.js';

/**
 * Owner-only invite sender. The whole surface sits behind requireAdmin, so
 * a non-admin (anonymous or ordinary writer) gets a plain 404 — the tool
 * does not reveal that it exists. Admin is granted only by the CLI on the
 * server, so this is "my eyes only" by construction.
 *
 *   GET  /account/invite       the form (name + email, preview, send)
 *   GET  /api/invite/preview   the email rendered for the browser (URL logo)
 *   POST /api/invite           send one personalised invite via the mailer
 *
 * Sending goes through the app's configured mailer, which in production is
 * the owner's own Gmail (SMTP_URL). There is no table: a few hand-sent
 * invites need no ledger.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function invitePage(_config: Config): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send an invite — Beuk</title>
<style>
  :root{color-scheme:light;--bg:#f8f4e9;--card:#fffdf4;--ink:#22333a;--muted:#5d6d66;--accent:#14607a;--amber:#a87e2c;--line:#d5dcc9;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:Karla,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;padding:40px 16px;}
  main{max-width:640px;margin:0 auto;}
  h1{font-family:Georgia,"Times New Roman",serif;font-size:28px;margin:0 0 6px;}
  .sub{color:var(--muted);margin:0 0 24px;}
  form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;}
  label{display:block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 6px;}
  input,textarea{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:11px 13px;font-size:16px;font-family:inherit;margin-bottom:16px;}
  textarea{resize:vertical;min-height:72px;line-height:1.5;}
  input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent;}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;}
  button{font:inherit;font-weight:700;cursor:pointer;border-radius:999px;padding:12px 22px;border:1px solid var(--accent);}
  .send{background:var(--accent);color:#f4fbfa;}
  .ghost{background:transparent;color:var(--accent);}
  button:disabled{opacity:.55;cursor:default;}
  .msg{margin:16px 0 0;font-size:14px;min-height:1.2em;}
  .msg.ok{color:#176a4a;}
  .msg.err{color:#a8372c;}
  iframe{width:100%;height:760px;border:1px solid var(--line);border-radius:12px;margin-top:20px;background:#fff;display:none;}
  .note{color:var(--muted);font-size:13px;margin-top:14px;}
</style>
</head>
<body>
<main>
  <h1>Send a founding-reader invite</h1>
  <p class="sub">Goes out as a real Beuk email, from your Gmail — one at a time, personalised.</p>
  <form id="f" autocomplete="off">
    <label for="name">Their name</label>
    <input id="name" name="name" type="text" placeholder="Marcus" required>
    <label for="email">Their email</label>
    <input id="email" name="email" type="email" placeholder="marcus@example.com" required>
    <label for="message">Personal note (optional)</label>
    <textarea id="message" name="message" rows="3" placeholder="A line just for them — why you thought of them, or what to look at first."></textarea>
    <div class="row">
      <button type="button" class="ghost" id="preview">Preview</button>
      <button type="submit" class="send" id="send">Send invite</button>
    </div>
    <p class="msg" id="msg" role="status" aria-live="polite"></p>
    <p class="note">Preview opens the exact email below. Nothing sends until you press <b>Send invite</b>.</p>
  </form>
  <iframe id="pv" title="Email preview"></iframe>
</main>
<script>
  var f=document.getElementById('f'),nameEl=document.getElementById('name'),emailEl=document.getElementById('email'),msgEl=document.getElementById('message'),
      msg=document.getElementById('msg'),send=document.getElementById('send'),previewBtn=document.getElementById('preview'),pv=document.getElementById('pv');
  function say(t,cls){msg.textContent=t;msg.className='msg '+(cls||'');}
  previewBtn.addEventListener('click',function(){
    var n=(nameEl.value||'there').trim();
    pv.src='/api/invite/preview?name='+encodeURIComponent(n)+'&message='+encodeURIComponent(msgEl.value||'');
    pv.style.display='block';
  });
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var name=nameEl.value.trim(), email=emailEl.value.trim(), message=msgEl.value.trim();
    if(!name){say('Add their name.','err');return;}
    if(!email){say('Add their email.','err');return;}
    send.disabled=true;say('Sending…');
    fetch('/api/invite',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,email:email,message:message})})
      .then(function(r){return r.json().then(function(b){return {ok:r.ok,b:b};});})
      .then(function(res){
        if(res.ok&&res.b&&res.b.ok){say('Sent to '+email+'. '+name+' is in. ✦','ok');f.reset();pv.style.display='none';}
        else{say((res.b&&res.b.error)||'Could not send.','err');}
      })
      .catch(function(){say('Could not reach the server.','err');})
      .then(function(){send.disabled=false;});
  });
</script>
</body>
</html>`;
}

export function inviteRoutes(db: Db, config: Config, mailer: Mailer): { pages: Router; api: Router } {
  const pages = Router();
  pages.get('/account/invite', requireAdmin(db), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.type('html').send(invitePage(config));
  });

  const api = Router();
  api.use(requireAdmin(db));

  // The email rendered for the browser: the logo is a URL here, because a
  // cid: image only resolves inside an email.
  api.get('/preview', (req, res) => {
    const name = firstNameOf(String(req.query.name ?? ''));
    const message = String(req.query.message ?? '').slice(0, 2000);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.type('html').send(inviteHtml(config, name, '/assets/icon-192.png', message));
  });

  // Send one personalised invite through the mailer (the owner's Gmail in prod).
  api.post('/', async (req, res, next) => {
    try {
      const name = String((req.body as { name?: unknown })?.name ?? '').trim();
      const email = String((req.body as { email?: unknown })?.email ?? '').trim().toLowerCase();
      const message = String((req.body as { message?: unknown })?.message ?? '').slice(0, 2000);
      if (!name) return res.status(400).json({ error: 'A name is required.' });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
      const msg = await inviteEmail(config, name, message);
      // email-kind: invite
      const result = await mailer.send({
        to: email,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments,
      });
      if (!result.delivered) {
        return res.status(502).json({ error: `Not sent: ${result.reason}` });
      }
      return res.json({ ok: true, sent: email });
    } catch (err) {
      return next(err);
    }
  });

  return { pages, api };
}
