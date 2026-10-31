import { loadImage, type Canvas } from '@napi-rs/canvas';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { MAX_RENDER_PIXELS, MAX_WRAP_PIXELS, PICTURE_ID_RE, checkSvg, imageSize, looksLikeSvg, pictureFits } from './limits.js';
import { type FontPlan, type PlanFace, installLucide, makeWrapSandbox } from './sandbox.js';

/* BEUK:wrap-server — one cover-wrap render, in its own worker thread and
   its own vm context. The parent terminates the worker at the time cap
   and caps its heap (src/book/studio/closure.ts runStudioWorker).

   Fonts: @napi-rs/canvas keeps ONE font collection for the whole process
   (GlobalFonts), shared by every worker. A build uses only the faces its
   own recipe names (the families in the studio's font stacks for the
   recipe's fonts, from client/assets/fonts/MANIFEST.tsv, plus the book's
   uploaded faces of those names), each under a name carrying this
   build's nonce. The worker works out which (it runs the studio code)
   and asks; the PARENT registers them and removes them once this thread
   has exited (src/book/wrap/closure.ts), so a worker stopped at the time
   or heap cap leaves nothing behind. The nonce still means no other
   build could ever match a face of this one (src/book/wrap/sandbox.ts).

   Sizes: the wrap's pixel count and every picture's header are checked
   before anything big is allocated, and so is their sum
   (src/book/wrap/limits.ts). */

/** A face file, its family, and the family name it registers under (the family, or a subset alias). */
export type FontFile = { family: string; file: string; alias: string; italic: boolean; weights: number[] };

export type WrapWorkerJob = {
  code: string;
  lucide: string;
  stateJson: string;
  lang: string;
  /** glyph-width probes, measured on a sandbox canvas once this build's faces are registered */
  probes: { font: string; text: string }[];
  /** tests only: once the faces are registered, spin until the parent stops the worker */
  holdAfterFonts?: boolean;
};

/** Worker → parent: the faces this build sets type in. */
export type FontsWanted = { fontsWanted: { families: string[]; uploads: { family: string; data: string }[] } };
/** A face the parent registered: the family the studio names, the nonced name it is registered under, its descriptors. */
export type GivenFace = { family: string; face: string; italic: boolean; weights: number[] };
/** Parent → worker: what it registered, in the order the shim should prefer them. */
export type FontsGiven = { faces: GivenFace[]; fonts: string[]; uploaded: string[]; aliases: string[]; buildId: string };

export type WrapRefusal = 'no-cover' | 'too-large' | 'missing-pictures' | 'picture-too-large' | 'picture-unsupported' | 'bad-picture-id';

export type WrapWorkerOut =
  | { refused: WrapRefusal; ids: string[] }
  | {
    jpeg: Uint8Array; items: Record<string, unknown>; dims: Record<string, unknown>;
    /** families with a studio face this build, the families the book's own uploads stood in for, the subset names, the build's nonce */
    fonts: string[]; uploaded: string[]; aliases: string[]; buildId: string;
    /** downloadWrap's file name, without the extension */
    name: string;
    probes: number[];
  };

