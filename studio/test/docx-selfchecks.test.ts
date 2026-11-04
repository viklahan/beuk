import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, loadSample, setClosureLang, setClosureT, type Closure, type EpubFile, type State } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, exportRun, loadSerialize, volumeFromFile } from '../src/export/state';
import { styleRelease } from '../src/style/session';
import { PNG_1PX } from './style-fixture';

/* Wave 5c, task 3 — 1.0's self-checks for Word, the box set, the submission manuscript and the ACX script
   (client/index.html, verified by grep: feature "boxset-docx" 7 — of them "boxset." 5 and "docx." 2; feature "acx" 4;
   the manuscript's "export.manuscript*" 4: 3 in msSelfChecks, 1 in msAsyncSelfChecks), re-expressed on 1.0's own code
   through the browser closure, on 1.0's own fixtures (its sample, its empty book, its "Second Tide" volume, its
   "Check Harbour" and "Tide Ledger" books), with a 1×1 PNG for 1.0's FAKE_PNG. And the halves earlier waves left to 5c:
   epub.props.sample-declared-exactly and epub.spine.nav-links-reach-spine (their box-set half), starters.empty-left-out
   (its Word and manuscript half). The ids not here are listed in the report with a reason. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let ser: (c: Closure) => Rec;
const REPO = path.join(import.meta.dirname, '..', '..') + path.sep;
beforeAll(async () => {
  // wave 6: Add a Book's volumes are 1.0's own (src/import/import.ts importWire wires them)
  await (await import('../src/import/import')).importWire();
  c = await loadClosure();
  await loadSample();
  ser = await loadSerialize();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
});
const scText = (files: EpubFile[], p: string) => String(files.find((f) => f.path === p)?.content ?? '');
const scFile = (files: EpubFile[], p: string) => files.find((f) => f.path === p);
function sampleBook(): Rec {
  c.setState(arriveForExport(c, c.api.buildEmptyBook()));
  const b = c.sample!.buildSampleBook() as unknown as Rec & { images: Rec[]; cover: Rec | null };
  const files = new Map(c.api.SAMPLE_IMAGE_FILES.map((m) => [m.id, m.file]));
  for (const im of b.images) if (!im.data && files.has(String(im.id))) im.data = readFileSync(REPO + 'client/assets/sample/' + files.get(String(im.id)), 'base64');
  if (b.cover && !b.cover.data) b.cover.data = readFileSync(REPO + 'client/assets/sample/' + c.api.SAMPLE_COVER_FILE.file, 'base64');
  return b;
}
/** 1.0's state of `book` on the desk, for the export (the session's: what a check changes in it stands). */
function on(book: Rec): State & Rec {
  const y = new Y.Doc();
  importBook(book, y);
  desk.ydoc = y;
  exportReset();
  return exportRun((cc) => cc.getState()) as State & Rec;
}
/** 1.0's applyBookDoc of a fixture document (as 1.0's own checks build theirs), set as the closure's state. */
function applied(doc: Rec): State & Rec {
  const st = arriveForExport(c, doc) as State & Rec;
  c.setState(st);
  return st;
}
const mk = (kind: string, type: string, title: string, extra?: Rec) => c.api.mkSection(kind, type, title, extra);
/** 1.0's "The Second Tide" volume (its box-set checks). */
const secondTide = (extra: Rec = {}) => ({
  id: 'scvol2',
  meta: { title: 'The Second Tide', subtitle: '', author: 'April Carooke', publisher: '', isbn: '', language: 'en', year: '2026', rights: '', description: '', bookId: 'urn:uuid:sc-boxset-vol2' },
  sections: [mk('front', 'titlepage', 'Title Page'), mk('body', 'chapter', 'First Light', { number: 'One', content: 'Book two opens quietly.' })],
  cover: null,
  images: [],
  ...extra,
});

