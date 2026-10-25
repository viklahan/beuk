import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { inspectPdf, type PdfInspection } from './pdfinspect.js';
import { epubcheckProblem, pdfRenderProblem, pdfxProblem, renderPrintPdf, runEpubCheck, runPdfx } from './tools.js';

/**
 * M5 job runner: a deliberately simple in-process worker. One
 * Hetzner box runs this app, so jobs drain ONE AT A TIME from an
 * in-memory queue — EPUBCheck and Ghostscript are heavy, serialising
 * them is a feature. Every job ends in exactly one terminal state:
 * `done` (the tool ran; its parsed outcome is the result) or
 * `failed` (the result says plainly why — tool not configured, tool
 * error, timeout — and never pretends to be a pass).
 */

export type JobKind = 'epubcheck' | 'pdfx';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  user_id: string;
  kind: JobKind;
  source_export_id: string | null;
  status: JobStatus;
  result: Record<string, unknown> | null;
  artifact_export_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface SourceExportRow {
  id: string;
  manuscript_id: string | null;
  format: string;
  filename: string;
}

export class JobRunner {
  private queue: string[] = [];
  private draining = false;
  private stopping = false;
  private current: { jobId: string; done: Promise<void> } | null = null;

  constructor(
    private db: Db,
    private config: Config,
  ) {}

  enqueue(jobId: string): void {
    this.queue.push(jobId);
    if (!this.stopping) void this.drain();
  }

  /** Graceful shutdown: take no further jobs (queued ones stay `queued`
   *  in the database and recover() re-runs them on the next boot), give
   *  the running job up to `graceMs` to finish, and if it is still
   *  running then, mark it failed saying exactly that — never leave it
   *  looking alive, never pretend it passed. */
  async shutdown(graceMs: number): Promise<{ finished: boolean; failedJobId: string | null }> {
    this.stopping = true;
    this.queue = [];
    const current = this.current;
    if (!current) return { finished: true, failedJobId: null };
    let timer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      current.done.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    clearTimeout(timer);
    if (settled) return { finished: true, failedJobId: null };
    await this.db.query(
      `update jobs set status = 'failed', finished_at = now(), result = $2::jsonb
       where id = $1 and status = 'running'`,
      [
        current.jobId,
        JSON.stringify({
          error:
            'The server was shutting down and this job did not finish in time, so it was stopped. ' +
            'Nothing was checked or converted — please run it again.',
        }),
      ],
    );
    return { finished: false, failedJobId: current.jobId };
  }

