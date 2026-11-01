/* The import-shapes comparator: does a book the 1.0 studio saved match the
   structure a shape says it should import as? Pure — no browser, no I/O.
   The first difference comes back in plain words.

   What is compared (spec, "Comparison"):
   - every body section, in order; a front/back section when the import
     filled it (non-empty content) or the record names it — every import
     starts from buildEmptyBook()'s scaffold, whose empty front/back
     sections are the studio's, not the manuscript's;
   - per section only the fields the record carries; titles trimmed and
     case-folded, "" meaning the stored title must be empty;
   - the book's title and author; the series line in series or subtitle;
   - mustNotAppear in every section's title and text. */
import type { Expected, ExpectedSection } from './shape.js';

export type Book10 = {
  meta: Record<string, unknown>;
  sections: { kind: string; type: string; title: string; number: string; content: string }[];
};
type Sec = Book10['sections'][number];

const fold = (s: unknown) => (typeof s === 'string' ? s : '').trim().toLowerCase();

/** Scene breaks as 1.0 renders them: a whole block of ***, ❦ or ⁂. */
export function countBreaks(content: string): number {
  return content.split(/\n\s*\n/).filter((b) => /^(\*\*\*|❦|⁂)$/.test(b.trim())).length;
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function roman(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] ?? 0;
    n += v < next ? -v : v;
  }
  return n >= 1 && n <= 100 ? n : NaN;
}

/** A stored chapter number as an integer: digits, Roman I–C, English words to ninety-nine; "" is none. */
export function readNumber(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\.$/, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (/^[ivxlc]+$/.test(t)) return roman(t);
  const parts = t.split(/[-\s]+/);
  if (parts.length === 1) {
    const u = UNITS.indexOf(parts[0]);
    if (u > 0) return u;
    const ten = TENS.indexOf(parts[0]);
    return ten >= 2 ? ten * 10 : NaN;
  }
  if (parts.length === 2) {
    const ten = TENS.indexOf(parts[0]), u = UNITS.indexOf(parts[1]);
    if (ten >= 2 && u >= 1 && u <= 9) return ten * 10 + u;
  }
  return NaN;
}

const names = (e: ExpectedSection, s: Sec) =>
  e.kind === s.kind && (e.type !== undefined ? e.type === s.type : e.title !== undefined ? fold(e.title) === fold(s.title) : false);

const label = (s: Sec, i: number) => `section ${i + 1} (${s.kind} ${s.type} "${s.title}")`;

export function compareBook(expected: Expected, book: Book10): { ok: boolean; diff: string | null } {
  const fail = (diff: string) => ({ ok: false, diff });
  const m = expected.meta;
  if (m?.title !== undefined && fold(m.title) !== fold(book.meta.title)) return fail(`book title "${book.meta.title ?? ''}", expected "${m.title}"`);
  if (m?.author !== undefined && fold(m.author) !== fold(book.meta.author)) return fail(`book author "${book.meta.author ?? ''}", expected "${m.author}"`);
  if (m?.seriesLine !== undefined && fold(m.seriesLine) !== fold(book.meta.series) && fold(m.seriesLine) !== fold(book.meta.subtitle))
    return fail(`series line "${m.seriesLine}" is in neither series ("${book.meta.series ?? ''}") nor subtitle ("${book.meta.subtitle ?? ''}")`);

  const compared = book.sections.filter((s) => s.kind === 'body' || (s.content ?? '').trim() !== '' || expected.sections.some((e) => names(e, s)));
  const want = expected.sections;
  for (let i = 0; i < Math.max(want.length, compared.length); i++) {
    const e = want[i], s = compared[i];
    if (!e) return fail(`extra ${label(s, i)}, not in the expected structure`);
    if (!s) return fail(`missing section ${i + 1}: expected ${e.kind}${e.type ? ' ' + e.type : ''}${e.title !== undefined ? ` "${e.title}"` : ''}`);
    if (e.kind !== s.kind) return fail(`${label(s, i)}: kind ${s.kind}, expected ${e.kind}`);
    if (e.type !== undefined && e.type !== s.type) return fail(`${label(s, i)}: type ${s.type}, expected ${e.type}`);
    if (e.number !== undefined && readNumber(s.number ?? '') !== e.number) return fail(`${label(s, i)}: number "${s.number}", expected ${e.number === null ? 'none' : e.number}`);
    if (e.title !== undefined && fold(e.title) !== fold(s.title)) return fail(`${label(s, i)}: title "${s.title}", expected ${e.title === '' ? '"" (untitled)' : `"${e.title}"`}`);
    if (e.breaks !== undefined && countBreaks(s.content ?? '') !== e.breaks) return fail(`${label(s, i)}: ${countBreaks(s.content ?? '')} scene breaks, expected ${e.breaks}`);
  }
  for (const needle of expected.mustNotAppear ?? []) {
    const n = needle.toLowerCase();
    const hit = book.sections.findIndex((s) => fold(s.title).includes(n) || (s.content ?? '').toLowerCase().includes(n));
    if (hit >= 0) return fail(`"${needle}" must not appear, found in ${label(book.sections[hit], hit)}`);
  }
  return { ok: true, diff: null };
}
