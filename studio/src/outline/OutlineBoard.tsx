import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import * as Y from 'yjs';
import { SECTIONS } from '@book/editor/index.js';
import { useBook } from '../book/BookProvider';
import { chopMessage, chopMove, chopUndo, type ChopEnv, type ChopRec } from '../chapters/chop';
import { closureIfLoaded, loadClosure, type Closure, type OlField, type State } from '../closure/index';
import { snapshotLabel } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { iconOf, idAt, indexOfId, type StructToast } from '../structure/structure';
import { boardEdit, boardState, boardView, readPrefs, savePrefs, secIn, type BoardUi, type BoardView, type Item, type View } from './board';

/* BEUK:outline — the outline board (inventory B5): Cards, List and Grid
   over the book's own sections (client/index.html olRender, olCard, olRow,
   olPartBand, olGridHtml, initOutline). Markup, classes, data attributes
   and keys are 1.0's: #olRoot holds .ol-head (#olTitle, the view switch
   .seg [data-olview], the matter chip [data-olmatter]), the filter bar
   .ol-bar (status chips [data-olst], tag chips [data-oltag], #olCount,
   #olClear), the saved filters .ol-saved ([data-olsaved], [data-olsaveddel],
   #olSaveName / #olSaveDo), the tag manager #olTagMgr (swatches
   [data-olswatch], delete [data-oltagdel]), the field manager #olFieldMgr,
   the groups .ol-group with .ol-cards / .ol-rows, or the Grid (#olGrid);
   #olKbdHint and #olLive.

   Every edit is 1.0's own function (board.ts boardEdit → structure.ts
   runOnBook: the book read at the moment of the edit, one Y transaction).
   A move is 1.0's olMoveTo through chopRun (chop.ts chopMove: a "Before
   moving" snapshot, chapter numbers kept in sequence, a ten-second Undo).
   Keyboard (1.0's): Alt + arrows move the focused card or row (mirrored in
   right-to-left chrome), Enter opens it on the desk; the move buttons are
   ordinary buttons, so every action is reachable without a mouse.

   Typing in a synopsis, a point of view, a note or a text field is kept
   as the writer types and written 300 ms after the last key (and at once
   when the field is left); 1.0 writes on every key. */

type Rec = Record<string, unknown>;
type T = (key: string, params?: Record<string, unknown>) => string;
const VIEWS: [View, 'LayoutGrid' | 'List' | 'Table2', string][] = [['cards', 'LayoutGrid', 'ol.viewCards'], ['list', 'List', 'ol.viewList'], ['grid', 'Table2', 'ol.viewGrid']];
const statusVar = (st: string, statuses: string[]) => (statuses.includes(st) ? 'var(--ol-s-' + st + ')' : 'transparent');
const cssVars = (v: Record<string, string>) => v as unknown as CSSProperties;

/** A text field whose words are the writer's while focused, written 300 ms after the last key and when left. */
function Draft({ value, onCommit, area, ...rest }: { value: string; onCommit: (v: string) => void; area?: boolean } & Rec) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current(v);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const props = {
    ...rest,
    value: draft ?? value,
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      setDraft(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(v), 300);
    },
    onBlur: () => {
      if (draft !== null) flush(draft);
      setDraft(null);
    },
  };
  return area ? <textarea {...(props as object)} /> : <input type="text" {...(props as object)} />;
}

