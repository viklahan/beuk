import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readZip } from '../src/housekeeping/packages.js';
import { checkSchoolContent, loadSchoolContent, parseLesson, parseShots } from '../src/school/content.js';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';

/* Beuk School (V, 2026-10-28): free, at /school, English first, media from
   the box, AI narration, progress for signed-in writers only. */

const root = path.resolve(import.meta.dirname, '..');

async function getPage(base: string, p: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(`${base}${p}`, { redirect });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

test('school content: Maiden Voyage parses clean, 12 lessons in order, every step narrated and recordable', () => {
  const c = loadSchoolContent('en');
  assert.deepEqual(checkSchoolContent(c), []);
  const mv = c.courseBySlug.get('maiden-voyage');
  assert.ok(mv, 'the first course is there');
  assert.equal(mv.lessons.length, 12);
  assert.deepEqual(mv.lessons.map((l) => l.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(mv.stages, ['idea', 'draft', 'ship']);
  for (const l of mv.lessons) {
    assert.ok(l.title && l.blurb && l.lede.length, `${l.slug} has a title, blurb and lede`);
    for (const [i, s] of l.steps.entries()) {
      assert.ok(s.say.length > 10, `${l.slug} step ${i + 1} is narrated`);
      assert.ok(s.shots.some((cmd) => cmd.verb !== 'wait' && cmd.verb !== 'key'), `${l.slug} step ${i + 1} shows something in the studio`);
    }
    assert.equal(l.script[0].id, 'intro');
    assert.equal(l.script.length, 1 + l.steps.length + (l.takeaway ? 1 : 0));
  }
  assert.equal(mv.lessons[0].setup, 'empty', 'lesson 1 starts on an empty desk');
  // One folder per language; only English this pass.
  assert.deepEqual(readdirSync(path.join(root, 'content', 'school')), ['en']);
});

test('school content: a lesson without narration, or with an unknown studio command, is refused', () => {
  const ok = '---\ntitle: T\nblurb: B\n---\nLede.\n\n## Steps\n1. Do it.\n   say: Do it now, please.\n   do: click "Export"\n';
  assert.equal(parseLesson(ok, '/x/01-t.md', 'c').steps.length, 1);
  assert.throws(() => parseLesson(ok.replace(/   say:.*\n/, ''), '/x/01-t.md', 'c'), /has no say:/);
  assert.throws(() => parseLesson(ok.replace('click "Export"', 'drag "Export"'), '/x/01-t.md', 'c'), /unknown do: command/);
  assert.throws(() => parseLesson(ok, '/x/t.md', 'c'), /NN-slug\.md/);
  assert.deepEqual(parseShots('click "A b"; wait 1.5; key Escape; show "C"', 'f'), [
    { verb: 'click', arg: 'A b' },
    { verb: 'wait', arg: '1.5' },
    { verb: 'key', arg: 'Escape' },
    { verb: 'show', arg: 'C' },
  ]);
  assert.throws(() => parseShots('click Export', 'f'), /quoted text/);
});

test('school pages: home, course and lesson render in the site shell; Read works with no media; unknown paths 404', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const home = await getPage(s.base, '/school');
    assert.equal(home.status, 200);
    assert.match(home.html, /<a class="nl" href="\/school" aria-current="page">School<\/a>/);
    assert.match(home.html, /href="\/site\/site\.css"/);
    assert.match(home.html, /Maiden Voyage/);
    assert.match(home.html, /12 lessons/);
    assert.match(home.html, /Everything here is free/);
    assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(home.html), 'self-hosted fonts only');
    assert.equal((await getPage(s.base, '/school/', 'manual')).status, 301);

    const course = await getPage(s.base, '/school/maiden-voyage');
    assert.equal(course.status, 200);
    assert.equal((course.html.match(/class="ls"/g) ?? []).length, 12);
    assert.match(course.html, /href="\/school\/maiden-voyage\/bring-your-book-in"/);

    const lesson = await getPage(s.base, '/school/maiden-voyage/pass-inspection');
    assert.equal(lesson.status, 200);
    assert.match(lesson.html, /Lesson 11 of 12/);
    assert.match(lesson.html, /data-mode="read"/);
    assert.ok(!/data-mode="watch"|data-mode="listen"|<video|<audio/.test(lesson.html), 'no media folder → Read only, nothing invented');
    assert.match(lesson.html, /href="\/help\/check-your-book"/);
    assert.match(lesson.html, /href="\/studio" target="_blank"/);

    assert.equal((await getPage(s.base, '/school/no-such-course')).status, 404);
    assert.equal((await getPage(s.base, '/school/maiden-voyage/no-such-lesson')).status, 404);
  } finally {
    await s.close();
  }
});

