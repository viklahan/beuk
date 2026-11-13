import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { loadInsightsClosure, reachableDeclarations } from '../src/book/insights/closure.js';

/* BEUK:insights-server — the studio's own insComputeFor, lifted out of
   client/index.html and run in a fenced vm worker. Proves the lift
   produces real InsightsData (the MCP get_insights tool's source). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');

// A small but real book: varied sentence lengths, dialogue, a repeated
// phrase (an echo), and a crutch word ("just") so every analysis has
// something to find.
const sections = [
  { id: 's-pro', kind: 'body', type: 'prologue', included: true, number: '', title: 'Prologue',
    content: 'The tide came in.\n\nMara watched it climb the stones, slow and certain, and she just waited. She had always waited. The sea keeps its own counsel, her mother said, and the sea keeps its own counsel still.' },
  { id: 's-ch1', kind: 'body', type: 'chapter', included: true, number: 'One', title: 'The Wrong-Way Runs',
    content: '"You\'re late," said the ferryman. "I am never late," Mara said. "I am exactly as late as the tide allows." He laughed, a short dry sound. She just stepped aboard and said nothing more, because there was nothing more that needed saying, and the long grey water carried them out past the harbour wall where the gulls turned and turned.' },
  { id: 's-ch2', kind: 'body', type: 'chapter', included: true, number: 'Two', title: 'Salt',
    content: 'Salt. Everywhere salt. It was in her hair and her mouth and the cracked leather of her boots. The sea keeps its own counsel, she thought, and she just kept walking, one plain step after another, up the long hill toward the light.' },
];

let sandbox: ReturnType<typeof loadInsightsClosure> | null = null;

after(() => { /* workers are per-call and already closed */ });

test('the insights closure reaches a self-contained set from insComputeFor', () => {
  const names = reachableDeclarations(html);
  assert.ok(names.includes('insComputeFor'), 'the root is present');
  assert.ok(names.length > 5, `reached ${names.length} declarations`);
  // The known text-measuring helpers must be in the lifted set.
  for (const fn of ['insFrequency', 'insRhythm', 'insCadence', 'insEchoes', 'insDialogue', 'insCrutch', 'insVariety']) {
    assert.ok(names.includes(fn), `${fn} is lifted`);
  }
});

test('insComputeFor runs server-side and returns Beuk\'s own InsightsData', async () => {
  sandbox = loadInsightsClosure(html, CLIENT);
  const { data } = await sandbox.compute(sections, { lang: 'en' });
  const d = data as {
    frequency: { total: number; top?: Array<{ word: string; count: number }> };
    rhythm: Array<{ id: string; words: number }>;
    cadence: { overall: number };
    dialogue: { share: number; total: number };
    variety: { all: number[] };
    facts: Record<string, { words: number }>;
    chapters: number;
    lang: string;
  };
  // Shape: every analysis produced its section of the report.
  assert.equal(d.lang, 'en');
  assert.ok(d.frequency.total > 0, 'word frequency counted real words');
  assert.equal(d.rhythm.length, 3, 'one rhythm row per body section');
  assert.equal(d.chapters, 2, 'two chapters among the three body sections');
  assert.ok(d.dialogue.total > 0 && d.dialogue.share > 0, 'dialogue detected (the ferryman exchange)');
  assert.ok(Array.isArray(d.variety.all) && d.variety.all.length > 0, 'sentence lengths measured');
  assert.ok(Object.keys(d.facts).length === 3, 'a fact row per section');
  // The numbers are real: the prologue has fewer words than the dialogue chapter.
  const words = d.rhythm.map((r) => r.words);
  assert.ok(Math.max(...words) > Math.min(...words), 'sections differ in length, as measured');
});

test('a book with no text still computes, with zeroed measures (never a crash)', async () => {
  const sb = loadInsightsClosure(html, CLIENT);
  const { data } = await sb.compute(
    [{ id: 'e1', kind: 'body', type: 'chapter', included: true, number: '1', title: 'Empty', content: '' }],
    { lang: 'en' },
  );
  const d = data as { frequency: { total: number }; chapters: number };
  assert.equal(d.frequency.total, 0);
  assert.equal(d.chapters, 1);
});
