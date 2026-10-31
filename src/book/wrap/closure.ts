import { GlobalFonts } from '@napi-rs/canvas';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { BookV1 } from '../schema.js';
import { MAX_WRAP_PIXELS } from './limits.js';
import { type BuildFailure, type ClosureSource, extractStudioSource, runStudioWorker, siblingWorkerUrl } from '../studio/closure.js';
import type { FontFile, FontsGiven, FontsWanted, GivenFace, WrapRefusal, WrapWorkerJob, WrapWorkerOut } from './worker.js';

/* BEUK:wrap-server — the cover wrap (paperback wrap, case laminate, dust
   jacket) is painted on the server by the studio's OWN painter:
   drawWrapTo and everything it reaches, lifted out of client/index.html
   (src/book/studio/closure.ts) and run in a vm context
   (src/book/wrap/sandbox.ts) inside a worker, against an @napi-rs/canvas
   canvas. 1.0's wrap is not vector: downloadWrap paints a 300-DPI canvas
   and the PDF is that one JPEG on a page of exactly the wrap's size. The
   server does the same, with pdf-lib building the page.

   WRAP_CLOSURE names every top-level declaration reached from WRAP_ROOTS.
   Loading throws with the missing names, so a studio rename fails loudly;
   tests/book-wrap-closure.test.ts holds the list equal to what the code
   reaches, so a new dependency fails a test, not a writer's download.

   NOT lifted, supplied by the sandbox instead (WRAP_SUPPLIED): `state`
   (built from the writer's book), `document` (canvases only), `Image`
   (pictures are decoded before the build) and `window` (Lucide only). */

/* renderWrapCanvas is the studio's 300-DPI render; wrapDims sizes the
   page; the three normalizers are what applyBookDoc runs on an arriving
   book's cover recipe, fonts and sections (WRAP_ARRIVE below):
   printPageEstimate, which sizes the spine when the recipe leaves the
   page count to the book, reads the sections' `included` and `kind`,
   which normalizeSection fills. slug names the file the way downloadWrap
   does (POST /api/wrap's Content-Disposition). wrapPictureIds names the
   pictures the wrap paints, for the server and for downloadWrap (which
   sends only those). */
export const WRAP_ROOTS: readonly string[] = ['renderWrapCanvas', 'wrapDims', 'normalizeCoverRecipe', 'normalizeCustomFont', 'normalizeSection', 'slug', 'wrapPictureIds'];
export const WRAP_SUPPLIED: readonly string[] = ['state', 'document', 'Image', 'window'];

