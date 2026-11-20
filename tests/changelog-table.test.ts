import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChangelog, renderChangelogBody, areaOf, itemOf } from '../src/warmth/changelog.js';

const SAMPLE = `# Beuk — Changelog

What changed, newest first.

## 2026-11-10 — Locked manuscripts open

- **A manuscript with a password opens.** Beuk asks for the password.
- **Cancel changes nothing.** Your book stays as it was.

## 2026-11-09 — Two-step sign-in

**Two-step sign-in**
- **A code after your password.** Turn it on in your account.
- Download all my data now includes whether two-step sign-in is on. It never includes your codes.

## 2026-11-09 — Second release, same day

- **Fixed:** with the interface in Arabic, the chip mirrors. It reads right to left.
- **Tooltips everywhere.** Point at a button and a tip
  says what it does.
`;

test('parses releases, groups, bold leads, plain bullets and wrapped lines', () => {
  const c = parseChangelog(SAMPLE);
  assert.equal(c.title, 'Beuk — Changelog');
  assert.deepEqual(c.intro, ['What changed, newest first.']);
  assert.equal(c.releases.length, 3);
  const [a, b, d] = c.releases;
  assert.equal(a.date, '2026-11-10');
  assert.equal(a.groups[0].items[0].title, 'A manuscript with a password opens');
  assert.equal(a.groups[0].items[0].body, 'Beuk asks for the password.');
  assert.equal(b.groups[0].name, 'Two-step sign-in');
  assert.equal(b.groups[0].items[1].title, 'Download all my data now includes whether two-step sign-in is on');
  assert.equal(b.groups[0].items[1].body, 'It never includes your codes.');
  assert.notEqual(b.id, d.id, 'two releases on one date get distinct anchors');
  assert.equal(d.groups[0].items[0].title, 'Fixed: with the interface in Arabic, the chip mirrors');
  assert.equal(d.groups[0].items[1].body, 'Point at a button and a tip says what it does.');
});

test('areas come from the row, then its release, then Studio', () => {
  assert.equal(areaOf('An EPUB arrives with its cover', null), 'Import');
  assert.equal(areaOf('Cancel changes nothing', null, 'Locked manuscripts open'), 'Import');
  assert.equal(areaOf('A code after your password', 'Two-step sign-in'), 'Account');
  assert.equal(areaOf('Anything at all', 'Fixes'), 'Fixes');
  assert.equal(areaOf('Lighter typing', null, 'Lighter typing'), 'Studio');
  assert.equal(itemOf('**Fixed:** a thing broke. More.', null).area, 'Fixes');
});

test('renders a filterable table with every row, tag and folded detail', () => {
  const html = renderChangelogBody(parseChangelog(SAMPLE));
  assert.match(html, /id="cl-q"/);
  assert.match(html, /class="cl-chip" data-area="Import"/);
  assert.match(html, /<span id="cl-n">6<\/span> changes/);
  assert.match(html, /<details class="cl-row" data-area="Import"><summary><span class="cl-t">A manuscript with a password opens<\/span>/);
  assert.match(html, /<p class="cl-body">Beuk asks for the password\.<\/p>/);
  assert.match(html, /<h3 class="cl-group">Two-step sign-in<\/h3>/);
  assert.match(html, /href="\/roadmap"/);
});

test('the real CHANGELOG.md loses no words in the table', () => {
  const src = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const html = renderChangelogBody(parseChangelog(src));
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');
  const missing: string[] = [];
  for (const line of src.split('\n')) {
    for (const w of line.replace(/[*`#\-“”"'’&<>]/g, ' ').split(/\s+/)) {
      if (w.length > 6 && /^[A-Za-z]+$/.test(w) && !plain.includes(w)) missing.push(w);
    }
  }
  assert.deepEqual(missing, []);
});
