# Beuk world simulation — report

Generated 2026-10-28T01:20:53.606Z from branch `feat/sim-world` at `33ebb0e`, seed **20261027**. Every figure below is read from this run's own files in `tools/sim/out/`; every gap and failure cites the observation that shows it.

## Headline

- **112 checks: 111 pass, 1 fail.** 24 series/product gaps and 3 bug(s) recorded with evidence.
- World: 10 personas (8 writers, an import-lab writer and a load-test writer), 56 books (23 public-domain saga volumes), 9 series, 2,390,430 words and 1,799 pictures on the shelves (studio counts), 8 beta-reader links, 46 reader comments.
- World spec sha256 `c6774c7e68efd0be3118b5ce7be541593b655bdda44068e6b8abd35d23085d9b`; content digest of the seeded books `74c402a23fe336639e1f7adb4426f5bee460f29cede5f4e87bb900cfa708e5cf`.
- Determinism across 2 runs with this seed: world spec identical (c6774c7e68ef), content digest identical (74c402a23fe3).

## World

| Persona | Kind | Books | Series |
|---|---|---|---|
| sim01-dumas | saga | 9 | The d'Artagnan Romances (6); The Valois Romances (3) |
| sim02-baum | saga | 14 | The Oz Books (14) |
| sim03 | ramp | 6 | Luna's Beach Treasure Hunt (4) |
| sim04 | ramp | 5 | Salt Road (3) |
| sim05 | ramp | 6 | The Lantern Coast (4) |
| sim06 | ramp | 5 | The Travel Guide (3) |
| sim07 | ramp | 6 | Four Kitchens (4) |
| sim08 | ramp | 5 | The Book That Reads You (3) |
| sim09-importlab | lab | 0 | – |
| sim10-loadtest | load | 0 | – |

Books come only from existing content: the studio's sample, the Ramp gallery books (whole, or re-cut by chapter into 3–4 volumes), and public-domain sagas from gutenberg.org (sources: `10-ramp-gallery/sagas/sources.json`). The only words the simulation writes are marked: reader comments start with `[sim]`, typed edits with `SIMTYPED-`/`SIMDEVICE-`, Bible notes with `[sim]`.

## Checks

