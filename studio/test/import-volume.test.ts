import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { exportReset, exportRun, exportState, loadSerialize, volumeFromFile } from '../src/export/state';
import { importWire } from '../src/import/import';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';
import { maskVarying, textCorpus } from './import-fixture';
import { createImportOracle } from './import-oracle';
import { loadMammoth } from './vendor';
// @ts-expect-error — a plain .mjs module, no types
import { docxCorpus, makeZip, plainEpub } from '../e2e/import-corpus.mjs';

/* Wave 6, task 4 — decision 6, constraint 81 (review focus #4): ADD A BOOK READS MANUSCRIPTS WITH 1.0's OWN READER.
   1.0's manuscriptFileToVolume (5c's stand-in gone): a .docx, a .md and an .epub (2.0's own EPUB of a fixture) each become
   a volume through 1.0's importSandboxed — the volume 1.0's own code makes of the same file (the oracle), less only what
   1.0 varies — and the open book is left exactly as it was: its export, its Y state vector, and the export session's
   state. A zip of books expands as 1.0's boxSetExpandPick expands it. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
loadMammoth();
const JSZip = (globalThis as unknown as { JSZip: unknown }).JSZip;
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  await loadSerialize();
  setClosureT(t);
  setClosureLang('en');
  await importWire();
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(structuredClone(doc), y);
  desk.ydoc = y;
  exportReset();
  return y;
};
const sv = (y: Y.Doc) => Buffer.from(Y.encodeStateVector(y)).toString('base64');
const LANTERN = () => fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!.book;

async function files(): Promise<File[]> {
  const out: File[] = [];
  const docx = (await docxCorpus(JSZip)) as { name: string; type: string; bytes: Uint8Array }[];
  const d = docx.find((x) => x.name === 'matter.docx')!;
  out.push(new File([d.bytes as BlobPart], d.name, { type: d.type }));
  const md = textCorpus().find((x) => x.name === 'frontmatter.md')!;
  out.push(new File([md.text], md.name, { type: md.type }));
  // 2.0's own EPUB of a fixture (1.0's buildEpubBlob through the export session)
  const salt = fixtures('real').find((x) => x.name === 'real/salt-road-book-one')!.book;
  const y = onDesk(salt);
  const blob = (await exportRun((cc) => cc.api.buildEpubBlob())) as Blob;
  y.destroy();
  out.push(new File([blob], 'salt-road.epub', { type: 'application/epub+zip' }));
  return out;
}

describe("wave 6: Add a Book reads a manuscript with 1.0's own reader (decision 6, constraint 81)", () => {
  it('a .docx, a .md and an .epub each become 1.0\'s volume; the open book stays exactly as it was', async () => {
    const list = await files();
    const y = onDesk(LANTERN());
    const before = exportBook(y);
    const at = sv(y);
    exportRun(() => undefined);
    const session = JSON.stringify(exportState());
    for (const f of list) {
      const vol = (await volumeFromFile(f)) as Rec & { meta: Rec; sections: Rec[] };
      expect(vol.sections.length, f.name).toBeGreaterThan(0);
      // 1.0's own volume of the same file, on 1.0's own desk holding the same book
      const o = await createImportOracle(t, { mammoth: (globalThis as Rec).mammoth });
      o.api.applyBookDoc(structuredClone(LANTERN()) as never);
      const want = await o.api.manuscriptFileToVolume(new File([await f.arrayBuffer()], f.name, { type: f.type }) as never);
      expect(maskVarying(vol), f.name).toEqual(maskVarying(JSON.parse(JSON.stringify(want))));
      // the open book: untouched
      expect(exportBook(y), f.name).toEqual(before);
      expect(sv(y), f.name).toBe(at);
      exportRun(() => undefined);
      expect(JSON.stringify(exportState()), f.name + ': the export session state').toBe(session);
    }
    y.destroy();
  }, 120_000);

  it("a zip of books expands as 1.0's boxSetExpandPick does (each book a file; what it cannot read named)", async () => {
    const md = textCorpus().filter((x) => x.name.endsWith('.md')).slice(0, 2);
    const zip = new File([(await makeZip(JSZip, [...md.map((m) => ({ name: 'books/' + m.name, text: m.text })), { name: 'notes.pdf.exe', text: 'x' }, { name: '__MACOSX/._a.md', text: 'x' }])) as BlobPart], 'library.zip');
    const y = onDesk(LANTERN());
    const got = (await exportRun((cc) => cc.vars.boxSetExpandPick([zip]))) as { files: File[]; skipped: { name: string; why: string }[] };
    const o = await createImportOracle(t);
    const want = (await o.api.boxSetExpandPick([new File([await zip.arrayBuffer()], 'library.zip')] as never)) as { files: File[]; skipped: unknown[] };
    expect(got.files.map((f) => f.name)).toEqual(want.files.map((f) => f.name));
    expect(got.files.map((f) => f.name)).toEqual(md.map((m) => m.name));
    expect(got.skipped).toEqual(want.skipped);
    y.destroy();
  });

  it('the plain EPUB (no epub:type) is read by its headings, as 1.0 reads it', async () => {
    const y = onDesk(LANTERN());
    const f = new File([(await plainEpub(JSZip)) as BlobPart], 'plain.epub', { type: 'application/epub+zip' });
    const vol = (await volumeFromFile(f)) as Rec & { meta: Rec; sections: Rec[] };
    expect(vol.meta.title).toBe('Plain Pages');
    expect(vol.sections.filter((s) => s.type === 'chapter').map((s) => s.title)).toEqual(['Chapter One', 'Chapter Two']);
    y.destroy();
  });
});