export function OutlineBoard({ shown, onOpen }: { shown: boolean; onOpen: (id: string) => void }) {
  const { t, dir } = useLocale();
  const tt = t as unknown as T;
  const bk = useBook();
  const toast = useToast();
  const ydoc = bk.book?.ydoc ?? null;
  const [c, setC] = useState<Closure | null>(() => closureIfLoaded());
  const [ui, setUi] = useState<BoardUi>(() => ({ ...readPrefs(), status: [], tags: [], savedId: null, tagsOpen: false, fieldsOpen: false }));
  const [st, setSt] = useState<State | null>(null);
  const [live, setLive] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const focusNext = useRef<{ id?: string; sel?: string | null; domId?: string; key?: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const bkRef = useRef(bk);
  bkRef.current = bk;

  useEffect(() => {
    if (!c && bk.phase === 'open') void loadClosure().then(setC).catch(() => undefined);
  }, [c, bk.phase]);
  // the book as 1.0 reads it, re-read 120 ms after a change while the board is shown (it never writes)
  useEffect(() => {
    if (!c || !ydoc || !shown) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => setSt(boardState(c, ydoc));
    read();
    const on = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 120);
    };
    ydoc.on('update', on);
    return () => {
      if (timer) clearTimeout(timer);
      ydoc.off('update', on);
    };
  }, [c, ydoc, shown]);

  const view: BoardView | null = useMemo(() => (c && st ? boardView(c, st, ui, tt) : null), [c, st, ui, tt]);
  // olRender: a tag the book no longer has leaves the filter, a vanished saved filter is no longer the one on
  useEffect(() => {
    if (view && (view.ui.tags.length !== ui.tags.length || view.ui.savedId !== ui.savedId)) setUi(view.ui);
  }, [view, ui]);
  // the field or button in use keeps its focus across a redraw that moves it (1.0's olUi.focus)
  useLayoutEffect(() => {
    const f = focusNext.current;
    const r = root.current;
    if (!f || !r) return;
    let el: HTMLElement | null = null;
    if (f.domId) el = document.getElementById(f.domId);
    else if (f.key) el = r.querySelector(`[data-olkey="${CSS.escape(f.key)}"]`);
    else if (f.id) {
      const host = r.querySelector<HTMLElement>(`[data-ol="${CSS.escape(f.id)}"]`);
      el = host && f.sel ? host.querySelector<HTMLElement>(f.sel) : host;
      if (el && (el as HTMLButtonElement).disabled) el = host;
    }
    if (el) {
      focusNext.current = null;
      el.focus();
    }
  });

  if (!shown) return null;
  if (!c || !ydoc || !view || !st) return <div id="olRoot" ref={root} />;
  return (
    <>
      {board(c, ydoc, view, st)}
      <div id="olLive" className="sr-only" aria-live="polite">
        {live}
      </div>
    </>
  );

  function board(c: Closure, ydoc: Y.Doc, view: BoardView, st: State) {

  const announce = (msg: string) => {
    setLive('');
    setTimeout(() => setLive(msg), 30);
  };
  const structToast: StructToast = (msg, icon, action) =>
    toast(msg, iconOf(icon), action ? {
      label: action.label, ms: action.ms,
      // 1.0's Undo runs on the book as it stands at the click, if it is still this book
      onClick: () => {
        if (!bkRef.current.isLive(ydoc)) return;
        const r = boardEdit(c, ydoc, uiRef.current, () => action.onClick());
        setUi(r.ui);
      },
    } : undefined);
  /** One of 1.0's edits, on the book at this moment. */
  const edit = <R,>(fn: (s: State) => R): R => {
    const r = boardEdit(c, ydoc, uiRef.current, fn, structToast);
    if (JSON.stringify(r.ui) !== JSON.stringify(uiRef.current)) setUi(r.ui);
    return r.value;
  };
  const onSec = (id: string, fn: (s: Rec) => unknown) => edit((s) => {
    const sec = secIn(s, id);
    return sec ? fn(sec) : undefined;
  });
  const setView = (patch: Partial<BoardUi>) => {
    const next = { ...uiRef.current, ...patch };
    setUi(next);
    if ('view' in patch || 'matter' in patch) savePrefs(next);
  };

  /* ---- moves: 1.0's olMoveTo through chopRun ---- */
  const env = (): ChopEnv => ({ c, ydoc, t: tt as ChopEnv['t'], activeId: idAt(ydoc, bkRef.current.active) });
  const undoMove = (rec: ChopRec) => {
    const r = chopUndo(env(), rec, bkRef.current.isLive);
    if (r.ok) {
      bkRef.current.select(indexOfId(ydoc, r.activeId));
      toast(t('chop.undone'), 'Undo2');
    } else if (r.changed !== null) toast(tt('chop.undoChanged', { name: r.changed, snap: snapshotLabel(rec.snap, t as never) }), 'History');
  };
  const moveTo = (dragId: string, targetId: string, after: boolean, sel: string | null): boolean => {
    const r = chopMove(env(), dragId, targetId, after);
    if (r === 'tier') {
      toast(t('toast.moveTier'), 'TriangleAlert');
      return false;
    }
    if (!r) return false;
    focusNext.current = { id: dragId, sel };
    bkRef.current.select(indexOfId(ydoc, r.activeId));
    toast(chopMessage(r.rec, tt as ChopEnv['t']), 'Move', { label: t('chop.undo'), ms: c.api.CHOP_TOAST_MS, onClick: () => undoMove(r.rec), tag: 'chop' });
    // 1.0's olLive: where it now stands in its group
    const now = boardState(c, ydoc);
    c.setState(now);
    const s = now.sections.find((x) => x.id === dragId);
    if (s) {
      const b = c.api.olKindBounds(s);
      announce(tt('ol.movedPos', { name: c.api.chopName(s), pos: c.api.fmtNum(b.pos), total: c.api.fmtNum(b.total) }));
    }
    setSt(now);
    return true;
  };
  /** 1.0's olMoveStep: the neighbour in the book, same tier only. */
  const moveStep = (id: string, d: number, sel: string | null) => {
    const list = ydoc.getArray<unknown>(SECTIONS).toArray().map((m) => (m instanceof Y.Map ? { id: m.get('id'), kind: m.get('kind') || 'body' } : { id: null, kind: '' }));
    const i = list.findIndex((x) => x.id === id), j = i + (d < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length || list[j]!.kind !== list[i]!.kind) return;
    moveTo(id, String(list[j]!.id), d > 0, sel);
  };

  /* ---- drawing (1.0's olMoveButtons, olStatusSelect, olTagsCell, olFieldControl, olCard, olRow, olPartBand) ---- */
  const rtl = dir === 'rtl';
  const moveButtons = (s: Item, list: boolean) => (
    <span className="ol-moves">
      <button type="button" className="ol-mini" data-olmv="-1" title={t('ol.moveEarlier')} aria-label={tt('ol.moveEarlierFor', { name: s.name })} disabled={s.first} onClick={() => moveStep(s.id, -1, '[data-olmv="-1"]')}>
        <Icon name={list ? 'ChevronUp' : rtl ? 'ChevronRight' : 'ChevronLeft'} />
      </button>
      <button type="button" className="ol-mini" data-olmv="1" title={t('ol.moveLater')} aria-label={tt('ol.moveLaterFor', { name: s.name })} disabled={s.last} onClick={() => moveStep(s.id, 1, '[data-olmv="1"]')}>
        <Icon name={list ? 'ChevronDown' : rtl ? 'ChevronLeft' : 'ChevronRight'} />
      </button>
    </span>
  );
  const S = c.api.OL_STATUSES;
  const statusLabel = (st2: string) => c.api.olStatusLabel(st2);
  const statusSelect = (s: Item) => (
    <span className="ol-stat">
      <span className={'ol-dot' + (s.status ? '' : ' none')} style={cssVars({ '--ol-st': statusVar(s.status, S) })} aria-hidden="true" />
      <select
        data-olf="status"
        aria-label={tt('ol.statusFor', { name: s.name })}
        value={s.status}
        onChange={(e) => {
          const v = e.target.value;
          focusNext.current = { id: s.id, sel: '[data-olf="status"]' };
          onSec(s.id, (sec) => c.api.olSetField(sec, 'status', v));
        }}
      >
        {['', ...S].map((v) => (
          <option key={v} value={v}>
            {statusLabel(v)}
          </option>
        ))}
      </select>
      <Icon name="ChevronDown" className="ol-chev" />
    </span>
  );
  const addTag = (s: Item, raw: string, el: HTMLInputElement) => {
    if (onSec(s.id, (sec) => c.api.olAddTag(sec, raw))) focusNext.current = { id: s.id, sel: '.ol-tagin' };
    el.value = '';
  };
  const tagsCell = (s: Item) => (
    <div className="ol-tags">
      {s.tags.map((tg) => (
        <span className="ol-tag" key={tg.name} style={cssVars({ '--ol-tc': 'var(--ol-c' + tg.colour + ')' })}>
          {tg.name}
          <button
            type="button"
            className="ol-mini ol-tagx"
            data-oltagx={tg.name}
            aria-label={tt('ol.tagRemove', { tag: tg.name, name: s.name })}
            onClick={() => {
              if (onSec(s.id, (sec) => c.api.olRemoveTag(sec, tg.name))) focusNext.current = { id: s.id, sel: '.ol-tagin' };
            }}
          >
            <Icon name="X" />
          </button>
        </span>
      ))}
      <input
        type="text"
        className="ol-tagin"
        data-olf="tagin"
        list="olTagList"
        maxLength={40}
        autoComplete="off"
        placeholder={t('ol.tagAdd')}
        aria-label={tt('ol.tagAddFor', { name: s.name })}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if ((e.key === 'Enter' || e.key === ',') && el.value.trim()) {
            e.preventDefault();
            addTag(s, el.value, el);
          }
        }}
        onInput={(e) => {
          // a suggestion picked from the list arrives whole (1.0: no inputType, or insertReplacementText)
          const el = e.currentTarget;
          const it = (e.nativeEvent as InputEvent).inputType;
          if ((!it || it === 'insertReplacementText') && el.value.trim()) addTag(s, el.value, el);
        }}
      />
    </div>
  );
  const fieldControl = (s: Item, f: OlField, label: string): ReactNode => {
    const v = s.custom[f.id] != null ? s.custom[f.id] : '';
    const a = { 'data-olf': 'custom', 'data-olcf': f.id, 'aria-label': tt('ol.fieldFor', { field: f.name, name: label }) };
    const set = (val: unknown) => onSec(s.id, (sec) => c.api.olSetCustom(sec, f.id, val));
    if (f.type === 'check') return <input type="checkbox" {...a} checked={v === true} onChange={(e) => set(e.target.checked)} />;
    if (f.type === 'date') return <input type="date" {...a} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)} />;
    if (f.type === 'list') {
      const opts = (f.options || []).slice();
      if (typeof v === 'string' && v && !opts.includes(v)) opts.push(v); // a choice since taken off the list stays readable
      return (
        <select {...a} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)}>
          <option value="">{t('ol.fieldUnset')}</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return <Draft dir="auto" maxLength={500} {...a} value={typeof v === 'string' ? v : ''} onCommit={set} />;
  };
  const fieldsCell = (s: Item) =>
    view.ob.fields.length ? (
      <div className="ol-fields">
        {view.ob.fields.map((f) => (
          <label className={'ol-fld' + (f.type === 'check' ? ' ol-fld-check' : '')} key={f.id}>
            <span className="ol-fld-n" dir="auto">
              {f.name}
            </span>
            {fieldControl(s, f, s.name)}
          </label>
        ))}
      </div>
    ) : null;
  const synopsis = (s: Item, rows: number) => (
    <Draft area className="ol-syn" dir="auto" data-olf="synopsis" rows={rows} maxLength={4000} placeholder={t('ol.synPh')} aria-label={tt('ol.synFor', { name: s.name })} value={s.synopsis} onCommit={(v: string) => onSec(s.id, (sec) => c.api.olSetField(sec, 'synopsis', v))} />
  );
  const openBtn = (s: Item, ti: string) => (
    <button type="button" className="ol-open" title={tt('ol.openFor', { name: s.name })} onClick={() => onOpen(s.id)}>
      {ti}
    </button>
  );
  const activeId = idAt(ydoc, bk.active);
  /** The card, row or band itself: focusable, draggable, Alt + arrows and Enter (1.0's keydown on [data-ol]). */
  const host = (s: Item, isCard: boolean) => ({
    'data-ol': s.id,
    tabIndex: 0,
    draggable: true,
    'aria-describedby': 'olKbdHint',
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onOpen(s.id);
        return;
      }
      if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const earlier = e.key === 'ArrowUp' || (e.key === 'ArrowLeft' ? !rtl : rtl);
        moveStep(s.id, earlier ? -1 : 1, null);
      }
    },
    onPointerDown: (e: { target: EventTarget; currentTarget: HTMLElement }) => {
      // a text field inside a card stays a text field
      e.currentTarget.draggable = !(e.target as Element).closest('textarea, input, select');
    },
    onDragStart: (e: DragEvent) => {
      setDrag(s.id);
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.id);
      } catch {
        /* no data transfer: the drag still runs */
      }
    },
    onDragEnd: () => {
      setDrag(null);
      setDrop(null);
    },
    onDragOver: (e: DragEvent) => {
      if (!drag || drag === s.id) return;
      const a = view.items.find((x) => x.id === drag);
      setDrop(null);
      if (!a || a.kind !== s.kind) return;
      e.preventDefault();
      setDrop({ id: s.id, after: side(e, isCard) });
    },
    onDrop: (e: DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      const id = drag;
      setDrag(null);
      setDrop(null);
      if (id !== s.id) moveTo(id, s.id, side(e, isCard), null);
    },
  });
  const side = (e: DragEvent, isCard: boolean) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (isCard) {
      const past = e.clientX - r.left >= r.width / 2;
      return rtl ? !past : past;
    }
    return e.clientY - r.top >= r.height / 2;
  };
  const dnd = (id: string) => (drag === id ? ' dragging' : '') + (drop?.id === id ? (drop.after ? ' drop-after' : ' drop-before') : '');
  const card = (s: Item) => {
    const ti = s.title.trim() || t('side.untitled');
    return (
      <article
        key={s.id}
        className={'ol-card' + (s.id === activeId ? ' active' : '') + (s.included ? '' : ' excluded') + dnd(s.id)}
        style={cssVars({ '--ol-st': statusVar(s.status, S) })}
        aria-label={s.name + ' — ' + statusLabel(s.status)}
        {...host(s, true)}
      >
        <div className="ol-card-head">
          <div className="ol-tx">
            {s.num && s.title && <span className="ol-num">{s.num}</span>}
            {openBtn(s, ti)}
          </div>
          {moveButtons(s, false)}
        </div>
        {synopsis(s, 3)}
        {tagsCell(s)}
        {fieldsCell(s)}
        <div className="ol-card-foot">
          {statusSelect(s)}
          <span className="ol-meta">{s.meta}</span>
        </div>
      </article>
    );
  };
  const partBand = (s: Item, list: boolean) => {
    const ti = s.title.trim() || t('side.untitled');
    if (list)
      return (
        <div key={s.id} className={'ol-row ol-partrow' + dnd(s.id)} aria-label={s.name} {...host(s, false)}>
          <div className="ol-c-mv">{moveButtons(s, true)}</div>
          <div className="ol-c-ti">
            <span className="ol-num">{s.num}</span>
            {openBtn(s, ti)}
          </div>
        </div>
      );
    return (
      <div key={s.id} className={'ol-partband' + dnd(s.id)} aria-label={s.name} {...host(s, false)}>
        <Icon name="Bookmark" />
        <div className="ol-tx">
          <span className="ol-num">{s.num}</span>
          {openBtn(s, ti)}
        </div>
        {moveButtons(s, false)}
      </div>
    );
  };
  const row = (s: Item) => {
    const ti = s.title.trim() || t('side.untitled');
    return (
      <div
        key={s.id}
        className={'ol-row' + (s.id === activeId ? ' active' : '') + (s.included ? '' : ' excluded') + dnd(s.id)}
        style={cssVars({ '--ol-st': statusVar(s.status, S) })}
        aria-label={s.name + ' — ' + statusLabel(s.status)}
        {...host(s, false)}
      >
        <div className="ol-c-mv">{moveButtons(s, true)}</div>
        <div className="ol-c-ti">
          {s.num && s.title && <span className="ol-num">{s.num}</span>}
          {openBtn(s, ti)}
          <div className="ol-c-pv">
            <Icon name="Eye" />
            <Draft className="ol-pov" dir="auto" data-olf="pov" maxLength={80} placeholder={t('ol.povPh')} aria-label={tt('ol.povFor', { name: s.name })} value={s.pov} onCommit={(v: string) => onSec(s.id, (sec) => c.api.olSetField(sec, 'pov', v))} />
          </div>
        </div>
        <div className="ol-c-sy">
          {synopsis(s, 2)}
          {fieldsCell(s)}
        </div>
        <div className="ol-c-st">
          <span className="ol-cl" aria-hidden="true">
            {t('ol.colStatus')}
          </span>
          {statusSelect(s)}
        </div>
        <div className="ol-c-tg">
          <span className="ol-cl" aria-hidden="true">
            {t('ol.colTags')}
          </span>
          {tagsCell(s)}
        </div>
        <div className="ol-c-wd ol-meta">
          {c.api.fmtNum(s.words)}
          {s.scenes > 1 && <span className="ol-sc">{tt('ol.scenes', { n: c.api.fmtNum(s.scenes) })}</span>}
        </div>
      </div>
    );
  };

  /* ---- the head, the filter bar, saved filters, the tag and field managers ---- */
  const ob = view.ob, u = view.ui, grid = u.view === 'grid', list = u.view === 'list';
  const tagKey = (n: string) => c.api.olTagKey(n);
  const toggleIn = (arr: string[], v: string, key = (x: string) => x) => (arr.some((x) => key(x) === key(v)) ? arr.filter((x) => key(x) !== key(v)) : arr.concat([v]));
  const need = (domId: string, value: string, go: () => void) => {
    if (!c.api.olCleanThread(value) && domId !== 'olSaveName') {
      setInvalid(domId);
      document.getElementById(domId)?.focus();
      return;
    }
    if (domId === 'olSaveName' && !value.trim()) {
      setInvalid(domId);
      document.getElementById(domId)?.focus();
      return;
    }
    go();
  };
  const inputVal = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  const enterClicks = (btn: string) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById(btn)?.click();
    }
  };
  const clearInvalid = (id: string) => () => invalid === id && setInvalid(null);
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const gridHtml = (g: NonNullable<BoardView['grid']>) => (
    <>
      <div className="ol-gridbar">
        <input type="text" className="txt-input" id="olThreadName" maxLength={60} placeholder={t('ol.threadNamePh')} aria-label={t('ol.threadName')} aria-invalid={invalid === 'olThreadName' ? 'true' : undefined} onInput={clearInvalid('olThreadName')} onKeyDown={enterClicks('olThreadAdd')} />
        <button
          type="button"
          className="tb-btn"
          id="olThreadAdd"
          disabled={g.threads.length >= c.api.OL_THREADS_MAX}
          onClick={() =>
            need('olThreadName', inputVal('olThreadName'), () => {
              const th = edit(() => c.api.olAddThread(inputVal('olThreadName')));
              if (th) {
                (document.getElementById('olThreadName') as HTMLInputElement).value = '';
                focusNext.current = { domId: 'olThreadName' };
                announce(tt('ol.threadAdded', { name: th.name }));
              }
            })
          }
        >
          <Icon name="Plus" />
          {t('ol.threadAdd')}
        </button>
        {/* 1.0 opens the Covenant here; the Covenant is wave 3 (2.0's #btnBible is held the same way) */}
        <button type="button" className="ol-link" data-olcov="1" data-olkey="g-cov" aria-disabled="true">
          <Icon name="BookMarked" />
          {t('ol.gridOpenCov')}
        </button>
      </div>
      {g.empty ? (
        <div className="ol-empty ol-g-empty">
          <p>{t('ol.gridEmpty')}</p>
        </div>
      ) : g.noSecs ? (
        <div className="ol-empty">{t('ol.gridNoSecs')}</div>
      ) : g.noRows ? (
        <div className="ol-empty">{t('ol.empty')}</div>
      ) : (
        <div className="ol-gridwrap">
          <table className="ol-grid" id="olGrid" aria-label={t('ol.gridAria')}>
            <thead>
              <tr>
                <th scope="col" className="ol-g-corner">
                  {t('ol.gridSection')}
                </th>
                {g.fields.map((f) => (
                  <th scope="col" className="ol-g-fh" key={f.id}>
                    <span className="ol-g-ty">{tt('ol.fieldType.' + f.type)}</span>
                    <span className="ol-g-ent" dir="auto">
                      {f.name}
                    </span>
                  </th>
                ))}
                {g.threads.map((th) => (
                  <th scope="col" className="ol-g-th" key={th.id} style={cssVars({ '--ol-tc': 'var(--ol-c' + th.colour + ')' })}>
                    <span className="ol-g-ty">{t('ol.threadType')}</span>
                    <span className="ol-g-thname">
                      <input
                        type="text"
                        dir="auto"
                        maxLength={60}
                        defaultValue={th.name}
                        key={th.name}
                        data-olthname={th.id}
                        data-olkey={'thn-' + th.id}
                        aria-label={tt('ol.threadRename', { name: th.name })}
                        onKeyDown={blurOnEnter}
                        onBlur={(e) => {
                          const el = e.currentTarget;
                          if (!edit(() => c.api.olRenameThread(th.id, el.value))) el.value = th.name;
                        }}
                      />
                      <button type="button" className="ol-mini" data-olthdel={th.id} aria-label={tt('ol.threadDel', { name: th.name })} title={tt('ol.threadDel', { name: th.name })} onClick={() => edit(() => c.api.olDeleteThread(th.id))}>
                        <Icon name="X" />
                      </button>
                    </span>
                  </th>
                ))}
                {g.entries.map((e) => (
                  <th scope="col" key={e.id} className={e.total ? '' : 'ol-g-dim'} title={e.name}>
                    <span className="ol-g-ty">{e.typeLabel}</span>
                    <span className="ol-g-ent" dir="auto">
                      {e.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map(({ item: s, cells }) => (
                <tr key={s.id} data-ol={s.id} data-olgrow={s.id}>
                  <th scope="row" title={s.label}>
                    <span className={'ol-dot' + (s.status ? '' : ' none')} style={cssVars({ '--ol-st': statusVar(s.status, S) })} aria-hidden="true" />
                    <span dir="auto">{s.label}</span>
                  </th>
                  {g.fields.map((f) => (
                    <td className="ol-g-fld" key={f.id}>
                      {fieldControl(s, f, s.label)}
                    </td>
                  ))}
                  {g.threads.map((th) => {
                    const v = typeof s.threads[th.id] === 'string' ? (s.threads[th.id] as string) : '';
                    return (
                      <td className="ol-g-note" key={th.id} style={cssVars({ '--ol-tc': 'var(--ol-c' + th.colour + ')' })}>
                        <Draft area dir="auto" rows={Math.max(2, Math.min(5, Math.ceil(v.length / 26)))} maxLength={2000} data-olf="thread" data-olth={th.id} aria-label={tt('ol.threadNoteFor', { thread: th.name, sec: s.label })} value={v} onCommit={(val: string) => onSec(s.id, (sec) => c.api.olSetThreadNote(sec, th.id, val))} />
                      </td>
                    );
                  })}
                  {g.entries.map((e, k) => {
                    const n = cells[k]!.n;
                    const tip = e.name + ' — ' + (n ? tt('bible.cellTip', { count: n, n: c.api.fmtNum(n), sec: s.label }) : tt('bible.cellNone', { sec: s.label }));
                    if (!n)
                      return (
                        <td key={e.id}>
                          <span className="ol-g-cell zero" data-n="0" title={tip} aria-label={tip} role="img" />
                        </td>
                      );
                    const lv = cells[k]!.level;
                    return (
                      <td key={e.id}>
                        <button type="button" className={'ol-g-cell' + (lv >= 0.58 ? ' deep' : '')} data-n={n} data-olg={e.id} data-olgsec={s.id} title={tip} aria-label={tip} onClick={() => gridOpen(e.id, s.id)}>
                          <span style={{ opacity: lv }} />
                          <b>{c.api.fmtNum(n)}</b>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('ol.gridTotal')}</th>
                {g.fields.map((f, i) => (
                  <td key={f.id} data-olgtotal={f.id}>
                    {tt('ol.fieldFilled', { n: c.api.fmtNum(g.totals.fields[i]!) })}
                  </td>
                ))}
                {g.threads.map((th, i) => (
                  <td key={th.id} data-olgtotal={th.id}>
                    {tt('ol.threadNotes', { n: c.api.fmtNum(g.totals.threads[i]!) })}
                  </td>
                ))}
                {g.entries.map((e, i) => (
                  <td key={e.id} data-olgtotal={e.id}>
                    {c.api.fmtNum(g.totals.entries[i]!)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
  /** 1.0's olGridOpen → bibleJump: the desk at that section, its first mention of the name selected. */
  const gridOpen = (entryId: string, secId: string) => {
    const hit = (view.hits[entryId] || []).find((x) => x.sec === secId);
    if (!hit) return;
    onOpen(secId);
    let tries = 0;
    const pick = () => {
      const m = document.getElementById('manuscript') as (HTMLElement & { beukText?: { select: (s: number, e: number) => unknown }; beukEditor?: { commands: { focus: () => unknown } } }) | null;
      const want = indexOfId(ydoc, secId);
      if (m?.beukText && m.getAttribute('data-section') === String(want)) {
        m.beukEditor?.commands.focus();
        m.beukText.select(hit.s, hit.e);
      } else if (tries++ < 60) requestAnimationFrame(pick);
    };
    requestAnimationFrame(pick);
  };

  const groupLabel = (k: string) => t(k === 'front' ? 'side.groupFront' : k === 'body' ? 'side.groupBody' : 'side.groupBack');
  return (
    <div id="olRoot" ref={root}>
      <div className="ol-head">
        <div>
          <h2 id="olTitle">{t('ol.title')}</h2>
          <p>{t(grid ? 'ol.gridSub' : 'ol.sub')}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div className="seg" role="group" aria-label={t('ol.viewAria')}>
            {VIEWS.map(([v, icon, label]) => (
              <button type="button" key={v} data-olview={v} data-olkey={'v-' + v} className={u.view === v ? 'active' : ''} aria-pressed={u.view === v} onClick={() => setView({ view: v })}>
                <Icon name={icon} />
                {tt(label)}
              </button>
            ))}
          </div>
          {!grid && (
            <button type="button" className="ol-chip" data-olmatter="1" data-olkey="matter" aria-pressed={u.matter} onClick={() => setView({ matter: !u.matter })}>
              {t('ol.matter')}
            </button>
          )}
        </div>
      </div>
      <div className="ol-bar" role="group" aria-label={t('ol.filter')}>
        <span className="ol-bar-lab">{t('ol.filter')}</span>
        {['none', ...S].map((stt) => (
          <button type="button" key={stt} className="ol-chip" data-olst={stt} data-olkey={'st-' + stt} aria-pressed={u.status.includes(stt)} onClick={() => setView({ status: toggleIn(u.status, stt), savedId: null })}>
            <span className={'ol-dot' + (stt === 'none' ? ' none' : '')} style={cssVars({ '--ol-st': statusVar(stt, S) })} aria-hidden="true" />
            {statusLabel(stt)}
          </button>
        ))}
        <span className="ol-bar-sep" aria-hidden="true" />
        {ob.tags.length ? (
          ob.tags.map((tg) => (
            <button type="button" key={tg.name} className="ol-chip" data-oltag={tg.name} data-olkey={'tg-' + tagKey(tg.name)} aria-pressed={u.tags.some((n) => tagKey(n) === tagKey(tg.name))} onClick={() => setView({ tags: toggleIn(u.tags, tg.name, tagKey), savedId: null })}>
              <span className="ol-tagdot" style={cssVars({ '--ol-tc': 'var(--ol-c' + tg.colour + ')' })} aria-hidden="true" />
              {tg.name}
            </button>
          ))
        ) : (
          <span className="ol-meta" style={{ fontFamily: 'inherit', fontSize: 12 }}>
            {t('ol.tagsNone')}
          </span>
        )}
        <span className="ol-count" id="olCount" role="status">
          {tt('ol.shown', { shown: c.api.fmtNum(view.shown), total: c.api.fmtNum(view.countable) })}
          {view.filterOn && (
            <>
              {' · '}
              <b>{tt('ol.hidden', { n: c.api.fmtNum(view.hidden) })}</b>
            </>
          )}
        </span>
        <button
          type="button"
          className="ol-link"
          id="olClear"
          disabled={!view.filterOn}
          onClick={() => {
            focusNext.current = { key: 'st-none' };
            setView({ status: [], tags: [], savedId: null });
          }}
        >
          {t('ol.clear')}
        </button>
      </div>
      <div className="ol-saved">
        <span className="ol-bar-lab">{t('ol.saved')}</span>
        {ob.filters.length ? (
          ob.filters.map((f) => (
            <span className="ol-savedchip" key={f.id}>
              <button
                type="button"
                className="ol-chip"
                data-olsaved={f.id}
                data-olkey={'sv-' + f.id}
                aria-pressed={view.savedOn[f.id]}
                onClick={() => {
                  // 1.0's olApplySaved: the view only, never the book
                  setOlUiFrom(c, uiRef.current, view, st);
                  if (c.api.olApplySaved(f.id)) setView({ status: c.api.olUi.status.slice(), tags: c.api.olUi.tags.slice(), savedId: c.api.olUi.savedId });
                }}
              >
                <Icon name="Filter" />
                {f.name}
              </button>
              <button
                type="button"
                className="ol-mini"
                data-olsaveddel={f.id}
                aria-label={tt('ol.savedDel', { name: f.name })}
                title={tt('ol.savedDel', { name: f.name })}
                onClick={() => {
                  edit(() => {
                    const b = c.api.olBook();
                    b.filters = b.filters.filter((x) => x.id !== f.id);
                  });
                  focusNext.current = { key: 'st-none' };
                  if (uiRef.current.savedId === f.id) setView({ savedId: null });
                }}
              >
                <Icon name="X" />
              </button>
            </span>
          ))
        ) : (
          <span className="ol-meta" style={{ fontFamily: 'inherit', fontSize: 12 }}>
            {t('ol.savedNone')}
          </span>
        )}
        {view.canSave && (
          <>
            <input type="text" className="txt-input" id="olSaveName" maxLength={60} placeholder={t('ol.saveNamePh')} aria-label={t('ol.saveName')} aria-invalid={invalid === 'olSaveName' ? 'true' : undefined} onInput={clearInvalid('olSaveName')} onKeyDown={enterClicks('olSaveDo')} />
            <button
              type="button"
              className="tb-btn"
              id="olSaveDo"
              onClick={() =>
                need('olSaveName', inputVal('olSaveName'), () => {
                  const f = edit(() => c.api.olSaveFilter(inputVal('olSaveName')));
                  if (f) focusNext.current = { key: 'sv-' + f.id };
                })
              }
            >
              <Icon name="BookmarkPlus" />
              {t('ol.saveDo')}
            </button>
          </>
        )}
      </div>
      {ob.tags.length > 0 && (
        <details className="ol-tagmgr" id="olTagMgr" open={u.tagsOpen} onToggle={(e) => setView({ tagsOpen: (e.currentTarget as HTMLDetailsElement).open })}>
          <summary>{tt('ol.tagsManage', { n: c.api.fmtNum(ob.tags.length) })}</summary>
          {ob.tags.map((tg) => (
            <div className="ol-tagrow" key={tg.name}>
              <span className="ol-tag" style={cssVars({ '--ol-tc': 'var(--ol-c' + tg.colour + ')', paddingInlineEnd: '8px' })}>
                {tg.name}
              </span>
              <span className="ol-uses">{tt('ol.tagUses', { n: c.api.fmtNum(view.tagUses[tg.name] ?? 0) })}</span>
              <span className="ol-swatches" role="group" aria-label={tt('ol.tagColourFor', { tag: tg.name })}>
                {Array.from({ length: c.api.OL_TAG_COLOURS }, (_x, k) => (
                  <button
                    type="button"
                    key={k}
                    className="ol-swatch"
                    style={cssVars({ '--ol-tc': 'var(--ol-c' + k + ')' })}
                    data-olswatch={k}
                    data-oltagname={tg.name}
                    data-olkey={'sw-' + tagKey(tg.name) + '-' + k}
                    aria-pressed={tg.colour === k}
                    aria-label={tt('ol.tagColourN', { n: k + 1 })}
                    onClick={() =>
                      edit(() => {
                        const x = c.api.olTagOf(tg.name);
                        if (x) x.colour = Math.max(0, Math.min(c.api.OL_TAG_COLOURS - 1, k));
                      })
                    }
                  />
                ))}
              </span>
              <button type="button" className="ol-mini" data-oltagdel={tg.name} data-olkey={'td-' + tagKey(tg.name)} aria-label={tt('ol.tagDelete', { tag: tg.name })} title={tt('ol.tagDelete', { tag: tg.name })} onClick={() => edit(() => c.api.olDeleteTag(tg.name))}>
                <Icon name="Trash2" />
              </button>
            </div>
          ))}
        </details>
      )}
      <details className="ol-tagmgr ol-fieldmgr" id="olFieldMgr" open={u.fieldsOpen} onToggle={(e) => setView({ fieldsOpen: (e.currentTarget as HTMLDetailsElement).open })}>
        <summary>{tt('ol.fieldsManage', { n: c.api.fmtNum(ob.fields.length) })}</summary>
        {!ob.fields.length && <p className="ol-fld-none">{t('ol.fieldsNone')}</p>}
        {ob.fields.map((f) => (
          <div className="ol-tagrow ol-fieldrow" key={f.id}>
            <input
              type="text"
              className="ol-fld-name"
              dir="auto"
              maxLength={60}
              defaultValue={f.name}
              key={'n' + f.name}
              data-olfname={f.id}
              data-olkey={'fn-' + f.id}
              aria-label={tt('ol.fieldRename', { name: f.name })}
              onKeyDown={blurOnEnter}
              onBlur={(e) => {
                const el = e.currentTarget;
                if (!edit(() => c.api.olRenameField(f.id, el.value))) el.value = f.name;
              }}
            />
            <span className="ol-fld-kind">{tt('ol.fieldType.' + f.type)}</span>
            {f.type === 'list' && (
              <input
                type="text"
                className="ol-fld-opts"
                dir="auto"
                maxLength={800}
                defaultValue={(f.options || []).join(', ')}
                key={'o' + (f.options || []).join('\u0001')}
                placeholder={t('ol.fieldOptionsPh')}
                data-olfopts={f.id}
                data-olkey={'fo-' + f.id}
                aria-label={tt('ol.fieldOptions', { name: f.name })}
                onKeyDown={blurOnEnter}
                onBlur={(e) => {
                  const v = e.currentTarget.value;
                  edit(() => c.api.olSetFieldOptions(f.id, v));
                }}
              />
            )}
            <span className="ol-uses">{tt('ol.tagUses', { n: c.api.fmtNum(view.fieldUses[f.id] ?? 0) })}</span>
            <button type="button" className="ol-mini" data-olfdel={f.id} data-olkey={'fd-' + f.id} aria-label={tt('ol.fieldDel', { name: f.name })} title={tt('ol.fieldDel', { name: f.name })} onClick={() => edit(() => c.api.olDeleteField(f.id))}>
              <Icon name="Trash2" />
            </button>
          </div>
        ))}
        <div className="ol-fieldadd">
          <input type="text" className="txt-input" id="olFieldName" maxLength={60} placeholder={t('ol.fieldNamePh')} aria-label={t('ol.fieldName')} aria-invalid={invalid === 'olFieldName' ? 'true' : undefined} onInput={clearInvalid('olFieldName')} onKeyDown={enterClicks('olFieldAdd')} />
          <select id="olFieldType" className="ol-fld-type" aria-label={t('ol.fieldKind')} defaultValue="text">
            {c.api.OL_FIELD_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {tt('ol.fieldType.' + ty)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tb-btn"
            id="olFieldAdd"
            disabled={ob.fields.length >= c.api.OL_FIELDS_MAX}
            onClick={() =>
              need('olFieldName', inputVal('olFieldName'), () => {
                const ty = (document.getElementById('olFieldType') as HTMLSelectElement | null)?.value ?? 'text';
                const f = edit(() => c.api.olAddField(inputVal('olFieldName'), ty));
                if (f) {
                  (document.getElementById('olFieldName') as HTMLInputElement).value = '';
                  setView({ fieldsOpen: true });
                  focusNext.current = f.type === 'list' ? { key: 'fo-' + f.id } : { domId: 'olFieldName' };
                  announce(tt('ol.fieldAdded', { name: f.name }));
                }
              })
            }
          >
            <Icon name="Plus" />
            {t('ol.fieldAdd')}
          </button>
        </div>
      </details>
      {grid && view.grid
        ? gridHtml(view.grid)
        : view.groups.map((g) => (
            <section className="ol-group" aria-label={groupLabel(g.kind)} key={g.kind}>
              <h3>
                {groupLabel(g.kind)}
                <span>{c.api.fmtNum(g.real)}</span>
              </h3>
              {g.real > 0 && !g.anyMatch ? (
                <div className="ol-empty">{t('ol.empty')}</div>
              ) : list ? (
                <div className="ol-rows" data-olkind={g.kind}>
                  <div className="ol-rowhead" aria-hidden="true">
                    <span />
                    <span>{t('ol.colTitle')}</span>
                    <span>{t('ol.colSyn')}</span>
                    <span>{t('ol.colStatus')}</span>
                    <span>{t('ol.colTags')}</span>
                    <span>{t('ol.colWords')}</span>
                  </div>
                  {g.items.map((s) => (s.isPart ? partBand(s, true) : row(s)))}
                </div>
              ) : (
                <div className="ol-cards" data-olkind={g.kind}>
                  {g.items.map((s) => (s.isPart ? partBand(s, false) : card(s)))}
                </div>
              )}
            </section>
          ))}
      {!grid && (
        <p className="ol-hint" id="olKbdHint">
          {t('ol.kbdHint')}
        </p>
      )}
      <datalist id="olTagList">
        {ob.tags.map((tg) => (
          <option key={tg.name} value={tg.name} />
        ))}
      </datalist>
    </div>
  );
  }
}

/** 1.0's olUi as the board holds it, on the state the board reads (olApplySaved reads the book's filters). */
function setOlUiFrom(c: Closure, ui: BoardUi, view: BoardView, st: State): void {
  c.setState(st);
  Object.assign(c.api.olUi, { view: ui.view, matter: ui.matter, status: view.ui.status.slice(), tags: view.ui.tags.slice(), savedId: view.ui.savedId });
}
