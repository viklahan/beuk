/* Interface strings 2.0 needs that 1.0 has no key for (step 4 part C).
   1.0's UI_STRINGS stays the one source for every string it has; these are
   NEW keys only, never a second copy of one (test/keys.test.ts fails if a
   key here also exists in 1.0's English pack).

   Localization rule: English, plus a placeholder in every interface
   language. The placeholders are the English text, waiting for drafted
   translations and V's sign-off (PENDING_SIGNOFF); nothing here is an
   approved translation. When the port moves strings out of index.html
   (step 6), these join the catalog. */

const EN = {
  'next.textWarning': '{n} broken character in “{chapter}” could not be kept and became �.',
  'next.textWarningPlural': '{n} broken characters in “{chapter}” could not be kept and became �.',
  'next.markRefused': 'That can’t be italic or bold here — its asterisks would read back as something else.',
} as const;

export type NextKey = keyof typeof EN;

/** Keys whose non-English text is still the English placeholder (all of them, until V signs off). */
export const PENDING_SIGNOFF: readonly NextKey[] = Object.keys(EN) as NextKey[];

const placeholder = (): Record<NextKey, string> => ({ ...EN });

/** One table per interface language (1.0's UI_LANG_ORDER). */
export const NEXT_STRINGS: Readonly<Record<string, Readonly<Record<NextKey, string>>>> = {
  en: EN,
  es: placeholder(),
  fr: placeholder(),
  de: placeholder(),
  it: placeholder(),
  pt: placeholder(),
  nl: placeholder(),
  pl: placeholder(),
  ru: placeholder(),
  tr: placeholder(),
  ar: placeholder(),
  ja: placeholder(),
  'zh-Hans': placeholder(),
};
