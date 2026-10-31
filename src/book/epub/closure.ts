import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerOptions } from 'node:worker_threads';
import {
  type ClosureSource, STUDIO_WORKER_ENV_KEYS, extractStudioSource, reachableFrom, runStudioWorker, siblingWorkerUrl, studioWorkerOptions,
} from '../studio/closure.js';
import type { WorkerJob } from './worker.js';

export { type ClosureSource, studioScript } from '../studio/closure.js';

/* BEUK:epub-server — the store-ready EPUB is built on the server by the
   studio's OWN code, lifted out of client/index.html at start-up and run
   in a node:vm context (src/book/epub/sandbox.ts). One source: no studio
   function is copied into src/. When the React studio (2.0 step 5) moves
   this code into a shared TypeScript package, this loader goes and the
   route stays.

   EPUB_CLOSURE names every top-level declaration the build reaches from
   EPUB_ROOTS. Loading throws with the missing names, so a studio rename
   fails loudly; tests/book-epub-closure.test.ts also checks that the list
   still covers everything the studio's code reaches, so a new dependency
   fails a test, not a writer's export.

   NOT lifted, supplied by the sandbox instead (EPUB_SUPPLIED): `state`
   (built from the writer's book), `toast` (records notes),
   `samplePicsRequire` (the demo book's pictures; never on the server) and
   `JSZip` (the vendored client/assets/vendor/jszip.min.js).

   The generic machinery (the extractor, the reachability walk, the
   capped worker) lives in src/book/studio/closure.ts, shared with the
   cover wrap (src/book/wrap/closure.ts); this file keeps the EPUB's
   lists, its arrival step and its public API. */

/* buildEpubBlob is the studio's EPUB download; platformFilename names it;
   the three normalizers are what applyBookDoc runs on an arriving book's
   sections, fonts and cover recipe (ARRIVE below). */
export const EPUB_ROOTS: readonly string[] = ['buildEpubBlob', 'platformFilename', 'normalizeSection', 'normalizeCustomFont', 'normalizeCoverRecipe'];
export const EPUB_SUPPLIED: readonly string[] = ['state', 'toast', 'samplePicsRequire', 'JSZip'];

