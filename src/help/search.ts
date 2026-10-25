import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { getHelpContent, type Guide, type HelpContent } from './content.js';
import { sectionAnchor } from './render-util.js';

/**
 * H2 — Help search over the guides and the error dictionary.
 *
 * Index: table help_docs (migration 013), one row per guide, per guide
 * section and per error entry, with a generated, weighted tsvector
 * (title A, body B) under a GIN index, plus pg_trgm GIN indexes on the
 * title and the codes column when the pg_trgm extension is available.
 * It is rebuilt from the content files — at boot, and again whenever
 * the content changes (dev reload): an idempotent upsert of every row
 * and a delete of rows whose content is gone.
 *
 * Query order (GET /api/help/search?q=, and the no-JS page /help/search):
 *   1. exact codes — every code in the text is extracted (BEUK-X201,
 *      EPUBCheck ids like RSC-005 / OPF-085, and the HTTP statuses the
 *      dictionary maps), so a pasted multi-line store message matches
 *      every entry it names, in the order the codes appear;
 *   2. full-text — websearch_to_tsquery('english', q), ranked by ts_rank,
 *      with ts_headline snippets;
 *   3. typo-tolerant — only when 1 and 2 found nothing: pg_trgm
 *      word_similarity on titles and codes; without pg_trgm (PGlite in the
 *      tests, or a Postgres without the contrib module) the same
 *      trigram similarity is computed here over the content titles.
 * Every query is logged to search_log as (sha-256 of the normalised
 * query, the first 200 characters, the result count) — no user id, no
 * IP address. Zero-result queries are what Housekeeping can read back.
 */

export interface SearchHit {
  kind: 'error' | 'guide' | 'section';
  ref: string;
  title: string;
  url: string;
  snippet: string;
  /** How it matched: an exact code, full-text, or trigram similarity. */
  match: 'code' | 'text' | 'similar';
  code?: string;
  category?: string;
  matchedCode?: string;
}

export interface SearchResult {
  q: string;
  codes: string[];
  errors: SearchHit[];
  guides: SearchHit[];
  sections: SearchHit[];
  total: number;
  trigram: 'pg_trgm' | 'fallback' | 'not-needed';
  logId: string | null;
}

interface DocRow {
  id: string;
  kind: 'guide' | 'error' | 'section';
  ref: string;
  title: string;
  body: string;
  codes: string;
  url: string;
}

/** Words searched: the first 2000 characters. Codes: the first 20000 —
 *  a pasted EPUBCheck report repeats long element lists, and the code a
 *  writer needs can sit several kilobytes in. */
const MAX_Q = 2000;
export const MAX_PASTE = 20_000;

export function normaliseQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim();
}

function guideDocs(g: Guide): DocRow[] {
  const codes = new Set<string>();
  for (const sec of g.explanation) for (const b of sec.blocks) if (b.kind === 'ul' || b.kind === 'ol') for (const it of b.items) for (const c of it.codes) codes.add(c);
  const docs: DocRow[] = [
    {
      id: `guide:${g.slug}`,
      kind: 'guide',
      ref: g.slug,
      title: g.title,
      body: [g.blurb, g.plainText, ...g.steps.map((s) => s.tech ?? '')].join('\n'),
      codes: [...codes].join(' '),
      url: `/help/${g.slug}`,
    },
  ];
  for (const sec of [...g.explanation, ...g.troubleshooting]) {
    const text = sec.blocks
      .map((b) => (b.kind === 'p' || b.kind === 'says' ? b.text : b.items.map((i) => i.text).join('\n')))
      .join('\n');
    const anchor = sectionAnchor(sec.heading);
    docs.push({
      id: `section:${g.slug}#${anchor}`,
      kind: 'section',
      ref: `${g.slug}#${anchor}`,
      title: `${sec.heading} — ${g.title}`,
      body: text,
      codes: '',
      url: `/help/${g.slug}#${anchor}`,
    });
  }
  return docs;
}

export function buildDocs(content: HelpContent): DocRow[] {
  const docs: DocRow[] = [];
  for (const g of content.guides) docs.push(...guideDocs(g));
  for (const e of content.errors) {
    docs.push({
      id: `error:${e.code}`,
      kind: 'error',
      ref: e.code,
      title: e.title,
      body: [e.cause, ...e.says.map((s) => s.text), ...e.steps, e.maps.store.join(' ')].join('\n'),
      codes: [e.code, ...e.maps.epubcheck, ...e.maps.http.map((h) => String(h.status)), ...e.maps.store].join(' '),
      url: `/help/errors/${e.code}`,
    });
  }
  return docs;
}

