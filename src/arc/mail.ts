import { createHash, createHmac } from 'node:crypto';
import { tokenHash } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { RenderedEmail } from '../email/layout.js';
import { createMailer, type Mailer } from '../mailer.js';
import { arcActionUrl } from './emails.js';

/**
 * ARC campaigns: the mail rails. Reader email goes to strangers, so it
 * has its own sender (ARC_MAIL_FROM, `Beuk readers <readers@beuk.studio>`
 * in prod), its own transport (ARC_SMTP_URL: a separate sending-only key,
 * so ARC can be revoked or throttled without touching account mail) and
 * its own salt (ARC_SUPPRESSION_SALT). Until all three are set no reader
 * email is sent, and it never falls back to MAIL_FROM / SMTP_URL.
 *
 * sendArcMail is the one door for reader mail. In order, and each refusal
 * sends nothing and records nothing:
 *   1. not configured (no ARC transport, or no salt to check opt-outs);
 *   2. suppressed: "Not me" (scope 'all') or "Stop" for this author;
 *   3. the send limits (ARC_SEND_LIMITS), counted from arc_events;
 *   4. the transport, with the one-click unsubscribe headers;
 * and only a delivered message is recorded, as '<kind>_sent'.
 *
 * One-click unsubscribe, RFC 8058 (read 2026-11-27 at
 * https://www.rfc-editor.org/rfc/rfc8058.txt): §3.1 "The List-Unsubscribe
 * header field MUST contain one HTTPS URI" and "The List-Unsubscribe-Post
 * header MUST contain the single key/value pair 'List-Unsubscribe=One-Click'";
 * §8.1's example writes the URI in angle brackets. The receiver POSTs that
 * pair as the body (§3.2: SHOULD multipart/form-data, MAY urlencoded). §4:
 * both fields MUST be covered by a DKIM signature, which is the provider's
 * (Resend signs for beuk.studio). The URI is the Stop link: one author.
 *
 * nodemailer 10.0.13 (read in node_modules/nodemailer/dist/cjs): a message's
 * `headers` object is added to the root node as is
 * (mail-composer/index.js: `this.message.addHeader(this.mail.headers)`;
 * mime-node addHeader takes `{ key: value }`), and a value is folded only
 * at whitespace (mime-funcs foldLines), so the URI is never split.
 */

export function arcMailStatus(config: Config): { configured: boolean; reason: string | null } {
  const arc = config.arc;
  if (!arc.mailFrom) return { configured: false, reason: 'ARC_MAIL_FROM is not set' };
  if (!arc.smtpUrl) return { configured: false, reason: 'ARC_SMTP_URL is not set' };
  if (!arc.suppressionSalt) return { configured: false, reason: 'ARC_SUPPRESSION_SALT is not set' };
  return { configured: true, reason: null };
}

/** The ARC transport, or null while ARC mail is not configured. It is the
 *  account mailer's SMTP code with ARC's URL and sender; Reply-To stays
 *  SUPPORT_EMAIL (smtpMessage). */
export function createArcMailer(config: Config): Mailer | null {
  if (!arcMailStatus(config).configured) return null;
  return createMailer({ ...config, smtpUrl: config.arc.smtpUrl, mailFrom: config.arc.mailFrom });
}

/** An address as Beuk keeps it: NFC, trimmed, lower-cased; one '@' with
 *  something before it, a dot inside the part after it, no whitespace,
 *  at most 254 characters. Anything else → null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.normalize('NFC').trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || /\s/.test(email)) return null;
  const at = email.indexOf('@');
  if (at <= 0 || email.indexOf('@', at + 1) !== -1) return null;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  if (dot <= 0 || domain.endsWith('.')) return null;
  return email;
}

function salt(config: Config): string {
  const s = config.arc.suppressionSalt;
  if (!s) throw new Error('ARC mail is not configured: ARC_SUPPRESSION_SALT is not set');
  return s;
}

/** SHA-256 (hex) of the lower-cased address + ARC_SUPPRESSION_SALT. The
 *  address is put in Beuk's form first (trim, NFC, lower case), so the
 *  same address typed differently is one hash. */
export function suppressionHash(config: Config, email: string): string {
  const kept = email.normalize('NFC').trim().toLowerCase();
  return createHash('sha256').update(kept + salt(config)).digest('hex');
}

/** A reader's mail token (controller ruling F1): base64url of
 *  HMAC-SHA256(ARC_SUPPRESSION_SALT, 'arc-mail:' + recipient id). Derived,
 *  never stored: every email to one reader carries the same working Not me,
 *  Stop and List-Unsubscribe links. share_recipients keeps only its hash. */
export function arcMailToken(config: Config, recipientId: string): string {
  return createHmac('sha256', salt(config)).update('arc-mail:' + recipientId).digest('base64url');
}

/** What share_recipients.mail_token_hash holds: tokenHash of the token. */
export function arcMailTokenHash(config: Config, recipientId: string): string {
  return tokenHash(arcMailToken(config, recipientId));
}

