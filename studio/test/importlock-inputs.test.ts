// @vitest-environment node
import 'fake-indexeddb/auto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { exportReset, exportRun } from '../src/export/state';
import { fixtures } from './fixtures';

/* Opening locked files on import (design 2026-11-10), task 1: the plain inputs of
   e2e/oracles/make-locked-fixtures.py, committed in test/fixtures/locked/ so the script is re-runnable.
   - plain.docx: 1.0's own Word file, buildDocxBlob() over the first fixture book with sections;
   - plain.pdf: 1.0's own import self-check PDF, pdfFixtureBytes(false) (three pages of Times text, a table, a picture).
   BEUK_WRITE_LOCKED_INPUTS=1 writes them again; every other run checks the committed files are what they say. */

type Rec = Record<string, unknown>;
type Api = { buildDocxBlob: () => Promise<Blob>; pdfFixtureBytes: (scan: boolean) => Uint8Array };
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const jszip = createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js') as unknown;
(globalThis as { JSZip?: unknown }).JSZip ??= jszip;
const JSZip = (globalThis as unknown as { JSZip: { loadAsync: (b: Uint8Array) => Promise<{ files: Record<string, unknown> }> } }).JSZip;

const DIR = fileURLToPath(new URL('./fixtures/locked/', import.meta.url));
const WRITE = process.env.BEUK_WRITE_LOCKED_INPUTS === '1';
let api: Api;
beforeAll(async () => {
  api = (await loadClosure()).api as unknown as Api;
  setClosureT(t);
  setClosureLang('en');
}, 120_000);

describe('the locked fixtures\' plain inputs (design 2026-11-10, task 1)', () => {
  it('plain.docx is 1.0\'s buildDocxBlob() output, a zip holding word/document.xml', async () => {
    if (WRITE) {
      const book = fixtures('all').filter((f) => Array.isArray(f.book.sections))[0]!;
      const y = new Y.Doc();
      importBook(structuredClone(book.book), y);
      desk.ydoc = y;
      exportReset();
      try {
        const blob = await exportRun((cc) => (cc.api as unknown as Api).buildDocxBlob())!;
        writeFileSync(DIR + 'plain.docx', new Uint8Array(await blob.arrayBuffer()));
      } finally {
        y.destroy();
        desk.ydoc = null;
        exportReset();
      }
    }
    expect(existsSync(DIR + 'plain.docx')).toBe(true);
    const b = new Uint8Array(readFileSync(DIR + 'plain.docx'));
    expect(Buffer.from(b.subarray(0, 4)).toString('hex')).toBe('504b0304');
    expect(Object.keys((await JSZip.loadAsync(b)).files)).toContain('word/document.xml');
  }, 120_000);

  it('plain.pdf is 1.0\'s pdfFixtureBytes(false), byte for byte', () => {
    const fresh = api.pdfFixtureBytes(false);
    if (WRITE) writeFileSync(DIR + 'plain.pdf', fresh);
    expect(Buffer.from(readFileSync(DIR + 'plain.pdf')).equals(Buffer.from(fresh))).toBe(true);
  });
});
