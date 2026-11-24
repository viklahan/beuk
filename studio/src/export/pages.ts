/* The whole book a page at a time (V, 2026-11-24: "shouldn't we show them the actual book on full screen, like they can
   flip the entire book"): the proof's framed book (src/export/Proof.tsx), paged from the page around it.

   The frame is the same frame and holds the same string: 1.0's buildStandaloneHtml() for the open book, in a frame that
   runs no script. Nothing here adds one. The page around the frame adds ONE <style> to the frame's document (marked
   data-beuk-pages), and that style turns the book's <body> into CSS columns one page wide inside a fixed height, with
   nothing shown beyond its own box. A page is turned by setting the body's scrollLeft to a whole number of pages. Take
   the style away and the frame is the one long scroll again (the "Scroll" side of the switch).

   Why each line of the style is there (measured in Chromium on the fixture books, 2026-11-24):
   - html, body: the standalone page's own body rule (max-width 38em, margin auto, padding 2.5em 1.4em 4em) is overridden
     whole; the body is as tall as the frame and its side padding is the standalone page's own 1.4em (to the whole
     pixel), so a full-bleed picture (the standalone page gives it margins of -1.4em) still reaches the page's edge.
     column-count 1 with column-fill auto: one column fills the frame, and what does not fit goes into further columns
     of the same width to the side. The gap between columns is twice the side padding, so one page and its gap are
     exactly the frame's width: page n starts at (n - 1) frame widths. Both paddings are whole pixels and the frame's
     width is read to the fraction, so the pages of a long book do not drift from that sum.
   - section.book-section: every section starts a new page (in the EPUB each is a file of its own, which a reader starts
     on a new page). The standalone page's own rule, `section.book-section + section.book-section { page-break-before:
     always; margin-top: 3em }`, is more specific than a plain `section.book-section` rule and asks for a PAGE break,
     which columns on a screen do not honour: with only `break-before: column` added, every section after the first ran
     on in the column where the last one ended (measured: the half title and the title page shared page 2). So the break
     and the margin are both set here with !important.
   - body::after: one empty column after the book. A browser that does not count the body's end padding in what can be
     scrolled could not reach the last page's exact place without it; with it every page's place is inside the range.
     It is never a page of the book: the count is read from where the last section ends, not from the scroll width.
   - pictures: nothing replaced (img, svg, video, canvas) is taller than the page, and a picture held shorter keeps its
     shape (object-fit: contain, which 1.0's own rule for a plate that fills its page still overrides).
   - .plate-page: 1.0 gives a plate `height: 100%` (of the reader's page, in an EPUB). Here it is the page's height, so
     the plate has a page of its own and fills it as 1.0's stylesheet says (a plate that fills is cropped to the page, a
     "whole" plate is shown whole). One pixel short of the page, so a rounding never pushes it to the next one.

   Counting and finding are done from the page around the frame, by reading boxes (getClientRects): the page of an
   element is where its first box starts, over the frame's width. In a right-to-left book the columns run leftward and
   scrollLeft counts down from 0; everything is measured from the book's own starting edge, so one formula serves both. */

/** The mark on the one <style> this file adds to the framed book. */
export const PAGES_STYLE_ATTR = 'data-beuk-pages';
/** The page's padding, in the book's own em: the standalone page's side padding, and the space above and below. */
export const PAGE_PAD_INLINE_EM = 1.4;
export const PAGE_PAD_BLOCK_EM = 2;

