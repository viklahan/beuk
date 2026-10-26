---
slug: move-split-merge
title: Delete, split & merge chapters
blurb: Reshape the book from a chapter's … menu — delete, duplicate, split and merge, each with Undo and a snapshot in History.
group: write
audience: [new]
updated: 2026-10-26
readMinutes: 3
related: [import-a-manuscript, saving]
new: true
---

What you're doing: reshaping the book — taking a chapter out, copying one, cutting one in two or joining two together — knowing that every step can be taken back.

## Steps

1. In the section list on the left, choose the `…` button on a section's row (**More actions**). It holds **Duplicate**, **Split at cursor**, **Merge with next** and **Delete**.
2. **Delete** takes a snapshot in History first ("Before deleting …"), removes the section and shows "“…” deleted" with **Undo** for ten seconds. Undo puts the section back where it was — text, notes, pictures, settings and its reader comments — and keeps anything you wrote in the meantime.
3. **Duplicate** makes a copy titled "… (copy)". Reader comments stay with the original.
4. **Split at cursor** cuts the open section in two where your cursor is. Open the section, place the cursor where the second part should begin, then choose it. A heading at that spot becomes the new chapter's title, and footnotes travel with the text that cites them.
5. **Merge with next** joins a section with the one after it, with a scene break between the two.
6. Each of these takes its own snapshot and offers Undo. Once the notice has gone, the snapshot is still in **History**, where you can restore the whole book or a single section from it.

## Explanation

### Numbers keep up

A book numbered in order — 1, 2, 3, or I, II, III, or One, Two, Three — stays in order after any of these, and after their Undos in any order. Numbers you set by hand are left alone.

### What can't be merged

- Sections in different parts of the book: front matter, body and back matter stay apart, and the menu says which part the next section is in.
- Generated pages: the cover, title pages and contents.
- Part dividers. Delete the divider instead; its chapters stay.

A book always keeps at least one section, so the last one can't be deleted.

### Leaving a chapter out without deleting it

The eye on a section's row (**Include in export**) leaves the section in the studio but out of the book: out of the exported files and out of the word total. Select it again to bring the section back.

### What the snapshots cost

The snapshot taken before each change shares the book's pictures instead of copying them, so a few deletes don't make the saved book several times bigger. History keeps the five most recent snapshots taken before a chapter change.

## Troubleshooting

### What can go wrong

**Undo says the section has changed since.** If you wrote in the section after the change, Undo leaves it as it is, so the new writing isn't lost. The snapshot named in the message is still in History and holds the earlier version.

**Split at cursor asks me to place the cursor.** Open the section first, then place the cursor inside the text, where the second part should begin.

**Merge with next is refused.** Either nothing follows this section in its part of the book, or the next section is a generated page, a part divider or in another part. The menu says which.
