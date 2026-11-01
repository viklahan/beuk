/* Beuk 2.0 studio — 1.0's render code in the browser, ONE SOURCE (step 5
   design, decision 3). The server already lifts the studio's preview /
   export / cover code out of client/index.html (src/book/studio/closure.ts,
   used by the EPUB and wrap builds). This build step reuses that very
   selection — the same TypeScript-AST extractor (extractStudioSource) and
   reachability walk (reachableFrom) — to emit a static ES module:

     src/generated/closure.js   (gitignored)

   export function createClosure(env) → { api, setState, getState, arrive }

   - The lifted top-level declarations sit inside createClosure, in 1.0's
     order, so each studio gets its own copy and nothing leaks to window.
   - The names 1.0's code takes from its page are passed in explicitly
     (SUPPLIED): `state` (settable: setState), `toast`,
     `samplePicsRequire`, `JSZip` (the EPUB build's own supplied names,
     read out of src/book/epub/closure.ts), plus `t` and a minimal
     `UI_STRINGS` (the studio's own strings: the browser already has them,
     split per language, so the string tables are NOT lifted).
   - ROOTS: the EPUB build's roots (EPUB_ROOTS, read from
     src/book/epub/closure.ts), countWords and buildBookCss, and the History
     functions wave 1a runs (pack/unpack, prune, the section diff and word
     diff, the word counts, the empty-desk tests).
   - `arrive` is the EPUB build's ARRIVE (src/book/epub/closure.ts): the
     lines of applyBookDoc that give a read book the studio's state shape.
     How 2.0 builds `state` from its Y.Doc: exportBook(ydoc) (book format v1,
     what readBook reads), then the server's epubState mapping (`colour` →
     `bookColour`), then arrive() — see src/closure/index.ts.

   Static code, generated at build time: no eval, no new Function, so the
   CSP holds. Fails loudly — naming what is missing — when a root, a
   supplied name or ARRIVE disappears, when the lifted code reaches a
   string table other than UI_STRINGS, or reaches UI_STRINGS from a function
   not known to read only "misc.untitledBook". */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(STUDIO, '..');

