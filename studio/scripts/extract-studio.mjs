#!/usr/bin/env node
/* Beuk 2.0 studio — ONE SOURCE during the port (step 4, part A).
   1.0's client/index.html keeps the interface strings and the theme
   tokens until 1.0 retires. This build step lifts them out into files
   the React app imports, so there is never a second copy to drift:

     src/generated/packs/<code>.json   every UI_STRINGS pack after all merges
     src/generated/strings-meta.json   UI_LANG_ORDER / UI_LANG_NAMES,
                                 UI_PLURAL_FORMS, the RTL interface
                                 languages (LANG_PACKS[code].rtl) and
                                 1.0's two localStorage keys
     src/generated/tokens.css    the :root and :root[data-theme="candlelight"]
                                 custom-property blocks, verbatim
     src/generated/icons.json    the Lucide icons the shell draws, from
                                 1.0's vendored lucide.min.js

   The string tables are selected with src/book/studio/closure.ts (the
   same TypeScript-AST selection the server's EPUB and cover builds and
   tests/localization.test.ts use) — no second parser. Anything missing,
   renamed or empty fails the build with a message naming it; it never
   ships empty strings. Both directories are gitignored. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { writeClosure } from './extract-closure.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(STUDIO, '..');

/** The declarations the app needs besides the string tables. */
const NAMES = ['UI_LANG_KEY', 'THEME_KEY', 'UI_STRINGS', 'UI_LANG_ORDER', 'UI_LANG_NAMES', 'UI_PLURAL_FORMS', 'LANG_PACKS'];

/** Theme tokens the shell cannot do without, in BOTH blocks (Paper and Candlelight). */
export const REQUIRED_TOKENS = ['--bg', '--panel', '--panel-2', '--panel-3', '--ink', '--ink-2', '--muted', '--line', '--line-2', '--accent', '--accent-soft', '--accent-ink', '--gold', '--focus', '--shadow', '--scrim'];
/** Paper-only tokens (Candlelight inherits them). */
export const REQUIRED_PAPER_ONLY = ['--ui-font'];

/** Lucide icons the shell draws (PascalCase, lucide.icons keys). */
export const ICONS = ['Globe', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'Flame', 'Sun', 'Anchor', 'LifeBuoy', 'Coffee', 'FileUp', 'SlidersHorizontal', 'ListTree', 'PenLine', 'Type', 'TabletSmartphone', 'Check', 'Download',
  // step 5 wave 4c: the cover maker, the print wrap, the spine and back, the wrap download's button and toasts
  'LocateFixed', 'BookCopy', 'Ruler', 'PanelLeft', 'FileDown', 'ImageDown', 'CloudOff', 'Loader2',
  // part C: the outline rows, the backup and device toasts, the format buttons, the text note
  'GripVertical', 'Bookmark', 'FileText', 'Image', 'ListOrdered', 'HardDrive', 'FolderOpen', 'Bold', 'Italic', 'Info',
  // step 5 wave 1a: the confirm, Settings, History and the sidebar's book tools
  'BookOpen', 'BookType', 'History', 'Activity', 'Target', 'BookMarked', 'NotebookPen',
  // step 5 wave 1b: the statistics disclosure, the row menu and its toasts, the sample and new book
  'ChevronUp', 'Ellipsis', 'CopyPlus', 'Scissors', 'Merge', 'Trash2', 'Undo2', 'BookX', 'FilePlus', 'File', 'ImageOff', 'TriangleAlert',
  // step 5 wave 1c: the tour's toast, Story Insights and Names on stage, the notebook and its research files
  'Map', 'RefreshCcw', 'EyeOff', 'Plus', 'StickyNote', 'Pin', 'Folder', 'Paperclip', 'X', 'ExternalLink', 'FileImage', 'FileAudio', 'FileVideo', 'FileType',
  // step 5 wave 2a: the insert toolbar (1.0's data-lucide names) and its dialogs
  'Link', 'Quote', 'Signature', 'List', 'Sparkle', 'Minus', 'Columns2', 'IndentIncrease', 'Feather', 'AlignCenter', 'AlignRight',
  'MessagesSquare', 'MailOpen', 'MicVocal', 'SquareTerminal', 'RotateCw', 'FlipVertical2', 'WandSparkles',
  // step 5 wave 2b: pictures (Insert Image, the section card, the scene bar and picker, the image library)
  'ImagePlus', 'Images', 'Upload', 'Eraser', 'Sparkles', 'Search', 'Expand', 'Shrink', 'RotateCcw',
  // wave 2c: the row's eye, the matter library, the starters, the outline board
  'Eye', 'Library', 'BookmarkPlus', 'FilePlus2', 'LayoutGrid', 'Table2', 'Filter', 'Tag', 'Move', 'PencilLine',
  // step 5 wave 3a: Dictate, Read Aloud and Zen
  'Mic', 'Volume2', 'Play', 'Pause', 'Square', 'Leaf',
  // step 5 wave 3b: the Covenant (its room, list, card and fields; BIBLE_ICONS' five kinds)
  'ArrowLeft', 'ListPlus', 'UserRound', 'MapPin', 'Gem', 'Users', 'ScrollText', 'Cloud',
  // step 5 wave 4a: the Style tab's headings (1.0's data-lucide names) and its toasts
  'SwatchBook', 'LibraryBig', 'PenTool', 'Palette', 'AlignStartVertical', 'SeparatorHorizontal', 'CaseSensitive', 'Copy',
  // step 5 wave 4b: the device bar, the page controls, the hardcover's bar and full screen (1.0's data-lucide names)
  'Tablet', 'Smartphone', 'Book', 'BookText', 'Maximize2', 'Minimize2',
  // step 5 wave 5a: the export modal, the validator's and the accessibility check's results (1.0's data-lucide names)
  'PackageCheck', 'BookDown', 'CheckCircle2', 'ScanSearch', 'ShieldCheck', 'Accessibility', 'XCircle', 'AlertTriangle', 'ArrowRight',
  // step 5 wave 5b: print, the Print Interior View and the preflight (1.0's data-lucide names)
  'Printer', 'FileDown', 'ClipboardCheck', 'RotateCcw',
  // step 5 wave 5c: Word, the box set, the submission manuscript and the ACX script (1.0's data-lucide names)
  'FileType2', 'BookPlus', 'FilePenLine', 'Headphones',
  // step 5 wave 5d: the store-ready check — its entry, the modal's buttons, the verdict and the rows (1.0's data-lucide names)
  'Store', 'BadgeCheck', 'Server', 'RefreshCw', 'HelpCircle', 'OctagonX', 'Wand2', 'CheckSquare',
  // wave 6: the import report (its title and reopen button), and the import's toasts (imported, reading a PDF, the language found)
  'ListChecks', 'FileCheck2', 'Loader', 'Languages',
  // wave 7a: the sign-in and shelf dialogs, the account box and the shelf's toasts (1.0's data-lucide names)
  'CloudUpload', 'KeyRound', 'LogOut', 'Archive'];

