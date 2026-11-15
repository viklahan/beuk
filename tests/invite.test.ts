import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Client,
  createTestDb,
  registerUser,
  startTestServer,
  testConfig,
} from './helpers.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { inviteEmail, INVITE_SUBJECT } from '../src/email/invite.js';

/** A configured mailer that records instead of sending. */
class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'beuk@example.com', detail: 'recording (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: `<test-${this.sent.length}@example.com>` };
  }
  async verify() {
    return { ok: true, detail: 'recording (test)' };
  }
}

const ADMIN = 'admin@example.com';

/** Only the invite emails, ignoring the signup-confirmation mail that
 *  registering a test user sends through the same recorder. */
const invitesSent = (m: RecordingMailer) => m.sent.filter((x) => x.subject === INVITE_SUBJECT);

async function setup() {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const server = await startTestServer(db, undefined, undefined, undefined, { mailer });
  const admin = new Client(server.base);
  const alice = new Client(server.base);
  const anon = new Client(server.base);
  await registerUser(admin, ADMIN);
  await registerUser(alice, 'alice@example.com');
  assert.equal(await setAdmin(db, ADMIN, true), 'granted');
  return { db, mailer, server, admin, alice, anon };
}

/** GET an HTML page carrying a client's cookie jar (Client.get parses JSON). */
async function getHtml(client: Client, base: string, p: string): Promise<{ status: number; text: string }> {
  const cookie = (client as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
  const res = await fetch(base + p, { headers: cookie });
  return { status: res.status, text: await res.text() };
}

test('GET /account/invite: an admin sees the send form; everyone else gets 404', async () => {
  const { server, admin, alice, anon } = await setup();
  try {
    const seen = await getHtml(admin, server.base, '/account/invite');
    assert.equal(seen.status, 200);
    assert.match(seen.text, /name="name"/);
    assert.match(seen.text, /name="email"/);
    assert.match(seen.text, /Send/i);

    assert.equal((await getHtml(alice, server.base, '/account/invite')).status, 404);
    assert.equal((await getHtml(anon, server.base, '/account/invite')).status, 404);
  } finally {
    await server.close();
  }
});

test('POST /api/invite: an admin sends a personalised invite through the mailer', async () => {
  const { server, admin, mailer } = await setup();
  try {
    const res = await admin.post('/api/invite', { name: 'Marcus Vane', email: 'Marcus@Example.com' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const sent = invitesSent(mailer);
    assert.equal(sent.length, 1);
    const m = sent[0];
    assert.equal(m.to, 'marcus@example.com'); // normalised to lowercase
    assert.match(m.subject, /Beuk/);
    assert.match(m.html, /Hey Marcus/); // first name only, interpolated
    assert.ok(Array.isArray(m.attachments));
    assert.ok(m.attachments!.some((a) => a.cid === 'beuk-logo'), 'carries the inline logo');
  } finally {
    await server.close();
  }
});

test('POST /api/invite: non-admins and anonymous callers get 404', async () => {
  const { server, alice, anon, mailer } = await setup();
  try {
    assert.equal((await alice.post('/api/invite', { name: 'X', email: 'x@y.com' })).status, 404);
    assert.equal((await anon.post('/api/invite', { name: 'X', email: 'x@y.com' })).status, 404);
    assert.equal(invitesSent(mailer).length, 0);
  } finally {
    await server.close();
  }
});

test('POST /api/invite: a malformed email is refused and nothing is sent', async () => {
  const { server, admin, mailer } = await setup();
  try {
    const res = await admin.post('/api/invite', { name: 'X', email: 'not-an-email' });
    assert.equal(res.status, 400);
    assert.equal(invitesSent(mailer).length, 0);
  } finally {
    await server.close();
  }
});

test('POST /api/invite: an empty name is refused', async () => {
  const { server, admin, mailer } = await setup();
  try {
    const res = await admin.post('/api/invite', { name: '   ', email: 'ok@example.com' });
    assert.equal(res.status, 400);
    assert.equal(invitesSent(mailer).length, 0);
  } finally {
    await server.close();
  }
});

test('inviteEmail: renders the recipient first name and attaches the logo', async () => {
  const msg = await inviteEmail(testConfig(), 'Marcus Vane');
  assert.match(msg.subject, /Beuk/);
  assert.match(msg.html, /Hey Marcus/);
  assert.ok(!/Hey Marcus Vane/.test(msg.html), 'greets by first name only');
  assert.match(msg.text, /Marcus/);
  assert.ok(msg.attachments.some((a) => a.cid === 'beuk-logo'));
});
