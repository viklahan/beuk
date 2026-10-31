// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import en from '../src/generated/packs/en.json';

/* Every t("…") key studio/src uses must exist in 1.0's English pack. The
   UiKey type already makes tsc (and so the build) fail on a renamed or
   removed key; this scan also covers a call that slips past the type (a
   cast, a plain JS file). */
const SRC = path.join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === 'generated' ? [] : files(p);
    return /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });

describe("t() keys are 1.0's", () => {
  it('every t("…") literal in studio/src is a key of the English pack', () => {
    const used: string[] = [];
    const missing: string[] = [];
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*(['"`])([^'"`]+)\1/g)) {
        used.push(m[2]!);
        if (!(m[2]! in en)) missing.push(`${path.relative(SRC, f)}: ${m[2]}`);
      }
    }
    expect(used.length).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });
});