/** The style that pages the framed book. `em` is the book body's font size in px (read from the frame). */
export function pagesCss(em: number): string {
  const e = em > 0 && Number.isFinite(em) ? em : 16;
  // whole pixels: the gap must be exactly twice the side padding, or the pages drift apart from the frame's width by
  // the rounding, a little more on every page (a long book has hundreds)
  const px = Math.max(1, Math.round(PAGE_PAD_INLINE_EM * e));
  const py = Math.max(1, Math.round(PAGE_PAD_BLOCK_EM * e));
  const tall = `calc(100vh - ${2 * py + 1}px)`;
  return [
    'html { height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }',
    'html, body { touch-action: pan-y pinch-zoom; }',
    `body { box-sizing: border-box !important; height: 100% !important; min-height: 0 !important; max-height: none !important; width: auto !important; min-width: 0 !important; max-width: none !important; margin: 0 !important; padding: ${py}px ${px}px !important; column-count: 1 !important; column-width: auto !important; column-gap: ${2 * px}px !important; column-fill: auto !important; column-rule: none !important; overflow: hidden !important; }`,
    'section.book-section { break-before: column !important; margin-top: 0 !important; }',
    'body::after { content: ""; display: block; break-before: column; height: 1px; }',
    `img, svg, video, canvas { max-height: ${tall} !important; object-fit: contain; }`,
    `.plate-page { height: ${tall} !important; break-after: column !important; }`,
  ].join('\n');
}

/** What a page's place is counted in: the frame's width (one page and its gap), the side padding, the book's direction. */
export type Geometry = { step: number; pad: number; rtl: boolean };

/** `n` held inside 1..count. */
export function clampPage(n: number, count: number): number {
  const c = Math.max(1, Math.floor(count) || 1);
  if (!Number.isFinite(n)) return n > 0 ? c : 1;
  return Math.min(c, Math.max(1, Math.round(n)));
}
/** The page that holds a box starting `d` px from the book's starting edge (the left edge of page 1 in a left-to-right
 *  book, the right edge in a right-to-left one). A box bled to the page's edge (d = a whole number of pages) and a box
 *  at the very end of a line (d = a page's text edge) are both on the page they are seen on. */
export function pageOfDistance(d: number, g: Geometry): number {
  if (!(g.step > 0)) return 1;
  return Math.max(1, Math.floor((d + g.pad - 1) / g.step) + 1);
}
/** The scrollLeft that shows page `page`: forward is positive in a left-to-right book and negative in a right-to-left one. */
export function scrollForPage(page: number, g: Geometry): number {
  return (g.rtl ? -1 : 1) * (Math.max(1, page) - 1) * g.step;
}
/** The page a scrollLeft is nearest to. */
export function pageOfScroll(scrollLeft: number, g: Geometry): number {
  if (!(g.step > 0)) return 1;
  return Math.max(1, Math.round(Math.abs(scrollLeft) / g.step) + 1);
}
/** How many pages the book has, from the scroll width alone (used only where no box can be read): one column is the
 *  spacer after the book. */
export function countFromScrollWidth(scrollWidth: number, g: Geometry): number {
  if (!(g.step > 0)) return 1;
  return Math.max(1, Math.ceil((scrollWidth - g.pad - 1) / g.step) - 1);
}

export type Turn = 'next' | 'prev' | 'first' | 'last';
/** The page a turn lands on, held at both ends. */
export function turnTo(page: number, count: number, turn: Turn): number {
  if (turn === 'first') return 1;
  if (turn === 'last') return clampPage(count, count);
  return clampPage(page + (turn === 'next' ? 1 : -1), count);
}

type KeyLike = { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean };
/** What a key does in the paged book. The arrows follow the book: in a right-to-left book the next page is to the left.
 *  PageDown and Space go on, PageUp and Shift+Space go back, Home and End go to the ends, F is full screen. A key held
 *  with Ctrl, Alt or the command key is the browser's. */
export function keyAction(e: KeyLike, rtl: boolean): Turn | 'full' | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.key) {
    case 'ArrowRight':
      return rtl ? 'prev' : 'next';
    case 'ArrowLeft':
      return rtl ? 'next' : 'prev';
    case 'PageDown':
      return 'next';
    case 'PageUp':
      return 'prev';
    case ' ':
    case 'Spacebar':
      return e.shiftKey ? 'prev' : 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'f':
    case 'F':
      return 'full';
    default:
      return null;
  }
}
/** A click or tap `fraction` of the way across the page (0 at its left edge, 1 at its right): the outer third on the
 *  side the book goes on turns forward, the outer third on the other side turns back, the middle does nothing (so a
 *  word can be pressed and selected there). 1.0's hardcover uses the same thirds. */
