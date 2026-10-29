import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { schoolPage } from '../school/render.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import type { Issue, Story, StoryBlock, WeeklyContent } from './content.js';

/**
 * Beuk Weekly pages, in the School's shell (Beuk's own top bar and footer,
 * the Beuk Weekly tab current) with the paper inside: black ink on white,
 * after the 1920s broadsheets V chose (2026-10-28). Styles:
 * client/site/weekly.css; faces: /assets/fonts/fonts-weekly.css.
 *
 *   /school/weekly                    the latest issue's front page
 *   /school/weekly/<n>                issue n's front page
 *   /school/weekly/<n>/<story>        one story
 *   /school/weekly/<n>/img/<file>     a picture from the issue's folder
 *
 * A draft's preview (src/weekly/preview.ts) renders the same pages under
 * another base, /school/weekly/draft/<id>, so a preview never links into
 * the live paper. A generated illustration's caption ends with
 * ILLUSTRATION_LINE, so no reader takes one for a photograph or a
 * screenshot.
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
export const ILLUSTRATION_LINE = 'Illustration, generated for Beuk Weekly.';

export interface RenderOpts {
  /** Where the issue lives: stories are <base>/<slug>, pictures <base>/img/<file>. Default /school/weekly/<n>. */
  base?: string;
  /** HTML set above the paper (the press bar on a draft preview). */
  preview?: string;
  /** Passed to the page shell (a draft preview is noindex and loads its script). */
  robots?: string;
  scripts?: string[];
}
const baseOf = (s: Story, o: RenderOpts) => o.base ?? issueUrl(s.issue);
export const storyUrl = (s: Story, o: RenderOpts = {}) => `${baseOf(s, o)}/${s.slug}`;
const imageUrl = (s: Story, o: RenderOpts) => `${baseOf(s, o)}/img/${s.image}`;

export function captionText(s: Story): string | null {
  if (!s.illustration) return s.caption;
  return s.caption ? `${s.caption} ${ILLUSTRATION_LINE}` : ILLUSTRATION_LINE;
}

export function printedEdition(config: Config, issue: Issue): string | null {
  const file = `issue-${pad(issue.number)}.pdf`;
  return existsSync(path.join(config.schoolMediaDir, 'weekly', 'en', file)) ? `/school/media/weekly/en/${file}` : null;
}

