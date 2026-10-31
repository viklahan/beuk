/* The interface strings, extracted at build time from 1.0's
   client/index.html (scripts/extract-studio.mjs — one source). English
   ships in the bundle as the fallback; every other pack is its own
   chunk, loaded when chosen (and precached by the service worker). */
import meta from '../generated/strings-meta.json';
import en from '../generated/packs/en.json';
import type { Pack, PluralForms } from './translate';

export const UI_LANG_KEY: string = meta.uiLangKey;
export const UI_LANG_ORDER: readonly string[] = meta.order;
export const UI_LANG_NAMES: Readonly<Record<string, string>> = meta.names;
export const UI_RTL: readonly string[] = meta.rtl;
export const UI_PLURAL_FORMS: PluralForms = meta.pluralForms as PluralForms;
export const EN: Pack = en as Pack;

const loaders = import.meta.glob<Pack>(['../generated/packs/*.json', '!../generated/packs/en.json'], { import: 'default' });

const loaded: Record<string, Pack> = { en: EN };

export function hasLang(code: string): boolean {
  return UI_LANG_ORDER.includes(code);
}

export function packIfLoaded(code: string): Pack | undefined {
  return loaded[code];
}

/** The pack for `code`, loading its chunk on first use. */
export async function loadPack(code: string): Promise<Pack> {
  if (loaded[code]) return loaded[code]!;
  const load = loaders[`../generated/packs/${code}.json`];
  if (!load) throw new Error(`no interface pack for "${code}"`);
  const pack = await load();
  loaded[code] = pack;
  return pack;
}

export const isRtl = (code: string): boolean => UI_RTL.includes(code);

/** 1.0's detectDefaultUiLang: a browser language tag → an interface language. */
export function detectDefaultUiLang(tag: string | null | undefined): string {
  const v = String(tag || '').trim().toLowerCase().replace('_', '-');
  if (!v) return 'en';
  if (v.indexOf('zh') === 0) return 'zh-Hans';
  if (hasLang(v)) return v;
  const primary = v.split('-')[0]!;
  return hasLang(primary) ? primary : 'en';
}

/** 1.0's resolveStoredUiLang: the saved choice (beuk.uiLang.v1), when it names a pack. */
export function resolveStoredUiLang(): string | null {
  try {
    const v = window.localStorage && localStorage.getItem(UI_LANG_KEY);
    return v && hasLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeUiLang(code: string): void {
  try {
    if (window.localStorage) localStorage.setItem(UI_LANG_KEY, code);
  } catch {
    /* private mode: the choice lasts this visit */
  }
}

/** The language the studio opens in: the saved choice, else the browser's. */
export function initialUiLang(): string {
  return resolveStoredUiLang() || detectDefaultUiLang((typeof navigator !== 'undefined' && navigator.language) || 'en');
}
