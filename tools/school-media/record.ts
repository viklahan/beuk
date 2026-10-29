/**
 * Beuk School media recorder: narrated screen recordings of the LIVE studio.
 *
 *   cd tools/school-media && npm ci          (once: playwright-core)
 *   npx tsx tools/school-media/record.ts [--dry] [--only <lesson-slug>] [course]
 *
 * Env: STUDIO_URL (default http://localhost:8090/studio), SCHOOL_MEDIA_DIR
 * (default ./school-media), CHROME (a Chromium/Chrome binary; default the
 * Playwright cache's), VOICE (default af_heart).
 *
 * Per lesson (content/school/en/<course>/NN-<lesson>.md):
 *   1. speak: the lesson's script → one WAV per line in the beuk-school-voice
 *      container (Dockerfile here), with each line's measured duration.
 *   2. record: a fresh browser opens the studio, does the course/lesson setup,
 *      then walks the steps. Each step performs its `do:` commands (a visible
 *      pointer moves to the control and rings it), takes the step's
 *      screenshot, and holds until its narration has been spoken.
 *      A command whose control the studio does not show FAILS the lesson:
 *      nothing is written for it, so no lesson can describe UI that isn't there.
 *   3. mux: ffmpeg lays the narration on the same timeline → audio.mp3, and
 *      trims + encodes the recording with it → video.mp4.
 *   4. manifest.json: files, measured durations, cue times, voice, date and
 *      the studio build the recording was made against.
 * --dry skips speech, video and ffmpeg: it only walks the steps (1.2 s each)
 * and takes the screenshots — the fast check that every `do:` still works.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Locator, type Page } from 'playwright-core';
import { loadSchoolContent, type Course, type Lesson, type ShotCommand } from '../../src/school/content.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const STUDIO_URL = process.env.STUDIO_URL ?? 'http://localhost:8090/studio';
const MEDIA_DIR = path.resolve(process.env.SCHOOL_MEDIA_DIR ?? path.join(ROOT, 'school-media'));
const VOICE = process.env.VOICE ?? 'af_heart';
const W = 1280;
const H = 800;
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const COURSE = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only') ?? null;

function chromePath(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    : path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(cache, d, exe);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found: set CHROME to a Chrome/Chromium binary.');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ speech ------------------------------ */

