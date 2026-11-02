import { exportBook } from '@book/editor/index.js';
import { closureIfLoaded, closureT, coverEnv, structEnv, type Closure, type StockPhoto } from '../closure/index';
import { desk } from '../environment/page';
import { allowedStockUrl } from '../pictures/stock';
import { styleCoverCleared, styleRun } from '../style/session';

/* Step 5 wave 4c (inventory D3, D4): the cover maker, the spine and back, the hardcover's flaps and guides, the wrap
   and its 3D stand, and Project Settings' cover row — the data side.

   Everything is 1.0's own code (client/index.html "Cover maker", BEUK:spineback, BEUK:hardcover, the print wrap,
   "The book on the stand", BEUK:wrap-server), lifted into the browser closure (scripts/extract-closure.mjs): the
   painters are the very text the server's WRAP_CLOSURE lifts (test/cover-closure.test.ts). 1.0's maker keeps a
   working recipe of its own (cmRecipe) and writes the book only when the writer says so: "Use as My Cover"
   (adoptCoverRecipe: state.cover and state.coverRecipe), a picture it adds (its art, a stock photo, the back flap's
   photo, a spine icon: state.images). Its handlers run inside the Style session (src/style/session.ts), which writes
   back exactly what serializeBook writes for each key that changed — `cover` among them since this wave, with History
   packed again (its snapshots name the live cover). */

type Toast = (msg: string, icon?: string) => void;
type Rec = Record<string, unknown>;

/** 1.0's #coverInput handler (initSettings): a JPEG or PNG becomes the book's cover and supersedes the recipe. */
export async function coverUpload(file: File, toast: Toast): Promise<void> {
  const t = closureT();
  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    toast(t('toast.coverType'), 'alert-triangle');
    return;
  }
  let url: string;
  try {
    url = await readAsDataUrl(file);
  } catch {
    toast(t('toast.coverReadFail'), 'alert-triangle');
    return;
  }
  const comma = url.indexOf(',');
  if (comma < 0) {
    toast(t('toast.coverReadFail'), 'alert-triangle');
    return;
  }
  const done = styleRun((c) => {
    const s = c.getState() as Rec;
    s.cover = { data: url.slice(comma + 1), mediaType: file.type, ext: file.type === 'image/png' ? 'png' : 'jpg', name: file.name };
    s.coverRecipe = null; // A plain uploaded cover supersedes any made-cover recipe until the maker is used again.
    return true;
  });
  if (done) toast(t('toast.coverAdded'), 'image');
}

