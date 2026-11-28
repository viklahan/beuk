import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tokenHash } from '../auth.js';
import { buildEpub } from '../book/epub/build.js';
import type { EpubQueue } from '../book/epub/queue.js';
import { isIsoDate, type Config } from '../config.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';
import type { Mailer } from '../mailer.js';
import { hydrateDoc } from '../pictures.js';
import { renderSnapshot } from '../shares/render.js';
import { arcApprovedEmail, arcDeclinedEmail, type ArcMailContext } from './emails.js';
import { arcMailStatus, arcMailToken, arcSignupToken, sendArcMail, suppressionOf, type ArcSendOutcome } from './mail.js';
import { arcLang, arcT } from './strings.js';

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
 * The signup token is derived (arcSignupToken: the HMAC of the campaign id
 * and signup_rotation, final review Important 3), so the owner can be shown
 * it again (GET /api/arc, signupLinkOf); only tokenHash(token) is stored.
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
  /** The signup link's generation: its token is arcSignupToken(id, rotation). */
  signup_rotation: number;
  signup_token_hash: string;
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
  // unverified rows are never counted or shown; build.holders: claimed rows whose build_id is this build and
  // whose copy is still open (Task 5: a closed copy is held by no one Beuk still serves)
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
  c.launch_date::text as launch_date, c.closes_at, c.tz, c.author_notified_at, c.created_at, c.ended_at,
  c.signup_rotation, c.signup_token_hash`;

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
    signup_rotation: Number(r.signup_rotation ?? 0),
    signup_token_hash: String(r.signup_token_hash ?? ''),
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
       count(*) filter (where r.status = 'claimed' and r.revoked_at is null and b.id is not null and r.build_id = b.id)::int as holders
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

/** The code page for a code just sent (ruling C6: the code email carries
 *  it, with its ref, so the address's real owner can enter a code someone
 *  else asked for). */
export function codePageUrl(config: Config, signupToken: string, ref: string): string {
  return `${config.appBaseUrl}/arc/${signupToken}/check?r=${encodeURIComponent(ref)}`;
}

/**
 * The campaign's signup link as the owner sees it, or null: an ended
 * campaign has none; and when the token derived now does not match the
 * stored hash (ARC_SUPPRESSION_SALT changed or is gone since the link was
 * made), the link the server would show is not the one that works, so it
 * shows none and the author makes a new one (rotateSignup).
 */
export function signupLinkOf(config: Config, c: CampaignRow): string | null {
  if (c.ended_at) return null;
  let token: string;
  try {
    token = arcSignupToken(config, c.id, c.signup_rotation);
  } catch {
    return null;
  }
  return tokenHash(token) === c.signup_token_hash ? signupUrl(config, token) : null;
}

/** A reader's copy page (Task 7 serves it). */
export function copyUrl(config: Config, token: string): string {
  return `${config.appBaseUrl}/arc/r/${token}`;
}

/** What the cap counts: waiting and claimed readers (a closed copy still
 *  counts: it was given). Declined and unverified rows never count. */
export function countedClaims(c: { claimed: number; pending: number }): number {
  return c.pending + c.claimed;
}

export async function isCampaignShare(db: Db, shareId: string): Promise<boolean> {
  if (!isUuid(shareId)) return false;
  const r = await db.query('select 1 from arc_campaigns where share_id = $1', [shareId]);
  return r.rows.length > 0;
}

/**
 * Every campaign this writer ran for a book (ruling P8: an ended campaign
 * stays reachable after a new one starts, so the author can always close
 * its copies, decline its waiting readers and delete it): the one not yet
 * ended first, then the newest. `signupUrl` is the link of the one not yet
 * ended (signupLinkOf), or null.
 */
export async function campaignsForManuscript(
  deps: ArcDeps,
  userId: string,
  manuscriptId: string,
): Promise<{ campaigns: CampaignJson[]; signupUrl: string | null }> {
  if (!isUuid(manuscriptId)) return { campaigns: [], signupUrl: null };
  const r = await deps.db.query<Record<string, unknown>>(
    `select ${CAMPAIGN_COLS} from arc_campaigns c
     where c.manuscript_id = $1 and c.owner_id = $2
     order by (c.ended_at is null) desc, c.created_at desc, c.id desc`,
    [manuscriptId, userId],
  );
  const rows = r.rows.map(rowOf);
  const now = deps.now();
  const campaigns: CampaignJson[] = [];
  for (const row of rows) campaigns.push(await campaignJson(deps.db, row, now));
  const running = rows.find((x) => !x.ended_at);
  return { campaigns, signupUrl: running ? signupLinkOf(deps.config, running) : null };
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
  // The id is made here so the signup token can be derived from it (rotation 0).
  const campaignId = randomUUID();
  const token = arcSignupToken(config, campaignId, 0);

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
        `insert into arc_campaigns as c (id, share_id, owner_id, manuscript_id, signup_token_hash, max_claims,
           approval_mode, launch_date, closes_at, tz, signup_rotation)
         values ($10, $1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
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
          campaignId,
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

/* ------------------------------------------------------------------------
 * Managing a campaign (slice 1, Task 5): its readers (approve, decline,
 * revoke), closing it, changing it, a new signup link, deleting it, and the
 * one seam that removes a book's campaigns when the book goes.
 *
 * Every function takes a CampaignRow the caller already loaded for its owner
 * (loadOwnedCampaign); a reader is found only inside that campaign's share,
 * so another campaign's reader is "not found". Unverified rows are never
 * shown, counted or acted on.
 *
 * The cap (ruling F8): a copy is given by ONE conditional UPDATE (mintCopy)
 * whose WHERE counts the other waiting and claimed readers against
 * max_claims; 0 rows means full. The campaign row is also locked
 * (`select … for update`), so on real Postgres two gives for one campaign
 * take turns. (PGlite runs one session, so the lock is not what the tests
 * prove; the statement's condition is.)
 *
 * A closed copy (revoked_at, "Close this copy") is never reopened here:
 * nothing in this file clears revoked_at, and mintCopy refuses a revoked
 * reader (ruling F9).
 * --------------------------------------------------------------------- */

export interface ArcReaderJson {
  id: string;
  name: string;
  email: string;
  status: 'pending' | 'claimed' | 'declined';
  /** The reader number the copy carries in its OPF (the stamp), so the
   *  author can tell whose copy a file came from (content/legal/privacy.md).
   *  Kept across a new link (mintCopy); null until a copy is given. */
  publicId: string | null;
  profileLink: string | null;
  claimedAt: string | null;
  revokedAt: string | null;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  mailStopped: boolean;
}

const READER_COLS = `r.id, r.name, r.email, r.status, r.public_id, r.profile_link, r.claimed_at, r.revoked_at,
  r.first_opened_at, r.last_opened_at, r.mail_stopped_at`;

const SHOWN_STATUSES: readonly ArcReaderJson['status'][] = ['pending', 'claimed', 'declined'];

/** A row the author may see as JSON. Every caller selects only the shown
 *  statuses, so any other status is a bug, and it throws rather than pass
 *  for 'pending' (final review, minor). */
export function readerOf(r: Record<string, unknown>): ArcReaderJson {
  const status = r.status as ArcReaderJson['status'];
  if (!SHOWN_STATUSES.includes(status)) throw new Error(`arc: a reader row with status ${String(r.status)} reached readerOf`);
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    status,
    publicId: r.public_id == null ? null : String(r.public_id),
    profileLink: r.profile_link == null ? null : String(r.profile_link),
    claimedAt: iso(r.claimed_at),
    revokedAt: iso(r.revoked_at),
    firstOpenedAt: iso(r.first_opened_at),
    lastOpenedAt: iso(r.last_opened_at),
    mailStopped: r.mail_stopped_at != null,
  };
}