export const WRAP_CLOSURE: readonly string[] = [
  'AUTO_TYPES', 'BACKDROP_STRENGTHS', 'BODY_FONTS', 'CM_ELEMENTS', 'COVER_ART_SCRIM', 'COVER_BG_TYPES',
  'COVER_FONTS', 'COVER_FREE_POS', 'COVER_LAYOUTS', 'COVER_TEXTURES', 'DISPLAY_FONTS', 'FONT_MEDIA',
  'HC_BINDINGS', 'HC_GUIDE_STYLE', 'HC_SPEC', 'HEAD_FONTS', 'IMAGE_LINE_RE', 'LANG_PACKS', 'OL_FIELDS_MAX',
  'OL_STATUSES', 'OL_THREADS_MAX', 'OL_THREAD_ID', 'PRINT_PICTURE_BOOK_PT', 'SANS_FONTS', 'SANS_STACK',
  'SCRIPT_STACK', 'SERIF_STACK', 'SPINE_CLEAR_IN', 'SPINE_ICON_GAP_IN', 'SPINE_ICON_INSET_IN',
  'SPINE_ICON_MIN_IN', 'SPINE_IMPRINT_FLOOR_IN', 'SPINE_MARGIN_IN', 'SPINE_TEXT_ROOM_IN', 'SPINE_TTB_LANGS',
  'TEXT_HEAD_FONTS', 'TRIM_SIZES', 'UI_PLURAL_FORMS', 'UI_STRINGS', 'WRAP_BG_DIRS', 'WRAP_BG_MODES',
  'WRAP_BLEED', 'WRAP_HEX', 'WRAP_PANEL_COLOR', 'WRAP_PANEL_COLOR2', 'WRAP_PAPERS', 'WRAP_PATTERNS',
  'WRAP_SPINE_DIRS', 'WRAP_SPINE_MIN', 'WRAP_SPINE_SHOW', 'countWords', 'countWordsFresh', 'countWordsRaw',
  'countWordsShort', 'coverBgSource', 'coverImgCache', 'coverLines', 'defaultCoverRecipe', 'displayFontOf',
  'drawCoverTo', 'drawImageCover', 'drawLucideIcon', 'drawUploadedIcon', 'drawWrapTo', 'fontStack',
  'frontispieceCaption', 'hcAboutAuthorText', 'hcDrawFlaps', 'hcDrawGuides', 'hcFlapBackText',
  'hcFlapFrontText', 'hcLayout', 'hcTrimOffered', 'hexToRgb', 'imIsPlaceholderTitle', 'imMetaValue',
  'imRealTitle', 'imageTokensIn', 'langPack', 'lucideKey', 'mdLinkRe', 'normalizeCoverRecipe',
  'normalizeCustomFont', 'normalizeScenes', 'normalizeSection', 'normalizeWrap', 'normalizeWrapBack',
  'normalizeWrapBg', 'normalizeWrapColor', 'normalizeWrapFont', 'normalizeWrapIcon', 'normalizeWrapSpine',
  'olCleanTag', 'olSectionFields', 'olTagKey', 'paintCoverBackground', 'paintCoverScene',
  'paintCoverTexture', 'paintPanelBackground', 'parseImageLine', 'printBaseFontPt', 'printMargins',
  'printMarginsAuto', 'printPageEstimate', 'printPictureBookOn', 'printTextArea', 'renderCoverCanvas',
  'renderWrapCanvas', 'sectionProseWords', 'sectionWords', 'sectionWordsMemo', 'slug', 'spineDirection', 't',
  'tCountForm', 'trimSize', 'uiLangState', 'uiPluralCategory', 'uiPluralRulesCache', 'uid',
  'uploadedFontByFamily', 'uploadedFonts', 'wrapDefaults', 'wrapDims', 'wrapFactor', 'wrapLines', 'wrapPictureIds',
];

/** The book's arrival: the lines of the studio's applyBookDoc
 *  (client/index.html) that touch the keys the wrap reads, in its order,
 *  calling the studio's own normalizers. */
const WRAP_ARRIVE = `(s) => {
  s.sections = (Array.isArray(s.sections) ? s.sections : []).map(normalizeSection);
  s.fonts = Array.isArray(s.fonts) ? s.fonts.map(normalizeCustomFont).filter(Boolean) : [];
  s.coverRecipe = s.coverRecipe ? normalizeCoverRecipe(s.coverRecipe) : null;
  s.images = Array.isArray(s.images) ? s.images : [];
  s.printPictureBook = s.printPictureBook === true && !s.printLargePrint;
  return s;
}`;

/** What the worker calls. Glue only: every drawing decision stays in the
 *  studio's functions.
 *  - render: the studio's renderWrapCanvas (its canvas size, its options),
 *    keeping what its drawWrapTo call returns: drawWrapTo is wrapped for
 *    the one call and put back, so the layout read back is the one painted.
 *  - pictures: the studio's wrapPictureIds, the ids the painter will draw
 *    (what ensureCoverBgImage, hcEnsureFlapPhoto and ensureWrapIcons wait
 *    for): the background when the recipe paints a picture, the flap
 *    photo on a dust jacket, uploaded spine icons. downloadWrap sends
 *    only these pictures, by the same function.
 *  - fontStacks: the CSS stacks the painter sets type in (every ctx.font
 *    in the wrap is fontStack of a recipe element's, the spine's or the
 *    back's font).
 *  coverImgCache loses its prototype first, so no picture id can reach
 *  Object.prototype through it (ids are also held to PICTURE_ID_RE). */
