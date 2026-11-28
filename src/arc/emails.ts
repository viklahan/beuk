import type { Config } from '../config.js';
import { escapeHtml, html, link, para, renderEmail, SafeHtml, type RenderedEmail } from '../email/layout.js';
import { arcDir, arcPlaceholderRe, arcT, type ArcKey, type ArcLang } from './strings.js';

/**
 * ARC campaigns: the reader emails, and the one account email the author
 * gets ("a reader is waiting").
 *
 * Reader emails go to people with no Beuk account, so they have their own
 * layout (renderArcEmail below), modelled on src/email/layout.ts and built
 * with its `html` tag and escaping (imported, not copied): the reader's
 * language and direction, and a footer saying why the email came, who it is
 * from ("<author>, through Beuk"), and the two links every reader email
 * carries, "Not you?" (Not me: no email from any author, ever) and "No more
 * email from <author>" (Stop). There is no "Your account" link. The same
 * Stop link goes in the List-Unsubscribe header (src/arc/mail.ts).
 *
 * Every string comes from src/arc/strings.ts through t('…'). A builder
 * only renders; sending is sendArcMail's job, which checks suppression and
 * the limits first.
 */

export interface ArcMailContext {
  lang: ArcLang;
  title: string;
  author: string;
  mailToken: string;
}

export function arcActionUrl(config: Config, mailToken: string, action: 'not-me' | 'stop'): string {
  return `${config.appBaseUrl}/arc/m/${mailToken}/${action}`;
}

type Vars = Record<string, string | number | SafeHtml>;

/** A string-table line as HTML: the literal parts escaped, each {name}
 *  filled once from `vars` (SafeHtml as it is, anything else escaped). */
function htmlLine(template: string, vars: Vars): SafeHtml {
  let out = '';
  let last = 0;
  for (const m of template.matchAll(arcPlaceholderRe())) {
    out += escapeHtml(template.slice(last, m.index));
    const v = Object.prototype.hasOwnProperty.call(vars, m[1]) ? vars[m[1]] : m[0];
    out += v instanceof SafeHtml ? v.value : escapeHtml(String(v));
    last = (m.index ?? 0) + m[0].length;
  }
  return new SafeHtml(out + escapeHtml(template.slice(last)));
}

/** t for text and h for HTML, over the same line. */
function strings(lang: ArcLang) {
  const t = arcT(lang);
  const h = (key: ArcKey, vars: Vars = {}) => htmlLine(t(key), vars);
  return { t, h };
}

interface ArcBody {
  subject: string;
  /** Plain-text lines ('' for a blank line). */
  text: string[];
  html: SafeHtml;
}

const FOOT = 'margin:0 0 6px;font-size:13px;color:#6b625a;';

/** Wrap one reader email in the reader footer and the HTML skeleton. */
function renderArcEmail(config: Config, ctx: ArcMailContext, body: ArcBody): RenderedEmail {
  const { t, h } = strings(ctx.lang);
  const notMeUrl = arcActionUrl(config, ctx.mailToken, 'not-me');
  const stopUrl = arcActionUrl(config, ctx.mailToken, 'stop');
  const text = [
    ...body.text,
    '',
    '--',
    t('arc.mail.why', { title: ctx.title }),
    t('arc.mail.who', { author: ctx.author }),
    t('arc.mail.notMe', { url: notMeUrl }),
    t('arc.mail.stop', { author: ctx.author, url: stopUrl }),
  ].join('\n');

  const doc = html`<!doctype html>
<html lang="${ctx.lang}" dir="${arcDir(ctx.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${body.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f6f1e7;">
<div style="max-width:34em;margin:0 auto;padding:28px 20px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.55;color:#2b2420;background:#fbf8f1;">
${body.html}
<hr style="border:0;border-top:1px solid #e2d8c6;margin:22px 0 14px;">
<p style="${FOOT}">${h('arc.mail.why', { title: ctx.title })}</p>
<p style="${FOOT}">${h('arc.mail.who', { author: ctx.author })}</p>
<p style="${FOOT}">${h('arc.mail.notMe', { url: link(notMeUrl, notMeUrl) })}</p>
<p style="margin:0;font-size:13px;color:#6b625a;">${h('arc.mail.stop', { author: ctx.author, url: link(stopUrl, stopUrl) })}</p>
</div>
</body>
</html>
`;
  return { subject: body.subject, text, html: doc.value };
}

/** The copy link, the stamp note and the review line: what a reader gets
 *  with a copy (ready and approved). */
function copyLines(ctx: ArcMailContext, copyUrl: string): { text: string[]; html: SafeHtml } {
  const { t, h } = strings(ctx.lang);
  return {
    text: [t('arc.mail.copyLink', { url: copyUrl }), '', t('arc.mail.stampNote'), '', t('arc.mail.review')],
    html: html`${para(h('arc.mail.copyLink', { url: link(copyUrl, copyUrl) }))}
${para(t('arc.mail.stampNote'))}
${para(t('arc.mail.review'))}`,
  };
}

