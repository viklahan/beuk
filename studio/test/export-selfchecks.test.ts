import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { cloudFacts, coverEnv, covEnv, loadClosure, loadSample, setClosureLang, setClosureT, type Closure, type EpubFile, type State } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { apiFetch } from '../src/covenant/net';
import { coverFetch } from '../src/cover/cover';
import { arriveForExport, exportReset, exportRun, exportUi, loadSerialize } from '../src/export/state';
import { styleRelease } from '../src/style/session';
import { PNG_1PX } from './style-fixture';

/* Wave 5a, task 3 — 1.0's export self-checks (client/index.html, verified by grep: feature "presets" 12, "validator" 8,
   "a11y" 2, "epub" 11, "export" 9), re-expressed on 1.0's own code through the browser closure, on 1.0's own fixture
   books (its sample, its empty book), with 1.0's FAKE_PNG-sized picture. The ids not here are listed in the report with
   a reason (Word, manuscript, print, box set, book-id migration's device record, the wrap: other waves). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
const REPO = path.join(import.meta.dirname, '..', '..') + path.sep;
beforeAll(async () => {
  c = await loadClosure();
  await loadSample();
  await loadSerialize();
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
/** 1.0's sample, with its pictures as 1.0's desk holds them (the files under client/assets/sample). */
function sampleBook(): Rec {
  c.setState(arriveForExport(c, c.api.buildEmptyBook())); // 1.0's buildSampleBook reads the desk's state (its theme)
  const b = c.sample!.buildSampleBook() as unknown as Rec & { images: Rec[]; cover: Rec | null };
  const files = new Map(c.api.SAMPLE_IMAGE_FILES.map((m) => [m.id, m.file]));
  for (const im of b.images) if (!im.data && files.has(String(im.id))) im.data = readFileSync(REPO + 'client/assets/sample/' + files.get(String(im.id)), 'base64');
  if (b.cover && !b.cover.data) b.cover.data = readFileSync(REPO + 'client/assets/sample/' + c.api.SAMPLE_COVER_FILE.file, 'base64');
  return b;
}
/** 1.0's state of `book` on the desk, for the export: the session's (built, corrected, set), so a later exportRun reads
 *  the same state and what a check changes in it stands (the book itself is never written). */
function on(book: Rec): State & Rec {
  const y = new Y.Doc();
  importBook(book, y);
  desk.ydoc = y;
  exportReset();
  return exportRun((cc) => cc.getState()) as State & Rec;
}
const sample = () => on(sampleBook());

