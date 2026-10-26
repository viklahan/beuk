import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { drillHealth, offsiteFreshness, scheduleHealth, type HealthVerdict } from '../housekeeping/offsite.js';
import { scrubText } from '../housekeeping/scrub.js';
import type { Mailer } from '../mailer.js';
import { opsSettings } from './settings.js';

/**
 * Backup alerts: once per incident, not every tick.
 *
 * An incident opens when any of the three backup self-checks is red
 * (backup.schedule.running, backup.offsite.fresh, backup.offsite.drill:
 * a failed or missing scheduled backup, a failed or stale off-site copy,
 * a failed or stale restore drill). Opening sends ONE alert; the incident
 * stays open, silently, while anything is still red (the list of red checks
 * may change without a new alert); when every check is green or not
 * configured again, it closes and ONE "working again" message goes out.
 * "Once" means once DELIVERED: while no channel has accepted the opening
 * alert (the webhook was unreachable, SMTP refused, or no channel was set
 * when the incident opened), later ticks try again, up to
 * MAX_OPEN_ATTEMPTS attempts that reached a channel, at least
 * RETRY_GAP_MS apart. A tick with no channel configured costs no attempt,
 * so a channel added mid-incident (after a restart) still gets the alert.
 * `not-configured` is never red: a feature that is off is not an incident.
 *
 * Channels, each only when set:
 *   ALERT_EMAIL        emailed through the app's mailer, only when email is
 *                      configured (SMTP_URL + MAIL_FROM). Otherwise the
 *                      result says "email isn't set up on this server" and
 *                      nothing is claimed as sent.
 *   ALERT_WEBHOOK_URL  an HTTP POST of JSON (ALERT_WEBHOOK_FORMAT: json, slack
 *                      or discord). Slack's incoming webhooks take {"text"}
 *                      (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/);
 *                      Discord's Execute Webhook takes {"content"}, at most
 *                      2000 characters (https://docs.discord.com/developers/resources/webhook).
 * The state lives in the ops_alerts table (and in memory, so a database
 * outage cannot turn every tick into a new alert). Every text that leaves
 * the box passes through the secret scrubber.
 */

export const ALERT_KEY = 'backups';
/** Attempts (that reached at least one channel) to deliver an incident's opening alert. */
export const MAX_OPEN_ATTEMPTS = 4;
/** Minimum gap between delivery attempts (the scheduler ticks every 15 minutes). */
export const RETRY_GAP_MS = 10 * 60_000;

const CHECKS: { id: string; title: string; read: (c: Config, now: Date) => Promise<HealthVerdict> }[] = [
  { id: 'backup.schedule.running', title: 'Scheduled local backups', read: scheduleHealth },
  { id: 'backup.offsite.fresh', title: 'Off-site copy', read: offsiteFreshness },
  { id: 'backup.offsite.drill', title: 'Restore drill', read: drillHealth },
];

export interface FailingCheck {
  id: string;
  title: string;
  detail: string;
}

export interface AlertState {
  open: boolean;
  openedAt: string | null;
  closedAt: string | null;
  failing: string[];
  detail: string;
  lastAlertAt: string | null;
  lastAlertKind: string | null;
  lastAlertResult: string | null;
  /** Some channel accepted this incident's opening alert. */
  delivered: boolean;
  /** Delivery attempts for the opening alert that reached a channel. */
  openAttempts: number;
}

export interface ChannelResult {
  channel: 'email' | 'webhook';
  ok: boolean;
  detail: string;
}

export interface EvaluateResult {
  action: 'none' | 'opened' | 'retried' | 'resolved' | 'updated';
  failing: FailingCheck[];
  channels: ChannelResult[];
  state: AlertState;
}

export interface AlertDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  secrets: readonly string[];
  now?: () => Date;
  /** Tests may inject; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Webhook timeout (default 10 s). */
  webhookTimeoutMs?: number;
}

const EMPTY: AlertState = {
  open: false, openedAt: null, closedAt: null, failing: [], detail: '',
  lastAlertAt: null, lastAlertKind: null, lastAlertResult: null, delivered: false, openAttempts: 0,
};

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Which alert channels are configured (names and state, never the URL). */
export function alertChannels(config: Config, mailer: Mailer): {
  email: { set: boolean; to: string | null; usable: boolean; detail: string };
  webhook: { set: boolean; format: string; detail: string };
} {
  const o = opsSettings(config);
  const mailOk = mailer.status().configured;
  return {
    email: {
      set: Boolean(o.alertEmail),
      to: o.alertEmail,
      usable: Boolean(o.alertEmail) && mailOk,
      detail: !o.alertEmail
        ? 'ALERT_EMAIL is not set'
        : mailOk
          ? `alerts are emailed to ${o.alertEmail}`
          : `ALERT_EMAIL is set, but email isn't set up on this server (SMTP_URL / MAIL_FROM), so no alert email can be sent`,
    },
    webhook: {
      set: Boolean(o.alertWebhookUrl),
      format: o.alertWebhookFormat,
      detail: o.alertWebhookUrl ? `alerts are posted to the configured webhook (${o.alertWebhookFormat} format)` : 'ALERT_WEBHOOK_URL is not set',
    },
  };
}

