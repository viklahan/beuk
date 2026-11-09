import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderSnapshot } from '../src/shares/render.js';
import * as reader from '../src/shares/reader.js';

// Named reading links, Task 2: the watermark on a named reader page.
// The open page must stay byte-equal to the golden captured before
// any edit (tests/fixtures/reader-open-page.html, commit 8fdd09f).

const { readerHeaders, renderReaderPage } = reader;
// Looked up loosely so the RED run fails per test, not at import.
const stampText = (name: string, iso: string): string => (reader as any).stampText(name, iso);
const stampDataUri = (text: string): string => (reader as any).stampDataUri(text);

const root = path.resolve(import.meta.dirname, '..');
const GOLDEN = readFileSync(path.join(root, 'tests', 'fixtures', 'reader-open-page.html'), 'utf8');

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// The same studio document as tests/shares.test.ts.
const studioDoc = {
  meta: { title: 'The Lantern Coast', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'sec-cover', kind: 'front', type: 'cover', title: 'Cover', content: '' },
    { id: 'sec-ded', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the keepers.' },
    {
      id: 'sec-one',
      kind: 'body',
      type: 'chapter',
      number: 'One',
      title: 'First Light',
      content:
        'It began with the tide.[^1]\n\nThe *second* paragraph, **strong**.\n\n***\n\n![A chart of the harbour](img:img-chart)\n\n[^1]: A note on tides.',
    },
    { id: 'sec-two', kind: 'body', type: 'chapter', number: 'Two', title: 'Fog', content: 'The fog came in.' },
    { id: 'sec-hidden', kind: 'body', type: 'chapter', title: 'Cut', content: 'Not shipped.', included: false },
  ],
  images: [{ id: 'img-chart', name: 'chart', mediaType: 'image/png', ext: 'png', data: PNG_1PX }],
};
const { snapshot } = renderSnapshot(studioDoc, 'Untitled');
const NONCE = 'golden-nonce-0001';
const base = { nonce: NONCE, token: 'golden-token', snapshot, chapter: 1, allowComments: true, readerNameRequired: true };
const CREATED = '2026-11-06T23:30:00Z';
const named = (name: string) => renderReaderPage({ ...base, recipient: { name, createdAt: CREATED } });

const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** The one nonce'd <style> block's text. */
function styleOf(html: string): string {
  const open = `<style nonce="${NONCE}">`;
  const i = html.indexOf(open);
  assert.ok(i >= 0, 'the nonce style is there');
  const j = html.indexOf('</style>', i);
  return html.slice(i + open.length, j);
}
/** The SVG inside the stamp's data: URI, decoded. */
function svgOf(css: string): string {
  const m = /url\("data:image\/svg\+xml,([^"]*)"\)/.exec(css);
  assert.ok(m, 'a data: SVG background in the style');
  return decodeURIComponent(m[1]);
}
/** The SVG <text>'s character content, tags stripped and XML-unescaped. */
const svgText = (svg: string) => unxml((/<text[^>]*>([\s\S]*?)<\/text>/.exec(svg) ?? ['', ''])[1].replace(/<[^>]*>/g, ''));

test('open page byte-equal to the golden', () => {
  assert.equal(renderReaderPage(base), GOLDEN);
});

