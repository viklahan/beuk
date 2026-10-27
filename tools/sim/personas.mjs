// Persona browser sessions: each Ramp writer, in their own browser
// context at the same time as the others, signs in through the real UI,
// opens a book from the shelf and works on it the way a writer does —
// typing, deleting, reordering in Outline, the Story Bible, goals,
// exports, a beta link, reading and resolving reader comments. Then one
// writer on two devices edits different and then the same chapter.
// Output: out/personas.json, out/shots/*.png, out/dl/*.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, device, studio, log, sleep, writeJson, OUT, waitFor, inject } from './driver.mjs';

const world = JSON.parse(readFileSync('/sim/out/world.json', 'utf8'));
const seed = JSON.parse(readFileSync('/sim/out/seed.json', 'utf8'));
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
mkdirSync(path.join(OUT, 'dl'), { recursive: true });
const persona = (k) => world.personas.find((p) => p.key === k);
const results = { startedAt: new Date().toISOString(), sessions: {}, twoDevices: null, errors: [] };
const save = () => writeJson('personas.json', results);
const shot = async (page, name) => { const f = `shots/${name}.png`; await page.screenshot({ path: path.join(OUT, f) }); return f; };

async function uiSignIn(page, p) {
  await page.click('#btnAccount');
  await waitFor(page, () => document.getElementById('modalAuth').classList.contains('open'));
  await page.fill('#authEmail', p.email);
  await page.fill('#authPassword', p.password);
  await page.click('#btnAuthSubmit');
  await waitFor(page, () => !!(cloud.user && cloud.user.email), null, 60000);
  await sleep(1500);
  // a fresh device may be offered "bring this book to your shelf" for its desk; the desk here is empty
  await page.evaluate(() => { const m = document.getElementById('modalConfirm'); if (m && m.classList.contains('open')) { const no = m.querySelector('[data-confirm="no"], #btnConfirmNo'); if (no) no.click(); } });
}
async function uiOpenBook(page, shelfId) {
  await page.click('#btnAccount');
  await waitFor(page, () => document.getElementById('modalShelf').classList.contains('open'));
  await waitFor(page, (id) => !!document.querySelector('[data-open-book="' + id + '"]'), shelfId, 60000);
  await page.click(`[data-open-book="${shelfId}"]`);
  await waitFor(page, (id) => cloud.linkedId === id && !document.getElementById('modalShelf').classList.contains('open'), shelfId, 120000);
  await sleep(800);
}
const saved = (page, ms = 120000) => waitFor(page, () => cloud.syncStatus === 'saved' && !cloudDirty && !cloud.conflict, null, ms, 300);
const bodyChapters = (page) => page.evaluate(() => state.sections.filter((s) => s.kind === 'body' && s.included !== false && countWords(s.content || '', state.meta.language) > 0).map((s) => ({ id: s.id, title: s.title, words: countWords(s.content, state.meta.language) })));
const pick = (list, f) => list[Math.min(list.length - 1, Math.floor(f * list.length))];
const words = (page, text) => page.evaluate((t) => countWords(t, state.meta.language), text);

