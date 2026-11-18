/* The Aris module's transport: the same request and answer shapes as src/covenant/net.ts's apiFetch (same-origin
   credentials, JSON content type for a string body): {} for 204, the JSON body, { __error, __status, __body } for an
   error status, null when the network failed. Self-contained: no dependency on the rest of the studio. */

type Fetcher = typeof fetch;
let fetcher: Fetcher | null = null;
/** Tests: the fetch Aris's calls use (null: the page's own). */
export function setArisFetch(f: Fetcher | null): void {
  fetcher = f;
}

export async function apiFetch(path: string, opts: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  try {
    const headers: Record<string, string> = Object.assign({}, (opts.headers as Record<string, string>) || {});
    if (typeof opts.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const f = fetcher ?? globalThis.fetch.bind(globalThis);
    const res = await f(path, { method: (opts.method as string) || 'GET', credentials: 'same-origin', headers, body: opts.body === undefined ? undefined : (opts.body as string) });
    if (res.status === 204) return {};
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { __error: (data && data.error) || 'HTTP ' + res.status, __status: res.status, __body: data };
    return data || {};
  } catch {
    return null;
  }
}
