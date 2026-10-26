import type { Config } from '../config.js';

/**
 * The shared layout for every email Beuk sends to a writer.
 *
 * Each email supplies its own body twice, as plain-text lines and as
 * HTML built with the `html` tag below (which escapes every value it is
 * given), plus one sentence saying why it was sent. The layout adds the
 * same footer to both: why the email was sent, who sent it, and a link
 * to /account. There is no unsubscribe link because these are account
 * emails a writer caused (a sign-up, a reset request, an address
 * change), not a mailing list.
 *
 * The HTML is deliberately small: one centred column, inline styles,
 * no images, no remote fonts, no tracking pixel, no link rewriting.
 * Every message also carries the plain-text part, which is what a
 * text-only mail client shows.
 */

export interface EmailBody {
  subject: string;
  /** The plain-text body, one entry per line ('' for a blank line). */
  text: string[];
  /** The HTML body, made with the `html` tag. */
  html: SafeHtml;
  /** Why this email was sent, as a sentence fragment that completes
   *  "You got this email because …", e.g. "someone asked to reset the
   *  password for the Beuk account at this address". */
  reason: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** HTML that is already escaped. Only the `html` tag and `raw` make one. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Mark a string as already-safe HTML. For fixed markup only, never for
 *  a value that came from a writer, a request or a setting. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

type HtmlValue = string | number | SafeHtml | null | undefined | false | HtmlValue[];

function htmlValue(v: HtmlValue): string {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(htmlValue).join('');
  if (v instanceof SafeHtml) return v.value;
  return escapeHtml(String(v));
}

/** Tagged template: every interpolated value is escaped unless it is
 *  itself SafeHtml (from another `html` or from `raw`). */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0];
  values.forEach((v, i) => {
    out += htmlValue(v) + strings[i + 1];
  });
  return new SafeHtml(out);
}

const P = 'margin:0 0 14px;';
const LINK = 'color:#7a3e12;';

/** A paragraph in the house style. */
export function para(content: SafeHtml | string): SafeHtml {
  return html`<p style="${P}">${content}</p>`;
}

/** A link in the house style. */
export function link(href: string, label: string | SafeHtml): SafeHtml {
  return html`<a href="${href}" style="${LINK}">${label}</a>`;
}

/** The sender as the footer names it: MAIL_FROM when set. */
function senderLine(config: Config): string {
  return config.mailFrom ? `Sent by Beuk (${config.appBaseUrl}) from ${config.mailFrom}.` : `Sent by Beuk (${config.appBaseUrl}).`;
}

export function accountUrl(config: Config): string {
  return `${config.appBaseUrl}/account`;
}

/** Wrap one email's body in the shared footer and HTML skeleton. */
export function renderEmail(config: Config, body: EmailBody): RenderedEmail {
  const why = `You got this email because ${body.reason}.`;
  const text = [
    ...body.text,
    '',
    '--',
    why,
    senderLine(config),
    `Your account: ${accountUrl(config)}`,
  ].join('\n');

  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${body.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f6f1e7;">
<div style="max-width:34em;margin:0 auto;padding:28px 20px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.55;color:#2b2420;background:#fbf8f1;">
<p style="margin:0 0 18px;font-size:20px;font-weight:bold;letter-spacing:0.02em;">beuk</p>
${body.html}
<hr style="border:0;border-top:1px solid #e2d8c6;margin:22px 0 14px;">
<p style="margin:0 0 6px;font-size:13px;color:#6b625a;">${why}</p>
<p style="margin:0 0 6px;font-size:13px;color:#6b625a;">${senderLine(config)}</p>
<p style="margin:0;font-size:13px;color:#6b625a;">${link(accountUrl(config), 'Your account')}</p>
</div>
</body>
</html>
`;
  return { subject: body.subject, text, html: doc.value };
}
