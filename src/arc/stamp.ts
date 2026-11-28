import { Writable } from 'node:stream';
import { ZipWriter } from '../account/zip.js';
import { StrictDomParser } from '../book/epub/sandbox.js';
import { dirOf, readZip, resolvePath, type ZipEntry } from '../housekeeping/packages.js';
import { scanTags } from '../housekeeping/xml.js';
import { arcPlaceholderRe, arcT, type ArcLang } from './strings.js';

/**
 * ARC campaigns: the stamp. One reader's copy of a book, made from the
 * one unstamped EPUB a campaign version keeps — EPUB bytes in, stamped
 * EPUB bytes out, nothing stored.
 *
 * What changes (spec "Stamped EPUB"; plan Global Constraints, V's line
 * verbatim):
 *  - one visible line, "Advance Review Copy prepared for [Name] ([Email])",
 *    right after the <body> tag of the first spine document whose body is
 *    epub:type="copyright-page"; a book with none gets a one-line page
 *    (Text/arc-copy.xhtml) right after its title page in the spine, or
 *    first in the spine when it has no title page either;
 *  - the OPF: a declared `beuk:` prefix on <package> and
 *    <meta property="beuk:arc-recipient">{publicId}</meta> last in
 *    <metadata>; for an added page, one manifest item and one itemref.
 * Nothing else: no watermark, no other entry touched. The nav document
 * and the NCX are left as they are (a spine item need not be listed in
 * either), and so is dcterms:modified.
 *
 * The line is English in every language in slice 1 (controller ruling
 * F16), so `stamp.lang` does not choose its words; it is kept on the
 * interface for when signed translations exist.
 *
 * The name and email are text: XML-escaped and each wrapped in <bdi>, so
 * markup stays visible as characters and a bidi control (U+202E) cannot
 * reorder the rest of the line. A character XML 1.0 cannot carry at all
 * is refused (StampError), never dropped or replaced.
 *
 * Re-zipped with the repo's own writer (src/account/zip.ts) in the
 * original entry order: `mimetype` first and stored; XHTML/OPF/NCX/CSS/
 * XML deflated; every other entry keeps its method (ruling F18 —
 * "unchanged" means the same decompressed bytes; readZip inflates and
 * the writer re-encodes, so compressed bytes and timestamps differ).
 */

export interface ArcStamp {
  name: string;
  email: string;
  publicId: string;
  lang: ArcLang;
}

export const ARC_OPF_PREFIX = 'beuk: https://beuk.studio/ns/arc#';
export const ARC_META_PROPERTY = 'beuk:arc-recipient';

/** The stamp cannot be made from these inputs (bad id, not an EPUB, a
 *  package this stamp does not understand, an already stamped copy). */
export class StampError extends Error {}

const PUBLIC_ID = /^[A-Za-z0-9_-]{8,64}$/;
const STAMP_CLASS = 'beuk-arc-stamp';
const ADDED_ID = 'arc-copy';
const ADDED_HREF = 'Text/arc-copy.xhtml';
const XHTML = 'application/xhtml+xml';
/** Anything outside XML 1.0's Char production (https://www.w3.org/TR/xml/#charsets). */
const NOT_XML_CHAR = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;
const DEFLATED = /\.(xhtml|opf|ncx|css|xml)$/i;
const BCP47ISH = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

const escXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unescXml = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, ent: string) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });

/* ---------------- a positioned tag scan ---------------- */

interface Tag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
  raw: string;
}

/* The same tag grammar as src/housekeeping/xml.ts scanTags, with
   offsets; tags inside comments and CDATA sections are not tags. */
const TAG_RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const OPAQUE_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

function tagsOf(xml: string): Tag[] {
  const opaque: [number, number][] = [];
  for (const m of xml.matchAll(OPAQUE_RE)) opaque.push([m.index, m.index + m[0].length]);
  const tags: Tag[] = [];
  for (const m of xml.matchAll(TAG_RE)) {
    const start = m.index;
    if (opaque.some(([a, b]) => start >= a && start < b)) continue;
    const raw = m[0];
    tags.push({
      name: m[2]!,
      attrs: scanTags(raw)[0]?.attrs ?? {},
      closing: m[1] === '/',
      selfClosing: m[4] === '/',
      start,
      end: start + raw.length,
      raw,
    });
  }
  return tags;
}

