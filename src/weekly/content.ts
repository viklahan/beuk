import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { inlineHtml, inlineText } from '../help/content.js';
import { repoRoot } from '../warmth/pages.js';

/**
 * Beuk Weekly — the School's newspaper (V, 2026-10-28). Like Help and the
 * School, the files ARE the content:
 *
 *   content/weekly/<lang>/<NNN>/issue.md       one issue's masthead details
 *   content/weekly/<lang>/<NNN>/<slug>.md      its stories
 *   content/weekly/<lang>/<NNN>/<file>.jpg     pictures the stories name
 *
 * issue.md front matter: volume (roman, e.g. I), week (YYYY-MM-DD, the
 * Monday the issue is dated), banner + bannerDeck (the full-width headline
 * and the italic line under it), lead (the slug of the lead story),
 * forecast (the left ear) and late (the right ear: [line, line]).
 *
 * A news issue (V, 2026-11-20) carries the Beuk mark in the left ear and
 * "The Weather Elsewhere" in the right instead: weatherPlace,
 * weatherReading, optional weatherNote, and weatherIcon (an ink-line .svg
 * in the issue folder, drawn only with plain shapes). A reading is a real
 * observation, cited in the issue's sources; an issue with a weather ear
 * and no sources is a problem. Such an issue needs no forecast. Optional:
 * tagline (the line under the masthead, when the issue sets its own),
 * price (a dateline entry), note (one line under the dateline), and
 * formerly (the number this issue was first published under: its stories'
 * old addresses then lead to the new ones).
 *
 * issue.md body (optional): the Sources foot. One `## ` line is its
 * heading; every `- ` line is a source, with the same inline Markdown.
 *
 * Story front matter: title, section (the small kicker), byline, place —
 *   lead    the story under the banner (named by issue.md, place optional)
 *   front   the middle column, in `order`
 *   brief   "In brief": a headline and its body, no page of its own
 *   fold    below the fold, in `order`
 *   notice  a boxed notice (freebies, prizes): title + body, optional
 *           `link` (where to get it); no page of its own
 *   short   a short story printed whole on the front page, links and all,
 *           under the lead; it has a page of its own too
 *   takeaway  the numbered box that closes a news issue: title, optional
 *           deck (the line under it), one paragraph per instruction; no
 *           page of its own
 *   leader  the paper's own opinion (No. 6, 2026-11-23), printed whole
 *           after the short stories, with a page of its own. It is not
 *           news: its section says "Opinion", it links what it answers,
 *           it carries no "Why it matters", and an issue has one at most
 * plus optional deck, summary (the front-page text for front/fold stories),
 * frontHead (the lead's headline on the front page, under the banner),
 * image + caption, order.
 *
 * Story body: paragraphs, `## Subhead`, `> ` pull quotes and `:: ` "Why it
 * matters" boxes, with the same inline Markdown as Help. Raw HTML is always
 * escaped.
 */

export const WEEKLY_LANGS = ['en'] as const;
export type WeeklyPlace = 'lead' | 'front' | 'brief' | 'fold' | 'notice' | 'short' | 'takeaway' | 'leader';
const PLACES: WeeklyPlace[] = ['lead', 'front', 'brief', 'fold', 'notice', 'short', 'takeaway', 'leader'];

export type StoryBlock =
  | { kind: 'p'; html: string; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'pull'; html: string; text: string }
  | { kind: 'why'; html: string; text: string };

export interface Story {
  issue: number;
  slug: string;
  title: string;
  section: string;
  byline: string;
  place: WeeklyPlace;
  order: number;
  deck: string | null;
  summary: string | null;
  frontHead: string | null;
  image: string | null;
  caption: string | null;
  link: string | null;
  blocks: StoryBlock[];
  words: number;
  readMinutes: number;
  /** Lead, front, fold and short stories and the leader have a page; briefs, notices and takeaways do not. */
  hasPage: boolean;
  file: string;
}

export interface Weather {
  place: string;
  reading: string;
  note: string | null;
  /** The icon's checked SVG markup, or null when the issue names none. */
  icon: string | null;
}

