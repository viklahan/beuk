# Beuk — Changelog

What changed, in the order writers met it. Every entry exists because
someone asked, in so many words, for the book on their desk to be easier
to make well.

## 2026-11-28 — Advance review copies

- **An ARC campaign on a book.** In the 2.0 studio's ARC panel you start a campaign for a book: up to 50 readers, a signup link you can share, and a launch date. Closing it, or passing its close date, stops new sign-ups. Copies already given keep opening.
- **Code-confirmed claims.** A reader opens the signup link, gives a name and an email, and types the six-digit code Beuk mails to that address. Only then do they get a copy. In approval mode they also give a profile link, and you approve or decline each one; nobody is asked to review the book, and the page says so.
- **Each reader's own copy.** Every reader gets a copy page and a download that carries their name in the copyright line and their id in the file, stamped at each download and never stored. A reader who lost the link claims again and gets a new link; the old one stops. After sign-ups close, nobody can ask for a new link: the answer is the same for every address.
- **Not me and Stop.** Every reader email carries Not me ("this was not me") and "No more email from" this author. Both leave a hashed opt-out that holds across every writer, so that address is never mailed again by an ARC campaign.
- **Your panel.** The ARC panel shows your link, every campaign of the book, each reader's state and, for an ended campaign, a summary. Final acts ask first. A new signup link kills the old one.
- **Own sender.** ARC mail comes from readers@beuk.studio through its own transport: it needs ARC_SMTP_URL and ARC_MAIL_FROM. ARC_SUPPRESSION_SALT, at least 32 characters, keeps the opt-out hashes and mail links; it is kept outside backups and never changed. With ARC mail not set up, ARC stays off.
- **Database.** Migration 031 adds the ARC tables. A backup made before it is refused by restore after it.
- **15 languages.** The reader pages and emails come in all 15 interface languages. The English is Claude's; the 14 others are unsigned drafts, not read by a native speaker. The privacy page now states the basis for ARC data (legitimate interests, Art. 6(1)(f)).
- **Not verified.** The live panel in a browser, whether real mail clients' one-click unsubscribe buttons work with these emails, and real delivery through Resend. The tests use fake mail and a fake clock.

## 2026-11-27 — The studio in हिन्दी and मराठी

- **Two more interface languages.** The language menu now offers हिन्दी (Hindi) and मराठी (Marathi), so the studio comes in 15 languages. The studio's own menus, buttons and messages follow the language you pick, and the back-matter starter texts (About the Author, Acknowledgements and the rest) come in both too. Your book's own language is not changed by the choice.
- **Marathi books.** Marathi is now a book language, so Beuk has 37, and Dictation lists Marathi among its languages. When you import a manuscript in Devanagari, the studio tells Marathi from Hindi by their commonest words, and when it is not sure it says Hindi, as it always did. You can always set the language by hand in Project Settings.
- **Drafts, not yet read.** Every Hindi and Marathi string is a draft. None has been read by a native speaker yet, and each will be checked and signed off before it counts as final.

## 2026-11-27 — A letter typed at the same moment is kept

- **A letter you type at that moment is kept.** When the same chapter is open in two tabs and one of them joins your paragraph with the one above, turns it into a heading, or splits it, at the very moment you type a letter in the other, that letter used to be lost, or left behind in the line before, and the letters you typed next went after it. Now it is put back between the words you typed it between, and your next letters follow it.
- **A paragraph deleted while you typed in it.** If the other tab deletes the whole paragraph at that same moment, before it has seen what you typed, your letters come back as a paragraph of their own where the deleted one stood. The other tab sees them and can remove them.
- **Only what you typed.** The studio puts back only your own letters, only when the other tab's change shows it never had them, and only where their words still stand. What the other tab had seen and deleted stays deleted, and when the studio can count letters you typed that could not be put back, a quiet message says how many.

## 2026-11-26 — Move and zoom the cover picture

- **Your own picture can move.** In the cover maker, a picture you bring as the cover's art, or a stock photo, used to sit centred, with its edges cut off equally on both sides, and nothing could change that. Now drag the picture on the cover, anywhere away from the text, to choose what shows. Picture — across and Picture — down do the same from the keyboard.
- **And zoom.** Picture — zoom goes from 100%, where the picture just fills the cover as before, up to 300%. However far you move or zoom it, the picture always fills the cover, so no gap can show at an edge.
- **Everywhere the cover goes.** The placement is kept with the cover and used wherever the front cover is drawn: the e-book and print cover downloads, Use as My Cover, the front of the print wrap, the hardcover and the book on the stand. The back and spine of the wrap keep the picture centred, as before.
- **Sharpness.** Zoom spreads fewer of the picture's pixels over the cover. When that takes the print cover under 200 pixels per inch, one line under the sliders says so, with the number. It never stops you. The store check's cover artwork row now counts the zoom too.
- **Reset picture** puts it back in the centre at 100%. A different picture starts centred. Covers made before this look exactly as they did.

## 2026-11-26 — Your caret stays where you put it

- **Two tabs on one book no longer move your caret.** When the same chapter was open in two tabs and one of them pressed Enter for a new paragraph before your caret, turned your paragraph into a heading (or undid that), or joined it with the paragraph above, the caret in the other tab jumped away, to the end of the paragraph or into the line before, and the next letters landed there. It now stays between the same letters.
## 2026-11-24 — One chapter's settings on every chapter

- **Use on every chapter.** A chapter's settings now end with a button, Use on every chapter. It copies that chapter's backdrop (the picture and its strength together), its drop cap, its small-caps lead-in or the fit of its plate to every other chapter in one step. You tick what to copy; nothing is ticked for you.
- **It says what would change first.** Each setting shows this chapter's value and the exact number of other chapters that would change. Every chapter means every section in the body of the book except Part dividers, and chapters left out of the export are included. Front and back matter are never changed, the fit goes only to chapters that have a plate, and no text is touched.
- **Getting the old settings back.** The chapters that change lose the setting they had. The message that follows offers Undo for ten seconds, and a snapshot named "Before a chapter change" is saved in History first. Restoring from a snapshot also brings back the text as it was then.
- **Poems are left as they are.** A poem takes no drop cap and no lead-in, so those two are never copied onto a poem and are not offered when the chapter you copy from is a poem. The count then says how many of the chapters that are not poems would change. A backdrop and a plate's fit are copied to a poem as to any chapter.
- Not copied, on purpose: a chapter's number, title, subtitle and running head, its plate picture and alt text, and scene pictures. Each of those describes one chapter.

## 2026-11-24 — Poem Mode

- **A chapter can be a poem.** A reader aged ten asked for this one. In the editor, the P button at the start of the toolbar turns Poem Mode on for the chapter you have open. Every new line you type is a line of the poem, and a blank line starts a new stanza.
- **Centred or left.** A new poem is centred, each line on its own centre. Choose Left and the lines range left; a line too long for the page turns over, and its turn-over is set in a little, so it still reads as one line. On your desk and in print a left poem stands in the middle of the page as a block; in an e-book it starts at the margin.
- **Your words are not changed.** Poem Mode changes how a chapter is read, never its text. Switch it off and the chapter is prose again, exactly as it was. Switch it on again and the poem is back.
- **The book follows.** The preview, the EPUB, the print pages and the Word file set the poem line for line and stanza for stanza. A poem takes no drop cap, is never justified, and its lines are never hyphenated.
- **A place to start.** An empty poem shows three lines that say how it works. They are a hint and never part of your book, and they go with the first letter you type.
- Two things it does not do yet. A Markdown file keeps a poem's lines but does not say that the chapter is a poem. A poem taken out as an EPUB and brought back arrives as a verse block inside an ordinary chapter.

