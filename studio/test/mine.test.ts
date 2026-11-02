import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shaOfData } from '@book/editor/index.js';
import { cloudFacts } from '../src/closure/index';
import { setCovenantFetch } from '../src/covenant/net';
import {
  cleanMineDoc,
  mineBytes,
  mineDelete,
  mineDeviceThemes,
  mineList,
  mineLoad,
  mineMoveToAccount,
  mineReset,
  mineSave,
  mineSync,
  mineUi,
  type Bytes,
  type MineDoc,
} from '../src/style/mine';
import { ttfData, SVG_TEXT } from './style-fixture';

/* Per-user themes, task 2 (constraints 47-49): the store behind My themes — the device copy, the account sync, the
   offline writes, a 409 that keeps both, each owner's own list, and nothing untrusted kept. */

type Rec = Record<string, unknown>;
const FONT = ttfData(1600, 5);
const SVG = btoa(SVG_TEXT);
const fontSha = shaOfData(FONT);
const svgSha = shaOfData(SVG);

const doc = (id: string, name: string, withAssets = true): MineDoc => ({
  id,
  name,
  theme: { bodyFont: 'Harbour Serif', headFont: 'Libre Baskerville', fontSize: 18, ornament: 'fl:flA' },
  assets: withAssets
    ? [
        { kind: 'font', sha256: fontSha, mediaType: 'font/ttf', id: 'fA', name: 'Harbour Serif.ttf', family: 'Harbour Serif', ext: 'ttf' },
        { kind: 'flourish', sha256: svgSha, mediaType: 'image/svg+xml', id: 'flA', name: 'star.svg', ext: 'svg', flourish: true },
      ]
    : [],
});
const bytes = (): Map<string, Bytes> =>
  new Map([
    [fontSha, { mediaType: 'font/ttf', data: FONT }],
    [svgSha, { mediaType: 'image/svg+xml', data: SVG }],
  ]);

/** A small account server (src/routes/user-themes.ts and pictures.ts's answers), per user. */
class FakeAccount {
  themes = new Map<string, Map<string, { name: string; doc: unknown; revision: number }>>();
  pictures = new Map<string, Map<string, Bytes>>();
  log: string[] = [];
  offline = false;
  user = 'ua';
  of<T>(m: Map<string, Map<string, T>>): Map<string, T> {
    let x = m.get(this.user);
    if (!x) m.set(this.user, (x = new Map()));
    return x;
  }
  fetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    this.log.push(method + ' ' + path);
    if (this.offline) throw new TypeError('Failed to fetch');
    const json = (status: number, b: unknown) => new Response(status === 204 ? null : JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const themes = this.of(this.themes);
    const pics = this.of(this.pictures);
    const reqBody = typeof init.body === 'string' ? (JSON.parse(init.body) as Rec) : {};
    const ifMatch = (init.headers as Record<string, string> | undefined)?.['If-Match'];
    const base = ifMatch ? Number(/\d+/.exec(ifMatch)![0]) : null;
    if (path === '/api/pictures/missing') return json(200, { missing: (reqBody.hashes as string[]).filter((h) => !pics.has(h)) });
    let m = /^\/api\/pictures\/([0-9a-f]{64})$/.exec(path);
    if (m) {
      if (method === 'PUT') {
        pics.set(m[1]!, { mediaType: String(reqBody.mediaType), data: String(reqBody.data) });
        return json(201, {});
      }
      const p = pics.get(m[1]!);
      return p ? json(200, { picture: { sha256: m[1], ...p } }) : json(404, { error: 'picture not found' });
    }
    if (path === '/api/themes') return json(200, { themes: [...themes].map(([key, t]) => ({ key, name: t.name, revision: t.revision, updated_at: 'x' })) });
    m = /^\/api\/themes\/([\w-]+)$/.exec(path);
    if (m) {
      const key = m[1]!;
      const row = themes.get(key);
      const full = (r: { name: string; doc: unknown; revision: number }) => ({ key, name: r.name, revision: r.revision, updated_at: 'x', doc: r.doc });
      if (method === 'GET') return row ? json(200, { theme: full(row) }) : json(404, { error: 'theme not found' });
      if (method === 'DELETE') {
        if (!row) return json(404, { error: 'theme not found' });
        if (base !== null && base !== row.revision) return json(409, { error: 'revision conflict', theme: full(row) });
        themes.delete(key);
        return json(204, null);
      }
      for (const a of ((reqBody.doc as Rec).assets as Rec[]) ?? []) if (!pics.has(String(a.sha256))) return json(422, { missingPictures: [a.sha256] });
      if (base === null) {
        if (row) return json(428, { theme: full(row) });
        const r = { name: String(reqBody.name), doc: reqBody.doc, revision: 1 };
        themes.set(key, r);
        return json(201, { theme: full(r) });
      }
      if (!row) return json(404, { error: 'theme not found' });
      if (row.revision !== base) return json(409, { error: 'revision conflict', code: 'BEUK-C803', theme: full(row) });
      const r = { name: String(reqBody.name), doc: reqBody.doc, revision: row.revision + 1 };
      themes.set(key, r);
      return json(200, { theme: full(r) });
    }
    return json(404, { error: 'no route' });
  };
}

