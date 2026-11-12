import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { resetServerFacts } from '../src/settings/SettingsDialog';

/* Cutover task 1: 1.0's BEUK:panes (the two column folds, localStorage beuk.panes.v1) and the top bar's Support button
   (#btnSupport, shown only while /api/config/public gives a support address; opens /help/#support).
   1.0's self-check panes.collapse.both-sides is re-expressed here for jsdom: the fold classes, aria-expanded, the saved
   state, both sides at once, and both back. What jsdom cannot do (it loads no CSS and has no layout) -- that the folded
   column is display:none and the editor really gets wider -- stays with 1.0's own self-check in a real browser. */

const E = en as Record<string, string>;
const REPO = path.join(import.meta.dirname, '..', '..') + path.sep;
const KEY = 'beuk.panes.v1';
const $ = (id: string) => document.getElementById(id) as HTMLElement;

let config: unknown = undefined;
beforeEach(() => {
  resetServerFacts();
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  config = undefined;
  vi.stubGlobal('fetch', async (url: string) =>
    String(url) === '/api/config/public' && config !== undefined
      ? new Response(JSON.stringify(config), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{"error":"not found"}', { status: 404 }),
  );
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('dir');
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const mount = (lang = 'en') =>
  render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  );
const state = () => ({ l: $('foldLeft').getAttribute('aria-expanded'), r: $('foldRight').getAttribute('aria-expanded'), cls: $('panes').className });

describe('column folds (1.0 BEUK:panes)', () => {
  it('both seam tabs exist with 1.0 ids, aria-controls and open state', () => {
    mount();
    expect($('foldLeft').getAttribute('aria-controls')).toBe('pane-structure');
    expect($('foldRight').getAttribute('aria-controls')).toBe('pane-preview');
    expect($('foldLeft').getAttribute('aria-label')).toBe('Hide the left column');
    expect($('foldRight').getAttribute('aria-label')).toBe('Hide the reader');
    expect(state()).toEqual({ l: 'true', r: 'true', cls: '' });
    expect($('foldLeft').classList.contains('pane-fold')).toBe(true);
  });

  it('each fold hides its pane (fold-left / fold-right) and flips aria-expanded and its label; the same tab brings it back', () => {
    mount();
    fireEvent.click($('foldLeft'));
    expect(state()).toEqual({ l: 'false', r: 'true', cls: 'fold-left' });
    expect($('foldLeft').getAttribute('aria-label')).toBe('Show the left column');
    fireEvent.click($('foldLeft'));
    expect(state()).toEqual({ l: 'true', r: 'true', cls: '' });
    fireEvent.click($('foldRight'));
    expect(state()).toEqual({ l: 'true', r: 'false', cls: 'fold-right' });
    expect($('foldRight').getAttribute('aria-label')).toBe('Show the reader');
    fireEvent.click($('foldRight'));
    expect(state()).toEqual({ l: 'true', r: 'true', cls: '' });
  });

  it('panes.collapse.both-sides: both fold together, are remembered under beuk.panes.v1, and both come back', () => {
    mount();
    const resized = vi.fn();
    window.addEventListener('resize', resized);
    fireEvent.click($('foldLeft'));
    fireEvent.click($('foldRight'));
    expect(state()).toEqual({ l: 'false', r: 'false', cls: 'fold-left fold-right' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ left: true, right: true });
    expect(resized).toHaveBeenCalledTimes(2); // 1.0 tells the reader and the editor to re-measure
    fireEvent.click($('foldLeft'));
    fireEvent.click($('foldRight'));
    expect(state()).toEqual({ l: 'true', r: 'true', cls: '' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ left: false, right: false });
    window.removeEventListener('resize', resized);
  });

  it('the state survives a remount, read from 1.0 key; a restore writes nothing and a broken value is ignored', () => {
    localStorage.setItem(KEY, JSON.stringify({ left: true, right: false }));
    const first = mount();
    expect(state()).toEqual({ l: 'false', r: 'true', cls: 'fold-left' });
    first.unmount();
    mount();
    expect(state().cls).toBe('fold-left');
    cleanup();
    localStorage.setItem(KEY, '{not json');
    mount();
    expect(state()).toEqual({ l: 'true', r: 'true', cls: '' });
    cleanup();
    localStorage.removeItem(KEY);
    mount();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a fold made by a click is what a fresh mount shows', () => {
    const a = mount();
    fireEvent.click($('foldRight'));
    a.unmount();
    mount();
    expect(state()).toEqual({ l: 'true', r: 'false', cls: 'fold-right' });
  });

  it('under ar the document is rtl and the seam tabs are placed with logical sides, in the studio and in 1.0', () => {
    mount('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');
    const old = readFileSync(REPO + 'client/index.html', 'utf8');
    for (const src of [css, old]) {
      expect(src).toMatch(/#foldLeft \{ inset-inline-start: var\(--pane-l\)/);
      expect(src).toMatch(/#foldRight \{ inset-inline-end: var\(--pane-r\)/);
      expect(src).toMatch(/html\[dir="rtl"\] \.pane-fold svg \{ transform: scaleX\(-1\); \}/);
      expect(src).toMatch(/html\[dir="rtl"\] #panes\.fold-left #foldLeft svg[^{]*\{ transform: scaleX\(-1\) rotate\(180deg\); \}/);
      expect(src).not.toMatch(/#foldLeft \{ left:/);
      expect(src).not.toMatch(/#foldRight \{ right:/);
    }
  });
});

describe('Support button (1.0 beukSupportLoad)', () => {
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

  it('is absent with no support address (no server, a bad address)', async () => {
    mount();
    await settle();
    expect(document.getElementById('btnSupport')).toBeNull();
    cleanup();
    resetServerFacts();
    config = { support: { email: 'not an address' } };
    mount();
    await settle();
    expect(document.getElementById('btnSupport')).toBeNull();
  });

  it('is present with an address, carries 1.0 tip, label and icon, and opens /help/#support in a new tab', async () => {
    config = { support: { email: 'help@beuk.studio' } };
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount();
    await waitFor(() => expect(document.getElementById('btnSupport')).not.toBeNull());
    const b = $('btnSupport');
    expect(b.getAttribute('data-tip')).toBe('tips.support');
    expect(b.getAttribute('data-tip-place')).toBe('bottom');
    expect(b.getAttribute('aria-label')).toBe(E['top.supportAria']);
    expect(b.querySelector('.tb-label')!.textContent).toBe(E['top.support']);
    expect(b.querySelector('svg.lucide-coffee')).not.toBeNull();
    fireEvent.click(b);
    expect(open).toHaveBeenCalledWith('/help/#support', '_blank', 'noopener');
    // after Homeport and Help, before Export, as in 1.0's top bar
    const ids = Array.from(document.querySelectorAll('#topbar > button')).map((x) => x.id);
    expect(ids.indexOf('btnHelp')).toBeLessThan(ids.indexOf('btnSupport'));
    expect(ids.indexOf('btnSupport')).toBeLessThan(ids.indexOf('btnExport'));
  });
});
