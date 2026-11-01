import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ar from '../src/generated/packs/ar.json';
import de from '../src/generated/packs/de.json';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { TOAST_FADE_MS, TOAST_MS } from '../src/shell/Toasts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

const mount = (lang = 'en') =>
  render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  );

describe('the shell', () => {
  it('Arabic: the chrome is dir="rtl", the manuscript keeps dir="ltr" (review focus #1)', async () => {
    await loadPack('ar');
    const { container } = mount('ar');
    expect(container.querySelector('#app')!.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    const page = container.querySelector('#manuscript')!;
    expect(page.getAttribute('dir')).toBe('ltr');
    expect(page.closest('[dir]')).toBe(page);
    expect(screen.getByText(ar['tabs.structure'])).toBeTruthy();
  });

  it('English: dir="ltr" everywhere', () => {
    const { container } = mount('en');
    expect(container.querySelector('#app')!.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('#manuscript')!.getAttribute('dir')).toBe('ltr');
  });

  it('every label is a 1.0 string (top bar, tabs, panes)', () => {
    mount('en');
    for (const k of ['brand.tagline', 'misc.untitledBook', 'tabs.structure', 'tabs.write', 'tabs.style', 'tabs.preview', 'side.import', 'side.settings', 'tab.content', 'editor.placeholder', 'top.themeToCandle']) {
      expect(screen.getAllByText(en[k as keyof typeof en]).length, k).toBeGreaterThan(0);
    }
  });

  it('the theme switch: Candlelight and back, saved under 1.0\'s key, announced by a toast that fades', () => {
    vi.useFakeTimers();
    const { container } = mount('en');
    const btn = container.querySelector('#btnTheme') as HTMLButtonElement;
    expect(btn.textContent).toBe(en['top.themeToCandle']);
    act(() => btn.click());
    expect(document.documentElement.getAttribute('data-theme')).toBe('candlelight');
    expect(localStorage.getItem(meta.themeKey)).toBe('candlelight');
    expect(meta.themeKey).toBe('beuk.theme.v1');
    expect(btn.textContent).toBe(en['top.themeToPaper']);
    const toasts = document.getElementById('toasts')!;
    expect(toasts.textContent).toContain(en['toast.themeCandle']);
    act(() => btn.click());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(meta.themeKey)).toBe('paper');
    act(() => vi.advanceTimersByTime(TOAST_MS + TOAST_FADE_MS + 50));
    expect(toasts.children.length).toBe(0);
  });

  it('the language menu: lists the 13 languages by their own names, switches, closes', async () => {
    const { container } = mount('en');
    const btn = container.querySelector('#btnUiLang') as HTMLButtonElement;
    const menu = container.querySelector('#uiLangMenu') as HTMLElement;
    expect(menu.hidden).toBe(true);
    act(() => btn.click());
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const opts = [...menu.querySelectorAll('.lang-opt')];
    expect(opts.map((o) => o.getAttribute('data-lang'))).toEqual(meta.order);
    expect(opts.map((o) => o.textContent!.replace('✓', ''))).toEqual(meta.order.map((c) => meta.names[c as keyof typeof meta.names]));
    await act(async () => {
      (menu.querySelector('[data-lang="de"]') as HTMLButtonElement).click();
    });
    await screen.findByText(de['tabs.structure']);
    expect(menu.hidden).toBe(true);
    expect(container.querySelector('#uiLangName')!.textContent).toBe('Deutsch');
    expect(menu.querySelector('[data-lang="de"]')!.getAttribute('aria-selected')).toBe('true');
    // Escape closes it too.
    act(() => btn.click());
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(menu.hidden).toBe(true);
  });

  it('the phone tabs switch the pane', () => {
    const { container } = mount('en');
    const panes = container.querySelector('#panes')!;
    expect(panes.getAttribute('data-mobile')).toBe('structure');
    act(() => (container.querySelector('[data-mpane="preview"]') as HTMLButtonElement).click());
    expect(panes.getAttribute('data-mobile')).toBe('preview');
    act(() => (container.querySelector('[data-mstyle="1"]') as HTMLButtonElement).click());
    expect(panes.getAttribute('data-mobile')).toBe('center');
    expect(container.querySelector('[data-mstyle="1"]')!.className).toBe('active');
  });
});

describe('pre-paint (index.html), before any CSS — 1.0\'s rules', () => {
  const html = readFileSync(path.join(import.meta.dirname, '..', 'index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!
    .split('__BEUK_THEME_KEY__').join(JSON.stringify(meta.themeKey))
    .split('__BEUK_LANG_KEY__').join(JSON.stringify(meta.uiLangKey))
    .split('__BEUK_LANGS__').join(JSON.stringify(meta.order))
    .split('__BEUK_RTL__').join(JSON.stringify(meta.rtl));
  const run = () => new Function(script)();

  it('applies the saved theme and the saved language\'s direction', () => {
    localStorage.setItem('beuk.theme.v1', 'candlelight');
    localStorage.setItem('beuk.uiLang.v1', 'ar');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('candlelight');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('Paper by default, and an unknown saved language changes nothing', () => {
    localStorage.setItem('beuk.uiLang.v1', 'xx');
    run();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });
});
