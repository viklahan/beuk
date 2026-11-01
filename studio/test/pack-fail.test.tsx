import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';

/* A pack whose chunk will not load (a newer build replaced this one, or
   offline before it was ever cached): Japanese fails here. */
vi.mock('../src/i18n/strings', async (orig) => {
  const real = await orig<typeof import('../src/i18n/strings')>();
  return { ...real, loadPack: (code: string) => (code === 'ja' ? Promise.reject(new Error('chunk gone')) : real.loadPack(code)) };
});

const { App } = await import('../src/App');
const { LocaleProvider } = await import('../src/i18n/LocaleProvider');

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a language pack that fails to load', () => {
  it("keeps the language, saves nothing, and offers a reload in a toast (1.0's update notice)", async () => {
    const { container } = render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    act(() => (container.querySelector('#btnUiLang') as HTMLButtonElement).click());
    await act(async () => {
      (container.querySelector('#uiLangMenu [data-lang="ja"]') as HTMLButtonElement).click();
    });
    const toasts = document.getElementById('toasts')!;
    expect(toasts.textContent).toContain(en['pwa.updateReady']);
    const reload = toasts.querySelector('.toast-action') as HTMLButtonElement;
    expect(reload.textContent).toBe(en['pwa.reload']);
    expect(container.querySelector('#uiLangName')!.textContent).toBe('English');
    expect(localStorage.getItem(meta.uiLangKey)).toBeNull();
    expect((container.querySelector('#uiLangMenu') as HTMLElement).hidden).toBe(true);
  });
});
