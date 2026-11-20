import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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
      redirect: 'manual',
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
  if (res.status >= 300 && res.status < 400) throw new ArisUpstreamError(provider, res.status, 'redirects are not followed');
  if (!res.ok) throw new ArisUpstreamError(provider, res.status, upstreamWords(raw));
  try {
    return JSON.parse(raw);
  } catch {
    throw new ArisUpstreamError(provider, res.status, 'malformed reply: not JSON');
  }
}


function isPrivateAddress(addr: string): boolean {
  let a = addr.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a); // URL() normalises ::ffff:1.2.3.4 to hex
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    a = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (isIP(a) === 4) {
    const [o1, o2] = a.split('.').map(Number);
    return (
      o1 === 127 || o1 === 10 || o1 === 0 ||
      (o1 === 172 && o2 >= 16 && o2 <= 31) ||
      (o1 === 192 && o2 === 168) ||
      (o1 === 169 && o2 === 254) ||
      (o1 === 100 && o2 >= 64 && o2 <= 127) || // 100.64.0.0/10 CGNAT
      (o1 === 198 && (o2 === 18 || o2 === 19)) // 198.18.0.0/15
    );
  }
  if (a === '::1' || a === '::') return true;
  // NAT64 64:ff9b::/96 — judge the embedded IPv4 (dotted or the hex tail URL() normalises to)
  const nat = /^64:ff9b::(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(a);
  if (nat) {
    if (nat[1]) return isPrivateAddress(nat[1]);
    const hi = parseInt(nat[2], 16);
    const lo = parseInt(nat[3], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (/^64:ff9b:/.test(a)) return true; // any other form of the /96: refuse rather than guess
  if (/^2002:/.test(a)) return true; // 6to4 2002::/16
  return /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^fe[c-f]/.test(a); // fc00::/7, fe80::/10, fec0::/10
}

/** Per-call SSRF guard for writer-supplied bases (DNS rebinding defeats save-time checks). */
async function assertPublicHost(base: string): Promise<void> {
  const refuse = () => new ArisUpstreamError('openai-compat', null, 'base url resolves to a private address');
  let host: string;
  try {
    host = new URL(base).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new ArisUpstreamError('openai-compat', null, 'invalid baseUrl');
  }
  let addrs: string[];
  if (isIP(host)) addrs = [host];
  else {
    try {
      addrs = (await lookup(host, { all: true })).map((r) => r.address);
    } catch (err) {
      throw new ArisUpstreamError('openai-compat', null, clip(err instanceof Error ? err.message : String(err)));
    }
  }
  if (addrs.some(isPrivateAddress)) throw refuse();
}

function openAiStyle(
  id: 'openrouter' | 'openai-compat',
  fixedBase: string | null,
  timeoutMs: number,
  allowPrivateHosts = false,
): ArisProvider {
  return {
    id,
    async chat({ apiKey, model, messages, maxTokens, baseUrl }) {
      const base = (fixedBase ?? baseUrl ?? '').replace(/\/+$/, '');
      if (!base) throw new ArisUpstreamError(id, null, 'no baseUrl configured');
      if (fixedBase === null && !allowPrivateHosts) await assertPublicHost(base);
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
export function providerFor(id: string, config: Config, opts: { timeoutMs?: number; allowPrivateHosts?: boolean } = {}): ArisProvider {
  const t = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  switch (id) {
    case 'openrouter':
      return openAiStyle('openrouter', config.arisOpenrouterBase, t);
    case 'anthropic':
      return anthropic(config.arisAnthropicBase, t);
    case 'openai-compat':
      return openAiStyle('openai-compat', null, t, opts.allowPrivateHosts === true);
    default:
      throw new Error(`unknown Aris provider: ${id}`);
  }
}
