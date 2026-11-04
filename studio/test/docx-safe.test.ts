import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure, type EpubFile } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, exportRun, volumeFromFile } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';
import { XML_BAD, controlCharBook, hostileExportBook, hostileNonStringBook } from './export-fixture';
import { cssHazards, hazards } from './hazards';

/* Wave 5c, task 1 — constraint 67 (review focus #3): safety, these formats' turn. A hostile book (5a's) through the
   Word document, the submission manuscript, the ACX script (every format choice), and a hostile volume — the same book
   as a Beuk backup added with Add a Book — through the box set, beside the hostile open book. Every part of every
   package is parsed and walked:
   - a Word package (docxHazards): every XML part is well-formed (a value that broke out of its markup would not be), no
     relationship leaves the package except a hyperlink to an http(s) or mailto address (1.0's mdLinkRe: the only links
     it writes), no field code but the manuscript header's PAGE (no INCLUDEPICTURE, INCLUDETEXT, HYPERLINK, DDE…), no
     embedded object, picture, frame, alternative chunk, attached template or control, no javascript:/vbscript: value;
   - the box set's EPUB: 5a's walk (test/hazards.ts) over every XHTML, the OPF, the NCX and the stylesheet. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  // wave 6: Add a Book's volumes are 1.0's own (src/import/import.ts importWire wires them)
  await (await import('../src/import/import')).importWire();
  c = await loadClosure();
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
const REL_EXTERNAL_OK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const EMBEDS = new Set(['object', 'pict', 'imagedata', 'altchunk', 'attachedtemplate', 'frame', 'subdoc', 'control', 'oleobject', 'embed', 'fldsimple', 'shape', 'binarydata']);
/** What a Word package could carry that fetches, runs or leaves the package (see above). */
export function docxHazards(files: { path: string; content: string }[], where = ''): string[] {
  const out: string[] = [];
  for (const f of files) {
    const at = `${where} ${f.path}`;
    const doc = new DOMParser().parseFromString(String(f.content), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      out.push(`${at}: not well-formed XML`);
      continue;
    }
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      const name = el.localName.toLowerCase();
      if (EMBEDS.has(name)) out.push(`${at}: <${el.tagName}>`);
      if (name === 'instrtext' && (el.textContent || '').trim() !== 'PAGE') out.push(`${at}: field code ${(el.textContent || '').trim().slice(0, 40)}`);
      if (name === 'relationship') {
        const external = el.getAttribute('TargetMode') === 'External';
        const target = el.getAttribute('Target') || '';
        if (external && !(el.getAttribute('Type') === REL_EXTERNAL_OK && /^(https?:\/\/|mailto:)/i.test(target))) out.push(`${at}: external relationship ${el.getAttribute('Type')} → ${target.slice(0, 60)}`);
        if (!external && /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) out.push(`${at}: relationship to ${target.slice(0, 60)} not marked external`);
      }
      for (const a of Array.from(el.attributes)) if (/^\s*(?:javascript|vbscript)\s*:/i.test(a.value)) out.push(`${at}: <${el.tagName} ${a.name}="${a.value.slice(0, 40)}">`);
    }
  }
  return out;
}
function packageHazards(files: EpubFile[], label: string): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.binary) continue;
    if (f.path.endsWith('.css')) out.push(...cssHazards(f.content, label + ' ' + f.path));
    else out.push(...hazards(f.content, label + ' ' + f.path));
  }
  return out;
}
const backupFile = (book: Rec, name: string) => new File([JSON.stringify({ format: 'beuk-backup', book })], name, { type: 'application/json' });
/** Every Word package an ACX zip holds (each script, the pronunciation guide). */
const acxDocx = (cc: Closure, fmt: string) => {
  const st = cc.getState() as Rec;
  st.audio = cc.api.acxNormalize(Object.assign({}, st.audio, { format: fmt, rightsInClosing: true, narrator: 'N <script>window.__pw=40</script>' }));
  const entries = cc.api.acxZipEntries(cc.api.acxBuildPlan());
  return entries;
};

