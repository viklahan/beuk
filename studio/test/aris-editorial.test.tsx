import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudFacts, resetCloudFacts } from '../src/closure/index';
import { mountAris } from '../src/aris/index';
import { setArisFetch } from '../src/aris/net';
import { resetArisState } from '../src/aris/state';

/* The editorial run behind the laurel: the control exists only for an
   opted-in writer, the loop carries the digest batch to batch, and the
   report dialog shows the verdict with quoted findings. */

type Call = { path: string; body: Record<string, unknown> | null };
let calls: Call[];
let host: HTMLDivElement;

const STATUS = { enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [{ provider: 'openrouter', last4: 'abcd' }] };
const batchReport = (digest: string, quote: string) => ({
  findings: [{ severity: 'major', category: 'continuity', location: 'here', quote, why: 'w', fix: 'f' }],
  claims: { counts: [], travel: [{ chapter: '1', from: 'A', to: 'B', quote }], calendar: [] },
  digest,
  rejected: digest === 'B' ? 1 : 0,
  truncated: false,
});

function fakeFetch(failSecond = false): typeof fetch {
  return (async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (path === '/api/aris/status') return json(200, STATUS);
    if (path === '/api/aris/editorial') {
      const idx = body?.sectionIndex as number;
      if (failSecond && idx === 1) return json(502, { error: 'openrouter refused the request' });
      return json(200, {
        section: { index: idx, count: 2, label: `Ch ${idx + 1}` },
        report: batchReport(idx === 0 ? 'A' : 'B', `quote ${idx}`),
      });
    }
    if (path === '/api/aris/editorial/verdict')
      return json(200, { gate: 'PASS', tallies: { critical: 0, major: 2, minor: 0 }, ledgerFindings: [] });
    return json(404, { error: 'nope' });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  resetArisState();
  resetCloudFacts();
  cloudFacts.linkedId = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  setArisFetch(null);
  document.body.innerHTML = '';
});

const control = () => document.querySelector<HTMLButtonElement>('[data-aris="editorial-open"]');
const dialog = () => document.querySelector<HTMLDialogElement>('[data-aris="editorial"]');
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('the editorial control', () => {
  it('exists only when Aris is summoned', async () => {
    setArisFetch(fakeFetch());
    await mountAris(host);
    expect(control()).not.toBeNull();
  });

  it('is absent for a known account that sent Aris away', async () => {
    setArisFetch((async () =>
      new Response(JSON.stringify({ ...STATUS, optedIn: false }), { status: 200 })) as unknown as typeof fetch);
    await mountAris(host);
    expect(control()).toBeNull();
  });
});

describe('the editorial run', () => {
  it('loops the sections carrying the digest, then renders the verdict and quoted findings', async () => {
    setArisFetch(fakeFetch());
    await mountAris(host);
    control()!.click();
    const d = dialog()!;
    expect(d).not.toBeNull();
    d.querySelector<HTMLButtonElement>('[data-aris="editorial-run"]')!.click();
    await settle(12);
    const batches = calls.filter((c) => c.path === '/api/aris/editorial');
    expect(batches.length).toBe(2);
    expect(batches[0].body?.digest ?? '').toBe('');
    expect(batches[1].body?.digest).toBe('A');
    expect(calls.some((c) => c.path === '/api/aris/editorial/verdict')).toBe(true);
    expect(d.textContent).toContain('PASS');
    expect(d.textContent).toContain('quote 0');
    expect(d.textContent).toContain('quote 1');
    expect(d.textContent).toContain('A → B'); // the travel claim, listed for the writer's own eye
  });

  it('a failed batch surfaces the error and keeps the partial findings', async () => {
    setArisFetch(fakeFetch(true));
    await mountAris(host);
    control()!.click();
    dialog()!.querySelector<HTMLButtonElement>('[data-aris="editorial-run"]')!.click();
    await settle(12);
    expect(dialog()!.textContent).toContain('refused');
    expect(dialog()!.textContent).toContain('quote 0');
    expect(calls.some((c) => c.path === '/api/aris/editorial/verdict')).toBe(false);
  });
});
