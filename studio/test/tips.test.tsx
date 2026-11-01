import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { installTips, TIP_LONGPRESS, type TipsApi } from '../src/shell/tooltip';

/* Task 1: 1.0's one tooltip (BEUK:tips). Re-expresses the self-checks
   ui.tooltips and ui.tooltips.touch. jsdom has no layout, so the scratch
   control and the tip are given 1.0's check geometry by hand (the control
   at the top-left corner, then mid-screen); the studio-wide scan ("every
   icon-only control is named and tipped") runs in the browser in
   e2e/book.mjs, where layout is real. */

const t = (k: string) => (en as Record<string, string>)[k] ?? k;
const hasKey = (k: string) => Object.hasOwn(en, k);

let T: TipsApi;
beforeEach(() => {
  T = installTips({ t, hasKey });
});
afterEach(() => {
  T.uninstall();
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.documentElement.setAttribute('dir', 'ltr');
});

/** A scratch icon button (1.0's fixture), given a box: x, y, 34 × 30. */
function scratch(x: number, y: number): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', 'Theme');
  b.setAttribute('data-tip', 'tips.theme');
  b.innerHTML = '<svg width="16" height="16" aria-hidden="true"></svg>';
  document.body.appendChild(b);
  place(b, x, y);
  return b;
}
function place(el: HTMLElement, x: number, y: number, w = 34, h = 30): void {
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
  el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
}
function tipBox(): { left: number; top: number; right: number; bottom: number } | null {
  const tip = document.getElementById('beukTip');
  if (!tip || tip.hidden) return null;
  const left = parseFloat(tip.style.left), top = parseFloat(tip.style.top);
  return { left, top, right: left + 120, bottom: top + 24 };
}
function sizeTip(): void {
  const tip = document.getElementById('beukTip')!;
  Object.defineProperty(tip, 'offsetWidth', { configurable: true, get: () => 120 });
  Object.defineProperty(tip, 'offsetHeight', { configurable: true, get: () => 24 });
}
const overlaps = (a: { left: number; top: number; right: number; bottom: number }, c: DOMRect) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;

