import type * as Y from 'yjs';
import { exportBook } from '@book/editor/index.js';
import { stateFromBook, type Closure, type OlBook, type OlField, type OlThread, type State } from '../closure/index';
import { runOnBook, type RunResult, type StructToast } from '../structure/structure';

/* BEUK:outline — the outline board's data (inventory B5): what 1.0's
   olRender draws, computed by 1.0's own functions (client/index.html
   olItems, olMatches, olNumLabel, olName, olScenes, olKindBounds,
   olStatusLabel, olSavedMatches, olGridSecs, olGridEntries, sectionWords,
   castSecLabel, the Covenant's count bibleMentionsCompute), on 1.0's state
   of the book with state.outline normalised as 1.0's applyBookDoc does
   (olNormalize). 1.0's view object olUi is set from the board's own state
   before each read, so the filter is 1.0's (status: any picked; tags: every
   picked). Reading never writes the book (the no-edit gate).

   The view's own state is per device, never in the book: beuk.outline.v1
   holds { view, matter } in 1.0's shape (constraint 18). */

type Rec = Record<string, unknown>;
export type View = 'cards' | 'list' | 'grid';
export type BoardUi = { view: View; matter: boolean; status: string[]; tags: string[]; savedId: string | null; tagsOpen: boolean; fieldsOpen: boolean };

export const PREFS_KEY = 'beuk.outline.v1';
/** 1.0's reading of beuk.outline.v1 (a bad or missing record: Cards, story only). */
export function readPrefs(): { view: View; matter: boolean } {
  const out: { view: View; matter: boolean } = { view: 'cards', matter: false };
  try {
    const raw = window.localStorage && localStorage.getItem(PREFS_KEY);
    const v = raw ? (JSON.parse(raw) as Rec | null) : null;
    if (v && (v.view === 'list' || v.view === 'grid')) out.view = v.view;
    if (v && v.matter === true) out.matter = true;
  } catch {
    /* storage unavailable: the defaults */
  }
  return out;
}
/** 1.0's olSavePrefs. */
export function savePrefs(ui: { view: View; matter: boolean }): void {
  try {
    if (window.localStorage) localStorage.setItem(PREFS_KEY, JSON.stringify({ view: ui.view, matter: ui.matter }));
  } catch {
    /* storage unavailable: the view stays for this page only */
  }
}

/** 1.0's state of the book for the board: ARRIVE's, with state.outline normalised (applyBookDoc's line). */
export function boardState(c: Closure, ydoc: Y.Doc): State {
  const book = exportBook(ydoc);
  const st = stateFromBook(c, book);
  st.outline = c.api.olNormalize(book.outline, st.sections);
  return st;
}

/** Put the board's view state into 1.0's olUi (1.0's own filter reads it). */
export function setOlUi(c: Closure, ui: BoardUi): void {
  Object.assign(c.api.olUi, { view: ui.view, matter: ui.matter, status: ui.status.slice(), tags: ui.tags.slice(), savedId: ui.savedId });
}

export type Item = {
  id: string; kind: string; type: string; isPart: boolean; title: string; included: boolean; status: string;
  synopsis: string; pov: string; tags: { name: string; colour: number }[]; custom: Rec; threads: Rec;
  num: string; name: string; words: number; scenes: number; meta: string; first: boolean; last: boolean; pos: number; total: number; matches: boolean; label: string;
};
export type GridCell = { n: number; level: number };
export type GridView = {
  threads: OlThread[]; fields: OlField[]; empty: boolean; noSecs: boolean; noRows: boolean;
  entries: { id: string; name: string; typeLabel: string; total: number }[];
  rows: { item: Item; cells: GridCell[] }[];
  totals: { fields: number[]; threads: number[]; entries: number[] };
};
export type BoardView = {
  ob: OlBook; ui: BoardUi; items: Item[]; countable: number; shown: number; hidden: number; filterOn: boolean;
  groups: { kind: string; items: Item[]; real: number; anyMatch: boolean }[];
  savedOn: Record<string, boolean>; canSave: boolean; tagUses: Record<string, number>; fieldUses: Record<string, number>;
  grid: GridView | null; hits: Record<string, { sec: string; s: number; e: number }[]>;
};

/** Everything olRender draws, from 1.0's functions. `ui` is sanitised as olRender does (unknown tags and a vanished
 *  saved filter dropped): the returned ui is what the board must show. */
