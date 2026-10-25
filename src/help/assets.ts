import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { clientDir } from '../warmth/pages.js';

/**
 * The Help pages' own stylesheet and scripts (client/help/help.css,
 * help.js, theme.js), served at content-hashed paths:
 *
 *   /help/static/help.<hash>.css   /help/static/help.<hash>.js
 *   /help/static/theme.<hash>.js
 *
 * Why hashed paths and not ?v=: the studio's service worker (scope /)
 * answers same-origin static GETs cache-first with ignoreSearch, so a
 * query string would never bust it — a new path does. The worker is
 * left unchanged (cache name beuk-shell-v4).
 */

const FILES = {
  'help.css': 'text/css; charset=utf-8',
  'help.js': 'application/javascript; charset=utf-8',
  'theme.js': 'application/javascript; charset=utf-8',
} as const;
export type HelpAssetName = keyof typeof FILES;

interface Loaded {
  body: string;
  hash: string;
  mtime: number;
}
const loaded = new Map<HelpAssetName, Loaded>();

function load(name: HelpAssetName): Loaded {
  const file = path.join(clientDir(), 'help', name);
  const prod = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  const have = loaded.get(name);
  if (have && prod) return have;
  const mtime = statSync(file).mtimeMs;
  if (have && have.mtime === mtime) return have;
  const body = readFileSync(file, 'utf8');
  const next = { body, hash: createHash('sha256').update(body).digest('hex').slice(0, 12), mtime };
  loaded.set(name, next);
  return next;
}

export function helpAssetUrl(name: HelpAssetName): string {
  const { hash } = load(name);
  const dot = name.lastIndexOf('.');
  return `/help/static/${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
}

/** Resolve /help/static/<file> → the asset, or null (unknown, or a stale hash). */
export function helpAssetFor(file: string): { body: string; type: string; current: boolean } | null {
  const m = /^(help|theme)\.([0-9a-f]{12})\.(css|js)$/.exec(file);
  if (!m) return null;
  const name = `${m[1]}.${m[3]}` as HelpAssetName;
  if (!(name in FILES)) return null;
  const a = load(name);
  return { body: a.body, type: FILES[name], current: a.hash === m[2] };
}
