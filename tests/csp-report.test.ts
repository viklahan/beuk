import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CSP_REPORT_MAX_BYTES, cspReportLine } from '../src/routes/csp-report.js';
import { createTestDb, startTestServer } from './helpers.js';

const legacy = {
  'csp-report': {
    'document-uri': 'https://beuk.example/read/SECRETTOKEN123/chapter?x=1#f',
    referrer: 'https://writer.example/private?email=a@b.c',
    'violated-directive': 'img-src',
    'effective-directive': 'img-src',
    'original-policy': "default-src 'self'",
    disposition: 'enforce',
    'blocked-uri': 'https://evil.example/pixel.gif?user=writer@example.com',
    'line-number': 12,
    'column-number': 4,
    'source-file': 'https://beuk.example/?token=abc',
    'script-sample': 'the writer secret sentence',
    'status-code': 200,
  },
};

const modern = [
  {
    type: 'csp-violation',
    age: 10,
    url: 'https://beuk.example/reset?token=RESETSECRET',
    user_agent: 'Mozilla/5.0 Test',
    body: {
      documentURL: 'https://beuk.example/reset?token=RESETSECRET',
      blockedURL: 'inline',
      effectiveDirective: 'script-src-elem',
      disposition: 'report',
      sample: 'console.log("private")',
      sourceFile: 'https://beuk.example/reset?token=RESETSECRET',
      lineNumber: 3,
      columnNumber: 9,
      statusCode: 200,
    },
  },
  { type: 'deprecation', body: { id: 'x' } },
];

async function post(base: string, body: string, type: string, ip = '203.0.113.9') {
  const res = await fetch(`${base}/api/csp-report`, {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': ip },
    body,
  });
  return res;
}

test('csp report line: legacy + Reporting API formats reduce to a PII-free line', () => {
  const a = cspReportLine(legacy);
  assert.equal(
    a,
    'csp-report disposition=enforce directive=img-src blocked=https://evil.example doc=/read/:token src=/ line=12 col=4',
  );
  const b = cspReportLine(modern[0]);
  assert.equal(
    b,
    'csp-report disposition=report directive=script-src-elem blocked=inline doc=/reset src=/reset line=3 col=9',
  );
  assert.equal(cspReportLine(modern[1]), null, 'non-CSP reports are ignored');
  assert.equal(cspReportLine('nope'), null);
  for (const line of [a, b]) {
    for (const secret of ['SECRETTOKEN', 'RESETSECRET', 'writer@example.com', 'secret sentence', 'private', 'Mozilla', 'pixel', '@b.c']) {
      assert.ok(!line!.includes(secret), `line leaks "${secret}": ${line}`);
    }
  }
  // Hostile values cannot inject extra fields or newlines into the log line.
  const hostile = cspReportLine({
    'csp-report': { 'effective-directive': 'img-src\nFAKE=1', 'blocked-uri': 'x y\nz', 'document-uri': '/a b\n', disposition: 'enforce' },
  });
  assert.ok(hostile && !hostile.includes('\n') && !hostile.includes('FAKE'), String(hostile));
});

test('POST /api/csp-report: logs both formats, 204, stores nothing', async () => {
  const db = await createTestDb();
  const lines: string[] = [];
  const srv = await startTestServer(db, undefined, undefined, undefined, { cspReport: { log: (l) => lines.push(l) } });
  try {
    const before = await db.query<{ n: string }>(
      "select count(*)::text as n from information_schema.tables where table_schema = 'public'",
    );
    let r = await post(srv.base, JSON.stringify(legacy), 'application/csp-report');
    assert.equal(r.status, 204);
    r = await post(srv.base, JSON.stringify(modern), 'application/reports+json');
    assert.equal(r.status, 204);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[0], /^csp-report disposition=enforce directive=img-src blocked=https:\/\/evil\.example /);
    assert.match(lines[1], /directive=script-src-elem blocked=inline doc=\/reset /);
    const after = await db.query<{ n: string }>(
      "select count(*)::text as n from information_schema.tables where table_schema = 'public'",
    );
    assert.equal(after.rows[0].n, before.rows[0].n, 'no table was created for reports');
    // GET is not a report.
    const g = await fetch(`${srv.base}/api/csp-report`);
    assert.equal(g.status, 404);
  } finally {
    await srv.close();
  }
});

test('POST /api/csp-report: bad bodies refused, body cap 413, wrong type 415', async () => {
  const db = await createTestDb();
  const lines: string[] = [];
  const srv = await startTestServer(db, undefined, undefined, undefined, { cspReport: { log: (l) => lines.push(l) } });
  try {
    assert.equal((await post(srv.base, '{not json', 'application/csp-report')).status, 400);
    assert.equal((await post(srv.base, JSON.stringify({ hello: 1 }), 'application/csp-report')).status, 400);
    assert.equal((await post(srv.base, 'x', 'text/plain')).status, 415);
    const big = JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(CSP_REPORT_MAX_BYTES + 10) } });
    assert.equal((await post(srv.base, big, 'application/csp-report')).status, 413);
    // A huge batch is truncated to the per-post cap, not logged in full.
    const small = { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'inline', disposition: 'enforce' } };
    const many = Array.from({ length: 60 }, () => small);
    const batch = JSON.stringify(many);
    assert.ok(batch.length < CSP_REPORT_MAX_BYTES);
    assert.equal((await post(srv.base, batch, 'application/reports+json')).status, 204);
    assert.equal(lines.length, 20);
  } finally {
    await srv.close();
  }
});

test('POST /api/csp-report: per-client rate limit answers 429 + Retry-After', async () => {
  const db = await createTestDb();
  const lines: string[] = [];
  const srv = await startTestServer(db, undefined, undefined, undefined, {
    cspReport: { log: (l) => lines.push(l), burst: 3, refillMs: 60_000 },
  });
  try {
    const body = JSON.stringify(legacy);
    for (let i = 0; i < 3; i++) assert.equal((await post(srv.base, body, 'application/csp-report', '198.51.100.1')).status, 204);
    const refused = await post(srv.base, body, 'application/csp-report', '198.51.100.1');
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('retry-after')) >= 1);
    assert.equal((await post(srv.base, body, 'application/csp-report', '198.51.100.2')).status, 204, 'another client has its own bucket');
    assert.equal(lines.length, 4);
  } finally {
    await srv.close();
  }
});

test('Caddyfile: full CSP is ENFORCED with report-to + report-uri, no report-only policy left', () => {
  const caddy = readFileSync(path.resolve(import.meta.dirname, '..', 'Caddyfile'), 'utf8');
  const m = /header \?Content-Security-Policy "([^"]+)"/.exec(caddy);
  assert.ok(m, 'no enforced Content-Security-Policy header');
  const policy = m[1];
  assert.ok(!/Content-Security-Policy-Report-Only/.test(caddy.replace(/#.*$/gm, '')), 'a report-only policy is still shipped');
  for (const d of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    'report-uri /api/csp-report',
    'report-to csp',
  ]) {
    assert.ok(policy.includes(d), `policy is missing "${d}"`);
  }
  assert.ok(!/script-src[^;]*https:(?!\/\/)/.test(policy), 'script-src must not allow every https host');
  assert.ok(!/'unsafe-eval'/.test(policy), "'unsafe-eval' is not needed");
  assert.match(caddy, /header \?Reporting-Endpoints "csp=\\"\/api\/csp-report\\""/);
});
