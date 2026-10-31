import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { webcrypto } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

/* BEUK:epub-server — the context the studio's EPUB code runs in. The
   studio reaches four browser things while it builds; each gets a
   narrow stand-in here:

   - DOMParser (parseXmlDoc: epubDetectProps, auditAccessibility) is
     @xmldom/xmldom, strict like a browser's XML parser: any error, not
     only a fatal one, makes the parse fail (the studio then sees null,
     as it sees a <parsererror> document). xmldom never expands
     entities from a DOCTYPE.
   - fetch reads only client/assets/fonts/<dir>/<file> from disk (the
     URL the studio forms against document.baseURI). Any other URL
     rejects; there is no network.
   - crypto.subtle is node:crypto's webcrypto; btoa/atob/URL/Blob are
     Node's.
   - document is { baseURI, getElementById: () => null }: the export
     code only asks for elements to update the screen.

   The context has no require, no process, no module and no eval or
   new Function (codeGeneration off). vm is not a boundary against
   hostile CODE (Node's own docs say so); the code here is the studio's
   own source, and the writer's book reaches it only as data. */

export const STUDIO_BASE = 'https://studio.beuk.invalid/';

/** A browser-strict DOMParser over xmldom. */
export class StrictDomParser {
  parseFromString(src: string, mime: string): unknown {
    const parser = new XmlDomParser({
      onError: (level: string, msg: string) => {
        if (level !== 'warning') throw new Error(`xml ${level}: ${msg}`);
      },
    });
    return parser.parseFromString(String(src), mime as 'application/xml');
  }
}

type FontResponse = { ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> };

/** fetch, fenced to the fonts directory. */
export function fontsFetch(clientDir: string): (url: unknown) => Promise<FontResponse> {
  const fontsDir = path.resolve(clientDir, 'assets', 'fonts');
  return async (url: unknown): Promise<FontResponse> => {
    let u: URL;
    try {
      u = new URL(String(url));
    } catch {
      throw new TypeError('fetch: not a URL');
    }
    if (u.origin !== new URL(STUDIO_BASE).origin || !u.pathname.startsWith('/assets/fonts/') || u.search || u.hash) {
      throw new TypeError(`fetch: only the studio's fonts are readable here (${u.origin}${u.pathname})`);
    }
    const rel = decodeURIComponent(u.pathname.slice('/assets/fonts/'.length));
    const full = path.resolve(fontsDir, rel);
    if (!full.startsWith(fontsDir + path.sep) || rel.split('/').length !== 2) throw new TypeError('fetch: outside the fonts directory');
    let bytes: Buffer;
    try {
      const real = await realpath(full);
      if (!real.startsWith((await realpath(fontsDir)) + path.sep)) throw new Error('outside');
      bytes = await readFile(real);
    } catch {
      return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { ok: true, status: 200, text: async () => bytes.toString('utf8'), arrayBuffer: async () => ab.slice(0) };
  };
}

export type SandboxHooks = {
  clientDir: string;
  /** toast(): every message the studio would show, in order. */
  notes: string[];
};

/** A fresh context with the shims and nothing else. */
export function makeSandbox(hooks: SandboxHooks): vm.Context {
  const g: Record<string, unknown> = {
    DOMParser: StrictDomParser,
    fetch: fontsFetch(hooks.clientDir),
    crypto: { subtle: webcrypto.subtle },
    btoa: (s: string) => btoa(s),
    atob: (s: string) => atob(s),
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setImmediate,
    queueMicrotask,
    document: { baseURI: STUDIO_BASE, getElementById: () => null },
    toast: (msg: unknown) => {
      hooks.notes.push(String(msg));
    },
    samplePicsRequire: async () => undefined,
  };
  const ctx = vm.createContext(g, { name: 'beuk-epub', codeGeneration: { strings: false, wasm: false } });
  vm.runInContext('var window = globalThis, self = globalThis;', ctx);
  return ctx;
}
