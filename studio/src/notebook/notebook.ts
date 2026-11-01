import * as Y from 'yjs';
import { BODY, LAYOUT, META, SECTIONS } from '@book/editor/index.js';
import { TOP_LEVEL_KEYS } from '@book/schema.js';
import type { Closure, Note, ResearchFile, State } from '../closure/index';
import { repackHistory } from '../history/history';

/* The book's Notebook and its research files (inventory C7, 1.0's
   BEUK:notebook and BEUK:research), the data side.

   Where 1.0 keeps them (constraint 10, mirrored exactly): IN THE BOOK, as
   two top-level keys —
     notebook: { notes: [{ id, title, body, folder?, secs?, files?, url?, at? }] }
     research: { files: [{ id, name, mediaType, data (base64), bytes, at? }] }
   serializeBook writes `notebook` only when there is a note (nbPack: 1.0's
   nbNormalize against the book's sections and files) and `research` only
   when a note names a file, each named file once (rsPackFiles). They are
   held in the Y `meta` map as those two values; no file bytes go anywhere
   else (never into `meta`'s book settings, never into a separate store).
   1.0's History names the research files the way it names pictures
   (histPack), so a write that changes the files written goes through
   repackHistory (wave 1a ruling 2), in the same transaction.

   Reading is 1.0's applyBookDoc: rsNormalize(research), then
   nbNormalize(notebook, sections, file ids). Opening and browsing write
   nothing. Every rule (limits, kinds, the link's scheme filter, the
   normalisers, the packed forms) is 1.0's own, from the closure; the
   mutations (1.0's nbNew, nbDelete, nbPin, nbUnpin, rsAddRead, rsRemove and
   the field handlers) are ported here as plain data changes. */

type Rec = Record<string, unknown>;
export type NbState = State & { notebook: { notes: Note[] }; research: { files: ResearchFile[] } };

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const NOTE_ID = /^[\w-]{1,64}$/;

/** The sections as 1.0's notebook reads them (ids, kinds, types, numbers, titles): every field but the text. */
export function lightSections(ydoc: Y.Doc): Rec[] {
  return ydoc.getArray<unknown>(SECTIONS).toArray().map((s) => {
    const o: Rec = {};
    if (!(s instanceof Y.Map)) return o;
    for (const [k, v] of s.entries()) {
      if (k === BODY) continue;
      const key = k.startsWith('~') ? k.slice(1) : k; // model.ts escKey
      if (key !== '__proto__') o[key] = v instanceof Y.AbstractType ? v.toJSON() : structuredClone(v);
    }
    return o;
  });
}

/** A note stored without a valid id gets its place in the list as one ("nb-<n>", made unique) before 1.0's nbNormalize
 *  would mint a random one on every read; written to the book only at the next notebook write (as History's ids). */
function stableNoteIds(doc: unknown): unknown {
  if (!isRec(doc) || !Array.isArray(doc.notes)) return doc;
  const taken = new Set(doc.notes.map((n) => (isRec(n) && typeof n.id === 'string' ? n.id : '')));
  const seen = new Set<string>();
  const notes = doc.notes.map((n, i) => {
    if (!isRec(n)) return n;
    if (typeof n.id === 'string' && NOTE_ID.test(n.id) && !seen.has(n.id)) {
      seen.add(n.id);
      return n;
    }
    let id = 'nb-' + (i + 1), k = 1;
    while (taken.has(id) || seen.has(id)) id = 'nb-' + (i + 1) + '-' + ++k;
    seen.add(id);
    return { ...n, id };
  });
  return { ...doc, notes };
}

/** 1.0's state for the notebook: the book's settings, sections (no text), Covenant, and the notebook and research files
 *  as applyBookDoc reads them. Set as the closure's state. */