/** History (step 5 wave 1a) and the word counts: functions run by name. */
export const EXTRA_ROOTS = [
  'countWords', 'buildBookCss', 'bookWordTotal', 'sectionWords', 'rightsLine', 'rightsModeOf', 'copyrightRightsParas', 'imRealTitle', 'uid', 'newBookId',
  'normalizeHistory', 'histPack', 'pruneAutoSnapshots', 'histSectionDiff', 'histTextDiff', 'histWordDiff', 'snapshotSectionWords', 'snapshotSectionName',
  'isEmptyDesk', 'deskTrulyEmpty', 'stableJson', 'HISTORY_AUTO_CAP', 'CHOP_SNAP_CAP', 'CC_LICENCES',
  // 1.0's own blank book and section maker (the History checks build their books with them, as 1.0's do)
  'buildEmptyBook', 'mkSection',
  // Settings and rights (wave 1a, task 4): the Save rules and the language list, 1.0's own
  'rightsNormalizeInto', 'RIGHTS_KEYS', 'bookSeriesNumberInto', 'imIsPlaceholderTitle', 'LANG_PACKS', 'langPack', 'a11ySummaryDefault',
  // wave 1b: the sidebar's counts (C1), the chapter operations' plans and rules (B2), the sample book (I8)
  'sectionChars', 'emptyOut', 'inBook', 'sectionComplete', 'READ_WPM', 'AUTO_TYPES',
  'chopSplitPlan', 'chopMergePlan', 'chopMergeWhy', 'chopNumberStyle', 'chopStyleFits', 'chopName', 'chopSig', 'chopCanDelete', 'chopCanDuplicate',
  'chopCanSplitKind', 'chopGenerated', 'chopChapters', 'chopNumbers', 'chopClone', 'normalizeScenes', 'CHOP_TOAST_MS',
  'SAMPLE_IMAGE_FILES', 'SAMPLE_COVER_FILE', 'SAMPLE_WORDS', 'SAMPLE_BOOK_ID', 'LEGACY_SAMPLE_BOOK_ID', 'isSampleBookId',
  'SAMPLE_DRAFT_EDITS', 'SAMPLE_DRAFT_SNAP_ID', 'histCounted',
  // wave 1c, task 4: the arrival sweep of old sample copies (1.0's sampleSweepPreRename / sampleSweepStaleCover)
  'sampleIsPreRenameCopy', 'sampleCoverIsStale', 'sampleHasOldAuthor', 'sampleRenameAuthor', 'SAMPLE_COVER_STALE', 'SAMPLE_OLD_AUTHOR', 'SAMPLE_AUTHOR',
  'SAMPLE_PRE_RENAME_ID', 'bookIdsOf', 'bookIdMigrated',
  // wave 1c, task 5: 1.0's device save names its pictures (BEUK:localpics): the read-only 1.0 import fills them back in
  'picSwap', 'picIsRef', 'PIC_REF',
  // wave 1c: the quick tour's steps and its decision (I7)
  'TOUR_STEPS', 'TOUR_KEY', 'TOUR_DESK_KEY', 'tourDecide',
  // wave 1c: Story Insights (C4) — the computations, the cache and 1.0's own HTML for the room
  'computeInsights', 'insComputeFor', 'insBuildHtml', 'insFactValues', 'insFactAria', 'insVarietyInner', 'insRenderReadability', 'insRtl',
  'insFrequency', 'insRhythm', 'insCadence', 'insEchoes', 'insDialogueText', 'insDialogue', 'insCrutch', 'insHistogram', 'insVariety',
  'insReadability', 'insSyllables', 'insFlesch', 'insTokens', 'insSentences', 'insBodySections', 'fmtNum', 'esc',
  // wave 1c: Names on stage (C5)
  'castCompute', 'castVisible', 'castGridHtml', 'castNormalizeHidden', 'castHash', 'castRateStr', 'CAST_MAX_ROWS', 'bookLang',
  // wave 1c: the notebook and its research files (C7) — the normalisers, the limits and the book's stored forms
  'nbNormalize', 'nbLine', 'nbPack', 'nbHas', 'rsNormalize', 'rsTypeOf', 'rsUrl', 'rsKinds', 'rsLimits', 'rsAccept', 'rsIsRef', 'rsBytesOf',
  'rsKind', 'rsIcon', 'rsSize', 'rsTabOk', 'rsPackFiles', 'rsHas', 'rsNamed', 'rsTotal',
  'bibleAllEntries', 'bibleScan', 'bibleMatcherNow', 'bibleName', 'bibleNormalize',
  // wave 2a: the editor's insert toolbar (A1, A4) — 1.0's own text edits, run on a stand-in for the textarea — the
  // footnote number and link address rules (A2, A3), the margin note's opener (A4) and Auto-Format (A13)
  'insertAtCursor', 'wrapSelection', 'redactSelection', 'applyList', 'applyContainer', 'applyBlockquote', 'applyAttribution',
  'nextFootnoteNumber', 'normalizeLinkUrl', 'MARGIN_OPEN_RE', 'isContainerMarkLine', 'beautifyText',
  // wave 2b: pictures (A6-A8) — the marker text and its rules, the pickers' list, the scene break test, the stock search's
  // addresses and its result mapping, and the image library itself: the usage map, the unused list, removal and its
  // Undo, run on a state holding the book as book format (src/pictures/imagelib.ts)
  'imageTokensIn', 'parseImageLine', 'imageById', 'sceneEntryAt', 'editorBlocks', 'SCENE_BREAK_BLOCK_RE', 'BACKDROP_STRENGTHS',
  'imageTokenText', 'cleanCaption', 'cleanAlt', 'fmtBytes', 'pickerImages', 'isFlourishImage', 'cmStockGate', 'stockSearchUrl', 'stockDirectUrl',
  'cmMapDirectResults', 'imglibUsageMap', 'imageUsage', 'imglibUnused', 'imglibIsSample', 'imglibBytes', 'imglibSize', 'imglibName',
  'imglibUseText', 'imglibSecName', 'imglibRemove', 'imglibUndo', 'IMGLIB_UNDO_MS', 'IMGLIB_COVER_TYPES', 'sampleState',
  // (already lifted for the cover: named so the tests build 1.0's own image library fixture, imglibCheckFixture)
  'defaultCoverRecipe', 'normalizeCoverRecipe', 'wrapDefaults',
  // wave 2c (B3): section types, the matter library, Add Chapter / Add Part, move — 1.0's own structure functions, run
  // on a state holding the book as book format (src/structure/structure.ts); TYPE_TITLES is filled by the top-level
  // statements ATTACH lifts
  'retypeSection', 'RETYPE_GROUPS', 'TYPE_TITLES', 'insertMatter', 'MATTER_LIBRARY', 'MATTER_ORDER', 'SINGLETON_TYPES',
  'moveSection', 'moveSectionTo', 'addPart', 'addChapter', 'partGroups',
  // wave 2c (B4): the back-matter starters and their [[blanks]]
  'starterText', 'starterIds', 'starterBlanks', 'STARTER_TEXT', 'STARTER_BLANK_RE', 'STARTERS_FOR', 'starterBlanksInBook', 'isRtlLang',
  // wave 2c (B5): the outline board — its data rules, its filter (olUi is 1.0's own view object, set by 2.0 before each
  // call), its names, and every edit of the planning fields, tags, saved filters, threads and custom fields
  'OL_STATUSES', 'OL_TAG_COLOURS', 'OL_PREFS_KEY', 'OL_THREADS_MAX', 'OL_FIELDS_MAX', 'OL_FIELD_TYPES', 'olFieldValueOk', 'olCleanThread',
  'olTagKey', 'olCleanTag', 'olSectionFields', 'olNormalize', 'olBook', 'olBookSet', 'olBookPack', 'olTagOf', 'olUi', 'olFilterOn',
  'olMatches', 'olItems', 'olNumLabel', 'olName', 'olScenes', 'olStatusLabel', 'olKindBounds', 'olSavedMatches', 'olGridSecs', 'olGridEntries',
  'olSetField', 'olAddTag', 'olRemoveTag', 'olDeleteTag', 'olSaveFilter', 'olAddThread', 'olRenameThread', 'olSetThreadNote', 'olDeleteThread',
  'olAddField', 'olRenameField', 'olSetFieldOptions', 'olSetCustom', 'olDeleteField', 'olApplySaved',
  // the Grid's Covenant columns: 1.0's uncached count (bibleMentions itself reads uiLangState for its cache key)
  'bibleMentionsCompute', 'bibleTypeLabel', 'castSecLabel', 'CAST_STEPS',
];
/** Wave 2c: lifted declarations that 1.0 fills by top-level statements right after them (TYPE_TITLES: the FRONT / BACK
 *  labels and the extra types). Every top-level expression statement of the studio that assigns into one of these is
 *  lifted too, in 1.0's order, after the declarations (ONE SOURCE: nothing retyped). */