## 2026-11-24 — The whole book before you export, and a shorter Export

- **Read the whole book before you export it.** Export now opens with an offer. Read the whole book on screen shows the book from its first page to its last in one scrolling view. Turn the print pages opens the Print Interior View, and closing it brings you back to Export. It is an offer: every export works without it.
- **What the reading view is.** It is the page Standalone HTML downloads: the same sections, notes and pictures as the EPUB, in the same order, with the same stylesheet. It is not the EPUB itself. An e-reader shows the book as pages with its own contents menu, the EPUB sets a full-page picture on a page of its own, and the EPUB carries its heading faces and the faces for scripts such as Devanagari and Arabic, where this view uses the fonts your device has. Links inside the book work there, a note and its way back; links that leave the book are off.
- **Export is shorter.** The formats now stand in six groups: E-book (EPUB), Print, Manuscript and other files, Audiobook script, Box set, and Archive and sharing. Only the group you open is shown. Store-ready? and Close are always in view. Nothing was removed, and no export makes a different file than before.
- Help and the School lessons that walk through Export now name the group to open.

## 2026-11-14 — Imports that keep their cover and stay out of your way

- **An EPUB arrives with its cover.** Importing an EPUB used to leave its cover behind, even one Beuk had made itself, so a book you took out and brought back came in bare. The cover the EPUB declares now becomes your book's cover (JPG or PNG).
- **Bulk import runs in the background.** Importing a folder of books used to redraw your shelf after every book, right above the import panel, so the list kept moving while you were asked to review it. The shelf now holds still while the batch runs and is drawn once when it is done. A small status chip outside the shelf shows how the import is going, so you can close the shelf and keep writing; when the batch is done it offers to open the shelf, and you can dismiss it at any time.
- **Big illustrated books build on the server.** The store-ready EPUB and the cover wrap are built on Beuk's server, and a richly illustrated book could be turned away as too large before the build even began: one with 148 pictures, for example. Those builds now have a limit of their own, set by what the server can really build, instead of borrowing the smaller one your shelf uses.
- **The Ramp says what you are looking at.** The Ramp now says plainly that it shows a few pages from each book, not the whole of any: a handful of spreads chosen to show the range. Help's header has a new Showcase link that takes you there.

## 2026-11-10 — Locked manuscripts open

- **A manuscript with a password opens.** Import a Word file or a PDF that is locked with a password, and Beuk now asks for the password instead of failing to read the file. It works in Import, Bulk import and Add a Book for box sets, and the file is unlocked in your browser.
- **Cancel changes nothing.** Cancel the question and your book stays as it was; Bulk import marks that file "locked", and a box set leaves that volume out. A Word file locked with an older kind of protection says so.

## 2026-11-09 — Two-step sign-in, and a record of what left the studio

**Two-step sign-in**
- **A code after your password.** Turn on two-step sign-in on your account page and Beuk asks, after your password, for a code from your authenticator app, or one of your 10 recovery codes. The studio's sign-in asks for it too.
- **See where you are signed in.** Your account page lists your sign-ins, each with a short device label such as "Firefox on Windows" and when it was last active, so you can sign out a device you don't recognise.
- **Security emails.** When this server can send email, Beuk tells you when your account is signed in to from a device none of your other sign-ins has used, when two-step sign-in is turned on or off, when a recovery code is used, and when new recovery codes are made.
- Download all my data now includes whether two-step sign-in is on, how many recovery codes are left, and your sign-ins with their labels and dates. It never includes your key or your codes.

**Your authorship record**
- **Lock a backup with a password.** Export a backup can now lock the file. The locking happens in your browser: the password never leaves your device, and Beuk can't open the file without it.
- **A backup says whether it was changed.** Open a backup and Beuk tells you whether it is untouched since it was exported: `Backup opened — "Your title". Untouched since …`. If the file was changed since, Beuk asks before opening it, and No leaves your desk exactly as it was. Older backups open as they always did.
- **A dated stamp for every copy that leaves.** Signed in, each backup you export and each Word file you download leaves a small stamp on your account: a fingerprint of exactly that version of the book, its title, the kind of file and the time. It never holds your text. Your authorship record lists your stamps and the named readers you have shared with, and only you can see it.
- Export a backup now makes one file per click, however quickly you press it.

## 2026-11-08 — A reading link for each reader

- **Named reading links.** Each reading copy in Share with beta readers now has a Readers list. Add a reader by name, with an expiry of their own, and they get a link that is theirs alone. Copy or close each reader's link by name, and once a named link exists you can close the open link too. Closing a link asks first, and revoking a copy that still has named links says so.
- **The reader's name on every page.** A named copy says "Shared with" the reader's name and the date the link was made, and a faint stamp of the name sits behind the text, kept when the page is printed. If a page is ever passed on, you can tell whose copy it came from.
- **Each reader sees only their own comments.** On a named link the comment form already carries the reader's name, and the reader sees their own comments, not other readers' names or words. In Reader comments, a comment from a named link is marked as such.
- **When each link was opened.** Each reader's row says when they were added and when their link was first and last opened. Nothing else about their reading is recorded: no pages, no time spent, no IP address.

## 2026-11-06 — Locked review copies

- **Lock a copy before you send it.** The Word file, the submission manuscript and the print-ready PDF can now be downloaded locked with a password, for the editor, agent or printer who should be the only one to open it. The PDF is locked with 256-bit AES encryption; the Word file with the encryption Word itself uses, so Word asks for the password. For the print-ready PDF, choose Download locked copy.
- **The password stays with you.** The lock is made in your browser and the password is never sent to Beuk. The password boxes empty themselves whenever the dialog closes.
- It is optional: without a password, your downloads are exactly as before.

## 2026-11-05 — Lighter typing, and box sets that keep every volume

- **Typing while signed in is lighter.** Every keystroke used to redraw the account button and the shelf line with the same words, and the shelf dot pulsed the whole time you typed; together they slowed each key a little. Now they change only when what they say changes, and the dot holds still, in gold, while you type, and pulses again once you pause.
- **Add a Book keeps every volume.** Adding several manuscripts to a box set (a Word file, a Markdown file, an EPUB, then a zip of three) could leave only the last book in the list. Every volume you add now stays. Adding a manuscript also no longer opens that volume's import report over the Export panel.
- **Hyphens stay in titles taken from file names.** A file named "Tik-Tok of Oz.md" now becomes "Tik-Tok of Oz", not "Tik Tok of Oz". A name like my-book-title still reads as words.
- **The book you have open stays linked to your shelf.** A bulk import, or adding a manuscript to a box set, could unlink the book on your desk from its shelf copy, so its next save put a second copy of it on your shelf. It now stays linked.
- **A new book never takes over another's shelf copy.** If a shelf save was still on its way when you opened a book that had never been on your shelf, the new book could be tied to the first book's shelf copy and overwrite it on its next edit. Each save is now matched to the book on your desk as well.
- **A first visit opens once.** On a first visit the studio could reload itself a moment after opening. It now reloads only when a new Beuk replaces an older one.
- **Error reports carry none of your words.** If you turned on error reports in Project Settings, a report now carries only the kind of error, its help code and where in Beuk's code it happened. The error's own message, which could quote your book, is no longer sent.