export function nbState(c: Closure, ydoc: Y.Doc, research?: { files: ResearchFile[] }): NbState {
  const m = ydoc.getMap<unknown>(META);
  const meta = (isRec(m.get('meta')) ? structuredClone(m.get('meta')) : {}) as Rec;
  const state = { meta, sections: lightSections(ydoc) } as unknown as NbState;
  c.setState(state);
  state.bible = c.api.bibleNormalize(structuredClone(m.get('bible') ?? null)); // applyBookDoc: the Covenant as 1.0 holds it
  // research files can weigh 25 MB: a caller that already read them (they did not change) hands them in
  state.research = research ?? readResearch(c, ydoc);
  const ids = new Set(state.research.files.map((f) => f.id));
  state.notebook = c.api.nbNormalize(stableNoteIds(structuredClone(m.get('notebook') ?? null)), state.sections, ids);
  return state;
}

/** 1.0's applyBookDoc for the research files: rsNormalize(doc.research). */
export function readResearch(c: Closure, ydoc: Y.Doc): { files: ResearchFile[] } {
  return c.api.rsNormalize(structuredClone(ydoc.getMap<unknown>(META).get('research') ?? null));
}

/** Put a top-level key into the book's key order where 1.0's serializeBook writes it (TOP_LEVEL_KEYS), if it is new. */
export function placeKey(ydoc: Y.Doc, key: string): void {
  const layout = ydoc.getMap<unknown>(LAYOUT);
  const order = layout.get('keys');
  if (!Array.isArray(order) || order.includes(key)) return;
  const canon = TOP_LEVEL_KEYS as readonly string[];
  const at = canon.indexOf(key);
  let pos = order.length;
  if (at >= 0) {
    // after the nearest key 1.0 writes before it that the book has; else before the nearest it writes after it
    const before = canon.slice(0, at).reverse().find((k) => order.includes(k));
    const after = canon.slice(at + 1).find((k) => order.includes(k));
    if (before) pos = order.indexOf(before) + 1;
    else if (after) pos = order.indexOf(after);
  }
  const next = order.slice();
  next.splice(pos, 0, key);
  layout.set('keys', next);
}

function setKey(ydoc: Y.Doc, key: 'notebook' | 'research', value: unknown): void {
  const m = ydoc.getMap<unknown>(META);
  if (value === undefined) {
    if (m.has(key)) m.delete(key);
    return;
  }
  placeKey(ydoc, key);
  m.set(key, structuredClone(value));
}

/** What 1.0's serializeBook writes for these notes and files: [notebook | undefined, research | undefined]. */
export function packed(c: Closure, state: NbState): [unknown, unknown] {
  c.setState(state);
  const nb = c.api.nbHas() ? c.api.nbPack() : undefined;
  const rs = c.api.rsHas() ? { files: c.api.rsPackFiles() } : undefined;
  return [nb, rs];
}

/** Write the notebook as 1.0 saves it. When the research files it writes change, History is repacked in the same
 *  transaction (its snapshots name the files). */
export function writeNotebook(c: Closure, ydoc: Y.Doc, notes: Note[], files: ResearchFile[]): void {
  const state = nbState(c, ydoc);
  state.notebook = { notes };
  state.research = { files };
  const [nb, rs] = packed(c, state);
  const cur = ydoc.getMap<unknown>(META).get('research');
  if (JSON.stringify(cur ?? null) === JSON.stringify(rs ?? null)) {
    ydoc.transact(() => setKey(ydoc, 'notebook', nb));
    return;
  }
  repackHistory(c, ydoc, () => {
    setKey(ydoc, 'notebook', nb);
    setKey(ydoc, 'research', rs);
  });
}

/** A change to the notes alone (their text, folder, link, pins, a new empty note — never which files they name): the
 *  notebook written as 1.0's nbPack writes it (nbNormalize against the sections and the files the book holds), the
 *  research files untouched. */
export function writeNotes(c: Closure, ydoc: Y.Doc, state: NbState, notes: Note[]): void {
  c.setState(state);
  const ids = new Set(state.research.files.map((f) => f.id));
  const nb = notes.length ? JSON.parse(JSON.stringify(c.api.nbNormalize({ notes }, state.sections, ids))) : undefined;
  ydoc.transact(() => setKey(ydoc, 'notebook', nb));
}

export const nowIso = () => new Date().toISOString();

/* ---- research files: 1.0's reading and adding (rsReadOne, rsAddRead) ---- */

export type FileItem = { name: string; type: string; size: number; data: string };

