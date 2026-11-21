import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { MARK, schoolPage } from '../school/render.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import type { Issue, Story, StoryBlock, WeeklyContent } from './content.js';

/**
 * Beuk Weekly pages, in the School's shell (Beuk's own top bar and footer,
 * the Beuk Weekly tab current) with the paper inside: black ink on white,
 * after the 1920s broadsheets chosen on 2026-10-28. Styles:
 * client/site/weekly.css; faces: /assets/fonts/fonts-weekly.css.
 *
 *   /school/weekly                    the stand: every issue as a front-page tile
 *   /school/weekly/<n>                issue n's front page
 *   /school/weekly/<n>/<story>        one story
 *   /school/weekly/<n>/img/<file>     a picture from the issue's folder
 *
 * An issue that carries a weather reading wears the Beuk lockup in its
 * left ear (the site header's own mark and wordmark) and "The Weather
 * Elsewhere" in its right; one that does not keeps the forecast and late
 * news. Under the dateline rule, the issue bar: previous, next, "No. n of
 * N", "All issues" (the stand) and, on a back issue, the newest. Short stories print
 * whole under the lead, then the takeaway box, the Sources foot and the
 * shelf of all issues (#issues). Every issue closes on the same imprint.
 *
 * The printed edition link appears only when that issue's PDF is on the
 * server (<SCHOOL_MEDIA_DIR>/weekly/en/issue-NNN.pdf). Nothing is shown for
 * a file that is not there.
 */