const fail = (msg) => {
  throw new Error(`extract-studio: ${msg}`);
};

/* closure.ts imports `typescript`. Node resolves a bare import from the
   importing file's folders upward (src/book/studio → repo root), but the
   studio installs its own pinned typescript in studio/node_modules (the
   repo root's is not installed in the image's studio stage). Point that
   one import at the studio's copy; nothing else is redirected. */
let closureMod = null;
async function closure() {
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

/* ---- strings ---- */

/** Evaluate the lifted string tables in a bare context and read them back as plain JSON. */
export async function extractStrings(html) {
  const { extractStudioSource } = await closure();
  const api = `\n;globalThis.__beukOut = JSON.stringify({ uiLangKey: UI_LANG_KEY, themeKey: THEME_KEY, order: UI_LANG_ORDER, names: UI_LANG_NAMES, packs: UI_STRINGS, pluralForms: UI_PLURAL_FORMS, rtl: Object.keys(LANG_PACKS).filter(function (c) { return !!LANG_PACKS[c].rtl; }) });`;
  let src;
  try {
    src = extractStudioSource(html, NAMES, { listRef: 'studio/scripts/extract-studio.mjs NAMES', api, stringTables: true });
  } catch (e) {
    fail(e.message);
  }
  const ctx = vm.createContext({}, { name: 'beuk-strings', codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(src.code, ctx, { filename: 'client/index.html (string tables)', timeout: 10_000 });
  } catch (e) {
    fail(`the string tables lifted from client/index.html do not evaluate on their own: ${e.message}`);
  }
  const out = JSON.parse(ctx.__beukOut);
  checkStrings(out);
  /* bookRtl: every BOOK language 1.0 writes right to left (LANG_PACKS[code].rtl, 1.0's isRtlLang),
     for the manuscript's dir; rtl: the interface languages among them, for the chrome. */
  out.bookRtl = out.rtl.slice();
  out.rtl = out.rtl.filter((c) => out.order.includes(c));
  return out;
}

function checkStrings(s) {
  if (typeof s.uiLangKey !== 'string' || !s.uiLangKey) fail('UI_LANG_KEY is empty');
  if (typeof s.themeKey !== 'string' || !s.themeKey) fail('THEME_KEY is empty');
  if (!Array.isArray(s.order) || s.order.length === 0) fail('UI_LANG_ORDER is empty');
  if (s.order[0] !== 'en') fail(`UI_LANG_ORDER must start with the source locale "en", not "${s.order[0]}"`);
  const en = s.packs && s.packs.en;
  const enKeys = en ? Object.keys(en) : [];
  if (enKeys.length < 100) fail(`UI_STRINGS.en has ${enKeys.length} keys — the English pack is missing or was not merged`);
  for (const code of s.order) {
    if (!s.names || typeof s.names[code] !== 'string' || !s.names[code]) fail(`UI_LANG_NAMES has no name for "${code}"`);
    const pack = s.packs[code];
    if (!pack || typeof pack !== 'object') fail(`UI_STRINGS has no pack for "${code}" (it is in UI_LANG_ORDER)`);
    const missing = enKeys.filter((k) => typeof pack[k] !== 'string');
    if (missing.length) fail(`UI_STRINGS["${code}"] lacks ${missing.length} key(s) of the English pack: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`);
    const empty = Object.keys(pack).filter((k) => typeof pack[k] !== 'string' || (pack[k] === '' && en[k] !== ''));
    if (empty.length) fail(`UI_STRINGS["${code}"] has empty or non-text value(s): ${empty.slice(0, 8).join(', ')}`);
  }
  if (!Array.isArray(s.rtl)) fail('LANG_PACKS gave no direction table');
}

/* ---- tokens ---- */

/** The studio's main stylesheet: the first <style> in <head>. */
function headStyle(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  const m = /<style>([\s\S]*?)<\/style>/.exec(head);
  if (!m) fail('client/index.html has no <style> in <head>');
  return m[1];
}

/** Top-level rules of a stylesheet: [{ selector, body, text }]. Comments
 *  and strings are skipped; at-rules (@media…) are skipped whole. */
function topLevelRules(css) {
  const rules = [];
  let i = 0;
  let start = 0;
  const n = css.length;
  const skipString = (q) => {
    i++;
    while (i < n && css[i] !== q) i += css[i] === '\\' ? 2 : 1;
    i++;
  };
  const skipBlock = () => {
    let depth = 0;
    while (i < n) {
      const c = css[i];
      if (c === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 2; if (i < 2) i = n; continue; }
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { i++; return; } }
      i++;
    }
  };
  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      i = css.indexOf('*/', i + 2) + 2;
      if (i < 2) i = n;
      start = i;
      continue;
    }
    if (/\s/.test(c)) { if (start === i) start++; i++; continue; }
    if (c === '"' || c === "'") { skipString(c); continue; }
    if (c === '{') {
      const selector = css.slice(start, i).trim();
      const open = i;
      skipBlock();
      if (!selector.startsWith('@')) rules.push({ selector, body: css.slice(open + 1, i - 1), text: css.slice(start, i) });
      start = i;
      continue;
    }
    if (c === ';') { i++; start = i; continue; } // @import …; and the like
    i++;
  }
  return rules;
}