const READER_NOT_FOUND = 'reader not found';
const FULL = 'Every copy is taken: this campaign is at its cap. Raise the cap to approve another reader.';
const REVOKED = "This reader's copy was closed, and a closed copy is never reopened.";

/** This writer's campaign by id, or null (another writer's, or no such id). */
export async function loadOwnedCampaign(db: Db, userId: string, id: string): Promise<CampaignRow | null> {
  if (!isUuid(id)) return null;
  const r = await db.query<Record<string, unknown>>(`select ${CAMPAIGN_COLS} from arc_campaigns c where c.id = $1 and c.owner_id = $2`, [
    id,
    userId,
  ]);
  return r.rows[0] ? rowOf(r.rows[0]) : null;
}

/** The readers the author sees: waiting, claimed and declined, oldest first. */
export async function listReaders(db: Db, campaign: CampaignRow): Promise<ArcReaderJson[]> {
  const r = await db.query<Record<string, unknown>>(
    `select ${READER_COLS} from share_recipients r
     where r.share_id = $1 and r.role = 'arc' and r.status in ('pending', 'claimed', 'declined')
     order by r.created_at, r.id`,
    [campaign.share_id],
  );
  return r.rows.map(readerOf);
}

/** One reader of this campaign that the author can see, or null. */
async function loadReader(db: Db, c: CampaignRow, readerId: string): Promise<ArcReaderJson | null> {
  if (!isUuid(readerId)) return null;
  const r = await db.query<Record<string, unknown>>(
    `select ${READER_COLS} from share_recipients r
     where r.id = $1 and r.share_id = $2 and r.role = 'arc' and r.status in ('pending', 'claimed', 'declined')`,
    [readerId, c.share_id],
  );
  return r.rows[0] ? readerOf(r.rows[0]) : null;
}

