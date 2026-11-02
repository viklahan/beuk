import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';
import { HTTP_CODES } from '../help/codes.js';
import { collectUnusedPictures, isMissingPictureError, missingPictures, SHA256_RE } from '../pictures.js';

/**
 * My themes (migration 022): a writer's own custom themes, per account.
 * The same shape as the series Covenant (src/routes/series-covenants.ts):
 *
 *   GET    /api/themes        → { themes: [{ key, name, revision, updated_at }] }
 *   GET    /api/themes/:key   → { theme: { key, name, revision, updated_at, doc } } + ETag
 *   PUT    /api/themes/:key   { name, doc, revision? } (or If-Match) → 201 created | 200 updated
 *                             | 409 stale (with the current copy) | 428 no base on an existing row
 *                             | 404 a base for a row that is not there | 422 assets not held
 *   DELETE /api/themes/:key   (If-Match optional) → 204 | 409 stale (with the current copy) | 404
 *
 * Every query is owner-scoped (user_id from the session, never the
 * request): another account's theme is "not found" exactly like a key
 * nobody has. The doc is 1.0's custom-theme object plus `assets`, the
 * uploaded fonts and flourishes it wears, each named by the SHA-256 of
 * its bytes; the bytes are the account's own stored pictures, uploaded
 * first through /api/pictures, and the theme names them (the
 * user_theme_pictures rows) so they are never collected while it does.
 * The doc is untrusted on the way back too: the studio passes it
 * through the same safe path as a book's theme.
 */

/** A theme's key: 1.0's custom theme id (uid(): letters and digits), or an imported one with - and _. */
export const THEME_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const THEME_NAME_MAX = 120;
/** The doc's JSON, in bytes: 1.0's custom theme is about 1-2 KB; the asset bytes never sit in the row. */
export const THEME_DOC_MAX_BYTES = 64 * 1024;
export const THEMES_PER_USER = 200;
/** Assets a theme may carry (1.0's theme names at most 5 fonts and 2 flourishes; room for duplicates' history). */
export const THEME_ASSETS_MAX = 32;
const ASSET_FIELD_MAX = 200;
/** The media types 1.0 uploads for each kind (FONT_MEDIA; handleFlourishFile). */
const ASSET_MEDIA: Record<string, RegExp> = {
  font: /^font\/(?:ttf|otf)$/,
  flourish: /^image\/(?:svg\+xml|png)$/,
};
/** An asset's own fields besides kind / sha256 / mediaType (1.0's fonts / images entries, less their data). */
const ASSET_FIELDS = new Set(['id', 'name', 'family', 'ext', 'file', 'credit', 'flourish']);

interface ThemeRow {
  id?: string;
  theme_key: string;
  name: string;
  doc: unknown;
  revision: number;
  updated_at: string;
}

const summary = (row: ThemeRow) => ({ key: row.theme_key, name: row.name, revision: row.revision, updated_at: row.updated_at });
const full = (row: ThemeRow) => ({ ...summary(row), doc: row.doc });
const etagOf = (revision: number): string => `"${revision}"`;

/** The revision a PUT or DELETE is based on: If-Match (`"3"`, `W/"3"` or `*`) wins over body.revision. null = neither
 *  given, 'invalid' = given but unreadable. The series route's rules. */
function baseRevision(header: string | undefined, bodyRevision: unknown): number | '*' | 'invalid' | null {
  if (typeof header === 'string' && header.trim() !== '') {
    const raw = header.trim();
    if (raw === '*') return '*';
    const m = /^(?:W\/)?"(\d{1,9})"$/.exec(raw) ?? /^(\d{1,9})$/.exec(raw);
    return m ? Number(m[1]) : 'invalid';
  }
  if (bodyRevision === undefined || bodyRevision === null) return null;
  return typeof bodyRevision === 'number' && Number.isInteger(bodyRevision) && bodyRevision > 0 ? bodyRevision : 'invalid';
}

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The doc's shape: 1.0's custom theme ({ id: the key, theme: an object, name }) plus its assets, each named by hash,
 *  never carrying bytes. Returns the error message, or the hashes the doc names. */
