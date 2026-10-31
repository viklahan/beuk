/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/* Beuk 2.0 studio. Served at /next (Caddy proxies /next* to the app,
   which serves client/next — see src/routes/next-studio.ts). The build
   output is not committed: the Dockerfile's studio stage makes it. */
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: '/next/',
  plugins: [react()],
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
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'forks',
    maxWorkers: 1,
  },
});