export const ATTACH = ['TYPE_TITLES'];
/** Test oracle only (wave 2a, constraint 11): 1.0's dialog handlers, which read and write their dialog's fields
 *  through `$`. Emitted as a THIRD module, src/generated/closure-oracle.js, that only the tests import (never the
 *  app): each test hands it a stand-in `$` and textarea and compares 2.0's result with 1.0's own. Like the sample
 *  module it holds only declarations the main closure does not, and takes everything else from `share`. */
export const ORACLE_ROOTS = ['openFootnoteDialog', 'confirmFootnote', 'openLinkDialog', 'confirmLink', 'openMarginDialog', 'confirmMargin',
  // wave 2b: the section card's marker edits, the scene bar's break test, the scene picker's handlers
  'sceneBreakAtCursor', 'rewriteImageToken', 'updateImageToken', 'removeImageToken', 'openScenePicker', 'sceneSelectImage', 'confirmSceneImage',
  'detachSceneImage', 'removeSceneAtCursor', 'toggleSceneSuggest', 'sceneRenderSuggestResults', 'sceneStockLanded', 'selectLibImage',
  // wave 2c (fix round 1): the sidebar row's own handler, whose "eye" branch is 1.0's include toggle
  'sectionAction'];
/** What the oracle's handlers take from 1.0's page, supplied by the test (createOracle(share, env)). */
export const ORACLE_SUPPLIED = ['$', 'activeSection', 'editorViewSnapshot', 'editorViewRestore', 'icons',
  // wave 2b: what the picture handlers redraw afterwards (nothing a test reads), and 1.0's renderImgLib
  'withEditorView', 'updateStats', 'renderPreview', 'renderSectionImages', 'zenRenderSurface', 'updateSceneBar', 'refreshExportTree',
  'renderSceneLib', 'renderImgLib', 'refreshImagePickers', 'document',
  // wave 2c: sectionAction's other branches (the row menu, delete), never taken by the eye test
  'chopOpenMenu', 'chopDelete'];
