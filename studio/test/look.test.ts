// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === 'generated' ? [] : files(p);
    return [p];
  });
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* Colours come only from the tokens extracted from 1.0. If a literal
   colour is ever truly needed, it goes here with the reason. */
const COLOUR_ALLOWLIST: { file: string; text: string; why: string }[] = [
  { file: 'styles/notebook.css', text: '#fff', why: "1.0's .rs-pdf: a PDF page frame is white in both themes (the PDF viewer paints its own page)" },
  { file: 'styles/outline.css', text: 'rgba(20,44,52,.08)', why: "1.0's .ol-card shadow, verbatim (1.0 keeps it literal in both themes; no token holds it)" },
  { file: 'styles/outline.css', text: 'rgba(20,44,52,.13)', why: "1.0's .ol-card:hover / .active shadow, verbatim (as above)" },
];

describe('the look: tokens only, logical properties only (review focus #3, #1)', () => {
  const css = files(SRC).filter((f) => f.endsWith('.css'));
  const tsx = files(SRC).filter((f) => /\.(tsx?|jsx?)$/.test(f));

  it('there is ported CSS to check', () => {
    expect(css.map(rel)).toContain('styles/shell.css');
  });

  it('no hex, rgb() or hsl() colour outside src/generated/tokens.css', () => {
    const bad: string[] = [];
    for (const f of css) {
      const text = stripComments(readFileSync(f, 'utf8'));
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g)) {
        if (!COLOUR_ALLOWLIST.some((a) => a.file === rel(f) && text.slice(m.index!, m.index! + a.text.length) === a.text)) bad.push(`${rel(f)}: ${m[0]}`);
      }
    }
    for (const f of tsx) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(?:fill|stroke|color|background(?:Color)?|borderColor)\s*[:=]\s*[{"'`]*\s*(#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\()/g)) bad.push(`${rel(f)}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('no physical left/right property (the Arabic chrome mirrors on its own)', () => {
    const bad: string[] = [];
    const physical = /(?:^|[\s;{])((?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?|(?:left|right)|border-(?:top|bottom)-(?:left|right)-radius)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)|clear\s*:\s*(?:left|right)/g;
    for (const f of css) for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(physical)) bad.push(`${rel(f)}: ${m[0].trim()}`);
    for (const f of tsx) for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:marginLeft|marginRight|paddingLeft|paddingRight|left|right|borderLeft\w*|borderRight\w*)\s*:/g)) bad.push(`${rel(f)}: ${m[0]}`);
    expect(bad).toEqual([]);
  });

  it('every token the shell reads is declared by 1.0 (or locally)', () => {
    const tokens = readFileSync(path.join(SRC, 'generated', 'tokens.css'), 'utf8');
    const declared = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing: string[] = [];
    for (const f of css) {
      const text = stripComments(readFileSync(f, 'utf8'));
      const local = new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) if (!declared.has(m[1]) && !local.has(m[1])) missing.push(`${rel(f)}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
