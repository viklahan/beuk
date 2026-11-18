# Aris W1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Aris Phase W1 — the seam, the BYOK key vault, three provider adapters, the Draft lens (beat/continue/fill/summarize + selection rewrites) in Studio 2.0 with ghost proposals, the `ai_writes` audit, and the `/aris` page — with zero trace anywhere when `ARIS_ENABLED` is unset.

**Architecture:** Server-side proxy under `/api/aris/*` (session-auth only; no bearer access in W1). The studio is local-first (Yjs), so insertion happens client-side; auditability is preserved by an HMAC-signed proposal token minted by `/draft` and verified by `/insert`, which writes the `ai_writes` row from token-carried facts the client cannot forge. Persona lives in one file (`content/aris/persona.md`) that renders the public page and seeds every system prompt. Non-streaming in W1 (no SSE exists anywhere in the codebase; streaming is a later, separate addition).

**Tech Stack:** Node 20 + TypeScript + Express 4 (ESM, `.js` import suffixes), Postgres/PGlite, `node:test` + tsx server-side; React + TipTap 3 (ProseMirror) + Yjs + Vitest in `studio/`. **No new npm dependencies, either side.** Crypto via `node:crypto` only.

**Spec:** `docs/ARIS_DESIGN.md` (this plan implements its Phase W1; the four laws and the Decisions log govern every task).

## Global Constraints

- `ARIS_ENABLED` unset ⇒ every `/api/aris/*` route answers `404 {"error":"not found"}` — byte-identical to the app's `/api` catch-all, so Aris is indistinguishable from absent. Enabled but `ARIS_KEY_SECRET` missing ⇒ `503 {"error":"aris misconfigured: ARIS_KEY_SECRET is not set"}`.
- All Aris API routes use `requireAuth(db)` (cookie session). No `sessionOrScopedBearer` — bearers have no Aris access in W1.
- Server validation is manual per house style (no zod server-side).
- Voice never enters manuscript prose: `/draft` for drafting actions returns prose only; persona voice applies to no W1 surface except the `/aris` page copy (drawer/workshop arrive in later phases).
- New env vars travel all four stops: `.env.example`, `docker-compose.yml` app environment, `Config`/`loadConfig` in `src/config.ts`, `testConfig` in `tests/helpers.ts`. `ARIS_KEY_SECRET` additionally joins `SECRET_CONFIG_KEYS` (`src/housekeeping/backup.ts:126`) and `collectSecrets` (`src/housekeeping/scrub.ts:10`).
- Every new table is classified: `BACKUP_TABLES`/`EXCLUDED_TABLES` (`src/housekeeping/backup.ts`) and `ACCOUNT_DELETED_TABLES`/`ACCOUNT_DETACHED_TABLES` (`src/account/data.ts`). Every new page joins the english-only ledger (`tests/fixtures/l10n-english-only.json`), the sitemap `paths` (`src/routes/site.ts:52`), the Caddyfile, and both service workers' network-only regex (`client/sw.js`, `client/assets/sw.js`).
- Commit after every task, message naming exactly what the diff holds.

## Review Focus

Failure modes the spec implies but no obvious test covers — each line's test is added to the owning task below:

1. **Non-Latin and multibyte text** (V ships RTL/Arabic support): byte counts vs char counts must be defined — `ai_writes` stores UTF-8 byte lengths via `Buffer.byteLength`. → Task 8 test with Devanagari + emoji.
2. **A hung provider** must not hang the request: every outbound call carries `AbortSignal.timeout(60_000)` and a timeout answers `502`. → Task 5 test with a stub that never responds.
3. **An invalid stored key** (provider answers 401): `/draft` returns `502 {"error":"<provider> refused the request","detail":<upstream message, ≤300 chars>}` — never a crash, never silence. → Task 7 test.
4. **A giant chapter** must not ship a megabyte prompt: context is windowed to the 24,000 characters around the cursor/selection (value pinned here). → Task 6 test with an oversized section.
5. **RTL chapters**: the summon menu, toolbar and ghost decoration render inside a `dir="rtl"` editor without breaking layout (editor already carries `dir`). → Task 10 vitest asserting the ghost widget inherits direction.

---

### Task 1: Config, env plumbing, and the gate

