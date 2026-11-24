import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getSchoolContent } from '../src/school/content.js';
import { checkWeeklyContent, inkSvg, loadWeeklyContent, parseStory, type Issue, type WeeklyContent } from '../src/weekly/content.js';
import { renderIssue, renderStand, TILE_INSIDE, weekLabel } from '../src/weekly/render.js';
import { escapeHtml } from '../src/warmth/markdown.js';
import { createTestDb, startTestServer } from './helpers.js';

/* Beuk Weekly (V, 2026-10-28): the School's newspaper, black on white. */

const root = path.resolve(import.meta.dirname, '..');

async function getPage(base: string, p: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(`${base}${p}`, { redirect });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

const between = (html: string, start: string, end: string) => {
  const i = html.indexOf(start);
  assert.ok(i >= 0, `${start} is on the page`);
  return html.slice(i, html.indexOf(end, i) + end.length);
};

/* The shelf (V, 2026-11-20): the issues in date order. The School issue,
   first published as No. 1, is No. 3; the news issues stand round it.
   No. 6 (23 Nov) is the first to carry a leader, the paper's opinion column. */
const SHELF: Record<number, { week: string; lead: string; shorts: string[]; leader?: string }> = {
  1: { week: '2026-10-19', lead: 'kindle-plus', shorts: ['acx-deadline', 'etsy-sweetens-the-season', 'epubcheck-540', 'youtube-clears-its-throat'] },
  2: { week: '2026-10-26', lead: 'wide-side-widening', shorts: ['amazon-dust', 'audiobook-house-in-the-andes', 'eighty-bookstores', 'tools-get-cheaper'] },
  4: { week: '2026-11-09', lead: 'what-harpercollins-told-indies', shorts: ['year-of-the-niche', 'norways-price-fence', 'audiobooks-at-35000-feet'] },
  5: { week: '2026-11-16', lead: 'royalty-math', shorts: ['sixty-four-million', 'three-more-flags', 'two-paris-houses', 'epub-34-at-the-door'] },
  6: { week: '2026-11-23', lead: 'vellum-blinks-twice', shorts: ['settlement-checks-in-the-mail', 'ten-percent-of-the-random-house', 'a-receipt-not-a-license'], leader: 'the-scandals-will-end' },
};

test('weekly content: the School issue is No. 3, parses clean, its lead is named, every front and fold story has a summary, every picture is on disk', () => {
  const w = loadWeeklyContent('en');
  assert.deepEqual(checkWeeklyContent(w), []);
  assert.equal(w.issues.length, 6);
  assert.deepEqual(w.issues.map((i) => i.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(w.issues.map((i) => i.week), [...w.issues.map((i) => i.week)].sort(), 'the numbers follow the dates');
  assert.equal(w.latest!.number, 6);
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
    assert.deepEqual(issue.leaders.map((s) => s.slug), want.leader ? [want.leader] : [], 'its leader, when it carries one');
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

/* The leader (No. 6, 2026-11-23): the paper's own opinion, kept apart from the news. It says it is
   opinion in its kicker, links what it answers, stands once in an issue, and is not news: no "Why it matters". */
test('weekly content: a leader is opinion, labelled so, linked to what it answers, one to an issue', () => {
  const w = loadWeeklyContent('en');
  const six = w.issueByNumber.get(6)!;
  const leader = six.leaders[0];
  assert.equal(leader.place, 'leader');
  assert.match(leader.section, /opinion/i, 'the kicker says it is opinion');
  assert.ok(leader.hasPage, 'a leader has a page of its own');
  assert.equal(leader.blocks.filter((b) => b.kind === 'why').length, 0, 'opinion carries no "Why it matters"');
  assert.ok(!six.shorts.includes(leader), 'it is not counted among the news');
  assert.ok(leader.blocks.some((b) => b.kind === 'p' && b.html.includes('<em>We think she is right about the quiet')), 'the sentence set apart in the column stays set apart');

  const src = (front: string, body: string) => `---\ntitle: T\n${front}\nplace: leader\n---\n${body}\n`;
  const withLeaders = (...stories: ReturnType<typeof parseStory>[]): WeeklyContent => ({ ...w, issues: w.issues.map((i) => (i === six ? { ...six, leaders: stories } : i)) });
  const good = parseStory(src('section: The Leader · Opinion', 'We answer [a piece](https://example.org/a).'), '/x/good.md', 6);
  assert.deepEqual(checkWeeklyContent(withLeaders(good)), []);
  const unlabelled = parseStory(src('section: The Leader', 'We answer [a piece](https://example.org/a).'), '/x/unlabelled.md', 6);
  assert.deepEqual(checkWeeklyContent(withLeaders(unlabelled)), ['/x/unlabelled.md: a leader is opinion and its section must say so']);
  const unlinked = parseStory(src('section: The Leader · Opinion', 'We answer nobody in particular.'), '/x/unlinked.md', 6);
  assert.deepEqual(checkWeeklyContent(withLeaders(unlinked)), ['/x/unlinked.md: a leader links what it answers']);
  const dressed = parseStory(src('section: The Leader · Opinion', 'We answer [a piece](https://example.org/a).\n\n:: It matters.'), '/x/dressed.md', 6);
  assert.deepEqual(checkWeeklyContent(withLeaders(dressed)), ['/x/dressed.md: a leader is not news and carries no "Why it matters"']);
  assert.deepEqual(checkWeeklyContent(withLeaders(good, good)), ['issue 6: one leader to an issue']);
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
    // /school/weekly is the stand (V, 2026-11-21); the latest issue, No. 6 today, is at its own number.
    const front = await getPage(s.base, '/school/weekly/6');
    assert.equal(front.status, 200);
    assert.match(front.html, /<h1>Beuk Weekly<\/h1>/);
    assert.match(front.html, /class="banner" href="\/school\/weekly\/6\/vellum-blinks-twice">Vellum Blinks Twice<\/a>/);
    assert.match(front.html, /<span>Vol\. I · No\. 6<\/span>/);
    assert.match(front.html, /Week of 23 November 2026/);
    assert.match(front.html, /<section class="issues" id="issues" aria-labelledby="issues-h">\s*<h2 id="issues-h">All issues<\/h2>/);
    for (const n of [1, 2, 3, 4, 5]) assert.ok(front.html.includes(`<li><a href="/school/weekly/${n}"><span class="is-no">No. ${n}</span>`), `the latest issue lists No. ${n}`);
    // The leader stands whole after the news, in the same grid, marked as the leader; its own page opens.
    const shortsHtml = between(front.html, '<section class="shorts"', '</section>');
    assert.deepEqual([...shortsHtml.matchAll(/<article class="story short( leader)?">/g)].map((m) => Boolean(m[1])), [false, false, false, true], 'three news stories, then the leader');
    assert.match(shortsHtml, /<article class="story short leader">\s*<p class="kick">The Leader · Opinion<\/p>\s*<h3><a href="\/school\/weekly\/6\/the-scandals-will-end">The Scandals Will End\. The Scoring Won't\.<\/a><\/h3>/);
    const leaderPage = await getPage(s.base, '/school/weekly/6/the-scandals-will-end');
    assert.equal(leaderPage.status, 200);
    assert.match(leaderPage.html, /<p class="kick">The Leader · Opinion<\/p>/);
    assert.ok(!leaderPage.html.includes('Why it matters'), 'opinion is not dressed as news on its own page either');
    const three = await getPage(s.base, '/school/weekly/3');
    assert.equal(three.status, 200);
    assert.match(three.html, /class="banner" href="\/school\/weekly\/3\/school-opens">Beuk School Opens Its Doors<\/a>/);
    assert.match(three.html, /<span>Vol\. I · No\. 3<\/span>/);
    assert.match(three.html, /Week of 2 November 2026/);
    assert.match(three.html, /<b>Shipping forecast<\/b>Fair\. Eleven shores open/, 'its own ears, as printed');
    assert.match(three.html, /<p class="mast-tag">And Complete Self-Publishing News<\/p>/);
    assert.match(three.html, /<h2 id="issues-h">All issues<\/h2>/, 'an older issue has the same shelf, later issues too');
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
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const html = (await getPage(s.base, `/school/weekly/${n}`)).html;
      assert.match(html, /<footer class="imprint">\s*<span>Printed and published by Beuk<\/span>\s*<span>Free every week<\/span>\s*<span>Printed on recycled electrons<\/span>\s*<\/footer>/);
    }

    // Courses shows courses only (V, 2026-11-21): the Weekly is its own tab, and nothing of it stands on the School home.
    const school = await getPage(s.base, '/school');
    assert.match(school.html, /<a href="\/school" aria-current="page">Courses<\/a>/);
    assert.match(school.html, /<a href="\/school\/weekly">Beuk Weekly<\/a>/, 'the tab is the way to the paper');
    const schoolMain = school.html.slice(school.html.indexOf('<main'), school.html.indexOf('</main>'));
    assert.ok(!schoolMain.includes('/school/weekly'), 'no Weekly band, stand or link among the courses');
    assert.ok(!/weekly-band|weekly-stand|fonts-weekly/.test(school.html), 'and none of its styles or faces are loaded there');

    // A printed edition on the server turns the link on.
    const dir = path.join(s.config.schoolMediaDir, 'weekly', 'en');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'issue-005.pdf'), '%PDF-1.7');
    assert.match((await getPage(s.base, '/school/weekly/5')).html, /href="\/school\/media\/weekly\/en\/issue-005\.pdf">This issue as a printed PDF/);
    assert.ok(!(await getPage(s.base, '/school/weekly/3')).html.includes('printed PDF'), 'one issue\'s PDF is not another\'s');

    const xml = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.match(xml, /\/school\/weekly<\/loc>/);
    assert.match(xml, /\/school\/weekly\/3\/inside-the-ramp<\/loc>/);
    assert.match(xml, /\/school\/weekly\/5\/epub-34-at-the-door<\/loc>/);
    assert.match(xml, /\/school\/weekly\/6\/the-scandals-will-end<\/loc>/, 'a leader has a page, so it is in the sitemap');
    assert.ok(!xml.includes('/takeaway<'), 'a takeaway has no page, so no sitemap entry');
    assert.ok(!xml.includes('brief-'), 'briefs have no page, so no sitemap entry');
  } finally {
    await s.close();
  }
});

/* Findability (V, 2026-11-21: "I don't see all the weeklies"): every issue is one click from every other. */

test('weekly navigation: every issue page has the issue bar under the dateline and the whole shelf, its own issue marked, prev/next exactly when they exist', async () => {
  const w = loadWeeklyContent('en');
  const total = w.issues.length;
  const newest = w.latest!.number;
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    for (const path of w.issues.map((i) => `/school/weekly/${i.number}`)) {
      const html = (await getPage(s.base, path)).html;
      const n = Number(path.split('/').pop());
      // The bar sits right after the dateline, before the banner.
      assert.match(html, /<\/div>\s*<nav class="issue-bar" aria-label="Beuk Weekly issues">/, `${path}: the bar follows the dateline`);
      assert.ok(html.indexOf('class="issue-bar"') < html.indexOf('class="banner"'), `${path}: the bar is above the banner`);
      const bar = between(html, '<nav class="issue-bar"', '</nav>');
      assert.ok(bar.includes(`<span class="ib-pos"><a href="/school/weekly/${n}" aria-current="page">No. ${n}</a> of ${total}</span>`), `${path}: No. ${n} of ${total}, current`);
      assert.ok(bar.includes('<a class="ib-all" href="/school/weekly">All issues</a>'), `${path}: "All issues" is the stand`);
      assert.equal(bar.includes('rel="prev"'), n > 1, `${path}: a previous link exactly when there is an earlier issue`);
      if (n > 1) assert.ok(bar.includes(`<a class="ib-prev" href="/school/weekly/${n - 1}" rel="prev">‹ No. ${n - 1}</a>`));
      assert.equal(bar.includes('rel="next"'), n < newest, `${path}: a next link exactly when there is a later issue`);
      if (n < newest - 1) assert.ok(bar.includes(`<a class="ib-next" href="/school/weekly/${n + 1}" rel="next">No. ${n + 1} ›</a>`));
      // A back issue names the newest; on the one just before it, that link is also "next", said once.
      assert.equal(bar.includes('Newest issue'), n !== newest, `${path}: "Newest issue" on a back issue only`);
      if (n !== newest) assert.ok(bar.includes(`<a class="ib-new" href="/school/weekly/${newest}"${n === newest - 1 ? ' rel="next"' : ''}>Newest issue: No. ${newest} ›</a>`));
      assert.equal(bar.split('href=').length - 1, [n > 1, true, true, n < newest - 1, n !== newest].filter(Boolean).length, `${path}: nothing else in the bar`);

      // The shelf: every issue, the current one too, newest first, with week and headline from the files.
      const shelf = between(html, '<section class="issues" id="issues"', '</section>');
      const listed = [...shelf.matchAll(/<li(?: class="current")?><a href="\/school\/weekly\/(\d+)"( aria-current="page")?><span class="is-no">No\. (\d+)<\/span><span class="is-week">([^<]+)<\/span><span class="is-head">([^<]+)<\/span><\/a><\/li>/g)];
      assert.deepEqual(listed.map((m) => Number(m[1])), w.issues.map((i) => i.number).reverse(), `${path}: every issue, newest first`);
      for (const m of listed) {
        const i = w.issueByNumber.get(Number(m[1]))!;
        assert.equal(Number(m[3]), i.number);
        assert.equal(m[4], weekLabel(i.week));
        assert.equal(m[5], escapeHtml(i.banner), `No. ${i.number}'s headline is its banner`);
        assert.equal(Boolean(m[2]), i.number === n, `${path}: only No. ${n} is current`);
      }
      assert.equal(shelf.split('aria-current="page"').length - 1, 1);
      assert.equal(shelf.split('class="current"').length - 1, 1);
    }
  } finally {
    await s.close();
  }
});

test('weekly navigation degrades: one issue has no bar and no shelf and stands alone on the stand; seven issues fill the shelf and the stand', async () => {
  const { testConfig } = await import('./helpers.js');
  const config = testConfig();
  const w = loadWeeklyContent('en');
  const shelfOf = (issues: Issue[]): WeeklyContent => ({ issues, issueByNumber: new Map(issues.map((i) => [i.number, i])), latest: issues[issues.length - 1], stamp: '' });

  const solo = shelfOf([w.issueByNumber.get(1)!]);
  const page = renderIssue(config, solo, solo.latest!);
  assert.match(page, /<span>Vol\. I · No\. 1<\/span>/, 'the dateline still gives the number');
  assert.ok(!page.includes('issue-bar'), 'a single issue has nowhere to go: no bar');
  assert.ok(!page.includes('id="issues"'), 'and no shelf of one');
  const soloStand = renderStand(config, solo);
  assert.equal(soloStand.split('<li class="tile').length - 1, 1, 'one issue, one tile');
  assert.match(soloStand, /<li class="tile latest">\s*<a href="\/school\/weekly\/1">/, 'and it is the large one');
  assert.match(soloStand, /<span>One issue on the stand<\/span>/);

  // Seven issues: the six real ones and one more, a renumbered copy.
  assert.equal(w.issues.length, 6, 'this test adds one issue to the six on the shelf');
  const seven = shelfOf([...w.issues, { ...w.issueByNumber.get(5)!, number: 7 }]);
  const four = renderIssue(config, seven, seven.issueByNumber.get(4)!);
  const bar = between(four, '<nav class="issue-bar"', '</nav>');
  assert.ok(bar.includes('href="/school/weekly/3" rel="prev">‹ No. 3<'));
  assert.ok(bar.includes('No. 4</a> of 7'));
  assert.ok(bar.includes('href="/school/weekly/5" rel="next">No. 5 ›<'));
  assert.ok(bar.includes('<a class="ib-new" href="/school/weekly/7">Newest issue: No. 7 ›</a>'));
  assert.equal(between(four, '<section class="issues"', '</section>').split('<li').length - 1, 7, 'the shelf at the foot lists all seven');
  const stand = between(renderStand(config, seven), '<ol class="stand"', '</ol>');
  assert.deepEqual([...stand.matchAll(/<li class="tile(?: latest)?">\s*<a href="\/school\/weekly\/(\d+)">/g)].map((m) => Number(m[1])), [7, 6, 5, 4, 3, 2, 1], 'every issue has a tile, newest first: none is left for another page');
  assert.match(renderStand(config, seven), /<span>Seven issues on the stand<\/span>/);
});

/* The stand (V, 2026-11-21): "Have all the weeklies on weekly page … displayed in a tile. The latest edition should be
   in a bigger tile in the center, rest of the editions in small, when each clicks open into full article." */
test('the stand: /school/weekly shows every issue as a tile, the newest first and large, each tile one link to its issue, all of it from the issue files', async () => {
  const w = loadWeeklyContent('en');
  const newest = w.latest!;
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const page = await getPage(s.base, '/school/weekly');
    assert.equal(page.status, 200);
    assert.equal(page.html.split('<h1>').length - 1, 1);
    assert.match(page.html, /<h1>Beuk Weekly<\/h1>/);
    assert.match(page.html, /<a href="\/school\/weekly" aria-current="page">Beuk Weekly<\/a>/, 'the Beuk Weekly tab is current');
    assert.match(page.html, /<span>Six issues on the stand<\/span>/);
    assert.ok(!page.html.includes('class="banner"') && !page.html.includes('issue-bar'), 'it is the stand, not an issue');

    const stand = between(page.html, '<ol class="stand"', '</ol>');
    const tiles = stand.split('<li class="tile').slice(1);
    assert.equal(tiles.length, w.issues.length, 'a tile for every issue');
    const order = tiles.map((t) => Number(/<a href="\/school\/weekly\/(\d+)">/.exec(t)![1]));
    assert.deepEqual(order, w.issues.map((i) => i.number).reverse(), 'newest first');
    assert.deepEqual(tiles.map((t) => t.startsWith(' latest">')), order.map((n) => n === newest.number), 'only the newest is the large tile, and it comes first');
    for (const t of tiles) {
      const n = Number(/<a href="\/school\/weekly\/(\d+)">/.exec(t)![1]);
      const i = w.issueByNumber.get(n)!;
      assert.equal(t.split('<a ').length - 1, 1, `No. ${n}: the tile is one link`);
      assert.equal(t.split('</a>').length - 1, 1);
      assert.ok(t.includes(`<span>No. ${n}${n === newest.number ? ' · Latest issue' : ''}</span><span>${weekLabel(i.week)}</span>`), `No. ${n}: its number and week`);
      assert.ok(t.includes(`<h2 class="t-banner">${escapeHtml(i.banner)}</h2>`), `No. ${n}: its banner headline`);
      assert.ok(t.includes(`<p class="t-deck">${escapeHtml(i.bannerDeck)}</p>`), `No. ${n}: its deck`);
      const opening = i.lead.blocks.find((b) => b.kind === 'p');
      if (opening && opening.kind === 'p') assert.ok(t.includes(`<p class="t-lead">${escapeHtml(opening.text)}</p>`), `No. ${n}: the lead's opening`);
      assert.equal(t.includes('class="t-inside"'), n === newest.number, `No. ${n}: the other headlines only on the large tile`);
      assert.equal(t.includes(`<span class="t-open">Read No. ${n}</span>`), n === newest.number);
    }
    const inside = [...newest.front, ...newest.shorts, ...newest.fold, ...newest.leaders].slice(0, TILE_INSIDE);
    assert.ok(inside.length > 0, 'the newest issue has other stories to name');
    assert.ok(tiles[0].includes(`<ul>${inside.map((x) => `<li>${escapeHtml(x.title)}</li>`).join('')}</ul>`), 'their titles, in the issue\'s own order');
    // every tile's issue opens
    for (const n of order) assert.equal((await getPage(s.base, `/school/weekly/${n}`)).status, 200);
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
  assert.match(detail, /6 issue\(s\); latest No\. 6, 2026-11-23: Vellum Blinks Twice/);
});
