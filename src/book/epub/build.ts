import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../../db.js';
import { hydrateDoc, PIC_REF_PREFIX, picRefOf } from '../../pictures.js';
import { clientDir } from '../../warmth/pages.js';
import { readBook } from '../read.js';
import { EpubBuildError, loadEpubClosure, type EpubSandbox } from './closure.js';
import type { EpubQueue } from './queue.js';
import { epubState } from './state.js';

/* BEUK:epub-server — the store-ready EPUB of one book, built on the
   server by the studio's own code (closure.ts). The book is either the
   writer's shelf copy (manuscriptId) or the book the studio sent (a book
   that lives only on the device). Pictures stored as beuk-pic: refs are
   filled back in from the writer's own picture store first. */

export type EpubInput = { manuscriptId: string } | { book: unknown };

/** A book the server will not build, with words for the writer. */
export class EpubInputError extends Error {
  constructor(message: string, readonly status: number, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

let studio: { html: string; dir: string } | null = null;
/** The studio file is read once; its EPUB code is lifted once per file
 *  (closure.ts caches by hash). A missing studio file is a failed build
 *  that names it, never a bare 500. */
export function studioEpub(dir: string = clientDir()): EpubSandbox {
  if (!studio || studio.dir !== dir) {
    for (const rel of ['index.html', path.join('assets', 'vendor', 'jszip.min.js')]) {
      if (!existsSync(path.join(dir, rel))) {
        throw new EpubBuildError(`the studio file client/${rel.split(path.sep).join('/')} is missing on this server, so the EPUB cannot be built`, 'failed');
      }
    }
    studio = { html: readFileSync(path.join(dir, 'index.html'), 'utf8'), dir };
  }
  return loadEpubClosure(studio.html, dir);
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

export type EpubLimits = { maxBytes: number; timeoutMs: number; heapMb: number };

export async function buildEpub(
  db: Db,
  userId: string,
  input: EpubInput,
  platform: string | undefined,
  lang: string,
  limits: EpubLimits,
  queue?: EpubQueue,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; notes: string[]; filename: string }> {
  let doc: unknown;
  if ('manuscriptId' in input) {
    const r = await db.query<{ doc: unknown }>('select doc from manuscripts where id = $1 and user_id = $2', [input.manuscriptId, userId]);
    if (!r.rows[0]) throw new EpubInputError('manuscript not found', 404);
    doc = r.rows[0].doc;
  } else {
    doc = input.book;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new EpubInputError('the book must be an object', 400);
  /* Size BEFORE the pictures go back in: a small doc can name one stored
     picture thousands of times. Each ref is replaced by that picture's
     base64 text, so the hydrated size is known from octet_length alone
     (this writer's pictures only). */
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
      throw new EpubInputError(
        `This book names ${missing.length} picture${missing.length === 1 ? '' : 's'} your shelf no longer holds, so its EPUB would be missing ${missing.length === 1 ? 'it' : 'them'}. Open the book in the studio on the device that has the pictures and save it to the shelf again.`,
        422,
        { missingPictures: missing },
      );
    }
    for (const [h, n] of counts) extra += n * (size.get(h)! - (PIC_REF_PREFIX.length + 64));
  }
  /* The same cap as a book sent to the shelf, counted with its pictures back in. */
  if (Buffer.byteLength(JSON.stringify(doc)) + extra > limits.maxBytes) {
    throw new EpubInputError('book is too large for a server EPUB', 413, { limitBytes: limits.maxBytes });
  }
  const work = async () => {
    const full = await hydrateDoc(db, userId, doc);
    const read = readBook(full);
    if (read.status === 'newer') throw new EpubInputError('This book was saved by a newer Beuk than this server knows, so it cannot be built here yet.', 422);
    if (read.status === 'failed') throw new EpubInputError('This book could not be read.', 422);
    const state = epubState(read.book, platform ?? read.book.exportPlatform);
    return studioEpub().build(state, { lang, timeoutMs: limits.timeoutMs, heapMb: limits.heapMb });
  };
  /* Hydration, readBook and the state copy are the heavy part: they run in the queue's turn. */
  return queue ? queue.run(userId, signal, work) : work();
}
