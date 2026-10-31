import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { asStudioBackupBook } from '../src/account/data.js';
import { PRINT_DEFAULTS, PRINT_MARGINS_DEFAULT, THEME_DEFAULT, scaffoldSections } from '../src/book/defaults.js';
import { readBook, type ReadResult } from '../src/book/read.js';
import { BOOKID_NAMESPACE, DISPLAY_FAMILIES, LANG_CODES, SAMPLE_BOOK_ID, STEPS, uuidV5 } from '../src/book/upgrade.js';
import { legacyFixture, realFixtures } from './book-fixtures.js';

/* BEUK:book-upgrade — one test per legacy upgrade step. Each loads
   tests/fixtures/books/legacy/<step>.json: a real book with only that
   step's inverse applied (its `_fixture.legacy` names the inverse and the
   1.0 line). Tests assert the step is INCLUDED in `upgrades`, never an
   exact list. bookid-legacy is also checked against 1.0's own functions,
   lifted out of client/index.html with the TypeScript parser and run in a
   vm sandbox. */

type Rec = Record<string, unknown>;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reads = realFixtures().find((f) => f.name === 'reads-you.json')!.book as { sections: Rec[] } & Rec;
const meta = (r: ReadResult) => r.book.meta as unknown as Rec;
const theme = (r: ReadResult) => r.book.theme as unknown as Rec;
const load = (step: string) => legacyFixture(step).book;
const run = (step: string) => readBook(load(step));
const UUID_URN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/* ---- 1.0's code, run as written ---- */

const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
const SCRIPT = (() => {
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>\n/g)) if (m[1]!.includes('const BOOKID_NAMESPACE')) return m[1]!;
  throw new Error('no inline <script> in client/index.html declares BOOKID_NAMESPACE');
})();
const sf = ts.createSourceFile('studio.js', SCRIPT, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

/** The first top-level function or const named `name`. */
function stmt(name: string): ts.Statement {
  const hit = sf.statements.find((s) =>
    (ts.isFunctionDeclaration(s) && s.name?.text === name) ||
    (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)));
  assert.ok(hit, `1.0 declares ${name} at the top level of the studio script`);
  return hit;
}
const src = (name: string) => stmt(name).getText(sf);
const initOf = (name: string) => (stmt(name) as ts.VariableStatement).declarationList.declarations[0]!.initializer!;

type StudioBookId = {
  uuidV5(ns: string, name: string): string;
  bookIdMigrated(id: string): string;
  bookIdIsLegacy(id: unknown): boolean;
  bookIdMigrateMeta(m: Rec): { from: string; to: string } | null;
  SAMPLE_BOOK_ID: string;
  BOOKID_NAMESPACE: string;
};
/** 1.0's bookid functions in a sandbox. Its SHA-1 is its own and synchronous, so no browser crypto is needed. */
function studioBookId(): StudioBookId {
  const sandbox: Rec = { TextEncoder, Uint8Array, Int32Array, Array, String, Math, parseInt, unescape, encodeURIComponent };
  vm.createContext(sandbox);
  const names = ['SAMPLE_BOOK_ID', 'LEGACY_SAMPLE_BOOK_ID', 'BOOKID_NAMESPACE', 'BOOKID_UUID_RE', 'bookIdSha1', 'bookIdUtf8', 'uuidV5',
    'bookIdIsLegacy', 'bookIdMigrated', 'bookIdNormalizeLegacyList', 'bookIdMigrateMeta'];
  vm.runInContext(names.map(src).join('\n') + '\nthis.api = { uuidV5, bookIdMigrated, bookIdIsLegacy, bookIdMigrateMeta, SAMPLE_BOOK_ID, BOOKID_NAMESPACE };', sandbox);
  return sandbox.api as StudioBookId;
}

/** The keys of `const LANG_PACKS = { ... }`. */
function langPackKeys(): string[] {
  const init = initOf('LANG_PACKS') as ts.ObjectLiteralExpression;
  return init.properties.map((p) => (ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) ? p.name.text : ''));
}