const indexed = new WeakMap<Db, string>();

/** Rebuild help_docs from the content (idempotent). Returns the counts. */
export async function rebuildHelpIndex(db: Db, content: HelpContent = getHelpContent()): Promise<{ upserted: number; removed: number }> {
  const docs = buildDocs(content);
  const result = await db.tx(async (tx) => {
    for (const d of docs) {
      await tx.query(
        `insert into help_docs (id, kind, ref, title, body, codes, url)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set kind = excluded.kind, ref = excluded.ref, title = excluded.title,
           body = excluded.body, codes = excluded.codes, url = excluded.url, updated_at = now()
         where (help_docs.kind, help_docs.ref, help_docs.title, help_docs.body, help_docs.codes, help_docs.url)
           is distinct from (excluded.kind, excluded.ref, excluded.title, excluded.body, excluded.codes, excluded.url)`,
        [d.id, d.kind, d.ref, d.title, d.body, d.codes, d.url],
      );
    }
    const removed = await tx.query<{ id: string }>(
      `delete from help_docs where not (id = any($1::text[])) returning id`,
      [docs.map((d) => d.id)],
    );
    return { upserted: docs.length, removed: removed.rows.length };
  });
  indexed.set(db, content.stamp);
  return result;
}

/** Rebuild when this process has not indexed this content yet. */
export async function ensureHelpIndex(db: Db): Promise<void> {
  const content = getHelpContent();
  if (indexed.get(db) === content.stamp) return;
  await rebuildHelpIndex(db, content);
}

/** Every code in a query or a pasted message, in order of appearance. */
export function extractCodes(text: string, content: HelpContent = getHelpContent()): string[] {
  const httpStatuses = new Set(content.errors.flatMap((e) => e.maps.http.map((h) => String(h.status))));
  const found: string[] = [];
  const add = (c: string) => {
    if (!found.includes(c)) found.push(c);
  };
  const re = /\bBEUK-[A-Z]\d{3}\b|\b[A-Z]{3}-\d{3}[a-z]?\b|\bITMS-\d{4,5}\b|\b[1-5]\d\d\b/gi;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    if (/^\d+$/.test(tok)) {
      if (httpStatuses.has(tok)) add(tok);
    } else if (/^beuk-/i.test(tok)) add(tok.toUpperCase());
    else if (/^itms-/i.test(tok)) add(tok.toUpperCase());
    else add(tok.slice(0, 7).toUpperCase() + tok.slice(7));
  }
  return found;
}

/* ---- trigram similarity, the pg_trgm algorithm, for the fallback ---- */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Best similarity of the query against any run of as many consecutive
 *  words in the text — the idea of pg_trgm's word_similarity, so a short
 *  query is compared with the words it resembles, not a whole title. */
export function wordSimilarity(q: string, text: string): number {
  const qw = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tw = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!qw.length || !tw.length) return 0;
  const k = Math.min(qw.length, tw.length);
  let best = 0;
  for (let i = 0; i + k <= tw.length; i++) best = Math.max(best, trigramSimilarity(qw.join(' '), tw.slice(i, i + k).join(' ')));
  return best;
}

const SIMILARITY_MIN = 0.4;

async function hasTrgm(db: Db): Promise<boolean> {
  try {
    const r = await db.query<{ ok: boolean }>(`select exists (select 1 from pg_extension where extname = 'pg_trgm') as ok`);
    return Boolean(r.rows[0]?.ok);
  } catch {
    return false;
  }
}

function hitOf(content: HelpContent, row: { kind: string; ref: string; title: string; url: string }, snippet: string, match: SearchHit['match'], matchedCode?: string): SearchHit {
  const hit: SearchHit = { kind: row.kind as SearchHit['kind'], ref: row.ref, title: row.title, url: row.url, snippet, match };
  if (row.kind === 'error') {
    const e = content.errorByCode.get(row.ref);
    hit.code = row.ref;
    hit.category = e?.category;
  }
  if (matchedCode) hit.matchedCode = matchedCode;
  return hit;
}

function errorSnippet(content: HelpContent, code: string): string {
  const e = content.errorByCode.get(code);
  return e ? e.cause : '';
}

