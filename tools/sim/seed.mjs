// Seed the world into the sim stack through the studio itself.
// Runs inside the Playwright container (tools/sim/sim.mjs seed).
// Output: out/seed.json (every measurement and id), out/evidence/*,
// the saved books under /sagas (the 10-ramp-gallery/sagas folder).
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { launch, device, studio, signInApi, log, sleep, writeJson, OUT, EVID, inject, waitFor } from './driver.mjs';

// a fresh run's outputs only (generated files from an earlier run)
for (const d of ['evidence', 'epub', 'shots']) rmSync(path.join('/sim/out', d), { recursive: true, force: true });
mkdirSync('/sim/out/evidence', { recursive: true });
const world = JSON.parse(readFileSync('/sim/out/world.json', 'utf8'));
const catalog = JSON.parse(readFileSync('/sim/catalog.json', 'utf8'));
const sagasCfg = JSON.parse(readFileSync('/sim/sagas.json', 'utf8'));
const PREP = '/sagas/_prepared';
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const persona = (k) => world.personas.find((p) => p.key === k);
const bookById = (id) => world.books.find((b) => b.id === id);
const seriesOf = (b) => b.series ? world.series.find((s) => s.key === b.series.key) : null;
const seed = { startedAt: new Date().toISOString(), books: {}, series: {}, lab: null, shares: [], errors: [], jobs: [] };
const saveSeed = () => writeJson('seed.json', seed);

/** Run one job to completion (the server allows 2 active per user; one at a time here). */
async function runJob(page, kind, exportId, label, timeoutMs) {
  const t0 = Date.now();
  let j = await page.evaluate(([k, id]) => __sim.job(k, id), [kind, exportId]);
  for (let tries = 0; !j.id && j.status === 429 && tries < 60; tries++) { await sleep(5000); j = await page.evaluate(([k, id]) => __sim.job(k, id), [kind, exportId]); }
  if (!j.id) { const r = { label, kind, exportId, created: false, status: j.status, error: j.error }; seed.jobs.push(r); return r; }
  let job = null;
  while (Date.now() - t0 < (timeoutMs || 900000)) {
    await sleep(kind === 'pdfx' ? 10000 : 3000);
    job = await page.evaluate((id) => __sim.jobGet(id), j.id);
    if (job && (job.status === 'succeeded' || job.status === 'failed' || job.status === 'done')) break;
  }
  const r = { label, kind, exportId, jobId: j.id, status: job && job.status, ms: Date.now() - t0, result: job && job.result };
  seed.jobs.push(r);
  return r;
}
function epubVerdict(job) {
  const res = job && job.result || {};
  const c = res.counts || {};
  return { passed: !!res.passed, fatal: c.fatal ?? null, errors: c.errors ?? null, warnings: c.warnings ?? null, status: job && job.status, firstMessages: (res.messages || []).slice(0, 5).map((m) => `${m.severity || m.level || ''} ${m.id || ''} ${(m.message || '').slice(0, 160)}`) };
}

