# WWAI — Write With AI (design)

Drafted 2026-11-17 from the brainstorm with V; builder-checked the same
evening (one defect fixed: the ai_writes schema contradiction) and every
fork closed by V — see the Decisions log. Status: ready for V's final
read; building starts on his go, through a written implementation plan.
Companion decision: collaboration mode is a separate, second project —
not in this document.

## Intent

Writers get AI help inside the Beuk studio — both hands (drafting) and
judgment (analysis) — without Beuk ever becoming an AI product. The writer
brings their own model key (BYOK); Beuk pays for zero inference, forever.
The differentiator over NovelCrafter and every "AI writing tool" is not
more generation — it is that WWAI is grounded in things only Beuk has
(the typeset book as truth, server-computed canonical insights, series
covenants, real beta-reader infrastructure) and that it never fabricates:
every answer wears its evidence tier on its sleeve.

## The laws (non-negotiable, from V)

1. **Beuk core is AI-free and stays that way.** WWAI is an addon. Off =
   gone: no pane, no buttons, no key prompts, no degraded modes. Every
   core feature works identically with WWAI disabled or absent.
2. **AI proposes, the writer disposes.** Nothing enters the manuscript
   without an explicit per-insertion approval. No auto-edit, no silent
   tidying, ever.
3. **Never fabricate.** A factual claim is SOURCED (citations), or it is
   labeled unverified. Math is computed by code, not sampled from a model.
   A continuity/plot finding cites the sections it read.
4. **Typesetting is Beuk's.** WWAI never formats. It may *explain* a
   check_manuscript or EPUBCheck finding in plain words; the deterministic
   engines stay the only formatters. ("Formatting" from the feature list
   lands here: explanation yes, action no.)

## Use cases (V's list, grouped)

**Drafting (writes, gated by approval):**
- Fillers — connective tissue between written passages
- Complete a scene from what is already on the page
- Writer's block — continue from the cursor in the book's own voice
- Directed prose from a typed beat (NovelCrafter "Scene Beats" parity)
- Selection rewrites — rewrite / expand / condense a highlighted passage
  (NovelCrafter "Text Replacements" parity)
- Summarize a section (feeds recaps; NovelCrafter parity)
- Workshop chat — free-form ask-the-book conversation with covenants,
  insights and chapters as attachable context (NovelCrafter
  "Workshop/Tinker Chat" parity); findings extract to the editor as
  ordinary gated proposals