async function mustLoadReader(db: Db, c: CampaignRow, readerId: string): Promise<ArcReaderJson> {
  const reader = await loadReader(db, c, readerId);
  if (!reader) throw new ArcError(READER_NOT_FOUND, 404);
  return reader;
}

/** Lock the campaign row for the rest of the transaction and read it fresh. */
async function lockCampaign(tx: Db, id: string): Promise<CampaignRow> {
  const r = await tx.query<Record<string, unknown>>(`select ${CAMPAIGN_COLS} from arc_campaigns c where c.id = $1 for update`, [id]);
  if (!r.rows[0]) throw new ArcError('campaign not found', 404);
  return rowOf(r.rows[0]);
}

/** The cap's condition (ruling F8), for an UPDATE of share_recipients r
 *  joined to its arc_campaigns c: the campaign's OTHER waiting and claimed
 *  readers are fewer than max_claims. mintCopy and waitForApproval share
 *  it, so every path that counts against the cap is the same statement. */
const CAP_HAS_ROOM = `(select count(*) from share_recipients x
            where x.share_id = c.share_id and x.role = 'arc' and x.status in ('pending', 'claimed') and x.id <> r.id) < c.max_claims`;

/**
 * Give a reader their copy: status 'claimed', claimed_at, build_id = the
 * campaign's newest build, a public_id (12 random bytes, base64url) and a
 * fresh link (token_hash = tokenHash(token)); returns the token, which goes
 * only into the reader's email or redirect. A reader who already holds a
 * copy gets a new link and the old one stops, but keeps their reader number
 * and their first claim time (final review, Important 2: the number the
 * author sees is the one in every file the reader downloaded).
 *
 * ONE conditional UPDATE (ruling F8): it gives the copy only while the
 * campaign's other waiting and claimed readers are fewer than max_claims,
 * and never to a reader whose copy was closed (F9). 0 rows → an ArcError:
 * 404 when the reader is not this campaign's, 409 when the copy was closed,
 * else 409 full. The campaign row is locked first (a no-op when the caller
 * already holds it). The caller checks the reader's status and the
 * campaign's state under the same lock.
 */
export async function mintCopy(tx: Db, campaignId: string, readerId: string, now: Date): Promise<string> {
  await tx.query('select id from arc_campaigns where id = $1 for update', [campaignId]);
  const token = randomBytes(24).toString('base64url');
  const r = await tx.query(
    `update share_recipients r set
       status = 'claimed',
       claimed_at = coalesce(r.claimed_at, $3),
       token_hash = $4,
       public_id = coalesce(r.public_id, $5),
       build_id = (select b.id from arc_builds b where b.campaign_id = c.id order by b.version_no desc limit 1)
     from arc_campaigns c
     where c.id = $1 and r.id = $2 and r.share_id = c.share_id and r.role = 'arc' and r.revoked_at is null
       and ${CAP_HAS_ROOM}
     returning r.id`,
    [campaignId, readerId, now.toISOString(), tokenHash(token), randomBytes(12).toString('base64url')],
  );
  if (r.rows.length) return token;
  const why = await tx.query<{ revoked_at: unknown }>(
    `select r.revoked_at from share_recipients r join arc_campaigns c on c.share_id = r.share_id
     where c.id = $1 and r.id = $2 and r.role = 'arc'`,
    [campaignId, readerId],
  );
  if (!why.rows[0]) throw new ArcError(READER_NOT_FOUND, 404);
  if (why.rows[0].revoked_at != null) throw new ArcError(REVOKED, 409, { revoked: true });
  throw new ArcError(FULL, 409, { full: true });
}

