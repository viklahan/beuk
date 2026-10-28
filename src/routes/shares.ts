import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { readCookie, requireAuth } from '../auth.js';
import type { Db } from '../db.js';
import { HTTP_CODES } from '../help/codes.js';
import { renderSnapshot, type Snapshot } from '../shares/render.js';
import { hydrateDoc } from '../pictures.js';
import {
  readerHeaders,
  renderGonePage,
  renderNotFoundPage,
  renderReaderPage,
} from '../shares/reader.js';

/**
 * Beta-reader share links.
 *
 * Owner surface (signed in, /api/shares — every query owner-scoped by
 * the session's user id, never the request; another writer's share or
 * comment answers 404, so existence is not leaked):
 *   POST   /api/shares                         create from a shelf manuscript → token ONCE
 *   GET    /api/shares[?manuscriptId=]         list (reader + comment counts, status)
 *   GET    /api/shares/comments?manuscriptId=  every comment on that manuscript's shares
 *   PUT    /api/shares/:id                     expiry / comment settings
 *   POST   /api/shares/:id/republish           refresh the frozen copy from the shelf
 *   POST   /api/shares/:id/revoke              close the link (410 from then on)
 *   DELETE /api/shares/:id                     remove the share and its comments
 *   GET    /api/shares/:id/comments
 *   POST   /api/shares/:id/comments/:cid/resolve | /unresolve
 *   DELETE /api/shares/:id/comments/:cid
 *
 * Public surface (no account, /read — Caddy proxies /read* to the app):
 *   GET  /read/:token[?c=n]        the read-only reader page, chapter n
 *   GET  /read/:token/img/:id      a picture from the frozen copy
 *   GET  /read/:token/comments     the share's comments (no owner data, no IP hash)
 *   POST /read/:token/comments     leave a comment (rate-limited, capped, honeypot)
 * Revoked or expired → a calm 410 page (JSON 410 on the comment API).
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_RE = /^[A-Za-z0-9_-]{1,100}$/;

export const COMMENT_BODY_MAX = 2000;
export const READER_NAME_MAX = 60;
export const QUOTE_MAX = 500;

export interface ShareLimits {
  /** Comments one client IP may post to one share per window. */
  perIp: number;
  perIpWindowMs: number;
  /** Comments one share may receive in total per window. */
  perShare: number;
  perShareWindowMs: number;
}

export const DEFAULT_SHARE_LIMITS: ShareLimits = {
  perIp: 10,
  perIpWindowMs: 10 * 60 * 1000,
  perShare: 200,
  perShareWindowMs: 60 * 60 * 1000,
};

/** In-memory sliding-window limiter (per app instance — the deployment
 *  is a single app process, the same proportionality as the Founders'
 *  intake throttle). check() counts the attempt only when allowed. */
