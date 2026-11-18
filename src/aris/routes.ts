import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { seriesKey } from '../routes/series-covenants.js';
import { buildDraftPrompt, type CovenantEntry, type DraftAction } from './prompts.js';
import { ArisUpstreamError, providerFor } from './providers.js';
import { mintProposalToken, verifyProposalToken, type ProposalKind } from './token.js';
import { decryptKey, encryptKey } from './vault.js';

const PROVIDERS = ['openrouter', 'anthropic', 'openai-compat'] as const;
const ACTIONS = ['beat', 'continue', 'fill', 'summarize', 'rewrite', 'expand', 'condense'] as const;
const SELECTION_ACTIONS = new Set<string>(['rewrite', 'expand', 'condense']);
const MODEL_MAX = 200;
const DRAFT_MAX_TOKENS = 2048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_KEY_MAX = 512;
const VOICES = ['laconic', 'homeric'] as const;
type Voice = (typeof VOICES)[number];

interface ArisStatus {
  enabled: true;
  optedIn: boolean;
  /** Has this account ever summoned Aris (a settings row or a saved key)? The studio shows the dormant laurel to a
   *  known account that sent Aris away, and nothing at all to one that never invited it. */
  known: boolean;
  voice: Voice;
  keys: { provider: string; last4: string; baseUrl?: string; model?: string }[];
}

/**
 * Aris — the AI addon's server surface, mounted at /api/aris.
 *
 * House style: mounted always, config checked per request. The gate runs
 * before requireAuth, so a disabled deployment answers an unauthenticated
 * probe with the same plain 404 as any unknown /api path (byte-identical
 * to the catch-all in app.ts). Enabled without ARIS_KEY_SECRET is an
 * honest 503, never a half-working addon.
 */