/* ------------------------------------------------------------ import lab */
async function importLab(browser) {
  const p = persona(world.lab.persona);
  const ctx = await device(browser, p.key);
  const errors = [];
  const page = await studio(ctx, errors);
  const si = await signInApi(page, p);
  const lab = { persona: p.key, signIn: si, volumes: [] };
  // every form field in the studio whose id names a series
  lab.seriesFields = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter((e) => /series/i.test(e.id || '') || /series/i.test(e.getAttribute('data-f') || '')).map((e) => '#' + e.id));
  const metrics = async () => page.evaluate(() => { const s = __sim.bookStats(); const placed = new Set(); state.sections.forEach((x) => imageTokensIn(x.content || '').forEach((t) => placed.add(t.id))); return { unplacedLibraryImages: (state.images || []).filter((im) => !placed.has(im.id)).map((im) => im.name), chapters: s.chapters, titles: s.secs.filter((x) => x.type === 'chapter').map((x) => x.title), words: s.words, italicSpans: s.italicSpans, images: s.images, imageTokens: s.imageTokens, captions: s.captions, series: s.series, sectionTypes: s.secs.map((x) => x.kind + '/' + x.type) }; });
  for (const ebook of world.lab.volumes) {
    const v = catalog.sagas.find((x) => x.ebook === ebook);
    const imgs = JSON.parse(readFileSync(`${PREP}/pg${ebook}.images.json`, 'utf8'));
    const prepTitles = [...readFileSync(`${PREP}/pg${ebook}.md`, 'utf8').matchAll(/^## Chapter [^.\n]+(?:\. (.*))?$/gm)].map((m) => (m[1] || '').trim());
    const row = { ebook, title: v.title, prepChapters: v.chapters, prepImages: imgs.length, paths: {} };
    // A: single-file Import of the .md, then the pictures through the image library
    const a = await page.evaluate(([path, name]) => __sim.importSingle(path, name), [`${PREP}/pg${ebook}.md`, `${slug(v.title)}.md`]);
    const add = await page.evaluate((list) => __sim.addImages(list), imgs.map((im) => ({ ...im, path: `/sagas/_sources/pg${ebook}/${im.src}` })));
    row.paths.single = { ...(await metrics()), importMs: Math.round(a.ms), found: a.found, metaAfterImport: a.metaAfterImport, seriesOnEmptyDesk: a.seriesOnEmptyDesk, imagesAdded: add.added };
    // B: Bulk import (signed in, Your Shelf -> Import several) of the .md with its picture files
    await page.evaluate(() => { renderShelfList(); $('modalShelf').classList.add('open'); });
    const files = [`${PREP}/pg${ebook}.bulk.md`].concat(imgs.map((im) => `/sagas/_sources/pg${ebook}/${im.src}`));
    // the .bulk.md file name is the book's file name a writer would have
    const t0 = Date.now();
    const before = await page.evaluate(() => cloud.shelf.map((m) => m.id));
    await page.setInputFiles('#bulkFileInput', files.map((f) => f.replace('.bulk.md', '.md') === f ? f : f));
    await waitFor(page, () => { const b = $('bulkSummary'); return !!b && b.style.display !== 'none' && b.textContent.length > 0; }, null, 600000, 1000);
    const bulkMs = Date.now() - t0;
    const summaryText = await page.evaluate(() => $('bulkSummary').textContent);
    await sleep(1000);
    const after = await page.evaluate(async () => { await cloudLoadShelf(); return cloud.shelf.map((m) => ({ id: m.id, title: m.title })); });
    const created = after.filter((m) => !before.includes(m.id));
    if (created.length === 1) {
      await page.evaluate((id) => __sim.openFromShelf(id), created[0].id);
      row.paths.bulk = { ...(await metrics()), importMs: bulkMs, summary: summaryText.slice(0, 400), shelfId: created[0].id };
    } else row.paths.bulk = { error: 'bulk import created ' + created.length + ' books', summary: summaryText.slice(0, 400) };
    await page.evaluate(() => $('modalShelf').classList.remove('open'));
    // score: what each path kept of the prepared volume
    for (const [k, m] of Object.entries(row.paths)) {
      if (m.error) continue;
      // compared typography-blind: the studio's import curls quotes and dashes as it always does
      const norm = (x) => String(x || '').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
      const have = new Set(m.titles.map(norm));
      const titlesKept = prepTitles.filter((t) => t && have.has(norm(t))).length;
      m.titlesMissingSample = prepTitles.filter((t) => t && !have.has(norm(t))).slice(0, 3).concat(['| studio:'], m.titles.slice(0, 3));
      m.score = { chapterSections: m.chapters, preparedChapters: v.chapters, titlesKept: `${titlesKept}/${prepTitles.length}`, imagesPlaced: `${m.imageTokens}/${imgs.length}`, imagesInLibrary: m.images, captionsKept: m.captions, italicSpans: m.italicSpans, seriesSet: !!m.series && !m.seriesOnEmptyDesk && m.series !== (m.seriesOnEmptyDesk || null) };
    }
    lab.volumes.push(row);
    log('lab', ebook, JSON.stringify(Object.fromEntries(Object.entries(row.paths).map(([k, m]) => [k, m.score || m.error]))));
  }
  // decision rule (fixed): the path that keeps more chapter titles, then more pictures placed, then captions, then italics
  const tot = (k) => lab.volumes.reduce((acc, r) => { const s = r.paths[k] && r.paths[k].score; if (!s) return acc; const [a] = s.titlesKept.split('/'); const [b] = s.imagesPlaced.split('/'); return [acc[0] + +a, acc[1] + +b, acc[2] + s.captionsKept, acc[3] + s.italicSpans]; }, [0, 0, 0, 0]);
  const A = tot('single'), B = tot('bulk');
  const cmp = (x, y) => { for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  lab.totals = { single: A, bulk: B, order: 'titlesKept, imagesPlaced, captionsKept, italicSpans' };
  lab.chosen = cmp(A, B) >= 0 ? 'single' : 'bulk';
  lab.errors = errors;
  seed.lab = lab;
  saveSeed();
  await ctx.close();
  return lab.chosen;
}

/* ---------------------------------------------------------- one writer */
async function seedPersona(browser, pKey, importPath) {
  const p = persona(pKey);
  const ctx = await device(browser, p.key);
  const errors = [];
  let page = await studio(ctx, errors);
  const si = await signInApi(page, p);
  if (!si.ok) throw new Error(`${p.key}: sign-in failed ${JSON.stringify(si)}`);
  const exportsBy = {};
  const myBooks = world.books.filter((b) => b.persona === p.key);
  for (const b of myBooks) {
    const t0 = Date.now();
    const rec = { id: b.id, persona: p.key, title: b.title, series: b.series, source: b.source };
    try {
      const S = seriesOf(b);
      // 1. the book's text
      if (b.source.kind === 'saga') {
        const imgs = JSON.parse(readFileSync(`${PREP}/pg${b.source.ebook}.images.json`, 'utf8'));
        const imp = await page.evaluate(([path, name]) => __sim.importSingle(path, name), [`${PREP}/pg${b.source.ebook}.md`, `${slug(b.title)}.md`]);
        rec.import = { path: importPath, ms: Math.round(imp.ms), found: imp.found, metaAfterImport: imp.metaAfterImport };
        if (imgs.length) rec.imagesAdded = await page.evaluate((list) => __sim.addImages(list), imgs.map((im) => ({ ...im, path: `/sagas/_sources/pg${b.source.ebook}/${im.src}` })));
      } else {
        const src = catalog.sources.find((x) => x.key === b.source.key);
        await page.evaluate((s) => __sim.openSource(s), { kind: src.kind, file: src.file });
        if (b.source.recut) await page.evaluate((r) => __sim.recut(r), { body: b.source.recut.body, last: b.series.order === b.series.of });
      }
      // 2. the credits a writer sets: title, author, series (no field in Book details holds a series; it is set on the book's metadata as the studio's frontmatter import would)
      // what the desk's metadata says before the writer sets anything (evidence for the meta-carry-over check)
      rec.metaBeforeSet = await page.evaluate(() => ({ series: state.meta.series === undefined ? null : state.meta.series, title: state.meta.title }));
      await page.evaluate((m) => __sim.setMeta(m), { title: b.title, author: b.author, series: b.series ? b.series.name : null });
      // the Gutenberg sagas are public-domain texts: their copyright page and dc:rights say so (Project Settings → Rights → Public domain); no first-publication year is set, as none is sourced in sagas.json
      if (b.source.kind === 'saga') await page.evaluate((m) => __sim.setMeta(m), { rightsMode: 'pd', rights: '' });
      if (b.source.kind !== 'saga') await page.evaluate(() => { state.meta.bookId = newBookId(); });
      // 3. Also by: the siblings in reading order
      if (S) {
        const lines = S.books.filter((id) => id !== b.id).map((id) => { const x = bookById(id); return `[${x.title}](${x.alsoByLink})`; });
        await page.evaluate((l) => __sim.setAlsoBy(l), lines);
      }
      // 4. Story Bible: authored in book 1, imported into the rest, edited apart later
      if (S) {
        if (S.bible.authorIn === b.id) {
          rec.bibleSeed = await page.evaluate((o) => __sim.bibleSeed(o), S.bibleAccept ? { accept: S.bibleAccept } : { top: S.bible.seedTop });
          const doc = await page.evaluate(() => __sim.bibleExport());
          seed.series[S.key] = { ...(seed.series[S.key] || {}), bibleExport: doc, bibleExportEntries: doc.entries.map((e) => ({ name: e.name, type: e.type })) };
          writeFileSync(path.join(EVID, `bible-export-${S.key}.json`), JSON.stringify(doc, null, 1));
        } else {
          const doc = seed.series[S.key] && seed.series[S.key].bibleExport;
          rec.bibleImport = doc ? await page.evaluate((d) => __sim.bibleImport(d), doc) : { ok: false, error: 'no export from book 1' };
        }
        if (S.bible.editIn === b.id) rec.bibleEdit = await page.evaluate((c) => __sim.bibleEdit(c), { alias: 'SIM-EDIT-ALIAS', description: `[sim] edited in ${b.title} only` });
        const ex = seed.series[S.key] && seed.series[S.key].bibleExport;
        if (ex) rec.presence = await page.evaluate((es) => __sim.mentionPass(es), ex.entries.map((e) => ({ name: e.name, type: e.type, aliases: e.aliases, exclude: e.exclude, exactCase: e.exactCase })));
      }
      rec.mentionPass = await page.evaluate(() => __sim.mentionPass());
      // 5. on the shelf: the first save (POST), then an ordinary autosave (PUT, If-Match)
      rec.stats = await page.evaluate(() => { const s = __sim.bookStats(); delete s.secs; return s; });
      rec.sectionHashes = await page.evaluate(() => __sim.bookStats().secs.map((s) => ({ kind: s.kind, type: s.type, title: s.title, words: s.words, hash: s.hash })));
      rec.post = await page.evaluate(() => __sim.saveToShelf(true));
      rec.put = await page.evaluate(() => __sim.saveToShelf(false));
      if (!rec.post.id) throw new Error('not on the shelf: ' + JSON.stringify(rec.post));
      rec.shelfId = rec.post.id;
      // 6. EPUB (built in the browser, archived on the shelf, checked by EPUBCheck on the server)
      const epubName = b.source.kind === 'saga' ? `epub/${b.series.key}-${String(b.series.order).padStart(2, '0')}-${slug(b.title)}.epub` : null;
      rec.epub = await page.evaluate((n) => __sim.buildEpub(n), epubName);
      if (rec.epub.archive.id) exportsBy[b.id] = rec.epub.archive.id;
      if (rec.epub.archive.id) rec.epubcheck = epubVerdict(await runJob(page, 'epubcheck', rec.epub.archive.id, b.id + ' epub', 600000));
      // 7. a real print PDF (renderer + Ghostscript) for the chosen volumes
      if (b.source.kind === 'saga' && (world.monster.printVolumes || []).includes(b.source.ebook)) {
        rec.print = await page.evaluate((n) => __sim.buildPrint(n), null);
        // the PDF/X job runs after every EPUBCheck (the server runs one job at a time and a print job takes minutes)
        if (rec.print.archive.id) (seed.pendingPdfx = seed.pendingPdfx || []).push({ book: b.id, persona: p.key, exportId: rec.print.archive.id });
      }
      // 8. saved as a .beuk-backup.json the studio can open
      const dest = b.source.kind === 'saga'
        ? `sagas/${b.series.key}/${String(b.series.order).padStart(2, '0')}-${slug(b.title)}.beuk-backup.json`
        : `sagas/world/${p.key}/${b.id}-${slug(b.title)}.beuk-backup.json`;
      rec.backup = { file: dest.replace(/^sagas\//, ''), ...(await page.evaluate((d) => __sim.backup(d), dest)) };
    } catch (e) {
      rec.error = String(e && e.stack || e).slice(0, 800);
      seed.errors.push({ book: b.id, error: rec.error });
      log('ERROR', b.id, rec.error.split('\n')[0]);
      if (/Target page|crash|closed/i.test(rec.error)) { page = await studio(ctx, errors); await signInApi(page, p); }
    }
    rec.ms = Date.now() - t0;
    seed.books[b.id] = rec;
    saveSeed();
    log(p.key, b.id, b.title.slice(0, 40), rec.stats ? `${rec.stats.words}w ${rec.stats.images}img ${(rec.stats.docBytes / 1048576).toFixed(1)}MB put=${Math.round(rec.put && rec.put.ms)}ms epub=${rec.epub && rec.epub.bytes}` : 'ERR', `${Math.round(rec.ms / 1000)}s`);
  }
  // 9. a Box Set of each of this writer's series, from book 1
  for (const S of world.series.filter((s) => s.persona === p.key)) {
    try {
      await inject(page);
      const first = seed.books[S.boxSet.in];
      await page.evaluate((id) => __sim.openFromShelf(id), first.shelfId);
      const sibs = S.boxSet.volumes.slice(1).map((id) => ({ id: seed.books[id].shelfId, fileName: `${bookById(id).title}.md` }));
      const t0 = Date.now();
      const bs = await page.evaluate(([s, n]) => __sim.boxSet(s, n), [sibs, `epub/${S.key}-box-set.epub`]);
      bs.totalMs = Date.now() - t0;
      if (bs.archive.id) bs.epubcheck = epubVerdict(await runJob(page, 'epubcheck', bs.archive.id, S.key + ' box set', 900000));
      seed.series[S.key] = { ...(seed.series[S.key] || {}), boxSet: bs };
      log(p.key, 'box set', S.key, `${bs.vols.length} vols ${bs.bytes} bytes`, JSON.stringify(bs.epubcheck || {}).slice(0, 120));
    } catch (e) {
      seed.errors.push({ series: S.key, error: String(e && e.stack || e).slice(0, 800) });
      log('ERROR box set', S.key, String(e).slice(0, 200));
    }
    saveSeed();
  }
  seed.series[`__errors_${p.key}`] = errors;
  await ctx.close();
}

/* ------------------------------------------- beta readers: the real reader page */
async function seedShares(browser) {
  const owners = {};
  for (const sh of world.shares) {
    const ownerP = persona(sh.owner);
    if (!owners[sh.owner]) {
      const ctx = await device(browser, sh.owner + '-shares');
      const page = await studio(ctx, []);
      await signInApi(page, ownerP);
      owners[sh.owner] = { ctx, page };
    }
    const { page } = owners[sh.owner];
    const mId = seed.books[sh.book] && seed.books[sh.book].shelfId;
    const rec = { owner: sh.owner, book: sh.book, manuscriptId: mId, comments: [] };
    // the request betaCreate sends
    const r = await page.evaluate(async (id) => apiFetch('/api/shares', { method: 'POST', body: JSON.stringify({ manuscriptId: id, allowComments: true, readerNameRequired: true }) }), mId);
    rec.create = { status: r && r.__status, shareId: r && r.share && r.share.id, sectionCount: r && r.share && r.share.sectionCount };
    rec.token = r && r.token;
    if (!rec.token) { seed.shares.push(rec); continue; }
    // the frozen copy's chapters, as the reader page serves them
    const readerCtx = await device(browser, 'readers');
    const rp = await readerCtx.newPage();
    for (const c of sh.comments) {
      const reader = persona(c.reader);
      await rp.goto(`${'http://localhost:8190'}/read/${rec.token}`, { waitUntil: 'load' });
      const nSecs = await rp.evaluate(() => document.querySelectorAll('.rd-nav ol li').length);
      // the planned chapter, or the next one (wrapping) that has a paragraph to comment on
      let ci = Math.min(nSecs - 1, Math.floor(c.section * nSecs));
      let blocks = [];
      for (let tries = 0; tries < nSecs; tries++) {
        await rp.goto(`${'http://localhost:8190'}/read/${rec.token}?c=${ci}`, { waitUntil: 'load' });
        blocks = await rp.evaluate(() => [...document.querySelectorAll('.rd-page [data-p]')].filter((e) => e.textContent.trim().length > 20).map((e) => ({ p: +e.getAttribute('data-p'), text: e.textContent.replace(/\s+/g, ' ').trim() })));
        if (blocks.length) break;
        ci = (ci + 1) % nSecs;
      }
      if (!blocks.length) { rec.comments.push({ ...c, skipped: 'no paragraph with text in chapter ' + ci }); continue; }
      const blk = blocks[Math.min(blocks.length - 1, Math.floor(c.paragraph * blocks.length))];
      // select the paragraph's first words as a reader would, then "Comment on this"
      const sel = await rp.evaluate((pi) => {
        const el = document.querySelector('.rd-page [data-p="' + pi + '"]');
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const first = walker.nextNode();
        if (!first) return null;
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(first, Math.min(first.textContent.length, 60));
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return s.toString();
      }, blk.p);
      await sleep(150);
      const btn = rp.locator('button.rd-float');
      if (await btn.isVisible()) await btn.click();
      await rp.fill('#rdName', reader.name);
      await rp.fill('#rdBody', c.body);
      const respP = rp.waitForResponse((res) => res.url().endsWith('/comments') && res.request().method() === 'POST');
      await rp.click('#rdForm button[type=submit]');
      const res = await respP;
      const body = await res.json().catch(() => null);
      rec.comments.push({ ...c, chapterIndex: ci, selected: sel, block: blk, status: res.status(), comment: body && body.comment, error: body && body.error });
    }
    await readerCtx.close();
    // the writer resolves some (the request betaOnCommentsClick sends) — the session writers do theirs in the UI
    const isSession = world.sessions.some((s) => s.persona === sh.owner);
    rec.resolved = [];
    if (!isSession) {
      for (const ci of sh.resolve) {
        const cm = rec.comments[ci] && rec.comments[ci].comment;
        if (!cm) continue;
        const rr = await page.evaluate(([sid, cid]) => apiFetch('/api/shares/' + sid + '/comments/' + cid + '/resolve', { method: 'POST', body: '{}' }), [rec.create.shareId, cm.id]);
        rec.resolved.push({ commentId: cm.id, status: rr && rr.comment ? 200 : rr && rr.__status, resolvedAt: rr && rr.comment && rr.comment.resolvedAt });
      }
    }
    seed.shares.push(rec);
    saveSeed();
    log('share', sh.owner, sh.book, rec.comments.map((c) => c.status).join(','));
  }
  for (const o of Object.values(owners)) await o.ctx.close();
}

/* ------------------------------------------------- the saved showcase files */
function writeManifest() {
  const m = { generatedAt: new Date().toISOString().slice(0, 10), note: 'Books built by the Beuk simulation (tools/sim) from public-domain texts on gutenberg.org — see sources.json. Each .beuk-backup.json opens in the studio (Restore a backup). Mention counts are the studio\'s own Story Bible matcher run over each volume with the series Bible authored in volume 1.', series: [] };
  for (const s of sagasCfg.series) {
    const W = world.series.find((x) => x.key === s.key);
    const sd = seed.series[s.key] || {};
    const entries = (sd.bibleExportEntries || []);
    const vols = W.books.map((id, i) => {
      const r = seed.books[id] || {};
      return { order: i + 1, title: bookById(id).title, ebook: bookById(id).source.ebook, gutenberg: `https://www.gutenberg.org/ebooks/${bookById(id).source.ebook}`, file: r.backup && r.backup.file, words: r.stats && r.stats.words, chapters: r.stats && r.stats.chapters, sections: r.stats && r.stats.sections, images: r.stats && r.stats.images, bibleEntries: r.stats && r.stats.bible ? r.stats.bible.length : 0, docBytes: r.stats && r.stats.docBytes, error: r.error || undefined };
    });
    const presence = entries.map((e) => ({ name: e.name, type: e.type, perVolume: W.books.map((id) => { const pr = seed.books[id] && seed.books[id].presence; return pr && pr.per[e.name] ? pr.per[e.name].total : null; }) }));
    m.series.push({ key: s.key, name: s.name, author: s.author, readingOrder: vols.map((v) => v.title), volumes: vols, bible: entries, presence, boxSet: sd.boxSet ? { file: `../../../tools/sim/out/epub/${s.key}-box-set.epub (not kept in the gallery)`, volumes: sd.boxSet.vols.length, bytes: sd.boxSet.bytes } : null });
  }
  writeFileSync('/sagas/manifest.json', JSON.stringify(m, null, 1));
}

/* ------------------------------------------------------------------ main */
const browser = await launch();
try {
  const chosen = await importLab(browser);
  log('import path chosen:', chosen);
  if (process.env.SIM_ONLY === 'lab') throw new Error('SIM_ONLY=lab: stopping after the import lab');
  if (chosen !== 'single') log('NOTE: bulk import kept more; the sagas still use single-file import + library pictures (bulk drops captions) — see lab evidence');
  const ramp = world.personas.filter((p) => p.kind === 'ramp').map((p) => p.key);
  await Promise.all([
    seedPersona(browser, 'sim01-dumas', 'single'),
    seedPersona(browser, 'sim02-baum', 'single'),
    (async () => { for (const k of ramp) await seedPersona(browser, k, 'single'); })(),
  ]);
  await seedShares(browser);
  // the deferred print jobs: a real renderer PDF + Ghostscript PDF/X per chosen volume
  for (const pj of seed.pendingPdfx || []) {
    const ctx = await device(browser, pj.persona + '-pdfx');
    const page = await studio(ctx, []);
    await signInApi(page, persona(pj.persona));
    const j = await runJob(page, 'pdfx', pj.exportId, pj.book + ' pdfx', 1800000);
    seed.books[pj.book].pdfx = { status: j.status, ms: j.ms, result: j.result };
    log('pdfx', pj.book, j.status, Math.round(j.ms / 1000) + 's');
    saveSeed();
    await ctx.close();
  }
  writeManifest();
} catch (e) {
  seed.errors.push({ fatal: String(e && e.stack || e).slice(0, 1500) });
  log('FATAL', e);
} finally {
  seed.finishedAt = new Date().toISOString();
  saveSeed();
  await browser.close();
}
