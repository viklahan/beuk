/* BEUK:sidebar — 1.0's per-device sidebar layout (client/index.html
   sidePrefs / sidePrefsSave): the statistics disclosure (closed by default)
   and which outline groups are folded, under 1.0's key and in 1.0's shape,
   { statusOpen: boolean, groups: { front, body, back } } (step 5 design,
   decision 5: both apps read the same preference). A convenience only:
   every access is guarded, and with storage unavailable the sidebar shows
   all groups open and the statistics closed. */

export const SIDE_PREFS_KEY = 'beuk.sidebar.v1';
export type GroupKey = 'front' | 'body' | 'back';
export type SidePrefs = { statusOpen: boolean; groups: Record<GroupKey, boolean> };

let cache: SidePrefs | null = null;

/** 1.0's sidePrefs(): read once, normalised to its shape. */
export function sidePrefs(): SidePrefs {
  if (cache) return cache;
  let v: unknown = null;
  try {
    const raw = globalThis.localStorage?.getItem(SIDE_PREFS_KEY);
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  const o = v && typeof v === 'object' ? (v as { statusOpen?: unknown; groups?: unknown }) : null;
  const g = o && o.groups && typeof o.groups === 'object' ? (o.groups as Record<string, unknown>) : {};
  cache = { statusOpen: !!(o && o.statusOpen === true), groups: { front: g.front === true, body: g.body === true, back: g.back === true } };
  return cache;
}

/** 1.0's sidePrefsSave(): the whole normalised record. */
function save(): void {
  try {
    globalThis.localStorage?.setItem(SIDE_PREFS_KEY, JSON.stringify(sidePrefs()));
  } catch {
    /* blocked or full: the layout is a convenience */
  }
}

/** 1.0's sideOutlineSetCollapsed: writes only on a change. Returns whether it changed. */
export function setGroupCollapsed(gk: GroupKey, collapsed: boolean): boolean {
  const p = sidePrefs();
  if (!(gk in p.groups) || p.groups[gk] === !!collapsed) return false;
  p.groups[gk] = !!collapsed;
  save();
  return true;
}

/** 1.0's sideStatusToggle. */
export function setStatusOpen(open: boolean): void {
  sidePrefs().statusOpen = !!open;
  save();
}

/** Tests: forget the cached record. */
export function resetSidePrefsCache(): void {
  cache = null;
}

/** 1.0's groupOf → ogKeyOf: front, body, else back. */
export const groupOf = (kind: unknown): GroupKey => (kind === 'front' ? 'front' : kind === 'body' ? 'body' : 'back');
