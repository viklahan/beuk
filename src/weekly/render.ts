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
 *   /school/weekly                    the latest issue's front page
 *   /school/weekly/<n>                issue n's front page
 *   /school/weekly/<n>/<story>        one story
 *   /school/weekly/<n>/img/<file>     a picture from the issue's folder
 *
 * An issue that carries a weather reading wears the Beuk lockup in its
 * left ear (the site header's own mark and wordmark) and "The Weather
 * Elsewhere" in its right; one that does not keeps the forecast and late
 * news. Short stories print whole under the lead, then the takeaway box
 * and the Sources foot. Every issue closes on the same imprint.
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

function masthead(config: Config, issue: Issue): string {
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
        </div>${issue.note ? `
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
  const earlier = weekly.issues.filter((i) => i.number !== issue.number).reverse();
  // "Earlier" is only true on the newest issue; an older one lists the later ones too.
  const earlierLabel = earlier.some((i) => i.number > issue.number) ? 'Other issues' : 'Earlier issues';
  const leadHead = lead.frontHead ?? lead.title;
  const side = issue.front.length + issue.briefs.length + issue.notices.length > 0;
  const body = `        <div class="paper">
        ${masthead(config, issue)}
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
        ${
          earlier.length
            ? `<section class="earlier" aria-label="${earlierLabel}"><p class="kick">${earlierLabel}</p><ul>${earlier
                .map((i) => `<li><a href="${issueUrl(i.number)}">No. ${i.number} · ${esc(weekLabel(i.week))} · ${esc(i.banner)}</a></li>`)
                .join('')}</ul></section>`
            : ''
        }
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
