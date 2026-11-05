import { cloudBootHook, cloudFacts, type ClosureApi, type StockPhoto } from '../closure/index';
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
   - A pick downloads the picture and checks its bytes are a JPEG or a PNG,
     1.0's upload types (2.0's check; 1.0 trusts the download's type), and
     stores the type the bytes are; anything else is refused with 1.0's
     covermk.photoFail. */

/** The origins the served policy allows for img-src and connect-src beyond 'self' (Caddyfile). */
export const STOCK_ORIGINS = ['https://images.pexels.com', 'https://api.openverse.org'];

/** A stock address this page may load: https on one of STOCK_ORIGINS. Review round 2 (Minor 3): never this page's own
 *  origin nor a relative address — those come from a third party's answer (Openverse's JSON) and would be credentialed
 *  same-origin requests; the shelf's /api/stock/search hands back Pexels' own https addresses (src/routes/stock.ts). */
export function allowedStockUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !/^https:\/\//i.test(u)) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && STOCK_ORIGINS.includes(url.origin);
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
  // wave 7a: the shelf's boot (1.0's initCloud) answers who is signed in; a second probe could only race it
  if (cloudBootHook.p) return cloudBootHook.p.catch(() => undefined);
  if (!probed) {
    probed = (async () => {
      let available = false;
      let unreachable = false;
      try {
        const r = await fetcher('/api/health', { credentials: 'same-origin' });
        const j = r.ok ? ((await r.json().catch(() => null)) as { ok?: unknown } | null) : null;
        available = !!(j && j.ok);
      } catch {
        available = false;
        unreachable = true;
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
      // wave 3a: the studio now probes at start (the streak, 1.0's cloudAfterSignIn); a probe that could not reach the
      // page's origin at all (thrown: offline) is asked again by the next caller rather than kept for the page's life
      if (unreachable) probed = null;
    })();
  }
  return probed;
}
/** Tests only: forget the probe. */
export function resetCloudProbe(): void {
  probed = null;
  cloudBootHook.p = null; // wave 7a: and the shelf's boot answer (the next probe asks again)
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
 *  the bytes must be a JPEG or a PNG, and `type` is what they are. Null: 1.0's covermk.photoFail. */
export async function stockDownload(ph: StockPhoto, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<{ type: string; data: string } | null> {
  const urls = stockUrls(ph).filter(allowedStockUrl);
  for (const u of urls) {
    try {
      const r = await fetcher(u);
      if (!r.ok) throw new Error('img ' + r.status);
      const blob = await r.blob();
      const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      // only 1.0's picture types (JPG, PNG: its upload rule), typed by the bytes themselves (fix round 1)
      const kind = sniffPicture(data);
      if (kind !== 'image/jpeg' && kind !== 'image/png') return null;
      return { type: kind, data };
    } catch {
      /* the next rendition */
    }
  }
  return null;
}
