import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

/**
 * M5 jobs, end-to-end through the REAL adapters and child_process —
 * the tools themselves are small shell-script stubs (configured via
 * the same JAVA_BIN / EPUBCHECK_JAR / GS_BIN settings production
 * uses):
 *  - fake "java" writes a canned EPUBCheck JSON report to the path
 *    the adapter names after -j/--json;
 *  - fake "chrome" answers --version and writes a minimal valid PDF
 *    to the --print-to-pdf= target (the HTML → PDF rendition step);
 *  - fake "gs" copies its input file to the -sOutputFile= target.
 * Real EPUBCheck/Ghostscript/Chromium binaries cannot run in this sandbox;
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
let fakeChrome: string;
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
case "$3" in
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
cp "$input" "$out"
exit 0
`,
  );
  chmodSync(fakeGs, 0o755);

  fakeChrome = path.join(dir, 'fake-chrome.sh');
  writeFileSync(
    fakeChrome,
    `#!/bin/sh
# Fake headless Chromium: --version answers; --print-to-pdf=PATH writes a
# minimal valid PDF there. The server asserts the output IS a PDF before
# Ghostscript ever sees it, so the stub's bytes must start with %PDF.
if [ "$1" = "--version" ]; then echo "156.0.8078.47-stub"; exit 0; fi
out=""
for a in "$@"; do
  case "$a" in
    --print-to-pdf=*) out="\${a#--print-to-pdf=}" ;;
  esac
done
if [ -z "$out" ]; then echo "fake-chrome: no --print-to-pdf target" >&2; exit 2; fi
printf '%%PDF-1.4\\n1 0 obj\\n<<>>\\nendobj\\ntrailer\\n<<>>\\n%%%%EOF\\n' > "$out"
exit 0
`,
  );
  chmodSync(fakeChrome, 0o755);

  db = await createTestDb();
  server = await startTestServer(db, undefined, {
    epubcheckJar: stubJar,
    javaBin: fakeJava,
    gsBin: fakeGs,
    htmlPdfBin: fakeChrome,
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
