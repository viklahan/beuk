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
- Opening a page contacts no one else: the typefaces and the studio's libraries come from Beuk's own server. The few services that can be involved, and when, are listed below.

## Who runs Beuk

{{whoruns}}

For anything on this page, write to {{contact}}.

## Without an account: everything stays on your device

The studio saves your book in your browser's own storage (IndexedDB), on the device you're using. The studio also keeps a few small settings in your browser: your theme, interface language, sidebar layout, Zen scene and sound, your local writing log and streak, and the links of any reading copies you've shared. None of this is sent anywhere while you're signed out. Clearing your browser's site data removes it, and so can the browser itself when the device runs short of space, which is why the studio suggests exporting a backup now and then.

Backup files (`.beuk-backup.json`) and exports (EPUB, Word, Markdown, HTML, print files) are files you download. Where you keep them is up to you, and Beuk doesn't see them.

## With an account: what the server keeps

- **Your account:** your email address and your password, stored only as an argon2id hash. That's a one-way scramble, so the password itself is never stored and can't be read back.
- **A sign-in cookie** called `beuk_session`, so you stay signed in. It lasts {{sessiondays}} days. The server keeps only a hash of it, with a short device label and when it was last active (see "Signing in safely" below), and no IP address. Signing out deletes it, and "Sign out everywhere" deletes them all.
- **Your books on the shelf:** the whole book, with its pictures, settings and snapshot history, so it follows you to other devices.
- **Your export archive:** exports you send to the archive, with their file name, format and size, plus the results of any checks you run on them (EPUBCheck, PDF/X). These checks run on Beuk's own server, and the print renderer has no internet access at all.
- **Your writing streak:** the days you were active in the studio while signed in.
- **Password resets:** when you ask for a reset, a single-use link valid for 60 minutes. The server keeps only a hash of it.
[[if mail]]
- **Email:** Beuk sends account emails only, through the mail provider the operator has set up, and no newsletters and no marketing. They are: a welcome email with a link to confirm your address when you create an account, and that confirmation link again if you ask for it; when you change your address, a link to confirm the new address, sent to it, and a notice to your old address; the password-reset link, when you ask for one; if plans are switched on, one reminder shortly before your free trial ends; and the security emails described under "Signing in safely". The server also sends backup alerts to the operator and a test email an admin asks for, and one self-check builds a self-check message that is never delivered. None of these carries a writer's data.
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
- **A named link, if the writer made one for you.** The writer types your name when they make it, and it's shown on every page of your copy, together with the date the link was made. That way the writer can tell whose copy a page came from if it's ever passed on. Comments sent from a named link carry that name.
- **When a named link was first and last opened.** Beuk records the date and time the link was first opened, and when it was last opened (updated at most once an hour). The writer who shared it can see these. Beuk records nothing else about your reading, such as pages, time spent or your IP address. Opening a named link doesn't use the `beuk_reader` count.
- **On a named link you see only your own comments,** not other readers' names or comments.

**Anyone who has the open link can read the book and every comment left through it, including the names readers gave. A named link shows only its own comments.** The writer chooses who gets each link, can close any link at any time, and can delete comments. Reading pages load no outside fonts or scripts.

## Your authorship record

When you're signed in and export a backup or download a Word file, Beuk keeps a small stamp: a dated note of exactly which version of the book left the studio, and when. A stamp holds a fingerprint of the book (a SHA-256, a short code worked out from the book), the book's title, the book's internal id, the kind of file and the time. It never holds the book's text, and the text can't be worked back out of the fingerprint. Beuk shows your stamps only to you. They go with your account when you delete it, and they're in Download all my data.

If you lock a backup with a password, the locking happens in your browser. The password never leaves your device: it isn't sent to Beuk or stored anywhere, and Beuk can't open the file without it.

## Signing in safely

Each time you sign in, Beuk keeps a short device label with that sign-in, worked out from the name your browser gives itself, such as "Firefox on Windows". It has no version numbers and nothing finer than that. Beuk also keeps when you signed in and when that sign-in was last active (updated at most once every 10 minutes). It keeps no IP address. Your account page lists these sign-ins, so you can sign out a device you don't recognise.

If you turn on two-step sign-in, Beuk stores the secret key your authenticator app shares with it. The key is stored as it is, because the server needs it to check your codes. Your 10 recovery codes are stored only as hashes, so the codes themselves can't be read back. While you sign in, the step between your password and your code uses a short-lived key that's also stored only as a hash. It's deleted as soon as your code is accepted, after 5 wrong codes, or when you reset or change your password or sign out everywhere. Otherwise it stops working after 5 minutes and is deleted within the hour after that.

When the server can send email, Beuk sends you security emails: when your account is signed in to from a device label none of your other sign-ins has, when two-step sign-in is turned on or off, when a recovery code is used, and when new recovery codes are made. Each one says what happened and when, and nothing else. They're account emails, so they can't be turned off.

All of this goes with your account when you delete it. Download all my data includes it as security.json: whether two-step sign-in is on and since when, how many recovery codes are left, and your sign-ins with their labels and dates. It never includes the secret key, the codes or any hash.

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
A backup includes accounts (with password hashes, two-step keys, hashed recovery codes and the hashes of recent sign-in steps not yet deleted), books, exports, authorship stamps, share copies and comments, and Founders' Shelf entries. Backups on the server itself are not deleted automatically today, so something you delete can remain in older backups.
[[if offsite]]
An encrypted copy of each backup also goes to a private storage bucket with Backblaze B2. It's encrypted before it leaves the server, and only the operator holds the key. Copies are kept on a rolling schedule: one a day for {{keepdaily}} days, one a week for {{keepweekly}} weeks, and one a month for {{keepmonthly}} months. So a deleted item can survive in these copies for up to about {{keepmonthly}} months.
[[end]]

Backups are a safety net, not a promise. Keep your own exports too.

## Other services your browser or the server talks to

- **Typefaces.** The studio and these pages serve their typefaces from Beuk's own server. Your browser does not contact Google Fonts or any other font service, so no font service learns your IP address.
[[if stock]]
- **Pexels (cover photos).** When you search for a cover photo while signed in, Beuk's server sends your search words to Pexels, without your name or email. Your browser then loads the photo previews, and the photo you pick, straight from Pexels (images.pexels.com), so Pexels sees your IP address.
[[end]]
- **Openverse (cover photos, when the studio can't reach its server).** If the studio can't reach Beuk's server, its photo search goes from your browser straight to Openverse (api.openverse.org), which then sees your search words and IP address.
[[if kofi]]
- **Ko-fi.** The "Buy a Caife" button (caife is Irish for coffee) is only a link. Nothing goes to Ko-fi unless you follow it, and what you give Ko-fi after that is between you and Ko-fi.
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

- **Account, books, exports, authorship stamps, streak, checks, reading copies and comments:** until you delete them, or until the account is deleted.
- **Sign-in sessions, with their device labels:** up to {{sessiondays}} days. Expired ones are cleared automatically.
- **Two-step key and recovery codes:** until you turn two-step sign-in off, or until the account is deleted. A two-step setup you started but didn't finish keeps its key until you start again (which replaces it), until you finish (it then becomes the key two-step uses), or until the account is deleted.
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