const WRAP_API = `
;Object.setPrototypeOf(coverImgCache, null); /* picture ids are keys: never Object.prototype's */
globalThis.__beukWrap = {
  render: (recipe) => {
    const draw = drawWrapTo;
    let items = null;
    drawWrapTo = function (c, r, o) { items = draw(c, r, o); return items; };
    try { const canvas = renderWrapCanvas(recipe, {}); return { canvas, items }; } finally { drawWrapTo = draw; }
  },
  wrapDims,
  pictures: wrapPictureIds,
  fontStacks: (r) => {
    const w = normalizeWrap(r.wrap);
    return CM_ELEMENTS.map((k) => r.elements[k].font).concat([w.spine.font, w.back.font]).filter(Boolean).map(fontStack);
  },
  uploadedFontByFamily,
  /* downloadWrap's file name, without the extension: its own expression on the arrived book */
  fileName: (s, r) => {
    const bnd = r.wrap && r.wrap.binding;
    return slug((s.meta && s.meta.title) || "cover") + (bnd === "case" ? "-case-laminate-wrap" : bnd === "jacket" ? "-dust-jacket" : "-cover-wrap");
  },
  cache: coverImgCache,
  setUiLang: (l) => { uiLangState = UI_STRINGS[l] ? l : "en"; },
  arrive: ${WRAP_ARRIVE}
};
`;

/** Lift WRAP_CLOSURE (plus the string tables t() reads) out of the
 *  studio, in studio order. Throws naming every declaration that is missing. */
export function extractWrapSource(studioHtml: string, names: readonly string[] = WRAP_CLOSURE): ClosureSource {
  return extractStudioSource(studioHtml, names, { listRef: 'src/book/wrap/closure.ts WRAP_CLOSURE', api: WRAP_API, stringTables: true });
}

/** The studio's global `state`, as far as its wrap painter reads it, from
 *  a book readBook has opened (pictures already hydrated). */
export function wrapState(book: BookV1): Record<string, unknown> {
  return structuredClone(book) as unknown as Record<string, unknown>;
}

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

/** Which of a family's files Skia should meet first. @napi-rs/canvas
 *  picks the FIRST face registered under a family for a style and does
 *  not fall back to the family's other subsets per glyph (measured: Libre
 *  Baskerville registered in manifest order, latin-ext first, set
 *  "The Lantern Coast" 37% too wide). So: the whole-font TTF/OTF files
 *  first (every glyph, real static weights), then the woff2 subsets with
 *  plain Latin ahead of latin-ext and the rest, upright ahead of italic. */
function faceRank(file: string): number {
  const f = path.basename(file).toLowerCase();
  if (/\.(ttf|otf)$/.test(f)) return 0;
  const italic = f.includes('-italic-') ? 1 : 0;
  if (f.includes('-latin-normal-') || f.includes('-latin-italic-')) return 1 + italic;
  return 3 + italic;
}

/** The subset a woff2 file holds, from its name (alegreya-latin-ext-italic-400.woff2 → latin-ext); "" for a whole font. */
export function faceSubset(file: string): string {
  const m = /^[a-z0-9]+-(.+)-(?:normal|italic)-[0-9_]+\.woff2?$/.exec(path.basename(file).toLowerCase());
  return m ? m[1]! : '';
}

/** The font stylesheets the studio links (client/index.html <link rel="stylesheet" href="assets/fonts/…">);
 *  tests/book-wrap-parity.test.ts holds this list to the studio's links. */
export const STUDIO_FONT_CSS: readonly string[] = ['fonts.css', 'fonts-scripts.css', 'fonts-display.css'];

/** A face's @font-face descriptors: its style and the weights it is declared at. */
export type FaceDescriptor = { italic: boolean; weights: number[] };

/** What Chrome knows about each face file from the studio's stylesheets:
 *  file (relative to client/assets/fonts) → style and declared weights.
 *  These are what Chrome matches a ctx.font against (CSS Fonts 4 §5.2),
 *  and they are not always what the file can do: EB Garamond's latin file
 *  holds 400–800 but is declared at 400, 500 and 600, so Chrome sets
 *  "700 … 'EB Garamond'" in the 600 face at wght 600 (measured,
 *  tools/book-corpus/wrap-parity.mjs). */
export function fontDescriptors(clientDir: string, cssFiles: readonly string[] = STUDIO_FONT_CSS): Map<string, FaceDescriptor> {
  const dir = path.resolve(clientDir, 'assets', 'fonts');
  const out = new Map<string, FaceDescriptor>();
  for (const css of cssFiles) {
    for (const block of readFileSync(path.join(dir, css), 'utf8').split('@font-face').slice(1)) {
      const url = /src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(block)?.[1];
      const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
      const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400);
      if (!url) continue;
      const file = path.posix.normalize(url);
      const d = out.get(file) ?? { italic: style === 'italic' || style === 'oblique', weights: [] };
      if (!d.weights.includes(weight)) d.weights.push(weight);
      d.weights.sort((a, b) => a - b);
      out.set(file, d);
    }
  }
  return out;
}