const CSS = ['/assets/fonts/fonts-weekly.css', '/site/weekly.css'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekLabel(week: string): string {
  const [y, m, d] = week.split('-').map(Number);
  return `Week of ${d} ${MONTHS[m - 1]} ${y}`;
}
const pad = (n: number) => String(n).padStart(3, '0');
export const issueUrl = (n: number) => `/school/weekly/${n}`;
export const storyUrl = (s: Story) => `/school/weekly/${s.issue}/${s.slug}`;
const imageUrl = (s: Story) => `/school/weekly/${s.issue}/img/${s.image}`;

export function printedEdition(config: Config, issue: Issue): string | null {
  const file = `issue-${pad(issue.number)}.pdf`;
  return existsSync(path.join(config.schoolMediaDir, 'weekly', 'en', file)) ? `/school/media/weekly/en/${file}` : null;
}

function figure(s: Story, alt: string): string {
  if (!s.image) return '';
  return `<figure><img src="${esc(imageUrl(s))}" alt="${esc(alt)}" loading="lazy" />${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ''}</figure>`;
}

function blocksHtml(blocks: StoryBlock[], dropFirst: boolean): string {
  let dropped = !dropFirst;
  return blocks
    .map((b) => {
      if (b.kind === 'sub') return `<p class="subhead">${esc(b.text)}</p>`;
      if (b.kind === 'pull') return `<p class="pull">${b.html}</p>`;
      if (b.kind === 'why') return `<div class="why"><b>Why it matters</b>${b.html}</div>`;
      const cls = dropped ? '' : ' class="drop"';
      dropped = true;
      return `<p${cls}>${b.html}</p>`;
    })
    .join('\n          ');
}

/**
 * The issue bar, under the dateline rule: the previous and next issue when
 * there is one, where this issue stands ("No. 3 of 5"), "All issues" (the
 * stand, /school/weekly), and on a back issue the newest one. Numbers come
 * from the issue folders, never typed.
 */
function issueBar(weekly: WeeklyContent, issue: Issue): string {
  // A single issue has nowhere to go; the dateline already gives its number.
  if (weekly.issues.length < 2) return '';
  const newest = weekly.latest!;
  const prev = weekly.issueByNumber.get(issue.number - 1);
  const next = weekly.issueByNumber.get(issue.number + 1);
  const parts = [
    prev ? `<a class="ib-prev" href="${issueUrl(prev.number)}" rel="prev">‹ No. ${prev.number}</a>` : '',
    `<span class="ib-pos"><a href="${issueUrl(issue.number)}" aria-current="page">No. ${issue.number}</a> of ${weekly.issues.length}</span>`,
    '<a class="ib-all" href="/school/weekly">All issues</a>',
    // On the issue just before the newest, "next" and "newest" are one link, said once.
    next && next.number !== newest.number ? `<a class="ib-next" href="${issueUrl(next.number)}" rel="next">No. ${next.number} ›</a>` : '',
    newest.number !== issue.number
      ? `<a class="ib-new" href="${issueUrl(newest.number)}"${next?.number === newest.number ? ' rel="next"' : ''}>Newest issue: No. ${newest.number} ›</a>`
      : '',
  ].filter(Boolean);
  return `<nav class="issue-bar" aria-label="Beuk Weekly issues">
          ${parts.join('\n          ')}
        </nav>`;
}

/** The shelf at the foot of every issue: all of them, newest first, the one being read marked. */
function issueShelf(weekly: WeeklyContent, issue: Issue): string {
  if (weekly.issues.length < 2) return '';
  const rows = [...weekly.issues]
    .reverse()
    .map(
      (i) =>
        `<li${i.number === issue.number ? ' class="current"' : ''}><a href="${issueUrl(i.number)}"${i.number === issue.number ? ' aria-current="page"' : ''}><span class="is-no">No. ${i.number}</span><span class="is-week">${esc(weekLabel(i.week))}</span><span class="is-head">${esc(i.banner)}</span></a></li>`,
    )
    .join('\n            ');
  return `<section class="issues" id="issues" aria-labelledby="issues-h">
          <h2 id="issues-h">All issues</h2>
          <ol>
            ${rows}
          </ol>
        </section>`;
}

function masthead(config: Config, weekly: WeeklyContent, issue: Issue): string {
  const pdf = printedEdition(config, issue);
  const wx = issue.weather;
  const left = wx
    ? `<div class="ear logo-ear">${MARK}<span class="word">beuk</span><span class="sub">beuk.studio</span></div>`
    : `<div class="ear"><b>Shipping forecast</b>${esc(issue.forecast)}</div>`;
  const right = wx
    ? `<div class="ear wx"><b>The Weather Elsewhere</b>${wx.icon ?? ''}${esc(wx.place)}<br />${esc(wx.reading)}${wx.note ? `<span class="wx-note">${esc(wx.note)}</span>` : ''}</div>`
    : `<div class="ear late"><b>Late news</b>${issue.late.map((l) => esc(l)).join('<br />')}<span class="stars" aria-hidden="true">★ ★</span></div>`;
  return `<header class="mast${wx ? ' news' : ''}">
          ${left}
          <div>
            <h1>Beuk Weekly</h1>
            <p class="mast-tag">${esc(issue.tagline ?? 'And Complete Self-Publishing News')}</p>
          </div>
          ${right}
        </header>
        <div class="dateline">
          <span>Vol. ${esc(issue.volume)} · No. ${issue.number}</span>
          <span>${esc(weekLabel(issue.week))}</span>
          ${issue.price ? `<span>${esc(issue.price)}</span>` : ''}
          <span>beuk.studio/school/weekly</span>
          ${pdf ? `<a href="${esc(pdf)}">This issue as a printed PDF</a>` : '<span>Free every week</span>'}
        </div>
        ${issueBar(weekly, issue)}${issue.note ? `
        <p class="mast-note">${esc(issue.note)}</p>` : ''}`;
}

function frontStory(s: Story): string {
  return `<article class="story">
              <p class="kick">${esc(s.section)}</p>
              <h3><a href="${esc(storyUrl(s))}">${esc(s.title)}</a></h3>
              <p class="by">${esc(s.byline)}</p>
              <p>${esc(s.summary ?? '')}</p>
            </article>`;
}

/** A short story, whole: its paragraphs with their links, and its "Why it matters". */
function shortStory(s: Story): string {
  return `<article class="story short">
              <p class="kick">${esc(s.section)}</p>
              <h3><a href="${esc(storyUrl(s))}">${esc(s.title)}</a></h3>
              ${blocksHtml(s.blocks, false)}
            </article>`;
}

function takeaway(s: Story): string {
  return `<section class="takeaway" aria-label="${esc(s.title)}">
          <h3>${esc(s.title)}</h3>
          ${s.deck ? `<p class="sub">${esc(s.deck)}</p>` : ''}
          <ol>${s.blocks.filter((b) => b.kind === 'p').map((b) => `<li><span>${b.html}</span></li>`).join('')}</ol>
        </section>`;
}

export function renderIssue(config: Config, weekly: WeeklyContent, issue: Issue): string {
  const lead = issue.lead;
  const leadParas = lead.blocks.filter((b) => b.kind === 'p').slice(0, 3);
  const briefs = issue.briefs.length
    ? `<p class="kick">In brief</p>
            <ul>${issue.briefs.map((b) => `<li><h4>${esc(b.title)}</h4>${b.blocks.filter((x) => x.kind === 'p').map((x) => `<p>${x.html}</p>`).join('')}</li>`).join('')}</ul>`
    : '';
  const notices = issue.notices
    .map(
      (n) => `<div class="notice">
              <p class="kick">${esc(n.section)}</p>
              <h4>${esc(n.title)}</h4>
              ${n.blocks.filter((x) => x.kind === 'p').map((x) => `<p>${x.html}</p>`).join('')}
              ${n.link ? `<a class="get" href="${esc(n.link)}">Get it →</a>` : ''}
            </div>`,
    )
    .join('');
  const leadHead = lead.frontHead ?? lead.title;
  const side = issue.front.length + issue.briefs.length + issue.notices.length > 0;
  const body = `        <div class="paper">
        ${masthead(config, weekly, issue)}
        <a class="banner" href="${esc(storyUrl(lead))}">${esc(issue.banner)}</a>
        <p class="banner-deck">${esc(issue.bannerDeck)}</p>
        <div class="front${side ? '' : ' solo'}">
          <article class="lead">
            <p class="kick">${esc(lead.section)}</p>
            ${leadHead === issue.banner ? '' : `<h2><a href="${esc(storyUrl(lead))}">${esc(leadHead)}</a></h2>`}
            <p class="by">By ${esc(lead.byline)}</p>
            ${figure(lead, lead.caption ?? lead.title)}
            <div class="cols">
          ${blocksHtml(leadParas, true)}
            </div>
            <a class="more" href="${esc(storyUrl(lead))}">Continue reading →</a>
          </article>
          ${
            side
              ? `<div class="col2">
            ${issue.front.map(frontStory).join('\n            ')}
          </div>
          <aside class="col3 brief">
            ${briefs}
            ${notices}
          </aside>`
              : ''
          }
        </div>
        ${issue.shorts.length ? `<section class="shorts" aria-label="More news">${issue.shorts.map(shortStory).join('')}</section>` : ''}
        ${issue.fold.length ? `<section class="fold" aria-label="Below the fold">${issue.fold.map(frontStory).join('')}</section>` : ''}
        ${issue.takeaways.map(takeaway).join('')}
        ${
          issue.sources.length
            ? `<section class="sources" aria-label="Sources">${issue.sourcesHead ? `<h4>${esc(issue.sourcesHead)}</h4>` : ''}<ul>${issue.sources.map((x) => `<li>${x.html}</li>`).join('')}</ul></section>`
            : ''
        }
        ${issueShelf(weekly, issue)}
        <footer class="imprint">
          <span>Printed and published by Beuk</span>
          <span>Free every week</span>
          <span>Printed on recycled electrons</span>
        </footer>
        </div>`;
  return schoolPage(config, {
    title: `Beuk Weekly, No. ${issue.number} — ${issue.banner}`,
    description: `${issue.banner}. ${issue.bannerDeck}. Beuk Weekly, ${weekLabel(issue.week)}.`,
    path: issueUrl(issue.number),
    body,
    tab: 'weekly',
    css: CSS,
    bodyClass: 'weekly',
  });
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
/** How many other headlines the newest issue's tile names. */
export const TILE_INSIDE = 4;

/**
 * One issue on the stand, as a small front page: the nameplate, the number
 * and week, the banner headline and its deck. The whole tile is one link to
 * the issue, then the lead's opening paragraph for as far as the tile runs.
 * The newest issue's tile is the large one: it also carries the lead's
 * picture when the issue has one and the other headlines of the issue.
 * Everything comes from the issue files.
 */
function standTile(issue: Issue, latest: boolean): string {
  const lead = issue.lead;
  const opening = lead.blocks.find((b) => b.kind === 'p');
  const inside = [...issue.front, ...issue.shorts, ...issue.fold].slice(0, TILE_INSIDE);
  const pic = lead.image ? `
              <img class="t-pic" src="${esc(imageUrl(lead))}" alt="" loading="lazy" />` : '';
  const more = latest
    ? `${inside.length ? `
              <div class="t-inside"><p>Also in this issue</p><ul>${inside.map((s) => `<li>${esc(s.title)}</li>`).join('')}</ul></div>` : ''}
              <span class="t-open">Read No. ${issue.number}</span>`
    : '';
  return `<li class="tile${latest ? ' latest' : ''}">
            <a href="${issueUrl(issue.number)}">
              <span class="t-plate">Beuk Weekly</span>
              <span class="t-date"><span>No. ${issue.number}${latest ? ' · Latest issue' : ''}</span><span>${esc(weekLabel(issue.week))}</span></span>
              <h2 class="t-banner">${esc(issue.banner)}</h2>
              <p class="t-deck">${esc(issue.bannerDeck)}</p>${latest && lead.image ? pic : ''}${opening && opening.kind === 'p' ? `
              <p class="t-lead">${esc(opening.text)}</p>` : ''}${more}
            </a>
          </li>`;
}

/**
 * The stand (/school/weekly): every issue as a tile, newest first. The
 * newest is the large tile in the middle; the back issues are small tiles
 * round it and, once there are more than four of them, in rows beneath.
 * Each tile opens its issue.
 */
export function renderStand(config: Config, weekly: WeeklyContent): string {
  const newest = weekly.latest!;
  const back = [...weekly.issues].reverse().filter((i) => i.number !== newest.number);
  const n = weekly.issues.length;
  const count = `${COUNT_WORDS[n] ?? n} ${n === 1 ? 'issue' : 'issues'}`;
  const body = `        <div class="paper">
        <header class="mast">
          <div></div>
          <div>
            <h1>Beuk Weekly</h1>
            <p class="mast-tag">${esc(newest.tagline ?? 'And Complete Self-Publishing News')}</p>
          </div>
          <div></div>
        </header>
        <div class="dateline">
          <span>${count} on the stand</span>
          <span>Newest first</span>
          <span>Free every week</span>
        </div>
        <ol class="stand" aria-label="Every issue of Beuk Weekly, newest first">
          ${[standTile(newest, true), ...back.map((i) => standTile(i, false))].join('\n          ')}
        </ol>
        <footer class="imprint">
          <span>Printed and published by Beuk</span>
          <span>Free every week</span>
          <span>Printed on recycled electrons</span>
        </footer>
        </div>`;
  return schoolPage(config, {
    title: 'Beuk Weekly — every issue',
    description: `Beuk Weekly, the School’s newspaper for writers who publish their own books. ${count}; the newest: ${newest.banner}.`,
    path: '/school/weekly',
    body,
    tab: 'weekly',
    css: CSS,
    bodyClass: 'weekly',
  });
}

export function renderStory(config: Config, issue: Issue, s: Story): string {
  const stories = [issue.lead, ...issue.front, ...issue.shorts, ...issue.fold];
  const next = stories[stories.indexOf(s) + 1];
  const blocks = s.blocks;
  // The picture sits after the first subhead (or the second paragraph), the way a column carries it.
  const at = Math.max(blocks.findIndex((b) => b.kind === 'sub'), Math.min(2, blocks.length));
  const html = blocksHtml(blocks.slice(0, at), true) + figure(s, s.caption ?? s.title) + blocksHtml(blocks.slice(at), false);
  const body = `        <div class="paper">
        <header class="art-mast">
          <a class="m" href="${issueUrl(issue.number)}">Beuk Weekly</a>
          <span>Vol. ${esc(issue.volume)} · No. ${issue.number} · ${esc(weekLabel(issue.week))}</span>
        </header>
        <article class="article">
          <p class="kick">${esc(s.section)}</p>
          <h2>${esc(s.title)}</h2>
          ${s.deck ? `<p class="deck">${esc(s.deck)}</p>` : ''}
          <p class="by"><span>By ${esc(s.byline)}</span><span>${s.readMinutes} min read</span></p>
          <div class="cols">
          ${html}
          </div>
        </article>
        <nav class="art-foot" aria-label="This issue">
          <a href="${issueUrl(issue.number)}">← Front page</a>
          ${next ? `<a href="${esc(storyUrl(next))}">Next: ${esc(next.title)} →</a>` : ''}
        </nav>
        </div>`;
  return schoolPage(config, {
    title: `${s.title} — Beuk Weekly`,
    description: s.deck ?? s.summary ?? s.title,
    path: storyUrl(s),
    body,
    tab: 'weekly',
    css: CSS,
    bodyClass: 'weekly',
  });
}

export function renderWeeklyEmpty(config: Config): string {
  return schoolPage(config, {
    title: 'Beuk Weekly',
    description: 'Beuk Weekly, the School’s newspaper.',
    path: '/school/weekly',
    body: `        <div class="paper"><header class="mast"><div></div><div><h1>Beuk Weekly</h1><p class="mast-tag">The first issue is on the press</p></div><div></div></header></div>`,
    tab: 'weekly',
    css: CSS,
    bodyClass: 'weekly',
  });
}