const declared = (body) => new Set([...body.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((m) => m[1]));
const onlyCustomProps = (body) =>
  body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .every((d) => d.startsWith('--') || d.startsWith('color-scheme'));

export function extractTokens(html) {
  const rules = topLevelRules(headStyle(html));
  const PAPER = ':root';
  const CANDLE = ':root[data-theme="candlelight"]';
  const blocks = rules.filter((r) => (r.selector === PAPER || r.selector === CANDLE) && onlyCustomProps(r.body));
  const paper = blocks.filter((r) => r.selector === PAPER);
  const candle = blocks.filter((r) => r.selector === CANDLE);
  if (!paper.length) fail(`client/index.html's <head> stylesheet has no top-level ${PAPER} { --… } token block`);
  if (!candle.length) fail(`client/index.html's <head> stylesheet has no top-level ${CANDLE} { --… } token block`);
  const paperNames = new Set(paper.flatMap((r) => [...declared(r.body)]));
  const candleNames = new Set(candle.flatMap((r) => [...declared(r.body)]));
  const lackPaper = [...REQUIRED_TOKENS, ...REQUIRED_PAPER_ONLY].filter((t) => !paperNames.has(t));
  if (lackPaper.length) fail(`the ${PAPER} token blocks no longer declare: ${lackPaper.join(', ')}`);
  const lackCandle = REQUIRED_TOKENS.filter((t) => !candleNames.has(t));
  if (lackCandle.length) fail(`the ${CANDLE} token blocks no longer declare: ${lackCandle.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    '   The :root (Paper) and :root[data-theme="candlelight"] token blocks, verbatim, in 1.0\'s order. */\n' +
    blocks.map((r) => r.text.trim()).join('\n') +
    '\n';
  return { css, paper: [...paperNames], candlelight: [...candleNames] };
}

/* ---- the writing environment's stylesheet (wave 3a) ----
   1.0's own rules for Zen (BEUK:zencalm, the day cycle, the sound popover, the dock, the stage), Read Aloud and
   dictation (the popover, the language picker, the language bar), lifted verbatim from the <head> stylesheet into
   src/generated/environment.css: one source, nothing retyped. A rule is taken when one of its selectors names a part
   of these features (ENV_SELECTOR: zen/dict at a word start or camel-cased, so 1.0's #btnZenSound, #btnZenExit… match and "frozen"/"verdict" don't); inside @media / @supports the same test runs rule by rule; an @keyframes or
   @property is taken when the taken rules use it. Fails loudly when 1.0 no longer has the anchor rules. */
export const ENV_SELECTOR = /(?<![a-zA-Z])zen|Zen|#zd|\.zd-|\bzs-|\.zi-|#zenIndex|\.zn-|\.zp-|\.zt-|\.zf-|\.zd-label|#raPop|\.ra-|#btnReadAloud|#raLangSug|(?<![a-zA-Z])dict|Dict|\.dp-|#langBar|\.lb-|focus-cluster|#editorWordBar/;
const BACKSLASH = String.fromCharCode(92);
const ENV_ANCHORS =['#zenPill', 'body.zen #topbar', '#raPop', '#dictPop', '#langBar'];

/** The stylesheet as a tree: rules and at-rules (with children for @media / @supports, whole otherwise). */
function cssTree(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  const parseList = (end, list) => {
    let start = i;
    while (i < end) {
      const c = css[i];
      if (c === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 2; if (i < 2) i = end; start = i; continue; }
      if (/\s/.test(c) && start === i) { start++; i++; continue; }
      if (c === '"' || c === "'") { i++; while (i < end && css[i] !== c) i += css[i] === BACKSLASH ? 2 : 1; i++; continue; }
      if (c === ';') { i++; start = i; continue; }
      if (c === '}') { i++; start = i; continue; }
      if (c === '{') {
        const prelude = css.slice(start, i).trim();
        const open = i;
        // the matching brace
        let depth = 0, j = i;
        for (; j < end; j++) {
          const d = css[j];
          if (d === '/' && css[j + 1] === '*') { j = css.indexOf('*/', j + 2) + 1; continue; }
          if (d === '"' || d === "'") { j++; while (j < end && css[j] !== d) j += css[j] === BACKSLASH ? 2 : 1; continue; }
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) break; }
        }
        const close = j;
        const text = css.slice(start, close + 1);
        if (/^@(media|supports)\b/.test(prelude)) {
          const kids = [];
          i = open + 1;
          parseList(close, kids);
          list.push({ kind: 'group', prelude, kids, text });
        } else if (prelude.startsWith('@')) list.push({ kind: 'at', prelude, text });
        else list.push({ kind: 'rule', prelude, text });
        i = close + 1;
        start = i;
        continue;
      }
      i++;
    }
  };
  parseList(n, out);
  return out;
}

export function extractEnvironmentCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const hit = (sel) => sel.split(',').some((s) => ENV_SELECTOR.test(s));
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const used = taken.join('\n');
  const extras = [];
  for (const node of tree) {
    if (node.kind !== 'at') continue;
    const k = /^@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(node.prelude);
    const p = /^@property\s+(--[\w-]+)/.exec(node.prelude);
    if ((k && new RegExp('(^|[^' + BACKSLASH + 'w-])' + k[1] + '(?![' + BACKSLASH + 'w-])').test(used)) || (p && used.includes(p[1]))) extras.push(node.text.trim());
  }
  const missing = ENV_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a)));
  if (missing.length) fail(`the writing environment's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for Zen, Read Aloud, dictation and the language bar (ENV_SELECTOR), verbatim, in 1.0's order,\n" +
    '   then the @property / @keyframes they use. */\n' +
    [...extras, ...taken].join('\n') +
    '\n';
  return { css, rules: taken.length, extras: extras.length };
}

/* ---- the Covenant's stylesheet (wave 3b) ----
   1.0's own rules for the Covenant (BEUK:bible: the room, the list, the entry card and its fields, the merge screen, the
   hover card, the change menu and popover, the margin dots), lifted verbatim into src/generated/covenant.css. A rule
   is taken when one of its selectors names a part of the Covenant (COV_SELECTOR), and NOT when every selector that
   names one is the desk mirror's (.bible-ov*: 1.0's layer over its textarea, which 2.0 does not have; its marks are
   ProseMirror decorations, styled in styles/covenant.css). Fails loudly when 1.0 no longer has the anchor rules. */
export const COV_SELECTOR = /\.bib-|#bib[A-Z]|#modalBible|#bibleCard|#bibleMark|\.bm-dotmark/;
const COV_MIRROR = /\.bible-ov/;
const COV_ANCHORS = ['.bib-modal', '.bib-card', '.bib-mpop', '.bm-dotmark', '.bib-heat'];

export function extractCovenantCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const hit = (sel) => sel.split(',').some((s) => COV_SELECTOR.test(s) && !COV_MIRROR.test(s));
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const used = taken.join('\n');
  const extras = [];
  for (const node of tree) {
    if (node.kind !== 'at') continue;
    const k = /^@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(node.prelude);
    if (k && new RegExp('(^|[^' + BACKSLASH + 'w-])' + k[1] + '(?![' + BACKSLASH + 'w-])').test(used)) extras.push(node.text.trim());
  }
  const missing = COV_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a)));
  if (missing.length) fail(`the Covenant's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the Covenant (COV_SELECTOR, the desk mirror's .bible-ov* left out), verbatim, in 1.0's order,\n" +
    '   then the @keyframes they use. */\n' +
    [...extras, ...taken].join('\n') +
    '\n';
  return { css, rules: taken.length, extras: extras.length };
}

/* ---- the Style tab's stylesheet (wave 4a) ----
   1.0's own rules for the Typography Studio (the preset and My themes grids, the control grid and its range values,
   the ornament grid, the book colour's swatches, the flourish and font lists, the theme creator and its preview, the
   section headings) and the switch control the tab's toggles are (1.0's .switch, which no earlier wave took), lifted
   verbatim into src/generated/style.css. A rule is taken when one of its selectors names one of these
   (STYLE_SELECTOR); inside @media / @supports the same test runs rule by rule. Fails loudly when 1.0 no longer has
   the anchor rules. */
export const STYLE_SELECTOR = /\.preset-|\.mine-actions|\.ctl-grid|input\[type="range"\]|\.range-val|(?<![\w-])\.orn-|\.colour-|\.flourish-|\.font-row|(?<![\w-])\.tc-|\.studio-h|\.studio-sub|(?<![\w-])\.switch(?![\w-])/;
const STYLE_ANCHORS = ['.preset-grid', '.preset-card', '.ctl-grid', '.orn-grid', '.colour-sw', '.flourish-row', '.tc-preview', '.studio-h', '.switch'];

export function extractStyleCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const hit = (sel) => sel.split(',').some((s) => STYLE_SELECTOR.test(s));
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = STYLE_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a)));
  if (missing.length) fail(`the Style tab's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the Typography Studio and its switches (STYLE_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}

/* ---- the preview pane's stylesheet (wave 4b) ----
   1.0's own rules for the preview pane (client/index.html "Preview pane", BEUK:devicetruth, BEUK:pagecount, the reading
   desk, BEUK:hcpreview, BEUK:fullscreen) and the Print Interior View's page rules the open hardcover lays its pages
   out with (.piv-*), lifted verbatim into src/generated/preview.css. A rule is taken when one of its selectors names
   one of these (PREVIEW_SELECTOR) and no earlier extraction took it (Zen's, the Covenant's, the Style tab's); inside
   @media / @supports the same test runs rule by rule. Fails loudly when 1.0 no longer has the anchor rules. */
export const PREVIEW_SELECTOR =
  /#pane-preview\.hc-mode|\.device-bar|\.dev-btn|#previewStage|#frameZone|#deviceFrame|\.frame-|#deviceScreen|(?<![\w-])\.screen(?![\w-])|\.notch|\.run-head|\.run-foot|\.home-bar|#flowWrap|#pageFlow|\.page-controls|\.page-btn|#pageCounter|#previewSectionName|#previewDesk|\.desk-|#deskMeasure|#deskFlow|\.hc-|#hc[A-Z]|\.fs-|\.device-display-note|(?<![\w-])\.pv-|\.piv-|\.fc-page/;
const PREVIEW_ANCHORS = ['.device-bar', '.dev-btn', '#deviceFrame', '#flowWrap', '#pageFlow', '.page-controls', '.desk-rail', '#deskMeasure', '.hc-stage', '.piv-page'];

export function extractPreviewCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const earlier = (sel) => sel.split(',').some((s) => ENV_SELECTOR.test(s) || COV_SELECTOR.test(s) || STYLE_SELECTOR.test(s));
  const hit = (sel) => sel.split(',').some((s) => PREVIEW_SELECTOR.test(s)) && !earlier(sel);
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  // the keyframes the taken rules animate with (hcFade), as Zen's extraction takes its own
  const used = taken.join('\n');
  for (const node of tree) {
    if (node.kind !== 'at') continue;
    const k = /^@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(node.prelude);
    if (k && new RegExp('(^|[^' + BACKSLASH + 'w-])' + k[1] + '(?![' + BACKSLASH + 'w-])').test(used) && !ENV_SELECTOR.test(k[1])) taken.push(node.text.trim());
  }
  const missing = PREVIEW_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a)));
  if (missing.length) fail(`the preview pane's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the preview pane, the reading desk, the hardcover, full screen and the print view's pages (PREVIEW_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}

/* ---- the cover maker's stylesheet (wave 4c) ----
   1.0's own rules for Project Settings' cover row (.cover-row, .cover-thumb, .cover-actions), the cover maker
   (.cm-*, #cm*: the layout, the swatches, the art and photo grids, the print wrap, BEUK:spineback, BEUK:hardcover's
   legend) and the book on the stand (.cm3d*), lifted verbatim into src/generated/cover.css. A rule is taken when one of
   its selectors names one of these (COVER_SELECTOR) and no earlier extraction took it; inside @media / @supports the
   same test runs rule by rule. Fails loudly when 1.0 no longer has the anchor rules. */
export const COVER_SELECTOR = /(?<![\w-])\.cm-|(?<![\w-])\.cm3d|#cm[A-Z]|\.cover-row|\.cover-thumb|\.cover-actions/;
const COVER_ANCHORS = ['.cover-row', '.cover-thumb', '.cm-layout', '.cm-swatch', '.cm-wrap', '.cm-sb', '.cm-hc-legend', '.cm3d-stage', '#cmWrap3dSvg', '#cmCanvas.has-text'];

export function extractCoverCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const earlier = (sel) => sel.split(',').some((s) => ENV_SELECTOR.test(s) || COV_SELECTOR.test(s) || STYLE_SELECTOR.test(s) || PREVIEW_SELECTOR.test(s));
  const hit = (sel) => sel.split(',').some((s) => COVER_SELECTOR.test(s)) && !earlier(sel);
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = COVER_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a) || t.includes('{ ' + a)));
  if (missing.length) fail(`the cover maker's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for Project Settings' cover row, the cover maker, the print wrap, the spine and back, the hardcover's legend and the book on the stand (COVER_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}

/* ---- the cover maker's markup (wave 4c) ----
   1.0's own markup, verbatim: the cover maker's dialog (#modalCoverMaker, from its opening tag to its closing one)
   and Project Settings' cover row (the .full block holding set.coverLabel, #coverThumb, the three buttons and
   #coverInput). The studio puts it in place once (src/cover/CoverMaker.tsx, src/settings/SettingsDialog.tsx), draws
   its icons, gives its data-i18n texts their words with 1.0's own setElText, and 1.0's initCoverMaker wires it. A
   block is cut by counting its <div>s; fails loudly when 1.0 no longer has an anchor. */
function divBlock(html, at, what) {
  if (at < 0) fail(`client/index.html no longer has ${what}`);
  const re = /<div\b|<\/div>/g;
  re.lastIndex = at;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(at, m.index + 6);
  }
  fail(`${what} in client/index.html never closes`);
}
export function extractCoverMarkup(html) {
  const maker = divBlock(html, html.indexOf('<div class="modal-back" id="modalCoverMaker"'), 'the cover maker (#modalCoverMaker)');
  const label = html.indexOf('data-i18n="set.coverLabel"');
  const row = divBlock(html, html.lastIndexOf('<div class="full">', label), "Project Settings' cover row");
  for (const id of ['cmCanvas', 'cmWrapCanvas', 'cmWrap3dStage', 'btnCmUse', 'btnCmWrapPdf', 'cmSpineBody', 'cmBackBody']) if (!maker.includes('id="' + id + '"')) fail(`the cover maker's markup no longer has #${id}`);
  for (const id of ['coverThumb', 'btnCoverUpload', 'btnCoverMake', 'btnCoverRemove', 'coverNote', 'coverInput']) if (!row.includes('id="' + id + '"')) fail(`Project Settings' cover row no longer has #${id}`);
  if (/<script|\son[a-z]+=/i.test(maker + row)) fail("the cover maker's markup carries a script or a handler attribute: the studio puts it in place as it is");
  // the Lucide build 1.0 links (its spine icons, the icon grids): the same file, the same integrity
  const lucide = /<script src="assets\/vendor\/lucide\.min\.js" integrity="([^"]+)"><\/script>/.exec(html);
  if (!lucide) fail('client/index.html no longer links assets/vendor/lucide.min.js with its integrity');
  return { maker, row, lucideSri: lucide[1] };
}

