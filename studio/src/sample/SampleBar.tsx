import { useEffect, useRef, useState } from 'react';
import { useBook } from '../book/BookProvider';
import { forgetBook } from '../book/store';
import { useStats } from '../book/stats';
import { bookState, closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { fmtNum } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { useConfirm } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import {
  deskEmpty, deskIsUntouchedSample, emptyAfterSample, ensureSamplePictures, fillSamplePictures, newBookArrival,
  sampleArrival, sampleLoaded, samplePicsMissing, sampleShippedWords, sampleSigOf, setSampleRecord,
} from './sample';

/* 1.0's sample bar in the sidebar (client/index.html .sample-bar:
   #btnSampleStory, #sampleNote, #btnNewBook; renderSampleButton,
   renderSampleNoteLive, renderNewBookButton, loadSampleStory,
   removeSampleStory, startNewBook).

   Every one of the three is a whole-book replace, and goes the way
   opening a backup goes (wave 1a): 1.0's confirm when 1.0 asks
   (sample.confirmLoad* over the writer's own book; sample.confirmRemove*
   over an edited sample; newbook.confirm* always), then the snapshot
   1.0 takes, then the new book opened as a new generation — refused,
   nothing written, if another tab replaced the book while the confirm
   waited (the live check).

   Wave 1c: the quick tour link (#btnTourAgain) under the three. Left out,
   each with its wave: newbook.confirmBodyShelf and unlinking from the shelf
   (wave 7); the writing log's per-book figures (wave 3). */

export function SampleBar() {
  const { t, lang } = useLocale();
  const bk = useBook();
  const stats = useStats();
  const toast = useToast();
  const confirm = useConfirm();
  const [c, setC] = useState<Closure | null>(() => closureIfLoaded());
  const [busy, setBusy] = useState(false);
  const warned = useRef(false);
  const ydoc = bk.book?.ydoc ?? null;

  useEffect(() => {
    if (!c) void loadClosure().then(setC).catch(() => undefined);
  }, [c]);

  // the sample's pictures, on any book that waits for them: fetched from /assets/sample/, filled in place (1.0's
  // samplePicsWarm / samplePicsArrived); told once when they cannot be fetched
  useEffect(() => {
    if (!c || !ydoc) return;
    let alive = true;
    const book = bk.book!;
    const waiting = () => samplePicsMissing(c, book.export()) > 0;
    if (!waiting()) return;
    void ensureSamplePictures(c).then(() => {
      if (!alive || !bk.isLive(ydoc)) return;
      const r = fillSamplePictures(c, ydoc);
      if (r.missing && !warned.current) {
        warned.current = true;
        toast(t('sample.picsOffline'), 'ImageOff');
      }
      if (!r.missing) warned.current = false;
    });
    return () => {
      alive = false;
    };
    // the open book (a new generation is a new Y.Doc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, ydoc]);

  if (!c) return null;
  const loaded = sampleLoaded(ydoc);
  // the button follows the counts (1.0's renderNewBookButton runs from updateStats); with no book open the desk is empty
  const empty = !ydoc || (stats ? stats.emptyDesk : true);
  const live = stats?.words ?? 0;
  const shipped = shippedOnce(c);

  /** 1.0's loadSampleStory → applySampleBookSync. */
  const load = async () => {
    const from = ydoc;
    if (from && sampleLoaded(from)) return;
    const untouched = deskIsUntouchedSample(c, from);
    if (from && !deskEmpty(c, from) && !untouched) {
      const title = String(bk.book!.export().meta && (bk.book!.export().meta as { title?: unknown }).title || '') || t('misc.untitledBook');
      const ok = await confirm({ title: t('sample.confirmLoadTitle'), body: t('sample.confirmLoadBody', { title }), yes: t('sample.confirmLoadYes'), no: t('confirm.keep') });
      if (ok !== true) return;
    }
    if (from ? !bk.isLive(from) : bk.book !== null) return toast(t('next.bookReplaced'), 'Info');
    const doc = sampleArrival(c, from, untouched);
    const b = await bk.replaceWith(doc, from);
    if (!b) {
      if (from && !bk.isLive(from)) toast(t('next.bookReplaced'), 'Info');
      return;
    }
    let sig: string | null = null;
    try {
      sig = sampleSigOf(c, b.ydoc);
    } catch {
      sig = null; // unknown: the sample reads as edited, Remove asks first
    }
    setSampleRecord(b.ydoc, sig);
    const { state } = bookState(c, b.ydoc);
    c.setState(state);
    toast(t('toast.sampleLoaded', { words: fmtNum(c.api.bookWordTotal(), lang), chapters: state.sections.filter((x) => x.type === 'chapter').length }), 'BookOpen');
  };

  /** 1.0's removeSampleStory → clearDeskToEmpty. */
  const remove = async () => {
    const from = ydoc;
    if (!from || !sampleLoaded(from)) return;
    if (!deskIsUntouchedSample(c, from)) {
      const ok = await confirm({ title: t('sample.confirmRemoveTitle'), body: t('sample.confirmRemoveBody'), yes: t('sample.confirmRemoveYes'), no: t('sample.keepReading') });
      if (ok !== true) return;
    }
    if (!bk.isLive(from)) return toast(t('next.bookReplaced'), 'Info');
    const sampleId = bk.book!.id;
    const doc = emptyAfterSample(c, from);
    const b = await bk.replaceWith(doc, from);
    if (!b) return;
    void forgetBook(sampleId); // nothing of the sample stays behind on this device (BEUK:remnants)
    toast(t('toast.sampleRemoved'), 'BookX');
  };

  /** 1.0's startNewBook → startNewBookNow. */
  const startNew = async () => {
    const from = ydoc;
    if (!from) return;
    if (sampleLoaded(from)) return remove();
    if (deskEmpty(c, from)) return toast(t('newbook.already'), 'File');
    const ok = await confirm({ title: t('newbook.confirmTitle'), body: t('newbook.confirmBody'), yes: t('newbook.yes'), no: t('newbook.no') });
    if (ok !== true) return;
    if (!bk.isLive(from)) return toast(t('next.bookReplaced'), 'Info');
    const { doc } = newBookArrival(c, from, t('newbook.snap'));
    const b = await bk.replaceWith(doc, from);
    if (!b) return;
    toast(t('newbook.done'), 'FilePlus');
  };

  const run = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sample-bar">
      <button type="button" className="side-btn sample-btn" id="btnSampleStory" aria-busy={busy || undefined} onClick={run(loaded ? remove : load)}>
        <Icon name={loaded ? 'BookX' : 'BookOpen'} />
        {loaded ? t('side.sampleRemove') : t('side.sampleLoad', { n: fmtNum(shipped, lang), count: shipped })}
      </button>
      <p className="sample-note" id="sampleNote">
        {loaded ? t('side.sampleNoteLoaded', { n: fmtNum(live, lang), count: live }) : t('side.sampleNoteLoad')}
      </p>
      {/* BEUK:newbook — only when there is a book of one's own to clear: the sample keeps its own Remove */}
      {!loaded && !empty && (
        <button type="button" className="tour-again" id="btnNewBook" title={t('newbook.title')} onClick={run(startNew)}>
          {t('newbook.btn')}
        </button>
      )}
      {/* BEUK:tour — the replay link; tour/tour.ts starts it (1.0's tourInit listens on #btnTourAgain) */}
      <button type="button" className="tour-again" id="btnTourAgain">
        {t('tour.show')}
      </button>
    </div>
  );
}

let shipped: { c: Closure; n: number } | null = null;
/** 1.0's sampleShippedWords, counted once (1.0's sampleShippedWordsCache). */
function shippedOnce(c: Closure): number {
  if (!shipped || shipped.c !== c) shipped = { c, n: sampleShippedWords(c) };
  return shipped.n;
}
