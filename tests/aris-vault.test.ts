import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';
import { decryptKey, encryptKey } from '../src/aris/vault.js';

async function boot() {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { arisEnabled: true, arisKeySecret: 'test-secret' });
  const client = new Client(server.base);
  await registerUser(client, 'aris-vault@example.com');
  return { server, client };
}

test('vault round-trips and refuses tampering', () => {
  const ct = encryptKey('s3cret', 'sk-or-v1-abcdef1234');
  assert.match(ct, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(decryptKey('s3cret', ct), 'sk-or-v1-abcdef1234');

  const [v, iv, tag, body] = ct.split(':');
  const bytes = Buffer.from(body, 'base64');
  bytes[0] ^= 0x01;
  assert.throws(() => decryptKey('s3cret', [v, iv, tag, bytes.toString('base64')].join(':')));

  assert.throws(() => decryptKey('other-secret', ct));
});

test('a saved key is shown once as last4, retrievable never', async () => {
  const { server, client } = await boot();
  try {
    const plain = 'sk-or-v1-SUPERSECRETVALUE9876';
    const put = await client.put('/api/aris/key', { provider: 'openrouter', apiKey: plain });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { provider: 'openrouter', last4: '9876' });
    assert.ok(!JSON.stringify(put.body).includes(plain));

    const status = await client.get('/api/aris/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.keys, [{ provider: 'openrouter', last4: '9876' }]);
    const raw = JSON.stringify(status.body);
    assert.ok(!raw.includes(plain));
    assert.ok(!raw.includes('SUPERSECRET'));
    assert.ok(!/ciphertext|v1:/.test(raw));

    // replacing the same provider keeps one row
    const again = await client.put('/api/aris/key', { provider: 'openrouter', apiKey: 'sk-or-v1-other1111' });
    assert.equal(again.status, 200);
    const after = await client.get('/api/aris/status');
    assert.deepEqual(after.body.keys, [{ provider: 'openrouter', last4: '1111' }]);
  } finally {
    await server.close();
  }
});

test('baseUrl is openai-compat only and must be https', async () => {
  const { server, client } = await boot();
  try {
    const a = await client.put('/api/aris/key', { provider: 'anthropic', apiKey: 'sk-ant-abcd1234', baseUrl: 'https://x.example.com' });
    assert.equal(a.status, 400);
    const b = await client.put('/api/aris/key', { provider: 'openai-compat', apiKey: 'sk-abcd1234', baseUrl: 'http://x.example.com' });
    assert.equal(b.status, 400);
    const c = await client.put('/api/aris/key', { provider: 'openai-compat', apiKey: 'sk-abcd1234', baseUrl: 'not a url' });
    assert.equal(c.status, 400);
    const ok = await client.put('/api/aris/key', { provider: 'openai-compat', apiKey: 'sk-abcd1234', baseUrl: 'https://llm.example.com/v1' });
    assert.equal(ok.status, 200);
    const status = await client.get('/api/aris/status');
    assert.deepEqual(status.body.keys, [{ provider: 'openai-compat', last4: '1234', baseUrl: 'https://llm.example.com/v1' }]);
    const bad = await client.put('/api/aris/key', { provider: 'nope', apiKey: 'sk-abcd1234' });
    assert.equal(bad.status, 400);
    const empty = await client.put('/api/aris/key', { provider: 'anthropic', apiKey: '' });
    assert.equal(empty.status, 400);
  } finally {
    await server.close();
  }
});

test('delete removes the key', async () => {
  const { server, client } = await boot();
  try {
    await client.put('/api/aris/key', { provider: 'anthropic', apiKey: 'sk-ant-abcd1234' });
    const del = await client.delete('/api/aris/key/anthropic');
    assert.equal(del.status, 204);
    const status = await client.get('/api/aris/status');
    assert.deepEqual(status.body.keys, []);
  } finally {
    await server.close();
  }
});
