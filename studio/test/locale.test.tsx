import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import de from '../src/generated/packs/de.json';
import ar from '../src/generated/packs/ar.json';
import en from '../src/generated/packs/en.json';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider';
import { UI_LANG_KEY, detectDefaultUiLang, initialUiLang, loadPack } from '../src/i18n/strings';

function Probe() {
  const { t, setLang, lang, dir } = useLocale();
  return (
    <div data-testid="probe" data-lang={lang} data-dir={dir}>
      <span data-testid="label">{t('top.export')}</span>
      <button onClick={() => void setLang('de')}>de</button>
      <button onClick={() => void setLang('ar')}>ar</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('LocaleProvider', () => {
  it('re-renders a mounted component when the language changes, and saves it under 1.0\'s key', async () => {
    render(
      <LocaleProvider initial="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe(en['top.export']);
    await act(async () => {
      screen.getByText('de').click();
    });
    await screen.findByText(de['top.export']);
    expect(screen.getByTestId('probe').dataset.lang).toBe('de');
    expect(localStorage.getItem(UI_LANG_KEY)).toBe('de');
    expect(UI_LANG_KEY).toBe('beuk.uiLang.v1');
    expect(document.documentElement.getAttribute('lang')).toBe('de');
  });

  it('Arabic mirrors the chrome: dir="rtl" (and back to ltr)', async () => {
    render(
      <LocaleProvider initial="en">
        <Probe />
      </LocaleProvider>,
    );
    await act(async () => {
      screen.getByText('ar').click();
    });
    await screen.findByText(ar['top.export']);
    expect(screen.getByTestId('probe').dataset.dir).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    await act(async () => {
      screen.getByText('de').click();
    });
    await screen.findByText(de['top.export']);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('a fast double switch: the LAST choice wins, applied and saved, even when the first pack loads slower', async () => {
    await loadPack('nl'); // the second choice is instant; the first (it) still has to load
    let api: ReturnType<typeof useLocale> | null = null;
    function Grab() {
      api = useLocale();
      return <span data-testid="lang">{api.lang}</span>;
    }
    render(
      <LocaleProvider initial="en">
        <Grab />
      </LocaleProvider>,
    );
    await act(async () => {
      const first = api!.setLang('it');
      const second = api!.setLang('nl');
      await Promise.all([first, second]);
    });
    expect(screen.getByTestId('lang').textContent).toBe('nl');
    expect(localStorage.getItem(UI_LANG_KEY)).toBe('nl');
    expect(document.documentElement.getAttribute('lang')).toBe('nl');
  });

  it("opens in the saved language, else the browser's (1.0's detectDefaultUiLang)", () => {
    localStorage.setItem(UI_LANG_KEY, 'pl');
    expect(initialUiLang()).toBe('pl');
    localStorage.setItem(UI_LANG_KEY, 'klingon');
    expect(initialUiLang()).toBe(detectDefaultUiLang(navigator.language));
    expect(detectDefaultUiLang('zh-TW')).toBe('zh-Hans');
    expect(detectDefaultUiLang('pt_BR')).toBe('pt');
    expect(detectDefaultUiLang('xx')).toBe('en');
    expect(detectDefaultUiLang('')).toBe('en');
  });
});
