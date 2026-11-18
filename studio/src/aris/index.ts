import './aris.css';
import { apiFetch } from './net';
import { askOnce, setArisStatus, arisStatus, type ArisStatus } from './state';
import { registerEditorExtras } from '../editor/extras';
import { editorExtra } from './flow';

const SVG = 'http://www.w3.org/2000/svg';

function glyph(): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute('data-aris', 'glyph');
  el.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  // a thin laurel sprig: a stem and paired leaves
  for (const d of ['M12 21C12 15 12 9 12 3', 'M12 17C8 17 6 14 6 11C9 11 11 13 12 17', 'M12 17C16 17 18 14 18 11C15 11 13 13 12 17', 'M12 11C8.5 10.5 7 8 7 5.5C10 6 11.5 8 12 11', 'M12 11C15.5 10.5 17 8 17 5.5C14 6 12.5 8 12 11']) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  el.appendChild(svg);
  return el;
}

async function fetchStatus(): Promise<ArisStatus | null> {
  const r = await apiFetch('/api/aris/status');
  if (!r || '__error' in r || r.enabled !== true) return null;
  const s: ArisStatus = { enabled: true, optedIn: r.optedIn === true, voice: String(r.voice ?? ''), keys: Array.isArray(r.keys) ? r.keys : [] };
  return s;
}

/** The module's one entry. Asks the server once per session; only when enabled and opted in, gives every chapter
 *  editor (open now or later) the summon menu and the ghost, and renders the glyph into `host`. */
export async function mountAris(host: Element | null = document.body): Promise<void> {
  const s = await askOnce(fetchStatus);
  setArisStatus(s);
  if (!s || !s.optedIn) return;
  registerEditorExtras([editorExtra]); // once: the registry keeps a factory a single time
  if (!host) return;
  if (!host.querySelector('[data-aris="glyph"]')) host.appendChild(glyph());
}

/** What Shell's mount effect runs once a book is open: mount into the topbar (the element holding #btnHomeport). */
export function mountArisInTopbar(): Promise<void> {
  return mountAris(document.getElementById('btnHomeport')?.parentElement ?? null);
}

export { arisStatus };
