---
slug: import-a-manuscript
title: Import a manuscript
blurb: Bring a book in from Word, Markdown, plain text, RTF, or PDF — and see what Beuk tidies on the way in.
group: write
audience: [new]
updated: 2026-10-26
readMinutes: 3
related: [typeset-a-chapter, add-a-cover]
---

What you're doing: bringing a finished (or nearly finished) book into Beuk so it can be typeset. Beuk accepts Word documents (`.docx`), Markdown (`.md`), plain text (`.txt`), Rich Text (`.rtf`, which Scrivener, TextEdit and LibreOffice also write), PDF (`.pdf`), and EPUB (`.epub`), so a book you only have as an ebook can come back in too (an EPUB under DRM cannot be read).

New to the studio? [Show the quick tour](/studio#tour): four short steps that point out Import, the page and its preview, Typography Studio, and Export. You can skip it at any step. In the studio it is also under the sample story, as **Show the quick tour**.

## Steps

1. Open the studio and choose **Import**.
2. Pick your file. A `.docx` from Word or Google Docs works best if you have one — headings, italics, and blockquotes survive the trip.
3. Beuk reads the file and lays the book out in its three tiers: **Front Matter** (title page, copyright, dedication…), **Body** (prologue, chapters, epilogue), and **Back Matter** (acknowledgments, About the Author, Also By).
4. Walk the section list on the left. Anything the importer guessed wrong — a chapter it read as front matter, say — can be moved; nothing is locked.
5. Fill in the book's details (title, subtitle, author, ISBN if you have one) in Project Settings. You can do this later, but exports carry them. Beuk starts you off from the document: a title page in the manuscript (the title, a subtitle, a "by …" line) becomes the book's title, subtitle and author, lifted out of the text; with nothing like a title page, the cleaned file name is used. The import report says where each detail came from.
6. A title, subtitle or author you typed yourself is never overwritten by a new import. The report shows what the document calls itself and offers **Use** instead.

## Explanation

### What Beuk tidies on the way in

The importer has a smart sanitizer. Straight quotes become proper curly quotes, double hyphens become em dashes, three dots become an ellipsis, and the invisible clutter Word tucks into documents (Mso styles, stray spans, XML declarations) is stripped away — while real formatting (paragraphs, emphasis, headings, scene breaks) is kept.

## Troubleshooting

### What can go wrong

**My chapters arrived as one long section.** The importer splits on heading styles. If your chapters were typed as big bold text rather than Heading 1, they read as one flow. Fix the headings in Word and re-import, or place the cursor where each chapter begins and choose **Split at cursor** from the section's `…` menu (see [Delete, split & merge chapters](/help/move-split-merge)).

**Some formatting vanished.** Beuk keeps semantic formatting — emphasis, strong, headings, quotes — and deliberately drops decorative formatting (coloured text, font changes mid-chapter). Typesetting replaces decoration; that's the point of the studio.

**The file won't import at all.** Check it's really a `.docx` (not the older `.doc`) — in Word, use Save As → Word Document (.docx). Very large files with many embedded images can also be slow; give it a minute before assuming the worst.