export function checkThemeDoc(key: string, doc: unknown): { error: string } | { hashes: string[] } {
  if (!isRec(doc)) return { error: 'doc must be a JSON object' };
  if (doc.id !== key) return { error: "the key in the path is not the theme's id" };
  if (!isRec(doc.theme)) return { error: 'doc.theme must be a JSON object' };
  if (doc.name !== undefined && typeof doc.name !== 'string') return { error: 'doc.name must be a string' };
  const assets = doc.assets === undefined ? [] : doc.assets;
  if (!Array.isArray(assets) || assets.length > THEME_ASSETS_MAX) return { error: `doc.assets must be a list of at most ${THEME_ASSETS_MAX}` };
  const hashes: string[] = [];
  for (const a of assets) {
    if (!isRec(a)) return { error: 'each asset must be a JSON object' };
    const media = typeof a.kind === 'string' && Object.hasOwn(ASSET_MEDIA, a.kind) ? ASSET_MEDIA[a.kind]! : null;
    if (!media) return { error: "an asset's kind must be font or flourish" };
    if (typeof a.sha256 !== 'string' || !SHA256_RE.test(a.sha256)) return { error: "an asset's sha256 must be 64 hex characters" };
    if (typeof a.mediaType !== 'string' || !media.test(a.mediaType)) return { error: `a ${a.kind}'s mediaType is not one 1.0 uploads` };
    for (const [k, v] of Object.entries(a)) {
      if (k === 'kind' || k === 'sha256' || k === 'mediaType') continue;
      if (!ASSET_FIELDS.has(k)) return { error: `an asset carries no field "${k.slice(0, 40)}" (its bytes go to /api/pictures)` };
      if (k === 'flourish' ? typeof v !== 'boolean' : typeof v !== 'string' || v.length > ASSET_FIELD_MAX)
        return { error: `an asset's ${k} must be ${k === 'flourish' ? 'true or false' : `a string of at most ${ASSET_FIELD_MAX} characters`}` };
    }
    if (!hashes.includes(a.sha256)) hashes.push(a.sha256);
  }
  return { hashes };
}

const notFound = { error: 'theme not found' };
const COLUMNS = 'id, theme_key, name, doc, revision, updated_at';

/** Rewrite which pictures one theme names (inside the write's transaction). The foreign key refuses a name the account
 *  lost meanwhile. */
async function writeThemePictureRefs(tx: Db, themeId: string, userId: string, hashes: string[]): Promise<void> {
  await tx.query('delete from user_theme_pictures where theme_id = $1', [themeId]);
  if (hashes.length)
    await tx.query(
      `insert into user_theme_pictures (theme_id, user_id, sha256)
       select $1, $2, h from unnest($3::text[]) as h on conflict do nothing`,
      [themeId, userId, hashes],
    );
}

