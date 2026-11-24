import { afterEach, describe, expect, it } from 'vitest';
import {
  PAGES_STYLE_ATTR,
  clampPage,
  countFromScrollWidth,
  keyAction,
  linkTarget,
  pageOfDistance,
  pageOfScroll,
  pagesCss,
  scrollForPage,
  startPager,
  swipeAction,
  tapAction,
  turnTo,
  type Geometry,
  type PagerState,
} from '../src/export/pages';

/* The whole book a page at a time (src/export/pages.ts): the arithmetic of pages, the keys, the presses, and the frame
   driven from the page around it. jsdom lays nothing out, so where a box is read the test says where it is: an element
   with data-page="n" stands on page n of a frame 600 px wide with 22 px of side padding (data-at="x" puts it x px into
   the page's text). What real boxes do is the e2e's (studio/e2e/book.mjs, E2E_ONLY=proof). */

const LTR: Geometry = { step: 600, pad: 22, rtl: false };
const RTL: Geometry = { step: 600, pad: 22, rtl: true };

describe('pages: the arithmetic', () => {
  it('a page number is held inside 1..count, at both ends', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-3, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(7, 10)).toBe(7);
    expect(clampPage(7.4, 10)).toBe(7);
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampPage(Infinity, 10)).toBe(10);
    expect(clampPage(-Infinity, 10)).toBe(1);
    expect(clampPage(5, 0)).toBe(1);
  });
  it('a turn lands on the next or the previous page and stops at the first and the last', () => {
    expect(turnTo(1, 10, 'next')).toBe(2);
    expect(turnTo(10, 10, 'next')).toBe(10);
    expect(turnTo(1, 10, 'prev')).toBe(1);
    expect(turnTo(6, 10, 'prev')).toBe(5);
    expect(turnTo(6, 10, 'first')).toBe(1);
    expect(turnTo(6, 10, 'last')).toBe(10);
    expect(turnTo(1, 1, 'next')).toBe(1);
    expect(turnTo(1, 1, 'last')).toBe(1);
  });
  it('the page of a box is where it starts, over the frame width: text, a picture bled to the edge, the end of a line', () => {
    // text starts one side padding into its page
    expect(pageOfDistance(22, LTR)).toBe(1);
    expect(pageOfDistance(22 + 600, LTR)).toBe(2);
    expect(pageOfDistance(22 + 600 * 681, LTR)).toBe(682);
    // a full-bleed picture starts at the page's own edge
    expect(pageOfDistance(600, LTR)).toBe(2);
    expect(pageOfDistance(0, LTR)).toBe(1);
    // an empty mark at the very end of a line of page 1 (its text ends one padding short of the next page)
    expect(pageOfDistance(600 - 22, LTR)).toBe(1);
    // the same sums serve a right-to-left book: the distance is measured from its own starting edge
    expect(pageOfDistance(22 + 600 * 3, RTL)).toBe(4);
    // no frame to measure: page 1, never a division by nothing
    expect(pageOfDistance(5000, { step: 0, pad: 22, rtl: false })).toBe(1);
  });
  it('a page is shown by a whole number of frame widths: forward in a left-to-right book, backward in a right-to-left one', () => {
    expect(scrollForPage(1, LTR)).toBe(0);
    expect(scrollForPage(2, LTR)).toBe(600);
    expect(scrollForPage(682, LTR)).toBe(681 * 600);
    expect(scrollForPage(1, RTL)).toBe(-0);
    expect(scrollForPage(2, RTL)).toBe(-600);
    expect(scrollForPage(42, RTL)).toBe(-41 * 600);
    expect(pageOfScroll(0, LTR)).toBe(1);
    expect(pageOfScroll(1200, LTR)).toBe(3);
    expect(pageOfScroll(-1200, RTL)).toBe(3);
    // the browser moved the book a little past a page's place: the nearest page
    expect(pageOfScroll(1290, LTR)).toBe(3);
    expect(pageOfScroll(1510, LTR)).toBe(4);
  });
  it('the count read from the scroll width leaves out the one empty column after the book', () => {
    // 40 pages and the spacer, with and without the end padding counted (browsers differ: both give 40)
    expect(countFromScrollWidth(41 * 600, LTR)).toBe(40);
    expect(countFromScrollWidth(41 * 600 - 22, LTR)).toBe(40);
    expect(countFromScrollWidth(0, LTR)).toBe(1);
    expect(countFromScrollWidth(1000, { step: 0, pad: 0, rtl: false })).toBe(1);
  });
});

