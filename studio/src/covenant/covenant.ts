import type * as Y from 'yjs';
import { setMetaValue } from '@book/editor/index.js';
import { bookState, closureIfLoaded, covEnv, pageEnv, structEnv, writeEnv, type BibleEntry, type Closure, type State } from '../closure/index';
import { getMeta, setMeta } from '../book/hooks';
import { placeKey } from '../notebook/notebook';
import { repackHistory } from '../history/history';
import { desk } from '../environment/page';
import { activeEditor } from '../editor/active';

/* Step 5 wave 3b (inventory C6): the Covenant — the data side.

   Everything is 1.0's own code (client/index.html BEUK:bible), lifted into the browser closure: the model and its
   normalisers, the room's renderers and handlers, the card, change marking, the series Covenant and its sync. 1.0's
   code edits its global `state.bible` in place (and, for a series book, the series doc it holds in `bibleSeries`), then
   saves the book a moment later (bibleTouched → noteBookEdited). 2.0 runs that code on 1.0's state of the open book
   (covRun) and, when the call returns, writes what 1.0's serializeBook would write for the Covenant into the Y `meta`
   map — `bible` exactly as serializeBook writes it (bibleNormalize, absent when the book has no entry, no fields and
   no counts held), and `images` when an import added pictures — only when that differs from what it would have
   written before the call. So opening the room, browsing, hovering and reading write nothing (constraint 4).

   One state per session: while nothing else changes the book, the next call runs on the very same state (1.0's
   handlers keep references into it: the Undo of a delete puts the entry back into the list it came from). When the
   book changed in between, the state is built again, and the Covenant object is kept if the book's Covenant is still
   the one this session wrote last.

   1.0's own timers that redraw or save later (the room's mention count, the series' save pause and save) are taken
   over when a call returns and re-run inside covRun, so they run on the book's state, not on whatever state another
   part of the studio has set into the shared closure meanwhile. The same holds for the shelf's answers (the series'
   fetches) and a toast's Undo. */

type Rec = Record<string, unknown>;
type Session = { ydoc: Y.Doc; state: State; ver: number; base: string; images: string; series: string; wrote: string | null; bible: unknown };

let session: Session | null = null;
/** Bumped by every transaction of the open book (one listener per Y.Doc). */
const versions = new WeakMap<Y.Doc, { n: number }>();
function verOf(ydoc: Y.Doc): { n: number } {
  let v = versions.get(ydoc);
  if (!v) {
    v = { n: 0 };
    const box = v;
    ydoc.on('afterTransaction', () => {
      box.n++;
    });
    versions.set(ydoc, v);
  }
  return v;
}

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const ID = /^[\w-]{1,40}$/;

/** An entry or a change stored without a valid id would get a new random one on every read (1.0's bibleNormalizeEntry
 *  mints one): it gets its place as one ("bx<n>", "cx<n>", made unique) instead, written only at the next Covenant
 *  write (as the notebook's note ids, wave 1c). */
function stableIds(raw: unknown): unknown {
  if (!isRec(raw) || !Array.isArray(raw.entries)) return raw;
  const taken = new Set(raw.entries.map((e) => (isRec(e) && typeof e.id === 'string' ? e.id : '')));
  const entries = raw.entries.map((e, i) => {
    if (!isRec(e)) return e;
    let out = e;
    if (!(typeof e.id === 'string' && ID.test(e.id))) {
      let id = 'bx' + (i + 1), k = 1;
      while (taken.has(id)) id = 'bx' + (i + 1) + '-' + ++k;
      taken.add(id);
      out = { ...out, id };
    }
    if (Array.isArray(e.changes) && e.changes.some((c) => isRec(c) && !(typeof c.id === 'string' && ID.test(c.id)))) {
      const cids = new Set(e.changes.map((c) => (isRec(c) && typeof c.id === 'string' ? c.id : '')));
      out = {
        ...out,
        changes: e.changes.map((c, j) => {
          if (!isRec(c) || (typeof c.id === 'string' && ID.test(c.id))) return c;
          let id = 'cx' + (j + 1), k = 1;
          while (cids.has(id)) id = 'cx' + (j + 1) + '-' + ++k;
          cids.add(id);
          return { ...c, id };
        }),
      };
    }
    return out;
  });
  return { ...raw, entries };
}

