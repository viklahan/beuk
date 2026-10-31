/* Test helpers that read 1.0 itself (client/index.html), for parity checks. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { extractStudioSource } from '../../src/book/studio/closure';

export const STUDIO_HTML_PATH = fileURLToPath(new URL('../../client/index.html', import.meta.url));
let html: string | null = null;
export const studioHtml = (): string => (html ??= readFileSync(STUDIO_HTML_PATH, 'utf8'));

export type OneT = {
  t: (lang: string, key: string, params?: Record<string, unknown>) => string;
  /** Delete a key from one of 1.0's packs in this instance (a synthetic gap). */
  drop: (lang: string, key: string) => void;
};

/** 1.0's own t() (with tCountForm, uiPluralCategory and every string
 *  table), lifted by the server's closure selection and run in a bare
 *  context. */
export function oneT(): OneT {
  const api =
    '\n;globalThis.__t = function (lang, key, params) { uiLangState = lang; return t(key, params); };' +
    '\nglobalThis.__drop = function (lang, key) { delete UI_STRINGS[lang][key]; };';
  const src = extractStudioSource(studioHtml(), ['t', 'tCountForm', 'uiPluralCategory', 'uiPluralRulesCache', 'uiLangState'], {
    listRef: 'studio/test/one-source.ts',
    api,
    stringTables: true,
  });
  const ctx = vm.createContext({});
  vm.runInContext(src.code, ctx);
  const fn = ctx.__t as (lang: string, key: string, params?: unknown) => string;
  const drop = ctx.__drop as (lang: string, key: string) => void;
  return { t: (lang, key, params) => fn(lang, key, params ? JSON.parse(JSON.stringify(params)) : undefined), drop };
}