describe('pages: the keys, a press, a swipe', () => {
  it('the key map, in a left-to-right book', () => {
    const k = (key: string, more: object = {}) => keyAction({ key, ...more }, false);
    expect(k('ArrowRight')).toBe('next');
    expect(k('ArrowLeft')).toBe('prev');
    expect(k('PageDown')).toBe('next');
    expect(k('PageUp')).toBe('prev');
    expect(k(' ')).toBe('next');
    expect(k(' ', { shiftKey: true })).toBe('prev');
    expect(k('Home')).toBe('first');
    expect(k('End')).toBe('last');
    expect(k('f')).toBe('full');
    expect(k('F')).toBe('full');
    // not this view's keys
    for (const key of ['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'a', 'g']) expect(k(key), key).toBeNull();
    // with Ctrl, Alt or the command key a key is the browser's (Ctrl+F finds, Alt+Left goes back)
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) for (const key of ['ArrowRight', 'ArrowLeft', 'f', 'Home', ' ']) expect(k(key, { [mod]: true }), mod + ' ' + key).toBeNull();
  });
  it('in a right-to-left book the arrows mirror; the keys that mean "on" and "back" do not', () => {
    const k = (key: string, more: object = {}) => keyAction({ key, ...more }, true);
    expect(k('ArrowLeft')).toBe('next');
    expect(k('ArrowRight')).toBe('prev');
    expect(k('PageDown')).toBe('next');
    expect(k('PageUp')).toBe('prev');
    expect(k(' ')).toBe('next');
    expect(k(' ', { shiftKey: true })).toBe('prev');
    expect(k('Home')).toBe('first');
    expect(k('End')).toBe('last');
  });
  it("a press on the page's outer third turns; the middle third does nothing (words can be selected there)", () => {
    expect(tapAction(0.9, false)).toBe('next');
    expect(tapAction(0.67, false)).toBe('next');
    expect(tapAction(0.1, false)).toBe('prev');
    expect(tapAction(0.33, false)).toBe('prev');
    for (const f of [0.34, 0.5, 0.66]) expect(tapAction(f, false), String(f)).toBeNull();
    // right to left: the next page is on the left
    expect(tapAction(0.9, true)).toBe('prev');
    expect(tapAction(0.1, true)).toBe('next');
    expect(tapAction(0.5, true)).toBeNull();
    // outside the page
    expect(tapAction(-0.1, false)).toBeNull();
    expect(tapAction(1.2, false)).toBeNull();
    expect(tapAction(Number.NaN, false)).toBeNull();
  });
  it('a swipe turns the way paper does, and only when it is sideways and long enough', () => {
    expect(swipeAction(-80, 5, false)).toBe('next');
    expect(swipeAction(80, 5, false)).toBe('prev');
    expect(swipeAction(-80, 5, true)).toBe('prev');
    expect(swipeAction(80, 5, true)).toBe('next');
    expect(swipeAction(-40, 0, false)).toBeNull(); // too short
    expect(swipeAction(-60, 90, false)).toBeNull(); // more down than across
  });
});

describe('pages: the one style', () => {
  const css = pagesCss(16);
  it('turns the body into columns one page wide inside a fixed height, with whole-pixel paddings and a gap of exactly twice the side padding', () => {
    expect(css).toMatch(/body \{[^}]*height: 100% !important/);
    expect(css).toMatch(/body \{[^}]*max-width: none !important/);
    expect(css).toMatch(/body \{[^}]*margin: 0 !important/);
    expect(css).toMatch(/body \{[^}]*padding: 32px 22px !important/);
    expect(css).toMatch(/body \{[^}]*column-count: 1 !important/);
    expect(css).toMatch(/body \{[^}]*column-gap: 44px !important/);
    expect(css).toMatch(/body \{[^}]*column-fill: auto !important/);
    expect(css).toMatch(/body \{[^}]*overflow: hidden !important/);
    // another body font size: still whole pixels, the gap still twice the padding
    const big = pagesCss(19);
    const pad = Number(/padding: \d+px (\d+)px !important/.exec(big)![1]);
    expect(pad).toBe(27);
    expect(big).toContain(`column-gap: ${2 * pad}px !important`);
    // no font size read (jsdom, a broken style): 16 px
    expect(pagesCss(0)).toBe(css);
    expect(pagesCss(Number.NaN)).toBe(css);
  });
  it("starts every section on a new page, over the standalone page's own more specific rule", () => {
    expect(css).toContain('section.book-section { break-before: column !important; margin-top: 0 !important; }');
  });
  it('holds every picture inside the page and gives a plate a page of its own', () => {
    expect(css).toContain('img, svg, video, canvas { max-height: calc(100vh - 65px) !important; object-fit: contain; }');
    expect(css).toContain('.plate-page { height: calc(100vh - 65px) !important; break-after: column !important; }');
  });
  it('is a stylesheet and nothing else: no script, no address, no import', () => {
    expect(css).not.toMatch(/<|script|url\(|@import|expression|javascript:/i);
  });
});

/* ---- the frame, in jsdom, with its boxes said by the test ---- */
type Stub = { frame: HTMLIFrameElement; doc: Document; body: HTMLElement; states: PagerState[]; fulls: number };
const made: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.remove();
});
function book(html: string, opts: { rtl?: boolean; step?: number } = {}): Stub {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  made.push(frame);
  const doc = frame.contentDocument!;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  if (!doc.head) doc.documentElement.appendChild(doc.createElement('head'));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
  const body = doc.body;
  if (opts.rtl) doc.documentElement.setAttribute('dir', 'rtl');
  body.innerHTML = html;
  const step = opts.step ?? 600, pad = 22;
  const win = doc.defaultView as unknown as { Element: typeof Element; getComputedStyle: typeof getComputedStyle };
  let left = 0;
  Object.defineProperty(body, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) });
  Object.defineProperty(body, 'clientWidth', { configurable: true, get: () => step });
  Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 700 });
  const real = win.getComputedStyle.bind(win);
  win.getComputedStyle = ((el: Element) => {
    const cs = real(el);
    if (el !== body) return cs;
    return new Proxy(cs, { get: (t, k) => (k === 'paddingInlineStart' || k === 'paddingLeft' ? pad + 'px' : k === 'paddingBlockStart' || k === 'paddingTop' ? '32px' : k === 'direction' ? (opts.rtl ? 'rtl' : 'ltr') : k === 'fontSize' ? '16px' : Reflect.get(t, k, t)) });
  }) as typeof getComputedStyle;
  const rect = (x: number, w: number): DOMRect => ({ left: x, right: x + w, x, y: 40, top: 40, bottom: 60, width: w, height: 20, toJSON: () => ({}) }) as DOMRect;
  win.Element.prototype.getClientRects = function (this: Element) {
    if (this === body) return [] as unknown as DOMRectList;
    const pages = (this.getAttribute('data-pages') ?? this.getAttribute('data-page') ?? '').split('-').filter(Boolean).map(Number);
    if (!pages.length) return [] as unknown as DOMRectList;
    const at = Number(this.getAttribute('data-at') ?? 0);
    const out: DOMRect[] = [];
    for (let p = pages[0]!; p <= (pages[1] ?? pages[0]!); p++) {
      // where a box of page p stands in the frame's window, for the scroll as it is
      const from = (p - 1) * step + pad + at;
      out.push(opts.rtl ? rect(step - from - 10 - left, 10) : rect(from - left, 10));
    }
    return out as unknown as DOMRectList;
  };
  win.Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this === body) return rect(0, step);
    return (this.getClientRects()[0] as DOMRect | undefined) ?? rect(0, 0);
  };
  return { frame, doc, body, states: [], fulls: 0 };
}
const SECTIONS =
  '<section class="book-section" data-pages="1-1"><p data-page="1">Cover</p></section>' +
  '<section class="book-section" data-pages="2-5"><p data-page="2">One<a id="ref" data-page="3" href="#fn1"><sup>1</sup></a> <a id="toc" data-page="2" href="#ch2">Chapter Two</a> <a id="hash" data-page="4" href="#">top</a> <a id="gone" data-page="4" href="#nowhere">nowhere</a></p>' +
  '<p><a id="out" data-page="4" href="https://example.org/a">a site</a></p></section>' +
  '<section class="book-section" data-pages="6-9"><h1 id="ch2" data-page="6">Two</h1><p id="fn1" data-page="9">A note <a id="back" data-page="9" href="#ref">back</a></p></section>';
