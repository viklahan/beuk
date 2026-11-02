import type * as Y from 'yjs';
import { bookState, closureIfLoaded, pageEnv, structEnv, styleEnv, writeEnv, type Closure, type State } from '../closure/index';
import { setMeta } from '../book/hooks';
import { placeKey } from '../notebook/notebook';
import { repackHistory } from '../history/history';
import { desk } from '../environment/page';
import { onSettleWrites } from '../book/store';
import { pictureSrc } from '../pictures/pictures';
import { readThemes, serializeThemes, writeThemes } from './themes';

/* Step 5 wave 4a (inventory D1, D2): the Style tab — the data side.

   Everything is 1.0's own code (client/index.html "UI: typography studio", BEUK:bookcolour, the flourishes, the
   custom themes and the uploaded fonts), lifted into the browser closure. 1.0's handlers edit its global
   `state.theme`, `activePreset`, `bookColour`, `customThemes`, `fonts`, `images` (a flourish) and, when a face
   leaves, `coverRecipe`. 2.0 runs that code on 1.0's state of the open book (styleRun) and, when the call returns,
   writes into the Y `meta` map exactly what 1.0's serializeBook writes for each of those keys — and only the keys
   whose serialized form changed in the call (constraint 30). So opening the tab, browsing the presets and opening
   the creator write nothing (review focus #4).

   One state per session (as the Covenant's, src/covenant/covenant.ts): while nothing else changes the book and no
   other part of the studio set a state of its own into the shared closure, the next call runs on the very same
   state (the creator's draft and 1.0's handlers keep no references into it, but the session saves a rebuild per
   event). A range dragged or a name typed (an `input` event) is written after 300 ms of quiet, as the Covenant's
   typing; everything else at once.

   The tab's HTML is 1.0's renderers' (innerHTML strings built from the book's values). Some of those values reach
   the markup unescaped in 1.0 (a flourish's mediaType in an <img src>, a font family in a style attribute), and the
   book is untrusted: every innerHTML 1.0 writes into the tab is parsed inert first (a <template>), cleaned (no
   script-bearing element, no on* attribute, an <img> only from 2.0's checked picture URL) and only then put in place
   (safeHtml, through the `$` 1.0's code reaches the tab by). */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The keys the Style tab's code can change, as serializeBook writes them. */
export const STYLE_KEYS = ['theme', 'activePreset', 'colour', 'fonts', 'customThemes', 'images', 'coverRecipe'] as const;
type Key = (typeof STYLE_KEYS)[number];
type Out = Partial<Record<Key, unknown>>;

type Session = { ydoc: Y.Doc; state: State; ver: number; base: Sig; hidden: Hidden };
/** The book values the session hides from 1.0's code (sourceSafe), each with what the book stores, put back whenever
 *  the session writes that list: the book keeps them exactly. */
type Hidden = { images: Map<unknown, Rec>; fonts: Map<unknown, Rec> };
/** Each key's serialized form: JSON for the small ones; for `images` and `fonts`, their fields with the bytes held
 *  by reference (compared with ===: no copy, no hash of megabytes per event). */
type Sig = { json: Partial<Record<Key, string>>; images: unknown[][]; fonts: unknown[][] };

let session: Session | null = null;
const versions = new WeakMap<Y.Doc, { n: number }>();
function verOf(ydoc: Y.Doc): { n: number } {
  let v = versions.get(ydoc);
  if (!v) {
    v = { n: 0 };
    const box = v;
    ydoc.on('afterTransaction', () => {
      box.n++;
    });
    versions.set(ydoc, v);
  }
  return v;
}

