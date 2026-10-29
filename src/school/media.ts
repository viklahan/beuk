import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A lesson's produced media, as tools/school-media/record.mjs writes it:
 *
 *   <SCHOOL_MEDIA_DIR>/<lang>/<course>/<lesson>/manifest.json
 *
 * Every field comes from the recording run itself (durations measured from
 * the files, the studio build it was recorded against, the voice used).
 * Nothing here is guessed: a lesson without a readable manifest has no
 * Watch or Listen view, and a manifest naming a file that is not there
 * drops that view too.
 */
export interface LessonMedia {
  video: { file: string; seconds: number } | null;
  audio: { file: string; seconds: number } | null;
  /** One screenshot per step, in step order (null where none was taken). */
  shots: (string | null)[];
  /** Transcript cue times (seconds into the audio) per script line id. */
  cues: Record<string, number>;
  voice: string;
  recordedAt: string;
  studioBuild: string;
}

interface RawManifest {
  video?: { file?: unknown; seconds?: unknown };
  audio?: { file?: unknown; seconds?: unknown };
  shots?: unknown;
  cues?: unknown;
  voice?: unknown;
  recordedAt?: unknown;
  studioBuild?: unknown;
}

const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*\.(mp4|webm|mp3|m4a|jpg|jpeg|png|webp)$/i;

const cache = new Map<string, { mtimeMs: number; media: LessonMedia | null }>();

/** Public URL of a media file (Caddy serves SCHOOL_MEDIA_DIR at /school/media/). */
export function mediaUrl(lang: string, course: string, lesson: string, file: string): string {
  return `/school/media/${lang}/${course}/${lesson}/${file}`;
}

export function readLessonMedia(mediaDir: string, lang: string, course: string, lesson: string): LessonMedia | null {
  const dir = path.join(mediaDir, lang, course, lesson);
  const file = path.join(dir, 'manifest.json');
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.media;
  let media: LessonMedia | null = null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as RawManifest;
    const present = (f: unknown): f is string => {
      if (typeof f !== 'string' || !SAFE_FILE.test(f)) return false;
      try {
        return statSync(path.join(dir, f)).isFile();
      } catch {
        return false;
      }
    };
    const track = (t: RawManifest['video']) =>
      t && present(t.file) && typeof t.seconds === 'number' && t.seconds > 0 ? { file: t.file, seconds: t.seconds } : null;
    media = {
      video: track(raw.video),
      audio: track(raw.audio),
      shots: Array.isArray(raw.shots) ? raw.shots.map((s) => (present(s) ? s : null)) : [],
      cues:
        raw.cues && typeof raw.cues === 'object'
          ? Object.fromEntries(Object.entries(raw.cues as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'))
          : {},
      voice: typeof raw.voice === 'string' ? raw.voice : '',
      recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : '',
      studioBuild: typeof raw.studioBuild === 'string' ? raw.studioBuild : '',
    };
  } catch {
    media = null;
  }
  cache.set(file, { mtimeMs, media });
  return media;
}
