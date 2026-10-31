import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:starters — an empty back page offers starters that reach the page
   only on Use; a page with no words of its own is in no export; a
   [[blank]] left in the book is named before it ships. The studio runs
   three self-checks; server side: their registration, the one rule every
   exporter reads, and the text in all 13 packs. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['starters.picker', 'starters.empty-left-out', 'starters.blanks-flagged'];
const PACKS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'];

const fnBody = (html: string, name: string) => {
  const at = html.indexOf(`      function ${name}(`);
  assert.ok(at !== -1, `${name} exists`);
  return html.slice(at, html.indexOf('\n      }\n', at));
};

test('starters: the self-checks exist and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} in the studio`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only');
    assert.ok(c!.reason && c!.reason.length > 10);
  }
});

test('starters: every exporter reads the book through inBook, so an empty page ships nowhere', async () => {
  const html = await clientHtml();
  assert.match(html, /function inBook\(s\) \{ return !!s && !!s\.included && !emptyOut\(s\); \}/);
  assert.match(fnBody(html, 'emptyOut'), /!AUTO_TYPES\.includes\(s\.type\) && s\.type !== "toc"/, 'generated pages are never left out');
  assert.match(fnBody(html, 'emptyOut'), /s\.kind !== "body"/, 'a body piece is never left out');
  for (const fn of ['epubPlan', 'buildMarkdown', 'buildStandaloneHtml', 'buildPrintHtml', 'buildPrintViewModel', 'boxSetPlan', 'buildDocxDocumentXml', 'msPlan', 'acxBuildPlan', 'tocTree', 'printPlacements']) {
    const body = fnBody(html, fn);
    assert.match(body, /inBook/, `${fn} reads inBook`);
    assert.doesNotMatch(body, /\.filter\(\(\w\) => \w\.included[ )&]/, `${fn} has no bare included filter left`);
  }
});

test('starters: a blank is named in the EPUB check and the print preflight', async () => {
  const html = await clientHtml();
  assert.match(fnBody(html, 'validateEpubPackage'), /starterBlanksInBook\(\)\.forEach\(\(x\) => add\("template\.blanks", "error"/);
  assert.match(fnBody(html, 'auditPrintInterior'), /starterBlanksInBook\(\)\.forEach\(\(x\) => add\("template\.blanks"/);
  assert.match(fnBody(html, 'starterUse'), /starterSelectBlank\(\)/, 'Use selects the first blank');
});

test('starters: strings and starter text in all 13 packs', async () => {
  const html = await clientHtml();
  for (const k of ['starter.heading', 'starter.hint', 'starter.use', 'starter.cancel', 'starter.emptyOut', 'starter.blanks', 'starter.blanksPlural', 'starter.next',
    'starter.k.about.third', 'starter.k.about.first', 'starter.k.ack.short', 'starter.k.ack.full', 'starter.k.also.series', 'starter.k.also.list',
    'starter.k.cta.review', 'starter.k.cta.news', 'starter.k.colo.fonts', 'side.emptyOut', 'side.emptyOutShort', 'check.blanks.name', 'check.blanks.detail']) {
    const n = [...html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "`, 'g'))].length;
    assert.equal(n, 13, `${k} in 13 locales`);
  }
  const block = html.slice(html.indexOf('const STARTER_TEXT = {'), html.indexOf('/* The series list is offered only'));
  for (const lang of PACKS) assert.ok(block.includes(lang === 'zh-Hans' ? '"zh-Hans": {' : `${lang}: {`), `starter text for ${lang}`);
  for (const k of ['about.third', 'about.first', 'ack.short', 'ack.full', 'also.list', 'cta.review', 'cta.news', '_coloTwo', '_coloOne', '_coloBy', '_author', '_title', '_book']) {
    assert.equal([...block.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "`, 'g'))].length, 13, `${k} written in 13 languages`);
  }
});
