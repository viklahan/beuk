---
title: Presets, and what actually differs
blurb: Eleven store presets build from one manuscript. Three of them change the package — here is exactly what changes, and what never does.
guide: platform-presets
---
Maiden Voyage taught you to pick a preset and ship. This lesson is about what is in the box: the book inside is the same whichever store you choose; the packaging details differ, and they differ in exactly three ways.

## Steps
1. Open **Export**. Under **EPUB 3.2 — Platform Presets** sit the eleven: **Generic EPUB**, **Amazon KDP**, **Apple Books**, **Kobo**, **Nook**, **Draft2Digital**, **OverDrive**, **Smashwords**, **Tolino**, **Scribd** and **Google Play**. Each preset's detail panel says what changes for that store, in plain words.
   say: Open Export. Under the platform presets sit the eleven: Generic EPUB, Amazon, Apple Books, Kobo, Nook, Draft2Digital, OverDrive, Smashwords, Tolino, Scribd and Google Play. Each preset's panel says what changes for that store, in plain words.
   do: click "Export"; wait 1; show "Platform Presets"
2. Three presets add something. **Amazon KDP**, **Nook** and **Smashwords** add a legacy OPF *guide* — cover, contents, start of text — that older reading devices navigate from instead of the EPUB 3 nav document. **Apple Books** adds Apple's own display-options file, the one Apple Books actually reads. **Draft2Digital**, an aggregator feeding many stores downstream, carries both.
   say: Three presets add something. Amazon, Nook and Smashwords add a legacy guide that older reading devices navigate from. Apple Books adds Apple's own display options file. And Draft2Digital, an aggregator feeding many stores, carries both.
   do: click "Amazon KDP"; wait 1; click "Apple Books"; wait 1
3. The rest — **Kobo**, **OverDrive**, **Tolino**, **Scribd** and **Google Play** — ship the standard package unchanged: each ingests a standard EPUB as it stands and asks for no store-specific files. **Generic EPUB** is the original Beuk package, right for direct sales, libraries and sideloading.
   say: The rest, Kobo, OverDrive, Tolino, Scribd and Google Play, ship the standard package unchanged. Each of them takes a standard EPUB as it stands. Generic EPUB is the original package, right for direct sales, libraries and sideloading.
   do: click "Kobo"; wait 1; click "Generic EPUB"; wait 1
4. Two things no preset changes. Accessibility metadata rides in every package, stamped from the book itself, whichever store you choose. And identifiers stay honest: an ISBN from **Project Settings** is used by every preset; without one, the book keeps its own identifier — Beuk never invents a store ID.
   say: Two things no preset changes. Accessibility metadata rides in every package, stamped from the book itself. And identifiers stay honest. An ISBN from Project Settings is used everywhere. Without one, the book keeps its own identifier. Beuk never invents a store I D.
   do: show "Platform Presets"
5. The filename carries the preset — `your-book-kdp.epub`, `your-book-apple-books.epub` — so a folder of exports never confuses you. Generic EPUB has no suffix. Trust the suffix: it exists so another store's packaging never reaches the wrong upload page.
   say: The filename carries the preset, so a folder of exports never confuses you. Generic has no suffix. Trust the suffix. It exists so another store's packaging never reaches the wrong upload page.
   do: show "Build & Download .epub"

## Takeaway
The preset is packaging, not the book. Pick the store, read its panel, and let the filename remember which edition is which.
