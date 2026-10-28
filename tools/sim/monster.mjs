// Load test: one synthetic "monster" book, ONLY on the disposable sim stack,
// clearly titled "SIM LOAD TEST — not a book". Its text is the real saga
// text (the prepared Dumas and Oz volumes) repeated in order until each step's
// word target is reached. At each step the same writer actions are timed —
// import, word count, Story Bible mention pass, save to the shelf (POST, PUT),
// reopen from the shelf (GET), typing in a chapter, EPUB build + archive,
// print interior build (+ a PDF/X job at the smaller steps) — each under a
// time limit; what fails or overruns is recorded with its evidence.
// Never saved anywhere but the sim stack and tools/sim/out (no backup file).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { launch, device, studio, signInApi, log, sleep, writeJson, OUT, waitFor, inject } from './driver.mjs';

const world = JSON.parse(readFileSync('/sim/out/world.json', 'utf8'));
const sagas = JSON.parse(readFileSync('/sim/sagas.json', 'utf8'));
const M = world.monster;
const P = world.personas.find((p) => p.kind === 'load');
const dir = path.join(OUT, 'monster');
mkdirSync(dir, { recursive: true });
const results = { title: M.title, persona: P.key, limitsMs: M.limitsMs, steps: [], startedAt: new Date().toISOString() };
const save = () => writeJson('monster.json', results);

// The source text: every prepared saga volume, in series and reading order, minus picture lines.
const parts = [];
for (const s of sagas.series) for (const v of s.volumes) {
  const md = readFileSync(`/sagas/_prepared/pg${v.ebook}.md`, 'utf8').replace(/^---[\s\S]*?---\s*/, '').replace(/^!\[.*$/gm, '').replace(/\n{3,}/g, '\n\n');
  parts.push(md);
}
const corpus = parts.join('\n\n');
const corpusWords = corpus.split(/\s+/).filter(Boolean).length;
results.corpusWords = corpusWords;
function textOf(target) {
  // whole copies of the corpus, then the start of one more, cut at a paragraph
  const out = [];
  let have = 0;
  while (have + corpusWords <= target) { out.push(corpus); have += corpusWords; }
  if (have < target) {
    const paras = corpus.split(/\n\n/);
    const take = [];
    for (const p of paras) { const w = p.split(/\s+/).filter(Boolean).length; if (have + w > target) break; take.push(p); have += w; }
    out.push(take.join('\n\n'));
  }
  return `---\ntitle: ${M.title}\nauthor: Beuk simulation\n---\n\n` + out.join('\n\n');
}

let busy = false; // an operation ran over its limit: the page is still working on it
async function timed(page, label, fn, arg, limitMs) {
  if (busy) return { ok: false, skipped: true, ms: 0, error: 'not run: the page was still busy with an operation that ran over its limit' };
  const t0 = Date.now();
  let timer = null;
  try {
    const v = await Promise.race([page.evaluate(fn, arg), new Promise((_, rej) => { timer = setTimeout(() => { busy = true; rej(new Error(`over the ${Math.round(limitMs / 1000)} s limit`)); }, limitMs); })]);
    return { ok: true, ms: Date.now() - t0, value: v };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

const browser = await launch();
try {
  for (const target of M.steps) {
    const file = path.join(dir, `monster-${target}.md`);
    const text = textOf(target);
    writeFileSync(file, text);
    const S = { targetWords: target, mdBytes: Buffer.byteLength(text), ops: {} };
    results.steps.push(S);
    busy = false;
    log('monster step', target, (S.mdBytes / 1048576).toFixed(1) + ' MB');
    const ctx = await device(browser, `${P.key}-${target}`);
    const errors = [];
    let page;
    try {
      page = await studio(ctx, errors);
      const si = await signInApi(page, P);
      S.signIn = si.ok;
      const L = M.limitsMs;
      S.ops.import = await timed(page, 'import', ([f, n]) => __sim.importSingle(f, n).then((r) => ({ ms: r.ms, found: r.found.slice(0, 4) })), [file, `monster-${target}.md`], L.import);
      if (!S.ops.import.ok) { S.stoppedAt = 'import'; continue; }
      S.ops.wordCount = await timed(page, 'count', () => { const t0 = performance.now(); const w = bookWordTotal(); return { words: w, ms: performance.now() - t0, chapters: state.sections.filter((s) => s.type === 'chapter').length }; }, null, L.op);
      S.ops.heap = await timed(page, 'heap', () => (performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576) } : null), null, 30000);
      S.ops.bibleMentionPass = await timed(page, 'bible', (es) => __sim.mentionPass(es), sagas.series[0].bibleAccept.slice(0, 8).map(([name, type]) => ({ name, type })), L.op);
      S.ops.serialize = await timed(page, 'serialize', () => { const t0 = performance.now(); const n = JSON.stringify({ title: state.meta.title, doc: serializeBook() }).length; return { bytes: n, ms: performance.now() - t0 }; }, null, L.op);
      S.ops.post = await timed(page, 'post', () => __sim.saveToShelf(true), null, L.save);
      const id = S.ops.post.ok && S.ops.post.value && S.ops.post.value.id;
      if (id) {
        S.ops.put = await timed(page, 'put', () => __sim.saveToShelf(false), null, L.save);
        S.ops.reopen = await timed(page, 'get', (x) => { const t0 = performance.now(); return __sim.openFromShelf(x).then((r) => ({ ...r, ms: performance.now() - t0 })); }, id, L.save);
      }
      // typing into the last chapter: how long ten keystrokes take to land
      S.ops.typing = await timed(page, 'typing', async () => {
        const last = [...state.sections].reverse().find((s) => s.type === 'chapter');
        selectSection(last.id);
        const a = document.getElementById('editorArea'); a.focus(); a.setSelectionRange(a.value.length, a.value.length);
        const t0 = performance.now();
        for (let i = 0; i < 10; i++) { a.value += 'x'; a.dispatchEvent(new Event('input', { bubbles: true })); }
        return { ms10: performance.now() - t0 };
      }, null, L.op);
      S.ops.epub = await timed(page, 'epub', () => __sim.buildEpub(null), null, L.export);
      S.ops.printHtml = await timed(page, 'print', () => __sim.buildPrint(null), null, L.export);
      if ((M.pdfxSteps || []).includes(target) && S.ops.printHtml.ok && S.ops.printHtml.value.archive && S.ops.printHtml.value.archive.id) {
        const j = await page.evaluate((x) => __sim.job('pdfx', x), S.ops.printHtml.value.archive.id);
        const t0 = Date.now(); let job = null;
        while (j.id && Date.now() - t0 < L.pdfx) { await sleep(10000); job = await page.evaluate((x) => __sim.jobGet(x), j.id); if (job && (job.status === 'done' || job.status === 'failed')) break; }
        S.ops.pdfx = { created: !!j.id, status: job && job.status, ms: Date.now() - t0, error: job && job.result && (job.result.error || job.result.stage), result: job && job.result ? JSON.stringify(job.result).slice(0, 1500) : null };
      }
    } catch (e) {
      S.error = String(e && e.stack || e).slice(0, 800);
    } finally {
      S.pageErrors = errors.slice(0, 10);
      save();
      await ctx.close().catch(() => {});
    }
    const failed = Object.entries(S.ops).filter(([, v]) => v && v.ok === false).map(([k]) => k);
    log('monster step', target, 'failed ops:', failed.join(',') || 'none', JSON.stringify(Object.fromEntries(Object.entries(S.ops).map(([k, v]) => [k, v && v.ms]))));
  }
} finally {
  results.finishedAt = new Date().toISOString();
  save();
  await browser.close();
}
