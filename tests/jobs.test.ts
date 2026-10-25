import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { Client, createTestDb, registerUser, startTestServer, testConfig, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { ghostscriptPdfxArgs, pdfRenderProblem } from '../src/jobs/tools.js';

/**
 * M5 jobs, end-to-end through the REAL adapters and child_process —
 * the tools themselves are small stubs (configured via the same
 * JAVA_BIN / EPUBCHECK_JAR / GS_BIN / RENDERER_URL settings production
 * uses):
 *  - fake "java" writes a canned EPUBCheck JSON report to the path
 *    the adapter names after -j/--json (and refuses to run without an
 *    -Xmx heap cap as its first argument);
 *  - a stub renderer HTTP server answers POST /render like
 *    deploy/renderer/server.mjs: it records the HTML it was sent and
 *    returns a minimal valid PDF (the HTML → PDF rendition step);
 *  - fake "gs" copies its input file to the -sOutputFile= target.
 * Real EPUBCheck/Ghostscript/Chromium binaries do not run here (the
 * renderer's real isolation is proven by deploy/renderer-attack.sh);
 * the pipeline around them is what is proven here.
 */

let db: Db;
let server: TestServer;
let alice: Client;
let bob: Client;
let aliceManuscriptId: string;
let aliceEpubId: string;
let aliceMarkdownId: string;
let alicePrintId: string;
let bobEpubId: string;

let fakeJava: string;
let fakeGs: string;
let fakeToolsDir: string;
let pdfxDef: string;
let stubRenderer: http.Server;
let rendererUrl: string;
let rendererMode: 'pdf' | 'error' | 'not-pdf' = 'pdf';
const rendererCalls: Array<{ method: string; url: string; contentType: string; body: Buffer }> = [];
let sleepyJava: string;
let stubJar: string;

/** The bytes the fake renderer "produces": a minimal valid PDF. */
const FAKE_RENDERED_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
  'latin1',
);

const CANNED_REPORT = {
  checker: { checkerVersion: '5.1.0-stub' },
  messages: [
    {
      ID: 'RSC-005',
      severity: 'ERROR',
      message: 'Error while parsing file: element "p" not allowed here',
      locations: [{ path: 'OEBPS/Text/ch01.xhtml', line: 12, column: 4 }],
    },
    {
      ID: 'OPF-092',
      severity: 'WARNING',
      message: 'The unique-identifier property is missing',
      locations: [{ path: 'OEBPS/package.opf' }],
    },
    { ID: 'HTM-001', severity: 'INFO', message: 'A note from the stub', locations: [] },
  ],
  items: [],
};

interface JobView {
  id: string;
  kind: string;
  sourceExportId: string | null;
  artifactExportId: string | null;
  status: string;
  result: Record<string, unknown> | null;
}

async function newManuscript(client: Client): Promise<string> {
  const created = await client.post('/api/manuscripts', {
    doc: { title: 'Job Host', sections: { frontMatter: [], body: [], backMatter: [] } },
  });
  assert.equal(created.status, 201);
  return (created.body.manuscript as { id: string }).id;
}

async function newExport(
  client: Client,
  manuscriptId: string,
  format: string,
  filename: string,
  bytes: Buffer,
): Promise<string> {
  const saved = await client.upload(
    `/api/exports?manuscriptId=${manuscriptId}&format=${format}&filename=${filename}`,
    bytes,
  );
  assert.equal(saved.status, 201);
  return (saved.body.export as { id: string }).id;
}

