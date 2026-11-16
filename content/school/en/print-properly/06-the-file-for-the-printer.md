---
title: The file for the printer
blurb: The print-ready PDF Beuk's server makes, PDF/X for the printers who want it, and the store check.
guide: print-interiors
---
The print view is for you. The file you upload to KDP or IngramSpark is a different one: the print-ready PDF that Beuk's server makes from your book.

## Steps
1. **Download print-ready PDF** starts it. Beuk's server sets the book at your trim, with bleed if you turned it on, and gives you the file when it is done. It needs an account and a connection.
   say: Download print-ready PDF. Beuk's server sets your book at the trim you chose, with bleed if you turned it on, and hands you the file to upload. You need to be signed in and online.
   do: show "Download print-ready PDF"
2. Some printers, IngramSpark among them, prefer **PDF/X-1a**. Beuk's server converts the interior and reads the result back; Beuk never calls a file PDF/X unless the converted file itself says so.
   say: Some printers, IngramSpark among them, prefer a version called P D F slash X. Beuk's server converts the interior for them, and checks that the converted file really is one.
   do: show "Download print-ready PDF"
3. **Store-ready?** checks the whole book against KDP's and IngramSpark's published print rules: trim, page count, margins, picture resolution, bleed, fonts and the cover wrap. Nothing shows as passed unless it was checked.
   say: Last, run the store check. It goes through K D P's and IngramSpark's own print rules, from the trim to the cover, and it only marks something as passed if it actually checked it.
   do: show "Store-ready?"

## Takeaway
Upload the print-ready PDF, never a PDF saved from the print view. The print view is the proof; the server's file is the book.
