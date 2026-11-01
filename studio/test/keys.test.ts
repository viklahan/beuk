// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { NEXT_STRINGS, PENDING_SIGNOFF } from '../src/i18n/next-strings';

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
        if (!(m[2]! in en) && !(m[2]! in NEXT_STRINGS.en!)) missing.push(`${path.relative(SRC, f)}: ${m[2]}`);
      }
    }
    expect(used.length).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });
});

describe("2.0's own keys (i18n/next-strings.ts)", () => {
  const keys = Object.keys(NEXT_STRINGS.en!);
  it("are new keys only: none of them exists in 1.0's English pack (never a second copy of a 1.0 string)", () => {
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => k in en)).toEqual([]);
  });
  it("every interface language has every key (English, or the English placeholder awaiting V's sign-off)", () => {
    expect(Object.keys(NEXT_STRINGS).sort()).toEqual([...meta.order].sort());
    for (const code of meta.order) {
      const pack = NEXT_STRINGS[code]!;
      expect(Object.keys(pack).sort(), code).toEqual([...keys].sort());
      for (const k of keys) expect(typeof (pack as Record<string, string>)[k] === 'string' && (pack as Record<string, string>)[k] !== '', `${code} ${k}`).toBe(true);
    }
    expect([...PENDING_SIGNOFF].sort()).toEqual([...keys].sort());
  });
});
