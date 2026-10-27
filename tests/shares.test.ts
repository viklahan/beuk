import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { sanitizeHtml } from '../src/shares/sanitize.js';
import { renderSnapshot } from '../src/shares/render.js';
import { createShareLimiter } from '../src/routes/shares.js';

let server: TestServer;
let db: Db;
let alice: Client;
let bob: Client;
let clock = new Date();

// A 1×1 transparent PNG.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// The studio's own document shape (serializeBook in client/index.html).
const studioDoc = {
  meta: { title: 'The Lantern Coast', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'sec-cover', kind: 'front', type: 'cover', title: 'Cover', content: '' },
    { id: 'sec-ded', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the keepers.' },
    {
      id: 'sec-one',
      kind: 'body',
      type: 'chapter',
      number: 'One',
      title: 'First Light',
      content:
        'It began with the tide.[^1]\n\nThe *second* paragraph, **strong**.\n\n***\n\n![A chart of the harbour](img:img-chart)\n\n[^1]: A note on tides.',
    },
    { id: 'sec-two', kind: 'body', type: 'chapter', number: 'Two', title: 'Fog', content: 'The fog came in.' },
    { id: 'sec-hidden', kind: 'body', type: 'chapter', title: 'Cut', content: 'Not shipped.', included: false },
  ],
  images: [{ id: 'img-chart', name: 'chart', mediaType: 'image/png', ext: 'png', data: PNG_1PX }],
};

// Everything a hostile manuscript could try.
const hostileDoc = {
  meta: { title: 'Evil <script>alert(1)</script> Book', author: '<img src=x onerror=alert(2)>' },
  sections: [
    {
      id: 'sec-x',
      kind: 'body',
      type: 'chapter',
      title: '<script>alert("t")</script>',
      content:
        '<script>alert(3)</script>\n\n<img src=x onerror=alert(4)>\n\n<a href="javascript:alert(5)">click</a>\n\n[click](javascript:alert(6))\n\n![x" onerror="alert(7)](img:evil)\n\n<svg onload=alert(8)></svg>',
    },
  ],
  images: [
    { id: 'evil', mediaType: 'image/svg+xml', data: 'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' },
    { id: 'evil2', mediaType: 'text/html', data: 'PHNjcmlwdD4=' },
  ],
};

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, () => clock);
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice-owner@example.com');
  await registerUser(bob, 'bob@example.com');
});

after(async () => {
  await server.close();
});

async function newManuscript(client: Client, doc: unknown): Promise<string> {
  const r = await client.post('/api/manuscripts', { doc });
  assert.equal(r.status, 201);
  return (r.body.manuscript as { id: string }).id;
}