export const EPUB_CLOSURE: readonly string[] = [
  '$', 'A11Y_CONFORMS_VALUE', 'APPLE_DISPLAY_OPTIONS', 'AUTO_TYPES', 'BACKDROP_STRENGTHS', 'BODY_FONTS',
  'BOOK_ACCENT_TARGETS', 'CC_LICENCES', 'CM_ELEMENTS', 'COLOUR_DARK_SURFACES', 'COLOUR_MIN_LARGE',
  'COLOUR_MIN_TEXT', 'COLOUR_PAGE', 'COLOUR_TEXT', 'CONTAINER_BREAK_RE', 'CONTAINER_CLOSE_RE',
  'CONTAINER_KINDS', 'CONTAINER_NOTEDEF_RE', 'CONTAINER_OPEN_RE', 'COVER_BG_TYPES', 'COVER_FONTS',
  'COVER_LAYOUTS', 'COVER_TEXTURES', 'CP_FICTION', 'CP_NO_PART', 'DISPLAY_FONTS', 'EPUB_DETECTED_PROPS',
  'EPUB_NS', 'EPUB_TYPES', 'FLOURISH_PREFIX', 'FONT_FORMAT', 'FONT_MEDIA', 'HC_BINDINGS', 'HD_KEYS',
  'HEAD_FONTS', 'IMAGE_LINE_RE', 'INSERT_CARD_LOOK', 'INSERT_LONG_ROWS', 'INSERT_ROW_CHARS', 'LANG_PACKS',
  'LIST_BULLET', 'LIST_NUMBER', 'LOG_RTL_CH', 'MARGIN_INKS', 'MARGIN_OPEN_RE', 'MN_GAP', 'MN_NOTE',
  'MN_NO_INDENT_AFTER_RE', 'OL_FIELDS_MAX', 'OL_STATUSES', 'OL_THREADS_MAX', 'OL_THREAD_ID', 'ORNAMENTS',
  'PIV_PX', 'PLATFORM_PRESETS', 'PRESETS', 'PRINT_BLEED_IN', 'PRINT_INK', 'PRINT_PAGE',
  'PRINT_PICTURE_BOOK_PT', 'QUOTE_ATTR_RE', 'QUOTE_DASH_LINE_RE', 'REDACT_RE', 'SANS_FONTS', 'SANS_STACK',
  'SCRIPT_FONTS', 'SCRIPT_MIN_CHARS', 'SCRIPT_STACK', 'SERIF_STACK', 'SW_MIN_ZOOM', 'TEXTS_LINE_RE',
  'TEXT_HEAD_FONTS', 'TRANSCRIPT_DIR_RE', 'TRANSCRIPT_LINE_RE', 'TRIM_SIZES', 'UI_PLURAL_FORMS', 'UI_STRINGS',
  'WRAP_BG_DIRS', 'WRAP_BG_MODES', 'WRAP_HEX', 'WRAP_PANEL_COLOR', 'WRAP_PANEL_COLOR2', 'WRAP_PATTERNS',
  'WRAP_SPINE_DIRS', 'WRAP_SPINE_SHOW', 'a11yFacts', 'a11yMetaBlock', 'a11yStampConformance',
  'a11ySummaryDefault', 'a11ySummaryText', 'altSaid', 'applyLeadIn', 'auditAccessibility', 'backdropImage',
  'backdropLayerHtml', 'beautifyText', 'bodyFaceOf', 'bookColour', 'bookColourNormalize', 'bookColourRules',
  'bookDirAttr', 'bookLang', 'bookScripts', 'bufToBase64', 'buildBookCss', 'buildEpubBlob',
  'chapterOpeningHtml', 'clampNum', 'colourContrast', 'colourForDark', 'colourHex', 'colourLum',
  'columnsHanging', 'containerIndent', 'containerKind', 'containerPassThrough', 'containerStanzas',
  'contentBlocksToHtml', 'copyrightPageParas', 'copyrightRightsParas', 'countWords', 'countWordsFresh',
  'countWordsRaw', 'countWordsShort', 'curlify', 'defaultCoverRecipe', 'defaultHeaderDesign',
  'displayFaceRules', 'displayFontData', 'displayFontOf', 'displayFontOfl', 'displayFontsFor',
  'docxRedactRun', 'docxRedactedPlainRuns', 'docxRun', 'emptyOut', 'ensureDisplayFonts', 'ensureScriptFonts',
  'epubApplyManifestProperties', 'epubAttr', 'epubCssHasRemote', 'epubDetectProps', 'epubFiles', 'epubFonts',
  'epubIsRemoteRef', 'epubManifestPropertyReport', 'epubOpfPathOf', 'epubPlan', 'epubTocTarget', 'esc',
  'escRedacted', 'flourishOf', 'flourishSrc', 'fontFaceCss', 'fontFileName', 'fontStack', 'frontBackHtml',
  'frontispieceCaption', 'frontispiecePlateHtml', 'halfTitleLine1', 'halfTitleLine2', 'hangingDocx',
  'hangingHtml', 'hangingParts', 'headerDesignRules', 'headingFlourishHtml', 'heartPath',
  'holdContainerIndents', 'holdRawContainers', 'imIsPlaceholderTitle', 'imMetaValue', 'imRealTitle',
  'imageById', 'imageFigure', 'imageFileName', 'imageTokensIn', 'inBook', 'inCss', 'inlineMd', 'insertIsLong',
  'isContainerMarkLine', 'isRtlLang', 'labelFaceOf', 'langPack', 'layoutStyled', 'letterRoles', 'listItemsOf',
  'logIsDark', 'logLineDir', 'logLineHtml', 'logLines', 'lucideKey', 'marginColumnRules', 'marginInkCache',
  'marginInkOf', 'marginNamesCache', 'marginNamesOf', 'marginNoteHtml', 'marginNoteParas', 'mdLinkRe',
  'normalizeCoverRecipe', 'normalizeCustomFont', 'normalizeHeaderDesign', 'normalizeHeaderElement',
  'normalizeScenes', 'normalizeSection', 'normalizeWrap', 'normalizeWrapBack', 'normalizeWrapBg',
  'normalizeWrapColor', 'normalizeWrapFont', 'normalizeWrapIcon', 'normalizeWrapSpine', 'olCleanTag',
  'olSectionFields', 'olTagKey', 'ornamentHtml', 'ornamentSvg', 'packagedContentImages', 'packagedImages',
  'packagedImagesImpl', 'parseContainers', 'parseImageLine', 'parseXmlDoc', 'partDividerHtml',
  'pivEnsureStyle', 'pivFootnoteCutCss', 'pivGeometry', 'plateHtml', 'plateImage', 'platformFilename',
  'platformPreset', 'printAccent', 'printBaseFontPt', 'printBigLead', 'printBigType', 'printBleedOn',
  'printBlendHex', 'printColourCss', 'printFootnoteCss', 'printHexRgb', 'printInkFor', 'printLayoutCss',
  'printLayoutNow', 'printMargins', 'printMarginsAuto', 'printNoteFontPt', 'printNoteLinePt',
  'printNotesAtFootNow', 'printPageEstimate', 'printPictureBookOn', 'printSolidTintCss', 'printTextArea',
  'printTypeCss', 'quoteAttribution', 'redactBarHtml', 'redactBlocks', 'redactCharEm', 'resolvePkgPath',
  'rightsLine', 'rightsModeOf', 'rightsYear', 'sceneEntryAt', 'sceneFigureHtml', 'sceneImageAt',
  'scriptFontData', 'scriptFontOfl', 'scriptFontsFor', 'sectionHtml', 'sectionLabel', 'sectionProseWords',
  'sectionWords', 'sectionWordsMemo', 'sidewaysGroups', 'sidewaysPrintPages', 'slug', 'splitRedactions',
  'starPath', 'stripContainerMarks', 'swPageHtml', 'swPrintCache', 't', 'tCountForm', 'textsItems',
  'themeFlourishImages', 'tocHeadingOf', 'tocTree', 'transcriptItems', 'trimSize', 'uiLangState',
  'uiPluralCategory', 'uiPluralRulesCache', 'uid', 'unredactForReading', 'uploadedFontByFamily',
  'uploadedFonts', 'usedDisplayFonts', 'usedUploadedFonts', 'verseParts', 'wrapDefaults', 'xhtmlDoc',
];

