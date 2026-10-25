import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Client,
  createTestDb,
  registerUser,
  startTestServer,
  type TestServer,
} from './helpers.js';
import type { Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';

const KOFI = 'https://ko-fi.com/testmaker';
const CANARY = 'sk_live_CANARY_9f8e7d6c5b4a';

interface Setup {
  db: Db;
  server: TestServer;
}

async function setup(overrides: Parameters<typeof startTestServer>[2] = {}): Promise<Setup> {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, overrides);
  return { db, server };
}

/** Fetch a page as raw text (the JSON Client doesn't speak HTML). */
async function getPage(base: string, pathName: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${base}${pathName}`);
  return { status: res.status, html: await res.text() };
}

test('help reading room: index, guides, decoder and thanks all serve 200', async () => {
  const { server } = await setup();
  try {
    const pages = [
      '/help/',
      '/help/import-a-manuscript.html',
      '/help/typeset-a-chapter.html',
      '/help/add-a-cover.html',
      '/help/footnotes-and-images.html',
      '/help/platform-presets.html',
      '/help/box-sets.html',
      '/help/print-interiors.html',
      '/help/check-your-book.html',
      '/help/exports-and-archive.html',
      '/help/your-streak.html',
      '/help/epub-error-decoder.html',
      '/thanks',
    ];
    for (const page of pages) {
      const { status, html } = await getPage(server.base, page);
      assert.equal(status, 200, `${page} should serve 200`);
      assert.match(html, /beuk/i, `${page} should carry the wordmark`);
    }
    const css = await getPage(server.base, '/help/warmth.css');
    assert.equal(css.status, 200);
    // The decoder decodes real messages.
    const decoder = await getPage(server.base, '/help/epub-error-decoder.html');
    assert.match(decoder.html, /RSC-005/);
    assert.match(decoder.html, /mimetype/);
    // Unknown guide names fall through to 404, never a directory escape.
    const missing = await getPage(server.base, '/help/no-such-guide.html');
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test('support block: the Help index carries the configured human + promise', async () => {
  const { server } = await setup();
  try {
    const { html } = await getPage(server.base, '/help/');
    assert.match(html, /shelf@example\.com/);
    assert.match(html, /The Test Shelf-Keeper/);
    assert.match(html, /a human replies within two working days/);
    assert.match(html, /id="status-line"/);
  } finally {
    await server.close();
  }
});

test('tip jar: rendered only when KOFI_URL is configured', async () => {
  const withJar = await setup({ kofiUrl: KOFI });
  try {
    for (const page of ['/help/', '/help/add-a-cover.html', '/thanks', '/changelog']) {
      const { status, html } = await getPage(withJar.server.base, page);
      assert.equal(status, 200, page);
      assert.match(html, /ko-fi\.com\/testmaker/, `${page} should link the jar`);
      assert.match(html, /Support the maker/, `${page} should frame it as support`);
      assert.doesNotMatch(html, /donation/i, `${page} must never say "donation"`);
    }
  } finally {
    await withJar.server.close();
  }

  const withoutJar = await setup();
  try {
    for (const page of ['/help/', '/thanks', '/changelog', '/roadmap']) {
      const { status, html } = await getPage(withoutJar.server.base, page);
      assert.equal(status, 200, page);
      // No jar block and no Ko-fi link anywhere. (The changelog/roadmap
      // prose may NAME the service — that's content, not a jar.)
      assert.doesNotMatch(html, /kofi-jar/, `${page} must have no jar while KOFI_URL is unset`);
      assert.doesNotMatch(html, /ko-fi\.com/, `${page} must link no jar while KOFI_URL is unset`);
      assert.doesNotMatch(html, /donation/i);
    }
    const helpIndex = await getPage(withoutJar.server.base, '/help/');
    assert.doesNotMatch(helpIndex.html, /ko-fi/i);
    // The public config says the same thing the pages do.
    const client = new Client(withoutJar.server.base);
    const pub = await client.get('/api/config/public');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.kofiUrl, null);
    assert.equal((pub.body.support as { email: string }).email, 'shelf@example.com');
  } finally {
    await withoutJar.server.close();
  }
});

test('/api/status: shape, self-check summary, and secret scrub', async () => {
  const { db, server } = await setup({ stripeSecretKey: CANARY });
  try {
    const client = new Client(server.base);
    const before = await client.get('/api/status');
    assert.equal(before.status, 200);
    assert.equal(before.body.app, 'Beuk');
    assert.equal(before.body.version, '0.1.0');
    assert.equal(before.body.build, 'test-build-1');
    assert.equal(before.body.ok, true);
    assert.deepEqual(before.body.health, { db: 'up' });
    assert.equal(before.body.selfChecks, null);
    assert.ok(!JSON.stringify(before.body).includes(CANARY), 'canary must not leak');

    // A stored self-check run shows up, summarised and scrubbed.
    await db.query(
      `insert into housekeeping_check_runs
         (build_stamp, started_at, finished_at, overall, pass_count, fail_count, client_only_count, results)
       values ('test-build-1', now(), now(), 'pass', 28, 0, 20, '[]')`,
    );
    const after = await client.get('/api/status');
    const checks = after.body.selfChecks as {
      overall: string;
      passed: number;
      failed: number;
      at: string;
    };
    assert.equal(checks.overall, 'pass');
    assert.equal(checks.passed, 28);
    assert.equal(checks.failed, 0);
    assert.ok(checks.at);
    assert.ok(!JSON.stringify(after.body).includes(CANARY));
  } finally {
    await server.close();
  }
});

test('changelog and roadmap pages render their seeded sources', async () => {
  const { server } = await setup();
  try {
    const changelog = await getPage(server.base, '/changelog');
    assert.equal(changelog.status, 200);
    assert.match(changelog.html, /Box sets and a Word export/);
    assert.match(changelog.html, /For writers whose books arrived at/);
    assert.match(changelog.html, /structural validator/i);

    const roadmap = await getPage(server.base, '/roadmap');
    assert.equal(roadmap.status, 200);
    assert.match(roadmap.html, /Now/);
    assert.match(roadmap.html, /Next/);
    assert.match(roadmap.html, /Later/);
    assert.match(roadmap.html, /M5/);
  } finally {
    await server.close();
  }
});

test("founders' shelf: apply, validate, throttle, and admin-only listing", async () => {
  const { db, server } = await setup();
  try {
    const anon = new Client(server.base);
    const admin = new Client(server.base);
    const alice = new Client(server.base);
    await registerUser(admin, 'admin@example.com');
    await setAdmin(db, 'admin@example.com', true);
    await registerUser(alice, 'alice@example.com');

    // Validation first (cheap rejections).
    const badEmail = await anon.post('/api/founders/apply', {
      name: 'Jo',
      email: 'not-an-email',
      about: 'Novels',
    });
    assert.equal(badEmail.status, 400);
    const noAbout = await anon.post('/api/founders/apply', {
      name: 'Jo',
      email: 'jo@example.com',
      about: '  ',
    });
    assert.equal(noAbout.status, 400);

    // Happy path.
    const applied = await anon.post('/api/founders/apply', {
      name: 'Jo March',
      email: 'jo@example.com',
      about: 'A novel about sisters, mostly',
    });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.ok, true);

    // The listing is Housekeeping-only: 404 for anon and non-admin alike.
    assert.equal((await anon.get('/api/housekeeping/founders')).status, 404);
    assert.equal((await alice.get('/api/housekeeping/founders')).status, 404);
    const list = await admin.get('/api/housekeeping/founders');
    assert.equal(list.status, 200);
    const applications = list.body.applications as { name: string; about: string }[];
    assert.equal(applications.length, 1);
    assert.equal(applications[0].name, 'Jo March');
    assert.equal(applications[0].about, 'A novel about sisters, mostly');

    // …and the read is audited like every other Housekeeping action.
    const audit = await admin.get('/api/housekeeping/audit');
    const actions = (audit.body.audit as { action: string }[]).map((row) => row.action);
    assert.ok(actions.includes('founders.list'));
  } finally {
    await server.close();
  }
});

test("founders' shelf: the per-IP throttle answers 429 when flooded", async () => {
  const { server } = await setup();
  try {
    const anon = new Client(server.base);
    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await anon.post('/api/founders/apply', {
        name: `Writer ${i}`,
        email: `writer${i}@example.com`,
        about: 'Poems',
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    assert.equal(lastStatus, 429);
  } finally {
    await server.close();
  }
});

test('streak response surfaces freezes and the active pause state', async () => {
  const { server } = await setup();
  try {
    const alice = new Client(server.base);
    await registerUser(alice, 'alice@example.com');

    const before = await alice.get('/api/streak');
    const streakBefore = before.body.streak as {
      freezesAvailable: number;
      pausedToday: boolean;
      pauseDays: string[];
    };
    assert.equal(streakBefore.freezesAvailable, 1);
    assert.equal(streakBefore.pausedToday, false);
    assert.deepEqual(streakBefore.pauseDays, []);

    // Plan two days off starting today (server date, UTC in tests).
    const today = new Date().toISOString().slice(0, 10);
    const paused = await alice.post('/api/streak/pause', { start: today, days: 2 });
    assert.equal(paused.status, 200);
    const streakAfter = paused.body.streak as {
      freezesAvailable: number;
      pausedToday: boolean;
      pauseDays: string[];
    };
    assert.equal(streakAfter.pausedToday, true);
    assert.equal(streakAfter.pauseDays.length, 2);
    assert.equal(streakAfter.pauseDays[0], today);
    // A planned pause costs no freezes.
    assert.equal(streakAfter.freezesAvailable, 1);
  } finally {
    await server.close();
  }
});

test('support page: served only when KOFI_URL is configured, nav link follows', async () => {
  const withJar = await setup({ kofiUrl: KOFI });
  try {
    const page = await getPage(withJar.server.base, '/support');
    assert.equal(page.status, 200);
    assert.match(page.html, /href="https:\/\/ko-fi\.com\/testmaker"/, 'the coffee button links the configured Ko-fi page');
    assert.doesNotMatch(page.html, /\{\{KOFI_URL\}\}|\{\{SUPPORT_EMAIL\}\}/, 'no unfilled slots');
    assert.doesNotMatch(page.html, /donation/i);
    for (const p of ['/help/', '/help/add-a-cover.html', '/thanks', '/changelog']) {
      const { html } = await getPage(withJar.server.base, p);
      // BEUK:branding: the link carries data-kofi so the billing gate can hide it once paid plans are live.
      assert.match(html, /<a href="\/support" data-kofi>Support<\/a>/, `${p} nav should link the support page`);
    }
  } finally {
    await withJar.server.close();
  }

  const withoutJar = await setup();
  try {
    const page = await getPage(withoutJar.server.base, '/support');
    assert.equal(page.status, 404, 'no support page while KOFI_URL is unset');
    for (const p of ['/help/', '/thanks', '/roadmap']) {
      const { html } = await getPage(withoutJar.server.base, p);
      assert.doesNotMatch(html, /href="\/support"/, `${p} must not link a support page that 404s`);
      assert.doesNotMatch(html, /BEUK_SUPPORT_NAV/, `${p} must not leak the slot marker`);
    }
  } finally {
    await withoutJar.server.close();
  }
});
