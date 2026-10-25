---
slug: platform-presets
title: Export for a store (presets)
blurb: One click each for Kindle, Apple Books, Kobo, Nook, and Draft2Digital — and what actually differs.
group: ship
audience: [shipping]
updated: 2026-10-25
readMinutes: 2
related: [check-your-book, epub-error-decoder]
---

What you're doing: producing the edition of your EPUB that a particular store most likes to receive. The book inside is the same; the packaging details differ.

## Steps

1. Open the **Export** dialog and choose a preset: **Generic EPUB**, **Amazon KDP**, **Apple Books**, **Kobo**, **Nook**, or **Draft2Digital**.
2. Read the preset's detail panel — it says exactly what changes for that store, in plain words.
3. Download. The filename carries the preset (`your-book-kdp.epub`, `your-book-apple-books.epub`…) so a folder of exports never confuses you.
4. Run the [validator](/help/check-your-book) on the preset you picked — it checks the package you actually ship, not a generic one.

## Explanation

### What actually differs

- **KDP & Nook** add a legacy *guide* (cover / contents / start pointers) that older navigation relies on.
- **Apple Books** adds Apple's display-options file and rich accessibility metadata.
- **Kobo** adds accessibility metadata in the form Kobo's ingestion expects.
- **Draft2Digital** combines the lot, since it forwards your book to many stores at once.
- **Identifiers stay honest:** if your book has an ISBN, every preset uses it. If it doesn't, presets use the book's own identifier — Beuk never invents an ASIN or a store ID for you.

## Troubleshooting

### What can go wrong

**I uploaded the KDP file to Apple.** Nothing breaks dramatically — but you'd be carrying another store's packaging. The filename suffix exists precisely to prevent this; trust it.

**The store still rejected my file.** Copy the exact message into the [error decoder](/help/epub-error-decoder). Most rejections decode to something small and fixable.
