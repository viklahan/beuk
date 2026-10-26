# Beuk — Changelog

What changed, in the order writers met it. Every entry exists because
someone asked, in so many words, for the book on their desk to be easier
to make well.

## 2026-10-26 — Saves that overlap never cry conflict

- **No false "This book changed in two places".** For signed-in writers:
  a save whose answer arrived after the desk had moved on (another shelf
  book opened meanwhile, or the studio's own self-checks running) could
  leave a wrong note of when the shelf last changed, and the next check
  with the shelf then opened the notice for a book that had changed in
  one place only — after which the shelf line could stay on "Saving to
  your shelf…" until a reload. Each save's answer now lands only on the
  book it was sent for, the studio trusts the shelf's own revision number
  over that note, and it quietly agrees when the shelf already holds
  exactly the book on your desk. "Saving…" always settles. A book really
  changed on another device still gets the notice, as before.

## 2026-10-26 — Your book arrives with its name

- **Importing a document brings its title in.** A Word file with an
  empty title property used to land as "Untitled Book", and its title
  page became a "Dedication". Beuk now reads the manuscript's own title
  page — the title, a subtitle, a "by Jane Doe" line — and makes it the
  book's credit, lifting those lines out of the text. Nothing like a
  title page? The cleaned file name is used ("long-way-home_final v3
  (1).docx" becomes "long way home"). The import report says where each
  detail came from, and every step can be undone.
- **Your own title is never overwritten.** A title (or author or
  subtitle) you typed in Project Settings or on the Title Page / Copyright
  page stays when you import a new draft; the report tells you what
  the document calls itself and offers a one-click "Use" instead. A title
  that only came from an earlier import is replaced by the next one.
- **"Untitled Book" is no longer saved as a title.** Saving Project
  Settings with a blank title keeps it blank, so the next import can fill
  it.
- **The Cover maker starts from your book.** Title, subtitle, author and
  series are filled in for you, and the photo search starts from the
  title. A cover you saved earlier follows your book's new title too —
  anything you typed in the maker yourself stays as you wrote it.

## 2026-10-26 — Your address stays with us

- **No more Google Fonts.** Every typeface in the studio, Help, the
  support and thank-you pages now comes from beuk.studio itself — the same
  22 families, weights and styles as before, byte for byte the same font
  files, so the studio sets type exactly as it did. Opening Beuk no longer
  tells Google your IP address, and the site's Content-Security-Policy no
  longer allows the Google font hosts at all, so it cannot happen by
  accident later. Faces you have seen are still kept for offline use.

## 2026-10-26 — No false "changed in two places", and counts that read right

- **Reloading right after a save no longer cries conflict.** For writers
  who refresh the page the moment the shelf says "On your shelf ✓": a
  reload in the split second after a shelf save could open the "This
  book changed in two places" notice for a book that had changed in one.
  The device now notes the shelf's new revision the moment the save
  lands. A book that really was changed on another device in between
  still gets the notice, as before.
- **Counts in every language's own grammar.** "1 word", "~1 page" (not
  "1 words", "~1 pages") in the sidebar, under the editor and in Zen;
  Polish, Russian and Arabic now use their own forms for the numbers
  that need them (for example 5 słów, 22 слова, 3 كلمات).
- **Changing the interface language changes everything at once.** The
  Sign in button and the preview desk's page counts used to stay in the
  old language until a reload.
- **The sample's numbers are true.** The Load button gives the sample's
  real word count (24,828), not a round 25,000, and while the sample is
  open its note follows your edits.
- **Restoring over an empty desk keeps your History intact.** With
  nothing on the desk there is nothing to keep, so no safety snapshot
  is taken — and none of your real automatic snapshots is pushed out to
  make room. The confirmation says so.

## 2026-10-25 — What Beuk keeps, in plain words

- **A privacy page and the terms.** `/privacy` says what Beuk keeps,
  where, for how long, who else sees any of it, and what you can do
  about it.
  `/terms` sets out the ground rules: your writing stays yours, the
  studio is free, keep your own copies. Both were written from what
  the software actually does, and both say plainly what isn't there
  yet, such as a button to delete your account (for now, you ask by
  email). Until the operator's details are filled in, the pages say
  that part is still being completed rather than guessing. Linked from
  Help, the thank-you page, reading copies and the studio's sign-in
  dialog.

## 2026-10-25 — The day turns as you write

- **Zen keeps you company through the day.** For writers who stay a
  while: the harbour behind the page now moves from a cool dawn through
  a bright midday to a golden afternoon and a soft dusk over about an
  hour and a half of writing — in Candlelight, from dusk into a quiet
  moonlit night as the stars come out one by one. It changes too slowly
  to notice from one moment to the next, shows no clock and no numbers,
  and it never goes dark on you: once it reaches dusk it stays there.
  Only time in Zen counts; step out and back in and the day carries on,
  and a fresh visit starts at dawn. With reduced motion nothing moves —
  the light just changes, rarely and softly.
- **The little reader on the shore is gone.** The harbour, the water and
  the reeds stay.

## 2026-10-25 — Rain and wind you may build a business on

- **New rain and wind in Zen.** For writers who listen while they work,
  and for Beuk itself: the rain and wind recordings carried a
  public-domain *label* rather than their recordists' own release, which
  is not safe ground for a product people pay for. Rain is now a steady
  rain recorded and given away under CC0 by Kresiek The Furry; wind is
  our own: rendered by a computer for Beuk, modelled on how gusts and
  leaves sound (not a recording), and given away under CC0 too. Waves
  are unchanged. Your choice of scene is kept; once your studio updates,
  the old files are cleared from your browser and the new ones download
  the first time you play them (about 1 MB each), then work offline.

## 2026-10-25 — Help you can search, and codes that lead somewhere

- **Search the help shelf, or paste the message.** For writers who were
  handed a wall of machine text by a store or by EPUBCheck: paste the
  whole thing into Help and every code in it (RSC-005, OPF-085, a 429…)
  is looked up at once; ordinary words search the guides, and a
  misspelt word can still find its page. Searches are logged as the words and the
  number of results only — never who searched.
- **The error dictionary.** Every failure Beuk knows about now has a
  BEUK- code with a page of its own: what you might see, what happened
  in plain terms, and a checklist. The structural validator shows the
  code on every line that is not a pass, and server EPUBCheck results
  carry it too. The decoder's "present but undeclared" message was
  labelled RSC-009; EPUBCheck calls it RSC-008, and now so do we.
- **Guides with the file beside them.** On a wide screen each guide
  step can show the part of the file or the result it talks about —
  real excerpts from the sample book, labelled as such. Two new guides:
  saving and conflicts between devices, and beta-reader share links.
  Help follows your Paper or Candlelight choice from the studio.
- **No promises we can't keep.** The support address, name and reply
  time appear only once the mailbox is set up; until then Help (and the
  thank-you page after an export) names no one and promises nothing.
  The shelf status at the top of Help says "All's well" only when
  everything behind it was checked and passed; otherwise it says
  plainly what isn't installed or hasn't run yet.

## 2026-10-25 — Opening a shelf book asks before it replaces yours

- **Your only copy is never swapped out without a question.** For
  writers who keep a book on one device: opening a book from your shelf
  used to replace a book that had never been put on the shelf — with no
  question and no copy in History — whenever you had not typed in it
  since the page loaded. Now, whenever the book on your desk exists only
  on this device (or has writing your shelf has not seen yet), Beuk
  asks first: **Keep my book** (the default), **Put it on my shelf, then
  open**, or **Open and replace it**, stacked with the safe choice on
  top. If putting it on the shelf fails, nothing is replaced. Every
  other confirmation still shows just its two buttons.
- **"Restore the whole book" keeps its promise.** Its confirmation says
  a snapshot of the book as it is now is taken first. That was not true
  when the desk held the untouched sample story; it now always is.
- The new words ship in all 13 languages; the 12 translations have not
  yet been checked by native speakers.

## 2026-10-25 — Zen sounds like the real thing

- **Real rain, waves and wind.** For writers who use Zen's ambient
  sound: the old sound was made by the computer and, as one writer put
  it, sounded like someone blowing air. It is now three real
  recordings — gentle rain on banana leaves, soft waves on a lake shore,
  and wind in an old willow — each given to the public domain by the
  person who recorded it (named in the credits). They loop without a
  seam. “Rain & slow drum” is gone; if you had picked it, Zen starts on
  rain. Each sound downloads the first time you play it (about 1 MB) and
  then works offline. If it cannot load, the sound menu says so instead
  of pretending to play. The new words in 12 languages have not yet been
  checked by native speakers.

## 2026-10-25 — A calmer sidebar, and the sample's own name everywhere

- **A save pill that fits.** For writers who found the header crowded:
  the "Saved on this device" pill is now a dot and a word or two —
  Saved ✓, Saving…, Saved · back up, Not saved. Warnings keep their
  colour and a "!"; the full sentence is in its tooltip and one click
  away in its popover.
- **One Import, one Project Settings.** They live at the top of the
  sidebar (on phones, in the Structure tab); the header no longer
  repeats them as icons.
- **More of your outline at once.** Story Insights, Goals, History and
  Reader comments sit in one small row; the statistics fold behind a
  one-line summary; Front Matter, Body and Back Matter each fold with a
  count. The section you are editing is never folded away. At a laptop
  size the outline now shows about three times as many sections.
- **The sample is The Lantern Coast everywhere.** A browser or shelf
  that saved the sample before its rename still showed the old title —
  on the desk, the hardback and the preview. The next time that copy
  opens, it is put in History ("Before sample update") and the current
  sample takes its place; restoring it gives the old text back word for
  word. The sample's own cover picture still carried the old title too;
  it is re-lettered. The new words in 12 languages have not yet been
  checked by native speakers.

## 2026-10-25 — Older books get a proper ID

- **Older books, clean exports.** For writers whose books date from
  before Beuk gave every book a real ID: EPUBCheck warned about their
  identifier (OPF-085). The first time such a book opens, it now gets a
  proper ID on its own. Every device works out the same new ID, and
  the old one is kept, so your shelf still knows it is the same book and
  never makes a copy. History saves a "Before book ID update" snapshot
  first. Nothing else in the book changes. The new words in 12 languages
  have not yet been checked by native speakers.

## 2026-10-24 — Your book as a hardback

- **Hardcover in the preview.** For writers who want to see the printed
  book, not just the e-reader: the preview bar has a Hardcover device. A
  small hardback sits on the desk wearing your cover (dust-jacket gloss,
  case-laminate print, or a cloth board stamped with the title when there
  is no cover art yet), its size following your print trim. Look over its
  head and you see the cream page block sitting just inside the boards,
  the way a real case overhangs its pages. Tap it and it
  opens to real spreads from the print layout — the same pages the Print
  Interior View shows, with running heads, folios and endpapers. (The
  exported PDF does not yet paginate exactly like the Print Interior
  View; that gap predates this feature.) Turn
  pages with the buttons, arrow keys or a swipe; it opens on the chapter
  you are editing, and there is a full-screen button for reading a spread
  at size. The new words in 12 languages have not yet been checked by
  native speakers.

## 2026-10-24 — A way back into your shelf

- **Forgot password.** For writers locked out of their own shelf: the
  sign-in dialog now has "Forgot password?" — a link arrives by email,
  works once, for an hour, and signs every device out when you use it.
  If the server can't send email yet, the studio says so plainly
  instead of promising a message that won't come.
- **Change password, sign out everywhere.** For writers who signed in
  on a borrowed laptop: both live under "Account & security" in your
  shelf.

## 2026-10-24 — Your book is saved on this device

- **Saved on this device, always.** For writers who lost an afternoon to
  a browser crash: the studio now saves the book in your browser every
  time you pause, signed in or not, online or not — and the header says
  so plainly, or says plainly when it can't. One click exports a backup
  file you can open again.
- **Two devices, no silent overwrites.** For writers who work on a
  laptop and a desktop: if the shelf copy changed elsewhere, Beuk asks
  — keep mine, use the shelf copy, or keep both — instead of letting
  one device quietly replace the other.
  On a slow connection your own saves queue one behind the other, so
  the notice only appears when the book really did change elsewhere.
- **Works offline, including Word import.** The studio's own libraries
  now ship with it, so it opens and imports .docx without a connection.

## 2026-10-22 — The warmth surfaces

- **A help reading room.** For writers who said a manual written like
  a spec sheet is no help at all: short guides shaped around one task
  each, an EPUB error decoder that translates store rejections into
  human language, and a named human at the end of the support address,
  with a stated reply time.
- **The Founders' Shelf.** For the first writers who'll shape what
  Beuk becomes: a small, private seed list — deliberately not a public
  community. A quiet room with twenty writers beats an empty hall.
- **A public status line, changelog, and roadmap.** For writers who
  asked "is it down, or is it me?" and "what's coming?" — now there's
  somewhere to look, and it's kept honest.
- **A tip jar by the door.** For readers who asked how to say thanks:
  a Ko-fi link at the foot of Help and after an export, framed as
  supporting the maker. Entirely optional, always.

## 2026-10-22 — The seven features writers asked Vellum and Atticus for

- **Covers, properly declared.** For writers whose books arrived at
  stores faceless: upload a cover and the EPUB carries it with a real
  cover page and a navigation landmark, the way catalogues expect.
- **One-click store presets.** For writers tired of re-learning each
  store's packaging rules: Generic, Amazon KDP, Apple Books, Kobo,
  Nook, and Draft2Digital editions of the same book, filenames labelled
  so they never get mixed up. Identifiers stay honest — your ISBN if
  you have one, never an invented store ID.
- **Footnotes, endnotes, and images.** For writers of history,
  memoir, and everything with apparatus: notes that link both ways,
  an image library with alt text, and full-bleed pictures.
- **Box sets and a Word export.** For series writers: several books
  bound into one omnibus volume with a unified contents — and a clean
  .docx of any manuscript, for the editors who live in Word.
- **A real font and theme library.** For writers who could see their
  book in their head but not in the tool: seventeen book typefaces and
  fifteen named full-book themes, one click to apply, every detail
  still overridable.
- **Print interiors.** For writers whose readers asked for paper:
  paperback pages in six trim sizes, mirrored gutters that grow with
  the page count, running heads and page numbers — labelled honestly
  as print-ready interiors, with true PDF/X conversion reserved for
  the server phase.
- **A structural validator.** For writers burned by a store rejecting
  a file at midnight: thirteen plain-language checks over the exact
  package you'll ship, before it leaves your desk. Labelled honestly
  as structural checks — the full EPUBCheck suite belongs to the
  server phase, and Beuk says so on the panel itself.

## 2026-10-22 — The studio, whole

- **Beuk itself.** For writers who wanted Vellum's polish without the
  Mac-only door, and Atticus's reach without the ceremony: a
  browser-based typesetting studio — three-tier manuscript
  architecture, a smart sanitizer for Word documents, device previews
  from Kindle to iPad, a forgiving daily streak, zero-warning EPUB 3.2
  packaging with navigation landmarks and an NCX fallback, Markdown
  and HTML exports, and an Archive Package Inspector that shows you
  exactly what a store will receive.
- **Paper and Candlelight.** For writers who work at kitchen tables
  and at 1 a.m.: two themes, one warm parchment, one lamplit, because
  the room you write in matters.
