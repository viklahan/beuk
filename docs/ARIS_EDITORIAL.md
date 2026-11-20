# Aris Editorial Lens — W3 slice 1 (design)

V's call, 2026-11-19: Aris takes on editorial duties. The lens is V's
"Anti-Slop & Multi-Batch Integrity Gate", recut in conversation and
approved ("Keep & let's get Aris up to it"). This document is the settled
design; the approved lens text itself lives in `content/aris/persona.md`
under `## Editorial` (single source, like every Aris surface).

## Intent

A whole-book editorial read that hunts the failure signature of
multi-session drafting: cross-batch amnesia (first-meeting loops,
double-reveals, rewinds, knowing-too-early, presence/POV/tense/name
drift), prose slop (spec-sheet paste, mechanical refrains, padding), and
ledger claims (travel, calendar, counts). Beuk's edge: `ai_writes`
already records the batch boundaries where these seams live.

## Settled decisions (do not relitigate)

1. **Scope = the gate's categories 1–3 only.** Typesetting (cat 5) and
   illustration fidelity (cat 4) belong to Beuk's engines / a future
   vision pass — Aris "never sets your type".
2. **The model never does arithmetic.** It extracts claims with quotes;
   `src/aris/ledger.ts` (pure code) does the math. Slice 1 verifies
   count/attrition claims only; travel & calendar claims are extracted
   and listed for the writer, unverified (no canonical travel-time data
   exists yet) — the report says so plainly.
3. **No quote, no finding — enforced in code.** Every finding and claim
   must carry a verbatim quote from the batch text (comparison is
   whitespace-collapsed, curly-quote-normalized). A finding whose quote
   is not found is dropped and counted in a `rejected` tally that the
   report shows — the lens's honesty is itself measured.
4. **Deterministic verdict.** Any critical → `FAIL — DO NOT SHIP`;
   more than three majors in one category → FAIL; else PASS. Severity
   tallies, not model-granted scores (scores deferred, advisory-only if
   ever added).
5. **Batching is server-enumerated, client-driven.** The studio loops
   `sectionIndex` 0..count−1 against `POST /api/aris/editorial`,
   carrying an opaque `digest` (the rolling epistemic state, ≤ 16 KB)
   and accumulating findings/claims; a final
   `POST /api/aris/editorial/verdict` runs the ledger math and the gate.
   No job infra in slice 1; the run is live with visible progress and
   can be abandoned at any time.
6. **Surface: everything stays in the lazy aris module.** When opted in,
   `mountAris` adds an "Editorial" control beside the laurel; the run
   and its report live in a native `<dialog>` (the /aris plate pattern).
   Nothing is visible to a writer who never summoned Aris.
7. **No persistence in slice 1.** The report is ephemeral client state;
   persisted runs/history are W3 slice 2.
8. Sections longer than the 24k-char window are truncated for the read
   and the report flags the truncation.

## Out of scope (named so nobody wonders)

Engine checklist (encoding, TOC, folios — V's cat 5 text is preserved in
the session log and belongs to print/EPUB pre-flight), plate-content
vision checks, persisted report history, model-granted scores, covenant
schema for travel times.
