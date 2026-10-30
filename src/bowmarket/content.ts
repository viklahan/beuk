import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { inlineHtml, inlineText } from '../help/content.js';
import { repoRoot } from '../warmth/pages.js';
import { frontMatter } from '../weekly/content.js';

/**
 * Bowmarket — the School's bookshop (V, 2026-10-29): books and box sets
 * sold through Stripe Payment Links. Like the Weekly, the
 * files ARE the content:
 *
 *   content/bowmarket/<lang>/<slug>.md     one item (a book or a set)
 *   content/bowmarket/<lang>/<file>.webp   the pictures items name
 *
 * Front matter: title, kind (book | set), author, deck (the one line under
 * the title), image (the card picture), order; optional subtitle, series,
 * volume, pages, trim, formats ([PDF, EPUB]: what a buyer gets), gallery
 * ([file, file]), source (the manuscript the
 * book was made from, never served), contents (a set: [slug, slug], each a
 * book here), shape (wide: the picture is landscape and is shown whole),
 * spine + spineInk (the 3D book's spine and lettering colours, #rrggbb),
 * price (USD, e.g. 2.99) and buy (a Stripe Payment Link,
 * https://buy.stripe.com/…). An item is for sale only when it has both a
 * price and a link; until then its button says "Coming soon" and nothing
 * can be bought. Pictures are illustrations from inside the book, and the
 * pages say so; none is passed off as a cover.
 *
 * Body: paragraphs and `> ` quotes (lines from the book), with the same
 * inline Markdown as Help. Raw HTML is always escaped.
 */

export const BOWMARKET_LANGS = ['en'] as const;
export type ItemKind = 'book' | 'set';
export type ItemBlock = { kind: 'p'; html: string; text: string } | { kind: 'quote'; html: string; text: string };

export interface Item {
  slug: string;
  title: string;
  kind: ItemKind;
  order: number;
  author: string;
  subtitle: string | null;
  series: string | null;
  volume: number | null;
  deck: string;
  image: string;
  /** The picture is landscape (shape: wide) and is shown whole, not cropped. */
  wide: boolean;
  /** The 3D book's spine colour and the colour of its lettering. */
  spine: string;
  spineInk: string;
  gallery: string[];
  pages: number | null;
  trim: string | null;
  formats: string[];
  source: string | null;
  contents: string[];
  /** Price in cents (USD), or null until one is set. */
  priceCents: number | null;
  buy: string | null;
  blocks: ItemBlock[];
  file: string;
}

export interface BowmarketContent {
  items: Item[];
  itemBySlug: Map<string, Item>;
  dir: string;
  stamp: string;
}

const SAFE_IMAGE = /^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/i;
/** Stripe Payment Links live on buy.stripe.com; nothing else is sent a buyer. */
export const STRIPE_LINK_RE = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]{4,200}$/;
const PRICE_RE = /^\d{1,4}(\.\d{2})?$/;

export function bowmarketDir(lang: (typeof BOWMARKET_LANGS)[number] = 'en'): string {
  return path.join(repoRoot(), 'content', 'bowmarket', lang);
}