describe("1.0's presets self-checks (feature presets, 12)", () => {
  it('presets.* and export.preset.googleplay', () => {
    const st = sample();
    const a = c.api;
    const slug = a.slug(st.meta.title);
    const opf = (id: string) => scText(a.epubFiles(id), 'OEBPS/package.opf');
    const apple = (id: string) => !!scFile(a.epubFiles(id), 'META-INF/com.apple.ibooks.display-options.xml');
    // presets.generic.baseline
    expect(!apple('generic') && !opf('generic').includes('<guide>') && opf('generic').includes('schema:accessMode') && a.platformFilename('generic') === slug + '.epub').toBe(true);
    // presets.kdp.guide-and-name, presets.smashwords.guide-and-name
    for (const [id, suf] of [['kdp', '-kdp'], ['smashwords', '-smashwords']]) {
      const o = opf(id!);
      expect(o.includes('<guide>') && o.includes('<reference type="toc"') && o.includes('<reference type="text"') && a.platformFilename(id) === slug + suf + '.epub', id).toBe(true);
    }
    // presets.apple.display-options-and-a11y
    const opts = scText(a.epubFiles('apple'), 'META-INF/com.apple.ibooks.display-options.xml');
    expect(opts.includes('<display_options>') && opts.includes('<option name="specified-fonts">true</option>') && opf('apple').includes('schema:accessMode') && a.platformFilename('apple') === slug + '-apple-books.epub').toBe(true);
    // presets.kobo / overdrive / tolino .a11y-only
    for (const [id, suf] of [['kobo', '-kobo'], ['overdrive', '-overdrive'], ['tolino', '-tolino']]) {
      expect(opf(id!).includes('schema:accessibilityFeature') && !opf(id!).includes('<guide>') && !apple(id!) && a.platformFilename(id) === slug + suf + '.epub', id).toBe(true);
    }
    // presets.nook.guide-and-name
    expect(opf('nook').includes('<guide>') && opf('nook').includes('<reference type="text"') && a.platformFilename('nook') === slug + '-nook.epub').toBe(true);
    // presets.d2d.all-additions
    expect(opf('d2d').includes('<guide>') && apple('d2d') && opf('d2d').includes('schema:accessMode') && a.platformFilename('d2d') === slug + '-draft2digital.epub').toBe(true);
    // presets.scribd.standard-package
    expect(!opf('scribd').includes('<guide>') && opf('scribd').includes('schema:accessMode') && !apple('scribd') && a.platformFilename('scribd') === slug + '-scribd.epub').toBe(true);
    // export.preset.googleplay
    const ids = a.PLATFORM_PRESETS.map((x) => x.id);
    expect(ids.length === 11 && ['generic', 'kdp', 'apple', 'kobo', 'nook', 'd2d', 'overdrive', 'smashwords', 'tolino', 'scribd'].every((id) => ids.includes(id))).toBe(true);
    expect(!apple('googleplay') && !opf('googleplay').includes('<guide>') && opf('googleplay').includes('schema:accessMode') && a.platformFilename('googleplay') === slug + '-google-play.epub').toBe(true);
    // presets.identifier.isbn-or-uuid
    st.meta.isbn = '978-1-23456-789-0';
    expect(opf('kdp')).toContain('<dc:identifier id="pub-id">urn:isbn:9781234567890</dc:identifier>');
    st.meta.isbn = '';
    expect(opf('generic')).toContain('<dc:identifier id="pub-id">' + st.meta.bookId + '</dc:identifier>');
  });
});

