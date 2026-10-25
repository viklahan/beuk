import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { TokenBucketLimiter } from '../ratelimit.js';

/**
 * POST /api/csp-report — Content-Security-Policy violation reports.
 *
 * The Caddyfile's policy names this endpoint twice, because browsers
 * use one of two delivery formats:
 *  - `report-to csp` + `Reporting-Endpoints: csp="/api/csp-report"`
 *    (Reporting API): POST, Content-Type `application/reports+json`,
 *    a JSON array of `{ type: "csp-violation", url, body: {
 *    documentURL, blockedURL, effectiveDirective, disposition,
 *    sourceFile, lineNumber, columnNumber, … } }`.
 *    https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-to
 *    https://w3c.github.io/reporting/ (endpoint URL is parsed "with
 *    base URL set to response's url", so the relative path is valid;
 *    the origin must be potentially trustworthy — https, or localhost).
 *  - `report-uri /api/csp-report` (deprecated, still the only format
 *    some browsers send; ignored by browsers that support report-to):
 *    POST, Content-Type `application/csp-report`, `{ "csp-report": {
 *    "document-uri", "blocked-uri", "effective-directive",
 *    "violated-directive", "disposition", "source-file",
 *    "line-number", "column-number", … } }`.
 *    https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-uri
 *
 * MDN: "violation reports are attacker-controlled data" — so nothing is
 * stored and nothing is echoed back. Each report becomes ONE compact log
 * line holding only what tunes the allow-list: disposition, directive,
 * the blocked resource reduced to its origin (or a CSP keyword such as
 * "inline"), and the document / source file reduced to a path with any
 * query, fragment and secret path segment (share-link tokens under
 * /read/, reset links) removed. No client address, no user agent, no
 * script sample (it can hold the writer's own text), no referrer.
 *
 * Abuse control: a per-IP token bucket (one app process — the same
 * proportionate choice as the auth limit), a small body cap enforced
 * before any parsing, and at most MAX_REPORTS_PER_POST lines per body.
 */

/** A browser report body is a few hundred bytes; a Reporting API batch
 *  of several stays well inside this. Larger bodies are refused (413). */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const MAX_REPORTS_PER_POST = 20;

const REPORT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];

export interface CspReportOptions {
  /** Where the compact line goes (default: console.warn). */
  log?: (line: string) => void;
  /** Token bucket per client address (default 30 burst, 1 per 2 s). */
  burst?: number;
  refillMs?: number;
}

/** Keep a CSP keyword ("inline", "eval", "data", "blob", "self", …) as
 *  is; reduce a URL to its origin (scheme+host+port), dropping path,
 *  query and fragment. Anything else becomes "other". */
function blockedLabel(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '-';
  const v = raw.trim();
  if (/^[a-z-]{1,20}$/i.test(v)) return v.toLowerCase();
  try {
    const u = new URL(v);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return u.protocol.slice(0, -1);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:') return u.origin;
    return u.protocol.slice(0, -1);
  } catch {
    return 'other';
  }
}

/** Path only, with secrets cut: /read/<token>/… → /read/:token, and
 *  /reset… → /reset. Cross-origin documents are labelled by origin. */
function docLabel(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '-';
  let u: URL;
  try {
    u = new URL(raw, 'http://same.invalid');
  } catch {
    return 'other';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.protocol.slice(0, -1);
  let p = u.pathname;
  if (/^\/read\//.test(p)) p = '/read/:token';
  else if (/^\/reset/.test(p)) p = '/reset';
  return p.slice(0, 120).replace(/[^\w./:@~-]/g, '_') || '/';
}

function word(raw: unknown): string {
  return typeof raw === 'string' && /^[a-z0-9-]{1,40}$/i.test(raw) ? raw.toLowerCase() : '-';
}

function num(raw: unknown): string {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 1e8 ? String(n) : '-';
}

/** One compact, PII-free line for one violation, or null if the object
 *  is not a CSP violation report in either format. */
export function cspReportLine(report: unknown): string | null {
  if (!report || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  let b: Record<string, unknown>;
  let directive: unknown;
  let blocked: unknown;
  let doc: unknown;
  let src: unknown;
  let line: unknown;
  let col: unknown;
  if (r['csp-report'] && typeof r['csp-report'] === 'object') {
    b = r['csp-report'] as Record<string, unknown>;
    directive = b['effective-directive'] ?? b['violated-directive'];
    blocked = b['blocked-uri'];
    doc = b['document-uri'];
    src = b['source-file'];
    line = b['line-number'];
    col = b['column-number'];
  } else if (r.type === 'csp-violation' && r.body && typeof r.body === 'object') {
    b = r.body as Record<string, unknown>;
    directive = b.effectiveDirective;
    blocked = b.blockedURL;
    doc = b.documentURL ?? r.url;
    src = b.sourceFile;
    line = b.lineNumber;
    col = b.columnNumber;
  } else {
    return null;
  }
  // violated-directive (legacy) may carry the whole directive value;
  // keep only its name.
  const dirName = typeof directive === 'string' ? directive.trim().split(/\s+/)[0] : directive;
  return (
    `csp-report disposition=${word(b.disposition)} directive=${word(dirName)} ` +
    `blocked=${blockedLabel(blocked)} doc=${docLabel(doc)} src=${docLabel(src)} ` +
    `line=${num(line)} col=${num(col)}`
  );
}

export function cspReportRoutes(opts: CspReportOptions = {}): Router {
  const router = Router();
  const log = opts.log ?? ((line: string) => console.warn(line));
  const limiter = new TokenBucketLimiter({ burst: opts.burst ?? 30, refillMs: opts.refillMs ?? 2_000 });

  router.post(
    '/',
    (req: Request, res: Response, next: NextFunction) => {
      const outcome = limiter.take(req.ip ?? 'unknown');
      if (outcome.ok) return next();
      res.setHeader('Retry-After', String(outcome.retryAfterSec));
      return res.status(429).end();
    },
    // Raw bytes, capped: body-parser refuses an over-limit body (413)
    // while reading, before any JSON parsing.
    express.raw({ type: REPORT_TYPES, limit: CSP_REPORT_MAX_BYTES }),
    (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body)) return res.status(415).end();
      if (!req.body.length) return res.status(400).end();
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).end();
      }
      const reports = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, MAX_REPORTS_PER_POST);
      let logged = 0;
      for (const r of reports) {
        const line = cspReportLine(r);
        if (line) {
          log(line);
          logged += 1;
        }
      }
      if (!logged) return res.status(400).end();
      return res.status(204).end();
    },
  );

  router.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err.type === 'entity.too.large') return res.status(413).end();
    if (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported') return res.status(400).end();
    return next(err);
  });

  return router;
}
