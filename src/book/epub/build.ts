import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../../db.js';
import { collectPicRefs, hydrateDoc } from '../../pictures.js';
import { clientDir } from '../../warmth/pages.js';
import { readBook } from '../read.js';
import { loadEpubClosure, type EpubSandbox } from './closure.js';
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
/** The studio file is read once; its EPUB code is lifted once per file (closure.ts caches by hash). */
export function studioEpub(dir: string = clientDir()): EpubSandbox {
  if (!studio || studio.dir !== dir) studio = { html: readFileSync(path.join(dir, 'index.html'), 'utf8'), dir };
  return loadEpubClosure(studio.html, dir);
}

export async function buildEpub(
  db: Db,
  userId: string,
  input: EpubInput,
  platform: string | undefined,
  lang: string,
  limits: { maxBytes: number; timeoutMs: number },
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
  doc = await hydrateDoc(db, userId, doc);
  const missing = collectPicRefs(doc);
  if (missing.length) {
    throw new EpubInputError(
      `This book names ${missing.length} picture${missing.length === 1 ? '' : 's'} your shelf no longer holds, so its EPUB would be missing ${missing.length === 1 ? 'it' : 'them'}. Open the book in the studio on the device that has the pictures and save it to the shelf again.`,
      422,
      { missingPictures: missing },
    );
  }
  /* The same cap as a book sent to the shelf, applied after the pictures are back in. */
  if (Buffer.byteLength(JSON.stringify(doc)) > limits.maxBytes) {
    throw new EpubInputError('book is too large for a server EPUB', 413, { limitBytes: limits.maxBytes });
  }
  const read = readBook(doc);
  if (read.status === 'newer') throw new EpubInputError('This book was saved by a newer Beuk than this server knows, so it cannot be built here yet.', 422);
  if (read.status === 'failed') throw new EpubInputError('This book could not be read.', 422);
  const state = epubState(read.book, platform ?? read.book.exportPlatform);
  return studioEpub().build(state, { lang, timeoutMs: limits.timeoutMs });
}