describe("1.0's validator self-checks (feature validator, 8)", () => {
  it('validator.clean-book.no-errors', () => {
    const st = sample();
    const a = c.api;
    const core = ['mimetype.first-stored', 'container.points-to-opf', 'xml.well-formed', 'manifest.matches-files', 'spine.resolves', 'nav.landmarks', 'ncx.present-targets', 'links.anchors-resolve', 'images.alt-text', 'metadata.required'];
    const v = a.validateEpubPackage(a.epubFiles('generic'));
    expect(core.filter((id) => v.results.find((x) => x.id === id)?.level !== 'pass')).toEqual([]);
    expect(v.errors).toBe(0);
    st.cover = { data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: 'Validator Cover.png' };
    const w = a.validateEpubPackage(a.epubFiles('generic'));
    expect(w.errors).toBe(0);
    expect(w.results.find((x) => x.id === 'cover.declared')?.level).toBe('pass');
  });
  it('validator.catches.missing-file, malformed-xml, dangling-anchor; help.validator.beuk-codes', () => {
    sample();
    const a = c.api;
    let v = a.validateEpubPackage(a.epubFiles('generic').filter((f) => f.path !== 'OEBPS/Text/chapter_01.xhtml'));
    const man = v.results.find((x) => x.id === 'manifest.matches-files')!;
    expect(v.errors > 0 && man.level === 'error' && man.detail.includes('chapter_01.xhtml')).toBe(true);
    v = a.validateEpubPackage(a.epubFiles('generic').map((f) => (f.path === 'OEBPS/package.opf' ? { ...f, content: f.content.replace('</package>', '') } : f)));
    const wf = v.results.find((x) => x.id === 'xml.well-formed')!;
    expect(wf.level === 'error' && wf.detail.includes('package.opf')).toBe(true);
    v = a.validateEpubPackage(a.epubFiles('generic').map((f) => (f.path === 'OEBPS/Text/chapter_01.xhtml' ? { ...f, content: f.content.replace('</body>', '<p><a href="#fn-missing">dangling check link</a></p></body>') } : f)));
    const lk = v.results.find((x) => x.id === 'links.anchors-resolve')!;
    expect(lk.level === 'error' && lk.detail.includes('fn-missing')).toBe(true);
    // help.validator.beuk-codes
    v = a.validateEpubPackage(a.epubFiles('generic').map((f) => (f.path === 'OEBPS/Text/chapter_01.xhtml' ? { ...f, content: String(f.content).replace('</p>', '') } : f)));
    expect(v.results.filter((r) => !a.BEUK_VALIDATOR_CODES[r.id]).map((r) => r.id)).toEqual([]);
    const html = a.validationListHtml(v.results, () => 'x');
    const failing = v.results.filter((r) => r.level !== 'pass');
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.every((r) => html.includes('href="/help/errors/' + a.BEUK_VALIDATOR_CODES[r.id] + '"'))).toBe(true);
    expect((html.match(/class="v-code"/g) || []).length).toBe(failing.length);
    expect(html).toContain('/help/errors/BEUK-X201');
  });
  it('validator.catches.missing-alt, undeclared-cover, undeclared-svg-and-off-spine-link', () => {
    const st = sample();
    const a = c.api;
    const s = st.sections.find((x) => x.type === 'chapter')!;
    (st.images as Rec[]).push({ id: 'scvalimg1', name: 'Valid Chart.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX });
    s.content = 'Before the chart.\n\n![A validation chart](img:scvalimg1)';
    let v = a.validateEpubPackage(a.epubFiles('generic').map((f) => (f.path === 'OEBPS/Text/chapter_01.xhtml' ? { ...f, content: f.content.replace(' alt="A validation chart"', '') } : f)));
    const alt = v.results.find((x) => x.id === 'images.alt-text')!;
    expect(alt.level === 'error' && alt.detail.includes('valid-chart-scvalimg1.png')).toBe(true);
    st.cover = { data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: 'Validator Cover.png' };
    v = a.validateEpubPackage(a.epubFiles('generic').map((f) => (f.path === 'OEBPS/package.opf' ? { ...f, content: f.content.replace(' properties="cover-image"', '') } : f)));
    expect(v.results.find((x) => x.id === 'cover.declared')?.level).toBe('error');
    // validator.catches.undeclared-svg-and-off-spine-link (on the sample as 1.0 has it)
    sample();
    const clean = a.validateEpubPackage(a.epubFiles('generic'));
    const r0 = (id: string) => clean.results.find((x) => x.id === id)?.level;
    const damaged = a.epubFiles('generic').map((f) => (f.path === 'OEBPS/package.opf' ? { ...f, content: String(f.content).replace(/(<item id="sec-chapter_01"[^>]*?) properties="svg"/, '$1').replace('    <itemref idref="sec-chapter_02"/>\n', '') } : f));
    const d = a.validateEpubPackage(damaged);
    const props = d.results.find((x) => x.id === 'manifest.properties')!, spine = d.results.find((x) => x.id === 'links.in-spine')!;
    expect([r0('manifest.properties'), r0('links.in-spine')]).toEqual(['pass', 'pass']);
    expect(props.level === 'error' && /chapter_01\.xhtml/.test(props.detail) && spine.level === 'error' && /chapter_02\.xhtml/.test(spine.detail)).toBe(true);
  });
});

describe("1.0's accessibility self-checks (feature a11y, 2)", () => {
  it('a11y.audit', () => {
    const a = c.api;
    const e = a.buildEmptyBook() as unknown as Rec & { meta: Rec; sections: Rec[] };
    e.meta.title = 'Fixture Book';
    e.meta.author = 'Fixture Author';
    const ch = e.sections.find((s) => s.type === 'chapter')!;
    ch.title = 'Fixture Chapter';
    ch.content = '## A heading that skips a level\n\nSome text beneath it.';
    e.images = [{ id: 'sca11ybd', name: 'Fixture Bay.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX }];
    const ch2 = a.mkSection('body', 'chapter', 'Backdrop Chapter', { number: 'Two', content: 'A quiet chapter with art behind it.', backdropId: 'sca11ybd', backdropStrength: 'whisper' });
    e.sections.splice(e.sections.indexOf(ch) + 1, 0, ch2);
    on(e);
    const files = a.epubFiles('generic').map((f) => (f.path === 'OEBPS/Text/chapter_01.xhtml' ? { ...f, content: f.content.replace('</body>', '<p><a href="chapter_02.xhtml"></a></p></body>') } : f));
    const au = a.auditAccessibility(files);
    const head = au.findings.find((x) => x.id === 'headings.skip'), link = au.findings.find((x) => x.id === 'links.text');
    expect(head?.jump).toEqual({ kind: 'section', sectionId: ch.id });
    expect(link?.jump?.sectionId).toBe(ch.id);
    expect(au.findings.some((x) => x.id === 'images.alt')).toBe(false); // the backdrop is never flagged
    sample();
    expect(a.auditAccessibility(a.epubFiles('generic')).findings).toEqual([]);
  });
  it('a11y.metadata', () => {
    const st = sample();
    const a = c.api;
    const opf = scText(a.epubFiles('generic'), 'OEBPS/package.opf');
    for (const line of ['<meta property="schema:accessMode">textual</meta>', '<meta property="schema:accessMode">visual</meta>', '<meta property="schema:accessModeSufficient">textual</meta>',
      '<meta property="schema:accessibilityFeature">alternativeText</meta>', '<meta property="schema:accessibilityFeature">structuralNavigation</meta>',
      '<meta property="schema:accessibilityFeature">tableOfContents</meta>', '<meta property="schema:accessibilityHazard">none</meta>']) expect(opf, line).toContain(line);
    expect(opf).not.toContain('printPageNumbers');
    expect(opf).toContain('<meta property="schema:accessibilitySummary">' + a.esc(a.a11ySummaryText()) + '</meta>');
    expect(opf).toContain('<meta property="dcterms:conformsTo">' + a.A11Y_CONFORMS_VALUE + '</meta>');
    st.meta.a11ySummary = 'Read aloud end to end: every picture in this book is described in words.';
    expect(scText(a.epubFiles('generic'), 'OEBPS/package.opf')).toContain('<meta property="schema:accessibilitySummary">Read aloud end to end: every picture in this book is described in words.</meta>');
    st.meta.a11ySummary = '';
    st.meta.author = '';
    expect(scText(a.epubFiles('generic'), 'OEBPS/package.opf')).not.toContain('dcterms:conformsTo');
    expect(a.auditAccessibility(a.epubFiles('generic')).findings.some((x) => x.id === 'metadata.creator')).toBe(true);
  });
});

describe("1.0's EPUB self-checks (feature epub, 11; 6 here)", () => {
  it('epub.props.detect-from-content', () => {
    const x = (body: string) => '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' + body + '</body></html>';
    const d = (cn: string, mt?: string) => c.api.epubDetectProps(cn, mt || 'application/xhtml+xml').join(' ');
    const cases: [string, string][] = [
      [d(x('<p>plain</p>')), ''],
      [d(x('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>')), 'svg'],
      [d(x('<!-- <svg xmlns="http://www.w3.org/2000/svg"/> --><p>no</p>')), ''],
      [d(x('<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>')), 'mathml'],
      [d(x('<script>var a = 1;</script>')), 'scripted'],
      [d(x('<form action="#"><input type="text" name="q"/></form>')), 'scripted'],
      [d(x('<epub:switch id="s"><epub:default><p>x</p></epub:default></epub:switch>')), 'switch'],
      [d(x('<img src="https://example.com/a.png" alt="a"/>')), 'remote-resources'],
      [d(x('<p><a href="https://example.com/">a link out</a></p>')), ''],
      [d(x('<img src="../Images/a.png" alt="a"/>')), ''],
      [d(x('<p style="background-image: url(\'https://example.com/b.jpg\')">x</p>')), 'remote-resources'],
      [d('p { background: url(../Images/a.jpg); }', 'text/css'), ''],
      [d('@font-face { src: url(https://example.com/f.woff2); }', 'text/css'), 'remote-resources'],
      [d('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>', 'image/svg+xml'), ''],
      [d('binary-ish', 'image/png'), ''],
    ];
    expect(cases.map((cs, i) => (cs[0] === cs[1] ? null : i + ': ' + cs[0])).filter(Boolean)).toEqual([]);
  });
  it('epub.props.sample-declared-exactly (the store presets; the box set half is wave 5c) and epub.props.recomputed-not-trusted', () => {
    const st = sample();
    const a = c.api;
    const bad: string[] = [];
    let svgItems = 0;
    for (const p of a.PLATFORM_PRESETS) {
      const rep = a.epubManifestPropertyReport(a.epubFiles(p.id));
      for (const it of rep.items) {
        if (it.missing.length || it.extra.length) bad.push(p.id + ': ' + it.href);
        if (p.id === 'generic' && it.declared.includes('svg')) svgItems++;
      }
      if (!rep.items.find((it) => it.id === 'nav')?.declared.includes('nav')) bad.push(p.id + ': nav');
      if (st.cover && !rep.items.some((it) => it.declared.includes('cover-image'))) bad.push(p.id + ': cover-image');
    }
    expect(bad).toEqual([]);
    expect(svgItems).toBeGreaterThan(0);
    const files = a.epubFiles('generic');
    const opf = scFile(files, 'OEBPS/package.opf')!;
    const before = String(opf.content);
    const svgTag = (before.match(/<item [^>]*properties="svg"\/>/) || [''])[0]!;
    const plainTag = (before.match(/<item id="sec-copyright" [^>]*\/>/) || [''])[0]!;
    expect(svgTag && plainTag && !/properties=/.test(plainTag)).toBeTruthy();
    opf.content = before.replace(svgTag, svgTag.replace(' properties="svg"', '')).replace(plainTag, plainTag.replace('/>', ' properties="svg scripted mathml"/>'));
    a.epubApplyManifestProperties(files);
    expect(String(opf.content)).toBe(before);
  });
  it('epub.spine.nav-links-reach-spine (the store presets; the box set half is wave 5c)', () => {
    const st = sample();
    const a = c.api;
    for (const p of a.PLATFORM_PRESETS) expect(a.epubLinksOutsideSpine(a.epubFiles(p.id)), p.id).toEqual([]);
    const withToc = a.epubFiles('kdp');
    expect(scText(withToc, 'OEBPS/nav.xhtml')).toContain('<a epub:type="toc" href="Text/toc.xhtml">');
    expect(scText(withToc, 'OEBPS/package.opf')).toContain('<reference type="toc" title="Table of Contents" href="Text/toc.xhtml"/>');
    expect(scText(withToc, 'OEBPS/package.opf')).not.toContain('<itemref idref="nav"');
    const tocSec = st.sections.find((s) => s.type === 'toc')!;
    tocSec.included = false;
    const noToc = a.epubFiles('kdp');
    expect(a.epubLinksOutsideSpine(noToc)).toEqual([]);
    expect(scText(noToc, 'OEBPS/package.opf')).toContain('<itemref idref="nav" linear="no"/>');
    expect(scText(noToc, 'OEBPS/nav.xhtml')).toContain('<a epub:type="toc" href="nav.xhtml">');
  });
  it('epub.identifier.real-uuid', () => {
    const a = c.api;
    const re = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const x = a.newBookId(), y = a.newBookId();
    const e = (a.buildEmptyBook() as unknown as Rec & { meta: Rec }).meta.bookId as string, s = (c.sample!.buildSampleBook().meta as Rec).bookId as string;
    expect(re.test(x) && re.test(y) && x !== y && re.test(e) && s === a.SAMPLE_BOOK_ID && re.test(s) && a.isSampleBookId('urn:uuid:beuk-sample-lantern-coast')).toBe(true);
  });
  it('epub.fonts.script-embedded (generic, KDP, Apple; Hindi and Arabic): the faces, their OFL, dir=rtl and no validator error added', async () => {
    const st = sample();
    const a = c.api as unknown as Closure['api'] & { ensureScriptFonts: (s: unknown, l: string, m: unknown) => Promise<{ failed: string[] }>; SCRIPT_FONTS: Record<string, { family: string; dir: string; range: string; faces: { file: string; weight: number | string }[] }>; scriptFontData: Record<string, string>; bookScripts: (s: unknown, l: string, m: unknown) => string[] };
    // 1.0's page-relative font files, served from client/assets/fonts as /assets/fonts/ serves them
    const fetch0 = coverEnv.fetch;
    coverEnv.fetch = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input instanceof Request ? input.url : input), 'http://localhost:3000/');
      if (!u.pathname.startsWith('/assets/fonts/')) return new Response('', { status: 404 });
      return new Response(readFileSync(path.join(REPO, 'client', decodeURIComponent(u.pathname))), { status: 200 });
    }) as typeof fetch;
    try {
      const errIds = (files: EpubFile[]) => a.validateEpubPackage(files).results.filter((r) => r.level === 'error').map((r) => r.id);
      const base: Rec = {};
      for (const p of ['generic', 'kdp', 'apple']) base[p] = errIds(a.epubFiles(p));
      for (const [lang, k, other] of [['hi', 'deva', 'arab'], ['ar', 'arab', 'deva']] as const) {
        st.meta.language = lang;
        const sf = a.SCRIPT_FONTS[k]!, of = a.SCRIPT_FONTS[other]!;
        const got = await exportRun(() => a.ensureScriptFonts(st.sections, lang, st.meta))!;
        expect(got.failed, lang).toEqual([]);
        exportRun(() => undefined); // the export's state again (the await may have let another set its own)
        for (const preset of ['generic', 'kdp', 'apple']) {
          const files = a.epubFiles(preset);
          const opf = scText(files, 'OEBPS/package.opf'), css = scText(files, 'OEBPS/Styles/blitz.css');
          for (const fc of sf.faces) {
            const f = files.find((x) => x.path === 'OEBPS/Fonts/' + fc.file);
            expect(f && f.binary && f.content === a.scriptFontData[sf.dir + '/' + fc.file], lang + '/' + preset + ' ' + fc.file).toBeTruthy();
            expect(opf).toContain('href="Fonts/' + fc.file + '" media-type="font/ttf"');
            expect(css).toContain('@font-face { font-family: "' + sf.family + '"; src: url("../Fonts/' + fc.file + '") format("truetype"); font-weight: ' + fc.weight + '; font-style: normal; unicode-range: ' + sf.range + '; }');
          }
          expect(css).toContain(sf.family + ' is embedded under the SIL Open Font License 1.1');
          expect(files.some((x) => x.path === 'OEBPS/Fonts/' + of.faces[0]!.file)).toBe(false);
          expect(errIds(files).filter((id) => !(base[preset] as string[]).includes(id)), lang + '/' + preset).toEqual([]);
          const page = files.find((x) => /^OEBPS\/Text\/.+\.xhtml$/.test(x.path))!;
          const rtl = page.content.includes(' dir="rtl"') && scText(files, 'OEBPS/nav.xhtml').includes(' dir="rtl"') && opf.includes('page-progression-direction="rtl"');
          expect(rtl, lang + '/' + preset).toBe(lang === 'ar');
        }
      }
      const secs = (content: string) => [{ included: true, title: 'One', subtitle: '', content }];
      expect(a.bookScripts(secs('A plain English chapter, nothing else.'), 'en', { title: 'A Book' })).toEqual([]);
      expect(a.bookScripts(secs('He read the inscription aloud: ' + 'बूढ़ा प्रकाशस्तंभ रक्षक हर सुबह पत्थर की सीढ़ियाँ चढ़ता था।'), 'en', { title: 'A Book' })).toEqual(['deva']);
      expect(a.bookScripts(secs('The word नमस्ते, once.'), 'en', { title: 'A Book' })).toEqual([]);
    } finally {
      coverEnv.fetch = fetch0;
    }
  }, 60_000);
});

