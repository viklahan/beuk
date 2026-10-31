/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Beuk 2.0 studio. Served at /next (Caddy proxies /next* to the app,
   which serves client/next — see src/routes/next-studio.ts). The build
   output is not committed: the Dockerfile's studio stage makes it. */
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

type StringsMeta = { uiLangKey: string; themeKey: string; order: string[]; rtl: string[] };
const stringsMeta = (): StringsMeta => {
  try {
    return JSON.parse(readFileSync(here('./src/generated/strings-meta.json'), 'utf8')) as StringsMeta;
  } catch {
    throw new Error('studio/src/generated/ is missing: run `npm run extract` (the build does it first)');
  }
};

/* index.html's pre-paint script gets 1.0's keys and language tables
   from the extraction (one source), and the page links 1.0's self-hosted
   fonts at /assets/fonts/ (same origin, served by Caddy from client/;
   the same two faces 1.0 preloads for its first paint). The font tags go
   in after Vite's own HTML processing, so it leaves those URLs alone. */
function beukHtml(): Plugin[] {
  return [
    {
      name: 'beuk-html-one-source',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const m = stringsMeta();
          const fills: Record<string, string> = {
            __BEUK_THEME_KEY__: JSON.stringify(m.themeKey),
            __BEUK_LANG_KEY__: JSON.stringify(m.uiLangKey),
            __BEUK_LANGS__: JSON.stringify(m.order),
            __BEUK_RTL__: JSON.stringify(m.rtl),
          };
          let out = html;
          for (const [k, v] of Object.entries(fills)) {
            if (!out.includes(k)) throw new Error(`studio/index.html no longer carries ${k}`);
            out = out.split(k).join(v);
          }
          return out;
        },
      },
    },
    {
      name: 'beuk-html-fonts',
      transformIndexHtml: {
        order: 'post',
        handler() {
          return FONT_FILES.map((href) =>
            href.endsWith('.css')
              ? { tag: 'link', attrs: { rel: 'stylesheet', href }, injectTo: 'head' as const }
              : { tag: 'link', attrs: { rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' as const },
          );
        },
      },
    },
  ];
}

/** 1.0's first-paint faces (client/index.html <head>) and their stylesheet. */
export const FONT_FILES = [
  '/assets/fonts/karla/karla-latin-normal-400_500_600_700.woff2',
  '/assets/fonts/ebgaramond/ebgaramond-latin-normal-400_500_600.woff2',
  '/assets/fonts/fonts.css',
];

export default defineConfig({
  base: '/next/',
  plugins: [react(), ...beukHtml()],
  resolve: {
    alias: {
      /* The book-format code is imported straight from the server's
         src/book (one source), never copied. */
      '@book': here('../src/book'),
      /* src/book imports zod; files outside studio/ would otherwise look
         for it in the repo root's node_modules. Same pinned version. */
      zod: here('./node_modules/zod'),
    },
  },
  build: {
    outDir: here('../client/next'),
    emptyOutDir: true,
    manifest: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: { fs: { allow: [here('.'), here('../src/book')] } },
  test: {
    globalSetup: ['test/global-setup.ts'],
    /* Tests import src/book/studio/closure.ts (1.0's t() beside ours, the
       extraction's failures). Its `typescript` import resolves from the
       repo root, which the studio does not install: use the studio's. */
    alias: { typescript: here('./node_modules/typescript') },
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'forks',
    maxWorkers: 1,
  },
});
