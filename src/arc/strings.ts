/**
 * ARC campaigns: every string a reader sees — the claim and copy pages,
 * the reader emails and the stamp — in the 13 interface languages.
 *
 * ARC_EN is the source. The other twelve tables are filled by Task 9 as
 * UNSIGNED drafts (docs/strings-pending-signoff.md); until a key is there,
 * arcT gives the English line, key by key, never a blank.
 *
 * Fixed by the spec or the plan, verbatim: `arc.stamp` (V's stamp line),
 * `arc.stampPage.title`, `arc.mail.review` and `arc.mail.stampNote`;
 * and, from the plan (Task 6), `arc.claim.title`, `.lede`, `.review`,
 * `.submit`, `.stampNote` and `.profile`.
 * The stamp and its page title stay English in every language in slice 1
 * (controller ruling F16: an unsigned translation inside a reader's EPUB
 * cannot be recalled), so Task 9 leaves those two keys untranslated and
 * src/arc/stamp.ts reads them from English whatever the reader's
 * language. Every other line here was
 * written for slice 1 (Task 2) and is V's to change. None of them asks
 * for a review or treats one as owed (Amazon's rule; the spec's
 * "if you'd like to review it").
 */

export const ARC_LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'] as const;
export type ArcLang = (typeof ARC_LANGS)[number];

export const ARC_EN = {
  // The stamp on the copyright page (V, verbatim). Used by the stamp (Task 3).
  'arc.stamp': 'Advance Review Copy prepared for {name} ({email})',
  // The title of the one-line page the stamp adds when a book has no
  // copyright page (Task 3). Like the stamp, English only in slice 1
  // (controller ruling F16).
  'arc.stampPage.title': 'Advance Review Copy',

  // Lines every reader email shares.
  'arc.mail.review': "If you'd like to review it after reading, you're welcome to. It's never required.",
  'arc.mail.stampNote': 'Your copy shows your name and email on its copyright page.',
  'arc.mail.why': 'You got this email because someone asked for an advance copy of {title} with this address.',
  'arc.mail.who': 'Sent by {author}, through Beuk.',
  'arc.mail.notMe': 'Not you? {url}',
  'arc.mail.stop': 'No more email from {author}: {url}',
  'arc.mail.copyLink': 'Your copy: {url}',
  // {author} when the book names none (the plan's words, Task 6; added in Task 5 for the approve and decline emails).
  'arc.theAuthor': 'the author',

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

  // The claim page (Task 6). From the plan, verbatim: arc.claim.title,
  // .lede, .review (plan-authored, ruling F15), .submit, .stampNote and
  // .profile. Every other line below was written for Task 6 and is V's
  // to change.
  'arc.claim.title': '{title} — an advance copy from {author}',
  'arc.claim.lede': '{author} is giving early copies to readers before {date}.',
  'arc.claim.review': "If you'd like to review it after reading, you're welcome to. It's never required.",
  'arc.claim.cover': 'The cover of {title}',
  'arc.claim.name': 'Your name',
  'arc.claim.email': 'Your email',
  'arc.claim.profile': 'A Goodreads or Amazon profile link',
  'arc.claim.profileNote': '{author} sees this link as text. Beuk never opens it.',
  'arc.claim.approvalNote': '{author} looks at each request and answers by email.',
  'arc.claim.codeNote': 'Beuk will email you a 6-digit code to confirm the address.',
  'arc.claim.honeypot': 'Leave this empty',
  'arc.claim.submit': 'Get my copy',
  'arc.claim.stampNote': 'Your copy will show your name and email on its copyright page.',
  // Why a claim was not taken.
  'arc.claim.err.closed': 'Sign-ups for this advance copy have closed.',
  'arc.claim.err.full': 'Every copy has been claimed. Thank you for asking.',
  'arc.claim.err.blocked': "Beuk can't email this address. Someone using it asked for no more advance-copy email, so no code can be sent.",
  'arc.claim.err.mailOff': "Beuk can't send advance-copy email right now, so no claim was taken. Please try again later.",
  'arc.claim.err.busy': 'Too many tries for now. Please wait a while, then try again.',
  'arc.claim.err.badName': 'Please write your name, in at most 60 characters.',
  'arc.claim.err.badEmail': 'Please check your email address.',
  'arc.claim.err.badProfile': 'Please add a link to your Goodreads or Amazon profile, starting with https://.',
  'arc.claim.err.answered': '{author} has already answered a request from this address.',
  'arc.claim.err.revoked': "{author} closed the copy given to this address, so it can't be claimed again.",

  // The code page.
  'arc.code.title': 'Enter your code',
  'arc.code.sentTo': 'Beuk sent a 6-digit code to {email}. It works for {minutes} minutes.',
  'arc.code.sentAny': 'Beuk sent a 6-digit code to the address you gave. It works for {minutes} minutes.',
  'arc.code.label': 'Your code',
  'arc.code.submit': 'Confirm',
  'arc.code.again': 'Ask for a new code',
  'arc.code.err.wrong': "That code doesn't match. Please check it and try again.",
  'arc.code.err.expired': 'This code has run out, or was tried too many times. Ask for a new one.',
  'arc.code.err.unknown': 'This code is no longer valid. Ask for a new one.',

  // Approval mode: confirmed, now waiting.
  'arc.wait.title': 'Your request is with {author}',
  'arc.wait.lead': 'Thank you, {name}. Your address is confirmed.',
  'arc.wait.body': '{author} looks at each request. You will get one more email when they decide.',

  // Pages with no campaign behind them, or a closed one.
  'arc.page.unknownTitle': "We couldn't find this page",
  'arc.page.unknown': 'The link may be incomplete. Check that it was copied in full.',
  'arc.page.closedTitle': 'Sign-ups have closed',
  'arc.foot.privacy': 'Privacy',
  'arc.foot.terms': 'Terms',
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
