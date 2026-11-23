import { NOTE_DEF_BLOCK_RE, NOTE_DEF_RE, NOTE_KEY, noteIdOf, noteLabelOf, noteMarkShown, noteNumberRe, notesAsShown } from '../book/notes.js';
import { sanitizeHtml } from './sanitize.js';

/**
 * Beta-reader snapshot renderer: the studio's book document (the same
 * JSON the studio stores on the shelf — see serializeBook() in
 * client/index.html) → a frozen, read-only copy for share pages.
 *
 * The studio stores manuscript text in its own plain text format, not
 * HTML: blocks separated by a blank line; "# " / "## " headings;
 * "> " quotes; a line of *** (or ❦ / ⁂) is a scene break;
 * ![alt](img:<id>) or ![alt](img:<id>|full) is a picture; [^n] / [n]
 * are note refs with "[^n]: text" definitions; *em* and **strong**.
 * This is a faithful reading-copy port of contentBlocksToHtml() and
 * inlineMd() from the studio — EVERY piece of text is HTML-escaped
 * before any markup is added, so book text can never become markup —
 * and its output is then run through the allowlist sanitizer as well.
 *
 * Each block element carries data-p = its block index in the section's
 * text (blocks split on blank lines, the same split the studio uses),
 * so a reader comment can be anchored back to its paragraph.
 */

export interface SnapshotSection {
  id: string;
  kind: string;
  type: string;
  label: string;
  html: string;
}

export interface Snapshot {
  v: 1;
  title: string;
  subtitle: string;
  author: string;
  language: string;
  sections: SnapshotSection[];
}

export interface SnapshotImage {
  mediaType: string;
  data: string; // base64
}

/** Section types the reading copy does not carry as pages: the cover
 *  and generated pages (title pages, contents) are replaced by the
 *  reader's own header and chapter navigation. */
const SKIP_TYPES = new Set(['cover', 'toc', 'halftitle', 'titlepage']);

/** Raster types only — an SVG can carry script, so it never ships. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** The structure of the stored text, and no character of it changed: line ends, runs of spaces, a scene-break line,
 *  blank lines. (The name is from when this was the studio's beautifier minus its quote curling.) */
