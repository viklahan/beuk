---
slug: footnotes-and-images
title: Footnotes, endnotes & images
blurb: Notes that link both ways, pictures that sit properly, and words for readers who can't see them.
group: write
audience: [new, hand-edit]
updated: 2026-10-25
readMinutes: 3
related: [check-your-book, typeset-a-chapter]
---

What you're doing: adding the apparatus of a serious book — notes that link both ways, and pictures that sit in the text the way you placed them.

## Explanation

### Notes

1. Place the cursor where the note belongs and use the **Endnote** toolbar button (or type a reference like `[^1]`), then write the note's text where Beuk asks for it.
2. In the preview, the reference is a small linked number. Tap it and you land on the note; the note carries a back-link that returns you to the exact line you left.
3. In the exported EPUB these are true notes — marked with the proper `epub:type` semantics — so e-readers can offer them as pop-ups where they support it, and as a notes section where they don't.
4. A reference with no note behind it degrades politely to a plain superscript number. It never becomes a dead link in a reader's hands.

### Images

1. Use **Insert Image** in the editor. Upload a `JPG` or `PNG` to the book's image library, or pick one already there.
2. **Write the alt text.** One plain sentence describing the image for readers who can't see it. Stores increasingly require it; readers have always deserved it.
3. Choose **Standard** (sits within the text column) or **Full-bleed** (runs to the page edges where the reading system allows).
4. Placed images can be adjusted later from the strip under the editor: change alt text, toggle full-bleed, or remove the placement (the library keeps the file).

### Typing the marks yourself

Every button in the editor simply types a small mark for you. If you ever write or import text by hand, these are all of them — you never need this list to use Beuk; it's here for the curious.

1. `***` alone on a line — a scene break (it wears whichever ornament the book's typesetting chose).
2. `>` at the start of a line — a blockquote.
3. `*italic*` and `**bold**` — emphasis, the usual way.
4. `[^1]` in the text, with its note defined on its own line as `[^1]: the note itself` — a linked endnote.
5. An image sits on its own line, placed by **Insert Image** from the book's library.

And one thing needs no mark at all: Auto-Format. Straight quotes become smart quotes, double hyphens become em-dashes, three dots become an ellipsis — the preview and the exported EPUB always use the polished text.

## Troubleshooting

### What can go wrong

**My note appears twice / the numbering restarts.** Notes are numbered per section, which is the convention stores expect. If a note looks duplicated, check you didn't also type its text into the body — the definition line itself never prints.

**An image is missing from the export.** Run the [validator](/help/check-your-book) — it lists every image in the package and flags any without alt text or a manifest entry.

**Full-bleed looks ordinary in the preview.** In the device preview, full-bleed spans the full text column; true edge-to-edge breakout shows in the standalone HTML export and supporting readers. That's the honest state of e-reader support, not a fault in your file.
