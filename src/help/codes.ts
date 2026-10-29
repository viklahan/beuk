import { getHelpContent, type HelpContent } from './content.js';

/**
 * H1.3 — BEUK- codes at the source. The mapping is the error
 * dictionary itself (content/help/errors.json `maps`): an EPUBCheck
 * message id or a studio validator check id maps to the one entry that
 * lists it, or to nothing. Nothing is guessed: an id no entry lists
 * gets `null`, never a nearest match.
 *
 * EPUBCheck spells some message ids with a lower-case variant suffix
 * (the bundle has RSC_007 and RSC_007w — the same text, raised at a
 * different severity); the variant maps like its base id.
 */

export function beukCodeForEpubcheck(id: string, content: HelpContent = getHelpContent()): string | null {
  const exact = content.errors.find((e) => e.maps.epubcheck.includes(id));
  if (exact) return exact.code;
  const base = /^([A-Z]{3}-\d{3})[a-z]$/.exec(id)?.[1];
  if (!base) return null;
  return content.errors.find((e) => e.maps.epubcheck.includes(base))?.code ?? null;
}

export function beukCodeForValidator(checkId: string, content: HelpContent = getHelpContent()): string | null {
  return content.errors.find((e) => e.maps.validator.includes(checkId))?.code ?? null;
}

/** The HTTP error codes the API adds to its error bodies (additive:
 *  `{ error, code }` — every existing field stays as it was). */
export const HTTP_CODES = {
  manuscriptConflict: 'BEUK-C801',
  seriesConflict: 'BEUK-C802',
  readingCopyClosed: 'BEUK-H410',
  jobsBusy: 'BEUK-J702',
} as const;
