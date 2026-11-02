import { shaOfData } from '@book/editor/index.js';
import { cloudFacts } from '../closure/index';
import { apiFetch } from '../covenant/net';

/* Per-user themes ("My themes", plan 2026-11-02, constraints 46-50): the store behind them. No session, no UI, no
   closure code here: themeActions.ts puts a theme into a book and takes one out of it; this module keeps the list.

   Where the list lives:
   - signed in: the account (/api/themes, src/routes/user-themes.ts), with a copy on this device in IndexedDB
     ("beuk-mythemes", never 1.0's "beuk-local"). The device copy is read at once and refreshed from the account; a
     write is put on the device first, then sent — and sent again when the browser comes back online, when the page
     hides and every 30 s while one waits (the series Covenant's retries, covenant/net.ts). A stale write (409) keeps
     both: the account's copy keeps the theme's key and name, and this device's edit is kept beside it as a theme of
     its own, "<name> (this device)", sent next;
   - signed out: this device only (the Covenant's signed-out rule).
   Each account's device copy is its own (owner "u:<user id>"), and so is the signed-out one (owner "device"): on a
   browser two writers share, one never lists, applies or sends the other's themes.

   A saved theme carries its fonts and flourishes (V's decision): the doc names each by the SHA-256 of its bytes; the
   bytes sit beside it on the device (the `assets` store) and, signed in, in the account's own picture store
   (/api/pictures, uploaded before the theme names them). Everything read back — from the account or from the device —
   is untrusted: cleanMineDoc checks its shape here, and the theme itself passes the Style session's safe path before
   1.0's code or the page sees it (themeActions.ts). */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

export type MineAsset = { kind: 'font' | 'flourish'; sha256: string; mediaType: string; id?: string; name?: string; family?: string; ext?: string; flourish?: boolean };
export type MineDoc = { id: string; name: string; theme: Rec; assets: MineAsset[] };
export type MineRec = {
  owner: string;
  key: string;
  name: string;
  doc: MineDoc;
  /** The account's revision this copy is based on; null: never on the account (device-only, or not sent yet). */
  revision: number | null;
  /** Changed here and not on the account yet. */
  dirty: boolean;
  /** Deleted here; the account's delete not answered yet (kept so the delete is sent). */
  deleted: boolean;
  /** Why the account refused it (kept on the device; tried again after the next change). */
  refused?: string;
  /** When it was first kept (the list's order). */
  at: number;
};
export type Bytes = { mediaType: string; data: string };

/* ---- the caps (the server's, src/routes/user-themes.ts) ---- */
export const MINE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
export const MINE_NAME_MAX = 120;
export const MINE_DOC_MAX = 64 * 1024;
export const MINE_MAX = 200;
const ASSETS_MAX = 32;
const SHA = /^[0-9a-f]{64}$/;
const ASSET_MEDIA: Record<string, RegExp> = { font: /^font\/(?:ttf|otf)$/, flourish: /^image\/(?:svg\+xml|png)$/ };
const ASSET_EXT: Record<string, RegExp> = { font: /^(?:ttf|otf)$/, flourish: /^(?:svg|png)$/ };
/** The Style session's own rules (session.ts SAFE_FAMILY, PICTURE_ID), repeated here so this module needs no session. */
const SAFE_FAMILY = /^[\p{L}\p{M}\p{N} _.,&()+-]+$/u;
const PLAIN_ID = /^[\w-]{1,64}$/;
const FIELD_MAX = 200;

/** A theme doc as it may be used: 1.0's custom theme ({ id, name, theme }) and its assets, every field checked; null
 *  when it is not one (from the account, the device or a crafted response alike). The theme object's own values are the
 *  Style session's to correct (themeActions.ts runs its safe path). */
