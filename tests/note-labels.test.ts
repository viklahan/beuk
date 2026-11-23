import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { notesAsShown } from '../src/book/notes.js';
import { toDoc, toText } from '../src/book/editor/convert.js';
import { renderSnapshot } from '../src/shares/render.js';

/* BEUK:notelabels (the owner, 2026-11-22, on a note shown as "[110]": "WHY ARE WE INVENTING NUMBERS?" … "KEEP WHAT THE
   WRITER GIVES US.") — a note is stored under the label the writer typed, and the number a reader sees is worked out
   when the book is shown. The server holds that rule in three places: its copy of the numbering (src/book/notes.ts,
   held to the studio's by tests/fixtures/note-labels.json: studio/test/note-labels-as-typed.test.ts reads the same
   table), the beta-reader reading copy (src/shares/render.ts) and the 2.0 editor's document model
   (src/book/editor/convert.ts). The shelf's rough word count is the fourth (tests/account-portal.test.ts). */

type Case = { name: string; sections: string[]; shown: string[] };
const FIXTURE = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'note-labels.json'), 'utf8')) as { cases: Case[] };

test('the note numbering: every case of the shared table, as the studio numbers it', () => {
  assert.ok(FIXTURE.cases.length >= 12, 'the table lost cases');
  for (const c of FIXTURE.cases) assert.deepEqual(notesAsShown(c.sections), c.shown, c.name);
});

test('the note numbering: a text with no label of the writer\'s own is handed back as the very string it was', () => {
  const texts = ['One[^2] two[^1].\n\n[^1]: First.\n\n[^2]: Second.', 'Plain text, a [word] and a [12].', ''];
  const out = notesAsShown(texts);
  out.forEach((v, i) => assert.equal(v, texts[i]));
});

const book = (sections: { id: string; content: string; included?: boolean }[]) => ({
  meta: { title: 'The Salt Road', author: 'A. Writer', language: 'en' },
  sections: sections.map((s, i) => ({ kind: 'body', type: 'chapter', number: String(i + 1), title: 'Chapter', ...s })),
});
/** the note numbers a reading copy's text shows, in order (its Notes list left aside): a linked mark as its number, an unlinked one with "~" before it */
const marks = (html: string) => [...html.replace(/<div class="endnotes">[\s\S]*$/, '').matchAll(/(<a class="noteref"[^>]*>)?<sup>\[([^\]<]*)\]<\/sup>/g)].map((m) => (m[1] ? '' : '~') + m[2]);

test('the reading copy: a note under the writer\'s label is linked and shown under its number; the label never reaches the page', () => {
  const doc = book([
    { id: 'c1', content: 'The caravan left[^salt] at dawn, and again[^salt].\n\nA mark with no note[^nowhere].\n\n[^salt]: Salt, by the sack.' },
    { id: 'c2', content: 'The pans lay white[^fn.2-a] and[^1].\n\n[^fn.2-a]: The pans of the coast.\n\n[^1]: The writer\'s own number.' },
  ]);
  const { snapshot } = renderSnapshot(doc, 'x');
  const [one, two] = snapshot.sections.map((s) => s.html);
  // chapter 1: "salt" is the first note marked and 1 is the writer's own, so it takes 2; the mark with no note takes 3
  assert.match(one!, /left<a class="noteref" id="s0-fnref2" href="#s0-fn2"><sup>\[2\]<\/sup><\/a> at dawn, and again<a class="noteref" href="#s0-fn2"><sup>\[2\]<\/sup><\/a>\./);
  assert.match(one!, /no note<sup>\[3\]<\/sup>\./);
  assert.match(one!, /<p class="endnote" id="s0-fn2" data-p="2"><a class="note-back" href="#s0-fnref2"><sup>\[2\]<\/sup><\/a> Salt, by the sack\.<\/p>/);
  // chapter 2: the next named note takes 4; the writer's "[^1]" shows 1, as typed
  assert.match(two!, /white<a class="noteref" id="s1-fnref4" href="#s1-fn4"><sup>\[4\]<\/sup><\/a> and<a class="noteref" id="s1-fnref1" href="#s1-fn1"><sup>\[1\]<\/sup><\/a>\./);
  assert.match(two!, /id="s1-fn4"[^>]*><a class="note-back" href="#s1-fnref4"><sup>\[4\]<\/sup><\/a> The pans of the coast\./);
  for (const html of [one!, two!]) for (const label of ['salt', 'nowhere', 'fn.2-a']) assert.equal(html.includes(label), false, `the label "${label}" reached the page`);
});