/** What 1.0's serializeBook writes for the Covenant of `state` (undefined: no `bible` key). Run with `state` set. */
function serialized(c: Closure): unknown {
  const a = c.api;
  const st = c.getState() as Rec & { bible?: Rec };
  a.bibleCountsNow(); // serializeBook's first line: a series book's mention counts ride it
  const b = st.bible;
  const fields = isRec(b) && isRec(b.fields) && Object.keys(b.fields).length > 0;
  return a.bibleHas() || fields || a.bibleCountsHeld() ? a.bibleNormalize(b) : undefined;
}
/** The book settings 1.0's series code changes (bibleSeriesLeave, bibleSeriesRename: state.meta.series). */
const seriesSig = (st: Rec): string => JSON.stringify([(st.meta as Rec | undefined)?.series ?? null]);
/** What an edit changes: the Covenant as serializeBook writes it, less a series book's mention counts (bibleCountsNow
 *  refreshes them on every save, so a series arriving or the text changing moves them without any Covenant edit; 1.0
 *  writes them only with its next save, and so does 2.0: they ride the next real edit). */
const editSig = (out: unknown): string => {
  if (!isRec(out)) return 'null';
  const entries = Array.isArray(out.entries) ? out.entries : [];
  // a Covenant held only for its counts (no entry, no field) is no edit either
  if (!entries.length && !(isRec(out.fields) && Object.keys(out.fields).length)) return 'null';
  return JSON.stringify({ ...out, counts: undefined });
};
const imagesSig = (st: Rec): string => JSON.stringify(((st.images as Rec[] | undefined) ?? []).map((im) => (isRec(im) ? [im.id, typeof im.data === 'string' ? im.data.length : 0] : null)));

/** 1.0's state of the open book for the Covenant: the whole book (mentions read every section), its Covenant as
 *  applyBookDoc holds it, the desk's open section active. Set into the closure. */
function build(c: Closure, ydoc: Y.Doc): Session {
  const { book, state } = bookState(c, ydoc);
  const st = state as State & { bible?: unknown; activeId?: unknown };
  const raw = (book as Rec).bible ?? null;
  const rawJson = JSON.stringify(raw);
  // the Covenant object this session wrote last, while the book still holds exactly that: 1.0's references stay good
  if (session && session.ydoc === ydoc && session.wrote !== null && session.wrote === rawJson) st.bible = session.bible;
  else st.bible = c.api.bibleNormalize(stableIds(structuredClone(raw)));
  const sec = desk.active === null ? undefined : st.sections[desk.active];
  st.activeId = sec ? sec.id : null;
  c.vars.editorSyncedSectionId = sec && activeEditor() ? (sec.id as string) : null;
  c.setState(st);
  const s: Session = { ydoc, state: st, ver: verOf(ydoc).n, base: '', images: imagesSig(st), series: seriesSig(st), wrote: session && session.ydoc === ydoc ? session.wrote : null, bible: st.bible };
  s.base = editSig(serialized(c));
  return s;
}

/** 1.0's state of the open book, current (built again only when the book changed or another part of the studio set
 *  its own state into the closure). Null without a book or a closure. */
export function covEnter(): Closure | null {
  const c = closureIfLoaded();
  const ydoc = desk.ydoc;
  if (!c || !ydoc) return null;
  const s = session;
  if (!(s && s.ydoc === ydoc && s.ver === verOf(ydoc).n && c.getState() === s.state)) {
    /* what 1.0 changed in the session so far is written BEFORE the state is built again: a call that sets off another
       (1.0's popover handing the caret back to the editor, whose own code reads the book) must not lose it */
    if (s && s.ydoc === ydoc) covFlush();
    session = build(c, ydoc);
  }
  else {
    // the desk may have moved to another section without a book change
    const sec = desk.active === null ? undefined : s.state.sections[desk.active];
    (s.state as Rec).activeId = sec ? sec.id : null;
    c.vars.editorSyncedSectionId = sec && activeEditor() ? (sec.id as string) : null;
  }
  return c;
}