test('upgrade: STEPS are the fifteen named steps, in the brief\'s order, each citing 1.0', () => {
  assert.deepEqual(STEPS.map((s) => s.name), ['sections-split', 'sections-missing', 'bookid-missing', 'bookid-legacy', 'bookid-sample', 'lang-unknown',
    'lang-source', 'theme-missing', 'theme-display-body', 'print-defaults', 'notes-end', 'rights-mode', 'history-doc', 'optional-empties', 'activeid-fallback']);
  for (const s of STEPS) assert.match(s.cite, /(client\/index\.html|src\/account\/data\.ts)/, `${s.name} cites the 1.0 code it mirrors`);
});

test('upgrade: sections-split — {frontMatter, body, backMatter} → flat array with kind (src/account/data.ts:262-286)', () => {
  const book = load('sections-split');
  assert.ok(!Array.isArray(book.sections), 'the fixture is the old object shape');
  const r = readBook(book);
  assert.ok(r.upgrades.includes('sections-split'));
  const server = (asStudioBackupBook(book) as { sections: Rec[] }).sections;
  assert.deepEqual(r.book.sections.map((s) => [s.id, s.kind]), server.map((s) => [s.id, s.kind]), 'same order and kind as the server\'s flattening');
  assert.deepEqual(r.book.sections, reads.sections, 'and the book is the real one again');
});

test('upgrade: sections-missing — no sections → the buildEmptyBook scaffold (client/index.html:50253-50256)', () => {
  const r = run('sections-missing');
  assert.ok(r.upgrades.includes('sections-missing'));
  assert.deepEqual(r.book.sections, scaffoldSections());
  const chapter = r.book.sections.find((s) => s.type === 'chapter')!;
  assert.equal(r.book.activeId, chapter.id, 'activeId is the scaffold\'s chapter, not the lost book\'s id');
  assert.ok(readBook({ sections: [] }).upgrades.includes('sections-missing'), 'an empty array is the same case');
  const old = load('sections-missing').activeId;
  assert.ok(old && old !== r.book.activeId);
  assert.ok(r.preserved.some((p) => p.path === 'activeId' && p.raw === old && p.used === r.book.activeId), 'the lost activeId is preserved');
});

test('upgrade: bookid-missing — no meta.bookId → a new UUID (client/index.html:50215)', () => {
  const r = run('bookid-missing');
  assert.ok(r.upgrades.includes('bookid-missing'));
  assert.match(meta(r).bookId as string, UUID_URN);
  const bare = readBook({ sections: reads.sections });
  assert.ok(bare.upgrades.includes('bookid-missing'), 'a book with no meta at all gets one too');
  assert.match(meta(bare).bookId as string, UUID_URN);
});