async function waitForJob(client: Client, jobId: string): Promise<JobView> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const res = await client.get(`/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = res.body.job as JobView;
    if (job.status === 'done' || job.status === 'failed') return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} never finished (last: ${job.status})`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

before(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-fake-tools-'));

  stubJar = path.join(dir, 'epubcheck.jar');
  writeFileSync(stubJar, 'stub jar placeholder — the fake java never opens it');

  fakeJava = path.join(dir, 'fake-java.sh');
  writeFileSync(
    fakeJava,
    `#!/bin/sh
# Fake "java -jar epubcheck.jar": find the JSON report target (the
# argument after -j / --json, or --json=PATH) and write the canned
# EPUBCheck-style report there.
out=""
prev=""
for a in "$@"; do
  case "$a" in
    --json=*) out="\${a#--json=}" ;;
  esac
  if [ "$prev" = "-j" ] || [ "$prev" = "--json" ]; then out="$a"; fi
  prev="$a"
done
if [ -z "$out" ]; then echo "fake-java: no json target" >&2; exit 2; fi
# Like real EPUBCheck: the input's mode comes from its .epub extension; an
# extensionless file (how the archive stores exports) is refused, no report.
# The JVM heap must be capped: -Xmx<size> comes first, before -jar.
case "$1" in
  -Xmx*) ;;
  *) echo "fake-java: no -Xmx heap cap (first arg was '$1')" >&2; exit 3 ;;
esac
case "$4" in
  *.epub) ;;
  *) echo "Mode required for non-epub files. Default version is 3.0." >&2; exit 2 ;;
esac
cat > "$out" <<'JSON'
${JSON.stringify(CANNED_REPORT)}
JSON
exit 0
`,
  );
  chmodSync(fakeJava, 0o755);

  sleepyJava = path.join(dir, 'sleepy-java.sh');
  writeFileSync(sleepyJava, '#!/bin/sh\nsleep 30\n');
  chmodSync(sleepyJava, 0o755);

  fakeToolsDir = dir;
  fakeGs = path.join(dir, 'fake-gs.sh');
  writeFileSync(
    fakeGs,
    `#!/bin/sh
# Fake Ghostscript: --version answers; a conversion copies the input
# file (the last positional argument) to the -sOutputFile= target.
if [ "$1" = "--version" ]; then echo "9.99-stub"; exit 0; fi
out=""
input=""
for a in "$@"; do
  case "$a" in
    -sOutputFile=*) out="\${a#-sOutputFile=}" ;;
    -*) ;;
    *) input="$a" ;;
  esac
done
if [ -z "$out" ] || [ -z "$input" ]; then echo "fake-gs: missing in/out" >&2; exit 2; fi
# Marker files beside the script drive the PDF/X failure modes:
# gs-revert → print Ghostscript 10.00.0's real two-line "reverting to
# normal PDF output" notice and still exit 0 (as the real binary does);
# gs-slow → overrun any short timeout.
here="$(dirname "$0")"
if [ -f "$here/gs-slow" ]; then sleep 30; fi
if [ -f "$here/gs-revert" ]; then
  echo "GPL Ghostscript 10.00.0: Annotation (not TrapNet or PrinterMark) on page,"
  echo " not permitted in PDF/X, reverting to normal PDF output"
fi
cp "$input" "$out"
exit 0
`,
  );
  chmodSync(fakeGs, 0o755);
  // A def file whose ICC profile exists, so pdfxProblem lets the stub run.
  const icc = path.join(dir, 'press.icc');
  writeFileSync(icc, 'stub profile');
  pdfxDef = path.join(dir, 'PDFX_def.ps');
  writeFileSync(pdfxDef, `%!PS
/BeukICCPath (${icc}) def
`);

  // Stub renderer: answers like deploy/renderer/server.mjs. Its reply
  // is switchable so the failure modes can be driven from tests.
  stubRenderer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      rendererCalls.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: String(req.headers['content-type'] ?? ''),
        body: Buffer.concat(chunks),
      });
      if (rendererMode === 'error') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'the renderer failed: stub explosion' }));
      } else if (rendererMode === 'not-pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('<html>definitely not a pdf</html>');
      } else {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(FAKE_RENDERED_PDF);
      }
    });
  });
  await new Promise<void>((resolve) => stubRenderer.listen(0, '127.0.0.1', resolve));
  rendererUrl = `http://127.0.0.1:${(stubRenderer.address() as AddressInfo).port}/render`;

  db = await createTestDb();
  server = await startTestServer(db, undefined, {
    epubcheckJar: stubJar,
    javaBin: fakeJava,
    gsBin: fakeGs,
    pdfxDefPath: pdfxDef,
    rendererUrl,
  });
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
  await registerUser(bob, 'bob@example.com');
  aliceManuscriptId = await newManuscript(alice);
  const bobManuscriptId = await newManuscript(bob);
  aliceEpubId = await newExport(
    alice,
    aliceManuscriptId,
    'epub',
    'the-salt-meridian.epub',
    Buffer.from('PK\x03\x04 stub epub bytes'),
  );
  aliceMarkdownId = await newExport(
    alice,
    aliceManuscriptId,
    'markdown',
    'the-salt-meridian.md',
    Buffer.from('# The Salt Meridian\n'),
  );
  alicePrintId = await newExport(
    alice,
    aliceManuscriptId,
    'print-html',
    'the-salt-meridian-print.html',
    Buffer.from('<html><body>print interior</body></html>'),
  );
  bobEpubId = await newExport(
    bob,
    bobManuscriptId,
    'epub',
    'bobs-book.epub',
    Buffer.from('PK\x03\x04 bob epub bytes'),
  );
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => stubRenderer.close(() => resolve()));
});