| Result | Check | What it asserts |
|---|---|---|
| pass | `world.deterministic-spec` | world.json is generated from the seed alone (its sha256 is recorded per run and compared across runs) |
| pass | `seed.all-books-on-shelf` | every world book is on its writer's shelf (56) |
| pass | `words.no-loss-seeded` | for every untouched book, each section on the shelf hashes the same as in the studio when it was saved |
| pass | `session.sim03.typed-landed` | sim03: the typed sentence is on the shelf |
| pass | `session.sim03.deleted-gone` | sim03: the deleted paragraph is no longer on the shelf |
| pass | `session.sim03.typed-counted` | sim03: typing N words raises the book's word total by N (studio count) |
| pass | `session.sim03.deleted-counted` | sim03: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty) |
| pass | `session.sim03.word-total` | sim03: reordering, the Bible, goals, exports and sharing leave the word total alone |
| pass | `session.sim03.order-saved` | sim03: the Outline move is in the shelf copy's section order |
| pass | `session.sim03.goals` | sim03: goals typed in the Goals panel are the book's goals |
| pass | `session.sim03.epub-valid` | sim03: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors) |
| pass | `session.sim03.submission-docx` | sim03: the submission manuscript downloads as a Word file |
| pass | `session.sim03.comments-jump` | sim03: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found) |
| pass | `session.sim03.comments-resolved` | sim03: comments resolved in the comments panel are resolved on the server |
| pass | `session.sim04.typed-landed` | sim04: the typed sentence is on the shelf |
| pass | `session.sim04.deleted-gone` | sim04: the deleted paragraph is no longer on the shelf |
| pass | `session.sim04.typed-counted` | sim04: typing N words raises the book's word total by N (studio count) |
| pass | `session.sim04.deleted-counted` | sim04: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty) |
| pass | `session.sim04.word-total` | sim04: reordering, the Bible, goals, exports and sharing leave the word total alone |
| pass | `session.sim04.order-saved` | sim04: the Outline move is in the shelf copy's section order |
| pass | `session.sim04.goals` | sim04: goals typed in the Goals panel are the book's goals |
| pass | `session.sim04.epub-valid` | sim04: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors) |
| pass | `session.sim04.submission-docx` | sim04: the submission manuscript downloads as a Word file |
| pass | `session.sim04.comments-jump` | sim04: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found) |
| pass | `session.sim04.comments-resolved` | sim04: comments resolved in the comments panel are resolved on the server |
| pass | `session.sim05.typed-landed` | sim05: the typed sentence is on the shelf |
| pass | `session.sim05.deleted-gone` | sim05: the deleted paragraph is no longer on the shelf |
| pass | `session.sim05.typed-counted` | sim05: typing N words raises the book's word total by N (studio count) |
| pass | `session.sim05.deleted-counted` | sim05: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty) |
| pass | `session.sim05.word-total` | sim05: reordering, the Bible, goals, exports and sharing leave the word total alone |
| pass | `session.sim05.order-saved` | sim05: the Outline move is in the shelf copy's section order |
| pass | `session.sim05.goals` | sim05: goals typed in the Goals panel are the book's goals |
| pass | `session.sim05.epub-valid` | sim05: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors) |
| pass | `session.sim05.submission-docx` | sim05: the submission manuscript downloads as a Word file |
| pass | `session.sim05.comments-jump` | sim05: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found) |
| pass | `session.sim05.comments-resolved` | sim05: comments resolved in the comments panel are resolved on the server |
| pass | `session.sim06.typed-landed` | sim06: the typed sentence is on the shelf |
| pass | `session.sim06.deleted-gone` | sim06: the deleted paragraph is no longer on the shelf |
| pass | `session.sim06.typed-counted` | sim06: typing N words raises the book's word total by N (studio count) |
| pass | `session.sim06.deleted-counted` | sim06: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty) |
| pass | `session.sim06.word-total` | sim06: reordering, the Bible, goals, exports and sharing leave the word total alone |
| pass | `session.sim06.order-saved` | sim06: the Outline move is in the shelf copy's section order |
| pass | `session.sim06.goals` | sim06: goals typed in the Goals panel are the book's goals |
| pass | `session.sim06.epub-valid` | sim06: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors) |
| pass | `session.sim06.submission-docx` | sim06: the submission manuscript downloads as a Word file |
| pass | `session.sim06.comments-jump` | sim06: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found) |
| pass | `session.sim06.comments-resolved` | sim06: comments resolved in the comments panel are resolved on the server |
| pass | `session.sim07.typed-landed` | sim07: the typed sentence is on the shelf |
| pass | `session.sim07.deleted-gone` | sim07: the deleted paragraph is no longer on the shelf |
| pass | `session.sim07.typed-counted` | sim07: typing N words raises the book's word total by N (studio count) |
| pass | `session.sim07.deleted-counted` | sim07: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty) |
| pass | `session.sim07.word-total` | sim07: reordering, the Bible, goals, exports and sharing leave the word total alone |
| pass | `session.sim07.order-saved` | sim07: the Outline move is in the shelf copy's section order |
| pass | `session.sim07.goals` | sim07: goals typed in the Goals panel are the book's goals |
| pass | `session.sim07.epub-valid` | sim07: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors) |
| pass | `session.sim07.submission-docx` | sim07: the submission manuscript downloads as a Word file |
| pass | `session.sim07.comments-jump` | sim07: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found) |
| pass | `session.sim07.comments-resolved` | sim07: comments resolved in the comments panel are resolved on the server |
| pass | `session.sim08.typed-landed` | sim08: the typed sentence is on the shelf |
| pass | `session.sim08.deleted-gone` | sim08: the deleted paragraph is no longer on the shelf |
| pass | `session.sim08.typed-counted` | sim08: typing N words raises the book's word total by N (studio count) |
| pass | `session.sim08.deleted-counted` | sim08: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty) |
| pass | `session.sim08.word-total` | sim08: reordering, the Bible, goals, exports and sharing leave the word total alone |
| pass | `session.sim08.order-saved` | sim08: the Outline move is in the shelf copy's section order |
| pass | `session.sim08.goals` | sim08: goals typed in the Goals panel are the book's goals |
| pass | `session.sim08.epub-valid` | sim08: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors) |
| pass | `session.sim08.submission-docx` | sim08: the submission manuscript downloads as a Word file |
| pass | `session.sim08.comments-jump` | sim08: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found) |
| pass | `session.sim08.comments-resolved` | sim08: comments resolved in the comments panel are resolved on the server |
| pass | `revisions.one-per-save` | each book's revision = 1 (create) + the number of accepted saves the browsers made |
| pass | `sync.conflict-surfaced` | a save from a device holding an older revision is refused (409) and the conflict notice is shown — never a silent overwrite |
| pass | `sync.no-silent-loss-keep-both` | "Keep both": this device's writing is on the shelf and the other device's is kept in History |
| pass | `sync.no-silent-loss-use-shelf` | "Use the shelf copy": the shelf keeps the other device's writing and this device's is kept in History |
| pass | `isolation.cross-user` | sim03 cannot read, change, delete, share or download sim04's book (404/401, nothing leaked) and the book is untouched |
| pass | `share.sim03.frozen` | sim03: the reading copy made before the session's edits does not show them |
| pass | `share.sim03.ui-share-current` | sim03: a link made in the UI after the edits shows them |
| pass | `share.sim04.frozen` | sim04: the reading copy made before the session's edits does not show them |
| pass | `share.sim04.ui-share-current` | sim04: a link made in the UI after the edits shows them |
| pass | `share.sim05.frozen` | sim05: the reading copy made before the session's edits does not show them |
| pass | `share.sim05.ui-share-current` | sim05: a link made in the UI after the edits shows them |
| pass | `share.sim06.frozen` | sim06: the reading copy made before the session's edits does not show them |
| pass | `share.sim06.ui-share-current` | sim06: a link made in the UI after the edits shows them |
| pass | `share.sim07.frozen` | sim07: the reading copy made before the session's edits does not show them |
| pass | `share.sim07.ui-share-current` | sim07: a link made in the UI after the edits shows them |
| pass | `share.sim08.frozen` | sim08: the reading copy made before the session's edits does not show them |
| pass | `share.sim08.ui-share-current` | sim08: a link made in the UI after the edits shows them |
| pass | `share.comments-posted` | every reader comment the world plans was accepted by the reader page (201) |
| pass | `share.comments-anchored` | each comment's paragraph index points at the block its quote came from, in the frozen copy |
| pass | `share.resolve-api` | resolving a comment (the request the comments panel sends) marks it resolved |
| pass | `epub.validate` | every EPUB the studio built (each book and each box set) passes EPUBCheck with 0 fatal and 0 errors |
| pass | `boxset.dartagnan.order` | The d'Artagnan Romances: the box set holds every volume, in reading order |
| pass | `boxset.valois.order` | The Valois Romances: the box set holds every volume, in reading order |
| pass | `boxset.oz.order` | The Oz Books: the box set holds every volume, in reading order |
| pass | `boxset.sim03-lunas-beach-treasure-hunt.order` | Luna's Beach Treasure Hunt: the box set holds every volume, in reading order |
| pass | `boxset.sim04-salt-road.order` | Salt Road: the box set holds every volume, in reading order |
| pass | `boxset.sim05-sample.order` | The Lantern Coast: the box set holds every volume, in reading order |
| pass | `boxset.sim06-the-travel-guide.order` | The Travel Guide: the box set holds every volume, in reading order |
| pass | `boxset.sim07-four-kitchens.order` | Four Kitchens: the box set holds every volume, in reading order |
| pass | `boxset.sim08-the-book-that-reads-you.order` | The Book That Reads You: the box set holds every volume, in reading order |
| pass | `bible.dartagnan.carried` | The d'Artagnan Romances: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.valois.carried` | The Valois Romances: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.oz.carried` | The Oz Books: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.sim03-lunas-beach-treasure-hunt.carried` | Luna's Beach Treasure Hunt: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.sim04-salt-road.carried` | Salt Road: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.sim05-sample.carried` | The Lantern Coast: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.sim06-the-travel-guide.carried` | The Travel Guide: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.sim07-four-kitchens.carried` | Four Kitchens: the Bible authored in book 1 imports into every later volume (export -> import) |
| pass | `bible.sim08-the-book-that-reads-you.carried` | The Book That Reads You: the Bible authored in book 1 imports into every later volume (export -> import) |
| **FAIL** | `meta.own-book` | opening another shelf book never carries the previous book's metadata onto it |
| pass | `import.lab` | import path chosen by measurement: single (titles, pictures placed, captions, italics) |
| pass | `auth.ui-sign-in-first-time` | every sign-in through the UI with the right email and password succeeded at the first attempt |
| pass | `run.no-errors` | no step of the seed or the persona runs errored |

