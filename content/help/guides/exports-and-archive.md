---
slug: exports-and-archive
title: Exports & your archive
blurb: EPUB, Markdown, HTML, and Word files — and where your copies are kept.
group: keep
audience: [hand-edit]
updated: 2026-10-25
readMinutes: 2
related: [check-your-book, print-interiors]
---

What you're doing: taking finished books out of Beuk in the shape each destination wants — and knowing where your copies live.

## Explanation

### The export shelf

- **EPUB** — the book itself, per [store preset](/help/platform-presets). Byte-0 mimetype stored uncompressed, EPUB 3 navigation plus an NCX fallback, exactly per the standard. The Beuk server builds it from the book on your desk, so you need to be signed in and online to download it.
- **Markdown (.md)** — a clean archive of the manuscript with YAML front matter (title, author, ISBN, language, rights…). Made for Obsidian, Scrivener, Ulysses, or a Git repository — the copy that outlives every app, including this one. Download it or copy it straight from the dialog.
- **Standalone HTML** — the whole typeset book as one self-contained page, styles embedded. Good for sharing a reading copy or archiving exactly what readers saw.
- **Word (.docx)** — for editors and collaborators who live in Word: real heading styles, body text, scene breaks, and your endnotes gathered at the end.
- **Print HTML** — the paginated interior from [Print interiors](/help/print-interiors), as a file.

### Look inside before you ship

The **Archive Package Inspector** opens your EPUB and shows its actual contents — the file tree, each file's size, and its text, highlighted — the package exactly as a store will receive it. If the [validator](/help/check-your-book) ever puzzles you, the answer is usually visible here.

### Your cloud archive

Signed in, every export you save is kept in your personal archive on Beuk's servers: the format, the preset, the filename, and a SHA-256 fingerprint of the bytes, so a re-download can be verified as the very same file. The archive is yours alone — another account can't see, download, or delete from it, and deleting a manuscript never deletes its exports. The archive is the permanent copy; the manuscript is the working document.

## Troubleshooting

### What can go wrong

**A download won't start in this window.** Some embedded previews block file downloads. Open Beuk in a full browser tab and export again — the file itself is generated identically either way.

**My export is bigger than 50 MB.** The archive caps a single export at 50 MB; image-heavy books can exceed it. Reduce image dimensions (2048 px on the long side is plenty for e-readers) and export again.