function figure(s: Story, alt: string, o: RenderOpts): string {
  if (!s.image) return '';
  const caption = captionText(s);
  return `<figure><img src="${esc(imageUrl(s, o))}" alt="${esc(alt)}" loading="lazy" />${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}

function blocksHtml(blocks: StoryBlock[], dropFirst: boolean): string {
  let dropped = !dropFirst;
  return blocks
    .map((b) => {
      if (b.kind === 'sub') return `<p class="subhead">${esc(b.text)}</p>`;
      if (b.kind === 'pull') return `<p class="pull">${b.html}</p>`;
      const cls = dropped ? '' : ' class="drop"';
      dropped = true;
      return `<p${cls}>${b.html}</p>`;
    })
    .join('\n          ');
}

function masthead(config: Config, issue: Issue): string {
  const pdf = printedEdition(config, issue);
  return `<header class="mast">
          <div class="ear"><b>Shipping forecast</b>${esc(issue.forecast)}</div>
          <div>
            <h1>Beuk Weekly</h1>
            <p class="mast-tag">And Complete Self-Publishing News</p>
          </div>
          <div class="ear late"><b>Late news</b>${issue.late.map((l) => esc(l)).join('<br />')}<span class="stars" aria-hidden="true">★ ★</span></div>
        </header>
        <div class="dateline">
          <span>Vol. ${esc(issue.volume)} · No. ${issue.number}</span>
          <span>${esc(weekLabel(issue.week))}</span>
          <span>beuk.studio/school/weekly</span>
          ${pdf ? `<a href="${esc(pdf)}">This issue as a printed PDF</a>` : '<span>Free every week</span>'}
        </div>`;
}

function frontStory(s: Story, o: RenderOpts): string {
  return `<article class="story">
              <p class="kick">${esc(s.section)}</p>
              <h3><a href="${esc(storyUrl(s, o))}">${esc(s.title)}</a></h3>
              <p class="by">${esc(s.byline)}</p>
              <p>${esc(s.summary ?? '')}</p>
            </article>`;
}

export function renderIssue(config: Config, weekly: WeeklyContent, issue: Issue, o: RenderOpts = {}): string {
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
  const earlier = o.base ? [] : weekly.issues.filter((i) => i.number !== issue.number).reverse();
  const body = `${o.preview ?? ''}        <div class="paper">
        ${masthead(config, issue)}
        <a class="banner" href="${esc(storyUrl(lead, o))}">${esc(issue.banner)}</a>
        <p class="banner-deck">${esc(issue.bannerDeck)}</p>
        <div class="front">
          <article class="lead">
            <p class="kick">${esc(lead.section)}</p>
            <h2><a href="${esc(storyUrl(lead, o))}">${esc(lead.frontHead ?? lead.title)}</a></h2>
            <p class="by">By ${esc(lead.byline)}</p>
            ${figure(lead, lead.caption ?? lead.title, o)}
            <div class="cols">
          ${blocksHtml(leadParas, true)}
            </div>
            <a class="more" href="${esc(storyUrl(lead, o))}">Continue reading →</a>
          </article>
          <div class="col2">
            ${issue.front.map((s) => frontStory(s, o)).join('\n            ')}
          </div>
          <aside class="col3 brief">
            ${briefs}
            ${notices}
          </aside>
        </div>
        ${issue.fold.length ? `<section class="fold" aria-label="Below the fold">${issue.fold.map((s) => frontStory(s, o)).join('')}</section>` : ''}
        ${
          earlier.length
            ? `<section class="earlier" aria-label="Earlier issues"><p class="kick">Earlier issues</p><ul>${earlier
                .map((i) => `<li><a href="${issueUrl(i.number)}">No. ${i.number} · ${esc(weekLabel(i.week))} · ${esc(i.banner)}</a></li>`)
                .join('')}</ul></section>`
            : ''
        }
        <footer class="imprint">
          <span>Printed and published by Beuk · beuk.studio</span>
          <span>Free every week</span>
          <span>Set in Old Standard, Oswald &amp; Playfair Display</span>
        </footer>
        </div>`;
  return schoolPage(config, {
    title: `Beuk Weekly, No. ${issue.number} — ${issue.banner}`,
    description: `${issue.banner}. ${issue.bannerDeck}. Beuk Weekly, ${weekLabel(issue.week)}.`,
    path: o.base ?? issueUrl(issue.number),
    body,
    tab: 'weekly',
    css: CSS,
    bodyClass: 'weekly',
    robots: o.robots,
    scripts: o.scripts,
  });
}

export function renderStory(config: Config, issue: Issue, s: Story, o: RenderOpts = {}): string {
  const stories = [issue.lead, ...issue.front, ...issue.fold];
  const next = stories[stories.indexOf(s) + 1];
  const blocks = s.blocks;
  // The picture sits after the first subhead (or the second paragraph), the way a column carries it.
  const at = Math.max(blocks.findIndex((b) => b.kind === 'sub'), Math.min(2, blocks.length));
  const html = blocksHtml(blocks.slice(0, at), true) + figure(s, s.caption ?? s.title, o) + blocksHtml(blocks.slice(at), false);
  const front = o.base ?? issueUrl(issue.number);
  const body = `${o.preview ?? ''}        <div class="paper">
        <header class="art-mast">
          <a class="m" href="${esc(front)}">Beuk Weekly</a>
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
          <a href="${esc(front)}">← Front page</a>
          ${next ? `<a href="${esc(storyUrl(next, o))}">Next: ${esc(next.title)} →</a>` : ''}
        </nav>
        </div>`;
  return schoolPage(config, {
    title: `${s.title} — Beuk Weekly`,
    description: s.deck ?? s.summary ?? s.title,
    path: storyUrl(s, o),
    body,
    tab: 'weekly',
    css: CSS,
    bodyClass: 'weekly',
    robots: o.robots,
    scripts: o.scripts,
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