function paged(s: Stub) {
  const p = startPager(s.frame, (st) => s.states.push(st), () => void s.fulls++)!;
  expect(p).not.toBeNull();
  return p;
}
const press = (s: Stub, id: string, init: MouseEventInit = {}) => {
  const W = s.doc.defaultView as unknown as typeof globalThis;
  const ev = new W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  s.doc.getElementById(id)!.dispatchEvent(ev);
  return ev;
};
const key = (s: Stub, k: string, init: KeyboardEventInit = {}) => {
  const W = s.doc.defaultView as unknown as typeof globalThis;
  const ev = new W.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  s.body.dispatchEvent(ev);
  return ev;
};

describe('pages: the frame, paged from the page around it', () => {
  it('adds one <style> and never a <script>; the count is where the last section ends; page 1 is shown', () => {
    const s = book(SECTIONS);
    const p = paged(s);
    const styles = s.doc.querySelectorAll('style');
    expect(styles.length).toBe(1);
    expect(styles[0]!.hasAttribute(PAGES_STYLE_ATTR)).toBe(true);
    expect(styles[0]!.textContent).toBe(pagesCss(16));
    expect(s.doc.scripts.length).toBe(0);
    expect(s.doc.querySelectorAll('script').length).toBe(0);
    expect(p.state()).toMatchObject({ page: 1, count: 9, rtl: false });
    expect(s.body.scrollLeft).toBe(0);
    expect(s.states.at(-1)).toMatchObject({ page: 1, count: 9 });
  });
  it('turns by the keys heard in the frame, held at both ends, and F asks for full screen once', () => {
    const s = book(SECTIONS);
    const p = paged(s);
    const walk = (keys: [string, KeyboardEventInit?][]) => keys.map(([k, init]) => (key(s, k, init), p.state().page));
    expect(walk([['ArrowLeft'], ['ArrowRight'], ['ArrowRight'], ['PageDown'], ['PageUp'], [' '], [' ', { shiftKey: true }], ['End'], ['ArrowRight'], ['Home']])).toEqual([1, 2, 3, 4, 3, 4, 3, 9, 9, 1]);
    expect(s.body.scrollLeft).toBe(0);
    key(s, 'End');
    expect(s.body.scrollLeft).toBe(8 * 600);
    // a key this view takes is not also the browser's; one it does not take is left alone
    expect(key(s, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(key(s, 'Escape').defaultPrevented).toBe(false);
    expect(key(s, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(s.fulls).toBe(0);
    expect(key(s, 'f').defaultPrevented).toBe(true);
    key(s, 'f', { repeat: true }); // held down: one request
    expect(s.fulls).toBe(1);
    expect(s.doc.querySelectorAll('script').length).toBe(0);
  });
  it('a link inside the book turns to the page that holds what it names, and the way back returns', () => {
    const s = book(SECTIONS);
    const p = paged(s);
    p.go(3);
    const ev = press(s, 'ref'); // the note's mark, on page 3
    expect(ev.defaultPrevented).toBe(true); // this view's turn, not the browser's jump to wherever
    expect(p.state().page).toBe(9);
    expect(s.body.scrollLeft).toBe(8 * 600);
    expect(press(s, 'back').defaultPrevented).toBe(true);
    expect(p.state().page).toBe(3);
    // the contents list
    press(s, 'toc');
    expect(p.state().page).toBe(6);
    // a bare "#" is the top of the book
    press(s, 'hash');
    expect(p.state().page).toBe(1);
    // a name nothing has: no turn, and still not the browser's jump
    p.go(4);
    expect(press(s, 'gone').defaultPrevented).toBe(true);
    expect(p.state().page).toBe(4);
  });
  it('a link that leaves the book, already stopped where it was pressed, turns nothing', () => {
    const s = book(SECTIONS);
    // the proof's own listener (Proof.tsx), put on the frame's document before the pager's: it stops the link
    let stopped = 0;
    s.doc.addEventListener('click', (e) => {
      const a = (e.target as Element).closest('a');
      if (a && !(a.getAttribute('href') ?? '').startsWith('#')) {
        e.preventDefault();
        stopped++;
      }
    });
    const p = paged(s);
    p.go(4);
    const ev = press(s, 'out', { clientX: 590 }); // in the page's outer third, where a plain press would turn
    expect(stopped).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(p.state().page).toBe(4);
    expect(s.body.scrollLeft).toBe(3 * 600);
  });
  it("a plain press turns from the page's outer thirds only; a press with a key held, another button, or words selected does not", () => {
    const s = book(SECTIONS.replace('<p><a id="out"', '<p id="plain" data-page="4">Plain words.</p><p><a id="out"'));
    const p = paged(s);
    p.go(4);
    const at = (x: number, init: MouseEventInit = {}) => (press(s, 'plain', { clientX: x, ...init }), p.state().page);
    expect(at(300)).toBe(4);
    expect(at(560)).toBe(5);
    expect(at(40)).toBe(4);
    expect(at(560, { ctrlKey: true })).toBe(4);
    expect(at(560, { shiftKey: true })).toBe(4);
    expect(at(560, { button: 1 })).toBe(4);
    const sel = s.doc.defaultView!.getSelection()!;
    sel.selectAllChildren(s.doc.getElementById('plain')!);
    expect(sel.isCollapsed).toBe(false);
    expect(at(560)).toBe(4);
    sel.removeAllRanges();
    expect(at(560)).toBe(5);
  });
  it('a right-to-left book: the pages run leftward, the arrows and the outer thirds mirror, and a link still finds its page', () => {
    const s = book(SECTIONS.replace('<p><a id="out"', '<p id="plain" data-page="2">Plain words.</p><p><a id="out"'), { rtl: true });
    const p = paged(s);
    expect(p.state()).toMatchObject({ page: 1, count: 9, rtl: true });
    key(s, 'ArrowLeft');
    expect(p.state().page).toBe(2);
    expect(s.body.scrollLeft).toBe(-600);
    key(s, 'ArrowRight');
    expect(p.state().page).toBe(1);
    p.go(2);
    press(s, 'plain', { clientX: 40 }); // the left third: on
    expect(p.state().page).toBe(3);
    press(s, 'plain', { clientX: 560 }); // the right third: back
    expect(p.state().page).toBe(2);
    press(s, 'ref');
    expect(p.state().page).toBe(9);
    expect(s.body.scrollLeft).toBe(-8 * 600);
  });
  it('the focus moving to a link on another page (Tab) turns to that page', () => {
    const s = book(SECTIONS);
    const p = paged(s);
    const W = s.doc.defaultView as unknown as typeof globalThis;
    s.doc.getElementById('back')!.dispatchEvent(new W.FocusEvent('focusin', { bubbles: true }));
    expect(p.state().page).toBe(9);
  });
  it('stop takes the style away and leaves the frame as it was: no style, no script, the scroll at its start', () => {
    const s = book(SECTIONS);
    const before = s.doc.documentElement.outerHTML;
    const p = paged(s);
    p.go(6);
    p.stop();
    expect(s.doc.querySelectorAll('style').length).toBe(0);
    expect(s.doc.querySelectorAll('script').length).toBe(0);
    expect(s.body.scrollLeft).toBe(0);
    expect(s.doc.documentElement.outerHTML).toBe(before);
    // and it no longer listens: a key turns nothing, a link is the browser's own again
    const n = s.states.length;
    expect(key(s, 'ArrowRight').defaultPrevented).toBe(false);
    expect(press(s, 'ref').defaultPrevented).toBe(false);
    expect(s.states.length).toBe(n);
  });
  it('linkTarget finds what a "#..." names: by id, with the escapes read, then by name', () => {
    const s = book('<p id="s9-fn1">a</p><p id="café">b</p><a name="old">c</a>');
    expect(linkTarget(s.doc, '#s9-fn1')).toBe(s.doc.getElementById('s9-fn1'));
    expect(linkTarget(s.doc, '#caf%C3%A9')).toBe(s.doc.getElementById('café'));
    expect(linkTarget(s.doc, '#old')).toBe(s.doc.querySelector('a[name="old"]'));
    expect(linkTarget(s.doc, '#')).toBeNull();
    expect(linkTarget(s.doc, '#none')).toBeNull();
    expect(linkTarget(s.doc, '#%E0%A4%A')).toBeNull(); // a broken escape: read as written, and nothing has that name
  });
});
