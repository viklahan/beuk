import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:leftcol — with the stats panel open the chapter list keeps its room;
   the panel gives way and scrolls inside itself. Measured in the studio
   (one self-check); server side: its registration and the CSS guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const ID = 'leftcol.stats-open.chapters-reachable';

test('left column: the self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes(`{ id: "${ID}"`));
  const c = SELF_CHECK_CASES.find((x) => x.id === ID);
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('left column: the chapter list has a floor and the dock below it can give way', async () => {
  const html = await clientHtml();
  assert.match(html, /#structureScroll \{ flex: 1 1 0;[^}]*min-height: min\(200px, 30vh\)/);
  assert.match(html, /\.side-dock \{[^}]*flex: 0 1 auto; min-height: 0;/);
  assert.match(html, /\.side-status-body \{[^}]*overflow-y: auto; min-height: 0;/);
});
