import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:pdffront — a PDF set with letter-spaced titles ("T H E  F R O S T
   L I N E"), drop caps, "(anonymous)" metadata and chapter numbers on a
   spaced label line imports as the book it is: the words close up, the cap
   rejoins its word, title and author come from the book, and nothing before
   Chapter One becomes chapter 1. The studio runs one self-check on a
   synthetic PDF of that shape; server side: its registration and guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const ID = 'pdf.front.letterspaced-dropcap';

test('pdf front: the self-check exists and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes(`{ id: "${ID}"`));
  const c = SELF_CHECK_CASES.find((x) => x.id === ID);
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('pdf front: letter-spaced runs close up and a drop cap moves to its first line', async () => {
  const html = await clientHtml();
  const lay = html.slice(html.indexOf('function pdfLayout(ext)'), html.indexOf('function pdfIdentity('));
  assert.match(lay, /cap\.capSize = cap\.size; cap\.size = bodySz; cap\.cap = true;/);
  assert.ok(lay.includes(String.raw`const SPACED_RE = /^\s*(?:\S ){2,}\S\s*$/u;`), 'a run of spaced letters is recognised');
  /* BEUK:gluefix — closed up by the book's own words, never blindly (THEDEVIL'SLEDGER) */
  assert.ok(lay.includes(String.raw`if (!spaced && SPACED_RE.test(s)) s = s.match(/^\s*/)[0] + closeSpaced(s) + s.match(/\s*$/)[0];`), 'a run of spaced letters closes up into words');
  assert.ok(!lay.includes(String.raw`s = s.replace(/(\S) (?=\S)/gu, "$1")`), 'no blind close-up is left');
  assert.match(lay, /const parts = irSplitGlued\(core, vocab\);/);
  assert.match(lay, /needSpace && !prevCap/);
});

test('pdf front: names never come in with their words run together (BEUK:gluefix)', async () => {
  const html = await clientHtml();
  const id = html.slice(html.indexOf('function pdfIdentity('), html.indexOf('function importPdfExtracted('));
  assert.match(id, /pdfWordsKey\(title\) === pdfWordsKey\(ft\)/, 'the page copy of the title replaces the declared one only word for word');
  assert.doesNotMatch(id, /else if \(irLoose\(title\) === irLoose\(ft\)\) title = ft;/);
  assert.match(html, /const txt = \(isH \? irTextBr\(node\) : node\.textContent\)/, 'a Word heading reads a line break as a space');
  assert.match(html, /const t = irTextBr\(c\)\.replace/, 'an EPUB heading reads a line break as a space');
  assert.match(html, /\.replace\(\/\\\.\(docx\|md\|markdown\|txt\|rtf\|pdf\|epub\)\$\/i, ""\)/, 'every manuscript extension leaves the file-name title');
  assert.match(html, /irGluedNames\(\)\.forEach\(\(g\) => add\(\{ kind: "glued"/, 'every import checks its names');
  for (const k of ['ir.k.pdfSpaced', 'ir.k.pdfSpacedUnsure', 'ir.k.glued.title', 'ir.k.glued.subtitle', 'ir.k.glued.author', 'ir.k.gluedChapter']) {
    const n = [...html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "`, 'g'))].length;
    assert.equal(n, 13, `${k} in 13 locales`);
  }
});

test('pdf front: a PDF novel comes in with exactly its chapters (BEUK:chapfix)', async () => {
  const html = await clientHtml();
  const lay = html.slice(html.indexOf('function pdfLayout(ext)'), html.indexOf('function pdfIdentity('));
  assert.ok(lay.includes(String.raw`\s+[\p{L}\p{N}]+(?:[-‐–][\p{L}\p{N}]+)*\.?$/iu;`), 'a chapter label takes a hyphenated number');
  assert.match(lay, /if \(sentence\(whole\)\) return true;/, 'a sentence wrapped over its lines is read whole');
  assert.match(lay, /else if \(centred \|\| inset\)/, 'a set-in block keeps its lines together');
  assert.match(lay, /if \(insetOn\) \{/, '... over a page turn too');
  const c = SELF_CHECK_CASES.find((x) => x.id === 'import.chapfix.pdf-ledger-lines');
  assert.ok(c && c.kind === 'client-only' && c.reason && html.includes('{ id: "import.chapfix.pdf-ledger-lines"'));
});

test('pdf front: "(anonymous)" is nobody, and a numbered book never makes its front text chapter 1', async () => {
  const html = await clientHtml();
  const id = html.slice(html.indexOf('function pdfIdentity('), html.indexOf('function importPdfExtracted('));
  assert.match(id, /anonymous\|unknown\|untitled/);
  const parse = html.slice(html.indexOf('function parseManuscript('), html.indexOf('function importFoundList('));
  assert.match(parse, /zoneNumbered\.length >= 2\s*\? \{ kind: "front", type: "preface"/);
  assert.match(parse, /it\.head\.title !== "Chapter " \+ it\.head\.number/, 'a bare chapter label gives its number to the heading under it');
});
