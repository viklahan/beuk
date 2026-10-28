// Invariant checks over the seeded world and the persona runs, against the
// live sim stack (host side: node tools/sim/checks.mjs). Every check is an
// assertion with the observation that decides it; "gap" records are things
// a writer of an interconnected series cannot do today, each with the
// observation that shows it. Output: out/checks.json.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const BASE = 'http://localhost:8190';
const rj = (f) => JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
const world = rj('world.json');
const seed = rj('seed.json');
const pers = existsSync(path.join(OUT, 'personas.json')) ? rj('personas.json') : null;
const monster = existsSync(path.join(OUT, 'monster.json')) ? rj('monster.json') : null;
const checks = [];
const gaps = [];
const bugs = [];
const add = (id, title, pass, evidence) => { checks.push({ id, title, pass: pass === null ? null : !!pass, evidence }); };
const gap = (id, title, evidence) => gaps.push({ id, title, evidence });
const bug = (id, title, evidence) => bugs.push({ id, title, evidence });
const fnv = (s) => { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const persona = (k) => world.personas.find((p) => p.key === k);
const bookById = (id) => world.books.find((b) => b.id === id);

/* ---- a tiny API client: one cookie jar per persona ---- */
const jars = {};
async function login(key) {
  if (jars[key]) return jars[key];
  const p = persona(key);
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: p.email, password: p.password }) });
  const c = (r.headers.get('set-cookie') || '').match(/beuk_session=[^;]+/);
  if (!r.ok || !c) throw new Error(`login ${key}: ${r.status}`);
  jars[key] = c[0];
  return c[0];
}
async function api(key, method, p, body, raw) {
  const headers = {};
  if (key) headers.Cookie = await login(key);
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text, headers: Object.fromEntries(r.headers) };
}

/* ---- network logs: every /api request the browsers made ---- */
const net = [];
const evid = path.join(OUT, 'evidence');
for (const f of readdirSync(evid).filter((x) => x.startsWith('net-'))) for (const line of readFileSync(path.join(evid, f), 'utf8').split('\n')) if (line) net.push({ ...JSON.parse(line), log: f });

