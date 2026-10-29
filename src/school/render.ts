import type { Config } from '../config.js';
import { getHelpContent } from '../help/content.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import { STAGE_NAMES, type Course, type Lesson, type SchoolContent, type Stage } from './content.js';
import { mediaUrl, readLessonMedia, type LessonMedia } from './media.js';
import { getWeeklyContent } from '../weekly/content.js';

/**
 * Beuk School pages (/school, /school/<course>, /school/<course>/<lesson>),
 * server-rendered in the public site's own shell: the same top bar, footer,
 * site.css and self-hosted fonts as /ramp and /features, with School as the
 * current tab. Page styles and the small page script are
 * client/site/school.css and client/site/school.js.
 *
 * Every page works without JavaScript: the Watch / Listen / Read views are
 * stacked, and progress (signed-in only) is simply not shown.
 */

export interface SchoolCtx {
  config: Config;
  content: SchoolContent;
}

const LANG = 'en';

const MARK = `<svg class="mark" width="26" height="31" viewBox="0 0 44 52" aria-hidden="true"><rect x="7" y="3" width="9" height="46" rx="2.5" fill="currentColor"/><rect x="7" y="13" width="9" height="2.4" fill="#c99b3f"/><rect x="7" y="36" width="9" height="2.4" fill="#c99b3f"/><circle cx="27" cy="35" r="12.5" fill="currentColor"/><circle cx="27" cy="35" r="6" fill="#f8f4e9"/></svg>`;

/** "4:05" from seconds. */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** "about 4 min" from seconds (never less than 1). */
const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

export function lessonMedia(ctx: SchoolCtx, l: Lesson): LessonMedia | null {
  return readLessonMedia(ctx.config.schoolMediaDir, LANG, l.course, l.slug);
}

/** A lesson's length: its video's measured length when there is one, else its reading time. */
function lessonLength(ctx: SchoolCtx, l: Lesson): { label: string; minutes: number } {
  const m = lessonMedia(ctx, l);
  if (m?.video) return { label: clock(m.video.seconds), minutes: minutes(m.video.seconds) };
  return { label: `${l.readMinutes} min read`, minutes: l.readMinutes };
}

function formatChips(m: LessonMedia | null): string {
  return [
    m?.video ? '<span class="fmt v">Watch</span>' : '',
    m?.audio ? '<span class="fmt a">Listen</span>' : '',
    '<span class="fmt r">Read</span>',
  ].join('');
}

function firstShot(ctx: SchoolCtx, l: Lesson): string | null {
  const m = lessonMedia(ctx, l);
  const shot = m?.shots.find((s): s is string => !!s);
  return shot ? mediaUrl(LANG, l.course, l.slug, shot) : null;
}

export interface SchoolPageOpts {
  title: string;
  description: string;
  path: string;
  body: string;
  data?: string;
  /** Which School tab is current: the courses or Beuk Weekly. */
  tab?: 'courses' | 'weekly';
  /** Extra stylesheets after school.css (the Weekly's fonts and paper). */
  css?: string[];
  bodyClass?: string;
  /** A robots meta value (the Weekly press's draft preview: noindex). */
  robots?: string;
  /** Extra scripts after school.js. */
  scripts?: string[];
}

/** The School's page shell: the public site's top bar and footer, School
 *  current, and the School's own Courses · Beuk Weekly tabs. */
