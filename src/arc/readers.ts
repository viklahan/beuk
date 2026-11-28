import { tokenHash } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';
import type { ArcDeps } from './campaigns.js';
import { saltProblem, suppress } from './mail.js';
import { arcLang, arcT, type ArcLang } from './strings.js';

/**
 * ARC campaigns: a claimed reader's own surface (slice 1, Task 7) — the
 * copy page and its stamped download (by the copy token, the one mintCopy
 * gave), and the two mail links, "Not me" and "Stop" (by the mail token,
 * arcMailToken: derived, never stored; share_recipients keeps its hash).
 *
 *   resolveReader   — the copy token → the reader, only role 'arc' and
 *                     status 'claimed' (as /read/:token, ruling R4a);
 *                     'revoked' when the reader's or the share's copy is
 *                     closed (or has expired).
 *   readBuildEpub   — the reader's build, unstamped (the stamp is applied
 *                     per download by the route and never stored).
 *   readerByMailToken — the mail token → the reader, any status: the code
 *                     email carries Not me and Stop too.
 *   notMe           — one transaction: suppress(email, 'all'), an
 *                     arc_events 'not_me' row with no recipient, and the
 *                     reader row deleted (its email with it; comments keep
 *                     the given name, their recipient_id set null by the FK).
 *   stopMail        — suppress(email, { ownerId }), mail_stopped_at, and an
 *                     arc_events 'stopped' row (the first time only). The
 *                     copy keeps working.
 * Both opt-outs need ARC_SUPPRESSION_SALT (the hash); arcOptOutReady says
 * whether this server has it.
 */

/** A copy token or a mail token: base64url, 20-64 characters (Beuk makes
 *  32 for a copy and 43 for a mail token). */
export const READER_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export interface ReaderView {
  readerId: string;
  name: string;
  email: string;
  publicId: string;
  /** '' when the build is gone (readBuildEpub then finds nothing). */
  buildId: string;
  lang: ArcLang;
  title: string;
  author: string;
  campaignId: string;
  ownerId: string;
  /** revoked: the reader's copy or the share is closed, or either has expired. */
  status: 'active' | 'revoked';
}

function past(v: unknown, now: Date): boolean {
  return v != null && new Date(v as string | Date).getTime() <= now.getTime();
}

function authorOf(raw: unknown, lang: ArcLang): string {
  return String(raw ?? '').trim() || arcT(lang)('arc.theAuthor');
}

/** The reader a copy token opens, or null. (`now` is an addition to the
 *  plan's signature, for the expiry check with the injected clock.) */
export async function resolveReader(db: Db, token: string, now: Date = new Date()): Promise<ReaderView | null> {
  if (typeof token !== 'string' || !READER_TOKEN_RE.test(token)) return null;
  const r = await db.query<Record<string, unknown>>(
    `select r.id, r.name, r.email, r.public_id, r.build_id, r.revoked_at, r.expires_at,
       s.title, s.snapshot->>'author' as author, s.snapshot->>'language' as language,
       s.revoked_at as s_revoked_at, s.expires_at as s_expires_at,
       c.id as campaign_id, c.owner_id
     from share_recipients r
     join shares s on s.id = r.share_id
     join arc_campaigns c on c.share_id = s.id
     where r.token_hash = $1 and r.role = 'arc' and r.status = 'claimed'`,
    [tokenHash(token)],
  );
  const x = r.rows[0];
  if (!x) return null;
  const lang = arcLang(String(x.language ?? ''));
  const closed = x.revoked_at != null || x.s_revoked_at != null || past(x.expires_at, now) || past(x.s_expires_at, now);
  return {
    readerId: String(x.id),
    name: String(x.name),
    email: String(x.email),
    publicId: String(x.public_id ?? ''),
    buildId: x.build_id == null ? '' : String(x.build_id),
    lang,
    title: String(x.title ?? ''),
    author: authorOf(x.author, lang),
    campaignId: String(x.campaign_id),
    ownerId: String(x.owner_id),
    status: closed ? 'revoked' : 'active',
  };
}

/** The build's unstamped EPUB and its file name, or null. */
export async function readBuildEpub(db: Db, buildId: string): Promise<{ bytes: Buffer; filename: string } | null> {
  if (!isUuid(buildId)) return null;
  const r = await db.query<{ epub_base64: string; epub_filename: string }>(
    'select epub_base64, epub_filename from arc_builds where id = $1',
    [buildId],
  );
  const x = r.rows[0];
  if (!x) return null;
  return { bytes: Buffer.from(x.epub_base64, 'base64'), filename: x.epub_filename };
}

export interface MailReader {
  readerId: string;
  email: string;
  ownerId: string;
  /** Ruling F12. */
  campaignId: string;
  title: string;
  author: string;
  lang: ArcLang;
  /** The reader holds a copy that still opens (claimed, not closed, the
   *  share not closed): only then does the Stop page say the copy keeps
   *  working (ruling C7). */
  copyOpen: boolean;
}