export function tapAction(fraction: number, rtl: boolean): Turn | null {
  if (!(fraction >= 0 && fraction <= 1)) return null;
  const outerEnd = fraction > 0.66, outerStart = fraction < 0.34;
  if (!outerEnd && !outerStart) return null;
  return outerEnd !== rtl ? 'next' : 'prev';
}
/** A swipe of `dx` px (negative: the finger went leftward): the page follows the finger, as paper does. */
export const SWIPE_PX = 40;
export function swipeAction(dx: number, dy: number, rtl: boolean): Turn | null {
  if (Math.abs(dx) <= SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 !== rtl ? 'next' : 'prev';
}

/* ---- the frame, driven from the page around it ---- */

export type PagerState = { page: number; count: number; rtl: boolean; /** ms the first paging of the book took */ ms: number };
export type Pager = {
  state: () => PagerState;
  go: (page: number) => void;
  turn: (turn: Turn) => void;
  /** Count again and keep the reader's place by what stood at the top of the page (a new window size, late fonts). */
  repage: () => void;
  /** Take the paging away: the frame is the one long scroll again, at the place the reader was. */
  stop: () => void;
};
type Anchor = { node: Node; offset: number };
type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** The in-book link pressed at `at`, if any: an <a> or <area> whose address is this page's own with a "#..." part. */
function hashOfLink(at: EventTarget | null, doc: Document): string | null {
  const el = at as Element | null;
  const a = el && typeof el.closest === 'function' ? el.closest('a, area') : null;
  if (!a) return null;
  const raw = a.getAttribute('href') ?? a.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (raw === null) return null;
  const s = raw.trim();
  if (s.startsWith('#')) return s;
  try {
    const to = new URL(s, doc.baseURI), here = new URL(doc.URL);
    const hash = to.hash;
    to.hash = '';
    here.hash = '';
    return to.href === here.href ? hash || '#' : null;
  } catch {
    return null;
  }
}
/** The element a "#..." names in `doc`: by id, then by name (as the browser looks it up); null for a bare "#". */
export function linkTarget(doc: Document, hash: string): Element | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* as written */
  }
  return doc.getElementById(id) ?? doc.getElementById(raw) ?? doc.getElementsByName(id)[0] ?? null;
}

/** Page the book in `frame` (its document has loaded). `onChange` hears every change of page or count; `onFull` hears F.
 *  Null when the frame's document cannot be reached. */
