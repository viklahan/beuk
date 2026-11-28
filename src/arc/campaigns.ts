import { createHash, randomBytes } from 'node:crypto';
import { tokenHash } from '../auth.js';
import { buildEpub } from '../book/epub/build.js';
import type { EpubQueue } from '../book/epub/queue.js';
import { isIsoDate, type Config } from '../config.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';
import type { Mailer } from '../mailer.js';
import { hydrateDoc } from '../pictures.js';
import { renderSnapshot } from '../shares/render.js';
import { arcMailStatus } from './mail.js';

/**
 * ARC campaigns: starting one and reading it back (slice 1, Task 4).
 *
 * A campaign is a thin layer on the beta-reader share: a NEW shares row
 * with no open link (token_hash null, open_link_closed_at set), one
 * arc_campaigns row, and one arc_builds row holding version 1 — the
 * store-ready EPUB built once by the server EPUB build (src/book/epub),
 * through the same queue as POST /api/epub. Readers arrive later as
 * share_recipients rows with role 'arc' (Tasks 5-7).
 *
 * createCampaign, in order (the build is long, so no lock or transaction
 * is held during it; the unique index arc_campaigns_one_running_idx is
 * the judge of a race):
 *   1. 409 while ARC mail is not configured ({ error, mail });
 *   2. 404 unless the manuscript is this writer's;
 *   3. this book's campaigns past closes_at are ended (ended_at = closes_at),
 *      then 409 when one is still running;
 *   4. the doc is read once: the reading copy (renderSnapshot over the
 *      hydrated doc) and the EPUB (buildEpub with { book: doc }; its
 *      EpubInputError / EpubBusyError / EpubBuildError pass up, and the
 *      route answers them with sendEpubError, as POST /api/epub does);
 *   5. one transaction: the share, the campaign, the build.
 * The signup token is returned once; only tokenHash(token) is stored.
 */

/** "cap 50" (plan Global Constraints): a campaign's max_claims is 1-50,
 *  50 when the author does not choose (the column has no default). */
export const ARC_MAX_CLAIMS = 50;
/** How far ahead a campaign may close. The number is the plan's (Task 4). */
export const ARC_MAX_CLOSE_DAYS = 400;
/** The blurb kept with a build, in code points (the plan's number). */
export const ARC_BLURB_MAX = 2000;

const DAY_MS = 86_400_000;
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const ONE_RUNNING_IDX = 'arc_campaigns_one_running_idx';
const COVER_TYPES = /^image\/(jpeg|png|gif|webp)$/;
/** As POST /api/epub reads `lang` (src/routes/epub.ts). */
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
/** An ISO 8601 instant with its offset: a date, a time and Z or ±hh:mm.
 *  (Decided by this task: a bare date or a zone-less time is refused,
 *  because it would be read in the server's zone, not the author's.) */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export interface CampaignRow {
  id: string;
  share_id: string;
  owner_id: string;
  manuscript_id: string;
  max_claims: number;
  approval_mode: 'instant' | 'approval';
  launch_date: string;
  closes_at: string;
  tz: string;
  author_notified_at: string | null;
  created_at: string;
  ended_at: string | null;
}

/** ended: ended_at set; closed: now ≥ closes_at; else open. */
export type CampaignState = 'open' | 'closed' | 'ended';

export function campaignState(c: CampaignRow, now: Date): CampaignState {
  if (c.ended_at) return 'ended';
  if (now.getTime() >= new Date(c.closes_at).getTime()) return 'closed';
  return 'open';
}

export interface CampaignJson {
  id: string;
  shareId: string;
  manuscriptId: string;
  title: string;
  launchDate: string;
  closesAt: string;
  tz: string;
  maxClaims: number;
  approvalMode: 'instant' | 'approval';
  state: CampaignState;
  createdAt: string;
  endedAt: string | null;
  // counts.claimed: every status 'claimed' row, revoked ones included; counts.revoked: the subset the author closed;
  // unverified rows are never counted or shown; build.holders: claimed rows whose build_id is this build
  counts: { claimed: number; pending: number; declined: number; revoked: number };
  build: { label: string; bytes: number; holders: number };
}

export interface CreateCampaignInput {
  manuscriptId: string;
  launchDate: string;
  closesAt: string;
  tz: string;
  maxClaims: number;
  approvalMode: 'instant' | 'approval';
  lang: string;
}

