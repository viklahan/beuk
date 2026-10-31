import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* BEUK:book-fixtures — where the committed book corpus lives and how to
   read it. Every book-format test goes through here so none of them
   hard-codes a path. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'fixtures', 'books');

/** Absolute path inside tests/fixtures/books. */
export function fixturePath(...p: string[]): string {
  return path.join(ROOT, ...p);
}

/** The slimmed real gallery books: the `book` of each backup envelope, by file name. */
export function realFixtures(): { name: string; book: unknown }[] {
  const dir = fixturePath('real');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      book: (JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { book: unknown }).book,
    }));
}
