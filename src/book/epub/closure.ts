import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import ts from 'typescript';
import type { WorkerJob } from './worker.js';

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
   `JSZip` (the vendored client/assets/vendor/jszip.min.js). */

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
  'TEXT_HEAD_FONTS', 'TRANSCRIPT_DIR_RE', 'TRANSCRIPT_LINE_RE', 'TRIM_SIZES', 'UI_PLURAL_FORMS',
  'UI_STRINGS', 'a11yFacts', 'a11yMetaBlock', 'a11yStampConformance', 'a11ySummaryDefault',
  'a11ySummaryText', 'altSaid', 'applyLeadIn', 'auditAccessibility', 'backdropImage', 'backdropLayerHtml',
  'beautifyText', 'bodyFaceOf', 'bookColour', 'bookColourNormalize', 'bookColourRules', 'bookDirAttr',
  'bookLang', 'bookScripts', 'bufToBase64', 'buildBookCss', 'buildEpubBlob', 'chapterOpeningHtml',
  'clampNum', 'colourContrast', 'colourForDark', 'colourHex', 'colourLum', 'columnsHanging',
  'containerIndent', 'containerKind', 'containerPassThrough', 'containerStanzas', 'contentBlocksToHtml',
  'copyrightPageParas', 'copyrightRightsParas', 'countWords', 'countWordsFresh', 'countWordsRaw',
  'countWordsShort', 'curlify', 'defaultCoverRecipe', 'defaultHeaderDesign', 'displayFaceRules',
  'displayFontData', 'displayFontOf', 'displayFontOfl', 'displayFontsFor', 'docxRedactRun',
  'docxRedactedPlainRuns', 'docxRun', 'ensureDisplayFonts', 'ensureScriptFonts',
  'epubApplyManifestProperties', 'epubAttr', 'epubCssHasRemote', 'epubDetectProps', 'epubFiles', 'epubFonts',
  'epubIsRemoteRef', 'epubManifestPropertyReport', 'epubOpfPathOf', 'epubPlan', 'epubTocTarget', 'esc',
  'escRedacted', 'flourishOf', 'flourishSrc', 'fontFaceCss', 'fontFileName', 'fontStack', 'frontBackHtml',
  'frontispieceCaption', 'frontispiecePlateHtml', 'halfTitleLine1', 'halfTitleLine2', 'hangingDocx',
  'hangingHtml', 'hangingParts', 'headerDesignRules', 'headingFlourishHtml', 'heartPath',
  'holdContainerIndents', 'holdRawContainers', 'imIsPlaceholderTitle', 'imMetaValue', 'imRealTitle',
  'imageById', 'imageFigure', 'imageFileName', 'imageTokensIn', 'inCss', 'inlineMd', 'insertIsLong',
  'isContainerMarkLine', 'isRtlLang', 'labelFaceOf', 'langPack', 'layoutStyled', 'letterRoles',
  'listItemsOf', 'logIsDark', 'logLineDir', 'logLineHtml', 'logLines', 'marginColumnRules', 'marginInkCache',
  'marginInkOf', 'marginNamesCache', 'marginNamesOf', 'marginNoteHtml', 'marginNoteParas', 'mdLinkRe',
  'normalizeCoverRecipe', 'normalizeCustomFont', 'normalizeHeaderDesign', 'normalizeHeaderElement',
  'normalizeScenes', 'normalizeSection', 'normalizeWrap', 'olCleanTag', 'olSectionFields', 'olTagKey',
  'ornamentHtml', 'ornamentSvg', 'packagedContentImages', 'packagedImages', 'packagedImagesImpl',
  'parseContainers', 'parseImageLine', 'parseXmlDoc', 'partDividerHtml', 'pivEnsureStyle',
  'pivFootnoteCutCss', 'pivGeometry', 'plateHtml', 'plateImage', 'platformFilename', 'platformPreset',
  'printAccent', 'printBaseFontPt', 'printBigLead', 'printBigType', 'printBleedOn', 'printBlendHex',
  'printColourCss', 'printFootnoteCss', 'printHexRgb', 'printInkFor', 'printLayoutCss', 'printLayoutNow',
  'printMargins', 'printMarginsAuto', 'printNoteFontPt', 'printNoteLinePt', 'printNotesAtFootNow',
  'printPageEstimate', 'printPictureBookOn', 'printSolidTintCss', 'printTextArea', 'printTypeCss',
  'quoteAttribution', 'redactBarHtml', 'redactBlocks', 'redactCharEm', 'resolvePkgPath', 'rightsLine',
  'rightsModeOf', 'rightsYear', 'sceneEntryAt', 'sceneFigureHtml', 'sceneImageAt', 'scriptFontData',
  'scriptFontOfl', 'scriptFontsFor', 'sectionHtml', 'sectionLabel', 'sectionProseWords', 'sectionWords',
  'sectionWordsMemo', 'sidewaysGroups', 'sidewaysPrintPages', 'slug', 'splitRedactions', 'starPath',
  'stripContainerMarks', 'swPageHtml', 'swPrintCache', 't', 'tCountForm', 'textsItems',
  'themeFlourishImages', 'tocHeadingOf', 'tocTree', 'transcriptItems', 'trimSize', 'uiLangState',
  'uiPluralCategory', 'uiPluralRulesCache', 'uid', 'unredactForReading', 'uploadedFontByFamily',
  'uploadedFonts', 'usedDisplayFonts', 'usedUploadedFonts', 'verseParts', 'wrapDefaults', 'xhtmlDoc',
];

