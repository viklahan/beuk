/* The text formats of a shape: .txt, .md and .rtf, written the way a
   writer's own files look (a title page of plain lines, headings on their
   own line, paragraphs apart by a blank line). \n line ends, one final
   newline, no clock: the same shape always gives the same bytes. */
import { fillerParagraphs } from './filler.js';
import type { Block, Shape } from './shape.js';

/** The blocks with every filler expanded into its paragraphs. */
export function expandBlocks(blocks: Block[]): Exclude<Block, { t: 'filler' }>[] {
  return blocks.flatMap((b) => (b.t === 'filler' ? fillerParagraphs(b.seed, b.words).map((text) => ({ t: 'para' as const, text })) : [b]));
}

const headingLines = (b: Extract<Block, { t: 'heading' }>) => (b.lines ?? [b.text]).map((l) => (b.caps ? l.toUpperCase() : l));

/* Blocks as plain-text chunks; a space break is an empty chunk, which the
   join turns into the extra blank lines. */
function plainChunks(s: Shape, md: boolean): string[] {
  const out: string[] = [];
  for (const b of expandBlocks(s.blocks)) {
    if (b.t === 'title' || b.t === 'byline' || b.t === 'series' || b.t === 'para') out.push(b.text);
    else if (b.t === 'contents') out.push(['Contents', ...b.entries].join('\n'));
    else if (b.t === 'break') out.push(b.marker === 'space' ? '\u0000' : b.marker);
    else if (b.t === 'heading') {
      const [first, ...rest] = headingLines(b);
      const head = !md ? first
        : b.setext ? first + '\n' + (b.level === 1 ? '=' : '-').repeat(first.length)
        : '#'.repeat(b.level) + ' ' + first;
      out.push([head, ...rest].join('\n'));
    }
  }
  return out;
}

const joinChunks = (chunks: string[]) => chunks.join('\n\n').replace(/\n\n\u0000\n\n/g, '\n\n\n\n') + '\n';

export function renderTxt(s: Shape): Buffer {
  const chunks = plainChunks(s, false);
  // the title page stands apart: title and byline on consecutive lines
  return Buffer.from(joinChunks(mergeTitlePage(s, chunks)), 'utf8');
}

function mergeTitlePage(s: Shape, chunks: string[]): string[] {
  let n = 0;
  for (const b of s.blocks) { if (b.t === 'title' || b.t === 'byline' || b.t === 'series') n++; else break; }
  return n > 1 ? [chunks.slice(0, n).join('\n'), ...chunks.slice(n)] : chunks;
}

export function renderMd(s: Shape): Buffer {
  const title = s.blocks.find((b) => b.t === 'title');
  const byline = s.blocks.find((b) => b.t === 'byline');
  const fm = title || byline
    ? ['---', ...(title ? ['title: ' + title.text] : []), ...(byline ? ['author: ' + byline.text.replace(/^by\s+/i, '')] : []), '---'].join('\n') + '\n\n'
    : '';
  // front matter carries the title and author; the series lines stay as the title page's own lines
  const rest = plainChunks({ ...s, blocks: s.blocks.filter((b) => b.t !== 'title' && b.t !== 'byline') }, true);
  return Buffer.from(fm + joinChunks(rest), 'utf8');
}

function rtfEscape(t: string): string {
  let out = '';
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (c < 0x80) out += ch;
    else if (c <= 0xffff) out += '\\u' + (c > 0x7fff ? c - 0x10000 : c) + '?';
    else { const hi = 0xd800 + ((c - 0x10000) >> 10), lo = 0xdc00 + ((c - 0x10000) & 0x3ff); out += '\\u' + (hi - 0x10000) + '?\\u' + (lo - 0x10000) + '?'; }
  }
  return out;
}

export function renderRtf(s: Shape): Buffer {
  const pars: string[] = [];
  const par = (fmt: string, text: string) => pars.push('{\\pard' + fmt + ' ' + text + '\\par}');
  for (const b of expandBlocks(s.blocks)) {
    if (b.t === 'title') par('\\qc\\b\\fs48', rtfEscape(b.text));
    else if (b.t === 'byline') par('\\qc\\fs28', rtfEscape(b.text));
    else if (b.t === 'series') par('\\qc\\i\\fs24', rtfEscape(b.text));
    else if (b.t === 'para') par('\\fs24', rtfEscape(b.text));
    else if (b.t === 'contents') { par('\\qc\\b\\fs28', 'Contents'); b.entries.forEach((e) => par('\\fs24', rtfEscape(e))); }
    else if (b.t === 'break') { if (b.marker === 'space') { par('\\fs24', ''); par('\\fs24', ''); } else par('\\qc\\fs24', rtfEscape(b.marker)); }
    else if (b.t === 'heading') {
      if (b.kicker) par('\\qc\\fs22', rtfEscape(b.kicker));
      par('\\b\\fs' + (b.level === 1 ? 36 : 28), headingLines(b).map(rtfEscape).join('\\line '));
    }
  }
  return Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}\n' + pars.join('\n') + '\n}\n', 'latin1');
}

/** A title set in spaced capitals, as a PDF's text layer hands it over: T H E  S A L T  R O A D. */
export const spacedCaps = (t: string) => t.toUpperCase().split(/\s+/).map((w) => [...w].join(' ')).join('  ');
