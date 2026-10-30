import type { Config } from '../config.js';
import { schoolPage } from '../school/render.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import { booksOf, forSale, pagesOf, priceLabel, setsOf, type BowmarketContent, type Item } from './content.js';

/**
 * Bowmarket pages, in the School's shell (the Bowmarket tab current), on
 * the site's own paper and ink (client/site/bowmarket.css). Every picture
 * is an illustration from inside a book and is captioned so; the buy
 * button is a plain link to the item's Stripe Payment Link, shown only
 * when the item has both a price and a link (forSale).
 */

const CSS = ['/site/bowmarket.css'];
const JS = ['/site/bowmarket.js'];
const img = (file: string) => `/school/bowmarket/img/${encodeURIComponent(file)}`;

function byline(item: Item): string {
  const vol = item.series && item.volume ? `${item.series}, Volume ${item.volume}` : item.series && item.kind === 'set' ? `${item.series} box set` : '';
  return [vol, `by ${item.author}`].filter(Boolean).join(' · ');
}

function facts(c: BowmarketContent, item: Item): string {
  const pages = pagesOf(c, item);
  const books = item.kind === 'set' ? booksOf(c, item).length : 0;
  return [
    item.kind === 'set' ? `${books} ${books === 1 ? 'book' : 'books'}` : '',
    pages ? `${pages} pages` : '',
    item.formats.join(' + '),
  ]
    .filter(Boolean)
    .join(' · ');
}

function buyButton(item: Item, big = false): string {
  const price = priceLabel(item);
  if (forSale(item)) return `<a class="bm-buy${big ? ' big' : ''}" href="${esc(item.buy!)}" rel="noopener">Buy · ${esc(price!)}</a>`;
  return `<span class="bm-buy soon${big ? ' big' : ''}" aria-disabled="true">Coming soon</span>`;
}

/** One book as a 3D object (client/site/bowmarket.css): front, back, spine, page
 *  edge, head and foot. Its shape is the book's own (a 6 × 9 in novel stands
 *  tall, a landscape book lies wide) and its thickness follows its page count.
 *  The front is an illustration from inside the book with the title set over
 *  it: the books have no cover art, and the pages say so. */
function book3d(item: Item): string {
  const widthIn = item.wide ? 11.69 : 6;
  const aspect = item.wide ? 595 / 842 : 1.5;
  const thick = Math.max(((item.pages ?? 100) * 0.0023) / widthIn, item.wide ? 0.03 : 0.06);
  const style = `--a:${aspect.toFixed(4)};--t:${thick.toFixed(4)};--sp:${esc(item.spine)};--si:${esc(item.spineInk)}`;
  const band = item.wide
    ? ''
    : `<span class="bk-band">${item.series ? `<small>${esc(item.series)}${item.volume ? ` · ${item.volume}` : ''}</small>` : ''}<b>${esc(item.title)}</b><i>${esc(item.author)}</i></span>`;
  return `<span class="bk" style="${style}"><span class="bk-in">
            <span class="bk-f bk-front"><img src="${esc(img(item.image))}" alt="" loading="lazy" draggable="false" />${band}</span>
            <span class="bk-f bk-back"><span>${esc(item.deck)}</span></span>
            <span class="bk-f bk-spine"><span>${esc(item.title)}<em>${esc(item.author)}</em></span></span>
            <span class="bk-f bk-edge"></span><span class="bk-f bk-head"></span><span class="bk-f bk-foot"></span>
          </span></span>`;
}

/** The books an item shows: a set's books side by side, or the book itself. */
function shelfOf(c: BowmarketContent, item: Item): string {
  const books = item.kind === 'set' ? booksOf(c, item) : [item];
  return `<span class="bk-row${item.wide ? ' is-wide' : ''}">${books.map(book3d).join('')}</span>`;
}

function card(c: BowmarketContent, item: Item): string {
  return `<article class="bm-card${item.kind === 'set' ? ' is-set' : ''}">
          <a class="bm-pic${item.wide ? ' is-wide' : ''}" href="/school/bowmarket/${esc(item.slug)}" aria-hidden="true" tabindex="-1">${shelfOf(c, item)}</a>
          <p class="bm-kind">${item.kind === 'set' ? 'Box set' : 'Book'} · ${esc(facts(c, item))}</p>
          <h3><a href="/school/bowmarket/${esc(item.slug)}">${esc(item.title)}</a></h3>
          <p class="bm-by">${esc(byline(item))}</p>
          <p class="bm-deck">${esc(item.deck)}</p>
          <p class="bm-row">${buyButton(item)}<a class="bm-more" href="/school/bowmarket/${esc(item.slug)}">See inside</a></p>
        </article>`;
}

