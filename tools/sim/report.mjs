// The report: out/report.md + out/report.json, generated from the run's
// own files (world.json, seed.json, personas.json, monster.json,
// checks.json). Nothing in it is typed by hand: every number and every
// gap comes from those files, with the observation that shows it.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const rj = (f) => (existsSync(path.join(OUT, f)) ? JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) : null);
const world = rj('world.json'), seed = rj('seed.json'), pers = rj('personas.json'), monster = rj('monster.json'), checks = rj('checks.json'), phases = rj('phase-timings.json');
const git = (args) => { try { return execFileSync('git', args, { cwd: HERE }).toString().trim(); } catch { return '?'; } };
const MB = (n) => (n == null ? '–' : (n / 1048576).toFixed(1));
const ms = (n) => (n == null ? '–' : n >= 10000 ? (n / 1000).toFixed(0) + ' s' : n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms');
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const j = (o, max = 1800) => { const s = JSON.stringify(o, null, 1); return s.length > max ? s.slice(0, max) + '\n… (truncated; full evidence in out/checks.json)' : s; };
const bookById = (id) => world.books.find((b) => b.id === id);

const L = [];
const P = (...a) => L.push(a.join(''));
const fails = checks.checks.filter((c) => c.pass === false);
const passes = checks.checks.filter((c) => c.pass === true);
const saga = world.books.filter((b) => b.source.kind === 'saga');
const totalWords = world.books.reduce((a, b) => a + ((seed.books[b.id] && seed.books[b.id].stats && seed.books[b.id].stats.words) || 0), 0);
const totalImages = world.books.reduce((a, b) => a + ((seed.books[b.id] && seed.books[b.id].stats && seed.books[b.id].stats.images) || 0), 0);
const comments = seed.shares.reduce((a, s) => a + s.comments.filter((c) => c.comment).length, 0);

// run history: the same seed must give the same world and the same content
const runLine = { at: checks.at, commit: git(['rev-parse', '--short', 'HEAD']), seed: world.seed, worldSha256: checks.worldSha256, contentDigest: checks.contentDigest, checks: checks.checks.length, fails: fails.length, gaps: checks.gaps.length, bugs: checks.bugs.length };
appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify(runLine) + '\n');
const runs = readFileSync(path.join(OUT, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

P('# Beuk world simulation — report');
P('');
P(`Generated ${checks.at} from branch \`${git(['rev-parse', '--abbrev-ref', 'HEAD'])}\` at \`${runLine.commit}\`, seed **${world.seed}**. Every figure below is read from this run's own files in \`tools/sim/out/\`; every gap and failure cites the observation that shows it.`);
P('');
P('## Headline');
P('');
P(`- **${checks.checks.length} checks: ${passes.length} pass, ${fails.length} fail.** ${checks.gaps.length} series/product gaps and ${checks.bugs.length} bug(s) recorded with evidence.`);
P(`- World: ${world.personas.length} personas (${world.personas.filter((p) => p.kind === 'saga' || p.kind === 'ramp').length} writers, an import-lab writer and a load-test writer), ${world.books.length} books (${saga.length} public-domain saga volumes), ${world.series.length} series, ${num(totalWords)} words and ${num(totalImages)} pictures on the shelves (studio counts), ${seed.shares.length} beta-reader links, ${comments} reader comments.`);
P(`- World spec sha256 \`${checks.worldSha256}\`; content digest of the seeded books \`${checks.contentDigest}\`.`);
const same = runs.filter((r) => r.seed === world.seed);
if (same.length > 1) {
  const ws = new Set(same.map((r) => r.worldSha256)), cs = new Set(same.map((r) => r.contentDigest));
  P(`- Determinism across ${same.length} runs with this seed: world spec ${ws.size === 1 ? 'identical' : 'DIFFERENT'} (${[...ws].map((x) => x.slice(0, 12)).join(', ')}), content digest ${cs.size === 1 ? 'identical' : 'DIFFERENT'} (${[...cs].map((x) => x.slice(0, 12)).join(', ')}).`);
}
P('');
P('## World');
P('');
P('| Persona | Kind | Books | Series |');
P('|---|---|---|---|');
for (const p of world.personas) {
  const bs = world.books.filter((b) => b.persona === p.key);
  const ss = world.series.filter((s) => s.persona === p.key).map((s) => `${s.name} (${s.books.length})`).join('; ');
  P(`| ${p.key} | ${p.kind} | ${bs.length} | ${ss || '–'} |`);
}
P('');
P('Books come only from existing content: the studio\'s sample, the Ramp gallery books (whole, or re-cut by chapter into 3–4 volumes), and public-domain sagas from gutenberg.org (sources: `10-ramp-gallery/sagas/sources.json`). The only words the simulation writes are marked: reader comments start with `[sim]`, typed edits with `SIMTYPED-`/`SIMDEVICE-`, Bible notes with `[sim]`.');
P('');
P('## Checks');
P('');
P('| Result | Check | What it asserts |');
P('|---|---|---|');
for (const c of checks.checks) P(`| ${c.pass === true ? 'pass' : c.pass === false ? '**FAIL**' : 'n/a'} | \`${c.id}\` | ${c.title} |`);
P('');
if (fails.length) {
  P('### Failing checks, with evidence');
  P('');
  for (const c of fails) { P(`#### \`${c.id}\` — ${c.title}`); P(''); P('```json'); P(j(c.evidence)); P('```'); P(''); }
}
P('## Series gaps — what a writer of an interconnected series cannot do today');
P('');
for (const g of checks.gaps.filter((x) => x.id.startsWith('series.'))) { P(`### ${g.title}`); P(''); P(`\`${g.id}\``); P(''); P('```json'); P(j(g.evidence, 2400)); P('```'); P(''); }
P('## Other gaps and bugs found');
P('');
for (const g of checks.gaps.filter((x) => !x.id.startsWith('series.'))) { P(`### Gap: ${g.title}`); P(''); P(`\`${g.id}\``); P(''); P('```json'); P(j(g.evidence)); P('```'); P(''); }
for (const b of checks.bugs) { P(`### Bug: ${b.title}`); P(''); P(`\`${b.id}\``); P(''); P('```json'); P(j(b.evidence)); P('```'); P(''); }
if (!checks.bugs.length) P('No product bug was observed beyond the failing checks above.');
P('');
P('## Saga volumes — measurements');
P('');
P('Measured in the studio (headless Chromium, the sim stack): words/sections/pictures from the studio\'s own counts; doc = the saved book JSON; POST = first save to the shelf, PUT = a later autosave (If-Match); Bible pass = the Story Bible mention pass over the volume (the studio\'s own timing); EPUB = build in the browser.');
P('');
P('| # | Volume | Words | Sections | Pictures | Doc MB | POST | PUT | Bible pass | EPUB build | EPUB MB | EPUBCheck |');
P('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const S of world.series.filter((s) => s.kind === 'saga')) {
  P(`| | **${S.name}** | | | | | | | | | | |`);
  S.books.forEach((id, i) => {
    const r = seed.books[id] || {};
    const st = r.stats || {};
    const ec = r.epubcheck ? (r.epubcheck.fatal === 0 && r.epubcheck.errors === 0 ? `0 errors, ${r.epubcheck.warnings} warnings` : `**${r.epubcheck.fatal} fatal, ${r.epubcheck.errors} errors**`) : (r.error ? '**error**' : '–');
    P(`| ${i + 1} | ${bookById(id).title} | ${num(st.words)} | ${num(st.sections)} | ${num(st.images)} | ${MB(st.docBytes)} | ${ms(r.post && r.post.ms)} | ${ms(r.put && r.put.ms)} | ${ms(r.mentionPass && r.mentionPass.studioMs)} | ${ms(r.epub && r.epub.ms)} | ${MB(r.epub && r.epub.bytes)} | ${ec} |`);
  });
}
P('');
const printed = saga.filter((b) => seed.books[b.id] && seed.books[b.id].pdfx);
if (printed.length) {
  P('### Real print PDFs (renderer + Ghostscript PDF/X job)');
  P('');
  P('| Volume | Print HTML build | Job | Job time | Pages | Result |');
  P('|---|---|---|---|---|---|');
  for (const b of printed) {
    const r = seed.books[b.id]; const res = r.pdfx.result || {};
    const pages = (res.inspect && res.inspect.pageCount) ?? (res.pdf && res.pdf.pageCount) ?? (res.facts && res.facts.pageCount) ?? (JSON.stringify(res).match(/"pageCount":(\d+)/) || [])[1];
    P(`| ${b.title} | ${ms(r.print && r.print.ms)} (${MB(r.print && r.print.bytes)} MB) | ${r.pdfx.status} | ${ms(r.pdfx.ms)} | ${pages ?? '–'} | ${(res.error ? 'failed: ' + String(res.error).slice(0, 120) : res.inspection && res.inspection.pdfx ? res.inspection.pdfx.conformance + ', fonts embedded: ' + res.inspection.fontsAllEmbedded + ', ' + MB(res.outputBytes) + ' MB' : JSON.stringify(res).slice(0, 120)).replace(/[|]/g, '/')} |`);
  }
  P('');
}
P('## Box sets (the studio\'s own box-set path)');
P('');
P('| Series | Volumes | Build | Size MB | Pictures in volumes after the first (source → box set) | EPUBCheck |');
P('|---|---|---|---|---|---|');
for (const S of world.series) {
  const bs = seed.series[S.key] && seed.series[S.key].boxSet;
  if (!bs) { P(`| ${S.name} | – | – | – | – | not built |`); continue; }
  const pics = bs.sourceImages.map((n, i) => `${n}→${bs.vols[i + 1] ? bs.vols[i + 1].images : '?'}`).join(', ');
  const ec = bs.epubcheck ? `${bs.epubcheck.fatal} fatal, ${bs.epubcheck.errors} errors` : '–';
  P(`| ${S.name} | ${bs.vols.length} | ${ms(bs.ms)} | ${MB(bs.bytes)} | ${pics} | ${ec} |`);
}
P('');
if (seed.lab) {
  P('## Which import path keeps a saga best (measured)');
  P('');
  P(`Decision rule (fixed in code): more chapter titles kept, then more pictures placed, then captions, then italics. Chosen: **${seed.lab.chosen}**.`);
  P('');
  P('| Volume | Path | Chapter sections | Titles kept | Pictures placed | Captions | Italic spans | Series from frontmatter | Import time |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const v of seed.lab.volumes) for (const [k, m] of Object.entries(v.paths)) {
    if (!m.score) { P(`| ${v.title} | ${k} | ${m.error || '–'} | | | | | | |`); continue; }
    P(`| ${v.title} | ${k === 'single' ? 'Import (one file) + image library' : 'Bulk import (.md + picture files)'} | ${m.score.chapterSections} (prepared ${m.score.preparedChapters}) | ${m.score.titlesKept} | ${m.score.imagesPlaced} | ${m.score.captionsKept} | ${m.score.italicSpans} | ${m.score.seriesSet ? 'yes' : 'no'} | ${ms(m.importMs)} |`);
  }
  P('');
}
if (monster) {
  P(`## Load test: "${monster.title}"`);
  P('');
  P(`Real saga text (${num(monster.corpusWords)} words) repeated to each target, imported as one book on the sim stack only. Each operation ran under a time limit (${Object.entries(monster.limitsMs || {}).map(([k, v]) => k + ' ' + Math.round(v / 1000) + ' s').join(', ')}). "–" = not reached because an earlier step failed.`);
  P('');
  const ops = ['import', 'wordCount', 'bibleMentionPass', 'serialize', 'post', 'put', 'reopen', 'typing', 'epub', 'printHtml', 'pdfx'];
  P('| Target words | Markdown MB | ' + ops.join(' | ') + ' |');
  P('|' + '---|'.repeat(ops.length + 2));
  for (const s of monster.steps) {
    const cell = (k) => { const o = s.ops[k]; if (!o) return '–'; if (k === 'pdfx') return `${o.status || 'no job'} ${ms(o.ms)}`; if (!o.ok) return `**FAIL** ${ms(o.ms)}: ${String(o.error).slice(0, 80).replace(/\|/g, '/')}`; const v = o.value || {};
      if (k === 'wordCount') return `${num(v.words)} w, ${v.chapters} ch, ${ms(v.ms)}`;
      if (k === 'serialize') return `${MB(v.bytes)} MB, ${ms(v.ms)}`;
      if (k === 'post' || k === 'put') return v.id || v.status === 'saved' ? `${v.status} ${ms(v.ms)}` : `**${v.status}** ${ms(v.ms)} ${v.error ? JSON.stringify(v.error) : ''}`;
      if (k === 'bibleMentionPass') return ms(v.studioMs);
      if (k === 'typing') return `10 inputs ${ms(v.ms10)}`;
      if (k === 'epub' || k === 'printHtml') return `${ms(v.ms)}, ${MB(v.bytes)} MB, archive ${v.archive && v.archive.id ? 'saved' : '**' + (v.archive && v.archive.status) + '** ' + (v.archive && v.archive.error || '')}`;
      return ms(o.ms); };
    P(`| ${num(s.targetWords)} | ${MB(s.mdBytes)} | ` + ops.map(cell).join(' | ') + ' |');
  }
  P('');
  P('### Limits found');
  P('');
  const lim = [];
  const bad = (s, k) => { const o = s.ops[k]; if (!o) return false; if (k === 'pdfx') return o.status !== 'done'; if (!o.ok) return true; const v = o.value || {}; if ((k === 'post' || k === 'put') && v.status !== 'saved') return true; if ((k === 'epub' || k === 'printHtml') && v.archive && !v.archive.id) return true; return false; };
  for (const k of ops) {
    const firstBad = monster.steps.find((s) => bad(s, k));
    const before = firstBad ? monster.steps.slice(0, monster.steps.indexOf(firstBad)) : monster.steps;
    const lastGood = [...before].reverse().find((s) => s.ops[k] && !bad(s, k));
    const o = firstBad && firstBad.ops[k];
    const what = o ? (o.error || (o.value && (o.value.error || (o.value.archive && !o.value.archive.id && o.value.archive))) || o.result || o.value || o) : null;
    if (firstBad) lim.push(`- **${k}**: ${lastGood ? 'works up to ' + num(lastGood.targetWords) + ' words' : 'fails at every step tried'}; fails at ${num(firstBad.targetWords)} words — ${j(what, 500).replace(/\n/g, ' ')}`);
  }
  const typ = monster.steps.filter((s) => s.ops.typing && s.ops.typing.ok).map((s) => `${num(s.targetWords)} words: ${Math.round(s.ops.typing.value.ms10 / 10)} ms per input`);
  if (typ.length) lim.push(`- **typing** (10 input events into the last chapter, each running the studio's own input handling): ${typ.join('; ')}.`);
  P(lim.length ? lim.join('\n') : '- No operation failed up to the largest step.');
  P('');
}
if (pers) {
  P('## Persona sessions (real UI, in parallel)');
  P('');
  P('| Persona | Book | Steps done | Typed / deleted words | Outline move | EPUB check | Comments resolved in UI | Screenshots |');
  P('|---|---|---|---|---|---|---|---|');
  for (const [k, s] of Object.entries(pers.sessions)) {
    const st = (n) => s.steps.find((x) => x.name === n) || {};
    const ep = st('export-epub').epubcheck;
    P(`| ${k} | ${bookById(s.book).title} | ${s.steps.map((x) => x.name).join(', ')}${s.error ? ' — **error**: ' + s.error.split('\n')[0].slice(0, 120) : ''} | ${s.expected ? s.expected.typedWords + ' / ' + s.expected.deletedWords : '–'} | ${st('outline-move').moved ? 'moved ' + st('outline-move').from + '→' + st('outline-move').to : '–'} | ${ep ? ep.fatal + ' fatal, ' + ep.errors + ' errors' : '–'} | ${(st('comments').resolved || []).filter((r) => r.status === 200).length} | ${s.steps.filter((x) => x.shot).map((x) => '`' + x.shot + '`').join(' ')} |`);
  }
  P('');
  if (pers.twoDevices) {
    P('### One writer, two devices');
    P('');
    P('```json');
    P(j(pers.twoDevices.steps.map((x) => ({ step: x.name, ...x })), 3000));
    P('```');
    P('');
  }
}
P('## Timings');
P('');
if (phases) P(Object.entries(phases).map(([k, v]) => `${k} ${ms(v)}`).join(' · '));
P(`Seed ${seed.startedAt} → ${seed.finishedAt}; ${checks.netRequests} /api and /read requests logged (out/evidence/net-*.jsonl).`);
P('');
P('## Limitations');
P('');
P('- The seed builds each book in the studio page by calling the studio\'s own functions (import, image library intake, Story Bible seed/export/import, shelf save, EPUB and box-set builders) rather than clicking each button; the persona sessions are the UI-driven part.');
P('- The browser contexts run with the studio\'s service worker blocked (Playwright cannot route requests a service worker makes); offline behaviour is not exercised.');
P('- Pictures for single-file Import are added with the image library\'s own intake and the library ids the prepared Markdown names; a writer would upload and place each one by hand.');
P('- Reader comments come from one browser address, so the per-address limit (10 per link per 10 minutes) caps the world at 8 comments per link.');
P('- Ghostscript PDF/X jobs run one at a time on the server; only the volumes listed in world.config.json (monster.printVolumes) are printed.');
P('- Gutenberg editions mark chapters in many ways; tools/sim/sagas.json records the per-edition rule used, and the prepared chapter count is compared with each source\'s own contents list in the prep report (10-ramp-gallery/sagas/_prepared/prep-report.json).');
P('');

writeFileSync(path.join(OUT, 'report.md'), L.join('\n'));
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ run: runLine, headline: { checks: checks.checks.length, pass: passes.length, fail: fails.length, gaps: checks.gaps.length, bugs: checks.bugs.length, books: world.books.length, words: totalWords, pictures: totalImages, comments }, failing: fails, gaps: checks.gaps, bugs: checks.bugs, runs }, null, 1));
console.log(`report: ${checks.checks.length} checks, ${fails.length} fail, ${checks.gaps.length} gaps, ${checks.bugs.length} bugs -> tools/sim/out/report.md`);
