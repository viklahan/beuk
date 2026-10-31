# Book format v1

Reference for the JSON a Beuk book is stored as. It is written for engineers who read or write books: the 2.0 studio, the server, import and export tools.

"CI:n" is a line of `client/index.html` at `main` @ `03c1928`. Code lives in `src/book/`: `schema.ts` (the shape), `upgrade.ts` (the legacy steps), `read.ts` (`readBook`). The field inventory this doc is built from is `docs/superpowers/specs/2026-10-30-beuk-book-format-inventory.md`.

## Purpose

Beuk 1.0 never had a spec. The studio's `serializeBook` (CI:50139) writes the book, `applyBookDoc` (CI:50199) reads it, and the server stores the result as an opaque object. This format is that behaviour written down, with a reader that opens every book 1.0 ever wrote.

Three rules:

- **The reader never rejects a book.** `readBook` never throws. A book that is not an object becomes the empty scaffold, with a warning.
- **The reader never loses a writer's data.** See [The lossless rule](#the-lossless-rule).
- **The server observes; it does not enforce.** A format problem is recorded, never turned into a failed save.

## Versioning rules

The book carries `formatVersion`. 1.0 did not write it, so older books lack it.

| `formatVersion` | What `readBook` does |
|---|---|
| missing | A v1 book written before versioning. Every upgrade step runs where its detection matches. |
| `1` | v1. Upgrade steps still run where their detection matches. |
| an integer above 1 | `status: "newer"`. The book is passed through untouched: no upgrades, no defaults. Warning `format-newer`. |
| anything else | Warning `format-invalid`, the raw value goes to `preserved`, and the book is read as if it had none. |

`readBook` returns `{ status, book, upgrades, warnings, preserved }`. `status` is `"ok"`, `"newer"` or `"failed"`.

- **Check `status` before using `book`.** With `"newer"`, `book` is the input passed through, not a validated BookV1. With `"failed"` (reading itself threw), `book` is the empty scaffold and the input is in `preserved` at path `""`, with a `read-failed` warning.
- A studio MUST NOT save a book read with status `"newer"` or `"failed"`.

- `upgrades` names the steps that fired, in order, plus one `defaults:<key>` entry for each top-level key it had to fill.
- `warnings` are `{ code, path, detail }`.
- `preserved` is `{ path, raw, used }`: a value the reader replaced, and what it used instead.