describe("1.0's export self-checks (feature export, 9; 3 here)", () => {
  it("export.epub-server: sign-in when signed out, the connection line offline, the paused copy and no file on a 402, the server's file and notes on success, its words on an error; never a file built on the device", async () => {
    const st = sample();
    const a = c.api;
    const said: string[] = [];
    const files: { b: Blob; name: string }[] = [];
    const calls: string[] = [];
    let mode = 'ok';
    let lastBody: Rec | null = null;
    const NOTE = 'The Amiri book face could not be loaded, so this EPUB does not embed it.';
    const PAUSED = 'Your free trial has ended, so store-ready EPUB files is paused until you choose a plan.';
    const fetch0 = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const m = init?.method || 'GET', u = String(url);
      calls.push(m + ' ' + u);
      if (m === 'POST' && u === '/api/epub') {
        lastBody = JSON.parse(String(init!.body)) as Rec;
        if (mode === 'paused') return new Response(JSON.stringify({ error: PAUSED, paused: true }), { status: 402 });
        if (mode === 'error') return new Response(JSON.stringify({ error: 'The EPUB could not be built. Please try again; if it keeps happening, tell us.' }), { status: 500 });
        return new Response('PK-sc', { status: 200, headers: { 'Content-Type': 'application/epub+zip', 'X-Beuk-Notes': encodeURIComponent(JSON.stringify([NOTE])) } });
      }
      return new Response('{"error":"not found"}', { status: 404 });
    }) as typeof fetch;
    const toast0 = exportUi.toast, dl0 = coverEnv.downloadBlob, api0 = covEnv.apiFetch;
    exportUi.toast = (msg) => void said.push(String(msg));
    coverEnv.downloadBlob = (b, name) => void files.push({ b, name });
    covEnv.apiFetch = apiFetch;
    // the button 1.0 disables while it asks (the modal's markup is the UI test's: a stand-in here)
    const btn = document.createElement('button');
    btn.id = 'btnBuildEpub';
    document.body.appendChild(btn);
    const localBuild = a.buildEpubBlob;
    let localBuilds = 0;
    a.buildEpubBlob = () => (localBuilds++, Promise.reject(new Error('built on the device')));
    a.buildEpub.noOpen = true;
    const run = async () => {
      calls.length = 0;
      said.length = 0;
      files.length = 0;
      lastBody = null;
      await exportRun((cc) => cc.api.buildEpub());
      await new Promise((r) => setTimeout(r, 20));
    };
    try {
      cloudFacts.available = true;
      cloudFacts.user = null;
      await run();
      expect([calls.length, files.length, said[0]]).toEqual([0, 0, t('epub.signin')]);
      cloudFacts.user = { id: 'sc-user', email: 'sc@beuk.test' };
      cloudFacts.available = false; // 2.0: no shelf reachable (1.0's net.online false and cloud.available false say the same line)
      await run();
      expect([calls.length, files.length, said[0]]).toEqual([0, 0, t('epub.offline')]);
      cloudFacts.available = true;
      mode = 'paused';
      await run();
      expect([calls.length, files.length, said]).toEqual([1, 0, [t('plan.pausedToast')]]);
      mode = 'ok';
      st.exportPlatform = 'kdp';
      await run();
      expect(calls).toEqual(['POST /api/epub']);
      expect(files.map((f) => f.name)).toEqual([a.platformFilename('kdp')]);
      expect(await files[0]!.b.text()).toBe('PK-sc');
      expect(lastBody!.platform).toBe('kdp');
      expect(lastBody!.lang).toBe('en');
      expect('history' in (lastBody!.book as Rec)).toBe(false);
      expect(Array.isArray((lastBody!.book as Rec).sections)).toBe(true);
      expect(said).toContain(NOTE);
      mode = 'error';
      await run();
      expect(files.length).toBe(0);
      expect(said.some((x) => x.includes('The EPUB could not be built'))).toBe(true);
      expect(localBuilds).toBe(0);
      expect(btn.disabled).toBe(false);
    } finally {
      globalThis.fetch = fetch0;
      exportUi.toast = toast0;
      coverEnv.downloadBlob = dl0;
      covEnv.apiFetch = api0;
      a.buildEpubBlob = localBuild;
      cloudFacts.available = false;
      cloudFacts.user = null;
      btn.remove();
    }
  });
  it('starters.empty-left-out (the EPUB, contents, Markdown and web page half; Word, print and manuscript are later waves)', () => {
    const a = c.api;
    const e = sampleBook() as Rec & { sections: Rec[] };
    const by = (ty: string) => e.sections.find((x) => x.type === ty)!;
    by('epigraph').title = 'Zqempty Alpha';
    by('epigraph').content = '  \n ';
    if (e.sections.some((x) => x.type === 'alsoby')) {
      by('alsoby').title = 'Zqempty Beta';
      by('alsoby').content = '';
    }
    by('dedication').content = 'For Marrow Quell.';
    by('acknowledgments').content = 'Thanks to Quillon Vane.';
    by('acknowledgments').included = false;
    on(e);
    const outs: Record<string, string> = {
      epub: a.epubPlan().map((p) => p.section.title + '|' + p.section.type + '|' + p.section.content).join('\n'),
      markdown: a.buildMarkdown(),
      html: a.buildStandaloneHtml(),
    };
    for (const [k, v] of Object.entries(outs)) {
      expect(/Zqempty/.test(v), k).toBe(false);
      expect(v.includes('Marrow Quell'), k).toBe(true);
      expect(v.includes('Quillon Vane'), k).toBe(false);
    }
    const types = a.epubPlan().map((p) => p.section.type);
    expect(['titlepage', 'copyright', 'toc', 'dedication', 'chapter'].every((ty) => types.includes(ty))).toBe(true);
  });
  it('starters.blanks-flagged (the EPUB check half; the print preflight half is wave 5b)', () => {
    const a = c.api;
    const e = sampleBook() as Rec & { sections: Rec[] };
    const about = e.sections.find((x) => x.type === 'aboutauthor')!, ack = e.sections.find((x) => x.type === 'acknowledgments')!;
    about.content = 'Zoey Suzuki lives in [[your town]] and writes at [[your website]].';
    ack.content = 'Thanks to [[your editor]].';
    ack.included = false;
    const st = on(e);
    const hit = () => a.validateEpubPackage(a.epubFiles()).results.filter((r) => r.id === 'template.blanks');
    const e1 = hit();
    expect(e1.length).toBe(1);
    expect(e1[0]!.level).toBe('error');
    expect(e1[0]!.detail).toContain('[[your town]], [[your website]]');
    expect(e1[0]!.detail).not.toContain('[[your editor]]');
    const ab = st.sections.find((x) => x.type === 'aboutauthor')!;
    ab.content = String(ab.content).replace('[[your town]]', 'Bristol').replace('[[your website]]', 'zoeysuzuki.com');
    expect(hit()).toEqual([]);
  });
  it("cover.absent.no-cover-artifacts and cover.present.packages-cover (4c's EPUB halves)", () => {
    const st = sample();
    const a = c.api;
    st.cover = null;
    let files = a.epubFiles('generic');
    expect(files.some((f) => f.path.includes('Images/cover'))).toBe(false);
    expect(scText(files, 'OEBPS/package.opf')).not.toContain('cover-image');
    expect(scText(files, 'OEBPS/nav.xhtml')).not.toContain('epub:type="cover"');
    st.cover = { data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: 'Test Cover.png' };
    files = a.epubFiles('generic');
    const opf = scText(files, 'OEBPS/package.opf');
    expect(!!scFile(files, 'OEBPS/Images/cover.png')).toBe(true);
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    expect(scText(files, 'OEBPS/nav.xhtml')).toContain('epub:type="cover"');
    expect(opf.indexOf('<itemref idref="sec-cover"/>')).toBeGreaterThan(-1);
    expect(opf.indexOf('<itemref idref="sec-cover"/>')).toBeLessThan(opf.indexOf('<itemref idref="sec-halftitle"/>'));
    expect(scText(files, 'OEBPS/Text/cover.xhtml')).toContain('src="../Images/cover.png"');
  });
});

describe('the page-relative font addresses 1.0 asks for (wave 5a)', () => {
  it("coverFetch sends /next/assets/fonts/… to 1.0's /assets/fonts/…; other same-origin addresses unchanged", async () => {
    const seen: string[] = [];
    const fetch0 = globalThis.fetch;
    globalThis.fetch = (async (u: RequestInfo | URL) => (seen.push(String(u)), new Response('x'))) as typeof fetch;
    try {
      await coverFetch(location.origin + '/next/assets/fonts/amiri/OFL.txt');
      await coverFetch('/api/stock/search?q=x');
      expect(seen).toEqual([location.origin + '/assets/fonts/amiri/OFL.txt', '/api/stock/search?q=x']);
    } finally {
      globalThis.fetch = fetch0;
    }
  });
});
