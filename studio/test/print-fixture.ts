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

/** Third review: a comment opener inside the running-head string; a regex that strips comments first takes the
 *  newline out with it, but a browser ends the string at the newline and the rule after it is live. */
export const CSS_COMMENT_TITLE = 'a/*\n}body{background:url("https://evil.example/t)")}\n*/';
export const CSS_COMMENT_TITLE_SQ = "a/*\n}body{background:url('https://evil.example/c)')}\n*/";
/** CSS read left to right as a browser reads it: strings end at their quote or at a raw newline (a bad string),
 *  comments only outside strings. What is live CSS (comments and strings masked, a url()'s own quoted address kept),
 *  and how many bad strings there are. */
export function cssAsBrowser(css: string): { live: string; bad: number } {
  let live = '', bad = 0, i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2);
      i = j < 0 ? css.length : j + 2;
      live += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1, isBad = false;
      for (; j < css.length; j++) {
        const c = css[j]!;
        if (c === ch) { j++; break; }
        if (c === '\\') { j++; continue; }
        if (c === '\n' || c === '\r' || c === '\f') { isBad = true; break; }
      }
      if (isBad) bad++;
      live += /url\(\s*$/i.test(live.slice(-12)) ? css.slice(i, j) : '""';
      i = j;
      continue;
    }
    live += ch;
    i++;
  }
  return { live, bad };
}