export function schoolPage(config: Config, opts: SchoolPageOpts): string {
  const tab = opts.tab ?? 'courses';
  const canonical = `${config.appBaseUrl}${opts.path}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <title>${esc(opts.title)}</title>
    <meta name="description" content="${esc(opts.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    ${opts.robots ? `<meta name="robots" content="${esc(opts.robots)}" />` : ''}
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Beuk" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:title" content="${esc(opts.title)}" />
    <meta property="og:description" content="${esc(opts.description)}" />
    <meta property="og:image" content="${esc(config.appBaseUrl)}/site/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="/assets/fonts/fonts-site.css" />
    <link rel="stylesheet" href="/site/site.css" />
    <link rel="stylesheet" href="/site/school.css" />
    ${(opts.css ?? []).map((h) => `<link rel="stylesheet" href="${esc(h)}" />`).join('')}
  </head>
  <body class="school${opts.bodyClass ? ' ' + esc(opts.bodyClass) : ''}"${opts.data ?? ''}>
    <a class="skip" href="#top">Skip to the lessons</a>
    <header class="topbar">
      <div class="topbar-in">
        <a class="lockup" href="/?home" aria-label="Beuk — home">
          ${MARK}
          <span><span class="word">beuk</span><span class="sub">beuk.studio</span></span>
          <span class="tagline">your EPUB &amp; print studio</span>
        </a>
        <nav aria-label="Site">
          <a class="nl" href="/features">Features</a>
          <a class="nl" href="/ramp">Ramp</a>
          <a class="nl" href="/compare">Compare</a>
          <a class="nl" href="/school" aria-current="page">School</a>
          <a class="nl opt" href="/help">Help</a>
          <a class="nl opt" href="/studio?signin">Sign in</a>
          <a class="btn-sm" href="/studio">Start writing</a>
        </nav>
      </div>
    </header>
    <nav class="s-tabs" aria-label="School">
      <div class="s-tabs-in">
        <a href="/school"${tab === 'courses' ? ' aria-current="page"' : ''}>Courses</a>
        <a href="/school/weekly"${tab === 'weekly' ? ' aria-current="page"' : ''}>Beuk Weekly</a>
      </div>
    </nav>

    <main id="top">
      <div class="wrap">
${opts.body}
      </div>
    </main>

    <footer>
      <div class="wrap">
        <div class="foot-in">
          <div class="fl">
            <a class="lockup" href="/?home" aria-label="Beuk — home">
              ${MARK.replace('width="26" height="31"', 'width="24" height="28"')}
              <span><span class="word" style="font-size:23px">beuk</span><span class="sub">beuk.studio</span></span>
            </a>
            <p>Beuk is a writing and typesetting studio: bring a manuscript in, and send a finished book out as an ebook and in print.</p>
          </div>
          <nav aria-label="Footer">
            <a href="/?home">Home</a>
            <a href="/features">Features</a>
            <a href="/ramp">Ramp</a>
            <a href="/compare">Compare</a>
            <a href="/school">School</a>
            <a href="/studio">The studio</a>
            <a href="/help">Help</a>
            <a href="/changelog">Changelog</a>
            <a href="/roadmap">Roadmap</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
        <p class="footline">Beuk School is free. Lessons are narrated by an AI voice and recorded on the live studio.</p>
      </div>
    </footer>
    <script src="/site/school.js" defer></script>
    ${(opts.scripts ?? []).map((src) => `<script src="${esc(src)}" defer></script>`).join('')}
  </body>
</html>
`;
}

/* ------------------------------ home ------------------------------ */

function courseCard(ctx: SchoolCtx, c: Course): string {
  const shot = c.lessons.length ? firstShot(ctx, c.lessons[0]) : null;
  const total = c.lessons.reduce((n, l) => n + lessonLength(ctx, l).minutes, 0);
  const anyVideo = c.lessons.some((l) => lessonMedia(ctx, l)?.video);
  const anyAudio = c.lessons.some((l) => lessonMedia(ctx, l)?.audio);
  const fmts = [anyVideo ? 'Watch' : '', anyAudio ? 'Listen' : '', 'Read'].filter(Boolean).join(', ');
  return `<a class="cc" href="/school/${esc(c.slug)}" data-stages="${esc(c.stages.join(' '))}" data-course="${esc(c.slug)}">
          <span class="thumb">${shot ? `<img src="${esc(shot)}" alt="" loading="lazy" />` : `<span class="spec">${esc(c.title)}</span>`}</span>
          <span class="meta"><b>Course</b> · ${c.lessons.length} lessons · about ${total} min · ${esc(fmts)}</span>
          <span class="t">${esc(c.title)}</span>
          <span class="b">${esc(c.blurb)}</span>
          <span class="prog" data-progress hidden><i></i></span>
          <span class="go">Open the course →</span>
        </a>`;
}

