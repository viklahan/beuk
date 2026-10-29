import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { HTTP_CODES, beukCodeForEpubcheck, beukCodeForValidator } from '../src/help/codes.js';
import { checkHelpContent, getHelpContent, loadHelpContent } from '../src/help/content.js';
import { resetShelfStatusCache, shelfHeadline } from '../src/help/status.js';
import { parseEpubCheckReport } from '../src/jobs/tools.js';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';
import { newGuideText } from './help-text.js';

/* H1 — the Help content model, the error dictionary, the code mapping
   and the server-rendered pages. */

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

/** EPUBCheck's own message bundle (Java .properties, UTF-8), by id. */
function epubcheckBundle(): Map<string, string> {
  const text = read('tests', 'fixtures', 'epubcheck', 'MessageBundle-5.2.1.properties');
  const map = new Map<string, string>();
  let pending = '';
  for (const raw of text.split('\n')) {
    const line = pending + raw.replace(/\r$/, '');
    if (/\\$/.test(line)) {
      pending = line.slice(0, -1);
      continue;
    }
    pending = '';
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    map.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  return map;
}
/** EPUBCheck id RSC-005 ↔ bundle key RSC_005; placeholders %1$s shown as …. */
const bundleKey = (id: string) => id.replace('-', '_');
const shown = (msg: string) => msg.replace(/%\d+\$s/g, '…').trim();

async function getPage(base: string, p: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(`${base}${p}`, { redirect });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

test('help content: every guide parses, the content check is clean, 15 guides in three groups', () => {
  const c = loadHelpContent();
  assert.deepEqual(checkHelpContent(c), []);
  assert.equal(c.guides.length, 15);
  const files = readdirSync(path.join(root, 'content', 'help', 'guides')).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 15, 'one Markdown file per guide');
  for (const g of c.guides) {
    assert.ok(g.title && g.blurb && g.lede.length, `${g.slug} has a title, blurb and lede`);
    assert.match(g.updated, /^\d{4}-\d{2}-\d{2}$/);
  }
  const fresh = c.guides.filter((g) => g.isNew).map((g) => g.slug).sort();
  assert.deepEqual(fresh, ['move-split-merge', 'saving', 'share', 'story-insights'], 'exactly the four new guides carry the New mark');
  assert.deepEqual([...new Set(c.guides.map((g) => g.group))], ['write', 'ship', 'keep']);
});

test('help content: every error entry names a guide that exists, and the dictionary has no duplicates', () => {
  const c = loadHelpContent();
  for (const e of c.errors) assert.ok(c.guideBySlug.has(e.guide), `${e.code} → ${e.guide}`);
  assert.equal(new Set(c.errors.map((e) => e.code)).size, c.errors.length);
});

test('error dictionary: every EPUBCheck code exists in the bundled EPUBCheck 5.2.1 bundle, and every EPUBCheck line is its message text', () => {
  const bundle = epubcheckBundle();
  assert.equal(bundle.size, 264, 'the whole bundle parsed (264 messages in 5.2.1)');
  const c = loadHelpContent();
  let codes = 0;
  let lines = 0;
  for (const e of c.errors) {
    for (const id of e.maps.epubcheck) {
      assert.ok(bundle.has(bundleKey(id)), `${e.code}: ${id} is not an EPUBCheck 5.2.1 message id`);
      codes++;
    }
    for (const s of e.says.filter((x) => x.from === 'epubcheck')) {
      assert.ok(s.code && e.maps.epubcheck.includes(s.code), `${e.code}: says line ${s.code} is not in maps.epubcheck`);
      assert.equal(s.text, shown(bundle.get(bundleKey(s.code!))!), `${e.code} ${s.code} must be EPUBCheck's own text`);
      lines++;
    }
  }
  assert.ok(codes >= 20 && lines >= 20, `${codes} codes, ${lines} lines checked`);
  // RSC-008 vs RSC-009: the decoder's "present but undeclared" is RSC-008.
  assert.match(bundle.get('RSC_008')!, /is not declared in the OPF manifest/);
  assert.doesNotMatch(bundle.get('RSC_009')!, /manifest/);
  const decoder = read('content', 'help', 'guides', 'epub-error-decoder.md');
  assert.match(decoder, /### RSC-008 — present but undeclared/);
  assert.doesNotMatch(decoder, /RSC-009/);
});

test("error dictionary: validator, studio and server lines are the repo's own strings", () => {
  const c = loadHelpContent();
  const studio = read('client', 'index.html');
  const validatorStart = studio.indexOf('function validateEpubPackage(files)');
  const validator = studio.slice(validatorStart, studio.indexOf('function runValidation()', validatorStart));
  const tools = read('src', 'jobs', 'tools.ts').replace(/[`']\s*\+\s*\n\s*[`']/g, '');
  const jobsRoute = read('src', 'routes', 'jobs.ts');
  const defaults = loadConfig({});
  for (const e of c.errors) {
    for (const s of e.says) {
      if (s.from === 'validator') {
        assert.ok(validator.includes(`add("${s.code}", `), `${e.code}: no validator check ${s.code}`);
        assert.ok(validator.includes(`"${s.text}"`), `${e.code}: "${s.text}" is not a line of validateEpubPackage`);
      } else if (s.from === 'studio') {
        assert.ok(studio.includes(`"${s.code}": "${s.text}"`), `${e.code}: ${s.code} is not "${s.text}" in the studio's en strings`);
      } else if (s.from === 'server' && e.code === 'BEUK-J701') {
        const ms = s.code === 'pdfx' ? defaults.pdfxTimeoutMs : defaults.jobTimeoutMs;
        const field = s.code === 'pdfx' ? '${config.pdfxTimeoutMs}' : '${config.jobTimeoutMs}';
        assert.ok(s.text.includes(String(ms)), `${e.code}: default ${ms} ms`);
        assert.ok(tools.includes(s.text.replace(String(ms), field)), `${e.code}: "${s.text}" is not tools.ts's message`);
      } else if (s.from === 'server' && e.code === 'BEUK-J702') {
        if (s.code === 'HTTP 429') {
          const lim = defaults.jobMaxActivePerUser;
          assert.equal(s.text, `you already have ${lim} jobs waiting or running (the limit is ${lim}); start this one when one of them finishes`);
          assert.ok(jobsRoute.includes('waiting or running ') && jobsRoute.includes('(the limit is ${config.jobMaxActivePerUser}); start this one when one of them finishes'));
        } else assert.ok(jobsRoute.includes(`'${s.text}'`), `${e.code}: 503 text`);
      }
      assert.notEqual(s.from, 'store', `${e.code}: no store wording was found on a store's own page this round`);
    }
    if (e.category === 'store') assert.ok(e.sources.some((u) => u.startsWith('https://')), `${e.code}: a store entry cites the store's page`);
  }
});

test('code mapping: the studio validator map equals the dictionary, and covers every check validateEpubPackage emits', () => {
  const c = loadHelpContent();
  const studio = read('client', 'index.html');
  const m = /const BEUK_VALIDATOR_CODES = (\{[^}]*\});/.exec(studio);
  assert.ok(m, 'the studio carries BEUK_VALIDATOR_CODES');
  const studioMap = JSON.parse(m![1]) as Record<string, string>;
  const expected: Record<string, string> = {};
  for (const e of c.errors) for (const v of e.maps.validator) expected[v] = e.code;
  assert.deepEqual(studioMap, expected);
  const validator = studio.slice(studio.indexOf('function validateEpubPackage(files)'), studio.indexOf('function runValidation()'));
  const ids = [...new Set([...validator.matchAll(/add\("([a-z0-9.-]+)", /g)].map((x) => x[1]))];
  assert.ok(ids.length >= 15);
  for (const id of ids) {
    assert.ok(studioMap[id], `validator check ${id} has no BEUK- code`);
    assert.equal(beukCodeForValidator(id), studioMap[id]);
  }
  for (const [key, code] of Object.entries(HTTP_CODES)) {
    const e = c.errorByCode.get(code);
    assert.ok(e && e.maps.http.length, `${key}: ${code} lists its HTTP statuses`);
  }
  assert.equal(beukCodeForEpubcheck('RSC-005'), 'BEUK-X201');
  assert.equal(beukCodeForEpubcheck('RSC-007w'), 'BEUK-R301', 'the w variant maps like its base id');
  assert.equal(beukCodeForEpubcheck('NCX-001'), null, 'an unmapped id is null, never a guess');
  // All 13 locales carry the one new studio string.
  for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', '"zh-Hans"']) {
    const re = new RegExp(`Object\\.assign\\(UI_STRINGS(?:\\.${lang}|\\[${lang}\\]), \\{ "help\\.codeLink": "[^"]*\\{code\\}[^"]*" \\}\\);`);
    assert.match(studio, re, `help.codeLink in ${lang}`);
  }
});

test('job results carry beuk: a real EPUBCheck 5.2.1 report maps every message, unmapped ids stay null', () => {
  const report = parseEpubCheckReport(read('tests', 'fixtures', 'epubcheck', 'broken-sample-report.json'));
  assert.ok(report);
  assert.equal(report!.toolVersion, '5.2.1');
  assert.equal(report!.passed, false);
  assert.deepEqual(report!.counts, { fatal: 1, errors: 3, warnings: 0, infos: 0, usages: 0 });
  assert.deepEqual(report!.messages.map((x) => `${x.code}→${x.beuk}`), ['RSC-005→BEUK-X201', 'RSC-005→BEUK-X201', 'RSC-005→BEUK-X201', 'RSC-016→BEUK-X201']);
  const odd = parseEpubCheckReport(JSON.stringify({ messages: [{ ID: 'NCX-001', severity: 'ERROR', message: 'x' }] }));
  assert.equal(odd!.messages[0].beuk, null);
});

const ADDED_2026_10_26: [string, string, string][] = [
  ["footnotes-and-images", "remove the placement (the library keeps the file).", "remove the placement (the library keeps the file). Removing a picture from the book In the image library ( Insert Image , and the scene-break picker) every picture has a small bin button. A picture nothing uses goes at once, with Undo for ten seconds. A picture in use first shows where — \"Chapter Three (in the text), Chapter Five (plate)\". Remove it everywhere takes it out of the text, the plate, the backdrop, the scene break, the cover or the flourishes, just as removing each by hand would, and Undo puts it all back. If it is your cover's artwork, the cover made with it goes too. Remove unused pictures clears every picture nothing in the book uses, saying first how many there are and how much space they take. Each removal keeps a snapshot in History (\"Before removing a picture\"), so a picture can always come back. That snapshot holds the picture, so the saved book only gets smaller once you delete the snapshot in History. The sample story's own pictures stay with the sample."],
  ["typeset-a-chapter", "What reads well on one should read well on all.", "What reads well on one should read well on all. The preview keeps your place. As you write and format, the preview stays on the page holding your cursor; a new font size, theme or device keeps you on the words you were reading. Typing a chapter's number, title or subtitle turns the preview to the page they stand on. Opening another chapter starts at its first page."],
  ["import-a-manuscript", "You can do this later, but exports carry them.", "You can do this later, but exports carry them. Beuk starts you off from the document: a title page in the manuscript (the title, a subtitle, a \"by …\" line) becomes the book's title, subtitle and author, lifted out of the text; with nothing like a title page, the cleaned file name is used. The import report says where each detail came from. A title, subtitle or author you typed yourself is never overwritten by a new import. The report shows what the document calls itself and offers Use instead."],
  ["import-a-manuscript", "re-import, or split the section by hand in the editor.", "re-import, or place the cursor where each chapter begins and choose Split at cursor from the section's … menu (see Delete, split & merge chapters )."],
  ["import-a-manuscript", "and plain text ( .txt ).", "and plain text ( .txt ). New to the studio? Show the quick tour : four short steps that point out Import, the page and its preview, Typography Studio, and Export. You can skip it at any step. In the studio it is also under the sample story, as Show the quick tour ."],
  ["add-a-cover", "may be refused by a store later.", "may be refused by a store later. No artwork yet? The Cover Maker builds a cover from a photo and type, and starts from your book: the title, subtitle, author and series are filled in, and the photo search starts from the title. A cover made earlier follows the book's new title; anything you typed in the maker yourself stays as you wrote it."],
];

test('migrated guides keep their copy verbatim (rendered text vs the pre-H1 pages), with the two edits the spec asks for and the 2026-10-26 additions', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const dir = path.join(root, 'tests', 'fixtures', 'help-v0');
    const slugs = readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4));
    assert.equal(slugs.length, 11);
    for (const slug of slugs) {
      // 2026-10-28: these two were rewritten from the studio's own data (they had drifted: 6 presets
      // listed vs 11 shipped, 6 trims vs 24, PDF/X as "a later phase" after M5 shipped it). They are
      // held to the studio by the next test instead of to the pre-H1 copy.
      if (REWRITTEN_2026_10_28.has(slug)) continue;
      let expected = readFileSync(path.join(dir, `${slug}.txt`), 'utf8').trim();
      if (slug === 'epub-error-decoder') {
        // Correction: EPUBCheck's "not declared in the OPF manifest" is RSC-008 (RSC-009 is a fragment rule).
        expected = expected.split('RSC-009').join('RSC-008');
      }
      if (slug === 'check-your-book') {
        // 1. A fourth step: the server EPUBCheck that M5 added (studio: Your Archive → Run EPUBCheck).
        const step3end = 'and if something failed, what to do about it.';
        expected = expected.replace(
          step3end,
          `${step3end} For the full, official check, sign in, save the EPUB to Your Archive in the Export dialog, and choose Run EPUBCheck beside it.`,
        );
        // 2. The honest limit, updated now that M5 server EPUBCheck exists.
        const oldLimit = "The honest limit: this is structural validation. The full, official EPUBCheck suite runs on Beuk's servers in the SaaS phase — the validator will tell you so itself, in its own results panel. Beuk doesn't claim EPUBCheck's authority for a lighter set of checks.";
        assert.ok(expected.includes(oldLimit), 'the old honest limit is in the fixture');
        expected = expected.replace(
          oldLimit,
          "The honest limit: this is structural validation, and Beuk doesn't claim EPUBCheck's authority for a lighter set of checks. The full, official EPUBCheck runs on Beuk's server: signed in, save the EPUB to Your Archive and choose Run EPUBCheck . It runs only where the server has EPUBCheck installed — where it hasn't, the check says so and gives no result rather than a pass. A book with findings comes back as a finished check that says it did not pass: the check worked; the book needs a fix.",
        );
      }
      // 2026-10-26: the features added since H1 (removing a picture, the preview keeping its place,
      // the title read from the manuscript, Split at cursor, the Cover Maker), each added in place.
      for (const [s, from, to] of ADDED_2026_10_26) if (s === slug) {
        assert.ok(expected.includes(from), `${slug}: the addition's anchor is in the fixture`);
        expected = expected.replace(from, to);
      }
      const page = await getPage(server.base, `/help/${slug}`);
      assert.equal(page.status, 200, slug);
      assert.equal(newGuideText(page.html), expected, `${slug}: rendered copy differs from the pre-H1 page`);
    }
  } finally {
    await server.close();
  }
});