### Failing checks, with evidence

#### `meta.own-book` — opening another shelf book never carries the previous book's metadata onto it

```json
{
 "persona": "sim04",
 "seriesBook": "b030",
 "standalone": "b034",
 "steps": [
  {
   "opened": "series book",
   "series": "Salt Road"
  },
  {
   "opened": "standalone",
   "seriesOnDesk": "Salt Road",
   "shot": "shots/sim04-meta-01.png"
  }
 ],
 "standaloneOnShelfBefore": {
  "series": null,
  "revision": 2
 },
 "standaloneOnShelfAfterEdit": {
  "series": "Salt Road",
  "revision": 3
 }
}
```

## Series gaps — what a writer of an interconnected series cannot do today

### Edits to DIFFERENT chapters on two devices are not merged: the writer must pick one copy; the other copy's chapter survives only inside a History snapshot.

`series.sync-no-merge`

```json
{
 "afterKeepBoth": {
  "revision": 4,
  "hasA1": false,
  "hasB1": true
 },
 "round1PutStatus": 409,
 "shot": "shots/sim03-twodev-01-conflict.png"
}
```

### A box set can only add later volumes as Word/Markdown/text files ("Add a Book…"), so every volume after the first arrives without its pictures, cover or front/back matter.

`series.boxset-drops-pictures`

```json
[
 {
  "series": "sim03-lunas-beach-treasure-hunt",
  "picturesInEachVolume": [
   3,
   3,
   3
  ],
  "picturesInBoxSetVolumes": [
   0,
   0,
   0
  ],
  "coversInBoxSet": [
   false,
   false,
   false,
   false
  ]
 },
 {
  "series": "oz",
  "picturesInEachVolume": [
   137,
   110,
   87,
   130,
   115,
   151,
   82,
   111,
   113,
   114,
   72,
   109,
   103
  ],
  "picturesInBoxSetVolumes": [
   0,
   0,
   0,
   0,
   0,
   0,
   0,
   0,
   0,
   0,
   0,
   0,
   0
  ],
  "coversInBoxSet": [
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false,
   false
  ]
 },
 {
  "series": "valois",
  "picturesInEachVolume": [
   0,
   6
  ],
  "picturesInBoxSetVolumes": [
   0,
   0
  ],
  "coversInBoxSet": [
   false,
   false,
   false
  ]
 },
 {
  "series": "sim04-salt-road",
  "picturesInEachVolume": [
   3,
   1
  ],
  "picturesInBoxSetVolumes": [
   0,
   0
  ],
  "coversInBoxSet": [
   false,
   false,
   false
  ]
 },
 {
  "series": "sim05-sample",
  "picturesInEachVolume": [
   11,
   11,
   10
  ],
  "picturesInBoxSetVolumes": [
   0,
   0,
   0
  ],
  "coversInBoxSet": [
   true,
   false,
   false,
   false
  ]
 },
 {
  "series": "sim06-the-travel-guide",
  "picturesInEachVolume": [
   3,
   3
  ],
  "picturesInBoxSetVolumes": [
   0,
   0
  ],
  "coversInBoxSet": [
   false,
   false,
   false
  ]
 },
 {
  "series": "sim07-four-kitchens",
  "picturesInEachVolume": [
   1,
   1,
   1
  ],
  "picturesInBoxSetVolumes": [
   0,
   0,
   0
  ],
  "coversInBoxSet": [
   false,
   false,
   false,
   false
  ]
 }
]
```

### The box set EPUB carries no series metadata (no belongs-to-collection) and is titled "<book one> — The Complete Box Set".

`series.boxset-no-series-metadata`

```json
[
 {
  "series": "sim03-lunas-beach-treasure-hunt",
  "opfTitle": "Luna's Beach Treasure Hunt — Book One — The Complete Box Set"
 },
 {
  "series": "dartagnan",
  "opfTitle": "The Three Musketeers — The Complete Box Set"
 },
 {
  "series": "oz",
  "opfTitle": "The Wonderful Wizard of Oz — The Complete Box Set"
 }
]
```

### A box set is not part of any book: the volume list lives only in the open page (state.boxSetVolumes is not in the saved book), so it must be rebuilt by hand each time.

`series.boxset-not-saved`

```json
{
 "savedBookKeys": [
  "activeId",
  "activePreset",
  "audio",
  "bible",
  "cover",
  "coverRecipe",
  "customThemes",
  "dictation",
  "exportPlatform",
  "fonts",
  "goals",
  "history",
  "historyPool",
  "images",
  "importReport",
  "manuscript",
  "meta",
  "printBleed",
  "printCustomMargins",
  "printFolio",
  "printHeadContent",
  "printHeadPlace",
  "printLargePrint",
  "printMarginMode",
  "printNotes",
  "printOmitBlankHead",
  "printOmitChapterHead",
  "printPictureBook",
  "printRecto",
  "printTrim",
  "sections",
  "storeCheck",
  "theme"
 ]
}
```

### The d'Artagnan Romances: a Story Bible edit in one volume never reaches its siblings — each volume holds its own copy.

`series.bible-diverges.dartagnan`

```json
{
 "entry": "D’Artagnan",
 "editedIn": "The Vicomte de Bragelonne",
 "editedEntry": {
  "aliases": [
   "SIM-EDIT-ALIAS"
  ],
  "description": "[sim] edited in The Vicomte de Bragelonne only"
 },
 "sibling": "The Man in the Iron Mask",
 "siblingEntry": {
  "aliases": [],
  "description": ""
 }
}
```

