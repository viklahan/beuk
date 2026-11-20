import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:wordback — The sample's Word round trip found four import bugs: a
   Heading 2 inside a chapter split it, Parts came back as chapters, the
   contents list and the frontispiece became chapters, and every endnote
   was lost. The Word import now reads a Word book's structure the way Beuk
   writes it. The studio runs import.docx.beuk-structure-back (both ways:
   chapters in Heading 1, and Parts in Heading 1 over chapters in Heading
   2) and sample.roundtrip.word; server side: registration and guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('word round trip: the structure check is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('{ id: "import.docx.beuk-structure-back"'));
  const c = SELF_CHECK_CASES.find((x) => x.id === 'import.docx.beuk-structure-back');
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('word round trip: the walk, the parser and the export carry the fixes', async () => {
  const html = await clientHtml();
  /* which Heading 2s those are is the one rule's to say (BEUK:headlevels, tests/import-headlevels.test.ts); "more Heading 1 than Heading 2" is still in it */
  assert.match(html, /if \(tag === "h2" && htxt && subHeads\.has\(node\)\) \{\s*ir\.subs\.push\(htxt\);/, 'a Heading 2 under Heading 1 chapters is a sub-heading');
  assert.match(html, /const byHeadingOne = holders\.size >= 2 \|\| h1n > h2n;/, 'the rule the Word import always had still holds');
  assert.match(html, /if \(inContents\) \{ ir\.tocLines/, 'the contents list is left out whole');
  assert.match(html, /normHeading\(htxt\) === "endnotes"/, "Beuk's Endnotes are read back");
  assert.match(html, /"frontispiece": \{ kind: "front", type: "frontispiece"/, 'a Frontispiece heading is front matter');
  assert.match(html, /type === "part" \? \(p\.number \|\| ""\)/, 'a Part keeps its number');
  assert.match(html, /s\.type === "part" && s\.number \? "Part " \+ s\.number/, 'the Word export writes a numbered Part as "Part One: Title"');
});
