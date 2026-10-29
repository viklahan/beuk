---
slug: platform-presets
title: Export for a store (presets)
blurb: Eleven presets, one manuscript: Kindle, Apple Books, Kobo, Google Play, libraries, aggregators and more — and what actually differs.
group: ship
audience: [shipping]
updated: 2026-10-28
readMinutes: 3
related: [check-your-book, epub-error-decoder]
sourced-from: client/index.html PLATFORM_PRESETS (names, sub-lines, file-name suffixes and each preset's detail text) and the comment above it (accessibility metadata is in every package; no identifier is invented)
---

What you're doing: producing the edition of your EPUB that a particular store most likes to receive. The book inside is the same; the packaging details differ.

## Steps

1. Open the **Export** dialog. Under **EPUB 3.2 — Platform Presets**, choose where the book is going: **Generic EPUB**, **Amazon KDP**, **Apple Books**, **Kobo**, **Nook**, **Draft2Digital**, **OverDrive**, **Smashwords**, **Tolino**, **Scribd** or **Google Play**.
2. Read the preset's detail panel — it says exactly what changes for that store, in plain words.
3. Download. The filename carries the preset (`your-book-kdp.epub`, `your-book-apple-books.epub`, `your-book-google-play.epub`…) so a folder of exports never confuses you. Generic EPUB has no suffix.
4. Run the [validator](/help/check-your-book) on the preset you picked — it checks the package you actually ship, not a generic one.

## Explanation

### What actually differs

- **Generic EPUB** is the original Beuk package: standard EPUB 3.2 with nav and NCX, nothing store-specific. Right for direct sales, libraries and sideloading.
- **Amazon KDP, Nook and Smashwords** add a legacy OPF *guide* (cover / contents / start-of-text) that older reading devices navigate from instead of the EPUB 3 nav document.
- **Apple Books** adds `META-INF/com.apple.ibooks.display-options.xml` (reflowable, specified fonts on) — the file Apple Books actually reads.
- **Draft2Digital** carries both: the OPF guide and Apple's display options, for an aggregator feeding many downstream stores.
- **Kobo, OverDrive, Tolino, Scribd and Google Play** ship the standard package unchanged — each of them ingests a standard EPUB as it stands and asks for no store-specific files.
- **Accessibility metadata is not a preset feature:** every Beuk package carries it, stamped from the book itself, whichever preset you choose. Kobo, OverDrive's library catalogues, the Tolino storefronts and Google Play surface it.
- **Identifiers stay honest:** if your book has an ISBN in Project Settings, every preset uses it. If it doesn't, presets keep the book's own identifier — Beuk never invents an ASIN or a store ID. KDP, Draft2Digital and Scribd assign their own on ingest. Smashwords' Premium Catalog distribution expects an ISBN.

## Troubleshooting

### What can go wrong

**I uploaded the KDP file to Apple.** Nothing breaks dramatically — but you'd be carrying another store's packaging. The filename suffix exists precisely to prevent this; trust it.

**My store isn't in the list.** Use **Generic EPUB** — the standard package with nothing store-specific added — run the validator on it, and check the store's own upload guidelines for anything extra it asks for.

**The store still rejected my file.** Copy the exact message into the [error decoder](/help/epub-error-decoder). Most rejections decode to something small and fixable.
