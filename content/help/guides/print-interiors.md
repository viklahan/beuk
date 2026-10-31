---
slug: print-interiors
title: Print interiors & trim sizes
blurb: Paperback pages from the same manuscript — twenty-four trim sizes, gutters, preflight, and honest notes about PDF/X.
group: ship
audience: [shipping]
updated: 2026-10-28
readMinutes: 3
related: [exports-and-archive]
sourced-from: client/index.html TRIM_SIZES and TRIM_GROUPS (the twenty-four trims, their groups and notes, KDP's page range per trim), printMarginsAuto (the gutter steps), the print export strings (exp.printH, exp.rectoTitle, exp.downloadPrintHtml, exp.largePrintTitle, exp.preflightBtn), preflight.intro, covermk.wrap.pdfNote and store.running; README "Jobs (M5)" for the server PDF/X job
---

What you're doing: turning the same manuscript into a paginated paperback interior — real pages, with margins that respect the binding.

## Steps

1. Open the **Export** dialog and find **Print Interior — Print Preview and Print-Ready PDF**.
2. Choose a trim size. There are twenty-four, grouped the way the printers group them: **Pocket & mass-market** (4.25 × 7 to 5.06 × 7.81 in), **Trade paperback** (5.25 × 8 to 6.69 × 9.61 in, including 6 × 9 and A5), **Large & illustrated** (7 × 10 to US Letter and A4) and **Square & landscape** (8 × 8 to 11 × 8.5 in). Each says what it usually suits, and the ones only IngramSpark prints say so.
3. Decide on chapter openings: **Chapters open on a recto page** starts every chapter on a right-hand page, the trade hardback convention. Off, chapters simply start on the next page.
4. Open the **Print View** and check a few pages. Then **Print → Save as PDF** if you want to print it yourself. This is a preview: the file to send to a store is the print-ready PDF the server makes (**Download print-ready PDF**). (If printing is unavailable where you are, **Download Print HTML** gives you the identical paginated document as a file that prints from any browser.)
5. Before you upload, **Run Print Preflight**: margins and gutter against the printer minimums for this page count and trim, every picture's resolution at the size it will print, the page count against KDP's limits for the trim, and the fonts in use.

## Explanation

### What Beuk handles for you

- Exact page dimensions for the chosen trim, set in the paged-media stylesheet. The same trim list drives the Print Interior View and the cover maker's wrap, so a trim can never mean one size inside and another on the cover.
- **Mirrored gutter margins** that grow with page count, following KDP and IngramSpark guidance — 0.625 in up to 150 pages, stepping up to 1.125 in past 700 pages — so text never disappears into the binding. Switch Margins to **Custom** to set your own.
- A running head and page numbers, kept off the first page, as books do; their content and placement are yours to choose.
- Chapters always begin on a fresh page.
- A **Large Print edition** setting re-typesets the interior to large-print conventions (18pt type minimum, generous leading, ragged-right text).

## Troubleshooting

### What can go wrong — and one honest limit

**The honest limit:** what the browser saves is a *print-ready interior PDF*, not PDF/X. True **PDF/X-1a** conversion — the flavour some printers, IngramSpark among them, prefer — runs on Beuk's server: sign in, and the **Store-ready?** check (or a PDF/X job on a print export in your archive) converts the interior and reads the result back. Beuk never labels a file PDF/X unless the converted file itself declares it.

**Blank pages appeared.** With recto chapter starts on, a chapter that would open on a left page gets a deliberate blank before it. That's correct book behaviour — printers expect it.

**The PDF has browser headers/footers.** In the print dialog, turn off "Headers and footers" — those are your browser's, not Beuk's. Beuk's own running head is the one inside the page.
