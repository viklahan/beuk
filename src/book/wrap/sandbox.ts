import { GlobalFonts, Path2D, createCanvas } from '@napi-rs/canvas';
import vm from 'node:vm';

/* BEUK:wrap-server — the context the studio's cover-wrap painter runs in.
   drawWrapTo and what it reaches touch four browser things; each gets a
   narrow stand-in here:

   - document is { createElement }: "canvas" gives an @napi-rs/canvas
     canvas (Skia, the same engine Chrome paints its canvas with); any
     other tag throws. Nothing the wrap reaches asks the page for an
     element (no getElementById, no querySelector), so there is none.
     The canvas's 2D context wears the font shim below.
   - Image throws. Pictures are decoded by the worker before the build
     (loadImage on the stored bytes) and put into the studio's own
     coverImgCache, which is where drawWrapTo looks for them.
   - Path2D (drawLucideIcon strokes an icon's path data) is Skia's.
   - window holds lucide and nothing else: the vendored
     client/assets/vendor/lucide.min.js, evaluated in the context by the
     worker (installLucide below).

   The context has no require, no process, no module, no fetch and no
   eval or new Function (codeGeneration off). vm is not a boundary
   against hostile CODE (Node's own docs say so); the code here is the
   studio's own source, and the writer's book reaches it only as data. */

/* ---- the font shim: what Chrome does with ctx.font that Skia does not ----

   Two gaps, both measured on @napi-rs/canvas 1.0.11:
   1. Weight on a variable face. The studio's cover faces are variable
      woff2 files (one file, wght 400–700). Chrome sets "700 …px 'Libre
      Baskerville'" at wght 700; Skia sets the file's default instance
      (400) unless fontVariationSettings asks. So when the studio assigns
      ctx.font, the shim reads the weight (and italic) out of the
      shorthand and, when the face that will set the text has a 'wght'
      (or 'ital'/'slnt') axis, sets ctx.fontVariationSettings to match.
      A static face gets "normal".
   2. unicode-range. Chrome picks a family's latin-ext (cyrillic, greek,
      vietnamese…) subset per glyph from the @font-face rules; Skia takes
      the first face registered under a family and falls back to the NEXT
      family in the list, never to the same family's other files. So the
      worker registers those subsets under names of their own and the
      shim writes them right after the family's main face in the stack.

   Every face a build registers carries the build's own nonce
   ("Lora beuk-3f9c…"): GlobalFonts is one registry for the whole process,
   and a worker stopped at the time or heap cap never reaches its
   clean-up, so its faces stay. With the nonce, a face left behind can
   never be matched by another build. The plan maps each family the
   studio names to this build's faces for it, in order: the writer's
   uploaded face of that name first (the writer chose it), then the
   studio's own face, then its subsets. A family with no entry (Georgia,
   serif) stays as written.

   Matched against Chrome's own numbers (tests/book-wrap-parity.test.ts,
   captured by tools/book-corpus/wrap-parity.mjs), three more:
   3. Which face. Chrome picks a family's face by its @font-face
      descriptors (matchDescriptor), not by what the file can do, and sets
      a variable face at that face's declared weight: "700 'EB Garamond'"
      is the 600 face at wght 600, "400 'Cinzel'" the 500 face. A writer's
      upload (declared normal 400) stands in only where it is the pick.
   4. Words. Chrome shapes canvas text a word at a time (chromeWords).
   5. Size. Chrome sets canvas text at the size floored to 1/100 px
      (chromeSize). And @napi-rs/canvas rounds measureText to 0.01 px, so
      widths are measured at 100 times the size.

   save()/restore() bring the font back natively; the shim re-applies the
   variation for the restored font after each restore(). */

/** One registered name and the @font-face descriptors (style, declared weight) of the files under it. */
export type PlanFace = { name: string; descs: { italic: boolean; weight: number }[] };
export type FontPlan = {
  /** family as the studio names it → this build's registered faces for it, in the order they stand in for it.
   *  A bare string is a face that stands in at every weight and style. */
  map: Record<string, (string | PlanFace)[]>;
};

/** The descriptor Chrome sets a request in (CSS Fonts 4 §5.2 font matching, as Blink does it): style first
 *  (italic asks for an italic face, else takes a normal one; normal the reverse), then weight among that
 *  style's faces: asked 400–500, the nearest at or above up to 500, then below going down, then above 500
 *  going up; asked under 400, at or below going down, then above going up; asked over 500, at or above going
 *  up, then below going down. Null when there is none. */