/** The interface-string tables t() reads: their declarations and every
 *  top-level statement that writes into them (the same selection
 *  tests/localization.test.ts guards; a write tucked elsewhere fails it). */
const STRING_TABLE = /^(UI_STRINGS|UI_LANG_ORDER|UI_LANG_NAMES|UI_PLURAL_FORMS|[A-Z][A-Z0-9_]*_STRINGS)$/;

export type ClosureSource = {
  /** The lifted statements in studio order, then the API object. */
  code: string;
  /** Declarations lifted (EPUB_CLOSURE plus the string tables). */
  names: string[];
  /** Lines of studio code lifted. */
  lines: number;
  /** sha256 of the studio file the code came from. */
  studioSha: string;
};

/** The studio's main inline script: the one that declares epubFiles. */
export function studioScript(studioHtml: string): string {
  for (const m of studioHtml.matchAll(/<script>([\s\S]*?)<\/script>\n/g)) if (m[1]!.includes('function epubFiles(')) return m[1]!;
  throw new Error('client/index.html: no inline <script> declares epubFiles');
}

const declNames = (st: ts.Statement): string[] => {
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
};

function rootOf(x: ts.Expression): string {
  while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
  return ts.isIdentifier(x) ? x.text : '';
}

/** A direct write into a string table: Object.assign(T…, …) or T… = …. */
function directWrite(e: ts.Node, sf: ts.SourceFile): boolean {
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) return STRING_TABLE.test(rootOf(e.left));
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sf);
    if (callee === 'Object.assign') return !!e.arguments[0] && STRING_TABLE.test(rootOf(e.arguments[0]));
    const m = /^Object\.keys\((\w+)\)\.forEach$/.exec(callee);
    if (m) return STRING_TABLE.test(m[1]!);
  }
  return false;
}

/** Does this top-level statement write into a string table? A direct
 *  write, the Object.keys(X_STRINGS).forEach merge, or the
 *  [["es", …], …].forEach(… Object.assign(UI_STRINGS[lang], …)) rows idiom. */
function writesTable(st: ts.Statement, sf: ts.SourceFile): boolean {
  if (!ts.isExpressionStatement(st)) return false;
  const e = st.expression;
  if (directWrite(e, sf)) return true;
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'forEach') return false;
  if (!ts.isArrayLiteralExpression(e.expression.expression)) return false;
  let hit = false;
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (directWrite(n, sf)) hit = true;
    else ts.forEachChild(n, walk);
  };
  walk(e);
  return hit;
}