function tidy(text: string): string {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/^[ \t]*([*#]{3,}|-{3,}|_{3,})[ \t]*$/gm, '***');
  /* The owner, 2026-11-22: "We do not change anything from what the writer gives us." This page went on turning
     "..." into an ellipsis and "--" or "---" into a dash after every other surface had stopped (the studio's
     structureText is the same steps with no tidying). The reading copy sets the characters the book stores. */
  s = s.split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

interface NoteCtx {
  prefix: string;
  defined: Set<string>;
  seen: Set<string>;
}

/**
 * A redaction ("||words||", the studio's REDACT_RE): the words never
 * reach the reading copy. Each is set aside before anything reads the
 * text and comes back as a bar of full blocks (U+2588), one per
 * character, the spaces between words kept — the share page allows no
 * style attribute, so the bar's width is in its glyphs.
 */
const REDACT_RE = /\|\|(?=[^|\s])([^|\n]*?[^|\s])\|\|/g;
const REDACT_MARK = /(\d+)/g;

export function redactBlocks(words: string): string {
  return words.trim().split(/\s+/).filter(Boolean).map((w) => '█'.repeat([...w].length)).join(' ');
}

/** Plain text set escaped, each redaction in it as a bar (a caption, a title). */
function barredEsc(text: string): string {
  const bars: string[] = [];
  const s = esc(String(text ?? '').replace(REDACT_RE, (_m, words: string) => {
    bars.push(`<span class="redacted">${redactBlocks(words)}</span>`);
    return `${bars.length - 1}`;
  }));
  return bars.length ? s.replace(REDACT_MARK, (_m, i: string) => bars[Number(i)] ?? '') : s;
}

function inline(text: string, notes: NoteCtx): string {
  const bars: string[] = [];
  let s = String(text ?? '').replace(REDACT_RE, (_m, words: string) => {
    bars.push(`<span class="redacted">${redactBlocks(words)}</span>`);
    return `${bars.length - 1}`;
  });
  s = esc(s);
  /* BEUK:notemarks — a mark under a label that is no number is set aside before the emphasis is read: a note under a
     mark of the writer's ("[^*]", handed on keyed by notesAsShown), whose "*" is the note's mark and never an
     italic's; and a mark no note answers, the writer's text exactly as typed. A number is read after it, as it
     always was. */
  const held: string[] = [];
  if (s.includes('[^')) s = s.replace(/\[(\^(?!\d+\])[^\]\s]+)\]/g, (m, cap: string) => '\uE081' + (held.push(cap.includes(NOTE_KEY) ? cap : m) - 1) + '\uE082');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  /* BEUK:notelabels — the section's text arrives with each label that has a note written as the number it shows
     (notesAsShown). A mark still under a name here is one no note answers: it is no note, and stays the writer's
     text exactly as typed. A number with no note is raised as it always was. */
  const mark = (_m: string, cap: string): string => {
    /* BEUK:notemarks — what a reader sees and the id it makes (a number: itself, both); the text is escaped by now,
       so a mark that is "&", "<", ">" or a quote is read back as its own character to find its note */
    const heldAs = noteLabelOf(cap);
    const n = heldAs.includes('&') ? heldAs.replace(/&(amp|lt|gt|quot);/g, (_e, w: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"' })[w] ?? '') : heldAs;
    const shown = esc(noteMarkShown(n)), id = noteIdOf(n);
    if (notes.defined.has(n)) {
      const idAttr = notes.seen.has(n) ? '' : ` id="${notes.prefix}fnref${id}"`;
      notes.seen.add(n);
      return `<a class="noteref"${idAttr} href="#${notes.prefix}fn${id}"><sup>[${shown}]</sup></a>`;
    }
    return `<sup>[${shown}]</sup>`;
  };
  s = s.replace(noteNumberRe(), mark);
  if (held.length) s = s.replace(/\uE081(\d+)\uE082/g, (m, i: string) => { const h = held[Number(i)] ?? ''; return h.startsWith('[') ? h : mark(m, h); });
  // Shelf references ([label](note:slug)) are styled text, never links.
  s = s.replace(/\[([^\]]+)\]\(note:([a-z0-9-]+)\)/g, '<span class="note-link">$1</span>');
  if (bars.length) s = s.replace(REDACT_MARK, (_m, i: string) => bars[Number(i)] ?? '');
  return s;
}

/* BEUK:breaksshown — a line break the writer made inside a paragraph is stored marked, a backslash straight
   before the newline (client/index.html holds the rule, in contentBlocksToHtml). The reading copy sets it as a
   line break and no backslash; a bare newline is the space it always was. The break rides through inline() as one
   private-use character, so emphasis may run over it. */
const BREAK_MARK = '\\\n';
const BREAK_HELD = String.fromCharCode(0xe070);
const paraLine = (block: string): string =>
  block.indexOf(BREAK_MARK) === -1 ? block.replace(/\n/g, ' ') : block.split(BREAK_MARK).map((part) => part.replace(/\n/g, ' ')).join(BREAK_HELD);
const breaksShown = (html: string): string => (html.indexOf(BREAK_HELD) === -1 ? html : html.split(BREAK_HELD).join('<br>'));

function parseImageLine(line: string): { alt: string; id: string; full: boolean } | null {
  const m = /^!\[([^\]]*)\]\(img:([A-Za-z0-9-]+)(\|full)?\)$/.exec(String(line ?? '').trim());
  return m ? { alt: m[1], id: m[2], full: !!m[3] } : null;
}

interface RenderCtx {
  images: Map<string, SnapshotImage>;
  used: Set<string>;
}

function figure(id: string, alt: string, cls: string, ctx: RenderCtx, caption = ''): string {
  if (!ctx.images.has(id) || !SAFE_ID.test(id)) return '';
  ctx.used.add(id);
  // An alt text is read aloud, so a redaction in it is said as
  // "redacted", never its words; a caption's is set as a bar.
  const saidAlt = String(alt ?? '').replace(REDACT_RE, ' redacted ').replace(/ {2,}/g, ' ').trim();
  let h = `<figure class="${cls}"><img src="beuk-img:${id}" alt="${esc(saidAlt)}">`;
  if (caption.trim()) h += `<figcaption>${barredEsc(caption)}</figcaption>`;
  return h + '</figure>';
}

interface RawSection {
  id: string;
  kind: string;
  type: string;
  title: string;
  subtitle: string;
  number: string;
  content: string;
  included: boolean;
  plateId: string | null;
  plateAlt: string;
  scenes: Array<{ at: number; imageId: string; alt: string; caption: string }>;
}

function sectionBody(sec: RawSection, index: number, ctx: RenderCtx, shown: string): string {
  const text = tidy(shown);
  if (!text) return '';
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const prefix = `s${index}-`;
  const defined = new Set<string>();
  for (const b of blocks) {
    const dm = NOTE_DEF_RE.exec(b);
    if (dm) defined.add(noteLabelOf(dm[1]));
  }
  const notes: NoteCtx = { prefix, defined, seen: new Set() };
  const endnotes: Array<{ n: string; text: string; p: number }> = [];
  const out: string[] = [];
  let breakIdx = 0;
  blocks.forEach((block, p) => {
    if (/^(\*\*\*|❦|⁂)$/.test(block)) {
      const sc = sec.scenes.find((e) => e.at === breakIdx);
      breakIdx++;
      if (sc && sc.alt.trim()) {
        const fig = figure(sc.imageId, sc.alt, 'book-img scene-img', ctx, sc.caption);
        if (fig) out.push(fig);
      }
      out.push(`<div class="scene-break" data-p="${p}">❦</div>`);
      return;
    }
    const note = NOTE_DEF_BLOCK_RE.exec(block);
    if (note) {
      endnotes.push({ n: noteLabelOf(note[1]), text: note[2], p });
      return;
    }
    const lines = block.split('\n');
    if (lines.some((l) => parseImageLine(l))) {
      let buf: string[] = [];
      const flush = () => {
        if (buf.length) out.push(`<p data-p="${p}">${breaksShown(inline(paraLine(buf.join('\n')), notes))}</p>`);
        buf = [];
      };
      for (const l of lines) {
        const tok = parseImageLine(l);
        if (tok) {
          flush();
          const fig = figure(tok.id, tok.alt, tok.full ? 'book-img full-bleed' : 'book-img', ctx);
          if (fig) out.push(fig.replace('<figure ', `<figure data-p="${p}" `));
        } else buf.push(l);
      }
      flush();
      return;
    }
    if (lines.every((l) => l.startsWith('>'))) {
      out.push(
        // BEUK:breaksshown: a quotation's lines are lines already; the mark's backslash on a line another follows is not set
        `<blockquote data-p="${p}">${lines.map((l, k) => inline((k < lines.length - 1 ? l.replace(/\\$/, '') : l).replace(/^>\s?/, ''), notes)).join('<br>')}</blockquote>`,
      );
      return;
    }
    // BEUK:headdepths: a heading inside a section at each depth the book holds ("# " to "##### "). Under the
    // chapter's h2: "# " h3 and "## " h4, as they were, "### " h5 and "#### " h6; a page has no h7, so the fifth
    // depth is an h6 too. Before, a block of three or more "#" was a paragraph with its marks showing.
    const hd = /^#{1,5} /.exec(block);
    if (hd) {
      const tag = 'h' + Math.min(6, hd[0].length + 1);
      out.push(`<${tag} data-p="${p}">${inline(block.slice(hd[0].length), notes)}</${tag}>`);
      return;
    }
    out.push(`<p data-p="${p}">${breaksShown(inline(paraLine(block), notes))}</p>`);
  });
  if (endnotes.length) {
    out.push(
      '<div class="endnotes"><p class="endnotes-h">Notes</p>' +
        endnotes
          .map(
            (nt) =>
              `<p class="endnote" id="${prefix}fn${noteIdOf(nt.n)}" data-p="${nt.p}"><a class="note-back" href="#${prefix}fnref${noteIdOf(nt.n)}"><sup>[${esc(noteMarkShown(nt.n))}]</sup></a> ${inline(nt.text, notes)}</p>`, /* BEUK:notemarks — the writer's mark where a number would stand */
          )
          .join('') +
        '</div>',
    );
  }
  return out.join('\n');
}

function normalizeSections(doc: Record<string, unknown>): RawSection[] {
  let list: unknown[] = [];
  if (Array.isArray(doc.sections)) list = doc.sections;
  else if (doc.sections && typeof doc.sections === 'object') {
    // Older/other shapes: { frontMatter, body, backMatter } arrays.
    const s = doc.sections as Record<string, unknown>;
    const tier = (arr: unknown, kind: string) =>
      (Array.isArray(arr) ? arr : []).map((x) => ({ kind, ...(x as object) }));
    list = [...tier(s.frontMatter, 'front'), ...tier(s.body, 'body'), ...tier(s.backMatter, 'back')];
  }
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((s, i) => {
      const id = str(s.id, 100);
      return {
        id: SAFE_ID.test(id) ? id : `sec-${i}`,
        kind: str(s.kind, 20) || 'body',
        type: str(s.type, 40) || str(s.kind, 40) || 'chapter',
        title: str(s.title, 500),
        subtitle: str(s.subtitle, 500),
        number: str(s.number, 60),
        content: str(s.content, 5_000_000) || str(s.text, 5_000_000),
        included: s.included !== false,
        plateId: typeof s.plateId === 'string' ? s.plateId : null,
        plateAlt: str(s.plateAlt, 1000),
        scenes: Array.isArray(s.scenes)
          ? (s.scenes as Array<Record<string, unknown>>)
              .filter((e) => e && typeof e === 'object')
              .map((e) => ({
                at: Math.floor(Number(e.at)),
                imageId: str(e.imageId, 100),
                alt: str(e.alt, 1000),
                caption: str(e.caption, 1000),
              }))
          : [],
      };
    });
}

function collectImages(doc: Record<string, unknown>): Map<string, SnapshotImage> {
  const map = new Map<string, SnapshotImage>();
  if (!Array.isArray(doc.images)) return map;
  for (const im of doc.images as Array<Record<string, unknown>>) {
    if (!im || typeof im !== 'object') continue;
    const id = str(im.id, 100);
    const mediaType = str(im.mediaType, 40).toLowerCase();
    const data = typeof im.data === 'string' ? im.data : '';
    if (!SAFE_ID.test(id) || !IMAGE_TYPES.has(mediaType) || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 200)))
      continue;
    map.set(id, { mediaType, data: data.replace(/\s+/g, '') });
  }
  return map;
}

