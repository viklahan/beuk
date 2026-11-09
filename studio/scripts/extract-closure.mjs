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
  // wave 3a (C2): goals, the streak, the writing log, the Road so far and just-write — 1.0's whole subsystem, its own
  // per-device state (wlog, streakState) included; its renderers write into the Goals room's and the sidebar's ids
  'normalizeGoals', 'parseDayStr', 'dayStr', 'goalMath', 'goalPlan', 'goalOnPace', 'goalKept', 'goalKeptRange', 'goalStreakBridges',
  'goalWritingDaysBetween', 'goalDays', 'goalIsWritingDay', 'goalPlanLine', 'goalPaceLine', 'goalDailyLine', 'goalProjectLine', 'goalDeadlineLine',
  'roadPoints', 'roadSegments', 'roadModel', 'roadGeom', 'roadSvg', 'roadKeyHtml', 'roadPointLabel', 'roadLongDate',
  'wlogObserve', 'wlogTick', 'wlogFlush', 'wlogLoad', 'wlogSave', 'wlogTodayWords', 'wlogTodayMinutes', 'wlogBookKey', 'bookTotalWords',
  'markWritingActivity', 'renderStreak', 'saveStreak', 'loadStreak', 'streakState', 'STREAK_KEY', 'WLOG_KEY', 'goalStreakNow', 'goalJustWrite', 'goalSetJustWrite',
  'goalClearTracking', 'goalAskClearTracking', 'goalEnsureStart', 'goalsApply', 'commitGoals', 'renderGoalLines', 'renderGoalsProgress',
  'renderGoalKept', 'renderGoalCalendar', 'renderGoalRoad', 'roadShow', 'roadHide', 'roadNearest', 'syncGoalInputs', 'goalsRenderRoom',
  // wave 3a (A11): Zen, the day cycle, the painted scenes and the ambient sound — 1.0's own, building its layers in the
  // page as 1.0 does (setZenMode, zenBuildLayer); `$` is supplied so 1.0's #editorArea is the open editor's stand-in
  'setZenMode', 'zenSettle', 'zenSoundStart', 'zenSoundStop', 'zenSoundSetScene', 'zenSoundPref', 'zenScenePref', 'zenSoundGraph', 'zenSoundUrl',
  'zenSceneMigrate', 'zenSound', 'zenStep', 'zenGoTo', 'zenIndexClose', 'zenRenderSurface', 'zdPhase', 'zdSetPhase', 'zdSetClock', 'zdTick', 'zdLight',
  'zdBody', 'zdVisibility', 'ZEN_PAINTINGS', 'zenPaintPref', 'ZEN_SCENES', 'ZEN_SOUND_FILES',
  // wave 3a (A10, A9): Read Aloud, dictation, the dictation language and the language suggestion bar
  'raTogglePop', 'raClosePop', 'raPlay', 'raPause', 'raStop', 'raRefresh', 'raLangVoices', 'raSuggested', 'raLang', 'raSupported', 'ra',
  'raBuildChunks', 'raCleanText', 'raChosenVoice', 'raSyncUi', 'tbPlaceRaPop',
  'dictToggle', 'dictBegin', 'dictStop', 'dictDiscard', 'dictOpenLangPicker', 'dictPopClose', 'dictSyncUi', 'dictLangInfo', 'dictSetLang',
  'dictSupported', 'dict', 'DICT_SEEN_KEY', 'dictOnLangChange', 'dictNormalize',
  'langBarRefresh', 'langBarLater', 'langSugReset', 'raLangSugRender', 'langSetBookLanguage', 'langSuggestion', 'langSug', 'detectLanguageInText',
  'langDisplayName',
  // wave 3a: what 1.0's window.beukDictation / beukZen test seams reach (src/environment/EnvironmentHost.tsx)
  'dictLangChoices', 'DICT_LANGS', 'zenFoldSync',
  // wave 3b (C6): the Covenant — 1.0's own model, room, card, change marking and series code, drawing into the room's
  // ids (src/covenant). The desk mirror (bibleDesk*) is NOT lifted: its entry points are supplied (BROWSER_SUPPLIED),
  // and 2.0 draws the marks as ProseMirror decorations (src/covenant/marks.ts)
  'BIBLE_TYPES', 'BIBLE_MAX', 'BIBLE_FORMAT', 'BIBLE_CHANGE_MAX', 'BIBLE_MARKS_KEY', 'BIBLE_NEAR', 'bibleKey', 'bibleBuildMatcher',
  'bibleNormalizeEntry', 'bibleNormalizeAnchor', 'bibleAnchorMake', 'bibleAnchorFind', 'bibleStateAt', 'bibleResolveChange', 'bibleCursorPos', 'biblePos',
  'bibleEntries', 'bibleHas', 'bibleById', 'bibleListOf', 'bibleHomeDoc', 'bibleFieldDefs', 'bibleMentions', 'bibleUi', 'bibleTouched', 'bibleBookArrived',
  'bibleOnLangChange', 'bibleRender', 'bibleRenderList', 'bibleRenderEntry', 'bibleRenderMentions', 'bibleRenderSeed', 'bibleRenderFields',
  'bibleRenderMerge', 'bibleRenderSeriesLine', 'bibleStatus', 'bibleNewEntry', 'bibleDelete', 'bibleOnField', 'bibleOnFact', 'bibleRenameField',
  'bibleAddField', 'bibleAddLink', 'bibleRemoveLink', 'bibleRemoveChange', 'bibleRemoveFieldUndoable', 'bibleApplyTemplate', 'bibleRefreshMore',
  'bibleRefreshCard', 'bibleSetFact', 'bibleSeedAdd', 'bibleSeedSync', 'bibleSeedCandidates', 'bibleSetMarks', 'bibleMarksOn', 'bibleExportDoc',
  'bibleExportName', 'bibleExport', 'bibleImportDoc', 'bibleImportReport', 'bibleCardEl', 'bibleCardHtml', 'bibleMarkOffered', 'bibleMarkChange',
  'bibleMarkOpen', 'bibleMarkSave', 'bibleMarkClose', 'bibleMarkMenuEl', 'bibleMarkHideMenu', 'bibleMarkPlace', 'bibleMark', 'bibleDotsCompute',
  'bibleCountsNow', 'bibleCountsHeld', 'bibleInSeries', 'bibleSeriesKey', 'bibleShelfScan', 'bibleSeriesRefresh', 'bibleSeriesSet', 'bibleSeriesSync',
  'bibleSeriesNet', 'bibleSeriesMem', 'bibleSeriesTouched', 'bibleSeriesStep', 'bibleSeriesSaveNow', 'bibleSeriesFlush', 'bibleSeriesSignOut',
  'bibleSeriesForget', 'bibleAuthSignedOut', 'bibleSeriesResolve', 'bibleSeriesRaise', 'bibleSeriesFlushOnHide', 'bibleJoinStart', 'bibleJoinDismiss',
  'bibleJoinOffered', 'bibleJoinMembers', 'bibleMergePlan', 'bibleMergeSave', 'bibleSetOnlyBook', 'bibleSeriesLeave', 'bibleSeriesRename',
  'bibleSeriesChangeAsk', 'bibleSeriesSettingsNote', 'bibleSeriesFree',
  // wave 4a (D1, D2): the Style tab (1.0's Typography Studio) and the theme creator / My themes — 1.0's own renderers and
  // handlers, drawing into the tab's ids and wired by 1.0's own initStudio (src/style); the presets, ornaments, fonts,
  // the book colour and its guard, flourish and font uploads, the header design
  'PRESETS', 'ORNAMENTS', 'ornamentSvg', 'renderStudio', 'syncStudioControls', 'initStudio', 'customTheme', 'renderFlourishes', 'flourishImages',
  'handleFlourishFile', 'removeFlourishImage', 'renderMyThemes', 'applyCustomTheme', 'duplicateCustomTheme', 'deleteCustomTheme', 'tcBaseOptions',
  'openThemeCreator', 'closeThemeCreator', 'tcReseedFromBase', 'buildCreatorControls', 'fillCreatorControls', 'tcSet', 'renderTcPreview',
  'saveThemeCreator', 'renderFonts', 'fontFamilyFromFile', 'handleFontFile', 'removeUploadedFont', 'fillFontSelects', 'refreshFontPickers',
  'registerUploadedFont', 'registerAllFonts', 'fontOptionsHtml', 'uploadedFonts', 'normalizeCustomTheme', 'normalizeHeaderDesign', 'defaultHeaderDesign',
  'COLOUR_ACCENTS', 'COLOUR_TINTS', 'bookColour', 'bookColourSet', 'bookColourNormalize', 'bookColourCheck', 'setBookColour', 'setBookPrintBlack',
  'renderBookColour', 'initBookColour', 'registeredFontIds', 'BODY_FONTS', 'HEAD_FONTS', 'ALL_LIBRARY_FONTS', 'TEXT_HEAD_FONTS', 'DISPLAY_FONTS', 'HD_KEYS', 'FLOURISH_PREFIX',
  // per-user themes (My themes): what a saved theme wears, resolved as 1.0 resolves it (already lifted for the tab)
  'uploadedFontByFamily', 'flourishOf', 'fontStack',
  // wave 4c (D3, D4): the cover maker, the spine and back, the hardcover's flaps and guides, the wrap, its 3D stand and
  // its download — 1.0's own painters (the same text the server's WRAP_CLOSURE lifts: test/cover-closure.test.ts), its
  // renderers and handlers, drawing into the maker's ids and wired by 1.0's own initCoverMaker (src/cover); Project
  // Settings' cover row (renderCoverSettings, clearCover)
  'initCoverMaker', 'openCoverMaker', 'drawMakerPreview', 'syncMakerControls', 'syncWrapControls', 'renderCoverSettings', 'clearCover', 'adoptCoverRecipe',
  'drawCoverTo', 'renderCoverCanvas', 'coverPrintSize', 'COVER_EBOOK_W', 'COVER_EBOOK_H', 'COVER_LAYOUTS', 'COVER_BG_TYPES', 'COVER_TEXTURES', 'COVER_FONTS',
  'COVER_PALETTE', 'COVER_FREE_POS', 'CM_ELEMENTS', 'coverImgCache', 'ensureCoverBgImage', 'ensureWrapIcons', 'hcEnsureFlapPhoto', 'coverLines',
  'drawWrapTo', 'renderWrapCanvas', 'wrapDims', 'wrapPictureIds', 'normalizeWrap', 'WRAP_PAPERS', 'HC_BINDINGS', 'hcLayout', 'hcDrawFlaps', 'hcDrawGuides',
  'TRIM_SIZES', 'trimSize', 'printPageEstimate', 'slug', 'downloadWrap', 'downloadCoverRender', 'buildWrapPdfDoc', 'wrapFileName',
  'w3', 'wrap3dFaces', 'wrap3dSource', 'refreshWrap3d', 'wrap3dPaint', 'sampleWrapRecipe', 'w3rot', 'w3proj', 'W3D_PERSP',
  'cmComputeBlocks', 'cmTitleKeywords', 'searchStockPhotos', 'cmRenderStockResults', 'choosePexelsPhoto', 'imCoverFollowBook', 'imBookCoverText',
  'hcTrimOffered', 'HC_SPEC', 'spineDirection', 'normalizeWrapSpine', 'normalizeWrapBack', 'wrapDefaults', 'stableJson',
  'setElText', 'sbBuildControls', 'sbSync', 'sbIconSvg', 'SB_CURATED_ICONS', 'hcSyncPanel', 'hcLegendHtml', 'updateWrapDims', 'drawWrapPreview', 'paintCoverScene',
  // wave 5a (F1, F7, F8): the export modal — 1.0's own initExport wires it (the later waves' parts reach supplied, inert
  // stand-ins: BROWSER_SUPPLIED), the platform presets and the package tree, the package itself (epubFiles; the browser's
  // buildEpubBlob, the same text as the server's EPUB_ROOTS: test/export-closure.test.ts), the store-ready download
  // (buildEpub: POST /api/epub), Markdown and standalone HTML, the package inspector, the structural validator, and the
  // accessibility audit with its conformance stamp
  'initExport', 'renderPlatformPresets', 'refreshExportTree', 'PLATFORM_PRESETS', 'platformPreset', 'platformFilename', 'epubPlan', 'epubFiles', 'buildEpubBlob',
  'buildEpub', 'buildMarkdown', 'buildStandaloneHtml', 'copyText', 'openInspector', 'selectInspFile', 'highlightCode', 'fileSize',
  'runValidation', 'validateEpubPackage', 'validationListHtml', 'BEUK_VALIDATOR_CODES', 'epubManifestPropertyReport', 'epubDetectProps', 'epubApplyManifestProperties',
  'epubLinksOutsideSpine', 'epubTocTarget', 'EPUB_DETECTED_PROPS', 'runA11yCheck', 'auditAccessibility', 'a11yFacts', 'a11yMetaBlock', 'a11yStampConformance',
  'a11ySummaryText', 'a11ySummaryDefault', 'A11Y_CONFORMS_VALUE', 'a11yJumpTo',
  // (already lifted for the package: named so the tests run 1.0's own script-face self-check, epub.fonts.script-embedded)
  'ensureScriptFonts', 'SCRIPT_FONTS', 'scriptFontData', 'bookScripts',
  // wave 5a: applyBookDoc's own normalizers, which 2.0's arrival for the export runs in applyBookDoc's order
  // (src/export/state.ts), so 1.0's serializeBook (closure-serialize.js) writes the body 1.0 sends
  'bookMetaDefaults', 'bookPrintDefaults', 'bookSeriesNumberInto', 'bookIdNormalizeLegacyList', 'imSetSource', 'castSetHidden', 'bodyFaceOf', 'bookColourNormalize',
  'olNormalize', 'rsNormalize', 'normalizeStoreCheck', 'normalizeGoals', 'normalizeImportReport', 'acxNormalize', 'msNormalize', 'dictNormalize', 'bibleNormalize', 'nbNormalize',
  // wave 5c (F3-F6): the rest of the export family, 1.0's own builders and dialogs — the Word document (buildDocxFiles,
  // downloadDocx), the box set (its plan, package and download, the list and its Remove, a backup made a volume:
  // localParseBackup + bookDocToVolume), the submission manuscript (its plan, package, download and dialog, wired by
  // msInit) and the ACX audio script (its plan and readiness checks, the zip, the pronunciation guide, the dialog, wired
  // by acxInit). Add a Book's import half stays supplied (BROWSER_SUPPLIED: boxSetExpandPick, manuscriptFileToVolume)
  'buildDocxFiles', 'buildDocxBlob', 'downloadDocx', 'docxRun', 'docxInlineRuns', 'docxPara', 'docxContentParas', 'buildDocxDocumentXml', 'buildDocxStylesXml',
  'buildDocxNumberingXml', 'docxDocumentRelsXml',
  'bookWord', 'boxSetVolumesAll', 'boxSetPlan', 'renderBoxSetEntry', 'boxSetTitle', 'boxSetFilename', 'boxSetFiles', 'buildBoxSetEpub', 'renderBoxSetList',
  'bookDocToVolume', 'boxSetVolumeMeta', 'boxSetNameTitle', 'localParseBackup',
  'msPlan', 'msRoundWords', 'msDocumentXml', 'msHeaderXml', 'msStylesXml', 'msFiles', 'msBlob', 'msFilename', 'msDownload', 'msSummaryHtml', 'msRender', 'msOpen', 'msInit',
  'acxBuildPlan', 'acxDetectCandidates', 'acxGuideRows', 'acxSetPron', 'acxZipEntries', 'acxBuildZipBlob', 'acxDownload', 'acxSummaryTxt', 'acxFileTxt', 'acxDocxFiles',
  'acxRender', 'acxOpen', 'acxInit', 'acxListen',
  // wave 5d (F10): the store-ready check, 1.0's own — the per-store rules (STORE_RULES, cited data), the audit (storeAudit:
  // its facts, rows, verdict and actions, storeServerReason / storeServerFix, storeFootnoteFallbacks), the report surface
  // (storeRowsHtml, renderStoreReport, buildStoreReportHtml, downloadStoreReport) and the modal's wiring (openStoreReady,
  // initStoreReady, storeAct, storeRunServer, storeRecheck). What it reads of print that the main closure did not hold
  // (printPlacements, imagePixelSize, printEdgeSections, printNotesAtFoot, preflightJumpTo) comes as their own copies of
  // 1.0's text. The shelf half is supplied (BROWSER_SUPPLIED: storeMakePrintJob and its three neighbours, wave 7)
  'STORE_TRIM_TOL', 'STORE_SPINE_TOL', 'STORE_RULES', 'STORE_IDS', 'storeUi', 'storeDefaults', 'storeInkId', 'storeIsTrim', 'storeTrimOnPaper', 'storeMatchTrim',
  'storeIn', 'storeTrimLabel', 'storeSpineClearance', 'storeFacts', 'storeBookSig', 'storeServerFresh', 'storeServerReason', 'STORE_CAUSE_FIX', 'storeServerFix',
  'storeFootnoteFallbacks', 'storeFontNames', 'storeAudit', 'STORE_ICON', 'storeVerdictText', 'storeFactsLine', 'storeRowsHtml', 'renderStoreReport', 'storeAct',
  'openStoreReady', 'storeRunServer', 'storeRecheck', 'buildStoreReportHtml', 'downloadStoreReport', 'initStoreReady',
  // (already lifted for the audit: named so the tests run 1.0's own store self-checks, studio/test/store-selfchecks.test.ts)
  'printPlacements', 'printEdgeSections', 'sectionLabel',
  // wave 6 (G1, G2): the import, 1.0's own (BEUK:onereader) — the one reader of every file (readImportFile: DOCX through
  // mammoth with the core-identity, language and XML scans; RTF; Markdown / text with YAML frontmatter; EPUB; PDF through
  // pdf.js), the Import button's path (handleImportFile: a zip of one manuscript, the refusals, importConfirmReplace, the
  // whole-book replace replaceBodyChapters), the sandboxed import of a file into a book (importSandboxed,
  // manuscriptFileToBookDoc: Add a Book's volumes, and wave 7's bulk import), the "Recognised in your manuscript" summary
  // and initImport; the import report (irBegin / irFinish record it; irRenderReport, irUndoItem, irUndoAll, irDismiss,
  // irOpenReport, irSyncReopen and initImportReport show and act on it); and Add a Book's import half (boxSetExpandPick,
  // manuscriptFileToVolume: 5c's stand-ins are gone). What 1.0's import reaches outside it is supplied (BROWSER_SUPPLIED)
  'readImportFile', 'handleImportFile', 'importConfirmReplace', 'importExpandZips', 'importSandboxed', 'manuscriptFileToBookDoc', 'replaceBodyChapters',
  'parseManuscript', 'importFoundList', 'renderImportSummary', 'initImport', 'initImportReport', 'irRenderReport', 'irUndoItem', 'irUndoAll',
  'irUndoAllAvailability', 'irDismiss', 'irOpenReport', 'irCloseReport', 'irSyncReopen', 'irAbort', 'boxSetExpandPick', 'manuscriptFileToVolume',
  'PDFJS_DIR', 'PDFJS_FILES', 'bulkIsManuscript', 'snapshotBookDoc', 'irOnLangChange',
  // wave 7a (H4): Keep both's snapshot of the shelf copy (1.0's snapshotForeignDoc), run on History's state of the open
  // book (src/cloud/cloud.ts): the cloud module reaches it supplied
  'snapshotForeignDoc',
  // (lifted for the series Covenant already: named so the shelf's raiseConflict reaches it through the api)
  'bibleSeriesModalReset',
  // wave 7b (G3): bulk import to the shelf, 1.0's own — each file read by the one reader (readImportFile), made a book on
  // a desk of its own (importSandboxed, inside bulkBuildBook), compared against the batch and the shelf, and created on
  // the shelf (bulkCreateShelfBook: POST /api/manuscripts); its summary, its chrome and its drop walk. It reads the open
  // book only through importSandboxed (the import session's, src/import/import.ts); the shelf's list, its reader of a
  // shelf copy and its reload are the shelf's module's (supplied)
  'startBulkImport', 'bulkPrepareEntries', 'bulkRunQueue', 'bulkBuildBook', 'bulkBatchContext', 'bulkShelfFingerprints', 'bulkCreateShelfBook',
  'renderBulkSummary', 'renderBulkChrome', 'bulkCollectDrop', 'bulkWalkEntry', 'bulkParseFrontmatter', 'bulkResolveVaultText', 'bulkHashText',
  'bulkFingerprint', 'bulkDocWords', 'bulkIsImage', 'bulkBusy',
  // (lifted already for the preview's inline Markdown: named so 1.0's bulk vault self-check reaches it through the api)
  'inlineMd',
  // locked review copy (design 2026-11-06), task 1: 1.0's PDF lock (BEUK:lockcopy) — AES-256 R6 over WebCrypto, and the
  // password's SASLprep; the download points that run them come in tasks 3 and 4
  'lockPdfBytes', 'lockSaslPrep',
  // task 2: the DOCX lock — ECMA-376 Agile encryption in a compound file, over WebCrypto
  'lockDocxBytes',
  // final review F4: the hand-written SHA-512's known-answer hooks (lockSha512Js is not called in production)
  'lockSha512Js', 'lockSha512Spin',
  // task 3: the lock controls and the download points' halves (the Word file and the manuscript reach them through
  // downloadDocx / msDownload; the print-ready PDF's dialog and the plan's day-22 note are named here, so the whole
  // BEUK:lockcopy block stands in the main closure as 1.0's text — the print and shelf modules lift their own copies)
  'lockFieldsRead', 'lockFieldsClear', 'lockCopyAllowed', 'lockFieldsRender', 'lockPlanNote', 'lockPdfOpen', 'lockedPdfDownload',
  // task 4, fixes 1-2: the access note at boot and after an in-tab sign-in (the shelf's module lifts its own copies)
  'lockAccessNote', 'lockAccessRefresh',
  // locked backups and the authorship record (design 2026-11-09), task 2: 1.0's BEUK:authorship — the book's fingerprint,
  // the plain backup with its authorship block, the locked envelope (PBKDF2 → AES-GCM over WebCrypto) and the backup
  // reader; the export and "Open a backup…" reach them in task 3
  'backupFingerprint', 'backupPayload', 'backupLock', 'backupUnlock', 'backupRead',
];