type Edit = { start: number; end: number; text: string };
function applyEdits(src: string, edits: Edit[]): string {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/* ---------------- the line ---------------- */

function checkStamp(stamp: ArcStamp): void {
  if (!stamp || typeof stamp.publicId !== 'string' || !PUBLIC_ID.test(stamp.publicId)) {
    throw new StampError('the recipient id must be 8-64 letters, digits, "_" or "-"');
  }
  for (const field of ['name', 'email'] as const) {
    const v = stamp[field];
    if (typeof v !== 'string' || !v.trim()) throw new StampError(`the reader's ${field} is empty`);
    if (NOT_XML_CHAR.test(v)) throw new StampError(`the reader's ${field} holds a character an EPUB cannot carry`);
  }
}

/** The stamp paragraph: the English line (F16) with the literal parts
 *  escaped and the name and the email each escaped inside <bdi>. */
function stampParagraph(stamp: ArcStamp): string {
  const template = arcT('en')('arc.stamp');
  const values: Record<string, string> = { name: stamp.name, email: stamp.email };
  const seen: Record<string, number> = { name: 0, email: 0 };
  let html = '';
  let last = 0;
  for (const m of template.matchAll(arcPlaceholderRe())) {
    const key = m[1]!;
    if (!(key in values)) throw new Error(`arc.stamp names an unknown placeholder {${key}}`);
    seen[key]! += 1;
    html += escXml(template.slice(last, m.index)) + '<bdi>' + escXml(values[key]!) + '</bdi>';
    last = m.index + m[0].length;
  }
  html += escXml(template.slice(last));
  if (seen.name !== 1 || seen.email !== 1) throw new Error('arc.stamp must name {name} and {email} once each');
  /* lang/dir: the line is English whatever the book's language (F16),
     and says so to reading systems and screen readers. */
  return `<p class="${STAMP_CLASS}" lang="en" xml:lang="en" dir="ltr" style="font-weight:bold;margin:0 0 1em 0">${html}</p>`;
}

/* ---------------- XHTML ---------------- */

function bodyTag(xhtml: string): Tag | undefined {
  return tagsOf(xhtml).find((t) => t.name === 'body' && !t.closing);
}

function bodyHasType(xhtml: string, type: string): boolean {
  const body = bodyTag(xhtml);
  return Boolean(body && (unescXml(body.attrs['epub:type'] ?? '')).split(/\s+/).includes(type));
}

function insertAfterBody(xhtml: string, para: string): string {
  const body = bodyTag(xhtml);
  if (!body) throw new StampError('the copyright page has no <body>');
  if (body.selfClosing) {
    const open = body.raw.replace(/\s*\/>$/, '>');
    return applyEdits(xhtml, [{ start: body.start, end: body.end, text: `${open}\n${para}\n</body>` }]);
  }
  return applyEdits(xhtml, [{ start: body.end, end: body.end, text: `\n${para}` }]);
}

function addedPage(lang: string, dir: string, cssHref: string | null, para: string): string {
  const title = escXml(arcT('en')('arc.stampPage.title'));
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escXml(lang)}" xml:lang="${escXml(lang)}"${dir}>\n` +
    `<head><title>${title}</title>${cssHref ? `<link rel="stylesheet" type="text/css" href="${escXml(cssHref)}"/>` : ''}</head>\n` +
    `<body>\n${para}\n</body>\n</html>`;
}