test('readerHeaders unchanged: equal to the open page headers', () => {
  // The route sends readerHeaders(nonce) for the open and the named page alike.
  assert.deepEqual(readerHeaders(NONCE), {
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self' data:; style-src 'self' 'nonce-golden-nonce-0001'; script-src 'nonce-golden-nonce-0001'; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  });
});

test('stampText: Shared with <name> \u00B7 <d Mon yyyy>, UTC, no leading zero', () => {
  assert.equal(stampText('Priya', '2026-11-06T23:30:00Z'), 'Shared with Priya \u00B7 6 Nov 2026');
  assert.equal(stampText('A', '2026-01-09T00:00:00Z'), 'Shared with A \u00B7 9 Jan 2026');
  // UTC, not local: 23:30 on the 31st stays the 31st.
  assert.equal(stampText('B', '2026-12-31T23:59:59Z'), 'Shared with B \u00B7 31 Dec 2026');
  assert.equal(stampText('C', '2026-05-01T00:30:00+02:00'), 'Shared with C \u00B7 30 Apr 2026');
});

test('named page: the line in .rd-kicker with <bdi>, the stamp layer, both inside @media print too, the name input readonly', () => {
  const html = named('Priya');
  // The top line, in the existing kicker slot.
  const k = /<p class="rd-kicker[^"]*">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(k, 'kicker');
  assert.equal(k[1], 'Shared with <bdi>Priya</bdi> \u00B7 6 Nov 2026');
  assert.ok(!html.includes('A reading copy, shared with you'), 'the open kicker is replaced');
  // The stamp layer: present in the markup, fixed, behind, never in the way.
  assert.match(html, /<div class="rd-stamp" aria-hidden="true"><\/div>/);
  const css = styleOf(html);
  const rule = /\.rd-stamp\{([^}]*)\}/.exec(css);
  assert.ok(rule, '.rd-stamp rule');
  for (const decl of ['position:fixed', 'inset:0', 'pointer-events:none', 'z-index:0']) {
    assert.ok(rule[1].includes(decl), `.rd-stamp has ${decl}`);
  }
  assert.match(css, /\.rd-page[^{]*\{position:relative;z-index:1\}/);
  assert.equal(svgText(svgOf(css)), 'Shared with \u2068Priya\u2069 \u00B7 6 Nov 2026');
  // Print keeps both the stamp and the line.
  const print = /@media print\{([\s\S]*?)\}\s*$/m.exec(css);
  assert.ok(print, '@media print block');
  assert.match(print[1], /\.rd-stamp\{[^}]*position:fixed/);
  assert.match(print[1], /\.rd-stamp\{[^}]*print-color-adjust:exact/);
  assert.match(print[1], /\.rd-kicker\.rd-named\{[^}]*display:block/);
  // "Just the text" hides the open kicker but never the named line.
  assert.match(css, /html\.rd-imm \.rd-kicker\.rd-named\{display:block\}/);
  // An unbroken 60-char name wraps instead of running off a phone screen.
  assert.match(css, /\.rd-kicker\.rd-named\{overflow-wrap:anywhere\}/);
  // The comment name: prefilled, read-only, still a named field the script sends.
  const input = /<input id="rdName"[^>]*>/.exec(html);
  assert.ok(input, 'name input');
  assert.ok(input[0].includes(' readonly'), 'readonly');
  assert.ok(input[0].includes('name="readerName"'), 'still the readerName field');
  assert.ok(input[0].includes('value="Priya"'), 'value = name');
  assert.ok(html.includes("readerName:String(fd.get('readerName')||'')"), 'the script still sends it');
  // The title stays the book's title.
  assert.match(html, /<title>The Lantern Coast — a reading copy<\/title>/);
});

test('escaping: hostile, RTL, emoji and 60-char names are inert and intact in the line, the SVG and the comment name', () => {
  const names = [
    '</style><script>alert(1)</script>',
    `"&'<>`,
    ') \\',
    'عائشة',
    '🦊 Fox',
    'x'.repeat(30) + 'Y'.repeat(30),
  ];
  assert.equal([...names[5]].length, 60);
  for (const name of names) {
    const html = named(name);
    // One script only, and it is the nonce'd one.
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    assert.deepEqual(scripts, [`<script nonce="${NONCE}">`], `one nonce'd script for ${name}`);
    // The style block isn't broken: one </style>, and it closes after the whole sheet.
    assert.equal(html.split('</style>').length, 2, `one </style> for ${name}`);
    const css = styleOf(html);
    assert.ok(css.trimEnd().endsWith('}'), 'the sheet ends on a rule');
    const raw = /url\("(data:[^"]*)"\)/.exec(css);
    assert.ok(raw, 'the url("data:…") is whole');
    assert.match(raw[1], /^data:image\/svg\+xml,[A-Za-z0-9%\-_.!~*'()]+$/, 'only URI-safe characters inside url("…")');
    // The SVG gives back the exact text (the name isolated).
    assert.equal(svgText(svgOf(css)), `Shared with \u2068${name}\u2069 \u00B7 6 Nov 2026`, `svg text for ${name}`);
    // And stampDataUri round-trips the plain stamp text exactly.
    const uri = stampDataUri(stampText(name, CREATED));
    assert.ok(uri.startsWith('data:image/svg+xml,'));
    assert.equal(svgText(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))), stampText(name, CREATED));
    // The line: escaped inside <bdi>, intact after unescaping.
    const k = /<p class="rd-kicker rd-named">Shared with <bdi>([\s\S]*?)<\/bdi> \u00B7 6 Nov 2026<\/p>/.exec(html);
    assert.ok(k, `kicker for ${name}`);
    assert.ok(!/[<>"']/.test(k[1]), 'escaped in the line');
    assert.equal(unxml(k[1]), name);
    // The comment name value: escaped, intact.
    const v = /<input id="rdName"[^>]*value="([^"]*)"/.exec(html);
    assert.ok(v, 'value attribute');
    assert.equal(unxml(v[1]), name);
  }
});

