import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { DEFAULT_DEVICE, FIRST_PAINT } from '../src/preview/defaultDevice';
import { previewIfLoaded, previewStarted } from '../src/preview/preview';

/* The preview opens on Android Tablet (2026-11-27, V). One id, held in one place by each side; the first paint (the
   frame's class, display type and footer) must be what 1.0's own setDevice would draw for it, so nothing flashes
   another device first. */
beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('the preview default device', () => {
  it('is Android Tablet, and the first paint matches the page tables and the menu', async () => {
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    // first paint, before 1.0's code runs
    const menu = document.querySelector<HTMLSelectElement>('#deviceBar')!;
    expect(menu.value).toBe('android');
    expect(menu.selectedOptions[0]!.textContent).toBe('Android Tablet');
    expect(document.getElementById('deviceFrame')!.className).toBe(FIRST_PAINT.frameClass);
    expect(document.getElementById('deviceFrame')!.getAttribute('data-display')).toBe(FIRST_PAINT.display);
    expect(document.getElementById('footDevice')!.textContent).toBe(FIRST_PAINT.footer);
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    const pc = previewIfLoaded()!;
    const api = pc.api as unknown as Record<string, Record<string, unknown> | string>;
    // one id on both sides, and the first paint is exactly what the page's own tables say for it
    expect(api.DEFAULT_DEVICE).toBe(DEFAULT_DEVICE);
    expect((api.DEVICE_FOOTERS as Record<string, string>)[DEFAULT_DEVICE]).toBe(FIRST_PAINT.footer);
    expect((api.DEVICE_DISPLAY as Record<string, { type: string }>)[DEFAULT_DEVICE]!.type).toBe(FIRST_PAINT.display);
    expect(FIRST_PAINT.frameClass).toBe('frame-' + DEFAULT_DEVICE);
    expect((api.DEVICE_NAMES as Record<string, string>)[DEFAULT_DEVICE]).toBe('Android Tablet');
    // the preview's own state starts on it
    expect(pc.getState().device).toBe(DEFAULT_DEVICE);
    cleanup();
  }, 60_000);
});