export interface Issue {
  number: number;
  volume: string;
  week: string;
  banner: string;
  bannerDeck: string;
  /** '' on an issue that carries the weather ear instead. */
  forecast: string;
  late: string[];
  weather: Weather | null;
  tagline: string | null;
  price: string | null;
  note: string | null;
  /** The number this issue was first published under, if it was renumbered. */
  formerly: number | null;
  lead: Story;
  front: Story[];
  briefs: Story[];
  fold: Story[];
  notices: Story[];
  shorts: Story[];
  takeaways: Story[];
  leaders: Story[];
  sourcesHead: string | null;
  sources: { html: string; text: string }[];
  storyBySlug: Map<string, Story>;
  dir: string;
}

export interface WeeklyContent {
  issues: Issue[];
  issueByNumber: Map<number, Issue>;
  latest: Issue | null;
  stamp: string;
}

export function weeklyDir(lang: (typeof WEEKLY_LANGS)[number] = 'en'): string {
  return path.join(repoRoot(), 'content', 'weekly', lang);
}

export function frontMatter(source: string, file: string): { meta: Record<string, unknown>; body: string } {
  const text = source.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, unknown> = {};
  for (const line of fm[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`${file}: bad front-matter line "${line}"`);
    const v = line.slice(i + 1).trim();
    let val: unknown = v;
    if (/^-?\d+$/.test(v)) val = Number(v);
    else if (v.startsWith('[') && v.endsWith(']')) val = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    meta[line.slice(0, i).trim()] = val;
  }
  return { meta, body: text.slice(fm[0].length) };
}