/** Write what 1.0 changed: the Covenant as serializeBook writes it, and the pictures an import added. */
export function covFlush(): void {
  const c = closureIfLoaded();
  const s = session;
  if (!c || !s) return;
  /* the session's own state is the one 1.0 edited, even if something the call set off (the editor taking focus back:
     the language bar, the word counts) has since set a state of its own into the shared closure */
  if (c.getState() !== s.state) c.setState(s.state);
  const out = serialized(c);
  const json = editSig(out);
  const img = imagesSig(s.state as Rec);
  const ser = seriesSig(s.state as Rec);
  if (json === s.base && img === s.images && ser === s.series) return;
  const y = s.ydoc;
  const write = () => {
    if (ser !== s.series) {
      // the series name, as 1.0's leave / rename set it (blank: the key goes); every other book setting as stored
      const stored = { ...((getMeta(y, 'meta') ?? {}) as Rec) };
      const v = ((s.state as Rec).meta as Rec).series;
      if (typeof v === 'string' && v) stored.series = v;
      else delete stored.series;
      setMeta(y, 'meta', stored as never);
    }
    if (json !== s.base) {
      if (out === undefined) {
        if (y.getMap('meta').has('bible')) setMeta(y, 'bible', undefined);
      } else {
        placeKey(y, 'bible');
        setMeta(y, 'bible', out as never);
      }
    }
  };
  if (img !== s.images) {
    // a picture joined the library: History names pictures, so it is packed again in the same transaction
    repackHistory(c, y, () => {
      write();
      placeKey(y, 'images');
      setMetaValue(y, 'images', (s.state as Rec).images);
    });
    // repackHistory read the book with bookState, which set its own state into the closure: ours stands again
    c.setState(s.state);
  } else y.transact(() => write());
  s.base = json;
  s.images = img;
  s.series = ser;
  s.wrote = JSON.stringify(out ?? null);
  s.bible = (s.state as Rec).bible;
  s.ver = verOf(y).n;
}

/* 1.0's #modalBible is always in its page (open or not); 2.0's room is drawn only while open. A delete's Undo asks
   `$("modalBible").classList.contains("open")` unguarded: while the room is closed, 1.0's `$` finds a closed room. */
const CLOSED_ROOM = Object.freeze({ classList: Object.freeze({ contains: () => false }), querySelector: () => null, getAttribute: () => null });
const page$ = pageEnv.$;
pageEnv.$ = (id: string) => {
  const el = page$(id);
  return el || id !== 'modalBible' ? el : CLOSED_ROOM;
};

/* ---- 1.0's own timers, taken over ---- */
const ours = new Set<unknown>();
type Slot = { get: (c: Closure) => unknown; set: (c: Closure, v: unknown) => void; ms: number; run: ((c: Closure) => void) | null };
const SLOTS: Slot[] = [
  // the room's list and mention count, 260 ms after a matching field changed (bibleTouched)
  { get: (c) => c.api.bibleUi.menTimer, set: (c, v) => (c.api.bibleUi.menTimer = v), ms: 260, run: (c) => (c.api.bibleRenderList(), c.api.bibleRenderMentions()) },
  // 1.0's save 300 ms later: covRun has written already
  { get: (c) => c.api.bibleUi.saveTimer, set: (c, v) => (c.api.bibleUi.saveTimer = v), ms: 300, run: null },
  // the series: the pause after an edit, then the save
  { get: (c) => c.api.bibleSeriesSync.stepTimer, set: (c, v) => (c.api.bibleSeriesSync.stepTimer = v), ms: 300, run: (c) => c.api.bibleSeriesStep() },
  { get: (c) => c.api.bibleSeriesSync.timer, set: (c, v) => (c.api.bibleSeriesSync.timer = v), ms: 2500, run: (c) => void c.api.bibleSeriesSaveNow() },
  // a whole book arrived: which series it reads is settled a moment later (bibleSeriesArrived)
  { get: (c) => c.vars.bibleSeriesArriveTimer, set: (c, v) => (c.vars.bibleSeriesArriveTimer = v), ms: 0, run: (c) => void c.api.bibleSeriesRefresh(false) },
];
function adoptTimers(c: Closure): void {
  for (const slot of SLOTS) {
    const v = slot.get(c);
    if (!v || ours.has(v)) continue;
    clearTimeout(v as number);
    if (!slot.run) {
      slot.set(c, null);
      continue;
    }
    const run = slot.run;
    const id: unknown = setTimeout(() => {
      ours.delete(id);
      if (slot.get(c) === id) slot.set(c, null);
      covRun((cc) => run(cc));
    }, slot.ms);
    ours.add(id);
    slot.set(c, id);
  }
}

/* ---- the toast 1.0's code raises (a delete's Undo), and its calm confirm ---- */
type ToastAction = { label: string; ms?: number; onClick: () => void };
type Toast = (msg: string, icon?: string, action?: ToastAction) => void;
export const covUi: { toast: Toast; confirm: (o: Rec) => Promise<unknown> } = { toast: () => undefined, confirm: async () => false };

