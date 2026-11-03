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
  'next.snapshotGone': 'That snapshot is no longer here — the book was replaced or the snapshot removed. Nothing was changed.',
  'next.bookReplaced': 'The book was replaced in another tab while this one was asking. Nothing was changed.',
  // per-user themes ("My themes", plan 2026-11-02): 1.0 already calls the book's own list "My Themes" (themes.mineH),
  // so the writer's per-account list is "Themes for every book"
  'next.themes.everyH': 'Themes for every book',
  'next.themes.everySub': 'Themes you keep for yourself, apart from any one book. One click copies a theme — with its fonts and flourishes — into this book and applies it. Removing one here never changes a book.',
  'next.themes.account': 'Kept with your account: they follow you to every device you sign in on.',
  'next.themes.deviceOnly': 'Kept on this device only. Sign in and they follow you to every device.',
  'next.themes.empty': 'Nothing kept for every book yet. Use “Keep for every book” on one of this book’s themes, or in the Theme Creator.',
  'next.themes.keep': 'Keep for every book',
  'next.themes.kept': '“{name}” is kept for every book',
  'next.themes.removed': '“{name}” is no longer kept for every book — no book was changed',
  'next.themes.offer': 'This book has themes of its own. Keep them for every book too?',
  'next.themes.offerYes': 'Keep them',
  'next.themes.offerNo': 'No, thanks',
  'next.themes.moveOffer': 'Some themes are kept on this device only. Move them to your account, so they follow you to every device?',
  'next.themes.moveYes': 'Move them',
  'next.themes.deviceSuffix': ' (this device)',
  'next.themes.conflict': '“{name}” was changed on another device too. Both are kept: this device’s version is named “(this device)”.',
  'next.themes.full': 'Themes for every book holds at most 200 themes. Remove one, then keep “{name}” again.',
  'next.themes.refused': '“{name}” could not be kept with your account, so it stays on this device.',
  // wave 5a: the top bar's opener of 1.0's export modal (1.0's own #btnExport opens it; 2.0's #btnExport stays the backup
  // download, Part C ruling 2) — 1.0's words: its #btnExport's aria-label, which has no key
  'next.exportBook': 'Export book',
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
