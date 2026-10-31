import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EN, UI_LANG_NAMES, UI_LANG_ORDER, UI_PLURAL_FORMS, hasLang, isRtl, loadPack, packIfLoaded, storeUiLang } from './strings';
import { translate, type Params, type Tables } from './translate';

export type Locale = {
  /** The interface language (a UI_LANG_ORDER code). */
  lang: string;
  /** The chrome's direction. The manuscript keeps the BOOK's direction. */
  dir: 'ltr' | 'rtl';
  t: (key: string, params?: Params) => string;
  /** Switch language (loads its pack first), saved under 1.0's key unless persist is false. */
  setLang: (code: string, opts?: { persist?: boolean }) => Promise<string>;
  order: readonly string[];
  names: Readonly<Record<string, string>>;
};

const LocaleContext = createContext<Locale | null>(null);

/** 1.0's applyUiLang: lang and dir on <html>, so everything outside the
 *  React tree (scrollbars, portals) follows too. */
function applyToDocument(lang: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
}

export function LocaleProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const start = hasLang(initial) && packIfLoaded(initial) ? initial : 'en';
  const [lang, setLangState] = useState(start);
  const latest = useRef(0);

  useEffect(() => applyToDocument(lang), [lang]);

  const setLang = useCallback(async (code: string, opts?: { persist?: boolean }) => {
    const target = hasLang(code) ? code : 'en';
    const ticket = ++latest.current;
    await loadPack(target);
    if (opts?.persist !== false) storeUiLang(target);
    if (ticket === latest.current) setLangState(target);
    return target;
  }, []);

  const value = useMemo<Locale>(() => {
    const tables: Tables = { packs: { en: EN, [lang]: packIfLoaded(lang) }, pluralForms: UI_PLURAL_FORMS };
    return {
      lang,
      dir: isRtl(lang) ? 'rtl' : 'ltr',
      t: (key, params) => translate(tables, lang, key, params),
      setLang,
      order: UI_LANG_ORDER,
      names: UI_LANG_NAMES,
    };
  }, [lang, setLang]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const v = useContext(LocaleContext);
  if (!v) throw new Error('useLocale() outside <LocaleProvider>');
  return v;
}

export const useT = (): Locale['t'] => useLocale().t;