/** Every XML part of a package (an EPUB's XHTML, OPF, NCX and container; a Word package's parts) parsed as XML. */
export function notWellFormed(files: { path: string; content: string; binary?: boolean }[], where = ''): string[] {
  return files
    .filter((f) => !f.binary && /\.(xhtml|opf|ncx|xml|rels)$/.test(f.path))
    .filter((f) => new DOMParser().parseFromString(String(f.content), 'application/xml').getElementsByTagName('parsererror').length > 0)
    .map((f) => `${where} ${f.path}`);
}

describe('review of 5c (Important 1): XML-illegal code points in the open book and in a volume', () => {
  it('the parse itself catches them: a part carrying U+0001 is not well-formed', () => {
    expect(notWellFormed([{ path: 'a.xhtml', content: '<?xml version="1.0"?><p>a\u0001b</p>' }])).toEqual([' a.xhtml']);
  });
  it("every XML part of the EPUB (every preset), Word, the manuscript, every ACX script and the box set (a volume with them too) is well-formed; the characters are gone", async () => {
    const y = onDesk(controlCharBook());
    const vol = await volumeFromFile(backupFile(controlCharBook(), 'ctl.json'));
    const out = exportRun((cc) => {
      const a = cc.api;
      const found: string[] = [];
      for (const p of a.PLATFORM_PRESETS) found.push(...notWellFormed(a.epubFiles(p.id), 'epub ' + p.id));
      found.push(...notWellFormed(a.buildDocxFiles(), 'docx'));
      found.push(...notWellFormed(a.msFiles(a.msPlan()), 'ms'));
      for (const e of a.acxZipEntries(a.acxBuildPlan())) if ('docx' in e) found.push(...notWellFormed(e.docx, 'acx ' + e.path));
      (cc.getState() as Rec).boxSetVolumes = [vol];
      found.push(...notWellFormed(a.boxSetFiles(), 'boxset'));
      const md = a.buildMarkdown() + a.buildStandaloneHtml();
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(md)) found.push('markdown / html carry them');
      (cc.getState() as Rec).boxSetVolumes = [];
      return found;
    })!;
    expect(out).toEqual([]);
    // the book itself is never changed by the correction
    expect(JSON.stringify(exportBook(y))).toContain(JSON.stringify(XML_BAD).slice(1, -1).slice(0, 12));
    y.destroy();
  });
});