let acct: FakeAccount;
const signIn = (id: string) => {
  cloudFacts.available = true;
  cloudFacts.user = { id, email: id + '@example.org' };
  acct.user = id;
};
const signOut = () => {
  cloudFacts.available = true;
  cloudFacts.user = null;
};
const conflicts: string[] = [];
const refusals: string[] = [];

beforeEach(async () => {
  mineReset();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('beuk-mythemes');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  acct = new FakeAccount();
  setCovenantFetch(acct.fetch as typeof fetch);
  conflicts.length = 0;
  refusals.length = 0;
  mineUi.conflict = (n) => conflicts.push(n);
  mineUi.refused = (n, why) => refusals.push(n + ':' + why);
});
afterEach(() => {
  setCovenantFetch(null);
  cloudFacts.available = false;
  cloudFacts.user = null;
  mineReset();
});

describe('signed out: this device only', () => {
  it('a kept theme is listed, survives a reload, and nothing is sent', async () => {
    signOut();
    await mineLoad();
    expect(await mineSave(doc('t1', 'Harbour'), bytes())).toBe(true);
    expect(mineList().map((r) => [r.key, r.name, r.revision])).toEqual([['t1', 'Harbour', null]]);
    mineReset();
    await mineLoad();
    expect(mineList().map((r) => r.key)).toEqual(['t1']);
    expect((await mineBytes(fontSha))?.data).toBe(FONT);
    expect(acct.log).toEqual([]);
    expect(await mineDelete('t1')).toBe(true);
    mineReset();
    await mineLoad();
    expect(mineList()).toEqual([]);
  });
});