/** What 1.0's serializeBook writes for the Style keys of the closure's current state (undefined: no key). */
export function serializedStyle(c: Closure): Out {
  const a = c.api;
  const st = c.getState() as unknown as Rec & { theme: Rec };
  const h = session && session.state === (st as unknown) ? session.hidden : null;
  const back = (list: unknown, m: Map<unknown, Rec> | undefined) => (Array.isArray(list) ? list.map((x) => (m && m.get(x)) ?? x) : []);
  const themeCopy: Rec = Object.assign({}, st.theme);
  if (st.theme.header) themeCopy.header = JSON.parse(JSON.stringify(st.theme.header));
  else delete themeCopy.header;
  return {
    theme: themeCopy,
    activePreset: st.activePreset,
    colour: a.bookColourSet() ? a.bookColour() : undefined,
    fonts: back(st.fonts, h?.fonts).map((f) => a.normalizeCustomFont(f)).filter(Boolean),
    customThemes: serializeThemes(c, st.customThemes),
    images: h && h.images.size ? back(st.images, h.images) : st.images,
    coverRecipe: st.coverRecipe ? a.normalizeCoverRecipe(st.coverRecipe) : null,
  };
}
const SMALL: Key[] = ['theme', 'activePreset', 'colour', 'customThemes', 'coverRecipe'];
function sigOf(out: Out): Sig {
  const json: Sig['json'] = {};
  for (const k of SMALL) json[k] = out[k] === undefined ? 'undefined' : JSON.stringify(out[k]);
  const list = (v: unknown, fields: string[]) => (Array.isArray(v) ? v.map((x) => (isRec(x) ? fields.map((f) => x[f]) : [x])) : []);
  return { json, images: list(out.images, ['id', 'name', 'mediaType', 'ext', 'data', 'flourish', 'credit']), fonts: list(out.fonts, ['id', 'name', 'family', 'ext', 'mediaType', 'data']) };
}
const sameRows = (a: unknown[][], b: unknown[][]) =>
  a.length === b.length && a.every((r, i) => r.length === b[i]!.length && r.every((v, j) => (isRec(v) ? JSON.stringify(v) === JSON.stringify(b[i]![j]) : v === b[i]![j])));
function changedKeys(a: Sig, b: Sig): Key[] {
  const out: Key[] = SMALL.filter((k) => a.json[k] !== b.json[k]);
  if (!sameRows(a.images, b.images)) out.push('images');
  if (!sameRows(a.fonts, b.fonts)) out.push('fonts');
  return out;
}

/** 1.0's state of the open book for the Style tab: the whole book (as applyBookDoc holds it: ARRIVE, plus its
 *  custom themes and active preset lines), set into the closure. */
function build(c: Closure, ydoc: Y.Doc): Session {
  const { book, state } = bookState(c, ydoc);
  const st = state as State & Rec;
  const a = c.api;
  // applyBookDoc's lines ARRIVE (the EPUB build's arrival) leaves out
  st.activePreset = book.activePreset || (book.theme ? null : a.PRESETS[0]!.id);
  st.customThemes = readThemes(c, book.customThemes);
  const hidden = sourceSafe(c, st, book); // book values 1.0's code takes unescaped (below)
  c.setState(st);
  const s: Session = { ydoc, state: st, ver: verOf(ydoc).n, base: { json: {}, images: [], fonts: [] }, hidden };
  session = s;
  s.base = sigOf(serializedStyle(c));
  return s;
}

/** 1.0's state of the open book, current. Null without a book or a closure. */
export function styleEnter(): Closure | null {
  const c = closureIfLoaded();
  const ydoc = desk.ydoc;
  if (!c || !ydoc) return null;
  const s = session;
  if (!(s && s.ydoc === ydoc && s.ver === verOf(ydoc).n && c.getState() === s.state)) {
    if (s && held) styleFlush(); // a held edit is written before the state is built again
    session = build(c, ydoc);
  }
  return c;
}

let flushing = false;
/** True while the session writes (the Style tab's own meta observer leaves those transactions alone). */
export const styleWriting = (): boolean => flushing;

/** Write what 1.0 changed: each Style key whose serialized form changed, as serializeBook writes it. */
export function styleFlush(): void {
  if (held) {
    clearTimeout(held);
    held = null;
  }
  const c = closureIfLoaded();
  const s = session;
  if (!c || !s) return;
  if (c.getState() !== s.state) c.setState(s.state);
  const out = serializedStyle(c);
  const sig = sigOf(out);
  const keys = changedKeys(s.base, sig);
  if (!keys.length) return;
  const y = s.ydoc;
  const write = () => {
    for (const k of keys) {
      if (k === 'images' || k === 'fonts') continue;
      const v = out[k];
      if (k === 'customThemes') {
        writeThemes(y, v);
        continue;
      }
      if (v === undefined) {
        if (y.getMap('meta').has(k)) setMeta(y, k as never, undefined);
      } else {
        placeKey(y, k);
        setMeta(y, k as never, v as never);
      }
    }
  };
  flushing = true;
  try {
    if (keys.includes('images') || keys.includes('fonts')) {
      // History names the book's pictures and fonts: packed again in the same transaction (wave 1a ruling 2)
      repackHistory(c, y, () => {
        write();
        for (const k of ['images', 'fonts'] as const) {
          if (!keys.includes(k)) continue;
          placeKey(y, k);
          setMeta(y, k as never, out[k] as never);
        }
      });
      c.setState(s.state); // repackHistory read the book with bookState, which set its own state: ours stands again
    } else y.transact(() => write());
  } finally {
    flushing = false;
  }
  s.base = sig;
  s.ver = verOf(y).n;
}

