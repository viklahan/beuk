---
slug: saving
title: Saving, devices & conflicts
blurb: Where your book is saved, what "Saved on this device" means, and Keep mine / Use the shelf copy / Keep both.
group: keep
audience: [new]
updated: 2026-10-26
readMinutes: 4
related: [exports-and-archive, your-streak]
new: true
sourced-from: README.md "Local-first saving (studio)" (IndexedDB, header indicator, limits); README.md "API (M1–M5)" → "Optimistic concurrency (migration 009)" (revisions, 409, the conflict notice); client/index.html strings offline.conflictTitle, offline.conflictBody, offline.conflictBothNote, local.*, history.* (en); CHANGELOG.md 2026-10-26 "Smaller History, truer counts" and "The road so far, and what changed since"
---

What you're doing: nothing, mostly. The studio saves the open book on this device as you write — signed in or not, online or not. This page says where it goes, what the save indicator in the header means, and what happens when two devices disagree.

## Steps

1. Write. About a second after you pause, the studio saves the whole book in this browser, on this device: the text, its settings, the cover, images, uploaded fonts and the History snapshots.
   tech: IndexedDB database `beuk-local`, store `kv`: the whole `serializeBook()` document, written ~800 ms after you pause and again when the page is hidden or closed, in one `durability: "strict"` transaction that keeps the previous record as `book-prev`.
2. Glance at the save indicator in the header. **Saved ✓** means it is kept. **Saved · back up** means it is saved, but the browser has not promised to keep it under storage pressure. **Not saved** means it is not — select the indicator for the full sentence and an **Export a backup** button.
   tech: The studio asks for lasting storage with `navigator.storage.persist()`; when the browser declines, the indicator reads Saved · back up.
3. Export a backup now and then. The indicator's popover offers **Export a backup** and **Open a backup…** — a `.beuk-backup.json` file you keep wherever you like.
4. Signed in, with the book on your shelf, saves go to the shelf too. When you open the studio again, the device copy and the shelf copy are compared before the desk is shown: if only the shelf moved, the shelf copy opens; if only this device moved, it is sent up; if both moved, you are asked.
   tech: Every shelf copy carries a `revision`; a save names the revision it was based on (`If-Match`), and a stale one is refused with HTTP 409 and the current shelf copy, never overwritten.

## Explanation

### When two devices disagree

If the same book changed on this device and on the shelf since they last agreed, the studio shows **This book changed in two places**: on this device, and on your shelf from somewhere else. Nothing is overwritten until you choose:

- **Keep mine** replaces the shelf copy with the writing on this device.
- **Use the shelf copy** replaces the book on this device — and keeps this device's writing as a snapshot in History first.
- **Keep both** stands by the writing on this device and preserves the shelf copy as a snapshot in History, word for word.

Closing the notice simply puts the choice off, with both copies intact.

### History

- **Save a snapshot** in History before a big edit, named if you like. The studio also takes one by itself before an import, a restore, a chapter change, removing a picture, opening a backup or a shelf conflict.
- Each snapshot says how the book has moved since — "+1,240 words since", "−310 words since" or "same length as now". Open one to see the sections added since, the ones no longer in the book, the ones left out of the book or brought back, and the ones that changed, with their word counts.
- **Restore the whole book**, or one section. Restoring the whole book takes a snapshot of the book as it is first (unless the desk is empty), so the restore can itself be undone.
- Snapshots share the book's pictures, fonts and cover instead of copying them. A picture you have removed is kept once for History, however many snapshots hold it, and goes when the last of them is deleted.

### Limits, stated plainly

- Writing typed in the last second or so before a hard crash may be lost.
- A private window's storage ends with the window.
- The browser can still clear the copy if it did not grant lasting storage — export a backup now and then.
- Two tabs of the same book on one device are not coordinated, and can meet as a conflict.

## Troubleshooting

### What can go wrong

**It says "Not saved — this browser is blocking storage".** Private windows and some privacy settings stop the studio from saving on this device. Your writing is still on screen, but it isn't kept: export a backup now, then open Beuk in a normal window or allow site storage. See [BEUK-L901](/help/errors/BEUK-L901).

**It says "This book changed in two places".** You edited the same book in two places. Not sure which copy to keep? Keep both — the shelf copy goes into History, word for word. See [BEUK-C801](/help/errors/BEUK-C801).

**I opened Beuk on another computer and my book isn't there.** The device copy lives only in the browser that saved it. Sign in on both, with the book on your shelf, and the shelf carries it across; or open a backup file there.