const MAIL_READER_SQL = `select r.id, r.email, c.owner_id, c.id as campaign_id, s.title,
    s.snapshot->>'author' as author, s.snapshot->>'language' as language,
    (r.status = 'claimed' and r.revoked_at is null and s.revoked_at is null) as copy_open
  from share_recipients r
  join shares s on s.id = r.share_id
  join arc_campaigns c on c.share_id = s.id
  where r.mail_token_hash = $1 and r.role = 'arc'`;

function mailReaderOf(x: Record<string, unknown>): MailReader {
  const lang = arcLang(String(x.language ?? ''));
  return {
    readerId: String(x.id),
    email: String(x.email),
    ownerId: String(x.owner_id),
    campaignId: String(x.campaign_id),
    title: String(x.title ?? ''),
    author: authorOf(x.author, lang),
    lang,
    copyOpen: x.copy_open === true,
  };
}

/** The reader a mail token names (any status), or null. */
export async function readerByMailToken(db: Db, mailToken: string): Promise<MailReader | null> {
  if (typeof mailToken !== 'string' || !READER_TOKEN_RE.test(mailToken)) return null;
  const r = await db.query<Record<string, unknown>>(MAIL_READER_SQL, [tokenHash(mailToken)]);
  return r.rows[0] ? mailReaderOf(r.rows[0]) : null;
}

/** Whether this server can keep an opt-out: the suppression hash needs a
 *  usable ARC_SUPPRESSION_SALT (src/arc/mail.ts saltProblem, the one rule). */
export function arcOptOutReady(config: Config): boolean {
  return saltProblem(config.arc.suppressionSalt) === null;
}

/** The row, locked for the rest of the transaction. */
async function lockMailReader(tx: Db, mailToken: string): Promise<MailReader | null> {
  if (typeof mailToken !== 'string' || !READER_TOKEN_RE.test(mailToken)) return null;
  const r = await tx.query<Record<string, unknown>>(`${MAIL_READER_SQL} for update of r`, [tokenHash(mailToken)]);
  return r.rows[0] ? mailReaderOf(r.rows[0]) : null;
}

/** "Not me": false when the token names no reader (unknown, or used). */
export async function notMe(deps: ArcDeps, mailToken: string): Promise<boolean> {
  const at = deps.now().toISOString();
  return deps.db.tx(async (tx) => {
    const reader = await lockMailReader(tx, mailToken);
    if (!reader) return false;
    await suppress(tx, deps.config, reader.email, 'all');
    await tx.query(`insert into arc_events (campaign_id, recipient_id, kind, at) values ($1, null, 'not_me', $2)`, [reader.campaignId, at]);
    await tx.query('delete from share_recipients where id = $1', [reader.readerId]);
    return true;
  });
}

/** "Stop": no more mail from this author; the copy keeps working. False
 *  when the token names no reader. Stopping again changes nothing. */
export async function stopMail(deps: ArcDeps, mailToken: string): Promise<boolean> {
  const at = deps.now().toISOString();
  return deps.db.tx(async (tx) => {
    const reader = await lockMailReader(tx, mailToken);
    if (!reader) return false;
    await suppress(tx, deps.config, reader.email, { ownerId: reader.ownerId });
    const first = await tx.query('update share_recipients set mail_stopped_at = $2 where id = $1 and mail_stopped_at is null returning id', [
      reader.readerId,
      at,
    ]);
    if (first.rows.length) {
      await tx.query(`insert into arc_events (campaign_id, recipient_id, kind, at) values ($1, $2, 'stopped', $3)`, [
        reader.campaignId,
        reader.readerId,
        at,
      ]);
    }
    return true;
  });
}

/** One download recorded (arc_events 'downloaded'). */
export async function recordDownload(db: Db, reader: Pick<ReaderView, 'campaignId' | 'readerId'>, now: Date): Promise<void> {
  await db.query(`insert into arc_events (campaign_id, recipient_id, kind, at) values ($1, $2, 'downloaded', $3)`, [
    reader.campaignId,
    reader.readerId,
    now.toISOString(),
  ]);
}

/**
 * The fields of a small form body: urlencoded (already parsed by
 * express.urlencoded) or multipart/form-data (RFC 8058 §3.2: a one-click
 * client SHOULD send multipart; ruling F22). The multipart reader is
 * deliberately small: text fields only (a part with a filename is
 * skipped), the first value of a name wins, the body is at most 8 KB.
 */
export function formFields(body: unknown, contentType: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (Buffer.isBuffer(body)) {
    const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
    if (!m) return out;
    const boundary = `--${m[1] ?? m[2]}`;
    for (const part of body.toString('utf8').split(boundary)) {
      const sep = part.indexOf('\r\n\r\n');
      if (sep < 0) continue;
      const head = part.slice(0, sep);
      const name = /content-disposition:[^\r\n]*;\s*name="([^"]*)"/i.exec(head)?.[1];
      if (!name || /;\s*filename\*?=/i.test(head) || name in out) continue;
      let value = part.slice(sep + 4);
      if (value.endsWith('\r\n')) value = value.slice(0, -2);
      out[name] = value;
    }
    return out;
  }
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}
