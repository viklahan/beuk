import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { BLOB_ORIGIN } from '@book/editor/index.js';
import { useBook } from '../book/BookProvider';
import { useStats } from '../book/stats';
import { loadClosure, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { sampleLoaded } from '../sample/sample';
import { useToast } from '../shell/Toasts';
import { tourInit, tourOnLangChange, type TourHost as Host } from './tour';

/* Mounts 1.0's quick tour (tour.ts) once this device's book is known — 1.0
   runs tourInit after localInit has restored the book — and gives it what
   only 2.0 knows: the empty desk, the writer's own edits, the sample, and
   the last step's three ways in.

   The writer's own edits (1.0's local.realEdits): a local Y transaction
   that changed the book. A book arriving (IndexedDB, another tab, a new
   generation) is never local. The first one also sets 1.0's "beuk.desk"
   flag, which 1.0 writes at its first save after a real edit (localSaveNow):
   the tour's decision reads it, in both studios. */

export const TOUR_DESK_FLAG = '1';

export function TourHost({ onWrite }: { onWrite: () => void }) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const stats = useStats();
  const toast = useToast();
  const [c, setC] = useState<Closure | null>(null);
  const edits = useRef(0);
  const live = useRef({ bk, stats, t, toast, onWrite });
  live.current = { bk, stats, t, toast, onWrite };
  const ydoc = bk.book?.ydoc ?? null;

  useEffect(() => {
    let alive = true;
    void loadClosure().then((cl) => alive && setC(cl)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // the writer's own edits, on whichever book is open
  useEffect(() => {
    if (!ydoc) return;
    const on = (tr: Y.Transaction) => {
      // 2.0's own storage housekeeping (packing pictures, letting one go) is not a writer's edit
      if (!tr.local || tr.changed.size === 0 || tr.origin instanceof IndexeddbPersistence || tr.origin === BLOB_ORIGIN) return;
      edits.current += 1;
      if (edits.current === 1) {
        try {
          localStorage.setItem('beuk.desk', TOUR_DESK_FLAG);
        } catch {
          /* no storage */
        }
      }
    };
    ydoc.on('afterTransaction', on);
    return () => ydoc.off('afterTransaction', on);
  }, [ydoc]);

  // the device's book is known once start-up is done (and an open book has its first count)
  const known = bk.phase === 'empty' || (bk.phase === 'open' && stats !== null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!c || started || !known) return;
    setStarted(true);
  }, [c, started, known]);

  useEffect(() => {
    if (!c || !started) return;
    const a = c.api;
    const host: Host = {
      steps: a.TOUR_STEPS,
      decide: a.tourDecide,
      key: a.TOUR_KEY,
      deskKey: a.TOUR_DESK_KEY,
      t: (k, p) => live.current.t(k as never, p as never),
      emptyDesk: () => {
        const { bk: b, stats: s } = live.current;
        return b.phase !== 'open' || (s ? s.emptyDesk : false);
      },
      edits: () => edits.current,
      restoring: () => live.current.bk.phase === 'starting',
      sampleLoaded: () => sampleLoaded(live.current.bk.book?.ydoc ?? null),
      importReady: () => {
        const b = document.getElementById('btnImport');
        return !!b && b.getAttribute('aria-disabled') !== 'true';
      },
      canWrite: () => !!document.querySelector('#manuscript.ms-editing'),
      loadSample: () => {
        // 1.0's loadSampleStory: the sample bar's own Load (its confirm, snapshot and replace)
        if (!sampleLoaded(live.current.bk.book?.ydoc ?? null)) document.getElementById('btnSampleStory')?.click();
      },
      write: () => live.current.onWrite(),
      toast: (msg) => live.current.toast(msg, 'Map'),
    };
    return tourInit(host);
  }, [c, started]);

  // 1.0's tourOnLangChange
  useEffect(() => {
    tourOnLangChange();
  }, [lang]);

  return null;
}
