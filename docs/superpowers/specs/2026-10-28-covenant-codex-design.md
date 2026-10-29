# Covenant, grown up — design

_2026-10-28. Decided with V in conversation; mockups in the brainstorm session (layout A chosen)._

## Intent

Writers of long books and series lose track of their own threads: who
knows what, who is hurt, who serves whom, by book 5. Novelcrafter's Codex
answers this for its users. Beuk's Covenant already does the half of it
that needs no AI (entries, aliases, whole-word mention tracking, heatmap,
underlines in the desk). This project adds the other half so the Covenant
is a full Codex replacement — and so that the BYOK AI work that follows
(a separate project) has a source of truth to feed the model.

The Covenant stays the writer's tool first: everything here is useful with
no AI connected.

## Goals

All six, in one project (V: "why not all of them"):

1. **Progressions ("changes")** — facts about an entry pinned to a point in
   the story; the entry shows what is true *at the cursor*.
2. **Series Covenant** — one Covenant shared by every book of a series.
3. **Links** between entries, with a short label, shown from both ends.
4. **Quick facts** — writer-defined fields per type, with genre starter
   templates (fantasy, sci-fi, non-fiction).
5. **Rich-text details** — the notes box becomes formatted text.
6. **AI context setting** per entry — *send when in the scene* (default),
   *always send*, *never send*. Stored now; inert and hidden until a key
   exists (BYOK project).

## Non-goals

- No AI in the Covenant itself. No extraction, no generated summaries.
- No automatic continuity checking ("Mara walks in ch. 14 but is injured")
  — V said it's optional; not this round.
- No change to exports: the Covenant still never reaches EPUB, print or Word.
- BYOK AI, the "Ask your book" panel, and the CSP question (any-address
  vs per-writer addresses) belong to the next project.

## Anti-goals (failure even if it works)

- **A writer feels lost.** V's bar: "simple, user friendly, quick,
  intuitive." A new entry must look exactly like today's; facts, links,
  changes appear only once the writer adds one. Empty sections don't render.
- **Anything merges, moves or disappears without the writer saying so.**
  Same-name entries are never auto-merged (Charles I ≠ Charles IX). A change
  whose passage is deleted is flagged, never dropped.
- **An old book changes.** A book with no new data must serialize byte-for-
  byte as before (the existing `bibleHas()` rule extends to every new field).

## The writer's experience (as decided)

### The entry card — layout A, "one card, folded"

Top to bottom:

- picture, name, type, aliases; a chip **"as of Book 5 · ch. 20"** (where the
  cursor is)
- **Right now:** the latest change at or before the cursor
- quick facts as small labelled boxes; links as chips
- folded: *Story so far · N changes* (timeline; changes after the cursor
  are shown greyed "later, not yet true here", never hidden), *Details*
  (rich text), *Where it appears* (existing heatmap, series-wide when in a series)
- one line: **AI:** dropdown — hidden until a key is added

Tabs (layout B) were rejected: the writer has to know where to look.

### Marking a change

1. Select text in the desk → right-click / the small Covenant button /
   a keyboard shortcut (Novelcrafter's `>>` is the speed bar to match) →
   **"Mark a change for Mara…"**. Offered names = entries underlined in or
   near the selection.
2. A small popover: what changed, in the writer's words; optionally update
   one quick fact (Status → Injured). Shows "Pinned to: Book 5 · ch. 12 · "…""
3. Save. A small dot sits in the desk margin; "Right now" updates.

Rules: the change moves with its text through edits and chapter moves; if
its passage is deleted it shows "its passage was deleted — re-pin or
remove"; margin dots never print or export.

### Series

- A book joins a series through its existing **Series** field
  (`state.meta.series`, free text today). The series needs an **order**: add a
  "number in series" field next to it.
- On joining, same-name entries across the series' books are offered for
  merge with the **Same in both / Different** choice from the shelf mockup.
  Nothing merges until the writer chooses. Book-only entries stay in their book.
- In a series, "Right now" and "Story so far" read across books in series
  order: open Book 7 and Mara's Book 5 injury and Book 6 recovery are known.

### V's answers to the builder check

- **Signed out:** changes, links, facts, rich text and the AI setting all
  work on the single book with no account. Only the **series Covenant needs
  sign-in** (free account), said in one line where it would appear. No
  local multi-book store is built.
- **New entries in a series go to the series by default.** The new-entry
  form stays exactly as today; "only this book" is a small option in the
  entry's folded section.
- **No auto-join.** When books' Series names match (case and spacing
  ignored), Beuk shows one card — "3 books share 'Salt Road'. Share one
  Covenant?" — and nothing changes until the writer says yes. Then the
  same/different merge runs.

## Constraints (from the codebase)

- Covenant today: `client/index.html` `BEUK:bible` block. Entry shape in
  `bibleNormalizeEntry` (id, type ∈ character/place/thing/group/lore, name,
  aliases, description ≤400, notes ≤20000, imageId, tags, exactCase,
  exclude). `BIBLE_MAX = 2000`. Stored on the book as `state.bible`,
  serialized only when non-empty.
- Books are whole-JSON rows in `manuscripts` with optimistic concurrency
  (`revision`, 409 → Keep mine / Use the shelf copy / Keep both). Anything
  shared across books needs the same protection.
- Matching rules (whole words, any script, possessive/plural in English,
  exact case, exclusions) are unchanged and reused for series-wide counts.
- Self-checks and `src/housekeeping/registry.ts` entries accompany every
  behaviour (house rule); existing `bible.series.roundtrip` must keep passing.
- i18n: every string in all shipped languages, as today.
- Rename sweep: user-facing word is **Covenant**; code keeps `bible`.
- Commit as you go; no push without a clean scrub and V's go.

## My calls (not V's — flag if wrong)

- **Change anchor = passage**, not scene/chapter: section id + a short text
  quote with offset, re-found by quote when the text moves; finer than
  Novelcrafter's scene-level additions.
- **Series Covenant lives server-side** in its own row (owner + series
  key), with a `revision` like manuscripts, so two books open on two
  devices can't silently overwrite it. Books keep their own `state.bible`
  for book-only entries. Offline: edits queue like book saves.
- **Series key** = normalized series name per owner; renaming a series in
  one book asks whether to rename it for all.
- **Templates** are starting field sets only; the writer can edit/remove.
- **Rich text** reuses the desk's editing rather than a new editor.
- **Covenant export/import** (existing) is extended to carry the new fields;
  older files import with the new fields empty.
- **Two same-name entries in scope** (after a "Different" choice): the
  existing ambiguity rule applies — a mention that matches two entries is
  left out of both and reported ("bible.ambiguous"); the writer separates
  them with aliases / exclusions as today. Matcher unchanged.
- **Quick facts follow the cursor**, like "Right now": a change that updates
  a fact makes the fact a history; going back to ch. 3 shows the earlier
  value. One rule for the whole card.
- **Field definitions** live with the Covenant they belong to: the book's,
  or the series' once joined. On join, same-name fields merge; others are kept.
- **Leaving / deleting:** clearing or changing a book's Series asks first and
  copies the series entries that book mentions into the book; the series
  row lives while any book names it; deleting a book flags (never drops)
  changes pinned in it as "its passage was deleted".

## Left to the builder

- Exact storage shape of changes, links and facts inside an entry.
- How the quote anchor is re-found and when a change counts as orphaned.
- Server route and migration for the series Covenant; conflict UI reuse.
- How series-wide mention counts are computed without opening every book
  (precomputed per-book counts saved with each book is one way).
- Keyboard shortcut choice; margin-dot styling within the studio tokens.
- Ordering of the work into commits.
