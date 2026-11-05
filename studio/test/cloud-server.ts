/* Wave 7a: the real Beuk server (src/app.ts) for the shelf's tests, in this process on an embedded Postgres (PGlite,
   as tests/helpers.ts runs it for the server suite), with mail captured and never sent, billing off unless a test turns
   it on against a fake Stripe that never leaves 127.0.0.1. A "browser" is a fetch with its own cookie jar, whose
   relative paths (1.0's "/api/…") go to that server: 1.0's code under test runs unchanged. */
import { createServer, type Server } from 'node:http';
import { buildApp } from '../../src/app.js';
import type { BillingProvider } from '../../src/billing.js';
import type { Config } from '../../src/config.js';
import type { Db } from '../../src/db.js';
import type { MailMessage, MailResult, Mailer, MailerStatus } from '../../src/mailer.js';
import { createTestDb, testConfig } from '../../tests/helpers.js';

/** Node's own fetch, kept before a test puts a browser's in its place. */
const nodeFetch = globalThis.fetch.bind(globalThis);

export class CapturedMail implements Mailer {
  sent: MailMessage[] = [];
  configured = true;
  status(): MailerStatus {
    return this.configured
      ? { configured: true, transport: 'smtp', from: 'beuk@example.test', detail: 'captured (test): nothing is sent' }
      : { configured: false, transport: 'none', from: null, detail: 'email not configured (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    if (!this.configured) return { delivered: false, reason: 'email not configured (test)', loggedToConsole: false };
    this.sent.push(message);
    return { delivered: true, messageId: `<t-${this.sent.length}@example.test>` };
  }
  async verify() {
    return { ok: this.configured, detail: 'test' };
  }
}

export type Shelf = {
  base: string;
  db: Db;
  config: Config;
  mail: CapturedMail;
  /** The clock the server reads (tests move it: a trial's day 22). */
  clock: { now: Date };
  close: () => Promise<void>;
};

/** A fake Stripe API on 127.0.0.1 (billing on only): checkout and portal sessions answer a placeholder URL. */
export async function fakeStripe(): Promise<{ base: string; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const srv: Server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url?.startsWith('/v1/checkout/sessions')) return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.example.test/1' }));
    if (req.url?.startsWith('/v1/billing_portal/sessions')) return res.end(JSON.stringify({ id: 'bps_1', url: 'https://portal.example.test/1' }));
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const a = srv.address() as { port: number };
  return { base: `http://127.0.0.1:${a.port}`, calls, close: () => new Promise((r) => srv.close(() => r())) };
}

export async function startShelf(overrides: Partial<Config> = {}, billing?: BillingProvider): Promise<Shelf> {
  const db = await createTestDb();
  const mail = new CapturedMail();
  const clock = { now: new Date() };
  const config = testConfig(overrides);
  const app = buildApp({ db, config, now: () => clock.now, mailer: mail, billing });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const a = server.address() as { port: number };
  return { base: `http://127.0.0.1:${a.port}`, db, config, mail, clock, close: () => new Promise((r) => server.close(() => r())) };
}

/** One browser: relative paths go to `base`; cookies kept as a browser keeps them for its origin. Every request is
 *  recorded (method, path, body), as the e2e and the parity checks read the network. */
export function browser(base: string) {
  const jar = new Map<string, string>();
  const requests: { method: string; path: string; body: string | null; headers: Record<string, string> }[] = [];
  const f = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, base);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    const body = typeof init.body === 'string' ? init.body : init.body == null ? null : '[binary]';
    requests.push({ method: (init.method || 'GET').toUpperCase(), path: url.pathname + url.search, body, headers });
    // (jsdom's AbortSignal is not Node's: 1.0's 4 s probe timeout is not carried to the server)
    let res: Response;
    try {
      res = await nodeFetch(url, { method: init.method, body: init.body as BodyInit | null | undefined, headers });
    } catch (e) {
      if (process.env.CLOUD_DEBUG) console.log('FETCH-THREW', url.pathname, String(e), String((e as { cause?: unknown }).cause));
      throw e;
    }
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const pair = sc.split(';')[0]!;
      const eq = pair.indexOf('=');
      const k = pair.slice(0, eq).trim(), v = pair.slice(eq + 1).trim();
      if (!v || /expires=Thu, 01 Jan 1970/i.test(sc)) jar.delete(k);
      else jar.set(k, v);
    }
    return res;
  };
  return { fetch: f as typeof fetch, requests, jar };
}