/** Wave 2c: lifted declarations that 1.0 fills by top-level statements right after them (TYPE_TITLES: the FRONT / BACK
 *  labels and the extra types). Every top-level expression statement of the studio that assigns into one of these is
 *  lifted too, in 1.0's order, after the declarations (ONE SOURCE: nothing retyped). */
export const ATTACH = ['TYPE_TITLES',
  // wave 4a: HEAD_FONTS gains the display faces (BEUK:displayfaces `HEAD_FONTS.push.apply(HEAD_FONTS, DISPLAY_FAMILIES)`),
  // between TEXT_HEAD_FONTS (taken before it) and ALL_LIBRARY_FONTS (taken after it): each ATTACH statement stands
  // where 1.0 has it, among the lifted declarations
  'HEAD_FONTS'];
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
export const VARS = ['insVarPick', 'insCache', 'insFacts',
  // wave 3b: the section 1.0's editor shows (the Covenant's caret position and margin dots read it), the series in hand
  'editorSyncedSectionId', 'bibleSeries', 'bibleAllVer', 'bibleSeriesArriveTimer',
  // wave 3a: the writing log, its clock and the Goals room's view state
  'wlog', 'wlogRebase', 'wlogLastTick', 'wlogFgOverride', 'goalJustWriteCache', 'goalKeptPeriod', 'goalCalCursor', 'roadState',
  // wave 3a: Zen's and dictation's test overrides and transition flag, 1.0's centre tab
  'zenTransitioning', 'zenReducedOverride', 'zdHiddenOv', 'dictCtorOverride', 'currentCenterTab',
  // wave 3a: the day cycle's clock state (1.0's window.beukZen.dayTimerActive / dayRunning)
  'zdTimer', 'zdStart',
  // wave 4a: the theme creator's draft and the font pickers' signature
  'tcDraft', 'fontPickerSig',
  // wave 4c: the cover maker's working recipe, its element and guides; and 1.0's functions whose promises resolve
  // later (a decoded picture), wrapped so their continuations run in the Style session (src/cover/cover.ts), and the
  // stock results' renderer, wrapped so a thumbnail the policy refuses is never asked for
  'cmRecipe', 'cmElement', 'cmWrapGuides', 'cmItems', 'cmBlocks', 'ensureCoverBgImage', 'hcEnsureFlapPhoto', 'ensureWrapIcons', 'cmRenderStockResults',
  // wave 5a: the package inspector's file set and the file it shows (1.0's #btnCopyFile reads them)
  'inspFilesCache', 'inspCurrent',
  // wave 5d: the cover maker's opener as 1.0's storeAct calls it ("Open the cover maker", inside the export session): the
  // studio points it at 2.0's own opener (src/cover/CoverMaker.tsx coverOpen: the maker on the Style session's state).
  // Its only other caller, initCoverMaker's #btnCoverMake listener, is a stand-in button (CoverMaker.tsx)
  'openCoverMaker',
  // wave 6: what 2.0 wraps around 1.0's import (src/import/import.ts importWire). readImportFile: the libraries first
  // (mammoth on the first .docx, pdf.js on the first .pdf, JSZip), and 1.0's synchronous step run in the import session
  // (the book written whole after it); importConfirmReplace: read on the open book's state; importSandboxed: on a state of
  // its own, with 1.0's quiet hooks — markWritingActivity, offerDetectedLanguage, renderImportSummary are 1.0's own
  // functions here, so its window[h] silencing reaches them through these setters; lastImportFound: the summary drawn
  // again over the new generation
  'readImportFile', 'importConfirmReplace', 'importSandboxed', 'markWritingActivity', 'offerDetectedLanguage', 'renderImportSummary', 'irOpenReport', 'lastImportFound',
  // Add a Book's import half (5c's stand-ins gone): 1.0's listener awaits these two and then adds the volume to the open
  // book's state, so their answers resume in the export session (src/import/import.ts)
  'manuscriptFileToVolume', 'boxSetExpandPick',
  // wave 7b (G3): bulkBuildBook runs in an import session (importSandboxed reads the open book's state to put it back
  // after; nothing is written: decision 2), and bulkBusy is read and reset by the studio around a batch
  'bulkBuildBook', 'bulkBusy'];