### The Valois Romances: a Story Bible edit in one volume never reaches its siblings — each volume holds its own copy.

`series.bible-diverges.valois`

```json
{
 "entry": "Charles",
 "editedIn": "The Forty-Five Guardsmen",
 "editedEntry": {
  "aliases": [
   "SIM-EDIT-ALIAS"
  ],
  "description": "[sim] edited in The Forty-Five Guardsmen only"
 },
 "sibling": "Chicot the Jester",
 "siblingEntry": {
  "aliases": [],
  "description": ""
 }
}
```

### The Oz Books: a Story Bible edit in one volume never reaches its siblings — each volume holds its own copy.

`series.bible-diverges.oz`

```json
{
 "entry": "Dorothy",
 "editedIn": "Ozma of Oz",
 "editedEntry": {
  "aliases": [
   "SIM-EDIT-ALIAS"
  ],
  "description": "[sim] edited in Ozma of Oz only"
 },
 "sibling": "Glinda of Oz",
 "siblingEntry": {
  "aliases": [],
  "description": ""
 }
}
```

### Salt Road: a Story Bible edit in one volume never reaches its siblings — each volume holds its own copy.

`series.bible-diverges.sim04-salt-road`

```json
{
 "entry": "Tanaka",
 "editedIn": "Salt Road — Book Three",
 "editedEntry": {
  "aliases": [
   "SIM-EDIT-ALIAS"
  ],
  "description": "[sim] edited in Salt Road — Book Three only"
 },
 "sibling": "Salt Road — Book Two",
 "siblingEntry": {
  "aliases": [],
  "description": ""
 }
}
```

### The Lantern Coast: a Story Bible edit in one volume never reaches its siblings — each volume holds its own copy.

`series.bible-diverges.sim05-sample`

```json
{
 "entry": "Mara",
 "editedIn": "The Lantern Coast — Book Three",
 "editedEntry": {
  "aliases": [
   "SIM-EDIT-ALIAS"
  ],
  "description": "[sim] edited in The Lantern Coast — Book Three only"
 },
 "sibling": "The Lantern Coast — Book Four",
 "siblingEntry": {
  "aliases": [],
  "description": ""
 }
}
```

### The shelf has no series: each list entry is only {createdAt, id, revision, title, updatedAt}, ordered by last edit, so a series' volumes are not grouped or in reading order.

`series.no-series-on-shelf`

```json
{
 "shelfOrderAsListed": [
  "The Forty-Five Guardsmen",
  "Chicot the Jester",
  "Marguerite de Valois",
  "The Man in the Iron Mask",
  "Louise de la Vallière",
  "Ten Years Later",
  "The Vicomte de Bragelonne",
  "Twenty Years After",
  "The Three Musketeers"
 ],
 "readingOrder": [
  [
   "The Three Musketeers",
   "Twenty Years After",
   "The Vicomte de Bragelonne",
   "Ten Years Later",
   "Louise de la Vallière",
   "The Man in the Iron Mask"
  ],
  [
   "Marguerite de Valois",
   "Chicot the Jester",
   "The Forty-Five Guardsmen"
  ]
 ]
}
```

### Single-file Import reads title and author from Markdown frontmatter but not "series:"; only Bulk import keeps it.

`series.single-import-ignores-series`

```json
{
 "frontmatter": "series: The d'Artagnan Romances",
 "singleImportMeta": {
  "title": "The Three Musketeers",
  "author": "Alexandre Dumas",
  "series": ""
 },
 "bulkImportSeries": "The d'Artagnan Romances"
}
```

### No book-details field holds the series: the only inputs named for a series are the cover maker's "Series Line".

`series.no-series-field`

```json
{
 "inputsWithSeriesInId": [
  "#cmSeries"
 ]
}
```

### A series volume's EPUB does not name its series or its place in it (no belongs-to-collection / group-position), although the book carries meta.series.

`series.epub-no-series-metadata`

```json
{
 "file": "dartagnan-01-the-three-musketeers.epub",
 "opfMetadata": "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"> <dc:identifier id=\"pub-id\">urn:uuid:61645be5-afee-4dcd-a353-fbc2351b8c0d</dc:identifier> <dc:title>The Three Musketeers</dc:title> <dc:language>en</dc:language> <dc:creator>Alexandre Dumas</dc:creator> <dc:rights>Copyright © 2026 Alexandre Dumas. All rights reserved.</dc:rights> <dc:date>2026</dc:date> <meta property=\"dcterms:modified\">2026-10-28T00:29:22Z</meta> <meta property=\"schema:accessMode\">textual</meta> <meta property=\"schema:accessModeSufficient\">textual</meta> <meta property=\"schema:accessibilityFeature\">structuralNavigation</meta> <meta property=\"schema:accessibilityFeature\">tableOfContents</meta> <meta property=\"schema:accessibilityHazard\">none</meta> <meta property=\"schema:accessibilitySummary\">This book is published as accessible text: it has structural navigation and a table of contents, and it can be read from start "
}
```

### Also-by pages are plain text in each volume: a series of N books needs N×(N−1) links typed and kept up to date by hand; nothing links one shelf book to another.

`series.alsoby-by-hand`

```json
[
 {
  "series": "dartagnan",
  "volumes": 6,
  "linesTypedAcrossVolumes": 30
 },
 {
  "series": "valois",
  "volumes": 3,
  "linesTypedAcrossVolumes": 6
 },
 {
  "series": "oz",
  "volumes": 14,
  "linesTypedAcrossVolumes": 182
 }
]
```

### Story Insights and the Bible's mentions work on the open book only; who appears in which volume of a series could only be computed by opening each volume (the simulation did this to build the presence table).

`series.no-cross-volume-view`

```json
{
 "presenceComputedFor": [
  "sim03-lunas-beach-treasure-hunt",
  "dartagnan",
  "oz",
  "valois",
  "sim04-salt-road",
  "sim05-sample",
  "sim06-the-travel-guide",
  "sim07-four-kitchens",
  "sim08-the-book-that-reads-you"
 ]
}
```

