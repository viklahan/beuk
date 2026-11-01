/* The box set cell (V, 2026-10-31): three grid files made into one 1.0
   box set — the first imported as Book One, the others added with Add a
   Book — and the combined EPUB's contents checked. 1.0 nests each book's
   sections under the book as a part (boxset.toc.combined-parts): each
   book's chapters must be exactly its own, in order, under its own
   title. */
import { inflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import type { Expected } from './shape.js';

export const BOXSET_CELL = { volumes: ['clean-numbered.docx', 'dropcap.pdf', 'note-and-contents.rtf'] } as const;

const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const XHTML = 'http://www.w3.org/1999/xhtml';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;
const kids = (el: El, name: string): El[] => Array.from(el.childNodes as ArrayLike<El>).filter((n) => n.nodeType === 1 && n.localName === name);

export function compareBoxSetNav(navXhtml: string, volumes: Expected[]): { ok: boolean; diff: string | null } {
  const fail = (diff: string) => ({ ok: false, diff });
  const doc = new DOMParser().parseFromString(navXhtml, 'application/xhtml+xml');
  const toc = Array.from(doc.getElementsByTagNameNS(XHTML, 'nav') as ArrayLike<El>).find((n) => n.getAttribute('epub:type') === 'toc');
  if (!toc) return fail('the box set has no contents (nav epub:type="toc")');
  const top = kids(toc, 'ol')[0];
  const books = top ? kids(top, 'li') : [];
  if (books.length !== volumes.length) return fail(`the contents lists ${books.length} books, expected ${volumes.length} books`);
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i], li = books[i];
    const title = (kids(li, 'a')[0]?.textContent ?? '').trim();
    if (v.meta?.title !== undefined && fold(title) !== fold(v.meta.title)) return fail(`book ${i + 1} is titled "${title}", expected "${v.meta.title}"`);
    const entries = (kids(li, 'ol')[0] ? kids(kids(li, 'ol')[0], 'li') : []).map((e: El) => (kids(e, 'a')[0]?.textContent ?? '').trim());
    // a chapter's label is "Chapter N · Title", a part's "Part N · Title" (sectionLabel); front and back matter carry no prefix
    const chapters = entries.map((e: string) => /^(?:Chapter|Part) [^·]+ · (.*)$/.exec(e)?.[1]).filter((t: string | undefined): t is string => t !== undefined);
    const want = v.sections.filter((s) => s.kind === 'body' && (s.type ?? 'chapter') === 'chapter').map((s) => s.title ?? '');
    if (chapters.length !== want.length || chapters.some((c: string, k: number) => fold(c) !== fold(want[k])))
      return fail(`book ${i + 1} ("${title}") holds chapters [${chapters.join(', ')}], expected [${want.join(', ')}]`);
  }
  return { ok: true, diff: null };
}

/** One entry of a zip (stored or deflated), found through its central directory. */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0, n = zip.readUInt16LE(eocd + 10); i < n; i++) {
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.subarray(at + 46, at + 46 + nameLen).toString('utf8') === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    at += 46 + nameLen + extra + comment;
  }
  return null;
}

/** The nav document of an EPUB: the manifest item with properties="nav". */
export function epubNav(epub: Buffer): string | null {
  const container = readZipEntry(epub, 'META-INF/container.xml')?.toString('utf8');
  const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1];
  const opf = opfPath ? readZipEntry(epub, opfPath)?.toString('utf8') : undefined;
  const item = opf && /<item\b[^>]*properties="[^"]*\bnav\b[^"]*"[^>]*>/.exec(opf)?.[0];
  const href = item && /href="([^"]+)"/.exec(item)?.[1];
  if (!opfPath || !href) return null;
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  return readZipEntry(epub, dir + href)?.toString('utf8') ?? null;
}
