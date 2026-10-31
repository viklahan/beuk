# Book corpus

Slimmed copies of real Beuk books, read by the book-format tests through
`tests/book-fixtures.ts` (`realFixtures()`, `fixturePath()`). Nothing here is
invented: each file is a gallery backup with keys, order and text unchanged.
Only binary payloads are replaced (an object with a string `data` and a
`mediaType` gets the smallest valid file of that type, a 1x1 PNG, JPEG, GIF
or WebP; any other type gets a 4-byte stub). Every replacement is listed in
the file's top-level `_fixture.slimmed`.

Each file is a whole backup envelope (`format`, `version`, `exportedAt`,
`book`) plus `_fixture: { source, slimmed, why }`.

## Making one

```
node tools/book-corpus/slim.mjs <src.beuk-backup.json> <out.json> --why "<coverage reason>"
```

The source is only read. The sources below are under
`beuk-whole-project/10-ramp-gallery` (66 books written 2026-10-27; display
books drafted for the gallery, not real writers' content).

## The books

| Fixture | Gallery source | Payloads slimmed | Why picked |
|---|---|---|---|
| `real/bookbinders-letter.json` | `books/ramp-the-bookbinders-letter.beuk-backup.json` | 1 | Newer shape: printBleed and manuscript present, colour set, one image |
| `real/dartagnan-01-three-musketeers.json` | `sagas/dartagnan/01-the-three-musketeers.beuk-backup.json` | 0 | Series volume with bible, no colour key, printBleed and manuscript present, 79 sections of public-domain text |
| `real/four-kitchens-book-one.json` | `sagas/world/sim07/b046-four-kitchens-book-one.beuk-backup.json` | 1 | Series book with colour, no bible |
| `real/lantern-coast-book-one.json` | `sagas/world/sim05/b035-the-lantern-coast-book-one.beuk-backup.json` | 14 | Series book with bible, no colour key, printBleed present |
| `real/lantern-coast-print.json` | `books/the-lantern-coast-print.beuk-backup.json` | 37 | 29 sections, no colour key, no printBleed key; print-export variant |
| `real/lunas-beach-standalone.json` | `books/ramp-lunas-beach-treasure-hunt.beuk-backup.json` | 10 | Children's picture book: colour set, no printBleed key, image-heavy |
| `real/oz-14-glinda.json` | `sagas/oz/14-glinda-of-oz.beuk-backup.json` | 103 | Saga volume with bible and 103 embedded illustrations (image-heavy) |
| `real/reads-you.json` | `books/ramp-the-book-that-reads-you.beuk-backup.json` | 0 | Smallest book; colour set, no printBleed key, no manuscript, no images |
| `real/salt-road-book-one.json` | `sagas/world/sim04/b030-salt-road-book-one.beuk-backup.json` | 2 | Series book with bible and colour together |
| `real/salt-road-standalone.json` | `books/ramp-salt-road.beuk-backup.json` | 4 | Standalone book with colour, no printBleed or manuscript keys (pre-bleed shape), embedded images |
| `real/valois-02-chicot.json` | `sagas/valois/02-chicot-the-jester.beuk-backup.json` | 0 | Series volume with bible and 108 sections (section-heavy) |

## Known gaps

- No RTL-language book (ar/fa/he/ur): every gallery book is `en`. The corpus
  test reports this as a diagnostic.
- None of the gallery books has `outline`, `notebook` or `research`, and no
  payload needed a stub (every embedded file was a JPEG).
- The newest keys need studio-made books (format design spec, Corpus section).
