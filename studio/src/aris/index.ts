import './aris.css';
import { apiFetch } from './net';
import { askOnce, forgetArisAsk, setArisStatus, arisStatus, type ArisStatus } from './state';
import { registerEditorExtras } from '../editor/extras';
import { editorExtra } from './flow';
import { openEditorial } from './editorial';

const SVG = 'http://www.w3.org/2000/svg';

/** The laurel: lit, Aris is summoned; dim, Aris is away. The mark itself is the desk's switch — the same account-wide
 *  opt-in the /aris page flips, so the two always agree. */
function glyph(): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('data-aris', 'glyph');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  // a thin laurel sprig: a stem and paired leaves
  for (const d of ['M12 21C12 15 12 9 12 3', 'M12 17C8 17 6 14 6 11C9 11 11 13 12 17', 'M12 17C16 17 18 14 18 11C15 11 13 13 12 17', 'M12 11C8.5 10.5 7 8 7 5.5C10 6 11.5 8 12 11', 'M12 11C15.5 10.5 17 8 17 5.5C14 6 12.5 8 12 11']) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  el.appendChild(svg);
  el.addEventListener('click', () => void toggleAris(el));
  return el;
}

function parseStatus(r: Record<string, unknown> | null): ArisStatus | null {
  if (!r || '__error' in r || r.enabled !== true) return null;
  return { enabled: true, optedIn: r.optedIn === true, known: r.known === true, voice: String(r.voice ?? ''), keys: Array.isArray(r.keys) ? r.keys : [] };
}

const fetchStatus = (): Promise<ArisStatus | null> => apiFetch('/api/aris/status').then(parseStatus);

function paint(el: HTMLElement, on: boolean): void {
  el.setAttribute('data-aris-state', on ? 'on' : 'off');
  el.setAttribute('aria-pressed', String(on));
  el.setAttribute('aria-label', on ? 'Aris is summoned — send it away' : 'Aris is away — summon it');
  el.title = el.getAttribute('aria-label')!;
  syncEditorialControl(el, on);
}

/** The editorial read rides beside the laurel, and only while Aris is
 *  summoned: sent away, the control goes with the menu and toolbar. */
function syncEditorialControl(glyphEl: HTMLElement, on: boolean): void {
  let btn = document.querySelector<HTMLButtonElement>('[data-aris="editorial-open"]');
  if (!on) {
    btn?.remove();
    return;
  }
  if (btn) return;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-aris', 'editorial-open');
  btn.textContent = 'Editorial';
  btn.title = 'Aris reads the whole book and reports only what it can quote';
  btn.addEventListener('click', () => openEditorial());
  glyphEl.insertAdjacentElement('afterend', btn);
}

/** The laurel's press: flip the account's opt-in (the very switch /aris flips; keys stay put). A refusal or an
 *  unreachable server changes nothing — the mark keeps its state. */
async function toggleAris(el: HTMLElement): Promise<void> {
  const s = arisStatus();
  if (!s) return;
  const ns = parseStatus(await apiFetch('/api/aris/settings', { method: 'PUT', body: JSON.stringify({ optedIn: !s.optedIn }) }));
  if (!ns) return;
  setArisStatus(ns);
  if (ns.optedIn) registerEditorExtras([editorExtra]);
  paint(el, ns.optedIn);
}

/** The module's one entry. Asks the server once per session. A known account (it has summoned Aris at /aris before)
 *  gets the laurel — lit or dormant — and every chapter editor (open now or later) the summon, toolbar and ghost
 *  behaviour, which checks the live opt-in per gesture. An account that never invited Aris gets nothing at all. */
export async function mountAris(host: Element | null = document.body): Promise<void> {
  const s = await askOnce(fetchStatus);
  setArisStatus(s);
  const live = document.querySelector<HTMLElement>('[data-aris="glyph"]');
  if (!s || (!s.optedIn && !s.known)) {
    live?.remove();
    document.querySelector('[data-aris="editorial-open"]')?.remove();
    return;
  }
  registerEditorExtras([editorExtra]); // once: the registry keeps a factory a single time
  const el = live ?? glyph();
  if (!live && host) host.appendChild(el);
  paint(el, s.optedIn); // after insertion: paint also seats the editorial control beside the mark
}

/** What Shell's mount effect runs once a book is open: mount into the topbar (the element holding #btnHomeport). */
export function mountArisInTopbar(): Promise<void> {
  return mountAris(document.getElementById('btnHomeport')?.parentElement ?? null);
}

/** The account changed (sign-in or sign-out, this tab or another): the session's one ask is stale. Forget it and
 *  mount again — the laurel arrives, changes state, or goes, to match the account that now holds the session.
 *  Shell subscribes this to cloud's onAuthChange. */
export async function arisAuthChanged(): Promise<void> {
  forgetArisAsk();
  await mountArisInTopbar();
}

export { arisStatus };
