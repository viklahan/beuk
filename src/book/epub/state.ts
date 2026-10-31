import type { BookV1 } from '../schema.js';

/* BEUK:epub-server — the studio's global `state`, as far as its EPUB code
   reads it, built from a book readBook has opened. The studio's
   applyBookDoc fills the same keys from the same book; the parity test
   (tests/book-epub-parity.test.ts) holds the two to the same files. */

export type EpubState = Record<string, unknown>;

export function epubState(book: BookV1, platform: string): EpubState {
  const b = structuredClone(book) as unknown as Record<string, unknown>;
  const { colour, ...rest } = b;
  return {
    ...rest,
    /* serializeBook writes the book colour as `colour`; the studio holds it as state.bookColour */
    bookColour: colour,
    exportPlatform: platform,
  };
}
