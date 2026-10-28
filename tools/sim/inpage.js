/* Beuk simulation — helpers injected into the studio page (tools/sim).
 * Every helper calls the studio's OWN functions (serializeBook,
 * applyBookDoc, handleImportFile, cloudSaveNow, apiFetch, bibleSeedCandidates,
 * bibleExportDoc / bibleImportDoc, buildEpubBlob, boxSetFiles, …) the way the
 * studio's buttons call them, so the requests the server sees are the
 * studio's own requests. Nothing here writes prose: the only text it adds
 * is plainly marked simulation text. Files move in and out through two
 * routed URLs the Playwright side answers (/__sim/file?p=…, /__simsave/…). */
(function () {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const fnv = (s) => { let h = 2166136261; s = String(s || ""); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); };
  async function fileText(p) { const r = await fetch("/__sim/file?p=" + encodeURIComponent(p)); if (!r.ok) throw new Error("sim file " + p + " " + r.status); return r.text(); }
  async function fileB64(p) {
    const r = await fetch("/__sim/file?p=" + encodeURIComponent(p)); if (!r.ok) throw new Error("sim file " + p + " " + r.status);
    const blob = await r.blob();
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const u = String(fr.result); res(u.slice(u.indexOf(",") + 1)); }; fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  async function save(name, body, type) {
    const r = await fetch("/__simsave/" + name, { method: "POST", headers: { "Content-Type": type || "application/octet-stream" }, body });
    if (!r.ok) throw new Error("simsave " + name + " " + r.status);
  }
  /** The studio's book as numbers the report can compare: per-section text hashes and counts. */
  function bookStats() {
    const lang = state.meta.language;
    const secs = state.sections.map((s, i) => ({ i, id: s.id, kind: s.kind, type: s.type, title: s.title || "", included: s.included !== false, words: countWords(s.content || "", lang), hash: fnv(s.content || ""), images: imageTokensIn(s.content || "").length, plate: !!s.plateId, backdrop: !!s.backdropId }));
    const body = secs.filter((s) => s.kind === "body");
    return {
      title: state.meta.title, author: state.meta.author, series: state.meta.series || "", bookId: state.meta.bookId,
      words: bookWordTotal(), bodyWords: body.reduce((a, s) => a + s.words, 0), sections: secs.length, chapters: secs.filter((s) => s.type === "chapter").length,
      images: (state.images || []).length, imageTokens: secs.reduce((a, s) => a + s.images, 0),
      captions: state.sections.reduce((a, s) => a + imageTokensIn(s.content || "").filter((t) => t.caption).length, 0),
      italicSpans: state.sections.reduce((a, s) => a + ((s.content || "").match(/(^|[^*])\*[^*\n]+\*(?!\*)/g) || []).length, 0),
      bible: (state.bible && state.bible.entries || []).map((e) => ({ name: e.name, type: e.type, aliases: e.aliases.slice(), description: e.description, tags: e.tags.slice() })),
      docBytes: JSON.stringify(serializeBook()).length,
      secs,
    };
  }
  function emptyDesk() {
    applyBookDoc(buildEmptyBook());
    state.history = [];
    state.bible = { entries: [] };
    state.boxSetVolumes = [];
    if (typeof sampleState !== "undefined") { sampleState.loaded = false; sampleState.loadedJson = null; }
    // "Not now" to the shelf while the book is being put together (the studio would otherwise
    // autosave a half-built book); saveToShelf then puts it there the way "Bring to my shelf" does.
    cloud.linkedId = null; cloud.linkState = "declined"; cloud.baseRevision = null; cloud.conflict = null;
    cloudDirty = false; clearTimeout(cloudSaveTimer);
  }
  async function importSingle(path, name) {
    const text = await fileText(path);
    emptyDesk();
    const seriesOnEmptyDesk = state.meta.series || null; // the empty desk should carry none (see the meta carry-over check)
    const t0 = now();
    await handleImportFile(new File([text], name, { type: "text/markdown" }));
    const ms = now() - t0;
    return { ms, seriesOnEmptyDesk, found: (typeof lastImportFound !== "undefined" ? lastImportFound.slice() : []), metaAfterImport: { title: state.meta.title, author: state.meta.author, series: state.meta.series || "" } };
  }
  /** The image library's own intake (the Upload button's handler), with
   *  the library id the import's picture markers already name. */
  async function addImages(list) {
    let added = 0, bytes = 0;
    for (const im of list) {
      if (!im.ok) continue;
      const data = await fileB64(im.path);
      const mediaType = /\.png$/i.test(im.src) ? "image/png" : "image/jpeg";
      state.images.push({ id: im.id, name: im.src.split("/").pop(), mediaType, ext: mediaType === "image/png" ? "png" : "jpg", data });
      added++; bytes += data.length;
    }
    return { added, b64Bytes: bytes };
  }
  function recut(spec) {
    // spec: { body: [section index...], backMatterInLast, last }
    const keep = new Set(spec.body);
    state.sections = state.sections.filter((s, i) => s.kind === "front" || keep.has(i) || (s.kind === "back" && spec.last && s.type !== "alsoby"));
    state.activeId = (state.sections.find((s) => s.kind === "body") || state.sections[0]).id;
    pruneImages();
    state.history = [];
    state.meta.bookId = newBookId();
  }
  function pruneImages() {
    const used = new Set();
    state.sections.forEach((s) => { imageTokensIn(s.content || "").forEach((t) => used.add(t.id)); if (s.plateId) used.add(s.plateId); if (s.backdropId) used.add(s.backdropId); (s.scenes || []).forEach((x) => used.add(x.imageId)); });
    if (state.coverRecipe && state.coverRecipe.bgImageId) used.add(state.coverRecipe.bgImageId);
    state.images = (state.images || []).filter((im) => used.has(im.id));
  }
  async function openSource(src) {
    emptyDesk();
    if (src.kind === "sample") applyBookDoc(buildSampleBook());
    else {
      const raw = JSON.parse(await fileText("/ramp/" + src.file));
      if (!raw || raw.format !== "beuk-backup" || !raw.book) throw new Error("not a beuk backup: " + src.file);
      applyBookDoc(raw.book);
    }
    state.history = [];
    if (typeof sampleState !== "undefined") { sampleState.loaded = false; sampleState.loadedJson = null; }
    cloud.linkedId = null; cloud.linkState = "declined"; cloud.baseRevision = null;
  }
  function setMeta(m) { Object.keys(m).forEach((k) => { if (m[k] === null) delete state.meta[k]; else state.meta[k] = m[k]; }); }
  function setAlsoBy(lines) {
    let s = state.sections.find((x) => x.type === "alsoby");
    if (!s) { s = mkSection("back", "alsoby", "Also by the Author"); state.sections.push(s); }
    s.content = lines.join("\n");
    s.included = true;
    return s.id;
  }
  /** Story Bible from Story Insights' found names only (bibleSeedAdd's rule). */
  function bibleSeed(opts) {
    if (!state.bible) state.bible = { entries: [] };
    const t0 = now();
    const c = bibleSeedCandidates();
    const seedMs = now() - t0;
    const list = c.list.filter((x) => !x.taken);
    const picked = [];
    const notFound = [];
    if (opts.accept) {
      opts.accept.forEach(([name, type]) => {
        const hit = list.find((x) => x.name.toLowerCase() === name.toLowerCase()) || list.find((x) => x.name.replace(/[’']/g, "'").toLowerCase() === name.replace(/[’']/g, "'").toLowerCase());
        if (hit) picked.push({ name: hit.name, type, total: hit.total }); else notFound.push(name);
      });
    } else {
      list.slice().sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, opts.top).forEach((x) => picked.push({ name: x.name, type: "character", total: x.total }));
    }
    picked.forEach((p) => { if (bibleEntries().length < BIBLE_MAX) state.bible.entries.push(bibleNormalizeEntry({ name: p.name, type: p.type })); });
    bibleTouched(false);
    return { candidates: c.list.length, caseless: !!c.caseless, seedMs, added: picked, notFound };
  }
  function mentionPass(entries) {
    const es = entries ? bibleNormalize({ entries }).entries : bibleEntries();
    const t0 = now();
    const r = bibleMentionsCompute(state.sections, es, bookLang());
    const ms = now() - t0;
    const per = {};
    es.forEach((e) => { const p = r.per[e.id]; per[e.name] = { total: p ? p.total : 0, sections: p ? p.counts.filter((n) => n > 0).length : 0 }; });
    return { ms, studioMs: r.ms, per, ambiguous: r.ambiguous, sections: r.cols.length };
  }
  function bibleExport() { return bibleExportDoc(); }
  function bibleImport(doc) { const r = bibleImportDoc(doc); bibleTouched(false); return { ok: r.ok, added: r.added.map((e) => e.name), skipped: r.skipped, pics: r.pics }; }
  function bibleEdit(change) {
    const e = bibleEntries().find((x) => x.name === change.name) || bibleEntries()[0];
    if (!e) return null;
    if (change.alias) e.aliases = e.aliases.concat([change.alias]);
    if (change.description) e.description = change.description;
    bibleTouched(true);
    return { name: e.name, aliases: e.aliases.slice(), description: e.description };
  }
  /** The shelf save path the studio runs after every edit: POST when the book is new, PUT with If-Match after. */
  async function saveToShelf(isNew) {
    if (isNew) { cloud.linkedId = null; cloud.linkState = "unlinked"; cloud.baseRevision = null; }
    cloudDirty = true; cloud.lastEditAt = Date.now();
    const bytes = JSON.stringify({ title: state.meta.title, doc: serializeBook() }).length;
    const t0 = now();
    await cloudSaveNow();
    const ms = now() - t0;
    /* what actually went to the shelf: the doc as sent (pictures named) and the pictures uploaded with it */
    const wire = typeof shelfPics === "object" && shelfPics.stats ? Object.assign({}, shelfPics.stats) : null;
    return { ms, bytes, wire, id: cloud.linkedId, revision: cloud.baseRevision, status: cloud.syncStatus, error: cloud.shelfError || null };
  }
  async function openFromShelf(id) {
    const r = await apiFetch("/api/manuscripts/" + encodeURIComponent(id), {});
    if (!r || !r.manuscript) return { ok: false, status: r && r.__status };
    emptyDesk();
    applyBookDoc(r.manuscript.doc);
    cloud.linkedId = id; cloud.linkState = "linked"; cloudDirty = false;
    cloud.baseRevision = r.manuscript.revision; cloud.baseUpdatedAt = r.manuscript.updatedAt;
    return { ok: true, revision: r.manuscript.revision };
  }
  async function blobB64(blob) { return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const u = String(fr.result); res(u.slice(u.indexOf(",") + 1)); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
  /** Export -> archive: the same request cloudArchiveExport sends, keeping the export id. */
  async function archive(format, blob, filename) {
    const q = "?manuscriptId=" + encodeURIComponent(cloud.linkedId) + "&format=" + encodeURIComponent(format) + "&filename=" + encodeURIComponent(filename);
    const t0 = now();
    const r = await apiFetch("/api/exports" + q, { method: "POST", body: blob, headers: { "Content-Type": "application/octet-stream" } });
    return { ms: now() - t0, id: r && r.export ? r.export.id : null, status: r && r.__status, error: r && r.__error, sha256: r && r.export ? r.export.sha256 : null };
  }
  async function buildEpub(saveAs) {
    const t0 = now();
    const blob = await buildEpubBlob();
    const ms = now() - t0;
    if (saveAs) await save(saveAs, blob, "application/epub+zip");
    const a = await archive("epub", blob, slug(state.meta.title || "book") + ".epub");
    return { ms, bytes: blob.size, archive: a };
  }
  async function buildPrint(saveAs) {
    const t0 = now();
    const html = buildPrintHtml();
    const ms = now() - t0;
    const blob = new Blob([html], { type: "text/html" });
    if (saveAs) await save(saveAs, blob, "text/html");
    const a = await archive("print-html", blob, slug(state.meta.title || "book") + ".print.html");
    return { ms, bytes: blob.size, archive: a };
  }
  async function job(kind, exportId) {
    const r = await apiFetch("/api/jobs/" + kind, { method: "POST", body: JSON.stringify({ exportId }) });
    return { id: r && r.job ? r.job.id : null, status: r && r.__status, error: r && r.__error };
  }
  async function jobGet(id) { const r = await apiFetch("/api/jobs/" + encodeURIComponent(id), {}); return r && r.job ? r.job : r; }
  async function backup(saveAs) {
    const payload = { format: "beuk-backup", version: 1, exportedAt: new Date().toISOString(), book: serializeBook() };
    const text = JSON.stringify(payload);
    await save(saveAs, text, "application/json");
    return { bytes: text.length };
  }
  /** Box set through the studio's own path: the open book is Book One;
   *  each sibling is written as the studio's own backup file (the
   *  "Download a backup" payload) and added with "Add a Book…"
   *  (manuscriptFileToVolume), which takes a backup whole — text,
   *  cover and pictures. */
  async function boxSet(siblings, saveAs) {
    const docs = [];
    for (const s of siblings) {
      const r = await apiFetch("/api/manuscripts/" + encodeURIComponent(s.id), {});
      docs.push(r.manuscript.doc);
    }
    const keep = serializeBook(); const keepLink = { id: cloud.linkedId, rev: cloud.baseRevision };
    cloud.linkState = "declined"; clearTimeout(cloudSaveTimer); // reading the siblings is not an edit to book one
    const mds = [];
    for (let i = 0; i < docs.length; i++) {
      applyBookDoc(docs[i]);
      mds.push({ name: siblings[i].fileName, json: JSON.stringify({ format: "beuk-backup", version: 1, exportedAt: new Date().toISOString(), book: serializeBook() }), imagesInBook: (state.images || []).length });
    }
    applyBookDoc(keep); cloud.linkedId = keepLink.id; cloud.baseRevision = keepLink.rev; cloudDirty = false; clearTimeout(cloudSaveTimer);
    state.boxSetVolumes = [];
    for (const m of mds) state.boxSetVolumes.push(await manuscriptFileToVolume(new File([m.json], m.name, { type: "application/json" })));
    const t0 = now();
    const files = boxSetFiles();
    const zip = new JSZip();
    files.forEach((f) => {
      const parts = f.path.split("/"); let folder = zip;
      for (let i = 0; i < parts.length - 1; i++) folder = folder.folder(parts[i]);
      folder.file(parts[parts.length - 1], f.content, f.path === "mimetype" ? { compression: "STORE" } : f.binary ? { base64: true } : {});
    });
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
    const ms = now() - t0;
    if (saveAs) await save(saveAs, blob, "application/epub+zip");
    const plan = boxSetPlan().map((e) => ({ vol: e.volIdx, kind: e.kind, label: e.label, file: e.file }));
    const vols = boxSetVolumesAll().map((v) => ({ title: v.meta.title, author: v.meta.author, chapters: (v.sections || []).filter((s) => s.type === "chapter").length, images: (v.images || []).length, cover: !!v.cover, words: (v.sections || []).reduce((n, s) => n + countWords(s.content, v.meta.language), 0) }));
    const opf = (files.find((f) => f.path === "OEBPS/package.opf") || {}).content || "";
    const imgFiles = files.filter((f) => /^OEBPS\/Images\//.test(f.path)).length;
    const a = await archive("epub", blob, slug(state.meta.title || "book") + "-box-set.epub");
    const sourceImages = mds.map((m) => m.imagesInBook);
    state.boxSetVolumes = []; cloud.linkState = "linked";
    return { ms, bytes: blob.size, vols, planVolumes: [...new Set(plan.map((p) => p.vol))].length, spineLabels: plan.filter((p) => p.kind === "divider").map((p) => p.label), imgFiles, sourceImages, opfTitle: (opf.match(/<dc:title>([^<]*)<\/dc:title>/) || [])[1] || "", opfHasSeries: /belongs-to-collection|calibre:series/.test(opf), archive: a };
  }
  window.__sim = { sleep, fnv, bookStats, emptyDesk, importSingle, addImages, recut, pruneImages, openSource, setMeta, setAlsoBy, bibleSeed, mentionPass, bibleExport, bibleImport, bibleEdit, saveToShelf, openFromShelf, buildEpub, buildPrint, job, jobGet, backup, boxSet, archive, blobB64, fileText, save };
})();
