---
slug: footnotes-and-images
title: Footnotes, endnotes & images
blurb: Notes that link both ways, pictures that sit properly, and words for readers who can't see them.
group: write
audience: [new, hand-edit]
updated: 2026-11-24
readMinutes: 5
related: [check-your-book, typeset-a-chapter]
---

What you're doing: adding the apparatus of a serious book — notes that link both ways, and pictures that sit in the text the way you placed them.

## Explanation

### Notes

1. Place the cursor where the note belongs and use the **Endnote** toolbar button (or type a reference like `[^1]`), then write the note's text where Beuk asks for it.
2. In the preview, the reference is a small linked number. Tap it and you land on the note; the note carries a back-link that returns you to the exact line you left.
3. In the exported EPUB these are true notes — marked with the proper `epub:type` semantics — so e-readers can offer them as pop-ups where they support it, and as a notes section where they don't. In print, **Notes in print** (in Export and the Print Interior View) sets them at the foot of the page or at the end of the chapter; the EPUB keeps its linked notes either way.
4. A reference with no note behind it degrades politely to a plain superscript number. It never becomes a dead link in a reader's hands.

### Images

1. Use **Insert Image** in the editor. Upload a `JPG` or `PNG` to the book's image library, or pick one already there.
2. **Write the alt text.** One plain sentence describing the image for readers who can't see it. Stores increasingly require it; readers have always deserved it. Add a **Caption** too, if you like: it is set under the picture.
3. Choose **Standard** (sits within the text column) or **Full-bleed** (runs to the page edges where the reading system allows).
4. Placed images can be adjusted later from the strip under the editor: change alt text, toggle full-bleed, or remove the placement (the library keeps the file).

### Removing a picture from the book

1. In the image library (**Insert Image**, and the scene-break picker) every picture has a small bin button.
2. A picture nothing uses goes at once, with **Undo** for ten seconds.
3. A picture in use first shows where — "Chapter Three (in the text), Chapter Five (plate)". **Remove it everywhere** takes it out of the text, the plate, the backdrop, the scene break, the cover or the flourishes, just as removing each by hand would, and Undo puts it all back. If it is your cover's artwork, the cover made with it goes too.
4. **Remove unused pictures** clears every picture nothing in the book uses, saying first how many there are and how much space they take.

Each removal keeps a snapshot in History ("Before removing a picture"), so a picture can always come back. That snapshot holds the picture, so the saved book only gets smaller once you delete the snapshot in History. The sample story's own pictures stay with the sample.

### Typing the marks yourself

Every button in the editor simply types a small mark for you. If you ever write or import text by hand, these are the ones you'll meet most — you never need this list to use Beuk; it's here for the curious.

1. `***` alone on a line — a scene break (it wears whichever ornament the book's typesetting chose).
2. `>` at the start of a line — a blockquote.
3. `*italic*` and `**bold**` — emphasis, the usual way.
4. `[^1]` in the text, with its note defined on its own line as `[^1]: the note itself` — a linked endnote.
5. `- ` at the start of each line — a bulleted list; `1. ` — a numbered list.
6. `[words](https://…)` — a web link (a `mailto:` address works too).
7. `::: verse` on a line of its own, then the lines, then `:::` — a block set apart. Other kinds include `center`, `right`, `letter`, `texts`, `transcript`, `log` and `margin`; the toolbar buttons type these for you. A chapter that is a poem from its first line to its last needs no mark at all: the **P** button at the start of the toolbar turns Poem Mode on for the chapter, so that every new line is a line of the poem and a blank line starts a new stanza, centred or left. Turning it off again changes none of your words.
8. `||words||` — redacted: readers see bars in place of the words, never the words themselves.
9. An image sits on its own line, placed by **Insert Image** from the book's library.

And one thing has no mark at all: the **Auto-Format** button in the editor. Press it and, in the section you have open, straight quotes become smart quotes, double hyphens become em-dashes and three dots become an ellipsis. Nothing else makes that change for you: the preview, the EPUB, the print interior and the Word and Markdown files set your quotes, hyphens and dots as they stand in the editor.

## Troubleshooting

### What can go wrong

**My note appears twice / the numbering restarts.** Notes are numbered per section, which is the convention stores expect. If a note looks duplicated, check you didn't also type its text into the body — the definition line itself never prints.

**An image is missing from the export.** Run the [validator](/help/check-your-book) — it lists every image in the package and flags any without alt text or a manifest entry.

**Full-bleed looks ordinary in the preview.** In the device preview, full-bleed spans the full text column; true edge-to-edge breakout shows in the standalone HTML export and supporting readers. That's the honest state of e-reader support, not a fault in your file.