describe('wave 5c: a hostile book and a hostile volume through Word, the manuscript, the ACX script and the box set (constraint 67)', () => {
  it("the hostile book's Word document, manuscript (every paper, font, italics) and ACX script (every format): no part that fetches, runs or leaves the package", () => {
    for (const book of [hostileExportBook(), hostileNonStringBook()]) {
      const y = onDesk(book);
      const found = exportRun((cc) => {
        const out: string[] = [];
        const a = cc.api;
        out.push(...docxHazards(a.buildDocxFiles(), 'docx'));
        const st = cc.getState() as Rec;
        for (const paper of ['letter', 'a4']) for (const font of ['times', 'courier']) for (const italics of ['italic', 'underline']) {
          st.manuscript = a.msNormalize({ legalName: 'Name <script>window.__pw=41</script>', address: '1 Road"/><w:instrText>INCLUDEPICTURE "https://evil.example/x.png"</w:instrText>', paper, font, italics, byline: 'B </w:t></w:r><w:fldSimple w:instr="INCLUDETEXT https://evil.example"/>', surname: 'S&<' });
          out.push(...docxHazards(a.msFiles(a.msPlan()), `ms ${paper} ${font} ${italics}`));
        }
        for (const fmt of ['both', 'docx', 'txt']) {
          const entries = acxDocx(cc, fmt);
          for (const e of entries) {
            if ('docx' in e) out.push(...docxHazards(e.docx, `acx ${fmt} ${e.path}`));
            else if (!/\.txt$/.test(e.path)) out.push(`acx ${fmt}: ${e.path} is not a text file`);
          }
        }
        return out;
      });
      expect(found).toEqual([]);
      y.destroy();
    }
  });

  it("the hostile book's Word document keeps its one honest link out (https) as a hyperlink, and its javascript: link as words", () => {
    const y = onDesk(hostileExportBook());
    const rels = exportRun((cc) => cc.api.buildDocxFiles().find((f) => f.path === 'word/_rels/document.xml.rels')!.content)!;
    expect(rels).toContain('Target="https://evil.example/a" TargetMode="External"');
    expect(rels).not.toMatch(/javascript/i);
    y.destroy();
  });

  it('a hostile volume (the hostile book as a Beuk backup, added with Add a Book) beside an honest one, under an honest and a hostile open book: the box set carries no script, handler or remote request', async () => {
    const honest = fixtures('real').find((x) => x.name === 'real/reads-you')!.book;
    for (const open of [structuredClone(fixtures('real').find((x) => x.name === 'real/salt-road-book-one')!.book), hostileExportBook()]) {
      const y = onDesk(open);
      const vols: unknown[] = [];
      for (const [b, n] of [[hostileExportBook(), 'hostile.json'], [honest, 'reads-you.json'], [hostileNonStringBook(), 'arrays.json']] as const) vols.push(await volumeFromFile(backupFile(b as Rec, n)));
      const found = exportRun((cc) => {
        (cc.getState() as Rec).boxSetVolumes = vols;
        return [...packageHazards(cc.api.boxSetFiles(), 'boxset'), ...cc.api.PLATFORM_PRESETS.flatMap((p) => packageHazards(cc.api.boxSetFiles(p.id), 'boxset ' + p.id))];
      });
      expect(found).toEqual([]);
      y.destroy();
    }
  });

  it("1.0 finding (the reproducing fixture): 1.0's own box set of the hostile volume, uncorrected, carries handlers and remote requests", () => {
    const y = onDesk(structuredClone(fixtures('real').find((x) => x.name === 'real/salt-road-book-one')!.book));
    const st = arriveForExport(c, exportBook(y) as Rec);
    c.setState(st);
    (st as Rec).boxSetVolumes = [c.api.bookDocToVolume(hostileExportBook(), 'hostile.json')];
    const found = packageHazards(c.api.boxSetFiles(), '1.0 boxset');
    console.log('[1.0 finding, box set] ' + found.length + ' hazards, e.g.:\n  ' + [...new Set(found.map((x) => x.replace(/window\.__pw=\d+/g, 'window.__pw=N')))].slice(0, 12).join('\n  '));
    expect(found.length).toBeGreaterThan(0);
    // 1.0's own Word document, manuscript and ACX script of the hostile book (uncorrected): walked the same way
    const y2 = onDesk(hostileExportBook());
    const st2 = arriveForExport(c, exportBook(y2) as Rec);
    c.setState(st2);
    const docx = [...docxHazards(c.api.buildDocxFiles(), '1.0 docx'), ...docxHazards(c.api.msFiles(c.api.msPlan()), '1.0 ms')];
    console.log('[1.0, Word / manuscript] ' + docx.length + ' hazards' + (docx.length ? ': ' + docx.slice(0, 6).join('; ') : ''));
    y.destroy();
    y2.destroy();
  });

  it('on every honest fixture as a volume, the corrections change nothing', () => {
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const v = c.api.bookDocToVolume(structuredClone(f.book), f.name + '.json');
      const before = JSON.stringify(v);
      expect(exportSafe(c, v as never, v), f.name).toEqual({ images: 0, cover: false, fonts: 0, sections: 0, chars: 0 });
      expect(JSON.stringify(v), f.name).toBe(before);
    }
  });
});
