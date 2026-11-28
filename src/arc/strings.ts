/**
 * ARC campaigns: every string a reader sees — the claim and copy pages,
 * the reader emails and the stamp — in the 13 interface languages.
 *
 * ARC_EN is the source. The other twelve tables are filled by Task 9 as
 * UNSIGNED drafts (docs/strings-pending-signoff.md); until a key is there,
 * arcT gives the English line, key by key, never a blank.
 *
 * Fixed by the spec or the plan, verbatim: `arc.stamp` (V's stamp line),
 * `arc.mail.review` and `arc.mail.stampNote`. Every other line here was
 * written for slice 1 (Task 2) and is V's to change. None of them asks
 * for a review or treats one as owed (Amazon's rule; the spec's
 * "if you'd like to review it").
 */

export const ARC_LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'] as const;
export type ArcLang = (typeof ARC_LANGS)[number];

export const ARC_EN = {
  // The stamp on the copyright page (V, verbatim). Used by the stamp (Task 3).
  'arc.stamp': 'Advance Review Copy prepared for {name} ({email})',

  // Lines every reader email shares.
  'arc.mail.review': "If you'd like to review it after reading, you're welcome to. It's never required.",
  'arc.mail.stampNote': 'Your copy shows your name and email on its copyright page.',
  'arc.mail.why': 'You got this email because someone asked for an advance copy of {title} with this address.',
  'arc.mail.who': 'Sent by {author}, through Beuk.',
  'arc.mail.notMe': 'Not you? {url}',
  'arc.mail.stop': 'No more email from {author}: {url}',
  'arc.mail.copyLink': 'Your copy: {url}',

  // The code that confirms the address.
  'arc.mail.code.subject': 'Your code for {title}',
  'arc.mail.code.lead': 'Your code is {code}.',
  'arc.mail.code.body': 'Enter it on the page where you asked for an advance copy of {title} from {author}.',
  'arc.mail.code.ignore': "If you didn't ask for a copy, you can ignore this email.",

  // Instant mode: the copy is ready.
  'arc.mail.ready.subject': 'Your advance copy of {title}',
  'arc.mail.ready.lead': 'Here is your advance copy of {title} from {author}.',

  // Approval mode: waiting, then the author's answer.
  'arc.mail.pending.subject': 'Your request for {title} is waiting for {author}',
  'arc.mail.pending.lead': 'Thank you for asking for an advance copy of {title}.',
  'arc.mail.pending.body': '{author} looks at each request. You will get one more email when they decide.',
  'arc.mail.approved.subject': '{author} approved your request for {title}',
  'arc.mail.approved.lead': '{author} approved your request. Here is your advance copy of {title}.',
  'arc.mail.declined.subject': 'Your request for {title}',
  'arc.mail.declined.lead': '{author} is not sending you an advance copy of {title} this time.',
  'arc.mail.declined.body': 'Thank you for asking.',
} as const;

export type ArcKey = keyof typeof ARC_EN;

export const ARC_STRINGS: Record<ArcLang, Partial<Record<ArcKey, string>>> = {
  en: ARC_EN,
  es: {},
  fr: {},
  de: {},
  it: {},
  pt: {},
  nl: {},
  pl: {},
  ru: {},
  tr: {},
  ar: {},
  ja: {},
  'zh-Hans': {},
};

const LISTED = new Set<string>(ARC_LANGS);

/** The reader-facing language for a book language tag: any Chinese tag →
 *  'zh-Hans' (the one Chinese table); otherwise the primary subtag when
 *  it is listed; otherwise English. */
export function arcLang(bookLang: string): ArcLang {
  const tag = String(bookLang ?? '').trim().toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh-Hans';
  const primary = tag.split(/[-_]/)[0];
  return primary !== 'zh' && LISTED.has(primary) ? (primary as ArcLang) : 'en';
}

export function arcDir(lang: ArcLang): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** One {placeholder} pattern, shared with the HTML filler in emails.ts. */
export const ARC_PLACEHOLDER = /\{(\w+)\}/g;

/** The line for `key` in `lang` (English when the language has none yet),
 *  with each {name} filled from `vars` in one pass, so a value that itself
 *  contains "{…}" is never filled again. A placeholder with no value is
 *  left as written. */
export function arcT(lang: ArcLang): (key: ArcKey, vars?: Record<string, string | number>) => string {
  const table = ARC_STRINGS[lang] ?? {};
  return (key, vars) => {
    const line = table[key] ?? ARC_EN[key];
    if (!vars) return line;
    return line.replace(ARC_PLACEHOLDER, (whole, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
    );
  };
}