/** Wave 6: supplied names 1.0's lifted code assigns (importSandboxed restores `cloudDirty`): emitted as `let`. */
export const SUPPLIED_LETS = ['cloudDirty',
  // wave 7a: the cloud module's billingDate reads uiLangState as 1.0's string (toLocaleDateString's locale): 2.0 sets it
  // when the interface language changes (src/cloud/cloud.ts), through the module's vars
  'uiLangState'];
/** Names the browser studio supplies besides the EPUB build's. */
export const BROWSER_SUPPLIED = ['t', 'UI_STRINGS', 'getUiLang', 'deskState', 'deskSignature',
  // wave 2b (the image library): History's snapshot (2.0's own, history.ts), the edit counter a run of removals reads
  // (1.0's local.editSeq), and what 1.0 does after an edit (noteBookEdited, imglibRefresh: 2.0 re-renders from the
  // Y.Doc); 1.0's `cloud` as far as cmStockGate reads it (available, user). (Wave 3b lifts bibleSeriesTouched, which
  // wave 2b supplied as a no-op: the series Covenant is 1.0's own code now.)
  'autoSnapshot', 'local', 'noteBookEdited', 'imglibRefresh', 'cloud',
  // wave 2c: 1.0's redraws after a structural edit (React re-renders from the Y.Doc), and selectSection (2.0 selects the
  // section 1.0 chose once the change is written: src/structure/structure.ts structEnv). (Wave 5a lifts
  // refreshExportTree, which wave 2c supplied as a no-op: the export modal's tree is 1.0's own code now.)
  'renderSidebar', 'syncEditor', 'renderPreview', 'updateStats', 'selectSection', 'olRender',
  // wave 3a (C2): the shelf's heartbeat (1.0's cloudHeartbeat, src/goals/streak.ts), the calm confirm (2.0's useConfirm),
  // 1.0's icons() (drawIcons) and fmtDateIntl (it reads uiLangState, which the browser studio never lifts)
  'cloudHeartbeat', 'cloudConfirm', 'icons', 'fmtDateIntl',
  // wave 3a (A9-A11): 1.0's `$` (src/environment/page.ts: #editorArea is the open editor's stand-in, #panelContent the
  // desk's), activeSection (the open section of 1.0's state), setCenterTab (Zen is always the desk) and closeUiLangMenu
  '$', 'activeSection', 'setCenterTab', 'closeUiLangMenu',
  // wave 3b (C6): the shelf's transport (1.0's apiFetch: its guards and answer shapes, src/covenant/net.ts), 1.0's network
  // state (net.online), the shelf link's dirty flag (2.0 has no shelf link: false), the interface language as 1.0's
  // caches key on it (uiLangState, read live), the room's open (openBible: 2.0's Dialog), the Outline's follow-up after
  // the room closes (olOnStructure: React re-renders), and the desk mirror's entry points — 2.0 has no mirror, its marks
  // are ProseMirror decorations: bibleDeskRender / bibleDeskSchedule redraw them, bibleCardHide hides 2.0's card,
  // bibleOffsetY measures a text offset on the editor's page
  'apiFetch', 'net', 'cloudDirty', 'uiLangState', 'openBible', 'olOnStructure', 'bibleDeskRender', 'bibleDeskSchedule', 'bibleCardHide', 'bibleOffsetY',
  // wave 4a (D1): the chapter-art pickers' redraw after a flourish leaves the library (React re-renders them from the
  // Y.Doc), and the page's FileReader — the browser's own, whose load and error callbacks run inside the Style tab's
  // session (src/style/session.ts): 1.0's flourish and font uploads read their file and then edit the book's state
  'refreshImagePickers', 'FileReader',
  // wave 4c (D3, D4): the sample's pictures are always on 2.0's desk (1.0's BEUK:slim samplePicsHold: never holds),
  // 1.0's serializeBook (the wrap download sends the book as book format: 2.0's exportBook of the open book), its
  // downloadBlob (the cover and wrap files), and the page's fetch — the stock search and the chosen photo's download,
  // held to the addresses the served policy allows, a picture's bytes checked as 2.0's scene picker checks them
  // (src/cover/cover.ts coverFetch); same-origin requests pass through unchanged
  'samplePicsHold', 'serializeBook', 'downloadBlob', 'fetch',
  // wave 5a (F1, F7, F8): what 1.0's export code reaches outside the export — the sign-in dialog (wave 7: 2.0 has none;
  // buildEpub's own noOpen keeps the modal open), Project Settings (2.0's dialog) and the phone's pane switch (the
  // accessibility audit's "Take me there") — and the parts of 1.0's initExport that belong to later waves, inert
  // stand-ins here (their sections of the modal are hidden): the print preflight and controls (5b), Word and the box set
  // (5c), the archive (wave 7)
  'openAuth', 'openSettings', 'setMobilePane',
  // (wave 5c lifts downloadDocx, buildBoxSetEpub, renderBoxSetList and bookWord: 1.0's own now.) Add a Book's import half
  // stays supplied: a zip of books and a manuscript volume are 1.0's import (wave 6); 2.0's stand-ins read a Beuk backup
  // with 1.0's own localParseBackup and bookDocToVolume (src/export/state.ts volumeFromFile)
  'runPrintPreflight', 'renderPrintControls',
  'renderArchiveList', 'cloudLoadArchive',
  // review of 5c (Minor 2): the page's crypto, its digest resuming in the export session (src/closure/index.ts)
  'crypto',
  // wave 5d (F10): the store check's server half needs the book on the shelf (1.0's storeMakePrintJob → cloudEnsureLinked);
  // no shelf copy before wave 7, so the seam is 2.0's storeMakePrintJob, answering { needShelf: true } without a request
  // (src/print/print.ts shelfPrintJob, the same one 5b's print-ready panel uses); the three that would talk to the
  // server after a job exists are refusing stand-ins (no request: src/store/store.ts)
  'storeMakePrintJob', 'storeUpload', 'storeCreateJob', 'storeRefreshJobs',
  // wave 6 (G1, G2): what 1.0's import reaches outside the import (src/import/import.ts). applyBookDoc: 1.0's arrival of a
  // book on the desk — 2.0's re-typed data lines of it (src/export/state.ts arriveForExport) with its History, box-set
  // and import-summary rules; restoreSnapshot (Undo the whole import, its snapshot): History's restore (history.ts
  // restoreDoc); applySampleBookSync (its untouched sample): wave 1c's sample (sample.ts sampleArrival);
  // deskIsUntouchedSample: wave 1c's fingerprint, read when the import starts; renderSampleButton and refreshLangHint:
  // React re-renders the sample bar and Project Settings from the Y.Doc
  'applyBookDoc', 'restoreSnapshot', 'applySampleBookSync', 'deskIsUntouchedSample', 'renderSampleButton', 'refreshLangHint',
  // wave 7b (G3): what bulk import reaches of the shelf — its list (cloud.shelf is the one `cloud`) redrawn, a shelf copy
  // read for its fingerprint, the list loaded again after a batch: 1.0's own, in the shelf's module (src/cloud/cloud.ts)
  'renderShelfList', 'shelfGetBook', 'cloudLoadShelf'];