/** 1.0's top-level lets the oracle's handlers assign (openScenePicker sets scenePending, selectLibImage imgSelId) and the
 *  main closure also holds (imglibRemove clears them): the oracle declares its OWN copy, so its handlers' writes stay its
 *  own (a shared name is read-only there). */
export const ORACLE_OWN = ['imgSelId', 'scenePending'];
/** The sample book's own code (wave 1c, task 4): 1.0's buildSampleBook with its 145 kB of text (SAMPLE_SECTIONS), and
 *  the packaged cover entry. Emitted as a SECOND module, src/generated/closure-sample.js, its own chunk, loaded only
 *  when the sample is built (Load sample, the pre-rename sweep). It holds only the declarations nothing in the main
 *  closure reaches; everything else it uses is the main closure's own (handed over as `share`: one copy, no drift). */
export const SAMPLE_ROOTS = ['buildSampleBook', 'sampleCoverDoc'];
/** 1.0's top-level `let`s a caller reads or sets (emitted as accessors on the closure's `vars`). */
export const VARS = ['insVarPick', 'insCache', 'insFacts'];
/** Names the browser studio supplies besides the EPUB build's. */
export const BROWSER_SUPPLIED = ['t', 'UI_STRINGS', 'getUiLang', 'deskState', 'deskSignature',
  // wave 2b (the image library): History's snapshot (2.0's own, history.ts), the edit counter a run of removals reads
  // (1.0's local.editSeq), and what 1.0 does after an edit (noteBookEdited, imglibRefresh: 2.0 re-renders from the
  // Y.Doc); the series Covenant's save (wave 7: 2.0 holds no series, so bibleSeries is null and 1.0's own function returns
  // at once); 1.0's `cloud` as far as cmStockGate reads it (available, user)
  'autoSnapshot', 'local', 'noteBookEdited', 'imglibRefresh', 'bibleSeriesTouched', 'cloud',
  // wave 2c: 1.0's redraws after a structural edit (React re-renders from the Y.Doc), and selectSection (2.0 selects the
  // section 1.0 chose once the change is written: src/structure/structure.ts structEnv)
  'renderSidebar', 'syncEditor', 'renderPreview', 'updateStats', 'refreshExportTree', 'selectSection', 'olRender'];
/** Lifted declarations that may read UI_STRINGS: each reads only every pack's "misc.untitledBook". */
export const UI_STRINGS_READERS = ['imIsPlaceholderTitle'];
/** Top-level names of 1.0 that the lifted code uses only as LOCAL names (the reachability walk is by name, not by
 *  scope): the walk does not follow them. castTokens' `let init` (wave 1c) would otherwise reach 1.0's own init() and
 *  with it the whole studio. Each is checked below never to be called in the lifted code. */
export const LOCAL_ONLY = ['init'];
/** Never lifted: the string tables and the interface language (the studio owns those). */
const FORBIDDEN = /^(UI_STRINGS|UI_LANG_ORDER|UI_LANG_NAMES|UI_PLURAL_FORMS|[A-Z][A-Z0-9_]*_STRINGS|uiLangState|tCountForm|uiPluralCategory|uiPluralRulesCache)$/;

const fail = (msg) => {
  throw new Error(`extract-closure: ${msg}`);
};

let closureMod = null;
async function studioClosure() {
  if (closureMod) return closureMod;
  const studioPkg = pathToFileURL(path.join(STUDIO, 'package.json')).href;
  const hook = `export async function resolve(spec, ctx, next) {
    if (spec === 'typescript' && ctx.parentURL && ctx.parentURL.endsWith('/src/book/studio/closure.ts')) return next(spec, { ...ctx, parentURL: ${JSON.stringify(studioPkg)} });
    return next(spec, ctx);
  }`;
  register('data:text/javascript,' + encodeURIComponent(hook));
  closureMod = await import(pathToFileURL(path.join(REPO, 'src', 'book', 'studio', 'closure.ts')).href);
  return closureMod;
}

