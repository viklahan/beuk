import type { Config } from '../config.js';

export type ArisMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ArisReply = { text: string; model: string };

export class ArisUpstreamError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    public detail: string,
  ) {
    super(`${provider} upstream error${status === null ? '' : ` (${status})`}: ${detail}`);
    this.name = 'ArisUpstreamError';
  }
}

export interface ArisProvider {
  id: 'openrouter' | 'anthropic' | 'openai-compat';
  chat(o: {
    apiKey: string;
    model: string;
    messages: ArisMessage[];
    maxTokens: number;
    baseUrl?: string;
  }): Promise<ArisReply>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DETAIL_MAX = 300;

const clip = (s: string): string => s.slice(0, DETAIL_MAX);

/** Pull the upstream's own words out of an error body (OpenAI and Anthropic both nest under error.message). */
function upstreamWords(raw: string): string {
  try {
    const j = JSON.parse(raw);
    const m = j?.error?.message ?? j?.message ?? (typeof j?.error === 'string' ? j.error : null);
    if (typeof m === 'string' && m) return clip(m);
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return clip(raw);
}

async function post(
  provider: ArisProvider['id'],
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<any> {
  let res: Response;
  let raw: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await res.text();
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const detail =
      name === 'TimeoutError' || name === 'AbortError'
        ? `request timed out after ${timeoutMs}ms`
        : clip(err instanceof Error ? err.message : String(err));
    throw new ArisUpstreamError(provider, null, detail);
  }
  if (!res.ok) throw new ArisUpstreamError(provider, res.status, upstreamWords(raw));
  try {
    return JSON.parse(raw);
  } catch {
    throw new ArisUpstreamError(provider, res.status, 'malformed reply: not JSON');
  }
}

function openAiStyle(
  id: 'openrouter' | 'openai-compat',
  fixedBase: string | null,
  timeoutMs: number,
): ArisProvider {
  return {
    id,
    async chat({ apiKey, model, messages, maxTokens, baseUrl }) {
      const base = (fixedBase ?? baseUrl ?? '').replace(/\/+$/, '');
      if (!base) throw new ArisUpstreamError(id, null, 'no baseUrl configured');
      const j = await post(
        id,
        `${base}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        { model, max_tokens: maxTokens, messages },
        timeoutMs,
      );
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new ArisUpstreamError(id, 200, 'malformed reply: no choices[0].message.content');
      return { text, model: typeof j.model === 'string' && j.model ? j.model : model };
    },
  };
}

function anthropic(base: string, timeoutMs: number): ArisProvider {
  return {
    id: 'anthropic',
    async chat({ apiKey, model, messages, maxTokens }) {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
      const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages: rest };
      if (system) body.system = system;
      const j = await post(
        'anthropic',
        `${base.replace(/\/+$/, '')}/v1/messages`,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body,
        timeoutMs,
      );
      const text = j?.content?.[0]?.text;
      if (typeof text !== 'string') throw new ArisUpstreamError('anthropic', 200, 'malformed reply: no content[0].text');
      return { text, model: typeof j.model === 'string' && j.model ? j.model : model };
    },
  };
}

/** Timeout is injectable (default 60 000 ms) so tests can exercise a hung upstream quickly. */
export function providerFor(id: string, config: Config, opts: { timeoutMs?: number } = {}): ArisProvider {
  const t = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  switch (id) {
    case 'openrouter':
      return openAiStyle('openrouter', config.arisOpenrouterBase, t);
    case 'anthropic':
      return anthropic(config.arisAnthropicBase, t);
    case 'openai-compat':
      return openAiStyle('openai-compat', null, t);
    default:
      throw new Error(`unknown Aris provider: ${id}`);
  }
}
