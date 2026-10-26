import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { getHelpContent } from '../help/content.js';
import { chrome } from '../help/render.js';
import { humanDateTimeUtc } from '../help/render-util.js';
import { readShelfStatus } from '../help/status.js';
import type { Mailer } from '../mailer.js';
import { readPublicStatus, StatusCache, type ComponentState, type PublicStatus } from '../ops/status.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import { collectSecrets, scrubValue } from '../housekeeping/scrub.js';

/**
 * The public status page and its JSON twin.
 *
 *   GET /status              server-rendered, in Help's Paper style; reads
 *                            without JavaScript (Caddy proxies /status here)
 *   GET /api/status/public   the same reading as JSON for an outside uptime
 *                            monitor: 200 while the shelf answers, 503 when
 *                            its database does not; Cache-Control 30 s
 *
 * Both read one cached reading (src/ops/status.ts, 30 s). Nothing internal
 * is shown: no error text, hostname, path or setting value.
 */

const LABEL: Record<ComponentState, string> = {
  ok: 'Working',
  off: 'Not set up',
  attention: 'Needs attention',
  down: 'Down',
};

export function statusPageRoutes(db: Db, config: Config, mailer: Mailer): { page: Router; api: Router } {
  const cache = new StatusCache(() => readPublicStatus(db, config, mailer));
  const secrets = collectSecrets(config);
  const page = Router();
  const api = Router();

  api.get('/public', async (_req, res, next) => {
    try {
      const s = scrubValue(await cache.get(), secrets);
      res.set('Cache-Control', 'public, max-age=30');
      return res.status(s.ok ? 200 : 503).json(s);
    } catch (err) {
      return next(err);
    }
  });

  page.get(['/status', '/status/'], async (_req, res, next) => {
    try {
      const s = scrubValue(await cache.get(), secrets);
      const ctx = { config, content: getHelpContent(), status: await readShelfStatus(db, config) };
      const html = chrome(ctx, {
        title: 'Status — Beuk',
        description: 'Whether the Beuk studio, shelf, Help, server checks, email and backups are working right now.',
        body: renderStatusBody(s),
      });
      res.status(s.ok ? 200 : 503).type('html').set('Cache-Control', 'no-cache').send(html);
    } catch (err) {
      return next(err);
    }
  });

  return { page, api };
}

const DOT: Record<ComponentState, string> = {
  ok: 'var(--good)',
  off: 'var(--muted)',
  attention: 'var(--gold, #b8860b)',
  down: 'var(--bad)',
};

export function renderStatusBody(s: PublicStatus): string {
  const rows = s.components
    .map(
      (c) => `<li class="st-row" data-component="${esc(c.id)}" data-state="${esc(c.state)}" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:14px 0;border-top:1px solid var(--line);">
        <span style="font-family:var(--serif);font-size:19px;font-weight:600;">${esc(c.name)}</span>
        <span style="font-weight:700;white-space:nowrap;"><span aria-hidden="true" style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;background:${DOT[c.state]};"></span>${esc(LABEL[c.state])}</span>
        <span style="grid-column:1/-1;color:var(--ink-2);line-height:1.5;">${esc(c.summary)}</span>
        <span class="muted small" style="grid-column:1/-1;">Read at ${esc(humanDateTimeUtc(c.checkedAt))}</span>
      </li>`,
    )
    .join('\n');
  return `<div class="err-page st-page">
      <p class="kicker">Status</p>
      <h1>${esc(s.headline)}</h1>
      <p class="lede">What the Beuk server can see of itself, read at ${esc(humanDateTimeUtc(s.checkedAt))}. Readings are at most 30 seconds old; reload for a newer one.</p>
      <ul class="st-rows" style="list-style:none;margin:28px 0 0;padding:0;max-width:46rem;">
${rows}
      </ul>
      <p class="muted" style="max-width:46rem;margin-top:24px;line-height:1.5;">This page comes from the server itself, so when the server is down it does not load at all. Writing in the studio keeps working on your device either way, and your book is kept there until the shelf is back.</p>
      <p class="muted small" style="max-width:46rem;">For monitors: <a href="/api/status/public">/api/status/public</a> gives the same reading as JSON.</p>
    </div>`;
}
