---
slug: import-a-manuscript
title: Import a manuscript
blurb: Bring a book in from Word, Markdown, or plain text — and see what Beuk tidies on the way in.
group: write
audience: [new]
updated: 2026-10-25
readMinutes: 2
related: [typeset-a-chapter, add-a-cover]
---

What you're doing: bringing a finished (or nearly finished) book into Beuk so it can be typeset. Beuk accepts Word documents (`.docx`), Markdown (`.md`), and plain text (`.txt`).

## Steps

1. Open the studio and choose **Import**.
2. Pick your file. A `.docx` from Word or Google Docs works best if you have one — headings, italics, and blockquotes survive the trip.
3. Beuk reads the file and lays the book out in its three tiers: **Front Matter** (title page, copyright, dedication…), **Body** (prologue, chapters, epilogue), and **Back Matter** (acknowledgments, About the Author, Also By).
4. Walk the section list on the left. Anything the importer guessed wrong — a chapter it read as front matter, say — can be moved; nothing is locked.
5. Fill in the book's details (title, subtitle, author, ISBN if you have one) in Project Settings. You can do this later, but exports carry them.

## Explanation

### What Beuk tidies on the way in

The importer has a smart sanitizer. Straight quotes become proper curly quotes, double hyphens become em dashes, three dots become an ellipsis, and the invisible clutter Word tucks into documents (Mso styles, stray spans, XML declarations) is stripped away — while real formatting (paragraphs, emphasis, headings, scene breaks) is kept.

## Troubleshooting

### What can go wrong

**My chapters arrived as one long section.** The importer splits on heading styles. If your chapters were typed as big bold text rather than Heading 1, they read as one flow. Fix the headings in Word and re-import, or split the section by hand in the editor.

**Some formatting vanished.** Beuk keeps semantic formatting — emphasis, strong, headings, quotes — and deliberately drops decorative formatting (coloured text, font changes mid-chapter). Typesetting replaces decoration; that's the point of the studio.

**The file won't import at all.** Check it's really a `.docx` (not the older `.doc`) — in Word, use Save As → Word Document (.docx). Very large files with many embedded images can also be slow; give it a minute before assuming the worst.