async function main() {
  /* 1. the world is the seed's world */
  const worldBytes = readFileSync(path.join(OUT, 'world.json'));
  add('world.deterministic-spec', 'world.json is generated from the seed alone (its sha256 is recorded per run and compared across runs)', true, { seed: world.seed, sha256: sha256(worldBytes) });

  /* 2. seeding finished for every book */
  const missing = world.books.filter((b) => !seed.books[b.id] || seed.books[b.id].error || !seed.books[b.id].shelfId);
  add('seed.all-books-on-shelf', `every world book is on its writer's shelf (${world.books.length})`, missing.length === 0, { missing: missing.map((b) => ({ id: b.id, title: b.title, error: seed.books[b.id] && seed.books[b.id].error && seed.books[b.id].error.split('\n')[0] })) });

  /* 3. no lost words: the shelf copy holds exactly the text the studio had */
  const touched = new Set();
  if (pers) { for (const s of Object.values(pers.sessions || {})) touched.add(s.book); if (pers.twoDevices) touched.add(pers.twoDevices.book); if (pers.metaCarryOver) touched.add(pers.metaCarryOver.standalone); }
  const lost = []; const contentDigest = [];
  for (const b of world.books) {
    const r = seed.books[b.id]; if (!r || !r.shelfId) continue;
    const g = await api(b.persona, 'GET', '/api/manuscripts/' + r.shelfId);
    if (g.status !== 200) { lost.push({ id: b.id, status: g.status }); continue; }
    const secs = g.json.manuscript.doc.sections;
    const shelfHashes = secs.map((s) => fnv(s.content || ''));
    if (touched.has(b.id)) continue;
    // the content digest: every untouched book's sections (kind, type, title, text hash) and its Bible names, in world order
    contentDigest.push({ id: b.id, sections: secs.map((s) => [s.kind, s.type, s.title || '', fnv(s.content || '')].join('|')), bible: ((g.json.manuscript.doc.bible || {}).entries || []).map((e) => e.name + '|' + e.type), images: (g.json.manuscript.doc.images || []).length });
    const want = (r.sectionHashes || []).map((s) => s.hash);
    const diff = want.map((h, i) => (h === shelfHashes[i] ? null : { i, title: r.sectionHashes[i].title, studio: h, shelf: shelfHashes[i] })).filter(Boolean);
    if (want.length !== shelfHashes.length || diff.length) lost.push({ id: b.id, title: b.title, sectionsStudio: want.length, sectionsShelf: shelfHashes.length, diff: diff.slice(0, 5) });
  }
  add('words.no-loss-seeded', 'for every untouched book, each section on the shelf hashes the same as in the studio when it was saved', lost.length === 0, { compared: world.books.length - touched.size, mismatches: lost });
  const digest = sha256(JSON.stringify(contentDigest));

  /* 4. persona sessions: typed words landed, deleted words gone, nothing else moved */
  const emptiedTitle = [];
  if (pers) {
    for (const [k, s] of Object.entries(pers.sessions)) {
      if (s.error || !s.expected) { add(`session.${k}`, `${k}: the UI session completed`, false, { error: s.error && s.error.split('\n')[0], shots: s.shots }); continue; }
      const g = await api(k, 'GET', '/api/manuscripts/' + s.expected.shelfId);
      const all = g.json.manuscript.doc.sections.map((x) => x.content || '').join('\n\n');
      const endStep = s.steps.find((x) => x.name === 'end');
      add(`session.${k}.typed-landed`, `${k}: the typed sentence is on the shelf`, all.includes(s.expected.typedMarker), { marker: s.expected.typedMarker.slice(0, 60), revision: g.json.manuscript.revision });
      add(`session.${k}.deleted-gone`, `${k}: the deleted paragraph is no longer on the shelf`, !s.expected.deletedText || !all.includes(s.expected.deletedText), { deleted: (s.expected.deletedText || '').slice(0, 80) });
      const ty = s.steps.find((x) => x.name === 'type'), de = s.steps.find((x) => x.name === 'delete');
      add(`session.${k}.typed-counted`, `${k}: typing N words raises the book's word total by N (studio count)`, ty && ty.totalDelta === ty.typedWords, { typed: ty && ty.typed, typedWords: ty && ty.typedWords, totalBefore: s.expected.wordsBefore, totalAfter: ty && ty.totalAfterType, sectionAfter: ty && ty.sectionAfter });
      // the studio counts a chapter's title only while the chapter has text (sectionWords), so emptying a chapter also drops its title words
      const emptied = de && de.sectionAfter && de.sectionAfter.textWords === 0;
      const wantDelta = de ? -(de.deletedWords + (emptied ? de.sectionBefore.titleWords : 0)) : null;
      add(`session.${k}.deleted-counted`, `${k}: deleting a paragraph of N words lowers the total by N (plus the chapter title's words when the chapter is left empty)`, de && de.totalDelta === wantDelta, { deleted: de && de.deletedText, deletedWords: de && de.deletedWords, chapterLeftEmpty: emptied, expectedDelta: wantDelta, totalDelta: de && de.totalDelta, section: de && { before: de.sectionBefore, after: de.sectionAfter } });
      if (emptied && de.sectionBefore.titleWords > 0 && de.totalDelta === wantDelta) emptiedTitle.push({ persona: k, chapter: de.chapter, deletedWords: de.deletedWords, titleWords: de.sectionBefore.titleWords, totalDelta: de.totalDelta });
      add(`session.${k}.word-total`, `${k}: reordering, the Bible, goals, exports and sharing leave the word total alone`, endStep && de && endStep.words === de.totalAfterDelete, { afterEdits: de && de.totalAfterDelete, atEnd: endStep && endStep.words });
      const shelfOrder = g.json.manuscript.doc.sections.map((x) => x.id);
      add(`session.${k}.order-saved`, `${k}: the Outline move is in the shelf copy's section order`, JSON.stringify(shelfOrder) === JSON.stringify(s.expected.orderAfter), { move: s.steps.find((x) => x.name === 'outline-move') });
      const goals = s.steps.find((x) => x.name === 'goals');
      add(`session.${k}.goals`, `${k}: goals typed in the Goals panel are the book's goals`, goals && goals.state.daily === goals.asked.daily && goals.state.project === goals.asked.project, goals);
      const ep = s.steps.find((x) => x.name === 'export-epub');
      add(`session.${k}.epub-valid`, `${k}: the EPUB downloaded from Export passes EPUBCheck (0 fatal, 0 errors)`, ep && ep.epubcheck && ep.epubcheck.fatal === 0 && ep.epubcheck.errors === 0, ep);
      const ms = s.steps.find((x) => x.name === 'export-submission');
      add(`session.${k}.submission-docx`, `${k}: the submission manuscript downloads as a Word file`, ms && ms.zip && ms.hasDocumentXml, ms);
      const cm = s.steps.find((x) => x.name === 'comments');
      const ssh = seed.shares.find((x) => x.owner === k);
      const onDeleted = (j) => { const c0 = ssh && ssh.comments.find((x) => x.comment && x.comment.id === j.id); return !!(c0 && s.expected.deletedText && c0.comment.quote && s.expected.deletedText.replace(/\s+/g, ' ').includes(c0.comment.quote.slice(0, 40))); };
      const jumpsLive = cm ? cm.jumps.filter((j) => !onDeleted(j)) : [];
      add(`session.${k}.comments-jump`, `${k}: "jump to passage" finds every reader comment's passage exactly (comments on a paragraph the writer has since deleted are expected not to be found)`, cm && jumpsLive.every((j) => j.found && j.exact), { jumps: cm && cm.jumps, onDeletedParagraph: cm ? cm.jumps.filter(onDeleted).map((j) => j.id) : [] });
      add(`session.${k}.comments-resolved`, `${k}: comments resolved in the comments panel are resolved on the server`, cm && cm.resolved.every((r) => r.status === 200), cm && cm.resolved);
    }
  }

  if (emptiedTitle.length) gap('count.empty-chapter-title', "When a chapter is left with no text, its title stops counting toward the book's word total, so deleting its last paragraph lowers the total by more than the words deleted.", emptiedTitle);

  /* 5. revisions: every accepted PUT moved the revision by exactly one */
  const putsBy = {};
  for (const n of net) { const m = /^\/api\/manuscripts\/([0-9a-f-]{36})$/.exec(n.p); if (m && n.m === 'PUT') { (putsBy[m[1]] = putsBy[m[1]] || { ok: 0, conflict: 0, other: 0 }); if (n.s === 200) putsBy[m[1]].ok++; else if (n.s === 409 || n.s === 428) putsBy[m[1]].conflict++; else putsBy[m[1]].other++; } }
  const revBad = [];
  for (const b of world.books) {
    const r = seed.books[b.id]; if (!r || !r.shelfId) continue;
    const g = await api(b.persona, 'GET', '/api/manuscripts/' + r.shelfId);
    const puts = putsBy[r.shelfId] || { ok: 0, conflict: 0, other: 0 };
    if (g.json.manuscript.revision !== 1 + puts.ok) revBad.push({ id: b.id, revision: g.json.manuscript.revision, acceptedPuts: puts.ok, refused: puts.conflict });
  }
  add('revisions.one-per-save', 'each book\'s revision = 1 (create) + the number of accepted saves the browsers made', revBad.length === 0, { mismatches: revBad, booksChecked: world.books.length });

  /* 6. two devices, one writer */
  if (pers && pers.twoDevices) {
    const T = pers.twoDevices; const st = (n) => T.steps.find((x) => x.name === n) || {};
    const b1 = st('B-saves-different-chapter'), k1 = st('after-keep-both'), b2 = st('B-saves-same-chapter'), k2 = st('after-use-shelf');
    add('sync.conflict-surfaced', 'a save from a device holding an older revision is refused (409) and the conflict notice is shown — never a silent overwrite', b1.putStatus === 409 && b1.open === true, { round1: b1, round2: b2, error: T.error });
    add('sync.no-silent-loss-keep-both', '"Keep both": this device\'s writing is on the shelf and the other device\'s is kept in History', k1.shelf && k1.shelf.hasB1 && (k1.historyOnB || []).some((h) => h.hasA1), k1);
    add('sync.no-silent-loss-use-shelf', '"Use the shelf copy": the shelf keeps the other device\'s writing and this device\'s is kept in History', k2.shelf && k2.shelf.hasA2 && k2.shelf.historyHasB2, k2);
    if (k1.shelf && k1.shelf.hasB1 && !k1.shelf.hasA1) gap('series.sync-no-merge', 'Edits to DIFFERENT chapters on two devices are not merged: the writer must pick one copy; the other copy\'s chapter survives only inside a History snapshot.', { afterKeepBoth: k1.shelf, round1PutStatus: b1.putStatus, shot: b1.shot });
  }

  /* 7. a writer can never read another writer's book */
  const [x, y] = ['sim03', 'sim04'];
  const yBook = seed.books[world.books.find((b) => b.persona === y).id];
  const yShare = seed.shares.find((s) => s.owner === y);
  const yExport = yBook.epub && yBook.epub.archive && yBook.epub.archive.id;
  const iso = [];
  iso.push(['GET manuscript', await api(x, 'GET', '/api/manuscripts/' + yBook.shelfId)]);
  iso.push(['PUT manuscript', await api(x, 'PUT', '/api/manuscripts/' + yBook.shelfId, { doc: { meta: { title: 'x' } }, revision: 1 })]);
  iso.push(['DELETE manuscript', await api(x, 'DELETE', '/api/manuscripts/' + yBook.shelfId)]);
  iso.push(['POST share of it', await api(x, 'POST', '/api/shares', { manuscriptId: yBook.shelfId })]);
  if (yShare && yShare.create.shareId) iso.push(['GET its share comments', await api(x, 'GET', `/api/shares/${yShare.create.shareId}/comments`)]);
  if (yExport) iso.push(['GET its export', await api(x, 'GET', `/api/exports/${yExport}/download`)]);
  iso.push(['GET shelf list (no session)', await api(null, 'GET', '/api/manuscripts')]);
  iso.push(['GET manuscript (no session)', await api(null, 'GET', '/api/manuscripts/' + yBook.shelfId)]);
  const isoRows = iso.map(([what, r]) => ({ what, status: r.status, leaked: /"doc"|"title"/.test(r.text) && r.status < 400 }));
  const stillThere = await api(y, 'GET', '/api/manuscripts/' + yBook.shelfId);
  add('isolation.cross-user', `${x} cannot read, change, delete, share or download ${y}'s book (404/401, nothing leaked) and the book is untouched`, isoRows.every((r) => [401, 403, 404].includes(r.status) && !r.leaked) && stillThere.status === 200 && stillThere.json.manuscript.revision === (1 + ((putsBy[yBook.shelfId] || {}).ok || 0)), { requests: isoRows, ownerStillReads: stillThere.status });

  /* 8. shares: frozen, comments anchored */
  const shareRows = [];
  for (const sh of seed.shares) {
    if (!sh.token) { shareRows.push({ owner: sh.owner, error: 'no share', create: sh.create }); continue; }
    const sess = pers && pers.sessions[sh.owner];
    if (sess && sess.expected) {
      // the session typed into this very book after the share was made: the frozen copy must not show it
      let found = false;
      for (let c = 0; c < (sh.create.sectionCount || 0) && !found; c++) { const r = await api(null, 'GET', `/read/${sh.token}?c=${c}`); if (r.text.includes('SIMTYPED-')) found = true; }
      add(`share.${sh.owner}.frozen`, `${sh.owner}: the reading copy made before the session's edits does not show them`, !found, { token: 'from seed share', typedMarker: sess.expected.typedMarker.slice(0, 40) });
      if (sess.uiShareToken) {
        let inNew = false;
        const cnt = (await api(sess.persona || sh.owner, 'GET', '/api/shares?manuscriptId=' + sess.expected.shelfId)).json.shares.find((s) => s.status === 'active' && s.id !== sh.create.shareId);
        for (let c = 0; c < ((cnt && cnt.sectionCount) || 0) && !inNew; c++) { const r = await api(null, 'GET', `/read/${sess.uiShareToken}?c=${c}`); if (r.text.includes(sess.expected.typedMarker.slice(0, 30).replace(/&/g, '&amp;'))) inNew = true; }
        add(`share.${sh.owner}.ui-share-current`, `${sh.owner}: a link made in the UI after the edits shows them`, inNew, { sections: cnt && cnt.sectionCount });
      }
    }
    for (const c of sh.comments) {
      if (!c.comment) { shareRows.push({ owner: sh.owner, reader: c.reader, status: c.status, error: c.error || c.skipped }); continue; }
      const page = await api(null, 'GET', `/read/${sh.token}?c=${c.chapterIndex}`);
      const m = new RegExp(`data-p="${c.comment.paragraph}"[^>]*>([\\s\\S]*?)</(p|h[1-6]|blockquote|li|div|figure)>`).exec(page.text);
      const blockText = m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim() : null;
      const q = (c.comment.quote || '').replace(/\s+/g, ' ').trim();
      shareRows.push({ owner: sh.owner, reader: c.reader, paragraph: c.comment.paragraph, sectionId: c.comment.sectionId, quote: q.slice(0, 60), anchored: !!blockText && blockText.startsWith(q), blockStart: blockText && blockText.slice(0, 60) });
    }
  }
  const posted = shareRows.filter((r) => r.paragraph !== undefined);
  add('share.comments-posted', 'every reader comment the world plans was accepted by the reader page (201)', shareRows.every((r) => r.paragraph !== undefined), { failed: shareRows.filter((r) => r.paragraph === undefined) });
  add('share.comments-anchored', 'each comment\'s paragraph index points at the block its quote came from, in the frozen copy', posted.every((r) => r.anchored), { comments: posted.length, notAnchored: posted.filter((r) => !r.anchored) });
  const resolvedApi = seed.shares.flatMap((s) => s.resolved || []);
  add('share.resolve-api', 'resolving a comment (the request the comments panel sends) marks it resolved', resolvedApi.every((r) => !!r.resolvedAt), { resolved: resolvedApi.length });

  /* 9. EPUBs validate */
  const epubRows = [];
  for (const b of world.books) { const r = seed.books[b.id]; if (r && r.epubcheck) epubRows.push({ id: b.id, title: b.title, ...r.epubcheck }); }
  for (const [k, s] of Object.entries(seed.series)) if (s && s.boxSet && s.boxSet.epubcheck) epubRows.push({ id: 'box-set:' + k, title: k + ' box set', ...s.boxSet.epubcheck });
  add('epub.validate', 'every EPUB the studio built (each book and each box set) passes EPUBCheck with 0 fatal and 0 errors', epubRows.length > 0 && epubRows.every((r) => r.fatal === 0 && r.errors === 0), { checked: epubRows.length, failing: epubRows.filter((r) => !(r.fatal === 0 && r.errors === 0)) });

  /* 10. box sets */
  const boxRenamed = [];
  for (const S of world.series) {
    const bs = seed.series[S.key] && seed.series[S.key].boxSet;
    if (!bs) { add(`boxset.${S.key}`, `${S.name}: box set built`, false, { error: (seed.errors.find((e) => e.series === S.key) || {}).error }); continue; }
    const want = S.books.map((id) => bookById(id).title);
    const loose = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');
    add(`boxset.${S.key}.order`, `${S.name}: the box set holds every volume, in reading order`, bs.vols.length === want.length && bs.spineLabels.every((l, i) => loose(l) === loose(want[i])), { want, spine: bs.spineLabels, bytes: bs.bytes });
    const renamed = bs.spineLabels.map((l, i) => (l !== want[i] ? { title: want[i], inBoxSet: l } : null)).filter(Boolean);
    if (renamed.length) boxRenamed.push({ series: S.key, renamed });
  }
  if (boxRenamed.length) bug('bug.boxset-title-from-filename', 'A volume added to a box set takes its title from the file name with hyphens and underscores turned into spaces, so "Tik-Tok of Oz" becomes "Tik Tok of Oz" in the box set (manuscriptFileToVolume); the title is not editable there.', boxRenamed);
  // series gaps observed in the box sets
  const bsAll = Object.entries(seed.series).filter(([, s]) => s && s.boxSet);
  const lostImg = bsAll.filter(([, s]) => s.boxSet.sourceImages.some((n, i) => n > 0 && s.boxSet.vols[i + 1] && s.boxSet.vols[i + 1].images === 0));
  if (lostImg.length) gap('series.boxset-drops-pictures', 'A box set can only add later volumes as Word/Markdown/text files ("Add a Book…"), so every volume after the first arrives without its pictures, cover or front/back matter.', lostImg.map(([k, s]) => ({ series: k, picturesInEachVolume: s.boxSet.sourceImages, picturesInBoxSetVolumes: s.boxSet.vols.slice(1).map((v) => v.images), coversInBoxSet: s.boxSet.vols.map((v) => v.cover) })));
  const noSeriesOpf = bsAll.filter(([, s]) => !s.boxSet.opfHasSeries);
  if (noSeriesOpf.length) gap('series.boxset-no-series-metadata', 'The box set EPUB carries no series metadata (no belongs-to-collection) and is titled "<book one> — The Complete Box Set".', noSeriesOpf.slice(0, 3).map(([k, s]) => ({ series: k, opfTitle: s.boxSet.opfTitle })));
  gap('series.boxset-not-saved', 'A box set is not part of any book: the volume list lives only in the open page (state.boxSetVolumes is not in the saved book), so it must be rebuilt by hand each time.', { savedBookKeys: Object.keys((await api('sim01-dumas', 'GET', '/api/manuscripts/' + seed.books[world.series[0].books[0]].shelfId)).json.manuscript.doc).sort() });

  /* 11. Story Bible across volumes */
  for (const S of world.series) {
    const imp = S.books.slice(1).map((id) => seed.books[id] && seed.books[id].bibleImport).filter(Boolean);
    add(`bible.${S.key}.carried`, `${S.name}: the Bible authored in book 1 imports into every later volume (export -> import)`, imp.length === S.books.length - 1 && imp.every((r) => r.ok), { imports: imp.map((r) => ({ added: r.added.length, skipped: r.skipped.length })) });
    const ed = seed.books[S.bible.editIn], un = seed.books[S.bible.untouched];
    if (ed && un && ed.shelfId && un.shelfId) {
      const ge = (await api(S.persona, 'GET', '/api/manuscripts/' + ed.shelfId)).json.manuscript.doc.bible;
      const gu = (await api(S.persona, 'GET', '/api/manuscripts/' + un.shelfId)).json.manuscript.doc.bible;
      const name = ed.bibleEdit && ed.bibleEdit.name;
      const eE = ge && ge.entries.find((e) => e.name === name), eU = gu && gu.entries.find((e) => e.name === name);
      if (eE && eU && JSON.stringify([eE.aliases, eE.description]) !== JSON.stringify([eU.aliases, eU.description])) {
        gap(`series.bible-diverges.${S.key}`, `${S.name}: a Story Bible edit in one volume never reaches its siblings — each volume holds its own copy.`, { entry: name, editedIn: bookById(S.bible.editIn).title, editedEntry: { aliases: eE.aliases, description: eE.description }, sibling: bookById(S.bible.untouched).title, siblingEntry: { aliases: eU.aliases, description: eU.description } });
      }
    }
  }

  /* 12. series as the shelf and the files see it */
  const dumasList = await api('sim01-dumas', 'GET', '/api/manuscripts');
  const keys = Object.keys(dumasList.json.manuscripts[0] || {}).sort();
  const order = dumasList.json.manuscripts.map((m) => m.title);
  gap('series.no-series-on-shelf', 'The shelf has no series: each list entry is only {' + keys.join(', ') + '}, ordered by last edit, so a series\' volumes are not grouped or in reading order.', { shelfOrderAsListed: order, readingOrder: world.series.filter((s) => s.persona === 'sim01-dumas').map((s) => s.books.map((id) => bookById(id).title)) });
  if (seed.lab) {
    const v = seed.lab.volumes.find((r) => r.ebook === 1257);
    if (v && v.paths.single && v.paths.single.metaAfterImport && !v.paths.single.metaAfterImport.series && v.paths.bulk && v.paths.bulk.series) gap('series.single-import-ignores-series', 'Single-file Import reads title and author from Markdown frontmatter but not "series:"; only Bulk import keeps it.', { frontmatter: 'series: The d\'Artagnan Romances', singleImportMeta: v.paths.single.metaAfterImport, bulkImportSeries: v.paths.bulk.series });
    if (seed.lab.seriesFields) gap('series.no-series-field', 'No book-details field holds the series: the only inputs named for a series are the cover maker\'s "Series Line".', { inputsWithSeriesInId: seed.lab.seriesFields });
    for (const r of seed.lab.volumes) if (r.paths.bulk && r.paths.bulk.score && r.paths.single && r.paths.single.score && r.paths.bulk.score.captionsKept < r.paths.single.score.captionsKept) gap('import.bulk-drops-captions', 'Bulk import places Markdown pictures but drops their captions ("![alt](file \\"caption\\")").', { ebook: r.ebook, captionsSingle: r.paths.single.score.captionsKept, captionsBulk: r.paths.bulk.score.captionsKept });
  }
  // EPUB metadata: does a series volume's EPUB name its series?
  const ep = path.join(OUT, 'epub');
  if (existsSync(ep)) {
    const f = readdirSync(ep).find((x) => /^dartagnan-01/.test(x));
    if (f) {
      let opf = '';
      try { opf = execFileSync('unzip', ['-p', path.join(ep, f), 'OEBPS/package.opf']).toString(); } catch (e) { opf = 'unzip failed: ' + e.message; }
      if (!/belongs-to-collection|calibre:series/.test(opf)) gap('series.epub-no-series-metadata', 'A series volume\'s EPUB does not name its series or its place in it (no belongs-to-collection / group-position), although the book carries meta.series.', { file: f, opfMetadata: (opf.match(/<metadata[\s\S]*?<\/metadata>/) || [''])[0].replace(/\s+/g, ' ').slice(0, 900) });
    }
  }
  // rights: a public-domain saga volume's EPUB must not claim all rights reserved
  if (existsSync(ep)) {
    const rows = readdirSync(ep).filter((x) => /^(dartagnan|valois|oz)-/.test(x)).map((f) => {
      let opf = '';
      try { opf = execFileSync('unzip', ['-p', path.join(ep, f), 'OEBPS/package.opf']).toString(); } catch (e) { opf = 'unzip failed: ' + e.message; }
      return { file: f, dcRights: (opf.match(/<dc:rights>([^<]*)<\/dc:rights>/) || [])[1] || null };
    });
    if (rows.length) add('rights.saga-public-domain', 'Every public-domain saga volume’s EPUB says it is in the public domain (dc:rights), never "All rights reserved"', rows.every((r) => r.dcRights && /public domain/i.test(r.dcRights) && !/all rights reserved/i.test(r.dcRights)), rows.slice(0, 6).concat(rows.length > 6 ? [{ more: rows.length - 6 }] : []));
  }
  // also-by pages are plain text typed into every volume
  const sagaAlso = world.series.filter((s) => s.kind === 'saga').map((s) => ({ series: s.key, volumes: s.books.length, linesTypedAcrossVolumes: s.books.length * (s.books.length - 1) }));
  gap('series.alsoby-by-hand', 'Also-by pages are plain text in each volume: a series of N books needs N×(N−1) links typed and kept up to date by hand; nothing links one shelf book to another.', sagaAlso);
  // presence across volumes is computed outside the studio
  gap('series.no-cross-volume-view', 'Story Insights and the Bible\'s mentions work on the open book only; who appears in which volume of a series could only be computed by opening each volume (the simulation did this to build the presence table).', { presenceComputedFor: Object.keys(seed.series).filter((k) => !k.startsWith('__')) });

  /* 13. meta carry-over between books (a bug if it happens) */
  if (pers && pers.metaCarryOver) {
    const mc = pers.metaCarryOver;
    const leaked = mc.steps[1] && mc.steps[1].seriesOnDesk;
    add('meta.own-book', 'opening another shelf book never carries the previous book\'s metadata onto it', !leaked && !(mc.standaloneOnShelfAfterEdit && mc.standaloneOnShelfAfterEdit.series), mc);
    if (leaked) bug('bug.meta-series-carries-over', 'Opening a book carries the PREVIOUS book\'s series onto it (applyBookDoc merges meta onto the old meta; the arriving book has no "series" key), and the next autosave writes it to the shelf.', mc);
  }
  const leakSeed = world.books.filter((b) => !b.series && seed.books[b.id] && seed.books[b.id].metaBeforeSet && seed.books[b.id].metaBeforeSet.series).map((b) => ({ id: b.id, title: b.title, seriesOnDeskBeforeSet: seed.books[b.id].metaBeforeSet.series }));
  if (leakSeed.length) bug('bug.meta-series-carries-over-seed', 'Seen while seeding too: a standalone book opened after a series book arrived carrying that series.', leakSeed);

  /* 14. comment limits for readers behind one address */
  const cap = pers && Object.values(pers.sessions).find((s) => s.uiShareToken);
  if (cap) {
    const g = await api(cap.persona, 'GET', '/api/shares?manuscriptId=' + cap.expected.shelfId);
    const rp = await api(null, 'GET', `/read/${cap.uiShareToken}`);
    const sec = (rp.text.match(/data-section="([^"]+)"/) || [])[1];
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await api(null, 'POST', `/read/${cap.uiShareToken}/comments`, { sectionId: sec, paragraph: 0, quote: '', body: `[sim] limit probe ${i + 1}`, readerName: 'Sim limit probe' })).status);
    gap('readers.one-address-cap', 'Beta readers who share one internet address (a writing group, a library, a household) can leave only 10 comments per link per 10 minutes between them; the 11th gets 429.', { statusesOf11: codes, shares: (g.json.shares || []).length });
  }
  gap('readers.no-reply', 'The writer cannot answer a reader comment: the owner API offers resolve, unresolve and delete only (src/routes/shares.ts), and the comments panel has no reply control.', { ownerCommentRoutes: ['POST /api/shares/:id/comments/:cid/resolve', 'POST /api/shares/:id/comments/:cid/unresolve', 'DELETE /api/shares/:id/comments/:cid'] });

  /* 15. import lab decision */
  if (seed.lab) add('import.lab', `import path chosen by measurement: ${seed.lab.chosen} (titles, pictures placed, captions, italics)`, true, { totals: seed.lab.totals, volumes: seed.lab.volumes.map((v) => ({ ebook: v.ebook, title: v.title, single: v.paths.single && v.paths.single.score, bulk: v.paths.bulk && (v.paths.bulk.score || v.paths.bulk.error) })) });

  /* load and size: what the saga volumes and the load-test book showed */
  const bigBook = Object.values(seed.books).filter((r) => r.stats && r.put).sort((a, b) => b.stats.docBytes - a.stats.docBytes)[0];
  // The bytes an autosave really sent (the studio's own shelfPics.stats; absent from a studio that predates stored pictures).
  const putWire = bigBook && bigBook.put.wire;
  if (bigBook && !(putWire && putWire.named > 0 && putWire.uploaded === 0)) gap('perf.autosave-sends-whole-book', 'Every autosave sends the whole book, pictures included: the largest illustrated volume re-uploads its full JSON on each save.', { book: bigBook.title, pictures: bigBook.stats.images, words: bigBook.stats.words, bytesPerSave: putWire ? putWire.bytes + putWire.uploadBytes : bigBook.put.bytes, putMs: Math.round(bigBook.put.ms), postMs: Math.round(bigBook.post.ms) });
  else if (bigBook) add('perf.autosave-sends-book-only', 'An autosave of the largest illustrated volume sends the book with its pictures named, uploading none', true, { book: bigBook.title, pictures: bigBook.stats.images, docBytes: bigBook.stats.docBytes, bytesPerSave: putWire.bytes, picturesNamed: putWire.named, putMs: Math.round(bigBook.put.ms), postMs: Math.round(bigBook.post.ms), postUploadedPictures: bigBook.post.wire ? bigBook.post.wire.uploaded : null });
  if (monster) {
    const typing = monster.steps.filter((s) => s.ops.typing && s.ops.typing.ok).map((s) => ({ words: s.targetWords, msPerInput: Math.round(s.ops.typing.value.ms10 / 10) }));
    if (typing.length && typing[0].msPerInput > 50) gap('perf.typing-latency', 'Typing slows with the size of the whole book, not the chapter: each input event in the last chapter takes this long (the studio\'s own input handling, 10 events per step).', typing);
    const tooBig = monster.steps.find((s) => s.ops.post && s.ops.post.value && s.ops.post.value.status !== 'saved');
    if (tooBig) gap('limit.shelf-book-size', 'A book over the shelf\'s size limit (MANUSCRIPT_MAX_BYTES, 64 MiB of JSON) cannot be saved to the shelf; the studio says so and keeps it on the device.', { words: tooBig.targetWords, post: tooBig.ops.post.value });
    const arch = monster.steps.find((s) => s.ops.epub && s.ops.epub.ok && s.ops.epub.value.archive && !s.ops.epub.value.archive.id);
    if (arch) gap('limit.export-archive-size', 'An export over EXPORT_MAX_BYTES (50 MB) is built in the browser but cannot be saved to the export archive or checked by EPUBCheck on the server.', { words: arch.targetWords, epubBytes: arch.ops.epub.value.bytes, archive: arch.ops.epub.value.archive });
    const pdf = monster.steps.find((s) => s.ops.pdfx && s.ops.pdfx.status !== 'done');
    if (pdf) gap('limit.pdfx-long-book', 'The print PDF/X job did not finish for a book of this length (the saga-length volumes of ~40,000 words printed).', { words: pdf.targetWords, job: pdf.ops.pdfx });
    const crashed = monster.steps.filter((s) => (s.pageErrors || []).some((e) => /CRASH/.test(e))).map((s) => s.targetWords);
    if (crashed.length) gap('limit.page-crash', 'The studio page crashed while working on the load-test book.', { atWords: crashed });
  }

  if (pers) add('auth.ui-sign-in-first-time', 'every sign-in through the UI with the right email and password succeeded at the first attempt', !(pers.signInRefused || []).length && !(pers.signInFailures || []).length, { refused: pers.signInRefused || [], failed: pers.signInFailures || [] });

  /* 16. errors anywhere */
  add('run.no-errors', 'no step of the seed or the persona runs errored', !seed.errors.length && !(pers && pers.errors.length), { seed: seed.errors.map((e) => ({ ...e, error: String(e.error || e.fatal || '').split('\n')[0] })), personas: pers ? pers.errors.map((e) => ({ ...e, error: String(e.error).split('\n')[0] })) : 'personas not run' });

  const out = { at: new Date().toISOString(), worldSha256: sha256(worldBytes), contentDigest: digest, checks, gaps, bugs, netRequests: net.length };
  writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(out, null, 1));
  const fails = checks.filter((c) => c.pass === false);
  console.log(`checks: ${checks.length} (${checks.length - fails.length} pass, ${fails.length} fail) gaps: ${gaps.length} bugs: ${bugs.length} world=${out.worldSha256.slice(0, 12)} content=${digest.slice(0, 12)}`);
  for (const f of fails) console.log('FAIL', f.id, '-', f.title);
}
await main();
