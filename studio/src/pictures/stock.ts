import { cloudFacts, type ClosureApi, type StockPhoto } from '../closure/index';
import { bytesToBase64, sniffPicture } from './pictures';
import { stockUrls } from './scene';

/* BEUK:sceneimages — Suggest by name (1.0's sceneSearchSuggest and
   scenePickStock), constraint 16.

   - The gate is 1.0's own cmStockGate (closure), on 1.0's `cloud` facts:
     a shelf answers /api/health, and /api/auth/me names a writer. Signed
     in: GET /api/stock/search through the server (1.0's apiFetch:
     same-origin credentials; a non-OK answer is { __error, __status }).
     A shelf but nobody signed in: gated ("covermk.photoNeedAccount"),
     nothing sent. No shelf answering: Openverse directly (1.0's
     stockDirectUrl), its answer mapped by 1.0's cmMapDirectResults.
   - The policy (Caddyfile) lets the page load pictures and connect only to
     'self', images.pexels.com and api.openverse.org. 1.0 tries a result's
     addresses in order even when the policy refuses one (a violation,
     then the next); 2.0 tries and shows only the addresses the policy
     allows, so it never causes a violation (the CSP is not widened).
   - A pick downloads the picture and checks its bytes are a picture (2.0's
     check; 1.0 trusts the download's type) before it joins the library. */

/** The origins the served policy allows for img-src and connect-src beyond 'self' (Caddyfile). */
export const STOCK_ORIGINS = ['https://images.pexels.com', 'https://api.openverse.org'];

/** An address the policy lets this page load. */
export function allowedStockUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  try {
    const url = new URL(u, globalThis.location?.href ?? 'https://beuk.invalid/');
    if (url.protocol !== 'https:' && url.origin !== globalThis.location?.origin) return false;
    return url.origin === globalThis.location?.origin || STOCK_ORIGINS.includes(url.origin);
  } catch {
    return false;
  }
}

/** The thumbnail 1.0 shows for a result (medium, else large, else original), or null when the policy would refuse it. */
export function stockThumb(ph: StockPhoto): string | null {
  const u = (ph.src && (ph.src.medium || ph.src.large || ph.src.original)) || '';
  return allowedStockUrl(u) ? u : null;
}

/* ---- 1.0's cloud facts, probed once per page ---- */
let probed: Promise<void> | null = null;
/** /api/health (a shelf is there) and /api/auth/me (who is signed in), as 1.0 learns them. */
export function probeCloud(fetcher: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<void> {
  if (!probed) {
    probed = (async () => {
      let available = false;
      try {
        const r = await fetcher('/api/health', { credentials: 'same-origin' });
        const j = r.ok ? ((await r.json().catch(() => null)) as { ok?: unknown } | null) : null;
        available = !!(j && j.ok);
      } catch {
        available = false;
      }
      let user: unknown = null;
      if (available) {
        try {
          const r = await fetcher('/api/auth/me', { credentials: 'same-origin' });
          const j = r.ok ? ((await r.json().catch(() => null)) as { user?: unknown } | null) : null;
          user = j && j.user ? j.user : null;
        } catch {
          user = null;
        }
      }
      cloudFacts.available = available;
      cloudFacts.user = user;
    })();
  }
  return probed;
}
/** Tests only: forget the probe. */
export function resetCloudProbe(): void {
  probed = null;
  cloudFacts.available = false;
  cloudFacts.user = null;
}

export type SearchOutcome = { gated: 'account' } | { gated: 'empty' } | { res: unknown };

/** 1.0's sceneSearchSuggest, less its DOM: the answer to hand to suggestVerdict (null: retry), or why it was not sent. */
export async function stockSearch(c: ClosureApi, query: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SearchOutcome> {
  await probeCloud(fetcher);
  const gate = c.cmStockGate();
  if (gate === 'account') return { gated: 'account' };
  const q = (query || '').trim();
  if (!q) return { gated: 'empty' };
  if (gate === 'direct') {
    try {
      const r = await fetcher(c.stockDirectUrl(q, 12));
      if (!r.ok) throw new Error('stock ' + r.status);
      return { res: c.cmMapDirectResults(await r.json()) };
    } catch {
      return { res: null };
    }
  }
  try {
    const r = await fetcher(c.stockSearchUrl(q, 12), { method: 'GET', credentials: 'same-origin', headers: {} });
    if (r.status === 204) return { res: {} };
    const data = await r.json().catch(() => null);
    if (!r.ok) return { res: { __error: (data && (data as { error?: unknown }).error) || 'HTTP ' + r.status, __status: r.status, __body: data } };
    return { res: data || {} };
  } catch {
    return { res: null };
  }
}

/** 1.0's scenePickStock download: the addresses in its order (only those the policy allows), the first that answers;
 *  the bytes must be a picture. Null: 1.0's covermk.photoFail. */
export async function stockDownload(ph: StockPhoto, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<{ type: string; data: string } | null> {
  const urls = stockUrls(ph).filter(allowedStockUrl);
  for (const u of urls) {
    try {
      const r = await fetcher(u);
      if (!r.ok) throw new Error('img ' + r.status);
      const blob = await r.blob();
      const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      if (!sniffPicture(data, blob.type)) return null;
      return { type: blob.type, data };
    } catch {
      /* the next rendition */
    }
  }
  return null;
}
