import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readerHeaders, renderReaderPage } from '../src/shares/reader.js';

// BEUK:fullscreen — every reader outside the studio (the Ramp book reader, the
// landing page's turning book, the beta-reader share page) has a full-screen
// control; BEUK:rampload — the Ramp reader shows a spread only once it is here.

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

function sharePage(): string {
  return renderReaderPage({
    nonce: 'abc123',
    token: 'tok',
    snapshot: { v: 1, title: 'T', subtitle: '', author: '', language: 'ar', sections: [{ id: 's1', kind: 'body', type: 'chapter', label: 'One', html: '<p>x</p>' }] },
    chapter: 0,
    allowComments: true,
    readerNameRequired: false,
  });
}

test('share page: a full-screen button that only the nonce script reveals, honest fallback words, no inline handlers', () => {
  const html = sharePage();
  const btn = /<button[^>]*id="rdFull"[^>]*>/.exec(html);
  assert.ok(btn, 'the button is in the page');
  for (const attr of ['type="button"', ' hidden', 'aria-pressed="false"', 'aria-keyshortcuts="F"', 'data-enter="Full screen"', 'data-exit="Exit full screen"', 'data-fill="Just the text"', 'data-fill-exit="Show the whole page"']) {
    assert.ok(btn[0].includes(attr), `button has ${attr}`);
  }
  // the only script is the nonce'd one, and it carries the full-screen code with the Safari prefix
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  assert.deepEqual(scripts, ['<script nonce="abc123">']);
  const js = /<script nonce="abc123">([\s\S]*?)<\/script>/.exec(html)![1];
  assert.match(js, /requestFullscreen/);
  assert.match(js, /webkitRequestFullscreen/);
  assert.match(js, /webkitExitFullscreen/);
  assert.match(js, /e\.key==='Escape'/);
  assert.match(js, /tag==='INPUT'\|\|tag==='TEXTAREA'/, 'F is not taken while typing a comment');
  assert.doesNotThrow(() => new Function(js), 'the page script parses');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
  // right to left: the button floats to the other side
  assert.match(html, /\[dir=rtl\] \.rd-full\{float:left/);
  assert.match(html, /<html lang="ar">/);
});

test('share page CSP is unchanged: scripts only by nonce, no unsafe-inline', () => {
  const csp = readerHeaders('n0')['Content-Security-Policy'];
  assert.match(csp, /script-src 'nonce-n0'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.match(csp, /style-src 'self' 'nonce-n0'/);
});

test('Ramp reader: full-screen control on the room, with the Safari prefix and an honest fallback', () => {
  const html = read('client', 'site', 'ramp.html');
  const btn = /<button[^>]*id="rFull"[^>]*>/.exec(html);
  assert.ok(btn, 'rFull button');
  for (const attr of ['type="button"', 'aria-pressed="false"', 'aria-keyshortcuts="F"']) assert.ok(btn[0].includes(attr), `rFull has ${attr}`);
  assert.match(html, /<div class="room" id="rRoom">/);
  assert.match(html, /room\.requestFullscreen \|\| room\.webkitRequestFullscreen/);
  assert.match(html, /\.room:fullscreen\{/);
  assert.match(html, /\.room:-webkit-full-screen\{/);
  assert.match(html, /"Just the pages"/, 'without element full screen it does not say "Full screen"');
  assert.match(html, /dlg\.addEventListener\("cancel"/, 'Escape leaves full screen before it closes the book');
  const js = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  assert.doesNotThrow(() => new Function(js));
});

test('Ramp reader: a spread is shown or turned to only once it has arrived and decoded', () => {
  const html = read('client', 'site', 'ramp.html');
  const js = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  assert.match(js, /im\.decode\(\)/, 'decoded before it is shown');
  assert.match(js, /function ready\(n\)/);
  assert.match(js, /ready\(target\)\.then/, 'a turn waits for the spread it lands on');
  assert.match(js, /ready\(0\)\.then/, 'the book opens once its first spread is here');
  assert.match(js, /\?retry=/, 'a failed request is tried again');
  assert.match(js, /"try again"/, 'and the reader can ask again');
  assert.match(js, /aria-busy/);
  // no painting of every spread at once on open any more
  assert.doesNotMatch(js, /var pre = new Image\(\); pre\.src = url\(n\)/);
});

test('landing page: the turning books have a full-screen control revealed by script', () => {
  const html = read('client', 'site', 'index.html');
  const btns = html.match(/<button type="button" class="fs3d" hidden aria-pressed="false" aria-keyshortcuts="F">Full screen<\/button>/g) ?? [];
  assert.equal(btns.length, 2);
  assert.equal((html.match(/class="[^"]*fs3d-box[^"]*"/g) ?? []).length, 2);
  assert.match(html, /box\.requestFullscreen \|\| box\.webkitRequestFullscreen/);
  assert.match(html, /"Fill the window"/);
});
