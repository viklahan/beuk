import { Router } from 'express';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';
import { HTTP_CODES } from '../help/codes.js';

interface SeriesRow {
  series_key: string;
  name: string;
  doc: unknown;
  revision: number;
  updated_at: string;
}

/** The identity of a series: its name lowercased, every run of
 *  whitespace collapsed to one space, trimmed. "Salt  Road" and
 *  "salt road" are one series. The studio mirrors this function, so
 *  change both together. Empty means the name has no series in it. */
export function seriesKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

const NAME_MAX = 120;

const summary = (row: SeriesRow) => ({
  key: row.series_key,
  name: row.name,
  revision: row.revision,
  updated_at: row.updated_at,
});
const full = (row: SeriesRow) => ({ ...summary(row), doc: row.doc });

/** The series revision as a strong entity tag, as manuscripts do. */
const etagOf = (revision: number): string => `"${revision}"`;

/** The revision a PUT claims to be based on: If-Match (`"3"`, `W/"3"`
 *  or `*`) wins over body.revision. null = neither given, 'invalid' =
 *  given but unreadable. Same rules as the manuscripts PUT. */
function baseRevision(header: string | undefined, bodyRevision: unknown): number | '*' | 'invalid' | null {
  if (typeof header === 'string' && header.trim() !== '') {
    const raw = header.trim();
    if (raw === '*') return '*';
    const m = /^(?:W\/)?"(\d{1,9})"$/.exec(raw) ?? /^(\d{1,9})$/.exec(raw);
    return m ? Number(m[1]) : 'invalid';
  }
  if (bodyRevision === undefined || bodyRevision === null) return null;
  return typeof bodyRevision === 'number' && Number.isInteger(bodyRevision) && bodyRevision > 0
    ? bodyRevision
    : 'invalid';
}

/** The Covenant is the client JSON document; we store it whole and
 *  only require that it is a JSON object. The body size limit is the
 *  app-wide one (config.manuscriptMaxBytes), applied by the JSON
 *  parser before any route runs. */
function validDoc(doc: unknown): doc is Record<string, unknown> {
  return typeof doc === 'object' && doc !== null && !Array.isArray(doc);
}

const notFound = { error: 'series not found' };
const COLUMNS = 'series_key, name, doc, revision, updated_at';

export function seriesCovenantRoutes(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db));

  // Every query below is owner-scoped: user_id always comes from the
  // session, never from the request.

  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query<SeriesRow>(
        'select series_key, name, revision, updated_at from series_covenants where user_id = $1 order by updated_at desc',
        [req.user!.id],
      );
      return res.json({ series: result.rows.map(summary) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:key', async (req, res, next) => {
    try {
      const result = await db.query<SeriesRow>(
        `select ${COLUMNS} from series_covenants where user_id = $1 and series_key = $2`,
        [req.user!.id, seriesKey(req.params.key)],
      );
      const row = result.rows[0];
      // 404 (not 403) for other users' series: existence is not leaked.
      if (!row) return res.status(404).json(notFound);
      res.set('ETag', etagOf(row.revision));
      return res.json({ series: full(row) });
    } catch (err) {
      return next(err);
    }
  });

  // Optimistic concurrency, as for manuscripts: a PUT on an existing
  // series names the revision it was based on, and the update lands
  // only when that is still the stored revision; check and write are
  // one statement, so two racing saves cannot both win. A stale base
  // gets 409 with the current copy, a missing base on an existing row
  // gets 428 with the same copy, never a blind overwrite. A series
  // that does not exist yet is created (201) when no revision is
  // given; naming a revision for a row that is not there is a 404.
  router.put('/:key', async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > NAME_MAX)
        return res.status(400).json({ error: `name is required (1 to ${NAME_MAX} characters)` });
      const key = seriesKey(name);
      // The path key must be the name's own key, so one series can never
      // end up stored under two rows.
      if (!key || key !== seriesKey(req.params.key))
        return res.status(400).json({ error: 'the key in the path does not match the series name' });
      const doc = req.body?.doc;
      if (!validDoc(doc)) return res.status(400).json({ error: 'doc must be a JSON object' });
      const base = baseRevision(req.get('if-match'), req.body?.revision);
      if (base === 'invalid')
        return res.status(400).json({ error: 'revision must be a positive integer (If-Match: "<revision>")' });
      const userId = req.user!.id;

      if (base !== null) {
        const updated = await db.query<SeriesRow>(
          `update series_covenants
           set doc = $3, name = $4, revision = revision + 1, updated_at = now()
           where user_id = $1 and series_key = $2 and ($5::integer is null or revision = $5::integer)
           returning ${COLUMNS}`,
          [userId, key, JSON.stringify(doc), name, base === '*' ? null : base],
        );
        const row = updated.rows[0];
        if (row) {
          res.set('ETag', etagOf(row.revision));
          return res.json({ series: full(row) });
        }
      } else {
        // No base: only a brand-new series may be written. The insert
        // yields nothing when the row exists (the unique key decides, so
        // two racing creators cannot both win).
        const created = await db.query<SeriesRow>(
          `insert into series_covenants (user_id, series_key, name, doc) values ($1, $2, $3, $4)
           on conflict (user_id, series_key) do nothing
           returning ${COLUMNS}`,
          [userId, key, name, JSON.stringify(doc)],
        );
        const row = created.rows[0];
        if (row) {
          res.set('ETag', etagOf(row.revision));
          return res.status(201).json({ series: full(row) });
        }
      }

      // Not written: there is no such series for this account (404,
      // existence not leaked), or the base is missing (428) / stale
      // (409), both with the current copy.
      const current = await db.query<SeriesRow>(
        `select ${COLUMNS} from series_covenants where user_id = $1 and series_key = $2`,
        [userId, key],
      );
      const row = current.rows[0];
      if (!row) return res.status(404).json(notFound);
      res.set('ETag', etagOf(row.revision));
      if (base === null)
        return res.status(428).json({ error: 'revision required (If-Match header or body.revision)', series: full(row) });
      return res
        .status(409)
        .json({ error: 'revision conflict: the shelf copy has changed', code: HTTP_CODES.seriesConflict, series: full(row) });
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:key', async (req, res, next) => {
    try {
      const result = await db.query(
        'delete from series_covenants where user_id = $1 and series_key = $2 returning id',
        [req.user!.id, seriesKey(req.params.key)],
      );
      if (!result.rows.length) return res.status(404).json(notFound);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
