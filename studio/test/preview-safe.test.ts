import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import { loadClosure, stateFromBook, type Closure } from '../src/closure/index';
import { exportBook } from '@book/editor/index.js';
import { cleanBookCss, cleanFlowHtml, cssLoadsOnlySafe } from '../src/preview/safe';
import { loadPreview, type PreviewClosure } from '../src/preview/preview';
import { fixtures } from './fixtures';

/* Wave 4b, constraint 36: the preview carries book-controlled HTML (the section's typeset text) and CSS (the theme's
   fonts, sizes, colours, header design). 1.0 puts both into its page unscoped by anything but `.fc-page`; a crafted
   book could close the scope (a theme value ending a rule) or carry markup (an attribute 1.0 leaves unescaped). Two
   sinks guard the preview: cleanFlowHtml (every innerHTML 1.0 writes into a page flow) and cleanBookCss (every book
   stylesheet 1.0 writes). Both leave an honest book's output exactly as 1.0 made it (the pagination's parity rests
   on it): proven on every fixture's every section and every preset theme. */

const inert = (html: string) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.innerHTML;
};

describe('cleanFlowHtml', () => {
  it('drops script-bearing elements, handlers, remote sources and script URLs', () => {
    const out = cleanFlowHtml(
      '<p onclick="x()">a<script>window.__pw=1</script><img src="https://evil.example/a.png" onerror="x()"><iframe src="/x"></iframe></p>' +
        '<a href="javascript:alert(1)">l</a><a href="#fn1">n</a><a href="https://example.com/">w</a>' +
        '<div style="background-image:url(https://evil.example/b.png);color:red">d</div>' +
        '<div style="background-image:url(data:image/png;base64,iVBORw0KGgo=)">ok</div>' +
        '<img srcset="https://evil.example/c.png 2x" src="data:image/png;base64,iVBORw0KGgo="><svg><use href="https://evil.example/s.svg#a"></use><animate attributeName="href" to="javascript:x()"></animate></svg>' +
        '<form action="https://evil.example/"><input name="q"></form><link rel="stylesheet" href="https://evil.example/c.css"><style>body{display:none}</style><meta http-equiv="refresh" content="0;url=https://evil.example/">',
    );
    expect(out).not.toMatch(/script|onclick|onerror|iframe|evil|javascript|<form|<link|<style|<meta|<use|<animate|srcset/i);
    expect(out).toContain('href="#fn1"');
    expect(out).toContain('href="https://example.com/"');
    expect(out).toContain('url(data:image/png;base64,iVBORw0KGgo=)');
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out).toContain('color:red');
  });
  it('an attribute broken out of by a quote (class="ch-x" onmouseover=…) loses the handler', () => {
    expect(cleanFlowHtml('<header class="chapter-opening ch-x" onmouseover="window.__pw=1">t</header>')).toBe('<header class="chapter-opening ch-x">t</header>');
  });
});

