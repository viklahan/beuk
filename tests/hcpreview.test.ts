import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* The Hardcover device lives in the studio's preview pane. Its server
   side is the Housekeeping registration: every client
   preview.hardcover.* self-check is mirrored as a client-only case with
   a reason — never dropped, never faked. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('hcpreview: every client preview.hardcover.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await clientHtml();
  const clientIds = [...html.matchAll(/id: "(preview\.hardcover\.[a-z0-9.-]+)"/g)].map((m) => m[1]);
  assert.ok(clientIds.length >= 7, `expected the hardcover-device self-checks in the client, found ${clientIds.length}`);
  const serverIds = SELF_CHECK_CASES.filter((c) => c.id.startsWith('preview.hardcover.')).map((c) => c.id);
  assert.deepEqual([...serverIds].sort(), [...new Set(clientIds)].sort());
  for (const c of SELF_CHECK_CASES.filter((x) => x.id.startsWith('preview.hardcover.'))) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} must carry a reason`);
  }
});

test('hcpreview: the device menu carries eleven devices and the device self-check expects exactly them', async () => {
  const html = await clientHtml();
  const bar = /<select class="dev-select" id="deviceBar"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(bar, 'device menu present');
  const ids = [...bar[1].matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['kindle', 'ipad', 'kobo', 'phone', 'oasis', 'basic', 'colorsoft', 'iphone', 'forma', 'android', 'hardcover']);
  assert.match(html, /btns\.length === 11 && \["kindle", "ipad", "kobo", "phone", "oasis", "basic", "colorsoft", "iphone", "forma", "android", "hardcover"\]/);
});

test('default device: Android Tablet, one id, and the first paint is what setDevice would draw for it', async () => {
  const html = await clientHtml();
  const id = /const DEFAULT_DEVICE = "([a-z]+)";/.exec(html)?.[1];
  assert.equal(id, 'android');
  assert.match(html, /\n\s+device: DEFAULT_DEVICE,\n/, 'the state starts on it');
  const bar = /<select class="dev-select" id="deviceBar"[^>]*>([\s\S]*?)<\/select>/.exec(html)!;
  const selected = [...bar[1].matchAll(/<option value="([a-z]+)"[^>]* selected/g)].map((m) => m[1]);
  assert.deepEqual(selected, [id], 'exactly the default option is selected');
  const footer = new RegExp(`const DEVICE_FOOTERS = \\{[^}]*\\b${id}: "([^"]*)"`).exec(html)![1];
  const display = new RegExp(`\\n\\s+${id}: \\{ type: "([a-z-]+)"`).exec(html.slice(html.indexOf('const DEVICE_DISPLAY')))![1];
  assert.ok(html.includes(`<div id="deviceFrame" class="frame-${id}" data-display="${display}">`), 'frame class and display type');
  assert.ok(html.includes(`<span id="footDevice">${footer}</span>`), 'footer');
});

test('hcpreview: the open book is built from the print view engine and every hcp.* string ships in all 13 locales', async () => {
  const html = await clientHtml();
  // The spread must come from the print pagination, not the e-reader flow.
  assert.match(html, /hc\.model = buildPrintViewModel\(\);/);
  assert.match(html, /box\.appendChild\(pivPageEl\(page, side, model\)\)/);
  // The square cites the IngramSpark constant it derives from.
  assert.match(html, /const hcSquareIn = \(\) => HC_SPEC\.caseLam\.boardHPlus \/ 2;/);
  const enBlock = /Object\.assign\(UI_STRINGS\.en, \{ ("hcp\.[^\n]*) \}\);/.exec(html);
  assert.ok(enBlock, 'English hardcover-device strings present');
  const keys = [...enBlock[1].matchAll(/"(hcp\.[A-Za-z]+)":/g)].map((m) => m[1]);
  assert.ok(keys.length >= 21, `hcp keys: ${keys.length}`);
  for (const k of keys) {
    const n = html.split(`"${k}":`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locale packs, expected 13`);
  }
});

test('hcpreview: the closed case tips its head toward the viewer and builds the recessed page block on three sides', async () => {
  const html = await clientHtml();
  // A positive rotateX turns the head away and back-face culls it (the
  // reviewer's finding); the resting and hover tilts must both be negative.
  const rest = /\.hc-book \{[^}]*transform: rotateX\((-?\d+)deg\) rotateY\(\d+deg\)/.exec(html);
  const hover = /\.hc-book:hover, \.hc-stage:focus-visible \.hc-book \{ transform: rotateX\((-?\d+)deg\)/.exec(html);
  assert.ok(rest && hover, 'closed-book tilts present');
  assert.ok(Number(rest[1]) < 0 && Number(hover[1]) < 0, `tilts ${rest[1]} / ${hover[1]} must tip the head toward the eye`);
  for (const face of ['"hc-top"', '"hc-tail"', '"hc-fore"', '"hc-inner"', '"hc-eh-"', '"hc-et-"', '"hc-ef-"']) {
    assert.ok(html.includes(face), `closed book builds ${face}`);
  }
});
