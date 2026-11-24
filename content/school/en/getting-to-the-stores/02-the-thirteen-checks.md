---
title: The thirteen checks
blurb: Validate This Book reads your export with a store's scepticism, in your browser, and explains every line in plain language.
guide: check-your-book
---
Between you and an upload stands a machine that reads your file with no patience at all. Beuk keeps one of its own: thirteen structural checks that give your export the same once-over a store's ingestion machine will — on your desk, before a store ever sees it.

## Steps
1. Open **Export** and pick the preset you will actually ship. The checks run over that preset's files — the package you ship, not a generic one.
   say: Open Export and pick the preset you will actually ship. The checks run over that preset's files. The package you ship, not some generic version of your book.
   do: click "Export"; wait 1; click "Amazon KDP"; wait 1
2. Choose **Validate This Book**. It runs in your browser, over the exact file set the export zips; nothing is uploaded anywhere.
   say: Choose Validate This Book. It runs in your browser, over the exact file set the export zips. Nothing is uploaded anywhere.
   do: click "Validate This Book"; wait 2
3. Read the results top-down: errors first, then warnings, then the passes. The checks cover the archive itself — the `mimetype` entry first and uncompressed, the container pointing at a package file that is there — the markup, with every XML and XHTML file well-formed, and the wiring: manifest and files agreeing both ways, the spine resolving end to end, the navigation document with its landmarks, the legacy NCX with targets that resolve, and every internal link and anchor, footnote back-links included.
   say: Read the results top down. Errors first, then warnings, then the passes. The checks cover the archive itself, the markup, with every file well formed, and the wiring: manifest and files agreeing both ways, the reading order resolving end to end, the navigation, and every internal link and anchor, footnote back links included.
   do: show "Structural Validation"
4. The last checks are the book's papers: every image carries alt text, the required metadata is present — title, author, identifier, language — and a declared cover is properly marked as the cover. A line that fails carries its BEUK- code, linked to its entry in the error dictionary, and says what to do about it.
   say: The last checks are the book's papers. Every image carries alt text, the required metadata is present, and a declared cover is properly marked as the cover. A line that fails carries its BEUK code, linked to the error dictionary, and says what to do about it.
   do: show "Structural Validation"
5. Warnings are advice, not failure. A missing cover, a missing description, or the book's own identifier standing in for an ISBN — each is noted with the reason, and you may ship anyway. Stores accept all three; the notes exist so the choices are yours, made knowingly.
   say: Warnings are advice, not failure. A missing cover, a missing description, or no I S B N yet. Each is noted with the reason, and you may ship anyway. The notes exist so the choices are yours, made knowingly.
   do: show "Structural Validation"

## Takeaway
Nothing shows as passed unless it was actually checked — and a problem that surfaces on your desk is a problem that never becomes a rejection email.
