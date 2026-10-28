import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { getStreak, type StreakState } from '../streak.js';
import { hydrateDoc } from '../pictures.js';
import { ZIP_LIMIT_BYTES, ZipWriter } from './zip.js';

/**
 * What an account owns, read for the account page, written out for
 * "Download all my data", and removed by "Delete my account".
 *
 * Owned by an account (every table with a user_id/owner_id foreign key
 * to users): sessions, password_resets, email_confirmations,
 * manuscripts, exports (+ their bytes at EXPORT_DIR/<user_id>/), jobs,
 * streak_days, streak_freezes, streak_state, shares (+ share_comments,
 * share_readers), billing_subscriptions. billing_events keep their
 * Stripe event id (the webhook dedupe ledger) with user_id set null.
 *
 * NOT linked to an account in the database, so not part of either:
 * Founders' Shelf applications (name + email typed into a public form,
 * no user id) and the admin-only Housekeeping records.
 */

/** Every table with a foreign key to users, and what "Delete my account"
 *  does with its rows. The self-check account.delete.covers-every-owned-table
 *  fails the day a migration adds a table that references users and is
 *  in neither list. */
export const ACCOUNT_DELETED_TABLES = [
  'sessions',
  'password_resets',
  'email_confirmations',
  'manuscripts',
  'pictures',
  'exports',
  'jobs',
  'streak_days',
  'streak_freezes',
  'streak_state',
  'shares',
  'billing_subscriptions',
] as const;
/** Rows kept with user_id set null, and why. */
export const ACCOUNT_DETACHED_TABLES: Readonly<Record<string, string>> = {
  billing_events: 'the Stripe webhook dedupe ledger (event id, type, outcome; no payload)',
  billing_subscriptions: 'only a live subscription this server could not cancel, left for the operator',
};