export function createShareLimiter(limits: ShareLimits, clock: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  const recent = (key: string, windowMs: number, nowMs: number) =>
    (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  return {
    check(ip: string, shareId: string): 'ok' | 'ip' | 'share' {
      const nowMs = clock();
      const ipKey = `ip:${shareId}:${ip}`;
      const shareKey = `share:${shareId}`;
      const ipHits = recent(ipKey, limits.perIpWindowMs, nowMs);
      const shareHits = recent(shareKey, limits.perShareWindowMs, nowMs);
      if (ipHits.length >= limits.perIp) return 'ip';
      if (shareHits.length >= limits.perShare) return 'share';
      ipHits.push(nowMs);
      shareHits.push(nowMs);
      hits.set(ipKey, ipHits);
      hits.set(shareKey, shareHits);
      if (hits.size > 5000) {
        const maxWin = Math.max(limits.perIpWindowMs, limits.perShareWindowMs);
        for (const [k, times] of hits) if (!times.some((t) => nowMs - t < maxWin)) hits.delete(k);
      }
      return 'ok';
    },
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The client's address. In production Caddy is the only entry point,
 *  and Caddy does not trust an incoming X-Forwarded-For from clients
 *  (no trusted_proxies configured): it sets the header to the real
 *  peer itself, so the LAST entry is the address Caddy saw.
 *  https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults
 *  Direct connections (tests) fall back to the socket address. */
export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  if (raw) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress ?? 'unknown';
}

interface ShareRow {
  id: string;
  owner_id: string;
  manuscript_id: string | null;
  title: string;
  snapshot: Snapshot;
  published_at: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  allow_comments: boolean;
  reader_name_required: boolean;
  reader_count?: string | number;
  comment_count?: string | number;
  open_comment_count?: string | number;
}

function status(row: Pick<ShareRow, 'revoked_at' | 'expires_at'>, now: Date): 'active' | 'revoked' | 'expired' {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}

function shareJson(row: ShareRow, now: Date) {
  return {
    id: row.id,
    manuscriptId: row.manuscript_id,
    title: row.title,
    status: status(row, now),
    createdAt: iso(row.created_at),
    publishedAt: iso(row.published_at),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    allowComments: row.allow_comments,
    readerNameRequired: row.reader_name_required,
    sectionCount: Array.isArray(row.snapshot?.sections) ? row.snapshot.sections.length : 0,
    readerCount: Number(row.reader_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    openCommentCount: Number(row.open_comment_count ?? 0),
  };
}

interface CommentRow {
  id: string;
  share_id: string;
  section_id: string;
  paragraph_index: number | null;
  quote: string | null;
  body: string;
  reader_name: string;
  created_at: string;
  resolved_at: string | null;
  share_title?: string;
}

function ownerCommentJson(c: CommentRow) {
  return {
    id: c.id,
    shareId: c.share_id,
    shareTitle: c.share_title,
    sectionId: c.section_id,
    paragraph: c.paragraph_index,
    quote: c.quote,
    body: c.body,
    readerName: c.reader_name,
    createdAt: iso(c.created_at),
    resolvedAt: iso(c.resolved_at),
  };
}

/** Parse an expiry from the request: undefined = not given, null =
 *  never expires, Date = a future moment. 'bad' on anything else. */
function parseExpiry(body: Record<string, unknown>, now: Date): Date | null | undefined | 'bad' {
  if (body.expiresAt === null) return null;
  if (typeof body.expiresAt === 'string') {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return 'bad';
    return d;
  }
  if (typeof body.expiresInDays === 'number') {
    const days = body.expiresInDays;
    if (!Number.isFinite(days) || days <= 0 || days > 3650) return 'bad';
    return new Date(now.getTime() + days * 86_400_000);
  }
  if (body.expiresAt !== undefined || body.expiresInDays !== undefined) return 'bad';
  return undefined;
}

const SHARE_COLS = `s.id, s.owner_id, s.manuscript_id, s.title, s.snapshot, s.published_at, s.created_at,
  s.expires_at, s.revoked_at, s.allow_comments, s.reader_name_required`;

export function shareOwnerRoutes(db: Db, now: () => Date = () => new Date()): Router {
  const router = Router();
  router.use(requireAuth(db));

  const loadOwned = async (req: Request): Promise<ShareRow | null> => {
    if (!UUID_RE.test(req.params.id)) return null;
    const r = await db.query<ShareRow>(
      `select ${SHARE_COLS} from shares s where s.id = $1 and s.owner_id = $2`,
      [req.params.id, req.user!.id],
    );
    return r.rows[0] ?? null;
  };

  router.post('/', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const manuscriptId = typeof body.manuscriptId === 'string' ? body.manuscriptId : '';
      if (!UUID_RE.test(manuscriptId)) return res.status(400).json({ error: 'manuscriptId is required' });
      const m = await db.query<{ id: string; title: string; doc: unknown }>(
        'select id, title, doc from manuscripts where id = $1 and user_id = $2',
        [manuscriptId, req.user!.id],
      );
      const manuscript = m.rows[0];
      if (!manuscript) return res.status(404).json({ error: 'manuscript not found' });
      const expiry = parseExpiry(body, now());
      if (expiry === 'bad')
        return res.status(400).json({ error: 'expiresAt must be a future date (or null for no expiry)' });
      const { snapshot, images } = renderSnapshot(await hydrateDoc(db, req.user!.id, manuscript.doc), manuscript.title);
      const title =
        (typeof body.title === 'string' && body.title.trim().slice(0, 200)) || snapshot.title;
      const token = randomBytes(24).toString('base64url');
      const created = await db.query<ShareRow>(
        `insert into shares (owner_id, manuscript_id, token_hash, title, snapshot, images, expires_at,
           allow_comments, reader_name_required)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, owner_id, manuscript_id, title, snapshot, published_at, created_at, expires_at,
           revoked_at, allow_comments, reader_name_required`,
        [
          req.user!.id,
          manuscript.id,
          sha256(token),
          title,
          JSON.stringify(snapshot),
          JSON.stringify(images),
          expiry ? expiry.toISOString() : null,
          body.allowComments !== false,
          body.readerNameRequired !== false,
        ],
      );
      // The token is returned exactly once; only its hash is stored.
      return res.status(201).json({
        share: shareJson(created.rows[0], now()),
        token,
        path: `/read/${token}`,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const filter = typeof req.query.manuscriptId === 'string' ? req.query.manuscriptId : null;
      if (filter !== null && !UUID_RE.test(filter)) return res.json({ shares: [] });
      const r = await db.query<ShareRow>(
        `select ${SHARE_COLS},
           (select count(*) from share_readers r where r.share_id = s.id) as reader_count,
           (select count(*) from share_comments c where c.share_id = s.id) as comment_count,
           (select count(*) from share_comments c where c.share_id = s.id and c.resolved_at is null) as open_comment_count
         from shares s
         where s.owner_id = $1 and ($2::uuid is null or s.manuscript_id = $2::uuid)
         order by s.created_at desc`,
        [req.user!.id, filter],
      );
      const at = now();
      return res.json({ shares: r.rows.map((row) => shareJson(row, at)) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/comments', async (req, res, next) => {
    try {
      const filter = typeof req.query.manuscriptId === 'string' ? req.query.manuscriptId : '';
      if (!UUID_RE.test(filter)) return res.status(400).json({ error: 'manuscriptId is required' });
      const r = await db.query<CommentRow>(
        `select c.id, c.share_id, c.section_id, c.paragraph_index, c.quote, c.body, c.reader_name,
           c.created_at, c.resolved_at, s.title as share_title
         from share_comments c join shares s on s.id = c.share_id
         where s.owner_id = $1 and s.manuscript_id = $2
         order by c.created_at desc`,
        [req.user!.id, filter],
      );
      return res.json({ comments: r.rows.map(ownerCommentJson) });
    } catch (err) {
      return next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const share = await loadOwned(req);
      if (!share) return res.status(404).json({ error: 'share not found' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const expiry = parseExpiry(body, now());
      if (expiry === 'bad')
        return res.status(400).json({ error: 'expiresAt must be a future date (or null for no expiry)' });
      const allow = typeof body.allowComments === 'boolean' ? body.allowComments : null;
      const nameReq = typeof body.readerNameRequired === 'boolean' ? body.readerNameRequired : null;
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : null;
      if (expiry === undefined && allow === null && nameReq === null && title === null)
        return res.status(400).json({ error: 'nothing to update' });
      const r = await db.query<ShareRow>(
        `update shares s set
           expires_at = case when $3::boolean then $4::timestamptz else s.expires_at end,
           allow_comments = coalesce($5, s.allow_comments),
           reader_name_required = coalesce($6, s.reader_name_required),
           title = coalesce($7, s.title)
         where s.id = $1 and s.owner_id = $2
         returning ${SHARE_COLS}`,
        [
          share.id,
          req.user!.id,
          expiry !== undefined,
          expiry ? expiry.toISOString() : null,
          allow,
          nameReq,
          title,
        ],
      );
      return res.json({ share: shareJson(r.rows[0], now()) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/republish', async (req, res, next) => {
    try {
      const share = await loadOwned(req);
      if (!share) return res.status(404).json({ error: 'share not found' });
      if (share.revoked_at) return res.status(409).json({ error: 'this link is revoked — create a new one instead' });
      if (!share.manuscript_id)
        return res.status(409).json({ error: 'the manuscript this copy came from is no longer on your shelf' });
      const m = await db.query<{ title: string; doc: unknown }>(
        'select title, doc from manuscripts where id = $1 and user_id = $2',
        [share.manuscript_id, req.user!.id],
      );
      if (!m.rows[0])
        return res.status(409).json({ error: 'the manuscript this copy came from is no longer on your shelf' });
      const { snapshot, images } = renderSnapshot(await hydrateDoc(db, req.user!.id, m.rows[0].doc), m.rows[0].title);
      const r = await db.query<ShareRow>(
        `update shares s set snapshot = $3, images = $4, published_at = now()
         where s.id = $1 and s.owner_id = $2 returning ${SHARE_COLS}`,
        [share.id, req.user!.id, JSON.stringify(snapshot), JSON.stringify(images)],
      );
      return res.json({ share: shareJson(r.rows[0], now()) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/revoke', async (req, res, next) => {
    try {
      const share = await loadOwned(req);
      if (!share) return res.status(404).json({ error: 'share not found' });
      const r = await db.query<ShareRow>(
        `update shares s set revoked_at = coalesce(s.revoked_at, now())
         where s.id = $1 and s.owner_id = $2 returning ${SHARE_COLS}`,
        [share.id, req.user!.id],
      );
      return res.json({ share: shareJson(r.rows[0], now()) });
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const share = await loadOwned(req);
      if (!share) return res.status(404).json({ error: 'share not found' });
      await db.query('delete from shares where id = $1 and owner_id = $2', [share.id, req.user!.id]);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id/comments', async (req, res, next) => {
    try {
      const share = await loadOwned(req);
      if (!share) return res.status(404).json({ error: 'share not found' });
      const r = await db.query<CommentRow>(
        `select c.id, c.share_id, c.section_id, c.paragraph_index, c.quote, c.body, c.reader_name,
           c.created_at, c.resolved_at, s.title as share_title
         from share_comments c join shares s on s.id = c.share_id
         where c.share_id = $1 and s.owner_id = $2 order by c.created_at desc`,
        [share.id, req.user!.id],
      );
      return res.json({ comments: r.rows.map(ownerCommentJson) });
    } catch (err) {
      return next(err);
    }
  });

  const setResolved = (resolved: boolean) => async (req: Request, res: Response, next: (e: unknown) => void) => {
    try {
      if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.cid))
        return res.status(404).json({ error: 'comment not found' });
      const r = await db.query<CommentRow>(
        `update share_comments c set resolved_at = ${resolved ? 'coalesce(c.resolved_at, now())' : 'null'}
         from shares s
         where c.id = $1 and c.share_id = $2 and s.id = c.share_id and s.owner_id = $3
         returning c.id, c.share_id, c.section_id, c.paragraph_index, c.quote, c.body, c.reader_name,
           c.created_at, c.resolved_at`,
        [req.params.cid, req.params.id, req.user!.id],
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'comment not found' });
      return res.json({ comment: ownerCommentJson(r.rows[0]) });
    } catch (err) {
      return next(err);
    }
  };
  router.post('/:id/comments/:cid/resolve', setResolved(true));
  router.post('/:id/comments/:cid/unresolve', setResolved(false));

  router.delete('/:id/comments/:cid', async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.cid))
        return res.status(404).json({ error: 'comment not found' });
      const r = await db.query(
        `delete from share_comments c using shares s
         where c.id = $1 and c.share_id = $2 and s.id = c.share_id and s.owner_id = $3
         returning c.id`,
        [req.params.cid, req.params.id, req.user!.id],
      );
      if (!r.rows.length) return res.status(404).json({ error: 'comment not found' });
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

interface PublicShare {
  id: string;
  snapshot: Snapshot;
  expires_at: string | null;
  revoked_at: string | null;
  allow_comments: boolean;
  reader_name_required: boolean;
}

const READER_COOKIE = 'beuk_reader';

export function shareReaderRoutes(
  db: Db,
  opts: { now?: () => Date; limits?: ShareLimits; cookieSecure?: boolean } = {},
): Router {
  const now = opts.now ?? (() => new Date());
  const limiter = createShareLimiter(opts.limits ?? DEFAULT_SHARE_LIMITS);
  const router = Router();

  const find = async (token: string): Promise<PublicShare | null> => {
    if (!TOKEN_RE.test(token)) return null;
    const r = await db.query<PublicShare>(
      `select id, snapshot, expires_at, revoked_at, allow_comments, reader_name_required
       from shares where token_hash = $1`,
      [sha256(token)],
    );
    return r.rows[0] ?? null;
  };

  const sendPage = (res: Response, code: number, render: (nonce: string) => string) => {
    const nonce = randomBytes(16).toString('base64');
    res.status(code).set(readerHeaders(nonce)).type('html').send(render(nonce));
  };

  router.get('/:token', async (req, res, next) => {
    try {
      const share = await find(req.params.token);
      if (!share) return sendPage(res, 404, (n) => renderNotFoundPage(n));
      const st = status(share, now());
      if (st !== 'active') return sendPage(res, 410, (n) => renderGonePage(n, st));
      // Reader count: one opaque per-browser cookie, stored only hashed.
      let visitor = readCookie(req, READER_COOKIE);
      if (!visitor || !/^[A-Za-z0-9_-]{16,64}$/.test(visitor)) {
        visitor = randomBytes(18).toString('base64url');
        res.cookie(READER_COOKIE, visitor, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/read',
          secure: !!opts.cookieSecure,
          maxAge: 365 * 86_400_000,
        });
      }
      await db.query(
        `insert into share_readers (share_id, visitor_hash) values ($1, $2) on conflict do nothing`,
        [share.id, sha256(`${share.id}:${visitor}`)],
      );
      const c = Number.parseInt(String(req.query.c ?? '0'), 10);
      return sendPage(res, 200, (nonce) =>
        renderReaderPage({
          nonce,
          token: req.params.token,
          snapshot: share.snapshot,
          chapter: Number.isFinite(c) ? c : 0,
          allowComments: share.allow_comments,
          readerNameRequired: share.reader_name_required,
        }),
      );
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:token/img/:imageId', async (req, res, next) => {
    try {
      const share = await find(req.params.token);
      if (!share || status(share, now()) !== 'active') return res.status(404).end();
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(req.params.imageId)) return res.status(404).end();
      const r = await db.query<{ img: { mediaType: string; data: string } | null }>(
        'select images -> $2 as img from shares where id = $1',
        [share.id, req.params.imageId],
      );
      const img = r.rows[0]?.img;
      if (!img || !/^image\/(jpeg|png|gif|webp)$/.test(img.mediaType)) return res.status(404).end();
      res.set({
        'Content-Type': img.mediaType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'",
      });
      return res.send(Buffer.from(img.data, 'base64'));
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:token/comments', async (req, res, next) => {
    try {
      const share = await find(req.params.token);
      if (!share) return res.status(404).json({ error: 'reading copy not found' });
      if (status(share, now()) !== 'active') return res.status(410).json({ error: 'this reading copy is closed', code: HTTP_CODES.readingCopyClosed });
      const r = await db.query<CommentRow>(
        `select id, section_id, paragraph_index, quote, body, reader_name, created_at
         from share_comments where share_id = $1 order by created_at asc limit 1000`,
        [share.id],
      );
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return res.json({
        comments: r.rows.map((c) => ({
          id: c.id,
          sectionId: c.section_id,
          paragraph: c.paragraph_index,
          quote: c.quote,
          body: c.body,
          readerName: c.reader_name,
          createdAt: iso(c.created_at),
        })),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:token/comments', async (req, res, next) => {
    try {
      const share = await find(req.params.token);
      if (!share) return res.status(404).json({ error: 'reading copy not found' });
      if (status(share, now()) !== 'active') return res.status(410).json({ error: 'this reading copy is closed', code: HTTP_CODES.readingCopyClosed });
      if (!share.allow_comments) return res.status(403).json({ error: 'comments are turned off for this copy' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Honeypot: a hidden field people never fill. A bot that fills it
      // gets an ordinary-looking answer and nothing is stored.
      if (typeof body.website === 'string' && body.website.trim()) {
        return res.status(202).json({ ok: true });
      }
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!text) return res.status(400).json({ error: 'please write a comment' });
      if (text.length > COMMENT_BODY_MAX)
        return res.status(400).json({ error: `comments can be up to ${COMMENT_BODY_MAX} characters` });
      const name = typeof body.readerName === 'string' ? body.readerName.trim() : '';
      if (name.length > READER_NAME_MAX)
        return res.status(400).json({ error: `names can be up to ${READER_NAME_MAX} characters` });
      if (share.reader_name_required && !name)
        return res.status(400).json({ error: 'please add your name so the writer knows who wrote this' });
      const sectionId = typeof body.sectionId === 'string' ? body.sectionId : '';
      const sections = Array.isArray(share.snapshot?.sections) ? share.snapshot.sections : [];
      if (!SECTION_RE.test(sectionId) || !sections.some((s) => s.id === sectionId))
        return res.status(400).json({ error: 'that chapter is not part of this reading copy' });
      const paragraph =
        typeof body.paragraph === 'number' && Number.isInteger(body.paragraph) && body.paragraph >= 0 && body.paragraph < 100000
          ? body.paragraph
          : null;
      const quote = typeof body.quote === 'string' ? body.quote.replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX) : '';
      const ip = clientIp(req);
      const verdict = limiter.check(ip, share.id);
      if (verdict !== 'ok') {
        return res.status(429).json({
          error:
            verdict === 'ip'
              ? 'that’s a lot of comments in a short while — please wait a few minutes and try again'
              : 'this reading copy is receiving a lot of comments right now — please try again later',
        });
      }
      const r = await db.query<CommentRow>(
        `insert into share_comments (share_id, section_id, paragraph_index, quote, body, reader_name, ip_hash)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, section_id, paragraph_index, quote, body, reader_name, created_at`,
        [share.id, sectionId, paragraph, quote || null, text, name, sha256(`${share.id}:${ip}`)],
      );
      const c = r.rows[0];
      return res.status(201).json({
        comment: {
          id: c.id,
          sectionId: c.section_id,
          paragraph: c.paragraph_index,
          quote: c.quote,
          body: c.body,
          readerName: c.reader_name,
          createdAt: iso(c.created_at),
        },
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