export interface ArcDeps {
  db: Db;
  config: Config;
  arcMailer: Mailer | null;
  mailer: Mailer;
  epubQueue: EpubQueue;
  now: () => Date;
}

/** A refusal with words for the author: the route answers `status` with
 *  `{ error: message, ...extra }`. */
export class ArcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return new Date(v as string | Date).toISOString();
}

/** The columns of a CampaignRow (launch_date as 'YYYY-MM-DD' text on both
 *  pg and PGlite). Rows go through rowOf so every timestamp is an ISO string. */
export const CAMPAIGN_COLS = `c.id, c.share_id, c.owner_id, c.manuscript_id, c.max_claims, c.approval_mode,
  c.launch_date::text as launch_date, c.closes_at, c.tz, c.author_notified_at, c.created_at, c.ended_at`;

export function rowOf(r: Record<string, unknown>): CampaignRow {
  return {
    id: String(r.id),
    share_id: String(r.share_id),
    owner_id: String(r.owner_id),
    manuscript_id: String(r.manuscript_id),
    max_claims: Number(r.max_claims),
    approval_mode: r.approval_mode === 'approval' ? 'approval' : 'instant',
    launch_date: String(r.launch_date),
    closes_at: iso(r.closes_at)!,
    tz: String(r.tz),
    author_notified_at: iso(r.author_notified_at),
    created_at: iso(r.created_at)!,
    ended_at: iso(r.ended_at),
  };
}

/** The module's row-to-JSON builder: the share's title, the reader counts
 *  and the newest build (version 1 in slice 1). */
export async function campaignJson(db: Db, c: CampaignRow, now: Date): Promise<CampaignJson> {
  const r = await db.query<{
    title: string;
    build_id: string | null;
    build_label: string | null;
    build_bytes: number | null;
    claimed: number;
    pending: number;
    declined: number;
    revoked: number;
    holders: number;
  }>(
    `select s.title, b.id as build_id, b.label as build_label, b.epub_bytes as build_bytes,
       count(*) filter (where r.status = 'claimed')::int as claimed,
       count(*) filter (where r.status = 'pending')::int as pending,
       count(*) filter (where r.status = 'declined')::int as declined,
       count(*) filter (where r.status = 'claimed' and r.revoked_at is not null)::int as revoked,
       count(*) filter (where r.status = 'claimed' and b.id is not null and r.build_id = b.id)::int as holders
     from shares s
     left join lateral (
       select id, label, epub_bytes from arc_builds where campaign_id = $2 order by version_no desc limit 1
     ) b on true
     left join share_recipients r on r.share_id = s.id and r.role = 'arc'
     where s.id = $1
     group by s.title, b.id, b.label, b.epub_bytes`,
    [c.share_id, c.id],
  );
  const x = r.rows[0];
  return {
    id: c.id,
    shareId: c.share_id,
    manuscriptId: c.manuscript_id,
    title: x?.title ?? '',
    launchDate: c.launch_date,
    closesAt: c.closes_at,
    tz: c.tz,
    maxClaims: c.max_claims,
    approvalMode: c.approval_mode,
    state: campaignState(c, now),
    createdAt: c.created_at,
    endedAt: c.ended_at,
    counts: {
      claimed: Number(x?.claimed ?? 0),
      pending: Number(x?.pending ?? 0),
      declined: Number(x?.declined ?? 0),
      revoked: Number(x?.revoked ?? 0),
    },
    build: { label: x?.build_label ?? '', bytes: Number(x?.build_bytes ?? 0), holders: Number(x?.holders ?? 0) },
  };
}

