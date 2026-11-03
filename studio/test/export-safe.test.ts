import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, stateFromBook, type Closure, type EpubFile } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportBody, exportReset, exportRun, loadSerialize } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';
import { hostileExportBook } from './export-fixture';
import { cssHazards, hazards } from './hazards';

/* Wave 5a, task 1 — constraint 53 (review focus #2): safety, the export's turn. A hostile book (test/export-fixture.ts)
   through every format: the package (epubFiles, every preset: what the inspector shows, the validator and the audit
   read), the standalone HTML, and the book 2.0 sends to POST /api/epub as the server reads and builds it (readBook,
   the server's state mapping and arrival, the same epubFiles text: test/export-closure.test.ts). 1.0's own build of
   the same book is the reproducing fixture of the 1.0 findings. An honest book passes the corrections unchanged. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let ser: (c: Closure) => Rec;
beforeAll(async () => {
  c = await loadClosure();
  ser = await loadSerialize();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  exportReset();
  return y;
};
function packageHazards(files: EpubFile[], label: string): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.binary) continue;
    if (f.path.endsWith('.css')) out.push(...cssHazards(f.content, label + ' ' + f.path));
    else out.push(...hazards(f.content, label + ' ' + f.path));
  }
  return out;
}
const PRESETS = () => c.api.PLATFORM_PRESETS.map((p) => p.id);

describe('wave 5a: a hostile book through the export (constraint 53)', () => {
  it("1.0 finding (the reproducing fixture): 1.0's own build of the hostile book carries handlers, script and remote requests", () => {
    const y = onDesk(hostileExportBook());
    const st = arriveForExport(c, exportBook(y) as Rec); // 1.0's state, no correction
    c.setState(st);
    const pkg = packageHazards(c.api.epubFiles('generic'), '1.0 package');
    const html = hazards(c.api.buildStandaloneHtml(), '1.0 html');
    // which of 1.0's builders write the book's values unescaped: the report lists these (For V)
    const found = [...pkg, ...html];
    console.log('[1.0 finding] ' + found.length + ' hazards, e.g.:\n  ' + [...new Set(found.map((x) => x.replace(/window\.__pw=\d+/g, 'window.__pw=N')))].slice(0, 40).join('\n  '));
    expect(pkg.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
  });

  it('the package 2.0 builds (every preset), the standalone HTML: no script, handler or remote request', () => {
    const y = onDesk(hostileExportBook());
    const out = exportRun((cc) => {
      const found: string[] = [];
      for (const id of PRESETS()) found.push(...packageHazards(cc.api.epubFiles(id), id));
      found.push(...hazards(cc.api.buildStandaloneHtml(), 'html'));
      return found;
    });
    expect(out).toEqual([]);
    y.destroy();
  });

  it('the book 2.0 sends, read and built as the server builds it: no script, handler or remote request', async () => {
    const y = onDesk(hostileExportBook());
    const body = JSON.parse((await exportBody('en'))!) as { book: Rec; platform: string; lang: string };
    const r = readBook(body.book);
    expect(r.status).toBe('ok');
    // the server: epubState(read.book, platform) → the vm's global state → ARRIVE (src/book/epub) → buildEpubBlob's epubFiles
    const st = stateFromBook(c, JSON.parse(JSON.stringify(r.book)) as Rec);
    c.setState(st);
    const found: string[] = [];
    for (const id of PRESETS()) found.push(...packageHazards(c.api.epubFiles(id), 'server ' + id));
    expect(found).toEqual([]);
    y.destroy();
  });

  it('on every honest fixture the corrections change nothing: the body is the same with and without them', () => {
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const y = onDesk(structuredClone(f.book));
      const book = exportBook(y) as Rec;
      const raw = arriveForExport(c, book);
      c.setState(raw);
      const a = JSON.stringify(ser(c));
      const safe = arriveForExport(c, book);
      const what = exportSafe(c, safe as Rec & typeof safe, book);
      c.setState(safe);
      const b = JSON.stringify(ser(c));
      expect(what, f.name).toEqual({ images: 0, cover: false, fonts: 0, sections: 0 });
      expect(b === a, f.name).toBe(true);
      y.destroy();
    }
  });
});
