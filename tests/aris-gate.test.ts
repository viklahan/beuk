import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';
import type { Config } from '../src/config.js';

async function boot(overrides?: Partial<Config>) {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, overrides);
  return { server, client: new Client(server.base) };
}

test('with ARIS_ENABLED unset every /api/aris route is a catch-all-identical 404', async () => {
  const { server, client } = await boot();
  try {
    const res = await client.get('/api/aris/status');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'not found' });
  } finally {
    await server.close();
  }
});

test('enabled without ARIS_KEY_SECRET is an honest 503', async () => {
  const { server, client } = await boot({ arisEnabled: true, arisKeySecret: null });
  try {
    const res = await client.get('/api/aris/status');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'aris misconfigured: ARIS_KEY_SECRET is not set' });
  } finally {
    await server.close();
  }
});

test('status answers for a signed-in writer when configured', async () => {
  const { server, client } = await boot({ arisEnabled: true, arisKeySecret: 'test-secret' });
  try {
    await registerUser(client, 'aris-writer@example.com');
    const res = await client.get('/api/aris/status');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: true, optedIn: false, voice: 'laconic', keys: [] });
  } finally {
    await server.close();
  }
});

test('status requires a session', async () => {
  const { server, client } = await boot({ arisEnabled: true, arisKeySecret: 'test-secret' });
  try {
    const res = await client.get('/api/aris/status');
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});
