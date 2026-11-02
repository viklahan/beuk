import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { CLOSURE_NAMES, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { loadClosure, setClosureLang, setClosureT, structEnv, type BibleEntry, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { covReset, covRun, covUi } from '../src/covenant/covenant';
import { covImportFile } from '../src/covenant/CovenantDialog';
import { fixtures } from './fixtures';

/* Wave 3b, task 1 (inventory C6): the Covenant's data and its room.
   1.0's self-checks re-expressed here: bible.model.compat, bible.mentions.match, bible.change.anchor, bible.change.now,
   bible.series.roundtrip, bible.seed.frominsights, bible.links.facts (room half), bible.card.folded (room half),
   bible.notexported (the book's text and word counts), bible.series.number (Settings half: wave 1a's own). Constraint
   25: the data is 1.0's, `bible` in `meta`, exported exactly as 1.0's serializeBook writes it. Constraint 4: opening,
   browsing and reading write nothing. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  covReset();
  const a = c.api;
  Object.assign(a.bibleUi, { sel: null, mode: 'entry', query: '', detail: false, filter: 'all', merge: null });
  c.vars.bibleSeries = null;
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  desk.ydoc = null;
  desk.active = null;
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const open = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  return y;
};
/** A book on the desk, as the studio holds it (desk.ydoc), with no section open. */
const onDesk = (doc: Rec) => {
  const y = open(doc);
  desk.ydoc = y;
  desk.active = null;
  covReset();
  return y;
};
const json = (y: Y.Doc) => JSON.stringify(exportBook(y));
const FIX_SECS = (): Rec[] => [
  { id: 'bibc1', kind: 'body', type: 'chapter', number: '1', title: 'The Quay', subtitle: '', content: "Slowly the fog held. At dawn Mara walked to the quay where Captain Hale was waiting. The ferry from Gullwick was late again. Slowly nobody spoke. Mara's lantern hissed in the damp, and the dog barked at Captain Hale." },
  { id: 'bibc2', kind: 'body', type: 'chapter', number: '2', title: 'Crossing', subtitle: '', content: 'Slowly the sea turned grey. They left Gullwick behind, and Mara watched the gulls. Later Captain Hale said nothing at all. Slowly, the wind rose. By noon Mara was asleep and Gullwick was only a smudge on the line of the sea.' },
];
const book = (title: string, extra: Rec = {}): Rec => ({ meta: { title, author: 'Fixture', language: 'en', langSource: 'manual' }, sections: FIX_SECS(), images: [], ...extra });
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('the browser closure for the Covenant', () => {
  it("lifts 1.0's model, room, card, change marking and series code, never the desk mirror (bibleDesk*), and supplies the mirror's entry points", () => {
    expect(CLOSURE_NAMES.filter((n) => /^bibleDesk|^bibleMarkBind$|^bibleMarkNames$|^bibleCardShowHit$|^bibleJump$|^openBible$|^bibleClose$/.test(n))).toEqual([]);
    for (const n of ['bibleDeskRender', 'bibleDeskSchedule', 'bibleCardHide', 'bibleOffsetY', 'openBible', 'apiFetch', 'uiLangState']) expect(CLOSURE_SUPPLIED).toContain(n);
    for (const n of ['bibleRender', 'bibleImportDoc', 'bibleSeriesRefresh', 'bibleMergeSave', 'bibleMarkOpen', 'bibleCardHtml', 'bibleSeriesTouched']) expect(CLOSURE_NAMES).toContain(n);
  });
});

describe("the data, 1.0's rules", () => {
  it('constraint 4: every fixture with a Covenant opens, renders the room state, lists its mentions and reads every card without a single write', () => {
    const withCov = fixtures('real').filter((f) => f.book.bible);
    expect(withCov.length).toBeGreaterThanOrEqual(5);
    for (const f of withCov) {
      const y = onDesk(f.book);
      const before = json(y);
      let updates = 0;
      y.on('update', () => updates++);
      covRun((cc) => {
        const a = cc.api;
        a.bibleMentions();
        a.bibleAllEntries().forEach((e) => {
          a.bibleCardHtml(e);
          a.bibleStateAt(e, a.bibleCursorPos(), a.bibleResolveChange);
        });
        a.bibleExportDoc();
        a.bibleSeedCandidates();
      });
      expect(updates, f.name).toBe(0);
      expect(json(y), f.name).toBe(before);
    }
  }, 120_000);

  it('a book without a Covenant writes no bible key; the first entry puts it where serializeBook writes it; deleting the last takes it away', () => {
    const y = onDesk(book('Plain'));
    expect('bible' in exportBook(y)).toBe(false);
    const e = covRun((cc) => cc.api.bibleNewEntry())!;
    expect(e).toBeTruthy();
    const doc = exportBook(y) as Rec & { bible: { entries: Rec[] } };
    const keys = Object.keys(doc);
    // serializeBook writes bible after outline/importReport and before notebook/research: here, at the end of what this book has
    expect(keys.includes('bible')).toBe(true);
    expect(doc.bible.entries.length).toBe(1);
    expect(doc.bible.entries[0]).toEqual({ id: e.id, type: 'character', name: '', aliases: [], description: '', notes: '', imageId: null, tags: [], exactCase: false, exclude: [] });
    covUi.toast = () => undefined;
    covRun((cc) => cc.api.bibleDelete(e.id));
    expect('bible' in exportBook(y)).toBe(false);
  });

  it("a delete comes with 1.0's toast and Undo, which puts the entry and the links to it back", () => {
    const bible = { entries: [{ id: 'a1', type: 'character', name: 'Mara', links: [{ to: 'a2', label: 'sails from' }] }, { id: 'a2', type: 'place', name: 'Gullwick' }] };
    const y = onDesk(book('Links', { bible }));
    // what 1.0 writes after any save: the Covenant normalised (every entry's fields spelled out)
    const before = JSON.stringify(c.api.bibleNormalize(bible));
    let undo: (() => void) | null = null;
    covUi.toast = (msg, _icon, action) => {
      expect(msg).toBe(t('bible.deleted', { name: 'Gullwick' }));
      undo = action!.onClick;
    };
    covRun((cc) => cc.api.bibleDelete('a2'));
    const mid = exportBook(y) as Rec & { bible: { entries: Rec[] } };
    expect(mid.bible.entries.map((e) => e.id)).toEqual(['a1']);
    expect('links' in mid.bible.entries[0]!).toBe(false);
    expect(undo).toBeTruthy();
    undo!();
    expect(JSON.stringify(exportBook(y).bible)).toBe(before);
  });

  it('bible.model.compat: a book with none of the new data serializes exactly as before; a full entry round-trips; bad AI/scope/links/anchors are dropped; export → import keeps it all; a version 1 file imports with the new keys absent', () => {
    const NEW = /"(facts|links|changes|ai|scope|fields)"/;
    const plain = book('Compat', { bible: { entries: [{ id: 'c1', type: 'character', name: 'Mara Quill', aliases: ['Mara'], notes: 'Line one', tags: ['crew'] }, { id: 'c2', type: 'place', name: 'Gullwick' }] } });
    let y = onDesk(plain);
    const quiet = covRun((cc) => !NEW.test(JSON.stringify(exportBook(y).bible)) && !NEW.test(JSON.stringify(cc.api.bibleExportDoc())));
    expect(quiet).toBe(true);
    const anchor = { sec: 's1', quote: 'the lamp was lit', at: 12, book: 'm1', pos: [3, 12] };
    const full = {
      entries: [
        { id: 'f1', type: 'character', name: 'Mara Quill', notes: '## Past\n**Keeper** of the *light*', facts: { age: '41', eyes: 'grey' }, links: [{ to: 'f2', label: 'lives in' }], changes: [{ id: 'ch1', anchor, text: 'Loses her post', fact: { field: 'age', value: '42' } }, { id: 'ch2', anchor: { sec: 's2', quote: 'q', at: 0 }, text: 'Plain' }], ai: 'always', scope: 'book' },
        { id: 'f2', type: 'place', name: 'Gullwick', ai: 'never' },
      ],
      fields: { character: [{ id: 'age', label: 'Age' }, { id: 'eyes', label: 'Eyes' }], place: [{ id: 'pop', label: 'Population' }] },
    };
    y = onDesk(book('Full', { bible: full }));
    const once = c.api.bibleNormalize(full) as { entries: Rec[]; fields: Rec };
    expect(JSON.stringify(c.api.bibleNormalize(once))).toBe(JSON.stringify(once));
    expect(JSON.stringify(once.fields)).toBe(JSON.stringify(full.fields));
    // the book holds exactly that, and opening it writes nothing
    expect(JSON.stringify(exportBook(y).bible)).toBe(JSON.stringify(full));
    const file = JSON.parse(JSON.stringify(covRun((cc) => cc.api.bibleExportDoc())));
    expect(file.format).toBe('beuk-story-bible');
    expect(file.version).toBe(2);
    y = onDesk(book('Other'));
    const r = covRun((cc) => cc.api.bibleImportDoc(file))!;
    expect(r.ok).toBe(true);
    // 1.0's import saves through bibleTouched in bibleImportFile; covRun writes what changed
    const got = exportBook(y) as Rec & { bible: { entries: (Rec & { links?: Rec[] })[]; fields: Rec } };
    const m = got.bible.entries.find((e) => e.name === 'Mara Quill')!, g = got.bible.entries.find((e) => e.name === 'Gullwick')!;
    expect(m.links).toEqual([{ to: g.id, label: 'lives in' }]);
    expect(m.facts).toEqual(full.entries[0]!.facts);
    expect(m.changes).toEqual(full.entries[0]!.changes);
    expect([m.ai, m.scope, m.notes, g.ai]).toEqual(['always', 'book', full.entries[0]!.notes, 'never']);
    expect(JSON.stringify(got.bible.fields)).toBe(JSON.stringify(full.fields));
    const old = { format: 'beuk-story-bible', version: 1, book: 'Old', entries: [{ id: 'z1', type: 'character', name: 'Zed', notes: 'n', tags: ['t'] }], images: [] };
    y = onDesk(book('Fresh'));
    expect(covRun((cc) => cc.api.bibleImportDoc(old).ok)).toBe(true);
    const z = exportBook(y) as Rec & { bible: Rec & { entries: Rec[] } };
    expect(z.bible.entries[0]!.name).toBe('Zed');
    expect(NEW.test(JSON.stringify(z.bible))).toBe(false);
  });

  it('bible.series.roundtrip: export to JSON and import into another book — type, aliases, notes, tags, exact case and exclusions kept; a picture travels and joins the library once (History packed with it); a name the book has (any case) is skipped and reported; a second import adds nothing; a foreign file is refused; the fields survive the book file', async () => {
    const img = { id: 'bibimgA', name: 'gullwick.png', mediaType: 'image/png', ext: 'png', data: TINY_PNG };
    onDesk(book('Book A', {
      images: [img],
      bible: {
        entries: [
          { id: 'x1', type: 'character', name: 'Mara Quill', aliases: ['Mara'], description: 'Keeper of the light', notes: 'Line one\nLine two', tags: ['crew'], exclude: ['Mara Bay'] },
          { id: 'x2', type: 'place', name: 'Gullwick', imageId: 'bibimgA', tags: ['town'] },
          { id: 'x3', type: 'thing', name: 'The Ledger', exactCase: true },
        ],
      },
    }));
    const fileText = JSON.stringify(covRun((cc) => cc.api.bibleExportDoc()), null, 2);
    const file = JSON.parse(fileText);
    expect([file.format, file.version, file.entries.length, file.images.length, file.images[0].data]).toEqual(['beuk-story-bible', 2, 3, 1, TINY_PNG]);
    expect(covRun((cc) => cc.api.bibleExportName())).toBe('Book-A-covenant.json');
    const y = onDesk(book('Book B', { bible: { entries: [{ id: 'y1', type: 'character', name: 'mara quill' }] } }));
    let report = '';
    const r = covRun((cc) => {
      const out = cc.api.bibleImportDoc(file);
      report = cc.api.bibleImportReport(out);
      cc.api.bibleTouched(false); // 1.0's bibleImportFile saves after an import that added something
      return out;
    })!;
    expect([r.added.map((e) => e.name), r.skipped, r.pics]).toEqual([['Gullwick', 'The Ledger'], ['Mara Quill'], 1]);
    expect(report).toContain('Mara Quill');
    const got = exportBook(y) as Rec & { images: Rec[]; bible: { entries: (BibleEntry & Rec)[] } };
    const g = got.bible.entries.find((e) => e.name === 'Gullwick')!, l = got.bible.entries.find((e) => e.name === 'The Ledger')!;
    expect(got.bible.entries.length).toBe(3);
    expect([g.type, g.tags, l.exactCase, l.type]).toEqual(['place', ['town'], true, 'thing']);
    expect(got.images.length).toBe(1);
    expect(got.images[0]!.id).toBe(g.imageId);
    expect(got.images[0]!.data).toBe(TINY_PNG);
    // the second import, through 1.0's file reader path: nothing added, the picture not copied again, nothing written
    const mid = json(y);
    await covImportFile(new Blob([fileText], { type: 'application/json' }));
    expect(json(y)).toBe(mid);
    // a foreign file is refused and nothing is written
    await covImportFile(new Blob([JSON.stringify({ format: 'something-else', entries: [{ name: 'X' }] })], { type: 'application/json' }));
    expect(json(y)).toBe(mid);
    // into a book with none: an old book arrives with none; every field survives the file AND the book file
    const y2 = onDesk(book('Book C'));
    expect(covRun((cc) => cc.api.bibleEntries().length)).toBe(0);
    await covImportFile(new Blob([fileText], { type: 'application/json' }));
    const y3 = onDesk(exportBook(y2));
    const mq = covRun((cc) => cc.api.bibleEntries().find((e) => e.name === 'Mara Quill'))!;
    expect([mq.aliases, mq.notes, mq.description, mq.exclude, mq.tags]).toEqual([['Mara'], 'Line one\nLine two', 'Keeper of the light', ['Mara Bay'], ['crew']]);
    expect(covRun((cc) => cc.api.bibleEntries().length)).toBe(3);
    expect(json(y3)).toBe(json(y2));
  });

  it('bible.mentions.match: whole words, case-insensitive; English possessive and plural ride; exclusions mask; exact case; longest wins; ambiguous skipped; markup is never a mention; no plural rule outside English; Arabic whole words', () => {
    const a = c.api;
    const E = (o: Rec) => a.bibleNormalizeEntry(o)!;
    const mara = E({ id: 'bm1', type: 'character', name: 'Mara Quill', aliases: ['Mara', 'Quill'] });
    const will = E({ id: 'bm2', type: 'character', name: 'Will', exactCase: true, exclude: ['Will you'] });
    const hale = E({ id: 'bm3', type: 'character', name: 'Captain Hale', aliases: ['Hale'] });
    const ned = E({ id: 'bm4', type: 'character', name: 'Ned Quill', aliases: ['Quill'] });
    const text = "Mara walked to the quay. Mara's lantern hissed; the Maras of Gullwick were many, and Mara’s boat was late. Maraschino is not a name. Will you come? Will said no, and his will held. Mara Quill met Ned Quill. Quill nodded. Captain Hale waved;\nHale smiled. ![Mara](sample-img-x) [a link](https://mara.example/Hale).";
    const r = a.bibleScan(text, a.bibleBuildMatcher([mara, will, hale, ned], 'en'));
    expect(r.hits.map((h) => text.slice(h.s, h.e)).join('|')).toBe("Mara|Mara's|Maras|Mara’s|Will|Mara Quill|Ned Quill|Captain Hale|Hale");
    expect(r.ambiguous.map((x) => text.slice(x.s, x.e))).toEqual(['Quill']);
    const loose = E({ id: 'bm2', type: 'character', name: 'Will', exactCase: false, exclude: ['Will you'] });
    const r2 = a.bibleScan(text, a.bibleBuildMatcher([mara, loose, hale, ned], 'en'));
    expect(r2.hits.filter((h) => h.id === 'bm2').map((h) => text.slice(h.s, h.e)).join('|')).toBe('Will|will');
    expect(a.bibleScan("Les Maras de Gullwick. Mara vint, et Mara's aussi.", a.bibleBuildMatcher([E({ id: 'f1', type: 'character', name: 'Mara' })], 'fr')).hits.length).toBe(2);
    const arText = 'مشت مارا إلى الميناء، ورفعت مارا، ثم الفانوس. مارالي ليست هي، ومارا ليست هنا، ثم القبطان هيل ينتظر. القبطان هيل ابتسم.';
    const ar = a.bibleScan(arText, a.bibleBuildMatcher([E({ id: 'a1', type: 'character', name: 'مارا' }), E({ id: 'a2', type: 'character', name: 'القبطان هيل', aliases: ['هيل'] }), E({ id: 'a3', type: 'thing', name: 'الفانوس' })], 'ar'));
    const by = (id: string) => ar.hits.filter((h) => h.id === id).map((h) => arText.slice(h.s, h.e));
    expect([by('a1').length, by('a2').join('|'), by('a3').length]).toEqual([2, 'القبطان هيل|القبطان هيل', 1]);
  });

  it('bible.change.anchor: found again after text is added before it, follows the passage to another chapter, picks the nearest of two quotes, orphaned when a word changes; an empty selection makes no anchor', () => {
    const mk = (id: string, content: string) => ({ id, kind: 'body', type: 'chapter', number: '1', title: id, subtitle: '', content });
    const quote = 'the lamp was lit at dusk';
    const base = 'x'.repeat(40) + quote + ' and the ferry slept.';
    const other = mk('an2', 'A different chapter, nothing here.');
    onDesk(book('Anchor', { sections: [mk('an1', base), other] }));
    covRun((cc) => {
      const a = cc.api;
      const an = a.bibleAnchorMake('an1', 40, 40 + quote.length)!;
      expect(an).toEqual({ sec: 'an1', quote, at: 40 });
      expect(a.bibleAnchorFind(an, [mk('an1', 'y'.repeat(50) + base), other])).toEqual({ sec: 'an1', at: 90 });
      expect(a.bibleAnchorFind(an, [mk('an1', 'x'.repeat(40) + ' and the ferry slept.'), mk('an2', 'Later. ' + quote + '.')])).toEqual({ sec: 'an2', at: 7 });
      const two = quote + ' ' + 'z'.repeat(30) + quote;
      expect(a.bibleAnchorFind({ ...an, at: 60 }, [mk('an1', two), other])!.at).toBe(quote.length + 31);
      expect(a.bibleAnchorFind(an, [mk('an1', base.replace('lamp', 'lantern')), other])).toBeNull();
      expect(a.bibleAnchorMake('an1', 10, 10)).toBeNull();
    });
  });

  it('bible.change.now: changes at chapters 1, 3 and 5, the cursor in chapter 4 — chapter 3\'s is now, chapter 5\'s ahead; a fact at chapter 3 shows at 4, not at 2; no chapter open reads as the end of the book', () => {
    const mk = (n: number) => ({ id: 'cn' + n, kind: 'body', type: 'chapter', number: String(n), title: 'Ch ' + n, subtitle: '', content: 'Chapter ' + n + ' opens. Mara rows on.' });
    const ch = (n: number, text: string, fact?: Rec) => ({ id: 'k' + n, anchor: { sec: 'cn' + n, quote: 'Chapter ' + n + ' opens', at: 0 }, text, ...(fact ? { fact } : {}) });
    const y = onDesk(book('Now', { sections: [1, 2, 3, 4, 5].map(mk), bible: { entries: [{ id: 'm', type: 'character', name: 'Mara', facts: { rank: 'deckhand' }, changes: [ch(1, 'joins'), ch(3, 'promoted', { field: 'rank', value: 'mate' }), ch(5, 'captain')] }], fields: { character: [{ id: 'rank', label: 'Rank' }] } } }));
    const at = (i: number | null) =>
      covRun((cc) => {
        desk.active = i;
        cc.vars.editorSyncedSectionId = null;
        const st = cc.getState() as Rec;
        st.activeId = i === null ? null : (st.sections as Rec[])[i]!.id;
        const e = cc.api.bibleById('m')!;
        const s = cc.api.bibleStateAt(e, cc.api.bibleCursorPos(), cc.api.bibleResolveChange);
        return { now: (s.now as Rec | null)?.text, later: s.later.map((x) => (x as Rec).text), rank: s.facts.rank };
      })!;
    expect(at(3)).toEqual({ now: 'promoted', later: ['captain'], rank: 'mate' });
    expect(at(1)).toEqual({ now: 'joins', later: ['promoted', 'captain'], rank: 'deckhand' });
    expect(at(null)).toEqual({ now: 'captain', later: [], rank: 'mate' });
    expect(json(y)).toBe(JSON.stringify(exportBook(open(exportBook(y)))));
  });

  it('bible.notexported: with entries (notes, tags, a picture, exclusions) every section\'s text and every word count are what they are without them', () => {
    const plain = book('Plain');
    const withCov = book('Plain', { images: [{ id: 'im1', name: 'p', mediaType: 'image/png', ext: 'png', data: TINY_PNG }], bible: { entries: [{ id: 'n1', type: 'character', name: 'Mara', notes: 'Not book text', tags: ['crew'], imageId: 'im1', exclude: ['Mara Road'] }] } });
    const a = onDesk(plain), b = open(withCov);
    expect(JSON.stringify((exportBook(b).sections as Rec[]).map((s) => s.content))).toBe(JSON.stringify((exportBook(a).sections as Rec[]).map((s) => s.content)));
    const words = (y: Y.Doc) => {
      desk.ydoc = y;
      covReset();
      return covRun((cc) => cc.api.bookWordTotal());
    };
    expect(words(b)).toBe(words(a));
  });

  it("an entry stored without a valid id gets its place as one, so reading it twice reads the same entry (and writes nothing)", () => {
    const y = onDesk(book('Ids', { bible: { entries: [{ id: 'bad id!', type: 'character', name: 'Mara' }, { type: 'place', name: 'Gullwick' }] } }));
    const before = json(y);
    const ids1 = covRun((cc) => cc.api.bibleAllEntries().map((e) => e.id))!;
    covReset();
    const ids2 = covRun((cc) => cc.api.bibleAllEntries().map((e) => e.id))!;
    expect(ids1).toEqual(['bx1', 'bx2']);
    expect(ids2).toEqual(ids1);
    expect(json(y)).toBe(before);
  });
});

/* ---- the room, in the studio ---- */
async function studioWith(doc: Rec) {
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnBible')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openRoom() {
  fireEvent.click(document.getElementById('btnBible')!);
  await waitFor(() => expect(document.querySelector('#bibList')?.childNodes.length).toBeGreaterThan(0), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
  ];
  fireEvent.click(document.getElementById('btnExport')!);
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec }).book;
}
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const typeIn = (el: HTMLInputElement | HTMLTextAreaElement, v: string, ev: 'input' | 'change' = 'input') =>
  act(() => {
    el.value = v;
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  });

