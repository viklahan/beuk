import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getHelpContent, inlineHtml, inlineText } from '../help/content.js';
import { repoRoot } from '../warmth/pages.js';

/**
 * Beuk School — the content model. Like Help, the files ARE the content:
 *
 *   content/school/<lang>/<course>/course.md        one course
 *   content/school/<lang>/<course>/NN-<lesson>.md   its lessons, in NN order
 *
 * Only English ships in this pass; the <lang> folder is there so other
 * languages slot in beside it later without moving anything.
 *
 * course.md front matter: title, blurb, order (number), stages ([idea,
 * draft, ship] — the landing page's "where are you with your book"), and
 * setup (what the recorder does before each lesson: `sample` loads the
 * sample story, `empty` leaves the desk empty). Body: the lede.
 *
 * Lesson file:
 *
 *   ---
 *   title: Bring your book in
 *   blurb: one line for the course page
 *   guide: import-a-manuscript       optional: the Help guide it builds on
 *   setup: empty                     optional: overrides the course's setup
 *   ---
 *   <lede paragraph(s)>               shown, and spoken as the opening
 *   ## Steps
 *   1. What to do, in inline Markdown (the Read view).
 *      say: what the narrator says over this step (the Listen/Watch views)
 *      do: click "Export"; wait 1     what the recorder does in the studio
 *   ## Takeaway
 *   <one paragraph>                   shown as the pull quote, spoken last
 *
 * `do:` commands (parseShots below parses them; tools/school-media
 * performs them against the live studio): click "<visible text>",
 * tab "<text>", show "<text>" (scroll it into view), key <Key>, wait <s>.
 * A command whose text the studio does not show FAILS the recording —
 * a lesson can never describe a control that is not there.
 */