/** Is a valid IANA zone for Intl (the browser's resolvedOptions().timeZone). */
function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The start form's body, checked. Every refusal is a 400 with words. */
export function parseCreateInput(body: unknown, now: Date): CreateCampaignInput | ArcError {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new ArcError('send the campaign as a JSON object', 400);
  const b = body as Record<string, unknown>;
  if (!isUuid(b.manuscriptId)) return new ArcError('manuscriptId is required: the book this campaign is for', 400);
  const launchDate = typeof b.launchDate === 'string' ? b.launchDate : undefined;
  if (!isIsoDate(launchDate)) return new ArcError('launchDate must be a real calendar date, written YYYY-MM-DD', 400);
  const closesRaw = typeof b.closesAt === 'string' ? b.closesAt : '';
  const closes = INSTANT_RE.test(closesRaw) ? new Date(closesRaw) : null;
  if (!closes || Number.isNaN(closes.getTime()))
    return new ArcError('closesAt must be a date and time with its offset, such as 2027-02-14T00:00:00Z', 400);
  if (closes.getTime() <= now.getTime()) return new ArcError('closesAt must be in the future: sign-ups cannot close before they open', 400);
  if (closes.getTime() > now.getTime() + ARC_MAX_CLOSE_DAYS * DAY_MS)
    return new ArcError(`closesAt can be at most ${ARC_MAX_CLOSE_DAYS} days from now`, 400);
  const tz = typeof b.tz === 'string' ? b.tz : '';
  if (!tz || tz.length > 100 || !validZone(tz)) return new ArcError('tz must be a time zone name, such as Europe/London', 400);
  let maxClaims = ARC_MAX_CLAIMS;
  if (b.maxClaims !== undefined && b.maxClaims !== null) {
    if (typeof b.maxClaims !== 'number' || !Number.isInteger(b.maxClaims) || b.maxClaims < 1 || b.maxClaims > ARC_MAX_CLAIMS)
      return new ArcError(`maxClaims must be a whole number from 1 to ${ARC_MAX_CLAIMS}`, 400);
    maxClaims = b.maxClaims;
  }
  let approvalMode: 'instant' | 'approval' = 'instant';
  if (b.approvalMode !== undefined && b.approvalMode !== null) {
    if (b.approvalMode !== 'instant' && b.approvalMode !== 'approval')
      return new ArcError("approvalMode must be 'instant' or 'approval'", 400);
    approvalMode = b.approvalMode;
  }
  const lang = typeof b.lang === 'string' && LANG_RE.test(b.lang) ? b.lang : 'en';
  return { manuscriptId: b.manuscriptId, launchDate: launchDate!, closesAt: closes.toISOString(), tz, maxClaims, approvalMode, lang };
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The blurb a build keeps: meta.description, else coverRecipe.wrap.blurb
 *  (ruling F5), else ''; trimmed, at most ARC_BLURB_MAX code points. */
export function blurbOf(doc: unknown): string {
  const d = rec(doc);
  const pick = [rec(d.meta).description, rec(rec(d.coverRecipe).wrap).blurb]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find((v) => v.length > 0);
  // Counted in code points so a cut never splits a surrogate pair (decided by this task).
  return pick ? [...pick].slice(0, ARC_BLURB_MAX).join('').trim() : '';
}

/** The cover a build keeps: the (hydrated) doc's cover as { mediaType, data }
 *  when it is a JPEG, PNG, GIF or WebP picture, else null. */
export function coverOf(doc: unknown): { mediaType: string; data: string } | null {
  const cover = rec(rec(doc).cover);
  const mediaType = typeof cover.mediaType === 'string' ? cover.mediaType.toLowerCase() : '';
  // Decided by this task: a cover without data (or still a beuk-pic ref) is no cover.
  if (!COVER_TYPES.test(mediaType) || typeof cover.data !== 'string' || !cover.data || cover.data.startsWith('beuk-pic:')) return null;
  return { mediaType, data: cover.data };
}

/** The build's file name with '-arc' before '.epub'. */
function arcFilename(name: string): string {
  const base = name.replace(/\.epub$/i, '');
  return `${base || 'book'}-arc.epub`;
}

export function signupUrl(config: Config, token: string): string {
  return `${config.appBaseUrl}/arc/${token}`;
}

export async function isCampaignShare(db: Db, shareId: string): Promise<boolean> {
  if (!isUuid(shareId)) return false;
  const r = await db.query('select 1 from arc_campaigns where share_id = $1', [shareId]);
  return r.rows.length > 0;
}

/** This writer's campaign for a book: the running one, else the newest. */
export async function campaignForManuscript(deps: ArcDeps, userId: string, manuscriptId: string): Promise<CampaignJson | null> {
  if (!isUuid(manuscriptId)) return null;
  const r = await deps.db.query<Record<string, unknown>>(
    `select ${CAMPAIGN_COLS} from arc_campaigns c
     where c.manuscript_id = $1 and c.owner_id = $2
     order by (c.ended_at is null) desc, c.created_at desc, c.id desc limit 1`,
    [manuscriptId, userId],
  );
  if (!r.rows[0]) return null;
  return campaignJson(deps.db, rowOf(r.rows[0]), deps.now());
}

function isRunningRace(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string } | null;
  if (e?.code !== UNIQUE_VIOLATION) return false;
  return e.constraint === ONE_RUNNING_IDX || String(e.message ?? '').includes(ONE_RUNNING_IDX);
}