export interface ShelfBook {
  id: string;
  title: string;
  /** A rough server-side count (see roughWordsSql); the studio's own count is exact. */
  words: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveItem {
  id: string;
  manuscriptId: string | null;
  format: string;
  preset: string | null;
  filename: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface ShareSummary {
  total: number;
  active: number;
  comments: number;
  openComments: number;
}

export interface AccountOverview {
  user: { id: string; email: string; createdAt: string; emailConfirmedAt: string | null };
  pendingEmail: string | null;
  books: ShelfBook[];
  archive: ArchiveItem[];
  shares: ShareSummary;
  streak: StreakState;
}

const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** Sections of a stored book as a jsonb array, for both shapes the
 *  studio has written: an array, or { frontMatter, body, backMatter }
 *  (the same two shapes src/shares/render.ts normalizeSections reads). */
const SECTIONS_SQL = `case jsonb_typeof(m.doc->'sections')
    when 'array' then m.doc->'sections'
    when 'object' then
      (case when jsonb_typeof(m.doc->'sections'->'frontMatter') = 'array' then m.doc->'sections'->'frontMatter' else '[]'::jsonb end) ||
      (case when jsonb_typeof(m.doc->'sections'->'body') = 'array' then m.doc->'sections'->'body' else '[]'::jsonb end) ||
      (case when jsonb_typeof(m.doc->'sections'->'backMatter') = 'array' then m.doc->'sections'->'backMatter' else '[]'::jsonb end)
    else '[]'::jsonb end`;

/** A rough word count, computed in the database so a page view never
 *  pulls whole books (pictures included) into the app. It follows the
 *  studio's countWords (client/index.html): picture and footnote markers
 *  and the characters # > * _ [ ] ^ are dropped, the rest split on
 *  whitespace; for Japanese, Chinese and Thai books the characters are
 *  counted, less spaces and punctuation; covers, part dividers, plates and
 *  the contents page count nothing. It counts section text only (not
 *  titles or the generated pages), so it can differ a little from the
 *  studio's own number — the page says "about". */
const ROUGH_WORDS_SQL = String.raw`(select coalesce(sum(
      case when m.doc->'meta'->>'language' in ('ja', 'zh-Hans', 'zh-Hant', 'th')
        then char_length(regexp_replace(t.clean, '[[:space:][:punct:]、。，．！？「」『』（）・]', '', 'g'))
        else coalesce(array_length(regexp_split_to_array(nullif(btrim(t.clean), ''), '\s+'), 1), 0)
      end), 0)::int
    from jsonb_array_elements(${SECTIONS_SQL}) s
    cross join lateral (select regexp_replace(regexp_replace(regexp_replace(
        coalesce(s->>'content', s->>'text', ''),
        '!\[[^]]*\]\([^)]*\)', ' ', 'g'),
        '\[\^?[0-9]{1,3}\]:?', ' ', 'g'),
        '[][#>*_^]', ' ', 'g') as clean) t
    where coalesce(s->>'type', '') not in ('cover', 'part', 'frontispiece', 'toc'))`;

export async function accountOverview(db: Db, config: Config, userId: string, now: Date): Promise<AccountOverview | null> {
  const found = await db.query<{ id: string; email: string; created_at: string; email_confirmed_at: string | null }>(
    'select id, email, created_at, email_confirmed_at from users where id = $1',
    [userId],
  );
  const u = found.rows[0];
  if (!u) return null;
  const [books, archive, shares, pending, streak] = await Promise.all([
    db.query<{ id: string; title: string; words: number; revision: number; created_at: string; updated_at: string }>(
      `select m.id, m.title, m.revision, m.created_at, m.updated_at, ${ROUGH_WORDS_SQL} as words
       from manuscripts m where m.user_id = $1 order by m.updated_at desc`,
      [userId],
    ),
    listArchive(db, userId),
    db.query<{ total: number; active: number; comments: number; open_comments: number }>(
      `select count(*)::int as total,
              count(*) filter (where s.revoked_at is null and (s.expires_at is null or s.expires_at > $2::timestamptz))::int as active,
              coalesce(sum(cc.n), 0)::int as comments,
              coalesce(sum(cc.o), 0)::int as open_comments
       from shares s
       left join (select share_id, count(*) as n, count(*) filter (where resolved_at is null) as o
                  from share_comments group by share_id) cc on cc.share_id = s.id
       where s.owner_id = $1`,
      [userId, now.toISOString()],
    ),
    pendingEmailChange(db, userId),
    getStreak(db, userId, now, config.timeZone),
  ]);
  const sh = shares.rows[0];
  return {
    user: { id: u.id, email: u.email, createdAt: iso(u.created_at), emailConfirmedAt: isoOrNull(u.email_confirmed_at) },
    pendingEmail: pending,
    books: books.rows.map((b) => ({
      id: b.id,
      title: b.title,
      words: Number(b.words) || 0,
      revision: b.revision,
      createdAt: iso(b.created_at),
      updatedAt: iso(b.updated_at),
    })),
    archive,
    shares: {
      total: Number(sh?.total ?? 0),
      active: Number(sh?.active ?? 0),
      comments: Number(sh?.comments ?? 0),
      openComments: Number(sh?.open_comments ?? 0),
    },
    streak,
  };
}

async function listArchive(db: Db, userId: string): Promise<ArchiveItem[]> {
  const r = await db.query<{
    id: string; manuscript_id: string | null; format: string; preset: string | null;
    filename: string; byte_size: string; sha256: string; created_at: string;
  }>(
    `select id, manuscript_id, format, preset, filename, byte_size, sha256, created_at
     from exports where user_id = $1 order by created_at desc`,
    [userId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    manuscriptId: x.manuscript_id,
    format: x.format,
    preset: x.preset,
    filename: x.filename,
    byteSize: Number(x.byte_size),
    sha256: x.sha256,
    createdAt: iso(x.created_at),
  }));
}

/** The address a pending, unexpired change-of-email link would move the account to. */
export async function pendingEmailChange(db: Db, userId: string): Promise<string | null> {
  const r = await db.query<{ email: string }>(
    `select email from email_confirmations
     where user_id = $1 and purpose = 'change' and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [userId],
  );
  return r.rows[0]?.email ?? null;
}

/* ------------------------------------------------------------------ */
/* Download all my data                                                */

/** Keep an archive member name readable and safe: no slashes, no
 *  control characters, no leading dots, bounded length. */
export function safeName(name: string, fallback: string): string {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

export async function archiveBytesOf(db: Db, userId: string): Promise<number> {
  const r = await db.query<{ n: string | null }>('select coalesce(sum(byte_size), 0)::bigint as n from exports where user_id = $1', [userId]);
  const books = await db.query<{ n: string | null }>(
    'select coalesce(sum(octet_length(doc::text)), 0)::bigint as n from manuscripts where user_id = $1',
    [userId],
  );
  const pics = await db.query<{ n: string | null }>(
    'select coalesce(sum(octet_length(data)), 0)::bigint as n from pictures where user_id = $1',
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0) + Number(books.rows[0]?.n ?? 0) + Number(pics.rows[0]?.n ?? 0);
}

/**
 * A shelf doc as the book inside a studio backup file. The studio's
 * backup opener (localParseBackup in client/index.html) accepts only
 * {format:'beuk-backup', book:{sections:[...]}}. The studio writes
 * sections as an array; older/other writers used
 * {frontMatter, body, backMatter} — flattened here with each section's
 * kind (front/body/back), the same reading src/shares/render.ts makes.
 * Anything else returns null: it is kept as stored, and said so.
 */
export function asStudioBackupBook(doc: unknown): Record<string, unknown> | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (Array.isArray(d.sections)) return d;
  if (d.sections && typeof d.sections === 'object') {
    const s = d.sections as Record<string, unknown>;
    if (![s.frontMatter, s.body, s.backMatter].some(Array.isArray)) return null;
    const tier = (arr: unknown, kind: string) =>
      (Array.isArray(arr) ? arr : [])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
        .map((x) => ({ ...x, kind: typeof x.kind === 'string' && x.kind ? x.kind : kind }));
    return { ...d, sections: [...tier(s.frontMatter, 'front'), ...tier(s.body, 'body'), ...tier(s.backMatter, 'back')] };
  }
  return null;
}

/** The README.txt at the root of the archive. */
export function exportReadme(opts: { email: string; exportedAt: string; appBaseUrl: string; counts: Record<string, number>; missingFiles: number }): string {
  const c = opts.counts;
  return [
    'Your Beuk data',
    '==============',
    '',
    `Everything the Beuk server at ${opts.appBaseUrl} keeps for the account ${opts.email},`,
    `as it was at ${opts.exportedAt} (UTC).`,
    '',
    'What is inside',
    '--------------',
    '',
    `account.json            Your account: email address, when it was created, whether`,
    `                        the address is confirmed, any pending change of address,`,
    `                        and what the server knows about your plan.`,
    `manuscripts/            Every book on your shelf (${c.manuscripts}), one Beuk backup file`,
    `                        each (.beuk-backup.json) — the whole book as the studio saved`,
    `                        it: text, settings, pictures and its snapshot history. Open`,
    `                        one in the studio with "Open a backup". manuscripts/index.json`,
    `                        lists each book's shelf id, revision and dates.`,
    ...(c.unopenable
      ? [
          `                        ${c.unopenable} book(s) had no chapters the studio could read;`,
          `                        they are kept as plain .json files exactly as stored, and`,
          `                        index.json marks them ("studioCanOpen": false).`,
        ]
      : []),
    `exports/                Every file in your export archive (${c.exports}), byte for byte,`,
    `                        and exports/index.json with each one's format, preset,`,
    `                        size, SHA-256 and date.`,
    `shares/                 Your beta-reader links (${c.shares}): each link's settings, the`,
    `                        frozen reading copy readers saw, and every comment readers`,
    `                        left (${c.comments}). The link addresses themselves are not here:`,
    `                        the server only ever kept a scrambled form of them.`,
    `streak.json             Your writing streak: every day the server saw you writing,`,
    `                        the days a freeze or a planned pause covered, and your`,
    `                        freeze balance.`,
    `jobs.json               Server checks you ran (EPUBCheck, PDF/X) and their results.`,
    '',
    'What is not inside',
    '------------------',
    '',
    '- Your password. The server keeps only a one-way hash of it, which is of no use',
    '  to you and is left out.',
    '- Sign-in sessions and reset or confirmation links: they are short-lived keys,',
    '  not your data.',
    "- Anything kept only in your browser: a book you never brought to the shelf, the",
    "  studio's per-device writing log and settings. Export those from the studio on",
    '  that device.',
    '- Readers\' network addresses: comments carry only a scrambled abuse-control value,',
    '  which is left out.',
    ...(opts.missingFiles
      ? [
          '',
          `Note: ${opts.missingFiles} archived file(s) were listed but missing from the server's`,
          'storage when this was made. exports/index.json marks each one ("missingFromStorage").',
        ]
      : []),
    '',
  ].join('\n');
}

/** Write the whole account into `zip`. Every query is owner-scoped. */
export async function writeAccountExport(
  db: Db,
  config: Config,
  userId: string,
  now: Date,
  zip: ZipWriter,
  account: Record<string, unknown>,
): Promise<{ counts: Record<string, number>; missingFiles: number }> {
  const counts: Record<string, number> = { manuscripts: 0, unopenable: 0, exports: 0, shares: 0, comments: 0 };

  // Manuscripts, one at a time (a book can be large).
  const ids = await db.query<{ id: string }>('select id from manuscripts where user_id = $1 order by created_at', [userId]);
  const books: { id: string; title: string; revision: number; createdAt: string; updatedAt: string; file: string; studioCanOpen: boolean }[] = [];
  for (const { id } of ids.rows) {
    const r = await db.query<{ id: string; title: string; doc: unknown; revision: number; created_at: string; updated_at: string }>(
      'select id, title, doc, revision, created_at, updated_at from manuscripts where id = $1 and user_id = $2',
      [id, userId],
    );
    const m = r.rows[0];
    if (!m) continue; // deleted meanwhile
    const base = `manuscripts/${safeName(m.title, 'Untitled')} (${m.id.slice(0, 8)})`;
    // Shelf pictures are stored once (src/pictures.ts): the backup file
    // carries them whole, as the studio's own backup does.
    const doc = await hydrateDoc(db, userId, m.doc);
    const book = asStudioBackupBook(doc);
    const file = book
      ? await zip.add(
          `${base}.beuk-backup.json`,
          JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: now.toISOString(), book }),
          { compress: true, modified: new Date(m.updated_at) },
        )
      : await zip.add(`${base}.json`, JSON.stringify(doc, null, 2), { compress: true, modified: new Date(m.updated_at) });
    if (!book) counts.unopenable += 1;
    books.push({
      id: m.id,
      title: m.title,
      revision: m.revision,
      createdAt: iso(m.created_at),
      updatedAt: iso(m.updated_at),
      file,
      studioCanOpen: !!book,
    });
    counts.manuscripts += 1;
  }
  await zip.add('manuscripts/index.json', JSON.stringify({ manuscripts: books }, null, 2), { compress: true });

  // Exports: the bytes, then an index with each file's metadata.
  const archive = await listArchive(db, userId);
  let missingFiles = 0;
  const index: Record<string, unknown>[] = [];
  for (const x of [...archive].reverse()) {
    let bytes: Buffer | null = null;
    try {
      bytes = await readFile(path.join(config.exportDir, userId, x.id));
    } catch {
      bytes = null;
    }
    if (!bytes) {
      missingFiles += 1;
      index.push({ ...x, file: null, missingFromStorage: true });
      continue;
    }
    const textual = ['markdown', 'html', 'print-html'].includes(x.format);
    const file = await zip.add(`exports/${safeName(x.filename, `export-${x.id.slice(0, 8)}`)}`, bytes, {
      compress: textual,
      modified: new Date(x.createdAt),
    });
    index.push({ ...x, file });
    counts.exports += 1;
  }
  await zip.add('exports/index.json', JSON.stringify({ exports: index }, null, 2), { compress: true });

  // Shares: settings, the frozen copy readers saw, and the comments.
  const shares = await db.query<{
    id: string; manuscript_id: string | null; title: string; snapshot: unknown; images: unknown;
    published_at: string; created_at: string; expires_at: string | null; revoked_at: string | null;
    allow_comments: boolean; reader_name_required: boolean;
  }>(
    `select id, manuscript_id, title, snapshot, images, published_at, created_at, expires_at, revoked_at,
            allow_comments, reader_name_required
     from shares where owner_id = $1 order by created_at`,
    [userId],
  );
  for (const s of shares.rows) {
    const comments = await db.query<{
      id: string; section_id: string; paragraph_index: number | null; quote: string | null;
      body: string; reader_name: string; created_at: string; resolved_at: string | null;
    }>(
      `select c.id, c.section_id, c.paragraph_index, c.quote, c.body, c.reader_name, c.created_at, c.resolved_at
       from share_comments c join shares s on s.id = c.share_id
       where c.share_id = $1 and s.owner_id = $2 order by c.created_at`,
      [s.id, userId],
    );
    const readers = await db.query<{ n: number }>('select count(*)::int as n from share_readers where share_id = $1', [s.id]);
    await zip.add(
      `shares/${safeName(s.title, 'Untitled')} (${s.id.slice(0, 8)}).json`,
      JSON.stringify(
        {
          id: s.id,
          manuscriptId: s.manuscript_id,
          title: s.title,
          createdAt: iso(s.created_at),
          publishedAt: iso(s.published_at),
          expiresAt: isoOrNull(s.expires_at),
          revokedAt: isoOrNull(s.revoked_at),
          allowComments: s.allow_comments,
          readerNameRequired: s.reader_name_required,
          readerCount: Number(readers.rows[0]?.n ?? 0),
          comments: comments.rows.map((c) => ({
            id: c.id,
            sectionId: c.section_id,
            paragraphIndex: c.paragraph_index,
            quote: c.quote,
            body: c.body,
            readerName: c.reader_name,
            createdAt: iso(c.created_at),
            resolvedAt: isoOrNull(c.resolved_at),
          })),
          readingCopy: s.snapshot,
          readingCopyImages: s.images,
        },
        null,
        2,
      ),
      { compress: true },
    );
    counts.shares += 1;
    counts.comments += comments.rows.length;
  }

  // Streak: the raw days and freezes, plus what they add up to today.
  const [days, freezes, state, streak] = await Promise.all([
    db.query<{ day: string; created_at: string }>('select day, created_at from streak_days where user_id = $1 order by day', [userId]),
    db.query<{ day: string; source: string; created_at: string }>(
      'select day, source, created_at from streak_freezes where user_id = $1 order by day',
      [userId],
    ),
    db.query<{ freezes_available: number }>('select freezes_available from streak_state where user_id = $1', [userId]),
    getStreak(db, userId, now, config.timeZone),
  ]);
  await zip.add(
    'streak.json',
    JSON.stringify(
      {
        timeZone: config.timeZone,
        current: streak.current,
        longest: streak.longest,
        freezesAvailable: state.rows[0]?.freezes_available ?? 0,
        daysWriting: days.rows.map((d) => String(d.day).slice(0, 10)),
        daysCovered: freezes.rows.map((f) => ({ day: String(f.day).slice(0, 10), by: f.source })),
      },
      null,
      2,
    ),
    { compress: true },
  );

  const jobs = await db.query<{ id: string; kind: string; status: string; source_export_id: string | null; result: unknown; created_at: string; finished_at: string | null }>(
    `select id, kind, status, source_export_id, result, created_at, finished_at
     from jobs where user_id = $1 order by created_at`,
    [userId],
  );
  await zip.add(
    'jobs.json',
    JSON.stringify(
      {
        jobs: jobs.rows.map((j) => ({
          id: j.id,
          kind: j.kind,
          status: j.status,
          sourceExportId: j.source_export_id,
          result: j.result,
          createdAt: iso(j.created_at),
          finishedAt: isoOrNull(j.finished_at),
        })),
      },
      null,
      2,
    ),
    { compress: true },
  );

  await zip.add('account.json', JSON.stringify({ ...account, books, counts }, null, 2), { compress: true });
  return { counts, missingFiles };
}

