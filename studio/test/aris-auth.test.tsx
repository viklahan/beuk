import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authAnnounce, onAuthChange } from '../src/cloud/cloud';
import { cloudFacts, resetCloudFacts } from '../src/closure/index';
import { arisAuthChanged, mountArisInTopbar } from '../src/aris/index';
import { setArisFetch } from '../src/aris/net';
import { resetArisState } from '../src/aris/state';

/* The sign-in staleness fix, end to end at the seam: cloud's authAnnounce tells its listeners when the account
   changed (and only then), and Aris — subscribed by Shell as onAuthChange(arisAuthChanged) — asks the server again
   instead of trusting the session's one cached ask. */

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetArisState();
  resetCloudFacts();
});
afterEach(() => {
  setArisFetch(null);
  document.body.innerHTML = '';
});

describe('cloud onAuthChange', () => {
  it('authAnnounce tells listeners when the account changed, and only then', () => {
    const heard = vi.fn();
    onAuthChange(heard);
    const base = heard.mock.calls.length; // knownUser persists per module: count deltas, not absolutes
    cloudFacts.user = { id: 'aris-auth-u1' };
    authAnnounce();
    expect(heard.mock.calls.length).toBe(base + 1);
    authAnnounce(); // the same account again: not a change
    expect(heard.mock.calls.length).toBe(base + 1);
    cloudFacts.user = null;
    authAnnounce(); // signed out: a change
    expect(heard.mock.calls.length).toBe(base + 2);
  });

  it('the same listener subscribed twice hears a change once', () => {
    const heard = vi.fn();
    onAuthChange(heard);
    onAuthChange(heard);
    const base = heard.mock.calls.length;
    cloudFacts.user = { id: 'aris-auth-u2' };
    authAnnounce();
    expect(heard.mock.calls.length).toBe(base + 1);
  });
});

describe('the wired chain (as Shell wires it)', () => {
  it('a sign-in announced by cloud re-asks Aris and the laurel arrives', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<div id="bar"><button id="btnHomeport"></button></div>';
    document.body.appendChild(host);
    setArisFetch(reply(401, { error: 'sign in first' }));
    await mountArisInTopbar();
    expect(host.querySelector('[data-aris="glyph"]')).toBeNull();

    onAuthChange(arisAuthChanged); // Shell's line
    setArisFetch(reply(200, { enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [] }));
    cloudFacts.user = { id: 'aris-auth-u3' };
    authAnnounce();
    await settle();
    await settle();
    expect(host.querySelector('[data-aris="glyph"]')).not.toBeNull();
  });
});
