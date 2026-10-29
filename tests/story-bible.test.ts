import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:bible — the Story Bible runs in the studio. Server side: its
   Housekeeping registration (client-only, with a reason) and static
   guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['bible.seed.frominsights', 'bible.mentions.match', 'bible.mentions.heatmap', 'bible.notexported', 'bible.series.roundtrip', 'bible.model.compat', 'bible.change.anchor', 'bible.change.now', 'bible.editor.perf'];

test('story bible: every self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client SELF_CHECKS`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a reason`);
  }
});

test('story bible: every string ships in all 13 locales with its placeholders', async () => {
  const html = await clientHtml();
  const start = html.indexOf('/* ==== BEUK:bible ==== Story Bible — strings');
  const end = html.indexOf('/* ==== /BEUK:bible ==== */', start);
  assert.ok(start > 0 && end > start, 'string block found');
  const block = html.slice(start, end);
  const enStart = block.indexOf('Object.assign(UI_STRINGS.en, {');
  const enEnd = block.indexOf('});', enStart);
  const keys = Array.from(block.slice(enStart, enEnd).matchAll(/"([\w.]+)": "/g)).map((m) => m[1]);
  assert.ok(keys.length > 60, `english keys: ${keys.length}`);
  const placeholders: Record<string, string[]> = { 'bible.noMatch': ['{q}'], 'bible.deleted': ['{name}'], 'bible.cellTip': ['{sec}'], 'bible.cellNone': ['{sec}'],
    'bible.passagesMore': ['{n}', '{m}'], 'bible.exported': ['{file}'], 'bible.importSkipped': ['{list}'], 'bible.cardAlso': ['{list}'] };
  for (const k of keys) {
    const vals = Array.from(block.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "([^"]*)"`, 'g'))).map((m) => m[1]);
    assert.equal(vals.length, 13, `${k} appears in ${vals.length} locales`);
    for (const v of vals) for (const p of placeholders[k] ?? []) assert.ok(v.includes(p), `${k}: ${v} lacks ${p}`);
  }
  assert.doesNotMatch(block, /!"/, 'no exclamation marks in the copy');
});

test('story bible: rides the book only when it holds an entry, and never reaches an export builder', async () => {
  const html = await clientHtml();
  assert.match(html, /\.\.\.\(bibleHas\(\) \|\| \(state\.bible && state\.bible\.fields && Object\.keys\(state\.bible\.fields\)\.length\) \? \{ bible: bibleNormalize\(state\.bible\) \} : \{\}\)/);
  assert.match(html, /state\.bible = bibleNormalize\(doc\.bible\);/);
  for (const fn of ['function epubFiles(', 'function buildPrintHtml(', 'function buildDocxFiles(', 'function countWords(']) {
    const i = html.indexOf(fn);
    assert.ok(i > 0, fn);
    const body = html.slice(i, html.indexOf('\n      }\n', i));
    assert.doesNotMatch(body, /bible/i, `${fn} does not read the Story Bible`);
  }
});

test('story bible: the export file format is named and versioned', async () => {
  const html = await clientHtml();
  assert.match(html, /const BIBLE_FORMAT = "beuk-story-bible";/);
  assert.match(html, /format: BIBLE_FORMAT, version: 2,/);
});

test('covenant rename: the export is named -covenant.json while the format id stays beuk-story-bible, and no locale still says Bible', async () => {
  const html = await clientHtml();
  assert.match(html, /return base \+ "-covenant\.json";/);
  assert.doesNotMatch(html, /-story-bible\.json/);
  const start = html.indexOf('/* ==== BEUK:bible ==== Story Bible — strings');
  const end = html.indexOf('/* ==== /BEUK:bible ==== */', start);
  const block = html.slice(html.indexOf('Object.assign(UI_STRINGS.en', start), end);
  assert.doesNotMatch(block, /": "[^"]*(?:Bible|Biblia|Bibel|Bibbia|Bíblia|Bijbel|Biblii|Библи[яию]|[Rr]ehber|مرجع|設定集|设定集)/, "a translated value still names the old feature");
  assert.match(block, /"side\.toolBible": "Covenant"/);
});
