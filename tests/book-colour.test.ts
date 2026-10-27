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
  assert.ok(html.includes('const css = buildBookCss("") + "\\n" + buildPrintCss(state.printTrim, !!state.printRecto) + "\\n" +'));
});

test('print keeps the accent, blends it for its solid tints and ornaments, and prints on white paper whatever the tint', () => {
  assert.ok(html.includes('out.push(sel + " { opacity: 1; color: " + printBlendHex(printInkFor(sel), PRINT_PAGE, a) + "; }"); /* BEUK:bookcolour */'));
  assert.ok(html.includes('if (v === "currentColor") return printBlendHex(printOrnamentInk(), PRINT_PAGE, alpha);'));
  assert.ok(html.includes('const printOrnamentInk = () => printAccent() || PRINT_INK;'));
  assert.ok(html.includes('const printAccent = () => { const c = bookColour(); return c.printBlack ? "" : c.accent; };'));
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

test('on the studio dark surfaces the accent is lifted to 3:1; the grounds it measures are the studio’s own', () => {
  // the reference failure: a dark accent on the OLED phone's black screen, and on Candlelight's ground
  assert.ok(contrast('#1f3a64', '#000000') < 3);
  assert.ok(contrast('#7a1f2b', '#100e0c') < 3);
  // the grounds named in the code are the ones the studio paints
  assert.ok(html.includes('.frame-phone .screen { background: #000000; color: #e9e9e9;'));
  const candle = /:root\[data-theme="candlelight"\] \{([\s\S]*?)\}/.exec(html)![1];
  for (const [tok, hex] of [['--bg', '#100e0c'], ['--panel', '#181715'], ['--panel-2', '#22201d'], ['--panel-3', '#262320']]) assert.ok(candle.includes(`${tok}: ${hex};`), `${tok} ${hex}`);
  assert.ok(html.includes('background: radial-gradient(120% 85% at 50% -10%, #2e2416 0%, var(--panel-3) 58%);'));
  assert.ok(html.includes('{ scope: ".fc-page", on: ".frame-phone ", bgs: ["#000000"] },'));
  assert.ok(html.includes('{ scope: ".zen-book", on: \':root[data-theme="candlelight"] \', bgs: ["#100e0c", "#181715", "#22201d", "#262320", "#2e2416"] }'));
  // the lift: mixed with white in 5% steps until 3:1 on every ground, emitted only for the scoped surface
  assert.ok(html.includes('const h = "#" + rgb.map((v) => Math.round(v + (255 - v) * k / 20).toString(16).padStart(2, "0")).join("");'));
  assert.ok(html.includes('if (bgs.every((b) => colourContrast(h, b) >= COLOUR_MIN_LARGE)) return h;'));
  const rules = /function bookColourRules\(S, root, scope\) \{([\s\S]*?)\n      \}/.exec(html)![1];
  assert.ok(rules.includes('if (d.scope !== scope) return;'));
  assert.ok(rules.includes('out.push(BOOK_ACCENT_TARGETS.map((x) => d.on + S + x).join(", ") + " { color: " + lit + "; }");'));
  // independent copy of the lift: every named accent reaches 3:1 on every ground
  const lift = (hex: string, bgs: string[]) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let k = 0; k <= 20; k++) {
      const h = '#' + rgb.map((v) => Math.round(v + ((255 - v) * k) / 20).toString(16).padStart(2, '0')).join('');
      if (bgs.every((b) => contrast(h, b) >= 3)) return h;
    }
    return '#ffffff';
  };
  for (const a of swatches('COLOUR_ACCENTS'))
    for (const bgs of [['#000000'], ['#100e0c', '#181715', '#22201d', '#262320', '#2e2416']]) {
      const h = lift(a.hex, bgs);
      for (const b of bgs) assert.ok(contrast(h, b) >= 3, `${a.id} -> ${h} on ${b}`);
    }
});

test('print can set the accent in black ink; the panel says plainly what a coloured accent does in print', () => {
  assert.ok(html.includes('if (accent && o.printBlack === true) out.printBlack = true;'));
  const fn = /function printColourCss\(S\) \{([\s\S]*?)\n      \}/.exec(html)![1];
  assert.ok(fn.includes('if (!c.accent || !c.printBlack) return "";'));
  assert.ok(fn.includes('BOOK_ACCENT_TARGETS.map((x) => S + x).join(", ") + " { color: " + PRINT_INK + "; }'));
  // the print interior: after the book CSS and the paper rule, before the solid tints
  const pr = /function buildPrintHtml\(\) \{([\s\S]*?)\n      \}/.exec(html)![1];
  const iBook = pr.indexOf('buildBookCss("")'), iBlack = pr.indexOf('printColourCss("")'), iPress = pr.indexOf('printPressCss()');
  assert.ok(iBook !== -1 && iBlack > iBook && iPress > iBlack);
  assert.ok(html.includes('"\\n" + printColourCss(".piv-book ") + printSolidTintCss(buildBookCss(".piv-book"));'));
  assert.ok(html.includes('<input type="checkbox" id="colourPrintBlack" />'));
  assert.ok(html.includes('$("colourPrintBlack").addEventListener("change", (e) => setBookPrintBlack(e.target.checked));'));
  // no unbacked claim that black-ink print turns the accent grey; the Store-ready row is named
  assert.ok(!html.includes('a black-ink edition prints it in grey'));
  assert.ok(html.includes('the Store-ready report warns under “Text in black ink only”'));
  assert.ok(!html.includes("The book's text has no colour setting of its own"));
});

test('the review strings (print in black ink, dark screens) exist in all 13 languages', () => {
  const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'];
  const keys = ['colour.printBlack', 'colour.printBlackHint', 'colour.darkNote'];
  let en: Record<string, string> = {};
  for (const lang of langs) {
    const target = lang === 'zh-Hans' ? 'UI_STRINGS["zh-Hans"]' : `UI_STRINGS.${lang}`;
    const blocks = [...html.matchAll(new RegExp(`Object\\.assign\\(${target.replace(/[.[\]"]/g, '\\$&')}, (\\{"colour\\.printBlack"[^\\n]*\\})\\);`, 'g'))];
    assert.equal(blocks.length, 1, `${lang}: one block`);
    const d = JSON.parse(blocks[0][1]) as Record<string, string>;
    assert.deepEqual(Object.keys(d).sort(), [...keys].sort(), `${lang}: every key`);
    if (lang === 'en') en = d;
    for (const k of keys) {
      assert.ok(d[k] && d[k].trim() && !d[k].includes('!'), `${lang} ${k}`);
      if (lang !== 'en') assert.notEqual(d[k], en[k], `${lang} ${k} is translated`);
    }
  }
});

test('the colour self-checks are in the studio and registered client-only', () => {
  for (const id of ['colour.accent.reaches-every-output', 'colour.unset.css-identical', 'colour.contrast.guard', 'colour.persists-with-book', 'colour.dark-surfaces.readable', 'colour.print.black-ink-option', 'fonts.display.heading-only', 'fonts.display.preview-and-epub']) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only');
  }
});