async function newShare(client: Client, manuscriptId: string, extra: Record<string, unknown> = {}) {
  const r = await client.post('/api/shares', { manuscriptId, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { share: { id: string; status: string }; token: string; path: string };
}

async function getHtml(pathName: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${server.base}${pathName}`, { headers });
  return { status: res.status, headers: res.headers, html: await res.text() };
}

async function postComment(token: string, body: Record<string, unknown>, ip?: string) {
  const res = await fetch(`${server.base}/read/${token}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test('create → list → read: token returned once, stored hashed, reader page renders the frozen copy', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const created = await newShare(alice, mid);
  assert.match(created.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(created.path, `/read/${created.token}`);
  assert.equal(created.share.status, 'active');

  // Only the hash is stored.
  const rows = await db.query<{ token_hash: string }>('select token_hash from shares where id = $1', [created.share.id]);
  assert.match(rows.rows[0].token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rows.rows[0].token_hash, created.token);

  const list = await alice.get('/api/shares');
  assert.equal(list.status, 200);
  const items = list.body.shares as Array<Record<string, unknown>>;
  const mine = items.find((s) => s.id === created.share.id)!;
  assert.ok(mine);
  assert.equal(mine.token, undefined); // never listed again
  assert.equal(mine.sectionCount, 3); // dedication + two included chapters
  assert.equal(mine.readerCount, 0);

  const page = await getHtml(created.path);
  assert.equal(page.status, 200);
  assert.match(page.html, /The Lantern Coast/);
  assert.match(page.html, /href="\/help\/warmth\.css"/);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'nonce-/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  // Chapter navigation lists every readable section; the excluded one is absent.
  assert.match(page.html, /One · First Light/);
  assert.match(page.html, /Two · Fog/);
  assert.doesNotMatch(page.html, /Not shipped/);

  const ch = await getHtml(`${created.path}?c=1`);
  assert.match(ch.html, /<p data-p="0">It began with the tide\.<a class="noteref"/);
  assert.match(ch.html, /<em>second<\/em>/);
  assert.match(ch.html, new RegExp(`<img src="/read/${created.token}/img/img-chart" alt="A chart of the harbour">`));
  const img = await fetch(`${server.base}/read/${created.token}/img/img-chart`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  // Reader count = distinct browsers: the two cookieless visits above
  // count as two; the first browser coming back with its cookie does not
  // add a third.
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  await getHtml(created.path, { cookie });
  const again = await alice.get('/api/shares');
  const counted = (again.body.shares as Array<Record<string, unknown>>).find((s) => s.id === created.share.id)!;
  assert.equal(counted.readerCount, 2);
});

test('the frozen copy stays frozen until republished', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { share, token } = await newShare(alice, mid);
  const changed = JSON.parse(JSON.stringify(studioDoc));
  changed.sections[3].content = 'A rewritten fog chapter.';
  assert.equal((await alice.put(`/api/manuscripts/${mid}`, { doc: changed, revision: 1 })).status, 200);
  assert.match((await getHtml(`/read/${token}?c=2`)).html, /The fog came in\./);
  const rep = await alice.post(`/api/shares/${share.id}/republish`);
  assert.equal(rep.status, 200);
  const after = await getHtml(`/read/${token}?c=2`);
  assert.match(after.html, /A rewritten fog chapter\./);
  assert.doesNotMatch(after.html, /The fog came in\./);
});

test('revoke → 410 calm page; comment API answers 410 too', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { share, token } = await newShare(alice, mid);
  assert.equal((await getHtml(`/read/${token}`)).status, 200);
  const revoked = await alice.post(`/api/shares/${share.id}/revoke`);
  assert.equal(revoked.status, 200);
  assert.equal((revoked.body.share as { status: string }).status, 'revoked');
  const gone = await getHtml(`/read/${token}`);
  assert.equal(gone.status, 410);
  assert.match(gone.html, /This reading copy is closed/);
  assert.doesNotMatch(gone.html, /It began with the tide/);
  const c = await postComment(token, { sectionId: 'sec-one', body: 'late', readerName: 'R' });
  assert.equal(c.status, 410);
  assert.equal((await fetch(`${server.base}/read/${token}/img/img-chart`)).status, 404);
  // Republishing a revoked link is refused.
  assert.equal((await alice.post(`/api/shares/${share.id}/republish`)).status, 409);
  // An unknown token is a calm 404, not a crash.
  assert.equal((await getHtml('/read/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status, 404);
});

test('expiry: set, honoured with 410 once passed, clearable', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const soon = new Date(clock.getTime() + 2 * 86_400_000).toISOString();
  const { share, token } = await newShare(alice, mid, { expiresAt: soon });
  assert.equal((await alice.post('/api/shares', { manuscriptId: mid, expiresAt: '2000-01-01T00:00:00Z' })).status, 400);
  assert.equal((await getHtml(`/read/${token}`)).status, 200);
  const keep = clock;
  try {
    clock = new Date(keep.getTime() + 3 * 86_400_000);
    const gone = await getHtml(`/read/${token}`);
    assert.equal(gone.status, 410);
    assert.match(gone.html, /reading period for this copy has ended/);
    const list = await alice.get('/api/shares');
    assert.equal(
      (list.body.shares as Array<{ id: string; status: string }>).find((s) => s.id === share.id)!.status,
      'expired',
    );
    // Extending (or clearing) the expiry re-opens the link.
    const cleared = await alice.put(`/api/shares/${share.id}`, { expiresAt: null });
    assert.equal(cleared.status, 200);
    assert.equal((cleared.body.share as { expiresAt: string | null }).expiresAt, null);
    assert.equal((await getHtml(`/read/${token}`)).status, 200);
  } finally {
    clock = keep;
  }
});

test('comments: reader leaves one, owner lists/resolves/unresolves/deletes it', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { share, token } = await newShare(alice, mid);
  const posted = await postComment(token, {
    sectionId: 'sec-one',
    paragraph: 1,
    quote: 'The second paragraph',
    body: 'I loved this line.',
    readerName: 'Rosa',
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));

  // Validation: name required by default, section must exist, length caps, honeypot.
  assert.equal((await postComment(token, { sectionId: 'sec-one', body: 'x' })).status, 400);
  assert.equal((await postComment(token, { sectionId: 'nope', body: 'x', readerName: 'R' })).status, 400);
  assert.equal((await postComment(token, { sectionId: 'sec-one', body: 'x'.repeat(2001), readerName: 'R' })).status, 400);
  const bot = await postComment(token, { sectionId: 'sec-one', body: 'spam', readerName: 'Bot', website: 'http://spam' });
  assert.equal(bot.status, 202);

  const pub = await fetch(`${server.base}/read/${token}/comments`);
  const pubBody = (await pub.json()) as { comments: Array<Record<string, unknown>> };
  assert.equal(pubBody.comments.length, 1); // the honeypot one was never stored
  assert.equal(pubBody.comments[0].ip_hash, undefined);
  assert.equal(pubBody.comments[0].resolvedAt, undefined);

  const list = await alice.get(`/api/shares/${share.id}/comments`);
  assert.equal(list.status, 200);
  const comments = list.body.comments as Array<{ id: string; sectionId: string; paragraph: number; quote: string; readerName: string; resolvedAt: string | null }>;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].sectionId, 'sec-one');
  assert.equal(comments[0].paragraph, 1);
  assert.equal(comments[0].quote, 'The second paragraph');
  assert.equal(comments[0].readerName, 'Rosa');
  const cid = comments[0].id;

  const byManuscript = await alice.get(`/api/shares/comments?manuscriptId=${mid}`);
  assert.equal((byManuscript.body.comments as unknown[]).length, 1);

  const res1 = await alice.post(`/api/shares/${share.id}/comments/${cid}/resolve`);
  assert.equal(res1.status, 200);
  assert.ok((res1.body.comment as { resolvedAt: string | null }).resolvedAt);
  const counts = (await alice.get('/api/shares')).body.shares as Array<{ id: string; commentCount: number; openCommentCount: number }>;
  const c = counts.find((s) => s.id === share.id)!;
  assert.equal(c.commentCount, 1);
  assert.equal(c.openCommentCount, 0);
  const res2 = await alice.post(`/api/shares/${share.id}/comments/${cid}/unresolve`);
  assert.equal((res2.body.comment as { resolvedAt: string | null }).resolvedAt, null);
  assert.equal((await alice.delete(`/api/shares/${share.id}/comments/${cid}`)).status, 204);
  assert.equal(((await alice.get(`/api/shares/${share.id}/comments`)).body.comments as unknown[]).length, 0);
});

test('IDOR: another writer cannot share, list, change, revoke, read comments of, resolve or delete', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { share, token } = await newShare(alice, mid);
  const posted = await postComment(token, { sectionId: 'sec-two', body: 'Nice', readerName: 'Kim' });
  const cid = (posted.body.comment as { id: string }).id;

  assert.equal((await bob.post('/api/shares', { manuscriptId: mid })).status, 404);
  const bobList = await bob.get('/api/shares');
  assert.equal((bobList.body.shares as unknown[]).length, 0);
  assert.equal(((await bob.get(`/api/shares?manuscriptId=${mid}`)).body.shares as unknown[]).length, 0);
  assert.equal(((await bob.get(`/api/shares/comments?manuscriptId=${mid}`)).body.comments as unknown[]).length, 0);
  assert.equal((await bob.get(`/api/shares/${share.id}/comments`)).status, 404);
  assert.equal((await bob.put(`/api/shares/${share.id}`, { expiresAt: null })).status, 404);
  assert.equal((await bob.post(`/api/shares/${share.id}/republish`)).status, 404);
  assert.equal((await bob.post(`/api/shares/${share.id}/revoke`)).status, 404);
  assert.equal((await bob.post(`/api/shares/${share.id}/comments/${cid}/resolve`)).status, 404);
  assert.equal((await bob.delete(`/api/shares/${share.id}/comments/${cid}`)).status, 404);
  assert.equal((await bob.delete(`/api/shares/${share.id}`)).status, 404);
  // Bob's own share id paired with Alice's comment id doesn't work either.
  const bobMid = await newManuscript(bob, studioDoc);
  const bobShare = await newShare(bob, bobMid);
  assert.equal((await bob.post(`/api/shares/${bobShare.share.id}/comments/${cid}/resolve`)).status, 404);
  assert.equal((await bob.delete(`/api/shares/${bobShare.share.id}/comments/${cid}`)).status, 404);

  // Nothing changed for Alice.
  assert.equal((await getHtml(`/read/${token}`)).status, 200);
  const still = (await alice.get(`/api/shares/${share.id}/comments`)).body.comments as Array<{ resolvedAt: unknown }>;
  assert.equal(still.length, 1);
  assert.equal(still[0].resolvedAt, null);
  // Signed out: 401.
  assert.equal((await new Client(server.base).get('/api/shares')).status, 401);
});