/** A face file's descriptors when no stylesheet declares it (the whole TTFs the EPUB embeds): from its name
 *  (Amiri-normal-700.ttf → normal, [700]), else normal 400. */
export function descriptorFromName(file: string): FaceDescriptor {
  const m = /-(normal|italic)-([0-9_]+)\.(?:ttf|otf|woff2?)$/i.exec(path.basename(file));
  return m ? { italic: m[1]!.toLowerCase() === 'italic', weights: m[2]!.split('_').map(Number) } : { italic: false, weights: [400] };
}

/** Every face file in client/assets/fonts/MANIFEST.tsv (not the licence
 *  texts): family, absolute file, and the name it registers under. Each
 *  family's files come in faceRank order. The primary faces (whole fonts
 *  and the plain Latin subset) register under the family itself; every
 *  other subset under "<family> beuk-<subset>", which the sandbox's font
 *  shim writes right after the family in each stack (src/book/wrap/sandbox.ts),
 *  standing in for Chrome's unicode-range. Each file carries the style and
 *  weights the studio's stylesheets declare it at (fontDescriptors), which
 *  the shim matches a ctx.font against the way Chrome does. */
export function manifestFonts(clientDir: string): FontFile[] {
  const dir = path.resolve(clientDir, 'assets', 'fonts');
  const declared = fontDescriptors(clientDir);
  const rows = readFileSync(path.join(dir, 'MANIFEST.tsv'), 'utf8').split(/\r?\n/).slice(1);
  const byFamily = new Map<string, string[]>();
  for (const row of rows) {
    const [family, file] = row.split('\t');
    if (!family || !file || !FONT_FILE.test(file)) continue;
    const full = path.resolve(dir, file);
    if (!full.startsWith(dir + path.sep)) throw new Error(`MANIFEST.tsv names a file outside the fonts directory: ${file}`);
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(full);
  }
  const out: FontFile[] = [];
  for (const [family, files] of byFamily) {
    /* Array.prototype.sort is stable: equal ranks keep manifest order */
    const sorted = [...files].sort((x, y) => faceRank(x) - faceRank(y));
    const isPrimary = (f: string) => faceSubset(f) === '' || faceSubset(f) === 'latin';
    /* a family with neither a whole font nor a Latin subset leads with its first subset */
    const lead = sorted.some(isPrimary) ? null : faceSubset(sorted[0]!);
    for (const file of sorted) {
      const sub = faceSubset(file);
      const rel = path.relative(dir, file).split(path.sep).join('/');
      const d = declared.get(rel) ?? descriptorFromName(file);
      out.push({ family, file, alias: isPrimary(file) || sub === lead ? family : `${family} beuk-${sub}`, italic: d.italic, weights: d.weights });
    }
  }
  return out;
}

export type WrapKind = 'pdf' | 'jpg';
/** A glyph-width probe: measureText of `text` in `font` (a CSS shorthand), on a canvas made inside the sandbox, so the font shim applies. */
export type WrapProbe = { font: string; text: string };
/** What a render reports as it goes (tests): the faces it registered, when its worker thread exited, the faces it removed. */
export type WrapTrace =
  | { kind: 'registered'; faces: string[] }
  | { kind: 'exited'; at: number }
  | { kind: 'removed'; faces: string[] };
export type WrapOptions = {
  lang: string; timeoutMs?: number; heapMb?: number;
  /** measured with this build's faces registered (tests/book-wrap-parity.test.ts holds them to Chrome's); only families the recipe sets type in are registered */
  probes?: WrapProbe[];
  /** tests only: told what the render does (WrapTrace) */
  trace?: (t: WrapTrace) => void;
  /** tests only: the worker spins once its faces are registered, so the time cap stops it there */
  holdAfterFonts?: boolean;
};
export type WrapItems = Record<string, unknown> & { barcode?: { x: number; y: number; w: number; h: number } | null; spineDir?: string };
export type WrapDims = Record<string, unknown> & { totalW: number; totalH: number };
export type WrapResult = {
  bytes: Buffer; items: WrapItems; dims: WrapDims;
  /** families set in the studio's faces; families the book's uploads stood in for; subset faces; this build's font nonce */
  fonts: string[]; uploaded: string[]; aliases: string[]; buildId: string;
  /** the studio's download name for this wrap, without the extension (slug(title || "cover") + "-cover-wrap" | "-case-laminate-wrap" | "-dust-jacket") */
  name: string;
  /** measureText widths of opts.probes, in order */
  probes: number[];
  /** when the render left the line and when it finished (performance.now(), ms) */
  timing: { started: number; finished: number };
};
export type WrapSandbox = {
  source: ClosureSource;
  /** The wrap as the studio downloads it: the 300-DPI JPEG, or that JPEG on a PDF page of exactly the wrap's size. */
  render(state: Record<string, unknown>, kind: WrapKind, opts: WrapOptions): Promise<WrapResult>;
};