export function cleanMineDoc(raw: unknown, key?: string): MineDoc | null {
  if (!isRec(raw) || typeof raw.id !== 'string' || !MINE_KEY.test(raw.id) || (key !== undefined && raw.id !== key)) return null;
  if (!isRec(raw.theme)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, MINE_NAME_MAX) : '';
  if (!name) return null;
  const list = raw.assets === undefined ? [] : raw.assets;
  if (!Array.isArray(list) || list.length > ASSETS_MAX) return null;
  const assets: MineAsset[] = [];
  for (const a of list) {
    if (!isRec(a) || (a.kind !== 'font' && a.kind !== 'flourish')) return null;
    if (typeof a.sha256 !== 'string' || !SHA.test(a.sha256) || typeof a.mediaType !== 'string' || !ASSET_MEDIA[a.kind]!.test(a.mediaType)) return null;
    const out: MineAsset = { kind: a.kind, sha256: a.sha256, mediaType: a.mediaType };
    if (a.id !== undefined) {
      if (typeof a.id !== 'string' || !PLAIN_ID.test(a.id)) return null;
      out.id = a.id;
    }
    if (a.name !== undefined) {
      if (typeof a.name !== 'string' || a.name.length > FIELD_MAX || /[<>"'`\\]/.test(a.name)) return null;
      out.name = a.name;
    }
    if (a.ext !== undefined) {
      if (typeof a.ext !== 'string' || !ASSET_EXT[a.kind]!.test(a.ext)) return null;
      out.ext = a.ext;
    }
    if (a.kind === 'font') {
      if (typeof a.family !== 'string' || !a.family.trim() || a.family.length > FIELD_MAX || !SAFE_FAMILY.test(a.family.trim())) return null;
      out.family = a.family.trim();
      if (!out.ext) return null;
    } else {
      if (a.family !== undefined) return null;
      out.flourish = true;
      if (!out.id || !out.ext) return null;
    }
    assets.push(out);
  }
  // a deep, plain copy: nothing of the source object survives into the store
  let theme: Rec;
  try {
    theme = JSON.parse(JSON.stringify(raw.theme)) as Rec;
  } catch {
    return null;
  }
  return { id: raw.id, name, theme, assets };
}

/** Bytes as they may be kept: canonical base64 whose SHA-256 is the name they are kept under, of the asset's type. */
export function cleanBytes(sha: string, b: unknown): Bytes | null {
  if (!isRec(b) || typeof b.data !== 'string' || typeof b.mediaType !== 'string' || !b.data) return null;
  if (!/^(?:font\/(?:ttf|otf)|image\/(?:svg\+xml|png))$/.test(b.mediaType)) return null;
  return shaOfData(b.data) === sha ? { mediaType: b.mediaType, data: b.data } : null;
}

/* ---- the device copy (IndexedDB) ---- */
const DB_NAME = 'beuk-mythemes';
let dbp: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (!dbp)
    dbp = new Promise((resolve) => {
      const idb = globalThis.indexedDB;
      if (!idb) return resolve(null);
      let req: IDBOpenDBRequest;
      try {
        req = idb.open(DB_NAME, 1);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('themes')) db.createObjectStore('themes', { keyPath: ['owner', 'key'] }).createIndex('owner', 'owner');
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: ['owner', 'sha'] });
      };
      req.onsuccess = () => {
        const db = req.result;
        // another tab's upgrade or a delete of the database: let go of it (opened again on the next use)
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  return dbp;
}
function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}
async function idbPut(store: 'themes' | 'assets', values: unknown[]): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(store, 'readwrite');
    for (const v of values) tx.objectStore(store).put(v);
    return await done(tx);
  } catch {
    return false;
  }
}
async function idbDelete(owner: string, key: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction('themes', 'readwrite');
    tx.objectStore('themes').delete([owner, key]);
    return await done(tx);
  } catch {
    return false;
  }
}
async function idbOwnerThemes(owner: string): Promise<unknown[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction('themes', 'readonly').objectStore('themes').index('owner').getAll(owner);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
async function idbAsset(owner: string, sha: string): Promise<unknown> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction('assets', 'readonly').objectStore('assets').get([owner, sha]);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** A device record as it may be used (the device is untrusted too: another script, an old build, a crafted export). */
function cleanRec(owner: string, raw: unknown): MineRec | null {
  if (!isRec(raw) || raw.owner !== owner || typeof raw.key !== 'string') return null;
  const doc = cleanMineDoc(raw.doc, raw.key);
  if (!doc) return null;
  const revision = typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : null;
  return {
    owner,
    key: raw.key,
    name: doc.name,
    doc,
    revision,
    dirty: raw.dirty === true,
    deleted: raw.deleted === true,
    refused: typeof raw.refused === 'string' ? raw.refused.slice(0, 200) : undefined,
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
  };
}

/* ---- the list in memory, for the current owner ---- */
export const DEVICE = 'device';
/** Whose themes: the signed-in account's, else this device's. */
export function ownerNow(): string {
  const u = cloudFacts.user as { id?: unknown } | null;
  return u && typeof u.id === 'string' && u.id ? 'u:' + u.id : DEVICE;
}
/** Signed in as `o` now. 1.0 signs in and out inside the page (cloudSignOut, the sign-in dialog), so the owner the store
 *  was loaded for is checked against the account signed in at every use (review, Important 1). */
const signedIn = (o: string) => o !== DEVICE && cloudFacts.available && ownerNow() === o;
/** The store was loaded for someone who is not the one signed in now: nothing of theirs is listed, applied or sent. */
const stale = () => ownerNow() !== owner;

let owner = DEVICE;
let recs: MineRec[] = [];
let loadedFor: string | null = null;
let ver = 0;
const listeners = new Set<() => void>();
function emit(): void {
  ver++;
  for (const fn of listeners) fn();
}
/** Called whenever the list changes. Returns the unsubscribe. */
export function mineSubscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const mineVersion = (): number => ver;
/** The writer's themes, in the order they were first kept (deleted ones left out). */
export function mineList(): MineRec[] {
  if (stale()) return [];
  return recs.filter((r) => !r.deleted).sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
}
export const mineGet = (key: string): MineRec | null => (stale() ? null : recs.find((r) => r.key === key && !r.deleted) ?? null);
export const mineOwner = (): string => owner;
export const mineLoaded = (): boolean => loadedFor === owner && !stale();

/** What the store tells the writer (MyThemes.tsx sets these from the string table). */
export const mineUi: {
  deviceSuffix: () => string;
  conflict: (name: string) => void;
  refused: (name: string, why: 'full' | 'large' | 'other') => void;
} = { deviceSuffix: () => ' (this device)', conflict: () => undefined, refused: () => undefined };

/** Read the current owner's themes from the device (and, signed in, refresh from the account). */
export async function mineLoad(): Promise<void> {
  const o = ownerNow();
  if (owner !== o) {
    // another owner: the last one's list leaves memory at once (never listed, applied or sent as this one's)
    recs = [];
    loadedFor = null;
  }
  owner = o;
  const raw = await idbOwnerThemes(o);
  if (owner !== o) return; // the owner changed while reading
  recs = raw.map((r) => cleanRec(o, r)).filter((r): r is MineRec => !!r);
  loadedFor = o;
  emit();
  if (signedIn(o)) await mineSync();
}

async function putRec(r: MineRec): Promise<void> {
  await idbPut('themes', [r]);
}
function setRec(r: MineRec): void {
  recs = recs.filter((x) => x.key !== r.key).concat(r);
}

/** A uid as 1.0 makes them ("s" + 7 base-36 characters). */
const uid = () => 's' + Math.random().toString(36).slice(2, 9).padEnd(7, '0');

/** Keep a theme: its doc (cleanMineDoc's shape) and the bytes of every asset it names. Written on the device first;
 *  signed in, sent after. A theme of the same key is replaced (its account revision kept). Returns false when the
 *  device could not keep it or a cap refuses it (said through mineUi.refused). */
export async function mineSave(rawDoc: MineDoc, bytes: Map<string, Bytes>): Promise<boolean> {
  const doc = cleanMineDoc(rawDoc);
  if (!doc) return false;
  if (stale()) await mineLoad(); // kept for whoever is signed in now
  const prev = recs.find((r) => r.key === doc.id) ?? null;
  if (!prev || prev.deleted) {
    if (mineList().length >= MINE_MAX) {
      mineUi.refused(doc.name, 'full');
      return false;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(doc)).length > MINE_DOC_MAX) {
    mineUi.refused(doc.name, 'large');
    return false;
  }
  const o = owner;
  const assets: unknown[] = [];
  for (const a of doc.assets) {
    const b = cleanBytes(a.sha256, bytes.get(a.sha256));
    if (b) assets.push({ owner: o, sha: a.sha256, ...b });
    else if (!(await idbAsset(o, a.sha256))) return false; // never keep a theme whose bytes are not here
  }
  if (assets.length && !(await idbPut('assets', assets))) return false;
  const rec: MineRec = { owner: o, key: doc.id, name: doc.name, doc, revision: prev && !prev.deleted ? prev.revision : prev?.revision ?? null, dirty: true, deleted: false, at: prev?.at || Date.now() };
  if (!(await idbPut('themes', [rec]))) return false;
  if (owner !== o) return true;
  setRec(rec);
  emit();
  if (signedIn(o)) void mineSync();
  return true;
}

/** Remove a theme from the list. Never touches a book. Signed in, the account's delete names the revision it saw: a
 *  theme changed on another device meanwhile comes back (its change wins over this delete; nothing is lost). */
export async function mineDelete(key: string): Promise<boolean> {
  if (stale()) return false;
  const r = recs.find((x) => x.key === key && !x.deleted);
  if (!r) return false;
  if (r.revision === null) {
    await idbDelete(r.owner, key);
    recs = recs.filter((x) => x !== r);
  } else {
    const gone: MineRec = { ...r, deleted: true, dirty: true };
    await putRec(gone);
    setRec(gone);
  }
  emit();
  if (signedIn(r.owner)) void mineSync();
  return true;
}

/** The bytes of an asset: from the device, else (signed in) from the account's picture store — checked against its
 *  name either way, and kept on the device once fetched. Null when neither has them. */
export async function mineBytes(sha: string): Promise<Bytes | null> {
  const o = owner;
  const local = await idbAsset(o, sha);
  const lb = isRec(local) ? cleanBytes(sha, local) : null;
  if (lb) return lb;
  if (stale() || !signedIn(o) || !SHA.test(sha)) return null;
  const r = await apiFetch('/api/pictures/' + sha);
  const pic = r && !r.__error && isRec(r.picture) ? r.picture : null;
  const b = pic ? cleanBytes(sha, pic) : null;
  if (b) await idbPut('assets', [{ owner: o, sha, ...b }]);
  return b;
}

/* ---- the account (signed in) ---- */
let running: Promise<void> | null = null;
let again = false;
/** Send what waits and read what changed on the account. One at a time; a call while one runs runs once more after. */
export function mineSync(): Promise<void> {
  if (stale()) return mineLoad(); // another account (or none) now: its own list, read and synced
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

const body = (r: Record<string, unknown> | null) => (r && isRec(r.__body) ? r.__body : null);
const status = (r: Record<string, unknown> | null) => (r && typeof r.__status === 'number' ? r.__status : r ? 200 : 0);
/** Answers that say "not now", never "not this" (review round 2, Important 2): an expired session (401), a refusal
 *  that a sign-in can change (403), a timeout (408), too many requests (429) and the server's own trouble (5xx). The
 *  write waits and is sent again (the retries, the next load after a sign-in); only 400, 413 and 422 refuse it. */
const retryable = (st: number) => st === 401 || st === 403 || st === 408 || st === 429 || st >= 500;

async function syncOnce(): Promise<void> {
  const o = owner;
  if (!signedIn(o)) return;
  for (const r of recs.filter((x) => x.dirty && !x.refused)) {
    if (owner !== o) return;
    if (r.deleted) await sendDelete(r);
    else await sendPut(r);
  }
  if (owner !== o) return;
  await pull(o);
}

/** The account's copy, as the store keeps it (clean). */
function fromAccount(o: string, t: unknown, at?: number): MineRec | null {
  if (!isRec(t) || typeof t.key !== 'string' || typeof t.revision !== 'number') return null;
  const doc = cleanMineDoc(t.doc, t.key);
  if (!doc) return null;
  return { owner: o, key: t.key, name: doc.name, doc, revision: t.revision, dirty: false, deleted: false, at: at ?? Date.now() };
}

async function uploadAssets(r: MineRec): Promise<'ok' | 'offline' | 'refused'> {
  const hashes = [...new Set(r.doc.assets.map((a) => a.sha256))];
  if (!hashes.length) return 'ok';
  const ask = await apiFetch('/api/pictures/missing', { method: 'POST', body: JSON.stringify({ hashes }) });
  if (!ask) return 'offline';
  if (ask.__error) return retryable(status(ask)) ? 'offline' : 'refused';
  const missing = Array.isArray(ask.missing) ? (ask.missing as unknown[]).filter((h): h is string => typeof h === 'string' && hashes.includes(h)) : [];
  for (const h of missing) {
    const b = await mineBytes(h);
    if (!b) return 'refused';
    const up = await apiFetch('/api/pictures/' + h, { method: 'PUT', body: JSON.stringify(b) });
    if (!up) return 'offline';
    if (up.__error) return retryable(status(up)) ? 'offline' : 'refused';
  }
  return 'ok';
}

async function refuse(r: MineRec, why: 'full' | 'large' | 'other'): Promise<void> {
  const kept: MineRec = { ...r, refused: why };
  await putRec(kept);
  setRec(kept);
  emit();
  mineUi.refused(r.name, why);
}

async function sendPut(r: MineRec): Promise<void> {
  const up = await uploadAssets(r);
  if (up === 'offline') return;
  if (up === 'refused') return refuse(r, 'other');
  const headers: Record<string, string> = r.revision ? { 'If-Match': '"' + r.revision + '"' } : {};
  const res = await apiFetch('/api/themes/' + encodeURIComponent(r.key), { method: 'PUT', headers, body: JSON.stringify({ name: r.name, doc: r.doc }) });
  if (!res) return; // offline: waits, sent again later
  const st = status(res);
  const cur = recs.find((x) => x.key === r.key);
  if (cur !== r) {
    // changed here meanwhile: the next round sends the newer copy — based on what this save made the account hold, so
    // the writer's own earlier save is never taken for another device's change (review, Important 2)
    const saved = !res.__error ? fromAccount(r.owner, res.theme, r.at) : null;
    if (saved && cur && cur.revision === r.revision) {
      const next: MineRec = { ...cur, revision: saved.revision };
      await putRec(next);
      setRec(next);
    }
    again = true;
    return;
  }
  if (!res.__error) {
    const saved = fromAccount(r.owner, res.theme, r.at);
    if (!saved) return;
    await putRec(saved);
    setRec(saved);
    emit();
    return;
  }
  if (st === 409 || st === 428) return keepBoth(r, body(res)?.theme);
  if (st === 404 && r.revision) {
    // deleted on another device while edited here: the edit stands, created again
    const fresh: MineRec = { ...r, revision: null };
    await putRec(fresh);
    setRec(fresh);
    again = true;
    return;
  }
  if (st === 413) return refuse(r, body(res)?.limitThemes ? 'full' : 'large');
  if (retryable(st)) return; // not now (a session, a limit, the server's trouble): tried again later
  return refuse(r, 'other');
}

/** JSON with every object's keys sorted, at every depth: the account stores docs as Postgres jsonb, which does not keep
 *  key order, so "the same doc" is compared this way (review round 2, Important 1). Arrays keep their order. */
export function canonJson(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const out: Rec = {};
      for (const k of Object.keys(x as Rec).sort()) out[k] = walk((x as Rec)[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(walk(v));
}

/** A stale write: the account's copy keeps the key; this device's edit is kept as a theme of its own, sent next. */
async function keepBoth(r: MineRec, server: unknown): Promise<void> {
  const theirs = fromAccount(r.owner, server, r.at);
  if (theirs && canonJson(theirs.doc) === canonJson(r.doc) && theirs.name === r.name) {
    // the account already holds exactly this (a save whose answer was lost): take its revision, nothing to split
    await putRec(theirs);
    setRec(theirs);
    emit();
    return;
  }
  let key = uid();
  while (recs.some((x) => x.key === key)) key = uid();
  const suffix = mineUi.deviceSuffix();
  const name = (r.name.slice(0, MINE_NAME_MAX - suffix.length) + suffix).slice(0, MINE_NAME_MAX);
  const mine: MineRec = { ...r, key, name, doc: { ...r.doc, id: key, name }, revision: null, dirty: true, deleted: false, refused: undefined, at: r.at + 0.5 };
  await putRec(mine);
  if (theirs) await putRec(theirs);
  else await idbDelete(r.owner, r.key);
  recs = recs.filter((x) => x.key !== r.key);
  if (theirs) recs.push(theirs);
  recs.push(mine);
  emit();
  mineUi.conflict(r.name);
  again = true;
}

async function sendDelete(r: MineRec): Promise<void> {
  const res = await apiFetch('/api/themes/' + encodeURIComponent(r.key), { method: 'DELETE', headers: r.revision ? { 'If-Match': '"' + r.revision + '"' } : {} });
  if (!res) return;
  const st = status(res);
  if (!res.__error || st === 404) {
    await idbDelete(r.owner, r.key);
    recs = recs.filter((x) => !(x.key === r.key && x.deleted));
    emit();
    return;
  }
  if (st === 409) {
    // changed on another device since: that change wins over this delete (nothing is lost)
    const theirs = fromAccount(r.owner, body(res)?.theme, r.at);
    if (theirs) {
      await putRec(theirs);
      setRec(theirs);
      emit();
      mineUi.conflict(r.name);
    } else {
      // no usable copy came back: the delete is let go (never retried with a stale revision) and the list read again
      await idbDelete(r.owner, r.key);
      recs = recs.filter((x) => x.key !== r.key);
      emit();
    }
  }
}

/** Read the account's list; fetch each theme whose revision this device does not hold; forget the ones deleted
 *  elsewhere (never one with a change still waiting here). */
async function pull(o: string): Promise<void> {
  const list = await apiFetch('/api/themes');
  if (!list || list.__error || !Array.isArray(list.themes) || owner !== o) return;
  const seen = new Set<string>();
  let changed = false;
  for (const row of list.themes as unknown[]) {
    if (!isRec(row) || typeof row.key !== 'string' || !MINE_KEY.test(row.key) || typeof row.revision !== 'number') continue;
    seen.add(row.key);
    const cur = recs.find((x) => x.key === row.key);
    if (cur && (cur.dirty || cur.revision === row.revision)) continue;
    const got = await apiFetch('/api/themes/' + encodeURIComponent(row.key));
    if (!got || got.__error || owner !== o) continue;
    const now = recs.find((x) => x.key === row.key);
    if (now && now.dirty) continue; // changed here while asking
    const rec = fromAccount(o, got.theme, now?.at);
    if (!rec) continue; // a copy that is not a theme is never kept
    await putRec(rec);
    setRec(rec);
    changed = true;
  }
  for (const r of recs.filter((x) => x.revision !== null && !x.dirty && !seen.has(x.key))) {
    await idbDelete(o, r.key);
    recs = recs.filter((x) => x !== r);
    changed = true;
  }
  if (changed) emit();
}

/* ---- signing in with device-only themes ---- */
/** The themes kept on this device while signed out (for the one-time offer to move them to the account). */
export async function mineDeviceThemes(): Promise<MineRec[]> {
  return (await idbOwnerThemes(DEVICE)).map((r) => cleanRec(DEVICE, r)).filter((r): r is MineRec => !!r && !r.deleted);
}
/** Move this device's signed-out themes to the signed-in account: each kept for the account (a key it already holds
 *  gets a new one), with its bytes, then gone from the device-only list. Returns how many moved. */
export async function mineMoveToAccount(): Promise<number> {
  const o = owner;
  if (o === DEVICE) return 0;
  let n = 0;
  for (const r of await mineDeviceThemes()) {
    const bytes = new Map<string, Bytes>();
    for (const a of r.doc.assets) {
      const b = cleanBytes(a.sha256, await idbAsset(DEVICE, a.sha256));
      if (b) bytes.set(a.sha256, b);
    }
    let key = r.key;
    while (recs.some((x) => x.key === key)) key = uid();
    const ok = await mineSave({ ...r.doc, id: key }, bytes);
    if (!ok || owner !== o) break;
    await idbDelete(DEVICE, r.key);
    n++;
  }
  return n;
}

/* ---- the retries (covenant/net.ts's for the series) ---- */
const RETRY_MS = 30_000;
const waiting = () => recs.some((r) => r.dirty && !r.refused);
/** One retry: what waits is sent (nothing when nothing waits or signed out). */
export function mineRetryTick(): void {
  if (stale()) void mineLoad();
  else if (waiting() && signedIn(owner)) void mineSync();
}
/** While the studio runs: the retries, the send on page hide. Returns the cleanup. */
export function installMineRetry(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onVis = () => {
    if (document.visibilityState === 'hidden') mineRetryTick();
  };
  window.addEventListener('online', mineRetryTick);
  window.addEventListener('pagehide', mineRetryTick);
  document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(mineRetryTick, RETRY_MS);
  return () => {
    window.removeEventListener('online', mineRetryTick);
    window.removeEventListener('pagehide', mineRetryTick);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(timer);
  };
}

/** Tests: forget the memory and the database handle (the database itself is the test's to delete). */
export function mineReset(): void {
  owner = DEVICE;
  recs = [];
  loadedFor = null;
  running = null;
  again = false;
  if (dbp) void dbp.then((db) => db?.close());
  dbp = null;
  emit();
}