describe('signed in: the account, with a device copy', () => {
  it('the bytes are uploaded first, then the theme; its revision is kept; a reload lists it from the device at once', async () => {
    signIn('ua');
    await mineLoad();
    await mineSave(doc('t1', 'Harbour'), bytes());
    await mineSync();
    const puts = acct.log.filter((l) => l.startsWith('PUT'));
    expect(puts).toEqual([`PUT /api/pictures/${fontSha}`, `PUT /api/pictures/${svgSha}`, 'PUT /api/themes/t1']);
    expect(mineList().map((r) => [r.key, r.revision, r.dirty])).toEqual([['t1', 1, false]]);
    acct.offline = true; // the device copy, at once
    mineReset();
    await mineLoad();
    expect(mineList().map((r) => [r.key, r.revision])).toEqual([['t1', 1]]);
  });

  it('a theme made on another device arrives; one deleted there goes; one with a change waiting here stays', async () => {
    signIn('ua');
    acct.of(acct.pictures).set(fontSha, { mediaType: 'font/ttf', data: FONT });
    acct.of(acct.pictures).set(svgSha, { mediaType: 'image/svg+xml', data: SVG });
    acct.of(acct.themes).set('t9', { name: 'Elsewhere', doc: doc('t9', 'Elsewhere'), revision: 3 });
    await mineLoad();
    expect(mineList().map((r) => [r.key, r.revision])).toEqual([['t9', 3]]);
    expect((await mineBytes(svgSha))?.data).toBe(SVG); // fetched from the account's picture store, checked, kept
    acct.of(acct.themes).delete('t9');
    await mineSync();
    expect(mineList()).toEqual([]);
  });

  it('offline: the write survives a reload and is sent when the account answers again (no silent loss)', async () => {
    signIn('ua');
    await mineLoad();
    acct.offline = true;
    await mineSave(doc('t2', 'Offline One'), bytes());
    await mineSync();
    expect(mineList().map((r) => [r.key, r.dirty, r.revision])).toEqual([['t2', true, null]]);
    mineReset();
    await mineLoad(); // a reload while still offline
    expect(mineList().map((r) => [r.key, r.dirty])).toEqual([['t2', true]]);
    acct.offline = false;
    await mineSync();
    expect(mineList().map((r) => [r.key, r.dirty, r.revision])).toEqual([['t2', false, 1]]);
    expect(acct.of(acct.themes).get('t2')?.name).toBe('Offline One');
  });

  it('a 409 keeps both: the account copy keeps the key, this device\'s edit is kept as "<name> (this device)" and sent', async () => {
    signIn('ua');
    await mineLoad();
    await mineSave(doc('t3', 'Harbour'), bytes());
    await mineSync();
    // another device changes it
    acct.of(acct.themes).set('t3', { name: 'Harbour, theirs', doc: doc('t3', 'Harbour, theirs'), revision: 2 });
    await mineSave({ ...doc('t3', 'Harbour, mine'), theme: { bodyFont: 'EB Garamond', fontSize: 21 } }, bytes());
    await mineSync();
    const list = mineList();
    expect(list.map((r) => [r.name, r.dirty])).toEqual([
      ['Harbour, theirs', false],
      ['Harbour, mine (this device)', false],
    ]);
    expect(list[0]!.key).toBe('t3');
    expect(list[1]!.key).not.toBe('t3');
    expect(list[1]!.doc.theme.fontSize).toBe(21);
    expect(acct.of(acct.themes).get(list[1]!.key)?.name).toBe('Harbour, mine (this device)');
    expect(conflicts).toEqual(['Harbour, mine']);
  });

  it('a delete of a theme changed elsewhere since: the change comes back (409), nothing is lost', async () => {
    signIn('ua');
    await mineLoad();
    await mineSave(doc('t4', 'Keep Me'), bytes());
    await mineSync();
    acct.of(acct.themes).set('t4', { name: 'Keep Me, edited', doc: doc('t4', 'Keep Me, edited'), revision: 2 });
    await mineDelete('t4');
    expect(mineList()).toEqual([]);
    await mineSync();
    expect(mineList().map((r) => [r.key, r.name, r.revision])).toEqual([['t4', 'Keep Me, edited', 2]]);
  });

  it('edited here while deleted on another device: the edit is created again', async () => {
    signIn('ua');
    await mineLoad();
    await mineSave(doc('t5', 'Five'), bytes());
    await mineSync();
    acct.of(acct.themes).delete('t5');
    await mineSave(doc('t5', 'Five, edited'), bytes());
    await mineSync();
    expect(acct.of(acct.themes).get('t5')?.name).toBe('Five, edited');
    expect(mineList().map((r) => [r.key, r.dirty])).toEqual([['t5', false]]);
  });

  it('a cap the account answers (413) keeps the theme on the device, marked, and says so', async () => {
    signIn('ua');
    await mineLoad();
    const orig = acct.fetch;
    acct.fetch = async (p, init) => (p === '/api/themes/t6' && init?.method === 'PUT' ? new Response(JSON.stringify({ error: 'full', limitThemes: 200 }), { status: 413 }) : orig(p, init));
    setCovenantFetch(acct.fetch as typeof fetch);
    await mineSave(doc('t6', 'Six'), bytes());
    await mineSync();
    expect(mineList().map((r) => [r.key, r.refused])).toEqual([['t6', 'full']]);
    expect(refusals).toEqual(['Six:full']);
  });
});

