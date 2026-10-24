import { inflateRawSync } from 'node:zlib';
import { scanTags, xmlWellFormed } from './xml.js';

/**
 * EPUB package handling for Housekeeping Self-checks: a small zip
 * reader/writer (stored + deflate) and the structural validator the
 * package-level registry cases assert against. Structural only — the
 * full EPUBCheck suite is a later milestone (M5) and nothing here
 * claims to be it.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 0 = stored, 8 = deflate. */
  method: number;
}

/* ---------------- zip writing (stored) ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a zip of stored (uncompressed) entries, in the given order —
 *  exactly what a fixture EPUB needs (mimetype first, stored). */
export function createZip(entries: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, entry.data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(entry.data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

/* ---------------- zip reading ---------------- */

export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip file (no end-of-central-directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`unsupported zip method ${method} for ${name}`);
    entries.push({ name, data, method });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ---------------- OPF parsing ---------------- */

export interface OpfItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

export interface Opf {
  items: OpfItem[];
  byId: Map<string, OpfItem>;
  /** Spine hrefs, in spine order. */
  spineHrefs: string[];
  guideTypes: string[];
  raw: string;
}

export function parseOpf(xml: string): Opf {
  const tags = scanTags(xml);
  const items: OpfItem[] = [];
  const byId = new Map<string, OpfItem>();
  const idrefs: string[] = [];
  const guideTypes: string[] = [];
  let inSpine = false;
  let inGuide = false;
  for (const tag of tags) {
    if (tag.name === 'spine') inSpine = !tag.closing;
    if (tag.name === 'guide') inGuide = !tag.closing;
    if (tag.closing) continue;
    if (tag.name === 'item') {
      const item: OpfItem = {
        id: tag.attrs.id ?? '',
        href: tag.attrs.href ?? '',
        mediaType: tag.attrs['media-type'] ?? '',
        properties: (tag.attrs.properties ?? '').split(/\s+/).filter(Boolean),
      };
      items.push(item);
      if (item.id) byId.set(item.id, item);
    } else if (tag.name === 'itemref' && inSpine && tag.attrs.idref) {
      idrefs.push(tag.attrs.idref);
    } else if (tag.name === 'reference' && inGuide && tag.attrs.type) {
      guideTypes.push(tag.attrs.type);
    }
  }
  return {
    items,
    byId,
    spineHrefs: idrefs
      .map((idref) => byId.get(idref)?.href)
      .filter((href): href is string => Boolean(href)),
    guideTypes,
    raw: xml,
  };
}

/* ---------------- path helpers ---------------- */

export function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

/** Resolve `href` (possibly with a #fragment) against a package dir. */
export function resolvePath(fromDir: string, href: string): { path: string; fragment: string | null } {
  const [rawPath, fragment = null] = href.split('#', 2) as [string, string?];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Keep the raw path if it is not valid percent-encoding.
  }
  if (!decoded) return { path: '', fragment };
  const parts = (fromDir ? fromDir.split('/') : []).concat(decoded.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return { path: out.join('/'), fragment };
}

/* ---------------- the structural validator ---------------- */

export interface PackageCheck {
  id: string;
  status: 'pass' | 'fail';
  detail: string;
}

const XML_LIKE = /\.(xhtml|xml|opf|ncx)$/i;
const XHTML_LIKE = /\.xhtml$/i;

function idsIn(xml: string): Set<string> {
  const ids = new Set<string>();
  for (const tag of scanTags(xml)) {
    if (tag.attrs.id) ids.add(tag.attrs.id);
  }
  return ids;
}

/**
 * The server-side structural validator: the same assertion family the
 * client validator runs (feature 7), over a parsed package. Returns
 * one result per named check; registry cases assert on these.
 */
export function validateEpub(entries: ZipEntry[]): PackageCheck[] {
  const checks: PackageCheck[] = [];
  const byName = new Map(entries.map((e) => [e.name, e]));
  const push = (id: string, ok: boolean, detail: string): void => {
    checks.push({ id, status: ok ? 'pass' : 'fail', detail });
  };
  const text = (name: string): string => byName.get(name)?.data.toString('utf8') ?? '';

  // mimetype: first entry, stored, exact content.
  const first = entries[0];
  push(
    'mimetype-first-stored',
    Boolean(
      first &&
        first.name === 'mimetype' &&
        first.method === 0 &&
        first.data.toString('utf8').trim() === 'application/epub+zip',
    ),
    first
      ? `first entry is ${first.name} (method ${first.method})`
      : 'package is empty',
  );

  // container → OPF.
  let opfPath: string | null = null;
  const container = byName.get('META-INF/container.xml');
  if (container) {
    const rootfile = scanTags(container.data.toString('utf8')).find((t) => t.name === 'rootfile');
    opfPath = rootfile?.attrs['full-path'] ?? null;
  }
  push(
    'container-opf',
    Boolean(opfPath && byName.has(opfPath)),
    opfPath ? `container points at ${opfPath}` : 'container.xml missing or has no rootfile',
  );

  // Well-formedness of every XML-like part.
  const badXml: string[] = [];
  for (const entry of entries) {
    if (!XML_LIKE.test(entry.name)) continue;
    const result = xmlWellFormed(entry.data.toString('utf8'));
    if (!result.ok) badXml.push(`${entry.name}: ${result.error}`);
  }
  push(
    'xml-well-formed',
    badXml.length === 0,
    badXml.length ? badXml.join('; ') : 'all XML/XHTML parts are well-formed',
  );

  if (!opfPath || !byName.has(opfPath)) {
    for (const id of [
      'manifest-matches-files',
      'spine-resolves',
      'nav-landmarks',
      'ncx-targets',
      'anchors-resolve',
      'image-alt',
      'metadata-required',
      'cover-declared',
    ]) {
      push(id, false, 'no readable package document (OPF)');
    }
    return checks;
  }

  const opfDir = dirOf(opfPath);
  const opf = parseOpf(text(opfPath));
  const resolveHref = (href: string): string => resolvePath(opfDir, href).path;

  // Manifest ↔ files, both ways; duplicate ids.
  const problems: string[] = [];
  const seenIds = new Set<string>();
  for (const item of opf.items) {
    if (item.id && seenIds.has(item.id)) problems.push(`duplicate manifest id ${item.id}`);
    seenIds.add(item.id);
    if (item.href && !byName.has(resolveHref(item.href))) {
      problems.push(`manifest item ${item.id || item.href} points at missing file ${item.href}`);
    }
  }
  const manifestPaths = new Set(opf.items.map((item) => resolveHref(item.href)));
  for (const entry of entries) {
    if (entry.name === 'mimetype' || entry.name.startsWith('META-INF/')) continue;
    if (entry.name === opfPath) continue;
    if (!manifestPaths.has(entry.name)) problems.push(`file ${entry.name} is not in the manifest`);
  }
  push(
    'manifest-matches-files',
    problems.length === 0,
    problems.length ? problems.join('; ') : 'manifest and files agree, ids unique',
  );

  // Spine resolution.
  const spineProblems: string[] = [];
  const spineRaw = text(opfPath);
  const spineIdrefs = scanTags(spineRaw)
    .filter((t) => t.name === 'itemref' && !t.closing)
    .map((t) => t.attrs.idref);
  for (const idref of spineIdrefs) {
    if (!opf.byId.has(idref)) spineProblems.push(`spine idref ${idref} not in manifest`);
  }
  push(
    'spine-resolves',
    spineProblems.length === 0,
    spineProblems.length ? spineProblems.join('; ') : `spine resolves (${spineIdrefs.length} items)`,
  );

  // Nav landmarks.
  const navItem = opf.items.find((item) => item.properties.includes('nav'));
  let landmarkDetail = 'no nav document declared';
  let landmarksOk = false;
  if (navItem) {
    const navText = text(resolveHref(navItem.href));
    const types = new Set(
      scanTags(navText)
        .filter((t) => t.attrs['epub:type'])
        .map((t) => t.attrs['epub:type']),
    );
    const coverDeclared = opf.items.some((item) => item.properties.includes('cover-image'));
    const needed = ['toc', 'bodymatter', ...(coverDeclared ? ['cover'] : [])];
    const missing = needed.filter((t) => !types.has(t));
    landmarksOk = missing.length === 0;
    landmarkDetail = missing.length
      ? `nav is missing landmark(s): ${missing.join(', ')}`
      : `nav landmarks present: ${needed.join(', ')}`;
  }
  push('nav-landmarks', landmarksOk, landmarkDetail);

  // NCX targets.
  const ncxItem = opf.items.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  let ncxOk = false;
  let ncxDetail = 'no NCX declared';
  if (ncxItem) {
    const ncxPath = resolveHref(ncxItem.href);
    const ncxText = text(ncxPath);
    const targets = scanTags(ncxText)
      .filter((t) => t.name === 'content' && t.attrs.src)
      .map((t) => resolvePath(dirOf(ncxPath), t.attrs.src).path);
    const missing = targets.filter((t) => !byName.has(t));
    ncxOk = missing.length === 0 && targets.length > 0;
    ncxDetail = missing.length
      ? `NCX targets missing: ${missing.join(', ')}`
      : `NCX present, ${targets.length} targets resolve`;
  }
  push('ncx-targets', ncxOk, ncxDetail);

  // Internal hrefs/srcs and #anchors across XHTML parts.
  const anchorProblems: string[] = [];
  const idCache = new Map<string, Set<string>>();
  const idsOf = (path: string): Set<string> => {
    if (!idCache.has(path)) idCache.set(path, idsIn(text(path)));
    return idCache.get(path)!;
  };
  for (const entry of entries) {
    if (!XHTML_LIKE.test(entry.name)) continue;
    const dir = dirOf(entry.name);
    for (const tag of scanTags(entry.data.toString('utf8'))) {
      if (tag.closing) continue;
      for (const attr of ['href', 'src']) {
        const ref = tag.attrs[attr];
        if (!ref || /^(https?:|mailto:|data:)/i.test(ref)) continue;
        const { path: target, fragment } = resolvePath(dir, ref);
        const targetPath = target === '' ? entry.name : target;
        if (!byName.has(targetPath)) {
          anchorProblems.push(`${entry.name}: ${attr} "${ref}" → missing file ${targetPath}`);
          continue;
        }
        if (fragment && XML_LIKE.test(targetPath) && !idsOf(targetPath).has(fragment)) {
          anchorProblems.push(`${entry.name}: ${attr} "${ref}" → no id "${fragment}" in ${targetPath}`);
        }
      }
    }
  }
  push(
    'anchors-resolve',
    anchorProblems.length === 0,
    anchorProblems.length
      ? anchorProblems.slice(0, 4).join('; ')
      : 'every internal href/src and #anchor resolves',
  );

  // Every image carries an alt attribute.
  const altProblems: string[] = [];
  for (const entry of entries) {
    if (!XHTML_LIKE.test(entry.name)) continue;
    for (const tag of scanTags(entry.data.toString('utf8'))) {
      if (tag.name === 'img' && !tag.closing && !('alt' in tag.attrs)) {
        altProblems.push(`${entry.name}: <img src="${tag.attrs.src ?? '?'}"> has no alt attribute`);
      }
    }
  }
  push(
    'image-alt',
    altProblems.length === 0,
    altProblems.length ? altProblems.join('; ') : 'every <img> carries an alt attribute',
  );

  // Required metadata.
  const missingMeta = ['title', 'creator', 'identifier', 'language'].filter(
    (name) => !new RegExp(`<dc:${name}[\\s>]`).test(opf.raw),
  );
  push(
    'metadata-required',
    missingMeta.length === 0,
    missingMeta.length
      ? `missing dc:${missingMeta.join(', dc:')}`
      : 'title, creator, identifier and language present',
  );

  // Cover declared when a cover image ships.
  const coverImageItem = opf.items.find((item) => item.properties.includes('cover-image'));
  const imagePaths = entries.filter((e) => /\.(png|jpe?g)$/i.test(e.name)).map((e) => e.name);
  const looksLikeCover = imagePaths.filter((p) => /cover\.(png|jpe?g)$/i.test(p));
  let coverOk = true;
  let coverDetail = 'no cover image ships, none declared';
  if (coverImageItem) {
    coverOk = byName.has(resolveHref(coverImageItem.href));
    coverDetail = coverOk
      ? `cover declared with properties="cover-image" (${coverImageItem.href})`
      : `cover-image item points at missing file ${coverImageItem.href}`;
  } else if (looksLikeCover.length) {
    coverOk = false;
    coverDetail = `cover image ${looksLikeCover[0]} ships without a cover-image declaration`;
  }
  push('cover-declared', coverOk, coverDetail);

  return checks;
}
