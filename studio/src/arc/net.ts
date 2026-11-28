/* The ARC panel's transport (ARC slice 1, Task 8): the same request and answer shapes as src/aris/net.ts's apiFetch
   (same-origin credentials, JSON content type for a string body): {} for 204, the JSON body, { __error, __status, __body }
   for an error status, null when the network failed. Self-contained, so the panel's tests hand it a recording fake. */

type Fetcher = typeof fetch;
let fetcher: Fetcher | null = null;
/** Tests: the fetch the panel's calls use (null: the page's own). */
export function setArcFetch(f: Fetcher | null): void {
  fetcher = f;
}

export async function arcFetch(path: string, opts: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
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