/**
 * Approval mode (Task 6): a verified reader starts waiting — status
 * 'pending', which counts against the cap (countedClaims) though no copy is
 * given yet. The same one conditional UPDATE as mintCopy (CAP_HAS_ROOM,
 * ruling F8), and only from 'unverified' and never for a closed copy (F9).
 * Locks the campaign row first, as mintCopy does. False: no room (or the
 * row is no longer an unverified reader of this campaign).
 */
export async function waitForApproval(tx: Db, campaignId: string, readerId: string): Promise<boolean> {
  await tx.query('select id from arc_campaigns where id = $1 for update', [campaignId]);
  const r = await tx.query(
    `update share_recipients r set status = 'pending'
     from arc_campaigns c
     where c.id = $1 and r.id = $2 and r.share_id = c.share_id and r.role = 'arc' and r.status = 'unverified'
       and r.revoked_at is null and ${CAP_HAS_ROOM}
     returning r.id`,
    [campaignId, readerId],
  );
  return r.rows.length > 0;
}

/** The reader email's title, author and language, from the campaign's
 *  frozen copy (as the claim page reads them, Task 6). */
async function mailContext(db: Db, c: CampaignRow, readerId: string, config: Config): Promise<ArcMailContext> {
  const r = await db.query<{ title: string; author: string | null; language: string | null }>(
    `select s.title, s.snapshot->>'author' as author, s.snapshot->>'language' as language from shares s where s.id = $1`,
    [c.share_id],
  );
  const lang = arcLang(r.rows[0]?.language ?? '');
  const author = (r.rows[0]?.author ?? '').trim() || arcT(lang)('arc.theAuthor');
  return { lang, title: r.rows[0]?.title ?? '', author, mailToken: arcMailToken(config, readerId) };
}

/** Why ARC mail cannot go from this server, or null when it can. */
function mailOff(deps: ArcDeps): Extract<ArcSendOutcome, { sent: false }> | null {
  const status = arcMailStatus(deps.config);
  if (!status.configured) return { sent: false, reason: 'not-configured', detail: status.reason ?? 'ARC mail is not configured' };
  if (!deps.arcMailer) return { sent: false, reason: 'not-configured', detail: 'no ARC mailer' };
  return null;
}

const toOf = (c: CampaignRow, reader: ArcReaderJson, mailToken: string) => ({
  campaignId: c.id,
  ownerId: c.owner_id,
  recipientId: reader.id,
  email: reader.email,
  mailToken,
});

/** The refusal when the reader opted out (controller ruling I5): an
 *  approval that cannot be emailed is no approval. `error` is a code for
 *  the panel (its own strings live in the studio's packs, Task 8);
 *  `message` is the server's English. */
const SUPPRESSED_WORDS = {
  owner: 'This reader asked for no more email from you. Decline them instead.',
  all: 'This reader asked Beuk for no email from any author. Decline them instead.',
} as const;
function suppressedRefusal(scope: 'owner' | 'all'): ArcError {
  return new ArcError(SUPPRESSED_WORDS[scope], 409, { error: 'reader-suppressed', message: SUPPRESSED_WORDS[scope], scope });
}

function notApprovable(status: ArcReaderJson['status']): ArcError {
  if (status === 'claimed') return new ArcError('This reader already has a copy.', 409);
  return new ArcError('This reader was declined, and a decline is final.', 409);
}

