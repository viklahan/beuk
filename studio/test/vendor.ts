import { readFileSync } from 'node:fs';
import path from 'node:path';

/* Wave 6: 1.0's vendored mammoth in the test page (jsdom loads no <script src>): the same file the studio loads with
   1.0's integrity (client/assets/vendor/mammoth.browser.min.js), run as a classic script runs it — no CommonJS module or
   AMD loader in scope, so its UMD sets the page's global window.mammoth. */
export function loadMammoth(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.mammoth) return;
  const code = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'mammoth.browser.min.js'), 'utf8');
  new Function('exports', 'module', 'define', code).call(globalThis);
  if (typeof (g.mammoth as { convertToHtml?: unknown } | undefined)?.convertToHtml !== 'function') throw new Error('mammoth did not load');
}
