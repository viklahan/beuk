import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { statsOf } from '../src/book/stats';
import { importToDevice } from '../src/book/store';
import { bookState, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { castHiddenList, castSection, insightsState, writeCastHidden } from '../src/insights/insights';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { buildSample } from '../src/sample/sample';
import { fixtures } from './fixtures';

/* Wave 1c, task 2: Story Insights (C4) and Names on stage (C5).
   1.0 self-checks re-expressed: insights.frequency, insights.rhythm-cadence,
   insights.echoes-dialogue, insights.crutch.counts, insights.sentences.histogram,
   insights.readability.en-only, insights.perf, insights.glance.numbers-true,
   insights.chart.click-opens-chapter, insights.cast.detects,
   insights.cast.hide-persists, insights.cast.caseless-note.
   Review focus #1 (numbers equal 1.0): every function here IS 1.0's (the
   closure); the comparison with 1.0 running in its own page is in
   e2e/book.mjs. Here: 2.0's state for a book (exportBook → ARRIVE) gives
   the same Insights as 1.0's own normalised sections, on every fixture in
   its language and in Spanish, German, Arabic, Japanese and Hindi. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('dir');
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const open = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  return y;
};
const sec = (id: string, content: string, extra: Rec = {}) => ({ id, kind: 'body', type: 'chapter', title: '', subtitle: '', content, ...extra });

describe('1.0\'s Insights self-checks, through the closure', () => {
  // 1.0 always has a book on its desk: sectionWords reads the state's language
  beforeEach(() => {
    const f = fixtures('real').find((x) => x.name === 'real/bookbinders-letter')!;
    c.setState(bookState(c, open(f.book)).state);
  });
  it('insights.frequency: the top content word and its count are exact; stopwords never appear', () => {
    const r = c.api.insFrequency([sec('insf1', 'Harbour harbour harbour, the sea — the sea! And the wind, and the wind; harbour light over the harbour.')], 'en');
    expect(r.top[0]).toEqual({ word: 'harbour', count: 5 });
    expect(r.top.some((w) => ['the', 'and', 'over'].includes(w.word))).toBe(false);
    expect(r.total).toBe(18);
  });

  it('insights.rhythm-cadence: one column and one point per body section; every count is sectionWords; an empty chapter holds a null point', () => {
    const body = [
      sec('insr1', 'The bell rang over the water. Gulls turned above the harbour wall in the cold bright air.', { number: '1', title: 'First Light' }),
      sec('insr2', 'She counted the ropes twice. One. Two. Then the ferry shouldered away from the quay and the whole village seemed to lean with it, coffee cooling on a hundred windowsills while the channel opened grey and wide before them.', { number: '2', title: 'The Crossing' }),
      sec('insr3', '', { number: '3', title: 'Landfall' }),
    ];
    const rhy = c.api.insRhythm(body), cad = c.api.insCadence(body);
    expect(rhy.length).toBe(3);
    expect(rhy.every((r, i) => r.words === c.api.sectionWords(body[i]))).toBe(true);
    expect(cad.points.length).toBe(3);
    expect(Math.abs(cad.points[0]!.avg! - 8.5)).toBeLessThan(0.001);
    expect(cad.points[2]!.avg).toBeNull();
  });

  it('insights.echoes-dialogue: a planted phrase found ×3, never stitched across a stop, a refrain spanning "Mr." found whole; dialogue scores above narration', () => {
    const echoes = c.api.insEchoes([sec('inse1', 'The tide came in over the flats at dawn. By noon the tide came in again, higher than before. At dusk the tide came in once more and covered the causeway stones.')], 'en');
    const hit = echoes.find((e) => e.phrase.toLowerCase() === 'the tide came in');
    expect(hit?.count).toBe(3);
    expect(hit?.firstId).toBe('inse1');
    const decoy = c.api.insEchoes([sec('inse2', 'He watched the harbour light. The ferry turned. She watched the harbour light. The ferry turned. All watched the harbour light. The ferry turned.')], 'en');
    expect(decoy.some((e) => e.phrase.toLowerCase() === 'harbour light the')).toBe(false);
    const inSent = c.api.insEchoes([sec('inse3', 'Mr. Venn kept the harbour light burning all night. Mr. Venn kept the harbour light burning all winter. Mr. Venn kept the harbour light burning all year.')], 'en');
    expect(inSent.some((e) => e.count === 3 && e.phrase.toLowerCase().includes('mr venn kept the harbour light'))).toBe(true);
    const dlg = c.api.insDialogueText('“We sail at dawn,” she said. “Bring the lamp and the chart and the spare rope for the boat.”', 'en');
    const nar = c.api.insDialogueText('She walked to the harbour and watched the boats come in over the grey water at dawn, thinking of the winter ahead.', 'en');
    expect(dlg.share).toBeGreaterThan(0.8);
    expect(nar.share).toBe(0);
  });

  it('insights.crutch.counts: English and Spanish lists counted exactly, rates per 10,000 words, no list for Japanese', () => {
    const txt = 'She felt the cold. He saw the light and heard the bell. She realised, then realized, that it seemed very, very still. It was just really quite sudden; suddenly she began to run and started to laugh. He walked quickly and slowly. The family was lovely.';
    const r = c.api.insCrutch([sec('inscr1', txt)], 'en')!;
    const want: Record<string, number> = { felt: 1, saw: 1, heard: 1, 'realized / realised': 2, noticed: 0, seemed: 1, just: 1, very: 2, really: 1, quite: 1, suddenly: 1, 'began to': 1, 'started to': 1, '-ly': 2 };
    const got = Object.fromEntries(r.rows.map((x) => [x.label, x.count]));
    expect(got).toEqual(want);
    const tokens = c.api.insTokens(txt).length;
    expect(r.total).toBe(tokens);
    expect(r.rows.every((x) => Math.abs(x.rate - (x.count / tokens) * 10000) < 1e-9)).toBe(true);
    const es = c.api.insCrutch([sec('inscr2', 'De repente sintió frío. Se dio cuenta de que era muy tarde, realmente tarde, y caminó lentamente.')], 'es')!;
    const eg = Object.fromEntries(es.rows.map((x) => [x.label, x.count]));
    expect([eg['de repente / de pronto'], eg['sintió / sentía'], eg['se dio cuenta'], eg['muy'], eg['realmente'], eg['-mente']]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(c.api.insCrutch([sec('inscr3', '海は静かだった。')], 'ja')).toBeNull();
  });

  it('insights.sentences.histogram: buckets, median, nine-in-ten and mode exact; a chapter split as Cadence splits it', () => {
    const h = c.api.insHistogram([1, 5, 6, 10, 11, 40, 41, 100]);
    expect(h.buckets.map((b) => b.count).join(',')).toBe('2,2,1,0,0,0,0,1,2');
    expect([h.total, h.median, h.p90, h.mode]).toEqual([8, 10, 100, 0]);
    const text = 'One. Two words here. Three words are here now. Mr. Venn kept the light.';
    const v = c.api.insVariety([sec('insh1', text)]);
    expect(v.all.join(',')).toBe('1,3,5,5');
    expect(v.secs[0]!.lens.join(',')).toBe(c.api.insSentences(text).join(','));
  });

  it('insights.readability.en-only: Flesch exact, the syllable rule of thumb, a note instead of a score in Spanish', () => {
    const r = c.api.insReadability([sec('insrd1', 'The cat sat on the mat.')], 'en')!;
    const exact = 206.835 - 1.015 * 6 - 84.6 * 1;
    expect(Math.abs(r.points[0]!.score! - exact)).toBeLessThan(1e-9);
    expect(Math.abs(r.overall! - exact)).toBeLessThan(1e-9);
    expect(['water', 'table', 'cake', 'really', 'harbour'].map((w) => c.api.insSyllables(w)).join(',')).toBe('2,2,1,2,2');
    expect(c.api.insReadability([sec('insrd2', 'El gato se sentó en la alfombra.')], 'es')).toBeNull();
    const note = c.api.insRenderReadability({ readability: null }, { W: 720 });
    expect(note).toContain(c.api.esc(t('insights.easeOnlyEn')));
    expect(note).not.toContain('<svg');
  });

  it('insights.perf: the sample (about 26,000 words) computed and drawn from cold, and served from the per-revision cache when unchanged', () => {
    const secs = buildSample(c, null).sections.map((s) => ({ ...s, content: String(s.content || '') + (s.content ? ' ​' : '') }));
    const t0 = performance.now();
    const d = c.api.insComputeFor(secs, 'en');
    d.totalWords = secs.reduce((n, s) => n + c.api.sectionWords(s), 0);
    const html = c.api.insBuildHtml(d, { W: 720 });
    const cold = performance.now() - t0;
    const y = open(buildSample(c, null));
    insightsState(c, y);
    c.api.computeInsights();
    const t1 = performance.now();
    c.api.computeInsights();
    const warm = performance.now() - t1;
    expect(html.length).toBeGreaterThan(1000);
    expect(c.vars.insCache.hit).toBe(true);
    expect(warm).toBeLessThan(50);
    // 1.0's budget is 600 ms in a browser; Node under the test runner is reported, not gated at it
    console.log(`insights.perf: sample from cold ${Math.round(cold)} ms, unchanged ${warm.toFixed(1)} ms`);
  });
});

describe('Names on stage, 1.0\'s self-checks', () => {
  it('insights.cast.detects: a title pair as one name, a possessive merged, a sentence-opening word not taken; legend rates', () => {
    const secs = [
      sec('insc1', 'Slowly the fog held. At dawn Mara walked to the quay where Captain Hale was waiting. The ferry from Gullwick was late again. Slowly nobody spoke. Mara\'s lantern hissed in the damp, and the dog barked at Captain Hale.', { number: '1', title: 'The Quay' }),
      sec('insc2', 'Slowly the sea turned grey. They left Gullwick behind, and Mara watched the gulls. Later Captain Hale said nothing at all. Slowly, the wind rose. By noon Mara was asleep and Gullwick was only a smudge on the line of the sea.', { number: '2', title: 'Crossing' }),
    ];
    const r = c.api.castCompute(secs, 'en', 'A Test of Tides');
    const by = (k: string) => r.names.find((x) => x.key === k);
    expect(by('mara')?.total).toBe(4);
    expect(by('mara')?.per).toEqual([2, 2]);
    expect(by('captain hale')?.name).toBe('Captain Hale');
    expect(by('captain hale')?.total).toBe(3);
    expect(by('gullwick')?.total).toBe(3);
    expect(r.names.some((x) => x.key.split(' ').includes('slowly'))).toBe(false);
    expect(!!by('hale') || !!by('captain')).toBe(false);
    expect(r.names.length).toBe(3);
    expect(r.caseless).toBe(false);
    expect([0.37, 1.107, 8.28, 12.6, 0.03].map((v) => c.api.castRateStr(v, 'en')).join('|')).toBe('0.4|1.1|8.3|13|<0.1');
  });

  it('insights.cast.hide-persists: kept with the book (meta.castHidden), normalised, an emptied list removes the key, exported and read back; a book without it has none', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const y = open(f.book);
    writeCastHidden(c, y, ['Gullwick', 'gullwick', '  Mara  ']);
    const doc = exportBook(y);
    expect((doc.meta as Rec).castHidden).toEqual(['Gullwick', 'Mara']);
    const back = open(doc);
    expect(castHiddenList(c, insightsState(c, back))).toEqual(['Gullwick', 'Mara']);
    writeCastHidden(c, back, []);
    expect('castHidden' in (exportBook(back).meta as Rec)).toBe(false);
    // the meta's other keys keep their order; the key goes last, as 1.0's assignment puts it
    expect(Object.keys(doc.meta as Rec)).toEqual([...Object.keys(f.book.meta as Rec), 'castHidden']);
    const other = open(fixtures('real').find((x) => x.name === 'real/bookbinders-letter')!.book);
    expect(castHiddenList(c, insightsState(c, other))).toEqual([]);
    const fx = c.api.castCompute([
      sec('insch1', 'At dawn Mara walked to Gullwick. The bell rang and Mara listened. Gullwick slept.', { number: '1' }),
      sec('insch2', 'By noon Mara had left Gullwick behind, and the gulls followed.', { number: '2' }),
    ], 'en', '');
    expect(c.api.castVisible(fx, ['mara']).map((x) => x.name)).toEqual(['Gullwick']);
  });

  it('insights.cast.caseless-note: Japanese and Arabic get the note, Russian is read', () => {
    const ja = c.api.castCompute([sec('inscj', 'マラは港へ歩いた。ヘイル船長が待っていた。マラは灯りを掲げた。', { number: '1' })], 'ja', '');
    const ar = c.api.castCompute([sec('insca', 'مشت مارا إلى الميناء حيث كان القبطان هيل ينتظر. رفعت مارا الفانوس.', { number: '1' })], 'ar', '');
    const ru = c.api.castCompute([
      sec('inscr1', 'Утром Мара пошла к причалу. Там её ждал старый Ольгин. Мара подняла фонарь, и Ольгин кивнул.', { number: '1' }),
      sec('inscr2', 'Вечером Мара вернулась домой, а Ольгин остался у воды.', { number: '2' }),
    ], 'ru', '');
    expect(ja.caseless && ar.caseless && !ja.names.length && !ar.names.length).toBe(true);
    expect(ru.caseless).toBe(false);
    expect(ru.names.find((x) => x.key === 'мара')?.total).toBe(3);
    // and the section says so with 1.0's note
    const y = open({ ...fixtures('real')[0]!.book, meta: { ...(fixtures('real')[0]!.book.meta as Rec), language: 'ja' }, sections: [sec('j1', 'マラは港へ歩いた。ヘイル船長が待っていた。マラは灯りを掲げた。', { number: '1' })] });
    expect(castSection(c, insightsState(c, y), t, 'en', false).html).toContain(c.api.esc(t('insights.castCaseless')));
  });
});

describe('review focus #1: 2.0\'s state gives 1.0\'s numbers, on every fixture and in each language', { timeout: 120_000 }, () => {
  const LANGS = [null, 'es', 'de', 'ar', 'ja', 'hi'];
  it.each(fixtures('real').map((f) => [f.name, f] as const))('%s', (_n, f) => {
    for (const L of LANGS) {
      const book = L ? { ...f.book, meta: { ...(f.book.meta as Rec), language: L } } : f.book;
      const y = open(book);
      const { state } = bookState(c, y);
      c.setState(state);
      const lang = c.api.bookLang();
      const mine = c.api.insComputeFor(state.sections, lang);
      // 1.0's own normalised sections of the same book (applyBookDoc's normalizeSection), no 2.0 in between
      const raw = (book.sections as Rec[]).map((s) => c.api.normalizeSection(structuredClone(s)));
      const ref = c.api.insComputeFor(raw, lang);
      expect(JSON.stringify(mine), `${f.name} in ${L ?? 'its own language'}`).toBe(JSON.stringify(ref));
      const cd = c.api.castCompute(state.sections, lang, state.meta.title);
      expect(JSON.stringify(cd)).toBe(JSON.stringify(c.api.castCompute(raw, lang, (book.meta as Rec).title)));
    }
  });
});

/* ---- the room, in the studio ---- */

async function studioWith(book: Rec, lang = 'en') {
  if (lang !== 'en') await loadPack(lang);
  await importToDevice(book);
  const r = render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
  await waitFor(() => expect(document.getElementById('btnInsights')!.getAttribute('aria-disabled')).toBeNull());
  return r;
}
async function openInsights() {
  fireEvent.click(document.getElementById('btnInsights')!);
  await waitFor(() => expect(document.querySelector('#insBody .ins-sec, #insBody .ins-empty')).not.toBeNull(), { timeout: 20_000 });
  return document.getElementById('insBody')!;
}
const activeSection = () => document.getElementById('manuscript')?.getAttribute('data-section');

describe('Story Insights in the studio', () => {
  it('insights.glance.numbers-true: words, reading time, chapters, sentence and dialogue equal the studio\'s counts; no page number while no desk has measured', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await studioWith(f.book);
    const body = await openInsights();
    const val = (id: string) => body.querySelector('#' + id + ' .ins-g-val')?.textContent;
    const y = open(f.book);
    const s = statsOf(c, y);
    const { state } = bookState(c, y);
    c.setState(state);
    const cad = c.api.insCadence(state.sections), dl = c.api.insDialogue(state.sections, c.api.bookLang());
    expect(val('insGWords')).toBe(c.api.fmtNum(s.words));
    const mins = s.minutes;
    expect(val('insGTime')).toBe(mins >= 60 ? t('stats.readingH', { h: Math.floor(mins / 60), m: mins % 60 }) : t('stats.readingM', { m: mins }));
    expect(val('insGChapters')).toBe(c.api.fmtNum(c.api.insBodySections(state.sections).filter((x) => x.type === 'chapter').length));
    expect(val('insGDialogue')).toBe(dl.total ? c.api.fmtNum(dl.share * 100) + '%' : '—');
    expect(val('insGSentence')).toBeTruthy();
    expect(cad.overall).toBeGreaterThan(0);
    expect(/\d/.test(val('insGPages') ?? '0')).toBe(false);
    expect(document.getElementById('statWords')?.textContent ?? val('insGWords')).toBe(val('insGWords'));
  });

  it('insights.chart.click-opens-chapter: a rhythm column click, Enter on a cadence point, a dialogue row click each close the room and open that chapter; the mark carries the chapter\'s facts', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await studioWith(f.book);
    const ids = (f.book.sections as Rec[]).map((s) => s.id as string);
    const body1 = await openInsights();
    const bars = body1.querySelectorAll('[data-lead="words"]');
    const bar = bars[bars.length - 1]!;
    const id = bar.getAttribute('data-sec')!;
    const sw = (f.book.sections as Rec[]).find((s) => s.id === id)!;
    expect(bar.getAttribute('aria-label')).toContain(c.api.fmtNum(c.api.sectionWords(c.api.normalizeSection(structuredClone(sw)))));
    act(() => void bar.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.getElementById('modalInsights')).toBeNull();
    await waitFor(() => expect(activeSection()).toBe(String(ids.indexOf(id))));
    const body2 = await openInsights();
    const dot = body2.querySelector<SVGElement>('[data-lead="avg"]')!;
    const id2 = dot.getAttribute('data-sec')!;
    act(() => {
      dot.focus();
      dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(document.getElementById('modalInsights')).toBeNull();
    await waitFor(() => expect(activeSection()).toBe(String(ids.indexOf(id2))));
    const body3 = await openInsights();
    const row = body3.querySelector<HTMLButtonElement>('button.ins-dlg-row')!;
    const id3 = row.getAttribute('data-sec')!;
    act(() => row.click());
    expect(document.getElementById('modalInsights')).toBeNull();
    await waitFor(() => expect(activeSection()).toBe(String(ids.indexOf(id3))));
  });

  it('charts are keyboard-usable: roving focus through the points, the tooltip reads 1.0\'s values; Escape first closes the tooltip, then the room; the room leaves nothing behind', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await studioWith(f.book);
    const added: string[] = [], removed: string[] = [];
    const add = window.addEventListener.bind(window), rem = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => (added.push(type), add(type, fn, o)));
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => (removed.push(type), rem(type, fn, o)));
    const body = await openInsights();
    const svg = body.querySelector('svg.ins-plot')!;
    const marks = [...svg.querySelectorAll<SVGElement>('.ins-mark')];
    expect(marks[0]!.getAttribute('tabindex')).toBe('0');
    expect(marks.slice(1).every((m) => m.getAttribute('tabindex') === '-1')).toBe(true);
    act(() => marks[0]!.focus());
    const tip = document.getElementById('insTip')!;
    expect(tip.hidden).toBe(false);
    // the tooltip: 1.0's insFactValues for that chapter, led by the chart's measure
    const f0 = c.vars.insFacts[marks[0]!.getAttribute('data-sec')!]!;
    const v = c.api.insFactValues(f0);
    expect(tip.querySelector('.ins-tip-v')!.textContent).toBe(v.words);
    expect(tip.querySelector('.ins-tip-n')!.textContent).toBe(f0.name);
    act(() => void marks[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(marks[1]);
    expect(marks[1]!.getAttribute('tabindex')).toBe('0');
    act(() => void marks[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(marks[marks.length - 1]);
    // Escape: the tooltip first
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.getElementById('insTip')!.hidden).toBe(true);
    expect(document.getElementById('modalInsights')).not.toBeNull();
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.getElementById('modalInsights')).toBeNull();
    expect(document.getElementById('insTip')).toBeNull();
    const net = (type: string) => added.filter((x) => x === type).length - removed.filter((x) => x === type).length;
    expect(net('resize')).toBe(0);
  });

  it('in Arabic chrome the chapter charts mirror (chapter one on the right) and the horizontal arrows follow the reading direction; the heatmap mirrors its columns', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await studioWith(f.book, 'ar');
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('rtl'));
    const body = await openInsights();
    const marks = [...body.querySelector('svg.ins-plot')!.querySelectorAll<SVGElement>('.ins-mark')];
    const x = (m: Element) => Number(m.querySelector('.ins-hit')!.getAttribute('x'));
    expect(x(marks[0]!)).toBeGreaterThan(x(marks[marks.length - 1]!));
    act(() => marks[1]!.focus());
    act(() => void marks[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(marks[0]);
    act(() => void marks[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(document.activeElement).toBe(marks[1]);
    const cells = body.querySelectorAll('.cast-cell[data-cast-r="0"]');
    if (cells.length > 1) {
      const c0 = body.querySelector('.cast-cell[data-cast-r="0"][data-cast-c="0"]')!;
      expect(Number(c0.getAttribute('x'))).toBe(cells.length - 1);
    }
  });

  it('Names on stage: hide a name (kept in meta.castHidden, focus on the next hide button), show it again from the hidden list', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/dartagnan-01-three-musketeers')!;
    await studioWith(f.book);
    const body = await openInsights();
    const hideBtn = body.querySelector<HTMLButtonElement>('.cast-hide');
    expect(hideBtn).not.toBeNull();
    const name = hideBtn!.getAttribute('data-cast-hide')!;
    expect(hideBtn!.querySelector('svg.lucide-eye-off')).not.toBeNull();
    act(() => hideBtn!.click());
    expect(body.querySelector('.cast-hidden summary')!.textContent).toBe(t('insights.castHidden', { n: '1' }));
    expect([...body.querySelectorAll('.cast-name')].map((n) => n.textContent)).not.toContain(name);
    expect(document.activeElement?.classList.contains('cast-hide')).toBe(true);
    const show = body.querySelector<HTMLButtonElement>('[data-cast-show]')!;
    expect(show.getAttribute('data-cast-show')).toBe(name);
    act(() => show.click());
    expect(body.querySelector('.cast-hidden')).toBeNull();
    expect([...body.querySelectorAll('.cast-name')].map((n) => n.textContent)).toContain(name);
  });

  it('opening, browsing and closing the room writes nothing: the export is unchanged', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/oz-14-glinda')!;
    const id = await importToDevice(f.book);
    const before = JSON.stringify(id.export());
    await id.close();
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnInsights')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    const body = await openInsights();
    const sel = body.querySelector<HTMLSelectElement>('#insVarSel');
    if (sel && sel.options.length > 1) {
      sel.value = sel.options[1]!.value;
      act(() => void sel.dispatchEvent(new Event('change', { bubbles: true })));
    }
    fireEvent.click(document.getElementById('btnInsRefresh')!);
    fireEvent.click(document.getElementById('btnCloseInsights')!);
    let blob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(document.getElementById('btnExport')!);
    const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
    expect(JSON.stringify(out.book)).toBe(before);
  });

  it('book text in names and chapters is escaped by 1.0\'s builders: nothing in the book becomes markup', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const evil = '<img src=x onerror="window.__ins=1">';
    const book = structuredClone(f.book);
    const secs = book.sections as Rec[];
    const body = secs.filter((s) => s.kind === 'body');
    body.forEach((s, i) => {
      s.title = evil + ' ' + i;
      s.content = `Zorblax met Quentarr at the quay. ${evil} Zorblax waved. Quentarr nodded. ` + String(s.content);
    });
    await studioWith(book);
    const room = await openInsights();
    expect(room.querySelector('img')).toBeNull();
    expect(room.querySelector('[onerror]')).toBeNull();
    expect((window as unknown as { __ins?: number }).__ins).toBeUndefined();
  });
});
