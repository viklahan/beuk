import { Router } from 'express';
import { sessionOrScopedBearer } from '../oauth/bearer.js';
import { EpubBuildError } from '../book/epub/closure.js';
import { buildEpub, EpubInputError, type EpubInput } from '../book/epub/build.js';
import { EpubBusyError, EpubQueue } from '../book/epub/queue.js';
import { KNOWN } from '../book/schema.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';

/**
 * POST /api/epub — the store-ready EPUB, built on the server (Step 3
 * part 3). Signed in only; after the trial without a plan the access gate
 * in front of this router answers 402 (export.epub, src/access.ts).
 *
 * Body: { manuscriptId, platform?, lang? } builds the shelf copy;
 * { book, platform?, lang? } builds a book that lives only on the device.
 * The body cap is the app-wide manuscript limit (express.json in app.ts),
 * so an inline { book } cannot exceed it. The { manuscriptId } path has a
 * tiny body and its pictures are hydrated from the store at build time,
 * so the built size is bounded separately by EPUB_MAX_BYTES (config
 * epubMaxBytes) — kept under the worker heap, not the shelf cap.
 * `platform` is one of the studio's eleven presets (default: the book's
 * own); `lang` is the writer's interface language, for the words the
 * studio would have shown (the notes). EPUBCheck is not run here (it is
 * slow); the server check job stays separate.
 *
 * Answers application/epub+zip with Content-Disposition, plus
 * X-Beuk-Notes: a URI-encoded JSON array of what the studio would have
 * said while building (a script face that could not be loaded, say).
 */
export function epubRoutes(db: Db, config: Config, queue: EpubQueue = new EpubQueue(config.epubMaxConcurrent, config.epubMaxQueued)): Router {
  const router = Router();
  // The studio (cookies) and the MCP server's export_epub (a beuk:export
  // bearer) both build here; cookies pass untouched.
  router.use(sessionOrScopedBearer(db, config, 'beuk:export'));

  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const hasId = body.manuscriptId !== undefined;
      const hasBook = body.book !== undefined;
      if (hasId === hasBook) return res.status(400).json({ error: 'send either manuscriptId or book' });
      let input: EpubInput;
      if (hasId) {
        if (typeof body.manuscriptId !== 'string' || !isUuid(body.manuscriptId)) return res.status(404).json({ error: 'manuscript not found' });
        input = { manuscriptId: body.manuscriptId };
      } else input = { book: body.book };
      const platform = body.platform;
      if (platform !== undefined && (typeof platform !== 'string' || !(KNOWN.exportPlatforms as readonly string[]).includes(platform))) {
        return res.status(400).json({ error: `platform must be one of: ${KNOWN.exportPlatforms.join(', ')}` });
      }
      const lang = typeof body.lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(body.lang) ? body.lang : 'en';
      /* A writer who goes away while waiting leaves the line. (req 'close'
         also fires once the body is read, so the response's close is the
         signal: closed before it finished = the client went away.) */
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) gone.abort(); });
      const out = await buildEpub(db, req.user!.id, input, platform as string | undefined, lang, {
        maxBytes: config.epubMaxBytes,
        timeoutMs: config.jobTimeoutMs,
        heapMb: config.epubWorkerHeapMb,
      }, queue, gone.signal);
      const ascii = out.filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'book.epub';
      res.set({
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
        'X-Beuk-Notes': encodeURIComponent(JSON.stringify(out.notes)),
        'Cache-Control': 'no-store',
      });
      return res.status(200).send(out.bytes);
    } catch (err) {
      if (err instanceof EpubInputError) return res.status(err.status).json({ error: err.message, ...err.extra });
      if (err instanceof EpubBusyError) {
        if (err.reason === 'aborted') return res.headersSent ? undefined : res.status(499).end();
        res.set('Retry-After', err.reason === 'queue-full' ? '30' : '10');
        if (err.reason === 'user-busy') return res.status(429).json({ error: 'An EPUB of yours is already being built. Wait for it to finish, then try again.', reason: err.reason });
        return res.status(503).json({ error: 'The server is busy building other EPUBs. Please try again in a minute.', reason: err.reason });
      }
      if (err instanceof EpubBuildError) {
        console.error('epub.build_failed', err.reason, err.message);
        if (err.reason === 'timeout') return res.status(503).json({ error: 'Building this EPUB took too long and was stopped. Please try again; if it keeps happening, tell us.', reason: err.reason });
        if (err.reason === 'memory') return res.status(413).json({ error: 'This book is too large to build as an EPUB on the server.', reason: err.reason });
        return res.status(500).json({ error: 'The EPUB could not be built. Please try again; if it keeps happening, tell us.', reason: err.reason });
      }
      return next(err);
    }
  });
  return router;
}
