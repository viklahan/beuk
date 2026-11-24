---
title: Look inside the file
blurb: The Package Inspector opens your EPUB and shows the package exactly as a store will receive it — every file, its size, its text.
guide: exports-and-archive
---
An EPUB is a sealed box, and most writers ship it without ever looking inside. You don't have to. The Package Inspector opens the box and shows its actual contents — the package exactly as a store will receive it.

## Steps
1. Open **Export** and choose **Inspect Package**. The **Archive Package Inspector** shows the exact files the EPUB builder writes — same generator, same bytes.
   say: Open Export and choose Inspect Package. The inspector shows the exact files the EPUB builder writes. Same generator, same bytes.
   do: click "Export"; wait 1; click "Inspect Package"; wait 2
2. Read the file tree the way a store's machine does. The tiny `mimetype` entry leads the archive. `META-INF/container.xml` is the signpost pointing at the package file. Under `OEBPS` sit the package document, the navigation files, the stylesheet, a `Text` folder with one XHTML file per section, and an `Images` folder — each file with its size.
   say: Read the file tree the way a store's machine does. The tiny mimetype entry leads the archive. Container dot x m l is the signpost pointing at the package file. Then the package document, the navigation files, the stylesheet, a text folder with one file per section, and the images. Each file with its size.
   do: show "mimetype"
3. Select any file to read it, highlighted. The package document declares every file; the navigation document carries the contents a reader shows; a chapter is strict XHTML, which is why the validator insists on well-formed markup.
   say: Select any file to read it, highlighted. The package document declares every file. The navigation document carries the contents a reader shows. And a chapter is strict X H T M L, which is why the validator insists on well formed markup.
   do: show "Archive Package Inspector"
4. When a validator line puzzles you, the answer is usually visible here: compare what a chapter references with what the package actually holds, and the missing picture or misnamed file shows itself.
   say: When a validator line puzzles you, the answer is usually visible here. Compare what a chapter references with what the package actually holds, and the missing picture or misnamed file shows itself.
   do: show "Archive Package Inspector"

## Takeaway
What is validated is not an abstraction — it is this file tree, these bytes. Knowing your way around the box is what makes the next two lessons quick.