/** A render that did not finish: timed out, ran out of heap, or threw. */
export class WrapBuildError extends Error {
  constructor(message: string, readonly reason: BuildFailure) {
    super(message);
  }
}

/** A book the wrap cannot be painted from as it stands: no cover recipe,
 *  a wrap too big to paint, pictures the recipe paints that the book does
 *  not hold, that are too big to decode or whose ids are not plain ids.
 *  `missing` names the pictures (for every picture reason). */
export class WrapInputError extends Error {
  constructor(readonly reason: WrapRefusal, readonly missing: string[] = []) {
    super(reason === 'no-cover' ? 'this book has no made cover to build a wrap from'
      : reason === 'too-large' ? `this cover wrap is larger than the server paints (over ${MAX_WRAP_PIXELS.toLocaleString('en')} pixels at 300 DPI)`
      : reason === 'picture-too-large' ? `pictures too large for the cover wrap: ${missing.join(', ')}`
      : reason === 'picture-unsupported' ? `pictures the cover wrap cannot paint (not a JPEG, PNG, WebP, GIF or a plain SVG): ${missing.join(', ')}`
      : reason === 'bad-picture-id' ? `the cover wrap names pictures by ids it cannot use: ${missing.join(', ')}`
      : `the cover wrap uses pictures this book no longer has: ${missing.join(', ')}`);
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
/** Heap cap of one render's worker, MB. The 300-DPI canvas itself lives in Skia's native memory, outside this cap. */
export const DEFAULT_WRAP_WORKER_HEAP_MB = 512;

/** The studio's wrap download as a PDF: the JPEG on one page of exactly
 *  totalW × totalH inches (buildWrapPdfDoc: jsPDF, unit "in", the image
 *  at 0,0 filling the page). */
export async function wrapPdf(jpeg: Uint8Array, dims: { totalW: number; totalH: number }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  const w = dims.totalW * 72, h = dims.totalH * 72;
  doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  return Buffer.from(await doc.save());
}

const cache = new Map<string, WrapSandbox>();

/* One render at a time in this process, whoever calls: renders share the
   process-wide font registry and Skia's native memory, so the one-at-a-time
   rule lives here and does not depend on callers going through a queue.
   The line is free again when the render's worker THREAD has exited, not
   when its caller has an answer: a worker stopped at the time cap may
   still be in native code for a while, and the next render must not
   start beside it. A thread that never exits holds the line for at most
   WRAP_EXIT_CEILING_MS after it was told to stop, so a wedged thread
   cannot freeze wraps for good. */
export const WRAP_EXIT_CEILING_MS = 30_000;
let line: Promise<unknown> = Promise.resolve();
function inLine<T>(fn: (holdUntil: (p: Promise<void>) => void) => Promise<T>): Promise<T> {
  let held: Promise<void> = Promise.resolve();
  const run = line.then(() => fn((p) => { held = p; }));
  line = run.then(() => held, () => held).catch(() => undefined);
  return run;
}

/** The faces one build sets type in, registered in THIS (the parent's)
 *  process-wide GlobalFonts under names carrying the build's nonce: the
 *  book's uploaded faces of the recipe's families first (the writer chose
 *  them), then the studio's faces of those families. The worker asked for
 *  them; what it sent is held to plain strings. */
function registerFaces(m: FontsWanted, manifest: FontFile[], keys: NonNullable<ReturnType<typeof GlobalFonts.register>>[]): FontsGiven {
  const want = m && typeof m === 'object' && m.fontsWanted && typeof m.fontsWanted === 'object' ? m.fontsWanted : null;
  if (!want || !Array.isArray(want.families) || !Array.isArray(want.uploads)) throw new Error('the worker asked for faces in a shape the server does not know');
  const families = new Set(want.families.map(String));
  const buildId = randomBytes(8).toString('hex');
  const faces: GivenFace[] = [], fonts: string[] = [], uploaded: string[] = [], aliases: string[] = [];
  for (const up of want.uploads) {
    const family = String(up && up.family), face = `${family} beuk-up-${buildId}`;
    const k = GlobalFonts.register(Buffer.from(String(up.data), 'base64'), face);
    if (!k) continue;
    keys.push(k);
    faces.push({ family, face, italic: false, weights: [400] }); /* registerUploadedFont: new FontFace(family, url), descriptors left at normal 400 */
    if (!uploaded.includes(family)) uploaded.push(family);
  }
  for (const f of manifest) {
    if (!families.has(f.family)) continue;
    const face = `${f.alias} beuk-${buildId}`;
    const k = GlobalFonts.registerFromPath(f.file, face);
    if (!k) continue;
    keys.push(k);
    faces.push({ family: f.family, face, italic: f.italic, weights: f.weights });
    if (f.alias === f.family) { if (!fonts.includes(f.family)) fonts.push(f.family); }
    else if (!aliases.includes(f.alias)) aliases.push(f.alias);
  }
  return { faces, fonts, uploaded, aliases, buildId };
}

/** The studio's wrap painter, lifted from `studioHtml` once (cached by
 *  the file's sha256) and run per render in a fresh worker and vm context,
 *  one render at a time. */
export function loadWrapClosure(studioHtml: string, clientDir: string): WrapSandbox {
  const key = createHash('sha256').update(studioHtml).update('\0' + clientDir).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const source = extractWrapSource(studioHtml);
  const lucide = readFileSync(path.join(clientDir, 'assets', 'vendor', 'lucide.min.js'), 'utf8');
  const fonts = manifestFonts(clientDir);
  const sb: WrapSandbox = {
    source,
    render: (state, kind, opts) => {
      const stateJson = JSON.stringify(state);
      return inLine(async (holdUntil) => {
        const started = performance.now();
        const job: WrapWorkerJob = { code: source.code, lucide, stateJson, lang: opts.lang, probes: opts.probes ?? [], holdAfterFonts: opts.holdAfterFonts === true };
        const keys: NonNullable<ReturnType<typeof GlobalFonts.register>>[] = [];
        const names: string[] = [];
        let gone: Promise<void> = Promise.resolve();
        const out = (await runStudioWorker(siblingWorkerUrl(import.meta.url), job, {
          timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          heapMb: opts.heapMb ?? DEFAULT_WRAP_WORKER_HEAP_MB,
          noun: 'cover wrap',
          error: (message, reason) => new WrapBuildError(message, reason),
          onRequest: (m) => {
            const given = registerFaces(m as FontsWanted, fonts, keys);
            names.push(...given.faces.map((f) => f.face));
            opts.trace?.({ kind: 'registered', faces: [...names] });
            return given;
          },
          onLife: ({ exited, stopped }) => {
            /* the faces go once the thread is gone (never while it may still paint with them), whatever ended it */
            const cleaned = exited.then(() => {
              opts.trace?.({ kind: 'exited', at: performance.now() });
              if (keys.length) GlobalFonts.removeBatch(keys);
              opts.trace?.({ kind: 'removed', faces: names });
            });
            const ceiling = stopped.then(() => new Promise<void>((r) => { setTimeout(r, WRAP_EXIT_CEILING_MS).unref(); }));
            gone = Promise.race([cleaned, ceiling]);
            holdUntil(gone);
          },
        })) as WrapWorkerOut;
        /* an answer is handed over once the thread is gone and its faces with it (a failure is told at once, above) */
        await gone;
        if ('refused' in out) throw new WrapInputError(out.refused, out.ids);
        const jpeg = Buffer.from(out.jpeg.buffer, out.jpeg.byteOffset, out.jpeg.byteLength);
        const dims = out.dims as WrapDims;
        const bytes = kind === 'pdf' ? await wrapPdf(jpeg, dims) : jpeg;
        return {
          bytes, items: out.items as WrapItems, dims,
          fonts: out.fonts, uploaded: out.uploaded, aliases: out.aliases, buildId: out.buildId, name: out.name, probes: out.probes,
          timing: { started, finished: performance.now() },
        };
      });
    },
  };
  cache.set(key, sb);
  return sb;
}
