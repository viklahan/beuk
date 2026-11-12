import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* 1.0's research reader worker (client/assets/rsdoc.js, BEUK:webword) run as it is, with its own vendored JSZip and
   mammoth, in a context of its own: jsdom has no Worker. The URL the studio hands `new Worker(...)` is resolved the
   way a browser resolves it on a page under /next/, and then must name a file of 1.0's /assets/ — so a page-relative
   "assets/rsdoc.js" (which would be /next/assets/rsdoc.js there) fails here as it would fail on the site. The worker's
   own importScripts("vendor/…") resolve against the worker's URL, as in a browser. */

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/assets');
const PAGE = 'https://beuk.invalid/next/';

type Msg = { data: unknown };
export type RsWorkerOpts = { hang?: boolean };

/** Every worker made since the last reset: its resolved address, and whether it was terminated. */
export const rsWorkers: { url: string; terminated: boolean }[] = [];

function fileOf(u: URL): string {
  if (u.origin !== new URL(PAGE).origin || !u.pathname.startsWith('/assets/')) throw new Error('no such file on the site: ' + u.href);
  return path.join(ASSETS, u.pathname.slice('/assets/'.length));
}

/** A Worker constructor running 1.0's real worker file; with `hang`, jobs are taken and never answered. */
export function vmWorkerClass(opts: RsWorkerOpts = {}) {
  return class VmWorker {
    onmessage: ((e: Msg) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private ctx: vm.Context & { onmessage?: (e: Msg) => unknown };
    private rec: { url: string; terminated: boolean };
    constructor(url: string | URL) {
      const at = new URL(String(url), PAGE);
      const file = fileOf(at);
      this.rec = { url: at.pathname, terminated: false };
      rsWorkers.push(this.rec);
      const ctx = { TextDecoder, TextEncoder, atob, btoa, setTimeout, clearTimeout, console } as Record<string, unknown>;
      ctx.self = ctx;
      ctx.importScripts = (...urls: string[]) => {
        for (const u of urls) {
          const f = fileOf(new URL(u, at));
          vm.runInContext(readFileSync(f, 'utf8'), this.ctx, { filename: f });
        }
      };
      ctx.postMessage = (m: unknown) => {
        if (!this.rec.terminated) this.onmessage?.({ data: m });
      };
      this.ctx = vm.createContext(ctx);
      vm.runInContext('var window = self;', this.ctx);
      vm.runInContext(readFileSync(file, 'utf8'), this.ctx, { filename: file });
    }
    postMessage(m: unknown): void {
      if (opts.hang) return;
      // structured clone, as a real postMessage
      const data = structuredClone(m);
      setTimeout(() => void this.ctx.onmessage?.({ data }), 0);
    }
    terminate(): void {
      this.rec.terminated = true;
    }
  };
}

/** 1.0's vendored JSZip, for building test files (the same library the worker reads them with). */
export function jszip(): new () => { file: (n: string, d: unknown, o?: unknown) => void; generateAsync: (o: { type: 'base64' | 'uint8array' }) => Promise<string | Uint8Array> } {
  const ctx = vm.createContext({ setTimeout, clearTimeout, console } as Record<string, unknown>);
  vm.runInContext('var self = this, window = this;', ctx);
  vm.runInContext(readFileSync(path.join(ASSETS, 'vendor/jszip.min.js'), 'utf8'), ctx);
  return (ctx as unknown as { JSZip: never }).JSZip;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** A small real Word document: the paragraphs given (plain text), and a title in its core properties when given. */
export async function docxBytes(paras: string[], title?: string): Promise<Uint8Array> {
  const Z = jszip();
  const z = new Z();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  if (title) z.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + title + '</dc:title></cp:coreProperties>');
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="' + W + '"><w:body>' + paras.map((p) => '<w:p><w:r><w:t xml:space="preserve">' + p + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>');
  return (await z.generateAsync({ type: 'uint8array' })) as Uint8Array;
}

/** A Chrome-style saved page (MHTML), its HTML part quoted-printable, saved from `url`. */
export function mhtmlText(html: string, url: string): string {
  const B = '----MultipartBoundary--rs2----';
  const qp = Array.from(new TextEncoder().encode(html)).map((b) => (b === 61 || b > 126 ? '=' + b.toString(16).toUpperCase().padStart(2, '0') : String.fromCharCode(b))).join('').replace(/(.{70})/g, '$1=\r\n');
  return ['From: <Saved by Blink>', 'Snapshot-Content-Location: ' + url, 'MIME-Version: 1.0', 'Content-Type: multipart/related;', '\ttype="text/html";', '\tboundary="' + B + '"', '', '',
    '--' + B, 'Content-Type: text/html', 'Content-Transfer-Encoding: quoted-printable', 'Content-Location: ' + url, '', qp, '--' + B + '--', ''].join('\r\n');
}