/** Wave 5a: 1.0's serializeBook, emitted as its own sub-module (closure-serialize.js, createSerialize(share)): the main
 *  closure keeps `serializeBook` SUPPLIED (the wrap download's book stays wave 4c's), and the export's request body is
 *  1.0's own serializeBook run on 1.0's state of the open book as applyBookDoc holds it (src/export/state.ts). */
export const SERIALIZE_ROOTS = ['serializeBook'];
/** Wave 4b (E1, E2): the preview's OWN module, src/generated/closure-preview.js (createPreviewClosure). 1.0's preview
 *  pane, its pagination and reading desk, the device frames and truth notes, the hardcover and full screen — lifted
 *  whole, beside their own copy of what they reach (sectionHtml, buildBookCss, the print view's model), with their own
 *  `state`, which only src/preview/preview.ts sets (the book read through the Style session's safe path). 1.0's
 *  timers in this code (the desk's chunks, the reader's frames, the font reloads, the hardcover's turns) therefore
 *  always run on the preview's state, never on a state another part of the studio set into the main closure. The
 *  main closure's renderPreview, deskState and deskSignature are this module's (BROWSER_SUPPLIED there). */
export const PREVIEW_ROOTS = ['renderPreview', 'queuePreview', 'initPreview', 'setDevice', 'measurePages', 'goToPage', 'fitDeviceFrame', 'renderDeviceDisplayNote',
  'deviceReadingArea', 'scheduleDeskUpdate', 'updateDesk', 'renderDesk', 'renderDeskFacts', 'computeDeskCountsSync', 'deskState', 'deskSignature', 'deskGoToSection',
  'pvLeaving', 'pvResume', 'pvShowTitle', 'pvFlush', 'pvPageOfAnchor', 'pvCaretAnchor', 'pvPageAnchor', 'previewPageAtX', 'keepOrnamentsWithText', 'undoOrnamentRepairs',
  'insGlancePages', 'statsPages', 'statsDeskReady', 'pageCountCache', 'sectionHtml', 'buildBookCss', 'pivEnsureStyle',
  'COL_GAP', 'DEVICE_FOOTERS', 'DEVICE_FACTS', 'DEVICE_NAMES', 'PAGE_GEOMETRY', 'DEVICE_DISPLAY', 'DISPLAY_RENDER',
  // E2: the hardcover and full screen
  'hc', 'hcInit', 'hcRender', 'hcOnDevice', 'hcOnPreview', 'hcSetOpen', 'hcTurn', 'hcKey', 'hcEnsureModel', 'hcSignature', 'hcLook',
  'fsInit', 'fsToggle', 'fsExit', 'fsIsOn', 'fsActive', 'fsState', 'fsLabelFor', 'fsScaleFrame', 'FS_TARGETS', 'syncFsButtons'];
/** What the preview module takes from its page and from the main studio (src/preview/preview.ts). */
export const PREVIEW_SUPPLIED = ['t', 'document', 'window', 'setTimeout', 'requestAnimationFrame',
  // wave 5b (constraint 63): the frame's ResizeObservers, disconnected when the pane goes (src/preview/preview.ts)
  'ResizeObserver', 'UI_STRINGS', 'getUiLang', 'uiLangState', 'fmtDateIntl', 'icons',
  // the page: `$` (the preview's ids, 1.0's #editorArea as a read-only view of the open editor), the open section
  '$', 'activeSection',
  // the main studio after a desk jump (deskGoToSection: 2.0 selects the section), Read Aloud and dictation (the main
  // closure's, stopped there), the print view (wave 5: nothing to redraw), and what 1.0's desk refreshes when it has
  // measured (statsPagesRefresh: 2.0 counts the sidebar again; 1.0's own insGlancePagesRefresh writes the Insights
  // glance's page card when the room is open)
  'renderSidebar', 'syncEditor', 'raStop', 'dictDiscard', 'renderPrintView', 'statsPagesRefresh',
  'noteBookEdited', 'autoSnapshot', 'local', 'cloud', 'refreshImagePickers', 'FileReader'];
