import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { BillingProvider } from '../billing.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer } from '../mailer.js';
import { verifyPassword } from '../password.js';
import { SlidingWindowLimiter } from '../rate-limit.js';
import { clearSessionCookie, readCookie, requireAuth, SESSION_COOKIE, tokenHash, type AuthedUser } from '../auth.js';
import { clientDir } from '../warmth/pages.js';
import type { BackgroundTasks } from './account.js';
import {
  changeConfirmEmail,
  changeNoticeEmail,
  confirmLink,
  consumeConfirmation,
  issueConfirmation,
  sendSignupConfirmation,
} from '../account/confirm.js';
import {
  accountOverview,
  archiveBytesOf,
  deleteAccount,
  exportReadme,
  pendingEmailChange,
  writeAccountExport,
  ZIP_LIMIT_BYTES,
} from '../account/data.js';
import { accountPlan, cancelBillingForDeletedAccount } from '../account/plan.js';
import {
  accountPage,
  confirmPage,
  confirmResultPage,
  DELETE_PHRASE,
  deletedPage,
  signedOutPage,
} from '../account/page.js';
import { ZipWriter } from '../account/zip.js';
import { sendSignupEmail } from '../email/welcome.js';

/**
 * Accounts — "your typesetting portal".
 *
 * Pages (Caddy proxies /account* to the app):
 *   GET  /account                 the portal (signed out: Sign in / Create an account)
 *   GET  /account/confirm?token=  a button that confirms (prefetch-safe)
 *   POST /account/confirm         form post {token} → result page
 *   GET  /account/deleted         the page after "Delete my account"
 *   GET  /account/account.css|js  the page's stylesheet and form script
 *
 * API (signed in unless noted), mounted at /api/account:
 *   GET  /summary                 {email, emailConfirmed, pendingEmail, emailDelivery}
 *   POST /confirm/resend          a new sign-up confirmation link
 *   POST /email {currentPassword, newEmail}
 *                                 link to the NEW address + notice to the
 *                                 old; the address changes only when the
 *                                 link is followed. 501 while email is
 *                                 not configured: never changed unverified.
 *   POST /email/cancel            retire a pending change
 *   GET  /export                  "Download all my data" (one ZIP)
 *   POST /delete {currentPassword, confirmPhrase}
 *                                 delete the account and everything on it
 *
 * Change password and sign out everywhere stay at /api/auth/password and
 * /api/auth/sessions/revoke-all (src/routes/account.ts); the page calls them.
 */

export interface PortalLimits {
  resendPerUser: { max: number; windowMs: number };
  emailPerUser: { max: number; windowMs: number };
  exportPerUser: { max: number; windowMs: number };
  deletePerUser: { max: number; windowMs: number };
  confirmPerIp: { max: number; windowMs: number };
}

export const DEFAULT_PORTAL_LIMITS: PortalLimits = {
  resendPerUser: { max: 3, windowMs: 60 * 60_000 },
  emailPerUser: { max: 5, windowMs: 60 * 60_000 },
  exportPerUser: { max: 5, windowMs: 60 * 60_000 },
  deletePerUser: { max: 5, windowMs: 15 * 60_000 },
  confirmPerIp: { max: 30, windowMs: 15 * 60_000 },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNIQUE_VIOLATION = '23505';

export interface PortalDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  tasks: BackgroundTasks;
  billing: BillingProvider;
  now?: () => Date;
  limits?: PortalLimits;
}