/**
 * Approve a waiting reader (approval mode). Under the campaign row lock: the
 * reader must still be waiting and the campaign open (decided by this task:
 * after the close date, or once the author closed it, no new copy is given
 * — as a claim is refused then; a waiting reader can still be declined);
 * then mintCopy, committed. Then the 'approved' email with the copy link.
 *
 * When that email cannot go (not configured, over a send limit, refused by
 * the mail server) the approval is released — the row goes back to
 * 'pending' with no link, public id, build or claim time — and an ArcError
 * says why: 503, or 429 when rate-limited (the trial-mail pattern: mark
 * first, release when the server refuses, src/trial-mail.ts). A reader who
 * asked for no more email — "Stop" for this author or "Not me" for all of
 * Beuk — is refused (409 `reader-suppressed`, controller ruling I5): checked
 * before anything is marked, and again by sendArcMail, whose 'suppressed'
 * (an opt-out that landed in between) is released like a refused send.
 * ARC mail switched off is refused before anything is marked (the email
 * could not even be built without the salt).
 */
export async function approveReader(deps: ArcDeps, c: CampaignRow, readerId: string): Promise<{ reader: ArcReaderJson; mail: ArcSendOutcome }> {
  const { db, config } = deps;
  const reader = await mustLoadReader(db, c, readerId);
  const off = mailOff(deps);
  if (off) {
    throw new ArcError(`ARC email is not set up on this server (${off.detail}), so this reader was not approved.`, 503, { mail: off });
  }
  const opted = await suppressionOf(db, config, reader.email, c.owner_id);
  if (opted) throw suppressedRefusal(opted);
  const token = await db.tx(async (tx) => {
    const fresh = await lockCampaign(tx, c.id);
    const cur = await mustLoadReader(tx, fresh, readerId);
    if (cur.status !== 'pending') throw notApprovable(cur.status);
    if (cur.revokedAt) throw new ArcError(REVOKED, 409, { revoked: true });
    if (campaignState(fresh, deps.now()) !== 'open')
      throw new ArcError('This ARC is closed to new readers, so no new copy can be given. You can still decline.', 409);
    return mintCopy(tx, fresh.id, readerId, deps.now());
  });

  const release = () =>
    db.query(
      `update share_recipients set status = 'pending', token_hash = null, public_id = null, build_id = null, claimed_at = null
       where id = $1 and status = 'claimed' and token_hash = $2`,
      [readerId, tokenHash(token)],
    );
  let mail: ArcSendOutcome;
  try {
    const ctx = await mailContext(db, c, readerId, config);
    mail = await sendArcMail(deps, toOf(c, reader, ctx.mailToken), 'approved', arcApprovedEmail(config, ctx, copyUrl(config, token)));
  } catch (err) {
    await release();
    throw err;
  }
  if (!mail.sent && mail.reason === 'suppressed') {
    await release();
    throw suppressedRefusal((await suppressionOf(db, config, reader.email, c.owner_id)) ?? 'owner');
  }
  if (!mail.sent) {
    await release();
    const limited = mail.reason === 'rate-limited';
    throw new ArcError(
      limited
        ? `This reader was not approved: ARC email is over a sending limit (${mail.detail}). Nothing changed; try again later.`
        : `This reader was not approved, because the approval email could not be sent (${mail.detail}). Nothing changed; try again later.`,
      limited ? 429 : 503,
      { mail },
    );
  }
  return { reader: await mustLoadReader(db, c, readerId), mail };
}

/** Decline a waiting reader: status 'declined', then the 'declined' email.
 *  A decline is never undone, whatever happens to the email; the outcome
 *  says whether it went. */