describe("1.0's box-set and Word self-checks (feature boxset-docx, 7)", () => {
  it('boxset.structure.dividers-titlepages-spine', () => {
    const st = on(sampleBook());
    const a = c.api;
    st.boxSetVolumes = [secondTide()];
    const files = a.boxSetFiles('generic');
    const opf = scText(files, 'OEBPS/package.opf');
    const at = (n: string) => opf.indexOf(n);
    expect(
      !!scFile(files, 'OEBPS/Text/vol01-divider.xhtml') && !!scFile(files, 'OEBPS/Text/vol02-divider.xhtml') &&
        !!scFile(files, 'OEBPS/Text/vol01-titlepage.xhtml') && !!scFile(files, 'OEBPS/Text/vol02-titlepage.xhtml') &&
        scText(files, 'OEBPS/Text/vol02-divider.xhtml').includes('The Second Tide') &&
        scText(files, 'OEBPS/Text/vol02-titlepage.xhtml').includes('The Second Tide') &&
        at('<itemref idref="sec-vol01-divider"/>') !== -1 &&
        at('<itemref idref="sec-vol01-divider"/>') < at('<itemref idref="sec-vol01-titlepage"/>') &&
        at('<itemref idref="sec-vol01-titlepage"/>') < at('<itemref idref="sec-vol01-chapter_01"/>') &&
        at('<itemref idref="sec-vol01-chapter_01"/>') < at('<itemref idref="sec-vol02-divider"/>') &&
        at('<itemref idref="sec-vol02-divider"/>') < at('<itemref idref="sec-vol02-titlepage"/>') &&
        at('<itemref idref="sec-vol02-titlepage"/>') < at('<itemref idref="sec-vol02-chapter_01"/>') &&
        a.boxSetFilename('generic') === a.slug(st.meta.title) + '-box-set.epub',
    ).toBe(true);
  });

  it('boxset.toc.combined-parts', () => {
    const st = on(sampleBook());
    const a = c.api;
    st.boxSetVolumes = [secondTide()];
    const files = a.boxSetFiles('generic');
    const nav = scText(files, 'OEBPS/nav.xhtml');
    const ncx = scText(files, 'OEBPS/toc.ncx');
    const title = a.esc(st.meta.title);
    expect(nav).toContain('<a href="Text/vol02-divider.xhtml">The Second Tide</a>');
    expect(nav).toContain('<a href="Text/vol02-chapter_01.xhtml">Chapter One · First Light</a>');
    expect(nav).toContain('<a href="Text/vol01-divider.xhtml">' + title + '</a>');
    expect(nav.includes('epub:type="toc"') && nav.includes('epub:type="bodymatter"')).toBe(true);
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
    expect(ncx.includes('<text>The Second Tide</text>') && ncx.includes('<text>' + title + '</text>')).toBe(true);
    expect(ncx.indexOf('<text>The Second Tide</text>')).toBeLessThan(ncx.indexOf('<text>Chapter One · First Light</text>'));
  });

  it('boxset.carries.cover-images-notes', () => {
    const st = on(sampleBook());
    const a = c.api;
    st.boxSetVolumes = [
      secondTide({
        sections: [mk('front', 'titlepage', 'Title Page'), mk('body', 'chapter', 'First Light', { number: 'One', content: 'A chart appears.[^1]\n\n![Second book map](img:scboximg1)\n\n[^1]: A note belonging to book two.' })],
        cover: { data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: 'Second Cover.png' },
        images: [{ id: 'scboximg1', name: 'Map Two.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX }],
      }),
    ];
    const files = a.boxSetFiles('generic');
    const opf = scText(files, 'OEBPS/package.opf');
    const ch = scText(files, 'OEBPS/Text/vol02-chapter_01.xhtml');
    expect(!!scFile(files, 'OEBPS/Images/vol02-cover.png') && !!scFile(files, 'OEBPS/Images/map-two-scboximg1.png')).toBe(true);
    expect(opf.includes('href="Images/vol02-cover.png"') && opf.includes('<item id="img-scboximg1"')).toBe(true);
    expect(scText(files, 'OEBPS/Text/vol02-cover.xhtml')).toContain('src="../Images/vol02-cover.png"');
    expect(ch.includes('epub:type="noteref"') && ch.includes('epub:type="endnote"') && ch.includes('A note belonging to book two.')).toBe(true);
    expect(ch).toContain('<img src="../Images/map-two-scboximg1.png" alt="Second book map"/>');
  });

  it('docx.package.structure', () => {
    on(sampleBook());
    const files = c.api.buildDocxFiles();
    const types = scText(files, '[Content_Types].xml');
    const styles = scText(files, 'word/styles.xml');
    const doc = scText(files, 'word/document.xml');
    expect(!!scFile(files, '_rels/.rels') && !!scFile(files, 'word/_rels/document.xml.rels')).toBe(true);
    expect(types.includes('wordprocessingml.document.main+xml') && types.includes('/word/document.xml')).toBe(true);
    expect(styles.includes('<w:style w:type="paragraph" w:styleId="Heading1">') && styles.includes('<w:name w:val="heading 1"/>') && styles.includes('<w:style w:type="paragraph" w:styleId="Title">')).toBe(true);
    expect(doc.startsWith('<?xml version="1.0"') && doc.includes('<w:document') && doc.includes('<w:body>')).toBe(true);
  });

  it('docx.content.headings-scenebreak-endnotes', () => {
    const st = on(sampleBook());
    const a = c.api;
    const s = (st.sections as Rec[]).find((x) => x.type === 'chapter')!;
    s.content = 'Opening line worth sourcing.[^1]\n\n***\n\n# Interlude Heading\n\nClosing line of the chapter.\n\n[^1]: DOCX check note text.';
    const doc = (a as unknown as { buildDocxDocumentXml: () => string }).buildDocxDocumentXml();
    expect(doc.includes('<w:pStyle w:val="Title"/>') && doc.includes(a.esc(st.meta.title))).toBe(true);
    expect(doc.includes('<w:pStyle w:val="Heading1"/>') && doc.includes('Chapter ' + s.number + ': ' + a.esc(s.title))).toBe(true);
    expect(doc.includes('<w:pStyle w:val="Heading2"/>') && doc.includes('Interlude Heading')).toBe(true);
    expect(doc).toContain('* * *');
    expect(doc).toContain('<w:vertAlign w:val="superscript"/>');
    expect(doc).toContain('>Endnotes<');
    expect(doc.indexOf('DOCX check note text.')).toBeGreaterThan(doc.indexOf('Closing line of the chapter.'));
    expect((doc.match(/DOCX check note text\./g) || []).length).toBe(1);
  });

  it("boxset.volumes.whole-books (its Beuk-backup half, on 1.0's empty book: two backups whose picture ids collide with each other's; the Markdown half is 1.0's import, wave 6)", async () => {
    // 1.0's empty book, credited (the validator asks a set for an author and a title; 1.0's check runs on the desk's book,
    // and the sample's three Parts collide: the finding above)
    const empty = c.api.buildEmptyBook() as Rec & { meta?: Rec };
    empty.meta = { ...(empty.meta || {}), title: 'The Oz Set', author: 'L. Frank Baum' };
    const st = on(empty);
    const a = c.api;
    const own = ((st.images as Rec[]) || []).filter((im) => im && im.id).slice(0, 2).map((im) => String(im.id));
    while (own.length < 2) own.push('scbsvimg' + own.length);
    const pic = (id: string, name: string) => ({ id, name, mediaType: 'image/png', ext: 'png', data: PNG_1PX });
    const bookOf = (title: string) => ({
      meta: { title, author: 'L. Frank Baum', language: 'en', bookId: 'urn:uuid:sc-bsv-' + a.slug(title) },
      sections: [mk('front', 'cover', 'Cover'), mk('front', 'titlepage', 'Title Page'),
        Object.assign(mk('body', 'chapter', 'The Rose Princess', { number: '1', content: 'Betsy looked up.\n\n![The rose garden](img:' + own[0] + ')\n\nThen she ran.\n\n***\n\nThe end of the day.' }), { plateId: own[1], plateAlt: 'The Rose Princess', scenes: [{ at: 0, imageId: 'scbsvscene', name: '', caption: '', alt: 'A scene' }] })],
      cover: { data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: title + ' cover.png' },
      images: [pic(own[0]!, 'Rose Garden.png'), pic(own[1]!, 'Plate.png'), pic('scbsvscene', 'Scene.png')],
    });
    const backup = (title: string, file: string) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: bookOf(title) })], file, { type: 'application/json' });
    const vols = [
      (await volumeFromFile(backup('Tik-Tok of Oz', 'tik-tok-of-oz-2026-10-27.beuk-backup.json'))) as Rec & { meta: Rec },
      (await volumeFromFile(backup('The Forty-Five Guardsmen', 'the-forty-five-guardsmen-2026-10-27.beuk-backup.json'))) as Rec & { meta: Rec },
    ];
    expect(vols.map((v) => v.meta.title)).toEqual(['Tik-Tok of Oz', 'The Forty-Five Guardsmen']);
    const bad: string[] = [];
    exportRun((cc) => {
      (cc.getState() as Rec).boxSetVolumes = vols;
      const files = cc.api.boxSetFiles('generic');
      const byPath = new Map(files.map((f) => [f.path, f]));
      const opf = scText(files, 'OEBPS/package.opf');
      const hrefs = Array.from(opf.matchAll(/<item id="([^"]+)" href="(Images\/[^"]+)"/g)).map((m) => ({ id: m[1], href: m[2]! }));
      if (new Set(hrefs.map((h) => h.href)).size !== hrefs.length) bad.push('an image is declared twice in the manifest');
      if (new Set(files.map((f) => f.path)).size !== files.length) bad.push('two package files share one path');
      hrefs.forEach((h) => { if (!byPath.has('OEBPS/' + h.href)) bad.push('manifest names a missing ' + h.href); });
      for (const n of [2, 3]) {
        const vp = 'vol' + String(n).padStart(2, '0');
        const ch = scText(files, 'OEBPS/Text/' + vp + '-chapter_01.xhtml');
        const srcs = Array.from(ch.matchAll(/src="\.\.\/(Images\/[^"]+)"/g)).map((m) => m[1]!);
        const shipped = srcs.filter((p) => byPath.has('OEBPS/' + p) && hrefs.some((h) => h.href === p));
        if (shipped.length < 3) bad.push('Book ' + n + ' shows ' + shipped.length + ' of its 3 pictures');
        if (!byPath.has('OEBPS/Images/' + vp + '-cover.png') || !scText(files, 'OEBPS/Text/' + vp + '-cover.xhtml').includes(vp + '-cover.png')) bad.push('Book ' + n + "'s cover is missing");
      }
      const v2 = Array.from(scText(files, 'OEBPS/Text/vol02-chapter_01.xhtml').matchAll(/src="\.\.\/(Images\/[^"]+)"/g)).map((m) => m[1]);
      const v3 = Array.from(scText(files, 'OEBPS/Text/vol03-chapter_01.xhtml').matchAll(/src="\.\.\/(Images\/[^"]+)"/g)).map((m) => m[1]);
      if (v2.some((p) => v3.includes(p))) bad.push('Books Two and Three share a picture file');
      const nav = scText(files, 'OEBPS/nav.xhtml');
      for (const tt of ['Tik-Tok of Oz', 'The Forty-Five Guardsmen']) if (!nav.includes(cc.api.esc(tt))) bad.push('Contents lacks ' + tt);
      const errs = cc.api.validateEpubPackage(files).results.filter((r) => r.level === 'error');
      if (errs.length) bad.push('validator: ' + errs.map((r) => r.id + ' ' + r.detail).join(' | ').slice(0, 300));
    });
    expect(bad).toEqual([]);
  });
});

