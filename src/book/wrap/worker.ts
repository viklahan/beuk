import { GlobalFonts, loadImage, type Canvas } from '@napi-rs/canvas';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { MAX_WRAP_PIXELS, PICTURE_ID_RE, imageSize, pictureFits } from './limits.js';
import { type FontPlan, type PlanFace, installLucide, makeWrapSandbox } from './sandbox.js';

/* BEUK:wrap-server — one cover-wrap render, in its own worker thread and
   its own vm context. The parent terminates the worker at the time cap
   and caps its heap (src/book/studio/closure.ts runStudioWorker).

   Fonts: @napi-rs/canvas keeps ONE font collection for the whole process
   (GlobalFonts), shared by every worker. So a build registers only the
   faces its own recipe names (the families in the studio's font stacks
   for the recipe's fonts, from client/assets/fonts/MANIFEST.tsv, plus
   the book's uploaded faces of those names), each under a name carrying
   this build's nonce, and removes them when it ends. A worker stopped at
   the time or heap cap never gets to remove them; the nonce means no
   other build can ever match what it left (src/book/wrap/sandbox.ts).

   Sizes: the wrap's pixel count and every picture's header are checked
   before anything big is allocated (src/book/wrap/limits.ts). */

/** A face file, its family, and the family name it registers under (the family, or a subset alias). */
export type FontFile = { family: string; file: string; alias: string; italic: boolean; weights: number[] };

export type WrapWorkerJob = {
  code: string;
  lucide: string;
  /** Every cover/display/script face file, with its family (absolute paths). */
  fonts: FontFile[];
  stateJson: string;
  lang: string;
  /** glyph-width probes, measured on a sandbox canvas once this build's faces are registered */
  probes: { font: string; text: string }[];
};

export type WrapRefusal = 'no-cover' | 'too-large' | 'missing-pictures' | 'picture-too-large' | 'bad-picture-id';

export type WrapWorkerOut =
  | { refused: WrapRefusal; ids: string[] }
  | {
    jpeg: Uint8Array; items: Record<string, unknown>; dims: Record<string, unknown>;
    /** families with a studio face this build, the families the book's own uploads stood in for, the subset names, the build's nonce */
    fonts: string[]; uploaded: string[]; aliases: string[]; buildId: string;
    probes: number[];
  };

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
  const plan: FontPlan = { map: {} };
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
  if (!recipe) return { refused: 'no-cover', ids: [] };

  /* The canvas the studio is about to ask for, before it asks. */
  const d = api.wrapDims(recipe) as { totalW: number; totalH: number };
  const px = Math.round(d.totalW * 300) * Math.round(d.totalH * 300);
  if (!(px > 0 && px <= MAX_WRAP_PIXELS)) return { refused: 'too-large', ids: [] };

  /* The pictures the wrap paints, decoded the way the studio's
     ensureCoverBgImage / hcEnsureFlapPhoto / ensureWrapIcons do, into
     the studio's own cache. One the book no longer has, or that does not
     decode, is refused by name: never a blank panel. Each is sized from
     its header first; one too big, or whose header cannot be read, is
     refused before it is decoded. */
  const ids = api.pictures(recipe);
  const badIds = ids.filter((id) => typeof id !== 'string' || !PICTURE_ID_RE.test(id));
  if (badIds.length) return { refused: 'bad-picture-id', ids: badIds.map(String) };
  const missing: string[] = [], tooBig: string[] = [];
  const bytes = new Map<string, Buffer>();
  for (const id of ids) {
    const im = state.images.find((x) => x && x.id === id);
    if (!im || typeof im.data !== 'string' || !im.data) { missing.push(id); continue; }
    const buf = Buffer.from(im.data, 'base64');
    if (!pictureFits(imageSize(buf))) tooBig.push(id);
    else bytes.set(id, buf);
  }
  if (tooBig.length) return { refused: 'picture-too-large', ids: tooBig };
  for (const [id, buf] of bytes) {
    try {
      api.cache[id] = await loadImage(buf);
    } catch {
      missing.push(id);
    }
  }
  if (missing.length) return { refused: 'missing-pictures', ids: missing };

  const families = stackFamilies(api.fontStacks(recipe));
  const buildId = randomBytes(8).toString('hex');
  const keys: NonNullable<ReturnType<typeof GlobalFonts.register>>[] = [];
  const fonts: string[] = [], uploaded: string[] = [], aliases: string[] = [];
  /* each registered name with the descriptors of the files under it (the shim picks names the way Chrome picks faces) */
  const add = (family: string, face: string, italic: boolean, weights: number[]) => {
    const list = (plan.map[family] ??= []);
    let entry = list.find((e): e is PlanFace => typeof e !== 'string' && e.name === face);
    if (!entry) list.push(entry = { name: face, descs: [] });
    for (const weight of weights) if (!entry.descs.some((d) => d.italic === italic && d.weight === weight)) entry.descs.push({ italic, weight });
  };
  try {
    /* the writer's own face of a name first: they chose it */
    for (const fam of families) {
      const up = api.uploadedFontByFamily(fam);
      if (!up) continue;
      const face = `${up.family} beuk-up-${buildId}`;
      const k = GlobalFonts.register(Buffer.from(up.data, 'base64'), face);
      if (!k) continue;
      keys.push(k);
      add(up.family, face, false, [400]); /* registerUploadedFont: new FontFace(family, url), descriptors left at normal 400 */
      if (!uploaded.includes(up.family)) uploaded.push(up.family);
    }
    for (const f of job.fonts) {
      if (!families.has(f.family)) continue;
      const face = `${f.alias} beuk-${buildId}`;
      const k = GlobalFonts.registerFromPath(f.file, face);
      if (!k) continue;
      keys.push(k);
      add(f.family, face, f.italic, f.weights);
      if (f.alias === f.family) { if (!fonts.includes(f.family)) fonts.push(f.family); }
      else if (!aliases.includes(f.alias)) aliases.push(f.alias);
    }
    /* measured the way the painter measures: a canvas the studio code makes, wearing the font shim */
    const measure = vm.runInContext('(function (ps) { var c = document.createElement("canvas").getContext("2d"); return ps.map(function (p) { c.font = String(p.font); return c.measureText(String(p.text)).width; }); })', ctx) as (ps: unknown) => number[];
    const probes = Array.from(measure(JSON.parse(JSON.stringify(job.probes))), Number);
    const { canvas, items } = api.render(recipe);
    const jpeg = new Uint8Array(await canvas.encode('jpeg', JPEG_QUALITY));
    /* items and dims are plain numbers, strings and arrays: they cross back by structured clone as they are */
    return { jpeg, items, dims: api.wrapDims(recipe), fonts, uploaded, aliases, buildId, probes };
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
