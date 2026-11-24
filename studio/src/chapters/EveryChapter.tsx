import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { observeSections } from '@book/editor/index.js';
import { closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { settleActiveEditor } from '../editor/active';
import { useLocale } from '../i18n/LocaleProvider';
import { sectionKey } from '../pictures/pictures';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useDismissToasts, useToast } from '../shell/Toasts';
import { applyToEvery, countWords, ctxOf, planFor, ROWS, undoEvery, type Applied, type RowId, type RowPlan, type Said } from './everych';

/* "Use on every chapter…" (2026-11-24): the button at the end of a chapter's settings (after the art rows,
   src/editor/EditorMeta.tsx) and its dialog. What is copied, to which chapters, and how it is undone is
   ./everych.ts; this file is only what the writer sees:

   - the dialog lists the rows offered for this chapter (ROWS), each a checkbox, none ticked when it opens. Under each:
     this chapter's value in words and the exact number of other chapters that would change, read from the book as it
     stands (and read again if the book changes while the dialog is open). Both are the checkbox's accessible
     description;
   - the dialog is the confirmation: it says the changed chapters lose the setting they have, and what brings it back
     (the Undo in the message that follows; the History snapshot taken first). Nothing else is promised;
   - "Use on every chapter" is disabled until a row is ticked. Cancel, Escape and a click outside change nothing. Focus
     goes back to the button that opened the dialog (the dialog stack's own rule);
   - afterwards a message says what changed, with exact counts, and carries Undo for as long as 1.0's own Undo
     messages stay (CHOP_TOAST_MS). A whole other book arriving takes that message down;
   - if the write fails (History could not be packed), the message says so with the error: nothing was changed. */

const TAG = 'everych';
const SEP = ' · ';
/** The use whose Undo message may still be up (one at a time: a second use replaces the first's message). */
let pending: Applied | null = null;

export function EveryChapter({ ydoc, section }: { ydoc: Y.Doc; section: Y.Map<unknown> }) {
  const { t } = useLocale();
  const toast = useToast();
  const dismiss = useDismissToasts();
  const [c, setC] = useState<Closure | null>(closureIfLoaded());
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<readonly RowId[]>([]);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!c) void loadClosure().then(setC);
  }, [c]);
  // an Undo message belongs to the book it was made on: another book arriving takes it down
  useEffect(() => {
    if (pending && pending.ydoc !== ydoc) {
      dismiss(TAG);
      pending = null;
    }
  }, [ydoc, dismiss]);
  // the counts are the book's as it stands: any section's own keys, or the library, changing redraws them
  useEffect(() => {
    if (!open) return;
    const on = () => bump((n) => n + 1);
    const meta = ydoc.getMap<unknown>('meta');
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has('images')) on();
    };
    meta.observe(onMeta);
    const off = observeSections(ydoc, on);
    return () => {
      meta.unobserve(onMeta);
      off();
    };
  }, [open, ydoc]);

  if (!c) return null; // as the art rows above it: they wait for 1.0's own code too
  const id = sectionKey(section, 'id');
  const sourceId = typeof id === 'string' ? id : '';
  const show = (on: boolean) => {
    setPicked([]);
    setOpen(on);
  };
  const say = (parts: Said[]): string => parts.map((p) => ('key' in p ? t(p.key) : p.text)).join(SEP);

  const failed = (e: unknown) => toast(t('everych.failed', { error: e instanceof Error && e.message ? e.message : String(e) }), 'TriangleAlert');
  const undo = (rec: Applied) => {
    let r: ReturnType<typeof undoEvery>;
    try {
      r = undoEvery(c, rec);
    } catch (e) {
      failed(e); // nothing was put back (everych.ts writes History first); the snapshot is still in History
      return;
    }
    if (pending === rec) pending = null;
    if (!r) return;
    if (r.left === 0) toast(t('chop.undone'), 'Undo2');
    else toast(t('everych.undonePart', { n: r.left, snap: t('history.auto.chapterop') }), 'History');
  };
  const apply = () => {
    settleActiveEditor(); // the open chapter's pending normalisation first, so the snapshot's text is settled
    let rec: Applied | null;
    try {
      rec = applyToEvery(c, ydoc, sourceId, ticked);
    } catch (e) {
      show(false);
      failed(e);
      return;
    }
    show(false);
    if (!rec) return;
    if (!rec.changes.length) {
      toast(t('everych.nothing'), 'Info');
      return;
    }
    const list = ROWS.filter((r) => (rec.counts[r.id] ?? 0) > 0).map((r) => t('everych.doneItem', { setting: t(r.label), n: rec.counts[r.id] }));
    dismiss(TAG);
    pending = rec;
    toast(t('everych.done', { list: list.join(SEP) }), 'ListChecks', { label: t('chop.undo'), ms: c.api.CHOP_TOAST_MS, onClick: () => undo(rec), tag: TAG });
  };

  const plan = open ? planFor(ydoc, sourceId, ctxOf(c, ydoc)) : null;
  const offered = plan ? plan.rows.map((r) => r.id) : [];
  const ticked = picked.filter((x) => offered.includes(x));
  const rowOf = (rowId: RowId) => ROWS.find((r) => r.id === rowId)!;
  const countLine = (r: RowPlan): string => {
    const { key, ...numbers } = countWords(rowOf(r.id), r);
    return t(key, numbers);
  };

  return (
    <>
      <div className="everych-open">
        <button className="tb-btn" id="btnEveryChapter" type="button" aria-haspopup="dialog" onClick={() => show(true)}>
          <Icon name="ListChecks" />
          {t('everych.open')}
        </button>
      </div>
      <Dialog open={open} onClose={() => show(false)} id="modalEveryChapter" z={70} labelledBy="everyChH" describedBy="everyChScope" modalStyle={{ maxWidth: 560 }}>
        <h2>
          <Icon name="ListChecks" />
          <span id="everyChH">{t('everych.title')}</span>
        </h2>
        <p className="m-sub" id="everyChScope">
          {t('everych.scope')}
        </p>
        {plan && plan.others > 0 ? (
          <ul className="everych-rows" role="group" aria-label={t('everych.pick')}>
            {plan.rows.map((r) => (
              <li className="everych-row" key={r.id} data-row={r.id} data-changes={r.changes} data-reach={r.reach}>
                <input
                  type="checkbox"
                  id={'everyCh-' + r.id}
                  aria-describedby={'everyChD-' + r.id}
                  checked={ticked.includes(r.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...ticked, r.id] : ticked.filter((x) => x !== r.id))}
                />
                <div className="everych-txt">
                  <label htmlFor={'everyCh-' + r.id}>{t(rowOf(r.id).label)}</label>
                  <div className="everych-desc" id={'everyChD-' + r.id}>
                    <span className="everych-here">{t('everych.here', { value: say(r.said) })}</span>
                    <span className="everych-count">{countLine(r)}</span>
                    {r.note ? <span className="everych-pair">{t(r.note.key, { n: r.note.n })}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="everych-alone" role="status">
            {t('everych.alone')}
          </p>
        )}
        <p className="everych-warn" id="everyChReplace">
          {t('everych.replace')} {t('everych.back', { snap: t('history.auto.chapterop') })}
        </p>
        <div className="modal-actions">
          <button className="tb-btn" id="btnEveryChCancel" type="button" onClick={() => show(false)}>
            {t('set.cancel')}
          </button>
          <button className="tb-btn primary" id="btnEveryChApply" type="button" disabled={ticked.length === 0} onClick={apply}>
            {t('everych.apply')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
