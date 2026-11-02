import { useEffect, useRef } from 'react';
import { closureIfLoaded } from '../closure/index';
import { useStats } from '../book/stats';
import { fmtNum } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { envRun } from './page';

/* Wave 3a: what the open chapter carries of the writing environment, as 1.0's centre column does.
   - #langBar: 1.0's language suggestion bar (langBarRefresh draws it; its clicks are 1.0's langBarInit handler).
   - #editorWordBar: 1.0's live counts under the toolbar (updateStats: editor.countSection · editor.countBook).
   - after a local edit: 1.0's editor input handlers — dictation re-anchors when the writer typed over a live span
     (initDictation), and the bar is looked at again 900 ms after the last key (langBarLater: LANGSUG_DEBOUNCE). */

const LANGSUG_DEBOUNCE = 900; // 1.0's LANGSUG_DEBOUNCE (the closure's langBarLater would read a state built earlier)
let barTimer: ReturnType<typeof setTimeout> | null = null;

/** A local edit of the page (not a remote one). */
export function afterLocalEdit(): void {
  const c = closureIfLoaded();
  if (!c) return;
  const d = c.api.dict;
  if (!d.applying && d.want && d.spanStart >= 0) {
    d.spanStart = -1;
    d.spanLen = 0;
    d.sessFinals = '';
    d.sessInterim = '';
  }
  if (barTimer) clearTimeout(barTimer);
  barTimer = setTimeout(() => {
    barTimer = null;
    envRun((cl) => cl.api.langBarRefresh());
  }, LANGSUG_DEBOUNCE);
}

/** The open section is leaving the desk (another section, another book): 1.0's selectSection / applyBookDoc. */
export function leaveSection(): void {
  const c = closureIfLoaded();
  if (!c) return;
  c.api.raStop();
  c.api.dictDiscard();
}

export function LangBar() {
  const bar = useRef<HTMLDivElement>(null);
  // drawn once the section is on the desk (1.0's selectSection → langBarRefresh)
  useEffect(() => {
    const id = requestAnimationFrame(() => envRun((c) => c.api.langBarRefresh()));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      id="langBar"
      role="status"
      aria-live="polite"
      ref={bar}
      onClick={(e) => {
        // 1.0's langBarInit
        const b = (e.target as Element).closest ? ((e.target as Element).closest('[data-lb]') as HTMLElement | null) : null;
        if (!b) return;
        const act = b.getAttribute('data-lb');
        envRun((c) => {
          const sug = c.api.langSug.last;
          if (act === 'change') {
            c.api.dictOpenLangPicker(b);
            return;
          }
          if (!sug) return;
          if (act === 'book') c.api.langSetBookLanguage(sug.code);
          else if (act === 'dict') c.api.dictSetLang(sug.code);
          else if (act === 'no') c.api.langSug.dismissed[sug.kind === 'book' ? 'book:' + sug.code : sug.sectionId + ':' + sug.code] = true;
          c.api.langBarRefresh();
        });
      }}
    />
  );
}

export function WordBar({ sectionId }: { sectionId: unknown }) {
  const { t, lang } = useLocale();
  const stats = useStats();
  if (!stats) return <div id="editorWordBar" aria-live="polite" />;
  const secW = typeof sectionId === 'string' ? (stats.sections.get(sectionId)?.words ?? 0) : 0;
  const book = stats.words;
  return (
    <div id="editorWordBar" aria-live="polite">
      <span id="edSecWords">{t('editor.countSection', { n: fmtNum(secW, lang), count: secW })}</span>
      <span aria-hidden="true">·</span>
      <span id="edBookWords">{t('editor.countBook', { n: fmtNum(book, lang), count: book })}</span>
    </div>
  );
}