/* ---- the export modal's stylesheet and markup (wave 5a) ----
   1.0's own rules for the export modal ("Export suite & package inspector": the platform presets, the package tree,
   the check list, the format sections), the structural validator's and the accessibility check's results, and the
   package inspector, lifted verbatim into src/generated/export.css (EXPORT_SELECTOR; a rule no earlier extraction
   took; inside @media the same test rule by rule). The markup is 1.0's, verbatim: the export modal (#modalExport) and
   the package inspector (#modalInspector), each cut by counting its <div>s, into src/generated/export-markup.json
   with the JSZip build 1.0 links (same file, same integrity). The studio puts it in place once per book
   (src/export/ExportModal.tsx) and 1.0's own initExport wires it. Fails loudly when 1.0 no longer has an anchor. */
/* Wave 5c: and the box set's list (.bs-*), the ACX script's and the submission manuscript's dialogs (BEUK:acx,
   BEUK:manuscript: .acx-*, .ms-*, .modal.acx-modal, .modal.ms-modal). Wave 5d: the store-ready check (BEUK:store: its
   entry in the export modal, the store modal's controls, verdict and rows: .st-*). */
export const EXPORT_SELECTOR = /\.file-tree|\.check-list|\.fmt-sec|\.fmt-actions|\.platform-|\.val-|\.v-code|\.a11y-|\.insp-|\.bs-|\.acx-|\.ms-|(?<![\w-])\.st-/;
const EXPORT_ANCHORS = ['.file-tree', '.check-list', '.fmt-sec', '.platform-grid', '.platform-btn', '.platform-detail', '.val-summary', '.a11y-clean', '.insp-layout', '.insp-code',
  '.bs-list', '.bs-row', '.bs-empty', '.modal.acx-modal', '.acx-grid', '.acx-table', '.modal.ms-modal', '.ms-tp',
  '.st-entry', '.st-controls', '.st-verdict', '.st-row', '.st-chip', '.st-fix', '.st-server-note', '.st-actions'];
