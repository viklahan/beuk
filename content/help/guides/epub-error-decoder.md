---
slug: epub-error-decoder
title: The EPUB error decoder
blurb: A store rejected your file with a message written by a machine. Here's what it means, and the fix.
group: ship
audience: [shipping, hand-edit]
updated: 2026-10-25
readMinutes: 5
related: [check-your-book, exports-and-archive]
---

What you're doing: translating. Stores reject files with messages written by machines, for machines. Find yours below for what it means in human terms and how to fix it. Most of these cannot happen in a package Beuk built — they appear when a file was made elsewhere, edited by hand, or re-zipped by another tool.

## Explanation

### The mimetype complaints

> says: The mimetype file is missing / is not the first file in the archive / must not be compressed / has an extra field

**What it means:** An EPUB's very first entry must be a tiny file named `mimetype`, stored with no compression. Re-zipping an EPUB with an ordinary zip tool breaks this instantly.

**The fix:** never re-zip an EPUB by hand. Export again from Beuk — the mimetype is written first and uncompressed by construction, and the [validator](/help/check-your-book) checks exactly this.

### RSC-005 — the file won't parse

> says: RSC-005: Error while parsing file: … (something about elements, entities, or closing tags)

**What it means:** One of the XHTML files inside isn't well-formed XML — an unclosed tag, a raw `&` that should be `&amp;`, a `<br>` that isn't `<br />`. EPUB is strict where HTML is forgiving.

**The fix:** if the chapter was hand-edited or pasted from the web, re-import it and let Beuk's sanitizer clean it. The named file and line in the message tell you which chapter.

### RSC-007 — a referenced file isn't there

> says: RSC-007: Referenced resource could not be found in the EPUB

**What it means:** A page, image, or stylesheet links to a file that isn't in the package — usually an image that was linked from a chapter but never embedded, or a file renamed after the fact.

**The fix:** open the book in the [Package Inspector](/help/exports-and-archive) and compare what the chapter references with what the package holds. In Beuk, insert images through the image library rather than pasting links, and they are always embedded.

### RSC-008 — present but undeclared

> says: RSC-008: Referenced resource is not declared in the OPF manifest

**What it means:** The file exists in the package, but the manifest — the package's table of contents for files — doesn't list it. Readers are entitled to ignore undeclared files.

**The fix:** re-export. Beuk builds the manifest from the same file list it ships, so the two can't disagree.

### The store can't find the package file

> says: container.xml … rootfile … OPF file could not be found / is missing

**What it means:** The signpost at the front of every EPUB (`META-INF/container.xml`) points to a package file (`.opf`) that isn't where it says. Typical of hand-assembled packages.

**The fix:** re-export from Beuk; the container and the package file are generated together.

### KDP: cover too small

> says: Your cover image is smaller than the recommended size / quality check failed on the cover

**What it means:** Not an EPUB error at all — a catalogue rule. Kindle wants marketing-quality covers, recommending 2560 × 1600 px.

**The fix:** upload the largest cover you have in [Project Settings](/help/add-a-cover) and re-export with the [KDP preset](/help/platform-presets).

### Apple Books: transport and image complaints

> says: ERROR ITMS-…: the book asset failed validation / image … exceeds the maximum size

**What it means:** Apple's importer wraps its own checks around EPUBCheck's. Image complaints usually mean one picture is very large in pixel terms — Apple has historically refused single images beyond roughly four million pixels, whatever the file size.

**The fix:** export with the [Apple Books preset](/help/platform-presets) (it adds Apple's own display-options file and accessibility metadata), and keep individual images near 2048 px on the long side — ample for any e-reader screen.

### The NCX complaints

> says: toc.ncx … playOrder values must be in ascending order / NCX file does not exist

**What it means:** The NCX is the old EPUB 2 navigation file older Kindles still read. If its entries are out of order — or it's missing entirely — legacy devices lose their table of contents.

**The fix:** re-export; Beuk always generates the NCX alongside the EPUB 3 navigation, in reading order.

### Duplicate files, differently-cased

> says: Duplicate entry in the ZIP / two resources with the same identifier

**What it means:** The package holds `Chapter1.xhtml` and `chapter1.xhtml`, or a manifest identifier used twice. Some systems treat those as the same name and collide.

**The fix:** the validator's duplicate-identifier check catches the manifest version; for filenames, re-export rather than hand-renaming files inside a package.

### The catch-all rejection

> says: Your EPUB failed validation (EPUBCheck reported N errors)

**What it means:** The store ran the official EPUBCheck suite and something in it objected — the specific errors are always in the detail, sometimes one screen further down than the headline.

**The fix:** find the detail and decode the first real error from it (the rest are often echoes). If the file came from Beuk and our [validator](/help/check-your-book) passed it, send us the store's full message — that gap is exactly what we want to know about. The full EPUBCheck suite itself runs on Beuk's servers in the SaaS phase.
