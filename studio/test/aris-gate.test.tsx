import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arisAuthChanged, mountAris } from '../src/aris/index';
import { setArisFetch } from '../src/aris/net';
import { arisStatus, resetArisState } from '../src/aris/state';
import { getEditorExtras, resetEditorExtras } from '../src/editor/extras';

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
let host: HTMLDivElement;

beforeEach(() => {
  resetArisState();
  resetEditorExtras();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  setArisFetch(null);
  host.remove();
});

describe('aris gate', () => {
  it('no status means no glyph', async () => {
    const f = reply(404, { error: 'nope' });
    setArisFetch(f as unknown as typeof fetch);
    await mountAris(host);
    await mountAris(host);
    expect(host.querySelector('[data-aris]')).toBeNull();
    expect(arisStatus()).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('a network failure means no glyph and no retry', async () => {
    const f = vi.fn(async () => { throw new Error('down'); });
    setArisFetch(f as unknown as typeof fetch);
    await mountAris(host);
    await mountAris(host);
    expect(host.querySelector('[data-aris]')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('enabled false means no glyph', async () => {
    setArisFetch(reply(200, { enabled: false, optedIn: true, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    await mountAris(host);
    expect(host.querySelector('[data-aris]')).toBeNull();
    expect(arisStatus()).toBeNull();
  });
  it('enabled but not opted in shows no glyph', async () => {
    setArisFetch(reply(200, { enabled: true, optedIn: false, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    await mountAris(host);
    expect(host.querySelector('[data-aris]')).toBeNull();
  });
  it('enabled and opted in shows the glyph', async () => {
    const f = reply(200, { enabled: true, optedIn: true, voice: 'laconic', keys: [] });
    setArisFetch(f as unknown as typeof fetch);
    await mountAris(host);
    await mountAris(host);
    expect(host.querySelectorAll('[data-aris="glyph"]').length).toBe(1);
    expect(arisStatus()).toEqual({ enabled: true, optedIn: true, known: false, voice: 'laconic', keys: [] });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('aris desk toggle (the laurel is the switch)', () => {
  /** A fetch whose GET /status answers `status`, and whose PUT /settings applies optedIn and answers the new status
   *  (known true, as the server would) — or `putFail`'s error when set. */
  let status: Record<string, unknown>;
  let putFail: number | null;
  let puts: Record<string, unknown>[];
  const toggleFetch = (): typeof fetch =>
    (async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        puts.push(body);
        if (putFail) return new Response(JSON.stringify({ error: 'nope' }), { status: putFail });
        status = { ...status, optedIn: body.optedIn ?? status.optedIn, known: true };
        return new Response(JSON.stringify(status), { status: 200 });
      }
      return new Response(JSON.stringify(status), { status: 200 });
    }) as unknown as typeof fetch;
  const glyph = () => host.querySelector<HTMLElement>('[data-aris="glyph"]');
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    putFail = null;
    puts = [];
  });

  it('a known account not opted in gets the dormant laurel, and no summon behaviour yet', async () => {
    status = { enabled: true, optedIn: false, known: true, voice: 'laconic', keys: [] };
    setArisFetch(toggleFetch());
    await mountAris(host);
    const g = glyph();
    expect(g).not.toBeNull();
    expect(g!.getAttribute('data-aris-state')).toBe('off');
    expect(g!.getAttribute('aria-pressed')).toBe('false');
    expect(g!.tagName).toBe('BUTTON');
  });

  it('a never-summoned account still gets nothing', async () => {
    status = { enabled: true, optedIn: false, known: false, voice: 'laconic', keys: [] };
    setArisFetch(toggleFetch());
    await mountAris(host);
    expect(glyph()).toBeNull();
    expect(getEditorExtras().length).toBe(0);
  });

  it('clicking the dormant laurel summons Aris: PUT optedIn true, the mark lights, the summon arrives', async () => {
    status = { enabled: true, optedIn: false, known: true, voice: 'laconic', keys: [] };
    setArisFetch(toggleFetch());
    await mountAris(host);
    glyph()!.click();
    await settle();
    expect(puts).toEqual([{ optedIn: true }]);
    expect(glyph()!.getAttribute('data-aris-state')).toBe('on');
    expect(glyph()!.getAttribute('aria-pressed')).toBe('true');
    expect(arisStatus()?.optedIn).toBe(true);
    expect(getEditorExtras().length).toBe(1);
  });

  it('clicking the lit laurel sends Aris away: PUT optedIn false, the mark goes dim', async () => {
    status = { enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [] };
    setArisFetch(toggleFetch());
    await mountAris(host);
    expect(glyph()!.getAttribute('data-aris-state')).toBe('on');
    glyph()!.click();
    await settle();
    expect(puts).toEqual([{ optedIn: false }]);
    expect(glyph()!.getAttribute('data-aris-state')).toBe('off');
    expect(arisStatus()?.optedIn).toBe(false);
  });

  it('a toggle the server refused changes nothing', async () => {
    status = { enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [] };
    setArisFetch(toggleFetch());
    await mountAris(host);
    putFail = 500;
    glyph()!.click();
    await settle();
    expect(glyph()!.getAttribute('data-aris-state')).toBe('on');
    expect(arisStatus()?.optedIn).toBe(true);
  });
});

describe('the account changed under the open studio (sign-in without a reload)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('signing in after the book opened brings Aris without a reload', async () => {
    host.innerHTML = '<div id="bar"><button id="btnHomeport"></button></div>';
    const anon = reply(401, { error: 'sign in first' });
    setArisFetch(anon as unknown as typeof fetch);
    const { mountArisInTopbar } = await import('../src/aris/index');
    await mountArisInTopbar();
    expect(host.querySelector('[data-aris="glyph"]')).toBeNull();
    // the writer signs in: the session's one ask is stale — the account changed, so Aris asks again
    setArisFetch(reply(200, { enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    await arisAuthChanged();
    await settle();
    const g = host.querySelector('#btnHomeport')!.parentElement!.querySelector<HTMLElement>('[data-aris="glyph"]');
    expect(g).not.toBeNull();
    expect(g!.getAttribute('data-aris-state')).toBe('on');
  });

  it('signing out takes the laurel away and forgets the status', async () => {
    host.innerHTML = '<div id="bar"><button id="btnHomeport"></button></div>';
    setArisFetch(reply(200, { enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    const { mountArisInTopbar } = await import('../src/aris/index');
    await mountArisInTopbar();
    expect(host.querySelector('[data-aris="glyph"]')).not.toBeNull();
    setArisFetch(reply(401, { error: 'sign in first' }) as unknown as typeof fetch);
    await arisAuthChanged();
    expect(host.querySelector('[data-aris="glyph"]')).toBeNull();
    expect(arisStatus()).toBeNull();
  });
});

describe('aris topbar mount (what Shell calls)', () => {
  it('lands exactly one glyph beside #btnHomeport, once per session', async () => {
    const { mountArisInTopbar } = await import('../src/aris/index');
    host.innerHTML = '<div id="bar"><button id="btnHomeport"></button></div>';
    setArisFetch(reply(200, { enabled: true, optedIn: true, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    await mountArisInTopbar();
    await mountArisInTopbar();
    const bar = host.querySelector('#btnHomeport')!.parentElement!;
    expect(bar.querySelectorAll('[data-aris="glyph"]').length).toBe(1);
    // the laurel and, since the editorial lens, its one companion control
    expect(host.querySelectorAll('[data-aris]').length).toBe(2);
    expect(host.querySelectorAll('[data-aris="editorial-open"]').length).toBe(1);
  });
  it('no topbar, no glyph, no throw', async () => {
    const { mountArisInTopbar } = await import('../src/aris/index');
    setArisFetch(reply(200, { enabled: true, optedIn: true, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    await expect(mountArisInTopbar()).resolves.toBeUndefined();
    expect(document.querySelector('[data-aris]')).toBeNull();
  });
});