**Files:**
- Modify: `src/config.ts` (Config interface + loadConfig), `tests/helpers.ts` (testConfig), `.env.example`, `docker-compose.yml`, `src/housekeeping/backup.ts:126` (SECRET_CONFIG_KEYS), `src/housekeeping/scrub.ts:10` (collectSecrets), `src/app.ts` (mount before the `/api` catch-all at l.261)
- Create: `src/aris/routes.ts`
- Test: `tests/aris-gate.test.ts`

**Interfaces:**
- Produces: `Config` fields `arisEnabled: boolean` (parse: `(env.ARIS_ENABLED ?? '').toLowerCase() === 'true'`), `arisKeySecret: string | null`, `arisOpenrouterBase: string` (default `https://openrouter.ai/api/v1`), `arisAnthropicBase: string` (default `https://api.anthropic.com`).
- Produces: `arisRoutes(db: Db, config: Config): Router` mounted at `/api/aris`; router-level gate middleware; `GET /api/aris/status` → `200 {"enabled":true,"optedIn":false,"voice":"laconic","keys":[]}` (optedIn/keys real in Tasks 3–4).

- [ ] **Step 1: Write the failing tests** in `tests/aris-gate.test.ts` (boot per oauth.test.ts pattern: `createTestDb` + `startTestServer`):
  - `'with ARIS_ENABLED unset every /api/aris route is a catch-all-identical 404'` — GET `/api/aris/status` with default testConfig ⇒ status 404, body exactly `{error:'not found'}`.
  - `'enabled without ARIS_KEY_SECRET is an honest 503'` — overrides `{arisEnabled:true, arisKeySecret:null}` ⇒ 503, error `aris misconfigured: ARIS_KEY_SECRET is not set`.
  - `'status answers for a signed-in writer when configured'` — overrides `{arisEnabled:true, arisKeySecret:'test-secret'}`, registerUser ⇒ 200 with the shape above.
  - `'status requires a session'` ⇒ 401.
- [ ] **Step 2: Run** `node --import tsx --test tests/aris-gate.test.ts` — expect FAIL (router absent; testConfig missing fields is a tsc error first).
- [ ] **Step 3: Implement** the config fields in all four stops + both secret registries; `arisRoutes` with gate middleware then `requireAuth(db)` then status handler; mount in app.ts.
- [ ] **Step 4: Run the test file** — expect PASS. Run `tests/legal.test.ts` — expect PASS (env/compose formatting).
- [ ] **Step 5: Commit** `feat(aris): config plumbing and the ARIS_ENABLED gate`

### Task 2: Migration 029 and the registries

**Files:**
- Create: `migrations/029_aris.sql`
- Modify: `src/housekeeping/backup.ts` (BACKUP_TABLES / EXCLUDED_TABLES), `src/account/data.ts` (ACCOUNT_DELETED_TABLES)
- Test: existing guards — `tests/restore-coverage.test.ts`, `tests/account-portal.test.ts`

**Interfaces:**
- Produces tables (029 header comments cite ARIS_DESIGN.md):
  - `aris_settings(user_id uuid pk references users(id) on delete cascade, opted_in boolean not null default false, voice text not null default 'laconic' check (voice in ('laconic','homeric')), updated_at timestamptz not null default now())`
  - `aris_keys(id uuid pk default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, provider text not null check (provider in ('openrouter','anthropic','openai-compat')), key_ciphertext text not null, key_last4 text not null, base_url text, created_at timestamptz not null default now(), unique(user_id, provider))`
  - `ai_writes(id uuid pk default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, manuscript_id uuid not null, section_id text not null, lens text not null, action text not null, kind text not null check (kind in ('generated-new','replaced-own-prose')), provider text not null, model text not null, proposal_chars integer not null, bytes_before integer not null, bytes_after integer not null, writer_edited boolean not null, nonce text not null, created_at timestamptz not null default now(), unique(user_id, nonce))` + index `ai_writes_manuscript_idx (manuscript_id, created_at desc)`

- [ ] **Step 1: Run both guard tests first** — expect FAIL after writing only the migration (unclassified tables).
- [ ] **Step 2: Write** `migrations/029_aris.sql` per the shapes above, house header style (028 as the model).
- [ ] **Step 3: Classify** — BACKUP_TABLES += `aris_settings`, `ai_writes`; EXCLUDED_TABLES += `aris_keys: 'provider keys are re-pasted by the writer after a restore; they never leave the box, even encrypted'`; ACCOUNT_DELETED_TABLES += all three.
- [ ] **Step 4: Run** `tests/restore-coverage.test.ts` and `tests/account-portal.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(aris): migration 029 — settings, key vault, ai_writes audit`

