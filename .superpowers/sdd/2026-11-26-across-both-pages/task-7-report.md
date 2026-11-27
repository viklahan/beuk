# Task 7 report: the chapter settings

## Built
- studio/src/pictures/ArtRows.tsx: Fit select gains "Across both pages"; onChange stores plateFitOf(value) (fill/whole/across), no longer coerces to fill. While across is set (and a plate is chosen) the Chapter backdrop and Backdrop strength selects are disabled and one note line shows under the Fit row (#plateAcrossNote). The backdrop keys are never written (Review Focus 5). Resolution note #plateAcrossSoft: acrossCrop over the book's printTrim (else 1.0's default), bleed 0.125 only when meta.printBleed is true, direction from meta.language via isRtlLang; shown only when ppi < 200, rounded. Unreadable size / missing picture / any throw -> null, no note (Review Focus 3).
- client/index.html: editor.plateAcrossNote and editor.plateAcrossSoft ({ppi}) added after editor.plateFitAcross in all 13 packs; English stand-ins in the 12 non-English packs (localization agent to draft UNSIGNED translations; none invented here).
- studio/scripts/extract-closure.mjs: imagePixelSize added to the main closure roots (it was only in the print copy). studio/src/closure/index.ts: typed imagePixelSize; trimSize takes an optional id.
- studio/src/pictures/pictures.ts: plateFitFor wrapper return type widened to include 'across' (tsc error left by Task 6).
- studio/test/pictures-ui.test.tsx: 6 new tests (the brief's 5 + a >=200 ppi no-note case); the existing Fit options assertion now lists three options.

## TDD
RED: 5 failed of the new tests (no across option, no keys). GREEN after implementation: pictures-ui 20/20.

## Results
- look.test.ts: 4/4. tests/localization.test.ts: 13/13. tsc --noEmit clean.
- Page self-checks: "result: as the ledger says" (exit 0).
- Full studio suite: 180 files passed | 3 skipped; 1804 passed | 37 skipped | 0 failed (baseline 1 failed | 1773 passed | 37 skipped; import-data did not time out this run).

## Concerns
- Note line is plain markup in a .sw-txt div, not a switch-row; no design pass on its look.
- Note shows the PPI from the book's saved printTrim/printBleed meta; a book with a different bleed state in 1.0 is the same source.
- Non-English packs show English for the three across strings until translations are signed.

## Fix round 1
1. `git rm tests/fixtures/l10n-unsigned.json`. No reference to it outside .superpowers (grep, excluding node_modules and .superpowers: none; docs/strings-pending-signoff.md does not mention it, so §6 is untouched).
2. ArtRows.tsx: the meta observer now re-renders on `images`, `printTrim`, `printBleed` and `meta`. Found while doing this: the note read the language from `meta.get('language')`, but the book's language is the `language` field of the record under the `meta` key (bookMeta), so it always read English; it now reads `bookMeta(ydoc).language`.
3. Two new tests in pictures-ui.test.tsx (bleed off / on): a 2400 x 2400 plate on 6 x 9, Fit across. Studio note: absent without bleed, "196" with bleed. The exported book goes through the print module (arriveForExport, exportSafe, printPlacements): dpi 200 and 2400/12.25 = 195.9, and `round(dpi) < 200` matches the note's presence.

Commands and outputs:
- `cd studio && npx tsc --noEmit -p tsconfig.json`: clean.
- `npx vitest run test/pictures-ui.test.tsx test/keys.test.ts test/look.test.ts`: 3 files, 32 passed, 0 failed.
- `node --import tsx --test tests/localization.test.ts`: pass 13, fail 0.