## 2026-11-01 — The front page as a tour

- **One scene at a time.** On a wide window, beuk.studio's front page is now a tour of twelve scenes instead of one long scroll: Welcome, the six ports, Ports of call, the Manifest, Take the helm, the Proof, and Come home. Move on with the dots on the tour bar, Back and Next, the arrow or Page keys, one turn of the wheel, a swipe, or a click on the scene itself. It never moves by itself, and every scene has its own link.
- Nothing was cut: every word and picture of the old page is in a scene. Phones, short windows and browsers without JavaScript keep the one long page.
- **The Outline board in right-to-left languages.** Alt + Down now always moves a card later and Alt + Up earlier, in right-to-left interface languages too; Left and Right still follow the reading direction.

## 2026-10-31 — Running heads that print, back-page starters, and true screens

- **Running heads print.** In Beuk's print PDF, a chapter-title running head came out empty: a 917-page novel had one on none of its 820 body pages. And "No head on opening pages" took the head off no opening at all. Beuk's print renderer now sets the head on every page, the same words the Print Interior View shows, and every section's opening page prints bare, front and back matter included.
- **Back matter heads its own pages.** The later pages of About the author or Acknowledgments now carry that page's own title in the head, not the last chapter's. A chapter can have a short running head in place of a long title, and a head still too wide is cut at a word with an ellipsis, so it always stays on one line.
- **Starters for the back pages.** An empty About the author, Acknowledgments, Also by, Call to action or Colophon page offers starter texts in your book's language. Pick one to preview it; Use puts it on the page with your name, title and series filled in, and selects the first `[[blank]]` for you to fill. A `[[blank]]` left anywhere in the book is flagged by the EPUB check and the print preflight.
- **Empty pages are left out.** A front or back page with no words, picture or backdrop of its own is now left out of every export: EPUB, print, Word, Markdown, HTML, the submission manuscript, box sets and the narrator script. The sidebar marks it Empty. The cover, title pages, copyright and contents are never left out.
- **Each e-reader as its screen shows it.** The device preview now draws black-and-white e-ink in greys (every Kindle but the Colorsoft, the Kobo Clara BW and the Kobo Forma), colour e-ink a little muted, and LCD and OLED screens in full colour. The Kobo frames used to show full colour on black-and-white screens. The Kindle Colorsoft joins the devices, and one line under the frame explains a grey screen.
- **Importing over a shelf book makes a new book.** Importing a manuscript while a shelf book was open used to save the import over that shelf book on the next save. An import is now a book of its own: the shelf book stays as it was, and the replace question says so.
- **The roadmap as a board.** beuk.studio/roadmap now lays its items out in columns: In progress, Planned in the order it will be built, Exploring, and Shipped by date, each with its first line and the rest under More. The roadmap and this changelog wear Help's header, and Open the studio takes you to the studio.
- **The cover's back colour reaches across the fold** of a dust jacket, and spine icons keep a small margin from the edges, so a narrow spine no longer sits on the store's limit.
- **Caife at dawn.** On the support page, the thank-you note now falls onto a dawn sea, past a lighthouse on the headland, a ship in the haze and a few gulls, printed with the paper's grain.

## 2026-10-31 — Room for research

- **A book with many pictures and files types as quickly as an empty one.** Beuk saves your book on your device a moment after you stop typing. It used to save every picture and research file again each time, so a book holding 25 MB of them stalled typing for about a tenth of a second on every save, and for nearly half a second on a slower computer. Each picture and file is now saved on your device once, when it arrives; after that a save takes a few thousandths of a second however much you keep. Your device also keeps one copy of each instead of two, so the book takes half the room. Backups, exports and your shelf copy are unchanged and still carry everything.
- **More room for research.** A book now keeps up to 100 MB of research files, 25 MB each (it was 25 MB, 10 MB each), and up to 200 files.
- **Web pages and Word documents in the Notebook.** Save a page from your browser (Chrome and Edge: Save as "Webpage, Single File"; any browser: "Webpage, HTML only") or add a Word document (.docx) to a note, and read it right in the Notebook as words, headings, lists, tables, links and the pictures that came with it. The page's scripts, styles and anything it would load from the web are left out, so nothing it carried can run. A saved page fills in the note's source link with the address it came from, and a Word document gives the note its title. Save a copy gives you back the file exactly as you added it. An older .doc file or a Safari web archive is turned away with a sentence saying how to save it so Beuk can open it. Under each one, a line tells you whether every word of the file is shown, or exactly what is not (a page's menus and form buttons, pictures it never saved, a Word file's headers, footers, comments and tracked deletions), with how many; nothing is left out or added without saying so.
- **Said plainly if a picture is lost.** If a picture or file ever can't be read back from your device, Beuk opens your book with all its writing, says how many are missing, and suggests a backup or your shelf copy.

## 2026-10-31 — 21 days free, store-ready files from the server, and the spine and back cover

**21 days free, then one plan** (once billing is switched on; until then everything stays open and no price is shown)
- A new account gets 21 days with everything included. Accounts made earlier get 21 days from the day they signed up.
- After the trial, without a plan, these pause: the store-ready EPUB, the print-ready PDF, the cover wrap, adding new books to your shelf, new beta-reader links, server checks, and saving to your archive.
- Writing, typesetting and preview stay open, and so do your own words: the backup file, Word, Markdown, and Download all my data.

**Store-ready files are made by the server**
- Download print-ready PDF in the Export panel makes the file for the store on the server. Open Print View and Download Print HTML are now a preview, for checking the pages and printing them yourself.
- The store-ready EPUB and the cover wrap (PDF and JPG) are built on the server from your book, with the same code the studio uses, so they come out the same. They need a connection.

**The spine and the back cover**
- The cover maker has Spine and Back cover sections: their own background (a colour, a gradient or a pattern), their own font and colour, the words on the spine, and an icon at the head and the foot of the spine.
- English, Dutch and Nordic spines now read top to bottom, the way those shops shelve them. Other books keep bottom to top, and you can choose either.
- A long imprint at the foot of the spine now shrinks to fit instead of being cut off.

**Fixes**
- An uploaded font now shows on the cover, in the preview and in the downloaded wrap. Before, covers fell back to Georgia.
- The new controls and messages are translated into all 13 interface languages.

## 2026-10-30 — EPUB import, a new book in one click, and the Lighthouse