export function matchDescriptor(descs: { italic: boolean; weight: number }[], weight: number, italic: boolean): { italic: boolean; weight: number } | null {
  if (!descs.length) return null;
  const style = descs.some((d) => d.italic === italic) ? italic : !italic;
  const ws = [...new Set(descs.filter((d) => d.italic === style).map((d) => d.weight))].sort((a, b) => a - b);
  const up = (from: number, to = Infinity) => ws.find((w) => w >= from && w <= to);
  const down = (from: number) => [...ws].reverse().find((w) => w < from);
  let w: number | undefined;
  if (weight >= 400 && weight <= 500) w = up(weight, 500) ?? down(weight) ?? up(500.0001);
  else if (weight < 400) w = [...ws].reverse().find((x) => x <= weight) ?? up(weight);
  else w = up(weight) ?? down(weight);
  return w === undefined ? null : { italic: style, weight: w };
}

const AXIS = { wght: 0x77676874, ital: 0x6974616c, slnt: 0x736c6e74 } as const;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'math', 'emoji', 'fangsong']);
const SIZE_RE = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|%)(?:\/\S+)?$/i;
const SIZE_KEYWORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'larger', 'smaller']);

export type ParsedFont = { lead: string[]; size: string; families: string[]; weight: number; italic: boolean };

