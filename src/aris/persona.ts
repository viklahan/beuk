import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../warmth/pages.js';

/**
 * Aris's single source: content/aris/persona.md. "## Page" renders the
 * public /aris page; "## Core" is every lens's system prompt; "## Laconic"
 * and "## Homeric" are the voice dial for talking surfaces only. The
 * writer-facing persona and the model's instructions are the same text,
 * so they cannot drift. Read once per process.
 */
export type ArisPersona = { page: string; core: string; laconic: string; homeric: string };

const SECTIONS = { Page: 'page', Core: 'core', Laconic: 'laconic', Homeric: 'homeric' } as const;

export function personaPath(): string {
  return path.join(repoRoot(), 'content', 'aris', 'persona.md');
}

export function parsePersona(md: string): ArisPersona {
  const out: Partial<ArisPersona> = {};
  const parts = md.replace(/\r\n/g, '\n').split(/^## +(.+?)\s*$/m);
  // parts = [preamble, name1, body1, name2, body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const key = SECTIONS[name as keyof typeof SECTIONS];
    if (!key) throw new Error(`persona.md: unknown section "## ${name}"`);
    if (out[key] !== undefined) throw new Error(`persona.md: duplicate section "## ${name}"`);
    const body = parts[i + 1].trim();
    if (!body) throw new Error(`persona.md: section "## ${name}" is empty`);
    out[key] = body;
  }
  for (const [name, key] of Object.entries(SECTIONS)) {
    if (out[key] === undefined) throw new Error(`persona.md: missing section "## ${name}"`);
  }
  return out as ArisPersona;
}

let cached: ArisPersona | null = null;

export function loadPersona(): ArisPersona {
  if (!cached) cached = Object.freeze(parsePersona(readFileSync(personaPath(), 'utf8')));
  return cached;
}