## Other gaps and bugs found

### Gap: When a chapter is left with no text, its title stops counting toward the book's word total, so deleting its last paragraph lowers the total by more than the words deleted.

`count.empty-chapter-title`

```json
[
 {
  "persona": "sim07",
  "chapter": "Banff, Canada",
  "deletedWords": 6,
  "titleWords": 4,
  "totalDelta": -10
 }
]
```

### Gap: Bulk import places Markdown pictures but drops their captions ("![alt](file \"caption\")").

`import.bulk-drops-captions`

```json
{
 "ebook": 43936,
 "captionsSingle": 23,
 "captionsBulk": 0
}
```

### Gap: Beta readers who share one internet address (a writing group, a library, a household) can leave only 10 comments per link per 10 minutes between them; the 11th gets 429.

`readers.one-address-cap`

```json
{
 "statusesOf11": [
  201,
  201,
  201,
  201,
  201,
  201,
  201,
  201,
  201,
  201,
  429
 ],
 "shares": 2
}
```

### Gap: The writer cannot answer a reader comment: the owner API offers resolve, unresolve and delete only (src/routes/shares.ts), and the comments panel has no reply control.

`readers.no-reply`

```json
{
 "ownerCommentRoutes": [
  "POST /api/shares/:id/comments/:cid/resolve",
  "POST /api/shares/:id/comments/:cid/unresolve",
  "DELETE /api/shares/:id/comments/:cid"
 ]
}
```

### Gap: Every autosave sends the whole book, pictures included: the largest illustrated volume re-uploads its full JSON on each save.

`perf.autosave-sends-whole-book`

```json
{
 "book": "The Marvelous Land of Oz",
 "pictures": 137,
 "words": 41768,
 "bytesPerSave": 49799886,
 "putMs": 22805,
 "postMs": 21293
}
```

### Gap: Typing slows with the size of the whole book, not the chapter: each input event in the last chapter takes this long (the studio's own input handling, 10 events per step).

`perf.typing-latency`

```json
[
 {
  "words": 250000,
  "msPerInput": 140
 },
 {
  "words": 1000000,
  "msPerInput": 482
 },
 {
  "words": 2500000,
  "msPerInput": 1248
 },
 {
  "words": 5000000,
  "msPerInput": 3576
 },
 {
  "words": 10000000,
  "msPerInput": 7075
 }
]
```

### Gap: A book over the shelf's size limit (MANUSCRIPT_MAX_BYTES, 64 MiB of JSON) cannot be saved to the shelf; the studio says so and keeps it on the device.

`limit.shelf-book-size`

```json
{
 "words": 10000000,
 "post": {
  "ms": 23771,
  "bytes": 73919706,
  "id": null,
  "revision": null,
  "status": "failed",
  "error": {
   "tooLarge": true,
   "mb": "70.5"
  }
 }
}
```

### Gap: The print PDF/X job did not finish for a book of this length (the saga-length volumes of ~40,000 words printed).

`limit.pdfx-long-book`

```json
{
 "words": 250000,
 "job": {
  "created": true,
  "status": "failed",
  "ms": 276562,
  "error": "Ghostscript exited with code null and produced no converted file.",
  "result": "{\"tool\":\"ghostscript\",\"error\":\"Ghostscript exited with code null and produced no converted file.\",\"configured\":true}"
 }
}
```

### Gap: The studio page crashed while working on the load-test book.

`limit.page-crash`

```json
{
 "atWords": [
  10000000
 ]
}
```

### Bug: A volume added to a box set takes its title from the file name with hyphens and underscores turned into spaces, so "Tik-Tok of Oz" becomes "Tik Tok of Oz" in the box set (manuscriptFileToVolume); the title is not editable there.

`bug.boxset-title-from-filename`

```json
[
 {
  "series": "valois",
  "renamed": [
   {
    "title": "The Forty-Five Guardsmen",
    "inBoxSet": "The Forty Five Guardsmen"
   }
  ]
 },
 {
  "series": "oz",
  "renamed": [
   {
    "title": "Tik-Tok of Oz",
    "inBoxSet": "Tik Tok of Oz"
   }
  ]
 }
]
```

### Bug: Opening a book carries the PREVIOUS book's series onto it (applyBookDoc merges meta onto the old meta; the arriving book has no "series" key), and the next autosave writes it to the shelf.

`bug.meta-series-carries-over`

```json
{
 "persona": "sim04",
 "seriesBook": "b030",
 "standalone": "b034",
 "steps": [
  {
   "opened": "series book",
   "series": "Salt Road"
  },
  {
   "opened": "standalone",
   "seriesOnDesk": "Salt Road",
   "shot": "shots/sim04-meta-01.png"
  }
 ],
 "standaloneOnShelfBefore": {
  "series": null,
  "revision": 2
 },
 "standaloneOnShelfAfterEdit": {
  "series": "Salt Road",
  "revision": 3
 }
}
```

### Bug: Seen while seeding too: a standalone book opened after a series book arrived carrying that series.

`bug.meta-series-carries-over-seed`

```json
[
 {
  "id": "b028",
  "title": "The Lantern Coast",
  "seriesOnDeskBeforeSet": "Luna's Beach Treasure Hunt"
 },
 {
  "id": "b033",
  "title": "Rain on Calder Street",
  "seriesOnDeskBeforeSet": "Salt Road"
 },
 {
  "id": "b039",
  "title": "The Sunken Vault",
  "seriesOnDeskBeforeSet": "The Lantern Coast"
 },
 {
  "id": "b044",
  "title": "The Lantern Coast",
  "seriesOnDeskBeforeSet": "The Travel Guide"
 },
 {
  "id": "b050",
  "title": "The Travel Guide",
  "seriesOnDeskBeforeSet": "Four Kitchens"
 },
 {
  "id": "b055",
  "title": "The Woolly School and the Runaway Ball of Yarn",
  "seriesOnDeskBeforeSet": "The Book That Reads You"
 }
]
```


## Saga volumes — measurements

Measured in the studio (headless Chromium, the sim stack): words/sections/pictures from the studio's own counts; doc = the saved book JSON; POST = first save to the shelf, PUT = a later autosave (If-Match); Bible pass = the Story Bible mention pass over the volume (the studio's own timing); EPUB = build in the browser.