export function renderBowmarket(config: Config, c: BowmarketContent): string {
  const sets = c.items.filter((i) => i.kind === 'set');
  const books = c.items.filter((i) => i.kind === 'book');
  const anyForSale = c.items.some(forSale);
  /* Latest first: the items come newest first, and so does the shelf holding the newest one. */
  const setShelf = sets.length ? `<section class="bm-shelf" aria-labelledby="bm-sets"><h2 id="bm-sets">Box sets</h2><div class="bm-grid">${sets.map((s) => card(c, s)).join('')}</div></section>` : '';
  const bookShelf = books.length ? `<section class="bm-shelf" aria-labelledby="bm-books"><h2 id="bm-books">Books</h2><div class="bm-grid">${books.map((b) => card(c, b)).join('')}</div></section>` : '';
  const shelves = c.items[0]?.kind === 'book' ? `${bookShelf}
        ${setShelf}` : `${setShelf}
        ${bookShelf}`;
  const body = `        <section class="s-hero">
          <p class="kicker">Bowmarket</p>
          <h1>Box sets and books</h1>
          <p class="lede">Stories and puzzle books, sold as files you keep. Buy a whole box set, or one book at a time.</p>
          ${anyForSale ? '' : '<p class="bm-note">The shelves are stocked; the till opens soon. Nothing can be bought yet.</p>'}
        </section>
        ${shelves}
        <p class="bm-small">The books have no cover art yet: each one shows a page from inside it, the illustrated ones with their title set over it. Payment is taken by Stripe on its own page.</p>`;
  return schoolPage(config, {
    title: 'Bowmarket — box sets and books',
    description: `Box sets and books on Bowmarket: ${c.items.map((i) => i.title).join(', ')}.`,
    path: '/school/bowmarket',
    tab: 'bowmarket',
    css: CSS,
    scripts: JS,
    body,
  });
}

export function renderItem(config: Config, c: BowmarketContent, item: Item): string {
  const books = item.kind === 'set' ? booksOf(c, item) : [];
  const sets = item.kind === 'book' ? setsOf(c, item) : [];
  const pages = pagesOf(c, item);
  const details = [
    ['Format', item.formats.join(' and ')],
    item.kind === 'set' ? ['Books', String(books.length)] : null,
    pages ? ['Pages', item.kind === 'set' ? `${pages} in all` : String(pages)] : null,
    item.trim ? ['Page size', item.trim] : null,
    ['Price', priceLabel(item) ?? 'Not set yet'],
  ].filter((d): d is string[] => !!d);
  const gallery = item.gallery.length
    ? `<section class="bm-gallery" aria-labelledby="bm-g"><h2 id="bm-g">From inside the book</h2><div class="bm-strip">${item.gallery
        .map((f) => `<figure><img src="${esc(img(f))}" alt="A page from ${esc(item.title)}" loading="lazy" /></figure>`)
        .join('')}</div></section>`
    : '';
  const inSet = books.length
    ? `<section class="bm-shelf" aria-labelledby="bm-in"><h2 id="bm-in">In this set</h2><div class="bm-grid">${books.map((b) => card(c, b)).join('')}</div></section>`
    : '';
  const alsoIn = sets.length
    ? `<p class="bm-also">Also in ${sets.map((s) => `<a href="/school/bowmarket/${esc(s.slug)}">${esc(s.title)}</a>`).join(', ')}.</p>`
    : '';
  const body = `        <p class="crumbs"><a href="/school/bowmarket">Bowmarket</a> › ${esc(item.title)}</p>
        <article class="bm-item">
          <figure class="bm-hero${item.wide ? ' is-wide' : ''}">
            <div class="bm-stage" data-turn tabindex="0" role="img" aria-label="${esc(item.kind === 'set' ? `The ${books.length} books of ${item.title}` : item.title)}, in 3D. Drag, or use the arrow keys, to turn ${item.kind === 'set' ? 'them' : 'it'} all the way round.">${shelfOf(c, item)}</div>
            <figcaption><span class="bm-turn-hint" hidden>Drag to turn it all the way round. </span> ${item.wide ? 'The front is the book’s own first page' : 'The front shows an illustration from inside the book'}; there is no cover art yet.</figcaption>
          </figure>
          <div class="bm-info">
            <p class="kicker">${item.kind === 'set' ? 'Box set' : 'Book'}</p>
            <h1>${esc(item.title)}</h1>
            ${item.subtitle ? `<p class="bm-sub">${esc(item.subtitle)}</p>` : ''}
            <p class="bm-by">${esc(byline(item))}</p>
            <p class="bm-deck">${esc(item.deck)}</p>
            <dl class="bm-facts">${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
            <p class="bm-row">${buyButton(item, true)}</p>
            ${forSale(item) ? '<p class="bm-small">You pay on Stripe’s own page.</p>' : '<p class="bm-small">Not on sale yet.</p>'}
            ${alsoIn}
            <div class="bm-blurb">${item.blocks.map((b) => (b.kind === 'quote' ? `<blockquote>${b.html}</blockquote>` : `<p>${b.html}</p>`)).join('')}</div>
          </div>
        </article>
        ${inSet}
        ${gallery}`;
  return schoolPage(config, {
    title: `${item.title} — Bowmarket`,
    description: `${item.title}${item.subtitle ? `: ${item.subtitle}` : ''}. ${item.deck}`,
    path: `/school/bowmarket/${item.slug}`,
    tab: 'bowmarket',
    css: CSS,
    scripts: JS,
    body,
  });
}
