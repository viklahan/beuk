import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { parsePam, tacFromPam } from './pdfpress.js';

/**
 * M5 tool adapters: the ONLY code that talks to the external binaries
 * (EPUBCheck on a JRE, Ghostscript) and to the isolated HTML-to-PDF
 * renderer service (headless Chromium in its own locked-down container,
 * reached over HTTP at RENDERER_URL). The honesty contract lives here:
 *
 * - A tool that is not configured/installed yields a clear problem
 *   string BEFORE anything runs, and the job completes as FAILED with
 *   that string as its result. No pass is ever fabricated.
 * - A tool that runs is believed exactly as far as its own output:
 *   EPUBCheck's JSON report is parsed as-is (a book WITH errors is a
 *   successful job whose report says so — `passed: false`), and
 *   Ghostscript must both exit 0 AND leave a non-empty output file.
 * - The adapters are stub-able purely through config: point JAVA_BIN /
 *   GS_BIN at any executable (the tests use small shell scripts),
 *   EPUBCHECK_JAR at any file, and RENDERER_URL at any HTTP server that
 *   answers like deploy/renderer/server.mjs (the tests run a stub), and
 *   the whole pipeline runs unchanged.
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
      // -Xmx caps the JVM heap so one hostile or enormous EPUB fails with
      // an OutOfMemoryError (reported below) instead of starving the box.
      // https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html (-Xmx)
      [`-Xmx${config.javaMaxHeap}`, '-jar', config.epubcheckJar!, bookPath, flag, jsonPath],
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

/** Why the print interior cannot be rendered to PDF on this server, or null when it can.
 *  "Can" means a renderer is configured; whether it answers is only known
 *  when a job calls it, and an unreachable renderer fails that job saying so. */
export function pdfRenderProblem(config: Config): string | null {
  if (!config.rendererUrl) {
    const legacy = config.legacyHtmlPdfBin
      ? ' HTML_PDF_BIN is set but no longer used: rendering user HTML with a browser inside ' +
        "the app container exposed the app's secrets and storage, so rendition now runs only " +
        'in the isolated renderer service (deploy/docker-compose.tools.yml).'
      : '';
    return (
      'HTML-to-PDF rendition is not configured on this server (RENDERER_URL is not set), ' +
      'so this job was not run and no converted file exists. This is a ' +
      'server setup gap, not a finding about your book.' +
      legacy
    );
  }
  let url: URL;
  try {
    url = new URL(config.rendererUrl);
  } catch {
    url = new URL('invalid:');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return (
      `HTML-to-PDF rendition is not configured on this server (RENDERER_URL="${config.rendererUrl}" ` +
      'is not an http(s) URL), so this job was not run and no converted file exists. This is a ' +
      'server setup gap, not a finding about your book.'
    );
  }
  return null;
}

/**
 * Render a print-html interior to PDF in the isolated renderer service
 * (deploy/renderer/server.mjs): the HTML bytes are POSTed to
 * RENDERER_URL and the PDF comes back in the response body. The
 * browser that interprets the user's HTML never runs in this process's
 * container, so it can reach none of the app's environment, volumes,
 * or database. The print interior's @page CSS carries the trim size;
 * the renderer honours it (preferCSSPageSize) with no browser header/footer.
 */