/** The School home's pointer to this week's paper (nothing while there is no issue). */
function weeklyBand(): string {
  const issue = getWeeklyContent().latest;
  if (!issue) return '';
  return `<a class="weekly-band" href="/school/weekly">
          <span class="wb-mast">Beuk Weekly</span>
          <span class="wb-no">No. ${issue.number} · out now</span>
          <span class="wb-head">${esc(issue.banner)}</span>
          <span class="wb-deck">${esc(issue.bannerDeck)}</span>
        </a>`;
}

export function renderSchoolHome(ctx: SchoolCtx): string {
  const { courses } = ctx.content;
  const chips = (Object.keys(STAGE_NAMES) as Stage[])
    .map((s) => `<button class="chip" type="button" data-stage="${s}" aria-pressed="false">${esc(STAGE_NAMES[s])}</button>`)
    .join('');
  const body = `        <header class="s-hero">
          <p class="kicker">Beuk School</p>
          <h1>Learn to finish the book, not just write it.</h1>
          <p class="lede">Free courses on the studio, each lesson recorded on the real thing. Watch it, listen to it, or read it step by step, then try it on your own book.</p>
        </header>

        <section class="stages" aria-labelledby="stage-q">
          <p class="kicker" id="stage-q">Where are you with your book?</p>
          <div class="chips" role="group" aria-label="Show the courses for where you are">${chips}</div>
          <p class="say" data-stage-say>Pick one and the courses that fit stay lit.</p>
        </section>

        ${weeklyBand()}

        <section class="shelf" aria-labelledby="courses-h">
          <h2 id="courses-h">Courses</h2>
          <div class="grid">
        ${courses.map((c) => courseCard(ctx, c)).join('\n        ')}
          </div>
          ${courses.length ? '' : '<p class="muted">The first course is being recorded.</p>'}
        </section>

        <section class="howto" aria-label="How lessons come">
          <div><span class="fmt v">Watch</span><h3>Watch</h3><p>A screen recording of the studio, step by step, with chapters to jump to the part you need.</p></div>
          <div><span class="fmt a">Listen</span><h3>Listen</h3><p>The same lesson as audio, with the full transcript beneath it.</p></div>
          <div><span class="fmt r">Read</span><h3>Read</h3><p>The steps in writing, with a screenshot of each one.</p></div>
          <div><span class="fmt">Free</span><h3>Keep your place</h3><p>Everything here is free. <a href="/studio?signin">Sign in</a> and the lessons you finish are remembered; without an account nothing is kept.</p></div>
        </section>`;
  return schoolPage(ctx.config, {
    title: 'School — Beuk',
    description: 'Beuk School: free courses on the Beuk studio, each lesson recorded on the live studio, to watch, listen to or read.',
    path: '/school',
    body,
    css: getWeeklyContent().latest ? ['/assets/fonts/fonts-weekly.css'] : [],
  });
}

/* ------------------------------ course ------------------------------ */

