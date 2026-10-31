import { Router, type Request } from 'express';
import type { BackgroundTasks } from './account.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';
import { observeBook } from '../book/observe.js';
import { uuidParam } from '../ids.js';
import { HTTP_CODES } from '../help/codes.js';
import { collectPicRefs, collectUnusedPictures, hydrateDoc, isMissingPictureError, missingPictures, writePictureRefs } from '../pictures.js';

interface ManuscriptRow {
  id: string;
  title: string;
  doc: unknown;
  revision: number;
  created_at: string;
  updated_at: string;
}

function metadata(row: ManuscriptRow) {
  return {
    id: row.id,
    title: row.title,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The manuscript's revision as a strong entity tag (RFC 9110 §8.8.3). */
function etagOf(revision: number): string {
  return `"${revision}"`;
}

/** The revision a PUT claims to be based on: the If-Match header
 *  (RFC 9110 §13.1.1 — `"3"`, `W/"3"`, or `*`) wins over
 *  body.revision. Returns null when neither is present, 'invalid'
 *  when one is present but unreadable, '*' for If-Match: *. */
function baseRevision(header: string | undefined, bodyRevision: unknown): number | '*' | 'invalid' | null {
  if (typeof header === 'string' && header.trim() !== '') {
    const raw = header.trim();
    if (raw === '*') return '*';
    // A single entity tag; a list of several is not something this
    // client sends, so anything else is refused as unreadable.
    const m = /^(?:W\/)?"(\d{1,9})"$/.exec(raw) ?? /^(\d{1,9})$/.exec(raw);
    return m ? Number(m[1]) : 'invalid';
  }
  if (bodyRevision === undefined || bodyRevision === null) return null;
  return typeof bodyRevision === 'number' && Number.isInteger(bodyRevision) && bodyRevision > 0
    ? bodyRevision
    : 'invalid';
}

/** The manuscript document is the client's JSON book: metadata fields
 *  (title, subtitle, author, …), settings, and the three-tier sections
 *  (front matter / body / back matter). We store it whole as jsonb and
 *  only require that it is a JSON object. */
function validDoc(doc: unknown): doc is Record<string, unknown> {
  return typeof doc === 'object' && doc !== null && !Array.isArray(doc);
}

/** The studio asks for the doc with its pictures NAMED (`Beuk-Pictures:
 *  ref`): it fills them in from what it already holds and fetches only
 *  the rest. Every other reader gets the whole book, pictures filled
 *  in, exactly as before stored pictures existed. */
function wantsRefs(req: Request): boolean {
  return (req.get('beuk-pictures') ?? '').trim().toLowerCase() === 'ref';
}
/** `Prefer: return=minimal` (RFC 7240 §4.2): a save's answer leaves the
 *  doc out — the studio only needs the new revision, not its own book
 *  echoed back. Without it the answer carries the doc as before. */
function wantsMinimal(req: Request): boolean {
  return /(?:^|[,;\s])return=minimal(?:$|[,;\s])/i.test(req.get('prefer') ?? '');
}

const missingBody = (missing: string[]) => ({
  error: 'the book names pictures this shelf does not hold: upload them, then save again',
  missingPictures: missing,
});

export function manuscriptRoutes(db: Db, config: Config, tasks: BackgroundTasks): Router {
  const router = Router();
  router.use(requireAuth(db));
  router.param('id', uuidParam('manuscript not found'));

  // Every query below is owner-scoped: user_id always comes from the
  // session, never from the request.

  const docOut = async (req: Request, doc: unknown): Promise<unknown> =>
    wantsRefs(req) ? doc : hydrateDoc(db, req.user!.id, doc);
  const withDoc = async (req: Request, row: ManuscriptRow) => ({ ...metadata(row), doc: await docOut(req, row.doc) });
  /** After a write that may have dropped a picture: collect what no book
   *  names. Best effort — a failure here never fails the save. */
  const collect = async (userId: string): Promise<void> => {
    try {
      await collectUnusedPictures(db, userId, config.pictureGcGraceSeconds);
    } catch (err) {
      console.error('pictures: collecting unused pictures failed', err);
    }
  };

  /** Book format observe mode: runs after the answer, never changes it. */
  const observe = (id: string, doc: unknown): void => {
    // setImmediate first: readBook is synchronous CPU work, so it waits
    // until the answer has been handed to the socket.
    const job = () => new Promise<void>((r) => setImmediate(r)).then(() => observeBook(db, id, doc, new Date()));
    tasks.run(job);
  };

  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query<ManuscriptRow>(
        `select id, title, revision, created_at, updated_at from manuscripts
         where user_id = $1 order by updated_at desc`,
        [req.user!.id],
      );
      return res.json({ manuscripts: result.rows.map(metadata) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const doc = req.body?.doc;
      if (!validDoc(doc)) return res.status(400).json({ error: 'doc must be a JSON object' });
      const title =
        (typeof req.body?.title === 'string' && req.body.title) ||
        (typeof doc.title === 'string' && doc.title) ||
        'Untitled';
      const refs = collectPicRefs(doc);
      const missing = await missingPictures(db, req.user!.id, refs);
      if (missing.length) return res.status(422).json(missingBody(missing));
      let row: ManuscriptRow;
      try {
        row = await db.tx(async (tx) => {
          const created = await tx.query<ManuscriptRow>(
            `insert into manuscripts (user_id, title, doc) values ($1, $2, $3)
             returning id, title, doc, revision, created_at, updated_at`,
            [req.user!.id, title, JSON.stringify(doc)],
          );
          await writePictureRefs(tx, created.rows[0].id, req.user!.id, refs);
          return created.rows[0];
        });
      } catch (err) {
        if (isMissingPictureError(err)) return res.status(422).json(missingBody(await missingPictures(db, req.user!.id, refs)));
        throw err;
      }
      res.set('ETag', etagOf(row.revision));
      observe(row.id, doc);
      if (wantsMinimal(req)) return res.status(201).json({ manuscript: metadata(row) });
      return res.status(201).json({ manuscript: await withDoc(req, row) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await db.query<ManuscriptRow>(
        'select id, title, doc, revision, created_at, updated_at from manuscripts where id = $1 and user_id = $2',
        [req.params.id, req.user!.id],
      );
      const row = result.rows[0];
      // 404 (not 403) for other users' manuscripts: existence is not leaked.
      if (!row) return res.status(404).json({ error: 'manuscript not found' });
      res.set('ETag', etagOf(row.revision));
      return res.json({ manuscript: await withDoc(req, row) });
    } catch (err) {
      return next(err);
    }
  });

  // Optimistic concurrency: a PUT names the revision it was based on.
  // The update only lands when that is still the shelf's revision; the
  // check and the write are one statement, so two racing saves cannot
  // both win. A stale base gets 409 with the current shelf copy (doc
  // included) so the client can show its conflict notice; a missing
  // base gets 428 (RFC 6585 §3) with the same copy — never a blind
  // overwrite. A doc naming pictures the account does not hold is
  // refused with 422 and nothing is written (revision unchanged).
  router.put('/:id', async (req, res, next) => {
    try {
      const doc = req.body?.doc;
      if (doc !== undefined && !validDoc(doc))
        return res.status(400).json({ error: 'doc must be a JSON object' });
      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
      if (doc === undefined && title === undefined)
        return res.status(400).json({ error: 'nothing to update' });
      const base = baseRevision(req.get('if-match'), req.body?.revision);
      if (base === 'invalid')
        return res.status(400).json({ error: 'revision must be a positive integer (If-Match: "<revision>")' });
      const refs = doc === undefined ? [] : collectPicRefs(doc);
      if (base !== null) {
        const missing = await missingPictures(db, req.user!.id, refs);
        if (missing.length) return res.status(422).json(missingBody(missing));
        let row: ManuscriptRow | undefined;
        try {
          row = await db.tx(async (tx) => {
            const updated = await tx.query<ManuscriptRow>(
              `update manuscripts
               set doc = coalesce($3, doc),
                   title = coalesce($4, title),
                   revision = revision + 1,
                   updated_at = now()
               where id = $1 and user_id = $2 and ($5::integer is null or revision = $5::integer)
               returning id, title, doc, revision, created_at, updated_at`,
              [
                req.params.id,
                req.user!.id,
                doc === undefined ? null : JSON.stringify(doc),
                title ?? null,
                base === '*' ? null : base,
              ],
            );
            const written = updated.rows[0];
            if (written && doc !== undefined) await writePictureRefs(tx, written.id, req.user!.id, refs);
            return written;
          });
        } catch (err) {
          if (isMissingPictureError(err)) return res.status(422).json(missingBody(await missingPictures(db, req.user!.id, refs)));
          throw err;
        }
        if (row) {
          if (doc !== undefined) await collect(req.user!.id);
          res.set('ETag', etagOf(row.revision));
          if (doc !== undefined) observe(row.id, doc);
          if (wantsMinimal(req)) return res.json({ manuscript: metadata(row) });
          return res.json({ manuscript: await withDoc(req, row) });
        }
      }
      // Not written: either the book is not the caller's (404, existence
      // not leaked) or the base is missing / stale (428 / 409 with the
      // current shelf copy).
      const current = await db.query<ManuscriptRow>(
        'select id, title, doc, revision, created_at, updated_at from manuscripts where id = $1 and user_id = $2',
        [req.params.id, req.user!.id],
      );
      const row = current.rows[0];
      if (!row) return res.status(404).json({ error: 'manuscript not found' });
      res.set('ETag', etagOf(row.revision));
      const manuscript = await withDoc(req, row);
      if (base === null)
        return res.status(428).json({ error: 'revision required (If-Match header or body.revision)', manuscript });
      return res.status(409).json({ error: 'revision conflict: the shelf copy has changed', code: HTTP_CODES.manuscriptConflict, manuscript });
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await db.query(
        'delete from manuscripts where id = $1 and user_id = $2 returning id',
        [req.params.id, req.user!.id],
      );
      if (!result.rows.length) return res.status(404).json({ error: 'manuscript not found' });
      // The book's picture names went with it (on delete cascade): a
      // picture no other book names is collected now.
      await collect(req.user!.id);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
