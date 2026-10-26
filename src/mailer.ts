import nodemailer from 'nodemailer';
import type { Config } from './config.js';

/**
 * P0 #5 account basics — the outgoing-mail seam.
 *
 * One interface, two honest implementations:
 *
 *   SMTP     SMTP_URL + MAIL_FROM set. Messages go out through
 *            nodemailer; a message counts as delivered ONLY when the
 *            SMTP server accepted it (nodemailer resolves sendMail with
 *            `accepted` recipients). verify() connects + authenticates.
 *   console  either is missing. NOTHING is sent and `delivered` is
 *            always false. When MAIL_LOG_LINKS is on (default outside
 *            NODE_ENV=production) the would-be message — including any
 *            reset link — is written to the server console so a local
 *            operator can still finish the flow; otherwise it is dropped
 *            and only a one-line "not sent" notice is logged.
 *
 * nodemailer's createTransport accepts a connection URL string such as
 * "smtp://user:pass@smtp.example.com:587" — source: https://nodemailer.com/
 * (createTransport section). In nodemailer 10.0.13's parseConnectionUrl
 * (dist/cjs/shared/index.js) "smtp:" sets secure=false (STARTTLS is used
 * when the server advertises it) and "smtps:" sets secure=true (implicit
 * TLS); URL query parameters become transport options.
 * verify(): https://nodemailer.com/#verify-the-connection-optional
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailResult =
  | { delivered: true; messageId: string }
  | { delivered: false; reason: string; loggedToConsole: boolean };

export interface MailerStatus {
  configured: boolean;
  transport: 'smtp' | 'console' | 'none';
  from: string | null;
  /** Human-readable state, e.g. "email not configured — SMTP_URL is not set". */
  detail: string;
}

export interface Mailer {
  status(): MailerStatus;
  send(message: MailMessage): Promise<MailResult>;
  /** Connect (and authenticate) without sending. Unconfigured → ok:false. */
  verify(): Promise<{ ok: boolean; detail: string }>;
}

export interface MailerOptions {
  /** Where console-transport output goes (tests pass a sink). */
  log?: (line: string) => void;
}

/**
 * What nodemailer is handed for one message: From is MAIL_FROM, and
 * Reply-To is SUPPORT_EMAIL when it is set, so a writer's reply reaches
 * the support mailbox even when MAIL_FROM is a sending-only address
 * (docs/email-setup.md, "A mailbox for replies"). While SUPPORT_EMAIL is
 * unset no Reply-To is added and replies go to MAIL_FROM, as before.
 * `replyTo` is nodemailer's message field for the Reply-To header
 * (https://nodemailer.com/message).
 */
export function smtpMessage(config: Config, message: MailMessage): MailMessage & { from: string; replyTo?: string } {
  return { from: config.mailFrom ?? '', ...(config.supportEmail ? { replyTo: config.supportEmail } : {}), ...message };
}

/** Why mail is not configured, or null when it is. */
export function mailNotConfiguredReason(config: Config): string | null {
  if (!config.smtpUrl && !config.mailFrom) return 'SMTP_URL and MAIL_FROM are not set';
  if (!config.smtpUrl) return 'SMTP_URL is not set';
  if (!config.mailFrom) return 'SMTP_URL is set but MAIL_FROM is not';
  return null;
}

/** "smtp://host:587" with any credentials removed — safe to show admins. */
export function describeSmtpUrl(smtpUrl: string): string {
  try {
    const url = new URL(smtpUrl);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return '(unparseable SMTP_URL)';
  }
}

export function createMailer(config: Config, opts: MailerOptions = {}): Mailer {
  const log = opts.log ?? ((line: string) => console.log(line));
  const reason = mailNotConfiguredReason(config);

  if (reason) {
    const detail = `email not configured — ${reason}`;
    return {
      status: () => ({
        configured: false,
        transport: config.mailLogLinks ? 'console' : 'none',
        from: config.mailFrom,
        detail: config.mailLogLinks
          ? `${detail}; messages are written to the server console instead (MAIL_LOG_LINKS on) and never reported as sent`
          : `${detail}; messages are dropped (MAIL_LOG_LINKS off) and never reported as sent`,
      }),
      send: async (message) => {
        if (config.mailLogLinks) {
          log(
            [
              '──── beuk mail (NOT SENT: email not configured) ────',
              `To: ${message.to}`,
              `Subject: ${message.subject}`,
              ...(config.supportEmail ? [`Reply-To: ${config.supportEmail}`] : []),
              '',
              message.text,
              '────────────────────────────────────────────────────',
            ].join('\n'),
          );
        } else {
          log(`beuk mail NOT SENT (email not configured): "${message.subject}"`);
        }
        return { delivered: false, reason: detail, loggedToConsole: config.mailLogLinks };
      },
      verify: async () => ({ ok: false, detail }),
    };
  }

  const smtpUrl = config.smtpUrl!;
  const from = config.mailFrom!;
  // `url` is parsed into options by nodemailer's SMTP transport (10.0.13
  // dist/cjs/smtp-transport/index.js); the bounded timeouts keep a
  // black-holed SMTP host from stalling a send or a self-check for
  // nodemailer's 2-minute default connectionTimeout.
  const transporter = nodemailer.createTransport({
    url: smtpUrl,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const where = describeSmtpUrl(smtpUrl);
  return {
    status: () => ({
      configured: true,
      transport: 'smtp',
      from,
      detail: `SMTP via ${where}, from ${from}`,
    }),
    send: async (message) => {
      try {
        const info = await transporter.sendMail(smtpMessage(config, message));
        if (!info.accepted || info.accepted.length === 0) {
          return {
            delivered: false,
            reason: `SMTP server accepted no recipients (rejected: ${(info.rejected ?? []).join(', ') || 'none listed'})`,
            loggedToConsole: false,
          };
        }
        return { delivered: true, messageId: info.messageId };
      } catch (err) {
        return {
          delivered: false,
          reason: `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`,
          loggedToConsole: false,
        };
      }
    },
    verify: async () => {
      try {
        await transporter.verify();
        return { ok: true, detail: `SMTP server at ${where} accepted the connection` };
      } catch (err) {
        return {
          ok: false,
          detail: `SMTP server at ${where} did not accept the connection: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