/** 1.0's top-level lets of the preview module the studio reads or sets. */
export const PREVIEW_VARS = ['editorSyncedSectionId', 'editorTypedAt', 'pvFollow', 'pcFontGen', 'pvShownId', 'pvShownSec',
  // 1.0's printUnlink, through which every page of the open hardcover gets its HTML (pivSectionFlow): wrapped by the
  // flow sink (src/preview/preview.ts); and sidewaysPrintPages, which lays a sideways block's raw HTML out in a host
  // of its own on <body> before that (review round 2)
  'printUnlink', 'sidewaysPrintPages'];

/** Wave 5b (inventory F2, F9): print's OWN module, src/generated/closure-print.js (createPrintClosure). 1.0's print
 *  family — the print controls in the export modal (trims, margins, heads and folios, notes, large print, picture book,
 *  bleed, the omit toggles), the print frame and its browser print, Download Print HTML (buildPrintHtml, printFilename,
 *  preparePrintPress), the print-ready PDF's button and panel, the Print Interior View (the facing-page spreads,
 *  piv*) and the print preflight — lifted whole beside their own copy of what they reach, with their own `state`,
 *  which only src/print/print.ts sets: the export session's state of the open book (src/export/state.ts: 1.0's
 *  applyBookDoc state, corrected). 1.0's continuations in this code (the press bake's decodes, the interior view's
 *  font reload and resize, the pictures it warms first) therefore always run on the print's state. The main
 *  closure's renderPrintControls and runPrintPreflight (initExport calls them) are this module's. */
export const PRINT_ROOTS = ['initPrint', 'initPrintView', 'renderPrintControls', 'openPrintView', 'buildPrintHtml', 'printFilename', 'preparePrintPress',
  'printPressReport', 'trimSize', 'TRIM_SIZES', 'TRIM_GROUPS', 'printMargins', 'printPageEstimate', 'kdpGutterMin', 'printPictureBookOn', 'printBleedOn',
  'openPrintInteriorView', 'renderPrintView', 'pivRebuild', 'pivSyncChrome', 'buildPrintViewModel', 'piv', 'pivSpreadPages',
  'auditPrintInterior', 'runPrintPreflight', 'preflightJumpTo', 'printPlacements', 'imagePixelSize',
  'printReadyPdf', 'printReadyUi', 'printReadyRender',
  // what 1.0's print self-checks call (re-expressed in studio/test/print-selfchecks.test.ts): already lifted, named here
  // so the module hands them out
  'buildPrintCss', 'printTypeCss', 'pivGeometry', 'PIV_PX', 'inCss', 'cssStr', 'printHeadText', 'printFolioPos', 'trimOptionsHtml', 'pivEnsureStyle',
  'printSolidTintCss', 'printBlendHex', 'printSolidSvgHtml', 'printPressCss', 'PRINT_PAGE', 'PRINT_INK', 'printEdgeSections', 'printBleedConfig', 'kdpEdgeMin',
  'buildBookCss', 'printHeadsConfig', 'printBaseFontPt', 'printNotesAtFoot', 'isPairedSpread', 'printMarginsAuto', 'inBook', 'fontStack', 'labelFaceOf'];
/** What the print module takes from its page and from the main studio (src/print/print.ts). */
export const PRINT_SUPPLIED = ['t', 'document', 'window', 'setTimeout', 'requestAnimationFrame', 'ResizeObserver', 'UI_STRINGS', 'getUiLang', 'uiLangState',
  'fmtDateIntl', 'icons', '$', 'downloadBlob', 'samplePicsHold', 'samplePicsReady', 'Image',
  // the main closure's, in the export session: the audit's "Take me there" (preflight's section jumps), the sign-in
  // dialog (none before wave 7) and the shelf (the print-ready PDF's job: shelf-gated, see src/print/print.ts)
  'a11yJumpTo', 'openAuth', 'cloud', 'storeMakePrintJob', 'storeRefreshJobs', 'cloudLoadArchive',
  // what 1.0 refreshes after a print setting (the main closure's own): the store-ready report (wave 5d)
  'noteBookEdited', 'autoSnapshot', 'local', 'refreshImagePickers', 'FileReader'];
/** 1.0's top-level lets of the print module the studio reads or sets: the sinks (printUnlink, sidewaysPrintPages, as
 *  the preview's), and buildPrintHtml (the print document, checked as a whole before the frame or a file gets it). */
export const PRINT_VARS = ['printUnlink', 'sidewaysPrintPages', 'buildPrintHtml'];

/** Wave 7a (inventory H1-H4): the shelf's OWN module, src/generated/closure-cloud.js (createCloudClosure). 1.0's cloud
 *  code (client/index.html "cloud" to "Platform hardening", the reconciliation and conflict of its platform section,
 *  BEUK:local's reconcile on sign-in, and the store check's server half) lifted whole: the transport (apiFetch, its
 *  guards and answer shapes, the billing notice, the unreachable retry), the shelf pictures (BEUK:pics: stored once,
 *  hydrated from the desk), the probe, the dirty flag and the autosave (noteBookEdited, cloudAutosaveTick, the
 *  single-flight save with If-Match and its 409/428/404/413 answers), the sync line and the account button, the shelf
 *  list, its guard and the opening of a shelf book, the first sign-in's link or bring offer, the sign-in dialog
 *  (register, log in, forgot), sign out, the account box (change password, sign out everywhere), the portal line (the
 *  unconfirmed address and its resend), the plan line and its two redirects, the reconnect flush and the three-way
 *  conflict, and storeMakePrintJob with its three neighbours (the print-ready PDF and the store check's server jobs).
 *  Its `state` is 2.0's (src/cloud/cloud.ts: 1.0's state of the open book, read when 1.0's code reads it); the
 *  book's arrival, its serialization, History, the device record and the page's other parts are supplied. */
export const CLOUD_ROOTS = ['apiFetch', 'apiFetchReal', 'shelfPics', 'picPackForShelf', 'picHydrate', 'picLearnDesk', 'shelfGetBook', 'cloudProbe',
  'cloudNoteUnreachable', 'cloudGoLocal', 'noteBookEdited', 'cloudAutosaveTick', 'cloudQueueTick', 'cloudSaveNow', 'cloudSaveRun', 'setSyncStatus',
  'cloudSaveOwner', 'cloudSettleStatus', 'renderSyncLine', 'renderCloudChrome', 'renderAccountButton', 'cloudLoadStreak', 'cloudHeartbeat', 'cloudLoadShelf',
  'renderShelfList', 'deskHoldsUnshelvedWork', 'shelfGuardPutDeskOnShelf', 'cloudOpenBook', 'cloudAfterSignIn', 'cloudBringBook', 'setAuthMode', 'openAuth',
  'closeAuth', 'cloudAuthErrorText', 'cloudAuthSubmit', 'cloudSignOut', 'cloudEnsureLinked', 'acctAuthModeHook', 'acctForgotSubmit', 'acctSay',
  'acctChangePassword', 'acctSignOutEverywhere', 'portalTakeFreshSignIn', 'portalNote', 'portalRender', 'portalRefresh', 'portalResend', 'billingDate',
  // locked review copy (task 4, fix 1): the access /api/auth/me reports at boot, mirrored for the day-22 hide
  'lockAccessNote',
  'billingPlanRender', 'billingGo', 'billingNotePaused', 'planReconciliation', 'cloudReconnectFlush', 'raiseConflict', 'resolveConflict',
  'localReconcileOnSignIn', 'localLinkSnapshot', 'storeMakePrintJob', 'storeUpload', 'storeCreateJob', 'storeRefreshJobs', 'net', 'setConnectivity',
  'onReconnect', 'renderNetPill', 'bookDocsSame', 'bookIdsMatch', 'picIsRef', 'PIC_REF',
  // wave 7b: the archive list (H1's remainder) — the shelf's exports, a file saved there, and EPUBCheck on one
  'cloudLoadArchive', 'renderArchiveList', 'cloudArchiveExport', 'cloudRunEpubCheck', 'epubCheckResultHtml',
  // wave 7b (H7): beta readers, the author's side (BEUK:beta) — the share section in the export modal (create with its
  // expiry and comment settings, the list, copy, republish, revoke), the token kept on this device only
  // (beuk.betaTokens.v1), the sidebar's Comments button and the reader comments dialog (grouped by section, resolve,
  // reopen); the reader's page is the server's (/read) and is not here
  'BETA_TOKENS_KEY', 'beta', 'betaTokens', 'betaRememberToken', 'betaLinkFor', 'betaGate', 'betaInjectStyles', 'betaInjectDom', 'betaFmtDate',
  'betaRenderButton', 'betaRenderSection', 'betaLoadShares', 'betaCreate', 'betaCopy', 'betaOnClick', 'betaSectionName', 'betaRenderComments',
  'betaLoadComments', 'betaOpenComments', 'betaCloseComments', 'betaLocate', 'betaOnCommentsClick', 'betaRenderChrome', 'betaOnLangChange',
  // named reading links (premium 2, BEUK:named-links): a Readers disclosure per open copy — add a reader (name, expiry),
  // Copy/Close each reader's link, Close the open link; the readers' tokens kept on this device (beuk.betaReaderTokens.v1)
  'BETA_READER_TOKENS_KEY', 'BETA_READERS_MAX', 'betaReaderTokens', 'betaRememberReaderToken', 'betaNamed', 'betaRenderReaders', 'betaLoadReaders',
  'betaAddReader', 'betaCloseReader', 'betaCloseOpen', 'betaStampDate',
  // wave 7b (H5): the platform's install area and update bar (1.0's pwa record, isStandalone, renderInstallArea,
  // showUpdateBar, wireUpdateFlow, pwaOnLangChange); the worker is 2.0's own (public/sw.js, scope /next/), its listeners
  // 1.0's initPlatform lines (src/cloud/platform.ts)
  'pwa', 'isStandalone', 'renderInstallArea', 'pwaOnLangChange', 'showUpdateBar', 'wireUpdateFlow',
  // wave 7b (I9): the opt-in error report (BEUK:errors, BEUK:errscrub) — off unless beuk.errors.v1 is "on"; the message
  // and stack scrubbed of addresses, e-mails, ids, tokens, long quotes and file names; at most five a page, each once;
  // sent without cookies to POST /api/client-errors. Its window listeners are 1.0's lines (src/cloud/platform.ts)
  'BEUK_ERRORS_KEY', 'BEUK_ERR_MAX', 'beukErrorsOn', 'beukErrScrub', 'beukErrDevice', 'beukReportError', 'beukErrBuild', 'beukErrCount', 'beukErrSeen'];

