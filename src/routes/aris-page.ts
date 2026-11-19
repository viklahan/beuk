import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { loadPersona } from '../aris/persona.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { getHelpContent } from '../help/content.js';
import { chrome } from '../help/render.js';
import { readShelfStatus } from '../help/status.js';
import { renderMarkdown } from '../warmth/markdown.js';
import { clientDir } from '../warmth/pages.js';

/**
 * /aris — the only page that explains Aris and the only place its opt-in
 * lives. Since the 2026-11-18 relaunch it reads as a product launch:
 *
 *   1. THE CALLING — a live hero (client/aris/calling.js): motes gather
 *      into a dense A; a click or scroll bursts them; they settle as the
 *      name. The writer can stir them; Aris composes itself again.
 *   2. THE JOURNEY — six cards (the landing's voyage pattern), each a
 *      station of the persona's "## Page" copy, opened on click. The
 *      markdown stays the single source: this file only slices it by its
 *      own "### " headings and fails loudly if one goes missing.
 *   3. THE ALTAR — the opt-in, voice and keys controls, filled by
 *      client/aris/aris.js from /api/aris/status.
 *
 *   GET /aris               the page
 *   GET /aris/aris.js       the controls' script
 *   GET /aris/aris.css      the styles
 *   GET /aris/calling.js    the hero engine
 *   GET /aris/cards/1..6    a card's image: the writer drops
 *                           card-<n>.webp/.jpg/.jpeg/.png into
 *                           content/aris/cards/; until then a built-in
 *                           SVG placeholder answers, never a broken image
 *
 * With ARIS_ENABLED unset none of these exist: they fall through to the
 * site's ordinary 404.
 */

/** The six stations of the journey: face title + which "### " slice of
 *  persona.md's "## Page" fills the opened card ('' = the intro). */
const CARDS: { title: string; section: string }[] = [
  { title: 'The noblest reader', section: '' },
  { title: 'The five nevers', section: 'What Aris will never do' },
  { title: 'The calling', section: 'How you call it' },
  { title: 'Your key', section: 'Your key, in plain words' },
  { title: 'What travels', section: 'What travels, and where' },
  { title: 'The ledger', section: 'The ledger' },
];
/** Rendered with the altar, not as cards: the switch, the voices, and the
 *  key walkthrough sitting directly above the form it documents. */
const ALTAR_SECTIONS = ['Turning it on', 'Two voices, later', 'Your key, step by step'];
/** The hero's flanking panels: is/is-not to the left of the stage, the
 *  call to the right. calling.js reveals them when the name settles; on
 *  narrow screens the same copy stacks below the hero instead. */
const THRESHOLD_SECTIONS = ['Is, and is not', 'When you call'];

/** Slice "## Page" by its own "### " headings; '' keys the intro. */
function pageSections(md: string): Map<string, string> {
  const parts = md.split(/^### +/m);
  const sections = new Map<string, string>([['', parts[0].trim()]]);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    sections.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }
  return sections;
}

const CARD_EXTS = ['webp', 'jpg', 'jpeg', 'png'] as const;
const CARD_TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const cardsDir = () => path.join(clientDir(), '..', 'content', 'aris', 'cards');

/** The placeholder: the laurel sprig, faint, on nothing — legible on
 *  Paper and Candlelight alike until the real art lands. */
const CARD_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
  <rect width="600" height="400" fill="#888" fill-opacity=".07"/>
  <g fill="none" stroke="#888" stroke-opacity=".55" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke" transform="translate(174,74) scale(10.5)" style="stroke-width:.5">
    <path d="M12 21C12 15 12 9 12 3"/>
    <path d="M12 17C8 17 6 14 6 11C9 11 11 13 12 17"/>
    <path d="M12 17C16 17 18 14 18 11C15 11 13 13 12 17"/>
    <path d="M12 11C8.5 10.5 7 8 7 5.5C10 6 11.5 8 12 11"/>
    <path d="M12 11C15.5 10.5 17 8 17 5.5C14 6 12.5 8 12 11"/>
  </g>