/** Render a frozen reading copy of a studio book document. */
export function renderSnapshot(
  docIn: unknown,
  fallbackTitle: string,
): { snapshot: Snapshot; images: Record<string, SnapshotImage> } {
  const doc = (docIn && typeof docIn === 'object' ? docIn : {}) as Record<string, unknown>;
  const meta = (doc.meta && typeof doc.meta === 'object' ? doc.meta : doc) as Record<string, unknown>;
  const ctx: RenderCtx = { images: collectImages(doc), used: new Set() };
  const sections: SnapshotSection[] = [];
  const all = normalizeSections(doc);
  /* BEUK:notelabels — the notes are numbered through the whole book, as the studio numbers them (every section, in order) */
  const shown = notesAsShown(all.map((sec) => sec.content));
  all.forEach((sec, index) => {
    if (!sec.included || SKIP_TYPES.has(sec.type)) return;
    let body = sectionBody(sec, index, ctx, shown[index] ?? sec.content);
    const plate =
      sec.plateId && sec.plateAlt.trim() ? figure(sec.plateId, sec.plateAlt, 'plate', ctx) : '';
    if (!body && !plate) return; // nothing to read
    const heading =
      (sec.number ? `<p class="ch-num">${barredEsc(sec.number)}</p>` : '') +
      (sec.title ? `<h2 class="ch-title">${barredEsc(sec.title)}</h2>` : '') +
      (sec.subtitle ? `<p class="ch-sub">${barredEsc(sec.subtitle)}</p>` : '');
    body = plate + heading + body;
    const label =
      [sec.number, sec.title].filter(Boolean).join(' · ').replace(REDACT_RE, (_m, w: string) => redactBlocks(w)) || sec.type;
    sections.push({
      id: sec.id,
      kind: sec.kind,
      type: sec.type,
      label: label.slice(0, 200),
      // Second gate: the sanitizer keeps only allowlisted markup.
      html: sanitizeHtml(body, { resolveImage: (id) => `beuk-img:${id}` }),
    });
  });
  const images: Record<string, SnapshotImage> = {};
  for (const id of ctx.used) {
    const im = ctx.images.get(id);
    if (im) images[id] = im;
  }
  const title = str(meta.title, 500) || fallbackTitle || 'Untitled';
  return {
    snapshot: {
      v: 1,
      title,
      subtitle: str(meta.subtitle, 500),
      author: str(meta.author, 300),
      language: /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(str(meta.language, 20)) ? str(meta.language, 20) : 'en',
      sections,
    },
    images,
  };
}
