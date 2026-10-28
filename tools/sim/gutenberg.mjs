// Public-domain sagas for the simulation, from Project Gutenberg's own site.
//
//   node tools/sim/gutenberg.mjs fetch    download each ebook's HTML zip (with images) once
//   node tools/sim/gutenberg.mjs prep     HTML -> Beuk-importable Markdown + image list
//
// Which ebooks: tools/sim/sagas.json (ebook numbers looked up in the
// Gutenberg catalogue, pg_catalog.csv, never guessed). Downloads go to
// <SAGAS>/_sources/pg<id>/ and the record of every download (URL, date,
// sha256) to <SAGAS>/sources.json. SAGAS defaults to
// <Projects>/beuk-whole-project/10-ramp-gallery/sagas (SIM_SAGAS_DIR to point elsewhere).
//
// Prep keeps the prose exactly as the HTML has it (entities decoded,
// whitespace collapsed the way a browser shows it); it only turns markup
// into the Markdown Beuk's own importer reads: "## " chapter headings,
// *italic*, **bold**, "> " quotations, *** for thought breaks, and
// ![alt](img:<id> "caption") picture lines where the source places its
// pictures. It drops the Gutenberg header, footer and licence, page
// numbers, the contents list (Beuk builds its own) and any block that
// names Project Gutenberg (transcriber/producer notes), as the
// licence requires for redistributed public-domain text. Every dropped
// block is listed in the prep report so nothing is removed silently.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SAGAS_DIR = process.env.SIM_SAGAS_DIR || path.resolve(HERE, '..', '..', '..', '..', 'beuk-whole-project', '10-ramp-gallery', 'sagas');
const SRC_DIR = path.join(SAGAS_DIR, '_sources');
const PREP_DIR = path.join(SAGAS_DIR, '_prepared');

export function loadSagas() {
  return JSON.parse(readFileSync(path.join(HERE, 'sagas.json'), 'utf8'));
}
export function allVolumes() {
  const s = loadSagas();
  const out = [];
  for (const series of s.series) series.volumes.forEach((v, i) => out.push({ ...v, series: series.name, seriesKey: series.key, order: i + 1, author: series.author, persona: series.persona }));
  return out;
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------------------ fetch */
async function fetchAll() {
  mkdirSync(SRC_DIR, { recursive: true });
  const recPath = path.join(SAGAS_DIR, 'sources.json');
  const rec = existsSync(recPath) ? JSON.parse(readFileSync(recPath, 'utf8')) : { note: '', ebooks: {} };
  rec.note = 'Public-domain texts downloaded from gutenberg.org (the Project Gutenberg site itself). ' +
    'Each entry: ebook number, catalogue title, the exact URL fetched, the UTC date of the download and the sha256 of the bytes received. ' +
    'The books built from them carry none of the Gutenberg header, footer or licence text and do not use the Project Gutenberg name.';
  for (const v of allVolumes()) {
    const dir = path.join(SRC_DIR, 'pg' + v.ebook);
    const zip = path.join(dir, `pg${v.ebook}-h.zip`);
    const url = `https://www.gutenberg.org/cache/epub/${v.ebook}/pg${v.ebook}-h.zip`;
    if (!existsSync(zip)) {
      mkdirSync(dir, { recursive: true });
      const res = await fetch(url, { headers: { 'User-Agent': 'beuk-sim (one-time download for a local simulation)' } });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(zip, buf);
      rec.ebooks[v.ebook] = { ebook: v.ebook, title: v.catalogTitle, series: v.series, order: v.order, url, page: `https://www.gutenberg.org/ebooks/${v.ebook}`, downloadedAt: new Date().toISOString().slice(0, 10), bytes: buf.length, sha256: sha256(buf) };
      console.log('fetched', v.ebook, v.catalogTitle, buf.length);
      await new Promise((r) => setTimeout(r, 1500)); // be gentle with gutenberg.org
    }
    if (!readdirSync(dir).some((f) => f.endsWith('.html') || f.endsWith('.htm'))) {
      execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    }
  }
  writeFileSync(recPath, JSON.stringify(rec, null, 2));
  console.log('sources.json:', Object.keys(rec.ebooks).length, 'ebooks');
}

/* ------------------------------------------------------------------- html */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', aelig: 'æ', AElig: 'Æ', oelig: 'œ', OElig: 'Œ', ccedil: 'ç', Ccedil: 'Ç', icirc: 'î', iuml: 'ï', iacute: 'í', igrave: 'ì', ocirc: 'ô', ouml: 'ö', oacute: 'ó', ograve: 'ò', ucirc: 'û', uuml: 'ü', uacute: 'ú', ugrave: 'ù', ntilde: 'ñ', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Acirc: 'Â', Ocirc: 'Ô', middot: '·', sect: '§', para: '¶', dagger: '†', Dagger: '‡', times: '×', pound: '£', shy: '', zwnj: '', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', prime: '′', Prime: '″', szlig: 'ß', cent: '¢', yen: '¥', iexcl: '¡', iquest: '¿', ordm: 'º', ordf: 'ª', sup1: '¹', sup2: '²', sup3: '³', uml: '¨', acute: '´', cedil: '¸', macr: '¯', not: '¬', brvbar: '¦', curren: '¤', divide: '÷', plusmn: '±', micro: 'µ', lsaquo: '‹', rsaquo: '›', bull: '•', sbquo: '‚', bdquo: '„', oline: '‾' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) ? String.fromCodePoint(cp) : m; }
    return e in ENT ? ENT[e] : m;
  });
}
function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const body = tag.replace(/^<\/?[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}
const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'pre', 'tr', 'td', 'th', 'div', 'blockquote', 'table', 'ul', 'ol', 'dl', 'center', 'section', 'article', 'figure', 'figcaption', 'caption']);
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr']);