export async function declineReader(deps: ArcDeps, c: CampaignRow, readerId: string): Promise<{ reader: ArcReaderJson; mail: ArcSendOutcome }> {
  const { db, config } = deps;
  const reader = await mustLoadReader(db, c, readerId);
  await db.tx(async (tx) => {
    await lockCampaign(tx, c.id);
    const r = await tx.query(
      `update share_recipients set status = 'declined' where id = $1 and share_id = $2 and role = 'arc' and status = 'pending' returning id`,
      [readerId, c.share_id],
    );
    if (r.rows.length) return;
    const cur = await mustLoadReader(tx, c, readerId);
    if (cur.status === 'claimed') throw new ArcError('This reader already has a copy. Close the copy instead.', 409);
    throw new ArcError('This reader was already declined.', 409);
  });
  // The decline is committed: a failure from here on is reported in `mail`,
  // never as a 500 that would read as "nothing happened".
  let mail: ArcSendOutcome | null = mailOff(deps);
  if (!mail) {
    try {
      const ctx = await mailContext(db, c, readerId, config);
      mail = await sendArcMail(deps, toOf(c, reader, ctx.mailToken), 'declined', arcDeclinedEmail(config, ctx));
    } catch (err) {
      mail = { sent: false, reason: 'refused', detail: `the decline email could not be sent: ${(err as Error)?.message ?? String(err)}` };
    }
  }
  return { reader: await mustLoadReader(db, c, readerId), mail };
}

/** "Close this copy" (ruling F13): revoked_at on a reader who holds a copy;
 *  their link answers 410 from then on. No mail. Closing it again keeps the
 *  first time. (`now` is an addition to the plan's signature, for the
 *  injected clock; it defaults to the wall clock.) */
export async function revokeReader(db: Db, c: CampaignRow, readerId: string, now: Date = new Date()): Promise<ArcReaderJson> {
  const reader = await mustLoadReader(db, c, readerId);
  const r = await db.query(
    `update share_recipients set revoked_at = coalesce(revoked_at, $3) where id = $1 and share_id = $2 and role = 'arc' and status = 'claimed' returning id`,
    [readerId, c.share_id, now.toISOString()],
  );
  if (!r.rows.length) {
    throw new ArcError(
      reader.status === 'declined' ? 'This reader was declined and has no copy to close.' : 'This reader has no copy yet, so there is nothing to close.',
      409,
    );
  }
  return mustLoadReader(db, c, readerId);
}

/** End the campaign: no more sign-ups or copies. Copies already given keep
 *  working (ruling F13), and the book can start its next campaign (F10:
 *  the one-running index only holds rows with ended_at null). */
export async function closeCampaign(db: Db, c: CampaignRow, now: Date): Promise<CampaignRow> {
  const r = await db.query<Record<string, unknown>>(
    `update arc_campaigns c set ended_at = coalesce(c.ended_at, $2) where c.id = $1 returning ${CAMPAIGN_COLS}`,
    [c.id, now.toISOString()],
  );
  if (!r.rows[0]) throw new ArcError('campaign not found', 404);
  return rowOf(r.rows[0]);
}

const ENDED = 'This ARC has ended, so it cannot be changed. Start a new one for this book instead.';

/** PUT /api/arc/:id's body, checked: maxClaims 1-50 and/or closesAt (an
 *  instant with its offset, in the future, at most ARC_MAX_CLOSE_DAYS
 *  ahead, as at the start). Every refusal is a 400 with words. */
export function parseUpdateInput(body: unknown, now: Date): { maxClaims?: number; closesAt?: string } | ArcError {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new ArcError('send the change as a JSON object', 400);
  const b = body as Record<string, unknown>;
  const patch: { maxClaims?: number; closesAt?: string } = {};
  if (b.maxClaims !== undefined) {
    if (typeof b.maxClaims !== 'number' || !Number.isInteger(b.maxClaims) || b.maxClaims < 1 || b.maxClaims > ARC_MAX_CLAIMS)
      return new ArcError(`maxClaims must be a whole number from 1 to ${ARC_MAX_CLAIMS}`, 400);
    patch.maxClaims = b.maxClaims;
  }
  if (b.closesAt !== undefined) {
    const raw = typeof b.closesAt === 'string' ? b.closesAt : '';
    const closes = INSTANT_RE.test(raw) ? new Date(raw) : null;
    if (!closes || Number.isNaN(closes.getTime()))
      return new ArcError('closesAt must be a date and time with its offset, such as 2027-02-14T00:00:00Z', 400);
    if (closes.getTime() <= now.getTime()) return new ArcError('closesAt must be in the future', 400);
    if (closes.getTime() > now.getTime() + ARC_MAX_CLOSE_DAYS * DAY_MS)
      return new ArcError(`closesAt can be at most ${ARC_MAX_CLOSE_DAYS} days from now`, 400);
    patch.closesAt = closes.toISOString();
  }
  if (patch.maxClaims === undefined && patch.closesAt === undefined)
    return new ArcError('nothing to change: send maxClaims, closesAt or both', 400);
  return patch;
}

