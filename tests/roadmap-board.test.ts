import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoadmap, renderRoadmapBody, splitLead } from '../src/warmth/roadmap.js';

/* /roadmap as a board (src/warmth/roadmap.ts): docs/roadmap.md read into
   columns, every item a title and one line with the rest folded, and no
   word of the source lost on the way. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'docs', 'roadmap.md'), 'utf8');
const words = (s: string) => s.replace(/\*\*|\*|`/g, '').replace(/\s+/g, ' ').trim();

test('roadmap board: the real roadmap reads into its four columns with every item and every word', () => {
  const r = parseRoadmap(SOURCE);
  assert.deepEqual(r.sections.map((s) => s.status), ['In progress', 'Planned', 'Exploring', 'Shipped']);
  assert.match(r.updated ?? '', /^\d{4}-\d{2}-\d{2}$/);
  // one item per top-level "- " line under each heading
  const counts = SOURCE.split(/^## /m).slice(1).map((chunk) => (chunk.match(/^- /gm) ?? []).length);
  assert.deepEqual(r.sections.map((s) => s.items.length), counts);
  for (const s of r.sections) {
    for (const it of s.items) {
      assert.ok(it.title.length > 0, `${s.status}: an item without a title`);
      assert.ok(!/\*\*/.test(it.title + it.lead + it.more), `${s.status}: bold markers left in "${it.title}"`);
      // nothing dropped: the item's words are all in the source, in order
      const whole = words([it.when ? `${it.when} — ${it.title}.` : `${it.title}.`, it.lead, it.more].filter(Boolean).join(' '));
      assert.ok(words(SOURCE).includes(whole.replace(/\.\./g, '.')) || words(SOURCE).includes(words(`${it.when ? it.when + ' — ' : ''}${it.title}`)), `${s.status}: "${it.title}" is not the source's words`);
      assert.ok(words(SOURCE).includes(words(it.lead)), `${s.status}: lead of "${it.title}" not in the source`);
      if (it.more) assert.ok(words(SOURCE).includes(words(it.more)), `${s.status}: the rest of "${it.title}" not in the source`);
    }
  }
  const shipped = r.sections.find((s) => s.status === 'Shipped')!;
  assert.ok(shipped.items.every((it) => it.when), 'every shipped item carries its date');
  assert.equal(r.sections.find((s) => s.status === 'Planned')!.items.every((it) => it.when === null), true);
});

test('roadmap board: the page keeps the four headings, numbers the build order, folds the rest', () => {
  const html = renderRoadmapBody(parseRoadmap(SOURCE));
  for (const status of ['In progress', 'Planned', 'Exploring', 'Shipped']) assert.match(html, new RegExp(`<h2[^>]*>${status}</h2>`));
  assert.match(html, /<ol class="rm-list"><li class="rm-item"><span class="rm-n" aria-hidden="true">1<\/span>/);
  assert.match(html, /<details class="rm-older"><summary>\d+ earlier releases<\/summary>/);
  assert.match(html, /<details class="rm-more"><summary>More<\/summary>/);
  assert.match(html, /M5/, 'the folded text is still on the page');
  assert.doesNotMatch(html, /\*\*/);
  assert.match(html, /<a href="\/changelog">changelog<\/a>/, 'inline links still work');
});

test('roadmap board: messy Markdown is read, never thrown', () => {
  const nl = String.fromCharCode(13, 10);
  const messy = [
    '# Beuk — Roadmap', '', 'Intro line one', 'continues here.', '', 'Last updated: 2026-11-01', '',
    '## In progress', '- **No full stop at all** and a lead that never ends',
    '## Planned', 'In order.', '', '- plain item with no bold. Second sentence.', '- **Title only.**',
    '- **Brackets (e.g. this. that) stay.** Lead (with a. dot) ends here. More text.',
    '-not a list item', '',
    '## Empty', '',
    '## Shipped', '- **2026-10-31 — Dated.** One. Two.', '- **Undated shipped.** Text.',
    '- **<script>alert(1)</script> — x.** <img src=x onerror=alert(1)>',
  ].join(nl);
  let r: ReturnType<typeof parseRoadmap> | undefined;
  assert.doesNotThrow(() => { r = parseRoadmap(messy); });
  assert.equal(r!.title, 'Roadmap');
  assert.equal(r!.updated, '2026-11-01');
  assert.deepEqual(r!.intro, ['Intro line one continues here.']);
  const by = (s: string) => r!.sections.find((x) => x.status === s)!;
  assert.equal(by('In progress').items[0]!.title, 'No full stop at all');
  assert.equal(by('In progress').items[0]!.lead, 'and a lead that never ends');
  assert.deepEqual(by('Planned').intro, ['In order.', '-not a list item']);
  assert.equal(by('Planned').items[0]!.title, 'plain item with no bold');
  assert.equal(by('Planned').items[1]!.title, 'Title only');
  assert.equal(by('Planned').items[1]!.lead, '');
  assert.equal(by('Planned').items[2]!.title, 'Brackets (e.g. this. that) stay');
  assert.equal(by('Planned').items[2]!.lead, 'Lead (with a. dot) ends here.');
  assert.equal(by('Empty').items.length, 0);
  assert.equal(by('Shipped').items[0]!.when, '2026-10-31');
  assert.equal(by('Shipped').items[1]!.when, null);
  const html = renderRoadmapBody(r!);
  assert.doesNotMatch(html, /<script>|<img/, 'raw HTML in the source is escaped');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotThrow(() => renderRoadmapBody(parseRoadmap('')));
  assert.equal(parseRoadmap('').sections.length, 0);
});

test('roadmap board: a first sentence ends at the first stop outside brackets', () => {
  assert.deepEqual(splitLead('One. Two.'), { lead: 'One.', more: 'Two.' });
  assert.deepEqual(splitLead('A (b. c) d. E'), { lead: 'A (b. c) d.', more: 'E' });
  assert.deepEqual(splitLead('No stop'), { lead: 'No stop', more: '' });
  assert.deepEqual(splitLead('Ends here.'), { lead: 'Ends here.', more: '' });
  assert.deepEqual(splitLead('Is it? Yes.'), { lead: 'Is it?', more: 'Yes.' });
});
