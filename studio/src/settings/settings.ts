import type { Closure } from '../closure/index';

/* Project Settings (1.0 #modalSettings: openSettings, rightsForm*, the
   btnSaveSettings handler), the book half, as pure functions over the
   book's `meta` object. 1.0's own rules run through the closure where 1.0
   has them as functions (rightsNormalizeInto, RIGHTS_KEYS,
   bookSeriesNumberInto, imIsPlaceholderTitle, rightsModeOf, rightsLine);
   the Save handler's straight-line code is ported here, line for line.

   Untouched stays absent: Save computes 1.0's new meta from the form and
   writes it only when it differs from the stored one (stableJson, 1.0's
   own), so opening Settings and saving without a change writes nothing,
   and no field the writer did not touch gains a default. */

type Rec = Record<string, unknown>;

export type SettingsForm = {
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  series: string;
  seriesNumber: string;
  isbn: string;
  year: string;
  rightsMode: string; // reserved | pd | cc | custom
  rights: string; // the Custom line
  ccLicence: string;
  firstPublished: string;
  editionHolder: string;
  language: string;
  description: string;
  a11ySummary: string;
};

const str = (v: unknown) => (v == null ? '' : String(v));

/** 1.0's imMetaValue over a meta object: a credit as the book really holds it (a stored placeholder title is none). */
function imValue(c: Closure, meta: Rec, f: string): string {
  const v = String(meta[f] || '').trim();
  return f === 'title' && (c.api as unknown as { imIsPlaceholderTitle: (s: string) => boolean }).imIsPlaceholderTitle(v) ? '' : v;
}

/** 1.0's openSettings + rightsFormFill: the form as Settings opens on this meta. */
export function formFromMeta(c: Closure, meta: Rec): SettingsForm {
  const mode = c.api.rightsModeOf(meta);
  return {
    title: imValue(c, meta, 'title'),
    subtitle: str(meta.subtitle),
    author: str(meta.author),
    publisher: str(meta.publisher),
    series: str(meta.series || ''),
    seriesNumber: meta.seriesNumber ? String(meta.seriesNumber) : '',
    isbn: str(meta.isbn),
    year: str(meta.year),
    rightsMode: mode,
    rights: str(meta.rights),
    ccLicence: mode === 'cc' ? str(meta.ccLicence) : 'by',
    firstPublished: str(meta.firstPublished || ''),
    editionHolder: str(meta.editionHolder || ''),
    language: str(meta.language),
    description: str(meta.description),
    a11ySummary: str(meta.a11ySummary || ''),
  };
}

type RightsApi = { rightsNormalizeInto: (target: Rec, src: Rec) => void; RIGHTS_KEYS: string[] };

/** 1.0's rightsFormMeta: what the rights rows say, as a meta fragment. */
export function rightsFormMeta(c: Closure, f: SettingsForm): Rec {
  const m: Rec = { year: f.year.trim(), author: f.author.trim(), rights: '' };
  if (f.rightsMode === 'custom') m.rights = f.rights.trim();
  (c.api as unknown as RightsApi).rightsNormalizeInto(m, { rightsMode: f.rightsMode, ccLicence: f.ccLicence, firstPublished: f.firstPublished, editionHolder: f.editionHolder });
  return m;
}

/** 1.0's rights preview line: t("rights.preview", { line: rightsLine(rightsFormMeta()) }) — the line half. */
export const rightsPreviewLine = (c: Closure, f: SettingsForm): string => c.api.rightsLine(rightsFormMeta(c, f));