/** Change the cap and/or the close date of a campaign that has not ended
 *  (409 once ended). The cap never goes below what is already counted
 *  (countedClaims: waiting + claimed) — 400 with words. Under the row lock. */
export async function updateCampaign(
  db: Db,
  c: CampaignRow,
  patch: { maxClaims?: number; closesAt?: string },
  now: Date,
): Promise<CampaignRow> {
  if (patch.closesAt !== undefined && new Date(patch.closesAt).getTime() <= now.getTime())
    throw new ArcError('closesAt must be in the future', 400);
  return db.tx(async (tx) => {
    const fresh = await lockCampaign(tx, c.id);
    if (fresh.ended_at) throw new ArcError(ENDED, 409);
    if (patch.maxClaims !== undefined) {
      const n = await tx.query<{ claimed: number; pending: number }>(
        `select count(*) filter (where status = 'claimed')::int as claimed, count(*) filter (where status = 'pending')::int as pending
         from share_recipients where share_id = $1 and role = 'arc'`,
        [fresh.share_id],
      );
      const counted = countedClaims({ claimed: Number(n.rows[0]?.claimed ?? 0), pending: Number(n.rows[0]?.pending ?? 0) });
      if (patch.maxClaims < counted)
        throw new ArcError(`The cap cannot go below the ${counted} readers already counted (waiting or given a copy).`, 400, { counted });
    }
    const r = await tx.query<Record<string, unknown>>(
      `update arc_campaigns c set max_claims = coalesce($2, c.max_claims), closes_at = coalesce($3::timestamptz, c.closes_at)
       where c.id = $1 returning ${CAMPAIGN_COLS}`,
      [fresh.id, patch.maxClaims ?? null, patch.closesAt ?? null],
    );
    return rowOf(r.rows[0]);
  });
}

/** A new signup link: signup_rotation goes up by one, so the old link
 *  stops at once. Refused (409) once the campaign has ended. Returns the
 *  new token; only its hash is stored (it can be derived again, signupLinkOf). */
export async function rotateSignup(db: Db, config: Config, c: CampaignRow): Promise<string> {
  // The token is derived with the salt: without ARC mail there is none to make.
  const mail = arcMailStatus(config);
  if (!mail.configured)
    throw new ArcError(`ARC email is not set up on this server (${mail.reason}), so no signup link can be made.`, 409, { mail });
  return db.tx(async (tx) => {
    const fresh = await lockCampaign(tx, c.id);
    if (fresh.ended_at) throw new ArcError('This ARC has ended, so it has no signup link to replace.', 409);
    const next = fresh.signup_rotation + 1;
    const token = arcSignupToken(config, fresh.id, next);
    await tx.query('update arc_campaigns set signup_rotation = $2, signup_token_hash = $3 where id = $1', [fresh.id, next, tokenHash(token)]);
    return token;
  });
}

/** Delete the campaign: its share goes, and with it (on delete cascade) the
 *  campaign row, its builds and events, its readers and their comments. The
 *  opt-out hashes (mail_suppressions) are not tied to it and stay. */
export async function deleteCampaign(db: Db, c: CampaignRow): Promise<void> {
  await db.query('delete from shares where id = $1 and owner_id = $2', [c.share_id, c.owner_id]);
}

/**
 * The one seam that removes a book's ARC campaigns (their shares, readers,
 * builds and events, by cascade). Call it inside the transaction that
 * deletes the manuscript: arc_campaigns.manuscript_id is ON DELETE RESTRICT
 * (migration 031), so a book with a campaign cannot go any other way, and no
 * reader's address outlives the book. Returns how many campaigns went.
 */
export async function deleteArcForManuscript(tx: Db, userId: string, manuscriptId: string): Promise<number> {
  const r = await tx.query(
    `delete from shares where id in (select share_id from arc_campaigns where manuscript_id = $1 and owner_id = $2) returning id`,
    [manuscriptId, userId],
  );
  return r.rows.length;
}
