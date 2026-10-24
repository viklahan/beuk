// Drives the renderer attack proof through the REAL app API, the way a
// signed-in user would: register, upload print-html exports, run pdfx
// jobs, download the PDFs. Runs in a throwaway node container attached
// to the stack's default network (see deploy/renderer-attack.sh).
//   /fx  — this directory (fixtures), read-only
//   /out — where the downloaded PDFs and a summary JSON are written
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.APP_BASE ?? 'http://app:3000';
let cookie = '';

async function call(method, path, { json, raw, type } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    headers['content-type'] = type ?? 'application/octet-stream';
    body = raw;
  }
  const res = await fetch(BASE + path, { method, headers, body });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookie) cookie = sc.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let parsed = null;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    /* binary */
  }
  return { status: res.status, json: parsed, bytes: buf };
}

async function waitJob(id) {
  const deadline = Date.now() + 240_000;
  for (;;) {
    const r = await call('GET', `/api/jobs/${id}`);
    const job = r.json?.job;
    if (job && (job.status === 'done' || job.status === 'failed')) return job;
    if (Date.now() > deadline) throw new Error(`job ${id} never finished`);
    await new Promise((res) => setTimeout(res, 500));
  }
}

const summary = {};
const email = `attack-${Date.now()}@example.com`;
const reg = await call('POST', '/api/auth/register', { json: { email, password: 'attack-fixture-pass' } });
if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.json)}`);
const ms = await call('POST', '/api/manuscripts', {
  json: { doc: { title: 'Attack Host', sections: { frontMatter: [], body: [], backMatter: [] } } },
});
const manuscriptId = ms.json.manuscript.id;

async function upload(format, filename, bytes) {
  const r = await call('POST', `/api/exports?manuscriptId=${manuscriptId}&format=${format}&filename=${filename}`, {
    raw: bytes,
  });
  if (r.status !== 201) throw new Error(`upload ${filename} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.export.id;
}

async function pdfx(name, file) {
  const exportId = await upload('print-html', `${name}.html`, readFileSync(file));
  const created = await call('POST', '/api/jobs/pdfx', { json: { exportId } });
  if (created.status !== 201) throw new Error(`pdfx ${name}: ${created.status} ${JSON.stringify(created.json)}`);
  const job = await waitJob(created.json.job.id);
  summary[name] = { status: job.status, result: job.result };
  if (job.status === 'done') {
    const dl = await call('GET', `/api/exports/${job.artifactExportId}/download`);
    writeFileSync(`/out/${name}.pdf`, dl.bytes);
    summary[name].downloadedBytes = dl.bytes.length;
    writeFileSync(`/out/${name}.renderedbytes`, String(job.result.renderedPdfBytes));
  }
  console.log(`${name}: ${job.status}`, JSON.stringify(job.result).slice(0, 400));
}

await pdfx('attack', '/fx/attack-print.html');
await pdfx('legit', '/fx/legit-print.html');
// Optional: a real studio print interior (e.g. the bundled sample's
// buildPrintHtml() output) mounted at /extra/studio-print.html.
if (existsSync('/extra/studio-print.html')) await pdfx('studio', '/extra/studio-print.html');

// EPUBCheck with the real JVM (-Xmx cap): a junk "epub" must come back
// as a done job whose report says it did NOT pass.
const junk = await upload('epub', 'junk.epub', Buffer.from('PK\x03\x04 not really an epub'));
const ec = await call('POST', '/api/jobs/epubcheck', { json: { exportId: junk } });
const ecJob = await waitJob(ec.json.job.id);
summary.epubcheck = {
  status: ecJob.status,
  passed: ecJob.result?.passed,
  toolVersion: ecJob.result?.toolVersion,
  counts: ecJob.result?.counts,
  error: ecJob.result?.error,
};
console.log('epubcheck:', JSON.stringify(summary.epubcheck));

// Admission cap against real Postgres: two active jobs allowed, the third is 429.
const capCodes = [];
for (let i = 0; i < 3; i++) {
  capCodes.push((await call('POST', '/api/jobs/epubcheck', { json: { exportId: junk } })).status);
}
summary.capCodes = capCodes;
console.log('admission cap statuses (3 rapid jobs):', capCodes.join(','));
const list = await call('GET', '/api/jobs');
for (const j of list.json.jobs) if (j.status === 'queued' || j.status === 'running') await waitJob(j.id);

writeFileSync('/out/summary.json', JSON.stringify(summary, null, 2));