export function extractExportCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const earlier = (sel) => sel.split(',').some((s) => ENV_SELECTOR.test(s) || COV_SELECTOR.test(s) || STYLE_SELECTOR.test(s) || PREVIEW_SELECTOR.test(s) || COVER_SELECTOR.test(s));
  const hit = (sel) => sel.split(',').some((s) => EXPORT_SELECTOR.test(s)) && !earlier(sel);
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = EXPORT_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a) || t.includes('{ ' + a)));
  if (missing.length) fail(`the export modal's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the export modal, the validator's and the accessibility check's results and the package inspector (EXPORT_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}
export function extractExportMarkup(html) {
  const modal = divBlock(html, html.indexOf('<div class="modal-back" id="modalExport"'), 'the export modal (#modalExport)');
  const inspector = divBlock(html, html.indexOf('<div class="modal-back" id="modalInspector"'), 'the package inspector (#modalInspector)');
  for (const id of ['platformGrid', 'platformDetail', 'exportTree', 'coverCheck', 'platformCheckText', 'btnBuildEpub', 'btnInspect', 'btnValidate', 'validateResults', 'btnA11y', 'a11yResults',
    'btnDownloadMd', 'btnCopyMd', 'btnDownloadHtml', 'btnCloseExport', 'btnStoreReady', 'btnPreflight', 'btnDownloadDocx', 'btnMsOpen', 'btnAcxOpen', 'btnOpenPrintView', 'btnBuildBoxSet', 'archiveSec'])
    if (!modal.includes('id="' + id + '"')) fail(`the export modal's markup no longer has #${id}`);
  for (const id of ['inspSub', 'inspFiles', 'inspPath', 'inspSize', 'btnCopyFile', 'inspCode', 'btnCloseInspector']) if (!inspector.includes('id="' + id + '"')) fail(`the package inspector's markup no longer has #${id}`);
  // wave 5c: the ACX script's dialog (#modalAcx) and the submission manuscript's (#modalManuscript), 1.0's own, verbatim
  const acx = divBlock(html, html.indexOf('<div class="modal-back" id="modalAcx"'), "the ACX script's dialog (#modalAcx)");
  const ms = divBlock(html, html.indexOf('<div class="modal-back" id="modalManuscript"'), "the submission manuscript's dialog (#modalManuscript)");
  for (const id of ['acxH', 'acxBody', 'btnAcxClose', 'btnAcxDownload']) if (!acx.includes('id="' + id + '"')) fail(`the ACX script's dialog no longer has #${id}`);
  for (const id of ['msH', 'msBody', 'btnMsClose', 'btnMsDownload']) if (!ms.includes('id="' + id + '"')) fail(`the submission manuscript's dialog no longer has #${id}`);
  for (const id of ['boxSetList', 'btnBoxSetAdd', 'boxSetFileInput']) if (!modal.includes('id="' + id + '"')) fail(`the export modal's markup no longer has #${id}`);
  // wave 5d: the store-ready check's modal (#modalStore, BEUK:store), 1.0's own, verbatim
  const store = divBlock(html, html.indexOf('<div class="modal-back" id="modalStore"'), "the store-ready check's modal (#modalStore)");
  for (const id of ['storeH', 'storeSel', 'storeBinding', 'storeInk', 'storeReport', 'storeServerNote', 'btnStoreServer', 'btnStoreRecheck', 'btnStoreDownload', 'btnCloseStore'])
    if (!store.includes('id="' + id + '"')) fail(`the store-ready check's modal no longer has #${id}`);
  if (/<script|\son[a-z]+=/i.test(modal + inspector + acx + ms + store)) fail("the export modal's markup carries a script or a handler attribute: the studio puts it in place as it is");
  // the JSZip build 1.0 links (its in-browser package: buildEpubBlob): the same file, the same integrity
  const jszip = /<script src="assets\/vendor\/jszip\.min\.js" integrity="([^"]+)"><\/script>/.exec(html);
  if (!jszip) fail('client/index.html no longer links assets/vendor/jszip.min.js with its integrity');
  return { modal, inspector, acx, ms, store, jszipSri: jszip[1] };
}