describe('ui.tooltips (1.0 self-check)', () => {
  it('keyboard focus shows the tip beside its control (role=tooltip, aria-describedby, name untouched), flipped below at the top edge; Escape hides it and keeps focus', () => {
    const b = scratch(0, 0);
    sizeTip();
    T.hide();
    T.setKeyboard(true);
    b.focus();
    const tip = document.getElementById('beukTip')!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    const r1 = tipBox();
    expect(r1).not.toBeNull();
    expect(tip.textContent).toBe(t('tips.theme'));
    expect((b.getAttribute('aria-describedby') || '').split(/\s+/)).toContain('beukTip');
    expect(b.getAttribute('aria-label')).toBe('Theme');
    expect(overlaps(r1!, b.getBoundingClientRect())).toBe(false);
    expect(r1!.left >= 0 && r1!.top >= 0 && r1!.right <= window.innerWidth && r1!.bottom <= window.innerHeight).toBe(true);
    expect(tip.getAttribute('data-side')).toBe('bottom');
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(tipBox()).toBeNull();
    expect(b.getAttribute('aria-describedby') || '').not.toContain('beukTip');
    expect(document.activeElement).toBe(b);
  });

  it('start placement mirrors in right-to-left; one tooltip at a time; el.title is absorbed and still reads back', () => {
    const b = scratch(Math.round(window.innerWidth / 2), 200);
    sizeTip();
    b.setAttribute('data-tip-place', 'start');
    T.show(b, 'focus');
    const ltr = document.getElementById('beukTip')!.getAttribute('data-side');
    T.hide();
    document.documentElement.setAttribute('dir', 'rtl');
    T.show(b, 'focus');
    const rtl = document.getElementById('beukTip')!.getAttribute('data-side');
    T.hide();
    expect([ltr, rtl]).toEqual(['left', 'right']);

    const b2 = b.cloneNode(true) as HTMLButtonElement;
    document.body.appendChild(b2);
    place(b2, 400, 200);
    T.show(b, 'hover');
    T.show(b2, 'hover');
    expect(b.getAttribute('aria-describedby') || '').not.toContain('beukTip');
    expect(document.querySelectorAll('.beuk-tip:not([hidden])').length).toBe(1);
    T.hide();
    b2.remove();

    b.title = 'Written by code';
    expect(b.hasAttribute('title')).toBe(false);
    expect(b.title).toBe('Written by code');
    expect(T.textFor(b)).toBe(t('tips.theme'));
  });

  it("a help title in the markup becomes the tip; an icon-only control's name is its tip; titles the browser needs are kept", () => {
    document.body.innerHTML =
      '<button id="a" title="Export a backup"><svg></svg></button><button id="b" aria-label="Help"><svg></svg></button><abbr id="c" title="Kept">K</abbr>';
    T.scan();
    const a = document.getElementById('a')!;
    expect(a.hasAttribute('title')).toBe(false);
    expect(a.getAttribute('data-tip-text')).toBe('Export a backup');
    expect(a.getAttribute('aria-label')).toBe('Export a backup'); // its only name was the title
    expect(T.textFor(a)).toBe('Export a backup');
    expect(T.textFor(document.getElementById('b')!)).toBe('Help');
    expect(document.getElementById('c')!.getAttribute('title')).toBe('Kept');
  });

  it('an unknown data-tip key is not a tip (1.0 tipKeyOk)', () => {
    const b = scratch(200, 200);
    b.setAttribute('data-tip', 'tips.noSuchKey');
    expect(T.targetOf(b)).toBeNull();
  });

  it('Escape on a focus tip is taken by the tip: a dialog under it does not see that keypress', () => {
    const b = scratch(200, 200);
    sizeTip();
    T.show(b, 'focus');
    const seen: boolean[] = [];
    const onKey = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    document.addEventListener('keydown', onKey);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', onKey);
    expect(seen).toEqual([]); // stopped at the window's capture phase, as in 1.0
  });
});

describe('ui.tooltips.touch (1.0 self-check)', () => {
  const pe = (b: HTMLElement, type: string) =>
    b.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: 215, clientY: 215, bubbles: true, cancelable: true }));

  it('a short tap presses and shows nothing; a long press shows the tip beside the control and the release does not press it', () => {
    vi.useFakeTimers();
    const b = scratch(200, 200);
    sizeTip();
    let presses = 0;
    b.addEventListener('click', () => presses++);
    const shown = () => {
      const x = document.getElementById('beukTip');
      return !!(x && !x.hidden && T.current() && T.current()!.el === b);
    };
    T.hide();
    pe(b, 'pointerdown');
    vi.advanceTimersByTime(150);
    pe(b, 'pointerup');
    b.click();
    expect(shown()).toBe(false);
    expect(presses).toBe(1);
    pe(b, 'pointerdown');
    vi.advanceTimersByTime(TIP_LONGPRESS + 200);
    expect(shown()).toBe(true);
    expect(overlaps(tipBox()!, b.getBoundingClientRect())).toBe(false);
    pe(b, 'pointerup');
    b.click();
    expect(presses).toBe(1);
    expect(shown()).toBe(true);
  });
});

describe('the studio installs the one tooltip', () => {
  it('window.beukTips exists while the studio is mounted, and the top bar carries 1.0\'s data-tip keys', () => {
    T.uninstall();
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    expect(window.beukTips).toBeTruthy();
    expect(document.getElementById('beukTip')?.getAttribute('role')).toBe('tooltip');
    for (const [id, key] of [['btnUiLang', 'tips.uiLang'], ['btnTheme', 'tips.theme'], ['btnHomeport', 'tips.homeport'], ['btnHelp', 'tips.help']])
      expect(document.getElementById(id)?.getAttribute('data-tip')).toBe(key);
    cleanup();
    expect(window.beukTips).toBeUndefined();
    T = installTips({ t, hasKey }); // for afterEach
  });
});