export function renderCourse(ctx: SchoolCtx, c: Course): string {
  const rows = c.lessons
    .map((l) => {
      const m = lessonMedia(ctx, l);
      const shot = firstShot(ctx, l);
      const len = lessonLength(ctx, l);
      return `<a class="ls" href="/school/${esc(c.slug)}/${esc(l.slug)}" data-lesson="${esc(l.slug)}">
            <span class="n">${String(l.n).padStart(2, '0')}</span>
            <span class="tn">${shot ? `<img src="${esc(shot)}" alt="" loading="lazy" />` : ''}</span>
            <span class="tx"><span class="t">${esc(l.title)}</span><span class="b">${esc(l.blurb)}</span></span>
            <span class="len">${esc(len.label)}<span class="fmts">${formatChips(m)}</span><span class="done-mark" data-done-mark hidden>Done</span></span>
          </a>`;
    })
    .join('\n          ');
  const total = c.lessons.reduce((n, l) => n + lessonLength(ctx, l).minutes, 0);
  const first = c.lessons[0];
  const body = `        <p class="crumbs"><a href="/school">School</a> › ${esc(c.title)}</p>
        <div class="c-grid">
          <div class="c-main">
            <header class="s-hero tight">
              <p class="kicker">Course</p>
              <h1>${esc(c.title)}</h1>
              ${c.lede.map((p) => `<p class="lede">${p.html}</p>`).join('\n              ')}
            </header>
            <div class="syll">
          ${rows}
            </div>
          </div>
          <aside class="c-side">
            <div class="stat"><div><b>${c.lessons.length}</b><span>lessons</span></div><div><b>${total}</b><span>minutes, about</span></div><div><b>Free</b><span>no account needed</span></div></div>
            <p class="side-prog" data-course-progress hidden></p>
            ${first ? `<a class="btn" href="/school/${esc(c.slug)}/${esc(first.slug)}" data-resume>Start lesson 1</a>` : ''}
            <a class="btn-ghost" href="/studio" target="_blank" rel="noopener">Open the studio in a new tab</a>
            <p class="small muted" data-signin-note>Follow along on your own book, or on the sample story the studio loads in one click. <a href="/studio?signin">Sign in</a> to have Beuk remember the lessons you finish.</p>
          </aside>
        </div>`;
  return schoolPage(ctx.config, {
    title: `${c.title} — Beuk School`,
    description: c.blurb,
    path: `/school/${c.slug}`,
    body,
    data: ` data-course="${esc(c.slug)}" data-lessons="${esc(c.lessons.map((l) => l.slug).join(' '))}"`,
  });
}

/* ------------------------------ lesson ------------------------------ */

