import { Router } from 'express';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';

interface ManuscriptRow {
  id: string;
  title: string;
  doc: unknown;
  created_at: string;
  updated_at: string;
}

function metadata(row: ManuscriptRow) {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** The manuscript document is the client's JSON book: metadata fields
 *  (title, subtitle, author, …), settings, and the three-tier sections
 *  (front matter / body / back matter). We store it whole as jsonb and
 *  only require that it is a JSON object. */
function validDoc(doc: unknown): doc is Record<string, unknown> {
  return typeof doc === 'object' && doc !== null && !Array.isArray(doc);
}

export function manuscriptRoutes(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db));

  // Every query below is owner-scoped: user_id always comes from the
  // session, never from the request.

  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query<ManuscriptRow>(
        `select id, title, created_at, updated_at from manuscripts
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
      const created = await db.query<ManuscriptRow>(
        `insert into manuscripts (user_id, title, doc) values ($1, $2, $3)
         returning id, title, doc, created_at, updated_at`,
        [req.user!.id, title, JSON.stringify(doc)],
      );
      const row = created.rows[0];
      return res.status(201).json({ manuscript: { ...metadata(row), doc: row.doc } });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await db.query<ManuscriptRow>(
        'select id, title, doc, created_at, updated_at from manuscripts where id = $1 and user_id = $2',
        [req.params.id, req.user!.id],
      );
      const row = result.rows[0];
      // 404 (not 403) for other users' manuscripts: existence is not leaked.
      if (!row) return res.status(404).json({ error: 'manuscript not found' });
      return res.json({ manuscript: { ...metadata(row), doc: row.doc } });
    } catch (err) {
      return next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const doc = req.body?.doc;
      if (doc !== undefined && !validDoc(doc))
        return res.status(400).json({ error: 'doc must be a JSON object' });
      const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
      if (doc === undefined && title === undefined)
        return res.status(400).json({ error: 'nothing to update' });
      const updated = await db.query<ManuscriptRow>(
        `update manuscripts
         set doc = coalesce($3, doc),
             title = coalesce($4, title),
             updated_at = now()
         where id = $1 and user_id = $2
         returning id, title, doc, created_at, updated_at`,
        [req.params.id, req.user!.id, doc === undefined ? null : JSON.stringify(doc), title ?? null],
      );
      const row = updated.rows[0];
      if (!row) return res.status(404).json({ error: 'manuscript not found' });
      return res.json({ manuscript: { ...metadata(row), doc: row.doc } });
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
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
