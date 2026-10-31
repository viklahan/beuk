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

   save()/restore() bring the font back natively; the shim re-applies the
   variation for the restored font after each restore(). */

export type FontPlan = {
  /** family as the studio names it → this build's registered faces for it, in the order they stand in for it. */
  map: Record<string, string[]>;
};

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
 *  it. Idempotent: the faces themselves have no entry, so they stay. */
export function expandFamilies(families: string[], plan: FontPlan): string[] {
  const out: string[] = [];
  for (const f of families) {
    const faces = Object.prototype.hasOwnProperty.call(plan.map, familyName(f)) ? plan.map[familyName(f)]! : null;
    if (faces && faces.length) for (const a of faces) out.push(`"${a}"`);
    else out.push(f);
  }
  return out;
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

const SHIMMED = Symbol('beuk-font-shim');

function accessor(obj: object, prop: string): PropertyDescriptor {
  for (let o: object | null = obj; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, prop);
    if (d) return d;
  }
  throw new Error(`the canvas context has no ${prop}`);
}

type Ctx2D = { font: string; fontVariationSettings: string; restore(): void };

/** Put the font shim on a 2D context (once). */
export function shimContext<T extends object>(ctx: T, plan: FontPlan): T {
  const c = ctx as T & Ctx2D & { [SHIMMED]?: true };
  if (c[SHIMMED]) return ctx;
  const font = accessor(c, 'font');
  const restore = accessor(c, 'restore').value as () => void;
  const cache = new Map<string, string>();
  const apply = (value: string, expand: boolean) => {
    const p = parseCssFont(value);
    if (!p) { font.set!.call(c, value); return; }
    const families = expand ? expandFamilies(p.families, plan) : p.families;
    font.set!.call(c, [...p.lead, p.size, families.join(', ')].join(' '));
    c.fontVariationSettings = variationFor({ ...p, families }, cache);
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
      const p = parseCssFont(font.get!.call(c) as string);
      c.fontVariationSettings = p ? variationFor(p, cache) : 'normal';
    },
  });
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
