import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../housekeeping/admin.js';
import { writeAudit, type HousekeepingContext } from '../housekeeping/context.js';
import { scrubText, scrubValue } from '../housekeeping/scrub.js';
import type { Mailer } from '../mailer.js';
import { alertChannels, summarise } from '../ops/alerts.js';
import { clientErrorSummary, purgeClientErrors } from '../ops/client-errors.js';
import { readRetentionStatus, retentionPolicy } from '../ops/retention.js';
import type { OpsService } from '../ops/service.js';
import { opsSettings } from '../ops/settings.js';
import { rollupUsage, usageSummary } from '../ops/usage.js';

/**
 * Housekeeping additions for production ops, mounted at /api/housekeeping
 * in front of the main Housekeeping router. Same rules: admins only (404
 * for everyone else), mutating actions under the one lock, every action
 * audited, every output scrubbed.
 *
 *   GET  /ops                 alerts (channels, incident, last alert),
 *                             local backup retention (policy + last run)
 *   POST /alerts/test         one test alert on every configured channel
 *   POST /backups/prune       apply local retention now (409 if keep-all)
 *   GET  /client-errors       studio error reports grouped by message
 *   GET  /usage               the daily usage counters, last 30 days
 */
export const OPS_ACTIONS = [
  { name: 'ops.status', pillar: 'Evidence', method: 'GET', path: '/api/housekeeping/ops', mutating: false, description: 'Backup alerts (channels, open incident, last alert sent) and local backup retention (policy and last run).' },
  { name: 'alerts.test', pillar: 'Evidence', method: 'POST', path: '/api/housekeeping/alerts/test', mutating: true, description: 'Send one test alert to every configured channel (ALERT_EMAIL when email is set up, ALERT_WEBHOOK_URL) and report what each answered.' },
  { name: 'backups.prune', pillar: 'Evidence', method: 'POST', path: '/api/housekeeping/backups/prune', mutating: true, description: 'Apply local backup retention now (BACKUP_KEEP_DAYS / BACKUP_KEEP_COUNT). Never deletes the newest complete backup; 409 while retention is unset (keep everything).' },
  { name: 'client-errors.list', pillar: 'Evidence', method: 'GET', path: '/api/housekeeping/client-errors', mutating: false, description: 'Studio error reports of the last CLIENT_ERRORS_KEEP_DAYS days, grouped by message with counts. No user ids, no IPs.' },
  { name: 'usage.list', pillar: 'Evidence', method: 'GET', path: '/api/housekeeping/usage', mutating: false, description: 'Daily usage counts for the last 30 days (sign-ups, sign-ins, first shelf saves, exports, EPUBCheck runs, share links, came back after 7 days). Aggregates only.' },
] as const;

export function opsHousekeepingRoutes(db: Db, config: Config, hk: HousekeepingContext, ops: OpsService, mailer: Mailer): Router {
  const router = Router();
  router.use(requireAdmin(db));

  const send = (res: Response, status: number, payload: unknown): void => {
    res.status(status).json(scrubValue(payload, hk.secrets));
  };
  const audit = (req: Request, action: string, result: string, detail?: string) =>
    writeAudit(db, {
      actorId: req.user?.id ?? null,
      actorEmail: req.user?.email ?? null,
      action,
      params: {},
      result,
      detail: detail ? scrubText(detail, hk.secrets) : undefined,
    }).catch((err) => console.error('housekeeping audit write failed', err));

  router.get('/ops', async (_req, res, next) => {
    try {
      const state = await ops.alerts.readState();
      return send(res, 200, {
        alerts: {
          channels: alertChannels(config, mailer),
          incident: state,
          watching: ['backup.schedule.running', 'backup.offsite.fresh', 'backup.offsite.drill'],
          rule: 'one alert when a backup check turns red (tried again on later checks, up to 4 attempts, until a channel accepts it), one when all are green again; checked every 15 minutes',
        },
        retention: {
          policy: retentionPolicy(config),
          last: await readRetentionStatus(config),
        },
        clientErrors: { keepDays: opsSettings(config).clientErrorsKeepDays },
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/alerts/test', async (req, res) => {
    if (!hk.lock.tryAcquire('alerts.test')) {
      await audit(req, 'alerts.test', 'conflict', `lock held by ${hk.lock.heldBy}`);
      return send(res, 409, { error: 'another housekeeping action is running', heldBy: hk.lock.heldBy });
    }
    try {
      const channels = await ops.alerts.sendTest();
      const ok = channels.length > 0 && channels.every((c) => c.ok);
      await audit(req, 'alerts.test', channels.length ? (ok ? 'sent' : 'failed') : 'not-configured', summarise(channels));
      return send(res, channels.length ? (ok ? 200 : 502) : 409, {
        sent: ok,
        channels,
        detail: summarise(channels),
      });
    } finally {
      hk.lock.release();
    }
  });

  router.post('/backups/prune', async (req, res) => {
    const policy = retentionPolicy(config);
    if (policy.keepAll) {
      await audit(req, 'backups.prune', 'not-configured', policy.description);
      return send(res, 409, { error: 'local backup retention is not set: every backup is kept', policy });
    }
    const result = await ops.retention();
    await audit(req, 'backups.prune', result.outcome, result.detail);
    return send(res, result.outcome === 'skipped-busy' ? 409 : result.outcome === 'error' ? 500 : 200, { retention: result, policy });
  });

  router.get('/client-errors', async (_req, res, next) => {
    try {
      await purgeClientErrors(db, config, new Date());
      return send(res, 200, { keepDays: opsSettings(config).clientErrorsKeepDays, ...(await clientErrorSummary(db)) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/usage', async (_req, res, next) => {
    try {
      const now = new Date();
      await rollupUsage(db, config, now, 30);
      return send(res, 200, {
        timeZone: config.timeZone,
        note: 'One number per day per counter. No cookies, no IP addresses, no user ids. See docs/privacy-inventory.md.',
        ...(await usageSummary(db, config, now, 30)),
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
