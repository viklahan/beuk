import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBook } from '../book/BookProvider';
import { useStats } from '../book/stats';
import { closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { activeEditor } from '../editor/active';
import { fmtNum } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { desk, envEnter, envRecognition, envRun } from './page';

/* Wave 3a: the page-wide half of 1.0's writing environment — its initChrome (Zen: the Exit button, Escape, the
   scene popover and the section index closing on an outside click, Alt+Arrow between sections, the day cycle's
   visibility), initHeader (Read Aloud: Escape and an outside click close its popover, the voices arriving) and
   initDictation (Escape and an outside click close its popover; dictSyncUi), as document listeners calling 1.0's own
   functions. Plus #zenPill (1.0: a child of <body>, outside #app; 1.0's updateStats writes its counts) and what 1.0's
   selectSection / applyBookDoc do to these features when the desk changes. */

type Props = { setCenter: (tab: 'content' | 'outline') => void };

const inZen = () => document.body.classList.contains('zen');
const modalOpen = () => !!document.querySelector('.modal-back.open');

/** 1.0's own page seams for Zen and its sound (1.0: window.beukZen / window.beukZenSound, set at the end of its Zen
 *  code), in 1.0's shapes, over the same lifted functions: what 1.0's self-checks drive, so the e2e can drive 2.0 the
 *  same way. Nothing in 2.0 reads them. */
function installSeams(c: Closure): void {
  const a = c.api, v = c.vars;
  const w = window as unknown as Record<string, unknown>;
  w.beukZen = {
    set: (on: boolean) => envRun((cl) => cl.api.setZenMode(on)),
    active: () => inZen(),
    settle: () => a.zenSettle(),
    transitioning: () => v.zenTransitioning,
    overrideReducedMotion: (x: unknown) => {
      v.zenReducedOverride = x === null || x === undefined ? null : !!x;
    },
    goTo: (id: string) => envRun((cl) => cl.api.zenGoTo(id)),
    step: (d: number) => envRun((cl) => cl.api.zenStep(d)),
    renderSurface: () => envRun((cl) => cl.api.zenRenderSurface()),
    dayPhase: () => a.zdPhase(),
    setDayPhase: (p: number) => a.zdSetPhase(p),
    dayTick: () => a.zdTick(),
    dayClock: (fn: (() => number) | null) => a.zdSetClock(fn),
    dayLight: (theme: string, p: number) => a.zdLight(theme, p),
    dayBody: (night: boolean, p: number) => a.zdBody(night, p),
    dayHidden: (x: unknown) => {
      v.zdHiddenOv = x === null || x === undefined ? null : !!x;
      a.zdVisibility();
    },
    dayTimerActive: () => !!v.zdTimer,
    dayRunning: () => v.zdStart !== null,
  };
  const snd = a.zenSound;
  w.beukZenSound = {
    start: () => a.zenSoundStart(),
    stop: () => a.zenSoundStop(),
    playing: () => snd.playing,
    hasContext: () => !!snd.ctx,
    pref: () => a.zenSoundPref(),
    scene: () => a.zenScenePref(),
    setScene: (n: string) => a.zenSoundSetScene(n),
    graph: () => a.zenSoundGraph(),
    status: () => ({ status: snd.status, error: snd.error, pending: snd.pending }),
    settled: () => snd.settle || Promise.resolve(),
    files: () => JSON.parse(JSON.stringify(a.ZEN_SOUND_FILES)),
    url: (s: string) => a.zenSoundUrl(s),
    migrate: (x: unknown) => a.zenSceneMigrate(x),
    scenes: () => a.ZEN_SCENES.slice(),
  };
}

export function EnvironmentHost({ setCenter }: Props) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const stats = useStats();
  const ydoc = bk.book?.ydoc ?? null;

  // the desk 1.0's code reaches (src/environment/page.ts)
  desk.ydoc = ydoc;
  desk.active = bk.active;
  desk.select = bk.select;
  desk.setCenter = setCenter;

  // the document listeners, once
  useEffect(() => {
    let alive = true;
    let ownCtor: unknown = null;
    void loadClosure()
      .then((c) => {
        if (!alive) return;
        // 1.0's top-level `dict.seen = localStorage beuk.dictSeen.v1 === "1"` (a statement the extractor does not lift)
        try {
          c.api.dict.seen = !!(window.localStorage && localStorage.getItem(c.api.DICT_SEEN_KEY) === '1');
        } catch {
          c.api.dict.seen = false;
        }
        installSeams(c);
        // the browser's recogniser, made through envRecognition (1.0's dictCtorOverride: a test's own stub stands)
        const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
        const Real = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (Real && c.vars.dictCtorOverride === undefined) {
          c.vars.dictCtorOverride = envRecognition(Real);
          ownCtor = c.vars.dictCtorOverride;
        }
        envRun((cl) => {
          cl.api.dictSyncUi();
          cl.api.raRefresh();
        });
      })
      .catch(() => undefined);
    const api = () => closureIfLoaded()?.api;
    const onKey = (e: KeyboardEvent) => {
      const a = api();
      if (!a || e.key !== 'Escape') return;
      a.raClosePop();
      a.dictPopClose();
      if (inZen() && !modalOpen()) envRun((c) => c.api.setZenMode(false));
    };
    const onKeyCapture = (e: KeyboardEvent) => {
      const a = api();
      if (!a || !inZen() || modalOpen()) return;
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        e.stopPropagation();
        envRun((c) => c.api.zenStep(e.key === 'ArrowLeft' ? -1 : 1));
      } else if (e.key === 'Escape') {
        const pop = document.getElementById('zenIndex');
        if (pop && pop.classList.contains('open')) {
          e.preventDefault();
          e.stopPropagation();
          a.zenIndexClose();
        }
      }
    };
    const onClick = (e: MouseEvent) => {
      const a = api();
      if (!a) return;
      const target = e.target as Element;
      const sp = document.getElementById('zenScenePop'), caret = document.getElementById('btnZenScenes');
      if (sp && sp.classList.contains('open') && !sp.contains(target) && !(caret && caret.contains(target))) {
        sp.classList.remove('open');
        if (caret) caret.setAttribute('aria-expanded', 'false');
      }
      const ix = document.getElementById('zenIndex'), name = document.getElementById('zenNavName');
      if (ix && ix.classList.contains('open') && !ix.contains(target) && !(name && name.contains(target))) a.zenIndexClose();
      const ra = document.getElementById('raPop');
      if (ra && !ra.hidden && target.isConnected !== false && !(target.closest && target.closest('.ra-wrap'))) a.raClosePop();
      const dp = document.getElementById('dictPop');
      if (dp && dp.classList.contains('open') && !dp.contains(target) && target.isConnected !== false && !(target.closest && target.closest('#btnDictate, #btnZenDictate, #langBar'))) a.dictPopClose();
    };
    /* 1.0's own listeners inside the dictation popover (dictWireLangPicker: the language buttons and the select call
       dictSetLang, which saves the book): 1.0's state is built from the book before they run and their save is
       written after (envEnter), as if they ran inside envRun. Capture phase: before the element's own listener. */
    let popDone: (() => void) | null = null;
    const onPopEvent = (e: Event) => {
      const target = e.target as Element | null;
      if (!target || !target.closest || !target.closest('#dictPop')) return;
      popDone?.();
      const done = envEnter();
      popDone = done;
      if (done) queueMicrotask(done); // if 1.0's listener stops the event before it bubbles back up
    };
    // the event is back at the window: 1.0's listener has run (synchronously, as 1.0's save is)
    const onPopAfter = () => {
      const done = popDone;
      popDone = null;
      done?.();
    };
    const onVis = () => api()?.zdVisibility();
    const onVoices = () => {
      const pop = document.getElementById('raPop');
      if (pop && !pop.hidden) envRun((c) => c.api.raRefresh());
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKeyCapture, true);
    document.addEventListener('click', onClick);
    document.addEventListener('click', onPopEvent, true);
    document.addEventListener('change', onPopEvent, true);
    window.addEventListener('click', onPopAfter);
    window.addEventListener('change', onPopAfter);
    document.addEventListener('visibilitychange', onVis);
    const ss = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    try {
      ss?.getVoices();
      ss?.addEventListener?.('voiceschanged', onVoices);
    } catch {
      /* no speech */
    }
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onKeyCapture, true);
      document.removeEventListener('click', onClick);
      document.removeEventListener('click', onPopEvent, true);
      document.removeEventListener('change', onPopEvent, true);
      window.removeEventListener('click', onPopAfter);
      window.removeEventListener('change', onPopAfter);
      document.removeEventListener('visibilitychange', onVis);
      try {
        ss?.removeEventListener?.('voiceschanged', onVoices);
      } catch {
        /* no speech */
      }
      const cl = closureIfLoaded();
      if (cl && ownCtor && cl.vars.dictCtorOverride === ownCtor) cl.vars.dictCtorOverride = undefined;
      // a studio leaving the page leaves Zen with it (its layers are 1.0's, in <body>)
      if (inZen()) {
        const c = closureIfLoaded();
        if (c) {
          c.api.setZenMode(false);
          c.api.zenSettle();
        }
      }
    };
  }, []);

  // another book on the desk: 1.0's applyBookDoc → langSugReset
  useEffect(() => {
    if (!ydoc) return;
    envRun((c) => c.api.langSugReset());
  }, [ydoc]);

  // another section in Zen: 1.0's zenGoTo finish (the surface, the caret in the page) once the editor is there
  const lastActive = useRef(bk.active);
  useLayoutEffect(() => {
    if (lastActive.current === bk.active) return;
    lastActive.current = bk.active;
    const id = requestAnimationFrame(() => {
      envRun((c) => {
        c.api.langBarRefresh();
        if (!inZen()) return;
        c.api.zenRenderSurface();
      });
      if (inZen()) activeEditor()?.editor.view.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [bk.active]);

  // the text changed in Zen: 1.0's input handler redraws the stage 220 ms later
  useEffect(() => {
    if (!ydoc) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const on = () => {
      if (!inZen()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => envRun((c) => c.api.zenRenderSurface()), 220);
    };
    ydoc.on('update', on);
    return () => {
      ydoc.off('update', on);
      if (timer) clearTimeout(timer);
    };
  }, [ydoc]);

  // the interface language changed: 1.0's dictOnLangChange, and Read Aloud's popover redrawn
  const firstLang = useRef(lang);
  useEffect(() => {
    if (firstLang.current === lang) return;
    firstLang.current = lang;
    envRun((c) => {
      c.api.dictOnLangChange();
      const pop = document.getElementById('raPop');
      if (pop && !pop.hidden) c.api.raRefresh();
    });
  }, [lang]);

  // #zenPill: 1.0's word counts (updateStats: this section · the book) and the way back
  const row = bk.rows.find((r) => r.index === bk.active);
  const secId = row?.id;
  const secW = stats && typeof secId === 'string' ? (stats.sections.get(secId)?.words ?? 0) : 0;
  const bookW = stats?.words ?? 0;
  const counts = stats ? t('editor.countSection', { n: fmtNum(secW, lang), count: secW }) + ' · ' + t('editor.countBook', { n: fmtNum(bookW, lang), count: bookW }) : '';
  return createPortal(
    <div id="zenPill" role="status">
      <span className="zp-counts" id="zenCount">
        {counts}
      </span>
      <button id="btnZenExit" type="button" onClick={() => envRun((c) => c.api.setZenMode(false))}>
        {t('zen.exit')}
      </button>
    </div>,
    document.body,
  );
}
