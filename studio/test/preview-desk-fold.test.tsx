import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { DESK_FOLD_KEY, deskOpenFirst } from '../src/preview/deskFold';
import { previewIfLoaded, previewStarted } from '../src/preview/preview';

/* The reading desk under the reader folds away (V, 2026-11-27). The button, aria, the remembered choice (per browser,
   storage optional) and the default by width (open wide, folded on the phone layout) — and the first paint (React's
   markup) agrees with 1.0's own deskOpenWanted for every width and every remembered value. */
beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
const width = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
afterEach(() => {
  cleanup();
  localStorage.clear();
  width(1024);
});
const mount = async () => {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
};
const btn = () => document.getElementById('deskToggle') as HTMLButtonElement;
const desk = () => document.getElementById('previewDesk') as HTMLElement;
const state = () => ({ expanded: btn().getAttribute('aria-expanded'), hidden: desk().hidden });

describe('the reading desk fold', () => {
  it('is a button with a name, aria-expanded and aria-controls the desk', async () => {
    width(1280);
    await mount();
    expect(btn().tagName).toBe('BUTTON');
    expect(btn().textContent).toBe('Chapters and page counts');
    expect(btn().getAttribute('aria-controls')).toBe('previewDesk');
    expect(document.getElementById(btn().getAttribute('aria-controls')!)).toBe(desk());
  }, 60_000);

  it('opens wide and folds on the phone layout when nothing is remembered', async () => {
    width(1280);
    expect(deskOpenFirst()).toBe(true);
    await mount();
    expect(state()).toEqual({ expanded: 'true', hidden: false });
    cleanup();
    width(390);
    expect(deskOpenFirst()).toBe(false);
    await mount();
    expect(state()).toEqual({ expanded: 'false', hidden: true });
    expect(localStorage.getItem(DESK_FOLD_KEY)).toBeNull(); // a default is not a choice: nothing written
  }, 60_000);

  it('toggles, and remembers the choice over a remount whatever the width', async () => {
    width(390);
    await mount();
    fireEvent.click(btn());
    expect(state()).toEqual({ expanded: 'true', hidden: false });
    expect(localStorage.getItem(DESK_FOLD_KEY)).toBe('open');
    cleanup();
    await mount();
    expect(state()).toEqual({ expanded: 'true', hidden: false });
    fireEvent.click(btn());
    expect(state()).toEqual({ expanded: 'false', hidden: true });
    expect(localStorage.getItem(DESK_FOLD_KEY)).toBe('closed');
    cleanup();
    width(1280);
    await mount();
    expect(state()).toEqual({ expanded: 'false', hidden: true });
  }, 60_000);

  it('works without storage: the default by width, the toggle for the session', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    try {
      width(1280);
      await mount();
      expect(state()).toEqual({ expanded: 'true', hidden: false });
      fireEvent.click(btn());
      expect(state()).toEqual({ expanded: 'false', hidden: true });
      fireEvent.click(btn());
      expect(state()).toEqual({ expanded: 'true', hidden: false });
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  }, 60_000);

  it("the first paint equals 1.0's deskOpenWanted at every width and remembered value", async () => {
    await mount();
    const api = previewIfLoaded()!.api as unknown as { deskOpenWanted: () => boolean };
    for (const w of [390, 1023, 1024, 1440]) {
      for (const v of [null, 'open', 'closed', 'junk']) {
        width(w);
        localStorage.clear();
        if (v !== null) localStorage.setItem(DESK_FOLD_KEY, v);
        expect(deskOpenFirst(), `${w}px ${v}`).toBe(api.deskOpenWanted());
      }
    }
  }, 60_000);
});
