import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import { defaultMigrationsDir, runMigrations, type Db } from '../db.js';
import { requireAdmin } from '../housekeeping/admin.js';
import { isUuid } from '../ids.js';
import {
  createBackup,
  executeRestore,
  isValidBackupName,
  listBackups,
  previewRestore,
  readManifest,
  RestoreRefused,
} from '../housekeeping/backup.js';
import {
  writeAudit,
  type HousekeepingContext,
} from '../housekeeping/context.js';
import { writeFileAtomic } from '../housekeeping/fsutil.js';
import { readReferenceDoc } from '../housekeeping/reference.js';
import { buildCheckContext, runSelfChecks, SELF_CHECK_CASES } from '../housekeeping/registry.js';
import { scrubText, scrubValue } from '../housekeeping/scrub.js';
import { createMailer, type Mailer } from '../mailer.js';

/**
 * Housekeeping (M3) — the admin surface for the app itself.
 *
 * Everything under /api/housekeeping sits behind requireAdmin: anyone
 * who is not a signed-in admin gets a 404, as if none of this existed.
 * Actions are a fixed named set — no shell, no arbitrary commands, no
 * free-form paths. Mutating actions take the one global lock (409 on
 * conflict), every action writes an audit row, and every output passes
 * through the secret scrubber.
 */

interface ActionOutcome {
  status: number;
  body: Record<string, unknown>;
  result: string;
  detail?: string;
}

const ACTION_CATALOG = [
  { name: 'self-checks.run', pillar: 'Self-checks', method: 'POST', path: '/api/housekeeping/self-checks/run', mutating: true, description: 'Run the full Self-checks registry; the result is stored against the current build stamp.' },
  { name: 'self-checks.runs', pillar: 'Self-checks', method: 'GET', path: '/api/housekeeping/self-checks/runs', mutating: false, description: 'List stored Self-checks runs.' },
  { name: 'backups.create', pillar: 'Evidence', method: 'POST', path: '/api/housekeeping/backups', mutating: true, description: 'Create a named backup (DB dump + settings with secrets excluded by name + export volume copy).' },
  { name: 'backups.list', pillar: 'Evidence', method: 'GET', path: '/api/housekeeping/backups', mutating: false, description: 'List backups and their manifests.' },
  { name: 'restore.preview', pillar: 'Evidence', method: 'POST', path: '/api/housekeeping/restore/preview', mutating: false, description: 'Step one of restore: a diff summary of a backup against current state.' },
  { name: 'restore.execute', pillar: 'Evidence', method: 'POST', path: '/api/housekeeping/restore', mutating: true, description: 'Step two of restore: requires a fresh preview and confirmed: true; snapshots current state first, restores, then verifies with Self-checks.' },
  { name: 'rehearse.run', pillar: 'Rehearse', method: 'POST', path: '/api/housekeeping/rehearse', mutating: true, description: 'Run migrations against a scratch database and boot/health-check it. Production data is never touched.' },
  { name: 'reference.architecture', pillar: 'Reference', method: 'GET', path: '/api/housekeeping/reference/architecture', mutating: false, description: 'The architecture summary, rendered from docs/architecture.md in the repo.' },
  { name: 'reference.roadmap', pillar: 'Reference', method: 'GET', path: '/api/housekeeping/reference/roadmap', mutating: false, description: 'The roadmap, rendered from docs/roadmap.md in the repo.' },
  { name: 'promote.sign-off', pillar: 'Promotion', method: 'POST', path: '/api/housekeeping/promote/sign-off', mutating: true, description: 'Record a human sign-off for the current build stamp.' },
  { name: 'promote.execute', pillar: 'Promotion', method: 'POST', path: '/api/housekeeping/promote', mutating: true, description: 'Refuses unless the tree is marked clean, Self-checks passed on this build stamp, and a sign-off exists; writes PROMOTION_MANIFEST.json.' },
  { name: 'audit.list', pillar: 'Evidence', method: 'GET', path: '/api/housekeeping/audit', mutating: false, description: 'Recent Housekeeping audit rows.' },
  { name: 'founders.list', pillar: "Founders' Shelf", method: 'GET', path: '/api/housekeeping/founders', mutating: false, description: "List Founders' Shelf applications (M4 warmth: the private seed list writers applied to). Read-only; every read is audited." },
  { name: 'mail.status', pillar: 'Mail', method: 'GET', path: '/api/housekeeping/mail', mutating: false, description: 'Whether this server can send email (password-reset links): "email not configured" until SMTP_URL and MAIL_FROM are set. Credentials are never shown.' },
  { name: 'mail.test', pillar: 'Mail', method: 'POST', path: '/api/housekeeping/mail/test', mutating: true, description: "Send one test email to the signed-in admin's own address and report exactly what the SMTP server said; never reports a send that did not happen." },
] as const;