function speak(lesson: Lesson, work: string): Record<string, number> {
  const spec = { voice: VOICE, speed: 1.0, lines: lesson.script };
  writeFileSync(path.join(work, 'script.json'), JSON.stringify(spec, null, 1));
  const out = execFileSync(
    'docker',
    ['run', '--rm', '-v', `${work}:/work`, 'beuk-school-voice', '/work/script.json', '/work/voice'],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  const durations = JSON.parse(readFileSync(path.join(work, 'voice', 'durations.json'), 'utf8')) as Record<string, number>;
  for (const line of lesson.script) {
    if (!(durations[line.id] > 0)) throw new Error(`speech for ${line.id} is empty (${out.trim()})`);
  }
  return durations;
}

/* ------------------------------ studio ------------------------------ */

const POINTER_JS = `(() => {
  if (window.__beukPointer) return;
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;border-radius:50%;background:rgba(20,96,122,.85);border:2px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:left .55s ease,top .55s ease,transform .15s';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;border:3px solid #c99b3f;border-radius:10px;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .25s';
  const add = () => { document.body.appendChild(ring); document.body.appendChild(p); };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  window.__beukPointer = {
    move(x, y) { p.style.left = (x - 11) + 'px'; p.style.top = (y - 11) + 'px'; },
    ring(r) { ring.style.left = (r.x - 5) + 'px'; ring.style.top = (r.y - 5) + 'px'; ring.style.width = (r.width + 10) + 'px'; ring.style.height = (r.height + 10) + 'px'; ring.style.opacity = '1'; },
    unring() { ring.style.opacity = '0'; },
    press() { p.style.transform = 'scale(.75)'; setTimeout(() => { p.style.transform = 'scale(1)'; }, 160); },
  };
})();`;

/** Where to look, in order: an open modal first (it covers the page behind it), then the page. */
async function scopes(page: Page): Promise<(Page | Locator)[]> {
  const open = page.locator('.modal-back.open, dialog[open]').filter({ visible: true });
  return (await open.count()) > 0 ? [open.last(), page] : [page];
}

/** The visible control whose text is `text`: exact first, then starting with it, then containing it. */
async function control(page: Page, text: string, kinds: string): Promise<Locator> {
  const re = escapeRe(text);
  for (const where of await scopes(page)) {
    const all = where.locator(kinds).filter({ visible: true });
    for (const pattern of [new RegExp(`^\\s*${re}\\s*$`), new RegExp(`^\\s*${re}`), new RegExp(re)]) {
      const hit = all.filter({ hasText: pattern });
      // "Visible" can still mean folded away with no box (a collapsed toolbar
      // button): take the first match that actually occupies the screen.
      for (let i = 0, n = await hit.count(); i < n; i++) {
        if (await hit.nth(i).boundingBox()) return hit.nth(i);
      }
    }
  }
  throw new Error(`the studio shows no control "${text}"`);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function pointAt(page: Page, el: Locator, press: boolean): Promise<void> {
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error('control has no box on screen');
  await page.evaluate(([x, y]) => (window as unknown as { __beukPointer: { move(x: number, y: number): void } }).__beukPointer.move(x, y), [box.x + Math.min(box.width * 0.8, box.width - 8), box.y + box.height * 0.75]);
  await page.evaluate((r) => (window as unknown as { __beukPointer: { ring(r: object): void } }).__beukPointer.ring(r), box);
  await sleep(650);
  if (press) {
    await page.evaluate(() => (window as unknown as { __beukPointer: { press(): void } }).__beukPointer.press());
    await el.click();
  }
}

async function run(page: Page, cmd: ShotCommand): Promise<void> {
  const CLICKABLE = 'button, a, [role="button"], [role="tab"], label, summary';
  switch (cmd.verb) {
    case 'click':
    case 'tab':
      await pointAt(page, await control(page, cmd.arg, CLICKABLE), true);
      await sleep(900);
      return;
    case 'show': {
      for (const where of await scopes(page)) {
        const el = where.getByText(cmd.arg, { exact: false }).filter({ visible: true }).first();
        if ((await el.count()) > 0) return pointAt(page, el, false);
      }
      throw new Error(`the studio shows no text "${cmd.arg}"`);
    }
    case 'key':
      await page.keyboard.press(cmd.arg);
      await sleep(600);
      return;
    case 'wait':
      await sleep(Number(cmd.arg) * 1000);
      return;
  }
}

async function setup(page: Page, mode: 'sample' | 'empty'): Promise<void> {
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle' });
  await sleep(1500);
  // A first visit may open the quick tour; close it so lessons start on the desk.
  const skip = page.getByRole('button', { name: /skip the tour/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.keyboard.press('Escape');
  if (mode === 'sample') {
    // Page-wide on purpose: the first-visit tour is itself a dialog.
    await page.locator('button').filter({ visible: true, hasText: /^\s*Load the sample story/ }).first().click();
    await sleep(2500);
    // The sample opens the first chapter; start every lesson from the desk's top.
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

async function studioBuild(): Promise<string> {
  try {
    const r = await fetch(new URL('/api/status/public', STUDIO_URL));
    const j = (await r.json()) as { build?: string; buildStamp?: string; version?: string };
    return j.build ?? j.buildStamp ?? j.version ?? '';
  } catch {
    return '';
  }
}

/* ------------------------------ one lesson ------------------------------ */

interface Segment {
  id: string;
  start: number;
  length: number;
}

async function recordLesson(course: Course, lesson: Lesson, exe: string): Promise<void> {
  const out = path.join(MEDIA_DIR, course.lang, course.slug, lesson.slug);
  const work = path.join(MEDIA_DIR, '.work', course.slug, lesson.slug);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const durations = DRY ? Object.fromEntries(lesson.script.map((s) => [s.id, 1.2])) : speak(lesson, work);
  const browser = await chromium.launch({ executablePath: exe });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    ...(DRY ? {} : { recordVideo: { dir: path.join(work, 'video'), size: { width: W, height: H } } }),
  });
  await context.addInitScript(POINTER_JS);
  const page = await context.newPage();
  const born = Date.now();
  const segments: Segment[] = [];
  const shots: string[] = [];
  let t0 = 0;
  try {
    await setup(page, lesson.setup ?? course.setup);
    await page.evaluate(POINTER_JS);
    t0 = (Date.now() - born) / 1000;
    const clock = () => (Date.now() - born) / 1000 - t0;

    const hold = async (id: string, act?: () => Promise<void>) => {
      const start = clock();
      if (act) await act();
      const left = durations[id] + 0.6 - (clock() - start);
      if (left > 0) await sleep(left * 1000);
      segments.push({ id, start, length: clock() - start });
    };

    await hold('intro');
    for (let i = 0; i < lesson.steps.length; i++) {
      const step = lesson.steps[i];
      await hold(`step-${i + 1}`, async () => {
        // The screenshot shows the step's result, so it is taken before any
        // trailing key presses (a closing Escape) put the desk back.
        let cut = step.shots.length;
        while (cut > 0 && step.shots[cut - 1].verb === 'key') cut -= 1;
        const file = `step-${i + 1}.jpg`;
        for (let k = 0; k <= step.shots.length; k++) {
          if (k === cut) {
            await sleep(400);
            await page.evaluate(() => (window as unknown as { __beukPointer: { unring(): void } }).__beukPointer.unring());
            await page.screenshot({ path: path.join(work, file), type: 'jpeg', quality: 82 });
          }
          if (k === step.shots.length) break;
          const cmd = step.shots[k];
          try {
            await run(page, cmd);
          } catch (err) {
            throw new Error(`step ${i + 1} (${cmd.verb} "${cmd.arg}"): ${(err as Error).message}`);
          }
        }
        shots.push(file);
      });
    }
    if (lesson.script.some((s) => s.id === 'takeaway')) await hold('takeaway');
  } finally {
    await context.close();
    await browser.close();
  }

  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) rmSync(path.join(out, f), { force: true });
  for (const f of shots) renameSync(path.join(work, f), path.join(out, f));
  const cues = Object.fromEntries(segments.map((s) => [s.id, Math.round(s.start * 10) / 10]));

  if (DRY) {
    writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ shots, cues, voice: '', recordedAt: new Date().toISOString(), studioBuild: await studioBuild(), dry: true }, null, 1));
    return;
  }

  // Narration on the recording's timeline: each line padded with silence to its segment's length.
  const parts: string[] = [];
  for (const s of segments) {
    const padded = path.join(work, `seg-${s.id}.wav`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(work, 'voice', `${s.id}.wav`), '-af', `apad=whole_dur=${s.length.toFixed(3)}`, '-ar', '24000', '-ac', '1', padded]);
    parts.push(`file '${padded.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  }
  writeFileSync(path.join(work, 'parts.txt'), parts.join('\n'));
  const narration = path.join(work, 'narration.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'parts.txt'), '-c', 'copy', narration]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', narration, '-codec:a', 'libmp3lame', '-b:a', '96k', path.join(out, 'audio.mp3')]);
  const webm = readdirSync(path.join(work, 'video')).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no recording was written');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', t0.toFixed(3), '-i', path.join(work, 'video', webm),
    '-i', narration,
    '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', '25',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    path.join(out, 'video.mp4'),
  ]);
  const seconds = (f: string) =>
    Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
  const manifest = {
    video: { file: 'video.mp4', seconds: Math.round(seconds(path.join(out, 'video.mp4')) * 10) / 10 },
    audio: { file: 'audio.mp3', seconds: Math.round(seconds(path.join(out, 'audio.mp3')) * 10) / 10 },
    shots,
    cues,
    voice: `Kokoro-82M, ${VOICE}`,
    recordedAt: new Date().toISOString(),
    studioBuild: await studioBuild(),
  };
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

/* ------------------------------ main ------------------------------ */

const content = loadSchoolContent('en');
const exe = chromePath();
const failures: string[] = [];
let made = 0;
for (const course of content.courses) {
  if (COURSE && course.slug !== COURSE) continue;
  for (const lesson of course.lessons) {
    if (ONLY && lesson.slug !== ONLY) continue;
    const label = `${course.slug}/${String(lesson.n).padStart(2, '0')}-${lesson.slug}`;
    const began = Date.now();
    try {
      await recordLesson(course, lesson, exe);
      made += 1;
      console.log(`ok    ${label}  (${((Date.now() - began) / 1000).toFixed(0)} s)`);
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      console.log(`FAIL  ${label}: ${(err as Error).message}`);
    }
  }
}
console.log(`\n${made} lesson(s) ${DRY ? 'walked (dry run)' : 'recorded'}, ${failures.length} failed.`);
if (failures.length) process.exit(1);
