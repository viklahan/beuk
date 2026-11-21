---
slug: import-a-manuscript
title: Import a manuscript
blurb: Bring a book in from Word, OpenDocument, a web page, Markdown, plain text, RTF, PDF or EPUB — and see what Beuk tidies on the way in.
group: write
audience: [new]
updated: 2026-11-20
readMinutes: 4
related: [typeset-a-chapter, add-a-cover]
---

What you're doing: bringing a finished (or nearly finished) book into Beuk so it can be typeset. Beuk accepts Word documents (`.docx`), Markdown (`.md`), plain text (`.txt`), Rich Text (`.rtf`, which Scrivener, TextEdit and LibreOffice also write), OpenDocument (`.odt`, which LibreOffice and Google Docs write), a web page (`.html`, on its own or zipped with its pictures, as Google Docs downloads it), PDF (`.pdf`), and EPUB (`.epub`), so a book you only have as an ebook can come back in too (an EPUB under DRM cannot be read). An EPUB that declares a cover brings it along as the book's cover.

New to the studio? [Show the quick tour](/studio#tour): four short steps that point out Import, the page and its preview, Typography Studio, and Export. You can skip it at any step. In the studio it is also under the sample story, as **Show the quick tour**.

## Steps

1. Open the studio and choose **Import Document**.
2. Pick your file. A `.docx` from Word or Google Docs works best if you have one — headings, italics, and blockquotes survive the trip. A zip holding one manuscript works too.
3. Beuk reads the file and lays the book out in its three tiers: **Front Matter** (title page, copyright, dedication…), **Body** (prologue, chapters, epilogue), and **Back Matter** (acknowledgments, About the Author, Also By). The import report then opens on a summary, **Your book is in.**, with how many words Beuk read, the chapters and pages it found, and what it did. **Open my book** takes you to the book; **Every change, one by one** lists each change the import made, with **Undo this** beside those that can be undone on their own.
4. Walk the section list on the left. Anything the importer guessed wrong — a chapter it read as front matter, say — can be moved; nothing is locked.
5. Fill in the book's details (title, subtitle, author, ISBN if you have one) in Project Settings. You can do this later, but exports carry them. Beuk starts you off from the document: a title page in the manuscript (the title, a subtitle, a "by …" line) becomes the book's title, subtitle and author, lifted out of the text; with nothing like a title page, the cleaned file name is used. The import report says where each detail came from.
6. An import replaces the book on the desk. If the desk already holds a book, Beuk first says what will be cleared and that History keeps a copy; **Keep** leaves the book exactly as it was. The typography you chose stays. A book on your shelf is never overwritten: the import becomes a new book of its own.

## Explanation

### What Beuk tidies on the way in

The importer has a smart sanitizer. Straight quotes become proper curly quotes, double hyphens become em dashes, three dots become an ellipsis, and the invisible clutter Word tucks into documents (Mso styles, stray spans, XML declarations) is stripped away — while real formatting (paragraphs, emphasis, headings, scene breaks) is kept.

## Troubleshooting

### What can go wrong

**My chapters arrived as one long section.** The importer splits on heading styles. If your chapters were typed as big bold text rather than Heading 1, they read as one flow. Fix the headings in Word and re-import, or place the cursor where each chapter begins and choose **Split at cursor** from the section's `…` menu (see [Delete, split & merge chapters](/help/move-split-merge)).

**Some formatting vanished.** Beuk keeps semantic formatting — emphasis, strong, headings, quotes — and deliberately drops decorative formatting (coloured text, font changes mid-chapter). Typesetting replaces decoration; that's the point of the studio.

**The file won't import at all.** Check it's really a `.docx` (not the older `.doc`) — in Word, use Save As → Word Document (.docx). A Word file or PDF locked with a password asks for its password; a Word file with an older kind of lock says so. A scanned PDF has no text to read, so Beuk refuses it rather than guess. Very large files with many embedded images can also be slow; give it a minute before assuming the worst.