/** HTML -> flat list of blocks { t: 'p'|'h1'..'h6'|'img'|'hr', text, cls, quote, anchors, toc } */
export function htmlBlocks(html) {
  // Only what stands between the Gutenberg header and footer.
  let s = html;
  const hEnd = s.search(/<\/header>/i);
  const head2 = s.search(/<header[^>]*id="pg-header"/i);
  if (head2 >= 0 && hEnd > head2) s = s.slice(hEnd + '</header>'.length);
  else { const st = s.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/i); if (st >= 0) s = s.slice(s.indexOf('***', st + 3) + 3); }
  const fEnd = s.search(/<footer[^>]*id="pg-footer"/i);
  if (fEnd >= 0) s = s.slice(0, fEnd);
  else { const en = s.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i); if (en >= 0) s = s.slice(0, en); }
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '');

  const blocks = [];
  const stack = []; // { tag, cls, skip }
  let buf = '';
  let anchors = [];
  let linkChars = 0, totalChars = 0;
  let inLink = 0;
  const skipping = () => stack.some((e) => e.skip);
  const curCls = () => stack.map((e) => e.cls).filter(Boolean).join(' ');
  const quoteDepth = () => stack.filter((e) => e.tag === 'blockquote').length;
  const headTag = () => { for (let i = stack.length - 1; i >= 0; i--) if (/^h[1-6]$/.test(stack[i].tag)) return stack[i].tag; return null; };
  const flush = () => {
    const text = tidyInline(buf);
    if (text) {
      const h = headTag();
      blocks.push({ t: h || 'p', text, cls: curCls(), quote: quoteDepth() > 0, anchors, toc: totalChars > 0 && linkChars / totalChars > 0.6 });
      anchors = [];
    }
    buf = ''; linkChars = 0; totalChars = 0;
  };
  const re = /<[^>]+>|[^<]+/g;
  let m;
  while ((m = re.exec(s))) {
    const tok = m[0];
    if (tok[0] !== '<') {
      if (skipping()) continue;
      const txt = decode(tok);
      buf += txt.replace(/[*_]/g, (c) => '\u0000' + c); // literal * and _ kept literal (escaped below)
      const n = txt.replace(/\s+/g, '').length;
      totalChars += n; if (inLink) linkChars += n;
      continue;
    }
    if (tok.startsWith('<!') || tok.startsWith('<?')) continue;
    const close = tok[1] === '/';
    const tag = (tok.match(/^<\/?([a-zA-Z0-9]+)/) || [])[1]?.toLowerCase();
    if (!tag) continue;
    if (close) {
      if (BLOCK.has(tag)) flush();
      if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'var') { if (!skipping()) buf += '\u0001'; }
      else if (tag === 'b' || tag === 'strong') { if (!skipping()) buf += '\u0002'; }
      else if (tag === 'a') inLink = Math.max(0, inLink - 1);
      // pop to the matching element
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const a = attrs(tok);
    const cls = (a.class || '').toLowerCase();
    if (VOID.has(tag) || tok.endsWith('/>')) {
      if (skipping()) continue;
      if (tag === 'br') buf += '\u0004';
      else if (tag === 'img') {
        flush();
        blocks.push({ t: 'img', src: a.src || '', alt: (a.alt || '').replace(/\s+/g, ' ').trim(), title: (a.title || '').trim(), cls: curCls(), anchors });
        anchors = [];
      } else if (tag === 'hr') {
        flush();
        blocks.push({ t: 'hr', cls: cls + ' ' + curCls() });
      }
      continue;
    }
    if (BLOCK.has(tag)) flush();
    const skip = /\bpagenum\b|\bpageno\b|\bpagenumber\b/.test(cls) || /^(pg-)/.test(a.id || '');
    stack.push({ tag, cls, skip });
    if (tag === 'a') { inLink++; if (a.id || a.name) anchors.push(a.id || a.name); if (!a.href) inLink--; if (inLink < 0) inLink = 0; }
    else if (a.id && !skip) anchors.push(a.id);
    if (skipping()) continue;
    if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'var') buf += '\u0001';
    else if (tag === 'b' || tag === 'strong') buf += '\u0002';
  }
  flush();
  return blocks;
}
/** Inline markers -> Beuk's marks, hugging the words; whitespace as a browser shows it. */
function tidyInline(raw) {
  // source line breaks are just whitespace; only <br> (\u0004) breaks a line
  let s = raw.replace(/\s+/g, ' ').replace(/ ?\u0004 ?/g, '\n');
  s = s.split('\n').map((l) => l.trim()).join('\n').trim();
  // italics \u0001...\u0001 pairs, bold \u0002...\u0002 pairs
  const mark = (str, ch, md) => {
    const parts = str.split(ch);
    let out = parts[0];
    for (let i = 1; i < parts.length; i++) out += (i % 2 === 1 ? '\u0010' : '\u0011') + parts[i];
    return out
      .replace(/\u0010(\s*)([^\u0010\u0011]*?)(\s*)\u0011/g, (m1, a1, inner, b1) => (inner.trim() ? a1 + md + inner + md + b1 : a1 + inner + b1))
      .replace(/[\u0010\u0011]/g, '');
  };
  s = mark(s, '\u0002', '**');
  s = mark(s, '\u0001', '*');
  s = s.replace(/\u0000([*_])/g, '$1');
  return s.trim();
}

