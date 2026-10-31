#!/usr/bin/env node
/* Survey the section-content dialect: every markup construct 1.0's renderer
 * reads, with its count and a few examples, over the fixture books (and every
 * *.beuk-backup.json under BEUK_BOOK_CORPUS when set).
 *
 *   node tools/book-corpus/content-survey.mjs [--json] [--no-legacy]
 *
 * Read-only. The patterns are 1.0's own (client/index.html: contentBlocksToHtml,
 * inlineMd, parseContainers, listItemsOf, parseImageLine, REDACT_RE, mdLinkRe,
 * beautifyText's scene-break rule), applied to the STORED text, which is what
 * the 2.0 converter reads. Counts are occurrences; "blocks" are 1.0's blocks
 * (container marker lines stripped, split on blank lines, trimmed). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'books');
const asJson = process.argv.includes('--json');

function walk(dir, pred, out = []) {
  for (const f of readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(f)) out.push(p);
  }
  return out;
}

/* --no-legacy: the legacy fixtures are copies of real/reads-you.json with one upgrade inverted, so they repeat its
   content 14 times; the ranking in the step-4 report uses this flag. */
const noLegacy = process.argv.includes('--no-legacy');
const files = walk(ROOT, (f) => f.endsWith('.json')).filter((p) => !(noLegacy && p.includes(path.sep + 'legacy' + path.sep)));
if (process.env.BEUK_BOOK_CORPUS) files.push(...walk(process.env.BEUK_BOOK_CORPUS, (f) => f.endsWith('.beuk-backup.json')));

/* ---- 1.0's patterns (client/index.html) ---- */
const CONTAINER_OPEN_RE = /^[ \t]*:::[ \t]+([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+(.*?))?[ \t]*$/;
const CONTAINER_CLOSE_RE = /^[ \t]*:::[ \t]*$/;
const SCENE_BREAK_RE = /^(\*\*\*|❦|⁂)$/; // contentBlocksToHtml emitBlock
const SCENE_BREAK_SRC_RE = /^[ \t]*([*#]{3,}|-{3,}|_{3,}|#)[ \t]*$/; // beautifyText: becomes "***"
const NOTE_DEF_RE = /^\[\^?(\d{1,3})\]:/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(img:([A-Za-z0-9-]+)(\|full)?(?:[ \t]+["“”]([^"“”\n]*)["“”])?\)$/;
const LIST_BULLET = /^[-*•]\s+/;
const LIST_NUMBER = /^(\d{1,3})[.)]\s+/;
const REDACT_RE = /\|\|(?=[^|\s])([^|\n]*?[^|\s])\|\|/g;
const LINK_RE = /(?<!!)\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)\)/gi;
const NOTE_LINK_RE = /\[([^\]]+)\]\(note:([a-z0-9-]+)\)/g;
const STRONG_RE = /\*\*([^*]+)\*\*/g;
const EM_RE = /\*([^*\n]+)\*/g;
const REF_RE = /\[\^(\d{1,3})\]|\[(\d{1,3})\]/g;
const UNDERSCORE_EM_RE = /(^|[^\w_])_([^_\n]+)_(?![\w_])/g; // NOT 1.0: 1.0 never reads _x_ as emphasis
const QUOTE_ATTR_RE = /^>\s?[ \t]*(?:—|―|--)[ \t]+(\S[\s\S]*)$/;

function listItemsOf(lines) { // 1.0's listItemsOf, verbatim logic
  const ordered = LIST_NUMBER.test(lines[0]);
  if (!ordered && !LIST_BULLET.test(lines[0])) return null;
  const mark = ordered ? LIST_NUMBER : LIST_BULLET;
  const items = [];
  for (const l of lines) {
    if (mark.test(l)) items.push(l.replace(mark, ''));
    else if (ordered === false && LIST_NUMBER.test(l)) return null;
    else items[items.length - 1] += ' ' + l.trim();
  }
  if (!ordered && items.length < 2) return null;
  return { ordered, items };
}

const counts = new Map(); // construct -> { n, books:Set, ex:[] }
function hit(name, book, ex) {
  let c = counts.get(name);
  if (!c) counts.set(name, (c = { n: 0, books: new Set(), ex: [] }));
  c.n++;
  c.books.add(book);
  if (ex !== undefined && c.ex.length < 3) {
    const s = String(ex);
    c.ex.push(s.length > 70 ? s.slice(0, 70) + '…' : s);
  }
}
const all = (re, s) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];