export function userThemeRoutes(db: Db, config: Config): Router {
  const router = Router();
  router.use(requireAuth(db));

  /** After a write that may have dropped a picture: collect what nothing names. Best effort, never fails the answer. */
  const collect = async (userId: string): Promise<void> => {
    try {
      await collectUnusedPictures(db, userId, config.pictureGcGraceSeconds);
    } catch (err) {
      console.error('pictures: collecting unused pictures failed', err);
    }
  };
  const current = async (userId: string, key: string): Promise<ThemeRow | undefined> =>
    (await db.query<ThemeRow>(`select ${COLUMNS} from user_themes where user_id = $1 and theme_key = $2`, [userId, key])).rows[0];

  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query<ThemeRow>(
        'select theme_key, name, revision, updated_at from user_themes where user_id = $1 order by created_at, theme_key',
        [req.user!.id],
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ themes: result.rows.map(summary) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      const row = THEME_KEY_RE.test(key) ? await current(req.user!.id, key) : undefined;
      // 404 (not 403) for other users' themes: existence is not leaked.
      if (!row) return res.status(404).json(notFound);
      res.set('ETag', etagOf(row.revision));
      res.set('Cache-Control', 'no-store');
      return res.json({ theme: full(row) });
    } catch (err) {
      return next(err);
    }
  });

  // Optimistic concurrency, as for the series Covenant: an update names
  // the revision it was based on and lands only while that is still the
  // stored one (check and write are one statement). A new theme is
  // created only when no revision is given, and only while the account
  // holds fewer than THEMES_PER_USER (the count is in the same insert).
  router.put('/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      if (!THEME_KEY_RE.test(key)) return res.status(400).json({ error: 'the key must be 1 to 64 letters, digits, - or _' });
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > THEME_NAME_MAX)
        return res.status(400).json({ error: `name is required (1 to ${THEME_NAME_MAX} characters)` });
      const doc = req.body?.doc;
      const checked = checkThemeDoc(key, doc);
      if ('error' in checked) return res.status(400).json({ error: checked.error });
      const json = JSON.stringify(doc);
      if (Buffer.byteLength(json) > THEME_DOC_MAX_BYTES)
        return res.status(413).json({ error: 'the theme is too large', limitBytes: THEME_DOC_MAX_BYTES });
      const base = baseRevision(req.get('if-match'), req.body?.revision);
      if (base === 'invalid')
        return res.status(400).json({ error: 'revision must be a positive integer (If-Match: "<revision>")' });
      const userId = req.user!.id;
      // The bytes come first (POST /api/pictures/missing, PUT /api/pictures/:sha): a theme never names a picture the
      // account does not hold. The same answer as a book naming one (manuscripts, 422).
      const missing = await missingPictures(db, userId, checked.hashes);
      if (missing.length)
        return res.status(422).json({ error: 'the theme names fonts or flourishes this account does not hold: upload them, then save again', missingPictures: missing });

      let row: ThemeRow | undefined;
      let created = false;
      try {
        row = await db.tx(async (tx) => {
          let r: ThemeRow | undefined;
          if (base !== null) {
            r = (
              await tx.query<ThemeRow>(
                `update user_themes
                 set doc = $3, name = $4, revision = revision + 1, updated_at = now()
                 where user_id = $1 and theme_key = $2 and ($5::integer is null or revision = $5::integer)
                 returning ${COLUMNS}`,
                [userId, key, json, name, base === '*' ? null : base],
              )
            ).rows[0];
          } else {
            r = (
              await tx.query<ThemeRow>(
                `insert into user_themes (user_id, theme_key, name, doc)
                 select $1, $2, $3, $4
                 where (select count(*) from user_themes where user_id = $1) < $5
                 on conflict (user_id, theme_key) do nothing
                 returning ${COLUMNS}`,
                [userId, key, name, json, THEMES_PER_USER],
              )
            ).rows[0];
            created = !!r;
          }
          if (r) await writeThemePictureRefs(tx, r.id!, userId, checked.hashes);
          return r;
        });
      } catch (err) {
        // a picture collected between the check and the write
        if (isMissingPictureError(err))
          return res.status(422).json({ error: 'the theme names fonts or flourishes this account does not hold: upload them, then save again', missingPictures: await missingPictures(db, userId, checked.hashes) });
        throw err;
      }
      if (row) {
        if (!created) await collect(userId);
        res.set('ETag', etagOf(row.revision));
        return res.status(created ? 201 : 200).json({ theme: full(row) });
      }

      // Not written: no such theme for this account (404, existence not leaked), the account is full (413), or the
      // base is missing (428) / stale (409), both with the current copy.
      const cur = await current(userId, key);
      if (!cur) {
        if (base !== null) return res.status(404).json(notFound);
        return res.status(413).json({ error: `My themes holds at most ${THEMES_PER_USER} themes`, limitThemes: THEMES_PER_USER });
      }
      res.set('ETag', etagOf(cur.revision));
      if (base === null) return res.status(428).json({ error: 'revision required (If-Match header or body.revision)', theme: full(cur) });
      return res.status(409).json({ error: 'revision conflict: the account copy has changed', code: HTTP_CODES.themeConflict, theme: full(cur) });
    } catch (err) {
      return next(err);
    }
  });

  // A delete may name the revision it saw (If-Match): a theme changed
  // elsewhere since is kept, and the current copy comes back (409).
  router.delete('/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      if (!THEME_KEY_RE.test(key)) return res.status(404).json(notFound);
      const base = baseRevision(req.get('if-match'), undefined);
      if (base === 'invalid') return res.status(400).json({ error: 'If-Match must name a revision ("<revision>")' });
      const userId = req.user!.id;
      const result = await db.query(
        `delete from user_themes where user_id = $1 and theme_key = $2 and ($3::integer is null or revision = $3::integer) returning id`,
        [userId, key, base === '*' || base === null ? null : base],
      );
      if (result.rows.length) {
        await collect(userId);
        return res.status(204).end();
      }
      const cur = await current(userId, key);
      if (!cur) return res.status(404).json(notFound);
      res.set('ETag', etagOf(cur.revision));
      return res.status(409).json({ error: 'revision conflict: the account copy has changed', code: HTTP_CODES.themeConflict, theme: full(cur) });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