const need = (meta: Record<string, unknown>, key: string, file: string): string => {
  const v = meta[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${file}: front matter needs "${key}"`);
  return v.trim();
};
const opt = (meta: Record<string, unknown>, key: string): string | null =>
  typeof meta[key] === 'string' && (meta[key] as string).trim() ? (meta[key] as string).trim() : null;

const SAFE_IMAGE = /^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/i;

export function parseStory(source: string, file: string, issue: number): Story {
  const slug = path.basename(file, '.md');
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`${file}: story files are lower-case slugs`);
  const { meta, body } = frontMatter(source, file);
  const place = (opt(meta, 'place') ?? 'front') as WeeklyPlace;
  if (!PLACES.includes(place)) throw new Error(`${file}: unknown place "${place}"`);
  const image = opt(meta, 'image');
  if (image && !SAFE_IMAGE.test(image)) throw new Error(`${file}: image must be a plain .jpg/.png/.webp file name`);
  const blocks: StoryBlock[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    const t = para.replace(/\n/g, ' ').trim();
    if (!t) continue;
    if (t.startsWith('## ')) blocks.push({ kind: 'sub', text: t.slice(3).trim() });
    else if (t.startsWith(':: ')) blocks.push({ kind: 'why', html: inlineHtml(t.slice(3).trim()), text: inlineText(t.slice(3).trim()) });
    else if (t.startsWith('> ')) blocks.push({ kind: 'pull', html: inlineHtml(t.slice(2).trim()), text: inlineText(t.slice(2).trim()) });
    else blocks.push({ kind: 'p', html: inlineHtml(t), text: inlineText(t) });
  }
  if (!blocks.some((b) => b.kind === 'p')) throw new Error(`${file}: a story needs at least one paragraph`);
  const words = blocks.map((b) => b.text).join(' ').split(/\s+/).filter(Boolean).length;
  return {
    issue,
    slug,
    title: need(meta, 'title', file),
    section: need(meta, 'section', file),
    byline: opt(meta, 'byline') ?? 'The Beuk Desk',
    place,
    order: typeof meta.order === 'number' ? meta.order : 99,
    deck: opt(meta, 'deck'),
    summary: opt(meta, 'summary'),
    frontHead: opt(meta, 'frontHead'),
    image,
    caption: opt(meta, 'caption'),
    link: opt(meta, 'link'),
    blocks,
    words,
    readMinutes: Math.max(1, Math.ceil(words / 200)),
    hasPage: place === 'lead' || place === 'front' || place === 'fold' || place === 'short' || place === 'leader',
    file,
  };
}

const SVG_TAGS = new Set(['svg', 'g', 'circle', 'ellipse', 'line', 'rect', 'polyline', 'polygon', 'path']);
const SVG_ATTRS = new Set(['viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'd', 'aria-hidden']);

/**
 * A weather ear's icon goes into the page as markup, so it is checked
 * first: one <svg> of plain shapes, known attributes, values of letters,
 * digits, spaces and # . , - only. No script, style, link or text.
 */
export function inkSvg(source: string, file: string): string {
  const text = source.replace(/\r\n/g, '\n').trim();
  if (!/^<svg[\s>]/.test(text) || !text.endsWith('</svg>')) throw new Error(`${file}: an icon is one <svg> element`);
  if (text.replace(/<[^<>]*>/g, '').trim()) throw new Error(`${file}: an icon holds shapes only, no text`);
  for (const tag of text.match(/<[^<>]*>/g) ?? []) {
    const m = /^<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z0-9-]+="[^"]*")*)\s*\/?>$/.exec(tag);
    if (!m || !SVG_TAGS.has(m[2])) throw new Error(`${file}: an icon cannot hold ${tag}`);
    if (m[1] && m[3]) throw new Error(`${file}: an icon cannot hold ${tag}`);
    for (const a of m[3].matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)) {
      if (!SVG_ATTRS.has(a[1]) || !/^[#\w .,-]*$/.test(a[2])) throw new Error(`${file}: an icon cannot carry ${a[0]}`);
    }
  }
  return text.replace(/\s*\n\s*/g, '');
}

/** issue.md's body: the Sources foot (a `## ` heading and `- ` lines). */
function parseSources(body: string, file: string): { head: string | null; items: { html: string; text: string }[] } {
  let head: string | null = null;
  const items: { html: string; text: string }[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ') && head === null && !items.length) head = line.slice(3).trim();
    else if (line.startsWith('- ')) items.push({ html: inlineHtml(line.slice(2).trim()), text: inlineText(line.slice(2).trim()) });
    else throw new Error(`${file}: after the front matter come the sources: one "## " heading, then "- " lines`);
  }
  return { head, items };
}

export function loadWeeklyContent(lang: (typeof WEEKLY_LANGS)[number] = 'en'): WeeklyContent {
  const dir = weeklyDir(lang);
  const issues: Issue[] = [];
  const stamp: string[] = [];
  const folders = existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{3}$/.test(d)).sort() : [];
  for (const folder of folders) {
    const idir = path.join(dir, folder);
    const number = Number(folder);
    const ifile = path.join(idir, 'issue.md');
    const { meta, body } = frontMatter(readFileSync(ifile, 'utf8'), ifile);
    stamp.push(`${ifile}:${statSync(ifile).mtimeMs}`);
    const week = need(meta, 'week', ifile);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error(`${ifile}: week is YYYY-MM-DD`);
    const stories = readdirSync(idir)
      .filter((f) => f.endsWith('.md') && f !== 'issue.md')
      .sort()
      .map((f) => {
        const sf = path.join(idir, f);
        stamp.push(`${sf}:${statSync(sf).mtimeMs}`);
        return parseStory(readFileSync(sf, 'utf8'), sf, number);
      });
    const storyBySlug = new Map(stories.map((s) => [s.slug, s]));
    const leadSlug = need(meta, 'lead', ifile);
    const lead = storyBySlug.get(leadSlug);
    if (!lead) throw new Error(`${ifile}: lead "${leadSlug}" is not a story in this issue`);
    lead.place = 'lead';
    lead.hasPage = true;
    const weatherPlace = opt(meta, 'weatherPlace');
    let weather: Weather | null = null;
    if (weatherPlace) {
      const iconName = opt(meta, 'weatherIcon');
      let icon: string | null = null;
      if (iconName) {
        if (!/^[a-z0-9][a-z0-9._-]*\.svg$/i.test(iconName)) throw new Error(`${ifile}: weatherIcon must be a plain .svg file name`);
        const svgFile = path.join(idir, iconName);
        if (!existsSync(svgFile)) throw new Error(`${ifile}: weatherIcon ${iconName} is not in the issue folder`);
        stamp.push(`${svgFile}:${statSync(svgFile).mtimeMs}`);
        icon = inkSvg(readFileSync(svgFile, 'utf8'), svgFile);
      }
      weather = { place: weatherPlace, reading: need(meta, 'weatherReading', ifile), note: opt(meta, 'weatherNote'), icon };
    }
    const sources = parseSources(body, ifile);
    const by = (p: WeeklyPlace) => stories.filter((s) => s !== lead && s.place === p).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
    issues.push({
      number,
      volume: need(meta, 'volume', ifile),
      week,
      banner: need(meta, 'banner', ifile),
      bannerDeck: need(meta, 'bannerDeck', ifile),
      // Every issue fills its ears: the weather, or else the forecast.
      forecast: weather ? (opt(meta, 'forecast') ?? '') : need(meta, 'forecast', ifile),
      late: Array.isArray(meta.late) ? (meta.late as string[]) : [],
      weather,
      tagline: opt(meta, 'tagline'),
      price: opt(meta, 'price'),
      note: opt(meta, 'note'),
      formerly: typeof meta.formerly === 'number' ? meta.formerly : null,
      lead,
      front: by('front'),
      briefs: by('brief'),
      fold: by('fold'),
      notices: by('notice'),
      shorts: by('short'),
      takeaways: by('takeaway'),
      leaders: by('leader'),
      sourcesHead: sources.head,
      sources: sources.items,
      storyBySlug,
      dir: idir,
    });
  }
  issues.sort((a, b) => a.number - b.number);
  return { issues, issueByNumber: new Map(issues.map((i) => [i.number, i])), latest: issues[issues.length - 1] ?? null, stamp: stamp.join('|') };
}

/** Problems an edit can introduce; the tests and the Housekeeping check require none. */
export function checkWeeklyContent(c: WeeklyContent): string[] {
  const problems: string[] = [];
  c.issues.forEach((issue, i) => {
    if (issue.number !== i + 1) problems.push(`issue ${issue.number}: issues are numbered 001, 002, … without gaps`);
    if (issue.weather && !issue.sources.length) problems.push(`issue ${issue.number}: a weather reading needs its source in the issue's sources`);
    if (issue.formerly !== null && issue.formerly === issue.number) problems.push(`issue ${issue.number}: formerly names its own number`);
    // Opinion is kept apart from the news: said in its kicker, tied to what it answers, never dressed as a news story.
    if (issue.leaders.length > 1) problems.push(`issue ${issue.number}: one leader to an issue`);
    for (const s of new Set(issue.leaders)) {
      if (!/\bopinion\b/i.test(s.section)) problems.push(`${s.file}: a leader is opinion and its section must say so`);
      if (!s.blocks.some((b) => b.kind !== 'sub' && /<a href="/.test(b.html))) problems.push(`${s.file}: a leader links what it answers`);
      if (s.blocks.some((b) => b.kind === 'why')) problems.push(`${s.file}: a leader is not news and carries no "Why it matters"`);
    }
    for (const s of issue.storyBySlug.values()) {
      if (s.image && !existsSync(path.join(issue.dir, s.image))) problems.push(`${s.file}: image ${s.image} is not in the issue folder`);
      if ((s.place === 'front' || s.place === 'fold') && !s.summary) problems.push(`${s.file}: a ${s.place} story needs a summary for the front page`);
      if (s.link && !/^(https:\/\/|\/)/.test(s.link)) problems.push(`${s.file}: link must be https:// or a site path`);
    }
  });
  return problems;
}

let cache: { content: WeeklyContent; checkedAt: number } | null = null;

export function getWeeklyContent(): WeeklyContent {
  if (cache && (process.env.NODE_ENV === 'production' || Date.now() - cache.checkedAt < 2000)) return cache.content;
  const fresh = loadWeeklyContent();
  if (!cache || cache.content.stamp !== fresh.stamp) cache = { content: fresh, checkedAt: Date.now() };
  else cache.checkedAt = Date.now();
  return cache.content;
}