| # | Volume | Words | Sections | Pictures | Doc MB | POST | PUT | Bible pass | EPUB build | EPUB MB | EPUBCheck |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | **The d'Artagnan Romances** | | | | | | | | | | |
| 1 | The Three Musketeers | 229,144 | 79 | 0 | 1.3 | 942 ms | 420 ms | 81 ms | 384 ms | 1.5 | 0 errors, 0 warnings |
| 2 | Twenty Years After | 241,642 | 101 | 0 | 1.4 | 643 ms | 611 ms | 89 ms | 1.0 s | 1.6 | 0 errors, 0 warnings |
| 3 | The Vicomte de Bragelonne | 187,586 | 86 | 0 | 1.1 | 570 ms | 946 ms | 84 ms | 352 ms | 1.2 | 0 errors, 0 warnings |
| 4 | Ten Years Later | 186,520 | 77 | 0 | 1.1 | 967 ms | 499 ms | 114 ms | 557 ms | 1.2 | 0 errors, 0 warnings |
| 5 | Louise de la Vallière | 166,847 | 79 | 0 | 1.0 | 441 ms | 618 ms | 65 ms | 1.0 s | 1.1 | 0 errors, 0 warnings |
| 6 | The Man in the Iron Mask | 172,342 | 72 | 0 | 1.0 | 535 ms | 609 ms | 58 ms | 466 ms | 1.1 | 0 errors, 0 warnings |
| | **The Valois Romances** | | | | | | | | | | |
| 1 | Marguerite de Valois | 201,925 | 78 | 2 | 2.3 | 999 ms | 927 ms | 46 ms | 560 ms | 1.5 | 0 errors, 0 warnings |
| 2 | Chicot the Jester | 137,927 | 108 | 0 | 0.8 | 666 ms | 603 ms | 30 ms | 1.0 s | 1.0 | 0 errors, 0 warnings |
| 3 | The Forty-Five Guardsmen | 150,265 | 102 | 6 | 3.6 | 1.5 s | 1.1 s | 40 ms | 380 ms | 2.6 | 0 errors, 0 warnings |
| | **The Oz Books** | | | | | | | | | | |
| 1 | The Wonderful Wizard of Oz | 39,895 | 36 | 148 | 13.5 | 7.0 s | 3.3 s | 12 ms | 1.3 s | 10.2 | 0 errors, 0 warnings |
| 2 | The Marvelous Land of Oz | 41,768 | 36 | 137 | 47.5 | 21 s | 23 s | 18 ms | 3.0 s | 35.8 | 0 errors, 0 warnings |
| 3 | Ozma of Oz | 38,962 | 33 | 110 | 6.2 | 2.2 s | 2.4 s | 84 ms | 398 ms | 4.7 | 0 errors, 0 warnings |
| 4 | Dorothy and the Wizard in Oz | 42,218 | 32 | 87 | 4.6 | 1.5 s | 1.4 s | 18 ms | 308 ms | 3.5 | 0 errors, 0 warnings |
| 5 | The Road to Oz | 39,727 | 36 | 130 | 6.4 | 1.9 s | 1.9 s | 12 ms | 355 ms | 4.8 | 0 errors, 0 warnings |
| 6 | The Emerald City of Oz | 53,573 | 42 | 115 | 5.7 | 2.0 s | 1.8 s | 20 ms | 399 ms | 4.3 | 0 errors, 0 warnings |
| 7 | The Patchwork Girl of Oz | 57,958 | 40 | 151 | 12.9 | 4.8 s | 4.4 s | 22 ms | 747 ms | 9.7 | 0 errors, 0 warnings |
| 8 | Tik-Tok of Oz | 48,221 | 37 | 82 | 4.4 | 1.2 s | 1.0 s | 19 ms | 292 ms | 3.4 | 0 errors, 0 warnings |
| 9 | The Scarecrow of Oz | 45,434 | 36 | 111 | 9.1 | 2.3 s | 1.9 s | 17 ms | 470 ms | 6.9 | 0 errors, 0 warnings |
| 10 | Rinkitink in Oz | 49,161 | 36 | 113 | 7.5 | 2.5 s | 1.8 s | 27 ms | 435 ms | 5.6 | 0 errors, 0 warnings |
| 11 | The Lost Princess of Oz | 46,879 | 38 | 114 | 5.3 | 1.1 s | 1.3 s | 12 ms | 254 ms | 4.0 | 0 errors, 0 warnings |
| 12 | The Tin Woodman of Oz | 44,333 | 36 | 72 | 4.1 | 1.3 s | 965 ms | 25 ms | 219 ms | 3.1 | 0 errors, 0 warnings |
| 13 | The Magic of Oz | 41,165 | 35 | 109 | 7.6 | 1.8 s | 2.7 s | 18 ms | 398 ms | 5.9 | 0 errors, 0 warnings |
| 14 | Glinda of Oz | 39,869 | 36 | 103 | 3.5 | 849 ms | 870 ms | 11 ms | 243 ms | 2.7 | 0 errors, 0 warnings |

### Real print PDFs (renderer + Ghostscript PDF/X job)

| Volume | Print HTML build | Job | Job time | Pages | Result |
|---|---|---|---|---|---|
| The Wonderful Wizard of Oz | 179 ms (13.4 MB) | done | 102 s | 264 | PDF/X-1a:2001, fonts embedded: true, 33.1 MB |
| Ozma of Oz | 144 ms (6.1 MB) | done | 81 s | 232 | PDF/X-1a:2001, fonts embedded: true, 19.4 MB |

## Box sets (the studio's own box-set path)