const REWRITTEN_2026_10_28 = new Set(['platform-presets', 'print-interiors']);

test('the presets and trims guides name every preset and every trim group the studio ships', () => {
  const studio = read('client', 'index.html');
  const presets = studio.slice(studio.indexOf('const PLATFORM_PRESETS = ['), studio.indexOf('];', studio.indexOf('const PLATFORM_PRESETS = [')));
  const names = [...presets.matchAll(/\{ id: "[a-z0-9]+", name: "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(names.length, 11, 'the studio ships eleven presets');
  const presetsGuide = read('content', 'help', 'guides', 'platform-presets.md');
  for (const n of names) assert.ok(presetsGuide.includes(`**${n}**`), `platform-presets names ${n}`);

  const trims = studio.slice(studio.indexOf('const TRIM_SIZES = ['), studio.indexOf('];', studio.indexOf('const TRIM_SIZES = [')));
  const trimCount = [...trims.matchAll(/\{ id: "[0-9.x]+", label:/g)].length;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six'];
  const trimsGuide = read('content', 'help', 'guides', 'print-interiors.md');
  assert.ok(trimsGuide.toLowerCase().includes(`${words[trimCount]} trim`), `print-interiors says ${words[trimCount]} trim sizes (the studio has ${trimCount})`);
  for (const g of ['pocket', 'trade', 'large', 'square']) {
    const label = new RegExp(`"print\.group\.${g}": "([^"]+)"`).exec(studio)?.[1];
    assert.ok(label && trimsGuide.includes(`**${label.replace(/&/g, '&')}**`), `print-interiors names the ${label} group`);
  }
  assert.ok(!/later phase/i.test(trimsGuide), 'server PDF/X has shipped; the guide no longer calls it a later phase');
});

test('old URLs: /help/<guide>.html and /help/index.html answer 301 to the new pages; studio links still land', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const old = ['add-a-cover', 'box-sets', 'check-your-book', 'epub-error-decoder', 'exports-and-archive', 'footnotes-and-images', 'import-a-manuscript', 'platform-presets', 'print-interiors', 'typeset-a-chapter', 'your-streak'];
    for (const slug of old) {
      const r = await getPage(server.base, `/help/${slug}.html`, 'manual');
      assert.equal(r.status, 301, slug);
      assert.equal(r.headers.get('location'), `/help/${slug}`);
    }
    const idx = await getPage(server.base, '/help/index.html', 'manual');
    assert.equal(idx.status, 301);
    assert.equal(idx.headers.get('location'), '/help/');
    assert.equal((await getPage(server.base, '/help/nope.html', 'manual')).status, 404);
    // Every /help link in the studio and the static pages resolves.
    const sources = [read('client', 'index.html'), read('client', 'thanks', 'index.html'), read('client', 'support', 'index.html')];
    const links = new Set<string>();
    for (const s of sources) for (const m of s.matchAll(/["'](\/help\/[a-z0-9/.-]*)(#[a-z-]+)?["']/g)) links.add(m[1]);
    assert.ok(links.has('/help/'));
    for (const l of links) {
      if (l === '/help/errors/') continue;
      const r = await getPage(server.base, l);
      assert.equal(r.status, 200, `${l} lands`);
    }
  } finally {
    await server.close();
  }
});

test('pages: home, guide, dictionary, an entry and the search page render; unknown slugs and codes are 404 pages', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const home = await getPage(server.base, '/help/');
    assert.equal(home.status, 200);
    for (const g of getHelpContent().guides) assert.ok(home.html.includes(`href="/help/${g.slug}"`), `home links ${g.slug}`);
    for (const e of getHelpContent().errors) assert.ok(home.html.includes(`id="${e.code}"`), `home lists ${e.code}`);
    assert.match(home.html, /<form class="h-search big" action="\/help\/search" method="post"/);
    assert.doesNotMatch(home.html, /assistant|drafted by|Did this answer it|checked against \d+ pages/i, 'no AI assistant anywhere');

    const guide = await getPage(server.base, '/help/check-your-book');
    assert.equal(guide.status, 200);
    assert.equal((guide.html.match(/class="pane" role="tabpanel"/g) ?? []).length, 3);
    assert.equal((guide.html.match(/<b>Excerpt, not live:<\/b>/g) ?? []).length, 3, 'every pane says where its excerpt is from');
    assert.match(guide.html, /data-pane="validator" data-hl="✗ Malformed markup\|! No ISBN"/);
    assert.match(guide.html, /<span class="new">New<\/span>|class="kicker gold">Ship · guide</);

    const dict = await getPage(server.base, '/help/errors');
    assert.equal(dict.status, 200);
    const entry = await getPage(server.base, '/help/errors/BEUK-X201');
    assert.equal(entry.status, 200);
    assert.match(entry.html, /Error while parsing file: …/);
    assert.match(entry.html, /RSC-016/);
    const lower = await getPage(server.base, '/help/errors/beuk-x201', 'manual');
    assert.equal(lower.status, 301);
    assert.equal(lower.headers.get('location'), '/help/errors/BEUK-X201');
    assert.equal((await getPage(server.base, '/help/errors/BEUK-Z999')).status, 404);
    assert.equal((await getPage(server.base, '/help/no-such-guide')).status, 404);

    // Assets: content-hashed, immutable; a stale hash still answers, uncached.
    const css = /href="(\/help\/static\/help\.[0-9a-f]{12}\.css)"/.exec(home.html)![1];
    const cssRes = await fetch(server.base + css);
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers.get('cache-control') ?? '', /immutable/);
    const stale = await fetch(server.base + '/help/static/help.000000000000.css');
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(server.base + '/help/static/evil.js')).status, 404);
    for (const p of ['/help/', '/help/check-your-book', '/help/errors', '/help/errors/BEUK-X201', '/help/search?q=RSC-005']) {
      const r = await getPage(server.base, p);
      assert.doesNotMatch(r.html, /<script>(?!<\/script>)|\son[a-z]+="/i, `${p}: no inline script or inline handlers`);
      assert.match(r.html, /<span class="subbrand">beuk\.studio<\/span>/, `${p} sub-brand`);
    }
  } finally {
    await server.close();
  }
});

test('support contact: with SUPPORT_EMAIL unset no page names a person, an address or a reply time; set, it appears', async () => {
  const pages = ['/help/', '/help/errors', '/help/errors/BEUK-X201', '/help/check-your-book', '/help/your-streak', '/help/search?q=zzqxv+flarn', '/support', '/thanks'];
  const db = await createTestDb();
  const unset = await startTestServer(db, undefined, {
    supportEmail: null,
    supportName: 'Vik',
    supportReplyPromise: 'a human replies within two working days',
    kofiUrl: 'https://ko-fi.com/testmaker',
  });
  try {
    for (const p of pages) {
      const r = await getPage(unset.base, p);
      assert.equal(r.status, 200, p);
      assert.doesNotMatch(r.html, /mailto:/, `${p}: no mailto while SUPPORT_EMAIL is unset`);
      assert.doesNotMatch(r.html, /two working days|Write to a human|When the guides run out|\bVik\b/, `${p}: no person or promise`);
      assert.doesNotMatch(r.html, /support@beuk\.studio|\{\{SUPPORT_/, `${p}: no placeholder address or slot`);
      assert.doesNotMatch(r.html, /a human at\s+the end of the email address|write to us|we&#39;ll look|we'll look|A human reads/, `${p}: no promise of a reply`);
      assert.doesNotMatch(r.html, /BEUK_IF_SUPPORT|\[\[\/?if-support\]\]/, `${p}: no leftover markers`);
    }
    const pub = await new Client(unset.base).get('/api/config/public');
    assert.deepEqual(pub.body.support, { email: null, name: 'Vik', replyPromise: 'a human replies within two working days' });
  } finally {
    await unset.close();
  }
  const db2 = await createTestDb();
  const set = await startTestServer(db2, undefined, { supportEmail: 'shelf@example.com', supportName: null, supportReplyPromise: null, kofiUrl: 'https://ko-fi.com/testmaker' });
  try {
    const home = await getPage(set.base, '/help/');
    assert.match(home.html, /<section class="h-support" id="support"/);
    assert.match(home.html, /href="mailto:shelf@example\.com"/);
    assert.match(home.html, /If you're stuck, curious, or something looks wrong, write to<\/p>/, 'no name when SUPPORT_NAME is unset');
    assert.doesNotMatch(home.html, /The promise:/, 'no promise when SUPPORT_REPLY_PROMISE is unset');
    const none = await getPage(set.base, '/help/search?q=zzqxv+flarn');
    assert.match(none.html, /Nothing in the guides or the error dictionary matches that yet/);
    assert.match(none.html, /href="mailto:shelf@example\.com"/);
    const support = await getPage(set.base, '/support');
    assert.match(support.html, /Write in with what's working and what isn't: <a href="mailto:shelf@example\.com">/);
    const thanks = await getPage(set.base, '/thanks');
    assert.match(thanks.html, /is open, and there's a human at\s+the end of the email address there\./);
    const streak = await getPage(set.base, '/help/your-streak');
    assert.match(streak.html, /the day wasn(&#39;|')t recorded — write to us if it matters and we(&#39;|')ll look; but know/);
    assert.doesNotMatch(streak.html + thanks.html, /BEUK_IF_SUPPORT|\[\[\/?if-support\]\]/);
  } finally {
    await set.close();
  }
  // Config: empty or blank SUPPORT_EMAIL is unset — no built-in address, name or promise.
  const cfg = loadConfig({ SUPPORT_EMAIL: '  ' });
  assert.equal(cfg.supportEmail, null);
  assert.equal(cfg.supportName, null);
  assert.equal(cfg.supportReplyPromise, null);
  assert.equal(loadConfig({ SUPPORT_EMAIL: 'a@b.c' }).supportEmail, 'a@b.c');
});

test('shelf status: live values from the server, nothing hard-coded; a failed self-check run changes the headline', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    resetShelfStatusCache();
    const first = await getPage(server.base, '/help/');
    assert.match(first.html, /<span class="k">db<\/span><span class="v ok">up<\/span>/);
    assert.match(first.html, /<span class="k">jobs<\/span><span class="v">0 waiting or running<\/span>/);
    assert.match(first.html, /<span class="k">epubcheck<\/span><span class="v">not installed<\/span>/, 'EPUBCHECK_JAR unset is "not installed", never "up"');
    assert.match(first.html, /<span class="k">self-checks<\/span><span class="v">none yet<\/span>/);
    // Not green: EPUBCheck is not installed and no self-check has run, so
    // the headline is the neutral "partial" line naming the gaps.
    assert.match(first.html, /class="pill status-pill is-partial"/);
    assert.match(first.html, /id="status-line">Up — EPUBCheck not installed; no self-check run yet\.</);
    assert.doesNotMatch(first.html, /All(&#39;|')s well|is-well|up and running/, 'no green headline while components are unchecked');
    assert.doesNotMatch(first.html, /25\/10\/2026/, 'no date from the design is hard-coded');

    await db.query(
      `insert into housekeeping_check_runs (build_stamp, started_at, finished_at, overall, pass_count, fail_count, client_only_count, results)
       values ('test-build-1', '2026-03-04T05:06:00Z', '2026-03-04T05:07:00Z', 'fail', 40, 2, 20, '[]')`,
    );
    resetShelfStatusCache();
    const second = await getPage(server.base, '/help/check-your-book');
    assert.match(second.html, /class="pill status-pill is-tidy"/);
    assert.match(second.html, /The last shelf-check found something to tidy/);
    resetShelfStatusCache();
    const home = await getPage(server.base, '/help/');
    assert.match(home.html, /last run: fail/);
    assert.match(home.html, /40 passed · 2 failed · 4 Mar 2026, 05:07 UTC/);
  } finally {
    await server.close();
    resetShelfStatusCache();
  }
});

test('shelf status: "All\'s well" only when db, queue, EPUBCheck and the latest self-check are all checked and fine', async () => {
  const db = await createTestDb();
  // An EPUBCHECK_JAR path that exists — "installed" is a file check, never "up".
  const jar = path.join(root, 'tests', 'fixtures', 'help-v0', 'your-streak.txt');
  const server = await startTestServer(db, undefined, { epubcheckJar: jar });
  try {
    resetShelfStatusCache();
    const noRun = await getPage(server.base, '/help/');
    assert.match(noRun.html, /<span class="k">epubcheck<\/span><span class="v ok">installed<\/span>/);
    assert.match(noRun.html, /class="pill status-pill is-partial"/);
    assert.match(noRun.html, /id="status-line">Up — no self-check run yet\.</);

    await db.query(
      `insert into housekeeping_check_runs (build_stamp, started_at, finished_at, overall, pass_count, fail_count, client_only_count, results)
       values ('test-build-1', '2026-03-04T05:06:00Z', '2026-03-04T05:07:00Z', 'pass', 42, 0, 20, '[]')`,
    );
    resetShelfStatusCache();
    const well = await getPage(server.base, '/help/');
    assert.match(well.html, /class="pill status-pill is-well"/);
    assert.match(well.html, /id="status-line">All(&#39;|')s well on the shelf\. Beuk is up and running\. The last shelf-check passed on 4 Mar 2026\.</);
  } finally {
    await server.close();
    resetShelfStatusCache();
  }
  // The rule itself, every gap on its own.
  const base = { db: 'up' as const, queue: { queued: 0, running: 0 }, epubcheck: 'installed' as const, selfChecks: { overall: 'pass', at: '2026-03-04T05:07:00Z', passed: 1, failed: 0 }, selfChecksUnreadable: false };
  assert.deepEqual(shelfHeadline(base), { headline: 'well', gaps: [] });
  assert.equal(shelfHeadline({ ...base, db: 'down' }).headline, 'down');
  assert.deepEqual(shelfHeadline({ ...base, queue: null }), { headline: 'partial', gaps: ['job queue unreadable'] });
  assert.deepEqual(shelfHeadline({ ...base, epubcheck: 'not-installed' }), { headline: 'partial', gaps: ['EPUBCheck not installed'] });
  assert.deepEqual(shelfHeadline({ ...base, selfChecks: null }), { headline: 'partial', gaps: ['no self-check run yet'] });
  assert.deepEqual(shelfHeadline({ ...base, selfChecks: null, selfChecksUnreadable: true }), { headline: 'partial', gaps: ['self-check history unreadable'] });
  assert.equal(shelfHeadline({ ...base, selfChecks: { ...base.selfChecks, overall: 'fail' } }).headline, 'tidy');
});

test('HTTP bodies gain { code }: 409 manuscript conflict, 410 closed reading copy — existing fields unchanged', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const c = getHelpContent();
    const alice = new Client(server.base);
    assert.equal((await registerUser(alice, 'help-alice@example.com')).status, 201);
    const doc = (title: string) => ({ meta: { title, author: 'A. Writer', language: 'en' }, sections: [{ id: 'sec-one', kind: 'body', type: 'chapter', number: 'One', title: 'First', content: 'Hello there.' }], images: [] });
    const created = await alice.post('/api/manuscripts', { doc: doc('Coded') });
    const ms = created.body.manuscript as { id: string; revision: number };
    assert.equal((await alice.put(`/api/manuscripts/${ms.id}`, { doc: doc('Coded 2') }, { 'if-match': `"${ms.revision}"` })).status, 200);
    const stale = await alice.put(`/api/manuscripts/${ms.id}`, { doc: doc('Coded 3') }, { 'if-match': `"${ms.revision}"` });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'BEUK-C801');
    assert.equal(stale.body.error, 'revision conflict: the shelf copy has changed');
    assert.ok(stale.body.manuscript, 'the shelf copy still comes back');
    assert.ok(c.errorByCode.get('BEUK-C801')!.says.some((s) => s.text === stale.body.error));

    const share = await alice.post('/api/shares', { manuscriptId: ms.id });
    assert.equal(share.status, 201);
    const token = share.body.token as string;
    const shareId = (share.body.share as { id: string }).id;
    assert.equal((await alice.post(`/api/shares/${shareId}/revoke`, {})).status, 200);
    const comments = await fetch(`${server.base}/read/${token}/comments`);
    assert.equal(comments.status, 410);
    const body = (await comments.json()) as { error: string; code: string };
    assert.deepEqual(body, { error: 'this reading copy is closed', code: 'BEUK-H410' });
    const gone = await getPage(server.base, `/read/${token}`);
    assert.equal(gone.status, 410);
    assert.match(gone.html, /<a href="\/help\/errors\/BEUK-H410">BEUK-H410<\/a>/);
    const h410 = c.errorByCode.get('BEUK-H410')!;
    for (const s of h410.says.filter((x) => x.code === 'GET /read/:token')) assert.ok(gone.html.includes(s.text) || s.text === 'The reading period for this copy has ended.', s.text);
    assert.ok(read('src', 'shares', 'reader.ts').includes("'The reading period for this copy has ended.'"));
  } finally {
    await server.close();
  }
});
