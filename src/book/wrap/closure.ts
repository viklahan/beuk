import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { BookV1 } from '../schema.js';
import { type BuildFailure, type ClosureSource, extractStudioSource, runStudioWorker, siblingWorkerUrl } from '../studio/closure.js';
import type { FontFile, WrapWorkerJob, WrapWorkerOut } from './worker.js';

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
   which normalizeSection fills. */
export const WRAP_ROOTS: readonly string[] = ['renderWrapCanvas', 'wrapDims', 'normalizeCoverRecipe', 'normalizeCustomFont', 'normalizeSection'];
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
  'renderWrapCanvas', 'sectionProseWords', 'sectionWords', 'sectionWordsMemo', 'spineDirection', 't',
  'tCountForm', 'trimSize', 'uiLangState', 'uiPluralCategory', 'uiPluralRulesCache', 'uid',
  'uploadedFontByFamily', 'uploadedFonts', 'wrapDefaults', 'wrapDims', 'wrapFactor', 'wrapLines',
];

/** The book's arrival: the lines of the studio's applyBookDoc
 *  (client/index.html) that touch the keys the wrap reads, in its order,
 *  calling the studio's own normalizers. */
const WRAP_ARRIVE = `(s) => {
  s.sections = (Array.isArray(s.sections) ? s.sections : []).map(normalizeSection);
  s.coverRecipe = s.coverRecipe ? normalizeCoverRecipe(s.coverRecipe) : null;
  s.images = Array.isArray(s.images) ? s.images : [];
  s.fonts = Array.isArray(s.fonts) ? s.fonts.map(normalizeCustomFont).filter(Boolean) : [];
  s.printPictureBook = s.printPictureBook === true && !s.printLargePrint;
  return s;
}`;

/** What the worker calls. Glue only: every drawing decision stays in the
 *  studio's functions.
 *  - render: the studio's renderWrapCanvas (its canvas size, its options),
 *    keeping what its drawWrapTo call returns: drawWrapTo is wrapped for
 *    the one call and put back, so the layout read back is the one painted.
 *  - pictures: the ids downloadWrap waits for (ensureCoverBgImage,
 *    hcEnsureFlapPhoto, ensureWrapIcons) that the painter will draw: the
 *    background when the recipe paints a picture, the flap photo on a
 *    dust jacket, uploaded spine icons.
 *  - fontStacks: the CSS stacks the painter sets type in (every ctx.font
 *    in the wrap is fontStack of a recipe element's, the spine's or the
 *    back's font). */
const WRAP_API = `
;globalThis.__beukWrap = {
  render: (recipe) => {
    const draw = drawWrapTo;
    let items = null;
    drawWrapTo = function (c, r, o) { items = draw(c, r, o); return items; };
    try { const canvas = renderWrapCanvas(recipe, {}); return { canvas, items }; } finally { drawWrapTo = draw; }
  },
  wrapDims,
  pictures: (r) => {
    const w = normalizeWrap(r.wrap), out = [];
    if (r.bgImageId && (r.bgType === "image" || r.bgType === "photo" || r.bgType === "duotone")) out.push(r.bgImageId);
    if (w.binding === "jacket" && w.flapPhotoId) out.push(w.flapPhotoId);
    [w.spine.iconTop, w.spine.iconBottom].forEach((i) => { if (i.kind === "upload" && i.picId) out.push(i.picId); });
    return out.filter((x, i) => out.indexOf(x) === i);
  },
  fontStacks: (r) => {
    const w = normalizeWrap(r.wrap);
    return CM_ELEMENTS.map((k) => r.elements[k].font).concat([w.spine.font, w.back.font]).filter(Boolean).map(fontStack);
  },
  uploadedFontByFamily,
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

/** Every face file in client/assets/fonts/MANIFEST.tsv (not the licence
 *  texts): family and absolute file, each family's files in faceRank order. */
export function manifestFonts(clientDir: string): FontFile[] {
  const dir = path.resolve(clientDir, 'assets', 'fonts');
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
    for (const file of [...files].sort((x, y) => faceRank(x) - faceRank(y))) out.push({ family, file });
  }
  return out;
}

export type WrapKind = 'pdf' | 'jpg';
export type WrapOptions = { lang: string; timeoutMs?: number; heapMb?: number };
export type WrapItems = Record<string, unknown> & { barcode?: { x: number; y: number; w: number; h: number } | null; spineDir?: string };
export type WrapDims = Record<string, unknown> & { totalW: number; totalH: number };
export type WrapResult = { bytes: Buffer; items: WrapItems; dims: WrapDims; fonts: string[] };
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
 *  or pictures the recipe paints that the book does not hold. */
export class WrapInputError extends Error {
  constructor(readonly reason: 'no-cover' | 'missing-pictures', readonly missing: string[] = []) {
    super(reason === 'no-cover' ? 'this book has no made cover to build a wrap from'
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

/** The studio's wrap painter, lifted from `studioHtml` once (cached by
 *  the file's sha256) and run per render in a fresh worker and vm context. */
export function loadWrapClosure(studioHtml: string, clientDir: string): WrapSandbox {
  const key = createHash('sha256').update(studioHtml).update('\0' + clientDir).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const source = extractWrapSource(studioHtml);
  const lucide = readFileSync(path.join(clientDir, 'assets', 'vendor', 'lucide.min.js'), 'utf8');
  const fonts = manifestFonts(clientDir);
  const sb: WrapSandbox = {
    source,
    render: async (state, kind, opts) => {
      const job: WrapWorkerJob = { code: source.code, lucide, fonts, stateJson: JSON.stringify(state), lang: opts.lang };
      const out = (await runStudioWorker(siblingWorkerUrl(import.meta.url), job, {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        heapMb: opts.heapMb ?? DEFAULT_WRAP_WORKER_HEAP_MB,
        noun: 'cover wrap',
        error: (message, reason) => new WrapBuildError(message, reason),
      })) as WrapWorkerOut;
      if ('refused' in out) throw new WrapInputError(out.refused, out.refused === 'missing-pictures' ? out.missing : []);
      const jpeg = Buffer.from(out.jpeg.buffer, out.jpeg.byteOffset, out.jpeg.byteLength);
      const dims = out.dims as WrapDims;
      const bytes = kind === 'pdf' ? await wrapPdf(jpeg, dims) : jpeg;
      return { bytes, items: out.items as WrapItems, dims, fonts: out.fonts };
    },
  };
  cache.set(key, sb);
  return sb;
}
