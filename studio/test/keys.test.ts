// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';

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


/* The 22 keys 2.0 once kept in an overlay (i18n/next-strings.ts) now live in 1.0's catalog (client/index.html
   UI_STRINGS, the BEUK:next-strings block) and so in every generated pack. Their non-English text is a DRAFT:
   nothing here is approved; V signs off each translation (docs/strings-pending-signoff.md lists them). */
const NEXT_KEYS = [
  'next.textWarning', 'next.textWarningPlural', 'next.markRefused', 'next.snapshotGone', 'next.bookReplaced',
  'next.themes.everyH', 'next.themes.everySub', 'next.themes.account', 'next.themes.deviceOnly', 'next.themes.empty',
  'next.themes.keep', 'next.themes.kept', 'next.themes.removed', 'next.themes.offer', 'next.themes.offerYes',
  'next.themes.offerNo', 'next.themes.moveOffer', 'next.themes.moveYes', 'next.themes.deviceSuffix',
  'next.themes.conflict', 'next.themes.full', 'next.themes.refused',
] as const;
const PACKS = path.join(import.meta.dirname, '..', 'src', 'generated', 'packs');
const pack = (code: string): Record<string, string> => JSON.parse(readFileSync(path.join(PACKS, `${code}.json`), 'utf8'));
const holes = (s: string): string[] => [...s.matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0]).sort();

describe('the next.* keys are in the catalog (step 6)', () => {
  it('there are 22 and en.json has exactly them under next.', () => {
    expect(NEXT_KEYS.length).toBe(22);
    expect(Object.keys(en).filter((k) => k.startsWith('next.')).sort()).toEqual([...NEXT_KEYS].sort());
  });
  it('every interface language has every key, as non-empty text, with the English placeholders byte for byte', () => {
    const e = pack('en');
    for (const code of meta.order) {
      const p = pack(code);
      for (const k of NEXT_KEYS) {
        expect(typeof p[k] === 'string' && p[k] !== '', `${code} ${k}`).toBe(true);
        expect(holes(p[k]!), `${code} ${k}`).toEqual(holes(e[k]!));
        if (code !== 'en') expect(p[k], `${code} ${k} is still the English placeholder`).not.toBe(e[k]);
      }
    }
  });
  it('the "this device" name in the conflict text is the suffix (trimmed), in every language', () => {
    for (const code of meta.order) {
      const p = pack(code);
      expect(p['next.themes.conflict'], code).toContain(p['next.themes.deviceSuffix']!.trim());
    }
  });
  it('the overlay is gone: no next-strings.ts, and nothing imports it', () => {
    expect(existsSync(path.join(SRC, 'i18n', 'next-strings.ts'))).toBe(false);
    const users = files(SRC).filter((f) => /next-strings/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(SRC, f))).toEqual([]);
  });
  it('docs/strings-pending-signoff.md lists every key as a draft, and approves none of them', () => {
    const doc = readFileSync(path.join(import.meta.dirname, '..', '..', 'docs', 'strings-pending-signoff.md'), 'utf8');
    expect(doc.toLowerCase()).toContain('not approved');
    for (const k of NEXT_KEYS) expect(doc, k).toContain('`' + k + '`');
    expect(doc.toLowerCase()).not.toMatch(/\bapproved by\b|\bsigned off by v\b/);
  });
});