/** Split a family list on commas outside quotes, keeping each entry as written. */
function splitFamilies(s: string): string[] {
  const out: string[] = [];
  let cur = '', q = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export const familyName = (entry: string): string => entry.trim().replace(/^(['"])(.*)\1$/, '$2').trim();

/** The CSS font shorthand, as far as weight, italic, size and families go. Null when it is not one. */
export function parseCssFont(value: string): ParsedFont | null {
  const tokens = String(value).trim().split(/\s+/);
  const at = tokens.findIndex((t) => SIZE_RE.test(t) || SIZE_KEYWORDS.has(t.toLowerCase()));
  if (at < 0 || at === tokens.length - 1) return null;
  const lead = tokens.slice(0, at);
  let weight = 400, italic = false;
  for (const t of lead) {
    const l = t.toLowerCase();
    if (l === 'italic' || l === 'oblique') italic = true;
    else if (l === 'bold' || l === 'bolder') weight = 700;
    else if (l === 'lighter') weight = 100;
    else if (/^\d+(\.\d+)?$/.test(l) && Number(l) >= 1 && Number(l) <= 1000) weight = Number(l);
  }
  return { lead, size: tokens[at]!, families: splitFamilies(tokens.slice(at + 1).join(' ')), weight, italic };
}

/** The family list with each family replaced by this build's faces for
 *  it that Chrome would set the request in: the faces declared at the
 *  descriptor matchDescriptor picks for that family (the writer's upload,
 *  declared normal 400, only when that is the pick, as in Chrome, where
 *  the face added last wins among equals and a better-matching built-in
 *  face wins otherwise). `primary` is the first planned family's pick.
 *  Idempotent: the faces themselves have no entry, so they stay. */
export function expandFamilies(families: string[], plan: FontPlan, req: { weight: number; italic: boolean } = { weight: 400, italic: false }): { families: string[]; primary: { italic: boolean; weight: number } | null } {
  const out: string[] = [];
  let primary: { italic: boolean; weight: number } | null = null, planned = false;
  for (const f of families) {
    const faces = Object.prototype.hasOwnProperty.call(plan.map, familyName(f)) ? plan.map[familyName(f)]! : null;
    if (!faces || !faces.length) { out.push(f); continue; }
    const best = matchDescriptor(faces.flatMap((e) => (typeof e === 'string' ? [] : e.descs)), req.weight, req.italic);
    if (!planned) { primary = best; planned = true; }
    for (const e of faces) {
      if (typeof e === 'string') out.push(`"${e}"`);
      else if (!best || e.descs.some((d) => d.italic === best.italic && d.weight === best.weight)) out.push(`"${e.name}"`);
    }
  }
  return { families: out, primary };
}

/** fontVariationSettings for this font: the axes the setting face has, set the way Chrome sets them. */
export function variationFor(p: ParsedFont, cache: Map<string, string> = new Map()): string {
  const fam = p.families.map(familyName).find((n) => !GENERIC.has(n.toLowerCase()) && GlobalFonts.has(n));
  if (!fam) return 'normal';
  const key = `${fam}\0${p.weight}\0${p.italic ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const axes = GlobalFonts.getVariationAxes(fam, Math.round(p.weight), 5, p.italic ? 1 : 0);
  const parts: string[] = [];
  const axis = (tag: number) => axes.find((a) => a.tag === tag);
  const w = axis(AXIS.wght);
  if (w) parts.push(`'wght' ${Math.min(w.max, Math.max(w.min, p.weight))}`);
  if (p.italic) {
    const i = axis(AXIS.ital), s = axis(AXIS.slnt);
    if (i) parts.push(`'ital' ${Math.min(i.max, Math.max(i.min, 1))}`);
    else if (s) parts.push(`'slnt' ${Math.min(s.max, Math.max(s.min, -14))}`); /* Chrome's oblique angle */
  }
  const out = parts.length ? parts.join(', ') : 'normal';
  cache.set(key, out);
  return out;
}

/* ---- word by word, as Chrome shapes canvas text ----
   Chrome shapes a canvas string one word at a time (Blink's word shaper:
   each run between spaces, and each space, on its own), so a kerning pair
   that spans a space is never applied; Skia shapes the whole string.
   Measured on Libre Baskerville 700 at 51px: Chrome sets "APRIL CAROOKE"
   493.63 px wide (font-kerning auto), the sum of "APRIL", " " and
   "CAROOKE"; Skia, and Chrome told font-kerning normal, 492.15. So the
   shim measures and paints a string with spaces as the sum of its words
   and spaces. Right-to-left text is left whole (painting its words left to
   right would reverse them). */
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export function chromeWords(text: string): string[] | null {
  if (!text.includes(' ') || RTL.test(text)) return null;
  return text.split(/( )/).filter((x) => x !== '');
}

/* ---- the size Chrome sets canvas text at ----
   Chrome measures and paints canvas text at the font size floored to
   1/100 px: 45.003px, 45.008px and 45.0099px all set exactly as 45px,
   44.9999px as 44.99px, 3.009px as 3px (measured,
   tools/book-corpus/wrap-parity.mjs). The wrap's sizes are fractions of
   pixels per inch, which is not exactly 300 when the wrap's width in
   pixels was rounded (12.3225 in → 3697 px: 45.003px blurb type), so the
   shim floors the same way. */
export function chromeSize(size: string): string {
  const m = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)px$/i.exec(size);
  if (!m) return size;
  return `${Math.floor(Number(m[1]) * 100 + 1e-7) / 100}px`;
}

const SHIMMED = Symbol('beuk-font-shim');
const SCALE = 100;

function accessor(obj: object, prop: string): PropertyDescriptor {
  for (let o: object | null = obj; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, prop);
    if (d) return d;
  }
  throw new Error(`the canvas context has no ${prop}`);
}

type Metrics = { width: number };
type Ctx2D = {
  font: string; fontVariationSettings: string; textAlign: string; restore(): void;
  measureText(t: string): Metrics; fillText(t: string, x: number, y: number, w?: number): void; strokeText(t: string, x: number, y: number, w?: number): void;
};

/** Put the font shim on a 2D context (once). */
export function shimContext<T extends object>(ctx: T, plan: FontPlan): T {
  const c = ctx as T & Ctx2D & { [SHIMMED]?: true };
  if (c[SHIMMED]) return ctx;
  const font = accessor(c, 'font');
  const restore = accessor(c, 'restore').value as () => void;
  const cache = new Map<string, string>();
  /* the variation each native font string was set with, so restore() brings back the same one */
  const set = new Map<string, string>();
  const apply = (value: string, expand: boolean) => {
    const p = parseCssFont(value);
    if (!p) { font.set!.call(c, value); return; }
    const { families, primary } = expand ? expandFamilies(p.families, plan, p) : { families: p.families, primary: null };
    font.set!.call(c, [...p.lead, chromeSize(p.size), families.join(', ')].join(' '));
    /* the variable face is set at the weight of the face Chrome picked (its declared weight), not the one asked for */
    const v = variationFor({ ...p, families, ...(primary ? { weight: primary.weight, italic: primary.italic } : {}) }, cache);
    c.fontVariationSettings = v;
    set.set(font.get!.call(c) as string, v);
  };
  Object.defineProperty(c, 'font', {
    configurable: true,
    enumerable: true,
    get: () => font.get!.call(c) as string,
    set: (v: unknown) => apply(String(v), true),
  });
  Object.defineProperty(c, 'restore', {
    configurable: true,
    writable: true,
    value: () => {
      restore.call(c);
      const now = font.get!.call(c) as string;
      const known = set.get(now);
      if (known !== undefined) { c.fontVariationSettings = known; return; }
      const p = parseCssFont(now);
      c.fontVariationSettings = p ? variationFor(p, cache) : 'normal';
    },
  });
  const measure = accessor(c, 'measureText').value as (t: string) => Metrics;
  /* @napi-rs/canvas hands measureText's width back rounded to 0.01 px (Chrome keeps the float32 sum: 581.0797
     where Skia says 581.08). Advances are linear in the size (unhinted), so the width is measured at SCALE
     times the size and divided back: the rounding shrinks to 0.0001 px. */
  const width = (t: string) => {
    const native = font.get!.call(c) as string;
    const p = parseCssFont(native);
    const px = p ? /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)px$/i.exec(p.size) : null;
    if (!p || !px) return measure.call(c, t).width;
    const v = c.fontVariationSettings;
    font.set!.call(c, [...p.lead, `${Number(px[1]) * SCALE}px`, p.families.join(', ')].join(' '));
    c.fontVariationSettings = v;
    try {
      return measure.call(c, t).width / SCALE;
    } finally {
      font.set!.call(c, native);
      c.fontVariationSettings = v;
    }
  };
  Object.defineProperty(c, 'measureText', {
    configurable: true,
    writable: true,
    value: (text: unknown) => {
      const t = String(text);
      const m = measure.call(c, t);
      const words = chromeWords(t) ?? [t];
      /* the native metrics, with Chrome's width */
      const out: Record<string, unknown> = {};
      for (let o: object | null = m; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
        for (const k of Object.getOwnPropertyNames(o)) if (!(k in out) && k !== 'constructor') { const v = (m as unknown as Record<string, unknown>)[k]; if (typeof v === 'number') out[k] = v; }
      }
      out.width = words.reduce((a, w) => a + width(w), 0);
      return out;
    },
  });
  for (const name of ['fillText', 'strokeText'] as const) {
    const paint = accessor(c, name).value as (t: string, x: number, y: number, w?: number) => void;
    Object.defineProperty(c, name, {
      configurable: true,
      writable: true,
      value: (text: unknown, x: number, y: number, maxWidth?: number) => {
        const t = String(text);
        const words = maxWidth === undefined ? chromeWords(t) : null;
        if (!words) { if (maxWidth === undefined) paint.call(c, t, x, y); else paint.call(c, t, x, y, maxWidth); return; }
        const ws = words.map(width);
        const total = ws.reduce((a, w) => a + w, 0);
        const align = c.textAlign;
        let at = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
        c.textAlign = 'left';
        try {
          words.forEach((w, i) => { if (w !== ' ') paint.call(c, w, at, y); at += ws[i]!; });
        } finally { c.textAlign = align; }
      },
    });
  }
  Object.defineProperty(c, SHIMMED, { value: true });
  return ctx;
}

/** A fresh context with the shims and nothing else. `plan` is read when
 *  type is set, so the worker can fill it after registering the faces.
 *  document and Image are made inside the context (their prototypes are
 *  the context's own); the canvas maker they close over is not reachable
 *  from the studio code. */
export function makeWrapSandbox(plan: FontPlan = { map: {} }): vm.Context {
  const makeCanvas = (tag: string) => {
    if (tag.toLowerCase() !== 'canvas') throw new Error(`document.createElement: only a canvas can be made on the server (asked for ${tag})`);
    const canvas = createCanvas(1, 1);
    const getContext = canvas.getContext.bind(canvas);
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      writable: true,
      value: (type: '2d', attrs?: Parameters<typeof canvas.getContext>[1]) => shimContext(getContext(type, attrs), plan),
    });
    return canvas;
  };
  const ctx = vm.createContext({ Path2D, __beukMakeCanvas: makeCanvas }, { name: 'beuk-wrap', codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`(function (make) {
    globalThis.document = Object.freeze({ createElement: function (tag) { return make(String(tag)); } });
    globalThis.Image = class Image { constructor() { throw new Error("Image is not available on the server: the wrap build decodes pictures before it paints"); } };
  })(globalThis.__beukMakeCanvas); delete globalThis.__beukMakeCanvas;`, ctx);
  return ctx;
}

/** Evaluate the vendored Lucide bundle in the context and leave a
 *  `window` that holds it and nothing else. */
export function installLucide(ctx: vm.Context, lucideSource: string): void {
  new vm.Script(lucideSource, { filename: 'lucide.min.js' }).runInContext(ctx);
  vm.runInContext('var window = { lucide: globalThis.lucide }; delete globalThis.lucide;', ctx);
}
