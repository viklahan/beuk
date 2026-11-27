import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { ySyncPluginKey, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { applyRemoteUpdate } from '../src/editor/rescueCore';
import type { RescueReport } from '../src/editor/rescueEditor';
import { rescueNotice } from '../src/editor/rescueNotice';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { posOf } from './caret-pair';

/* Telling the writer (Agora Part 0, item 9; V's ruling): when letters they typed could not be put back, the
   studio says so once, quietly (an 'Info' toast), with the exact count. Nothing lost, nothing said.
   - the two keys in all 15 packs, English's placeholder byte for byte, the 14 drafts on the sign-off list;
   - rescueNotice: null for nothing lost (an `uncounted` share has no exact count, so it says nothing), the
     singular for one, the Plural twin otherwise;
   - through the whole app: the C1 shape (the other tab saw "n" and deleted its paragraph: vetoed) through
     applyRemoteUpdate on the open chapter gives exactly one toast. The studio's own whole paragraph deleted
     outright by the other tab gives none: "own" includes the book this session opened, so it cannot be told as
     "letters you typed" (ruling R6b).
   The English is the brief's, exact (task-6-brief.md, Step 1). */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
// DERIVED: task-6-brief.md Step 1 (the English strings, exact) with {n} filled by translate.ts's Plural rule
const ONE = '1 letter you typed went with a change made in another tab, and could not be put back.';
const THREE = '3 letters you typed went with a change made in another tab, and could not be put back.';
const KEYS = ['rescue.lost', 'rescue.lostPlural'];

const report = (c: Partial<RescueReport>): RescueReport => ({
  rescued: 0,
  moved: 0,
  restored: 0,
  carried: 0,
  vetoed: 0,
  unplaced: 0,
  unknown: 0,
  uncounted: 0,
  stayed: 0,
  caret: false,
  ms: 0,
  ...c,
});

describe('its words in every language', () => {
  const dir = path.resolve(__dirname, '../src/generated/packs');
  const packs = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Record<string, string>]));
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');

  it("two keys in each of the 15 packs, with English's placeholder, none empty, none still English, no exclamation mark", () => {
    expect(Object.keys(E).filter((k) => k.startsWith('rescue.'))).toEqual(KEYS);
    expect(E['rescue.lost']).toBe('{n} letter you typed went with a change made in another tab, and could not be put back.');
    expect(E['rescue.lostPlural']).toBe('{n} letters you typed went with a change made in another tab, and could not be put back.');
    expect(Object.keys(packs).length).toBe(15);
    for (const [lang, pack] of Object.entries(packs)) {
      for (const k of KEYS) {
        expect(typeof pack[k] === 'string' && pack[k]!.trim().length > 0, `${lang} ${k}`).toBe(true);
        expect(holes(pack[k]!), `${lang} ${k}`).toBe('{n}');
        expect(pack[k]!.split('{n}').length - 1, `${lang} ${k}: {n} once`).toBe(1);
        expect(/[!！]/.test(pack[k]!), `${lang} ${k}`).toBe(false);
        if (lang !== 'en') expect(pack[k], `${lang} ${k} is still the English`).not.toBe(E[k]);
      }
    }
  });

  it('docs/strings-pending-signoff.md lists both keys and every draft, and approves none', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../docs/strings-pending-signoff.md'), 'utf8');
    expect(doc.toLowerCase()).toContain('not approved');
    for (const k of KEYS) expect(doc, k).toContain('### `' + k + '`');
    for (const [lang, pack] of Object.entries(packs)) {
      if (lang === 'en') continue;
      for (const k of KEYS) expect(doc, `${lang} ${k}`).toContain('`' + pack[k] + '`');
    }
  });
});

describe('rescueNotice', () => {
  it('rescueNotice: nothing lost → null; 1 → the singular; 3 → the plural (English)', () => {
    expect(rescueNotice(report({ vetoed: 0, unplaced: 0, uncounted: 4 }), t)).toBeNull();
    expect(rescueNotice(report({ vetoed: 1 }), t)).toBe(ONE);
    expect(rescueNotice(report({ vetoed: 2, unplaced: 1 }), t)).toBe(THREE);
    // DERIVED (lettersLost = vetoed + unplaced): what was put back, moved, carried or stayed is not lost
    expect(rescueNotice(report({ rescued: 5, moved: 2, restored: 3, carried: 1, stayed: 2, unknown: 1 }), t)).toBeNull();
  });
});

// ---- through the whole app (openStudio as toolbar-ui.test.tsx:58-75) ----------------------------------------

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