  /** Boot recovery (called once from index.ts): a job left `running`
   *  by a dead process can never finish, so fail it honestly and say
   *  why; jobs still `queued` are simply picked up again. */
  async recover(): Promise<void> {
    await this.db.query(
      `update jobs set status = 'failed', finished_at = now(), result = $1::jsonb
       where status = 'running'`,
      [
        JSON.stringify({
          error:
            'The server restarted while this job was running, so it never finished. ' +
            'Nothing was checked or converted — please run it again.',
        }),
      ],
    );
    const queued = await this.db.query<{ id: string }>(
      `select id from jobs where status = 'queued' order by created_at`,
    );
    for (const row of queued.rows) this.enqueue(row.id);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.stopping) {
        const jobId = this.queue.shift()!;
        const done = this.process(jobId).catch((err) => {
          // process() converts every expected failure into a job
          // result; reaching here means something structural broke.
          console.error(`job ${jobId}: unexpected runner error`, err);
        });
        this.current = { jobId, done };
        await done;
        this.current = null;
      }
    } finally {
      this.draining = false;
    }
  }

  private async finish(
    jobId: string,
    status: 'done' | 'failed',
    result: Record<string, unknown>,
    artifactExportId: string | null = null,
  ): Promise<void> {
    // Only a job still `running` can finish: once shutdown() has failed
    // it, a late tool exit must not overwrite that honest record.
    await this.db.query(
      `update jobs set status = $2, result = $3::jsonb, artifact_export_id = $4,
              finished_at = now()
       where id = $1 and status = 'running'`,
      [jobId, status, JSON.stringify(result), artifactExportId],
    );
  }

  private async process(jobId: string): Promise<void> {
    const found = await this.db.query<JobRow>('select * from jobs where id = $1', [jobId]);
    const job = found.rows[0];
    if (!job || job.status !== 'queued') return;
    await this.db.query(
      `update jobs set status = 'running', started_at = now() where id = $1`,
      [jobId],
    );

    if (!job.source_export_id) {
      return this.finish(jobId, 'failed', {
        error: 'The source export for this job no longer exists, so there was nothing to run on.',
      });
    }
    const sourceResult = await this.db.query<SourceExportRow>(
      'select id, manuscript_id, format, filename from exports where id = $1 and user_id = $2',
      [job.source_export_id, job.user_id],
    );
    const source = sourceResult.rows[0];
    if (!source) {
      return this.finish(jobId, 'failed', {
        error: 'The source export for this job no longer exists, so there was nothing to run on.',
      });
    }
    const sourcePath = path.join(this.config.exportDir, job.user_id, source.id);
    try {
      await stat(sourcePath);
    } catch {
      return this.finish(jobId, 'failed', {
        error: "The source export's file is missing from storage, so the job could not run.",
      });
    }

    // Tool gating FIRST: an unconfigured tool is a failed job with
    // the reason stated — creation succeeded, honesty preserved.
    // The pdfx pipeline is two tools in sequence (HTML → PDF rendition,
    // then PDF → PDF/X conversion); the rendition is gated first so a
    // missing renderer fails before Ghostscript ever sees raw HTML.
    const problem =
      job.kind === 'epubcheck'
        ? epubcheckProblem(this.config)
        : (pdfRenderProblem(this.config) ?? pdfxProblem(this.config));
    if (problem) {
      const missingTool =
        job.kind === 'epubcheck'
          ? 'epubcheck'
          : pdfRenderProblem(this.config)
            ? 'html-to-pdf'
            : 'ghostscript';
      return this.finish(jobId, 'failed', {
        tool: missingTool,
        configured: false,
        error: problem,
      });
    }

    const workDir = await mkdtemp(path.join(os.tmpdir(), 'beuk-job-'));
    try {
      if (job.kind === 'epubcheck') return await this.processEpubCheck(job, sourcePath, workDir);
      return await this.processPdfx(job, source, sourcePath, workDir);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async processEpubCheck(job: JobRow, sourcePath: string, workDir: string): Promise<void> {
    const outcome = await runEpubCheck(this.config, sourcePath, workDir);
    if (!outcome.ok) {
      return this.finish(job.id, 'failed', { tool: 'epubcheck', configured: true, error: outcome.error });
    }
    const report = outcome.value;
    return this.finish(job.id, 'done', {
      tool: 'epubcheck',
      toolVersion: report.toolVersion,
      passed: report.passed,
      counts: report.counts,
      messages: report.messages,
    });
  }

  private async processPdfx(
    job: JobRow,
    source: SourceExportRow,
    sourcePath: string,
    workDir: string,
  ): Promise<void> {
    // Step 1: render the print-html interior to PDF. Ghostscript only
    // consumes PDF, so raw HTML never reaches it.
    const renderedPath = path.join(workDir, 'rendered.pdf');
    const rendered = await renderPrintPdf(this.config, sourcePath, renderedPath);
    if (!rendered.ok) {
      return this.finish(job.id, 'failed', {
        tool: 'html-to-pdf',
        configured: true,
        error: rendered.error,
      });
    }
    // Step 2: convert the rendered PDF to PDF/X-1a.
    const outputPath = path.join(workDir, 'converted.pdf');
    const outcome = await runPdfx(this.config, renderedPath, outputPath);
    if (!outcome.ok) {
      return this.finish(job.id, 'failed', {
        tool: 'ghostscript',
        configured: true,
        error: outcome.error,
      });
    }
    // The conversion produced a real file: store it back into the
    // user's archive as a new export (format 'pdfx'), linked to the
    // same manuscript as its source, then point the job at it.
    const bytes = await readFile(outputPath);
    // Store-ready tie-in: read the converted file's own facts (pages,
    // boxes, PDF/X declaration, font embedding, RGB leftovers) so the
    // studio's report states what the file says, not what we hope.
    let inspection: PdfInspection | { error: string };
    try {
      inspection = inspectPdf(bytes);
    } catch (err) {
      inspection = {
        error: `The converted PDF could not be read for inspection: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const base = source.filename.replace(/\.[^.]*$/, '') || 'beuk-export';
    const filename = `${base}-pdfx.pdf`;
    const created = await this.db.query<{ id: string }>(
      `insert into exports (user_id, manuscript_id, format, preset, filename, byte_size, sha256)
       values ($1, $2, 'pdfx', null, $3, $4, $5) returning id`,
      [job.user_id, source.manuscript_id, filename, bytes.length, sha256],
    );
    const artifactId = created.rows[0].id;
    try {
      await mkdir(path.join(this.config.exportDir, job.user_id), { recursive: true });
      await writeFile(path.join(this.config.exportDir, job.user_id, artifactId), bytes);
    } catch (err) {
      await this.db.query('delete from exports where id = $1', [artifactId]).catch(() => {});
      throw err;
    }
    return this.finish(
      job.id,
      'done',
      {
        tool: 'ghostscript',
        gsVersion: outcome.value.gsVersion,
        renderedPdfBytes: rendered.value.pdfBytes,
        artifactExportId: artifactId,
        outputBytes: bytes.length,
        outputSha256: sha256,
        inspection,
      },
      artifactId,
    );
  }
}
