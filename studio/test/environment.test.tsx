import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { activeEditor } from '../src/editor/active';
import { editorText } from '../src/editor/insert';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { ZEN_MEDIA } from '../vite.config';
import { envRun } from '../src/environment/page';

/* Wave 3a, tasks 2 and 3: Zen (A11), Read Aloud (A10) and dictation with the language bar (A9), run as 1.0's own code
   in the studio (jsdom), the speech APIs stubbed (1.0's own seams: window.speechSynthesis / SpeechSynthesisUtterance,
   window.SpeechRecognition, and 1.0's dictCtorOverride). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeAll(async () => {
  // jsdom has no layout: the editor's scroll-into-view after a caret move asks for rects (as the other editor tests)
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  c.vars.zenReducedOverride = true; // the reduced-motion path: no transforms to wait for
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  c.vars.dictCtorOverride = undefined;
  c.vars.zenReducedOverride = null;
  c.api.dict.want = false;
  c.api.dict.seen = false;
  localStorage.clear();
  document.body.className = '';
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const words = (n: number, w = 'word') => Array(n).fill(w).join(' ');
const bookOf = (texts: string[], language = 'en') => {
  const b = c.api.buildEmptyBook();
  (b.meta as Rec).language = language;
  b.sections = texts.map((x, i) => c.api.mkSection('body', 'chapter', 'Chapter ' + (i + 1), { number: String(i + 1), content: x }));
  return { format: 'beuk-backup', version: 1, book: b };
};
async function studioWith(book: Rec) {
  await importToDevice(book);
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnGoals').getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  // the first body chapter on the desk
  // (the row itself: its buttons are the row's tools — move, the eye, the menu)
  const row = Array.from(document.querySelectorAll<HTMLElement>('#structureScroll .sec-item')).find((r) => (r.querySelector('.sec-name')?.textContent ?? '').endsWith(' — Chapter 1'));
  if (row) fireEvent.click(row);
  await waitFor(() => expect(activeEditor()).not.toBeNull(), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
  ];
  fireEvent.click($('btnLocalBackup'));
  await waitFor(() => expect(blob).not.toBeNull());
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await blob!.text()) as Rec).book as Rec;
}

describe('Zen (A11)', () => {
  it('ui.tooltips: outside Zen the hidden details fold (an icon, so the tip scan counts it) is already named', async () => {
    await studioWith(bookOf([words(20)]));
    expect(document.body.classList.contains('zen')).toBe(false);
    expect($('zenDetailsSum').textContent).toBe(t('zen.details'));
  }, 60_000);

  it('zen.transition / no-edit: enter builds 1.0\'s layers, opens no audio; Escape leaves; the export is unchanged', async () => {
    const AC = vi.fn();
    vi.stubGlobal('AudioContext', AC);
    await studioWith(bookOf([words(50), words(30)]));
    const before = JSON.stringify(await exported());
    act(() => $('btnZen').click());
    expect(document.body.classList.contains('zen')).toBe(true);
    for (const id of ['zenArt', 'zenCluster', 'zenScenePop', 'zenStage', 'zenDock', 'zenNav', 'zenFlash']) expect($(id), id).not.toBeNull();
    expect($('zenPill').parentElement!.id).toBe('zenDock');
    expect(AC).not.toHaveBeenCalled(); // zen.sound.opt-in: entering starts no audio
    expect($('btnZenSound').getAttribute('aria-pressed')).toBe('false');
    // the painting is 1.0's chosen one
    expect(($('zenPaint').style.backgroundImage)).toContain('assets/zen/bliss.webp');
    act(() => c.api.zenSettle());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.classList.contains('zen')).toBe(false);
    act(() => c.api.zenSettle());
    expect($('zenArt')).toBeNull();
    expect($('zenPill').parentElement).toBe(document.body);
    expect(JSON.stringify(await exported())).toBe(before);
  }, 60_000);

  it('the scene and painting choices are 1.0\'s per-device keys, in 1.0\'s shapes', async () => {
    localStorage.setItem('beuk.zenScene.v1', 'rain-drum'); // an old 1.0 value migrates to rain
    localStorage.setItem('beuk.zen.painting.v1', 'sakura');
    await studioWith(bookOf([words(20)]));
    act(() => $('btnZen').click());
    expect(c.api.zenScenePref()).toBe('rain');
    expect(localStorage.getItem('beuk.zenScene.v1')).toBe('rain');
    expect($('zenPaint').style.backgroundImage).toContain('sakura.webp');
    act(() => ($('zenScenePop').querySelector('[data-scene="waves"]') as HTMLElement).click());
    expect(localStorage.getItem('beuk.zenScene.v1')).toBe('waves');
    act(() => ($('zenScenePop').querySelector('[data-paint="calm"]') as HTMLElement).click());
    expect(localStorage.getItem('beuk.zen.painting.v1')).toBe('calm');
    act(() => c.api.setZenMode(false));
    act(() => c.api.zenSettle());
  }, 60_000);

  it('zen.sound.buffer-loop: the writer\'s click plays the scene\'s FILE (same origin, assets/sound) through one looping buffer source — no oscillator', async () => {
    const made: string[] = [];
    const fetched: string[] = [];
    class FakeCtx {
      state = 'running';
      currentTime = 0;
      sampleRate = 48000;
      destination = {};
      onstatechange: unknown = null;
      createGain() {
        made.push('gain');
        return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} };
      }
      createBufferSource() {
        made.push('buffer');
        return { buffer: null, loop: false, loopStart: 0, loopEnd: 0, connect() {}, start() {}, stop() {} };
      }
      createOscillator() {
        made.push('oscillator');
        return {};
      }
      decodeAudioData(_b: unknown, ok: (b: unknown) => void) {
        const buf = { duration: 61, sampleRate: 48000, numberOfChannels: 2 };
        ok(buf);
        return Promise.resolve(buf);
      }
      resume() {
        return Promise.resolve();
      }
      close() {}
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (u: string) => {
      fetched.push(String(u));
      if (String(u).endsWith('.mp3')) return new Response(new ArrayBuffer(8), { status: 200 });
      return realFetch(u);
    }) as typeof fetch);
    await studioWith(bookOf([words(20)]));
    act(() => $('btnZen').click());
    await act(async () => {
      $('btnZenSound').click();
      await c.api.zenSound.settle;
    });
    expect(c.api.zenSound.status).toBe('on');
    expect($('btnZenSound').getAttribute('aria-pressed')).toBe('true');
    expect(fetched.some((u) => /assets\/sound\/rain\.mp3$/.test(u))).toBe(true);
    expect(made).not.toContain('oscillator');
    expect(made.filter((m) => m === 'buffer')).toHaveLength(1);
    expect(localStorage.getItem('beuk.zenSound.v1')).toBe('on');
    act(() => c.api.setZenMode(false)); // leaving silences it, the remembered choice stays
    expect(c.api.zenSound.status).toBe('off');
    expect(localStorage.getItem('beuk.zenSound.v1')).toBe('on');
    act(() => c.api.zenSettle());
  }, 60_000);

  it('zen.day.advances: the phase moves only with time in Zen, and holds at 1', async () => {
    await studioWith(bookOf([words(20)]));
    let now = 1000;
    c.api.zdSetClock(() => now);
    act(() => $('btnZen').click());
    const p0 = c.api.zdPhase();
    now += 2700; // half the 5400 s span
    expect(c.api.zdPhase() - p0).toBeCloseTo(0.5, 5);
    act(() => c.api.setZenMode(false));
    const held = c.api.zdPhase();
    now += 5000;
    expect(c.api.zdPhase()).toBe(held); // closed: no time passes
    c.api.zdSetPhase(1);
    expect(c.api.zdPhase()).toBe(1);
    c.api.zdSetClock(null);
    act(() => c.api.zenSettle());
  }, 60_000);

  it('zen.nav.switch: Alt+ArrowRight opens the next section without leaving Zen', async () => {
    await studioWith(bookOf([words(20, 'alpha'), words(20, 'beta')]));
    act(() => $('btnZen').click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    });
    await waitFor(() => expect(editorText(activeEditor()!.editor).text).toContain('beta'), { timeout: 10_000 });
    expect(document.body.classList.contains('zen')).toBe(true);
    act(() => c.api.setZenMode(false));
    act(() => c.api.zenSettle());
  }, 60_000);

  it('the build copies 1.0\'s own paintings and sounds (the list names files 1.0 has)', () => {
    for (const f of ZEN_MEDIA) expect(readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'assets', f)).length).toBeGreaterThan(1000);
    expect(ZEN_MEDIA.filter((f) => f.startsWith('sound/')).map((f) => f.slice(6, -4)).sort()).toEqual([...c.api.ZEN_SCENES].sort());
    expect(ZEN_MEDIA.filter((f) => f.startsWith('zen/')).map((f) => f.slice(4, -5)).sort()).toEqual(c.api.ZEN_PAINTINGS.map((p) => p.id).sort());
  });
});

/* ---- speech ---- */