function indexStudio(studioHtml: string): { sf: ts.SourceFile; byName: Map<string, ts.Statement> } {
  const sf = ts.createSourceFile('studio.js', studioScript(studioHtml), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const byName = new Map<string, ts.Statement>();
  for (const st of sf.statements) for (const n of declNames(st)) if (!byName.has(n)) byName.set(n, st);
  return { sf, byName };
}

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
  const { sf, byName } = indexStudio(studioHtml);
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) throw new Error(`client/index.html no longer declares: ${missing.join(', ')} (src/book/epub/closure.ts EPUB_CLOSURE)`);
  const take = new Set<ts.Statement>(names.map((n) => byName.get(n)!));
  for (const st of sf.statements) {
    if (declNames(st).some((n) => STRING_TABLE.test(n)) || writesTable(st, sf)) take.add(st);
  }
  const lifted = sf.statements.filter((st) => take.has(st));
  let lines = 0;
  const parts = lifted.map((st) => {
    const text = st.getText(sf);
    lines += text.split('\n').length;
    return text;
  });
  const api = `\n;globalThis.__beukEpub = { buildEpubBlob, epubFiles, ensureScriptFonts, platformFilename, t, setUiLang: (l) => { uiLangState = UI_STRINGS[l] ? l : "en"; }, arrive: ${ARRIVE} };\n`;
  return {
    code: parts.join('\n') + api,
    names: [...new Set(lifted.flatMap(declNames))],
    lines,
    studioSha: createHash('sha256').update(studioHtml).digest('hex'),
  };
}

/** Every top-level declaration the studio's code reaches from `roots`,
 *  stopping at `stop`. Property names and object keys are not references.
 *  It over-approximates (a local that shadows a top-level name still
 *  counts), which only makes the coverage check stricter. */
export function reachableDeclarations(studioHtml: string, roots: readonly string[] = EPUB_ROOTS, stop: readonly string[] = EPUB_SUPPLIED): string[] {
  const { byName } = indexStudio(studioHtml);
  const refs = (node: ts.Node): string[] => {
    const out: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isKey = (ts.isPropertyAccessExpression(p) && p.name === n)
          || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === n);
        if (!isKey) out.push(n.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return out;
  };
  const stopSet = new Set(stop);
  const seen = new Set<string>();
  const done = new Set<ts.Statement>();
  const queue = [...roots];
  while (queue.length) {
    const n = queue.pop()!;
    if (seen.has(n) || stopSet.has(n)) continue;
    seen.add(n);
    const st = byName.get(n);
    if (!st || done.has(st)) continue;
    done.add(st);
    for (const r of refs(st)) if (!seen.has(r)) queue.push(r);
  }
  return [...seen].filter((n) => byName.has(n)).sort();
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

const HERE_URL = import.meta.url;
function workerUrl(): URL {
  /* Under tsx (tests, dev) this module is closure.ts, so the worker is worker.ts; in dist both are .js. */
  return new URL(HERE_URL.endsWith('.ts') ? './worker.ts' : './worker.js', HERE_URL);
}

/** The only variables a build worker sees: where the temp directory is
 *  (with none at all, Node on Windows resolves os.tmpdir() to
 *  "undefined/temp" in the working directory). Never DATABASE_URL, Stripe
 *  keys or any other secret. */
export const EPUB_WORKER_ENV_KEYS: readonly string[] = ['TMPDIR', 'TMP', 'TEMP'];

/** The build worker's options: its own environment (EPUB_WORKER_ENV_KEYS
 *  only) and a heap cap. */
export function workerOptions(job: WorkerJob, heapMb: number): WorkerOptions {
  const env: Record<string, string> = {};
  for (const k of EPUB_WORKER_ENV_KEYS) if (process.env[k]) env[k] = process.env[k]!;
  return { workerData: job, env, resourceLimits: { maxOldGenerationSizeMb: heapMb } };
}

function runWorker(job: WorkerJob, timeoutMs: number, heapMb: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl(), workerOptions(job, heapMb));
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void w.terminate();
    };
    const timer = setTimeout(() => done(() => reject(new EpubBuildError(`the EPUB build did not finish within ${timeoutMs} ms and was stopped`, 'timeout'))), timeoutMs);
    w.once('message', (m: { ok: boolean; out?: unknown; error?: string }) =>
      done(() => (m.ok ? resolve(m.out) : reject(new EpubBuildError(`the EPUB build failed: ${m.error}`, 'failed')))));
    w.once('error', (err: Error & { code?: string }) =>
      done(() => reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? new EpubBuildError('the EPUB build ran out of memory and was stopped', 'memory')
        : new EpubBuildError(`the EPUB build failed: ${err.message}`, 'failed'))));
    w.once('exit', (code) => done(() => reject(new EpubBuildError(`the EPUB build stopped (exit ${code})`, 'failed'))));
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
