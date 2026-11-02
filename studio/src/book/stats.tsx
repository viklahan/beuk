import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { bookState, loadClosure, type Closure, type State } from '../closure/index';
import { useBook } from './BookProvider';
import { startDeskClock } from '../goals/goals';

/* The book's counts (inventory C1: 1.0's statsCells, renderSideStatusSummary,
   renderProgress and the outline's per-row count, client/index.html
   BEUK:sidebar / BEUK:remnants), computed by 1.0's OWN functions through the
   browser closure — sectionWords, sectionChars, emptyOut, inBook,
   sectionComplete, isEmptyDesk, READ_WPM — against 1.0's state built from
   the open book (bookState: exportBook → epubState → ARRIVE). Nothing is
   re-implemented here except the page estimate's desk-less branch:

   - statsPages: 1.0 uses the reading desk's own measured page count once
     the desk has measured the book (deskState); 2.0 has no reading desk
     until wave 4 (E1), so it always takes 1.0's fallback, ceil(words/250),
     and the note says so with 1.0's stats.pagesNote.

   The counts are recomputed after the book changes, debounced (a whole-book
   export and ARRIVE per keystroke would cost a big book its typing speed);
   1.0 recounts at once with a per-section memo. The numbers are the same
   once settled. */

export const STATS_DEBOUNCE_MS = 400;
export const PAGE_WORDS = 250; // 1.0's statsPages fallback (no reading desk measured)

export type SectionCount = { words: number; emptyOut: boolean; inBook: boolean };
export type BookStats = {
  /** Words of the included sections (1.0's statsCells total / bookWordTotal). */
  words: number;
  chars: number;
  pages: number;
  /** Reading minutes, Math.round(words / READ_WPM). */
  minutes: number;
  readWpm: number;
  /** Per section id (or the section's index when it has no id), as the outline rows show them. */
  sections: Map<string, SectionCount>;
  /** renderProgress: per kind, the rounded percentage of complete sections (null when the kind has none). */
  progress: { front: number | null; body: number | null; back: number | null };
  emptyDesk: boolean;
};

/** 1.0's statsPages without a reading desk. */
export const statsPages = (total: number): number => (total > 0 ? Math.ceil(total / PAGE_WORDS) : 0);

/** The counts for 1.0's state, through 1.0's functions (the closure's state is set to `state` first). */
export function computeStats(c: Closure, state: State): BookStats {
  c.setState(state);
  const a = c.api;
  const secs = state.sections;
  const included = secs.filter((s) => s.included);
  const words = included.reduce((n, s) => n + a.sectionWords(s), 0);
  const chars = included.reduce((n, s) => n + a.sectionChars(s), 0);
  const sections = new Map<string, SectionCount>();
  secs.forEach((s, i) => {
    const key = typeof s.id === 'string' && s.id ? s.id : String(i);
    sections.set(key, { words: a.sectionWords(s), emptyOut: !!s.included && a.emptyOut(s), inBook: a.inBook(s) });
  });
  const empty = a.isEmptyDesk();
  const progress = { front: null, body: null, back: null } as BookStats['progress'];
  for (const kind of ['front', 'body', 'back'] as const) {
    const ks = secs.filter((s) => s.kind === kind && s.type !== 'cover');
    if (!ks.length) continue;
    const done = empty ? 0 : ks.filter((s) => a.sectionComplete(s)).length;
    progress[kind] = Math.round((done / ks.length) * 100);
  }
  return { words, chars, pages: statsPages(words), minutes: Math.round(words / a.READ_WPM), readWpm: a.READ_WPM, sections, progress, emptyDesk: empty };
}

/** The counts of a book's Y.Doc. */
export function statsOf(c: Closure, ydoc: Y.Doc): BookStats {
  return computeStats(c, bookState(c, ydoc).state);
}

const StatsContext = createContext<BookStats | null>(null);

/** Keeps the open book's counts, recomputed (debounced) whenever the Y.Doc changes. */
export function StatsProvider({ children }: { children: ReactNode }) {
  const { book } = useBook();
  const ydoc = book?.ydoc ?? null;
  const [stats, setStats] = useState<BookStats | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setStats(null);
    if (!ydoc) return;
    let alive = true;
    let c: Closure | null = null;
    const run = () => {
      timer.current = null;
      if (!alive || !c) return;
      try {
        const st = statsOf(c, ydoc);
        setStats(st);
        // wave 3a: 1.0's updateStats funnel — the habit log observes every settled count (its state is this book's now)
        c.api.wlogObserve(st.words);
      } catch {
        /* a book the closure cannot read yet: keep the last counts */
      }
    };
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(run, STATS_DEBOUNCE_MS);
    };
    void loadClosure().then((cl) => {
      c = cl;
      // a whole book arrived (open, replace, restore, the sample): 1.0's applyBookDoc rebases the habit log, so its
      // words are never credited to today; and 1.0's desk clock runs from the first book on
      cl.vars.wlogRebase = true;
      startDeskClock(cl);
      run(); // at once on open
    }).catch(() => undefined);
    ydoc.on('update', soon);
    return () => {
      alive = false;
      ydoc.off('update', soon);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [ydoc]);
  return <StatsContext.Provider value={stats}>{children}</StatsContext.Provider>;
}

/** The open book's counts (null until the first count, or with no book). */
export function useStats(): BookStats | null {
  return useContext(StatsContext);
}