test('school media: a manifest turns on Watch and Listen with the files from /school/media; a missing file turns its view off', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const dir = path.join(s.config.schoolMediaDir, 'en', 'maiden-voyage', 'make-a-cover');
    mkdirSync(dir, { recursive: true });
    for (const f of ['video.mp4', 'audio.mp3', 'step-1.jpg']) writeFileSync(path.join(dir, f), 'x');
    const manifest = {
      video: { file: 'video.mp4', seconds: 75.4 },
      audio: { file: 'audio.mp3', seconds: 75.4 },
      shots: ['step-1.jpg', 'step-2.jpg'],
      cues: { intro: 0, 'step-1': 9.5 },
      voice: 'Kokoro-82M, af_heart',
      recordedAt: '2026-10-28T20:00:00.000Z',
      studioBuild: '0.1.0',
    };
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    let html = (await getPage(s.base, '/school/maiden-voyage/make-a-cover')).html;
    assert.match(html, /<video[^>]+src="\/school\/media\/en\/maiden-voyage\/make-a-cover\/video\.mp4"/);
    assert.match(html, /<audio[^>]+src="\/school\/media\/en\/maiden-voyage\/make-a-cover\/audio\.mp3"/);
    assert.match(html, /Watch · 1:15/);
    assert.match(html, /data-seek="9\.5"/);
    assert.match(html, /Narrated by an AI voice \(Kokoro-82M, af_heart\)/);
    assert.match(html, /step-1\.jpg/);
    assert.ok(!html.includes('step-2.jpg'), 'a screenshot that is not on disk is not shown');
    // The course page uses the measured length.
    assert.match((await getPage(s.base, '/school/maiden-voyage')).html, /1:15/);

    // The manifest names a video that is not there: Watch disappears, Listen stays.
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, video: { file: 'gone.mp4', seconds: 10 } }));
    html = (await getPage(s.base, '/school/maiden-voyage/make-a-cover')).html;
    assert.ok(!html.includes('<video'), 'no video when its file is missing');
    assert.match(html, /<audio/);
  } finally {
    await s.close();
  }
});

test('school progress: anonymous visitors get nothing kept; a signed-in writer marks lessons done and undone', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const anon = new Client(s.base);
    assert.equal((await anon.get('/api/school/progress')).status, 401);
    assert.equal((await anon.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'make-a-cover', done: true })).status, 401);
    assert.equal(Number((await db.query<{ n: number }>('select count(*)::int as n from school_progress')).rows[0].n), 0);

    const c = new Client(s.base);
    await registerUser(c, 'learner@example.com');
    assert.deepEqual((await c.get('/api/school/progress')).body, { done: [] });
    const r = await c.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'make-a-cover', done: true });
    assert.equal(r.status, 200);
    const done = r.body.done as { course: string; lesson: string; completedAt: string }[];
    assert.equal(done.length, 1);
    assert.equal(done[0].lesson, 'make-a-cover');
    assert.match(done[0].completedAt, /^\d{4}-\d{2}-\d{2}T/);
    // Marking it again is harmless.
    assert.equal(((await c.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'make-a-cover', done: true })).body.done as unknown[]).length, 1);
    assert.equal((await c.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'nope', done: true })).status, 404);
    assert.equal((await c.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'make-a-cover' })).status, 400);

    // Another writer sees only their own.
    const other = new Client(s.base);
    await registerUser(other, 'other@example.com');
    assert.deepEqual((await other.get('/api/school/progress')).body, { done: [] });

    assert.deepEqual((await c.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'make-a-cover', done: false })).body, { done: [] });
  } finally {
    await s.close();
  }
});

test('school progress belongs to the account: in "Download all my data" and gone with "Delete my account"', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const c = new Client(s.base);
    await registerUser(c, 'leaving@example.com');
    await c.post('/api/school/progress', { course: 'maiden-voyage', lesson: 'read-it-back', done: true });
    const zip = await c.download('/api/account/export');
    assert.equal(zip.status, 200);
    const entry = readZip(zip.bytes).find((e) => e.name === 'school.json');
    assert.ok(entry, 'school.json is in the export');
    const school = JSON.parse(entry.data.toString('utf8')) as { lessonsDone: { lesson: string }[] };
    assert.deepEqual(school.lessonsDone.map((l) => l.lesson), ['read-it-back']);

    const del = await c.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: 'delete my account' });
    assert.equal(del.status, 200);
    assert.equal((del.body.removed as Record<string, number>).school_progress, 1);
    assert.equal(Number((await db.query<{ n: number }>('select count(*)::int as n from school_progress')).rows[0].n), 0);
  } finally {
    await s.close();
  }
});

test('the site links School: every site page nav and footer, the sitemap lists every lesson, Caddy routes media before pages', async () => {
  const pages = ['index.html', 'features.html', 'ramp.html', ...readdirSync(path.join(root, 'client', 'site', 'compare')).map((f) => `compare/${f}`)];
  for (const p of pages) {
    const html = readFileSync(path.join(root, 'client', 'site', p), 'utf8');
    assert.match(html, /<a class="nl" href="\/school">School<\/a>/, `${p} nav links School`);
    assert.match(html, /<a href="\/school">School<\/a>/, `${p} footer links School`);
  }
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const xml = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.match(xml, /<loc>http:\/\/127\.0\.0\.1\/school<\/loc>/);
    assert.match(xml, /\/school\/maiden-voyage\/the-print-edition<\/loc>/);
    assert.equal((xml.match(/\/school\/maiden-voyage\//g) ?? []).length, 12);
  } finally {
    await s.close();
  }
  const caddy = readFileSync(path.join(root, 'Caddyfile'), 'utf8');
  assert.ok(caddy.indexOf('handle /school/media/*') >= 0 && caddy.indexOf('handle /school/media/*') < caddy.indexOf('handle /school* {'));
  assert.match(caddy, /root \* \/srv\/school-media/);
});