/** EPUB_ROOTS, EPUB_SUPPLIED (string arrays) and ARRIVE (a template literal), read out of src/book/epub/closure.ts. */
export function epubSpec(source) {
  const sf = ts.createSourceFile('epub-closure.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = {};
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const name = d.name.text;
      if ((name === 'EPUB_ROOTS' || name === 'EPUB_SUPPLIED') && ts.isArrayLiteralExpression(d.initializer)) {
        const items = d.initializer.elements.map((e) => (ts.isStringLiteral(e) ? e.text : null));
        if (items.includes(null)) fail(`src/book/epub/closure.ts ${name} is no longer a list of plain strings`);
        found[name] = items;
      } else if (name === 'ARRIVE' && ts.isNoSubstitutionTemplateLiteral(d.initializer)) {
        found.ARRIVE = d.initializer.text;
      }
    }
  }
  for (const k of ['EPUB_ROOTS', 'EPUB_SUPPLIED', 'ARRIVE']) if (!found[k]) fail(`src/book/epub/closure.ts no longer declares ${k}`);
  return found;
}

const declName = (code) => {
  const m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(code.trim());
  return m ? m[1] || m[2] : null;
};

/** The generated module's source for this studio file. */
export async function buildClosureModule(html, epubSource) {
  const { extractStudioSource, reachableFrom } = await studioClosure();
  const spec = epubSpec(epubSource);
  const roots = [...spec.EPUB_ROOTS, ...EXTRA_ROOTS];
  const supplied = [...spec.EPUB_SUPPLIED, ...BROWSER_SUPPLIED];
  const attach = await attachStatements(html);
  const names = reachableFrom(html, [...roots, ...attach.refs], [...supplied, ...LOCAL_ONLY]);
  const sampleNames = reachableFrom(html, SAMPLE_ROOTS, [...supplied, ...LOCAL_ONLY, ...names]);
  const oracleNames = [...new Set([...reachableFrom(html, ORACLE_ROOTS, [...supplied, ...ORACLE_SUPPLIED, ...LOCAL_ONLY, ...names]), ...ORACLE_OWN])];
  const forbidden = [...names, ...sampleNames, ...oracleNames].filter((n) => FORBIDDEN.test(n));
  if (forbidden.length) fail(`the lifted code reaches ${forbidden.join(', ')}, which the browser studio does not lift (supply it, or change the roots)`);
  let src;
  try {
    // extractStudioSource throws naming every root (or reached name) client/index.html no longer declares
    src = extractStudioSource(html, [...new Set([...roots, ...names])], { listRef: 'studio/scripts/extract-closure.mjs ROOTS', api: '', stringTables: false });
  } catch (e) {
    fail(e.message);
  }
  for (const n of LOCAL_ONLY) {
    if (src.names.includes(n) || new RegExp('(^|[^\\w$.])' + n + '\\s*\\(').test(src.code)) fail(`${n} is in LOCAL_ONLY but the lifted code declares or calls it`);
  }
  // each lifted statement, to check who reads UI_STRINGS
  const lifted = ts.createSourceFile('closure.js', src.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const readers = [];
  for (const st of lifted.statements) {
    let hit = false;
    const walk = (n) => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === 'UI_STRINGS') hit = true;
      else ts.forEachChild(n, walk);
    };
    walk(st);
    if (hit) readers.push(declName(st.getText(lifted)) || '(unnamed)');
  }
  const strayReaders = readers.filter((n) => !UI_STRINGS_READERS.includes(n));
  if (strayReaders.length) fail(`UI_STRINGS is read by ${strayReaders.join(', ')}: only ${UI_STRINGS_READERS.join(', ')} may (the browser supplies a table of "misc.untitledBook" alone)`);
  const api = [...new Set(roots)].filter((n) => src.names.includes(n));
  const sample = sampleModule(extractStudioSource, html, sampleNames, src.names, supplied);
  const oracle = subModule(extractStudioSource, html, oracleNames, src.names, supplied, {
    label: 'ORACLE_ROOTS', roots: ORACLE_ROOTS, env: ORACLE_SUPPLIED, fn: 'createOracle', namesConst: 'ORACLE_NAMES',
    about: "1.0's dialog handlers (ORACLE_ROOTS), for the tests only: the app never imports this module",
  });
  const vars = VARS.filter((n) => src.names.includes(n));
  const unlifted = VARS.filter((n) => !src.names.includes(n));
  if (unlifted.length) fail(`VARS names no lifted declaration: ${unlifted.join(', ')}`);
  const head = [
    '/* GENERATED by studio/scripts/extract-closure.mjs from client/index.html — do not edit.',
    `   ${src.names.length} top-level declarations (${src.lines} lines) of 1.0's own code, reached from the roots below;`,
    `   studio sha256 ${src.studioSha}. */`,
    '/* eslint-disable */',
    `export const CLOSURE_NAMES = ${JSON.stringify(src.names)};`,
    `export const CLOSURE_ROOTS = ${JSON.stringify(api)};`,
    `export const CLOSURE_SUPPLIED = ${JSON.stringify(supplied)};`,
    `export const STUDIO_SHA = ${JSON.stringify(src.studioSha)};`,
    'export function createClosure(env) {',
    '  let state = env.state;',
    ...supplied.filter((n) => n !== 'state').map((n) => `  const ${n} = env.${n};`),
  ].join('\n');
  const tail = [
    '',
    `  const vars = { ${vars.map((v) => `get ${v}() { return ${v}; }, set ${v}(v) { ${v} = v; }`).join(', ')} };`,
    `  const share = { get state() { return state; }, ${[...new Set([...sample.uses, ...oracle.uses])].map((n) => `get ${n}() { return ${n}; }`).join(', ')} };`,
    `  return { api: { ${api.join(', ')} }, vars, share, setState: (s) => { state = s; }, getState: () => state, arrive: ${spec.ARRIVE} };`,
    '}',
    '',
  ].join('\n');
  const missingAttach = ATTACH.filter((n) => !src.names.includes(n) || !attach.byName[n]);
  if (missingAttach.length) fail(`ATTACH names no lifted declaration filled by a top-level statement: ${missingAttach.join(', ')}`);
  return { code: head + '\n' + src.code + '\n' + attach.code + tail, names: src.names, roots: api, supplied, sample, oracle };
}