**Bringing books in**
- **Import an EPUB.** The Import button now takes an .epub. Beuk reads its title, author and reading order, and reads each page by what it says it is: a chapter, a part, a prologue, a dedication. An EPUB Beuk made comes back exactly, with its chapter numbers, titles and subtitles, Parts, letters, verse, logs, margin notes, notes and pictures with their captions. A page that says nothing about itself is read by its headings, as a Word book is. The cover, title pages and contents are left out, because Beuk builds its own, and a book under DRM is refused.
- **EPUBs, PDFs and zips wherever a manuscript goes.** Bulk import and a box set's Add a Book now take EPUBs, PDFs and zips, and read every file with the same reader as the Import button, so they get every import fix too. A zip opens into its files, with Mac and system clutter left out and anything unreadable named. The Import button takes a zip of one manuscript and points a zip of several to Bulk import or a box set.
- **Start a new book.** A new button beside the sample's Remove clears the desk for a new book. The book on it goes into History first ("Before starting a new book"), and a book on your shelf stays there just as it is; the new book becomes a shelf book of its own once it has words. It asks first, and says where your old book is kept.
- **A book Beuk wrote comes back as it was.** Importing a Word file Beuk made keeps sub-headings inside their chapter and chapters inside their Parts, leaves contents lines and the frontispiece out of the chapters, reads "Part One: Ebb" as Part One titled Ebb, and puts subtitles and endnotes back where they belong. Importing a PDF Beuk printed keeps italic subtitles, sub-headings, the notes at a chapter's end as footnotes, monospace logs, and sideways and upside-down text.
- **PDFs read like the books they are.** A PDF's bookmarks now name its headings, so a diary of 42 dated entries no longer arrives as four month-long chapters. A diary or ledger set in a larger hand stays inside its chapter instead of becoming chapters of its own: one novel came in with 39 chapters for its 30, and now has 30. A title page, a setting note or an author's note never becomes chapter 1, letter-spaced capitals close up into their words, and a drop cap rejoins its word.
- **Names keep their spaces.** A title set in spaced capitals no longer arrives with its words run together, and a line break inside a Word or EPUB heading reads as a space. If a title, byline or chapter title still looks run together, the import report names it and offers a one-click Use.

**In the studio**
- **The sample shows everything.** The Lantern Coast now has three Parts and every feature Beuk sets, each one carrying story: a private letter, a ledger in columns with an upside-down confession, lamp signals as texts, a transcript of the vote, a chant as verse, a dated log inside its chapter, a redacted notice, a sideways tide table, lists, a margin note and a plate caption. Its chapter titles, numbers and paragraphs are unchanged.
- **Zen: the manuscript and nothing else.** In Zen the chapter's settings and pictures fold behind one line, the word count waits until you point at the bottom bar, and Zen always opens on the manuscript. Behind the page, the harbour sketch gives way to an ink painting you choose in the scene changer: Bliss, Calm, Mind or Sakura. They work offline, the day's light still eases over a long session, and in Candlelight the painting is drawn light on the dark.

**Around the site**
- **The Lighthouse on the Help home.** Help's status line is now a night harbour under the search box. The lighthouse is Beuk's server: its beam sweeps while the server answers, flickers amber when a part needs a look, and goes dark if the server doesn't answer. Each part is a named buoy, green, orange or red; point at one or tap it for the server's own words. There is a ship in the fog, and a button that sends a shooting star. It checks every 30 seconds and draws only while you can see it; with reduced motion it holds still, and where it can't be drawn the plain reading opens instead. On a phone, the buoys' names no longer pile up or run off the edge.
- **The Bowmarket.** The School has a bookshop: books and box sets set in Beuk, each shown as a 3D book with pages and illustrations from inside it, newest first. On its shelves: the Crashlanders and Frost Line sets, What You See?, The Raven from Darkness, The Cheese Bandit Diaries, Kleos, The Devil's Ledger and The Ninth Finger.

## 2026-10-29 — The Notebook, the plot grid, and Compare

**The Notebook**
- **Research, ideas and scraps, kept with the book.** A new Notes tool in the sidebar opens your book's Notebook: notes with a title, an optional folder and text, grouped by folder, with search across every note. Pin a note to sections, and the notes pinned to the section on your desk come first. Every name your Covenant knows is found in a note, with a count, and opens its entry. Delete has Undo. The sample comes with three notes, each pinned to the chapters its facts come from.
- **Research files.** A note can carry the files it was written about (pictures, PDFs, recordings, video clips and text) and the link it came from, and each one opens inside the Notebook. On your shelf, each file is uploaded once. Notes and their files are never exported and never counted as words.

**The Outline**
- **The Grid.** A third Outline view beside Cards and List: your sections down the side, your Covenant's entries across the top, and in each square how often that name appears in that section, shaded against its busiest one. Click a square and the desk opens on the first mention. The status and tag filters narrow the rows. There is nothing to type in, and nothing is stored.
- **Plot threads.** The Grid's first columns are your own plot threads. Add one from the bar above the grid, rename it in its header, or remove it there with Undo. Each square is a note on what that thread does in that section, and every story section has a row, even one with no words yet. The sample comes with three threads.
- **Custom fields.** Make your own text, list, checkbox and date fields in a Custom fields panel, shown in every Outline view; rename or remove them, with Undo. Every card and list row gets a control for each field, and the Grid gets a column for each. They are notes for you: never exported, never counted.

**History and import**
- **Compare.** In History, every Changed row under "Since this snapshot" has a Compare button: the section as the snapshot holds it against the section now, struck through where words have gone and underlined where words are new, with counts of words added and removed. "Changes only" folds the paragraphs that didn't change; "Whole section" shows them. The sample loads with a snapshot of its own, "Chapter One, an earlier draft", to try it on.
- **Import RTF.** Manuscripts saved as RTF from Word, Scrivener, TextEdit or LibreOffice now import, with their headings, italic and bold, links, footnotes, lists, PNG and JPEG pictures, and the title and author. The import report works as it does for Word: tables are left out with Undo, and comments, tracked deletions and page headers are listed. Bulk import and box sets take .rtf too.
- **An import takes the desk whole.** Importing into a desk that held a book used to mix the two: the old book's front and back matter, title and author stayed beside the new one. Now the old book goes into History and the import lands on a fresh book. Before the file is read, a warning names what will be cleared and that History keeps a copy; Keep leaves your book exactly as it was. The typography you chose stays. The new book now brings its own title and author, in place of the 26 October rule that kept a title you had typed.
- **Front and back matter stay out of the chapters.** In a manuscript that numbers its chapters, an unnumbered heading before chapter one is now front matter (the title page lifted out, a "For …" line the dedication, anything else a preface), and one after the last chapter is back matter (a sneak peek becomes a call to action, anything else an appendix).
- **Bad files are refused plainly.** An empty or unreadable text file is refused and a broken Word file says so, with your desk left as it was. Invisible control characters are cleaned out of every import, while emoji and the scripts that need joining characters keep them. Volume and Book headings become Part dividers.

**Room on the desk**
- **Fold the columns away.** A tab on each edge folds away the left column or the reader, and the editor takes the room; the same tab brings it back. Your choice is kept on this device. Phones keep their tabs.
- **The chapter list stays in reach** with the statistics open on a short laptop screen; the statistics scroll inside themselves instead.
- **Removing the sample leaves nothing behind.** An untouched sample no longer counts as edited once its pictures arrive, and an empty desk shows no page totals.

