---
title: EPUBCheck on the server
blurb: The full, official EPUBCheck, run by Beuk's server over an export saved to Your Archive — and an honest "not configured" where it cannot run.
guide: check-your-book
---
The validator in your browser is structural, and Beuk does not claim EPUBCheck's authority for a lighter set of checks. EPUBCheck is the official suite — the one many stores run on ingest — and the full thing runs on Beuk's server, over the very file you archived.

## Steps
1. Signed in, open **Export** and, under **Your Archive**, choose **Save this EPUB**. The archive keeps the format, the preset, the filename and a SHA-256 fingerprint of the bytes, so a re-download can be verified as the very same file.
   say: Signed in, open Export and, under Your Archive, choose Save this EPUB. The archive keeps the format, the preset, the filename, and a fingerprint of the bytes, so a re-download can be verified as the very same file.
   do: click "Export"; wait 1; show "Your Archive"; click "Save this EPUB"; wait 2
2. Choose **Run EPUBCheck** beside the saved export. The server runs the official suite as a job, and the studio follows the job until it is done or failed.
   say: Choose Run EPUBCheck beside the saved export. The server runs the official suite as a job, and the studio follows the job until it is done, or failed.
   do: click "Run EPUBCheck"; wait 2
3. A book with findings comes back as a *finished* check that says it did not pass: the check worked; the book needs a fix. Each message keeps EPUBCheck's own code and location — file, line, column — and carries its BEUK- code beside it, so the plain-language entry is one step away.
   say: A book with findings comes back as a finished check that says it did not pass. The check worked. The book needs a fix. Each message keeps EPUBCheck's own code and location, and carries its BEUK code beside it, so the plain language entry is one step away.
   do: show "Your Archive"
4. And an honest limit: the full check runs only where the server has EPUBCheck installed. Where it hasn't, the check says so and gives no result — never a pass it didn't earn.
   say: And an honest limit. The full check runs only where the server has EPUBCheck installed. Where it hasn't, the check says so and gives no result. Never a pass it didn't earn.
   do: show "Your Archive"

## Takeaway
Browser checks for every export, the official suite for the one you ship: when EPUBCheck passes the archived file, the store is running a test your book has already sat.