export { ZIP_LIMIT_BYTES };

/* ------------------------------------------------------------------ */
/* Delete my account                                                   */

export interface DeletionResult {
  removed: Record<string, number>;
  /** Live Stripe subscriptions left unattributed for the operator. */
  subscriptionsLeftForOperator: number;
}

/**
 * Remove everything the account owns in ONE transaction, then its
 * export files. Each owned table is deleted explicitly (not only by
 * cascade) so the counts are real and a future table without a cascade
 * cannot silently survive. `keepSubscriptionIds`: live subscriptions
 * the billing step could not cancel; they stay, with user_id null, for
 * the operator (Housekeeping lists unattributed subscriptions).
 */
export async function deleteAccount(
  db: Db,
  config: Config,
  userId: string,
  keepSubscriptionIds: string[],
): Promise<DeletionResult> {
  const removed: Record<string, number> = {};
  await db.tx(async (tx) => {
    const del = async (label: string, sql: string, params: unknown[]) => {
      const r = await tx.query<{ x: number }>(`${sql} returning 1 as x`, params);
      removed[label] = r.rows.length;
    };
    await del('share_comments', 'delete from share_comments where share_id in (select id from shares where owner_id = $1)', [userId]);
    await del('share_readers', 'delete from share_readers where share_id in (select id from shares where owner_id = $1)', [userId]);
    await del('shares', 'delete from shares where owner_id = $1', [userId]);
    await del('jobs', 'delete from jobs where user_id = $1', [userId]);
    await del('exports', 'delete from exports where user_id = $1', [userId]);
    await del('manuscripts', 'delete from manuscripts where user_id = $1', [userId]);
    await del('pictures', 'delete from pictures where user_id = $1', [userId]);
    await del('streak_days', 'delete from streak_days where user_id = $1', [userId]);
    await del('streak_freezes', 'delete from streak_freezes where user_id = $1', [userId]);
    await del('streak_state', 'delete from streak_state where user_id = $1', [userId]);
    await del('password_resets', 'delete from password_resets where user_id = $1', [userId]);
    await del('email_confirmations', 'delete from email_confirmations where user_id = $1', [userId]);
    const subs = await tx.query<{ stripe_subscription_id: string }>(
      'select stripe_subscription_id from billing_subscriptions where user_id = $1',
      [userId],
    );
    removed.billing_subscriptions = 0;
    for (const { stripe_subscription_id: id } of subs.rows) {
      if (keepSubscriptionIds.includes(id)) continue;
      await tx.query('delete from billing_subscriptions where stripe_subscription_id = $1 and user_id = $2', [id, userId]);
      removed.billing_subscriptions += 1;
    }
    await tx.query('update billing_subscriptions set user_id = null where user_id = $1', [userId]);
    await tx.query('update billing_events set user_id = null where user_id = $1', [userId]);
    await del('sessions', 'delete from sessions where user_id = $1', [userId]);
    await del('users', 'delete from users where id = $1', [userId]);
  });
  // The bytes go after the rows: a crash in between leaves orphan files
  // (invisible to everyone; Housekeeping's data.exports.no-orphan-files
  // check reports them, it does not remove them), never rows pointing at
  // nothing. A server job finishing during the delete is handled by the
  // runner: it unlinks its file when the export row did not survive.
  await rm(path.join(config.exportDir, userId), { recursive: true, force: true });
  return { removed, subscriptionsLeftForOperator: keepSubscriptionIds.length };
}
