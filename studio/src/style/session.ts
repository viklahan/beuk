import type * as Y from 'yjs';
import { bookState, closureIfLoaded, pageEnv, structEnv, styleEnv, writeEnv, type Closure, type State } from '../closure/index';
import { setMeta } from '../book/hooks';
import { placeKey } from '../notebook/notebook';
import { repackHistory } from '../history/history';
import { desk } from '../environment/page';
import { onSettleWrites } from '../book/store';
import { pictureSrc } from '../pictures/pictures';

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

type Session = { ydoc: Y.Doc; state: State; ver: number; base: Sig };
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
  const themeCopy: Rec = Object.assign({}, st.theme);
  if (st.theme.header) themeCopy.header = JSON.parse(JSON.stringify(st.theme.header));
  else delete themeCopy.header;
  return {
    theme: themeCopy,
    activePreset: st.activePreset,
    colour: a.bookColourSet() ? a.bookColour() : undefined,
    fonts: (Array.isArray(st.fonts) ? st.fonts : []).map((f) => a.normalizeCustomFont(f)).filter(Boolean),
    customThemes: JSON.parse(JSON.stringify((Array.isArray(st.customThemes) ? st.customThemes : []).map((ct) => a.normalizeCustomTheme(ct)).filter(Boolean))),
    images: st.images,
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
  st.customThemes = Array.isArray(book.customThemes) ? book.customThemes.map((ct) => a.normalizeCustomTheme(ct)).filter(Boolean) : [];
  sourceSafe(st); // book values 1.0's markup takes unescaped (below)
  c.setState(st);
  return { ydoc, state: st, ver: verOf(ydoc).n, base: sigOf(serializedStyle(c)) };
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
/** Write a held edit now (nothing when none is held). */
export function styleSettle(): void {
  if (held && depth === 0) styleFlush();
}
onSettleWrites(styleSettle);

/** The first half of styleRun, for 1.0's own listeners: the book's state stands, its toast and save are caught; the
 *  returned function (once) writes what changed. Null without a book or a closure. */
export function styleBegin(paused = false): (() => void) | null {
  const c = styleEnter();
  if (!c) return null;
  depth++;
  if (depth === 1) {
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
const PLAIN_CSS = /^[\w\s#.,%'"+-]*$/;
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

/* ---- at the source: book values 1.0's markup takes unescaped ----
   1.0 puts an uploaded face's family into style attributes and @font-face rules unescaped (renderFonts,
   renderMyThemes, fontStack) and a flourish's mediaType into an <img src> (renderStudio, renderFlourishes): a book
   could carry markup there (1.0 has the same gap: reported to V). In the session's state, a font whose family is not
   a plain name is refused (left out: never registered, never offered, gone from the book at its next fonts write),
   and a picture's mediaType that is not a plain media type is replaced by what its bytes are (the picture stays;
   written only at the library's next write). Names 1.0 does escape (esc) are left as they are. */
export const PLAIN_FAMILY = /^[\w .-]+$/;
export function sourceSafe(st: Rec): void {
  if (Array.isArray(st.fonts)) st.fonts = st.fonts.filter((f) => isRec(f) && typeof f.family === 'string' && PLAIN_FAMILY.test(f.family.trim()));
  if (Array.isArray(st.images))
    for (const im of st.images) {
      if (!isRec(im) || typeof im.mediaType !== 'string' || MEDIA.test(im.mediaType)) continue;
      const url = pictureSrc(im);
      im.mediaType = url ? url.slice(5, url.indexOf(';')) : 'application/octet-stream';
    }
}