async function session(browser, S) {
  const p = persona(S.persona);
  const R = { persona: p.key, book: S.book, steps: [], shots: [] };
  results.sessions[p.key] = R;
  const step = (name, data) => { R.steps.push({ name, at: new Date().toISOString(), ...data }); save(); };
  const ctx = await device(browser, p.key + '-ui');
  const errors = [];
  const page = await studio(ctx, errors);
  try {
    await uiSignIn(page, p);
    step('sign-in', { user: await page.evaluate(() => cloud.user.email) });
    const shelfId = seed.books[S.book].shelfId;
    await uiOpenBook(page, shelfId);
    const before = await page.evaluate(() => ({ words: bookWordTotal(), revision: cloud.baseRevision, order: state.sections.map((s) => s.id) }));
    step('open', { shelfId, ...before, shot: await shot(page, `${p.key}-01-open`) });
    const chs = await bodyChapters(page);
    // type: a sentence moved from another chapter of the same book, marked
    const target = pick(chs, S.typeAt);
    const donor = chs.find((c) => c.id !== target.id) || target;
    const sentence = await page.evaluate((id) => { const t = state.sections.find((s) => s.id === id).content || ''; const m = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').match(/[A-Z“"][^.!?\n]{10,140}[.!?]/); return m ? m[0] : 'Words.'; }, donor.id);
    const typed = `SIMTYPED-${p.key} ${sentence}`;
    await page.click(`.sec-item[data-sec="${target.id}"]`);
    await page.click('#editorArea');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n' + typed, { delay: 2 });
    const typedWords = await words(page, typed);
    const totalAfterType = await page.evaluate(() => bookWordTotal());
    const typedSection = await page.evaluate((id) => { const s = state.sections.find((x) => x.id === id); return { words: sectionWords(s), tail: (s.content || '').slice(-200) }; }, target.id);
    step('type', { chapter: target.title, typed, typedWords, totalAfterType, totalDelta: totalAfterType - before.words, sectionAfter: typedSection });
    // delete: the last paragraph of another chapter
    const delCh = pick(chs.filter((c) => c.id !== target.id), S.deleteAt) || target;
    await page.click(`.sec-item[data-sec="${delCh.id}"]`);
    const del = await page.evaluate(() => {
      const a = document.getElementById('editorArea');
      const v = a.value; const re = /\S[\s\S]*?(?=\n\s*\n|$)/g; let m, last = null;
      while ((m = re.exec(v))) if (!/^!\[/.test(m[0])) last = { s: m.index, e: m.index + m[0].length, text: m[0] };
      if (!last) return null;
      a.focus(); a.setSelectionRange(last.s, last.e);
      return last;
    });
    if (del) { await page.keyboard.press('Backspace'); }
    const deletedWords = del ? await words(page, del.text) : 0;
    const totalAfterDelete = await page.evaluate(() => bookWordTotal());
    step('delete', { chapter: delCh.title, deletedText: del && del.text.slice(0, 200), deletedWords, totalAfterDelete, totalDelta: totalAfterDelete - totalAfterType });
    // Outline: move one chapter a place later
    await page.click('#tabBtnOutline');
    await sleep(600);
    const mv = pick(chs, S.moveAt);
    const canMove = await page.evaluate((id) => { const b = document.querySelector('[data-ol="' + id + '"] [data-olmv="1"]'); return !!b && !b.disabled; }, mv.id);
    const orderBefore = await page.evaluate(() => state.sections.map((s) => s.id));
    if (canMove) await page.click(`[data-ol="${mv.id}"] [data-olmv="1"]`);
    await sleep(400);
    const orderAfter = await page.evaluate(() => state.sections.map((s) => s.id));
    step('outline-move', { chapter: mv.title, moved: canMove, from: orderBefore.indexOf(mv.id), to: orderAfter.indexOf(mv.id), shot: await shot(page, `${p.key}-02-outline`) });
    await page.click('#tabBtnContent').catch(() => {});
    // Story Bible: seed one name Story Insights found, then note it
    await page.click('#btnBible');
    await waitFor(page, () => document.getElementById('modalBible').classList.contains('open'));
    await page.click('#btnBibSeed');
    await sleep(500);
    const cand = await page.evaluate(() => { const s = document.querySelector('#bibSeedList select[data-seed-name]'); return s ? s.getAttribute('data-seed-name') : null; });
    let bibleNote = null;
    if (cand) {
      await page.selectOption(`#bibSeedList select[data-seed-name="${cand.replace(/"/g, '\\"')}"]`, 'character');
      await page.click('#btnBibSeedAdd');
      await sleep(400);
      if (await page.locator('#bibFDesc').isVisible().catch(() => false)) { await page.fill('#bibFDesc', '[sim] noted in a UI session'); bibleNote = 'description'; }
    }
    const bible = await page.evaluate(() => bibleEntries().map((e) => ({ name: e.name, type: e.type, description: e.description })));
    step('bible', { candidate: cand, bibleNote, bible, shot: await shot(page, `${p.key}-03-bible`) });
    await page.click('#btnCloseBible');
    // Goals
    await page.click('#btnGoals');
    await waitFor(page, () => document.getElementById('modalGoals').classList.contains('open'));
    await page.fill('#goalDailyInput', String(S.goals.daily));
    await page.press('#goalDailyInput', 'Tab');
    await page.fill('#goalProjectInput', String(S.goals.project));
    await page.press('#goalProjectInput', 'Tab');
    await sleep(300);
    const goals = await page.evaluate(() => Object.assign({}, state.goals));
    step('goals', { asked: S.goals, state: goals, shot: await shot(page, `${p.key}-04-goals`) });
    await page.click('#btnCloseGoals');
    const tSave = Date.now();
    await saved(page);
    step('autosave', { ms: Date.now() - tSave, revision: await page.evaluate(() => cloud.baseRevision) });
    // Exports: EPUB and the submission manuscript (.docx), both downloaded
    await page.click('#btnExport');
    await waitFor(page, () => document.getElementById('modalExport').classList.contains('open'));
    const [epubDl] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('#btnBuildEpub')]);
    const epubFile = path.join(OUT, 'dl', `${p.key}.epub`);
    await epubDl.saveAs(epubFile);
    await inject(page);
    const arc = await page.evaluate(async (f) => { const r = await fetch('/__sim/file?p=' + encodeURIComponent(f)); const b = await r.blob(); return __sim.archive('epub', new Blob([b], { type: 'application/epub+zip' }), 'ui-export.epub'); }, epubFile);
    let check = null;
    if (arc.id) {
      const j = await page.evaluate((id) => __sim.job('epubcheck', id), arc.id);
      for (let i = 0; i < 200 && j.id; i++) { await sleep(3000); const g = await page.evaluate((id) => __sim.jobGet(id), j.id); if (g && (g.status === 'done' || g.status === 'failed')) { check = g; break; } }
    }
    const c = check && check.result && check.result.counts;
    step('export-epub', { file: path.basename(epubFile), bytes: readFileSync(epubFile).length, epubcheck: check ? { status: check.status, passed: !!check.result.passed, fatal: c && c.fatal, errors: c && c.errors, warnings: c && c.warnings, messages: (check.result.messages || []).slice(0, 5).map((m) => `${m.severity || ''} ${m.id || ''} ${(m.message || '').slice(0, 160)}`) } : null });
    await page.evaluate(() => document.getElementById('modalExport').classList.add('open'));
    await page.click('#btnMsOpen');
    await waitFor(page, () => document.getElementById('modalManuscript').classList.contains('open'));
    const [msDl] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('#btnMsDownload')]);
    const msFile = path.join(OUT, 'dl', `${p.key}-submission.docx`);
    await msDl.saveAs(msFile);
    const docx = readFileSync(msFile);
    step('export-submission', { file: path.basename(msFile), bytes: docx.length, zip: docx.slice(0, 2).toString() === 'PK', hasDocumentXml: docx.includes(Buffer.from('word/document.xml')), shot: await shot(page, `${p.key}-05-manuscript`) });
    await page.click('#btnMsClose');
    // Share with beta readers (the Export panel's beta section)
    await page.evaluate(() => document.getElementById('modalExport').classList.add('open'));
    await page.click('#btnExport').catch(() => {});
    await waitFor(page, () => !!document.getElementById('btnBetaCreate'), null, 60000);
    const shareResp = page.waitForResponse((r) => r.url().endsWith('/api/shares') && r.request().method() === 'POST', { timeout: 120000 });
    await page.click('#btnBetaCreate');
    const sr = await shareResp;
    const sj = await sr.json().catch(() => null);
    await waitFor(page, () => !!document.getElementById('betaNewUrl'), null, 60000);
    step('share-ui', { status: sr.status(), shareId: sj && sj.share && sj.share.id, link: await page.evaluate(() => document.getElementById('betaNewUrl').value.replace(/\/read\/.*/, '/read/<token>')), revisionAtShare: await page.evaluate(() => cloud.baseRevision), wordsAtShare: await page.evaluate(() => bookWordTotal()), shot: await shot(page, `${p.key}-06-share`) });
    R.uiShareToken = sj && sj.token;
    await page.click('#btnCloseExport');
    // Reader comments: read them, resolve the ones the world says to
    const ws = world.shares.find((x) => x.owner === p.key);
    const ss = seed.shares.find((x) => x.owner === p.key);
    await page.click('#btnBetaComments');
    await waitFor(page, () => document.getElementById('modalBetaComments').classList.contains('open'));
    await sleep(1500);
    const listed = await page.evaluate(() => beta.comments.map((c) => ({ id: c.id, resolved: !!c.resolvedAt })));
    const resolved = [];
    for (const ci of (ws ? ws.resolve : [])) {
      const cm = ss && ss.comments[ci] && ss.comments[ci].comment;
      if (!cm) continue;
      const sel = `[data-bc-resolve="${cm.id}"]`;
      if (!(await page.locator(sel).count())) { resolved.push({ id: cm.id, ui: 'button not found' }); continue; }
      const rp = page.waitForResponse((r) => r.url().includes(cm.id) && r.request().method() === 'POST');
      await page.click(sel);
      const rr = await rp;
      resolved.push({ id: cm.id, status: rr.status() });
      await sleep(300);
    }
    // where the writer lands on "jump to passage": the studio's own locator
    const jumps = [];
    for (const c of (ss ? ss.comments : []).filter((x) => x.comment)) {
      jumps.push(await page.evaluate((cc) => { const s = state.sections.find((x) => x.id === cc.sectionId); if (!s) return { id: cc.id, section: 'missing' }; const h = betaLocate(s.content, cc); return { id: cc.id, found: !!h, exact: !!(h && h.exact), text: h ? s.content.slice(h.start, h.end).slice(0, 120) : null }; }, c.comment));
    }
    step('comments', { listed: listed.length, resolved, jumps, shot: await shot(page, `${p.key}-07-comments`) });
    await page.click('#btnBetaCClose').catch(() => page.evaluate(() => document.getElementById('modalBetaComments').classList.remove('open')));
    await saved(page).catch(() => {});
    const after = await page.evaluate(() => ({ words: bookWordTotal(), revision: cloud.baseRevision, syncStatus: cloud.syncStatus, order: state.sections.map((s) => s.id) }));
    step('end', { ...after, expectedWords: before.words + typedWords - deletedWords });
    R.expected = { wordsBefore: before.words, typedWords, deletedWords, expectedWords: before.words + typedWords - deletedWords, typedMarker: typed, deletedText: del && del.text, orderAfter: after.order, shelfId };
  } catch (e) {
    R.error = String(e && e.stack || e).slice(0, 1200);
    results.errors.push({ persona: p.key, error: R.error });
    try { R.shots.push(await shot(page, `${p.key}-error`)); } catch { /* page gone */ }
    log('ERROR session', p.key, R.error.split('\n')[0]);
  }
  R.pageErrors = errors.slice(0, 20);
  save();
  await ctx.close();
}

