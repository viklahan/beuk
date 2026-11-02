import { cloudFacts, covEnv, type Closure } from '../closure/index';
import { covRun, covSettle, resumeOn } from './covenant';

/* 1.0's apiFetch / apiFetchReal (client/index.html "transport"), for the series Covenant: the guards run first and
   synchronously (no shelf: null; signed out: null unless opts.auth === false), then the same request (same-origin
   credentials, JSON content type for a string body) and the same answer shapes: {} for 204, the JSON body, or
   { __error, __status, __body } for an error status; null when the network failed. 2.0 has no billing notice and no
   shelf-unreachable banner yet (wave 7): those two side effects of 1.0's transport are not made. */

type Fetcher = typeof fetch;
let fetcher: Fetcher | null = null;
/** Tests: the fetch the Covenant's shelf calls use (null: the page's own). */
export function setCovenantFetch(f: Fetcher | null): void {
  fetcher = f;
}

export function apiFetch(path: string, opts: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> | null {
  if (!cloudFacts.available) return null;
  if (opts.auth !== false && !cloudFacts.user) return null;
  return (async () => {
    try {
      const headers: Record<string, string> = Object.assign({}, (opts.headers as Record<string, string>) || {});
      if (typeof opts.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      const f = fetcher ?? globalThis.fetch.bind(globalThis);
      const res = await f(path, { method: (opts.method as string) || 'GET', credentials: 'same-origin', headers, body: opts.body === undefined ? undefined : (opts.body as string) });
      if (res.status === 204) return {};
      // wave 4c: 1.0's BEUK:epub-server line — a file, not JSON (the wrap download, POST /api/wrap)
      if (opts.blob && res.ok) return { __blob: await res.blob(), __headers: res.headers };
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) return { __error: (data && data.error) || 'HTTP ' + res.status, __status: res.status, __body: data };
      return data || {};
    } catch {
      return null;
    }
  })();
}
covEnv.apiFetch = apiFetch;

/** 1.0's bibleSeriesNet, as 2.0 runs it: the shelf through apiFetch, and no device copy. 1.0 keeps a series copy
 *  beside the book in its IndexedDB store ("beuk-local"), which 2.0 never opens (local.db is absent, so 1.0's own
 *  store and load answer null); its small per-account record (beuk.bible.series.<user>) is 1.0's own localStorage
 *  code, unchanged. Each answer the code waits on resumes the book's state first (covenant.ts resumeOn). */
export function installSeriesNet(c: Closure): void {
  const net = c.api.bibleSeriesNet;
  const fetch0 = net.fetch;
  const ask0 = net.ask;
  if ((net as { __beuk?: boolean }).__beuk) return;
  (net as { __beuk?: boolean }).__beuk = true;
  net.fetch = (path, opts) => resumeOn(fetch0(path, opts));
  net.ask = (spec) => resumeOn(ask0(spec));
}

/* A series save that failed while the shelf was reachable (a network blip mid-PUT) is counted waiting
   (bibleSeriesSync.pending) and, in 1.0, written to the device and sent again when 1.0's transport sees the shelf come
   back (cloudNoteUnreachable → … → bibleSeriesFlush). 2.0 has neither the device copy nor that banner yet (wave 7), so
   it sends the waiting save itself: when the browser comes back online, and every 30 s while one waits. A conflict
   waiting on the writer, a refused series and a save in flight are left to 1.0's own code. When the page hides, 1.0's
   bibleSeriesFlushOnHide takes an edit still in its 300 ms pause, and the save goes then (1.0 keeps it on the device
   instead; a hidden tab still finishes its request). Review of wave 3b, should-fix 1. */
const RETRY_MS = 30_000;
type SyncState = { pending: number; dirty: boolean; conflict: unknown; refused: number; running: boolean };
const canSend = (sy: SyncState) => !sy.conflict && !sy.refused && !sy.running;

/** One retry: the series save waiting after a failure goes now (nothing when nothing waits). */
export function seriesRetryTick(): void {
  covRun((c) => {
    const sy = c.api.bibleSeriesSync as unknown as SyncState;
    if (c.vars.bibleSeries && sy.pending > 0 && canSend(sy)) c.api.bibleSeriesFlush();
  });
}
/** The page hides: an edit still in its pause is taken, and the series save goes. */
export function seriesOnHide(): void {
  covSettle(); // the room's last typing reaches the book too (store.ts persists it)
  covRun((c) => {
    c.api.bibleSeriesFlushOnHide();
    const sy = c.api.bibleSeriesSync as unknown as SyncState;
    if (c.vars.bibleSeries && cloudFacts.user && (sy.pending > 0 || sy.dirty) && canSend(sy)) void c.api.bibleSeriesSaveNow();
  });
}
/** While a book is open: the retries and the save on hide. Returns the cleanup. */
export function installSeriesRetry(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onVis = () => {
    if (document.visibilityState === 'hidden') seriesOnHide();
  };
  window.addEventListener('online', seriesRetryTick);
  window.addEventListener('pagehide', seriesOnHide);
  document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(seriesRetryTick, RETRY_MS);
  return () => {
    window.removeEventListener('online', seriesRetryTick);
    window.removeEventListener('pagehide', seriesOnHide);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(timer);
  };
}