/** The top-level expression statements that assign into an ATTACH name (in studio order), and the names they read. */
async function attachStatements(html) {
  const { studioScript } = await studioClosure();
  const sf = ts.createSourceFile('studio.js', studioScript(html), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const rootOf = (x) => {
    while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
    return ts.isIdentifier(x) ? x.text : '';
  };
  const parts = [], refs = new Set(), byName = {};
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st)) continue;
    let target = null;
    const walk = (n) => {
      if (target) return;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ATTACH.includes(rootOf(n.left))) target = rootOf(n.left);
      else ts.forEachChild(n, walk);
    };
    walk(st);
    if (!target) continue;
    byName[target] = true;
    parts.push(st.getText(sf));
    const collect = (n) => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isKey = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
        if (!isKey) refs.add(n.text);
      }
      ts.forEachChild(n, collect);
    };
    collect(st);
  }
  return { code: parts.join('\n'), refs: [...refs], byName };
}

function sampleModule(extractStudioSource, html, sampleNames, mainNames, supplied) {
  return subModule(extractStudioSource, html, sampleNames, mainNames, supplied, {
    label: 'SAMPLE_ROOTS', roots: SAMPLE_ROOTS, env: [], fn: 'createSample', namesConst: 'SAMPLE_NAMES',
    about: 'The sample book (SAMPLE_ROOTS)',
  });
}

/** A sub-module (the sample, the test oracle): its roots' own declarations inside `fn`(share, env), the names they use
 *  from the main closure (and its supplied names) taken from `share` when it is created, the names in `o.env` from
 *  `env`. Created afresh for each use, so `state` and every shared name are the main closure's current ones. Fails
 *  loudly if a root ended up in the main closure, or if the code would ASSIGN to a shared name (that write would be
 *  lost). */
