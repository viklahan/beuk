import type * as Y from 'yjs';
import { bookState, closureIfLoaded, cloudFacts, writeEnv, type Closure } from '../closure/index';
import { setMeta } from '../book/hooks';
import { placeKey } from '../notebook/notebook';

/* Step 5 wave 3a, task 1 (inventory C2): goals, the streak, the writing log, the Road so far and just-write.
   Everything is 1.0's own code (client/index.html "Daily writing streak", "Writing goals & the habit log",
   BEUK:goalspace, BEUK:goalshist), lifted into the browser closure WITH its per-device state: the writing log
   `wlog` (beuk.writelog.v1), `streakState` (beuk.streak.v1) and just-write (beuk.justwrite.v1) are read and written
   by 1.0's functions themselves, so 1.0 and 2.0 on one device share them in 1.0's shapes. 1.0's renderers write
   into the ids 2.0 draws (#streakText, #goalLines, the Goals room).

   What 2.0 supplies around it:
   - goalsRun: 1.0's goals functions run on 1.0's state of the open book (bookState). When 1.0 calls
     noteBookEdited (it saves the book), 1.0's state.goals goes into the Y meta map exactly as serializeBook writes
     it (`goals: Object.assign({}, state.goals)`). Nothing else is written; a call that does not edit writes nothing.
   - the shelf's streak (cloudHeartbeat, cloudLoadStreak): 1.0's calls, same paths, bodies and 10-minute throttle,
     only when a shelf answers and a writer is signed in (1.0's apiFetch gate).
   - the funnel (book/stats.tsx): 1.0's updateStats observes each settled count (wlogObserve); a whole book arriving
     (a new Y.Doc: open, replace, restore, sample) rebases the log first, as 1.0's applyBookDoc does.
   - writing activity (editor/ChapterEditor.tsx): every local edit of the page calls markWritingActivity, as 1.0's
     editor input handler does. */

/** 1.0's goals code on the open book: `fn` runs on 1.0's state of it; if 1.0 called noteBookEdited, state.goals is
 *  written to the book. A promise (Clear tracking data asks first) keeps the hook until it settles; 1.0's state is
 *  rebuilt from the book when the confirm answers, so the edit lands on the book as it is then. */
export function goalsRun<T>(c: Closure, ydoc: Y.Doc, fn: () => T): T {
  bookState(c, ydoc);
  let edited = false;
  const prevEdited = writeEnv.noteBookEdited;
  const prevConfirm = writeEnv.confirm;
  writeEnv.noteBookEdited = () => {
    edited = true;
  };
  const confirmOuter = prevConfirm;
  writeEnv.confirm = (o) =>
    Promise.resolve(confirmOuter(o)).then((r) => {
      bookState(c, ydoc);
      return r;
    });
  const done = () => {
    writeEnv.noteBookEdited = prevEdited;
    writeEnv.confirm = prevConfirm;
    if (edited) {
      // a book without a goals key (1.0 always writes one): it goes where serializeBook writes it
      ydoc.transact(() => {
        placeKey(ydoc, 'goals');
        setMeta(ydoc, 'goals', Object.assign({}, c.getState().goals) as never);
      });
    }
  };
  let out: T;
  try {
    out = fn();
  } catch (e) {
    done();
    throw e;
  }
  if (out && typeof (out as { then?: unknown }).then === 'function') {
    return (out as unknown as Promise<unknown>).finally(done) as unknown as T;
  }
  done();
  return out;
}

/* ---- the shelf's streak (1.0's cloudLoadStreak / cloudHeartbeat over apiFetch) ---- */

type Fetcher = typeof fetch;
let fetcher: Fetcher | null = null;
/** Tests: the fetch the streak calls use (null: the page's own). */
export function setStreakFetch(f: Fetcher | null): void {
  fetcher = f;
}
async function apiJson(path: string, opts: { method?: string; body?: string }): Promise<Record<string, unknown> | null> {
  // 1.0's apiFetch: nothing without a shelf, nothing signed out
  if (!cloudFacts.available || !cloudFacts.user) return null;
  const f = fetcher ?? globalThis.fetch.bind(globalThis);
  try {
    const headers: Record<string, string> = {};
    if (typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
    const res = await f(path, { method: opts.method || 'GET', credentials: 'same-origin', headers, body: opts.body });
    if (res.status === 204) return {};
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { __error: (data && data.error) || 'HTTP ' + res.status, __status: res.status };
    return data || {};
  } catch {
    return null;
  }
}
const takeStreak = (r: Record<string, unknown> | null) => {
  if (r && r.streak) {
    cloudFacts.serverStreak = r.streak;
    closureIfLoaded()?.api.renderStreak();
  }
};
/** 1.0's cloudHeartbeat: signed in, at most one POST /api/streak/heartbeat every ten minutes. */
export function cloudHeartbeat(): void {
  if (!cloudFacts.user || !cloudFacts.available) return;
  const now = Date.now();
  if (now - cloudFacts.lastHeartbeatAt < 10 * 60 * 1000) return;
  cloudFacts.lastHeartbeatAt = now;
  void apiJson('/api/streak/heartbeat', { method: 'POST', body: '{}' }).then(takeStreak);
}
/** 1.0's cloudLoadStreak (its cloudAfterSignIn): the server's streak, once a writer is known to be signed in. */
export function cloudLoadStreak(): Promise<void> | null {
  if (!cloudFacts.user || !cloudFacts.available) return null;
  return apiJson('/api/streak', {}).then(takeStreak);
}
writeEnv.heartbeat = cloudHeartbeat;

/* ---- the desk clock (1.0's initGoals tail): foreground minutes in ten-second steps ---- */
let clockOn = false;
/** Start 1.0's desk clock once per page: wlogTick every 10 s, paused while hidden, flushed on hide and unload. */
export function startDeskClock(c: Closure): void {
  if (clockOn) return;
  clockOn = true;
  c.vars.wlogLastTick = Date.now();
  setInterval(() => c.api.wlogTick(), 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      c.api.wlogTick();
      c.api.wlogFlush();
    } else c.vars.wlogLastTick = Date.now();
  });
  window.addEventListener('beforeunload', () => c.api.wlogFlush());
}

/** A local edit of the page: 1.0's markWritingActivity (the streak, and the shelf's heartbeat). */
export function noteWriting(): void {
  closureIfLoaded()?.api.markWritingActivity();
}
