---
slug: add-a-cover
title: Add a cover
blurb: Give your book its face: cover images, and how they ride along in the EPUB.
group: write
audience: [new, shipping]
updated: 2026-10-26
readMinutes: 2
related: [platform-presets, check-your-book]
---

What you're doing: giving the book its face. A cover in Beuk is a real part of the EPUB — declared properly, shown first, and recognised by every store's catalogue.

## Steps

1. Open **Project Settings** and find the Cover Image block.
2. Upload a `JPG` or `PNG`. For store catalogues, bigger is better: Kindle recommends 2560 × 1600 px. A small image uploads fine but may be refused by a store later.
3. No artwork yet? The **Cover Maker** builds a cover from a photo and type, and starts from your book: the title, subtitle, author and series are filled in, and the photo search starts from the title. A cover made earlier follows the book's new title; anything you typed in the maker yourself stays as you wrote it.
3. The cover appears at the head of Front Matter. Select it there to see it on the device canvas.
4. Export as usual. The EPUB now carries the image, a cover page first in the reading order, and a *cover landmark* in the navigation — the thing screen readers and store ingesters look for.
5. Changed your mind? Remove in Project Settings and the package returns to exactly its coverless self — no residue.

## Troubleshooting

### What can go wrong

**The store says my cover is too small.** That's the store's catalogue rule, not the EPUB's fault. Upload the largest version you have; for print-adjacent sizes, 2560 px on the long side keeps everyone happy.

**The cover looks stretched.** Covers are shown at their own proportions — if the file itself is an odd shape, the preview shows that honestly. Crop in an image editor before uploading.

**No cover yet — can I export anyway?** Yes. Beuk exports a complete, valid book without one; the validator will note it as a friendly warning, never an error.
