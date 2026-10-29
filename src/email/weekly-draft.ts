import type { Config } from '../config.js';
import { html, link, para, raw, renderEmail, type RenderedEmail, type SafeHtml } from './layout.js';

/**
 * The Beuk Weekly press's two emails to the editor (WEEKLY_EDITOR_EMAIL,
 * else ALERT_EMAIL; spec 2026-10-29). Never to readers: a reader
 * newsletter would be its own decision, with consent and unsubscribe.
 *
 *   weekly-draft-ready   the drafter uploaded an issue: the preview link,
 *                        the headlines, every outside story's sources,
 *                        what was dropped and why, the outlets read (so
 *                        the editor can veto one), stories without a
 *                        picture, and the commit it was written from.
 *   weekly-draft-failed  the drafter could not produce a draft this week,
 *                        and why ("no draft this week" is never silent).
 */

export interface WeeklyDraftMail {
  previewUrl: string;
  banner: string;
  sourceCommit: string;
  headlines: string[];
  sources: { title: string; urls: string[] }[];
  dropped: { title: string; why: string }[];
  outlets: string[];
  noPictures: string[];
}

const REASON = 'this address is the Beuk Weekly editor on this server (WEEKLY_EDITOR_EMAIL, or ALERT_EMAIL)';

function list(items: (string | SafeHtml)[], none: string): SafeHtml {
  if (!items.length) return para(none);
  return html`<ul style="margin:0 0 14px;padding-left:20px;">${items.map((i) => html`<li>${i}</li>`)}</ul>`;
}
const heading = (t: string) => html`<p style="margin:18px 0 6px;font-weight:bold;">${t}</p>`;
const lines = (items: string[], none: string) => (items.length ? items.map((i) => `  - ${i}`) : [`  ${none}`]);

export function weeklyDraftEmail(config: Config, d: WeeklyDraftMail): RenderedEmail {
  const sourced = d.sources.filter((s) => s.urls.length);
  const text = [
    'A new Beuk Weekly issue is drafted and waiting for you.',
    'Nothing goes live until you press Approve and publish on the preview page.',
    '',
    `Preview: ${d.previewUrl}`,
    `Written from commit: ${d.sourceCommit}`,
    '',
    'Headlines:',
    ...lines(d.headlines, '(none)'),
    '',
    'Outside stories and their sources:',
    ...(sourced.length ? sourced.flatMap((s) => [`  ${s.title}`, ...s.urls.map((u) => `    ${u}`)]) : ['  (no outside stories)']),
    '',
    'Dropped (could not be sourced):',
    ...lines(d.dropped.map((x) => `${x.title}: ${x.why}`), '(nothing dropped)'),
    '',
    'Outlets read this week (veto any):',
    ...lines(d.outlets, '(none)'),
    '',
    'Stories without a picture:',
    ...lines(d.noPictures, '(every story that wanted one has one)'),
    '',
    'To change it, press Send back on the preview page and write what to change.',
  ];
  const body = html`${para('A new Beuk Weekly issue is drafted and waiting for you. Nothing goes live until you press Approve and publish on the preview page.')}
${para(link(d.previewUrl, 'Open the preview'))}
${para(html`Written from commit <code>${d.sourceCommit}</code>.`)}
${heading('Headlines')}${list(d.headlines, '(none)')}
${heading('Outside stories and their sources')}${
    sourced.length
      ? list(
          sourced.map((s) => html`${s.title}<br>${s.urls.map((u, i) => html`${i ? raw('<br>') : ''}${link(u, u)}`)}`),
          '',
        )
      : para('(no outside stories)')
  }
${heading('Dropped (could not be sourced)')}${list(d.dropped.map((x) => `${x.title}: ${x.why}`), '(nothing dropped)')}
${heading('Outlets read this week (veto any)')}${list(d.outlets, '(none)')}
${heading('Stories without a picture')}${list(d.noPictures, '(every story that wanted one has one)')}
${para('To change it, press Send back on the preview page and write what to change.')}`;
  return renderEmail(config, { subject: `Beuk Weekly draft ready: ${d.banner}`, text, html: body, reason: REASON });
}

export function weeklyDraftFailedEmail(config: Config, reason: string): RenderedEmail {
  return renderEmail(config, {
    subject: 'Beuk Weekly: no draft this week',
    text: ['The Beuk Weekly drafter could not produce a draft this run.', '', `Why: ${reason}`, '', 'The daily run tries again; the log is on the Legion under %LOCALAPPDATA%\\beuk-weekly\\logs.'],
    html: html`${para('The Beuk Weekly drafter could not produce a draft this run.')}
${para(html`Why: ${reason}`)}
${para('The daily run tries again; the log is on the Legion under %LOCALAPPDATA%\\beuk-weekly\\logs.')}`,
    reason: REASON,
  });
}
