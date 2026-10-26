// BEUK:bookcolour — a book's accent colour and page tint (Typography
// Studio). Static checks over the studio file: the colour flows through
// the one generator (buildBookCss) to every surface, print keeps the
// accent and ignores the tint, the contrast guard uses the WCAG maths and
// thresholds, the named swatches pass it, the colour rides with the book,
// and the new strings exist in all 13 interface languages. The behaviour
// itself is asserted in the browser by the client self-checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');

// WCAG 2.x relative luminance and contrast ratio, written out here from the
// definition so the studio's numbers are checked against an independent copy.
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const swatches = (name: string) => {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(html);
  assert.ok(m, `${name} is defined`);
  return [...m[1].matchAll(/\{ id: "([a-z]+)", hex: "(#[0-9a-f]{6})" \}/g)].map((x) => ({ id: x[1], hex: x[2] }));
};

test('the contrast guard uses the WCAG thresholds: 3:1 for the accent (large text), 4.5:1 for black text on a tint', () => {
  assert.ok(html.includes('const COLOUR_MIN_LARGE = 3;'));
  assert.ok(html.includes('const COLOUR_MIN_TEXT = 4.5;'));
  assert.ok(html.includes('const COLOUR_PAGE = "#ffffff";'));
  assert.ok(html.includes('const COLOUR_TEXT = "#000000";'));
  assert.ok(html.includes('return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];'));
  assert.ok(html.includes('(x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))'));
  assert.ok(html.includes('return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);'));
  // a colour just under a threshold never reads as on it
  assert.ok(html.includes('const colourRatioText = (r) => (Math.floor(r * 100) / 100).toFixed(2);'));
  // the reference values the self-check relies on
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.01);
  assert.equal((Math.floor(contrast('#ffd23f', '#ffffff') * 100) / 100).toFixed(2), '1.44');
  assert.equal((Math.floor(contrast('#1f62a8', '#a0a0a0') * 100) / 100).toFixed(2), '2.38');
});

test('every named accent passes 3:1 on white and on every named tint; every tint keeps black text at 4.5:1', () => {
  const accents = swatches('COLOUR_ACCENTS');
  const tints = swatches('COLOUR_TINTS');
  assert.equal(accents.length, 10);
  assert.equal(tints.length, 4);
  for (const a of accents) for (const p of ['#ffffff', ...tints.map((x) => x.hex)]) assert.ok(contrast(a.hex, p) >= 3, `${a.id} ${a.hex} on ${p}: ${contrast(a.hex, p).toFixed(2)}`);
  for (const x of tints) assert.ok(contrast(x.hex, '#000000') >= 4.5, `${x.id} with black text`);
});

test('the colour flows through the one generator, and only when set (unset = the CSS it always was)', () => {
  // buildBookCss appends the colour and display rules last; both return [] when unused
  assert.ok(html.includes('css.push(...displayFaceRules(S, t, hd, bodyFf), ...bookColourRules(S, root, scope));\n        return css.join("\\n");'));
  const rules = /function bookColourRules\(S, root, scope\) \{([\s\S]*?)\n      \}/.exec(html)![1];
  assert.ok(rules.includes('if (c.accent) {'));
  assert.ok(rules.includes('BOOK_ACCENT_TARGETS.map((x) => S + x).join(", ") + " { color: " + c.accent + "; }"'));
  assert.ok(rules.includes('S + ".ch-ornate_framed { border-color: " + c.accent + "; }"'));
  // the tint is whole-document only: never a scoped surface (preview flow, zen, print view)
  assert.ok(rules.includes('if (c.tint && !scope) out.push(root + " { background-color: " + c.tint + "; --orn-bg: " + c.tint + "; }");'));
  const targets = /const BOOK_ACCENT_TARGETS = \[([\s\S]*?)\];/.exec(html)![1];
  for (const sel of ['.chapter-number', '.chapter-title', '.chapter-rule', '.scene-break', '.dropcap', '.part-title', '.tp-top', '.tp-title'])
    assert.ok(targets.includes(`"${sel}"`), `${sel} wears the accent`);
  // every surface reads the one generator
  assert.ok(html.includes('styleEl.textContent = buildBookCss(".fc-page");'));
  assert.ok(html.includes('files.push({ path: "OEBPS/Styles/blitz.css", content: buildBookCss("")'));
  assert.ok(html.includes('const css = buildBookCss("") + "\\n" + buildPrintCss() + "\\n" +'));
});

