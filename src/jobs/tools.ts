import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';

/**
 * M5 tool adapters: the ONLY code that talks to the external binaries
 * (EPUBCheck on a JRE, Ghostscript, and a headless-Chromium-compatible
 * HTML-to-PDF renderer). The honesty contract lives here:
 *
 * - A tool that is not configured/installed yields a clear problem
 *   string BEFORE anything runs, and the job completes as FAILED with
 *   that string as its result. No pass is ever fabricated.
 * - A tool that runs is believed exactly as far as its own output:
 *   EPUBCheck's JSON report is parsed as-is (a book WITH errors is a
 *   successful job whose report says so — `passed: false`), and
 *   Ghostscript must both exit 0 AND leave a non-empty output file.
 * - The adapters are stub-able purely through config: point JAVA_BIN /
 *   GS_BIN / HTML_PDF_BIN at any executable (the tests use small shell
 *   scripts) and EPUBCHECK_JAR at any file, and the whole pipeline
 *   runs unchanged.
 */

export interface EpubCheckMessage {
  code: string;
  severity: string;
  message: string;
  location: string | null;
}

export interface EpubCheckReport {
  toolVersion: string | null;
  counts: { fatal: number; errors: number; warnings: number; infos: number; usages: number };
  messages: EpubCheckMessage[];
  /** True iff the report carries no fatal/error findings. */
  passed: boolean;
}

export type ToolOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be started at all (e.g. ENOENT). */
  spawnError: string | null;
}

const OUTPUT_CAP = 16 * 1024 * 1024;

/** Run a command to completion (or timeout kill), capturing output.
 *  Never rejects: every failure mode is reported in the result so the
 *  caller can turn it into an honest job result. */
function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // detached: the child leads its own process group, so a timeout
      // can kill the tool AND anything it spawned (a shell wrapper's
      // children would otherwise hold the output pipes — and the
      // job — open long after the tool itself is dead).
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (err) {
      return resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({ code: null, stdout, stderr, timedOut, spawnError: null });
    }, timeoutMs);
    child.stdout!.on('data', (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString('utf8');
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      finish({ code: null, stdout, stderr, timedOut, spawnError: err.message });
    });
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut, spawnError: null });
    });
  });
}

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed ? ` Tool said: ${trimmed.slice(-300)}` : '';
}

/* ------------------------------ EPUBCheck ------------------------------ */

