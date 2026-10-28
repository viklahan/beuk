// World generator: a fixed seed -> the same world, byte for byte.
//
//   node tools/sim/world.mjs [--seed N] [--out tools/sim/out/world.json]
//
// Inputs are only the seed, tools/sim/world.config.json, tools/sim/sagas.json
// and tools/sim/catalog.json (all committed). Nothing here reads a clock,
// Math.random or the network. Every book in the world is built from real
// existing content (the studio's sample, the Ramp gallery books, the
// public-domain sagas) — the only words the simulation itself writes are
// the reader comments and the typed edits, and those are plainly marked as
// simulation text ("[sim] …", "SIMTYPED-…").
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, sha256, stableJson, slugify, WORD_NUMS } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f) => JSON.parse(readFileSync(path.join(HERE, f), 'utf8'));

/** Split n chapter indices into k nearly equal consecutive runs. */
function splitRuns(idx, k) {
  const out = [];
  let at = 0;
  for (let v = 0; v < k; v++) {
    const size = Math.floor(idx.length / k) + (v < idx.length % k ? 1 : 0);
    out.push(idx.slice(at, at + size));
    at += size;
  }
  return out;
}

export function buildWorld(seed, inputs) {
  const { config, sagas, catalog } = inputs;
  const R = rng(seed);
  const pw = (key) => 'sim-' + sha256(`${seed}:${key}`).slice(0, 20);
  const personas = [];
  const books = [];
  const series = [];
  let bookN = 0;
  const newBook = (b) => { const id = 'b' + String(++bookN).padStart(3, '0'); books.push({ id, ...b }); return id; };

  // ---- the saga writers (fixed: these are the interconnected sagas) ----
  for (const p of config.sagaPersonas) {
    personas.push({ key: p.key, name: p.name, email: `${p.key}@sim.beuk.test`, password: pw(p.key), kind: 'saga' });
  }
  for (const s of sagas.series) {
    const ids = s.volumes.map((v, i) => {
      const cat = catalog.sagas.find((x) => x.ebook === v.ebook);
      return newBook({
        persona: s.persona, title: v.title, author: s.author, genre: s.key === 'oz' ? 'children’s fantasy' : 'historical adventure',
        series: { key: s.key, name: s.name, order: i + 1, of: s.volumes.length },
        source: { kind: 'saga', ebook: v.ebook, mdSha256: cat.mdSha256, images: cat.images, chapters: cat.chapters },
        alsoByLink: `https://www.gutenberg.org/ebooks/${v.ebook}`,
      });
    });
    series.push({ key: s.key, name: s.name, persona: s.persona, books: ids, bibleAccept: s.bibleAccept, kind: 'saga' });
  }

  // ---- the Ramp writers: standalone + a 3–4 book re-cut series + another genre ----
  const ramp = catalog.sources.filter((x) => x.kind === 'ramp' || x.kind === 'sample');
  const bodyIdx = (src) => src.sections.filter((x) => x.kind === 'body' && /^(chapter|prologue|epilogue)$/.test(x.type) && x.words > 0).map((x) => x.i);
  const seriesable = R.shuffle(ramp.filter((x) => bodyIdx(x).length >= 3).map((x) => x.key));
  const wholePool = ramp.map((x) => x.key);
  config.rampPersonas.forEach((p, pi) => {
    personas.push({ key: p.key, name: p.name, email: `${p.key}@sim.beuk.test`, password: pw(p.key), kind: 'ramp' });
    const sKey = seriesable[pi % seriesable.length];
    const src = ramp.find((x) => x.key === sKey);
    const idx = bodyIdx(src);
    const vols = idx.length >= 8 ? (R.next() < 0.5 ? 3 : 4) : Math.min(idx.length, R.next() < 0.5 ? 3 : 4);
    const runs = splitRuns(idx, Math.max(3, Math.min(4, vols)));
    const sName = src.title;
    const ids = runs.map((run, vi) => newBook({
      persona: p.key, title: `${src.title} — Book ${WORD_NUMS[vi]}`, author: src.author, genre: config.genres[sKey] || 'fiction',
      series: { key: `${p.key}-${sKey}`, name: sName, order: vi + 1, of: runs.length },
      source: { kind: src.kind, key: sKey, sha256: src.sha256, recut: { body: run, backMatterInLast: true } },
      alsoByLink: `https://sim.beuk.test/books/${slugify(src.title)}-${vi + 1}`,
    }));
    series.push({ key: `${p.key}-${sKey}`, name: sName, persona: p.key, books: ids, bibleAccept: null, kind: 'recut' });
    const others = R.shuffle(wholePool.filter((k) => k !== sKey));
    const standalone = others[0];
    const otherGenre = others.find((k) => (config.genres[k] || '') !== (config.genres[standalone] || '')) || others[1];
    for (const [role, k] of [['standalone', standalone], ['other-genre', otherGenre]]) {
      const s2 = ramp.find((x) => x.key === k);
      newBook({ persona: p.key, role, title: s2.title, author: s2.author, genre: config.genres[k] || 'fiction', series: null, source: { kind: s2.kind, key: k, sha256: s2.sha256 }, alsoByLink: `https://sim.beuk.test/books/${slugify(s2.title)}` });
    }
  });

  // ---- each series: the Bible authored in book 1, carried to the rest, then edited apart ----
  for (const s of series) {
    s.bible = {
      authorIn: s.books[0],
      seedTop: s.bibleAccept ? null : config.recutBibleTop, // Ramp re-cuts: the top-N names Insights finds (characters)
      importInto: s.books.slice(1),
      // book 3 (or the last) changes the first entry; the book after it is left alone
      editIn: s.books[Math.min(2, s.books.length - 1)],
      untouched: s.books[s.books.length - 1] === s.books[Math.min(2, s.books.length - 1)] ? s.books[1] : s.books[s.books.length - 1],
    };
    s.boxSet = { in: s.books[0], volumes: s.books.slice() };
  }

  // ---- beta reading: every writer shares one draft; 2–3 others read and comment ----
  const shares = [];
  const keys = personas.map((p) => p.key);
  personas.forEach((p, i) => {
    const own = books.filter((b) => b.persona === p.key);
    const draft = (own.find((b) => b.role === 'standalone') || own[0]).id;
    const readers = R.sample(keys.filter((k) => k !== p.key), R.int(2, 3));
    const comments = [];
    readers.forEach((r) => {
      const n = R.int(2, 3);
      for (let c = 0; c < n && comments.length < config.maxCommentsPerShare; c++) {
        comments.push({ reader: r, section: Number(R.next().toFixed(6)), paragraph: Number(R.next().toFixed(6)), body: `[sim] comment ${comments.length + 1} from ${r} on ${p.key}'s draft` });
      }
    });
    const resolve = comments.map((_, ci) => ci).filter(() => R.next() < 0.5);
    shares.push({ owner: p.key, book: draft, comments, resolve, ui: i === 0 });
  });

  // ---- persona browser sessions (the Ramp writers; real UI) ----
  const sessions = config.rampPersonas.map((p) => {
    const own = books.filter((b) => b.persona === p.key);
    const book = own.find((b) => b.role === 'standalone').id;
    return {
      persona: p.key, book,
      typeAt: Number(R.next().toFixed(6)), // which chapter (fraction over the body chapters)
      deleteAt: Number(R.next().toFixed(6)),
      moveAt: Number(R.next().toFixed(6)), // Outline: which chapter moves one place later
      goals: { daily: R.pick([250, 500, 750, 1000]), project: R.pick([20000, 50000, 80000]) },
      exports: ['epub', 'submission'],
      share: true,
      resolveViaUi: true,
    };
  });
  const twoP = config.rampPersonas[0].key;
  const twoDevices = { persona: twoP, book: books.find((b) => b.persona === twoP && b.role === 'other-genre').id, chapterA: Number(R.next().toFixed(6)), chapterB: Number(R.next().toFixed(6)) };

  // The import lab: one writer who imports the same volumes by each of the
  // studio's import paths, so the report can say which keeps the book best.
  const lab = { persona: config.labPersona.key, volumes: config.labPersona.compare };
  personas.push({ key: config.labPersona.key, name: config.labPersona.name, email: `${config.labPersona.key}@sim.beuk.test`, password: pw(config.labPersona.key), kind: 'lab' });

  personas.push({ key: config.loadPersona.key, name: config.loadPersona.name, email: `${config.loadPersona.key}@sim.beuk.test`, password: pw(config.loadPersona.key), kind: 'load' });

  return {
    version: 1,
    seed,
    lab,
    note: 'Generated by tools/sim/world.mjs from the seed and the committed catalog. Emails use the reserved .test top-level domain (RFC 2606); passwords exist only in this disposable simulation.',
    personas, books, series, shares, sessions, twoDevices,
    monster: config.monster,
  };
}

export function loadInputs() {
  return { config: readJson('world.config.json'), sagas: readJson('sagas.json'), catalog: readJson('catalog.json') };
}
export function worldBytes(seed) {
  return stableJson(buildWorld(seed, loadInputs()));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const cfg = readJson('world.config.json');
  const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : cfg.seed;
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(HERE, 'out', 'world.json');
  const bytes = worldBytes(seed);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const w = JSON.parse(bytes);
  console.log(`world seed=${seed} sha256=${sha256(bytes)} personas=${w.personas.length} books=${w.books.length} series=${w.series.length} shares=${w.shares.length}`);
}
