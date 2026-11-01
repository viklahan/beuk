import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { SECTIONS } from '@book/editor/index.js';
import { useBook } from '../book/BookProvider';
import type { OutlineRow } from '../book/outlineRows';
import { closureIfLoaded, loadClosure } from '../closure/index';
import { caretOffset, settleActiveEditor } from '../editor/active';
import { snapshotLabel } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useDismissToasts, useToast } from '../shell/Toasts';
import {
  chopDelete, chopDuplicate, chopMenuItems, chopMerge, chopMessage, chopSplit, chopSplitWhy, chopUndo,
  type ChopDone, type ChopEnv, type ChopRec, type MenuItem,
} from './chop';

/* BEUK:chapterops — the row's action menu and the Undo toast (1.0's
   chopRowButton, chopOpenMenu, chopPlaceMenu, chopMenuPick, chopRun's
   toast; client/index.html). Markup and keys as 1.0's:
   - the row button .mini.chop-more[data-act=more][aria-haspopup=menu]
     [aria-expanded], titled chop.more, named chop.moreFor; shown on every
     row 1.0 offers a menu on (not on a generated page);
   - #chopMenu.chop-menu[role=menu] (portalled to <body>, fixed, z-index 75),
     named chop.moreFor, its items button[role=menuitem].chop-item
     [data-chop-act]; a refused item carries aria-disabled, its reason as
     title and as visible .chop-why text (aria-describedby); a danger item
     after a separator;
   - keys: ArrowUp/ArrowDown wrap, Home/End, Escape closes and returns focus
     to the button, Tab closes; a pointer down outside closes; it is placed
     against its button on the inline-end side, kept inside the window,
     follows the row on scroll and resize, and closes when the row is gone;
   - picking a refused item says its reason in a toast (no hover on touch);
     a keyboard pick puts focus on the toast's Undo, a mouse pick leaves
     focus alone; when the toast leaves holding focus, focus goes to the
     active row (1.0's chopFocusAfter).
   A whole book arriving (another generation, a backup, a restore) takes the
   Undo toasts down and closes the menu (1.0's chopBookArrived). */

type Open = { id: string; index: number; items: MenuItem[] };

