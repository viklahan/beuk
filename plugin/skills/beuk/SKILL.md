---
name: beuk
description: Use when the user wants to work on their books in Beuk (beuk.studio) — list their shelf, read or edit a chapter, run EPUBCheck, or build and download a store-ready EPUB — through the connected Beuk account. Triggers on mentions of Beuk, their manuscript/book/shelf/chapter, EPUBCheck, or exporting an EPUB.
---

# Beuk

Beuk (beuk.studio) is a writing-and-typesetting studio: a writer keeps their books on a cloud "shelf," edits chapters, and exports store-ready EPUBs that must pass EPUBCheck. This plugin connects Claude to the user's own Beuk account through a remote MCP server (`mcp.beuk.studio`). The first time it's used the user signs in to Beuk once (OAuth); after that the tools act as that writer.

## The tools

Read (always safe):
- `list_books` — the writer's shelf: id, title, revision, timestamps. Metadata only.
- `get_chapter` — one book's table of contents (with only `book_id`), or one section's full text (with `chapter_number`, 1-based among body sections, or `section_id`).
- `check_manuscript` — Beuk's book-format check: honest status, warnings, upgrade notes. Read-only.
- `get_job_status` — the status and real result of an EPUBCheck or PDF job by id.

Write / export (change or produce something):
- `update_chapter` — replace ONE section's text and/or title. See the rules below.
- `export_epub` — build the store-ready EPUB on the server and archive it; returns an export id.
- `run_epubcheck` — enqueue a real EPUBCheck run over an export; returns a job id to poll.
- `get_export_link` — a short-lived signed download URL for an export (opens in any browser).

## How to work with it

**Never change the writer's words without asking.** `update_chapter` writes exactly the text you pass, to exactly one section. Before any `update_chapter`, show the writer what you intend to change and get a clear yes. Never "tidy," reformat, or rewrite prose the writer didn't ask you to touch. Edits are one section at a time — resolve the section first (read the TOC with `get_chapter`), then replace only that section.

**Respect revisions.** `update_chapter` carries the revision the book was read at. If it returns a conflict, the shelf copy changed underneath you (the writer edited in the studio) — re-read the chapter and reconcile; never force a blind overwrite.

**An EPUB is only done when EPUBCheck passes.** After `export_epub`, run `run_epubcheck` and report the **real** verdict verbatim. A FAIL is a real result, not something to paper over — surface the actual errors (e.g. an empty title, a bad manifest) so the writer can fix them. Never claim an export passed without the verdict in hand.

**Jobs are polled, not awaited.** `run_epubcheck` returns a job id immediately; the check runs on the server. Poll `get_job_status` until it's `done` or `failed`. Don't promise a result before the job finishes, and don't invent one.

**Surface Beuk's own words.** When a tool fails, it returns Beuk's own message (e.g. "manuscript not found," "revision conflict"). Report that; don't soften or guess around it.

**Manuscripts come from the writer's files** — Beuk imports .docx, .md, and .txt. If the writer wants to add a new book or import a file, that's done in the Beuk studio; this plugin works on books already on the shelf.

## A typical loop

"Shorten chapter 3 by 20%, re-export, and tell me if it still passes EPUBCheck":
1. `get_chapter` (book_id only) for the TOC, then `get_chapter` (chapter_number 3) for the text.
2. Draft the shortened version, **show the writer, get approval**, then `update_chapter`.
3. `export_epub` → `run_epubcheck` → poll `get_job_status` → report the verbatim verdict.
4. If they want the file, `get_export_link` for a download URL (note it expires).