/** The session's user, or null — for pages, which never answer 401. */
async function optionalUser(db: Db, req: Request): Promise<AuthedUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const found = await db.query<AuthedUser>(
    `select u.id, u.email from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash(token)],
  );
  return found.rows[0] ?? null;
}

function pageHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
}

/** Send the sign-up email after the response: with mail configured, the
 *  welcome with the confirmation link inside (src/email/welcome.ts), once;
 *  without, the plain confirmation, logged and never reported as sent.
 *  Used by POST /api/auth/register (see app.ts). */
export function signupConfirmationHook(
  deps: Pick<PortalDeps, 'db' | 'config' | 'mailer' | 'tasks'> & { billing?: Pick<BillingProvider, 'checkoutConfigured'> },
) {
  return (user: { id: string; email: string }) => {
    deps.tasks.run(async () => {
      await sendSignupEmail(
        { db: deps.db, config: deps.config, mailer: deps.mailer, billingOn: Boolean(deps.billing?.checkoutConfigured) },
        user,
      );
    });
    return { emailDelivery: deps.mailer.status().configured ? 'email' : 'not-configured' };
  };
}

export function accountPortalRoutes(deps: PortalDeps): { pages: Router; api: Router } {
  const { db, config, mailer, tasks, billing } = deps;
  const now = deps.now ?? (() => new Date());
  const limits = deps.limits ?? DEFAULT_PORTAL_LIMITS;
  const lim = (l: { max: number; windowMs: number }) => new SlidingWindowLimiter(l.max, l.windowMs);
  const resendUser = lim(limits.resendPerUser);
  const emailUser = lim(limits.emailPerUser);
  const exportUser = lim(limits.exportPerUser);
  const deleteUser = lim(limits.deletePerUser);
  const confirmIp = lim(limits.confirmPerIp);
  const mailOn = () => mailer.status().configured;

  const tooMany = (res: Response, limiter: SlidingWindowLimiter, key: string) => {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    return res.status(429).json({ error: 'too many attempts — please wait a little and try again' });
  };

  /* ------------------------------ pages ------------------------------ */
  const pages = Router();

  const asset = (file: string, type: string) => async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const body = await readFile(path.join(clientDir(), 'account', file), 'utf8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.type(type).send(body);
    } catch (err) {
      return next(err as Error);
    }
  };
  pages.get('/account/account.css', asset('account.css', 'css'));
  pages.get('/account/account.js', asset('account.js', 'application/javascript'));

  pages.get(['/account', '/account/'], async (req, res, next) => {
    try {
      pageHeaders(res);
      const user = await optionalUser(db, req);
      if (!user) return res.type('html').send(signedOutPage(config));
      const overview = await accountOverview(db, config, user.id, now());
      if (!overview) return res.type('html').send(signedOutPage(config));
      const plan = await accountPlan({ db, config, billing, now }, { id: user.id, createdAt: overview.user.createdAt });
      return res.type('html').send(accountPage(config, overview, plan, { emailConfigured: mailOn() }));
    } catch (err) {
      return next(err);
    }
  });

  pages.get('/account/confirm', (req, res) => {
    pageHeaders(res);
    const token = typeof req.query.token === 'string' && req.query.token.length <= 200 ? req.query.token : null;
    return res.type('html').send(confirmPage(config, token));
  });

  pages.post('/account/confirm', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res, next) => {
    try {
      pageHeaders(res);
      const ip = req.ip ?? 'unknown';
      if (confirmIp.hit(ip)) {
        res.setHeader('Retry-After', String(confirmIp.retryAfterSeconds(ip)));
        return res.status(429).type('html').send(confirmResultPage(config, { ok: false, reason: 'busy' }));
      }
      const token = String(req.body?.token ?? '');
      let outcome;
      try {
        outcome = await consumeConfirmation(db, token);
      } catch (err) {
        // Two accounts racing for one address: the unique index decides.
        if ((err as { code?: string })?.code === UNIQUE_VIOLATION) outcome = { ok: false as const, reason: 'taken' as const };
        else throw err;
      }
      return res.status(outcome.ok ? 200 : 400).type('html').send(confirmResultPage(config, outcome));
    } catch (err) {
      return next(err);
    }
  });

  pages.get('/account/deleted', (req, res) => {
    pageHeaders(res);
    return res.type('html').send(deletedPage(config, { subscriptionLeft: req.query.subscription === 'left' }));
  });

  /* ------------------------------- api ------------------------------- */
  const api = Router();
  api.use(requireAuth(db));

  api.get('/summary', async (req, res, next) => {
    try {
      const u = (
        await db.query<{ email: string; email_confirmed_at: string | null }>(
          'select email, email_confirmed_at from users where id = $1',
          [req.user!.id],
        )
      ).rows[0];
      if (!u) return res.status(401).json({ error: 'not signed in' });
      return res.json({
        email: u.email,
        emailConfirmed: Boolean(u.email_confirmed_at),
        pendingEmail: await pendingEmailChange(db, req.user!.id),
        emailDelivery: mailOn() ? 'email' : 'not-configured',
        accountPage: '/account',
      });
    } catch (err) {
      return next(err);
    }
  });

  api.post('/confirm/resend', async (req, res, next) => {
    try {
      const user = req.user!;
      if (resendUser.hit(user.id)) return tooMany(res, resendUser, user.id);
      const row = (
        await db.query<{ email: string; email_confirmed_at: string | null }>(
          'select email, email_confirmed_at from users where id = $1',
          [user.id],
        )
      ).rows[0];
      if (row?.email_confirmed_at) return res.json({ ok: true, alreadyConfirmed: true, sent: false });
      // Not configured: the link is still made (MAIL_LOG_LINKS shows it to
      // a local operator), but nothing is claimed as sent.
      const result = await sendSignupConfirmation(db, config, mailer, { id: user.id, email: row?.email ?? user.email });
      return res.json({
        ok: true,
        alreadyConfirmed: false,
        emailDelivery: mailOn() ? 'email' : 'not-configured',
        sent: result.delivered,
      });
    } catch (err) {
      return next(err);
    }
  });

  api.post('/email', async (req, res, next) => {
    try {
      const user = req.user!;
      if (emailUser.hit(user.id)) return tooMany(res, emailUser, user.id);
      if (!mailOn()) {
        return res.status(501).json({
          error: "email isn't set up on this server, so a new address can't be confirmed — it stays as it is",
          emailDelivery: 'not-configured',
        });
      }
      const newEmail = String(req.body?.newEmail ?? '').trim().toLowerCase();
      const currentPassword = String(req.body?.currentPassword ?? '');
      if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) {
        return res.status(400).json({ error: 'please give a valid email address' });
      }
      const row = (
        await db.query<{ email: string; password_hash: string }>('select email, password_hash from users where id = $1', [user.id])
      ).rows[0];
      if (!row || !(await verifyPassword(row.password_hash, currentPassword))) {
        return res.status(403).json({ error: 'current password is incorrect' });
      }
      if (newEmail === row.email) return res.status(400).json({ error: 'that is already the address on this account' });
      const taken = await db.query('select 1 from users where email = $1', [newEmail]);
      if (taken.rows.length) return res.status(409).json({ error: 'another account already uses that address' });
      const token = await issueConfirmation(db, user.id, 'change', newEmail);
      // email-kind: email-change-confirm
      const toNew = await mailer.send({ to: newEmail, ...changeConfirmEmail(config, confirmLink(config, token), row.email) });
      if (!toNew.delivered) {
        // The link never left: retire it, change nothing, say so.
        await db.query(`update email_confirmations set used_at = now() where token_hash = $1`, [tokenHash(token)]);
        console.warn(`email change confirmation not sent: ${toNew.reason}`);
        return res.status(502).json({ error: "the confirmation email couldn't be sent just now — nothing has changed; try again later" });
      }
      // The notice to the old address is a courtesy; its failure changes nothing.
      tasks.run(async () => {
        // email-kind: email-change-notice
        const notice = await mailer.send({ to: row.email, ...changeNoticeEmail(config, newEmail) });
        if (!notice.delivered) console.warn(`email change notice not sent: ${notice.reason}`);
      });
      return res.json({ ok: true, pendingEmail: newEmail, emailDelivery: 'email' });
    } catch (err) {
      return next(err);
    }
  });

  api.post('/email/cancel', async (req, res, next) => {
    try {
      const r = await db.query<{ id: string }>(
        `update email_confirmations set used_at = now()
         where user_id = $1 and purpose = 'change' and used_at is null returning id`,
        [req.user!.id],
      );
      return res.json({ ok: true, cancelled: r.rows.length });
    } catch (err) {
      return next(err);
    }
  });

  const TOO_LARGE = 'your data is larger than one download can hold — download your archive files one by one from the account page, then try again';

  // A look before the download, so the account page can show a refusal
  // instead of the browser saving the error as a file. Records nothing.
  api.get('/export/check', async (req, res, next) => {
    try {
      const user = req.user!;
      res.setHeader('Cache-Control', 'no-store');
      if (exportUser.wouldLimit(user.id)) {
        res.setHeader('Retry-After', String(exportUser.retryAfterSeconds(user.id)));
        return res.status(429).json({ error: 'too many attempts — please wait a little and try again' });
      }
      if ((await archiveBytesOf(db, user.id)) > ZIP_LIMIT_BYTES) return res.status(413).json({ error: TOO_LARGE });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  api.get('/export', async (req, res, next) => {
    try {
      const user = req.user!;
      if (exportUser.hit(user.id)) return tooMany(res, exportUser, user.id);
      const total = await archiveBytesOf(db, user.id);
      if (total > ZIP_LIMIT_BYTES) {
        return res.status(413).json({ error: TOO_LARGE });
      }
      const overview = await accountOverview(db, config, user.id, now());
      if (!overview) return res.status(401).json({ error: 'not signed in' });
      const plan = await accountPlan({ db, config, billing, now }, { id: user.id, createdAt: overview.user.createdAt });
      const exportedAt = now().toISOString();
      const day = exportedAt.slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="beuk-data-${day}.zip"`);
      res.setHeader('Cache-Control', 'no-store');
      const zip = new ZipWriter(res);
      try {
        const account = {
          exportedAt,
          server: config.appBaseUrl,
          email: overview.user.email,
          createdAt: overview.user.createdAt,
          emailConfirmedAt: overview.user.emailConfirmedAt,
          pendingEmail: overview.pendingEmail,
          plan: {
            subscriptionStatus: plan.subscription.status,
            label: plan.subscription.label,
            renewsAt: plan.subscription.renewsAt,
            cancelAtPeriodEnd: plan.subscription.cancelAtPeriodEnd,
          },
        };
        const { counts, missingFiles } = await writeAccountExport(db, config, user.id, now(), zip, account);
        await zip.add(
          'README.txt',
          exportReadme({ email: overview.user.email, exportedAt, appBaseUrl: config.appBaseUrl, counts, missingFiles }),
          { compress: true },
        );
        await zip.finish();
        res.end();
      } catch (err) {
        // Headers are out: the only honest move is to break the download
        // so the browser reports it failed instead of saving half a ZIP.
        console.error('account export failed mid-stream', err);
        res.destroy(err as Error);
      }
      return undefined;
    } catch (err) {
      return next(err);
    }
  });

  api.post('/delete', async (req, res, next) => {
    try {
      const user = req.user!;
      if (deleteUser.hit(user.id)) return tooMany(res, deleteUser, user.id);
      const phrase = String(req.body?.confirmPhrase ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const currentPassword = String(req.body?.currentPassword ?? '');
      if (phrase !== DELETE_PHRASE) {
        return res.status(400).json({ error: `type "${DELETE_PHRASE}" to confirm` });
      }
      const row = (await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [user.id])).rows[0];
      if (!row || !(await verifyPassword(row.password_hash, currentPassword))) {
        return res.status(403).json({ error: 'current password is incorrect' });
      }
      const billingOutcome = await cancelBillingForDeletedAccount({ db, billing }, user.id);
      const result = await deleteAccount(db, config, user.id, billingOutcome.leftForOperator);
      if (billingOutcome.leftForOperator.length) {
        console.warn(
          `account deleted with ${billingOutcome.leftForOperator.length} live Stripe subscription(s) left unattributed for the operator to cancel: ${billingOutcome.leftForOperator.join(', ')}`,
        );
      }
      clearSessionCookie(res, config.cookieSecure);
      return res.json({ ok: true, removed: result.removed, subscriptionsLeftForOperator: result.subscriptionsLeftForOperator, next: result.subscriptionsLeftForOperator ? '/account/deleted?subscription=left' : '/account/deleted' });
    } catch (err) {
      return next(err);
    }
  });

  return { pages, api };
}
