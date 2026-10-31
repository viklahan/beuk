#!/usr/bin/env node
/* Make the legacy upgrade fixtures (tests/fixtures/books/legacy/<step>.json).
 *
 *   node tools/book-corpus/legacy.mjs
 *
 * Each fixture is a copy of ONE real fixture (tests/fixtures/books/real/reads-you.json,
 * the smallest) with only the step's inverse applied. `_fixture.legacy` names the
 * inverse and the 1.0 code that makes the step necessary. Nothing is added
 * beyond the inverse. history-doc has no fixture: no gallery book carries
 * history, so there is nothing real to invert (the test lists it as untested). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'books');
const SRC = 'real/reads-you.json';
const OUT = path.join(ROOT, 'legacy');
mkdirSync(OUT, { recursive: true });

const PRINT_KEYS = ['exportPlatform', 'printTrim', 'printRecto', 'printLargePrint', 'printPictureBook', 'printBleed',
  'printMarginMode', 'printCustomMargins', 'printHeadContent', 'printHeadPlace', 'printOmitChapterHead', 'printOmitBlankHead', 'printFolio'];

/* step -> [inverse, 1.0 line, mutate(book)] */
const MAKE = {
  'sections-split': ['sections regrouped into {frontMatter, body, backMatter}, each section\'s kind removed (the tier names it)', 'src/account/data.ts:262-286', (b) => {
    const kinds = b.sections.map((s) => s.kind).join(' ');
    if (!/^(front )*(body )*(back )*$/.test(kinds + ' ')) throw new Error('sections are not front/body/back in order: ' + kinds);
    const tier = (k) => b.sections.filter((s) => s.kind === k).map(({ kind, ...rest }) => rest);
    b.sections = { frontMatter: tier('front'), body: tier('body'), backMatter: tier('back') };
  }],
  'sections-missing': ['sections key deleted', 'client/index.html:50253-50256', (b) => { delete b.sections; }],
  'bookid-missing': ['meta.bookId deleted', 'client/index.html:50215', (b) => { delete b.meta.bookId; }],
  'bookid-legacy': ['meta.bookId set to the pre-UUID form "urn:uuid:sabc1234-sdef5678" (the form 1.0 documents at :4381)', 'client/index.html:4428-4482, :50328', (b) => { b.meta.bookId = 'urn:uuid:sabc1234-sdef5678'; }],
  'bookid-sample': ['meta.bookId set to the sample\'s pre-UUID id "urn:uuid:beuk-sample-lantern-coast"', 'client/index.html:4356-4377, :4432', (b) => { b.meta.bookId = 'urn:uuid:beuk-sample-lantern-coast'; }],
  'lang-unknown': ['meta.language set to "tlh", a code that is not in LANG_PACKS', 'client/index.html:50230', (b) => { b.meta.language = 'tlh'; }],
  'lang-source': ['meta.langSource and meta.langGuess deleted (a book saved before detection)', 'client/index.html:50231-50233', (b) => { delete b.meta.langSource; delete b.meta.langGuess; }],
  'theme-missing': ['theme and activePreset deleted', 'client/index.html:50234, :50244', (b) => { delete b.theme; delete b.activePreset; }],
  'theme-display-body': ['theme.bodyFont set to the display face "Pinyon Script" (DISPLAY_FONTS, :19274)', 'client/index.html:50242, :19288', (b) => { b.theme.bodyFont = 'Pinyon Script'; }],
  'print-defaults': ['every print key deleted (' + PRINT_KEYS.join(', ') + ')', 'client/index.html:50269-50295', (b) => { PRINT_KEYS.forEach((k) => { delete b[k]; }); }],
  'notes-end': ['printNotes deleted', 'client/index.html:50300, :20561', (b) => { delete b.printNotes; }],
  'rights-mode': ['none: the real book has no meta.rightsMode, which is the legacy rights line', 'client/index.html:20985-21000', () => {}],
  'optional-empties': ['colour deleted (the real book has no outline, bible, notebook or research)', 'client/index.html:50180-50182, :50246-50261', (b) => { delete b.colour; }],
  'activeid-fallback': ['the section activeId names deleted from sections', 'client/index.html:50250-50252', (b) => {
    b.sections = b.sections.filter((s) => s.id !== b.activeId);
  }],
};

const src = JSON.parse(readFileSync(path.join(ROOT, SRC), 'utf8'));
for (const [step, [inverse, line, mutate]] of Object.entries(MAKE)) {
  const env = structuredClone(src);
  mutate(env.book);
  env._fixture = { ...src._fixture, source: 'tests/fixtures/books/' + SRC, legacy: { step, inverse, line } };
  writeFileSync(path.join(OUT, step + '.json'), JSON.stringify(env, null, 1) + '\n');
}
console.log('wrote', Object.keys(MAKE).length, 'fixtures to', path.relative(process.cwd(), OUT));
