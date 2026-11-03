/* Wave 5b: jsdom draws no canvas. 1.0's print code measures a running head's width on one (printFitHead's
   measureText): a stand-in context whose text is 0.5 em a character wide, the same for every run of a test (the tests
   compare two builds of one document, or walk it; the e2e measures with the browser's own canvas). */
export function installCanvas(): void {
  const ctx = new Proxy(
    { font: '10px serif', measureText: (s: string) => ({ width: String(s).length * (parseFloat(String(ctx.font)) || 10) * 0.5 }) } as Record<string, unknown> & { font: string },
    { get: (o, k) => (k in o ? o[k as string] : () => undefined), set: (o, k, v) => ((o[k as string] = v), true) },
  );
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx as never;
  } as never;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==';
  // jsdom decodes no picture: an Image that loads as soon as it is given a source (1.0's press bake waits on it)
  (globalThis as unknown as { Image: unknown }).Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 10;
    naturalHeight = 10;
    width = 10;
    height = 10;
    decode() {
      return Promise.resolve();
    }
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
}

/** Review (Important 1): a title and an author shaped to break out of the print CSS's running-head string. 1.0's cssStr
 *  escapes \ and " only, so a raw newline ends the CSS string in a browser; the quoted url() carries a ')' that a
 *  plain url() pattern stops at. */
export const CSS_TITLE = "x\n}\n}\nbody{background:url('https://evil.example/t)')}";
export const CSS_AUTHOR = "y\r}\f@media all{p{background-image:url('https://evil.example/a)')}}";
/** The CSS the print document carries (every <style>), from its text. */
export const styleText = (html: string): string => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
/** That CSS as a browser reads it as CSS: every string (one a raw newline does not break) masked, but a url()'s own
 *  quoted address kept (it is loaded, not shown). */
export const cssOutsideStrings = (css: string): string =>
  css.replace(/"(?:[^"\\\n\r\f]|\\[\s\S])*"|'(?:[^'\\\n\r\f]|\\[\s\S])*'/g, (m: string, at: number, all: string) => (/url\(\s*$/i.test(all.slice(Math.max(0, at - 12), at)) ? m : '""'));