test('bidi: an RLO in a name cannot reorder "Shared with" or the date', () => {
  const name = 'Eve\u202Eevil\u2069\u202E';
  const html = named(name);
  // HTML: the name sits in <bdi>, which isolates it.
  assert.ok(html.includes(`Shared with <bdi>${name}</bdi> \u00B7 6 Nov 2026`));
  // SVG: the name's own bidi controls are dropped and the rest sits
  // between FSI and PDI, so nothing in it can escape the isolate.
  const t = svgText(svgOf(styleOf(html)));
  assert.equal(t, 'Shared with \u2068Eveevil\u2069 \u00B7 6 Nov 2026');
  assert.equal(t.replace(/[^\u2066-\u2069\u202A-\u202E]/g, ''), '\u2068\u2069', 'only our FSI…PDI remain');
  assert.match(t, /^Shared with /);
  assert.match(t, / \u00B7 6 Nov 2026$/);
  // Arabic: the isolate also stops "6" binding to the RTL run.
  assert.equal(svgText(svgOf(styleOf(named('عائشة')))).replace(BIDI, ''), 'Shared with عائشة \u00B7 6 Nov 2026');
});

test('a long name grows the stamp tile instead of clipping it', () => {
  const short = svgOf(styleOf(named('Al')));
  const long = svgOf(styleOf(named('W'.repeat(60))));
  const size = (svg: string) => {
    const m = /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(svg);
    assert.ok(m);
    return [Number(m[1]), Number(m[2])];
  };
  const [sw, sh] = size(short);
  const [lw, lh] = size(long);
  assert.ok(sw >= 360 && sh >= 200, 'at least 360×200');
  assert.ok(lw > sw && lh > sh, 'the long tile is bigger');
  // A short name stays one line; a long one goes to three lines
  // ("Shared with" / name / "· date") so it fits a 360px phone.
  assert.ok(!short.includes('<tspan'), 'short: one line');
  const real = svgOf(styleOf(named('Bartholomew Montgomery-Fitzwilliam Abernathy-Delacroix III')));
  assert.equal((real.match(/<tspan /g) ?? []).length, 3, 'long: three lines');
  const [rw] = size(real);
  assert.ok(rw <= 400, `a real 59-char name fits a phone-ish tile (${rw}px)`);
  const font = Number(/font-size="(\d+)"/.exec(real)?.[1]);
  assert.ok(font >= 10 && font <= 15, `font ${font}`);
});

test('nothing named leaks into the open page', () => {
  const html = renderReaderPage(base);
  for (const s of ['rd-stamp', 'rd-named', 'Shared with', 'readonly', 'data:image/svg']) {
    assert.ok(!html.includes(s), `open page has no ${s}`);
  }
});
