import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { tokenHash } from '../auth.js';
import type { Db } from '../db.js';
import type { SlidingWindowLimiter } from '../rate-limit.js';
import { cleanRecipientName } from '../routes/shares.js';
import {
  ArcError,
  CAMPAIGN_COLS,
  campaignState,
  codePageUrl,
  countedClaims,
  copyUrl,
  mintCopy,
  rowOf,
  waitForApproval,
  type ArcDeps,
  type CampaignRow,
} from './campaigns.js';
import { arcAuthorWaitingEmail, arcCodeEmail, arcPendingEmail, arcReadyEmail, type ArcMailContext } from './emails.js';
import { arcMailStatus, arcMailToken, arcMailTokenHash, normalizeEmail, sendArcMail, suppressionHash, suppressionOf, type ArcSendOutcome } from './mail.js';
import { arcLang, arcT, type ArcLang } from './strings.js';

/**
 * ARC campaigns: claiming a copy on the public, unlisted claim page (slice 1,
 * Task 6). A stranger with the signup link gives a name and an email
 * (approval mode: also a profile link); Beuk emails a 6-digit code; the
 * right code confirms the address, and only then does the claim count.
 *
 *   startClaim  — checks, then an 'unverified' row (or the address's
 *                 existing row) gets a fresh code, which is emailed.
 *   verifyClaim — the code; then, under the campaign row lock, instant mode
 *                 gives the copy (mintCopy) and approval mode starts the
 *                 wait (waitForApproval). Both are ONE conditional UPDATE
 *                 against max_claims (ruling F8): two right codes for the
 *                 last copy cannot both win.
 *   purgeArcUnverified — unverified rows untouched for 24 hours go.
 *
 * Only hashes are stored: the code (tokenHash(rowId + ':' + code)), the
 * code page's ref, the copy link. The per-address limit is keyed by the
 * address's suppression hash, so no raw address is kept in memory.
 *
 * Inside the transaction nothing is thrown for an expected refusal (closed,
 * full, answered): the outcome is returned and the transaction commits. On
 * PGlite (one session for every test transaction) a rollback would also
 * undo a concurrent claim's work; on Postgres it is simply cleaner.
 */

export const ARC_CLAIM_RULES = {
  codeTtlMs: 30 * 60_000,
  unverifiedTtlMs: 24 * 3_600_000,
  codeAttempts: 5,
  codesPerRow: 5,
  unverifiedPerCampaign: 100,
};

export interface Win {
  max: number;
  windowMs: number;
}

export interface ArcPublicLimits {
  claimPerIp: Win;
  checkPerIp: Win;
  codesPerAddress: Win;
  downloadsPerReader: Win;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const DEFAULT_ARC_PUBLIC_LIMITS: ArcPublicLimits = {
  claimPerIp: { max: 10, windowMs: 10 * MIN },
  checkPerIp: { max: 30, windowMs: 10 * MIN },
  codesPerAddress: { max: 3, windowMs: HOUR },
  downloadsPerReader: { max: 10, windowMs: HOUR },
};

/** The profile link's longest form (the plan's number). */
export const PROFILE_LINK_MAX = 300;

/** Bidi embedding/override/isolate controls (U+202A–U+202E, U+2066–U+2069):
 *  in a name or an address they can reorder what an email or a page shows
 *  (Task 2 review), so a claim carrying one is refused. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/;

export interface SignupView {
  campaign: CampaignRow;
  title: string;
  author: string;
  lang: ArcLang;
  blurb: string;
  hasCover: boolean;
  ownerEmail: string;
  /** The signup token in the link (for the code page's link in the code
   *  email, ruling C6). */
  signupToken: string;
}

/** As src/routes/shares.ts TOKEN_RE: a signup token is 20-64 base64url
 *  characters (Beuk makes 32), so /arc/r/… and /arc/m/… never match. */
