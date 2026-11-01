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
  'Eye', 'Library', 'BookmarkPlus', 'FilePlus2', 'LayoutGrid', 'Table2', 'Filter', 'Tag', 'Move', 'PencilLine'];

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
  writeFileSync(path.join(out, 'icons.json'), JSON.stringify(icons));
  /* 1.0's render code as a browser module (scripts/extract-closure.mjs), written here so the rmSync above never takes it */
  const closure = await writeClosure();
  const keys = Object.keys(strings.packs.en).length;
  console.log(`extract-studio: ${strings.order.length} interface languages × ${keys} keys, RTL: ${strings.rtl.join(', ') || 'none'}; tokens: ${tokens.paper.length} Paper / ${tokens.candlelight.length} Candlelight; ${Object.keys(icons).length} icons; closure: ${closure.names.length} declarations → src/generated/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