### Task 3: The vault and key routes

**Files:**
- Create: `src/aris/vault.ts`
- Modify: `src/aris/routes.ts`
- Test: `tests/aris-vault.test.ts`

**Interfaces:**
- Produces: `encryptKey(secret: string, plaintext: string): string` (AES-256-GCM; key = `scryptSync(secret,'beuk-aris-vault',32)`; format `v1:<iv b64>:<tag b64>:<ct b64>`), `decryptKey(secret: string, ciphertext: string): string` (throws on tamper/wrong secret).
- Produces routes: `PUT /api/aris/key` body `{provider, apiKey, baseUrl?}` → `200 {"provider":…, "last4":…}` (never echoes the key; `baseUrl` accepted only for `openai-compat`, must parse as https URL); `DELETE /api/aris/key/:provider` → 204; status `keys` becomes `[{provider,last4,baseUrl?}]`.

- [ ] **Step 1: Failing tests** — `'vault round-trips and refuses tampering'` (roundtrip; flipped ct byte throws; wrong secret throws); `'a saved key is shown once as last4, retrievable never'` (PUT → last4; status shows last4, no ciphertext/plaintext anywhere in body); `'baseUrl is openai-compat only and must be https'` (PUT anthropic+baseUrl ⇒ 400; `http://` ⇒ 400); `'delete removes the key'` (DELETE ⇒ 204, status keys empty).
- [ ] **Step 2: Run** the file — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(aris): encrypted BYOK vault and key routes`

### Task 4: Settings — opt-in and voice

**Files:** Modify `src/aris/routes.ts`; Test `tests/aris-settings.test.ts`

**Interfaces:**
- Produces: `PUT /api/aris/settings` body `{optedIn?: boolean, voice?: 'laconic'|'homeric'}` → 200 with the status shape; upsert into `aris_settings`.
- Produces for later tasks: internal `requireOptIn` middleware — engine routes (Tasks 7–8) answer `403 {"error":"summon Aris on your /aris page first"}` until `opted_in`.

- [ ] **Step 1: Failing tests** — `'opt-in and voice persist'` (PUT both; status reflects); `'an invalid voice is refused'` (400); `'engine routes refuse before opt-in'` (POST `/api/aris/draft` ⇒ 403 with the exact copy above — the route itself lands in Task 7; assert via a placeholder handler behind `requireOptIn` now).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): opt-in and voice settings`.

### Task 5: The provider seam and three adapters

**Files:**
- Create: `src/aris/providers.ts`
- Test: `tests/aris-providers.test.ts` (stub upstreams per `tests/stock.test.ts`: `node:http` createServer, base URL injected via config/baseUrl)

**Interfaces:**
- Produces:
  ```ts
  export type ArisMessage = { role: 'system'|'user'|'assistant'; content: string };
  export type ArisReply = { text: string; model: string };
  export class ArisUpstreamError extends Error { constructor(public provider: string, public status: number|null, public detail: string) }
  export interface ArisProvider { id: 'openrouter'|'anthropic'|'openai-compat'; chat(o: { apiKey: string; model: string; messages: ArisMessage[]; maxTokens: number; baseUrl?: string }): Promise<ArisReply>; }
  export function providerFor(id: string, config: Config): ArisProvider;
  ```
- Every `fetch` carries `AbortSignal.timeout(60_000)`. OpenRouter + openai-compat speak OpenAI chat-completions (`POST {base}/chat/completions`, system message in `messages`); Anthropic speaks Messages (`POST {base}/v1/messages`, `anthropic-version: 2023-06-01`, system as top-level `system`). Upstream non-2xx or malformed ⇒ `ArisUpstreamError` with the upstream's own message truncated to 300 chars.

