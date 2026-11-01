/* ==== BEUK:tips ==== — one tooltip for the whole studio, ported from 1.0
   (client/index.html, "BEUK:tips", tipInit and friends) with its behaviour
   unchanged:
   - Declarative: data-tip="i18n.key" (optional data-tip-place = top |
     bottom | start | end) on any element.
   - Help-style title attributes are absorbed: a title set in the markup, by
     setAttribute or by el.title = … moves into data-tip-text (the element's
     .title still reads it back), so the browser's own tooltip never shows.
   - An icon-only button with an accessible name and no tip of its own shows
     that name.
   - Hover after a short delay, at once on keyboard focus, a long press on
     touch screens; Escape dismisses it; it sits beside the control (never
     over it), flips at the screen edges, follows the page direction and is
     wired to its control by aria-describedby while shown.
   - Title stays where it means something to the browser itself.
   The only change: 1.0 reads its own t() and UI_STRINGS; this module is
   handed the studio's t() and the English key set (installTips). Like 1.0,
   it exposes window.beukTips (the self-checks' handle, used by the e2e). */

type T = (key: string, params?: Record<string, unknown>) => string;
export type TipsOptions = { t: T; hasKey: (key: string) => boolean };
type Cur = { el: HTMLElement; via: string; wired: boolean };

const TIP_KEEP_TAGS: Record<string, 1> = { IFRAME: 1, FRAME: 1, ABBR: 1, DFN: 1, LINK: 1, STYLE: 1, META: 1, OPTION: 1, OPTGROUP: 1, TITLE: 1 };
const TIP_KEEP_SCOPE = '[data-keep-titles], .fc-page, .piv-book';
export const TIP_DELAY = 450, TIP_WARM = 90, TIP_LONGPRESS = 500, TIP_TOUCH_HOLD = 3500;
/* dynamic controls (drawn by their own renderers) get their tip here (1.0's list; none of them exist in 2.0 yet) */
const TIP_MAP: [string, string][] = [
  ['#btnBetaComments', 'tips.comments'],
  ["#deviceBar .dev-btn[data-device]:not([data-device='hardcover'])", 'tips.device'],
  ["#deviceBar .dev-btn[data-device='hardcover']", 'tips.deviceHardcover'],
];

export type TipsApi = {
  show: (el: HTMLElement, via: string) => boolean;
  hide: (quiet?: boolean) => void;
  flush: () => void;
  scan: (root?: Element) => void;
  textFor: (el: HTMLElement) => string;
  nameOf: (el: HTMLElement) => string;
  iconOnly: (el: HTMLElement) => boolean;
  targetOf: (node: Node | null) => HTMLElement | null;
  keepsTitle: (el: Element) => boolean;
  current: () => Cur | null;
  setKeyboard: (v: boolean) => void;
  /** The studio changed language: the open tip re-reads its text. */
  refresh: () => void;
  uninstall: () => void;
};

declare global {
  interface Window {
    beukTips?: TipsApi;
  }
}

let installed: TipsApi | null = null;
let current: TipsOptions = { t: (k) => k, hasKey: () => false };

/** Install the one tooltip. Idempotent: a second call keeps the first install and swaps in the newer options
 *  (the studio's t() changes with the interface language). */
