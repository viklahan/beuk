// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs build script, no types
import { coverHtmlSinks, COVER_HTML_SAFE } from '../scripts/extract-closure.mjs';

/* Review round 2, Minor 5: the session's cleaner wraps only what 1.0's `$` hands out (session.ts guarded()). So the
   build fails when a lifted cover-maker function (client/index.html "Cover maker" to "EPUB 3.2 packaging") writes HTML
   — innerHTML, outerHTML, insertAdjacentHTML — into anything that is not a `$()` result, unless it is one of the two
   known-safe sites (COVER_HTML_SAFE: sbRenderGrid and sbSync, which write only Lucide's own icon nodes and esc()'d
   names). */
const CLOSURE_JS = fileURLToPath(new URL('../src/generated/closure.js', import.meta.url));

describe("the cover maker's HTML sinks are the cleaner's", () => {
  it('passes on 1.0 as it is: every cover write goes through $() but the two known-safe sites', () => {
    const r = coverHtmlSinks(readFileSync(CLOSURE_JS, 'utf8'));
    expect(r.unguarded).toEqual([]);
    expect(r.allowed.map((x: { fn: string }) => x.fn).sort()).toEqual(['sbRenderGrid', 'sbSync']);
    expect(r.guarded).toBeGreaterThan(10);
    expect(COVER_HTML_SAFE).toEqual(['sbRenderGrid', 'sbSync']);
  });

  it('fails on a write into an element reached any other way', () => {
    const code = `function renderMakerArt() { const g = document.getElementById("cmArtGrid"); g.innerHTML = "<b>" + x + "</b>"; }
function syncMakerControls() { $("cmLayoutGrid").innerHTML = "ok"; const h = $("cmSwatches"); h.insertAdjacentHTML("beforeend", y); document.querySelector("#cmX").outerHTML = z; }`;
    const r = coverHtmlSinks(code, ['renderMakerArt', 'syncMakerControls']);
    expect(r.unguarded.map((x: { fn: string; sink: string }) => x.fn + ':' + x.sink)).toEqual(['renderMakerArt:innerHTML', 'syncMakerControls:outerHTML']);
    expect(r.guarded).toBe(2);
  });
});