- [ ] **Step 1: Failing tests** — `'openrouter adapter speaks chat-completions'` (stub asserts path+auth header+body shape, returns a reply; adapter returns its text/model); `'anthropic adapter speaks messages'` (same for the Anthropic shape); `'openai-compat uses the stored baseUrl'`; `'an upstream 401 surfaces as an ArisUpstreamError carrying the upstream words'`; `'a hung upstream times out as an ArisUpstreamError'` (stub never responds; timeout overridable short in tests via an options arg defaulting 60 000).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): provider seam — openrouter, anthropic, openai-compat`.

### Task 6: Persona and prompt contracts

**Files:**
- Create: `content/aris/persona.md`, `src/aris/persona.ts`, `src/aris/prompts.ts`
- Test: `tests/aris-prompts.test.ts`

**Interfaces:**
- `content/aris/persona.md` — the single source, four `## ` sections pinned: `## Page` (the /aris public copy: who Aris is, ἄριστος/aristeia, the covenant of nevers, summoning, BYOK plain-words, privacy note), `## Core` (system-prompt base: the four laws as instructions — propose only, never claim unverifiable facts, prose output carries no commentary), `## Laconic`, `## Homeric` (voice modifiers). Write real content in the house voice — this file is a deliverable, not a stub; the spec's persona section is the brief.
- Produces: `loadPersona(): { page: string; core: string; laconic: string; homeric: string }` (cached read); `buildDraftPrompt(o: { action: 'beat'|'continue'|'fill'|'summarize'|'rewrite'|'expand'|'condense'; instruction?: string; sectionText: string; cursorOffset?: number; selection?: {text: string}; bookTitle: string; covenants: {kind:string;name:string;note:string}[] }): ArisMessage[]` — context windowed to **24 000 chars** around cursor/selection; covenant entries serialized compactly; system = core (voice modifiers are NOT applied to drafting prompts — prose never carries voice).

- [ ] **Step 1: Failing tests** — `'persona file parses into its four sections'` (all non-empty, Page mentions the opt-in and the key, Core states propose-only); `'draft prompts window a giant section to 24k chars around the cursor'` (300k-char section ⇒ user content ≤ 24 000 chars, cursor text present); `'selection actions carry the selection and covenants'`; `'drafting prompts never include voice modifiers'` (Homeric text absent from messages).
- [ ] **Steps 2–5:** FAIL → implement (persona.md content included) → PASS → commit `feat(aris): persona single-source and draft prompt contracts`.

### Task 7: POST /api/aris/draft

**Files:** Modify `src/aris/routes.ts`; Create `src/aris/token.ts`; Test `tests/aris-draft.test.ts`

**Interfaces:**
- `src/aris/token.ts`: `mintProposalToken(secret: string, p: { userId; manuscriptId; sectionId; action; kind; provider; model; proposalChars: number; nonce: string; ts: number }): string` (HMAC-SHA256 over the JSON payload, format `v1.<payload b64url>.<mac b64url>`; `timingSafeEqual` verify) and `verifyProposalToken(secret, token): payload | null` (null on bad MAC or age > 24 h).
- `POST /api/aris/draft` body `{manuscriptId, sectionId, action, instruction?, cursorOffset?, selection?: {text}, provider, model}` (manual validation; manuscript must belong to the user — reuse the ownership query pattern from manuscripts.ts; section text extracted server-side from the stored doc via the `@book`-shared `toText` helpers). Kind derives from action: rewrite/expand/condense ⇒ `replaced-own-prose`, else `generated-new`. Response `200 {"proposal":{"text","model","provider","action"},"token":…}`. No key for provider ⇒ `400 {"error":"no <provider> key on your /aris page"}`; `ArisUpstreamError` ⇒ `502 {"error":"<provider> refused the request","detail":…}`.

- [ ] **Step 1: Failing tests** (stub provider upstream) — `'a beat drafts prose and mints a verifiable token'` (token verifies; payload action/provider/model/chars match; nonce present); `'no stored key is a clean 400 naming the /aris page'`; `'an upstream 401 is a 502 carrying the provider words'`; `'another writer's manuscript is a 404'`; `'summarize counts as generated-new, condense as replaced-own-prose'` (token kind).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): the draft endpoint with signed proposal tokens`.

### Task 8: POST /api/aris/insert — the audit row

**Files:** Modify `src/aris/routes.ts`; Test `tests/aris-insert.test.ts`

**Interfaces:**
- `POST /api/aris/insert` body `{token, bytesBefore, bytesAfter, writerEdited}` → verifies token (secret, user match, age), inserts the `ai_writes` row with lens `'draft'` and every provenance fact **from the token payload**, span bytes + writerEdited from the body (the writer's own hands), `202 {"recorded":true}`. Replay (same nonce) ⇒ `409 {"error":"this proposal is already recorded"}`. Forged/stale token ⇒ 403.

- [ ] **Step 1: Failing tests** — `'an accepted proposal lands one ai_writes row of facts'` (row matches token facts + body facts); `'a replayed token is a 409 and one row remains'`; `'a forged token is a 403 and no row'`; `'another user presenting a stolen token is a 403'`; `'multibyte spans count UTF-8 bytes'` (Devanagari + emoji text: bytesBefore/After are `Buffer.byteLength` values — asserted against hand-computed byte counts).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): insert records the audit facts`.