/** Strict parse (the browser-strict xmldom stand-in the EPUB build uses). */
function parsesStrictly(src: string, mime: string): boolean {
  try {
    new StrictDomParser().parseFromString(src, mime);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- the package ---------------- */

function prefixedPackageTag(raw: string): string {
  const m = /(\sprefix\s*=\s*)(["'])([\s\S]*?)\2/.exec(raw);
  if (!m) return raw.replace(/\s*>$/, ` prefix="${ARC_OPF_PREFIX}">`);
  const value = m[3]!;
  for (const map of unescXml(value).matchAll(/([A-Za-z_][\w.-]*):\s+(\S+)/g)) {
    if (map[1] !== 'beuk') continue;
    if (`beuk: ${map[2]}` === ARC_OPF_PREFIX) return raw;
    throw new StampError(`the package already maps the prefix "beuk" to ${map[2]}`);
  }
  const next = value.trim() ? `${value.replace(/\s+$/, '')} ${ARC_OPF_PREFIX}` : ARC_OPF_PREFIX;
  return raw.slice(0, m.index) + m[1] + m[2] + next + m[2] + raw.slice(m.index + m[0].length);
}

/**
 * Stamp one reader's copy. Throws StampError when the id is malformed,
 * the bytes are not an EPUB this can read, or the copy is already
 * stamped.
 */
export async function stampEpub(epub: Buffer, stamp: ArcStamp): Promise<Buffer> {
  checkStamp(stamp);

  let entries: ZipEntry[];
  try {
    entries = readZip(epub);
  } catch (err) {
    throw new StampError(`not an EPUB: ${(err as Error).message}`);
  }
  const first = entries[0];
  if (!first || first.name !== 'mimetype' || first.data.toString('utf8').trim() !== 'application/epub+zip') {
    throw new StampError('not an EPUB: the first entry is not the EPUB mimetype');
  }
  const byName = new Map<string, ZipEntry>();
  for (const e of entries) {
    if (byName.has(e.name)) throw new StampError(`not an EPUB this can stamp: ${e.name} appears twice`);
    byName.set(e.name, e);
  }
  const utf8 = (name: string): string => byName.get(name)!.data.toString('utf8');

  /* 1. container → OPF; the spine's content documents, in order. */
  const container = byName.get('META-INF/container.xml');
  const rootfile = container ? tagsOf(container.data.toString('utf8')).find((t) => t.name === 'rootfile' && !t.closing) : undefined;
  const opfPath = rootfile?.attrs['full-path'] ? unescXml(rootfile.attrs['full-path']) : '';
  if (!opfPath || !byName.has(opfPath)) throw new StampError('not an EPUB: META-INF/container.xml names no package document');
  const opfDir = dirOf(opfPath);
  const opfText = utf8(opfPath);
  if (opfText.includes(ARC_META_PROPERTY)) throw new StampError('this copy is already stamped');

  const tags = tagsOf(opfText);
  const pkg = tags.find((t) => t.name === 'package' && !t.closing);
  const metadataEnd = tags.find((t) => t.name === 'metadata' && t.closing);
  const manifestOpen = tags.find((t) => t.name === 'manifest' && !t.closing);
  const manifestEnd = tags.find((t) => t.name === 'manifest' && t.closing);
  const spineOpen = tags.find((t) => t.name === 'spine' && !t.closing);
  const spineEnd = tags.find((t) => t.name === 'spine' && t.closing);
  if (!pkg || !metadataEnd || !manifestOpen || !manifestEnd || !spineOpen || !spineEnd || spineOpen.selfClosing) {
    throw new StampError('the package document has no <package>, <metadata>, <manifest> or <spine> this stamp can read');
  }
  const items = new Map<string, { href: string; mediaType: string }>();
  for (const t of tags) {
    if (t.name !== 'item' || t.closing || t.start < manifestOpen.end || t.start > manifestEnd.start) continue;
    if (t.attrs.id) items.set(unescXml(t.attrs.id), { href: unescXml(t.attrs.href ?? ''), mediaType: unescXml(t.attrs['media-type'] ?? '') });
  }
  const itemrefs = tags.filter((t) => t.name === 'itemref' && !t.closing && t.start > spineOpen.end && t.start < spineEnd.start);
  const spineDocs = itemrefs.flatMap((ref) => {
    const item = items.get(unescXml(ref.attrs.idref ?? ''));
    if (!item || item.mediaType !== XHTML) return [];
    const path = resolvePath(opfDir, item.href).path;
    return byName.has(path) ? [{ ref, path, text: utf8(path) }] : [];
  });
  if (spineDocs.some((d) => d.text.includes(`class="${STAMP_CLASS}"`))) throw new StampError('this copy is already stamped');

  /* 2. The line. */
  const para = stampParagraph(stamp);
  const changed = new Map<string, Buffer>();
  const opfEdits: Edit[] = [];
  let added: { name: string; data: Buffer } | null = null;

  /* 3. The first copyright page, else an added page. */
  const copyright = spineDocs.find((d) => bodyHasType(d.text, 'copyright-page'));
  if (copyright) {
    const stamped = insertAfterBody(copyright.text, para);
    if (parsesStrictly(copyright.text, XHTML) && !parsesStrictly(stamped, XHTML)) {
      throw new StampError(`stamping ${copyright.path} would break it`);
    }
    changed.set(copyright.path, Buffer.from(stamped, 'utf8'));
  } else {
    const addedPath = resolvePath(opfDir, ADDED_HREF).path;
    if (byName.has(addedPath) || items.has(ADDED_ID)) throw new StampError('this copy already has an Advance Review Copy page');
    const langMatch = /<dc:language(?:\s[^>]*)?>([\s\S]*?)<\/dc:language>/.exec(opfText);
    const bookLang = langMatch ? unescXml(langMatch[1]!).trim() : '';
    const lang = BCP47ISH.test(bookLang) ? bookLang : 'en';
    /* The studio gives an RTL book's pages dir="rtl" exactly when its
       spine says page-progression-direction="rtl" (both isRtlLang). */
    const dir = spineOpen.attrs['page-progression-direction'] === 'rtl' ? ' dir="rtl"' : '';
    const cssPath = resolvePath(opfDir, 'Styles/blitz.css').path;
    const page = addedPage(lang, dir, byName.has(cssPath) ? '../Styles/blitz.css' : null, para);
    if (!parsesStrictly(page, XHTML)) throw new StampError('the Advance Review Copy page would not parse');
    added = { name: addedPath, data: Buffer.from(page, 'utf8') };
    opfEdits.push({
      start: manifestEnd.start,
      end: manifestEnd.start,
      text: `  <item id="${ADDED_ID}" href="${ADDED_HREF}" media-type="${XHTML}"/>\n  `,
    });
    const title = spineDocs.find((d) => bodyHasType(d.text, 'titlepage'));
    const itemref = `<itemref idref="${ADDED_ID}"/>`;
    if (title) {
      const after = title.ref.selfClosing
        ? title.ref.end
        : (tags.find((t) => t.name === 'itemref' && t.closing && t.start >= title.ref.end)?.end ?? title.ref.end);
      opfEdits.push({ start: after, end: after, text: `\n    ${itemref}` });
    } else if (itemrefs[0]) {
      opfEdits.push({ start: itemrefs[0].start, end: itemrefs[0].start, text: `${itemref}\n    ` });
    } else {
      opfEdits.push({ start: spineOpen.end, end: spineOpen.end, text: `\n    ${itemref}` });
    }
  }

  /* 4. The OPF: the prefix and the recipient id. */
  opfEdits.push({ start: pkg.start, end: pkg.end, text: prefixedPackageTag(pkg.raw) });
  opfEdits.push({
    start: metadataEnd.start,
    end: metadataEnd.start,
    text: `  <meta property="${ARC_META_PROPERTY}">${escXml(stamp.publicId)}</meta>\n  `,
  });
  const opfOut = applyEdits(opfText, opfEdits);
  if (parsesStrictly(opfText, 'application/xml') && !parsesStrictly(opfOut, 'application/xml')) {
    throw new StampError('stamping the package document would break it');
  }
  changed.set(opfPath, Buffer.from(opfOut, 'utf8'));

  /* 5. Re-zip, in the original order. */
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk);
      done();
    },
  });
  const zip = new ZipWriter(sink);
  try {
    for (const e of entries) {
      const compress = e.name === 'mimetype' ? false : DEFLATED.test(e.name) ? true : e.method === 8;
      await zip.add(e.name, changed.get(e.name) ?? e.data, { compress });
    }
    if (added) await zip.add(added.name, added.data, { compress: true });
    await zip.finish();
  } catch (err) {
    throw new StampError(`the stamped copy could not be written: ${(err as Error).message}`);
  }
  return Buffer.concat(chunks);
}