export function useChapterOps({ openHistory }: { openHistory: () => void }): { tools: (row: OutlineRow) => ReactNode; menu: ReactNode } {
  const { t } = useLocale();
  const bk = useBook();
  const toast = useToast();
  const dismiss = useDismissToasts();
  const [open, setOpen] = useState<Open | null>(null);
  const [ready, setReady] = useState(() => !!closureIfLoaded());
  const menuRef = useRef<HTMLDivElement>(null);
  const ydoc = bk.book?.ydoc ?? null;
  const bkRef = useRef(bk);
  bkRef.current = bk;

  useEffect(() => {
    if (!ready && bk.phase === 'open') void loadClosure().then(() => setReady(true)).catch(() => undefined);
  }, [ready, bk.phase]);

  // 1.0's chopBookArrived: a whole book arriving takes the Undo toasts down and closes the menu
  useEffect(() => {
    dismiss('chop');
    setOpen(null);
  }, [ydoc, dismiss]);

  const trigger = (id: string) => document.querySelector<HTMLElement>(`#structureList .sec-item[data-sec="${CSS.escape(id)}"] [data-act="more"]`);
  const focusActiveRow = () => {
    const row = document.querySelector<HTMLElement>('#structureList .sec-item.active');
    if (row && row.offsetParent !== null) row.focus();
  };

  const close = useCallback((refocus: boolean) => {
    setOpen((o) => {
      if (o && refocus) requestAnimationFrame(() => trigger(o.id)?.focus());
      return null;
    });
  }, []);

  const idAt = (index: number | null): string | null => (index === null ? null : bkRef.current.rows.find((r) => r.index === index)?.id ?? null);
  const indexOf = (y: Y.Doc, id: string | null): number | null => {
    if (!id) return null;
    const i = y.getArray<unknown>(SECTIONS).toArray().findIndex((m) => m instanceof Y.Map && m.get('id') === id);
    return i < 0 ? null : i;
  };
  const env = (): ChopEnv | null => {
    const c = closureIfLoaded();
    const b = bkRef.current;
    if (!c || !b.book) return null;
    return { c, ydoc: b.book.ydoc, t: t as ChopEnv['t'], activeId: idAt(b.active) };
  };

  const undo = (rec: ChopRec) => {
    const e = env();
    if (!e) return;
    const r = chopUndo(e, rec, bkRef.current.isLive);
    if (r.ok) {
      bkRef.current.select(indexOf(e.ydoc, r.activeId));
      toast(t('chop.undone'), 'Undo2');
    } else if (r.changed !== null) {
      toast(t('chop.undoChanged', { name: r.changed, snap: snapshotLabel(rec.snap, t as never) }), 'History', { label: t('history.open'), ms: e.c.api.CHOP_TOAST_MS, onClick: openHistory });
    }
  };

  const finish = (e: ChopEnv, done: ChopDone | null, icon: 'Trash2' | 'CopyPlus' | 'Scissors' | 'Merge', viaKeyboard: boolean) => {
    if (!done) return;
    bkRef.current.select(indexOf(e.ydoc, done.activeId));
    toast(chopMessage(done.rec, t as ChopEnv['t']), icon, {
      label: t('chop.undo'), ms: e.c.api.CHOP_TOAST_MS, onClick: () => undo(done.rec), onGone: focusActiveRow, focus: viaKeyboard, tag: 'chop',
    });
  };

  const pick = (it: MenuItem, viaKeyboard: boolean) => {
    if (!open) return;
    if (it.why) {
      toast(it.why, 'Info'); // refused, said plainly: on a touch screen there is no hover to read the reason from
      return;
    }
    const { id, index } = open;
    close(false);
    settleActiveEditor(); // the open chapter's pending normalisation first, so the text the operation reads is settled
    const e = env();
    if (!e) return;
    if (it.act === 'del') {
      const r = chopDelete(e, id);
      if (r === 'keepOne') toast(t('chop.keepOne'), 'TriangleAlert');
      else finish(e, r, 'Trash2', viaKeyboard);
    } else if (it.act === 'dup') finish(e, chopDuplicate(e, id), 'CopyPlus', viaKeyboard);
    else if (it.act === 'split') finish(e, chopSplit(e, id, caretOffset(index)), 'Scissors', viaKeyboard);
    else finish(e, chopMerge(e, id), 'Merge', viaKeyboard);
  };

  const openMenu = (row: OutlineRow) => {
    if (open?.id === row.id) {
      close(true);
      return;
    }
    const e = env();
    if (!e) return;
    settleActiveEditor();
    const caret = caretOffset(row.index);
    const items = chopMenuItems(e.c, e.ydoc, row.id, t as ChopEnv['t'], (s) => chopSplitWhy(e.c, s, e.activeId, caret, t as ChopEnv['t']));
    if (!items.length) return;
    setOpen({ id: row.id, index: row.index, items });
  };

  // place against the trigger (1.0's chopPlaceMenu), follow it, close when it is gone; focus the first usable item
  const place = useCallback(() => {
    const m = menuRef.current;
    if (!m || !open) return;
    const trig = trigger(open.id);
    if (!trig) {
      close(false);
      return;
    }
    const r = trig.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    let x = rtl ? r.left : r.right - w;
    x = Math.max(8, Math.min(x, vw - w - 8));
    let y = r.bottom + 4;
    if (y + h > vh - 8) y = Math.max(8, r.top - h - 4);
    // physical pixels from getBoundingClientRect, as 1.0 (and the tooltip, wave 1a ruling 15)
    m.style.setProperty('left', x + 'px');
    m.style.setProperty('top', y + 'px');
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const m = menuRef.current;
    const first = m?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled="true"])') ?? m?.querySelector<HTMLElement>('[role=menuitem]');
    first?.focus();
    // the menu is open once per open; re-placing on every change of the list follows the row
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      const tgt = ev.target as Element | null;
      if (menuRef.current?.contains(tgt) || tgt?.closest?.('[data-act="more"]')) return;
      close(false);
    };
    const sc = document.getElementById('structureScroll');
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', place);
    sc?.addEventListener('scroll', place, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
      sc?.removeEventListener('scroll', place);
    };
  }, [open, place, close]);
  // the outline re-rendered (the book's list changed): follow the row, or close when it is gone
  useEffect(() => {
    if (open) place();
  }, [bk.rows, open, place]);
  // the open row carries .chop-open while its menu is open
  useEffect(() => {
    if (!open) return;
    const row = trigger(open.id)?.closest('.sec-item');
    row?.classList.add('chop-open');
    return () => row?.classList.remove('chop-open');
  }, [open, bk.rows]);

  const onMenuKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(i + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
    } else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      items[ev.key === 'Home' ? 0 : n - 1]?.focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
    } else if (ev.key === 'Tab') close(false);
  };

  const AUTO = ready ? closureIfLoaded()!.api.AUTO_TYPES : null;
  const tools = (row: OutlineRow): ReactNode => {
    // 1.0's chopRowButton: a button wherever the menu has items (every section but a generated page)
    if (!AUTO || !ydoc || !row.isSection || AUTO.includes(row.type)) return null;
    const expanded = open?.id === row.id;
    return (
      <button
        type="button"
        className="mini chop-more"
        data-act="more"
        aria-haspopup="menu"
        aria-expanded={expanded ? 'true' : 'false'}
        title={t('chop.more')}
        aria-label={t('chop.moreFor', { name: row.chopName })}
        onClick={(ev) => {
          ev.stopPropagation();
          openMenu(row);
        }}
      >
        <Icon name="Ellipsis" />
      </button>
    );
  };

  const menuRow = open ? bk.rows.find((r) => r.id === open.id) : undefined;
  const menu = open
    ? createPortal(
        <div id="chopMenu" className="chop-menu" role="menu" aria-label={t('chop.moreFor', { name: menuRow?.chopName ?? '' })} ref={menuRef} onKeyDown={onMenuKey}>
          {open.items.map((it, i) => (
            <MenuButton key={it.act} it={it} sep={!!it.danger && i > 0} onPick={pick} />
          ))}
        </div>,
        document.body,
      )
    : null;
  return { tools, menu };
}

function MenuButton({ it, sep, onPick }: { it: MenuItem; sep: boolean; onPick: (it: MenuItem, viaKeyboard: boolean) => void }) {
  return (
    <>
      {sep && <div className="chop-sep" role="separator" />}
      <button
        type="button"
        role="menuitem"
        className={'chop-item' + (it.danger ? ' danger' : '')}
        data-chop-act={it.act}
        aria-disabled={it.why ? 'true' : undefined}
        title={it.why || undefined}
        aria-describedby={it.why ? 'chopWhy-' + it.act : undefined}
        onClick={(ev) => onPick(it, ev.detail === 0)}
      >
        <Icon name={it.icon} />
        <span>{it.label}</span>
        {it.why && (
          <span className="chop-why" id={'chopWhy-' + it.act}>
            {it.why}
          </span>
        )}
      </button>
    </>
  );
}