**The site catches up**
- **Beta readers, pictured.** The features page now shows the reader's page and the studio's Reader comments window in two real screenshots, beside an illustration labelled "An illustration, not a screenshot".
- **Comparisons brought up to date.** The pages comparing Beuk with other tools no longer say Beuk has no plot grid, outline, story notebook, character profiles or deadline maths. What Beuk still doesn't do stays listed.

## 2026-10-29 — Buy the maker a caife

- **The support page says thank you properly.** "Buy me a coffee on Ko-fi" is now **Buy a Caife** (caife is Irish for coffee), on the support page and on the tip jar in Help and after an export. Ko-fi still opens in a new tab. Back on the support page, a thank-you note drifts down over a morning sea, folds itself into a paper boat and sails off toward the sun, and the page says "Go raibh maith agat", Irish for thank you. The note waits for you: if you are still on Ko-fi, it folds when you come back. It is drawn live in your browser, from Beuk's own server, with no images and nothing fetched from elsewhere. With reduced motion on, you see the boat already on the water. For a week afterwards, on that device, the boat is still out there when you visit.
- **Homeport.** A new anchor button in the studio's top bar opens Beuk's home page in a new tab, so you can find the landing page again while signed in. Your book stays open where you left it.
- **The header link is Caife too.** On Help and the warmth pages, the link to the support page now reads **Caife**, with a small coffee cup beside it.

## 2026-10-28 — The Covenant grows up

- **A change pinned to the story.** Mark something that changed about a character, place or thing — Mara is hurt, the keep falls — and it is pinned to the passage where it happens. The entry's "Right now" shows the latest change at or before where your cursor is, and "Story so far" lists them all in order; changes still ahead of you show greyed, as not yet true here. A pinned change moves with its passage through chapter moves and text added around it. If the words it is pinned to are edited, or the passage is deleted, the change says so and waits for you to mark it again or remove it; it is never dropped on its own. Any change can be removed from Story so far, with Undo.
- **An entry that folds.** A new entry looks just as it did. Quick facts, links and changes appear only once you add one, and the rest sits in folds: Story so far and Details (your notes, shown formatted; you still write them in the same Notes box). Where it appears stays below the form, where it always was.
- **Mark a change from the desk.** Select the words and press Alt+M (or, while names are underlined, choose “Mark a change for …” from the small menu that appears by a selection near a name), pick who it is about, say what changed in your own words, and optionally set one quick fact with it. A small dot in the margin shows where each change is pinned. The dots never print or export.
- **Links, quick facts and genre templates.** Link one entry to another with a short label ("serves", "sister of"); it shows from both ends. Quick facts are fields you define for each type (Age, Status), with starter sets for fantasy, science fiction and nonfiction if you want one.
- **Series and Number in series** are now in Project Settings, next to each other. The number puts the books in order.
- **One Covenant for a whole series.** When signed-in books share a Series name (case and spacing ignored), Beuk offers one card: "3 books share “Salt Road”. Share one Covenant?" Nothing joins by itself. If you say yes, entries with the same name in different books come up one pair at a time, as Same in both or Different; nothing merges until you choose. Entries kept to one book stay in that book, and a new entry goes to the series unless you pick only this book. In a series, Right now and Story so far read across the books in order of their Number in series, so Book 7 knows what happened to Mara in Book 5; until the books are numbered, another book's changes are listed by book, order unknown, and the card says so. Leaving the series or renaming it asks first. The list can be filtered All, Book or Series. Signed out, everything else works on the single book; the shared Covenant needs a free account, and the room says so in one line.
- **An AI setting per entry** (send when in the scene, always send, never send) is stored in the book now. It is hidden until you can connect your own AI key, which comes later.
- A book with none of this serializes exactly as before, and the Covenant still never reaches EPUB, print, Word or any word count.

## 2026-10-28 — Clean edges

- **A request that is not valid JSON is answered as the sender's mistake.** The server used to answer a broken JSON body (a hand-made request, a cut-off upload) with 500 "internal error" and log it as a fault of its own. It now answers 400 "the request body is not valid JSON", or 415 for a body in an encoding it does not read, and logs nothing. Nothing changes for the studio, which always sends valid JSON.

## 2026-10-27 — Print bleed

