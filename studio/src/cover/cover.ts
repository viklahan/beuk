import { closureIfLoaded, closureT, type Closure } from '../closure/index';
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

/** The closure once loaded, with the cover code's surroundings installed (once per closure). */
export function coverReady(c: Closure | null = closureIfLoaded()): Closure | null {
  if (!c) return null;
  if (!installed.has(c)) {
    installed.add(c);
  }
  return c;
}
const installed = new WeakSet<Closure>();