describe('the Covenant room in the studio', { timeout: 60_000 }, () => {
  it('opens from the sidebar with 1.0\'s markup; browsing (entries, search, the mentions view, back) writes nothing; Close closes', async () => {
    const doc = book('Room', { bible: { entries: [{ id: 'r1', type: 'character', name: 'Mara', aliases: ['Mara Q'] }, { id: 'r2', type: 'place', name: 'Gullwick' }, { id: 'r3', type: 'character', name: 'Captain Hale', aliases: ['Hale'] }] } });
    await studioWith(doc);
    const before = JSON.stringify(await exported());
    await openRoom();
    expect(document.querySelector('#modalBible .bib-modal')).not.toBeNull();
    expect([...document.querySelectorAll('#bibList .bib-group span:first-child')].map((x) => x.textContent)).toEqual([t('bible.typePl.character'), t('bible.typePl.place')]);
    // the counts beside each entry: 1.0's mentions over the story
    const n = (id: string) => document.querySelector(`.bib-item[data-bib-id="${id}"] .bib-item-n`)?.textContent;
    expect([n('r1'), n('r2'), n('r3')]).toEqual(['4', '3', '3']);
    act(() => (document.querySelector('.bib-item[data-bib-id="r3"]') as HTMLElement).click());
    await waitFor(() => expect($('bibFName')?.value).toBe('Captain Hale'));
    expect($('bibMenSum').textContent).toBe(t('bible.nMentions', { count: 3, n: '3' }) + ' · ' + t('bible.nSections', { count: 2, n: '2' }));
    expect(document.querySelectorAll('#bibHeat .bib-cell').length).toBe(2);
    typeIn($('bibSearch'), 'gull');
    expect([...document.querySelectorAll('#bibList .bib-item')].map((x) => x.getAttribute('data-bib-id'))).toEqual(['r2']);
    typeIn($('bibSearch'), '');
    act(() => $('btnBibBack').click());
    expect(JSON.stringify(await exported())).toBe(before);
    act(() => $('btnCloseBible').click());
    await waitFor(() => expect(document.getElementById('modalBible')).toBeNull());
  });

  it('New entry, the name and its fields typed in the room are written as 1.0 saves them; exact case is a switch', async () => {
    await studioWith(book('Typed'));
    await openRoom();
    act(() => $('btnBibNew').click());
    await waitFor(() => expect(document.activeElement?.id).toBe('bibFName'));
    typeIn($('bibFName'), 'Mara Quill');
    typeIn($('bibFAliases'), 'Mara, Quill, mara quill');
    typeIn($('bibFDesc'), 'keeper of the light');
    typeIn(document.getElementById('bibFNotes') as HTMLTextAreaElement, 'Line one\nLine two');
    typeIn($('bibFTags'), 'crew, crew, light');
    typeIn($('bibFExclude'), 'Mara Road');
    const sel = document.getElementById('bibFType') as HTMLSelectElement;
    act(() => {
      sel.value = 'lore';
    });
    act(() => sel.dispatchEvent(new Event('change', { bubbles: true })));
    act(() => $('tglBibExact').click());
    const doc = (await exported()) as Rec & { bible: { entries: Rec[] } };
    const e = doc.bible.entries[0]!;
    expect([e.name, e.aliases, e.description, e.notes, e.tags, e.exclude, e.type, e.exactCase]).toEqual(['Mara Quill', ['Mara', 'Quill'], 'keeper of the light', 'Line one\nLine two', ['crew', 'light'], ['Mara Road'], 'lore', true]);
    expect(document.querySelector(`.bib-item[data-bib-id="${e.id as string}"] .bib-item-name`)?.textContent).toBe('Mara Quill');
  });

  it('bible.seed.frominsights: "Add from Story Insights" offers exactly the names Names on stage found, with their counts; opening it or Add with nothing chosen creates nothing; a forged name is never added', async () => {
    await studioWith(book('A Test of Tides'));
    const found = covRun((cc) => cc.api.castVisible(cc.api.castCompute((cc.getState() as Rec).sections as unknown[], 'en', 'A Test of Tides'), []))!;
    await waitFor(() => expect(document.getElementById('btnBible')!.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click($('btnBible'));
    await waitFor(() => expect($('btnBibSeed')).not.toBeNull());
    act(() => $('btnBibSeed').click());
    const sels = [...document.querySelectorAll<HTMLSelectElement>('#bibSeedList select[data-seed-name]')];
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(sels.map((s) => s.getAttribute('data-seed-name'))).toEqual(found.map((f) => f.name));
    expect([...document.querySelectorAll('#bibSeedList .bib-seed-n')].map((x) => x.textContent!.trim())).toEqual(found.map((f) => c.api.fmtNum(f.total)));
    const add = $('btnBibSeedAdd');
    expect(add.disabled).toBe(true);
    let doc = await exported();
    expect('bible' in doc).toBe(false);
    const mara = sels.find((s) => s.getAttribute('data-seed-name') === 'Mara')!;
    act(() => {
      mara.value = 'character';
    });
    act(() => mara.dispatchEvent(new Event('change', { bubbles: true })));
    const forged = document.createElement('select');
    forged.setAttribute('data-seed-name', 'Invented Person');
    forged.innerHTML = '<option value="place" selected>place</option>';
    $('bibSeedList').appendChild(forged);
    expect(add.disabled).toBe(false);
    act(() => add.click());
    doc = await exported();
    const es = (doc.bible as { entries: Rec[] }).entries;
    expect(es.map((e) => [e.name, e.type])).toEqual([['Mara', 'character']]);
    act(() => $('btnBibSeed').click());
    const taken = [...document.querySelectorAll('#bibSeedList .bib-seed-row')].filter((r) => r.querySelector('.bib-seed-in')).map((r) => r.querySelector('.bib-seed-name')!.textContent);
    expect(taken).toEqual(['Mara']);
  });

  it('bible.links.facts (room half) and bible.card.folded: a plain entry has no card; a fact field, a fact and a link bring it in on both entries; clearing them takes it away; a template adds only missing fields', async () => {
    await studioWith(book('Facts', { bible: { entries: [{ id: 'cf-mara', type: 'character', name: 'Mara' }, { id: 'cf-tomas', type: 'character', name: 'Tomas' }] } }));
    await openRoom();
    act(() => (document.querySelector('.bib-item[data-bib-id="cf-mara"]') as HTMLElement).click());
    await waitFor(() => expect($('bibFName')?.value).toBe('Mara'));
    expect(document.getElementById('bibEntryCard')).toBeNull();
    // the "more" fold: a field for this kind, its fact, a link
    const more = document.getElementById('bibMore') as HTMLDetailsElement;
    expect(more).not.toBeNull();
    act(() => {
      more.open = true;
    });
    typeIn($('bibNewField'), 'Age');
    act(() => $('btnBibAddField').click());
    const fact = document.querySelector<HTMLInputElement>('#bibDetail [data-fact]')!;
    expect(fact).not.toBeNull();
    typeIn(fact, '19');
    await waitFor(() => expect(document.getElementById('bibEntryCard')?.textContent).toContain('19'));
    const to = document.getElementById('bibLinkTo') as HTMLSelectElement;
    act(() => {
      to.value = 'cf-tomas';
    });
    typeIn($('bibLinkLabel'), 'sister of');
    act(() => $('btnBibAddLink').click());
    let doc = (await exported()) as Rec & { bible: { entries: Rec[]; fields: Rec } };
    const m = doc.bible.entries.find((e) => e.id === 'cf-mara')!;
    expect(m.links).toEqual([{ to: 'cf-tomas', label: 'sister of' }]);
    expect(Object.values(m.facts as Rec)).toEqual(['19']);
    expect((doc.bible.fields.character as Rec[]).map((f) => f.label)).toEqual(['Age']);
    // the link shows on Tomas' card too
    act(() => (document.querySelector('.bib-item[data-bib-id="cf-tomas"]') as HTMLElement).click());
    await waitFor(() => expect(document.querySelector('#bibEntryCard .bib-chip')).not.toBeNull());
    act(() => (document.querySelector('.bib-item[data-bib-id="cf-mara"]') as HTMLElement).click());
    await waitFor(() => expect($('bibFName')?.value).toBe('Mara'));
    const more2 = document.getElementById('bibMore') as HTMLDetailsElement;
    act(() => {
      more2.open = true;
    });
    act(() => (document.querySelector('[data-bib-unlink="0"]') as HTMLElement).click());
    typeIn(document.querySelector<HTMLInputElement>('#bibDetail [data-fact]')!, '');
    await waitFor(() => expect(document.getElementById('bibEntryCard')).toBeNull());
    doc = (await exported()) as Rec & { bible: { entries: Rec[]; fields: Rec } };
    const m2 = doc.bible.entries.find((e) => e.id === 'cf-mara')!;
    expect('links' in m2 || 'facts' in m2).toBe(false);
  });
});

describe('a call that sets off another', () => {
  it("1.0's edit made before the book changes under it (the editor taking the caret back) is written, not lost to the state built again", () => {
    const y = onDesk(book('Nested', { bible: { entries: [{ id: 'n1', type: 'character', name: 'Mara' }] } }));
    covRun((cc) => {
      cc.api.bibleById('n1')!.description = 'keeper';
      // something else writes the book mid-call, and 1.0's code runs again inside (covEnter builds the state afresh)
      y.getMap('meta').set('zzTouched', 1);
      covRun((c2) => c2.api.bibleAllEntries());
    });
    expect((exportBook(y).bible as { entries: Rec[] }).entries[0]!.description).toBe('keeper');
  });
});

describe('the toast the Covenant raises outside a call', () => {
  it('structEnv.toast is put back after covRun', () => {
    onDesk(book('Toast'));
    const keep = structEnv.toast;
    covRun(() => undefined);
    expect(structEnv.toast).toBe(keep);
  });
});