/* One writer, two devices: edits to different chapters, then the same chapter. */
async function twoDevices(browser) {
  const T = world.twoDevices;
  const p = persona(T.persona);
  const shelfId = seed.books[T.book].shelfId;
  const R = { persona: p.key, book: T.book, shelfId, steps: [] };
  results.twoDevices = R;
  const step = (name, data) => { R.steps.push({ name, at: new Date().toISOString(), ...data }); save(); };
  const A = await device(browser, p.key + '-deviceA');
  const B = await device(browser, p.key + '-deviceB');
  const pa = await studio(A, []); const pb = await studio(B, []);
  try {
    await uiSignIn(pa, p); await uiSignIn(pb, p);
    await uiOpenBook(pa, shelfId); await uiOpenBook(pb, shelfId);
    const chs = await bodyChapters(pa);
    const cA = pick(chs, T.chapterA);
    const cB = pick(chs.filter((c) => c.id !== cA.id), T.chapterB) || cA;
    step('both-open', { revA: await pa.evaluate(() => cloud.baseRevision), revB: await pb.evaluate(() => cloud.baseRevision), chapterA: cA.title, chapterB: cB.title });
    // Round 1 — different chapters. A writes and saves; B (not reloaded) writes elsewhere.
    const typeIn = async (page, ch, marker) => { await page.click(`.sec-item[data-sec="${ch.id}"]`); await page.click('#editorArea'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n\n' + marker, { delay: 2 }); };
    await typeIn(pa, cA, 'SIMDEVICE-A1 first device, different chapter.');
    await saved(pa);
    step('A-saved', { revA: await pa.evaluate(() => cloud.baseRevision) });
    const put409 = pb.waitForResponse((r) => /\/api\/manuscripts\//.test(r.url()) && r.request().method() === 'PUT', { timeout: 60000 }).catch(() => null);
    await typeIn(pb, cB, 'SIMDEVICE-B1 second device, other chapter.');
    const r1 = await put409;
    await waitFor(pb, () => !!cloud.conflict || (cloud.syncStatus === 'saved' && !cloudDirty), null, 90000, 300).catch(() => null);
    const conflict1 = await pb.evaluate(() => ({ open: document.getElementById('modalConflict').classList.contains('open'), conflict: !!cloud.conflict, status: cloud.syncStatus }));
    step('B-saves-different-chapter', { putStatus: r1 && r1.status(), ...conflict1, shot: await shot(pb, `${p.key}-twodev-01-conflict`) });
    if (conflict1.open) {
      await pb.click('#btnConflictBoth');
      await saved(pb);
    }
    const shelf1 = await pa.evaluate(async (id) => { const r = await apiFetch('/api/manuscripts/' + id, {}); const all = r.manuscript.doc.sections.map((s) => s.content || '').join('\n'); return { revision: r.manuscript.revision, hasA1: all.includes('SIMDEVICE-A1'), hasB1: all.includes('SIMDEVICE-B1') }; }, shelfId);
    const histB = await pb.evaluate(() => (state.history || []).map((h) => ({ name: h.name, auto: h.auto, hasA1: JSON.stringify(h.doc || {}).includes('SIMDEVICE-A1'), hasB1: JSON.stringify(h.doc || {}).includes('SIMDEVICE-B1') })).slice(0, 4));
    step('after-keep-both', { choice: conflict1.open ? 'Keep both' : 'none (no conflict shown)', shelf: shelf1, historyOnB: histB });
    // Round 2 — the same chapter. The writer picks up a third device (fresh
    // sign-in, the shelf copy), writes in chapter A and saves; B, still open, writes there too.
    const C = await device(browser, p.key + '-deviceC');
    const pc = await studio(C, []);
    await uiSignIn(pc, p);
    await uiOpenBook(pc, shelfId);
    await typeIn(pc, cA, 'SIMDEVICE-A2 first device, same chapter.');
    await saved(pc);
    step('C-saved', { revC: await pc.evaluate(() => cloud.baseRevision), revB: await pb.evaluate(() => cloud.baseRevision) });
    await C.close();
    const put2 = pb.waitForResponse((r) => /\/api\/manuscripts\//.test(r.url()) && r.request().method() === 'PUT', { timeout: 60000 }).catch(() => null);
    await typeIn(pb, cA, 'SIMDEVICE-B2 second device, same chapter.');
    const r2 = await put2;
    await waitFor(pb, () => !!cloud.conflict || (cloud.syncStatus === 'saved' && !cloudDirty), null, 90000, 300).catch(() => null);
    const conflict2 = await pb.evaluate(() => ({ open: document.getElementById('modalConflict').classList.contains('open'), conflict: !!cloud.conflict }));
    step('B-saves-same-chapter', { putStatus: r2 && r2.status(), ...conflict2, shot: await shot(pb, `${p.key}-twodev-02-conflict`) });
    if (conflict2.open) { await pb.click('#btnConflictShelf'); await saved(pb).catch(() => {}); }
    const shelf2 = await pa.evaluate(async (id) => { const r = await apiFetch('/api/manuscripts/' + id, {}); const all = r.manuscript.doc.sections.map((s) => s.content || '').join('\n'); const hist = (r.manuscript.doc.history || []).map((h) => JSON.stringify(h.doc || {})); return { revision: r.manuscript.revision, hasA2: all.includes('SIMDEVICE-A2'), hasB2: all.includes('SIMDEVICE-B2'), historyHasB2: hist.some((h) => h.includes('SIMDEVICE-B2')), historyHasA1: hist.some((h) => h.includes('SIMDEVICE-A1')) }; }, shelfId);
    // where B's own words went: B's History in the page, and the History saved with the shelf copy
    const histB2 = await pb.evaluate(() => (state.history || []).slice(0, 5).map((h) => ({ name: h.name, auto: h.auto, words: h.words, hasB2: JSON.stringify(h).includes('SIMDEVICE-B2') })));
    const shelfHist = await pa.evaluate(async (id) => { const r = await apiFetch('/api/manuscripts/' + id, {}); return (r.manuscript.doc.history || []).slice(0, 5).map((h) => ({ name: h.name, auto: h.auto, hasB2: JSON.stringify(h).includes('SIMDEVICE-B2') })); }, shelfId);
    shelf2.historyHasB2 = shelf2.historyHasB2 || shelfHist.some((h) => h.hasB2);
    step('after-use-shelf', { choice: conflict2.open ? 'Use the shelf copy' : 'none (no conflict shown)', shelf: shelf2, historyOnB: histB2, historyOnShelf: shelfHist, deviceBStatus: await pb.evaluate(() => ({ syncStatus: cloud.syncStatus, dirty: cloudDirty, revision: cloud.baseRevision })) });
  } catch (e) {
    R.error = String(e && e.stack || e).slice(0, 1200);
    results.errors.push({ twoDevices: true, error: R.error });
    log('ERROR two devices', R.error.split('\n')[0]);
  }
  save();
  await A.close(); await B.close();
}

/* Does a book's metadata stay its own when another book is opened? The
 * writer opens a series book, then a standalone book from the shelf. */
async function metaCarryOver(browser) {
  const S = world.series.find((s) => s.kind === 'recut' && s.persona === world.sessions[1].persona);
  const p = persona(S.persona);
  const seriesBook = seed.books[S.books[0]];
  const standalone = world.books.find((b) => b.persona === p.key && b.role === 'other-genre');
  const R = { persona: p.key, seriesBook: S.books[0], standalone: standalone.id, steps: [] };
  results.metaCarryOver = R;
  const ctx = await device(browser, p.key + '-meta');
  const page = await studio(ctx, []);
  try {
    await uiSignIn(page, p);
    const shelfDoc = async (id) => page.evaluate(async (x) => { const r = await apiFetch('/api/manuscripts/' + x, {}); return { series: r.manuscript.doc.meta.series === undefined ? null : r.manuscript.doc.meta.series, revision: r.manuscript.revision }; }, id);
    R.standaloneOnShelfBefore = await shelfDoc(seed.books[standalone.id].shelfId);
    await uiOpenBook(page, seriesBook.shelfId);
    R.steps.push({ opened: 'series book', series: await page.evaluate(() => state.meta.series || null) });
    await uiOpenBook(page, seed.books[standalone.id].shelfId);
    R.steps.push({ opened: 'standalone', seriesOnDesk: await page.evaluate(() => state.meta.series || null), shot: await shot(page, `${p.key}-meta-01`) });
    const firstCh = (await bodyChapters(page))[0];
    await page.click(`.sec-item[data-sec="${firstCh.id}"]`);
    await page.click('#editorArea');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' SIMMETA', { delay: 2 });
    await saved(page);
    R.standaloneOnShelfAfterEdit = await shelfDoc(seed.books[standalone.id].shelfId);
  } catch (e) {
    R.error = String(e && e.stack || e).slice(0, 800);
    results.errors.push({ metaCarryOver: true, error: R.error });
  }
  save();
  await ctx.close();
}

const browser = await launch();
try {
  if (process.env.SIM_ONLY !== 'twodev') await Promise.all(world.sessions.map((S) => session(browser, S)));
  else Object.assign(results, JSON.parse(readFileSync('/sim/out/personas.json', 'utf8')), { twoDevices: null, metaCarryOver: null, errors: [] });
  await twoDevices(browser);
  await metaCarryOver(browser);
} finally {
  results.finishedAt = new Date().toISOString();
  save();
  await browser.close();
}