describe('cleanBookCss', () => {
  it('drops a rule outside the scope, an @import, a remote url() and a :has() reaching out', () => {
    const css = [
      '.fc-page { font-family: "EB Garamond", serif; }',
      '.fc-page p { text-indent: 1em; } body { display: none; } .fc-page x { color: red; }',
      '@import url(https://evil.example/x.css);',
      '.fc-page .a { background: url(https://evil.example/t.png); }',
      'body:has(.fc-page) { opacity: 0; }',
      '#topbar, .fc-page h1 { color: red; }',
      '@font-face { font-family: X; src: url(https://evil.example/f.woff2); }',
    ].join('\n');
    const r = cleanBookCss(css, '.fc-page');
    expect(r.dropped).toBeGreaterThanOrEqual(6);
    const sib = cleanBookCss('.fc-page ~ .pane, .fc-page+#mobileTabs { display: none; }\n.fc-page blockquote + p { text-indent: 0; }', '.fc-page');
    expect(sib.dropped).toBe(1);
    expect(sib.css).toContain('blockquote + p');
    expect(r.css).not.toMatch(/body|@import|evil|#topbar|:has|\.pane|#mobileTabs/);
    expect(r.css).toContain('text-indent');
  });
});

describe('both sinks leave an honest book exactly as 1.0 made it', () => {
  let c: Closure;
  let pv: PreviewClosure;
  beforeAll(async () => {
    c = await loadClosure();
    pv = await loadPreview();
  });
  const books = fixtures('all');
  it(`every section of every fixture (${books.length}), every preset theme`, () => {
    let sections = 0, sheets = 0;
    for (const f of books) {
      const ydoc = new Y.Doc();
      importBook(f.book, ydoc);
      const st = stateFromBook(c, exportBook(ydoc));
      pv.setState(st);
      for (const s of st.sections) {
        const html = pv.api.sectionHtml(s) as string;
        expect(cleanFlowHtml(html), `${f.name} ${String(s.id)}`).toBe(inert(html));
        sections++;
      }
      for (const scope of ['.fc-page', '.piv-book']) {
        const css = pv.api.buildBookCss(scope) as string;
        const r = cleanBookCss(css, scope);
        expect(r.why, `${f.name} ${scope}`).toEqual([]);
        expect(r.css).toBe(css);
        sheets++;
      }
    }
    const theme = (pv.getState() as unknown as { theme: unknown }).theme;
    for (const p of c.api.PRESETS) {
      (pv.getState() as unknown as { theme: unknown }).theme = structuredClone(p.theme);
      const css = pv.api.buildBookCss('.fc-page') as string;
      expect(cleanBookCss(css, '.fc-page').dropped, p.id).toBe(0);
      sheets++;
    }
    (pv.getState() as unknown as { theme: unknown }).theme = theme;
    expect(sections).toBeGreaterThan(100);
    expect(sheets).toBeGreaterThan(40);
  });
});

describe('at the source (the Style session’s sourceSafe): the theme values 1.0 writes unescaped', () => {
  it('a headerStyle or indentDepth that is not a plain value becomes 1.0’s default; a plain one is kept', async () => {
    const c = await loadClosure();
    const { sourceSafe } = await import('../src/style/session');
    const theme = (hs: string, ind: string) => ({ ...structuredClone(c.api.PRESETS[0]!.theme), headerStyle: hs, indentDepth: ind });
    const st = { theme: theme('x" onmouseover="window.__pw=1', '1em;} body{display:none} .fc-page{'), customThemes: [{ id: 'a', name: 'A', theme: theme('y"><b', '2em)') }], fonts: [], images: [] };
    sourceSafe(c, st as never, { fonts: [] });
    expect([st.theme.headerStyle, st.theme.indentDepth]).toEqual(['classic_centered', '1.5em']);
    expect([st.customThemes[0]!.theme.headerStyle, st.customThemes[0]!.theme.indentDepth]).toEqual(['classic_centered', '1.5em']);
    const ok = { theme: theme('weird_style', '1.25em'), customThemes: [], fonts: [], images: [] };
    sourceSafe(c, ok as never, { fonts: [] });
    expect([ok.theme.headerStyle, ok.theme.indentDepth]).toEqual(['weird_style', '1.25em']);
  });
});

describe('typing stays cheap (constraint 37)', () => {
  it('only 1.0’s page keys pressed outside a field read the book again; a key typed in the editor never does', async () => {
    const { pageKeyReadsBook } = await import('../src/preview/preview');
    const ed = { isContentEditable: true, tagName: 'DIV' } as unknown as EventTarget;
    const body = { isContentEditable: false, tagName: 'BODY' } as unknown as EventTarget;
    for (const key of [' ', 'Enter', 'a', 'f', 'ArrowLeft', 'ArrowRight', 'Escape']) expect(pageKeyReadsBook({ key, target: ed }), key).toBe(false);
    expect(pageKeyReadsBook({ key: 'ArrowRight', target: body })).toBe(true);
    expect(pageKeyReadsBook({ key: 'F', target: body })).toBe(true);
    for (const key of [' ', 'Enter', 'Escape', 'a']) expect(pageKeyReadsBook({ key, target: body }), key).toBe(false);
  });
});

describe('review round (final review, Important 1 and 2)', () => {
  it('nested CSS inside an in-scope rule is checked too: a nested rule that loads or reaches out is dropped', () => {
    const r = cleanBookCss('.fc-page p { text-indent: 1em; & { background: url(https://evil.example/x) } }', '.fc-page');
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.css).not.toMatch(/evil/);
    expect(cleanBookCss('.fc-page p { & ~ * { display: none } }', '.fc-page').dropped).toBeGreaterThan(0);
  });
  it('the hardcover’s open pages take their HTML through the flow sink (1.0’s printUnlink, wrapped)', async () => {
    const pv = await loadPreview();
    const out = String((pv.vars.printUnlink as (h: string) => string)('<p class="x" onmouseover="window.__pw=1">a<img src="https://evil.example/i.png"><a class="ext-link" href="https://e.example/">l</a></p>'));
    expect(out).not.toMatch(/onmouseover|evil/);
    expect(out).toContain('<span class="ext-link">l</span>');
  });
});

