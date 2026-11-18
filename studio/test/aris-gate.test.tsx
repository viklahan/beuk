import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAris } from '../src/aris/index';
import { setArisFetch } from '../src/aris/net';
import { arisStatus, resetArisState } from '../src/aris/state';

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
let host: HTMLDivElement;

beforeEach(() => {
  resetArisState();
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
    expect(arisStatus()).toEqual({ enabled: true, optedIn: true, voice: 'laconic', keys: [] });
    expect(f).toHaveBeenCalledTimes(1);
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
    expect(host.querySelectorAll('[data-aris]').length).toBe(1);
  });
  it('no topbar, no glyph, no throw', async () => {
    const { mountArisInTopbar } = await import('../src/aris/index');
    setArisFetch(reply(200, { enabled: true, optedIn: true, voice: 'laconic', keys: [] }) as unknown as typeof fetch);
    await expect(mountArisInTopbar()).resolves.toBeUndefined();
    expect(document.querySelector('[data-aris]')).toBeNull();
  });
});
