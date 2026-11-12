// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { studioDoor } from '../src/cloud/doors';

/* Task 2 (studio-2 cutover): 1.0's studioDoorFromUrl and portalDoorBook, each behaviour of the brief. */

const ID = '0b9a3c1e-5d2f-4a7b-8c61-9e0f1a2b3c4d';
const at = (url: string) => history.replaceState({ keep: 1 }, '', url);
const mk = () => ({ openAuth: vi.fn(), setAuthMode: vi.fn(), cloudOpenBook: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));
const out = { available: true, user: null as unknown };
const inn = { available: true, user: { id: 'u1' } };
afterEach(() => at('/'));

describe('the entry doors', () => {
  it('?signup signed out opens the dialog in register mode', () => {
    at('/next/?signup');
    const a = mk();
    studioDoor(a, out, null, vi.fn());
    expect(a.openAuth).toHaveBeenCalledTimes(1);
    expect(a.setAuthMode).toHaveBeenCalledWith('register');
  });
  it('?signin signed out opens it in login mode (no mode switch)', () => {
    at('/next/?signin');
    const a = mk();
    studioDoor(a, out, null, vi.fn());
    expect(a.openAuth).toHaveBeenCalledTimes(1);
    expect(a.setAuthMode).not.toHaveBeenCalled();
  });
  it('either one signed in clicks the account button, as 1.0 does', () => {
    for (const w of ['?signin', '?signup']) {
      at('/next/' + w);
      const a = mk(), click = vi.fn();
      studioDoor(a, inn, null, click);
      expect(click).toHaveBeenCalledTimes(1);
      expect(a.openAuth).not.toHaveBeenCalled();
    }
  });
  it('?book=<uuid> signed out opens sign-in only', async () => {
    at('/next/?book=' + ID);
    const a = mk();
    studioDoor(a, out, null, vi.fn());
    await flush();
    expect(a.openAuth).toHaveBeenCalledTimes(1);
    expect(a.cloudOpenBook).not.toHaveBeenCalled();
  });
  it('?book=<uuid> signed in opens it after the sign-in work settles, even if that work failed', async () => {
    at('/next/?book=' + ID);
    const a = mk();
    let done!: (v?: unknown) => void;
    studioDoor(a, inn, new Promise((_, rej) => (done = rej)), vi.fn());
    await flush();
    expect(a.cloudOpenBook).not.toHaveBeenCalled();
    done(new Error('x'));
    await flush();
    expect(a.cloudOpenBook).toHaveBeenCalledWith(ID);
    expect(a.openAuth).not.toHaveBeenCalled();
  });
  it('a malformed ?book= is ignored: nothing opens signed in; signed out still opens sign-in (1.0); the word goes', async () => {
    for (const bad of ['', 'nope', ID + 'x', '../x']) {
      at('/next/?book=' + encodeURIComponent(bad));
      const a = mk();
      studioDoor(a, inn, null, vi.fn());
      await flush();
      expect(a.cloudOpenBook).not.toHaveBeenCalled();
      expect(location.search).toBe('');
    }
    at('/next/?book=nope');
    const a = mk();
    studioDoor(a, out, null, vi.fn());
    expect(a.openAuth).toHaveBeenCalledTimes(1);
  });
  it('the door word leaves the address, other query and hash and state stay, under any base', () => {
    for (const base of ['/next/', '/studio/', '/']) {
      at(base + '?a=1&signup&book=' + ID + '&b=2&signin#h');
      studioDoor(mk(), out, null, vi.fn());
      expect(location.pathname).toBe(base);
      expect(location.search).toBe('?a=1&b=2');
      expect(location.hash).toBe('#h');
      expect(history.state).toEqual({ keep: 1 });
    }
  });
  it('offline (no shelf): nothing opens, the word still goes', () => {
    at('/next/?signup');
    const a = mk();
    studioDoor(a, { available: false, user: null }, null, vi.fn());
    expect(a.openAuth).not.toHaveBeenCalled();
    expect(location.search).toBe('');
  });
  it('no door word: nothing happens and the address is untouched', () => {
    at('/next/?x=1');
    const a = mk();
    studioDoor(a, out, null, vi.fn());
    expect(a.openAuth).not.toHaveBeenCalled();
    expect(location.search).toBe('?x=1');
  });
});
