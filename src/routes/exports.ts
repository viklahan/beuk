import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { sessionOrScopedBearer } from '../oauth/bearer.js';
import { isUuid, uuidParam } from '../ids.js';
import { keepExportFileIfRowSurvived } from '../exports-store.js';

export const EXPORT_FORMATS = ['epub', 'markdown', 'html', 'print-html', 'docx', 'pdfx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const CONTENT_TYPES: Record<ExportFormat, string> = {
  epub: 'application/epub+zip',
  markdown: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  'print-html': 'text/html; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // M5: produced server-side by a successful pdfx job (see src/jobs/).
  pdfx: 'application/pdf',
};

interface ExportRow {
  id: string;
  manuscript_id: string | null;
  format: ExportFormat;
  preset: string | null;
  filename: string;
  byte_size: string; // bigint comes back from pg as a string
  sha256: string;
  created_at: string;
}

function metadata(row: ExportRow) {
  return {
    id: row.id,
    manuscriptId: row.manuscript_id,
    format: row.format,
    preset: row.preset,
    filename: row.filename,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

/** The filename is client-supplied: keep only its basename so it can
 *  never become a path, and strip characters unsafe in a header. */
function cleanFilename(name: unknown, format: ExportFormat): string {
  const fallback = `beuk-export.${format === 'markdown' ? 'md' : format === 'print-html' ? 'html' : format}`;
  if (typeof name !== 'string' || !name.trim()) return fallback;
  const base = path.basename(name).replace(/["\r\n]/g, '').trim();
  return base || fallback;
}

/**
 * Stream a stored export file to the response. A read stream with no
 * 'error' listener turns a vanished or unreadable file (deleted between
 * the stat and the open, EISDIR, EACCES, an I/O error) into an uncaught
 * exception that kills the whole Node process. Here a failure before
 * any byte is sent becomes the same honest 500 the stat check gives;
 * a failure mid-stream can only abort that one response (the status
 * line is already out).
 */
export function streamFile(file: string, res: Response): void {
  const stream = createReadStream(file);
  stream.on('error', (err) => {
    console.error(`export download: reading ${file} failed`, err);
    if (!res.headersSent) {
      for (const h of ['content-type', 'content-disposition', 'content-length']) res.removeHeader(h);
      res.status(500).json({ error: 'export file is missing from storage' });
    } else {
      res.destroy(err);
    }
  });
  // If the client goes away, stop reading the file.
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export function exportRoutes(db: Db, config: Config, now: () => Date = () => new Date()): Router {
  const router = Router();
  router.param('id', uuidParam('export not found'));

  const filePath = (userId: string, exportId: string) =>
    path.join(config.exportDir, userId, exportId);

  /* ==== Phase 3: signed download links ==== A link a Claude client
     hands the writer must open in a bare browser — no session, no
     bearer — so this one route sits BEFORE the auth guard and trusts
     an HMAC instead: sha256(secret, "v1.<exportId>.<exp>"). A bad or
     forged signature is a plain 404, indistinguishable from a missing
     export; only a VALID signature whose time has passed says 410
     "link expired". No secret configured => 501, nothing pretends. */
  const SIG_RE = /^[0-9a-f]{64}$/;
  const fileSig = (secret: string, exportId: string, exp: number): string =>
    createHmac('sha256', secret).update(`v1.${exportId}.${exp}`).digest('hex');

  router.get('/:id/file', async (req, res, next) => {
    try {
      const secret = config.exportUrlSecret;
      if (!secret) return res.status(501).json({ error: 'signed links not configured' });
      const exp = Number(req.query.exp);
      const sig = String(req.query.sig ?? '');
      if (!Number.isInteger(exp) || exp < 0 || !SIG_RE.test(sig))
        return res.status(404).json({ error: 'export not found' });
      const want = fileSig(secret, req.params.id, exp);
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want)))
        return res.status(404).json({ error: 'export not found' });
      if (exp * 1000 <= now().getTime()) return res.status(410).json({ error: 'link expired' });
      const result = await db.query<ExportRow & { user_id: string }>(
        `select id, user_id, format, filename, byte_size from exports where id = $1`,
        [req.params.id],
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'export not found' });
      const file = filePath(row.user_id, row.id);
      try {
        await stat(file);
      } catch {
        return res.status(500).json({ error: 'export file is missing from storage' });
      }
      res.setHeader('content-type', CONTENT_TYPES[row.format]);
      res.setHeader('content-disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
      res.setHeader('content-length', String(row.byte_size));
      return streamFile(file, res);
    } catch (err) {
      return next(err);
    }
  });

  // The studio (cookies) and the MCP server's export tools (a
  // beuk:export bearer) both reach here; cookies pass untouched. The
  // signed /file route above authenticates by HMAC and sits before this.
  router.use(sessionOrScopedBearer(db, config, 'beuk:export'));

  // Metadata-only list, newest first.
  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query<ExportRow>(
        `select id, manuscript_id, format, preset, filename, byte_size, sha256, created_at
         from exports where user_id = $1 order by created_at desc`,
        [req.user!.id],
      );
      return res.json({ exports: result.rows.map(metadata) });
    } catch (err) {
      return next(err);
    }
  });

  // Save an export. The BYTES are the raw request body
  // (Content-Type: application/octet-stream); metadata rides in the
  // query string: ?manuscriptId=…&format=epub&filename=…&preset=kdp
  router.post(
    '/',
    express.raw({ type: () => true, limit: config.exportMaxBytes }),
    async (req, res, next) => {
      try {
        const format = String(req.query.format ?? '');
        if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
          return res.status(400).json({
            error: `format must be one of: ${EXPORT_FORMATS.join(', ')}`,
          });
        }
        const manuscriptId = String(req.query.manuscriptId ?? '');
        if (!manuscriptId) return res.status(400).json({ error: 'manuscriptId is required' });
        if (!isUuid(manuscriptId)) return res.status(404).json({ error: 'manuscript not found' });
        // The linked manuscript must belong to the caller — the same
        // owner-scoped 404 as everywhere else (existence is not leaked).
        const owner = await db.query(
          'select id from manuscripts where id = $1 and user_id = $2',
          [manuscriptId, req.user!.id],
        );
        if (!owner.rows.length) return res.status(404).json({ error: 'manuscript not found' });

        const bytes = req.body as Buffer;
        if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
          return res.status(400).json({ error: 'export body is empty' });
        }
        const filename = cleanFilename(req.query.filename, format as ExportFormat);
        const preset =
          typeof req.query.preset === 'string' && req.query.preset ? req.query.preset : null;
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        const created = await db.query<ExportRow>(
          `insert into exports (user_id, manuscript_id, format, preset, filename, byte_size, sha256)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id, manuscript_id, format, preset, filename, byte_size, sha256, created_at`,
          [req.user!.id, manuscriptId, format, preset, filename, bytes.length, sha256],
        );
        const row = created.rows[0];
        try {
          await mkdir(path.join(config.exportDir, req.user!.id), { recursive: true });
          await writeFile(filePath(req.user!.id, row.id), bytes);
        } catch (err) {
          // Bytes failed to land: leave no metadata pointing at nothing.
          await db.query('delete from exports where id = $1', [row.id]).catch(() => {});
          throw err;
        }
        // The account (and so this row) may have been deleted while the
        // bytes were landing: then the file goes too.
        if (!(await keepExportFileIfRowSurvived(db, config.exportDir, req.user!.id, row.id))) {
          return res.status(404).json({ error: 'manuscript not found' });
        }
        return res.status(201).json({ export: metadata(row) });
      } catch (err) {
        return next(err);
      }
    },
  );

  async function findOwned(req: { user?: { id: string }; params: { id: string } }) {
    const result = await db.query<ExportRow>(
      `select id, manuscript_id, format, preset, filename, byte_size, sha256, created_at
       from exports where id = $1 and user_id = $2`,
      [req.params.id, req.user!.id],
    );
    return result.rows[0] ?? null;
  }

  /* Phase 3: mint a short-lived signed link for the export the signed-in
     (or bearer-authed) owner names. ttlSeconds 60..86400, default 900. */
  router.post('/:id/link', async (req, res, next) => {
    try {
      const secret = config.exportUrlSecret;
      if (!secret) return res.status(501).json({ error: 'signed links not configured' });
      const raw = (req.body as { ttlSeconds?: unknown } | undefined)?.ttlSeconds;
      const ttl = raw === undefined ? 900 : Number(raw);
      if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400)
        return res.status(400).json({ error: 'ttlSeconds must be an integer between 60 and 86400' });
      const row = await findOwned(req);
      if (!row) return res.status(404).json({ error: 'export not found' });
      const exp = Math.floor(now().getTime() / 1000) + ttl;
      const url = `${config.appBaseUrl}/api/exports/${row.id}/file?exp=${exp}&sig=${fileSig(secret, row.id, exp)}`;
      return res.json({ link: { url, expiresAt: new Date(exp * 1000).toISOString() } });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id/download', async (req, res, next) => {
    try {
      const row = await findOwned(req);
      if (!row) return res.status(404).json({ error: 'export not found' });
      const file = filePath(req.user!.id, row.id);
      try {
        await stat(file);
      } catch {
        return res.status(500).json({ error: 'export file is missing from storage' });
      }
      res.setHeader('content-type', CONTENT_TYPES[row.format]);
      res.setHeader(
        'content-disposition',
        `attachment; filename="${row.filename.replace(/"/g, '')}"`,
      );
      res.setHeader('content-length', String(row.byte_size));
      return streamFile(file, res);
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await db.query('delete from exports where id = $1 and user_id = $2 returning id', [
        req.params.id,
        req.user!.id,
      ]);
      if (!result.rows.length) return res.status(404).json({ error: 'export not found' });
      await rm(filePath(req.user!.id, req.params.id), { force: true });
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  // express.raw() over the upload cap arrives here as an error with
  // status 413 — translate it into a clean 413 instead of a 500.
  router.use(
    (
      err: Error & { status?: number; type?: string },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err?.status === 413 || err?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'export too large' });
      }
      return next(err);
    },
  );

  return router;
}
