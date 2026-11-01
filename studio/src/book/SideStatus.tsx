import { useState } from 'react';
import { fmtNum } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { setStatusOpen, sidePrefs } from './sidePrefs';
import { PAGE_WORDS, useStats } from './stats';

/* BEUK:sidebar — 1.0's statistics disclosure in the side dock
   (client/index.html #sideStatus: #btnSideStatus with its one-line
   summary, #sideStatusBody with the four cells, the note and the progress
   bars; renderSideStatusSummary, statsCells, renderProgress). Open or
   closed is the device's own (beuk.sidebar.v1 statusOpen, closed by
   default). Left out, each with its wave: the streak row and the goal lines
   (wave 3, goals and streak); the shelf line (#syncRow, wave 7). */

export function SideStatus() {
  const { t, lang } = useLocale();
  const stats = useStats();
  const [open, setOpen] = useState(() => sidePrefs().statusOpen);
  const n = (v: number) => fmtNum(v, lang);
  const words = stats?.words ?? 0;
  const pages = stats?.pages ?? 0;
  const mins = stats?.minutes ?? 0;
  const time = mins >= 60 ? t('stats.readingH', { h: Math.floor(mins / 60), m: mins % 60 }) : t('stats.readingM', { m: mins });
  const summary = t('side.statsSummary', {
    words: t('side.statsWords', { n: n(words), count: words }),
    pages: t('side.statsPages', { n: n(pages), count: pages }),
    time,
  });
  const toggle = () => {
    setStatusOpen(!open);
    setOpen(!open);
  };
  const bar = (k: 'front' | 'body' | 'back', label: 'side.groupFront' | 'side.groupBody' | 'side.groupBack', id: string) => {
    const pct = stats?.progress[k] ?? null;
    return (
      <div className="prog-row">
        <span>{t(label)}</span>
        <span className="prog-track">
          <span className="prog-fill" id={'prog' + id} style={{ display: 'block', width: (pct ?? 0) + '%' }} />
        </span>
        <span className="prog-pct" id={'prog' + id + 'Pct'}>
          {(pct ?? 0) + '%'}
        </span>
      </div>
    );
  };
  return (
    <div className="side-status" id="sideStatus">
      <button className="side-status-head" id="btnSideStatus" type="button" aria-expanded={open ? 'true' : 'false'} aria-controls="sideStatusBody" onClick={toggle}>
        <span className="sr-only">{t('side.statsAria')}</span>
        <span className="side-status-sum" id="sideStatusSummary">
          {summary}
        </span>
        <Icon name="ChevronUp" className="side-status-chev" />
      </button>
      <div className="side-status-body" id="sideStatusBody" hidden={!open}>
        <div className="stat-grid">
          <div className="stat-cell">
            <div className="stat-num" id="statWords">{n(words)}</div>
            <div className="stat-lab">{t('stats.words')}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-num" id="statChars">{n(stats?.chars ?? 0)}</div>
            <div className="stat-lab">{t('stats.characters')}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-num" id="statPages">{n(pages)}</div>
            <div className="stat-lab">{t('stats.pages')}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-num" id="statTime">{time}</div>
            <div className="stat-lab">{t('stats.readingTime')}</div>
          </div>
        </div>
        {/* no reading desk until wave 4: always 1.0's words-per-page note */}
        <p id="statsNote" className="stats-note">
          {stats ? t('stats.pagesNote', { a: n(PAGE_WORDS), b: n(stats.readWpm) }) : ''}
        </p>
        {/* the streak row and the goal lines: wave 3 (goals and streak) */}
        <div className="prog-block" id="progressBlock">
          {bar('front', 'side.groupFront', 'Front')}
          {bar('body', 'side.groupBody', 'Body')}
          {bar('back', 'side.groupBack', 'Back')}
        </div>
      </div>
    </div>
  );
}
