import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* Story Insights (round 7) runs entirely in the studio page. The server
   side is the Housekeeping registration (client-only, with a reason),
   plus static guards: every new UI string exists in all 13 packs, and
   the cited sources stay cited. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

const IDS = [
  'insights.glance.numbers-true',
  'insights.chart.click-opens-chapter',
  'insights.crutch.counts',
  'insights.sentences.histogram',
  'insights.readability.en-only',
  'insights.perf',
];

test('insights: every round-7 client self-check is in the studio and registered server-side as client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client SELF_CHECKS`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a reason`);
  }
});

test('insights: every new Story Insights string exists in all 13 UI packs', async () => {
  const html = await clientHtml();
  const packs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', '"zh-Hans"'];
  const block = (lang: string) => {
    const head = lang.startsWith('"') ? `Object.assign(UI_STRINGS[${lang}], {\n        "insights.glanceH"` : `Object.assign(UI_STRINGS.${lang}, {\n        "insights.glanceH"`;
    const at = html.indexOf(head);
    assert.ok(at !== -1, `${lang} pack has the Insights block`);
    return html.slice(at, html.indexOf('\n      });', at));
  };
  const keysOf = (b: string) => [...b.matchAll(/"(insights\.[A-Za-z0-9]+)":/g)].map((m) => m[1]).sort();
  const en = keysOf(block('en'));
  assert.ok(en.length >= 50, `expected the full key set, got ${en.length}`);
  for (const lang of packs.slice(1)) assert.deepEqual(keysOf(block(lang)), en, `${lang} carries every key`);
});

test('insights: the reading-rate and readability sources stay cited next to the numbers', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('const INS_WPM = 225;'), 'reading pace constant');
  assert.ok(html.includes('https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests'), 'Flesch formula source');
  assert.ok(html.includes('return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);'), 'Flesch formula constants');
  const readme = await readFile(path.join(here, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes('doi:10.1016/j.jml.2019.104047'), 'README cites Brysbaert 2019');
  assert.ok(readme.includes('## Studio: Story Insights (client-only)'), 'README documents Insights');
});