// C1: the chapter holds only the opening line, and the paragraph the studio types into is written by the other tab,
// so its words are another writer's, as in keystroke-rescue-controls.test.ts. OWN: the paragraph is imported in this
// studio, so all its letters are the studio's own (ruling R6b's case).
const BOOK: Rec = {
  meta: { title: 'Rescue Book', author: 'A. Writer', language: 'en' },
  sections: [{ id: 's1', kind: 'body', type: 'chapter', title: 'One', content: 'Opening line above.' }],
};
const OWN_BOOK: Rec = {
  meta: { title: 'Rescue Book', author: 'A. Writer', language: 'en' },
  sections: [{ id: 's1', kind: 'body', type: 'chapter', title: 'One', content: 'Opening line above.\n\nThe brown fox jumps over the dog.' }],
};
const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
async function openStudio(book: Rec) {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const editor = () => (document.getElementById('manuscript') as HTMLElement & { beukEditor?: Editor }).beukEditor!;
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
const OTHER_TAB = Symbol('the other tab');

/** The open studio and a second tab: a Y.Doc with its own client id holding the studio's book. The other tab's own
 *  updates go to the studio through applyRemoteUpdate, as the store applies another tab's (store.ts). */
async function studioAndOtherTab(book: Rec) {
  await openStudio(book);
  const ed = editor();
  const b = (ySyncPluginKey.getState(ed.state) as { binding: ProsemirrorBinding }).binding;
  const doc = b.doc;
  const frag = b.type as Y.XmlFragment;
  expect(frag.doc).toBe(doc);
  const other = new Y.Doc();
  other.clientID = doc.clientID === 7 ? 8 : 7;
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc), OTHER_TAB);
  const fragOther = ((Y.getItem(other.store, frag._item!.id) as Y.Item).content as Y.ContentType).type as Y.XmlFragment;
  const sent: Uint8Array[] = [];
  other.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== OTHER_TAB) sent.push(u);
  });
  return {
    ed,
    other,
    fragOther,
    rescue: () => (ed.storage as unknown as { caretKeeper: { rescue: RescueReport | null } }).caretKeeper.rescue,
    /** the other tab's one update, into the studio */
    send: async () => {
      expect(sent.length).toBe(1);
      const u = sent.shift()!;
      await act(async () => {
        applyRemoteUpdate(doc, u, OTHER_TAB);
      });
    },
    /** the studio types "n" at "bro|wn"; the other tab receives it (it has seen the "n") */
    typeN: () => {
      act(() => {
        ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, posOf(ed, 'brown', 3))));
        ed.view.dispatch(ed.state.tr.insertText('n'));
      });
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)), OTHER_TAB);
      const i = (fragOther.toArray() as Y.XmlElement[]).findIndex((k) => k.toString().includes('bronwn'));
      expect(i).toBe(1);
      return i;
    },
  };
}
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe('the studio tells the writer', () => {
  it('the studio says it once, as a toast: the C1 shape through applyRemoteUpdate on the open chapter', async () => {
    const g = await studioAndOtherTab(BOOK);

    // the other tab writes the paragraph (a paragraph like the opening one); the studio receives it
    const first = g.fragOther.get(0) as Y.XmlElement;
    g.other.transact(() => {
      const para = new Y.XmlElement(first.nodeName);
      for (const [k, v] of Object.entries(first.getAttributes())) para.setAttribute(k, v as string);
      const words = new Y.XmlText();
      words.insert(0, 'The brown fox jumps over the dog.');
      para.insert(0, [words]);
      g.fragOther.insert(1, [para]);
    });
    await g.send();
    expect(g.ed.state.doc.textContent).toBe('Opening line above.The brown fox jumps over the dog.');
    expect(g.rescue()).toBeNull(); // a change that deleted nothing: no report

    const i = g.typeN();
    const before = toasts(); // what the studio said before (the backup's own "opened" toast)
    const said = () => toasts().filter((x) => !before.includes(x));
    expect(g.rescue()).toBeNull();

    // the other tab deletes that paragraph, having seen the "n"
    g.other.transact(() => g.fragOther.delete(i, 1));
    await g.send();
    expect(g.ed.state.doc.textContent).toBe('Opening line above.');
    // DERIVED: keystroke-rescue-controls.test.ts:43 (C1: vetoed 1, rescued 0, restored 0)
    expect(g.rescue()).toMatchObject({ vetoed: 1, unplaced: 0, uncounted: 0, rescued: 0, restored: 0 });
    await settle();
    expect(said()).toEqual([ONE]);
  });

  it("the studio's own whole paragraph, deleted outright by the other tab: a report, and no toast", async () => {
    const g = await studioAndOtherTab(OWN_BOOK);
    const i = g.typeN();
    const before = toasts();
    const said = () => toasts().filter((x) => !before.includes(x));
    g.other.transact(() => g.fragOther.delete(i, 1));
    await g.send();
    expect(g.ed.state.doc.textContent).toBe('Opening line above.');
    // DERIVED: ruling R6b (all-own paragraph deleted outright → silent; premise corrected by R6c: only an import
    // writes a whole book under this session's id, a reopened book keeps its original client ids).
    // "The bronwn fox jumps over the dog." is 34 letters, every one the studio's own (the probe's count)
    const n = [...'The bronwn fox jumps over the dog.'].length;
    expect(n).toBe(34);
    expect(g.rescue()).toMatchObject({ vetoed: 0, unplaced: 0, uncounted: n, rescued: 0, restored: 0 });
    await settle();
    expect(said()).toEqual([]);
  });
});