export async function searchHelp(db: Db, rawQ: string, opts: { log?: boolean } = {}): Promise<SearchResult> {
  await ensureHelpIndex(db);
  const content = getHelpContent();
  const q = normaliseQuery(String(rawQ ?? '').slice(0, MAX_Q));
  const result: SearchResult = { q, codes: [], errors: [], guides: [], sections: [], total: 0, trigram: 'not-needed', logId: null };
  if (!q) return result;
  const seen = new Set<string>();
  const push = (h: SearchHit) => {
    const key = `${h.kind}:${h.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    (h.kind === 'error' ? result.errors : h.kind === 'guide' ? result.guides : result.sections).push(h);
  };

  // 1. exact codes, in the order they appear in the text.
  result.codes = extractCodes(String(rawQ ?? '').slice(0, MAX_PASTE), content);
  for (const code of result.codes) {
    const r = await db.query<DocRow>(
      `select id, kind, ref, title, body, codes, url from help_docs
       where kind = 'error' and $1 = any(string_to_array(codes, ' ')) order by ref`,
      [code],
    );
    for (const row of r.rows) push(hitOf(content, row, errorSnippet(content, row.ref), 'code', code));
  }

  // 2. full-text.
  const fts = await db.query<DocRow & { rank: number; snippet: string }>(
    `select id, kind, ref, title, url, ts_rank(tsv, query) as rank,
            ts_headline('english', body, query, 'StartSel=«, StopSel=», MaxWords=28, MinWords=10, MaxFragments=1') as snippet
     from help_docs, websearch_to_tsquery('english', $1) query
     where tsv @@ query
     order by rank desc, kind, ref
     limit 20`,
    [q],
  );
  for (const row of fts.rows) push(hitOf(content, row, row.snippet.replace(/\s+/g, ' ').trim(), 'text'));

  // 3. typo-tolerant, only when nothing matched so far.
  if (!seen.size) {
    if (await hasTrgm(db)) {
      result.trigram = 'pg_trgm';
      const r = await db.query<DocRow & { score: number }>(
        `select id, kind, ref, title, body, codes, url,
                greatest(word_similarity($1, title), word_similarity($1, codes)) as score
         from help_docs
         where kind <> 'section' and greatest(word_similarity($1, title), word_similarity($1, codes)) >= $2
         order by score desc, ref limit 8`,
        [q, SIMILARITY_MIN],
      );
      for (const row of r.rows) push(hitOf(content, row, row.kind === 'error' ? errorSnippet(content, row.ref) : content.guideBySlug.get(row.ref)?.blurb ?? '', 'similar'));
    } else {
      result.trigram = 'fallback';
      const docs = buildDocs(content).filter((d) => d.kind !== 'section');
      const scored = docs
        .map((d) => ({ d, score: Math.max(wordSimilarity(q, d.title), wordSimilarity(q, d.codes)) }))
        .filter((x) => x.score >= SIMILARITY_MIN)
        .sort((a, b) => b.score - a.score || a.d.ref.localeCompare(b.d.ref))
        .slice(0, 8);
      for (const { d } of scored) push(hitOf(content, d, d.kind === 'error' ? errorSnippet(content, d.ref) : content.guideBySlug.get(d.ref)?.blurb ?? '', 'similar'));
    }
  }

  result.guides = result.guides.slice(0, 8);
  result.sections = result.sections.slice(0, 8);
  result.total = result.errors.length + result.guides.length + result.sections.length;
  if (opts.log !== false) result.logId = await logSearch(db, q, result.total);
  return result;
}

export async function logSearch(db: Db, q: string, count: number): Promise<string | null> {
  const norm = normaliseQuery(q).toLowerCase();
  const hash = createHash('sha256').update(norm).digest('hex');
  const r = await db.query<{ id: string }>(
    `insert into search_log (q_hash, q_text, results_count) values ($1, $2, $3) returning id::text as id`,
    [hash, normaliseQuery(q).slice(0, 200), count],
  );
  return r.rows[0]?.id ?? null;
}

/** Record which result a search led to (no user id, no IP). */
export async function logSearchClick(db: Db, logId: string, ref: string): Promise<boolean> {
  if (!/^\d{1,18}$/.test(logId) || !/^[A-Za-z0-9#:-]{1,120}$/.test(ref)) return false;
  const r = await db.query<{ id: string }>(
    `update search_log set clicked_ref = $2
     where id = $1::bigint and clicked_ref is null and created_at > now() - interval '1 hour'
     returning id::text as id`,
    [logId, ref],
  );
  return r.rows.length > 0;
}
