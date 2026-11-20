import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:importcard — the import report opens on the book that came in, not
   on a list of edits: a writer's first question is "is my book all here?".
   The card is drawn in the studio from the book on the desk (one studio
   self-check exercises it in the page); server side: its registration and
   static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const ID = 'import.card.opens-on-the-book';

const KEYS = ['ir.card.title', 'ir.card.kicker', 'ir.card.lede', 'ir.card.chapters', 'ir.card.chaptersPlural', 'ir.card.sections', 'ir.card.sectionsPlural', 'ir.card.pages', 'ir.card.pagesPlural',
  'ir.card.found', 'ir.card.foundHint', 'ir.card.zoneFront', 'ir.card.zoneBody', 'ir.card.zoneBack', 'ir.card.sectionsIn', 'ir.card.sectionsInPlural', 'ir.card.showAll', 'ir.card.showFewer', 'ir.card.did',
  'ir.card.didSubs', 'ir.card.didSubsPlural', 'ir.card.didHeads', 'ir.card.didHeadsPlural', 'ir.card.didNone', 'ir.card.didLost', 'ir.card.didLostPlural', 'ir.card.see', 'ir.card.open', 'ir.card.every', 'ir.card.back'];
const HOLDS: Record<string, string> = { 'ir.card.kicker': '{file}', 'ir.card.lede': '{words}', 'ir.card.sectionsIn': '{n}', 'ir.card.sectionsInPlural': '{n}', 'ir.card.showAll': '{n}', 'ir.card.didSubs': '{n}', 'ir.card.didSubsPlural': '{n}',
  'ir.card.didHeads': '{n}', 'ir.card.didHeadsPlural': '{n}', 'ir.card.didLost': '{n}', 'ir.card.didLostPlural': '{n}', 'ir.card.every': '{n}' };

test('import card: the self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes(`{ id: "${ID}"`), 'present in the client self-checks');
  const c = SELF_CHECK_CASES.find((x) => x.id === ID);
  assert.ok(c, 'registered');
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('import card: the report opens on the card, and the changes one by one stay whole behind it', async () => {
  const html = await clientHtml();
  const open = html.slice(html.indexOf('function irOpenReport('), html.indexOf('function irCloseReport('));
  assert.match(open, /irView = "card"; irCardAll = false;/, 'every opening starts on the book');
  const render = html.slice(html.indexOf('function irRenderReport('), html.indexOf('function irOpenReport('));
  /* both are drawn each time: the list is never thrown away, only stepped behind the card */
  assert.match(render, /let html = '<div class="ir-card">' \+ irCardHtml\(rep\) \+ '<\/div><div class="ir-list"><div class="ir-chips">';/);
  assert.match(render, /body\.innerHTML = html \+ "<\/div>";/);
  assert.match(html, /\.ir-card-view \.ir-list, \.ir-modal:not\(\.ir-card-view\) \.ir-card \{ display: none; \}/);
  const card = /\/\* ==== BEUK:importcard ==== \*\/([\s\S]*?)\/\* ==== \/BEUK:importcard ==== \*\//.exec(html);
  assert.ok(card, 'the BEUK:importcard block is in the studio');
  /* read from the book as it stands, and it says so plainly when something was left out */
  assert.match(card[1], /state\.sections\.filter\(/);
  assert.match(card[1], /const lost = rep\.items\.filter\(\(it\) => it\.group === "dropped" && it\.kind !== "fmtHeading"\)\.length;/);
  assert.match(card[1], /lost \? line\(t\("ir\.card\.didLost", \{ n: lost \}\), true,/);
  /* every value drawn into the card is escaped */
  assert.doesNotMatch(card[1].replace(/esc\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, ''), /\+ (?:s\.title|rep\.file|pageName\(s\)) \+/);
});

test('import card: its buttons are in the report, and 2.0 lifts its styles with the report\'s own', async () => {
  const html = await clientHtml();
  const at = html.indexOf('<div class="modal-back" id="modalImportReport"');
  const modal = html.slice(at, html.indexOf('<!-- ==== /BEUK:importreport ==== -->', at));
  for (const id of ['btnIrOpenBook', 'btnIrEvery', 'btnIrBack', 'btnIrKeep', 'btnIrUndoAll', 'btnIrDismiss', 'btnIrClose']) assert.ok(modal.includes(`id="${id}"`), id);
  /* the studio's extract takes rules whose selector starts with .ir- (studio/scripts/extract-studio.mjs IMPORT_SELECTOR) */
  const css = html.slice(html.indexOf('/* BEUK:importcard — the report opens on the book'), html.indexOf('.ir-chips { display: flex;'));
  const selectors = [...css.matchAll(/^\s{6}([^{}\n/]+)\{/gm)].map((m) => m[1].trim());
  assert.ok(selectors.length >= 25, `card rules found: ${selectors.length}`);
  for (const sel of selectors) assert.match(sel, /^\.ir-/, sel);
});

test('import card: its words are in all 13 language packs, placeholders kept', async () => {
  const html = await clientHtml();
  for (const k of KEYS) {
    const vals = [...html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "((?:[^"\\\\]|\\\\.)*)"`, 'g'))].map((m) => m[1]);
    assert.equal(vals.length, 13, `${k} in 13 locales`);
    for (const v of vals) {
      assert.ok(v.trim().length > 0, `${k} is not empty`);
      if (HOLDS[k]) assert.ok(v.includes(HOLDS[k]), `${k} keeps ${HOLDS[k]}: ${v}`);
    }
  }
  const lede = [...html.matchAll(/"ir\.card\.lede": "([^"]*)"/g)].map((m) => m[1]);
  for (const v of lede) assert.ok(v.includes('Beuk'), `the product's name is never translated: ${v}`);
});