/* ---- print's stylesheet and markup (wave 5b) ----
   1.0's own rules for the export modal's print section (the trim grid, the margins / running head / page numbers
   block, the print note) and the print frame (#printFrame), lifted verbatim into src/generated/print.css
   (PRINT_SELECTOR; a rule no earlier extraction took — the print frame's full-screen rules and the Print Interior
   View's .piv-* rules are the preview's already, 4b — and inside @media the same test rule by rule). The markup is
   1.0's, verbatim: the print view (#modalPrint), the Print Interior View (#modalPrintView) and its measurer
   (#pivMeasure), each cut by counting its <div>s, into src/generated/print-markup.json. Fails loudly when 1.0 no
   longer has an anchor. */
export const PRINT_SELECTOR = /\.trim-grid|\.trim-btn|\.trim-group-label|\.print-note|#printFrame|\.pm-(block|head|row|fields|hint)/;
const PRINT_ANCHORS = ['.trim-grid', '.trim-btn', '.trim-group-label', '.print-note', '#printFrame', '.pm-block', '.pm-row', '.pm-fields', '.pm-hint'];
export function extractPrintCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const earlier = (sel) =>
    sel.split(',').some((s) => ENV_SELECTOR.test(s) || COV_SELECTOR.test(s) || STYLE_SELECTOR.test(s) || PREVIEW_SELECTOR.test(s) || COVER_SELECTOR.test(s) || EXPORT_SELECTOR.test(s));
  const hit = (sel) => sel.split(',').some((s) => PRINT_SELECTOR.test(s)) && !earlier(sel);
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = PRINT_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a) || t.includes('{ ' + a)));
  if (missing.length) fail(`print's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the export modal's print section and the print frame (PRINT_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}
export function extractPrintMarkup(html) {
  const print = divBlock(html, html.indexOf('<div class="modal-back" id="modalPrint"'), 'the print view (#modalPrint)');
  const view = divBlock(html, html.indexOf('<div class="modal-back" id="modalPrintView"'), 'the Print Interior View (#modalPrintView)');
  const mAt = html.indexOf('<div class="piv-measure" id="pivMeasure"');
  const measure = divBlock(html, mAt, "the Print Interior View's measurer (#pivMeasure)");
  if (html.indexOf(view) + view.length > mAt) fail('#pivMeasure no longer follows #modalPrintView');
  for (const id of ['printModalBox', 'printSub', 'printFrame', 'btnPrintFull', 'btnClosePrint', 'btnDoPrint']) if (!print.includes('id="' + id + '"')) fail(`the print view's markup no longer has #${id}`);
  for (const id of ['pivModalBox', 'btnPivFull', 'btnClosePrintView', 'pivSub', 'pivTrim', 'pivJump', 'tglPivRecto', 'tglPivLargePrint', 'tglPivPictureBook', 'tglPivGuides', 'pivNotes',
    'pivZoomFit', 'pivZoomActual', 'pivStage', 'pivBox', 'pivSpread', 'pivEmpty', 'btnPivPrev', 'pivCounter', 'btnPivNext'])
    if (!view.includes('id="' + id + '"')) fail(`the Print Interior View's markup no longer has #${id}`);
  if (/<script|\son[a-z]+=/i.test(print + view + measure)) fail("print's markup carries a script or a handler attribute: the studio puts it in place as it is");
  return { print, view, measure };
}

/* ---- the import's stylesheet and markup (wave 6) ----
   1.0's own rules for the "Recognised in your manuscript" summary (.import-summary) and the import report (BEUK:importreport:
   its reopen button, the modal, the chips, groups, items, before/after and actions: .ir-*), lifted verbatim into
   src/generated/import.css (IMPORT_SELECTOR; inside @media the same test rule by rule). The markup is 1.0's, verbatim: the
   summary (#importSummary) and the report's reopen button (#irReopen) under the Import button, the report
   (#modalImportReport), and the Import button's file input (#fileInput, 1.0's accept list), into
   src/generated/import-markup.json with the mammoth build 1.0 links (same file, same integrity). Fails loudly when 1.0 no
   longer has an anchor. */
export const IMPORT_SELECTOR = /\.import-summary|(?<![\w-])\.ir-/;
const IMPORT_ANCHORS = ['.import-summary', '.import-summary .is-head', '.import-summary .is-line', '.ir-reopen', '.ir-modal', '.ir-chips', '.ir-group', '.ir-item', '.ir-ba', '.ir-act', '.ir-actions'];
export function extractImportCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const hit = (sel) => sel.split(',').some((s) => IMPORT_SELECTOR.test(s));
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = IMPORT_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a) || t.includes('{ ' + a)));
  if (missing.length) fail(`the import's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the import summary and the import report (IMPORT_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}
export function extractImportMarkup(html) {
  const summary = divBlock(html, html.indexOf('<div id="importSummary" class="import-summary"'), 'the import summary (#importSummary)');
  const reopen = divBlock(html, html.indexOf('<div id="irReopen" class="ir-reopen"'), "the import report's reopen button (#irReopen)");
  const report = divBlock(html, html.indexOf('<div class="modal-back" id="modalImportReport"'), 'the import report (#modalImportReport)');
  const fi = /<input type="file" id="fileInput" accept="[^"]*" style="display:none;" \/>/.exec(html);
  if (!fi) fail("client/index.html no longer has the Import button's file input (#fileInput)");
  for (const id of ['importSummaryText', 'btnImportSummaryClose']) if (!summary.includes('id="' + id + '"')) fail(`the import summary no longer has #${id}`);
  if (!reopen.includes('id="btnIrReopen"')) fail("the import report's reopen block no longer has #btnIrReopen");
  for (const id of ['irH', 'irSub', 'irBody', 'irUndoAllNote', 'btnIrDismiss', 'btnIrUndoAll', 'btnIrClose', 'btnIrKeep']) if (!report.includes('id="' + id + '"')) fail(`the import report no longer has #${id}`);
  if (/<script|\son[a-z]+=/i.test(summary + reopen + report + fi[0])) fail("the import's markup carries a script or a handler attribute: the studio puts it in place as it is");
  // the mammoth build 1.0 links (its .docx reader): the same file, the same integrity
  const mammoth = /<script src="assets\/vendor\/mammoth\.browser\.min\.js" integrity="([^"]+)"><\/script>/.exec(html);
  if (!mammoth) fail('client/index.html no longer links assets/vendor/mammoth.browser.min.js with its integrity');
  return { summary, reopen, report, fileInput: fi[0], mammothSri: mammoth[1] };
}