test('the reading copy: a label defined in two chapters is two notes; a chapter left out of the book still takes its numbers, as in the studio', () => {
  const doc = book([
    { id: 'c1', content: 'One[^a].\n\n[^a]: The harbour\'s note.' },
    { id: 'cut', content: 'Cut[^b].\n\n[^b]: Not shipped.', included: false },
    { id: 'c3', content: 'Two[^a].\n\n[^a]: The crossing\'s note.' },
  ]);
  const { snapshot } = renderSnapshot(doc, 'x');
  assert.deepEqual(snapshot.sections.map((s) => s.id), ['c1', 'c3']);
  assert.deepEqual(snapshot.sections.map((s) => marks(s.html)), [['1'], ['3']]);
  assert.match(snapshot.sections[1]!.html, /id="s2-fn3"[^>]*>.*The crossing&#39;s note\.|id="s2-fn3"[^>]*>.*The crossing's note\./);
});

test('the reading copy: a book whose labels are all numbers reads exactly as it did (the ids and numbers are the labels)', () => {
  const doc = book([{ id: 'c1', content: 'It began with the tide.[^1] And a bare one.[7] And one undefined.[^3]\n\n[^1]: A note on tides.\n\n[7]: A bare definition.' }]);
  const { snapshot } = renderSnapshot(doc, 'x');
  assert.equal(snapshot.sections[0]!.html,
    '<p class="ch-num">1</p><h2 class="ch-title">Chapter</h2>' +
    '<p data-p="0">It began with the tide.<a class="noteref" id="s0-fnref1" href="#s0-fn1"><sup>[1]</sup></a> And a bare one.<a class="noteref" id="s0-fnref7" href="#s0-fn7"><sup>[7]</sup></a> And one undefined.<sup>[3]</sup></p>\n' +
    '<div class="endnotes"><p class="endnotes-h">Notes</p><p class="endnote" id="s0-fn1" data-p="1"><a class="note-back" href="#s0-fnref1"><sup>[1]</sup></a> A note on tides.</p>' +
    '<p class="endnote" id="s0-fn7" data-p="2"><a class="note-back" href="#s0-fnref7"><sup>[7]</sup></a> A bare definition.</p></div>');
});

test('the editor\'s model: a definition and a mark under any label are a note\'s, written back exactly as typed; a bare [word] is text', () => {
  const types = (text: string) => { const out: string[] = []; toDoc(text).forEach((n) => out.push(n.type.name)); return out; };
  const runs = (text: string) => { const out: [string, string[]][] = []; toDoc(text).firstChild!.forEach((n) => out.push([n.text ?? '', n.marks.map((m) => m.type.name)])); return out; };
  for (const text of ['The caravan left[^salt] at dawn.\n\n[^salt]: Salt, by the sack.', '[^fn.2-a]:   spaced', '[^007]: Bond.\n[^x]: X.', 'A [word] and a [12] and a [^2024].', '[word]: no definition', '[^a b]: a label has no space']) {
    assert.equal(toText(toDoc(text)), text);
  }
  assert.deepEqual(types('The caravan left[^salt] at dawn.\n\n[^salt]: Salt, by the sack.'), ['paragraph', 'footnoteDef']);
  const def = toDoc('[^fn.2-a]:   spaced').firstChild!;
  assert.deepEqual([def.type.name, def.attrs.n, def.attrs.caret, def.attrs.gap], ['footnoteDef', 'fn.2-a', true, '   ']);
  const bare = toDoc('[12]: bare').firstChild!;
  assert.deepEqual([bare.type.name, bare.attrs.n, bare.attrs.caret], ['footnoteDef', '12', false]);
  assert.deepEqual(types('[^007]: Bond.\n[^x]: X.'), ['footnoteDef', 'footnoteDef']);
  assert.deepEqual(runs('left[^salt] at *dawn[^fn-9]*, a [word], a [12].'), [['left', []], ['[^salt]', ['footnoteRef']], [' at ', []], ['dawn', ['em']], ['[^fn-9]', ['em', 'footnoteRef']], [', a [word], a ', []], ['[12]', ['footnoteRef']], ['.', []]]);
  assert.deepEqual(types('[word]: no definition'), ['paragraph']);
  assert.deepEqual(types('[^a b]: a label has no space'), ['paragraph']);
});