describe('1.0 finding: a volume with more than one Part', () => {
  it("1.0's boxSetPlan names every Part of a volume Text/volNN-part.xhtml: the sample (three Parts) as Book One gives three package files on one path, and the validator says so", () => {
    const st = on(sampleBook());
    expect((st.sections as Rec[]).filter((s) => s.type === 'part' && c.api.inBook(s)).length).toBe(3);
    st.boxSetVolumes = [secondTide()];
    const files = c.api.boxSetFiles('generic');
    expect(files.filter((f) => f.path === 'OEBPS/Text/vol01-part.xhtml').length).toBe(3);
    const errs = c.api.validateEpubPackage(files).results.filter((r) => r.level === 'error').map((r) => r.detail);
    expect(errs.some((d) => /sec-vol01-part.*declared 3 times/.test(d))).toBe(true);
  });
});

describe('the box-set halves of two epub self-checks (5a left them to 5c)', () => {
  it('epub.props.sample-declared-exactly (the box set)', () => {
    const st = on(sampleBook());
    st.boxSetVolumes = [secondTide()];
    const bad: string[] = [];
    c.api.epubManifestPropertyReport(c.api.boxSetFiles('generic')).items.forEach((it) => {
      if (it.missing.length || it.extra.length) bad.push('box set: ' + it.href + ' missing [' + it.missing.join(' ') + '] extra [' + it.extra.join(' ') + ']');
    });
    expect(bad).toEqual([]);
  });
  it('epub.spine.nav-links-reach-spine (the box set)', () => {
    const st = on(sampleBook());
    st.boxSetVolumes = [secondTide()];
    expect(c.api.epubLinksOutsideSpine(c.api.boxSetFiles('kdp')).map((o) => o.from + ' -> ' + o.href)).toEqual([]);
  });
});

