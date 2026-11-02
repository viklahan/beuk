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
  mineRetryTick,
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

describe('review (Important 1): the account changes inside the page (1.0 signs in and out without a reload)', () => {
  it("A's waiting theme is never sent to B, B's never kept under A, and nobody signed out lists A's", async () => {
    signIn('ua');
    await mineLoad();
    acct.offline = true;
    await mineSave(doc('ta1', 'Alice Waiting'), bytes());
    await mineSync();
    acct.offline = false;
    // A signs out, in the page: the list is not A's any more
    cloudFacts.user = null;
    expect(mineList()).toEqual([]);
    // B signs in, in the page, and a retry tick comes
    signIn('ub');
    acct.of(acct.themes).set('tb1', { name: 'Bob Theme', doc: doc('tb1', 'Bob Theme', false), revision: 1 });
    mineRetryTick();
    await mineSync();
    expect(acct.of(acct.themes).has('ta1')).toBe(false);
    expect(acct.of(acct.pictures).size).toBe(0);
    expect(mineList().map((r) => r.name)).toEqual(['Bob Theme']);
    // back to A: A's own list, B's never in it, A's waiting theme sent to A
    signIn('ua');
    await mineSync();
    expect(mineList().map((r) => r.name)).toEqual(['Alice Waiting']);
    expect(acct.of(acct.themes).get('ta1')?.name).toBe('Alice Waiting');
  });
});

describe('review (Important 2): the writer\'s own earlier save is never a conflict', () => {
  it('a second keep while the first PUT is in flight: one theme, sent at the newer revision, no "(this device)"', async () => {
    signIn('ua');
    await mineLoad();
    const orig = acct.fetch;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    acct.fetch = async (p, init) => {
      if (!held && p === '/api/themes/t7' && init?.method === 'PUT') {
        held = true;
        await gate;
      }
      return orig(p, init);
    };
    setCovenantFetch(acct.fetch as typeof fetch);
    await mineSave(doc('t7', 'First'), bytes());
    const first = mineSync();
    await new Promise((r) => setTimeout(r, 50));
    await mineSave(doc('t7', 'Second'), bytes());
    release();
    await first;
    await mineSync();
    expect(mineList().map((r) => [r.key, r.name, r.dirty])).toEqual([['t7', 'Second', false]]);
    expect(acct.of(acct.themes).get('t7')?.name).toBe('Second');
    expect(acct.of(acct.themes).get('t7')?.revision).toBe(2);
    expect(conflicts).toEqual([]);
  });

  it('a create whose answer was lost (428 with the same doc): the account copy is taken, nothing split', async () => {
    signIn('ua');
    acct.of(acct.pictures).set(fontSha, { mediaType: 'font/ttf', data: FONT });
    acct.of(acct.pictures).set(svgSha, { mediaType: 'image/svg+xml', data: SVG });
    await mineLoad();
    await mineSave(doc('t8', 'Lost Answer'), bytes());
    acct.of(acct.themes).set('t8', { name: 'Lost Answer', doc: JSON.parse(JSON.stringify(mineList()[0]!.doc)), revision: 1 });
    await mineSync();
    expect(mineList().map((r) => [r.key, r.revision, r.dirty])).toEqual([['t8', 1, false]]);
    expect(conflicts).toEqual([]);
  });
});

describe('review round 2 (Important 1): jsonb does not keep key order', () => {
  it('a lost create answered 428 with the stored copy, its keys reordered at every depth: taken, nothing split', async () => {
    signIn('ua');
    acct.of(acct.pictures).set(fontSha, { mediaType: 'font/ttf', data: FONT });
    acct.of(acct.pictures).set(svgSha, { mediaType: 'image/svg+xml', data: SVG });
    await mineLoad();
    await mineSave(doc('t10', 'Reordered'), bytes());
    const reorder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reorder);
      if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Rec).reverse().map((k) => [k, reorder((v as Rec)[k])]));
      return v;
    };
    const stored = reorder(JSON.parse(JSON.stringify(mineList()[0]!.doc)));
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(mineList()[0]!.doc));
    acct.of(acct.themes).set('t10', { name: 'Reordered', doc: stored, revision: 1 });
    await mineSync();
    expect(mineList().map((r) => [r.key, r.revision, r.dirty])).toEqual([['t10', 1, false]]);
    expect(conflicts).toEqual([]);
  });
});