test('XSS: a hostile manuscript renders inert on the reader page', async () => {
  const mid = await newManuscript(alice, hostileDoc);
  const { token } = await newShare(alice, mid);
  const page = await getHtml(`/read/${token}`);
  assert.equal(page.status, 200);
  const nonce = /script-src 'nonce-([^']+)'/.exec(page.headers.get('content-security-policy')!)![1];
  // The only <script> on the page is the nonce'd comment helper.
  const scripts = page.html.match(/<script\b[^>]*>/gi) ?? [];
  assert.deepEqual(scripts, [`<script nonce="${nonce}">`]);
  // No tag anywhere carries an event handler, and no javascript: URL survives in markup.
  assert.equal(/<[a-z][^>]*\son[a-z]+\s*=/i.test(page.html), false);
  assert.equal(/(href|src)\s*=\s*["']?\s*javascript:/i.test(page.html), false);
  assert.equal(/<svg/i.test(page.html), false);
  // Links: only the reader's own chrome — chapter anchors, /read/ pages,
  // /help/, and the footer's exact /privacy and /terms (legal pages).
  assert.equal(/<a [^>]*href="(?!#|\/read\/|\/help\/|\/privacy"|\/terms")/i.test(page.html), false);
  // The text is still there, escaped, for the reader to see.
  assert.match(page.html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  // SVG / non-image "pictures" never ship.
  assert.equal((await fetch(`${server.base}/read/${token}/img/evil`)).status, 404);
  assert.equal((await fetch(`${server.base}/read/${token}/img/evil2`)).status, 404);
});

test('sanitizer unit: strips scripts, handlers, javascript: links, unsafe images', () => {
  const out = sanitizeHtml(
    '<p onclick="x()">Hi<script>alert(1)</script></p><a href="javascript:alert(1)">a</a>' +
      '<a href="&#106;avascript:alert(1)">b</a><a href="#fn1">c</a><img src="https://evil.example/x.png" alt="e">' +
      '<img src="data:image/png;base64,AAAA" alt="ok"><img src="data:text/html;base64,AAAA"><iframe src="x"></iframe>' +
      '<img src=x onerror=alert(1)><style>p{}</style><scr<script>ipt>alert(1)</script><div style="x" data-p="3">d</div><!-- c -->',
  );
  assert.equal(/<script/i.test(out), false);
  assert.equal(/\son[a-z]+=/i.test(out), false);
  assert.equal(/javascript:/i.test(out.replace(/&[^;]+;/g, '')), false);
  assert.equal(/evil\.example/.test(out), false);
  assert.equal(/iframe|style|<!--/i.test(out), false);
  assert.match(out, /<a href="#fn1">c<\/a>/);
  assert.match(out, /<img src="data:image\/png;base64,AAAA" alt="ok">/);
  assert.match(out, /<div data-p="3">d<\/div>/);
  // Share-image references only resolve through the caller.
  assert.equal(sanitizeHtml('<img src="beuk-img:a1" alt="x">'), '');
  assert.equal(
    sanitizeHtml('<img src="beuk-img:a1" alt="x">', { resolveImage: (id) => `/read/t/img/${id}` }),
    '<img src="/read/t/img/a1" alt="x">',
  );
});

test('render unit: paragraph indexes follow the studio block split', () => {
  const { snapshot, images } = renderSnapshot(studioDoc, 'x');
  const one = snapshot.sections.find((s) => s.id === 'sec-one')!;
  assert.match(one.html, /<p data-p="0">/);
  assert.match(one.html, /<p data-p="1">The <em>second<\/em>/);
  assert.match(one.html, /<div class="scene-break" data-p="2">/);
  assert.match(one.html, /<figure data-p="3" class="book-img">/);
  assert.match(one.html, /<p class="endnote" id="s2-fn1" data-p="4">/);
  assert.deepEqual(Object.keys(images), ['img-chart']);
});

test('render unit: a redaction ("||words||") never reaches the reading copy — a bar of full blocks instead', () => {
  const doc = {
    meta: { title: 'Exhibit', author: 'A. Writer', language: 'en' },
    sections: [
      {
        id: 'sec-r',
        kind: 'body',
        type: 'chapter',
        number: '1',
        title: 'Filed',
        content: 'The agent met ||Harriet Vance|| at the **||Corsair||** dock.\n\n> She said ||nothing useful||.\n\n[^1]: Source: ||Bluebird||.\n\nSee note.[^1]',
      },
    ],
  };
  const { snapshot } = renderSnapshot(doc, 'x');
  const html = snapshot.sections.map((s) => s.html).join('');
  for (const w of ['Harriet', 'Vance', 'Corsair', 'nothing useful', 'Bluebird', '||']) assert.equal(html.includes(w), false, `"${w}" leaked`);
  assert.match(html, /met <span class="redacted">█{7} █{5}<\/span> at the <strong><span class="redacted">█{7}<\/span><\/strong> dock/);
  assert.match(html, /<span class="redacted">█{7} █{6}<\/span>\./);
  assert.match(html, /Source: <span class="redacted">█{8}<\/span>\./);
});

test('render unit: a redaction in a picture\'s alt text or caption (inline, scene, plate) is said or barred, never its words', () => {
  const doc = {
    meta: { title: 'Exhibit', author: 'A. Writer', language: 'en' },
    images: [
      { id: 'img-a', name: 'a.png', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    ],
    sections: [
      {
        id: 'sec-a',
        kind: 'body',
        type: 'chapter',
        number: '1',
        title: 'Pictured ||SecretTitle||',
        content: 'Before.\n\n![Alt ||SecretAlt||](img:img-a)\n\n***\n\nAfter.',
        plateId: 'img-a',
        plateAlt: 'Plate of ||SecretPlate|| house',
        scenes: [{ at: 0, imageId: 'img-a', alt: 'Scene ||SecretScene||', caption: 'Cap ||SecretCap||' }],
      },
    ],
  };
  const { snapshot } = renderSnapshot(doc, 'x');
  const html = snapshot.sections.map((s) => s.html).join('') + JSON.stringify(snapshot);
  for (const w of ['SecretTitle', 'SecretAlt', 'SecretPlate', 'SecretScene', 'SecretCap', '||']) assert.equal(html.includes(w), false, `"${w}" leaked`);
  assert.match(html, /<img src="beuk-img:img-a" alt="Alt redacted">/);
  assert.match(html, /alt="Plate of redacted house"/);
  assert.match(html, /<h2 class="ch-title">Pictured <span class="redacted">█{11}<\/span><\/h2>/);
  assert.match(html, /alt="Scene redacted"><figcaption>Cap <span class="redacted">█{9}<\/span><\/figcaption>/);
});

test('comment rate limit: per IP per share, then per share overall', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { token } = await newShare(alice, mid);
  for (let i = 0; i < 10; i++) {
    const r = await postComment(token, { sectionId: 'sec-two', body: `note ${i}`, readerName: 'Fast' }, '203.0.113.7');
    assert.equal(r.status, 201, `comment ${i}: ${JSON.stringify(r.body)}`);
  }
  const limited = await postComment(token, { sectionId: 'sec-two', body: 'one more', readerName: 'Fast' }, '203.0.113.7');
  assert.equal(limited.status, 429);
  // A different reader on another connection is unaffected.
  const other = await postComment(token, { sectionId: 'sec-two', body: 'hello', readerName: 'Slow' }, '198.51.100.9');
  assert.equal(other.status, 201);

  // The per-share ceiling (unit, with an injected clock).
  let t = 0;
  const lim = createShareLimiter({ perIp: 2, perIpWindowMs: 1000, perShare: 3, perShareWindowMs: 5000 }, () => t);
  assert.equal(lim.check('a', 's'), 'ok');
  assert.equal(lim.check('a', 's'), 'ok');
  assert.equal(lim.check('a', 's'), 'ip');
  assert.equal(lim.check('b', 's'), 'ok');
  assert.equal(lim.check('c', 's'), 'share');
  assert.equal(lim.check('c', 'other'), 'ok');
  t = 6000;
  assert.equal(lim.check('c', 's'), 'ok');
});

test('the owner’s email never appears in public HTML or the public comment API', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { token } = await newShare(alice, mid);
  await postComment(token, { sectionId: 'sec-one', body: 'Hi', readerName: 'Lee' });
  for (const p of [`/read/${token}`, `/read/${token}?c=1`, `/read/${token}?c=2`, `/read/${token}/comments`]) {
    const r = await getHtml(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.html.includes('alice-owner@example.com'), false, p);
    assert.equal(r.html.includes('alice-owner'), false, p);
  }
  const ownerId = (await db.query<{ owner_id: string }>('select owner_id from shares limit 1')).rows[0].owner_id;
  assert.equal((await getHtml(`/read/${token}`)).html.includes(ownerId), false);
});

test('comments can be turned off and names made optional', async () => {
  const mid = await newManuscript(alice, studioDoc);
  const { share, token } = await newShare(alice, mid, { allowComments: false });
  assert.equal((await postComment(token, { sectionId: 'sec-one', body: 'x', readerName: 'R' })).status, 403);
  const page = await getHtml(`/read/${token}`);
  assert.match(page.html, /turned comments off/);
  const upd = await alice.put(`/api/shares/${share.id}`, { allowComments: true, readerNameRequired: false });
  assert.equal(upd.status, 200);
  assert.equal((await postComment(token, { sectionId: 'sec-one', body: 'anonymous thought' })).status, 201);
});