/* ------------------------------------------------------------- structure */
const ROMAN = /^[ivxlcdm]+$/i;
const CH_RE = /^\s*(?:chapter|chap\.)\s+([0-9]+|[ivxlcdm]+|[a-z]+(?:[- ][a-z]+)?)\s*[.:—–-]*\s*(.*)$/i;
const FRONT_KEEP = /^(author[’']?s\s+preface|preface|introduction|introducing this story|to my readers|to our readers|to the reader|author[’']?s note|a word to the reader|dedication)\b/i;
const SKIP_HEAD = /^(contents|table of contents|list of chapters|list of illustrations|illustrations|transcriber|the famous oz books)/i;
const GUTENBERG = /project gutenberg|gutenberg\.org|gutenberg literary archive|transcriber[’']?s note|produced by|distributed proofread/i;

/** Layout line breaks (text wrapped around a picture) joined; verse kept.
 *  A break is layout when the next line starts in lower case. */
function joinLayoutBreaks(text, cls) {
  if (/poem|verse|stanza|song|poetry/.test(cls || '')) return text.replace(/\n{2,}/g, '\n');
  return text.replace(/\s*\n+\s*/g, ' ');
}
const anchorTitle = (a) => a.replace(/^(chap(ter)?|c)[_-]?\d*[_-]?/i, '').replace(/_/g, ' ').trim();

/** Blocks -> { chapters: [{ title, number, blocks }], front: [...], dropped: [...] }
 *  Gutenberg editions mark chapters many ways; the per-volume options in
 *  sagas.json say which one this edition uses (all read from the source):
 *    chapterAnchor  regex on element ids (heads that are pictures)
 *    chapterHeading regex on heading text
 *    chapterClass   regex on a paragraph's class
 *    titleFrom      'toc' (the source's contents list) | 'imgAlt' | 'anchor'
 *    startAt        text of the first chapter's heading (earlier headings are front matter) */
export function structure(blocks, vol) {
  const dropped = [];
  const live = [];
  const tocLines = [];
  for (const b of blocks) {
    if (b.t === 'img' && /enlarge|view_?image|zoom/i.test(b.src)) { dropped.push({ why: 'edition UI icon', text: b.src }); continue; }
    if (b.t !== 'img' && b.t !== 'hr' && GUTENBERG.test(b.text)) { dropped.push({ why: 'names Project Gutenberg / transcriber', text: b.text.slice(0, 160) }); continue; }
    if (b.t === 'p' && (/^view image$|^\[?enlarge\]?$/i.test(b.text) || (/\bpb\b|\bpageno/.test(b.cls) && /^\[?\d+\]?$/.test(b.text)))) { dropped.push({ why: 'edition page number / image link', text: b.text }); continue; }
    if (b.toc) { tocLines.push(b.text); dropped.push({ why: 'contents-list line (links)', text: b.text.slice(0, 120) }); continue; }
    if (b.t !== 'img' && b.t !== 'hr') b.text = /^h[1-6]$/.test(b.t) ? b.text : joinLayoutBreaks(b.text, b.cls);
    live.push(b);
  }
  const isHead = (b) => /^h[1-6]$/.test(b.t);
  const firstLine = (b) => (b.text || '').split('\n')[0];
  let starts = [];
  if (vol.chapterAnchor) {
    const re = new RegExp(vol.chapterAnchor, 'i');
    live.forEach((b, i) => { if ((b.anchors || []).some((a) => re.test(a))) starts.push(i); });
  } else if (vol.chapterHeading) {
    const re = new RegExp(vol.chapterHeading, 'i');
    live.forEach((b, i) => { if (isHead(b) && re.test(b.text)) starts.push(i); });
  } else if (vol.chapterClass) {
    const re = new RegExp(vol.chapterClass, 'i');
    live.forEach((b, i) => { if (b.t === 'p' && re.test(b.cls)) starts.push(i); });
  } else if (vol.startAt) {
    const at = live.findIndex((b) => isHead(b) && b.text.replace(/\s+/g, ' ').trim().toLowerCase() === vol.startAt.toLowerCase());
    if (at >= 0) live.forEach((b, i) => { if (i >= at && isHead(b) && b.t === live[at].t) starts.push(i); });
  } else {
    // "Chapter N" as a heading, or as the first line of a paragraph.
    live.forEach((b, i) => { if ((b.t === 'p' || isHead(b)) && CH_RE.test(firstLine(b)) && firstLine(b).length <= (isHead(b) ? 400 : 160)) starts.push(i); });
  }
  // A title heading standing just before "CHAPTER N" (past a picture) opens the chapter.
  starts = starts.map((si) => {
    const hm = CH_RE.exec(firstLine(live[si]));
    // only a bare "CHAPTER N" (no title of its own) takes the heading before it
    const after = live.slice(si + 1, si + 4).find((b) => b.t !== 'img' && b.t !== 'hr');
    if (!hm || (after && isHead(after)) || (hm[2] || '').trim() || ((live[si].text.split('\n')[1] || '').trim() && /^h[1-6]$/.test(live[si].t))) return si;
    for (let j = si - 1; j >= Math.max(0, si - 3); j--) {
      const b = live[j];
      if (b.t === 'img' || b.t === 'hr') continue;
      if (isHead(b) && !CH_RE.test(firstLine(b)) && b.text.length <= 120 && !SKIP_HEAD.test(b.text)) return j;
      break;
    }
    return si;
  });
  // Pictures standing between the previous chapter's end and this head belong to this chapter.
  const startSet = new Set(starts);
  const spans = starts.map((si) => { let j = si; while (j > 0 && (live[j - 1].t === 'img' || live[j - 1].t === 'hr') && !startSet.has(j - 1)) j--; return { at: j, head: si }; });
  const tocTitles = [];
  if (vol.titleFrom === 'toc') for (const l of tocLines.concat(live.slice(0, starts[0] || 0).filter((b) => b.text).map((b) => b.text))) for (const x of l.split(/\n|(?=\bchapter\s+[ivxlc\d]+\s*\.?\s*[—–-])/i)) { const m = /chapter\s+[ivxlc\d]+\s*\.?\s*[—–-]+\s*(.+?)\.?$/i.exec(x) || /^\s*\d+\.\s*(.+)$/.exec(x); if (m) tocTitles.push(m[1].trim()); }
  const chapters = [];
  spans.forEach((st, k) => {
    const end = k + 1 < spans.length ? spans[k + 1].at : live.length;
    const head = live[st.head];
    let body = live.slice(st.at, st.head).concat(live.slice(st.head + 1, end));
    let number = '', title = '';
    const lines = head.t === 'img' ? [] : head.text.split('\n');
    const mm = lines.length ? CH_RE.exec(lines[0]) : null;
    if (vol.chapterClass && lines.length) {
      // "THE GLASS CAT / Chap. 4": the title line, then the number line.
      const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
      const tm = /^(.*?)\s*\bchap(?:ter)?\.?\s+([0-9]+|[a-z]+)\s*$/i.exec(joined);
      if (tm) { title = tm[1]; number = tm[2]; } else title = joined;
    } else if (mm) {
      number = mm[1];
      const rest = [mm[2] || ''].concat(lines.slice(1));
      if (!vol.chapterHeadIsProse && (isHead(head) || head.text.length <= 160)) title = rest.join(' ').replace(/^[.:—–-]+\s*/, '').trim();
      else {
        // a paragraph that opens with "CHAPTER 1": the rest is prose; a following paragraph that starts in lower case continues it (the edition split one paragraph around a drop-cap picture)
        const first = { ...head, text: rest.join(' ').replace(/s+/g, ' ').trim() };
        const nxt = body.findIndex((b) => b.t === 'p');
        if (nxt >= 0 && /^[a-z]/.test(body[nxt].text)) { first.text += ' ' + body[nxt].text; body = body.slice(0, nxt).concat(body.slice(nxt + 1)); }
        body = [first].concat(body);
      }
    } else if (head.t !== 'img') {
      title = lines.join(' ');
      const nm = /^(\d+)\.\s*(.*)$/.exec(title);
      if (nm) { number = nm[1]; title = nm[2]; }
    } else body = live.slice(st.at, st.head).concat([head], live.slice(st.head + 1, end));
    // "CHAPTER N" right after a title heading: drop the number line, keep its number
    const nx = body.findIndex((b) => b.t !== 'img' && b.t !== 'hr');
    if (nx >= 0 && CH_RE.test(firstLine(body[nx])) && !number) {
      const m2 = CH_RE.exec(firstLine(body[nx]));
      number = m2[1];
      const rest = [m2[2] || ''].concat(body[nx].text.split('\n').slice(1)).join(' ').trim();
      if (rest && body[nx].text.length > 160) body[nx] = { ...body[nx], text: rest };
      else { if (!title && rest) title = rest; body = body.slice(0, nx).concat(body.slice(nx + 1)); }
    } else if (!title && !vol.chapterHeadIsProse && nx >= 0 && (isHead(body[nx]) || (body[nx].text.length <= 90 && !/[.!?,;:"”’]$/.test(body[nx].text.replace(/\*+$/, ''))))) {
      title = body[nx].text.replace(/\n/g, ' ');
      body = body.slice(0, nx).concat(body.slice(nx + 1));
    }
    if (!title && vol.titleFrom === 'imgAlt') { const im = body.find((b) => b.t === 'img' && b.alt); if (im) title = im.alt; }
    if (!title && vol.titleFrom === 'anchor') { const an = live.slice(st.at, st.head + 1).flatMap((b) => b.anchors || []).find((a) => /[A-Za-z]{3,}_[A-Za-z]/.test(a)); if (an) title = anchorTitle(an); }
    if (vol.titleFrom === 'toc' && tocTitles[k]) title = tocTitles[k];
    title = title.replace(/\*+/g, '').replace(/^contents\s*/i, '').replace(/\s+/g, ' ').replace(/[.]$/, '').trim();
    if (/^(books by|the famous oz books|other books by|the oz books)/i.test(title)) { dropped.push({ why: "publisher's advertisement", text: title }); return; }
    chapters.push({ number: number || String(k + 1), title, blocks: body });
  });
  // Before the first chapter: the author's own front pages (preface,
  // "To My Readers") and pictures; the rest (title page, credits) is
  // the edition's dressing and Beuk makes its own.
  const pre = live.slice(0, spans.length ? spans[0].at : live.length);
  const front = [];
  let cur = null;
  const preImgs = [];
  for (const b of pre) {
    if (isHead(b)) {
      const hx = b.text.replace(/\n/g, ' ').trim();
      if (SKIP_HEAD.test(hx)) { cur = null; dropped.push({ why: 'contents/illustrations list heading', text: hx }); continue; }
      if (FRONT_KEEP.test(hx)) { cur = { title: hx.replace(/[.:]$/, ''), blocks: [] }; front.push(cur); continue; }
      if (cur && cur.blocks.length === 0 && hx.length < 60) { continue; } // a sub-head of a kept page
      cur = null; dropped.push({ why: 'front dressing (title page / credits)', text: hx.slice(0, 120) });
      continue;
    }
    if (b.t === 'img') { (cur ? cur.blocks : front.length ? front[front.length - 1].blocks : preImgs).push(b); continue; }
    if (cur) cur.blocks.push(b);
    else if (b.t !== 'hr') dropped.push({ why: 'front dressing (title page / credits)', text: b.text.slice(0, 120) });
  }
  return { chapters, front, preImgs, dropped, tocCount: tocTitles.length || tocLines.length };
}

/** One volume -> Markdown with frontmatter, plus its picture list. */
export function toMarkdown(vol, html, dir) {
  const blocks = htmlBlocks(html);
  const st = structure(blocks, vol);
  const images = [];
  const seen = new Map();
  const imgLine = (b) => {
    const src = b.src.replace(/^\.\//, '');
    const file = path.join(dir, src);
    const ext = path.extname(src).toLowerCase();
    let id = seen.get(src);
    if (!id) {
      // letters and digits only: the studio's typography pass turns a hyphen between digits into an en dash
      id = ('pg' + vol.ebook + 'x' + path.basename(src, ext).replace(/[^A-Za-z0-9]+/g, '')).slice(0, 60);
      while ([...seen.values()].includes(id)) id += 'b';
      seen.set(src, id);
      const ok = ext === '.jpg' || ext === '.jpeg' || ext === '.png';
      images.push({ id, src, ext, ok, bytes: existsSync(file) ? statSync(file).size : 0, alt: b.alt });
    }
    const alt = (b.alt || b.title || 'Illustration').replace(/[[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const cap = (b.caption || '').replace(/["“”()]/g, '').replace(/\s+/g, ' ').trim();
    placements.push({ id, alt, cap, file: path.basename(src) });
    return `\u0005${placements.length - 1}\u0005`;
  };
  const placements = [];
  // A caption is the short block right after a picture whose class says caption.
  const withCaptions = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.t === 'img') {
        const nx = list[i + 1];
        if (nx && nx.t === 'p' && /caption/.test(nx.cls) && nx.text.length <= 300) { b.caption = nx.text.replace(/\*+/g, '').replace(/\n/g, ' '); i++; }
      }
      out.push(b);
    }
    return out;
  };
  const para = (b) => {
    if (b.t === 'img') return imgLine(b);
    if (b.t === 'hr') return /\btb\b|tbcenter|thought|scene/.test(b.cls) ? '***' : null;
    const lines = b.text.split('\n');
    if (/^h[1-6]$/.test(b.t)) return lines.map((l) => (l ? '**' + l.replace(/\*+/g, '') + '**' : l)).join('\n'); // an in-chapter heading stays as bold text: "## " would split a chapter
    let t = lines.join('\n');
    if (/^\s*(\*\s*){3,}$/.test(t) || /^\s*[*·•]\s*[*·•]\s*[*·•]/.test(t)) return '***';
    if (b.quote) t = t.split('\n').map((l) => '> ' + l).join('\n');
    return t;
  };
  const md = [];
  md.push('---', `title: ${vol.title}`, `author: ${vol.author}`, `series: ${vol.series}`, 'language: en', '---', '');
  if (st.preImgs.length) {
    const target = st.front[0];
    if (target) target.blocks = st.preImgs.concat(target.blocks);
    else st.front.unshift({ title: 'Frontispiece', blocks: st.preImgs });
  }
  for (const f of st.front) {
    md.push('## ' + f.title, '');
    for (const b of withCaptions(f.blocks)) { const p = para(b); if (p) md.push(p, ''); }
  }
  for (const ch of st.chapters) {
    const num = ch.number;
    md.push(`## Chapter ${num}${ch.title ? '. ' + ch.title : ''}`, '');
    for (const b of withCaptions(ch.blocks)) { const p = para(b); if (p) md.push(p, ''); }
  }
  const text = md.join('\n').replace(/\n{3,}/g, '\n\n');
  // Two spellings of the same picture placement: Beuk's own marker with a
  // pre-agreed library id (single-file Import + image library), and a plain
  // Markdown embed of the picture file (Bulk import resolves it from the batch).
  const out = text.replace(/\u0005(\d+)\u0005/g, (m, i) => { const p = placements[+i]; return `![${p.alt}](img:${p.id}${p.cap ? ` "${p.cap}"` : ''})`; });
  const outBulk = text.replace(/\u0005(\d+)\u0005/g, (m, i) => { const p = placements[+i]; return `![${p.alt}](${p.file}${p.cap ? ` "${p.cap}"` : ''})`; });
  const names = new Map();
  for (const im of images) { const b = path.basename(im.src).toLowerCase(); names.set(b, (names.get(b) || 0) + 1); }
  const basenameClashes = [...names].filter(([, n]) => n > 1).map(([b]) => b);
  return { md: out, mdBulk: outBulk, basenameClashes, placements: placements.length, images, tocCount: st.tocCount, chapters: st.chapters.length, chapterTitles: st.chapters.map((c) => c.title), front: st.front.map((f) => f.title), dropped: st.dropped, blocks: blocks.length };
}

function prepAll(only) {
  mkdirSync(PREP_DIR, { recursive: true });
  const report = [];
  for (const v of allVolumes()) {
    if (only && String(v.ebook) !== String(only)) continue;
    const dir = path.join(SRC_DIR, 'pg' + v.ebook);
    const htmlFile = readdirSync(dir).find((f) => /\.html?$/.test(f));
    const html = readFileSync(path.join(dir, htmlFile), 'utf8');
    const r = toMarkdown({ ...v, ...(v.prep || {}) }, html, dir);
    writeFileSync(path.join(PREP_DIR, `pg${v.ebook}.md`), r.md);
    writeFileSync(path.join(PREP_DIR, `pg${v.ebook}.bulk.md`), r.mdBulk);
    writeFileSync(path.join(PREP_DIR, `pg${v.ebook}.images.json`), JSON.stringify(r.images, null, 1));
    if (r.basenameClashes.length) console.log('  basename clashes:', r.basenameClashes.join(', '));
    const gut = (r.md.match(/gutenberg/gi) || []).length;
    const italics = (r.md.match(/(^|[^*])\*[^*\n]+\*(?!\*)/g) || []).length;
    report.push({ ebook: v.ebook, title: v.title, series: v.series, order: v.order, chapters: r.chapters, tocLines: r.tocCount, front: r.front, images: r.images.length, imagesNotJpgPng: r.images.filter((i) => !i.ok).length, mdBytes: Buffer.byteLength(r.md), mdSha256: sha256(r.md), italicSpans: italics, gutenbergMentions: gut, dropped: r.dropped.length, droppedSample: r.dropped.slice(0, 12), firstTitles: r.chapterTitles.slice(0, 3), lastTitle: r.chapterTitles[r.chapterTitles.length - 1] });
    console.log(`${v.ebook} ${v.title.slice(0, 32).padEnd(32)} ch=${r.chapters}/toc${r.tocCount} front=${JSON.stringify(r.front)} img=${r.images.length} it=${italics} gut=${gut} drop=${r.dropped.length} | ${r.chapterTitles.slice(0, 2).join(' | ')} … ${r.chapterTitles[r.chapterTitles.length - 1] || ''}`);
  }
  if (!only) writeFileSync(path.join(PREP_DIR, 'prep-report.json'), JSON.stringify(report, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2];
  if (cmd === 'fetch') await fetchAll();
  else if (cmd === 'prep') prepAll(process.argv[3]);
  else { console.log('usage: gutenberg.mjs fetch|prep [ebook]'); process.exit(2); }
}