const str = (meta: Record<string, unknown>, key: string): string | null => {
  const v = meta[key];
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const need = (meta: Record<string, unknown>, key: string, file: string): string => {
  const v = str(meta, key);
  if (!v) throw new Error(`${file}: front matter needs "${key}"`);
  return v;
};
const list = (meta: Record<string, unknown>, key: string): string[] => (Array.isArray(meta[key]) ? (meta[key] as string[]) : []);

export function parseItem(source: string, file: string): Item {
  const slug = path.basename(file, '.md');
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`${file}: item files are lower-case slugs`);
  const { meta, body } = frontMatter(source, file);
  const kind = need(meta, 'kind', file) as ItemKind;
  if (kind !== 'book' && kind !== 'set') throw new Error(`${file}: kind is book or set`);
  const image = need(meta, 'image', file);
  const gallery = list(meta, 'gallery');
  for (const f of [image, ...gallery]) if (!SAFE_IMAGE.test(f)) throw new Error(`${file}: picture "${f}" must be a plain .jpg/.png/.webp file name`);
  const shape = str(meta, 'shape');
  if (shape && shape !== 'wide') throw new Error(`${file}: shape is wide or left out`);
  const price = str(meta, 'price');
  if (price && !PRICE_RE.test(price)) throw new Error(`${file}: price is a number like 2.99`);
  const buy = str(meta, 'buy');
  if (buy && !STRIPE_LINK_RE.test(buy)) throw new Error(`${file}: buy must be a Stripe Payment Link (https://buy.stripe.com/…)`);
  const colour = (key: string, fallback: string): string => {
    const v = str(meta, key);
    if (v && !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${file}: ${key} is a colour like #2a2342`);
    return v ?? fallback;
  };
  const num = (key: string): number | null => (typeof meta[key] === 'number' ? (meta[key] as number) : null);
  const blocks: ItemBlock[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    const t = para.replace(/\n/g, ' ').trim();
    if (!t) continue;
    if (t.startsWith('> ')) blocks.push({ kind: 'quote', html: inlineHtml(t.slice(2).trim()), text: inlineText(t.slice(2).trim()) });
    else blocks.push({ kind: 'p', html: inlineHtml(t), text: inlineText(t) });
  }
  if (!blocks.some((b) => b.kind === 'p')) throw new Error(`${file}: an item needs at least one paragraph`);
  return {
    slug,
    title: need(meta, 'title', file),
    kind,
    order: num('order') ?? 99,
    author: need(meta, 'author', file),
    subtitle: str(meta, 'subtitle'),
    series: str(meta, 'series'),
    volume: num('volume'),
    deck: need(meta, 'deck', file),
    image,
    wide: str(meta, 'shape') === 'wide',
    spine: colour('spine', '#22333a'),
    spineInk: colour('spineInk', '#f8f4e9'),
    gallery,
    pages: num('pages'),
    trim: str(meta, 'trim'),
    formats: list(meta, 'formats'),
    source: str(meta, 'source'),
    contents: list(meta, 'contents'),
    priceCents: price ? Math.round(Number(price) * 100) : null,
    buy,
    blocks,
    file,
  };
}

export function loadBowmarketContent(lang: (typeof BOWMARKET_LANGS)[number] = 'en'): BowmarketContent {
  const dir = bowmarketDir(lang);
  const stamp: string[] = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  const items = files.map((f) => {
    const full = path.join(dir, f);
    stamp.push(`${full}:${statSync(full).mtimeMs}`);
    return parseItem(readFileSync(full, 'utf8'), full);
  });
  /* Latest first (V, 2026-10-30): the highest order leads. A book in a set sorts
   * with its set, after it, in the set's own volume order. */
  const setOf = new Map(items.filter((i) => i.kind === 'set').flatMap((s) => s.contents.map((b, n) => [b, { s, n }] as const)));
  const key = (i: Item) => {
    const m = setOf.get(i.slug);
    return m ? { order: m.s.order, slug: m.s.slug, n: m.n + 1 } : { order: i.order, slug: i.slug, n: 0 };
  };
  items.sort((a, b) => {
    const x = key(a), y = key(b);
    return y.order - x.order || x.slug.localeCompare(y.slug) || x.n - y.n;
  });
  return { items, itemBySlug: new Map(items.map((i) => [i.slug, i])), dir, stamp: stamp.join('|') };
}

/** A set's books, in its own order; a book's sets. */
export function booksOf(c: BowmarketContent, set: Item): Item[] {
  return set.contents.map((s) => c.itemBySlug.get(s)).filter((i): i is Item => !!i);
}
export function setsOf(c: BowmarketContent, book: Item): Item[] {
  return c.items.filter((i) => i.kind === 'set' && i.contents.includes(book.slug));
}
/** A set's pages are its books' pages. */
export function pagesOf(c: BowmarketContent, item: Item): number | null {
  if (item.kind === 'book') return item.pages;
  const books = booksOf(c, item);
  return books.length && books.every((b) => b.pages) ? books.reduce((n, b) => n + (b.pages ?? 0), 0) : null;
}
export function forSale(item: Item): boolean {
  return item.priceCents !== null && item.buy !== null;
}
export function priceLabel(item: Item): string | null {
  return item.priceCents === null ? null : `$${(item.priceCents / 100).toFixed(2)}`;
}

/** Problems an edit can introduce; the tests and the Housekeeping check require none. */
export function checkBowmarketContent(c: BowmarketContent): string[] {
  const problems: string[] = [];
  for (const i of c.items) {
    for (const f of new Set([i.image, ...i.gallery])) if (!existsSync(path.join(c.dir, f))) problems.push(`${i.file}: picture ${f} is not in the folder`);
    if (i.kind === 'set') {
      if (!i.contents.length) problems.push(`${i.file}: a set names its books in contents`);
      for (const s of i.contents) {
        const b = c.itemBySlug.get(s);
        if (!b) problems.push(`${i.file}: contents names "${s}", which is not an item`);
        else if (b.kind !== 'book') problems.push(`${i.file}: contents names "${s}", which is not a book`);
      }
    } else if (i.contents.length) problems.push(`${i.file}: only a set has contents`);
    if (!i.formats.length || i.formats.some((f) => !['PDF', 'EPUB'].includes(f))) problems.push(`${i.file}: formats lists what a buyer gets, PDF and/or EPUB`);
    if ((i.priceCents === null) !== (i.buy === null)) problems.push(`${i.file}: price and buy go together; one without the other sells nothing`);
  }
  return problems;
}

let cache: { content: BowmarketContent; checkedAt: number } | null = null;

export function getBowmarketContent(): BowmarketContent {
  if (cache && (process.env.NODE_ENV === 'production' || Date.now() - cache.checkedAt < 2000)) return cache.content;
  const fresh = loadBowmarketContent();
  if (!cache || cache.content.stamp !== fresh.stamp) cache = { content: fresh, checkedAt: Date.now() };
  else cache.checkedAt = Date.now();
  return cache.content;
}
