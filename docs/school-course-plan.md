# Beuk School: the next five courses (outline)

Status: draft for V, 2026-11-15. Nothing here is published; a course
appears on /school only when its folder exists under
`content/school/en/`. Every lesson below teaches a feature that already
ships, and names where that feature is documented (Help guide or the
changelog entry), so the scripts can be checked against the studio,
not memory.

How a course gets made (same pipeline as Maiden Voyage):

1. Write `course.md` (title, blurb, `section`, `level`, `stages`,
   `cover`) and one `NN-slug.md` per lesson (lede, `## Steps` with a
   `say:` line and `do:` shot commands per step, `## Takeaway`).
2. Check every `do:` target against the live studio's real button
   labels before recording. A label that has changed breaks the take.
3. Record with `tools/school-media`, the same as Maiden Voyage (video,
   audio, one screenshot per step).
4. Cover art: one landscape image per course, like
   `client/site/school/maiden-voyage.webp`.

Section and level are written in each heading below. The bands are already in
`content/school/en/sections.md`.

---

## 1. Print, properly
Section: Make it print · Level: beginner · Stages: ship

From manuscript to a paperback interior a printer accepts.

| # | Lesson | Teaches | Source |
|---|---|---|---|
| 1 | Pick a trim size | the trim sizes and what each suits | Help: print-interiors |
| 2 | Gutters and margins | mirrored gutters that grow with page count | Help: print-interiors |
| 3 | Running heads that print | running heads and page numbers | Changelog 2026-10-31 |
| 4 | Pictures to the edge | Bleed (0.125 in) for plates and spread backdrops | Changelog 2026-10-27 |
| 5 | The print view and preflight | Open Print View, Run Print Preflight | Help: print-interiors |
| 6 | The file for the printer | print-ready PDF and PDF/X-1a, made on the server | Changelog 2026-10-31 |

## 2. Covers that sell
Section: Make it print · Level: beginner · Stages: draft, ship

The front, then the whole wrap: spine and back, sized to the book.

| # | Lesson | Teaches | Source |
|---|---|---|---|
| 1 | The front cover | cover image and how it rides in the EPUB | Help: add-a-cover |
| 2 | Type on the cover | display faces and book colour | Changelog 2026-10-26 |
| 3 | The spine | spine text, direction (top-to-bottom or bottom-to-top), head and foot icons, imprint that shrinks to fit | Changelog 2026-10-31 |
| 4 | The back cover | its own background, font and colour | Changelog 2026-10-31 |
| 5 | Export the wrap | cover wrap PDF and JPG from the server | Changelog 2026-10-31 |

## 3. Getting to the stores
Section: Make it print · Level: advanced · Stages: ship

One manuscript, every store, and no midnight rejections.

| # | Lesson | Teaches | Source |
|---|---|---|---|
| 1 | Presets: what actually differs | the eleven store presets | Help: platform-presets |
| 2 | The thirteen checks | Validate This Book; warnings vs failures | Help: check-your-book |
| 3 | Look inside the file | Package Inspector | Help: check-your-book |
| 4 | EPUBCheck on the server | Archive → Run EPUBCheck | Help: check-your-book |
| 5 | When a store says no | reading a rejection with the error decoder | Help: epub-error-decoder |
| 6 | Rights on the copyright page | All rights reserved, public domain, Creative Commons | Changelog 2026-10-27 |

## 4. Box sets and series
Section: Books in company · Level: advanced · Stages: draft, ship

Several books, one volume, and the series bible that keeps them straight.

| # | Lesson | Teaches | Source |
|---|---|---|---|
| 1 | The Covenant | the series bible; it never reaches an export | Changelog 2026-10-28 |
| 2 | Add a book to the set | Add a Book from a backup file, with its cover and pictures | Changelog 2026-10-27 |
| 3 | Dividers and one contents | title pages, dividers, the single table of contents | Help: box-sets |
| 4 | Every volume keeps its name | volume titles from the book itself | Changelog 2026-10-27 |
| 5 | Export the omnibus | the combined EPUB and print | Help: box-sets |

## 5. Beta readers
Section: Books in company · Level: beginner · Stages: draft

Send the book out, hear back, and know whose copy is whose.

| # | Lesson | Teaches | Source |
|---|---|---|---|
| 1 | A reading copy | share link, what a reader sees | Help: share |
| 2 | A link for each reader | named links, own expiry, copy or close by name | Changelog 2026-11-08 |
| 3 | Whose copy is it | the reader's name on every page and the faint stamp | Changelog 2026-11-08 |
| 4 | Comments that come back | each reader sees only their own; Reader comments | Changelog 2026-11-08 |
| 5 | A locked copy for an editor | the Word file, submission manuscript or print PDF downloaded with a password; the lock is made in the browser | Changelog 2026-11-06 |
| 6 | Closing a link | revoke, expiry, what the reader sees after | Help: share |

---

Order I'd make them in: **Print, properly** first (most-asked, and it
fills the "Make it print" band), then **Beta readers** (opens the second
band), then the rest. The page shows a band only once it has a course.
