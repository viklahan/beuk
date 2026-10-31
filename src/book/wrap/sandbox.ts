import { Path2D, createCanvas } from '@napi-rs/canvas';
import vm from 'node:vm';

/* BEUK:wrap-server — the context the studio's cover-wrap painter runs in.
   drawWrapTo and what it reaches touch four browser things; each gets a
   narrow stand-in here:

   - document is { createElement }: "canvas" gives an @napi-rs/canvas
     canvas (Skia, the same engine Chrome paints its canvas with); any
     other tag throws. Nothing the wrap reaches asks the page for an
     element (no getElementById, no querySelector), so there is none.
   - Image throws. Pictures are decoded by the worker before the build
     (loadImage on the stored bytes) and put into the studio's own
     coverImgCache, which is where drawWrapTo looks for them.
   - Path2D (drawLucideIcon strokes an icon's path data) is Skia's.
   - window holds lucide and nothing else: the vendored
     client/assets/vendor/lucide.min.js, evaluated in the context by the
     worker (installLucide below).

   The context has no require, no process, no module, no fetch and no
   eval or new Function (codeGeneration off). vm is not a boundary
   against hostile CODE (Node's own docs say so); the code here is the
   studio's own source, and the writer's book reaches it only as data. */

class NoImage {
  constructor() {
    throw new Error('Image is not available on the server: the wrap build decodes pictures before it paints');
  }
}

/** A fresh context with the shims and nothing else. */
export function makeWrapSandbox(): vm.Context {
  const g: Record<string, unknown> = {
    document: {
      createElement: (tag: unknown) => {
        if (String(tag).toLowerCase() !== 'canvas') throw new Error(`document.createElement: only a canvas can be made on the server (asked for ${String(tag)})`);
        return createCanvas(1, 1);
      },
    },
    Image: NoImage,
    Path2D,
  };
  return vm.createContext(g, { name: 'beuk-wrap', codeGeneration: { strings: false, wasm: false } });
}

/** Evaluate the vendored Lucide bundle in the context and leave a
 *  `window` that holds it and nothing else. */
export function installLucide(ctx: vm.Context, lucideSource: string): void {
  new vm.Script(lucideSource, { filename: 'lucide.min.js' }).runInContext(ctx);
  vm.runInContext('var window = { lucide: globalThis.lucide }; delete globalThis.lucide;', ctx);
}
