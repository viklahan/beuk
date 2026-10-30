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
  assert.ok(lay.includes(String.raw`if (!spaced && /^\s*(?:\S ){2,}\S\s*$/u.test(s))`), 'a run of spaced letters closes up');
  assert.match(lay, /needSpace && !prevCap/);
});

test('pdf front: "(anonymous)" is nobody, and a numbered book never makes its front text chapter 1', async () => {
  const html = await clientHtml();
  const id = html.slice(html.indexOf('function pdfIdentity('), html.indexOf('function importPdfExtracted('));
  assert.match(id, /anonymous\|unknown\|untitled/);
  const parse = html.slice(html.indexOf('function parseManuscript('), html.indexOf('function importFoundList('));
  assert.match(parse, /zoneNumbered\.length >= 2\s*\? \{ kind: "front", type: "preface"/);
  assert.match(parse, /it\.head\.title !== "Chapter " \+ it\.head\.number/, 'a bare chapter label gives its number to the heading under it');
});