export function installTips(opts: TipsOptions): TipsApi {
  current = opts;
  if (installed) return installed;
  const t: T = (k, p) => current.t(k, p);

  let tipEl: HTMLElement | null = null, tipCur: Cur | null = null, tipTimer: ReturnType<typeof setTimeout> | 0 = 0, tipHoldTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let tipPress: { el: HTMLElement; x: number; y: number; shown: boolean } | null = null;
  let tipSuppressClickUntil = 0, tipLastHide = 0, tipKeyboard = false;
  let tipSweep: ReturnType<typeof setInterval> | 0 = 0;

  function tipKeepsTitle(el: Element): boolean {
    if (!el || !el.tagName || TIP_KEEP_TAGS[el.tagName]) return true;
    if (el.tagName === 'INPUT' && el.hasAttribute('pattern')) return true;
    return !!(el.closest && el.closest(TIP_KEEP_SCOPE));
  }
  /* el.title reads and writes the tip text, never the native attribute */
  const tipTitleDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'title');
  if (tipTitleDesc && tipTitleDesc.get && tipTitleDesc.set) {
    Object.defineProperty(HTMLElement.prototype, 'title', {
      configurable: true,
      enumerable: tipTitleDesc.enumerable,
      get(this: HTMLElement) {
        if (!tipKeepsTitle(this) && !this.hasAttribute('title') && this.hasAttribute('data-tip-text')) return this.getAttribute('data-tip-text');
        return tipTitleDesc.get!.call(this);
      },
      set(this: HTMLElement, v: unknown) {
        if (tipKeepsTitle(this)) {
          tipTitleDesc.set!.call(this, v);
          return;
        }
        if (this.hasAttribute('title')) this.removeAttribute('title');
        this.setAttribute('data-tip-text', v == null ? '' : String(v));
        if (tipCur && tipCur.el === this) tipRender();
      },
    });
  }
  function tipIsControl(el: Element): boolean {
    return (
      el.tagName === 'BUTTON' ||
      el.tagName === 'SUMMARY' ||
      (el.tagName === 'A' && el.hasAttribute('href')) ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'tab' ||
      el.getAttribute('role') === 'switch'
    );
  }
  function tipAbsorb(el: Element): void {
    if (!(el instanceof HTMLElement) || !el.hasAttribute('title') || tipKeepsTitle(el)) return;
    const v = el.getAttribute('title')!;
    /* a control whose only name was its title keeps that name */
    if (v.trim() && tipIsControl(el) && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !(el.textContent || '').trim()) el.setAttribute('aria-label', v);
    el.removeAttribute('title');
    el.setAttribute('data-tip-text', v);
    if (tipCur && tipCur.el === el) tipRender();
  }
  function tipApplyMap(root: Element): void {
    TIP_MAP.forEach((m) => {
      const list: Element[] = [];
      if (root.matches && root.matches(m[0])) list.push(root);
      if (root.querySelectorAll) root.querySelectorAll(m[0]).forEach((x) => list.push(x));
      list.forEach((x) => {
        if (!x.hasAttribute('data-tip')) x.setAttribute('data-tip', m[1]);
      });
    });
  }
  function tipScan(root?: Element): void {
    const r = root || document.body;
    if (!r || r.nodeType !== 1) return;
    tipAbsorb(r);
    r.querySelectorAll('[title]').forEach(tipAbsorb);
    tipApplyMap(r);
  }
  /* No MutationObserver (1.0's reason: under heavy rendering its records hold removed subtrees): titles are absorbed
     when a pointer or focus reaches them and by a light sweep every 1.5 s. */
  function tipFlush(): void {
    tipScan(document.body);
    if (tipCur) {
      if (!tipCur.el.isConnected) tipHide();
      else tipRender();
    }
  }
  function tipKeyOk(k: string | null): boolean {
    return !!k && /^[A-Za-z][\w-]*(\.[\w-]+)+$/.test(k) && current.hasKey(k);
  }
  /* the words a sighted reader sees on the control (sr-only, aria-hidden and folded labels do not count) */
  function tipVisibleText(el: HTMLElement): string {
    const rendered = el.getClientRects().length > 0;
    let out = '';
    const walk = (n: Node): void => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          out += c.textContent;
          continue;
        }
        if (c.nodeType !== 1) continue;
        const e = c as HTMLElement;
        if (e.tagName === 'svg' || e.tagName === 'SVG' || (e.tagName === 'I' && e.hasAttribute('data-lucide'))) continue;
        if (e.hidden || e.classList.contains('sr-only') || e.getAttribute('aria-hidden') === 'true') continue;
        if (rendered) {
          const r = e.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue;
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        }
        walk(e);
      }
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
  }
  function tipName(el: HTMLElement): string {
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const s = lb
        .split(/\s+/)
        .map((id) => {
          const x = document.getElementById(id);
          return x ? x.textContent : '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (s) return s;
    }
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function tipIconOnly(el: HTMLElement): boolean {
    if (!tipIsControl(el) || tipVisibleText(el)) return false;
    /* a control not on screen counts only when it carries an icon (an empty button waits for its label) */
    return el.getClientRects().length > 0 || !!el.querySelector('svg, i[data-lucide], img');
  }
  function tipTextFor(el: HTMLElement): string {
    const k = el.getAttribute('data-tip');
    if (k && tipKeyOk(k)) {
      const s = t(k);
      if (s && !/\{\w+\}/.test(s)) return s;
    }
    if (el.hasAttribute('data-tip-text')) return el.getAttribute('data-tip-text')!.trim();
    if (tipIconOnly(el)) return tipName(el);
    return '';
  }
  /* the element a pointer or focus at `node` would explain (titles inherit, as they do in the browser) */
  function tipTargetOf(node: Node | null): HTMLElement | null {
    let el: HTMLElement | null = node && node.nodeType === 1 ? (node as HTMLElement) : node ? node.parentElement : null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el === tipEl) return null;
      if (el.hasAttribute('title')) tipAbsorb(el);
      if (!el.hasAttribute('data-tip'))
        for (let i = 0; i < TIP_MAP.length; i++)
          if (el.matches(TIP_MAP[i]![0])) {
            el.setAttribute('data-tip', TIP_MAP[i]![1]);
            break;
          }
      if (el.hasAttribute('data-tip')) return tipKeyOk(el.getAttribute('data-tip')) ? el : null; /* other values belong to a room's own layer */
      if (el.hasAttribute('data-tip-text')) return el.getAttribute('data-tip-text')!.trim() ? el : null;
      if (tipIsControl(el)) return tipIconOnly(el) && tipName(el) ? el : null;
      el = el.parentElement;
    }
    return null;
  }
  function tipEnsure(): HTMLElement {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'beukTip';
    tipEl.className = 'beuk-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function tipPlace(): void {
    if (!tipCur || !tipEl) return;
    const el = tipCur.el, tip = tipEl;
    const r = el.getBoundingClientRect();
    if (!el.isConnected || (!r.width && !r.height)) {
      tipHide();
      return;
    }
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = document.documentElement.clientHeight || window.innerHeight;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const w = tip.offsetWidth, h = tip.offsetHeight, gap = 6, m = 8;
    const rtl = (document.documentElement.getAttribute('dir') || '') === 'rtl';
    let pref = el.getAttribute('data-tip-place') || 'top';
    if (pref === 'start') pref = rtl ? 'right' : 'left';
    if (pref === 'end') pref = rtl ? 'left' : 'right';
    // quoted keys: the look test reads a bare left/right key as a physical CSS property
    const fits: Record<string, boolean> = { 'top': r.top - gap - h >= m, 'bottom': r.bottom + gap + h <= vh - m, 'left': r.left - gap - w >= m, 'right': r.right + gap + w <= vw - m };
    const opp: Record<string, string> = { 'top': 'bottom', 'bottom': 'top', 'left': 'right', 'right': 'left' };
    const cross = pref === 'top' || pref === 'bottom' ? (rtl ? ['left', 'right'] : ['right', 'left']) : ['top', 'bottom'];
    const side = [pref, opp[pref]!].concat(cross).find((s) => fits[s]) || (r.top > vh - r.bottom ? 'top' : 'bottom');
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    let x: number, y: number;
    if (side === 'top' || side === 'bottom') {
      x = clamp(r.left + r.width / 2 - w / 2, m, vw - w - m);
      y = side === 'top' ? r.top - gap - h : r.bottom + gap;
    } else {
      y = clamp(r.top + r.height / 2 - h / 2, m, vh - h - m);
      x = side === 'left' ? r.left - gap - w : r.right + gap;
    }
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
    tip.setAttribute('data-side', side);
  }
  function tipUnwire(): void {
    if (!tipCur || !tipCur.wired) return;
    const el = tipCur.el;
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== 'beukTip');
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
    tipCur.wired = false;
  }
  function tipRender(): void {
    if (!tipCur || !tipEl) return;
    const text = tipTextFor(tipCur.el);
    if (!text) {
      tipHide();
      return;
    }
    tipEl.textContent = text;
    const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const same = norm(tipName(tipCur.el)) === norm(text);
    if (!same && !tipCur.wired) {
      const ids = (tipCur.el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (ids.indexOf('beukTip') === -1) ids.push('beukTip');
      tipCur.el.setAttribute('aria-describedby', ids.join(' '));
      tipCur.wired = true;
    } else if (same) tipUnwire();
    tipPlace();
  }
  function tipShow(el: HTMLElement, via: string): boolean {
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = 0;
    if (!el || !el.isConnected) return false;
    tipEnsure();
    if (tipCur && tipCur.el !== el) tipHide(true);
    if (!tipCur) tipCur = { el, via, wired: false };
    else tipCur.via = via;
    tipEl!.hidden = false;
    tipRender();
    if (!tipCur) return false;
    tipEl!.classList.add('on');
    return true;
  }
  function tipHide(quiet?: boolean): void {
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = 0;
    if (tipHoldTimer) clearTimeout(tipHoldTimer);
    tipHoldTimer = 0;
    if (!tipCur) return;
    tipUnwire();
    tipCur = null;
    if (tipEl) {
      tipEl.classList.remove('on');
      tipEl.hidden = true;
      tipEl.textContent = '';
    }
    if (!quiet) tipLastHide = Date.now();
  }
  function tipSchedule(el: HTMLElement, via: string, delay: number): void {
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipTimer = 0;
      tipShow(el, via);
    }, delay);
  }

  const doc = document;
  const off: (() => void)[] = [];
  const on = <K extends string>(target: Document | Window, type: K, fn: (e: never) => void, capture?: boolean) => {
    target.addEventListener(type, fn as EventListener, capture);
    off.push(() => target.removeEventListener(type, fn as EventListener, capture));
  };

  tipEnsure();
  tipScan(document.body);
  tipSweep = setInterval(() => {
    if (!document.hidden) tipFlush();
  }, 1500);
  on(doc, 'pointerover', (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = tipTargetOf(e.target as Node);
    if (tipCur && el === tipCur.el) return;
    if (!el) {
      if (tipCur && tipCur.via === 'hover') tipHide();
      else if (tipTimer) clearTimeout(tipTimer);
      return;
    }
    if (tipCur && tipCur.via !== 'hover') return; /* a focused control keeps its tip while the mouse wanders */
    const warm = !!tipCur || Date.now() - tipLastHide < 300;
    if (tipCur) tipHide(true);
    tipSchedule(el, 'hover', warm ? TIP_WARM : TIP_DELAY);
  }, true);
  on(doc, 'pointerout', (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.relatedTarget) return;
    if (tipTimer) clearTimeout(tipTimer);
    if (tipCur && tipCur.via === 'hover') tipHide();
  }, true);
  on(doc, 'pointerdown', (e: PointerEvent) => {
    tipKeyboard = false;
    if (e.pointerType !== 'touch') {
      if (tipCur) tipHide();
      else if (tipTimer) clearTimeout(tipTimer);
      return;
    }
    const el = tipTargetOf(e.target as Node);
    if (tipCur && tipCur.el !== el) tipHide();
    if (tipTimer) clearTimeout(tipTimer);
    tipPress = el ? { el, x: e.clientX, y: e.clientY, shown: false } : null;
    if (el)
      tipTimer = setTimeout(() => {
        tipTimer = 0;
        if (tipPress && tipPress.el === el && tipShow(el, 'touch')) tipPress.shown = true;
      }, TIP_LONGPRESS);
  }, true);
  on(doc, 'pointermove', (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !tipPress || tipPress.shown) return;
    if (Math.abs(e.clientX - tipPress.x) > 10 || Math.abs(e.clientY - tipPress.y) > 10) {
      if (tipTimer) clearTimeout(tipTimer);
      tipPress = null;
    }
  }, true);
  const pressEnd = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = 0;
    if (tipPress && tipPress.shown) {
      tipSuppressClickUntil = Date.now() + 700; /* the long press was for reading, not pressing */
      if (tipHoldTimer) clearTimeout(tipHoldTimer);
      tipHoldTimer = setTimeout(() => {
        if (tipCur && tipCur.via === 'touch') tipHide();
      }, TIP_TOUCH_HOLD);
    }
    tipPress = null;
  };
  on(doc, 'pointerup', pressEnd, true);
  on(doc, 'pointercancel', pressEnd, true);
  on(doc, 'click', (e: MouseEvent) => {
    if (Date.now() < tipSuppressClickUntil && tipCur && tipCur.via === 'touch' && tipCur.el.contains(e.target as Node)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      tipSuppressClickUntil = 0;
    }
  }, true);
  on(doc, 'contextmenu', (e: MouseEvent) => {
    if ((tipPress && tipPress.el.contains(e.target as Node)) || (tipCur && tipCur.via === 'touch' && tipCur.el.contains(e.target as Node))) e.preventDefault();
  }, true);
  on(doc, 'focusin', (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || el.nodeType !== 1 || tipTargetOf(el) !== el) return;
    let kb = tipKeyboard;
    try {
      kb = kb || el.matches(':focus-visible');
    } catch {
      /* an engine without :focus-visible */
    }
    if (kb) tipShow(el, 'focus');
  });
  on(doc, 'focusout', (e: FocusEvent) => {
    if (tipCur && tipCur.via === 'focus' && tipCur.el === e.target) tipHide();
  });
  on(window, 'keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') tipKeyboard = true;
    if (e.key === 'Escape' && tipCur) {
      const via = tipCur.via;
      tipHide();
      /* WCAG 1.4.13: Escape puts away the tip first; a focused control's dialog closes on the next press */
      if (via === 'focus' || via === 'touch') {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);
  on(window, 'scroll', () => {
    if (!tipCur) return;
    if (tipCur.via === 'focus') tipPlace();
    else tipHide();
  }, true);
  on(window, 'resize', () => {
    if (tipCur) tipPlace();
  });
  on(window, 'blur', () => {
    if (tipCur && tipCur.via !== 'focus') tipHide();
  });

  const api: TipsApi = {
    show: tipShow,
    hide: tipHide,
    flush: tipFlush,
    scan: tipScan,
    textFor: tipTextFor,
    nameOf: tipName,
    iconOnly: tipIconOnly,
    targetOf: tipTargetOf,
    keepsTitle: tipKeepsTitle,
    current: () => tipCur,
    setKeyboard: (v) => {
      tipKeyboard = !!v;
    },
    refresh: () => {
      if (tipCur) tipRender();
    },
    uninstall: () => {
      tipHide(true);
      if (tipSweep) clearInterval(tipSweep);
      off.forEach((f) => f());
      if (tipTitleDesc) Object.defineProperty(HTMLElement.prototype, 'title', tipTitleDesc);
      tipEl?.remove();
      tipEl = null;
      installed = null;
      if (window.beukTips === api) delete window.beukTips;
    },
  };
  installed = api;
  window.beukTips = api;
  return api;
}