| Series | Volumes | Build | Size MB | Pictures in volumes after the first (source → box set) | EPUBCheck |
|---|---|---|---|---|---|
| The d'Artagnan Romances | 6 | 1.3 s | 7.6 | 0→0, 0→0, 0→0, 0→0, 0→0 | 0 fatal, 0 errors |
| The Valois Romances | 3 | 1.2 s | 3.5 | 0→0, 6→0 | 0 fatal, 0 errors |
| The Oz Books | 14 | 2.1 s | 14.2 | 137→0, 110→0, 87→0, 130→0, 115→0, 151→0, 82→0, 111→0, 113→0, 114→0, 72→0, 109→0, 103→0 | 0 fatal, 0 errors |
| Luna's Beach Treasure Hunt | 4 | 178 ms | 3.5 | 3→0, 3→0, 3→0 | 0 fatal, 0 errors |
| Salt Road | 3 | 70 ms | 1.1 | 3→0, 1→0 | 0 fatal, 0 errors |
| The Lantern Coast | 4 | 408 ms | 3.1 | 11→0, 11→0, 10→0 | 0 fatal, 0 errors |
| The Travel Guide | 3 | 226 ms | 6.2 | 3→0, 3→0 | 0 fatal, 0 errors |
| Four Kitchens | 4 | 54 ms | 1.2 | 1→0, 1→0, 1→0 | 0 fatal, 0 errors |
| The Book That Reads You | 3 | 28 ms | 0.1 | 0→0, 0→0 | 0 fatal, 0 errors |

## Which import path keeps a saga best (measured)

Decision rule (fixed in code): more chapter titles kept, then more pictures placed, then captions, then italics. Chosen: **single**.

| Volume | Path | Chapter sections | Titles kept | Pictures placed | Captions | Italic spans | Series from frontmatter | Import time |
|---|---|---|---|---|---|---|---|---|
| The Three Musketeers | Import (one file) + image library | 68 (prepared 67) | 67/67 | 0/0 | 0 | 323 | no | 812 ms |
| The Three Musketeers | Bulk import (.md + picture files) | 68 (prepared 67) | 67/67 | 0/0 | 0 | 323 | yes | 1.1 s |
| The Wonderful Wizard of Oz | Import (one file) + image library | 25 (prepared 24) | 24/24 | 148/148 | 23 | 0 | no | 430 ms |
| The Wonderful Wizard of Oz | Bulk import (.md + picture files) | 25 (prepared 24) | 24/24 | 148/148 | 0 | 0 | yes | 9.1 s |

## Load test: "SIM LOAD TEST — not a book"

Real saga text (2,298,130 words) repeated to each target, imported as one book on the sim stack only. Each operation ran under a time limit (export 900 s, import 900 s, op 300 s, pdfx 1800 s, save 600 s). "–" = not reached because an earlier step failed.

| Target words | Markdown MB | import | wordCount | bibleMentionPass | serialize | post | put | reopen | typing | epub | printHtml | pdfx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 250,000 | 1.4 | 1.1 s | 250,147 w, 75 ch, 32 ms | 78 ms | 1.4 MB, 15 ms | saved 731 ms | saved 600 ms | 690 ms | 10 inputs 1.4 s | 1.1 s, 1.6 MB, archive saved | 162 ms, 1.5 MB, archive saved | failed 277 s |
| 1,000,000 | 5.6 | 6.7 s | 1,000,720 w, 363 ch, 104 ms | 290 ms | 5.7 MB, 122 ms | saved 4.0 s | saved 1.9 s | 2.7 s | 10 inputs 4.8 s | 7.0 s, 6.4 MB, archive saved | 678 ms, 6.1 MB, archive saved | – |
| 2,500,000 | 13.7 | 11 s | 2,502,054 w, 1090 ch, 275 ms | 669 ms | 17.6 MB, 621 ms | saved 8.1 s | saved 7.2 s | 5.2 s | 10 inputs 12 s | 24 s, 16.1 MB, archive saved | 1.7 s, 15.2 MB, archive saved | – |
| 5,000,000 | 27.4 | 21 s | 5,004,090 w, 2191 ch, 611 ms | 1.3 s | 35.2 MB, 506 ms | saved 14 s | saved 17 s | 11 s | 10 inputs 36 s | 68 s, 32.1 MB, archive saved | 5.0 s, 30.5 MB, archive saved | – |
| 10,000,000 | 54.8 | 61 s | 10,008,280 w, 4413 ch, 1.2 s | 2.6 s | 70.5 MB, 1.9 s | **failed** 24 s {"tooLarge":true,"mb":"70.5"} | – | – | 10 inputs 71 s | **FAIL** 900 s: over the 900 s limit | **FAIL** 0 ms: not run: the page was still busy with an operation that ran over its limit | – |

### Limits found