</svg>`;

export function arisPageRoutes(db: Db, config: Config): Router {
  const router = Router();

  const asset = (file: string, type: string) => async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.arisEnabled) return next();
      const body = await readFile(path.join(clientDir(), 'aris', file), 'utf8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.type(type).send(body);
    } catch (err) {
      return next(err as Error);
    }
  };
  router.get('/aris/aris.css', asset('aris.css', 'css'));
  router.get('/aris/aris.js', asset('aris.js', 'application/javascript'));
  router.get('/aris/calling.js', asset('calling.js', 'application/javascript'));
  router.get('/aris/journey.js', asset('journey.js', 'application/javascript'));

  router.get('/aris/cards/:n', async (req, res, next) => {
    try {
      if (!config.arisEnabled) return next();
      if (!/^[1-6]$/.test(req.params.n)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      for (const ext of CARD_EXTS) {
        const file = path.join(cardsDir(), `card-${req.params.n}.${ext}`);
        try {
          await stat(file);
          res.type(CARD_TYPES[ext]);
          return res.send(await readFile(file));
        } catch {
          /* this extension was not dropped; try the next */
        }
      }
      return res.type('image/svg+xml').send(CARD_PLACEHOLDER);
    } catch (err) {
      return next(err as Error);
    }
  });

  router.get(['/aris', '/aris/'], async (_req, res, next) => {
    try {
      if (!config.arisEnabled) return next();
      const sections = pageSections(loadPersona().page);
      const slice = (name: string): string => {
        const s = sections.get(name);
        if (s === undefined) throw new Error(`persona.md ## Page: missing "### ${name}" — the /aris cards slice by it`);
        return s;
      };
      // A card face opens the shared plate dialog (client/aris/journey.js):
      // the art keeps its 3:2 shape beside the copy instead of stretching
      // into a banner. The copy rides along in a <template> per card.
      const cards = CARDS.map(
        (c, i) => `<article class="aris-card">
  <button type="button" class="aris-card-face" aria-haspopup="dialog">
    <img src="/aris/cards/${i + 1}" alt="" loading="lazy" width="600" height="400" />
    <span class="aris-card-kicker">Journey with Aris · ${i + 1} of ${CARDS.length}</span>
    <span class="aris-card-title">${c.title}</span>
  </button>
  <template class="aris-card-copy">
${renderMarkdown(slice(c.section))}
  </template>
</article>`,
      ).join('\n');
      const plate = `<dialog class="aris-plate" aria-label="Journey with Aris, opened">
  <button type="button" class="aris-plate-close" aria-label="Close">✕</button>
  <img alt="" />
  <div class="aris-plate-text">
    <p class="aris-card-kicker"></p>
    <h3 class="aris-plate-title"></h3>
    <div class="aris-plate-body"></div>
  </div>
</dialog>`;
      const altar = ALTAR_SECTIONS.map((name) => `<h3>${name}</h3>\n${renderMarkdown(slice(name))}`).join('\n');
      const threshold = THRESHOLD_SECTIONS.map(
        (name, i) =>
          `<aside class="aris-threshold aris-threshold-${i === 0 ? 'left' : 'right'}" data-calling-panel>\n${renderMarkdown(slice(name))}\n</aside>`,
      ).join('\n');
      const thresholdStack = `<div class="aris-threshold-stack">\n${THRESHOLD_SECTIONS.map((name) => renderMarkdown(slice(name))).join('\n')}\n</div>`;
      // The FAQ: "### Asked and answered" holds bold question lines, each
      // followed by its answer — split into native <details> plates.
      const faqParts = slice('Asked and answered').split(/^\*\*(.+?)\*\*\s*$/m);
      const faqItems: string[] = [];
      for (let i = 1; i < faqParts.length; i += 2) {
        faqItems.push(
          `<details class="aris-faq-item"><summary>${faqParts[i].trim()}</summary>\n${renderMarkdown((faqParts[i + 1] ?? '').trim())}\n</details>`,
        );
      }
      if (!faqItems.length) throw new Error('persona.md ## Page: "### Asked and answered" holds no **question** lines');
      const faq = `<section class="aris-faq" aria-label="Asked and answered">\n<h2>Asked and answered</h2>\n${faqItems.join('\n')}\n</section>`;
      const ctx = { config, content: getHelpContent(), status: await readShelfStatus(db, config) };
      const html = chrome(ctx, {
        title: 'Aris — Beuk',
        description: 'Aris, the optional writing companion in Beuk: who it is, what it will and will not do, and how to summon it.',
        body: `<link rel="stylesheet" href="/aris/aris.css" />
<article class="aris-page">
<section class="aris-hero" aria-label="The Calling">
  <canvas id="calling"></canvas>
${threshold}
  <p class="aris-hero-line" data-calling-line>Aris waits at your threshold.</p>
  <p class="aris-hero-hint" data-calling-hint>click or scroll to call</p>
</section>
${thresholdStack}
<section class="aris-journey" aria-label="Journey with Aris">
${cards}
${plate}
</section>
${faq}
<section class="aris-altar" aria-label="Turning it on">
${altar}
<section class="aris-controls" id="summon" data-aris-controls aria-label="Summon Aris">
  <p class="aris-quiet" data-aris-signed-out>Aris is summoned from your account. <a href="/account">Sign in</a> to set it up.</p>
  <div data-aris-signed-in hidden></div>
  <p class="aris-msg" data-aris-msg role="status" hidden></p>
</section>
</section>
</article>
<script src="/aris/calling.js" defer></script>
<script src="/aris/journey.js" defer></script>
<script src="/aris/aris.js" defer></script>`,
      });
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
