import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* Bulk import's status chip sits in the corner of the studio. It is hidden
   with the `hidden` attribute, and it is display:flex, which outranks the
   browser's own [hidden] rule: without a rule of its own a hidden chip showed
   as an empty box with only its close button (found on the live 2.0 studio,
   2026-11-20). The studio lifts the chip's rules from this page. */

const here = path.dirname(fileURLToPath(import.meta.url));

test('bulk chip: a hidden chip is not drawn', async () => {
  const html = await readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
  assert.match(html, /<div class="bulk-chip" id="bulkChip" role="status" aria-live="polite" hidden>/, 'the chip starts hidden, by the hidden attribute');
  assert.match(html, /\.bulk-chip \{[^}]*display: flex;/, 'the chip is a flex box');
  assert.match(html, /\.bulk-chip\[hidden\] \{ display: none; \}/, 'so its hidden state needs its own rule');
  assert.match(html, /function bulkChipHide\(\) \{ const chip = \$\("bulkChip"\); if \(chip\) chip\.hidden = true; \}/, 'and hiding it is setting that attribute');
});
