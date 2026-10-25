---
slug: check-your-book
title: Check your book (the validator)
blurb: Thirteen plain-language checks over your export before a store ever sees it.
group: ship
audience: [shipping, hand-edit]
updated: 2026-10-25
readMinutes: 2
related: [epub-error-decoder, platform-presets, exports-and-archive]
sourced-from: steps 1–3, What it checks, Warnings — the pre-H1 client/help/check-your-book.html, verbatim; step 4 and the honest limit — client/index.html "Your Archive" section (Save this EPUB, Run EPUBCheck) and README.md "Jobs (M5)"; tech lines — client/index.html PLATFORM_PRESETS, validateEpubPackage, README.md "API (M1–M5)"; panes — captured 2026-10-25 from the studio at commit bb992b4 and the bundled EPUBCheck 5.2.1 (see each pane's source line)
---

What you're doing: giving your export a once-over with the same scepticism a store's ingestion machine will use — before it ever leaves your desk.

## Steps

1. Open the **Export** dialog and pick the preset you'll actually ship.
   tech: Presets change the package itself: KDP and Nook add a legacy guide to the OPF; Apple Books adds `META-INF/com.apple.ibooks.display-options.xml`. The validator checks the files of the preset you picked.
   pane: package
   highlight: the-lantern-coast-kdp.epub | META-INF/container.xml
2. Choose **Validate This Book**.
   tech: It runs in your browser over the exact file set the export zips (`validateEpubPackage`); nothing is uploaded.
   pane: validator
   highlight: Checked the | passed ·
3. Read the results top-down: errors first, then warnings, then the passes. Every line is explained in plain language — what was checked, and if something failed, what to do about it.
   tech: Each line that is not a pass carries its BEUK- code, linked to its entry in the error dictionary.
   pane: validator
   highlight: ✗ Malformed markup | ! No ISBN
4. For the full, official check, sign in, save the EPUB to **Your Archive** in the Export dialog, and choose **Run EPUBCheck** beside it.
   tech: `POST /api/jobs/epubcheck {exportId}` → `201 {job}`; the studio then reads `GET /api/jobs/:id` until the job is done or failed. Each message in the result carries a `beuk` code.
   pane: job
   highlight: "passed": false | "beuk"

## Explanation

### What it checks

- The `mimetype` entry is first in the package and stored uncompressed — the oldest EPUB rule there is. {code: BEUK-P101; pane: package; highlight: mimetype}
- `container.xml` points at a package file that is actually there. {code: BEUK-P102; pane: package; highlight: META-INF/container.xml | OEBPS/package.opf}
- Every XML and XHTML file is well-formed. {code: BEUK-X201; pane: validator; highlight: Malformed markup | not well-formed XML | OEBPS/Text/chapter_01.xhtml.}
- The manifest and the files agree both ways: nothing declared is missing, nothing present is undeclared, no duplicate identifiers. {code: BEUK-R302 BEUK-D402; pane: validator; highlight: Manifest and package contents agree}
- The reading order (spine) resolves, end to end. {code: BEUK-R303; pane: validator; highlight: Spine reading order resolves}
- The navigation document carries its landmarks — contents, body matter, and cover when a cover ships — and the legacy NCX is present with targets that resolve. {code: BEUK-N404; pane: package; highlight: OEBPS/nav.xhtml | OEBPS/toc.ncx}
- Every internal link and anchor resolves, footnote back-links included. {code: BEUK-R304; pane: validator; highlight: Every internal link and anchor resolves}
- Every image carries alt text. {code: BEUK-A601; pane: validator; highlight: Every image carries alt text}
- Required metadata is present: title, author, identifier, language — and a declared cover is properly marked as the cover. {code: BEUK-M501 BEUK-M504; pane: validator; highlight: Required metadata is present | Cover image declared as the cover}

### Warnings are advice, not failure

A missing cover, a missing description, or using the book's own identifier because there's no ISBN yet — the validator notes these as warnings, with the reason, and lets you ship anyway. Stores accept all three; the notes exist so the choices are yours, made knowingly.

## Troubleshooting

### What can go wrong — and one honest limit

**The honest limit:** this is *structural* validation, and Beuk doesn't claim EPUBCheck's authority for a lighter set of checks. The full, official **EPUBCheck** runs on Beuk's server: signed in, save the EPUB to **Your Archive** and choose **Run EPUBCheck**. It runs only where the server has EPUBCheck installed — where it hasn't, the check says so and gives no result rather than a pass. A book with findings comes back as a finished check that says it did not pass: the check worked; the book needs a fix.

**It passed here but a store complained.** Stores add rules of their own on top of the standard (cover pixel sizes, file-size caps). Copy the store's exact words into the [error decoder](/help/epub-error-decoder).

## Panes

### validator | What you see | Export → Validate This Book
source: The studio's real results for the sample book The Lantern Coast, Amazon KDP preset, after one closing </p> was removed from chapter_01.xhtml on purpose to show a failing line — captured 2026-10-25 from validateEpubPackage at commit bb992b4. Icons are shown as ✗ ! ✓; each BEUK- code is the one the studio now shows beside that line.
```
1 error to fix before this book ships.
Checked the Amazon KDP package (the-lantern-coast-kdp.epub):
13 passed · 1 warning · 1 error.

✗ Malformed markup.  BEUK-X201
    These files are not well-formed XML, so strict readers and
    store ingesters will fail on them:
    OEBPS/Text/chapter_01.xhtml.
! No ISBN — the book's UUID is the identifier.  BEUK-M502
    Without an ISBN in Project Settings the package identifies
    the book by its own UUID. That is valid EPUB and fine for
    direct sales; most store programmes want an ISBN, or
    assign their own ID on ingest. Nothing here is invented —
    the identifier is the book's own.
✓ Mimetype leads the archive, stored uncompressed.
✓ Container points at a package document that is present.
✓ Manifest and package contents agree.
✓ Spine reading order resolves.
✓ Navigation document with toc and landmarks.
✓ NCX present and its targets resolve.
✓ Every internal link and anchor resolves.
✓ Manifest properties match the content.
✓ Every linked document is in the reading order.
✓ Every image carries alt text.
✓ Required metadata is present.
✓ Description present.
✓ Cover image declared as the cover.
```

### package | Inside the file | Package Inspector
source: The real file list of the sample book's Amazon KDP export (unmodified), from the studio's epubFiles('kdp') at commit bb992b4, 2026-10-25 — sizes before zipping; the Text and Images folders are summarised.
```
the-lantern-coast-kdp.epub  (77 files)
mimetype                       20 B  first entry, stored
META-INF/container.xml         251 B
OEBPS/Styles/blitz.css         8.6 KB
OEBPS/package.opf              11.9 KB
OEBPS/nav.xhtml                2.3 KB
OEBPS/toc.ncx                  4.1 KB
OEBPS/Text/                    42 XHTML files
  cover.xhtml                  420 B
  toc.xhtml                    2.8 KB
  prologue.xhtml               6.0 KB
  chapter_01.xhtml             11.9 KB
  chapter_02.xhtml             10.4 KB
  … 37 more
OEBPS/Images/                  29 JPEG files, 5522.6 KB
  cover.jpg                    253.2 KB
```

### job | EPUBCheck job | Archive → Run EPUBCheck
source: A real EPUBCheck 5.2.1 run (the bundled jar) over the same deliberately broken copy, parsed by the server's parseEpubCheckReport — the job result the archive shows, reformatted, long messages shortened where marked […]. The unmodified sample export passed the same run with no messages at all.
```
GET /api/jobs/:id  →  job.result
{
  "tool": "epubcheck",
  "toolVersion": "5.2.1",
  "passed": false,
  "counts": { "fatal": 1, "errors": 3, "warnings": 0,
              "infos": 0, "usages": 0 },
  "messages": [
    { "code": "RSC-005", "severity": "ERROR",
      "message": "Error while parsing file: element \"div\"
        not allowed here; expected the element end-tag,
        text, element \"a\", \"abbr\", […]",
      "location": "OEBPS/Text/chapter_01.xhtml:6:432",
      "beuk": "BEUK-X201" },
    … two more RSC-005 errors (elements "h1" and "p")
    { "code": "RSC-016", "severity": "FATAL",
      "message": "Fatal Error while parsing file: The
        element type \"p\" must be terminated by the
        matching end-tag \"</p>\".",
      "location": "OEBPS/Text/chapter_01.xhtml:6:834",
      "beuk": "BEUK-X201" }
  ]
}
```
