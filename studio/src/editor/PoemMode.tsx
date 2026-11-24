import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { escKey } from '@book/editor/index.js';
import { useLocale } from '../i18n/LocaleProvider';
import { poemAlign, poemCan, poemOn, setPoemAlign, setPoemOn, type PoemAlign } from './poem';

/* BEUK:poemmode — Poem Mode on the writer's desk (the rules are in poem.ts):

   - PoemButton: the P in the insert toolbar. An ordinary toggle button:
     aria-pressed says whether the open chapter is a poem, the tooltip and
     the accessible name are "Poem Mode". It writes the section's `mode`
     and nothing else.
   - PoemStrip: the quiet strip under the toolbar while the chapter is a
     poem: the label and the two-way choice Centred / Left (the desk's own
     .seg control: two buttons, each with aria-pressed, as the outline's
     view switch is). It writes the section's `verseAlign`. The choices
     are named with the cover maker's own words (creator.alignCenter,
     creator.alignLeft). In a right-to-left book the lines of a "left"
     poem range at the right, where its lines begin (the book's stylesheet
     mirrors, as it does for a verse block), so there the second choice
     is named Right (creator.alignRight); what is stored is the same.

   Both show only what the section stores (usePoem re-reads it when the
   section changes, here or in another tab), so they can never disagree
   with the page beside them. */

export type Poem = { can: boolean; on: boolean; align: PoemAlign };

const KEYS = ['kind', 'type', 'mode', 'verseAlign'].map(escKey);
const readPoem = (section: Y.Map<unknown> | null): Poem => ({ can: poemCan(section), on: poemOn(section), align: poemAlign(section) });
const same = (a: Poem, b: Poem): boolean => a.can === b.can && a.on === b.on && a.align === b.align;

/** The open section's Poem Mode, as stored; re-read when its kind, type, mode or alignment changes. */
export function usePoem(section: Y.Map<unknown> | null): Poem {
  const [p, setP] = useState<Poem>(() => readPoem(section));
  useEffect(() => {
    const sync = () => setP((cur) => {
      const next = readPoem(section);
      return same(cur, next) ? cur : next;
    });
    sync();
    if (!section) return;
    const on = (e: Y.YMapEvent<unknown>) => {
      if (KEYS.some((k) => e.keysChanged.has(k))) sync();
    };
    section.observe(on);
    return () => section.unobserve(on);
  }, [section]);
  return p;
}

/** The P button. Rendered only for a chapter that can be a poem (a body chapter; never a Part, never front or back
 *  matter). */
export function PoemButton({ ydoc, section, poem }: { ydoc: Y.Doc; section: Y.Map<unknown>; poem: Poem }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="tool-btn poem-btn"
      id="btnPoemMode"
      aria-pressed={poem.on ? 'true' : 'false'}
      aria-label={t('poem.mode')}
      title={t('poem.mode')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setPoemOn(ydoc, section, !poem.on)}
    >
      <span className="poem-p" aria-hidden="true">
        P
      </span>
    </button>
  );
}

/** The strip under the toolbar, only while the chapter is a poem. */
export function PoemStrip({ ydoc, section, poem, dir = 'ltr' }: { ydoc: Y.Doc; section: Y.Map<unknown>; poem: Poem; dir?: 'ltr' | 'rtl' }) {
  const { t } = useLocale();
  if (!poem.on) return null;
  const choice = (a: PoemAlign, label: string) => (
    <button type="button" data-poem-align={a} className={poem.align === a ? 'active' : ''} aria-pressed={poem.align === a ? 'true' : 'false'} onClick={() => setPoemAlign(ydoc, section, a)}>
      {label}
    </button>
  );
  return (
    <div className="poem-strip" id="poemStrip">
      <span className="poem-strip-lab" id="poemStripLab">
        {t('poem.mode')}
      </span>
      <div className="seg" id="segPoemAlign" role="group" aria-label={t('poem.alignAria')}>
        {choice('center', t('creator.alignCenter'))}
        {choice('left', t(dir === 'rtl' ? 'creator.alignRight' : 'creator.alignLeft'))}
      </div>
    </div>
  );
}
