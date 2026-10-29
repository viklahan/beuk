import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getSchoolContent } from '../src/school/content.js';
import { checkWeeklyContent, loadWeeklyContent, parseStory } from '../src/weekly/content.js';
import { createTestDb, startTestServer } from './helpers.js';

/* Beuk Weekly (V, 2026-10-28): the School's newspaper, black on white. */

const root = path.resolve(import.meta.dirname, '..');

async function getPage(base: string, p: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(`${base}${p}`, { redirect });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

test('weekly content: issue 1 parses clean, its lead is named, every front and fold story has a summary, every picture is on disk', () => {
  const w = loadWeeklyContent('en');
  assert.deepEqual(checkWeeklyContent(w), []);
  assert.equal(w.issues.length, 1);
  const one = w.issueByNumber.get(1)!;
  assert.equal(one.lead.slug, 'school-opens');
  assert.equal(one.front.length, 3);
  assert.equal(one.briefs.length, 3);
  assert.equal(one.fold.length, 3);
  assert.equal(one.notices.length, 0, 'no notice is printed until there is a real offer');
  assert.equal(one.week, '2026-11-02');
  // No course may take the Weekly's address.
  assert.ok(!getSchoolContent().courseBySlug.has('weekly'));
});

test('weekly content: a story without a title, with an unknown place or an unsafe picture name is refused', () => {
  const ok = '---\ntitle: T\nsection: S\nplace: front\nsummary: x\n---\nA paragraph.\n';
  assert.equal(parseStory(ok, '/x/a-story.md', 1).place, 'front');
  assert.throws(() => parseStory(ok.replace('title: T\n', ''), '/x/a.md', 1), /needs "title"/);
  assert.throws(() => parseStory(ok.replace('place: front', 'place: sidebar'), '/x/a.md', 1), /unknown place/);
  assert.throws(() => parseStory(ok.replace('summary: x', 'image: ../../etc/passwd'), '/x/a.md', 1), /plain .jpg/);
  const blocks = parseStory('---\ntitle: T\nsection: S\n---\nOne.\n\n## Sub\n\n> A pull quote.\n\nTwo.\n', '/x/b.md', 1).blocks.map((b) => b.kind);
  assert.deepEqual(blocks, ['p', 'sub', 'pull', 'p']);
});

test('weekly pages: front page, a story, a picture; briefs have no page; unknown issues and stories 404; no printed PDF link without the file', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const front = await getPage(s.base, '/school/weekly');
    assert.equal(front.status, 200);
    assert.match(front.html, /<h1>Beuk Weekly<\/h1>/);
    assert.match(front.html, /class="banner" href="\/school\/weekly\/1\/school-opens">Beuk School Opens Its Doors<\/a>/);
    assert.match(front.html, /Week of 2 November 2026/);
    assert.match(front.html, /href="\/assets\/fonts\/fonts-weekly\.css"/);
    assert.match(front.html, /<a href="\/school\/weekly" aria-current="page">Beuk Weekly<\/a>/);
    assert.match(front.html, /<a class="nl" href="\/school" aria-current="page">School<\/a>/);
    assert.ok(!front.html.includes('printed PDF'), 'no PDF on disk → no link to one');
    assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(front.html));
    assert.equal((await getPage(s.base, '/school/weekly/1')).status, 200);
    assert.equal((await getPage(s.base, '/school/weekly/', 'manual')).status, 301);

    const story = await getPage(s.base, '/school/weekly/1/twenty-four-trims');
    assert.equal(story.status, 200);
    assert.match(story.html, /<h2>Twenty-Four Trims, Measured to the Hundredth<\/h2>/);
    assert.match(story.html, /src="\/school\/weekly\/1\/img\/trims\.jpg"/);
    assert.match(story.html, /class="pull"/);

    const img = await fetch(`${s.base}/school/weekly/1/img/trims.jpg`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${s.base}/school/weekly/1/img/..%2Fissue.md`)).status, 404);
    assert.equal((await fetch(`${s.base}/school/weekly/1/img/issue.md`)).status, 404);

    assert.equal((await getPage(s.base, '/school/weekly/1/brief-your-words')).status, 404, 'a brief has no page of its own');
    assert.equal((await getPage(s.base, '/school/weekly/9')).status, 404);
    assert.equal((await getPage(s.base, '/school/weekly/1/nope')).status, 404);

    // The School home points at this week's paper; the courses tab is current there.
    const school = await getPage(s.base, '/school');
    assert.match(school.html, /class="weekly-band" href="\/school\/weekly"/);
    assert.match(school.html, /<a href="\/school" aria-current="page">Courses<\/a>/);

    // A printed edition on the server turns the link on.
    const dir = path.join(s.config.schoolMediaDir, 'weekly', 'en');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'issue-001.pdf'), '%PDF-1.7');
    assert.match((await getPage(s.base, '/school/weekly')).html, /href="\/school\/media\/weekly\/en\/issue-001\.pdf">This issue as a printed PDF/);

    const xml = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.match(xml, /\/school\/weekly<\/loc>/);
    assert.match(xml, /\/school\/weekly\/1\/inside-the-ramp<\/loc>/);
    assert.ok(!xml.includes('brief-'), 'briefs have no page, so no sitemap entry');
  } finally {
    await s.close();
  }
});

test('weekly.css only uses the weights fonts-weekly.css ships (no faked bold)', () => {
  const css = readFileSync(path.join(root, 'client', 'site', 'weekly.css'), 'utf8');
  // Oswald ships 500–600, Playfair Display italic 500; nothing asks Oswald for 700 or Playfair italic for 700.
  for (const m of css.matchAll(/font:\s*(italic\s+)?(\d{3})\s+[^;]*var\(--(gothic|deckf)\)/g)) {
    const w = Number(m[2]);
    if (m[3] === 'gothic') assert.ok(w >= 500 && w <= 600, `Oswald at ${w}`);
    if (m[3] === 'deckf' && m[1]) assert.equal(w, 500, `Playfair italic at ${w}`);
  }
});

test('Housekeeping self-check: Beuk Weekly content parses clean', async () => {
  const { SELF_CHECK_CASES, buildCheckContext } = await import('../src/housekeeping/registry.js');
  const { testConfig } = await import('./helpers.js');
  const ctx = buildCheckContext(await createTestDb(), testConfig());
  const detail = await SELF_CHECK_CASES.find((c) => c.id === 'weekly.content.parses-clean')!.run!(ctx);
  assert.match(detail, /1 issue\(s\); latest No\. 1, 2026-11-02: Beuk School Opens Its Doors/);
});