test('print keeps the accent, blends it for its solid tints and ornaments, and prints on white paper whatever the tint', () => {
  assert.ok(html.includes('out.push(sel + " { opacity: 1; color: " + printBlendHex(printInkFor(sel), PRINT_PAGE, a) + "; }"); /* BEUK:bookcolour */'));
  assert.ok(html.includes('if (v === "currentColor") return printBlendHex(printOrnamentInk(), PRINT_PAGE, alpha);'));
  assert.ok(html.includes('const printOrnamentInk = () => bookColour().accent || PRINT_INK;'));
  // the print document's own page rule follows the book CSS, so white paper wins over a tint
  const fn = /function buildPrintHtml\(\) \{([\s\S]*?)\n      \}/.exec(html)![1];
  const iBook = fn.indexOf('buildBookCss("")'), iPaper = fn.indexOf('"html, body { margin: 0; padding: 0; background: " + PRINT_PAGE');
  assert.ok(iBook !== -1 && iPaper > iBook, 'the paper rule comes after the book CSS');
  assert.ok(html.includes('const PRINT_PAGE = "#ffffff";'));
});

test('the preview screen wears the tint (not the OLED phone); the colour rides with the book and its snapshots', () => {
  assert.ok(html.includes('scr.style.backgroundColor = tint && !(fr && fr.classList.contains("frame-phone")) ? tint : "";'));
  assert.equal(html.split('colourApplyPreviewTint(); /* BEUK:bookcolour */').length - 1, 2, 'on render and on device change');
  assert.ok(html.includes('...(bookColourSet() ? { colour: bookColour() } : {}), /* BEUK:bookcolour — absent when unset */'));
  assert.ok(html.includes('state.bookColour = bookColourNormalize(doc.colour);'));
  // snapshots are serializeBook() minus the history: they carry the colour
  assert.ok(/function snapshotBookDoc\(\) \{\s*const d = serializeBook\(\);/.test(html));
});

test('new studio strings exist in all 13 languages, with their placeholders, and no exclamation marks', () => {
  const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'];
  const keys = ['fonts.displayGroup', 'df.fetchFail', 'colour.h', 'colour.sub', 'colour.accent', 'colour.none', 'colour.custom', 'colour.tint', 'colour.customTint',
    'colour.tintNote', 'colour.printNote', 'colour.refusedAccent', 'colour.refusedTint', 'colour.refusedTintAccent', 'colour.okAccent', 'colour.okTint', 'colour.cleared', 'colour.tintCleared',
    ...['ember', 'tomato', 'oxblood', 'brass', 'paddy', 'seaglass', 'azure', 'ink', 'fig', 'slate'].map((k) => `colour.sw.${k}`),
    ...['cream', 'sky', 'blush', 'sage'].map((k) => `colour.tw.${k}`)];
  const en: Record<string, string> = {};
  for (const lang of langs) {
    const target = lang === 'zh-Hans' ? 'UI_STRINGS["zh-Hans"]' : `UI_STRINGS.${lang}`;
    const blocks = [...html.matchAll(new RegExp(`Object\\.assign\\(${target.replace(/[.[\]"]/g, '\\$&')}, (\\{"fonts\\.displayGroup"[^\\n]*\\})\\);`, 'g'))];
    assert.equal(blocks.length, 1, `${lang}: one block`);
    const d = JSON.parse(blocks[0][1]) as Record<string, string>;
    assert.deepEqual(Object.keys(d).sort(), [...keys].sort(), `${lang}: every key`);
    if (lang === 'en') Object.assign(en, d);
    for (const k of keys) {
      assert.ok(d[k] && d[k].trim(), `${lang} ${k}`);
      assert.ok(!d[k].includes('!'), `${lang} ${k}: no exclamation mark`);
      for (const ph of ['{hex}', '{ratio}', '{list}']) if (en[k]?.includes(ph)) assert.ok(d[k].includes(ph), `${lang} ${k}: ${ph}`);
      if (lang !== 'en' && !/^colour\.(sw|tw)\./.test(k) && k !== 'colour.h') assert.notEqual(d[k], en[k], `${lang} ${k} is translated`);
    }
  }
});

test('the colour self-checks are in the studio and registered client-only', () => {
  for (const id of ['colour.accent.reaches-every-output', 'colour.unset.css-identical', 'colour.contrast.guard', 'colour.persists-with-book', 'fonts.display.heading-only', 'fonts.display.preview-and-epub']) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only');
  }
});
