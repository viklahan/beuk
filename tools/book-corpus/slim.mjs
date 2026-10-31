#!/usr/bin/env node
/* Slim a Beuk backup into a committed test fixture.
 *
 *   node tools/book-corpus/slim.mjs <src.beuk-backup.json> <out.json> --why "<coverage reason>"
 *
 * Keys, key order and text are copied unchanged. Only binary payloads
 * change: every object that has a string `data` and a string
 * `mediaType` gets the smallest valid file of that media type (a 1x1
 * PNG, JPEG, GIF or WebP); any other media type gets a 4-byte base64
 * stub. `beuk-pic:` refs are left alone. Each replacement is recorded
 * in the output's top-level `_fixture.slimmed` (paths are relative to
 * the book; a stub is marked "<path> (stub)"). The source is only read. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Smallest valid files, 1x1 white, made with Pillow and re-opened to check. */
const TINY = {
  'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC',
  'image/jpeg':
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'image/gif': 'R0lGODdhAQABAIEAAP///wAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==',
  'image/webp': 'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
};
TINY['image/jpg'] = TINY['image/jpeg'];
const STUB = 'AAAAAA=='; // 4 zero bytes

export function slim(envelope, { source, why }) {
  const slimmed = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const here = p ? `${p}.${k}` : k;
        if (k === 'data' && typeof x === 'string' && typeof v.mediaType === 'string') {
          const tiny = TINY[v.mediaType.toLowerCase()];
          out[k] = tiny ?? STUB;
          slimmed.push(tiny ? here : `${here} (stub)`);
        } else out[k] = walk(x, here);
      }
      return out;
    }
    return v;
  };
  const book = walk(envelope.book, '');
  return { ...envelope, book, _fixture: { source, slimmed, why } };
}

/* The gallery-relative path with forward slashes (e.g. 10-ramp-gallery/books/x.json),
 * so no machine-specific directory or user name is written into a fixture. */
function neutralSource(src) {
  const full = path.resolve(src).split(path.sep).join('/');
  const marker = '10-ramp-gallery/';
  const i = full.lastIndexOf(marker);
  return i >= 0 ? full.slice(i) : path.basename(full);
}

function main(argv) {
  const args = argv.slice();
  const wi = args.indexOf('--why');
  const why = wi >= 0 ? args.splice(wi, 2)[1] : '';
  const [src, out] = args;
  if (!src || !out || !why) {
    console.error('usage: slim.mjs <src.beuk-backup.json> <out.json> --why "<coverage reason>"');
    process.exit(2);
  }
  const envelope = JSON.parse(readFileSync(src, 'utf8'));
  if (!envelope || typeof envelope !== 'object' || !envelope.book) {
    console.error(`${src}: not a backup envelope (no book)`);
    process.exit(1);
  }
  const result = slim(envelope, { source: neutralSource(src), why });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(`${path.basename(out)}: ${result._fixture.slimmed.length} payloads slimmed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