export const SIGNUP_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const REF_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** The campaign behind a signup link, with what its claim page shows (the
 *  frozen copy's title, author and language; the newest build's blurb and
 *  whether it has a cover), or null. {author} falls back to arc.theAuthor. */
export async function loadSignup(db: Db, token: string): Promise<SignupView | null> {
  if (typeof token !== 'string' || !SIGNUP_TOKEN_RE.test(token)) return null;
  const r = await db.query<Record<string, unknown>>(
    `select ${CAMPAIGN_COLS}, s.title as share_title, s.snapshot->>'author' as author, s.snapshot->>'language' as language,
       b.blurb, (b.cover is not null) as has_cover, u.email as owner_email
     from arc_campaigns c
     join shares s on s.id = c.share_id
     join users u on u.id = c.owner_id
     left join lateral (
       select blurb, cover from arc_builds where campaign_id = c.id order by version_no desc limit 1
     ) b on true
     where c.signup_token_hash = $1`,
    [tokenHash(token)],
  );
  const x = r.rows[0];
  if (!x) return null;
  const lang = arcLang(String(x.language ?? ''));
  const author = String(x.author ?? '').trim() || arcT(lang)('arc.theAuthor');
  return {
    campaign: rowOf(x),
    title: String(x.share_title ?? ''),
    author,
    lang,
    blurb: String(x.blurb ?? ''),
    hasCover: x.has_cover === true,
    ownerEmail: String(x.owner_email ?? ''),
    signupToken: token,
  };
}

export type StartOutcome =
  | { kind: 'sent'; ref: string }
  | {
      kind: 'refused';
      // Additions to the plan's list (fix round 1): 'mail-failed' — the
      // code email did not go for a reason that is not the reader's (the mail
      // server refused it or threw, or the campaign/author send limit);
      // 'signups-busy' — the campaign holds unverifiedPerCampaign
      // unconfirmed claims. 'busy' is only ever the reader's own limits. A
      // closed copy (F9) is told as 'answered', the same words as a decline,
      // so the page reveals no more about an address than the spec allows.
      reason:
        | 'closed' | 'full' | 'blocked' | 'mail-off' | 'mail-failed' | 'signups-busy' | 'busy'
        | 'bad-name' | 'bad-email' | 'bad-profile' | 'answered';
    };

export type VerifyOutcome =
  | { kind: 'claimed'; token: string }
  // name: for the waiting page (an addition to the plan's shape).
  | { kind: 'pending'; name: string }
  // 'answered' is an addition: the author declined, or closed the copy,
  // between the claim and the code (one wording for both, fix round 1).
  | { kind: 'refused'; reason: 'wrong' | 'expired' | 'closed' | 'full' | 'unknown' | 'answered' };

export interface ClaimInput {
  name: unknown;
  email: unknown;
  profile: unknown;
  tz: unknown;
  /** The honeypot (ruling F12): a field people never see or fill. */
  website: unknown;
}

/** A name for the claim: as a named reading link's (cleanRecipientName:
 *  NFC, trimmed, 1-60 code points, no control characters), and no bidi
 *  controls. Null = refused. */
export function cleanClaimName(v: unknown): string | null {
  const name = cleanRecipientName(v);
  if (name === null || BIDI_CONTROLS.test(name)) return null;
  return name;
}

/** An address for the claim: normalizeEmail, and no bidi controls. */
export function cleanClaimEmail(v: unknown): string | null {
  const email = normalizeEmail(v);
  if (email === null || BIDI_CONTROLS.test(email)) return null;
  return email;
}

/** A profile link: http: or https:, at most PROFILE_LINK_MAX characters,
 *  no whitespace, control or bidi characters inside; kept as typed (only
 *  the surrounding spaces of the form field trimmed), never fetched. */
export function cleanProfileLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const link = v.trim();
  if (!link || link.length > PROFILE_LINK_MAX) return null;
  if (/[\s\p{Cc}]/u.test(link) || BIDI_CONTROLS.test(link)) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return link;
}

