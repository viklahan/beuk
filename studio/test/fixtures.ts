import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/* The committed book corpus (repo tests/fixtures/books), read from the
   studio's tests: the real gallery books and the legacy-shape books. */
export const BOOKS = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'books');

export type Fixture = { name: string; file: string; text: string; book: Record<string, unknown> };

export function fixtures(kind: 'real' | 'legacy' | 'all' = 'all'): Fixture[] {
  const kinds = kind === 'all' ? (['real', 'legacy'] as const) : [kind];
  return kinds.flatMap((k) =>
    readdirSync(path.join(BOOKS, k))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const file = path.join(BOOKS, k, f);
        const text = readFileSync(file, 'utf8');
        return { name: `${k}/${f.replace(/\.json$/, '')}`, file, text, book: (JSON.parse(text) as { book: Record<string, unknown> }).book };
      }),
  );
}

export const DUMAS = 'real/dartagnan-01-three-musketeers';