/** The book's arrival, run inside the context on the book readBook opened:
 *  the lines of the studio's applyBookDoc (client/index.html) that touch
 *  the keys the EPUB code reads, calling the studio's own normalizers.
 *  readBook already gives meta, print choices and missing keys 1.0's
 *  defaults; these are the per-item normalizations it leaves as stored
 *  (a section without `included`, say). Held to the studio by the parity
 *  test. `colour` arrives as state.bookColour (epubState). */
const ARRIVE = `(s) => {
  s.theme = Object.assign({}, PRESETS[0].theme, s.theme);
  s.theme.header = s.theme.header ? normalizeHeaderDesign(s.theme.header, s.theme) : null;
  if (!s.theme.header) delete s.theme.header;
  s.theme.bodyFont = bodyFaceOf(s.theme.bodyFont);
  s.bookColour = bookColourNormalize(s.bookColour);
  if (!s.bookColour.accent && !s.bookColour.tint) s.bookColour = undefined;
  s.sections = (Array.isArray(s.sections) ? s.sections : []).map(normalizeSection);
  s.cover = s.cover || null;
  s.coverRecipe = s.coverRecipe ? normalizeCoverRecipe(s.coverRecipe) : null;
  s.images = Array.isArray(s.images) ? s.images : [];
  s.fonts = Array.isArray(s.fonts) ? s.fonts.map(normalizeCustomFont).filter(Boolean) : [];
  s.printPictureBook = s.printPictureBook === true && !s.printLargePrint;
  s.printBleed = s.printBleed === true;
  return s;
}`;

/** Lift EPUB_CLOSURE (plus the string tables) out of the studio, in
 *  studio order. Throws naming every declaration that is missing. */
