import { Router } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HTTP_CODES } from '../help/codes.js';
import { isUuid, uuidParam } from '../ids.js';
import { JobRunner, type JobKind, type JobRow } from '../jobs/runner.js';

/**
 * M5 jobs API. Authenticated and owner-scoped exactly like the rest
 * of the app: another user's job (or a job over another user's
 * export) is a 404, never a 403. Creating a job never blocks on tool
 * configuration — the job is accepted, runs, and if the tool is not
 * configured on this server it completes as FAILED saying so.
 * Admission is capped (per user and server-wide) so one account can't
 * flood the single-worker queue: over a cap the answer is 429 / 503
 * with the reason, and no job is created.
 */

function view(row: JobRow) {
  return {
    id: row.id,
    kind: row.kind,
    sourceExportId: row.source_export_id,
    artifactExportId: row.artifact_export_id,
    status: row.status,
    result: row.result,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** Arbitrary constant key for the job-admission advisory lock. */
const JOB_ADMISSION_LOCK = 0x6265756b; // "beuk"

const JOB_COLUMNS =
  'id, user_id, kind, source_export_id, status, result, artifact_export_id, created_at, started_at, finished_at';

export function jobRoutes(db: Db, config: Config): { router: Router; runner: JobRunner } {
  const runner = new JobRunner(db, config);
  const router = Router();
  router.use(requireAuth(db));
  router.param('id', uuidParam('job not found'));

  async function createJob(reqUserId: string, kind: JobKind, body: unknown) {
    const exportId =
      body && typeof body === 'object' ? (body as { exportId?: unknown }).exportId : undefined;
    if (typeof exportId !== 'string' || !exportId) {
      return { status: 400 as const, payload: { error: 'exportId is required' }, jobId: null };
    }
    // A non-UUID can never name an export: the same 404, not a 500.
    if (!isUuid(exportId)) {
      return { status: 404 as const, payload: { error: 'export not found' }, jobId: null };
    }
    const owned = await db.query<{ id: string; format: string }>(
      'select id, format from exports where id = $1 and user_id = $2',
      [exportId, reqUserId],
    );
    const source = owned.rows[0];
    if (!source) return { status: 404 as const, payload: { error: 'export not found' }, jobId: null };
    if (kind === 'epubcheck' && source.format !== 'epub') {
      return {
        status: 400 as const,
        payload: { error: `an epubcheck job needs an epub export (this one is ${source.format})` },
        jobId: null,
      };
    }
    if (kind === 'pdfx' && source.format !== 'print-html') {
      return {
        status: 400 as const,
        payload: {
          error: `a pdfx job needs a print interior (print-html) export (this one is ${source.format})`,
        },
        jobId: null,
      };
    }
    // Admission caps. The runner drains one job at a time, so every job
    // waiting or running holds a slot of the box: one user may hold at
    // most jobMaxActivePerUser of them, the whole server jobMaxQueued.
    // Count-then-insert runs under one transaction-scoped advisory lock
    // so two simultaneous requests can't both slip past a cap.
    // https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
    return db.tx(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1)', [JOB_ADMISSION_LOCK]);
      const active = await tx.query<{ mine: number; total: number }>(
        `select count(*) filter (where user_id = $1)::int as mine, count(*)::int as total
         from jobs where status in ('queued', 'running')`,
        [reqUserId],
      );
      const { mine, total } = active.rows[0];
      if (mine >= config.jobMaxActivePerUser) {
        return {
          status: 429 as const,
          payload: {
            error:
              `you already have ${mine} job${mine === 1 ? '' : 's'} waiting or running ` +
              `(the limit is ${config.jobMaxActivePerUser}); start this one when one of them finishes`,
            code: HTTP_CODES.jobsBusy,
          },
          jobId: null,
        };
      }
      if (total >= config.jobMaxQueued) {
        return {
          status: 503 as const,
          payload: {
            error: 'the server job queue is full right now; please try again in a few minutes',
            code: HTTP_CODES.jobsBusy,
          },
          jobId: null,
        };
      }
      const created = await tx.query<JobRow>(
        `insert into jobs (user_id, kind, source_export_id) values ($1, $2, $3)
         returning ${JOB_COLUMNS}`,
        [reqUserId, kind, source.id],
      );
      return { status: 201 as const, payload: { job: view(created.rows[0]) }, jobId: created.rows[0].id };
    });
  }

  for (const kind of ['epubcheck', 'pdfx'] as const) {
    router.post(`/${kind}`, async (req, res, next) => {
      try {
        const outcome = await createJob(req.user!.id, kind, req.body);
        if (outcome.jobId) runner.enqueue(outcome.jobId);
        return res.status(outcome.status).json(outcome.payload);
      } catch (err) {
        return next(err);
      }
    });
  }

  router.get('/', async (req, res, next) => {
    try {
      const result = await db.query<JobRow>(
        `select ${JOB_COLUMNS} from jobs where user_id = $1 order by created_at desc limit 100`,
        [req.user!.id],
      );
      return res.json({ jobs: result.rows.map(view) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await db.query<JobRow>(
        `select ${JOB_COLUMNS} from jobs where id = $1 and user_id = $2`,
        [req.params.id, req.user!.id],
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'job not found' });
      return res.json({ job: view(row) });
    } catch (err) {
      return next(err);
    }
  });

  return { router, runner };
}