export function housekeepingRoutes(
  db: Db,
  config: Config,
  hk: HousekeepingContext,
  mailer: Mailer = createMailer(config),
): Router {
  const router = Router();
  router.use(requireAdmin(db));
  // Non-UUID run ids can never match a row: 404, not a Postgres 500.
  router.param('id', (_req, res, next, value: string) => {
    if (isUuid(value)) return next();
    return send(res, 404, { error: 'run not found' });
  });

  const send = (res: Response, status: number, payload: unknown): void => {
    res.status(status).json(scrubValue(payload, hk.secrets));
  };

  const audit = async (
    req: Request,
    action: string,
    params: Record<string, unknown>,
    result: string,
    detail?: string,
  ): Promise<void> => {
    await writeAudit(db, {
      actorId: req.user?.id ?? null,
      actorEmail: req.user?.email ?? null,
      action,
      params: scrubValue(params, hk.secrets) as Record<string, unknown>,
      result,
      detail: detail ? scrubText(detail, hk.secrets) : undefined,
    }).catch((err) => console.error('housekeeping audit write failed', err));
  };

  /** Run a mutating action under the one global lock, with audit. */
  const mutate = async (
    req: Request,
    res: Response,
    action: string,
    params: Record<string, unknown>,
    fn: () => Promise<ActionOutcome>,
  ): Promise<void> => {
    if (!hk.lock.tryAcquire(action)) {
      await audit(req, action, params, 'conflict', `lock held by ${hk.lock.heldBy}`);
      return send(res, 409, {
        error: 'another housekeeping action is running',
        heldBy: hk.lock.heldBy,
      });
    }
    try {
      const outcome = await fn();
      await audit(req, action, params, outcome.result, outcome.detail);
      return send(res, outcome.status, outcome.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await audit(req, action, params, 'error', message);
      return send(res, 500, { error: message });
    } finally {
      hk.lock.release();
    }
  };

  /* ---------------- catalog + reference (read-only) ---------------- */

  router.get('/actions', (_req, res) => {
    return send(res, 200, {
      actions: ACTION_CATALOG,
      registry: {
        cases: SELF_CHECK_CASES.length,
        server: SELF_CHECK_CASES.filter((c) => c.kind === 'server').length,
        clientOnly: SELF_CHECK_CASES.filter((c) => c.kind === 'client-only').length,
      },
    });
  });

  router.get('/reference/architecture', async (_req, res, next) => {
    try {
      return send(res, 200, { architecture: await readReferenceDoc('architecture') });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/reference/roadmap', async (_req, res, next) => {
    try {
      return send(res, 200, { roadmap: await readReferenceDoc('roadmap') });
    } catch (err) {
      return next(err);
    }
  });

  /* ---------------- Self-checks ---------------- */

  async function executeSelfCheckRun(): Promise<{
    runId: string;
    startedAt: Date;
    finishedAt: Date;
    overall: string;
    passCount: number;
    failCount: number;
    clientOnlyCount: number;
    results: unknown;
  }> {
    const startedAt = new Date();
    const run = await runSelfChecks({ ...buildCheckContext(db, config), mailer });
    const finishedAt = new Date();
    const inserted = await db.query<{ id: string }>(
      `insert into housekeeping_check_runs
         (build_stamp, started_at, finished_at, overall, pass_count, fail_count, client_only_count, results)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        config.buildStamp,
        startedAt.toISOString(),
        finishedAt.toISOString(),
        run.overall,
        run.passCount,
        run.failCount,
        run.clientOnlyCount,
        JSON.stringify(run.results),
      ],
    );
    return {
      runId: inserted.rows[0].id,
      startedAt,
      finishedAt,
      overall: run.overall,
      passCount: run.passCount,
      failCount: run.failCount,
      clientOnlyCount: run.clientOnlyCount,
      results: run.results,
    };
  }

  router.post('/self-checks/run', async (req, res) => {
    return mutate(req, res, 'self-checks.run', {}, async () => {
      const run = await executeSelfCheckRun();
      return {
        status: 200,
        result: run.overall,
        detail: `${run.passCount} pass, ${run.failCount} fail, ${run.clientOnlyCount} client-only`,
        body: {
          run: {
            id: run.runId,
            buildStamp: config.buildStamp,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt.toISOString(),
            overall: run.overall,
            counts: {
              pass: run.passCount,
              fail: run.failCount,
              clientOnly: run.clientOnlyCount,
            },
            results: run.results,
          },
        },
      };
    });
  });

  router.get('/self-checks/runs', async (_req, res, next) => {
    try {
      const result = await db.query(
        `select id, build_stamp, started_at, finished_at, overall, pass_count, fail_count, client_only_count
         from housekeeping_check_runs order by started_at desc limit 25`,
      );
      return send(res, 200, { runs: result.rows });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/self-checks/runs/:id', async (req, res, next) => {
    try {
      const result = await db.query(
        'select * from housekeeping_check_runs where id = $1',
        [req.params.id],
      );
      if (!result.rows.length) return send(res, 404, { error: 'run not found' });
      return send(res, 200, { run: result.rows[0] });
    } catch (err) {
      return next(err);
    }
  });

  /* ---------------- Evidence: backups + restore ---------------- */

  router.post('/backups', async (req, res) => {
    const name = typeof req.body?.name === 'string' && req.body.name ? req.body.name : undefined;
    return mutate(req, res, 'backups.create', { name: name ?? '(auto)' }, async () => {
      if (name && !isValidBackupName(name)) {
        return {
          status: 400,
          result: 'refused',
          detail: 'invalid backup name',
          body: { error: 'backup name must be letters, digits, dot, dash or underscore' },
        };
      }
      const manifest = await createBackup(db, config, {
        name,
        createdBy: req.user!.email,
        secrets: hk.secrets,
      });
      return { status: 201, result: 'created', body: { backup: manifest } };
    });
  });

  router.get('/backups', async (_req, res, next) => {
    try {
      return send(res, 200, { backups: await listBackups(config) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/backups/:name', async (req, res, next) => {
    try {
      const manifest = await readManifest(config, req.params.name);
      if (!manifest) return send(res, 404, { error: 'backup not found' });
      return send(res, 200, { backup: manifest });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/restore/preview', async (req, res, next) => {
    try {
      const name = String(req.body?.name ?? '');
      const diff = await previewRestore(db, config, name);
      if (!diff) {
        await audit(req, 'restore.preview', { name }, 'refused', 'backup not found');
        return send(res, 404, { error: 'backup not found' });
      }
      const preview = hk.newPreview(name, req.user!.id, diff);
      await audit(req, 'restore.preview', { name }, 'preview');
      return send(res, 200, {
        previewId: preview.id,
        expiresAt: new Date(preview.expiresAt).toISOString(),
        diff,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/restore', async (req, res) => {
    const name = String(req.body?.name ?? '');
    const previewId = String(req.body?.previewId ?? '');
    const confirmed = req.body?.confirmed === true;
    return mutate(req, res, 'restore.execute', { name }, async () => {
      if (!config.restoreEnabled) {
        return {
          status: 503,
          result: 'refused',
          detail: 'restore disabled by RESTORE_ENABLED=false',
          body: {
            error: 'restore is turned off on this server (RESTORE_ENABLED=false)',
          },
        };
      }
      if (!confirmed) {
        return {
          status: 400,
          result: 'refused',
          detail: 'confirmed: true is required',
          body: { error: 'restore requires confirmed: true' },
        };
      }
      const preview = hk.takePreview(previewId, name, req.user!.id);
      if (!preview) {
        return {
          status: 400,
          result: 'refused',
          detail: 'preview missing, expired, or mismatched',
          body: { error: 'restore preview is missing, expired, or does not match this backup' },
        };
      }
      let restored;
      try {
        restored = await executeRestore(db, config, {
          name,
          createdBy: req.user!.email,
          secrets: hk.secrets,
        });
      } catch (err) {
        if (!(err instanceof RestoreRefused)) throw err;
        return { status: 409, result: 'refused', detail: err.message, body: { error: err.message } };
      }
      const verification = await executeSelfCheckRun();
      return {
        status: 200,
        result: verification.overall === 'pass' ? 'restored' : 'restored-verification-failed',
        detail: `snapshot ${restored.snapshot}; verification ${verification.overall}`,
        body: {
          restored,
          verification: {
            runId: verification.runId,
            buildStamp: config.buildStamp,
            overall: verification.overall,
            counts: {
              pass: verification.passCount,
              fail: verification.failCount,
              clientOnly: verification.clientOnlyCount,
            },
          },
        },
      };
    });
  });

  /* ---------------- Rehearse ---------------- */

  router.post('/rehearse', async (req, res) => {
    return mutate(req, res, 'rehearse.run', {}, async () => {
      if (!hk.scratchFactory) {
        return {
          status: 501,
          result: 'not-configured',
          detail: 'no scratch database factory configured',
          body: { error: 'rehearse is not configured on this server' },
        };
      }
      const scratch = await hk.scratchFactory();
      try {
        const applied = await runMigrations(scratch.db, defaultMigrationsDir());
        await scratch.db.query('select 1');
        const boot = hk.bootCheck
          ? await hk.bootCheck(scratch.db)
          : { ok: false, detail: 'no boot check configured' };
        return {
          status: 200,
          result: boot.ok ? 'pass' : 'fail',
          detail: `migrations: ${applied.length} applied on scratch; boot: ${boot.detail}`,
          body: {
            rehearse: {
              pass: boot.ok,
              migrationsApplied: applied,
              health: 'scratch database answers select 1',
              boot,
              note: 'production data untouched — the rehearsal ran on a scratch database',
            },
          },
        };
      } finally {
        await scratch.cleanup().catch(() => {});
      }
    });
  });

  /* ---------------- Promotion gate ---------------- */

  router.post('/promote/sign-off', async (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    return mutate(req, res, 'promote.sign-off', { buildStamp: config.buildStamp }, async () => {
      const inserted = await db.query<{ id: string; created_at: string }>(
        `insert into housekeeping_signoffs (build_stamp, user_id, email, note)
         values ($1, $2, $3, $4) returning id, created_at`,
        [config.buildStamp, req.user!.id, req.user!.email, note],
      );
      return {
        status: 201,
        result: 'signed-off',
        body: {
          signOff: {
            id: inserted.rows[0].id,
            buildStamp: config.buildStamp,
            email: req.user!.email,
            note,
            createdAt: inserted.rows[0].created_at,
          },
        },
      };
    });
  });

  router.post('/promote', async (req, res) => {
    return mutate(req, res, 'promote.execute', { buildStamp: config.buildStamp }, async () => {
      const reasons: string[] = [];
      if (!config.treeClean) {
        reasons.push('working tree is not marked clean (the deploy sets TREE_CLEAN or the marker file)');
      }
      const runs = await db.query<{
        id: string;
        overall: string;
        pass_count: number;
        fail_count: number;
        client_only_count: number;
      }>(
        `select id, overall, pass_count, fail_count, client_only_count
         from housekeeping_check_runs where build_stamp = $1 order by started_at desc limit 1`,
        [config.buildStamp],
      );
      const latestRun = runs.rows[0];
      if (!latestRun) {
        reasons.push(`no self-check run exists for build ${config.buildStamp}`);
      } else if (latestRun.overall !== 'pass') {
        reasons.push('the latest self-check run for this build did not pass');
      }
      const signoffs = await db.query<{ email: string; note: string | null; created_at: string }>(
        `select email, note, created_at from housekeeping_signoffs
         where build_stamp = $1 order by created_at desc limit 1`,
        [config.buildStamp],
      );
      const signOff = signoffs.rows[0];
      if (!signOff) {
        reasons.push(`no human sign-off recorded for build ${config.buildStamp}`);
      }
      if (reasons.length) {
        return {
          status: 409,
          result: 'refused',
          detail: reasons.join('; '),
          body: { promoted: false, buildStamp: config.buildStamp, reasons },
        };
      }
      const manifest = {
        promotedAt: new Date().toISOString(),
        buildStamp: config.buildStamp,
        promotedBy: req.user!.email,
        selfChecks: {
          runId: latestRun.id,
          overall: latestRun.overall,
          pass: latestRun.pass_count,
          fail: latestRun.fail_count,
          clientOnly: latestRun.client_only_count,
        },
        signOff: { email: signOff.email, note: signOff.note, at: signOff.created_at },
        treeClean: true,
      };
      await writeFileAtomic(
        config.promotionManifestPath,
        scrubText(JSON.stringify(manifest, null, 2), hk.secrets),
      );
      return {
        status: 200,
        result: 'promoted',
        body: { promoted: true, manifest },
      };
    });
  });

  /* ---------------- Audit (read-only) ---------------- */

  router.get('/audit', async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const result = await db.query(
        `select id, actor_email, action, params_summary, result, detail, created_at
         from housekeeping_audit order by created_at desc limit $1`,
        [limit],
      );
      return send(res, 200, { audit: result.rows });
    } catch (err) {
      return next(err);
    }
  });

  /* ---------------- Founders' Shelf (M4, read-only) ---------------- */

  router.get('/founders', async (req, res, next) => {
    try {
      const result = await db.query(
        `select id, name, email, about, created_at
         from founders_applications order by created_at desc limit 200`,
      );
      await audit(req, 'founders.list', {}, 'ok', `${result.rows.length} applications`);
      return send(res, 200, { applications: result.rows });
    } catch (err) {
      return next(err);
    }
  });

  /* ---------------- Mail (P0 #5 account basics) ---------------- */

  router.get('/mail', (_req, res) => {
    return send(res, 200, { mail: mailer.status() });
  });

  router.post('/mail/test', async (req, res) => {
    return mutate(req, res, 'mail.test', {}, async () => {
      const status = mailer.status();
      const to = req.user!.email;
      const result = await mailer.send({
        to,
        subject: 'Beuk test email',
        text: `This is a test email from Housekeeping on ${config.appBaseUrl} (build ${config.buildStamp}). If you can read it, password-reset emails can reach this inbox.`,
      });
      if (result.delivered) {
        return {
          status: 200,
          result: 'sent',
          detail: `accepted by the SMTP server for ${to}`,
          body: { mail: status, sent: true, to, messageId: result.messageId },
        };
      }
      return {
        status: status.configured ? 502 : 409,
        result: status.configured ? 'failed' : 'not-configured',
        detail: result.reason,
        body: { mail: status, sent: false, to, reason: result.reason },
      };
    });
  });

  // Unknown housekeeping paths: the same 404 as everything else here.
  router.use((_req, res) => send(res, 404, { error: 'not found' }));

  return router;
}
