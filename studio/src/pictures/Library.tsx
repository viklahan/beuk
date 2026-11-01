import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { loadClosure, type BookImage, type Closure } from '../closure/index';
import { useBook } from '../book/BookProvider';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { libraryView, removePictures, undoRemoval, watchEdits, type LibraryView, type Removal } from './imagelib';
import { pictureSrc } from './pictures';

/* BEUK:imagelib — the library grid both pickers show (1.0's renderImgLib /
   renderSceneLib cells, decorated by imglibDecorate), the cleanup row
   (imglibRenderTools), the "used in" confirm (#modalImgRemove) and the
   removal's Undo toast (imglibToast). The logic is imagelib.ts (1.0's own
   functions); this is 1.0's markup, keys and focus rules. */

/** The library as 1.0 shows it, re-read when the book changes (while the picker that shows it is open). */
export function useLibrary(ydoc: Y.Doc | null, open: boolean): { c: Closure | null; view: LibraryView | null; refresh: () => void } {
  const [c, setC] = useState<Closure | null>(null);
  const [view, setView] = useState<LibraryView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const read = useCallback(() => {
    if (!ydoc) return;
    void loadClosure().then((cl) => {
      setC(cl);
      setView(libraryView(cl, ydoc));
    });
  }, [ydoc]);
  useEffect(() => {
    if (!open || !ydoc) return;
    watchEdits(ydoc);
    read();
    const on = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(read, 120);
    };
    ydoc.on('update', on);
    return () => {
      ydoc.off('update', on);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [open, ydoc, read]);
  return { c, view: open ? view : null, refresh: read };
}

/** One library grid: 1.0's cells (`attr`: data-libimg or data-sceneimg), each in its .imglib-cell with the quiet delete
 *  control (none for a sample picture). */
export function LibraryGrid({ view, attr, selected, empty, onPick, onDelete }: {
  view: LibraryView;
  attr: 'data-libimg' | 'data-sceneimg';
  selected: string | null;
  empty: ReactNode;
  onPick: (id: string) => void;
  onDelete: (id: string, opener: HTMLElement) => void;
}) {
  const { t } = useLocale();
  if (!view.images.length) return <p className="img-empty">{empty}</p>;
  return (
    <>
      {view.images.map((im, i) => {
        const src = pictureSrc(im);
        const name = '⁨' + String(im.name || '') + '⁩'; // 1.0's imglibName
        const label = t('imglib.deleteAria', { name });
        return (
          <div className="imglib-cell" key={im.id + ':' + i}>
            <button type="button" className={'img-cell' + (im.id === selected ? ' active' : '')} {...{ [attr]: im.id }} onClick={() => onPick(im.id)}>
              {src ? <img src={src} alt="" /> : null}
              <span>{im.name}</span>
            </button>
            {!view.sample.has(im.id) && (
              <button
                type="button"
                className="imglib-del"
                data-imgdel={im.id}
                aria-label={label}
                title={label}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(im.id, e.currentTarget);
                }}
              >
                <Icon name="Trash2" />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/** 1.0's imglibSize: sizes isolated (U+2066 … U+2069) so a right-to-left sentence keeps "141.3 KB" whole. */
export const libSize = (c: Closure, n: number): string => c.api.imglibSize(n);

/** The removal actions with their confirm and toasts (1.0's imglibRequestDelete, imglibRemoveWithToast, imglibCleanup,
 *  imglibToast, imglibFocusLibrary, imglibCloseConfirm). `focusTo`: where focus lands after a removal (the library's
 *  first picture, else its Upload button), as 1.0's imglibFocusLibrary does for the Insert Image dialog. */
export function useLibraryActions(ydoc: Y.Doc | null, lib: { c: Closure | null; view: LibraryView | null; refresh: () => void }, focusTo?: () => HTMLElement | null) {
  const { t } = useLocale();
  const toast = useToast();
  const bk = useBook();
  const [pending, setPending] = useState<{ id: string; opener: HTMLElement | null } | null>(null);
  const live = useRef(bk.isLive);
  live.current = bk.isLive;

  const undoToast = useCallback((c: Closure, rec: Removal, msg: string) => {
    toast(msg, 'Trash2', {
      label: t('imglib.undo'),
      ms: c.api.IMGLIB_UNDO_MS,
      onClick: () => {
        if (undoRemoval(c, rec.ydoc, rec, (y) => live.current(y))) toast(t('imglib.undone'), 'RotateCcw');
        else if (!rec.undone) toast(t('imglib.undoGone'), 'History');
      },
    });
  }, [t, toast]);

  const removeWithToast = useCallback((ids: string[], cleanup: boolean): Removal | null => {
    const c = lib.c;
    if (!c || !ydoc || !live.current(ydoc)) return null;
    const rec = removePictures(c, ydoc, ids);
    if (!rec) return null;
    undoToast(c, rec, cleanup ? t('imglib.cleanupToast', { n: rec.ids.length, size: c.api.imglibSize(rec.bytes) }) : t(rec.used ? 'imglib.removedEverywhere' : 'imglib.removed'));
    lib.refresh();
    // the control that started it is gone with its cell (after React draws the library again)
    requestAnimationFrame(() => {
      const el = focusTo?.();
      try {
        el?.focus({ preventScroll: true });
      } catch {
        /* gone */
      }
    });
    return rec;
  }, [lib, ydoc, t, undoToast, focusTo]);

  const requestDelete = useCallback((id: string, opener: HTMLElement | null) => {
    const v = lib.view;
    const im = v?.images.find((x) => x.id === id);
    if (!v || !im || v.sample.has(id)) return;
    const uses = v.usage[id] ?? [];
    if (!uses.length) {
      removeWithToast([id], false);
      return;
    }
    setPending({ id, opener });
  }, [lib.view, removeWithToast]);

  const cleanup = useCallback(() => {
    const ids = (lib.view?.unused ?? []).map((im) => im.id);
    return ids.length ? removeWithToast(ids, true) : null;
  }, [lib.view, removeWithToast]);

  const close = (removed: boolean) => {
    const op = pending?.opener ?? null;
    setPending(null);
    if (!removed && op && op.isConnected) {
      try {
        op.focus({ preventScroll: true });
      } catch {
        /* gone */
      }
    }
  };

  const confirm = pending && lib.c && lib.view ? (
    <RemoveConfirm
      c={lib.c}
      im={lib.view.images.find((x) => x.id === pending.id) ?? null}
      uses={lib.view.usage[pending.id] ?? []}
      onCancel={() => close(false)}
      onYes={() => {
        const id = pending.id;
        close(true);
        removeWithToast([id], false);
      }}
    />
  ) : null;

  return { requestDelete, cleanup, confirm };
}

/** 1.0's #modalImgRemove: where the picture is used, then "Remove it everywhere" or Cancel (focus on Cancel; Escape
 *  cancels and goes no further; Tab between the two). */
function RemoveConfirm({ c, im, uses, onCancel, onYes }: { c: Closure; im: BookImage | null; uses: ReturnType<Closure['api']['imageUsage']>; onCancel: () => void; onYes: () => void }) {
  const { t } = useLocale();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      cancel.current?.focus({ preventScroll: true });
    } catch {
      /* not yet */
    }
  }, []);
  const name = c.api.imglibName(im);
  return (
    <Dialog open onClose={onCancel} id="modalImgRemove" z={79} labelledBy="imgRmTitle" describedBy="imgRmBody imgRmUses imgRmNote" role="alertdialog" modalStyle={{ maxWidth: 460 }}>
      <h2>
        <Icon name="Trash2" />
        <span id="imgRmTitle">{t('imglib.confirmTitle', { name })}</span>
      </h2>
      <p className="m-sub" id="imgRmBody">
        {t('imglib.confirmBody')}
      </p>
      <ul className="imgrm-uses" id="imgRmUses">
        {uses.map((u, i) => (
          <li key={i}>{c.api.imglibUseText(u)}</li>
        ))}
      </ul>
      <p className="m-sub" id="imgRmNote">
        {(uses.some((u) => u.role === 'cover') ? t('imglib.coverNote') + ' ' : '') + t('imglib.confirmNote')}
      </p>
      <div className="modal-actions">
        <button type="button" className="tb-btn" id="btnImgRmCancel" ref={cancel} onClick={onCancel}>
          {t('imglib.cancel')}
        </button>
        <button type="button" className="tb-btn primary" id="btnImgRmYes" onClick={onYes}>
          <Icon name="Trash2" />
          <span>{t('imglib.removeEverywhere')}</span>
        </button>
      </div>
    </Dialog>
  );
}

/** 1.0's imglibRenderTools: the cleanup button with the unused pictures' count and size, or the quiet note alone; the
 *  sample's note while the sample's pictures are on the desk. */
export function LibraryTools({ c, view, onCleanup }: { c: Closure; view: LibraryView; onCleanup: () => void }) {
  const { t } = useLocale();
  const imgs = view.images;
  const hasSample = imgs.some((im) => view.sample.has(im.id));
  if (!imgs.some((im) => !view.sample.has(im.id))) {
    return (
      <div className="imglib-tools" id="imgLibTools" hidden={!hasSample}>
        {hasSample ? <span className="img-lib-note">{t('imglib.sampleNote')}</span> : null}
      </div>
    );
  }
  const n = view.unused.length;
  const size = c.api.imglibSize(view.unused.reduce((a, im) => a + c.api.imglibBytes(im), 0));
  return (
    <div className="imglib-tools" id="imgLibTools">
      {n ? (
        <button type="button" className="tb-btn" id="btnImgCleanup" aria-describedby="imgCleanupNote" onClick={onCleanup}>
          <Icon name="Eraser" />
          <span>{t('imglib.cleanup', { n, size })}</span>
        </button>
      ) : null}
      <span className="img-lib-note" id="imgCleanupNote">
        {t(n ? 'imglib.cleanupHistory' : 'imglib.cleanupNone') + (hasSample ? ' ' + t('imglib.sampleNote') : '')}
      </span>
    </div>
  );
}
