import { fixtures } from './fixtures';

/* Wave 4a: a book wearing everything the Style tab writes, in 1.0's stored shapes (serializeBook): an uploaded font
   (a TrueType header, over PIC_MIN so the picture store keeps its bytes once), an SVG flourish and a PNG flourish in
   the image library, the theme set in the uploaded face with a header design, the flourish as scene-break ornament
   and heading flourish, two custom themes (one wearing the flourish), the book colour with a tint and print in black
   ink, activePreset on the first custom theme (the second, made before header designs, carries 1.0's "header": null,
   as serializeBook writes a theme without one: normalizeCustomTheme). No gallery fixture carries any of these, so the tests build it. */

type Rec = Record<string, unknown>;
const b64 = (bin: string) => btoa(bin);
/** A font file's bytes as 1.0 checks them (handleFontFile: 00 01 00 00 at the start of a .ttf), `n` bytes long. */
export function ttfData(n = 1600, seed = 7): string {
  let s = '\u0000\u0001\u0000\u0000';
  for (let i = 4; i < n; i++) s += String.fromCharCode((i * seed + 13) % 256);
  return b64(s);
}
export const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24"><path d="M60 3 L66 12 L60 21 L54 12 Z"/></svg>';
/** The smallest valid PNG (1 x 1, transparent). */
export const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function styledBook(): Rec {
  const base = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
  const header = {
    number: { font: 'Writer Hand', size: 0.8, align: 'center', casing: 'upper', above: 0, below: 0.9 },
    title: { font: 'Pinyon Script', size: 2.1, align: 'center', casing: 'asis', above: 0.2, below: 0.1 },
    subtitle: { font: 'EB Garamond', size: 1, align: 'center', casing: 'small', above: 0.55, below: 0 },
  };
  const theme = {
    bodyFont: 'EB Garamond', headFont: 'Writer Hand', fontSize: 17.5, lineHeight: 1.6, paraMode: 'indent', indentDepth: '2em',
    headerStyle: 'ornate_framed', dropDepth: 3, smallCapsWords: 4, ornament: 'fl:flsvg1', justify: true, hyphens: true,
    headingFlourish: 'flpng1', headingFlourishPos: 'below', header,
  };
  return {
    ...base,
    theme,
    activePreset: 'custom:ctHarbour',
    colour: { accent: '#1f62a8', tint: '#fbf5e6', printBlack: true },
    images: [
      ...((base.images as Rec[]) ?? []),
      { id: 'flsvg1', name: 'Harbour star.svg', mediaType: 'image/svg+xml', ext: 'svg', data: b64(SVG_TEXT), flourish: true },
      { id: 'flpng1', name: 'Dot.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX, flourish: true },
    ],
    fonts: [{ id: 'fntWriter', name: 'Writer-Hand.ttf', family: 'Writer Hand', ext: 'ttf', mediaType: 'font/ttf', data: ttfData() }],
    customThemes: [
      { id: 'ctHarbour', name: 'Harbour Lights', theme },
      { id: 'ctPlain', name: 'Plain Modern', theme: { bodyFont: 'Source Serif 4', headFont: 'Montserrat', fontSize: 16.5, lineHeight: 1.62, paraMode: 'block', indentDepth: '1.5em', headerStyle: 'modern_stacked', dropDepth: 2, smallCapsWords: 2, ornament: 'hairline', justify: false, hyphens: false, header: null } },
    ],
  };
}
