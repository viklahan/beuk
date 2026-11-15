import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { MailAttachment } from '../mailer.js';
import { clientDir } from '../warmth/pages.js';
import { escapeHtml } from './layout.js';

/**
 * The founding-reader invitation (owner-only; see routes/invite.ts).
 *
 * This is NOT the minimal account-email layout (src/email/layout.ts): it
 * is a designed, branded invite in Beuk's house style — cream paper, teal
 * ink, gold foil, the gilt "b" — sent to a handful of people by hand. The
 * logo rides along as an inline CID attachment because email clients drop
 * SVG and remote images; the browser preview uses a URL instead (a cid:
 * image does not render outside an email).
 */

export const INVITE_LOGO_CID = 'beuk-logo';
export const INVITE_SUBJECT = "You're one of the first into Beuk";

/** The greeting uses the first name only ("Marcus Vane" -> "Marcus"). */
export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first || 'there';
}

/** The logo PNG (client/assets/icon-192.png), read once and cached. Null
 *  when it cannot be read, in which case the email goes out without it. */
let logoPromise: Promise<Buffer | null> | undefined;
function logoBytes(): Promise<Buffer | null> {
  if (!logoPromise) {
    logoPromise = readFile(path.join(clientDir(), 'assets', 'icon-192.png')).catch(() => null);
  }
  return logoPromise;
}

function siteLabel(config: Config): string {
  return config.appBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The invite body as HTML. `logoSrc` is `cid:<cid>` for a real send and a
 *  URL for the in-browser preview. Everything is inline-styled and
 *  table-based so it survives an email client. */
export function inviteHtml(config: Config, firstName: string, logoSrc: string): string {
  const name = escapeHtml(firstName);
  const site = escapeHtml(config.appBaseUrl);
  const label = escapeHtml(siteLabel(config));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(INVITE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f4e9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4e9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="540" cellpadding="0" cellspacing="0" style="width:540px;max-width:100%;background:#fffdf4;border:1px solid #d5dcc9;border-radius:16px;">
<tr><td style="padding:36px 38px 30px;font-family:Arial,Helvetica,sans-serif;color:#22333a;">

  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:12px;vertical-align:middle;"><img src="${logoSrc}" width="42" alt="Beuk" style="display:block;border:0;width:42px;height:auto;"></td>
    <td style="vertical-align:middle;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:25px;line-height:1;color:#22333a;">beuk</div>
      <div style="font-size:9px;font-weight:bold;letter-spacing:3px;color:#14607a;text-transform:uppercase;padding-top:4px;">Beuk.Studio</div>
    </td>
  </tr></table>

  <div style="width:46px;height:2px;background:#c99b3f;margin:22px 0 16px;font-size:0;line-height:0;">&nbsp;</div>

  <div style="font-family:'Courier New',monospace;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#a87e2c;margin-bottom:12px;">Founding Reader &middot; By Invitation</div>

  <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;color:#22333a;margin-bottom:22px;">You&rsquo;re one of the first.</div>

  <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#22333a;">Hey ${name},</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#5d6d66;">I&rsquo;ve been building something on nights and weekends, and you&rsquo;re one of a small handful of people I&rsquo;m handing it to before anyone else &mdash; because I trust your eye.</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#5d6d66;"><span style="font-family:Georgia,'Times New Roman',serif;color:#22333a;">Beuk</span> takes a manuscript and turns it into a properly typeset book &mdash; print-ready and ebook &mdash; in minutes, with an AI editor riding along.</p>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#5d6d66;">What I want from you isn&rsquo;t a compliment. It&rsquo;s <strong style="color:#22333a;">the feel of the journey</strong>: bring a draft in, typeset it, send it out as a book &mdash; and notice where it glides and where it snags.</p>

  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#14607a;">
    <a href="${site}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;color:#f4fbfa;text-decoration:none;border-radius:999px;">Step into Beuk &rarr;</a>
  </td></tr></table>
  <div style="font-family:'Courier New',monospace;font-size:12px;color:#5d6d66;margin-top:10px;">${label}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 6px;background:#eef0e2;border:1px solid #d5dcc9;border-radius:12px;"><tr><td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-family:'Courier New',monospace;font-size:12px;font-weight:bold;color:#22333a;margin-bottom:12px;">When you&rsquo;re done, just hit reply and tell me three things:</div>
    <div style="font-size:14px;line-height:1.5;color:#5d6d66;margin-bottom:8px;"><span style="color:#c99b3f;">&#9679;</span>&nbsp;&nbsp;What made you smile?</div>
    <div style="font-size:14px;line-height:1.5;color:#22333a;font-weight:bold;margin-bottom:8px;"><span style="color:#14607a;">&#9679;</span>&nbsp;&nbsp;Where did the flow snag or lose you?</div>
    <div style="font-size:14px;line-height:1.5;color:#5d6d66;"><span style="color:#c99b3f;">&#9679;</span>&nbsp;&nbsp;What felt missing?</div>
  </td></tr></table>

  <p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;color:#5d6d66;margin:16px 0 0;">It lands straight in my inbox.</p>

  <div style="border-top:1px dashed #c99b3f;margin:26px 0 18px;font-size:0;line-height:0;">&nbsp;</div>

  <div style="font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:17px;color:#22333a;">&mdash; Beuk Studio</div>
  <div style="font-family:'Courier New',monospace;font-size:11px;color:#5d6d66;margin-top:10px;">${label} &middot; you&rsquo;re here because I trust your taste, not a mailing list</div>

</td></tr></table>
</td></tr></table>
</body>
</html>`;
}

/** The plain-text part (what a text-only client shows). */
export function inviteText(config: Config, firstName: string): string {
  return [
    `Hey ${firstName},`,
    '',
    "I've been building something on nights and weekends, and you're one of a small handful of people I'm handing it to before anyone else — because I trust your eye.",
    '',
    'Beuk takes a manuscript and turns it into a properly typeset book — print-ready and ebook — in minutes, with an AI editor riding along.',
    '',
    "What I want from you isn't a compliment. It's the feel of the journey: bring a draft in, typeset it, send it out as a book — and notice where it glides and where it snags.",
    '',
    `Step into Beuk: ${config.appBaseUrl}`,
    '',
    "When you're done, just hit reply and tell me three things:",
    '  - What made you smile?',
    '  - Where did the flow snag or lose you?',
    '  - What felt missing?',
    '',
    'It lands straight in my inbox.',
    '',
    '— Beuk Studio',
    `${siteLabel(config)} · you're here because I trust your taste, not a mailing list`,
  ].join('\n');
}

export interface InviteEmail {
  subject: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
}

/** Build the invite for one recipient: subject, both bodies, and the
 *  inline logo (when the asset can be read). */
export async function inviteEmail(config: Config, recipientName: string): Promise<InviteEmail> {
  const first = firstNameOf(recipientName);
  const html = inviteHtml(config, first, `cid:${INVITE_LOGO_CID}`);
  const text = inviteText(config, first);
  const logo = await logoBytes();
  const attachments: MailAttachment[] = logo
    ? [{ filename: 'beuk.png', content: logo, cid: INVITE_LOGO_CID, contentType: 'image/png' }]
    : [];
  return { subject: INVITE_SUBJECT, text, html, attachments };
}
