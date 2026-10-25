---
slug: share
title: Beta-reader share links
blurb: Send a read-only link, collect comments, and what a reader sees when a link is revoked or expires.
group: keep
audience: [reader, shipping]
updated: 2026-10-25
readMinutes: 3
related: [saving, exports-and-archive]
new: true
sourced-from: README.md "Beta-reader share links" (owner API, the frozen copy, the reader, comments, reader count, studio); src/shares/reader.ts renderGonePage / renderNotFoundPage; src/shares/reader.ts comment form ("The writer has turned comments off for this copy."); src/routes/shares.ts (410 "this reading copy is closed"); rate limits from src/routes/shares.ts DEFAULT_SHARE_LIMITS as documented in the README
---

What you're doing: sending beta readers a frozen, read-only copy of a book on your shelf. They read it in the browser and comment without an account; you read their comments beside your manuscript.

## Steps

1. Signed in, with the book on your shelf, open **Export** and find **Share with beta readers**.
2. Create a link: choose when it expires, whether comments are on, and whether readers are asked for their name. Copy it with the copy button.
   tech: `POST /api/shares` returns the token once; the server stores only its SHA-256, like a session token.
3. Send the link to your readers. They open it in any browser — no account, no app.
4. Read what they wrote in the sidebar's **Reader comments**: grouped by section in book order, with a jump to the quoted passage in the editor, and resolve / reopen.
5. Changed the book? **Republish** re-renders the copy from the shelf manuscript's current text. Finished? **Revoke** closes the link.

## Explanation

### What a reader sees

- The copy as it was when you shared (or last republished) it — your later edits don't leak into it until you republish.
- Chapter navigation that works even without JavaScript, in the Paper look of the help pages, made for phones first.
- Never your email address or your account id.

### Comments

- A reader selects a passage and chooses **Comment on this**, which anchors the comment to that paragraph and its quoted words; or comments on the chapter as a whole.
- A comment can be up to 2000 characters, a name up to 60.
- Comments are visible to everyone holding the link: the reader's name, the text, the quoted passage and the time.
- To keep a link from being flooded, one network address can post 10 comments to a link per 10 minutes, and a link takes at most 200 an hour.

### When a link is closed

A revoked link, or one past its expiry date, shows a calm page instead of the book: **This reading copy is closed**, with "The writer has closed this reading copy." or "The reading period for this copy has ended." A link that was mistyped or cut short shows **We couldn't find this reading copy**.

## Troubleshooting

### What can go wrong

**A reader says the reading copy is closed.** The link was revoked, or its expiry passed. Create a fresh link and send it. See [BEUK-H410](/help/errors/BEUK-H410).

**I can't copy a link again on my other computer.** The server keeps only a fingerprint of each link, never the link itself, so only the browser that created it remembers it. On another device, create a new link.

**A reader can't comment.** Comments may be turned off for that link — the reader then sees "The writer has turned comments off for this copy." Create a new link with comments on and send that one.
