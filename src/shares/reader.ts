import { sanitizeHtml } from './sanitize.js';
import type { Snapshot } from './render.js';

/**
 * Server-rendered beta-reader pages, in the Paper aesthetic of the help
 * reading room (client/help/warmth.css, served at /help/warmth.css).
 *
 * The page is read-only and works without JavaScript (chapter
 * navigation is plain links). The one script on the page is the small
 * comment helper below, allowed by a per-response CSP nonce; there are
 * no inline event handlers anywhere. The owner's account (email, id)
 * is never part of anything rendered here.
 */

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The reader page's security headers. */
export function readerHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "img-src 'self' data:",
      `style-src 'self' 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // The token is in the URL: never leak it to another site.
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  };
}

const READER_CSS = `
.rd-head{max-width:46rem;margin:0 auto;padding:1.1rem 1.5rem .8rem;border-bottom:1px solid var(--line)}
.rd-kicker{color:var(--ink-soft);font-style:italic;font-size:.95rem;margin:0}
.rd-book{font-size:1.7rem;line-height:1.2;margin:.15em 0 0}
.rd-by{color:var(--ink-soft);margin:.2em 0 0}
.rd-nav{margin:.8rem 0 0}
.rd-nav summary{cursor:pointer;color:var(--amber)}
.rd-nav ol{margin:.5rem 0 0;padding-left:1.4rem}
.rd-nav li{margin:.2em 0}
.rd-nav a[aria-current]{font-weight:700;color:var(--ink);text-decoration:none}
.rd-page{max-width:40rem;margin:0 auto;padding:1.2rem 1.5rem 2rem}
.rd-page .ch-num{text-align:center;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft);font-size:.95rem;margin:1.4em 0 0}
.rd-page .ch-title{text-align:center;margin:.3em 0 .2em}
.rd-page .ch-sub{text-align:center;font-style:italic;color:var(--ink-soft);margin:0 0 1.2em}
.rd-page p{text-indent:1.4em;margin:0}
.rd-page p.ch-num,.rd-page p.ch-sub,.rd-page .endnote,.rd-page .endnotes-h{text-indent:0}
.rd-page h2+p,.rd-page .ch-sub+p,.rd-page .scene-break+p,.rd-page h3+p,.rd-page h4+p{text-indent:0}
.rd-page .scene-break{text-align:center;margin:1em 0;color:var(--ink-soft)}
.rd-page figure{margin:1.2em 0;text-align:center}
.rd-page img{max-width:100%;height:auto}
.rd-page figcaption{font-size:.95rem;color:var(--ink-soft);font-style:italic}
.rd-page .endnotes{border-top:1px solid var(--line);margin-top:2em;padding-top:.6em;font-size:.98rem}
.rd-page .endnotes-h{font-weight:700}
.rd-page [data-p].has-notes{background:linear-gradient(transparent 60%,var(--amber-soft) 60%)}
.rd-pager{display:flex;justify-content:space-between;gap:1rem;max-width:40rem;margin:0 auto;padding:0 1.5rem 1.5rem}
.rd-box{max-width:40rem;margin:0 auto 2rem;padding:0 1.5rem}
.rd-box h2{font-size:1.2rem}
.rd-c{border:1px solid var(--line);background:#fffdf8;border-radius:8px;padding:.6rem .9rem;margin:.6rem 0}
.rd-c q{display:block;font-style:italic;color:var(--ink-soft);margin-bottom:.3em}
.rd-c .who{font-size:.92rem;color:var(--ink-soft)}
.rd-form label{display:block;font-size:.95rem;margin:.5em 0 .2em}
.rd-form input,.rd-form textarea{width:100%;font:inherit;font-size:1rem;padding:.45rem .6rem;border:1px solid var(--line);border-radius:6px;background:#fffdf8;color:var(--ink)}
.rd-form button,.rd-float{font:inherit;font-size:1rem;background:var(--amber);color:#fff7ed;border:0;border-radius:999px;padding:.45rem 1.1rem;margin-top:.6rem;cursor:pointer}
.rd-form .quote{font-style:italic;color:var(--ink-soft);border-left:3px solid var(--amber);padding-left:.7rem;margin:.4rem 0}
.rd-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.rd-float{position:absolute;z-index:5;margin:0;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.rd-msg{font-size:.98rem;color:var(--ink-soft)}
.rd-hint{font-size:.95rem;color:var(--ink-soft);font-style:italic}
@media (max-width:520px){.rd-page,.rd-head,.rd-box,.rd-pager{padding-left:1rem;padding-right:1rem}.rd-book{font-size:1.4rem}}
`;

/* The comment helper. It reads the share's path from the page, never
 * writes HTML from data (textContent only), and talks only to this
 * share's own comments endpoint. */
const READER_JS = `
(function(){
  var root=document.getElementById('rdRoot'); if(!root) return;
  var base=root.getAttribute('data-base'); var sec=root.getAttribute('data-section');
  var allow=root.getAttribute('data-allow')==='1';
  var list=document.getElementById('rdList'); var form=document.getElementById('rdForm');
  var qBox=document.getElementById('rdQuote'); var msg=document.getElementById('rdMsg');
  var anchor={p:null,quote:''};
  function el(tag,cls,text){var e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e;}
  function render(items){
    list.textContent='';
    var mine=items.filter(function(c){return c.sectionId===sec;});
    document.querySelectorAll('[data-p].has-notes').forEach(function(n){n.classList.remove('has-notes');});
    if(!mine.length){list.appendChild(el('p','rd-hint',root.getAttribute('data-empty')));return;}
    mine.forEach(function(c){
      var d=el('div','rd-c');
      if(c.quote) d.appendChild(el('q',null,c.quote));
      d.appendChild(el('div',null,c.body));
      d.appendChild(el('div','who',(c.readerName||root.getAttribute('data-anon'))+' · '+new Date(c.createdAt).toLocaleDateString()));
      list.appendChild(d);
      if(c.paragraph!=null){var p=document.querySelector('.rd-page [data-p="'+c.paragraph+'"]'); if(p)p.classList.add('has-notes');}
    });
  }
  function load(){fetch(base+'/comments',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():{comments:[]};}).then(function(j){render(j.comments||[]);}).catch(function(){});}
  load();
  if(!allow||!form) return;
  var btn=el('button','rd-float',root.getAttribute('data-cta')); btn.type='button'; btn.style.display='none'; document.body.appendChild(btn);
  function setAnchor(p,quote){anchor.p=p;anchor.quote=quote; qBox.textContent=quote; qBox.hidden=!quote;}
  document.addEventListener('selectionchange',function(){
    var s=window.getSelection(); if(!s||s.isCollapsed||!s.rangeCount){btn.style.display='none';return;}
    var node=s.anchorNode; var elx=node&&(node.nodeType===1?node:node.parentElement); var blk=elx&&elx.closest?elx.closest('.rd-page [data-p]'):null;
    if(!blk){btn.style.display='none';return;}
    var r=s.getRangeAt(0).getBoundingClientRect();
    btn.style.top=(window.scrollY+r.bottom+8)+'px'; btn.style.left=Math.max(8,window.scrollX+r.left)+'px'; btn.style.display='';
    btn.onclick=function(){setAnchor(parseInt(blk.getAttribute('data-p'),10),String(s.toString()).replace(/\\s+/g,' ').trim().slice(0,500)); btn.style.display='none'; form.scrollIntoView({behavior:'smooth'}); form.querySelector('textarea').focus();};
  });
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var fd=new FormData(form);
    var payload={sectionId:sec,paragraph:anchor.p,quote:anchor.quote,body:String(fd.get('body')||''),readerName:String(fd.get('readerName')||''),website:String(fd.get('website')||'')};
    msg.textContent=root.getAttribute('data-sending');
    fetch(base+'/comments',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(x){
        if(!x.ok){msg.textContent=(x.j&&x.j.error)||root.getAttribute('data-failed');return;}
        msg.textContent=root.getAttribute('data-thanks'); form.querySelector('textarea').value=''; setAnchor(null,''); load();
      }).catch(function(){msg.textContent=root.getAttribute('data-failed');});
  });
})();
`;

function shell(opts: {
  nonce: string;
  title: string;
  lang: string;
  body: string;
  script?: boolean;
}): string {
  return `<!doctype html>
<html lang="${esc(opts.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <title>${esc(opts.title)}</title>
    <link rel="stylesheet" href="/help/warmth.css" />
    <style nonce="${opts.nonce}">${READER_CSS}</style>
  </head>
  <body>
${opts.body}
    <footer class="site-foot"><p class="foot-note">A reading copy shared from Beuk — a typesetting studio for writers.</p></footer>
${opts.script ? `    <script nonce="${opts.nonce}">${READER_JS}</script>\n` : ''}  </body>
</html>
`;
}

export interface ReaderPageInput {
  nonce: string;
  token: string;
  snapshot: Snapshot;
  chapter: number;
  allowComments: boolean;
  readerNameRequired: boolean;
}

export function renderReaderPage(input: ReaderPageInput): string {
  const { snapshot, token, nonce } = input;
  const base = `/read/${token}`;
  const sections = snapshot.sections;
  const n = Math.min(Math.max(0, input.chapter), Math.max(0, sections.length - 1));
  const cur = sections[n];
  const nav = sections
    .map(
      (s, i) =>
        `<li><a href="${base}?c=${i}"${i === n ? ' aria-current="page"' : ''}>${esc(s.label)}</a></li>`,
    )
    .join('');
  const html = cur
    ? sanitizeHtml(cur.html, {
        resolveImage: (id) => `${base}/img/${encodeURIComponent(id)}`,
      })
    : '<p>This reading copy has no chapters with text yet.</p>';
  const prev = n > 0 ? `<a href="${base}?c=${n - 1}" rel="prev">← ${esc(sections[n - 1].label)}</a>` : '<span></span>';
  const next =
    n < sections.length - 1 ? `<a href="${base}?c=${n + 1}" rel="next">${esc(sections[n + 1].label)} →</a>` : '<span></span>';
  const nameReq = input.readerNameRequired ? ' required' : '';
  const form = input.allowComments
    ? `<form class="rd-form" id="rdForm" autocomplete="on">
        <p class="rd-hint">Select a passage to comment on it, or write about the chapter as a whole.</p>
        <p class="quote" id="rdQuote" hidden></p>
        <label for="rdName">Your name${input.readerNameRequired ? '' : ' (optional)'}</label>
        <input id="rdName" name="readerName" maxlength="60"${nameReq} />
        <label for="rdBody">Your comment</label>
        <textarea id="rdBody" name="body" rows="4" maxlength="2000" required></textarea>
        <div class="rd-hp" aria-hidden="true"><label for="rdWebsite">Leave this empty</label><input id="rdWebsite" name="website" tabindex="-1" autocomplete="off" /></div>
        <button type="submit">Send to the writer</button>
        <p class="rd-msg" id="rdMsg" role="status"></p>
      </form>`
    : '<p class="rd-hint">The writer has turned comments off for this copy.</p>';
  const body = `
    <header class="rd-head">
      <p class="rd-kicker">A reading copy, shared with you</p>
      <h1 class="rd-book">${esc(snapshot.title)}</h1>
      ${snapshot.subtitle ? `<p class="rd-by"><em>${esc(snapshot.subtitle)}</em></p>` : ''}
      ${snapshot.author ? `<p class="rd-by">by ${esc(snapshot.author)}</p>` : ''}
      <details class="rd-nav"><summary>Chapters (${sections.length})</summary><ol>${nav}</ol></details>
    </header>
    <main class="rd-page" id="rdRoot" data-base="${esc(base)}" data-section="${esc(cur?.id ?? '')}" data-allow="${input.allowComments ? '1' : '0'}"
      data-cta="Comment on this" data-empty="No comments on this chapter yet." data-anon="A reader"
      data-sending="Sending…" data-thanks="Thank you — the writer will see your comment." data-failed="That didn’t send — please try again in a moment.">
${html}
    </main>
    <nav class="rd-pager">${prev}${next}</nav>
    <section class="rd-box" aria-label="Comments">
      <h2>Comments on this chapter</h2>
      <div id="rdList"><p class="rd-hint">Comments appear here when scripts are allowed.</p></div>
      ${form}
    </section>`;
  return shell({ nonce, title: `${snapshot.title} — a reading copy`, lang: snapshot.language, body, script: true });
}

/** The calm page for a link that has been revoked or has expired. */
export function renderGonePage(nonce: string, reason: 'revoked' | 'expired'): string {
  const line =
    reason === 'expired'
      ? 'The reading period for this copy has ended.'
      : 'The writer has closed this reading copy.';
  return shell({
    nonce,
    title: 'This reading copy is closed',
    lang: 'en',
    body: `
    <main class="page">
      <h1>This reading copy is closed</h1>
      <p class="lede">${line}</p>
      <p>Nothing is wrong on your side. If you were reading it as a beta reader, thank you — and if you’d like
      to keep going, ask the writer for a fresh link.</p>
    </main>`,
  });
}

export function renderNotFoundPage(nonce: string): string {
  return shell({
    nonce,
    title: 'Reading copy not found',
    lang: 'en',
    body: `
    <main class="page">
      <h1>We couldn’t find this reading copy</h1>
      <p class="lede">The link may be incomplete — check that it was copied in full, or ask the writer to send it again.</p>
    </main>`,
  });
}