type Recipe = Record<string, unknown>;
type Api = {
  render(recipe: Recipe): { canvas: Canvas; items: Record<string, unknown> };
  wrapDims(recipe: Recipe): Record<string, unknown>;
  pictures(recipe: Recipe): string[];
  fontStacks(recipe: Recipe): string[];
  uploadedFontByFamily(family: string): { family: string; data: string } | null;
  fileName(state: unknown, recipe: Recipe): string;
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
     its header first, before it is decoded: one too big is refused as
     too large. An SVG (a flourish chosen as cover art) is checked as
     a parsed document (limits.ts checkSvg: nothing fetched or expanded, its declared
     size fenced) and decoded at a bounded raster size; a risky SVG, or a
     picture that is none of JPEG, PNG, WebP, GIF or SVG, is unsupported. */
  const ids = api.pictures(recipe);
  const badIds = ids.filter((id) => typeof id !== 'string' || !PICTURE_ID_RE.test(id));
  if (badIds.length) return { refused: 'bad-picture-id', ids: badIds.map(String) };
  const missing: string[] = [], tooBig: string[] = [], unsupported: string[] = [];
  const bytes = new Map<string, Buffer>();
  /* the native budget: every decoded picture plus the canvas (limits.ts MAX_RENDER_PIXELS) */
  let pixels = px;
  for (const id of ids) {
    const im = state.images.find((x) => x && x.id === id);
    if (!im || typeof im.data !== 'string' || !im.data) { missing.push(id); continue; }
    const buf = Buffer.from(im.data, 'base64');
    const size = imageSize(buf);
    if (!size) {
      const svg = looksLikeSvg(buf) ? checkSvg(buf) : null;
      if (svg && svg.ok) { bytes.set(id, svg.bytes); pixels += svg.w * svg.h; }
      else if (svg && svg.reason === 'too-large') tooBig.push(id);
      else unsupported.push(id);
    } else if (!pictureFits(size)) tooBig.push(id);
    else { bytes.set(id, buf); pixels += size.w * size.h; }
  }
  if (tooBig.length) return { refused: 'picture-too-large', ids: tooBig };
  if (unsupported.length) return { refused: 'picture-unsupported', ids: unsupported };
  if (pixels > MAX_RENDER_PIXELS) return { refused: 'too-large', ids: [] };
  for (const [id, buf] of bytes) {
    try {
      api.cache[id] = await loadImage(buf);
    } catch {
      missing.push(id);
    }
  }
  if (missing.length) return { refused: 'missing-pictures', ids: missing };

  /* the faces: the worker names them, the parent registers them (and removes them after this thread has exited) */
  const families = [...stackFamilies(api.fontStacks(recipe))];
  const uploads: { family: string; data: string }[] = [];
  for (const fam of families) {
    const up = api.uploadedFontByFamily(fam);
    if (up) uploads.push({ family: String(up.family), data: String(up.data) });
  }
  const given = await askParent({ fontsWanted: { families, uploads } });
  /* each registered name with the descriptors of the files under it (the shim picks names the way Chrome picks faces) */
  for (const g of given.faces) {
    const list = (plan.map[g.family] ??= []);
    let entry = list.find((e): e is PlanFace => typeof e !== 'string' && e.name === g.face);
    if (!entry) list.push(entry = { name: g.face, descs: [] });
    for (const weight of g.weights) if (!entry.descs.some((d) => d.italic === g.italic && d.weight === weight)) entry.descs.push({ italic: g.italic, weight });
  }
  if (job.holdAfterFonts) for (;;) { /* tests: stopped here by the parent, faces registered */ }
  /* measured the way the painter measures: a canvas the studio code makes, wearing the font shim */
  const measure = vm.runInContext('(function (ps) { var c = document.createElement("canvas").getContext("2d"); return ps.map(function (p) { c.font = String(p.font); return c.measureText(String(p.text)).width; }); })', ctx) as (ps: unknown) => number[];
  const probes = Array.from(measure(JSON.parse(JSON.stringify(job.probes))), Number);
  const { canvas, items } = api.render(recipe);
  const jpeg = new Uint8Array(await canvas.encode('jpeg', JPEG_QUALITY));
  /* items and dims are plain numbers, strings and arrays: they cross back by structured clone as they are */
  return { jpeg, items, dims: api.wrapDims(recipe), fonts: given.fonts, uploaded: given.uploaded, aliases: given.aliases, buildId: given.buildId, name: String(api.fileName(ctx.state, recipe)), probes };
}

/** Ask the parent to register this build's faces; its answer says what it registered. */
function askParent(m: FontsWanted): Promise<FontsGiven> {
  return new Promise((resolve) => {
    parentPort!.once('message', (given: FontsGiven) => resolve(given));
    parentPort!.postMessage(m);
  });
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
