import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { keepExportFileIfRowSurvived } from '../exports-store.js';
import { inspectPdf, type PdfInspection } from './pdfinspect.js';
import { neutralRgbToGray, textInkFacts, transparencyFacts, type TextInkFacts, type TransparencyFacts } from './pdfpress.js';
import { epubcheckProblem, measureTac, pdfRenderProblem, pdfxProblem, renderPrintPdf, runEpubCheck, runPdfx, type TacMeasurement } from './tools.js';

/**
 * M5 job runner: a deliberately simple in-process worker. One
 * Hetzner box runs this app, so jobs drain ONE AT A TIME from an
 * in-memory queue — EPUBCheck and Ghostscript are heavy, serialising
 * them is a feature. Every job ends in exactly one terminal state:
 * `done` (the tool ran; its parsed outcome is the result) or
 * `failed` (the result says plainly why — tool not configured, tool
 * error, timeout — and never pretends to be a pass).
 */

/**
 * Why a failed job failed, as one code the studio's Store-ready report
 * turns into a remedy (client/index.html, storeServerFix). Classified
 * here, from this server's own messages, so the browser never has to
 * guess from English prose:
 *  - setup:       a tool isn't installed or reachable (configured: false,
 *                 or a message that says "server setup gap")
 *  - timeout:     a tool ran out of time
 *  - interrupted: the server shut down or restarted mid-job
 *  - missing:     the archived export (or its file) is gone
 *  - renderer:    the HTML-to-PDF renderer answered without a PDF
 *  - tool:        Ghostscript or EPUBCheck ran but left no usable output
 *  - unknown:     anything else
 */
export type JobFailureCause = 'setup' | 'timeout' | 'interrupted' | 'missing' | 'renderer' | 'tool' | 'unknown';

export function failureCause(result: Record<string, unknown>): JobFailureCause {
  const error = typeof result.error === 'string' ? result.error : '';
  if (result.configured === false || /server setup gap/i.test(error)) return 'setup';
  if (/did not finish within/i.test(error)) return 'timeout';
  if (/shutting down|server restarted/i.test(error)) return 'interrupted';
  if (/no longer exists|missing from storage/i.test(error)) return 'missing';
  if (/HTML-to-PDF renderer/i.test(error)) return 'renderer';
  if (/Ghostscript|EPUBCheck|converted PDF/i.test(error)) return 'tool';
  return 'unknown';
}

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
          cause: 'interrupted',
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
          cause: 'interrupted',
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
      [jobId, status, JSON.stringify(status === 'failed' ? { ...result, cause: failureCause(result) } : result), artifactExportId],
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
    // Step 1b (press): what in the renderer's PDF PDF/X-1a will make
    // Ghostscript flatten, and which pages carry text before conversion;
    // then neutral greys (black text included) become DeviceGray so they
    // print on the black plate alone (src/jobs/pdfpress.ts says why).
    const renderedBytes = await readFile(renderedPath);
    const press: Record<string, unknown> = {};
    let renderedText: TextInkFacts | null = null;
    try {
      press.renderedTransparency = transparencyFacts(renderedBytes) satisfies TransparencyFacts;
      renderedText = textInkFacts(renderedBytes);
    } catch (err) {
      press.renderedReadError = err instanceof Error ? err.message : String(err);
    }
    let gsInput = renderedPath;
    try {
      const gray = neutralRgbToGray(renderedBytes);
      press.neutralGray = { streams: gray.streams, operators: gray.operators, skipped: gray.skipped };
      if (gray.operators > 0) {
        gsInput = path.join(workDir, 'rendered-gray.pdf');
        await writeFile(gsInput, gray.pdf);
      }
    } catch (err) {
      press.neutralGray = { streams: 0, operators: 0, skipped: `the rewrite failed, so the PDF was converted as rendered: ${err instanceof Error ? err.message : String(err)}` };
    }
    press.colourConversion = this.config.pdfxIccDir
      ? { profileDir: this.config.pdfxIccDir, through: 'default_cmyk.icc in PDFX_ICC_DIR (the press profile in the tools image)' }
      : { profileDir: null, through: "Ghostscript's built-in default_cmyk.icc — NOT the profile the OutputIntent declares (PDFX_ICC_DIR is not set)" };
    // Step 2: convert the rendered PDF to PDF/X-1a.
    const outputPath = path.join(workDir, 'converted.pdf');
    // A long book is converted in runs of PDFX_CHUNK_PAGES pages
    // (src/jobs/tools.ts runPdfx says why); the page count comes from the
    // renderer's own PDF.
    const pageCount = renderedText ? renderedText.pageCount : null;
    const outcome = await runPdfx(this.config, gsInput, outputPath, { pageCount, workDir });
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
    // Press facts measured on the converted file itself: the colour every
    // piece of text is shown in, the pages that still carry real text
    // (a page Ghostscript flattened to a picture carries none), and the
    // highest total ink of a CMYK raster of every page.
    let outText: TextInkFacts | null = null;
    try {
      outText = textInkFacts(bytes);
      press.text = {
        textShows: outText.textShows,
        kOnly: outText.kOnly,
        kValues: outText.kValues,
        otherColours: outText.otherColours,
        notes: outText.notes.slice(0, 10),
      };
    } catch (err) {
      press.text = { error: err instanceof Error ? err.message : String(err) };
    }
    if (renderedText && outText) {
      const kept = new Set(outText.pagesWithText);
      const lost = renderedText.pagesWithText.filter((p) => !kept.has(p));
      press.textPages = {
        rendered: renderedText.pagesWithText.length,
        converted: outText.pagesWithText.length,
        // Pages whose text the renderer wrote as text but the converted
        // file no longer carries as text: flattened to pictures.
        flattened: renderedText.pageCount === outText.pageCount ? lost.length : null,
        flattenedPages: renderedText.pageCount === outText.pageCount ? lost.slice(0, 200) : null,
      };
    }
    const ink = await measureTac(this.config, outputPath, workDir, outText ? outText.pageCount : pageCount);
    press.ink = ink.ok ? (ink.value satisfies TacMeasurement) : { error: ink.error };
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
    // The account may have been deleted while this job ran: then its
    // file must not outlive it.
    if (!(await keepExportFileIfRowSurvived(this.db, this.config.exportDir, job.user_id, artifactId))) {
      return this.finish(job.id, 'failed', { tool: 'ghostscript', error: 'the account was deleted while this job ran' });
    }
    return this.finish(
      job.id,
      'done',
      {
        tool: 'ghostscript',
        gsVersion: outcome.value.gsVersion,
        conversion: outcome.value.conversion,
        renderedPdfBytes: rendered.value.pdfBytes,
        // page-bottom notes: placed / kept at a section's end, and why
        // (the renderer's x-beuk-footnotes header); null when it set none
        footnotes: rendered.value.footnotes,
        artifactExportId: artifactId,
        outputBytes: bytes.length,
        outputSha256: sha256,
        inspection,
        press,
      },
      artifactId,
    );
  }
}