test('epubcheck job on own epub export runs to done with the parsed report stored', async () => {
  const created = await alice.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
  assert.equal(created.status, 201);
  const jobId = (created.body.job as JobView).id;
  assert.equal((created.body.job as JobView).status, 'queued');

  const job = await waitForJob(alice, jobId);
  assert.equal(job.kind, 'epubcheck');
  assert.equal(job.sourceExportId, aliceEpubId);
  assert.equal(job.status, 'done');
  assert.equal(job.artifactExportId, null);
  const result = job.result!;
  assert.equal(result.tool, 'epubcheck');
  assert.equal(result.toolVersion, '5.1.0-stub');
  // The stub report HAS an error: the job ran fine, the book did not
  // pass — and the result says exactly that.
  assert.equal(result.passed, false);
  assert.deepEqual(result.counts, { fatal: 0, errors: 1, warnings: 1, infos: 1, usages: 0 });
  const messages = result.messages as Array<{
    code: string;
    severity: string;
    message: string;
    location: string | null;
  }>;
  assert.equal(messages.length, 3);
  assert.equal(messages[0].code, 'RSC-005');
  assert.equal(messages[0].severity, 'ERROR');
  assert.equal(messages[0].location, 'OEBPS/Text/ch01.xhtml:12:4');
  assert.equal(messages[1].location, 'OEBPS/package.opf');
  assert.equal(messages[2].location, null);
});

test("jobs are owner-scoped: another user's export 404s, another user's job 404s, lists are separate", async () => {
  assert.equal((await alice.post('/api/jobs/epubcheck', { exportId: bobEpubId })).status, 404);
  assert.equal((await alice.post('/api/jobs/pdfx', { exportId: bobEpubId })).status, 404);
  assert.equal(
    (await alice.post('/api/jobs/epubcheck', { exportId: '00000000-0000-0000-0000-000000000000' }))
      .status,
    404,
  );

  const created = await alice.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
  const jobId = (created.body.job as JobView).id;
  await waitForJob(alice, jobId);
  assert.equal((await bob.get(`/api/jobs/${jobId}`)).status, 404);
  const bobJobs = (await bob.get('/api/jobs')).body.jobs as JobView[];
  assert.equal(bobJobs.length, 0);
  const aliceJobs = (await alice.get('/api/jobs')).body.jobs as JobView[];
  assert.ok(aliceJobs.some((j) => j.id === jobId));
});

