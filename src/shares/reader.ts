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
.rd-page .redacted{background:currentColor;letter-spacing:0;user-select:none}
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
/* Full screen (BEUK:fullscreen): the button exists only once the script runs; without
   element full screen (iPhone Safari) it offers "Just the text" instead, which hides the
   page's surroundings (header details, comments, footer) and keeps the chapter. */
.rd-full{float:right;font:inherit;font-size:.9rem;background:transparent;color:var(--amber);border:1px solid var(--line);border-radius:999px;padding:.3rem .85rem;margin:0 0 .4rem .8rem;cursor:pointer}
[dir=rtl] .rd-full{float:left;margin:0 .8rem .4rem 0}
.rd-full[aria-pressed=true]{background:var(--amber-soft)}
.rd-full:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.rd-full[hidden]{display:none}
html:fullscreen{background:var(--paper,#fbf8f1);overflow-y:auto}
html.rd-imm .rd-kicker,html.rd-imm .rd-by,html.rd-imm .rd-box,html.rd-imm .site-foot{display:none}
html.rd-imm .rd-head{position:sticky;top:0;z-index:4;background:var(--paper,#fbf8f1);padding-top:max(.6rem,env(safe-area-inset-top))}
html.rd-imm .rd-book{font-size:1.15rem}
html.rd-imm .rd-pager{padding-bottom:max(1.5rem,env(safe-area-inset-bottom))}
`;

/* Named reading links: the watermark. Emitted only when the page has a
 * recipient, so the open page is byte-equal to what it was.
 *
 * The reader page has no dark theme (warmth.css and READER_CSS set the
 * paper colours unconditionally, with no prefers-color-scheme rule), so a
 * dark-mode browser still shows paper. The ink is the page's own --ink
 * with a faint light halo, so the stamp also shows if a browser force-darkens
 * the page (Chrome's auto dark mode, Samsung Internet). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Shared with <name> \u00B7 <d Mon yyyy>`: the link's created_at in UTC. */
export function stampText(name: string, createdAtIso: string): string {
  const d = new Date(createdAtIso);
  if (Number.isNaN(d.getTime())) throw new Error('stampText: createdAt is not a date');
  return `Shared with ${name} \u00B7 ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Bidi format characters: ALM, LRM, RLM, LRE…RLO, LRI…PDI. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** The name as it goes into the SVG stamp: its own bidi controls dropped
 *  (only there; the HTML line keeps the name exact inside <bdi>) and the
 *  rest between FSI and PDI, so an RLO can't reorder "Shared with" or the
 *  date and an RTL name can't pull the date's digits into its run. */
export function stampSvgName(name: string): string {
  return `\u2068${name.replace(BIDI_CONTROLS, '')}\u2069`;
}

/** A generous width estimate, in em, for one character of the stamp
 *  (Georgia-ish). Over-estimating only adds space; under-estimating would
 *  clip the text at the tile's edge. */
function stampEm(ch: string): number {
  if (/[\p{Cf}\p{Mn}]/u.test(ch)) return 0;
  if (/[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) return 1.05;
  if (/[MW@%]/.test(ch)) return 1;
  if (/[\p{Lu}\p{Nd}]/u.test(ch)) return 0.75;
  if (ch === ' ') return 0.35;
  return 0.58;
}
const emOf = (s: string) => [...s].reduce((n, ch) => n + stampEm(ch), 0);
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** The stamp tile: an SVG with the text rotated −30°, XML-escaped, then
 *  encodeURIComponent-encoded, so it is safe inside CSS url("…") (no `"`,
 *  `\`, `<` or newline can survive). One line at 15px when it fits a 360px
 *  phone; otherwise "Shared with" / the name / "· date" on three lines, the
 *  font shrinking to no less than 10px. The tile is at least 360×200 and
 *  grows to hold the whole text, so a long name is never clipped. The SVG's
 *  character content is always exactly `text`. */
export function stampDataUri(text: string): string {
  const fit = 320; // the widest a rotated stamp should be, to show whole on a phone
  const pre = 'Shared with ';
  const sep = text.lastIndexOf(` ${String.fromCharCode(0xb7)} `);
  let lines = [text];
  let font = 15;
  if (emOf(text) * font * COS30 > fit && text.startsWith(pre) && sep >= pre.length) {
    lines = [pre, text.slice(pre.length, sep + 1), text.slice(sep + 1)];
    const widest = Math.max(...lines.map(emOf));
    font = Math.max(10, Math.min(15, Math.floor(fit / (widest * COS30))));
  }
  const lh = Math.round(font * 1.35);
  const bw = Math.max(...lines.map(emOf)) * font; // the text block, unrotated
  const bh = lines.length * lh;
  const w = Math.max(360, Math.ceil(bw * COS30 + bh * SIN30 + 30));
  const h = Math.max(200, Math.ceil(bw * SIN30 + bh * COS30 + 30));
  const cx = w / 2;
  const cy = h / 2;
  const top = cy - ((lines.length - 1) * lh) / 2;
  const body =
    lines.length === 1
      ? esc(text)
      : lines.map((l, i) => `<tspan x="${cx}" y="${top + i * lh}">${esc(l)}</tspan>`).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" direction="ltr" ` +
    `transform="rotate(-30 ${cx} ${cy})" font-family="Georgia,'Times New Roman',serif" font-size="${font}" ` +
    `fill="#22333a" fill-opacity="0.11" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.5">` +
    `${body}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function namedCss(svgText: string): string {
  return `.rd-stamp{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:url("${stampDataUri(svgText)}");background-repeat:repeat;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rd-head,.rd-page,.rd-pager,.rd-box,.site-foot{position:relative;z-index:1}
html.rd-imm .rd-kicker.rd-named{display:block}
.rd-kicker.rd-named{overflow-wrap:anywhere}
@media print{.rd-stamp{position:fixed;inset:0;display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact}.rd-kicker.rd-named{display:block}}
`;
}

/* The comment helper. It reads the share's path from the page, never
 * writes HTML from data (textContent only), and talks only to this
 * share's own comments endpoint. */
const READER_JS = `
(function(){
  /* Full screen (BEUK:fullscreen): the Fullscreen API with the webkit one for Safari/iPad;
     where neither exists (iPhone Safari) the button says "Just the text" and only hides
     the page's surroundings. F toggles it (not while typing); Escape leaves it. */
  var b=document.getElementById('rdFull'); if(!b) return;
  var de=document.documentElement;
  var can=!!((de.requestFullscreen||de.webkitRequestFullscreen)&&(document.fullscreenEnabled||document.webkitFullscreenEnabled));
  function now(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
  function imm(){return de.classList.contains('rd-imm');}
  function sync(){
    var on=!!now()||imm(), native=can&&!imm();
    b.setAttribute('aria-pressed',on?'true':'false');
    b.textContent=b.getAttribute(on?(native?'data-exit':'data-fill-exit'):(can?'data-enter':'data-fill'));
    b.title=b.textContent+' (F)';
  }
  function setImm(on){de.classList.toggle('rd-imm',on); sync();}
  function toggle(){
    if(imm()){setImm(false);return;}
    if(now()){var x=document.exitFullscreen||document.webkitExitFullscreen; try{var r=x.call(document); if(r&&r.catch)r.catch(function(){});}catch(e){} return;}
    if(can){try{var q=(de.requestFullscreen||de.webkitRequestFullscreen).call(de); if(q&&q.catch)q.catch(function(){can=false;setImm(true);});return;}catch(e){can=false;}}
    setImm(true);
  }
  b.hidden=false; sync();
  b.addEventListener('click',toggle);
  document.addEventListener('fullscreenchange',sync); document.addEventListener('webkitfullscreenchange',sync);
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&imm()){e.preventDefault();setImm(false);return;}
    if((e.key!=='f'&&e.key!=='F')||e.ctrlKey||e.metaKey||e.altKey||e.repeat||e.isComposing) return;
    var t=e.target, tag=t&&t.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable)) return;
    e.preventDefault(); toggle();
  });
})();
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
  /** Extra CSS after READER_CSS (named pages only). */
  extraCss?: string;
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
    <style nonce="${opts.nonce}">${READER_CSS}${opts.extraCss ?? ''}</style>
  </head>
  <body>
${opts.body}
    <footer class="site-foot"><p class="foot-note">A reading copy shared from Beuk — a typesetting studio for writers.</p><p class="foot-links"><a href="/privacy" rel="noreferrer">Privacy</a> · <a href="/terms" rel="noreferrer">Terms</a></p></footer>
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
  /** Set on a named reading link: the reader's name and the link's
   *  created_at (ISO). Absent on the open link. */
  recipient?: { name: string; createdAt: string };
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
  const who = input.recipient;
  // A named link: the name is fixed (the server forces reader_name anyway),
  // prefilled and read-only; readonly, not disabled, so the form still sends it.
  const nameFixed = who ? ` readonly value="${esc(who.name)}"` : '';
  const form = input.allowComments
    ? `<form class="rd-form" id="rdForm" autocomplete="on">
        <p class="rd-hint">Select a passage to comment on it, or write about the chapter as a whole.</p>
        <p class="quote" id="rdQuote" hidden></p>
        <label for="rdName">Your name${input.readerNameRequired || who ? '' : ' (optional)'}</label>
        <input id="rdName" name="readerName" maxlength="60"${nameReq}${nameFixed} />
        <label for="rdBody">Your comment</label>
        <textarea id="rdBody" name="body" rows="4" maxlength="2000" required></textarea>
        <div class="rd-hp" aria-hidden="true"><label for="rdWebsite">Leave this empty</label><input id="rdWebsite" name="website" tabindex="-1" autocomplete="off" /></div>
        <button type="submit">Send to the writer</button>
        <p class="rd-msg" id="rdMsg" role="status"></p>
      </form>`
    : '<p class="rd-hint">The writer has turned comments off for this copy.</p>';
  const kicker = who
    ? `<p class="rd-kicker rd-named">${stampText(`<bdi>${esc(who.name)}</bdi>`, who.createdAt)}</p>`
    : '<p class="rd-kicker">A reading copy, shared with you</p>';
  const stamp = who ? '\n    <div class="rd-stamp" aria-hidden="true"></div>' : '';
  const body = `${stamp}
    <header class="rd-head">
      <button type="button" class="rd-full" id="rdFull" hidden aria-pressed="false" aria-keyshortcuts="F" data-enter="Full screen" data-exit="Exit full screen" data-fill="Just the text" data-fill-exit="Show the whole page">Full screen</button>
      ${kicker}
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
  return shell({
    nonce,
    title: `${snapshot.title} — a reading copy`,
    lang: snapshot.language,
    body,
    script: true,
    extraCss: who ? namedCss(stampText(stampSvgName(who.name), who.createdAt)) : undefined,
  });
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
      <p class="rd-hint">Reference: <a href="/help/errors/BEUK-H410">BEUK-H410</a></p>
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