export function extractEpubSource(studioHtml: string, names: readonly string[] = EPUB_CLOSURE): ClosureSource {
  const api = `\n;globalThis.__beukEpub = { buildEpubBlob, epubFiles, ensureScriptFonts, platformFilename, t, setUiLang: (l) => { uiLangState = UI_STRINGS[l] ? l : "en"; }, arrive: ${ARRIVE} };\n`;
  return extractStudioSource(studioHtml, names, { listRef: 'src/book/epub/closure.ts EPUB_CLOSURE', api, stringTables: true });
}

/** Every top-level declaration the studio's code reaches from `roots`,
 *  stopping at `stop` (src/book/studio/closure.ts reachableFrom). */
export function reachableDeclarations(studioHtml: string, roots: readonly string[] = EPUB_ROOTS, stop: readonly string[] = EPUB_SUPPLIED): string[] {
  return reachableFrom(studioHtml, roots, stop);
}

/* ---- the loader: lift once per studio file, build each book in a worker ---- */

export type EpubFile = { path: string; content: string; binary: boolean };
export type BuildOptions = { lang: string; timeoutMs?: number; heapMb?: number };
export type EpubSandbox = {
  source: ClosureSource;
  /** epubFiles() for this state, after the studio fetched its script and display faces. */
  files(state: Record<string, unknown>, opts: BuildOptions): Promise<{ files: EpubFile[]; notes: string[] }>;
  /** buildEpubBlob(): the zipped package the studio downloads, its file name, and every toast it raised. */
  build(state: Record<string, unknown>, opts: BuildOptions): Promise<{ bytes: Buffer; filename: string; notes: string[] }>;
};

/** A build that did not finish: timed out, ran out of heap, or threw. */
export class EpubBuildError extends Error {
  constructor(message: string, readonly reason: 'timeout' | 'memory' | 'failed') {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
/** Heap cap of one build's worker, MB (EPUB_WORKER_HEAP_MB overrides it via config). */
export const DEFAULT_EPUB_WORKER_HEAP_MB = 512;

/** The only variables a build worker sees (src/book/studio/closure.ts STUDIO_WORKER_ENV_KEYS). */
export const EPUB_WORKER_ENV_KEYS: readonly string[] = STUDIO_WORKER_ENV_KEYS;

/** The build worker's options: its own environment (EPUB_WORKER_ENV_KEYS
 *  only) and a heap cap. */
export function workerOptions(job: WorkerJob, heapMb: number): WorkerOptions {
  return studioWorkerOptions(job, heapMb);
}

function runWorker(job: WorkerJob, timeoutMs: number, heapMb: number): Promise<unknown> {
  return runStudioWorker(siblingWorkerUrl(import.meta.url), job, {
    timeoutMs, heapMb, noun: 'EPUB', error: (message, reason) => new EpubBuildError(message, reason),
  });
}

const cache = new Map<string, EpubSandbox>();

/** The studio's EPUB code, lifted from `studioHtml` once (cached by the
 *  file's sha256) and run per book in a fresh worker and vm context. */
export function loadEpubClosure(studioHtml: string, clientDir: string): EpubSandbox {
  const key = createHash('sha256').update(studioHtml).update('\0' + clientDir).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const source = extractEpubSource(studioHtml);
  const jszip = readFileSync(path.join(clientDir, 'assets', 'vendor', 'jszip.min.js'), 'utf8');
  const job = (mode: WorkerJob['mode'], state: Record<string, unknown>, opts: BuildOptions): WorkerJob => ({
    mode,
    code: source.code,
    jszip,
    clientDir: path.resolve(clientDir),
    stateJson: JSON.stringify(state),
    platform: String(state.exportPlatform ?? 'generic'),
    lang: opts.lang,
  });
  const sb: EpubSandbox = {
    source,
    files: (state, opts) => runWorker(job('files', state, opts), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.heapMb ?? DEFAULT_EPUB_WORKER_HEAP_MB) as Promise<{ files: EpubFile[]; notes: string[] }>,
    build: async (state, opts) => {
      const out = (await runWorker(job('build', state, opts), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.heapMb ?? DEFAULT_EPUB_WORKER_HEAP_MB)) as { bytes: Uint8Array; filename: string; notes: string[] };
      return { bytes: Buffer.from(out.bytes.buffer, out.bytes.byteOffset, out.bytes.byteLength), filename: out.filename, notes: out.notes };
    },
  };
  cache.set(key, sb);
  return sb;
}
