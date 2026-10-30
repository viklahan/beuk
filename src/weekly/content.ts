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
 * Story front matter: title, section (the small kicker), byline, place —
 *   lead    the story under the banner (named by issue.md, place optional)
 *   front   the middle column, in `order`
 *   brief   "In brief": a headline and its body, no page of its own
 *   fold    below the fold, in `order`
 *   notice  a boxed notice (freebies, prizes): title + body, optional
 *           `link` (where to get it); no page of its own
 * plus optional deck, summary (the front-page text for front/fold stories),
 * frontHead (the lead's headline on the front page, under the banner),
 * image + caption, order.
 *
 * Story body: paragraphs, `## Subhead`, and `> ` pull quotes, with the same
 * inline Markdown as Help. Raw HTML is always escaped.
 */

export const WEEKLY_LANGS = ['en'] as const;
export type WeeklyPlace = 'lead' | 'front' | 'brief' | 'fold' | 'notice';
const PLACES: WeeklyPlace[] = ['lead', 'front', 'brief', 'fold', 'notice'];

export type StoryBlock = { kind: 'p'; html: string; text: string } | { kind: 'sub'; text: string } | { kind: 'pull'; html: string; text: string };

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
  /** Lead, front and fold stories have a page; briefs and notices do not. */
  hasPage: boolean;
  file: string;
}

export interface Issue {
  number: number;
  volume: string;
  week: string;
  banner: string;
  bannerDeck: string;
  forecast: string;
  late: string[];
  lead: Story;
  front: Story[];
  briefs: Story[];
  fold: Story[];
  notices: Story[];
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
    hasPage: place === 'lead' || place === 'front' || place === 'fold',
    file,
  };
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
    const { meta } = frontMatter(readFileSync(ifile, 'utf8'), ifile);
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
    const by = (p: WeeklyPlace) => stories.filter((s) => s !== lead && s.place === p).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
    issues.push({
      number,
      volume: need(meta, 'volume', ifile),
      week,
      banner: need(meta, 'banner', ifile),
      bannerDeck: need(meta, 'bannerDeck', ifile),
      forecast: need(meta, 'forecast', ifile),
      late: Array.isArray(meta.late) ? (meta.late as string[]) : [],
      lead,
      front: by('front'),
      briefs: by('brief'),
      fold: by('fold'),
      notices: by('notice'),
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