describe('each owner its own list on a shared browser', () => {
  it("user B never lists, applies or sends user A's themes; signed out lists neither; A's come back for A", async () => {
    signIn('ua');
    await mineLoad();
    await mineSave(doc('ta', 'Alice Theme'), bytes());
    await mineSync();
    signIn('ub');
    await mineLoad();
    expect(mineList()).toEqual([]);
    expect(await mineBytes(fontSha)).toBeNull(); // not B's on the device, not B's on the account
    signOut();
    await mineLoad();
    expect(mineList()).toEqual([]);
    signIn('ua');
    acct.offline = true;
    await mineLoad();
    expect(mineList().map((r) => r.name)).toEqual(['Alice Theme']);
  });

  it('signing in with device-only themes: moved to the account only when asked, then gone from the device list', async () => {
    signOut();
    await mineLoad();
    await mineSave(doc('td', 'Device Theme'), bytes());
    signIn('ua');
    await mineLoad();
    expect(mineList()).toEqual([]);
    expect((await mineDeviceThemes()).map((r) => r.name)).toEqual(['Device Theme']);
    expect(await mineMoveToAccount()).toBe(1);
    await mineSync();
    expect(mineList().map((r) => [r.name, r.revision])).toEqual([['Device Theme', 1]]);
    expect(await mineDeviceThemes()).toEqual([]);
  });
});

describe('untrusted both ways: nothing kept that is not a theme', () => {
  it('cleanMineDoc refuses crafted docs and assets', () => {
    expect(cleanMineDoc(doc('ok', 'Fine'))).not.toBeNull();
    const bad = (patch: (d: Rec) => void) => {
      const d = JSON.parse(JSON.stringify(doc('k1', 'Bad'))) as Rec;
      patch(d);
      return cleanMineDoc(d);
    };
    expect(bad((d) => (d.id = '"><img src=x onerror=alert(1)>'))).toBeNull();
    expect(bad((d) => (d.theme = 'serif'))).toBeNull();
    expect(bad((d) => (d.name = ''))).toBeNull();
    expect(bad((d) => ((d.assets as Rec[])[0]!.family = "x'); } * { background: url(https://evil.example/"))).toBeNull();
    expect(bad((d) => ((d.assets as Rec[])[0]!.mediaType = 'text/html'))).toBeNull();
    expect(bad((d) => ((d.assets as Rec[])[1]!.id = 'a" onload="x'))).toBeNull();
    expect(bad((d) => ((d.assets as Rec[])[1]!.name = '<svg onload=alert(1)>'))).toBeNull();
    expect(bad((d) => ((d.assets as Rec[])[0]!.sha256 = 'nothex'))).toBeNull();
    expect(bad((d) => ((d.assets as Rec[])[0]!.kind = 'cover'))).toBeNull();
    // the name is text (React and 1.0's esc() write it as text); a long one is cut to the cap
    expect(cleanMineDoc({ ...doc('k2', 'n'.repeat(500)) })!.name.length).toBe(120);
  });

  it('a hostile account answer is never kept; bytes that are not what their name says are never kept', async () => {
    signIn('ua');
    acct.of(acct.themes).set('evil', { name: 'Evil', doc: { id: 'evil', name: 'Evil', theme: {}, assets: [{ kind: 'font', sha256: fontSha, mediaType: 'font/ttf', family: '</style><script>', ext: 'ttf' }] }, revision: 1 });
    acct.of(acct.themes).set('wrongid', { name: 'Wrong', doc: doc('other', 'Wrong'), revision: 1 });
    acct.of(acct.pictures).set(svgSha, { mediaType: 'image/svg+xml', data: btoa('<svg><script>alert(1)</script></svg>') });
    await mineLoad();
    expect(mineList()).toEqual([]);
    expect(await mineBytes(svgSha)).toBeNull(); // the account's bytes under that name are not those bytes
  });

  it('a device record from another owner or of the wrong shape is never listed', async () => {
    signOut();
    await mineLoad();
    await mineSave(doc('t1', 'Mine'), bytes());
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open('beuk-mythemes', 1);
      r.onsuccess = () => res(r.result);
    });
    await new Promise<void>((res) => {
      const tx = db.transaction('themes', 'readwrite');
      tx.objectStore('themes').put({ owner: 'device', key: 'x1', name: 'X', doc: { id: 'x1', name: 'X', theme: { fontSize: 1 }, assets: [{ kind: 'font', sha256: 'zz' }] }, revision: null, dirty: false, deleted: false, at: 1 });
      tx.oncomplete = () => res();
    });
    db.close();
    mineReset();
    await mineLoad();
    expect(mineList().map((r) => r.key)).toEqual(['t1']);
  });
});