- **Box sets keep every book whole.** Add a Book (Export → Box Set) now takes a Beuk backup file (.beuk-backup.json, from Download a backup), so Book Two, Three and on arrive with their own cover and every picture, not just their text. Pictures from different books never mix up, even when two books share the same art.
- A box-set volume's title is now the book's own — the backup's title, a Markdown file's frontmatter title, a Word file's document title — so "Tik-Tok of Oz" stays "Tik-Tok of Oz". The file name is used only when the file names no title, and then as written.
- **Signing in on a second device no longer fails now and then with the right password.** The server closed idle connections sooner than the proxy in front of it, so once in a while a sign-in landed on a connection that had just been closed and was lost. The server now keeps them open longer than the proxy does. And if the shelf can't be reached, the sign-in dialog now says so, instead of telling you your email and password don't match.
- **Saving to your shelf no longer re-sends your pictures.** Each picture is uploaded to your shelf once; after that an autosave sends only the book itself. For The Marvelous Land of Oz (137 pictures) that is 0.3 MB per save instead of 47.5 MB, and under half a second instead of 20 seconds or more. Books saved before this keep opening as they always did and switch over on their next save. Your backups, your data download and your beta-reader copies still contain every picture.
- **Rights: public domain and Creative Commons.** Project Settings → Rights now offers All rights reserved (the default, unchanged), Public domain, Creative Commons and Custom. A public-domain book's copyright page and EPUB say "This work is in the public domain.", with the original publication year and a "This edition ©" line for the edition's own additions if you give them, and no longer claim "All rights reserved". Creative Commons names the licence you pick (CC BY, BY-SA, BY-NC, BY-NC-SA, BY-ND or CC0) with its web address. Print, EPUB, Markdown and Word all follow; books you already have print exactly as before.
- **Opening a book no longer carries over anything from the book you had open before.** Opening a book from your shelf used to keep some details of the previous book when the new one had none of its own — most visibly the series name, but also the publisher, ISBN, year, print settings and History — and the next save wrote them into the new book. Each book now opens with only its own details.
- **Print PDF/X works for long books.** A novel of about 250,000 words (870 pages) used to fail with "Ghostscript exited with code null": the converter ran out of memory. Beuk now converts a long book 40 pages at a time and joins the parts, so an 873-page book becomes a PDF/X-1a file. If the converter is ever stopped, the job says how and on which pages.
- **Tooltips everywhere.** Point at a button, or reach it with the keyboard, and a small tip says what it does, in your interface language and in the Paper or Candlelight look. On a phone or tablet, press and hold a button to read its tip; letting go doesn't press it. Esc puts a tip away. Icon-only buttons, like the top bar's on a narrow screen, the sidebar's Insights, Goals, History, Comments and Bible, the editor toolbar and the preview's devices, all have one now.
- **Full screen for every reader.** The Ramp books, a beta reader's reading copy, the studio's device preview (every e-reader and the hardcover), the Print Interior View, the print preview and the landing page's turning book each have a Full screen button. Press F to go full screen and Escape to leave. On an iPhone, where Safari has no full screen for pages, the reader fills the window instead and the button says so.
- **Ramp books open whole on a slow connection.** A book on the Ramp could open with its first page half drawn, or on a phone with a blank page where the title page should be, until it was closed and opened again. Each spread now arrives whole before it is shown or turned to, and if one does not arrive the reader says so and offers to try again.
- **The studio opens with a much smaller download.** The sample story's 37 pictures are now separate files instead of being packed into the studio page, so a first visit downloads less than half as much before you can write (about 7.6 MB instead of 18.3 MB). The sample still opens in one click, its pictures follow a moment later, and after one visit it opens with all of them offline. Exports and print wait for the sample's pictures; if they could not be downloaded, Beuk says so instead of exporting without them.
- **Outline: cards and a list of your book.** A new Outline tab beside Chapter Content shows every chapter as an index card, or as a list. Drag a card, or use Alt + the arrow keys, to reorder the book; Undo and a History snapshot come with every move. Click a title to open the chapter.
- Give each chapter a short synopsis, a status (To do, Draft, Revised, Final) and tags in your own colours, plus a point of view in the list. They are notes for you: they stay in the book file and never appear in an EPUB, print or Word export or in your word count.
- Filter the cards by status and tags (a card must have every tag you pick); the view says how many it hides. Save a filter under a name, like "Needs work", and reopen it in one click.
- **Bleed** (Export → Print Interior): turn it on and Beuk's print PDF has pages 0.125 in larger on the top, bottom and outer edge, the way KDP and IngramSpark ask for a book whose pictures run to the edge. A 6 × 9 book prints at 6.125 × 9.25 in.
- Full-page plates and spread backdrops now run out into that bleed, so the printer trims through the picture instead of leaving a white sliver. The words, running heads and page numbers don't move.
- It is off until you turn it on. When your book has plates or backdrops, the print settings and the store check suggest it.
- The Print Interior View shows the bleed, shaded beyond a dashed trim line.
- Printing from the browser still gives a PDF at the trim size; the bleed comes from Beuk's own print PDF.
- **Submission manuscript** (Export → Submission Manuscript): a Word file in standard manuscript format for querying agents and publishers. A title page with your contact details and the word count, then the text in 12 pt Times New Roman (or Courier), double-spaced, one-inch margins, each chapter on a new page, # for scene breaks, END at the end, and a Surname / TITLE / page header. US Letter or A4; italics kept or underlined.
- Your contact details are saved with the book and printed only on that title page; empty fields are left out. The dialog lists everything left out — front and back matter by name, pictures, the typesetting — so nothing disappears without your knowing. Notes go on a Notes page after END.
- Importing a manuscript now reads a line with just # as a scene break.
- **Typing in a long book is as quick as in a short one.** Each keystroke used to recount the words of the whole book and start measuring every chapter's pages again; in a 250,000-word novel that was about a seventh of a second a keystroke, and more the longer the book. Now only the chapter you are writing in is recounted, and the page count measures just that chapter, in your next pause. The totals and page counts you see once you stop typing are exactly what they were.

- **The studio wears the site's colours.** The writing studio now uses the same sea blue and amber on warm paper as the beuk.studio home page, and Candlelight is the same blue and amber at night. Your book's own colours and fonts are unchanged. Text and buttons meet the WCAG AA contrast minimums in both looks, and every control shows a visible focus ring.

**Goals that plan with you**
- **Writing days.** Choose the days of the week you write, and whether the deadline day counts.
- **Set my daily target from the deadline.** With a project target and a deadline, Beuk works out the daily target for you and shows the sum: "15,000 words left over 10 writing days → 1,500 a day". It is worked out again each day, so a missed day spreads over the days still to come.
- **On pace.** One line tells you whether the book is on pace, behind or ahead of a straight line from the day you set the deadline. It never counts down at you.
- **Written and kept.** See the words you wrote and the words the book kept after deletions, today or over the last 7 or 30 days. Beuk starts keeping these from today; earlier days are not guessed.
- **Rest days don't break your streak.** Days you don't write on are skipped.
- **Just write.** Turn the goals, streak and pace off and write; your words are still counted. **Clear tracking data** wipes the log and the streak on this device and never touches a word of your book.
- **Covenant** (sidebar → Covenant): keep the characters, places, things, groups and lore of your book with the book — names, nicknames, a line, notes, a picture from the image library, tags. Start from the names Story Insights found (you choose which, and what each one is), or by hand. Names are underlined faintly in the writing desk; point at one, tap it or press Alt+Enter for its card. Each entry shows where it appears — a bar across the chapters, first and last appearance, every passage, one click to jump there. Export it to a file and import it into the next book of a series. Nothing in it is printed, exported or counted as words.
- **Story Bible is now called Covenant**, in the sidebar, the room, its buttons and messages, in all 13 languages. Your entries are where they were; nothing in your book changes. Exports are now named `<title>-covenant.json`, and an older `-story-bible.json` export still imports.

## 2026-10-27 — Ramp opens like a book

- **Turn the pages.** A Ramp book now lies open on a desk under a lamp, in a room lit by the book's own colour: violet for The Woolly School, deep sea for The Travel Guide, ember for The Sunken Vault. The page lifts and turns over the spine, and its back is the real next page. Page edges thicken on the left and thin on the right as you read, the gutter is shaded, and a folded corner shows where to turn. Click a page, swipe, or use the arrow keys.
- **On a phone held upright**, one page at a time, turning the same way; a blank left page is skipped.
- With reduced motion the pages change with a quiet fade instead of turning.
- The pages are still Beuk's print, untouched; the reader adds only the light, the gutter, the edges and the turn.
- **Two new books:** The Woolly School and the Runaway Ball of Yarn, a clay-animation picture book, and The Travel Guide, ten places on seven continents. Eight books in all.
- **The sample story's Chapter One has a new painting:** a watercolour of the ferry crossing the harbour at first light. It shows when you load the sample.
- The studio offers this update ("A new Beuk is ready").

## 2026-10-26 — Your free week, a quick tour, and colour

_The trial is now 21 days, and the store-ready files pause after it: see 31 October._

**Your free week, and after it** (once billing is switched on; until then everything stays open and no price is shown)
- A new account starts a 7-day free trial when it signs up. Your account page shows when it ends and how many days are left.
- After the trial, without a plan, some things pause: adding new books to your shelf, new beta-reader links, server checks, and saving new files to your archive. Writing, the books already on your shelf (they keep saving), every export, your downloads, the reading links you already have, and Download all my data stay open.
- If you choose a plan during your trial, the first payment waits until the trial ends.
- If a payment doesn't go through, everything stays open for 7 days while Stripe tries the card again, and the account page says so calmly.
- Manage billing on the account page opens Stripe, where you can change your card, see your invoices or cancel.
- Deleting your account cancels its subscription at Stripe straight away, so nothing more is charged.
- One email a few days before your trial ends, only if you have no plan and this server can send email.
- The studio's shelf dialog shows your plan in one line, in all 13 languages.

