/**
 * Beuk Weekly drafter: make the pictures pictures.json asks for (images.ts).
 *
 *   node --import tsx tools/weekly/pictures.ts <folder> --inbox <dir>
 *
 * Writes no-pictures.json (the stories left without one, with why) for the
 * editor's email, and prints what each provider did. Never fails a run for
 * a missing picture: a story without one is listed, not invented.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { geminiProvider, inboxProvider, localProvider, makePictures, museProvider } from './images.js';

const dir = process.argv[2];
const i = process.argv.indexOf('--inbox');
const inbox = i > 0 ? process.argv[i + 1] : path.join(process.cwd(), 'content', 'weekly', 'inbox');
if (!dir) {
  console.error('usage: pictures.ts <folder> --inbox <dir>');
  process.exit(1);
}
const file = path.join(dir, 'pictures.json');
const wanted = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { story: string; prompt: string }[]) : [];
const r = await makePictures(dir, wanted, [inboxProvider(inbox), localProvider(), geminiProvider, museProvider]);
const why = r.skipped.length ? r.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ') : 'no provider made one';
writeFileSync(path.join(dir, 'no-pictures.json'), JSON.stringify(r.noPictures.map((s) => `${s}: ${why}`), null, 2));
for (const [story, files] of Object.entries(r.made)) console.log(`picture: ${story} → ${files.join(', ')}`);
for (const s of r.skipped) console.log(`skipped ${s.provider}: ${s.reason}`);
for (const s of r.noPictures) console.log(`no picture: ${s}`);
