title: Privacy
updated: 2026-10-25
note: Drafted from the code on 2026-10-25 (docs/privacy-inventory.md has the file:line evidence for every statement). Not legal advice. Review with a lawyer before relying on it.
===
# How Beuk handles your data

Beuk is a studio for turning a manuscript into a book. This page says plainly what Beuk keeps, where it keeps it, who else sees any of it, and what you can do about it. It's written from what the software actually does. If the software changes, this page changes with it.

## The short version

- You can use the studio without an account. Your book is then saved **in your own browser, on your device**, and doesn't reach Beuk's server.
- If you create an account (Beuk calls it your shelf), the server keeps your email address, a scrambled form of your password, and the books, exports and share links you put there.
- No analytics, no advertising, no tracking cookies, and Beuk doesn't sell your data.
- One thing reaches a third party on every page: the typefaces load from Google Fonts, so your browser contacts Google. The details are below.

## Who runs Beuk

{{whoruns}}

For anything on this page, write to {{contact}}.

## Without an account: everything stays on your device

The studio saves your book in your browser's own storage (IndexedDB), on the device you're using. The studio also keeps a few small settings in your browser: your theme, interface language, sidebar layout, Zen scene and sound, your local writing log and streak, and the links of any reading copies you've shared. None of this is sent anywhere while you're signed out. Clearing your browser's site data removes it, and so can the browser itself when the device runs short of space, which is why the studio suggests exporting a backup now and then.

Backup files (`.beuk-backup.json`) and exports (EPUB, Word, Markdown, HTML, print files) are files you download. Where you keep them is up to you, and Beuk doesn't see them.

## With an account: what the server keeps

- **Your account:** your email address and your password, stored only as an argon2id hash. That's a one-way scramble, so the password itself is never stored and can't be read back.
- **A sign-in cookie** called `beuk_session`, so you stay signed in. It lasts {{sessiondays}} days. The server keeps only a hash of it, with no IP address and no device details. Signing out deletes it, and "Sign out everywhere" deletes them all.
- **Your books on the shelf:** the whole book, with its pictures, settings and snapshot history, so it follows you to other devices.
- **Your export archive:** exports you send to the archive, with their file name, format and size, plus the results of any checks you run on them (EPUBCheck, PDF/X). These checks run on Beuk's own server, and the print renderer has no internet access at all.
- **Your writing streak:** the days you were active in the studio while signed in.
- **Password resets:** when you ask for a reset, a single-use link valid for 60 minutes. The server keeps only a hash of it.
[[if mail]]
- **Email:** Beuk sends one kind of email, the password-reset link, through the mail provider the operator has set up. No newsletters and no marketing.
[[end]]
[[if billing]]
- **Payments:** if you subscribe to a paid plan, the payment itself happens on Stripe's checkout page and your card details go to Stripe, never to Beuk. Beuk gives Stripe your account email and an account id, and keeps Stripe's customer and subscription ids and the subscription's status.
[[end]]

## Reading copies and beta readers

When you share a reading copy, the server stores a frozen copy of the book for it. Your readers don't need an account. What a reader sends:

- **A comment**, and the passage they selected, if any.
- **Their name**, if they give one. The writer can require it.
- **A one-way hash of their IP address combined with the link**, kept with each comment only to deal with abuse. It isn't shown to anyone. Because IP addresses are few enough to try one by one, this is abuse control, not anonymity.
- **A cookie** called `beuk_reader`, a random value that lasts a year and only works on reading pages. Beuk uses it to count how many different browsers opened a copy. It's stored hashed.

**Anyone who has the link can read the book and every comment on it, including the names readers gave.** The writer chooses who gets the link, can close it at any time, and can delete comments. Reading pages load no outside fonts or scripts.

## The help pages and the Founders' Shelf

- **Help search** keeps the first 200 characters of what was searched, the number of results and which result was opened, so the guides can get better. It stores no account, no IP address, nothing about who searched.
- **The Founders' Shelf form** keeps the name, email address and line about your writing that you type into it. The operator reads them to send invitations. To be taken off the list, write to {{contact}}.

## Server logs and security

