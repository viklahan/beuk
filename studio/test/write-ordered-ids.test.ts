import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook, sectionKeys, sectionList, setSectionOrder } from '../../src/book/editor/index';
import { writeBook } from '../src/structure/structure';
import { fixtures } from './fixtures';

/* writeOrdered matches sections by 1.0 id, but readBook accepts a book whose section ids repeat or are missing, and the
   picture library (imagelib writeBack) and the sample's stale sweep call it without checking. Such a book is matched
   by position: every section keeps its Y.Map and gets exactly its changed fields (review of the section-order change,
   should-fix 1). Both tests fail on id matching. */

type Rec = Record<string, unknown>;
const base = () => structuredClone(fixtures('real')[0]!.book) as Rec & { sections: Rec[] };

function editAndCheck(prep: (s: Rec[]) => void, change: (s: Rec[]) => void) {
  const b = base();
  prep(b.sections);
  const y = new Y.Doc();
  importBook(b, y);
  const maps = sectionList(y);
  const before = exportBook(y) as Rec;
  const after = structuredClone(before);
  change(after.sections as Rec[]);
  y.transact(() => writeBook(y, before, after));
  expect(exportBook(y)).toEqual(after);
  expect(sectionList(y).length).toBe(maps.length);
  sectionList(y).forEach((m, i) => expect(m, `section ${i} keeps its Y.Map`).toBe(maps[i]));
}

describe('writeOrdered without unique ids: matched by position', () => {
  it('repeated ids: a field change on the second of the two lands on it; every section keeps its Y.Map', () => {
    editAndCheck(
      (s) => {
        s[1]!.id = s[0]!.id;
      },
      (s) => {
        s[1]!.title = 'Changed by the picture library';
      },
    );
  });

  it('a missing id: field changes keep every Y.Map (nothing removed and re-inserted)', () => {
    editAndCheck(
      (s) => {
        delete s[1]!.id;
      },
      (s) => {
        s[1]!.title = 'Changed one';
        s[0]!.title = 'Changed zero';
      },
    );
  });
});

describe('setSectionOrder', () => {
  it('a key named twice counts once; no section is lost', () => {
    const y = new Y.Doc();
    importBook(base(), y);
    const k = sectionKeys(y);
    setSectionOrder(y, [k[1]!, k[1]!, k[0]!, ...k.slice(2)]);
    expect(new Set(sectionKeys(y)).size).toBe(k.length);
    expect(sectionKeys(y).slice(0, 2)).toEqual([k[1], k[0]]);
  });
});