/** What the cloud module takes from its page and from the rest of the studio (src/cloud/cloud.ts). */
export const CLOUD_SUPPLIED = ['t', 'UI_STRINGS', 'uiLangState', '$', 'icons', 'fmtDateIntl', 'location', 'setTimeout', 'setInterval',
  // the one `cloud` (src/closure/index.ts cloudFacts: every module reads the same object)
  'cloud',
  // the open book: 1.0's serializeBook of it, a whole book arriving on the desk (the backup-open path: a new generation),
  // History (a snapshot of the desk, a shelf copy kept as a snapshot), the empty-desk and untouched-sample tests
  'serializeBook', 'applyBookDoc', 'takeSnapshot', 'snapshotForeignDoc', 'pruneAutoSnapshots', 'isEmptyDesk', 'deskIsUntouchedSample',
  // the sample's pictures and its record (always on 2.0's desk; the record is per generation), the sample bar
  'samplePicsMissingInState', 'samplePicsEnsure', 'sampleSweepPreRename', 'sampleState', 'renderSampleButton',
  // the device record (1.0's BEUK:local): 2.0's link store beside the book (src/cloud/cloud.ts)
  'local', 'localRestorePromise', 'localMarkDirty', 'localWriteLinkNow', 'localNoteLinkChanged', 'localNoteSignedOut', 'localFailed',
  // the rest of the page: the editor's focus, the streak, the series Covenant (the main closure's), wave 7b's parts
  // (bulk import, beta links, the archive) and the print-ready panel's job record (print's module)
  'focusEditor', 'renderStreak', 'bibleSeriesFlush', 'bibleSeriesRefresh', 'bibleSeriesSignOut', 'bibleSeriesModalReset', 'bibleSeriesResolve',
  'renderBulkChrome', 'printReadyUi',
  // wave 7b (H7): a comment's "Jump to paragraph" lands in 2.0's editor (1.0's betaJump drives its textarea): 2.0's own
  'betaJump',

  // the calm confirm (2.0's useConfirm, 1.0's cloudConfirm), and the print file storeMakePrintJob uploads (print's module,
  // in the export session)
  'cloudConfirm', 'buildPrintHtml', 'preparePrintPress', 'printFilename',
  // the picture hash worker (1.0's page-relative assets/pichash.js, from /next/)
  'Worker'];
/** 1.0's top-level lets of the cloud module the studio reads or sets. */
export const CLOUD_VARS = ['uiLangState', 'cloudDirty', 'cloudSaveTimer', 'cloudRetryTimer', 'cloudSaveInFlight', 'cloudSaveFollowUp', 'authMode', 'portalFreshSignIn', 'billingPausedSaid',
  // wave 7b (I9): the error report's build stamp (the worker's BEUK_SHELL_READY) and its count (tests: a fresh page)
  'beukErrBuild', 'beukErrCount'];

/** Lifted declarations that may read the supplied FileReader (the Style tab's two uploads). */
export const FILEREADER_READERS = ['handleFlourishFile', 'handleFontFile',
  // wave 4c: the cover maker's uploads (its art, the back flap's photo, an uploaded spine icon) and the chosen stock photo
  'initCoverMaker', 'hcWireControls', 'sbWire', 'choosePexelsPhoto',
  // wave 7b (G3): bulk import reads a batch's pictures (bulkFileToData: .png / .jpg as base64 for a vault's embeds); its
  // callback goes on with the queue, whose shelf steps are promise callbacks of their own (nothing of the Style tab's)
  'bulkFileToData'];

/** Review round 2 (Minor 5): the session's cleaner wraps only what 1.0's `$` hands out (src/style/session.ts guarded()).
 *  A lifted cover-maker function (client/index.html "Cover maker" to "EPUB 3.2 packaging", and renderCoverSettings)
 *  may write HTML (innerHTML, outerHTML, insertAdjacentHTML) only into a `$()` result — directly, through a local set
 *  from one, or a conditional of two — except at these known-safe sites:
 *  - sbRenderGrid: the icon grid, from Lucide's own icon nodes (sbIconSvg, every attribute esc()'d) and esc()'d names;
 *  - sbSync: the spine icon's preview, sbIconSvg of a name lucideKey has held to a Lucide key, or a fixed <i>. */
export const COVER_HTML_SAFE = ['sbRenderGrid', 'sbSync'];
const COVER_FROM = '/* ================= Cover maker', COVER_TO = '/* ================= EPUB 3.2 packaging';
/** The top-level names 1.0 declares in its cover-maker section (and renderCoverSettings). */
export function coverSectionNames(html) {
  const a = html.indexOf(COVER_FROM), b = html.indexOf(COVER_TO, a);
  if (a < 0 || b < 0) fail("client/index.html no longer has its cover maker section's markers");
  const sf = ts.createSourceFile('cover.js', html.slice(a, b), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) out.push(st.name.text);
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text);
  }
  return [...out, 'renderCoverSettings'];
}
/** Every HTML write in the named declarations of `code` (a module or createClosure's body), sorted by its receiver. */
export function coverHtmlSinks(code, fns = coverSectionNames(readFileSync(path.join(REPO, 'client', 'index.html'), 'utf8'))) {
  const sf = ts.createSourceFile('closure.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const want = new Set(fns);
  const tops = [];
  const collect = (list) => {
    for (const st of list) {
      if (ts.isFunctionDeclaration(st) && st.name && want.has(st.name.text)) tops.push(st);
      else if (ts.isFunctionDeclaration(st) && st.name && st.name.text === 'createClosure' && st.body) collect(st.body.statements);
    }
  };
  collect(sf.statements);
  const out = { guarded: 0, allowed: [], unguarded: [] };
  for (const fn of tops) {
    const name = fn.name.text;
    const locals = new Map();
    const scan = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) (locals.get(n.name.text) || locals.set(n.name.text, []).get(n.name.text)).push(n.initializer);
      ts.forEachChild(n, scan);
    };
    scan(fn);
    const isDollar = (e, seen = new Set()) => {
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === '$') return true;
      if (ts.isConditionalExpression(e)) return isDollar(e.whenTrue, seen) && isDollar(e.whenFalse, seen);
      if (ts.isIdentifier(e) && locals.has(e.text) && !seen.has(e.text)) {
        seen.add(e.text);
        return locals.get(e.text).every((i) => isDollar(i, seen));
      }
      return false;
    };
    const walk = (n) => {
      let recv = null, sink = '';
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && /^(innerHTML|outerHTML)$/.test(n.left.name.text)) {
        recv = n.left.expression;
        sink = n.left.name.text;
      } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'insertAdjacentHTML') {
        recv = n.expression.expression;
        sink = 'insertAdjacentHTML';
      }
      if (recv) {
        if (isDollar(recv)) out.guarded++;
        else (COVER_HTML_SAFE.includes(name) ? out.allowed : out.unguarded).push({ fn: name, sink, at: recv.getText(sf).slice(0, 80) });
      }
      ts.forEachChild(n, walk);
    };
    walk(fn);
  }
  return out;
}
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
  // wave 5a: serializeBook is a supplied name of the main closure, its own declaration here
  const serializeNames = reachableFrom(html, SERIALIZE_ROOTS, [...supplied.filter((n) => !SERIALIZE_ROOTS.includes(n)), ...LOCAL_ONLY, ...names]);
  const forbidden = [...names, ...sampleNames, ...oracleNames, ...serializeNames].filter((n) => FORBIDDEN.test(n));
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
  // wave 4a: the supplied FileReader runs its callbacks in the Style tab's session: only the Style tab's uploads may read it
  const fileReaders = [];
  for (const st of lifted.statements) {
    let hit = false;
    const walk = (n) => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === 'FileReader') hit = true;
      else ts.forEachChild(n, walk);
    };
    walk(st);
    if (hit) fileReaders.push(declName(st.getText(lifted)) || '(unnamed)');
  }
  const strayFile = fileReaders.filter((n) => !FILEREADER_READERS.includes(n));
  if (strayFile.length) fail(`FileReader is read by ${strayFile.join(', ')}: only ${FILEREADER_READERS.join(', ')} may (its callbacks run in the Style tab's session)`);
  // review round 2 (Minor 5): the cover maker writes HTML only into what the session's cleaner wraps
  const sinks = coverHtmlSinks(src.code, coverSectionNames(html));
  if (sinks.unguarded.length) fail(`the cover maker writes HTML into elements the session's cleaner does not wrap (not a $() result): ${sinks.unguarded.map((x) => x.fn + ' ' + x.sink + ' on ' + x.at).join('; ')}`);
  // each ATTACH statement where 1.0 has it, among the lifted declarations (extractStudioSource keeps them in 1.0's order)
  const code = attach.place(src.code, src.names);
  const api = [...new Set(roots)].filter((n) => src.names.includes(n));
  const sample = sampleModule(extractStudioSource, html, sampleNames, src.names, supplied);
  const oracle = subModule(extractStudioSource, html, oracleNames, src.names, supplied, {
    label: 'ORACLE_ROOTS', roots: ORACLE_ROOTS, env: ORACLE_SUPPLIED, fn: 'createOracle', namesConst: 'ORACLE_NAMES',
    about: "1.0's dialog handlers (ORACLE_ROOTS), for the tests only: the app never imports this module",
  });
  const serialize = subModule(extractStudioSource, html, serializeNames, src.names, supplied, {
    label: 'SERIALIZE_ROOTS', roots: SERIALIZE_ROOTS, env: [], fn: 'createSerialize', namesConst: 'SERIALIZE_NAMES',
    about: "1.0's serializeBook (SERIALIZE_ROOTS), the export's request body (wave 5a)",
  });
  const serializeOwn = serialize.names.filter((n) => !SERIALIZE_ROOTS.includes(n));
  if (serializeOwn.length) fail(`serializeBook reaches ${serializeOwn.join(', ')}, which the main closure does not lift (add them to EXTRA_ROOTS: one copy of each)`);
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
    ...supplied.filter((n) => n !== 'state').map((n) => `  ${SUPPLIED_LETS.includes(n) ? 'let' : 'const'} ${n} = env.${n};`),
  ].join('\n');
  const tail = [
    '',
    `  const vars = { ${vars.map((v) => `get ${v}() { return ${v}; }, set ${v}(v) { ${v} = v; }`).join(', ')} };`,
    `  const share = { get state() { return state; }, ${[...new Set([...sample.uses, ...oracle.uses, ...serialize.uses])].map((n) => `get ${n}() { return ${n}; }`).join(', ')} };`,
    `  return { api: { ${api.join(', ')} }, vars, share, setState: (s) => { state = s; }, getState: () => state, arrive: ${spec.ARRIVE} };`,
    '}',
    '',
  ].join('\n');
  const missingAttach = ATTACH.filter((n) => !src.names.includes(n) || !attach.byName[n]);
  if (missingAttach.length) fail(`ATTACH names no lifted declaration filled by a top-level statement: ${missingAttach.join(', ')}`);
  return { code: head + '\n' + code + tail, names: src.names, roots: api, supplied, sample, oracle, serialize };
}