function subModule(extractStudioSource, html, ownNames, mainNames, supplied, o) {
  let src;
  try {
    src = extractStudioSource(html, ownNames, { listRef: 'studio/scripts/extract-closure.mjs ' + o.label, api: '', stringTables: false });
  } catch (e) {
    fail(e.message);
  }
  const missing = o.roots.filter((n) => !src.names.includes(n));
  if (missing.length) fail(`${o.label} ${missing.join(', ')} ended up in the main closure (something there reaches them): the ${o.fn} module would not hold them`);
  const sf = ts.createSourceFile('sub.js', src.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const outer = new Set([...mainNames, ...supplied, ...o.env]);
  const uses = new Set();
  const assigned = new Set();
  const walk = (n) => {
    if (ts.isIdentifier(n) && outer.has(n.text) && !src.names.includes(n.text)) {
      const p = n.parent;
      const isKey = (ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name === n);
      if (!isKey) {
        uses.add(n.text);
        if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) assigned.add(n.text);
        if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) assigned.add(n.text);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  if (assigned.size) fail(`the ${o.label} code assigns to ${[...assigned].join(', ')} of the main closure; that write would be lost`);
  uses.delete('state');
  const fromEnv = [...uses].filter((n) => o.env.includes(n));
  const fromShare = [...uses].filter((n) => !o.env.includes(n));
  const code = [
    '/* GENERATED by studio/scripts/extract-closure.mjs from client/index.html — do not edit.',
    `   ${o.about}: ${src.names.length} declarations of 1.0's own code that only it uses; every other`,
    '   name comes from the main closure (share), created afresh for each use. */',
    '/* eslint-disable */',
    `export const ${o.namesConst} = ${JSON.stringify(src.names)};`,
    `export function ${o.fn}(share, env) {`,
    '  let state = share.state;',
    ...fromShare.map((n) => `  const ${n} = share.${n};`),
    ...fromEnv.map((n) => `  const ${n} = env.${n};`),
    src.code,
    `  return { ${o.roots.join(', ')} };`,
    '}',
    '',
  ].join('\n');
  return { code, names: src.names, uses: new Set(fromShare) };
}

/** The module's types (the functions are 1.0's untyped code: src/closure/index.ts gives the ones 2.0 calls their types). */
const DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. */
export declare const CLOSURE_NAMES: string[];
export declare const CLOSURE_ROOTS: string[];
export declare const CLOSURE_SUPPLIED: string[];
export declare const STUDIO_SHA: string;
export type ClosureEnv = { state: unknown; toast: (msg: string, icon?: string) => void; samplePicsRequire: () => Promise<unknown>; JSZip: unknown; t: (key: string, params?: Record<string, unknown>) => string; UI_STRINGS: Record<string, Record<string, string>>; getUiLang: () => string; deskState: unknown; deskSignature: () => string; autoSnapshot: (kind: string) => unknown; local: { readonly editSeq: number }; noteBookEdited: () => void; imglibRefresh: () => void; bibleSeriesTouched: () => void; cloud: { available: boolean; user: unknown }; renderSidebar: () => void; syncEditor: () => void; renderPreview: () => void; updateStats: () => void; refreshExportTree: () => void; selectSection: (id: string) => void; olRender: () => void };
export declare function createClosure(env: ClosureEnv): { api: Record<string, (...args: any[]) => any> & Record<string, any>; vars: Record<string, any>; share: Record<string, unknown>; setState(s: unknown): void; getState(): any; arrive(s: unknown): any };
`;

const SAMPLE_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. */
export declare const SAMPLE_NAMES: string[];
export declare function createSample(share: Record<string, unknown>): { buildSampleBook: () => any; sampleCoverDoc: () => any };
`;

const ORACLE_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. Test oracle only. */
export declare const ORACLE_NAMES: string[];
export declare function createOracle(share: Record<string, unknown>, env: Record<string, unknown>): Record<string, (...args: any[]) => any>;
`;

export async function writeClosure() {
  const html = readFileSync(path.join(REPO, 'client', 'index.html'), 'utf8');
  const epub = readFileSync(path.join(REPO, 'src', 'book', 'epub', 'closure.ts'), 'utf8');
  const out = await buildClosureModule(html, epub);
  const dir = path.join(STUDIO, 'src', 'generated');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'closure.js'), out.code);
  writeFileSync(path.join(dir, 'closure.d.ts'), DTS);
  writeFileSync(path.join(dir, 'closure-sample.js'), out.sample.code);
  writeFileSync(path.join(dir, 'closure-sample.d.ts'), SAMPLE_DTS);
  writeFileSync(path.join(dir, 'closure-oracle.js'), out.oracle.code);
  writeFileSync(path.join(dir, 'closure-oracle.d.ts'), ORACLE_DTS);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeClosure()
    .then((o) => console.log(`extract-closure: ${o.names.length} declarations, ${o.roots.length} roots → src/generated/closure.js; the sample: ${o.sample.names.length} → closure-sample.js; the test oracle: ${o.oracle.names.length} → closure-oracle.js`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
