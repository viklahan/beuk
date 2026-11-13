import { createHash } from 'node:crypto';
import type { WorkerOptions } from 'node:worker_threads';
import {
  type ClosureSource, STUDIO_WORKER_ENV_KEYS, extractStudioSource, reachableFrom, runStudioWorker, siblingWorkerUrl, studioWorkerOptions,
} from '../studio/closure.js';
import type { WorkerJob } from './worker.js';

export { type ClosureSource } from '../studio/closure.js';

/* BEUK:insights-server — Beuk's own writing analytics (cast, cadence,
   crutch words, dialogue share, readability, echoes, word frequency,
   section rhythm, sentence-length variety), computed on the server by the
   studio's OWN insComputeFor, lifted out of client/index.html and run in a
   fenced node:vm worker — the same mechanism as the EPUB build. One
   source: no studio function is copied into src/. The MCP returns this
   canonical data, never a guess.

   insComputeFor(sections, lang) is pure data (no DOM, no fetch): it calls
   only the text-measuring helpers. The reachable set is computed at load
   (reachableFrom) rather than hand-listed, since this is a read-only,
   secondary surface; a studio rename that drops a dependency fails loudly
   at load with the missing name. */

export const INSIGHTS_ROOTS: readonly string[] = ['insComputeFor'];
/** Supplied by the sandbox / not lifted. insComputeFor takes its sections
 *  and lang as arguments, so it reaches no `state`; the stop is defensive. */
export const INSIGHTS_SUPPLIED: readonly string[] = ['state'];

export function reachableDeclarations(studioHtml: string, roots: readonly string[] = INSIGHTS_ROOTS, stop: readonly string[] = INSIGHTS_SUPPLIED): string[] {
  return reachableFrom(studioHtml, roots, stop);
}

export function extractInsightsSource(studioHtml: string, names: readonly string[] = reachableDeclarations(studioHtml)): ClosureSource {
  // compute(sections, lang) runs the studio's own insComputeFor; setUiLang
  // keeps the UI-language global coherent for any helper that reads it.
  const api = '\n;globalThis.__beukInsights = { compute: insComputeFor, setUiLang: (l) => { try { uiLangState = (UI_STRINGS && UI_STRINGS[l]) ? l : "en"; } catch (e) {} } };\n';
  return extractStudioSource(studioHtml, names, { listRef: 'src/book/insights/closure.ts reachableDeclarations', api, stringTables: true });
}

export type InsightsOptions = { lang: string; timeoutMs?: number; heapMb?: number };
export type InsightsSandbox = {
  source: ClosureSource;
  /** insComputeFor(sections, lang): Beuk's own InsightsData for this book. */
  compute(sections: unknown[], opts: InsightsOptions): Promise<{ data: unknown }>;
};

export class InsightsBuildError extends Error {
  constructor(message: string, readonly reason: 'timeout' | 'memory' | 'failed') {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Heap cap of one insights worker, MB. Insights output is small; the cap
 *  guards a pathological book, like the EPUB worker's. */
export const DEFAULT_INSIGHTS_WORKER_HEAP_MB = 512;
export const INSIGHTS_WORKER_ENV_KEYS: readonly string[] = STUDIO_WORKER_ENV_KEYS;

export function workerOptions(job: WorkerJob, heapMb: number): WorkerOptions {
  return studioWorkerOptions(job, heapMb);
}

function runWorker(job: WorkerJob, timeoutMs: number, heapMb: number): Promise<unknown> {
  return runStudioWorker(siblingWorkerUrl(import.meta.url), job, {
    timeoutMs, heapMb, noun: 'insights', error: (message, reason) => new InsightsBuildError(message, reason),
  });
}

const cache = new Map<string, InsightsSandbox>();

/** The studio's insights code, lifted from `studioHtml` once (cached by
 *  the file's sha256) and run per book in a fresh worker and vm context. */
export function loadInsightsClosure(studioHtml: string, clientDir: string): InsightsSandbox {
  const key = createHash('sha256').update(studioHtml).update('\0' + clientDir).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const source = extractInsightsSource(studioHtml);
  const sb: InsightsSandbox = {
    source,
    compute: (sections, opts) =>
      runWorker(
        { mode: 'insights', code: source.code, clientDir, sectionsJson: JSON.stringify(sections), lang: opts.lang },
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        opts.heapMb ?? DEFAULT_INSIGHTS_WORKER_HEAP_MB,
      ) as Promise<{ data: unknown }>,
  };
  cache.set(key, sb);
  return sb;
}
