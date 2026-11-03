import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { previewIfLoaded, previewSafety, previewStarted } from '../src/preview/preview';

/* Review round 2, Minor 6: the preview starts again on a remounted pane (the Shell or the pane drawn anew), with
   1.0's page-wide listeners of the first start taken away (none doubled: one arrow press turns one page), and holds
   no book's Y.Doc after it goes. */
const mount = () =>
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );

/* jsdom has no ResizeObserver: a recording one (1.0's preview code observes #frameZone when there is one), there before
   the preview module is first loaded */
const observers: { cb: ResizeObserverCallback; on: boolean }[] = [];
beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    rec: { cb: ResizeObserverCallback; on: boolean };
    constructor(cb: ResizeObserverCallback) {
      this.rec = { cb, on: false };
      observers.push(this.rec);
    }
    observe() {
      this.rec.on = true;
    }
    unobserve() {}
    disconnect() {
      this.rec.on = false;
    }
  };
});

describe('the preview pane, remounted', () => {
  it('starts again on the new markup, its page-wide listeners not doubled', async () => {
    mount();
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    const first = previewSafety.listeners;
    expect(first).toBeGreaterThan(0);
    cleanup();
    expect(previewStarted()).toBe(false);
    expect(previewSafety.listeners).toBe(0);
    mount();
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    expect(previewSafety.listeners).toBe(first);
    // 1.0's own device bar listener is on the NEW bar
    document.querySelector<HTMLButtonElement>('#deviceBar [data-device="ipad"]')!.click();
    expect(document.getElementById('deviceFrame')!.className).toBe('frame-ipad');
    document.querySelector<HTMLButtonElement>('#deviceBar [data-device="kindle"]')!.click();
    cleanup();
  }, 60_000);

  /* Wave 5b, constraint 63 (carried from 5a): 1.0's measurePages could run after the pane had gone — "Cannot read
     properties of null (reading 'style')", an intermittent unhandled error. 1.0's preview code re-measures from
     continuations the pane's end did not cancel: document.fonts.ready (initPreview, hcInit), a ResizeObserver on the
     frame, and any timer such a continuation sets after the end (its epoch is the new one). None runs once the pane
     has gone. */
  it("1.0's re-measures due after the pane went do nothing (fonts.ready, a resize, a timer set after the end)", async () => {
    let ready!: () => void;
    const fonts = Object.assign(new EventTarget(), { ready: new Promise<void>((r) => (ready = r)) });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    observers.length = 0;
    const errors: unknown[] = [];
    const onErr = (e: unknown) => errors.push(e);
    process.on('uncaughtException', onErr);
    process.on('unhandledRejection', onErr);
    try {
      mount();
      await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
      expect(observers.some((o) => o.on)).toBe(true);
      const pc = previewIfLoaded()!;
      cleanup();
      expect(previewStarted()).toBe(false);
      // the pane has gone: the fonts arrive, the frame is resized, a continuation sets a timer
      ready();
      for (const o of observers) if (o.on) o.cb([], {} as ResizeObserver);
      pc.api.scheduleDeskUpdate(0);
      await new Promise((r) => setTimeout(r, 450));
      expect(errors.map(String)).toEqual([]);
      expect(observers.filter((o) => o.on).length).toBe(0);
    } finally {
      process.off('uncaughtException', onErr);
      process.off('unhandledRejection', onErr);
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  }, 60_000);
});
