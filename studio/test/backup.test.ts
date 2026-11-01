// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { backupFilename, backupJson, parseBackup, slug } from '../src/book/backup';
import { fixtures } from './fixtures';

/* 1.0's slug, localBackupFilename and localParseBackup, lifted from
   client/index.html and run beside the port. */
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const lift = (re: RegExp, what: string): string => {
  const m = re.exec(HTML);
  if (!m) throw new Error(`client/index.html no longer has ${what}`);
  return m[0];
};
const SLUG_SRC = lift(/function slug\(s\) \{[^\n]*\}/, 'function slug(s)');
const FILENAME_SRC = lift(/function localBackupFilename\(\) \{[\s\S]*?\n {6}\}/, 'function localBackupFilename()');
const PARSE_SRC = lift(/function localParseBackup\(text\) \{[\s\S]*?\n {6}\}/, 'function localParseBackup(text)');

type One = { slug(s: unknown): string; filename(title: unknown, d: Date): string; parse(text: string): unknown };
function one(): One {
  const ctx = vm.createContext({ state: { meta: { title: '' } }, __date: new Date() });
  vm.runInContext(
    `${SLUG_SRC}\n${PARSE_SRC}\nconst RealDate = Date; ${FILENAME_SRC.replace('new Date()', '__date')}\nthis.api = { slug, parse: localParseBackup, filename(title, d) { state.meta.title = title; __date = d; return localBackupFilename(); } };`,
    ctx,
  );
  return (ctx as unknown as { api: One }).api;
}

const TITLES = [
  'The Three Musketeers',
  '  Les Trois Mousquetaires — Tome I  ',
  'Glinda of Oz!',
  'العودة إلى البحر',
  'किताब जो आपको पढ़ती है',
  '海辺のランタン',
  'Ünïcödé Çafé Ångström',
  'Book 2: The Salt Road (Draft #3)',
  '---',
  '',
];

describe("1.0's backup file", () => {
  const ref = one();

  it('slug is 1.0\'s slug on 10 titles, non-Latin included', () => {
    for (const ti of TITLES) expect(slug(ti), JSON.stringify(ti)).toBe(ref.slug(ti));
    expect(slug('العودة إلى البحر')).toBe('section'); // non-Latin titles slug to 1.0's fallback
    expect(slug('The Three Musketeers')).toBe('the-three-musketeers');
  });

  it('the filename is 1.0\'s: slug or "book", the local date, .beuk-backup.json', () => {
    const d = new Date(2026, 9, 31, 23, 59);
    for (const ti of TITLES) expect(backupFilename(ti, d), JSON.stringify(ti)).toBe(ref.filename(ti, d));
    expect(backupFilename('The Three Musketeers', d)).toBe('the-three-musketeers-2026-10-31.beuk-backup.json');
    expect(backupFilename('   ', d)).toBe('book-2026-10-31.beuk-backup.json');
    expect(backupFilename(undefined, new Date(2026, 0, 5))).toBe('book-2026-01-05.beuk-backup.json');
  });

  it('the payload is 1.0\'s: { format, version: 1, exportedAt, book }, unindented, in that key order', () => {
    const d = new Date('2026-10-31T12:00:00.000Z');
    const book = { meta: { title: 'X' }, sections: [] };
    const s = backupJson(book, d);
    expect(s).toBe('{"format":"beuk-backup","version":1,"exportedAt":"2026-10-31T12:00:00.000Z","book":{"meta":{"title":"X"},"sections":[]}}');
    expect(ref.parse(s)).toEqual(book);
  });

  it('parseBackup accepts exactly what 1.0 accepts', () => {
    const cases = [
      '{"format":"beuk-backup","version":1,"book":{"sections":[]}}',
      '{"format":"beuk-backup","book":{"sections":[{"id":"a"}]}}',
      '{"format":"beuk-backup","version":99,"book":{"sections":[]}}',
      '{"format":"beuk-backup","book":{"sections":{}}}',
      '{"format":"beuk-backup","book":[]}',
      '{"format":"beuk-backup","book":null}',
      '{"format":"other","book":{"sections":[]}}',
      '{"book":{"sections":[]}}',
      '[]',
      'null',
      'not json',
      '',
    ];
    for (const c of cases) expect(parseBackup(c), c).toEqual(ref.parse(c));
    for (const f of fixtures('real')) expect(parseBackup(f.text), f.name).toEqual(ref.parse(f.text));
  });
});