/** Why EPUBCheck cannot run on this server, or null when it can. */
export function epubcheckProblem(config: Config): string | null {
  if (!config.epubcheckJar) {
    return (
      'EPUBCheck is not configured on this server (EPUBCHECK_JAR is not set), ' +
      'so this job was not run and no validation result exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  if (!existsSync(config.epubcheckJar)) {
    return (
      `EPUBCheck is not configured on this server (no file at the EPUBCHECK_JAR path), ` +
      'so this job was not run and no validation result exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  return null;
}

interface RawEpubCheckMessage {
  ID?: unknown;
  id?: unknown;
  severity?: unknown;
  message?: unknown;
  locations?: unknown;
  location?: unknown;
}

function locationOf(raw: RawEpubCheckMessage): string | null {
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const first = (locations[0] ?? raw.location) as
    | { path?: unknown; line?: unknown; column?: unknown }
    | string
    | undefined;
  if (!first) return null;
  if (typeof first === 'string') return first;
  if (typeof first.path !== 'string') return null;
  let out = first.path;
  if (typeof first.line === 'number') out += `:${first.line}`;
  if (typeof first.column === 'number') out += `:${first.column}`;
  return out;
}

/** Parse an EPUBCheck JSON report. Defensive about the exact shape:
 *  messages may sit at the top level and/or per item; severities are
 *  FATAL / ERROR / WARNING / INFO / USAGE. Returns null when the text
 *  is not a recognisable report at all. */
export function parseEpubCheckReport(rawJson: string): EpubCheckReport | null {
  let doc: unknown;
  try {
    doc = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const root = doc as {
    messages?: unknown;
    items?: unknown;
    checker?: { checkerVersion?: unknown; version?: unknown };
  };
  const rawMessages: RawEpubCheckMessage[] = [];
  if (Array.isArray(root.messages)) rawMessages.push(...(root.messages as RawEpubCheckMessage[]));
  if (Array.isArray(root.items)) {
    for (const item of root.items as Array<{ messages?: unknown }>) {
      if (Array.isArray(item?.messages)) {
        rawMessages.push(...(item.messages as RawEpubCheckMessage[]));
      }
    }
  }
  if (!rawMessages.length && !Array.isArray(root.messages) && !Array.isArray(root.items)) {
    return null;
  }
  const counts = { fatal: 0, errors: 0, warnings: 0, infos: 0, usages: 0 };
  const messages: EpubCheckMessage[] = rawMessages.map((raw) => {
    const severity = String(raw.severity ?? '').toUpperCase();
    switch (severity) {
      case 'FATAL':
        counts.fatal += 1;
        break;
      case 'ERROR':
        counts.errors += 1;
        break;
      case 'WARNING':
        counts.warnings += 1;
        break;
      case 'USAGE':
        counts.usages += 1;
        break;
      default:
        counts.infos += 1;
        break;
    }
    return {
      code: String(raw.ID ?? raw.id ?? ''),
      severity,
      message: String(raw.message ?? ''),
      location: locationOf(raw),
    };
  });
  const checker = root.checker ?? {};
  const toolVersion =
    typeof checker.checkerVersion === 'string'
      ? checker.checkerVersion
      : typeof checker.version === 'string'
        ? checker.version
        : null;
  return {
    toolVersion,
    counts,
    messages,
    passed: counts.fatal === 0 && counts.errors === 0,
  };
}

export async function runEpubCheck(
  config: Config,
  epubPath: string,
  workDir: string,
): Promise<ToolOutcome<EpubCheckReport>> {
  const jsonPath = path.join(workDir, 'epubcheck-report.json');
  // EPUBCheck picks its mode from the .epub extension and refuses anything
  // else ("Mode required for non-epub files"). The archive stores exports
  // by id with no extension, so check a .epub-named copy in the job's dir.
  const bookPath = path.join(workDir, 'book.epub');
  await copyFile(epubPath, bookPath);
  // EPUBCheck 5.x spells the JSON flag --json; some builds accept the
  // short -j. Try the long form first, then the short form, and accept
  // a report from the output file OR from stdout.
  let lastRun: CommandResult | null = null;
  for (const flag of ['--json', '-j']) {
    const run = await runCommand(
      config.javaBin,
      ['-jar', config.epubcheckJar!, bookPath, flag, jsonPath],
      config.jobTimeoutMs,
    );
    lastRun = run;
    if (run.timedOut) {
      return {
        ok: false,
        error: `EPUBCheck did not finish within ${config.jobTimeoutMs} ms and was stopped.`,
      };
    }
    if (run.spawnError) {
      return {
        ok: false,
        error:
          `EPUBCheck could not be started (the Java runtime at JAVA_BIN="${config.javaBin}" ` +
          `did not run: ${run.spawnError}). This is a server setup gap, not a finding about your book.`,
      };
    }
    const fromFile = await readFile(jsonPath, 'utf8').catch(() => null);
    const report =
      (fromFile && parseEpubCheckReport(fromFile)) ||
      (run.stdout && parseEpubCheckReport(run.stdout));
    if (report) return { ok: true, value: report };
  }
  return {
    ok: false,
    error:
      `EPUBCheck ran (exit code ${lastRun?.code ?? 'unknown'}) but produced no readable ` +
      `report, so no validation result exists.${stderrTail(lastRun?.stderr ?? '')}`,
  };
}

/* -------------------- HTML → PDF rendition (print interior) -------------------- */

/** Why the print interior cannot be rendered to PDF on this server, or null when it can. */
export function pdfRenderProblem(config: Config): string | null {
  if (!config.htmlPdfBin) {
    return (
      'HTML-to-PDF rendition is not configured on this server (HTML_PDF_BIN is not set), ' +
      'so this job was not run and no converted file exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  const probe = spawnSync(config.htmlPdfBin, ['--version'], { timeout: 5_000, encoding: 'utf8' });
  if (probe.error) {
    return (
      `HTML-to-PDF rendition is not configured on this server (the renderer at HTML_PDF_BIN="${config.htmlPdfBin}" ` +
      'did not run), so this job was not run and no converted file exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  return null;
}

/**
 * Render a print-html interior to PDF with a headless-Chromium-compatible
 * binary. The print interior's @page CSS carries the trim size, so the
 * rendition honors it; --no-pdf-header-footer keeps the browser's own
 * chrome out of the book.
 */
export function renderPdfArgs(htmlPdfBin: string, inputPath: string, outputPath: string): string[] {
  const url = inputPath.startsWith('file://') ? inputPath : `file://${inputPath}`;
  return [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--print-to-pdf=${outputPath}`,
    '--no-pdf-header-footer',
    url,
  ];
}

export async function renderPrintPdf(
  config: Config,
  inputPath: string,
  outputPath: string,
): Promise<ToolOutcome<{ pdfBytes: number }>> {
  const run = await runCommand(
    config.htmlPdfBin!,
    renderPdfArgs(config.htmlPdfBin!, inputPath, outputPath),
    config.jobTimeoutMs,
  );
  if (run.timedOut) {
    return {
      ok: false,
      error: `The HTML-to-PDF renderer did not finish within ${config.jobTimeoutMs} ms and was stopped.`,
    };
  }
  if (run.spawnError) {
    return {
      ok: false,
      error:
        `The HTML-to-PDF renderer could not be started (HTML_PDF_BIN="${config.htmlPdfBin}": ${run.spawnError}). ` +
        'This is a server setup gap, not a finding about your book.',
    };
  }
  if (run.code !== 0) {
    return {
      ok: false,
      error:
        `The HTML-to-PDF renderer exited with code ${run.code} and produced no PDF.` +
        stderrTail(run.stderr),
    };
  }
  const produced = await readFile(outputPath).catch(() => null);
  if (!produced || produced.length === 0) {
    return {
      ok: false,
      error:
        'The HTML-to-PDF renderer reported success but left no output file, so no converted file exists.',
    };
  }
  if (produced.subarray(0, 4).toString('latin1') !== '%PDF') {
    return {
      ok: false,
      error:
        'The HTML-to-PDF renderer left a file that is not a PDF, so it cannot be converted to PDF/X.',
    };
  }
  return { ok: true, value: { pdfBytes: produced.length } };
}

/* ------------------------------ PDF/X (Ghostscript) ------------------------------ */

/** Why PDF/X conversion cannot run on this server, or null when it can. */
export function pdfxProblem(config: Config): string | null {
  if (!config.gsBin) {
    return (
      'PDF/X conversion is not configured on this server (GS_BIN is not set), ' +
      'so this job was not run and no converted file exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  const probe = spawnSync(config.gsBin, ['--version'], { timeout: 5_000, encoding: 'utf8' });
  if (probe.error) {
    return (
      `PDF/X conversion is not configured on this server (Ghostscript at GS_BIN="${config.gsBin}" ` +
      'did not run), so this job was not run and no converted file exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  if (!existsSync(config.pdfxDefPath)) {
    return (
      'PDF/X conversion is not configured on this server (the PDF/X definition file at ' +
      'PDFX_DEF is missing), so this job was not run and no converted file exists. This ' +
      'is a server setup gap, not a finding about your book.'
    );
  }
  return null;
}

/**
 * The documented Ghostscript PDF/X-1a recipe: the PDFX definition
 * file (tools/PDFX_def.ps — declares the GTS_PDFX OutputIntent and
 * embeds the CMYK ICC profile it points at) is fed BEFORE the input,
 * all colour is converted to DeviceCMYK, and the result is written
 * as a prepress PDF. Ghostscript consumes PDF input, so the pdfx job
 * always renders the print-html interior to PDF first (see
 * renderPrintPdf above); raw HTML is never fed to Ghostscript.
 */
export function ghostscriptPdfxArgs(config: Config, inputPath: string, outputPath: string): string[] {
  return [
    '-dPDFX',
    '-dBATCH',
    '-dNOPAUSE',
    '-dNOOUTERSAVE',
    '-sDEVICE=pdfwrite',
    '-dPDFSETTINGS=/prepress',
    '-sColorConversionStrategy=CMYK',
    '-sProcessColorModel=DeviceCMYK',
    `-sOutputFile=${outputPath}`,
    config.pdfxDefPath,
    inputPath,
  ];
}

export async function runPdfx(
  config: Config,
  inputPath: string,
  outputPath: string,
): Promise<ToolOutcome<{ gsVersion: string | null }>> {
  const versionProbe = spawnSync(config.gsBin!, ['--version'], { timeout: 5_000, encoding: 'utf8' });
  const gsVersion =
    !versionProbe.error && typeof versionProbe.stdout === 'string'
      ? versionProbe.stdout.trim() || null
      : null;
  const run = await runCommand(
    config.gsBin!,
    ghostscriptPdfxArgs(config, inputPath, outputPath),
    config.jobTimeoutMs,
  );
  if (run.timedOut) {
    return {
      ok: false,
      error: `Ghostscript did not finish within ${config.jobTimeoutMs} ms and was stopped.`,
    };
  }
  if (run.spawnError) {
    return {
      ok: false,
      error:
        `Ghostscript could not be started (GS_BIN="${config.gsBin}": ${run.spawnError}). ` +
        'This is a server setup gap, not a finding about your book.',
    };
  }
  if (run.code !== 0) {
    return {
      ok: false,
      error:
        `Ghostscript exited with code ${run.code} and produced no converted file.` +
        stderrTail(run.stderr),
    };
  }
  const produced = await readFile(outputPath).catch(() => null);
  if (!produced || produced.length === 0) {
    return {
      ok: false,
      error: 'Ghostscript reported success but left no output file, so no converted file exists.',
    };
  }
  return { ok: true, value: { gsVersion } };
}