export const SCHOOL_LANGS = ['en'] as const;
export type SchoolLang = (typeof SCHOOL_LANGS)[number];
export const STAGES = ['idea', 'draft', 'ship'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_NAMES: Record<Stage, string> = { idea: 'Just an idea', draft: 'Drafting', ship: 'Ready to publish' };

export interface ShotCommand {
  verb: 'click' | 'tab' | 'show' | 'key' | 'wait';
  arg: string;
}
export interface LessonStep {
  html: string;
  text: string;
  say: string;
  shots: ShotCommand[];
}
export interface Lesson {
  course: string;
  slug: string;
  n: number;
  title: string;
  blurb: string;
  guide: string | null;
  /** What the recorder does before the lesson (the course's setup unless overridden). */
  setup: 'sample' | 'empty' | null;
  lede: { html: string; text: string }[];
  steps: LessonStep[];
  takeaway: { html: string; text: string } | null;
  /** The narration, in order: the lede, each step's `say:`, the takeaway. */
  script: { id: string; text: string }[];
  readMinutes: number;
  file: string;
}
export interface Course {
  lang: SchoolLang;
  slug: string;
  title: string;
  blurb: string;
  order: number;
  stages: Stage[];
  setup: 'sample' | 'empty';
  lede: { html: string; text: string }[];
  lessons: Lesson[];
  lessonBySlug: Map<string, Lesson>;
}
export interface SchoolContent {
  courses: Course[];
  courseBySlug: Map<string, Course>;
  stamp: string;
}

export function schoolDir(lang: SchoolLang = 'en'): string {
  return path.join(repoRoot(), 'content', 'school', lang);
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  return v;
}

function frontMatter(source: string, file: string): { meta: Record<string, unknown>; body: string } {
  const text = source.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, unknown> = {};
  for (const line of fm[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`${file}: bad front-matter line "${line}"`);
    meta[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  return { meta, body: text.slice(fm[0].length) };
}

function str(meta: Record<string, unknown>, key: string, file: string): string {
  const v = meta[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${file}: front matter needs "${key}"`);
  return v.trim();
}

/** `click "Export"; wait 1` → commands. Throws on an unknown verb. */
export function parseShots(raw: string, file: string): ShotCommand[] {
  const out: ShotCommand[] = [];
  for (const part of raw.split(';')) {
    const s = part.trim();
    if (!s) continue;
    const m = /^(click|tab|show|key|wait)\s+(.+)$/.exec(s);
    if (!m) throw new Error(`${file}: unknown do: command "${s}"`);
    const verb = m[1] as ShotCommand['verb'];
    let arg = m[2].trim();
    if (verb === 'click' || verb === 'tab' || verb === 'show') {
      const q = /^"(.+)"$/.exec(arg);
      if (!q) throw new Error(`${file}: ${verb} needs "quoted text", got ${arg}`);
      arg = q[1];
    } else if (verb === 'wait' && !/^\d+(\.\d+)?$/.test(arg)) {
      throw new Error(`${file}: wait needs seconds, got ${arg}`);
    }
    out.push({ verb, arg });
  }
  return out;
}

const paras = (lines: string[]) =>
  lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .map((md) => ({ html: inlineHtml(md), text: inlineText(md) }));

export function parseLesson(source: string, file: string, course: string): Lesson {
  const base = path.basename(file, '.md');
  const fn = /^(\d{2})-([a-z0-9-]+)$/.exec(base);
  if (!fn) throw new Error(`${file}: lesson files are named NN-slug.md`);
  const { meta, body } = frontMatter(source, file);
  const ledeLines: string[] = [];
  const takeLines: string[] = [];
  const steps: LessonStep[] = [];
  let part: 'lede' | 'steps' | 'takeaway' = 'lede';
  let cur: { md: string; say: string; shots: ShotCommand[] } | null = null;
  const flush = () => {
    if (!cur) return;
    if (!cur.say) throw new Error(`${file}: step "${cur.md.slice(0, 40)}" has no say:`);
    steps.push({ html: inlineHtml(cur.md), text: inlineText(cur.md), say: cur.say, shots: cur.shots });
    cur = null;
  };
  for (const line of body.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      flush();
      const name = h[1].trim().toLowerCase();
      if (name === 'steps') part = 'steps';
      else if (name === 'takeaway') part = 'takeaway';
      else throw new Error(`${file}: unknown section "## ${h[1]}"`);
      continue;
    }
    if (part === 'lede') ledeLines.push(line);
    else if (part === 'takeaway') takeLines.push(line);
    else {
      const item = /^\d+\.\s+(.+)$/.exec(line);
      const hint = /^\s+(say|do):\s*(.*)$/.exec(line);
      if (item) {
        flush();
        cur = { md: item[1].trim(), say: '', shots: [] };
      } else if (hint && cur) {
        if (hint[1] === 'say') cur.say = hint[2].trim();
        else cur.shots.push(...parseShots(hint[2], file));
      } else if (line.trim() && cur) {
        cur.md += ' ' + line.trim();
      } else if (line.trim()) {
        throw new Error(`${file}: text in ## Steps outside a numbered step`);
      }
    }
  }
  flush();
  const lede = paras(ledeLines);
  const take = paras(takeLines);
  if (!lede.length) throw new Error(`${file}: a lesson needs a lede`);
  if (!steps.length) throw new Error(`${file}: a lesson needs ## Steps`);
  const script = [
    { id: 'intro', text: lede.map((p) => p.text).join(' ') },
    ...steps.map((s, i) => ({ id: `step-${i + 1}`, text: s.say })),
    ...(take.length ? [{ id: 'takeaway', text: take.map((p) => p.text).join(' ') }] : []),
  ];
  const words = [...lede.map((p) => p.text), ...steps.map((s) => s.text), ...take.map((p) => p.text)]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const guide = typeof meta.guide === 'string' && meta.guide.trim() ? meta.guide.trim() : null;
  return {
    course,
    slug: fn[2],
    n: Number(fn[1]),
    title: str(meta, 'title', file),
    blurb: str(meta, 'blurb', file),
    guide,
    setup: meta.setup === 'empty' || meta.setup === 'sample' ? meta.setup : null,
    lede,
    steps,
    takeaway: take[0] ?? null,
    script,
    readMinutes: Math.max(1, Math.ceil(words / 200)),
    file,
  };
}

export function loadSchoolContent(lang: SchoolLang = 'en'): SchoolContent {
  const dir = schoolDir(lang);
  const courses: Course[] = [];
  const stampParts: string[] = [];
  const dirs = existsSync(dir) ? readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory()) : [];
  for (const slug of dirs.sort()) {
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`content/school/${lang}/${slug}: course folders are lower-case slugs`);
    const cdir = path.join(dir, slug);
    const cfile = path.join(cdir, 'course.md');
    const { meta, body } = frontMatter(readFileSync(cfile, 'utf8'), cfile);
    stampParts.push(`${cfile}:${statSync(cfile).mtimeMs}`);
    const stages = (Array.isArray(meta.stages) ? meta.stages : []) as string[];
    for (const s of stages) if (!(STAGES as readonly string[]).includes(s)) throw new Error(`${cfile}: unknown stage "${s}"`);
    const setup = meta.setup === 'empty' ? 'empty' : 'sample';
    const lessons = readdirSync(cdir)
      .filter((f) => /^\d{2}-.+\.md$/.test(f))
      .sort()
      .map((f) => {
        const lf = path.join(cdir, f);
        stampParts.push(`${lf}:${statSync(lf).mtimeMs}`);
        return parseLesson(readFileSync(lf, 'utf8'), lf, slug);
      });
    courses.push({
      lang,
      slug,
      title: str(meta, 'title', cfile),
      blurb: str(meta, 'blurb', cfile),
      order: typeof meta.order === 'number' ? meta.order : 99,
      stages: stages as Stage[],
      setup,
      lede: paras(body.split('\n')),
      lessons,
      lessonBySlug: new Map(lessons.map((l) => [l.slug, l])),
    });
  }
  courses.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { courses, courseBySlug: new Map(courses.map((c) => [c.slug, c])), stamp: stampParts.join('|') };
}

/** Problems a content edit can introduce; the test suite requires none. */
export function checkSchoolContent(c: SchoolContent): string[] {
  const problems: string[] = [];
  const guides = getHelpContent().guideBySlug;
  for (const course of c.courses) {
    if (!course.lessons.length) problems.push(`${course.slug}: no lessons`);
    if (!course.stages.length) problems.push(`${course.slug}: no stages`);
    const ns = course.lessons.map((l) => l.n);
    ns.forEach((n, i) => {
      if (n !== i + 1) problems.push(`${course.slug}: lessons are numbered 01, 02, … without gaps (found ${String(n).padStart(2, '0')} at position ${i + 1})`);
    });
    for (const l of course.lessons) {
      if (l.guide && !guides.has(l.guide)) problems.push(`${l.file}: guide "${l.guide}" is not a Help guide`);
    }
  }
  return problems;
}

let cache: { content: SchoolContent; checkedAt: number } | null = null;

/** The loaded content; in dev (NODE_ENV !== production) re-read when files change. */
export function getSchoolContent(): SchoolContent {
  if (cache && (process.env.NODE_ENV === 'production' || Date.now() - cache.checkedAt < 2000)) return cache.content;
  const fresh = loadSchoolContent();
  if (!cache || cache.content.stamp !== fresh.stamp) cache = { content: fresh, checkedAt: Date.now() };
  else cache.checkedAt = Date.now();
  return cache.content;
}