/** Wave 4b: the preview's own module (PREVIEW_ROOTS): createPreviewClosure(env) → { api, vars, setState, getState }. */
export function buildPreviewModule(html, epubSource) {
  return buildOwnModule(html, epubSource, {
    roots: PREVIEW_ROOTS, suppliedOwn: PREVIEW_SUPPLIED, varsOwn: PREVIEW_VARS, what: 'preview', file: 'closure-preview.js', prefix: 'PREVIEW',
    fn: 'createPreviewClosure', title: 'The preview (wave 4b)',
  });
}
/** Wave 5b: print's own module (PRINT_ROOTS): createPrintClosure(env) → { api, vars, setState, getState }. */
export function buildPrintModule(html, epubSource) {
  return buildOwnModule(html, epubSource, {
    roots: PRINT_ROOTS, suppliedOwn: PRINT_SUPPLIED, varsOwn: PRINT_VARS, what: 'print', file: 'closure-print.js', prefix: 'PRINT',
    fn: 'createPrintClosure', title: 'Print (wave 5b)',
  });
}
/** Wave 7a: the shelf's own module (CLOUD_ROOTS): createCloudClosure(env) → { api, vars, setState, getState }. */
export function buildCloudModule(html, epubSource) {
  return buildOwnModule(html, epubSource, {
    roots: CLOUD_ROOTS, suppliedOwn: CLOUD_SUPPLIED, varsOwn: CLOUD_VARS, what: 'cloud', file: 'closure-cloud.js', prefix: 'CLOUD',
    fn: 'createCloudClosure', title: 'The shelf (wave 7a)',
  });
}
/** A module of its own (the preview's, print's): its roots' declarations and everything they reach, with its own
 *  `state` and its own supplied names. */
async function buildOwnModule(html, epubSource, o) {
  const { extractStudioSource, reachableFrom } = await studioClosure();
  const spec = epubSpec(epubSource);
  const supplied = [...spec.EPUB_SUPPLIED, ...o.suppliedOwn];
  const attach = await attachStatements(html);
  let names = reachableFrom(html, o.roots, [...supplied, ...LOCAL_ONLY]);
  // an ATTACH declaration the module reaches brings the statements that fill it, and what those read
  const reached = ATTACH.filter((n) => names.includes(n));
  if (reached.length) names = reachableFrom(html, [...o.roots, ...reached.flatMap((n) => attach.refsOf[n] || [])], [...supplied, ...LOCAL_ONLY]);
  const forbidden = names.filter((n) => FORBIDDEN.test(n));
  if (forbidden.length) fail(`the ${o.what} module reaches ${forbidden.join(', ')}, which the browser studio does not lift (supply it in ${o.prefix}_SUPPLIED)`);
  let src;
  try {
    src = extractStudioSource(html, [...new Set([...o.roots, ...names])], { listRef: `studio/scripts/extract-closure.mjs ${o.prefix}_ROOTS`, api: '', stringTables: false });
  } catch (e) {
    fail(e.message);
  }
  for (const n of LOCAL_ONLY) {
    if (src.names.includes(n) || new RegExp('(^|[^\\w$.])' + n + '\\s*\\(').test(src.code)) fail(`${n} is in LOCAL_ONLY but the ${o.what} code declares or calls it`);
  }
  const lifted = ts.createSourceFile(o.file, src.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const [name, allowed] of [['UI_STRINGS', UI_STRINGS_READERS], ['FileReader', o.fileReaders || []]]) {
    const readers = [];
    for (const st of lifted.statements) {
      let hit = false;
      const walk = (n) => {
        if (hit) return;
        if (ts.isIdentifier(n) && n.text === name) hit = true;
        else ts.forEachChild(n, walk);
      };
      walk(st);
      if (hit) readers.push(declName(st.getText(lifted)) || '(unnamed)');
    }
    const stray = readers.filter((n) => !allowed.includes(n));
    if (stray.length) fail(`the ${o.what} module reads ${name} in ${stray.join(', ')}`);
  }
  const code = attach.place(src.code, src.names);
  const api = o.roots.filter((n) => src.names.includes(n));
  const missingRoots = o.roots.filter((n) => !src.names.includes(n));
  if (missingRoots.length) fail(`${o.prefix}_ROOTS names no lifted declaration: ${missingRoots.join(', ')}`);
  // wave 7a: a supplied let (SUPPLIED_LETS) of this module may be a VAR too (its setter re-assigns the module's own copy)
  const ownLet = (n) => SUPPLIED_LETS.includes(n) && supplied.includes(n);
  const vars = o.varsOwn.filter((n) => src.names.includes(n) || ownLet(n));
  const unlifted = o.varsOwn.filter((n) => !src.names.includes(n) && !ownLet(n));
  if (unlifted.length) fail(`${o.prefix}_VARS names no lifted declaration: ${unlifted.join(', ')}`);
  // wave 5b: a VAR gets a setter, so it must be a let or a function (a const cannot be re-assigned: the build refuses it)
  const consts = vars.filter((v) => new RegExp('^const\\s+' + v + '\\b', 'm').test(src.code));
  if (consts.length) fail(`${o.prefix}_VARS names a const: ${consts.join(', ')} (its setter could not re-assign it)`);
  const head = [
    '/* GENERATED by studio/scripts/extract-closure.mjs from client/index.html — do not edit.',
    `   ${o.title}: ${src.names.length} top-level declarations (${src.lines} lines) of 1.0's own code, reached from ${o.prefix}_ROOTS;`,
    `   studio sha256 ${src.studioSha}. */`,
    '/* eslint-disable */',
    `export const ${o.prefix}_NAMES = ${JSON.stringify(src.names)};`,
    `export const ${o.prefix}_API = ${JSON.stringify(api)};`,
    `export const ${o.prefix}_SUPPLIED_NAMES = ${JSON.stringify(supplied)};`,
    `export function ${o.fn}(env) {`,
    '  let state = env.state;',
    ...supplied.filter((n) => n !== 'state').map((n) => `  ${SUPPLIED_LETS.includes(n) ? 'let' : 'const'} ${n} = env.${n};`),
  ].join('\n');
  const tail = [
    '',
    `  const vars = { ${vars.map((v) => `get ${v}() { return ${v}; }, set ${v}(v) { ${v} = v; }`).join(', ')} };`,
    `  return { api: { ${api.join(', ')} }, vars, setState: (s) => { state = s; }, getState: () => state };`,
    '}',
    '',
  ].join('\n');
  return { code: head + '\n' + code + tail, names: src.names, roots: api, supplied };
}