**Judgment (reads, produces reports — never writes):**
- Continuity auditor — against series covenants + the whole book
- Plot gaps and holes checker
- Character depth review
- Audience review — simulated target-reader rehearsal (labeled a
  simulation; the bridge to REAL readers is Beuk's named reading links)

**Research (answers, tiered):**
- Details/facts the writer is unsure about; fact-checking
- Historical data — period accuracy, anachronism checks
- Heavy calculations — timelines, ages, travel times, money (story math)

## Architecture — one engine, many lenses

A single WWAI engine; each capability above is a **lens**: a context
recipe (what of the book/insights/covenants is assembled) + a prompt
contract (what shape the answer must take). New capabilities later are
new lenses, not new systems.

### Placement: server-side proxy (my call — V can overrule)

The LLM call goes through the app (`/api/wwai/*`), not browser→provider:

- Context assembly needs the manuscript, insights, and covenants — all
  server-side already; the MCP server proved this composition pattern.
- One provider seam server-side vs CORS roulette per provider in the
  browser (OpenAI blocks browser calls outright).
- Enables the audit trail (law 2) at the only place it can't be bypassed.
- Honest privacy note shown in the pane: when a writer uses WWAI, the
  relevant prose travels from Beuk to *their chosen provider* under
  *their key*. Off = nothing ever leaves.

### Provider seam

`WWAIProvider` interface (chat + optional web-search capability flag +
streaming). v1 ships **OpenRouter** (one key, hundreds of models, browser
of model prices) and **Anthropic direct**. Later: OpenAI direct, Ollama
(the $0 local path). Model picked per-writer, remembered per-lens.

### BYOK key handling (my call — V can overrule)

Per-writer, encrypted at rest (AES-256-GCM under a server
`WWAI_KEY_SECRET`), shown-once on save, one-click delete, never logged,
excluded from backups' plaintext surface, revoked on account deletion.
Alternative considered and rejected: session-only paste-per-visit
(safer, but kills the mobile/second-device story and writers will paste
keys into worse places).

### The enable/disable seam (law 1)

- Server: `WWAI_ENABLED` env, default **off**. Unset ⇒ `/api/wwai/*`
  404s, exactly like billing's unset⇒501 pattern.
- Writer: per-account opt-in in settings, default off. Both must be on.
- Client: the pane is one lazily-loaded module behind one mount-point
  `if`. Core imports nothing from WWAI. Removing the module folder must
  leave the studio compiling and every test green — that is the
  structural test of the seam, and it gets a CI guard.

### Grounding tiers (law 3) — the Research lens contract

Every research answer is one of:

| Tier | Meaning | Rendering |
| :- | :- | :- |
| SOURCED | provider web search returned citations | answer + links |
| CALCULATED | computed by Beuk code (deterministic evaluator), not the model | exact result + the arithmetic shown |
| MODEL-KNOWLEDGE | model's training data, no sources | amber "unverified — check before print" |

The model never does arithmetic: the engine extracts the calculation,
runs it in a sandboxed evaluator, and hands the result back. A provider
without web search simply cannot produce SOURCED — the tier system makes
that visible instead of hiding it.

### Judgment lens contracts

Reports, never insertions. Every finding cites its evidence: continuity
findings name the covenant entry + the section ids that conflict; plot
and character findings quote the passages they rest on. A finding
without a citation does not render. Audience review opens with its
label: "simulated readers — a rehearsal. For real ones, send a reading
link." Reports are disposable by default; the writer can pin one to the
book's notes.

### Drafting lens mechanics (law 2)

Proposal appears in the pane as a diff-style insert block (ghost text at
the cursor position for "continue"; a before/after card for scene
completion). Buttons: Insert / Edit-then-insert / Discard. On Insert:

- the text enters the section through the same revision-checked write
  path as any edit (conflict ⇒ re-read, never blind overwrite);
- one row lands in **`ai_writes`** (migration 029): writer, book,
  section, lens, **action kind** (generated-new vs replaced-own-prose),
  provider+model, the affected span's bytes_before/bytes_after,
  **writer_edited** (did the writer modify the proposal before
  inserting), created_at. The app writes it — same discipline as
  `mcp_writes` (028), but deliberately not its columns: 028 records
  whole-doc sizes, 029 records the span's facts. (Corrected per the
  builder check — the draft said "bytes inserted, mirroring mcp_writes,"
  which was self-contradictory.)
- **Rows record facts, never policy** (my call, from the builder
  check): whether a condense of the writer's own paragraph "counts" as
  AI-assisted, or how writer-edited AI text is classified, is a
  disclosure question answered at read time by the receipt generator —
  so when a store's AI-disclosure definition shifts, the same rows
  answer the new question with no backfill.

`ai_writes` powers the quiet killer feature: a per-book **AI-assistance
summary** (which sections, how much, which lens) — the honest answer to
KDP/store AI-disclosure questions, generated instead of guessed. No
competitor hands writers that receipt.

## Surface — the quiet desk (decided with V, 2026-11-17 mockup session)

**Summon-only. Nothing is parked on screen.** V's words: don't overwhelm
the writer. NovelCrafter's own pattern confirms it (their docs: "the
integration with AI is just a bonus"; slash menu + selection-triggered
replacements + chat exiled from the editor). WWAI's five moments:

1. **Idle (enabled):** one dim glyph in the toolbar. That is the entire
   footprint. Disabled: not even that.
2. **`/` in the manuscript** opens the summon menu: beat (directed
   prose), continue the story, fill this gap, summarize section,
   workshop (ask the book), audit (continuity · plot · character),
   fact/calc check. One menu owns every lens — no toolbar sprawl.