export async function renderPrintPdf(
  config: Config,
  inputPath: string,
  outputPath: string,
): Promise<ToolOutcome<{ pdfBytes: number }>> {
  const html = await readFile(inputPath);
  let response: Response;
  try {
    response = await fetch(config.rendererUrl!, {
      method: 'POST',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html,
      signal: AbortSignal.timeout(config.jobTimeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        error: `The HTML-to-PDF renderer did not finish within ${config.jobTimeoutMs} ms and was stopped.`,
      };
    }
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
    return {
      ok: false,
      error:
        `The HTML-to-PDF renderer could not be reached (RENDERER_URL="${config.rendererUrl}": ${cause}). ` +
        'This is a server setup gap, not a finding about your book.',
    };
  }
  let body: Buffer;
  try {
    body = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return {
      ok: false,
      error:
        name === 'TimeoutError' || name === 'AbortError'
          ? `The HTML-to-PDF renderer did not finish within ${config.jobTimeoutMs} ms and was stopped.`
          : 'The HTML-to-PDF renderer dropped the connection before sending a PDF, so no converted file exists.',
    };
  }
  if (response.status !== 200) {
    let said = '';
    try {
      const parsed = JSON.parse(body.toString('utf8')) as { error?: unknown };
      if (typeof parsed.error === 'string') said = ` Renderer said: ${parsed.error.slice(0, 300)}`;
    } catch {
      /* not JSON — say nothing more than the status */
    }
    return {
      ok: false,
      error: `The HTML-to-PDF renderer answered HTTP ${response.status} and produced no PDF.${said}`,
    };
  }
  if (body.length === 0) {
    return {
      ok: false,
      error:
        'The HTML-to-PDF renderer reported success but sent no bytes, so no converted file exists.',
    };
  }
  if (body.subarray(0, 4).toString('latin1') !== '%PDF') {
    return {
      ok: false,
      error:
        'The HTML-to-PDF renderer sent something that is not a PDF, so it cannot be converted to PDF/X.',
    };
  }
  await writeFile(outputPath, body);
  return { ok: true, value: { pdfBytes: body.length } };
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
  // The def file embeds a CMYK press profile; a missing one makes
  // Ghostscript die with a raw /undefinedfilename, so say it plainly.
  const icc = pdfxIccPath(config.pdfxDefPath);
  if (icc && !existsSync(icc)) {
    return (
      'PDF/X conversion is not configured on this server (no CMYK press colour profile at ' +
      `"${icc}", the path PDFX_DEF names), so this job was not run and no converted file ` +
      'exists. This is a server setup gap, not a finding about your book.'
    );
  }
  // The conversion profile directory (PDFX_ICC_DIR): without its
  // default_cmyk.icc Ghostscript would fail to start its colour
  // management, so a half-built directory is a setup gap, said plainly.
  if (config.pdfxIccDir && !existsSync(path.join(config.pdfxIccDir, 'default_cmyk.icc'))) {
    return (
      'PDF/X conversion is not configured on this server (the colour-conversion profile directory ' +
      `PDFX_ICC_DIR="${config.pdfxIccDir}" has no default_cmyk.icc), so this job was not run and no ` +
      'converted file exists. This is a server setup gap, not a finding about your book.'
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
/** The ICC profile path PDFX_def.ps embeds (its `/BeukICCPath (…) def`
 *  line), or null when the file is unreadable or carries no such line. */
export function pdfxIccPath(defPath: string): string | null {
  let text: string;
  try {
    text = readFileSync(defPath, 'latin1');
  } catch {
    return null;
  }
  const match = /^\/BeukICCPath \(([^()]*)\) def/m.exec(text);
  return match ? match[1] : null;
}

export function ghostscriptPdfxArgs(config: Config, inputPath: string, outputPath: string): string[] {
  // The rendered PDF carries user-influenced content (text, images, and
  // the writer's uploaded fonts, subset-embedded by Chromium), so it is
  // interpreted under -dSAFER — file access limited to the inputs named
  // here, no device or parameter tampering. SAFER has been Ghostscript's
  // default since 9.50; it is spelled out so a different gs build can
  // never silently drop it. Under SAFER the definition file may only read
  // the ICC profile it embeds if that one file is explicitly permitted.
  // https://ghostscript.readthedocs.io/en/latest/Use.html (-dSAFER, --permit-file-read)
  const icc = pdfxIccPath(config.pdfxDefPath);
  return [
    '-dSAFER',
    ...(icc ? [`--permit-file-read=${icc}`] : []),
    ...pdfxIccDirArgs(config),
    '-dPDFX',
    // Chromium writes the book's links (TOC entries, URLs) as Link
    // annotations. PDF/X forbids annotations other than TrapNet /
    // PrinterMark, and on meeting one Ghostscript 10.00.0 prints
    // "Annotation (not TrapNet or PrinterMark) on page, not permitted in
    // PDF/X, reverting to normal PDF output" — while PDFX_def.ps still
    // stamps the PDF/X keys, i.e. a file that CLAIMS PDF/X-1a but is not
    // (observed 2026-10-24 on the bundled sample). Links have no place in
    // a printed interior, so they are dropped: -dShowAnnots=false makes
    // the PDF interpreter skip the page Annots, -dPreserveAnnots=false
    // stops pdfwrite carrying any across. Without these flags the same
    // run printed the revert message; with them it did not.
    // https://ghostscript.readthedocs.io/en/latest/Use.html (-dShowAnnots)
    // https://ghostscript.readthedocs.io/en/latest/VectorDevices.html (-dPreserveAnnots)
    '-dShowAnnots=false',
    '-dPreserveAnnots=false',
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

/**
 * Which CMYK the conversion lands in. pdfwrite (ColorConversionStrategy=
 * CMYK) converts DeviceRGB into its default_cmyk.icc and does NOT honour
 * -sOutputICCProfile: on GPL Ghostscript 10.00.0 (2026-10-25, a probe
 * page of #000 / #404040 / #191713 / #8a2b1c), -sOutputICCProfile=<the
 * SWOP profile> — with or without -dOverrideICC, before or after
 * -sDEVICE, under SAFER or NOSAFER — and -sDefaultCMYKProfile changed
 * not one value: `0 0 0 rg` became `0.722 0.675 0.671 0.882 k` every
 * time, which is what LittleCMS gives for sRGB → Ghostscript's own
 * default_cmyk.icc (relative colorimetric + black point compensation),
 * not the SWOP profile (that gives 0.714 0.659 0.651 1.000). A
 * Ghostscript bug report says the same of 9.27 ("it is not possible to
 * specify output icc profile … for RGB-to-CMYK pdfwrite conversion",
 * https://bugs.ghostscript.com/show_bug.cgi?id=701022, closed WONTFIX —
 * read via a search summary; the tracker blocked a direct fetch).
 * -sICCProfilesDir DOES move it: Ghostscript finds default_cmyk.icc by
 * name in that directory (https://ghostscript.readthedocs.io/en/latest/GhostscriptColorManagement.html,
 * "-sICCProfilesDir"), and with a directory whose default_cmyk.icc is
 * the SWOP2006_Coated3v2 profile the same probe gave
 * `0.71 0.659 0.651 0.996 k` — the SWOP transform. The tools image
 * builds that directory (deploy/Dockerfile.tools: Ghostscript's own
 * profiles, with default_cmyk.icc replaced by an unaltered copy of the
 * pinned SWOP file), so the CMYK numbers come from the very profile the
 * OutputIntent declares. Under SAFER the directory must be readable.
 */
export function pdfxIccDirArgs(config: Pick<Config, 'pdfxIccDir'>): string[] {
  if (!config.pdfxIccDir) return [];
  const dir = config.pdfxIccDir.endsWith('/') ? config.pdfxIccDir : `${config.pdfxIccDir}/`;
  return [`--permit-file-read=${dir}`, `-sICCProfilesDir=${dir}`];
}

/** Ghostscript's "reverting to normal PDF output" notice (it means the
 *  output is NOT PDF/X), joined onto one line, or null when absent. */
export function pdfxRevertMessage(output: string): string | null {
  // Ghostscript 10.00.0 wraps the notice over two lines:
  //   GPL Ghostscript 10.00.0: Annotation (not TrapNet or PrinterMark) on page,
  //    not permitted in PDF/X, reverting to normal PDF output
  // so the line before is kept when it is that "GPL Ghostscript …:" start.
  const lines = output.split(/\r?\n/);
  const i = lines.findIndex((l) => /reverting to normal PDF output/i.test(l));
  if (i === -1) return null;
  const parts = [lines[i]];
  if (i > 0 && !/Ghostscript [0-9.]+:/.test(lines[i]) && /Ghostscript [0-9.]+:/.test(lines[i - 1])) parts.unshift(lines[i - 1]);
  return parts.map((p) => p.trim()).join(' ').slice(0, 300);
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
    config.pdfxTimeoutMs,
  );
  if (run.timedOut) {
    return {
      ok: false,
      error:
        `Ghostscript did not finish within ${config.pdfxTimeoutMs} ms (PDFX_TIMEOUT_MS) and was stopped. ` +
        'Pages with any transparency are flattened to images, which is slow on picture-heavy books.',
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
  // Ghostscript gives up on PDF/X for things it cannot make conformant
  // (it says "... not permitted in PDF/X, reverting to normal PDF
  // output") yet still exits 0 — and the definition file has already
  // stamped the PDF/X keys. Such a file would CLAIM PDF/X falsely, so
  // the job fails with Ghostscript's own words instead.
  const said = `${run.stdout}\n${run.stderr}`;
  const revert = pdfxRevertMessage(said);
  if (revert) {
    return {
      ok: false,
      error:
        `Ghostscript could not keep this file PDF/X and wrote a plain PDF instead, so no PDF/X file exists. Ghostscript said: ${revert}`,
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

/* ------------------------------ total ink (Ghostscript pamcmyk32) ------------------------------ */

export interface TacMeasurement {
  /** Highest per-pixel C+M+Y+K over every page, in percent. */
  maxTacPct: number;
  /** The same per page (1-based order). */
  perPagePct: number[];
  dpi: number;
}

/**
 * Total ink, measured on the converted file itself: Ghostscript renders
 * every page to an 8-bit CMYK raster (the pamcmyk32 device, "Netpbm
 * PAM … CMYK", https://ghostscript.readthedocs.io/en/latest/Devices.html)
 * and the highest per-pixel C+M+Y+K is read. Text and art anti-aliasing
 * is off (-dTextAlphaBits=1 / -dGraphicsAlphaBits=1, the defaults, stated)
 * so edge pixels are never blends. Rendering a DeviceCMYK file to a CMYK
 * device through the same default_cmyk.icc (the same PDFX_ICC_DIR) is an
 * identity: on the 10.00.0 probe page the raster's maximum (294.9 %)
 * equalled the sum of the file's own `k` values (0.722+0.675+0.671+0.882).
 * The raster is a sample at PDFX_INK_DPI: a picture is read one device
 * pixel per sample, so a lone extreme pixel between samples can be
 * missed — the figure is "measured at N dpi", never "certified".
 */
export async function measureTac(
  config: Config,
  pdfPath: string,
  workDir: string,
): Promise<ToolOutcome<TacMeasurement>> {
  const dir = path.join(workDir, 'ink');
  await mkdir(dir, { recursive: true });
  const dpi = config.pdfxInkDpi;
  const run = await runCommand(
    config.gsBin!,
    [
      '-dSAFER',
      ...pdfxIccDirArgs(config),
      '-dBATCH',
      '-dNOPAUSE',
      '-dQUIET',
      '-sDEVICE=pamcmyk32',
      `-r${dpi}`,
      '-dTextAlphaBits=1',
      '-dGraphicsAlphaBits=1',
      `-sOutputFile=${path.join(dir, 'p%05d.pam')}`,
      pdfPath,
    ],
    config.pdfxTimeoutMs,
  );
  try {
    if (run.timedOut) return { ok: false, error: `the ink measurement did not finish within ${config.pdfxTimeoutMs} ms and was stopped` };
    if (run.spawnError || run.code !== 0) {
      return { ok: false, error: `Ghostscript could not render the file to measure its ink (exit ${run.code ?? 'none'}).${stderrTail(run.stderr)}` };
    }
    const files = (await readdir(dir)).filter((f) => /^p\d{5}\.pam$/.test(f)).sort();
    if (!files.length) return { ok: false, error: 'Ghostscript rendered no pages, so no ink was measured' };
    const perPagePct: number[] = [];
    for (const f of files) {
      const img = parsePam(await readFile(path.join(dir, f)));
      const tac = img ? tacFromPam(img) : null;
      if (tac === null) return { ok: false, error: `page raster ${f} is not an 8-bit CMYK PAM, so no ink was measured` };
      perPagePct.push(tac);
      await rm(path.join(dir, f), { force: true });
    }
    return { ok: true, value: { maxTacPct: Math.max(...perPagePct), perPagePct, dpi } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
