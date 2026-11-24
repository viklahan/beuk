import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook, sectionList } from '../../src/book/editor/index';
import { loadClosure, stateFromBook, type Closure } from '../src/closure/index';
import { fixtures } from './fixtures';

/* BEUK:poemmode — Poem Mode's data model, at 1.0's own door (normalizeSection,
   which every book passes on its way to a preview, an export or a save) and
   through 2.0's book (the Y.Doc and back).

   Two optional fields on a section: mode "verse" (a poem; absent reads as
   prose) and verseAlign "left" (absent reads as centred). Each is stored
   only as that one value. A book made before them gains neither, and no
   text is touched by either. */

type Rec = Record<string, unknown>;
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
});

const base = (extra: Rec): Rec => ({ id: 'sPoem001', kind: 'body', type: 'chapter', title: 'A poem', content: 'One line\nand another\n\nA new stanza', ...extra });

describe('Poem Mode: the data model', () => {
  it('normalizeSection keeps mode only as "verse" and verseAlign only as "left"', () => {
    const n = (extra: Rec) => c.api.normalizeSection(base(extra)) as Rec;
    expect(n({ mode: 'verse' }).mode).toBe('verse');
    expect('verseAlign' in n({ mode: 'verse' })).toBe(false);
    expect(n({ mode: 'verse', verseAlign: 'left' })).toMatchObject({ mode: 'verse', verseAlign: 'left' });
    // Poem Mode switched off: the alignment the writer chose is remembered
    expect(n({ verseAlign: 'left' }).verseAlign).toBe('left');
    expect('mode' in n({ verseAlign: 'left' })).toBe(false);
    for (const bad of ['prose', 'poem', 'VERSE', '', true, 1, null, ['verse'], { v: 'verse' }]) expect('mode' in n({ mode: bad })).toBe(false);
    for (const bad of ['center', 'centre', 'right', 'LEFT', '', true, 0, null]) expect('verseAlign' in n({ mode: 'verse', verseAlign: bad })).toBe(false);
  });

  it('a section without the fields gains neither, and its text is the text it had', () => {
    const plain = c.api.normalizeSection(base({})) as Rec;
    expect('mode' in plain).toBe(false);
    expect('verseAlign' in plain).toBe(false);
    for (const extra of [{}, { mode: 'verse' }, { mode: 'verse', verseAlign: 'left' }, { mode: 'prose' }]) {
      expect((c.api.normalizeSection(base(extra)) as Rec).content).toBe('One line\nand another\n\nA new stanza');
    }
  });

  it('every fixture book reads as prose: no section of 1.0\'s state carries either field', () => {
    for (const f of fixtures('all')) {
      const { ydoc } = importBook(structuredClone(f.book));
      const st = stateFromBook(c, exportBook(ydoc));
      for (const s of st.sections as unknown as Rec[]) {
        expect('mode' in s, f.name).toBe(false);
        expect('verseAlign' in s, f.name).toBe(false);
      }
    }
  });

  it('the fields set on the book reach 1.0\'s state as set, and leave when they are removed', () => {
    const f = fixtures('real')[0]!;
    const { ydoc } = importBook(structuredClone(f.book));
    const before = exportBook(ydoc);
    const i = (before.sections as Rec[]).findIndex((s) => (s.kind ?? 'body') === 'body' && typeof s.content === 'string' && s.content.length > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const map = sectionList(ydoc)[i] as Y.Map<unknown>;
    ydoc.transact(() => {
      map.set('mode', 'verse');
      map.set('verseAlign', 'left');
    });
    const on = stateFromBook(c, exportBook(ydoc)).sections[i] as unknown as Rec;
    expect(on.mode).toBe('verse');
    expect(on.verseAlign).toBe('left');
    expect(on.content).toBe((before.sections as Rec[])[i]!.content);
    ydoc.transact(() => map.delete('mode'));
    const off = exportBook(ydoc);
    const expectOff = structuredClone(before);
    (expectOff.sections as Rec[])[i]!.verseAlign = 'left';
    expect(off).toEqual(expectOff);
    expect('mode' in (stateFromBook(c, off).sections[i] as unknown as Rec)).toBe(false);
  });
});