describe('review round 2 (Important 2): an expired session is not a refusal', () => {
  it('a 401 on /api/pictures/missing, then on the theme PUT: still waiting (also after a reload); signed in again, it is sent', async () => {
    signIn('ua');
    await mineLoad();
    const orig = acct.fetch;
    let expired = true;
    let missing401 = 0, put401 = 0;
    acct.fetch = async (p, init) => {
      if (expired && p === '/api/pictures/missing') {
        missing401++;
        if (missing401 === 1) return new Response(JSON.stringify({ error: 'sign in' }), { status: 401 });
      }
      if (expired && p === '/api/themes/t11' && init?.method === 'PUT') {
        put401++;
        return new Response(JSON.stringify({ error: 'sign in' }), { status: 401 });
      }
      return orig(p, init);
    };
    setCovenantFetch(acct.fetch as typeof fetch);
    await mineSave(doc('t11', 'Expired'), bytes());
    await mineSync(); // 401 on the pictures question
    expect(mineList().map((r) => [r.key, r.dirty, r.refused])).toEqual([['t11', true, undefined]]);
    await mineSync(); // the pictures go; 401 on the theme
    // (mineSave's own sync joins these calls, so a round may run twice: at least once each)
    expect(missing401).toBeGreaterThanOrEqual(2);
    expect(put401).toBeGreaterThanOrEqual(1);
    expect(mineList().map((r) => [r.key, r.dirty, r.refused])).toEqual([['t11', true, undefined]]);
    mineReset(); // a reload, the session still expired
    await mineLoad();
    expect(mineList().map((r) => [r.key, r.dirty, r.refused])).toEqual([['t11', true, undefined]]);
    expect(refusals).toEqual([]);
    // signed in again: the next load sends it
    expired = false;
    mineReset();
    await mineLoad();
    expect(acct.of(acct.themes).get('t11')?.name).toBe('Expired');
    expect(mineList().map((r) => [r.key, r.dirty, r.revision])).toEqual([['t11', false, 1]]);
  });

  it('a 400 or 422 is still a refusal (kept on the device, marked, said)', async () => {
    signIn('ua');
    await mineLoad();
    const orig = acct.fetch;
    acct.fetch = async (p, init) => (p === '/api/themes/t12' && init?.method === 'PUT' ? new Response(JSON.stringify({ error: 'bad' }), { status: 400 }) : orig(p, init));
    setCovenantFetch(acct.fetch as typeof fetch);
    await mineSave(doc('t12', 'Bad'), bytes());
    await mineSync();
    expect(mineList().map((r) => [r.key, r.refused])).toEqual([['t12', 'other']]);
  });
});

describe('review round 2 (Minor a): an asset name with a quote or a bracket is cleaned, not refused', () => {
  it('"Writer\'s Hand.ttf" is kept, named as text without those characters', async () => {
    signOut();
    await mineLoad();
    const d = doc('t13', 'Quotes');
    d.assets[0]!.name = 'Writer\'s <Hand> "x" `y` \\z.ttf';
    expect(await mineSave(d, bytes())).toBe(true);
    expect(mineList()[0]!.doc.assets[0]!.name).toBe('Writer’s Hand x y z.ttf');
  });
});

describe('review (Minor): a stale delete whose answer carries no theme does not retry forever', () => {
  it('the tombstone goes and the list is read again', async () => {
    signIn('ua');
    await mineLoad();
    await mineSave(doc('t9', 'Nine'), bytes());
    await mineSync();
    const orig = acct.fetch;
    acct.fetch = async (p, init) => (p === '/api/themes/t9' && init?.method === 'DELETE' ? new Response(JSON.stringify({ error: 'revision conflict' }), { status: 409 }) : orig(p, init));
    setCovenantFetch(acct.fetch as typeof fetch);
    await mineDelete('t9');
    await mineSync();
    acct.log.length = 0;
    await mineSync();
    expect(acct.log.filter((l) => l.startsWith('DELETE'))).toEqual([]);
    expect(mineList().map((r) => r.key)).toEqual(['t9']); // the account still holds it: listed again
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
    // review round 2 (Minor a): a file name is display text — its brackets and quotes are cleaned, not a refusal
    expect(bad((d) => ((d.assets as Rec[])[1]!.name = '<svg onload="alert(1)">'))!.assets[1]!.name).toBe('svg onload=alert(1)');
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
