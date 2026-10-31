import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../../db.js';
import { hydrateDoc, PIC_REF_PREFIX, picRefOf } from '../../pictures.js';
import { clientDir } from '../../warmth/pages.js';
import { readBook } from '../read.js';
import type { BuildQueue } from '../studio/queue.js';
import { loadWrapClosure, WrapBuildError, wrapState, type WrapKind, type WrapSandbox } from './closure.js';

/* BEUK:wrap-server — the cover wrap of one book (paperback wrap, case
   laminate or dust jacket), painted on the server by the studio's own
   painter (closure.ts) and returned the way downloadWrap saves it: the
   300-DPI JPEG, or that JPEG on a PDF page of exactly the wrap's size.
   The book is either the writer's shelf copy (manuscriptId) or the book
   the studio sent (a book that lives only on the device). Pictures stored
   as beuk-pic: refs are filled back in from the writer's OWN picture store
   first (hydrateDoc scopes by user): a ref to anyone else's picture is a
   picture this writer does not hold. Modelled on src/book/epub/build.ts. */

export type WrapInput = { manuscriptId: string } | { book: unknown };

/** A request the server will not build, with words for the writer. */
export class WrapRequestError extends Error {
  constructor(message: string, readonly status: number, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

let studio: { html: string; dir: string } | null = null;
/** The studio file is read once; its wrap painter is lifted once per file
 *  (closure.ts caches by hash). A missing studio file is a failed build
 *  that names it, never a bare 500. */
export function studioWrap(dir: string = clientDir()): WrapSandbox {
  if (!studio || studio.dir !== dir) {
    for (const rel of ['index.html', path.join('assets', 'vendor', 'lucide.min.js'), path.join('assets', 'fonts', 'MANIFEST.tsv')]) {
      if (!existsSync(path.join(dir, rel))) {
        throw new WrapBuildError(`the studio file client/${rel.split(path.sep).join('/')} is missing on this server, so the cover wrap cannot be built`, 'failed');
      }
    }
    studio = { html: readFileSync(path.join(dir, 'index.html'), 'utf8'), dir };
  }
  return loadWrapClosure(studio.html, dir);
}

/** How many times the doc names each picture (beuk-pic:<sha>). */
function picRefCounts(doc: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (v: unknown): void => {
    const h = picRefOf(v);
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
  };
  walk(doc);
  return counts;
}

export type WrapLimits = { maxBytes: number; timeoutMs: number; heapMb: number };

export async function buildWrap(
  db: Db,
  userId: string,
  input: WrapInput,
  kind: WrapKind,
  lang: string,
  limits: WrapLimits,
  queue?: BuildQueue,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  let doc: unknown;
  if ('manuscriptId' in input) {
    const r = await db.query<{ doc: unknown }>('select doc from manuscripts where id = $1 and user_id = $2', [input.manuscriptId, userId]);
    if (!r.rows[0]) throw new WrapRequestError('manuscript not found', 404);
    doc = r.rows[0].doc;
  } else {
    doc = input.book;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new WrapRequestError('the book must be an object', 400);
  /* Size BEFORE the pictures go back in, as for the EPUB: a small doc can
     name one stored picture thousands of times. Each ref is replaced by
     that picture's base64 text, so the hydrated size is known from
     octet_length alone (this writer's pictures only). */
  const counts = picRefCounts(doc);
  let extra = 0;
  if (counts.size) {
    const r = await db.query<{ sha256: string; n: string | number }>(
      'select sha256, octet_length(data)::bigint as n from pictures where user_id = $1 and sha256 = any($2::text[])',
      [userId, [...counts.keys()]],
    );
    const size = new Map(r.rows.map((row) => [row.sha256, Number(row.n)]));
    const missing = [...counts.keys()].filter((h) => !size.has(h));
    if (missing.length) {
      throw new WrapRequestError(
        `This book names ${missing.length} picture${missing.length === 1 ? '' : 's'} your shelf does not hold, so its cover wrap cannot be built here. Open the book in the studio on the device that has the pictures and save it to the shelf again.`,
        422,
        { reason: 'missing-pictures', missingPictures: missing },
      );
    }
    for (const [h, n] of counts) extra += n * (size.get(h)! - (PIC_REF_PREFIX.length + 64));
  }
  /* The same cap as a book sent to the shelf, counted with its pictures back in. */
  if (Buffer.byteLength(JSON.stringify(doc)) + extra > limits.maxBytes) {
    throw new WrapRequestError('book is too large for a server cover wrap', 413, { limitBytes: limits.maxBytes });
  }
  const work = async () => {
    const full = await hydrateDoc(db, userId, doc);
    const read = readBook(full);
    if (read.status === 'newer') throw new WrapRequestError('This book was saved by a newer Beuk than this server knows, so its cover wrap cannot be built here yet.', 422);
    if (read.status === 'failed') throw new WrapRequestError('This book could not be read.', 422);
    const out = await studioWrap().render(wrapState(read.book), kind, { lang, timeoutMs: limits.timeoutMs, heapMb: limits.heapMb });
    return {
      bytes: out.bytes,
      filename: `${out.name}.${kind}`,
      contentType: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
    };
  };
  /* Hydration, readBook and the render are the heavy part: they run in the queue's turn. */
  return queue ? queue.run(userId, signal, work) : work();
}
