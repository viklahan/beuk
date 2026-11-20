import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const ARIS_DIR = join(SRC, 'aris');
// src/generated is git-ignored extraction output of 1.0 (its prose holds words like "Paris"): only an import/path is checked there
const GENERATED = join(SRC, 'generated');
const MOUNT = 'shell/Shell.tsx';
const TEXT = /\.(ts|tsx|js|jsx|css|html)$/;
const GENERATED_IMPORT = /from\s+['"][^'"]*aris|import\(.*aris/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (p === ARIS_DIR || e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && TEXT.test(e.name)) out.push(p);
  }
  return out;
}

describe('aris isolation', () => {
  it('aris leaks into no studio file beyond its mount', () => {
    const offenders: string[] = [];
    let mountLines = 0;
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split(sep).join('/');
      let text: string;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      const generated = f.startsWith(GENERATED + sep);
      const lines = text.split(/\r?\n/).filter((l) => (generated ? GENERATED_IMPORT.test(l) : /aris/i.test(l)));
      if (!lines.length) continue;
      if (rel === MOUNT) {
        mountLines = lines.length;
        if (lines.some((l) => !l.includes('// aris mount'))) offenders.push(rel + ' (unmarked line)');
      } else offenders.push(rel);
    }
    expect(offenders, 'files referencing aris outside studio/src/aris and the Shell mount').toEqual([]);
    expect(mountLines).toBeGreaterThan(0);
    expect(mountLines).toBeLessThanOrEqual(2);
  });
});