let depth = 0;
let kept: { toast: typeof structEnv.toast; edited: typeof writeEnv.noteBookEdited; confirm: typeof writeEnv.confirm } | null = null;
/** The first half of covRun, for 1.0's own listeners and continuations: 1.0's state of the open book stands, its toast,
 *  save and confirm are caught; the returned function (once) writes what changed. Null without a book or a closure. */
export function covBegin(): (() => void) | null {
  const c = covEnter();
  if (!c) return null;
  depth++;
  if (depth === 1) {
    kept = { toast: structEnv.toast, edited: writeEnv.noteBookEdited, confirm: writeEnv.confirm };
    structEnv.toast = (msg, icon, action) => covUi.toast(msg, icon, action ? { ...action, onClick: () => void covRun(() => action.onClick()) } : undefined);
    writeEnv.noteBookEdited = () => undefined; // 1.0's save: covFlush writes when the call returns
    writeEnv.confirm = (o) => Promise.resolve(covUi.confirm(o)).then((r) => (resume(), r));
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (depth === 1) {
      if (kept) {
        structEnv.toast = kept.toast;
        writeEnv.noteBookEdited = kept.edited;
        writeEnv.confirm = kept.confirm;
        kept = null;
      }
      try {
        covFlush();
      } finally {
        adoptTimers(c);
        depth--;
        covEnv.deskSchedule(); // the marks follow what changed (1.0: bibleTouched → bibleDeskSchedule)
      }
      return;
    }
    depth--;
  };
}

/** 1.0's Covenant code on the open book: `fn` runs on 1.0's state of it; what it changed is written when it returns.
 *  Undefined without a book or a closure. */
export function covRun<T>(fn: (c: Closure) => T): T | undefined {
  const end = covBegin();
  if (!end) return undefined;
  try {
    return fn(closureIfLoaded()!);
  } finally {
    end();
  }
}

/** A promise 1.0's code waits on came back (the shelf answered, the writer chose): the book's state stands again for
 *  its continuation (which runs in the microtasks right after), and what it changes is written once it has run. */
let resumeEnd: (() => void) | null = null;
function resume(): void {
  if (resumeEnd) return;
  resumeEnd = covBegin();
  if (!resumeEnd) return;
  setTimeout(() => {
    const end = resumeEnd;
    resumeEnd = null;
    end?.();
  }, 0);
}
/** Wrap a value 1.0's code may wait on (bibleThen): a promise resumes the book's state before 1.0 continues. */
export function resumeOn<T>(v: T): T {
  if (v && typeof (v as { then?: unknown }).then === 'function') return (v as unknown as Promise<unknown>).then((r) => (resume(), r)) as unknown as T;
  return v;
}

/* 1.0's own listeners on the parts it builds in <body> (the card, the change menu and popover): a capture listener on
   the document opens covBegin before 1.0's listener runs, and the event's arrival back at the window closes it (a
   timer closes it too, should 1.0's listener stop the event). */
const HOSTS = ['bibleCard', 'bibleMarkMenu', 'bibleMarkPop'];
let guarded = false;
export function guardHosts(): void {
  if (guarded || typeof document === 'undefined') return;
  guarded = true;
  for (const type of ['click', 'keydown', 'change', 'input', 'mousedown']) {
    let end: (() => void) | null = null;
    document.addEventListener(
      type,
      (e) => {
        const el = e.target as Element | null;
        if (!el || !el.closest || !HOSTS.some((id) => el.closest('#' + id))) return;
        end?.();
        end = covBegin();
        const mine = end;
        // (not a microtask: one runs between this listener and 1.0's own)
        setTimeout(() => {
          if (end === mine) {
            end = null;
            mine?.();
          }
        }, 0);
      },
      true,
    );
    window.addEventListener(type, () => {
      const e2 = end;
      end = null;
      e2?.();
    });
  }
}

/** The entries the open book reads (its own, and a series' when one is loaded), as 1.0 lists them. */
export function covEntries(): BibleEntry[] {
  return covRun((c) => c.api.bibleAllEntries() as BibleEntry[]) ?? [];
}

/** Forget the session (a test, or the book went). */
export function covReset(): void {
  session = null;
}

/** The session's state, for the tests. */
export const covState = (): State | null => session?.state ?? null;

export { covEnv };
