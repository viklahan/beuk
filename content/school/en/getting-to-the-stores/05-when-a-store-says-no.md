---
title: When a store says no
blurb: Rejections are written by machines, for machines. The error decoder translates them — and most decode to something small and fixable.
guide: epub-error-decoder
---
Sometimes the book comes back. The rejection email quotes something like "RSC-005: Error while parsing file" and offers no sympathy at all. That message was written by a machine, for a machine; Beuk's EPUB error decoder, in Help, translates it into what happened and what to do.

## Steps
1. Find the real error first. "Your EPUB failed validation" is a headline, not a finding: the specific errors sit in the detail, sometimes one screen further down. Decode the first real error — the rest are often echoes of it.
   say: Find the real error first. Your EPUB failed validation is a headline, not a finding. The specific errors sit in the detail, sometimes one screen further down. Decode the first real error. The rest are often echoes of it.
   do: click "Export"; wait 1; show "Structural Validation"
2. The classics decode quickly. RSC-005 means a file inside isn't well-formed XML — an unclosed tag, a raw ampersand — and names the file and line, which tells you the chapter. RSC-007: a page links to a file that isn't in the package. RSC-008: a file is present but undeclared. A `mimetype` complaint means the EPUB was re-zipped by hand, which breaks the oldest EPUB rule there is.
   say: The classics decode quickly. R S C five means a file inside isn't well formed, and names the file and line, which tells you the chapter. Seven, a page links to a file that isn't in the package. Eight, a file is present but undeclared. And a mimetype complaint means the file was re-zipped by hand.
   do: show "Structural Validation"
3. Most of these cannot happen in a package Beuk built — they appear when a file was made elsewhere, edited by hand, or re-zipped by another tool. So the fix is usually not surgery: re-import the hand-edited chapter and let the sanitizer clean it, or simply export again and upload the fresh file.
   say: Most of these cannot happen in a package Beuk built. They appear when a file was made elsewhere, edited by hand, or re-zipped by another tool. So the fix is usually not surgery. Re-import the hand edited chapter, or simply export again and upload the fresh file.
   do: show "Platform Presets"
4. Stores also add rules of their own on top of the standard. Kindle wants marketing-quality covers, recommending 2560 by 1600 pixels. Apple has historically refused single pictures beyond roughly four million pixels, whatever the file size — keep individual images near 2048 pixels on the long side, ample for any e-reader screen.
   say: Stores also add rules of their own on top of the standard. Kindle wants marketing quality covers, recommending twenty five sixty by sixteen hundred pixels. Apple has refused single pictures beyond roughly four million pixels. Keep images near two thousand pixels on the long side.
   do: show "Platform Presets"
5. One more case: the validator passed your file and a store still said no. Send us the store's full message — that gap is exactly what we want to know about.
   say: One more case. The validator passed your file, and a store still said no. Send us the store's full message. That gap is exactly what we want to know about.
   do: show "Structural Validation"

## Takeaway
A rejection is a translation problem, not a verdict on the book. Decode the first real error, fix the small thing it names, and upload again.