let sections = 0, chars = 0, books = 0;
for (const f of files) {
  let env;
  try { env = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const book = env && env.book ? env.book : env;
  let secs = book && book.sections;
  if (secs && !Array.isArray(secs) && typeof secs === 'object') secs = [...(secs.frontMatter || []), ...(secs.body || []), ...(secs.backMatter || [])];
  if (!Array.isArray(secs)) continue;
  books++;
  const name = path.basename(f);
  for (const s of secs) {
    const text = s && typeof s.content === 'string' ? s.content : null;
    if (text === null) continue;
    sections++;
    chars += text.length;
    if (!text) { hit('(empty content)', name); continue; }

    /* whitespace and characters */
    if (text.includes('\r\n')) hit('CRLF line ending', name);
    if (/\r(?!\n)/.test(text)) hit('lone CR', name);
    if (text.includes('\t')) hit('tab', name, JSON.stringify(text.slice(Math.max(0, text.indexOf('\t') - 20), text.indexOf('\t') + 20)));
    for (const m of all(/[ \t]+$/m, text)) hit('trailing space/tab on a line', name, JSON.stringify(m.input.slice(Math.max(0, m.index - 20), m.index + m[0].length)));
    for (const m of all(/^[ \t]+\S/m, text)) hit('line with leading space/tab', name, JSON.stringify(m.input.slice(m.index, m.index + 30)));
    if (/\n$/.test(text)) hit('ends with newline', name);
    if (/^\s/.test(text)) hit('starts with whitespace', name);
    for (const m of all(/\n(?:[ \t]*\n){2,}/, text)) hit('blank-line run of 2+ blank lines', name, JSON.stringify(m[0]));
    for (const m of all(/ /, text)) hit('NBSP', name);
    for (const m of all(/­/, text)) hit('soft hyphen', name);
    for (const m of all(/[\u{10000}-\u{10FFFF}]/u, text)) hit('astral char (emoji etc.)', name, m[0]);
    for (const m of all(/[֐-ࣿ]/, text)) hit('RTL script char', name);
    for (const m of all(/<\/?[a-zA-Z][^>]*>/, text)) hit('HTML-looking tag (plain text in 1.0)', name, m[0]);
    for (const m of all(/\\[*_\[\]#>]/, text)) hit('backslash before markup char (no escapes in 1.0)', name, m[0]);

    /* containers (parseContainers) */
    const lines = text.split('\n');
    let open = null;
    for (const l of lines) {
      const om = l.match(CONTAINER_OPEN_RE);
      if (om) { if (open) hit('container closed by next opener', name, open); open = om[1].toLowerCase(); hit(`container ::: ${open}`, name, l); continue; }
      if (CONTAINER_CLOSE_RE.test(l)) { if (open) open = null; else hit('stray container close', name); }
    }
    if (open) hit('container unclosed at end', name, open);

    /* blocks, the way contentBlocksToHtml splits them (on the stored text) */
    const stripped = lines.filter((l) => !CONTAINER_OPEN_RE.test(l) && !CONTAINER_CLOSE_RE.test(l)).join('\n');
    const blocks = stripped.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    for (const b of blocks) {
      hit('(block)', name);
      const bl = b.split('\n');
      if (SCENE_BREAK_RE.test(b)) { hit('scene break (*** ❦ ⁂)', name, b); continue; }
      if (bl.length === 1 && SCENE_BREAK_SRC_RE.test(b)) { hit('scene break, other source form (### --- ___ #)', name, b); continue; }
      if (NOTE_DEF_RE.test(b)) { hit('footnote definition block', name, b); if (bl.length > 1) hit('footnote definition, multi-line block', name, b); continue; }
      if (IMAGE_LINE_RE.test(b)) { hit('image line', name, b); continue; }
      if (bl.some((l) => IMAGE_LINE_RE.test(l.trim()))) { hit('image line sharing a block with text', name, b); continue; }
      const list = listItemsOf(bl);
      if (list) { hit(list.ordered ? 'numbered list' : 'bulleted list', name, b); if (list.items.length !== bl.length) hit('list item continued on next line', name, b); continue; }
      if (bl.every((l) => l.startsWith('>'))) {
        hit('quote (> lines)', name, b);
        if (bl.length > 1) hit('quote, multi-line', name, b);
        if (bl.length >= 2 && QUOTE_ATTR_RE.test(bl[bl.length - 1])) hit('quote attribution (> — Name)', name, bl[bl.length - 1]);
        continue;
      }
      if (b.startsWith('## ')) { hit('heading ## (h3)', name, b); continue; }
      if (b.startsWith('# ')) { hit('heading # (h2)', name, b); continue; }
      if (/^#{3,}\s/.test(b)) hit('### heading (plain paragraph in 1.0)', name, b);
      hit('paragraph', name);
      if (bl.length > 1) hit('paragraph with line breaks', name, b);
    }

    /* inline (inlineMd order: redaction, link, strong, em, refs, note links) */
    for (const m of all(REDACT_RE, text)) hit('redaction ||x||', name, m[0]);
    for (const m of all(LINK_RE, text)) hit('link [x](https:|mailto:)', name, m[0]);
    for (const m of all(NOTE_LINK_RE, text)) hit('note link [x](note:slug)', name, m[0]);
    for (const m of all(STRONG_RE, text)) hit('strong **x**', name, m[0]);
    const noStrong = text.replace(STRONG_RE, (m, a) => '\u0001' + a + '\u0001');
    for (const m of all(EM_RE, noStrong)) { hit('em *x*', name, m[0]); if (m[1].includes('\u0001')) hit('em containing strong', name, m[0]); if (/\[\^?\d{1,3}\]/.test(m[1])) hit('footnote ref inside emphasis', name, m[0]); }
    for (const m of all(/\*([^*]*\n[^*]*)\*/, noStrong)) if (!m[1].includes('\n\n') && m[1].length < 400) hit('em candidate spanning a line break', name, m[0]);
    for (const m of all(/\*\*\*[^*\n]+\*\*\*/, text)) hit('***bold italic***', name, m[0]);
    for (const m of all(REF_RE, text)) hit(m[1] ? 'footnote ref [^n]' : 'bare ref [n] (superscript in 1.0)', name, m[0]);
    for (const m of all(UNDERSCORE_EM_RE, text)) hit('_x_ (NOT emphasis in 1.0)', name, m[0]);
    const leftover = noStrong.replace(EM_RE, '');
    if (/\*/.test(leftover.replace(/^[ \t]*[-*•]\s/gm, '').replace(/^\s*(\*\*\*)\s*$/gm, ''))) hit('unbalanced * left after emphasis', name, leftover.slice(Math.max(0, leftover.search(/\*/) - 20), leftover.search(/\*/) + 20));
  }
}

const rows = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
  .map(([k, v]) => ({ construct: k, count: v.n, books: v.books.size, examples: v.ex }));
if (asJson) {
  console.log(JSON.stringify({ books, sections, chars, rows }, null, 2));
} else {
  console.log(`books ${books}, sections ${sections}, characters ${chars}`);
  for (const r of rows) console.log(`${String(r.count).padStart(8)}  ${String(r.books).padStart(3)} bk  ${r.construct}${r.examples.length ? '   e.g. ' + r.examples.map((e) => JSON.stringify(e)).join(' | ') : ''}`);
}