export function arisRoutes(db: Db, config: Config): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (!config.arisEnabled) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!config.arisKeySecret) {
      res.status(503).json({ error: 'aris misconfigured: ARIS_KEY_SECRET is not set' });
      return;
    }
    next();
  });

  router.use(requireAuth(db));

  // No aris_settings row means the defaults (not opted in, laconic).
  async function loadStatus(userId: number | string): Promise<ArisStatus> {
    const [keyRows, settings] = await Promise.all([
      db.query<{ provider: string; key_last4: string; base_url: string | null; model: string | null }>(
        'select provider, key_last4, base_url, model from aris_keys where user_id = $1 order by created_at, provider',
        [userId],
      ),
      db.query<{ opted_in: boolean; voice: Voice }>('select opted_in, voice from aris_settings where user_id = $1', [
        userId,
      ]),
    ]);
    const keys = keyRows.rows.map((r) => ({
      provider: r.provider,
      last4: r.key_last4,
      ...(r.base_url ? { baseUrl: r.base_url } : {}),
      ...(r.model ? { model: r.model } : {}),
    }));
    const row = settings.rows[0];
    return { enabled: true, optedIn: row?.opted_in ?? false, known: settings.rows.length > 0 || keys.length > 0, voice: row?.voice ?? 'laconic', keys };
  }

  // Engine routes (draft, review) sit behind this until the user has opted in on /aris.
  async function requireOptIn(req: Request, res: Response, next: NextFunction) {
    try {
      const r = await db.query<{ opted_in: boolean }>('select opted_in from aris_settings where user_id = $1', [
        req.user!.id,
      ]);
      if (!r.rows[0]?.opted_in) {
        res.status(403).json({ error: 'turn Aris on from your /aris page first' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  router.get('/status', async (req, res, next) => {
    try {
      res.json(await loadStatus(req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  router.put('/settings', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { optedIn?: unknown; voice?: unknown };
      if (body.optedIn !== undefined && typeof body.optedIn !== 'boolean') {
        res.status(400).json({ error: 'optedIn must be a boolean' });
        return;
      }
      if (body.voice !== undefined && !(VOICES as readonly unknown[]).includes(body.voice)) {
        res.status(400).json({ error: 'voice must be one of: laconic, homeric' });
        return;
      }
      // Omitted fields keep their stored value (or the column default on first write).
      await db.query(
        `insert into aris_settings (user_id, opted_in, voice)
         values ($1, coalesce($2::boolean, false), coalesce($3::text, 'laconic'))
         on conflict (user_id) do update
           set opted_in = coalesce($2::boolean, aris_settings.opted_in),
               voice = coalesce($3::text, aris_settings.voice),
               updated_at = now()`,
        [req.user!.id, body.optedIn ?? null, body.voice ?? null],
      );
      res.json(await loadStatus(req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  // Draft: one provider call, one signed proposal. The writer's key is decrypted
  // for this request only; the section text is read server-side, never trusted
  // from the client.
  router.post('/draft', requireOptIn, async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const bad = (error: string) => res.status(400).json({ error });
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      const manuscriptId = str(b.manuscriptId);
      const sectionId = str(b.sectionId);
      const model = str(b.model)?.trim();
      if (!manuscriptId || !sectionId) return bad('manuscriptId and sectionId are required');
      if (typeof b.action !== 'string' || !(ACTIONS as readonly string[]).includes(b.action))
        return bad(`action must be one of: ${ACTIONS.join(', ')}`);
      const action = b.action as DraftAction;
      if (typeof b.provider !== 'string' || !(PROVIDERS as readonly string[]).includes(b.provider))
        return bad('provider must be one of: openrouter, anthropic, openai-compat');
      const provider = b.provider;
      if (!model || model.length > MODEL_MAX) return bad('model is required');
      if (b.instruction !== undefined && typeof b.instruction !== 'string') return bad('instruction must be a string');
      if (b.cursorOffset !== undefined && (!Number.isInteger(b.cursorOffset) || (b.cursorOffset as number) < 0))
        return bad('cursorOffset must be a non-negative integer');
      let selection: { text: string } | undefined;
      if (b.selection !== undefined) {
        const t = (b.selection as { text?: unknown } | null)?.text;
        if (typeof t !== 'string') return bad('selection.text must be a string');
        selection = { text: t };
      }
      const instruction = b.instruction as string | undefined;
      if (action === 'beat' && !instruction?.trim()) return bad('a beat needs an instruction');
      if (SELECTION_ACTIONS.has(action) && !selection?.text.trim()) return bad(`${action} needs a selection`);

      if (!UUID_RE.test(manuscriptId)) return res.status(404).json({ error: 'manuscript not found' });
      const ms = await db.query<{ title: string; doc: unknown }>(
        'select title, doc from manuscripts where id = $1 and user_id = $2',
        [manuscriptId, req.user!.id],
      );
      const row = ms.rows[0];
      if (!row) return res.status(404).json({ error: 'manuscript not found' });
      const doc = (typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc) as {
        meta?: { series?: unknown };
        sections?: { id?: unknown; content?: unknown }[];
      } | null;
      const section = Array.isArray(doc?.sections) ? doc!.sections!.find((s) => s?.id === sectionId) : undefined;
      if (!section) return res.status(404).json({ error: 'section not found' });
      const sectionText = typeof section.content === 'string' ? section.content : '';
      if (b.cursorOffset !== undefined && (b.cursorOffset as number) > sectionText.length)
        return bad('cursorOffset is outside the section');

      const keyRow = (
        await db.query<{ key_ciphertext: string; base_url: string | null; model: string | null }>(
          'select key_ciphertext, base_url, model from aris_keys where user_id = $1 and provider = $2',
          [req.user!.id, provider],
        )
      ).rows[0];
      if (!keyRow) return bad(`no ${provider} key on your /aris page`);

      // Covenant: the manuscript's meta.series names a series; series_covenants
      // is keyed by that name's seriesKey(). No series, or no row, means none.
      let covenants: CovenantEntry[] = [];
      const seriesName = typeof doc?.meta?.series === 'string' ? doc.meta.series : '';
      const key = seriesName ? seriesKey(seriesName) : '';
      if (key) {
        const cov = await db.query<{ doc: unknown }>(
          'select doc from series_covenants where user_id = $1 and series_key = $2',
          [req.user!.id, key],
        );
        const cdoc = cov.rows[0]?.doc as { entries?: unknown } | undefined;
        if (Array.isArray(cdoc?.entries))
          covenants = (cdoc!.entries as Record<string, unknown>[])
            .filter((e) => e && typeof e.kind === 'string' && typeof e.name === 'string')
            .map((e) => ({
              kind: e.kind as string,
              name: e.name as string,
              note: typeof e.note === 'string' ? e.note : '',
            }));
      }

      let messages;
      try {
        messages = buildDraftPrompt({
          action,
          instruction,
          sectionText,
          cursorOffset: b.cursorOffset as number | undefined,
          selection,
          bookTitle: row.title,
          covenants,
        });
      } catch (err) {
        // cursorOffset was range-checked above, so a RangeError here is the 24k budget.
        if (err instanceof RangeError) return bad('that selection is too large for one pass — select less');
        throw err;
      }

      // A key the server cannot read (corrupt row, rotated secret) is stale
      // state, not an upstream fault: 409, never an opaque 500.
      let apiKey: string;
      try {
        apiKey = decryptKey(config.arisKeySecret!, keyRow.key_ciphertext);
      } catch {
        return res
          .status(409)
          .json({ error: `your ${provider} key could not be read — re-enter it on your /aris page` });
      }

      // The key's stored model wins; the client's default is only the fallback.
      const effectiveModel = keyRow.model ?? model;
      let reply;
      try {
        reply = await providerFor(provider, config).chat({
          apiKey,
          model: effectiveModel,
          messages,
          maxTokens: DRAFT_MAX_TOKENS,
          ...(keyRow.base_url ? { baseUrl: keyRow.base_url } : {}),
        });
      } catch (err) {
        if (err instanceof ArisUpstreamError) {
          return res.status(502).json({ error: `${err.provider} refused the request`, detail: err.detail });
        }
        throw err;
      }

      const kind: ProposalKind = SELECTION_ACTIONS.has(action) ? 'replaced-own-prose' : 'generated-new';
      const token = mintProposalToken(config.arisKeySecret!, {
        userId: String(req.user!.id),
        manuscriptId,
        sectionId,
        action,
        kind,
        provider,
        model: reply.model,
        proposalChars: reply.text.length,
        nonce: randomUUID(),
        ts: Date.now(),
      });
      res.json({ proposal: { text: reply.text, model: reply.model, provider, action }, token });
    } catch (err) {
      next(err);
    }
  });

  // Insert: the audit row. Every provenance fact comes from the verified
  // token; only the span sizes (UTF-8 bytes) and writerEdited are the writer's
  // own report. Replay is caught by unique (user_id, nonce), not pre-checked.
  router.post('/insert', requireOptIn, async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const isBytes = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2147483647;
      if (typeof b.token !== 'string' || !b.token) return res.status(400).json({ error: 'token is required' });
      if (!isBytes(b.bytesBefore) || !isBytes(b.bytesAfter))
        return res.status(400).json({ error: 'bytesBefore and bytesAfter must be integers from 0 to 2147483647' });
      if (typeof b.writerEdited !== 'boolean') return res.status(400).json({ error: 'writerEdited must be a boolean' });

      const p = verifyProposalToken(config.arisKeySecret!, b.token);
      if (!p || p.userId !== String(req.user!.id))
        return res.status(403).json({ error: 'this proposal token is not valid for you' });

      try {
        await db.query(
          `insert into ai_writes (user_id, manuscript_id, section_id, lens, action, kind, provider, model,
                                  proposal_chars, bytes_before, bytes_after, writer_edited, nonce)
           values ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            req.user!.id,
            p.manuscriptId,
            p.sectionId,
            p.action,
            p.kind,
            p.provider,
            p.model,
            p.proposalChars,
            b.bytesBefore,
            b.bytesAfter,
            b.writerEdited,
            p.nonce,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          return res.status(409).json({ error: 'this proposal is already recorded' });
        throw err;
      }
      res.status(202).json({ recorded: true });
    } catch (err) {
      next(err);
    }
  });

  // Show-once: the response carries the last four characters, never the key.
  router.put('/key', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { provider?: unknown; apiKey?: unknown; baseUrl?: unknown; model?: unknown };
      const provider = body.provider;
      if (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) {
        res.status(400).json({ error: 'provider must be one of: openrouter, anthropic, openai-compat' });
        return;
      }
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!apiKey || apiKey.length > API_KEY_MAX) {
        res.status(400).json({ error: 'apiKey is required' });
        return;
      }
      let baseUrl: string | null = null;
      if (body.baseUrl !== undefined && body.baseUrl !== null) {
        if (provider !== 'openai-compat') {
          res.status(400).json({ error: 'baseUrl is only accepted for openai-compat' });
          return;
        }
        let parsed: URL;
        try {
          parsed = new URL(String(body.baseUrl));
        } catch {
          res.status(400).json({ error: 'baseUrl must be an https URL' });
          return;
        }
        if (parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'baseUrl must be an https URL' });
          return;
        }
        if (parsed.username || parsed.password) {
          res.status(400).json({ error: 'the base URL must not carry credentials' });
          return;
        }
        baseUrl = parsed.toString();
      }
      let model: string | null = null;
      if (body.model !== undefined && body.model !== null) {
        const m = typeof body.model === 'string' ? body.model.trim() : null;
        if (m === null || m.length > MODEL_MAX) {
          res.status(400).json({ error: 'model must be a short string' });
          return;
        }
        model = m || null;
      }
      const last4 = apiKey.slice(-4);
      await db.query(
        `insert into aris_keys (user_id, provider, key_ciphertext, key_last4, base_url, model)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (user_id, provider) do update
           set key_ciphertext = excluded.key_ciphertext,
               key_last4 = excluded.key_last4,
               base_url = excluded.base_url,
               model = excluded.model`,
        [req.user!.id, provider, encryptKey(config.arisKeySecret!, apiKey), last4, baseUrl, model],
      );
      res.json({ provider, last4 });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/key/:provider', async (req, res, next) => {
    try {
      await db.query('delete from aris_keys where user_id = $1 and provider = $2', [req.user!.id, req.params.provider]);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