3. **Selection** raises a floating toolbar: rewrite · expand · condense ·
   fact-check (minimum-selection threshold like NovelCrafter's 4 words;
   exact N is the builder's). Gone on deselect.
4. **Proposals are ghost text** at the point of insertion: insert ✓ /
   edit-first / discard ✕ / retry ↻. Insert goes through the
   revision-checked write path and lands an `ai_writes` row.
5. **Reports open a bottom drawer** — audits and research answers only.
   The chapter never leaves the screen. **Workshop chat is its own full
   view** (V's call, 2026-11-17 mockup session): a Workshop room entered
   from the summon menu, conversation with the book, covenants/insights/
   chapters as attachable context chips, one step back to the studio;
   anything it drafts returns to the editor as an ordinary gated
   proposal, never written from the room.

Exactly one WWAI surface exists at a time. **Host: Studio 2.0**
(`studio/`, decided by V 2026-11-17) — WWAI's editor integration is
built once, in the editor that has a future; it ships with or just
after the 2.0 cutover and is never built into `client/`.

## Phases (each closes on evidence, binary exit)

**Help docs are part of every phase (V, 2026-11-17):** each phase's
features land with their matching guide in Beuk's Help, written in the
house voice, and every new page/table is classified in the three guard
registries before the phase can close. The WWAI help set also carries
the plain-words privacy note (what travels to the writer's provider,
under whose key) and the BYOK setup walkthrough (getting an OpenRouter
or Anthropic key, what it costs, how to revoke it).

- **Phase W1 — the seam + BYOK + Draft lens.** Env gate, opt-in, key
  vault, provider seam (OpenRouter + Anthropic), the summon menu +
  selection toolbar + ghost-proposal mechanics (beat, continue, fill,
  rewrite/expand/condense), `ai_writes` migration + audit.
  *Exit:* on the bench, a writer completes a scene with their own key and
  the row is in `ai_writes`; with `WWAI_ENABLED` unset there is zero WWAI
  surface anywhere and the full suite is green; deleting the WWAI client
  module leaves the studio compiling; the Help guide for writing with
  WWAI + BYOK setup is live and registered.
  Summarize-section ships in W1 too (my call): it is a one-shot Draft
  action, and NovelCrafter parity's cheapest item.
- **Phase W2 — the Workshop room** (my call on ordering: it is
  NovelCrafter's flagship and V prioritized parity; audits are ours
  alone and can follow). Chat view, context chips (chapter, covenants,
  insights), extraction back to the editor as gated proposals only.
  *Exit:* a workshop conversation that cites attached context and lands
  one extracted proposal through the W1 approval path; Help guide live.
- **Phase W3 — judgment lenses.** Continuity, Plot, Character as cited
  reports in the drawer (and askable in the Workshop room).
  *Exit:* a continuity report on a real covenant-bearing series book, every
  finding citing covenant entry + sections; zero insertion capability;
  Help guide live.
- **Phase W4 — research + story math.** Grounding tiers, the calculator
  path, historical/period checks.
  *Exit:* one SOURCED answer with live citations, one CALCULATED result
  matching hand arithmetic exactly, one deliberately ungroundable query
  wearing the unverified label; Help guide live.
- **Phase W5 — audience rehearsal + the disclosure receipt.** Persona
  review lens + the per-book AI-assistance summary export (the receipt
  generator reads `ai_writes` facts and applies the then-current store
  definitions).
  *Exit:* a persona review on a bench chapter; a generated disclosure
  summary derived from `ai_writes` rows exactly; Help guide live.

Billing posture: WWAI is an obvious paid-tier lever later (entitlements
file exists) but Gate 3 is blocked on legal; nothing here depends on
billing.

## Non-goals and anti-goals

- **Non-goals:** Beuk-paid inference or a credits business; real-time
  anything; OpenAI-only shortcuts; training anything on user prose;
  AI covers (aborted 2026-11-17 — stays dead); collaboration mode (second
  project).
- **Anti-goals (failure even if it "works"):** a writer finds AI text in
  their book they didn't approve; a fabricated "fact" ships in a printed
  book because WWAI stated it confidently; Beuk core grows an AI
  dependency; the pane nags writers who opted out.

## Decisions log (all forks closed 2026-11-17)

1. **Host studio: 2.0** (`studio/`) — V. Built once, in the editor with
   a future; never into `client/`.
2. **Key custody: encrypted server vault** — V. AES-256-GCM under
   `WWAI_KEY_SECRET`, show-once, one-click delete, excluded from backup
   plaintext, dies with the account.
3. **Workshop chat: its own full view**, not the drawer — V, mockup
   session.
4. **Naming: V is choosing the writer-facing name himself.** "WWAI" is
   the working token, all help copy is written name-agnostic, and W1
   cannot CLOSE — though it can build — until the name lands, because
   the Help guides carry it.
5. My calls, standing unless V overrules: server-side proxy placement;
   OpenRouter + Anthropic as v1 providers; `ai_writes` records facts
   not policy; summarize ships in W1; Workshop room is W2 (parity
   before differentiation).

## What's left to the builder

Model defaults per lens; prompt contracts' exact wording; streaming UX;
token-budget chunking for whole-book judgment passes on long books
(insights + covenants travel compressed; chapters stream in windows);
rate limiting; the evaluator sandbox choice; error surfaces (provider
down, key invalid, quota exhausted — all verbatim, per house style).
