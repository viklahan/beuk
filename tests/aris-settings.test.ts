import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';

async function boot() {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { arisEnabled: true, arisKeySecret: 'test-secret' });
  const client = new Client(server.base);
  await registerUser(client, 'aris-settings@example.com');
  return { server, client };
}

test('opt-in and voice persist', async () => {
  const { server, client } = await boot();
  try {
    const before = await client.get('/api/aris/status');
    assert.equal(before.body.optedIn, false);
    assert.equal(before.body.voice, 'laconic');

    const put = await client.put('/api/aris/settings', { optedIn: true, voice: 'homeric' });
    assert.equal(put.status, 200);
    assert.equal(put.body.optedIn, true);
    assert.equal(put.body.voice, 'homeric');
    assert.equal(put.body.enabled, true);
    assert.deepEqual(put.body.keys, []);

    const status = await client.get('/api/aris/status');
    assert.equal(status.body.optedIn, true);
    assert.equal(status.body.voice, 'homeric');

    // partial update keeps the other field
    const part = await client.put('/api/aris/settings', { voice: 'laconic' });
    assert.equal(part.status, 200);
    assert.equal(part.body.optedIn, true);
    assert.equal(part.body.voice, 'laconic');
  } finally {
    await server.close();
  }
});

test('an invalid voice is refused', async () => {
  const { server, client } = await boot();
  try {
    const bad = await client.put('/api/aris/settings', { voice: 'shouty' });
    assert.equal(bad.status, 400);
    const badOpt = await client.put('/api/aris/settings', { optedIn: 'yes' });
    assert.equal(badOpt.status, 400);
    const status = await client.get('/api/aris/status');
    assert.equal(status.body.voice, 'laconic');
    assert.equal(status.body.optedIn, false);
  } finally {
    await server.close();
  }
});

test('status says whether the account has summoned Aris before (known)', async () => {
  const { server, client } = await boot();
  try {
    // a fresh account: Aris was never summoned — the studio shows nothing at all
    const fresh = await client.get('/api/aris/status');
    assert.equal(fresh.body.known, false);
    assert.equal(fresh.body.optedIn, false);

    const on = await client.put('/api/aris/settings', { optedIn: true });
    assert.equal(on.body.known, true);

    // sent away is not forgotten: the account stays known, so the desk shows the dormant laurel
    const off = await client.put('/api/aris/settings', { optedIn: false });
    assert.equal(off.body.known, true);
    assert.equal(off.body.optedIn, false);

    const status = await client.get('/api/aris/status');
    assert.equal(status.body.known, true);
  } finally {
    await server.close();
  }
});

test('a saved key alone makes the account known', async () => {
  const { server, client } = await boot();
  try {
    const put = await client.put('/api/aris/key', { provider: 'anthropic', apiKey: 'sk-test-known-1234' });
    assert.equal(put.status, 200);
    const status = await client.get('/api/aris/status');
    assert.equal(status.body.known, true);
    assert.equal(status.body.optedIn, false);
  } finally {
    await server.close();
  }
});

test('engine routes refuse before opt-in', async () => {
  const { server, client } = await boot();
  try {
    const no = await client.post('/api/aris/draft', {});
    assert.equal(no.status, 403);
    assert.deepEqual(no.body, { error: 'turn Aris on from your /aris page first' });

    await client.put('/api/aris/settings', { optedIn: true });
    const yes = await client.post('/api/aris/draft', {});
    assert.equal(yes.status, 400);

    await client.put('/api/aris/settings', { optedIn: false });
    const off = await client.post('/api/aris/draft', {});
    assert.equal(off.status, 403);
  } finally {
    await server.close();
  }
});
