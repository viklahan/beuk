# Beuk

Work on your books in [Beuk](https://beuk.studio) directly from Claude. Beuk is a writing-and-typesetting studio where authors keep their manuscripts on a cloud shelf, edit chapters, and export store-ready EPUBs that must pass EPUBCheck.

This plugin connects Claude to your own Beuk account through a remote MCP server (`mcp.beuk.studio`). Once installed, you sign in to Beuk a single time (OAuth); after that Claude can act on your shelf as you.

## What it can do

- **Read** your shelf, a chapter's table of contents, a section's full text, and Beuk's book-format check.
- **Edit** one chapter at a time — Claude always shows the change and asks before writing, and never alters prose you didn't ask it to touch.
- **Export** a store-ready EPUB on the Beuk server, run a real EPUBCheck over it, and hand you a short-lived download link.
- **Report EPUBCheck honestly** — a failing verdict is surfaced with its real errors, never papered over.

## Install

In Claude Code (2.1.275 or later):

```
/plugin marketplace add viklahan/beuk-plugin
/plugin install beuk@beuk
```

On claude.ai, upload the plugin from the plugins page.

## Setup

1. Install the plugin (see the commands above, or your Claude client's plugin instructions).
2. The first time a Beuk tool runs, approve the one-time sign-in to your Beuk account.
3. Ask Claude to work on a book already on your shelf — for example, *"List my books,"* or *"Read chapter 3 of The Lantern Coast and tell me if it passes EPUBCheck."*

New books are imported in the Beuk studio (Beuk reads .docx, .md, and .txt); this plugin works on books already on your shelf.

## Privacy & support

- Privacy: https://beuk.studio/privacy
- Terms: https://beuk.studio/terms
- Support: https://beuk.studio/support
