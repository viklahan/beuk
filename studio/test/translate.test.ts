// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import meta from '../src/generated/strings-meta.json';
import { translate, type Pack, type PluralForms, type Tables } from '../src/i18n/translate';
import { oneT, type OneT } from './one-source';

const pack = (code: string): Pack =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../src/generated/packs/${code}.json`, import.meta.url)), 'utf8')) as Pack;
const tables = (code: string): Tables => ({ packs: { en: pack('en'), [code]: pack(code) }, pluralForms: meta.pluralForms as PluralForms });

/* Ten real keys, with the params that exercise each rule: plain text,
   {named} placeholders (all, some, none given), the {n} !== 1 Plural
   twin, the CLDR {count} forms with UI_PLURAL_FORMS extras (Polish
   "many", Russian "few", Arabic), and English fallback for an unknown
   key. Every case is compared with 1.0's own t() on the same tables. */
const CASES: [string, Record<string, unknown> | undefined][] = [
  ['top.export', undefined],
  ['top.themeToCandle', undefined],
  ['side.untitled', undefined],
  ['side.sampleLoad', { n: 18000 }],
  ['side.sampleLoad', undefined],
  ['stats.pagesNote', { a: 250 }],
  ['stats.readingH', { h: 3, m: 7 }],
  ['type.dropLines', { n: 1 }],
  ['side.statsWords', { n: 1 }],
  ['side.statsWords', { n: 5 }],
  ['side.statsWords', { count: 1, n: 1 }],
  ['side.statsWords', { count: 3, n: 3 }],
  ['side.statsWords', { count: 5, n: 5 }],
  ['side.statsWords', { count: 22, n: 22 }],
  ['side.statsPages', { count: 11, n: 11 }],
  ['editor.countSection', { n: 0 }],
  ['editor.countBook', { count: 2, n: 2 }],
  ['no.such.key', { n: 2 }],
];

describe("t() — 1.0's semantics", () => {
  let one: OneT;
  beforeAll(() => {
    one = oneT();
  }, 60_000);

  for (const lang of meta.order) {
    it(`matches 1.0's t() in ${lang}`, () => {
      const tb = tables(lang);
      for (const [key, params] of CASES) expect(translate(tb, lang, key, params), `${lang} ${key} ${JSON.stringify(params)}`).toBe(one.t(lang, key, params));
    });
  }

  it("synthetic gap: a key deleted from a pack falls back to English exactly as 1.0's t() does", () => {
    const gap = oneT();
    const cases: [string, string, Record<string, unknown> | undefined][] = [
      ['de', 'top.export', undefined],
      ['de', 'side.sampleLoad', { n: 18000 }],
      ['pl', 'side.statsWords', { n: 5 }],
      ['ru', 'stats.readingH', { h: 1, m: 2 }],
      ['ar', 'editor.countBook', { count: 3, n: 3 }],
    ];
    for (const [lang, key, params] of cases) {
      const tb = tables(lang);
      const own = { ...tb.packs[lang]! } as Record<string, string>;
      delete own[key];
      delete own[key + 'Plural'];
      gap.drop(lang, key);
      gap.drop(lang, key + 'Plural');
      const holed: Tables = { packs: { en: tb.packs.en, [lang]: own }, pluralForms: tb.pluralForms };
      const ours = translate(holed, lang, key, params);
      expect(ours, `${lang} ${key} ${JSON.stringify(params)}`).toBe(gap.t(lang, key, params));
      if (typeof params?.count !== 'number') expect(ours, `${lang} ${key}: the gap was real`).not.toBe(translate(tb, lang, key, params));
    }
  }, 60_000);

  it('placeholders: named, missing ones stay as written', () => {
    const tb = tables('en');
    expect(translate(tb, 'en', 'stats.readingH', { h: 2, m: 5 })).toBe('2h 5m');
    expect(translate(tb, 'en', 'stats.pagesNote', { a: 250 })).toBe('Pages at 250 words/page · reading time at {b} wpm.');
  });

  it('plurals: the Plural twin when n !== 1; CLDR forms with {count}', () => {
    const tb = tables('pl');
    expect(translate(tables('en'), 'en', 'side.statsWords', { n: 1 })).toBe('1 word');
    expect(translate(tables('en'), 'en', 'side.statsWords', { n: 0 })).toBe('0 words');
    expect(translate(tb, 'pl', 'side.statsWords', { count: 5, n: 5 })).toBe('5 słów');
  });

  it('English fallback at runtime; an unknown key is the key', () => {
    const en = pack('en');
    const partial: Tables = { packs: { en, de: { 'top.export': 'Exportieren' } }, pluralForms: {} };
    expect(translate(partial, 'de', 'top.export')).toBe('Exportieren');
    expect(translate(partial, 'de', 'side.untitled')).toBe(en['side.untitled']);
    expect(translate(partial, 'xx', 'top.export')).toBe(en['top.export']);
    expect(translate(partial, 'de', 'no.such.key')).toBe('no.such.key');
  });
});
