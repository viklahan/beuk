---
slug: print-interiors
title: Print interiors & trim sizes
blurb: Paperback pages from the same manuscript — trim sizes, gutters, and honest notes about PDF/X.
group: ship
audience: [shipping]
updated: 2026-10-25
readMinutes: 2
related: [exports-and-archive]
---

What you're doing: turning the same manuscript into a paginated paperback interior — real pages, with margins that respect the binding.

## Steps

1. Open the **Export** dialog and find the **Print Interior** section.
2. Choose a trim size: **5 × 8**, **5.25 × 8**, **5.5 × 8.5**, **6 × 9**, **7 × 10**, or **8.5 × 11** inches. The margin readout updates to match — including the estimated page count.
3. Decide on chapter openings: the *recto* toggle starts every chapter on a right-hand page, the traditional book way. Off, chapters simply start on the next page.
4. Open the **Print View** and check a few pages. Then **Print → Save as PDF**. (If printing is unavailable where you are, **Download Print HTML** gives you the identical paginated document as a file that prints from any browser.)

## Explanation

### What Beuk handles for you

- Exact page dimensions for the chosen trim, set in the paged-media stylesheet.
- **Mirrored gutter margins** that grow with page count, following KDP and IngramSpark guidance — roughly 0.625 in for a slim book up to 1.125 in past 700 pages — so text never disappears into the binding.
- A running head (title · author) and page numbers, kept off the first page, as books do.
- Chapters always begin on a fresh page.

## Troubleshooting

### What can go wrong — and one honest limit

**The honest limit:** what you get is a *print-ready interior PDF*. True **PDF/X-1a** conversion — the flavour some printers insist on — happens on Beuk's servers in a later phase of the SaaS build. Beuk will never label a file PDF/X when it isn't; if your printer demands it today, they'll need the file converted elsewhere.

**Blank pages appeared.** With recto chapter starts on, a chapter that would open on a left page gets a deliberate blank before it. That's correct book behaviour — printers expect it.

**The PDF has browser headers/footers.** In the print dialog, turn off "Headers and footers" — those are your browser's, not Beuk's. Beuk's own running head is the one inside the page.
