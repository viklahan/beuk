---
slug: box-sets
title: Build a box set
blurb: Several books, one volume: dividers, title pages, and a single table of contents.
group: ship
audience: [shipping]
updated: 2026-10-25
readMinutes: 2
related: [import-a-manuscript, platform-presets]
---

What you're doing: binding several finished books into one omnibus EPUB — a trilogy in a single volume, a series starter bundle, the complete works of one productive winter.

## Steps

1. Open the **Export** dialog and find the **Box Set** section. The book in the studio is always **Book One**.
2. Use **Add a Book…** to bring in the next volumes as manuscripts (`.docx`, `.md`, `.txt`, or `.rtf`). Each is listed with its chapter and word counts; any book can be removed again.
3. Pick a platform preset if the set is headed for a particular store — it applies to the combined package.
4. Choose **Build Box Set .epub**. Beuk assembles one volume: a divider and title page for each book, then its sections in order, book by book.

## Explanation

### How the combined book is put together

- One unified table of contents: each book is a part, its chapters nested beneath it.
- Every book keeps its own cover, images, and endnotes, rendered under that book's context.
- Files inside the package are volume-prefixed, so nothing from Book Two can collide with Book One.

## Troubleshooting

### What can go wrong

**The combined file is enormous.** Box sets add up — three image-rich novels can make a file some stores cap. If a store refuses on size, reduce image dimensions in the later volumes, or split the set.

**Book Two's chapters show Book One's styling.** By design: a box set is one publication, typeset once, consistently. If a volume truly needs its own look, export it as its own book instead.

**A book imported with no chapters.** Same cause as in [Import a manuscript](/help/import-a-manuscript): chapters are found by heading styles. Fix them in the source file and add the book again.