test('wrong-format sources are rejected cleanly, per kind', async () => {
  const epubOnMarkdown = await alice.post('/api/jobs/epubcheck', { exportId: aliceMarkdownId });
  assert.equal(epubOnMarkdown.status, 400);
  assert.match(String(epubOnMarkdown.body.error), /epub export/);

  const pdfxOnEpub = await alice.post('/api/jobs/pdfx', { exportId: aliceEpubId });
  assert.equal(pdfxOnEpub.status, 400);
  assert.match(String(pdfxOnEpub.body.error), /print-html/);

  const pdfxOnMarkdown = await alice.post('/api/jobs/pdfx', { exportId: aliceMarkdownId });
  assert.equal(pdfxOnMarkdown.status, 400);

  const missing = await alice.post('/api/jobs/epubcheck', {});
  assert.equal(missing.status, 400);

  // Rejections created no jobs.
  const jobs = (await alice.get('/api/jobs')).body.jobs as JobView[];
  assert.ok(jobs.every((j) => j.sourceExportId !== aliceMarkdownId));
});

test('pdfx job on a print interior renders HTML to PDF first, then archives the converted file', async () => {
  const created = await alice.post('/api/jobs/pdfx', { exportId: alicePrintId });
  assert.equal(created.status, 201);
  const jobId = (created.body.job as JobView).id;

  const job = await waitForJob(alice, jobId);
  assert.equal(job.status, 'done');
  assert.ok(job.artifactExportId, 'the job points at its archived output');
  const result = job.result!;
  assert.equal(result.tool, 'ghostscript');
  assert.equal(result.gsVersion, '9.99-stub');
  assert.equal(result.artifactExportId, job.artifactExportId);
  assert.equal(result.renderedPdfBytes, FAKE_RENDERED_PDF.length);
  // Store-ready tie-in: the converted file's own facts ride the result.
  // The stub "conversion" is a bare PDF with no pages, no fonts and no
  // PDF/X declaration — and the inspection says exactly that.
  const inspection = result.inspection as {
    headerVersion: string | null;
    pageCount: number;
    pdfx: { version: string | null; outputIntent: boolean };
    fontsAllEmbedded: boolean | null;
  };
  assert.ok(inspection, 'pdfx results carry an inspection of the converted file');
  assert.equal(inspection.headerVersion, '1.4');
  assert.equal(inspection.pageCount, 0);
  assert.equal(inspection.pdfx.version, null);
  assert.equal(inspection.pdfx.outputIntent, false);
  assert.equal(inspection.fontsAllEmbedded, null);

  // The output is a real archive citizen: listed, downloadable, and —
  // crucially — a PDF produced by the rendition step, not the source
  // HTML handed to Ghostscript (the old pipeline fed raw HTML bytes).
  const list = (await alice.get('/api/exports')).body.exports as Array<{
    id: string;
    format: string;
    filename: string;
    manuscriptId: string | null;
  }>;
  const artifact = list.find((e) => e.id === job.artifactExportId);
  assert.ok(artifact);
  assert.equal(artifact.format, 'pdfx');
  assert.equal(artifact.filename, 'the-salt-meridian-print-pdfx.pdf');
  assert.equal(artifact.manuscriptId, aliceManuscriptId);
  const download = await alice.download(`/api/exports/${artifact.id}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(download.bytes, FAKE_RENDERED_PDF);
  assert.notEqual(download.bytes.toString('utf8'), '<html><body>print interior</body></html>');
  // The rendition happened in the renderer service: the print interior's
  // exact bytes were POSTed to RENDERER_URL as HTML.
  const call = rendererCalls.at(-1)!;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, '/render');
  assert.match(call.contentType, /^text\/html/);
  assert.equal(call.body.toString('utf8'), '<html><body>print interior</body></html>');
});

test('a Ghostscript run that reverts to plain PDF fails honestly — no artifact claiming PDF/X', async () => {
  const marker = path.join(fakeToolsDir, 'gs-revert');
  writeFileSync(marker, '');
  try {
    const created = await alice.post('/api/jobs/pdfx', { exportId: alicePrintId });
    assert.equal(created.status, 201);
    const job = await waitForJob(alice, (created.body.job as JobView).id);
    assert.equal(job.status, 'failed');
    assert.equal(job.artifactExportId, null);
    const error = String(job.result!.error);
    assert.match(error, /could not keep this file PDF\/X/);
    assert.match(error, /Annotation \(not TrapNet or PrinterMark\) on page, not permitted in PDF\/X, reverting to normal PDF output/);
  } finally {
    rmSync(marker, { force: true });
  }
});

test('the Ghostscript step has its own timeout (PDFX_TIMEOUT_MS), stated when it overruns', async () => {
  const marker = path.join(fakeToolsDir, 'gs-slow');
  writeFileSync(marker, '');
  const slow = await startTestServer(db, undefined, {
    exportDir: server.config.exportDir,
    gsBin: fakeGs,
    pdfxDefPath: pdfxDef,
    rendererUrl,
    jobTimeoutMs: 120_000,
    pdfxTimeoutMs: 400,
  });
  try {
    const gail = new Client(slow.base);
    await gail.post('/api/auth/login', { email: 'alice@example.com', password: 'correct horse battery' });
    const created = await gail.post('/api/jobs/pdfx', { exportId: alicePrintId });
    assert.equal(created.status, 201);
    const job = await waitForJob(gail, (created.body.job as JobView).id);
    assert.equal(job.status, 'failed');
    assert.match(String(job.result!.error), /Ghostscript did not finish within 400 ms \(PDFX_TIMEOUT_MS\)/);
  } finally {
    rmSync(marker, { force: true });
    await slow.close();
  }
});

test('unconfigured tools: job creation still succeeds, the job completes FAILED, never a pass', async () => {
  // Same db AND same export dir (the bytes live there); only the tool
  // configuration differs — config defaults: no jar, no gs.
  const bare = await startTestServer(db, undefined, { exportDir: server.config.exportDir });
  try {
    const carol = new Client(bare.base);
    await carol.post('/api/auth/login', { email: 'alice@example.com', password: 'correct horse battery' });

    const ecCreated = await carol.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
    assert.equal(ecCreated.status, 201);
    const ecJob = await waitForJob(carol, (ecCreated.body.job as JobView).id);
    assert.equal(ecJob.status, 'failed');
    assert.equal(ecJob.result!.configured, false);
    assert.match(String(ecJob.result!.error), /not configured/i);
    assert.equal(ecJob.result!.passed, undefined);

    const pxCreated = await carol.post('/api/jobs/pdfx', { exportId: alicePrintId });
    assert.equal(pxCreated.status, 201);
    const pxJob = await waitForJob(carol, (pxCreated.body.job as JobView).id);
    assert.equal(pxJob.status, 'failed');
    assert.equal(pxJob.result!.configured, false);
    assert.match(String(pxJob.result!.error), /not configured/i);
    assert.equal(pxJob.artifactExportId, null);
    // The rendition step is gated FIRST: with no renderer configured the
    // job names the missing HTML-to-PDF step — raw HTML is never offered
    // to Ghostscript.
    assert.equal(pxJob.result!.tool, 'html-to-pdf');
    assert.match(String(pxJob.result!.error), /HTML-to-PDF rendition is not configured/);
  } finally {
    await bare.close();
  }
});

test('a job whose tool overruns the per-job timeout fails with the timeout stated', async () => {
  const slow = await startTestServer(db, undefined, {
    exportDir: server.config.exportDir,
    epubcheckJar: stubJar,
    javaBin: sleepyJava,
    jobTimeoutMs: 300,
  });
  try {
    const dave = new Client(slow.base);
    await dave.post('/api/auth/login', { email: 'alice@example.com', password: 'correct horse battery' });
    const created = await dave.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
    assert.equal(created.status, 201);
    const job = await waitForJob(dave, (created.body.job as JobView).id);
    assert.equal(job.status, 'failed');
    assert.match(String(job.result!.error), /did not finish within 300 ms/);
  } finally {
    await slow.close();
  }
});

test('job endpoints require auth', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.post('/api/jobs/epubcheck', { exportId: aliceEpubId })).status, 401);
  assert.equal((await anon.post('/api/jobs/pdfx', { exportId: alicePrintId })).status, 401);
  assert.equal((await anon.get('/api/jobs')).status, 401);
  assert.equal((await anon.get('/api/jobs/whatever')).status, 401);
});

test('admission caps: a user holds at most JOB_MAX_ACTIVE_PER_USER jobs, the server JOB_MAX_QUEUED', async () => {
  // A sleepy tool keeps jobs active long enough to fill the slots; the
  // short timeout then fails each one so the slots free up again.
  const capped = await startTestServer(db, undefined, {
    exportDir: server.config.exportDir,
    epubcheckJar: stubJar,
    javaBin: sleepyJava,
    jobTimeoutMs: 1_000,
    jobMaxActivePerUser: 2,
    jobMaxQueued: 3,
  });
  try {
    const erin = new Client(capped.base);
    await erin.post('/api/auth/login', { email: 'alice@example.com', password: 'correct horse battery' });
    const frank = new Client(capped.base);
    await frank.post('/api/auth/login', { email: 'bob@example.com', password: 'correct horse battery' });

    const first = await erin.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
    const second = await erin.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const third = await erin.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
    assert.equal(third.status, 429);
    assert.match(String(third.body.error), /already have 2 jobs waiting or running \(the limit is 2\)/);

    const bobs = await frank.post('/api/jobs/epubcheck', { exportId: bobEpubId });
    assert.equal(bobs.status, 201);
    const overflow = await frank.post('/api/jobs/epubcheck', { exportId: bobEpubId });
    assert.equal(overflow.status, 503);
    assert.match(String(overflow.body.error), /job queue is full/);

    // Refused requests created no jobs: exactly the three admitted ones are active.
    const active = await db.query<{ n: number }>(
      `select count(*)::int as n from jobs where status in ('queued', 'running')`,
    );
    assert.equal(active.rows[0].n, 3);

    for (const [client, res] of [
      [erin, first],
      [erin, second],
      [frank, bobs],
    ] as const) {
      const job = await waitForJob(client, (res.body.job as JobView).id);
      assert.equal(job.status, 'failed');
    }
    // Slots free again once jobs finish.
    const again = await erin.post('/api/jobs/epubcheck', { exportId: aliceEpubId });
    assert.equal(again.status, 201);
    await waitForJob(erin, (again.body.job as JobView).id);
  } finally {
    await capped.close();
  }
});

test('renderer failures are honest: an HTTP error, a non-PDF reply, an unreachable renderer', async () => {
  try {
    rendererMode = 'error';
    const errored = await waitForJob(
      alice,
      ((await alice.post('/api/jobs/pdfx', { exportId: alicePrintId })).body.job as JobView).id,
    );
    assert.equal(errored.status, 'failed');
    assert.equal(errored.result!.tool, 'html-to-pdf');
    assert.equal(errored.result!.configured, true);
    assert.match(String(errored.result!.error), /answered HTTP 500 and produced no PDF\. Renderer said: the renderer failed: stub explosion/);
    assert.equal(errored.artifactExportId, null);

    rendererMode = 'not-pdf';
    const notPdf = await waitForJob(
      alice,
      ((await alice.post('/api/jobs/pdfx', { exportId: alicePrintId })).body.job as JobView).id,
    );
    assert.equal(notPdf.status, 'failed');
    assert.match(String(notPdf.result!.error), /not a PDF/);
  } finally {
    rendererMode = 'pdf';
  }

  // Nothing listens on the discard port: the renderer can't be reached.
  const unreachable = await startTestServer(db, undefined, {
    exportDir: server.config.exportDir,
    gsBin: fakeGs,
    pdfxDefPath: pdfxDef,
    rendererUrl: 'http://127.0.0.1:9/render',
  });
  try {
    const gina = new Client(unreachable.base);
    await gina.post('/api/auth/login', { email: 'alice@example.com', password: 'correct horse battery' });
    const job = await waitForJob(
      gina,
      ((await gina.post('/api/jobs/pdfx', { exportId: alicePrintId })).body.job as JobView).id,
    );
    assert.equal(job.status, 'failed');
    assert.equal(job.result!.tool, 'html-to-pdf');
    assert.match(String(job.result!.error), /could not be reached \(RENDERER_URL="http:\/\/127\.0\.0\.1:9\/render"/);
  } finally {
    await unreachable.close();
  }
});

test('a leftover HTML_PDF_BIN is never used: rendition reports not configured and says why', () => {
  const config = loadConfig({ HTML_PDF_BIN: '/usr/bin/chromium' } as NodeJS.ProcessEnv);
  assert.equal(config.rendererUrl, null);
  const problem = pdfRenderProblem(config);
  assert.ok(problem);
  assert.match(problem, /RENDERER_URL is not set/);
  assert.match(problem, /HTML_PDF_BIN is set but no longer used/);
  assert.match(pdfRenderProblem({ ...config, rendererUrl: 'file:///etc/passwd' })!, /not an http\(s\) URL/);
  assert.equal(pdfRenderProblem({ ...config, rendererUrl: 'http://renderer:3100/render' }), null);
});

test('job limits config: JVM heap and admission caps default sanely and reject junk', () => {
  const defaults = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(defaults.javaMaxHeap, '512m');
  assert.equal(defaults.jobMaxActivePerUser, 2);
  assert.equal(defaults.jobMaxQueued, 20);
  assert.equal(defaults.jobTimeoutMs, 120_000);
  assert.equal(defaults.pdfxTimeoutMs, 900_000);
  assert.equal(loadConfig({ PDFX_TIMEOUT_MS: '1800000' } as NodeJS.ProcessEnv).pdfxTimeoutMs, 1_800_000);
  assert.equal(loadConfig({ PDFX_TIMEOUT_MS: 'soon' } as NodeJS.ProcessEnv).pdfxTimeoutMs, 900_000);
  const set = loadConfig({
    JAVA_MAX_HEAP: '1g',
    JOB_MAX_ACTIVE_PER_USER: '3',
    JOB_MAX_QUEUED: '50',
  } as NodeJS.ProcessEnv);
  assert.equal(set.javaMaxHeap, '1g');
  assert.equal(set.jobMaxActivePerUser, 3);
  assert.equal(set.jobMaxQueued, 50);
  // A heap value that could smuggle another JVM flag is refused.
  const junk = loadConfig({
    JAVA_MAX_HEAP: '512m -XX:+Foo',
    JOB_MAX_ACTIVE_PER_USER: '0',
    JOB_MAX_QUEUED: 'lots',
  } as NodeJS.ProcessEnv);
  assert.equal(junk.javaMaxHeap, '512m');
  assert.equal(junk.jobMaxActivePerUser, 2);
  assert.equal(junk.jobMaxQueued, 20);
});

test('Ghostscript runs under -dSAFER, permitted to read only the ICC profile the PDF/X definition embeds', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-pdfxdef-'));
  const def = path.join(dir, 'PDFX_def.ps');
  writeFileSync(def, '%!PS\n/BeukICCPath (/usr/share/color/icc/test/FOGRA39L.icc) def\n');
  const args = ghostscriptPdfxArgs(testConfig({ pdfxDefPath: def }), '/w/in.pdf', '/w/out.pdf');
  assert.equal(args[0], '-dSAFER');
  assert.ok(args.includes('--permit-file-read=/usr/share/color/icc/test/FOGRA39L.icc'));
  assert.deepEqual(args.slice(-2), [def, '/w/in.pdf']);
  // No BeukICCPath line → SAFER still on, nothing extra permitted.
  writeFileSync(def, '%!PS\n');
  const bare = ghostscriptPdfxArgs(testConfig({ pdfxDefPath: def }), '/w/in.pdf', '/w/out.pdf');
  assert.equal(bare[0], '-dSAFER');
  assert.ok(!bare.some((a) => a.startsWith('--permit-file-read')));
});
