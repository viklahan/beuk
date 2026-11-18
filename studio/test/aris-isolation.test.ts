import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const ARIS_DIR = join(SRC, 'aris');
// src/generated is git-ignored extraction output of 1.0 (its prose holds words like "Paris"), not studio source
const GENERATED = join(SRC, 'generated');
const MOUNT = join('shell', 'Shell.tsx');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p === ARIS_DIR || p === GENERATED) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
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
      const lines = text.split(/\r?\n/).filter((l) => /aris/i.test(l));
      if (!lines.length) continue;
      if (rel === MOUNT.split(sep).join('/')) {
        mountLines = lines.length;
        if (lines.some((l) => !l.includes('// aris mount'))) offenders.push(rel + ' (unmarked line)');
      } else offenders.push(rel);
    }
    expect(offenders, 'files referencing aris outside studio/src/aris and the Shell mount').toEqual([]);
    expect(mountLines).toBeGreaterThan(0);
    expect(mountLines).toBeLessThanOrEqual(2);
  });
});
