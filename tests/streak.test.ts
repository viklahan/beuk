import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

interface Streak {
  current: number;
  longest: number;
  freezesAvailable: number;
  frozenDays: string[];
  lastActiveDay: string | null;
}

// 2026-10-19 is a Monday. Tests move this clock; the SERVER stamps dates.
let clock = new Date('2026-10-19T09:00:00Z');
let db: Db;
let server: TestServer;

function setClock(iso: string) {
  clock = new Date(iso);
}

async function heartbeat(client: Client): Promise<Streak> {
  const res = await client.post('/api/streak/heartbeat');
  assert.equal(res.status, 200);
  return res.body.streak as Streak;
}

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, () => clock);
});

after(async () => {
  await server.close();
});

test('streak builds across consecutive days (server-stamped dates)', async () => {
  const client = new Client(server.base);
  await registerUser(client, 'daily@example.com');

  setClock('2026-10-19T09:00:00Z'); // Mon
  let streak = await heartbeat(client);
  assert.equal(streak.current, 1);
  assert.equal(streak.lastActiveDay, '2026-10-19');

  setClock('2026-10-20T22:30:00Z'); // Tue, late evening — same server day
  streak = await heartbeat(client);
  assert.equal(streak.current, 2);

  // A second heartbeat the same day changes nothing.
  streak = await heartbeat(client);
  assert.equal(streak.current, 2);
  assert.equal(streak.longest, 2);
});

test('day boundary: 23:59 and 00:01 are different streak days', async () => {
  const client = new Client(server.base);
  await registerUser(client, 'nightowl@example.com');

  setClock('2026-10-19T23:59:00Z');
  let streak = await heartbeat(client);
  assert.equal(streak.current, 1);
  assert.equal(streak.lastActiveDay, '2026-10-19');

  setClock('2026-10-20T00:01:00Z');
  streak = await heartbeat(client);
  assert.equal(streak.current, 2);
  assert.equal(streak.lastActiveDay, '2026-10-20');
});

test('missed day WITH a freeze: heartbeat repairs the gap and keeps the streak', async () => {
  const client = new Client(server.base);
  await registerUser(client, 'forgiven@example.com'); // starts with 1 freeze

  setClock('2026-10-19T10:00:00Z'); // Mon
  await heartbeat(client);
  setClock('2026-10-20T10:00:00Z'); // Tue
  let streak = await heartbeat(client);
  assert.equal(streak.current, 2);
  assert.equal(streak.freezesAvailable, 1);

  // Wed 2026-10-21 is missed entirely.
  setClock('2026-10-22T10:00:00Z'); // Thu
  streak = await heartbeat(client);
  assert.equal(streak.current, 4); // Mon–Thu, Wed covered by the freeze
  assert.equal(streak.freezesAvailable, 0); // freeze consumed
  assert.deepEqual(streak.frozenDays, ['2026-10-21']);
});

test('missed day WITHOUT a freeze: the streak restarts', async () => {
  const client = new Client(server.base);
  const registered = await registerUser(client, 'strict@example.com');
  const userId = (registered.body.user as { id: string }).id;
  // Drain the starting freeze so this user has none.
  await db.query('update streak_state set freezes_available = 0 where user_id = $1', [userId]);

  setClock('2026-10-19T10:00:00Z'); // Mon
  await heartbeat(client);
  setClock('2026-10-20T10:00:00Z'); // Tue
  let streak = await heartbeat(client);
  assert.equal(streak.current, 2);

  setClock('2026-10-22T10:00:00Z'); // Thu, Wed missed, no freeze to repair it
  streak = await heartbeat(client);
  assert.equal(streak.current, 1); // only Thursday counts now
  assert.equal(streak.longest, 2); // the Mon–Tue run is remembered
  assert.deepEqual(streak.frozenDays, []);
});

test('pause: planned days off do not break the streak and cost no freezes', async () => {
  const client = new Client(server.base);
  await registerUser(client, 'traveler@example.com');

  setClock('2026-10-19T10:00:00Z'); // Mon
  let streak = await heartbeat(client);
  assert.equal(streak.current, 1);

  // Pause Tue+Wed (a trip), declared on Monday.
  const paused = await client.post('/api/streak/pause', { start: '2026-10-20', days: 2 });
  assert.equal(paused.status, 200);

  setClock('2026-10-22T10:00:00Z'); // Thu, back from the trip
  streak = await heartbeat(client);
  assert.equal(streak.current, 4); // Mon + paused Tue/Wed + Thu
  assert.equal(streak.freezesAvailable, 1); // untouched
  assert.deepEqual(streak.frozenDays, ['2026-10-20', '2026-10-21']);
});

test('pause validation: no past starts, 1..30 days', async () => {
  const client = new Client(server.base);
  await registerUser(client, 'planner@example.com');
  setClock('2026-10-19T10:00:00Z');

  const past = await client.post('/api/streak/pause', { start: '2026-10-18', days: 1 });
  assert.equal(past.status, 400);
  const tooLong = await client.post('/api/streak/pause', { start: '2026-10-20', days: 31 });
  assert.equal(tooLong.status, 400);
  const badDate = await client.post('/api/streak/pause', { start: 'next week', days: 2 });
  assert.equal(badDate.status, 400);
});

test('streak endpoints require auth', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.get('/api/streak')).status, 401);
  assert.equal((await anon.post('/api/streak/heartbeat')).status, 401);
  assert.equal((await anon.post('/api/streak/pause', { start: '2026-10-20', days: 1 })).status, 401);
});
