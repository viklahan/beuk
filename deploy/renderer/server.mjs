// Beuk renderer — the ONLY place user-supplied print-html meets a browser.
//
// The app (src/jobs/tools.ts renderPrintPdf) POSTs the print interior's
// HTML bytes to /render and receives the PDF bytes back. This process
// runs in its own container (deploy/docker-compose.tools.yml, service
// "renderer"): no volumes, read-only root fs, tmpfs /tmp, cap_drop ALL,
// no-new-privileges, mem/cpu/pids limits, no secrets in its env, and an
// internal-only network shared with the app alone (no egress, no db).
//
// Inside the container the document is fenced a second time, in layers:
//   1. Every request the page makes is intercepted (CDP Fetch via
//      Puppeteer request interception) and ABORTED, except the single
//      main-frame navigation to DOC_URL, which is answered with the
//      submitted HTML. data: URLs (the print interior's images and
//      uploaded fonts are data: URIs) never touch the network.
//   2. That answer carries a strict Content-Security-Policy header:
//      no scripts, no frames, no objects, no connections; images,
//      fonts and styles only inline or from data:.
//   3. JavaScript is disabled for the page (buildPrintHtml in the studio
//      emits CSS + markup only — no <script> — so nothing needs it).
//   4. Chromium's own resolver maps every host to NOTFOUND and all
//      traffic (loopback included) is sent to a dead proxy, so even a
//      request that slipped past (1) has nowhere to go.
//   5. A fresh browser with a fresh profile dir in tmpfs per job, a
//      hard wall-clock timeout that SIGKILLs it, an input size cap, and
//      one render at a time (a second concurrent request gets 503).
//
// Why --no-sandbox: Chromium's own sandbox needs user namespaces or a
// setuid helper; Docker's default seccomp profile plus cap_drop ALL
// forbid both. The container (no secrets, no volumes, no network but
// the app, non-root, read-only) IS the sandbox boundary here.
//
// Sources:
//   Puppeteer request interception: https://pptr.dev/guides/network-interception
//   Page.pdf options (preferCSSPageSize, printBackground):
//     https://pptr.dev/api/puppeteer.pdfoptions
//   Chromium --host-resolver-rules / --proxy-server / --proxy-bypass-list:
//     https://www.chromium.org/developers/design-documents/network-settings/
//     https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md
//   CSP directives: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy

import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { planSections, needsFinishing, withPageMap, startPages, blanksFor, stampable, finalHtml, stampSpreads } from './spreads.mjs';

const PORT = Number(process.env.RENDER_PORT ?? 3100);
const CHROMIUM = process.env.RENDER_CHROMIUM_BIN ?? '/usr/bin/chromium';
const MAX_BYTES = Number(process.env.RENDER_MAX_BYTES ?? 52_428_800);
const TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 90_000);

// A name under the reserved .invalid TLD (RFC 2606) — it can never
// resolve, and it is only ever answered by our own interception.
const DOC_URL = 'http://beuk-render.invalid/document.html';

const CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' data:",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--metrics-recording-only',
  '--mute-audio',
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
];

let busy = false;

function send(res, status, body, type = 'application/json') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      reject(Object.assign(new Error('too large'), { status: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function render(body) {
  // The document the page is answered with: the measuring pass's, then
  // the final one (see spreads.mjs). A book with no side to keep and no
  // spread is rendered in one plain pass, as before.
  const html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const plan = planSections(html);
  const finishing = needsFinishing(plan);
  let doc = finishing ? withPageMap(html, plan) : html;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'beuk-render-'));
  let browser = null;
  let timer = null;
  const blocked = [];
  try {
    const work = (async () => {
      browser = await puppeteer.launch({
        executablePath: CHROMIUM,
        headless: true,
        pipe: true, // CDP over a pipe: no debugging TCP port is opened
        userDataDir: profile,
        args: CHROMIUM_ARGS,
        env: { HOME: profile, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: profile, PATH: process.env.PATH ?? '' },
      });
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.isInterceptResolutionHandled()) return;
        const url = request.url();
        if (url.startsWith('data:')) {
          request.continue();
          return;
        }
        if (url === DOC_URL && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          request.respond({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            headers: { 'content-security-policy': CSP, 'cache-control': 'no-store' },
            body: doc,
          });
          return;
        }
        if (blocked.length < 200) blocked.push(url.slice(0, 200));
        request.abort('blockedbyclient');
      });
      await page.goto(DOC_URL, { waitUntil: 'load', timeout: TIMEOUT_MS });
      // Same print parameters the previous in-app `chromium --headless
      // --print-to-pdf --no-pdf-header-footer` call used: Chromium's
      // headless command harness hard-codes printBackground and
      // preferCSSPageSize to true and tags the PDF unless told not to
      // (https://chromium.googlesource.com/chromium/src/+/HEAD/components/headless/command_handler/headless_command.js),
      // and --no-pdf-header-footer turned displayHeaderFooter off.
      const print = async () => Buffer.from(await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        tagged: true,
        timeout: TIMEOUT_MS,
      }));
      const first = await print();
      if (!finishing) return first;
      const { before, finalStart } = blanksFor(plan, await startPages(first));
      const stamped = await stampable(plan);
      doc = finalHtml(html, before, stamped);
      await page.goto(DOC_URL, { waitUntil: 'load', timeout: TIMEOUT_MS });
      const final = await print();
      return stamped.size ? stampSpreads(final, plan, finalStart, stamped) : final;
    })();
    // If the timeout wins, the browser is killed below and `work`
    // rejects later; that late rejection must not crash the process.
    work.catch(() => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { status: 504 })), TIMEOUT_MS);
    });
    const pdf = await Promise.race([work, timeout]);
    return { pdf, blocked };
  } finally {
    clearTimeout(timer);
    if (browser) {
      const proc = browser.process();
      await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      try {
        if (proc && proc.exitCode === null) proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, busy, maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
  }
  if (req.method !== 'POST' || req.url !== '/render') return send(res, 404, { error: 'not found' });
  if (busy) return send(res, 503, { error: 'the renderer is busy with another job' });
  busy = true;
  try {
    let html;
    try {
      html = await readBody(req);
    } catch (err) {
      return send(res, err.status ?? 400, {
        error: err.status === 413 ? `the print interior is larger than the renderer accepts (${MAX_BYTES} bytes)` : 'could not read the request body',
      });
    }
    if (!html.length) return send(res, 400, { error: 'empty document' });
    const started = Date.now();
    const { pdf, blocked } = await render(html);
    console.log(
      `render ok: ${html.length} B html -> ${pdf.length} B pdf in ${Date.now() - started} ms; ${blocked.length} request(s) blocked`,
    );
    res.setHeader('x-beuk-blocked-requests', String(blocked.length));
    return send(res, 200, pdf, 'application/pdf');
  } catch (err) {
    const status = err && err.status === 504 ? 504 : 500;
    console.error(`render failed (${status}):`, err && err.message ? err.message : err);
    return send(res, status, {
      error:
        status === 504
          ? `the renderer did not finish within ${TIMEOUT_MS} ms and was stopped`
          : `the renderer failed: ${String(err && err.message ? err.message : err).slice(0, 300)}`,
    });
  } finally {
    busy = false;
  }
});

server.requestTimeout = TIMEOUT_MS + 30_000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`beuk renderer listening on :${PORT} (max ${MAX_BYTES} B, timeout ${TIMEOUT_MS} ms)`);
});