/* ---- the toast 1.0's code raises ---- */
type ToastAction = { label: string; ms?: number; onClick: () => void };
export const styleUi: { toast: (msg: string, icon?: string, action?: ToastAction) => void } = { toast: () => undefined };

let depth = 0;
/* ---- the FontFaces the book's own faces became (1.0's registerUploadedFont adds them to document.fonts) ----
   Every face the page gains during a session is the open book's: they are taken out again when the book goes
   (styleRelease), and 1.0's registeredFontIds is cleared, so another book's face of the same family name is its own. */
const owned = new Set<FontFace>();
let facesBefore: Set<FontFace> | null = null;
function pageFaces(): Set<FontFace> | null {
  const set = typeof document !== 'undefined' ? (document as Document & { fonts?: Iterable<FontFace> }).fonts : undefined;
  if (!set || typeof (set as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') return null;
  return new Set(set as Iterable<FontFace>);
}
function noteFaces(): void {
  const before = facesBefore;
  facesBefore = null;
  const now = before && pageFaces();
  if (!before || !now) return;
  for (const f of now) if (!before.has(f)) owned.add(f);
}
let kept: { toast: typeof structEnv.toast; edited: typeof writeEnv.noteBookEdited } | null = null;
let pauseWrite = false;
const PAUSE_MS = 300;
let held: ReturnType<typeof setTimeout> | null = null;
function hold(): void {
  if (held) clearTimeout(held);
  held = setTimeout(() => {
    held = null;
    if (depth > 0) return hold();
    styleFlush();
  }, PAUSE_MS);
}
/** Write a held edit now (nothing when none is held) — also from inside a running call: the write is diff-based, so
 *  the call's own end writes again only what it changes after this. */
export function styleSettle(): void {
  if (held) styleFlush();
}
onSettleWrites(styleSettle);

/** The first half of styleRun, for 1.0's own listeners: the book's state stands, its toast and save are caught; the
 *  returned function (once) writes what changed. Null without a book or a closure. */
export function styleBegin(paused = false): (() => void) | null {
  const c = styleEnter();
  if (!c) return null;
  depth++;
  if (depth === 1) {
    facesBefore = pageFaces();
    kept = { toast: structEnv.toast, edited: writeEnv.noteBookEdited };
    structEnv.toast = (msg, icon, action) => styleUi.toast(msg, icon, action);
    writeEnv.noteBookEdited = () => undefined; // 1.0's save: styleFlush writes when the call returns
    pauseWrite = paused;
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (depth === 1) {
      if (kept) {
        structEnv.toast = kept.toast;
        writeEnv.noteBookEdited = kept.edited;
        kept = null;
      }
      try {
        if (pauseWrite) hold();
        else styleFlush();
      } finally {
        pauseWrite = false;
        depth--;
        noteFaces();
      }
      return;
    }
    depth--;
  };
}

/** 1.0's Style code on the open book: `fn` runs on 1.0's state of it; what it changed is written when it returns.
 *  Undefined without a book or a closure. */
export function styleRun<T>(fn: (c: Closure) => T, paused = false): T | undefined {
  const end = styleBegin(paused);
  if (!end) return undefined;
  try {
    return fn(closureIfLoaded()!);
  } finally {
    end();
  }
}
// 1.0's uploads read their file, then edit the book's state: the FileReader's callbacks run in a session
styleEnv.run = (fn) => void styleRun(() => fn());

/** Forget the session (a test, or the book went). */
export function styleReset(): void {
  if (held) clearTimeout(held);
  held = null;
  session = null;
}
/** The session's state, for the tests. */
export const styleState = (): State | null => session?.state ?? null;

/* ---- 1.0's HTML, made safe before it reaches the tab ----
   An ALLOWLIST of what 1.0's Style renderers write (renderStudio, renderFlourishes, renderMyThemes, renderFonts,
   renderBookColour, fontOptionsHtml, tcBaseOptions, buildCreatorControls, renderTcPreview, ORNAMENTS' SVG): anything
   else — SVG animation (animate, set, animateMotion, animateTransform), use, a, foreignObject, math, style
   elements, scripts, frames — is dropped with its content; an attribute not on the list goes (so are SVG animation
   attributes: values, to, from, by, attributeName). A style attribute keeps only the typographic properties 1.0 sets
   (font-family, size, alignment, casing, margins…, and the swatch's --sw), each with a plain value: no url(), no
   expression, no escape. SVG presentation values are checked by shape. An <img src> stands only as 2.0's own checked
   data: URL for the picture its bytes are (pictureSrc). */
const TAGS = new Set(['div', 'span', 'p', 'b', 'i', 'em', 'strong', 'small', 'br', 'h4', 'button', 'img', 'label', 'select', 'option', 'optgroup', 'input',
  'svg', 'g', 'path', 'rect', 'circle']);
const ATTRS = new Set(['class', 'id', 'title', 'alt', 'role', 'tabindex', 'type', 'value', 'label', 'for', 'min', 'max', 'step', 'checked', 'disabled', 'selected',
  'placeholder', 'xmlns', 'viewbox', 'focusable', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'src', 'style']);
const STYLE_PROPS = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'text-align', 'text-transform', 'letter-spacing',
  'line-height', 'opacity', 'margin', 'margin-top', 'margin-bottom', 'display', '--sw']);
