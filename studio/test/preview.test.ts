// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs build script, no types
import { PREVIEW_ROOTS, PREVIEW_SUPPLIED } from '../scripts/extract-closure.mjs';
import { PREVIEW_NAMES, PREVIEW_API, PREVIEW_SUPPLIED_NAMES } from '../src/generated/closure-preview.js';
import { CLOSURE_NAMES, CLOSURE_SUPPLIED } from '../src/generated/closure.js';

/* Step 5 wave 4b (E1, E2): 1.0's preview, its reading desk, the hardcover and full screen, lifted whole into their
   OWN module (src/generated/closure-preview.js): its own `state`, which only the preview sets (the book read through
   the Style session's safe path), so its timers (the desk's chunks, the reader's frames, the font reloads) never run
   on another part of the studio's state. */

describe('the preview module (wave 4b)', () => {
  it("lifts 1.0's preview, desk, hardcover and full-screen code", () => {
    for (const r of PREVIEW_ROOTS) expect(PREVIEW_API).toContain(r);
    for (const n of ['renderPreview', 'measurePages', 'goToPage', 'setDevice', 'initPreview', 'updateDesk', 'renderDesk', 'keepOrnamentsWithText',
      'deskSignature', 'deskState', 'PAGE_GEOMETRY', 'DEVICE_DISPLAY', 'hcRender', 'hcInit', 'fsInit', 'fsToggle', 'buildPrintViewModel', 'sectionHtml', 'buildBookCss'])
      expect(PREVIEW_NAMES).toContain(n);
  });
  it('supplies the page, the string tables and the main studio’s functions; never lifts them', () => {
    for (const s of ['state', 't', '$', 'activeSection', 'renderSidebar', 'syncEditor', 'renderPrintView', 'raStop', 'dictDiscard']) expect(PREVIEW_SUPPLIED_NAMES).toContain(s);
    expect(PREVIEW_SUPPLIED).toEqual(expect.arrayContaining(['$', 'renderPrintView']));
    for (const n of ['t', 'UI_STRINGS', 'uiLangState', '$', 'raStop', 'renderPrintView']) expect(PREVIEW_NAMES).not.toContain(n);
  });
  it('the main closure lifts no preview code: its renderPreview, deskState and deskSignature are supplied (the preview module’s)', () => {
    for (const s of ['renderPreview', 'deskState', 'deskSignature']) expect(CLOSURE_SUPPLIED).toContain(s);
    for (const n of ['measurePages', 'updateDesk', 'hcRender']) expect(CLOSURE_NAMES).not.toContain(n);
  });
  it('is static code (no eval, no new Function)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/generated/closure-preview.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/\beval\s*\(|new Function\s*\(/);
  });
});