export class BackupAlerts {
  private memory: AlertState | null = null;
  private readonly now: () => Date;
  constructor(private readonly deps: AlertDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private scrub(text: string): string {
    return scrubText(text, this.deps.secrets);
  }

  async readState(): Promise<AlertState> {
    try {
      const r = await this.deps.db.query<{
        open: boolean; opened_at: unknown; closed_at: unknown; failing: string; detail: string;
        last_alert_at: unknown; last_alert_kind: string | null; last_alert_result: string | null;
        delivered: boolean | null; open_attempts: number | null;
      }>('select * from ops_alerts where key = $1', [ALERT_KEY]);
      const row = r.rows[0];
      if (!row) return this.memory ?? { ...EMPTY };
      const state: AlertState = {
        open: row.open,
        openedAt: iso(row.opened_at),
        closedAt: iso(row.closed_at),
        failing: row.failing ? row.failing.split(',').filter(Boolean) : [],
        detail: row.detail,
        lastAlertAt: iso(row.last_alert_at),
        lastAlertKind: row.last_alert_kind,
        lastAlertResult: row.last_alert_result,
        delivered: Boolean(row.delivered),
        openAttempts: Number(row.open_attempts ?? 0),
      };
      this.memory = state;
      return state;
    } catch {
      return this.memory ?? { ...EMPTY };
    }
  }

  private async writeState(s: AlertState): Promise<void> {
    this.memory = s;
    await this.deps.db
      .query(
        `insert into ops_alerts (key, open, opened_at, closed_at, failing, detail, last_alert_at, last_alert_kind, last_alert_result, delivered, open_attempts)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (key) do update set open = excluded.open, opened_at = excluded.opened_at,
           closed_at = excluded.closed_at, failing = excluded.failing, detail = excluded.detail,
           last_alert_at = excluded.last_alert_at, last_alert_kind = excluded.last_alert_kind,
           last_alert_result = excluded.last_alert_result, delivered = excluded.delivered,
           open_attempts = excluded.open_attempts`,
        [ALERT_KEY, s.open, s.openedAt, s.closedAt, s.failing.join(','), s.detail.slice(0, 4000), s.lastAlertAt, s.lastAlertKind, s.lastAlertResult, s.delivered, s.openAttempts],
      )
      .catch((err) => console.error('ops alert state write failed', err instanceof Error ? this.scrub(err.message) : err));
  }

  async failingChecks(): Promise<FailingCheck[]> {
    const now = this.now();
    const out: FailingCheck[] = [];
    for (const c of CHECKS) {
      let v: HealthVerdict;
      try {
        v = await c.read(this.deps.config, now);
      } catch (err) {
        v = { status: 'fail', detail: `could not be read: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (v.status === 'fail') out.push({ id: c.id, title: c.title, detail: this.scrub(v.detail) });
    }
    return out;
  }

  /** Check the backup verdicts and alert on a change of incident state. */
  async evaluate(): Promise<EvaluateResult> {
    const failing = await this.failingChecks();
    const prev = await this.readState();
    const at = this.now().toISOString();
    const ids = failing.map((f) => f.id);
    const detail = failing.map((f) => `${f.title}: ${f.detail}`).join('\n');
    if (failing.length && !prev.open) {
      const channels = await this.send('open', failing);
      const attempts = channels.length ? 1 : 0;
      const delivered = channels.some((c) => c.ok);
      const state: AlertState = {
        open: true, openedAt: at, closedAt: null, failing: ids, detail,
        lastAlertAt: at, lastAlertKind: 'open', lastAlertResult: summariseOpen(channels, delivered, attempts),
        delivered, openAttempts: attempts,
      };
      await this.writeState(state);
      return { action: 'opened', failing, channels, state };
    }
    if (failing.length && prev.open && !prev.delivered && prev.openAttempts < MAX_OPEN_ATTEMPTS && this.hasChannel()) {
      const last = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : 0;
      if (this.now().getTime() - last >= RETRY_GAP_MS) {
        // The opening alert never reached anyone: try again (same incident).
        const channels = await this.send('open', failing);
        const attempts = prev.openAttempts + (channels.length ? 1 : 0);
        const delivered = channels.some((c) => c.ok);
        const state: AlertState = {
          ...prev, failing: ids, detail,
          lastAlertAt: at, lastAlertKind: 'open', lastAlertResult: summariseOpen(channels, delivered, attempts),
          delivered, openAttempts: attempts,
        };
        await this.writeState(state);
        return { action: 'retried', failing, channels, state };
      }
    }
    if (!failing.length && prev.open) {
      const channels = await this.send('resolved', []);
      const state: AlertState = {
        ...prev, open: false, closedAt: at, failing: [], detail: '',
        lastAlertAt: at, lastAlertKind: 'resolved', lastAlertResult: summarise(channels),
        delivered: false, openAttempts: 0,
      };
      await this.writeState(state);
      return { action: 'resolved', failing, channels, state };
    }
    if (prev.open && (ids.join(',') !== prev.failing.join(',') || detail !== prev.detail)) {
      // Same incident, different red checks: recorded, no second alert.
      const state: AlertState = { ...prev, failing: ids, detail };
      await this.writeState(state);
      return { action: 'updated', failing, channels: [], state };
    }
    return { action: 'none', failing, channels: [], state: prev };
  }

  private hasChannel(): boolean {
    const o = opsSettings(this.deps.config);
    return Boolean(o.alertEmail || o.alertWebhookUrl);
  }

  /** Housekeeping "send a test alert": every configured channel, once. */
  async sendTest(): Promise<ChannelResult[]> {
    return this.send('test', []);
  }

  private message(kind: 'open' | 'resolved' | 'test', failing: FailingCheck[]): { subject: string; text: string } {
    const server = this.deps.config.appBaseUrl;
    const at = this.now().toISOString();
    if (kind === 'test') {
      return {
        subject: 'Beuk: test alert',
        text: `This is a test alert from Housekeeping on ${server} at ${at}. If you can read it, backup alerts reach you here.`,
      };
    }
    if (kind === 'resolved') {
      return {
        subject: 'Beuk: backups are working again',
        text: `Every backup check on ${server} is green or switched off again (${at}). No further action is needed.`,
      };
    }
    return {
      subject: 'Beuk: backups need attention',
      text: [
        `A backup check on ${server} turned red (${at}):`,
        ...failing.map((f) => `- ${f.title} (${f.id}): ${f.detail}`),
        '',
        'This is the only alert for this incident; you will get one more message when it is fixed.',
        'Details: GET /api/housekeeping/offsite as an admin.',
      ].join('\n'),
    };
  }

  private async send(kind: 'open' | 'resolved' | 'test', failing: FailingCheck[]): Promise<ChannelResult[]> {
    const o = opsSettings(this.deps.config);
    const { subject, text } = this.message(kind, failing);
    const safeSubject = this.scrub(subject);
    const safeText = this.scrub(text);
    const results: ChannelResult[] = [];

    if (o.alertEmail) {
      if (!this.deps.mailer.status().configured) {
        results.push({ channel: 'email', ok: false, detail: "email isn't set up on this server (SMTP_URL / MAIL_FROM); no alert email was sent" });
      } else {
        // email-kind: backup-alert
        const r = await this.deps.mailer.send({ to: o.alertEmail, subject: safeSubject, text: safeText });
        results.push(
          r.delivered
            ? { channel: 'email', ok: true, detail: `accepted by the SMTP server for ${o.alertEmail}` }
            : { channel: 'email', ok: false, detail: this.scrub(r.reason) },
        );
      }
    }

    if (o.alertWebhookUrl) {
      const line = `${safeSubject}\n${safeText}`;
      const full = {
        event: 'beuk.backups.alert',
        state: kind,
        server: this.deps.config.appBaseUrl,
        at: this.now().toISOString(),
        failing,
        text: line,
        content: line.slice(0, 2000),
      };
      const body =
        o.alertWebhookFormat === 'slack' ? { text: line }
        : o.alertWebhookFormat === 'discord' ? { content: line.slice(0, 2000) }
        : full;
      const doFetch = this.deps.fetchImpl ?? fetch;
      try {
        const res = await doFetch(o.alertWebhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: this.scrub(JSON.stringify(body)),
          redirect: 'error',
          signal: AbortSignal.timeout(this.deps.webhookTimeoutMs ?? 10_000),
        });
        results.push(
          res.ok
            ? { channel: 'webhook', ok: true, detail: `the webhook answered ${res.status}` }
            : { channel: 'webhook', ok: false, detail: `the webhook answered ${res.status}` },
        );
      } catch (err) {
        results.push({ channel: 'webhook', ok: false, detail: this.scrub(`the webhook could not be reached: ${err instanceof Error ? err.message : String(err)}`) });
      }
    }
    return results;
  }
}

function summariseOpen(channels: ChannelResult[], delivered: boolean, attempts: number): string {
  const base = summarise(channels);
  if (delivered || !channels.length) return base;
  return attempts >= MAX_OPEN_ATTEMPTS
    ? `${base}; not delivered after ${attempts} attempts, no further tries for this incident`
    : `${base}; not delivered yet (attempt ${attempts} of ${MAX_OPEN_ATTEMPTS}), trying again on a later check`;
}

export function summarise(channels: ChannelResult[]): string {
  if (!channels.length) return 'no alert channel is configured (ALERT_EMAIL / ALERT_WEBHOOK_URL): recorded here only';
  return channels.map((c) => `${c.channel} ${c.ok ? 'ok' : 'failed'}: ${c.detail}`).join('; ');
}
