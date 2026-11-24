---
title: Dividers and one contents
blurb: The omnibus gets a divider and title page for each book, one unified table of contents, and one consistent typesetting.
guide: box-sets
---
An omnibus is not six files stapled together; it is one book with chapters that happen to belong to different volumes. Beuk assembles it so a reader always knows which book they are in.

## Steps
1. When the set is built, each book gets a divider and a title page of its own, and then its sections in order, book by book — front matter, chapters, back matter.
   say: When the set is built, each book gets a divider and a title page of its own, and then its sections in order, book by book.
   do: show "Box Set — Combined EPUB"
2. The set has one unified table of contents: each book is a part, with its chapters nested beneath it. Every book keeps its own cover, images and endnotes, rendered under that book's context, and the files inside the package are volume-prefixed, so nothing from Book Two can collide with Book One.
   say: The set has one table of contents. Each book is a part, with its chapters nested beneath it. Every book keeps its own cover, images and endnotes, and the files inside the package are prefixed by volume, so nothing from Book Two can collide with Book One.
   do: show "Build Box Set .epub"
3. A box set is one publication, typeset once, consistently — Book Two's chapters wear the set's styling by design. If a volume truly needs its own look, export it as its own book instead.
   say: A box set is one publication, typeset once, consistently. Book Two wears the set's styling by design. If a volume truly needs its own look, export it as its own book instead.
   do: show "Build Box Set .epub"

## Takeaway
One contents, one typesetting, a divider per book: the reader gets a single tidy volume, and no file inside it can tread on another.
