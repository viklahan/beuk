import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { HousekeepingLock } from '../src/housekeeping/lock.js';
import {
  Client,
  createPgliteScratchFactory,
  createTestDb,
  httpBootCheck,
  registerUser,
  startTestServer,
  testConfig,
  type TestServer,
} from './helpers.js';
import type { Db } from '../src/db.js';
import { listAdmins, setAdmin } from '../src/housekeeping/admin.js';

const ADMIN = 'admin@example.com';
const CANARY = 'sk_live_CANARY_9f8e7d6c5b4a';

interface Setup {
  db: Db;
  server: TestServer;
  admin: Client;
  alice: Client;
  anon: Client;
}

async function setup(
  overrides: Parameters<typeof testConfig>[0] = {},
  housekeeping?: Parameters<typeof startTestServer>[3],
): Promise<Setup> {
  const db = await createTestDb();
  const server = await startTestServer(
    db,
    undefined,
    overrides,
    housekeeping,
  );
  const admin = new Client(server.base);
  const alice = new Client(server.base);
  const anon = new Client(server.base);
  await registerUser(admin, ADMIN);
  await registerUser(alice, 'alice@example.com');
  assert.equal(await setAdmin(db, ADMIN, true), 'granted');
  return { db, server, admin, alice, anon };
}

const HOUSEKEEPING_ROUTES: [string, string, unknown?][] = [
  ['GET', '/api/housekeeping/actions'],
  ['GET', '/api/housekeeping/reference/architecture'],
  ['GET', '/api/housekeeping/reference/roadmap'],
  ['GET', '/api/housekeeping/self-checks/runs'],
  ['GET', '/api/housekeeping/backups'],
  ['GET', '/api/housekeeping/audit'],
  ['GET', '/api/housekeeping/nope'],
  ['POST', '/api/housekeeping/self-checks/run'],
  ['POST', '/api/housekeeping/backups', {}],
  ['POST', '/api/housekeeping/restore/preview', { name: 'x' }],
  ['POST', '/api/housekeeping/restore', { name: 'x', previewId: 'x', confirmed: true }],
  ['GET', '/api/housekeeping/offsite'],
  ['POST', '/api/housekeeping/offsite/run'],
  ['POST', '/api/housekeeping/offsite/drill'],
  ['POST', '/api/housekeeping/rehearse'],
  ['POST', '/api/housekeeping/promote/sign-off', {}],
  ['POST', '/api/housekeeping/promote'],
];

test('the surface is invisible: anonymous and non-admin callers get 404 on every housekeeping route', async () => {
  const { server, alice, anon } = await setup();
  try {
    for (const [method, route, body] of HOUSEKEEPING_ROUTES) {
      for (const [label, client] of [
        ['anonymous', anon],
        ['non-admin', alice],
      ] as const) {
        const res = await client.request(method, route, body);
        assert.equal(res.status, 404, `${label} ${method} ${route} → ${res.status}`);
        assert.deepEqual(res.body, { error: 'not found' });
      }
    }
  } finally {
    await server.close();
  }
});

