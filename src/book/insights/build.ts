import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clientDir } from '../../warmth/pages.js';
import { InsightsBuildError, loadInsightsClosure, type InsightsSandbox } from './closure.js';

/* BEUK:insights-server — the studio's insights code, lifted from
   client/index.html once and cached (closure.ts), run per book in a fenced
   worker. Insights read only section TEXT, so unlike the EPUB build there
   is no picture hydration: the stored doc's sections are passed as-is. */

let studio: { html: string; dir: string } | null = null;

export function studioInsights(dir: string = clientDir()): InsightsSandbox {
  if (!studio || studio.dir !== dir) {
    if (!existsSync(path.join(dir, 'index.html'))) {
      throw new InsightsBuildError(
        'the studio file client/index.html is missing on this server, so insights cannot be computed',
        'failed',
      );
    }
    studio = { html: readFileSync(path.join(dir, 'index.html'), 'utf8'), dir };
  }
  return loadInsightsClosure(studio.html, dir);
}

/** Compute Beuk's own InsightsData for a stored doc. The doc's own
 *  sections and language go in; the canonical analytics come out. */
export async function computeBookInsights(doc: unknown, opts?: { timeoutMs?: number; heapMb?: number }): Promise<unknown> {
  const d = doc as { sections?: unknown[]; meta?: { language?: unknown } } | null;
  const sections = Array.isArray(d?.sections) ? d!.sections : [];
  const lang = typeof d?.meta?.language === 'string' ? d!.meta!.language! : 'en';
  const { data } = await studioInsights().compute(sections, { lang, ...opts });
  return data;
}

export { InsightsBuildError };