type Voice = { name: string; lang: string; voiceURI: string; default?: boolean };
function stubSpeech(voices: Voice[]) {
  const spoken: { text: string; lang: string; voice: Voice | null }[] = [];
  class Utterance {
    text: string;
    lang = '';
    voice: Voice | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    getVoices: () => voices,
    speak: (u: Utterance) => spoken.push({ text: u.text, lang: u.lang, voice: u.voice }),
    cancel: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return spoken;
}

describe('Read Aloud (A10)', () => {
  it('readaloud.controls / readaloud.voices: the popover offers the book language\'s voices; Play speaks the open section in that language', async () => {
    const spoken = stubSpeech([
      { name: 'Samantha', lang: 'en-US', voiceURI: 'sam' },
      { name: 'Daniel', lang: 'en-GB', voiceURI: 'dan' },
      { name: 'Anna', lang: 'de-DE', voiceURI: 'anna' },
    ]);
    await studioWith(bookOf(['The first sentence is here. And the second one follows it.']));
    const before = JSON.stringify(await exported());
    act(() => $('btnReadAloud').click());
    expect($('raPop').hidden).toBe(false);
    const opts = Array.from(($('raVoice') as HTMLSelectElement).options).map((o) => o.value);
    expect(opts).toEqual(['gender:female', 'gender:male', 'voice:sam', 'voice:dan']); // English voices only
    act(() => $('raPlay').click());
    expect(c.api.ra.status).toBe('playing');
    expect(spoken[0]).toMatchObject({ text: 'The first sentence is here.', lang: 'en' });
    expect(spoken[0]!.voice!.name).toBe('Samantha'); // 1.0's suggestion: female first
    act(() => $('raStop').click());
    expect(c.api.ra.status).toBe('idle');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect($('raPop').hidden).toBe(true);
    expect(JSON.stringify(await exported())).toBe(before);
  }, 60_000);

  it('a German book is read with a German voice; with no speech at all the popover says so', async () => {
    const spoken = stubSpeech([
      { name: 'Samantha', lang: 'en-US', voiceURI: 'sam' },
      { name: 'Anna', lang: 'de-DE', voiceURI: 'anna' },
    ]);
    await studioWith(bookOf(['Das ist ein Satz. Und noch einer.'], 'de'));
    act(() => $('btnReadAloud').click());
    act(() => $('raPlay').click());
    expect(spoken[0]).toMatchObject({ lang: 'de' });
    expect(spoken[0]!.voice!.name).toBe('Anna');
    act(() => c.api.raStop());
  }, 60_000);

  it('no speechSynthesis: 1.0\'s ra.noSpeech, Play disabled', async () => {
    await studioWith(bookOf(['Words here.']));
    act(() => $('btnReadAloud').click());
    expect($('raNote').textContent).toBe(t('ra.noSpeech'));
    expect(($('raPlay') as HTMLButtonElement).disabled).toBe(true);
  }, 60_000);
});

type Rec2 = { onresult: ((e: unknown) => void) | null; onend: (() => void) | null; onerror: ((e: unknown) => void) | null; lang: string; start: () => void; stop: () => void; abort: () => void };
function stubRecognition() {
  const recs: Rec2[] = [];
  class Rec {
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    lang = '';
    continuous = false;
    interimResults = false;
    constructor() {
      recs.push(this as unknown as Rec2);
    }
    start() {}
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  c.vars.dictCtorOverride = Rec;
  return recs;
}
const results = (parts: [string, boolean][]) => ({ results: parts.map(([s, fin]) => Object.assign([{ transcript: s }], { isFinal: fin })) });

describe('Dictation (A9)', () => {
  it('dictation.controls: no recogniser → the button explains (1.0\'s unsupported popover); nothing is written', async () => {
    c.vars.dictCtorOverride = null;
    await studioWith(bookOf(['Hello there.']));
    const before = JSON.stringify(await exported());
    act(() => $('btnDictate').click());
    expect($('dictPop').classList.contains('open')).toBe(true);
    expect($('dictPop').textContent).toContain(t('dict.unsupported'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect($('dictPop').classList.contains('open')).toBe(false);
    expect(JSON.stringify(await exported())).toBe(before);
  }, 60_000);

  it('dictation.insert: interim words never duplicate, final words land at the caret, one Undo takes the phrase back', async () => {
    const recs = stubRecognition();
    await studioWith(bookOf(['Hello there.']));
    const ed = activeEditor()!.editor;
    const text0 = editorText(ed).text;
    act(() => {
      ed.commands.focus('end');
    });
    act(() => $('btnDictate').click()); // first use: the intro popover (privacy line), then Begin
    expect($('dictPop').textContent).toContain(t('dict.privacy'));
    act(() => $('dictPopBegin').click());
    expect(recs).toHaveLength(1);
    expect(recs[0]!.lang).toBe('en-US');
    expect(localStorage.getItem('beuk.dictSeen.v1')).toBe('1');
    expect($('btnDictate').getAttribute('aria-pressed')).toBe('true');
    act(() => recs[0]!.onresult!(results([['general', false]])));
    act(() => recs[0]!.onresult!(results([['general kenobi', false]])));
    expect(editorText(ed).text).toBe(text0 + ' general kenobi');
    act(() => recs[0]!.onresult!(results([['general kenobi', true]])));
    expect(editorText(ed).text).toBe(text0 + ' general kenobi');
    act(() => $('btnDictate').click()); // stop
    expect(c.api.dict.want).toBe(false);
    act(() => {
      ed.commands.undo();
    });
    expect(editorText(ed).text).toBe(text0);
  }, 60_000);

  it('dictation.insert: two phrases in ONE recogniser session are two Undo steps (one per committed phrase, plan constraint 23)', async () => {
    const recs = stubRecognition();
    c.api.dict.seen = true;
    localStorage.setItem('beuk.dictSeen.v1', '1');
    await studioWith(bookOf(['Hello there.']));
    const ed = activeEditor()!.editor;
    const text0 = editorText(ed).text;
    act(() => {
      ed.commands.focus('end');
    });
    act(() => $('btnDictate').click());
    expect(recs).toHaveLength(1);
    // phrase 1: interim, then final
    act(() => recs[0]!.onresult!(results([['first', false]])));
    act(() => recs[0]!.onresult!(results([['first words', true]])));
    // phrase 2 in the same session: interim churn, then final
    act(() => recs[0]!.onresult!(results([['first words', true], ['and', false]])));
    act(() => recs[0]!.onresult!(results([['first words', true], ['and more', false]])));
    act(() => recs[0]!.onresult!(results([['first words', true], ['and more', true]])));
    expect(editorText(ed).text).toBe(text0 + ' first words and more');
    act(() => $('btnDictate').click()); // stop
    act(() => {
      ed.commands.undo();
    });
    expect(editorText(ed).text).toBe(text0 + ' first words');
    act(() => {
      ed.commands.undo();
    });
    expect(editorText(ed).text).toBe(text0);
  }, 60_000);

  it('dictation.language-suggest / lang: Spanish at the end of an English book offers "dictate in Spanish"; accepting writes 1.0\'s dictation key', async () => {
    stubRecognition();
    c.api.dict.seen = true;
    localStorage.setItem('beuk.dictSeen.v1', '1');
    const es = 'El perro corre por la calle y los niños juegan en el parque con sus amigos. Después de la comida, la familia se sienta en la casa para hablar de las cosas que pasaron durante el día.';
    // the section's last 1,500 characters (1.0's LANGSUG_TAIL) are Spanish; the book as a whole stays English
    await studioWith(bookOf([words(600, 'and the house was quiet') + '\n\n' + Array(9).fill(es).join(' ')]));
    await waitFor(() => expect($('langBar').classList.contains('open')).toBe(true), { timeout: 10_000 });
    expect($('langBar').dataset.kind).toBe('section');
    expect($('langBar').dataset.code).toBe('es');
    act(() => ($('langBar').querySelector('[data-lb="dict"]') as HTMLElement).click());
    const b = await exported();
    expect(b.dictation).toEqual({ lang: 'es', recent: ['es'] });
    expect((b.meta as Rec).language).toBe('en');
  }, 60_000);
});

describe('language detection (lang self-checks): 1.0\'s own detectLanguageInText on 1.0\'s own fixtures', () => {
  const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
  /** The first detectLanguageInText("…") argument inside the self-check with this id (read from 1.0, not retyped). */
  const fixture = (id: string): string => {
    const at = html.indexOf('{ id: "' + id + '"');
    expect(at, id).toBeGreaterThan(0);
    const m = /detectLanguageInText\("((?:[^"\\]|\\.)*)"/.exec(html.slice(at, at + 6000));
    expect(m, id).not.toBeNull();
    return JSON.parse('"' + m![1] + '"') as string;
  };
  const cases: [string, string | null][] = [
    ['lang.detect.german-prose', 'de'],
    ['lang.detect.french-prose', 'fr'],
    ['lang.detect.spanish-prose', 'es'],
    ['lang.detect.japanese-kana', 'ja'],
    ['lang.detect.chinese-han', 'zh-Hans'],
    ['lang.detect.arabic-rtl-epub', 'ar'],
    ['lang.detect.english-stays-en', 'en'],
  ];
  for (const [id, code] of cases) {
    it(id + ' (detection half)', () => {
      const det = c.api.detectLanguageInText(fixture(id));
      expect(det && det.code).toBe(code);
      expect(det && det.strong).toBe(true);
    });
  }
  it('lang.detect.gibberish-noop (detection half): no strong signal', () => {
    const det = c.api.detectLanguageInText(fixture('lang.detect.gibberish-noop'));
    expect(!det || !det.strong).toBe(true);
  });
});

/* ---- wave 3a, the rest of 1.0's self-checks that run without layout (the layout halves: e2e/book.mjs wave3aChecks) ---- */

const ES_TEXT = 'El viejo farero subía cada mañana las escaleras de piedra y miraba el mar que brillaba bajo el sol. No hablaba con nadie en el pueblo, pero todos lo conocían y los niños le llevaban pan y cartas. Cuando llegaba el invierno, la niebla cubría el puerto y él encendía la lámpara para los barcos.';
const openRow = async (label: string, marker: string) => {
  const all = Array.from(document.querySelectorAll<HTMLElement>('#structureScroll .sec-item'));
  const row = all.find((r) => (r.querySelector('.sec-name')?.textContent ?? '').endsWith(' — ' + label));
  if (!row) throw new Error('no row ' + label + ' in ' + JSON.stringify(all.map((r) => r.querySelector('.sec-name')?.textContent)));
  fireEvent.click(row);
  await waitFor(() => expect(editorText(activeEditor()!.editor).text).toContain(marker), { timeout: 10_000 });
};

describe('Zen, the calm fold and the day (A11)', () => {
  it('zen.calm.manuscript-only (the fold half): the details line is 1.0\'s, closed on entry, opens and closes on a click, and says what it holds', async () => {
    await studioWith(bookOf([words(20)]));
    const det = $('zenDetailsToggle');
    expect(det).not.toBeNull();
    expect(det.getAttribute('aria-controls')).toBe('secSettings editorMeta');
    act(() => $('btnZen').click());
    expect(document.body.classList.contains('zen-details-open')).toBe(false);
    expect(det.getAttribute('aria-expanded')).toBe('false');
    expect($('zenDetailsSum').textContent!.startsWith(t('zen.details') + ' · ')).toBe(true);
    expect($('zenDetailsSum').textContent).toContain('Chapter 1');
    act(() => det.click());
    expect(document.body.classList.contains('zen-details-open')).toBe(true);
    expect(det.getAttribute('aria-expanded')).toBe('true');
    act(() => det.click());
    expect(document.body.classList.contains('zen-details-open')).toBe(false);
    expect(det.getAttribute('aria-expanded')).toBe('false');
    act(() => det.click());
    act(() => c.api.setZenMode(false)); // every visit opens closed (1.0 clears the class on the way out)
    act(() => c.api.zenSettle());
    expect(document.body.classList.contains('zen-details-open')).toBe(false);
  }, 60_000);

  it('zen.day.holds-at-dusk: the phase clamps at 1 and holds; the timer stops at the hold; Paper\'s dusk is still a light', async () => {
    await studioWith(bookOf([words(20)]));
    const Z = (window as unknown as { beukZen: Record<string, (...a: unknown[]) => unknown> }).beukZen;
    let now = 5000;
    Z.dayClock!(() => now);
    Z.dayHidden!(false);
    act(() => void Z.set!(true));
    Z.settle!();
    Z.setDayPhase!(0.98);
    now += 0.02 * 5400 + 30;
    Z.dayTick!();
    expect(Z.dayPhase!()).toBe(1);
    now += 36000;
    Z.dayTick!();
    expect(Z.dayPhase!()).toBe(1);
    expect(Z.dayTimerActive!()).toBe(false);
    Z.setDayPhase!(3);
    expect(Z.dayPhase!()).toBe(1);
    const lum = (col: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(col[0]!) + 0.7152 * f(col[1]!) + 0.0722 * f(col[2]!);
    };
    for (const p of [0.9, 0.95, 1]) {
      const L = Z.dayLight!('paper', p) as { tint: number[]; glow: number[] };
      expect(Math.min(lum(L.tint), lum(L.glow))).toBeGreaterThanOrEqual(0.45);
      expect(L.tint[3]).toBeLessThanOrEqual(0.35);
      const sun = Z.dayBody!(false, p) as { y: number };
      expect(sun.y).toBeGreaterThan(0);
      expect(sun.y + 32).toBeLessThan(598);
    }
    expect((Z.dayBody!(false, 1) as { op: number }).op).toBeGreaterThan(0);
    act(() => void Z.set!(false));
    Z.settle!();
    Z.dayClock!(null);
    Z.dayHidden!(null);
  }, 60_000);
});

describe('Read Aloud, the rest (A10)', () => {
  it('readaloud.controls: play, pause, play, stop; opening another section stops the reading', async () => {
    stubSpeech([{ name: 'Samantha', lang: 'en-US', voiceURI: 'sam' }]);
    await studioWith(bookOf(['The harbour bell counted the hour. The ferry swung slow against the tide.', words(20, 'beta')]));
    act(() => $('btnReadAloud').click());
    act(() => $('raPlay').click());
    expect(c.api.ra.status).toBe('playing');
    expect(($('raPause') as HTMLButtonElement).disabled).toBe(false);
    act(() => $('raPause').click());
    expect(c.api.ra.status).toBe('paused');
    act(() => $('raPlay').click());
    expect(c.api.ra.status).toBe('playing');
    act(() => $('raStop').click());
    expect(c.api.ra.status).toBe('idle');
    act(() => $('raPlay').click());
    expect(c.api.ra.status).toBe('playing');
    await openRow('Chapter 2', 'beta');
    expect(c.api.ra.status).toBe('idle');
  }, 60_000);

  it('readaloud.section-language: a Spanish section in an English book is offered a Spanish voice; the tap switches only its reading language; back returns', async () => {
    const spoken = stubSpeech([
      { name: 'Samantha', lang: 'en-US', voiceURI: 'sam' },
      { name: 'Monica', lang: 'es-ES', voiceURI: 'mon' },
    ]);
    const book = bookOf([[ES_TEXT, ES_TEXT].join('\n\n')]);
    (book.book.meta as Rec).langSource = 'manual';
    await studioWith(book);
    const before = JSON.stringify(await exported());
    act(() => $('btnReadAloud').click());
    const box = $('raLangSug');
    const name = c.api.langDisplayName('es');
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain(t('ra.langSug', { lang: name }));
    expect(c.api.raLang()).toBe('en');
    act(() => $('raLangUse').click());
    expect($('raPop').hidden).toBe(false);
    expect(c.api.raLang()).toBe('es');
    expect(box.textContent).toContain(t('ra.langUsing', { lang: name }));
    expect(c.api.raLangVoices().every((v) => v.lang.toLowerCase().startsWith('es'))).toBe(true);
    act(() => $('raPlay').click());
    expect(spoken[0]).toMatchObject({ lang: 'es' });
    expect(spoken[0]!.voice!.name).toBe('Monica');
    act(() => $('raStop').click());
    act(() => $('raLangBook').click());
    expect(c.api.raLang()).toBe('en');
    expect(box.hidden).toBe(true);
    // the reading language is not book data: the book's language and the export are untouched
    expect(JSON.stringify(await exported())).toBe(before);
  }, 60_000);
});

type Rec3 = Rec2 & { aborted: boolean; emit: (list: [string, boolean][]) => void; end: () => void };
function stubRecognition2(asBrowser = false) {
  const recs: Rec3[] = [];
  class Rec {
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    lang = '';
    continuous = false;
    interimResults = false;
    aborted = false;
    constructor() {
      recs.push(this as unknown as Rec3);
    }
    start() {}
    stop() {
      this.onend?.();
    }
    abort() {
      this.aborted = true;
      this.onend?.();
    }
    emit(list: [string, boolean][]) {
      this.onresult?.({ resultIndex: 0, ...results(list) });
    }
    end() {
      this.onend?.();
    }
  }
  if (asBrowser) vi.stubGlobal('SpeechRecognition', Rec); // the browser's own: the studio makes it through envRecognition
  else c.vars.dictCtorOverride = Rec;
  c.api.dict.seen = true;
  localStorage.setItem('beuk.dictSeen.v1', '1');
  return recs;
}
const caretToEnd = () => act(() => void activeEditor()!.editor.commands.focus('end'));
const pickInSelect = (code: string) =>
  act(() => {
    const sel = $('dictLangSel') as HTMLSelectElement;
    sel.value = code;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('Dictation, the rest (A9)', () => {
  it('dictation.language-picker: every dictation language and the honest line; a pick is saved to the book (1.0\'s dictation key) and heard; a mid-session switch keeps final words', async () => {
    const recs = stubRecognition2();
    const book = bookOf(['Intro.']);
    (book.book.meta as Rec).langSource = 'manual';
    await studioWith(book);
    expect(envRun((cl) => cl.api.dictLangInfo())!).toMatchObject({ lang: 'en-US', chosen: false });
    fireEvent.contextMenu($('btnDictate')); // the right-click opens the picker, as 1.0's
    const pop = $('dictPop');
    expect(pop.classList.contains('open')).toBe(true);
    const sel = $('dictLangSel') as HTMLSelectElement;
    expect(sel.querySelectorAll("option[value]:not([value=''])").length).toBe(Object.keys(c.api.DICT_LANGS).length);
    expect(pop.textContent).toContain(t('dict.noAutoDetect').slice(0, 30));
    expect(pop.querySelector('[data-dict-lang="en"][aria-pressed="true"]')).not.toBeNull();
    pickInSelect('es');
    expect(envRun((cl) => cl.api.dictLangInfo())!.lang).toBe('es-ES');
    expect($('dictPop').querySelector('[data-dict-lang="es"][aria-pressed="true"]')).not.toBeNull();
    // 1.0 saves the pick (dictSetLang → noteBookEdited): it is in the book, as serializeBook writes it
    expect((await exported()).dictation).toEqual({ lang: 'es', recent: ['es'] });
    const ed = activeEditor()!.editor;
    caretToEnd();
    act(() => c.api.dictPopClose());
    act(() => $('btnDictate').click());
    const r1 = recs[recs.length - 1]!;
    expect(c.api.dict.want).toBe(true);
    expect(r1.lang).toBe('es-ES');
    act(() => r1.emit([['hola mundo', true], ['y luego', false]]));
    expect(editorText(ed).text).toBe('Intro. hola mundo y luego');
    // mid-session: the old recogniser is silenced, the unfinalised tail leaves, a fresh one hears French
    fireEvent.contextMenu($('btnDictate'));
    const n0 = recs.length;
    pickInSelect('fr');
    const r2 = recs[recs.length - 1]!;
    expect(r1.aborted).toBe(true);
    expect(recs.length).toBe(n0 + 1);
    expect(r2.lang).toBe('fr-FR');
    expect(editorText(ed).text).toBe('Intro. hola mundo');
    act(() => r1.emit([['late ghost words', true]]));
    expect(editorText(ed).text).toBe('Intro. hola mundo');
    act(() => r2.emit([['bonjour', true]]));
    expect(editorText(ed).text).toBe('Intro. hola mundo bonjour');
    act(() => c.api.dictPopClose());
    act(() => $('btnDictate').click());
    expect(c.api.dict.want).toBe(false);
    const ch = c.api.dictLangChoices();
    expect(ch[0]).toBe('fr');
    expect(ch).toEqual(expect.arrayContaining(['es', 'en']));
    const saved = (await exported()).dictation as { lang: string; recent: string[] };
    expect(saved.lang).toBe('fr');
    expect(saved.recent.slice(0, 2)).toEqual(['fr', 'es']);
  }, 60_000);

  it('dictation.controls: a section switch stops listening; Zen\'s twin mic starts and stops the same session', async () => {
    stubRecognition2();
    await studioWith(bookOf(['Hello there.', words(20, 'beta')]));
    caretToEnd();
    act(() => $('btnDictate').click());
    if (!c.api.dict.want) throw new Error('not listening: ' + JSON.stringify({ pop: $('dictPop')?.className, text: $('dictPop')?.textContent?.slice(0, 120), seen: c.api.dict.seen }));
    expect($('btnDictate').classList.contains('listening')).toBe(true);
    expect(document.body.classList.contains('dict-on')).toBe(true);
    await openRow('Chapter 2', 'beta');
    expect(c.api.dict.want).toBe(false);
    expect(document.body.classList.contains('dict-on')).toBe(false);
    act(() => $('btnZen').click());
    const zb = $('btnZenDictate');
    expect($('zenCluster').contains(zb)).toBe(true);
    act(() => zb.click());
    expect(c.api.dict.want).toBe(true);
    expect(zb.classList.contains('listening')).toBe(true);
    expect(zb.getAttribute('aria-pressed')).toBe('true');
    act(() => zb.click());
    expect(c.api.dict.want).toBe(false);
    expect(zb.classList.contains('listening')).toBe(false);
    act(() => c.api.setZenMode(false));
    act(() => c.api.zenSettle());
  }, 60_000);

  it('dictation.insert (the engine\'s own stop): the unfinalised tail leaves, the intent survives and a fresh session resumes at the same place', async () => {
    const recs = stubRecognition2();
    await studioWith(bookOf(['The harbour was calm.']));
    const ed = activeEditor()!.editor;
    caretToEnd();
    act(() => $('btnDictate').click());
    const rec = recs[0]!;
    act(() => rec.emit([['the bell rang over the water', true], ['and the gulls', false]]));
    expect(editorText(ed).text).toBe('The harbour was calm. the bell rang over the water and the gulls');
    act(() => rec.end());
    expect(editorText(ed).text).toBe('The harbour was calm. the bell rang over the water');
    expect(c.api.dict.want).toBe(true);
    await waitFor(() => expect(recs).toHaveLength(2), { timeout: 3000 }); // 1.0 restarts 300 ms after the end
    act(() => recs[1]!.emit([['cried once', true]]));
    expect(editorText(ed).text).toBe('The harbour was calm. the bell rang over the water cried once');
    act(() => $('btnDictate').click());
    expect(c.api.dict.want).toBe(false);
  }, 60_000);

  it('a restart after the browser ends a session hears the chosen dictation language, whatever state the studio set since', async () => {
    const recs = stubRecognition2(true);
    const book = bookOf(['Intro.']);
    (book.book as Rec).dictation = { lang: 'es', recent: ['es'] };
    await studioWith(book);
    caretToEnd();
    act(() => $('btnDictate').click());
    expect(recs).toHaveLength(1);
    expect(recs[0]!.lang).toBe('es-ES');
    act(() => recs[0]!.emit([['hola mundo', true]]));
    // another part of the studio sets a lighter state of its own into the shared closure (the starter bar does)
    c.setState({ meta: { language: 'en' }, sections: [] } as never);
    act(() => recs[0]!.end());
    await waitFor(() => expect(recs).toHaveLength(2), { timeout: 3000 });
    expect(recs[1]!.lang).toBe('es-ES');
    act(() => recs[1]!.emit([['y luego', true]]));
    expect(editorText(activeEditor()!.editor).text).toBe('Intro. hola mundo y luego');
    act(() => $('btnDictate').click());
  }, 60_000);

  it('dictation.language-suggest (the book half): an all-Spanish manuscript offers to fix the BOOK language; only the tap sets it (manual), dictation following', async () => {
    stubRecognition2();
    const book = bookOf([[ES_TEXT, ES_TEXT, ES_TEXT].join('\n\n'), [ES_TEXT, ES_TEXT].join('\n\n')]);
    (book.book.meta as Rec).langSource = 'manual';
    await studioWith(book);
    act(() => $('btnDictate').click()); // the writer has used the mic: suggestions may speak (1.0's gate)
    act(() => $('btnDictate').click());
    act(() => void envRun((cl) => cl.api.langBarRefresh()));
    await waitFor(() => expect($('langBar').classList.contains('open')).toBe(true), { timeout: 10_000 });
    expect($('langBar').dataset.kind).toBe('book');
    expect($('langBar').dataset.code).toBe('es');
    expect(((await exported()).meta as Rec).language).toBe('en');
    act(() => ($('langBar').querySelector('[data-lb="book"]') as HTMLElement).click());
    const meta = (await exported()).meta as Rec;
    expect(meta.language).toBe('es');
    expect(meta.langSource).toBe('manual');
    expect(meta.langGuess).toBe('');
    expect(envRun((cl) => cl.api.dictLangInfo().lang)).toBe('es-ES');
    expect($('langBar').classList.contains('open')).toBe(false);
  }, 60_000);
});

describe('the book\'s language, beyond detection (lang)', () => {
  it('lang.autoformat.german-quotes: Auto-Format on a German book gives low-high quotes, never English curls', async () => {
    await studioWith(bookOf(['"Komm sofort her", sagte sie, "sonst wird es dunkel."'], 'de'));
    act(() => $('btnBeautify').click());
    await waitFor(() => expect(editorText(activeEditor()!.editor).text).toContain('„'));
    const out = editorText(activeEditor()!.editor).text;
    expect(out).toContain('“');
    expect(out).not.toContain('"');
    expect(out).not.toContain('”');
  }, 60_000);

  it('lang.count.chinese-characters: a Chinese book is counted in characters (spaces and punctuation out), in the word bar too', async () => {
    const zh = '守灯塔的老人每天清晨都会爬上石阶，望着在阳光下闪光的大海。他在村里不和任何人说话，但大家都认识他。';
    await studioWith(bookOf([zh], 'zh-Hans'));
    const want = [...zh.replace(/[\s\p{P}]/gu, '')].length;
    expect(c.api.countWords(zh, 'zh-Hans')).toBe(want);
    expect(want).toBeGreaterThan(zh.split(/\s+/).filter(Boolean).length * 10);
    // the bar is 1.0's updateStats: sectionWords of the open section (its words in the book's language, the title's too)
    const secW = envRun((cl) => cl.api.sectionWords(cl.getState().sections[0]))!;
    expect(secW).toBeGreaterThanOrEqual(want);
    await waitFor(() => expect($('edSecWords').textContent).toBe(t('editor.countSection', { n: String(secW), count: secW })));
  }, 60_000);
});