/* ---- the shelf's stylesheet and markup (wave 7a) ----
   1.0's own rules for the offline pill (.net-pill), the account button's avatar and sync dot, the sidebar's shelf line
   (.sync-row), the sign-in dialog (.auth-*, .legal-line), the shelf dialog (the portal and plan lines, the bring box, the
   list, the account box) and the sync dot's pulse, lifted verbatim into src/generated/cloud.css (CLOUD_SELECTOR; inside
   @media the same test rule by rule). Rules 2.0 already holds are left out: .linkish (src/styles/dialogs.css) and
   .side-dock .sync-row (src/styles/sidebar.css); bulk import (.bulk-*) is wave 7b's. The markup is 1.0's, verbatim: the
   sign-in dialog (#modalAuth) and the shelf dialog (#modalShelf), the account button (#btnAccount), the offline pill
   (#netPill) and the shelf line (#syncRow), into src/generated/cloud-markup.json. The calm confirm (#modalConfirm) and
   the conflict notice (#modalConflict) are already 2.0's (src/shell/Dialog.tsx, src/covenant/CovenantDialog.tsx). */
/* Wave 7b: and bulk import's block (.bulk-*, G3) and the update bar (.update-bar, H5). */
export const CLOUD_SELECTOR = /\.net-(pill|dot)|\.acct-|\.sync-(dot|row)|\.portal-line|\.plan-line|\.auth-|\.legal-line|\.bring-box|\.shelf-|\.bulk-|\.update-bar/;
const CLOUD_ANCHORS = ['.net-pill', '.net-dot', '.acct-avatar', '.sync-dot', '.sync-row', '.portal-line', '.plan-line', '.auth-forgot-row', '.legal-line', '.auth-note', '.acct-box', '.auth-err', '.bring-box', '.shelf-list', '.shelf-row', '.shelf-empty',
  '.bulk-head', '.bulk-drop', '.bulk-progress', '.bulk-summary', '.update-bar'];
export function extractCloudCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const hit = (sel) => sel.split(',').some((s) => CLOUD_SELECTOR.test(s)) && !/^\s*\.side-dock \.sync-row\s*$/.test(sel);
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'at' && /^@keyframes syncPulse\b/.test(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = CLOUD_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a)));
  if (missing.length) fail(`the shelf's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  if (!taken.some((t) => t.startsWith('@keyframes syncPulse'))) fail("the shelf's stylesheet no longer has @keyframes syncPulse");
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the shelf, the sign-in dialog and the account (CLOUD_SELECTOR), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}
export function extractCloudMarkup(html) {
  const auth = divBlock(html, html.indexOf('<div class="modal-back" id="modalAuth"'), 'the sign-in dialog (#modalAuth)');
  const shelf = divBlock(html, html.indexOf('<div class="modal-back" id="modalShelf"'), 'the shelf dialog (#modalShelf)');
  const one = (re, what) => {
    const m = re.exec(html);
    if (!m) fail(`client/index.html no longer has ${what}`);
    return m[0];
  };
  const account = one(/<button class="tb-btn" id="btnAccount"[^>]*>.*?<\/button>/, 'the account button (#btnAccount)');
  const netPill = one(/<span class="net-pill" id="netPill"[^>]*>.*?<\/span><\/span>/, 'the offline pill (#netPill)');
  const syncRow = one(/<div class="sync-row" id="syncRow"[^>]*>.*?<\/div>/, 'the shelf line (#syncRow)');
  for (const id of ['authTitle', 'authSub', 'authEmail', 'authPassword', 'authForgotRow', 'authForgot', 'authNote', 'authError', 'authToggle', 'btnCloseAuth', 'btnAuthSubmit', 'authSubmitLabel'])
    if (!auth.includes('id="' + id + '"')) fail(`the sign-in dialog no longer has #${id}`);
  for (const id of ['shelfEmail', 'shelfSyncLine', 'portalLink', 'portalConfirm', 'btnPortalResend', 'portalPending', 'portalNote', 'planLine', 'planText', 'btnPlanUpgrade', 'btnPlanManage', 'shelfBring', 'btnBringBook', 'shelfList', 'acctBox', 'acctCurrent', 'acctNew', 'btnAcctChange', 'acctMsg', 'btnAcctEverywhere', 'btnSignOut', 'btnCloseShelf'])
    if (!shelf.includes('id="' + id + '"')) fail(`the shelf dialog no longer has #${id}`);
  if (!syncRow.includes('id="syncText"')) fail('the shelf line no longer has #syncText');
  // wave 7b: bulk import's two hidden pickers (after the page's other file inputs) and the sidebar's hint (G3); the
  // update bar under the header (H5)
  const bulkInputs = one(/<input type="file" id="bulkFileInput"[^>]*\/>\s*<input type="file" id="bulkFolderInput"[^>]*\/>/, "bulk import's pickers (#bulkFileInput, #bulkFolderInput)");
  const bulkHint = one(/<p id="bulkHint"[^>]*>.*?<\/p>/, "bulk import's hint (#bulkHint)");
  const updateBar = divBlock(html, html.indexOf('<div class="update-bar" id="updateBar"'), 'the update bar (#updateBar)');
  for (const id of ['shelfBulk', 'btnBulkFiles', 'btnBulkFolder', 'bulkDropHint', 'bulkProgress', 'bulkSummary'])
    if (!shelf.includes('id="' + id + '"')) fail(`the shelf dialog no longer has #${id}`);
  for (const id of ['btnUpdateReload', 'btnUpdateLater']) if (!updateBar.includes('id="' + id + '"')) fail(`the update bar no longer has #${id}`);
  if (/<script|\son[a-z]+=/i.test(auth + shelf + account + netPill + syncRow + bulkInputs + bulkHint + updateBar)) fail("the shelf's markup carries a script or a handler attribute: the studio puts it in place as it is");
  return { auth, shelf, account, netPill, syncRow, bulkInputs, bulkHint, updateBar };

}