/** A plain CSS value: words, numbers, units, quotes, commas, hashes — nothing that loads or escapes. */
const PLAIN_CSS = /^[\p{L}\p{M}\p{N}\s#.,%'"+_-]*$/u;
const SVG_PAINT = /^(none|currentColor|#[0-9a-f]{3,8}|var\(--[\w-]+(,\s*#[0-9a-f]{3,8})?\))$/i;
const SVG_NUM = /^[-\d.\s,]*$/;
const SVG_PATH = /^[\d\s.,MLHVCSQTAZmlhvcsqtaz+-]*$/;
const MEDIA = /^[\w.+-]+\/[\w.+-]+$/;

function cleanStyle(v: string): string {
  const out: string[] = [];
  for (const decl of v.split(';')) {
    const m = /^\s*(--sw|[a-z-]+)\s*:\s*([\s\S]*?)\s*$/i.exec(decl);
    if (!m) continue;
    const prop = m[1]!.toLowerCase(), val = m[2]!;
    if (STYLE_PROPS.has(prop) && PLAIN_CSS.test(val) && !/url|expression|javascript/i.test(val)) out.push(prop + ':' + val);
  }
  return out.length ? out.join(';') + (/;\s*$/.test(v) ? ';' : '') : '';
}
function cleanAttr(el: Element, name: string, value: string): string | null {
  const n = name.toLowerCase();
  if (n.startsWith('data-') || n.startsWith('aria-')) return /^[\w-]+$/.test(n.slice(5)) ? value : null;
  if (!ATTRS.has(n)) return null;
  if (n === 'style') return cleanStyle(value) || null;
  if (n === 'src') {
    if (el.tagName.toLowerCase() !== 'img') return null;
    const m = /^data:([^;,]*);base64,([A-Za-z0-9+/=]*)$/.exec(value);
    return (m && pictureSrc({ mediaType: m[1], data: m[2] })) || null;
  }
  if (n === 'fill' || n === 'stroke') return SVG_PAINT.test(value) ? value : null;
  if (n === 'd') return SVG_PATH.test(value) ? value : null;
  if (['viewbox', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'opacity'].includes(n)) return SVG_NUM.test(value) ? value : null;
  return value;
}
/** Clean a parsed (inert) fragment in place, by the allowlist. */
export function cleanFragment(root: DocumentFragment | Element): void {
  const walk = (parent: ParentNode) => {
    for (const el of Array.from(parent.children)) {
      if (!TAGS.has(el.tagName.toLowerCase())) {
        el.remove(); // with everything inside it
        continue;
      }
      for (const at of Array.from(el.attributes)) {
        const v = cleanAttr(el, at.name, at.value);
        if (v === null) el.removeAttribute(at.name);
        else if (v !== at.value) el.setAttribute(at.name, v);
      }
      walk(el);
    }
  };
  walk(root);
}
/** 1.0's HTML, parsed inert (a <template>: nothing loads, no handler runs) and cleaned. */
function safeFragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  cleanFragment(tpl.content);
  return tpl.content;
}
/** Put 1.0's HTML into `el`: parsed inert, cleaned, then moved in. */
export function safeHtml(el: Element, html: string): void {
  el.replaceChildren(safeFragment(html));
}
/** insertAdjacentHTML, cleaned: the nodes placed where the HTML would go. */
function safeAdjacent(el: Element, pos: string, html: string): void {
  const frag = safeFragment(html);
  const p = pos.toLowerCase();
  if (p === 'beforebegin') el.before(frag);
  else if (p === 'afterbegin') el.prepend(frag);
  else if (p === 'beforeend') el.append(frag);
  else if (p === 'afterend') el.after(frag);
}
const proxies = new WeakMap<Element, Element>();
/** An element of the Style tab as 1.0's code reaches it: every way of writing HTML into it (innerHTML, outerHTML,
 *  insertAdjacentHTML, setHTMLUnsafe) goes through the cleaner. */
function guarded(el: Element): Element {
  let p = proxies.get(el);
  if (!p) {
    p = new Proxy(el, {
      get(t, k) {
        if (k === 'insertAdjacentHTML') return (pos: string, html: string) => safeAdjacent(t, pos, html);
        if (k === 'setHTMLUnsafe' || k === 'setHTML') return (html: string) => safeHtml(t, html);
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (k === 'innerHTML') safeHtml(t, String(v));
        else if (k === 'outerHTML') t.replaceWith(safeFragment(String(v)));
        else Reflect.set(t, k, v, t);
        return true;
      },
    });
    proxies.set(el, p);
  }
  return p;
}
/** The Style tab's root (StyleTab sets it while mounted). */
export const styleRoot: { el: HTMLElement | null } = { el: null };
const page$ = pageEnv.$;
pageEnv.$ = (id: string) => {
  const el = page$(id);
  return el instanceof Element && styleRoot.el && styleRoot.el.contains(el) ? guarded(el) : el;
};

/* ---- at the source: book values 1.0's code takes unescaped ----
   1.0 puts book values into its markup and its CSS unescaped: a picture's data and mediaType into an <img src>
   (renderStudio, renderFlourishes), a font's data into a FontFace src (registerUploadedFont: url(data:…) — a `)` there
   adds another source), an uploaded face's family into style attributes and @font-face rules, and every theme font name
   into fontStack's quoted string, which becomes the book's stylesheet (buildBookCss). A crafted book could carry
   markup, CSS or a remote request there; 1.0 has the same gap (reported to V). So, in the session's state only:
   - a picture whose data is not base64, or whose mediaType is not a plain media type, and a font whose data is not
     base64 or whose family is not a plain name, are HIDDEN from 1.0's code (not shown, not offered, never a FontFace);
     the book keeps them exactly as stored (the session puts them back whenever it writes that list);
   - a theme font name (body, heading, the header design's three; the book's theme and every custom theme) that is
     neither a library face nor one of the book's shown uploaded families becomes 1.0's own default (removeUploadedFont's
     fallbacks: EB Garamond, Libre Baskerville, the heading face), written only with the next theme write;
   - a font stored without an id gets a stable one (its place: "fx<n>"), not 1.0's random uid on every read. */
export const B64 = /^[A-Za-z0-9+/=\s]*$/;
/** A family name safe in a quoted CSS string, a style attribute and a FontFace: letters (any script), digits, spaces
 *  and . , & ( ) + _ - only. */
export const SAFE_FAMILY = /^[\p{L}\p{M}\p{N} _.,&()+-]+$/u;
/** Wave 4b: a header style as a class name, and an indent as a plain CSS length. */
const PLAIN_ID = /^[\w-]*$/;
const PLAIN_LEN = /^\d*\.?\d+(em|rem|px|pt|%)?$/;
/** Review round 2: the theme's numeric fields, and a number written as a plain decimal string. */
const NUMERIC_THEME = ['fontSize', 'lineHeight', 'dropDepth', 'smallCapsWords'] as const;
const PLAIN_NUM = /^\s*-?\d*\.?\d+\s*$/;
function fontValid(f: unknown): f is Rec {
  return isRec(f) && (f.ext === 'ttf' || f.ext === 'otf') && typeof f.data === 'string' && !!f.data && typeof f.family === 'string' && !!f.family.trim();
}
export function sourceSafe(c: Closure, st: Rec, book: Rec): Hidden {
  const hidden: Hidden = { images: new Map(), fonts: new Map() };
  // stable ids: ARRIVE's normalizeCustomFont kept the valid fonts in order and minted a random id where none was stored
  if (Array.isArray(st.fonts) && Array.isArray(book.fonts)) {
    const raw = book.fonts.filter(fontValid);
    const taken = new Set(raw.map((f) => (typeof f.id === 'string' ? f.id : '')));
    (st.fonts as Rec[]).forEach((f, k) => {
      const r = raw[k];
      if (!r || (typeof r.id === 'string' && r.id)) return;
      let id = 'fx' + (k + 1), n = 1;
      while (taken.has(id)) id = 'fx' + (k + 1) + '-' + ++n;
      taken.add(id);
      f.id = id;
    });
  }
  if (Array.isArray(st.fonts))
    for (const f of st.fonts) {
      if (!isRec(f)) continue;
      if (typeof f.data === 'string' && B64.test(f.data) && typeof f.family === 'string' && SAFE_FAMILY.test(f.family.trim())) continue;
      hidden.fonts.set(f, { ...f });
      f.family = '';
      f.data = '';
    }
  if (Array.isArray(st.images))
    for (const im of st.images) {
      if (!isRec(im)) continue;
      if ((typeof im.data !== 'string' || B64.test(im.data)) && (typeof im.mediaType !== 'string' || MEDIA.test(im.mediaType))) continue;
      hidden.images.set(im, { ...im });
      im.data = '';
      im.mediaType = 'application/octet-stream';
      im.ext = '';
      im.flourish = false;
    }
  // review round 2: the cover (1.0's sectionHtml writes its mediaType unescaped into an <img src>; the hardcover's
  // board wears it) — hidden from 1.0's code when its data is not base64 or its media type not plain. The Style
  // session never writes `cover` (STYLE_KEYS), so the book keeps it exactly.
  if (isRec(st.cover) && !((typeof st.cover.data !== 'string' || B64.test(st.cover.data)) && (typeof st.cover.mediaType !== 'string' || MEDIA.test(st.cover.mediaType)))) st.cover = null;
  // theme font names: a library face or a shown uploaded family, else 1.0's default
  const a = c.api;
  const shown = new Set((Array.isArray(st.fonts) ? st.fonts : []).filter((f) => isRec(f) && f.family).map((f) => String((f as Rec).family).trim()));
  const ok = (v: unknown) => typeof v === 'string' && (a.ALL_LIBRARY_FONTS.includes(v) || shown.has(v));
  const fix = (th: unknown) => {
    if (!isRec(th)) return;
    if (!ok(th.bodyFont)) th.bodyFont = 'EB Garamond';
    if (!ok(th.headFont)) th.headFont = 'Libre Baskerville';
    if (isRec(th.header)) for (const k of a.HD_KEYS) { const e = th.header[k]; if (isRec(e) && !ok(e.font)) e.font = th.headFont; }
    // wave 4b: 1.0 writes these two into the preview's markup and CSS as they are (chapterOpeningHtml's class
    // attribute, buildBookCss's text-indent): a value that is not a plain one becomes 1.0's default
    if (typeof th.headerStyle === 'string' && !PLAIN_ID.test(th.headerStyle)) th.headerStyle = 'classic_centered';
    if (typeof th.indentDepth === 'string' && !PLAIN_LEN.test(th.indentDepth)) th.indentDepth = '1.5em';
    // review round 2: the numbers 1.0's CSS and markup builders interpolate as they are (buildBookCss's font-size,
    // line-height, the drop cap's size and initial-letter; sectionHtml's small-caps count): a finite number, else the
    // default theme's (PRESETS[0], 1.0's starting theme)
    const def = a.PRESETS[0]!.theme as Rec;
    for (const k of NUMERIC_THEME) {
      if (!(k in th)) continue;
      const n = typeof th[k] === 'number' ? (th[k] as number) : typeof th[k] === 'string' && PLAIN_NUM.test(th[k] as string) ? Number(th[k]) : NaN;
      th[k] = Number.isFinite(n) ? n : def[k];
    }
  };
  fix(st.theme);
  if (Array.isArray(st.customThemes)) for (const ct of st.customThemes) if (isRec(ct)) fix(ct.theme);
  return hidden;
}

/** The book went (or another arrives): a held edit is written, the faces it added leave the page, 1.0's record of
 *  registered faces is cleared, and the session is let go. */
export function styleRelease(): void {
  styleSettle();
  if (typeof document !== 'undefined') {
    const set = (document as Document & { fonts?: { delete?: (f: FontFace) => unknown } }).fonts;
    for (const f of owned) set?.delete?.(f);
  }
  owned.clear();
  const c = closureIfLoaded();
  if (c) {
    const reg = c.api.registeredFontIds as Record<string, unknown> | undefined;
    if (reg) for (const k of Object.keys(reg)) delete reg[k];
    c.vars.fontPickerSig = null;
  }
  styleReset();
}