function cleanTz(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > 100) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

function arcMailOff(deps: ArcDeps): boolean {
  return !arcMailStatus(deps.config).configured || !deps.arcMailer;
}

function mailContext(deps: ArcDeps, s: SignupView, readerId: string): ArcMailContext {
  return { lang: s.lang, title: s.title, author: s.author, mailToken: arcMailToken(deps.config, readerId) };
}

const toOf = (s: SignupView, readerId: string, email: string, mailToken: string) => ({
  campaignId: s.campaign.id,
  ownerId: s.campaign.owner_id,
  recipientId: readerId,
  email,
  mailToken,
});

interface ArcRow {
  id: string;
  name: string;
  email: string;
  status: 'unverified' | 'pending' | 'claimed' | 'declined';
  revoked_at: unknown;
  codes_sent: number;
}

async function rowByEmail(db: Db, shareId: string, email: string): Promise<ArcRow | null> {
  const r = await db.query<ArcRow>(
    `select id, name, email, status, revoked_at, codes_sent from share_recipients
     where share_id = $1 and role = 'arc' and email = $2`,
    [shareId, email],
  );
  return r.rows[0] ?? null;
}

async function countedNow(db: Db, shareId: string): Promise<{ counted: number; unverified: number }> {
  const r = await db.query<{ claimed: number; pending: number; unverified: number }>(
    `select count(*) filter (where status = 'claimed')::int as claimed,
       count(*) filter (where status = 'pending')::int as pending,
       count(*) filter (where status = 'unverified')::int as unverified
     from share_recipients where share_id = $1 and role = 'arc'`,
    [shareId],
  );
  const x = r.rows[0];
  return {
    counted: countedClaims({ claimed: Number(x?.claimed ?? 0), pending: Number(x?.pending ?? 0) }),
    unverified: Number(x?.unverified ?? 0),
  };
}

const UNIQUE_VIOLATION = '23505';

/** Why a send that did not go refuses the claim. None of these is the
 *  reader's doing, so none is 'busy' (fix round 1): the campaign's or the
 *  author's send limit (sendArcMail 'rate-limited') and a refusal by the
 *  mail server are 'mail-failed'. */
function refusalOf(mail: Extract<ArcSendOutcome, { sent: false }>): 'mail-off' | 'blocked' | 'mail-failed' {
  if (mail.reason === 'not-configured') return 'mail-off';
  if (mail.reason === 'suppressed') return 'blocked';
  return 'mail-failed';
}

/** The window codesPerRow counts in (fix round 1): a row's codes_sent
 *  starts again once its last delivered code (arc_events 'code_sent') is
 *  older than this, so nobody can lock a reader out of their link for good.
 *  The per-address limiter (codesPerAddress) stays the guessing budget. */
export const CODES_WINDOW_MS = 24 * HOUR;

/** codes_sent for the row, after starting its window again when no code
 *  was delivered to it within CODES_WINDOW_MS. */
async function codesInWindow(db: Db, rowId: string, now: Date): Promise<number> {
  await db.query(
    `update share_recipients r set codes_sent = 0
     where r.id = $1 and r.codes_sent > 0
       and not exists (select 1 from arc_events e where e.recipient_id = r.id and e.kind = 'code_sent' and e.at > $2)`,
    [rowId, new Date(now.getTime() - CODES_WINDOW_MS).toISOString()],
  );
  const r = await db.query<{ codes_sent: number }>('select codes_sent from share_recipients where id = $1', [rowId]);
  return Number(r.rows[0]?.codes_sent ?? 0);
}

