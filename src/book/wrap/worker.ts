import { GlobalFonts, loadImage, type Canvas } from '@napi-rs/canvas';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { type FontPlan, installLucide, makeWrapSandbox } from './sandbox.js';

/* BEUK:wrap-server — one cover-wrap render, in its own worker thread and
   its own vm context. The parent terminates the worker at the time cap
   and caps its heap (src/book/studio/closure.ts runStudioWorker).

   Fonts: @napi-rs/canvas keeps ONE font collection for the whole process
   (GlobalFonts), shared by every worker. So a build registers only the
   faces its own recipe names (the families in the studio's font stacks
   for the recipe's fonts, from client/assets/fonts/MANIFEST.tsv, plus
   the book's uploaded faces of those names) and removes every one of
   them when it ends: one writer's uploaded face never reaches another
   writer's build, and the collection does not grow build by build. */

/** A face file, its family, and the family name it registers under (the family, or a subset alias). */
export type FontFile = { family: string; file: string; alias: string };

export type WrapWorkerJob = {
  code: string;
  lucide: string;
  /** Every cover/display/script face file, with its family (absolute paths). */
  fonts: FontFile[];
  stateJson: string;
  lang: string;
};

export type WrapWorkerOut =
  | { refused: 'no-cover' }
  | { refused: 'missing-pictures'; missing: string[] }
  | { jpeg: Uint8Array; items: Record<string, unknown>; dims: Record<string, unknown>; fonts: string[]; aliases: string[] };

type Recipe = Record<string, unknown>;
type Api = {
  render(recipe: Recipe): { canvas: Canvas; items: Record<string, unknown> };
  wrapDims(recipe: Recipe): Record<string, unknown>;
  pictures(recipe: Recipe): string[];
  fontStacks(recipe: Recipe): string[];
  uploadedFontByFamily(family: string): { family: string; data: string } | null;
  cache: Record<string, unknown>;
  setUiLang(lang: string): void;
  arrive(state: unknown): unknown;
};

/** The family names in CSS font stacks: quoted or bare, generic keywords and all. */
export function stackFamilies(stacks: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of stacks) for (const part of s.split(',')) {
    const name = part.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (name) out.add(name);
  }
  return out;
}

/** JPEG quality of the studio's wrap download (canvas.toBlob(…, "image/jpeg", 0.92)), on @napi-rs/canvas's 0–100 scale. */
const JPEG_QUALITY = 92;

async function run(job: WrapWorkerJob): Promise<WrapWorkerOut> {
  const plan: FontPlan = { aliases: {} };
  const ctx = makeWrapSandbox(plan);
  installLucide(ctx, job.lucide);
  new vm.Script(job.code, { filename: 'client/index.html (wrap closure)' }).runInContext(ctx);
  /* The book enters as JSON parsed inside the context, so its arrays and
     objects belong to the studio code's own realm. */
  ctx.__beukStateJson = job.stateJson;
  vm.runInContext('globalThis.state = JSON.parse(globalThis.__beukStateJson); delete globalThis.__beukStateJson;', ctx);
  const api = ctx.__beukWrap as Api;
  api.setUiLang(job.lang);
  api.arrive(ctx.state);
  const state = ctx.state as { coverRecipe: Recipe | null; images: { id: string; mediaType?: string; data?: string }[] };
  const recipe = state.coverRecipe;
  if (!recipe) return { refused: 'no-cover' };

  /* The pictures the wrap paints, decoded the way the studio's
     ensureCoverBgImage / hcEnsureFlapPhoto / ensureWrapIcons do, into
     the studio's own cache. One the book no longer has, or that does not
     decode, is refused by name: never a blank panel. */
  const missing: string[] = [];
  for (const id of api.pictures(recipe)) {
    const im = state.images.find((x) => x && x.id === id);
    try {
      if (!im || typeof im.data !== 'string' || !im.data) throw new Error('absent');
      api.cache[id] = await loadImage(Buffer.from(im.data, 'base64'));
    } catch {
      missing.push(id);
    }
  }
  if (missing.length) return { refused: 'missing-pictures', missing };

  const families = stackFamilies(api.fontStacks(recipe));
  const keys: NonNullable<ReturnType<typeof GlobalFonts.register>>[] = [];
  const registered: string[] = [];
  try {
    for (const f of job.fonts) {
      if (!families.has(f.family)) continue;
      const k = GlobalFonts.registerFromPath(f.file, f.alias);
      if (!k) continue;
      keys.push(k);
      if (f.alias === f.family) {
        if (!registered.includes(f.family)) registered.push(f.family);
      } else {
        const list = (plan.aliases[f.family] ??= []);
        if (!list.includes(f.alias)) list.push(f.alias);
      }
    }
    for (const fam of families) {
      const up = api.uploadedFontByFamily(fam);
      if (!up) continue;
      const k = GlobalFonts.register(Buffer.from(up.data, 'base64'), up.family);
      if (!k) continue;
      keys.push(k);
      if (!registered.includes(up.family)) registered.push(up.family);
    }
    const { canvas, items } = api.render(recipe);
    const jpeg = new Uint8Array(await canvas.encode('jpeg', JPEG_QUALITY));
    /* items and dims are plain numbers, strings and arrays: they cross back by structured clone as they are */
    return { jpeg, items, dims: api.wrapDims(recipe), fonts: registered, aliases: Object.values(plan.aliases).flat() };
  } finally {
    if (keys.length) GlobalFonts.removeBatch(keys);
  }
}

if (parentPort) {
  run(workerData as WrapWorkerJob).then(
    (out) => {
      const o = out as { jpeg?: Uint8Array };
      parentPort!.postMessage({ ok: true, out }, o.jpeg ? [o.jpeg.buffer as ArrayBuffer] : []);
    },
    (err: unknown) => parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
}
