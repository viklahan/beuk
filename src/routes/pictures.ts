import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';
import { canonicalBase64Sha, collectUnusedPictures, PICTURE_MEDIA_RE, SHA256_RE } from '../pictures.js';

/**
 * Shelf pictures (src/pictures.ts): the studio uploads each picture of a
 * book once, then saves the doc naming it. Every query is owner-scoped
 * (user_id from the session, never the request): another account's
 * picture is "not found" exactly like a hash nobody has, so not even its
 * existence leaks. Deduplication is per account for the same reason.
 *
 *   POST /api/pictures/missing  { hashes: [sha256…] } → { missing: [...] }
 *   PUT  /api/pictures/:sha256  { mediaType, data }   → 201 stored | 200 already held
 *   GET  /api/pictures/:sha256                        → { picture: { sha256, mediaType, bytes, data } }
 *
 * There is no delete route: a picture goes when no shelf book names it
 * (collectUnusedPictures, run after doc writes and book deletes).
 */
export const MISSING_MAX_HASHES = 10_000;

export function pictureRoutes(db: Db, config: Config): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.post('/missing', async (req, res, next) => {
    try {
      const hashes = req.body?.hashes;
      if (!Array.isArray(hashes) || hashes.length > MISSING_MAX_HASHES || !hashes.every((h) => typeof h === 'string' && SHA256_RE.test(h)))
        return res.status(400).json({ error: `hashes must be a list of at most ${MISSING_MAX_HASHES} sha256 hex strings` });
      const unique = [...new Set(hashes as string[])];
      // Asking counts as touching: a held picture about to be named again
      // is not collected between this answer and the doc write.
      const held = unique.length
        ? await db.query<{ sha256: string }>(
            `update pictures set touched_at = now()
             where user_id = $1 and sha256 = any($2::text[]) returning sha256`,
            [req.user!.id, unique],
          )
        : { rows: [] };
      const have = new Set(held.rows.map((r) => r.sha256));
      return res.json({ missing: unique.filter((h) => !have.has(h)) });
    } catch (err) {
      return next(err);
    }
  });

  router.put('/:sha', async (req, res, next) => {
    try {
      const sha = req.params.sha;
      if (!SHA256_RE.test(sha)) return res.status(404).json({ error: 'picture not found' });
      const mediaType = req.body?.mediaType;
      const data = req.body?.data;
      if (typeof mediaType !== 'string' || !PICTURE_MEDIA_RE.test(mediaType))
        return res.status(400).json({ error: 'mediaType must be an image, font, audio or video type, application/pdf, or plain, Markdown or CSV text' });
      if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'data must be base64' });
      if (data.length > Math.ceil(config.pictureMaxBytes / 3) * 4)
        return res.status(413).json({ error: 'picture is too large for the shelf', limitBytes: config.pictureMaxBytes });
      const checked = canonicalBase64Sha(data);
      if (!checked) return res.status(400).json({ error: 'data must be canonical base64' });
      // Content addressing is verified, never trusted: a name always
      // stands for exactly these bytes.
      if (checked.sha256 !== sha) return res.status(400).json({ error: 'sha256 does not match the data' });
      if (checked.bytes > config.pictureMaxBytes)
        return res.status(413).json({ error: 'picture is too large for the shelf', limitBytes: config.pictureMaxBytes });
      const existing = await db.query<{ sha256: string }>(
        'update pictures set touched_at = now() where user_id = $1 and sha256 = $2 returning sha256',
        [req.user!.id, sha],
      );
      if (existing.rows.length) return res.status(200).json({ picture: { sha256: sha, bytes: checked.bytes, stored: false } });
      const used = await db.query<{ n: string | null }>(
        'select coalesce(sum(byte_size), 0)::bigint as n from pictures where user_id = $1',
        [req.user!.id],
      );
      if (Number(used.rows[0]?.n ?? 0) + checked.bytes > config.pictureQuotaBytes) {
        // Room may be held by pictures no book names any more.
        await collectUnusedPictures(db, req.user!.id, config.pictureGcGraceSeconds);
        const again = await db.query<{ n: string | null }>(
          'select coalesce(sum(byte_size), 0)::bigint as n from pictures where user_id = $1',
          [req.user!.id],
        );
        if (Number(again.rows[0]?.n ?? 0) + checked.bytes > config.pictureQuotaBytes)
          return res.status(413).json({ error: 'the shelf has no room for more pictures', quotaBytes: config.pictureQuotaBytes });
      }
      await db.query(
        `insert into pictures (user_id, sha256, media_type, byte_size, data) values ($1, $2, $3, $4, $5)
         on conflict (user_id, sha256) do update set touched_at = now()`,
        [req.user!.id, sha, mediaType, checked.bytes, data],
      );
      return res.status(201).json({ picture: { sha256: sha, bytes: checked.bytes, stored: true } });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:sha', async (req, res, next) => {
    try {
      const sha = req.params.sha;
      if (!SHA256_RE.test(sha)) return res.status(404).json({ error: 'picture not found' });
      const r = await db.query<{ media_type: string; byte_size: number; data: string }>(
        'select media_type, byte_size, data from pictures where user_id = $1 and sha256 = $2',
        [req.user!.id, sha],
      );
      const row = r.rows[0];
      // 404 (not 403) for another account's picture: existence is not leaked.
      if (!row) return res.status(404).json({ error: 'picture not found' });
      // Never cached: every read is checked against the session, so a
      // browser shared by two accounts cannot hand one the other's copy.
      res.set('Cache-Control', 'no-store');
      return res.json({ picture: { sha256: sha, mediaType: row.media_type, bytes: row.byte_size, data: row.data } });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