/**
 * Start (or restart) a claim and email its code. In order:
 *   the honeypot → 'sent' with a ref matching no row, nothing stored or sent;
 *   name, email, the profile link (approval mode), tz (kept only when Intl
 *   accepts it); the campaign open (closed, by date or by the author, is
 *   the same refusal for every address: it never depends on who asks; copies
 *   already issued keep working, F13); ARC mail on; the address not suppressed
 *   (Not me, or Stop for this author); the per-address limit; then the
 *   address's existing row — declined or a closed copy → 'answered' (F9,
 *   no mail; one wording), any other is reused — or a new 'unverified'
 *   row; codes_sent under codesPerRow, counted over CODES_WINDOW_MS; a
 *   fresh code and ref, and, for a row still unverified, this claim's name,
 *   profile link and tz (final review Important 1: the name a code confirms
 *   is the name typed with it, so nobody's earlier claim names someone
 *   else's copy; a waiting or claimed reader keeps their name); the 'code'
 *   email, which names that name and carries the code page's link (C6).
 *   When it does not go the code is cleared.
 * A new or still-unverified reader is refused 'full' when the waiting and
 * claimed readers already reach the cap (a courtesy: no code for a copy
 * that cannot be given; the cap itself is enforced at the code).
 */
export async function startClaim(
  deps: ArcDeps,
  s: SignupView,
  input: ClaimInput,
  /** The per-address code limit (codesPerAddress), keyed by the address's
   *  suppression hash. A parameter beside the plan's three (decided by this
   *  task: the limiter lives with the routes' other limiters). */
  codesPerAddress: SlidingWindowLimiter,
): Promise<StartOutcome> {
  const { db, config } = deps;
  if (typeof input.website === 'string' && input.website.trim()) {
    return { kind: 'sent', ref: randomBytes(24).toString('base64url') };
  }
  const c = s.campaign;
  const name = cleanClaimName(input.name);
  if (!name) return { kind: 'refused', reason: 'bad-name' };
  const email = cleanClaimEmail(input.email);
  if (!email) return { kind: 'refused', reason: 'bad-email' };
  let profile: string | null = null;
  if (c.approval_mode === 'approval') {
    profile = cleanProfileLink(input.profile);
    if (!profile) return { kind: 'refused', reason: 'bad-profile' };
  }
  const tz = cleanTz(input.tz);
  const now = deps.now();
  if (campaignState(c, now) !== 'open') return { kind: 'refused', reason: 'closed' };
  if (arcMailOff(deps)) return { kind: 'refused', reason: 'mail-off' };
  if (await suppressionOf(db, config, email, c.owner_id)) return { kind: 'refused', reason: 'blocked' };

  let row = await rowByEmail(db, c.share_id, email);
  if (row?.status === 'declined') return { kind: 'refused', reason: 'answered' };
  if (row && row.revoked_at != null) return { kind: 'refused', reason: 'answered' };
  if (!row || row.status === 'unverified') {
    const n = await countedNow(db, c.share_id);
    // A courtesy only (no code for a copy that cannot be given): the cap is
    // enforced at the code, by CAP_HAS_ROOM in mintCopy / waitForApproval.
    if (n.counted >= c.max_claims) return { kind: 'refused', reason: 'full' };
    if (!row && n.unverified >= ARC_CLAIM_RULES.unverifiedPerCampaign) return { kind: 'refused', reason: 'signups-busy' };
  }
  if (row && (await codesInWindow(db, row.id, now)) >= ARC_CLAIM_RULES.codesPerRow) return { kind: 'refused', reason: 'busy' };

  const key = suppressionHash(config, email);
  const slot = codesPerAddress.reserve(key);
  if (slot === null) return { kind: 'refused', reason: 'busy' };
  const giveBack = () => codesPerAddress.release(key, slot);

  if (!row) {
    const id = randomUUID();
    try {
      await db.query(
        `insert into share_recipients (id, share_id, role, name, email, status, mail_token_hash, profile_link, tz, created_at)
         values ($1, $2, 'arc', $3, $4, 'unverified', $5, $6, $7, $8)`,
        [id, c.share_id, name, email, arcMailTokenHash(config, id), profile, tz, now.toISOString()],
      );
      row = { id, name, email, status: 'unverified', revoked_at: null, codes_sent: 0 };
    } catch (err) {
      // The same address claimed twice at once: the unique index lets one
      // insert through; this claim reuses that row.
      if ((err as { code?: string } | null)?.code !== UNIQUE_VIOLATION) {
        giveBack();
        throw err;
      }
      row = await rowByEmail(db, c.share_id, email);
      if (!row || row.status === 'declined' || row.revoked_at != null) {
        giveBack();
        return { kind: 'refused', reason: row ? 'answered' : 'signups-busy' };
      }
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const ref = randomBytes(24).toString('base64url');
  // An unverified row takes this claim's name, profile link and tz with
  // its new code (Important 1); a waiting or claimed reader keeps theirs.
  const set = await db.query<{ id: string; name: string }>(
    `update share_recipients set verify_code_hash = $2, verify_expires_at = $3, verify_attempts = 0,
       verify_ref_hash = $4, codes_sent = codes_sent + 1,
       name = case when status = 'unverified' then $6::text else name end,
       profile_link = case when status = 'unverified' then $7::text else profile_link end,
       tz = case when status = 'unverified' then $8::text else tz end
     where id = $1 and codes_sent < $5 and status <> 'declined' and revoked_at is null
     returning id, name`,
    [
      row.id,
      tokenHash(`${row.id}:${code}`),
      new Date(now.getTime() + ARC_CLAIM_RULES.codeTtlMs).toISOString(),
      tokenHash(ref),
      ARC_CLAIM_RULES.codesPerRow,
      name,
      profile,
      tz,
    ],
  );
  if (!set.rows.length) {
    giveBack();
    return { kind: 'refused', reason: 'busy' };
  }

  const clear = () =>
    db.query(
      `update share_recipients set verify_code_hash = null, verify_expires_at = null, verify_ref_hash = null,
         codes_sent = greatest(codes_sent - 1, 0)
       where id = $1 and verify_ref_hash = $2`,
      [row!.id, tokenHash(ref)],
    );
  let mail: ArcSendOutcome;
  try {
    const ctx = mailContext(deps, s, row.id);
    const forName = set.rows[0]!.name;
    mail = await sendArcMail(
      deps,
      toOf(s, row.id, email, ctx.mailToken),
      'code',
      arcCodeEmail(config, ctx, code, { name: forName, codePage: codePageUrl(config, s.signupToken, ref) }),
    );
  } catch (err) {
    // A transport that throws: logged; the reader is told to try later.
    console.error('arc: the code email could not be sent', err);
    mail = { sent: false, reason: 'refused', detail: 'the transport threw' };
  }
  if (!mail.sent) {
    await clear();
    giveBack();
    return { kind: 'refused', reason: refusalOf(mail) };
  }
  return { kind: 'sent', ref };
}

/** The row a code page's ref names, in this campaign, or null. */
export async function rowByRef(db: Db, s: SignupView, ref: unknown): Promise<{ id: string; email: string } | null> {
  if (typeof ref !== 'string' || !REF_RE.test(ref)) return null;
  const r = await db.query<{ id: string; email: string }>(
    `select id, email from share_recipients where verify_ref_hash = $1 and share_id = $2 and role = 'arc'`,
    [tokenHash(ref), s.campaign.share_id],
  );
  return r.rows[0] ?? null;
}

type TxResult =
  | { kind: 'claimed'; token: string }
  | { kind: 'pending'; started: boolean; notifyAuthor: { previous: string | null; waiting: number } | null }
  | { kind: 'refused'; reason: 'closed' | 'full' | 'unknown' | 'answered' };

/**
 * Check a code. The attempt is counted first, in one statement (so a burst
 * of guesses cannot all read "0 tries"); an expired code, or one tried
 * codeAttempts times, is 'expired'. The right code clears the code fields
 * (and codes_sent: the address is proven) and sets email_verified_at; then,
 * in one transaction under the campaign row lock:
 *   not open → closed;
 *   declined, or a closed copy (F9) → answered;
 *   claimed → mintCopy again (a new link; the old one stops), 'ready' sent;
 *   pending → pending;
 *   unverified, instant → mintCopy (0 rows → full), 'ready' sent after the
 *     commit (a refused send does not undo: the reader is on their copy);
 *   unverified, approval → waitForApproval (0 rows → full), 'pending' sent,
 *     and the author emailed (account mail) when author_notified_at is null
 *     or older than 24 hours — set first, put back if that email fails.
 */
export async function verifyClaim(deps: ArcDeps, s: SignupView, ref: unknown, code: unknown): Promise<VerifyOutcome> {
  const { db, config } = deps;
  const found = await rowByRef(db, s, ref);
  if (!found) return { kind: 'refused', reason: 'unknown' };
  const now = deps.now();
  const tried = await db.query<{ verify_code_hash: string | null }>(
    `update share_recipients set verify_attempts = verify_attempts + 1
     where id = $1 and verify_code_hash is not null and verify_expires_at > $2 and verify_attempts < $3
     returning verify_code_hash`,
    [found.id, now.toISOString(), ARC_CLAIM_RULES.codeAttempts],
  );
  if (!tried.rows.length) return { kind: 'refused', reason: 'expired' };
  const typed = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(typed) || tokenHash(`${found.id}:${typed}`) !== tried.rows[0].verify_code_hash) {
    return { kind: 'refused', reason: 'wrong' };
  }
  const used = await db.query(
    `update share_recipients set verify_code_hash = null, verify_expires_at = null, verify_ref_hash = null,
       verify_attempts = 0, codes_sent = 0, email_verified_at = $3
     where id = $1 and verify_code_hash = $2
     returning id`,
    [found.id, tried.rows[0].verify_code_hash, now.toISOString()],
  );
  // The same right code sent twice at once: one goes on, the other finds it used.
  if (!used.rows.length) return { kind: 'refused', reason: 'expired' };

  const c = s.campaign;
  const result: TxResult = await db.tx(async (tx): Promise<TxResult> => {
    const locked = await tx.query<Record<string, unknown>>(`select ${CAMPAIGN_COLS} from arc_campaigns c where c.id = $1 for update`, [c.id]);
    if (!locked.rows[0]) return { kind: 'refused', reason: 'closed' };
    const fresh = rowOf(locked.rows[0]);
    if (campaignState(fresh, now) !== 'open') return { kind: 'refused', reason: 'closed' };
    const cur = await tx.query<{ status: ArcRow['status']; revoked_at: unknown }>(
      `select status, revoked_at from share_recipients where id = $1 and share_id = $2 and role = 'arc'`,
      [found.id, fresh.share_id],
    );
    const r = cur.rows[0];
    if (!r) return { kind: 'refused', reason: 'unknown' };
    if (r.status === 'declined') return { kind: 'refused', reason: 'answered' };
    if (r.revoked_at != null) return { kind: 'refused', reason: 'answered' };
    if (r.status === 'pending') return { kind: 'pending', started: false, notifyAuthor: null };
    if (r.status === 'claimed' || fresh.approval_mode === 'instant') {
      try {
        return { kind: 'claimed', token: await mintCopy(tx, fresh.id, found.id, now) };
      } catch (err) {
        if (err instanceof ArcError && err.extra?.revoked) return { kind: 'refused', reason: 'answered' };
        if (err instanceof ArcError && err.extra?.full) return { kind: 'refused', reason: 'full' };
        throw err;
      }
    }
    if (!(await waitForApproval(tx, fresh.id, found.id))) return { kind: 'refused', reason: 'full' };
    // The author hears at most once a day: the time is set first (here, under the lock).
    const mark = await tx.query<{ previous: unknown }>(
      `update arc_campaigns c set author_notified_at = $2
       from (select author_notified_at as previous from arc_campaigns where id = $1) p
       where c.id = $1 and (c.author_notified_at is null or c.author_notified_at <= $3)
       returning p.previous`,
      [fresh.id, now.toISOString(), new Date(now.getTime() - 24 * HOUR).toISOString()],
    );
    if (!mark.rows.length) return { kind: 'pending', started: true, notifyAuthor: null };
    const waiting = await tx.query<{ n: number }>(
      `select count(*)::int as n from share_recipients where share_id = $1 and role = 'arc' and status = 'pending'`,
      [fresh.share_id],
    );
    const prev = mark.rows[0].previous;
    return {
      kind: 'pending',
      started: true,
      notifyAuthor: { previous: prev == null ? null : new Date(prev as string).toISOString(), waiting: Number(waiting.rows[0]?.n ?? 1) },
    };
  });

  if (result.kind === 'refused') return result;
  const ctx = mailContext(deps, s, found.id);
  const to = toOf(s, found.id, found.email, ctx.mailToken);
  const sendQuietly = async (what: string, send: () => Promise<ArcSendOutcome>) => {
    try {
      const out = await send();
      if (!out.sent) console.warn(`arc: the ${what} email was not sent: ${out.detail}`);
    } catch (err) {
      console.error(`arc: the ${what} email could not be sent`, err);
    }
  };
  if (result.kind === 'claimed') {
    // The reader is redirected to their copy either way; the email is the spare key.
    await sendQuietly('ready', () => sendArcMail(deps, to, 'ready', arcReadyEmail(config, ctx, copyUrl(config, result.token))));
    return { kind: 'claimed', token: result.token };
  }
  const name = (await db.query<{ name: string }>('select name from share_recipients where id = $1', [found.id])).rows[0]?.name ?? '';
  // Only the move to waiting sends 'pending'; a reader already waiting who
  // confirms again is shown the waiting page and sent nothing new.
  if (result.started) await sendQuietly('pending', () => sendArcMail(deps, to, 'pending', arcPendingEmail(config, ctx)));
  if (result.notifyAuthor) await tellAuthor(deps, s, result.notifyAuthor);
  return { kind: 'pending', name };
}

/** "A reader is waiting" to the author (account mail). author_notified_at
 *  was set under the lock; it is put back when this email does not go. */
async function tellAuthor(deps: ArcDeps, s: SignupView, notify: { previous: string | null; waiting: number }): Promise<void> {
  const putBack = () =>
    deps.db.query('update arc_campaigns set author_notified_at = $2 where id = $1', [s.campaign.id, notify.previous]);
  try {
    const mail = arcAuthorWaitingEmail(deps.config, s.title, notify.waiting);
    // email-kind: arc-author-waiting (account mail, to the author, at most once a day)
    const out = await deps.mailer.send({ to: s.ownerEmail, subject: mail.subject, text: mail.text, html: mail.html });
    if (!out.delivered) await putBack();
  } catch (err) {
    console.error('arc: the author email could not be sent', err);
    await putBack();
  }
}

/** Unverified claims untouched for 24 hours (unverifiedTtlMs) — the later
 *  of their creation and their newest code's expiry (final review minor 2:
 *  a row asked again today keeps its live code) — and nothing else:
 *  waiting, claimed and declined readers and beta links stay. */
export async function purgeArcUnverified(db: Db, now: Date): Promise<number> {
  const r = await db.query(
    `delete from share_recipients where role = 'arc' and status = 'unverified'
       and greatest(created_at, verify_expires_at) < $1 returning id`,
    [new Date(now.getTime() - ARC_CLAIM_RULES.unverifiedTtlMs).toISOString()],
  );
  return r.rows.length;
}
