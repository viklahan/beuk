import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getSchoolContent } from '../src/school/content.js';
import { checkWeeklyContent, inkSvg, loadWeeklyContent, parseStory } from '../src/weekly/content.js';
import { createTestDb, startTestServer } from './helpers.js';

/* Beuk Weekly (V, 2026-10-28): the School's newspaper, black on white. */

const root = path.resolve(import.meta.dirname, '..');

async function getPage(base: string, p: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(`${base}${p}`, { redirect });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

/* The shelf (V, 2026-11-20): five issues in date order. The School issue,
   first published as No. 1, is No. 3; four news issues stand round it. */
const SHELF: Record<number, { week: string; lead: string; shorts: string[] }> = {
  1: { week: '2026-10-19', lead: 'kindle-plus', shorts: ['acx-deadline', 'etsy-sweetens-the-season', 'epubcheck-540', 'youtube-clears-its-throat'] },
  2: { week: '2026-10-26', lead: 'wide-side-widening', shorts: ['amazon-dust', 'audiobook-house-in-the-andes', 'eighty-bookstores', 'tools-get-cheaper'] },
  4: { week: '2026-11-09', lead: 'what-harpercollins-told-indies', shorts: ['year-of-the-niche', 'norways-price-fence', 'audiobooks-at-35000-feet'] },
  5: { week: '2026-11-16', lead: 'royalty-math', shorts: ['sixty-four-million', 'three-more-flags', 'two-paris-houses', 'epub-34-at-the-door'] },
};

test('weekly content: the School issue is No. 3, parses clean, its lead is named, every front and fold story has a summary, every picture is on disk', () => {
  const w = loadWeeklyContent('en');
  assert.deepEqual(checkWeeklyContent(w), []);
  assert.equal(w.issues.length, 5);
  assert.deepEqual(w.issues.map((i) => i.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(w.issues.map((i) => i.week), [...w.issues.map((i) => i.week)].sort(), 'the numbers follow the dates');
  assert.equal(w.latest!.number, 5);
  const one = w.issueByNumber.get(3)!;
  assert.equal(one.formerly, 1, 'it says which number it was first published under');
  assert.equal(one.weather, null, 'no weather reading was taken for it, so none is shown');
  assert.equal(one.lead.slug, 'school-opens');
  assert.equal(one.front.length, 3);
  assert.equal(one.briefs.length, 3);
  assert.equal(one.fold.length, 3);
  assert.equal(one.notices.length, 0, 'no notice is printed until there is a real offer');
  assert.equal(one.week, '2026-11-02');
  // No course may take the Weekly's address.
  assert.ok(!getSchoolContent().courseBySlug.has('weekly'));
});

test('weekly content: each news issue has its lead, its short stories in order, one takeaway of five, a weather reading and the source for it', () => {
  const w = loadWeeklyContent('en');
  for (const [n, want] of Object.entries(SHELF)) {
    const issue = w.issueByNumber.get(Number(n))!;
    assert.equal(issue.week, want.week);
    assert.equal(issue.lead.slug, want.lead);
    assert.equal(issue.lead.byline, 'The Beuk Desk');
    assert.deepEqual(issue.shorts.map((s) => s.slug), want.shorts);
    for (const s of [issue.lead, ...issue.shorts]) {
      assert.ok(s.hasPage, `${s.slug} has a page`);
      assert.equal(s.blocks.filter((b) => b.kind === 'why').length, 1, `${s.slug} says why it matters, once`);
      assert.ok(s.blocks.some((b) => b.kind === 'p' && /<a href="https:\/\//.test(b.html)), `${s.slug} links its source`);
    }
    assert.equal(issue.takeaways.length, 1);
    assert.equal(issue.takeaways[0].title, "If You're Shipping a Book This Month");
    assert.equal(issue.takeaways[0].blocks.length, 5);
    assert.ok(!issue.takeaways[0].hasPage);
    assert.ok(issue.weather && issue.weather.icon?.startsWith('<svg '), 'the weather ear and its icon');
    assert.match(issue.weather!.reading, /\d+\u00a0°C$/);
    assert.match(issue.sourcesHead ?? '', /^Sources/);
    assert.ok(issue.sources.length >= 3);
    assert.ok(issue.sources.every((x) => /^<a href="https:\/\/[^"]+">[^<]+<\/a>$/.test(x.html)), 'every source is a link');
    assert.ok(issue.sources.some((x) => /weather/i.test(x.text)), 'the weather reading is cited');
    // Every outside page a story links is in the issue's sources; a link into the paper itself must lead to a story that is there.
    const listed = new Set(issue.sources.map((x) => /href="([^"]+)"/.exec(x.html)![1]));
    for (const s of issue.storyBySlug.values()) {
      for (const b of s.blocks) {
        if (b.kind === 'sub') continue;
        for (const m of b.html.matchAll(/href="([^"]+)"/g)) {
          const own = /^\/school\/weekly\/(\d+)\/([a-z0-9-]+)$/.exec(m[1]);
          if (own) assert.ok(w.issueByNumber.get(Number(own[1]))?.storyBySlug.get(own[2])?.hasPage, `${s.slug}: ${m[1]} is a story with a page`);
          else assert.ok(listed.has(m[1]), `${s.slug}: ${m[1]} is in the sources`);
        }
      }
    }
  }
  // No. 5's Kobo story points back at No. 4's Book Report story, the "deep dive" it names.
  const flags = w.issueByNumber.get(5)!.storyBySlug.get('three-more-flags')!;
  assert.ok(flags.blocks.some((b) => b.kind === 'p' && b.html.includes('<a href="/school/weekly/4/year-of-the-niche">last week\'s deep dive</a>')));
});

test('weekly content: a weather reading without a source is a problem; an icon is plain shapes or it is refused', () => {
  const w = loadWeeklyContent('en');
  const five = w.issueByNumber.get(5)!;
  const bare = { ...w, issues: w.issues.map((i) => (i === five ? { ...five, sources: [] } : i)) };
  assert.deepEqual(checkWeeklyContent(bare), ["issue 5: a weather reading needs its source in the issue's sources"]);
  assert.equal(inkSvg('<svg viewBox="0 0 4 4">\n  <g fill="none"><circle cx="2" cy="2" r="1"/></g>\n</svg>\n', 'i.svg'), '<svg viewBox="0 0 4 4"><g fill="none"><circle cx="2" cy="2" r="1"/></g></svg>');
  assert.throws(() => inkSvg('<svg><script>alert(1)</script></svg>', 'i.svg'), /cannot hold|no text/);
  assert.throws(() => inkSvg('<svg onload="x()"></svg>', 'i.svg'), /cannot carry/);
  assert.throws(() => inkSvg('<svg><circle fill="url(javascript:1)"/></svg>', 'i.svg'), /cannot carry/);
  assert.throws(() => inkSvg('<svg><a href="/x"><circle/></a></svg>', 'i.svg'), /cannot hold/);
  assert.throws(() => inkSvg('<svg></svg><p>x</p>', 'i.svg'), /one <svg>|cannot hold/);
  assert.throws(() => inkSvg('<svg>words</svg>', 'i.svg'), /no text/);
});

test('weekly content: a story without a title, with an unknown place or an unsafe picture name is refused', () => {
  const ok = '---\ntitle: T\nsection: S\nplace: front\nsummary: x\n---\nA paragraph.\n';
  assert.equal(parseStory(ok, '/x/a-story.md', 1).place, 'front');
  assert.throws(() => parseStory(ok.replace('title: T\n', ''), '/x/a.md', 1), /needs "title"/);
  assert.throws(() => parseStory(ok.replace('place: front', 'place: sidebar'), '/x/a.md', 1), /unknown place/);
  assert.throws(() => parseStory(ok.replace('summary: x', 'image: ../../etc/passwd'), '/x/a.md', 1), /plain .jpg/);
  const blocks = parseStory('---\ntitle: T\nsection: S\n---\nOne.\n\n## Sub\n\n> A pull quote.\n\nTwo.\n', '/x/b.md', 1).blocks.map((b) => b.kind);
  assert.deepEqual(blocks, ['p', 'sub', 'pull', 'p']);
  const why = parseStory('---\ntitle: T\nsection: S\nplace: short\n---\nOne, [sourced](https://example.org/a).\n\n:: It matters.\n', '/x/c.md', 1);
  assert.deepEqual(why.blocks.map((b) => b.kind), ['p', 'why']);
  assert.ok(why.hasPage, 'a short story has a page of its own');
  assert.ok(!parseStory('---\ntitle: T\nsection: S\nplace: takeaway\n---\nOne.\n', '/x/d.md', 1).hasPage);
});

test('weekly pages: front page, a story, a picture; briefs have no page; unknown issues and stories 404; no printed PDF link without the file', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const front = await getPage(s.base, '/school/weekly');
    assert.equal(front.status, 200);
    assert.match(front.html, /<h1>Beuk Weekly<\/h1>/);
    // /school/weekly is the latest issue: No. 5 today.
    assert.match(front.html, /class="banner" href="\/school\/weekly\/5\/royalty-math">Amazon Rewires the Royalty Math<\/a>/);
    assert.match(front.html, /<span>Vol\. I · No\. 5<\/span>/);
    assert.match(front.html, /Week of 16 November 2026/);
    assert.match(front.html, /<p class="kick">Earlier issues<\/p>/);
    for (const n of [1, 2, 3, 4]) assert.ok(front.html.includes(`<li><a href="/school/weekly/${n}">No. ${n} · `), `the latest issue lists No. ${n}`);
    const three = await getPage(s.base, '/school/weekly/3');
    assert.equal(three.status, 200);
    assert.match(three.html, /class="banner" href="\/school\/weekly\/3\/school-opens">Beuk School Opens Its Doors<\/a>/);
    assert.match(three.html, /<span>Vol\. I · No\. 3<\/span>/);
    assert.match(three.html, /Week of 2 November 2026/);
    assert.match(three.html, /<b>Shipping forecast<\/b>Fair\. Eleven shores open/, 'its own ears, as printed');
    assert.match(three.html, /<p class="mast-tag">And Complete Self-Publishing News<\/p>/);
    assert.match(three.html, /<p class="kick">Other issues<\/p>/, 'an older issue lists later ones too, so it does not call them earlier');
    assert.match(front.html, /href="\/assets\/fonts\/fonts-weekly\.css"/);
    assert.match(front.html, /<a href="\/school\/weekly" aria-current="page">Beuk Weekly<\/a>/);
    assert.match(front.html, /<a class="nl" href="\/school" aria-current="page">School<\/a>/);
    assert.ok(!front.html.includes('printed PDF'), 'no PDF on disk → no link to one');
    assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(front.html));
    assert.equal((await getPage(s.base, '/school/weekly/1')).status, 200);
    assert.equal((await getPage(s.base, '/school/weekly/', 'manual')).status, 301);

    const story = await getPage(s.base, '/school/weekly/3/twenty-four-trims');
    assert.equal(story.status, 200);
    assert.match(story.html, /<h2>Twenty-Four Trims, Measured to the Hundredth<\/h2>/);
    assert.match(story.html, /src="\/school\/weekly\/3\/img\/trims\.jpg"/);
    assert.match(story.html, /class="pull"/);
    assert.match(story.html, /Vol\. I · No\. 3 · Week of 2 November 2026/);

    const img = await fetch(`${s.base}/school/weekly/3/img/trims.jpg`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${s.base}/school/weekly/3/img/..%2Fissue.md`)).status, 404);
    assert.equal((await fetch(`${s.base}/school/weekly/3/img/issue.md`)).status, 404);
    assert.equal((await fetch(`${s.base}/school/weekly/5/img/weather.svg`)).status, 404, 'the icon is set into the page, not served as a file');

    assert.equal((await getPage(s.base, '/school/weekly/3/brief-your-words')).status, 404, 'a brief has no page of its own');
    assert.equal((await getPage(s.base, '/school/weekly/5/takeaway')).status, 404, 'a takeaway has no page of its own');
    assert.equal((await getPage(s.base, '/school/weekly/9')).status, 404);
    assert.equal((await getPage(s.base, '/school/weekly/1/nope')).status, 404);

    // The School issue was No. 1 once: its stories' old addresses lead to the new ones.
    const old = await getPage(s.base, '/school/weekly/1/twenty-four-trims', 'manual');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/school/weekly/3/twenty-four-trims');
    assert.equal((await getPage(s.base, '/school/weekly/1/brief-your-words', 'manual')).status, 404, 'nothing leads to a page that never was');
    assert.equal((await getPage(s.base, '/school/weekly/2/twenty-four-trims', 'manual')).status, 404);

    // A news issue: the Beuk lockup and the weather in the ears, every story whole, the takeaway, the sources, the imprint.
    for (const [n, want] of Object.entries(SHELF)) {
      const page = await getPage(s.base, `/school/weekly/${n}`);
      assert.equal(page.status, 200);
      assert.match(page.html, new RegExp(`<span>Vol\\. I · No\\. ${n}</span>`));
      assert.match(page.html, /<div class="ear logo-ear"><svg class="mark"[^>]*>.*?<\/svg><span class="word">beuk<\/span><span class="sub">beuk\.studio<\/span><\/div>/);
      assert.match(page.html, /<div class="ear wx"><b>The Weather Elsewhere<\/b><svg viewBox="0 0 64 38"/);
      assert.match(page.html, /<p class="mast-tag">The indie publisher's broadsheet<\/p>/);
      assert.ok(page.html.includes(`class="banner" href="/school/weekly/${n}/${want.lead}"`));
      for (const slug of want.shorts) assert.ok(page.html.includes(`<h3><a href="/school/weekly/${n}/${slug}">`), `No. ${n} prints ${slug}`);
      assert.equal(page.html.split('<div class="why"><b>Why it matters</b>').length - 1, want.shorts.length, 'each short story says why it matters on the front page');
      assert.match(page.html, /<section class="takeaway"[^>]*>\s*<h3>If You're Shipping a Book This Month<\/h3>\s*<p class="sub">Five instructions from the composing room<\/p>\s*<ol>(<li><span>.*?<\/span><\/li>){5}<\/ol>/);
      assert.match(page.html, /<section class="sources" aria-label="Sources"><h4>Sources — fetched in full/);
      assert.ok(!/\bdraft\b/i.test(page.html.slice(page.html.indexOf('<div class="paper">'))), 'nothing on the paper is marked a draft ("drafted" is a word a story may use)');
      for (const slug of [want.lead, ...want.shorts]) {
        const art = await getPage(s.base, `/school/weekly/${n}/${slug}`);
        assert.equal(art.status, 200, `/school/weekly/${n}/${slug}`);
        assert.match(art.html, /<div class="why"><b>Why it matters<\/b>/);
        assert.match(art.html, /<a href="https:\/\//);
      }
    }
    // Every issue, the School one too, closes on the same imprint.
    for (const n of [1, 2, 3, 4, 5]) {
      const html = (await getPage(s.base, `/school/weekly/${n}`)).html;
      assert.match(html, /<footer class="imprint">\s*<span>Printed and published by Beuk<\/span>\s*<span>Free every week<\/span>\s*<span>Printed on recycled electrons<\/span>\s*<\/footer>/);
    }

    // The School home points at this week's paper; the courses tab is current there.
    const school = await getPage(s.base, '/school');
    assert.match(school.html, /class="weekly-band" href="\/school\/weekly"/);
    assert.match(school.html, /<span class="wb-no">No\. 5 · out now<\/span>\s*<span class="wb-head">Amazon Rewires the Royalty Math<\/span>/, 'the band follows the latest issue');
    assert.match(school.html, /<a href="\/school" aria-current="page">Courses<\/a>/);

    // A printed edition on the server turns the link on.
    const dir = path.join(s.config.schoolMediaDir, 'weekly', 'en');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'issue-005.pdf'), '%PDF-1.7');
    assert.match((await getPage(s.base, '/school/weekly')).html, /href="\/school\/media\/weekly\/en\/issue-005\.pdf">This issue as a printed PDF/);
    assert.ok(!(await getPage(s.base, '/school/weekly/3')).html.includes('printed PDF'), 'one issue\'s PDF is not another\'s');

    const xml = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.match(xml, /\/school\/weekly<\/loc>/);
    assert.match(xml, /\/school\/weekly\/3\/inside-the-ramp<\/loc>/);
    assert.match(xml, /\/school\/weekly\/5\/epub-34-at-the-door<\/loc>/);
    assert.ok(!xml.includes('/takeaway<'), 'a takeaway has no page, so no sitemap entry');
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
  assert.match(detail, /5 issue\(s\); latest No\. 5, 2026-11-16: Amazon Rewires the Royalty Math/);
});