test('admin gate: a CLI-granted account (is_admin) can read the Reference pillar', async () => {
  const { db, server, admin } = await setup();
  try {
    const flag = await db.query<{ is_admin: boolean }>(
      'select is_admin from users where email = $1',
      [ADMIN],
    );
    assert.equal(flag.rows[0].is_admin, true);

    const architecture = await admin.get('/api/housekeeping/reference/architecture');
    assert.equal(architecture.status, 200);
    const arch = architecture.body.architecture as { title: string; content: string };
    assert.match(arch.content, /Housekeeping/);
    assert.match(arch.content, /src\/housekeeping\//);

    const roadmap = await admin.get('/api/housekeeping/reference/roadmap');
    assert.equal(roadmap.status, 200);
    assert.match((roadmap.body.roadmap as { content: string }).content, /M3/);

    const catalog = await admin.get('/api/housekeeping/actions');
    assert.equal(catalog.status, 200);
    const registry = catalog.body.registry as { cases: number; server: number; clientOnly: number };
    assert.equal(registry.server + registry.clientOnly, registry.cases);
  } finally {
    await server.close();
  }
});

interface CaseResultShape {
  id: string;
  status: string;
  detail: string;
}

test('self-checks: a healthy system passes, client-only cases are reported (never faked), the run is stored', async () => {
  const { server, admin, alice } = await setup();
  try {
    // One healthy export in the archive for the data invariants.
    const manuscript = await alice.post('/api/manuscripts', {
      doc: { title: 'Checked Book', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    const manuscriptId = (manuscript.body.manuscript as { id: string }).id;
    const saved = await alice.upload(
      `/api/exports?manuscriptId=${manuscriptId}&format=epub&filename=checked.epub`,
      Buffer.from('PK\x03\x04 healthy export bytes'),
    );
    assert.equal(saved.status, 201);

    const runRes = await admin.post('/api/housekeeping/self-checks/run');
    assert.equal(runRes.status, 200);
    const run = runRes.body.run as {
      id: string;
      buildStamp: string;
      overall: string;
      counts: { pass: number; fail: number; clientOnly: number };
      results: CaseResultShape[];
    };
    assert.equal(run.buildStamp, 'test-build-1');
    assert.equal(run.overall, 'pass');
    assert.equal(run.counts.fail, 0);
    assert.ok(run.counts.pass > 0);
    assert.ok(run.counts.clientOnly > 0, 'client-only cases must be reported, not dropped');

    const byId = new Map(run.results.map((r) => [r.id, r]));
    // Executable cases actually ran and passed.
    for (const id of [
      'infra.db.reachable',
      'infra.migrations.current',
      'infra.exports.writable',
      'infra.deploy.warmth-assets',
      'data.exports.no-orphan-files',
      'data.exports.sha256-reverify',
      'data.streak.ledger-consistent',
      'HK-F1-01',
      'HK-F1-03',
      'HK-F2-05',
      'HK-F3-01',
      'HK-F3-03',
      'boxset.structure.dividers-titlepages-spine',
      'docx.content.headings-scenebreak-endnotes',
      'validator.clean-book.no-errors',
      'validator.catches.missing-file',
      'validator.catches.malformed-xml',
      'validator.catches.dangling-anchor',
      'validator.catches.missing-alt',
      'validator.catches.undeclared-cover',
      'jobs.pdfx.inspection-reads-facts',
      'jobs.pdfx.safer-permits-icc',
      'jobs.pdfx.icc-profile-matches-def',
      'jobs.pdfx.converts-through-press-profile',
      'jobs.pdfx.neutral-text-black-plate',
    ]) {
      assert.equal(byId.get(id)?.status, 'pass', `${id}: ${byId.get(id)?.detail}`);
    }
    // Client-only cases are registered with a reason, not a pass.
    for (const id of ['HK-F1-06', 'HK-F2-07', 'bookid.v5.rfc-vector', 'bookid.migrate.legacy-book', 'bookid.migrate.idempotent', 'bookid.match.legacy-and-new', 'bookid.sample.stays-sample', 'fonts.each.reaches-export-css', 'themes.apply.then-overridable', 'print.trims.page-dimensions', 'store.verdict.never-green-unchecked', 'store.dpi.sample-fails-honestly', 'store.trim.paper-matrix', 'import.report.txt-records-and-undo', 'import.report.docx-honest', 'import.report.images-accounted', 'import.report.persists-with-book', 'epub.props.detect-from-content', 'epub.props.sample-declared-exactly', 'epub.props.recomputed-not-trusted', 'epub.spine.nav-links-reach-spine', 'validator.catches.undeclared-svg-and-off-spine-link', 'epub.identifier.real-uuid', 'dictation.language-picker', 'dictation.language-suggest', 'readaloud.section-language', 'print.press.solid-tints', 'print.press.blend-math', 'print.press.store-rows', 'zen.sound.files-decode', 'zen.sound.buffer-loop']) {
      const result = byId.get(id);
      assert.equal(result?.status, 'client-only', id);
      assert.ok((result?.detail ?? '').length > 10, `${id} must carry a one-line reason`);
    }

    // The run is stored and listed under the build stamp.
    const runs = await admin.get('/api/housekeeping/self-checks/runs');
    const listed = runs.body.runs as { id: string; build_stamp: string; overall: string }[];
    assert.ok(listed.some((r) => r.id === run.id && r.build_stamp === 'test-build-1' && r.overall === 'pass'));

    // And the action wrote an audit row.
    const audit = await admin.get('/api/housekeeping/audit');
    const rows = audit.body.audit as { action: string; result: string; actor_email: string }[];
    assert.ok(rows.some((r) => r.action === 'self-checks.run' && r.result === 'pass' && r.actor_email === ADMIN));
  } finally {
    await server.close();
  }
});

test('self-checks fail loudly when an archived export file is corrupted on disk', async () => {
  const { server, admin, alice } = await setup();
  try {
    const manuscript = await alice.post('/api/manuscripts', {
      doc: { title: 'Fragile Book', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    const manuscriptId = (manuscript.body.manuscript as { id: string }).id;
    const saved = await alice.upload(
      `/api/exports?manuscriptId=${manuscriptId}&format=epub&filename=fragile.epub`,
      Buffer.from('PK\x03\x04 pristine bytes'),
    );
    const meta = saved.body.export as { id: string };
    const aliceId = (await alice.get('/api/auth/me')).body.user as { id: string };
    const file = path.join(server.config.exportDir, aliceId.id, meta.id);
    await appendFile(file, 'tampered');

    const runRes = await admin.post('/api/housekeeping/self-checks/run');
    const run = runRes.body.run as { overall: string; results: CaseResultShape[] };
    assert.equal(run.overall, 'fail');
    const sha = run.results.find((r) => r.id === 'data.exports.sha256-reverify');
    assert.equal(sha?.status, 'fail');
    assert.match(sha?.detail ?? '', /sha256 mismatch|corrupt/i);
  } finally {
    await server.close();
  }
});

test('the lock: a second mutating action while one holds the lock gets 409', async () => {
  const lock = new HousekeepingLock();
  const { server, admin } = await setup({}, { lock });
  try {
    assert.equal(lock.tryAcquire('test-held-action'), true);
    const conflicted = await admin.post('/api/housekeeping/backups', {});
    assert.equal(conflicted.status, 409);
    assert.equal(conflicted.body.error, 'another housekeeping action is running');
    lock.release();
    const ok = await admin.post('/api/housekeeping/backups', {});
    assert.equal(ok.status, 201);
  } finally {
    await server.close();
  }
});

test('backup: secrets are excluded by name and the canary appears in NO housekeeping output', async () => {
  const { server, admin } = await setup({ stripeSecretKey: CANARY });
  try {
    const created = await admin.post('/api/housekeeping/backups', { name: 'canary-check' });
    assert.equal(created.status, 201);
    const manifest = created.body.backup as {
      name: string;
      tables: Record<string, number>;
      excluded: string[];
    };
    assert.equal(manifest.name, 'canary-check');
    assert.ok((manifest.tables.users ?? 0) >= 2);
    assert.ok(manifest.excluded.some((line) => line.includes('STRIPE_SECRET_KEY')));

    // No output channel carries the canary: the API responses…
    for (const payload of [
      JSON.stringify(created.body),
      JSON.stringify((await admin.get('/api/housekeeping/backups')).body),
      JSON.stringify((await admin.get('/api/housekeeping/backups/canary-check')).body),
      JSON.stringify((await admin.get('/api/housekeeping/audit')).body),
      JSON.stringify((await admin.post('/api/housekeeping/self-checks/run')).body),
    ]) {
      assert.ok(!payload.includes(CANARY), 'canary leaked into an API response');
    }
    // …nor the files on disk (manifest + settings).
    const dir = path.join(server.config.backupDir, 'canary-check');
    const manifestOnDisk = await readFile(path.join(dir, 'manifest.json'), 'utf8');
    const settingsOnDisk = await readFile(path.join(dir, 'settings.json'), 'utf8');
    const dbOnDisk = await readFile(path.join(dir, 'db.json'), 'utf8');
    assert.ok(!manifestOnDisk.includes(CANARY), 'canary leaked into the backup manifest');
    assert.ok(!settingsOnDisk.includes(CANARY), 'canary leaked into backup settings');
    assert.ok(!dbOnDisk.includes(CANARY), 'canary leaked into the backup dump');
    const settings = JSON.parse(settingsOnDisk) as { excludedSecrets: string[] };
    assert.ok(settings.excludedSecrets.includes('STRIPE_SECRET_KEY'));
    assert.ok(settings.excludedSecrets.includes('DATABASE_URL'));
  } finally {
    await server.close();
  }
});

test('restore is refused while RESTORE_ENABLED is off, and nothing is touched', async () => {
  const { server, admin } = await setup({ restoreEnabled: false });
  try {
    const first = await admin.post('/api/manuscripts', {
      doc: { title: 'Kept Book', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    assert.equal(first.status, 201);
    assert.equal((await admin.post('/api/housekeeping/backups', { name: 'snapoff' })).status, 201);
    const preview = await admin.post('/api/housekeeping/restore/preview', { name: 'snapoff' });
    assert.equal(preview.status, 200);
    const refused = await admin.post('/api/housekeeping/restore', {
      name: 'snapoff', previewId: preview.body.previewId, confirmed: true,
    });
    assert.equal(refused.status, 503);
    assert.match(String(refused.body.error), /restore is turned off/);
    const after = await admin.get('/api/manuscripts');
    assert.equal((after.body.manuscripts as unknown[]).length, 1);
  } finally {
    await server.close();
  }
});

test('restore: preview → confirm restores the data, refuses without confirmation, snapshots first', async () => {
  const { server, admin } = await setup({ restoreEnabled: true });
  try {
    const first = await admin.post('/api/manuscripts', {
      doc: { title: 'First Book', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    assert.equal(first.status, 201);

    const backup = await admin.post('/api/housekeeping/backups', { name: 'snap1' });
    assert.equal(backup.status, 201);

    await admin.post('/api/manuscripts', {
      doc: { title: 'Second Book', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    const before = await admin.get('/api/manuscripts');
    assert.equal((before.body.manuscripts as unknown[]).length, 2);

    const preview = await admin.post('/api/housekeeping/restore/preview', { name: 'snap1' });
    assert.equal(preview.status, 200);
    const previewId = preview.body.previewId as string;
    const diff = preview.body.diff as { tables: { table: string; backupRows: number; currentRows: number }[] };
    const manuscriptsDiff = diff.tables.find((t) => t.table === 'manuscripts');
    assert.equal(manuscriptsDiff?.backupRows, 1);
    assert.equal(manuscriptsDiff?.currentRows, 2);

    // No confirmation → refused, and the preview is not consumed.
    const unconfirmed = await admin.post('/api/housekeeping/restore', { name: 'snap1', previewId });
    assert.equal(unconfirmed.status, 400);
    // Wrong preview → refused.
    const wrongPreview = await admin.post('/api/housekeeping/restore', {
      name: 'snap1',
      previewId: 'deadbeefdeadbeefdeadbeef',
      confirmed: true,
    });
    assert.equal(wrongPreview.status, 400);

    const restored = await admin.post('/api/housekeeping/restore', {
      name: 'snap1',
      previewId,
      confirmed: true,
    });
    assert.equal(restored.status, 200);
    const restoredBody = restored.body.restored as {
      restoredFrom: string;
      snapshot: string;
      tablesRestored: Record<string, number>;
    };
    assert.equal(restoredBody.restoredFrom, 'snap1');
    assert.match(restoredBody.snapshot, /^pre-restore-/);
    assert.equal(restoredBody.tablesRestored.manuscripts, 1);
    const verification = restored.body.verification as { overall: string };
    assert.equal(verification.overall, 'pass');

    // The session survived (it was in the backup) and the second book is gone.
    const afterRes = await admin.get('/api/manuscripts');
    const manuscripts = afterRes.body.manuscripts as { title: string }[];
    assert.equal(manuscripts.length, 1);
    assert.equal(manuscripts[0].title, 'First Book');

    // The pre-restore snapshot exists as its own backup.
    const backups = await admin.get('/api/housekeeping/backups');
    const names = (backups.body.backups as { name: string }[]).map((b) => b.name);
    assert.ok(names.includes('snap1'));
    assert.ok(names.some((n) => n.startsWith('pre-restore-')));

    // Audit shows the whole flow.
    const audit = await admin.get('/api/housekeeping/audit');
    const actions = (audit.body.audit as { action: string; result: string }[]).map(
      (r) => `${r.action}:${r.result}`,
    );
    assert.ok(actions.includes('restore.preview:preview'));
    assert.ok(actions.includes('restore.execute:refused'));
    assert.ok(actions.includes('restore.execute:restored'));
  } finally {
    await server.close();
  }
});

test('rehearse: migrations + boot check run against a scratch database; production data untouched', async () => {
  const db = await createTestDb();
  const server = await startTestServer(
    db,
    undefined,
    {},
    { scratchFactory: createPgliteScratchFactory(), bootCheck: httpBootCheck(testConfig()) },
  );
  const admin = new Client(server.base);
  await registerUser(admin, ADMIN);
  await setAdmin(db, ADMIN, true);
  try {
    const usersBefore = await db.query<{ c: unknown }>('select count(*) as c from users');
    const res = await admin.post('/api/housekeeping/rehearse');
    assert.equal(res.status, 200);
    const rehearse = res.body.rehearse as {
      pass: boolean;
      migrationsApplied: string[];
      boot: { ok: boolean };
    };
    assert.equal(rehearse.pass, true);
    assert.equal(rehearse.boot.ok, true);
    assert.ok(rehearse.migrationsApplied.some((name) => name.startsWith('006')));
    const usersAfter = await db.query<{ c: unknown }>('select count(*) as c from users');
    assert.equal(Number(usersAfter.rows[0].c), Number(usersBefore.rows[0].c));
  } finally {
    await server.close();
  }
});

test('promotion gate: refuses without a clean tree even with checks + sign-off, and says why', async () => {
  const { server, admin } = await setup({ treeClean: false });
  try {
    const refused = await admin.post('/api/housekeeping/promote');
    assert.equal(refused.status, 409);
    const body = refused.body as { promoted: boolean; reasons: string[] };
    assert.equal(body.promoted, false);
    assert.ok(body.reasons.some((r) => /clean/i.test(r)));
    assert.ok(body.reasons.some((r) => /self-check/i.test(r)));
    assert.ok(body.reasons.some((r) => /sign-off/i.test(r)));

    await admin.post('/api/housekeeping/self-checks/run');
    await admin.post('/api/housekeeping/promote/sign-off', { note: 'looks good' });
    const stillRefused = await admin.post('/api/housekeeping/promote');
    assert.equal(stillRefused.status, 409);
    const reasons = (stillRefused.body as { reasons: string[] }).reasons;
    assert.deepEqual(reasons.length, 1);
    assert.match(reasons[0], /clean/i);

    const audit = await admin.get('/api/housekeeping/audit');
    const rows = audit.body.audit as { action: string; result: string }[];
    assert.ok(rows.some((r) => r.action === 'promote.execute' && r.result === 'refused'));
    assert.ok(rows.some((r) => r.action === 'promote.sign-off' && r.result === 'signed-off'));
  } finally {
    await server.close();
  }
});

test('promotion gate: refuses without checks, then without sign-off, then succeeds and writes a scrubbed manifest', async () => {
  const { server, admin } = await setup({ treeClean: true, stripeSecretKey: CANARY });
  try {
    const noChecks = await admin.post('/api/housekeeping/promote');
    assert.equal(noChecks.status, 409);
    assert.ok(
      (noChecks.body as { reasons: string[] }).reasons.some((r) => /self-check/i.test(r)),
    );

    await admin.post('/api/housekeeping/self-checks/run');
    const noSignOff = await admin.post('/api/housekeeping/promote');
    assert.equal(noSignOff.status, 409);
    assert.ok(
      (noSignOff.body as { reasons: string[] }).reasons.some((r) => /sign-off/i.test(r)),
    );

    await admin.post('/api/housekeeping/promote/sign-off', { note: 'ship it' });
    const promoted = await admin.post('/api/housekeeping/promote');
    assert.equal(promoted.status, 200);
    const body = promoted.body as {
      promoted: boolean;
      manifest: { buildStamp: string; promotedBy: string };
    };
    assert.equal(body.promoted, true);
    assert.equal(body.manifest.buildStamp, 'test-build-1');
    assert.equal(body.manifest.promotedBy, ADMIN);

    const onDisk = await readFile(server.config.promotionManifestPath, 'utf8');
    assert.match(onDisk, /test-build-1/);
    assert.ok(!onDisk.includes(CANARY), 'canary leaked into PROMOTION_MANIFEST.json');
    assert.ok(!JSON.stringify(promoted.body).includes(CANARY));

    const audit = await admin.get('/api/housekeeping/audit');
    const rows = audit.body.audit as { action: string; result: string }[];
    assert.ok(rows.some((r) => r.action === 'promote.execute' && r.result === 'promoted'));
  } finally {
    await server.close();
  }
});

test('admin is never granted over HTTP: registering or logging in confers nothing', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  const claimant = new Client(server.base);
  try {
    // Whatever email someone registers, they are an ordinary user.
    assert.equal((await registerUser(claimant, ADMIN)).status, 201);
    assert.equal((await claimant.get('/api/housekeeping/actions')).status, 404);
    assert.equal((await claimant.post('/api/auth/login', { email: ADMIN, password: 'correct horse battery' })).status, 200);
    assert.equal((await claimant.get('/api/housekeeping/actions')).status, 404);
    const flag = await db.query<{ is_admin: boolean }>('select is_admin from users where email = $1', [ADMIN]);
    assert.equal(flag.rows[0].is_admin, false);
  } finally {
    await server.close();
  }
});

test('admin CLI core: grant/revoke an existing account, audited; unknown email refused; revoke is immediate', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  const admin = new Client(server.base);
  try {
    assert.equal(await setAdmin(db, 'nobody@example.com', true), 'no such user');
    await registerUser(admin, ADMIN);
    assert.equal(await setAdmin(db, ` ${ADMIN.toUpperCase()} `, true), 'granted');
    assert.equal(await setAdmin(db, ADMIN, true), 'unchanged');
    assert.deepEqual(await listAdmins(db), [ADMIN]);
    assert.equal((await admin.get('/api/housekeeping/actions')).status, 200);

    // Same live session, flag revoked: the very next request is denied.
    assert.equal(await setAdmin(db, ADMIN, false), 'revoked');
    assert.equal((await admin.get('/api/housekeeping/actions')).status, 404);
    assert.deepEqual(await listAdmins(db), []);

    const audit = await db.query<{ action: string; result: string }>(
      "select action, result from housekeeping_audit where actor_email = 'admin-cli' order by created_at",
    );
    assert.deepEqual(
      audit.rows.map((row) => `${row.action}:${row.result}`),
      ['admin.grant:granted', 'admin.revoke:revoked'],
    );
  } finally {
    await server.close();
  }
});