export function boardView(c: Closure, st: State, ui0: BoardUi, t: (k: string, p?: Record<string, unknown>) => string): BoardView {
  c.setState(st);
  const ob = c.api.olBook();
  const known = new Set(ob.tags.map((x) => c.api.olTagKey(x.name)));
  const ui: BoardUi = { ...ui0, tags: ui0.tags.filter((n) => known.has(c.api.olTagKey(n))), savedId: ui0.savedId && ob.filters.some((f) => f.id === ui0.savedId) ? ui0.savedId : null };
  setOlUi(c, ui);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const item = (s: Rec): Item => {
    const b = c.api.olKindBounds(s);
    const words = c.api.sectionWords(s), scenes = c.api.olScenes(s);
    const tags = (Array.isArray(s.tags) ? (s.tags as string[]) : []).map((n) => ({ name: n, colour: c.api.olTagOf(n)?.colour ?? 0 }));
    return {
      id: String(s.id), kind: str(s.kind), type: str(s.type), isPart: s.type === 'part', title: str(s.title), included: !!s.included,
      status: c.api.OL_STATUSES.includes(str(s.status)) ? str(s.status) : '', synopsis: str(s.synopsis), pov: str(s.pov), tags,
      custom: (s.custom as Rec) || {}, threads: (s.threads as Rec) || {}, num: c.api.olNumLabel(s), name: c.api.olName(s), words, scenes,
      meta: c.api.fmtNum(words) + ' ' + t('side.wordUnit', { count: words }) + (scenes > 1 ? ' · ' + t('ol.scenes', { n: c.api.fmtNum(scenes) }) : ''),
      first: b.first, last: b.last, pos: b.pos, total: b.total, matches: c.api.olMatches(s), label: c.api.castSecLabel(s),
    };
  };
  const list = c.api.olItems().map(item);
  const grid = ui.view === 'grid';
  const countableSecs = grid ? c.api.olGridSecs() : c.api.olItems().filter((s) => s.type !== 'part');
  const shown = countableSecs.filter((s) => c.api.olMatches(s)).length;
  const groups = (['front', 'body', 'back'] as const).map((kind) => {
    const gi = list.filter((x) => x.kind === kind);
    const real = gi.filter((x) => !x.isPart);
    return { kind, items: gi.filter((x) => x.matches), real: real.length, anyMatch: real.some((x) => x.matches), all: gi.length };
  }).filter((g) => g.all > 0);
  const savedOn: Record<string, boolean> = {};
  for (const f of ob.filters) savedOn[f.id] = ui.savedId === f.id && c.api.olSavedMatches(f);
  const filterOn = c.api.olFilterOn();
  const tagUses: Record<string, number> = {};
  for (const tg of ob.tags) tagUses[tg.name] = st.sections.filter((s) => ((s.tags as string[]) || []).some((n) => c.api.olTagKey(n) === c.api.olTagKey(tg.name))).length;
  const fieldUses: Record<string, number> = {};
  for (const f of ob.fields) fieldUses[f.id] = st.sections.filter((s) => s.custom && (s.custom as Rec)[f.id] != null).length;
  const hits: BoardView['hits'] = {};
  let gv: GridView | null = null;
  if (grid) {
    const ents = c.api.bibleAllEntries();
    const secs = c.api.olGridSecs();
    const rowsS = secs.filter((s) => c.api.olMatches(s));
    gv = { threads: ob.threads, fields: ob.fields, empty: !ents.length && !ob.threads.length && !ob.fields.length, noSecs: !secs.length, noRows: !rowsS.length, entries: [], rows: [], totals: { fields: [], threads: [], entries: [] } };
    if (!gv.empty && !gv.noSecs && !gv.noRows) {
      const men = ents.length ? c.api.bibleMentionsCompute(st.sections, ents, c.api.bookLang()) : { cols: [], per: {} };
      const ci: Record<string, number> = {};
      men.cols.forEach((col, i) => { ci[col.id] = i; });
      const order = ents.length ? c.api.olGridEntries(men.per) : [];
      const zero = { total: 0, counts: [] as number[], hits: [] as { sec: string; s: number; e: number }[] };
      const max: Record<string, number> = {};
      order.forEach((e) => { max[String(e.id)] = Math.max(1, ...(men.per[String(e.id)] || zero).counts); });
      gv.entries = order.map((e) => ({ id: String(e.id), name: c.api.bibleName(e), typeLabel: c.api.bibleTypeLabel(String(e.type)), total: (men.per[String(e.id)] || zero).total }));
      for (const e of order) hits[String(e.id)] = (men.per[String(e.id)] || zero).hits;
      const steps = c.api.CAST_STEPS;
      gv.rows = rowsS.map((s) => {
        const i = ci[String(s.id)];
        return {
          item: item(s),
          cells: order.map((e) => {
            const n = i == null ? 0 : (men.per[String(e.id)] || zero).counts[i] || 0;
            return { n, level: n ? steps[Math.min(steps.length - 1, Math.floor((n / max[String(e.id)]!) * (steps.length - 1e-9)))]! : 0 };
          }),
        };
      });
      gv.totals = {
        fields: ob.fields.map((f) => secs.filter((s) => s.custom && (s.custom as Rec)[f.id] != null).length),
        threads: ob.threads.map((th) => secs.filter((s) => s.threads && (s.threads as Rec)[th.id]).length),
        entries: order.map((e) => (men.per[String(e.id)] || zero).total),
      };
    }
  }
  return {
    ob, ui, items: list, countable: countableSecs.length, shown, hidden: countableSecs.length - shown, filterOn,
    groups: groups.map(({ kind, items, real, anyMatch }) => ({ kind, items, real, anyMatch })), savedOn,
    canSave: filterOn && !ob.filters.some((f) => c.api.olSavedMatches(f)), tagUses, fieldUses, grid: gv, hits,
  };
}

/** Run one of 1.0's board edits on the book at the moment it is called (olUi set from `ui` first), then read back
 *  what 1.0 left in olUi (olSaveFilter sets savedId; olDeleteTag drops the tag from the filter). */
export function boardEdit<R>(c: Closure, ydoc: Y.Doc, ui: BoardUi, fn: (st: State) => R, toast?: StructToast): RunResult<R> & { ui: BoardUi } {
  const r = runOnBook(
    c,
    ydoc,
    (st) => {
      setOlUi(c, ui);
      return fn(st);
    },
    { outline: true, toast },
  );
  const o = c.api.olUi;
  return { ...r, ui: { ...ui, status: o.status.slice(), tags: o.tags.slice(), savedId: o.savedId } };
}

/** The section with this id in 1.0's state (inside a boardEdit). */
export const secIn = (st: State, id: string): Rec | undefined => st.sections.find((s) => s.id === id);