export function renderLesson(ctx: SchoolCtx, c: Course, l: Lesson): string {
  const m = lessonMedia(ctx, l);
  const url = (f: string) => mediaUrl(LANG, c.slug, l.slug, f);
  const poster = firstShot(ctx, l);
  const i = c.lessons.indexOf(l);
  const prev = c.lessons[i - 1];
  const next = c.lessons[i + 1];
  const guide = l.guide ? getHelpContent().guideBySlug.get(l.guide) : undefined;
  const stepName = (id: string) => {
    if (id === 'intro') return 'Introduction';
    if (id === 'takeaway') return 'In short';
    const n = Number(id.replace('step-', ''));
    return `Step ${n}`;
  };
  const chapters = m
    ? l.script
        .filter((s) => typeof m.cues[s.id] === 'number')
        .map((s) => `<button type="button" data-seek="${m.cues[s.id]}">${esc(clock(m.cues[s.id]))} ${esc(stepName(s.id))}</button>`)
        .join('')
    : '';
  const tabs = [
    m?.video ? `<button type="button" role="tab" data-mode="watch" aria-selected="false">Watch · ${esc(clock(m.video.seconds))}</button>` : '',
    m?.audio ? `<button type="button" role="tab" data-mode="listen" aria-selected="false">Listen · ${esc(clock(m.audio.seconds))}</button>` : '',
    `<button type="button" role="tab" data-mode="read" aria-selected="false">Read · ${l.readMinutes} min</button>`,
  ].join('');
  const watch = m?.video
    ? `<section class="mode" data-mode-panel="watch" aria-label="Watch">
            <div class="player">
              <video controls preload="metadata" playsinline${poster ? ` poster="${esc(poster)}"` : ''} src="${esc(url(m.video.file))}" data-media></video>
              ${chapters ? `<div class="chap" aria-label="Chapters">${chapters}</div>` : ''}
            </div>
          </section>`
    : '';
  const listen = m?.audio
    ? `<section class="mode" data-mode-panel="listen" aria-label="Listen">
            <div class="audio">
              <audio controls preload="metadata" src="${esc(url(m.audio.file))}" data-media></audio>
              <div class="tscript">
                ${l.script
                  .map((s) => {
                    const t = m.cues[s.id];
                    return `<p>${typeof t === 'number' ? `<button type="button" class="cue" data-seek="${t}">${esc(clock(t))}</button>` : ''}${esc(s.text)}</p>`;
                  })
                  .join('\n                ')}
              </div>
            </div>
          </section>`
    : '';
  const read = `<section class="mode" data-mode-panel="read" aria-label="Read">
            <ol class="steps">
              ${l.steps
                .map((s, k) => {
                  const shot = m?.shots[k];
                  return `<li><p>${s.html}</p>${shot ? `<figure><img src="${esc(url(shot))}" alt="The studio at step ${k + 1}: ${esc(s.text)}" loading="lazy" /></figure>` : ''}</li>`;
                })
                .join('\n              ')}
            </ol>
          </section>`;
  const voiceNote = m && (m.video || m.audio)
    ? `<p class="small muted voice">Narrated by an AI voice${m.voice ? ` (${esc(m.voice)})` : ''}. Recorded on the live studio${m.recordedAt ? ` on ${esc(m.recordedAt.slice(0, 10))}` : ''}.</p>`
    : '';
  const body = `        <p class="crumbs"><a href="/school">School</a> › <a href="/school/${esc(c.slug)}">${esc(c.title)}</a> › Lesson ${l.n} of ${c.lessons.length}</p>
        <header class="s-hero tight">
          <h1>${esc(l.title)}</h1>
          ${l.lede.map((p) => `<p class="lede">${p.html}</p>`).join('\n          ')}
        </header>
        <div class="l-grid">
          <div class="l-main">
          <div class="modes" role="tablist" aria-label="How to take this lesson" hidden>${tabs}</div>
          ${watch}
          ${listen}
          ${read}
          ${l.takeaway ? `<p class="pull">${l.takeaway.html}</p>` : ''}
          ${voiceNote}
          </div>
          <aside class="l-side">
            <div class="box">
              <p class="kicker">Do this in the studio</p>
              <p>Open Beuk beside this page and follow along on your own book or the sample story.</p>
              <a class="btn-sm" href="/studio" target="_blank" rel="noopener">Open Beuk in a new tab</a>
            </div>
            <div class="box" data-done-box hidden>
              <p class="kicker">Your progress</p>
              <button type="button" class="btn-ghost" data-done-toggle>Mark lesson done</button>
              <p class="small muted" data-done-note></p>
            </div>
            <div class="box" data-signin-box>
              <p class="kicker">Your progress</p>
              <p class="small"><a href="/studio?signin">Sign in</a> and Beuk remembers the lessons you finish. Without an account nothing is kept.</p>
            </div>
            ${guide ? `<div class="box"><p class="kicker">From the Help reading room</p><a href="/help/${esc(guide.slug)}">${esc(guide.title)}</a></div>` : ''}
          </aside>
        </div>
        <nav class="pager" aria-label="Lessons">
          ${prev ? `<a href="/school/${esc(c.slug)}/${esc(prev.slug)}">← ${prev.n} · ${esc(prev.title)}</a>` : `<a href="/school/${esc(c.slug)}">← ${esc(c.title)}</a>`}
          ${next ? `<a href="/school/${esc(c.slug)}/${esc(next.slug)}">${next.n} · ${esc(next.title)} →</a>` : `<a href="/school/${esc(c.slug)}">Back to the course →</a>`}
        </nav>`;
  return schoolPage(ctx.config, {
    title: `${l.title} — ${c.title} — Beuk School`,
    description: l.blurb,
    path: `/school/${c.slug}/${l.slug}`,
    body,
    data: ` data-course="${esc(c.slug)}" data-lesson="${esc(l.slug)}"`,
  });
}

export function renderSchoolNotFound(ctx: SchoolCtx, message: string): string {
  return schoolPage(ctx.config, {
    title: 'Not found — Beuk School',
    description: message,
    path: '/school',
    body: `        <header class="s-hero">
          <p class="kicker">Beuk School</p>
          <h1>That lesson isn't on the shelf.</h1>
          <p class="lede">${esc(message)}</p>
          <p><a class="btn" href="/school">See all courses</a></p>
        </header>`,
  });
}