const RUNNING = 'This book already has an ARC running. Close it before starting another.';

export async function createCampaign(
  deps: ArcDeps,
  userId: string,
  input: CreateCampaignInput,
  signal?: AbortSignal,
): Promise<{ campaign: CampaignJson; signupToken: string }> {
  const { db, config } = deps;
  const mail = arcMailStatus(config);
  if (!mail.configured)
    throw new ArcError(`ARC email is not set up on this server (${mail.reason}), so a campaign cannot start yet.`, 409, { mail });

  const m = await db.query<{ id: string; title: string; doc: unknown }>(
    'select id, title, doc from manuscripts where id = $1 and user_id = $2',
    [input.manuscriptId, userId],
  );
  const manuscript = m.rows[0];
  if (!manuscript) throw new ArcError('manuscript not found', 404);

  // A campaign past its closing time has ended; it no longer holds the book.
  await db.query(
    `update arc_campaigns set ended_at = closes_at
     where manuscript_id = $1 and owner_id = $2 and ended_at is null and closes_at <= $3`,
    [manuscript.id, userId, deps.now().toISOString()],
  );
  const running = await db.query('select 1 from arc_campaigns where manuscript_id = $1 and ended_at is null', [manuscript.id]);
  if (running.rows.length) throw new ArcError(RUNNING, 409);

  // The doc is read once: the reading copy and the EPUB come from the same words.
  const doc = manuscript.doc;
  const hydrated = await hydrateDoc(db, userId, doc);
  const { snapshot, images } = renderSnapshot(hydrated, manuscript.title);
  const out = await buildEpub(
    db,
    userId,
    { book: doc },
    undefined,
    input.lang,
    { maxBytes: config.epubMaxBytes, timeoutMs: config.jobTimeoutMs, heapMb: config.epubWorkerHeapMb },
    deps.epubQueue,
    signal,
  );
  const cover = coverOf(hydrated);
  const blurb = blurbOf(hydrated);
  const bytes = Buffer.from(out.bytes);
  const token = randomBytes(24).toString('base64url');

  let campaign: CampaignRow;
  try {
    campaign = await db.tx(async (tx) => {
      const share = await tx.query<{ id: string }>(
        `insert into shares (owner_id, manuscript_id, token_hash, title, snapshot, images, expires_at,
           allow_comments, reader_name_required, open_link_closed_at)
         values ($1, $2, null, $3, $4, $5, null, true, true, now())
         returning id`,
        [userId, manuscript.id, snapshot.title, JSON.stringify(snapshot), JSON.stringify(images)],
      );
      const c = await tx.query<Record<string, unknown>>(
        `insert into arc_campaigns as c (share_id, owner_id, manuscript_id, signup_token_hash, max_claims,
           approval_mode, launch_date, closes_at, tz)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${CAMPAIGN_COLS}`,
        [
          share.rows[0].id,
          userId,
          manuscript.id,
          tokenHash(token),
          input.maxClaims,
          input.approvalMode,
          input.launchDate,
          input.closesAt,
          input.tz,
        ],
      );
      const row = rowOf(c.rows[0]);
      await tx.query(
        `insert into arc_builds (campaign_id, epub_base64, epub_sha256, epub_bytes, epub_filename, cover, blurb)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          row.id,
          bytes.toString('base64'),
          createHash('sha256').update(bytes).digest('hex'),
          bytes.length,
          arcFilename(out.filename),
          cover ? JSON.stringify(cover) : null,
          blurb,
        ],
      );
      return row;
    });
  } catch (err) {
    // Two starts for one book at once: the index lets exactly one through.
    if (isRunningRace(err)) throw new ArcError(RUNNING, 409);
    // Decided by this task: the book was deleted while its EPUB was building.
    if ((err as { code?: string } | null)?.code === FK_VIOLATION) throw new ArcError('manuscript not found', 404);
    throw err;
  }
  return { campaign: await campaignJson(db, campaign, deps.now()), signupToken: token };
}
