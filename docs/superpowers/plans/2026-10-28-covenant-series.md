# Covenant, grown up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Covenant changes pinned in the story ("Right now"), a shared series Covenant, links, quick facts, rich details and a stored AI setting — with no AI in it and nothing new for a writer who adds none of it.

**Architecture:** Everything per-book lives in the client `BEUK:bible` blocks of `client/index.html` (model, matching, card, self-checks, strings), extending `state.bible` and serializing new keys only when used. The series Covenant is a new owner-scoped server row (`series_covenants`) with the same revision/409 protection as `manuscripts`; the client merges it with the book's own entries at read time.

**Tech Stack:** vanilla JS single-file studio (`client/index.html`), Express + TypeScript + Postgres (`src/`), `node:test` via tsx, in-browser `SELF_CHECKS` registered in `src/housekeeping/registry.ts`.

**Spec:** `docs/superpowers/specs/2026-10-28-covenant-series-design.md`

## Global Constraints

- User-facing word is **Covenant**; code identifiers keep `bible`.
- A book that uses none of the new features serializes byte-for-byte as today (no new keys; `bibleHas()` rule extends to every new field).
- The Covenant never reaches EPUB, print, Word or word counts; margin dots never print or export (`bible.notexported` must keep passing).
- Matching rules unchanged (whole word, any script, English possessive/plural, exactCase, exclude, ambiguity left out of both).
- Every new string in all **13** locale packs inside the `BEUK:bible` strings block, no exclamation marks (enforced by `tests/story-bible.test.ts`).
- Every new self-check: `{ id, feature: "bible", name, run() }` in `bibleSelfChecks()`, wrapped in `bibleCheckGuard`, registered in `src/housekeeping/registry.ts` as `kind: 'client-only'` with a reason, and its id added to `IDS` in `tests/story-bible.test.ts`.
- Nothing merges, moves or disappears without the writer choosing it.
- Signed out: everything except the series Covenant works; the series shows one line saying it needs a free account.
- Server tests run only through `bash /c/Users/vikra/Projects/beuk-final/run-tests.sh <repo-dir> [files]` (Linux Docker; Windows can't run the fake tools).
- Client self-checks run in the studio: `http://localhost:8090`, DevTools console `runBeukSelfChecks().filter(r => r.feature === "bible" && !r.pass)` → `[]`. Restart with `start-local.ps1` only for `src/` changes; Caddy serves `client/` from disk.
- Commit after each task; never push (push waits for a clean scrub and V's go).

## Review Focus

1. **A change's quote appears twice in its section** → the anchor resolves to the occurrence nearest its saved offset, not the first. (Task 2 test `anchor picks nearest duplicate`.)
2. **The writer rewrites the anchored sentence** → the change is flagged "its passage was deleted — re-pin or remove", never silently re-pinned somewhere else. (Task 2 `anchor orphan on rewrite`.)
3. **A same-name series entry and book entry after "Different"** → mentions of that name are left out of both and reported via `bible.ambiguous`, in book and series counts alike. (Task 9 `series ambiguity`.)
4. **Two devices edit the same series Covenant** → second save gets 409 with the current copy and the existing Keep mine / Use the shelf copy / Keep both notice; nothing overwritten. (Task 8 server test + Task 9 self-check.)
5. **Long book, many changes** → `bible.editor.perf` budget still passes with 2,000 entries and 500 changes on the sample. (Task 5 extends the perf fixture.)

---

### Task 1: Entry model — new fields, quiet serialization, export/import

**Files:**
- Modify: `client/index.html` — `bibleNormalizeEntry` / `bibleNormalize` (~22874–22901), `bibleExportDoc` / `bibleImportDoc` (~23566–23625), self-checks block (~23731–24011)
- Modify: `src/housekeeping/registry.ts` (BEUK:bible block ~3099), `tests/story-bible.test.ts` (`IDS`)

**Interfaces:**
- Produces, per entry (all optional; absent when empty/default):
  - `facts: { [fieldId: string]: string }` — current values with no change attached
  - `links: Array<{ to: string /*entry id*/, label: string /*≤60*/ }>`
  - `changes: Array<{ id: string, anchor: Anchor, text: string /*≤400*/, fact?: { field: string, value: string } }>`
  - `ai: "scene" | "always" | "never"` — omitted when `"scene"` (default)
  - `scope: "book"` — omitted unless the writer marks an entry "only this book" in a series
  - `notes` keeps its key; it now holds the desk's `**bold**`/`*italic*`/heading markup (Details)
- Produces, on the Covenant: `state.bible.fields: { [type: string]: Array<{ id: string, label: string /*≤40*/ }> }` — omitted when empty
- `Anchor = { sec: string, quote: string /*≤160*/, at: number, book?: string /*manuscript id, set for series entries*/, pos?: number[] /*last resolved biblePos, refreshed whenever that book is open*/ }` (defined here, used by Tasks 2, 3, 9)

- [ ] **Step 1: Write self-check `bible.model.compat`** — asserts: (a) `serializeBook()` of the existing fixture with no new data has no `facts|links|changes|ai|scope|fields` anywhere in its JSON; (b) an entry with every new field round-trips `bibleNormalize` unchanged; (c) `ai: "scene"` is dropped, `ai: "loud"` normalizes to absent; (d) a link to a missing entry id is dropped; (e) export → import of a Covenant with every new field is deep-equal; an export file from before this change imports with the new fields absent. Register in `registry.ts`, add id to `IDS`.
- [ ] **Step 2: Run it** — `runBeukSelfChecks()` in the studio: `bible.model.compat` fails. `bash …/run-tests.sh <repo> tests/story-bible.test.ts`: fails on the missing id.
- [ ] **Step 3: Implement** normalization of the fields above in `bibleNormalizeEntry` (caps as listed; `changes` ≤ 500 per entry; `links` ≤ 100) and `fields` in `bibleNormalize`; bump the export file version and carry the new keys.
- [ ] **Step 4: Run** both — pass; all existing `bible.*` checks still pass.
- [ ] **Step 5: Commit** `feat(covenant): entry model for changes, links, facts, details, AI setting`

### Task 2: Anchors — pin a change to a passage and find it again

**Files:** Modify `client/index.html` (BEUK:bible logic block, after matching ~22944); self-checks; registry; test IDS.

**Interfaces:**
- Produces `bibleAnchorMake(secId: string, start: number, end: number): Anchor` — quote = the selected text trimmed to 160 chars, `at` = start.
- Produces `bibleAnchorFind(anchor: Anchor, sections: Section[]): { sec: string, at: number } | null` — look in `anchor.sec` first, then every body section (the passage moved); among exact matches pick the one nearest `at`; no exact match → `null` (orphan). No fuzzy matching.

- [ ] **Step 1: Self-check `bible.change.anchor`** with cases: `anchor survives an edit before it` (insert 50 chars earlier in the section → found, `at` shifted by 50); `anchor follows a moved passage` (cut to another chapter → found in the new section); `anchor picks nearest duplicate` (quote appears at 10 and 900, saved `at` 880 → 900); `anchor orphan on rewrite` (one word inside the quote changed → `null`).
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement** the two functions.
- [ ] **Step 4: Run** — passes.
- [ ] **Step 5: Commit** `feat(covenant): passage anchors for changes`

### Task 3: Story position and "Right now"

**Files:** Modify `client/index.html` (BEUK:bible logic); self-checks; registry; IDS.

**Interfaces:**
- Consumes `bibleAnchorFind`.
- Produces `biblePos(bookOrder: number, secIndex: number, at: number): number[]` — comparable tuple; `bookOrder` = `state.meta.seriesNumber` in a series (Task 7), else 0.
- Produces `bibleStateAt(entry, pos: number[], resolve: (c) => number[] | null): { now: Change | null, facts: {[field]: string}, past: Change[], later: Change[], orphans: Change[] }` — `now` = last change at or before `pos`; `facts` = `entry.facts` overlaid by each past change's `fact`, in story order; orphans never count toward `now`/`facts`. A change whose `anchor.book` is not the open book is placed by its saved `anchor.pos` (no other book is opened).
- Produces `bibleCursorPos(): number[]` — from the desk's selected section and caret.

- [ ] **Step 1: Self-check `bible.change.now`**: three changes at ch.1, ch.3, ch.5 with the cursor in ch.4 → `now` is ch.3's, `later` has ch.5's; ch.3's `fact {status: Injured}` shows in `facts` at ch.4 and not at ch.2 (facts follow the cursor); an orphaned change is in `orphans` only.
- [ ] **Step 2–4:** run (fail) → implement → run (pass).
- [ ] **Step 5: Commit** `feat(covenant): what is true at the cursor`

### Task 4: The entry card — layout A, folded

**Files:** Modify `client/index.html` — `bibleRenderEntry` (~23381), `bibleCardHtml` (~23279, the desk hover card), modal markup (~3848–3878), BEUK:bible CSS (~1661–1765), strings block (~21712).

**Interfaces:** Consumes `bibleStateAt`, `bibleCursorPos`.

Card order (spec, layout A): picture · name · type · aliases · chip `bible.asOf` ("as of {where}") → **Right now** line (`bible.nowH`, hidden when no change) → quick-fact boxes → link chips (both directions: an entry shows links *to* it with the reverse label shown as "{label} (from {name})") → folded `<details>`: `bible.storyH` "Story so far · {n} changes" (later ones greyed with `bible.later` "later, not yet true here"; orphans with `bible.orphan` "its passage was deleted — re-pin or remove"), `bible.detailsH` Details (rendered markup, editable with the desk's `wrapSelection` toolbar), existing *Where it appears*. A section with nothing in it is not rendered. The AI line is not rendered while `bibleAiAvailable()` (stub returning `false`, defined here for the BYOK project) is false. The desk hover card shows name, line and **Right now** only.

- [ ] **Step 1: Self-check `bible.card.folded`**: a fresh entry's card HTML contains none of the new section headings (byte-compare against today's markup for the same entry); with one change + one fact + one link it contains Right now, the fact, the chip, and "Story so far · 1 change"; no AI line while `bibleAiAvailable()` is false; Details renders `**x**` as `<strong>x</strong>` and escapes `<script>`.
- [ ] **Step 2–4:** fail → implement + strings ×13 → pass. Also eyeball on 8090 against the brainstorm mockup (layout A).
- [ ] **Step 5: Commit** `feat(covenant): folded entry card with Right now`

### Task 5: Marking a change in the desk

**Files:** Modify `client/index.html` — desk context menu / selection button, a keyboard shortcut (builder's choice; must not collide with existing desk shortcuts — grep `keydown` in the desk), popover, margin dots in the existing underline mirror (`bibleDeskRender`), strings; self-checks; registry; IDS; extend `bible.editor.perf` fixture.

**Interfaces:** Consumes `bibleAnchorMake`, `bibleAnchorFind`, `bibleStateAt`. Produces `bibleMarkChange(entryId: string, secId: string, start: number, end: number, text: string, fact?: {field,value}): Change`.

Flow (spec): select → menu item `bible.markFor` "Mark a change for {name}…" for each entry underlined within the selection or ±200 chars → popover (`bible.changeH` "{name}, from here on", text input, optional one-fact dropdown listing the type's fields + `bible.noFact`, `bible.pinnedTo` "Pinned to: {where}") → Save → dot in the margin mirror at the anchor (title = change text), card updates. Dots are mirror-only DOM; never in `state.sections`.

- [ ] **Step 1: Self-check `bible.change.mark`**: offered names for a selection over "Mara … Tomas" are exactly Mara and Tomas; `bibleMarkChange` stores an anchor that `bibleAnchorFind` resolves; section `content` is byte-identical before/after; `bible.notexported` snapshot unchanged with a change present. Extend `bible.editor.perf` with 500 changes across the sample and keep its existing budget.
- [ ] **Step 2–4:** fail → implement + strings ×13 → pass (including perf).
- [ ] **Step 5: Commit** `feat(covenant): mark a change from the desk`

### Task 6: Links, quick facts, templates

**Files:** Modify `client/index.html` — entry editor form (~23381), `state.bible.fields` editor, templates constant, strings; self-checks; registry; IDS.

**Interfaces:** Produces `BIBLE_TEMPLATES = { fantasy, scifi, nonfiction }`, each `{ [type]: label[] }` — starting field labels only (builder picks sensible labels; e.g. character: Age, Status, Allegiance). Produces `bibleApplyTemplate(name): void` — adds missing fields by label, never removes.

- [ ] **Step 1: Self-check `bible.links.facts`**: link Mara→House Veyl "serves" shows on both cards; deleting House Veyl removes the link from Mara (and nothing else); applying a template twice adds fields once; removing a field definition keeps entry values hidden but restorable until save-normalize drops orphan values (assert dropped after normalize).
- [ ] **Step 2–4:** fail → implement + strings ×13 → pass.
- [ ] **Step 5: Commit** `feat(covenant): links, quick facts and genre templates`

### Task 7: Number in series

**Files:** Modify `client/index.html` — book details form next to Series (`meta.series`), import/export of meta (~45594, ~45718), `applyBookDoc` arrival rule (registry line ~1249 covers "no series rides onto the next book" — keep it true for `seriesNumber`); self-check; registry; IDS.

**Interfaces:** Produces `state.meta.seriesNumber: number` (1–999, absent when blank).

- [ ] **Step 1: Self-check `bible.series.number`**: blank → no key serialized; `"3"` → `3`; `"0"`, `"x"` → absent; opening another book does not carry it over.
- [ ] **Step 2–4:** fail → implement + strings ×13 → pass.
- [ ] **Step 5: Commit** `feat(books): number in series`

### Task 8: Server — series Covenant storage

**Files:**
- Create: `migrations/018_series_covenants.sql`, `src/routes/series-covenants.ts`, `tests/series-covenants.test.ts`
- Modify: `src/app.ts` (mount after manuscripts, line ~129), `src/help/codes.ts` (conflict code), `src/housekeeping/registry.ts` if server cases are registered there
- Modify: `src/housekeeping/backup.ts` — add `series_covenants` to `BACKUP_TABLES` after `manuscripts` (FK order: it references `users`); `tests/restore-coverage.test.ts` and self-check `data.backup.tables-classified` fail otherwise

**Interfaces:**
- Table `series_covenants(id uuid pk, user_id uuid fk users on delete cascade, series_key text, name text, doc jsonb, revision int not null default 1, created_at, updated_at, unique(user_id, series_key))`.
- `seriesKey(name: string): string` — lowercase, whitespace collapsed, trimmed (exported; the client mirrors it).
- Routes under `/api/series-covenants`, signed-in only, owner-scoped: `GET /` → `{ series: [{ key, name, revision, updated_at }] }`; `GET /:key` → `{ series: { key, name, doc, revision } }` or 404; `PUT /:key` with `{ name, doc, revision }` — create when absent and `revision` omitted, else same single-statement revision check as `manuscripts` PUT: stale → 409 `{ code, series }` with current copy; missing base on an existing row → 428; `DELETE /:key` → 204.
- Body cap: reuse the manuscripts size limit.

- [ ] **Step 1: Write tests** in `tests/series-covenants.test.ts` (pattern: `tests/manuscripts.test.ts` helpers): `create then read`; `seriesKey collapses case and spaces` ("Salt  Road" and "salt road" are one row); `stale revision gets 409 with current copy`; `missing revision on existing gets 428`; `bob cannot read or write alice's series (404)`; `signed out gets 401`; `invalid JSON body gets 400`.
- [ ] **Step 2: Run** `bash /c/Users/vikra/Projects/beuk-final/run-tests.sh /c/Users/vikra/Projects/beuk-final/beuk-saas tests/series-covenants.test.ts` → fail.
- [ ] **Step 3: Implement** migration + routes.
- [ ] **Step 4: Run** the file → pass; then the full suite → `# fail 0`.
- [ ] **Step 5: Commit** `feat(server): series Covenant storage with revisions`

### Task 9: Client — joining, merging and using a series Covenant

**Files:** Modify `client/index.html` — BEUK:bible logic (series store + sync), card (scope option), list view, mentions/heatmap, conflict notice reuse, strings; self-checks; registry; IDS; privacy inventory row if the doc lists stored data (`docs/privacy-inventory.md`).

**Interfaces:**
- Consumes Task 8 routes, `seriesKey`, `state.meta.seriesNumber`.
- Produces `bibleSeries: { key, name, doc: { entries, fields }, revision } | null` (in memory, cached in IndexedDB beside the book for offline; edits queue like book saves).
- Produces `bibleAllEntries(): Entry[]` — series entries + book entries with `scope:"book"` or not in the series; the single source for matching, card, list and AI later. `bibleEntries()` callers that render/match switch to it.
- Produces per-book saved counts for series-wide heatmaps: `state.bible.counts: { [entryId]: number[] }` — written only when the book is in a series.

Behaviour (spec): signed out → series area shows `bible.seriesSignIn` only. Signed in, ≥2 shelf books whose `seriesKey(meta.series)` match and no series row → one card `bible.joinOffer` "{n} books share “{name}”. Share one Covenant?" (dismissable; nothing changes until Yes). Yes → merge screen listing same-name entries across those books with **Same in both / Different** (default: none chosen; Save disabled until each is answered); Same merges (aliases/tags/links/changes unioned, facts kept by field with the newer value, conflicts shown); Different keeps both. New entries in a series book go to the series; "Only this book" in the folded section sets `scope:"book"`. Clearing/changing a book's Series asks, then copies the series entries that book mentions into the book. Renaming the series asks "rename for all {n} books?". 409 → existing conflict notice.

- [ ] **Step 1: Self-checks** — `bible.series.join` (offer appears only signed in with ≥2 matching books and no row; nothing written before Yes); `bible.series.merge` (Same unions aliases/changes without duplicates; Different leaves two entries; Save disabled until all answered); `series ambiguity` case inside `bible.series.merge` (two "Charles" in scope → mention counted for neither and `bible.ambiguous` reported); `bible.series.leave` (clearing Series copies mentioned entries back, the book's untouched entries stay; deleting a series book turns changes with that `anchor.book` into orphans, never removes them); `bible.series.crossbook` (in Book 7, a change pinned in Book 5 shows in Right now from its saved `pos`); `bible.series.conflict` (simulated 409 routes to the conflict notice, local edits kept).
- [ ] **Step 2–4:** fail → implement + strings ×13 → pass; manual on 8090 with two signed-in books sharing a series, plus a second browser to force a 409.
- [ ] **Step 5: Commit** `feat(covenant): shared series Covenant`

### Task 10: Close-out

**Files:** `CHANGELOG.md`, `docs/roadmap.md`, `README.md` (Covenant section, if it documents fields), `content/help/*` if Covenant help exists.

- [ ] **Step 1:** Full suite: `bash /c/Users/vikra/Projects/beuk-final/run-tests.sh /c/Users/vikra/Projects/beuk-final/beuk-saas` → `TSC_OK`, `# fail 0`.
- [ ] **Step 2:** Studio: `runBeukSelfChecks().filter(r => !r.pass)` → `[]` on 8090 (rebuild the app image first: Task 8 changed `src/`).
- [ ] **Step 3:** Changelog entry + roadmap line; scrub `bash C:/Users/vikra/.claude/scrub/scrub-check.sh /c/Users/vikra/Projects/beuk-final/beuk-saas` → only the accepted items.
- [ ] **Step 4: Commit** `docs: Covenant release notes`
