import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { buildWrap, WrapRequestError, type WrapInput } from '../book/wrap/build.js';
import { WrapBuildError, WrapInputError, type WrapKind } from '../book/wrap/closure.js';
import { MAX_PICTURE_SIDE, MAX_WRAP_PIXELS } from '../book/wrap/limits.js';
import { BuildBusyError, BuildQueue } from '../book/studio/queue.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';

/**
 * POST /api/wrap — the cover wrap (paperback wrap, case laminate or dust
 * jacket), painted on the server by the studio's own painter (Step 3
 * part 4). Signed in only; after the trial without a plan the access gate
 * in front of this router answers 402 (export.wrap, src/access.ts).
 *
 * Body: { manuscriptId, kind } paints the shelf copy's wrap; { book, kind }
 * a book that lives only on the device. `kind` is 'pdf' or 'jpg'; `lang`
 * (optional) is the writer's interface language. The body cap is the
 * app-wide manuscript limit (express.json in app.ts), and the book is held
 * to it again with its pictures counted back in, before they are (413).
 *
 * Answers application/pdf or image/jpeg with Content-Disposition named the
 * way the studio's downloadWrap names it. A wrap that cannot be painted as
 * the book stands is a 422 { error, reason, pictures } naming the problem
 * (and the pictures, by id); a picture ref this writer's shelf does not
 * hold is a 422 { error, reason: 'missing-pictures', missingPictures }.
 * 429 / 503 come from the wrap's own queue (WRAP_MAX_CONCURRENT,
 * WRAP_MAX_QUEUED).
 */

const ids = (list: string[]) => list.join(', ');

/** What the writer is told when the wrap cannot be painted from the book as it stands. */
export function wrapRefusalText(e: WrapInputError): string {
  switch (e.reason) {
    case 'no-cover': return 'This book has no made cover yet. Make one in the cover maker, then download the wrap.';
    case 'too-large': return `This cover wrap is larger than the server paints (over ${MAX_WRAP_PIXELS.toLocaleString('en')} pixels at 300 DPI). Check the trim size, page count and paper in the cover maker.`;
    case 'picture-too-large': return `These pictures are too large to paint on the cover wrap (over ${MAX_PICTURE_SIDE.toLocaleString('en')} pixels on a side, or over ${(MAX_WRAP_PIXELS / 1e6).toLocaleString('en')} megapixels): ${ids(e.missing)}. Choose a smaller picture in the cover maker.`;
    case 'picture-unsupported': return `The cover wrap cannot paint these pictures: ${ids(e.missing)}. A picture must be a JPEG, PNG, WebP, GIF or a plain SVG (an SVG that loads files or other pictures from elsewhere, or carries scripts or entity declarations, is refused). Choose another picture in the cover maker.`;
    case 'bad-picture-id': return `The cover wrap names pictures by ids it cannot use: ${ids(e.missing)}. Choose the pictures again in the cover maker.`;
    case 'missing-pictures': return `The cover wrap uses pictures this book no longer has, or that cannot be read: ${ids(e.missing)}. Choose them again in the cover maker.`;
  }
}

export function wrapRoutes(db: Db, config: Config, queue: BuildQueue = new BuildQueue(config.wrapMaxConcurrent, config.wrapMaxQueued)): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const hasId = body.manuscriptId !== undefined;
      const hasBook = body.book !== undefined;
      if (hasId === hasBook) return res.status(400).json({ error: 'send either manuscriptId or book' });
      if (body.kind !== 'pdf' && body.kind !== 'jpg') return res.status(400).json({ error: "kind must be one of: pdf, jpg" });
      const kind = body.kind as WrapKind;
      let input: WrapInput;
      if (hasId) {
        if (typeof body.manuscriptId !== 'string' || !isUuid(body.manuscriptId)) return res.status(404).json({ error: 'manuscript not found' });
        input = { manuscriptId: body.manuscriptId };
      } else input = { book: body.book };
      const lang = typeof body.lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(body.lang) ? body.lang : 'en';
      /* A writer who goes away while waiting leaves the line (as /api/epub). */
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) gone.abort(); });
      const out = await buildWrap(db, req.user!.id, input, kind, lang, {
        maxBytes: config.wrapMaxBytes,
        timeoutMs: config.jobTimeoutMs,
        heapMb: config.wrapWorkerHeapMb,
      }, queue, gone.signal);
      const ascii = out.filename.replace(/[^A-Za-z0-9._-]/g, '_') || `cover-wrap.${kind}`;
      res.set({
        'Content-Type': out.contentType,
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
        'Cache-Control': 'no-store',
      });
      return res.status(200).send(out.bytes);
    } catch (err) {
      if (err instanceof WrapRequestError) return res.status(err.status).json({ error: err.message, ...err.extra });
      if (err instanceof WrapInputError) return res.status(422).json({ error: wrapRefusalText(err), reason: err.reason, pictures: err.missing });
      if (err instanceof BuildBusyError) {
        if (err.reason === 'aborted') return res.headersSent ? undefined : res.status(499).end();
        res.set('Retry-After', err.reason === 'queue-full' ? '30' : '10');
        if (err.reason === 'user-busy') return res.status(429).json({ error: 'A cover wrap of yours is already being built. Wait for it to finish, then try again.', reason: err.reason });
        return res.status(503).json({ error: 'The server is busy building other cover wraps. Please try again in a minute.', reason: err.reason });
      }
      if (err instanceof WrapBuildError) {
        console.error('wrap.build_failed', err.reason, err.message);
        if (err.reason === 'timeout') return res.status(503).json({ error: 'Building this cover wrap took too long and was stopped. Please try again; if it keeps happening, tell us.', reason: err.reason });
        if (err.reason === 'memory') return res.status(413).json({ error: 'This cover wrap is too large to build on the server.', reason: err.reason });
        return res.status(500).json({ error: 'The cover wrap could not be built. Please try again; if it keeps happening, tell us.', reason: err.reason });
      }
      return next(err);
    }
  });
  return router;
}
