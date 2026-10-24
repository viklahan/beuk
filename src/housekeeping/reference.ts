import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reference pillar: the architecture summary and the roadmap, rendered
 * from files in the repo (docs/) — never hand-copied into responses,
 * so what Housekeeping shows is what the repo says.
 */
export function docsDir(): string {
  // src/housekeeping (tsx dev) and dist/housekeeping (compiled) both sit
  // two levels below the project root, where docs/ lives.
  return path.resolve(import.meta.dirname, '..', '..', 'docs');
}

export async function readReferenceDoc(
  kind: 'architecture' | 'roadmap',
): Promise<{ title: string; content: string }> {
  const file = kind === 'architecture' ? 'architecture.md' : 'roadmap.md';
  const content = await readFile(path.join(docsDir(), file), 'utf8');
  const title = /^#\s+(.+)$/m.exec(content)?.[1] ?? file;
  return { title, content };
}
