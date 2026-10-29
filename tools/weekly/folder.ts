import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DraftUpload } from '../../src/weekly/drafts.js';

/**
 * A drafted issue folder on the Legion, turned into the server's upload.
 * The skill writes the issue files plus four drafter-only files that stay
 * on the Legion and travel as fields instead:
 *
 *   dropped.json      [{ title, why }]   stories that could not be sourced
 *   outlets.json      [name, ...]        outlets read this week
 *   pictures.json     [{ story, prompt }] picture prompts (images.ts)
 *   no-pictures.json  [line, ...]        stories left without a picture
 */
export const DRAFTER_ONLY = ['dropped.json', 'outlets.json', 'pictures.json', 'no-pictures.json'];

const readJson = <T>(dir: string, name: string, fallback: T): T =>
  existsSync(path.join(dir, name)) ? (JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T) : fallback;

export function folderUpload(dir: string, sourceCommit: string): DraftUpload & { noPictures: string[] } {
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (DRAFTER_ONLY.includes(f)) continue;
    files[f] = readFileSync(path.join(dir, f)).toString('base64');
  }
  return {
    sourceCommit,
    files,
    dropped: readJson(dir, 'dropped.json', []),
    outlets: readJson(dir, 'outlets.json', []),
    noPictures: readJson(dir, 'no-pictures.json', []),
  };
}