### Task 9: Studio module skeleton, gating, and the isolation guard

**Files:**
- Create: `studio/src/aris/index.ts` (the only public entry: `mountAris(): Promise<void>` guard-fetching status), `studio/src/aris/net.ts` (apiFetch wrapper per `src/covenant/net.ts`, with `setArisFetch` test injection), `studio/src/aris/state.ts` (module singleton: `arisStatus(): {enabled;optedIn;voice;keys}|null`)
- Modify: `studio/src/shell/Shell.tsx` (ONE lazy `import('../aris/index.js')` behind the cached-promise pattern, called after book open), `studio/src/styles/aris.css` + its import
- Test: `studio/test/aris-isolation.test.ts`, `studio/test/aris-gate.test.tsx`

**Interfaces:**
- Produces: the glyph — a toolbar element (thin laurel, cyan at 45 % opacity) rendered only when `enabled && optedIn`. Status 404 or network-null ⇒ `arisStatus()` null ⇒ nothing renders, no retry loop (one fetch per session).
- The **isolation guard** (the spec's "deleting the module leaves the studio compiling"): an fs-scanning vitest asserting the string `aris` appears in imports/paths outside `studio/src/aris/` and `studio/src/styles/aris.css` ONLY in `Shell.tsx` (the single mount) — so removing the folder plus two marked lines compiles clean.

- [ ] **Step 1: Failing tests** — `'aris leaks into no studio file beyond its mount'` (fs scan as above); `'no status means no glyph'` (render Shell with injected fetch → 404; assert no `[data-aris]` node); `'enabled and opted in shows the glyph'`.
- [ ] **Steps 2–5:** FAIL → implement → PASS (run `cd studio && npx vitest run test/aris-isolation.test.ts test/aris-gate.test.tsx`) → commit `feat(aris): studio module, gate, and the isolation guard`.

### Task 10: Summon menu, ghost proposals, insert flow

**Files:**
- Create: `studio/src/aris/summon.ts` (TipTap `Extension.create` with a ProseMirror plugin: `/` typed at the start of an empty paragraph opens the menu — input rules are disabled editor-wide, so handle via `handleTextInput`), `studio/src/aris/menu.tsx` (beat input + continue/fill/summarize items), `studio/src/aris/ghost.ts` (decoration-only plugin per `studio/src/covenant/marks.ts`: the proposal as a widget decoration — never in the document), `studio/src/aris/propose.ts`
- Modify: `studio/src/editor/createEditor.ts` (extensions array gains the Aris extensions ONLY when passed in: `ChapterEditorOptions` gains `extraExtensions?: AnyExtension[]`; Shell's mount supplies them — keeps the isolation guard true)
- Test: `studio/test/aris-summon.test.tsx`

**Interfaces:**
- Produces: `propose(o: {action; instruction?; cursorOffset?; selectionText?}): Promise<{text; token}|{error}>` calling `/api/aris/draft` with the active section (`activeEditor()`, `caretOffset`); ghost API `showGhost(editor, at: number, text: string, onResolve: (r:'insert'|'edit'|'discard'|'retry')=>void)`; insert applies via a single ProseMirror transaction at the ghost position, measures `bytesBefore/bytesAfter` over the section text (UTF-8), detects `writerEdited` (inserted text !== proposal text), then POSTs `/api/aris/insert`.
- Consumes: Task 7/8 response shapes; Task 9 `arisStatus`/net.

- [ ] **Step 1: Failing tests** — `'typing / on an empty line summons the menu, and only then'` (mid-word `/` does not); `'a proposal renders as a ghost decoration, not document text'` (editor text unchanged while ghost shows); `'insert lands the text, records the facts, and clears the ghost'` (injected fetch captures the /insert body: byte counts and writerEdited false); `'edit-then-insert flags writerEdited'`; `'discard leaves text and audit untouched'`; `'the ghost inherits rtl direction'` (editor `dir:'rtl'` → widget element direction).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): summon menu and ghost proposal mechanics`.

### Task 11: Selection toolbar

**Files:** Create `studio/src/aris/selection.tsx`; Modify `studio/src/aris/summon.ts` (shared plugin state); Test `studio/test/aris-selection.test.tsx`

**Interfaces:**
- Produces: floating toolbar (rewrite · expand · condense · fact-check-disabled-stub hidden in W1 — only the three rewrite actions exist) on selections of **≥ 4 words**, gone on deselect; actions call `propose` with `selectionText`, ghost replaces the selection on insert with kind `replaced-own-prose` flowing from the token (server derives it — Task 7).

- [ ] **Step 1: Failing tests** — `'three selected words raise no toolbar, four do'`; `'condense proposes against the selection and insert replaces exactly the selected range'`; `'deselect dismisses the toolbar'`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): selection rewrites`.

### Task 12: The /aris page

**Files:**
- Create: `src/routes/aris-page.ts` (`arisPageRoutes(db, config): Router` serving `GET /aris`), `client/assets/aris-page.js` (vanilla IIFE per `client/account/account.js`: fetches `/api/aris/status`, renders the opt-in toggle, voice dial, key add/delete forms; signed-out ⇒ a sign-in invitation line)
- Modify: `src/app.ts` (mount with the page routers after the API catch-all), `Caddyfile` (proxy `/aris` to the app, before the SPA fallback), `src/routes/site.ts:52` (sitemap `paths` += `/aris`), `client/sw.js` + `client/assets/sw.js` (network-only regex += `/aris`), `tests/fixtures/l10n-english-only.json` (+ `/aris` with reason)
- Test: `tests/aris-page.test.ts`

**Interfaces:**
- The page = `chrome(ctx, { title: 'Aris', … })` from `src/help/render.ts:186` wrapping `renderMarkdown(loadPersona().page)` (`src/warmth/markdown.ts:41`) + the controls section + the page script. When `!config.arisEnabled` ⇒ 404 (the page does not exist either). This is the ONLY surface that explains or enables Aris.

- [ ] **Step 1: Failing tests** — `'/aris renders the persona page when enabled'` (contains ἄριστος copy and the opt-in markup); `'/aris is 404 when the feature is off'`; `'the ledger, sitemap and service workers carry /aris'` (run `tests/localization.test.ts`, `tests/site-pages.test.ts` as the check; add `/aris` entries until green).
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(aris): the /aris page — persona, opt-in, keys, voice`.

### Task 13: Whole-suite green and the W1 evidence run

**Files:** none new — verification only.

- [ ] **Step 1:** `npm run test:bench` (server) — expect 0 fail (skips stay honest).
- [ ] **Step 2:** `cd studio && npm run build && npx vitest run` — expect tsc clean, 0 fail.
- [ ] **Step 3:** Temporarily delete `studio/src/aris/` + the two marked Shell lines + the css import in a scratch branch; `tsc --noEmit -p studio/tsconfig.build.json` — expect clean (the spec's structural seam test, performed once as evidence); restore.
- [ ] **Step 4:** Write the exit-evidence note into `docs/ARIS_DESIGN.md` under Phase W1 (what ran, where) — the live-bench scene completion with a real key is V's hand on the bench and closes the phase per the design's exit, together with the landed name in the Help copy.
- [ ] **Step 5: Commit** `test(aris): W1 suite evidence`

---

## Self-review notes (performed)

- **Spec coverage:** every W1 sentence in ARIS_DESIGN.md maps to a task: seam→1, 029+registries→2, vault→3, opt-in→4, adapters→5, persona file + prompts + 24k window→6, draft+tokens→7, audit→8, glyph+isolation→9, summon/ghost→10, selection→11, /aris page→12, suite+structural evidence→13. Deliberate deferrals, stated in the header: streaming (no SSE exists), fact-check surfaces (W4), drawer/workshop (W2–W3), and the trial-pause ACCESS_RULES entry is left to the builder with the manuscripts PUT as the model.
- **Type consistency:** `ArisMessage/ArisReply/ArisProvider/ArisUpstreamError` defined once (Task 5), consumed in 6–7; token payload defined in 7, consumed in 8; `arisStatus` shape defined in 1, consumed in 9/12.
- **Naming check:** `createChapterEditor` (not `createEditor`); `ChapterEditorOptions.extraExtensions` is the one editor-API change.
- **Proportion:** no function bodies; signatures, shapes, pinned values (404-copy, 503-copy, 24 000 chars, ≥4 words, 60 s timeout, 24 h token age, scrypt salt) only.