export function startPager(frame: HTMLIFrameElement, onChange: (s: PagerState) => void, onFull: () => void): Pager | null {
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    doc = null;
  }
  const win = doc?.defaultView ?? null;
  if (!doc || !doc.body || !win) return null;
  const book = doc, body = doc.body;
  const off: (() => void)[] = [];
  const on = (target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, opts);
    off.push(() => target.removeEventListener(type, fn, opts));
  };

  /* -- boxes -- */
  const geometry = (): Geometry => {
    const cs = win.getComputedStyle(body);
    // the body's own width, to the fraction: one page and its gap (clientWidth is rounded, and a rounded step drifts)
    const wide = body.getBoundingClientRect().width || body.clientWidth;
    return { step: wide, pad: parseFloat(cs.paddingInlineStart || cs.paddingLeft) || 0, rtl: cs.direction === 'rtl' };
  };
  /** How far a box starts from the book's starting edge (see pageOfDistance). */
  const distance = (r: Pick<DOMRect, 'left' | 'right'>, g: Geometry): number => {
    if (g.rtl) return g.step - r.right - body.scrollLeft;
    return r.left + body.scrollLeft;
  };
  const firstBox = (el: Element | null): DOMRect | null => {
    for (let at: Element | null = el; at && at !== body && at !== book.documentElement; at = at.parentElement) {
      const r = at.getClientRects()[0];
      if (r && (r.width > 0 || r.height > 0)) return r;
    }
    return null;
  };
  const pageOfEl = (el: Element | null, g: Geometry): number | null => {
    const r = firstBox(el);
    return r ? pageOfDistance(distance(r, g), g) : null;
  };
  const countPages = (g: Geometry): number => {
    const last = body.lastElementChild;
    const rs = last ? last.getClientRects() : null;
    const r = rs && rs.length ? rs[rs.length - 1]! : null;
    if (r && (r.width > 0 || r.height > 0)) return pageOfDistance(distance(r, g), g);
    return countFromScrollWidth(body.scrollWidth, g);
  };

  /* -- the reader's place: what stands at the top of the page, as a place in the text -- */
  /** `paged`: the book is in pages (the top of the page is under the body's own padding); else it is the one long scroll
   *  (the top of the window). The place is read just inside the text's starting edge. */
  const anchorNow = (g: Geometry, paged: boolean): Anchor | null => {
    const d = book as CaretDoc;
    const cs = win.getComputedStyle(body);
    const top = paged ? parseFloat(cs.paddingBlockStart || cs.paddingTop) || 0 : 0;
    const box = body.getBoundingClientRect();
    const x = g.rtl ? box.right - g.pad - 3 : box.left + g.pad + 3;
    const high = paged ? body.clientHeight : win.innerHeight;
    // (in the scroll the first line may be cut by the window's top edge, and stop() below leaves the place 12 px down)
    for (let y = top + (paged ? 3 : 16); y < high; y += 14) {
      let node: Node | null = null, offset = 0;
      try {
        if (typeof d.caretPositionFromPoint === 'function') {
          const p = d.caretPositionFromPoint(x, y);
          if (p) {
            node = p.offsetNode;
            offset = p.offset;
          }
        } else if (typeof d.caretRangeFromPoint === 'function') {
          const r = d.caretRangeFromPoint(x, y);
          if (r) {
            node = r.startContainer;
            offset = r.startOffset;
          }
        }
        if (!node && typeof book.elementFromPoint === 'function') node = book.elementFromPoint(x, y);
      } catch {
        node = null;
      }
      if (node && node !== body && node !== book.documentElement && node !== book && body.contains(node)) return { node, offset };
    }
    return null;
  };
  const boxOfAnchor = (a: Anchor): DOMRect | null => {
    if (!a.node.isConnected) return null;
    if (a.node.nodeType === 3) {
      const len = (a.node.nodeValue ?? '').length;
      try {
        const r = book.createRange();
        const at = Math.min(a.offset, Math.max(0, len - 1));
        r.setStart(a.node, at);
        r.setEnd(a.node, Math.min(len, at + 1));
        const box = r.getClientRects()[0];
        if (box) return box;
      } catch {
        /* the text changed under it: its element instead */
      }
      return firstBox(a.node.parentElement);
    }
    const el = a.node as Element;
    const kid = el.childNodes ? el.childNodes[a.offset] : null;
    return firstBox(kid && kid.nodeType === 1 ? (kid as Element) : el);
  };

  /* -- the place before the paging: where the one long scroll stood -- */
  const scroller = book.scrollingElement ?? book.documentElement;
  let anchor: Anchor | null = null;
  if (scroller.scrollTop > 0) anchor = anchorNow(geometry(), false);

  /* -- the one style -- */
  const t0 = performance.now();
  const style = book.createElement('style');
  style.setAttribute(PAGES_STYLE_ATTR, '');
  style.textContent = pagesCss(parseFloat(win.getComputedStyle(body).fontSize) || 16);
  (book.head ?? book.documentElement).appendChild(style);
  scroller.scrollTop = 0;

  let g = geometry();
  let count = countPages(g);
  const ms = performance.now() - t0;
  let page = 1;
  /** The scrollLeft this file last set: anything else is the browser's own (a focus brought into view, a find). */
  let want = 0;
  const state = (): PagerState => ({ page, count, rtl: g.rtl, ms });
  const place = () => {
    want = scrollForPage(page, g);
    if (body.scrollLeft !== want) body.scrollLeft = want;
    if (body.scrollTop !== 0) body.scrollTop = 0;
  };
  const go = (n: number) => {
    page = clampPage(n, count);
    place();
    anchor = anchorNow(g, true);
    onChange(state());
  };
  const repage = () => {
    g = geometry();
    count = countPages(g);
    const box = anchor ? boxOfAnchor(anchor) : null;
    page = clampPage(box ? pageOfDistance(distance(box, g), g) : page, count);
    place();
    onChange(state());
  };
  if (anchor) repage();
  else go(1);

  /* -- what the reader does in the book -- */
  // the browser moved the book itself (Tab brought a link into view, a find): the page that holds it, exactly
  on(body, 'scroll', () => {
    if (Math.abs(body.scrollLeft - want) < 1 && body.scrollTop === 0) return;
    const held = book.activeElement && book.activeElement !== body ? pageOfEl(book.activeElement, g) : null;
    go(held ?? pageOfScroll(body.scrollLeft, g));
  });
  on(book, 'focusin', (e) => {
    const p = pageOfEl(e.target as Element | null, g);
    if (p !== null && p !== page) go(p);
  });
  on(book, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.defaultPrevented) return;
    const act = keyAction(k, g.rtl);
    if (!act) return;
    k.preventDefault();
    if (act === 'full') {
      if (!k.repeat) onFull();
    } else go(turnTo(page, count, act));
  });
  let down: { x: number; y: number; touch: boolean } | null = null;
  let swiped = false;
  on(book, 'pointerdown', (e) => {
    const p = e as PointerEvent;
    down = { x: p.clientX, y: p.clientY, touch: p.pointerType === 'touch' || p.pointerType === 'pen' };
    swiped = false;
  });
  on(book, 'pointercancel', () => {
    down = null;
  });
  on(book, 'pointerup', (e) => {
    const p = e as PointerEvent;
    const from = down;
    down = null;
    if (!from || !from.touch) return;
    const act = swipeAction(p.clientX - from.x, p.clientY - from.y, g.rtl);
    if (!act) return;
    swiped = true;
    setTimeout(() => {
      swiped = false;
    }, 0);
    go(turnTo(page, count, act));
  });
  on(book, 'click', (e) => {
    const m = e as MouseEvent;
    if (m.defaultPrevented) return; // a link out of the book, stopped where it was pressed (Proof.tsx)
    const hash = hashOfLink(m.target, book);
    if (hash !== null) {
      // a link inside the book: the page that holds what it names (the browser's own jump would stop anywhere)
      m.preventDefault();
      // (a bare "#", or "#top" where nothing has that name, is the top of the book, as in a browser)
      const to = linkTarget(book, hash);
      const p = to ? pageOfEl(to, g) : /^#(top)?$/i.test(hash) ? 1 : null;
      if (p !== null) go(p);
      return;
    }
    if (swiped || m.button !== 0 || m.ctrlKey || m.metaKey || m.altKey || m.shiftKey) return;
    const sel = typeof win.getSelection === 'function' ? win.getSelection() : null;
    if (sel && !sel.isCollapsed) return; // words were just selected: not a turn
    const act = g.step > 0 ? tapAction(m.clientX / g.step, g.rtl) : null;
    if (act) go(turnTo(page, count, act));
  });
  // the window (or full screen) changed the page's size: counted again, the place kept
  let queued = 0;
  const later = () => {
    if (queued) return;
    const run = () => {
      queued = 0;
      repage();
    };
    queued = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
  };
  on(win, 'resize', later);
  off.push(() => {
    if (queued && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(queued);
    queued = 0;
  });
  let live = true;
  off.push(() => {
    live = false;
  });
  const fonts = (book as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
  if (fonts && fonts.ready && typeof fonts.ready.then === 'function') void fonts.ready.then(() => live && later(), () => undefined);

  return {
    state,
    go,
    turn: (turn) => go(turnTo(page, count, turn)),
    repage,
    stop: () => {
      const held = anchor;
      off.splice(0).forEach((f) => f());
      body.scrollLeft = 0;
      style.remove();
      const box = held ? boxOfAnchor(held) : null;
      if (box) scroller.scrollTop = Math.max(0, scroller.scrollTop + box.top - 12);
    },
  };
}