- **post**: works up to 5,000,000 words; fails at 10,000,000 words — {  "tooLarge": true,  "mb": "70.5" }
- **epub**: works up to 5,000,000 words; fails at 10,000,000 words — "over the 900 s limit"
- **printHtml**: works up to 5,000,000 words; fails at 10,000,000 words — "not run: the page was still busy with an operation that ran over its limit"
- **pdfx**: fails at every step tried; fails at 250,000 words — "Ghostscript exited with code null and produced no converted file."
- **typing** (10 input events into the last chapter, each running the studio's own input handling): 250,000 words: 140 ms per input; 1,000,000 words: 482 ms per input; 2,500,000 words: 1248 ms per input; 5,000,000 words: 3576 ms per input; 10,000,000 words: 7075 ms per input.

## Persona sessions (real UI, in parallel)

| Persona | Book | Steps done | Typed / deleted words | Outline move | EPUB check | Comments resolved in UI | Screenshots |
|---|---|---|---|---|---|---|---|
| sim03 | The Lantern Coast | sign-in, open, type, delete, outline-move, bible, goals, autosave, export-epub, export-submission, share-ui, comments, end | 10 / 190 | moved 16→17 | 0 fatal, 0 errors | 3 | `shots/sim03-01-open.png` `shots/sim03-02-outline.png` `shots/sim03-03-bible.png` `shots/sim03-04-goals.png` `shots/sim03-05-manuscript.png` `shots/sim03-06-share.png` `shots/sim03-07-comments.png` |
| sim04 | Rain on Calder Street | sign-in, open, type, delete, outline-move, bible, goals, autosave, export-epub, export-submission, share-ui, comments, end | 21 / 12 | moved 1→2 | 0 fatal, 0 errors | 2 | `shots/sim04-01-open.png` `shots/sim04-02-outline.png` `shots/sim04-03-bible.png` `shots/sim04-04-goals.png` `shots/sim04-05-manuscript.png` `shots/sim04-06-share.png` `shots/sim04-07-comments.png` |
| sim05 | The Sunken Vault | sign-in, open, type, delete, outline-move, bible, goals, autosave, export-epub, export-submission, share-ui, comments, end | 19 / 15 | – | 0 fatal, 0 errors | 2 | `shots/sim05-01-open.png` `shots/sim05-02-outline.png` `shots/sim05-03-bible.png` `shots/sim05-04-goals.png` `shots/sim05-05-manuscript.png` `shots/sim05-06-share.png` `shots/sim05-07-comments.png` |
| sim06 | The Lantern Coast | sign-in, open, type, delete, outline-move, bible, goals, autosave, export-epub, export-submission, share-ui, comments, end | 10 / 109 | moved 12→13 | 0 fatal, 0 errors | 3 | `shots/sim06-01-open.png` `shots/sim06-02-outline.png` `shots/sim06-03-bible.png` `shots/sim06-04-goals.png` `shots/sim06-05-manuscript.png` `shots/sim06-06-share.png` `shots/sim06-07-comments.png` |
| sim07 | The Travel Guide | sign-in, open, type, delete, outline-move, bible, goals, autosave, export-epub, export-submission, share-ui, comments, end | 8 / 6 | moved 7→8 | 0 fatal, 0 errors | 2 | `shots/sim07-01-open.png` `shots/sim07-02-outline.png` `shots/sim07-03-bible.png` `shots/sim07-04-goals.png` `shots/sim07-05-manuscript.png` `shots/sim07-06-share.png` `shots/sim07-07-comments.png` |
| sim08 | The Woolly School and the Runaway Ball of Yarn | sign-in, open, type, delete, outline-move, bible, goals, autosave, export-epub, export-submission, share-ui, comments, end | 11 / 2 | moved 3→4 | 0 fatal, 0 errors | 5 | `shots/sim08-01-open.png` `shots/sim08-02-outline.png` `shots/sim08-03-bible.png` `shots/sim08-04-goals.png` `shots/sim08-05-manuscript.png` `shots/sim08-06-share.png` `shots/sim08-07-comments.png` |

### One writer, two devices

```json
[
 {
  "step": "both-open",
  "name": "both-open",
  "at": "2026-10-28T00:49:30.611Z",
  "revA": 2,
  "revB": 2,
  "chapterA": "Sydney Harbour, Australia",
  "chapterB": "Machu Picchu, Peru"
 },
 {
  "step": "A-saved",
  "name": "A-saved",
  "at": "2026-10-28T00:49:55.863Z",
  "revA": 3
 },
 {
  "step": "B-saves-different-chapter",
  "name": "B-saves-different-chapter",
  "at": "2026-10-28T00:50:16.209Z",
  "putStatus": 409,
  "open": true,
  "conflict": true,
  "status": "local",
  "shot": "shots/sim03-twodev-01-conflict.png"
 },
 {
  "step": "after-keep-both",
  "name": "after-keep-both",
  "at": "2026-10-28T00:50:23.195Z",
  "choice": "Keep both",
  "shelf": {
   "revision": 4,
   "hasA1": false,
   "hasB1": true
  },
  "historyOnB": [
   {
    "name": "Shelf copy, kept from a sync conflict",
    "auto": "conflict",
    "hasA1": true,
    "hasB1": false
   }
  ]
 },
 {
  "step": "C-saved",
  "name": "C-saved",
  "at": "2026-10-28T00:50:50.936Z",
  "revC": 5,
  "revB": 4
 },
 {
  "step": "B-saves-same-chapter",
  "name": "B-saves-same-chapter",
  "at": "2026-10-28T00:51:02.212Z",
  "putStatus": 409,
  "open": true,
  "conflict": true,
  "shot": "shots/sim03-twodev-02-conflict.png"
 },
 {
  "step": "after-use-shelf",
  "name": "after-use-shelf",
  "at": "2026-10-28T00:51:11.850Z",
  "choice": "Use the shelf copy",
  "shelf": {
   "revision": 6,
   "hasA2": true,
   "hasB2": false,
   "historyHasB2": true,
   "historyHasA1": false
  },
  "historyOnB": [
   {
    "name": "This device's copy, kept from a sync conflict",
    "auto": "conflict",
    "words": 135,
    "hasB2": true
   },
   {
    "name": "Shelf copy, kept from a sync conflict",
    "auto": "conflict",
    "words": 130,
    "hasB2": false
   }
  ],
  "historyOnShelf": [
   {
    "name": "This device's copy, kept from a sync conflict",
    "auto": "conflict",
    "hasB2": true
   },
   {
    "name": "Shelf copy, kept from a sync conflict",
    "auto": "conflict",
    "hasB2": false
   }
  ],
  "deviceBStatus": {
   "syncStatus": "saved",
   "dirty": false,
   "revision": 6
  }
 }
]
```

## Timings

up 125 s · world 129 ms · seed 1009 s · personas 362 s · monster 1703 s · check 62 s
Seed 2026-10-28T00:28:41.070Z → 2026-10-28T00:45:25.199Z; 1554 /api and /read requests logged (out/evidence/net-*.jsonl).

## Limitations

- The seed builds each book in the studio page by calling the studio's own functions (import, image library intake, Story Bible seed/export/import, shelf save, EPUB and box-set builders) rather than clicking each button; the persona sessions are the UI-driven part.
- The browser contexts run with the studio's service worker blocked (Playwright cannot route requests a service worker makes); offline behaviour is not exercised.
- Pictures for single-file Import are added with the image library's own intake and the library ids the prepared Markdown names; a writer would upload and place each one by hand.
- Reader comments come from one browser address, so the per-address limit (10 per link per 10 minutes) caps the world at 8 comments per link.
- Ghostscript PDF/X jobs run one at a time on the server; only the volumes listed in world.config.json (monster.printVolumes) are printed.
- Gutenberg editions mark chapters in many ways; tools/sim/sagas.json records the per-edition rule used, and the prepared chapter count is compared with each source's own contents list in the prep report (10-ramp-gallery/sagas/_prepared/prep-report.json).