test('upgrade: bookid-legacy — pre-UUID id → UUIDv5 under namespace 8bf1c6b6…, old id kept (client/index.html:4428-4482, :50328)', () => {
  assert.equal(BOOKID_NAMESPACE, '8bf1c6b6-5f75-4773-a701-cdd420357f52');
  const fx = load('bookid-legacy');
  const old = (fx.meta as Rec).bookId as string;
  const r = readBook(fx);
  assert.ok(r.upgrades.includes('bookid-legacy'));
  assert.match(meta(r).bookId as string, UUID_URN);
  assert.notEqual(meta(r).bookId, old);
  assert.ok((meta(r).legacyBookIds as string[]).includes(old));
  assert.equal((meta(r).bookId as string)['urn:uuid:'.length + 14], '5', 'version 5');
  assert.equal(readBook(r.book).upgrades.includes('bookid-legacy'), false, 'a migrated id is not migrated again');
  // RFC 9562 Appendix A.4: UUIDv5 of www.example.com under the DNS namespace.
  assert.equal(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
});

test('upgrade: bookid-legacy — byte-identical to 1.0 (1.0\'s own functions, run in a vm)', () => {
  const studio = studioBookId();
  assert.equal(studio.BOOKID_NAMESPACE, BOOKID_NAMESPACE);
  const ids = ['urn:uuid:sabc1234-sdef5678', 'urn:uuid:sabc1234', 'not-a-uuid', 'urn:uuid:ünïcödé-日本語', 'urn:uuid:' + 'x'.repeat(200)];
  for (const id of ids) {
    assert.ok(studio.bookIdIsLegacy(id), id);
    const book = structuredClone(load('bookid-legacy'));
    (book.meta as Rec).bookId = id;
    (book.meta as Rec).legacyBookIds = ['urn:uuid:older'];
    const r = readBook(book);
    assert.equal(meta(r).bookId, studio.bookIdMigrated(id), `id ${JSON.stringify(id.slice(0, 30))}`);
    assert.equal(meta(r).bookId, 'urn:uuid:' + uuidV5(studio.BOOKID_NAMESPACE, id));
    // 1.0's whole meta migration puts the old id first, then the ones already there
    const m: Rec = { bookId: id, legacyBookIds: ['urn:uuid:older'] };
    studio.bookIdMigrateMeta(m);
    assert.deepEqual(meta(r).legacyBookIds, JSON.parse(JSON.stringify(m.legacyBookIds)));
  }
  assert.equal(studio.bookIdIsLegacy('urn:uuid:890c09dc-3b9e-4693-9efc-8010943f64b8'), false);
  assert.equal(readBook(reads).upgrades.includes('bookid-legacy'), false);
});

test('upgrade: bookid-sample — only the lantern-coast id → SAMPLE_BOOK_ID; salt-meridian takes the UUIDv5 path (client/index.html:4356-4377, :4430-4433)', () => {
  const studio = studioBookId();
  assert.equal(SAMPLE_BOOK_ID, studio.SAMPLE_BOOK_ID);
  const lantern = 'urn:uuid:beuk-sample-lantern-coast';
  const r = readBook(load('bookid-sample'));
  assert.ok(r.upgrades.includes('bookid-sample'));
  assert.equal(meta(r).bookId, SAMPLE_BOOK_ID);
  assert.equal(meta(r).bookId, studio.bookIdMigrated(lantern), '1.0 maps it to the sample id');
  assert.deepEqual(meta(r).legacyBookIds, [lantern]);
  assert.equal(r.upgrades.includes('bookid-legacy'), false);

  // the pre-rename id: 1.0 migrates it like any legacy id (isSampleBookId is UI-only)
  const salt = 'urn:uuid:beuk-sample-salt-meridian';
  const book = structuredClone(load('bookid-sample'));
  (book.meta as Rec).bookId = salt;
  const rs = readBook(book);
  assert.ok(rs.upgrades.includes('bookid-legacy'));
  assert.equal(rs.upgrades.includes('bookid-sample'), false);
  assert.equal(meta(rs).bookId, studio.bookIdMigrated(salt));
  assert.notEqual(meta(rs).bookId, SAMPLE_BOOK_ID);
  assert.deepEqual(meta(rs).legacyBookIds, [salt]);
});

test('upgrade: lang-unknown — a code not in LANG_PACKS → en, the old value preserved (client/index.html:50230)', () => {
  assert.deepEqual([...LANG_CODES].sort(), langPackKeys().sort(), 'LANG_CODES is 1.0\'s LANG_PACKS key list');
  const r = run('lang-unknown');
  assert.ok(r.upgrades.includes('lang-unknown'));
  assert.equal(meta(r).language, 'en');
  assert.ok(r.preserved.some((p) => p.path === 'meta.language' && p.raw === 'tlh' && p.used === 'en'));
  assert.ok(r.warnings.some((w) => w.path === 'meta.language'));
  assert.equal(readBook(reads).upgrades.includes('lang-unknown'), false);
  // 1.0 keeps an inherited key such as "constructor" (!LANG_PACKS[x]); this reader deliberately does not
  const inh = structuredClone(load('lang-unknown'));
  (inh.meta as Rec).language = 'constructor';
  const ri = readBook(inh);
  assert.ok(ri.upgrades.includes('lang-unknown'));
  assert.equal(meta(ri).language, 'en');
  assert.ok(ri.preserved.some((p) => p.path === 'meta.language' && p.raw === 'constructor'));
});

test('upgrade: lang-source — no langSource → manual if the language is not English, else auto; langGuess "" (client/index.html:50231-50233)', () => {
  const en = run('lang-source');
  assert.ok(en.upgrades.includes('lang-source'));
  assert.equal(meta(en).language, 'en');
  assert.equal(meta(en).langSource, 'auto');
  assert.equal(meta(en).langGuess, '');
  const de = structuredClone(load('lang-source'));
  (de.meta as Rec).language = 'de';
  const rde = readBook(de);
  assert.ok(rde.upgrades.includes('lang-source'));
  assert.equal(meta(rde).langSource, 'manual');
  const gb = structuredClone(load('lang-source'));
  (gb.meta as Rec).language = 'en-GB';
  assert.equal(meta(readBook(gb)).langSource, 'manual', 'en-GB is not "en"');
});

test('upgrade: theme-missing — no theme → the classic preset and activePreset "classic" (client/index.html:50234, :50244)', () => {
  const r = run('theme-missing');
  assert.ok(r.upgrades.includes('theme-missing'));
  assert.deepEqual(r.book.theme, THEME_DEFAULT);
  assert.equal(r.book.activePreset, 'classic');
  assert.equal(readBook(reads).upgrades.includes('theme-missing'), false);
});

test('upgrade: theme-display-body — a display face as bodyFont → the default body face (client/index.html:50242, :19288)', () => {
  const fonts = initOf('DISPLAY_FONTS') as ts.ArrayLiteralExpression;
  const fromStudio = fonts.elements.map((e) => {
    const p = (e as ts.ObjectLiteralExpression).properties.find((x) => ts.isPropertyAssignment(x) && (x.name as ts.Identifier).text === 'family') as ts.PropertyAssignment;
    return (p.initializer as ts.StringLiteral).text;
  });
  assert.deepEqual([...DISPLAY_FAMILIES], fromStudio, 'DISPLAY_FAMILIES is 1.0\'s DISPLAY_FONTS');
  const r = run('theme-display-body');
  assert.ok(r.upgrades.includes('theme-display-body'));
  assert.equal(theme(r).bodyFont, 'EB Garamond');
  assert.ok(r.preserved.some((p) => p.path === 'theme.bodyFont' && p.raw === 'Pinyon Script'));
  assert.equal(readBook(reads).upgrades.includes('theme-display-body'), false);
});

test('upgrade: print-defaults — missing print keys → bookPrintDefaults; printBleed false (client/index.html:50269-50295)', () => {
  const fx = load('print-defaults');
  assert.equal(Object.keys(fx).filter((k) => k.startsWith('print') && k !== 'printNotes').length, 0, 'the fixture has no print keys (printNotes is notes-end)');
  const r = run('print-defaults');
  assert.ok(r.upgrades.includes('print-defaults'));
  const b = r.book as unknown as Rec;
  for (const [k, v] of Object.entries(PRINT_DEFAULTS)) assert.deepEqual(b[k], v, k);
  assert.deepEqual(b.printCustomMargins, PRINT_MARGINS_DEFAULT);
  assert.equal(b.printBleed, false);
  assert.equal(b.printPictureBook, false);
  // a book that has them keeps its own
  const own = readBook({ ...reads, printTrim: '5x8', printBleed: true }).book as unknown as Rec;
  assert.equal(own.printTrim, '5x8');
  assert.equal(own.printBleed, true);
});

test('upgrade: notes-end — no printNotes → "end" (client/index.html:50300, :20561)', () => {
  const r = run('notes-end');
  assert.ok(r.upgrades.includes('notes-end'));
  assert.equal(r.book.printNotes, 'end');
  const page = readBook({ ...reads, printNotes: 'page' });
  assert.equal(page.book.printNotes, 'page');
  assert.equal(page.upgrades.includes('notes-end'), false);
});

test('upgrade: rights-mode — records only; meta.rightsMode stays absent (client/index.html:20985-21000)', () => {
  const r = run('rights-mode');
  assert.ok(r.upgrades.includes('rights-mode'));
  for (const k of ['rightsMode', 'ccLicence', 'firstPublished', 'editionHolder']) assert.equal(Object.hasOwn(meta(r), k), false, k);
  const pd = readBook({ ...reads, meta: { ...(reads.meta as Rec), rightsMode: 'pd' } });
  assert.equal(pd.upgrades.includes('rights-mode'), false, 'a book that chose a rights mode is not on the legacy line');
  assert.equal(meta(pd).rightsMode, 'pd');
});

test('upgrade: history-doc — entries with a full doc stay valid, no rewrite (client/index.html:32187-32188)', (t) => {
  /* No gallery book carries history, so there is no real entry to invert. The step is implemented;
     it has no grounded fixture, and this test says so rather than inventing one. */
  t.diagnostic('history-doc UNTESTED against a fixture: none of the 11 real books has a history entry');
  for (const f of realFixtures()) assert.equal(readBook(f.book).upgrades.includes('history-doc'), false, f.name);
  assert.ok(STEPS.some((s) => s.name === 'history-doc'));
});

test('upgrade: optional-empties — missing colour/outline/bible/notebook/research stay absent (client/index.html:50180-50182, :50246-50261)', () => {
  const r = run('optional-empties');
  assert.ok(r.upgrades.includes('optional-empties'));
  for (const k of ['colour', 'outline', 'bible', 'notebook', 'research']) assert.equal(Object.hasOwn(r.book, k), false, k);
  assert.equal(r.warnings.some((w) => w.code === 'schema' && /colour|outline|bible|notebook|research/.test(w.path)), false);
});

test('upgrade: activeid-fallback — activeId naming no section → first chapter; duplicate section ids warned (code duplicate-id) and both kept', () => {
  const fx = load('activeid-fallback');
  const secs = fx.sections as Rec[];
  assert.ok(!secs.some((s) => s.id === fx.activeId), 'the fixture\'s activeId names no section');
  const r = readBook(fx);
  assert.ok(r.upgrades.includes('activeid-fallback'));
  assert.equal(r.book.activeId, secs.find((s) => s.type === 'chapter')!.id);

  // no chapter at all → the first section
  const noChap = readBook({ ...fx, sections: secs.filter((s) => s.type !== 'chapter') });
  assert.equal(noChap.book.activeId, noChap.book.sections[0]!.id);

  // duplicates: warned, both kept
  const dup = structuredClone(reads);
  dup.sections[1]!.id = dup.sections[0]!.id;
  const d = readBook(dup);
  const w = d.warnings.filter((x) => x.code === 'duplicate-id');
  assert.equal(w.length, 1);
  assert.equal(w[0]!.path, 'sections[1].id');
  assert.equal(d.book.sections.length, reads.sections.length);
  assert.equal(d.book.sections[0]!.id, d.book.sections[1]!.id, 'both kept');
  assert.equal(readBook(reads).warnings.some((x) => x.code === 'duplicate-id'), false);
});

test('upgrade: a key named __proto__ never reaches a prototype', () => {
  const evil = JSON.parse('{"meta":{"bookId":"urn:uuid:sabc1234","__proto__":{"polluted":1}},"sections":{"__proto__":{"x":1},"body":[{"id":"a","type":"chapter"}]},"__proto__":{"y":1}}');
  const r = readBook(evil);
  assert.equal(({} as Rec).polluted, undefined);
  assert.equal(({} as Rec).y, undefined);
  assert.equal(Object.getPrototypeOf(r.book), Object.prototype);
  assert.equal(Object.getPrototypeOf(meta(r)), Object.prototype);
  assert.ok(r.upgrades.includes('bookid-legacy'));
});

test('upgrade: a step that cannot be grounded is listed by the test as untested via t.diagnostic', (t) => {
  const ungrounded = STEPS.map((s) => s.name).filter((n) => {
    try { legacyFixture(n); return false; } catch { return true; }
  });
  t.diagnostic(`steps without a legacy fixture: ${ungrounded.length ? ungrounded.join(', ') : 'none'}`);
  assert.deepEqual(ungrounded, ['history-doc'], 'only history-doc has no fixture; the reason is in its own test');
});
