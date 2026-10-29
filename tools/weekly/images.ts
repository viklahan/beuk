import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Beuk Weekly drafter: pictures (spec 2026-10-29, "Picture sources, in
 * order"). One ImageProvider seam, tried in this order for each story the
 * skill asked a picture for:
 *
 *   inbox    pictures V drops into content/weekly/inbox/, named <story>.*;
 *            they always win and are used as given (not illustrations)
 *   local    the open-weights model on the Legion's GPU (illustrate.py);
 *            not configured until BEUK_WEEKLY_IMAGE_MODEL names a model V
 *            has chosen and whose licence README.md records
 *   gemini   placeholder: no account route yet (V, 2026-10-29)
 *   muse     placeholder: no account route yet (V, 2026-10-29)
 *
 * A provider that is not configured is skipped and named in the result,
 * never faked; a placeholder's make() throws if it is ever called. A story
 * keeps one picture (the format has one image per story): the skill may
 * give two prompts, and the second is only tried when the first made
 * nothing. A generated picture gets `illustration: yes`, so its caption
 * ends "Illustration, generated for Beuk Weekly."; its provider, model,
 * seed and prompt go into sources.json.
 */

export type ProviderName = 'inbox' | 'local' | 'gemini' | 'muse';

export interface MadePicture {
  /** File name written into the issue folder. */
  file: string;
  model: string | null;
  seed: number | null;
}

export interface ImageProvider {
  name: ProviderName;
  /** null = ready; otherwise why not. */
  configured(): Promise<string | null>;
  make(story: string, prompt: string, outDir: string): Promise<MadePicture | null>;
}

export interface PictureResult {
  made: Record<string, string[]>;
  skipped: { provider: string; reason: string }[];
  noPictures: string[];
}

const PICTURE = /\.(jpg|jpeg|png|webp)$/i;

export function inboxProvider(inboxDir: string): ImageProvider {
  return {
    name: 'inbox',
    configured: async () => (existsSync(inboxDir) ? null : `no inbox folder at ${inboxDir}`),
    make: async (story, _prompt, outDir) => {
      const hit = existsSync(inboxDir) ? readdirSync(inboxDir).find((f) => PICTURE.test(f) && path.parse(f).name === story) : undefined;
      if (!hit) return null;
      const file = `${story}${path.extname(hit).toLowerCase().replace('.jpeg', '.jpg')}`;
      copyFileSync(path.join(inboxDir, hit), path.join(outDir, file));
      return { file, model: null, seed: null };
    },
  };
}

const placeholder = (name: 'gemini' | 'muse'): ImageProvider => ({
  name,
  configured: async () => 'placeholder: no account route yet (V, 2026-10-29)',
  make: async () => {
    throw new Error(`${name} is a placeholder and makes no pictures`);
  },
});
export const geminiProvider = placeholder('gemini');
export const museProvider = placeholder('muse');

/**
 * The local model through illustrate.py. Ready only when
 * BEUK_WEEKLY_IMAGE_MODEL is set and python can import diffusers; it draws
 * `count` candidates and keeps the first (V judges it on the preview).
 */
export function localProvider(opts: { python?: string; model?: string; seed?: number; count?: number } = {}): ImageProvider {
  const python = opts.python ?? process.env.BEUK_WEEKLY_PYTHON ?? 'python';
  const model = opts.model ?? process.env.BEUK_WEEKLY_IMAGE_MODEL ?? '';
  const script = path.join(import.meta.dirname, 'illustrate.py');
  return {
    name: 'local',
    configured: async () => {
      if (!model) return 'BEUK_WEEKLY_IMAGE_MODEL is not set: no local model has been chosen (tools/weekly/README.md)';
      const probe = spawnSync(python, ['-I', '-c', 'import diffusers, torch; print(torch.cuda.is_available())'], { encoding: 'utf8' });
      if (probe.status !== 0) return `python cannot import diffusers/torch (${(probe.stderr || String(probe.error ?? '')).trim().split('\n').pop()})`;
      if (probe.stdout.trim() !== 'True') return 'torch sees no CUDA GPU';
      return null;
    },
    make: async (story, prompt, outDir) => {
      const work = mkdtempSync(path.join(tmpdir(), 'beuk-illustrate-'));
      try {
        const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
        writeFileSync(path.join(work, 'prompt.json'), JSON.stringify({ prompt }));
        const run = spawnSync(
          python,
          ['-I', script, '--prompt-file', path.join(work, 'prompt.json'), '--out', work, '--seed', String(seed), '--count', String(opts.count ?? 3), '--model', model],
          { encoding: 'utf8', timeout: 30 * 60 * 1000 },
        );
        if (run.status !== 0) throw new Error(`illustrate.py failed: ${(run.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
        const meta = JSON.parse(readFileSync(path.join(work, 'meta.json'), 'utf8')) as { model: string; candidates: { seed: number; jpg: string }[] };
        const first = meta.candidates[0];
        if (!first) return null;
        const file = `${story}.jpg`;
        copyFileSync(path.join(work, first.jpg), path.join(outDir, file));
        return { file, model: meta.model, seed: first.seed };
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
  };
}

/** Add front-matter lines to a story (after its opening ---). */
function addFrontMatter(file: string, lines: string[]): void {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) throw new Error(`${file}: missing front matter`);
  writeFileSync(file, `---\n${lines.join('\n')}\n${text.slice(4)}`);
}
const hasImage = (file: string) => /^image:\s*\S/m.test(readFileSync(file, 'utf8').split(/\n---/)[0]);

export async function makePictures(issueDir: string, pictures: { story: string; prompt: string }[], providers: ImageProvider[]): Promise<PictureResult> {
  const result: PictureResult = { made: {}, skipped: [], noPictures: [] };
  const ready: ImageProvider[] = [];
  for (const p of providers) {
    const why = await p.configured();
    if (why === null) ready.push(p);
    else result.skipped.push({ provider: p.name, reason: why });
  }
  const sourcesFile = path.join(issueDir, 'sources.json');
  const sources = JSON.parse(readFileSync(sourcesFile, 'utf8')) as unknown[];
  const stories = [...new Set(pictures.map((p) => p.story))];
  for (const story of stories) {
    const file = path.join(issueDir, `${story}.md`);
    if (!/^[a-z0-9-]+$/.test(story) || !existsSync(file)) throw new Error(`pictures.json names a story that is not in the issue: ${story}`);
    if (hasImage(file)) continue;
    let made: { provider: ImageProvider; pic: MadePicture; prompt: string } | null = null;
    for (const provider of ready) {
      for (const { prompt } of pictures.filter((p) => p.story === story)) {
        let pic: MadePicture | null;
        try {
          pic = await provider.make(story, prompt, issueDir);
        } catch (err) {
          result.skipped.push({ provider: provider.name, reason: `${story}: ${(err as Error).message}` });
          continue;
        }
        if (pic) {
          made = { provider, pic, prompt };
          break;
        }
        if (provider.name === 'inbox') break; // the inbox answers per story, not per prompt
      }
      if (made) break;
    }
    if (!made) {
      result.noPictures.push(story);
      continue;
    }
    const generated = made.provider.name !== 'inbox';
    addFrontMatter(file, [`image: ${made.pic.file}`, ...(generated ? ['illustration: yes'] : [])]);
    result.made[story] = [made.pic.file];
    if (generated) sources.push({ story, picture: { provider: made.provider.name, model: made.pic.model, seed: made.pic.seed, prompt: made.prompt } });
  }
  writeFileSync(sourcesFile, JSON.stringify(sources, null, 2));
  return result;
}