/**
 * The code that confirms the address. It names the name the code confirms
 * (final review Important 1: an unverified claim's name is the one typed
 * with its newest code) and carries the code page's link with its ref
 * (ruling C6), so the address's real owner can use a code someone else
 * asked for — the email only ever reaches that address.
 */
export function arcCodeEmail(config: Config, ctx: ArcMailContext, code: string, about: { name: string; codePage: string }): RenderedEmail {
  // email-kind: arc-code
  const { t, h } = strings(ctx.lang);
  const v = { title: ctx.title, author: ctx.author };
  return renderArcEmail(config, ctx, {
    subject: t('arc.mail.code.subject', v),
    text: [
      t('arc.mail.code.lead', { code }),
      '',
      t('arc.mail.code.body', v),
      t('arc.mail.code.link', { url: about.codePage }),
      '',
      t('arc.mail.code.for', { name: about.name }),
      '',
      t('arc.mail.code.ignore'),
    ],
    html: html`${para(h('arc.mail.code.lead', { code: html`<strong style="font-size:20px;letter-spacing:0.12em;">${code}</strong>` }))}
${para(t('arc.mail.code.body', v))}
${para(h('arc.mail.code.link', { url: link(about.codePage, about.codePage) }))}
${para(h('arc.mail.code.for', { name: html`<bdi>${about.name}</bdi>` }))}
${para(t('arc.mail.code.ignore'))}`,
  });
}

export function arcReadyEmail(config: Config, ctx: ArcMailContext, copyUrl: string): RenderedEmail {
  // email-kind: arc-ready
  const { t } = strings(ctx.lang);
  const v = { title: ctx.title, author: ctx.author };
  const copy = copyLines(ctx, copyUrl);
  return renderArcEmail(config, ctx, {
    subject: t('arc.mail.ready.subject', v),
    text: [t('arc.mail.ready.lead', v), '', ...copy.text],
    html: html`${para(t('arc.mail.ready.lead', v))}
${copy.html}`,
  });
}

export function arcPendingEmail(config: Config, ctx: ArcMailContext): RenderedEmail {
  // email-kind: arc-pending
  const { t } = strings(ctx.lang);
  const v = { title: ctx.title, author: ctx.author };
  return renderArcEmail(config, ctx, {
    subject: t('arc.mail.pending.subject', v),
    text: [t('arc.mail.pending.lead', v), '', t('arc.mail.pending.body', v)],
    html: html`${para(t('arc.mail.pending.lead', v))}
${para(t('arc.mail.pending.body', v))}`,
  });
}

export function arcApprovedEmail(config: Config, ctx: ArcMailContext, copyUrl: string): RenderedEmail {
  // email-kind: arc-approved
  const { t } = strings(ctx.lang);
  const v = { title: ctx.title, author: ctx.author };
  const copy = copyLines(ctx, copyUrl);
  return renderArcEmail(config, ctx, {
    subject: t('arc.mail.approved.subject', v),
    text: [t('arc.mail.approved.lead', v), '', ...copy.text],
    html: html`${para(t('arc.mail.approved.lead', v))}
${copy.html}`,
  });
}

export function arcDeclinedEmail(config: Config, ctx: ArcMailContext): RenderedEmail {
  // email-kind: arc-declined
  const { t } = strings(ctx.lang);
  const v = { title: ctx.title, author: ctx.author };
  return renderArcEmail(config, ctx, {
    subject: t('arc.mail.declined.subject', v),
    text: [t('arc.mail.declined.lead', v), '', t('arc.mail.declined.body', v)],
    html: html`${para(t('arc.mail.declined.lead', v))}
${para(t('arc.mail.declined.body', v))}`,
  });
}

/** To the author (account mail, English like every account email, in the
 *  account layout): readers are waiting for approval. Wording: Task 2's,
 *  V's to change. */
export function arcAuthorWaitingEmail(config: Config, title: string, waiting: number): RenderedEmail {
  // email-kind: arc-author-waiting
  const who = waiting === 1 ? '1 reader is' : `${waiting} readers are`;
  const studio = `${config.appBaseUrl}/studio/`;
  return renderEmail(config, {
    subject: `${waiting === 1 ? 'A reader is' : 'Readers are'} waiting for your approval: ${title}`,
    text: [
      `${who} waiting for your approval for an advance copy of ${title}.`,
      '',
      `Open the book in the studio to approve or decline each one: ${studio}`,
      '',
      'Beuk sends this email at most once a day.',
    ],
    html: html`${para(`${who} waiting for your approval for an advance copy of ${title}.`)}
${para(html`Open the book in the studio to approve or decline each one: ${link(studio, studio)}`)}
${para('Beuk sends this email at most once a day.')}`,
    reason: 'you run an advance-copy campaign for this book in which you approve each reader',
  });
}