/** 1.0's #btnCoverRemove handler: clearCover (the image and the recipe together). */
export function coverClear(toast: Toast): void {
  const done = styleRun((c) => {
    c.api.clearCover();
    styleCoverCleared();
    return true;
  });
  if (done) toast(closureT()('toast.coverRemoved'), 'trash-2');
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/* ---- the cover code's surroundings (installed once per closure: coverReady) ---- */

/** A promise 1.0's code waits on (a picture decoded, a flap photo, the spine's icons) whose continuation must run on
 *  the open book's state and have what it changes written (adoptCoverRecipe after "Use as My Cover"): its `then`
 *  callbacks run inside the Style session. */
function inSession<T>(p: Promise<T>): Promise<T> {
  const wrapped = {
    then<A, B>(ok?: ((v: T) => A) | null, bad?: ((e: unknown) => B) | null) {
      return p.then(ok ? (v: T) => styleRun(() => ok(v)) as A : undefined, bad ? (e: unknown) => styleRun(() => bad(e)) as B : undefined);
    },
    catch<B>(bad: (e: unknown) => B) {
      return p.catch((e: unknown) => styleRun(() => bad(e)) as B);
    },
    finally(f: () => void) {
      return p.finally(f);
    },
  };
  return wrapped as unknown as Promise<T>;
}

/** A stock result as the served policy lets this page load it: each address the policy refuses is left out, and a
 *  result with none is not shown (2.0's scene picker does the same, src/pictures/stock.ts). */
export function policyPhotos(res: unknown): unknown {
  if (!res || typeof res !== 'object' || !Array.isArray((res as { photos?: unknown }).photos)) return res;
  const photos = ((res as { photos: unknown[] }).photos)
    .filter((ph): ph is StockPhoto => !!ph && typeof ph === 'object')
    .map((ph) => {
      const src: Record<string, string> = {};
      for (const k of ['medium', 'large', 'original'] as const) {
        const u = ph.src?.[k];
        if (allowedStockUrl(u)) src[k] = u;
      }
      return { ...ph, src };
    })
    .filter((ph) => Object.keys(ph.src).length > 0);
  return { ...(res as Record<string, unknown>), photos };
}

/** The first bytes of a JPEG or a PNG, 1.0's upload types; anything else is refused. */
async function pictureBlob(b: Blob): Promise<Blob> {
  const head = new Uint8Array(await b.slice(0, 8).arrayBuffer());
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a;
  if (!jpeg && !png) throw new Error('not a JPEG or a PNG');
  return new Blob([b], { type: jpeg ? 'image/jpeg' : 'image/png' });
}

/** The page's fetch as 1.0's cover code reaches it: a same-origin request unchanged; any other only when the served
 *  policy allows its address (else refused, as a network failure: 1.0's own catch says photoRetry / photoFail or tries
 *  the next size), its body's bytes checked to be a JPEG or a PNG when 1.0 reads it as a picture (blob()). */
export function coverFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(href, globalThis.location?.href);
  } catch {
    return Promise.reject(new TypeError('refused'));
  }
  if (url.origin === globalThis.location?.origin) return globalThis.fetch(input, init);
  if (!allowedStockUrl(url.href)) return Promise.reject(new TypeError('refused: the served policy does not allow ' + url.origin));
  return globalThis.fetch(url.href, { ...init, credentials: 'omit' }).then((r) => {
    const out = Object.create(r) as Response;
    Object.defineProperty(out, 'blob', { value: () => r.blob().then(pictureBlob) });
    Object.defineProperty(out, 'json', { value: () => r.json() });
    Object.defineProperty(out, 'ok', { value: r.ok });
    Object.defineProperty(out, 'status', { value: r.status });
    return out;
  });
}

/** 1.0's downloadBlob: hand the browser a file to save. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Where 1.0's cover code raises a toast outside a session (the wrap download's answer, after its request). */
export const coverUi: { toast: (msg: string, icon?: string) => void } = { toast: () => undefined };

/** The closure once loaded, with the cover code's surroundings installed (once per closure). */
export function coverReady(c: Closure | null = closureIfLoaded()): Closure | null {
  if (!c) return null;
  if (!installed.has(c)) {
    installed.add(c);
    const v = c.vars;
    for (const k of ['ensureCoverBgImage', 'hcEnsureFlapPhoto', 'ensureWrapIcons'] as const) {
      const orig = v[k];
      v[k] = (recipe: unknown) => inSession(orig(recipe));
    }
    const render = v.cmRenderStockResults;
    v.cmRenderStockResults = (res: unknown) => render(policyPhotos(res));
    coverEnv.fetch = coverFetch as typeof fetch;
    coverEnv.downloadBlob = downloadBlob;
    // 1.0's serializeBook: the open book as book format (exportBook writes what readBook reads: what 1.0 writes)
    coverEnv.serializeBook = () => (desk.ydoc ? (exportBook(desk.ydoc) as Record<string, unknown>) : {});
    // a toast raised outside any session (1.0's downloadWrap after its request) reaches the page
    const base = structEnv.toast;
    if (base === defaultToast.fn) structEnv.toast = (msg, icon) => coverUi.toast(msg, icon);
  }
  return c;
}
const installed = new WeakSet<Closure>();
const defaultToast: { fn: unknown } = { fn: structEnv.toast };