/** 1.0's rsReadOne: the file as base64, or "" when it is refused anyway (too big, a kind not kept) or unreadable. */
export function readOne(c: Closure, file: File): Promise<string> {
  return new Promise((res) => {
    if (!file || file.size > c.api.rsLimits().file || !c.api.rsTypeOf(file.name, file.type)) return res('');
    const r = new FileReader();
    r.onload = () => {
      const u = String(r.result || ''), i = u.indexOf(',');
      res(i < 0 ? '' : u.slice(i + 1));
    };
    r.onerror = () => res('');
    r.readAsDataURL(file);
  });
}

export type AddResult = { notes: Note[]; files: ResearchFile[]; added: ResearchFile[]; refused: string[]; note: Note | null };

/** 1.0's rsAddRead over (notes, files): checked, then kept on the note (a new note when there is none). Pure: the caller
 *  writes the result. */
export function addRead(c: Closure, state: NbState, noteId: string | null, items: FileItem[], t: (k: string, p?: Rec) => string): AddResult {
  const a = c.api, L = a.rsLimits();
  const notes = state.notebook.notes.map((n) => ({ ...n }));
  const files = state.research.files.slice();
  const added: ResearchFile[] = [], refused: string[] = [];
  let n: Note | null = notes.find((x) => x.id === noteId) ?? null;
  const work = () => {
    state.notebook = { notes };
    state.research = { files };
    c.setState(state);
  };
  for (const it of items) {
    work();
    const name = a.nbLine(it && it.name, 160) || 'file';
    const type = a.rsTypeOf(it && it.name, it && it.type);
    if (!type) {
      refused.push(t('rs.badType', { name }));
      continue;
    }
    if (it.size > L.file) {
      refused.push(t('rs.tooBig', { name, mb: a.fmtNum(L.file / 1024 / 1024) }));
      continue;
    }
    if (!(it.size > 0) || typeof it.data !== 'string' || !it.data) {
      refused.push(t('rs.readFail', { name }));
      continue;
    }
    if (a.rsTotal() + it.size > L.total || a.rsNamed().size >= L.files) {
      refused.push(t('rs.full', { name, mb: a.fmtNum(L.total / 1024 / 1024) }));
      continue;
    }
    if (!n) {
      n = { id: a.uid(), title: '', body: '' };
      notes.unshift(n);
    }
    if ((n.files || []).length >= L.perNote) {
      refused.push(t('rs.noteFull', { name, n: a.fmtNum(L.perNote) }));
      continue;
    }
    const f: ResearchFile = { id: a.uid(), name, mediaType: type, data: it.data, bytes: a.rsBytesOf(it.data), at: nowIso() };
    files.push(f);
    n.files = (n.files || []).concat([f.id]);
    added.push(f);
  }
  if (added.length && n) {
    if (!n.title) n.title = a.nbLine(added[0]!.name.replace(/\.[^.]+$/, ''), 120);
    n.at = nowIso();
  }
  work();
  return { notes, files, added, refused, note: n };
}

/** 1.0's rsBytes: the file's bytes. */
export function bytesOf(f: ResearchFile): Uint8Array<ArrayBuffer> {
  const bin = atob(f.data), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
/** 1.0's rsText. */
export function textOf(f: ResearchFile): string {
  try {
    return new TextDecoder('utf-8').decode(bytesOf(f));
  } catch {
    return '';
  }
}

/** 1.0's fmtDateIntl (it reads uiLangState, which the closure may not lift). */
export function fmtDateIntl(d: Date, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** 1.0's nbNames: the Covenant's names found in a note (the Covenant's own matcher), most mentioned first. */
export function namesIn(c: Closure, state: NbState, text: string): { id: string; name: string; n: number }[] {
  c.setState(state);
  const a = c.api;
  const ents = a.bibleAllEntries();
  if (!ents.length || !String(text || '').trim()) return [];
  const per: Record<string, number> = {};
  a.bibleScan(String(text), a.bibleMatcherNow()).hits.forEach((h) => (per[h.id] = (per[h.id] || 0) + 1));
  return ents.filter((e) => per[e.id]).map((e) => ({ id: e.id, name: a.bibleName(e), n: per[e.id]! })).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
}