- The web server keeps **no access log** of ordinary visits.
- When a request fails inside the web server (for example, while the app is restarting), it writes an error line. That line includes the requesting IP address, the address asked for and the browser's identifying string. The app also writes a line when something goes wrong inside it. Each container's logs are rotated by size: at most three files of 10 MB are kept, and the oldest is deleted when a new one starts. How long that covers depends on traffic; there is no time limit.
- To slow down attacks, the server counts recent attempts per IP address (sign-in, password reset, comments, searches, the Founders' form) **in memory only**. Nothing is written to disk, and a restart forgets it.
- If your browser blocks something because of the site's security policy, it may send a report. Beuk stores nothing from it and logs one line with no address, no browser details and no page text.

## Backups

[[if schedule]]
The server makes a backup of its data every {{backuphours}} hours, so a broken disk doesn't lose your books.
[[end]]
[[if noschedule]]
The operator makes backups of the server's data by hand, so a broken disk doesn't lose your books.
[[end]]
A backup includes accounts (with password hashes), books, exports, share copies and comments, and Founders' Shelf entries. Backups on the server itself are not deleted automatically today, so something you delete can remain in older backups.
[[if offsite]]
An encrypted copy of each backup also goes to a private storage bucket with Backblaze B2. It's encrypted before it leaves the server, and only the operator holds the key. Copies are kept on a rolling schedule: one a day for {{keepdaily}} days, one a week for {{keepweekly}} weeks, and one a month for {{keepmonthly}} months. So a deleted item can survive in these copies for up to about {{keepmonthly}} months.
[[end]]

Backups are a safety net, not a promise. Keep your own exports too.

## Other services your browser or the server talks to

- **Google Fonts.** The studio and these pages load their typefaces from Google (fonts.googleapis.com and fonts.gstatic.com). Your browser fetches them directly, so **Google receives your IP address** and the usual browser details. Some European courts have found that doing this without consent is unlawful, for example the Munich Regional Court on 20 January 2022 (LG München I, 3 O 17493/20). Serving the fonts from Beuk's own server would stop this; until that is done, this is how it works.
[[if stock]]
- **Pexels (cover photos).** When you search for a cover photo while signed in, Beuk's server sends your search words to Pexels, without your name or email. Your browser then loads the photo previews, and the photo you pick, straight from Pexels (images.pexels.com), so Pexels sees your IP address.
[[end]]
- **Openverse (cover photos, when the studio can't reach its server).** If the studio can't reach Beuk's server, its photo search goes from your browser straight to Openverse (api.openverse.org), which then sees your search words and IP address.
[[if kofi]]
- **Ko-fi.** The "Leave a tip" button is only a link. Nothing goes to Ko-fi unless you follow it, and what you give Ko-fi after that is between you and Ko-fi.
[[end]]
[[if billing]]
- **Stripe** handles paid plans, as described above.
[[end]]

The studio loads no scripts from anyone else: its libraries are served from Beuk's own server. {{hosting}}. The services above may handle data in other countries.

## Why Beuk uses your data (the legal bases, in plain words)

- **To give you the service you asked for:** your account, shelf, archive, checks, reading copies and reset emails. Under the EU and UK GDPR this is "performance of a contract".
- **Legitimate interests:** keeping the service safe and working (rate limits, the hashed IP on comments, error logs, backups) and improving the help pages from anonymous search counts.
- **Your choice:** the Founders' Shelf form, which you fill in only if you want to.

## How long things are kept

- **Account, books, exports, streak, checks, reading copies and comments:** until you delete them, or until the account is deleted.
- **Sign-in sessions:** up to {{sessiondays}} days. Expired ones are cleared automatically.
- **Password-reset links:** expire after 60 minutes, and are cleared the next time anyone asks for a reset.
- **Server error logs:** rotated by size (at most 3 × 10 MB per container), with no time limit.
- **Help search records, Founders' Shelf entries and backups on the server:** no automatic limit yet.
- **In-memory attempt counts:** until the server restarts.

## Your rights, and how to use them

Depending on where you live (for example under the EU or UK GDPR, or California's CCPA), you may have the right to see the data held about you, correct it, delete it, take it with you, limit or object to its use, and complain to your local data-protection authority. Beuk doesn't sell personal information and doesn't pass it to anyone for advertising. Here's what you can do yourself, today:

- **See and take your data:** export any book (EPUB, Word, Markdown, HTML, print files, or a `.beuk-backup.json` backup) and download anything in your export archive.
- **Correct it:** edit your books in the studio, and change your password from Your shelf → Account & security.
- **Delete it:** delete books from your shelf, exports from your archive, and reading copies and their comments.
- **Delete your account:** there's no button for this yet. Write to {{contact}} from the address on the account, and the account and everything on it will be deleted. Copies can remain in backups for the time described under Backups.
- **Anything else** (a copy of everything held about you, a Founders' Shelf entry, a question): write to {{contact}}.

## Changes to this page

The date at the top shows when this page last changed. If Beuk starts keeping something new, this page is updated to say so.
