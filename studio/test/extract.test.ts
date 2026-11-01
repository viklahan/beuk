// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs build script, no types
import { extractIcons, extractStrings, extractTokens, REQUIRED_TOKENS } from '../scripts/extract-studio.mjs';
import { studioHtml } from './one-source';

const lucide = () => readFileSync(fileURLToPath(new URL('../../client/assets/vendor/lucide.min.js', import.meta.url)), 'utf8');

/* Review focus #5: if UI_STRINGS or the token blocks move or rename in
   1.0, the build fails with a message naming what is missing. */
describe('the extraction breaks loudly', () => {
  it('extracts every pack, the tokens of both themes and the icons from the real 1.0', async () => {
    const s = await extractStrings(studioHtml());
    expect(s.order.length).toBe(13);
    expect(Object.keys(s.packs.en).length).toBeGreaterThan(1000);
    expect(s.rtl).toEqual(['ar']);
    const tk = extractTokens(studioHtml());
    for (const t of REQUIRED_TOKENS) expect(tk.paper).toContain(t);
    expect(tk.css).toContain(':root[data-theme="candlelight"] {');
    expect(Object.keys(extractIcons(lucide())).length).toBeGreaterThan(5);
  }, 60_000);

  it('a renamed UI_STRINGS fails, naming it', async () => {
    const html = studioHtml().replace('const UI_STRINGS = {', 'const UI_STRINGS_RENAMED = {');
    await expect(extractStrings(html)).rejects.toThrow(/UI_STRINGS/);
  }, 60_000);

  it('a moved UI_LANG_ORDER fails, naming it', async () => {
    const html = studioHtml().replace('const UI_LANG_ORDER = [', 'const UI_LANGS = [');
    await expect(extractStrings(html)).rejects.toThrow(/UI_LANG_ORDER/);
  }, 60_000);

  it('a pack missing English keys fails, naming the pack', async () => {
    const html = studioHtml().replace('UI_STRINGS["es"] = {\n        "top.signIn": "Iniciar sesión", ', 'UI_STRINGS["es"] = {\n        ');
    expect(html).not.toBe(studioHtml());
    await expect(extractStrings(html)).rejects.toThrow(/UI_STRINGS\["es"\] lacks 1 key\(s\).*top\.signIn/);
  }, 60_000);

  it('a renamed or emptied token block fails, naming it', () => {
    const html = studioHtml();
    expect(() => extractTokens(html.replace(':root[data-theme="candlelight"] {\n        color-scheme: dark;', ':root[data-theme="night"] {\n        color-scheme: dark;'))).toThrow(
      /--bg|candlelight/,
    );
    expect(() => extractTokens(html.replace('--panel: #f8f4e9;', '--panelx: #f8f4e9;'))).toThrow(/:root token blocks no longer declare: --panel\b/);
    expect(() => extractTokens(html.replace(/<style>/, '<stile>'))).toThrow(/no <style>|token block/);
  });

  it('a missing icon fails, naming it', () => {
    expect(() => extractIcons('var lucide = { icons: {} };')).toThrow(/no icon\(s\): Globe/);
  });
});
