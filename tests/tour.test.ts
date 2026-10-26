import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* The first-run quick tour (BEUK:tour) lives in the studio file. These
   are the static checks: its strings in all 13 interface languages,
   the key that keeps it from coming back, the controls it points at,
   and its self-checks mirrored server-side. The behaviour itself is
   asserted in the browser by window.runBeukSelfChecks(). */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'];

function tourBlock(html: string): string {
  const start = html.indexOf('/* ==== BEUK:tour ==== */\n      /* The first-run tour');
  const end = html.indexOf('/* ==== /BEUK:tour ==== */', start);
  assert.ok(start > 0 && end > start, 'the BEUK:tour script block is in the studio');
  return html.slice(start, end);
}

function tourStrings(block: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const m of block.matchAll(/Object\.assign\(UI_STRINGS(?:\.([A-Za-z]+)|\["([A-Za-z-]+)"\]), (\{.*\})\);/g)) {
    out.set(m[1] ?? m[2], JSON.parse(m[3]) as Record<string, string>);
  }
  return out;
}

test('tour: every string is in all 13 interface languages, translated, with the same placeholders', async () => {
  const packs = tourStrings(tourBlock(await clientHtml()));
  assert.deepEqual([...packs.keys()], LANGS);
  const en = packs.get('en')!;
  const keys = Object.keys(en);
  assert.ok(keys.length >= 20, 'the tour has its full set of strings');
  for (const k of keys) assert.ok(k.startsWith('tour.'), `${k} is namespaced tour.*`);
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const L of LANGS) {
    const pack = packs.get(L)!;
    assert.deepEqual(Object.keys(pack), keys, `${L} carries exactly the English keys`);
    for (const k of keys) {
      assert.ok(pack[k].trim().length > 0, `${L} ${k} is not empty`);
      assert.equal(holes(pack[k]), holes(en[k]), `${L} ${k} keeps the placeholders`);
      assert.ok(!pack[k].includes('!'), `${L} ${k} has no exclamation mark`);
      if (L !== 'en') assert.notEqual(pack[k], en[k], `${L} ${k} is translated`);
    }
  }
  // The control names come from the studio's own strings, not retyped.
  assert.match(en['tour.s1b'], /\{import\}/);
  assert.match(en['tour.s3b'], /\{studio\}/);
  assert.match(en['tour.s4b'], /\{export\}/);
});

test('tour: the never-again key, the desk key the first save writes, and the fresh-device rule', async () => {
  const html = await clientHtml();
  const block = tourBlock(html);
  assert.ok(block.includes('const TOUR_KEY = "beuk.tour.v1";'));
  assert.ok(block.includes('const TOUR_DESK_KEY = "beuk.desk";'));
  assert.ok(html.includes('localStorage.setItem("beuk.desk", "1")'), 'the first real save still writes beuk.desk');
  assert.ok(block.includes('localStorage.setItem(TOUR_KEY, reason)'), 'finishing or skipping stores the outcome');
  // the decision: no storage, a stored outcome, the desk flag, or a book on the desk each say no
  const decide = block.slice(block.indexOf('function tourDecide('), block.indexOf('function tourReadDevice('));
  assert.match(decide, /if \(!d \|\| !d\.storage\) return false;/);
  assert.match(decide, /if \(d\.stored\) return false;/);
  assert.match(decide, /if \(d\.desk === "1"\) return false;/);
  assert.match(decide, /return !!d\.empty;/);
  // it starts after the device's book is restored, from init
  assert.ok(html.includes('tourInit(); /* BEUK:tour'), 'init starts the tour code');
  assert.ok(block.includes('localRestorePromise'), 'it waits for the restore');
  assert.ok(html.includes('if (typeof tourOnLangChange === "function") tourOnLangChange();'), 'it follows the interface language');
});

test('tour: every control the tour points at exists in the studio markup', async () => {
  const html = await clientHtml();
  const block = tourBlock(html);
  const stepsSrc = block.slice(block.indexOf('const TOUR_STEPS = ['), block.indexOf('const tour = {'));
  const ids = [...new Set([...stepsSrc.matchAll(/"#([A-Za-z]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(ids, ['btnExport', 'btnImport', 'btnSampleStory', 'deviceBar', 'editorArea', 'tabBtnContent', 'tabBtnType']);
  for (const id of ids) assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id} is in the markup exactly once`);
  for (const sel of ['data-mpane="structure"', 'data-mpane="center" data-mstyle="1"', 'data-mpane="preview"']) {
    assert.ok(html.includes(sel), `the phone tab ${sel} is in the markup`);
  }
  assert.match(html, /<button type="button" class="tour-again" id="btnTourAgain" data-i18n="tour\.show">Show the quick tour<\/button>/);
  // it sits under every dialog and steps aside for them and for Zen
  assert.match(html, /\.tour-card \{\s*position: fixed; z-index: 59;/);
  assert.ok(block.includes('document.querySelector(".modal-back.open")'));
  assert.ok(block.includes('b.classList.contains("zen")'));
  assert.ok(block.includes('card.setAttribute("aria-modal", "false")'), 'the card is not modal');
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.tour-card \{ animation: none; \}/.test(html), 'reduced motion: no fade');
});

test('tour: each client tour.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await clientHtml();
  const clientIds = [...new Set([...tourBlock(html).matchAll(/id: "(tour\.[a-z0-9.-]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(clientIds, ['tour.fresh-device-only', 'tour.never-over-dialog-or-zen', 'tour.no-overflow-rtl-phone', 'tour.skip-ends-for-good', 'tour.targets-visible']);
  const server = SELF_CHECK_CASES.filter((c) => c.id.startsWith('tour.'));
  assert.deepEqual(server.map((c) => c.id).sort(), clientIds);
  for (const c of server) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} carries a reason`);
  }
});

test('tour: a replay opened on an empty desk ends when a book arrives, as the first-run tour does', async () => {
  const block = tourBlock(await clientHtml());
  const start = block.slice(block.indexOf('function tourStart('), block.indexOf('function tourGo('));
  assert.ok(start.includes('tour.empty0 = (opts.empty0 !== undefined) ? !!opts.empty0 : isEmptyDesk();'), 'the start records whether the desk was empty');
  const began = block.slice(block.indexOf('function tourWriterBegan('), block.indexOf('function tourTick('));
  assert.ok(began.includes('if (edits > tour.edits0) return true;'), 'a real edit still ends it');
  assert.ok(began.includes('return (!tour.replay || tour.empty0) && !isEmptyDesk();'), 'an import or the sample on a desk that was empty ends it, replay or not');
  const suspend = block.slice(block.indexOf('function tourSuspendForChecks('));
  assert.ok(suspend.includes('empty0: tour.empty0') && suspend.includes('tourStart({ replay: keep.replay, empty0: keep.empty0 });'), 'a Self-checks run brings it back with the same starting desk');
});

test('tour: the Help guide for importing links to the tour, and the studio opens it from /studio#tour', async () => {
  const guide = await readFile(path.join(here, '..', 'content', 'help', 'guides', 'import-a-manuscript.md'), 'utf8');
  assert.ok(guide.includes('[Show the quick tour](/studio#tour)'), 'the Help guide links to the tour');
  const block = tourBlock(await clientHtml());
  assert.ok(block.includes('const asked = /^#tour$/i.test(location.hash || "");'), 'tourInit answers /studio#tour');
});