/** 1.0's Save handler (BEUK:importmeta, BEUK:seriesnumber, BEUK:rights, the language lock), on a COPY of `meta`. */
export function metaFromForm(c: Closure, meta: Rec, f: SettingsForm): Rec {
  const m: Rec = JSON.parse(JSON.stringify(meta)) as Rec;
  const api = c.api as unknown as RightsApi & { bookSeriesNumberInto: (meta: Rec, v: unknown) => void };
  /* the placeholder is display-only: a blank title is stored blank. A credit the writer changes here is theirs; one
     they clear is open to the next import again. */
  const imPrev: Rec = { title: imValue(c, meta, 'title'), subtitle: imValue(c, meta, 'subtitle'), author: imValue(c, meta, 'author') };
  m.title = f.title.trim();
  m.subtitle = f.subtitle.trim();
  m.author = f.author.trim();
  for (const k of ['title', 'subtitle', 'author']) {
    const v = imValue(c, m, k);
    if (v !== imPrev[k]) {
      // imSetSource
      if (v) m[k + 'Source'] = 'writer';
      else delete m[k + 'Source'];
    }
  }
  m.publisher = f.publisher.trim();
  m.isbn = f.isbn.trim();
  /* the series name is trimmed and held to 120 characters; blank means none, so the key goes. (1.0 first asks a book
     reading a shared Covenant to leave or rename it, bibleSeriesChangeAsk: the Covenant is wave 3.) */
  const sn = f.series.trim().slice(0, 120);
  if (sn) m.series = sn;
  else delete m.series;
  api.bookSeriesNumberInto(m, f.seriesNumber);
  m.year = f.year.trim();
  // rightsFormApply: the choice, and the custom line only when Custom is chosen
  const r = rightsFormMeta(c, f);
  for (const k of api.RIGHTS_KEYS) {
    if (r[k] !== undefined) m[k] = r[k];
    else delete m[k];
  }
  m.rights = r.rights;
  const chosenLang = f.language;
  if (chosenLang && chosenLang !== m.language) {
    /* Picking a language by hand locks it: detection and imports never override a manual choice. */
    m.language = chosenLang;
    m.langSource = 'manual';
    m.langGuess = '';
  }
  m.description = f.description.trim();
  m.a11ySummary = f.a11ySummary.trim();
  return m;
}

/** The new meta to store, or null when Save changes nothing (key order aside, as 1.0's stableJson compares). */
export function settingsChange(c: Closure, meta: Rec, f: SettingsForm): Rec | null {
  const next = metaFromForm(c, meta, f);
  return c.api.stableJson(next) === c.api.stableJson(meta) ? null : next;
}

/** 1.0's refreshLangHint: the key and its {lang}. */
export function langHint(c: Closure, meta: Rec): { key: 'lang.hintGuess' | 'lang.hintLocked' | 'lang.hintDefault'; lang?: string } {
  const packs = (c.api as unknown as { LANG_PACKS: Rec }).LANG_PACKS;
  const pack = (c.api as unknown as { langPack: (code: unknown) => { native: string } }).langPack;
  if (meta.langGuess && packs[String(meta.langGuess)] && meta.langSource !== 'manual') return { key: 'lang.hintGuess', lang: pack(meta.langGuess).native };
  if (meta.langSource === 'manual') return { key: 'lang.hintLocked' };
  return { key: 'lang.hintDefault' };
}

/** 1.0's setLang options: every LANG_PACKS code, "native (code)". */
export function bookLanguages(c: Closure): { code: string; label: string }[] {
  const packs = (c.api as unknown as { LANG_PACKS: Rec }).LANG_PACKS;
  const pack = (c.api as unknown as { langPack: (code: unknown) => { native: string } }).langPack;
  return Object.keys(packs).map((code) => ({ code, label: pack(code).native + ' (' + code + ')' }));
}

/** 1.0's beukSupportLoad: the support address from /api/config/public, when it is a plain address. */
export function supportEmailFrom(j: unknown): string | null {
  const o = j as { support?: { email?: unknown } } | null;
  const e = o && o.support && typeof o.support.email === 'string' ? o.support.email.trim() : '';
  return /^[^\s@<>"']+@[^\s@<>"']+$/.test(e) ? e : null;
}
