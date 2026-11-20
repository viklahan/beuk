import * as Y from 'yjs';
import { BODY, getMetaValue, LAYOUT, META, packValue, setMetaValue, sectionList } from '@book/editor/index.js';
import { TOP_LEVEL_KEYS } from '@book/schema.js';
import type { Closure, Note, ResearchFile, RsDocReply, RsDocView, State } from '../closure/index';
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
  return sectionList(ydoc).map((s) => {
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
  state.bible = c.api.bibleNormalize(getMetaValue(ydoc, 'bible') ?? null); // applyBookDoc: the Covenant as 1.0 holds it
  // research files can weigh 25 MB: a caller that already read them (they did not change) hands them in
  state.research = research ?? readResearch(c, ydoc);
  const ids = new Set(state.research.files.map((f) => f.id));
  state.notebook = c.api.nbNormalize(stableNoteIds(structuredClone(m.get('notebook') ?? null)), state.sections, ids);
  return state;
}

/** 1.0's applyBookDoc for the research files: rsNormalize(doc.research). */
export function readResearch(c: Closure, ydoc: Y.Doc): { files: ResearchFile[] } {
  return c.api.rsNormalize(getMetaValue(ydoc, 'research') ?? null);
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
  setMetaValue(ydoc, key, value); // research bytes stored once in the picture store, named in `research`
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
  // compared as stored (named), so no file's bytes are read or written for a change that does not touch them
  const cur = ydoc.getMap<unknown>(META).get('research');
  if (JSON.stringify(cur ?? null) === JSON.stringify(packValue(ydoc, rs ?? null, false))) {
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

/** A file read for adding: 1.0's rsAddFiles item, `check` the worker's answer for a Word document or web page. */
export type FileItem = { name: string; type: string; size: number; data: string; check?: RsDocReply };

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
      // BEUK:webword — an old .doc or a Safari archive is told how to save it (1.0's rsRefusalKey)
      refused.push(t(a.rsRefusalKey(it && it.name), { name }));
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
    // BEUK:webword — a Word document or web page is kept only once the worker has opened it (readItems, 1.0's rsAddFiles)
    if ((type === a.RS_WORD || type === a.RS_WEB) && !(it.check && it.check.ok)) {
      refused.push(t(a.rsCheckKey(type, it.check), { name }));
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
    // BEUK:webword — the page's own title and address, the document's title: the note's when it has none
    if (it.check && it.check.title && !n.title) n.title = a.nbLine(a.rsPlainTitle(it.check.title), 120);
    if (it.check && it.check.url && !n.url) {
      const u = a.rsUrl(it.check.url);
      if (u) n.url = u;
    }
  }
  if (added.length && n) {
    if (!n.title) n.title = a.nbLine(added[0]!.name.replace(/\.[^.]+$/, ''), 120);
    n.at = nowIso();
  }
  work();
  return { notes, files, added, refused, note: n };
}

/** 1.0's rsAddFiles, its reading half: each file read (readOne), and a Word document or web page opened in 1.0's worker
 *  (rsDocCheck) before addRead keeps it. */
export async function readItems(c: Closure, list: File[]): Promise<FileItem[]> {
  const a = c.api, items: FileItem[] = [];
  for (const file of list) {
    const it: FileItem = { name: file.name, type: file.type, size: file.size, data: await readOne(c, file) };
    const ty = a.rsTypeOf(file.name, file.type); // BEUK:webword — opened in the worker before it is kept
    if (it.data && (ty === a.RS_WORD || ty === a.RS_WEB)) it.check = await a.rsDocCheck(ty, it.data);
    items.push(it);
  }
  return items;
}

/** 1.0's rsDocFill, its view half (BEUK:webword): the worker's job under 1.0's time limit (rsDocJob), its HTML rebuilt by
 *  1.0's allowlist sanitizer (rsSanitize), the note and the fidelity line (rsFidelity), kept in 1.0's small view cache
 *  (rsDocW.cache, six views). 1.0 then writes the view into its slot (document.querySelector); 2.0's RsDoc
 *  (NotebookDialog.tsx) draws it. Nothing the worker hands back is ever inserted as it came: only rsSanitize's nodes. */
export async function docView(c: Closure, f: ResearchFile): Promise<RsDocView> {
  const a = c.api;
  const key = f.id + ':' + f.data.length;
  let view = a.rsDocW.cache.get(key);
  if (view) return view;
  const word = f.mediaType === a.RS_WORD;
  const r = await a.rsDocJob(word ? 'view-word' : 'view-web', f.data);
  if (!r || !r.ok) view = { error: r && r.reason === 'timeout' ? 'rs.docBig' : 'rs.docFail' };
  else {
    const s = a.rsSanitize(r.html, { images: r.images || {}, base: a.rsUrl(r.url) || '' });
    if (s.empty) view = { error: 'rs.docEmpty' };
    else {
      const v: Exclude<RsDocView, { error: string }> = { node: s.node, cut: !!(s.cut || r.cut), note: word ? 'rs.wordNote' : 'rs.webNote', gone: s.gone, shownChars: s.shownChars, expectChars: 0, fidelity: { text: '', whole: false } };
      if (word && r.stats) {
        // a Word file is counted from its own XML; the footnote numbers mammoth writes ("[1]") are Word's own numbering
        let refDigits = 0;
        for (let i = 1; i <= r.stats.refs; i++) refDigits += String(i).length; // once, in the text: the list numbers itself
        Object.assign(v, { expectChars: r.stats.chars + refDigits, headers: r.stats.headers, comments: r.stats.comments, deleted: r.stats.deleted });
      } else v.expectChars = s.srcChars;
      if (v.cut) v.expectChars = v.shownChars + (s.gone.chars || 0); // what was cut is already said (rs.docCut)
      v.fidelity = a.rsFidelity(v);
      view = v;
    }
  }
  a.rsDocW.cache.set(key, view);
  if (a.rsDocW.cache.size > 6) a.rsDocW.cache.delete(a.rsDocW.cache.keys().next().value!);
  return view;
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