/** 'all' when the address said Not me, 'owner' when it asked this author
 *  to stop, otherwise null. */
export async function suppressionOf(db: Db, config: Config, email: string, ownerId: string): Promise<'all' | 'owner' | null> {
  const r = await db.query<{ scope: string }>(
    `select scope from mail_suppressions where hash = $1 and scope in ('all', $2)`,
    [suppressionHash(config, email), ownerId],
  );
  if (r.rows.some((row) => row.scope === 'all')) return 'all';
  return r.rows.length > 0 ? 'owner' : null;
}

export async function suppress(db: Db, config: Config, email: string, scope: 'all' | { ownerId: string }): Promise<void> {
  await db.query(
    `insert into mail_suppressions (hash, scope) values ($1, $2) on conflict do nothing`,
    [suppressionHash(config, email), scope === 'all' ? 'all' : scope.ownerId],
  );
}

export type ArcMailKind = 'code' | 'ready' | 'pending' | 'approved' | 'declined';

/** The arc_events kinds the limits count (ruling F21: a list, no LIKE). */
export const ARC_SENT_KINDS: readonly string[] = ['code_sent', 'ready_sent', 'pending_sent', 'approved_sent', 'declined_sent'];

export const ARC_SEND_LIMITS = { perCampaignHour: 100, perOwnerHour: 200, perOwnerDay: 1000 };

export interface ArcMailDeps {
  db: Db;
  config: Config;
  arcMailer: Mailer | null;
  now: () => Date;
}

export interface ArcMailTo {
  campaignId: string;
  ownerId: string;
  recipientId: string;
  email: string;
  mailToken: string;
}

export type ArcSendOutcome =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'suppressed' | 'rate-limited' | 'refused'; detail: string };

const HOUR = 3_600_000;

async function countSent(db: Db, scopeSql: string, id: string, since: Date): Promise<number> {
  const r = await db.query<{ n: string }>(
    `select count(*)::text as n from arc_events e where ${scopeSql} and e.kind = any($2::text[]) and e.at > $3`,
    [id, ARC_SENT_KINDS, since.toISOString()],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** The first limit this send would cross, or null. */
async function overLimit(db: Db, to: ArcMailTo, now: Date): Promise<string | null> {
  const hourAgo = new Date(now.getTime() - HOUR);
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const campaign = 'e.campaign_id = $1';
  const owner = 'e.campaign_id in (select id from arc_campaigns where owner_id = $1)';
  if ((await countSent(db, campaign, to.campaignId, hourAgo)) >= ARC_SEND_LIMITS.perCampaignHour)
    return `this campaign has sent ${ARC_SEND_LIMITS.perCampaignHour} emails in the last hour`;
  if ((await countSent(db, owner, to.ownerId, hourAgo)) >= ARC_SEND_LIMITS.perOwnerHour)
    return `this author's campaigns have sent ${ARC_SEND_LIMITS.perOwnerHour} emails in the last hour`;
  if ((await countSent(db, owner, to.ownerId, dayAgo)) >= ARC_SEND_LIMITS.perOwnerDay)
    return `this author's campaigns have sent ${ARC_SEND_LIMITS.perOwnerDay} emails in the last 24 hours`;
  return null;
}

/** The one door for reader mail (see the header for the order). */
export async function sendArcMail(deps: ArcMailDeps, to: ArcMailTo, kind: ArcMailKind, mail: RenderedEmail): Promise<ArcSendOutcome> {
  const { db, config, arcMailer } = deps;
  if (!arcMailer) return { sent: false, reason: 'not-configured', detail: arcMailStatus(config).reason ?? 'no ARC mailer' };
  if (!config.arc.suppressionSalt) return { sent: false, reason: 'not-configured', detail: 'ARC_SUPPRESSION_SALT is not set' };

  const suppressed = await suppressionOf(db, config, to.email, to.ownerId);
  if (suppressed === 'all') return { sent: false, reason: 'suppressed', detail: 'this address asked Beuk for no email from any author (Not me)' };
  if (suppressed === 'owner') return { sent: false, reason: 'suppressed', detail: 'this address asked this author for no more email (Stop)' };

  const now = deps.now();
  const limit = await overLimit(db, to, now);
  if (limit) return { sent: false, reason: 'rate-limited', detail: limit };

  const stopUrl = arcActionUrl(config, to.mailToken, 'stop');
  // email-kind: arc-reader (the one door for the five reader emails; each builder in emails.ts carries its own kind)
  const result = await arcMailer.send({
    to: to.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: { 'List-Unsubscribe': `<${stopUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });
  if (!result.delivered) return { sent: false, reason: 'refused', detail: result.reason };

  await db.query(
    `insert into arc_events (campaign_id, recipient_id, kind, at) values ($1, $2, $3, $4)`,
    [to.campaignId, to.recipientId, `${kind}_sent`, now.toISOString()],
  );
  return { sent: true };
}