/* ---- the local pill's stylesheet (wave 5a, round 2) ----
   1.0's own rules for the "Saving on this device" pill and its popover (BEUK:local: .local-wrap, .local-pill and its
   dot, warning, short and full labels, the inline backup offer, .local-pop), lifted verbatim into
   src/generated/local.css (LOCAL_SELECTOR; inside @media the same test rule by rule). 1.0's hiding of the panes while
   its device restore is pending is not taken (2.0 has no such restore). Fails loudly when an anchor rule goes. */
export const LOCAL_SELECTOR = /\.local-(wrap|pill|pop|backup-inline)/;
const LOCAL_ANCHORS = ['.local-wrap', '.local-pill', '.local-pill .local-dot', '.local-pill-btn', '.local-backup-inline', '.local-pop'];
export function extractLocalCss(html) {
  const tree = cssTree(headStyle(html));
  const taken = [];
  const hit = (sel) => sel.split(',').some((s) => LOCAL_SELECTOR.test(s)) && !/data-local-restore/.test(sel);
  for (const node of tree) {
    if (node.kind === 'rule' && hit(node.prelude)) taken.push(node.text.trim());
    else if (node.kind === 'group') {
      const kids = node.kids.filter((k) => k.kind === 'rule' && hit(k.prelude)).map((k) => '  ' + k.text.trim());
      if (kids.length) taken.push(node.prelude + ' {\n' + kids.join('\n') + '\n}');
    }
  }
  const missing = LOCAL_ANCHORS.filter((a) => !taken.some((t) => t.startsWith(a) || t.includes('\n  ' + a) || t.includes(', ' + a)));
  if (missing.length) fail(`the local pill's stylesheet no longer has a rule for: ${missing.join(', ')}`);
  const css =
    '/* GENERATED by studio/scripts/extract-studio.mjs from client/index.html — do not edit.\n' +
    "   1.0's rules for the local pill and its popover (LOCAL_SELECTOR, BEUK:local), verbatim, in 1.0's order. */\n" +
    taken.join('\n') +
    '\n';
  return { css, rules: taken.length };
}

/* ---- icons ---- */

export function extractIcons(lucideSource) {
  const ctx = vm.createContext({}, { name: 'beuk-lucide', codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(lucideSource, ctx, { filename: 'client/assets/vendor/lucide.min.js', timeout: 10_000 });
  } catch (e) {
    fail(`client/assets/vendor/lucide.min.js does not evaluate: ${e.message}`);
  }
  const icons = ctx.lucide && ctx.lucide.icons;
  if (!icons) fail('client/assets/vendor/lucide.min.js defines no lucide.icons');
  const missing = ICONS.filter((n) => !Array.isArray(icons[n]));
  if (missing.length) fail(`lucide.min.js has no icon(s): ${missing.join(', ')}`);
  /* Each icon: ["svg", attrs, [[tag, attrs], …]] → just the children. */
  return JSON.parse(JSON.stringify(Object.fromEntries(ICONS.map((n) => [n, icons[n][2]]))));
}

/* ---- the build step ---- */

export async function extractAll({ html, lucide }) {
  const strings = await extractStrings(html);
  const tokens = extractTokens(html);
  const icons = extractIcons(lucide);
  return { strings, tokens, icons };
}

async function main() {
  const html = readFileSync(path.join(REPO, 'client', 'index.html'), 'utf8');
  const lucide = readFileSync(path.join(REPO, 'client', 'assets', 'vendor', 'lucide.min.js'), 'utf8');
  const { strings, tokens, icons } = await extractAll({ html, lucide });
  const out = path.join(STUDIO, 'src', 'generated');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, 'packs'), { recursive: true });
  const { packs, ...meta } = strings;
  /* Every language's "Untitled Book": 1.0's imIsPlaceholderTitle treats a stored title equal to any of them as no title. */
  meta.untitledBook = [...new Set(strings.order.map((c) => packs[c]['misc.untitledBook']))];
  writeFileSync(path.join(out, 'strings-meta.json'), JSON.stringify(meta));
  /* One file per language: English is bundled (the fallback), the rest
     load on demand as their own chunks (and are precached for offline). */
  for (const code of strings.order) writeFileSync(path.join(out, 'packs', `${code}.json`), JSON.stringify(packs[code]));
  writeFileSync(path.join(out, 'tokens.css'), tokens.css);
  const env = extractEnvironmentCss(html);
  writeFileSync(path.join(out, 'environment.css'), env.css);
  const cov = extractCovenantCss(html);
  writeFileSync(path.join(out, 'covenant.css'), cov.css);
  const sty = extractStyleCss(html);
  writeFileSync(path.join(out, 'style.css'), sty.css);
  const pvw = extractPreviewCss(html);
  writeFileSync(path.join(out, 'preview.css'), pvw.css);
  const cvr = extractCoverCss(html);
  writeFileSync(path.join(out, 'cover.css'), cvr.css);
  writeFileSync(path.join(out, 'cover-markup.json'), JSON.stringify(extractCoverMarkup(html)));
  writeFileSync(path.join(out, 'local.css'), extractLocalCss(html).css);
  const exp = extractExportCss(html);
  writeFileSync(path.join(out, 'export.css'), exp.css);
  writeFileSync(path.join(out, 'export-markup.json'), JSON.stringify(extractExportMarkup(html)));
  writeFileSync(path.join(out, 'print.css'), extractPrintCss(html).css);
  writeFileSync(path.join(out, 'print-markup.json'), JSON.stringify(extractPrintMarkup(html)));
  writeFileSync(path.join(out, 'import.css'), extractImportCss(html).css);
  writeFileSync(path.join(out, 'import-markup.json'), JSON.stringify(extractImportMarkup(html)));
  writeFileSync(path.join(out, 'cloud.css'), extractCloudCss(html).css);
  writeFileSync(path.join(out, 'cloud-markup.json'), JSON.stringify(extractCloudMarkup(html)));
  writeFileSync(path.join(out, 'icons.json'), JSON.stringify(icons));
  /* 1.0's render code as a browser module (scripts/extract-closure.mjs), written here so the rmSync above never takes it */
  const closure = await writeClosure();
  const keys = Object.keys(strings.packs.en).length;
  console.log(`extract-studio: ${strings.order.length} interface languages × ${keys} keys, RTL: ${strings.rtl.join(', ') || 'none'}; tokens: ${tokens.paper.length} Paper / ${tokens.candlelight.length} Candlelight; ${Object.keys(icons).length} icons; closure: ${closure.names.length} declarations; environment.css: ${env.rules} rules + ${env.extras} at-rules; covenant.css: ${cov.rules} rules + ${cov.extras} at-rules → src/generated/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
