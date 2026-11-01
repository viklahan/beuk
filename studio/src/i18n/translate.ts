/* 1.0's t(), ported with its exact semantics (client/index.html, function
   t and tCountForm — test/translate.test.ts runs 1.0's own code beside
   this one on real keys):
   - {named} placeholders; a placeholder without a value stays as written;
   - a key ending in "Plural" is chosen when params.n is a number !== 1;
   - params.count (a number) picks the CLDR form: a language-specific
     extra form from UI_PLURAL_FORMS, then the base key for "one", then
     the "Plural" twin;
   - the English pack is the runtime fallback, and a key nowhere at all
     comes back as the key itself. */
export type Pack = Readonly<Record<string, string>>;
export type PluralForms = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
export type Params = Readonly<Record<string, unknown>>;

export type Tables = {
  /** Loaded packs by language code; `en` is always present. */
  packs: Readonly<Record<string, Pack | undefined>> & { en: Pack };
  pluralForms: PluralForms;
};

const pluralRules: Record<string, Intl.PluralRules> = {};
function pluralCategory(lang: string, n: number): string {
  try {
    const loc = lang || 'en';
    if (!pluralRules[loc]) pluralRules[loc] = new Intl.PluralRules(loc);
    return pluralRules[loc].select(n);
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}

function countForm(tables: Tables, pack: Pack, uiLang: string, lang: string, key: string, n: number): string | null {
  const cat = pluralCategory(uiLang, n);
  const extra = tables.pluralForms[lang]?.[key];
  if (extra && extra[cat] != null) return extra[cat]!;
  if (cat === 'one') return pack[key] != null ? pack[key]! : null;
  if (pack[key + 'Plural'] != null) return pack[key + 'Plural']!;
  return pack[key] != null ? pack[key]! : null;
}

export function translate(tables: Tables, uiLang: string, key: string, params?: Params): string {
  const en = tables.packs.en;
  const own = tables.packs[uiLang];
  const pack = own || en;
  const n = params?.n;
  let s: string | null | undefined = null;
  if (params && typeof params.count === 'number') {
    s = countForm(tables, pack, uiLang, own ? uiLang : 'en', key, params.count);
    if (s == null) s = params.count !== 1 && en[key + 'Plural'] != null ? en[key + 'Plural'] : en[key];
  } else if (typeof n === 'number' && n !== 1 && pack[key + 'Plural'] != null) s = pack[key + 'Plural'];
  else if (pack[key] != null) s = pack[key];
  else if (typeof n === 'number' && n !== 1 && en[key + 'Plural'] != null) s = en[key + 'Plural'];
  else s = en[key];
  if (s == null) return key;
  return String(s).replace(/\{(\w+)\}/g, (m, name: string) => (params && params[name] != null ? String(params[name]) : m));
}