**Email**
- **A welcome when you create an account.** One email, once: it confirms your address and says what an account adds, and that writing never needs one. It mentions the trial only when the account has one, and a price only once one is set.
- **One plain layout** for every Beuk email, ending with why you got it, who sent it, and a link to your account page. No pictures, no tracking.
- **Where to write for help.** Once a support address is set it appears on your account page, the status page, the studio's Project Settings and the comparison pages, and replies to any Beuk email reach it. Until then nothing names a person or promises a reply, and the studio's Support button stays hidden.

**A quick tour for a new writer**
- The first time the studio opens on a device, four short steps show where things are: Import or the sample story, the page and the preview, Typography Studio, and Export. It ends when you start (words typed, a manuscript imported, or the sample opened); Skip or Esc closes it at any step.
- It shows only once, and never on a device that already has a book. It doesn't block writing and stays out of the way of dialogs and Zen. "Show the quick tour", under the sample story or in the Help guide "Import a manuscript", brings it back.
- All 13 interface languages, Arabic right to left included, phone widths and reduced motion.

**Display faces and book colour**
- Three display faces for headings, all SIL OFL 1.1 and self-hosted: **Pinyon Script** (a formal script), **Patrick Hand** (handwriting, for children's books) and **Abril Fatface** (a heavy poster serif). Headings only, never running text; installed in the print renderer and embedded in an EPUB whose headings use one.
- A book can carry **one accent colour** for chapter titles and numbers, rules and ornaments, drop caps and the title page, and an optional **page tint** for screens and EPUB. Print keeps the accent and ignores the tint; "Print the accent in black ink" sets it in pure black for a black-ink edition.
- A contrast guard refuses an accent below 3:1 on the page, or a tint below 4.5:1 for black text, and says the measured contrast. On the studio's dark screens a lighter shade keeps headings readable.
- A book with no colour set typesets exactly as before. The colour is saved with the book and kept in History snapshots.
- The studio offers this update ("A new Beuk is ready").

## 2026-10-26 — Your account, the whole site, and knowing when something is wrong

**Your typesetting portal**
- **beuk.studio/account** shows your email address, your shelf (about how many words, when each book was last saved, and a link that opens it in the studio), your export archive, your beta-reader links, your streak and your plan, all in one place. Signed out, it offers Sign in and Create an account.
- **Email confirmation.** A new account gets a link to confirm its address. Nothing waits on it: writing, saving, exporting and the trial work the same either way. When this server can't send email, it says so.
- **Change your email address** from the account page. A link goes to the new address and a notice to the old one, and nothing changes until the link is opened.
- **Download all my data:** one ZIP with every book (as backup files the studio opens), every archived file, your reading links and their comments, your streak, and a README saying what is inside.
- **Delete my account:** with your password and a typed phrase. It removes everything the account holds, archive files included, and offers the full download first. If a subscription is still running, the page says that deleting doesn't cancel it yet, and who to ask.
- After you sign in or create an account, a book on this device that has real writing is offered a place on your shelf, once, and only if you say yes.

**Features and comparisons**
- **beuk.studio/features shows the studio as it is.** Nine pictures of the real studio, taken with the sample novella. Every line says what the studio does today; beta-reader links need an account, so that section has no picture rather than a mock-up.
- **Beuk beside Atticus, Vellum, Reedsy Studio and Dabble** at beuk.studio/compare. Each page says where the other tool is stronger as plainly as where Beuk is, and lists what Beuk doesn't do. Every fact about the other tool links to that tool's own website and carries the date we checked it (26 October 2026). No price is shown for Beuk: a 7-day free trial, then one price, announced before launch.
- The front page's top bar shows Features and Compare; "Ports of call" and "Manifest" stay in the footer.

**Knowing when something is wrong**
- **A status page.** beuk.studio/status says whether the studio, the shelf, Help, the server checks, email and backups are working, with the time of each reading. Parts not set up yet say so. An outside monitor can read the same at /api/status/public (see docs/uptime-monitoring.md).
- **Backups speak up.** When a backup check turns red, the server sends one alert by email (once email is set up) and/or to a chat webhook, tries again if it didn't arrive, and sends one more when things are working again.
- **Old local backups can be tidied.** Two new settings decide how many to keep; until they are set, every backup is kept. The newest is never deleted, and nothing is deleted while a backup runs.
- **Error reports, only if you want them.** You can let the studio send the error message and where in Beuk's code it happened when something breaks, never your account. It is off unless you turn it on in Project Settings.
- **Counts, not tracking.** The server keeps one number a day for sign-ups, sign-ins, first saves, exports, EPUBCheck runs, share links, and writers who came back after a week. No cookies, no addresses, nothing about who.
- The studio offers this update ("A new Beuk is ready").

**Hindi and Arabic, set properly**
- Hindi and Arabic books are now set in real book faces, Noto Serif Devanagari and Amiri (free, open-licensed, served from beuk.studio), in the preview, the print PDF and the EPUB, instead of whatever font the reader's device has.
- There is nothing to choose: your Latin faces stay, and Devanagari and Arabic letters, a whole book or one passage, switch to the script face by themselves.
- Arabic (and Persian, Hebrew, Urdu) books now read right to left in every export, and their headings and contents follow the book's side.
- **Fixed:** in the device preview, an Arabic book showed only its first page; every later page was blank. Its pages now turn the right way.

## 2026-10-26 — A front door

- **beuk.studio opens on the landing page.** It says what Beuk is, with
  real buttons: Start writing, Sign in, and Start your free week. The
  studio itself moves to beuk.studio/studio. If you have written on a
  device before, the front page sends you straight to the studio, and
  your book is where you left it.
- **The page tells the truth.** It names beuk.studio, makes no claim to
  be open source, and its numbers are the studio's own: 11 store presets
  (Google Play included), 24 trim sizes, paperback or hardback, 36 book
  languages. It also lists what the studio gained this month: Story
  Insights and Goals, History and Undo, beta-reader links, and narrator
  scripts.
- **No font host is asked for anything.** The page uses the same
  self-hosted fonts as the studio, and reads without JavaScript.
- **Found and shared properly.** A real `robots.txt` and `sitemap.xml`,
  and link previews for the front page and every Help page.
- The studio offers this update ("A new Beuk is ready").

## 2026-10-26 — Help catches up

- **Two new guides.** *Delete, split & merge chapters* covers the
  chapter `…` menu, Undo and what can't be merged. *Story Insights &
  Goals* covers the glance cards, the charts, Names on stage, the road
  so far, and where each count comes from (238 words a minute, the
  reading desk's own pages).
- **Five guides updated.** Removing a picture (Footnotes, endnotes &
  images), the preview keeping your place (Typeset a chapter), the
  title read from the manuscript and Split at cursor (Import a
  manuscript), the Cover Maker (Add a cover), and History and the
  reworded conflict notice (Saving, devices & conflicts).

## 2026-10-26 — Smaller History, truer counts

- **History no longer copies your pictures.** Every snapshot (named or
  automatic) now shares the book's pictures, fonts and cover instead of
  holding its own copy. A picture you have removed is kept once for
  History, however many snapshots still hold it. A book with many
  snapshots saves much smaller, and removing a picture no longer makes
  the saved book grow.
- **One reading pace, with its source.** Reading time now uses 238 words
  a minute everywhere (sidebar, statistics, Insights). That is the
  average silent reading rate for adults in English (non-fiction) in a
  2019 review of 190 studies (Brysbaert, *Journal of Memory and
  Language*). Fiction ran a little faster, at 260 a minute.
- **One page count.** The sidebar's page count is now the reading desk's
  own count for the device on the desk, so it matches the desk and
  Insights ("~111 pages" in both places for the sample on a Kindle
  Paperwhite). A rough 250 words a page is used only until the desk has
  measured the book.
- **Typing a chapter title shows the title.** Editing a chapter's
  number, title or subtitle turns the preview to the page they stand on:
  page 1, or the page after the opening plate.
- **Clearer sync conflict notice.** It now says the book was changed in
  two places, this device and your shelf, without assuming this device
  was offline. All 13 languages.
- **Fixed:** with the interface in Arabic (or any right-to-left
  language), the device preview cut each page in half. The preview now
  lays the book out the same whatever the interface language.
- An open studio offers this update ("A new Beuk is ready"). An older
  studio would drop the new snapshots on its next save, so please take
  the update.

## 2026-10-26 — Taking a picture out of the book

- **Remove a picture you uploaded.** In the image library (Insert Image,
  and the scene-break picker) every picture now has a small bin button.
  A picture nothing uses goes at once, with Undo for ten seconds. A
  picture in use first shows where — "Chapter Three (in the text),
  Chapter Five (plate)" — and **Remove it everywhere** takes it out of the
  text, the plate, the backdrop, the scene break, the cover or the
  flourishes, just as removing each by hand would. Undo puts it all back.
- **Remove unused pictures.** One button clears every picture nothing in
  the book uses, showing how many and how large they are first.
- **Honest about space.** Each removal keeps a snapshot in History
  ("Before removing a picture"), so a picture can always come back — and
  that snapshot holds the picture, so the saved book only gets smaller
  once you delete it in History. The library says so.
- The sample story's own pictures stay with the sample. In a book
  imported over the sample, the sample pictures it carried along can be
  removed like any other.
- Undo on a chapter operation also clears the "Before …" snapshot it no
  longer needs; a mouse pick no longer holds the Undo toast open.
- **Fixed:** the Undo button on a toast could not be clicked with a
  mouse or a finger; toasts on a phone are no longer squeezed narrow.

## 2026-10-26 — Chapters you can move without fear

- **Delete has an Undo.** Deleting a chapter no longer happens in one
  silent click. It now sits in the row's new `…` menu, takes a History
  snapshot first ("Before deleting …"), and shows "“…” deleted" with an
  Undo button for ten seconds. Undo puts the chapter back exactly where
  it was — text, notes, pictures, settings and its reader comments — and
  keeps anything you wrote in the meantime. After the notice is gone,
  the snapshot is still in History.
- **Duplicate, Split at cursor, Merge with next.** The same menu copies
  a chapter (titled "… (copy)"; reader comments stay with the original),
  splits the open section where your cursor is (a heading at that spot
  becomes the new chapter's title, and footnotes travel with the text
  that cites them), and joins a section with the next one using a scene
  break. Each takes its own snapshot and offers Undo. Merging across
  front matter, body and back matter is refused, and the menu says why.
- **Numbers keep up.** A book numbered in order — 1, 2, 3, I, II, III or
  One, Two, Three — stays in order after any of these, and after their
  Undos in any order; numbers you set by hand are left alone.
- **Snapshots stay light.** The snapshot taken before each of these
  shares the book's pictures instead of copying them, so a few deletes
  no longer make the saved book (and the shelf upload) several times
  bigger.
- **Notice buttons work.** Buttons on notices (like "History") now
  respond to a click, and notices use the full width of a phone.

## 2026-10-26 — Who walks on, and where

- **Names on stage, in Story Insights.** A new last section shows the
  names your book keeps returning to and where: one row per name, one
  column per section, each square shaded by how often the name appears
  there for its length. Choose a square and the studio opens that
  section with the first mention selected. Names are found by capital
  letters on your device — places and ships turn up too, and the page
  says so — and any that aren't names can be hidden; the hidden list is
  kept with the book. Books in scripts without capital letters get a
  short note instead of a guess.

## 2026-10-26 — The road so far, and what changed since

- **See the book grow.** Goals now draws the book's length over time —
  one quiet line, only on the days the studio actually saw it (the log
  starts keeping length today, so the line begins once two days are
  kept; days it never saw stay as gaps, never guessed). Set a target and
  it appears as a level line; add a deadline and a dashed line shows the
  steady pace from today that would land it — a pace, not a forecast.
  Hover, tap or use the arrow keys for any day's count.
- **History says what changed.** Every snapshot shows how the book has
  moved since — "+1,240 words since", "−310 words since" or "same length
  as now" — and opening one lists the sections added since, the ones no
  longer in the book, the ones you left out of the book (or brought back)
  with the sidebar eye, and the ones that changed, with their word
  counts. A chapter left out of the book counts for nothing, the same as
  in the word total, so the list always adds up to the change shown on
  the snapshot. All counted on your device from the snapshot you already
  have.

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

## 2026-10-26 — Story Insights you can explore

- **The book at a glance.** Story Insights now opens with six small cards:
  words, chapters, reading time, pages on your reading device, average
  sentence length and how much is dialogue — the same counts the sidebar
  and the reading desk show.
- **A tidier word list.** Your most-used words sit in two compact columns,
  and speech tags like “said” and everyday words like “like” or “one” no
  longer crowd out the words that are really yours.
- **Charts you can explore.** Hover or tab to any chapter in Chapter
  rhythm, Cadence, Reading ease or Dialogue to see its words, sentence
  length and dialogue share; click it (or press Enter) to open that chapter.
- **New: sentence variety, reading ease and words to look at.** A chart
  of how long your sentences run (for the whole book or one chapter), an
  approximate Flesch reading-ease line for English books, and the small
  filter and hedge words (felt, just, very, -ly…) with the chapters where
  they gather — offered as words to look at, never as mistakes.
- **Quick on long books.** Insights remember a book until it changes, and
  repeated phrases in a long book are found far faster.

## 2026-10-26 — The preview stays on your page

- **Formatting no longer throws the preview back to page 1.** Making a
  word bold or italic, quoting a paragraph, typing, Auto-Format or undo
  used to send the preview back to the first page of the chapter. It now
  stays on the page holding your cursor — and if you were paging through
  the preview, a new font size, theme or device keeps you on the words
  you were reading. Opening another chapter still starts at its first
  page, and stays there through a font-size, chapter-title or device
  change until you work in the text.
- **Auto-Format keeps your cursor.** It used to drop the cursor at the
  top of the chapter a moment after polishing.
- **Zen's buttons stay off the tabs.** In Arabic, and on a phone, the
  Ambient sound / Dictate buttons sat on top of the Chapter Content and
  Typography Studio tabs. They now sit at the far end of the line in
  every language, and on narrow screens the tabs step down beneath them.
  The writing box no longer runs past the edge of a phone screen (or
  past the other fields on a wide one).

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