describe('review round 2', () => {
  it('Minor 4: the hardcover\'s whole stylesheet (1.0\'s pivEnsureStyle: the book CSS, print type, footnotes, cuts, layout, colour, tints) loses nothing at the sink, on every fixture', async () => {
    const c = await loadClosure();
    const pv = await loadPreview();
    const { previewSafety } = await import('../src/preview/preview');
    let el = document.getElementById('pivBookStyle');
    if (!el) {
      el = document.createElement('style');
      el.id = 'pivBookStyle';
      document.head.appendChild(el);
    }
    let sheets = 0;
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const ydoc = new Y.Doc();
      importBook(f.book, ydoc);
      pv.setState(stateFromBook(c, exportBook(ydoc)));
      const before = previewSafety.droppedRules, through = previewSafety.sheets;
      pv.api.pivEnsureStyle();
      expect(previewSafety.sheets - through, f.name + ': the sheet went through the sink').toBe(1);
      expect(previewSafety.droppedRules - before, f.name).toBe(0);
      expect(el.textContent!.length).toBeGreaterThan(1000);
      sheets++;
    }
    expect(sheets).toBe(23);
  });
  it('Important 1a: fontSize, lineHeight, dropDepth and smallCapsWords become finite numbers (the preset default otherwise), in the theme and every custom theme', async () => {
    const c = await loadClosure();
    const { sourceSafe } = await import('../src/style/session');
    const def = c.api.PRESETS[0]!.theme as Record<string, unknown>;
    const evil = '1px; position:fixed; inset:0; z-index:99999; background:#fff';
    const bad = () => ({ ...structuredClone(def), fontSize: evil, lineHeight: '1.5; position:fixed', dropDepth: 'x', smallCapsWords: {} as unknown });
    const st = { theme: bad(), customThemes: [{ id: 'a', name: 'A', theme: bad() }], fonts: [], images: [] };
    sourceSafe(c, st as never, { fonts: [] });
    for (const th of [st.theme, st.customThemes[0]!.theme] as Record<string, unknown>[])
      expect([th.fontSize, th.lineHeight, th.dropDepth, th.smallCapsWords]).toEqual([def.fontSize, def.lineHeight, def.dropDepth, def.smallCapsWords]);
    const ok = { theme: { ...structuredClone(def), fontSize: 18.5, lineHeight: '1.7', dropDepth: 4 }, customThemes: [], fonts: [], images: [] };
    sourceSafe(c, ok as never, { fonts: [] });
    expect([ok.theme.fontSize, ok.theme.lineHeight, ok.theme.dropDepth]).toEqual([18.5, 1.7, 4]);
  });

  it('Important 1b: a book rule that can leave the page box (position fixed or sticky, any z-index) is dropped', () => {
    for (const css of ['.fc-page p { font-size: 1px; position: fixed; inset: 0; background: #fff; }', '.fc-page { position: sticky; top: 0; }', '.fc-page h1 { z-index: 99999; }'])
      expect(cleanBookCss(css, '.fc-page').dropped, css).toBe(1);
    expect(cleanBookCss('.fc-page .bd-layer { position: absolute; top: 0; }', '.fc-page').dropped).toBe(0);
  });
  it('Minor 3 (CSS): a custom property, and a backslash outside a string, are dropped (1.0 writes neither)', () => {
    expect(cleanBookCss(String.raw`.fc-page p { --x: \75rl(//evil.example/x); background: var(--x); }`, '.fc-page').dropped).toBeGreaterThan(0);
    expect(cleanBookCss('.fc-page p { --y: red; }', '.fc-page').dropped).toBe(1);
    expect(cleanBookCss(String.raw`.fc-page p { b\61 ckground: red; }`, '.fc-page').dropped).toBeGreaterThan(0);
    expect(cleanBookCss(String.raw`.fc-page p::before { content: "\201C"; }`, '.fc-page').dropped).toBe(0);
  });

  it('Important 2: the hardcover’s sideways pages (1.0’s sidewaysPrintPages) take their HTML through the flow sink', async () => {
    const c = await loadClosure();
    const pv = await loadPreview();
    const ydoc = new Y.Doc();
    importBook(fixtures('real').find((f) => f.name === 'real/lantern-coast-print')!.book, ydoc);
    pv.setState(stateFromBook(c, exportBook(ydoc)));
    const seen: string[] = [];
    const obs = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((x) => { if (x instanceof Element) seen.push(x.outerHTML); })));
    obs.observe(document.body, { childList: true, subtree: true });
    (window as unknown as { __pw?: unknown }).__pw = undefined;
    const out = String((pv.vars.sidewaysPrintPages as (h: string) => string)('<p>ok</p><img src="x" onerror="window.__pw=1"><p onclick="window.__pw=2">t</p>'));
    obs.disconnect();
    expect(out + seen.join('')).not.toMatch(/onerror|onclick/);
    expect(out).toContain('ok');
  });

  it('Minor 3 (HTML): a src that resolves to another origin is removed, whatever control characters lead it; @font-face loads only same-origin or data:', () => {
    for (const src of ['\x01//evil.example/p.png', '\x1f\x00//evil.example/p.png', ' //evil.example/p.png', '\t//evil.example/p.png', String.raw`/\evil.example/p.png`, String.raw`\evil.example/p.png`])
      expect(cleanFlowHtml('<img src="' + src + '">'), JSON.stringify(src)).not.toMatch(/evil/);
    expect(cleanFlowHtml('<img src="assets/zen/x.webp">')).toContain('src="assets/zen/x.webp"');
    // @font-face's src, as the stylesheet sink reads it (jsdom's CSS parser drops @font-face, so its check is tested directly)
    expect([cssLoadsOnlySafe('src: url("\x01//evil.example/f.woff2")', true), cssLoadsOnlySafe('src: url("//evil.example/f.woff2")', true), cssLoadsOnlySafe('src: url("/assets/fonts/x.woff2")', true)]).toEqual([false, false, true]);
  });
  it('Minor 3 (HTML): the cover is hidden from 1.0’s code when its data or media type is not plain (the book keeps it)', async () => {
    const c = await loadClosure();
    const { sourceSafe } = await import('../src/style/session');
    const st = { theme: structuredClone(c.api.PRESETS[0]!.theme), customThemes: [], fonts: [], images: [], cover: { mediaType: 'image/png" onerror="x', data: 'iVBORw0KGgo=' } };
    sourceSafe(c, st as never, { fonts: [] });
    expect(st.cover).toBeNull();
    const ok = { theme: structuredClone(c.api.PRESETS[0]!.theme), customThemes: [], fonts: [], images: [], cover: { mediaType: 'image/png', data: 'iVBORw0KGgo=' } };
    sourceSafe(c, ok as never, { fonts: [] });
    expect(ok.cover).not.toBeNull();
  });

  it('Minor 5: wired — a key typed in the editor reads nothing; ← outside a field reads the book again', async () => {
    await loadClosure();
    const { installRefresh, previewSafety } = await import('../src/preview/preview');
    await loadPreview();
    const pane = document.createElement('section');
    const ed = document.createElement('div');
    ed.setAttribute('contenteditable', 'true'); // as ProseMirror marks its page
    document.body.append(pane, ed);
    const off = installRefresh(pane);
    try {
      const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      const before = previewSafety.reads;
      for (const k of [' ', 'a', 'ArrowRight', 'f']) key(ed, k);
      expect(previewSafety.reads - before, 'keys typed in the editor').toBe(0);
      key(document.body, 'ArrowLeft');
      expect(previewSafety.reads - before, '← outside a field').toBe(1);
    } finally {
      off();
      pane.remove();
      ed.remove();
    }
  });
});
