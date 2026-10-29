---
title: Pass inspection before you sail
blurb: Check the book the way a store will, before a store ever sees it.
guide: check-your-book
---
A store's ingestion check reads your file with no patience at all. Beuk can read it the same way first, so a problem shows up on your desk, not in a rejection email.

## Steps
1. Open **Export** and pick the preset you'll actually ship. The checks look at that preset's files.
   say: Open Export, and pick the preset you will actually ship. The checks look at that preset's files, not some generic version of your book.
   do: click "Export"; wait 1; click "Amazon KDP"; wait 1
2. For a print book, **Store-ready?** runs one pass-or-fail report against KDP's and IngramSpark's published print rules.
   say: For a print book, Store ready runs one report against the published print rules of KDP and IngramSpark: trim, margins, bleed, fonts, picture resolution, and the cover's spine and barcode area.
   do: show "Store-ready?"
3. For the ebook, choose **Validate This Book**. Read the results from the top: errors first, then warnings, then passes.
   say: For the ebook, choose Validate This Book. Read the results from the top: errors first, then warnings, then the passes. Every line says what was checked, and what to do if it failed.
   do: click "Validate This Book"; wait 2
4. **Check Accessibility** looks at what readers using assistive technology need, such as alt text and reading order.
   say: Check Accessibility looks at what readers using assistive technology need, like descriptions for pictures and a sensible reading order.
   do: show "Check Accessibility"

## Takeaway
Nothing shows as passed unless it was actually checked. A blank line is not a pass.