describe("1.0's submission manuscript self-checks (export.manuscript*, 3 of 4; the round trip is 1.0's Word import, wave 6)", () => {
  const msFixture = () =>
    applied({
      meta: { title: 'The Tide Ledger', subtitle: '', author: 'Mara Quill', language: 'en', langSource: 'manual' },
      theme: Object.assign({}, c.api.PRESETS[0]!.theme, { bodyFont: 'Cormorant Garamond' }),
      sections: [
        mk('front', 'titlepage', 'Title Page'),
        mk('front', 'copyright', 'Copyright'),
        mk('front', 'dedication', 'Dedication', { content: 'For the keepers of unlisted channels.' }),
        mk('body', 'chapter', 'Arrival', { number: '1', content: 'The ferry left at *first light*.[^1]\n\n***\n\n![The quay at dusk](img:nope "The quay at dusk")\n\nShe opened the ||secret|| drawer.\n\n::: verse\nThe tide runs east,\nthe tide runs west.\n:::\n\n::: letter\nDear Mara,\n\nCome home.\n:::\n\n[^1]: The chart survives in no archive.' }),
        mk('body', 'chapter', 'Departure', { number: '2', content: 'She left at dawn.\n\n::: columns\nA note in two columns.\n:::' }),
        mk('back', 'aboutauthor', 'About the Author', { content: 'Mara Quill lives by the sea.' }),
      ],
      manuscript: { legalName: 'Margaret Quillon', address: '12 Harbour Row\nPortsalt PS1 2AB', phone: '+44 1234 567890', email: 'mq@example.com', byline: 'Mara Quill' },
    });
  const docOf = (files: EpubFile[]) => scText(files, 'word/document.xml');

  it('export.manuscript', () => {
    const st = msFixture();
    const a = c.api;
    const bad: string[] = [];
    const files = a.msFiles();
    const doc = docOf(files);
    const sty = scText(files, 'word/styles.xml'), hdr = scText(files, 'word/header1.xml'), rels = scText(files, 'word/_rels/document.xml.rels'), ct = scText(files, '[Content_Types].xml');
    const has = (s: string, what: string) => { if (doc.indexOf(s) === -1) bad.push('no ' + what); };
    ['Margaret Quillon', '12 Harbour Row', 'Portsalt PS1 2AB', '+44 1234 567890', 'mq@example.com'].forEach((s) => has(s, 'contact line ' + s));
    has('<w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">about 100 words</w:t></w:r>', 'word count at the right of the first line');
    has('>THE TIDE LEDGER<', 'title in capitals');
    has('>by Mara Quill<', 'by-line');
    if (/Mara Quill lives/.test(doc)) bad.push('about-the-author leaked');
    ['For the keepers', 'All rights reserved', 'Typeset with Beuk', '* * *', '[Image:', 'The quay at dusk', 'Cormorant', 'w:shd', 'w:pBdr', 'w:color', 'w:cols w:num="2"', 'secret'].forEach((s) => { if (doc.indexOf(s) !== -1 || (s === 'Cormorant' && sty.indexOf(s) !== -1)) bad.push('leaked: ' + s); });
    has('>Chapter 1: Arrival<', 'chapter 1 heading');
    has('>Chapter 2: Departure<', 'chapter 2 heading');
    has('<w:pStyle w:val="Heading1"/><w:pageBreakBefore w:val="0"/>', 'first chapter without an extra page break');
    if ((doc.match(/<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Chapter 2/g) || []).length !== 1) bad.push('chapter 2 heading not a page-breaking Heading 1');
    if (!/<w:style w:type="paragraph" w:styleId="Heading1">[\s\S]*?<w:pageBreakBefore\/>[\s\S]*?<\/w:style>/.test(sty)) bad.push('Heading 1 does not start a new page');
    has('<w:pStyle w:val="MsBreak"/></w:pPr><w:r><w:t xml:space="preserve">#</w:t></w:r>', '# scene break');
    has('<w:pStyle w:val="MsEnd"/></w:pPr><w:r><w:t xml:space="preserve">END</w:t></w:r>', 'END');
    if (doc.lastIndexOf('>END<') < doc.indexOf('She left at dawn')) bad.push('END is not after the last chapter');
    has('<w:i/></w:rPr><w:t xml:space="preserve">first light', 'italics kept');
    has('████', 'the redaction blacked out');
    has('The tide runs east,</w:t></w:r><w:r><w:br/></w:r>', 'verse line break kept');
    has('>Notes<', 'Notes page');
    has('The chart survives in no archive.', "the note's text");
    if (!/<w:style w:type="paragraph" w:default="1" w:styleId="Normal">[\s\S]*?<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"\/><w:ind w:left="0" w:firstLine="720"\/><w:jc w:val="left"\/>[\s\S]*?<w:sz w:val="24"\/>/.test(sty)) bad.push('Normal is not 12 pt, double-spaced, half-inch indent, ragged');
    if (sty.indexOf('<w:suppressAutoHyphens/>') === -1) bad.push('hyphenation not off');
    if (sty.indexOf('w:ascii="Times New Roman"') === -1) bad.push('not Times New Roman');
    if (!/<w:sectPr><w:headerReference w:type="default" r:id="rIdMsHeader"\/><w:pgSz w:w="12240" w:h="15840"\/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"[^>]*\/><w:pgNumType w:start="1"\/><\/w:sectPr><\/w:body>/.test(doc)) bad.push("the text's section");
    if (!/<w:sectPr><w:pgSz w:w="12240" w:h="15840"\/><w:pgMar[^>]*\/><\/w:sectPr><\/w:pPr><w:r><w:t xml:space="preserve">by Mara Quill/.test(doc)) bad.push('the title page is not its own section without a header');
    if (hdr.indexOf('>Quill / THE TIDE LEDGER / <') === -1 || hdr.indexOf(' PAGE ') === -1) bad.push('header is not Surname / TITLE / page');
    if (rels.indexOf('Target="header1.xml"') === -1 || ct.indexOf('/word/header1.xml') === -1) bad.push('header part not wired');
    st.manuscript = a.msNormalize(Object.assign({}, st.manuscript, { italics: 'underline', paper: 'a4', font: 'courier' }));
    const f2 = a.msFiles(), d2 = docOf(f2), s2 = scText(f2, 'word/styles.xml');
    if (d2.indexOf('<w:u w:val="single"/></w:rPr><w:t xml:space="preserve">first light') === -1 || /<w:i\/><\/w:rPr><w:t xml:space="preserve">first light/.test(d2)) bad.push('underline option does not replace italics');
    if (d2.indexOf('<w:pgSz w:w="11906" w:h="16838"/>') === -1) bad.push('A4 not applied');
    if (s2.indexOf('w:ascii="Courier New"') === -1) bad.push('Courier option not applied');
    expect(bad).toEqual([]);
  });

  it('export.manuscript.contact-persists', () => {
    const st = msFixture();
    const a = c.api;
    st.manuscript = a.msNormalize(Object.assign({}, st.manuscript, { paper: 'a4', surname: 'Quill-Smith' }));
    const doc = JSON.parse(JSON.stringify(ser(c))) as Rec;
    expect((doc.manuscript as Rec).email).toBe('mq@example.com');
    const back = applied(doc);
    expect(back.manuscript).toMatchObject({ legalName: 'Margaret Quillon', address: '12 Harbour Row\nPortsalt PS1 2AB', phone: '+44 1234 567890', byline: 'Mara Quill', paper: 'a4', surname: 'Quill-Smith' });
    delete doc.manuscript;
    const e = applied(doc).manuscript as Rec;
    expect(e).toEqual({ legalName: '', address: '', phone: '', email: '', byline: '', surname: '', paper: 'letter', font: 'times', italics: 'italic' });
    const xml = docOf(a.msFiles());
    expect(/Margaret|Harbour Row|example\.com/.test(xml)).toBe(false);
    expect(xml).toContain('>by Mara Quill<');
  });

  it('export.manuscript.wordcount', () => {
    const cases: [number, number][] = [[0, 0], [40, 100], [149, 100], [151, 200], [9949, 9900], [9999, 10000], [10000, 10000], [84712, 85000], [85499, 85000], [120501, 121000]];
    expect(cases.filter((x) => c.api.msRoundWords(x[0]) !== x[1])).toEqual([]);
  });

  it('starters.empty-left-out (5a left its Word and manuscript half): an empty starter is in neither; a written dedication is', () => {
    const e = sampleBook() as Rec & { sections: Rec[] };
    const by = (ty: string) => e.sections.find((x) => x.type === ty)!;
    by('epigraph').title = 'Zqempty Alpha';
    by('epigraph').content = '  \n ';
    by('dedication').content = 'For Marrow Quell.';
    by('acknowledgments').content = 'Thanks to Quillon Vane.';
    by('acknowledgments').included = false;
    on(e);
    const docx = (c.api as unknown as { buildDocxDocumentXml: () => string }).buildDocxDocumentXml();
    const ms = JSON.stringify(c.api.msPlan().left);
    expect(/Zqempty/.test(docx) || /Zqempty/.test(ms)).toBe(false);
    expect(docx).toContain('Marrow Quell');
    expect(ms).toContain(String(by('dedication').title));
    expect(docx.includes('Quillon Vane') || ms.includes('Quillon Vane')).toBe(false);
  });
});

describe("1.0's ACX self-checks (feature acx, 4)", () => {
  const acxFixture = () =>
    applied({
      meta: { title: 'Check Harbour', subtitle: 'A test', author: 'Ada Check', language: 'en', langSource: 'manual' },
      sections: [
        mk('front', 'titlepage', 'Title Page'),
        mk('front', 'toc', 'Table of Contents'),
        mk('body', 'chapter', 'Arrival', { number: '1', content: 'Quillon walked to the quay. He met Bryndle there.[^1]\n\n***\n\n![The quay at dusk](img:nope)\n\nLater, Quillon and Bryndle argued about the *saudade* of tides.\n\n[^1]: Bryndle is the harbour cat.' }),
        mk('body', 'chapter', 'Departure', { number: '2', content: 'Quillon left at dawn. Nobody waved.' }),
      ],
      audio: { narrator: 'Nell Reader', pron: [{ word: 'Quillon', soundsLike: 'KWILL-on', ipa: 'ˈkwɪlɒn' }] },
    });
  const fileTxt = (f: unknown) => (c.api as unknown as { acxFileTxt: (f: unknown) => string }).acxFileTxt(f);

  it('acx.files.order-and-credits', () => {
    acxFixture();
    const plan = c.api.acxBuildPlan();
    const names = plan.files.map((f) => f.name);
    const open = fileTxt(plan.files[0]), close = fileTxt(plan.files[plan.files.length - 1]);
    expect(names.join('|')).toBe('00 Opening Credits|01 Chapter 1 - Arrival|02 Chapter 2 - Departure|03 Closing Credits');
    expect(['Check Harbour', 'Ada Check', 'Nell Reader'].every((s) => open.includes(s) && close.includes(s))).toBe(true);
    expect(close.includes('You have been listening to') && /The End\.\s*$/.test(close)).toBe(true);
    expect((plan.excluded as Rec[]).some((x) => x.reason === 'toc')).toBe(true);
    expect(fileTxt(plan.files[1]).indexOf('Chapter 1: Arrival')).toBe(0);
  });

  it('acx.script.notes-images-pauses', () => {
    acxFixture();
    const txt = fileTxt(c.api.acxBuildPlan().files[1]);
    expect(txt).toContain('[NARRATOR DECISION — footnote 1: “Bryndle is the harbour cat.”');
    expect(txt).toContain('[IMAGE: The quay at dusk]');
    expect(txt).toContain('[PAUSE — scene break]');
    expect(txt).not.toContain('[^1]:');
  });

  it('acx.pron.detect-roundtrip-first-note', () => {
    acxFixture();
    const det = c.api.acxDetectCandidates(0).list.map((x) => x.word);
    const st = applied(JSON.parse(JSON.stringify(ser(c))) as Rec);
    const audio = st.audio as Rec & { pron: Rec[] };
    expect(audio.pron.length === 1 && audio.pron[0]!.soundsLike === 'KWILL-on' && audio.narrator === 'Nell Reader').toBe(true);
    const plan = c.api.acxBuildPlan();
    const all = plan.files.map(fileTxt).join('\n');
    expect(det).toEqual(expect.arrayContaining(['Quillon', 'Bryndle', 'saudade']));
    expect(det).not.toContain('Nobody');
    expect((all.match(/\[PRONUNCIATION: Quillon/g) || []).length).toBe(1);
    expect(fileTxt(plan.files[1])).toContain('[PRONUNCIATION: Quillon — sounds like “KWILL-on” — IPA /ˈkwɪlɒn/]');
  });

  it('acx.estimate.words-per-hour', () => {
    const st = acxFixture();
    const ch = (st.sections as Rec[]).find((s) => s.title === 'Departure')!;
    ch.content = Array(19000).fill('tide').join(' ') + '.';
    const plan = c.api.acxBuildPlan() as unknown as Rec & { totalHours: number; totalWords: number; files: Rec[]; warnings: Rec[] };
    const f = plan.files[2]!;
    expect(Math.abs(plan.totalHours - plan.totalWords / 9300)).toBeLessThan(1e-9);
    expect(f.minutes as number).toBeGreaterThan(120);
    expect(plan.warnings.some((w) => w.key === 'long' && w.file === f.name)).toBe(true);
  });
});