/** The top-level expression statements that assign into an ATTACH name (in studio order), and the names they read. */
async function attachStatements(html) {
  const { studioScript } = await studioClosure();
  const sf = ts.createSourceFile('studio.js', studioScript(html), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const rootOf = (x) => {
    while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
    return ts.isIdentifier(x) ? x.text : '';
  };
  const parts = [], refs = new Set(), byName = {}, refsOf = {};
  const isAttach = new Set();
  const targetOf = new Map();
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st)) continue;
    let target = null;
    const walk = (n) => {
      if (target) return;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ATTACH.includes(rootOf(n.left))) target = rootOf(n.left);
      // wave 4a: a push into one (HEAD_FONTS.push.apply(HEAD_FONTS, …))
      else if (ts.isCallExpression(n) && ATTACH.includes(rootOf(n.expression)) && /\.push(\.apply)?$/.test(n.expression.getText(sf))) target = rootOf(n.expression);
      else ts.forEachChild(n, walk);
    };
    walk(st);
    if (!target) continue;
    byName[target] = true;
    isAttach.add(st);
    targetOf.set(st, target);
    parts.push(st.getText(sf));
    const collect = (n) => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isKey = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
        if (!isKey) {
          refs.add(n.text);
          (refsOf[target] ||= []).push(n.text);
        }
      }
      ts.forEachChild(n, collect);
    };
    collect(st);
  }
  const declOf = (st) => {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text];
    if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
    return [];
  };
  /** The lifted code (extractStudioSource's: its statements joined by "\n", in 1.0's order) with each ATTACH statement
   *  put back between the lifted declarations that stand around it in 1.0. Fails if the lifted statements, re-read
   *  here, are not exactly what extractStudioSource emitted. */
  const place = (liftedCode, names) => {
    const want = new Set(names);
    const all = [], own = [];
    for (const st of sf.statements) {
      if (isAttach.has(st)) {
        if (want.has(targetOf.get(st))) all.push(st.getText(sf)); // wave 4b: only where its declaration is lifted
      }
      else if (declOf(st).some((n) => want.has(n))) {
        all.push(st.getText(sf));
        own.push(st.getText(sf));
      }
    }
    if (own.join('\n') !== liftedCode) fail('the lifted declarations, re-read to place the ATTACH statements, differ from what extractStudioSource emitted');
    return all.join('\n');
  };
  return { code: parts.join('\n'), refs: [...refs], refsOf, byName, place };
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
export type ClosureEnv = { state: unknown; toast: (msg: string, icon?: string) => void; samplePicsRequire: () => Promise<unknown>; JSZip: unknown; t: (key: string, params?: Record<string, unknown>) => string; UI_STRINGS: Record<string, Record<string, string>>; getUiLang: () => string; deskState: unknown; deskSignature: () => string; autoSnapshot: (kind: string) => unknown; local: { readonly editSeq: number }; noteBookEdited: () => void; imglibRefresh: () => void; cloud: { available: boolean; user: unknown }; renderSidebar: () => void; syncEditor: () => void; renderPreview: () => void; updateStats: () => void; selectSection: (id: string) => void; olRender: () => void; cloudHeartbeat: () => void; cloudConfirm: (o: Record<string, unknown>) => Promise<unknown>; icons: () => void; fmtDateIntl: (d: Date) => string; $: (id: string) => any; activeSection: () => unknown; setCenterTab: (tab: string) => void; closeUiLangMenu: () => void; apiFetch: (path: string, opts?: Record<string, unknown>) => unknown; net: { readonly online: boolean }; cloudDirty: boolean; uiLangState: unknown; openBible: (id?: string) => void; olOnStructure: () => void; bibleDeskRender: (force?: boolean) => void; bibleDeskSchedule: () => void; bibleCardHide: () => void; bibleOffsetY: (area: unknown, offset: number) => number; refreshImagePickers: () => void; FileReader: unknown; samplePicsHold: (retry: () => unknown) => boolean; serializeBook: () => Record<string, unknown>; downloadBlob: (blob: Blob, name: string) => void; fetch: typeof fetch; openAuth: () => void; openSettings: () => void; setMobilePane: (pane: string) => void; runPrintPreflight: () => void; renderPrintControls: () => void; renderArchiveList: () => void; cloudLoadArchive: () => unknown; crypto: unknown; storeMakePrintJob: (o?: unknown) => Promise<unknown>; storeUpload: (...a: unknown[]) => Promise<unknown>; storeCreateJob: (...a: unknown[]) => Promise<unknown>; storeRefreshJobs: (out: unknown) => Promise<boolean>; applyBookDoc: (doc: unknown, opts?: unknown) => boolean; restoreSnapshot: (id: string) => boolean; applySampleBookSync: () => void; deskIsUntouchedSample: () => boolean; renderSampleButton: () => void; refreshLangHint: () => void; renderShelfList: () => void; shelfGetBook: (id: string, hydrate: boolean) => Promise<unknown>; cloudLoadShelf: () => unknown };
export declare function createClosure(env: ClosureEnv): { api: Record<string, (...args: any[]) => any> & Record<string, any>; vars: Record<string, any>; share: Record<string, unknown>; setState(s: unknown): void; getState(): any; arrive(s: unknown): any };
`;

const SAMPLE_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. */
export declare const SAMPLE_NAMES: string[];
export declare function createSample(share: Record<string, unknown>): { buildSampleBook: () => any; sampleCoverDoc: () => any };
`;

const PREVIEW_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. The preview (wave 4b). */
export declare const PREVIEW_NAMES: string[];
export declare const PREVIEW_API: string[];
export declare const PREVIEW_SUPPLIED_NAMES: string[];
export declare function createPreviewClosure(env: Record<string, unknown>): { api: Record<string, (...args: any[]) => any> & Record<string, any>; vars: Record<string, any>; setState(s: unknown): void; getState(): any };
`;

const PRINT_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. Print (wave 5b). */
export declare const PRINT_NAMES: string[];
export declare const PRINT_API: string[];
export declare const PRINT_SUPPLIED_NAMES: string[];
export declare function createPrintClosure(env: Record<string, unknown>): { api: Record<string, (...args: any[]) => any> & Record<string, any>; vars: Record<string, any>; setState(s: unknown): void; getState(): any };
`;

const CLOUD_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. The shelf (wave 7a). */
export declare const CLOUD_NAMES: string[];
export declare const CLOUD_API: string[];
export declare const CLOUD_SUPPLIED_NAMES: string[];
export declare function createCloudClosure(env: Record<string, unknown>): { api: Record<string, (...args: any[]) => any> & Record<string, any>; vars: Record<string, any>; setState(s: unknown): void; getState(): any };
`;

const SERIALIZE_DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. Wave 5a: 1.0's serializeBook. */
export declare const SERIALIZE_NAMES: string[];
export declare function createSerialize(share: Record<string, unknown>): { serializeBook: () => Record<string, unknown> };
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
  writeFileSync(path.join(dir, 'closure-serialize.js'), out.serialize.code);
  writeFileSync(path.join(dir, 'closure-serialize.d.ts'), SERIALIZE_DTS);
  const pv = await buildPreviewModule(html, epub);
  writeFileSync(path.join(dir, 'closure-preview.js'), pv.code);
  writeFileSync(path.join(dir, 'closure-preview.d.ts'), PREVIEW_DTS);
  out.preview = pv;
  const pr = await buildPrintModule(html, epub);
  writeFileSync(path.join(dir, 'closure-print.js'), pr.code);
  writeFileSync(path.join(dir, 'closure-print.d.ts'), PRINT_DTS);
  out.print = pr;
  const cl = await buildCloudModule(html, epub);
  writeFileSync(path.join(dir, 'closure-cloud.js'), cl.code);
  writeFileSync(path.join(dir, 'closure-cloud.d.ts'), CLOUD_DTS);
  out.cloud = cl;
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeClosure()
    .then((o) => console.log(`extract-closure: ${o.names.length} declarations, ${o.roots.length} roots → src/generated/closure.js; the sample: ${o.sample.names.length} → closure-sample.js; the test oracle: ${o.oracle.names.length} → closure-oracle.js; the preview: ${o.preview.names.length} → closure-preview.js; print: ${o.print.names.length} → closure-print.js; the shelf: ${o.cloud.names.length} → closure-cloud.js`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

/** Wave 6, for the tests only (studio/test/import-oracle.ts): a module of its own from any roots, its supplied names
 *  passed in — 1.0's own applyBookDoc, serializeBook, History and import, with only its redraws stubbed, as the import's
 *  oracle in Node. Never emitted into src/generated, never imported by the app. */
export function buildTestModule(html, epubSource, o) {
  return buildOwnModule(html, epubSource, { roots: o.roots, suppliedOwn: o.supplied, varsOwn: o.vars || [], what: o.what, file: o.what + '.js', prefix: o.prefix, fn: o.fn, title: o.title, fileReaders: o.fileReaders });
}