Reading a book that was already read changes nothing and fires no step except the record-only ones (see [Upgrade steps](#upgrade-steps)).

## Top-level keys

38 keys. "Optional" means `serializeBook` leaves the key out when empty. "Backfilled" means 1.0 always writes the key today, but older books lack it and `applyBookDoc` fills it on read; the schema accepts its absence.

| Key | Type | Optional | Default when missing | 1.0 |
|---|---|---|---|---|
| `formatVersion` | integer | yes | none (a book without it is v1) | new in 2.0 |
| `meta` | object | no | `bookMetaDefaults`; `bookId` is minted | CI:20519, CI:50215 |
| `theme` | object | no | `PRESETS[0].theme` | CI:50234 |
| `activePreset` | string or null | no | `"classic"` if the theme was missing, else null | CI:50244 |
| `colour` | `{accent, tint, printBlack?}` | yes | absent | CI:19425, CI:50246 |
| `outline` | `{tags, filters, threads?, fields?}` | yes | absent | CI:32974, CI:50259 |
| `sections` | array of section | no | the empty scaffold | CI:50099, CI:50255 |
| `activeId` | section id | no | first chapter, else first section | CI:50250 |
| `cover` | `{data, mediaType, ext, name}` or null | no | null | CI:42195, CI:50257 |
| `coverRecipe` | object or null | no | null | CI:42314, CI:50258 |
| `images` | array | no | `[]` | CI:35061, CI:50260 |
| `fonts` | array | no | `[]` | CI:19660, CI:50262 |
| `customThemes` | array | no | `[]` | CI:19650, CI:50263 |
| `exportPlatform` | string | no | `"generic"` | CI:20535, CI:50271 |
| `printTrim` | string | no | `"6x9"` | CI:20535, CI:50272 |
| `printRecto` | boolean | no | true | CI:20535 |
| `printLargePrint` | boolean | no | false | CI:20535 |
| `printPictureBook` | boolean | backfilled | false | CI:50275 |
| `printBleed` | boolean | backfilled | false | CI:50278 |
| `printMarginMode` | `"auto"` or `"custom"` | no | `"auto"` | CI:20536, CI:50285 |
| `printCustomMargins` | `{inside, outside, top, bottom}`, each 0 to 3 | no | `{0.625, 0.5, 0.6, 0.75}` | CI:20536, CI:50288 |
| `printHeadContent` | `titleauthor`, `title`, `author`, `chapter`, `none` | no | `"titleauthor"` | CI:50291 |
| `printHeadPlace` | `"top"` or `"bottom"` | no | `"top"` | CI:50292 |
| `printOmitChapterHead` | boolean | no | false | CI:50293 |
| `printOmitBlankHead` | boolean | no | true | CI:50294 |
| `printFolio` | `"centre"`, `"outer"`, `"none"` | no | `"centre"` | CI:20537, CI:50295 |
| `printNotes` | `"page"` or `"end"` | backfilled | `"end"` on read; a new book gets `"page"` | CI:50300, CI:20561 |
| `storeCheck` | object | no | `storeDefaults` | CI:49076, CI:49079 |
| `goals` | object | no | `{daily: 0, project: 0, deadline: ""}` | CI:31136 |
| `history` | array of entry | no | `[]` | CI:32183 |
| `historyPool` | `{images, fonts, covers, research?}` | no | empty pool | CI:32117 |
| `importReport` | object or null | no | null | CI:40252, CI:40266 |
| `bible` | `{entries, fields?, counts?}` | yes | absent | CI:24270, CI:50180 |
| `notebook` | `{notes}` | yes | absent | CI:26496, CI:50181 |
| `research` | `{files}` | yes | absent | CI:26557, CI:50182 |
| `audio` | object | no | normalized empty | CI:47267 |
| `manuscript` | object | backfilled | normalized empty | CI:46710, CI:50319 |
| `dictation` | `{lang, recent}` | no | `{lang: "", recent: []}` | CI:68706 |

`serializeBook` writes 37 of these (all but `formatVersion`) until 1.0 starts writing the version.

Unknown top-level keys are kept as written, with warning `unknown-key`.

## Nested structures

Every object is open: a key the schema does not know survives a read. Strings in the schema are structural only; the numeric caps live in the [limits](#limits) table.

| Structure | Fields | 1.0 |
|---|---|---|
| `meta` | `title`, `subtitle`, `author`, `publisher`, `isbn`, `language`, `langSource`, `langGuess`, `year`, `rights`, `description`, `a11ySummary`, `bookId`. Optional: `series`, `seriesNumber`, `legacyBookIds`, `titleSource`, `subtitleSource`, `authorSource`, `castHidden`, `rightsMode`, `ccLicence`, `firstPublished`, `editionHolder`. | CI:20519, CI:20976 |
| `theme` | `bodyFont`, `headFont`, `fontSize`, `lineHeight`, `paraMode`, `indentDepth`, `headerStyle`, `dropDepth`, `smallCapsWords`, `ornament`, `justify`, `hyphens`. Optional: `headingFlourish`, `headingFlourishPos`, `header` (`number`, `title`, `subtitle`, each `{font, size, align, casing, above, below}`). | CI:19226, CI:19620 |
| `colour` | `accent`, `tint`, optional `printBlack` | CI:19425 |
| section | `id`, `kind`, `type`, `title`, `subtitle`, `number`, `content`, `dropCap`, `smallCaps`, `included`, `plateId`, `plateAlt`, `backdropId`, `backdropStrength`, `htLine1`, `htLine2`, `tocHeading`, `scenes`. Outline fields, each present only when set: `synopsis`, `status`, `tags`, `pov`, `threads`, `custom`. | CI:50099, CI:32939 |
| scene | `at`, `imageId`, `name`, `caption`, `alt` | CI:50122 |
| image | `id`, `name`, `mediaType`, `data`. Optional: `ext`, `credit {name, url}`. | CI:34535, CI:35061 |
| `cover` | `data`, `mediaType`, `ext`, `name` | CI:42195, CI:43563 |
| `coverRecipe` | `layout`, `bgType`, `bgColor`, `bgColor2`, `texture`, `bgImageId`, `title`, `subtitle`, `author`, `tagline`, `series`, `wrap`, `elements`, optional `bookText`. `wrap` has `trim`, `pages`, `paper`, `customFactor`, `blurb`, `quote`, `imprint`, `binding`, `hcSpine`, `hcSpineAllow`, `flapFront`, `flapBack`, `flapPhotoId`. Optional: `spine` and `back`, the spine's and back cover's own look (see below). | CI:42286, CI:43006 |
| font | `id`, `name`, `family`, `ext` (`ttf` or `otf`), `mediaType`, `data` | CI:19660 |
| custom theme | `id`, `name`, `theme` | CI:19650 |
| `outline` | `tags [{name, colour}]`, `filters [{id, name, status, tags}]`, optional `threads`, `fields` | CI:32974 |
| `bible` | `entries`, optional `fields`, `counts`. An entry has `id`, `type`, `name`, `aliases`, `description`, `notes`, `imageId`, `tags`, `exactCase`, `exclude`, and optionally `facts`, `links`, `changes`, `ai`, `scope`. | CI:24095, CI:24110 |
| `notebook` | `notes [{id, title, body}]`, each with optional `folder`, `secs`, `files`, `url`, `at` | CI:26496 |
| `research` | `files [{id, name, mediaType, data, bytes}]`, `at` optional | CI:26557 |
| `storeCheck` | `store`, `binding`, `ink`, `attestSpine` | CI:49074 |
| `goals` | `daily`, `project`, `deadline`; optional `days`, `dlDay`, `auto`, `start` | CI:31136 |
| `audio` | `narrator`, `format`, `rightsInClosing`, `include`, `pron`, `dismissed` | CI:47267 |
| `manuscript` | `legalName`, `address`, `phone`, `email`, `byline`, `surname`, `paper`, `font`, `italics` | CI:46710 |
| `dictation` | `lang`, `recent` | CI:68706 |
| `importReport` | `v`, `items` | CI:40252 |
| history entry | `id`, `name`, `at`, `words`, optional `auto`, `chop`, and either `doc` (older form) or `chopDoc` (packed form). In a packed doc, an image, font, research file or cover is a full object, `{ref}`, or `{ref, pool}`. | CI:32117 to CI:32202 |

`coverRecipe.wrap.spine` and `coverRecipe.wrap.back` (spine and back cover customization; both optional, and a cover with neither follows the front):

| Key | Fields |
|---|---|
| `wrap.spine` | `bg`, `font` (`""` follows the front title font), `color` (`""` follows), `show` (`both`, `title`, `author` or `custom`), `text` (used when `show` is `custom`), `caps` (author in capitals, default true), `dir` (`auto`, `ttb` or `btt`), `iconTop`, `iconBottom` |
| `wrap.back` | `bg`, `font`, `color` (both `""` follow the front) |
| `bg` | `mode` (`front`, `solid`, `gradient` or `pattern`), `color`, `color2`, `dir` (`down`, `across`, `diag-down` or `diag-up`), `pattern` (`linen`, `speckle`, `vignette`, `dots`, `stripes`, `grid` or `diamonds`). Colours are `#rrggbb`. |
| icon | `kind` (`none`, `lucide` or `upload`), `name` (a Lucide icon key, PascalCase, for `lucide`), `picId` (a stored picture id, for `upload`) |

The studio replaces any value outside these lists with the follow-the-front default (no icon, default colour).

Binary fields (`images[].data`, `cover.data`, `fonts[].data`, `research.files[].data`, and the same inside history and `historyPool`) hold canonical base64 or a stored-picture ref, `beuk-pic:` plus a SHA-256 in hex. Base64 that is not canonical stays inline in 1.0 and is accepted. A dehydrated book from the server is therefore valid.

Ids: a section id is `s` plus 7 base36 characters; a `bookId` is `urn:uuid:<uuid>`. Legacy ids are upgraded (`bookId`) or warned about, never dropped.

### Enums

Where 1.0 enforces a value on load, the schema is strict and the reader replaces a bad value (see [The lossless rule](#the-lossless-rule)). Where 1.0 accepts any string, the schema takes a string and the reader only warns when it is not in the known list.

- Enforced: `section.backdropStrength`, `section.status`, `printMarginMode`, `printHeadContent`, `printHeadPlace`, `printFolio`, `printNotes`, `storeCheck.*`, `manuscript.paper`, `manuscript.font`, `manuscript.italics`, `history[].auto`, `bible` entry `type`, `coverRecipe` layout, background and texture, `wrap.paper`, `wrap.binding`.
- Warn only: `exportPlatform`, `printTrim`, `section.kind`, `section.type`, `theme.headerStyle`, `theme.paraMode`, `theme.headingFlourishPos`, `meta.rightsMode`, `meta.ccLicence`, `meta.langSource`.

The known lists are `KNOWN` in `src/book/schema.ts`.

### Limits

1.0 truncates or caps these. The reader keeps the value and warns. The caps are `LIMITS` in `src/book/schema.ts`.

| Value | Limit | 1.0 |
|---|---|---|
| `meta.series` | 120 characters | CI:27582 |
| `meta.seriesNumber` | 1 to 999 | CI:20523 |
| `meta.legacyBookIds` | 16 ids of 300 characters | CI:4435 |
| `meta.castHidden` | 200 items of 80 characters | CI:22295 |
| `section.synopsis` | 4000 characters | CI:32939 |
| `section.tags` | 30 | CI:32939 |
| `section.pov` | 80 characters | CI:32939 |
| `outline` filters, threads, fields | 40, 30, 20 | CI:32974 |
| `bible` entries | 2000 | CI:24095 |
| `bible` changes per entry | 500 | CI:24177 |
| `bible` entry name, notes | 120, 20000 characters | CI:24110 |
| `bible` change quote | 160 characters | CI:24131 |
| `notebook` notes | 500 | CI:26496 |
| `notebook` title, body | 120, 50000 characters | CI:26496 |
| `research` file, total, count | 10 MB, 25 MB, 60 files | CI:26533 |
| `audio.narrator` | 200 characters | CI:47267 |
| `dictation.recent` | 4 | CI:68702 |
| `printCustomMargins` | 0 to 3 each | CI:50288 |

## Upgrade steps

Fifteen steps run in this order, on a copy of the book, before defaults are filled. A step fires when it changed the book. Each names the 1.0 code it mirrors. `readBook` lists the ones that fired in `upgrades`.

Three steps are record-only: `rights-mode`, `history-doc`, `optional-empties`. They change nothing. They fire on every read of a book that has their shape, so a book they fired on fires them again the next time.

### `sections-split`

Detects `sections` as an object `{frontMatter, body, backMatter}`. Flattens it to one array and sets each section's `kind` (`front`, `body`, `back`) unless it has one. Entries that are not objects, and any other key of that object, go to `preserved`. Mirrors the server export, `src/account/data.ts:262-286`.

### `sections-missing`

Detects `sections` missing or empty. Replaces it with the empty scaffold and sets `activeId` to its chapter. A replaced `activeId` and any non-empty unusable `sections` value go to `preserved`. Mirrors CI:50253-50256.

### `bookid-missing`

Detects no `meta.bookId`. Mints `urn:uuid:` plus a random UUID. This is the one step that is not a pure function of the book. Mirrors CI:50215.

### `bookid-legacy`

Detects a `bookId` that is not a `urn:uuid:` UUID. Sets the id to `urn:uuid:` plus the UUIDv5 of the old id under the Beuk namespace, and adds the old id to `meta.legacyBookIds` (all of them: the reader is lossless, so it keeps ids past 1.0's limit of 16 and warns `over-limit`). Mirrors CI:4428-4482 and CI:50328.

### `bookid-sample`

Detects the id `urn:uuid:beuk-sample-lantern-coast`. Sets `SAMPLE_BOOK_ID` and records the old id in `legacyBookIds`. Only lantern-coast maps to the sample id. `urn:uuid:beuk-sample-salt-meridian` takes the `bookid-legacy` UUIDv5 path, exactly as 1.0's `bookIdMigrated` does (CI:4430-4433), though 1.0's UI still recognises it as a sample (CI:4357). Mirrors CI:4356-4377.

### `lang-unknown`

Detects a `meta.language` that is not a key of the language packs. Reads it as `"en"`, puts the raw value in `preserved`, and warns `unknown-language`. Mirrors CI:50230.

### `lang-source`

Detects a missing or unknown `meta.langSource`, or a `meta.langGuess` that is not a string. Sets `langSource` to `"manual"` if the language is not English, else `"auto"`, and `langGuess` to `""`. Mirrors CI:50231-50233.

### `theme-missing`

Detects no `theme`. Sets the classic preset's theme, and `activePreset` to `"classic"` when it was empty. Mirrors CI:50234 and CI:50244.

### `theme-display-body`

Detects a display face as `theme.bodyFont`. Replaces it with the default body face, puts the raw face in `preserved`, and warns `display-body-font`. Mirrors CI:50242 and CI:19288.

### `print-defaults`

Detects missing print keys (`exportPlatform`, `printTrim`, `printRecto`, `printLargePrint`, `printPictureBook`, `printBleed`, the margin, header and folio keys). Fills each from 1.0's print defaults. `printNotes` has its own step. Mirrors CI:50269-50295.

### `notes-end`

Detects no `printNotes`. Sets `"end"`: an older book keeps end-notes, while a new book gets `"page"`. Mirrors CI:50300 and CI:20561.

### `rights-mode`

Record-only. Fires when `meta.rightsMode` is missing. Writes nothing: 1.0 reads the rights line at display time (`rightsModeOf`, CI:20985), and an old book is saved byte for byte as it was. Mirrors CI:20985-21000.

### `history-doc`

Record-only. Fires when a history entry has a full `doc`. Nothing is rewritten: `doc` is valid beside `chopDoc`. Mirrors CI:32187-32188.

### `optional-empties`

Record-only. Fires when any of `colour`, `outline`, `bible`, `notebook`, `research` is missing. They stay absent, which is the canonical form. Mirrors CI:50180-50182 and CI:50246-50261.

### `activeid-fallback`

Detects an `activeId` that names no section. Uses the first chapter, else the first section, and puts the raw id in `preserved`. Duplicate section ids are warned about (`duplicate-id`) and both sections are kept. Mirrors CI:50250-50252.

## The lossless rule

`readBook` does not strip, truncate or silently replace anything a writer typed. Where 1.0 would, the reader takes one of two paths.

**Representable but beyond 1.0's limits.** The value stays in the book as written. A warning names the path and the limit. Examples: a `series` over 120 characters, more than 2000 bible entries, notes over 20000 characters, extra keys on a font, an `importReport` without `v: 1`.

**Not usable as it is.** The book gets the value 1.0 would have used. The original goes to `preserved[]` as `{ path, raw, used }`, never into the book, and a warning is recorded. Examples: an unknown language, a display face as body font, a wrong type, a value outside an enum that 1.0 enforces on load.

Unknown keys, at any depth, stay.

## Where readBook differs from 1.0

`applyBookDoc` stays the 1.0 reader. `readBook` is its documented twin, and these are the places they differ. Each was decided and is tested.

1. **`sections-split` opens.** `readBook` opens `sections: {frontMatter, body, backMatter}`, as the server export does (`src/account/data.ts:262-286`). 1.0's studio loads an empty scaffold for it.
2. **Over-limit values stay.** A value past a limit in the [limits](#limits) table stays in the book with a warning. 1.0 truncates or caps it.
3. **Unusable values are preserved.** A wrong type, a strict-enum violation, an unknown language or a display face as body font gets 1.0's replacement, and the raw value goes to `preserved[]`. 1.0 discards the raw value.
4. **A missing `meta.year` reads as `""`.** 1.0 uses the current year. The reader is pure and has no clock.
5. **`lang-unknown` replaces inherited-key codes.** A code such as `"constructor"` becomes `"en"`. 1.0's `!LANG_PACKS[x]` finds it on the object's prototype and keeps it.
6. **The reader is pure.** It has none of 1.0's desk behaviour: the history snapshot `bookid` migration takes (`bookIdMigrateDesk`, CI:4470), clearing history when another book opens (CI:50325), and reading research files already on the desk (CI:50336). The studio keeps those around its call to `readBook`. The one exception is `bookid-missing`, which mints a random id, as 1.0 does.
7. **`sections-missing` records the replaced `activeId`.** When it replaces the sections with the scaffold, the old `activeId` goes to `preserved`. 1.0 drops it.
8. **Record-only steps fire on every read.** `rights-mode`, `history-doc` and `optional-empties` fire on every read where their condition holds, because they change nothing. A 2.0 UI that tells writers "this book was upgraded" must filter out the steps marked `recordOnly` in `STEPS`.

One more note, on a step that matches 1.0 and is easy to get wrong: `bookid-sample` maps only lantern-coast to `SAMPLE_BOOK_ID`.

## Keeping this honest

`tests/book-format-guard.test.ts` parses `serializeBook` out of `client/index.html` and fails when its keys differ from `TOP_LEVEL_KEYS`, when this doc lacks a row for a key or a section for a step, or when the "Where readBook differs from 1.0" list loses an item. A new key in 1.0 fails the build until `src/book/schema.ts` and this doc learn it.
